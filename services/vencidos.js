// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Lo que se pasó
// ═══════════════════════════════════════════════════════════════════════════
// El panel que le dice al profesional qué se le está yendo de las manos, sin
// que él lo pida y sin que tenga que entrar a ninguna ficha.
//
// ═══ POR QUÉ ESTO VALE MÁS QUE UN MÓDULO 3D ════════════════════════════════
//
// Un dibujo impresiona una vez, en la demostración. Esto es lo que hace que
// el médico piense "esto me está cuidando la espalda mientras yo atiendo", y
// esa frase es la que cierra la venta. Además sirve para las OCHO ramas con
// un solo desarrollo, mientras que cada dibujo sirve para una.
//
// Y en veterinaria no es una comodidad: es ingreso. A una clínica el paciente
// no le vuelve porque se enferme, le vuelve porque le toca la vacuna. Un
// perro que se pasó el refuerzo es plata que no entró — y hasta ahora el
// único que llevaba ese calendario era la cabeza del veterinario.
//
// ═══ TRES REGLAS QUE NO SE AFLOJAN ═════════════════════════════════════════
//
// · SOLO LO QUE SE PASÓ, NO LO QUE VIENE. Si acá entrara "lo de la semana
//   que viene", la lista crecería hasta volverse ruido y el médico dejaría
//   de mirarla. Lo que viene ya está en la agenda y en los recordatorios.
//
// · CADA ÍTEM DICE QUÉ HACER. "Antirrábica vencida hace 3 meses" es
//   accionable; "revisar vacunas" no. Un panel de avisos que no dice qué
//   hacer se apaga a la semana.
//
// · NUNCA BLOQUEA LA PANTALLA. Se pide aparte del panel y si falla o tarda,
//   el médico entra igual. Mismo criterio que la bandeja DICOM.
const { Paciente, Recordatorio, Vacuna, VigilanciaSalud, TratamientoPlan } = require("../db/models");
const esquemaVacunas = require("./esquemaVacunas");
const { estadoVigilancia } = require("./vigilancia");

// Cuánto hace que se pasó, en días. Es lo que ordena la lista: lo más viejo
// primero, porque es lo que más urge y lo que más vergüenza da.
const diasDesde = (fecha) => Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);

// Cuántos pacientes se revisan como mucho. No es una optimización prematura:
// esto corre cada vez que el médico abre su panel, y un consultorio con tres
// mil fichas no puede pagar un recorrido completo para pintar una tarjeta.
// Se ordenan por última atención, que es donde están los que importan.
const TOPE_PACIENTES = 400;
// Un plan de tratamiento aprobado y sin tocar por más de este tiempo dejó de
// ser "en curso" y pasó a ser plata sobre la mesa.
const DIAS_TRATAMIENTO_PARADO = 60;
// Cuántos ítems salen por grupo. Una lista de doscientos no se lee.
const TOPE_POR_GRUPO = 12;

function enPalabras(dias) {
  if (dias < 45) return `hace ${dias} días`;
  const meses = Math.round(dias / 30.4);
  if (meses < 18) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
  return `hace ${Math.floor(dias / 365)} años`;
}

// ─── 1. RECORDATORIOS VENCIDOS ─────────────────────────────────────────────
// Sirve para las ocho ramas: es lo que el propio profesional se anotó y se
// le pasó. El más barato de calcular y el más difícil de discutir.
async function recordatoriosVencidos(medicoPhone) {
  const items = await Recordatorio.find({ medicoPhone, completado: false, fecha: { $lt: new Date() } })
    .sort({ fecha: 1 }).limit(TOPE_POR_GRUPO).lean();
  return items.map(r => ({
    pacienteId: r.pacienteId,
    paciente: r.pacienteNombre,
    que: r.titulo,
    detalle: `Lo anotaste para el ${new Date(r.fecha).toLocaleDateString("es-BO")}`,
    dias: diasDesde(r.fecha),
    gravedad: "atrasado",
    tab: "paciente",
  }));
}

// ─── 2. VACUNAS DEL ANIMAL ─────────────────────────────────────────────────
// Dos queries y el resto en memoria: una por paciente sería una por fila, y
// con trescientas fichas eso es trescientas idas a la base para dibujar una
// tarjeta.
async function vacunasPetVencidas(medicoPhone) {
  const pacientes = await Paciente.find({
    medicoPhone,
    especie: { $nin: ["", null] },
    fechaNacimiento: { $ne: null },
  }).select("_id nombre especie fechaNacimiento").sort({ updatedAt: -1 }).limit(TOPE_PACIENTES).lean();
  if (!pacientes.length) return [];

  const aplicadas = await Vacuna.find({ pacienteId: { $in: pacientes.map(p => p._id) } })
    .select("pacienteId nombre dosis fecha").lean();
  const porPaciente = new Map();
  for (const v of aplicadas) {
    const k = String(v.pacienteId);
    if (!porPaciente.has(k)) porPaciente.set(k, []);
    porPaciente.get(k).push(v);
  }

  const salida = [];
  for (const p of pacientes) {
    const esquema = esquemaVacunas.esquemaPara(p.especie);
    if (!esquema) continue;
    const edad = esquemaVacunas.edadEnSemanas(p.fechaNacimiento);
    if (edad == null) continue;
    const suyas = porPaciente.get(String(p._id)) || [];

    for (const item of esquema) {
      // Solo las del núcleo: las "según riesgo" dependen de dónde vive el
      // animal y de qué hace, y el sistema no lo sabe. Ponerlas acá le
      // reclamaría al veterinario una leptospirosis a un perro de
      // departamento, y a la tercera vez deja de mirar el panel.
      if (!item.nucleo) continue;
      const puestas = suyas.filter(v => coincide(item, v)).map(v => ({ fecha: v.fecha }));
      const e = esquemaVacunas.estadoVacuna(item, edad, puestas);
      if (e.estado !== "vencida" && e.estado !== "perdida") continue;

      const cuando = e.proxima || null;
      salida.push({
        pacienteId: p._id,
        paciente: p.nombre,
        que: item.nombre,
        detalle: e.estado === "perdida"
          ? "No se puso en la edad que corresponde"
          : cuando ? `Tocaba el ${new Date(cuando).toLocaleDateString("es-BO")}` : "",
        dias: cuando ? diasDesde(cuando) : 0,
        gravedad: e.estado,
        tab: "vacunas",
      });
    }
  }
  return salida.sort((a, b) => b.dias - a.dias).slice(0, TOPE_POR_GRUPO);
}

// El cruce entre lo que el veterinario ESCRIBIÓ a mano y el ítem del esquema.
// Es una versión reducida del `corresponde` de routes/vacunasPet.js: acá
// alcanza con no confundir una antirrábica con una polivalente, porque el
// panel no dice cuál dosis falta sino que falta.
function coincide(item, vacuna) {
  const limpio = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const texto = limpio(`${vacuna.nombre} ${vacuna.dosis}`);
  const clave = limpio(item.nombre).split(/[\s—–-]+/).filter(p => p.length > 3)[0] || "";
  if (!clave || !texto) return false;
  if (texto.includes(clave)) return true;
  // Los sinónimos que usa todo el mundo y que el nombre del esquema no tiene.
  if (/polivalente/.test(clave)) return /quintuple|sextuple|\bv[5-8]\b|polivalente/.test(texto);
  if (/antirrabica/.test(clave)) return /rabia|antirrabic/.test(texto);
  if (/desparasitacion/.test(clave)) return /desparasit|antiparasit/.test(texto);
  return false;
}

// ─── 3. VIGILANCIA DE SALUD ATRASADA (neurodesarrollo) ─────────────────────
// Son los controles que hay que ir a BUSCAR: no aparecen solos. Si nadie
// lleva el calendario se pasan años enteros, y eso es exactamente lo que
// pasa hoy en la mayoría de las familias.
async function vigilanciaAtrasada(medicoPhone) {
  const items = await VigilanciaSalud.find({ medicoPhone }).lean();
  if (!items.length) return [];
  const ids = [...new Set(items.map(i => String(i.pacienteId)))];
  const pacientes = await Paciente.find({ _id: { $in: ids } })
    .select("_id nombre fechaNacimiento").lean();
  const porId = new Map(pacientes.map(p => [String(p._id), p]));

  const salida = [];
  for (const i of items) {
    const p = porId.get(String(i.pacienteId));
    // Sin fecha de nacimiento no se puede saber si corresponde: se calla, no
    // se inventa una edad.
    if (!p?.fechaNacimiento) continue;
    const meses = (Date.now() - new Date(p.fechaNacimiento).getTime()) / (30.4375 * 86400000);
    const e = estadoVigilancia(i, meses);
    if (e.estado !== "atrasado") continue;
    salida.push({
      pacienteId: p._id,
      paciente: p.nombre,
      que: i.nombre,
      detalle: e.ultimo
        ? `El último fue el ${new Date(e.ultimo.fecha).toLocaleDateString("es-BO")}`
        : "Nunca se hizo",
      dias: diasDeAtraso(i, e, meses),
      gravedad: "atrasado",
      tab: "salud",
    });
  }
  return salida.sort((a, b) => b.dias - a.dias).slice(0, TOPE_POR_GRUPO);
}

// Cuánto hace que se VENCIÓ, que no es lo mismo que cuánto hace que se hizo
// por última vez.
//
// Esto salió de mirar el panel con datos de verdad: un perfil tiroideo anual
// hecho hace 13 meses figuraba como "hace 13 meses" en una columna que el
// lector interpreta como atraso — cuando lleva UN mes de atraso. El error
// infla todo y el panel empieza a gritar; a la tercera vez que exagera, el
// médico deja de creerle y ahí se pierde lo que sí urgía.
function diasDeAtraso(item, estado, edadMeses) {
  const MES = 30.4375;
  if (estado.ultimo && item.cadaMeses) {
    // Se hizo, pero ya pasó el intervalo: el atraso corre desde que tocaba.
    return Math.max(0, Math.round(diasDesde(estado.ultimo.fecha) - item.cadaMeses * MES));
  }
  // Nunca se hizo y se cerró la ventana: el atraso corre desde que se cerró.
  if (item.hastaMeses != null) return Math.max(0, Math.round((edadMeses - item.hastaMeses) * MES));
  return Math.max(0, Math.round((edadMeses - (item.desdeMeses ?? 0)) * MES));
}

// ─── 4. TRATAMIENTOS APROBADOS Y PARADOS (odontología y estética) ──────────
// Un plan presupuestado que lleva dos meses sin moverse dejó de estar "en
// curso": es plata sobre la mesa que nadie fue a buscar. Es el único grupo
// que habla de dinero y no de salud, y por eso se dice con ese nombre.
async function tratamientosParados(medicoPhone) {
  const corte = new Date(Date.now() - DIAS_TRATAMIENTO_PARADO * 86400000);
  const items = await TratamientoPlan.find({
    medicoPhone, estado: "pendiente", updatedAt: { $lt: corte },
  }).sort({ updatedAt: 1 }).limit(TOPE_POR_GRUPO).lean();
  if (!items.length) return [];

  const pacientes = await Paciente.find({ _id: { $in: items.map(i => i.pacienteId) } })
    .select("_id nombre").lean();
  const porId = new Map(pacientes.map(p => [String(p._id), p.nombre]));

  return items.map(i => ({
    pacienteId: i.pacienteId,
    paciente: porId.get(String(i.pacienteId)) || "",
    que: i.nombre,
    detalle: "Aprobado y sin empezar",
    dias: diasDesde(i.updatedAt),
    gravedad: "parado",
    tab: "plan",
  })).filter(i => i.paciente);
}

// ─── EL PANEL ──────────────────────────────────────────────────────────────
//
// Los grupos se piden todos en paralelo y cada uno se banca solo: si la
// consulta de vacunas falla, el resto del panel se dibuja igual. Un panel de
// avisos que desaparece entero porque una de cuatro consultas falló es peor
// que no tenerlo, porque el médico deja de confiar en que esté completo.
const GRUPOS = [
  { clave: "recordatorios", titulo: "Se te pasaron", fn: recordatoriosVencidos },
  { clave: "vacunas", titulo: "Vacunas vencidas", fn: vacunasPetVencidas },
  { clave: "vigilancia", titulo: "Controles atrasados", fn: vigilanciaAtrasada },
  { clave: "tratamientos", titulo: "Aprobados y sin empezar", fn: tratamientosParados },
];

async function loQueSePaso(medicoPhone) {
  const resultados = await Promise.all(
    GRUPOS.map(g => g.fn(medicoPhone).catch(() => null))
  );
  const grupos = [];
  let total = 0, parcial = false;
  resultados.forEach((items, i) => {
    if (items === null) { parcial = true; return; }
    if (!items.length) return;
    total += items.length;
    grupos.push({
      clave: GRUPOS[i].clave,
      titulo: GRUPOS[i].titulo,
      items: items.map(x => ({ ...x, hace: enPalabras(x.dias) })),
    });
  });
  // `parcial` le dice a la pantalla que esto puede estar incompleto. Sin eso,
  // un grupo que falló se ve igual que un grupo vacío — y "no tenés nada
  // vencido" cuando en realidad no se pudo averiguar es la peor mentira que
  // puede decir este panel.
  return { total, grupos, parcial };
}

module.exports = {
  loQueSePaso, enPalabras, coincide,
  recordatoriosVencidos, vacunasPetVencidas, vigilanciaAtrasada, tratamientosParados,
  DIAS_TRATAMIENTO_PARADO, TOPE_POR_GRUPO,
};
