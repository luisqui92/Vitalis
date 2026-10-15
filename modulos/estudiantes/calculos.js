// Symphomed — Los cálculos de medicación de las cuentas de estudiante.
//
// Goteo, mL por hora, dosis por peso, volumen a administrar, dilución e
// infusión continua: las fórmulas de siempre, para practicar. Las usa la
// calculadora de la pantalla (public/js/estudiantesCalculadora.js, que tiene
// las mismas fórmulas: scripts/pruebas/probar_calculadora.js compara las dos)
// y los simulacros, para comprobar las preguntas de cálculo: el resultado que
// marcó la IA se rehace acá, con aritmética de verdad (simulacros.js).
//
// Solo fórmulas. Ninguna dosis de ningún medicamento: la dosis la indica
// quien prescribe, sale del formulario oficial, y la verifica el profesional
// a cargo antes de administrar.

// Gotas por mL de los equipos de venoclisis: macrogotero de 20 (también los
// hay de 10 y de 15) y microgotero de 60.
const FACTORES_GOTEO = [10, 15, 20, 60];

// Lo que se acepta de cada dato: fuera de esto el problema está mal escrito,
// no hay nada que calcular.
const RANGOS = {
  volumenMl: [0.1, 5000], minutos: [1, 72 * 60], pesoKg: [0.3, 300], dosisPorKg: [0.0001, 1000], tomas: [1, 24],
  dosis: [0.0001, 100000], cantidad: [0.0001, 100000], c1: [0.0001, 100000], c2: [0.0001, 100000], v2: [0.1, 5000],
  dosisMcgKgMin: [0.001, 100], mg: [0.001, 100000],
};

const numero = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : NaN);
const enRango = (clave, v) => Number.isFinite(v) && v >= RANGOS[clave][0] && v <= RANGOS[clave][1];

// Cada uno: lo que necesita y lo que devuelve. Sin redondear: eso es de quien
// lo muestra (las gotas se cuentan enteras; los mL, con un decimal).
const FORMULAS = {
  // Gotas por minuto = volumen (mL) × factor (gotas/mL) ÷ tiempo (min).
  goteo: { datos: ["volumenMl", "minutos", "factor"], calcular: ({ volumenMl, minutos, factor }) => (volumenMl * factor) / minutos },
  // mL por hora = volumen (mL) ÷ tiempo (h).
  mlHora: { datos: ["volumenMl", "minutos"], calcular: ({ volumenMl, minutos }) => (volumenMl * 60) / minutos },
  // Dosis de cada toma = dosis por kg × peso ÷ tomas (1 si es dosis única).
  dosisPorPeso: { datos: ["dosisPorKg", "pesoKg", "tomas"], calcular: ({ dosisPorKg, pesoKg, tomas }) => (dosisPorKg * pesoKg) / tomas },
  // mL a administrar = dosis indicada × volumen ÷ cantidad que trae ese volumen.
  volumen: { datos: ["dosis", "cantidad", "volumenMl"], calcular: ({ dosis, cantidad, volumenMl }) => (dosis * volumenMl) / cantidad },
  // C1 × V1 = C2 × V2 → V1, los mL de la solución inicial.
  dilucion: { datos: ["c1", "c2", "v2"], calcular: ({ c1, c2, v2 }) => (c2 * v2) / c1 },
  // mL por hora = dosis (mcg/kg/min) × peso × 60 ÷ concentración (mcg/mL).
  infusion: {
    datos: ["dosisMcgKgMin", "pesoKg", "mg", "volumenMl"],
    calcular: ({ dosisMcgKgMin, pesoKg, mg, volumenMl }) => (dosisMcgKgMin * pesoKg * 60) / ((mg * 1000) / volumenMl),
  },
};
const TIPOS = Object.keys(FORMULAS);

// El resultado de un cálculo, o null si los datos no sirven: un tipo que no
// existe, un dato que falta o que está fuera de rango, un factor de goteo que
// no es de un equipo real, una dilución que pide concentrar.
function calcular(tipo, datos) {
  const f = Object.hasOwn(FORMULAS, tipo) ? FORMULAS[tipo] : null;
  if (!f || !datos || typeof datos !== "object") return null;
  const v = {};
  for (const clave of f.datos) {
    // La dosis única no trae tomas.
    const crudo = clave === "tomas" && (datos.tomas == null || datos.tomas === "") ? 1 : datos[clave];
    v[clave] = numero(crudo);
    if (clave === "factor") { if (!FACTORES_GOTEO.includes(v.factor)) return null; continue; }
    if (clave === "tomas" && !Number.isInteger(v.tomas)) return null;
    if (!enRango(clave, v[clave])) return null;
  }
  if (tipo === "dilucion" && !(v.c2 < v.c1)) return null;
  const r = f.calcular(v);
  return Number.isFinite(r) && r > 0 ? r : null;
}

// «41,7» → 41.7; «1.000» y «1 000» → 1000; «1.000,5» → 1000.5; «0.125» →
// 0.125. Un número con punto que podría ser de miles o decimal («1.125») se
// lee como de miles, que es como se escribe en español y en portugués: si la
// IA quiso decir otra cosa, la pregunta no coincide y se tira, que es el lado
// seguro.
function aNumero(crudo) {
  let s = crudo.replace(/(\d)\s(?=\d{3}(?!\d))/g, "$1");
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (coma >= 0) s = s.replace(",", ".");
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return Number(s);
}

// Los números de un texto: «41,7 gotas/min» → [41.7]; «2.500 mL en 8 h» →
// [2500, 8].
function numerosDe(texto) {
  return [...String(texto || "").matchAll(/\d+(?:[.,\s]\d+)*/g)].map(m => aNumero(m[0])).filter(Number.isFinite);
}

// ¿Este número es el resultado? Con el margen del redondeo: 41,67 es «42» y
// «41,7» gotas; 166,67 mg es «167». No tanto como para que dos opciones
// distintas lo sean a la vez (eso se mira afuera).
function coincide(n, resultado) {
  const margen = Math.max(Math.abs(resultado) * 0.01, resultado >= 10 ? 0.5 : 0.05);
  return Math.abs(n - resultado) <= margen + 1e-9;
}

module.exports = { FACTORES_GOTEO, RANGOS, TIPOS, FORMULAS, calcular, numerosDe, coincide };
