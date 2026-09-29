// Symphomed — El vocabulario de cada médico: los medicamentos que él receta.
//
// ═══ POR QUÉ ═══════════════════════════════════════════════════════════════
//
// El transcriptor acierta mucho más una palabra si se la anuncian antes
// (keyterms_prompt de AssemblyAI). Las listas generales no pueden tener las
// marcas, las combinaciones ni los fármacos raros de cada especialidad; pero
// cada médico receta más o menos siempre lo mismo. Eso ya está guardado:
//   · los medicamentos que cargó en los Kardex de sus pacientes, y
//   · los de las notas que CONFIRMÓ (las sin confirmar pueden traer justo el
//     error que queremos evitar).
// Se ordenan por cuántas veces aparecen: lo más recetado primero.
//
// Sirve tres veces:
//   1. vocabulario para transcribir (services/assemblyai.js → keytermsPara)
//   2. "propios" para revisar la nota (services/medicamentosOficiales.js):
//      algo que este médico ya recetó y confirmó no se marca como raro.
//   3. para escribir la nota (services/notaClinica.js): la IA sabe que
//      "Glifage" es un medicamento y cómo lo escribe este médico.
//
// ═══ SUS CORRECCIONES ══════════════════════════════════════════════════════
//
// Cuando el médico cambia el nombre de un medicamento en la nota antes de
// confirmar, queda el par «la IA escribió X → él escribió Y»
// (routes/consultaMedica.js, CorreccionIA tipo "medicamento"). Si X vuelve a
// aparecer, la revisión propone Y y la IA de la nota ya lo escribe como Y.
//
// Solo se aprende cuando X NO era un medicamento conocido: si la IA escribió
// «Losartana» y el médico la cambió por «Valsartana», eso no es un error de
// transcripción sino un cambio de idea, y aprenderlo haría que cada
// «Losartana» futura se proponga como Valsartana.
//
// Todo es POR MÉDICO: lo que corrige uno no le cambia nada a otro. Un error
// de tipeo de un médico no se contagia a los demás.
const { Medicamento, ConsultaMedica, CorreccionIA } = require("../db/models");
const { nombreBase, verificarMedicamento } = require("./medicamentosOficiales");
const { log } = require("../config");

// Hasta dónde se mira para atrás. Suficiente para conocer sus costumbres sin
// recorrer años de historia en cada consulta.
const ULTIMOS_MEDICAMENTOS = 2000;
const ULTIMAS_CONSULTAS = 300;
const ULTIMAS_CORRECCIONES = 300;

// Una consulta nueva cada pocos minutos no justifica recalcular: 10 minutos
// de memoria por médico.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // medicoPhone → { hasta, lista, correcciones }

// "Losartana 50 mg" → "Losartana" (la dosis de hoy no es la de mañana).
const sinDosis = (n) => String(n || "").replace(/\s*\d.*$/, "").replace(/\s+/g, " ").trim();

async function calcular(medicoPhone) {
  const [meds, consultas, corregidos] = await Promise.all([
    Medicamento.find({ medicoPhone }).sort({ createdAt: -1 }).limit(ULTIMOS_MEDICAMENTOS).select("nombre").lean(),
    ConsultaMedica.find({ medicoPhone, confirmadaEn: { $ne: null } }).sort({ createdAt: -1 }).limit(ULTIMAS_CONSULTAS)
      .select("notaClinica.medicamentosRecetados.nombre").lean(),
    CorreccionIA.find({ medicoPhone, tipo: "medicamento" }).sort({ createdAt: -1 }).limit(ULTIMAS_CORRECCIONES)
      .select("valorSugerido valorFinal").lean(),
  ]);
  const nombres = [
    ...meds.map(m => m.nombre),
    ...consultas.flatMap(c => (c.notaClinica?.medicamentosRecetados || []).map(m => m?.nombre)),
  ];
  // Se agrupa por nombre base ("losartana potássica" y "Losartana" son uno)
  // y se muestra la forma escrita que más usó.
  const grupos = new Map(); // base → { veces, formas: Map(forma → veces) }
  for (const n of nombres) {
    const forma = sinDosis(n);
    const base = nombreBase(forma);
    if (!forma || !base || base.length < 3 || forma.length > 60) continue;
    const g = grupos.get(base) || { veces: 0, formas: new Map() };
    g.veces++;
    g.formas.set(forma, (g.formas.get(forma) || 0) + 1);
    grupos.set(base, g);
  }
  const lista = [...grupos.values()]
    .sort((a, b) => b.veces - a.veces)
    .map(g => [...g.formas].sort((a, b) => b[1] - a[1])[0][0]);

  // Las correcciones, de la más nueva a la más vieja: si corrigió lo mismo
  // dos veces distinto, vale la última.
  const correcciones = [];
  const vistas = new Set();
  for (const c of corregidos) {
    const dijo = sinDosis(c.valorSugerido);
    const correcto = sinDosis(c.valorFinal);
    const bDijo = nombreBase(dijo);
    if (!bDijo || !correcto || vistas.has(bDijo)) continue;
    // Solo cambió la dosis o la sal ("Losartana" → "Losartana potássica"):
    // no hay nada que aprender.
    if (bDijo === nombreBase(correcto)) continue;
    // Lo que la IA escribió era un medicamento real: fue un cambio de idea.
    if (verificarMedicamento(dijo).estado === "ok") continue;
    vistas.add(bDijo);
    correcciones.push({ dijo, correcto });
  }
  return { lista, correcciones };
}

// Nunca tira: si la base falla, se trabaja con el vocabulario general, que
// es como funcionaba antes. Perder una consulta por esto sería absurdo.
async function conocimiento(medicoPhone) {
  if (!medicoPhone) return { lista: [], correcciones: [] };
  const c = cache.get(medicoPhone);
  if (c && c.hasta > Date.now()) return c;
  try {
    const nuevo = { ...(await calcular(medicoPhone)), hasta: Date.now() + CACHE_MS };
    cache.set(medicoPhone, nuevo);
    return nuevo;
  } catch (e) {
    log.warn("[VOCABULARIO] no se pudo leer el historial del médico:", e.message);
    return { lista: [], correcciones: [] };
  }
}

// Lo que más receta, sin dosis: ["Rivotril", "Losartana", …].
async function medicamentosDelMedico(medicoPhone, limite = 25) {
  return (await conocimiento(medicoPhone)).lista.slice(0, limite);
}

// Lo que corrigió: [{ dijo: "Espironolactna", correcto: "Espironolactona" }].
async function correccionesDelMedico(medicoPhone, limite = 50) {
  return (await conocimiento(medicoPhone)).correcciones.slice(0, limite);
}

function olvidar(medicoPhone) { cache.delete(medicoPhone); }

module.exports = { medicamentosDelMedico, correccionesDelMedico, olvidar };
