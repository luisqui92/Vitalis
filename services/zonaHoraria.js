// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Zonas horarias: la agenda de cada médico, en SU hora
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══ QUÉ ESTABA MAL, Y POR QUÉ ERA PEOR DE LO QUE PARECÍA ══════════════════
//
// services/utils.js convertía entre "hora de pared" e instante UTC con un
// desfase FIJO de −4 horas: la hora de Bolivia. Para un consultorio boliviano
// daba bien; para uno brasileño daba mal todo, y no solo en la pantalla:
//
//   · Los horarios libres se calculaban en hora boliviana. Un kinesiólogo de
//     São Paulo que atiende de 9 a 18 recibía turnos de 10 a 19.
//   · El turno que el médico tipea a mano se guardaba una hora corrida.
//   · El WhatsApp le decía al paciente una hora que no era.
//
// Lo grave es el segundo: no es un problema de cómo se muestra, es que el
// dato guardado está mal. Arreglar solo el formato habría dejado la app
// pareciendo correcta y siendo incorrecta, que es peor que el bug original.
//
// ═══ POR QUÉ NOMBRES DE ZONA Y NO UN NÚMERO ════════════════════════════════
//
// La tentación es guardar "−3" y listo. No sirve: Brasil tuvo horario de
// verano y puede volver a tenerlo, y un desfase fijo se equivoca dos veces
// por año, justo la semana en que nadie relaciona el turno corrido con el
// cambio de hora.
//
// Se guarda "America/Sao_Paulo" y el desfase lo resuelve Intl para CADA
// instante. Bolivia no tiene horario de verano, así que ahí da siempre −4 y
// el comportamiento no cambia en nada.

// La de siempre. Toda cuenta que no diga otra cosa trabaja en hora boliviana,
// que es donde está el grueso de Symphomed hoy.
const ZONA_POR_DEFECTO = "America/La_Paz";

// Qué zona le corresponde a una cuenta nueva según su moneda. Es un punto de
// partida, no una atadura: el campo se puede cambiar. Una lista corta a
// propósito — adivinar la zona de un país con cuatro husos (Brasil tiene
// varios) sería peor que preguntar.
const ZONA_POR_MONEDA = {
  BOB: "America/La_Paz",
  BRL: "America/Sao_Paulo",
};

function zonaPorMoneda(moneda) {
  return ZONA_POR_MONEDA[String(moneda || "").toUpperCase()] || ZONA_POR_DEFECTO;
}

// Una zona que el motor no conoce tira excepción al formatear, y eso caería
// en medio de armar la agenda. Se valida una vez y se cae a la de siempre.
function zonaValida(tz) {
  if (!tz) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

// ─── EL DESFASE REAL EN UN INSTANTE DADO ──────────────────────────────────
//
// En milisegundos. Es lo único que hace falta para cruzar hora de pared con
// instante, y lo resuelve Intl mirando la base de datos de husos del sistema
// —con horario de verano incluido— en vez de una tabla nuestra que
// envejecería.
//
// El truco: se le pide a Intl que escriba ESE instante en la zona pedida, se
// vuelve a armar como si fuera UTC, y la diferencia entre las dos es el
// desfase.
const PARTES = new Map();
function formateador(tz) {
  if (!PARTES.has(tz)) {
    PARTES.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return PARTES.get(tz);
}

function desfaseMs(tz, instante) {
  const p = {};
  for (const { type, value } of formateador(tz).formatToParts(instante)) p[type] = value;
  // hourCycle h23 puede devolver "24" a medianoche en algunos motores.
  const hora = p.hour === "24" ? 0 : Number(p.hour);
  const comoUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hora, Number(p.minute), Number(p.second));
  return comoUTC - instante.getTime();
}

// ─── HORA DE PARED → INSTANTE ─────────────────────────────────────────────
//
// Es la conversión difícil y por eso está en un solo lugar. El desfase que
// hay que restar depende del instante que todavía no conocemos, así que se
// estima, se mide el desfase real ahí, y se corrige. Dos pasadas alcanzan
// para cualquier zona del mundo, incluido el salto de horario de verano.
function instanteEnZona(tz, anio, mesIndex, dia, hora = 0, minuto = 0) {
  const zona = zonaValida(tz);
  const comoSiFueraUTC = Date.UTC(anio, mesIndex, dia, hora, minuto, 0, 0);
  let instante = new Date(comoSiFueraUTC - desfaseMs(zona, new Date(comoSiFueraUTC)));
  // Segunda pasada: si el primer tanteo cayó del otro lado de un cambio de
  // hora, el desfase medido era el equivocado.
  instante = new Date(comoSiFueraUTC - desfaseMs(zona, instante));
  return instante;
}

// ─── "HOY" EN LA ZONA DE LA CUENTA ────────────────────────────────────────
//
// Sin esto, un médico brasileño que abre la agenda a las 22:30 del martes
// —cuando en el servidor UTC ya es miércoles— ve la agenda del día
// equivocado.
function hoyEnZona(tz, ahora = new Date()) {
  const zona = zonaValida(tz);
  const desplazado = new Date(ahora.getTime() + desfaseMs(zona, ahora));
  return {
    anio: desplazado.getUTCFullYear(),
    mesIndex: desplazado.getUTCMonth(),
    dia: desplazado.getUTCDate(),
    diaSemana: desplazado.getUTCDay(),
  };
}

// El día como "YYYY-MM-DD" en la zona de la cuenta.
function fechaStrEnZona(tz, fecha = new Date()) {
  const h = hoyEnZona(tz, fecha);
  return `${h.anio}-${String(h.mesIndex + 1).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`;
}

// El string crudo de un <input type="datetime-local"> —"YYYY-MM-DDTHH:mm",
// sin zona— es hora de pared de quien lo tipeó. El navegador no manda
// ninguna zona en ese valor, así que la pone la cuenta.
function localAInstante(tz, str) {
  const m = String(str || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(NaN);
  return instanteEnZona(tz, Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

// ─── PARA ESCRIBIRLE AL PACIENTE ──────────────────────────────────────────
// El bot manda estas horas por WhatsApp. Van en 24 horas en los dos idiomas:
// en una cita, "2:00" sin aclarar si es de la tarde es un paciente que
// aparece a la hora equivocada.
function horaEnZona(tz, fecha, locale = "es-BO") {
  return new Date(fecha).toLocaleTimeString(locale, {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zonaValida(tz),
  });
}

function fechaCompletaEnZona(tz, fecha, locale = "es-BO") {
  return new Date(fecha).toLocaleString(locale, {
    weekday: "long", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zonaValida(tz),
  });
}

module.exports = {
  ZONA_POR_DEFECTO, zonaPorMoneda, zonaValida,
  instanteEnZona, hoyEnZona, fechaStrEnZona, localAInstante,
  horaEnZona, fechaCompletaEnZona, desfaseMs,
};
