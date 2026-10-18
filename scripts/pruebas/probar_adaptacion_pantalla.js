// Symphomed — «Así escribo yo» en un navegador de verdad.
//
// Lo que la IA aprendió de las correcciones de cada uno, en Configuración (el
// servidor, en probar_adaptacion.js). Lo que se prueba:
//   1. Se ve lo aprendido: de cuántas notas, sus abreviaturas, las frases que
//      no usa, su vocabulario y lo que corrigió (también un medicamento).
//   2. Elegir el largo se guarda solo, y queda elegido.
//   3. Agregar (con Enter o con el botón), sacar, y un error que se entiende.
//   4. Volver a empezar, con su pregunta antes.
//   5. En portugués, y en un celular sin nada que se salga de la pantalla.
//   6. Un plan en viñetas se lee con sus renglones.
//
// Con OFUSCADO=1 corre contra el JS ofuscado, que es el que se sirve en
// producción. Con CAPTURA=<carpeta> guarda cómo se ve.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3983;
const CLAVE = "Symphomed1234";
const MED = "70089101";
const MED_PT = "70089102";
const CONFIRMADA = "0123456789abcdef01234811";

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

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "adaptacion_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" };
  let servidor, browser, mongoose, copiaOfuscada = null;
  try {
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.create({ phone: MED, nombre: "Dra. Adaptada", passwordHash: await hashPassword(CLAVE), activo: true, idioma: "es" });
    await M.Medico.create({ phone: MED_PT, nombre: "Dra. Adaptada", passwordHash: await hashPassword(CLAVE), activo: true, idioma: "pt" });

    // Lo que corrigió en dos consultas de dos pacientes, como lo deja confirmar.
    for (const phone of [MED, MED_PT]) {
      const pacientes = await M.Paciente.create([{ medicoPhone: phone, nombre: "Juan Quispe" }, { medicoPhone: phone, nombre: "Ana Rojas" }]);
      for (const [i, p] of pacientes.entries()) {
        const c = await M.ConsultaMedica.create({ medicoPhone: phone, pacienteId: p._id, pacienteNombre: p.nombre, estado: "completado",
          notaClinicaEstado: "completado", confirmadaEn: new Date(), notaEditadaPorMedico: true,
          notaClinica: { motivoConsulta: "Palpitaciones", plan: "Pedimos Holter.", diagnostico: "Palpitaciones; HTA", examenesSolicitados: ["Perfil lipídico"] } });
        await M.CorreccionIA.create([
          { medicoPhone: phone, tipo: "nota", consultaId: c._id, campo: "motivoConsulta", valorSugerido: "Paciente refiere palpitaciones", valorFinal: "Palpitaciones" },
          { medicoPhone: phone, tipo: "nota", consultaId: c._id, campo: "plan", valorSugerido: "Pedimos jolter.", valorFinal: "Pedimos Holter." },
          { medicoPhone: phone, tipo: "nota", consultaId: c._id, campo: "diagnostico", valorSugerido: "Palpitaciones; hipertensión arterial", valorFinal: "Palpitaciones; HTA" },
        ]);
        if (i === 0) await M.CorreccionIA.create({ medicoPhone: phone, tipo: "medicamento", consultaId: c._id, campo: "nombre", valorSugerido: "Espironolactna", valorFinal: "Espironolactona" });
      }
    }

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

    async function entrar(telefono) {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      await page.goto(`http://127.0.0.1:${PUERTO}/app`);
      await page.fill("#lPhone", telefono);
      await page.fill("#lPass", CLAVE);
      await page.click("#lBtn");
      await page.waitForSelector("#avatarHomeBox", { timeout: 25000 });
      await page.evaluate(() => renderSeguridad());
      await page.waitForSelector(".adapt", { timeout: 15000 });
      return { page, errores };
    }
    const sinClaves = (texto) => !/\badapt\.[a-zA-Z_.]+/.test(texto);
    const tarjeta = (page) => page.$eval(".adapt", (x) => x.innerText);
    const chips = (page) => page.$$eval(".adapt-chip", (xs) => xs.map((x) => x.innerText.replace(/\s*×\s*$/, "").trim()));
    // Cada cambio repinta la tarjeta: se espera a que aparezca lo que tiene que aparecer.
    const hasta = async (page, condicion, arg) => { await page.waitForFunction(condicion, arg, { timeout: 15000 }).catch(() => {}); };

    const { page, errores } = await entrar(MED);
    console.log("── 1. Se ve lo aprendido ──");
    let texto = await tarjeta(page);
    verificar("la tarjeta «Así escribo yo», con de cuántas notas aprendió", /Así escribo yo/.test(texto) && /Aprendido de 2 notas confirmadas/.test(texto));
    verificar("sin ninguna clave sin traducir", sinClaves(await page.innerText("body")));
    let fichas = await chips(page);
    verificar(`sus abreviaturas, sus frases y su vocabulario (${fichas.join(" · ")})`, fichas.includes("HTA = hipertensión arterial")
      && fichas.includes("«Paciente refiere»") && fichas.includes("Holter") && fichas.includes("Perfil lipídico"));
    const corregido = await page.$$eval(".adapt-corr", (xs) => xs.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    verificar(`lo que corrigió, con cuántas veces, y el medicamento (${corregido.join(" | ")})`,
      corregido.some(x => /^jolter → Holter 2 veces/.test(x)) && corregido.some(x => /💊 Espironolactna → Espironolactona/.test(x)));
    verificar("el largo y las viñetas, en automático", (await page.inputValue("#adaptLargo")) === "" && (await page.inputValue("#adaptVinetas")) === "");
    if (process.env.CAPTURA) await page.locator(".adapt").screenshot({ path: path.join(process.env.CAPTURA, "asi_escribo_yo.png") });

    console.log("\n── 2. Elegir el largo ──");
    await page.selectOption("#adaptLargo", "breve");
    await hasta(page, () => /Guardado/.test(document.getElementById("adaptMsg")?.innerText || ""));
    verificar("elegirlo lo guarda solo, y lo dice", /Guardado/.test(await page.innerText("#adaptMsg")));
    // Guardar es un PATCH del propio médico, y el aviso de cambio que vuelve
    // a su navegador repintaba la pantalla anterior encima de Configuración.
    await esperar(3500);
    verificar("  ...y se queda en Configuración: el aviso de cambio no lo saca", Boolean(await page.$("#adaptLargo")) && !(await page.$("#avatarHomeBox")));
    await page.evaluate(() => pintarAdaptacion());
    await hasta(page, () => document.getElementById("adaptLargo")?.value === "breve");
    verificar("  ...y al volver a abrir sigue elegido", (await page.inputValue("#adaptLargo")) === "breve");

    console.log("\n── 3. Agregar y sacar ──");
    await page.fill("#adaptTermino", "Ecografía Doppler");
    await page.press("#adaptTermino", "Enter");
    await hasta(page, () => [...document.querySelectorAll(".adapt-chip")].some(x => /Ecografía Doppler/.test(x.innerText)));
    verificar("una palabra, con Enter", (await chips(page)).includes("Ecografía Doppler"));
    await page.fill("#adaptAbrevCorto", "IC");
    await page.fill("#adaptAbrevLargo", "insuficiencia cardíaca");
    await page.click("#adaptAbrevAgregar");
    await hasta(page, () => [...document.querySelectorAll(".adapt-chip")].some(x => /^IC = /.test(x.innerText)));
    verificar("una abreviatura, con el botón", (await chips(page)).includes("IC = insuficiencia cardíaca"));
    await page.fill("#adaptFrase", "<b>Se observa</b>");
    await page.click("#adaptFraseAgregar");
    await hasta(page, () => [...document.querySelectorAll(".adapt-chip")].some(x => /Se observa/.test(x.innerText)));
    const raro = await page.$$eval(".adapt-chip-texto", (xs) => xs.filter(x => /Se observa/.test(x.innerText)).map(x => ({ texto: x.innerText, negritas: x.querySelectorAll("b").length })));
    verificar(`lo que escribe se muestra como texto, nunca como HTML (${raro[0]?.texto})`, raro.length === 1 && raro[0].texto === "«<b>Se observa</b>»" && raro[0].negritas === 0);
    await page.click('.adapt-quitar[data-clave="par:jolter"]');
    await hasta(page, () => !document.querySelector('.adapt-quitar[data-clave="par:jolter"]'));
    verificar("sacar lo que corrigió", !(await page.$('.adapt-quitar[data-clave="par:jolter"]')));
    await page.click('.adapt-quitar[data-clave="frase:paciente refiere"]');
    await hasta(page, () => !document.querySelector('.adapt-quitar[data-clave="frase:paciente refiere"]'));
    verificar("sacar una frase", !(await chips(page)).includes("«Paciente refiere»"));
    await page.fill("#adaptTermino", "uno dos tres cuatro cinco seis siete");
    await page.click("#adaptTerminoAgregar");
    await hasta(page, () => !!document.querySelector("#adaptMsg .error"));
    verificar(`algo que no se puede, con un error que se entiende (${(await page.innerText("#adaptMsg")).trim()})`, /6 palabras/.test(await page.innerText("#adaptMsg")));
    const ancho = await page.evaluate(() => document.scrollingElement.scrollWidth);
    verificar(`en un celular, nada se sale de la pantalla (${ancho} px)`, ancho <= 390);

    console.log("\n── 4. Volver a empezar ──");
    let pregunta = "";
    page.once("dialog", (d) => { pregunta = d.message(); d.accept(); });
    await page.click("#adaptReiniciar");
    await hasta(page, () => /Todavía no aprendí nada/.test(document.querySelector(".adapt")?.innerText || ""));
    texto = await tarjeta(page);
    verificar("pregunta antes, y dice qué se borra", /Volver a empezar/.test(pregunta) && /Tus notas no se tocan/.test(pregunta));
    verificar("  ...y queda en cero", /Todavía no aprendí nada/.test(texto) && !(await chips(page)).length && !(await page.$(".adapt-corr"))
      && (await page.inputValue("#adaptLargo")) === "");
    verificar(`sin errores en la página${errores.length ? ": " + errores.join(" | ") : ""}`, errores.length === 0);

    console.log("\n── 5. En portugués ──");
    const pt = await entrar(MED_PT);
    const enPt = await tarjeta(pt.page);
    // Los títulos de cada parte van en mayúsculas (CSS), e innerText las respeta.
    verificar("«Assim eu escrevo», con lo aprendido", /Assim eu escrevo/.test(enPt) && /Aprendido de 2 notas confirmadas/.test(enPt) && /O que você corrigiu/i.test(enPt));
    verificar("  ...los botones en portugués", (await pt.page.innerText("#adaptTerminoAgregar")).trim() === "Adicionar" && /Começar de novo/.test(await pt.page.innerText("#adaptReiniciar")));
    verificar("  ...sin claves sin traducir", sinClaves(await pt.page.innerText("body")));
    verificar(`  ...sin errores en la página${pt.errores.length ? ": " + pt.errores.join(" | ") : ""}`, pt.errores.length === 0);

    console.log("\n── 6. Un plan en viñetas ──");
    await page.route(`**/medico/consultas/${CONFIRMADA}`, (r) => r.fulfill({ json: { consulta: {
      _id: CONFIRMADA, pacienteId: "0123456789abcdef01234800", pacienteNombre: "Juan Quispe", createdAt: new Date().toISOString(),
      estado: "completado", duracionSegundos: 300, notaFuente: "audio", notaClinicaEstado: "completado", confirmadaEn: new Date().toISOString(),
      notaClinica: { motivoConsulta: "Palpitaciones", plan: "- Holter de 24 horas\n- Control en 7 días" }, segmentos: [] } } }));
    await page.evaluate((id) => renderDetalle(id), CONFIRMADA);
    await page.waitForSelector(".nota-lineas", { timeout: 15000 });
    const plan = await page.$eval(".nota-lineas", (x) => ({ espacio: getComputedStyle(x).whiteSpace, alto: x.getBoundingClientRect().height, linea: parseFloat(getComputedStyle(x).lineHeight) }));
    verificar(`se lee con sus renglones (white-space: ${plan.espacio}, ${Math.round(plan.alto)} px)`, plan.espacio === "pre-line" && plan.alto > plan.linea * 1.5);
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
