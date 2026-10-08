// Symphomed — Simulacros por especialidad (cuentas de estudiante, etapa 4).
//
// ═══ PARA QUÉ ══════════════════════════════════════════════════════════════
//
// Practicar para el examen de residencia: preguntas de opción múltiple con un
// caso clínico corto, por área (medicina interna, pediatría,
// ginecología-obstetricia, cirugía, salud pública) o todas mezcladas. En modo
// práctica ve la respuesta y la explicación en cada pregunta; en modo examen,
// con tiempo, recién al final. Las que erra pasan a sus tarjetas de repaso
// (services/estudio.js) y vuelven espaciadas hasta que las sabe.
//
// ═══ DE DÓNDE SALEN LAS PREGUNTAS ═════════════════════════════════════════
//
// No hay un banco oficial que se pueda usar, así que las escribe una IA, con
// reglas: solo conocimiento consolidado, una sola opción defendible, nada de
// dosis ni marcas. Y antes de guardar una, OTRA IA la responde a ciegas: si
// elige otra opción, o dice que la pregunta es dudosa, se tira. No es una
// garantía —por eso cada pregunta tiene su «está mal», y con dos estudiantes
// que la marquen sale del banco—, pero filtra la mayoría de los errores.
//
// El banco es compartido entre los estudiantes del mismo idioma: lo que se
// generó para uno le sirve al siguiente, y el costo se reparte. Cada uno ve
// cada pregunta una sola vez.
//
// ═══ CUÁNTO CUESTA ═════════════════════════════════════════════════════════
//
// Con el banco armado, nada: armar un simulacro es elegir preguntas. Cuando
// faltan se generan en lotes, en segundo plano, con un tope por día para que
// un error no gaste sin límite. scripts/banco_estudio.js precarga el banco.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { PreguntaSimulacro, Simulacro, TarjetaEstudio } = require("../db/models");
const { log } = require("../config");
const { perfil } = require("./idiomas");
const ia = require("./ia");
const { NIVELES, inicioDelMes } = require("./estudiantes");
const { ErrorHttp } = require("./httpHelpers");
const { marcarDiaDeEstudio, inicioDeDia, reportarEnBanco } = require("./estudio");

const AREAS = ["clinica", "pediatria", "gineco", "cirugia", "salud_publica"];
const NOMBRE_AREA = {
  clinica: "medicina interna", pediatria: "pediatría", gineco: "ginecología y obstetricia",
  cirugia: "cirugía general", salud_publica: "salud pública y medicina preventiva",
};
// Para que un lote no salga con cinco preguntas del mismo tema.
const TEMAS = {
  clinica: ["cardiología", "neumología", "endocrinología y diabetes", "nefrología", "gastroenterología e hígado", "infectología",
    "hematología", "reumatología", "neurología", "agua, electrolitos y ácido-base", "geriatría"],
  pediatria: ["neonatología", "crecimiento y desarrollo", "infecciones respiratorias", "diarrea y deshidratación", "inmunizaciones",
    "nutrición y desnutrición", "urgencias pediátricas", "enfermedades exantemáticas", "cardiopatías congénitas", "infección urinaria en la infancia"],
  gineco: ["control prenatal", "hemorragias de la primera mitad del embarazo", "hemorragias de la segunda mitad del embarazo",
    "trastornos hipertensivos del embarazo", "trabajo de parto y parto", "puerperio", "anticoncepción", "infecciones de transmisión sexual",
    "tamizaje de cáncer de cuello uterino", "sangrado uterino anormal y amenorrea"],
  cirugia: ["abdomen agudo", "apendicitis", "patología biliar", "hernias de la pared abdominal", "trauma inicial", "quemaduras",
    "obstrucción intestinal", "hemorragia digestiva", "patología vascular periférica", "urología", "cuidados perioperatorios"],
  salud_publica: ["medidas de frecuencia en epidemiología", "diseños de estudios epidemiológicos", "sensibilidad, especificidad y valores predictivos",
    "bioestadística básica", "vigilancia epidemiológica", "niveles de prevención", "tamizaje", "brotes y epidemias",
    "atención primaria de salud", "salud materno-infantil"],
};
const PAIS = { BO: "Bolivia", BR: "Brasil" };
const CANTIDADES = [10, 20, 40];
const MODOS = ["practica", "examen"];
const SEGUNDOS_POR_PREGUNTA = 90;   // como en el examen real, más o menos
const POR_LOTE = 5;
const LOTES_EN_PARALELO = 4;
const MARGEN = 5;                   // de más, por las que se tiran al verificar
const MAX_PREGUNTAS_NUEVAS_DIA = 600; // tope de gasto, entre todos
const ESPERA_MAXIMA_MS = 4 * 60 * 1000;

const texto = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const normalizar = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const PROHIBIDAS = /todas las anteriores|ninguna de las anteriores|todas as anteriores|nenhuma das anteriores/i;

function mezclar(xs) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const reglaDeIdioma = (idioma) => `Escribí el CONTENIDO en ${perfil(idioma).nota.nombre}. Las CLAVES del JSON van exactamente como están, sin traducir.`;
const paisDe = (idioma) => PAIS[perfil(idioma).pais] || "Bolivia";

// ─── GENERAR Y VERIFICAR ───────────────────────────────────────────────────

function promptPreguntas(idioma, area, temas) {
  const pais = paisDe(idioma);
  return `Sos un docente que escribe preguntas para el examen de ingreso a la residencia médica en ${pais}. Escribí ${temas.length} preguntas de opción múltiple de ${NOMBRE_AREA[area]}, una de cada uno de estos temas: ${temas.join("; ")}.

Cada pregunta:
- "tema": el tema, corto.
- "enunciado": un caso clínico breve (2 a 5 frases) y, al final, la pregunta.
- "opciones": exactamente 5, todas del mismo tipo (todas diagnósticos, o todas conductas, o todos estudios), plausibles y distintas.
- "correcta": el número de la opción correcta, de 0 a 4.
- "explicacion": por qué esa es la correcta, en 2 o 3 frases.
- "porOpcion": 5 frases cortas, una por opción y en el mismo orden: por qué es o no es.

REGLAS QUE NO SE NEGOCIAN:
1. Solo conocimiento consolidado: guías clínicas vigentes y libros de texto de referencia. Nada dudoso ni controvertido.
2. Una sola opción defendible. Si dudás de una pregunta, no la escribas.
3. Nada de dosis exactas, marcas comerciales ni preguntas de memorizar cifras.
4. Nada de «todas las anteriores» ni «ninguna de las anteriores».
5. La terminología y la realidad sanitaria de ${pais}, sin detalles de normativa local que puedan haber cambiado.

${reglaDeIdioma(idioma)}

Respondé SOLO JSON: {"preguntas":[{"tema":"string","enunciado":"string","opciones":["string"],"correcta":0,"explicacion":"string","porOpcion":["string"]}]}`;
}

function sanearPregunta(p) {
  const opciones = (Array.isArray(p?.opciones) ? p.opciones : []).map(o => texto(o, 200));
  const correcta = Number(p?.correcta);
  const enunciado = texto(p?.enunciado, 1500);
  if (opciones.length !== 5 || opciones.some(o => !o) || new Set(opciones.map(normalizar)).size !== 5) return null;
  if (!Number.isInteger(correcta) || correcta < 0 || correcta > 4) return null;
  if (enunciado.length < 30 || PROHIBIDAS.test(opciones.join(" ") + " " + enunciado)) return null;
  const porOpcion = (Array.isArray(p?.porOpcion) ? p.porOpcion : []).slice(0, 5).map(x => texto(x, 300));
  while (porOpcion.length < 5) porOpcion.push("");
  return { tema: texto(p?.tema, 60), enunciado, opciones, correcta, explicacion: texto(p?.explicacion, 600), porOpcion };
}

// La correcta en otro lugar: la IA tiende a ponerla siempre en las mismas.
function mezclarOpciones(p) {
  const orden = mezclar([0, 1, 2, 3, 4]);
  return { ...p, opciones: orden.map(i => p.opciones[i]), porOpcion: orden.map(i => p.porOpcion[i]), correcta: orden.indexOf(p.correcta) };
}

async function generarLote(idioma, area, temas) {
  const r = await ia.pedirJson(promptPreguntas(idioma, area, temas), "Escribí las preguntas.",
    { maxTokens: 3500, temperatura: 0.7, timeout: 120000 });
  return (Array.isArray(r?.preguntas) ? r.preguntas : []).map(sanearPregunta).filter(Boolean);
}

const PROMPT_VERIFICAR = `Sos un médico que rinde el examen de residencia. Respondé cada pregunta eligiendo UNA opción (su número, de 0 a 4). Si una pregunta tiene más de una opción defendible, ninguna correcta o un error médico, marcala "dudosa": true.
Respondé SOLO JSON, una respuesta por pregunta y en el mismo orden: {"respuestas":[{"opcion":0,"dudosa":false}]}`;

// Se quedan las que otra IA, sin ver la respuesta, contesta igual y sin dudar.
async function verificarLote(preguntas) {
  if (!preguntas.length) return [];
  const r = await ia.pedirJson(PROMPT_VERIFICAR,
    preguntas.map((p, i) => `PREGUNTA ${i + 1}: ${p.enunciado}\n${p.opciones.map((o, k) => `${k}. ${o}`).join("\n")}`).join("\n\n"),
    { maxTokens: 400, temperatura: 0 });
  const respuestas = Array.isArray(r?.respuestas) ? r.respuestas : [];
  return preguntas.filter((p, i) => Number(respuestas[i]?.opcion) === p.correcta && respuestas[i]?.dudosa !== true);
}

// Genera, verifica y guarda. Devuelve cuántas quedaron.
async function generarPreguntas(idioma, area, cantidad) {
  const nuevasHoy = await PreguntaSimulacro.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } });
  if (nuevasHoy >= MAX_PREGUNTAS_NUEVAS_DIA) throw new Error("se llegó al tope diario de preguntas nuevas");
  const lotes = Math.min(LOTES_EN_PARALELO, Math.max(1, Math.ceil(cantidad / POR_LOTE)));
  const temas = mezclar(TEMAS[area]);
  const temasDe = (k) => Array.from({ length: POR_LOTE }, (_, j) => temas[(k * POR_LOTE + j) % temas.length]);
  const generadas = await Promise.all(Array.from({ length: lotes }, (_, k) => generarLote(idioma, area, temasDe(k))
    .catch(e => { log.warn("[SIMULACROS] lote:", e.message); return []; })));
  const verificadas = await Promise.all(generadas.map(l => verificarLote(l)
    .catch(e => { log.warn("[SIMULACROS] verificación:", e.message); return []; })));
  // Sin repetir lo que ya hay (ni entre ellas).
  const existentes = await PreguntaSimulacro.find({ idioma, area }).select("enunciado").lean();
  const vistas = new Set(existentes.map(p => normalizar(p.enunciado).slice(0, 120)));
  const nuevas = [];
  for (const p of verificadas.flat()) {
    const clave = normalizar(p.enunciado).slice(0, 120);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    nuevas.push({ ...mezclarOpciones(p), idioma, area });
  }
  if (nuevas.length) await PreguntaSimulacro.insertMany(nuevas);
  log.info(`[SIMULACROS] ${area}/${idioma}: ${generadas.flat().length} escritas, ${nuevas.length} verificadas y guardadas`);
  return nuevas.length;
}

// ─── ARMAR UN SIMULACRO ────────────────────────────────────────────────────

const vistasPor = (medicoPhone) => Simulacro.distinct("preguntas.preguntaId", { medicoPhone });

async function muestra(idioma, area, cantidad, excluir) {
  const xs = await PreguntaSimulacro.aggregate([
    { $match: { idioma, area, oculta: false, _id: { $nin: excluir } } },
    { $sample: { size: cantidad } },
    { $project: { _id: 1 } },
  ]);
  return xs.map(x => x._id);
}

// Las que no vio. De todas las áreas: parejo, como en el examen real; si a
// alguna le faltan, se completa con las otras.
async function elegirPreguntas(medicoPhone, idioma, areas, cantidad) {
  const vistas = await vistasPor(medicoPhone);
  if (areas.length === 1) return muestra(idioma, areas[0], cantidad, vistas);
  const porArea = Math.ceil(cantidad / areas.length);
  const elegidas = (await Promise.all(areas.map(a => muestra(idioma, a, porArea, vistas)))).flat();
  if (elegidas.length < cantidad) elegidas.push(...await muestra(idioma, { $in: areas }, cantidad - elegidas.length, [...vistas, ...elegidas]));
  return mezclar(elegidas).slice(0, cantidad);
}

// Cuántas le faltan a cada área para este estudiante (las que ya vio no
// cuentan). Se generan a la par: una por área.
async function completarBanco(medicoPhone, idioma, areas, cantidad) {
  const vistas = await vistasPor(medicoPhone);
  const porArea = Math.ceil(cantidad / areas.length);
  await Promise.all(areas.map(async (area) => {
    const hay = await PreguntaSimulacro.countDocuments({ idioma, area, oculta: false, _id: { $nin: vistas } });
    if (hay < porArea) await generarPreguntas(idioma, area, porArea - hay + MARGEN);
  }));
}

// Corre en segundo plano: del banco si alcanza; si no, genera lo que falta.
async function prepararSimulacro(id) {
  const s = await Simulacro.findById(id).lean();
  if (!s || s.estado !== "preparando") return;
  try {
    const areas = s.area === "mixto" ? AREAS : [s.area];
    // Que a cada área le alcance sin repetirle nada. Con el banco armado no
    // genera nada: solo cuenta.
    await completarBanco(s.medicoPhone, s.idioma, areas, s.cantidad);
    const elegidas = await elegirPreguntas(s.medicoPhone, s.idioma, areas, s.cantidad);
    // Con la mitad o más se arma igual (más corto); con menos, no vale la pena.
    if (elegidas.length < Math.ceil(s.cantidad / 2)) throw new Error(`solo hay ${elegidas.length} preguntas`);
    await Simulacro.updateOne({ _id: s._id, estado: "preparando" }, {
      $set: {
        estado: "listo", cantidad: elegidas.length, empezadoEn: new Date(),
        preguntas: mezclar(elegidas).map(preguntaId => ({ preguntaId })),
        limiteSegundos: s.modo === "examen" ? elegidas.length * SEGUNDOS_POR_PREGUNTA : 0,
      },
    });
  } catch (e) {
    log.warn("[SIMULACROS] no se pudo preparar:", e.message);
    await Simulacro.updateOne({ _id: s._id, estado: "preparando" }, { $set: { estado: "error" } });
  }
}

// ─── RESPONDER Y TERMINAR ──────────────────────────────────────────────────

const segundosRestantes = (s, ahora) => Math.max(0, Math.round(s.limiteSegundos - (ahora - new Date(s.empezadoEn)) / 1000));
const sinTiempo = (s, ahora) => s.modo === "examen" && s.limiteSegundos > 0 && segundosRestantes(s, ahora) <= 0;

// La que erró vuelve en sus tarjetas, desde mañana (recién vio la respuesta).
async function tarjetaDeError(medicoPhone, p, zona, ahora) {
  try {
    await TarjetaEstudio.updateOne({ medicoPhone, preguntaId: p._id }, {
      $setOnInsert: {
        tipo: "pregunta", area: p.area, enunciado: p.enunciado, opciones: p.opciones, correcta: p.correcta,
        enContraDe: p.porOpcion, perla: p.explicacion, caja: 1, proxima: inicioDeDia(zona, ahora, 1),
      },
    }, { upsert: true });
  } catch (e) {
    if (e?.code !== 11000) throw e;
  }
}

function idValido(id) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(404, "Simulacro no encontrado");
}

async function obtener(medicoPhone, id, ahora = new Date()) {
  idValido(id);
  const s = await Simulacro.findOne({ _id: id, medicoPhone }).lean();
  if (!s) throw new ErrorHttp(404, "Simulacro no encontrado");
  // Quedó «preparando» porque el servidor se reinició en el medio.
  if (s.estado === "preparando" && ahora - new Date(s.createdAt) > ESPERA_MAXIMA_MS) {
    await Simulacro.updateOne({ _id: s._id, estado: "preparando" }, { $set: { estado: "error" } });
    return { ...s, estado: "error" };
  }
  return s;
}

async function responder(medicoPhone, id, indice, opcion, zona, ahora = new Date()) {
  const s = await obtener(medicoPhone, id, ahora);
  if (s.estado !== "listo") throw new ErrorHttp(409, "Este simulacro ya terminó.");
  if (sinTiempo(s, ahora)) throw new ErrorHttp(409, "Se terminó el tiempo.");
  const item = s.preguntas[Number(indice)];
  if (!Number.isInteger(Number(indice)) || !item) throw new ErrorHttp(400, "Esa pregunta no está en el simulacro.");
  const p = await PreguntaSimulacro.findById(item.preguntaId).lean();
  const elegida = Number(opcion);
  if (!p || !Number.isInteger(elegida) || elegida < 0 || elegida >= p.opciones.length) throw new ErrorHttp(400, "Elegí una de las opciones.");
  const acerto = elegida === p.correcta;
  const campo = `preguntas.${Number(indice)}`;
  // En práctica se contesta una vez (ya vio la respuesta); en examen puede
  // cambiar de opinión hasta terminar, como en papel.
  //
  // $type "null" y no null a secas: con un número en el camino, Mongo también
  // lo lee como un campo «0» de cada elemento, que no existe, y «no existe»
  // cuenta como null: el filtro dejaba pasar siempre la segunda respuesta.
  const filtro = { _id: s._id, estado: "listo", ...(s.modo === "practica" ? { [`${campo}.elegida`]: { $type: "null" } } : {}) };
  const r = await Simulacro.updateOne(filtro, { $set: { [`${campo}.elegida`]: elegida, [`${campo}.acerto`]: acerto, [`${campo}.en`]: ahora } });
  if (!r.modifiedCount && s.modo === "practica") throw new ErrorHttp(409, "Ya respondiste esta pregunta.");
  const racha = await marcarDiaDeEstudio(medicoPhone, zona, ahora);
  if (s.modo === "examen") return { ok: true, racha };
  await PreguntaSimulacro.updateOne({ _id: p._id }, { $inc: { vistas: 1, aciertos: acerto ? 1 : 0 } });
  if (!acerto) await tarjetaDeError(medicoPhone, p, zona, ahora);
  return { acerto, correcta: p.correcta, explicacion: p.explicacion, porOpcion: p.porOpcion, racha };
}

async function terminar(medicoPhone, id, zona, ahora = new Date()) {
  const s = await obtener(medicoPhone, id, ahora);
  if (s.estado === "terminado") return s;   // el reloj y el botón a la vez
  if (s.estado !== "listo") throw new ErrorHttp(409, "Este simulacro no está en curso.");
  const aciertos = s.preguntas.filter(p => p.acerto === true).length;
  const r = await Simulacro.updateOne({ _id: s._id, estado: "listo" }, { $set: { estado: "terminado", aciertos, terminadoEn: ahora } });
  if (r.modifiedCount && s.modo === "examen") {
    // En examen, recién ahora: las estadísticas de cada pregunta y las
    // tarjetas de las que erró o no llegó a contestar.
    const docs = await PreguntaSimulacro.find({ _id: { $in: s.preguntas.map(p => p.preguntaId) } }).lean();
    const porId = new Map(docs.map(d => [String(d._id), d]));
    for (const item of s.preguntas) {
      const p = porId.get(String(item.preguntaId));
      if (!p) continue;
      if (item.elegida != null) await PreguntaSimulacro.updateOne({ _id: p._id }, { $inc: { vistas: 1, aciertos: item.acerto ? 1 : 0 } });
      if (item.acerto !== true) await tarjetaDeError(medicoPhone, p, zona, ahora);
    }
  }
  return Simulacro.findById(s._id).lean();
}

// ─── LO QUE SE MUESTRA ─────────────────────────────────────────────────────

// En examen, la respuesta se ve recién al terminar; en práctica, apenas
// contesta cada una.
async function vista(s, ahora = new Date()) {
  const docs = await PreguntaSimulacro.find({ _id: { $in: (s.preguntas || []).map(p => p.preguntaId) } }).lean();
  const porId = new Map(docs.map(d => [String(d._id), d]));
  const terminado = s.estado === "terminado";
  return {
    _id: s._id, estado: s.estado, area: s.area, modo: s.modo, cantidad: s.cantidad, aciertos: s.aciertos,
    createdAt: s.createdAt, terminadoEn: s.terminadoEn,
    segundosRestantes: s.modo === "examen" && s.estado === "listo" ? segundosRestantes(s, ahora) : null,
    preguntas: (s.preguntas || []).map((item, indice) => {
      const p = porId.get(String(item.preguntaId)) || {};
      const revelar = terminado || (s.modo === "practica" && item.elegida != null);
      return {
        indice, preguntaId: item.preguntaId, tema: p.tema || "", area: p.area || "", enunciado: p.enunciado || "", opciones: p.opciones || [],
        elegida: item.elegida,
        ...(revelar ? { acerto: item.acerto === true, correcta: p.correcta, explicacion: p.explicacion || "", porOpcion: p.porOpcion || [] } : {}),
      };
    }),
  };
}

async function cupoDe(medico, ahora = new Date()) {
  const limite = NIVELES[medico?.estudiante?.nivel]?.simulacrosMes || 0;
  const usados = await Simulacro.countDocuments({ medicoPhone: medico.phone, createdAt: { $gte: inicioDelMes(ahora) }, estado: { $ne: "error" } });
  return { usados, limite, quedan: Math.max(0, limite - usados) };
}

// Cómo le va en cada área, de todos sus simulacros terminados.
async function progreso(medicoPhone) {
  const xs = await Simulacro.aggregate([
    { $match: { medicoPhone, estado: "terminado" } },
    { $group: { _id: "$area", simulacros: { $sum: 1 }, preguntas: { $sum: "$cantidad" }, aciertos: { $sum: "$aciertos" } } },
  ]);
  return xs.map(x => ({ area: x._id, simulacros: x.simulacros, preguntas: x.preguntas, aciertos: x.aciertos,
    pct: x.preguntas ? Math.round((x.aciertos * 100) / x.preguntas) : 0 }))
    .sort((a, b) => b.preguntas - a.preguntas);
}

async function reportarPregunta(medicoPhone, preguntaId, motivo, ahora = new Date()) {
  if (!mongoose.isValidObjectId(preguntaId)) throw new ErrorHttp(404, "Pregunta no encontrada");
  // Solo una que le tocó a él.
  const suya = await Simulacro.exists({ medicoPhone, "preguntas.preguntaId": preguntaId });
  if (!suya) throw new ErrorHttp(404, "Pregunta no encontrada");
  await reportarEnBanco(PreguntaSimulacro, preguntaId, medicoPhone, motivo, "oculta", ahora);
  // Y si ya estaba en sus tarjetas, deja de salir ahí también.
  await TarjetaEstudio.updateOne({ medicoPhone, preguntaId }, { $set: { "reportada.en": ahora, "reportada.motivo": motivo } });
}

module.exports = {
  AREAS, CANTIDADES, MODOS, SEGUNDOS_POR_PREGUNTA, MAX_PREGUNTAS_NUEVAS_DIA,
  sanearPregunta, mezclarOpciones, generarLote, verificarLote, generarPreguntas, elegirPreguntas, prepararSimulacro,
  responder, terminar, vista, obtener, cupoDe, progreso, reportarPregunta, normalizar,
};
