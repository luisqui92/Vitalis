// Vitalis — Reserva de citas por WhatsApp: conversación guiada con listas y
// botones interactivos de la API oficial de Meta (no texto numerado — eso
// era necesario con Baileys/texto plano, la API de Meta permite algo más
// prolijo). Sigue siendo una máquina de estados (no IA libre): para algo
// tan estructurado como elegir un turno, es más confiable que dejar que el
// paciente escriba libre y una IA interprete la fecha/hora.
const { Medico, Cita, SesionCitaWA } = require("../db/models");
const { obtenerHorariosDisponibles, horarioSigueLibre } = require("./agenda");
const { eliminarEvento } = require("./googleCalendar");
const { enrutarMensaje } = require("./asistenteWhatsapp");
const { crearCitaConfirmada } = require("./crearCita");
const { CONFIG, log } = require("../config");

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
function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/La_Paz" });
}
function formatearFechaCompleta(fecha) {
  return new Date(fecha).toLocaleString("es-BO", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/La_Paz" });
}

// ─── Helpers para armar la respuesta (el webhook decide con qué función de
// services/metaWhatsapp.js mandarla, según "tipo") ────────────────────────
function comoTexto(texto) { return { tipo: "texto", texto }; }
function comoBotones(texto, botones) { return { tipo: "botones", texto, botones }; }
function comoLista(texto, textoBoton, filas) { return { tipo: "lista", texto, textoBoton, filas }; }

async function obtenerSesion(numero) {
  const doc = await SesionCitaWA.findOne({ numero }).lean();
  return doc || { numero, paso: "inicio", datos: {} };
}
async function guardarSesion(numero, paso, datos) {
  await SesionCitaWA.findOneAndUpdate({ numero }, { paso, datos }, { upsert: true });
}
async function limpiarSesion(numero) {
  await SesionCitaWA.deleteOne({ numero });
}

async function procesarMensajeEntrante(numero, texto, nombrePerfil) {
  const medicoPhone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE;
  if (!medicoPhone) return comoTexto("Este número todavía no está configurado. Avisale a la clínica.");
  const medico = await Medico.findOne({ phone: medicoPhone }).lean();
  if (!medico) return comoTexto("Este número todavía no está configurado. Avisale a la clínica.");

  const sesion = await obtenerSesion(numero);
  const t = texto.trim().toLowerCase();

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
async function intentarDesvioLibre(texto, medico) {
  try {
    const { intencion, respuesta } = await enrutarMensaje(texto, medico);
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
    const { intencion, respuesta } = await enrutarMensaje(texto, medico);
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
  await guardarSesion(numero, "elegir_dia", { dias: diasMostrados });
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

function listaDeHorarios(dia) {
  const slots = dia.slots.slice(0, 10);
  return comoLista(
    `Horarios para el ${formatearDiaCorto(dia.fecha)}:`,
    "Ver horarios",
    slots.map((s, i) => ({ id: `hora_${i}`, title: formatearHora(s) })),
  );
}

async function elegirDia(medicoPhone, numero, t, texto, datos, medico) {
  const idx = t.startsWith("dia_") ? parseInt(t.slice(4), 10) : NaN;
  const dia = Number.isInteger(idx) ? datos.dias?.[idx] : null;
  if (!dia) {
    const desvio = await intentarDesvioLibre(texto, medico);
    if (desvio?.tipo === "respuesta") return comoTexto(`${desvio.texto}\n\nCuando quieras, elegí un día de la lista para seguir con tu cita.`);
    if (desvio?.tipo === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    return comoTexto("Elegí uno de los días de la lista de arriba para seguir con tu cita (o escribí qué necesitás).");
  }
  await guardarSesion(numero, "elegir_hora", { ...datos, diaElegido: dia });
  return listaDeHorarios(dia);
}

async function elegirHora(medicoPhone, numero, t, texto, datos, medico) {
  const idx = t.startsWith("hora_") ? parseInt(t.slice(5), 10) : NaN;
  const slot = Number.isInteger(idx) ? datos.diaElegido?.slots?.[idx] : null;
  if (!slot) {
    const desvio = await intentarDesvioLibre(texto, medico);
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
    const lista = listaDeHorarios(diaActualizado);
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
  return comoTexto(`✅ Listo, tu cita quedó confirmada para el ${formatearFechaCompleta(cita.fecha)}. Te esperamos.\n\nSi necesitás cancelarla, escribí "cancelar" en cualquier momento.`);
}

async function iniciarCancelacion(medicoPhone, numero) {
  const cita = await Cita.findOne({ medicoPhone, pacienteTelefono: numero, estado: "confirmada", fecha: { $gte: new Date() } }).sort({ fecha: 1 });
  if (!cita) {
    await limpiarSesion(numero);
    return comoTexto("No encontré ninguna cita próxima a tu nombre. Si querés agendar una, escribí cualquier cosa.");
  }
  await guardarSesion(numero, "confirmar_cancelacion", { citaId: String(cita._id) });
  return comoBotones(
    `Tenés una cita para el ${formatearFechaCompleta(cita.fecha)}. ¿Confirmás que querés cancelarla?`,
    [{ id: "si_cancelar", title: "Sí, cancelar" }, { id: "no_cancelar", title: "No" }],
  );
}

async function confirmarCancelacion(medicoPhone, numero, t, texto, datos, medico) {
  const esSi = t === "si_cancelar" || t === "si" || t === "sí";
  const esNo = t === "no_cancelar" || t === "no";
  if (!esSi && !esNo) {
    const desvio = await intentarDesvioLibre(texto, medico);
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

module.exports = { procesarMensajeEntrante, formatearFechaCompleta };
