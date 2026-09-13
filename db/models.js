// Symphomed — Schemas MongoDB
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
// Clínica: varios consultorios bajo un mismo techo, con alguien que mira el
// conjunto. NO es dueña de las historias clínicas — cada ficha sigue
// colgando del médico que la escribió (medicoPhone, en 30 colecciones), y
// eso no cambia. La clínica es una capa de arriba: agrupa médicos para
// poder sumar números y administrar cuentas, nada más.
//
// Que el aislamiento por médico se mantenga NO es una limitación técnica que
// no tuvimos ganas de resolver: es lo que hace que un administrativo no
// pueda leer la consulta de un paciente que no es suyo. Ver services/clinica.js.
const clinicaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  direccion: { type: String, default: "" },
  ciudad: { type: String, default: "" },
  telefono: { type: String, default: "" },
  activa: { type: Boolean, default: true },
}, { timestamps: true });
const Clinica = mongoose.model("Clinica", clinicaSchema);

// Médico que sube consultas para transcribir. Login con teléfono + contraseña;
// solo médicos ya registrados/activos pueden entrar.
//
// Un administrativo de clínica también vive acá, con rol "admin": reusa el
// login, el 2FA, el limitador de intentos y la auditoría que ya existen. No
// es un médico y el sistema lo sabe — su token NO lleva rol "medico", así
// que las rutas clínicas lo rechazan por el mismo camino de siempre.
const medicoSchema = new mongoose.Schema({
  phone: { type: String, unique: true, index: true, required: true },
  nombre: { type: String, required: true },
  especialidad: { type: String, default: "" },
  // Determina qué pestañas ve el médico en el Kardex de cada paciente
  // (medicina general vs. odontología, que necesitan fichas muy distintas).
  // "especialidad" de arriba queda como texto libre descriptivo (ej.
  // "Cardiología"), esto es lo que realmente rama la interfaz.
  tipoEspecialidad: { type: String, enum: ["medicina_general", "odontologia", "estetica", "oftalmologia", "veterinaria", "ginecologia", "pediatria", "neurodesarrollo"], default: "medicina_general" },
  // Idioma en el que este médico trabaja: la interfaz, sus notas clínicas y
  // lo que sus pacientes reciben por WhatsApp. Va acá y no en el servidor
  // porque es un ajuste profesional, no de infraestructura — el mismo
  // Symphomed desplegado en Brasil puede atender a un médico que escribe en
  // español, y al revés.
  idioma: { type: String, enum: ["es", "pt"], default: "es" },
  // En qué moneda cobra esta cuenta. NO se deduce del idioma: si se dedujera,
  // un médico boliviano que cambia la interfaz a portugués vería su saldo en
  // Bs escrito como reales, y su próxima recarga quedaría registrada en la
  // moneda equivocada, en el libro mayor, para siempre. Una preferencia de
  // pantalla no decide qué es el dinero (ver services/monedas.js).
  moneda: { type: String, enum: ["BOB", "BRL"], default: "BOB" },

  // ─── Clínica (opcional: un médico solo no tiene ninguna) ───────────────
  clinicaId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinica", default: null, index: true },
  // "medico"   — lo de siempre.
  // "admin"    — administrativo. NO es médico: no ve ninguna ficha, ninguna
  //              consulta, ninguna receta. Solo números y cuentas.
  // "director" — es médico Y administra. Ve SUS pacientes como cualquier
  //              médico, y los números de la clínica como admin. Ser
  //              director no le da acceso a las fichas de sus colegas: para
  //              eso está la interconsulta, y queda auditada.
  rol: { type: String, enum: ["medico", "admin", "director"], default: "medico" },
  // Cómo está vinculado a la clínica. Cambia QUÉ ve el administrador:
  //   "empleado" — la clínica factura al paciente, así que la plata es de la
  //                clínica y el admin ve la facturación de este médico.
  //   "alquila"  — el médico alquila el consultorio y factura por su cuenta.
  //                El admin ve que usó la sala (ocupación), NO cuánto cobró:
  //                esa plata no es de la clínica. Y si se va, se lleva sus
  //                fichas, porque nunca dejaron de ser suyas.
  vinculo: { type: String, enum: ["empleado", "alquila"], default: "empleado" },
  // Nombre del consultorio dentro de la clínica ("Consultorio 3"), para que
  // el panel muestre la ocupación por sala y no solo por persona.
  consultorio: { type: String, default: "" },

  passwordHash: { type: String, required: true },
  activo: { type: Boolean, default: true },

  // ─── Cómo entró esta cuenta ───────────────────────────────────────────
  //
  // Registrarse en Symphomed no da acceso: da un lugar en una fila. Quien pide
  // cuenta queda en "pendiente" y no entra hasta que alguien lo aprueba a
  // mano. Esto no es contra los bots —para eso alcanzaría un captcha—: es
  // que acá adentro se guardan historias clínicas de personas reales, y no
  // se le abre esa puerta a nombre y contraseña, sin saber quién es.
  //
  // El default es "aprobada" A PROPÓSITO, y es la línea más importante de
  // este bloque: las cuentas que ya existen no tienen este campo, y mongoose
  // les aplica el default al leerlas. Si el default fuera "pendiente", el
  // día que esto se despliegue TODOS los médicos que hoy trabajan quedarían
  // afuera de su propio sistema, con sus pacientes en la sala de espera.
  //
  // Solo el registro público pone "pendiente" explícitamente. Las cuentas
  // que crea un administrador de clínica para su equipo nacen aprobadas: ahí
  // ya hubo alguien que respondió por esa persona, que es justamente lo que
  // esta fila busca.
  estadoCuenta: { type: String, enum: ["pendiente", "aprobada", "rechazada"], default: "aprobada", index: true },
  // La matrícula profesional. Symphomed NO la verifica contra ningún registro
  // —no hay una API del colegio médico boliviano— así que no es una prueba:
  // es un dato que quien aprueba puede mirar, y que hace que mentir sea una
  // decisión consciente y no un descuido.
  matricula: { type: String, default: "" },
  // El consejo profesional, partido. Brasil lo necesita así para recetar por
  // Memed: sigla (CRM, CRO...), estado y número. Y el ESTADO ES EL DEL
  // CONSEJO, no el del domicilio — es el error más fácil de cometer y no se
  // nota hasta que una receta sale con el registro de otro estado.
  //
  // "matricula" de arriba sigue siendo el texto libre que se declara al
  // pedir cuenta, en cualquier país. Esto es lo estructurado, y solo lo
  // llenan las cuentas que recetan en Brasil.
  conselho: {
    sigla: { type: String, default: "" },
    uf: { type: String, default: "" },
    numero: { type: String, default: "" },
  },
  // Memed los pide para dar de alta al prescriptor.
  cpf: { type: String, default: "" },
  email: { type: String, default: "" },
  solicitud: {
    pedidaEn: { type: Date, default: null },
    // Lo que la persona escribe sobre sí misma. Es lo único que quien
    // aprueba tiene para decidir, así que se guarda entero.
    mensaje: { type: String, default: "" },
    resueltaEn: { type: Date, default: null },
    resueltaPor: { type: String, default: "" },
    // Por qué se rechazó. Se le muestra a quien lo pidió: un "no" sin motivo
    // genera un segundo intento idéntico y una consulta por WhatsApp.
    motivo: { type: String, default: "" },
  },

  // ─── Las consultas de cortesía ─────────────────────────────────────────
  //
  // Cada cuenta nueva tiene unas cuantas consultas gratis. No es un regalo:
  // es la única forma de que un médico sepa si esto le sirve. Para la cuarta
  // ya sabe si le ahorra tiempo, y recién ahí la decisión de pagar es fácil.
  //
  // Se cuenta acá y NO se resuelve regalando saldo, a propósito. Si fueran
  // R$ 40 de saldo, el día que cambie el precio de la consulta cambiaría
  // también cuántas son gratis, sin que nadie lo decida. "Cuatro" tiene que
  // seguir siendo cuatro.
  //
  // Es una copia rápida: la verdad está en el libro mayor, donde cada
  // consulta de cortesía deja su movimiento en cero.
  consultasGratisUsadas: { type: Number, default: 0 },

  // ─── Plan mensual/anual (la alternativa al prepago) ───────────────────
  //
  // Dos formas de pagar, y una cuenta usa UNA de las dos:
  //
  //   · prepago      — carga saldo y cada consulta le descuenta;
  //   · suscripción  — paga por mes o por año y las consultas no descuentan.
  //
  // No conviven: mientras el plan esté vigente, cobrarConsulta no toca el
  // saldo. Y cuando vence, la cuenta NO se bloquea: vuelve al prepago con el
  // saldo que tenga. Cortarle el sistema a un médico que está grabando una
  // consulta porque se le venció el plan ayer es exactamente lo que este
  // sistema evita en todos lados (por eso el prepago tampoco corta en cero,
  // sino cinco consultas más abajo).
  suscripcion: {
    plan: { type: String, enum: ["mensual", "anual", ""], default: "" },
    desde: { type: Date, default: null },
    // Hasta cuándo vale. La comparación es contra esta fecha y nada más: sin
    // "activo: true" que pueda quedar en true después de vencido, que es la
    // clase de dato que se desincroniza y nadie mira.
    hasta: { type: Date, default: null, index: true },
    // Lo que se cobró, guardado como valor. Si mañana sube el precio, las
    // suscripciones viejas siguen diciendo lo que se pagó de verdad.
    precioCentavos: { type: Number, default: 0 },
    moneda: { type: String, default: "" },
    activadaPor: { type: String, default: "" },
  },

  // Saldo prepago, en centavos de boliviano (Bs 12 = 1200). Es una COPIA
  // rápida de la suma de MovimientoSaldo, no la verdad — para no sumar toda
  // la historia cada vez que se pinta una pantalla. Puede quedar en negativo
  // a propósito: una consulta que ya se está transcribiendo se termina aunque
  // el saldo se acabe en el medio (ver services/saldo.js).
  saldoCentavos: { type: Number, default: 0 },
  // Agenda: horario de atención (para calcular horarios disponibles) y,
  // opcional, el calendario de Google donde se reflejan las citas (se
  // comparte ese calendario con la cuenta de servicio de Symphomed).
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
// Persona de la clínica: el mismo señor que va al clínico y al odontólogo
// es UNA persona, aunque tenga una ficha con cada uno.
//
// ═══ QUÉ SE COMPARTE Y QUÉ NO ═════════════════════════════════════════════
//
// Se comparte la IDENTIDAD (nombre, nacimiento, teléfono, documento) y las
// ALERGIAS. Nada más. Ni consultas, ni diagnósticos, ni antecedentes, ni
// medicación: eso sigue siendo de cada médico con su paciente, en el
// Paciente de siempre, filtrado por medicoPhone como hasta ahora.
//
// Las alergias son la excepción a propósito, y por una razón concreta: un
// odontólogo que receta amoxicilina a alguien alérgico a la penicilina es
// exactamente el accidente que una clínica de varios consultorios existe
// para evitar. Y una alergia no es un diagnóstico — no revela una condición
// de la persona, es una advertencia sobre qué NO darle.
//
// Los antecedentes no se comparten aunque sea tentador: "en tratamiento
// oncológico" o "VIH+" son diagnósticos, y que el odontólogo los vea porque
// comparten edificio no es cuidado, es una filtración.
//
// Hasta hoy las alergias vivían como texto libre adentro de
// antecedentesPersonales ("Alergia a penicilina") o de notas. Por eso el
// campo estructurado nace acá: no se puede compartir de forma segura algo
// que está escrito en prosa y de siete maneras distintas.
const personaClinicaSchema = new mongoose.Schema({
  clinicaId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinica", required: true, index: true },
  nombre: { type: String, required: true },
  fechaNacimiento: { type: Date, default: null },
  sexo: { type: String, default: "" },
  telefono: { type: String, default: "" },
  // CI en Bolivia, CPF en Brasil. Es lo único que identifica a una persona
  // sin ambigüedad: dos "Juan Pérez" con la misma fecha de nacimiento
  // existen, un documento repetido casi nunca.
  documento: { type: String, default: "", index: true },
  alergias: { type: [String], default: [] },
  // Quién y cuándo tocó las alergias por última vez.
  //
  // El teléfono NO sale de acá: a otro médico de la clínica se le manda solo
  // si fue él mismo o no (ver personaParaElMedico en routes/personas.js).
  // Mandarlo le diría QUIÉN MÁS atiende a esta persona, que es justo lo que
  // el resto del diseño evita — la ficha dice "la ven en 3 consultorios",
  // nunca en cuáles. Para rastrear una alergia de verdad está el registro de
  // auditoría, que es donde corresponde ese dato.
  alergiasActualizadasPor: { type: String, default: "" },
  alergiasActualizadasEn: { type: Date, default: null },
}, { timestamps: true });
personaClinicaSchema.index({ clinicaId: 1, nombre: 1 });
const PersonaClinica = mongoose.model("PersonaClinica", personaClinicaSchema);

const pacienteSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  // La persona de la clínica a la que corresponde esta ficha. Null para un
  // médico que trabaja solo: no hay nada con qué compartir.
  //
  // NO se completa solo. Vincular dos fichas que en realidad son de dos
  // personas distintas fusiona dos historias clínicas, y eso no tiene
  // vuelta atrás: siempre lo confirma el médico (ver scripts/proponer_personas.js).
  personaId: { type: mongoose.Schema.Types.ObjectId, ref: "PersonaClinica", default: null, index: true },
  nombre: { type: String, required: true },
  fechaNacimiento: { type: Date, default: null },
  sexo: { type: String, default: "" },
  telefono: { type: String, default: "" },
  notas: { type: String, default: "" },
  // Solo Brasil: Memed identifica al paciente por CPF y sin él no se puede
  // recetar. Vacío en el resto — pedirle el CPF a un paciente boliviano
  // sería pedirle un documento que no tiene.
  cpf: { type: String, default: "" },

  // Solo Symphomed Veterinaria: acá "nombre" es el de la mascota y "telefono"
  // ya venía siendo el de contacto (el dueño), así que solo faltan estos 3.
  especie: { type: String, default: "" },
  raza: { type: String, default: "" },
  duenoNombre: { type: String, default: "" },
  // Solo Symphomed Pediatría. La edad corregida es la diferencia entre lo que
  // el chico tiene y lo que tendría si hubiera nacido a término: a un
  // prematuro de 32 semanas hay que restarle 8 semanas hasta los 2 años,
  // porque si no su curva de crecimiento se lee como un retraso que no
  // existe — y eso asusta a una madre por nada. Vacío = nació a término.
  semanasGestacionAlNacer: { type: Number, default: null },
  // A quién se le habla: en pediatría el paciente no es quien contesta el
  // teléfono. "telefono" sigue siendo el de contacto, igual que en veterinaria.
  tutorNombre: { type: String, default: "" },
  tutorParentesco: { type: String, default: "" },
  // Código corto y único por consultorio. Es lo que se dicta por teléfono
  // ("soy el paciente P-0147"), lo que va impreso en el informe y lo que
  // permite encontrar a alguien cuando el nombre está mal escrito — que en
  // un centro de imagen con mostrador pasa todo el tiempo.
  codigo: { type: String, default: "", index: true },
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
    // En la teleconsulta SÍ se sabe, y no por adivinanza: el micrófono del
    // médico y el audio que llega del paciente son dos fuentes distintas, y
    // se graban en canales separados. Vacío cuando el audio es de una
    // consulta presencial, donde las dos voces entran por el mismo micrófono
    // y lo único que hay es la diarización.
    quien: { type: String, enum: ["medico", "paciente", ""], default: "" },
    texto: String,
    inicioSeg: Number,
    finSeg: Number,
  }],
  error: String,
  // Nota clínica estructurada, generada por IA a partir de la transcripción
  // una vez que esta termina. Es un segundo paso, independiente del de arriba.
  notaClinicaEstado: { type: String, enum: ["pendiente", "completado", "error"], default: "pendiente" },
  // El médico revisa la nota, corrige lo que la IA escribió mal y confirma
  // una sola vez: ahí se aplica todo lo que dejó marcado (reconsulta,
  // tratamientos, receta, medicación, antecedentes, vacunas). Queda la
  // fecha para no volver a aplicar lo mismo si entra de nuevo a la pantalla.
  confirmadaEn: { type: Date, default: null },
  notaEditadaPorMedico: { type: Boolean, default: false },
  // Qué de las consultas anteriores se relaciona con ESTA. Es la pregunta
  // que el brief clínico no puede hacer, porque el brief se escribe después
  // de cada consulta y no sabe por qué viene el paciente hoy (ver el
  // encabezado de services/hiloClinico.js).
  //
  // Cada conexión apunta a una consulta REAL y abrible: sin eso, un modelo
  // puede escribir un antecedente verosímil que nunca pasó y nadie lo
  // verificaría, porque suena bien y encaja.
  //
  // Si no hay conexiones, no se guarda nada. Una consulta con el hilo vacío
  // y una sin hilo son lo mismo.
  hiloClinico: {
    conexiones: {
      type: [{
        consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica" },
        queDijoEntonces: { type: String, default: "" },
        porQueImporta: { type: String, default: "" },
      }],
      default: undefined,
    },
    preguntas: { type: [String], default: undefined },
    generadoEn: { type: Date, default: null },
  },
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
    // Symphomed Odonto: tratamientos que el odontólogo dice que hay que hacer
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
    // Symphomed Visión: hallazgos por ojo/estructura detectados en la
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
    // Symphomed Odonto: igual que examenOcularSugerido, pero para el estado
    // clínico de cada pieza del odontograma ("la 33 tiene caries", "hay que
    // extraer la 18") — se aplica solo al odontograma apenas termina de
    // generarse la nota, no hace falta que el odontólogo lo confirme (lo
    // corrige después desde la pestaña Odontograma si hace falta). Es
    // independiente de tratamientosSugeridos (que es para el PRESUPUESTO,
    // se confirma a mano) — la misma consulta puede generar los dos para
    // la misma pieza a la vez (el estado clínico, y el tratamiento a hacer).
    odontogramaSugerido: [{
      piezaFdi: { type: Number, default: null },
      estado: { type: String, default: "" },
      hallazgo: { type: String, default: "" },
    }],
    // Symphomed Gineco: hallazgos por órgano detectados en la consulta
    // ("ovario izquierdo con quiste simple"). Igual que el mapa ocular y el
    // odontograma, se aplican solos al mapa apenas se genera la nota.
    ginecoSugerido: [{
      organo: { type: String, default: "" },
      hallazgo: { type: String, default: "" },
      detalle: { type: String, default: "" },
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

// ─── ODONTOGRAMA (Symphomed Odonto) ────────────────────────────────────────
// Numeración FDI/ISO-3950 (dos dígitos por cuadrante), la que se usa en
// Bolivia y el resto de Latinoamérica — no la "Universal" de EE.UU.
// Dentición permanente: 11-18, 21-28, 31-38, 41-48 (32 piezas). La
// dentición temporal (dientes de leche, 51-55/61-65/71-75/81-85) queda
// para una siguiente vuelta — mezclar ambas con el recambio dental real
// es justo la parte más delicada, no vale la pena apurarla.
// Lo que la pieza tiene hoy, más los tratamientos indicados pero todavía
// no hechos (el odontólogo los dicta como plan: "hay que hacer una
// endodoncia en la 11"). Separarlos evita anotar como hecho algo que
// recién está planificado.
const ESTADOS_PIEZA_DENTAL = [
  "sano", "caries", "obturado", "corona", "endodoncia",
  "extraccion_indicada", "ausente", "fractura", "implante", "sellante",
  "obturacion_indicada", "corona_indicada", "endodoncia_indicada", "implante_indicado",
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
      // "voz" = lo aplicó solo la IA desde una consulta (ver
      // odontogramaSugerido más arriba); "manual" = lo cargó el odontólogo
      // a mano desde la pestaña Odontograma. Igual patrón que el historial
      // de estructuras oculares de Symphomed Visión.
      fuente: { type: String, enum: ["voz", "manual"], default: "manual" },
      consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
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

// ─── Symphomed Visión (oftalmología) ──────────────────────────────────────
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

// Symphomed Gineco — mapa del aparato reproductor: mismo patrón que el
// odontograma y el mapa ocular, pero por órgano. La ginecóloga marca qué
// encontró en cada uno y queda el historial de cómo fue cambiando.
const ORGANOS_GINECO = [
  "utero", "endometrio", "cuello_uterino",
  "ovario_derecho", "ovario_izquierdo",
  "trompa_derecha", "trompa_izquierda",
  "mama_derecha", "mama_izquierda",
];
// Hallazgos concretos y no una escala de gravedad (como sí usa el mapa
// ocular): en ginecología lo que se registra es QUÉ se encontró — un mioma
// y un quiste piden conductas distintas aunque ambos sean "moderados".
const HALLAZGOS_GINECO = [
  "normal", "mioma", "quiste", "polipo", "endometriosis",
  "inflamacion", "engrosamiento", "nodulo", "lesion", "ausente",
];

const organoGinecoSchema = new mongoose.Schema({
  organo: { type: String, enum: ORGANOS_GINECO, required: true },
  hallazgo: { type: String, enum: HALLAZGOS_GINECO, default: "normal" },
  notas: { type: String, default: "" },
  historial: {
    type: [{
      fecha: { type: Date, default: Date.now },
      hallazgo: { type: String, enum: HALLAZGOS_GINECO },
      notas: { type: String, default: "" },
      fuente: { type: String, enum: ["voz", "manual"], default: "manual" },
      consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
    }],
    default: [],
  },
}, { _id: false });

const examenGinecologicoSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, unique: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  organos: { type: [organoGinecoSchema], default: [] },
}, { timestamps: true });
const ExamenGinecologico = mongoose.model("ExamenGinecologico", examenGinecologicoSchema);

// Symphomed Vet — mapa corporal: lesiones marcadas sobre la silueta del
// animal. A diferencia del odontograma (donde un diente es una unidad
// discreta), una lesión está en un PUNTO: se marca donde caiga y se
// autoetiqueta con la región anatómica, para que además de verse tenga un
// nombre clínico con el que buscar y dictar.
const REGIONES_CORPORALES = [
  "hocico", "cabeza", "cuello", "dorso", "torax", "abdomen",
  "grupa", "cola", "miembro_anterior", "miembro_posterior", "otra",
];
const ESTADOS_LESION = ["activa", "en_tratamiento", "resuelta"];
const LADOS_CUERPO = ["izquierdo", "derecho"];

const lesionCorporalSchema = new mongoose.Schema({
  // Posición en porcentaje del lienzo (0-100), no en píxeles: si algún día
  // se redibuja la silueta con otro tamaño, las lesiones ya cargadas
  // siguen cayendo donde corresponde.
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  lado: { type: String, enum: LADOS_CUERPO, default: "izquierdo" },
  region: { type: String, enum: REGIONES_CORPORALES, default: "otra" },
  titulo: { type: String, default: "" },
  estado: { type: String, enum: ESTADOS_LESION, default: "activa" },
  historial: {
    type: [{
      fecha: { type: Date, default: Date.now },
      descripcion: { type: String, default: "" },
      tamanoCm: { type: Number, default: null },
      estado: { type: String, enum: ESTADOS_LESION, default: "activa" },
      // Foto clínica de ese control: se reusa el Centro de Estudios en vez
      // de guardar archivos por un camino aparte.
      estudioId: { type: mongoose.Schema.Types.ObjectId, ref: "Estudio", default: null },
      fuente: { type: String, enum: ["voz", "manual"], default: "manual" },
      consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
    }],
    default: [],
  },
}, { timestamps: true });

const mapaCorporalSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, unique: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  lesiones: { type: [lesionCorporalSchema], default: [] },
}, { timestamps: true });
const MapaCorporal = mongoose.model("MapaCorporal", mapaCorporalSchema);

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

// ─── Symphomed Obstetricia (ginecología y obstetricia) ────────────────────
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
  regionFacial: { type: String, default: "" }, // opcional: para Symphomed Face (ej: "Nariz", "Mentón")
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
// Lo que se guarda de un estudio que llegó por DICOM. Va como constante
// porque lo comparten el Estudio ya asignado a un paciente y el que todavía
// está en la bandeja esperando que alguien le diga de quién es.
const DICOM_ORIGEN = {
  equipoId: { type: mongoose.Schema.Types.ObjectId, ref: "EquipoRayos", default: null },
  // Identificador único en el mundo de ESTA imagen. Es lo que vuelve
  // imposible duplicarla: si la misma placa llega dos veces, la segunda se
  // descarta sola, sin comparar hashes ni nombres de archivo.
  sopInstanceUID: { type: String, default: null },
  seriesInstanceUID: { type: String, default: "" },
  studyInstanceUID: { type: String, default: "" },
  modalidad: { type: String, default: "" }, // DX, CR, CT, MR, US, PX, MG...
  // Tamaño del ORIGINAL, que vive en la caja. La vista previa puede ser más
  // chica: escalaPreview dice cuánto, y es lo que permite convertir una
  // medición hecha sobre la previa a milímetros reales sin que mienta.
  filas: { type: Number, default: null },
  columnas: { type: Number, default: null },
  escalaPreview: { type: Number, default: 1 },
  bitsAlmacenados: { type: Number, default: null },
  ventanaCentro: { type: Number, default: null },
  ventanaAncho: { type: Number, default: null },
  fabricante: { type: String, default: "" },
  modelo: { type: String, default: "" },
  // Lo que el técnico tipeó en el equipo, tal cual vino. Se guarda sin
  // tocarlo para poder auditar después a quién se le asignó y por qué.
  pacienteNombreDicom: { type: String, default: "" },
  pacienteIdDicom: { type: String, default: "" },
  descripcionEstudio: { type: String, default: "" },
  descripcionSerie: { type: String, default: "" },
};

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
  // Symphomed Visión: a qué ojo corresponde un estudio (OCT, fondo de ojo,
  // campimetría...) — "OD", "OI" o "ambos". Vacío si no aplica.
  ladoOjo: { type: String, default: "" },
  // ─── Visor de imágenes ───────────────────────────────────────────────
  // Lo que el médico midió o marcó sobre la imagen. Se guarda en
  // coordenadas de la IMAGEN (píxeles del archivo original), nunca de la
  // pantalla: así una medición hecha en el celular se ve en el mismo lugar
  // en la compu, con otro zoom y otro tamaño de pantalla.
  //
  // La calibración es lo que convierte píxeles en milímetros. Sin ella NO
  // se muestran milímetros: una radiografía JPEG o PNG no trae el tamaño
  // real del píxel (eso solo viene en DICOM), así que decir "4,2 mm" sin
  // haber calibrado sería inventar un número con apariencia clínica.
  calibracion: {
    // Cuántos milímetros mide un píxel de la imagen. null = sin calibrar.
    mmPorPixel: { type: Number, default: null },
    // El DICOM trae los dos ejes por separado, y en ecografía y en algunas
    // panorámicas NO son iguales. Con un solo número, una medición diagonal
    // sale mal. Vacío = cuadrado (usa mmPorPixel para los dos).
    mmPorPixelY: { type: Number, default: null },
    // Con qué se calibró, para poder revisarlo o rehacerlo.
    referencia: { type: String, default: "" },
    fecha: { type: Date, default: null },
    // De dónde salió la escala. Importa: "4,2 mm" leído del DICOM y "4,2 mm"
    // calibrado a ojo sobre un JPEG no valen lo mismo, y el que lee el
    // informe tiene derecho a saber cuál de los dos está mirando.
    origen: { type: String, enum: ["dicom", "manual", ""], default: "" },
    // En radiografía y panorámica la escala es la del DETECTOR: es el tamaño
    // de la sombra proyectada, no el del hueso, porque el objeto está delante
    // de la placa y sale agrandado. En tomografía y resonancia no pasa, porque
    // hay reconstrucción y no proyección. El visor lo avisa en vez de que se
    // olvide.
    planoDetector: { type: Boolean, default: false },
  },
  // Symphomed Face: los diez puntos del perfil que el cirujano marcó a mano
  // sobre esta foto, normalizados 0..1 (glabela, nasion, dorso, punta,
  // subnasal, labio sup., labio inf., surco, pogonion, gnation).
  //
  // Se guardan porque marcarlos cuesta diez clics y porque de ellos salen los
  // ángulos del perfil —nasofrontal, nasolabial, nasofacial—, que son los
  // números que de verdad se miran en una rinoplastia y que no necesitan
  // ninguna calibración para ser correctos.
  perfilMarcado: { type: [{ x: Number, y: Number, _id: false }], default: [] },
  // Symphomed Face: anotaciones del médico sobre la foto, en coordenadas
  // normalizadas 0..1. Van pegadas al estudio y no a la consulta porque lo
  // que anotan es ESTA foto: "acá la asimetría del ala", "cicatriz previa".
  // Al abrir la foto de nuevo —hoy, o en el control de los tres meses—
  // tienen que seguir ahí.
  anotaciones: {
    type: [{
      x: Number, y: Number,
      texto: { type: String, default: "" },
      fecha: { type: Date, default: Date.now },
      _id: false,
    }],
    default: [],
  },
  mediciones: {
    type: [{
      tipo: { type: String, enum: ["distancia", "angulo"], required: true },
      // distancia: [{x,y},{x,y}] · ángulo: [{x,y},{x,y},{x,y}] con el
      // vértice en el medio.
      puntos: [{ x: Number, y: Number, _id: false }],
      etiqueta: { type: String, default: "" },
      // El valor se recalcula al dibujar, pero se guarda el del momento en
      // que se midió: si mañana se recalibra la imagen, queda registro de
      // con qué números tomó su decisión el médico ese día.
      valor: { type: Number, default: null },
      unidad: { type: String, default: "" },
      fecha: { type: Date, default: Date.now },
    }],
    default: [],
  },
  // Ajustes de visualización (brillo, contraste, giro, negativo). No
  // modifican el archivo original —la imagen guardada nunca se toca— pero
  // se recuerdan para que el estudio se abra como el médico lo dejó.
  ajustesVisor: {
    brillo: { type: Number, default: 100 },
    contraste: { type: Number, default: 100 },
    invertido: { type: Boolean, default: false },
    rotacion: { type: Number, default: 0 },
    espejo: { type: Boolean, default: false },
  },
  // ─── Origen DICOM (Caja Symphomed) ─────────────────────────────────────
  // Cuando el estudio entró por la caja de la clínica, acá queda de dónde
  // salió. Symphomed guarda la VISTA PREVIA; el .dcm original de 16 bits se
  // queda en el disco de la caja y no sale de ahí nunca — por eso se anota
  // en qué equipo vive y con qué identificador volver a pedirlo.
  dicom: DICOM_ORIGEN,
}, { timestamps: true });
estudioSchema.index({ pacienteId: 1, fecha: -1 });
// Un mismo estudio no puede entrar dos veces. El SOPInstanceUID es único en
// el mundo, así que esto lo hace imposible por construcción en vez de por
// comparar hashes o nombres de archivo. Parcial porque la mayoría de los
// estudios (los que sube el médico a mano) no vienen de un DICOM.
estudioSchema.index(
  { medicoPhone: 1, "dicom.sopInstanceUID": 1 },
  { unique: true, partialFilterExpression: { "dicom.sopInstanceUID": { $type: "string" } } }
);
const Estudio = mongoose.model("Estudio", estudioSchema);

// ─── SYMPHOMED RAYOS ────────────────────────────────────────────────────────
// El equipo de rayos (o el ecógrafo, o cualquier aparato de imagen) no habla
// con Symphomed: habla con el software del fabricante que corre en una PC del
// consultorio y deja las imágenes en una carpeta. El "puente" (agente-rayos/)
// corre en esa PC, vigila la carpeta y sube lo nuevo acá.
//
// Cada PC es un EquipoRayos con su propio token. Se guarda solo el hash del
// token, igual que una contraseña: si alguien se lleva la base, no se lleva
// credenciales usables. El token en claro se muestra UNA sola vez, al crearlo.
const equipoRayosSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, default: "Equipo de rayos" },
  tokenHash: { type: String, required: true, index: true },
  activo: { type: Boolean, default: true },
  // Para que el médico vea en pantalla si la PC del consultorio está
  // prendida y conectada, sin tener que ir hasta ella.
  ultimoContacto: { type: Date, default: null },
  ultimaSubida: { type: Date, default: null },
  subidas: { type: Number, default: 0 },
}, { timestamps: true });
const EquipoRayos = mongoose.model("EquipoRayos", equipoRayosSchema);

// Ventana de captura: el odontólogo abre la ficha del paciente y toca
// "Capturar radiografía". Durante los minutos siguientes, TODA imagen que
// llegue del equipo se guarda en ESE paciente — nadie tipea nada, ni hay
// que hacer coincidir nombres entre dos sistemas.
//
// unique por medicoPhone: abrir una ventana nueva pisa la anterior (no
// tiene sentido tener dos pacientes "esperando radiografía" a la vez con
// un solo aparato). El índice TTL sobre expiraEn las borra solas.
const capturaPendienteSchema = new mongoose.Schema({
  medicoPhone: { type: String, required: true, unique: true },
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true },
  pacienteNombre: { type: String, default: "" }, // copiado para mostrarlo en el agente sin otra consulta
  tipo: { type: String, default: "radiografia" },
  nombre: { type: String, default: "Radiografía" },
  notas: { type: String, default: "" },
  expiraEn: { type: Date, required: true },
  recibidas: { type: Number, default: 0 },
}, { timestamps: true });
capturaPendienteSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });
const CapturaPendiente = mongoose.model("CapturaPendiente", capturaPendienteSchema);

// ─── BANDEJA DE ENTRADA (Caja Symphomed DICOM) ──────────────────────────────
// La ventana de captura funciona en un consultorio con un sillón: el
// odontólogo abre la ficha, dispara, y la placa cae en ese paciente.
//
// En un centro de imagen no: los estudios llegan todo el día desde varios
// equipos y nadie está apretando "capturar" por cada uno. Ahí el estudio
// entra a esta bandeja con el nombre que el técnico tipeó en el aparato, y
// el médico lo asigna. Si el técnico puso el código de paciente de Symphomed,
// se asigna solo y la bandeja ni se entera.
//
// Es un modelo aparte y NO un Estudio con pacienteId vacío, a propósito: un
// estudio sin paciente no es parte de ninguna historia clínica. Si viviera
// en la misma colección, cada consulta del sistema tendría que acordarse de
// excluirlo para siempre — y una sola que se olvide le muestra a un paciente
// la radiografía de otro.
const estudioEntranteSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  // La vista previa ya guardada en disco. El original sigue en la caja.
  archivoNombre: { type: String, required: true },
  archivoMime: { type: String, required: true },
  archivoTamano: { type: Number, required: true },
  fecha: { type: Date, required: true },
  tipo: { type: String, default: "radiografia" },
  nombre: { type: String, default: "" },
  calibracion: {
    mmPorPixel: { type: Number, default: null },
    mmPorPixelY: { type: Number, default: null },
    referencia: { type: String, default: "" },
    origen: { type: String, enum: ["dicom", "manual", ""], default: "" },
    planoDetector: { type: Boolean, default: false },
  },
  dicom: DICOM_ORIGEN,
}, { timestamps: true });
estudioEntranteSchema.index({ medicoPhone: 1, createdAt: -1 });
// Mismo motivo que en Estudio: si la misma imagen llega dos veces, la
// segunda no entra. Y se comprueba contra las DOS colecciones al recibir,
// porque un estudio ya asignado tampoco tiene que volver a la bandeja.
estudioEntranteSchema.index(
  { medicoPhone: 1, "dicom.sopInstanceUID": 1 },
  { unique: true, partialFilterExpression: { "dicom.sopInstanceUID": { $type: "string" } } }
);
const EstudioEntrante = mongoose.model("EstudioEntrante", estudioEntranteSchema);


// ═══ SYMPHOMED NEURODESARROLLO ══════════════════════════════════════════════
// Autismo, síndrome de Down y otras condiciones del neurodesarrollo no
// entran en una historia clínica común, y por una razón de fondo: no hay
// una enfermedad que curar. El expediente no es un registro de lo que
// falló, es el MAPA DE UNA PERSONA — su perfil, sus apoyos, sus objetivos y
// quién trabaja con ella.
//
// Por eso acá no hay "diagnóstico" como una etiqueta única. El DSM-5 mismo
// no dice "tiene autismo" y listo: define NIVELES DE APOYO en dos ejes
// independientes, y alguien puede necesitar nivel 1 en uno y nivel 3 en el
// otro. La ficha tiene que mostrar eso.
const CONDICIONES_NEURO = ["tea", "sindrome_down", "tdah", "discapacidad_intelectual", "trastorno_lenguaje", "otra"];

// Nivel de apoyo del DSM-5: 1 = necesita apoyo, 2 = apoyo sustancial,
// 3 = apoyo muy sustancial. Se registran los dos ejes por separado porque
// es como está definido, no como una nota promedio.
const EJES_APOYO = ["comunicacionSocial", "conductasRestringidas"];

const FORMAS_COMUNICACION = ["verbal_fluida", "frases", "palabras_sueltas", "no_verbal", "aumentativa", "mixta"];

// Las modalidades del perfil sensorial. En autismo esto es lo que más le
// sirve a la familia y a la escuela todos los días: "no tolera el ruido del
// secador de manos" vale más que cualquier código diagnóstico, y hoy no
// queda escrito en ningún lado.
const MODALIDADES_SENSORIALES = ["auditivo", "tactil", "visual", "vestibular", "propioceptivo", "oral", "olfativo", "interoceptivo"];
const RESPUESTAS_SENSORIALES = ["sin_datos", "tipico", "hiper", "hipo", "busca", "mixto"];

const modalidadSensorialSchema = new mongoose.Schema({
  modalidad: { type: String, enum: MODALIDADES_SENSORIALES, required: true },
  respuesta: { type: String, enum: RESPUESTAS_SENSORIALES, default: "sin_datos" },
  // Lo concreto y accionable: qué lo desregula y qué lo calma. Es lo que se
  // copia al informe para la escuela.
  desencadenantes: { type: [String], default: [] },
  estrategias: { type: [String], default: [] },
  historial: {
    type: [{
      fecha: { type: Date, default: Date.now },
      respuesta: { type: String, enum: RESPUESTAS_SENSORIALES },
      notas: { type: String, default: "" },
      // Mismo criterio que el odontograma y el mapa ocular: queda registrado
      // si lo aplicó la IA desde lo dictado o lo cargó el profesional.
      fuente: { type: String, enum: ["voz", "manual"], default: "manual" },
      consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
    }],
    default: [],
  },
}, { _id: false });

const perfilNeuroSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, unique: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  condiciones: { type: [{ type: String, enum: CONDICIONES_NEURO }], default: [] },
  detalleCondicion: { type: String, default: "" },
  apoyoComunicacionSocial: { type: Number, min: 1, max: 3, default: null },
  apoyoConductasRestringidas: { type: Number, min: 1, max: 3, default: null },
  comunicacion: { type: String, enum: FORMAS_COMUNICACION, default: null },
  sistemaAumentativo: { type: String, default: "" },
  // Se pregunta primero por las fortalezas y no por los déficits, a
  // propósito: es lo que la familia nunca ve escrito en un informe y lo que
  // el equipo necesita para apoyarse en algo.
  fortalezas: { type: [String], default: [] },
  intereses: { type: [String], default: [] },
  perfilSensorial: { type: [modalidadSensorialSchema], default: [] },
  perfilSugerido: { type: Boolean, default: false }, // la IA propuso cambios sin confirmar
}, { timestamps: true });
const PerfilNeuro = mongoose.model("PerfilNeuro", perfilNeuroSchema);

// Objetivos individualizados. Esto es lo que se pelea con la escuela y con
// el seguro, y hoy vive en cuadernos: "pedir agua señalando, sin ayuda
// física, 8 de 10 veces". Cada profesional del equipo carga el avance y
// sale una curva.
const AREAS_OBJETIVO = ["comunicacion", "social", "autonomia", "motor", "cognitivo", "conducta", "sensorial", "academico", "familiar"];

const objetivoNeuroSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  titulo: { type: String, required: true },
  area: { type: String, enum: AREAS_OBJETIVO, default: "comunicacion" },
  // El criterio de logro escrito como corresponde: observable y contable.
  criterio: { type: String, default: "" },
  fechaInicio: { type: Date, default: Date.now },
  fechaCierre: { type: Date, default: null },
  estado: { type: String, enum: ["activo", "logrado", "suspendido"], default: "activo" },
  // Cada registro es una sesión: cuántas veces salió sobre cuántas se
  // intentó. Guardar los dos números y no un porcentaje deja ver si el
  // 50% fue 1 de 2 o 15 de 30, que no es lo mismo.
  progreso: {
    type: [{
      fecha: { type: Date, default: Date.now },
      logros: { type: Number, default: 0 },
      intentos: { type: Number, default: 0 },
      // Nivel de ayuda que necesitó: el objetivo real casi siempre es bajar
      // esto, no subir el porcentaje.
      ayuda: { type: String, enum: ["independiente", "verbal", "gestual", "fisica_parcial", "fisica_total"], default: "independiente" },
      notas: { type: String, default: "" },
      profesional: { type: String, default: "" },
    }],
    default: [],
  },
}, { timestamps: true });
objetivoNeuroSchema.index({ pacienteId: 1, estado: 1 });
const ObjetivoNeuro = mongoose.model("ObjetivoNeuro", objetivoNeuroSchema);

// Calendario de vigilancia de salud. El síndrome de Down trae asociadas
// condiciones que hay que ir BUSCANDO en momentos determinados — no
// aparecen solas, hay que pedirlas. Si nadie lleva el calendario, se pasan
// de largo años enteros, y eso es exactamente lo que pasa hoy.
//
// Es el mismo patrón que la pestaña de Vacunas: qué corresponde a esta
// edad, qué está hecho y qué está atrasado.
//
// IMPORTANTE: la plantilla que trae Symphomed (ver services/vigilancia.js) es
// un punto de partida basado en guías publicadas, NO un protocolo. Cada
// ítem es editable y borrable, porque el protocolo que manda es el del
// médico tratante y el de su país.
const vigilanciaSaludSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  nombre: { type: String, required: true },
  categoria: { type: String, default: "" }, // cardio, tiroides, audición, visión, digestivo, sueño...
  // Ventana de edad en meses en la que corresponde hacerlo. desde=0 es "al
  // nacer"; hasta=null es "de ahí en adelante".
  desdeMeses: { type: Number, default: 0 },
  hastaMeses: { type: Number, default: null },
  // Cada cuánto se repite (null = una sola vez en la vida).
  cadaMeses: { type: Number, default: null },
  nota: { type: String, default: "" },
  realizados: {
    type: [{
      fecha: { type: Date, required: true },
      resultado: { type: String, default: "" },
      estudioId: { type: mongoose.Schema.Types.ObjectId, ref: "Estudio", default: null },
    }],
    default: [],
  },
}, { timestamps: true });
vigilanciaSaludSchema.index({ pacienteId: 1, desdeMeses: 1 });
const VigilanciaSalud = mongoose.model("VigilanciaSalud", vigilanciaSaludSchema);

// ─── INSTRUMENTOS APLICADOS ───────────────────────────────────────────────
// ADOS-2, ADI-R, CARS-2, Vineland, WISC... El diagnóstico de TEA no sale de
// una charla: sale de instrumentos estandarizados, y hoy sus resultados
// viven en un PDF adjunto o en una frase suelta de la evolución.
//
// UNA LÍNEA QUE NO SE CRUZA: Symphomed registra el RESULTADO, nunca el
// instrumento. El ADOS-2 es propiedad de WPS —los ítems, las hojas de
// codificación, el algoritmo y las tablas de conversión— y exige
// calificación profesional y entrenamiento formal. Reproducir cualquiera de
// esas partes acá sería una infracción de copyright y, peor, invitaría a
// que alguien sin entrenamiento lo "aplique" leyendo una pantalla.
//
// Lo que se guarda es lo que el profesional produjo con SUS materiales y su
// licencia: qué aplicó, cuándo, quién, qué le dio. Anotar que un paciente
// puntuó X en una prueba no es reproducir la prueba, igual que anotar una
// glucemia no es reproducir el laboratorio.
//
// Los puntajes van como lista abierta {nombre, valor} y no como campos
// fijos: cada instrumento devuelve lo suyo, y calzar la estructura de uno
// solo en el modelo sería empezar a copiarlo.
const instrumentoAplicadoSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  instrumento: { type: String, required: true },   // "ADOS-2", "Vineland-3", "WISC-V"...
  version: { type: String, default: "" },
  // ADOS-2 tiene módulos (T, 1, 2, 3, 4) según lenguaje y edad; Vineland
  // tiene formas; otros no tienen nada. Campo libre a propósito.
  modulo: { type: String, default: "" },
  fecha: { type: Date, required: true },
  // Quién lo aplicó y con qué matrícula. En un instrumento que requiere
  // entrenamiento, esto no es burocracia: es parte del resultado.
  aplicadoPor: { type: String, default: "" },
  matricula: { type: String, default: "" },
  puntajes: {
    type: [{
      nombre: { type: String, required: true },  // "Total del algoritmo", "Puntaje de comparación"
      valor: { type: String, required: true },   // texto y no número: hay puntajes que son rangos o percentiles
      _id: false,
    }],
    default: [],
  },
  // Lo que el manual del instrumento arroja, tal cual. Texto libre porque
  // cada uno usa sus propias categorías.
  clasificacion: { type: String, default: "" },
  // La lectura del profesional. Un instrumento no es un diagnóstico: el
  // ADOS-2 es una observación estandarizada y se interpreta junto con la
  // historia del desarrollo y el juicio clínico. Este campo es donde eso
  // queda escrito, para que la clasificación no se lea sola.
  interpretacion: { type: String, default: "" },
  // Si el informe original vino en PDF, queda enganchado acá.
  estudioId: { type: mongoose.Schema.Types.ObjectId, ref: "Estudio", default: null },
}, { timestamps: true });
instrumentoAplicadoSchema.index({ pacienteId: 1, fecha: -1 });
const InstrumentoAplicado = mongoose.model("InstrumentoAplicado", instrumentoAplicadoSchema);

// Catálogo de ayuda para la pantalla: los nombres de los instrumentos y de
// los puntajes que devuelven. Nombrar un instrumento y decir qué campos
// arroja es descriptivo y está publicado en toda la literatura — no son ni
// los ítems ni el algoritmo ni los puntos de corte, que son justamente lo
// que no puede estar acá.
const INSTRUMENTOS_NEURO = [
  { nombre: "ADOS-2", modulos: ["T", "1", "2", "3", "4"],
    puntajes: ["Total del algoritmo", "Puntaje de comparación (1-10)"],
    nota: "Requiere entrenamiento formal. Es una observación estandarizada: se interpreta junto con la historia del desarrollo, no sola." },
  { nombre: "ADI-R", modulos: [],
    puntajes: ["Interacción social recíproca", "Comunicación", "Conductas restringidas y repetitivas", "Edad de inicio"],
    nota: "Entrevista al cuidador. Complementa al ADOS-2 con la historia del desarrollo." },
  { nombre: "CARS-2", modulos: ["ST", "HF"], puntajes: ["Puntaje total"], nota: "" },
  { nombre: "SCQ", modulos: ["Vida entera", "Actual"], puntajes: ["Puntaje total"], nota: "Cuestionario de tamizaje, no diagnóstico." },
  { nombre: "SRS-2", modulos: [], puntajes: ["Puntaje T total"], nota: "" },
  { nombre: "M-CHAT-R/F", modulos: [], puntajes: ["Puntaje total", "Nivel de riesgo"],
    nota: "Tamizaje entre los 16 y 30 meses. Un resultado positivo indica derivar a evaluación, no diagnostica." },
  { nombre: "Vineland-3", modulos: ["Entrevista", "Padres/cuidadores", "Docente"],
    puntajes: ["Conducta adaptativa (compuesto)", "Comunicación", "Habilidades de la vida diaria", "Socialización", "Motricidad"], nota: "" },
  { nombre: "WISC-V", modulos: [], puntajes: ["CI total", "Comprensión verbal", "Visoespacial", "Razonamiento fluido", "Memoria de trabajo", "Velocidad de procesamiento"], nota: "" },
  { nombre: "WPPSI-IV", modulos: [], puntajes: ["CI total"], nota: "" },
  { nombre: "Bayley-4", modulos: [], puntajes: ["Cognitiva", "Lenguaje", "Motora", "Socioemocional", "Conducta adaptativa"], nota: "" },
  { nombre: "Battelle-2", modulos: [], puntajes: ["Cociente de desarrollo total"], nota: "" },
  { nombre: "Conners-4", modulos: ["Padres", "Docente", "Autoinforme"], puntajes: ["Inatención", "Hiperactividad/impulsividad"], nota: "" },
  { nombre: "PEP-3", modulos: [], puntajes: ["Comunicación", "Motricidad", "Conductas desadaptativas"], nota: "" },
  { nombre: "Otro", modulos: [], puntajes: [], nota: "" },
];


// ═══ INFORMES CON MEMBRETE ════════════════════════════════════════════════
// El informe ES el producto que vende un centro de imagen: el paciente no
// paga por la placa, paga por la lectura del médico. Por eso esto no es un
// campo de texto más en la consulta, es una entidad propia con su código,
// su estado y su firma.
//
// Membrete: el encabezado del centro médico. Va en una colección aparte y
// no dentro de Medico porque incluye el logo y la firma en base64, y ese
// documento se lee en cada autenticación — cargar 200 KB de imágenes en
// cada login sería pagar caro por algo que se usa solo al imprimir.
const membreteSchema = new mongoose.Schema({
  medicoPhone: { type: String, unique: true, index: true, required: true },
  nombreCentro: { type: String, default: "" },
  direccion: { type: String, default: "" },
  telefono: { type: String, default: "" },
  ciudad: { type: String, default: "" },
  // Lo que va debajo de la firma: "Dra. X · Médico radiólogo · Reg. 12345"
  profesionalNombre: { type: String, default: "" },
  profesionalTitulo: { type: String, default: "" },
  profesionalRegistro: { type: String, default: "" },
  piePagina: { type: String, default: "" },
  // Imágenes como data URI. Son chicas (un logo y una firma) y así viajan
  // en el respaldo de la base sin plomería aparte de archivos.
  logo: { type: String, default: "" },
  firma: { type: String, default: "" },
}, { timestamps: true });
const Membrete = mongoose.model("Membrete", membreteSchema);

const informeSchema = new mongoose.Schema({
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  medicoPhone: { type: String, index: true, required: true },
  // Correlativo por consultorio, el que se dicta por teléfono cuando alguien
  // llama a preguntar por su informe.
  codigo: { type: String, required: true, index: true },
  titulo: { type: String, default: "" },        // "Radiografía periapical - molar 36"
  tipoEstudio: { type: String, default: "" },
  fechaEstudio: { type: Date, default: Date.now },

  // Cuáles de las imágenes del paciente se incluyen. Se GUARDA la selección
  // en vez de borrar las descartadas: al paciente ya se le dio la dosis y
  // esa placa es parte del registro, aunque no vaya en el informe.
  estudiosIncluidos: [{ type: mongoose.Schema.Types.ObjectId, ref: "Estudio" }],

  tecnica: { type: String, default: "" },
  hallazgos: { type: String, default: "" },
  conclusion: { type: String, default: "" },
  recomendaciones: { type: String, default: "" },

  // Un informe firmado no se edita más. Si hay que corregirlo se hace uno
  // nuevo que referencia al anterior — igual que en cualquier servicio de
  // imagenología serio, porque el informe original ya salió del consultorio
  // y puede estar en manos de otro médico.
  estado: { type: String, enum: ["borrador", "firmado"], default: "borrador", index: true },
  firmadoEn: { type: Date, default: null },
  corrigeA: { type: mongoose.Schema.Types.ObjectId, ref: "Informe", default: null },

  // Enlace para el paciente: sin cuenta, sin contraseña, vence solo. Un
  // paciente que recibe un informe una vez no va a crear un usuario, y una
  // cuenta más es superficie de ataque más.
  tokenPublico: { type: String, default: null, index: true },
  tokenExpira: { type: Date, default: null },
  compartidoEn: { type: Date, default: null },
  vistoEn: { type: Date, default: null },
  vistas: { type: Number, default: 0 },
}, { timestamps: true });
informeSchema.index({ medicoPhone: 1, codigo: 1 }, { unique: true });
const Informe = mongoose.model("Informe", informeSchema);

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

  // ─── De dónde salió esta receta ──────────────────────────────────────
  //
  // "vitalis" es la de siempre: un documento que se imprime, válido donde
  // alcanza con eso. "memed" es una receta FIRMADA DIGITALMENTE que vive en
  // Memed — acá queda la referencia y una copia de los medicamentos, porque
  // son dato clínico que el hilo clínico y el brief necesitan, pero el
  // documento legal no es de Symphomed y no finge serlo.
  //
  // La distinción tiene que estar guardada, no deducida: dentro de un año
  // nadie va a poder decir cuál de estas recetas tenía firma mirando los
  // medicamentos.
  // "vitalis" en minúscula NO es la marca: es un valor guardado en cada receta
  // ya emitida. Renombrarlo al cambiar de nombre el producto invalidaría todas
  // las recetas históricas y las búsquedas por origen dejarían de encontrarlas.
  origen: { type: String, enum: ["vitalis", "memed"], default: "vitalis", index: true },
  memed: {
    prescriptionUuid: { type: String, default: "" },
    reimpresion: { type: Boolean, default: false },
  },
}, { timestamps: true });
recetaSchema.index({ pacienteId: 1, fecha: -1 });
// Una reimpresión en Memed vuelve a disparar el mismo evento con el mismo
// uuid. Sin esto, cada vez que el médico reimprime una receta aparecería una
// receta nueva en el Kardex — el índice lo impide de raíz, que es más
// confiable que un "if" del lado del que escribe.
recetaSchema.index({ "memed.prescriptionUuid": 1 }, {
  unique: true,
  partialFilterExpression: { "memed.prescriptionUuid": { $type: "string", $gt: "" } },
});
const Receta = mongoose.model("Receta", recetaSchema);

// Recordatorios Médicos: vencimientos/controles próximos, vistos en una
// sola lista global del panel del médico (no por paciente) — "qué se viene"
// en todo el consultorio. Mandarlo solo por WhatsApp queda pendiente hasta
// resolver esa integración; por ahora el médico lo revisa dentro de Symphomed.
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
  origen: { type: String, enum: ["whatsapp", "whatsapp_web", "manual", "voz"], default: "manual" },
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

// Navegadores suscritos a las notificaciones del médico (Web Push). Un
// médico puede tener varias: el celular, la compu del consultorio, etc., y
// el aviso va a todas. El "endpoint" es la URL que da el navegador para
// llegarle a ESE dispositivo — es única, y si el navegador la da de baja
// (desinstalación, permiso revocado) el servicio de push responde 404/410
// y la borramos sola.
const suscripcionPushSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  endpoint: { type: String, unique: true, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  navegador: { type: String, default: "" }, // user-agent, para que el médico reconozca cuál es cuál
}, { timestamps: true });
const SuscripcionPush = mongoose.model("SuscripcionPush", suscripcionPushSchema);

// ─── SALDO PREPAGO ─────────────────────────────────────────────────────────
//
// El médico carga saldo (transferencia o QR) y cada consulta transcrita se lo
// descuenta. Esto es lo que el MÉDICO le paga a Symphomed — no confundir con
// TratamientoPlan.pagos, que es lo que el PACIENTE le paga al médico. Son dos
// plateas distintas y nunca se tocan.
//
// ═══ POR QUÉ UN LIBRO DE MOVIMIENTOS Y NO UN NÚMERO ════════════════════════
//
// Un campo "saldo" que se suma y se resta no se puede auditar. El día que un
// médico diga "cargué 200 y me descontaron mal" —y va a pasar— hay que poder
// mostrarle la lista: cargó tanto tal día, gastó 12 en esta consulta y 12 en
// esta otra. Sin eso, la discusión es su palabra contra un número.
//
// Entonces la VERDAD son estos movimientos. Medico.saldoCentavos es una copia
// rápida para no sumar todo en cada pantalla, y se puede reconstruir entera
// desde acá (ver reconciliar() en services/saldo.js).
//
// ═══ POR QUÉ CENTAVOS Y NÚMEROS ENTEROS ════════════════════════════════════
//
// Bs 12 se guarda como 1200, no como 12.0. Con decimales, 0.1 + 0.2 no da 0.3
// y los saldos empiezan a mostrar 99.99999999 después de unas cuantas
// operaciones. Con plata de verdad eso no es un detalle estético.
const movimientoSaldoSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  // carga     — el médico transfirió y se le acreditó
  // consumo   — una consulta transcrita
  // ajuste    — corrección a mano (con motivo obligatorio)
  // devolucion— se le devolvió plata
  tipo: { type: String, enum: ["carga", "consumo", "ajuste", "devolucion"], required: true, index: true },
  // Positivo suma, negativo resta. Un consumo de Bs 12 son -1200.
  montoCentavos: { type: Number, required: true },
  // Cómo quedó el saldo después de este movimiento. Redundante a propósito:
  // permite auditar un movimiento suelto sin recalcular toda la historia, y
  // delata un descuadre si algún día aparece.
  //
  // Arranca en null y se completa un instante después, cuando el $inc dice
  // cómo quedó el saldo — ver el orden en aplicar() de services/saldo.js. Un
  // null acá significa que el movimiento se anotó pero el saldo no llegó a
  // actualizarse: reconciliar() lo encuentra. Poner un 0 en su lugar sería
  // más cómodo y sería mentira.
  saldoDespuesCentavos: { type: Number, default: null },
  concepto: { type: String, default: "" },
  // Qué consulta lo generó. El índice único de abajo es lo que impide cobrar
  // dos veces la misma consulta si la transcripción reintenta.
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
  // De una carga: quién la acreditó y contra qué comprobante. Sin esto, una
  // carga es plata que apareció de la nada.
  acreditadoPor: { type: String, default: "" },
  // Un asiento que dice "200" y no dice de qué, no es un hecho: es un número.
  // Se guarda acá y no se va a preguntar a la cuenta, porque la cuenta dice
  // cómo está configurada HOY y el libro tiene que decir qué pasó ESE DÍA.
  moneda: { type: String, enum: ["BOB", "BRL"], default: "BOB", index: true },
  referencia: { type: String, default: "" },
  // La referencia normalizada (mayúsculas, sin espacios de más), que es sobre
  // la que actúa el índice único de abajo. Se guarda aparte para que la
  // original se siga mostrando tal como la escribió el operador.
  referenciaClave: { type: String, default: null },
}, { timestamps: true });
movimientoSaldoSchema.index({ medicoPhone: 1, createdAt: -1 });
// Una consulta se cobra UNA vez. Parcial porque solo aplica a los consumos:
// las cargas y los ajustes no tienen consultaId y no deben chocar entre sí.
movimientoSaldoSchema.index(
  { consultaId: 1 },
  { unique: true, partialFilterExpression: { tipo: "consumo", consultaId: { $type: "objectId" } }, name: "consumo_por_consulta_unico" }
);
// Una transferencia se acredita UNA vez. El caso que esto ataja es el más
// probable de todos: el médico manda el mismo comprobante dos veces —porque
// no le llegó la confirmación, o a propósito— y el operador, que ve dos
// mensajes distintos con días de diferencia, lo carga dos veces.
//
// Va sobre la referencia normalizada para que "QR BCP 4471" y "qr bcp  4471"
// no pasen como dos transferencias distintas.
movimientoSaldoSchema.index(
  { referenciaClave: 1 },
  { unique: true, partialFilterExpression: { tipo: "carga", referenciaClave: { $type: "string" } }, name: "carga_por_referencia_unica" }
);
const MovimientoSaldo = mongoose.model("MovimientoSaldo", movimientoSaldoSchema);

// ─── SOLICITUD DE RECARGA ──────────────────────────────────────────────────
//
// El médico avisa "ya pagué". Eso es todo lo que es: un AVISO, no un pago.
//
// ═══ ESTA COLECCIÓN NO MUEVE UN CENTAVO ════════════════════════════════════
//
// Nada de acá toca el saldo. Lo único que acredita es que un operador mire el
// banco y apruebe, y cuando lo hace la plata sale por services/saldo.js igual
// que siempre. La separación es a propósito y es la garantía central del
// modelo: si una solicitud pudiera acreditarse sola, cualquier médico se
// cargaría saldo escribiendo un número.
//
// El monto de acá es lo que el MÉDICO DICE haber pagado. El que se acredita
// es el que el operador ve en el extracto, y pueden no coincidir — por eso al
// aprobar se puede corregir, y queda registrado que se corrigió.
const solicitudRecargaSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  medicoNombre: { type: String, default: "" },
  // Lo que el médico declara. Sin valor probatorio: es su palabra.
  montoCentavos: { type: Number, required: true },
  referencia: { type: String, default: "" },
  // ═══ EL IDENTIFICADOR QUE VIAJA DENTRO DEL PAGO ═════════════════════════
  //
  // El código Pix lleva un txid adentro. Cuando el médico paga, ese mismo
  // txid aparece en el extracto del banco, al lado del monto.
  //
  // Se generaba, se metía en el código, se le mandaba al navegador y se
  // TIRABA. Así, el operador tenía que casar el pago por monto y nombre — que
  // funciona hasta el día que dos médicos pagan R$ 400 el mismo martes, y
  // entonces hay que adivinar cuál es cuál o acreditar mal.
  //
  // Guardarlo sirve dos veces: hoy le pone al operador el número exacto que
  // va a buscar en el extracto, y el día que haya aviso automático del banco
  // es lo que permite acreditar sin que nadie mire nada.
  //
  // Vacío cuando el médico pagó por transferencia o efectivo, que no llevan
  // txid. No se inventa uno: un identificador que no está en ningún extracto
  // es peor que ninguno, porque parece que se puede buscar.
  txid: { type: String, default: "", index: true },
  metodo: { type: String, enum: ["qr", "transferencia", "efectivo", "otro"], default: "qr" },
  nota: { type: String, default: "" },

  estado: { type: String, enum: ["pendiente", "acreditada", "rechazada"], default: "pendiente", index: true },
  // Cuando se aprueba: el movimiento real que se generó, y cuánto se acreditó
  // de verdad (puede diferir de lo declarado).
  movimientoId: { type: mongoose.Schema.Types.ObjectId, ref: "MovimientoSaldo", default: null },
  montoAcreditadoCentavos: { type: Number, default: null },
  revisadaPor: { type: String, default: "" },
  revisadaEn: { type: Date, default: null },
  motivoRechazo: { type: String, default: "" },
}, { timestamps: true });
solicitudRecargaSchema.index({ estado: 1, createdAt: 1 });
solicitudRecargaSchema.index({ medicoPhone: 1, createdAt: -1 });
const SolicitudRecarga = mongoose.model("SolicitudRecarga", solicitudRecargaSchema);

// ─── DATOS DE PAGO ─────────────────────────────────────────────────────────
//
// Dónde le pagan a Symphomed: banco, cuenta, titular. Vive en la base y no en
// el .env porque son datos que CAMBIAN —se abre otra cuenta, cambia el
// titular— y pedirle a alguien que entre por SSH y reinicie el servidor para
// corregir un número de cuenta es una forma de garantizar que ese número
// quede desactualizado.
//
// Lo edita un operador desde la pantalla de Pagos. No es información
// secreta: es exactamente lo que se le muestra a cada médico para que pague.
//
// Un solo documento para toda la instalación (clave "unico"): no es una
// configuración por médico ni por clínica, es la cuenta de la empresa.
const configPagoSchema = new mongoose.Schema({
  clave: { type: String, default: "unico", unique: true, index: true },
  banco: { type: String, default: "" },
  cuenta: { type: String, default: "" },
  titular: { type: String, default: "" },
  documento: { type: String, default: "" },
  whatsapp: { type: String, default: "" },
  // Solo Brasil: el estándar del código Pix exige la ciudad del que cobra.
  // Vacío no rompe nada — services/pix.js pone un valor por defecto — pero
  // algunos bancos la muestran al pagador, así que conviene que sea la real.
  ciudad: { type: String, default: "" },
  // Quién los tocó por última vez. Si un día los pagos empiezan a ir a una
  // cuenta que no es la nuestra, esto es lo primero que hay que mirar.
  actualizadoPor: { type: String, default: "" },
}, { timestamps: true });
const ConfigPago = mongoose.model("ConfigPago", configPagoSchema);

// ─── TELECONSULTA ──────────────────────────────────────────────────────────
//
// Una consulta por video. El paciente entra por un enlace que vence, sin
// cuenta y sin contraseña — el mismo patrón del informe público, porque
// pedirle a un paciente que se registre para una consulta es perder la
// consulta.
//
// ═══ EL CONSENTIMIENTO ES LA LLAVE, NO UNA CASILLA ═════════════════════════
//
// Grabar a un paciente sin que lo autorice no es un problema de formulario:
// esa grabación no sirve para nada. No es respaldo clínico, no es prueba, y
// en Brasil (LGPD) y en Bolivia es directamente ilegal.
//
// Por eso el consentimiento no es un booleano que alguien consulta si se
// acuerda: sin él NO SE EMITE el token de la sala. La puerta está cerrada
// del lado del servidor, no atenuada del lado de la pantalla. Y se guarda
// cuándo y desde qué IP, porque "dijo que sí" sin fecha no es un registro.
//
// Se guarda también el TEXTO exacto que el paciente aceptó. Si mañana
// cambiamos la redacción, lo que hay que poder mostrar es lo que decía el
// día que esa persona apretó el botón, no lo que dice hoy.
const teleconsultaSchema = new mongoose.Schema({
  medicoPhone: { type: String, index: true, required: true },
  pacienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Paciente", required: true, index: true },
  pacienteNombre: { type: String, default: "" },

  // El enlace del paciente. Corto de vida a propósito: un enlace de consulta
  // que sirve tres meses es un enlace que alguien reenvía por WhatsApp y
  // termina abriendo un tercero.
  token: { type: String, required: true, unique: true, index: true },
  tokenExpira: { type: Date, required: true },

  estado: { type: String, enum: ["creada", "en_curso", "terminada", "cancelada"], default: "creada", index: true },

  consentimiento: {
    aceptado: { type: Boolean, default: false },
    fecha: { type: Date, default: null },
    ip: { type: String, default: "" },
    // La versión del texto que se aceptó, no la de hoy.
    texto: { type: String, default: "" },
  },

  // La sala del proveedor de video. El nombre se guarda para poder borrarla
  // después; la URL se arma al vuelo.
  salaNombre: { type: String, default: "" },
  iniciadaEn: { type: Date, default: null },
  terminadaEn: { type: Date, default: null },

  // La consulta clínica que salió de esta llamada, cuando se grabó.
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
}, { timestamps: true });
teleconsultaSchema.index({ medicoPhone: 1, createdAt: -1 });
const Teleconsulta = mongoose.model("Teleconsulta", teleconsultaSchema);

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
  tipo: { type: String, enum: ["reconsulta", "tratamiento", "examen_ocular", "examen_ginecologico", "nota"], required: true },
  consultaId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultaMedica", default: null },
  campo: { type: String, default: "" }, // ej: "fechaHora", "nombre", "OD:cristalino"
  valorSugerido: { type: String, default: "" }, // lo que propuso la IA
  valorFinal: { type: String, default: "" }, // lo que el médico dejó guardado
}, { timestamps: true });
correccionIASchema.index({ medicoPhone: 1, tipo: 1, createdAt: -1 });
const CorreccionIA = mongoose.model("CorreccionIA", correccionIASchema);


// ─── INVITACIONES AL REPORTE ───────────────────────────────────────────────
//
// El reporte financiero se le muestra a inversores, y a un inversor no se le
// da la cuenta de operador: se le da un enlace propio, que vence y se puede
// apagar sin tocar nada más.
//
// ═══ POR QUÉ EN LA BASE Y NO UN TOKEN FIRMADO ══════════════════════════════
//
// Un token firmado con vencimiento adentro sería más simple y no necesitaría
// esta colección. Pero un token firmado NO SE PUEDE REVOCAR: una vez emitido,
// vale hasta que expire, y no hay forma de apagarlo si la conversación con
// ese inversor se terminó mal o el enlace se reenvió a quien no debía.
//
// Acá la fila ES el permiso. Borrar o marcar la fila corta el acceso en el
// próximo pedido, que es exactamente lo que hace falta cuando alguien
// pregunta "¿podés desactivar el que le mandé a fulano?".
//
// El código lo genera crypto.randomBytes(24): 192 bits, no se adivina ni
// probando. Por eso no hay contraseña además del enlace — el enlace ES la
// credencial, igual que en /informe/:token y /teleconsulta/:token.
const invitacionReporteSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true, index: true },
  // "invitacion" es el enlace que se le manda a un inversor. "pase" es otra
  // cosa: un vale de un solo uso y de un minuto que se emite a sí mismo el
  // operador para poder ABRIR el reporte como navegación.
  //
  // Hace falta porque la CSP se aplica por documento, no por respuesta:
  // traer el reporte con fetch y escribirlo en la página deja adentro un
  // <script> con un nonce que ese documento nunca autorizó, y el navegador
  // lo bloquea sin decir nada. Con el pase, el reporte se abre navegando y
  // su propia CSP es la que rige.
  tipo: { type: String, enum: ["invitacion", "pase"], default: "invitacion", index: true },
  usada: { type: Boolean, default: false },
  // Para quién es. Sirve para saber cuál apagar seis meses después, cuando
  // nadie se acuerde de qué enlace le mandó a quién.
  etiqueta: { type: String, default: "" },
  creadaPor: { type: String, default: "" },
  expiraEn: { type: Date, required: true },
  revocada: { type: Boolean, default: false },
  // Cuántas veces se abrió. No identifica a nadie: solo permite ver que un
  // enlace que se mandó a una persona se abrió cuarenta veces.
  visitas: { type: Number, default: 0 },
  ultimaVisita: { type: Date, default: null },
}, { timestamps: true });
const InvitacionReporte = mongoose.model("InvitacionReporte", invitacionReporteSchema);

// ─── Un médico que escribió preguntando por Symphomed ──────────────────────
//
// El mismo WhatsApp por el que los pacientes reservan atiende también a los
// médicos que llegan desde symphomed.com. Lo que dicen ahí es la materia
// prima de la venta, y si quedara solo en el log se pierde: nadie lee un log
// buscando clientes.
//
// NO es una cuenta. Un médico que se registra queda como Medico con
// estadoCuenta "pendiente"; esto es de ANTES — alguien que todavía está
// averiguando. Los dos no se mezclan a propósito: meter interesados en la
// cola de aprobaciones la llena de gente que nunca pidió entrar, y entonces
// la cola deja de mirarse.
const interesadoSchema = new mongoose.Schema({
  // El WhatsApp desde el que escribió. Es la identidad acá: no hay login.
  numero: { type: String, required: true, unique: true, index: true },
  // Lo que la conversación dejó saber. Todo opcional: un interesado que solo
  // preguntó el precio y se fue igual vale como contacto.
  nombre: { type: String, default: "" },
  especialidad: { type: String, default: "" },
  ciudad: { type: String, default: "" },
  idioma: { type: String, enum: ["es", "pt"], default: "es" },
  // "nuevo"      — escribió y nadie lo llamó todavía
  // "interesado" — pidió la demostración, que lo llamen, o cómo empezar
  // "contactado" — ya se habló con él (lo marca una persona)
  // "descartado" — no era médico, o no va
  estado: { type: String, enum: ["nuevo", "interesado", "contactado", "descartado"], default: "nuevo", index: true },
  // La conversación, para no llamar a ciegas. Va acotada a las últimas
  // vueltas: el valor está ahí, no en la transcripción completa.
  conversacion: [{
    de: { type: String, enum: ["medico", "bot"] },
    texto: { type: String, default: "" },
    cuando: { type: Date, default: Date.now },
  }],
  // Qué pasó después. Lo llena una persona, no el bot.
  notas: { type: String, default: "" },
  ultimoMensaje: { type: Date, default: Date.now, index: true },
}, { timestamps: true });
const Interesado = mongoose.model("Interesado", interesadoSchema);

module.exports = { Interesado, Clinica, PersonaClinica, Medico, Paciente, ConsultaMedica, Medicamento, Vacuna, Medicion, Estudio, Receta, Recordatorio, Cita, SesionCitaWA, Vinculacion, SuscripcionPush, MovimientoSaldo, SolicitudRecarga, ConfigPago, Teleconsulta, AuditLog, Odontograma, ESTADOS_PIEZA_DENTAL, PIEZAS_FDI_PERMANENTE, CatalogoTratamiento, TratamientoPlan, ExamenOcular, RecetaOptica, OJOS, ESTRUCTURAS_OCULARES, ESTADOS_ESTRUCTURA_OCULAR,
  ExamenGinecologico, ORGANOS_GINECO, HALLAZGOS_GINECO,
  MapaCorporal, REGIONES_CORPORALES, ESTADOS_LESION, LADOS_CUERPO, CorreccionIA, Embarazo, DESENLACES_EMBARAZO,
  EquipoRayos, CapturaPendiente, EstudioEntrante,
  PerfilNeuro, ObjetivoNeuro, VigilanciaSalud, InstrumentoAplicado, INSTRUMENTOS_NEURO, Membrete, Informe,
  CONDICIONES_NEURO, FORMAS_COMUNICACION, MODALIDADES_SENSORIALES, RESPUESTAS_SENSORIALES, AREAS_OBJETIVO,
  InvitacionReporte };
