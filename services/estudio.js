// Symphomed — Estudiar con los casos propios (etapa 3 de las cuentas de
// estudiante).
//
// ═══ DE DÓNDE SALEN LAS PREGUNTAS ══════════════════════════════════════════
//
// De sus consultas. Cada vez que un estudiante hace el razonamiento de un
// caso (services/tutorClinico.js), ese análisis se convierte en tarjetas de
// repaso:
//
//   · «¿Cuál es el diagnóstico más probable?» — de opción múltiple: el caso
//     (sexo, edad, motivo, síntomas; nunca el nombre) y los diferenciales de
//     ese mismo análisis como opciones.
//   · «¿Qué estudio lo confirma o lo descarta?»
//   · «¿Qué banderas rojas no se pueden pasar por alto?»
//   · «¿Qué faltó preguntar?»
//
// Sin pedirle nada nuevo a la IA: es lo mismo que él ya vio, ordenado para
// repasarlo. No cuesta nada por pregunta, y no aparece ningún dato que no
// estuviera en su caso.
//
// ═══ CUÁNDO VUELVE CADA UNA ════════════════════════════════════════════════
//
// Repaso espaciado con cajas (sistema Leitner). Una tarjeta nueva está en la
// caja 1 y sale enseguida. Si la sabe, sube de caja y vuelve cada vez más
// lejos (1, 3, 7, 14 y 30 días); si no, vuelve a la caja 1 y sale mañana. Lo
// que ya sabe se repasa poco y lo que no, seguido. En la caja 4 o la 5 cuenta
// como «dominada».
//
// Repasar una que todavía no tocaba (el «repasar más» del final) no la sube
// de caja —la habría visto antes de tiempo—, pero si la erra sí vuelve a la 1:
// eso es un olvido de verdad.
//
// ═══ LA RACHA ══════════════════════════════════════════════════════════════
//
// Días seguidos estudiando: repasar al menos una tarjeta o razonar un caso.
// «Hoy» es el día en la zona horaria de la cuenta y no el del servidor: a las
// 22:30 en São Paulo, en el servidor ya es mañana.
//
// ═══ LO QUE NO SE NEGOCIA ══════════════════════════════════════════════════
//
// La respuesta «correcta» es la del razonamiento de ese caso, que armó una IA
// con lo que se dijo en la consulta. Es material para aprender, no la verdad:
// el diagnóstico real lo confirma su tutor, y la pantalla lo dice. Si una
// pregunta está mal, él la marca y deja de salir (scripts/estudio_reportes.js
// cuenta cuántas y de qué tipo, sin mostrar el contenido de ningún caso).
const crypto = require("crypto");
const mongoose = require("mongoose");
const { TarjetaEstudio, ConsultaMedica, Paciente, Medico } = require("../db/models");
const { zonaValida, hoyEnZona, instanteEnZona, fechaStrEnZona } = require("./zonaHoraria");
const { ErrorHttp } = require("./httpHelpers");
const { PALABRAS_MINIMAS } = require("./tutorClinico");

const CAJA_MAX = 5;
const CAJA_DOMINADA = 4;
// Días hasta que vuelve, según la caja a la que llegó al acertar. Acertar
// estando ya en la 5 la manda a un mes. Errar: caja 1, mañana.
const DIAS_TRAS_ACIERTO = [null, null, 1, 3, 7, 14];
const DIAS_CAJA_LLENA = 30;
// Lo que entra en una sentada. Con más, el que se atrasó una semana abre la
// pantalla, ve 80 y la cierra.
const POR_SESION = 20;
const POR_REPASO = 10;
// En una misma sentada, el diagnóstico antes que lo demás: «¿qué estudio
// confirma una apendicitis?» le soplaría la respuesta a «¿cuál es el
// diagnóstico más probable?» del mismo caso.
const ORDEN_TIPO = { dx: 0, estudio: 1, banderas: 2, faltoPreguntar: 3 };
const MOTIVOS_REPORTE = ["respuesta", "pregunta", "datos"];
const REPETIDA_MS = 3000;

const recortar = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lista = (v, maxItems, maxLargo = 200) => (Array.isArray(v) ? v : [])
  .map(x => recortar(x, maxLargo)).filter(Boolean).slice(0, maxItems);

function mezclar(xs) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── LOS DÍAS, EN LA ZONA DE LA CUENTA ─────────────────────────────────────

// El comienzo del día local que está `dias` días después del de `ahora`.
function inicioDeDia(zona, ahora, dias = 0) {
  const h = hoyEnZona(zona, ahora);
  return instanteEnZona(zona, h.anio, h.mesIndex, h.dia + dias, 0, 0);
}

// "2026-03-01" → "2026-02-28".
function diaAnterior(dia) {
  const [a, m, d] = String(dia).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

async function zonaDe(medicoPhone) {
  const m = await Medico.findOne({ phone: medicoPhone }).select("zonaHoraria").lean();
  return zonaValida(m?.zonaHoraria);
}

// ─── DE UN RAZONAMIENTO, LAS TARJETAS ──────────────────────────────────────

// Lo que se lee arriba de la pregunta. Sin el nombre: sexo, edad (la de ese
// día, no la de hoy), motivo, síntomas y antecedentes, de la nota.
function casoDe(consulta, paciente) {
  const nota = consulta.notaClinica || {};
  const fecha = consulta.createdAt ? new Date(consulta.createdAt) : null;
  let edad = null, edadMeses = null;
  if (paciente?.fechaNacimiento && fecha) {
    const nac = new Date(paciente.fechaNacimiento);
    const meses = (fecha.getUTCFullYear() - nac.getUTCFullYear()) * 12 + (fecha.getUTCMonth() - nac.getUTCMonth())
      - (fecha.getUTCDate() < nac.getUTCDate() ? 1 : 0);
    if (meses >= 0 && meses < 130 * 12) {
      edad = Math.floor(meses / 12);
      // «0 años» no dice nada de un bebé: hasta los 2, en meses.
      if (meses < 24) edadMeses = meses;
    }
  }
  return {
    sexo: recortar(paciente?.sexo, 20),
    edad,
    edadMeses,
    motivo: recortar(nota.motivoConsulta, 300),
    sintomas: lista(nota.sintomas, 8, 160),
    antecedentes: recortar(nota.antecedentesRelevantes, 300),
    fecha,
  };
}

// Pura: no toca la base. `azar` es para que las pruebas fijen el orden.
function tarjetasDeCaso(consulta, paciente, azar = mezclar) {
  const rz = consulta?.razonamiento;
  const r = rz?.resultado;
  if (!rz?.en || !r) return [];
  const difs = [];
  const vistos = new Set();
  for (const d of r.diferenciales || []) {
    const nombre = recortar(d?.diagnostico, 160);
    if (!nombre || vistos.has(nombre.toLowerCase())) continue;
    vistos.add(nombre.toLowerCase());
    difs.push({ diagnostico: nombre, aFavor: lista(d.aFavor, 5), enContra: lista(d.enContra, 5), estudio: recortar(d.estudio, 200) });
  }
  if (!difs.length) return [];
  const primero = difs[0];
  const caso = casoDe(consulta, paciente);
  const hayCaso = Boolean(caso.motivo || caso.sintomas.length);
  const perla = recortar(r.perla, 300);
  const tarjetas = [];

  // Sin motivo ni síntomas no hay caso que leer: elegir entre diagnósticos
  // sería adivinar.
  if (hayCaso && difs.length >= 2) {
    const elegidos = azar(difs.slice(0, 4));
    tarjetas.push({
      tipo: "dx", caso, perla,
      opciones: elegidos.map(d => d.diagnostico),
      correcta: elegidos.indexOf(primero),
      respuesta: [primero.diagnostico],
      aFavor: primero.aFavor,
      // Lo que va en contra de cada opción: al que eligió otra, se le muestra
      // por qué no era.
      enContraDe: elegidos.map(d => d.enContra.join("; ").slice(0, 400)),
    });
  }
  if (primero.estudio) {
    tarjetas.push({ tipo: "estudio", caso, perla, sobre: primero.diagnostico, respuesta: [primero.estudio] });
  }
  // Sin caso para leer, la pregunta tiene que decir de qué cuadro se trata.
  const sobre = hayCaso ? "" : primero.diagnostico;
  const banderas = lista(r.banderasRojas, 3);
  if (banderas.length) tarjetas.push({ tipo: "banderas", caso, perla, sobre, respuesta: banderas });
  const falto = lista(r.faltoPreguntar, 3);
  if (falto.length) tarjetas.push({ tipo: "faltoPreguntar", caso, perla, sobre, respuesta: falto });
  return tarjetas;
}

// Crea las que falten de una consulta. Se puede llamar las veces que sea: la
// base no deja dos del mismo tipo para la misma consulta.
async function crearTarjetasDeConsulta(consultaId, ahora = new Date()) {
  const consulta = await ConsultaMedica.findById(consultaId)
    .select("medicoPhone pacienteId createdAt notaClinica.motivoConsulta notaClinica.sintomas notaClinica.antecedentesRelevantes razonamiento")
    .lean();
  if (!consulta?.razonamiento?.en) return 0;
  const paciente = await Paciente.findOne({ _id: consulta.pacienteId, medicoPhone: consulta.medicoPhone })
    .select("sexo fechaNacimiento").lean();
  let creadas = 0;
  for (const { tipo, ...resto } of tarjetasDeCaso(consulta, paciente)) {
    try {
      const r = await TarjetaEstudio.updateOne(
        { consultaId: consulta._id, tipo },
        { $setOnInsert: { ...resto, medicoPhone: consulta.medicoPhone, caja: 1, proxima: ahora } },
        { upsert: true });
      if (r.upsertedCount) creadas++;
    } catch (e) {
      if (e?.code !== 11000) throw e;   // otro pedido la creó en el mismo momento
    }
  }
  return creadas;
}

// Las de los razonamientos que todavía no tienen tarjetas: los que se
// hicieron antes de que esto existiera, o si crearlas falló en el momento.
async function asegurarTarjetas(medicoPhone, ahora = new Date()) {
  const [conRazonamiento, conTarjetas] = await Promise.all([
    ConsultaMedica.find({ medicoPhone, "razonamiento.en": { $ne: null } }).select("_id").lean(),
    TarjetaEstudio.distinct("consultaId", { medicoPhone }),
  ]);
  const tienen = new Set(conTarjetas.map(String));
  let creadas = 0;
  for (const c of conRazonamiento.filter(x => !tienen.has(String(x._id))).slice(0, 20)) {
    creadas += await crearTarjetasDeConsulta(c._id, ahora);
  }
  return creadas;
}

// ─── LO QUE SE MUESTRA ─────────────────────────────────────────────────────

const vigentes = (medicoPhone) => ({ medicoPhone, "reportada.en": null });

async function tarjetasParaHoy(medicoPhone, ahora = new Date()) {
  const xs = await TarjetaEstudio.find({ ...vigentes(medicoPhone), proxima: { $lte: ahora } })
    .sort({ proxima: 1 }).limit(200).lean();
  return xs.sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || a.proxima - b.proxima).slice(0, POR_SESION);
}

// Para el que terminó lo de hoy y quiere más: las que menos sabe primero.
async function tarjetasDeRepaso(medicoPhone, ahora = new Date()) {
  return TarjetaEstudio.find({ ...vigentes(medicoPhone), proxima: { $gt: ahora } })
    .sort({ caja: 1, ultimaVez: 1 }).limit(POR_REPASO).lean();
}

// Una de opción múltiple viaja sin la respuesta, con las opciones en otro
// orden cada vez (cada una con su número original, que es lo que se
// contesta): si siempre estuviera en el mismo lugar, se aprendería el lugar.
// Las de «me acordaba / no me acordaba» llevan la respuesta, que la pantalla
// muestra recién cuando él la pide.
function paraMostrar(t, azar = mezclar) {
  const base = { _id: t._id, tipo: t.tipo, consultaId: t.consultaId, caso: t.caso, sobre: t.sobre || "", caja: t.caja };
  if (t.tipo === "dx") return { ...base, opciones: azar((t.opciones || []).map((texto, i) => ({ i, texto }))) };
  return { ...base, respuesta: t.respuesta || [], perla: t.perla || "" };
}

// ─── RESPONDER ─────────────────────────────────────────────────────────────

function validarId(id) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(404, "Tarjeta no encontrada");
}

// respuesta: { opcion } en las de diagnóstico (el número original de la
// opción), { recordaba: true|false } en las otras.
async function responder(medicoPhone, tarjetaId, respuesta, zona, ahora = new Date()) {
  validarId(tarjetaId);
  const t = await TarjetaEstudio.findOne({ _id: tarjetaId, medicoPhone }).lean();
  if (!t) throw new ErrorHttp(404, "Tarjeta no encontrada");
  let correcto, elegida = null;
  if (t.tipo === "dx") {
    elegida = Number(respuesta?.opcion);
    if (!Number.isInteger(elegida) || elegida < 0 || elegida >= (t.opciones || []).length) throw new ErrorHttp(400, "Elegí una de las opciones.");
    correcto = elegida === t.correcta;
  } else {
    if (typeof respuesta?.recordaba !== "boolean") throw new ErrorHttp(400, "Falta decir si te acordabas.");
    correcto = respuesta.recordaba;
  }
  // Un doble toque: el segundo llega con la tarjeta ya respondida y, como
  // ya no «tocaba», contaría como un repaso más. Nadie relee y contesta la
  // misma pregunta en menos de 3 segundos.
  if (t.ultimaVez && ahora - new Date(t.ultimaVez) < REPETIDA_MS) throw new ErrorHttp(409, "Esa tarjeta ya se respondió.");

  const tocaba = new Date(t.proxima) <= ahora;
  const set = { ultimaVez: ahora };
  if (!correcto) {
    set.caja = 1;
    set.proxima = inicioDeDia(zona, ahora, 1);
  } else if (tocaba) {
    set.caja = Math.min(CAJA_MAX, t.caja + 1);
    set.proxima = inicioDeDia(zona, ahora, t.caja >= CAJA_MAX ? DIAS_CAJA_LLENA : DIAS_TRAS_ACIERTO[set.caja]);
  }
  // Y si los dos llegan a la vez, el segundo ya no encuentra la tarjeta
  // como estaba.
  const r = await TarjetaEstudio.updateOne({ _id: t._id, vistas: t.vistas },
    { $set: set, $inc: { vistas: 1, [correcto ? "aciertos" : "errores"]: 1 } });
  if (!r.modifiedCount) throw new ErrorHttp(409, "Esa tarjeta ya se respondió.");

  const caja = set.caja ?? t.caja;
  return {
    correcto,
    caja,
    dominada: caja >= CAJA_DOMINADA,
    proxima: set.proxima ?? t.proxima,
    respuesta: t.respuesta || [],
    perla: t.perla || "",
    ...(t.tipo === "dx" ? {
      correcta: t.correcta,
      aFavor: t.aFavor || [],
      enContraElegida: correcto ? "" : (t.enContraDe || [])[elegida] || "",
    } : {}),
    racha: await marcarDiaDeEstudio(medicoPhone, zona, ahora),
  };
}

async function reportar(medicoPhone, tarjetaId, motivo, ahora = new Date()) {
  validarId(tarjetaId);
  if (!MOTIVOS_REPORTE.includes(motivo)) throw new ErrorHttp(400, "Elegí qué está mal.");
  const r = await TarjetaEstudio.updateOne({ _id: tarjetaId, medicoPhone },
    { $set: { "reportada.en": ahora, "reportada.motivo": motivo } });
  if (!r.matchedCount) throw new ErrorHttp(404, "Tarjeta no encontrada");
}

// Por si tocó «está mal» sin querer.
async function deshacerReporte(medicoPhone, tarjetaId) {
  validarId(tarjetaId);
  const r = await TarjetaEstudio.updateOne({ _id: tarjetaId, medicoPhone },
    { $set: { "reportada.en": null, "reportada.motivo": "" } });
  if (!r.matchedCount) throw new ErrorHttp(404, "Tarjeta no encontrada");
}

// ─── LA RACHA ──────────────────────────────────────────────────────────────

// Cuenta el día de hoy, una vez. Si dos respuestas llegan juntas, la segunda
// ya encuentra el día anotado (el update solo pasa si nadie lo cambió).
async function marcarDiaDeEstudio(medicoPhone, zona, ahora = new Date()) {
  const hoy = fechaStrEnZona(zona, ahora);
  for (let intento = 0; intento < 3; intento++) {
    const m = await Medico.findOne({ phone: medicoPhone }).select("estudiante").lean();
    if (!m?.estudiante?.nivel) return null;
    const r = m.estudiante.racha || {};
    const previo = r.ultimoDia || "";
    if (previo === hoy) return { actual: r.actual || 0, mejor: r.mejor || 0, hoyHecho: true, subio: false };
    const actual = previo && previo === diaAnterior(hoy) ? (r.actual || 0) + 1 : 1;
    const mejor = Math.max(r.mejor || 0, actual);
    const res = await Medico.updateOne(
      { phone: medicoPhone, "estudiante.racha.ultimoDia": previo || { $in: [null, ""] } },
      { $set: { "estudiante.racha": { actual, mejor, ultimoDia: hoy } } });
    if (res.modifiedCount) return { actual, mejor, hoyHecho: true, subio: true };
  }
  return null;
}

// Como se ve: si el último día no fue hoy ni ayer, la racha ya se cortó
// aunque el número guardado siga ahí.
function rachaVisible(r, zona, ahora = new Date()) {
  const hoy = fechaStrEnZona(zona, ahora);
  const ultimo = r?.ultimoDia || "";
  const viva = Boolean(ultimo) && (ultimo === hoy || ultimo === diaAnterior(hoy));
  return { actual: viva ? r.actual || 0 : 0, mejor: r?.mejor || 0, hoyHecho: ultimo === hoy };
}

// ─── LOGROS ────────────────────────────────────────────────────────────────
//
// Se calculan cada vez con los mismos números de la pantalla: no hay nada
// guardado que se pueda desincronizar. El orden es el de la pantalla.
const LOGROS = [
  { id: "primerCaso", dato: "casos", meta: 1 },
  { id: "casos10", dato: "casos", meta: 10 },
  { id: "casos50", dato: "casos", meta: 50 },
  { id: "aciertos5", dato: "acertados", meta: 5 },
  { id: "aciertos25", dato: "acertados", meta: 25 },
  { id: "racha3", dato: "mejorRacha", meta: 3 },
  { id: "racha7", dato: "mejorRacha", meta: 7 },
  { id: "racha30", dato: "mejorRacha", meta: 30 },
  { id: "dominadas10", dato: "dominadas", meta: 10 },
  { id: "dominadas50", dato: "dominadas", meta: 50 },
];

// grupo: la pantalla muestra los logrados y, de cada grupo, solo el próximo.
function logrosDe(numeros) {
  return LOGROS.map(l => {
    const n = numeros[l.dato] || 0;
    return { id: l.id, grupo: l.dato, meta: l.meta, actual: Math.min(n, l.meta), hecho: n >= l.meta };
  });
}

// ─── EL RESUMEN ────────────────────────────────────────────────────────────

// Las consultas que todavía puede razonar: con la nota lista y con algo que
// leer — el mismo criterio que la tarjeta de public/js/consultas.js.
async function casosPorRazonar(medicoPhone, max = 5) {
  const palabras = (campo) => ({ $size: { $split: [{ $ifNull: [campo, ""] }, " "] } });
  const xs = await ConsultaMedica.aggregate([
    { $match: { medicoPhone, notaClinicaEstado: "completado", "razonamiento.en": null } },
    { $sort: { createdAt: -1 } },
    { $limit: 50 },
    { $project: { createdAt: 1, motivo: "$notaClinica.motivoConsulta",
      palabras: { $max: [palabras("$transcripcionCompleta"), palabras("$transcripcionEnVivo")] } } },
    { $match: { palabras: { $gte: PALABRAS_MINIMAS } } },
  ]);
  return { total: xs.length, casos: xs.slice(0, max).map(x => ({ _id: x._id, fecha: x.createdAt, motivo: recortar(x.motivo, 120) })) };
}

async function resumen(medicoPhone, zona, ahora = new Date()) {
  const [porCaja, paraHoy, casos, acertados, medico, porRazonar] = await Promise.all([
    TarjetaEstudio.aggregate([
      { $match: vigentes(medicoPhone) },
      { $group: { _id: "$caja", n: { $sum: 1 }, aciertos: { $sum: "$aciertos" }, errores: { $sum: "$errores" } } },
    ]),
    TarjetaEstudio.countDocuments({ ...vigentes(medicoPhone), proxima: { $lte: ahora } }),
    ConsultaMedica.countDocuments({ medicoPhone, "razonamiento.en": { $ne: null } }),
    ConsultaMedica.countDocuments({ medicoPhone, "razonamiento.en": { $ne: null }, "razonamiento.resultado.acertoPrincipal": true }),
    Medico.findOne({ phone: medicoPhone }).select("estudiante.racha").lean(),
    casosPorRazonar(medicoPhone),
  ]);
  const suma = (campo, filtro = () => true) => porCaja.filter(filtro).reduce((s, x) => s + x[campo], 0);
  const dominadas = suma("n", x => x._id >= CAJA_DOMINADA);
  const aciertos = suma("aciertos");
  const respuestas = aciertos + suma("errores");
  const racha = rachaVisible(medico?.estudiante?.racha, zona, ahora);
  return {
    racha,
    paraHoy,
    total: suma("n"),
    dominadas,
    aciertosPct: respuestas ? Math.round((aciertos * 100) / respuestas) : null,
    casos,
    acertados,
    porRazonar,
    logros: logrosDe({ casos, acertados, mejorRacha: racha.mejor, dominadas }),
  };
}

module.exports = {
  CAJA_MAX, CAJA_DOMINADA, DIAS_TRAS_ACIERTO, DIAS_CAJA_LLENA, POR_SESION, MOTIVOS_REPORTE, LOGROS,
  inicioDeDia, diaAnterior, zonaDe, casoDe, tarjetasDeCaso, crearTarjetasDeConsulta, asegurarTarjetas,
  tarjetasParaHoy, tarjetasDeRepaso, paraMostrar, responder, reportar, deshacerReporte,
  marcarDiaDeEstudio, rachaVisible, logrosDe, casosPorRazonar, resumen,
};
