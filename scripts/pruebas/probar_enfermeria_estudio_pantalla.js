// Symphomed — Estudiar enfermería, en un navegador de verdad.
//
// Contra el servidor de verdad (index.js), con la IA apuntada a una de
// mentira que corre acá (OPENAI_URL, ver services/ia.js), como
// probar_estudio_ia_pantalla.js con medicina. Lo que se mira, con una cuenta
// de estudiante de enfermería:
//   1. El paciente virtual de enfermería: sus áreas, el diagnóstico médico a
//      la vista desde el principio, «Valorar» y «Escalas y datos» con lo suyo,
//      y una evaluación que mira también las intervenciones.
//   2. Los simulacros de enfermería: sus áreas y su presentación.
//   3. El tutor: «te falta valorar», el razonamiento con diagnósticos de
//      enfermería y las preguntas de sus tarjetas.
//   4. En portugués.
// Con OFUSCADO=1 corre contra el JS ofuscado, como en producción.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3977;
const PUERTO_IA = 3978;
const TEL = "59170099101";
const TEL_PT = "5511970099102";

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

// ─── La IA de mentira ──────────────────────────────────────────────────────
const CASO = {
  paciente: { nombre: "Rosa Choque", edad: 72, sexo: "Femenino", ocupacion: "jubilada" },
  quienHabla: "el paciente", lugar: "internacion", diagnosticoMedico: "Neumonía adquirida en la comunidad",
  motivo: "Me cuesta respirar, señorita, y estoy muy cansada.",
  personalidad: "cansada y colaboradora",
  historia: ["Tose con flema amarilla desde hace 4 días", "Se cansa al ir al baño", "Come poco y toma poca agua", "Duerme sentada porque acostada le falta el aire"],
  antecedentes: { personales: ["Hipertensión"], familiares: [], medicamentos: ["Enalapril"], alergias: [], habitos: [], ginecoObstetricos: [] },
  negativos: ["dolor de pecho"],
  signosVitales: { PA: "130/80 mmHg", FC: "104 lpm", FR: "26 rpm", T: "38,4 °C", SatO2: "89 %" },
  examenFisico: [{ region: "Respiración", hallazgo: "Tiraje intercostal, crepitantes en base derecha" }],
  estudios: [{ nombre: "Escala de Braden", resultado: "15 puntos" }],
  diagnostico: "Deterioro del intercambio gaseoso",
  diferenciales: [{ diagnostico: "Intolerancia a la actividad", porQueNo: "Es secundaria a la hipoxemia" }, { diagnostico: "Riesgo de caídas", porQueNo: "No es lo que amenaza la vida" }],
  preguntasClave: ["¿Le falta el aire?", "¿Desde cuándo tose?", "¿Cómo duerme?", "¿Cuánto toma de agua?", "¿Se cansa al moverse?", "¿Tiene dolor?"],
  banderasRojas: ["Saturación menor a 90 %", "Confusión"],
  estudiosPertinentes: ["Oximetría", "Escala de Braden"],
  intervencionesClave: ["Posición semisentada", "Oxigenoterapia según indicación", "Control de saturación"],
  perla: "Con saturación baja, lo primero es la oxigenación.",
};
function iaDeMentira(cuerpo) {
  const sistema = cuerpo.messages[0].content;
  const ultimo = cuerpo.messages[cuerpo.messages.length - 1]?.content || "";
  if (/valoración de enfermería con un paciente simulado/.test(sistema) && /Armá UN caso nuevo/.test(sistema)) return CASO;
  if (/licenciado en enfermería\. Te paso un caso completo/.test(sistema)) {
    const opciones = [...ultimo.matchAll(/^(\d+)\. (.+)$/gm)].map(m => m[2]);
    return { opcion: opciones.indexOf(CASO.diagnostico) };
  }
  if (/práctica de valoración de enfermería para estudiantes de enfermería/.test(sistema)) return { texto: "Me falta el aire, señorita, sobre todo acostada." };
  if (/el estudiante valora al paciente/.test(sistema)) return { hallazgo: "Tiraje intercostal; crepitantes en base derecha." };
  if (/aplica una escala de valoración/.test(sistema)) return { resultado: "Braden: 15 puntos (riesgo moderado)." };
  if (/docente de enfermería que evalúa la práctica/.test(sistema)) {
    return {
      preguntasClave: CASO.preguntasClave.map((_, i) => ({ hecha: i < 3 })), banderasRojas: [{ explorada: true }, { explorada: false }],
      estudios: { pertinentes: ["Escala de Braden"], faltaron: ["Oximetría"], innecesarios: [] },
      diagnostico: { acerto: true, comentario: "Priorizaste la oxigenación." },
      diferenciales: { considero: ["Intolerancia a la actividad"], faltaron: ["Riesgo de caídas"] },
      intervenciones: { adecuadas: ["Posición semisentada"], faltaron: ["Control de saturación"], inadecuadas: ["Caminar por el pasillo"] },
      comunicacion: { bien: ["Te presentaste"], mejorar: ["Explicar antes de valorar"] },
      comentario: "Buena valoración; te faltó controlar la saturación.",
    };
  }
  throw new Error("pedido inesperado: " + sistema.slice(0, 80));
}
const servidorIa = http.createServer((req, res) => {
  let datos = "";
  req.on("data", (c) => { datos += c; });
  req.on("end", () => {
    try {
      const cuerpo = JSON.parse(datos);
      const r = iaDeMentira(cuerpo);
      const contenido = "texto" in r && !cuerpo.response_format ? r.texto : JSON.stringify(r);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: contenido } }] }));
    } catch (e) {
      res.writeHead(500); res.end(String(e.message));
    }
  });
});

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  await new Promise((r) => servidorIa.listen(PUERTO_IA, "127.0.0.1", r));
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "enfermeria_estudio_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba",
    OPENAI_URL: `http://127.0.0.1:${PUERTO_IA}/v1/chat/completions` };
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
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    const hasta = new Date(Date.now() + 180 * 86400000);
    for (const [phone, idioma] of [[TEL, "es"], [TEL_PT, "pt"]]) {
      await M.Medico.create({ phone, nombre: "Ana Enfermera", passwordHash: await hashPassword("Prueba123."), activo: true, idioma,
        tipoEspecialidad: "enfermeria", estudiante: { nivel: "estudiante", hasta, horasMes: 6, carrera: "enfermeria" } });
    }

    servidor = spawn(process.execPath, [path.join(raiz, "index.js")], { cwd: raiz, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
    browser = await pw.chromium.launch({ executablePath: navegador() });

    async function entrar(telefono) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/La_Paz" });
      const page = await ctx.newPage();
      const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto(`http://127.0.0.1:${PUERTO}/app`);
      await page.fill("#lPhone", telefono);
      await page.fill("#lPass", "Prueba123.");
      await page.click("#lBtn");
      await page.waitForSelector("#btnEstudiar", { timeout: 20000 });
      return { page, errores };
    }
    const sinClaves = (texto) => !/\b(pv|tutor|sim|estudio)\.(enf|pregEnf)\.[a-zA-Z.]+/.test(texto);
    const captura = async (page, nombre) => { if (process.env.CAPTURAS) await page.screenshot({ path: path.join(process.env.CAPTURAS, nombre), fullPage: true }); };
    const { page, errores } = await entrar(TEL);

    console.log("── 1. El paciente virtual de enfermería ──");
    await page.click("#btnEstudiar");
    await page.waitForSelector(".est-pestanas", { timeout: 15000 });
    await page.click('.est-pestana[data-pestana="paciente"]');
    await page.waitForSelector("#pvEmpezar", { timeout: 15000 });
    const areas = await page.$$eval("#pvAreas .est-chip", (xs) => xs.map(x => x.dataset.valor));
    verificar(`sus áreas son las de enfermería (${areas.join(", ")})`, areas[0] === "cualquiera" && areas.slice(1).every(a => a.startsWith("enf_")) && areas.includes("enf_geriatria"));
    verificar("  ...con su nombre en pantalla", /Geriatría|Hospitalización/i.test(await page.innerText("#pvAreas")));
    verificar("la presentación habla de valorar y de intervenciones", /valoración de enfermería/.test(await page.innerText(".pv-portada")) && /intervenciones/.test(await page.innerText(".pv-portada")));
    await page.click('#pvAreas .est-chip[data-valor="enf_hospitalizacion"]');
    await page.click('#pvDificultades .est-chip[data-valor="intermedio"]');
    verificar("  ...y la dificultad, en términos de cuidado", /priorizar/.test(await page.innerText("#pvDificultadAyuda")));
    await page.click("#pvEmpezar");
    await page.waitForSelector("#pvChat", { timeout: 30000 });
    const cabecera = await page.innerText(".pv-cabecera");
    verificar("aparece la paciente, en internación, con su diagnóstico médico a la vista",
      /Rosa Choque/.test(cabecera) && /En internación/.test(cabecera) && /Diagnóstico médico: Neumonía adquirida en la comunidad/.test(cabecera));
    verificar("  ...y no el diagnóstico de enfermería", !/intercambio gaseoso/.test(await page.innerText("body")));
    verificar("los botones son «Valorar» y «Escalas y datos»", /Valorar/.test(await page.innerText("#pvExaminar")) && /Escalas y datos/.test(await page.innerText("#pvPedir")));
    await page.fill("#pvTexto", "Hola, soy Ana, estudiante de enfermería. ¿Le falta el aire?");
    await page.click("#pvEnviar");
    await page.waitForFunction(() => document.querySelectorAll("#pvMensajes .pv-pac:not(.pv-escribiendo)").length >= 2, null, { timeout: 15000 });
    verificar("preguntar → la paciente contesta", /Me falta el aire/.test(await page.innerText("#pvMensajes")));
    await page.click("#pvExaminar");
    const valorar = await page.$$eval(".pv-pedido", (xs) => xs.map(x => x.dataset.texto));
    verificar(`«Valorar» ofrece lo de enfermería (${valorar.slice(0, 4).join(", ")}…)`, valorar.includes("Respiración") && valorar.includes("Eliminación urinaria e intestinal") && valorar.includes("Dolor"));
    await page.click('.pv-pedido[data-texto="Respiración"]');
    await page.waitForFunction(() => document.querySelectorAll("#pvMensajes .pv-sis").length >= 1, null, { timeout: 15000 });
    const mensajes = await page.innerText("#pvMensajes");
    // Los rótulos van en mayúsculas (.pv-tipo): se compara sin mirar eso.
    verificar("valorar la respiración → «Valorás:» y el hallazgo como «Valoración»", /Valorás:/i.test(mensajes) && /Valoración/i.test(mensajes) && /Tiraje/.test(mensajes));
    await page.click("#pvPedir");
    const escalas = await page.$$eval(".pv-pedido", (xs) => xs.map(x => x.dataset.texto));
    verificar(`«Escalas y datos» ofrece escalas de valoración (${escalas.slice(0, 4).join(", ")}…)`, escalas.includes("Escala de Braden") && escalas.includes("Escala de Glasgow") && escalas.includes("Balance hídrico"));
    await page.click('.pv-pedido[data-texto="Escala de Braden"]');
    await page.waitForFunction(() => document.querySelectorAll("#pvMensajes .pv-sis").length >= 2, null, { timeout: 15000 });
    verificar("  ...pedir la de Braden → el puntaje", /Braden: 15 puntos/.test(await page.innerText("#pvMensajes")));
    for (const q of ["¿Cómo duerme?", "¿Cuánta agua toma?"]) {
      const antes = await page.$$eval("#pvMensajes .pv-pac:not(.pv-escribiendo)", (xs) => xs.length);
      await page.fill("#pvTexto", q);
      await page.click("#pvEnviar");
      await page.waitForFunction((n) => document.querySelectorAll("#pvMensajes .pv-pac:not(.pv-escribiendo)").length > n, antes, { timeout: 15000 });
    }
    await captura(page, "enf_pv_chat.png");
    await page.click("#pvTerminar");
    const panel = await page.innerText("#pvPanel");
    verificar("terminar pide su diagnóstico de enfermería prioritario, otros y sus intervenciones",
      /diagnóstico de enfermería prioritario/i.test(panel) && /Otros diagnósticos de enfermería/i.test(panel) && /Tus intervenciones/i.test(panel));
    await page.fill("#pvPrincipal", "Deterioro del intercambio gaseoso");
    await page.fill("#pvDiferenciales", "Intolerancia a la actividad");
    await page.fill("#pvPlan", "Posición semisentada, caminar por el pasillo");
    await page.click("#pvVerEval");
    await page.waitForSelector(".pv-eval", { timeout: 20000 });
    const ev = await page.innerText(".pv-eval");
    verificar("la evaluación: diagnóstico prioritario correcto, valoración clave, signos de alarma",
      /Diagnóstico prioritario correcto: Deterioro del intercambio gaseoso/.test(ev) && /3\/6/.test(ev) && /VALORACIÓN CLAVE|Valoración clave/i.test(ev) && /Signos de alarma/i.test(ev));
    verificar("  ...sus intervenciones: las adecuadas, las que faltaron y las que no corresponden",
      /Tus intervenciones: Posición semisentada, caminar por el pasillo/.test(ev) && /Intervenciones/.test(ev) && /Control de saturación/.test(ev) && /Caminar por el pasillo/.test(ev));
    verificar("  ...las escalas y los datos, y los otros diagnósticos", /Escalas y datos/i.test(ev) && /Otros diagnósticos de enfermería/i.test(ev));
    await page.click(".pv-detalle summary");
    const casoCompleto = await page.innerText(".pv-detalle");
    verificar("  ...y el caso entero: el diagnóstico médico, la valoración física y las intervenciones clave",
      /Diagnóstico médico: Neumonía/.test(casoCompleto) && /Valoración física/.test(casoCompleto) && /Intervenciones clave/.test(casoCompleto) && /Oxigenoterapia/.test(casoCompleto));
    verificar("sin claves sin traducir", sinClaves(await page.innerText("body")));
    await captura(page, "enf_pv_evaluacion.png");

    console.log("\n── 2. Los simulacros de enfermería ──");
    await page.click("#pvOtro");
    await page.waitForSelector(".est-pestanas", { timeout: 15000 });
    await page.click('.est-pestana[data-pestana="simulacros"]');
    await page.waitForSelector("#simEmpezar", { timeout: 15000 });
    const areasSim = await page.$$eval("#simAreas .est-chip", (xs) => xs.map(x => x.dataset.valor));
    verificar(`sus áreas (${areasSim.join(", ")})`, areasSim[0] === "mixto" && areasSim.slice(1).every(a => a.startsWith("enf_")) && areasSim.length === 8);
    verificar("  ...y su presentación: de enfermería, también de cálculo", /examen de enfermería/.test(await page.innerText(".sim-portada")) && /cálculo de medicación/.test(await page.innerText(".sim-portada")));

    console.log("\n── 3. El tutor y las tarjetas ──");
    const vivo = await page.evaluate(() => tutorEnVivoHtml({ carrera: "enfermeria", preguntas: [{ pregunta: "¿Cuánta agua toma?", porQue: "deshidratación" }], banderasRojas: ["Saturación baja"] }, true));
    verificar("mientras graba: «Te falta valorar» y «Signos de alarma»", /Te falta valorar/.test(vivo) && /Signos de alarma/.test(vivo) && !/Banderas rojas/.test(vivo));
    const consulta = { _id: "x", notaClinicaEstado: "completado", extras: {},
      transcripcionCompleta: "una atención de enfermería con las palabras suficientes para razonar sobre lo que pasó hoy en la sala" };
    const tarjeta = await page.evaluate((c) => razonamientoTarjetaHtml(c), consulta);
    verificar("al terminar: «Tu diagnóstico de enfermería prioritario»", /Tu diagnóstico de enfermería prioritario/.test(tarjeta) && /Otros diagnósticos de enfermería/.test(tarjeta));
    const resultado = await page.evaluate(() => razonamientoResultadoHtml({ carrera: "enfermeria", principal: "Deterioro del intercambio gaseoso", diferenciales: [],
      resultado: { acertoPrincipal: true, diferenciales: [{ diagnostico: "Deterioro del intercambio gaseoso", aFavor: ["saturación 89 %"], enContra: [], estudio: "Posición semisentada" }],
        banderasRojas: ["Confusión"], faltoPreguntar: ["Diuresis"], perla: "La oxigenación va primero." } }));
    verificar("  ...el análisis: por prioridad, con la intervención clave y lo que faltó valorar",
      /Diagnósticos de enfermería, por prioridad/.test(resultado) && /Intervención clave:/.test(resultado) && /Faltó valorar/.test(resultado) && /Acertaste el diagnóstico prioritario/.test(resultado));
    const preguntas = await page.evaluate(() => ["dx", "estudio", "banderas", "faltoPreguntar"].map(tipo => preguntaEstudio({ tipo, carrera: "enfermeria", sobre: "Dolor agudo" })));
    verificar("sus tarjetas preguntan como enfermería",
      /diagnóstico de enfermería prioritario/.test(preguntas[0]) && /intervención de enfermería/.test(preguntas[1]) && /signos de alarma/.test(preguntas[2]) && /faltó valorar/.test(preguntas[3]));
    const deMedicina = await page.evaluate(() => preguntaEstudio({ tipo: "estudio", sobre: "Apendicitis" }));
    verificar("  ...y una de medicina, como siempre", /qué estudio o maniobra/.test(deMedicina));
    verificar(`sin errores en la página${errores.length ? ": " + errores.join(" | ") : ""}`, errores.length === 0);

    console.log("\n── 4. En portugués ──");
    const pt = await entrar(TEL_PT);
    await pt.page.click("#btnEstudiar");
    await pt.page.waitForSelector(".est-pestanas", { timeout: 15000 });
    await pt.page.click('.est-pestana[data-pestana="paciente"]');
    await pt.page.waitForSelector("#pvEmpezar", { timeout: 15000 });
    const portada = await pt.page.innerText(".pv-portada");
    verificar("o paciente virtual de enfermagem, em português", /avaliação de enfermagem/.test(portada) && sinClaves(await pt.page.innerText("body")));
    const vivoPt = await pt.page.evaluate(() => tutorEnVivoHtml({ carrera: "enfermeria", preguntas: [{ pregunta: "x" }], banderasRojas: ["y"] }, true));
    verificar("  ...«Falta avaliar» e «Sinais de alerta»", /Falta avaliar/.test(vivoPt) && /Sinais de alerta/.test(vivoPt));
    verificar(`  ...sem erros na página${pt.errores.length ? ": " + pt.errores.join(" | ") : ""}`, pt.errores.length === 0);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill("SIGKILL");
    servidorIa.close();
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    if (copia) fs.rmSync(copia, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
