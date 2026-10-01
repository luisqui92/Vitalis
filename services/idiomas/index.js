// Symphomed — Idiomas y países.
//
// ═══ POR QUÉ UNA CARPETA POR IDIOMA ════════════════════════════════════════
//
// Lo que cambia entre Bolivia y Brasil estaba repartido en quince archivos:
// el vocabulario del transcriptor adentro de assemblyai.js, las reglas de la
// nota adentro de notaClinica.js, y la pregunta «¿esta cuenta es de Brasil?»
// escrita cinco veces a mano (moneda === "BRL" || idioma === "pt"). Cada
// copia era una oportunidad de que una se quede atrás.
//
// Ahora cada idioma es una carpeta con todo lo suyo:
//   services/idiomas/pt/index.js         país, moneda, locale, WhatsApp, lista oficial
//   services/idiomas/pt/transcripcion.js vocabulario para el transcriptor
//   services/idiomas/pt/nota.js          cómo se escribe la nota clínica
//   services/idiomas/pt/kardex.js        los textos del Kardex en PDF
// (los textos de pantalla siguen en public/i18n/pt/, que ya era así).
//
// Sumar un idioma = copiar una carpeta, traducirla y agregarla abajo. La
// prueba scripts/pruebas/probar_idiomas.js exige que todas tengan las mismas
// piezas, para que a ninguna le falte algo que las otras tienen.
const IDIOMAS = {
  es: require("./es"),
  pt: require("./pt"),
};

// El idioma de todo lo que no dice cuál es. Bolivia fue el primero.
const POR_DEFECTO = "es";

// Uno desconocido cae en español y no en vacío: mejor el vocabulario
// equivocado que ninguno.
function idiomaSoportado(idioma) {
  return IDIOMAS[idioma] ? idioma : POR_DEFECTO;
}

function perfil(idioma) {
  return IDIOMAS[idiomaSoportado(idioma)];
}

// El idioma de una cuenta de médico.
function idiomaDeCuenta(medico) {
  return idiomaSoportado(medico?.idioma);
}

// ¿Esta cuenta es de Brasil? Por la moneda O por el idioma: una cuenta
// brasileña vieja pudo quedar con el idioma en español, y una que eligió
// portugués es de Brasil aunque todavía pague en otra moneda. Es el mismo
// criterio que estaba copiado en cada aviso por WhatsApp.
function esCuentaBrasil(medico) {
  return medico?.moneda === "BRL" || medico?.idioma === "pt";
}

module.exports = { IDIOMAS, POR_DEFECTO, idiomaSoportado, perfil, idiomaDeCuenta, esCuentaBrasil };
