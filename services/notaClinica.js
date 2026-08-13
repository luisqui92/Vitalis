// ChatGo Salud — genera la nota clínica estructurada a partir de la
// transcripción de una consulta (motivo, síntomas, diagnóstico, plan...),
// y detecta sugerencias nuevas para el Kardex (antecedentes, vacunas) que
// el médico puede aprobar con un toque. Es un segundo paso de IA, separado
// de la transcripción en sí.
const axios = require("axios");
const { CONFIG, log } = require("../config");
const { fechaStrBolivia } = require("./utils");

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const PROMPT_SISTEMA = `Eres un asistente clínico. A partir de la transcripción de una consulta
médica en español (puede tener errores de transcripción, y a veces no queda
100% claro quién es el médico y quién el paciente), generá una nota clínica
estructurada.

RESPONDE SOLO JSON con esta estructura exacta:
{
  "motivoConsulta": "string breve o null",
  "sintomas": ["string", ...],
  "antecedentesRelevantes": "string o null",
  "diagnostico": "string o null",
  "diagnosticosDiferenciales": ["string", ...],
  "plan": "string o null",
  "medicamentosRecetados": [{"nombre":"string","dosis":"string o null","frecuencia":"string o null"}],
  "examenesSolicitados": ["string", ...],
  "proximoControl": "string o null",
  "reconsultaSugerida": {"fechaHora":"YYYY-MM-DDTHH:mm o null","textoOriginal":"string o null"},
  "antecedentesPersonalesNuevos": ["string", ...],
  "antecedentesFamiliaresNuevos": [{"parentesco":"string","condicion":"string"}],
  "vacunasMencionadas": [{"nombre":"string","dosis":"string o null","fecha":"YYYY-MM-DD o null"}]
}

Reglas:
- Si algo no se menciona en la transcripción, usá null o un array vacío.
- NUNCA inventes información clínica que no esté en el texto. Esto es un
  apoyo para el médico, no reemplaza su criterio profesional.
- "antecedentesPersonalesNuevos"/"antecedentesFamiliaresNuevos"/"vacunasMencionadas":
  te paso lo que el paciente YA tiene registrado (más abajo, si hay). Reportá
  SOLO lo que se menciona en esta transcripción y que NO esté ya en esa lista
  — no repitas algo que el paciente ya tenía anotado.
- "reconsultaSugerida": SOLO cuando el médico menciona una fecha u hora
  concreta para volver a VER AL PACIENTE en una nueva consulta (ej: "te veo
  el sábado a las siete", "la próxima semana el martes", "en 15 días", "el
  20 a las 10", "nos vemos el viernes", "vení para control el lunes"). Te
  doy la fecha de HOY abajo — resolvé la fecha/hora real a partir de eso
  (si dice "el sábado" y hoy es miércoles, es el sábado que viene, no uno
  pasado). Si no se especifica si es de mañana o de tarde, elegí el
  horario más razonable para un consultorio (el médico lo revisa después,
  no hace falta que sea perfecto).
  OJO — hay fechas que se mencionan en la consulta y NO son una reconsulta,
  aunque suenen parecido. En esos casos dejá reconsultaSugerida en null:
    · Duración de un medicamento: "tomalo hasta el viernes", "por 5 días",
      "hasta que se termine el frasco" → es dosis/frecuencia, va en
      "medicamentosRecetados", no acá.
    · Inicio de los síntomas: "estoy así desde hace tres días", "me
      empezó el lunes" → es parte de la historia de la enfermedad actual,
      no una cita futura.
    · Fecha de un examen o resultado: "el jueves te llega el resultado
      del laboratorio" → no es una consulta con el médico.
  Ante la duda de si una fecha es realmente para volver a verse (y no otra
  cosa), dejá reconsultaSugerida en null — mejor que el médico lo agregue
  a mano a que le llegue un mensaje equivocado al paciente. Si el médico
  solo dice algo vago sin fecha concreta ("en un mes", "cuando tenga los
  resultados", "más adelante"), también dejalo en null — eso ya lo cubre
  "proximoControl".`;

function construirContexto(contexto) {
  const partes = [];
  const hoy = new Date();
  partes.push(`Hoy es ${DIAS_SEMANA[hoy.getDay()]} ${fechaStrBolivia(hoy)}.`);
  if (contexto?.antecedentesPersonales?.length) {
    partes.push(`Antecedentes personales ya registrados: ${contexto.antecedentesPersonales.join("; ")}`);
  }
  if (contexto?.antecedentesFamiliares?.length) {
    partes.push(`Antecedentes familiares ya registrados: ${contexto.antecedentesFamiliares.map(a => `${a.parentesco}: ${a.condicion}`).join("; ")}`);
  }
  if (contexto?.medicamentosActivos?.length) {
    partes.push(`Medicamentos ya activos: ${contexto.medicamentosActivos.join(", ")}`);
  }
  return `\n\n(${partes.join(" ")})`;
}

async function generarNotaClinica(transcripcion, contexto) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: transcripcion + construirContexto(contexto) },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    },
    {
      headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` },
      timeout: CONFIG.TIMEOUT_OPENAI,
    }
  );
  const content = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  return JSON.parse(content);
}

module.exports = { generarNotaClinica };
