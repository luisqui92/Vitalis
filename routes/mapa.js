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

// ═══ DE DÓNDE SALEN LOS MOSAICOS, Y POR QUÉ NO DE OPENSTREETMAP ═══════════
//
// Arrancó apuntando a tile.openstreetmap.org y en producción devolvió 403:
//
//   "Access blocked — App is not following the tile usage policy of
//    OpenStreetMap's volunteer-run servers"
//
// No fue un error de configuración: esos servidores los pagan voluntarios con
// donaciones, y su política prohíbe que un producto los use de CDN. Que
// funcionara en la prueba y en el navegador de uno no significaba permiso —
// significaba que todavía no habíamos molestado lo suficiente como para que
// nos vieran.
//
// Ahora salen de los mapas base de CARTO. Sirven las tejas sin registrarse,
// pero LES ESTAMPAN "API KEY REQUIRED" encima hasta que se pone una clave —
// no es un error, es cómo cobran. El mapa se ve y se usa; se ve mendigado.
//
// ═══ NO HAY MAPA GRATIS SIN CLAVE, Y CONVIENE SABERLO ══════════════════════
//
// Esto ya se probó dos veces por el camino equivocado. OpenStreetMap bloquea
// el uso en producción porque sus servidores son de voluntarios. CARTO marca
// las tejas. El resto —MapTiler, Stadia— pide clave de entrada y al menos
// es honesto desde el principio.
//
// Con MAPA_MOSAICOS puesto en el .env, esto se arregla sin desplegar:
//
//   MAPA_MOSAICOS=https://api.maptiler.com/maps/dark-matter/{z}/{x}/{y}.png?key=TU_CLAVE
//   MAPA_MOSAICOS_ORIGEN=https://api.maptiler.com
//
// ⚠️ Esa clave viaja en el HTML, a la vista de cualquiera: es inevitable, el
// navegador tiene que pedir las tejas. Por eso hay que restringirla POR
// DOMINIO en el panel del proveedor. Sin eso, cualquiera la copia y te gasta
// la cuota — y el día que se agote, el mapa se apaga para tus médicos.
//
// Y el destino final, cuando el mapa sea parte del producto y no una
// demostración: mosaicos propios. Bolivia entera entra en un archivo, no
// depende de nadie, no tiene cuota y no se puede bloquear.
const MOSAICOS = String(process.env.MAPA_MOSAICOS ||
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png");
const MOSAICOS_ORIGEN = String(process.env.MAPA_MOSAICOS_ORIGEN ||
  "https://*.basemaps.cartocdn.com");

// ═══ EL TAMAÑO DE LA TEJA, QUE NO SE VE PERO SE NOTA ══════════════════════
//
// Leaflet asume tejas de 256px. Los proveedores modernos —MapTiler entre
// ellos— sirven de 512. Si no se le dice, el mapa dibuja igual: no hay error,
// no falta nada, simplemente TODO sale con un nivel de zoom corrido y
// borroso, y quien lo mire va a pensar que el mapa es feo y no que está mal
// configurado.
//
// Con 512 hay que compensar el zoom en -1, y las dos cosas van JUNTAS: poner
// una sin la otra es peor que no poner ninguna.
const TAM_TEJA = String(Number(process.env.MAPA_MOSAICOS_TAM) || 256);

// ═══ LA ATRIBUCIÓN SE DEDUCE DEL PROVEEDOR ════════════════════════════════
//
// Y no se escribe a mano a propósito. Es la CONDICIÓN DE USO de todos estos
// mapas: sin ella, gratis se convierte en bloqueado — que es exactamente lo
// que ya pasó con OpenStreetMap.
//
// Si estuviera escrita fija, cambiar de proveedor por el .env dejaría el
// crédito del anterior puesto: el mapa diría "CARTO" mientras las tejas las
// sirve MapTiler. Eso no es un detalle estético, es incumplir la licencia de
// los dos a la vez.
//
// OpenStreetMap va SIEMPRE: los tres proveedores dibujan sobre sus datos.
const CREDITOS = [
  [/cartocdn\.com/, '&copy; <a href="https://carto.com/attributions">CARTO</a>'],
  [/maptiler\.com/, '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>'],
  [/stadiamaps\.com/, '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>'],
];
function creditoDe(url) {
  const base = '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const prov = CREDITOS.find(([re]) => re.test(url));
  return prov ? `${base} \u00b7 ${prov[1]}` : base;
}
const CREDITO = creditoDe(MOSAICOS);

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
        .replace(/__TAM_TEJA__/g, TAM_TEJA)
        .replace(/__CREDITO__/g, CREDITO)
    );
  });

  log.info(`[MAPA] Mapa de servicios en /mapa — centro ${CENTRO}, zoom ${ZOOM}`);
  // Que lo diga al arrancar y no cuando alguien mire la pantalla. Un mapa con
  // "API KEY REQUIRED" estampado sobre las calles se ve como un producto
  // pirateado, y es de las cosas que uno deja de ver a la semana de
  // acostumbrarse — mientras cada médico que entra lo ve por primera vez.
  if (!/[?&]key=|[?&]api_key=/.test(MOSAICOS)) {
    log.warn("[MAPA] ⚠️  Los mosaicos van SIN CLAVE: se sirven con una marca de agua encima " +
      "(«API KEY REQUIRED»). Poné MAPA_MOSAICOS con tu clave en el .env — ver el comentario " +
      "de routes/mapa.js — y acordate de restringirla por dominio en el panel del proveedor.");
  }
};
