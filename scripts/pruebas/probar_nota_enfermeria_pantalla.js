// Symphomed — La nota de enfermería en un navegador de verdad.
//
// La de las cuentas de enfermería: el proceso de atención —signos vitales,
// valoración por patrones funcionales, diagnósticos en formato PES, objetivos,
// intervenciones, evaluación y educación— en vez del motivo-diagnóstico-plan
// (el servidor, en probar_nota_enfermeria.js). Lo que se prueba:
//   1. El formulario: cada parte con lo que escribió la IA, los patrones con
//      su nombre y en orden, los diagnósticos numerados por prioridad, y nada
//      de la nota médica.
//   2. Agregar un patrón (entra en su lugar), quitar y agregar diagnósticos.
//   3. Al confirmar va la nota de enfermería tal como quedó en pantalla.
//   4. Confirmada se lee como texto: «r/c», «m/p», los patrones por nombre.
//   5. El borrador en vivo, y todo en portugués.
//
// Con OFUSCADO=1 corre contra el JS ofuscado, que es el que se sirve en
// producción. Con CAPTURA=<carpeta> guarda cómo se ve el formulario.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3971;
const CLAVE = "Symphomed1234";
const ENF = "70089001";
const ENF_PT = "70089002";
const CONSULTA = "0123456789abcdef01234611";
const CONFIRMADA = "0123456789abcdef01234612";

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

// Como la guarda el servidor (sanearNotaEnfermeria): patrones en orden, sin
// signos vacíos.
const NOTA = {
  formato: "enfermeria",
  motivoConsulta: "Fiebre de dos días",
  valoracion: [
    { patron: "nutricional", hallazgos: "Inapetencia, mucosas secas" },
    { patron: "actividad", hallazgos: "Deambula sin ayuda" },
    { patron: "sueno", hallazgos: "Duerme poco por la fiebre" },
  ],
  signosVitales: { PA: "110/70 mmHg", FC: "98 lpm", T: "38,6 °C" },
  diagnosticosEnfermeria: [
    { problema: "Hipertermia", etiologia: "proceso infeccioso", signos: "T 38,6 °C, piel caliente" },
    { problema: "Riesgo de déficit de volumen de líquidos", etiologia: "fiebre e ingesta escasa", signos: "" },
  ],
  objetivos: ["Temperatura menor a 37,5 °C en 4 horas"],
  intervenciones: ["Control de temperatura cada 2 horas", "Compresas tibias"],
  educacion: "Se explicó a la madre cómo controlar la temperatura",
};
const consulta = (id, extra = {}) => ({
  _id: id, pacienteId: "0123456789abcdef01234600", pacienteNombre: "Tomás Choque", createdAt: new Date().toISOString(),
  estado: "completado", duracionSegundos: 300, notaFuente: "audio", notaClinicaEstado: "completado", notaClinica: NOTA,
  segmentos: [{ hablante: "A", texto: "Tiene fiebre desde hace dos días." }], ...extra,
});

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "nota_enfermeria_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" };
  let servidor, browser, mongoose, copiaOfuscada = null;
  try {
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.create({ phone: ENF, nombre: "Ana Enfermera", passwordHash: await hashPassword(CLAVE), activo: true, tipoEspecialidad: "enfermeria", idioma: "es" });
    await M.Medico.create({ phone: ENF_PT, nombre: "Ana Enfermeira", passwordHash: await hashPassword(CLAVE), activo: true, tipoEspecialidad: "enfermeria", idioma: "pt" });

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
      await page.route(`**/medico/consultas/${CONSULTA}`, (r) => r.fulfill({ json: { consulta: consulta(CONSULTA) } }));
      await page.route(`**/medico/consultas/${CONFIRMADA}`, (r) => r.fulfill({ json: { consulta: consulta(CONFIRMADA, {
        confirmadaEn: new Date().toISOString(), notaEditadaPorMedico: true,
      }) } }));
      await page.goto(`http://127.0.0.1:${PUERTO}/app`);
      await page.fill("#lPhone", telefono);
      await page.fill("#lPass", CLAVE);
      await page.click("#lBtn");
      await page.waitForSelector("#avatarHomeBox", { timeout: 25000 });
      return { page, errores };
    }
    const sinClaves = (texto) => !/\bnota\.enf\.[a-zA-Z_.]+/.test(texto);

    // Una consulta de enfermería guardada, para la lista del Kardex.
    const pacienteEnf = await M.Paciente.create({ medicoPhone: ENF, nombre: "Tomás Choque" });
    await M.ConsultaMedica.create({ medicoPhone: ENF, pacienteId: pacienteEnf._id, pacienteNombre: "Tomás Choque", estado: "completado",
      notaClinicaEstado: "completado", notaClinica: NOTA, confirmadaEn: new Date() });

    const { page, errores } = await entrar(ENF);
    let confirmado = null;
    await page.route(`**/medico/consultas/${CONSULTA}/confirmar`, (r) => {
      confirmado = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ json: { ok: true, aplicado: [], fallado: [] } });
    });
    await page.evaluate((id) => renderDetalle(id), CONSULTA);
    await page.waitForSelector("#btnConfirmarConsulta", { timeout: 15000 });

    console.log("── 1. El formulario ──");
    const tarjeta = await page.$eval("#nfeValoracion", (x) => x.closest(".card").innerText);
    verificar("se titula como nota de enfermería", /Nota de enfermería generada por IA/.test(tarjeta));
    verificar("sin ninguna clave sin traducir", sinClaves(await page.innerText("body")));
    verificar("nada de la nota médica (diagnóstico, plan, medicamentos)",
      !(await page.$("#nfDiagnostico")) && !(await page.$("#nfPlan")) && !(await page.$("#nfMeds")));
    verificar("el motivo, en su campo", (await page.inputValue("#nfMotivo")) === "Fiebre de dos días");
    verificar("una nota con contenido no se marca como vacía", !(await page.$("#btnRegenerarNota")));
    const vacias = await page.evaluate(() => [
      notaClinicaVaciaCliente({ formato: "enfermeria", signosVitales: { PA: "120/80" } }),
      notaClinicaVaciaCliente({ formato: "enfermeria", valoracion: [{ patron: "sueno", hallazgos: "Insomnio" }] }),
      notaClinicaVaciaCliente({ formato: "enfermeria", signosVitales: {}, valoracion: [] }),
    ]);
    verificar(`  ...ni una que solo tiene signos vitales o valoración; una sin nada, sí (${vacias.join(", ")})`,
      vacias.join(",") === "false,false,true");
    const signos = await page.$$eval(".nfe-sv", (xs) => xs.map((x) => ({ k: x.dataset.k, v: x.value, ph: x.placeholder })));
    verificar(`los siete signos vitales, con lo que se dijo (${signos.filter(s => s.v).map(s => s.k).join(", ")})`,
      signos.length === 7 && signos.find(s => s.k === "T")?.v === "38,6 °C" && signos.find(s => s.k === "FR")?.v === "");
    verificar("  ...y la unidad como pista en los vacíos", signos.find(s => s.k === "FR")?.ph === "rpm" && signos.find(s => s.k === "dolor")?.ph === "0 a 10");
    const patrones = () => page.$$eval(".nfe-val-fila", (xs) => xs.map((x) => ({ p: x.dataset.patron, nombre: x.querySelector("label").innerText, v: x.querySelector("textarea").value })));
    let filas = await patrones();
    verificar(`los patrones valorados, con su nombre (${filas.map(f => f.nombre).join(" · ")})`,
      filas.map(f => f.p).join(",") === "nutricional,actividad,sueno" && filas[0].nombre === "Nutricional-metabólico" && filas[2].nombre === "Sueño-descanso");
    verificar("  ...y los que faltan, para agregar", (await page.$$eval("#nfePatronNuevo option", (xs) => xs.length)) === 9);
    const dx = () => page.$$eval(".nfe-dx", (xs) => xs.map((x) => ({
      n: x.querySelector(".nfe-dx-num").innerText, problema: x.querySelector(".nfe-dx-problema").value,
      etiologia: x.querySelector(".nfe-dx-etiologia").value, signos: x.querySelector(".nfe-dx-signos").value,
    })));
    let diagnosticos = await dx();
    verificar(`los diagnósticos PES, numerados por prioridad (${diagnosticos.map(d => d.n + " " + d.problema).join(" · ")})`,
      diagnosticos.length === 2 && diagnosticos[0].n === "1" && diagnosticos[0].problema === "Hipertermia" && diagnosticos[0].etiologia === "proceso infeccioso");
    verificar("las intervenciones, una por línea", (await page.inputValue("#nfeIntervenciones")) === "Control de temperatura cada 2 horas\nCompresas tibias");
    if (process.env.CAPTURA) await page.screenshot({ path: path.join(process.env.CAPTURA, "nota_enfermeria.png"), fullPage: true });

    console.log("\n── 2. Agregar un patrón, quitar y agregar diagnósticos ──");
    await page.selectOption("#nfePatronNuevo", "eliminacion");
    filas = await patrones();
    verificar(`el patrón agregado entra en su lugar (${filas.map(f => f.p).join(", ")})`, filas.map(f => f.p).join(",") === "nutricional,eliminacion,actividad,sueno");
    verificar("  ...con el cursor en su texto, y ya no se ofrece", (await page.evaluate(() => document.activeElement?.id)) === "nfeVal_eliminacion"
      && (await page.$$eval("#nfePatronNuevo option", (xs) => xs.length)) === 8);
    await page.fill("#nfeVal_eliminacion", "Orina concentrada");
    await page.fill("#nfeVal_actividad", "");
    await page.click(".nfe-dx:nth-child(1) .nfe-dx-quitar");
    diagnosticos = await dx();
    verificar(`al quitar el primero, el que sigue pasa a ser el 1 (${diagnosticos.map(d => d.n + " " + d.problema).join(" · ")})`,
      diagnosticos.length === 1 && diagnosticos[0].n === "1" && /^Riesgo de déficit/.test(diagnosticos[0].problema));
    await page.click("#nfeAgregarDx");
    diagnosticos = await dx();
    verificar(`se agrega uno vacío, con su número (${diagnosticos.map(d => d.n + " " + (d.problema || "—")).join(" · ")})`,
      diagnosticos.length === 2 && diagnosticos[1].n === "2" && diagnosticos[1].problema === ""
      && (await page.evaluate(() => document.activeElement?.classList.contains("nfe-dx-problema"))));
    await page.fill(".nfe-dx:nth-child(2) .nfe-dx-problema", "Riesgo de caídas");
    await page.fill(".nfe-dx:nth-child(2) .nfe-dx-etiologia", "debilidad por la fiebre");
    await page.fill(".nfe-dx:nth-child(1) .nfe-dx-etiologia", "fiebre y poca ingesta de líquidos");
    await page.fill("#nfeSv_FR", "24");
    await page.fill("#nfeIntervenciones", "Control de temperatura cada 2 horas\nCompresas tibias\n- Registrar diuresis\n\n");

    console.log("\n── 3. Al confirmar va la nota como quedó ──");
    await page.click("#btnConfirmarConsulta");
    for (let i = 0; i < 50 && !confirmado; i++) await esperar(100);
    const nota = confirmado?.nota || {};
    verificar(`los patrones como están en pantalla (${(nota.valoracion || []).map(v => `${v.patron}:${v.hallazgos ? "sí" : "vacío"}`).join(", ")})`,
      (nota.valoracion || []).map(v => v.patron).join(",") === "nutricional,eliminacion,actividad,sueno"
      && nota.valoracion[1].hallazgos === "Orina concentrada" && nota.valoracion[2].hallazgos === "");
    verificar("los diagnósticos corregidos, en su orden",
      nota.diagnosticosEnfermeria?.length === 2 && /^Riesgo de déficit/.test(nota.diagnosticosEnfermeria[0].problema)
      && nota.diagnosticosEnfermeria[0].etiologia === "fiebre y poca ingesta de líquidos"
      && nota.diagnosticosEnfermeria[1].problema === "Riesgo de caídas" && nota.diagnosticosEnfermeria[1].signos === "");
    verificar(`las intervenciones sin la viñeta ni líneas vacías (${JSON.stringify(nota.intervenciones)})`,
      JSON.stringify(nota.intervenciones) === JSON.stringify(["Control de temperatura cada 2 horas", "Compresas tibias", "Registrar diuresis"]));
    verificar("los signos vitales, todos con su clave", nota.signosVitales?.FR === "24" && nota.signosVitales?.PA === "110/70 mmHg" && Object.keys(nota.signosVitales).length === 7);
    verificar("el motivo y la educación, igual", nota.motivoConsulta === "Fiebre de dos días" && /madre/.test(nota.educacion || ""));
    verificar("nada de la nota médica", !("diagnostico" in nota) && !("medicamentosRecetados" in nota) && !("plan" in nota));
    verificar("y nada para cargar al Kardex", JSON.stringify(confirmado?.aplicar?.medicamentos) === "[]" && confirmado?.aplicar?.receta === false);

    console.log("\n── 4. Confirmada, se lee como texto ──");
    await page.evaluate((id) => renderDetalle(id), CONFIRMADA);
    await page.waitForSelector(".nfe-lista", { timeout: 15000 });
    const leida = await page.$eval(".nfe-lista", (x) => x.closest(".card").innerText);
    verificar("el título, corregida y confirmada", /Nota de enfermería \(corregida por vos\)/.test(leida) && /Consulta confirmada/.test(leida));
    verificar("los signos vitales en una línea", /PA 110\/70 mmHg · FC 98 lpm · T° 38,6 °C/.test(leida));
    verificar("los patrones por su nombre", /Nutricional-metabólico: Inapetencia/.test(leida) && /Sueño-descanso: Duerme poco/.test(leida));
    verificar("el diagnóstico PES con «r/c» y «m/p»", /Hipertermia r\/c proceso infeccioso m\/p T 38,6 °C, piel caliente/.test(leida));
    verificar("  ...y el que no tiene signos, sin «m/p» colgando", /Riesgo de déficit de volumen de líquidos r\/c fiebre e ingesta escasa(\n|$)/.test(leida));
    verificar("sin campos para editar", !(await page.$("#nfeValoracion")) && !(await page.$("#btnConfirmarConsulta")));

    console.log("\n── 5. La lista del Kardex, el borrador en vivo y en portugués ──");
    await page.evaluate((id) => renderPacienteDetalle(id, "consultas"), String(pacienteEnf._id));
    await page.waitForSelector(".item .preview", { timeout: 15000 });
    const lista = await page.$$eval(".item .preview", (xs) => xs.map((x) => x.innerText).join(" | "));
    verificar(`la lista del Kardex muestra el motivo y el diagnóstico prioritario (${lista})`, /Fiebre de dos días/.test(lista) && /Hipertermia/.test(lista));
    const vivo = await page.evaluate((n) => notaEnVivoHtml("vivo", n), NOTA);
    verificar("el borrador en vivo muestra la nota de enfermería", /Diagnósticos de enfermería/.test(vivo) && /Hipertermia/.test(vivo) && sinClaves(vivo));
    verificar(`sin errores en la página${errores.length ? ": " + errores.join(" | ") : ""}`, errores.length === 0);

    const pt = await entrar(ENF_PT);
    await pt.page.evaluate((id) => renderDetalle(id), CONSULTA);
    await pt.page.waitForSelector("#btnConfirmarConsulta", { timeout: 15000 });
    const enPt = await pt.page.innerText("body");
    verificar("en portugués: «Nota de enfermagem», «Coleta de dados», «Evidenciado por»",
      /Nota de enfermagem gerada por IA/.test(enPt) && /COLETA DE DADOS POR PADRÕES FUNCIONAIS/i.test(enPt) && /Evidenciado por/.test(enPt));
    verificar("  ...los patrones en portugués", /Sono e repouso/.test(enPt) && /Atividade e exercício/.test(enPt));
    verificar("  ...sin claves sin traducir", sinClaves(enPt));
    verificar(`  ...sin errores en la página${pt.errores.length ? ": " + pt.errores.join(" | ") : ""}`, pt.errores.length === 0);
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
