// Symphomed Ganadería — Service worker de la página del dueño (/campo/).
//
// ═══ POR QUÉ UNO APARTE ════════════════════════════════════════════════════
//
// El de la app médica (public/sw.js) no cachea nada, y a propósito: mostrar
// datos viejos de un paciente es peor que no mostrar nada. Acá es al revés.
// El dueño está en el corral sin señal, y lo que necesita es que la página
// ABRA para anotar la leche; los datos viejos se muestran con su hora (lo
// hace public/js/campo.js, no este archivo).
//
// Se registra con scope "/campo/", así que no controla ninguna otra página:
// la app médica sigue exactamente como estaba.
//
// Qué guarda: solo la página y sus archivos (HTML, CSS, JS, textos, íconos,
// tipografías). NUNCA las respuestas de /campo/<llave>/…: los datos de la
// finca los guarda campo.js, que sabe decir de cuándo son, y las cargas no
// pueden responderse desde un caché.
const VERSION = "campo-v1";
const PAGINA = "/campo.html";
const ARCHIVOS = [
  PAGINA,
  "/estilos.css",
  "/js/i18n.js",
  "/i18n/es.js",
  "/i18n/pt.js",
  "/js/campo.js",
  "/img/simbolo.webp",
  "/img/simbolo-192.png",
  "/fonts/fraunces-variable.woff2",
  "/fonts/inter-variable.woff2",
];

self.addEventListener("install", (event) => {
  // Si alguno no baja, la instalación falla y se reintenta la próxima vez:
  // mejor eso que un caché a medias que abre la página sin su JavaScript.
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith("campo-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página: primero la red (así una versión nueva llega apenas hay señal),
// y si no hay, la guardada. Cualquier /campo/<llave> es la misma página —
// la llave la lee campo.js de la barra de direcciones—, así que se guarda
// una sola vez.
async function pagina(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copia = res.clone();
      caches.open(VERSION).then((c) => c.put(PAGINA, copia));
    }
    return res;
  } catch {
    const guardada = await caches.match(PAGINA);
    return guardada || Response.error();
  }
}

// Los archivos: el guardado al toque, y de fondo se pide el nuevo para la
// próxima vez. Con señal floja, esperar la red para el CSS dejaría la
// pantalla en blanco justo cuando más apuro hay.
async function archivo(request) {
  const cache = await caches.open(VERSION);
  const guardado = await cache.match(request, { ignoreSearch: true });
  const deRed = fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return guardado || (await deRed) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && /^\/campo\/[A-Za-z0-9_-]{20,}\/?$/.test(url.pathname)) {
    event.respondWith(pagina(req));
    return;
  }
  if (ARCHIVOS.includes(url.pathname) && url.pathname !== PAGINA) {
    event.respondWith(archivo(req));
  }
  // Todo lo demás —los datos y las cargas de /campo/<llave>/…— va directo a
  // la red, sin pasar por acá.
});
