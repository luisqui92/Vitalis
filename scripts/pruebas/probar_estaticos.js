// Vitalis — Que nunca se sirva código viejo con cara de nuevo.
//
// Los estáticos se sirven precomprimidos (.br) cuando el navegador los
// acepta, que es siempre. Si ese .br quedó atrasado respecto del .js, el
// navegador recibe LA VERSIÓN ANTERIOR del código: se despliega un arreglo,
// se reinicia, y en pantalla no cambia nada.
//
// Es el peor tipo de bug porque miente hacia arriba. El arreglo está en el
// servidor, el commit es el correcto, el deploy salió bien — y el síntoma
// sigue igual, así que uno va a buscar la causa a cualquier otro lado. Pasó,
// y costó una tarde entera.
//
// La ventana existe de verdad: generar() regenera los .br en segundo plano
// DESPUÉS de que el servidor ya empezó a responder.
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const zlib = require("zlib");
const RAIZ = path.join(__dirname, "..", "..");
const { servirComprimidos } = require(path.join(RAIZ, "services", "estaticosComprimidos"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function pedir(puerto, ruta, brotli) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: puerto, path: ruta, method: "GET",
      headers: brotli ? { "accept-encoding": "br" } : { "accept-encoding": "identity" },
    }, (res) => {
      const trozos = [];
      res.on("data", (c) => trozos.push(c));
      res.on("end", () => {
        const crudo = Buffer.concat(trozos);
        const comprimido = res.headers["content-encoding"] === "br";
        resolve({
          estado: res.statusCode,
          comprimido,
          texto: comprimido ? zlib.brotliDecompressSync(crudo).toString() : crudo.toString(),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitalis-estaticos-"));
  const js = path.join(dir, "app.js");

  // El .br dice lo viejo; el .js dice lo nuevo. Exactamente lo que queda
  // justo después de un despliegue, antes de que termine de comprimir.
  fs.writeFileSync(js, "const VERSION = 'NUEVA';");
  fs.writeFileSync(js + ".br", zlib.brotliCompressSync(Buffer.from("const VERSION = 'VIEJA';")));
  const viejo = Date.now() - 60_000;
  fs.utimesSync(js + ".br", new Date(viejo), new Date(viejo));

  const express = require("express");
  const app = express();
  app.use(servirComprimidos(dir));
  app.use(express.static(dir));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;

  console.log("── 1. Un .br atrasado no se sirve ──");
  const atrasado = await pedir(puerto, "/app.js", true);
  verificar("responde 200", atrasado.estado === 200);
  verificar("manda el código NUEVO, no el comprimido viejo",
    atrasado.texto.includes("NUEVA"));
  verificar("  ...aunque eso signifique mandarlo sin comprimir",
    atrasado.comprimido === false);

  console.log("\n── 2. Un .br al día sí se sirve comprimido ──");
  // Lo normal: el ahorro de ancho de banda tiene que seguir funcionando, o
  // el arreglo de arriba habría sido "desactivemos brotli".
  fs.writeFileSync(js + ".br", zlib.brotliCompressSync(Buffer.from("const VERSION = 'NUEVA';")));
  const alDia = await pedir(puerto, "/app.js", true);
  verificar("viene comprimido", alDia.comprimido === true);
  verificar("  ...y con el contenido correcto", alDia.texto.includes("NUEVA"));

  console.log("\n── 3. A quien no pide brotli se le manda el original ──");
  const sinBrotli = await pedir(puerto, "/app.js", false);
  verificar("sin comprimir", sinBrotli.comprimido === false);
  verificar("  ...y con el contenido correcto", sinBrotli.texto.includes("NUEVA"));

  await new Promise((r) => servidor.close(r));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 la prueba se cayó:", e.stack || e.message);
  process.exit(1);
});
