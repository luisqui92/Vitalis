// Symphomed — Reserva de citas por WhatsApp: conversación guiada con listas y
// botones interactivos de la API oficial de Meta (no texto numerado — eso
// era necesario con Baileys/texto plano, la API de Meta permite algo más
// prolijo). Sigue siendo una máquina de estados (no IA libre): para algo
// tan estructurado como elegir un turno, es más confiable que dejar que el
// paciente escriba libre y una IA interprete la fecha/hora.
const { Medico, Cita, SesionCitaWA, Paciente, ConsultaMedica, Vacuna, Medicamento, Interesado } = require("../db/models");
const { obtenerHorariosDisponibles, horarioSigueLibre } = require("./agenda");
const { eliminarEvento } = require("./googleCalendar");
const { enrutarMensaje } = require("./asistenteWhatsapp");
const { atenderMedico } = require("./asistenteVentas");
const { crearCitaConfirmada } = require("./crearCita");
const { CONFIG, log } = require("../config");
const { horaEnZona, fechaCompletaEnZona, ZONA_POR_DEFECTO } = require("./zonaHoraria");

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_SEMANA_CORTO = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

// Estas corren en el server, que en producción corre en UTC (no en hora
// boliviana) — sin timeZone explícito, "es-BO" solo cambia el idioma del
// formato, no convierte nada de zona horaria (error común). fechaStr ya es
// un día boliviano (viene de services/agenda.js), así que se parsea
// forzando UTC para no volver a mezclarlo con la zona del server.
function formatearDiaCorto(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00Z");
  return `${DIAS_SEMANA_CORTO[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
// ═══ LA HORA QUE SE LE ESCRIBE AL PACIENTE ═════════════════════════════════
//
// Estas dos tenían timeZone: "America/La_Paz" escrito a mano. Para un
// consultorio boliviano daba bien; para uno brasileño le decía al paciente
// una hora que no era la de su turno.
//
// La zona entra como parámetro y no se lee adentro: son funciones de
// formato, y una que consulta la base para poder escribir un texto termina
// pegándole a Mongo una vez por cada renglón de la lista de horarios.
function formatearHora(fecha, zona) {
  return horaEnZona(zona || ZONA_POR_DEFECTO, fecha);
}
function formatearFechaCompleta(fecha, zona) {
  return fechaCompletaEnZona(zona || ZONA_POR_DEFECTO, fecha);
}

// La zona de una cuenta. Es un findOne indexado con proyección: una consulta
// barata, una vez por mensaje del bot.
async function zonaDelMedico(medicoPhone) {
  const m = await Medico.findOne({ phone: medicoPhone }).select("zonaHoraria").lean();
  return m?.zonaHoraria || ZONA_POR_DEFECTO;
}

// ─── Helpers para armar la respuesta (el webhook decide con qué función de
// services/metaWhatsapp.js mandarla, según "tipo") ────────────────────────
function comoTexto(texto) { return { tipo: "texto", texto }; }
function comoBotones(texto, botones) { return { tipo: "botones", texto, botones }; }
function comoLista(texto, textoBoton, filas) { return { tipo: "lista", texto, textoBoton, filas }; }

// Si el paciente quedó a mitad de una conversación (se distrajo, cerró
// WhatsApp, tocó algo raro) y no volvió a escribir en 2 minutos, el
// próximo mensaje arranca de cero en vez de insistir con un paso viejo que
// ya no tiene sentido — más simple para el paciente que quedar "trabado"
// sin entender por qué el bot no le entiende.
const SESION_MINUTOS_EXPIRA = 2;

// ═══ LA CONVERSACIÓN CON UN MÉDICO DURA MÁS ═══════════════════════════════
//
// Dos minutos está bien para un paciente: el que dejó de elegir un horario
// hace media hora quiere empezar de nuevo, no retomar un paso viejo.
//
// Un médico que está averiguando, no. Lee la respuesta, la piensa, la habla
// con su socio y vuelve a los diez minutos. Con el tope de dos minutos caería
// otra vez en el menú de especialidades como si fuera un paciente, y la
// conversación de venta se cortaría justo cuando estaba andando.
const MEDICO_MINUTOS_EXPIRA = 60;

async function obtenerSesion(numero) {
  const doc = await SesionCitaWA.findOne({ numero }).lean();
  if (!doc) return { numero, paso: "inicio", datos: {} };
  const minutosInactiva = (Date.now() - new Date(doc.updatedAt).getTime()) / 60000;
  const tope = doc.paso === "medico" ? MEDICO_MINUTOS_EXPIRA : SESION_MINUTOS_EXPIRA;
  if (minutosInactiva > tope) return { numero, paso: "inicio", datos: {} };
  return doc;
}
async function guardarSesion(numero, paso, datos) {
  await SesionCitaWA.findOneAndUpdate({ numero }, { paso, datos }, { upsert: true });
}
async function limpiarSesion(numero) {
  await SesionCitaWA.deleteOne({ numero });
}

// Resumen liviano de la historia de un paciente/cliente ya conocido, para
// que el asistente pueda saludarlo con calidez y continuidad (sin volverse
// una interpretación clínica — eso lo prohíbe el propio prompt del
// asistente). null si el número no corresponde a ningún paciente cargado
// (primera vez que escribe).
async function resumenHistorialPaciente(medicoPhone, numero) {
  const paciente = await Paciente.findOne({ medicoPhone, telefono: numero }).lean();
  if (!paciente) return null;

  const [consultas, medicamentosActivos, vacunas] = await Promise.all([
    ConsultaMedica.find({ pacienteId: paciente._id, medicoPhone, estado: "completado" })
      .select("notaClinica createdAt").sort({ createdAt: -1 }).limit(2).lean(),
    Medicamento.find({ pacienteId: paciente._id, medicoPhone, fechaFin: null }).select("nombre").lean(),
    Vacuna.find({ pacienteId: paciente._id, medicoPhone }).select("nombre fecha").sort({ fecha: -1 }).limit(2).lean(),
  ]);

  const partes = [`Nombre: ${paciente.nombre}`];
  if (paciente.especie) partes.push(`Especie/raza: ${paciente.especie}${paciente.raza ? " " + paciente.raza : ""}`);
  if (consultas.length) {
    partes.push("Últimas visitas: " + consultas.map(c => {
      const motivo = c.notaClinica?.motivoConsulta || c.notaClinica?.diagnostico;
      return `${new Date(c.createdAt).toLocaleDateString("es-BO")}${motivo ? " - " + motivo : ""}`;
    }).join("; "));
  }
  if (medicamentosActivos.length) partes.push("Medicación activa: " + medicamentosActivos.map(m => m.nombre).join(", "));
  if (vacunas.length) partes.push("Vacunas recientes: " + vacunas.map(v => `${v.nombre} (${new Date(v.fecha).toLocaleDateString("es-BO")})`).join(", "));

  return partes.join("\n");
}

// "Súper número": varios consultorios propios detrás del mismo WhatsApp.
// El paciente elige primero cuál busca; esa elección queda guardada en
// datos.medicoPhone de la sesión y viaja con ella en cada paso siguiente
// (todos los guardarSesion de acá abajo hacen spread de "datos", así que
// alcanza con sembrarla una sola vez al elegir).
const ETIQUETA_ESPECIALIDAD = {
  odontologia: "🦷 Odontología",
  estetica: "✨ Estética (Symphomed Face)",
  oftalmologia: "👁️ Oftalmología",
  veterinaria: "🐾 Veterinaria",
  ginecologia: "🤰 Ginecología y Obstetricia",
  medicina_general: "🩺 Medicina General",
};

async function mostrarEspecialidades(numero) {
  const telefonos = CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS;
  const medicos = await Medico.find({ phone: { $in: telefonos } }).select("phone nombre tipoEspecialidad").lean();
  const ordenados = telefonos.map(ph => medicos.find(m => m.phone === ph)).filter(Boolean);
  if (ordenados.length === 0) return comoTexto("Este número todavía no está configurado. Avisale a la clínica.");
  await guardarSesion(numero, "elegir_especialidad", {
    opciones: ordenados.map(m => ({ phone: m.phone, nombre: m.nombre, tipoEspecialidad: m.tipoEspecialidad })),
  });
  // La fila de los médicos va ÚLTIMA, y no primera: el que escribe a este
  // número es un paciente en la enorme mayoría de los casos, y no tiene por
  // qué leer una opción que no es para él antes de llegar a la suya.
  //
  // Las listas de WhatsApp admiten 10 filas como máximo, así que si algún día
  // hay diez consultorios, esta se cae sola — y los médicos igual llegan por
  // el texto de la página, que es por donde llegan casi todos.
  const filas = ordenados.map((m, i) => ({
    id: `esp_${i}`,
    title: ETIQUETA_ESPECIALIDAD[m.tipoEspecialidad] || m.tipoEspecialidad,
    description: m.nombre,
  }));
  if (filas.length < 10) {
    filas.push({ id: "soy_medico", title: "🩺 Soy médico", description: "Quiero conocer Symphomed" });
  }
  return comoLista("¡Hola! 👋 ¿Qué estás buscando?", "Ver opciones", filas);
}

async function elegirEspecialidad(numero, t, datos) {
  // El que se declara médico entra al flujo de ventas por la puerta de
  // adelante, sin tener que escribir "Symphomed" para que la heurística lo
  // reconozca.
  if (t === "soy_medico") {
    await guardarSesion(numero, "medico", { historial: [], actualizada: new Date() });
    return comoTexto("¡Qué bueno! 👋 Cuénteme, ¿de qué especialidad es y en qué ciudad atiende? " +
      "Así le cuento cómo le sirve Symphomed a un consultorio como el suyo.");
  }
  const idx = t.startsWith("esp_") ? parseInt(t.slice(4), 10) : NaN;
  const opcion = Number.isInteger(idx) ? datos.opciones?.[idx] : null;
  if (!opcion) return comoTexto("Elegí una de las opciones de la lista de arriba para continuar.");
  const medico = await Medico.findOne({ phone: opcion.phone }).lean();
  if (!medico) return comoTexto("Ups, ese consultorio ya no está disponible. Escribí cualquier cosa para ver las opciones de nuevo.");
  return iniciarReserva(opcion.phone, numero);
}

// ─── El flujo de los médicos que preguntan por Symphomed ───────────────────

// Sin tildes y en minúsculas: "demostración" y "demostracion" son la misma
// palabra para quien la escribe apurado en un teclado de celular.
function sinTildes(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Los botones de symphomed.com mandan estas frases, una por idioma (ver
// scripts/diseno/textos.js → WA_TEXTO). No se comparan enteras: el visitante
// puede borrar media frase antes de mandarla, o agregarle algo.
function esConsultaDeMedico(texto) {
  return sinTildes(texto).includes("symphomed");
}

// ═══ EL «HOLA» DE ALGUIEN QUE YA SE PRESENTÓ ══════════════════════════════
//
// La heurística de arriba mira si el mensaje nombra a Symphomed, y para el
// primer contacto está bien: el 99 % de quien escribe a este número es un
// paciente que quiere una cita, y ese es el flujo que tiene que ganar.
//
// El problema es el segundo día. Un médico que ayer preguntó por Symphomed
// hoy escribe "Hola" y le contesta el bot de reservas: "¿cuál de nuestros
// consultorios buscás?". Queda como que el sistema no se acuerda de él —y
// justo con la persona a la que le estamos vendiendo memoria.
//
// Entonces: si de este número YA hay un interesado registrado y todavía no
// lo contactó nadie, un saludo suelto sigue la conversación de ventas. No
// alcanza con que exista el registro: si ya está "contactado" o
// "descartado", eso lo movió una persona y el bot no lo pisa.
const SALUDOS = /^(hola|buenas|buen dia|buenas tardes|buenas noches|hey|que tal|holi)[\s!.,¡]*$/;

async function saludoDeUnInteresado(numero, texto) {
  if (!SALUDOS.test(sinTildes(texto).trim().toLowerCase())) return false;
  const i = await Interesado.findOne({ numero }).select("estado").lean();
  return Boolean(i) && (i.estado === "nuevo" || i.estado === "interesado");
}

// Cuánto se guarda de la conversación. Seis vueltas alcanzan para que la IA
// no repregunte lo que ya le dijeron, y evitan que una charla larga se coma
// el contexto —y el costo— de cada mensaje siguiente.
const MAX_HISTORIAL = 12;

async function atenderComoMedico(numero, texto, sesion, nombrePerfil) {
  const interesado = await Interesado.findOne({ numero });
  // obtenerSesion ya aplicó la ventana larga: si llegó con paso "medico", la
  // charla sigue viva. Si no, arranca de cero — pero el Interesado se
  // conserva, así que lo que se sabe de él no se pierde nunca.
  const historial = sesion.paso === "medico" ? (sesion.datos?.historial || []) : [];
  const idioma = interesado?.idioma || "es";

  // Se le pasa lo que ya quedó guardado de él: el historial de la charla se
  // vence a la hora, el contacto no. Sin esto, alguien que hace un mes dijo
  // que era veterinario vuelve a escribir y le preguntamos lo mismo.
  const r = await atenderMedico(texto, historial, idioma, interesado);

  // La IA dice que en realidad es un paciente: se devuelve null y el mensaje
  // sigue al flujo de reserva. Se limpia la sesión para que el próximo no
  // vuelva a entrar acá.
  if (r.intencion === "paciente") {
    if (sesion.paso === "medico") await limpiarSesion(numero);
    return null;
  }

  const nuevoHistorial = [...historial,
    { de: "medico", texto },
    { de: "bot", texto: r.respuesta },
  ].slice(-MAX_HISTORIAL);

  await guardarSesion(numero, "medico", { historial: nuevoHistorial, actualizada: new Date() });

  // El contacto se guarda SIEMPRE, desde el primer mensaje. Un médico que
  // pregunta el precio y no vuelve a escribir igual es alguien a quien
  // llamar: si solo se guardaran los que piden la demostración, se perdería
  // la mayoría.
  const datos = {
    ultimoMensaje: new Date(),
    conversacion: nuevoHistorial.map(m => ({ de: m.de, texto: m.texto })),
  };
  if (r.datos.nombre) datos.nombre = r.datos.nombre;
  if (r.datos.especialidad) datos.especialidad = r.datos.especialidad;
  if (r.datos.ciudad) datos.ciudad = r.datos.ciudad;
  if (!interesado && nombrePerfil && !datos.nombre) datos.nombre = nombrePerfil;
  // Solo sube de "nuevo" a "interesado". Nunca pisa "contactado" ni
  // "descartado": eso lo puso una persona y el bot no lo revisa.
  if (r.intencion === "interesado" && (!interesado || interesado.estado === "nuevo")) {
    datos.estado = "interesado";
  }

  await Interesado.findOneAndUpdate({ numero }, { $set: datos, $setOnInsert: { numero } }, { upsert: true });

  if (r.intencion === "interesado") {
    // Va como error y no como info a propósito: en el log de errores es donde
    // se mira cuando algo importa, y un médico pidiendo una demostración es
    // exactamente eso. Es la señal más barata que existe hasta que haya una
    // pantalla en el panel.
    log.error(`[VENTAS] 🔔 MÉDICO INTERESADO — ${numero} · ${datos.nombre || "sin nombre"} · ` +
      `${datos.especialidad || "especialidad?"} · ${datos.ciudad || "ciudad?"}`);
  }

  return comoTexto(r.respuesta);
}

async function procesarMensajeEntrante(numero, texto, nombrePerfil) {
  const superNumero = CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.length > 0;
  const sesion = await obtenerSesion(numero);
  const t = texto.trim().toLowerCase();

  // ═══ MÉDICO O PACIENTE ═══════════════════════════════════════════════════
  //
  // El mismo número atiende las dos cosas. La separación se hace acá, antes
  // de cualquier lógica de reserva, y se apoya en algo que ya existía sin
  // haber sido pensado para esto: los botones de symphomed.com mandan un
  // texto predefinido —"Hola, quiero ver una demostración de Symphomed"— así
  // que un médico que llega de la página se identifica solo, sin que haya que
  // preguntarle nada y sin agregarle un paso al paciente.
  //
  // La heurística es "dice Symphomed": un paciente que quiere una cita
  // escribe "hola" o "quiero un turno", no el nombre de la plataforma que le
  // maneja la ficha a su médico.
  //
  // Y si igual se equivoca no se rompe nada: el asistente de ventas devuelve
  // intención "paciente" y el mensaje sigue de largo al flujo de reserva. La
  // heurística rutea, la IA corrige.
  if (sesion.paso === "medico" || esConsultaDeMedico(t) || await saludoDeUnInteresado(numero, t)) {
    const r = await atenderComoMedico(numero, texto, sesion, nombrePerfil);
    if (r) return r;
    // Era un paciente que nombró Symphomed. Sigue por el camino normal.
  }

  const medicoPhone = sesion.datos?.medicoPhone || (!superNumero ? CONFIG.SALUD_WHATSAPP_MEDICO_PHONE : null);
  if (!medicoPhone) {
    if (sesion.paso === "elegir_especialidad") return elegirEspecialidad(numero, t, sesion.datos);
    return mostrarEspecialidades(numero);
  }

  const medico = await Medico.findOne({ phone: medicoPhone }).lean();
  if (!medico) return comoTexto("Este número todavía no está configurado. Avisale a la clínica.");

  if (t === "cancelar" || t === "cancelar cita") {
    return iniciarCancelacion(medicoPhone, numero);
  }

  switch (sesion.paso) {
    case "confirmar_cancelacion":
      return confirmarCancelacion(medicoPhone, numero, t, texto, sesion.datos, medico);
    case "elegir_dia":
      return elegirDia(medicoPhone, numero, t, texto, sesion.datos, medico);
    case "elegir_hora":
      return elegirHora(medicoPhone, numero, t, texto, sesion.datos, medico);
    case "pedir_nombre":
      return pedirNombre(numero, texto, sesion.datos);
    case "pedir_motivo":
      return pedirMotivo(medicoPhone, numero, texto, sesion.datos, medico);
    default:
      return manejarMensajeLibre(medicoPhone, numero, texto, medico);
  }
}

// Cuando el paciente está en medio de elegir día/hora o confirmar una
// cancelación y escribe algo que NO es la opción esperada (tocó mal, o
// directamente escribió una pregunta en vez de usar la lista/botones),
// probamos con la misma IA que ya usa el mensaje inicial: si reconoce una
// pregunta respondible con la info del consultorio, la responde ahí mismo
// (sin sacar al paciente del paso en el que estaba); si reconoce que
// quiere cancelar, lo manda a ese flujo. Si no es ninguna de las dos,
// seguimos con el "no entendí" de siempre.
async function intentarDesvioLibre(medicoPhone, numero, texto, medico) {
  try {
    const historial = await resumenHistorialPaciente(medicoPhone, numero);
    const { intencion, respuesta } = await enrutarMensaje(texto, medico, historial);
    if (intencion === "pregunta" && respuesta) return { tipo: "respuesta", texto: respuesta };
    if (intencion === "cancelar") return { tipo: "cancelar" };
  } catch (e) {
    log.error("[RESERVA_CITAS] enrutarMensaje (desvío) falló:", e.message);
  }
  return null;
}

// Sin una conversación de reserva ya en curso: primero se fija si es una
// pregunta general (responde con la info del consultorio) o si de verdad
// quiere agendar — recién ahí arranca la lista de días.
async function manejarMensajeLibre(medicoPhone, numero, texto, medico) {
  try {
    const historial = await resumenHistorialPaciente(medicoPhone, numero);
    const { intencion, respuesta } = await enrutarMensaje(texto, medico, historial);
    if (intencion === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    if (intencion === "pregunta" && respuesta) return comoTexto(respuesta);
  } catch (e) {
    log.error("[RESERVA_CITAS] enrutarMensaje falló, sigo con la reserva normal:", e.message);
  }
  return iniciarReserva(medicoPhone, numero);
}

// Las listas interactivas de WhatsApp permiten como máximo 10 filas — se
// muestran los primeros 10 días con algún horario libre (de los hasta 21
// que trae obtenerHorariosDisponibles). Si el consultorio tiene tantísima
// disponibilidad que eso no alcanza, el paciente igual puede escribir
// "cancelar" o preguntar directo — no es una limitación real en la práctica.
async function iniciarReserva(medicoPhone, numero) {
  const dias = await obtenerHorariosDisponibles(medicoPhone, 21);
  if (dias.length === 0) {
    return comoTexto("Por ahora no tengo horarios disponibles cargados. Comunicate directo con la clínica para coordinar tu cita.");
  }
  const diasMostrados = dias.slice(0, 10);
  await guardarSesion(numero, "elegir_dia", { medicoPhone, dias: diasMostrados });
  return comoLista(
    "¡Hola! 👋 Elegí el día que te sirva para tu cita:",
    "Ver días",
    diasMostrados.map((d, i) => ({
      id: `dia_${i}`,
      title: formatearDiaCorto(d.fecha),
      description: `${d.slots.length} horario${d.slots.length === 1 ? "" : "s"} libre${d.slots.length === 1 ? "" : "s"}`,
    })),
  );
}

function listaDeHorarios(dia, zona) {
  const slots = dia.slots.slice(0, 10);
  return comoLista(
    `Horarios para el ${formatearDiaCorto(dia.fecha)}:`,
    "Ver horarios",
    slots.map((s, i) => ({ id: `hora_${i}`, title: formatearHora(s, zona) })),
  );
}

async function elegirDia(medicoPhone, numero, t, texto, datos, medico) {
  const idx = t.startsWith("dia_") ? parseInt(t.slice(4), 10) : NaN;
  const dia = Number.isInteger(idx) ? datos.dias?.[idx] : null;
  if (!dia) {
    const desvio = await intentarDesvioLibre(medicoPhone, numero, texto, medico);
    if (desvio?.tipo === "respuesta") return comoTexto(`${desvio.texto}\n\nCuando quieras, elegí un día de la lista para seguir con tu cita.`);
    if (desvio?.tipo === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    return comoTexto("Elegí uno de los días de la lista de arriba para seguir con tu cita (o escribí qué necesitás).");
  }
  await guardarSesion(numero, "elegir_hora", { ...datos, diaElegido: dia });
  return listaDeHorarios(dia, medico?.zonaHoraria);
}

async function elegirHora(medicoPhone, numero, t, texto, datos, medico) {
  const idx = t.startsWith("hora_") ? parseInt(t.slice(5), 10) : NaN;
  const slot = Number.isInteger(idx) ? datos.diaElegido?.slots?.[idx] : null;
  if (!slot) {
    const desvio = await intentarDesvioLibre(medicoPhone, numero, texto, medico);
    if (desvio?.tipo === "respuesta") return comoTexto(`${desvio.texto}\n\nCuando quieras, elegí un horario de la lista para el ${formatearDiaCorto(datos.diaElegido?.fecha)}.`);
    if (desvio?.tipo === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    return comoTexto("Elegí uno de los horarios de la lista de arriba (o escribí qué necesitás).");
  }
  const libre = await horarioSigueLibre(medicoPhone, slot, medico.duracionConsultaMinutos || 30);
  if (!libre) {
    // Se re-arma la lista de ese mismo día por si sigue teniendo otros
    // horarios libres, en vez de mandar al paciente de vuelta al principio.
    const diasActualizados = await obtenerHorariosDisponibles(medicoPhone, 21);
    const diaActualizado = diasActualizados.find(d => d.fecha === datos.diaElegido?.fecha);
    if (!diaActualizado) return comoTexto("Ups, ese horario se acaba de ocupar y no quedan más libres ese día. Escribí cualquier cosa para ver los días disponibles de nuevo.");
    await guardarSesion(numero, "elegir_hora", { ...datos, diaElegido: diaActualizado });
    const lista = listaDeHorarios(diaActualizado, medico?.zonaHoraria);
    return { ...lista, texto: `Ups, ese horario se acaba de ocupar. ${lista.texto}` };
  }
  await guardarSesion(numero, "pedir_nombre", { ...datos, horaElegida: slot });
  return comoTexto("¿A nombre de quién es la cita? Escribí el nombre completo.");
}

async function pedirNombre(numero, textoOriginal, datos) {
  const nombre = textoOriginal.trim();
  if (nombre.length < 2) return comoTexto("Necesito un nombre válido para la cita.");
  await guardarSesion(numero, "pedir_motivo", { ...datos, pacienteNombre: nombre });
  return comoTexto(`Gracias, ${nombre.split(" ")[0]}. Por último, ¿cuál es el motivo de la consulta? (podés escribir "ninguno" si preferís no decirlo)`);
}

async function pedirMotivo(medicoPhone, numero, textoOriginal, datos, medico) {
  const motivo = textoOriginal.trim().toLowerCase() === "ninguno" ? "" : textoOriginal.trim();

  let cita;
  try {
    cita = await crearCitaConfirmada({
      medicoPhone, medico, pacienteTelefono: numero, pacienteNombre: datos.pacienteNombre,
      fecha: new Date(datos.horaElegida), motivo, origen: "whatsapp",
    });
  } catch (e) {
    // Entre que se eligió el horario (elegirHora) y este paso pasaron varios
    // mensajes (nombre, motivo) — si alguien más se lo llevó mientras tanto,
    // crearCitaConfirmada lo revalida y cae acá en vez de cortar la
    // conversación con un error sin respuesta.
    if (e.horarioOcupado) {
      await limpiarSesion(numero);
      return comoTexto("Ups, justo se ocupó ese horario mientras conversábamos. Escribí cualquier cosa para volver a ver los días disponibles.");
    }
    throw e;
  }

  await limpiarSesion(numero);
  return comoTexto(`✅ Listo, tu cita quedó confirmada para el ${formatearFechaCompleta(cita.fecha, medico?.zonaHoraria)}. Te esperamos.\n\nSi necesitás cancelarla, escribí "cancelar" en cualquier momento.`);
}

async function iniciarCancelacion(medicoPhone, numero) {
  const cita = await Cita.findOne({ medicoPhone, pacienteTelefono: numero, estado: "confirmada", fecha: { $gte: new Date() } }).sort({ fecha: 1 });
  // Esta es la única del flujo que no recibe el médico ya cargado, así que
  // acá sí hay que preguntar la zona.
  const zona = await zonaDelMedico(medicoPhone);
  if (!cita) {
    await limpiarSesion(numero);
    return comoTexto("No encontré ninguna cita próxima a tu nombre. Si querés agendar una, escribí cualquier cosa.");
  }
  await guardarSesion(numero, "confirmar_cancelacion", { medicoPhone, citaId: String(cita._id) });
  return comoBotones(
    `Tenés una cita para el ${formatearFechaCompleta(cita.fecha, zona)}. ¿Confirmás que querés cancelarla?`,
    [{ id: "si_cancelar", title: "Sí, cancelar" }, { id: "no_cancelar", title: "No" }],
  );
}

async function confirmarCancelacion(medicoPhone, numero, t, texto, datos, medico) {
  const esSi = t === "si_cancelar" || t === "si" || t === "sí";
  const esNo = t === "no_cancelar" || t === "no";
  if (!esSi && !esNo) {
    const desvio = await intentarDesvioLibre(medicoPhone, numero, texto, medico);
    if (desvio?.tipo === "respuesta") return comoTexto(`${desvio.texto}\n\n¿Confirmás que querés cancelar tu cita?`);
  }
  if (!esSi) {
    await limpiarSesion(numero);
    return comoTexto("Ok, no cancelé nada.");
  }
  const cita = await Cita.findById(datos.citaId);
  if (cita) {
    cita.estado = "cancelada";
    await cita.save();
    if (medico?.googleCalendarId && cita.googleEventId) {
      await eliminarEvento(medico.googleCalendarId, cita.googleEventId);
    }
  }
  await limpiarSesion(numero);
  return comoTexto("Listo, cancelé tu cita. Si querés agendar otra, escribí cualquier cosa.");
}

module.exports = { procesarMensajeEntrante, formatearFechaCompleta, resumenHistorialPaciente };
