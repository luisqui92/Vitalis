// Symphomed Ganadería — alimento y costos de un lote.
//
// Mismo criterio que el resto de Ganadería: se guarda cada gasto tal como
// pasó (services: routes/costos.js) y los indicadores se calculan acá, en un
// solo lugar. La plata va en CENTAVOS, como en toda la plataforma (ver
// services/saldo.js): un 0,1 + 0,2 de coma flotante en un costo por litro
// es exactamente el tipo de error que después nadie sabe de dónde salió.
//
// ⚠️ LA CONVERSIÓN ALIMENTICIA DE ABAJO ES UNA APROXIMACIÓN, y así se le
// muestra al veterinario. No la revisó todavía un veterinario.

const CATEGORIAS_GASTO = ["alimento", "sanidad", "mano_obra", "compra_animales", "otros"];
const { sumarDias, diaDe } = require("./produccion");

function suma(xs) {
  return xs.reduce((a, b) => a + b, 0);
}

// ─── CONVERSIÓN ALIMENTICIA ─────────────────────────────────────────────────
//
// Kilos de alimento por kilo de peso ganado. Es EL número de un engorde:
// dice cuánto alimento cuesta cada kilo que se va a vender.
//
// Se mide entre el primer y el último pesaje, con el alimento dado en ESE
// tramo (después del primer pesaje, hasta el último inclusive). Mezclar
// alimento de antes del primer pesaje con un peso que recién se empezó a
// medir después inflaría el número.
//
// La simplificación que hay que conocer: el peso ganado se calcula con los
// animales vivos de HOY. Los que murieron en el tramo comieron y no están
// en la cuenta, así que el número sale un poco peor que el real — es el
// lado seguro para equivocarse: nunca muestra un engorde mejor de lo que es.
function conversionAlimenticia(lote, gastos, pesajes) {
  const ps = (pesajes || [])
    .filter(p => p.pesoPromedioKg != null)
    .map(p => ({ dia: diaDe(p.fecha), peso: p.pesoPromedioKg }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  if (ps.length < 2) return { valor: null, motivo: "faltan_pesajes" };
  const primero = ps[0];
  const ultimo = ps[ps.length - 1];
  const kgGanados = (ultimo.peso - primero.peso) * (lote.cantidadActual || 0);
  if (!(kgGanados > 0)) return { valor: null, motivo: "sin_ganancia" };
  const kgAlimento = suma((gastos || [])
    .filter(g => g.categoria === "alimento" && g.kg > 0 && g.dia > primero.dia && g.dia <= ultimo.dia)
    .map(g => g.kg));
  if (!kgAlimento) return { valor: null, motivo: "sin_alimento_en_el_tramo" };
  return { valor: kgAlimento / kgGanados, kgAlimento, kgGanados, desde: primero.dia, hasta: ultimo.dia };
}

// ─── EL RESUMEN DEL LOTE ────────────────────────────────────────────────────
//
// serieProduccion: la serie YA calculada por services/produccion.js, con la
// marca de enRetiro de cada día. Se recibe hecha para no calcular dos veces
// qué leche estaba en retiro — y para que el costo del litro vendible use
// exactamente la misma regla que la pantalla de producción.
function resumenCostos(lote, gastos, { pesajes = [], tipoProduccion = null, serieProduccion = [], hoy = new Date() } = {}) {
  const lista = gastos || [];
  const porCategoria = {};
  for (const c of CATEGORIAS_GASTO) porCategoria[c] = suma(lista.filter(g => g.categoria === c).map(g => g.montoCentavos || 0));
  const total = suma(Object.values(porCategoria));
  const vivos = lote.cantidadActual || 0;

  const hoyDia = diaDe(hoy);
  const hace7 = sumarDias(hoyDia, -7);
  const hace30 = sumarDias(hoyDia, -30);
  const kgAlimento7 = suma(lista.filter(g => g.categoria === "alimento" && g.kg > 0 && g.dia > hace7 && g.dia <= hoyDia).map(g => g.kg));

  // El costo de una unidad producida se mide en una ventana de 30 días, con
  // los gastos y la producción de esos MISMOS días. Dividir el gasto de
  // todo el lote por la producción de un mes daría un número sin sentido.
  const costo30 = suma(lista.filter(g => g.dia > hace30 && g.dia <= hoyDia).map(g => g.montoCentavos || 0));
  const prod30 = (serieProduccion || []).filter(r => r.dia > hace30 && r.dia <= hoyDia);
  let porUnidad = null;
  if (tipoProduccion === "leche") {
    const litros = suma(prod30.map(r => r.cantidad));
    const vendibles = suma(prod30.filter(r => !r.enRetiro).map(r => r.cantidad));
    porUnidad = {
      tipo: "leche", litros, vendibles, costo30,
      costoPorLitro: litros > 0 && costo30 > 0 ? costo30 / litros : null,
      // Lo que cuesta de verdad cada litro que se puede vender: la leche en
      // retiro se produjo (y se pagó el alimento para producirla), pero no
      // entra. Es donde se ve cuánto cuesta un tratamiento con retiro.
      costoPorLitroVendible: vendibles > 0 && costo30 > 0 ? costo30 / vendibles : null,
    };
  } else if (tipoProduccion === "huevos") {
    const huevos = suma(prod30.map(r => r.cantidad));
    porUnidad = {
      tipo: "huevos", huevos, costo30,
      costoPorDocena: huevos > 0 && costo30 > 0 ? costo30 / (huevos / 12) : null,
    };
  }

  return {
    total,
    porCategoria,
    alimentoKgTotal: suma(lista.filter(g => g.categoria === "alimento" && g.kg > 0).map(g => g.kg)),
    costoPorAnimal: vivos > 0 && total > 0 ? total / vivos : null,
    alimentoPorAnimalDia: vivos > 0 && kgAlimento7 > 0 ? kgAlimento7 / 7 / vivos : null,
    conversion: conversionAlimenticia(lote, lista, pesajes),
    porUnidad,
  };
}

module.exports = { CATEGORIAS_GASTO, conversionAlimenticia, resumenCostos };
