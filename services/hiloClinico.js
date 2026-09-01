// Vitalis — El hilo clínico: qué de antes tiene que ver con lo de hoy.
//
// ═══ QUÉ FALTABA, SI YA EXISTÍA EL BRIEF ═══════════════════════════════════
//
// services/briefClinico.js lee todo el historial y arma un resumen para que
// el médico lo lea ANTES de la próxima consulta. Es útil, pero mira en una
// sola dirección: se escribe DESPUÉS de cada consulta y por lo tanto no sabe
// por qué viene el paciente hoy.
//
// El caso que se nos escapaba es este: alguien consultó por cefalea hace
// tres meses y hoy viene por hipertensión. El brief de entonces menciona la
// cefalea en algún lado, pero nadie la conecta — cuando se escribió, la
// hipertensión no existía todavía.
//
// Esto hace la pregunta que faltaba: dado el motivo de HOY, ¿qué del
// historial se relaciona?
//
// ═══ CONECTA, NO CONCLUYE ══════════════════════════════════════════════════
//
// Dice "hace 3 meses consultó por cefalea de dos semanas — la cefalea puede
// acompañar a la hipertensión no controlada". No dice "la cefalea era por
// hipertensión". La conclusión la saca el médico; el aporte de la máquina es
// que no se le pase que esa consulta existió.
//
// ═══ CADA CONEXIÓN CITA UNA CONSULTA REAL ══════════════════════════════════
//
// Con su fecha y su id, para que el médico pueda abrirla y leer qué decía.
// Sin eso, un modelo puede escribir un antecedente verosímil que nunca pasó,
// y nadie lo verificaría — suena bien y encaja. Por eso se descarta toda
// conexión que apunte a una consulta que no está en el historial.
//
// ═══ SI NO HAY NADA, NO DICE NADA ══════════════════════════════════════════
//
// Un hilo clínico que siempre encuentra algo es ruido, y a la tercera vez el
// médico deja de leerlo — justo antes del caso en que importaba. Que devuelva
// vacío es un resultado correcto y frecuente.
const axios = require("axios");
const { CONFIG, log } = require("../config");
const { ConsultaMedica } = require("../db/models");

// Cuántas consultas anteriores se miran. No es "todas": una historia de
// cuarenta consultas no entra en el contexto y, sobre todo, diluye — lo que
// se busca son ecos, y un eco de hace ocho años casi nunca lo es.
const CUANTAS_ANTERIORES = 12;

const PROMPT = `Sos un asistente clínico. Te paso la consulta de HOY de un paciente y sus consultas ANTERIORES. Tu única tarea es señalar qué de lo anterior se relaciona con lo de hoy, para que el médico no lo pase por alto.

REGLAS QUE NO SE NEGOCIAN:

1. CONECTÁ, NO CONCLUYAS. Escribí "hace 3 meses consultó por cefalea de dos semanas; la cefalea puede acompañar a la hipertensión no controlada". NUNCA "la cefalea era por la hipertensión". No cierres el caso: el diagnóstico lo hace el médico.

2. CADA CONEXIÓN CITA UNA CONSULTA QUE TE PASÉ, por su id. Si no podés señalar cuál, no la incluyas. No inventes antecedentes ni consultas: todo lo que digas tiene que estar escrito en lo que te mandé.

3. SI NO HAY RELACIÓN, DEVOLVÉ LAS LISTAS VACÍAS. Es una respuesta correcta y frecuente. Forzar una conexión que no está es peor que no decir nada: hace que dejen de leerte.

4. NO REPITAS LO OBVIO. Que la consulta anterior fuera por lo mismo y hoy sea el control no es un hallazgo. Señalá lo que un médico apurado podría no cruzar.

5. NADA DE PORCENTAJES NI PUNTAJES DE CERTEZA. Son números inventados con apariencia de medición.

Respondé SOLO JSON:
{
  "conexiones": [
    { "consultaId": "el id exacto de una consulta anterior que te pasé",
      "queDijoEntonces": "qué decía esa consulta, en una frase",
      "porQueImporta": "por qué se relaciona con lo de hoy, sin concluir" }
  ],
  "preguntasParaElMedico": ["preguntas que valdría la pena hacerle al paciente a la luz de esa relación"]
}`;

function resumirConsulta(c, incluirId) {
  const n = c.notaClinica || {};
  const partes = [];
  if (incluirId) partes.push(`id: ${c._id}`);
  partes.push(`fecha: ${new Date(c.createdAt).toLocaleDateString("es-BO")}`);
  if (n.motivoConsulta) partes.push(`motivo: ${n.motivoConsulta}`);
  if (n.sintomas?.length) partes.push(`síntomas: ${n.sintomas.join(", ")}`);
  if (n.diagnostico) partes.push(`diagnóstico: ${n.diagnostico}`);
  if (n.antecedentesRelevantes) partes.push(`antecedentes: ${n.antecedentesRelevantes}`);
  if (n.plan) partes.push(`plan: ${n.plan}`);
  if (n.medicamentosRecetados?.length) {
    partes.push(`medicamentos: ${n.medicamentosRecetados.map(m => m.nombre).filter(Boolean).join(", ")}`);
  }
  if (n.examenesSolicitados?.length) partes.push(`exámenes pedidos: ${n.examenesSolicitados.join(", ")}`);
  return partes.join(" | ");
}

// Descarta toda conexión que no apunte a una consulta real del historial.
// Es la barrera contra la regla 2: un prompt es una instrucción, no una
// garantía, y un antecedente inventado que suena verosímil no lo corrige
// nadie después.
function sanear(salida, idsValidos) {
  const conexiones = (Array.isArray(salida?.conexiones) ? salida.conexiones : [])
    .filter(c => c?.consultaId && idsValidos.has(String(c.consultaId)))
    .filter(c => c.queDijoEntonces && c.porQueImporta)
    .map(c => ({
      consultaId: String(c.consultaId),
      queDijoEntonces: String(c.queDijoEntonces).trim().slice(0, 400),
      porQueImporta: String(c.porQueImporta).trim().slice(0, 400),
    }));
  return {
    conexiones,
    preguntasParaElMedico: (Array.isArray(salida?.preguntasParaElMedico) ? salida.preguntasParaElMedico : [])
      .map(p => String(p).trim()).filter(Boolean).slice(0, 5),
    // Cuántas se descartaron por citar una consulta que no existe. Si esto
    // aparece seguido, el modelo está inventando y hay que apretar el prompt
    // antes de que alguien confíe en lo que sí pasó.
    descartadasPorInventadas:
      (Array.isArray(salida?.conexiones) ? salida.conexiones.length : 0) - conexiones.length,
  };
}

// Devuelve el hilo, o null si no hay con qué compararlo. NO escribe en la
// base: quien llama decide qué hacer.
async function tejerHilo(consultaHoy) {
  const anteriores = await ConsultaMedica.find({
    pacienteId: consultaHoy.pacienteId,
    _id: { $ne: consultaHoy._id },
    notaClinicaEstado: "completado",
    createdAt: { $lt: consultaHoy.createdAt },
  }).sort({ createdAt: -1 }).limit(CUANTAS_ANTERIORES).select("notaClinica createdAt").lean();

  // Sin historial no hay hilo que tejer. Es el caso de la primera consulta de
  // cualquier paciente, así que ni se le pregunta al modelo.
  if (!anteriores.length) return null;

  const idsValidos = new Set(anteriores.map(c => String(c._id)));
  const historial = anteriores.slice().reverse().map(c => resumirConsulta(c, true)).join("\n");
  const hoy = resumirConsulta(consultaHoy, false);

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: `CONSULTA DE HOY:\n${hoy}\n\nCONSULTAS ANTERIORES (de la más vieja a la más nueva):\n${historial}` },
      ],
      max_tokens: 900,
      temperature: 0.1,
    },
    { headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` }, timeout: CONFIG.TIMEOUT_OPENAI }
  );

  const crudo = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  const hilo = sanear(JSON.parse(crudo), idsValidos);
  if (hilo.descartadasPorInventadas) {
    log.warn(`[HILO_CLINICO] ${hilo.descartadasPorInventadas} conexión(es) descartada(s) por citar consultas que no existen`);
  }
  return hilo;
}

// Lo teje y lo guarda en la consulta de hoy. Nunca tumba nada: si falla, la
// consulta y su nota quedan igual — esto es un extra, no la historia clínica.
async function generarHilo(consultaId) {
  const consulta = await ConsultaMedica.findById(consultaId).lean();
  if (!consulta || consulta.notaClinicaEstado !== "completado") return null;

  const hilo = await tejerHilo(consulta);
  // Sin conexiones no se guarda nada: una consulta con un hilo vacío guardado
  // y una sin hilo son lo mismo, y la pantalla ya sabe no mostrar nada.
  if (!hilo || !hilo.conexiones.length) return null;

  await ConsultaMedica.updateOne({ _id: consultaId }, {
    $set: { hiloClinico: { conexiones: hilo.conexiones, preguntas: hilo.preguntasParaElMedico, generadoEn: new Date() } },
  });
  log.info(`[HILO_CLINICO] ${hilo.conexiones.length} conexión(es) en la consulta ${consultaId}`);
  return hilo;
}

module.exports = { generarHilo, tejerHilo, sanear, PROMPT, CUANTAS_ANTERIORES };
