// Revisión humana de Google: rutas y servicio reales, persistencia y OAuth simulados.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const raiz = path.join(__dirname, '../..');
function cargar(archivo, deps) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, archivo), 'utf8'), {
    module, exports: module.exports, require: n => {
      if (n === 'crypto') return crypto;
      if (Object.hasOwn(deps, n)) return deps[n];
      throw new Error('Dependencia no simulada: ' + n);
    }, Date, URL, console,
  });
  return module.exports;
}
const helpers = cargar('services/httpHelpers.js', { '../config': { log: { error() {} } } });
const get = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
function set(o, k, valor) {
  const partes = k.split('.'); let destino = o;
  for (const p of partes.slice(0, -1)) destino = destino[p] ||= {};
  destino[partes.at(-1)] = structuredClone(valor);
}
function quitar(o, k) {
  const partes = k.split('.'); const destino = get(o, partes.slice(0, -1).join('.'));
  if (partes.length === 1) delete o[k]; else if (destino) delete destino[partes.at(-1)];
}
function coincide(o, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === 'googleRevision.solicitudes.estado') return (o.googleRevision?.solicitudes || []).some(s => s.estado === v);
    const actual = get(o, k);
    if (v && typeof v.test === 'function') return v.test(actual);
    if (v && typeof v === 'object' && '$elemMatch' in v) return actual?.some(s => coincide(s, v.$elemMatch));
    if (v && typeof v === 'object' && '$exists' in v) return (actual !== undefined) === v.$exists;
    if (v && typeof v === 'object' && '$gt' in v) return actual > v.$gt;
    return actual === v;
  });
}
const clienteId = '111111111111111111111111', operadorId = '222222222222222222222222';
let cuentas, auditoria, antesDeActualizar;
const cliente = () => cuentas.find(c => c._id === clienteId);
function consulta(fn) {
  return { limit() { return this; }, select() { return this; }, lean: async () => structuredClone(fn()) };
}
const Medico = {
  find: q => consulta(() => cuentas.filter(c => coincide(c, q))),
  findOne: q => consulta(() => cuentas.find(c => coincide(c, q))),
  findById: id => consulta(() => cuentas.find(c => c._id === id)),
  updateOne: async (q, u) => {
    if (antesDeActualizar) { const fn = antesDeActualizar; antesDeActualizar = null; fn(); }
    const m = cuentas.find(c => coincide(c, q));
    if (!m) return { modifiedCount: 0 };
    if (u.$set?.googleSub && cuentas.some(c => c !== m && c.googleSub === u.$set.googleSub)) throw Object.assign(new Error('Duplicado'), { code: 11000 });
    const posicion = q['googleRevision.solicitudes']?.$elemMatch;
    const indice = posicion ? m.googleRevision.solicitudes.findIndex(s => coincide(s, posicion)) : -1;
    for (const [k, v] of Object.entries(u.$set || {})) set(m, k.replace('.$.', '.' + indice + '.'), v);
    for (const [k, v] of Object.entries(u.$push || {})) { if (!get(m, k)) set(m, k, []); get(m, k).push(structuredClone(v)); }
    for (const k of Object.keys(u.$unset || {})) quitar(m, k);
    return { modifiedCount: 1 };
  },
};
const googleReal = cargar('services/googleAcceso.js', {
  mongoose: { Schema: class {}, models: { DesafioGoogle: {} } }, '../config': { CONFIG: {} },
  '../db/models': { Medico }, './auth': {}, './httpHelpers': helpers,
  './googleIdentidad': {}, './operadores': {}, './telefono': {},
});
const soporte = cargar('services/googleVinculacion.js', { '../db/models': {}, './googleAcceso': googleReal,
  './totp': {}, './httpHelpers': helpers });
const servicio = cargar('services/googleRevision.js', {
  '../db/models': { Medico, AuditLog: { create: async d => auditoria.push(d) } },
  './googleAcceso': googleReal, './googleVinculacion': soporte,
  './telefono': { soloDigitos: x => String(x || '').replace(/\D/g, '') }, './httpHelpers': helpers,
});
const identidad = (sub = 'google-cliente', email = 'cliente@gmail.com') => ({ googleSub: sub, googleEmail: email, passwordHash: 'NO-COPIAR', googleSolo: true });
const habilitar = () => servicio.habilitar('5511956544830', 'ssh:operador');
const solicitar = id => servicio.solicitar('+55 11 95654-4830', id || identidad());
function decision(aprobar = true, indice = 0) {
  const s = cliente().googleRevision.solicitudes[indice];
  return { cuentaId: clienteId, solicitudId: s.id, aprobar, email: s.email, actor: 'operador' };
}
let n = 0;
async function test(nombre, fn) {
  cuentas = [{ _id: clienteId, phone: '++55 11 95654 4830', nombre: 'Dr. Prueba', activo: true,
    estadoCuenta: 'aprobada', rol: 'medico', passwordHash: 'hash-anterior', suscripcion: { plan: 'anual' },
    dosFA: { activo: true, secreto: 'segundo-factor' } },
  { _id: operadorId, phone: 'operador', activo: true, dosFA: { activo: true } }];
  auditoria = []; antesDeActualizar = null;
  await fn(); n++; console.log('✅ ' + nombre);
}
const rutas = {};
const limitador = (_req, _res, next) => next();
const autenticacion = (req, res, next) => req.adminUser?.usuario ? next() : res.status(401).json({ error: 'Falta sesión' });
cargar('routes/googleRevision.js', {
  '../services/googleRevision': servicio, '../services/googleAcceso': { identidadParaRegistro: async req => {
    if (req.body?.googleTicket !== 'ticket-verificado-con-cookie') throw new helpers.ErrorHttp(401, 'Google no verificado');
    return identidad();
  } }, '../db/models': { Medico }, '../services/auth': { requireAuth: () => autenticacion },
  '../services/operadores': { esOperador: p => p === 'operador' },
  '../services/ratelimit': { limitRegistro: limitador, rateLimitPorClave: () => limitador, claveDeMedico() {} },
  '../services/httpHelpers': helpers, '../services/auditoria': { registrar: d => auditoria.push(d) },
})({ get: (p, ...h) => rutas['GET ' + p] = h, post: (p, ...h) => rutas['POST ' + p] = h });
async function pedir(ruta, req = {}) {
  const h = rutas[ruta]; assert.ok(h);
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(d) { this.body = d; return this; } };
  // Ejecuta todos los middleware reales, incluido el portero con next().
  async function paso(i) {
    if (!h[i]) return;
    let siguiente;
    await h[i](req, res, () => { siguiente = paso(i + 1); });
    if (siguiente) await siguiente;
  }
  await paso(0); return res;
}
(async () => {
  await test('habilitar no exige correo, limita a una cuenta y desactiva excepciones anteriores', async () => {
    cliente().googleAltaUnica = { email: 'anterior@gmail.com' }; cliente().googleEnlaceSoporte = { hash: 'viejo' };
    await habilitar();
    assert.equal(cliente().googleRevision.telefono, '5511956544830');
    assert.equal(cliente().googleAltaUnica, undefined); assert.equal(cliente().googleEnlaceSoporte, undefined);
    assert.equal(cuentas[1].googleRevision, undefined); assert.equal(cliente().googleSub, undefined);
    assert.equal(await servicio.solicitar('59170000000', identidad()), false);
  });
  await test('un teléfono ambiguo o una cuenta ya vinculada no se habilitan', async () => {
    cuentas.push({ ...cliente(), _id: '333333333333333333333333', phone: '5511956544830' });
    await assert.rejects(habilitar(), /una sola/); cuentas.pop();
    cliente().googleSub = 'ya-existe'; await assert.rejects(habilitar(), /ya fue vinculada/);
  });
  await test('solicitud repetida es idempotente y nunca vincula ni devuelve sesión', async () => {
    await habilitar(); await solicitar(); await solicitar();
    assert.equal(cliente().googleRevision.solicitudes.length, 1);
    assert.equal(cliente().googleRevision.solicitudes[0].email, 'cliente@gmail.com');
    assert.equal(cliente().googleSub, undefined); assert.equal(cliente().sesionesDesde, undefined);
  });
  await test('cada Google tiene su solicitud y un atacante no reemplaza la del cliente', async () => {
    await habilitar(); await solicitar(); await solicitar(identidad('otra', 'otra@gmail.com'));
    const pendientes = await servicio.pendientes();
    assert.equal(pendientes.length, 2); assert.equal(pendientes[0].email, 'cliente@gmail.com');
    assert.equal(pendientes[0].googleSub, undefined); assert.equal(pendientes[0].passwordHash, undefined);
    assert.equal(pendientes[0].nombre, 'Dr. Prueba');
  });
  await test('aprobar vincula únicamente la identidad revisada y conserva teléfono, datos y 2FA', async () => {
    await habilitar(); await solicitar(); const previo = structuredClone(cliente());
    await servicio.decidir(decision());
    const m = cliente(); assert.equal(m.googleSub, 'google-cliente'); assert.equal(m.googleEmail, 'cliente@gmail.com');
    for (const k of ['phone', 'nombre', 'passwordHash', 'rol', 'suscripcion', 'dosFA']) assert.deepEqual(m[k], previo[k]);
    assert.ok(m.googleRevision.usadaEn); assert.equal(m.googleRevision.habilitada, false);
    assert.equal(m.googleRevision.solicitudes[0].decididaPor, 'operador');
    assert.equal((await servicio.pendientes()).length, 0);
    await assert.rejects(habilitar(), /ya fue vinculada/);
    await assert.rejects(servicio.decidir(decision()), e => e.status === 409);
  });
  await test('rechazar no concede acceso; otra solicitud legítima permanece revisable', async () => {
    await habilitar(); await solicitar(identidad('intruso', 'otra@gmail.com')); await solicitar();
    await servicio.decidir(decision(false, 0));
    assert.equal(cliente().googleSub, undefined); assert.equal((await servicio.pendientes()).length, 1);
    await assert.rejects(solicitar(identidad('intruso', 'otra@gmail.com')), e => e.status === 409);
    await servicio.decidir(decision(true, 1)); assert.equal(cliente().googleSub, 'google-cliente');
  });
  await test('aprobar y rechazar concurrentemente solo permiten una decisión', async () => {
    await habilitar(); await solicitar();
    const resultados = await Promise.allSettled([servicio.decidir(decision()), servicio.decidir(decision(false))]);
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(cliente().googleRevision.solicitudes[0].estado, 'aprobada');
  });
  await test('cuenta desactivada, correo cambiado o Google ocupado no se aprueban', async () => {
    await habilitar(); await solicitar();
    await assert.rejects(servicio.decidir({ ...decision(), email: 'otro@gmail.com' }), e => e.status === 409);
    cliente().activo = false; await assert.rejects(servicio.decidir(decision()), e => e.status === 403);
    cliente().activo = true; cuentas[1].googleSub = 'google-cliente';
    await assert.rejects(servicio.decidir(decision()), e => e.status === 409);
    assert.equal(cliente().googleSub, undefined); assert.equal(cliente().googleRevision.solicitudes[0].estado, 'pendiente');
  });
  await test('caducidad y cambios concurrentes de permisos o solicitud impiden aprobar', async () => {
    await habilitar(); await solicitar(); cliente().googleRevision.vence = new Date(0);
    await assert.rejects(servicio.decidir(decision()), e => e.status === 409);
    cliente().googleRevision.vence = new Date(Date.now() + 10000);
    antesDeActualizar = () => { cliente().rol = 'admin'; };
    await assert.rejects(servicio.decidir(decision()), e => e.status === 409);
    assert.equal(cliente().googleSub, undefined);
  });
  await test('límite de solicitudes no permite crecimiento ilimitado', async () => {
    await habilitar(); cliente().googleRevision.solicitudes = Array.from({ length: 50 }, (_, i) => ({ googleSub: 'sub' + i, estado: 'rechazada' }));
    await assert.rejects(solicitar(), e => e.status === 429); assert.equal(cliente().googleRevision.solicitudes.length, 50);
  });
  await test('ruta pública exige Google verificado e ignora correo o permisos del formulario', async () => {
    await habilitar();
    const ruta = 'POST /medico/google/solicitar-vinculacion';
    assert.equal((await pedir(ruta, { body: { phone: '5511956544830' } })).code, 401);
    const r = await pedir(ruta, { body: { phone: '5511956544830', googleTicket: 'ticket-verificado-con-cookie', googleEmail: 'inventado@gmail.com', rol: 'admin' } });
    assert.equal(r.code, 200); assert.equal(r.body.vinculacionPendiente, true); assert.equal(r.body.token, undefined);
    assert.equal(cliente().googleRevision.solicitudes[0].email, 'cliente@gmail.com');
  });
  await test('panel exige sesión, operador autorizado y segundo factor', async () => {
    await habilitar(); await solicitar();
    const ruta = 'GET /medico/operador/vinculaciones-google';
    assert.equal((await pedir(ruta)).code, 401);
    assert.equal((await pedir(ruta, { adminUser: { usuario: cliente().phone } })).code, 403);
    cuentas[1].dosFA.activo = false;
    assert.equal((await pedir(ruta, { adminUser: { usuario: 'operador' } })).code, 403);
    cuentas[1].dosFA.activo = true;
    const r = await pedir(ruta, { adminUser: { usuario: 'operador' } });
    assert.equal(r.code, 200); assert.equal(r.body.solicitudes.length, 1);
  });
  await test('aprobación HTTP requiere confirmación y deja auditoría sin crear sesión del cliente', async () => {
    await habilitar(); await solicitar(); const d = decision();
    const ruta = 'POST /medico/operador/vinculaciones-google/:cuentaId/:solicitudId';
    const req = { adminUser: { usuario: 'operador' }, params: { cuentaId: d.cuentaId, solicitudId: d.solicitudId }, body: { accion: 'aprobar', email: d.email } };
    assert.equal((await pedir(ruta, req)).code, 400);
    req.body.confirmoIdentidad = true; const r = await pedir(ruta, req);
    assert.equal(r.code, 200); assert.equal(r.body.token, undefined); assert.equal(cliente().googleSub, 'google-cliente');
    assert.equal(auditoria.at(-1).accion, 'aprobar_vinculacion_google');
  });
  await test('panel escapa datos, pide confirmación y manda la solicitud exacta a aprobar', async () => {
    const nodos = new Map();
    const nodo = id => {
      if (!nodos.has(id)) nodos.set(id, { innerHTML: '', textContent: '', isConnected: true, disabled: false,
        querySelector: selector => nodo(id + selector), querySelectorAll: () => [nodo(id + '[data-google-aprobar="0"]'), nodo(id + '[data-google-rechazar="0"]')] });
      return nodos.get(id);
    };
    const llamadas = [], confirmaciones = [];
    const fila = { cuentaId: clienteId, solicitudId: crypto.randomUUID(), nombre: '<img src=x>', phone: '++55 11 95654 4830', email: 'cliente@gmail.com' };
    let aceptar = false, aprobada = false;
    const s = { localStorage: { getItem: () => null }, document: { getElementById: nodo }, I18N: { es: {} },
      esc: x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      confirm: texto => { confirmaciones.push(texto); return aceptar; },
      api: async (url, opciones) => { llamadas.push({ url, opciones });
        if (opciones?.method === 'POST') { aprobada = true; return { ok: true }; }
        return { solicitudes: aprobada ? [] : [fila] };
      },
    };
    vm.createContext(s);
    vm.runInContext(fs.readFileSync(path.join(raiz, 'public/i18n/es/operador.js'), 'utf8'), s);
    s.t = (k, valores = {}) => (s.I18N.es[k] || k).replace(/\{(\w+)\}/g, (_, v) => valores[v] ?? '');
    vm.runInContext(fs.readFileSync(path.join(raiz, 'public/js/operador.js'), 'utf8'), s);
    await s.pintarVinculacionesGoogle();
    assert.ok(nodo('opGoogle').innerHTML.includes('&lt;img'));
    assert.ok(!nodo('opGoogle').innerHTML.includes('<img'));
    const aprobar = nodo('opGoogleFila0').querySelector('[data-google-aprobar="0"]');
    await aprobar.onclick(); assert.equal(llamadas.filter(x => x.opciones?.method === 'POST').length, 0);
    aceptar = true; await aprobar.onclick();
    const envio = llamadas.find(x => x.opciones?.method === 'POST');
    assert.equal(envio.url, `/medico/operador/vinculaciones-google/${fila.cuentaId}/${fila.solicitudId}`);
    assert.deepEqual(JSON.parse(envio.opciones.body), { accion: 'aprobar', email: fila.email, confirmoIdentidad: true });
    assert.ok(confirmaciones.at(-1).includes(fila.email));
    assert.ok(nodo('opGoogle').innerHTML.includes('Google vinculado'));
    assert.ok(nodo('opGoogle').innerHTML.includes('No hay vinculaciones pendientes'));
  });
  console.log(`\n${n} pruebas de revisión humana aprobadas (sin red ni MongoDB real).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
