// Vitalis — utilidades chicas compartidas entre rutas
const { CONFIG } = require("../config");

const MS_OFFSET_BOLIVIA = CONFIG.OFFSET_HORAS * 60 * 60 * 1000; // -4h fijo, sin horario de verano

// Día boliviano (para resetear el código diario de vinculación del celular).
function fechaStrBolivia(date = new Date()) {
  const t = new Date(date.getTime() + CONFIG.OFFSET_HORAS * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

// El server puede correr en cualquier zona horaria (en producción, UTC) —
// nunca hay que asumir que Date/local === hora boliviana. Estas dos
// funciones son el único lugar donde se cruza "hora de pared boliviana"
// con "instante UTC real" para todo lo relacionado a la Agenda (ver
// services/agenda.js, routes/citas.js, services/reservaCitas.js).

// Arma el instante UTC real (el que se guarda en Mongo) para una hora de
// pared boliviana concreta. mesIndex es 0-indexado (como Date normal).
function instanteBolivia(anio, mesIndex, dia, hora = 0, minuto = 0) {
  return new Date(Date.UTC(anio, mesIndex, dia, hora, minuto, 0, 0) - MS_OFFSET_BOLIVIA);
}

// "Hoy" en Bolivia como {anio, mesIndex, dia, diaSemana} — sin importar en
// qué zona horaria corre el server. OJO: siempre con los getters *UTC* acá
// adentro (nunca los locales, que dependen de la zona del server).
function hoyBolivia() {
  const desplazado = new Date(Date.now() + MS_OFFSET_BOLIVIA);
  return {
    anio: desplazado.getUTCFullYear(),
    mesIndex: desplazado.getUTCMonth(),
    dia: desplazado.getUTCDate(),
    diaSemana: desplazado.getUTCDay(),
  };
}

// Convierte el string crudo de un <input type="datetime-local"> del
// navegador ("YYYY-MM-DDTHH:mm", sin timezone) al instante UTC real,
// asumiendo que representa una hora de pared BOLIVIANA (así la tipeó el
// médico — el navegador no manda ninguna zona horaria en ese valor).
function fechaLocalBoliviaAInstante(str) {
  const m = String(str || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(NaN);
  return instanteBolivia(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

module.exports = { fechaStrBolivia, MS_OFFSET_BOLIVIA, instanteBolivia, hoyBolivia, fechaLocalBoliviaAInstante };
