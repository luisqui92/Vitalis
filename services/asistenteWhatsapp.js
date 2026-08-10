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

const PROMPT_SISTEMA = `Sos el asistente de WhatsApp de un consultorio médico. Los pacientes te
escriben para agendar una cita, cancelarla, o preguntar cosas generales
del consultorio (horarios, precios, ubicación, qué llevar, políticas de
cancelación, etc.)

Te paso el horario de atención real (siempre actualizado) y, si el médico
la cargó, información adicional del consultorio. Tu trabajo es decidir la
intención del mensaje y, si es una pregunta que se puede responder con esa
información, responderla ahí mismo.

Reglas:
- Si el paciente quiere agendar una cita nueva, la intención es "agendar".
- Si quiere cancelar o cambiar una cita ya agendada, la intención es "cancelar".
- Si es una pregunta o comentario general, la intención es "pregunta".
- Para "pregunta": respondé SOLO con lo que está en el horario y la
  información del consultorio de abajo. Si preguntan algo que no está ahí
  (precios, ubicación, etc. si no se cargaron), decí claramente que no
  tenés esa información y que el consultorio se lo va a confirmar directo
  — NUNCA inventes precios, direcciones ni políticas que no te di.
- Sé breve, cálido y directo, como un mensaje de WhatsApp real.

RESPONDÉ SOLO JSON: {"intencion": "agendar"|"cancelar"|"pregunta", "respuesta": "string o null (null si intencion no es pregunta)"}`;

async function enrutarMensaje(mensaje, medico) {
  const partes = [];
  const horarioTxt = formatearHorarioAtencion(medico?.horarioAtencion);
  partes.push(horarioTxt ? `Horario de atención: ${horarioTxt}.` : "El médico todavía no cargó su horario de atención.");
  if (medico?.infoConsultorio?.trim()) partes.push(`Información adicional del consultorio:\n${medico.infoConsultorio}`);
  const contexto = `Consultorio del Dr./Dra. ${medico?.nombre || ""}:\n${partes.join("\n\n")}`;

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
