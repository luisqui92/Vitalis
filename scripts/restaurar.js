#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Restaurar una copia de seguridad
// ═══════════════════════════════════════════════════════════════════════════
// Uso:
//   node scripts/restaurar.js                        → lista los respaldos
//   node scripts/restaurar.js <archivo> --revisar    → muestra qué contiene
//   node scripts/restaurar.js <archivo> --a-prueba   → restaura en una base
//                                                      aparte, sin tocar nada
//   node scripts/restaurar.js <archivo> --encima     → PISA la base real
//
// El día que haga falta esto, quien lo corra va a estar nervioso y con poco
// tiempo. Por eso: sin banderas no hace nada, "--encima" pide escribir una
// palabra a mano, y lo primero que se ofrece es la restauración de prueba,
// que es la que uno quiere el 90% de las veces.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");
const { promisify } = require("util");
const { EJSON } = require("bson");

const gunzip = promisify(zlib.gunzip);

// Se carga .env igual que la app, para tomar MONGODB_URI y BACKUP_CLAVE sin
// que haya que exportarlas a mano en un momento de apuro.
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }

const { descifrar, DIR_BACKUPS } = require("../services/backup");
const mongoose = require("mongoose");

const args = process.argv.slice(2);
const banderas = new Set(args.filter(a => a.startsWith("--")));
const archivo = args.find(a => !a.startsWith("--"));

function humano(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

function listar() {
  if (!fs.existsSync(DIR_BACKUPS)) {
    console.log("\n  No existe la carpeta de respaldos:", DIR_BACKUPS, "\n");
    return;
  }
  const manifiestos = fs.readdirSync(DIR_BACKUPS).filter(n => n.endsWith(".json"))
    .map(n => { try { return JSON.parse(fs.readFileSync(path.join(DIR_BACKUPS, n), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (!manifiestos.length) { console.log("\n  Todavía no hay ningún respaldo.\n"); return; }

  console.log("\n  Respaldos disponibles (del más nuevo al más viejo):\n");
  for (const m of manifiestos) {
    const marca = m.verificado === true ? "✅" : m.verificado === false ? "❌" : "  ";
    console.log(`  ${marca} ${new Date(m.fecha).toLocaleString("es-BO")}  ${String(m.documentos).padStart(7)} docs  ${String(m.archivos).padStart(5)} archivos  ${humano(m.bytesBase + m.bytesArchivos).padStart(9)}  ${m.cifrado ? "cifrado" : "SIN CIFRAR"}`);
    console.log(`      ${path.join(DIR_BACKUPS, m.archivoBase)}`);
  }
  console.log(`
  Para ver qué tiene adentro uno de ellos:
    node scripts/restaurar.js <archivo> --revisar

  Para restaurarlo en una base APARTE y revisarlo sin tocar nada (recomendado):
    node scripts/restaurar.js <archivo> --a-prueba
`);
}

async function leerPaquete(ruta) {
  const crudo = fs.readFileSync(ruta);
  return JSON.parse((await gunzip(descifrar(crudo))).toString("utf8"));
}

async function revisar(ruta) {
  const p = await leerPaquete(ruta);
  console.log(`\n  Respaldo del ${new Date(p.fecha).toLocaleString("es-BO")}`);
  console.log(`  Base de datos original: ${p.baseDatos}\n`);
  const filas = Object.entries(p.conteos).sort((a, b) => b[1] - a[1]);
  for (const [nombre, n] of filas) console.log(`    ${String(n).padStart(7)}  ${nombre}`);
  console.log(`\n    ${String(filas.reduce((a, b) => a + b[1], 0)).padStart(7)}  TOTAL\n`);
}

async function restaurar(ruta, { encima }) {
  const p = await leerPaquete(ruta);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Falta MONGODB_URI (revisá el .env)");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const cliente = mongoose.connection.getClient();
  const destino = encima ? mongoose.connection.name : `${p.baseDatos}__restaurado`;
  const db = cliente.db(destino);

  console.log(`\n  Restaurando en: ${destino}${encima ? "  ⚠️  ES LA BASE REAL" : "  (base de prueba, la real no se toca)"}\n`);

  let total = 0;
  for (const [nombre, texto] of Object.entries(p.colecciones)) {
    const docs = EJSON.parse(texto, { relaxed: false });
    await db.collection(nombre).deleteMany({});
    if (docs.length) await db.collection(nombre).insertMany(docs, { ordered: false });
    const cuantos = await db.collection(nombre).countDocuments();
    const bien = cuantos === p.conteos[nombre];
    console.log(`    ${bien ? "✅" : "❌"} ${nombre}: ${cuantos}${bien ? "" : ` (se esperaban ${p.conteos[nombre]})`}`);
    total += cuantos;
  }

  console.log(`\n  ${total} documentos restaurados en "${destino}".`);
  if (!encima) {
    console.log(`
  La base real quedó intacta. Para mirar lo restaurado:
    mongosh "${uri.replace(/[^/]*$/, destino)}"

  Si está todo bien y querés que reemplace a la real, volvé a correr esto
  con --encima. Antes de eso, hacé un respaldo de lo que hay ahora.
`);
  } else {
    console.log(`
  Listo. Falta una cosa más: los archivos de estudios.
    tar -xzf <respaldo>-archivos.tar.gz -C <carpeta de Symphomed>
  (si el .tar.gz está cifrado, descifralo primero con --extraer-archivos)

  Y reiniciá Symphomed:  pm2 restart vitalis
`);
  }
  await mongoose.disconnect();
}

async function confirmar(texto, palabra) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await new Promise(res => rl.question(texto, res));
  rl.close();
  return r.trim() === palabra;
}

(async () => {
  if (!archivo) return listar();
  const ruta = path.isAbsolute(archivo) ? archivo : path.resolve(archivo);
  if (!fs.existsSync(ruta)) { console.error("\n  ✗ No existe ese archivo:", ruta, "\n"); process.exit(1); }

  if (banderas.has("--revisar")) return revisar(ruta);
  if (banderas.has("--a-prueba")) return restaurar(ruta, { encima: false });

  if (banderas.has("--encima")) {
    console.log(`
  ⚠️  ESTO VA A BORRAR Y REEMPLAZAR LA BASE DE DATOS REAL DE SYMPHOMED.
      Todo lo que se haya cargado después de este respaldo se pierde.

      Respaldo:  ${ruta}
      Base:      ${process.env.MONGODB_URI}
`);
    const ok = await confirmar('  Escribí exactamente  RESTAURAR  para seguir: ', "RESTAURAR");
    if (!ok) { console.log("\n  Cancelado. No se tocó nada.\n"); process.exit(0); }
    return restaurar(ruta, { encima: true });
  }

  console.log(`
  Elegí qué hacer con ese respaldo:

    --revisar     ver qué tiene adentro, sin tocar nada
    --a-prueba    restaurarlo en una base aparte para revisarlo (recomendado)
    --encima      reemplazar la base real (pide confirmación)
`);
})().catch(e => { console.error("\n  ✗", e.message, "\n"); process.exit(1); });
