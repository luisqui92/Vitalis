// Vitalis — Cobertura de traducción
//
// Dice qué falta traducir, por idioma y por módulo. Sin esto, agregar un
// tercer idioma significa que alguien compare a mano 900 claves contra otras
// 900 y confíe en no haberse salteado ninguna.
//
// El español es la referencia: es el idioma en el que está escrito el
// producto y al que t() cae cuando falta una clave (ver public/js/i18n.js).
//
// Uso: node scripts/i18n_cobertura.js            (resumen)
//      node scripts/i18n_cobertura.js pt         (qué falta en portugués)
//      node scripts/i18n_cobertura.js pt agenda  (solo ese módulo)
//
// Sale con código 1 si algún idioma está incompleto, así puede correr en CI.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = path.join(__dirname, "..", "public", "i18n");
const REFERENCIA = "es";

function leer(idioma) {
  const dir = path.join(DIR, idioma);
  const porModulo = {};
  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    const contexto = { I18N: { [idioma]: {} }, Object };
    vm.createContext(contexto);
    vm.runInContext(fs.readFileSync(path.join(dir, archivo), "utf8"), contexto);
    porModulo[archivo.replace(/\.js$/, "")] = Object.keys(contexto.I18N[idioma]);
  }
  return porModulo;
}

const idiomas = fs.readdirSync(DIR, { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name).sort();

const ref = leer(REFERENCIA);
const clavesRef = Object.values(ref).flat();
const moduloDe = {};
for (const [mod, claves] of Object.entries(ref)) for (const c of claves) moduloDe[c] = mod;

const filtroIdioma = process.argv[2];
const filtroModulo = process.argv[3];
let incompleto = false;

console.log(`Referencia: ${REFERENCIA} — ${clavesRef.length} claves en ${Object.keys(ref).length} módulos\n`);

for (const idioma of idiomas) {
  if (idioma === REFERENCIA) continue;
  if (filtroIdioma && idioma !== filtroIdioma) continue;

  const propio = leer(idioma);
  const tiene = new Set(Object.values(propio).flat());
  const faltan = clavesRef.filter(c => !tiene.has(c));
  const sobran = [...tiene].filter(c => !clavesRef.includes(c));
  const pct = Math.round(((clavesRef.length - faltan.length) / clavesRef.length) * 100);

  console.log(`━━━ ${idioma} — ${pct}% (${clavesRef.length - faltan.length}/${clavesRef.length}) ━━━`);

  // Por módulo, para poder repartir el trabajo por pantalla.
  for (const mod of Object.keys(ref)) {
    if (filtroModulo && mod !== filtroModulo) continue;
    const total = ref[mod].length;
    const hechas = ref[mod].filter(c => tiene.has(c)).length;
    const marca = hechas === total ? "✅" : hechas === 0 ? "⬜" : "🟨";
    console.log(`  ${marca} ${mod.padEnd(12)} ${String(hechas).padStart(3)}/${total}`);
  }

  if (faltan.length) {
    incompleto = true;
    if (filtroIdioma) {
      console.log(`\n  Faltan ${faltan.length}:`);
      for (const c of faltan) {
        if (filtroModulo && moduloDe[c] !== filtroModulo) continue;
        console.log(`    ${moduloDe[c]}/${c}`);
      }
    }
  }
  // Una clave que está en portugués y no en español casi siempre es un typo
  // en el nombre: t() nunca la va a pedir, y el texto no aparece nunca.
  if (sobran.length) {
    console.log(`\n  ⚠️  ${sobran.length} clave(s) que no existen en ${REFERENCIA} (¿error de tipeo?):`);
    for (const c of sobran) console.log(`    ${c}`);
    incompleto = true;
  }
  console.log("");
}

process.exit(incompleto ? 1 : 0);
