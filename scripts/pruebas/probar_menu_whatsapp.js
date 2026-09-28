// Symphomed — El WhatsApp pregunta primero: ¿médico o paciente?
//
// ═══ POR QUÉ ESTA PRUEBA ═══════════════════════════════════════════════════
//
// En la prueba real el bot «respondía cualquier cosa»: adivinaba si quien
// escribía era médico o paciente, y cuando se equivocaba, un «hola» caía en
// la reserva de un consultorio o una pregunta de un médico en la agenda.
//
// Ahora se pregunta con dos botones, y cada rama sigue con botones. Esta
// prueba CONVERSA con el bot —mensaje por mensaje, con una base de datos de
// verdad— y comprueba:
//
//   · que un número nuevo recibe SIEMPRE los dos botones, diga lo que diga,
//     y que para eso no se llama a la IA (el «cualquier cosa» venía de ahí);
//   · que cada botón lleva a su rama, y que un médico nunca termina viendo
//     los horarios de un consultorio;
//   · que la IA solo entra con una pregunta abierta;
//   · que «menú» vuelve al principio desde cualquier lado, y que un botón
//     viejo (de un mensaje de hace horas) igual funciona.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.SALUD_WHATSAPP_MEDICO_PHONE = "70000001";
delete process.env.WHATSAPP_ESPECIALIDADES_MEDICOS;

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// ─── La IA de mentira ──────────────────────────────────────────────────────
// Se cuenta cada llamada: que el primer mensaje NO llame a la IA es la mitad
// del arreglo.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
let llamadasIA = 0;
let respuestaIA = { intencion: "pregunta", respuesta: "Respuesta de prueba.", datos: {} };
axios.post = async () => {
  llamadasIA++;
  return { data: { choices: [{ message: { content: JSON.stringify(respuestaIA) } }] } };
};

const ids = (r) => (r?.botones || r?.filas || []).map(b => b.id);

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de datos."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "menu_wa_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Interesado, SesionCitaWA, Cita } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  const { precios } = require(path.join(RAIZ, "services", "asistenteVentas"));
  const monedas = require(path.join(RAIZ, "services", "monedas"));
  const { CONFIG } = require(path.join(RAIZ, "config"));
  await mongoose.connection.dropDatabase();
  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dra. Rojas", passwordHash: hash,
    horarioAtencion: [0, 1, 2, 3, 4, 5, 6].map(d => ({ diaSemana: d, horaInicio: "08:00", horaFin: "18:00" })) });

  const { procesarMensajeEntrante: bot } = require(path.join(RAIZ, "services", "reservaCitas"));
  const PAC = "59171111111";
  const MED = "59172222222";

  console.log("── 1. Un número nuevo: siempre los dos botones ──");
  for (const primero of ["hola", "Buenas tardes", "necesito un turno", "asdfgh", "🙂", "mi hijo tiene fiebre"]) {
    await SesionCitaWA.deleteMany({});
    llamadasIA = 0;
    const r = await bot("59170000009", primero, "");
    verificar(`«${primero}» → botones Soy médico / Soy paciente, sin llamar a la IA`,
      r.tipo === "botones" && ids(r).join() === "rol_medico,rol_paciente" && llamadasIA === 0);
  }
  llamadasIA = 0;
  const otraVez = await bot("59170000009", "no sé", "");
  verificar("si en vez de tocar escribe otra cosa, se le vuelven a mostrar (y sin IA)",
    ids(otraVez).join() === "rol_medico,rol_paciente" && /Tocá una de las dos/.test(otraVez.texto) && llamadasIA === 0);

  console.log("\n── 2. Rama paciente ──");
  await bot(PAC, "hola", "Ana");
  const menuP = await bot(PAC, "rol_paciente", "Ana");
  verificar("«Soy paciente» → Reservar / Cancelar / Pregunta, con el nombre del consultorio",
    ids(menuP).join() === "pac_reservar,pac_cancelar,pac_pregunta" && menuP.texto.includes("Dra. Rojas"));
  const dias = await bot(PAC, "pac_reservar", "Ana");
  verificar("«Reservar cita» → la lista de días", dias.tipo === "lista" && ids(dias)[0] === "dia_0");
  const horas = await bot(PAC, "dia_0", "Ana");
  verificar("  ...y elegir un día → la lista de horarios (el flujo de siempre)", horas.tipo === "lista" && ids(horas)[0] === "hora_0");
  const menuDesdeMitad = await bot(PAC, "Menú", "Ana");
  verificar("«menú» a mitad de la reserva → vuelve a los dos botones", ids(menuDesdeMitad).join() === "rol_medico,rol_paciente");

  await bot(PAC, "rol_paciente", "Ana");
  const cancelar = await bot(PAC, "pac_cancelar", "Ana");
  verificar("«Cancelar mi cita» sin citas → lo dice", cancelar.tipo === "texto" && /No encontré ninguna cita/.test(cancelar.texto));

  await bot(PAC, "rol_paciente", "Ana");
  const pide = await bot(PAC, "pac_pregunta", "Ana");
  verificar("«Tengo una pregunta» → le pide que la escriba", /escribime tu pregunta/i.test(pide.texto));
  llamadasIA = 0;
  respuestaIA = { intencion: "pregunta", respuesta: "Atendemos de lunes a domingo de 8 a 18." };
  const resp = await bot(PAC, "¿atienden los sábados?", "Ana");
  verificar("la pregunta SÍ va a la IA (una llamada)", llamadasIA === 1);
  verificar("  ...contesta y ofrece seguir: Reservar / Otra pregunta / Menú",
    resp.texto.startsWith("Atendemos de lunes a domingo") && ids(resp).join() === "pac_reservar,pac_pregunta,menu_inicio");
  respuestaIA = { intencion: "agendar", respuesta: null };
  const quiereTurno = await bot(PAC, "quiero sacar un turno para el jueves", "Ana");
  verificar("si en la pregunta dice que quiere un turno → la lista de días", quiereTurno.tipo === "lista" && ids(quiereTurno)[0] === "dia_0");
  await bot(PAC, "menú", "Ana");
  await bot(PAC, "rol_paciente", "Ana");
  respuestaIA = { intencion: "pregunta", respuesta: null };
  const sinDato = await bot(PAC, "¿cuánto sale la consulta?", "Ana");
  verificar("si la IA no tiene el dato, no inventa: dice que lo confirma el consultorio",
    /el consultorio te la confirma/.test(sinDato.texto) && ids(sinDato).includes("pac_reservar"));

  console.log("\n── 3. Rama médico ──");
  await bot(MED, "hola", "Dr. Pérez");
  const menuM = await bot(MED, "rol_medico", "Dr. Pérez");
  verificar("«Soy médico» → Ver una demo / Precios / Ya uso Symphomed",
    ids(menuM).join() === "med_demo,med_precios,med_cliente");
  verificar("  ...y un médico nunca ve horarios de un consultorio", !ids(menuM).some(i => /^dia_|^hora_|^pac_/.test(i)));
  llamadasIA = 0;
  const pr = await bot(MED, "med_precios", "Dr. Pérez");
  const p = precios(monedas.monedaSegunIdioma("es"));
  verificar("«Precios» → los precios reales, sin llamar a la IA", pr.texto.includes(p.mensual) && pr.texto.includes(p.consulta) && llamadasIA === 0);
  verificar("  ...y ofrece la demo o otra pregunta", ids(pr).join() === "med_demo,med_pregunta,med_cliente");
  verificar("  ...y queda como contacto (el que mira el precio también es alguien a quien llamar)",
    (await Interesado.findOne({ numero: MED }).lean())?.estado === "nuevo");
  const demo = await bot(MED, "med_demo", "Dr. Pérez");
  const intDemo = await Interesado.findOne({ numero: MED }).lean();
  verificar("«Ver una demo» → confirma que le escribimos y pregunta la especialidad", /le escribimos hoy mismo/.test(demo.texto) && /especialidad/.test(demo.texto));
  verificar("  ...y queda marcado como interesado, con el nombre de su WhatsApp", intDemo.estado === "interesado" && intDemo.nombre === "Dr. Pérez");
  llamadasIA = 0;
  respuestaIA = { intencion: "pregunta", respuesta: "Perfecto, odontología tiene su odontograma.", datos: { especialidad: "odontología", ciudad: "Cochabamba" } };
  const sigue = await bot(MED, "Soy odontólogo en Cochabamba", "Dr. Pérez");
  verificar("lo que escribe después lo atiende la conversación de ventas (IA)", llamadasIA === 1 && /odontograma/.test(sigue.texto));
  verificar("  ...y guarda la especialidad y la ciudad", (await Interesado.findOne({ numero: MED }).lean()).especialidad === "odontología");

  await Interesado.updateOne({ numero: MED }, { $set: { estado: "contactado" } });
  await bot(MED, "med_demo", "Dr. Pérez");
  verificar("pedir la demo de nuevo NO pisa «contactado» (eso lo puso una persona)",
    (await Interesado.findOne({ numero: MED }).lean()).estado === "contactado");

  console.log("\n── 4. «Ya uso Symphomed»: soporte, no ventas ──");
  const CLI = "59173333333";
  await bot(CLI, "hola", "Dra. Cliente");
  await bot(CLI, "rol_medico", "Dra. Cliente");
  const sop = await bot(CLI, "med_cliente", "Dra. Cliente");
  verificar("le pide que cuente qué necesita", /Cuéntenos en un mensaje/.test(sop.texto));
  llamadasIA = 0;
  const recibido = await bot(CLI, "No me carga la agenda desde ayer", "Dra. Cliente");
  const intCli = await Interesado.findOne({ numero: CLI }).lean();
  verificar("su mensaje queda guardado y marcado para que alguien conteste", intCli.soportePendiente === true && intCli.conversacion.some(m => m.texto.includes("No me carga la agenda")));
  verificar("  ...sin pasar por la IA de ventas", llamadasIA === 0 && /Lo revisa una persona/.test(recibido.texto));

  console.log("\n── 5. Los atajos que siguen andando ──");
  llamadasIA = 0;
  respuestaIA = { intencion: "pregunta", respuesta: "Buenas, con gusto le cuento. ¿De qué es su consultorio?", datos: {} };
  const landing = await bot("59174444444", "Hola, quiero ver una demostración de Symphomed", "");
  verificar("el texto del botón de symphomed.com va directo a ventas, sin preguntar", llamadasIA === 1 && landing.tipo === "texto" && /consultorio/.test(landing.texto));

  const REP = "59175555555";
  await Interesado.create({ numero: REP, estado: "interesado", nombre: "Dr. Vuelve" });
  const vuelve = await bot(REP, "Hola", "");
  verificar("un médico ya interesado que vuelve y dice «Hola» → su menú, no la pregunta de nuevo",
    ids(vuelve).join() === "med_demo,med_precios,med_cliente" && /Hola de nuevo/.test(vuelve.texto));

  await bot("59176666666", "hola", "");
  await bot("59176666666", "rol_medico", "");
  await bot("59176666666", "med_pregunta", "");
  respuestaIA = { intencion: "paciente", respuesta: null, datos: {} };
  const eraPaciente = await bot("59176666666", "en realidad quiero una cita con el pediatra", "");
  verificar("si la IA de ventas se da cuenta de que es un paciente → la rama paciente", ids(eraPaciente)[0] === "pac_reservar");

  const VIEJO = "59177777777";
  await bot(VIEJO, "hola", "");
  await bot(VIEJO, "rol_paciente", "");
  await SesionCitaWA.collection.updateOne({ numero: VIEJO }, { $set: { updatedAt: new Date(Date.now() - 3 * 3600e3) } });
  const tardio = await bot(VIEJO, "pac_reservar", "");
  verificar("un botón tocado tres horas después (sesión vencida) igual funciona", tardio.tipo === "lista" && ids(tardio)[0] === "dia_0");

  console.log("\n── 6. En portugués ──");
  const br = await bot("5511999990000", "Olá", "");
  verificar("un número de Brasil recibe los botones en portugués",
    br.texto.startsWith("Olá") && br.botones.map(b => b.title).join() === "🩺 Sou médico,🙋 Sou paciente");
  const brMed = await bot("5511999990000", "rol_medico", "");
  verificar("  ...y el menú del médico también", brMed.botones.map(b => b.title).includes("Preços"));
  const brPrecios = await bot("5511999990000", "med_precios", "");
  verificar("  ...con los precios en reais", brPrecios.texto.includes("R$"));
  verificar("  ...y el contacto queda con idioma pt", (await Interesado.findOne({ numero: "5511999990000" }).lean()).idioma === "pt");

  console.log("\n── 7. Súper número (varios consultorios) ──");
  await Medico.create({ phone: "70000002", nombre: "Dr. Diente", passwordHash: hash, tipoEspecialidad: "odontologia" });
  CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.push("70000001", "70000002");
  const SUP = "59178888888";
  await bot(SUP, "hola", "");
  const lista = await bot(SUP, "rol_paciente", "");
  verificar("«Soy paciente» → la lista de consultorios, sin la fila «Soy médico»",
    lista.tipo === "lista" && ids(lista).join() === "esp_0,esp_1");
  const elegido = await bot(SUP, "esp_1", "");
  verificar("  ...elegir uno → su menú (Reservar / Cancelar / Pregunta)", ids(elegido)[0] === "pac_reservar" && elegido.texto.includes("Dr. Diente"));
  const reservaDiente = await bot(SUP, "pac_reservar", "");
  verificar("  ...y la reserva es con ESE consultorio", reservaDiente.tipo === "lista" &&
    (await SesionCitaWA.findOne({ numero: SUP }).lean()).datos.medicoPhone === "70000002");
  CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.length = 0;

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
