// ChatGo Salud — Reserva de citas por WhatsApp: conversación guiada con
// opciones numeradas (no IA libre) — para algo tan estructurado como elegir
// un turno, una máquina de estados es más confiable que dejar que el
// paciente escriba libre y una IA interprete la fecha/hora.
const { Medico, Cita, SesionCitaWA } = require("../db/models");
const { obtenerHorariosDisponibles, horarioSigueLibre } = require("./agenda");
const { eliminarEvento } = require("./googleCalendar");
const { enrutarMensaje } = require("./asistenteWhatsapp");
const { crearCitaConfirmada } = require("./crearCita");
const { generarToken } = require("./auth");
const { CONFIG, log } = require("../config");

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function formatearDia(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  return `${DIAS_SEMANA[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}
function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function formatearFechaCompleta(fecha) {
  return new Date(fecha).toLocaleString("es-BO", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

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

async function procesarMensajeEntrante(numero, texto, nombrePerfil, jid) {
  const medicoPhone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE;
  if (!medicoPhone) return "Este número todavía no está configurado. Avisale a la clínica.";
  const medico = await Medico.findOne({ phone: medicoPhone }).lean();
  if (!medico) return "Este número todavía no está configurado. Avisale a la clínica.";

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
      return manejarMensajeLibre(medicoPhone, numero, texto, medico, jid);
  }
}

// Cuando el paciente está en medio de elegir día/hora o confirmar una
// cancelación y escribe algo que NO es la opción esperada, puede ser que
// simplemente esté preguntando algo ("¿qué días atienden?") en vez de estar
// perdido — antes eso siempre caía en un seco "no entendí". Antes de darnos
// por vencidos, probamos con la misma IA que ya usa el mensaje inicial:
// si reconoce una pregunta respondible con la info del consultorio, la
// responde ahí mismo (sin sacar al paciente del paso en el que estaba); si
// reconoce que quiere cancelar, lo manda a ese flujo. Si no es ninguna de
// las dos, seguimos con el "no entendí" de siempre.
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
// quiere agendar — recién ahí arranca el flujo de horarios numerados.
async function manejarMensajeLibre(medicoPhone, numero, texto, medico, jid) {
  try {
    const { intencion, respuesta } = await enrutarMensaje(texto, medico);
    if (intencion === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    if (intencion === "pregunta" && respuesta) return respuesta;
  } catch (e) {
    log.error("[RESERVA_CITAS] enrutarMensaje falló, sigo con la reserva normal:", e.message);
  }
  return iniciarReserva(medicoPhone, numero, jid);
}

// El paciente ve la disponibilidad real en un calendario propio (más claro
// que contar días en una lista de texto) — el link tiene el JID de
// WhatsApp del paciente firmado adentro (mismo mecanismo que ya usa el
// login de médicos), vence solo, y no hace falta guardar sesión acá: toda
// la elección de día/hora/nombre pasa en esa página, en un solo POST final.
// Se firma el JID completo (no solo el número): a veces WhatsApp identifica
// al paciente con un LID en vez del número real, y solo el JID original
// sirve para poder escribirle de vuelta la confirmación más tarde.
async function iniciarReserva(medicoPhone, numero, jid) {
  const dias = await obtenerHorariosDisponibles(medicoPhone, 21);
  if (dias.length === 0) {
    return "Por ahora no tengo horarios disponibles cargados. Comunicate directo con la clínica para coordinar tu cita.";
  }
  const token = generarToken(jid || numero, "reserva_publica", 45 * 60 * 1000);
  const url = `${CONFIG.APP_URL}/reservar.html?token=${token}`;
  return `¡Hola! 👋 Elegí tu horario acá, vas a ver el calendario completo:\n\n${url}\n\n(el link es válido por 45 minutos)\n\nSi querés cancelar una cita ya agendada, escribí "cancelar" en cualquier momento.`;
}

function listaDias(dias) {
  return dias.map((d, i) => `${i + 1}) ${formatearDia(d.fecha)} — ${d.slots.length} horario${d.slots.length === 1 ? "" : "s"} libre${d.slots.length === 1 ? "" : "s"}`).join("\n");
}
function listaHoras(slots) {
  return slots.map((s, i) => `${i + 1}) ${formatearHora(s)}`).join("\n");
}

async function elegirDia(medicoPhone, numero, t, texto, datos, medico) {
  const idx = parseInt(t, 10) - 1;
  const dia = datos.dias?.[idx];
  if (!dia) {
    const desvio = await intentarDesvioLibre(texto, medico);
    if (desvio?.tipo === "respuesta") return `${desvio.texto}\n\nCuando quieras seguí con tu cita, elegí un día:\n\n${listaDias(datos.dias || [])}`;
    if (desvio?.tipo === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    // No es ni un número válido ni algo que la IA haya reconocido (puede
    // ser solo un saludo, "hola") — se re-muestra la lista con un tono
    // amable en vez de un seco "no entendí", que suena a error.
    return `¡Hola! 👋 Para tu cita, elegí un día respondiendo con el número:\n\n${listaDias(datos.dias || [])}`;
  }
  const lineas = dia.slots.map((s, i) => `${i + 1}) ${formatearHora(s)}`);
  await guardarSesion(numero, "elegir_hora", { ...datos, diaElegido: dia });
  return `Horarios para el ${formatearDia(dia.fecha)}:\n\n${lineas.join("\n")}\n\nRespondé con el número del horario que te sirva.`;
}

async function elegirHora(medicoPhone, numero, t, texto, datos, medico) {
  const idx = parseInt(t, 10) - 1;
  const slot = datos.diaElegido?.slots?.[idx];
  if (!slot) {
    const desvio = await intentarDesvioLibre(texto, medico);
    if (desvio?.tipo === "respuesta") return `${desvio.texto}\n\nCuando quieras seguí con tu cita, elegí un horario para el ${formatearDia(datos.diaElegido?.fecha)}:\n\n${listaHoras(datos.diaElegido?.slots || [])}`;
    if (desvio?.tipo === "cancelar") return iniciarCancelacion(medicoPhone, numero);
    return `Para el ${formatearDia(datos.diaElegido?.fecha)}, elegí un horario respondiendo con el número:\n\n${listaHoras(datos.diaElegido?.slots || [])}`;
  }
  const libre = await horarioSigueLibre(medicoPhone, slot, medico.duracionConsultaMinutos || 30);
  if (!libre) return 'Ups, ese horario se acaba de ocupar. Escribí cualquier cosa para ver los horarios disponibles de nuevo.';
  await guardarSesion(numero, "pedir_nombre", { ...datos, horaElegida: slot });
  return "¿A nombre de quién es la cita? Escribí el nombre completo.";
}

async function pedirNombre(numero, textoOriginal, datos) {
  const nombre = textoOriginal.trim();
  if (nombre.length < 2) return "Necesito un nombre válido para la cita.";
  await guardarSesion(numero, "pedir_motivo", { ...datos, pacienteNombre: nombre });
  return `Gracias, ${nombre.split(" ")[0]}. Por último, ¿cuál es el motivo de la consulta? (podés escribir "ninguno" si preferís no decirlo)`;
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
    // conversación con un error sin respuesta (ver services/baileysWhatsapp.js).
    if (e.horarioOcupado) {
      await limpiarSesion(numero);
      return "Ups, justo se ocupó ese horario mientras conversábamos. Escribí cualquier cosa para volver a ver los horarios disponibles.";
    }
    throw e;
  }

  await limpiarSesion(numero);
  return `✅ Listo, tu cita quedó confirmada para el ${formatearFechaCompleta(cita.fecha)}. Te esperamos.\n\nSi necesitás cancelarla, escribí "cancelar" en cualquier momento.`;
}

async function iniciarCancelacion(medicoPhone, numero) {
  const cita = await Cita.findOne({ medicoPhone, pacienteTelefono: numero, estado: "confirmada", fecha: { $gte: new Date() } }).sort({ fecha: 1 });
  if (!cita) {
    await limpiarSesion(numero);
    return "No encontré ninguna cita próxima a tu nombre. Si querés agendar una, escribí cualquier cosa.";
  }
  await guardarSesion(numero, "confirmar_cancelacion", { citaId: String(cita._id) });
  return `Tenés una cita para el ${formatearFechaCompleta(cita.fecha)}. ¿Confirmás que querés cancelarla? Respondé "sí" o "no".`;
}

async function confirmarCancelacion(medicoPhone, numero, t, texto, datos, medico) {
  if (t !== "si" && t !== "sí" && t !== "no") {
    const desvio = await intentarDesvioLibre(texto, medico);
    if (desvio?.tipo === "respuesta") return `${desvio.texto}\n\n¿Confirmás que querés cancelar tu cita? Respondé "sí" o "no".`;
  }
  if (t !== "si" && t !== "sí") {
    await limpiarSesion(numero);
    return "Ok, no cancelé nada.";
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
  return "Listo, cancelé tu cita. Si querés agendar otra, escribí cualquier cosa.";
}

module.exports = { procesarMensajeEntrante, formatearFechaCompleta };
