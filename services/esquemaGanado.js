// Symphomed Ganadería — el calendario sanitario de un lote: qué vacunas
// (y desparasitaciones) le tocan por su especie y su edad, y cuáles ya se
// aplicaron.
//
// Mismo criterio que services/esquemaVacunas.js (perros y gatos): no se
// guarda nada nuevo. Se cruzan los eventos de vacunación YA CARGADOS en el
// lote contra el esquema de la especie, y se dice el estado de cada ítem.
// Así la vacunación cargada sigue siendo la única fuente de verdad.
//
// ═══ LAS TRES CLASES DE ÍTEM ══════════════════════════════════════════════
//
//   · Por edad: tiene una ventana (desde/hasta, en DÍAS de vida). Gumboro a
//     los 10-16 días del pollito: si se pasa la ventana sin aplicar, quedó
//     PERDIDA, no pendiente — y se dice.
//   · Periódica: se repite cada tantos días (clostridiales una vez al año en
//     el rodeo). El dato que importa es cuándo toca la próxima.
//   · Campaña oficial: aftosa, peste porcina clásica. Las fechas las fija
//     SENASAG en Bolivia o el MAPA en Brasil, y cambian por zona y por año.
//     No se inventa una fecha: se muestra la última aplicación y nada más.
//
// ⚠️ NO LO REVISÓ TODAVÍA UN VETERINARIO. Está armado con los programas
// más difundidos para la región, pero los esquemas cambian por zona, por
// laboratorio y por situación sanitaria. Es un punto de partida.

const DIA = 86400000;

// Cada ítem:
//   grupo:  qué vacuna es (las dosis de una misma vacuna comparten grupo)
//   orden:  1ª, 2ª... dentro del grupo — la N-ésima aplicación del grupo,
//           en orden de fecha, es la que cuenta como la dosis N. No se
//           depende de que el veterinario escriba "2da dosis".
//   desde/hasta: ventana en días de vida (por edad)
//   cada:   días entre aplicaciones (periódica)
//   campana: true si la fecha la pone la autoridad sanitaria
//   soloProposito: se muestra solo si el propósito del lote coincide
const ESQUEMA_AVICOLA = [
  { id: "marek", grupo: "marek", orden: 1, desde: 0, hasta: 1, categoria: "nucleo",
    nota: "Se aplica en la incubadora. Si los pollitos llegan vacunados, registralo con la fecha de llegada." },
  { id: "newcastle_1", grupo: "newcastle", orden: 1, desde: 5, hasta: 10, categoria: "nucleo", nota: "" },
  { id: "bronquitis_1", grupo: "bronquitis", orden: 1, desde: 5, hasta: 10, categoria: "nucleo",
    nota: "Suele ir en la misma vacuna que Newcastle: una sola aplicación cuenta para las dos." },
  { id: "gumboro_1", grupo: "gumboro", orden: 1, desde: 10, hasta: 16, categoria: "nucleo", nota: "" },
  { id: "newcastle_2", grupo: "newcastle", orden: 2, desde: 16, hasta: 24, categoria: "nucleo", nota: "" },
  { id: "gumboro_2", grupo: "gumboro", orden: 2, desde: 18, hasta: 24, categoria: "nucleo", nota: "" },
  { id: "viruela", grupo: "viruela", orden: 1, desde: 42, hasta: 70, categoria: "postura",
    soloProposito: /huev|postura|ponedora/, nota: "Para gallinas de postura, que viven más que un pollo de engorde." },
  { id: "newcastle_postura", grupo: "newcastle", cada: 90, desde: 140, categoria: "postura",
    soloProposito: /huev|postura|ponedora/, nota: "Revacunación durante la postura." },
];

const ESQUEMA_PORCINO = [
  { id: "micoplasma", grupo: "micoplasma", orden: 1, desde: 7, hasta: 21, categoria: "nucleo", nota: "" },
  { id: "circovirus", grupo: "circovirus", orden: 1, desde: 18, hasta: 28, categoria: "nucleo", nota: "" },
  { id: "desparasitacion_lechones", grupo: "desparasitacion", orden: 1, desde: 45, hasta: 70, categoria: "antiparasitario", nota: "" },
  { id: "reproductoras", grupo: "reproductivas", cada: 180, desde: 180, categoria: "reproductoras",
    soloProposito: /cr[ií]a|reproduc|madre|matriz/, nota: "Parvovirus, leptospirosis y erisipela, antes de cada servicio." },
  { id: "ppc", grupo: "ppc", campana: true, categoria: "campana",
    nota: "Peste porcina clásica: según la campaña oficial de tu zona." },
];

const ESQUEMA_BOVINO = [
  { id: "clostridiales_1", grupo: "clostridiales", orden: 1, desde: 90, hasta: 120, categoria: "nucleo",
    nota: "Mancha, gangrena gaseosa, enterotoxemia." },
  { id: "clostridiales_2", grupo: "clostridiales", orden: 2, desde: 111, hasta: 150, categoria: "nucleo",
    nota: "Refuerzo, tres a cuatro semanas después de la primera." },
  { id: "clostridiales_anual", grupo: "clostridiales", cada: 365, desde: 150, categoria: "nucleo", nota: "" },
  { id: "brucelosis", grupo: "brucelosis", orden: 1, desde: 90, hasta: 240, categoria: "nucleo",
    nota: "Solo hembras. Obligatoria en los programas oficiales." },
  { id: "desparasitacion", grupo: "desparasitacion", cada: 120, desde: 60, categoria: "antiparasitario", nota: "" },
  { id: "rabia", grupo: "rabia", cada: 365, desde: 90, categoria: "riesgo",
    nota: "En zonas con murciélago hematófago." },
  { id: "carbunco", grupo: "carbunco", cada: 365, desde: 180, categoria: "riesgo",
    nota: "Carbunco bacteridiano (ántrax), en zonas con casos." },
  { id: "ibr_dvb", grupo: "ibr_dvb", cada: 365, desde: 240, categoria: "riesgo",
    soloProposito: /leche|cr[ií]a|reproduc/, nota: "IBR y diarrea viral bovina, antes del servicio." },
  { id: "aftosa", grupo: "aftosa", campana: true, categoria: "campana",
    nota: "Fiebre aftosa: según la campaña oficial de tu zona." },
];

const ESQUEMAS = { avicola: ESQUEMA_AVICOLA, porcino: ESQUEMA_PORCINO, bovino: ESQUEMA_BOVINO };

// Cómo se reconoce cada vacuna en lo que el veterinario escribió como
// "producto". Las claves cortas (siglas) tienen que ser una palabra entera:
// "nc" como pedazo de texto aparece adentro de cualquier otra palabra.
const CLAVES = {
  marek: ["marek"],
  newcastle: ["newcastle", "new castle", "lasota", "la sota", "nc"],
  bronquitis: ["bronquitis", "bronquite", "ibv"],
  gumboro: ["gumboro", "bursitis", "bursal", "ibd"],
  viruela: ["viruela", "bouba"],
  micoplasma: ["micoplasma", "mycoplasma", "hyopneumoniae"],
  circovirus: ["circovirus", "circo", "pcv", "pcv2"],
  desparasitacion: ["desparasit", "vermifug", "antiparasit", "ivermectina", "albendazol", "fenbendazol", "levamisol", "doramectina", "closantel"],
  reproductivas: ["parvo", "erisipela", "lepto"],
  ppc: ["peste porcina", "peste suina", "ppc", "colera porcino"],
  clostridiales: ["clostrid", "mancha", "gangrena", "enterotox", "carbunco sintomatico", "polivalente"],
  brucelosis: ["brucel", "cepa 19", "rb51", "rb 51"],
  rabia: ["rabia", "rabic", "antirrab", "raiva"], // "rabic": antirrábica, anti-rábica
  carbunco: ["bacteridiano", "antrax", "antraz", "carbunculo hematico"],
  ibr_dvb: ["ibr", "dvb", "bvd", "rinotraqueitis", "diarrea viral"],
  aftosa: ["aftosa"],
};

function normalizar(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function esDelGrupo(producto, grupo) {
  const t = normalizar(producto);
  const palabras = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
  return (CLAVES[grupo] || []).some(clave => (clave.length <= 3 ? palabras.has(clave) : t.includes(clave)));
}

function esquemaPara(lote) {
  const base = ESQUEMAS[lote?.especie];
  if (!base) return null;
  const proposito = normalizar(lote.proposito);
  return base.filter(item => !item.soloProposito || item.soloProposito.test(proposito));
}

// Edad del lote en días: la que tenían al entrar más lo que pasó desde
// entonces. Sin la edad al ingreso no se sabe, y no se adivina.
function edadDias(lote, hoy = new Date()) {
  if (lote?.edadIngresoDias == null || !lote.fechaIngreso) return null;
  return lote.edadIngresoDias + Math.floor((new Date(hoy) - new Date(lote.fechaIngreso)) / DIA);
}

// El día de calendario en que el lote cumple N días de vida.
function fechaDeEdad(lote, dias) {
  if (lote?.edadIngresoDias == null) return null;
  return new Date(new Date(lote.fechaIngreso).getTime() + (dias - lote.edadIngresoDias) * DIA);
}

// Solo cuentan las vacunaciones — y las desparasitaciones también como
// tratamiento, que es como muchos las cargan.
function aplicacionesDelGrupo(eventos, grupo) {
  const tipos = grupo === "desparasitacion" ? ["vacunacion", "tratamiento"] : ["vacunacion"];
  return (eventos || [])
    .filter(e => tipos.includes(e.tipo) && esDelGrupo(e.producto, grupo))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

function estadoItem(item, lote, eventos, hoy) {
  const apps = aplicacionesDelGrupo(eventos, item.grupo);
  const ultima = apps[apps.length - 1] || null;
  const resumen = (e) => (e ? { fecha: e.fecha, producto: e.producto } : null);
  const edad = edadDias(lote, hoy);

  if (item.campana) return { estado: "campana", ultima: resumen(ultima) };

  if (item.cada) {
    if (ultima) {
      const proxima = new Date(new Date(ultima.fecha).getTime() + item.cada * DIA);
      return { estado: new Date(hoy) > proxima ? "vencida" : "al_dia", ultima: resumen(ultima), proxima };
    }
    // Un rodeo adulto casi nunca tiene la edad cargada: sin edad, una
    // periódica que no se aplicó nunca se da por pendiente, que es lo que
    // es en un animal adulto.
    if (edad != null && edad < item.desde) return { estado: "futuro", desdeFecha: fechaDeEdad(lote, item.desde) };
    return { estado: "pendiente" };
  }

  // Por edad: la N-ésima aplicación del grupo es la dosis N.
  const aplicada = apps[item.orden - 1] || null;
  const ventana = { desdeFecha: fechaDeEdad(lote, item.desde), hastaFecha: fechaDeEdad(lote, item.hasta) };
  if (aplicada) return { estado: "al_dia", aplicada: resumen(aplicada), ...ventana };
  if (edad == null) return { estado: "sin_edad" };
  if (edad < item.desde) return { estado: "futuro", ...ventana };
  if (edad <= item.hasta) return { estado: "pendiente", ...ventana };
  return { estado: "perdida", ...ventana };
}

function calendarioLote(lote, eventos, hoy = new Date()) {
  const esquema = esquemaPara(lote);
  if (!esquema) return null;
  const items = esquema.map(item => ({
    id: item.id, grupo: item.grupo, orden: item.orden || null, cada: item.cada || null,
    categoria: item.categoria, nota: item.nota,
    ...estadoItem(item, lote, eventos, hoy),
  }));
  return {
    edadDias: edadDias(lote, hoy),
    // Si hay ítems por edad y no se sabe la edad, es lo primero que hay que
    // pedirle al veterinario: sin eso la mitad del calendario no dice nada.
    faltaEdad: lote.edadIngresoDias == null && esquema.some(i => i.orden),
    atender: items.filter(i => ["pendiente", "vencida", "perdida"].includes(i.estado)).length,
    items,
  };
}

module.exports = { ESQUEMAS, CLAVES, esDelGrupo, esquemaPara, edadDias, calendarioLote };
