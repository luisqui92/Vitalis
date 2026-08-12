// Vitalis — Crear una cita confirmada + sincronizarla con Google Calendar
// (si el médico lo tiene conectado). Un solo lugar para esto porque lo usan
// tanto la reserva conversacional por WhatsApp (services/reservaCitas.js,
// para sesiones ya en curso) como la reserva por el link web
// (routes/reservaPublica.js) — antes esta lógica estaba duplicada.
const { Paciente, Cita } = require("../db/models");
const { crearEvento } = require("./googleCalendar");

async function crearCitaConfirmada({ medicoPhone, medico, pacienteTelefono, pacienteNombre, fecha, motivo, origen }) {
  const paciente = await Paciente.findOne({ medicoPhone, telefono: pacienteTelefono }).lean();
  const cita = await Cita.create({
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

  if (medico.googleCalendarId) {
    const eventId = await crearEvento(medico.googleCalendarId, cita);
    if (eventId) await Cita.updateOne({ _id: cita._id }, { googleEventId: eventId });
  }

  return cita;
}

module.exports = { crearCitaConfirmada };
