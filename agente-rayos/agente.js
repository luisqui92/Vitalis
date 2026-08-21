// ═══════════════════════════════════════════════════════════════════════════
// Agente de Vitalis Rayos — corre en la PC del consultorio
// ═══════════════════════════════════════════════════════════════════════════
// Vigila la carpeta donde el software del sensor (Ai-Dental, DBSWIN, VixWin,
// CS Imaging...) deja las radiografías, y sube cada imagen nueva a Vitalis,
// que la guarda en la ficha del paciente que el médico dejó esperando.
//
// Sin dependencias: solo módulos de Node. En una PC de consultorio no se
// puede contar con npm, ni con permisos de administrador, ni con que alguien
// sepa arreglarlo si se rompe — así que esto tiene que andar copiando una
// carpeta y haciendo doble clic.
//
// Va SIEMPRE hacia afuera (HTTPS saliente). No abre ningún puerto, no
// necesita IP fija, y no toca el router del consultorio.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────
const RUTA_CONFIG = path.join(__dirname, "config.json");
if (!fs.existsSync(RUTA_CONFIG)) {
  console.error("\n  ✗ Falta el archivo config.json.");
  console.error("    Copiá config.ejemplo.json a config.json y completalo.\n");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(RUTA_CONFIG, "utf8"));

for (const campo of ["servidor", "token", "carpeta"]) {
  if (!cfg[campo]) {
    console.error(`\n  ✗ Falta "${campo}" en config.json\n`);
    process.exit(1);
  }
}
if (!fs.existsSync(cfg.carpeta)) {
  console.error(`\n  ✗ La carpeta que pusiste en config.json no existe:\n    ${cfg.carpeta}\n`);
  process.exit(1);
}

const SEGUNDOS_REVISION = Number(cfg.segundosRevision) || 3;
// Cuánto insistir con una imagen que llegó sin que nadie la esté esperando.
// El médico a veces dispara primero y abre la ficha después.
const MINUTOS_REINTENTO = Number(cfg.minutosReintento) || 20;

const MIME_POR_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
};
const EXTENSIONES = Object.keys(MIME_POR_EXT);

// ─── MEMORIA ENTRE ARRANQUES ──────────────────────────────────────────────
// Guarda qué archivos ya vio, para no volver a subir todo el historial cada
// vez que alguien reinicia la PC. Se guarda por hash del contenido y no por
// nombre: si el software renombra o mueve la imagen, no se duplica.
const RUTA_ESTADO = path.join(__dirname, "estado.json");
let estado = { hashes: {}, primeraVez: true };
try {
  if (fs.existsSync(RUTA_ESTADO)) estado = JSON.parse(fs.readFileSync(RUTA_ESTADO, "utf8"));
} catch { /* estado corrupto: arrancamos de cero, no es grave */ }

let guardadoPendiente = false;
function guardarEstado() {
  // Agrupa las escrituras: si entran cinco imágenes seguidas no escribimos
  // el archivo cinco veces.
  if (guardadoPendiente) return;
  guardadoPendiente = true;
  setTimeout(() => {
    guardadoPendiente = false;
    // Poda: hashes de más de 60 días ya no le sirven a nadie y el archivo
    // no puede crecer para siempre.
    const corte = Date.now() - 60 * 24 * 3600 * 1000;
    for (const [h, ts] of Object.entries(estado.hashes)) {
      if (ts < corte) delete estado.hashes[h];
    }
    try {
      fs.writeFileSync(RUTA_ESTADO, JSON.stringify(estado));
    } catch (e) {
      log("!", "no pude guardar estado.json: " + e.message);
    }
  }, 1000);
}

// ─── LOG ──────────────────────────────────────────────────────────────────
function log(icono, texto) {
  const hora = new Date().toLocaleTimeString("es-BO", { hour12: false });
  console.log(`  ${hora}  ${icono}  ${texto}`);
}

// ─── HTTP ─────────────────────────────────────────────────────────────────
function pedir(metodo, ruta, { cuerpo = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(ruta, cfg.servidor);
    } catch {
      return reject(new Error("La dirección del servidor en config.json no es válida: " + cfg.servidor));
    }
    const cliente = url.protocol === "https:" ? https : http;
    const req = cliente.request(url, {
      method: metodo,
      headers: { "X-Equipo-Token": cfg.token, ...headers },
      timeout: 60 * 1000,
    }, (res) => {
      const trozos = [];
      res.on("data", t => trozos.push(t));
      res.on("end", () => {
        const texto = Buffer.concat(trozos).toString("utf8");
        let json = null;
        try { json = JSON.parse(texto); } catch { /* puede venir HTML de un proxy */ }
        resolve({ status: res.statusCode, json, texto });
      });
    });
    req.on("timeout", () => req.destroy(new Error("el servidor no respondió a tiempo")));
    req.on("error", reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

// ─── RECORRER LA CARPETA ──────────────────────────────────────────────────
function listarImagenes(dir, profundidad = 0) {
  // Tope de profundidad: estas carpetas suelen tener un nivel por paciente y
  // otro por fecha; más de 6 es que alguien apuntó a C:\ por error.
  if (profundidad > 6) return [];
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // carpeta bloqueada por el software del sensor: la vemos en la próxima vuelta
  }
  const salida = [];
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (cfg.incluirSubcarpetas === false) continue;
      salida.push(...listarImagenes(completo, profundidad + 1));
    } else if (EXTENSIONES.includes(path.extname(e.name).toLowerCase())) {
      salida.push(completo);
    }
  }
  return salida;
}

// El software del sensor escribe la imagen de a poco. Si la subimos apenas
// aparece el archivo, sube una radiografía cortada por la mitad — y como
// cada trozo tiene un hash distinto, ni siquiera la atajaría el control de
// duplicados: quedarían tres estudios, todos incompletos.
//
// La espera se mide en TIEMPO, no en "dos revisiones seguidas": fs.watch
// dispara varios avisos por cada escritura, así que dos revisiones pueden
// caer dentro del mismo pestañeo y ver el mismo tamaño sin que el archivo
// esté terminado.
const MS_ESTABLE = Number(cfg.msEstable) || 3000;
const tamanosPrevios = new Map(); // archivo → { tam, desde }

function estaCompleto(archivo) {
  let tam;
  try {
    tam = fs.statSync(archivo).size;
  } catch {
    return false;
  }
  if (tam === 0) return false;
  const previo = tamanosPrevios.get(archivo);
  if (!previo || previo.tam !== tam) {
    tamanosPrevios.set(archivo, { tam, desde: Date.now() });
    return false;
  }
  return Date.now() - previo.desde >= MS_ESTABLE;
}

// ─── DIAGNÓSTICO DE LA CARPETA ────────────────────────────────────────────
// Muchos sensores dentales guardan en .bmp o .tif, que Vitalis no acepta.
// Sin este aviso, una carpeta llena de .bmp se ve EXACTAMENTE igual que una
// carpeta vacía: el agente dice "conectado", no sube nada, y no hay forma de
// saber por qué. Es el primer lugar donde alguien va a perder una mañana.
function revisarFormatosDeLaCarpeta() {
  const otros = new Map(); // extensión → cuántos
  let soportados = 0;
  (function recorrer(dir, prof) {
    if (prof > 6) return;
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      if (e.isDirectory()) {
        if (cfg.incluirSubcarpetas !== false) recorrer(path.join(dir, e.name), prof + 1);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!ext) continue;
      if (EXTENSIONES.includes(ext)) soportados++;
      else otros.set(ext, (otros.get(ext) || 0) + 1);
    }
  })(cfg.carpeta, 0);

  if (soportados === 0 && otros.size === 0) {
    log("!", "la carpeta está vacía — ¿es la correcta? Tomá una radiografía y fijate dónde cae el archivo");
    return;
  }
  if (soportados === 0 && otros.size > 0) {
    const lista = [...otros].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => `${n} ${e}`).join(", ");
    log("✗", `en esa carpeta hay ${lista}, y Vitalis solo acepta ${EXTENSIONES.join(" ")}`);
    log("→", "configurá el software del sensor para que exporte JPG o PNG, o avisanos y lo resolvemos del lado de Vitalis");
    return;
  }
  if (otros.size > 0) {
    const lista = [...otros].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => `${n} ${e}`).join(", ");
    log("!", `aviso: además hay ${lista} que no se van a subir (solo ${EXTENSIONES.join(" ")})`);
  }
}

// ─── COLA DE ESPERA ───────────────────────────────────────────────────────
// Imágenes que llegaron pero todavía no tienen paciente esperando.
const enEspera = new Map(); // hash → { archivo, buffer, mime, desde, proximoIntento }

async function subir(archivo, buffer, mime, hash) {
  const res = await pedir("POST", "/equipo/rayos/estudio", {
    cuerpo: buffer,
    headers: {
      "Content-Type": mime,
      "Content-Length": buffer.length,
      "X-Archivo-Nombre": path.basename(archivo).replace(/[^\x20-\x7E]/g, ""),
    },
  });

  if (res.status === 201) {
    estado.hashes[hash] = Date.now();
    enEspera.delete(hash);
    guardarEstado();
    log("✓", `subida a ${res.json.paciente} — ${path.basename(archivo)} (${Math.round(buffer.length / 1024)} KB)`);
    return true;
  }

  if (res.status === 409 && res.json?.error === "sin_captura_activa") {
    if (!enEspera.has(hash)) {
      enEspera.set(hash, { archivo, buffer, mime, desde: Date.now(), proximoIntento: 0 });
      log("⏳", `${path.basename(archivo)} en espera — abrí la ficha del paciente y tocá "Capturar radiografía"`);
    }
    return false;
  }

  // El servidor nos frenó por venir muy seguido: esperar y no insistir en
  // la próxima vuelta, o nos quedamos frenados para siempre.
  if (res.status === 429) {
    const item = enEspera.get(hash);
    if (item) item.proximoIntento = Date.now() + (Number(res.json?.retryAfter) || 60) * 1000;
    log("!", `el servidor pidió esperar (${res.json?.retryAfter || 60} s) antes de seguir subiendo`);
    return false;
  }

  if (res.status === 401) {
    log("✗", "el token del equipo no sirve — regeneralo en Vitalis y actualizá config.json");
    return false;
  }

  log("✗", `el servidor rechazó ${path.basename(archivo)}: ${res.json?.mensaje || res.json?.error || res.status}`);
  // No lo marcamos como subido: si fue algo pasajero, entra en la próxima.
  return false;
}

// Solo se llama cuando el servidor ya nos dijo que HAY alguien esperando —
// si no, cada vuelta serían N subidas condenadas a fallar, que además
// consumen el límite de peticiones y terminan frenando a las buenas.
async function reintentarEspera() {
  for (const [hash, item] of [...enEspera]) {
    if (Date.now() - item.desde > MINUTOS_REINTENTO * 60 * 1000) {
      enEspera.delete(hash);
      log("✗", `${path.basename(item.archivo)} se dejó de intentar (${MINUTOS_REINTENTO} min sin que nadie la esperara) — subila a mano desde Vitalis`);
      continue;
    }
    if (Date.now() < item.proximoIntento) continue;
    await subir(item.archivo, item.buffer, item.mime, hash);
  }
}

// Mientras no haya nadie esperando no reintentamos nada, pero sí hay que
// soltar las que ya se pasaron de tiempo: si no, la ventana se llena de
// imágenes viejas en memoria y el operador nunca se entera de que esas dos
// placas quedaron sin subir.
function podarEspera() {
  for (const [hash, item] of [...enEspera]) {
    if (Date.now() - item.desde > MINUTOS_REINTENTO * 60 * 1000) {
      enEspera.delete(hash);
      log("✗", `${path.basename(item.archivo)} se dejó de intentar (${MINUTOS_REINTENTO} min sin que nadie la esperara) — subila a mano desde Vitalis`);
    }
  }
}

// Guarda una imagen para más tarde sin gastar una subida condenada a
// fallar: ya sabemos por el saludo que no hay nadie esperando.
function dejarEnEspera(archivo, buffer, mime, hash) {
  if (enEspera.has(hash)) return;
  enEspera.set(hash, { archivo, buffer, mime, desde: Date.now(), proximoIntento: 0 });
  log("⏳", `${path.basename(archivo)} en espera — abrí la ficha del paciente y tocá "Capturar radiografía"`);
}

// ─── LÍNEA DE BASE DEL PRIMER ARRANQUE ────────────────────────────────────
// Todo lo que ya estaba en la carpeta el día que se instala el agente es
// historial viejo y NO se sube: si no, el primer arranque le mandaría a
// Vitalis años de radiografías de otros pacientes, todas a la ficha del
// que justo esté esperando. Se hace de una sola vez y aparte de la vuelta
// normal, porque ahí ningún archivo cuenta todavía como "estable" (no hay
// con qué comparar el tamaño) y la línea de base quedaría vacía.
function marcarHistorialInicial() {
  const archivos = listarImagenes(cfg.carpeta);
  let marcadas = 0;
  for (const archivo of archivos) {
    try {
      const buffer = fs.readFileSync(archivo);
      estado.hashes[crypto.createHash("sha256").update(buffer).digest("hex")] = Date.now();
      // Sembramos también el tamaño (con "desde" en el pasado, o sea ya
      // estable): son archivos viejos, no hay nada que esperar.
      tamanosPrevios.set(archivo, { tam: buffer.length, desde: 0 });
      marcadas++;
    } catch { /* archivo bloqueado: lo tomará como nuevo, es el caso raro y benigno */ }
  }
  estado.primeraVez = false;
  guardarEstado();
  log("✓", `primer arranque: ${marcadas} ${marcadas === 1 ? "imagen ya existente marcada" : "imágenes ya existentes marcadas"} como historial (no se suben)`);
  log("→", "de acá en adelante, cada radiografía nueva se sube sola");
}

// ─── VUELTA PRINCIPAL ─────────────────────────────────────────────────────
let ultimoEstadoConexion = null;
let ultimoPacienteMostrado = null;
let revisando = false;

async function revisar() {
  if (revisando) return; // una vuelta lenta no debe pisar a la siguiente
  revisando = true;
  try {
    const res = await pedir("GET", "/equipo/rayos/estado");

    if (res.status === 401) {
      if (ultimoEstadoConexion !== "401") {
        log("✗", "token inválido — regeneralo en Vitalis (Ajustes → Equipo de rayos) y actualizá config.json");
        ultimoEstadoConexion = "401";
      }
      return;
    }
    if (res.status !== 200) {
      if (ultimoEstadoConexion !== "error") {
        log("!", `el servidor respondió ${res.status} — reintentando`);
        ultimoEstadoConexion = "error";
      }
      return;
    }
    if (ultimoEstadoConexion !== "ok") {
      log("✓", "conectado a Vitalis");
      ultimoEstadoConexion = "ok";
    }

    // Avisar en pantalla a quién le va a tocar la próxima placa, para que
    // el operador pueda confirmarlo de un vistazo antes de disparar.
    const pacienteAhora = res.json.capturaActiva ? res.json.paciente : null;
    if (pacienteAhora !== ultimoPacienteMostrado) {
      ultimoPacienteMostrado = pacienteAhora;
      if (pacienteAhora) log("👤", `esperando radiografía de: ${pacienteAhora}`);
    }

    if (res.json.capturaActiva) await reintentarEspera();
    else podarEspera();

    const archivos = listarImagenes(cfg.carpeta);

    // Soltar el seguimiento de los que ya no están (se archivaron, se
    // movieron, se borraron). Esta PC va a estar años prendida sin que
    // nadie la reinicie: el mapa no puede crecer para siempre.
    if (tamanosPrevios.size > archivos.length) {
      const presentes = new Set(archivos);
      for (const ruta of tamanosPrevios.keys()) {
        if (!presentes.has(ruta)) tamanosPrevios.delete(ruta);
      }
    }

    for (const archivo of archivos) {
      if (!estaCompleto(archivo)) continue;

      let buffer;
      try {
        buffer = fs.readFileSync(archivo);
      } catch {
        continue; // el software lo tiene abierto: lo agarramos en la próxima
      }
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (estado.hashes[hash]) continue;
      if (enEspera.has(hash)) continue;

      const mime = MIME_POR_EXT[path.extname(archivo).toLowerCase()];
      if (res.json.capturaActiva) await subir(archivo, buffer, mime, hash);
      else dejarEnEspera(archivo, buffer, mime, hash);
    }
  } catch (e) {
    if (ultimoEstadoConexion !== "sinred") {
      log("!", "sin conexión con Vitalis: " + e.message);
      ultimoEstadoConexion = "sinred";
    }
  } finally {
    revisando = false;
  }
}

// ─── ARRANQUE ─────────────────────────────────────────────────────────────
console.log("");
console.log("  ╔══════════════════════════════════════════════╗");
console.log("  ║   Vitalis Rayos — puente del consultorio      ║");
console.log("  ╚══════════════════════════════════════════════╝");
console.log("");
log("→", `carpeta vigilada: ${cfg.carpeta}`);
log("→", `servidor: ${cfg.servidor}`);
console.log("");
console.log("  Dejá esta ventana abierta. Para apagarlo: cerrala o Ctrl+C.");
console.log("");

revisarFormatosDeLaCarpeta();
if (estado.primeraVez) marcarHistorialInicial();

revisar();
setInterval(revisar, SEGUNDOS_REVISION * 1000);

// Si el software del sensor guarda una imagen justo después de una
// revisión, esto la agarra en el acto en vez de esperar el intervalo.
// fs.watch no es confiable en todas las máquinas (por eso igual revisamos
// por reloj), pero cuando anda hace que la radiografía aparezca en Vitalis
// casi al instante.
try {
  fs.watch(cfg.carpeta, { recursive: cfg.incluirSubcarpetas !== false }, () => {
    setTimeout(revisar, 500);
  });
} catch {
  log("!", "aviso: esta PC no soporta la detección instantánea — igual revisa cada " + SEGUNDOS_REVISION + " s");
}

process.on("SIGINT", () => {
  console.log("");
  log("→", "apagando el puente. Las radiografías nuevas dejan de subirse solas.");
  process.exit(0);
});
