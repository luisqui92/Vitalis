// Symphomed — Las colecciones del módulo de estudiantes.
//
// Todo lo que un estudiante hace vive acá: sus códigos de invitación, su
// razonamiento de cada caso, sus tarjetas, su racha, sus prácticas con el
// paciente virtual y sus simulacros. El núcleo (db/models.js) no las
// conoce; el módulo sí lee las del núcleo (la cuenta, sus consultas, sus
// pacientes), que es la dirección permitida.
//
// De la cuenta queda en el núcleo solo lo que es de la cuenta (Medico.
// estudiante: nivel, vencimiento, horas) y la marca de las notas
// (ConsultaMedica.deEstudiante), porque están en producción desde la
// etapa 1 y viven en esos documentos.
//
// Requiere db/models.js primero: es el que abre la conexión, y así quien
// use solo estas colecciones (un script) se conecta igual.
require("../../db/models");
const mongoose = require("mongoose");

// ─── CÓDIGOS DE INVITACIÓN PARA ESTUDIANTES ────────────────────────────────
//
// Un código, una persona: el primero que lo usa se queda con él, y queda
// anotado quién. Así Symphomed decide quién entra como estudiante, por
// cuánto tiempo y con cuántas horas de audio. Los crea y los anula
// scripts/codigos_estudiante.js.
const codigoEstudianteSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true },
  // De qué carrera es (carreras.js): medicina, enfermería. Los de antes, de
  // medicina.
  carrera: { type: String, default: "medicina" },
  nivel: { type: String, enum: ["estudiante", "interno", "residente"], required: true },
  meses: { type: Number, required: true, min: 1, max: 24 },
  horasMes: { type: Number, required: true, min: 1 },
  // Lo que se cobró por este acceso, para saber qué paga cada uno.
  precioCentavos: { type: Number, default: 0 },
  moneda: { type: String, default: "BOB" },
  nota: { type: String, default: "" },        // «Univalle, 5to año», «grupo de Juan»
  // Un código que nadie usó no vale para siempre: si se pierde en un chat,
  // que no sirva dentro de un año.
  vence: { type: Date, required: true },
  anulado: { type: Boolean, default: false },
  usadoPor: { type: String, default: null, index: true },
  usadoEn: { type: Date, default: null },
  creadoPor: { type: String, default: "" },
}, { timestamps: true });
const CodigoEstudiante = mongoose.model("CodigoEstudiante", codigoEstudianteSchema);

// ─── TARJETAS DE ESTUDIO (ver estudio.js) ──────────────────────────────────
//
// Las preguntas de repaso de un estudiante, hechas con SUS casos: salen del
// razonamiento que hizo de cada consulta (RazonamientoDiagnostico), sin
// pedirle nada nuevo a la IA. Se repasan espaciadas: la que sabe vuelve cada
// vez más lejos; la que no, vuelve mañana.
//
// Las de tipo "pregunta" son las que erró en un simulacro (PreguntaSimulacro,
// más abajo): no tienen consulta, tienen la pregunta.
const tarjetaEstudioSchema = new mongoose.Schema({
  medicoPhone: { type: String, required: true },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null,
    required() { return this.tipo !== "pregunta" && !this.simulacionId; } },
  tipo: { type: String, enum: ["dx", "estudio", "banderas", "faltoPreguntar", "pregunta", "planDental", "odontograma"], required: true },
  // Las de un razonamiento de enfermería: los mismos tipos, otras preguntas
  // («¿cuál es el diagnóstico de enfermería prioritario?», «¿qué
  // intervención corresponde?»). Sin carrera, de medicina.
  carrera: { type: String, default: undefined },
  simulacionId: { type: mongoose.Schema.Types.ObjectId, ref: "SimulacionPaciente", default: null },
  registroEsperado: { type: [{ diente: Number, superficie: String, estado: String, nota: String, _id: false }], default: undefined },
  preguntaId: { type: mongoose.Schema.Types.ObjectId, ref: "PreguntaSimulacro", default: null },
  area: { type: String, default: "" },        // la del simulacro
  enunciado: { type: String, default: "" },   // la viñeta y la pregunta del simulacro
  // El caso, sin el nombre del paciente: lo que se lee arriba de la pregunta.
  caso: {
    sexo: { type: String, default: "" },
    edad: { type: Number, default: null },        // años
    edadMeses: { type: Number, default: null },   // solo antes de los 2 años
    motivo: { type: String, default: "" },
    sintomas: { type: [String], default: [] },
    antecedentes: { type: String, default: "" },
    fecha: { type: Date, default: null },         // la de la consulta
  },
  // dx: los diferenciales del caso como opciones, y cuál es el más probable.
  // enContraDe va alineado con opciones: lo que contradice cada una, para
  // explicarle al que eligió otra por qué no era.
  opciones: { type: [String], default: undefined },
  correcta: { type: Number, default: null },
  enContraDe: { type: [String], default: undefined },
  // El diagnóstico al que se refiere la pregunta («¿qué estudio confirma X?»).
  sobre: { type: String, default: "" },
  respuesta: { type: [String], default: [] },
  // Por qué: los datos del caso a favor del diagnóstico, y la perla.
  aFavor: { type: [String], default: [] },
  perla: { type: String, default: "" },
  // Repaso espaciado: caja 1 a 5 (en la 4 y la 5 cuenta como dominada).
  caja: { type: Number, default: 1, min: 1, max: 5 },
  proxima: { type: Date, default: Date.now },
  vistas: { type: Number, default: 0 },
  aciertos: { type: Number, default: 0 },
  errores: { type: Number, default: 0 },
  ultimaVez: { type: Date, default: null },
  // «Esta pregunta está mal»: deja de salir. El motivo es uno de una lista
  // (sin texto libre: no hace falta escribir datos del caso para avisar).
  reportada: {
    en: { type: Date, default: null },
    motivo: { type: String, enum: ["", "respuesta", "pregunta", "datos"], default: "" },
  },
}, { timestamps: true });
tarjetaEstudioSchema.index({ consultaId: 1, tipo: 1 }, { unique: true, partialFilterExpression: { consultaId: { $type: "objectId" } } });
tarjetaEstudioSchema.index({ medicoPhone: 1, preguntaId: 1 }, { unique: true, partialFilterExpression: { preguntaId: { $type: "objectId" } } });
tarjetaEstudioSchema.index({ medicoPhone: 1, simulacionId: 1, tipo: 1 }, { unique: true, partialFilterExpression: { simulacionId: { $type: "objectId" } } });
tarjetaEstudioSchema.index({ medicoPhone: 1, proxima: 1 });
const TarjetaEstudio = mongoose.model("TarjetaEstudio", tarjetaEstudioSchema);

// Lo que un estudiante marcó como «está mal» en algo del banco compartido (un
// caso del paciente virtual, una pregunta de simulacro). Con dos estudiantes
// distintos, sale del banco.
const reporteBancoSchema = { type: [{ medicoPhone: String, motivo: String, en: Date, _id: false }], default: [] };

// ─── PACIENTE VIRTUAL (ver pacienteVirtual.js) ─────────────────────────────
//
// Casos inventados para practicar la entrevista: ningún dato es de un
// paciente real. El guion (lo que el paciente sabe y cuenta, el examen, los
// estudios y el diagnóstico) lo arma una IA y otra lo resuelve a ciegas antes
// de guardarlo. Se reusan entre estudiantes, como las estaciones de un examen
// práctico: cada uno ve cada caso una sola vez.
const casoVirtualSchema = new mongoose.Schema({
  idioma: { type: String, required: true },
  area: { type: String, required: true },
  dificultad: { type: String, enum: ["basico", "intermedio", "avanzado"], required: true },
  guion: { type: mongoose.Schema.Types.Mixed, required: true },
  usos: { type: Number, default: 0 },
  reportes: reporteBancoSchema,
  oculto: { type: Boolean, default: false },
}, { timestamps: true });
casoVirtualSchema.index({ idioma: 1, area: 1, dificultad: 1, oculto: 1, usos: 1 });
const CasoVirtual = mongoose.model("CasoVirtual", casoVirtualSchema);

// Una práctica con un paciente virtual: la conversación, lo que pidió
// examinar y los estudios, su diagnóstico y la evaluación.
const simulacionPacienteSchema = new mongoose.Schema({
  medicoPhone: { type: String, required: true },
  // La que manda la pantalla al empezar: el mismo pedido repetido (se cortó
  // la conexión antes de la respuesta) devuelve esta práctica, no otra.
  clave: { type: String, default: undefined },
  idioma: { type: String, default: "es" },
  area: { type: String, required: true },
  dificultad: { type: String, required: true },
  estado: { type: String, enum: ["preparando", "en_curso", "evaluando", "terminada", "error", "abandonada"], default: "preparando" },
  casoId: { type: mongoose.Schema.Types.ObjectId, ref: "CasoVirtual", default: null },
  // Una copia del guion: el banco puede cambiar; su práctica, no.
  guion: { type: mongoose.Schema.Types.Mixed, default: null },
  mensajes: {
    type: [{
      rol: { type: String, enum: ["estudiante", "paciente", "sistema"] },
      tipo: { type: String, enum: ["inicio", "pregunta", "examen", "estudio"] },
      texto: String,
      en: Date,
      // En lo que pregunta el estudiante: la clave del pedido, para no
      // contestar (ni pagar) dos veces la misma pregunta repetida.
      clave: { type: String, default: undefined },
      _id: false,
    }],
    default: [],
  },
  // Lo que ya se contestó de examen y de estudios: pedir dos veces lo mismo
  // da lo mismo, aunque no estuviera en el guion.
  odontograma: { type: mongoose.Schema.Types.Mixed, default: undefined },
  hallazgos: { type: [{ tipo: String, clave: String, texto: String, _id: false }], default: [] },
  respuesta: {
    principal: { type: String, default: "" },
    diferenciales: { type: [String], default: [] },
    plan: { type: String, default: "" },
    en: { type: Date, default: null },
  },
  evaluacion: { type: mongoose.Schema.Types.Mixed, default: null },
  terminadaEn: { type: Date, default: null },
}, { timestamps: true });
simulacionPacienteSchema.index({ medicoPhone: 1, createdAt: -1 });
simulacionPacienteSchema.index({ medicoPhone: 1, clave: 1 }, { unique: true, partialFilterExpression: { clave: { $type: "string" } } });
const SimulacionPaciente = mongoose.model("SimulacionPaciente", simulacionPacienteSchema);

// ─── SIMULACROS (ver simulacros.js) ────────────────────────────────────────
//
// Preguntas tipo examen de residencia, por área. Las escribe una IA y otra
// las responde a ciegas: solo se guardan las que las dos contestan igual y
// sin dudar. El banco es compartido entre los estudiantes de un idioma; cada
// uno ve cada pregunta una sola vez.
const preguntaSimulacroSchema = new mongoose.Schema({
  idioma: { type: String, required: true },
  area: { type: String, required: true },
  tema: { type: String, default: "" },
  enunciado: { type: String, required: true },
  opciones: { type: [String], required: true },
  correcta: { type: Number, required: true },
  explicacion: { type: String, default: "" },
  porOpcion: { type: [String], default: [] },   // por qué cada opción es o no es
  vistas: { type: Number, default: 0 },
  aciertos: { type: Number, default: 0 },
  reportes: reporteBancoSchema,
  oculta: { type: Boolean, default: false },
}, { timestamps: true });
preguntaSimulacroSchema.index({ idioma: 1, area: 1, oculta: 1 });
const PreguntaSimulacro = mongoose.model("PreguntaSimulacro", preguntaSimulacroSchema);

// Un intento: qué preguntas le tocaron y qué contestó.
const simulacroSchema = new mongoose.Schema({
  medicoPhone: { type: String, required: true },
  clave: { type: String, default: undefined },   // como en la práctica, arriba
  idioma: { type: String, default: "es" },
  // La de la cuenta al empezarlo: con «mixto» dice de qué áreas mezclar.
  carrera: { type: String, default: "medicina" },
  area: { type: String, required: true },
  // práctica: ve la respuesta en cada pregunta. examen: con tiempo, al final.
  modo: { type: String, enum: ["practica", "examen"], default: "practica" },
  cantidad: { type: Number, required: true },
  estado: { type: String, enum: ["preparando", "listo", "terminado", "error"], default: "preparando" },
  preguntas: {
    type: [{
      preguntaId: { type: mongoose.Schema.Types.ObjectId, ref: "PreguntaSimulacro" },
      elegida: { type: Number, default: null },
      acerto: { type: Boolean, default: null },
      en: { type: Date, default: null },
      _id: false,
    }],
    default: [],
  },
  aciertos: { type: Number, default: 0 },
  limiteSegundos: { type: Number, default: 0 },   // solo en modo examen
  empezadoEn: { type: Date, default: null },
  terminadoEn: { type: Date, default: null },
  // Un examen que se cierra deja anotado lo que falta hacer —las
  // estadísticas de cada pregunta y las tarjetas de las que erró— en el
  // mismo cambio que lo cierra, y se borra al terminarlo. Si algo falla en
  // el medio, el próximo pedido lo completa (simulacros.js, completarCierre).
  cierrePendiente: { type: Boolean, default: undefined },
  estadisticasEn: { type: Date, default: undefined },   // ya se sumaron: no se suman otra vez
}, { timestamps: true });
simulacroSchema.index({ medicoPhone: 1, createdAt: -1 });
simulacroSchema.index({ medicoPhone: 1, clave: 1 }, { unique: true, partialFilterExpression: { clave: { $type: "string" } } });
const Simulacro = mongoose.model("Simulacro", simulacroSchema);

// ─── EL RAZONAMIENTO DIAGNÓSTICO (ver tutor.js) ───────────────────────────
//
// El ejercicio de una consulta: lo que propuso el estudiante y, recién
// después, el análisis. Uno por consulta —lo garantiza la base, no el
// código—: es un ejercicio, y volver a pedirlo hasta «acertar» no le enseña
// nada. De acá salen sus tarjetas de repaso (estudio.js).
const razonamientoDiagnosticoSchema = new mongoose.Schema({
  medicoPhone: { type: String, required: true },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", required: true },
  principal: { type: String, default: "" },
  diferenciales: { type: [String], default: [] },
  resultado: {
    diferenciales: [{ diagnostico: String, aFavor: [String], enContra: [String], estudio: String, _id: false }],
    banderasRojas: [String],
    faltoPreguntar: [String],
    acertoPrincipal: Boolean,
    comentario: String,
    noConsideraste: [{ diagnostico: String, porQue: String, _id: false }],
    perla: String,
  },
  // Enfermería razona con el proceso de atención (tutor.js); sin carrera, medicina.
  carrera: { type: String, default: undefined },
  en: { type: Date, default: Date.now },
}, { timestamps: true });
razonamientoDiagnosticoSchema.index({ consultaId: 1 }, { unique: true });
razonamientoDiagnosticoSchema.index({ medicoPhone: 1, en: -1 });
const RazonamientoDiagnostico = mongoose.model("RazonamientoDiagnostico", razonamientoDiagnosticoSchema);

// ─── LA RACHA (ver estudio.js) ─────────────────────────────────────────────
//
// Días seguidos estudiando. ultimoDia va como "YYYY-MM-DD" en la zona de la
// cuenta: el «hoy» es el suyo, no el del servidor. Una por cuenta.
const rachaEstudioSchema = new mongoose.Schema({
  medicoPhone: { type: String, required: true, unique: true },
  actual: { type: Number, default: 0 },
  mejor: { type: Number, default: 0 },
  ultimoDia: { type: String, default: "" },
}, { timestamps: true });
const RachaEstudio = mongoose.model("RachaEstudio", rachaEstudioSchema);

// ─── LOS CANDADOS (ver candado.js) ─────────────────────────────────────────
//
// Uno por cosa que no puede pasar dos veces a la vez («empezar una práctica
// de este estudiante», «el turno de esta conversación»). Los vencidos se
// borran solos una hora después: que no estén es lo mismo que estar libres.
const candadoSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  hasta: { type: Date, required: true },
  dueno: { type: String, default: "" },
});
candadoSchema.index({ hasta: 1 }, { expireAfterSeconds: 3600 });
const Candado = mongoose.model("CandadoEstudiante", candadoSchema);

module.exports = {
  CodigoEstudiante, RazonamientoDiagnostico, RachaEstudio, TarjetaEstudio,
  CasoVirtual, SimulacionPaciente, PreguntaSimulacro, Simulacro, Candado,
};
