// Symphomed — Español · cómo se escribe la nota clínica en este idioma.
// Lo usa services/notaClinica.js (y services/notaVozLote.js, el dictado de
// ganadería). Las CLAVES del JSON de la nota no se traducen nunca: eso lo
// dice el prompt general, no esto.
module.exports = {
  // Cómo se le nombra el idioma a la IA ("una consulta médica en …").
  nombre: "español",
  // Para resolver "el sábado", "el lunes que viene" a una fecha real.
  dias: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  // Reglas que solo valen en este idioma. En español no hace falta ninguna.
  reglasExtra: "",
};
