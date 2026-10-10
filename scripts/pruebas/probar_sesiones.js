// Symphomed — Una sesión vale mientras valga su cuenta (services/auth.js,
// sesionVigente).
//
// Un token dura 8 horas, y antes valía hasta vencer aunque la cuenta se
// diera de baja, se borrara o le cambiaran la contraseña: seguía entrando, y
// una cuenta de estudiante seguía pidiéndole respuestas a la IA (segunda
// revisión de QA del 9 de octubre de 2026, R02). Lo que se prueba:
//   1. Las cuentas de siempre (sin los campos nuevos) siguen entrando: el día
//      del despliegue ningún médico tiene «activo» ni «sesionesDesde».
//   2. Desactivada, borrada o con las sesiones cortadas → 401, en las rutas
//      de médico y en las de administración de la clínica.
//   3. Un estudiante dado de baja no le pide nada a la IA, ni por el freno
//      del módulo ni por la ruta.
// El corte en cada flujo real (restablecer la clave, aprobar una baja,
// desvincular de la clínica, convertir a un estudiante) lo prueba la prueba
// de cada uno.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// La IA de mentira: solo cuenta si la llamaron.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
let llamadasIA = 0;
axios.post = async () => {
  llamadasIA++;
  return { data: { choices: [{ message: { content: JSON.stringify({ respuesta: "Hola" }) } }] } };
};

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "sesiones";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken, requireAuth, requireAdmin } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const clinica = await M.Clinica.create({ nombre: "Clínica de Prueba" });
  const express = require("express");
  const app = express();
  app.use(express.json());
  // El módulo de estudiantes, como en index.js (antes de las rutas), y una
  // ruta que le pregunta a la IA: la ayuda de Symphomed.
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  require(path.join(RAIZ, "routes", "asistenteSymphomed"))(app);
  app.get("/medico/prueba-sesion", requireAuth(["medico"]), (req, res) => res.json({ ok: true, quien: req.adminUser.usuario }));
  app.get("/admin/prueba-sesion", requireAdmin, (req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);
  const tk = (phone, rol = "medico", extra = {}) => generarToken(phone, rol, 36e5, extra);

  console.log("── 1. Las cuentas de siempre siguen entrando ──");
  // Como están hoy en producción: sin «activo» ni «sesionesDesde».
  await M.Medico.collection.insertOne({ phone: "70093001", nombre: "Dr. De Antes", passwordHash: "x", createdAt: new Date("2025-01-01") });
  let r = await P("GET", "/medico/prueba-sesion", tk("70093001"));
  verificar("una cuenta sin los campos nuevos (como todas las de producción) → entra", r.estado === 200 && r.cuerpo.quien === "70093001");
  await M.Medico.create({ phone: "70093002", nombre: "Dra. Activa", passwordHash: "x", activo: true });
  verificar("una cuenta activa → entra", (await P("GET", "/medico/prueba-sesion", tk("70093002"))).estado === 200);

  console.log("\n── 2. Sin cuenta, desactivada o con las sesiones cortadas → 401 ──");
  const abiertaAntes = tk("70093002");
  verificar("sin cuenta (el token es de un teléfono que no existe) → 401", (await P("GET", "/medico/prueba-sesion", tk("70093099"))).estado === 401);
  await M.Medico.updateOne({ phone: "70093002" }, { $set: { activo: false } });
  r = await P("GET", "/medico/prueba-sesion", abiertaAntes);
  verificar("desactivada → 401, con «volvé a iniciar sesión»", r.estado === 401 && /iniciar sesión/.test(r.cuerpo?.error || ""));
  await M.Medico.updateOne({ phone: "70093002" }, { $set: { activo: true } });
  verificar("  ...y si la reactivan, vuelve a entrar", (await P("GET", "/medico/prueba-sesion", abiertaAntes)).estado === 200);
  await esperar(5);
  await M.Medico.updateOne({ phone: "70093002" }, { $set: { sesionesDesde: new Date() } });
  verificar("con las sesiones cortadas (clave nueva, permisos nuevos) → la de antes, 401", (await P("GET", "/medico/prueba-sesion", abiertaAntes)).estado === 401);
  verificar("  ...y una sesión nueva entra", (await P("GET", "/medico/prueba-sesion", tk("70093002"))).estado === 200);
  await M.Medico.deleteOne({ phone: "70093001" });
  verificar("borrada → 401", (await P("GET", "/medico/prueba-sesion", tk("70093001"))).estado === 401);
  // La administración de la clínica pasa por otra puerta (requireAdmin).
  await M.Medico.create({ phone: "70093003", nombre: "Administración", passwordHash: "x", activo: true, rol: "admin", clinicaId: clinica._id });
  const tkAdmin = tk("70093003", "admin", { admin: true, clinicaId: String(clinica._id) });
  verificar("la administración de la clínica, con la cuenta activa → entra", (await P("GET", "/admin/prueba-sesion", tkAdmin)).estado === 200);
  await M.Medico.updateOne({ phone: "70093003" }, { $set: { activo: false } });
  verificar("  ...desactivada → 401", (await P("GET", "/admin/prueba-sesion", tkAdmin)).estado === 401);
  verificar("  ...y tampoco entra por las rutas de médico", (await P("GET", "/medico/prueba-sesion", tk("70093003", "admin"))).estado === 403);

  console.log("\n── 3. Un estudiante dado de baja no le pide nada a la IA ──");
  const est = { nivel: "interno", hasta: new Date(Date.now() + 90 * 86400000), horasMes: 6 };
  await M.Medico.create({ phone: "59170093004", nombre: "Est Activo", passwordHash: "x", activo: true, estudiante: est });
  const tkEst = tk("59170093004", "medico", { estudiante: true });
  r = await P("POST", "/medico/asistente", tkEst, { pregunta: "¿Cómo grabo una consulta?", historial: [] });
  const iaConCuenta = llamadasIA;
  verificar("con la cuenta activa, la ayuda contesta (y le pregunta a la IA)", r.estado === 200 && iaConCuenta > 0);
  await M.Medico.updateOne({ phone: "59170093004" }, { $set: { activo: false } });
  r = await P("POST", "/medico/asistente", tkEst, { pregunta: "¿Y ahora?", historial: [] });
  verificar("desactivado, con la sesión abierta → 401, sin llamar a la IA", r.estado === 401 && llamadasIA === iaConCuenta);
  await M.Medico.deleteOne({ phone: "59170093004" });
  r = await P("POST", "/medico/asistente", tkEst, { pregunta: "¿Y ahora?", historial: [] });
  verificar("borrado → 401, sin llamar a la IA", r.estado === 401 && llamadasIA === iaConCuenta);
  r = await P("POST", "/medico/pacientes-virtuales/000000000000000000000000/mensajes", tkEst, { tipo: "pregunta", texto: "hola" });
  verificar("  ...tampoco al paciente virtual: el freno del módulo corta antes (401)", r.estado === 401 && llamadasIA === iaConCuenta);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
