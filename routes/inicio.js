// Symphomed — La página que ve alguien que todavía no es cliente.
//
// ═══ POR QUÉ NO ES UN ARCHIVO EN public/ ═══════════════════════════════════
//
// Podría serlo: es pública, no tiene nada que esconder. Pero lleva un <script>
// adentro y la CSP global de Symphomed no admite scripts inline. Servirla desde
// acá permite mandarle su propia CSP con un nonce, sin aflojar la de toda la
// aplicación por una pantalla de marketing.
//
// ═══ EL MISMO SERVIDOR, DOS CARAS ══════════════════════════════════════════
//
//   symphomed.com          → esta página
//   salud.chatgo.ia.bo     → la aplicación, como siempre
//   symphomed.com/app      → la aplicación, para quien ya es cliente
//
// Se decide por el Host del pedido, así el día que el dominio apunte a este
// servidor no hay que desplegar nada ni mover archivos: empieza a funcionar.
// Mientras tanto /inicio la muestra en cualquier dominio, para poder verla.
//
// ═══ AL REVÉS QUE EL REPORTE ═══════════════════════════════════════════════
//
// El reporte financiero va con no-store y noindex porque es privado. Esta
// quiere exactamente lo contrario: que Google la lea y que el navegador la
// guarde. Es la única pantalla de Symphomed que se comparte a propósito.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { log } = require("../config");

const VISTAS = path.join(__dirname, "..", "vistas");

// Los dominios donde la raíz es la página de venta y no la aplicación. Se
// puede ampliar por entorno sin tocar código: el día que haya un dominio
// nuevo, es una variable y un reinicio.
const DOMINIOS = new Set(
  String(process.env.DOMINIOS_LANDING || "symphomed.com,www.symphomed.com")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);

// A dónde manda el enlace "Ingresar". symphomed.com es la cara pública —info
// y contacto— y la plataforma vive en su propio subdominio, así que el enlace
// tiene que SALIR de este dominio.
//
// Sin configurar cae en "/app", que es relativo y por lo tanto anda en
// cualquier dominio. Eso es lo que hace que la página se pueda ver y probar
// entera antes de que exista el subdominio: hoy el enlace lleva a la
// aplicación del mismo servidor, y el día que se defina URL_PLATAFORMA
// empieza a llevar afuera, sin tocar el HTML.
const URL_PLATAFORMA = String(process.env.URL_PLATAFORMA || "/app").replace(/\/+$/, "") || "/app";

let PLANTILLA = "";
try {
  PLANTILLA = fs.readFileSync(path.join(VISTAS, "inicio.html"), "utf8");
} catch (e) {
  log.warn(`[INICIO] No se pudo leer vistas/inicio.html: ${e.message}`);
}

function servir(_req, res) {
  if (!PLANTILLA) return res.status(404).send("No encontrado");
  const nonce = crypto.randomBytes(16).toString("base64");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    // Se sale a WhatsApp por un enlace normal, así que no hace falta abrir
    // connect-src ni form-action: la página no habla con nadie.
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(
    PLANTILLA.replace(/__NONCE__/g, nonce).replace(/__PLATAFORMA__/g, URL_PLATAFORMA)
  );
}

module.exports = (app) => {
  // Siempre disponible, en cualquier dominio: sirve para verla antes de que
  // el DNS apunte, y para enlazarla desde adentro de la aplicación.
  app.get("/inicio", servir);

  // Y en la raíz, SOLO si el pedido llegó por el dominio de la marca. En
  // cualquier otro sigue de largo hacia la aplicación de siempre — por eso
  // esto se registra antes que el app.get("/") de index.js y llama a next().
  app.get("/", (req, res, next) => {
    const host = String(req.hostname || "").toLowerCase();
    if (!DOMINIOS.has(host)) return next();
    servir(req, res);
  });

  log.info(`[INICIO] Página de venta en /inicio y en la raíz de: ${[...DOMINIOS].join(", ")}`);
  log.info(`[INICIO] El enlace "Ingresar" lleva a: ${URL_PLATAFORMA}`);
};
