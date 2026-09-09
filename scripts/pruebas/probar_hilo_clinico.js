// Symphomed — Que el hilo clínico no invente una consulta que nunca pasó.
//
// El hilo señala qué del historial se relaciona con la consulta de hoy. Su
// valor entero depende de una cosa: que lo que diga haya pasado de verdad.
//
// Un modelo que escribe "hace tres meses consultó por cefalea" cuando eso no
// ocurrió no produce un error visible: produce una frase verosímil, en el
// idioma correcto, dentro de una historia clínica. Nadie la corrige, porque
// suena bien y encaja. Y a partir de ahí queda escrita.
//
// Por eso cada conexión tiene que citar una consulta REAL del historial, y
// por eso esa regla tiene código además de prompt — un prompt es una
// instrucción, no una garantía.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const { sanear } = require(path.join(RAIZ, "services", "hiloClinico"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const REALES = new Set(["aaa111", "bbb222"]);

console.log("── 1. Una conexión que cita una consulta real pasa ──");
const buena = sanear({
  conexiones: [{
    consultaId: "aaa111",
    queDijoEntonces: "Consultó por cefalea de dos semanas",
    porQueImporta: "La cefalea puede acompañar a la hipertensión no controlada",
  }],
}, REALES);
verificar("se conserva", buena.conexiones.length === 1);
verificar("  ...con la consulta que cita", buena.conexiones[0].consultaId === "aaa111");

console.log("\n── 2. Una consulta inventada NO pasa ──");
// El caso que hace daño: la frase es impecable y el antecedente no existe.
const inventada = sanear({
  conexiones: [{
    consultaId: "zzz999",
    queDijoEntonces: "Consultó por mareos y visión borrosa",
    porQueImporta: "Podría relacionarse con el cuadro actual",
  }],
}, REALES);
verificar("se descarta", inventada.conexiones.length === 0);
verificar("  ...y queda contado, para saber si el modelo está inventando seguido",
  inventada.descartadasPorInventadas === 1);

console.log("\n── 3. Mezcla: se queda la real, se va la inventada ──");
const mezcla = sanear({
  conexiones: [
    { consultaId: "bbb222", queDijoEntonces: "Presión 150/95", porQueImporta: "Ya estaba elevada entonces" },
    { consultaId: "no-existe", queDijoEntonces: "Refirió palpitaciones", porQueImporta: "Podría sumar" },
  ],
}, REALES);
verificar("queda la que existe", mezcla.conexiones.length === 1 && mezcla.conexiones[0].consultaId === "bbb222");
verificar("  ...y se reporta 1 descartada", mezcla.descartadasPorInventadas === 1);

console.log("\n── 4. Una conexión a medias tampoco sirve ──");
// Sin el "por qué importa" es una consulta suelta, no una conexión: el
// médico ya podía ver la lista de sus consultas anteriores solo.
const aMedias = sanear({
  conexiones: [{ consultaId: "aaa111", queDijoEntonces: "Consultó por cefalea" }],
}, REALES);
verificar("sin el porqué se descarta", aMedias.conexiones.length === 0);

console.log("\n── 5. Vacío es una respuesta correcta ──");
// Un hilo que siempre encuentra algo es ruido, y a la tercera vez el médico
// deja de leerlo — justo antes del caso en que importaba.
const vacio = sanear({ conexiones: [], preguntasParaElMedico: [] }, REALES);
verificar("no inventa nada para llenar", vacio.conexiones.length === 0);
verificar("  ...y no cuenta descartes que no hubo", vacio.descartadasPorInventadas === 0);

console.log("\n── 6. Una respuesta rota no tumba la consulta ──");
// Si esto revienta, revienta DESPUÉS de que la nota clínica ya se guardó.
// El hilo es un extra; la historia clínica no.
for (const [que, valor] of [["null", null], ["vacío", {}], ["tipos equivocados", { conexiones: "texto", preguntasParaElMedico: 7 }]]) {
  const r = sanear(valor, REALES);
  verificar(`${que}: devuelve un hilo vacío sin explotar`,
    Array.isArray(r.conexiones) && r.conexiones.length === 0 && Array.isArray(r.preguntasParaElMedico));
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
