// Symphomed Ganadería — reproducción de hembras (vacas y cerdas): en qué
// estado está cada una, cuándo pare, qué diagnóstico se atrasó.
//
// Mismo criterio que services/lotesGanado.js y services/esquemaVacunas.js:
// se calcula ACÁ, a partir de los eventos cargados, y no se guarda un
// "estado" aparte. Así no hay dos verdades que mantener en sincronía —si
// alguien corrige la fecha de un servicio, la fecha de parto se corrige
// sola— y una vaca no puede figurar preñada en el celular y vacía en el
// escritorio.
//
// ⚠️ LOS NÚMEROS DE ABAJO NO LOS REVISÓ TODAVÍA UN VETERINARIO. Son los
// valores de referencia más difundidos (gestación bovina ~283 días, porcina
// 114 — "tres meses, tres semanas y tres días"), pero varían por raza y por
// criterio del establecimiento. Tratalos como un borrador informado.

const GESTACION_DIAS = { bovino: 283, porcino: 114 };

// Desde cuántos días después del servicio tiene sentido confirmar la
// preñez: palpación o ecografía en la vaca, repetición de celo o ecografía
// en la cerda. Antes de esto el diagnóstico no es confiable, así que antes
// de esto tampoco se avisa que "falta".
const DIAGNOSTICO_DESDE_DIAS = { bovino: 35, porcino: 28 };

// Con cuántos días de anticipación un parto pasa a ser "próximo": lo que el
// veterinario necesita para preparar la maternidad o el potrero de parición.
const PARTO_PROXIMO_DIAS = { bovino: 15, porcino: 7 };

// Pasada la fecha probable por más de esto sin parto cargado, algo no
// cierra: o parió y nadie lo anotó, o el servicio no prendió y el
// diagnóstico fue un error. En cualquiera de los dos casos hay que mirarla.
const PARTO_ATRASADO_DIAS = 10;

// Días abiertos (del parto a la nueva preñez) a partir de los cuales una
// vaca vacía es un problema económico: con un parto por año como meta,
// pasados los ~90 días ya no llega. Solo bovinos — en la cerda el ritmo lo
// marca el destete, no esto.
const VACIA_PROLONGADA_DIAS = 90;

const DIA = 86400000;

function dias(desde, hasta) {
  return Math.floor((new Date(hasta) - new Date(desde)) / DIA);
}

function sumarDias(fecha, n) {
  return new Date(new Date(fecha).getTime() + n * DIA);
}

function ordenados(eventos) {
  return (eventos || []).slice().sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

// ─── EL ESTADO DE UNA HEMBRA ────────────────────────────────────────────────
//
// No es una sola máquina de estados porque en la vaca dos cosas pasan a la
// vez: puede estar lactando (parió hace tres meses) Y preñada otra vez (la
// sirvieron hace uno). Por eso son dos preguntas separadas:
//
//   prenez:   "vacia" | "servida" (sin diagnóstico todavía) | "prenada"
//   lactando: true | false
//
// El ciclo de preñez actual es lo que pasó DESPUÉS del último parto o
// aborto: lo anterior ya terminó, y un servicio de hace dos partos no dice
// nada sobre hoy.
function estadoReproductivo(animal, eventos, ahora = new Date()) {
  const lista = ordenados(eventos);
  const especie = animal?.especie;

  const partos = lista.filter(e => e.tipo === "parto");
  const ultimoParto = partos[partos.length - 1] || null;
  const cierres = lista.filter(e => e.tipo === "parto" || e.tipo === "aborto");
  const ultimoCierre = cierres[cierres.length - 1] || null;
  const cicloActual = ultimoCierre
    ? lista.filter(e => new Date(e.fecha) > new Date(ultimoCierre.fecha))
    : lista;

  const servicios = cicloActual.filter(e => e.tipo === "servicio");
  const ultimoServicio = servicios[servicios.length - 1] || null;
  // Solo cuenta un diagnóstico hecho DESPUÉS del último servicio: un "vacía"
  // de antes de volver a servirla no dice nada sobre el servicio nuevo.
  const diagnostico = ultimoServicio
    ? cicloActual.filter(e => e.tipo === "diagnostico" && new Date(e.fecha) >= new Date(ultimoServicio.fecha)).pop() || null
    : null;

  let prenez = "vacia";
  if (ultimoServicio) {
    if (!diagnostico) prenez = "servida";
    else prenez = diagnostico.resultado === "prenada" ? "prenada" : "vacia";
  }

  const finLactancia = ultimoParto
    ? lista.find(e => (e.tipo === "destete" || e.tipo === "secado") && new Date(e.fecha) >= new Date(ultimoParto.fecha))
    : null;
  const lactando = Boolean(ultimoParto && !finLactancia);

  const gestacion = GESTACION_DIAS[especie] || null;
  const fechaProbableParto = (prenez === "prenada" || prenez === "servida") && ultimoServicio && gestacion
    ? sumarDias(ultimoServicio.fecha, gestacion)
    : null;

  // Días abiertos: del último parto a la preñez nueva (el servicio que
  // prendió) o, si todavía no hay, a hoy. Es EL número de la eficiencia de
  // un tambo: cada día abierto de más es un día sin producir cría.
  let diasAbiertos = null;
  if (ultimoParto) {
    const hasta = prenez === "prenada" && ultimoServicio ? ultimoServicio.fecha : ahora;
    diasAbiertos = Math.max(0, dias(ultimoParto.fecha, hasta));
  }

  return { prenez, lactando, ultimoServicio, ultimoParto, fechaProbableParto, diasAbiertos };
}

// ─── LOS INDICADORES DE SU HISTORIA ─────────────────────────────────────────
function indicadores(eventos) {
  const partos = ordenados(eventos).filter(e => e.tipo === "parto");
  const intervalos = [];
  for (let i = 1; i < partos.length; i++) intervalos.push(dias(partos[i - 1].fecha, partos[i].fecha));

  const conVivas = partos.filter(p => Number.isFinite(p.criasVivas));
  const destetes = (eventos || []).filter(e => e.tipo === "destete" && Number.isFinite(e.criasDestetadas));
  const promedio = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  return {
    partos: partos.length,
    // Intervalo entre partos: con uno solo no hay intervalo, y un promedio
    // de cero intervalos no es 0 — es "todavía no se sabe".
    intervaloEntrePartosPromedio: promedio(intervalos),
    criasVivasPromedio: promedio(conVivas.map(p => p.criasVivas)),
    criasDestetadasPromedio: promedio(destetes.map(d => d.criasDestetadas)),
  };
}

// ─── LO QUE HAY QUE MIRAR ───────────────────────────────────────────────────
//
// Mismo criterio que el esquema de vacunas: lo que se atrasó se DICE. Una
// vaca a la que nadie le hizo el diagnóstico no está "servida y todo bien":
// está con un dato faltante que cuesta plata cada día que pasa.
function alertas(animal, estado, ahora = new Date()) {
  const especie = animal?.especie;
  const lista = [];

  if (estado.prenez === "servida" && estado.ultimoServicio) {
    const desde = DIAGNOSTICO_DESDE_DIAS[especie];
    const transcurridos = dias(estado.ultimoServicio.fecha, ahora);
    if (desde != null && transcurridos >= desde) {
      lista.push({ tipo: "diagnostico_pendiente", dias: transcurridos });
    }
  }

  if (estado.fechaProbableParto && estado.prenez === "prenada") {
    const faltan = dias(ahora, estado.fechaProbableParto);
    const anticipacion = PARTO_PROXIMO_DIAS[especie];
    if (faltan < -PARTO_ATRASADO_DIAS) {
      lista.push({ tipo: "parto_atrasado", dias: -faltan, fecha: estado.fechaProbableParto });
    } else if (anticipacion != null && faltan <= anticipacion) {
      lista.push({ tipo: "parto_proximo", dias: faltan, fecha: estado.fechaProbableParto });
    }
  }

  if (especie === "bovino" && estado.prenez === "vacia" && estado.diasAbiertos != null && estado.diasAbiertos > VACIA_PROLONGADA_DIAS) {
    lista.push({ tipo: "vacia_prolongada", dias: estado.diasAbiertos });
  }

  return lista;
}

function resumenHembra(animal, eventos, ahora = new Date()) {
  const estado = estadoReproductivo(animal, eventos, ahora);
  return {
    prenez: estado.prenez,
    lactando: estado.lactando,
    fechaProbableParto: estado.fechaProbableParto,
    diasAbiertos: estado.diasAbiertos,
    ultimoServicio: estado.ultimoServicio ? estado.ultimoServicio.fecha : null,
    ultimoParto: estado.ultimoParto ? estado.ultimoParto.fecha : null,
    indicadores: indicadores(eventos),
    alertas: alertas(animal, estado, ahora),
  };
}

// El resumen del lote entero: lo que el veterinario mira al llegar al campo.
// El % de preñez se calcula sobre las hembras activas, no sobre todas las
// cargadas — una vaca vendida el mes pasado no puede bajarle el índice al
// rodeo de hoy.
function resumenLote(resumenes, ahora = new Date()) {
  const activas = resumenes.filter(r => r.activa !== false);
  const prenadas = activas.filter(r => r.prenez === "prenada").length;
  const proximosPartos = activas
    .filter(r => r.prenez === "prenada" && r.fechaProbableParto)
    .map(r => ({ animalId: r.animalId, identificador: r.identificador, fecha: r.fechaProbableParto, dias: dias(ahora, r.fechaProbableParto) }))
    .filter(p => p.dias >= -PARTO_ATRASADO_DIAS)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .slice(0, 10);
  return {
    hembras: activas.length,
    prenadas,
    porcentajePrenez: activas.length ? (prenadas / activas.length) * 100 : 0,
    diagnosticosPendientes: activas.filter(r => r.alertas.some(a => a.tipo === "diagnostico_pendiente")).length,
    proximosPartos,
  };
}

module.exports = {
  GESTACION_DIAS, DIAGNOSTICO_DESDE_DIAS, PARTO_PROXIMO_DIAS, PARTO_ATRASADO_DIAS, VACIA_PROLONGADA_DIAS,
  estadoReproductivo, indicadores, alertas, resumenHembra, resumenLote,
};
