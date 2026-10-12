// ChatGo Salud — Agenda: calcula los horarios disponibles de un médico
// cruzando su horario de atención configurado contra las citas ya
// confirmadas Y contra su Google Calendar real (si lo tiene conectado) —
// así no se ofrece un horario que el médico ya ocupó directo en su
// calendario, sin pasar por Symphomed. Lo usan tanto la web (para armar una
// cita a mano) como la reserva conversacional por WhatsApp.
const { Medico, Cita } = require("../db/models");
const { obtenerOcupadoEnRango } = require("./googleCalendar");
const { hoyEnZona, instanteEnZona, ZONA_POR_DEFECTO } = require("./zonaHoraria");

function seSuperponen(inicioA, finA, inicioB, finB) {
  return inicioA < finB && finA > inicioB;
}

// ═══ LO QUE PUEDE DURAR UNA CONSULTA, Y CUÁNTOS DÍAS SE MIRAN ══════════════
//
// El cálculo de horarios avanza de a una consulta por vez. Con una duración
// de −30 minutos retrocedía para siempre, y con 0,001 daba miles de millones
// de vueltas: el proceso entero quedaba colgado y Symphomed dejaba de
// contestar a todos los médicos y pacientes. Bastaba guardar ese número en
// el horario de una cuenta cualquiera, o que el asistente de voz pidiera
// mil millones de días (revisión integral del 11 de octubre de 2026, S07).
//
// Por eso se valida al guardar (routes/citas.js) y, además, acá se usa
// siempre un valor sano: lo que ya esté guardado mal no puede colgar nada.
const DURACION_MIN = 5;
const DURACION_MAX = 240;
const DIAS_MAX = 60;
// Más franjas que estas no son un horario de atención.
const FRANJAS_MAX = 50;

// Minutos enteros de 5 a 240, o null.
function duracionValida(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= DURACION_MIN && n <= DURACION_MAX ? n : null;
}
// La que se usa: la guardada si es válida; si no, media hora.
const duracionDe = (valor) => duracionValida(valor) || 30;
const diasDe = (valor, porDefecto) => Math.min(DIAS_MAX, Math.max(1, Math.floor(Number(valor)) || porDefecto));

// fechaDia: {anio, mesIndex, dia} de un día concreto EN LA ZONA DEL MÉDICO
// (nunca un Date de "hora local del server" — en producción corre en UTC).
//
// La zona llega como parámetro y no se lee adentro: esta función se llama
// una vez por cada casillero de cada día, y buscar al médico en cada llamada
// sería un pedido a la base por casillero.
function combinarFechaHora(zona, fechaDia, horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  return instanteEnZona(zona, fechaDia.anio, fechaDia.mesIndex, fechaDia.dia, h, m);
}

// [{ fecha: "2026-08-11", slots: [Date, ...] }, ...] — solo días con al
// menos un horario libre, solo horarios futuros.
async function obtenerHorariosDisponibles(medicoPhone, diasPedidos = 7) {
  const diasAdelante = diasDe(diasPedidos, 7);
  const medico = await Medico.findOne({ phone: medicoPhone }).lean();
  if (!medico) return [];
  const duracion = duracionDe(medico.duracionConsultaMinutos);
  const horario = (medico.horarioAtencion || []).slice(0, FRANJAS_MAX);
  if (horario.length === 0) return [];

  // "Hoy" EN LA ZONA DEL MÉDICO, no en la del server (que en producción
  // corre en UTC) — si no, cerca de la medianoche de su país esto arranca la
  // ventana de 7 días un día antes o después del real.
  const zona = medico.zonaHoraria || ZONA_POR_DEFECTO;
  const hoy = hoyEnZona(zona);
  const desde = new Date();
  const hasta = instanteEnZona(zona, hoy.anio, hoy.mesIndex, hoy.dia + diasAdelante, 0, 0);

  const citasOcupadas = await Cita.find({
    medicoPhone, estado: "confirmada", fecha: { $gte: desde, $lt: hasta },
  }).select("fecha duracionMinutos").lean();

  const ocupadoCalendar = medico.googleCalendarId
    ? await obtenerOcupadoEnRango(medico.googleCalendarId, desde, hasta)
    : [];

  const dias = [];
  for (let i = 0; i < diasAdelante; i++) {
    // Date.UTC normaliza solo si "dia" se pasa de fin de mes (día 32 de
    // enero → 1 de febrero) — no hace falta lógica aparte para cruzar
    // meses/años.
    const cursorDia = new Date(Date.UTC(hoy.anio, hoy.mesIndex, hoy.dia + i));
    const fechaDia = { anio: cursorDia.getUTCFullYear(), mesIndex: cursorDia.getUTCMonth(), dia: cursorDia.getUTCDate() };
    const diaSemana = cursorDia.getUTCDay();
    const bloques = horario.filter(h => h.diaSemana === diaSemana);
    if (bloques.length === 0) continue;

    const slots = [];
    for (const bloque of bloques) {
      let cursor = combinarFechaHora(zona, fechaDia, bloque.horaInicio);
      const fin = combinarFechaHora(zona, fechaDia, bloque.horaFin);
      while (cursor.getTime() + duracion * 60000 <= fin.getTime()) {
        if (cursor.getTime() > Date.now()) {
          const inicioSlot = cursor.getTime();
          const finSlot = inicioSlot + duracion * 60000;
          const ocupadoEnSymphomed = citasOcupadas.some(c => {
            const inicioC = new Date(c.fecha).getTime();
            const finC = inicioC + (c.duracionMinutos || 30) * 60000;
            return seSuperponen(inicioSlot, finSlot, inicioC, finC);
          });
          const ocupadoEnCalendar = ocupadoCalendar.some(b => seSuperponen(inicioSlot, finSlot, b.inicio.getTime(), b.fin.getTime()));
          if (!ocupadoEnSymphomed && !ocupadoEnCalendar) slots.push(new Date(cursor));
        }
        cursor = new Date(cursor.getTime() + duracion * 60000);
      }
    }
    if (slots.length) {
      const fechaStr = `${fechaDia.anio}-${String(fechaDia.mesIndex + 1).padStart(2, "0")}-${String(fechaDia.dia).padStart(2, "0")}`;
      dias.push({ fecha: fechaStr, slots });
    }
  }
  return dias;
}

// Un horario puntual sigue libre? (se revalida antes de confirmar una
// reserva, por si se ocupó entre que se mostró la lista y se eligió — ya
// sea en Symphomed o directo en el Google Calendar del médico).
async function horarioSigueLibre(medicoPhone, fecha, duracionMinutos) {
  const inicio = new Date(fecha).getTime();
  const fin = inicio + duracionDe(duracionMinutos) * 60000;
  const margen = 6 * 3600000;

  const [citas, medico] = await Promise.all([
    Cita.find({
      medicoPhone, estado: "confirmada",
      fecha: { $gte: new Date(inicio - margen), $lte: new Date(fin) },
    }).select("fecha duracionMinutos").lean(),
    Medico.findOne({ phone: medicoPhone }).select("googleCalendarId").lean(),
  ]);

  const ocupadoEnSymphomed = citas.some(c => {
    const inicioC = new Date(c.fecha).getTime();
    const finC = inicioC + (c.duracionMinutos || 30) * 60000;
    return seSuperponen(inicio, fin, inicioC, finC);
  });
  if (ocupadoEnSymphomed) return false;

  if (medico?.googleCalendarId) {
    const ocupadoCalendar = await obtenerOcupadoEnRango(medico.googleCalendarId, new Date(inicio - margen), new Date(fin + margen));
    if (ocupadoCalendar.some(b => seSuperponen(inicio, fin, b.inicio.getTime(), b.fin.getTime()))) return false;
  }
  return true;
}

module.exports = { obtenerHorariosDisponibles, horarioSigueLibre, duracionValida, duracionDe, DURACION_MIN, DURACION_MAX, FRANJAS_MAX };
