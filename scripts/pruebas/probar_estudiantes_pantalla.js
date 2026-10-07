// Symphomed — La cuenta de estudiante en un navegador de verdad.
//
// Un estudiante entra con su código desde la pantalla de login, y ve un
// Symphomed simple: sus casos, grabar, su nota con la marca de estudiante.
// Sin agenda, sin teleconsulta ni compartir con el paciente, sin receta al
// confirmar, sin saldo. Si se quedó sin horas, se le dice ANTES de grabar.
// Con OFUSCADO=1 corre contra el JS ofuscado, como en producción.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3958;
const TEL = "59170050001";

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
const correr = (raiz, args, env) => new Promise((resolve) => {
  const h = spawn(process.execPath, [path.join(raiz, "scripts", "codigos_estudiante.js"), ...args], { cwd: raiz, env });
  let salida = ""; h.stdout.on("data", (d) => { salida += d; }); h.stderr.on("data", (d) => { salida += d; });
  h.on("exit", (codigo) => resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }));
});

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "estudiantes_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" };
  let servidor, browser, mongoose, copia = null;
  try {
    let raiz = RAIZ;
    if (process.env.OFUSCADO) {
      raiz = copia = fs.mkdtempSync(path.join(require("os").tmpdir(), "symphomed-ofuscado-"));
      for (const x of fs.readdirSync(RAIZ)) {
        if (x === ".git") continue;
        if (x === "node_modules") fs.symlinkSync(path.join(RAIZ, x), path.join(raiz, x));
        else fs.cpSync(path.join(RAIZ, x), path.join(raiz, x), { recursive: true });
      }
      const r = spawnSync(process.execPath, [path.join(raiz, "scripts", "ofuscar.js")], { cwd: raiz, encoding: "utf8" });
      if (r.status !== 0) throw new Error("ofuscar falló:\n" + r.stdout + r.stderr);
      console.log("(con el JS ofuscado)");
    }
    const cod = await correr(raiz, ["crear", "--nivel", "interno", "--meses", "6"], env);
    const codigo = (cod.salida.match(/EST-[A-Z0-9]{6}/) || [])[0];
    if (!codigo) throw new Error("no se creó el código:\n" + cod.salida);

    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));

    servidor = spawn(process.execPath, [path.join(raiz, "index.js")], { cwd: raiz, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
    browser = await pw.chromium.launch({ executablePath: navegador() });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));

    console.log("── 1. Entrar con el código, desde el login ──");
    await page.goto(`http://127.0.0.1:${PUERTO}/app`);
    await page.click("#lGoEstudiante");
    await page.fill("#eCodigo", codigo.toLowerCase());
    await page.fill("#eNombre", "Ana Interna");
    await page.fill("#ePhone", "+" + TEL);
    await page.fill("#eUniversidad", "Univalle");
    await page.fill("#ePass", "Prueba123.");
    await page.click("#eBtn");
    await page.waitForSelector("#avatarHomeBox", { timeout: 20000 });
    verificar("«Tengo un código de estudiante» → crea la cuenta y entra directo", true);
    await page.waitForSelector("#estAvisoInicio", { timeout: 10000 }).catch(() => {});
    const aviso = await page.locator("#estAvisoInicio").innerText().catch(() => "");
    verificar(`arriba dice el nivel, el vencimiento y las horas («${aviso.replace(/\s+/g, " ").trim()}»)`, /Interno/.test(aviso) && /vence/.test(aviso) && /0 de 12 horas/.test(aviso));
    verificar("sin la pestaña de agenda", !(await page.locator("#btnAgenda").count()));

    console.log("\n── 2. Su paciente y su nota ──");
    const pac = await M.Paciente.create({ medicoPhone: TEL, nombre: "Paciente de Ana", telefono: "59170000002" });
    const c = await M.ConsultaMedica.create({ medicoPhone: TEL, pacienteId: pac._id, pacienteNombre: pac.nombre, estado: "completado", deEstudiante: true,
      duracionSegundos: 600, transcripcionCompleta: "le doy amoxicilina quinientos y control en siete días", notaClinicaEstado: "completado",
      notaClinica: { motivoConsulta: "Faringitis", medicamentosRecetados: [{ nombre: "Amoxicilina", dosis: "500 mg" }],
        reconsultaSugerida: { fechaHora: new Date(Date.now() + 7 * 86400000), textoOriginal: "en siete días", estado: "pendiente" } } });
    await page.evaluate((id) => renderPacienteDetalle(id), String(pac._id));
    await page.waitForSelector("#btnNuevaConsulta", { timeout: 15000 });
    verificar("la ficha del paciente, sin teleconsulta ni compartir con el paciente", !(await page.locator(".kardex-mas").count()));
    await page.evaluate((id) => renderDetalle(id), String(c._id));
    await page.waitForSelector("#btnConfirmarConsulta", { timeout: 15000 });
    verificar("la nota lleva la marca «Nota de estudiante: sin validez sin la firma…»", /Nota de estudiante/.test(await page.innerText(".est-marca")));
    verificar("al confirmar no se ofrece receta ni reconsulta por WhatsApp", !(await page.locator("#cfReceta").count()) && !(await page.locator("#cfReconsulta").count()));
    verificar("  ...sí cargar la medicación a su caso", await page.locator("#cfMeds .cf-med").count() === 1);

    console.log("\n── 3. Grabar ──");
    await page.evaluate(([id, n]) => renderNuevaConsulta(id, n), [String(pac._id), pac.nombre]);
    await page.waitForSelector("#recBtn");
    await esperar(1500);
    verificar("con horas disponibles, el botón de grabar está activo", !(await page.isDisabled("#recBtn")));
    await M.ConsultaMedica.create({ medicoPhone: TEL, pacienteId: pac._id, estado: "completado", duracionSegundos: 12 * 3600 });
    await page.evaluate(([id, n]) => renderNuevaConsulta(id, n), [String(pac._id), pac.nombre]);
    await page.waitForFunction(() => document.getElementById("recBtn")?.disabled, null, { timeout: 10000 }).catch(() => {});
    verificar("sin horas del mes: se lo dice ANTES de grabar, y no deja empezar",
      await page.isDisabled("#recBtn") && /horas de audio/.test(await page.innerText("#recStatus")));

    console.log("\n── 4. En la compu ──");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${PUERTO}/app/pacientes`);
    await page.waitForSelector(".escr-nav-item", { timeout: 20000 });
    const menu = await page.$$eval(".escr-nav-item", (xs) => xs.map((x) => x.dataset.id));
    verificar(`el menú tiene solo inicio, pacientes, grabar y configuración (${menu.join(", ")})`, menu.join() === "inicio,pacientes,voz,configuracion");
    await page.evaluate(() => renderSeguridad());
    await esperar(1500);
    verificar("en configuración no aparece el saldo ni cargar saldo", !(await page.locator("#saldoBox").innerText().catch(() => "")).trim());

    console.log("\n── 5. Al salir, la próxima sesión no hereda nada ──");
    await page.evaluate(() => logout());
    verificar("se borra la marca de estudiante del navegador", await page.evaluate(() => localStorage.getItem("salud_estudiante") === null && !esCuentaEstudiante()));

    verificar("sin errores de JavaScript", !errores.length);
    if (errores.length) console.log(errores.join("\n"));
  } catch (e) {
    console.error(e);
    fallos++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill();
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    if (copia) fs.rmSync(copia, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
