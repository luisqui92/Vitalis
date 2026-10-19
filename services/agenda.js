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
// HH:MM de 00:00 a 23:59 (los segundos, si vienen, se ignoran).
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Minutos enteros de 5 a 240, o null.
function duracionValida(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= DURACION_MIN && n <= DURACION_MAX ? n : null;
}
// La que se usa: la guardada si es válida; si no, media hora.
const duracionDe = (valor) => duracionValida(valor) || 30;
const diasDe = (valor, porDefecto) => Math.min(DIAS_MAX, Math.max(1, Math.floor(Number(valor)) || porDefecto));

// Una franja que sirve: un día de 0 a 6 y dos horas de verdad, la primera
// antes que la segunda. Es la regla con la que se guarda (routes/citas.js), y
// acá se vuelve a mirar porque lo guardado antes de esa regla no pasó por
// ella: una franja vieja de «00:00» a «99999:00» armaba casi tres millones de
// horarios por pedido.
function franjaValida(h) {
  return Number.isInteger(h?.diaSemana) && h.diaSemana >= 0 && h.diaSemana <= 6
    && HORA_VALIDA.test(String(h.horaInicio)) && HORA_VALIDA.test(String(h.horaFin))
    && h.horaInicio < h.horaFin;
}

function minutosDe(horaStr) {
  const [h, m] = String(horaStr).split(":").map(Number);
  return h * 60 + m;
}

// Las franjas de un día, en minutos desde la medianoche, en orden y sin
// pisarse: dos que se superponen se juntan en una. La pantalla carga una
// franja por día (public/js/agenda.js), pero la API acepta hasta 50, y la
// misma franja repetida armaba cada horario tantas veces como estuviera
// repetida. Juntas, un día no puede dar más horarios que los que entran en
// 24 horas. Las que solo se tocan (de 8 a 12 y de 12 a 16) quedan como están,
// cada una con su propia grilla.
function franjasDelDia(horario, diaSemana) {
  const franjas = horario
    .filter(h => h.diaSemana === diaSemana)
    .map(h => ({ inicio: minutosDe(h.horaInicio), fin: minutosDe(h.horaFin) }))
    .sort((a, b) => a.inicio - b.inicio);
  const juntas = [];
  for (const f of franjas) {
    const anterior = juntas[juntas.length - 1];
    if (anterior && f.inicio < anterior.fin) anterior.fin = Math.max(anterior.fin, f.fin);
    else juntas.push(f);
  }
  return juntas;
}

// ¿Un horario choca con alguno de estos intervalos ({inicio, fin} en ms)?
// Se pregunta horario por horario, en orden. Antes cada horario recorría
// TODAS las citas del rango: con 50 franjas y 2.000 citas futuras, pedir 60
// días de disponibilidad trababa el proceso 14 segundos, para todos
// (auditoría del comité de QA, octubre de 2026, B3). Con los intervalos
// ordenados alcanza una sola pasada: entre los que empiezan antes de que
// termine el horario, basta saber cuál termina más tarde.
function detectorDeChoques(intervalos) {
  const lista = [...intervalos].sort((a, b) => a.inicio - b.inicio);
  let siguiente = 0, finMasTarde = -Infinity, finAnterior = -Infinity;
  return (inicio, fin) => {
    // Una pregunta fuera de orden no da una respuesta equivocada: se vuelve
    // a empezar.
    if (fin < finAnterior) { siguiente = 0; finMasTarde = -Infinity; }
    finAnterior = fin;
    while (siguiente < lista.length && lista[siguiente].inicio < fin) {
      finMasTarde = Math.max(finMasTarde, lista[siguiente].fin);
      siguiente++;
    }
    return finMasTarde > inicio;
  };
}

// fechaDia: {anio, mesIndex, dia} de un día concreto EN LA ZONA DEL MÉDICO
// (nunca un Date de "hora local del server" — en producción corre en UTC).
//
// La zona llega como parámetro y no se lee adentro: esta función se llama
// una vez por cada casillero de cada día, y buscar al médico en cada llamada
// sería un pedido a la base por casillero.
function combinarFechaHora(zona, fechaDia, minutos) {
  return instanteEnZona(zona, fechaDia.anio, fechaDia.mesIndex, fechaDia.dia, Math.floor(minutos / 60), minutos % 60);
}

// [{ fecha: "2026-08-11", slots: [Date, ...] }, ...] — solo días con al
// menos un horario libre, solo horarios futuros.
async function obtenerHorariosDisponibles(medicoPhone, diasPedidos = 7) {
  const diasAdelante = diasDe(diasPedidos, 7);
  const medico = await Medico.findOne({ phone: medicoPhone }).lean();
  if (!medico) return [];
  const duracion = duracionDe(medico.duracionConsultaMinutos);
  const horario = (medico.horarioAtencion || []).slice(0, FRANJAS_MAX).filter(franjaValida);
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

  const chocaEnSymphomed = detectorDeChoques(citasOcupadas.map(c => {
    const inicio = new Date(c.fecha).getTime();
    return { inicio, fin: inicio + (c.duracionMinutos || 30) * 60000 };
  }));
  const chocaEnCalendar = detectorDeChoques(ocupadoCalendar.map(b => ({ inicio: b.inicio.getTime(), fin: b.fin.getTime() })));

  const dias = [];
  for (let i = 0; i < diasAdelante; i++) {
    // Date.UTC normaliza solo si "dia" se pasa de fin de mes (día 32 de
    // enero → 1 de febrero) — no hace falta lógica aparte para cruzar
    // meses/años.
    const cursorDia = new Date(Date.UTC(hoy.anio, hoy.mesIndex, hoy.dia + i));
    const fechaDia = { anio: cursorDia.getUTCFullYear(), mesIndex: cursorDia.getUTCMonth(), dia: cursorDia.getUTCDate() };
    const diaSemana = cursorDia.getUTCDay();
    const bloques = franjasDelDia(horario, diaSemana);
    if (bloques.length === 0) continue;

    const slots = [];
    for (const bloque of bloques) {
      let cursor = combinarFechaHora(zona, fechaDia, bloque.inicio);
      const fin = combinarFechaHora(zona, fechaDia, bloque.fin);
      while (cursor.getTime() + duracion * 60000 <= fin.getTime()) {
        if (cursor.getTime() > Date.now()) {
          const inicioSlot = cursor.getTime();
          const finSlot = inicioSlot + duracion * 60000;
          if (!chocaEnSymphomed(inicioSlot, finSlot) && !chocaEnCalendar(inicioSlot, finSlot)) slots.push(new Date(cursor));
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
//
// excluir: al mover una cita que ya existe, { citaId, desde, hasta }. Ella
// misma no cuenta como ocupación, y tampoco su evento de Google, que hasta
// que se guarde sigue en la hora vieja (desde–hasta): sin esto, correrla
// menos de lo que dura daba un choque consigo misma. Ese tramo se le resta
// al bloque ocupado en vez de sacar el bloque entero, porque Google devuelve
// en un solo bloque los eventos que se tocan.
async function horarioSigueLibre(medicoPhone, fecha, duracionMinutos, excluir = null) {
  const inicio = new Date(fecha).getTime();
  const fin = inicio + duracionDe(duracionMinutos) * 60000;
  const margen = 6 * 3600000;

  const [citas, medico] = await Promise.all([
    Cita.find({
      medicoPhone, estado: "confirmada",
      fecha: { $gte: new Date(inicio - margen), $lte: new Date(fin) },
      ...(excluir?.citaId ? { _id: { $ne: excluir.citaId } } : {}),
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
    const propioDesde = excluir?.desde ? new Date(excluir.desde).getTime() : null;
    const propioHasta = excluir?.hasta ? new Date(excluir.hasta).getTime() : null;
    const bloques = ocupadoCalendar.flatMap(b => {
      const bInicio = b.inicio.getTime(), bFin = b.fin.getTime();
      if (propioDesde === null || propioHasta === null) return [[bInicio, bFin]];
      return [[bInicio, Math.min(bFin, propioDesde)], [Math.max(bInicio, propioHasta), bFin]].filter(([a, z]) => a < z);
    });
    if (bloques.some(([a, z]) => seSuperponen(inicio, fin, a, z))) return false;
  }
  return true;
}

module.exports = {
  obtenerHorariosDisponibles, horarioSigueLibre, franjaValida,
  duracionValida, duracionDe, DURACION_MIN, DURACION_MAX, FRANJAS_MAX,
};
