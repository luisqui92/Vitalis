// Symphomed — La agenda no puede colgar el servidor (services/agenda.js,
// routes/citas.js).
//
// El cálculo de horarios libres avanza de a una consulta por vez. Con una
// duración de −30 minutos retrocedía para siempre, y con 0,001 daba miles de
// millones de vueltas: el proceso entero quedaba colgado, para todos. Lo
// podía provocar cualquier cuenta guardando ese número en su horario, o el
// asistente de voz pidiendo mil millones de días (revisión integral del 11
// de octubre de 2026, S07). Lo que se prueba:
//   1. El cálculo, con lo que ya pudiera estar guardado mal, termina y usa
//      valores sanos. Corre en otro proceso con un tiempo máximo: si se
//      colgara, la prueba lo dice en vez de colgarse ella también.
//   2. Al guardar el horario: una duración o un horario imposibles → 400.
//   3. Al crear una cita a mano: una duración imposible → 400.
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
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
    req.setTimeout(10000, () => req.destroy(new Error("sin respuesta")));
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// ─── 1. El cálculo, en otro proceso y con reloj ─────────────────────────────
// Un médico como podría haber quedado guardado antes del arreglo: la base de
// mentira devuelve lo que se le pida.
function calcular(medico, dias, extra = "") {
  const codigo = `
    const path = require("path");
    const M = require(path.join(${JSON.stringify(RAIZ)}, "db", "models"));
    const medico = ${JSON.stringify(medico)};
    // Una lista enorme no entra en la línea de comandos: se arma acá.
    if (medico.franjas) medico.horarioAtencion = Array.from({ length: medico.franjas }, (_, i) => ({ diaSemana: i % 7, horaInicio: "08:00", horaFin: "17:00" }));
    M.Medico.findOne = () => ({ lean: async () => medico, select: () => ({ lean: async () => medico }) });
    M.Cita.find = () => ({ select: () => ({ lean: async () => [] }) });
    const agenda = require(path.join(${JSON.stringify(RAIZ)}, "services", "agenda"));
    (async () => {
      const dias = await agenda.obtenerHorariosDisponibles(medico.phone, ${JSON.stringify(dias)});
      const slots = dias.flatMap(d => d.slots.map(s => new Date(s).getTime()));
      const saltos = slots.slice(1).map((s, i) => s - slots[i]).filter(x => x > 0);
      const resultado = { dias: dias.length, slots: slots.length, salto: saltos.length ? Math.min(...saltos) / 60000 : null };
      ${extra}
      console.log("@@" + JSON.stringify(resultado));
      process.exit(0);
    })().catch(e => { console.log("@@" + JSON.stringify({ error: e.message })); process.exit(1); });`;
  const inicio = Date.now();
  const r = spawnSync(process.execPath, ["-e", codigo], {
    cwd: RAIZ, encoding: "utf8", timeout: 15000,
    // Una dirección a la que nadie contesta: los modelos se conectan solos al
    // cargarse, y acá no hace falta la base.
    env: { ...process.env, MONGODB_URI: "mongodb://127.0.0.1:1/agenda-limites" },
  });
  const linea = (r.stdout || "").split("\n").find(l => l.startsWith("@@"));
  return { colgado: r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM", ms: Date.now() - inicio, ...(linea ? JSON.parse(linea.slice(2)) : {}) };
}

const TODA_LA_SEMANA = [0, 1, 2, 3, 4, 5, 6].map(d => ({ diaSemana: d, horaInicio: "08:00", horaFin: "17:00" }));
const base = { phone: "70099001", horarioAtencion: TODA_LA_SEMANA, zonaHoraria: "America/La_Paz" };

console.log("── 1. El cálculo termina aunque lo guardado esté mal ──");
let r = calcular({ ...base, duracionConsultaMinutos: -30 }, 7);
verificar(`una duración de −30 minutos guardada → termina (${r.ms} ms) y usa media hora`, !r.colgado && r.slots > 0 && r.salto === 30);
r = calcular({ ...base, duracionConsultaMinutos: 0.001 }, 7);
verificar(`una de 0,001 minutos → termina (${r.ms} ms) y usa media hora`, !r.colgado && r.slots > 0 && r.salto === 30);
r = calcular({ ...base, duracionConsultaMinutos: 45 }, 7);
verificar("una válida (45 minutos) → la respeta", !r.colgado && r.salto === 45);
r = calcular({ ...base, duracionConsultaMinutos: 30 }, 1e9);
verificar(`mil millones de días pedidos (el asistente de voz) → termina (${r.ms} ms), con 60 días como mucho`, !r.colgado && r.dias > 0 && r.dias <= 61);
r = calcular({ ...base, franjas: 200000, duracionConsultaMinutos: 30 }, 7);
verificar(`doscientas mil franjas guardadas → termina enseguida (${r.ms} ms): se miran 50 como mucho`, !r.colgado && r.slots > 0 && r.ms < 5000);
r = calcular({ ...base, duracionConsultaMinutos: -30 }, 7, `
      const momento = new Date(Date.now() + 86400000);
      M.Cita.find = () => ({ select: () => ({ lean: async () => [{ fecha: momento, duracionMinutos: 30 }] }) });
      resultado.libre = await agenda.horarioSigueLibre(medico.phone, momento, -30);`);
verificar("un horario ya ocupado, preguntado con duración negativa → ocupado (usa media hora)", !r.colgado && r.libre === false);

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de prueba. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "agenda_limites";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "citas"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const P = (m, ruta, cuerpo) => pedir(servidor.address().port, m, ruta, tk, cuerpo);
  await M.Medico.create({ phone: "70099001", nombre: "Dra. Agenda", passwordHash: "x", activo: true });
  const tk = generarToken("70099001", "medico", 36e5);
  const duracionGuardada = async () => (await M.Medico.findOne({ phone: "70099001" }).lean()).duracionConsultaMinutos;

  console.log("\n── 2. Al guardar el horario ──");
  for (const mala of [-30, 0, 0.001, 2, 241, 22.5, "abc"]) {
    r = await P("PATCH", "/medico/horario", { duracionConsultaMinutos: mala });
    verificar(`duración ${JSON.stringify(mala)} → 400 con el motivo, y no se guarda`, r.estado === 400 && /de 5 a 240 minutos/.test(r.cuerpo?.error || "") && await duracionGuardada() === 30);
  }
  r = await P("PATCH", "/medico/horario", { duracionConsultaMinutos: "45" });
  verificar("duración \"45\" (como la manda la pantalla) → se guarda 45", r.estado === 200 && await duracionGuardada() === 45);
  r = await P("PATCH", "/medico/horario", { duracionConsultaMinutos: "" });
  verificar("el campo vacío → no cambia nada", r.estado === 200 && await duracionGuardada() === 45);
  const conHorario = (franjas) => P("PATCH", "/medico/horario", { horarioAtencion: franjas });
  r = await conHorario([{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }, { diaSemana: 2, horaInicio: "", horaFin: "" }]);
  verificar("un horario bien, con un día sin marcar → se guarda solo el día con horas", r.estado === 200
    && (await M.Medico.findOne({ phone: "70099001" }).lean()).horarioAtencion.length === 1);
  for (const [que, franja] of [
    ["una hora que no es hora (25:00)", { diaSemana: 1, horaInicio: "25:00", horaFin: "26:00" }],
    ["el fin antes del inicio", { diaSemana: 1, horaInicio: "17:00", horaFin: "08:00" }],
    ["un día que no existe (9)", { diaSemana: 9, horaInicio: "08:00", horaFin: "12:00" }],
    ["un texto cualquiera", { diaSemana: 1, horaInicio: "mañana", horaFin: "tarde" }],
  ]) {
    r = await conHorario([franja]);
    verificar(`${que} → 400 con el motivo`, r.estado === 400 && /Revisá el horario/.test(r.cuerpo?.error || ""));
  }
  r = await conHorario(Array.from({ length: 51 }, () => ({ diaSemana: 1, horaInicio: "08:00", horaFin: "09:00" })));
  verificar("51 franjas → 400", r.estado === 400);

  console.log("\n── 3. Al crear una cita a mano ──");
  const cita = (extra) => P("POST", "/medico/citas", { fecha: "2030-05-06T10:00", pacienteNombre: "Paciente de prueba", ...extra });
  r = await cita({ duracionMinutos: -30 });
  verificar("con −30 minutos → 400", r.estado === 400 && (await M.Cita.countDocuments()) === 0);
  r = await cita({ duracionMinutos: 20 });
  verificar("con 20 minutos → se guarda con 20", r.estado === 201 && (await M.Cita.findOne().sort({ _id: -1 }).lean())?.duracionMinutos === 20);
  r = await cita({ fecha: "2030-05-06T11:00" });
  verificar("sin duración → la del médico (45)", r.estado === 201 && (await M.Cita.findOne().sort({ _id: -1 }).lean())?.duracionMinutos === 45);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
