// Symphomed — Un estudio con fecha inválida no deja el archivo en disco.
//
// POST /medico/pacientes/:id/estudios guardaba el archivo (hasta 20 MB) y
// recién después hacía el Estudio.create. Con una fecha que no es fecha
// («no-es-fecha»), new Date() da Invalid Date, el create falla, y el archivo
// quedaba en uploads/estudios sin ningún registro que lo apunte: nadie lo
// ve, nadie lo borra, y ocupa lugar en cada respaldo (auditoría de QA, ronda
// de verificación). Lo que se prueba:
//   1. Con una fecha inválida → 400 y no aparece ningún archivo nuevo.
//   2. Con una fecha que existe → 201 y queda exactamente un archivo nuevo.
const path = require("path");
const fs = require("fs");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function subir(puerto, ruta, token, archivo, tipo) {
  return new Promise((resolve) => {
    const headers = { authorization: "Bearer " + token, "content-type": tipo, "content-length": archivo.length };
    const req = http.request({ host: "127.0.0.1", port: puerto, method: "POST", path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { j = { crudo: t }; } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    req.write(archivo);
    req.end();
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "estudio_fecha";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { DIR_ESTUDIOS } = require(path.join(RAIZ, "services", "archivosEstudio"));
  await mongoose.connection.dropDatabase();

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "estudios"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;

  const MED = "70088001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Estudios", passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);
  const paciente = await M.Paciente.create({ medicoPhone: MED, nombre: "Ana Pérez" });
  // Un PNG de verdad no hace falta: la ruta guarda lo que llega con el tipo
  // que dice el encabezado.
  const archivo = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
  const enDisco = () => new Set(fs.readdirSync(DIR_ESTUDIOS));
  const nuevos = (antes) => [...enDisco()].filter(n => !antes.has(n));

  console.log("── 1. Fecha inválida ──");
  for (const fecha of ["no-es-fecha", "2026-99-99"]) {
    const antes = enDisco();
    const r = await subir(puerto, `/medico/pacientes/${paciente._id}/estudios?tipo=radiografia&nombre=${encodeURIComponent("Tórax")}&fecha=${encodeURIComponent(fecha)}`, tk, archivo, "image/png");
    const sobran = nuevos(antes);
    verificar(`fecha «${fecha}» → 400 que lo dice (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && /fecha/.test(r.cuerpo?.error || ""));
    verificar(`  ...y no queda ningún archivo en disco (${sobran.length} nuevos)`, sobran.length === 0);
    for (const n of sobran) fs.rmSync(path.join(DIR_ESTUDIOS, n), { force: true });
  }
  verificar("  ...ni ningún estudio en la base", (await M.Estudio.countDocuments()) === 0);

  console.log("\n── 2. Fecha que existe ──");
  const antes = enDisco();
  const r = await subir(puerto, `/medico/pacientes/${paciente._id}/estudios?tipo=radiografia&nombre=${encodeURIComponent("Tórax")}&fecha=2026-09-16`, tk, archivo, "image/png");
  const creados = nuevos(antes);
  verificar(`fecha «2026-09-16» → 201 (${r.estado}${r.estado !== 201 ? ": " + JSON.stringify(r.cuerpo).slice(0, 200) : ""})`, r.estado === 201);
  verificar("  ...con un archivo, y es el del estudio", creados.length === 1 && creados[0] === r.cuerpo?.estudio?.archivoNombre);
  for (const n of creados) fs.rmSync(path.join(DIR_ESTUDIOS, n), { force: true });

  // La auditoría se escribe sin esperar a la respuesta: se le da un momento.
  await new Promise(ok => setTimeout(ok, 200));
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
