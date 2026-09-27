// Symphomed Ganadería — producción: litros de leche y huevos.
//
// Mismo criterio que services/lotesGanado.js y services/reproduccion.js: se
// guarda lo que se midió, y todo lo demás —promedios, caídas, qué leche no
// se puede vender— se calcula acá, en un solo lugar.
//
// ═══ POR QUÉ IMPORTA UNA CAÍDA ════════════════════════════════════════════
//
// Una baja brusca de litros o de postura es, muchas veces, el primer aviso
// de una enfermedad: aparece días antes que los síntomas. Por eso lo que el
// veterinario tiene que ver no es el número del día sino cuánto cambió
// contra la semana anterior.
//
// ⚠️ LOS UMBRALES DE ABAJO NO LOS REVISÓ TODAVÍA UN VETERINARIO.

// Caída del promedio de 7 días contra los 7 anteriores a partir de la cual
// se avisa. Menos que esto es ruido normal (un día de calor, un ordeño que
// se atrasó).
const CAIDA_ALERTA_PCT = { leche: 15, huevos: 10 };

const DIA = 86400000;

// "YYYY-MM-DD" de una fecha, en UTC. Los registros de producción son por
// DÍA, no por instante: se guardan al mediodía UTC para que ningún huso
// horario de la región los corra al día anterior o al siguiente.
function diaDe(fecha) {
  return new Date(fecha).toISOString().slice(0, 10);
}

function fechaDelDia(dia) {
  return new Date(`${dia}T12:00:00Z`);
}

function sumarDias(dia, n) {
  return diaDe(new Date(fechaDelDia(dia).getTime() + n * DIA));
}

function promedio(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ─── QUÉ LECHE NO SE PUEDE VENDER ───────────────────────────────────────────
//
// Un día está "en retiro" si algún tratamiento o vacunación del lote con
// retiro de leche lo cubre: desde el día de la aplicación hasta el día
// ANTERIOR a la fecha de liberación. Esa leche se ordeña igual —la vaca no
// deja de producir— pero se descarta. Anotarla sin marcarla sería la forma
// más fácil de que termine en el tanque.
function diasEnRetiroLeche(eventosLote) {
  const tramos = (eventosLote || [])
    .filter(e => (e.tipo === "tratamiento" || e.tipo === "vacunacion") && e.diasRetiroLeche != null && e.diasRetiroLeche > 0)
    .map(e => ({ desde: diaDe(e.fecha), hasta: sumarDias(diaDe(e.fecha), e.diasRetiroLeche - 1), producto: e.producto }));
  return (dia) => tramos.find(t => dia >= t.desde && dia <= t.hasta) || null;
}

// ─── LA SERIE DEL LOTE ──────────────────────────────────────────────────────
//
// tipo: "leche" (cantidad = litros, animales = vacas en ordeñe) o "huevos"
// (cantidad = huevos, animales = gallinas en postura).
function resumenProduccion(tipo, registros, { eventosLote = [], hoy = new Date() } = {}) {
  const enRetiro = tipo === "leche" ? diasEnRetiroLeche(eventosLote) : () => null;
  const serie = (registros || [])
    .map(r => {
      const retiro = enRetiro(r.dia);
      const porAnimal = r.animales > 0 ? r.cantidad / r.animales : null;
      return {
        _id: r._id, dia: r.dia, cantidad: r.cantidad, animales: r.animales ?? null, notas: r.notas || "",
        // Leche: litros por vaca. Huevos: % de postura (huevos cada 100
        // gallinas), que es como se mide en cualquier granja.
        porAnimal: porAnimal == null ? null : (tipo === "huevos" ? porAnimal * 100 : porAnimal),
        enRetiro: Boolean(retiro),
        productoRetiro: retiro ? retiro.producto : null,
      };
    })
    .sort((a, b) => a.dia.localeCompare(b.dia));

  // Las dos semanas se cuentan hacia atrás desde HOY, no desde el último
  // registro: si nadie cargó nada en diez días, eso también es un dato, y
  // no puede esconderse detrás de un promedio viejo.
  const hoyDia = diaDe(hoy);
  const semana = (desde, hasta) => serie.filter(r => r.dia > desde && r.dia <= hasta);
  const ultimos7 = semana(sumarDias(hoyDia, -7), hoyDia);
  const previos7 = semana(sumarDias(hoyDia, -14), sumarDias(hoyDia, -7));

  // Para huevos se compara el % de postura, no el total: si el lote perdió
  // gallinas por mortalidad, los huevos bajan sin que las que quedan pongan
  // menos. Para leche, el total del tanque (las vacas en ordeñe no siempre
  // se anotan).
  const valor = (r) => tipo === "huevos" && r.porAnimal != null ? r.porAnimal : r.cantidad;
  const prom7 = promedio(ultimos7.map(valor));
  const promPrev = promedio(previos7.map(valor));
  const variacionPct = prom7 != null && promPrev ? ((prom7 - promPrev) / promPrev) * 100 : null;

  const alertas = [];
  if (variacionPct != null && variacionPct <= -CAIDA_ALERTA_PCT[tipo]) {
    alertas.push({ tipo: "caida", pct: Math.round(-variacionPct) });
  }
  const litrosEnRetiro = tipo === "leche" ? ultimos7.filter(r => r.enRetiro).reduce((a, r) => a + r.cantidad, 0) : 0;
  if (litrosEnRetiro > 0) alertas.push({ tipo: "leche_en_retiro", litros: litrosEnRetiro });

  return {
    tipo,
    serie,
    ultimo: serie[serie.length - 1] || null,
    promedio7: prom7,
    promedioPrevio7: promPrev,
    variacionPct,
    // Lo que se puede vender de verdad: la semana menos lo que estuvo en
    // retiro. Es el número que le importa al dueño.
    vendible7: tipo === "leche" ? ultimos7.filter(r => !r.enRetiro).reduce((a, r) => a + r.cantidad, 0) : null,
    alertas,
  };
}

// ─── CONTROL LECHERO INDIVIDUAL ─────────────────────────────────────────────
//
// Días en leche (DEL): cuántos días lleva la vaca desde el último parto. Es
// lo que le da sentido a un número de litros: 20 litros a los 40 días de
// parida es una vaca floja; a los 280, una muy buena.
function diasEnLeche(ultimoParto, dia) {
  if (!ultimoParto) return null;
  const n = Math.floor((fechaDelDia(dia) - fechaDelDia(diaDe(ultimoParto))) / DIA);
  return n >= 0 ? n : null;
}

function resumenControles(controles, ultimoParto) {
  const serie = (controles || [])
    .map(c => ({ _id: c._id, dia: c.dia, litros: c.litros, del: diasEnLeche(ultimoParto, c.dia) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  // La lactancia actual son los controles desde el último parto: los de la
  // lactancia anterior no se mezclan en el promedio de esta.
  const actual = ultimoParto ? serie.filter(c => c.del != null) : serie;
  const pico = actual.reduce((m, c) => (!m || c.litros > m.litros ? c : m), null);
  return {
    serie,
    ultimo: serie[serie.length - 1] || null,
    promedioLactancia: promedio(actual.map(c => c.litros)),
    pico,
  };
}

// El último control del lote: todas las vacas controladas ese día, de la
// mejor a la peor. Es lo que se mira para decidir a cuál revisar.
function resumenControlLote(controles, animalesPorId) {
  if (!controles?.length) return null;
  const ultimoDia = controles.reduce((m, c) => (c.dia > m ? c.dia : m), "");
  const delDia = controles
    .filter(c => c.dia === ultimoDia)
    .map(c => ({ animalId: c.animalId, identificador: animalesPorId.get(String(c.animalId))?.identificador || "?", litros: c.litros }))
    .sort((a, b) => b.litros - a.litros);
  return { dia: ultimoDia, vacas: delDia.length, promedio: promedio(delDia.map(c => c.litros)), vacasDelDia: delDia };
}

module.exports = {
  CAIDA_ALERTA_PCT,
  diaDe, fechaDelDia, sumarDias,
  diasEnRetiroLeche, resumenProduccion, diasEnLeche, resumenControles, resumenControlLote,
};
