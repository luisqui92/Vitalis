// Symphomed — Idioma de la interfaz.
//
// Se carga ANTES que estado.js: de acá en adelante, cualquier texto que el
// médico vea en pantalla sale de t(), no de un literal suelto en el medio
// del HTML.
//
// Por qué un diccionario y no dos copias del código: un solo Symphomed que
// habla dos idiomas se arregla una vez. Dos copias se arreglan dos veces, y
// la segunda vez alguien se olvida. En un sistema clínico "alguien se
// olvidó" significa que los médicos de un país siguen viendo un número mal
// calculado durante meses, porque el arreglo se hizo en la otra copia.
//
// El idioma es del MÉDICO, no del servidor ni del navegador. Es un ajuste
// profesional —en qué idioma escribe su historia clínica— y no una
// preferencia del aparato desde el que entró: el mismo médico que consulta
// desde el celular del consultorio y desde su notebook escribe en el mismo
// idioma en los dos lados.
const IDIOMAS = ["es", "pt"];

const guardado = localStorage.getItem("salud_idioma");
let MEDICO_IDIOMA = IDIOMAS.includes(guardado) ? guardado : "es";

// Los dos diccionarios se cargan siempre. Juntos pesan poco (el servidor los
// manda comprimidos con brotli, ver services/estaticosComprimidos.js) y
// tener el español entero en memoria es lo que hace posible el respaldo de
// t(): una clave que todavía no se tradujo sale en español en vez de romper
// la pantalla.
const I18N = { es: {}, pt: {} };

// t("agenda.cargando")                       → "Cargando agenda..."
// t("clin.consultorios", { n: 7 })           → "7 consultorios"
function t(clave, vars) {
  const dic = I18N[MEDICO_IDIOMA] || I18N.es;
  let texto = dic[clave];
  // Respaldo al español a propósito. Un médico prefiere leer una palabra en
  // español antes que ver "agenda.cargando" crudo en la pantalla: un texto
  // sin traducir es feo, una clave visible es un error que lo desconcierta.
  if (texto == null) texto = I18N.es[clave];
  if (texto == null) {
    console.warn("[i18n] falta la clave:", clave);
    return clave;
  }
  if (vars) {
    for (const k of Object.keys(vars)) texto = texto.split("{" + k + "}").join(vars[k]);
  }
  return texto;
}

// Para fechas y números. Separado del idioma porque no son lo mismo: el
// idioma dice en qué se escribe, el locale dice cómo se formatea un 1.234,56
// y un "mié 25 ago". Hoy hay uno por idioma; el día que entre otro país que
// hable español esto se parte sin tocar los textos.
function localeActual() {
  return MEDICO_IDIOMA === "pt" ? "pt-BR" : "es-BO";
}

// ═══ LAS FECHAS PASAN TODAS POR ACÁ ════════════════════════════════════════
//
// Había 60 lugares formateando fechas: 37 respetaban el idioma del médico y
// 23 tenían "es-BO" escrito a mano. Ninguno estaba mal en el ORDEN —es-BO y
// pt-BR usan los dos día/mes/año, así que nadie iba a leer un mes por un
// día— pero los de mes largo sí se notaban, y el peor estaba en el informe
// que recibe la familia: a una madre brasileña le llegaba "16 de septiembre"
// en vez de "16 de setembro". Es el único documento de Symphomed que no lee
// un profesional.
//
// Tres funciones y ninguna excepción:
//   fechaCorta(f)  → 16/9/2026                 · la de todos los días
//   fechaLarga(f)  → 16 de septiembre de 2026  · informes y documentos
//   fechaHora(f)   → 16/09/2026 14:30          · agenda y turnos
//
// Toleran null y texto vacío porque la mitad de las fechas del sistema son
// opcionales, y un "Invalid Date" impreso en una ficha clínica es peor que
// un guion.
function fechaComoDate(f) {
  // Una fecha sin hora es un día civil, no medianoche UTC. `new Date("2026-09-16")`
  // la convertiría en el día anterior en Bolivia; construirla con componentes
  // locales conserva exactamente el día que escribió el médico.
  const partes = typeof f === "string" && /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(f);
  if (partes) return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return new Date(f);
}

function fechaCalendarioLocal(valor = new Date()) {
  const d = valor instanceof Date ? valor : fechaComoDate(valor);
  if (isNaN(d)) return "";
  const dos = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function fechaCorta(f) {
  if (!f) return "—";
  const d = fechaComoDate(f);
  return isNaN(d) ? "—" : d.toLocaleDateString(localeActual());
}

function fechaLarga(f, opciones) {
  if (!f) return "—";
  const d = fechaComoDate(f);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(localeActual(), opciones || { day: "numeric", month: "long", year: "numeric" });
}

function fechaHora(f) {
  if (!f) return "—";
  const d = new Date(f);
  if (isNaN(d)) return "—";
  return d.toLocaleString(localeActual(), {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ═══ LA HORA, EN LA ZONA DE QUIEN MIRA ═════════════════════════════════════
//
// La agenda tenía timeZone: "America/La_Paz" escrito a mano. Para un
// consultorio de Bolivia daba bien por casualidad; para uno de Brasil daba
// TODAS las horas corridas sesenta minutos, porque Brasil está en UTC−3 y
// Bolivia en UTC−4.
//
// Un turno que dice 14:00 cuando en realidad es 15:00 no es un problema de
// formato: es un paciente que llega una hora tarde, o un médico que lo
// esperó una hora. Ya estaba anotado como pendiente en routes/admin.js.
//
// Sin timeZone, el navegador usa la del aparato — que es exactamente la del
// lugar donde está parado quien mira la pantalla, que es lo correcto tanto
// en La Paz como en São Paulo.
//
// El bot de WhatsApp y el asistente de voz mandan las horas desde el
// SERVIDOR, donde no hay navegador del cual sacar la zona. Ese caso se
// resolvió aparte, con un campo de zona horaria en Medico: ver
// services/zonaHoraria.js.
// hour12: false a propósito, en los dos idiomas. Sin eso, es-BO da "2:30
// p. m." y pt-BR da "14:30" — cada uno correcto para su locale, pero en una
// agenda clínica el reloj de 24 horas es la convención en los dos países y
// no se presta a confundir las dos de la tarde con las dos de la mañana. El
// bot de WhatsApp ya usaba este mismo criterio.
function horaCorta(f) {
  if (!f) return "—";
  const d = new Date(f);
  if (isNaN(d)) return "—";
  return d.toLocaleTimeString(localeActual(), { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Se llama al iniciar sesión (auth.js) y al cerrarla (estado.js). El
// atributo lang del documento importa de verdad: es lo que usan el corrector
// ortográfico de los campos de texto y los lectores de pantalla para saber
// en qué idioma está leyendo.
function fijarIdioma(idioma) {
  MEDICO_IDIOMA = IDIOMAS.includes(idioma) ? idioma : "es";
  localStorage.setItem("salud_idioma", MEDICO_IDIOMA);
  document.documentElement.lang = MEDICO_IDIOMA === "pt" ? "pt-BR" : "es";
}

// Al cargar la página el médico ya puede tener sesión: dejamos el atributo
// lang acorde antes de que se pinte nada.
document.documentElement.lang = MEDICO_IDIOMA === "pt" ? "pt-BR" : "es";
