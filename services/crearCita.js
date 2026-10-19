// Symphomed — Crear una cita confirmada + sincronizarla con Google Calendar
// (si el médico lo tiene conectado). Un solo lugar para esto porque lo usan
// tanto la reserva conversacional por WhatsApp (services/reservaCitas.js,
// para sesiones ya en curso) como la reserva por el link web
// (routes/reservaPublica.js) — antes esta lógica estaba duplicada.
const { Paciente, Cita } = require("../db/models");
const { crearEvento } = require("./googleCalendar");
const { esHorarioOfrecido, duracionDe } = require("./agenda");
const { notificarMedico } = require("./push");
const { log } = require("../config");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// "jueves 21 de agosto, 15:30" — la fecha se guarda en UTC, así que se pasa
// a hora de Bolivia (UTC-4) antes de leerla, o el aviso llega con la hora
// corrida y el médico se presenta cuatro horas tarde.
function cuandoEnBolivia(fecha) {
  const b = new Date(new Date(fecha).getTime() - 4 * 3600000);
  const hh = String(b.getUTCHours()).padStart(2, "0");
  const mm = String(b.getUTCMinutes()).padStart(2, "0");
  return `${DIAS[b.getUTCDay()]} ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}, ${hh}:${mm}`;
}

// Se usa un error con esta marca (en vez de un mensaje de texto suelto) para
// que cada caller (WhatsApp conversacional, reserva pública por link) lo
// distinga de un error real y responda con su propio mensaje amigable.
class HorarioOcupadoError extends Error {
  constructor() {
    super("Ese horario se acaba de ocupar. Elegí otro.");
    this.horarioOcupado = true;
  }
}

// El link de reserva ya se usó para otra cita (routes/reservaPublica.js).
class LinkUsadoError extends Error {
  constructor() {
    super("Con este link ya se reservó una cita.");
    this.linkUsado = true;
  }
}

// reservaLink: solo la reserva por link lo trae. Un link sirve para una cita,
// y el índice único de Cita es el que lo hace cumplir aunque lleguen dos
// pedidos con el mismo link a la vez.
async function crearCitaConfirmada({ medicoPhone, medico, pacienteTelefono, pacienteNombre, fecha, motivo, origen, reservaLink }) {
  // Quien llama ya suele revisar disponibilidad antes (para mostrar el error
  // rápido), pero en la reserva por WhatsApp esa revisión puede quedar
  // varios mensajes atrás (el paciente todavía tiene que escribir su nombre
  // y el motivo) — se revalida acá, lo más cerca posible de la escritura
  // real, para no confirmar dos citas para el mismo horario.
  //
  // Y no alcanza con que esté libre: tiene que ser uno de los horarios que
  // el consultorio ofrece. Va acá y no en cada canal porque por acá pasan los
  // tres —el link, la voz y el WhatsApp—, y la voz confirmaba cualquier fecha
  // futura que le dictara el asistente.
  if (!(await esHorarioOfrecido(medicoPhone, fecha))) throw new HorarioOcupadoError();

  const paciente = await Paciente.findOne({ medicoPhone, telefono: pacienteTelefono }).lean();
  let cita;
  try {
    cita = await Cita.create({
      medicoPhone,
      pacienteId: paciente?._id || null,
      pacienteNombre,
      pacienteTelefono,
      fecha,
      duracionMinutos: duracionDe(medico.duracionConsultaMinutos),
      motivo,
      estado: "confirmada",
      origen,
      ...(reservaLink ? { reservaLink } : {}),
    });
  } catch (e) {
    // El que saltó es el índice del link: no es un horario ocupado.
    if (e.code === 11000 && (e.keyPattern?.reservaLink || /cita_link_reserva_unico/.test(e.message || ""))) throw new LinkUsadoError();
    // Último resguardo: si dos reservas para el mismo médico+horario exacto
    // llegan a pasar la revisión de arriba casi al mismo tiempo (carrera de
    // verdad, no solo una revisión vieja), el índice único de Cita corta acá.
    if (e.code === 11000) throw new HorarioOcupadoError();
    throw e;
  }

  if (medico.googleCalendarId) {
    const eventId = await crearEvento(medico.googleCalendarId, cita);
    if (eventId) await Cita.updateOne({ _id: cita._id }, { googleEventId: eventId });
  }

  // Aviso al navegador del médico. Va sin await y con su propio catch: la
  // cita ya está guardada y confirmada, y que falle un servicio de push
  // ajeno no puede hacer que el paciente vea un error de reserva.
  notificarMedico(medicoPhone, {
    titulo: "Nueva reserva",
    cuerpo: `${pacienteNombre} — ${cuandoEnBolivia(fecha)}${motivo ? ` · ${motivo}` : ""}`,
    url: "/",
  }).catch(e => log.error("[CREAR_CITA] no se pudo notificar la reserva:", e.message));

  return cita;
}

module.exports = { crearCitaConfirmada };
