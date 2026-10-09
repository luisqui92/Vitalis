// Symphomed — Que la contraseña cifrada y el secreto del segundo factor no
// salgan nunca hacia el navegador.
//
// ═══ LO QUE PASABA ═════════════════════════════════════════════════════════
//
// Guardar el horario de atención devolvía la cuenta entera del médico: con su
// contraseña cifrada y el secreto del segundo factor (informe de QA del 9 de
// octubre de 2026). Era la sesión del propio médico, pero ese secreto es
// justamente lo que no puede quedar en un navegador: con él cualquiera arma
// los códigos de seis dígitos.
//
//   1. Guardar el horario devuelve el horario, nada más.
//   2. La red: una cuenta convertida a JSON no lleva esos dos datos.
//   3. ...y en la base siguen guardados (la red no puede borrar nada).
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
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({ host: "127.0.0.1", port: puerto, path: ruta, method: metodo, headers: {
      Authorization: "Bearer " + token,
      ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
    } }, (res) => {
      let txt = ""; res.on("data", (c) => { txt += c; });
      res.on("end", () => resolve({ estado: res.statusCode, txt }));
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "sin_secretos";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const HASH = "$2b$10$hashdeprueba.QUENUNCAsaleDELservidor";
  const SECRETO = "JBSWY3DPEHPK3PXPSECRETODEPRUEBA";
  await M.Medico.create({ phone: "70098001", nombre: "Dra. Horario", passwordHash: HASH, activo: true,
    dosFA: { activo: true, secreto: SECRETO, secretoPendiente: "PENDIENTEDEPRUEBA" } });
  const tk = generarToken("70098001", "medico", 36e5);

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "citas"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;

  console.log("── 1. Guardar el horario ──");
  const r = await pedir(puerto, "PATCH", "/medico/horario", tk, { horarioAtencion: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }], duracionConsultaMinutos: 20 });
  const cuerpo = JSON.parse(r.txt || "{}");
  verificar("guarda (200) y devuelve el horario", r.estado === 200 && cuerpo.horario?.duracionConsultaMinutos === 20 && cuerpo.horario?.horarioAtencion?.length === 1);
  verificar("  ...sin la contraseña cifrada ni el secreto del segundo factor", !r.txt.includes(HASH) && !r.txt.includes(SECRETO) && !r.txt.includes("PENDIENTEDEPRUEBA"));
  verificar("  ...ni nada más de la cuenta (solo lo del horario)", Object.keys(cuerpo.horario || {}).sort().join() === "duracionConsultaMinutos,googleCalendarId,horarioAtencion,infoConsultorio");

  console.log("\n── 2. La red: una cuenta convertida a JSON ──");
  const doc = await M.Medico.findOne({ phone: "70098001" });
  const json = JSON.stringify(doc);
  verificar("no lleva la contraseña cifrada ni los secretos del segundo factor", !json.includes(HASH) && !json.includes(SECRETO) && !json.includes("PENDIENTEDEPRUEBA"));
  verificar("  ...pero sí lo demás (si tiene el segundo factor activo, el nombre)", /"activo":true/.test(json) && json.includes("Dra. Horario"));

  console.log("\n── 3. En la base, todo sigue ──");
  const crudo = await M.Medico.collection.findOne({ phone: "70098001" });
  verificar("la contraseña y el secreto siguen guardados (la red no borra nada)", crudo.passwordHash === HASH && crudo.dosFA?.secreto === SECRETO);
  verificar("  ...y el código los sigue leyendo", doc.passwordHash === HASH && doc.dosFA.secreto === SECRETO);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
