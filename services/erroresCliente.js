// Symphomed — Los errores de la pantalla, en el servidor.
//
// ═══ POR QUÉ ═══════════════════════════════════════════════════════════════
//
// Cuando algo fallaba en el celular de un médico, nadie se enteraba hasta que
// mandaba una foto de «Erro ao carregar a consulta», y después había que
// adivinar qué había sido. Ahora la pantalla avisa sola (public/js/errores.js)
// y queda acá, con dónde y en qué versión, para verlo el mismo día con
// scripts/errores_pantalla.js.
//
// ═══ SIN DATOS DE PACIENTES ════════════════════════════════════════════════
//
// Llega el mensaje técnico («Cannot read properties of null…»), el archivo y
// la línea, la pantalla y el idioma. Igual se limpia acá, por si un mensaje
// trajera algo de más: números largos (teléfonos, documentos), correos e ids
// se tapan, y todo se corta a un largo fijo.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ErrorCliente } = require("../db/models");
const { log } = require("../config");

const DIR_MAPAS = path.join(__dirname, "..", "ofuscado-mapas");
const MAX_MEDICOS = 20;

function limpiar(texto, largo) {
  return String(texto || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "«correo»")
    .replace(/\b[0-9a-f]{24}\b/gi, ":id")
    .replace(/\d{6,}/g, "#")
    .slice(0, largo);
}

// Las rutas de la app traen ids de pacientes y consultas: se tapan.
const limpiarPantalla = (p) => limpiar(String(p || "").split("?")[0], 120);

// La versión del ofuscado que está publicada ahora. Si no hay (desarrollo,
// sin ofuscar), «sin-ofuscar».
let versionCache = { mtime: 0, version: "sin-ofuscar" };
function versionActual(dir = DIR_MAPAS) {
  try {
    const archivo = path.join(dir, "actual.json");
    const st = fs.statSync(archivo);
    if (st.mtimeMs !== versionCache.mtime) {
      versionCache = { mtime: st.mtimeMs, version: JSON.parse(fs.readFileSync(archivo, "utf8")).version || "sin-ofuscar" };
    }
    return versionCache.version;
  } catch {
    return "sin-ofuscar";
  }
}

// El primer lugar de NUESTRO código en la pila: «consultas.js:1:48213».
function primerMarco(pila) {
  const m = String(pila || "").match(/\/js\/([\w.-]+\.js):(\d+):(\d+)/);
  return m ? { archivo: m[1], linea: Number(m[2]), columna: Number(m[3]) } : null;
}

async function registrarError(datos, medicoPhone, { version } = {}) {
  const mensaje = limpiar(datos?.mensaje, 300);
  if (!mensaje) return null;
  const pila = limpiar(datos?.pila, 1500);
  const contexto = limpiar(datos?.contexto, 40);
  const pantalla = limpiarPantalla(datos?.pantalla);
  const ver = version || versionActual();
  const marco = primerMarco(pila);
  // Mismo error = mismo mensaje en el mismo lugar de la misma versión.
  const huella = crypto.createHash("sha1")
    .update([mensaje, marco ? `${marco.archivo}:${marco.linea}:${marco.columna}` : "", ver].join("|")).digest("hex");
  const ahora = new Date();
  const actualizar = {
    $setOnInsert: { huella, mensaje, pila, contexto, version: ver, primera: ahora },
    $set: { ultima: ahora, pantalla, idioma: limpiar(datos?.idioma, 5), navegador: limpiar(datos?.navegador, 120) },
    $inc: { veces: 1 },
  };
  const doc = await ErrorCliente.findOneAndUpdate({ huella }, actualizar, { upsert: true, new: true });
  if (medicoPhone && !doc.medicos.includes(medicoPhone) && doc.medicos.length < MAX_MEDICOS) {
    await ErrorCliente.updateOne({ _id: doc._id }, { $addToSet: { medicos: medicoPhone } });
  }
  // La primera vez, al log: es lo que se ve con pm2 logs.
  if (doc.veces === 1) {
    log.warn(`[ERROR_PANTALLA] ${pantalla || "?"} ${marco ? `${marco.archivo}:${marco.linea}:${marco.columna}` : ""} — ${mensaje} (versión ${ver}, ${medicoPhone || "sin sesión"})`);
  }
  return doc;
}

// «consultas.js:1:48213» de la versión X → «consultas.js:745 (renderDetalle)»,
// con el mapa que guardó scripts/ofuscar.js. Si no hay mapa, la posición tal cual.
const consumidores = new Map();
function traducir(pila, version, dir = DIR_MAPAS) {
  const marco = primerMarco(pila);
  if (!marco) return "";
  const crudo = `${marco.archivo}:${marco.linea}:${marco.columna}`;
  if (!version || version === "sin-ofuscar") return crudo;
  try {
    const clave = `${version}/${marco.archivo}`;
    if (!consumidores.has(clave)) {
      const { SourceMapConsumer } = require("source-map");
      const mapa = JSON.parse(fs.readFileSync(path.join(dir, version, marco.archivo + ".map"), "utf8"));
      consumidores.set(clave, new SourceMapConsumer(mapa));
    }
    const p = consumidores.get(clave).originalPositionFor({ line: marco.linea, column: marco.columna - 1 });
    if (!p || p.line == null) return crudo + " (sin traducir)";
    // Y la línea de código original: con eso se entiende qué falló.
    const fuente = consumidores.get(clave).sourceContentFor(p.source, true) || "";
    const codigo = (fuente.split("\n")[p.line - 1] || "").trim().slice(0, 140);
    return `${marco.archivo}:${p.line}${codigo ? `  →  ${codigo}` : ""}`;
  } catch {
    return crudo + " (sin el mapa de esa versión)";
  }
}

module.exports = { registrarError, traducir, versionActual, primerMarco, limpiar, DIR_MAPAS };
