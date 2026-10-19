// Symphomed — La unidad de cada control (presión, glucosa, peso…) del lado
// del servidor, para los documentos que se arman acá (el Kardex en PDF, el
// resumen compartido).
//
// Es la misma tabla que MEDICIONES_META en public/js/mediciones.js, y
// scripts/pruebas/probar_kardex_pdf.js comprueba que no se separen. Las
// unidades no se traducen: 120/80 mmHg es lo mismo en cualquier idioma.
// "doble": se guardan dos números (presión: sistólica en valor, diastólica
// en valorSecundario) y se escriben «120/80».
//
// "rango": lo FÍSICAMENTE posible, no lo normal. Solo ataja un error de
// tipeo (SpO₂ 300, peso −5, temperatura 370) antes de que entre a la curva
// y a las alertas (routes/mediciones.js lo hace cumplir). Son amplios a
// propósito, porque también los usan:
//   · veterinaria: un ave o un roedor pasan de 600 latidos por minuto, y un
//     toro de los 1500 kg;
//   · neonatología: un prematuro extremo (350 g y 27 cm) tiene un IMC de 4,8;
//   · una hipotermia grave llega a menos de 20 °C, y una bradicardia fetal
//     grave baja de 50.
// "rangoSecundario" es el de la diastólica.
const TIPOS_MEDICION = {
  presion: { unidad: "mmHg", doble: true, rango: [30, 300], rangoSecundario: [10, 200] },
  glucosa: { unidad: "mg/dL", rango: [10, 2000] },
  peso: { unidad: "kg", rango: [0.01, 2000] },
  imc: { unidad: "", rango: [2, 200] },
  saturacion: { unidad: "%", rango: [30, 100] },
  colesterol: { unidad: "mg/dL", rango: [20, 1500] },
  temperatura: { unidad: "°C", rango: [15, 47] },
  frecuenciaCardiaca: { unidad: "lpm", rango: [5, 1000] },
  presionIntraocularOD: { unidad: "mmHg", rango: [0, 80] },
  presionIntraocularOI: { unidad: "mmHg", rango: [0, 80] },
  talla: { unidad: "cm", rango: [10, 300] },
  perimetroCefalico: { unidad: "cm", rango: [15, 80] },
  pesoMaterno: { unidad: "kg", rango: [25, 300] },
  alturaUterina: { unidad: "cm", rango: [0, 60] },
  fcf: { unidad: "lpm", rango: [30, 250] },
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
