// Prueba de regresión: recordatorios, vinculación, recetas y las pestañas
// del Kardex (estado.js). Compara contra main con los mismos datos.
//
// Las pestañas tienen su propia trampa: los mapas de estado.js se evalúan al
// CARGAR el archivo, antes del login. Acá se comprueba que cambiar
// MEDICO_IDIOMA después de cargarlo igual cambia las etiquetas — que es
// justo lo que fallaría si se hubieran resuelto arriba.
const vm = require("vm");
const fs = require("fs");
const { execSync } = require("child_process");

const RAIZ = require("path").join(__dirname, "..", "..");

const RECORDATORIOS = [
  { _id: "r1", tipo: "control", titulo: "Control de presión", pacienteNombre: "Juan Pérez", fecha: "2026-09-01T00:00:00Z" },
  { _id: "r2", tipo: "vacuna", titulo: "Refuerzo antitetánica", pacienteNombre: "Ana Rojas", fecha: "2026-09-15T00:00:00Z" },
];
const PACIENTES = [{ _id: "p1", nombre: "Juan Pérez" }, { _id: "p2", nombre: "Ana Rojas" }];
const RECETAS = [{ _id: "rx1", fecha: "2026-08-01T00:00:00Z", medicamentos: [{ nombre: "Amoxicilina" }, { nombre: "Ibuprofeno" }] }];

function entorno(idioma) {
  const app = { innerHTML: "" };
  const nodo = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, {
    get: (o, k) => (k in o ? o[k] : (k === "value" ? "" : undefined)),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const s = {
    app, console, MEDICO_TIPO_ESPECIALIDAD: "medicina_general", MEDICO_NOMBRE: "Dra. Camila",
    // La moneda de la cuenta: decide qué se dibuja donde Brasil trabaja
    // distinto (la receta va por Memed). "BOB" es el caso de siempre.
    MEDICO_MONEDA: "BOB",
    esc: (x) => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    document: {
      getElementById: () => nodo(), querySelectorAll: () => [], querySelector: () => nodo(),
      createElement: () => nodo(), documentElement: {}, body: { classList: { toggle() {}, add() {} } },
      title: "",
    },
    location: { pathname: "/" },
    localStorage: { getItem: () => null, setItem: () => {} },
    edadDesde: () => 41, detenerPolling: () => {}, logout: () => {}, api: async () => ({}),
    renderDashboard: () => {}, renderRecordatorios: () => {}, renderVincular: () => {},
    renderPacienteDetalle: () => {}, renderReceta: () => {}, renderRecetaOptica: () => {},
    setTimeout: () => {}, setInterval: () => {}, clearInterval: () => {},
    crearIndicadorAudio: () => ({ iniciar() {}, detener() {} }),
    navigator: { mediaDevices: {} }, alert: () => {}, confirm: () => true, window: { print() {} },
    MediaRecorder: function () {}, subirConsulta: async () => ({}), fmt: () => "00:00",
  };
  s.window = s;
  vm.createContext(s);
  if (idioma) {
    for (const f of ["public/js/i18n.js", "public/i18n/es.js", "public/i18n/pt.js"]) {
      vm.runInContext(fs.readFileSync(`${RAIZ}/${f}`, "utf8"), s);
    }
    vm.runInContext(`MEDICO_IDIOMA = ${JSON.stringify(idioma)};`, s);
  }
  return s;
}

function pintar(archivos, idioma, llamadas) {
  const s = entorno(idioma);
  for (const a of archivos) {
    // Una ruta y un código fuente son los dos strings; se distinguen por la
    // forma, no por el tipo.
    const codigo = a.codigo !== undefined ? a.codigo : fs.readFileSync(`${RAIZ}/${a.ruta}`, "utf8");
    vm.runInContext(codigo, s);
  }
  const out = {};
  for (const [nombre, expr] of Object.entries(llamadas)) {
    vm.runInContext(expr, s);
    out[nombre] = s.app.innerHTML;
  }
  return out;
}

const deMain = (ruta) => execSync(`git -C ${RAIZ} show main:${ruta}`, { encoding: "utf8" });

// Igual que el bloque de persona en probar_kardex.js: esta prueba existe
// para atajar que el i18n cambie el dibujo SIN QUERER, no para congelar las
// pantallas. Un elemento nuevo y deliberado se declara acá.
//
// La caja de Memed es la receta digital de Brasil (ver services/memed.js).
// En una cuenta boliviana no dibuja nada, pero el hueco queda igual en el
// marcado, y es ese hueco el que hay que descontar.
const sinCajasNuevas = (html) => html
  .replace(/\n?\s*<!-- En Brasil se receta por Memed[\s\S]*?-->/g, "")
  .replace(/\n?\s*<div id="memedBox"><\/div>/g, "")
  // El id que le da nombre a la caja de la receta de Symphomed, para poder
  // sacarla cuando la cuenta receta por Memed. Es un id, no un cambio de
  // dibujo: no se ve.
  .replace(/<div class="card" id="recetaNuevaBox">/g, '<div class="card">')
  // La ✕ de una receta ya no la borra: la anula, con un motivo (auditoría de
  // QA, M8). Cambia el atributo y suma un title, a propósito; el resto de la
  // fila tiene que seguir igual.
  .replace(/data-anular-receta="([^"]*)" data-memed="[^"]*" title="[^"]*"/g, 'data-borrar-receta="$1"');

let fallos = 0;
function comparar(nombre, viejoBruto, nuevoBruto) {
  const viejo = viejoBruto;
  const nuevo = Object.fromEntries(Object.entries(nuevoBruto).map(([k, v]) => [k, sinCajasNuevas(v)]));
  for (const k of Object.keys(viejo)) {
    if (viejo[k] === nuevo[k]) {
      console.log(`✅ ${nombre}/${k}: idéntico (${viejo[k].length} car.)`);
    } else {
      fallos++;
      const a = viejo[k], b = nuevo[k] || "";
      const i = [...a].findIndex((c, j) => c !== b[j]);
      console.log(`❌ ${nombre}/${k}: DIFIERE en el carácter ${i}`);
      console.log(`   antes: ${JSON.stringify(a.slice(Math.max(0, i - 70), i + 70))}`);
      console.log(`   ahora: ${JSON.stringify(b.slice(Math.max(0, i - 70), i + 70))}`);
    }
  }
}

// ── recordatorios ──
const llamadasRec = {
  lleno: `app.innerHTML = tabRecordatoriosHtml(${JSON.stringify(RECORDATORIOS)}, ${JSON.stringify(PACIENTES)});`,
  vacio: `app.innerHTML = tabRecordatoriosHtml([], ${JSON.stringify(PACIENTES)});`,
};
comparar("recordatorios",
  pintar([{ codigo: deMain("public/js/recordatorios.js") }], null, llamadasRec),
  pintar([{ ruta: "public/js/recordatorios.js" }], "es", llamadasRec));

// ── vinculación ──
const llamadasVinc = {
  sinVincular: 'pintarVincular({ vinculado: false });',
};
comparar("vinculacion",
  pintar([{ codigo: deMain("public/js/vinculacion.js") }], null, llamadasVinc),
  pintar([{ ruta: "public/js/vinculacion.js" }], "es", llamadasVinc));

// ── recetas ──
const llamadasRx = {
  tab: `app.innerHTML = tabRecetasHtml(${JSON.stringify(RECETAS)});`,
  tabVacio: `app.innerHTML = tabRecetasHtml([]);`,
  fila: `app.innerHTML = filaMedicamentoHtml();`,
};
comparar("recetas",
  pintar([{ codigo: deMain("public/js/recetas.js") }], null, llamadasRx),
  pintar([{ ruta: "public/js/recetas.js" }], "es", llamadasRx));

// ── pestañas del Kardex ──
console.log("");
const sEstado = entorno("es");
vm.runInContext(fs.readFileSync(`${RAIZ}/public/js/estado.js`, "utf8"), sEstado);
const viejoEstado = entorno(null);
vm.runInContext(deMain("public/js/estado.js"), viejoEstado);

// Mismo criterio que sinCajasNuevas: esto ataja que el i18n cambie las
// pestañas SIN QUERER, no congela el Kardex. Una pestaña nueva y deliberada
// se declara acá y se descuenta de los dos lados — lo que la prueba sigue
// cuidando es que ninguna de las otras se mueva, se renombre o cambie de
// orden al tocarla.
//
// "familia" es el informe de avance que recibe la familia de un chico en
// seguimiento de neurodesarrollo (ver routes/informeFamilia.js).
const PESTANAS_NUEVAS = new Set(["familia"]);
const listaDePestanas = (ctx, esp) => JSON.parse(
  vm.runInContext(`JSON.stringify(Object.entries(tabsKardexPara(${JSON.stringify(esp)})).map(([k, v]) => [k, v.label]))`, ctx));
const sinPestanasNuevas = (pares) => JSON.stringify(pares.filter(([k]) => !PESTANAS_NUEVAS.has(k)));

for (const esp of ["medicina_general", "odontologia", "estetica", "oftalmologia", "veterinaria", "ginecologia", "pediatria", "neurodesarrollo"]) {
  const antes = sinPestanasNuevas(listaDePestanas(viejoEstado, esp));
  const ahora = sinPestanasNuevas(listaDePestanas(sEstado, esp));
  if (antes === ahora) console.log(`✅ pestañas/${esp}: idénticas`);
  else { fallos++; console.log(`❌ pestañas/${esp}:\n   antes: ${antes}\n   ahora: ${ahora}`); }
}

// Y que la pestaña declarada como nueva EXISTA de verdad donde tiene que
// existir. Sin esto, la lista de arriba sería una forma de tapar un borrado:
// alguien saca "familia" del Kardex, la declara acá y nadie se entera.
const neuroAhora = listaDePestanas(sEstado, "neurodesarrollo").map(([k]) => k);
const enOtra = listaDePestanas(sEstado, "medicina_general").map(([k]) => k);
if (neuroAhora.includes("familia") && !enOtra.includes("familia")) {
  console.log("✅ pestañas: «familia» está en neurodesarrollo y solo ahí");
} else {
  fallos++;
  console.log("❌ pestañas: «familia» tiene que estar en neurodesarrollo y en ninguna otra especialidad");
}

// La trampa: cambiar el idioma DESPUÉS de cargar estado.js tiene que cambiar
// las etiquetas. Si los mapas se hubieran resuelto arriba, esto no cambiaría.
vm.runInContext('MEDICO_IDIOMA = "pt";', sEstado);
const enPt = vm.runInContext('JSON.stringify(Object.values(tabsKardexPara("odontologia")).map(v => v.label))', sEstado);
const cambio = enPt.includes("Orçamento") && enPt.includes("Receitas");
console.log(cambio
  ? "✅ pestañas: cambian de idioma después de cargar el archivo (no quedaron congeladas)"
  : `❌ pestañas: quedaron congeladas al cargar → ${enPt}`);
if (!cambio) fallos++;

// ── portugués ──
console.log("");
const pt = {
  ...pintar([{ ruta: "public/js/recordatorios.js" }], "pt", llamadasRec),
  ...pintar([{ ruta: "public/js/recetas.js" }], "pt", llamadasRx),
  ...pintar([{ ruta: "public/js/vinculacion.js" }], "pt", llamadasVinc),
};
const todo = Object.values(pt).join("");
const esperadas = ["Salvar lembrete", "Nova receita", "Adicionar outro medicamento", "Vincular"];
const faltan = esperadas.filter(x => !todo.includes(x));
console.log(faltan.length ? `❌ portugués: faltan → ${faltan.join(", ")}` : `✅ portugués: las ${esperadas.length} etiquetas esperadas aparecen`);
if (faltan.length) fallos++;

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
