// Symphomed — Que la segunda lectura nunca afirme que una placa está sana.
//
// El prompt se lo prohíbe, pero un prompt es una instrucción y no una
// garantía: el modelo puede colar un "sin hallazgos" igual. Si eso llega a
// la pantalla, el daño ya está hecho — el odontólogo que lo lee antes de
// mirar la placa mira peor.
//
// Por eso hay una barrera de código además del prompt, y por eso tiene
// prueba. Una barrera sin prueba es un deseo.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const { sanear } = require(path.join(RAIZ, "services", "lecturaRx"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function conObservaciones(...textos) {
  return sanear({ observaciones: textos.map(t => ({ ubicacion: "36", seObserva: t, claridad: "nítido" })) });
}

console.log("── 1. Ninguna forma de decir 'está sana' pasa ──");
// Todas estas las escribió un modelo real alguna vez, con otro prompt.
const formas = [
  "Sin hallazgos relevantes en la pieza 36",
  "La pieza 36 se observa normal",
  "No se observan lesiones periapicales",
  "No hay signos de caries",
  "Ausencia de reabsorción ósea",
  "Estructura ósea sana",
  "Todo en orden en el sector posterior",
  "Sin alteraciones en la corona",
];
for (const texto of formas) {
  const r = conObservaciones(texto);
  verificar(`descartada: "${texto.slice(0, 42)}…"`, r.observaciones.length === 0);
}

console.log("\n── 2. Una descripción de verdad sí pasa ──");
// La otra mitad, que se olvida: un filtro que descarta todo es igual de
// inútil, y además parece que funciona.
const buenas = [
  "Zona radiolúcida en la cara distal, de límites difusos",
  "Espacio del ligamento periodontal ensanchado en la raíz mesial",
  "Imagen radiopaca compatible con material de restauración previo",
  "El ápice queda cortado por el borde de la toma",
];
for (const texto of buenas) {
  const r = conObservaciones(texto);
  verificar(`conservada: "${texto.slice(0, 42)}…"`, r.observaciones.length === 1);
}

console.log("\n── 3. Se cuenta cuántas se descartaron ──");
// Si este número aparece seguido en Fase 0, el prompt no está alcanzando y
// hay que apretarlo antes de mostrarle esto a nadie.
const mezcla = conObservaciones(
  "Zona radiolúcida en la cara distal",
  "Sin hallazgos en la pieza 37",
  "Ensanchamiento del ligamento periodontal",
);
verificar("quedan las 2 descriptivas", mezcla.observaciones.length === 2);
verificar("  ...y se reporta 1 descartada", mezcla.descartadasPorAfirmarAusencia === 1);

console.log("\n── 4. Nada de porcentajes de certeza ──");
// "87% de confianza" es un número inventado con apariencia de medición.
const claridadInventada = sanear({
  observaciones: [{ ubicacion: "36", seObserva: "Zona radiolúcida", claridad: "87%" }],
});
verificar("una claridad que no es de la lista se normaliza",
  claridadInventada.observaciones[0].claridad === "insinuado");

console.log("\n── 5. Una respuesta rota no tumba nada ──");
// El modelo a veces devuelve cualquier cosa. Que eso reviente en medio de
// una consulta sería peor que no tener la función.
for (const [que, valor] of [["null", null], ["vacío", {}], ["campos del tipo equivocado", { observaciones: "texto", zonasARevisar: 5 }]]) {
  const r = sanear(valor);
  verificar(`${que}: devuelve una lectura vacía sin explotar`,
    Array.isArray(r.observaciones) && r.observaciones.length === 0 && Array.isArray(r.zonasARevisar));
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
