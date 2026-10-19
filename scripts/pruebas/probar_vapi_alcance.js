// Symphomed — La recepcionista de voz (Vapi) cancela solo citas del
// consultorio que la atiende, y solo las de quien llama.
//
// Con el id de una cita alcanzaba para cancelarla, fuera del consultorio que
// fuera (informe de QA del 9 de octubre de 2026). El secreto del webhook es
// uno solo para todos los consultorios: el asistente de uno podía cancelar
// la cita de otro si le llegaba ese id. Y aun dentro del mismo consultorio,
// alguien que dictaba el número de otra persona escuchaba sus citas y se las
// cancelaba (auditoría del comité de QA, octubre de 2026, A5). Lo que se
// prueba:
//   · con un número fijo: solo las citas de ese consultorio;
//   · en el súper número: solo las de los consultorios del súper número;
//   · un id que no es un id no rompe nada;
//   · para cancelar hace falta el número, también con el id, y tiene que ser
//     el de la cita;
//   · en el webhook manda el caller ID, no lo que dicta quien llama; sin
//     caller ID (la llamada desde la página web) se deriva al WhatsApp;
//   · al agendar, solo un horario de los que se ofrecen, y un tope por número
//     (A4);
//   · lo de siempre sigue igual (por id o por teléfono, del propio consultorio).
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

// ─── El reloj, fijo ────────────────────────────────────────────────────────
// Qué horarios se ofrecen depende de la hora: la prueba arranca siempre el
// lunes 6 de mayo de 2030 a las 08:00 de Bolivia, y desde ahí el reloj corre.
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
function pedir(puerto, ruta, cuerpo) {
  return new Promise((resolve) => {
    const datos = JSON.stringify(cuerpo);
    const req = http.request({ host: "127.0.0.1", port: puerto, method: "POST", path: ruta, headers: {
      "content-type": "application/json", "content-length": Buffer.byteLength(datos), "x-vapi-secret": "secreto-de-prueba",
    } }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.setTimeout(10000, () => req.destroy(new Error("sin respuesta")));
    req.on("error", () => resolve({ estado: 0 }));
    req.write(datos);
    req.end();
  });
}

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "vapi_alcance";
  const { CONFIG } = require(path.join(RAIZ, "config"));
  CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  CONFIG.VAPI_SERVER_SECRET = "secreto-de-prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { cancelarCita, consultarMisCitas, consultarDisponibilidad, agendarCita } = require(path.join(RAIZ, "services", "vapiHerramientas"));
  const { instanteEnZona } = require(path.join(RAIZ, "services", "zonaHoraria"));
  await mongoose.connection.dropDatabase();
  await M.Cita.syncIndexes();

  // Los tres atienden de lunes a viernes de 8 a 17, de a media hora (lo que
  // trae una cuenta nueva).
  const A = "70095101", B = "70095102", C = "70095103";
  for (const [phone, tipoEspecialidad] of [[A, "medicina_general"], [B, "odontologia"], [C, "oftalmologia"]]) {
    await M.Medico.create({ phone, nombre: "Consultorio " + phone, passwordHash: "x", activo: true, tipoEspecialidad });
  }
  // Mañana martes desde las 07:00, antes de que abra: no le quitan horarios
  // a nadie. Una por minuto, porque la base no deja dos a la misma hora.
  let minuto = 0;
  const cita = (medicoPhone, pacienteTelefono) => M.Cita.create({ medicoPhone, pacienteNombre: "Paciente " + pacienteTelefono, pacienteTelefono,
    fecha: instanteEnZona("America/La_Paz", 2030, 4, 7, 7, minuto++), estado: "confirmada" });
  const estado = async (c) => (await M.Cita.findById(c._id).lean()).estado;

  console.log("── Con el número de un consultorio ──");
  const deB = await cita(B, "59170001111");
  let r = await cancelarCita(A, { citaId: String(deB._id), pacienteTelefono: "59170001111" });
  verificar("el asistente de A no cancela una cita de B, aunque tenga su id y el número", /No encontré/.test(r) && (await estado(deB)) === "confirmada");
  r = await cancelarCita(A, { citaId: "no-es-un-id", pacienteTelefono: "59170001111" });
  verificar("un id que no es un id → «no encontré», sin romper", /No encontré/.test(r));
  const deA = await cita(A, "59170002222");
  r = await cancelarCita(A, { citaId: String(deA._id), pacienteTelefono: "59170002222" });
  verificar("una cita de A, por su id y con su número → cancelada", /cancelé/.test(r) && (await estado(deA)) === "cancelada");
  const otraDeA = await cita(A, "59170003333");
  r = await cancelarCita(A, { pacienteTelefono: "59170003333" });
  verificar("por el teléfono del paciente, como siempre → cancelada", /cancelé/.test(r) && (await estado(otraDeA)) === "cancelada");
  r = await cancelarCita(A, { pacienteTelefono: "59170001111" });
  verificar("el teléfono del paciente de B, desde A → no la encuentra", /No encontré/.test(r) && (await estado(deB)) === "confirmada");

  console.log("\n── Solo las citas de quien llama ──");
  const ajena = await cita(A, "59170005555");
  r = await cancelarCita(A, { citaId: String(ajena._id), pacienteTelefono: "59179999999" });
  verificar("el id de una cita de A con el número de otra persona → no se cancela", /No encontré/.test(r) && (await estado(ajena)) === "confirmada");
  r = await cancelarCita(A, { citaId: String(ajena._id) });
  verificar("con el id y sin ningún número → no se cancela, y se deriva al WhatsApp", /WhatsApp/.test(r) && (await estado(ajena)) === "confirmada");
  r = await consultarMisCitas(A, {});
  verificar("«mis citas» sin número → se deriva al WhatsApp, sin buscar nada", /WhatsApp/.test(r) && !/citaId/.test(r));
  r = await consultarMisCitas(A, { pacienteTelefono: "+59170005555" });
  verificar("el caller ID con «+» encuentra la cita guardada solo con dígitos (como la guarda el WhatsApp)", r.includes(String(ajena._id)));

  console.log("\n── En el súper número ──");
  CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS = [A, B];
  const deC = await cita(C, "59170004444");
  r = await cancelarCita(null, { citaId: String(deC._id), pacienteTelefono: "59170004444" });
  verificar("una cita de un consultorio que no es del súper número → no se cancela", /No encontré/.test(r) && (await estado(deC)) === "confirmada");
  r = await consultarMisCitas(null, { pacienteTelefono: "59170001111" });
  const idListado = (r.match(/citaId: ([a-f0-9]{24})/) || [])[1];
  r = await cancelarCita(null, { citaId: idListado, pacienteTelefono: "59170001111" });
  verificar("una de B, por el id que dio «mis citas» en la misma llamada → cancelada", idListado === String(deB._id) && /cancelé/.test(r) && (await estado(deB)) === "cancelada");
  CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS = [];

  console.log("\n── En el webhook manda el caller ID ──");
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "vapi"))(app);
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const herramienta = async (name, args, customer) => {
    const call = customer ? { type: "inboundPhoneCall", customer: { number: customer } } : { type: "webCall" };
    const res = await pedir(servidor.address().port, `/vapi/webhook/${A}`, { message: { type: "tool-calls", call, toolCallList: [{ id: "t1", name, arguments: args }] } });
    return res.cuerpo?.results?.[0]?.result || "";
  };
  const victima = await cita(A, "59170006666");
  r = await herramienta("consultar_mis_citas", { pacienteTelefono: "59170006666" }, "+59179999999");
  verificar("quien llama desde otro número y dicta el de la víctima → no escucha sus citas", !r.includes(String(victima._id)) && !/Paciente 59170006666/.test(r));
  r = await herramienta("cancelar_cita", { citaId: String(victima._id), pacienteTelefono: "59170006666" }, "+59179999999");
  verificar("...ni se la cancela, aunque tenga el id", (await estado(victima)) === "confirmada");
  r = await herramienta("consultar_mis_citas", { pacienteTelefono: "59170006666" }, null);
  verificar("desde la página web (sin caller ID), con el número dictado → se deriva al WhatsApp", /WhatsApp/.test(r) && !r.includes(String(victima._id)));
  r = await herramienta("cancelar_cita", { pacienteTelefono: "59170006666" }, null);
  verificar("...y tampoco cancela", /WhatsApp/.test(r) && (await estado(victima)) === "confirmada");
  r = await herramienta("consultar_mis_citas", {}, "+59170006666");
  verificar("la dueña, llamando desde su teléfono → ve su cita", r.includes(String(victima._id)));

  console.log("\n── Al agendar: un horario de los que se ofrecen, y con tope ──");
  const opciones = async () => [...(await consultarDisponibilidad(A, {})).matchAll(/fechaHora: ([^)]+)\)/g)].map(m => m[1]);
  const agendar = (fechaHora, pacienteTelefono = "59170008888") => agendarCita(A, { fechaHora, pacienteNombre: "Quien Llama", pacienteTelefono });
  const cuantas = (tel) => M.Cita.countDocuments({ medicoPhone: A, pacienteTelefono: tel, estado: "confirmada" });
  for (const [que, fecha] of [
    ["el domingo a las 03:00", instanteEnZona("America/La_Paz", 2030, 4, 12, 3, 0)],
    ["un miércoles a las 10:07, fuera de la grilla", instanteEnZona("America/La_Paz", 2030, 4, 8, 10, 7)],
    ["un miércoles a las 10:00 dentro de dos años", instanteEnZona("America/La_Paz", 2032, 4, 5, 10, 0)],
  ]) {
    r = await agendar(fecha.toISOString());
    verificar(`${que} → no se agenda`, /no está disponible/.test(r) && (await cuantas("59170008888")) === 0);
  }
  let ofrecidas = await opciones();
  r = await agendar(ofrecidas[0]);
  verificar("una de las opciones que dio la disponibilidad → se agenda", /quedó confirmada/.test(r) && (await cuantas("59170008888")) === 1);
  ofrecidas = await opciones();
  await agendar(ofrecidas[0]);
  ofrecidas = await opciones();
  await agendar(ofrecidas[0]);
  ofrecidas = await opciones();
  r = await agendar(ofrecidas[0]);
  verificar("la cuarta cita por voz para el mismo número → no se agenda", /lo máximo/.test(r) && (await cuantas("59170008888")) === 3);
  ofrecidas = await opciones();
  r = await herramienta("agendar_cita", { fechaHora: ofrecidas[0], pacienteNombre: "Hija de Quien Llama", pacienteTelefono: "59170007777" }, "+59179999999");
  verificar("al agendar sí vale otro número (reservar para un familiar)", /quedó confirmada/.test(r) && (await cuantas("59170007777")) === 1);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
