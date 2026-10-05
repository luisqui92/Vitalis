// Symphomed — Que ofuscar public/js/ no rompa nada.
//
// No levanta un navegador (Playwright no es una dependencia del proyecto,
// y no tiene sentido que lo sea solo para esto) — comprueba lo que se
// puede comprobar sin uno: que el resultado sigue siendo JavaScript
// válido, que los comentarios y nombres locales desaparecieron de verdad
// (que es todo el punto), y que los nombres GLOBALES —los que un archivo
// usa para llamar a otro, dado que Symphomed no usa ningún empaquetador—
// sobrevivieron intactos, porque si no sobreviven la pantalla queda en
// blanco.
//
// Antes este encabezado decía que, con los globales intactos y la sintaxis
// válida, «no hay mecanismo por el que el comportamiento cambie». Había uno:
// el ofuscador agrega sus PROPIAS funciones globales (la tabla de cadenas y
// su decodificador) con nombres cortos al azar, y dos archivos podían sacar
// el mismo. El que se cargaba después pisaba al otro, y el primero leía sus
// cadenas de la tabla ajena. Encontrado con audio.js y neurodesarrollo.js:
// grabar una consulta fallaba. Por eso ahora también se prueba que ningún
// nombre inventado por el ofuscador se repita entre archivos (sección 3), y
// la grabación se prueba en un navegador con el código ofuscado
// (probar_nota_en_vivo_pantalla.js con OFUSCADO=1).
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Los globales que MÁS archivos comparten — si estos sobreviven, el patrón
// general (renameGlobals:false) está funcionando; no hace falta listar los
// centenares de funciones globales de los 62 archivos para confiar en esto.
const GLOBALES_CRITICOS = [
  "TOKEN", "MEDICO_NOMBRE", "MEDICO_ROL", "api", "esc", "t",
  "completarLogin", "renderDashboard", "renderLogin", "renderSeguridad", "logout",
];

(async () => {
  const ORIGEN = path.join(RAIZ, "public", "js");
  const SALIDA = fs.mkdtempSync(path.join(require("os").tmpdir(), "ofuscado-"));

  execFileSync(process.execPath, [path.join(RAIZ, "scripts", "ofuscar.js"), "--salida", SALIDA], { stdio: "pipe" });

  const archivos = fs.readdirSync(ORIGEN).filter(f => f.endsWith(".js"));
  console.log(`── ${archivos.length} archivo(s) ──`);

  let sintaxisOk = 0, comentariosFuera = 0;
  const sinCodigoInyectado = [];
  for (const archivo of archivos) {
    const destino = path.join(SALIDA, archivo);
    verificar(`existe la salida de ${archivo}`, fs.existsSync(destino));
    if (!fs.existsSync(destino)) continue;

    try {
      execFileSync(process.execPath, ["--check", destino], { stdio: "pipe" });
      sintaxisOk++;
    } catch (e) {
      console.log(`  ❌ ${archivo}: JavaScript inválido —`, e.stderr?.toString().split("\n")[0]);
    }

    const codigo = fs.readFileSync(destino, "utf8");
    // Los comentarios largos con "═══" son la marca registrada de este
    // proyecto — si sobrevive uno solo, algo no se está ofuscando.
    if (!codigo.includes("═══") && !codigo.includes("// Symphomed")) comentariosFuera++;

    // NO se compara el peso contra el original: en un archivo con muchos
    // comentarios y poco código (i18n.js, rutas.js) borrar los comentarios
    // pesa más que lo que la ofuscación agrega, y el resultado sale más
    // chico aunque la transformación haya sido real. Lo que sí prueba que
    // hubo transformación real —no una simple limpieza de comentarios— es
    // que aparezca el generador de cadenas codificadas que arma
    // stringArray: si falta, ese archivo no pasó por el ofuscador de
    // verdad, solo se le voló el comentario.
    if (!/_0x[0-9a-f]{4,}/i.test(codigo)) sinCodigoInyectado.push(archivo);
  }
  verificar(`los ${archivos.length} archivos siguen siendo JavaScript válido`, sintaxisOk === archivos.length);
  verificar(`en ninguno sobrevive un comentario de los nuestros`, comentariosFuera === archivos.length);
  verificar(`todos tienen ofuscación real de verdad, no solo comentarios borrados`, sinCodigoInyectado.length === 0);
  if (sinCodigoInyectado.length) console.log("   sin ofuscar de verdad:", sinCodigoInyectado.join(", "));

  console.log(`\n── Los globales que un archivo usa para llamar a otro ──`);
  // Se buscan en TODO el conjunto ofuscado junto, no archivo por archivo:
  // lo que importa es que el nombre "TOKEN" siga siendo "TOKEN" en
  // CUALQUIER archivo que lo declare y en CUALQUIERA que lo use — si un
  // archivo lo renombrara y otro no, se rompe iguales que si ninguno lo
  // tuviera.
  const todoElOfuscado = archivos.map(a => fs.readFileSync(path.join(SALIDA, a), "utf8")).join("\n");
  for (const nombre of GLOBALES_CRITICOS) {
    // \b para no confundir "api" adentro de "apiOtroNombre".
    const aparece = new RegExp(`\\b${nombre}\\b`).test(todoElOfuscado);
    verificar(`«${nombre}» sigue existiendo con su nombre (no se renombró)`, aparece);
  }

  console.log(`\n── 3. Ningún nombre inventado por el ofuscador se repite entre archivos ──`);
  const { choquesDeGlobales, nombresGlobales } = require(path.join(RAIZ, "scripts", "ofuscar.js"));
  const resultados = archivos.map(a => ({ archivo: a, original: fs.readFileSync(path.join(ORIGEN, a), "utf8"), ofuscado: fs.readFileSync(path.join(SALIDA, a), "utf8") }));
  const choques = choquesDeGlobales(resultados);
  verificar(`sin nombres globales repetidos entre los ${archivos.length} archivos${choques.length ? " — " + choques.map(([n, xs]) => `${n}: ${xs.join(", ")}`).join("; ") : ""}`, !choques.length);
  const inventados = resultados.flatMap(r => { const propios = new Set(nombresGlobales(r.original)); return nombresGlobales(r.ofuscado).filter(n => !propios.has(n)).map(n => [r.archivo, n]); });
  verificar(`cada global inventado lleva el prefijo de SU archivo (${inventados.length} revisados)`,
    inventados.length > 0 && inventados.every(([a, n]) => n.startsWith("o" + a.replace(/\.js$/, "").replace(/[^A-Za-z0-9]/g, "_") + "_")));
  // El caso real, armado a mano: dos archivos con la misma tabla «_0x2768».
  const real = choquesDeGlobales([
    { archivo: "audio.js", original: "function crearGrabadora(){}", ofuscado: "function _0x2768(){} function crearGrabadora(){}" },
    { archivo: "neurodesarrollo.js", original: "function renderNeuro(){}", ofuscado: "function _0x2768(){} function renderNeuro(){}" },
  ]);
  verificar("el choque de audio.js y neurodesarrollo.js se detecta", real.length === 1 && real[0][0] === "_0x2768");
  verificar("un global propio de cada archivo no se toma como choque", !real.some(([n]) => n === "crearGrabadora"));

  fs.rmSync(SALIDA, { recursive: true, force: true });
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(e => { console.error("💥", e.message); process.exit(1); });
