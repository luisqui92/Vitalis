// Symphomed — Que dos archivos del frontend no definan la misma función.
//
// ═══ POR QUÉ ═════════════════════════════════════════════════════════════
//
// La app no tiene empaquetador: cada archivo de public/js/ se carga con su
// propio <script> y todo lo que declara en el nivel de arriba es global.
// Si dos archivos declaran `function fechaCorta`, gana el que se carga
// ÚLTIMO, en silencio y para toda la app — sin error, sin aviso en la
// consola.
//
// Pasó de verdad: ganaderia.js trajo su propia fechaCorta y pisó la de
// i18n.js, que es la que trata bien las fechas civiles. Resultado posible:
// la FUM y la FPP de un embarazo mostradas un día antes en Bolivia. Y
// ganaderia.js también traía un diaCorto que habría roto los días de la
// agenda. Ninguna prueba de pantalla lo veía, porque cada pantalla andaba
// bien sola.
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="\/js\/([^"]+\.js)"><\/script>/g)].map(m => m[1]);
verificar(`index.html carga ${scripts.length} scripts de public/js`, scripts.length > 10);

// Declaraciones en el nivel de arriba del archivo (sin sangría): las únicas
// que quedan globales. Una función adentro de otra no choca con nada.
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const quien = new Map();
for (const archivo of scripts) {
  const codigo = fs.readFileSync(path.join(RAIZ, "public", "js", archivo), "utf8");
  for (const m of codigo.matchAll(DECL)) {
    const nombre = m[1] || m[2];
    if (!quien.has(nombre)) quien.set(nombre, []);
    quien.get(nombre).push(archivo);
  }
}

const repetidos = [...quien.entries()].filter(([, archivos]) => archivos.length > 1);
verificar("ningún nombre global está declarado en dos archivos", repetidos.length === 0);
for (const [nombre, archivos] of repetidos) console.log(`   «${nombre}» en: ${archivos.join(", ")}`);

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
