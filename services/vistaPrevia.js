// Symphomed — La vista previa en vivo pasa por el servidor.
//
// ═══ POR QUÉ ═══════════════════════════════════════════════════════════════
//
// Mientras se graba, el texto aparece a medida que se habla: el audio va a
// AssemblyAI en tiempo real. AssemblyAI cobra ese servicio por el tiempo que
// la conexión queda abierta, se hable o no (US$ 0,60 la hora con el modo
// médico, octubre de 2026).
//
// Antes el navegador se conectaba directo, con un permiso que le daba el
// servidor, y desde acá no se veía cuánto duraba cada conexión: con un
// programa propio, una cuenta de estudiante podía abrir conexiones y dejarlas
// abiertas sin que sus horas del mes se enteraran (segunda revisión de QA
// del 9 de octubre de 2026, E06).
//
// Ahora el navegador se conecta a Symphomed (RUTA) y Symphomed a AssemblyAI,
// con la clave, que nunca sale del servidor. Así se mide cada segundo que se
// paga, y se corta:
//   · cuando un módulo lo dice (el de estudiantes, al terminarse las horas
//     del mes): el punto «vistaPrevia.durante»;
//   · si la sesión de la cuenta deja de valer (services/auth.js);
//   · después de INACTIVO_MS sin recibir audio: una pestaña olvidada no paga;
//   · a las MAX_SESION_MS seguidas (AssemblyAI no acepta más de 3 horas);
//   · a las HORAS_DIA horas en las últimas 24, por cuenta: una cuenta robada
//     no puede gastar sin fin;
//   · con más de SIMULTANEAS a la vez por cuenta: la nueva cierra la más vieja.
//
// La grabación no depende de nada de esto: si la vista previa se corta, se
// sigue grabando y la nota sale de la transcripción completa.
//
// ═══ CÓMO ══════════════════════════════════════════════════════════════════
//
//   1. GET /medico/transcripcion-token (routes/consultaMedica.js) da un pase:
//      vale para una sola conexión, durante PASE_MS. Guarda con qué idioma y
//      qué vocabulario conectar, sacados de la cuenta.
//   2. El navegador abre RUTA?pase=… y manda el audio (PCM de 16 bits a
//      16 kHz), como antes se lo mandaba a AssemblyAI.
//   3. Acá se anota la vista previa (db/models.js → VistaPrevia), se abre la
//      conexión con AssemblyAI y se pasa todo de un lado al otro. Del
//      navegador solo se acepta audio, Terminate y ForceEndpoint: lo demás
//      cambiaría la configuración que eligió el servidor.
//
// nginx tiene que dejar pasar el WebSocket en RUTA, como en /ws y /ws-tele:
// las tres empiezan con /ws a propósito, para que les toque la misma regla.
// La conexión nunca queda callada (llega audio cada 100 ms y el servidor
// manda un ping cada CHEQUEO_MS), así que nginx no la corta por inactiva.
//
// Un solo proceso (pm2 con una instancia): los pases y las conexiones
// abiertas viven en memoria. Un reinicio corta las vistas previas abiertas
// (las grabaciones siguen) y los pases sin usar dejan de valer.
const crypto = require("crypto");
const WebSocket = require("ws");
const { CONFIG, log } = require("../config");
const { Medico, VistaPrevia } = require("../db/models");
const { registrarWs } = require("./wsRuteo");
const { sesionVigente } = require("./auth");
const extensiones = require("./extensiones");
const { keytermsPara, idiomaSoportado, IDIOMAS_CON_MEDICAL_MODE } = require("./assemblyai");
const { medicamentosDelMedico } = require("./vocabularioMedico");

const RUTA = "/ws-vista-previa";

// Las pruebas los achican; en producción no se tocan.
const AJUSTES = {
  PASE_MS: 30 * 1000,
  INACTIVO_MS: 60 * 1000,
  MAX_SESION_MS: 3 * 3600 * 1000,
  // Un día largo de consultorio son 8 horas grabando.
  HORAS_DIA: 10,
  SIMULTANEAS: 2,
  // Cada cuánto se guarda el tiempo y se revisa con la base.
  CHEQUEO_MS: 30 * 1000,
  // Cada cuánto se miran los topes que no necesitan la base.
  TIC_MS: 5 * 1000,
  // Cuánto se espera a que AssemblyAI cierre después de pedírselo.
  CIERRE_MS: 5 * 1000,
  // El audio que llega mientras se abre la conexión con AssemblyAI: unos
  // 10 s, lo mismo que se le da para abrirla.
  EN_ESPERA: 100,
  // Al subir una grabación, su vista previa es la última de la cuenta que
  // empezó en este lapso (el tope de una vista previa, y un margen).
  VENTANA_MS: 4 * 3600 * 1000,
};

// Lo que AssemblyAI tiene que hacer con el audio de este médico. Mismo
// criterio que la transcripción final (services/assemblyai.js): Medical
// Mode donde existe y el vocabulario de la especialidad, para que lo que se
// ve mientras se habla se parezca a lo que después queda guardado. Las
// listas van como array JSON (mandarlas repetidas devuelve «Invalid JSON
// array»: probado contra la API).
async function parametrosDeConexion(medicoPhone) {
  const [medico, delMedico] = await Promise.all([
    Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad idioma").lean(),
    medicamentosDelMedico(medicoPhone),
  ]);
  const idioma = idiomaSoportado(medico?.idioma);
  const p = new URLSearchParams({
    sample_rate: "16000",
    encoding: "pcm_s16le",
    speech_model: "universal-3-5-pro",
    mode: "balanced",
    language_codes: JSON.stringify([idioma]),
  });
  if (IDIOMAS_CON_MEDICAL_MODE.includes(idioma)) p.set("domain", "medical-v1");
  const keyterms = keytermsPara(medico?.tipoEspecialidad, idioma, delMedico);
  if (keyterms.length) p.set("keyterms_prompt", JSON.stringify(keyterms));
  return p;
}

// ─── LOS PASES ──────────────────────────────────────────────────────────────
const pases = new Map();   // pase → { adminUser, parametros, vence }

// adminUser: la sesión que lo pidió (el token ya verificado), para seguir
// revisando que valga mientras la vista previa esté abierta.
async function emitirPase(adminUser) {
  const parametros = await parametrosDeConexion(adminUser.usuario);
  const ahora = Date.now();
  for (const [p, d] of pases) if (d.vence <= ahora) pases.delete(p);
  const pase = crypto.randomBytes(24).toString("base64url");
  pases.set(pase, { adminUser, parametros, vence: ahora + AJUSTES.PASE_MS });
  return pase;
}

// ─── LAS CONEXIONES ─────────────────────────────────────────────────────────
const abiertasPorMedico = new Map();   // medicoPhone → Set, en el orden en que se abrieron

const enviar = (ws, datos) => { if (ws?.readyState === WebSocket.OPEN) ws.send(datos); };
const transcurridos = (s) => (s.abiertaEn ? Math.round((Date.now() - s.abiertaEn) / 100) / 10 : 0);

function alConectar(cliente, req) {
  cliente.on("error", () => {});   // el "close" que sigue limpia
  let pase = "";
  try { pase = new URL(req.url, "http://localhost").searchParams.get("pase") || ""; } catch { /* sin pase */ }
  const datos = pases.get(pase);
  pases.delete(pase);
  if (!datos || datos.vence <= Date.now()) {
    cliente.close(4001, "pase");
    return;
  }

  const s = {
    medicoPhone: datos.adminUser.usuario, adminUser: datos.adminUser, cliente,
    upstream: null, doc: null, abiertaEn: 0, ultimoAudio: Date.now(), enEspera: [],
    terminando: false, finalizada: false, revisando: false, motivo: "", termination: null, timers: [],
  };
  const abiertas = abiertasPorMedico.get(s.medicoPhone) || new Set();
  abiertasPorMedico.set(s.medicoPhone, abiertas);
  for (const vieja of [...abiertas].slice(0, Math.max(0, abiertas.size - AJUSTES.SIMULTANEAS + 1))) {
    abiertas.delete(vieja);
    cortar(vieja, "reemplazada", 4004, "Se abrió la vista previa en otra pantalla, y esta se cerró.");
  }
  abiertas.add(s);

  cliente.on("message", (data, esBinario) => delNavegador(s, data, esBinario));
  cliente.on("close", () => terminar(s, "navegador"));
  preparar(s, datos.parametros);
}

// Antes de pagar nada: si puede abrirla, se anota y recién ahí se conecta.
// Sin poder anotarla no se abre: lo que no se mide no se puede cortar.
async function preparar(s, parametros) {
  try {
    if (!(await revisar(s))) return;
    s.doc = await VistaPrevia.create({ medicoPhone: s.medicoPhone, inicio: new Date() });
  } catch (e) {
    log.error("[VISTA_PREVIA] no se pudo abrir:", e.message);
    cortar(s, "error", 1011, "La vista previa en vivo no está disponible ahora.");
    return;
  }
  if (s.terminando) {
    // El navegador se fue mientras tanto: queda anotada, sin tiempo.
    await VistaPrevia.updateOne({ _id: s.doc._id }, { $set: { fin: new Date(), motivo: s.motivo } }).catch(() => {});
    return;
  }
  conectarAssembly(s, parametros);
}

// Lo que se revisa al abrirla y cada CHEQUEO_MS. Corta y devuelve false si
// no puede seguir.
async function revisar(s) {
  if (!(Number(s.adminUser.exp) > Date.now()) || !(await sesionVigente(s.adminUser))) {
    cortar(s, "sesion", 4005, "Tu sesión ya no es válida. Volvé a iniciar sesión.");
    return false;
  }
  try {
    await extensiones.revisar("vistaPrevia.durante", { adminUser: s.adminUser });
  } catch (e) {
    if (!e.status) throw e;   // un error de programación no es un «no»
    cortar(s, "tope", 4002, e.message);
    return false;
  }
  const [hoy] = await VistaPrevia.aggregate([
    { $match: { medicoPhone: s.medicoPhone, inicio: { $gte: new Date(Date.now() - 86400000) } } },
    { $group: { _id: null, segundos: { $sum: "$segundos" } } },
  ]);
  if ((hoy?.segundos || 0) >= AJUSTES.HORAS_DIA * 3600) {
    cortar(s, "tope-dia", 4002, `La vista previa en vivo llegó a su máximo de ${AJUSTES.HORAS_DIA} horas por día.`);
    return false;
  }
  return !s.terminando;
}

function conectarAssembly(s, parametros) {
  if (!CONFIG.ASSEMBLYAI_API_KEY) {
    log.error("[VISTA_PREVIA] ASSEMBLYAI_API_KEY no configurado");
    cortar(s, "error", 1011, "La vista previa en vivo no está disponible ahora.");
    return;
  }
  const up = new WebSocket(`${CONFIG.ASSEMBLYAI_STREAMING_URL}?${parametros}`, {
    headers: { Authorization: CONFIG.ASSEMBLYAI_API_KEY },
    handshakeTimeout: 10000,
  });
  s.upstream = up;
  up.on("open", () => {
    s.abiertaEn = Date.now();
    if (s.terminando) { terminarAssembly(s); return; }
    for (const trozo of s.enEspera) up.send(trozo);
    s.enEspera = [];
    s.timers.push(setInterval(() => tic(s), AJUSTES.TIC_MS), setInterval(() => chequeo(s), AJUSTES.CHEQUEO_MS));
  });
  up.on("message", (data, esBinario) => { if (!esBinario) deAssembly(s, data); });
  up.on("error", (e) => log.warn(`[VISTA_PREVIA] AssemblyAI (${s.medicoPhone}):`, e.message));
  up.on("close", (codigo, razon) => alCerrarAssembly(s, codigo, String(razon || "")));
}

function delNavegador(s, data, esBinario) {
  if (s.terminando) return;
  if (esBinario) {
    s.ultimoAudio = Date.now();
    if (s.upstream?.readyState === WebSocket.OPEN) s.upstream.send(data);
    else if (s.enEspera.length < AJUSTES.EN_ESPERA) s.enEspera.push(data);
    // Tirar audio dejaría un hueco en el texto que el navegador cree entero
    // (y con ese texto se escribe la nota en vivo): mejor cortar.
    else cortar(s, "error", 1011, "La vista previa en vivo no pudo conectarse a tiempo.");
    return;
  }
  let tipo = "";
  try { tipo = JSON.parse(String(data))?.type; } catch { /* no es JSON: se ignora */ }
  if (tipo === "Terminate") terminar(s, "navegador");
  else if (tipo === "ForceEndpoint") enviar(s.upstream, JSON.stringify({ type: "ForceEndpoint" }));
}

function deAssembly(s, data) {
  const texto = String(data);
  try {
    const msg = JSON.parse(texto);
    if (msg?.type === "Termination") s.termination = msg;
  } catch { /* se pasa igual */ }
  enviar(s.cliente, texto);
}

// Sin la base: cuánto hace que no llega audio y cuánto lleva abierta.
function tic(s) {
  if (s.terminando) return;
  const ahora = Date.now();
  if (ahora - s.ultimoAudio >= AJUSTES.INACTIVO_MS) cortar(s, "inactiva", 4003, "La vista previa se cerró porque no estaba llegando audio.");
  else if (ahora - s.abiertaEn >= AJUSTES.MAX_SESION_MS) cortar(s, "larga", 4002, "La vista previa llegó a su máximo de tiempo seguido.");
}

// Con la base: se guarda el tiempo (si el servidor se cae, queda esto) y se
// revisa todo de nuevo. Si la base falla, siguen los topes de tic().
async function chequeo(s) {
  if (s.terminando || s.revisando || !s.doc) return;
  s.revisando = true;
  try {
    await VistaPrevia.updateOne({ _id: s.doc._id }, { $set: { segundos: transcurridos(s) } });
    await revisar(s);
  } catch (e) {
    log.warn("[VISTA_PREVIA] no se pudo revisar:", e.message);
  } finally {
    s.revisando = false;
  }
  // nginx corta una conexión por la que no pasa nada: el ping la mantiene.
  if (!s.terminando && s.cliente.readyState === WebSocket.OPEN) s.cliente.ping();
}

// Se corta con un motivo que el navegador muestra. La grabación sigue, salvo
// que la sesión ya no valga (ahí tampoco se va a poder subir).
function cortar(s, motivo, codigo, mensaje) {
  if (s.terminando) return;
  s.motivo = motivo;
  if (s.cliente.readyState === WebSocket.OPEN) {
    s.cliente.send(JSON.stringify({ type: "Error", error: motivo === "sesion" ? mensaje : `${mensaje} La grabación sigue.` }));
    s.cliente.close(codigo, motivo);
  }
  terminar(s, motivo);
}

function terminar(s, motivo) {
  if (s.terminando) return;
  s.terminando = true;
  if (!s.motivo) s.motivo = motivo;
  terminarAssembly(s);
}

// AssemblyAI cobra hasta que la conexión se cierra: primero se le pide que
// termine (contesta con Termination, que dice cuánto midió) y, si no
// cierra solo, se lo corta.
function terminarAssembly(s) {
  s.timers.forEach(clearInterval);
  s.timers = [];
  const up = s.upstream;
  if (!up) { finalizar(s); return; }
  if (up.readyState === WebSocket.OPEN) {
    try { up.send(JSON.stringify({ type: "Terminate" })); } catch { /* ya se estaba cerrando */ }
    s.timers.push(setTimeout(() => up.terminate(), AJUSTES.CIERRE_MS));
  } else if (up.readyState === WebSocket.CONNECTING) {
    up.terminate();
  }
}

function alCerrarAssembly(s, codigo, razon) {
  if (!s.terminando) {
    // Cortó AssemblyAI (un error suyo, su tope de 3 horas, la cuenta sin saldo).
    log.warn(`[VISTA_PREVIA] AssemblyAI cerró la de ${s.medicoPhone}: ${codigo} ${razon}`);
    cortar(s, "assembly", 4010, `El servicio de transcripción cortó la vista previa (${codigo}${razon ? ": " + razon : ""}).`);
  }
  finalizar(s);
}

async function finalizar(s) {
  if (s.finalizada) return;
  s.finalizada = true;
  s.timers.forEach(clearTimeout);
  s.timers = [];
  const abiertas = abiertasPorMedico.get(s.medicoPhone);
  if (abiertas) {
    abiertas.delete(s);
    if (!abiertas.size) abiertasPorMedico.delete(s.medicoPhone);
  }
  if (s.cliente.readyState === WebSocket.OPEN) s.cliente.close(1000);
  if (!s.doc) return;
  const t = s.termination;
  await VistaPrevia.updateOne({ _id: s.doc._id }, { $set: {
    fin: new Date(), segundos: transcurridos(s), motivo: s.motivo,
    segundosAssembly: Number.isFinite(t?.session_duration_seconds) ? t.session_duration_seconds : null,
    segundosAudio: Number.isFinite(t?.audio_duration_seconds) ? t.audio_duration_seconds : null,
  } }).catch((e) => log.error("[VISTA_PREVIA] no se pudo guardar el cierre:", e.message));
}

function iniciarVistaPrevia(httpServer) {
  // noServer + registrarWs: ver services/wsRuteo.js. El audio llega de a
  // 100 ms (3.200 bytes); un trozo de más de 64 KB no es audio de la app.
  const wss = registrarWs(httpServer, RUTA, new WebSocket.WebSocketServer({ noServer: true, maxPayload: 64 * 1024 }));
  wss.on("connection", alConectar);
  return wss;
}

// ─── AL SUBIR LA GRABACIÓN ──────────────────────────────────────────────────
// La vista previa de la grabación que se está subiendo: la última de la
// cuenta que todavía no tiene consulta. Para una grabación vieja del
// respaldo del teléfono no hay ninguna, y se cuentan por separado.
function deEstaGrabacion(medicoPhone) {
  return VistaPrevia.findOne({ medicoPhone, consultaId: null, inicio: { $gte: new Date(Date.now() - AJUSTES.VENTANA_MS) } })
    .sort({ inicio: -1 }).select("_id segundos").lean();
}

async function vincular(vista, consultaId) {
  if (vista) await VistaPrevia.updateOne({ _id: vista._id, consultaId: null }, { $set: { consultaId } });
}

// Para las pruebas.
const abiertas = (medicoPhone) => abiertasPorMedico.get(medicoPhone)?.size || 0;

module.exports = { RUTA, AJUSTES, iniciarVistaPrevia, emitirPase, parametrosDeConexion, deEstaGrabacion, vincular, abiertas };
