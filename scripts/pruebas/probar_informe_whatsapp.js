// Symphomed — El WhatsApp oficial no se presta: el informe sale solo al
// teléfono de la ficha.
//
// El mensaje del informe sale del número oficial y va firmado con el nombre
// del centro. Si el pedido podía traer otro teléfono, cualquier cuenta lo
// usaba para escribirle a quien quisiera con esa identidad (informe de QA del
// 16 de octubre de 2026, B2). Lo que se prueba:
//   1. Con un teléfono en el pedido, el informe va igual al de la ficha.
//   2. Sin teléfono en la ficha no sale, aunque el pedido traiga uno.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// WhatsApp de mentira: se guarda lo que se iba a mandar.
const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
const enviados = [];
meta.enviarTextoOPlantilla = async (destino, texto) => { enviados.push({ destino, texto }); return { ok: true }; };

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "informe_whatsapp";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  for (const modelo of [M.MembreteEmitido, M.Informe, M.Membrete]) await modelo.syncIndexes();

  const MED = "70097001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Imagen", passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);
  const FICHA = "59170000097";
  const conTelefono = await M.Paciente.create({ medicoPhone: MED, nombre: "Ana Pérez", telefono: FICHA });
  const sinTelefono = await M.Paciente.create({ medicoPhone: MED, nombre: "Bruno Díaz" });

  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  require(path.join(RAIZ, "routes", "informes"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);

  const firmado = async (pacienteId) => {
    const id = (await P("POST", `/medico/pacientes/${pacienteId}/informes`, tk, { titulo: "Radiografía de tórax" })).cuerpo.informe._id;
    await P("PATCH", `/medico/informes/${id}`, tk, { conclusion: "Sin hallazgos patológicos." });
    await P("POST", `/medico/informes/${id}/firmar`, tk);
    return id;
  };

  console.log("── 1. Con un teléfono en el pedido, va igual al de la ficha ──");
  const id1 = await firmado(conTelefono._id);
  let r = await P("POST", `/medico/informes/${id1}/enviar`, tk, { telefono: "+55 11 99999-0000" });
  verificar(`sale (${r.estado}) al teléfono de la ficha, no al del pedido (${enviados.at(-1)?.destino})`,
    r.estado === 200 && enviados.length === 1 && enviados[0].destino === FICHA && r.cuerpo?.enviadoA === FICHA);
  verificar("  ...y al número del pedido no le llegó nada", !enviados.some(e => e.destino === "5511999990000"));
  r = await P("POST", `/medico/informes/${id1}/enviar`, tk);
  verificar("sin nada en el pedido, como lo manda la pantalla: a la ficha", r.estado === 200 && enviados.at(-1)?.destino === FICHA);

  console.log("\n── 2. Sin teléfono en la ficha no sale ──");
  const id2 = await firmado(sinTelefono._id);
  const antes = enviados.length;
  r = await P("POST", `/medico/informes/${id2}/enviar`, tk, { telefono: "59170000000" });
  verificar(`aunque el pedido traiga uno → 400, que diga dónde cargarlo (${r.cuerpo?.error})`,
    r.estado === 400 && /ficha/.test(r.cuerpo?.error || "") && enviados.length === antes);
  const sinCompartir = await M.Informe.findById(id2).lean();
  verificar("  ...y el informe no queda como compartido", !sinCompartir.compartidoEn);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
