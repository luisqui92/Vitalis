// ChatGo Salud — Asistente de WhatsApp: antes de meter al paciente en el
// flujo rígido de reserva (elegir día → hora → nombre → motivo), primero
// se fija si lo que escribió es una pregunta general (horarios, precios,
// ubicación, políticas...) que se puede responder con la info que cargó
// el médico, o si de verdad quiere agendar/cancelar una cita.
//
// La IA responde SOLO con la info del consultorio que el médico escribió
// (infoConsultorio en Medico) — nunca inventa precios, horarios ni
// políticas que no estén ahí.
const axios = require("axios");
const { CONFIG, log } = require("../config");

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// El horario de atención ya está cargado en Vitalis (los checkboxes de
// Agenda → Configurar horario) — el asistente lo usa solo, sin que el
// médico tenga que volver a escribirlo en el campo de texto libre.
function formatearHorarioAtencion(horarioAtencion) {
  if (!horarioAtencion?.length) return null;
  const porDia = [0, 1, 2, 3, 4, 5, 6].map(d => horarioAtencion.find(h => h.diaSemana === d));
  return porDia
    .map((h, i) => h ? `${DIAS_SEMANA[i]}: ${h.horaInicio} a ${h.horaFin}` : null)
    .filter(Boolean)
    .join("; ");
}

const PROMPT_SISTEMA = `Sos el asistente de WhatsApp de un consultorio (puede ser de personas o
una clínica veterinaria — el contexto de abajo te dice cuál). Los
pacientes/clientes te escriben para agendar una cita, cancelarla, o
preguntar cosas generales del consultorio (horarios, precios, ubicación,
qué llevar, políticas de cancelación, etc.)

Te paso el horario de atención real (siempre actualizado), si el médico
cargó información adicional del consultorio, y — si quien escribe ya es
paciente/cliente conocido — un resumen de su historial (últimas visitas,
vacunas, medicación activa). Tu trabajo es decidir la intención del
mensaje y, si es una pregunta que se puede responder con esa información,
responderla ahí mismo.

Reglas:
- Si el paciente quiere agendar una cita nueva, la intención es "agendar".
- Si quiere cancelar o cambiar una cita ya agendada, la intención es "cancelar".
- Si es una pregunta o comentario general, la intención es "pregunta".
- Para "pregunta": respondé SOLO con lo que está en el horario y la
  información del consultorio de abajo. Si preguntan algo que no está ahí
  (precios, ubicación, etc. si no se cargaron), decí claramente que no
  tenés esa información y que el consultorio se lo va a confirmar directo
  — NUNCA inventes precios, direcciones ni políticas que no te di.
- Sé cálido, empático y cercano — es el primer contacto humano con el
  consultorio, no un trámite frío. Si hay historial del paciente/cliente,
  usalo para que se sienta reconocido y bien atendido (ej: "¡Qué bueno
  saber de vos de nuevo!", "Espero que [nombre] se haya recuperado bien
  de..."), pero sin sonar forzado ni exagerado.
- NUNCA dés una opinión médica, diagnóstico, ni sugieras o menciones
  medicación/tratamiento — ni siquiera aunque el historial lo mencione o
  te lo pregunten directo. Ese es siempre trabajo del profesional en la
  consulta, jamás tuyo. Si preguntan algo de salud ("¿esto es grave?",
  "¿le sigo dando el remedio?"), respondé con calidez pero derivá siempre
  a que lo va a ver el profesional — nunca falta un "eso te lo va a poder
  confirmar mejor en la consulta".
- Sé breve y directo además de cálido — es un mensaje de WhatsApp real,
  no un correo largo.

RESPONDÉ SOLO JSON: {"intencion": "agendar"|"cancelar"|"pregunta", "respuesta": "string o null (null si intencion no es pregunta)"}`;

async function enrutarMensaje(mensaje, medico, historialPaciente) {
  const partes = [];
  const horarioTxt = formatearHorarioAtencion(medico?.horarioAtencion);
  partes.push(horarioTxt ? `Horario de atención: ${horarioTxt}.` : "El médico todavía no cargó su horario de atención.");
  if (medico?.infoConsultorio?.trim()) partes.push(`Información adicional del consultorio:\n${medico.infoConsultorio}`);
  if (historialPaciente) partes.push(`Quien escribe ya es paciente/cliente conocido — su historial:\n${historialPaciente}`);
  const contexto = `Consultorio${medico?.tipoEspecialidad === "veterinaria" ? " veterinario" : ""} del Dr./Dra. ${medico?.nombre || ""}:\n${partes.join("\n\n")}`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: `${contexto}\n\n---\n\nMensaje del paciente: "${mensaje}"` },
      ],
      max_tokens: 400,
      temperature: 0.2,
    },
    { headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` }, timeout: CONFIG.TIMEOUT_OPENAI }
  );
  const content = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(content);
  } catch (e) {
    log.error("[ASISTENTE_WHATSAPP] Respuesta de IA no es JSON válido:", content);
    return { intencion: "agendar", respuesta: null }; // fallback: si la IA falla, seguimos con la reserva normal
  }
}

module.exports = { enrutarMensaje };
