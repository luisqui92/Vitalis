// Vitalis — Crear una cita confirmada + sincronizarla con Google Calendar
// (si el médico lo tiene conectado). Un solo lugar para esto porque lo usan
// tanto la reserva conversacional por WhatsApp (services/reservaCitas.js,
// para sesiones ya en curso) como la reserva por el link web
// (routes/reservaPublica.js) — antes esta lógica estaba duplicada.
const { Paciente, Cita } = require("../db/models");
const { crearEvento } = require("./googleCalendar");
const { horarioSigueLibre } = require("./agenda");

// Se usa un error con esta marca (en vez de un mensaje de texto suelto) para
// que cada caller (WhatsApp conversacional, reserva pública por link) lo
// distinga de un error real y responda con su propio mensaje amigable.
class HorarioOcupadoError extends Error {
  constructor() {
    super("Ese horario se acaba de ocupar. Elegí otro.");
    this.horarioOcupado = true;
  }
}

async function crearCitaConfirmada({ medicoPhone, medico, pacienteTelefono, pacienteNombre, fecha, motivo, origen }) {
  // Quien llama ya suele revisar disponibilidad antes (para mostrar el error
  // rápido), pero en la reserva por WhatsApp esa revisión puede quedar
  // varios mensajes atrás (el paciente todavía tiene que escribir su nombre
  // y el motivo) — se revalida acá, lo más cerca posible de la escritura
  // real, para no confirmar dos citas para el mismo horario.
  const libre = await horarioSigueLibre(medicoPhone, fecha, medico.duracionConsultaMinutos || 30);
  if (!libre) throw new HorarioOcupadoError();

  const paciente = await Paciente.findOne({ medicoPhone, telefono: pacienteTelefono }).lean();
  let cita;
  try {
    cita = await Cita.create({
      medicoPhone,
      pacienteId: paciente?._id || null,
      pacienteNombre,
      pacienteTelefono,
      fecha,
      duracionMinutos: medico.duracionConsultaMinutos || 30,
      motivo,
      estado: "confirmada",
      origen,
    });
  } catch (e) {
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

  return cita;
}

module.exports = { crearCitaConfirmada };
