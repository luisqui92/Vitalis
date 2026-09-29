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
// Sirve dos veces:
//   1. vocabulario para transcribir (services/assemblyai.js → keytermsPara)
//   2. "propios" para revisar la nota (services/medicamentosOficiales.js):
//      algo que este médico ya recetó y confirmó no se marca como raro.
const { Medicamento, ConsultaMedica } = require("../db/models");
const { nombreBase } = require("./medicamentosOficiales");
const { log } = require("../config");

// Hasta dónde se mira para atrás. Suficiente para conocer sus costumbres sin
// recorrer años de historia en cada consulta.
const ULTIMOS_MEDICAMENTOS = 2000;
const ULTIMAS_CONSULTAS = 300;

// Una consulta nueva cada pocos minutos no justifica recalcular: 10 minutos
// de memoria por médico.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // medicoPhone → { hasta, lista }

// "Losartana 50 mg" → "Losartana" (la dosis de hoy no es la de mañana).
const sinDosis = (n) => String(n || "").replace(/\s*\d.*$/, "").replace(/\s+/g, " ").trim();

async function calcular(medicoPhone) {
  const [meds, consultas] = await Promise.all([
    Medicamento.find({ medicoPhone }).sort({ createdAt: -1 }).limit(ULTIMOS_MEDICAMENTOS).select("nombre").lean(),
    ConsultaMedica.find({ medicoPhone, confirmadaEn: { $ne: null } }).sort({ createdAt: -1 }).limit(ULTIMAS_CONSULTAS)
      .select("notaClinica.medicamentosRecetados.nombre").lean(),
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
  return [...grupos.values()]
    .sort((a, b) => b.veces - a.veces)
    .map(g => [...g.formas].sort((a, b) => b[1] - a[1])[0][0]);
}

// Nunca tira: si la base falla, se transcribe con el vocabulario general, que
// es como funcionaba antes. Perder una consulta por esto sería absurdo.
async function medicamentosDelMedico(medicoPhone, limite = 25) {
  if (!medicoPhone) return [];
  const c = cache.get(medicoPhone);
  if (c && c.hasta > Date.now()) return c.lista.slice(0, limite);
  try {
    const lista = await calcular(medicoPhone);
    cache.set(medicoPhone, { hasta: Date.now() + CACHE_MS, lista });
    return lista.slice(0, limite);
  } catch (e) {
    log.warn("[VOCABULARIO] no se pudo leer el historial del médico:", e.message);
    return [];
  }
}

function olvidar(medicoPhone) { cache.delete(medicoPhone); }

module.exports = { medicamentosDelMedico, olvidar };
