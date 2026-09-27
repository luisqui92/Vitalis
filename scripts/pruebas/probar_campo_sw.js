// Symphomed Ganadería — el service worker de la página del dueño.
//
// Lo que no puede pasar:
//   · Que responda desde el caché los DATOS de una finca o una CARGA. Los
//     datos viejos los muestra campo.js con su hora; una carga respondida
//     desde un caché sería una carga que nunca llegó.
//   · Que la lista de archivos tenga uno que no existe: cache.addAll falla
//     entero y la página deja de abrir sin señal, sin ningún error visible.
//   · Que se meta con algo fuera de /campo/.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const codigo = fs.readFileSync(path.join(RAIZ, "public", "campo-sw.js"), "utf8");
const oyentes = {};
const contexto = {
  self: { addEventListener: (tipo, fn) => { oyentes[tipo] = fn; }, location: { origin: "https://app.symphomed.com" } },
  caches: {}, fetch: () => Promise.reject(new Error("sin red")), URL, Response: { error: () => null }, Promise,
};
vm.createContext(contexto);
vm.runInContext(codigo + "\n;this.__ARCHIVOS = ARCHIVOS;", contexto);

const LLAVE = "a".repeat(32);
function responde(url, { method = "GET", mode = "cors" } = {}) {
  let respondio = false;
  oyentes.fetch({ request: { url: `https://app.symphomed.com${url}`, method, mode }, respondWith: () => { respondio = true; } });
  return respondio;
}

console.log("── Qué atiende y qué no ──");
verificar("la página /campo/<llave> (navegación): sí", responde(`/campo/${LLAVE}`, { mode: "navigate" }));
verificar("los datos /campo/<llave>/datos: NO (van a la red)", !responde(`/campo/${LLAVE}/datos`));
verificar("el manifiesto: NO", !responde(`/campo/${LLAVE}/manifest.webmanifest`));
verificar("una carga (PUT producción): NO", !responde(`/campo/${LLAVE}/lotes/x/produccion`, { method: "PUT" }));
verificar("una carga (POST muertes): NO", !responde(`/campo/${LLAVE}/lotes/x/mortalidad`, { method: "POST" }));
verificar("el CSS y el JS de la página: sí", responde("/estilos.css") && responde("/js/campo.js"));
verificar("el JS de la app médica: NO", !responde("/js/pacientes.js"));
verificar("una ruta médica: NO", !responde("/medico/pacientes"));
verificar("otro dominio: NO", (() => {
  let r = false;
  oyentes.fetch({ request: { url: "https://otro.com/estilos.css", method: "GET", mode: "cors" }, respondWith: () => { r = true; } });
  return !r;
})());

console.log("\n── Los archivos que guarda existen ──");
// /i18n/es.js y pt.js se arman al arrancar (services/i18nBundle.js): se
// comprueba que existan sus fuentes.
for (const ruta of contexto.__ARCHIVOS) {
  const generado = /^\/i18n\/(es|pt)\.js$/.exec(ruta);
  const existe = generado
    ? fs.existsSync(path.join(RAIZ, "public", "i18n", generado[1]))
    : fs.existsSync(path.join(RAIZ, "public", ruta));
  verificar(`  ${ruta}`, existe);
}

console.log("\n── La página la registra con el scope correcto ──");
const campoJs = fs.readFileSync(path.join(RAIZ, "public", "js", "campo.js"), "utf8");
verificar("campo.js registra /campo-sw.js con scope /campo/", /register\("\/campo-sw\.js",\s*\{\s*scope:\s*"\/campo\/"\s*\}\)/.test(campoJs));
const swMedico = fs.readFileSync(path.join(RAIZ, "public", "sw.js"), "utf8");
verificar("el service worker de la app médica sigue sin cachear nada", !/caches\./.test(swMedico));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
