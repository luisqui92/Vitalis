// Symphomed — La reserva por link: el consultorio que mandó el link, uno de
// los horarios que ofrece, y una sola cita por link.
//
// El link de la reconsulta (routes/consultaMedica.js) abre la página de
// reserva sin login (routes/reservaPublica.js). La auditoría del comité de QA
// (octubre de 2026) encontró dos cosas:
//   · A12: el token solo traía el teléfono del paciente, y la cita quedaba
//     siempre en la agenda de SALUD_WHATSAPP_MEDICO_PHONE, aunque la
//     reconsulta la hubiera mandado otro médico. Con esa variable vacía, el
//     link daba 404.
//   · A4: se aceptaba cualquier instante que no chocara con otra cita —un
//     domingo a las 3 de la mañana, una fecha pasada, las 10:07, un día dentro
//     de dos años—, y con un solo link se reservaban todos los horarios.
// Y una que trae el arreglo de A12: la confirmación le dice al paciente que
// responda «cancelar» al WhatsApp, y el WhatsApp buscaba la cita solo en su
// propio consultorio.
//
// Lo que se prueba: el link reserva en el consultorio que lo firmó y la
// confirmación sale con SU hora; solo entra un horario de la lista; un link
// sirve para una cita, aunque se manden cinco pedidos a la vez, y vuelve a
// servir si esa cita se cancela; un link viejo sigue yendo al consultorio
// fijo; el «cancelar» del WhatsApp encuentra la cita reservada por link; y
// reservar por WhatsApp, eligiendo de la lista, anda igual que siempre.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

// ─── El reloj, fijo ────────────────────────────────────────────────────────
// Qué horarios se ofrecen depende de la hora: la prueba arranca siempre el
// lunes 6 de mayo de 2030 a las 08:00 de Bolivia (09:00 en São Paulo), y
// desde ahí el reloj corre. pasarUnMinuto() lo adelanta, para que el límite
// de pedidos por minuto de la página no se meta en la prueba.
const FechaReal = Date;
let desfase = FechaReal.UTC(2030, 4, 6, 12, 0, 0) - FechaReal.now();
global.Date = class Date extends FechaReal {
  constructor(...a) { if (a.length) super(...a); else super(FechaReal.now() + desfase); }
  static now() { return FechaReal.now() + desfase; }
};
const pasarUnMinuto = () => { desfase += 61000; };

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function pedir(puerto, metodo, ruta, cuerpo, token) {
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
  process.env.MONGODB_URI = mongod.getUri() + "reserva_link";
  const { CONFIG } = require(path.join(RAIZ, "config"));
  CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const A = "70096001", B = "70096002";
  CONFIG.SALUD_WHATSAPP_MEDICO_PHONE = A;
  CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS = [];

  // Google Calendar y WhatsApp, de mentira: se anota lo que se les pide. Se
  // reemplazan antes de cargar las rutas, que los toman al cargarse.
  const google = require(path.join(RAIZ, "services", "googleCalendar"));
  const eventosBorrados = [];
  let eventos = 0;
  google.crearEvento = async (calendarId) => `evento-${calendarId}-${++eventos}`;
  google.actualizarEvento = async () => true;
  google.eliminarEvento = async (calendarId, eventId) => { eventosBorrados.push({ calendarId, eventId }); return true; };
  google.obtenerOcupadoEnRango = async () => [];
  const whatsapp = require(path.join(RAIZ, "services", "metaWhatsapp"));
  const enviados = [];
  whatsapp.enviarTextoOPlantilla = async (destino, texto, respaldo) => { enviados.push({ destino, texto, respaldo }); };

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { instanteEnZona, fechaCompletaEnZona } = require(path.join(RAIZ, "services", "zonaHoraria"));
  await mongoose.connection.dropDatabase();
  await M.Cita.syncIndexes();

  // A es el consultorio fijo del número oficial. B es la médica que manda la
  // reconsulta: atiende en São Paulo, de lunes a viernes de 9 a 12.
  await M.Medico.create({ phone: A, nombre: "Dr. Fijo", passwordHash: "x", activo: true });
  await M.Medico.create({ phone: B, nombre: "Dra. Reconsulta", passwordHash: "x", activo: true, zonaHoraria: "America/Sao_Paulo",
    googleCalendarId: "dra.b@gmail.com", duracionConsultaMinutos: 30,
    horarioAtencion: [1, 2, 3, 4, 5].map(d => ({ diaSemana: d, horaInicio: "09:00", horaFin: "12:00" })) });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "reservaPublica"))(app);
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const P = (metodo, ruta, cuerpo) => pedir(servidor.address().port, metodo, ruta, cuerpo);

  const PACIENTE = "59170001111";
  // Como lo firma routes/consultaMedica.js: con el consultorio adentro.
  const linkDe = (medicoPhone) => generarToken(PACIENTE, "reserva_publica", 45 * 60 * 1000, medicoPhone ? { medicoPhone } : {});
  const disponibilidad = (token) => P("GET", `/reserva-publica/disponibilidad?token=${encodeURIComponent(token)}`);
  const confirmar = (token, fecha, pacienteNombre = "Ana Paciente") => P("POST", "/reserva-publica/confirmar", { token, fecha, pacienteNombre, motivo: "control" });
  const citasDe = (medicoPhone) => M.Cita.countDocuments({ medicoPhone, estado: "confirmada" });

  console.log("── 1. El consultorio del link ──");
  const link1 = linkDe(B);
  let r = await disponibilidad(link1);
  verificar("el link de la Dra. B muestra su agenda, no la del consultorio fijo", r.estado === 200 && r.cuerpo?.medicoNombre === "Dra. Reconsulta");
  const dias = r.cuerpo?.dias || [];
  const martes = dias.find(d => d.fecha === "2030-05-07");
  verificar("y sus horarios, en su hora: el martes de 9 a 11:30 de São Paulo", martes?.slots?.length === 6
    && new FechaReal(martes.slots[0]).getTime() === instanteEnZona("America/Sao_Paulo", 2030, 4, 7, 9, 0).getTime());
  // Y así lo firma de verdad la reconsulta: la Dra. B confirma la que sugirió
  // la IA, y el link que le llega al paciente abre su agenda.
  const pacienteDeB = await M.Paciente.create({ medicoPhone: B, nombre: "Ana Paciente", telefono: PACIENTE });
  const consulta = await M.ConsultaMedica.create({ medicoPhone: B, pacienteId: pacienteDeB._id, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: { reconsultaSugerida: { fechaHora: instanteEnZona("America/Sao_Paulo", 2030, 4, 13, 10, 0), estado: "pendiente" } } });
  enviados.length = 0;
  r = await pedir(servidor.address().port, "POST", `/medico/consultas/${consulta._id}/reconsulta/confirmar`, {}, generarToken(B, "medico", 36e5));
  const deLaReconsulta = (enviados[0]?.texto.match(/reservar\.html\?token=(\S+)/) || [])[1] || "";
  const abierto = await disponibilidad(deLaReconsulta);
  verificar("el link que manda la reconsulta de la Dra. B también abre su agenda", r.estado === 200
    && abierto.estado === 200 && abierto.cuerpo?.medicoNombre === "Dra. Reconsulta");

  console.log("\n── 2. Solo un horario de la lista ──");
  const ofrecido = martes?.slots?.[2]; // martes 10:00 en São Paulo, tal como lo devuelve la página
  for (const [que, fecha] of [
    ["el domingo a las 03:00", instanteEnZona("America/Sao_Paulo", 2030, 4, 12, 3, 0)],
    ["un lunes de hace cuatro semanas, a las 10:00", instanteEnZona("America/Sao_Paulo", 2030, 3, 8, 10, 0)],
    ["un horario de la lista corrido 7 minutos (10:07)", new FechaReal(new FechaReal(ofrecido).getTime() + 7 * 60000)],
    ["un miércoles a las 10:00 dentro de dos años", instanteEnZona("America/Sao_Paulo", 2032, 4, 5, 10, 0)],
  ]) {
    r = await confirmar(link1, fecha.toISOString());
    verificar(`${que} → 409, y no se agenda`, r.estado === 409 && (await citasDe(B)) === 0);
  }

  console.log("\n── 3. Uno de la lista entra, en el consultorio del link ──");
  enviados.length = 0;
  r = await confirmar(link1, ofrecido);
  const cita1 = await M.Cita.findOne({ medicoPhone: B }).lean();
  verificar("el horario de la lista, como lo manda la página → 200", r.estado === 200);
  verificar("  ...y la cita queda en la agenda de la Dra. B, reservada por link", cita1?.origen === "whatsapp_web"
    && cita1?.pacienteTelefono === PACIENTE && (await citasDe(A)) === 0);
  const enSuHora = fechaCompletaEnZona("America/Sao_Paulo", new FechaReal(ofrecido));
  verificar(`  ...y el WhatsApp dice la hora de São Paulo («${enSuHora}»), no la de Bolivia`,
    enviados.length === 1 && enviados[0].texto.includes(enSuHora) && enviados[0].respaldo?.parametros?.[2] === enSuHora
    && enSuHora !== fechaCompletaEnZona("America/La_Paz", new FechaReal(ofrecido)));

  console.log("\n── 4. Un link, una cita ──");
  const otroOfrecido = martes?.slots?.[4];
  r = await confirmar(link1, otroOfrecido);
  verificar("el mismo link otra vez → 409, y sigue habiendo una sola", r.estado === 409 && /ya reservaste/.test(r.cuerpo?.error || "") && (await citasDe(B)) === 1);
  r = await disponibilidad(link1);
  verificar("  ...y la página ya lo dice al abrirlo", r.estado === 409 && /ya reservaste/.test(r.cuerpo?.error || ""));
  // La firma vale igual escrita de otra forma (services/auth.js): no puede
  // contar como otro link.
  const [cuerpoLink1, firmaLink1] = link1.split(".");
  for (const [que, variante] of [["con algo pegado al final", link1 + ".x"], ["con la firma en mayúsculas", `${cuerpoLink1}.${firmaLink1.toUpperCase()}`]]) {
    r = await confirmar(variante, otroOfrecido);
    verificar(`  ...ni escrito ${que}`, r.estado === 409 && /ya reservaste/.test(r.cuerpo?.error || "") && (await citasDe(B)) === 1);
  }
  pasarUnMinuto();
  // Una madre con dos hijos recibe dos reconsultas: cada link sirve para la suya.
  const link2 = linkDe(B);
  r = await confirmar(link2, otroOfrecido, "Hijo Paciente");
  verificar("otro link al mismo número (el segundo hijo) → su cita entra", r.estado === 200 && (await citasDe(B)) === 2);

  pasarUnMinuto();
  const link3 = linkDe(B);
  const miercoles = dias.find(d => d.fecha === "2030-05-08")?.slots || [];
  const respuestas = await Promise.all(miercoles.slice(0, 5).map(s => confirmar(link3, s)));
  const entraron = respuestas.filter(x => x.estado === 200).length;
  verificar(`cinco pedidos a la vez con un mismo link → entra uno solo (entraron ${entraron})`, entraron === 1
    && respuestas.every(x => x.estado === 200 || x.estado === 409) && (await citasDe(B)) === 3);

  const deLink2 = await M.Cita.findOne({ medicoPhone: B, pacienteNombre: "Hijo Paciente" });
  if (deLink2) { deLink2.estado = "cancelada"; await deLink2.save(); }
  r = await confirmar(link2, martes?.slots?.[5], "Hijo Paciente");
  verificar("si la cita de un link se cancela, ese link vuelve a servir mientras no venza", Boolean(deLink2) && r.estado === 200);

  console.log("\n── 5. Los links de antes y sin consultorio fijo ──");
  r = await disponibilidad(linkDe(null));
  verificar("un link de antes (sin consultorio adentro) → sigue yendo al consultorio fijo", r.estado === 200 && r.cuerpo?.medicoNombre === "Dr. Fijo");
  CONFIG.SALUD_WHATSAPP_MEDICO_PHONE = "";
  r = await disponibilidad(linkDe(B));
  verificar("sin consultorio fijo configurado, el link de la Dra. B anda igual", r.estado === 200 && r.cuerpo?.medicoNombre === "Dra. Reconsulta");
  CONFIG.SALUD_WHATSAPP_MEDICO_PHONE = A;
  servidor.close();

  console.log("\n── 6. «cancelar» por el WhatsApp encuentra la cita del link ──");
  const { procesarMensajeEntrante: bot } = require(path.join(RAIZ, "services", "reservaCitas"));
  const WA = "59170002222";
  // Como la deja la reserva por link: en la agenda de la Dra. B, con su evento de Google.
  const delLink = await M.Cita.create({ medicoPhone: B, pacienteNombre: "Luis Paciente", pacienteTelefono: WA,
    fecha: instanteEnZona("America/Sao_Paulo", 2030, 4, 10, 11, 0), estado: "confirmada", origen: "whatsapp_web", googleEventId: "evento-de-b" });
  // Una de la Dra. B cargada a mano: esa no es del número oficial, y no aparece.
  await M.Cita.create({ medicoPhone: B, pacienteNombre: "Luis Paciente", pacienteTelefono: WA,
    fecha: instanteEnZona("America/Sao_Paulo", 2030, 4, 9, 11, 0), estado: "confirmada", origen: "manual" });
  await bot(WA, "rol_paciente", "");
  r = await bot(WA, "pac_cancelar", "");
  const enHoraDeB = fechaCompletaEnZona("America/Sao_Paulo", delLink.fecha);
  verificar(`el paciente toca «cancelar mi cita» → le ofrece la del link, con la Dra. B y en su hora`,
    r?.tipo === "botones" && /con Dra\. Reconsulta/.test(r.texto) && r.texto.includes(enHoraDeB));
  r = await bot(WA, "si_cancelar", "");
  verificar("  ...confirma → la cita queda cancelada", /cancelé/.test(r?.texto || "") && (await M.Cita.findById(delLink._id).lean()).estado === "cancelada");
  verificar("  ...y se borra el evento del calendario de la Dra. B, no del fijo",
    eventosBorrados.length === 1 && eventosBorrados[0].calendarId === "dra.b@gmail.com" && eventosBorrados[0].eventId === "evento-de-b");
  await bot(WA, "rol_paciente", "");
  r = await bot(WA, "pac_cancelar", "");
  verificar("la que la Dra. B cargó a mano no la ofrece el número oficial", /No encontré/.test(r?.texto || ""));

  console.log("\n── 7. Por WhatsApp, el horario elegido de la lista entra igual ──");
  // La revisión de «uno de los horarios que se ofrecen» está en
  // crearCitaConfirmada, por donde pasa también el WhatsApp: el horario que
  // el paciente toca en la lista tiene que seguir entrando.
  const WA2 = "59170003333";
  await bot(WA2, "rol_paciente", "");
  await bot(WA2, "pac_reservar", "");
  await bot(WA2, "dia_0", "");
  await bot(WA2, "hora_0", "");
  await bot(WA2, "Carla Paciente", "");
  r = await bot(WA2, "ninguno", "");
  const porWhatsapp = await M.Cita.findOne({ medicoPhone: A, pacienteTelefono: WA2, estado: "confirmada" }).lean();
  verificar("día y hora de la lista, nombre y motivo → la cita queda confirmada en el consultorio fijo",
    /quedó confirmada/.test(r?.texto || "") && porWhatsapp?.origen === "whatsapp");

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
