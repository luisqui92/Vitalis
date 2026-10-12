// ChatGo Salud — Brief Clínico Inteligente: resumen ejecutivo del paciente,
// generado por IA a partir del historial de consultas, para que el médico
// lo lea ANTES de la próxima consulta. Se regenera solo cada vez que se
// completa la nota clínica de una consulta nueva de ese paciente, y otra vez
// cuando el médico la confirma: lo que corrigió tiene que llegar al resumen.
//
// Las notas que el médico todavía no confirmó van marcadas como borrador, y
// la pantalla dice cuántas hubo. Antes entraban igual que las revisadas, y
// el resumen podía repetir un diagnóstico que el médico ya había corregido
// (revisión integral del 11 de octubre de 2026, S03).
const axios = require("axios");
const { CONFIG, log } = require("../config");
const { Paciente, ConsultaMedica } = require("../db/models");

const PROMPT_SISTEMA = `Eres un asistente clínico. A partir del historial de consultas anteriores
de un paciente (en español, ordenadas de la más vieja a la más nueva),
generá un "brief clínico" — un resumen ejecutivo para que el médico lo lea
ANTES de la próxima consulta.

RESPONDE SOLO JSON con esta estructura exacta:
{
  "estadoActual": "resumen breve del estado de salud actual del paciente",
  "cambiosDesdeUltimaConsulta": "qué cambió respecto a la consulta anterior, o null si el historial tiene una sola consulta",
  "medicamentosActivos": ["string", ...],
  "examenesPendientes": ["string", ...],
  "alertas": ["string", ...],
  "factoresRiesgo": ["string", ...],
  "preguntasSugeridas": ["string", ...],
  "diagnosticosDiferenciales": ["string", ...]
}

Reglas:
- Basate SOLO en el historial que te paso. NUNCA inventes datos clínicos que no estén ahí.
- "medicamentosActivos": los recetados en la consulta MÁS RECIENTE (asumí que siguen vigentes salvo que el historial diga lo contrario).
- "examenesPendientes": exámenes solicitados que no tengan resultado mencionado en una consulta posterior.
- Esto es una AYUDA para el médico, nunca reemplaza su criterio profesional — no lo repitas en el texto, pero tenelo presente en el tono (sugerí, no afirmes con certeza absoluta).
- Si el historial tiene una sola consulta, "cambiosDesdeUltimaConsulta" debe ser null.
- Usá arrays vacíos (no null) cuando no aplique una lista.
- Cada consulta dice si el médico ya la revisó. Las marcadas "BORRADOR" las
  escribió una IA a partir del audio y el médico todavía no las confirmó:
  pueden tener errores. Lo que salga SOLO de un borrador no lo afirmes como
  un hecho: agregale "(sin confirmar)". Si un borrador contradice una
  consulta revisada, vale la revisada.`;

function formatearHistorial(consultas) {
  return consultas.map(c => {
    const n = c.notaClinica || {};
    const partes = [`Fecha: ${new Date(c.createdAt).toLocaleDateString("es-BO")}`];
    partes.push(c.confirmadaEn ? "Revisada y confirmada por el médico" : "BORRADOR: el médico todavía no la revisó");
    if (n.motivoConsulta) partes.push(`Motivo: ${n.motivoConsulta}`);
    if (n.sintomas?.length) partes.push(`Síntomas: ${n.sintomas.join(", ")}`);
    if (n.antecedentesRelevantes) partes.push(`Antecedentes: ${n.antecedentesRelevantes}`);
    if (n.diagnostico) partes.push(`Diagnóstico: ${n.diagnostico}`);
    if (n.plan) partes.push(`Plan: ${n.plan}`);
    if (n.medicamentosRecetados?.length) {
      partes.push(`Medicamentos: ${n.medicamentosRecetados.map(m => m.nombre + (m.dosis ? ` ${m.dosis}` : "") + (m.frecuencia ? ` (${m.frecuencia})` : "")).join(", ")}`);
    }
    if (n.examenesSolicitados?.length) partes.push(`Exámenes solicitados: ${n.examenesSolicitados.join(", ")}`);
    if (n.proximoControl) partes.push(`Próximo control: ${n.proximoControl}`);
    return partes.join("\n");
  }).join("\n\n---\n\n");
}

async function generarBrief(historialTexto) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: historialTexto },
      ],
      max_tokens: 900,
      temperature: 0.2,
    },
    { headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` }, timeout: CONFIG.TIMEOUT_OPENAI }
  );
  const content = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  return sanearBrief(JSON.parse(content));
}

// Mismo motivo que sanearNota() en notaClinica.js: paciente.briefClinico
// tiene campos String/[String] estrictos, y la IA puede confundir esta
// forma con la de notaClinica.medicamentosRecetados (que SÍ son objetos
// {nombre,dosis,frecuencia}) — si eso se guarda tal cual, el .save() revienta
// con un CastError, y como acá no se limpiaba antes de reintentar, el
// paciente quedaba con briefClinicoEstado:"generando" para siempre (el
// Kardex lo muestra "generando..." sin parar).
function sanearBrief(brief) {
  if (!brief || typeof brief !== "object") return {};
  const comoTexto = (v) => (typeof v === "string" ? v : null);
  const comoListaTexto = (v) => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
  return {
    estadoActual: comoTexto(brief.estadoActual),
    cambiosDesdeUltimaConsulta: comoTexto(brief.cambiosDesdeUltimaConsulta),
    medicamentosActivos: comoListaTexto(brief.medicamentosActivos),
    examenesPendientes: comoListaTexto(brief.examenesPendientes),
    alertas: comoListaTexto(brief.alertas),
    factoresRiesgo: comoListaTexto(brief.factoresRiesgo),
    preguntasSugeridas: comoListaTexto(brief.preguntasSugeridas),
    diagnosticosDiferenciales: comoListaTexto(brief.diagnosticosDiferenciales),
  };
}

async function regenerarBriefClinico(pacienteId) {
  // El número de esta generación, tomado ANTES de leer las consultas. Se
  // guarda solo si al terminar sigue siendo el último: la que arrancó con la
  // nota sin corregir y termina tarde no pisa a la que ya leyó la confirmada.
  const turno = await Paciente.findOneAndUpdate({ _id: pacienteId }, { $inc: { briefClinicoVersion: 1 } },
    { new: true, projection: { briefClinicoVersion: 1 } }).lean();
  if (!turno) return;
  const esLaUltima = { _id: pacienteId, briefClinicoVersion: turno.briefClinicoVersion };

  const consultas = await ConsultaMedica.find({ pacienteId, estado: "completado", notaClinicaEstado: "completado" })
    .sort({ createdAt: 1 })
    .lean();
  if (consultas.length === 0) return; // nada todavía de donde armar un brief

  await Paciente.updateOne(esLaUltima, { $set: { briefClinicoEstado: "generando" } });

  try {
    const brief = await generarBrief(formatearHistorial(consultas));
    const r = await Paciente.updateOne(esLaUltima, {
      $set: {
        briefClinico: brief, briefClinicoEstado: "completado", briefClinicoActualizadoEn: new Date(),
        briefClinicoFuentes: { consultas: consultas.length, sinRevisar: consultas.filter(c => !c.confirmadaEn).length },
      },
      $unset: { briefClinicoError: 1 },
    });
    if (!r.matchedCount) log.info(`[BRIEF_CLINICO] paciente ${pacienteId}: ya hay una generación más nueva, esta se descarta`);
  } catch (e) {
    log.error("[BRIEF_CLINICO]", e.response?.data || e.message);
    // updateOne y no .save(): si el error fue un CastError de Mongoose, un
    // documento en memoria sigue con la ruta inválida marcada adentro y
    // vuelve a fallar idéntico (comprobado). Y solo si sigue siendo la
    // última: el error de una vieja no tapa a una nueva que anda.
    await Paciente.updateOne(esLaUltima,
      { $unset: { briefClinico: 1 }, $set: { briefClinicoEstado: "error", briefClinicoError: e.message } }
    ).catch(e2 => log.error("[BRIEF_CLINICO] Tampoco se pudo guardar el estado de error:", e2.message));
  }
}

module.exports = { regenerarBriefClinico, formatearHistorial, PROMPT_SISTEMA };
