// Symphomed — La recepcionista de voz (Vapi) cancela solo citas del
// consultorio que la atiende.
//
// Con el id de una cita alcanzaba para cancelarla, fuera del consultorio que
// fuera (informe de QA del 9 de octubre de 2026). El secreto del webhook es
// uno solo para todos los consultorios: el asistente de uno podía cancelar
// la cita de otro si le llegaba ese id. Lo que se prueba:
//   · con un número fijo: solo las citas de ese consultorio;
//   · en el súper número: solo las de los consultorios del súper número;
//   · un id que no es un id no rompe nada;
//   · lo de siempre sigue igual (por id o por teléfono, del propio consultorio).
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "vapi_alcance";
  const { CONFIG } = require(path.join(RAIZ, "config"));
  CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { cancelarCita, consultarMisCitas } = require(path.join(RAIZ, "services", "vapiHerramientas"));
  await mongoose.connection.dropDatabase();

  const A = "70095101", B = "70095102", C = "70095103";
  for (const [phone, tipoEspecialidad] of [[A, "medicina_general"], [B, "odontologia"], [C, "oftalmologia"]]) {
    await M.Medico.create({ phone, nombre: "Consultorio " + phone, passwordHash: "x", activo: true, tipoEspecialidad });
  }
  const manana = new Date(Date.now() + 86400000);
  const cita = (medicoPhone, pacienteTelefono) => M.Cita.create({ medicoPhone, pacienteNombre: "Paciente", pacienteTelefono, fecha: manana, estado: "confirmada" });
  const estado = async (c) => (await M.Cita.findById(c._id).lean()).estado;

  console.log("── Con el número de un consultorio ──");
  const deB = await cita(B, "59170001111");
  let r = await cancelarCita(A, { citaId: String(deB._id) });
  verificar("el asistente de A no cancela una cita de B, aunque tenga su id", /No encontré/.test(r) && (await estado(deB)) === "confirmada");
  r = await cancelarCita(A, { citaId: "no-es-un-id" });
  verificar("un id que no es un id → «no encontré», sin romper", /No encontré/.test(r));
  const deA = await cita(A, "59170002222");
  r = await cancelarCita(A, { citaId: String(deA._id) });
  verificar("una cita de A, por su id → cancelada", /cancelé/.test(r) && (await estado(deA)) === "cancelada");
  const otraDeA = await cita(A, "59170003333");
  r = await cancelarCita(A, { pacienteTelefono: "59170003333" });
  verificar("por el teléfono del paciente, como siempre → cancelada", /cancelé/.test(r) && (await estado(otraDeA)) === "cancelada");
  r = await cancelarCita(A, { pacienteTelefono: "59170001111" });
  verificar("el teléfono del paciente de B, desde A → no la encuentra", /No encontré/.test(r) && (await estado(deB)) === "confirmada");

  console.log("\n── En el súper número ──");
  CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS = [A, B];
  const deC = await cita(C, "59170004444");
  r = await cancelarCita(null, { citaId: String(deC._id) });
  verificar("una cita de un consultorio que no es del súper número → no se cancela", /No encontré/.test(r) && (await estado(deC)) === "confirmada");
  r = await consultarMisCitas(null, { pacienteTelefono: "59170001111" });
  const idListado = (r.match(/citaId: ([a-f0-9]{24})/) || [])[1];
  r = await cancelarCita(null, { citaId: idListado });
  verificar("una de B, por el id que dio «mis citas» en la misma llamada → cancelada", idListado === String(deB._id) && /cancelé/.test(r) && (await estado(deB)) === "cancelada");

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
