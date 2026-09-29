// Symphomed — Cada idioma, una carpeta completa (services/idiomas/).
//
// Lo que se prueba:
//   · que todos los idiomas tienen las mismas piezas: si el español tiene
//     vocabulario de oftalmología y el portugués no, un oftalmólogo brasileño
//     transcribe peor sin que nadie se entere;
//   · que la lista de fármacos de cada idioma está escrita como en la lista
//     oficial de su país;
//   · que la pregunta «¿es de Brasil?» y el idioma de una cuenta se
//     contestan en UN solo lugar, y no vuelven a copiarse a mano.
const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { IDIOMAS, POR_DEFECTO, idiomaSoportado, perfil, idiomaDeCuenta, esCuentaBrasil } = require(path.join(RAIZ, "services", "idiomas"));
const { verificarMedicamento } = require(path.join(RAIZ, "services", "medicamentosOficiales"));

// La "forma" de un perfil: sus claves, recursivamente, sin los valores.
function forma(o, prefijo = "") {
  if (!o || typeof o !== "object" || Array.isArray(o)) return [prefijo];
  return Object.keys(o).sort().flatMap(k => forma(o[k], prefijo ? `${prefijo}.${k}` : k));
}

console.log("── 1. Todos los idiomas tienen las mismas piezas ──");
const codigos = Object.keys(IDIOMAS);
verificar(`hay español y portugués (${codigos.join(", ")})`, codigos.includes("es") && codigos.includes("pt"));
const referencia = forma(IDIOMAS[POR_DEFECTO]).join("|");
for (const c of codigos) {
  const f = forma(IDIOMAS[c]);
  const faltan = forma(IDIOMAS[POR_DEFECTO]).filter(k => !f.includes(k));
  const sobran = f.filter(k => !referencia.split("|").includes(k));
  verificar(`${c}: misma estructura que ${POR_DEFECTO}${faltan.length ? " — le falta: " + faltan.join(", ") : ""}${sobran.length ? " — de más: " + sobran.join(", ") : ""}`,
    !faltan.length && !sobran.length);
  verificar(`${c}: el código coincide con su carpeta`, IDIOMAS[c].codigo === c);
  verificar(`${c}: su lista oficial de medicamentos existe`, fs.existsSync(path.join(RAIZ, "datos", "medicamentos", IDIOMAS[c].listaMedicamentos)));
  verificar(`${c}: tiene textos de pantalla (public/i18n/${c}/)`, fs.existsSync(path.join(RAIZ, "public", "i18n", c)));
  verificar(`${c}: 7 días de la semana para la nota`, IDIOMAS[c].nota.dias.length === 7);
}

console.log("\n── 2. Los fármacos de cada idioma, como en la lista oficial ──");
for (const c of codigos) {
  const { farmacos, generales } = IDIOMAS[c].transcripcion;
  const mal = farmacos.filter(n => verificarMedicamento(n, { idioma: c }).estado !== "ok");
  verificar(`${c}: ${farmacos.length} fármacos, todos en la lista oficial${mal.length ? " — no: " + mal.join(", ") : ""}`, !mal.length);
  verificar(`${c}: sin términos repetidos en el vocabulario general`, new Set(generales.map(x => x.toLowerCase())).size === generales.length);
}
verificar("pt: dice losartana y no losartán", IDIOMAS.pt.transcripcion.generales.includes("losartana") && !IDIOMAS.pt.transcripcion.generales.includes("losartán"));

console.log("\n── 3. Idioma y país de una cuenta, en un solo lugar ──");
verificar("idioma desconocido → español", idiomaSoportado("fr") === "es" && perfil(undefined).codigo === "es");
verificar("cuenta en portugués → pt", idiomaDeCuenta({ idioma: "pt" }) === "pt");
verificar("es de Brasil por el idioma", esCuentaBrasil({ idioma: "pt", moneda: "BOB" }));
verificar("es de Brasil por la moneda (cuenta vieja en español)", esCuentaBrasil({ idioma: "es", moneda: "BRL" }));
verificar("una cuenta boliviana no", !esCuentaBrasil({ idioma: "es", moneda: "BOB" }) && !esCuentaBrasil(null));
verificar("WhatsApp: pt → pt_BR", require(path.join(RAIZ, "services", "metaWhatsapp")).codigoDeIdioma("pt") === "pt_BR");
verificar("moneda de una cuenta nueva en pt → BRL", require(path.join(RAIZ, "services", "monedas")).monedaSegunIdioma("pt") === "BRL");

// Que nadie vuelva a escribir la pregunta a mano. Se mira el código del
// servidor (no los textos de pantalla ni las pruebas).
const sospechosos = [];
function recorrer(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "idiomas") recorrer(p); continue; }
    if (!p.endsWith(".js")) continue;
    const texto = fs.readFileSync(p, "utf8");
    if (/moneda\s*===\s*"BRL"\s*\|\|\s*\w+\??\.idioma\s*===\s*"pt"/.test(texto)) sospechosos.push(path.relative(RAIZ, p) + " (¿es de Brasil?)");
    if (/idioma\s*===\s*"pt"\s*\?\s*"pt"\s*:\s*"es"/.test(texto)) sospechosos.push(path.relative(RAIZ, p) + " (idioma de la cuenta)");
    if (/KEYTERMS_MEDICOS_PT|IDIOMAS_NOTA\s*=/.test(texto)) sospechosos.push(path.relative(RAIZ, p) + " (vocabulario fuera de su carpeta)");
  }
}
recorrer(path.join(RAIZ, "services"));
recorrer(path.join(RAIZ, "routes"));
verificar(`nadie repite a mano lo que está en services/idiomas${sospechosos.length ? " — " + sospechosos.join(", ") : ""}`, !sospechosos.length);

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
