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
  // Los otros dos pasos del registro. Se piden con typeof porque esta misma
  // función corre también sobre el auth.js de main, donde no existen: el
  // registro de entonces era una sola pantalla.
  vm.runInContext('typeof renderRegistroPaso2 === "function" ? renderRegistroPaso2() : (app.innerHTML = "");', sandbox);
  const registro2 = app.innerHTML;
  vm.runInContext('typeof renderRegistroEnviado === "function" ? renderRegistroEnviado("Dra. Fulana Pérez") : (app.innerHTML = "");', sandbox);
  const enviado = app.innerHTML;
  vm.runInContext('renderLogin2FA("tok");', sandbox);
  const dosfa = app.innerHTML;
  return { login, registro, registro2, enviado, dosfa };
}

// Le saca el selector de idioma, que es lo único nuevo a propósito.
// Se saca la línea entera —sangría incluida—, porque el espacio en blanco
// que la rodea también es parte de lo que se agregó.
const sinSelector = (html) => html.replace(/\n\s*<div style="text-align:center;margin-top:14px;font-size:13px">[\s\S]*?<\/div>/g, "");
// Y el botón de «olvidé mi contraseña» en el login, que es lo otro nuevo a
// propósito de esta sesión. No se saca la pantalla entera de la comparación
// —como se hizo con "registro", que se rediseñó de punta a punta— porque acá
// el resto del login no cambió: sigue valiendo la pena comprobar que un
// cambio de i18n no le mueve una coma al resto de la pantalla, y esto es lo
// único que hay que descontar para poder seguir haciendo esa comprobación.
// Lo mismo con «Tengo un código de estudiante» (public/js/estudiantes.js):
// otro enlace agregado a propósito, que no cambia nada del resto.
const sinOlvide = (html) => html
  .replace(/\n\s*<button class="link" id="lGoOlvide"[^>]*>[\s\S]*?<\/button>/g, "")
  .replace(/\n\s*<button class="link" id="lGoEstudiante"[^>]*>[\s\S]*?<\/button>/g, "");

const antes = execSync(`git -C ${RAIZ} show main:public/js/auth.js`, { encoding: "utf8" });
const ahora = fs.readFileSync(`${RAIZ}/public/js/auth.js`, "utf8");

const viejo = correr(antes, null);
const nuevoEs = correr(ahora, "es");
const nuevoPt = correr(ahora, "pt");

let fallos = 0;
// El registro YA NO se compara contra main: se rediseñó a propósito (dos
// pasos, matrícula profesional obligatoria, y una pantalla de "qué pasa
// ahora" porque la cuenta ya no entra al instante). Comparar una pantalla
// que se cambió adrede contra la versión vieja solo prueba que se cambió.
//
// Login y 2FA sí siguen comparándose: esas no se tocaron, y esta prueba es
// lo que garantiza que el i18n no las movió ni un carácter.
for (const pantalla of ["login", "dosfa"]) {
  const a = viejo[pantalla];
  // sinOlvide es un no-op sobre "dosfa" —ese botón no existe ahí—, así que
  // encadenarla para las dos pantallas no le resta nada a la comprobación.
  const b = sinOlvide(sinSelector(nuevoEs[pantalla]));
  if (a === b) {
    console.log(`✅ ${pantalla} en español: idéntico salvo lo agregado a propósito (${a.length} car.)`);
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
for (const [pantalla, debeEstar] of [["login", true], ["registro", true], ["registro2", false], ["enviado", false], ["dosfa", false]]) {
  const tiene = nuevoEs[pantalla].includes("idioma-opcion");
  const ok = tiene === debeEstar;
  console.log(`${ok ? "✅" : "❌"} selector en ${pantalla}: ${tiene ? "sí" : "no"} (esperado: ${debeEstar ? "sí" : "no"})`);
  if (!ok) fallos++;
}

// En portugués, las etiquetas tienen que cambiar de verdad.
console.log("");
// "Clínica geral" y el botón de crear cuenta viven ahora en el paso 2, así
// que la búsqueda abarca las cuatro pantallas.
const todoPt = nuevoPt.login + nuevoPt.registro + nuevoPt.registro2 + nuevoPt.enviado;
const esperadasPt = ["Telefone", "Senha", "Entrar", "Cadastre-se", "Nome completo", "Criar conta", "Clínica geral"];
const faltan = esperadasPt.filter(x => !todoPt.includes(x));
console.log(faltan.length === 0
  ? `✅ portugués: las ${esperadasPt.length} etiquetas esperadas aparecen`
  : `❌ portugués: faltan ${faltan.join(", ")}`);
if (faltan.length) fallos++;

// Y no debe quedar español suelto en las pantallas en portugués.
//
// Se mira SOLO EL TEXTO VISIBLE, sin etiquetas ni atributos. Buscar sobre el
// HTML crudo daba falsos positivos absurdos: id="rSiguiente" hacía saltar la
// prueba por "Siguiente" mientras el botón mostraba "Continuar". Un id es
// código, no un texto que alguien lea.
const soloTexto = (html) => html.replace(/<[^>]*>/g, " ");
const españolSuelto = ["Contraseña", "Ingresar", "Registrarme", "Teléfono", "Matrícula profesional", "Siguiente"].filter(x => soloTexto(todoPt).includes(x));
console.log(españolSuelto.length === 0
  ? "✅ portugués: no quedó ninguna etiqueta en español"
  : `❌ portugués: quedaron en español → ${españolSuelto.join(", ")}`);
if (españolSuelto.length) fallos++;

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
