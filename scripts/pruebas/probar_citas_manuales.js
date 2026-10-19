// Symphomed — Las citas que carga el médico a mano (routes/citas.js).
//
// La auditoría del comité de QA (octubre de 2026) encontró:
//   · M4: POST /medico/citas no miraba si el horario estaba libre. Dos citas a
//     la misma hora exacta daban un 500, y dos solapadas (10:00 y 10:15) se
//     guardaban las dos. Moverla o volver a confirmarla tampoco miraba nada,
//     una fecha que no es fecha daba 500, un estado inventado se ignoraba en
//     silencio, y el paciente no se enteraba si se la movían o cancelaban.
//   · M11: el paciente que se crea desde una cita quedaba sin código, y sin
//     código la Caja DICOM no le puede archivar los estudios solos.
//
// Lo que se prueba, contra la ruta de verdad y una base de verdad (Google
// Calendar y WhatsApp, de mentira, para ver qué se les pide):
//   1. Crear: se rechaza lo que se superpone, con 409 y no con 500.
//   2. Mover y volver a confirmar: lo mismo; y una cita no choca con su
//      propio evento de Google, que hasta guardarse sigue en la hora vieja.
//   3. Fechas y estados que no existen → 400.
//   4. Los avisos al paciente, en la hora del consultorio.
//   5. El código del paciente creado desde una cita.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

// ─── El reloj, fijo ────────────────────────────────────────────────────────
// Si una cita «ya pasó» depende de la hora: la prueba arranca siempre el
// lunes 6 de mayo de 2030 a las 09:00 de São Paulo, y desde ahí el reloj corre.
const FechaReal = Date;
const DESFASE = FechaReal.UTC(2030, 4, 6, 12, 0, 0) - FechaReal.now();
global.Date = class Date extends FechaReal {
  constructor(...a) { if (a.length) super(...a); else super(FechaReal.now() + DESFASE); }
  static now() { return FechaReal.now() + DESFASE; }
};

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

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "citas_manuales";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;

  // ─── Google Calendar de mentira, con memoria ─────────────────────────────
  // Como el de verdad: los eventos de las citas y los que el médico carga a
  // mano, y freeBusy devuelve en un solo bloque los que se tocan.
  const eventos = new Map();
  let siguienteEvento = 0;
  const google = require(path.join(RAIZ, "services", "googleCalendar"));
  const tramo = (cita) => ({ inicio: new FechaReal(cita.fecha).getTime(), fin: new FechaReal(cita.fecha).getTime() + (cita.duracionMinutos || 30) * 60000 });
  google.crearEvento = async (_cal, cita) => { const id = `ev${++siguienteEvento}`; eventos.set(id, tramo(cita)); return id; };
  google.actualizarEvento = async (_cal, id, cita) => { eventos.set(id, tramo(cita)); return true; };
  google.eliminarEvento = async (_cal, id) => eventos.delete(id);
  google.obtenerOcupadoEnRango = async (_cal, desde, hasta) => {
    const lista = [...eventos.values()].filter(e => e.fin > new FechaReal(desde).getTime() && e.inicio < new FechaReal(hasta).getTime())
      .sort((a, b) => a.inicio - b.inicio);
    const juntos = [];
    for (const e of lista) {
      const ultimo = juntos[juntos.length - 1];
      if (ultimo && e.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, e.fin);
      else juntos.push({ ...e });
    }
    return juntos.map(b => ({ inicio: new FechaReal(b.inicio), fin: new FechaReal(b.fin) }));
  };
  const whatsapp = require(path.join(RAIZ, "services", "metaWhatsapp"));
  const enviados = [];
  whatsapp.enviarTextoOPlantilla = async (destino, texto, respaldo) => { enviados.push({ destino, texto, respaldo }); };

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { localAInstante, fechaCompletaEnZona } = require(path.join(RAIZ, "services", "zonaHoraria"));
  await mongoose.connection.dropDatabase();
  await M.Cita.syncIndexes();
  await M.Paciente.syncIndexes();

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "citas"))(app);
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const MED = "70097001";
  const ZONA = "America/Sao_Paulo";
  await M.Medico.create({ phone: MED, nombre: "Dra. Agenda", passwordHash: "x", activo: true, zonaHoraria: ZONA, googleCalendarId: "dra.agenda@gmail.com" });
  const tk = generarToken(MED, "medico", 36e5);
  const P = (m, ruta, cuerpo) => pedir(servidor.address().port, m, ruta, tk, cuerpo);
  const crear = (hora, extra = {}) => P("POST", "/medico/citas", { fecha: `2030-05-08T${hora}`, pacienteNombre: "Paciente de prueba", ...extra });
  const mover = (id, hora) => P("PATCH", `/medico/citas/${id}`, { fecha: `2030-05-08T${hora}` });
  const confirmadas = () => M.Cita.countDocuments({ medicoPhone: MED, estado: "confirmada" });
  const enSuHora = (hora) => fechaCompletaEnZona(ZONA, localAInstante(ZONA, `2030-05-08T${hora}`));

  console.log("── 1. Crear una cita a mano ──");
  let r = await crear("10:00", { pacienteNombre: "Ana Uno", pacienteTelefono: "59170003001" });
  const c1 = r.cuerpo?.cita;
  verificar("a las 10:00 → 201", r.estado === 201);
  verificar(`  ...y la confirmación al paciente dice la hora del consultorio («${enSuHora("10:00")}»)`,
    enviados.length === 1 && enviados[0].texto.includes(enSuHora("10:00")) && enviados[0].respaldo?.parametros?.[2] === enSuHora("10:00"));
  r = await crear("10:00");
  verificar("otra a las 10:00 exactas → 409 con el motivo, no 500", r.estado === 409 && /se superpone/.test(r.cuerpo?.error || "") && (await confirmadas()) === 1);
  r = await crear("10:15");
  verificar("otra a las 10:15, encima de la de las 10:00 → 409", r.estado === 409 && (await confirmadas()) === 1);
  r = await crear("10:30", { pacienteNombre: "Beto Dos", pacienteTelefono: "59170003002" });
  const c2 = r.cuerpo?.cita;
  verificar("una a las 10:30, pegada pero sin pisarse → 201", r.estado === 201 && (await confirmadas()) === 2);

  console.log("\n── 2. Mover y volver a confirmar ──");
  r = await mover(c2._id, "10:05");
  verificar("mover la de las 10:30 a las 10:05, encima de la otra → 409", r.estado === 409);
  r = await mover(c2._id, "10:00");
  verificar("moverla a las 10:00 exactas → 409, no 500", r.estado === 409);
  r = await crear("14:00", { pacienteNombre: "Caro Tres" });
  const c3 = r.cuerpo?.cita;
  // El médico tiene un evento propio en su Google Calendar de 14:30 a 15:00.
  const t1430 = localAInstante(ZONA, "2030-05-08T14:30").getTime();
  eventos.set("personal", { inicio: t1430, fin: t1430 + 30 * 60000 });
  r = await mover(c3._id, "13:45");
  verificar("correr la de las 14:00 a las 13:45: su propio evento (14:00, pegado al de 14:30) no la frena", r.estado === 200);
  r = await mover(c3._id, "13:55");
  verificar("correrla 10 minutos, menos de lo que dura → 200 (no choca consigo misma)", r.estado === 200);
  r = await mover(c3._id, "14:20");
  verificar("moverla a las 14:20, encima del evento del médico en Google → 409", r.estado === 409);
  r = await crear("16:00");
  const c4 = r.cuerpo?.cita;
  await P("PATCH", `/medico/citas/${c4._id}`, { estado: "cancelada" });
  r = await crear("16:10");
  verificar("con la de las 16:00 cancelada, una a las 16:10 → 201", r.estado === 201);
  r = await P("PATCH", `/medico/citas/${c4._id}`, { estado: "confirmada" });
  verificar("volver a confirmar la de las 16:00, que ahora pisa a la de las 16:10 → 409", r.estado === 409
    && (await M.Cita.findById(c4._id).lean()).estado === "cancelada");

  console.log("\n── 3. Lo que no existe → 400 ──");
  r = await P("PATCH", `/medico/citas/${c2._id}`, { fecha: "mañana" });
  verificar("una fecha que no es fecha → 400, no 500", r.estado === 400);
  r = await P("PATCH", `/medico/citas/${c2._id}`, { estado: "loquesea" });
  verificar("un estado que no existe → 400, y no se toca nada", r.estado === 400 && (await M.Cita.findById(c2._id).lean()).estado === "confirmada");

  console.log("\n── 4. El paciente se entera ──");
  enviados.length = 0;
  r = await mover(c2._id, "11:00");
  verificar(`mover su cita a las 11:00 → le avisa la hora nueva, en la del consultorio («${enSuHora("11:00")}»)`, r.estado === 200
    && enviados.length === 1 && enviados[0].destino === "59170003002" && /se cambió/.test(enviados[0].texto)
    && enviados[0].texto.includes(enSuHora("11:00")) && enviados[0].respaldo?.plantilla === "cita_confirmada");
  enviados.length = 0;
  r = await P("PATCH", `/medico/citas/${c2._id}`, { motivo: "control" });
  verificar("cambiarle solo el motivo → no le avisa nada", r.estado === 200 && enviados.length === 0);
  r = await P("PATCH", `/medico/citas/${c2._id}`, { estado: "cancelada" });
  verificar("cancelarla desde el panel → le avisa, con la fecha que tenía", r.estado === 200 && enviados.length === 1
    && /fue cancelada/.test(enviados[0].texto) && enviados[0].texto.includes(enSuHora("11:00"))
    && enviados[0].respaldo?.plantilla === "cita_cancelada" && enviados[0].respaldo?.parametros?.length === 3);
  enviados.length = 0;
  r = await P("DELETE", `/medico/citas/${c1._id}`);
  verificar("borrar una cita confirmada que tiene por delante → también le avisa", r.estado === 200 && enviados.length === 1
    && enviados[0].destino === "59170003001" && /fue cancelada/.test(enviados[0].texto));
  enviados.length = 0;
  r = await P("DELETE", `/medico/citas/${c2._id}`);
  verificar("borrar una que ya estaba cancelada → no le avisa otra vez", r.estado === 200 && enviados.length === 0);
  const pasada = await M.Cita.create({ medicoPhone: MED, pacienteNombre: "Dani Pasado", pacienteTelefono: "59170003003",
    fecha: localAInstante(ZONA, "2030-05-01T10:00"), estado: "confirmada" });
  r = await P("PATCH", `/medico/citas/${pasada._id}`, { estado: "cancelada" });
  verificar("cancelar una que ya pasó (ordenar la agenda) → no le avisa", r.estado === 200 && enviados.length === 0);

  console.log("\n── 5. El paciente que se crea desde una cita ──");
  r = await crear("17:00", { pacienteNombre: "Nuevo Desde Cita", pacienteTelefono: "59170003999" });
  r = await P("POST", `/medico/citas/${r.cuerpo?.cita?._id}/crear-paciente`, {});
  verificar(`sale con su código, como un alta normal (${r.cuerpo?.paciente?.codigo})`, r.estado === 201 && /^P-\d{4}$/.test(r.cuerpo?.paciente?.codigo || ""));
  const vieja = await M.Paciente.create({ medicoPhone: MED, nombre: "Ficha Vieja", telefono: "59170003888" });
  r = await crear("17:30", { pacienteNombre: "Ficha Vieja", pacienteTelefono: "59170003888" });
  r = await P("POST", `/medico/citas/${r.cuerpo?.cita?._id}/crear-paciente`, {});
  const codigoVieja = (await M.Paciente.findById(vieja._id).lean()).codigo;
  verificar(`si se vincula a una ficha vieja sin código, la ficha lo recibe (${codigoVieja})`, r.estado === 201 && r.cuerpo?.yaExistia === true
    && /^P-\d{4}$/.test(codigoVieja || "") && r.cuerpo?.paciente?.codigo === codigoVieja);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
