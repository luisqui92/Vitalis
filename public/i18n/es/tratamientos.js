// Symphomed — Español · plan de tratamiento, presupuesto y pagos.
Object.assign(I18N.es, {
  // Moneda. El monto se arma con el mismo formato de siempre y solo cambia
  // el símbolo y el separador decimal — Bolivia usa punto, Brasil coma.
  //
  // Ojo: el importe se guarda como número pelado, sin moneda. Hoy alcanza
  // porque cada médico trabaja en una sola, pero el día que alguien facture
  // en dos hay que guardar la moneda junto al monto.
  "moneda.formato": "Bs {monto}",
  "moneda.decimal": ".",

  "plan.cargando": "Cargando plan de tratamiento...",
  "plan.errCargar": "No se pudo cargar el plan de tratamiento",
  "plan.errGuardar": "No se pudo guardar",
  "plan.errActualizar": "No se pudo actualizar",
  "plan.errPago": "No se pudo registrar el pago",
  "plan.confirmarBorrarItem": "¿Eliminar este tratamiento del plan?",
  "plan.confirmarBorrarPago": "¿Eliminar este pago?",
  "plan.confirmarBorrarCatalogo": "¿Eliminar este ítem del catálogo?",

  "trat.estado.pendiente": "Pendiente",
  "trat.estado.en_proceso": "En proceso",
  "trat.estado.realizado": "Realizado",

  // El VALOR de la región se guarda tal cual en la base (regionFacial), así
  // que sigue siendo el texto en español para todas las fichas que ya
  // existen. Acá solo se traduce lo que se ve.
  "region.Frente": "Frente",
  "region.Ceja derecha": "Ceja derecha",
  "region.Ceja izquierda": "Ceja izquierda",
  "region.Ojo derecho": "Ojo derecho",
  "region.Ojo izquierdo": "Ojo izquierdo",
  "region.Mejilla derecha": "Mejilla derecha",
  "region.Mejilla izquierda": "Mejilla izquierda",
  "region.Nariz": "Nariz",
  "region.Labio superior": "Labio superior",
  "region.Labio inferior": "Labio inferior",
  "region.Oreja derecha": "Oreja derecha",
  "region.Oreja izquierda": "Oreja izquierda",
  "region.Mandíbula": "Mandíbula",
  "region.Mentón": "Mentón",
  "region.Cuello": "Cuello",
  "region.Otra": "Otra",
});
