// Symphomed — Que las plantillas de WhatsApp y el código digan lo mismo.
//
// ═══ POR QUÉ ESTA PRUEBA EXISTE ═══════════════════════════════════════════
//
// Una plantilla de WhatsApp vive en DOS lugares: el cuerpo con {{1}}, {{2}}…
// está aprobado en un panel de Meta, y la lista de valores que se le pasan
// está en nuestro código. El código no le puede preguntar nada a ese panel.
//
// Si alguien agrega una variable al cuerpo en Meta y no toca el código —o al
// revés— Meta devuelve 132000 y el mensaje no llega. Y eso pasa SOLO fuera de
// la ventana de 24 h, que es justo el caso que nadie prueba a mano: en
// desarrollo uno le escribe al bot y todo anda, porque ahí sale por texto
// libre y la plantilla ni se toca.
//
// Entonces: WHATSAPP_PLANTILLAS.md es el contrato escrito, y esta prueba
// comprueba que el código lo cumpla. No puede verificar lo que hay aprobado
// en Meta —eso lo dice `node scripts/revisar_whatsapp.js`— pero sí que las
// dos mitades que SÍ controlamos no se separen.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { PLANTILLAS, enviarPlantilla, enviarTextoOPlantilla } =
  require(path.join(RAIZ, "services", "metaWhatsapp"));
const DOC = fs.readFileSync(path.join(RAIZ, "WHATSAPP_PLANTILLAS.md"), "utf8");

// ─── Lo que dice el documento ──────────────────────────────────────────────
// Cada plantilla es un "### `nombre`" seguido de un bloque de código con el
// cuerpo. De ahí sale cuántas variables tiene y cómo está escrito.
const documentadas = {};
for (const m of DOC.matchAll(/###[^`\n]*`([a-z_]+)`\n+Cuerpo:\n+```\n([\s\S]*?)```/g)) {
  const [, nombre, cuerpo] = m;
  const numeros = [...cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map(x => Number(x[1]));
  documentadas[nombre] = { cuerpo: cuerpo.trim(), numeros };
}

console.log("── 1. El documento tiene todas las plantillas ──");
const esperadas = Object.values(PLANTILLAS);
console.log(`   el código conoce ${esperadas.length}: ${esperadas.join(", ")}`);
esperadas.forEach(n => verificar(`  «${n}» está documentada`, Boolean(documentadas[n])));

// Y al revés. Acá había un número fijo (`esperadas.length === 4`) que había
// que subir a mano cada vez que nacía una plantilla: una prueba que se rompe
// al hacer bien las cosas y que se arregla cambiando un número sin mirar
// nada. Esto comprueba lo mismo que aquel número —que ninguna quede sin
// documentar, que ya lo hace la línea de arriba— y además lo que no veía: una
// plantilla documentada que el código ya no usa. Esa es la peligrosa, porque
// queda escrita como si existiera, alguien la carga en Meta, y nadie se
// entera de que hace meses que no se manda.
const deMas = Object.keys(documentadas).filter(n => !esperadas.includes(n));
verificar("y no hay ninguna documentada que el código ya no use", deMas.length === 0);
if (deMas.length) console.log("   sobran en el documento:", deMas.join(", "));

console.log("\n── 2. Reglas de Meta que hacen que rechacen la plantilla ──");
// Estas tres son las que más rechazos generan, y el rechazo llega por correo
// un día después. Comprobarlas acá cuesta nada y ahorra ese día.
for (const [nombre, { cuerpo, numeros }] of Object.entries(documentadas)) {
  verificar(`[${nombre}] no empieza ni termina con una variable`,
    !/^\{\{\d+\}\}/.test(cuerpo) && !/\{\{\d+\}\}$/.test(cuerpo));
  verificar(`[${nombre}] no tiene dos variables pegadas`,
    !/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(cuerpo));
  // Numeradas desde 1 y sin saltos: Meta rechaza {{1}} {{3}}.
  const unicos = [...new Set(numeros)].sort((a, b) => a - b);
  verificar(`[${nombre}] las ${unicos.length} variables van de 1 a ${unicos.length} sin saltos`,
    unicos.every((n, i) => n === i + 1));
  verificar(`[${nombre}] el cuerpo entra en los 1024 caracteres de Meta`, cuerpo.length <= 1024);
}

console.log("\n── 3. El código pasa tantos valores como variables tiene ──");
// Se leen las llamadas tal como están escritas en las rutas. Es a propósito
// que se lea el TEXTO y no se ejecute: ejecutarlas pediría una base, una
// consulta y un paciente, y lo que importa acá es una sola cosa —cuántos
// valores se pasan— que se ve leyendo.
// "resumenCompartido" y "reseteoClave" no estaban acá y son las dos rutas más
// nuevas que mandan plantilla — sin esto, un desacople entre la lista de
// parámetros y lo que Meta tiene aprobado en esas dos no lo hubiera agarrado
// nada.
const RUTAS = ["citas", "reservaPublica", "consultaMedica", "informes", "informeFamilia", "solicitudesCuenta",
  "resumenCompartido", "reseteoClave"];
// No todo lo que manda una plantilla vive en routes/: recordatorioMedicamento
// la dispara un trabajo en segundo plano, no un pedido HTTP — ver
// services/recordatorioMedicamento.js. Se lee aparte, de su propia carpeta,
// pero entra al mismo chequeo de abajo: el acoplamiento frágil entre
// `parametros` y lo que Meta tiene aprobado no distingue de dónde sale la
// llamada.
const SERVICIOS = ["recordatorioMedicamento"];
const llamadas = [];
for (const r of [...RUTAS.map(r => ({ nombre: r, dir: "routes" })), ...SERVICIOS.map(r => ({ nombre: r, dir: "services" }))]) {
  const codigo = fs.readFileSync(path.join(RAIZ, r.dir, `${r.nombre}.js`), "utf8");
  for (const m of codigo.matchAll(/plantilla:\s*PLANTILLAS\.(\w+),\s*parametros:\s*\[([^\]]*)\]/g)) {
    const [, clave, lista] = m;
    // Se cuentan las comas de primer nivel: los valores son expresiones que
    // pueden traer llamadas con sus propias comas.
    let nivel = 0, valores = lista.trim() ? 1 : 0;
    for (const c of lista) {
      if ("([{".includes(c)) nivel++;
      else if (")]}".includes(c)) nivel--;
      else if (c === "," && nivel === 0) valores++;
    }
    llamadas.push({ ruta: r.nombre, clave, nombre: PLANTILLAS[clave], valores });
  }
}

// Acá había un `llamadas.length === 7` fijo — el mismo problema que ya se
// corrigió más arriba con el conteo de PLANTILLAS: un número que hay que
// subir a mano cada vez que una ruta nueva manda una plantilla, y que se
// arregla cambiando un dígito sin mirar nada. Lo que de verdad importa no es
// CUÁNTAS llamadas hay en total, sino que CADA archivo de la lista tenga la
// suya: un archivo con cero matches es la señal real de que algo se rompió
// —la ruta dejó de usar el patrón `plantilla: PLANTILLAS.…` que este regex
// busca, o el regex ya no encaja con cómo quedó escrita la llamada.
console.log(`   se encontraron ${llamadas.length} llamadas con respaldo de plantilla`);
const sinLlamada = [...RUTAS, ...SERVICIOS].filter(r => !llamadas.some(l => l.ruta === r));
verificar("cada ruta/servicio de la lista tiene al menos una llamada con plantilla de respaldo",
  sinLlamada.length === 0);
if (sinLlamada.length) console.log("   sin ninguna:", sinLlamada.join(", "));

for (const l of llamadas) {
  const doc = documentadas[l.nombre];
  const pide = doc ? [...new Set(doc.numeros)].length : -1;
  verificar(`[${l.ruta}] «${l.nombre}» pasa ${l.valores} valores y la plantilla pide ${pide}`,
    l.valores === pide);
}

console.log("\n── 4. Ningún envío que inicia la plataforma quedó sin respaldo ──");
// Este es el control que de verdad importa a futuro. Si mañana alguien agrega
// un aviso nuevo con enviarTexto() a secas, va a funcionar en todas las
// pruebas y en desarrollo, y va a fallar en producción con los pacientes que
// no escribieron hace poco. Que son la mayoría.
//
// whatsappSalud.js es la ÚNICA excepción legítima: ahí siempre se está
// respondiendo a un mensaje que acaba de llegar.
const sueltos = [];
for (const r of [...RUTAS.map(r => ({ nombre: r, dir: "routes" })), { nombre: "whatsappSalud", dir: "routes" },
  { nombre: "vapi", dir: "routes" }, { nombre: "recordatorios", dir: "routes" },
  ...SERVICIOS.map(r => ({ nombre: r, dir: "services" }))]) {
  const archivo = path.join(RAIZ, r.dir, `${r.nombre}.js`);
  if (!fs.existsSync(archivo) || r.nombre === "whatsappSalud") continue;
  const codigo = fs.readFileSync(archivo, "utf8");
  // enviarTexto( a secas — no enviarTextoOPlantilla(
  for (const m of codigo.matchAll(/\benviarTexto\(/g)) {
    const antes = codigo.slice(0, m.index);
    sueltos.push(`${r.nombre}.js:${antes.split("\n").length}`);
  }
}
verificar("ningún archivo manda texto libre sin plantilla de respaldo", sueltos.length === 0);
sueltos.forEach(s => console.log("   ", s, "— usa enviarTextoOPlantilla()"));

console.log("\n── 5. El respaldo se dispara con el código correcto ──");
// 131047 es "pasaron más de 24 h". El 470 es el nombre viejo del mismo
// rechazo y todavía aparece en cuentas antiguas: si se cayera de la lista,
// esas cuentas volverían a perder mensajes en silencio.
const servicio = fs.readFileSync(path.join(RAIZ, "services", "metaWhatsapp.js"), "utf8");
verificar("reintenta con 131047 y también con el 470 viejo",
  /FUERA_DE_VENTANA = new Set\(\[131047, 470\]\)/.test(servicio));
verificar("y NO se traga los demás errores",
  /if \(!FUERA_DE_VENTANA\.has\(codigoDe\(e\)\)\) throw e;/.test(servicio));
verificar("enviarPlantilla y enviarTextoOPlantilla se exportan",
  typeof enviarPlantilla === "function" && typeof enviarTextoOPlantilla === "function");

const { normalizarDestino } = require(path.join(RAIZ, "services", "metaWhatsapp"));
verificar("un celular boliviano local recibe el prefijo 591",
  normalizarDestino("68548004", "BO") === "59168548004");
verificar("un celular brasileño con DDD recibe el prefijo 55",
  normalizarDestino("11987650001", "BR") === "5511987650001");
verificar("un número internacional no se modifica",
  normalizarDestino("59168548004", "BO") === "59168548004");

// ═══ 6. EL IDIOMA NUESTRO NO ES EL CÓDIGO DE META ══════════════════════════
//
// Symphomed guarda "es" o "pt" (Medico.idioma). Meta NO tiene un idioma "pt":
// tiene pt_BR y pt_PT. Mandar "pt" devuelve 132001 —"la plantilla no existe en
// ese idioma"— aunque la plantilla esté aprobada y perfecta.
//
// Esto NO era una precaución para el futuro: cuatro rutas ya pasaban
// `medico.idioma` directo, así que ninguna plantilla en portugués iba a
// funcionar nunca. Y es de los errores que no se ven, porque el que no recibe
// el mensaje está en Brasil y el que mira el log está en Bolivia.
console.log("\n── 6. El idioma del médico se traduce al código de Meta ──");
const { codigoDeIdioma } = require(path.join(RAIZ, "services", "metaWhatsapp"));
verificar('"pt" se manda como "pt_BR", que es el código que Meta conoce',
  codigoDeIdioma("pt") === "pt_BR");
verificar('"es" queda igual, que sí está en la lista de Meta',
  codigoDeIdioma("es") === "es");
// Quien escribió un código con región sabía lo que pedía: no se le toca.
verificar("un código con región ya puesto se respeta",
  codigoDeIdioma("pt_PT") === "pt_PT" && codigoDeIdioma("es_MX") === "es_MX");
// Vacío o nulo cae al español y no a "undefined", que sería un 132001 seguro.
verificar("sin idioma cae al español, no a un código inválido",
  codigoDeIdioma(undefined) === "es" && codigoDeIdioma("") === "es" && codigoDeIdioma(null) === "es");

// El enum de la base es lo que de verdad puede llegar acá. Si mañana alguien
// agrega un idioma y no lo mapea, esta prueba lo agarra antes que un médico.
const MODELOS = fs.readFileSync(path.join(RAIZ, "db", "models.js"), "utf8");
const enumIdioma = (MODELOS.match(/idioma: \{ type: String, enum: \[([^\]]+)\]/) || [])[1] || "";
const idiomas = [...enumIdioma.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
const sinMapear = idiomas.filter(i => codigoDeIdioma(i) === i && i !== "es");
verificar(`los ${idiomas.length} idiomas de la base (${idiomas.join(", ")}) tienen código de Meta`,
  idiomas.length > 0 && sinMapear.length === 0);
if (sinMapear.length) console.log("   sin mapear:", sinMapear.join(", "));

// ═══ 7. LAS DOS FORMAS DE VARIABLE QUE ACEPTA META ═════════════════════════
//
// Meta tiene dos estilos y la plantilla se aprueba con UNO:
//
//   posicional — {{1}}, {{2}}   → {type:"text", text:"…"}
//   con nombre — {{nome}}       → {type:"text", parameter_name:"nome", text:"…"}
//
// Las cinco primeras se aprobaron posicionales, pero el editor de Meta ahora
// abre en «Nombre» por defecto en las cuentas nuevas. Si una se aprueba así y
// mandamos posicionales, falla con la plantilla aprobada y correcta — que es
// la peor forma de fallar, porque no hay nada que revisar.
console.log("\n── 7. Las dos formas de variable de Meta ──");
const { componentesDelCuerpo } = require(path.join(RAIZ, "services", "metaWhatsapp"));

const posicional = componentesDelCuerpo(["Ana", "https://x.y"]);
verificar("un arreglo sale posicional, como las cinco ya aprobadas",
  posicional[0].parameters.every(p => p.type === "text" && !("parameter_name" in p)) &&
  posicional[0].parameters.map(p => p.text).join("|") === "Ana|https://x.y");

const conNombre = componentesDelCuerpo({ nome: "Ana", link: "https://x.y" });
verificar("un objeto sale con nombre, que es lo que pide el editor nuevo",
  conNombre[0].parameters.length === 2 &&
  conNombre[0].parameters[0].parameter_name === "nome" &&
  conNombre[0].parameters[1].parameter_name === "link");
// El nombre va aparte del texto: metido adentro del texto, Meta lo manda como
// contenido y al paciente le llega el nombre de la variable.
verificar("  ...con el nombre en su campo, no pegado al texto",
  conNombre[0].parameters[0].text === "Ana");

// Sin variables no se manda un `components` vacío con una lista vacía adentro:
// Meta lo rechaza. Tiene que ser el arreglo vacío.
verificar("sin variables no se manda ningún componente",
  componentesDelCuerpo([]).length === 0 && componentesDelCuerpo({}).length === 0 &&
  componentesDelCuerpo(undefined).length === 0);

// Un valor nulo tiene que viajar como cadena vacía y no como "null" escrito,
// que es lo que leería el paciente.
verificar("un valor vacío no le llega al paciente como «null»",
  componentesDelCuerpo([null])[0].parameters[0].text === "" &&
  componentesDelCuerpo({ nome: undefined })[0].parameters[0].text === "");

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
