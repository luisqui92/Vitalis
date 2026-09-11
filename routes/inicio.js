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
// ═══ TRES IDIOMAS, TRES URLS ═══════════════════════════════════════════════
//
//   symphomed.com/      → español
//   symphomed.com/pt    → portugués
//   symphomed.com/en    → inglés
//
// Y NO la misma URL devolviendo cosas distintas según quién la pida. Eso
// último es lo que primero se le ocurre a cualquiera y es lo que hay que no
// hacer: una URL que cambia de idioma según el visitante no se puede
// compartir por WhatsApp —el que la recibe puede verla en otro idioma—, no se
// puede cachear igual para todos, y un buscador indexa una sola de las tres
// versiones, la que le tocó al robot.
//
// ═══ EL IDIOMA SE DETECTA POR EL IDIOMA, NO POR EL PAÍS ════════════════════
//
// La tentación es mirar de qué país viene la IP. Está mal por los dos lados:
// en Brasil hay médicos que estudiaron en Bolivia y prefieren el español, y
// un médico brasileño de vacaciones en Miami no quiere de golpe la página en
// inglés. Lo que el navegador MANDA en cada pedido —Accept-Language— es la
// preferencia que la persona configuró, que es la pregunta que queremos
// responder. Y no cuesta una consulta a una base de geolocalización.
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

const IDIOMAS = ["es", "pt", "en"];
const RUTAS = { es: "/", pt: "/pt", en: "/en" };
// El nombre de la galleta que recuerda la elección. Solo guarda "es", "pt" o
// "en": no identifica a nadie, no hace falta consentimiento y no sirve para
// seguir a nadie por ningún lado.
const GALLETA = "sym_idioma";
const UN_ANIO = 365 * 24 * 60 * 60;

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

const PLANTILLAS = {};
for (const idioma of IDIOMAS) {
  try {
    PLANTILLAS[idioma] = fs.readFileSync(path.join(VISTAS, `inicio.${idioma}.html`), "utf8");
  } catch (e) {
    log.warn(`[INICIO] No se pudo leer vistas/inicio.${idioma}.html: ${e.message}`);
  }
}

// La galleta se lee a mano y no con cookie-parser a propósito: este módulo se
// monta solo —también en las pruebas— y no tiene por qué depender de que otro
// middleware se haya registrado antes. El patrón acota los valores posibles a
// tres, así que nada de lo que mande el visitante llega más lejos que esto.
function recordado(req) {
  const m = String(req.headers.cookie || "").match(/(?:^|;\s*)sym_idioma=(es|pt|en)(?:;|$)/);
  return m ? m[1] : null;
}

// Lo que el navegador declara en Accept-Language. Express ya hace el trabajo
// fino: ordena por q= y hace coincidir "pt-BR" con "pt". Sin cabecera —los
// robots de los buscadores no la mandan— devuelve el primero de la lista, que
// es el español, y por lo tanto no se redirige a nadie sin motivo.
function preferido(req) {
  const elegido = req.acceptsLanguages(...IDIOMAS);
  return IDIOMAS.includes(elegido) ? elegido : "es";
}

function servir(idioma) {
  return (_req, res) => {
    const plantilla = PLANTILLAS[idioma];
    if (!plantilla) return res.status(404).send("No encontrado");
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
    // Recordar la elección es lo que hace que el selector de idioma sirva de
    // algo: sin esto, un brasileño que toca "ES" vuelve a la raíz, la raíz lo
    // vuelve a mandar a /pt por su Accept-Language, y queda en un rebote del
    // que no puede salir.
    res.setHeader("Set-Cookie",
      `${GALLETA}=${idioma}; Path=/; Max-Age=${UN_ANIO}; SameSite=Lax`);
    // "private" y no "public": la respuesta trae una galleta, así que no la
    // puede guardar un caché compartido para dárselo al siguiente. El
    // navegador del visitante sí la guarda, que es lo que importa acá.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type("html").send(
      plantilla.replace(/__NONCE__/g, nonce).replace(/__PLATAFORMA__/g, URL_PLATAFORMA)
    );
  };
}

module.exports = (app) => {
  // Siempre disponible, en cualquier dominio: sirve para verla antes de que
  // el DNS apunte, y para enlazarla desde adentro de la aplicación. Acá NO se
  // redirige nunca — es la vista previa, y una vista previa que se te escapa
  // a otra URL no sirve para revisar nada.
  app.get("/inicio", servir("es"));
  app.get("/inicio/pt", servir("pt"));
  app.get("/inicio/en", servir("en"));

  // Y en la raíz, SOLO si el pedido llegó por el dominio de la marca. En
  // cualquier otro sigue de largo hacia la aplicación de siempre — por eso
  // esto se registra antes que el app.get("/") de index.js y llama a next().
  app.get("/", (req, res, next) => {
    if (!DOMINIOS.has(String(req.hostname || "").toLowerCase())) return next();

    // Una sola redirección, y solo en la primera visita. Si ya eligió —o ya
    // estuvo acá— se respeta lo que eligió, aunque su navegador diga otra
    // cosa. Un visitante que cambió a mano no quiere que le vuelvan a mover
    // la página en cada visita.
    if (!recordado(req)) {
      const idioma = preferido(req);
      if (idioma !== "es") {
        // 302 y no 301: esto depende de QUIÉN pide, no de la URL. Un 301 se
        // guarda en el navegador para siempre y dejaría a esa persona sin
        // poder volver nunca más a la versión en español, sin forma de
        // deshacerlo desde el servidor.
        res.setHeader("Vary", "Accept-Language, Cookie");
        res.setHeader("Cache-Control", "no-store");
        return res.redirect(302, RUTAS[idioma]);
      }
    }
    res.setHeader("Vary", "Accept-Language, Cookie");
    servir("es")(req, res);
  });

  // Las otras dos versiones viven solo en el dominio de la marca, igual que
  // la raíz. En el dominio viejo siguen de largo: ahí "/pt" no es la página
  // en portugués, es una ruta que la aplicación no tiene.
  for (const idioma of ["pt", "en"]) {
    app.get(RUTAS[idioma], (req, res, next) => {
      if (!DOMINIOS.has(String(req.hostname || "").toLowerCase())) return next();
      servir(idioma)(req, res);
    });
  }

  const listas = IDIOMAS.filter(i => PLANTILLAS[i]);
  log.info(`[INICIO] Página de venta en ${listas.map(i => RUTAS[i]).join(", ")} de: ${[...DOMINIOS].join(", ")}`);
  log.info(`[INICIO] Vista previa en /inicio, /inicio/pt, /inicio/en (cualquier dominio)`);
  log.info(`[INICIO] El enlace "Ingresar" lleva a: ${URL_PLATAFORMA}`);
  if (listas.length !== IDIOMAS.length) {
    log.warn(`[INICIO] FALTAN idiomas: ${IDIOMAS.filter(i => !PLANTILLAS[i]).join(", ")} — corré scripts/diseno/construir_inicio.js`);
  }
};
