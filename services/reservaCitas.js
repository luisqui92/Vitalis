// Symphomed — Reserva de citas por WhatsApp: conversación guiada con listas y
// botones interactivos de la API oficial de Meta (no texto numerado — eso
// era necesario con Baileys/texto plano, la API de Meta permite algo más
// prolijo). Sigue siendo una máquina de estados (no IA libre): para algo
// tan estructurado como elegir un turno, es más confiable que dejar que el
// paciente escriba libre y una IA interprete la fecha/hora.
const { Medico, Cita, SesionCitaWA, Paciente, ConsultaMedica, Vacuna, Medicamento, Interesado } = require("../db/models");
const { obtenerHorariosDisponibles, horarioSigueLibre, duracionDe } = require("./agenda");
const { eliminarEvento } = require("./googleCalendar");
const { enrutarMensaje } = require("./asistenteWhatsapp");
const { atenderMedico, precios } = require("./asistenteVentas");
const monedas = require("./monedas");
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

// Si alguien quedó a mitad de una conversación (se distrajo, cerró
// WhatsApp) y no volvió a escribir en media hora, el próximo mensaje arranca
// de cero, con la pregunta de médico o paciente.
//
// Antes eran 2 minutos, y era parte del problema de «el bot responde
// cualquier cosa»: el paciente leía la lista de horarios, la pensaba, tocaba
// uno a los tres minutos… y el bot ya lo había olvidado. Con menús de
// botones, retomar donde estaba es lo que se espera; y si quiere empezar de
// nuevo, escribe «menú».
const SESION_MINUTOS_EXPIRA = 30;

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
  // Ya no lleva la fila «Soy médico»: a esta lista se llega DESPUÉS de tocar
  // «Soy paciente» (ver menuInicio()).
  return comoLista("¿Qué consultorio estás buscando?", "Ver consultorios", filas);
}

async function elegirEspecialidad(numero, t, datos) {
  const idx = t.startsWith("esp_") ? parseInt(t.slice(4), 10) : NaN;
  const opcion = Number.isInteger(idx) ? datos.opciones?.[idx] : null;
  if (!opcion) return comoTexto("Elegí una de las opciones de la lista de arriba para continuar.");
  const medico = await Medico.findOne({ phone: opcion.phone }).lean();
  if (!medico) return comoTexto("Ups, ese consultorio ya no está disponible. Escribí «menú» para ver las opciones de nuevo.");
  return menuPaciente(numero, medico);
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
  const idioma = interesado?.idioma || idiomaDelNumero(numero);

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

  await Interesado.findOneAndUpdate({ numero }, { $set: datos, $setOnInsert: { numero, idioma } }, { upsert: true });

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

// ═══ PRIMERO SE PREGUNTA: ¿MÉDICO O PACIENTE? ══════════════════════════════
//
// El mismo número atiende a los dos. Hasta ahora la separación la adivinaba
// el bot —si el mensaje decía «Symphomed», médico; si no, paciente— y la IA
// corregía. En la prueba real se equivocaba seguido y contestaba cualquier
// cosa: un «hola» caía en la reserva, una pregunta de un médico en la agenda
// de un consultorio.
//
// Ahora se pregunta, con dos botones. Cuesta un toque y no se equivoca. Y de
// ahí cada rama sigue con botones: la IA queda SOLO para cuando la persona
// hace una pregunta abierta, que es lo único que un botón no resuelve.
//
// Lo que se sigue reconociendo sin preguntar: el texto de los botones de
// symphomed.com («…demostración de Symphomed»). Ese médico ya dijo quién es.
//
// Los ids de los botones se atienden estén donde estén: alguien puede tocar
// un botón de un mensaje de hace una hora, cuando la sesión ya venció, y eso
// tiene que funcionar igual.

// Brasil escribe en portugués. Se decide por el número porque es lo único que
// se sabe antes de que la persona escriba nada útil.
function idiomaDelNumero(numero) {
  return String(numero || "").startsWith("55") ? "pt" : "es";
}

const TEXTOS_MENU = {
  es: {
    inicio: "¡Hola! 👋 Este es el WhatsApp de Symphomed. Para ayudarte mejor, ¿quién nos escribe?",
    inicioOtraVez: "Tocá una de las dos opciones 👇",
    soyMedico: "🩺 Soy médico",
    soyPaciente: "🙋 Soy paciente",
    menuMedico: "¡Qué bueno tenerlo por acá! ¿En qué le ayudamos?",
    menuMedicoOtraVez: "Hola de nuevo. ¿En qué le ayudamos?",
    verDemo: "Ver una demo",
    precios: "Precios",
    yaCliente: "Ya uso Symphomed",
    otraPregunta: "Otra pregunta",
    demoSinEspecialidad: "Perfecto, le escribimos hoy mismo para coordinar la demostración: son quince minutos con un caso real. ¿De qué especialidad es su consultorio?",
    demoConEspecialidad: (esp) => `Perfecto, le escribimos hoy mismo para coordinar la demostración: son quince minutos y se la mostramos con casos de ${esp}. ¿En qué horario le queda mejor que lo llamemos?`,
    preguntaMedico: "Claro, cuénteme qué quiere saber.",
    textoPrecios: (p) => `Consulta suelta: ${p.consulta}. Plan mensual: ${p.mensual}, que conviene desde ${p.consultasDelPlan} consultas al mes. Plan anual: ${p.anual}, doce meses al precio de once. Las primeras ${p.gratis} consultas no se cobran y no hay costo de instalación ni permanencia.`,
    soporte: "¡Hola de nuevo! Cuéntenos en un mensaje qué necesita y se lo pasamos al equipo.",
    soporteRecibido: "Recibido. Lo revisa una persona del equipo y le escribimos por acá. Si es urgente, mándenos un audio contando qué pasa.",
  },
  pt: {
    inicio: "Olá! 👋 Este é o WhatsApp do Symphomed. Para te ajudar melhor, quem está escrevendo?",
    inicioOtraVez: "Toque em uma das duas opções 👇",
    soyMedico: "🩺 Sou médico",
    soyPaciente: "🙋 Sou paciente",
    menuMedico: "Que bom ter você por aqui! Como podemos ajudar?",
    menuMedicoOtraVez: "Olá de novo. Como podemos ajudar?",
    verDemo: "Ver uma demo",
    precios: "Preços",
    yaCliente: "Já uso o Symphomed",
    otraPregunta: "Outra pergunta",
    demoSinEspecialidad: "Perfeito, escrevemos hoje mesmo para combinar a demonstração: são quinze minutos com um caso real. Qual é a especialidade do seu consultório?",
    demoConEspecialidad: (esp) => `Perfeito, escrevemos hoje mesmo para combinar a demonstração: são quinze minutos, com casos de ${esp}. Qual horário é melhor para ligarmos?`,
    preguntaMedico: "Claro, conte o que você quer saber.",
    textoPrecios: (p) => `Consulta avulsa: ${p.consulta}. Plano mensal: ${p.mensual}, que compensa a partir de ${p.consultasDelPlan} consultas por mês. Plano anual: ${p.anual}, doze meses pelo preço de onze. As primeiras ${p.gratis} consultas não são cobradas e não há custo de instalação nem fidelidade.`,
    soporte: "Olá de novo! Conte em uma mensagem o que você precisa e passamos para a equipe.",
    soporteRecibido: "Recebido. Uma pessoa da equipe vai ver e te responde por aqui. Se for urgente, mande um áudio contando o que aconteceu.",
  },
};

const PALABRAS_MENU = new Set(["menu", "menú", "inicio", "volver", "empezar", "reiniciar", "0", "menu_inicio"]);

function botonesRol(idioma) {
  const T = TEXTOS_MENU[idioma];
  return [{ id: "rol_medico", title: T.soyMedico }, { id: "rol_paciente", title: T.soyPaciente }];
}

async function menuInicio(numero, { otraVez = false } = {}) {
  const idioma = idiomaDelNumero(numero);
  await guardarSesion(numero, "elegir_rol", {});
  return comoBotones(otraVez ? TEXTOS_MENU[idioma].inicioOtraVez : TEXTOS_MENU[idioma].inicio, botonesRol(idioma));
}

// ─── Rama médico ───────────────────────────────────────────────────────────

function botonesMedico(idioma, { sinPrecios = false } = {}) {
  const T = TEXTOS_MENU[idioma];
  return [
    { id: "med_demo", title: T.verDemo },
    sinPrecios ? { id: "med_pregunta", title: T.otraPregunta } : { id: "med_precios", title: T.precios },
    { id: "med_cliente", title: T.yaCliente },
  ];
}

async function menuMedico(numero, { otraVez = false } = {}) {
  const idioma = idiomaDelNumero(numero);
  await guardarSesion(numero, "medico_menu", {});
  const T = TEXTOS_MENU[idioma];
  return comoBotones(otraVez ? T.menuMedicoOtraVez : T.menuMedico, botonesMedico(idioma));
}

// El interesado se guarda desde que toca un botón de la rama médico, no solo
// cuando pide la demo: el que mira el precio y se va también es alguien a
// quien llamar.
async function registrarInteresado(numero, nombrePerfil, cambios = {}) {
  const idioma = idiomaDelNumero(numero);
  const previo = await Interesado.findOne({ numero }).lean();
  const datos = { ultimoMensaje: new Date(), ...cambios };
  // Solo sube de "nuevo" a "interesado". Nunca pisa "contactado" ni
  // "descartado": eso lo puso una persona y el bot no lo revisa.
  if (cambios.estado === "interesado" && previo && !["nuevo", "interesado"].includes(previo.estado)) delete datos.estado;
  const alta = { numero, idioma };
  if (nombrePerfil) alta.nombre = nombrePerfil;
  return Interesado.findOneAndUpdate({ numero }, { $set: datos, $setOnInsert: alta }, { upsert: true, new: true }).lean();
}

async function pedirDemo(numero, nombrePerfil) {
  const idioma = idiomaDelNumero(numero);
  const T = TEXTOS_MENU[idioma];
  const i = await registrarInteresado(numero, nombrePerfil, { estado: "interesado" });
  const respuesta = i.especialidad ? T.demoConEspecialidad(i.especialidad) : T.demoSinEspecialidad;
  // Lo que sigue (la especialidad, el horario) es texto libre: lo atiende la
  // conversación con la IA de ventas, que ya sabe preguntar sin repetir.
  await guardarSesion(numero, "medico", { historial: [{ de: "bot", texto: respuesta }], actualizada: new Date() });
  log.error(`[VENTAS] 🔔 MÉDICO PIDIÓ DEMO — ${numero} · ${i.nombre || "sin nombre"} · ${i.especialidad || "especialidad?"}`);
  return comoTexto(respuesta);
}

async function mostrarPrecios(numero, nombrePerfil) {
  const idioma = idiomaDelNumero(numero);
  await registrarInteresado(numero, nombrePerfil);
  await guardarSesion(numero, "medico_menu", {});
  // Los números salen de las mismas funciones que cobran (asistenteVentas.
  // precios), no de un texto escrito acá: si cambia el precio, cambia esto.
  const p = precios(monedas.monedaSegunIdioma(idioma));
  return comoBotones(TEXTOS_MENU[idioma].textoPrecios(p), botonesMedico(idioma, { sinPrecios: true }));
}

// «Ya uso Symphomed»: un cliente con un problema no tiene que pasar por el
// vendedor. Su mensaje queda anotado y se avisa en el log de errores, que es
// donde se mira lo que importa.
async function recibirSoporte(numero, texto, nombrePerfil) {
  const idioma = idiomaDelNumero(numero);
  const previo = await Interesado.findOne({ numero }).select("conversacion").lean();
  const conversacion = [...(previo?.conversacion || []), { de: "medico", texto: `[SOPORTE] ${texto}` }].slice(-MAX_HISTORIAL);
  await registrarInteresado(numero, nombrePerfil, { conversacion, soportePendiente: true });
  await limpiarSesion(numero);
  log.error(`[SOPORTE] 🔔 CLIENTE PIDE AYUDA — ${numero} · ${nombrePerfil || "sin nombre"}: ${String(texto).slice(0, 300)}`);
  return comoTexto(TEXTOS_MENU[idioma].soporteRecibido);
}

// ─── Rama paciente ─────────────────────────────────────────────────────────

const BOTONES_PACIENTE = [
  { id: "pac_reservar", title: "📅 Reservar cita" },
  { id: "pac_cancelar", title: "❌ Cancelar mi cita" },
  { id: "pac_pregunta", title: "❓ Tengo una duda" },
];

// El consultorio con el que habla el paciente: el que eligió de la lista (súper
// número) o el único configurado.
function medicoDelPaciente(sesion) {
  const superNumero = CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.length > 0;
  return sesion.datos?.medicoPhone || (!superNumero ? CONFIG.SALUD_WHATSAPP_MEDICO_PHONE : null) || null;
}

async function empezarComoPaciente(numero, sesion) {
  const medicoPhone = medicoDelPaciente(sesion);
  if (medicoPhone) {
    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    if (medico) return menuPaciente(numero, medico);
  }
  if (CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.length > 0) return mostrarEspecialidades(numero);
  await limpiarSesion(numero);
  return comoTexto("Por ahora este número no toma reservas de pacientes. Si buscás a tu médico, escribile a su WhatsApp directo. 🙏");
}

async function menuPaciente(numero, medico, { encabezado } = {}) {
  await guardarSesion(numero, "paciente_menu", { medicoPhone: medico.phone });
  const nombre = medico.nombre ? ` de ${medico.nombre}` : "";
  return comoBotones(encabezado || `Consultorio${nombre}. ¿Qué necesitás?`, BOTONES_PACIENTE);
}

// Una pregunta abierta del paciente: acá SÍ entra la IA, que responde solo con
// lo que el consultorio cargó (asistenteWhatsapp.js). Si en realidad quiere
// reservar o cancelar, se lo lleva ahí.
async function responderPreguntaPaciente(numero, texto, medico) {
  let r = null;
  try {
    const historial = await resumenHistorialPaciente(medico.phone, numero);
    r = await enrutarMensaje(texto, medico, historial);
  } catch (e) {
    log.error("[RESERVA_CITAS] enrutarMensaje (pregunta) falló:", e.message);
  }
  if (r?.intencion === "agendar") return iniciarReserva(medico.phone, numero);
  if (r?.intencion === "cancelar") return iniciarCancelacion(medico.phone, numero);
  const respuesta = r?.intencion === "pregunta" && r.respuesta
    ? r.respuesta
    : "No tengo esa información a mano; el consultorio te la confirma directo.";
  await guardarSesion(numero, "paciente_menu", { medicoPhone: medico.phone });
  return comoBotones(`${respuesta}\n\n¿Algo más?`, [
    { id: "pac_reservar", title: "📅 Reservar cita" },
    { id: "pac_pregunta", title: "❓ Otra pregunta" },
    { id: "menu_inicio", title: "🏠 Menú" },
  ]);
}

async function procesarMensajeEntrante(numero, texto, nombrePerfil) {
  const sesion = await obtenerSesion(numero);
  const t = texto.trim().toLowerCase();

  // «menú» desde cualquier lado vuelve al principio.
  if (PALABRAS_MENU.has(t)) return menuInicio(numero);

  // ─── Los botones, estén donde estén ───────────────────────────────────
  if (t === "rol_medico" || t === "soy_medico") return menuMedico(numero);
  if (t === "rol_paciente") return empezarComoPaciente(numero, sesion);
  if (t === "med_demo") return pedirDemo(numero, nombrePerfil);
  if (t === "med_precios") return mostrarPrecios(numero, nombrePerfil);
  if (t === "med_pregunta") {
    await guardarSesion(numero, "medico", { historial: sesion.datos?.historial || [], actualizada: new Date() });
    return comoTexto(TEXTOS_MENU[idiomaDelNumero(numero)].preguntaMedico);
  }
  if (t === "med_cliente") {
    await guardarSesion(numero, "soporte", {});
    return comoTexto(TEXTOS_MENU[idiomaDelNumero(numero)].soporte);
  }
  if (t.startsWith("pac_")) {
    const medicoPhone = medicoDelPaciente(sesion);
    const medico = medicoPhone ? await Medico.findOne({ phone: medicoPhone }).lean() : null;
    if (!medico) return empezarComoPaciente(numero, sesion);
    if (t === "pac_reservar") return iniciarReserva(medico.phone, numero);
    if (t === "pac_cancelar") return iniciarCancelacion(medico.phone, numero);
    if (t === "pac_pregunta") {
      await guardarSesion(numero, "pregunta", { medicoPhone: medico.phone });
      return comoTexto("Claro, escribime tu pregunta 👇");
    }
  }

  // ─── Según dónde quedó la conversación ────────────────────────────────
  switch (sesion.paso) {
    case "medico": {
      const r = await atenderComoMedico(numero, texto, sesion, nombrePerfil);
      if (r) return r;
      // La IA de ventas dice que en realidad es un paciente: a su rama.
      return empezarComoPaciente(numero, { datos: {} });
    }
    case "medico_menu":
      // Escribió en vez de tocar: es una pregunta para ventas.
      return (await atenderComoMedico(numero, texto, { paso: "medico", datos: { historial: [] } }, nombrePerfil))
        || empezarComoPaciente(numero, { datos: {} });
    case "soporte":
      return recibirSoporte(numero, texto, nombrePerfil);
    case "elegir_rol":
      return menuInicio(numero, { otraVez: true });
    case "elegir_especialidad":
      return elegirEspecialidad(numero, t, sesion.datos);
  }

  // El texto de los botones de symphomed.com: ese médico ya dijo quién es.
  if (esConsultaDeMedico(t)) {
    const r = await atenderComoMedico(numero, texto, sesion, nombrePerfil);
    if (r) return r;
  }

  const medicoPhone = sesion.datos?.medicoPhone;
  const medico = medicoPhone ? await Medico.findOne({ phone: medicoPhone }).lean() : null;

  if (!medico) {
    // Conversación nueva. Un médico que ya dejó sus datos y todavía nadie
    // llamó no tiene por qué contestar de nuevo si es médico.
    if (await saludoDeUnInteresado(numero, t)) return menuMedico(numero, { otraVez: true });
    return menuInicio(numero);
  }

  if (t === "cancelar" || t === "cancelar cita") return iniciarCancelacion(medicoPhone, numero);

  switch (sesion.paso) {
    case "paciente_menu":
    case "pregunta":
      return responderPreguntaPaciente(numero, texto, medico);
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
      return menuPaciente(numero, medico);
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
  const libre = await horarioSigueLibre(medicoPhone, slot, duracionDe(medico.duracionConsultaMinutos));
  if (!libre) {
    // Se re-arma la lista de ese mismo día por si sigue teniendo otros
    // horarios libres, en vez de mandar al paciente de vuelta al principio.
    const diasActualizados = await obtenerHorariosDisponibles(medicoPhone, 21);
    const diaActualizado = diasActualizados.find(d => d.fecha === datos.diaElegido?.fecha);
    if (!diaActualizado) return comoTexto("Ups, ese horario se acaba de ocupar y no quedan más libres ese día. Escribí «menú» para ver los días de nuevo.");
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
      return comoTexto("Ups, justo se ocupó ese horario mientras conversábamos. Escribí «menú» para volver a empezar.");
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
    return comoTexto("No encontré ninguna cita próxima a tu nombre. Si querés agendar una, escribí «menú».");
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
  return comoTexto("Listo, cancelé tu cita. Si querés agendar otra, escribí «menú».");
}

module.exports = { procesarMensajeEntrante, formatearFechaCompleta, resumenHistorialPaciente };
