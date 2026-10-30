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
    p.nodo('gNombre').value = 'Nombre'; p.nodo('gPhonePais').value = 'BO'; p.nodo('gPhone').value = '71111111';
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
  await prueba('catálogo completo, ordenado y traducido, sin adivinar el país del teléfono', () => {
    for (const idioma of ['es', 'pt']) {
      const p = pantalla({ idioma }); p.s.renderPerfilGoogle({ email: 'a@example.com' });
      const opciones = p.s.opcionesTelefonoGoogle();
      assert.equal((opciones.match(/<option /g) || []).length, 244);
      assert.ok(opciones.includes(idioma === 'es' ? 'Bolivia (+591)' : 'Bolívia (+591)'));
      assert.ok(opciones.includes('Brasil (+55)'));
      assert.ok(!opciones.includes('selected'));
      assert.ok(p.caja.innerHTML.includes('autocomplete="tel-national"'));
    }
  });
  await prueba('compone números locales y conserva códigos compartidos y ceros significativos', () => {
    const { s } = pantalla();
    for (const [pais, numero, esperado] of [
      ['BO', '7000 0000', '+59170000000'], ['BR', '(11) 91234-5678', '+5511912345678'],
      ['PE', '912345678', '+51912345678'], ['US', '2025550123', '+12025550123'],
      ['CA', '4165550123', '+14165550123'], ['IT', '0212345678', '+390212345678'],
      ['AR', '9 11 2345 6789', '+5491123456789'],
    ]) assert.equal(s.componerTelefonoGoogle(pais, numero).phone, esperado);
    assert.equal(s.componerTelefonoGoogle('CA', '+14165550123').pais, 'CA');
    for (const [pais, numero] of [['', '70000000'], ['ZZ', '70000000'], ['BO', ''], ['BO', 'abc70000000'], ['BO', '1234567890123456'], ['BO', '+99970000000']]) {
      assert.equal(s.componerTelefonoGoogle(pais, numero), null);
    }
  });
  await prueba('pegar un número internacional no duplica el prefijo y actualiza el selector', async () => {
    const p = pantalla(); p.s.renderPerfilGoogle({ email: 'a@example.com' });
    p.nodo('gPhonePais').value = 'BO'; p.nodo('gPhone').value = '+55 (11) 91234-5678';
    p.nodo('gPhone').onchange();
    assert.equal(p.nodo('gPhonePais').value, 'BR'); assert.equal(p.nodo('gPhone').value, '11912345678');
    assert.ok(p.nodo('gPhoneCompleto').textContent.includes('+5511912345678'));
    assert.equal(p.s.componerTelefonoGoogle('', '0059170000000').phone, '+59170000000');
  });
  await prueba('estudiante y profesional envían el teléfono compuesto sin cambiar el país profesional', async () => {
    for (const tipo of ['estudiante', 'profesional']) {
      const p = pantalla({ perfilExtra: true, respuesta: { token: 'sesion' } });
      p.s.renderPerfilGoogle({ email: 'a@example.com', googleTicket: 'ticket' });
      for (const [id, valor] of Object.entries({ gNombre: 'Nombre', gPhonePais: 'BR', gPhone: '11912345678', gTipo: tipo, gPais: 'BO' })) p.nodo(id).value = valor;
      await p.nodo('gCrear').onclick();
      const body = JSON.parse(p.llamadas.at(-1).opciones.body);
      assert.equal(body.phone, '+5511912345678');
      if (tipo === 'profesional') assert.equal(body.pais, 'BO');
    }
  });
  await prueba('enlace de soporte confirma Google sin contraseña ni alta de cuenta', async () => {
    const p = pantalla({ respuesta: { ok: true } });
    const token = 'a'.repeat(43);
    await p.s.renderVinculacionGoogleSoporte(token);
    assert.ok(!p.caja.innerHTML.includes('type="password"'));
    assert.ok(!p.caja.innerHTML.includes('gPhone'));
    p.nodo('gSoporteTotp').value = '123456';
    await p.sdk().callback({ credential: 'credencial-google' });
    const llamada = p.llamadas.at(-1), body = JSON.parse(llamada.opciones.body);
    assert.equal(llamada.url, '/medico/google/vincular-soporte');
    assert.deepEqual(body, { enlaceToken: token, credential: 'credencial-google', codigo: '123456' });
    assert.ok(p.caja.innerHTML.includes('Google vinculado'));
    assert.equal(p.login(), undefined); // El login posterior conserva el control 2FA normal.
  });
  await prueba('enlace inválido no carga Google y pantalla de soporte disponible en portugués', async () => {
    const p = pantalla({ idioma: 'pt' });
    await p.s.renderVinculacionGoogleSoporte('invalido');
    assert.ok(p.nodo('googleSoporteBoton').innerHTML.includes('O link não é válido'));
    assert.equal(p.llamadas.length, 0);
    const main = fs.readFileSync(path.join(raiz, 'public/js/main.js'), 'utf8');
    const llamados = [], ubicacion = { hash: '#vincular-google=' + 'a'.repeat(43), pathname: '/', search: '' };
    const entorno = { TOKEN: 'sesion-otra-cuenta', btnLogout: {}, btnAsistente: { style: {} },
      logout() {}, abrirAsistente() {}, aplicarTemaSegunEspecialidad() {}, aplicarLandingVeterinariaSiCorresponde() {},
      location: ubicacion, history: { replaceState: (...args) => llamados.push(['limpiar', args[2]]) },
      renderVinculacionGoogleSoporte: token => llamados.push(['vincular', token]),
      conectarTiempoReal: () => { throw new Error('No debe entrar en la cuenta anterior'); },
    };
    vm.runInNewContext(main, entorno);
    assert.deepEqual(llamados, [['limpiar', '/'], ['vincular', 'a'.repeat(43)]]);
  });
  await prueba('vinculación autorizada desde el formulario respeta la pantalla de segundo factor', async () => {
    const p = pantalla({ respuesta: { requiere2fa: true, tempToken: 'segundo-factor' } });
    p.s.renderPerfilGoogle({ email: 'a@example.com', googleTicket: 'ticket' });
    for (const [id, valor] of Object.entries({ gNombre: 'Nombre', gPhone: '+5511912345678', gTipo: 'profesional' })) p.nodo(id).value = valor;
    await p.nodo('gCrear').onclick();
    assert.equal(p.dosfa(), 'segundo-factor'); assert.equal(p.login(), undefined);
  });
  await prueba('cuenta existente puede solicitar vinculación solo con teléfono y Google, sin contraseña ni rol', async () => {
    const p = pantalla({ respuesta: { vinculacionPendiente: true } });
    p.s.renderPerfilGoogle({ email: 'cliente@gmail.com', googleTicket: 'ticket-real' });
    p.nodo('gPhone').value = '+55 11 91234 5678';
    await p.nodo('gPedirVinculacion').onclick();
    const r = p.llamadas.at(-1);
    assert.equal(r.url, '/medico/google/solicitar-vinculacion');
    assert.deepEqual(JSON.parse(r.opciones.body), { phone: '+5511912345678', googleTicket: 'ticket-real' });
    assert.equal(p.login(), undefined); assert.ok(p.caja.innerHTML.includes('pendiente de aprobación'));
  });
  await prueba('Crear mi cuenta muestra la solicitud pendiente sin iniciar sesión ni prometer aprobación', async () => {
    const p = pantalla({ respuesta: { vinculacionPendiente: true } });
    p.s.renderPerfilGoogle({ email: 'cliente@gmail.com', googleTicket: 'ticket-real' });
    for (const [id, v] of Object.entries({ gNombre: 'Cliente', gPhone: '+5511912345678', gTipo: 'profesional' })) p.nodo(id).value = v;
    await p.nodo('gCrear').onclick();
    assert.equal(p.login(), undefined); assert.ok(p.caja.innerHTML.includes('pendiente de aprobación'));
  });
  console.log(`\n${n} pruebas de pantalla aprobadas (DOM y SDK controlados).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
