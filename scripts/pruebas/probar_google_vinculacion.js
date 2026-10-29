// Soporte: criptografía real, MongoDB y OAuth simulados. No toca cuentas reales.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const raiz = path.join(__dirname, '../..');
const cargar = (archivo, deps) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, archivo), 'utf8'), {
    module, exports: module.exports, require: n => {
      if (n === 'crypto') return crypto;
      if (Object.hasOwn(deps, n)) return deps[n];
      throw new Error('Dependencia no simulada: ' + n);
    }, Date, URL, console,
  });
  return module.exports;
};
class ErrorHttp extends Error { constructor(status, message) { super(message); this.status = status; } }
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const coincide = (o, q) => Object.entries(q).every(([k, v]) => {
  const actual = get(o, k);
  if (v && typeof v === 'object' && '$exists' in v) return (actual !== undefined) === v.$exists;
  if (v && typeof v === 'object' && '$gt' in v) return actual > v.$gt;
  return actual === v;
});
let cuenta, auditoria, antesDeActualizar;
const original = () => ({ _id: 'cuenta1', nombre: 'Cliente', phone: '++55 11 91234 5678', activo: true,
  estadoCuenta: 'aprobada', rol: 'medico', passwordHash: 'clave-anterior',
  suscripcion: { plan: 'mensual', hasta: '2030-01-01' }, estudiante: null });
const Medico = {
  findById: async id => id === cuenta._id ? structuredClone(cuenta) : null,
  findOne: q => ({ lean: async () => coincide(cuenta, q) ? structuredClone(cuenta) : null }),
  updateOne: async (q, u) => {
    if (antesDeActualizar) { const f = antesDeActualizar; antesDeActualizar = null; f(); }
    if (!coincide(cuenta, q)) return { modifiedCount: 0 };
    if (u.$set?.googleSub === 'ocupado') throw Object.assign(new Error('duplicado'), { code: 11000 });
    Object.assign(cuenta, structuredClone(u.$set || {}));
    for (const k of Object.keys(u.$unset || {})) delete cuenta[k];
    return { modifiedCount: 1 };
  },
};
const googleReal = cargar('services/googleAcceso.js', {
  mongoose: { Schema: class {}, models: { DesafioGoogle: {} } }, '../config': { CONFIG: {} },
  '../db/models': { Medico }, './auth': {}, './httpHelpers': { ErrorHttp },
  './googleIdentidad': {}, './operadores': {}, './telefono': {},
});
const google = {
  configuracion: () => ({ origen: 'https://app.example.test' }),
  comprobarEstado: googleReal.comprobarEstado,
  mismoOrigen: req => { if (req.headers.origin !== 'https://app.example.test') throw new ErrorHttp(403, 'Origen'); },
  comprobar: async req => {
    if (req.body.credential !== 'google-verificado') throw new ErrorHttp(401, 'Google inválido');
    return { sub: req.sub || 'google1', email: req.email || 'cliente@gmail.com' };
  },
};
const servicio = cargar('services/googleVinculacion.js', {
  '../db/models': { Medico, AuditLog: { create: async d => auditoria.push(structuredClone(d)) } },
  './googleAcceso': google, './totp': { verificarCodigo: (_s, c) => c === '123456' }, './httpHelpers': { ErrorHttp },
});
const emitir = () => servicio.emitir({ cuentaId: 'cuenta1', email: 'Cliente@gmail.com', actor: 'ssh:operador' });
const tokenDe = r => r.enlace.split('=')[1];
const req = token => ({ headers: { origin: 'https://app.example.test' }, body: { enlaceToken: token, credential: 'google-verificado' } });
let n = 0;
async function test(nombre, fn) {
  cuenta = original(); auditoria = []; antesDeActualizar = null;
  await fn(); n++; console.log('✅ ' + nombre);
}
(async () => {
  await test('encuentra formatos históricos sin cambiar el número ni aceptar coincidencias parciales', () => {
    const p = servicio.patronTelefono('5511912345678');
    for (const telefono of ['5511912345678', '+5511912345678', '++55 11 91234 5678', '+55 (11) 91234-5678']) assert.ok(p.test(telefono));
    for (const telefono of ['55119123456780', '05511912345678', '5511912345678-01', '5511912345679']) assert.ok(!p.test(telefono));
    assert.throws(() => servicio.patronTelefono('.*'));
  });
  await test('emite autorización con hash, correo restringido, vencimiento y auditoría sin token', async () => {
    const r = await emitir(), token = tokenDe(r);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(cuenta.googleEnlaceSoporte.hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.equal(cuenta.googleEnlaceSoporte.email, 'cliente@gmail.com');
    assert.ok(r.vence - Date.now() > 7190000 && r.vence - Date.now() <= 7200000);
    assert.ok(!JSON.stringify(cuenta).includes(token)); assert.ok(!JSON.stringify(auditoria).includes(token));
    assert.equal(auditoria.length, 1); assert.equal(cuenta.googleSub, undefined);
  });
  await test('vincula una sola vez y conserva teléfono literal, contraseña, rol y plan', async () => {
    const antes = structuredClone(cuenta), r = await emitir();
    const resultado = await servicio.confirmar(req(tokenDe(r)));
    for (const k of ['phone', 'passwordHash', 'rol', 'suscripcion', 'estudiante']) assert.deepEqual(cuenta[k], antes[k]);
    assert.equal(resultado.phone, antes.phone); assert.equal(cuenta.googleSub, 'google1');
    assert.equal(cuenta.googleEnlaceSoporte, undefined); assert.ok(cuenta.sesionesDesde instanceof Date);
    await assert.rejects(servicio.confirmar(req(tokenDe(r))), e => e.status === 410);
  });
  await test('enlace solo, correo escrito o Google diferente no conceden acceso', async () => {
    const r = await emitir();
    const sinGoogle = req(tokenDe(r)); sinGoogle.body.credential = 'inventado';
    await assert.rejects(servicio.confirmar(sinGoogle), e => e.status === 401);
    const otro = req(tokenDe(r)); otro.email = 'otra@gmail.com';
    await assert.rejects(servicio.confirmar(otro), e => e.status === 403);
    assert.equal(cuenta.googleSub, undefined); assert.ok(cuenta.googleEnlaceSoporte);
  });
  await test('no acepta enlaces vencidos, reemplazados ni solicitudes de otro origen', async () => {
    const viejo = await emitir(), nuevo = await emitir();
    await assert.rejects(servicio.confirmar(req(tokenDe(viejo))), e => e.status === 410);
    const otroOrigen = req(tokenDe(nuevo)); otroOrigen.headers.origin = 'https://otra.test';
    await assert.rejects(servicio.confirmar(otroOrigen), e => e.status === 403);
    cuenta.googleEnlaceSoporte.vence = new Date(0);
    await assert.rejects(servicio.confirmar(req(tokenDe(nuevo))), e => e.status === 410);
  });
  await test('conserva 2FA y exige su código antes de vincular', async () => {
    cuenta.dosFA = { activo: true, secreto: 'secreto' };
    const r = await emitir(), solicitud = req(tokenDe(r));
    await assert.rejects(servicio.confirmar(solicitud), e => e.status === 401);
    solicitud.body.codigo = '123456'; await servicio.confirmar(solicitud);
    assert.deepEqual(cuenta.dosFA, { activo: true, secreto: 'secreto' });
  });
  await test('no habilita cuentas bloqueadas, pendientes, sin verificar ni reemplaza Google', async () => {
    for (const cambios of [{ activo: false }, { estadoCuenta: 'pendiente' }, { estadoCuenta: 'rechazada' },
      { perfilAcceso: 'profesional', verificacionProfesional: { estado: 'pendiente' } }, { googleSub: 'existente' }, { googleSolo: true }]) {
      cuenta = { ...original(), ...cambios };
      await assert.rejects(emitir()); assert.equal(cuenta.googleEnlaceSoporte, undefined);
    }
  });
  await test('dos pestañas consumen una sola autorización', async () => {
    const r = await emitir();
    const resultados = await Promise.allSettled([servicio.confirmar(req(tokenDe(r))), servicio.confirmar(req(tokenDe(r)))]);
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  });
  await test('cambio concurrente de estado o 2FA y Google ocupado no consumen el enlace', async () => {
    for (const cambiar of [() => { cuenta.activo = false; }, () => { cuenta.dosFA = { activo: true, secreto: 'nuevo' }; }]) {
      cuenta = original(); const r = await emitir(); antesDeActualizar = cambiar;
      await assert.rejects(servicio.confirmar(req(tokenDe(r))), e => e.status === 409);
      assert.equal(cuenta.googleSub, undefined);
    }
    cuenta = original(); const r = await emitir(), solicitud = req(tokenDe(r)); solicitud.sub = 'ocupado';
    await assert.rejects(servicio.confirmar(solicitud), e => e.status === 409);
    assert.ok(cuenta.googleEnlaceSoporte); assert.equal(cuenta.googleSub, undefined);
  });
  console.log(`\n${n} pruebas de vinculación de soporte aprobadas.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
