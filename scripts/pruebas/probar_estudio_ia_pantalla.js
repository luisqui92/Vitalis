// Symphomed — El paciente virtual y los simulacros, de punta a punta.
//
// Un navegador de verdad, contra el servidor de verdad (index.js), con la IA
// apuntada a una de mentira que corre acá mismo (OPENAI_URL, ver
// services/ia.js). Así se prueba todo el camino: lo que toca el estudiante,
// lo que el servidor le pide a la IA y lo que queda en la base. Lo que se
// mira:
//   · la entrevista: preguntar, examinar, pedir estudios, terminar y ver la
//     evaluación con el caso entero;
//   · que al paciente nunca le llega el diagnóstico;
//   · un simulacro en práctica y otro en examen, con su resultado;
//   · que las erradas del simulacro vuelven en «Mis casos» como tarjetas.
// Con OFUSCADO=1 corre contra el JS ofuscado, como en producción.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3965;
const PUERTO_IA = 3966;
const TEL = "59170097001";

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
  paciente: { nombre: "Carla Mendoza", edad: 24, sexo: "Femenino", ocupacion: "estudiante" },
  quienHabla: "el paciente", lugar: "emergencia",
  motivo: "Me duele mucho la panza desde ayer, doctor.",
  personalidad: "preocupada y colaboradora",
  historia: ["El dolor empezó hace 20 horas alrededor del ombligo", "Hace 8 horas se fue abajo a la derecha", "Tuvo náuseas y vomitó una vez", "No tiene hambre"],
  antecedentes: { personales: ["ninguno"], familiares: [], medicamentos: [], alergias: [], habitos: [], ginecoObstetricos: ["última menstruación hace 2 semanas"] },
  negativos: ["diarrea", "ardor al orinar"],
  signosVitales: { PA: "110/70 mmHg", FC: "102 lpm", T: "38,1 °C" },
  examenFisico: [{ region: "Abdomen", hallazgo: "Dolor en fosa ilíaca derecha, signo de Blumberg positivo" }],
  estudios: [{ nombre: "Hemograma", resultado: "Leucocitos 14.500/mm³ con 85 % de neutrófilos" }],
  diagnostico: "Apendicitis aguda",
  diferenciales: [{ diagnostico: "Embarazo ectópico", porQueNo: "Menstruación hace 2 semanas" }, { diagnostico: "Infección urinaria", porQueNo: "Sin síntomas urinarios" }],
  preguntasClave: ["¿Dónde empezó el dolor?", "¿Se movió el dolor?", "¿Tuvo fiebre?", "¿Náuseas o vómitos?", "¿Cuándo fue su última menstruación?", "¿Síntomas urinarios?"],
  banderasRojas: ["Peritonitis"],
  estudiosPertinentes: ["Hemograma", "Ecografía abdominal"],
  perla: "El dolor que migra del ombligo a la fosa ilíaca derecha es muy sugestivo de apendicitis.",
};
const alPaciente = [];
let numero = 0;
const claves = new Map();
function iaDeMentira(cuerpo) {
  const sistema = cuerpo.messages[0].content;
  const ultimo = cuerpo.messages[cuerpo.messages.length - 1]?.content || "";
  if (/Armá UN caso nuevo/.test(sistema)) return CASO;
  if (/Elegí el diagnóstico más probable entre las opciones/.test(sistema)) {
    const opciones = [...ultimo.matchAll(/^(\d+)\. (.+)$/gm)].map(m => m[2]);
    return { opcion: opciones.indexOf(CASO.diagnostico) };
  }
  if (/Esto es una práctica de entrevista clínica/.test(sistema)) {
    alPaciente.push(sistema);
    return { texto: /dónde|donde/i.test(ultimo) ? "Empezó acá, alrededor del ombligo." : "Sí, doctor." };
  }
  if (/el estudiante examina al paciente/.test(sistema)) return { hallazgo: "Dolor en fosa ilíaca derecha, signo de Blumberg positivo." };
  if (/el estudiante pide un estudio/.test(sistema)) return { resultado: "Leucocitos 14.500/mm³ con 85 % de neutrófilos." };
  if (/Sos un docente que evalúa la práctica/.test(sistema)) {
    return {
      preguntasClave: CASO.preguntasClave.map((_, i) => ({ hecha: i < 4 })),
      banderasRojas: [{ explorada: false }],
      estudios: { pertinentes: ["Hemograma"], faltaron: ["Ecografía abdominal"], innecesarios: [] },
      diagnostico: { acerto: true, comentario: "Llegaste con la migración del dolor." },
      diferenciales: { considero: ["Embarazo ectópico"], faltaron: [] },
      comunicacion: { bien: ["Te presentaste"], mejorar: ["Preguntar por la menstruación antes"] },
      comentario: "Buena entrevista; te faltó buscar signos de peritonitis.",
    };
  }
  if (/preguntas para el examen de ingreso a la residencia/.test(sistema)) {
    const temas = (sistema.match(/estos temas: (.+?)\.\n/) || [])[1].split("; ");
    return { preguntas: temas.map(tema => {
      numero++;
      const correcta = numero % 5;
      const enunciado = `Caso ${numero}: un paciente con un cuadro de ${tema}. ¿Cuál es la conducta más adecuada?`;
      claves.set(enunciado, correcta);
      return { tema, enunciado, opciones: [0, 1, 2, 3, 4].map(k => `Conducta ${"ABCDE"[k]} del caso ${numero}`), correcta,
        explicacion: `Porque la ${"ABCDE"[correcta]} es la indicada.`, porOpcion: [0, 1, 2, 3, 4].map(k => (k === correcta ? "Es la correcta." : "No corresponde.")) };
    }) };
  }
  if (/Sos un médico que rinde el examen de residencia/.test(sistema)) {
    const enunciados = [...ultimo.matchAll(/^PREGUNTA \d+: (.+)$/gm)].map(m => m[1]);
    return { respuestas: enunciados.map(e => ({ opcion: claves.get(e), dudosa: false })) };
  }
  throw new Error("pedido inesperado: " + sistema.slice(0, 60));
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
  const uri = mongod.getUri() + "estudio_ia_pantalla";
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
    const M = { ...require(path.join(RAIZ, "db", "models")), ...require(path.join(RAIZ, "modulos", "estudiantes", "modelos")) };
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.create({ phone: TEL, nombre: "Ana Interna", passwordHash: await hashPassword("Prueba123."), activo: true, idioma: "es",
      estudiante: { nivel: "interno", hasta: new Date(Date.now() + 180 * 86400000), horasMes: 12 } });

    servidor = spawn(process.execPath, [path.join(raiz, "index.js")], { cwd: raiz, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
    browser = await pw.chromium.launch({ executablePath: navegador() });
    // En la hora de la cuenta (La Paz), como el celular de un estudiante de
    // verdad: «vuelve mañana» se calcula con el día de la cuenta, y con el
    // navegador en UTC la prueba fallaba entre las 00:00 y las 04:00.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/La_Paz" });
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    // Ninguna pantalla del estudiante puede chocar con el freno de estudiantes:
    // si choca, es un botón que se le muestra y no puede usar, o una ruta que
    // falta en la lista de lo permitido (modulos/estudiantes/restricciones.js).
    const frenados = [];
    page.on("response", async (r) => {
      if (r.status() !== 403) return;
      const cuerpo = await r.json().catch(() => null);
      if (cuerpo?.estudiante) frenados.push(r.request().method() + " " + new URL(r.url()).pathname);
    });
    page.on("dialog", (d) => d.accept());
    const captura = async (nombre) => { if (process.env.CAPTURAS) await page.screenshot({ path: path.join(process.env.CAPTURAS, nombre), fullPage: true }); };

    await page.goto(`http://127.0.0.1:${PUERTO}/app`);
    await page.fill("#lPhone", TEL);
    await page.fill("#lPass", "Prueba123.");
    await page.click("#lBtn");
    await page.waitForSelector("#btnEstudiar", { timeout: 20000 });

    console.log("── 1. El paciente virtual ──");
    await page.click("#btnEstudiar");
    await page.waitForSelector(".est-pestanas", { timeout: 15000 });
    verificar("«Estudiar» tiene cuatro pestañas: mis casos, paciente virtual, simulacros y la calculadora",
      (await page.$$eval(".est-pestana", (xs) => xs.map(x => x.dataset.pestana).join())) === "casos,paciente,simulacros,calculadora");
    await page.click('.est-pestana[data-pestana="paciente"]');
    await page.waitForSelector("#pvEmpezar", { timeout: 15000 });
    verificar("  ...el paciente virtual, con su cupo del mes y su dirección propia", /30 de 30/.test(await page.innerText(".pv-portada")) && page.url().endsWith("/app/paciente-virtual"));
    await page.click('#pvAreas .est-chip[data-valor="cirugia"]');
    await page.click('#pvDificultades .est-chip[data-valor="avanzado"]');
    verificar("  ...elegir la dificultad explica qué es", /menos frecuente o atípico/.test(await page.innerText("#pvDificultadAyuda")));
    await page.click("#pvEmpezar");
    await page.waitForSelector("#pvChat", { timeout: 30000 });
    verificar("empezar → se prepara y aparece el paciente, diciendo su motivo",
      /Carla Mendoza/.test(await page.innerText(".pv-cabecera")) && (await page.innerText("#pvMensajes")).includes(CASO.motivo));
    verificar("  ...y en la pantalla no está el diagnóstico", !/Apendicitis/.test(await page.innerText("body")));
    await page.fill("#pvTexto", "Hola, soy Ana, estudiante. ¿Dónde empezó el dolor?");
    await page.click("#pvEnviar");
    await page.waitForFunction(() => document.querySelectorAll("#pvMensajes .pv-pac:not(.pv-escribiendo)").length >= 2, null, { timeout: 15000 });
    verificar("preguntar → el paciente contesta en su burbuja", (await page.innerText("#pvMensajes")).includes("alrededor del ombligo"));
    verificar("  ...y al paciente (en el servidor) nunca le llegó el diagnóstico", alPaciente.length >= 1 && alPaciente.every(s => !/Apendicitis|Blumberg|Leucocitos/.test(s)));
    await page.click("#pvExaminar");
    await page.click('.pv-pedido[data-texto="Abdomen"]');
    await page.waitForFunction(() => document.querySelectorAll("#pvMensajes .pv-sis").length >= 1, null, { timeout: 15000 });
    verificar("examinar el abdomen (a un toque) → el hallazgo, aparte del paciente", /Blumberg/.test(await page.innerText("#pvMensajes .pv-sis")));
    await page.click("#pvPedir");
    await page.click('.pv-pedido[data-texto="Hemograma"]');
    await page.waitForFunction(() => document.querySelectorAll("#pvMensajes .pv-sis").length >= 2, null, { timeout: 15000 });
    verificar("pedir un hemograma → el resultado", /Leucocitos/.test(await page.innerText("#pvMensajes")));
    for (const q of ["¿Se le movió el dolor?", "¿Tuvo fiebre?"]) {
      const antes = await page.$$eval("#pvMensajes .pv-pac:not(.pv-escribiendo)", (xs) => xs.length);
      await page.fill("#pvTexto", q);
      await page.click("#pvEnviar");
      await page.waitForFunction((n) => document.querySelectorAll("#pvMensajes .pv-pac:not(.pv-escribiendo)").length > n, antes, { timeout: 15000 });
    }
    await captura("pv_chat.png");
    await page.click("#pvTerminar");
    await page.fill("#pvPrincipal", "Apendicitis aguda");
    await page.fill("#pvDiferenciales", "Embarazo ectópico, Infección urinaria");
    await page.click("#pvVerEval");
    await page.waitForSelector(".pv-eval", { timeout: 20000 });
    const ev = await page.innerText(".pv-eval");
    verificar("terminar → la evaluación: acertó, 4 de 6 preguntas clave, qué le faltó",
      /Diagnóstico correcto: Apendicitis aguda/.test(ev) && /4\/6/.test(ev) && /peritonitis/i.test(ev) && (await page.locator(".pv-check li").count()) >= 6);
    await page.click(".pv-detalle summary");
    verificar("  ...y recién ahí, el caso entero", /Blumberg/.test(await page.innerText(".pv-detalle")) && /Embarazo ectópico/.test(await page.innerText(".pv-detalle")));
    await captura("pv_evaluacion.png");

    console.log("\n── 2. Un simulacro en práctica ──");
    await page.click("#pvOtro");
    await page.waitForSelector(".est-pestanas", { timeout: 15000 });
    await page.click('.est-pestana[data-pestana="simulacros"]');
    await page.waitForSelector("#simEmpezar", { timeout: 15000 });
    await page.click('#simAreas .est-chip[data-valor="pediatria"]');
    await page.click('#simCantidades .est-chip[data-valor="10"]');
    await page.click("#simEmpezar");
    await page.waitForSelector("#simPregunta", { timeout: 60000 });
    verificar("empezar con el banco vacío → se escriben, se verifican y aparece la primera pregunta",
      (await page.locator("#simPregunta .est-opcion").count()) === 5 && /1 de 10/.test(await page.innerText(".est-cuenta")));
    verificar("  ...quedaron guardadas en el banco", (await M.PreguntaSimulacro.countDocuments({ area: "pediatria" })) >= 10);
    const correctaDeLaPantalla = async () => {
      const enunciado = await page.innerText(".sim-enunciado");
      const p = await M.PreguntaSimulacro.findOne({ enunciado: enunciado.trim() }).lean();
      return p.correcta;
    };
    let ok = await correctaDeLaPantalla();
    await page.click(`#simPregunta .est-opcion[data-k="${(ok + 1) % 5}"]`);
    await page.waitForSelector("#simExplica .est-veredicto", { timeout: 10000 });
    verificar("errar → «la correcta era…», con la explicación, y se puede seguir",
      /La correcta era/.test(await page.innerText("#simExplica")) && /Porque la/.test(await page.innerText("#simExplica")) && !(await page.isDisabled("#simSiguiente")));
    await captura("sim_practica.png");
    // Las otras nueve, bien.
    for (let i = 2; i <= 10; i++) {
      await page.click("#simSiguiente");
      await page.waitForFunction((n) => document.querySelector(".est-cuenta")?.innerText.startsWith(`${n} de`), i, { timeout: 10000 });
      ok = await correctaDeLaPantalla();
      await page.click(`#simPregunta .est-opcion[data-k="${ok}"]`);
      await page.waitForSelector("#simExplica .est-veredicto", { timeout: 10000 });
    }
    await page.click("#simTerminar");
    await page.waitForSelector(".sim-fin", { timeout: 15000 });
    verificar("al final: 9 de 10 bien, y que la errada ya está en sus tarjetas",
      /9 de 10/.test(await page.innerText(".sim-fin")) && /90%/.test(await page.innerText(".sim-fin")) && /tarjetas de repaso/.test(await page.innerText(".sim-fin")));
    verificar("  ...pregunta por pregunta, con la correcta", (await page.locator(".sim-repaso").count()) === 10);
    await captura("sim_resultado.png");

    console.log("\n── 3. Un simulacro en examen, con reloj ──");
    await page.click("#simOtro");
    await page.waitForSelector("#simEmpezar", { timeout: 15000 });
    await page.click('#simAreas .est-chip[data-valor="pediatria"]');
    await page.click('#simCantidades .est-chip[data-valor="10"]');
    await page.click('#simModos .est-chip[data-valor="examen"]');
    await page.click("#simEmpezar");
    await page.waitForSelector("#simReloj", { timeout: 60000 });
    verificar("examen → con reloj (15 minutos para 10 preguntas)", /^1[45]:\d\d$/.test(await page.innerText("#simReloj")));
    await page.click('#simPregunta .est-opcion[data-k="0"]');
    await page.waitForSelector("#simPregunta .est-opcion.elegida", { timeout: 10000 });
    verificar("  ...contestar marca su opción, sin decir si está bien", !(await page.locator("#simExplica .est-veredicto").count()));
    await page.click("#simEntregarYa");
    await page.waitForSelector(".sim-fin", { timeout: 15000 });
    verificar("«entregar ahora» → el resultado, con las que no contestó como erradas", /de 10/.test(await page.innerText(".sim-fin")));

    console.log("\n── 4. Las erradas vuelven en «Mis casos» ──");
    await M.TarjetaEstudio.updateMany({ medicoPhone: TEL }, { $set: { proxima: new Date(Date.now() - 1000) } });
    await page.click("#simIrTarjetas");
    await page.waitForSelector(".est-portada", { timeout: 15000 });
    verificar("la portada cuenta las tarjetas de los simulacros, y el logro del primer simulacro",
      /tarjetas/.test(await page.innerText("#estEmpezar")) && (await page.locator('.est-logro.hecho[data-logro="simulacro1"]').count()) === 1
      && (await page.locator('.est-logro.hecho[data-logro="paciente1"]').count()) === 1);
    await page.click("#estEmpezar");
    await page.waitForSelector('#estTarjeta[data-tipo="pregunta"]', { timeout: 10000 });
    verificar("una tarjeta de simulacro: «Simulacro · Pediatría», el caso y 5 opciones",
      /simulacro · pediatría/i.test(await page.innerText("#estTarjeta")) && (await page.locator("#estTarjeta .est-opcion").count()) === 5);
    ok = await correctaDeLaPantalla();
    await page.click(`#estTarjeta .est-opcion[data-i="${ok}"]`);
    await page.waitForSelector(".est-veredicto", { timeout: 10000 });
    verificar("  ...contestarla bien → «¡Bien! Esa es la correcta.»", /Esa es la correcta/.test(await page.innerText(".est-veredicto")));

    console.log("\n── 5. En la compu ──");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${PUERTO}/app/simulacros`);
    await page.waitForSelector("#simEmpezar", { timeout: 20000 });
    verificar("/app/simulacros abre los simulacros, con «Estudiar» marcado en el menú",
      (await page.getAttribute(".escr-nav-item.activo", "data-id")) === "estudiar" && (await page.locator(".sim-barra-fila").count()) >= 1);
    await captura("sim_compu.png");

    verificar(`ninguna pantalla del estudiante chocó con el freno de estudiantes${frenados.length ? `: ${frenados.join(", ")}` : ""}`, !frenados.length);
    verificar("sin errores de JavaScript", !errores.length);
    if (errores.length) console.log(errores.join("\n"));
  } catch (e) {
    console.error(e);
    fallos++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill();
    servidorIa.close();
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    if (copia) fs.rmSync(copia, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
