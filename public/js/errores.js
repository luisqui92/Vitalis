// Symphomed — Avisar al servidor cuando algo falla en esta pantalla.
//
// Antes, un error en el celular de un médico lo veía solo él («Erro ao
// carregar a consulta») y nos enterábamos por una foto, sin saber qué había
// sido. Ahora cada error de JavaScript se manda al servidor
// (routes/erroresCliente.js) con el mensaje técnico, el archivo, la línea y
// la pantalla. NUNCA datos de pacientes, y el servidor igual lo limpia.
//
// Va primero de todo en index.html, para agarrar también los errores al
// cargar los demás archivos.

// Que un error en loop no mande mil avisos.
const ERRORES_MAX_POR_CARGA = 15;
const ERRORES_REPETIR_CADA_MS = 60000;
let erroresMandados = 0;
const erroresVistos = new Map();

// Lo que no es un error nuestro: cortes de red (de eso se encarga cada
// pantalla), extensiones del navegador, avisos internos del navegador.
function esRuido(mensaje, pila) {
  return /Failed to fetch|NetworkError|Load failed|network error|ResizeObserver loop|^Script error\.?$|AbortError/i.test(mensaje || "")
    || /(chrome|moz|safari)-extension:\/\//.test(pila || "");
}

function reportarError(error, contexto) {
  try {
    // Los rechazos de api() son respuestas del servidor (404, 403…), no
    // errores de la pantalla.
    if (error && typeof error === "object" && "status" in error && !(error instanceof Error)) return;
    const mensaje = String((error && (error.message || error.error)) || error || "").slice(0, 300);
    const pila = String((error && error.stack) || "").slice(0, 1500);
    if (!mensaje || esRuido(mensaje, pila)) return;
    const clave = mensaje + "|" + pila.slice(0, 200);
    const ahora = Date.now();
    if (erroresVistos.has(clave) && ahora - erroresVistos.get(clave) < ERRORES_REPETIR_CADA_MS) return;
    if (erroresMandados >= ERRORES_MAX_POR_CARGA) return;
    erroresVistos.set(clave, ahora);
    erroresMandados++;
    const token = typeof TOKEN !== "undefined" ? TOKEN : null;
    fetch("/errores-cliente", {
      method: "POST",
      keepalive: true,   // que llegue aunque la página se esté cerrando
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify({
        mensaje, pila, contexto: contexto || "",
        pantalla: location.pathname,
        idioma: typeof MEDICO_IDIOMA !== "undefined" ? MEDICO_IDIOMA : "",
        navegador: (navigator.userAgent || "").slice(0, 120),
      }),
    }).catch(() => { /* si no llega, no hay nada más que hacer */ });
  } catch { /* avisar un error nunca puede causar otro */ }
}

window.addEventListener("error", (ev) => {
  // Un error dentro de una imagen o un script de otro sitio llega sin datos.
  if (!ev.error && !ev.message) return;
  reportarError(ev.error || { message: ev.message, stack: `${ev.filename || ""}:${ev.lineno || 0}:${ev.colno || 0}` }, "global");
});
window.addEventListener("unhandledrejection", (ev) => {
  reportarError(ev.reason, "promesa");
});
