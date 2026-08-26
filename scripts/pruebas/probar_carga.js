// Vitalis — Prueba de carga completa.
//
// Todos los módulos del frontend comparten un solo scope global (no hay
// build step ni imports). Eso significa que si un archivo renombra una
// constante y otro la seguía usando, NADIE avisa: no falla al cargar, falla
// recién cuando el médico abre esa pantalla, con un ReferenceError que en
// producción se ve como una pantalla en blanco.
//
// Ya pasó una vez: recordatorios.js cambió TIPOS_RECORDATORIO por una
// función y escritorio.js seguía usando la constante. Todos los tests de
// regresión pasaban, porque ninguno abría el panel de escritorio.
//
// Esta prueba carga los scripts en el mismo orden que index.html y después
// llama a cada pantalla con datos de prueba. No verifica cómo se ve nada:
// verifica que no explote.
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");

// El orden real, sacado de index.html — no una lista a mano que se
// desactualice.
const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="(\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
if (scripts.length < 30) {
  console.error(`❌ solo encontré ${scripts.length} scripts en index.html — ¿cambió el formato?`);
  process.exit(1);
}

const PACIENTE = { _id: "p1", nombre: "María Fernández", fechaNacimiento: "1985-04-12", sexo: "Femenino", telefono: "591700", notas: "" };
const CITAS = [{ _id: "c1", estado: "confirmada", fecha: new Date().toISOString(), pacienteNombre: "Juan", origen: "manual", motivo: "Control" }];
const CONSULTAS = [{ _id: "k1", estado: "completado", createdAt: new Date().toISOString(), pacienteNombre: "Juan", notaClinicaEstado: "completado" }];
const RECORDATORIOS = [{ _id: "r1", tipo: "control", titulo: "Control", pacienteNombre: "Juan", fecha: new Date().toISOString() }];

function nodoFalso() {
  const o = {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    value: "", textContent: "", innerHTML: "", disabled: false, checked: false, files: [],
    appendChild() {}, remove() {}, insertAdjacentHTML() {}, addEventListener() {},
    focus() {}, click() {}, closest: () => nodoFalso(), querySelector: () => nodoFalso(),
    querySelectorAll: () => [], scrollTop: 0, scrollHeight: 0, getBoundingClientRect: () => ({ width: 300, height: 200, left: 0, top: 0 }),
  };
  return o;
}

function crearSandbox() {
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Map, Set, isNaN, parseInt, parseFloat,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    alert() {}, confirm: () => false, prompt: () => null,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { pathname: "/", href: "http://x/", search: "" },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, serviceWorker: { register: async () => ({}) } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MediaRecorder: function () { this.start = () => {}; this.stop = () => {}; },
    AudioContext: function () { return { createAnalyser: () => ({}), createMediaStreamSource: () => ({ connect() {} }), close() {} }; },
    ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    WebSocket: function () {},
    EventSource: function () { this.addEventListener = () => {}; this.close = () => {}; },
    Image: function () {},
    Blob: function () {}, FileReader: function () {}, FormData: function () {},
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    performance: { now: () => 0 },
    atob: (x) => x, btoa: (x) => x,
    Notification: { permission: "default", requestPermission: async () => "default" },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    print() {}, open: () => nodoFalso(), scrollTo() {},
  };
  s.MediaRecorder.isTypeSupported = () => true;
  s.document = {
    getElementById: () => nodoFalso(),
    querySelector: () => nodoFalso(),
    querySelectorAll: () => [],
    createElement: () => nodoFalso(),
    body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
    documentElement: { lang: "", style: { setProperty() {} } },
    addEventListener() {},
    title: "",
  };
  s.window = s;
  s.globalThis = s;
  return s;
}

// ── 1. Cargar todo, en orden ───────────────────────────────────────────────
const sandbox = crearSandbox();
vm.createContext(sandbox);

// Los diccionarios primero (index.html los tiene, pero apuntan a los
// paquetes generados: acá se arman al vuelo desde la fuente).
// Se concatenan acá en vez de usar services/i18nBundle: ese arrastra
// config/ y su ruido de arranque, y lo único que hace falta es el texto.
for (const idioma of fs.readdirSync(path.join(RAIZ, "public", "i18n"), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
  const dir = path.join(RAIZ, "public", "i18n", idioma);
  const junto = fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()
    .map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  fs.writeFileSync(path.join(RAIZ, "public", "i18n", `${idioma}.js`), junto);
}

let fallos = 0;
for (const ruta of scripts) {
  const archivo = path.join(RAIZ, ruta.startsWith("/js/") ? "public" + ruta : "public" + ruta);
  let codigo;
  try { codigo = fs.readFileSync(archivo, "utf8"); }
  catch { console.log(`⚠️  ${ruta}: no existe (¿es generado?), se saltea`); continue; }
  try {
    vm.runInContext(codigo, sandbox, { filename: ruta });
  } catch (e) {
    fallos++;
    console.log(`❌ ${ruta}: falló al cargar — ${e.message}`);
  }
}
if (fallos === 0) console.log(`✅ los ${scripts.length} scripts cargan sin error, en el orden de index.html`);

// ── 2. Llamar a cada pantalla ──────────────────────────────────────────────
// El objetivo es toparse con un ReferenceError, no verificar el resultado.
const pantallas = [
  ["panel de escritorio", `pintarInicioEscritorio(${JSON.stringify([PACIENTE])}, ${JSON.stringify(CITAS)}, ${JSON.stringify(RECORDATORIOS)}, ${JSON.stringify(CONSULTAS)})`],
  ["nav de escritorio", `pintarNavEscritorio()`],
  ["agenda", `pintarAgenda(${JSON.stringify(CITAS)}, ${JSON.stringify([PACIENTE])}, { configurado: true })`],
  ["horario", `pintarConfigHorario({ horarioAtencion: [], duracionConsultaMinutos: 30 })`],
  ["recordatorios", `app.innerHTML = tabRecordatoriosHtml(${JSON.stringify(RECORDATORIOS)}, ${JSON.stringify([PACIENTE])})`],
  ["recetas", `app.innerHTML = tabRecetasHtml([])`],
  ["login", `renderLogin()`],
  ["registro", `renderRegistro()`],
  ["nuevo paciente", `renderNuevoPaciente()`],
  ["vinculación", `pintarVincular({ vinculado: false, codigo: "123456" })`],
  ["memoria clínica", `app.innerHTML = tabMemoriaHtml("p1")`],
  ["pestañas del Kardex", `tabsKardexPara("odontologia")`],
  ["tipos de recordatorio", `tiposRecordatorio()`],
  ["sugerencias del asistente", `sugerenciasAsistente()`],
  ["Vitalis Voice", `pintarVozEscritorio([{ _id: "c1", pacienteNombre: "Juan", fecha: new Date().toISOString(), estado: "confirmada", motivo: "Control" }])`],
  ["indicaciones", `pintarIndicacionesEscritorio([{ _id: "r1", fecha: new Date().toISOString(), pacienteId: { _id: "p1", nombre: "Juan" }, medicamentos: [{ nombre: "Amoxicilina" }], indicaciones: "Reposo" }])`],
  ["estudios (escritorio)", `pintarEstudiosEscritorio([{ _id: "e1", nombre: "Radiografía", tipo: "radiografia", fecha: new Date().toISOString(), pacienteId: { _id: "p1", nombre: "Juan" } }])`],
  ["reportes", `pintarReportesEscritorio({ totalConsultas: 10, porcentajeConsultasCompletadas: 80, totalCitas: 12, citasCanceladas: 1, consultasPorMes: {}, citasPorMes: {}, pacientesNuevosPorMes: {} })`],
  ["finanzas", `pintarFinanzasEscritorio({ totalFacturado: 1500, totalCobrado: 900.5, saldoPendiente: 599.5, cantidadPlanes: 3, pagosRecientes: [{ pacienteNombre: "Juan", tratamiento: "Corona", fecha: new Date().toISOString(), monto: 300 }] })`],
  ["notificaciones", `app.innerHTML = notificacionesHtml()`],
  ["moneda", `money(1234.5)`],
  ["estados de tratamiento", `estadoTratamientoInfo()`],
  ["tipos de estudio", `tiposEstudioTodos()`],
  ["ángulos de foto", `angulosFotoTodos()`],
  ["lados del ojo", `ladosOjo()`],
  ["estudios (pestaña)", `app.innerHTML = tabEstudiosHtml([{ _id: "e1", tipo: "foto", anguloFoto: "frontal", nombre: "Frontal", fecha: new Date().toISOString(), anotaciones: [] }])`],
  ["estudios (vacío)", `app.innerHTML = tabEstudiosHtml([])`],
  ["estado del informe", `estadoInformeHtml({ estado: "firmado" }) + estadoInformeHtml({ estado: "borrador" })`],
  ["tipos de medición", `tiposMedicion()`],
  ["evolución (pestaña)", `app.innerHTML = tabEvolucionHtml([{ _id: "m1", tipo: "presion", valor: 120, valorSecundario: 80, fecha: new Date().toISOString() }, { _id: "m2", tipo: "presion", valor: 130, valorSecundario: 85, fecha: new Date().toISOString() }])`],
  ["evolución (vacía)", `app.innerHTML = tabEvolucionHtml([])`],
  ["pistas del visor", `pistaDelModo("mover") + pistaDelModo("distancia") + pistaDelModo("angulo") + pistaDelModo("calibrar")`],
  ["equipos de rayos", `pintarEquiposRayos([{ _id: "eq1", nombre: "PC 1", conectado: true, subidas: 3, ultimaSubida: new Date().toISOString(), ultimoContacto: new Date().toISOString() }], null)`],
  ["equipos de rayos (vacío)", `pintarEquiposRayos([], null)`],
];

for (const idioma of ["es", "pt"]) {
  vm.runInContext(`MEDICO_IDIOMA = ${JSON.stringify(idioma)};`, sandbox);
  for (const [nombre, expr] of pantallas) {
    try {
      vm.runInContext(expr, sandbox);
    } catch (e) {
      fallos++;
      console.log(`❌ [${idioma}] ${nombre}: ${e.constructor.name} — ${e.message}`);
    }
  }
}
if (fallos === 0) console.log(`✅ las ${pantallas.length} pantallas se pintan en español y en portugués sin explotar`);

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
