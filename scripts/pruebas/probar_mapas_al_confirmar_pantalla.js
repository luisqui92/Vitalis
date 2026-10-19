// Symphomed — Los hallazgos para el mapa, en el panel de confirmar, en un
// navegador de verdad.
//
// La IA escribe la nota con lo que entendió para el odontograma, el mapa
// ocular o el ginecológico. Eso ya no se carga solo: aparece en «Qué aplicar
// al confirmar», marcado, con lo que se dijo, y se manda lo que el médico
// deja marcado (revisión integral del 11 de octubre de 2026, S05; el
// servidor, en probar_mapas_al_confirmar.js). Lo que se prueba:
//   · cada hallazgo es una fila con su casilla, en palabras (no la clave);
//   · al confirmar va el número de cada fila marcada, y las desmarcadas no;
//   · las listas de la nota se cortan por coma, pero no por la coma decimal:
//     «fiebre de 38,5 °C» es un síntoma, no dos.
//
// Con OFUSCADO=1 corre contra el JS ofuscado, que es el que se sirve en
// producción.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3967;
const CLAVE = "Symphomed1234";
const MED = "70042001";
const CONSULTA = "0123456789abcdef01234599";

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

const NOTA = {
  motivoConsulta: "Control", diagnostico: "Caries", plan: "Obturar",
  sintomas: ["fiebre de 38,5 °C", "dolor al masticar"], diagnosticosDiferenciales: ["Pulpitis", "Absceso"],
  medicamentosRecetados: [],
  odontogramaSugerido: [
    { piezaFdi: 36, estado: "caries", hallazgo: "la 36 tiene caries" },
    { piezaFdi: 18, estado: "extraccion_indicada", hallazgo: "la 18 hay que sacarla" },
  ],
  examenOcularSugerido: [{ ojo: "OD", estructura: "cristalino", hallazgo: "opacidad cortical leve", estado: "leve" }],
  ginecoSugerido: [{ organo: "utero", hallazgo: "mioma", detalle: "mioma de cuatro centímetros" }],
};

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "mapas_al_confirmar_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" };
  let servidor, browser, mongoose, copiaOfuscada = null;
  try {
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.create({ phone: MED, nombre: "Dra. Mapas", passwordHash: await hashPassword(CLAVE), activo: true, tipoEspecialidad: "odontologia" });
    const paciente = await M.Paciente.create({ medicoPhone: MED, nombre: "Rosa Mamani" });

    // Una copia del proyecto con public/js ofuscado: el original no se toca.
    let raizServidor = RAIZ;
    if (process.env.OFUSCADO) {
      raizServidor = copiaOfuscada = fs.mkdtempSync(path.join(require("os").tmpdir(), "symphomed-ofuscado-"));
      for (const x of fs.readdirSync(RAIZ)) {
        if (x === ".git") continue;
        if (x === "node_modules") fs.symlinkSync(path.join(RAIZ, x), path.join(raizServidor, x));
        else fs.cpSync(path.join(RAIZ, x), path.join(raizServidor, x), { recursive: true });
      }
      const r = require("child_process").spawnSync(process.execPath, [path.join(raizServidor, "scripts", "ofuscar.js")], { cwd: raizServidor, encoding: "utf8" });
      if (r.status !== 0) throw new Error("ofuscar falló:\n" + r.stdout + r.stderr);
      console.log("(con el JS ofuscado)");
    }
    servidor = spawn(process.execPath, [path.join(raizServidor, "index.js")], { cwd: raizServidor, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
    browser = await pw.chromium.launch({ executablePath: navegador() });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));

    await page.route(`**/medico/consultas/${CONSULTA}`, (r) => r.fulfill({ json: { consulta: {
      _id: CONSULTA, pacienteId: String(paciente._id), pacienteNombre: "Rosa Mamani", createdAt: new Date().toISOString(),
      estado: "completado", duracionSegundos: 60, notaFuente: "audio", notaClinicaEstado: "completado", notaClinica: NOTA,
      segmentos: [{ hablante: "A", texto: "La 36 tiene caries." }],
    } } }));
    let confirmado = null;
    await page.route(`**/medico/consultas/${CONSULTA}/confirmar`, (r) => {
      confirmado = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ json: { ok: true, aplicado: [], fallado: [] } });
    });

    await page.goto(`http://127.0.0.1:${PUERTO}/app`);
    await page.fill("#lPhone", MED);
    await page.fill("#lPass", CLAVE);
    await page.click("#lBtn");
    await page.waitForSelector("#avatarHomeBox", { timeout: 25000 });
    await page.evaluate((id) => renderDetalle(id), CONSULTA);
    await page.waitForSelector("#btnConfirmarConsulta", { timeout: 15000 });

    console.log("── 1. Cada hallazgo, una fila marcada y en palabras ──");
    const filas = await page.$$eval(".cf-odonto, .cf-ojo, .cf-gineco", (xs) => xs.map((x) => ({
      clase: x.className, i: x.dataset.i, marcado: x.checked, texto: x.closest(".conf-fila").innerText,
    })));
    const de = (clase) => filas.filter((f) => f.clase === clase);
    verificar(`dos filas del odontograma, una del ojo y una de gineco (${filas.length})`, de("cf-odonto").length === 2 && de("cf-ojo").length === 1 && de("cf-gineco").length === 1);
    verificar("  ...todas marcadas de entrada", filas.every((f) => f.marcado));
    verificar("la pieza en palabras: «pieza 36, Caries», con lo que se dijo", /pieza 36, Caries/.test(de("cf-odonto")[0]?.texto) && /la 36 tiene caries/.test(de("cf-odonto")[0]?.texto));
    verificar("  ...y la 18: «Extracción indicada»", /pieza 18, Extracción indicada/.test(de("cf-odonto")[1]?.texto));
    verificar("el ojo: «OD, Cristalino: Alteración leve»", /OD, Cristalino: Alteración leve/.test(de("cf-ojo")[0]?.texto));
    verificar("gineco: «Útero, Mioma», con el detalle", /Útero, Mioma/.test(de("cf-gineco")[0]?.texto) && /cuatro centímetros/.test(de("cf-gineco")[0]?.texto));
    verificar("ninguna fila muestra una clave sin traducir", !filas.some((f) => /\b(pieza|estruct|estOcu|organo|hall|confirmar)\.[a-z_]+/.test(f.texto)));

    console.log("\n── 2. Al confirmar va lo marcado ──");
    await page.uncheck(".cf-odonto[data-i='1']");
    await page.uncheck(".cf-ojo[data-i='0']");
    await page.click("#btnConfirmarConsulta");
    for (let i = 0; i < 50 && !confirmado; i++) await esperar(100);
    const a = confirmado?.aplicar || {};
    verificar(`odontograma: solo la 36 (${JSON.stringify(a.odontograma)})`, JSON.stringify(a.odontograma) === "[0]");
    verificar(`mapa ocular: nada, se desmarcó (${JSON.stringify(a.examenOcular)})`, JSON.stringify(a.examenOcular) === "[]");
    verificar(`gineco: el útero (${JSON.stringify(a.gineco)})`, JSON.stringify(a.gineco) === "[0]");
    const notaMandada = confirmado?.nota || {};
    verificar(`la coma decimal no parte un síntoma (${JSON.stringify(notaMandada.sintomas)})`,
      JSON.stringify(notaMandada.sintomas) === JSON.stringify(["fiebre de 38,5 °C", "dolor al masticar"]));
    verificar(`  ...y la coma de la lista sí separa (${JSON.stringify(notaMandada.diagnosticosDiferenciales)})`,
      JSON.stringify(notaMandada.diagnosticosDiferenciales) === JSON.stringify(["Pulpitis", "Absceso"]));
    await page.waitForLoadState("networkidle");
    verificar(`sin errores en la página${errores.length ? ": " + errores.join(" | ") : ""}`, errores.length === 0);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill("SIGKILL");
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    if (copiaOfuscada) fs.rmSync(copiaOfuscada, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
