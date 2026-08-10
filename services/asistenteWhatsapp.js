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

const PROMPT_SISTEMA = `Sos el asistente de WhatsApp de un consultorio médico. Los pacientes te
escriben para agendar una cita, cancelarla, o preguntar cosas generales
del consultorio (horarios, precios, ubicación, qué llevar, políticas de
cancelación, etc.)

Te paso la información real del consultorio (si el médico la cargó). Tu
trabajo es decidir la intención del mensaje y, si es una pregunta que se
puede responder con esa información, responderla ahí mismo.

Reglas:
- Si el paciente quiere agendar una cita nueva, la intención es "agendar".
- Si quiere cancelar o cambiar una cita ya agendada, la intención es "cancelar".
- Si es una pregunta o comentario general, la intención es "pregunta".
- Para "pregunta": respondé SOLO con lo que está en la información del
  consultorio de abajo. Si no tenés esa información, decí claramente que
  no la tenés y que el consultorio se lo va a confirmar directo — NUNCA
  inventes precios, horarios, direcciones ni políticas.
- Sé breve, cálido y directo, como un mensaje de WhatsApp real.

RESPONDÉ SOLO JSON: {"intencion": "agendar"|"cancelar"|"pregunta", "respuesta": "string o null (null si intencion no es pregunta)"}`;

async function enrutarMensaje(mensaje, infoConsultorio, nombreMedico) {
  const contexto = infoConsultorio?.trim()
    ? `Información del consultorio (Dr./Dra. ${nombreMedico || ""}):\n${infoConsultorio}`
    : `El médico todavía no cargó información del consultorio.`;

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
