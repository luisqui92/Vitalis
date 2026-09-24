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

function ofuscarArchivo(rutaOrigen, rutaDestino) {
  const codigo = fs.readFileSync(rutaOrigen, "utf8");
  const resultado = JavaScriptObfuscator.obfuscate(codigo, OPCIONES).getObfuscatedCode();
  fs.mkdirSync(path.dirname(rutaDestino), { recursive: true });
  fs.writeFileSync(rutaDestino, resultado);
}

function main() {
  const archivos = fs.readdirSync(ORIGEN).filter(f => f.endsWith(".js"));
  console.log(`Ofuscando ${archivos.length} archivo(s) de ${ORIGEN}`);
  console.log(`  → ${SALIDA}${SALIDA === ORIGEN ? " (en el lugar)" : ""}\n`);

  let ok = 0, fallidos = 0;
  for (const archivo of archivos) {
    const origen = path.join(ORIGEN, archivo);
    const destino = path.join(SALIDA, archivo);
    try {
      ofuscarArchivo(origen, destino);
      ok++;
    } catch (e) {
      fallidos++;
      console.error(`  ✗ ${archivo}: ${e.message}`);
    }
  }
  console.log(`${ok} ofuscado(s), ${fallidos} fallido(s).`);
  if (fallidos > 0) process.exit(1);
}

main();
