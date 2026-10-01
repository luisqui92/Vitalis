// Symphomed — La unidad de cada control (presión, glucosa, peso…) del lado
// del servidor, para los documentos que se arman acá (el Kardex en PDF, el
// resumen compartido).
//
// Es la misma tabla que MEDICIONES_META en public/js/mediciones.js, y
// scripts/pruebas/probar_kardex_pdf.js comprueba que no se separen. Las
// unidades no se traducen: 120/80 mmHg es lo mismo en cualquier idioma.
// "doble": se guardan dos números (presión: sistólica en valor, diastólica
// en valorSecundario) y se escriben «120/80».
const TIPOS_MEDICION = {
  presion: { unidad: "mmHg", doble: true },
  glucosa: { unidad: "mg/dL" },
  peso: { unidad: "kg" },
  imc: { unidad: "" },
  saturacion: { unidad: "%" },
  colesterol: { unidad: "mg/dL" },
  temperatura: { unidad: "°C" },
  frecuenciaCardiaca: { unidad: "lpm" },
  presionIntraocularOD: { unidad: "mmHg" },
  presionIntraocularOI: { unidad: "mmHg" },
  talla: { unidad: "cm" },
  perimetroCefalico: { unidad: "cm" },
  pesoMaterno: { unidad: "kg" },
  alturaUterina: { unidad: "cm" },
  fcf: { unidad: "lpm" },
};

function unidadDe(tipo) {
  return TIPOS_MEDICION[tipo]?.unidad || "";
}

// «120/80 mmHg», «36,8 °C» (con la coma o el punto del idioma).
function valorMedicion({ tipo, valor, valorSecundario }, locale = "es-BO") {
  const f = (n) => (typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString(locale, { maximumFractionDigits: 2 }) : "");
  const principal = f(valor);
  const segundo = valorSecundario != null ? f(valorSecundario) : "";
  const unidad = unidadDe(tipo);
  return [segundo ? `${principal}/${segundo}` : principal, unidad].filter(Boolean).join(" ");
}

module.exports = { TIPOS_MEDICION, unidadDe, valorMedicion };
