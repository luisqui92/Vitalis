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
  "tratamientosSugeridos": [{"itemMencionado":"string","piezaFdi":"number o null","catalogoNombreSugerido":"string o null"}],
  "examenOcularSugerido": [{"ojo":"OD u OI","estructura":"string exacto de la lista dada","hallazgo":"string","estado":"normal|leve|moderado|importante"}],
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
  "proximoControl".
- "tratamientosSugeridos": SOLO si más abajo te doy un catálogo de
  tratamientos de este consultorio (si no te lo doy, dejá esta lista
  vacía — es una función solo para odontología y estética). Reportá cada tratamiento
  que el profesional dice que HAY QUE HACER de acá en adelante (no algo
  que ya se hizo, no un antecedente) — ej: "hay que poner un implante
  acá", "esto hay que sellarlo", "necesita una corona en esa pieza". Para
  cada uno:
  · "itemMencionado": la frase tal cual la dijo, para que la revise después.
  · "piezaFdi": el número de pieza (11-48) si lo mencionó junto, si no null.
  · "catalogoNombreSugerido": el profesional NO va a decir el nombre exacto
    del catálogo, así que buscá en la lista que te paso el ítem que MEJOR
    corresponda por significado (ej: "sellar" → el ítem de sellantes;
    "implante" → el ítem de implante unitario). Copiá el nombre EXACTO tal
    como aparece en la lista dada. Si ningún ítem del catálogo corresponde
    con confianza, dejalo en null — mejor no sugerir nada que sugerir el
    ítem equivocado (el profesional lo puede elegir a mano después).
- "examenOcularSugerido": SOLO si más abajo te doy una lista de estructuras
  oculares (si no te la doy, dejá esta lista vacía — es una función solo
  para oftalmología). El oftalmólogo va a ir narrando el examen en voz alta
  por cada ojo — reportá un ítem por cada hallazgo CONCRETO que mencione
  sobre una estructura puntual, ej: "ojo derecho, córnea transparente",
  "cristalino con opacidad cortical leve en el izquierdo", "retina sin
  desprendimiento". Para cada uno:
  · "ojo": "OD" (derecho) u "OI" (izquierdo) — tiene que quedar claro de
    cuál ojo habla; si no lo aclaró y no se puede inferir del contexto
    inmediato, no reportes ese hallazgo.
  · "estructura": copiá EXACTO uno de los valores de la lista de
    estructuras oculares válidas que te paso más abajo (son identificadores
    en inglés/sin tildes, ej. "camara_anterior", "nervio_optico" — usalos
    tal cual, no los traduzcas ni les pongas tildes) — el que mejor
    corresponda a lo que describió. Si no corresponde a ninguno, no lo
    reportes.
  · "hallazgo": lo que dijo, tal cual (para que quede en el registro).
  · "estado": clasificá la gravedad en "normal", "leve", "moderado" o
    "importante", según lo que el médico haya dicho (no según tu propio
    juicio clínico):
      - "normal": dijo que está bien/transparente/sin alteraciones/formada.
      - "leve": mencionó una alteración pero la calificó como leve, mínima,
        incipiente o similar.
      - "moderado": alteración que mencionó sin calificarla como leve ni
        grave, o que describió como "moderada".
      - "importante": palabras que indican urgencia o hallazgo serio —
        desprendimiento, hemorragia, pérdida de visión, sospecha de tumor,
        "grave", "severo".
    Si la gravedad no queda clara por lo que dijo, usá "leve" en vez de
    "normal" (para no esconder un hallazgo real) y en vez de "importante"
    (para no generar una alarma que el médico no dijo). Esto se aplica
    directo a la ficha del paciente sin que el médico lo confirme antes,
    así que ante cualquier duda real de a qué estructura/ojo se refiere,
    mejor no reportar ese ítem.`;

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
  if (contexto?.catalogoTratamientos?.length) {
    partes.push(`Catálogo de tratamientos de este consultorio (para "tratamientosSugeridos"): ${contexto.catalogoTratamientos.join("; ")}`);
  }
  if (contexto?.estructurasOculares?.length) {
    partes.push(`Estructuras oculares válidas (para "examenOcularSugerido"): ${contexto.estructurasOculares.join(", ")}`);
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
      max_tokens: 1600,
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
