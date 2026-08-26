// Prueba del login/registro traducido.
//
// A diferencia de agenda.js, acá el español SÍ cambia: se agregó el selector
// de idioma al pie de las dos pantallas. Así que la prueba es más exigente
// que "es idéntico": el español tiene que ser idéntico *salvo* ese selector,
// y nada más.
const vm = require("vm");
const fs = require("fs");
const { execSync } = require("child_process");

const RAIZ = require("path").join(__dirname, "..", "..");

function correr(codigoAuth, idioma) {
  const app = { innerHTML: "" };
  const nodo = () => new Proxy({ style: {}, dataset: {} }, {
    get: (o, k) => (k in o ? o[k] : undefined),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const sandbox = {
    app, console,
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    document: { getElementById: () => nodo(), querySelectorAll: () => [], querySelector: () => nodo(), documentElement: {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    ES_LANDING_VETERINARIA: false,
    detenerPolling: () => {}, renderDashboard: () => {}, api: async () => ({}),
    conectarTiempoReal: () => {}, activarEscritorioSiCorresponde: () => false,
    setTimeout: () => {},
  };
  vm.createContext(sandbox);
  if (idioma) {
    vm.runInContext(
      fs.readFileSync(`${RAIZ}/public/js/i18n.js`, "utf8") + "\n" +
      fs.readFileSync(`${RAIZ}/public/i18n/es.js`, "utf8") + "\n" +
      fs.readFileSync(`${RAIZ}/public/i18n/pt.js`, "utf8"), sandbox);
    vm.runInContext(`MEDICO_IDIOMA = ${JSON.stringify(idioma)};`, sandbox);
  }
  vm.runInContext(codigoAuth, sandbox);

  vm.runInContext("renderLogin();", sandbox);
  const login = app.innerHTML;
  vm.runInContext("renderRegistro();", sandbox);
  const registro = app.innerHTML;
  vm.runInContext('renderLogin2FA("tok");', sandbox);
  const dosfa = app.innerHTML;
  return { login, registro, dosfa };
}

// Le saca el selector de idioma, que es lo único nuevo a propósito.
// Se saca la línea entera —sangría incluida—, porque el espacio en blanco
// que la rodea también es parte de lo que se agregó.
const sinSelector = (html) => html.replace(/\n\s*<div style="text-align:center;margin-top:14px;font-size:13px">[\s\S]*?<\/div>/g, "");

const antes = execSync(`git -C ${RAIZ} show main:public/js/auth.js`, { encoding: "utf8" });
const ahora = fs.readFileSync(`${RAIZ}/public/js/auth.js`, "utf8");

const viejo = correr(antes, null);
const nuevoEs = correr(ahora, "es");
const nuevoPt = correr(ahora, "pt");

let fallos = 0;
for (const pantalla of ["login", "registro", "dosfa"]) {
  const a = viejo[pantalla];
  const b = sinSelector(nuevoEs[pantalla]);
  if (a === b) {
    console.log(`✅ ${pantalla} en español: idéntico salvo el selector (${a.length} car.)`);
  } else {
    fallos++;
    const i = [...a].findIndex((c, k) => c !== b[k]);
    console.log(`❌ ${pantalla} en español: DIFIERE en el carácter ${i}`);
    console.log(`   antes: ${JSON.stringify(a.slice(Math.max(0, i - 70), i + 70))}`);
    console.log(`   ahora: ${JSON.stringify(b.slice(Math.max(0, i - 70), i + 70))}`);
  }
}

// El selector tiene que estar en login y registro, y NO en la pantalla de 2FA
// (ahí el médico ya se identificó: cambiar el idioma a mitad del login sería
// raro y además no cambiaría nada, porque manda su cuenta).
console.log("");
for (const [pantalla, debeEstar] of [["login", true], ["registro", true], ["dosfa", false]]) {
  const tiene = nuevoEs[pantalla].includes("idioma-opcion");
  const ok = tiene === debeEstar;
  console.log(`${ok ? "✅" : "❌"} selector en ${pantalla}: ${tiene ? "sí" : "no"} (esperado: ${debeEstar ? "sí" : "no"})`);
  if (!ok) fallos++;
}

// En portugués, las etiquetas tienen que cambiar de verdad.
console.log("");
const esperadasPt = ["Telefone", "Senha", "Entrar", "Cadastre-se", "Nome completo", "Criar conta", "Clínica geral"];
const faltan = esperadasPt.filter(x => !(nuevoPt.login + nuevoPt.registro).includes(x));
console.log(faltan.length === 0
  ? `✅ portugués: las ${esperadasPt.length} etiquetas esperadas aparecen`
  : `❌ portugués: faltan ${faltan.join(", ")}`);
if (faltan.length) fallos++;

// Y no debe quedar español suelto en las pantallas en portugués.
const españolSuelto = ["Contraseña", "Ingresar", "Registrarme", "Teléfono"].filter(x => (nuevoPt.login + nuevoPt.registro).includes(x));
console.log(españolSuelto.length === 0
  ? "✅ portugués: no quedó ninguna etiqueta en español"
  : `❌ portugués: quedaron en español → ${españolSuelto.join(", ")}`);
if (españolSuelto.length) fallos++;

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
