// Vitalis — Idioma de la interfaz.
//
// Se carga ANTES que estado.js: de acá en adelante, cualquier texto que el
// médico vea en pantalla sale de t(), no de un literal suelto en el medio
// del HTML.
//
// Por qué un diccionario y no dos copias del código: un solo Vitalis que
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
// t("agenda.dias", { n: 14 })                → "Próximos 14 días"
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
