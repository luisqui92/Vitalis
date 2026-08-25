// Vitalis — Textos en portugués (pt-BR).
//
// A propósito está casi vacío. La traducción de verdad no la hace este
// archivo solo: la interfaz sí se puede traducir de forma mecánica, pero
// los textos que un médico brasileño juzga —la nota clínica, lo que su
// paciente recibe por WhatsApp, el vocabulario del dictado— son una
// reescritura, no una traducción, y necesitan a un médico que ejerza en
// Brasil. Hasta que eso pase, este archivo se llena de a poco y a
// conciencia, no de una corrida.
//
// Mientras tanto el sistema funciona igual: t() cae al español para
// cualquier clave que todavía no esté acá (ver public/js/i18n.js). Una
// pantalla a medio traducir se ve mezclada, pero nunca rota.
//
// Lo único que ya está son los días de la semana: son mecánicos, no tienen
// matiz clínico, y sirven para comprobar que el mecanismo funciona de
// punta a punta.
Object.assign(I18N.pt, {
  "dia.corto.0": "Dom",
  "dia.corto.1": "Seg",
  "dia.corto.2": "Ter",
  "dia.corto.3": "Qua",
  "dia.corto.4": "Qui",
  "dia.corto.5": "Sex",
  "dia.corto.6": "Sáb",
});
