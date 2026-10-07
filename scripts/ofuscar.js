// Symphomed — Ofuscar el JS del cliente para producción.
//
// ═══ POR QUÉ ═════════════════════════════════════════════════════════════
//
// Todo lo que corre en el navegador se puede leer con las herramientas de
// desarrollador — eso no tiene arreglo, es cómo funciona la web. Lo que SÍ
// se puede hacer es que leerlo no sirva de nada: sin comentarios, sin
// nombres que digan qué hace cada cosa, con las cadenas de texto
// codificadas. No hace el código invisible; hace que entenderlo o
// reusarlo cueste días de trabajo en vez de un copy-paste.
//
// ═══ QUÉ NO SE TOCA, Y POR QUÉ ═══════════════════════════════════════════
//
// Los nombres GLOBALES (funciones y variables de nivel superior de cada
// archivo) se dejan tal cual. Symphomed no usa ningún empaquetador — cada
// pantalla es un <script> aparte que llama funciones de OTROS archivos por
// nombre (por ejemplo, pacientes.js llama a renderSeguridad(), que vive en
// seguridad.js). Si se renombraran los globales, cada archivo elegiría un
// nombre al azar por su cuenta y esas llamadas entre archivos se romperían
// TODAS — la pantalla quedaría en blanco. Los nombres LOCALES (variables
// adentro de una función) sí se ofuscan sin ese riesgo: nadie los llama
// desde otro archivo. `renameGlobals: false` es la línea que evita esto —
// no tocarla.
//
// ═══ QUÉ NO SE VERSIONA ═══════════════════════════════════════════════════
//
// El resultado no va a git: se genera en cada despliegue, igual que
// public/i18n/es.js (ver services/i18nBundle.js). El repositorio sigue
// teniendo el código legible — es lo que hace falta para poder mantenerlo.
//
// Uso:
//   node scripts/ofuscar.js                          (ofusca public/js/ en el lugar)
//   node scripts/ofuscar.js --salida /otra/carpeta    (para probar sin tocar el original)
const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ORIGEN = path.join(__dirname, "..", "public", "js");
const iSalida = process.argv.indexOf("--salida");
const SALIDA = iSalida !== -1 && process.argv[iSalida + 1] ? path.resolve(process.argv[iSalida + 1]) : ORIGEN;

const OPCIONES = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  // false a propósito: con debugProtection en true, el navegador queda en
  // un loop de "debugger" apenas alguien abre las herramientas de
  // desarrollador — y eso incluye a tu propio soporte técnico tratando de
  // diagnosticar un problema real de un médico.
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false, // CRÍTICO — ver el comentario de arriba
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  splitStrings: false,
  transformObjectKeys: false,
  numbersToExpressions: false,
  simplify: true,
};

// ═══ CADA ARCHIVO CON SU PREFIJO ═══════════════════════════════════════════
//
// El ofuscador agrega sus propias funciones (la que guarda las cadenas
// codificadas y la que las decodifica) al nivel superior de cada archivo, con
// nombres cortos al azar como «_0x2768». En el navegador cada archivo es un
// <script> aparte, así que esas funciones son GLOBALES: si dos archivos
// sacan el mismo nombre, el que se carga después pisa al otro, y el primero
// decodifica sus cadenas con la tabla ajena. Pasó: audio.js y
// neurodesarrollo.js sacaron «_0x2768» y grabar una consulta tiraba
// «_0x324bdd[...] is not a function». Con 64 archivos, pasaba en más o menos
// uno de cada diez despliegues, a una pantalla cualquiera.
//
// identifiersPrefix es la solución que da el propio ofuscador: un prefijo
// distinto por archivo para todo lo global que él inventa.
function prefijoDe(archivo) {
  return "o" + archivo.replace(/\.js$/, "").replace(/[^A-Za-z0-9]/g, "_") + "_";
}

// ═══ EL MAPA DE CADA ARCHIVO ════════════════════════════════════════════════
//
// Un error en el celular de un médico llega como «consultas.js, línea 1,
// columna 48213»: en el ofuscado todo es una sola línea, y así no se puede
// saber qué falló. El mapa traduce esa posición a la del código original
// («consultas.js:745, renderDetalle»). Lo usa scripts/errores_pantalla.js.
//
// Los mapas NO se publican: tienen el código legible adentro, que es justo
// lo que la ofuscación esconde. Van a ofuscado-mapas/<versión>/, fuera de
// public/, y el ofuscado no los menciona.
function ofuscarCodigo(codigo, archivo) {
  return ofuscarConMapa(codigo, archivo).codigo;
}

function ofuscarConMapa(codigo, archivo) {
  const r = JavaScriptObfuscator.obfuscate(codigo, {
    ...OPCIONES, identifiersPrefix: prefijoDe(archivo),
    sourceMap: true, sourceMapMode: "separate", sourceMapSourcesMode: "sources-content", inputFileName: archivo,
  });
  // Por las dudas: que el ofuscado nunca apunte a su mapa.
  return { codigo: r.getObfuscatedCode().replace(/\n?\/\/# sourceMappingURL=.*$/m, ""), mapa: r.getSourceMap() };
}

const MAPAS_A_GUARDAR = 5;   // versiones: las de los últimos despliegues

// Dónde van los mapas: en el despliegue (en el lugar), ofuscado-mapas/ en
// la raíz; probando con --salida, al lado de esa carpeta.
function carpetaDeMapas() {
  return SALIDA === ORIGEN ? path.join(__dirname, "..", "ofuscado-mapas") : SALIDA + "-mapas";
}

function guardarMapas(resultados) {
  const raiz = carpetaDeMapas();
  const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "") + "-" + Math.random().toString(36).slice(2, 6);
  const dir = path.join(raiz, version);
  fs.mkdirSync(dir, { recursive: true });
  for (const { archivo, mapa } of resultados) if (mapa) fs.writeFileSync(path.join(dir, archivo + ".map"), mapa);
  fs.writeFileSync(path.join(raiz, "actual.json"), JSON.stringify({ version, fecha: new Date().toISOString() }));
  // Solo las últimas versiones: un error de hace un mes ya no importa.
  const viejas = fs.readdirSync(raiz, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().reverse().slice(MAPAS_A_GUARDAR);
  for (const v of viejas) fs.rmSync(path.join(raiz, v), { recursive: true, force: true });
  return version;
}

// Los nombres declarados en el nivel superior de un archivo: los que quedan
// globales en el navegador.
function nombresGlobales(codigo) {
  let acorn;
  try { acorn = require("acorn"); } catch { acorn = require(require.resolve("acorn", { paths: [require.resolve("javascript-obfuscator")] })); }
  let ast;
  try { ast = acorn.parse(codigo, { ecmaVersion: "latest", sourceType: "script" }); } catch { ast = acorn.parse(codigo, { ecmaVersion: "latest", sourceType: "module" }); }
  const nombres = [];
  for (const n of ast.body) {
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) nombres.push(n.id.name);
    if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") nombres.push(d.id.name);
  }
  return nombres;
}

// Lo que el ofuscador agregó como global (lo que no estaba en el original) y
// aparece en más de un archivo. Tiene que dar vacío.
function choquesDeGlobales(resultados) {
  const duenos = new Map();
  for (const { archivo, original, ofuscado } of resultados) {
    const propios = new Set(nombresGlobales(original));
    for (const nombre of new Set(nombresGlobales(ofuscado))) {
      if (propios.has(nombre)) continue;
      if (!duenos.has(nombre)) duenos.set(nombre, []);
      duenos.get(nombre).push(archivo);
    }
  }
  return [...duenos].filter(([, archivos]) => archivos.length > 1);
}

function main() {
  const archivos = fs.readdirSync(ORIGEN).filter(f => f.endsWith(".js"));
  console.log(`Ofuscando ${archivos.length} archivo(s) de ${ORIGEN}`);
  console.log(`  → ${SALIDA}${SALIDA === ORIGEN ? " (en el lugar)" : ""}\n`);

  // Primero todo en memoria, y recién si está bien se escribe: los archivos
  // se sirven tal cual, así que escribir uno roto es publicarlo al instante.
  let fallidos = 0;
  const resultados = [];
  for (const archivo of archivos) {
    try {
      const original = fs.readFileSync(path.join(ORIGEN, archivo), "utf8");
      const { codigo, mapa } = ofuscarConMapa(original, archivo);
      resultados.push({ archivo, original, ofuscado: codigo, mapa });
    } catch (e) {
      fallidos++;
      console.error(`  ✗ ${archivo}: ${e.message}`);
    }
  }
  if (fallidos > 0) {
    console.error(`${fallidos} fallido(s). No se escribió nada: sigue el código anterior.`);
    process.exit(1);
  }
  const choques = choquesDeGlobales(resultados);
  if (choques.length) {
    for (const [nombre, archivos2] of choques) console.error(`  ✗ «${nombre}» quedó global en ${archivos2.join(", ")}`);
    console.error("Dos archivos comparten un nombre global inventado por el ofuscador. No se escribió nada: sigue el código anterior.");
    process.exit(1);
  }
  for (const { archivo, ofuscado } of resultados) {
    const destino = path.join(SALIDA, archivo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, ofuscado);
  }
  const version = guardarMapas(resultados);
  console.log(`${resultados.length} ofuscado(s), 0 fallido(s), sin nombres globales repetidos. Versión ${version}.`);
}

if (require.main === module) main();

module.exports = { choquesDeGlobales, nombresGlobales, prefijoDe, OPCIONES };
