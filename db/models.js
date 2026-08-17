// Vitalis — Schemas MongoDB
const mongoose = require("mongoose");
const { CONFIG, log } = require("../config");

mongoose.connect(CONFIG.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000, // fallar rápido en vez de esperar el default de 30s
  connectTimeoutMS: 5000,
  socketTimeoutMS: 20000,
  maxPoolSize: 20,
  minPoolSize: 5,
}).then(
  () => log.info("✅ MongoDB conectado"),
  (e) => log.error("❌ MongoDB:", e.message)
);

mongoose.connection.on("disconnected", () => log.warn("⚠️ MongoDB desconectado, reintentando..."));
mongoose.connection.on("reconnected", () => log.info("✅ MongoDB reconectado"));

// ─── MÓDULO CONSULTAS MÉDICAS ────────────────────────────────────────────────
// Médico que sube consultas para transcribir. Login con teléfono + contraseña;
// solo médicos ya registrados/activos pueden entrar.
const medicoSchema = new mongoose.Schema({
  phone: { type: String, unique: true, index: true, required: true },
  nombre: { type: String, required: true },
  especialidad: { type: String, default: "" },
  // Determina qué pestañas ve el médico en el Kardex de cada paciente
  // (medicina general vs. odontología, que necesitan fichas muy distintas).
  // "especialidad" de arriba queda como texto libre descriptivo (ej.
  // "Cardiología"), esto es lo que realmente rama la interfaz.
  tipoEspecialidad: { type: String, enum: ["medicina_general", "odontologia", "estetica", "oftalmologia", "veterinaria", "ginecologia"], default: "medicina_general" },
  passwordHash: { type: String, required: true },
  activo: { type: Boolean, default: true },
  // Agenda: horario de atención (para calcular horarios disponibles) y,
  // opcional, el calendario de Google donde se reflejan las citas (se
  // comparte ese calendario con la cuenta de servicio de Vitalis).
  horarioAtencion: {
    type: [{ diaSemana: Number, horaInicio: String, horaFin: String }], // diaSemana: 0=domingo … 6=sábado
    default: [
      { diaSemana: 1, horaInicio: "08:00", horaFin: "17:00" },
      { diaSemana: 2, horaInicio: "08:00", horaFin: "17:00" },
      { diaSemana: 3, horaInicio: "08:00", horaFin: "17:00" },
      { diaSemana: 4, horaInicio: "08:00", horaFin: "17:00" },
      { diaSemana: 5, horaInicio: "08:00", horaFin: "17:00" },
    ],
  },
  duracionConsultaMinutos: { type: Number, default: 30 },
  googleCalendarId: { type: String, default: "" }, // ej: el gmail del médico, compartido con la cuenta de servicio
  // Info libre del consultorio (horarios, precios, ubicación, políticas...)
  // que el asistente de WhatsApp usa como única fuente para responder
  // preguntas de pacientes — nunca inventa nada que no esté acá.
  infoConsultorio: { type: String, default: "" },
  // 2FA (TOTP, compatible Google Authenticator/Authy). "secretoPendiente" es
  // el secreto generado mientras el médico todavía no escaneó y confirmó el
  // QR — recién pasa a "secreto" (y activo=true) después de esa confirmación,
  // así un QR nunca escaneado no deja la cuenta en un estado a medias.
  dosFA: {
    activo: { type: Boolean, default: false },
    secreto: { type: String, default: "" },
    secretoPendiente: { type: String, default: "" },
  },
}, { timestamps: true });
const Medico = mongoose.model("Medico", medicoSchema);

// Paciente: la entidad central del Kardex. Todo lo demás (consultas,
// medicamentos, antecedentes, signos vitales) cuelga de acá.
const pacienteSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, required: true },
  fechaNacimiento: { type: Date, default: null },
  sexo: { type: String, default: "" },
  telefono: { type: String, default: "" },
  notas: { type: String, default: "" },
  // Solo Vitalis Veterinaria: acá "nombre" es el de la mascota y "telefono"
  // ya venía siendo el de contacto (el dueño), así que solo faltan estos 3.
  especie: { type: String, default: "" },
  raza: { type: String, default: "" },
  duenoNombre: { type: String, default: "" },
  antecedentesPersonales: { type: [String], default: [] }, // ej: "Hipertensión desde 2019", "Alergia a penicilina"
  antecedentesFamiliares: { type: [{ parentesco: String, condicion: String }], default: [] },
  // Brief Clínico Inteligente: resumen ejecutivo generado por IA a partir del
  // historial de consultas, para que el médico lo lea antes de la próxima
  // visita. Se regenera solo cada vez que termina la nota clínica de una
  // consulta nueva (ver services/briefClinico.js).
  briefClinicoEstado: { type: String, enum: ["pendiente", "generando", "completado", "error"], default: "pendiente" },
  briefClinico: {
    estadoActual: String,
    cambiosDesdeUltimaConsulta: String,
    medicamentosActivos: [String],
    examenesPendientes: [String],
    alertas: [String],
    factoresRiesgo: [String],
    preguntasSugeridas: [String],
    diagnosticosDiferenciales: [String],
  },
  briefClinicoActualizadoEn: Date,
  briefClinicoError: String,
}, { timestamps: true });
pacienteSchema.index({ medicoPhone: 1, nombre: 1 });
const Paciente = mongoose.model("Paciente", pacienteSchema);

// Una consulta médica transcrita: audio subido por el médico, diarizado
// (separa quién habla) por AssemblyAI. Ligada a un Paciente real (no texto
// libre) para que la línea de tiempo del Kardex tenga sentido.
const consultaMedicaSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  pacienteNombre: { type: String, default: "" }, // copia del nombre al momento de crear, para no tener que hacer join en las listas
  estado: { type: String, enum: ["procesando", "completado", "error"], default: "procesando", index: true },
  duracionSegundos: Number,
  transcripcionCompleta: String,
  segmentos: [{
    hablante: String,   // "A", "B"... según lo que detecta AssemblyAI (no sabe cuál es médico/paciente)
    texto: String,
    inicioSeg: Number,
    finSeg: Number,
  }],
  error: String,
  // Nota clínica estructurada, generada por IA a partir de la transcripción
  // una vez que esta termina. Es un segundo paso, independiente del de arriba.
  notaClinicaEstado: { type: String, enum: ["pendiente", "completado", "error"], default: "pendiente" },
  notaClinica: {
    motivoConsulta: String,
    sintomas: [String],
    antecedentesRelevantes: String,
    diagnostico: String,
    diagnosticosDiferenciales: [String],
    plan: String,
    medicamentosRecetados: [{ nombre: String, dosis: String, frecuencia: String }],
    examenesSolicitados: [String],
    proximoControl: String,
    // Cuando el médico menciona una fecha/hora concreta para la reconsulta
    // ("te veo el sábado a las siete") — no algo vago tipo "en un mes", eso
    // ya lo cubre proximoControl de arriba. El médico confirma antes de que
    // se le mande nada al paciente (ver /medico/consultas/:id/reconsulta/*).
    reconsultaSugerida: {
      fechaHora: { type: Date, default: null },
      textoOriginal: { type: String, default: "" },
      estado: { type: String, enum: ["pendiente", "confirmada", "descartada"], default: "pendiente" },
    },
    // Sugerencias para el Kardex: cosas mencionadas en ESTA consulta que
    // todavía no estaban registradas (el médico las aprueba una por una,
    // no se cargan solas). medicamentosRecetados ya sirve de sugerencia
    // para la pestaña Medicación, no hace falta duplicarlo acá.
    antecedentesPersonalesNuevos: [String],
    antecedentesFamiliaresNuevos: [{ parentesco: String, condicion: String }],
    vacunasMencionadas: [{ nombre: String, dosis: String, fecha: String }],
    // Vitalis Odonto: tratamientos que el odontólogo dice que hay que hacer
    // ("hay que poner un implante acá"), emparejados (si se puede) contra su
    // propio catálogo de precios. Cada uno se confirma o descarta por
    // separado — al confirmar recién se crea el ítem real en el presupuesto
    // del paciente (ver /medico/consultas/:id/tratamientos-sugeridos/*).
    tratamientosSugeridos: [{
      itemMencionado: { type: String, default: "" },
      piezaFdi: { type: Number, default: null },
      catalogoNombreSugerido: { type: String, default: null },
      estado: { type: String, enum: ["pendiente", "agregado", "descartado"], default: "pendiente" },
    }],
    // Vitalis Visión: hallazgos por ojo/estructura detectados en la
    // consulta ("ojo derecho, cristalino con opacidad cortical leve").
    // A diferencia de las sugerencias de arriba, estos se aplican solos al
    // mapa ocular apenas termina de generarse la nota (el médico corrige
    // después si hace falta) — se guarda una copia acá para que quede
    // visible en la nota qué fue lo que se aplicó y por qué.
    examenOcularSugerido: [{
      ojo: { type: String, default: "" },
      estructura: { type: String, default: "" },
      hallazgo: { type: String, default: "" },
      estado: { type: String, default: "" },
    }],
  },
  notaClinicaError: String,
}, { timestamps: true });
consultaMedicaSchema.index({ medicoPhone: 1, createdAt: -1 });
consultaMedicaSchema.index({ pacienteId: 1, createdAt: -1 });
const ConsultaMedica = mongoose.model("ConsultaMedica", consultaMedicaSchema);

// Gestión de medicación: lista de medicamentos activos/pasados del paciente.
// Carga manual del médico (no se auto-completa desde las notas clínicas,
// para no arriesgar duplicados o datos inconsistentes sin que el médico
// los revise primero).
const medicamentoSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, required: true },
  dosis: { type: String, default: "" },
  frecuencia: { type: String, default: "" },
  fechaInicio: { type: Date, default: null },
  fechaFin: { type: Date, default: null }, // null = activo/en curso
  notas: { type: String, default: "" }, // efectos secundarios, alergias relacionadas, etc.
}, { timestamps: true });
medicamentoSchema.index({ pacienteId: 1, fechaFin: 1 });
const Medicamento = mongoose.model("Medicamento", medicamentoSchema);

// Vacunación: vacunas aplicadas (y se puede usar para anotar dosis pendientes
// con fecha futura como recordatorio).
const vacunaSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, required: true },
  dosis: { type: String, default: "" }, // ej: "1ra dosis", "Refuerzo"
  fecha: { type: Date, required: true },
  notas: { type: String, default: "" },
}, { timestamps: true });
vacunaSchema.index({ pacienteId: 1, fecha: -1 });
const Vacuna = mongoose.model("Vacuna", vacunaSchema);

// ─── ODONTOGRAMA (Vitalis Odonto) ────────────────────────────────────────
// Numeración FDI/ISO-3950 (dos dígitos por cuadrante), la que se usa en
// Bolivia y el resto de Latinoamérica — no la "Universal" de EE.UU.
// Dentición permanente: 11-18, 21-28, 31-38, 41-48 (32 piezas). La
// dentición temporal (dientes de leche, 51-55/61-65/71-75/81-85) queda
// para una siguiente vuelta — mezclar ambas con el recambio dental real
// es justo la parte más delicada, no vale la pena apurarla.
const ESTADOS_PIEZA_DENTAL = [
  "sano", "caries", "obturado", "corona", "endodoncia",
  "extraccion_indicada", "ausente", "fractura", "implante", "sellante",
];
const PIEZAS_FDI_PERMANENTE = [
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
];

const piezaDentalSchema = new mongoose.Schema({
  numero: { type: Number, required: true }, // FDI
  estado: { type: String, enum: ESTADOS_PIEZA_DENTAL, default: "sano" },
  notas: { type: String, default: "" },
  historial: {
    type: [{
      fecha: { type: Date, default: Date.now },
      estado: { type: String, enum: ESTADOS_PIEZA_DENTAL },
      notas: { type: String, default: "" },
    }],
    default: [],
  },
}, { _id: false });

const odontogramaSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, unique: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  piezas: { type: [piezaDentalSchema], default: [] },
}, { timestamps: true });
const Odontograma = mongoose.model("Odontograma", odontogramaSchema);

// ─── Vitalis Visión (oftalmología) ──────────────────────────────────────
// Mapa ocular: un documento por paciente con las 12 estructuras × 2 ojos
// (igual patrón que el odontograma — se crea solo, todo en "normal", la
// primera vez que se abre). El estado de cada estructura puede venir de la
// voz durante una consulta (fuente:"voz", se aplica automático al terminar
// la nota clínica — el médico lo revisa y corrige después si hace falta,
// nunca queda oculto: el historial guarda cada cambio con su origen) o
// cargado a mano por el médico (fuente:"manual").
const OJOS = ["OD", "OI"];
const ESTRUCTURAS_OCULARES = [
  "cornea", "iris", "pupila", "cristalino", "esclerotica", "conjuntiva",
  "camara_anterior", "retina", "macula", "nervio_optico", "vasos_sanguineos", "vitreo",
];
const ESTADOS_ESTRUCTURA_OCULAR = ["normal", "leve", "moderado", "importante"];

const estructuraOcularSchema = new mongoose.Schema({
  ojo: { type: String, enum: OJOS, required: true },
  estructura: { type: String, enum: ESTRUCTURAS_OCULARES, required: true },
  estado: { type: String, enum: ESTADOS_ESTRUCTURA_OCULAR, default: "normal" },
  notas: { type: String, default: "" },
  historial: {
    type: [{
      fecha: { type: Date, default: Date.now },
      estado: { type: String, enum: ESTADOS_ESTRUCTURA_OCULAR },
      notas: { type: String, default: "" },
      fuente: { type: String, enum: ["voz", "manual"], default: "manual" },
      consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
    }],
    default: [],
  },
}, { _id: false });

const examenOcularSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, unique: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  estructuras: { type: [estructuraOcularSchema], default: [] },
}, { timestamps: true });
const ExamenOcular = mongoose.model("ExamenOcular", examenOcularSchema);

// Receta óptica: esfera/cilindro/eje/adición por ojo — completamente
// distinta a una receta de medicamentos, por eso es un modelo aparte.
const recetaOpticaSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
  od: {
    esfera: { type: Number, default: null }, cilindro: { type: Number, default: null },
    eje: { type: Number, default: null }, adicion: { type: Number, default: null },
  },
  oi: {
    esfera: { type: Number, default: null }, cilindro: { type: Number, default: null },
    eje: { type: Number, default: null }, adicion: { type: Number, default: null },
  },
  distanciaPupilar: { type: Number, default: null },
  notas: { type: String, default: "" },
  fecha: { type: Date, required: true },
}, { timestamps: true });
const RecetaOptica = mongoose.model("RecetaOptica", recetaOpticaSchema);

// ─── Vitalis Obstetricia (ginecología y obstetricia) ────────────────────
// Un embarazo por vez: se abre con la FUM (fecha de última menstruación),
// que es lo único que hace falta para calcular la FPP (fecha probable de
// parto, regla de Naegele: FUM + 280 días / 40 semanas) y las semanas de
// gestación actuales — eso se calcula al vuelo en el backend y el
// frontend, nunca se guarda, para no desincronizarse con el paso de los
// días. La FPP queda como campo propio (no solo derivado) porque el
// médico puede ajustarla a mano si una ecografía temprana da una edad
// gestacional distinta a la calculada por FUM — un ajuste clínico
// habitual, no un error de carga.
const DESENLACES_EMBARAZO = ["parto_vaginal", "cesarea", "aborto", "otro"];
const embarazoSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  fum: { type: Date, required: true },
  fpp: { type: Date, required: true },
  activo: { type: Boolean, default: true },
  fechaFin: { type: Date, default: null },
  desenlace: { type: String, enum: ["", ...DESENLACES_EMBARAZO], default: "" },
  notas: { type: String, default: "" },
}, { timestamps: true });
embarazoSchema.index({ pacienteId: 1, activo: 1 });
const Embarazo = mongoose.model("Embarazo", embarazoSchema);

// Catálogo de tratamientos del odontólogo: se carga una vez (nombre +
// precio) y se reutiliza al armar el plan de cada paciente, en vez de
// escribir el precio a mano cada vez.
const catalogoTratamientoSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, required: true },
  precio: { type: Number, required: true, default: 0 },
}, { timestamps: true });
const CatalogoTratamiento = mongoose.model("CatalogoTratamiento", catalogoTratamientoSchema);

// Plan de tratamiento: un documento por ítem (ej: "Corona en pieza 36"),
// opcionalmente ligado a una pieza del odontograma. Los pagos quedan como
// lista propia adentro — precio menos la suma de pagos = saldo, calculado
// al vuelo, nunca guardado (para no desincronizarse).
const tratamientoPlanSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, required: true },
  piezaFdi: { type: Number, default: null }, // opcional: número FDI de la pieza (ver Odontograma)
  regionFacial: { type: String, default: "" }, // opcional: para Vitalis Face (ej: "Nariz", "Mentón")
  precio: { type: Number, required: true, default: 0 },
  estado: { type: String, enum: ["pendiente", "en_proceso", "realizado"], default: "pendiente" },
  notas: { type: String, default: "" },
  pagos: {
    type: [{ monto: Number, fecha: { type: Date, default: Date.now }, notas: { type: String, default: "" } }],
    default: [],
  },
}, { timestamps: true });
tratamientoPlanSchema.index({ pacienteId: 1, createdAt: 1 });
const TratamientoPlan = mongoose.model("TratamientoPlan", tratamientoPlanSchema);

// Evolución clínica: signos vitales/indicadores sueltos en el tiempo (presión,
// glucosa, peso, etc.) para graficar tendencias. Carga manual del médico.
// "tipo" es una clave fija (ver TIPOS_MEDICION en el frontend); valorSecundario
// solo se usa para presión arterial (sistólica en valor, diastólica acá).
const medicionSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  tipo: { type: String, required: true },
  valor: { type: Number, required: true },
  valorSecundario: { type: Number, default: null },
  fecha: { type: Date, required: true },
  notas: { type: String, default: "" },
}, { timestamps: true });
medicionSchema.index({ pacienteId: 1, tipo: 1, fecha: 1 });
const Medicion = mongoose.model("Medicion", medicionSchema);

// Centro de Estudios: laboratorios, radiografías, ecografías, tomografías,
// resonancias, ECG, fotos clínicas... El archivo en sí vive en disco (fuera
// de /public — ver routes/estudios.js), acá solo queda la referencia.
const estudioSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  tipo: { type: String, required: true }, // radiografia, laboratorio, ecografia, tomografia, resonancia, ecg, foto, otro
  nombre: { type: String, required: true }, // título/descripción corta
  archivoNombre: { type: String, required: true }, // nombre random en disco
  archivoMime: { type: String, required: true },
  archivoTamano: { type: Number, required: true },
  fecha: { type: Date, required: true },
  notas: { type: String, default: "" },
  // Solo cuando tipo==="foto": qué ángulo es (frontal/perfil/tres_cuartos),
  // para poder agrupar y comparar antes/después del mismo ángulo entre
  // fechas distintas (ver /medico/pacientes/:id en la pestaña Estudios).
  anguloFoto: { type: String, default: "" },
  // Vitalis Visión: a qué ojo corresponde un estudio (OCT, fondo de ojo,
  // campimetría...) — "OD", "OI" o "ambos". Vacío si no aplica.
  ladoOjo: { type: String, default: "" },
}, { timestamps: true });
estudioSchema.index({ pacienteId: 1, fecha: -1 });
const Estudio = mongoose.model("Estudio", estudioSchema);

// Receta Digital: se arma a partir de lo recetado en una consulta (o a
// mano) y queda lista para imprimir/guardar como PDF desde el navegador.
// Crearla ES el acto de aprobación del médico — no hay estado de borrador,
// mismo criterio que medicamentos/vacunas (se carga ya revisada).
const recetaSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
  medicamentos: [{
    nombre: { type: String, required: true },
    dosis: { type: String, default: "" },
    frecuencia: { type: String, default: "" },
    duracion: { type: String, default: "" },
  }],
  indicaciones: { type: String, default: "" },
  fecha: { type: Date, required: true },
}, { timestamps: true });
recetaSchema.index({ pacienteId: 1, fecha: -1 });
const Receta = mongoose.model("Receta", recetaSchema);

// Recordatorios Médicos: vencimientos/controles próximos, vistos en una
// sola lista global del panel del médico (no por paciente) — "qué se viene"
// en todo el consultorio. Mandarlo solo por WhatsApp queda pendiente hasta
// resolver esa integración; por ahora el médico lo revisa dentro de Vitalis.
const recordatorioSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  pacienteNombre: { type: String, required: true }, // snapshot, evita un join para pintar la lista
  medicoPhone: { type: String, index: true, required: true },
  tipo: { type: String, default: "otro" }, // control, medicamento, estudio, vacuna, otro
  titulo: { type: String, required: true },
  fecha: { type: Date, required: true },
  notas: { type: String, default: "" },
  completado: { type: Boolean, default: false },
}, { timestamps: true });
recordatorioSchema.index({ medicoPhone: 1, completado: 1, fecha: 1 });
const Recordatorio = mongoose.model("Recordatorio", recordatorioSchema);

// Agenda: citas del médico. pacienteId es opcional porque una reserva por
// WhatsApp puede venir de alguien que todavía no es un Paciente registrado
// en el Kardex (se identifica por su número de WhatsApp hasta que el médico
// lo vincule a una ficha real).
const citaSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", default: null },
  pacienteNombre: { type: String, required: true },
  pacienteTelefono: { type: String, default: "", index: true },
  fecha: { type: Date, required: true }, // inicio de la cita
  duracionMinutos: { type: Number, default: 30 },
  motivo: { type: String, default: "" },
  estado: { type: String, enum: ["confirmada", "cancelada", "completada"], default: "confirmada" },
  origen: { type: String, enum: ["whatsapp", "whatsapp_web", "manual"], default: "manual" },
  googleEventId: { type: String, default: null }, // id del evento en Google Calendar, para poder editarlo/cancelarlo
}, { timestamps: true });
citaSchema.index({ medicoPhone: 1, fecha: 1 });
// Índice adicional aparte (nombre propio para no chocar con el de arriba,
// que ya puede existir en producción con otras opciones): entre citas
// CONFIRMADAS no permite dos con el mismo médico+horario exacto — último
// resguardo real (a nivel de base) contra reservar el mismo horario dos
// veces si dos pedidos llegan casi al mismo tiempo (ver services/crearCita.js).
citaSchema.index(
  { medicoPhone: 1, fecha: 1 },
  { unique: true, partialFilterExpression: { estado: "confirmada" }, name: "cita_slot_confirmada_unico" }
);
const Cita = mongoose.model("Cita", citaSchema);

// Estado de la conversación de reserva por WhatsApp, por número de paciente
// (persistido, no en memoria, para no perder la conversación a mitad de
// camino si el server se reinicia).
const sesionCitaWaSchema = new mongoose.Schema({
  numero: { type: String, unique: true, index: true, required: true },
  paso: { type: String, required: true },
  datos: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
const SesionCitaWA = mongoose.model("SesionCitaWA", sesionCitaWaSchema);

// Vincula el celular de un médico como "micrófono remoto" para su compu de
// escritorio (sin micrófono propio). Un código por médico por día; la compu
// deja un comando pendiente ("iniciar"/"detener") que el celular recoge la
// próxima vez que pregunta (poll cada 1-2s) y ejecuta.
const vinculacionSchema = new mongoose.Schema({
  medicoPhone: { type: String, unique: true, index: true, required: true },
  codigo: { type: String, required: true },
  fechaStr: { type: String, required: true }, // día boliviano al que corresponde el código (YYYY-MM-DD)
  vinculado: { type: Boolean, default: false },
  estado: { type: String, enum: ["esperando", "armado", "grabando"], default: "esperando" },
  comandoPendiente: {
    accion: { type: String, enum: ["iniciar", "detener"] },
    pacienteId: String,
    pacienteNombre: String,
    emitidoEn: Date,
  },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
}, { timestamps: true });
const Vinculacion = mongoose.model("Vinculacion", vinculacionSchema);

// Registro de auditoría: quién accedió/hizo qué y cuándo — clave para el
// secreto médico (poder responder "quién vio la historia de este paciente")
// y para detectar accesos anómalos. Se escribe siempre, nunca se edita.
const auditLogSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  accion: { type: String, required: true }, // ej: "login", "login_fallido", "ver_paciente", "ver_consulta"
  recurso: { type: String, default: "" }, // ej: "Paciente:<id>"
  detalle: { type: String, default: "" },
  ip: { type: String, default: "" },
  exito: { type: Boolean, default: true },
}, { timestamps: true });
auditLogSchema.index({ medicoPhone: 1, createdAt: -1 });
const AuditLog = mongoose.model("AuditLog", auditLogSchema);

// Registro de correcciones a sugerencias de la IA: cada vez que un médico
// cambia lo que la IA propuso (fecha de reconsulta, nombre/pieza de un
// tratamiento, estado de una estructura ocular) antes de que quede
// guardado. No es para mostrarle nada al médico — es la materia prima
// para ver en qué se equivoca más la IA y afinar los prompts (y, con
// suficiente volumen algún día, para un eventual fine-tuning). Nunca
// bloquea ni retrasa el flujo real si falla al guardar.
const correccionIASchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  tipo: { type: String, enum: ["reconsulta", "tratamiento", "examen_ocular"], required: true },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
  campo: { type: String, default: "" }, // ej: "fechaHora", "nombre", "OD:cristalino"
  valorSugerido: { type: String, default: "" }, // lo que propuso la IA
  valorFinal: { type: String, default: "" }, // lo que el médico dejó guardado
}, { timestamps: true });
correccionIASchema.index({ medicoPhone: 1, tipo: 1, createdAt: -1 });
const CorreccionIA = mongoose.model("CorreccionIA", correccionIASchema);

module.exports = { Medico, Paciente, ConsultaMedica, Medicamento, Vacuna, Medicion, Estudio, Receta, Recordatorio, Cita, SesionCitaWA, Vinculacion, AuditLog, Odontograma, ESTADOS_PIEZA_DENTAL, PIEZAS_FDI_PERMANENTE, CatalogoTratamiento, TratamientoPlan, ExamenOcular, RecetaOptica, OJOS, ESTRUCTURAS_OCULARES, ESTADOS_ESTRUCTURA_OCULAR, CorreccionIA, Embarazo, DESENLACES_EMBARAZO };
