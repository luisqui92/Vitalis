// ChatGo Salud — Agenda: calcula los horarios disponibles de un médico
// cruzando su horario de atención configurado contra las citas ya
// confirmadas Y contra su Google Calendar real (si lo tiene conectado) —
// así no se ofrece un horario que el médico ya ocupó directo en su
// calendario, sin pasar por Vitalis. Lo usan tanto la web (para armar una
// cita a mano) como la reserva conversacional por WhatsApp.
const { Medico, Cita } = require("../db/models");
const { obtenerOcupadoEnRango } = require("./googleCalendar");

function seSuperponen(inicioA, finA, inicioB, finB) {
  return inicioA < finB && finA > inicioB;
}

function combinarFechaHora(fecha, horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  const d = new Date(fecha);
  d.setHours(h, m, 0, 0);
  return d;
}

// [{ fecha: "2026-08-11", slots: [Date, ...] }, ...] — solo días con al
// menos un horario libre, solo horarios futuros.
async function obtenerHorariosDisponibles(medicoPhone, diasAdelante = 7) {
  const medico = await Medico.findOne({ phone: medicoPhone }).lean();
  if (!medico) return [];
  const duracion = medico.duracionConsultaMinutos || 30;
  const horario = medico.horarioAtencion || [];
  if (horario.length === 0) return [];

  const desde = new Date();
  const hasta = new Date();
  hasta.setDate(hasta.getDate() + diasAdelante);

  const citasOcupadas = await Cita.find({
    medicoPhone, estado: "confirmada", fecha: { $gte: desde, $lt: hasta },
  }).select("fecha duracionMinutos").lean();

  const ocupadoCalendar = medico.googleCalendarId
    ? await obtenerOcupadoEnRango(medico.googleCalendarId, desde, hasta)
    : [];

  const dias = [];
  for (let i = 0; i < diasAdelante; i++) {
    const dia = new Date();
    dia.setDate(dia.getDate() + i);
    dia.setHours(0, 0, 0, 0);
    const bloques = horario.filter(h => h.diaSemana === dia.getDay());
    if (bloques.length === 0) continue;

    const slots = [];
    for (const bloque of bloques) {
      let cursor = combinarFechaHora(dia, bloque.horaInicio);
      const fin = combinarFechaHora(dia, bloque.horaFin);
      while (cursor.getTime() + duracion * 60000 <= fin.getTime()) {
        if (cursor.getTime() > Date.now()) {
          const inicioSlot = cursor.getTime();
          const finSlot = inicioSlot + duracion * 60000;
          const ocupadoEnVitalis = citasOcupadas.some(c => {
            const inicioC = new Date(c.fecha).getTime();
            const finC = inicioC + (c.duracionMinutos || 30) * 60000;
            return seSuperponen(inicioSlot, finSlot, inicioC, finC);
          });
          const ocupadoEnCalendar = ocupadoCalendar.some(b => seSuperponen(inicioSlot, finSlot, b.inicio.getTime(), b.fin.getTime()));
          if (!ocupadoEnVitalis && !ocupadoEnCalendar) slots.push(new Date(cursor));
        }
        cursor = new Date(cursor.getTime() + duracion * 60000);
      }
    }
    if (slots.length) dias.push({ fecha: dia.toISOString().slice(0, 10), slots });
  }
  return dias;
}

// Un horario puntual sigue libre? (se revalida antes de confirmar una
// reserva, por si se ocupó entre que se mostró la lista y se eligió — ya
// sea en Vitalis o directo en el Google Calendar del médico).
async function horarioSigueLibre(medicoPhone, fecha, duracionMinutos) {
  const inicio = new Date(fecha).getTime();
  const fin = inicio + (duracionMinutos || 30) * 60000;
  const margen = 6 * 3600000;

  const [citas, medico] = await Promise.all([
    Cita.find({
      medicoPhone, estado: "confirmada",
      fecha: { $gte: new Date(inicio - margen), $lte: new Date(fin) },
    }).select("fecha duracionMinutos").lean(),
    Medico.findOne({ phone: medicoPhone }).select("googleCalendarId").lean(),
  ]);

  const ocupadoEnVitalis = citas.some(c => {
    const inicioC = new Date(c.fecha).getTime();
    const finC = inicioC + (c.duracionMinutos || 30) * 60000;
    return seSuperponen(inicio, fin, inicioC, finC);
  });
  if (ocupadoEnVitalis) return false;

  if (medico?.googleCalendarId) {
    const ocupadoCalendar = await obtenerOcupadoEnRango(medico.googleCalendarId, new Date(inicio - margen), new Date(fin + margen));
    if (ocupadoCalendar.some(b => seSuperponen(inicio, fin, b.inicio.getTime(), b.fin.getTime()))) return false;
  }
  return true;
}

module.exports = { obtenerHorariosDisponibles, horarioSigueLibre };
