// Symphomed — Simulacros por especialidad (cuentas de estudiante, etapa 4).
//
// ═══ PARA QUÉ ══════════════════════════════════════════════════════════════
//
// Practicar para el examen de residencia: preguntas de opción múltiple con un
// caso clínico corto, por área (medicina interna, pediatría,
// ginecología-obstetricia, cirugía, salud pública) o todas mezcladas. En modo
// práctica ve la respuesta y la explicación en cada pregunta; en modo examen,
// con tiempo, recién al final. Las que erra pasan a sus tarjetas de repaso
// (estudio.js) y vuelven espaciadas hasta que las sabe.
//
// Enfermería tiene sus áreas (carreras.js) y su docente: preguntas de cuidado
// y también de cálculo de medicación, con todos los datos en el enunciado. La
// cuenta de cada una se rehace acá con aritmética de verdad (calculos.js) y
// la que no da se tira, antes de que la conteste la otra IA.
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
const dental = require("./odontologia");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { PreguntaSimulacro, Simulacro, TarjetaEstudio } = require("./modelos");
const { log } = require("../../config");
const { perfil } = require("../../services/idiomas");
const ia = require("../../services/ia");
const { NIVELES, inicioDelMes } = require("./cuenta");
const { ErrorHttp } = require("../../services/httpHelpers");
const { marcarDiaDeEstudio, inicioDeDia, reportarEnBanco } = require("./estudio");
const { configDe, carreraDeArea } = require("./carreras");
const { calcular, numerosDe, coincide } = require("./calculos");

// Las de cada carrera están en carreras.js; AREAS son las de medicina.
const areasDe = (carrera) => configDe(carrera).areasSimulacro;
const AREAS = areasDe("medicina");
const NOMBRE_AREA = {
  ...dental.AREAS,
  clinica: "medicina interna", pediatria: "pediatría", gineco: "ginecología y obstetricia",
  cirugia: "cirugía general", salud_publica: "salud pública y medicina preventiva",
  enf_fundamentos: "fundamentos de enfermería", enf_adulto: "enfermería del adulto (médico-quirúrgica)",
  enf_materno: "enfermería materno-perinatal", enf_pediatria: "enfermería pediátrica y neonatal",
  enf_comunitaria: "enfermería comunitaria y salud pública", enf_urgencias: "enfermería en urgencias y cuidados críticos",
  enf_salud_mental: "enfermería en salud mental",
};
// Para que un lote no salga con cinco preguntas del mismo tema.
const TEMAS = {
  ...dental.TEMAS,
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
  // Enfermería: el cuidado, la seguridad del paciente y los cálculos de
  // medicación (con todos los datos en el enunciado: ver promptPreguntas).
  enf_fundamentos: ["proceso de atención de enfermería", "valoración por patrones funcionales", "signos vitales", "bioseguridad y aislamiento",
    "higiene de manos e infecciones asociadas a la atención", "administración segura de medicamentos", "cálculo de goteo y de mL por hora",
    "vías de administración parenteral", "seguridad del paciente y prevención de caídas", "prevención de lesiones por presión", "registros de enfermería"],
  enf_adulto: ["cuidados preoperatorios", "cuidados posoperatorios", "manejo del dolor", "cuidados del paciente con diabetes",
    "cuidados en la insuficiencia cardíaca", "oxigenoterapia y cuidados respiratorios", "balance hídrico y electrolitos",
    "cuidado de heridas y drenajes", "sondas y catéteres", "transfusión de sangre", "cálculo de dosis y diluciones"],
  enf_materno: ["control prenatal", "signos de alarma en el embarazo", "trabajo de parto y parto", "atención inmediata del recién nacido",
    "puerperio", "lactancia materna", "planificación familiar", "trastornos hipertensivos del embarazo", "hemorragia posparto"],
  enf_pediatria: ["crecimiento y desarrollo", "vacunación", "valoración del recién nacido", "deshidratación y rehidratación",
    "infecciones respiratorias en niños", "fiebre en el niño", "alimentación infantil", "cálculo de dosis por peso",
    "seguridad del niño hospitalizado", "dolor en pediatría"],
  enf_comunitaria: ["atención primaria de salud", "educación para la salud", "visita domiciliaria", "vigilancia epidemiológica",
    "programa de inmunizaciones", "salud materno-infantil en la comunidad", "enfermedades transmisibles", "enfermedades crónicas en la comunidad",
    "saneamiento básico", "niveles de prevención"],
  enf_urgencias: ["triaje", "reanimación cardiopulmonar básica", "valoración ABCDE", "shock", "paciente politraumatizado", "quemaduras",
    "intoxicaciones", "insuficiencia respiratoria", "monitoreo del paciente crítico", "cálculo de infusiones continuas"],
  enf_salud_mental: ["comunicación terapéutica", "ansiedad", "depresión y riesgo suicida", "paciente agitado", "consumo de alcohol y otras drogas",
    "psicosis", "trastornos de la conducta alimentaria", "cuidados en la demencia", "efectos adversos de los psicofármacos que hay que vigilar",
    "salud mental comunitaria"],
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
  if (carreraDeArea(area) === "enfermeria") return promptPreguntasEnfermeria(idioma, area, temas);
  const pais = paisDe(idioma);
  const contexto = dental.esDental(area) ? "docente de odontología que escribe preguntas para el examen de grado de odontología" : "docente que escribe preguntas para el examen de ingreso a la residencia médica";
  return `Sos un ${contexto} en ${pais}. Escribí ${temas.length} preguntas de opción múltiple de ${NOMBRE_AREA[area]}, una de cada uno de estos temas: ${temas.join("; ")}.

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

// Enfermería: preguntas de cuidado, y también de cálculo. Las de cálculo se
// pueden porque no piden recordar ninguna dosis: todos los datos van en el
// enunciado, y la IA dice con qué datos se resuelve, para rehacer la cuenta
// acá (calculoComprobado, abajo).
function promptPreguntasEnfermeria(idioma, area, temas) {
  const pais = paisDe(idioma);
  return `Sos un docente de enfermería que escribe preguntas de estudio para estudiantes de la licenciatura en enfermería de ${pais}, del nivel de un examen final de la carrera. Escribí ${temas.length} preguntas de opción múltiple de ${NOMBRE_AREA[area]}, una de cada uno de estos temas: ${temas.join("; ")}.

Cada pregunta:
- "tema": el tema, corto.
- "enunciado": una situación de cuidado breve (2 a 5 frases) y, al final, la pregunta: qué valorar, qué hacer primero, qué intervención corresponde, qué signo de alarma vigilar o qué enseñarle al paciente.
- "opciones": exactamente 5, todas del mismo tipo, plausibles y distintas.
- "correcta": el número de la opción correcta, de 0 a 4.
- "explicacion": por qué esa es la correcta, en 2 o 3 frases.
- "porOpcion": 5 frases cortas, una por opción y en el mismo orden: por qué es o no es.
- "calculo": null, salvo en las preguntas de cálculo (regla 4).

REGLAS QUE NO SE NEGOCIAN:
1. Solo conocimiento consolidado de enfermería: guías vigentes y libros de texto de referencia. Nada dudoso ni controvertido.
2. Una sola opción defendible. Si dudás de una pregunta, no la escribas.
3. Nada de dosis de memoria ni marcas comerciales: ninguna pregunta puede necesitar recordar la dosis de un medicamento.
4. Se pueden hacer preguntas de cálculo (goteo, mL por hora, dosis por peso, volumen a administrar, dilución, infusión continua) SOLO si TODOS los datos están en el enunciado: lo indicado, la presentación, el peso, el tiempo y las gotas por mL del equipo. Escribí los números con coma decimal y sin separador de miles. En esas preguntas, "calculo" lleva los datos con que se resuelve, en estas unidades:
   - gotas por minuto: {"tipo":"goteo","datos":{"volumenMl":0,"minutos":0,"factor":20}} (factor: gotas por mL del equipo: 10, 15, 20 o 60)
   - mL por hora: {"tipo":"mlHora","datos":{"volumenMl":0,"minutos":0}}
   - dosis de cada toma según el peso: {"tipo":"dosisPorPeso","datos":{"dosisPorKg":0,"pesoKg":0,"tomas":1}} (tomas: en cuántas se reparte; 1 si es una sola)
   - mL a administrar: {"tipo":"volumen","datos":{"dosis":0,"cantidad":0,"volumenMl":0}} (dosis y cantidad en la misma unidad; la presentación trae «cantidad» en «volumenMl»)
   - mL de la solución inicial para diluir: {"tipo":"dilucion","datos":{"c1":0,"c2":0,"v2":0}} (C1 × V1 = C2 × V2)
   - mL por hora de una infusión continua: {"tipo":"infusion","datos":{"dosisMcgKgMin":0,"pesoKg":0,"mg":0,"volumenMl":0}} (mg del medicamento en volumenMl de la mezcla)
   El resultado tiene que estar en UNA sola opción, la correcta.
5. Nada de «todas las anteriores» ni «ninguna de las anteriores».
6. Sin etiquetas ni códigos de taxonomías con licencia (NANDA-I, NIC, NOC): un diagnóstico de enfermería se escribe con palabras.
7. La terminología y la realidad sanitaria de ${pais}, sin detalles de normativa local que puedan haber cambiado.

${reglaDeIdioma(idioma)}

Respondé SOLO JSON: {"preguntas":[{"tema":"string","enunciado":"string","opciones":["string"],"correcta":0,"explicacion":"string","porOpcion":["string"],"calculo":null}]}`;
}

// Lo que delata una pregunta de cálculo (en español y en portugués). Solo
// para enfermería: en medicina no se piden cálculos, y «cálculo renal» no lo es.
const PARECE_CALCULO = /gotas?\s*(?:\/|por)\s*min|microgotas|\bgtt\b|\bml\s*\/\s*h\b|\bml\s+por\s+hora\b|\bmg\s*\/\s*kg\b|\bmcg\s*\/\s*kg\b|\bdiluci[oó]n\b|\bdilui[cç][aã]o\b|\bdiluir\b|cu[aá]ntos\s+ml\b|quantos\s+ml\b/i;

// Una de cálculo se comprueba con aritmética de verdad (calculos.js): con los
// datos que dio la IA, la cuenta tiene que dar un resultado que esté en la
// opción correcta y en ninguna otra. Si parece de cálculo y no trae con qué
// rehacerla, no se puede comprobar: se tira. La otra IA, la que contesta a
// ciegas, mira además que esos datos sean los del enunciado.
function calculoComprobado(p, crudo) {
  const c = crudo?.calculo;
  if (!c || typeof c !== "object") return !PARECE_CALCULO.test(`${p.enunciado} ${p.opciones.join(" ")}`);
  const resultado = calcular(c.tipo, c.datos);
  if (resultado === null) return false;
  const conResultado = p.opciones.map(o => numerosDe(o).some(n => coincide(n, resultado)));
  return conResultado[p.correcta] === true && conResultado.filter(Boolean).length === 1;
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
  const enfermeria = carreraDeArea(area) === "enfermeria";
  const r = await ia.pedirJson(promptPreguntas(idioma, area, temas), "Escribí las preguntas.",
    { maxTokens: enfermeria ? 4500 : 3500, temperatura: 0.7, timeout: 120000 });
  return (Array.isArray(r?.preguntas) ? r.preguntas : []).map((crudo) => {
    const p = sanearPregunta(crudo);
    return p && (!enfermeria || calculoComprobado(p, crudo)) ? p : null;
  }).filter(Boolean);
}

const PROMPT_VERIFICAR = `Sos un médico que rinde el examen de residencia. Respondé cada pregunta eligiendo UNA opción (su número, de 0 a 4). Si una pregunta tiene más de una opción defendible, ninguna correcta o un error médico, marcala "dudosa": true.
Respondé SOLO JSON, una respuesta por pregunta y en el mismo orden: {"respuestas":[{"opcion":0,"dudosa":false}]}`;

const PROMPT_VERIFICAR_ENFERMERIA = `Sos un licenciado en enfermería que rinde un examen. Respondé cada pregunta eligiendo UNA opción (su número, de 0 a 4); si es de cálculo, hacé la cuenta con los datos del enunciado. Si una pregunta tiene más de una opción defendible, ninguna correcta, un dato que falta o un error, marcala "dudosa": true.
Respondé SOLO JSON, una respuesta por pregunta y en el mismo orden: {"respuestas":[{"opcion":0,"dudosa":false}]}`;

// Se quedan las que otra IA, sin ver la respuesta, contesta igual y sin dudar.
async function verificarLote(preguntas, carrera = "medicina") {
  if (!preguntas.length) return [];
  const r = await ia.pedirJson(carrera === "enfermeria" ? PROMPT_VERIFICAR_ENFERMERIA : carrera === "odontologia" ? PROMPT_VERIFICAR.replace("un médico que rinde el examen de residencia", "un odontólogo que verifica un examen de odontología") : PROMPT_VERIFICAR,
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
  const verificadas = await Promise.all(generadas.map(l => verificarLote(l, carreraDeArea(area) || "medicina")
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
    const areas = s.area === "mixto" ? areasDe(s.carrera) : [s.area];
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
  // Si no se guardó, se dice por qué, y nunca «ok». Antes, en examen, una
  // respuesta que llegaba justo cuando el reloj cerraba el simulacro no se
  // guardaba y el estudiante recibía «ok» igual (segunda revisión de QA del
  // 9 de octubre de 2026, R01). Es matchedCount y no modifiedCount: en
  // examen, volver a elegir la misma opción no cambia nada y está bien.
  if (!r.matchedCount) {
    const actual = await Simulacro.findById(s._id).select("estado").lean();
    if (actual?.estado !== "listo") throw new ErrorHttp(409, "El simulacro terminó antes de guardar esta respuesta: no se tomó en cuenta.");
    throw new ErrorHttp(409, "Ya respondiste esta pregunta.");
  }
  const racha = await marcarDiaDeEstudio(medicoPhone, zona, ahora);
  if (s.modo === "examen") return { ok: true, racha };
  await PreguntaSimulacro.updateOne({ _id: p._id }, { $inc: { vistas: 1, aciertos: acerto ? 1 : 0 } });
  if (!acerto) await tarjetaDeError(medicoPhone, p, zona, ahora);
  return { acerto, correcta: p.correcta, explicacion: p.explicacion, porOpcion: p.porOpcion, racha };
}

// El reloj y el botón pueden llegar a la vez, y un cierre que falló a medias
// se reintenta: terminar dos veces da lo mismo que una.
async function terminar(medicoPhone, id, zona, ahora = new Date()) {
  const s = await obtener(medicoPhone, id, ahora);
  if (s.estado !== "terminado") {
    if (s.estado !== "listo") throw new ErrorHttp(409, "Este simulacro no está en curso.");
    // El total se cuenta en el mismo cambio que lo cierra, de las respuestas
    // que hay guardadas en ese momento. Antes se contaba con lo leído un
    // instante antes: una respuesta que entraba en el medio quedaba guardada
    // como correcta y fuera de la nota (R01 de la misma revisión).
    await Simulacro.updateOne({ _id: s._id, estado: "listo" }, [{
      $set: {
        estado: "terminado", terminadoEn: ahora,
        aciertos: { $size: { $filter: { input: "$preguntas", cond: { $eq: ["$$this.acerto", true] } } } },
        ...(s.modo === "examen" ? { cierrePendiente: true } : {}),
      },
    }]);
  }
  await completarCierre(medicoPhone, s._id, zona, ahora);
  return Simulacro.findById(s._id).lean();
}

// En examen, recién al cerrar: las estadísticas de cada pregunta y las
// tarjetas de las que erró o no llegó a contestar.
//
// Antes se hacía después de marcarlo terminado y sin dejar nada anotado: si
// fallaba una tarjeta, el examen quedaba terminado y reintentar no la creaba
// nunca (informe de QA del 9 de octubre de 2026, E07). Ahora el cierre deja
// «cierrePendiente» en el mismo cambio, cada paso se puede repetir sin
// duplicar, y la marca se borra al final. Lo completa el próximo que pase:
// terminar otra vez, abrirlo o abrir la lista de simulacros.
//   · Las tarjetas: una por pregunta (índice único), se crean si faltan.
//   · Las estadísticas: las suma el que pone la fecha (estadisticasEn), una
//     sola vez. Si la base fallara justo entre la fecha y la suma, ese
//     conteo se pierde: mejor perder uno que contarlo dos veces (sirven para
//     ver qué preguntas son difíciles, no son la nota de nadie).
async function completarCierre(medicoPhone, id, zona, ahora = new Date()) {
  const s = await Simulacro.findOne({ _id: id, medicoPhone, estado: "terminado", cierrePendiente: true }).lean();
  if (!s) return;
  const docs = await PreguntaSimulacro.find({ _id: { $in: s.preguntas.map(p => p.preguntaId) } }).lean();
  const porId = new Map(docs.map(d => [String(d._id), d]));
  const marca = await Simulacro.updateOne({ _id: s._id, estadisticasEn: null }, { $set: { estadisticasEn: ahora } });
  if (marca.modifiedCount) {
    const sumas = s.preguntas.filter(item => item.elegida != null && porId.has(String(item.preguntaId)))
      .map(item => ({ updateOne: { filter: { _id: item.preguntaId }, update: { $inc: { vistas: 1, aciertos: item.acerto ? 1 : 0 } } } }));
    if (sumas.length) await PreguntaSimulacro.bulkWrite(sumas, { ordered: false });
  }
  for (const item of s.preguntas) {
    const p = porId.get(String(item.preguntaId));
    if (p && item.acerto !== true) await tarjetaDeError(medicoPhone, p, zona, ahora);
  }
  await Simulacro.updateOne({ _id: s._id, cierrePendiente: true }, { $set: { cierrePendiente: false } });
}

// Los que quedaron a medio cerrar, de este estudiante.
async function completarCierresPendientes(medicoPhone, zona, ahora = new Date()) {
  const pendientes = await Simulacro.find({ medicoPhone, estado: "terminado", cierrePendiente: true }).select("_id").lean();
  for (const p of pendientes) await completarCierre(medicoPhone, p._id, zona, ahora);
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
  AREAS, areasDe, CANTIDADES, MODOS, SEGUNDOS_POR_PREGUNTA, MAX_PREGUNTAS_NUEVAS_DIA,
  sanearPregunta, mezclarOpciones, generarLote, verificarLote, generarPreguntas, elegirPreguntas, prepararSimulacro,
  promptPreguntas, calculoComprobado, NOMBRE_AREA, TEMAS,
  responder, terminar, completarCierre, completarCierresPendientes, vista, obtener, cupoDe, progreso, reportarPregunta, normalizar,
};
