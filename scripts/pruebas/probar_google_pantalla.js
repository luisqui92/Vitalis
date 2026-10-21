// Interacciones con DOM y SDK controlados; no sustituye la prueba OAuth en navegador real.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const raiz = path.join(__dirname, '../..');
let n = 0;
async function prueba(t, f) { await f(); n++; console.log('✅ ' + t); }
function pantalla({ habilitado = true, respuesta = {}, idioma = 'es', perfilExtra = false } = {}) {
  const nodos = new Map();
  const nodo = id => {
    if (!nodos.has(id)) nodos.set(id, { value: '', innerHTML: '', textContent: '', isConnected: true, clientWidth: 320, dataset: {}, querySelector: () => null });
    return nodos.get(id);
  };
  const llamadas = [];
  let sdk, login, dosfa, scripts = 0;
  const caja = { innerHTML: '' };
  const s = {
    window: { google: { accounts: { id: { initialize: o => { sdk = o; }, renderButton: () => {} } } } },
    document: { getElementById: nodo, querySelectorAll: () => [], head: { appendChild: () => { scripts++; } } },
    app: caja, MEDICO_IDIOMA: idioma, AREAS: ['medicina_general', 'odontologia'],
    I18N: { es: {}, pt: {} },
    esc: x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    detenerPolling() {}, renderLogin() {}, renderLogin2FA: t => { dosfa = t; }, completarLogin: d => { login = d; },
    Extensiones: { filtrar: (_p, lista) => perfilExtra ? [...lista, {
      id: 'estudiante', titulo: 'Estudiante', ruta: '/medico/registro-estudiante', html: '<input id="gCodigo">', datos: () => ({ codigo: nodo('gCodigo').value }),
    }] : lista },
    api: async (url, opciones) => {
      llamadas.push({ url, opciones });
      if (url.endsWith('/config')) return { disponible: habilitado };
      if (url.endsWith('/iniciar')) return { clientId: 'cliente', nonce: 'desafio-servidor' };
      return respuesta;
    },
    console, setTimeout, clearTimeout,
  };
  vm.createContext(s);
  for (const i of ['es', 'pt']) for (const archivo of ['accesoGoogle', 'perfilAcceso']) vm.runInContext(fs.readFileSync(path.join(raiz, `public/i18n/${i}/${archivo}.js`), 'utf8'), s);
  s.t = k => s.I18N[idioma][k] || k;
  for (const archivo of ['accesoGoogle', 'perfilAcceso']) vm.runInContext(fs.readFileSync(path.join(raiz, `public/js/${archivo}.js`), 'utf8'), s);
  return { s, nodo, llamadas, caja, sdk: () => sdk, login: () => login, dosfa: () => dosfa, scripts: () => scripts };
}
(async () => {
  await prueba('sin configuración no se carga Google ni se reemplaza el acceso existente', async () => {
    const p = pantalla({ habilitado: false }); await p.s.pintarBotonGoogle(); assert.equal(p.sdk(), undefined); assert.equal(p.scripts(), 0);
    assert.equal(p.llamadas.length, 1);
  });
  await prueba('el botón oficial recibe nonce del servidor y no inicia sesión automáticamente', async () => {
    const p = pantalla(); await p.s.pintarBotonGoogle(); assert.equal(p.sdk().nonce, 'desafio-servidor'); assert.equal(p.sdk().auto_select, false);
  });
  await prueba('una cuenta con 2FA pasa a la segunda pantalla, sin abrir sesión', async () => {
    const p = pantalla({ respuesta: { requiere2fa: true, tempToken: 'paso2' } }); await p.s.pintarBotonGoogle(); await p.sdk().callback({ credential: 'id-token' });
    assert.equal(p.dosfa(), 'paso2'); assert.equal(p.login(), undefined);
  });
  await prueba('cuenta vinculada entra con los datos devueltos por el servidor', async () => {
    const p = pantalla({ respuesta: { token: 'sesion', phone: '123' } }); await p.s.pintarBotonGoogle(); await p.sdk().callback({ credential: 'id-token' });
    assert.equal(p.login().token, 'sesion');
  });
  await prueba('navegar a otra pantalla invalida la respuesta del botón anterior', async () => {
    const p = pantalla({ respuesta: { token: 'sesion' } }); await p.s.pintarBotonGoogle(); p.nodo('googleEntrada').isConnected = false;
    await p.sdk().callback({ credential: 'id-token' }); assert.equal(p.login(), undefined);
    assert.equal(p.llamadas.filter(c => c.url.endsWith('/entrar')).length, 0);
  });
  await prueba('nombre y correo de Google se muestran escapados, sin contraseña en el formulario', () => {
    const p = pantalla(); p.s.renderPerfilGoogle({ nombre: '"><img src=x>', email: '<script>alert(1)</script>', googleTicket: 'ticket' });
    assert.ok(!p.caja.innerHTML.includes('<script>')); assert.ok(!p.caja.innerHTML.includes('<img'));
    assert.ok(!p.caja.innerHTML.includes('type="password"')); assert.ok(p.caja.innerHTML.includes('todavía no está verificado'));
  });
  await prueba('formulario profesional envía ticket y matrícula a su ruta, sin asignar permisos', async () => {
    const p = pantalla({ respuesta: { pendiente: true } }); p.s.renderPerfilGoogle({ nombre: 'Nombre', email: 'a@example.com', googleTicket: 'ticket' });
    for (const [id, v] of Object.entries({ gNombre: 'Nombre', gPhone: '+59171111111', gTipo: 'profesional', gArea: 'odontologia', gMatricula: '123', gPais: 'BO', gProfesion: 'Odontología', gEtapa: 'profesional' })) p.nodo(id).value = v;
    await p.nodo('gCrear').onclick(); const req = p.llamadas.at(-1); const b = JSON.parse(req.opciones.body);
    assert.equal(req.url, '/medico/registro'); assert.equal(b.googleTicket, 'ticket'); assert.equal(b.matricula, '123');
    assert.equal(b.password, undefined); assert.equal(b.rol, undefined); assert.equal(p.login(), undefined);
  });
  await prueba('el perfil del módulo manda el código y abre la sesión al terminar', async () => {
    const p = pantalla({ perfilExtra: true, respuesta: { token: 'estudiante' } }); p.s.renderPerfilGoogle({ nombre: 'Nombre', email: 'a@example.com', googleTicket: 'ticket' });
    for (const [id, v] of Object.entries({ gNombre: 'Nombre', gPhone: '+59171111111', gTipo: 'estudiante', gCodigo: 'EST-ABCD23' })) p.nodo(id).value = v;
    await p.nodo('gCrear').onclick(); const req = p.llamadas.at(-1); const b = JSON.parse(req.opciones.body);
    assert.equal(req.url, '/medico/registro-estudiante'); assert.equal(b.codigo, 'EST-ABCD23'); assert.equal(b.matricula, undefined); assert.equal(p.login().token, 'estudiante');
  });
  await prueba('el formulario requiere nombre y teléfono antes de enviarse', async () => {
    const p = pantalla(); p.s.renderPerfilGoogle({ email: 'a@example.com', googleTicket: 'ticket' }); await p.nodo('gCrear').onclick();
    assert.equal(p.llamadas.length, 0); assert.ok(p.nodo('gError').textContent);
  });
  await prueba('pendiente muestra estado y motivo escapado sin abrir sesión clínica', async () => {
    const p = pantalla({ respuesta: { solicitud: true, estado: 'rechazada', solicitudTicket: 'limitado', telefonoVerificado: true, motivo: '<img src=x>', datos: {} } });
    await p.s.pintarBotonGoogle(); await p.sdk().callback({ credential: 'id-token' });
    assert.equal(p.login(), undefined); assert.ok(p.caja.innerHTML.includes('Solicitud no aprobada')); assert.ok(!p.caja.innerHTML.includes('<img'));
    assert.ok(p.caja.innerHTML.includes('solActualizar'));
  });
  await prueba('no preselecciona el perfil ni envía una solicitud sin elegirlo', async () => {
    const p = pantalla({ perfilExtra: true }); p.s.renderPerfilGoogle({ email: 'a@example.com', googleTicket: 'ticket' });
    p.nodo('gNombre').value = 'Nombre'; p.nodo('gPhone').value = '59171111111';
    assert.ok(p.caja.innerHTML.includes('type="radio"'));
    assert.ok(!p.caja.innerHTML.includes(' checked'));
    assert.ok(p.caja.innerHTML.includes('data-google-perfil="profesional" hidden'));
    await p.nodo('gCrear').onclick(); assert.equal(p.llamadas.length, 0);
    assert.ok(p.nodo('gError').textContent.includes('Elegí'));
  });
  await prueba('pantalla de Google disponible en portugués', () => {
    const p = pantalla({ idioma: 'pt' }); p.s.renderPerfilGoogle({ email: 'a@example.com', googleTicket: 'ticket' });
    assert.ok(p.caja.innerHTML.includes('Complete seu perfil')); assert.ok(p.caja.innerHTML.includes('não permite recuperar'));
  });
  console.log(`\n${n} pruebas de pantalla aprobadas (DOM y SDK controlados).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
