// Symphomed Pet — El esquema de vacunación: qué falta y qué se perdió.
//
// ═══ POR QUÉ ESTO ES EL CORAZÓN DE UNA VETERINARIA ════════════════════════
//
// A una clínica veterinaria el paciente no le vuelve porque se enferme: le
// vuelve porque le toca la vacuna. Es el único motivo predecible de que un
// perro sano cruce la puerta.
//
// Symphomed guardaba vacunas como texto libre. Servía para anotar lo que
// pasó y no para lo único que importa —qué falta y cuándo— así que el
// veterinario llevaba el calendario en la cabeza. Y la página de
// symphomed.com ya prometía "esquema de vacunas propio".
//
// ═══ LO QUE MÁS FÁCIL SE ROMPE ════════════════════════════════════════════
//
// El cruce entre lo que el veterinario ESCRIBIÓ a mano y el ítem del
// esquema. "Quíntuple", "polivalente", "V5" y "séxtuple" son la misma vacuna
// para quien la pone. Si el cruce falla, el animal aparece con el esquema
// incompleto teniendo todo puesto — y el veterinario deja de creerle a la
// pantalla, que es peor que no tenerla.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const e = require(path.join(RAIZ, "services", "esquemaVacunas"));

console.log("── 1. La especie se escribe a mano, así que llega de cualquier forma ──");
// Si esto se resolviera en cada pantalla, el esquema aparecería en una y no
// en otra sin que se entienda por qué.
[["Perro", "perro"], ["perro", "perro"], ["CANINO", "perro"], ["cachorro", "perro"],
 ["Canino mestizo", "perro"], ["Gato", "gato"], ["felino", "gato"], ["michi", "gato"],
 ["Gata siamesa", "gato"]]
  .forEach(([entra, sale]) => verificar(`«${entra}» → ${sale}`, e.especieDe(entra) === sale));
// Y lo que NO es perro ni gato no recibe un esquema inventado.
[["Conejo", null], ["Ave", null], ["", null], [null, null]]
  .forEach(([entra, sale]) => verificar(`«${entra}» no tiene esquema`, e.especieDe(entra) === sale));
verificar("un conejo no recibe el esquema del perro", e.esquemaPara("Conejo") === null);

console.log("\n── 2. La edad va en SEMANAS, y no es un detalle ──");
// En un cachorro, la diferencia entre seis y nueve semanas decide si la
// vacuna sirve o la neutralizan los anticuerpos de la madre. En meses eso no
// se puede expresar.
const hace8semanas = new Date(Date.now() - 8 * 7 * 86400000);
verificar("8 semanas se calculan como 8", e.edadEnSemanas(hace8semanas) === 8);
verificar("sin fecha de nacimiento devuelve null, no cero", e.edadEnSemanas(null) === null);
verificar("el esquema del perro usa semanas",
  e.esquemaPara("perro").every(i => typeof i.desdeSemanas === "number"));

console.log("\n── 3. Lo que se perdió se DICE, no se esconde ──");
// Un cachorro al que se le pasó una dosis no está "al día con lo que se
// puso": está con el esquema incompleto, y tiene que verse.
const perro = e.esquemaPara("perro");
const primera = perro.find(i => i.nombre.includes("1ª"));
verificar("a las 10 semanas, la 1ª dosis (ventana 6-9) figura como PERDIDA",
  e.estadoVacuna(primera, 10, []).estado === "perdida");
verificar("  ...y a las 7 semanas todavía es pendiente",
  e.estadoVacuna(primera, 7, []).estado === "pendiente");
verificar("  ...y a las 4 semanas ni siquiera aparece como pendiente",
  e.estadoVacuna(primera, 4, []).estado === "futuro");
verificar("puesta a tiempo, queda al día para siempre",
  e.estadoVacuna(primera, 300, [{ fecha: hace8semanas }]).estado === "al_dia");

console.log("\n── 4. Los refuerzos anuales y la próxima fecha ──");
// Es EL dato de la pantalla: lo que el veterinario le dice al dueño antes de
// que se vaya, y lo que después dispara el recordatorio.
const refuerzo = perro.find(i => i.nombre.includes("refuerzo anual"));
const hace14meses = new Date(Date.now() - 14 * 30.4 * 86400000);
const vencido = e.estadoVacuna(refuerzo, 300, [{ fecha: hace14meses }]);
verificar("a los 14 meses del último refuerzo, está vencida", vencido.estado === "vencida");
verificar("  ...y dice cuándo tocaba", vencido.proxima instanceof Date && vencido.proxima < new Date());
const alDia = e.estadoVacuna(refuerzo, 300, [{ fecha: new Date(Date.now() - 60 * 86400000) }]);
verificar("a los dos meses, está al día", alDia.estado === "al_dia");
verificar("  ...y dice cuándo es la próxima", alDia.proxima > new Date());

console.log("\n── 5. Sin fecha de nacimiento no se adivina ──");
// Es un dato que el veterinario completa en un segundo; inventar un estado
// sería peor que pedírselo.
const rutaTxt = fs.readFileSync(path.join(RAIZ, "routes", "vacunasPet.js"), "utf8");
verificar("se responde «sin_edad» en vez de suponer una edad", /estado: "sin_edad"/.test(rutaTxt));
verificar("y sin especie cargada se dice el motivo", /"sin_especie"/.test(rutaTxt));

console.log("\n── 6. El cruce con lo que el veterinario escribió a mano ──");
// Lo más frágil de todo. Se ejecuta la función REAL de la ruta, no una copia.
const guion = rutaTxt.slice(rutaTxt.indexOf("const VACIAS"), rutaTxt.indexOf("module.exports"));
const { corresponde } = new Function(guion + "\nreturn { corresponde };")();

const itemPoli2 = perro.find(i => i.nombre.includes("Polivalente — 2ª"));
const itemRabia = perro.find(i => i.nombre === "Antirrábica");

verificar("«Polivalente» 2da dosis encuentra su ítem",
  corresponde(itemPoli2, { nombre: "Polivalente", dosis: "2da dosis" }));
verificar("  ...y también escrito «polivalente 2ª»",
  corresponde(itemPoli2, { nombre: "polivalente 2ª", dosis: "" }));
// El número de dosis importa: sin eso, la 1ª y la 2ª se llevarían las dos
// aplicaciones cada una y el esquema diría que está completo cuando no.
verificar("  ...pero la 1ª dosis NO se cuenta como la 2ª",
  !corresponde(itemPoli2, { nombre: "Polivalente", dosis: "1ra dosis" }));
verificar("una antirrábica no se confunde con una polivalente",
  !corresponde(itemPoli2, { nombre: "Antirrábica", dosis: "" }));
verificar("«Antirrábica» encuentra lo suyo aunque se escriba sin tilde",
  corresponde(itemRabia, { nombre: "antirrabica", dosis: "anual" }));
verificar("y una vacuna con nombre vacío no matchea con todo",
  !corresponde(itemRabia, { nombre: "", dosis: "" }));

console.log("\n── 7. Que no se prometa lo que no se cumple ──");
// La página de symphomed.com dice que Symphomed Pet tiene "esquema de
// vacunas propio". Esta prueba es lo que hace que esa frase sea verdad: si
// el esquema desapareciera, se pone roja y alguien se entera antes que un
// veterinario.
const textos = fs.readFileSync(path.join(RAIZ, "scripts", "diseno", "textos.js"), "utf8");
if (/esquema de vacunas propio/.test(textos)) {
  verificar("la página promete esquema de vacunas, y existe",
    e.esquemaPara("perro").length > 0 && e.esquemaPara("gato").length > 0);
  verificar("  ...con las del núcleo, que son las que siempre van",
    e.esquemaPara("perro").some(i => i.nucleo && /Antirr/.test(i.nombre)) &&
    e.esquemaPara("gato").some(i => i.nucleo && /Triple felina/.test(i.nombre)));
}
// Y que quede dicho que no lo revisó un veterinario todavía. Es un esquema
// clínico: presentarlo como verificado cuando no lo está es el tipo de cosa
// que no se arregla después.
verificar("el archivo avisa que todavía no lo revisó un veterinario",
  /NO LOS REVISÓ TODAVÍA UN VETERINARIO/.test(
    fs.readFileSync(path.join(RAIZ, "services", "esquemaVacunas.js"), "utf8")));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
