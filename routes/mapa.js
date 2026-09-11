// Symphomed — El mapa de servicios médicos.
//
// ═══ QUÉ ES ESTO HOY, Y QUÉ NO ════════════════════════════════════════════
//
// Es una DEMOSTRACIÓN para vender. Los consultorios que aparecen son de
// ejemplo y están marcados como tales en la pantalla, uno por uno. Sirve para
// sentarse con un médico y mostrarle dónde va a estar, no para que un
// paciente busque atención todavía.
//
// Eso no es una limitación temporal que haya que disimular: es lo que hace
// que la demostración sea honesta. Un mapa con consultorios inventados que se
// hicieran pasar por reales es una mentira que después hay que sostener, y el
// primer médico que reconozca una dirección falsa de su barrio deja de creer
// todo lo demás.
//
// Cuando haya médicos de verdad, esta misma pantalla se alimenta de Medico +
// Membrete y los ejemplos se van. La lista vive en vistas/mapa.html para que
// reemplazarla sea un cambio de datos y no de código.
//
// ═══ POR QUÉ TIENE SU PROPIA CSP ══════════════════════════════════════════
//
// Es la única pantalla de Symphomed que trae algo de afuera: los mosaicos del
// mapa. Por eso no puede ir con la CSP de la página de inicio —que es
// img-src 'self'— y tampoco tendría sentido aflojar aquella para todo el
// sitio por una sola pantalla. Acá se abre el mínimo: imágenes desde los
// servidores de mosaicos, y nada más.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { log } = require("../config");

const VISTAS = path.join(__dirname, "..", "vistas");

// De dónde salen los mosaicos. En una variable para poder cambiar de
// proveedor sin desplegar: el día que haga falta un mapa con más detalle, o
// uno pago, es una línea del .env.
const MOSAICOS = String(process.env.MAPA_MOSAICOS ||
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
const MOSAICOS_ORIGEN = String(process.env.MAPA_MOSAICOS_ORIGEN ||
  "https://*.tile.openstreetmap.org");

// Dónde se centra al abrir. Cochabamba por defecto.
const CENTRO = String(process.env.MAPA_CENTRO || "-17.3935,-66.1570");
const ZOOM = String(Number(process.env.MAPA_ZOOM) || 13);

let PLANTILLA = "";
try {
  PLANTILLA = fs.readFileSync(path.join(VISTAS, "mapa.html"), "utf8");
} catch (e) {
  log.warn(`[MAPA] No se pudo leer vistas/mapa.html: ${e.message}`);
}

module.exports = (app) => {
  app.get("/mapa", (_req, res) => {
    if (!PLANTILLA) return res.status(404).send("No encontrado");
    const nonce = crypto.randomBytes(16).toString("base64");
    res.setHeader("Content-Security-Policy", [
      "default-src 'none'",
      // 'self' además del nonce porque Leaflet se sirve como archivo propio
      // desde /vendor, y un script-src de solo nonce también bloquea a los
      // <script src> del mismo origen.
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `img-src 'self' data: ${MOSAICOS_ORIGEN}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(
      PLANTILLA
        .replace(/__NONCE__/g, nonce)
        .replace(/__MOSAICOS__/g, MOSAICOS)
        .replace(/__CENTRO__/g, CENTRO)
        .replace(/__ZOOM__/g, ZOOM)
    );
  });

  log.info(`[MAPA] Mapa de servicios en /mapa — centro ${CENTRO}, zoom ${ZOOM}`);
};
