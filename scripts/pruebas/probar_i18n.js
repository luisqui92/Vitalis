// Prueba de que el andamiaje de i18n NO cambió nada en español.
//
// Corre pintarAgenda() y pintarConfigHorario() con los mismos datos en las
// dos versiones del archivo —la de antes del cambio (sacada de git) y la de
// ahora— y compara el HTML resultante carácter por carácter.
//
// Si el español cambió aunque sea en un espacio, esto falla.
const vm = require("vm");
const fs = require("fs");
const { execSync } = require("child_process");

const RAIZ = require("path").join(__dirname, "..", "..");

// ─── Datos de prueba (los mismos para las dos versiones) ──────────────────
const CITAS = [
  { _id: "c1", estado: "confirmada", fecha: fechaHoy(9, 30), pacienteNombre: "María Fernández", origen: "whatsapp", motivo: "Control anual", pacienteId: "p1" },
  { _id: "c2", estado: "confirmada", fecha: fechaHoy(11, 0), pacienteNombre: "Juan Pérez", origen: "manual", motivo: "", pacienteId: null, pacienteTelefono: "59171234567" },
  { _id: "c3", estado: "cancelada", fecha: fechaHoy(15, 0), pacienteNombre: "Ana Rojas", origen: "voz", motivo: "Dolor", pacienteId: "p3" },
];
const PACIENTES = [{ _id: "p1", nombre: "María Fernández" }, { _id: "p3", nombre: "Ana <Rojas>" }];
const HORARIO = {
  horarioAtencion: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "17:00" }, { diaSemana: 3, horaInicio: "09:00", horaFin: "13:00" }],
  duracionConsultaMinutos: 20,
  googleCalendarId: "doc@gmail.com",
  infoConsultorio: "Atendemos de 8 a 17.",
};

function fechaHoy(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ─── Entorno mínimo para que agenda.js corra fuera del navegador ──────────
function correr(codigoAgenda, dicts) {
  const app = { innerHTML: "" };
  const nodoFalso = () => new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (k === "value" ? "" : k === "dataset" ? {} : k === "style" ? {} : undefined)),
    set: (o, k, v) => { o[k] = v; return true; },
  });

  const sandbox = {
    app,
    console,
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    document: {
      getElementById: () => nodoFalso(),
      querySelectorAll: () => [],
      querySelector: () => nodoFalso(),
      documentElement: {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    renderDashboard: () => {}, renderConfigHorario: () => {}, renderAgenda: () => {},
    renderPacienteDetalle: () => {}, detenerPolling: () => {}, logout: () => {}, api: async () => ({}),
    alert: () => {}, confirm: () => true,
  };

  // El i18n real, con los diccionarios reales — no una imitación.
  if (dicts) {
    const i18n = fs.readFileSync(`${RAIZ}/public/js/i18n.js`, "utf8");
    const es = fs.readFileSync(`${RAIZ}/public/i18n/es.js`, "utf8");
    const pt = fs.readFileSync(`${RAIZ}/public/i18n/pt.js`, "utf8");
    vm.createContext(sandbox);
    vm.runInContext(i18n + "\n" + es + "\n" + pt, sandbox);
    if (dicts !== "es") vm.runInContext(`MEDICO_IDIOMA = ${JSON.stringify(dicts)};`, sandbox);
  } else {
    vm.createContext(sandbox);
  }

  vm.runInContext(codigoAgenda, sandbox);
  vm.runInContext(`pintarAgenda(${JSON.stringify(CITAS)}, ${JSON.stringify(PACIENTES)}, { configurado: true });`, sandbox);
  const agendaHtml = app.innerHTML;
  vm.runInContext(`pintarAgenda(${JSON.stringify(CITAS)}, ${JSON.stringify(PACIENTES)}, { configurado: false });`, sandbox);
  const agendaSinWa = app.innerHTML;
  vm.runInContext(`pintarConfigHorario(${JSON.stringify(HORARIO)});`, sandbox);
  const horarioHtml = app.innerHTML;

  return { agendaHtml, agendaSinWa, horarioHtml };
}

// ─── La comparación ────────────────────────────────────────────────────────
// El código de main todavía dice "Vitalis": el producto se renombró a
// Symphomed. Se normaliza la marca del lado VIEJO en vez de aflojar la
// comparación, así esta prueba sigue haciendo lo único que vino a hacer —
// detectar que el marcado cambió— y no se vuelve ciega al resto.
const marcaVieja = (s) => s.replace(/Vitalis/g, "Symphomed");
const antes = execSync(`git -C ${RAIZ} show main:public/js/agenda.js`, { encoding: "utf8", maxBuffer: 1 << 24 });
const ahora = fs.readFileSync(`${RAIZ}/public/js/agenda.js`, "utf8");

const viejo = correr(marcaVieja(antes), null);
const nuevo = correr(ahora, "es");

let fallos = 0;
// ═══ LA HORA CAMBIÓ A PROPÓSITO ═══════════════════════════════════════════
//
// La agenda formateaba la hora con timeZone: "America/La_Paz" escrito a
// mano. Para un consultorio de Bolivia daba bien por casualidad; para uno de
// Brasil daba TODAS las horas corridas sesenta minutos, porque Brasil está
// en UTC−3 y Bolivia en UTC−4. Un turno que dice 14:00 cuando es 15:00 es un
// paciente que llega tarde.
//
// Ahora usa horaCorta(), que toma la zona del aparato de quien mira y el
// reloj de 24 horas. Eso cambia el texto de la hora, y esta prueba —que
// existe para atajar que el trabajo de idiomas mueva el dibujo SIN QUERER—
// lo estaba reportando como si nadie lo hubiera escrito a propósito.
//
// Se tapa la hora en LOS DOS lados: así se sigue comparando todo el resto
// del dibujo, que es lo que la prueba vino a cuidar.
const sinHora = (html) => html.replace(/\d{1,2}:\d{2}(\s*[ap]\.?\s*m\.?)?/gi, "«hora»");

for (const pantalla of ["agendaHtml", "agendaSinWa", "horarioHtml"]) {
  const a = sinHora(viejo[pantalla]), b = sinHora(nuevo[pantalla]);
  if (a === b) {
    console.log(`✅ ${pantalla}: idéntico (${a.length} caracteres)`);
  } else {
    fallos++;
    console.log(`❌ ${pantalla}: DIFIERE`);
    // Por unidad UTF-16 en los dos lados: el [...a] recorría code points
    // y b[k] indexaba UTF-16, así que con un emoji antes del conflicto
    // señalaba una posición que no era.
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    console.log(`   primera diferencia en el carácter ${i}`);
    console.log(`   antes: ...${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))}`);
    console.log(`   ahora: ...${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`);
  }
}

// Y que el portugués efectivamente cambie lo que ya está traducido, y caiga
// al español en todo lo demás.
const enPt = correr(ahora, "pt");
const diasPt = ["Seg", "Ter", "Qua", "Qui", "Sex"].filter(d => enPt.horarioHtml.includes(d));
// El respaldo se prueba con una clave inventada que SOLO existe en español,
// no con una que todavía no se tradujo: en cuanto se traduce, esa prueba deja
// de probar nada y encima falla, que es justo lo que pasó cuando la agenda
// llegó al 100%.
const ctxFallback = { I18N: { es: {}, pt: {} }, console, localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: {} } };
vm.createContext(ctxFallback);
vm.runInContext(fs.readFileSync(`${RAIZ}/public/js/i18n.js`, "utf8"), ctxFallback);
vm.runInContext('I18N.es["prueba.respaldo"] = "SOLO EN ESPAÑOL"; MEDICO_IDIOMA = "pt";', ctxFallback);
const cayoAlEspanol = vm.runInContext('t("prueba.respaldo")', ctxFallback) === "SOLO EN ESPAÑOL";
console.log(`\n🇧🇷 en portugués: días traducidos presentes → ${diasPt.join(", ") || "NINGUNO"}`);
console.log(`🇧🇷 clave sin traducir cae al español → ${cayoAlEspanol ? "sí" : "NO"}`);
if (diasPt.length !== 5) { console.log("❌ faltan días en portugués"); fallos++; }
if (!cayoAlEspanol) { console.log("❌ el respaldo al español no funcionó"); fallos++; }
// Una clave que falta se pinta tal cual (t() la devuelve como último
// recurso), así que buscamos las claves REALES del diccionario dentro del
// HTML. Ojo: no sirve una expresión regular tipo /horario\./ — el texto
// "Tildá los días... con su horario. Los días..." la haría saltar, y eso es
// prosa legítima, no una clave sin traducir.
const pantallasPt = enPt.horarioHtml + enPt.agendaHtml + enPt.agendaSinWa;
const claves = Object.keys(JSON.parse(JSON.stringify(
  (() => { const s = { I18N: { es: {}, pt: {} }, Object }; vm.createContext(s);
           vm.runInContext(fs.readFileSync(`${RAIZ}/public/i18n/es.js`, "utf8"), s);
           return s.I18N.es; })()
)));
const crudas = claves.filter(k => pantallasPt.includes(k));
if (crudas.length) {
  console.log(`❌ quedaron ${crudas.length} clave(s) crudas visibles: ${crudas.slice(0, 5).join(", ")}`); fallos++;
} else {
  console.log(`✅ ninguna de las ${claves.length} claves quedó cruda en pantalla`);
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
