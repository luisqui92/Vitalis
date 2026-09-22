// Symphomed — idiomaDelDispositivo() (public/js/i18n.js): que el primer
// idioma que ve un médico sea el del aparato, no español a secas.
//
// Se corre en un sandbox con un `navigator` de mentira porque es
// exactamente lo que probar_auth.js NO cubre: ese archivo fija
// MEDICO_IDIOMA a mano para cada corrida, así que nunca ejercita esta
// función. Acá se prueba la función sola, con distintos valores de
// navigator.language / navigator.languages.
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function detectarCon(navigatorMock) {
  const sandbox = {
    navigator: navigatorMock,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "i18n.js"), "utf8"), sandbox);
  return vm.runInContext("idiomaDelDispositivo()", sandbox);
}

// ═══ CASOS ═══════════════════════════════════════════════════════════════
verificar("un celular en portugués de Brasil da «pt»",
  detectarCon({ language: "pt-BR", languages: ["pt-BR", "en-US"] }) === "pt");

verificar("un celular en portugués sin variante también da «pt»",
  detectarCon({ language: "pt", languages: ["pt"] }) === "pt");

verificar("un celular en español de Bolivia da «es»",
  detectarCon({ language: "es-BO", languages: ["es-BO", "en-US"] }) === "es");

verificar("mayúsculas no rompen la detección (es-BR mal tipeado, PT)",
  detectarCon({ language: "PT-br", languages: ["PT-br"] }) === "pt");

// El caso real que motivó esto: un médico brasileño que abre Symphomed por
// primera vez, sin ninguna cuenta ni preferencia guardada todavía.
verificar("un idioma que Symphomed no habla (inglés) cae a español, no rompe",
  detectarCon({ language: "en-US", languages: ["en-US"] }) === "es");

verificar("si el primero de la lista no es soportado pero el segundo sí, usa el segundo",
  detectarCon({ language: "en-US", languages: ["en-US", "pt-BR"] }) === "pt");

verificar("sin navigator.languages, cae a navigator.language solo",
  detectarCon({ language: "pt-BR", languages: [] }) === "pt");

verificar("sin ningún dato de idioma, no rompe: cae a español",
  detectarCon({ language: "", languages: [] }) === "es");

verificar("sin navigator en absoluto (SSR o sandbox de otra prueba), no rompe",
  (() => {
    const sandbox = { localStorage: { getItem: () => null, setItem: () => {} }, document: { documentElement: {} } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "i18n.js"), "utf8"), sandbox);
    return vm.runInContext("idiomaDelDispositivo()", sandbox) === "es";
  })());

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
