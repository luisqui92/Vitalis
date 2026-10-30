// Sin red ni cuentas reales: RSA real; MongoDB/HTTP y Google simulados explícitamente.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const raiz = path.join(__dirname, '../..');
const { validarTokenGoogle } = require('../../services/googleIdentidad');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'prueba', alg: 'RS256', use: 'sig' };
const clientId = '123.apps.googleusercontent.com';
const ahora = Math.floor(Date.now() / 1000);
const base = { iss: 'https://accounts.google.com', aud: clientId, sub: '123456789', email: 'persona@example.com', email_verified: true, name: '<img src=x onerror=alert(1)>', nonce: 'nonce', iat: ahora, exp: ahora + 3600 };
function firmar(cambios = {}, cab = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'prueba', ...cab })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ ...base, ...cambios })).toString('base64url');
  return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
}
let n = 0;
async function prueba(nombre, fn) { await fn(); n++; console.log('✅ ' + nombre); }
function cargar(archivo, dependencias) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, archivo), 'utf8'), {
    module: mod, exports: mod.exports, require: nombre => {
      if (Object.hasOwn(dependencias, nombre)) return dependencias[nombre];
      if (['crypto', 'node:crypto'].includes(nombre)) return crypto;
      throw new Error('Dependencia no simulada: ' + nombre);
    }, Buffer, Date, URL, console, process: { env: { JWT_SECRET: 'clave-solo-pruebas' } },
  }, { filename: archivo });
  return mod.exports;
}
class ErrorHttp extends Error { constructor(status, message) { super(message); this.status = status; } }
const auth = cargar('services/auth.js', { bcryptjs: {
  hash: async x => 'HASH:' + x, compare: async (x, y) => 'HASH:' + x === y,
} });
const desafios = new Map();
let existeGoogle = false;
const Medico = { collection: { createIndex: async () => {} }, exists: async () => existeGoogle };
class Schema { constructor() {} }
const Desafio = { createIndexes: async () => {}, create: async d => desafios.set(d.nonce, d),
  findOneAndDelete: async q => { const d = desafios.get(q.nonce); if (!d || d.vence <= q.vence.$gt) return null; desafios.delete(q.nonce); return d; } };
const CONFIG = { GOOGLE_LOGIN_CLIENT_ID: clientId, APP_URL: 'https://app.example.com' };
const google = cargar('services/googleAcceso.js', {
  mongoose: { Schema, models: { DesafioGoogle: Desafio } }, '../config': { CONFIG }, '../db/models': { Medico },
  './auth': auth, './httpHelpers': { ErrorHttp }, './googleIdentidad': { verificarGoogle: async (t, c, nonce) => validarTokenGoogle(t, c, nonce, [jwk]) },
  './operadores': { esOperador: p => p === '59170000000' }, './telefono': { soloDigitos: p => String(p || '').replace(/\D/g, '') },
});
const headers = () => ({ origin: CONFIG.APP_URL, 'content-type': 'application/json' });
async function nuevo() {
  const req = { headers: headers(), body: {} };
  const res = { cookie: (k, v, opciones) => { req.headers.cookie = k + '=' + v; req.opcionesCookie = opciones; } };
  const d = await google.iniciar(req, res);
  req.body.credential = firmar({ nonce: d.nonce });
  return req;
}
const rutas = {};
let cuenta = null;
Medico.findOne = async () => cuenta;
let updates = 0;
Medico.updateOne = async () => { updates++; return { modifiedCount: 1 }; };
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const montar = cargar('routes/googleAuth.js', {
  '../db/models': { Medico }, '../services/googleAcceso': google,
  '../services/auth': { ...auth, requireAuth: () => (_q, _s, next) => next() },
  '../services/totp': { verificarCodigo: (_s, c) => c === '123456' },
  '../services/sesionMedico': { tokenDeMedico: m => 'sesion:' + m.phone, datosDeSesion: m => ({ phone: m.phone, rol: m.rol, estudiante: m.estudiante }) },
  '../services/auditoria': { registrar: () => {} }, '../services/ratelimit': { limitAuth: () => {}, limitMedico: () => {} },
  '../services/httpHelpers': { ErrorHttp, asyncRoute: wrap },
});
montar({ get: (p, ...h) => { rutas['GET ' + p] = h.at(-1); }, post: (p, ...h) => { rutas['POST ' + p] = h.at(-1); } });
async function pedir(ruta, req) {
  const res = { codigo: 200, set() { return this; }, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; return this; } };
  await rutas['POST /medico/google/' + ruta](req, res);
  return res;
}
(async () => {
  await prueba('acepta firma RSA de confianza y devuelve solo identidad verificada', () => {
    const p = validarTokenGoogle(firmar(), clientId, 'nonce', [jwk]);
    assert.equal(p.sub, base.sub); assert.equal(p.email, base.email); assert.equal(p.aud, undefined);
  });
  for (const [nombre, cambios, cab] of [
    ['audiencia ajena', { aud: 'otra' }], ['emisor ajeno', { iss: 'https://evil.example' }],
    ['nonce ajeno', { nonce: 'otro' }], ['correo no verificado', { email_verified: false }],
    ['correo verificado como string', { email_verified: 'true' }], ['token vencido', { exp: ahora - 1 }],
    ['token antiguo', { iat: ahora - 700 }], ['token futuro', { iat: ahora + 500 }],
    ['emisión no numérica', { iat: '1' }], ['expiración ausente', { exp: null }],
    ['azp ajeno', { azp: 'otro' }], ['identidad vacía', { sub: '' }],
    ['correo inválido', { email: 'no-correo' }], ['algoritmo none', {}, { alg: 'none' }],
    ['clave ajena', {}, { kid: 'desconocido' }],
  ]) await prueba('rechaza ' + nombre, () => assert.throws(() => validarTokenGoogle(firmar(cambios, cab), clientId, 'nonce', [jwk])));
  await prueba('rechaza firma manipulada', () => { const p = firmar().split('.'); p[2] = Buffer.alloc(256).toString('base64url'); assert.throws(() => validarTokenGoogle(p.join('.'), clientId, 'nonce', [jwk])); });
  await prueba('rechaza credenciales grandes y JWT mal formado', () => { for (const t of ['x'.repeat(16001), 'a.b', 'a.b.c.d', '{}']) assert.throws(() => validarTokenGoogle(t, clientId, 'nonce', [jwk])); });
  await prueba('deshabilitado si faltan ID de cliente u origen HTTPS', () => {
    const previo = CONFIG.APP_URL; CONFIG.APP_URL = 'http://app.example.com'; assert.equal(google.configuracion(), null); CONFIG.APP_URL = previo;
  });
  await prueba('rechaza CSRF y peticiones sin JSON', () => {
    assert.throws(() => google.mismoOrigen({ headers: { origin: 'https://evil.example', 'content-type': 'application/json' } }));
    assert.throws(() => google.mismoOrigen({ headers: { origin: CONFIG.APP_URL, 'content-type': 'text/plain' } }));
  });
  await prueba('nonce aleatorio ligado a cookie HttpOnly, Secure y SameSite', async () => {
    const a = await nuevo(), b = await nuevo(); assert.notEqual(a.headers.cookie, b.headers.cookie);
    assert.equal(a.opcionesCookie.httpOnly, true); assert.equal(a.opcionesCookie.secure, true); assert.equal(a.opcionesCookie.sameSite, 'lax');
  });
  await prueba('solo una petición concurrente consume el desafío', async () => {
    const req = await nuevo(); const r = await Promise.allSettled([google.comprobar(req), google.comprobar(req)]);
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  });
  await prueba('no acepta credencial de otro navegador', async () => {
    const a = await nuevo(), b = await nuevo(); a.headers.cookie = b.headers.cookie; await assert.rejects(() => google.comprobar(a));
  });
  await prueba('ticket de alta queda atado al navegador y no es sesión', async () => {
    const req = await nuevo(); const p = await google.comprobar(req); req.body.googleTicket = google.ticketRegistro(p);
    assert.equal(auth.verificarToken(req.body.googleTicket).rol, 'google_registro');
    const g = await google.identidadParaRegistro(req); assert.equal(g.googleSolo, true); assert.equal(g.telefonoVerificado, false);
    assert.equal(g.googleSub, base.sub); assert.ok(g.passwordHash.length > 40);
    req.headers.cookie = (await nuevo()).headers.cookie; await assert.rejects(() => google.identidadParaRegistro(req));
  });
  await prueba('no vincula ni registra usando un googleSub enviado sin ticket', async () => {
    assert.equal(await google.identidadParaRegistro({ body: { googleSub: base.sub } }), null);
  });
  await prueba('rechaza identidad ya registrada y teléfono reservado de operador', async () => {
    const req = await nuevo(); req.body.googleTicket = google.ticketRegistro(await google.comprobar(req));
    existeGoogle = true; await assert.rejects(() => google.identidadParaRegistro(req)); existeGoogle = false;
    req.body.phone = '+591 70000000'; await assert.rejects(() => google.identidadParaRegistro(req));
  });
  await prueba('Google desconocido lleva al formulario, sin sesión ni vínculo por teléfono', async () => {
    cuenta = null; const r = await pedir('entrar', await nuevo()); assert.equal(r.datos.registro, true); assert.equal(r.datos.token, undefined);
  });
  for (const estado of ['pendiente', 'rechazada', 'inactiva']) await prueba('Google respeta cuenta ' + estado, async () => {
    cuenta = { phone: '123', activo: estado !== 'inactiva', estadoCuenta: estado }; const r = await pedir('entrar', await nuevo());
    assert.equal(r.codigo, estado === 'inactiva' ? 403 : 200); assert.equal(r.datos.token, undefined);
    if (estado !== 'inactiva') { assert.equal(r.datos.solicitud, true); assert.equal(auth.verificarToken(r.datos.solicitudTicket).rol, 'google_solicitud'); }
  });
  await prueba('ticket de solicitud solo consulta su cuenta y exige el mismo navegador', async () => {
    cuenta = { phone: '123', estadoCuenta: 'pendiente', activo: false };
    const req = await nuevo(); const r = await pedir('entrar', req);
    req.body = { solicitudTicket: r.datos.solicitudTicket };
    assert.equal((await google.cuentaDeSolicitud(req)).phone, '123');
    req.headers.cookie = (await nuevo()).headers.cookie;
    await assert.rejects(() => google.cuentaDeSolicitud(req));
  });
  await prueba('Google mantiene el segundo factor de Symphomed', async () => {
    cuenta = { phone: '123', activo: true, estadoCuenta: 'aprobada', dosFA: { activo: true } };
    const r = await pedir('entrar', await nuevo()); assert.equal(r.datos.requiere2fa, true); assert.equal(r.datos.token, undefined);
    assert.equal(auth.verificarToken(r.datos.tempToken).rol, 'medico_2fa_pendiente');
  });
  await prueba('Google usa la misma cuenta, rol y perfil del servidor', async () => {
    cuenta = { phone: '123', activo: true, estadoCuenta: 'aprobada', rol: 'medico', estudiante: { carrera: 'odontologia' } };
    const req = await nuevo(); req.body.rol = 'admin'; const r = await pedir('entrar', req);
    assert.equal(r.datos.rol, 'medico'); assert.equal(r.datos.estudiante.carrera, 'odontologia');
  });
  await prueba('vincular exige contraseña y segundo factor actuales', async () => {
    cuenta = { _id: '1', phone: '123', activo: true, passwordHash: 'HASH:clave', dosFA: { activo: true, secreto: 's' } };
    const req = await nuevo(); req.adminUser = { usuario: '123' }; req.body.password = 'otra';
    assert.equal((await pedir('vincular', req)).codigo, 401); assert.equal(updates, 0);
    req.body.password = 'clave'; assert.equal((await pedir('vincular', req)).codigo, 401); assert.equal(updates, 0);
    req.body.codigo = '123456'; assert.equal((await pedir('vincular', req)).codigo, 200); assert.equal(updates, 1);
  });
  await prueba('conflicto de identidad al vincular devuelve 409', async () => {
    const anterior = Medico.updateOne; Medico.updateOne = async () => { throw Object.assign(new Error('duplicada'), { code: 11000 }); };
    const req = await nuevo(); req.adminUser = { usuario: '123' }; Object.assign(req.body, { password: 'clave', codigo: '123456' });
    assert.equal((await pedir('vincular', req)).codigo, 409); Medico.updateOne = anterior;
  });
  // Las rutas reales de alta con almacenamiento simulado: campos, permisos y rollback.
  const altas = {};
  const appAltas = Object.fromEntries(['get', 'post', 'patch'].map(m => [m, (p, ...h) => { altas[p] = h.at(-1); }]));
  let creado, telefonoExiste = false, fallaCrear = false, codigoUsado = false, cuentaAutorizada = null;
  Medico.create = async d => { if (fallaCrear) throw new Error('fallo simulado'); creado = d; return d; };
  const telefonos = { soloDigitos: p => String(p || '').replace(/\D/g, ''), buscarPorTelefono: async () => telefonoExiste ? { _id: 'vieja' } : null };
  const sesion = { tokenDeMedico: () => 'sesion', datosDeSesion: m => ({ phone: m.phone }) };
  const authAlta = { ...auth, requireAuth: () => () => {} };
  cargar('routes/medicoAuth.js', {
    qrcode: {}, '../db/models': { Medico, AuditLog: {} }, '../services/auth': authAlta,
    '../services/totp': { verificarCodigo: (_s, c) => c === '123456' }, '../services/auditoria': { registrar: () => {} },
    '../services/operadores': { todosLosOperadores: () => [] }, '../services/push': {}, '../config': { log: { info() {}, warn() {} } },
    '../services/ratelimit': {}, '../services/httpHelpers': { ErrorHttp, asyncRoute: wrap }, '../services/telefono': telefonos,
    '../services/sesionMedico': sesion, '../services/googleAcceso': google,
    '../services/googleAltaUnica': { intentar: async () => cuentaAutorizada },
    '../services/perfilesCuenta': cargar('services/perfilesCuenta.js', { './httpHelpers': { ErrorHttp } }),
  })(appAltas);
  cargar('modulos/estudiantes/rutas/cuenta.js', {
    '../../../db/models': { Medico }, '../modelos': { CodigoEstudiante: {
      findOneAndUpdate: async q => { if (codigoUsado || q.codigo !== 'EST-PRUEBA') return null; codigoUsado = true;
        return { _id: 'codigo', codigo: q.codigo, carrera: 'odontologia', nivel: 'estudiante', meses: 1, horasMes: 3, precioCentavos: 10000, moneda: 'BOB' }; },
      updateOne: async () => { codigoUsado = false; },
    } }, '../../../services/auth': authAlta, '../../../services/auditoria': { registrar: () => {} },
    '../../../services/ratelimit': {}, '../../../services/httpHelpers': { ErrorHttp, asyncRoute: wrap },
    '../../../services/telefono': telefonos, '../../../services/zonaHoraria': { zonaPorMoneda: () => 'America/La_Paz' },
    '../../../services/sesionMedico': sesion, '../../../config': { log: { info() {} } },
    '../prueba': { configuracion:()=>({disponible:true}), registrar: async () => { throw new ErrorHttp(503, 'Prueba cubierta en probar_registro_abierto'); } },
    '../cuenta': { normalizarCodigo: c => c || '', estadoDe: () => {} },
    '../carreras': require('../../modulos/estudiantes/carreras'), '../../../services/googleAcceso': google,
  }).registro(appAltas);
  async function alta(ruta, body = {}) {
    const req = await nuevo(); req.body.googleTicket = google.ticketRegistro(await google.comprobar(req));
    Object.assign(req.body, { perfilSolicitado: ruta.endsWith('estudiante') ? 'estudiante' : 'profesional', pais: 'BO', profesion: 'Odontología', tipoEspecialidad: 'odontologia', universidad: 'Universidad de prueba', periodo: '4º año', nombre: 'Prueba', phone: '+59171111111', matricula: '123', rol: 'admin', carrera: 'odontologia', nivel: 'estudiante' }, body);
    const res = { codigo: 200, set() { return this; }, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
    await altas[ruta](req, res); return res;
  }
  await prueba('alta profesional con Google queda pendiente, sin contraseña elegida ni rol administrativo', async () => {
    const r = await alta('/medico/registro'); assert.equal(r.codigo, 200); assert.equal(r.datos.pendiente, true);
    assert.equal(creado.activo, false); assert.equal(creado.estadoCuenta, 'pendiente'); assert.equal(creado.googleSub, base.sub);
    assert.equal(creado.rol, undefined); assert.equal(creado.phone, '59171111111'); assert.equal(creado.telefonoVerificado, false);
  });
  await prueba('alta no se apropia de un teléfono de cuenta existente', async () => {
    telefonoExiste = true; assert.equal((await alta('/medico/registro')).codigo, 409);
    assert.equal((await alta('/medico/registro-estudiante', { codigo: 'EST-PRUEBA' })).codigo, 409); telefonoExiste = false;
  });
  await prueba('Google no permite alta profesional sin matrícula', async () => {
    assert.equal((await alta('/medico/registro', { matricula: '' })).codigo, 400);
  });
  await prueba('excepción autorizada entra en la cuenta original sin crear otra ni cambiar sus datos', async () => {
    const antes = creado;
    cuentaAutorizada = { _id: 'original', phone: '++55 11 91234 5678', nombre: 'Cuenta anterior', rol: 'medico' };
    const r = await alta('/medico/registro', { matricula: '', pais: '', nombre: 'Nombre nuevo', rol: 'admin' });
    assert.equal(r.codigo, 200); assert.equal(r.datos.phone, cuentaAutorizada.phone); assert.equal(r.datos.token, 'sesion');
    assert.equal(creado, antes); cuentaAutorizada = null;
  });
  await prueba('excepción de vinculación no saltea el segundo factor del inicio de sesión', async () => {
    cuentaAutorizada = { phone: '++55 11 91234 5678', dosFA: { activo: true } };
    const r = await alta('/medico/registro', { matricula: '' });
    assert.equal(r.codigo, 200); assert.equal(r.datos.requiere2fa, true); assert.equal(r.datos.token, undefined);
    const temporal = auth.verificarToken(r.datos.tempToken);
    assert.equal(temporal.rol, 'medico_2fa_pendiente'); assert.equal(temporal.usuario, cuentaAutorizada.phone);
    cuentaAutorizada = null;
  });
  await prueba('si se proporciona una invitación, Google rechaza códigos inválidos', async () => {
    assert.equal((await alta('/medico/registro-estudiante', { codigo: 'INVALIDO' })).codigo, 400);
  });
  await prueba('el código determina carrera, nivel y acceso; la selección debe coincidir', async () => {
    const r = await alta('/medico/registro-estudiante', { codigo: 'EST-PRUEBA' }); assert.equal(r.codigo, 200);
    assert.equal(creado.estudiante.carrera, 'odontologia'); assert.equal(creado.estudiante.nivel, 'estudiante');
    assert.equal(creado.googleSolo, true); assert.equal(creado.rol, undefined); assert.equal(creado.activo, true);
    assert.equal((await alta('/medico/registro-estudiante', { codigo: 'EST-PRUEBA' })).codigo, 400);
  });
  await prueba('no se puede enviar perfil vacío ni cambiar la carrera o nivel del código', async () => {
    assert.equal((await alta('/medico/registro', { perfilSolicitado: '' })).codigo, 400);
    codigoUsado = false;
    assert.equal((await alta('/medico/registro-estudiante', { codigo: 'EST-PRUEBA', carrera: 'medicina' })).codigo, 400);
    assert.equal(codigoUsado, false);
    assert.equal((await alta('/medico/registro-estudiante', { codigo: 'EST-PRUEBA', nivel: 'residente' })).codigo, 400);
    assert.equal(codigoUsado, false);
  });
  await prueba('si falla la creación, el código de estudiante vuelve a estar disponible', async () => {
    codigoUsado = false; fallaCrear = true;
    assert.equal((await alta('/medico/registro-estudiante', { codigo: 'EST-PRUEBA' })).codigo, 500);
    assert.equal(codigoUsado, false); fallaCrear = false;
  });
  await prueba('cuenta antigua sigue registrándose con contraseña, sin identidad Google', async () => {
    const req = { body: { pais: 'BO', profesion: 'Medicina', tipoEspecialidad: 'medicina_general', nombre: 'Antigua', phone: '59172222222', password: 'clave-segura', matricula: '123' } };
    const res = { codigo: 200, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
    await altas['/medico/registro'](req, res); assert.equal(res.codigo, 200); assert.equal(creado.googleSub, undefined);
    assert.equal(creado.passwordHash, 'HASH:clave-segura');
  });
  await prueba('cuenta Google sin contraseña confirma TOTP para desactivar 2FA', async () => {
    cuenta = { phone: '123', googleSolo: true, dosFA: { activo: true, secreto: 's' }, save: async () => {} };
    const req = { adminUser: { usuario: '123' }, body: { codigo: '000000' } };
    const res = { codigo: 200, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
    await altas['/medico/2fa/desactivar'](req, res); assert.equal(res.codigo, 401); assert.equal(cuenta.dosFA.activo, true);
    req.body.codigo = '123456'; res.codigo = 200; await altas['/medico/2fa/desactivar'](req, res);
    assert.equal(res.codigo, 200); assert.equal(cuenta.dosFA.activo, false);
  });
  // Recuperación: tampoco un enlace previamente emitido puede sustituir un teléfono verificado.
  let envios = 0, guardados = 0;
  const solicitud = { _id: 'solicitud', tipo: 'medico', telefono: '123', nombre: 'Nombre', tokenExpira: new Date(Date.now() + 60000), save: async () => { guardados++; } };
  const recuperacion = {};
  cargar('routes/reseteoClave.js', {
    '../db/models': { Medico, Socio: {}, SolicitudReseteo: { findOne: async () => solicitud } },
    '../services/auth': authAlta, '../services/ratelimit': { rateLimit: () => () => {}, rateLimitPorClave: () => () => {} },
    '../services/httpHelpers': { ErrorHttp, asyncRoute: wrap }, '../services/auditoria': { registrar: () => {} },
    '../services/metaWhatsapp': { enviarTextoOPlantilla: async () => { envios++; }, PLANTILLAS: {}, normalizarDestino: () => '123' },
    '../services/operadores': { esOperador: () => true }, '../config': { CONFIG, log: {} },
    '../services/idiomas': { esCuentaBrasil: () => false }, '../services/telefono': telefonos,
  })({ get: (p, ...h) => { recuperacion['GET ' + p] = h.at(-1); }, post: (p, ...h) => { recuperacion['POST ' + p] = h.at(-1); } });
  for (const ruta of ['/medico/operador/reseteos/:id/aprobar', '/restablecer-clave/:token']) {
    await prueba('recuperación Google bloqueada sin verificar teléfono: ' + ruta, async () => {
      cuenta = { phone: '123', googleSolo: true, telefonoVerificado: false };
      const req = { adminUser: { usuario: 'operador' }, params: { id: 'solicitud', token: 't'.repeat(24) }, body: { password: 'clave-nueva' } };
      const res = { codigo: 200, status(c) { this.codigo = c; return this; }, json(d) { this.datos = d; } };
      await recuperacion['POST ' + ruta](req, res); assert.equal(res.codigo, 409); assert.equal(envios, 0); assert.equal(guardados, 0);
    });
  }
  await prueba('diccionarios ES/PT contienen todas las claves de Google', () => {
    const ctx = { I18N: { es: {}, pt: {} } }; vm.createContext(ctx);
    for (const i of ['es', 'pt']) vm.runInContext(fs.readFileSync(path.join(raiz, `public/i18n/${i}/accesoGoogle.js`), 'utf8'), ctx);
    assert.deepEqual(Object.keys(ctx.I18N.es).sort(), Object.keys(ctx.I18N.pt).sort());
    for (const archivo of ['public/js/accesoGoogle.js', 'public/js/estudiantes.js', 'public/js/seguridad.js']) {
      for (const m of fs.readFileSync(path.join(raiz, archivo), 'utf8').matchAll(/t\("(google\.[^"]+)"/g)) assert.ok(ctx.I18N.es[m[1]], m[1]);
    }
  });
  console.log(`\n${n} pruebas aprobadas. RSA real; persistencia, red y middleware de sesión simulados.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
