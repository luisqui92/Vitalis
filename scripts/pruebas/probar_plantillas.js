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

console.log("── 1. El documento tiene las tres plantillas ──");
const esperadas = Object.values(PLANTILLAS);
verificar(`el código conoce ${esperadas.length}: ${esperadas.join(", ")}`, esperadas.length === 3);
esperadas.forEach(n => verificar(`  «${n}» está documentada`, Boolean(documentadas[n])));

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
const RUTAS = ["citas", "reservaPublica", "consultaMedica", "informes"];
const llamadas = [];
for (const r of RUTAS) {
  const codigo = fs.readFileSync(path.join(RAIZ, "routes", `${r}.js`), "utf8");
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
    llamadas.push({ ruta: r, clave, nombre: PLANTILLAS[clave], valores });
  }
}

verificar(`se encontraron las ${llamadas.length} llamadas con respaldo de plantilla`, llamadas.length === 5);
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
for (const r of [...RUTAS, "whatsappSalud", "vapi", "recordatorios"]) {
  const archivo = path.join(RAIZ, "routes", `${r}.js`);
  if (!fs.existsSync(archivo) || r === "whatsappSalud") continue;
  const codigo = fs.readFileSync(archivo, "utf8");
  // enviarTexto( a secas — no enviarTextoOPlantilla(
  for (const m of codigo.matchAll(/\benviarTexto\(/g)) {
    const antes = codigo.slice(0, m.index);
    sueltos.push(`${r}.js:${antes.split("\n").length}`);
  }
}
verificar("ninguna ruta manda texto libre sin plantilla de respaldo", sueltos.length === 0);
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

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
