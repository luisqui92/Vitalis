// Symphomed — La vista previa en vivo pasa por el servidor
// (services/vistaPrevia.js).
//
// AssemblyAI cobra la vista previa por el tiempo que la conexión queda
// abierta, se hable o no. Antes el navegador se conectaba directo y desde el
// servidor no se veía cuánto duraba: las horas de un estudiante no la
// contaban (segunda revisión de QA del 9 de octubre de 2026, E06). Lo que se
// prueba, con un AssemblyAI de mentira:
//   1. El pase: sale con sesión, no lleva la clave, vale una sola vez y vence.
//   2. El puente: la clave la pone el servidor, igual que el idioma y el
//      vocabulario; el audio pasa entero, el texto vuelve, y del navegador
//      solo se acepta audio, Terminate y ForceEndpoint.
//   3. Se mide: al cerrar, AssemblyAI recibe Terminate y el tiempo queda
//      anotado.
//   4. Se corta: sin audio, con más de dos a la vez, en el tope del día, con
//      la sesión cortada, con un trozo que no es audio de la app, si
//      AssemblyAI falla o no cierra, y sin clave. Y sin saldo no hay pase.
//   5. Las horas del estudiante: la vista previa cuenta y se corta en el
//      tope; la grabación que empezó con horas se sube; una grabación y su
//      vista previa se cuentan una sola vez.
//   6. Al subir, la vista previa se engancha a su consulta.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.DIR_AUDIO_PENDIENTE = fs.mkdtempSync(path.join(os.tmpdir(), "vista-previa-"));
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const CLAVE_AAI = "clave-de-prueba-de-assemblyai-0123456789";

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(condicion, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(25); }
  return false;
}
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    if (cuerpo) { headers["content-type"] = "audio/ogg"; headers["content-length"] = cuerpo.length; }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "vista_previa";
  const { CONFIG } = require(path.join(RAIZ, "config"));
  CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  // La transcripción final, de mentira: no termina nunca (acá no importa).
  const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));
  assemblyai.transcribirConsultaMedica = () => new Promise(() => {});

  // ─── AssemblyAI de mentira ──────────────────────────────────────────────
  // modo: "normal"; "rechaza" (no deja conectar); "sordo" (ignora Terminate);
  // "lento" (tarda en dejar conectar).
  const WebSocket = require(path.join(RAIZ, "node_modules", "ws"));
  const falso = { conexiones: [], modo: "normal" };
  const servidorAAI = new WebSocket.WebSocketServer({
    port: 0, host: "127.0.0.1",
    verifyClient: (_info, cb) => {
      if (falso.modo === "rechaza") return cb(false, 401, "Unauthorized");
      if (falso.modo === "lento") return setTimeout(() => cb(true), 800);
      cb(true);
    },
  });
  servidorAAI.on("connection", (ws, req) => {
    const c = { ws, auth: req.headers.authorization, params: new URL(req.url, "http://x").searchParams, audio: [], textos: [], cerrada: false };
    falso.conexiones.push(c);
    ws.send(JSON.stringify({ type: "Begin", id: "sesion-" + falso.conexiones.length, expires_at: 0 }));
    ws.on("message", (data, binario) => {
      if (binario) { c.audio.push(Buffer.from(data)); return; }
      c.textos.push(String(data));
      let tipo = "";
      try { tipo = JSON.parse(String(data)).type; } catch { /* no era JSON */ }
      if (tipo === "Terminate" && falso.modo !== "sordo") {
        ws.send(JSON.stringify({ type: "Termination", audio_duration_seconds: 7, session_duration_seconds: 8 }));
        ws.close(1000);
      }
    });
    ws.on("close", () => { c.cerrada = true; });
  });
  await new Promise((r) => servidorAAI.on("listening", r));
  CONFIG.ASSEMBLYAI_STREAMING_URL = `ws://127.0.0.1:${servidorAAI.address().port}/v3/ws`;
  CONFIG.ASSEMBLYAI_API_KEY = CLAVE_AAI;
  const recibioTerminate = (c) => c.textos.some(t => { try { return JSON.parse(t).type === "Terminate"; } catch { return false; } });

  // Los tiempos, achicados: lo que en producción es un minuto acá es menos de uno.
  const vistaPrevia = require(path.join(RAIZ, "services", "vistaPrevia"));
  Object.assign(vistaPrevia.AJUSTES, { PASE_MS: 1500, INACTIVO_MS: 700, CHEQUEO_MS: 150, TIC_MS: 50, CIERRE_MS: 400 });

  const express = require("express");
  const app = express();
  app.use(express.json());
  // Como en index.js: el módulo antes de las rutas del núcleo.
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  vistaPrevia.iniciarVistaPrevia(servidor);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const P = (m, ruta, t, cuerpo) => pedir(puerto, m, ruta, t, cuerpo);

  // El navegador, de mentira.
  function conectar(pase) {
    const ws = new WebSocket(`ws://127.0.0.1:${puerto}/ws-vista-previa${pase === undefined ? "" : "?pase=" + encodeURIComponent(pase)}`);
    const c = { ws, mensajes: [], cierre: null, bomba: null };
    ws.on("message", (d) => { try { c.mensajes.push(JSON.parse(String(d))); } catch { c.mensajes.push(String(d)); } });
    ws.on("close", (code, reason) => { c.cierre = { code, reason: String(reason) }; clearInterval(c.bomba); });
    ws.on("error", () => {});
    c.abierta = new Promise((r) => { ws.on("open", () => r(true)); ws.on("close", () => r(false)); });
    return c;
  }
  const trozo = (valor = 7, n = 3200) => Buffer.alloc(n, valor);   // 100 ms de PCM a 16 kHz
  // Audio cada 100 ms, como la pantalla: para que no la corte por inactiva.
  const bombear = (c) => { c.bomba = setInterval(() => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(trozo()); }, 100); };
  const cerrar = (...cs) => cs.forEach(c => { clearInterval(c.bomba); try { c.ws.close(); } catch { /* ya estaba */ } });
  const cerradaCon = async (c, codigo, ms = 6000) => (await hasta(() => c.cierre, ms)) && c.cierre.code === codigo;
  const avisoDe = (c) => c.mensajes.find(m => m?.type === "Error")?.error || "";
  const paseDe = async (tk) => (await P("GET", "/medico/transcripcion-token", tk)).cuerpo?.pase;
  const ultimaDe = (phone) => M.VistaPrevia.findOne({ medicoPhone: phone }).sort({ inicio: -1 }).lean();
  const nuevaConexion = async (antes) => (await hasta(() => falso.conexiones.length > antes)) ? falso.conexiones[falso.conexiones.length - 1] : null;
  // Abre una y espera a que llegue a AssemblyAI. Lo que había se cuenta antes
  // de conectarse: si no, la conexión podría llegar antes de mirar.
  async function abrir(tk, { bomba = true } = {}) {
    const pase = await paseDe(tk);
    const antes = falso.conexiones.length;
    const c = conectar(pase);
    await c.abierta;
    if (bomba) bombear(c);
    return { c, aai: await nuevaConexion(antes) };
  }

  const medico = async (phone, extra = {}) => {
    await M.Medico.create({ phone, nombre: "Dra. " + phone, passwordHash: "x", activo: true, tipoEspecialidad: "medicina_general", ...extra });
    return generarToken(phone, "medico", 36e5, extra.estudiante ? { estudiante: true } : {});
  };
  const tkA = await medico("70098001", { idioma: "es" });

  console.log("── 1. El pase ──");
  const audioJs = fs.readFileSync(path.join(RAIZ, "public", "js", "audio.js"), "utf8");
  verificar("la pantalla se conecta a Symphomed, no a AssemblyAI", /\/ws-vista-previa/.test(audioJs) && !/assemblyai\.com/i.test(audioJs));
  verificar("  ...y la política de seguridad no la dejaría", !/connectSrc:[^\]]*assemblyai/i.test(fs.readFileSync(path.join(RAIZ, "index.js"), "utf8")));
  let r = await P("GET", "/medico/transcripcion-token", tkA);
  verificar("con sesión → un pase y la ruta a donde conectarse", r.estado === 200 && typeof r.cuerpo?.pase === "string"
    && r.cuerpo.pase.length >= 30 && r.cuerpo.ruta === "/ws-vista-previa");
  verificar("  ...sin la clave de AssemblyAI ni un permiso suyo", !JSON.stringify(r.cuerpo).includes(CLAVE_AAI) && !("token" in r.cuerpo));
  verificar("sin sesión → 401", (await P("GET", "/medico/transcripcion-token", null)).estado === 401);
  const conexionesAntes = falso.conexiones.length;
  let c = conectar(undefined);
  verificar("conectarse sin pase → se cierra (4001)", await cerradaCon(c, 4001));
  c = conectar("un-pase-inventado-de-treinta-y-dos-letras");
  verificar("con un pase inventado → 4001", await cerradaCon(c, 4001));
  const vencido = await paseDe(tkA);
  await esperar(vistaPrevia.AJUSTES.PASE_MS + 300);
  c = conectar(vencido);
  verificar("con un pase vencido → 4001", await cerradaCon(c, 4001));
  verificar("  ...y AssemblyAI no se enteró de ninguno", falso.conexiones.length === conexionesAntes);

  console.log("\n── 2. El puente ──");
  // Sin chequeos por el medio: lo que quede anotado tiene que salir del
  // cierre mismo. En producción el chequeo es cada medio minuto, y sin eso
  // una vista previa corta quedaría en cero.
  vistaPrevia.AJUSTES.CHEQUEO_MS = 60000;
  const p1 = await paseDe(tkA);
  c = conectar(p1);
  await c.abierta;
  // Antes de que AssemblyAI conteste: el servidor lo guarda y lo pasa en orden.
  const enviado = [trozo(1), trozo(2), trozo(3)];
  for (const t of enviado) c.ws.send(t);
  const aai = await nuevaConexion(conexionesAntes);
  verificar("la clave la pone el servidor, en el encabezado", aai?.auth === CLAVE_AAI);
  verificar("  ...el idioma de la cuenta, Medical Mode, el modelo y el formato del audio",
    aai?.params.get("language_codes") === '["es"]' && aai.params.get("domain") === "medical-v1"
    && aai.params.get("speech_model") === "universal-3-5-pro" && aai.params.get("sample_rate") === "16000" && aai.params.get("encoding") === "pcm_s16le");
  let terminos = [];
  try { terminos = JSON.parse(aai?.params.get("keyterms_prompt") || "[]"); } catch { /* queda vacío */ }
  verificar("  ...y el vocabulario de la especialidad", terminos.length > 10);
  verificar("  ...sin nada que haya puesto el navegador", aai && !aai.params.has("token") && !aai.params.has("pase"));
  const otra = conectar(p1);
  verificar("el mismo pase no abre otra (4001)", await cerradaCon(otra, 4001));
  await hasta(() => aai.audio.length === 3);
  verificar("el audio llega a AssemblyAI entero y en orden", Buffer.concat(aai.audio).equals(Buffer.concat(enviado)));
  // Desde acá, audio cada 100 ms como la pantalla: sin audio, se cierra sola (4).
  bombear(c);
  aai.ws.send(JSON.stringify({ type: "Turn", transcript: "Buenos días, doctor", end_of_turn: true }));
  await hasta(() => c.mensajes.some(m => m?.type === "Turn"));
  verificar("el texto vuelve al navegador", c.mensajes.find(m => m?.type === "Turn")?.transcript === "Buenos días, doctor");
  c.ws.send(JSON.stringify({ type: "UpdateConfiguration", keyterms_prompt: ["otra cosa"], language_codes: ["en"] }));
  c.ws.send("esto no es JSON");
  c.ws.send(JSON.stringify({ type: "ForceEndpoint" }));
  await hasta(() => aai.textos.length >= 1);
  await esperar(150);
  verificar("del navegador pasa ForceEndpoint; lo que cambiaría la configuración, no",
    aai.textos.length === 1 && JSON.parse(aai.textos[0]).type === "ForceEndpoint");

  console.log("\n── 3. Se mide ──");
  await esperar(700);
  let doc = await ultimaDe("70098001");
  verificar("mientras está abierta (sin chequeo todavía) no tiene tiempo guardado", doc && doc.segundos === 0 && !doc.fin);
  cerrar(c);
  await hasta(async () => (await ultimaDe("70098001"))?.fin);
  doc = await ultimaDe("70098001");
  verificar("al cerrar, AssemblyAI recibe Terminate y cierra", recibioTerminate(aai) && await hasta(() => aai.cerrada));
  verificar(`  ...y queda anotada: ${doc?.segundos} s abierta, lo que contó AssemblyAI y por qué se cerró`,
    doc?.segundos >= 0.7 && doc.segundos <= (new Date(doc.fin) - new Date(doc.inicio)) / 1000 + 0.2
    && doc.segundosAssembly === 8 && doc.segundosAudio === 7 && doc.motivo === "navegador");
  verificar("  ...y ya no cuenta como abierta", vistaPrevia.abiertas("70098001") === 0);

  const tkPt = await medico("70098002", { idioma: "pt" });
  let aaiPt;
  ({ c, aai: aaiPt } = await abrir(tkPt));
  verificar("una cuenta en portugués: el idioma de la cuenta y sin Medical Mode (no existe en portugués)",
    aaiPt?.params.get("language_codes") === '["pt"]' && !aaiPt.params.has("domain"));
  cerrar(c);

  console.log("\n── 4. Se corta ──");
  vistaPrevia.AJUSTES.CHEQUEO_MS = 150;
  let aaiX;
  ({ c, aai: aaiX } = await abrir(tkA, { bomba: false }));
  c.ws.send(trozo());
  verificar("sin audio un rato → se cierra (4003), y el aviso dice por qué y que la grabación sigue",
    await cerradaCon(c, 4003) && /no estaba llegando audio/.test(avisoDe(c)) && /La grabación sigue/.test(avisoDe(c)));
  verificar("  ...AssemblyAI recibe Terminate, y queda anotada como inactiva",
    recibioTerminate(aaiX) && await hasta(async () => (await ultimaDe("70098001"))?.motivo === "inactiva"));

  const tkC = await medico("70098003");
  const { c: c1 } = await abrir(tkC);
  const { c: c2 } = await abrir(tkC);
  const { c: c3 } = await abrir(tkC);
  verificar("una tercera a la vez cierra la más vieja (4004), con el aviso", await cerradaCon(c1, 4004) && /otra pantalla/.test(avisoDe(c1)));
  await esperar(300);
  verificar("  ...y las otras dos siguen", !c2.cierre && !c3.cierre && vistaPrevia.abiertas("70098003") === 2);
  cerrar(c2, c3);

  // El tope del día: con lo de hoy a un segundo del tope, se corta al pasarlo.
  const tkD = await medico("70098004");
  const topeDia = vistaPrevia.AJUSTES.HORAS_DIA * 3600;
  await M.VistaPrevia.create({ medicoPhone: "70098004", inicio: new Date(Date.now() - 3600e3), fin: new Date(), segundos: topeDia - 1 });
  ({ c } = await abrir(tkD));
  verificar(`a un segundo de las ${vistaPrevia.AJUSTES.HORAS_DIA} horas del día → se corta al pasarlas (4002)`,
    await cerradaCon(c, 4002) && /horas por día/.test(avisoDe(c)));
  const antesDelTope = falso.conexiones.length;
  c = conectar(await paseDe(tkD));
  verificar("  ...y una nueva se corta antes de conectarse con AssemblyAI", await cerradaCon(c, 4002) && falso.conexiones.length === antesDelTope);

  // La sesión de la cuenta deja de valer a la mitad (services/auth.js).
  ({ c } = await abrir(tkA));
  await M.Medico.updateOne({ phone: "70098001" }, { $set: { activo: false } });
  verificar("la cuenta se desactiva a la mitad → se corta (4005): «volvé a iniciar sesión»",
    await cerradaCon(c, 4005) && /iniciar sesión/.test(avisoDe(c)));
  await M.Medico.updateOne({ phone: "70098001" }, { $set: { activo: true } });

  ({ c, aai: aaiX } = await abrir(tkA, { bomba: false }));
  c.ws.send(Buffer.alloc(70 * 1024, 1));
  verificar("un trozo de más de 64 KB (no es audio de la app) → se cierra (1009), y AssemblyAI recibe Terminate",
    await cerradaCon(c, 1009) && await hasta(() => recibioTerminate(aaiX)));

  falso.modo = "rechaza";
  c = conectar(await paseDe(tkA));
  verificar("AssemblyAI no deja conectar → se corta (4010), con el aviso", await cerradaCon(c, 4010) && /servicio de transcripción/.test(avisoDe(c)));
  await hasta(async () => (await ultimaDe("70098001"))?.fin);
  doc = await ultimaDe("70098001");
  verificar("  ...anotada con 0 segundos: no se llegó a pagar nada", doc?.segundos === 0 && doc.motivo === "assembly");
  falso.modo = "normal";

  ({ c, aai: aaiX } = await abrir(tkA));
  await esperar(200);
  aaiX.ws.close(3005, "Internal error");
  verificar("AssemblyAI corta a la mitad → se corta (4010) y dice el código", await cerradaCon(c, 4010) && /3005/.test(avisoDe(c)));

  falso.modo = "sordo";
  ({ c, aai: aaiX } = await abrir(tkA));
  await esperar(200);
  cerrar(c);
  verificar("AssemblyAI no cierra después del Terminate → el servidor la corta igual",
    await hasta(() => recibioTerminate(aaiX)) && await hasta(() => aaiX.cerrada, 3000));
  verificar("  ...y queda anotada", await hasta(async () => (await ultimaDe("70098001"))?.fin));
  falso.modo = "normal";

  // AssemblyAI tarda en abrir y se junta más audio del que se guarda: tirarlo
  // dejaría un hueco en el texto que la pantalla cree entero.
  falso.modo = "lento";
  vistaPrevia.AJUSTES.EN_ESPERA = 5;
  c = conectar(await paseDe(tkA)); await c.abierta;
  for (let i = 0; i < 10; i++) c.ws.send(trozo());
  verificar("AssemblyAI tarda y se junta demasiado audio → se corta (1011), no se tira audio en silencio",
    await cerradaCon(c, 1011) && /no pudo conectarse a tiempo/.test(avisoDe(c)));
  vistaPrevia.AJUSTES.EN_ESPERA = 100;
  falso.modo = "normal";

  CONFIG.ASSEMBLYAI_API_KEY = "";
  const sinClave = falso.conexiones.length;
  c = conectar(await paseDe(tkA));
  verificar("sin la clave configurada → «no está disponible» (1011), sin conectarse",
    await cerradaCon(c, 1011) && /no está disponible/.test(avisoDe(c)) && falso.conexiones.length === sinClave);
  CONFIG.ASSEMBLYAI_API_KEY = CLAVE_AAI;

  const tkSinSaldo = await medico("70098005", { consultasGratisUsadas: 99, saldoCentavos: -1e7 });
  r = await P("GET", "/medico/transcripcion-token", tkSinSaldo);
  verificar("una cuenta sin saldo (no puede subir consultas) → no hay pase (402)", r.estado === 402 && /saldo/.test(r.cuerpo?.error || ""));

  console.log("\n── 5. Las horas del estudiante ──");
  const enNoventaDias = new Date(Date.now() + 90 * 86400000);
  const tkE = await medico("59170098010", { estudiante: { nivel: "interno", hasta: enNoventaDias, horasMes: 1 } });
  const pacE = await M.Paciente.create({ medicoPhone: "59170098010", nombre: "Paciente de práctica" });
  // Le quedan tres segundos de su hora del mes.
  await M.ConsultaMedica.create({ medicoPhone: "59170098010", pacienteId: pacE._id, estado: "completado", duracionSegundos: 3597 });
  r = await P("GET", "/medico/transcripcion-token", tkE);
  verificar("con tres segundos por usar → sale el pase", r.estado === 200);
  c = conectar(r.cuerpo.pase); await c.abierta; bombear(c);
  verificar("la vista previa se corta al terminarse las horas (4002), con el motivo y que la grabación sigue",
    await cerradaCon(c, 4002) && /horas de audio/.test(avisoDe(c)) && /La grabación sigue/.test(avisoDe(c)));
  await hasta(async () => (await ultimaDe("59170098010"))?.fin);
  doc = await ultimaDe("59170098010");
  verificar(`  ...anotada por tope, con su tiempo (${doc?.segundos} s)`, doc?.motivo === "tope" && doc.segundos >= 2.4);
  r = await P("GET", "/medico/transcripcion-token", tkE);
  verificar("  ...y otra ya no empieza: el pase dice que no (402)", r.estado === 402 && /horas de audio/.test(r.cuerpo?.error || ""));
  r = await P("POST", `/medico/consultas?pacienteId=${pacE._id}`, tkE, Buffer.from("audio de la consulta"));
  verificar("la grabación que empezó con horas se sube igual (202)", r.estado === 202);
  doc = await M.VistaPrevia.findById(doc._id).lean();
  verificar("  ...y su vista previa queda enganchada a esa consulta", String(doc.consultaId) === String(r.cuerpo?.consulta?._id));
  r = await P("POST", `/medico/consultas?pacienteId=${pacE._id}`, tkE, Buffer.from("otra grabación"));
  verificar("  ...pero otra grabación, sin horas, ya no (402)", r.estado === 402);

  // La cuenta: una grabación y su vista previa son la misma hora de consulta.
  const tkF = await medico("59170098011", { estudiante: { nivel: "interno", hasta: enNoventaDias, horasMes: 1 } });
  const pacF = await M.Paciente.create({ medicoPhone: "59170098011", nombre: "Otro paciente" });
  const consulta = (duracionSegundos, estado = "completado") => M.ConsultaMedica.create({ medicoPhone: "59170098011", pacienteId: pacF._id, estado, duracionSegundos });
  const vista = (segundos, consultaId = null, inicio = new Date()) => M.VistaPrevia.create({ medicoPhone: "59170098011", inicio, fin: new Date(), segundos, consultaId });
  const a = await consulta(600); await vista(700, a._id);           // la vista previa duró más: 700
  const b = await consulta(1200); await vista(1000, b._id);         // la grabación duró más: 1200
  const enCamino = await consulta(null, "procesando");
  const vistaEnCamino = await vista(1200, enCamino._id);            // todavía sin duración: 1200
  await vista(499);                                                 // sin grabación subida: 499
  await vista(99999, null, new Date(Date.UTC(2020, 0, 15)));        // de otro mes: no cuenta
  const estadoF = async () => (await P("GET", "/medico/estudiante/estado", tkF)).cuerpo?.estudiante;
  let e = await estadoF();
  verificar(`700 + 1200 + 1200 + 499 = 3599 s → todavía puede (${e?.horasUsadas} h usadas)`, e && !e.sinHoras && e.horasUsadas === 1);
  await vista(1);
  e = await estadoF();
  verificar("  ...con un segundo más de vista previa suelta, se llegó a la hora", e?.sinHoras === true);
  const { estadoDe } = require(path.join(RAIZ, "modulos", "estudiantes", "cuenta"));
  const cuentaF = await M.Medico.findOne({ phone: "59170098011" }).lean();
  e = await estadoDe(cuentaF, new Date(), { sinVistaPrevia: vistaEnCamino._id });
  verificar("  ...y sin la vista previa de la grabación que se sube, no (es la que se está subiendo)", e && !e.sinHoras);

  // Vencido el acceso a la mitad, también se corta.
  const tkG = await medico("59170098012", { estudiante: { nivel: "interno", hasta: enNoventaDias, horasMes: 6 } });
  ({ c } = await abrir(tkG));
  await M.Medico.updateOne({ phone: "59170098012" }, { $set: { "estudiante.hasta": new Date(Date.now() - 1000) } });
  verificar("el acceso vence a la mitad → se corta (4002), «venció»", await cerradaCon(c, 4002) && /venció/.test(avisoDe(c)));

  console.log("\n── 6. Al subir, la vista previa se engancha a su consulta ──");
  const pacA = await M.Paciente.create({ medicoPhone: "70098001", nombre: "Paciente A" });
  ({ c } = await abrir(tkA));
  await esperar(400);
  cerrar(c);
  await hasta(async () => (await ultimaDe("70098001"))?.motivo === "navegador");
  const deEsta = await ultimaDe("70098001");
  r = await P("POST", `/medico/consultas?pacienteId=${pacA._id}`, tkA, Buffer.from("audio"));
  verificar("subir la grabación → 202, y su vista previa queda enganchada", r.estado === 202
    && String((await M.VistaPrevia.findById(deEsta._id).lean()).consultaId) === String(r.cuerpo?.consulta?._id));
  const tkH = await medico("70098006");
  const pacH = await M.Paciente.create({ medicoPhone: "70098006", nombre: "Paciente H" });
  const vieja = await M.VistaPrevia.create({ medicoPhone: "70098006", inicio: new Date(Date.now() - 5 * 3600e3), fin: new Date(Date.now() - 4.5 * 3600e3), segundos: 1800 });
  r = await P("POST", `/medico/consultas?pacienteId=${pacH._id}`, tkH, Buffer.from("audio del respaldo"));
  verificar("una vista previa de hace cinco horas no se engancha a la grabación que se sube ahora",
    r.estado === 202 && (await M.VistaPrevia.findById(vieja._id).lean()).consultaId === null);

  servidor.close();
  servidorAAI.close();
  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(process.env.DIR_AUDIO_PENDIENTE, { recursive: true, force: true });
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
