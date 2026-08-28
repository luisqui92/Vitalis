// Vitalis — Estáticos precomprimidos
//
// El detector facial de Vitalis Face son 13 MB que el navegador se baja la
// primera vez: 9 MB de WebAssembly y 3,6 MB del modelo. En una conexión de
// consultorio eso es medio minuto mirando un spinner, y el médico —con razón—
// cree que el sistema se colgó.
//
// Brotli baja el WebAssembly de 9 MB a 2,2. El modelo (.task) casi no
// comprime porque ya viene empaquetado, y eso está bien: no hay nada que
// hacerle. En total, 13 MB pasan a 5,4.
//
// Se comprime UNA VEZ a disco y se sirve el archivo ya comprimido. Comprimir
// 9 MB en cada pedido costaría más CPU que el ahorro de red, y con un
// consultorio entero pidiendo a la vez sería peor el remedio.
//
// Sin dependencias nuevas: brotli viene en Node desde la v11.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { log } = require("../config");

// Qué vale la pena precomprimir. Las fotos y los PNG no: ya están
// comprimidos y brotli solo les agregaría CPU.
const EXTENSIONES = new Set([".wasm", ".js", ".css", ".task", ".json", ".svg", ".html"]);
const MINIMO = 8 * 1024; // por debajo de esto el ahorro no paga el pedido extra

function comprimible(archivo) {
  return EXTENSIONES.has(path.extname(archivo).toLowerCase());
}

function archivosDe(dir, acc = []) {
  let entradas;
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) archivosDe(completo, acc);
    else if (comprimible(e.name) && !e.name.endsWith(".br")) acc.push(completo);
  }
  return acc;
}

// Genera los .br que falten o que hayan quedado viejos. Devuelve cuántos hizo.
function generar(dir) {
  let hechos = 0, ahorro = 0;
  for (const archivo of archivosDe(dir)) {
    const st = fs.statSync(archivo);
    if (st.size < MINIMO) continue;
    const destino = archivo + ".br";
    // Si el .br es más nuevo que el original, ya está al día.
    try {
      if (fs.statSync(destino).mtimeMs >= st.mtimeMs) continue;
    } catch { /* no existe: hay que hacerlo */ }

    const crudo = fs.readFileSync(archivo);
    // Calidad 9 y no 11: en un wasm de 9 MB, 11 tarda casi un minuto y
    // ahorra un 3% más. No paga.
    const br = zlib.brotliCompressSync(crudo, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: crudo.length,
      },
    });
    // Si comprimido pesa casi lo mismo, no se guarda: un archivo de más que
    // hay que mantener sincronizado a cambio de nada.
    if (br.length > crudo.length * 0.95) continue;
    fs.writeFileSync(destino, br);
    hechos++;
    ahorro += crudo.length - br.length;
  }
  return { hechos, ahorro };
}

// Arranca la generación en segundo plano para no demorar el arranque del
// servidor. Mientras no estén, se sirven los originales: nada se rompe.
function prepararEnSegundoPlano(dirs) {
  setTimeout(() => {
    try {
      let total = 0, ahorro = 0;
      for (const d of dirs) {
        const r = generar(d);
        total += r.hechos; ahorro += r.ahorro;
      }
      if (total) {
        log.info(`[ESTÁTICOS] ${total} archivo(s) precomprimidos · ${(ahorro / 1048576).toFixed(1)} MB menos por descarga`);
      }
    } catch (e) {
      log.warn("[ESTÁTICOS] no se pudieron precomprimir: " + e.message);
    }
  }, 1500).unref?.();
}

const TIPOS = {
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".task": "application/octet-stream",
};

// Middleware: si el navegador acepta brotli y existe el .br, se manda ese.
// Va ANTES de express.static.
function servirComprimidos(raiz, opciones = {}) {
  const inmutables = opciones.inmutables || [];
  return function (req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let ruta;
    try { ruta = decodeURIComponent(req.path); } catch { return next(); }
    // Sin "..": el archivo tiene que quedar dentro de la raíz. Servir
    // estáticos por ruta cruda es la forma clásica de filtrar /etc/passwd.
    const completo = path.join(raiz, ruta);
    if (!completo.startsWith(raiz + path.sep)) return next();

    const ext = path.extname(completo).toLowerCase();
    if (!EXTENSIONES.has(ext)) return next();

    // El modelo y el wasm no cambian nunca: se piden una vez y se guardan
    // un año. Con 5 minutos, cada visita de la mañana volvía a revalidarlos.
    if (inmutables.some(p => ruta.startsWith(p))) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }

    const acepta = String(req.headers["accept-encoding"] || "");
    if (!/\bbr\b/.test(acepta)) return next();

    const br = completo + ".br";
    let st;
    try { st = fs.statSync(br); } catch { return next(); }
    if (!st.isFile()) return next();

    // ═══ Y QUE SEA MÁS NUEVO QUE EL ORIGINAL ═══════════════════════════════
    //
    // Un .br viejo no es un archivo viejo: es CÓDIGO VIEJO servido con cara
    // de actual. Se despliega un arreglo, se reinicia, y todo navegador que
    // acepte brotli —o sea, todos— sigue recibiendo la versión anterior.
    //
    // No es hipotético. generar() compara fechas y regenera bien, pero corre
    // en segundo plano DESPUÉS de que el servidor ya empezó a responder: hay
    // una ventana, justo después de cada reinicio, en la que el .js del disco
    // es nuevo y el .br todavía no. Quien recargue ahí se lleva el código
    // anterior, y con max-age de 5 minutos se lo queda un rato.
    //
    // Costó una tarde de diagnóstico: los arreglos aparecían y desaparecían
    // según el momento en que se recargara, lo que mandó a buscar la causa a
    // cualquier otro lado —el .env, pm2, el orden de carga de los módulos—.
    //
    // Ante la duda se manda el original sin comprimir: se gastan unos KB de
    // más, que es infinitamente mejor que servir una versión que ya no existe.
    let fuente;
    try { fuente = fs.statSync(completo); } catch { return next(); }
    if (st.mtimeMs < fuente.mtimeMs) return next();

    res.setHeader("Content-Encoding", "br");
    res.setHeader("Content-Type", TIPOS[ext] || "application/octet-stream");
    res.setHeader("Content-Length", st.size);
    // Sin esto, un proxy intermedio puede servirle el brotli a un navegador
    // que no lo pidió.
    res.setHeader("Vary", "Accept-Encoding");
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(br).pipe(res);
  };
}

module.exports = { servirComprimidos, prepararEnSegundoPlano, generar };
