// Symphomed — Español (Bolivia): todo lo que cambia por idioma y país, en un
// solo lugar. Ver services/idiomas/index.js.
module.exports = {
  codigo: "es",
  // Cómo se formatean fechas y números (Intl / toLocaleString).
  locale: "es-BO",
  // <html lang>, manifiestos.
  lang: "es",
  // País de la cuenta: prefijo telefónico, datos de pago.
  pais: "BO",
  // Moneda con que nace una cuenta nueva en este idioma (después vive sola).
  moneda: "BOB",
  // Código de idioma para las plantillas de WhatsApp de Meta.
  metaWhatsapp: "es",
  // Lista oficial de medicamentos (datos/medicamentos/): LINAME de Bolivia.
  listaMedicamentos: "liname.json",
  transcripcion: require("./transcripcion"),
  nota: require("./nota"),
};
