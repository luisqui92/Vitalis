// Symphomed — Paquetes de idioma
//
// Los textos viven partidos por módulo: public/i18n/es/agenda.js tiene lo de
// la pantalla de agenda, y así. Eso es para las personas —archivos chicos,
// cada uno al lado conceptual del .js que le corresponde, y dos personas
// pueden traducir dos pantallas sin pisarse.
//
// Pero al navegador no le sirve: serían 39 módulos × N idiomas en etiquetas
// <script>. Así que al arrancar se concatenan en un archivo por idioma
// (public/i18n/es.js) y eso es lo que se sirve. Fuente modular, entrega en
// un archivo — el mismo trato que estaticosComprimidos.js le da al brotli.
//
// Se genera en el arranque y NO se versiona: es un derivado, y tener el
// generado en git garantiza que tarde o temprano quede desincronizado del
// original sin que nadie lo note.
//
// Es sincrónico a propósito, al revés que la precompresión: son kilobytes,
// tarda milisegundos, y si el servidor empezara a atender antes de tenerlos
// el primer médico en entrar vería la pantalla sin textos.
const fs = require("fs");
const path = require("path");
const { log } = require("../config");

const DIR_I18N = path.join(__dirname, "..", "public", "i18n");

function idiomasDisponibles() {
  try {
    return fs.readdirSync(DIR_I18N, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

function generar() {
  const idiomas = idiomasDisponibles();
  const hechos = [];

  for (const idioma of idiomas) {
    const dir = path.join(DIR_I18N, idioma);
    // Orden alfabético y no de descubrimiento: así el archivo generado sale
    // igual en cualquier máquina, y un diff entre despliegues muestra
    // cambios de verdad y no reordenamientos.
    const modulos = fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort();

    const partes = [
      `// GENERADO AUTOMÁTICAMENTE por services/i18nBundle.js — no editar.`,
      `// La fuente está en public/i18n/${idioma}/ (${modulos.length} módulo(s)).`,
      ``,
    ];
    for (const m of modulos) {
      partes.push(`// ── ${idioma}/${m} ──`);
      partes.push(fs.readFileSync(path.join(dir, m), "utf8").trimEnd());
      partes.push(``);
    }

    const salida = partes.join("\n");
    const destino = path.join(DIR_I18N, `${idioma}.js`);
    // Solo se escribe si cambió: si tocáramos el archivo en cada arranque,
    // estaticosComprimidos.js volvería a comprimirlo cada vez al pedo.
    let previo = null;
    try { previo = fs.readFileSync(destino, "utf8"); } catch { /* no existe */ }
    if (previo !== salida) fs.writeFileSync(destino, salida);
    hechos.push({ idioma, modulos: modulos.length, bytes: Buffer.byteLength(salida) });
  }

  return hechos;
}

// Se llama al arrancar, antes de que el servidor escuche.
function prepararIdiomas() {
  try {
    const hechos = generar();
    if (hechos.length) {
      log.info(`[IDIOMAS] ${hechos.map(h => `${h.idioma} (${h.modulos} módulos, ${(h.bytes / 1024).toFixed(1)} KB)`).join(" · ")}`);
    }
    // Un idioma cuya carpeta existe pero al que nadie le puso su <script> en
    // index.html falla en silencio: el diccionario nunca llega al navegador,
    // t() cae al español para TODO, y parece que la traducción no se hizo.
    // Es un rato largo de buscar por el lado equivocado, así que se avisa.
    try {
      const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
      const sinCargar = hechos.filter(h => !html.includes(`/i18n/${h.idioma}.js`)).map(h => h.idioma);
      if (sinCargar.length) {
        log.warn(`[IDIOMAS] ${sinCargar.join(", ")} tiene textos pero index.html no los carga — agregá <script src="/i18n/${sinCargar[0]}.js"></script>`);
      }
    } catch { /* si no se puede leer el html, el aviso no es crítico */ }
    return hechos;
  } catch (e) {
    log.error("[IDIOMAS] no se pudieron armar los paquetes: " + e.message);
    return [];
  }
}

module.exports = { prepararIdiomas, generar, idiomasDisponibles };
