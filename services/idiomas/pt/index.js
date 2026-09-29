// Symphomed — Português (Brasil): todo lo que cambia por idioma y país, en
// un solo lugar. Ver services/idiomas/index.js.
module.exports = {
  codigo: "pt",
  locale: "pt-BR",
  lang: "pt-BR",
  pais: "BR",
  moneda: "BRL",
  // Meta exige la región: "pt" a secas no existe como idioma de plantilla.
  metaWhatsapp: "pt_BR",
  // DCB de ANVISA (Denominação Comum Brasileira).
  listaMedicamentos: "dcb.json",
  transcripcion: require("./transcripcion"),
  nota: require("./nota"),
};
