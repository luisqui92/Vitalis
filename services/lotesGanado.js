// Symphomed Ganadería — cálculos sobre lotes: mortalidad acumulada, retiro
// de medicamento vigente y curva de peso.
//
// Mismo criterio que services/esquemaVacunas.js: se calcula ACÁ y no en cada
// pantalla, para que un lote no aparezca "puede faenarse" en el celular y
// "en retiro" en el escritorio según qué código tenga cada uno.

// % sobre cantidadInicial, no sobre cantidadActual — cantidadActual ya
// tiene los muertos descontados, así que dividir por ella subestimaría la
// mortalidad real cuantas más muertes hubo.
function mortalidadAcumulada(lote, eventos) {
  const totalMuertes = (eventos || [])
    .filter(e => e.tipo === "mortalidad")
    .reduce((total, e) => total + (e.cantidadMuertes || 0), 0);
  const inicial = lote?.cantidadInicial || 0;
  return {
    totalMuertes,
    porcentaje: inicial > 0 ? (totalMuertes / inicial) * 100 : 0,
  };
}

// Un evento con período de retiro sigue vigente hasta fecha + días. Antes de
// esa fecha el lote no puede faenarse, o su leche no puede venderse, sin
// riesgo — es el dato que más le importa al dueño antes de fijar una fecha
// de venta, y lo que en el futuro dispara el aviso por WhatsApp.
function retirosVigentes(eventos, ahora = new Date()) {
  return (eventos || [])
    .filter(e => (e.tipo === "tratamiento" || e.tipo === "vacunacion") &&
      (e.diasRetiroCarne != null || e.diasRetiroLeche != null))
    .map(e => {
      const fechaLibreCarne = e.diasRetiroCarne != null
        ? new Date(new Date(e.fecha).getTime() + e.diasRetiroCarne * 86400000) : null;
      const fechaLibreLeche = e.diasRetiroLeche != null
        ? new Date(new Date(e.fecha).getTime() + e.diasRetiroLeche * 86400000) : null;
      return { eventoId: e._id, producto: e.producto, fecha: e.fecha, fechaLibreCarne, fechaLibreLeche };
    })
    .filter(r => (r.fechaLibreCarne && r.fechaLibreCarne > ahora) || (r.fechaLibreLeche && r.fechaLibreLeche > ahora));
}

// Ordenada por fecha: es lo que se grafica, y un pesaje cargado fuera de
// orden (el veterinario carga la visita de la semana pasada hoy) no debe
// romper la curva.
function curvaPeso(eventos) {
  return (eventos || [])
    .filter(e => e.tipo === "pesaje" && e.pesoPromedioKg != null)
    .map(e => ({ fecha: e.fecha, pesoPromedioKg: e.pesoPromedioKg, tamanoMuestra: e.tamanoMuestra }))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

module.exports = { mortalidadAcumulada, retirosVigentes, curvaPeso };
