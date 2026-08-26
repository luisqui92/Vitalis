// Vitalis — ¿Arranca de verdad?
//
// Todas las demás pruebas cargan pedazos: las rutas por un lado, el frontend
// en un sandbox por el otro. Ninguna levanta index.js. Y hay cosas que solo
// se rompen ahí:
//
//   · los paquetes de idioma (public/i18n/es.js y pt.js) están en
//     .gitignore y se ARMAN AL ARRANCAR, a partir de public/i18n/<idioma>/.
//     Si eso falla en el servidor, la app se despliega sin un solo texto y
//     el error no aparece en ninguna prueba de las otras;
//   · un require() circular o un archivo que se renombró y quedó
//     referenciado tumba el proceso entero antes de escuchar el puerto;
//   · index.html puede quedar pidiendo un <script> que ya no existe.
//
// Esta prueba levanta el servidor real contra una base descartable, le pega
// por HTTP y lo apaga. Es el último control antes de desplegar.
//
// No hace falta apagar los respaldos automáticos: el primero sale a los dos
// minutos de arrancar (ver services/backup.js) y esto termina mucho antes.
// Si algún día tarda más, va a intentar respaldar la base descartable —
// molesto, no peligroso, pero conviene saberlo.
//
//   MONGO_PRUEBAS="mongodb://localhost:27017/vitalis_prueba" node scripts/pruebas/probar_arranque.js
//
// o, sin Mongo instalado: npm i --no-save mongodb-memory-server
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3987; // uno poco usado, para no chocar con un Vitalis ya corriendo

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function traer(ruta) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => resolve({ estado: res.statusCode, texto, tipo: res.headers["content-type"] || "" }));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("timeout")); });
  });
}

async function esperarQueLevante(proceso, salida) {
  for (let i = 0; i < 60; i++) {
    if (proceso.exitCode !== null) {
      throw new Error(`el proceso murió al arrancar (código ${proceso.exitCode}):\n${salida.texto.slice(-2500)}`);
    }
    try {
      const r = await traer("/health");
      if (r.estado === 200) return;
    } catch { /* todavía no escucha */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`no levantó en 30 segundos:\n${salida.texto.slice(-2500)}`);
}

async function conseguirMongo() {
  if (process.env.MONGO_PRUEBAS) {
    const nombre = (process.env.MONGO_PRUEBAS.split("/").pop() || "").split("?")[0].toLowerCase();
    if (!/prueba|test/.test(nombre)) {
      console.error(`❌ MONGO_PRUEBAS apunta a "${nombre}", que no dice ser de prueba. No.`);
      process.exit(1);
    }
    return { uri: process.env.MONGO_PRUEBAS, detener: async () => {} };
  }
  let MongoMemoryServer;
  for (const c of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(c)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) return null;
  const s = await MongoMemoryServer.create();
  return { uri: s.getUri() + "vitalis_prueba", detener: () => s.stop() };
}

async function main() {
  const mongo = await conseguirMongo();
  if (!mongo) {
    console.log("⏭️  SALTEADA: no hay base de datos para probar.");
    console.log("   MONGO_PRUEBAS=... o npm i --no-save mongodb-memory-server");
    console.log("   Esto NO es un ✅: no se comprobó que Vitalis arranque.");
    process.exit(0);
  }

  const salida = { texto: "" };
  const proceso = spawn(process.execPath, [path.join(RAIZ, "index.js")], {
    cwd: RAIZ,
    env: {
      ...process.env,
      MONGODB_URI: mongo.uri,
      PORT: String(PUERTO),
      JWT_SECRET: process.env.JWT_SECRET || "x".repeat(64),
      // Requeridas por validateConfig. No se usan: esta prueba no llama a
      // ningún servicio de afuera.
      OPENAI_KEY: process.env.OPENAI_KEY || "sk-de-prueba",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proceso.stdout.on("data", (d) => { salida.texto += d; });
  proceso.stderr.on("data", (d) => { salida.texto += d; });

  try {
    await esperarQueLevante(proceso, salida);
    console.log("── 1. El proceso levanta ──");
    verificar("responde /health", (await traer("/health")).estado === 200);
    verificar("no imprimió ningún error fatal al arrancar", !/❌|Cannot find module|is not defined/.test(salida.texto));

    console.log("\n── 2. Los paquetes de idioma se arman al arrancar ──");
    // Ésta es la razón principal de esta prueba: los paquetes están en
    // .gitignore, así que en el servidor NO existen hasta que Vitalis los
    // genera. Si esto falla, se despliega una app sin textos.
    for (const idioma of ["es", "pt"]) {
      const b = await traer(`/i18n/${idioma}.js`);
      verificar(`/i18n/${idioma}.js se sirve y no está vacío`, b.estado === 200 && b.texto.length > 5000);
      verificar(`  ...y trae las claves de la clínica`, b.texto.includes("clin.agenda"));
    }
    const es = await traer("/i18n/es.js");
    const pt = await traer("/i18n/pt.js");
    verificar("el español y el portugués son distintos (no se copió uno)", es.texto !== pt.texto);

    console.log("\n── 3. La app se sirve entera ──");
    const raiz = await traer("/");
    verificar("/ devuelve el index.html", raiz.estado === 200 && raiz.texto.includes("<title>Vitalis"));

    // Que index.html no pida un archivo que ya no existe: es exactamente el
    // error que deja una pantalla en blanco y no falla en ninguna otra parte.
    const pedidos = [...raiz.texto.matchAll(/<script src="(\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
    verificar(`index.html pide ${pedidos.length} scripts`, pedidos.length > 30);
    const faltantes = [];
    for (const ruta of pedidos) {
      const r = await traer(ruta);
      if (r.estado !== 200 || r.texto.length === 0) faltantes.push(`${ruta} (${r.estado})`);
    }
    verificar(
      faltantes.length === 0 ? "todos los scripts de index.html existen" : `FALTAN: ${faltantes.join(", ")}`,
      faltantes.length === 0
    );

    console.log("\n── 4. Las rutas nuevas están montadas y cerradas ──");
    verificar("/admin/resumen existe y pide sesión", (await traer("/admin/resumen")).estado === 401);
    verificar("/medico/personas/buscar existe y pide sesión", (await traer("/medico/personas/buscar?q=abc")).estado === 401);
    verificar("/admin/agenda existe y pide sesión", (await traer("/admin/agenda")).estado === 401);
  } catch (e) {
    console.log(`❌ ${e.message}`);
    fallos++;
  } finally {
    proceso.kill("SIGTERM");
    await new Promise(r => setTimeout(r, 500));
    if (proceso.exitCode === null) proceso.kill("SIGKILL");
    await mongo.detener();
  }

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 la prueba se cayó:", e.stack || e.message);
  process.exit(1);
});
