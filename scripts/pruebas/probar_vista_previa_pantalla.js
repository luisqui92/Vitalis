// Symphomed — La vista previa en vivo, de punta a punta: el micrófono falso
// de Chromium → la pantalla → Symphomed (/ws-vista-previa) → un AssemblyAI
// de mentira, y el texto de vuelta (services/vistaPrevia.js).
//
// La prueba del puente (probar_vista_previa.js) lo prueba con un cliente
// hecho a mano; la de la nota en vivo (probar_nota_en_vivo_pantalla.js)
// contesta el WebSocket desde la prueba, sin servidor. Esta es la que junta
// las dos puntas, con el servidor entero (index.js): que la pantalla se
// conecte donde corresponde, que la política de seguridad la deje, que el
// audio del micrófono llegue a AssemblyAI con la clave puesta por el
// servidor, que el texto vuelva a la pantalla y que, al terminar, se cierre
// y quede medida. Y a un estudiante, que el corte por las horas se vea sin
// frenar la grabación.
//
// Con OFUSCADO=1 corre contra el JS ofuscado, que es el que se sirve en
// producción.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3963;
const CLAVE = "Symphomed1234";
const CLAVE_AAI = "clave-de-prueba-de-assemblyai-pantalla";
const MED = "70098101";
const EST = "59170098102";

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function cargarPlaywright() {
  for (const c of ["playwright", "/opt/node22/lib/node_modules/playwright", path.join(RAIZ, "node_modules", "playwright")]) {
    try { return require(c); } catch { /* seguimos */ }
  }
  return null;
}
function navegador() {
  for (const p of [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"]) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}
const traer = (ruta) => new Promise((resolve, reject) => {
  const r = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta }, (x) => { x.resume(); x.on("end", () => resolve(x.statusCode)); });
  r.on("error", reject); r.setTimeout(5000, () => r.destroy(new Error("timeout")));
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(condicion, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(100); }
  return false;
}

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  // ─── AssemblyAI de mentira ──────────────────────────────────────────────
  const WebSocket = require(path.join(RAIZ, "node_modules", "ws"));
  const conexiones = [];
  const servidorAAI = new WebSocket.WebSocketServer({ port: 0, host: "127.0.0.1" });
  servidorAAI.on("connection", (ws, req) => {
    const c = { ws, auth: req.headers.authorization, params: new URL(req.url, "http://x").searchParams, bytes: 0, textos: [], cerrada: false };
    conexiones.push(c);
    ws.send(JSON.stringify({ type: "Begin", id: "sesion-" + conexiones.length, expires_at: 0 }));
    ws.on("message", (data, binario) => {
      if (binario) {
        // Con el primer segundo de audio, «se dice» algo.
        const antes = c.bytes;
        c.bytes += data.length;
        if (antes < 32000 && c.bytes >= 32000) ws.send(JSON.stringify({ type: "Turn", transcript: "Buenos días, doctor, me duele la garganta.", end_of_turn: true }));
        return;
      }
      c.textos.push(String(data));
      let tipo = "";
      try { tipo = JSON.parse(String(data)).type; } catch { /* no era JSON */ }
      if (tipo === "Terminate") {
        ws.send(JSON.stringify({ type: "Termination", audio_duration_seconds: 3, session_duration_seconds: 3 }));
        ws.close(1000);
      }
    });
    ws.on("close", () => { c.cerrada = true; });
  });
  await new Promise((r) => servidorAAI.on("listening", r));

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "vista_previa_pantalla";
  const dirAudio = fs.mkdtempSync(path.join(os.tmpdir(), "vista-previa-audio-"));
  const env = {
    ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba",
    ASSEMBLYAI_API_KEY: CLAVE_AAI, ASSEMBLYAI_STREAMING_URL: `ws://127.0.0.1:${servidorAAI.address().port}/v3/ws`, DIR_AUDIO_PENDIENTE: dirAudio,
  };
  let servidor, browser, mongoose, copiaOfuscada = null;
  try {
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    const hash = await hashPassword(CLAVE);
    await M.Medico.create({ phone: MED, nombre: "Dra. Vista Previa", passwordHash: hash, activo: true, tipoEspecialidad: "medicina_general" });
    const paciente = await M.Paciente.create({ medicoPhone: MED, nombre: "Juana Pérez" });
    // Una estudiante a la que le quedan cinco segundos de su hora del mes.
    await M.Medico.create({ phone: EST, nombre: "Ana Interna", passwordHash: hash, activo: true, estadoCuenta: "aprobada", tipoEspecialidad: "medicina_general",
      estudiante: { nivel: "interno", hasta: new Date(Date.now() + 90 * 86400000), horasMes: 1 } });
    const pacEst = await M.Paciente.create({ medicoPhone: EST, nombre: "Paciente de práctica" });
    await M.ConsultaMedica.create({ medicoPhone: EST, pacienteId: pacEst._id, estado: "completado", duracionSegundos: 3595 });

    let raizServidor = RAIZ;
    if (process.env.OFUSCADO) {
      raizServidor = copiaOfuscada = fs.mkdtempSync(path.join(os.tmpdir(), "symphomed-ofuscado-"));
      for (const x of fs.readdirSync(RAIZ)) {
        if (x === ".git") continue;
        if (x === "node_modules") fs.symlinkSync(path.join(RAIZ, x), path.join(raizServidor, x));
        else fs.cpSync(path.join(RAIZ, x), path.join(raizServidor, x), { recursive: true });
      }
      const r = spawnSync(process.execPath, [path.join(raizServidor, "scripts", "ofuscar.js")], { cwd: raizServidor, encoding: "utf8" });
      if (r.status !== 0) throw new Error("ofuscar falló:\n" + r.stdout + r.stderr);
      console.log("(con el JS ofuscado)");
    }
    // El servidor entero, con los tiempos de la vista previa achicados (en
    // producción revisa cada medio minuto) desde un archivo que se carga
    // antes. El del mismo árbol que el servidor: con el ofuscado, la copia.
    const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stub-vista-previa-")), "tiempos.js");
    fs.writeFileSync(stub, `Object.assign(require(${JSON.stringify(path.join(raizServidor, "services", "vistaPrevia"))}).AJUSTES, { CHEQUEO_MS: 200, TIC_MS: 100 });\n`);
    servidor = spawn(process.execPath, ["-r", stub, path.join(raizServidor, "index.js")], { cwd: raizServidor, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
    browser = await pw.chromium.launch({
      executablePath: navegador(),
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });

    const entrar = async (phone) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
      const page = await ctx.newPage();
      const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      // Lo que la política de seguridad bloquea sale en la consola.
      page.on("console", (m) => { if (/Content Security Policy|Refused to connect/i.test(m.text())) errores.push(m.text()); });
      await page.goto(`http://127.0.0.1:${PUERTO}/app`);
      await page.fill("#lPhone", phone);
      await page.fill("#lPass", CLAVE);
      await page.click("#lBtn");
      await page.waitForSelector("#avatarHomeBox", { timeout: 25000 });
      return { page, errores, ctx };
    };
    const ultimaDe = (phone) => M.VistaPrevia.findOne({ medicoPhone: phone }).sort({ inicio: -1 }).lean();

    console.log("── 1. Un médico graba: el audio va por Symphomed ──");
    const { page, errores, ctx } = await entrar(MED);
    await page.evaluate(([id, nombre]) => renderNuevaConsulta(id, nombre), [String(paciente._id), "Juana Pérez"]);
    await page.waitForSelector("#recBtn");
    await page.click("#recBtn");
    const llego = await hasta(() => conexiones.length === 1 && conexiones[0].bytes >= 32000);
    const aai = conexiones[0];
    verificar("el audio del micrófono llega a AssemblyAI, pasando por Symphomed", llego);
    verificar("  ...con la clave puesta por el servidor (la pantalla no la tiene)", aai?.auth === CLAVE_AAI);
    verificar("  ...y el idioma y el vocabulario de la cuenta", aai?.params.get("language_codes") === '["es"]' && aai.params.has("keyterms_prompt"));
    await page.waitForFunction(() => /me duele la garganta/.test(document.getElementById("liveCaption")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    verificar("el texto vuelve y se ve mientras se graba", /me duele la garganta/.test(await page.textContent("#liveCaption")));
    await esperar(1500);
    await page.click("#recBtn");
    await page.waitForSelector("#ncSubir", { state: "visible", timeout: 10000 });
    verificar("al terminar, AssemblyAI recibe Terminate y la conexión se cierra",
      await hasta(() => aai.textos.some(t => /Terminate/.test(t)) && aai.cerrada));
    await hasta(async () => (await ultimaDe(MED))?.fin);
    const doc = await ultimaDe(MED);
    verificar(`  ...y queda medida: ${doc?.segundos} s, cerrada desde la pantalla`, doc?.segundos >= 2 && doc.motivo === "navegador" && doc.segundosAssembly === 3);
    await page.click("#ncSubir");
    await hasta(async () => (await M.VistaPrevia.findById(doc._id).lean())?.consultaId);
    verificar("al subir la grabación, la vista previa queda enganchada a su consulta", !!(await M.VistaPrevia.findById(doc._id).lean())?.consultaId);
    verificar("sin errores de JavaScript ni de la política de seguridad", !errores.length);
    if (errores.length) console.log(errores.join("\n"));
    await ctx.close();

    console.log("\n── 2. A una estudiante se le terminan las horas mientras graba ──");
    const est = await entrar(EST);
    await est.page.evaluate(([id, nombre]) => renderNuevaConsulta(id, nombre), [String(pacEst._id), "Paciente de práctica"]);
    await est.page.waitForSelector("#recBtn");
    await est.page.click("#recBtn");
    await est.page.waitForFunction(() => /horas de audio/.test(document.getElementById("liveCaption")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
    const aviso = await est.page.textContent("#liveCaption");
    verificar("a los cinco segundos, la vista previa se corta y lo dice", /Vista previa en vivo: Usaste las 1 horas de audio/.test(aviso));
    verificar("  ...y que la grabación sigue", /La grabación sigue/.test(aviso));
    verificar("  ...y la grabación sigue de verdad", await est.page.evaluate(() => document.getElementById("recBtn").classList.contains("recording")));
    await esperar(1000);
    verificar("  ...sin que el aviso lo tape otro (el código del cierre)", /horas de audio/.test(await est.page.textContent("#liveCaption")));
    await hasta(async () => (await ultimaDe(EST))?.fin);
    const docEst = await ultimaDe(EST);
    verificar(`  ...anotada por tope (${docEst?.segundos} s)`, docEst?.motivo === "tope" && docEst.segundos >= 4);
    await est.page.click("#recBtn");
    await est.page.waitForSelector("#ncSubir", { state: "visible", timeout: 10000 });
    const subida = est.page.waitForResponse((r) => new URL(r.url()).pathname === "/medico/consultas" && r.request().method() === "POST", { timeout: 15000 });
    await est.page.click("#ncSubir");
    verificar("la grabación que empezó con horas se sube (202)", (await subida.catch(() => null))?.status() === 202);
    verificar("sin errores de JavaScript ni de la política de seguridad", !est.errores.length);
    if (est.errores.length) console.log(est.errores.join("\n"));
  } catch (e) {
    console.error(e);
    fallos++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill();
    servidorAAI.close();
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    if (copiaOfuscada) fs.rmSync(copiaOfuscada, { recursive: true, force: true });
    fs.rmSync(dirAudio, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
