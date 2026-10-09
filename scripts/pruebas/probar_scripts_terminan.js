// Symphomed — Que los scripts devuelvan la terminal apenas terminan.
//
// ═══ LO QUE PASABA ═════════════════════════════════════════════════════════
//
// Cada script que se conecta a la base esperaba la conexión con un reloj de
// 30 segundos «por si la base no contesta». La base contestaba en un
// segundo, el script hacía lo suyo y mostraba el resultado… y el reloj
// seguía corriendo: la terminal quedaba colgada 30 segundos más, sin decir
// nada. En el servidor eso es crear un código de estudiante, o hacer un
// respaldo antes de desplegar, y quedarse mirando una terminal que parece
// trabada.
//
// Se revisan todos los scripts con ese reloj (que no lo dejen retener la
// terminal), y se corren los que solo leen, contra una base de prueba.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

console.log("── 1. El reloj de la conexión no retiene la terminal ──");
const RELOJ = /setTimeout\(\(\) => reject\(new Error\("MongoDB no respondió en 30 segundos"\)\), 30000\)(\.unref\(\))?/g;
const conReloj = fs.readdirSync(path.join(RAIZ, "scripts")).filter(f => f.endsWith(".js"))
  .map(f => ({ f, relojes: [...fs.readFileSync(path.join(RAIZ, "scripts", f), "utf8").matchAll(RELOJ)] }))
  .filter(x => x.relojes.length);
verificar(`${conReloj.length} scripts esperan la base con un reloj`, conReloj.length >= 9);
const sinUnref = conReloj.filter(x => x.relojes.some(m => !m[1])).map(x => x.f);
verificar(`  ...y en todos el reloj no retiene la terminal (.unref())${sinUnref.length ? `: faltan ${sinUnref.join(", ")}` : ""}`, sinUnref.length === 0);

// Los que solo leen: se pueden correr sin miedo contra una base vacía.
const SOLO_LEEN = [
  ["codigos_estudiante.js", "listar"],
  ["estudio_reportes.js"],
  ["banco_estudio.js"],
  ["errores_pantalla.js"],
  ["limpiar_notas.js"],
  ["regenerar_nota.js", "Nadie Inexistente"],
];

function correr(uri, args) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    let ultima = 0, salida = "";
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", args[0]), ...args.slice(1)],
      { cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri } });
    const anotar = (d) => { salida += d; ultima = Date.now() - inicio; };
    h.stdout.on("data", anotar);
    h.stderr.on("data", anotar);
    h.stdin.end();
    const corte = setTimeout(() => h.kill(), 60000);
    h.on("exit", (codigo) => { clearTimeout(corte); resolve({ codigo, total: Date.now() - inicio, ultima, salida }); });
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) {
    console.log("⏭️  Punto 2 SALTEADO: no hay base de prueba. Esto NO es un ✅.");
    process.exit(fallos === 0 ? 0 : 1);
  }
  console.log("\n── 2. Los que solo leen, de verdad ──");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "scripts_terminan";
  try {
    const resultados = await Promise.all(SOLO_LEEN.map(args => correr(uri, args)));
    SOLO_LEEN.forEach((args, i) => {
      const r = resultados[i];
      verificar(`${args.join(" ")}: termina en ${(r.total / 1000).toFixed(1)} s (antes, más de 30)`, r.codigo === 0 && r.total < 15000);
      if (r.codigo !== 0) console.log("   " + r.salida.split("\n").slice(-4).join("\n   "));
    });
  } finally {
    await mongod.stop().catch(() => {});
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
