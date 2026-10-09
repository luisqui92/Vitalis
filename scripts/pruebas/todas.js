// Symphomed — Corre todas las pruebas (scripts/pruebas/probar_*.js), de a una.
//
//   node scripts/pruebas/todas.js                todas
//   node scripts/pruebas/todas.js estudiantes    las que tienen «estudiantes» en el nombre
//   node scripts/pruebas/todas.js --estricto     una SALTEADA cuenta como falla
//   npm test                                     lo mismo que --estricto: lo que tiene que
//                                                correr la integración continua
//
// Una prueba se SALTEA (y sale bien) cuando le falta algo de afuera: la base
// de prueba (mongodb-memory-server) o el navegador (Playwright). En la compu
// de alguien eso sirve para correr lo que se pueda; para dar el visto bueno a
// una entrega no: una prueba que no corrió no probó nada (informe de QA del 9
// de octubre de 2026). Por eso --estricto.
//
// Cada prueba corre en su propio proceso, con un tope de 15 minutos, y su
// salida queda en un archivo. Al final dice cuáles fallaron y cuáles se
// saltearon, y sale con error si hubo alguna falla (o alguna salteada, con
// --estricto).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const DIR = __dirname;
const TOPE_MS = 15 * 60 * 1000;
const args = process.argv.slice(2);
const estricto = args.includes("--estricto") || process.env.PRUEBAS_ESTRICTAS === "1";
const filtros = args.filter(a => !a.startsWith("--"));

const pruebas = fs.readdirSync(DIR)
  .filter(n => /^probar_.*\.js$/.test(n))
  .filter(n => !filtros.length || filtros.some(f => n.includes(f)))
  .sort();
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), "symphomed-pruebas-"));

function correr(nombre) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const log = fs.createWriteStream(path.join(SALIDA, nombre.replace(/\.js$/, ".log")));
    let texto = "";
    const hijo = spawn(process.execPath, [path.join(DIR, nombre)], { cwd: path.join(DIR, "..", ".."), env: process.env });
    const anotar = (c) => { texto += c; log.write(c); };
    hijo.stdout.on("data", anotar);
    hijo.stderr.on("data", anotar);
    const tope = setTimeout(() => { anotar("\n[todas.js] pasó el tope de 15 minutos: se corta\n"); hijo.kill("SIGKILL"); }, TOPE_MS);
    hijo.on("close", (codigo) => {
      clearTimeout(tope);
      log.end();
      const fallos = texto.split("\n").filter(l => l.startsWith("❌")).length;
      resolve({ nombre, codigo, salteada: /SALTEAD/.test(texto), fallos, segundos: Math.round((Date.now() - inicio) / 1000) });
    });
  });
}

(async () => {
  console.log(`Symphomed — ${pruebas.length} prueba(s), Node ${process.version}${estricto ? ", estricto (una salteada es una falla)" : ""}`);
  console.log(`Salida de cada una en ${SALIDA}\n`);
  const resultados = [];
  for (const nombre of pruebas) {
    const r = await correr(nombre);
    resultados.push(r);
    const marca = r.codigo !== 0 ? "❌" : r.salteada ? "⏭️ " : "✅";
    console.log(`${marca} ${nombre} (${r.segundos} s)${r.codigo !== 0 ? ` — salió con ${r.codigo}${r.fallos ? `, ${r.fallos} ❌` : ""}` : r.salteada ? " — SALTEADA, no probó nada" : ""}`);
  }
  const fallaron = resultados.filter(r => r.codigo !== 0);
  const salteadas = resultados.filter(r => r.codigo === 0 && r.salteada);
  console.log(`\n${resultados.length - fallaron.length - salteadas.length} bien, ${fallaron.length} con fallas, ${salteadas.length} salteada(s).`);
  if (fallaron.length) console.log(`Con fallas: ${fallaron.map(r => r.nombre).join(", ")}`);
  if (salteadas.length) console.log(`Salteadas: ${salteadas.map(r => r.nombre).join(", ")}${estricto ? " (cuentan como falla)" : ""}`);
  process.exit(fallaron.length || (estricto && salteadas.length) ? 1 : 0);
})();
