// Symphomed — Português (Brasil) · cómo se escribe la nota clínica.
// Lo usa services/notaClinica.js (y services/notaVozLote.js, el dictado de
// ganadería). Las CLAVES del JSON de la nota no se traducen nunca: eso lo
// dice el prompt general, no esto (ver el caso de la nota vacía en
// notaClinica.js: la IA tradujo las claves y se perdió la nota entera).
module.exports = {
  nombre: "portugués de Brasil",
  dias: ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"],
  // Los nombres de fármacos son el punto donde una nota en portugués se
  // vuelve peligrosa si sale calcada del español: losartana y no losartán,
  // varfarina y no warfarina, dipirona y no metamizol.
  reglasExtra: `
Los nombres de medicamentos van con la denominación que se usa en Brasil (DCB,
la nomenclatura oficial de ANVISA), no traducidos del español.`,
};
