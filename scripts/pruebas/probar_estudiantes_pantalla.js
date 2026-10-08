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
    await page.waitForSelector("#estAvisoInicio .est-aviso", { timeout: 10000 }).catch(() => {});
    const aviso = await page.locator("#estAvisoInicio").innerText().catch(() => "");
    verificar(`arriba dice el nivel, el vencimiento y las horas («${aviso.replace(/\s+/g, " ").trim().slice(0, 90)}…»)`, /Interno/.test(aviso) && /vence/.test(aviso) && /0 de 12 horas/.test(aviso));
    verificar("  ...y debajo, cómo empezar a estudiar con sus casos", /Estudiá con tus propios casos/.test(aviso) && await page.locator("#estIrEstudiar").count() === 1);
    verificar("sin la pestaña de agenda; en su lugar, «Estudiar»", !(await page.locator("#btnAgenda").count()) && await page.locator("#btnEstudiar").count() === 1);

    console.log("\n── 2. Su paciente y su nota ──");
    const pac = await M.Paciente.create({ medicoPhone: TEL, nombre: "Paciente de Ana", telefono: "59170000002" });
    const c = await M.ConsultaMedica.create({ medicoPhone: TEL, pacienteId: pac._id, pacienteNombre: pac.nombre, estado: "completado", deEstudiante: true,
      duracionSegundos: 600, notaClinicaEstado: "completado",
      transcripcionCompleta: "Buenos días me duele la garganta hace tres días tengo fiebre y placas, le doy amoxicilina quinientos y control en siete días",
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

    console.log("\n── 2b. ¿Cuál es tu diagnóstico? (etapa 2) ──");
    verificar("antes de ver nada, se le pide SU diagnóstico", await page.locator("#rzPrincipal").count() === 1 && !(await page.locator(".tutor-dx").count()));
    await page.click("#rzBtn");
    verificar("sin escribirlo no se le muestra el análisis", /diagnóstico principal antes de comparar/.test(await page.innerText("#rzErr")));
    let pedidoRz = null;
    const RZ = { principal: "Faringitis viral", diferenciales: ["Resfrío"], en: new Date().toISOString(), resultado: {
      diferenciales: [{ diagnostico: "Faringoamigdalitis estreptocócica", aFavor: ["fiebre", "placas"], enContra: ["no se preguntó por tos"], estudio: "Test rápido de estreptococo" },
        { diagnostico: "Mononucleosis", aFavor: ["edad"], enContra: [], estudio: "Monotest" }],
      banderasRojas: ["Absceso periamigdalino"], faltoPreguntar: ["¿Tiene tos?"], acertoPrincipal: false,
      comentario: "Pensaste en lo viral, pero las placas con fiebre y sin tos orientan a bacteriana.",
      noConsideraste: [{ diagnostico: "Faringoamigdalitis estreptocócica", porQue: "fiebre y placas sin tos" }], perla: "Usá los criterios de Centor." } };
    await page.route(`**/medico/consultas/${c._id}/razonamiento`, (r) => { pedidoRz = JSON.parse(r.request().postData() || "{}"); r.fulfill({ json: { razonamiento: RZ, tarjetas: 4 } }); });
    await page.fill("#rzPrincipal", "Faringitis viral");
    await page.fill("#rzDiferenciales", "Resfrío, ");
    await page.click("#rzBtn");
    await page.waitForSelector(".tutor-dx", { timeout: 10000 }).catch(() => {});
    verificar("manda lo que pensó él", pedidoRz?.principal === "Faringitis viral" && JSON.stringify(pedidoRz?.diferenciales) === '["Resfrío"]');
    const tarjeta = await page.innerText("#razonamientoCard").catch(() => "");
    verificar("recién ahí ve los diferenciales en orden, con a favor / en contra y cómo distinguirlos",
      (await page.locator(".tutor-dx").count()) === 2 && /A favor: fiebre; placas/.test(tarjeta) && /Para distinguirlo: Test rápido/.test(tarjeta));
    verificar("  ...la comparación con lo suyo y lo que no consideró", /principal más probable era otro/.test(tarjeta) && /No consideraste/.test(tarjeta) && /Pensaste en lo viral/.test(tarjeta));
    verificar("  ...y el aviso de que es para aprender y lo confirma su tutor", /lo confirma tu tutor/.test(tarjeta));
    verificar("  ...y que con el caso se armaron sus tarjetas de repaso, con el acceso a «Estudiar»", /se armaron 4 tarjetas de repaso/.test(tarjeta) && await page.locator("#rzIrEstudiar").count() === 1);
    if (process.env.CAPTURAS) await page.locator("#razonamientoCard").screenshot({ path: path.join(process.env.CAPTURAS, "estudiante_razonamiento.png") });
    await M.ConsultaMedica.updateOne({ _id: c._id }, { $set: { razonamiento: { ...RZ, en: new Date() } } });
    await page.evaluate((id) => renderDetalle(id), String(c._id));
    await page.waitForSelector("#razonamientoCard", { timeout: 10000 });
    verificar("al volver a abrir la consulta: su razonamiento guardado, sin formulario", !(await page.locator("#rzPrincipal").count()) && (await page.locator(".tutor-dx").count()) === 2);
    // El aviso de «algo cambió» vuelve también a la sesión que guardó: antes
    // caía sobre la ficha del paciente (la última pantalla registrada) y la
    // repintaba encima de la consulta. Un guardado cualquiera, de verdad:
    await page.evaluate(() => api("/medico/pacientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "Otro paciente" }) }));
    await esperar(3500);
    verificar("guardar algo estando en la consulta no la tapa con la ficha del paciente", await page.locator("#razonamientoCard").count() === 1 && !(await page.locator("#btnNuevaConsulta").count()));
    const html = await page.evaluate(() => [
      notaEnVivoHtml("vivo", { motivoConsulta: "Dolor" }, [], { preguntas: [{ pregunta: "¿Tiene tos?", porQue: "orienta a viral" }], banderasRojas: ["Disnea"] }),
      notaEnVivoHtml("vivo", { motivoConsulta: "Dolor" }, [], { preguntas: [], banderasRojas: [] }),
      notaEnVivoHtml("vivo", { motivoConsulta: "Dolor" }, [], null),
    ]);
    verificar("mientras graba: «Te falta preguntar» con la pregunta, por qué, y las banderas rojas",
      /Te falta preguntar/.test(html[0]) && html[0].includes("¿Tiene tos?") && html[0].includes("orienta a viral") && /Banderas rojas/.test(html[0]) && html[0].includes("Disnea"));
    verificar("  ...si no falta nada, lo dice", /no te falta preguntar nada/.test(html[1]));
    verificar("  ...y sin tutor (un médico) no aparece nada de eso", !/Te falta|Banderas|no te falta/.test(html[2]));

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

    console.log("\n── 3b. Estudiar con sus casos (etapa 3) ──");
    // Contra el servidor de verdad: las tarjetas salen del razonamiento que
    // quedó guardado en la sección 2b, y las respuestas se guardan.
    const captura = async (nombre) => { if (process.env.CAPTURAS) await page.screenshot({ path: path.join(process.env.CAPTURAS, nombre), fullPage: true }); };
    await page.evaluate(() => renderDashboard());
    await page.waitForSelector("#btnEstudiar", { timeout: 15000 });
    await page.click("#btnEstudiar");
    await page.waitForSelector(".est-portada", { timeout: 15000 });
    verificar("«Estudiar» → la portada: racha en 0 y las 4 tarjetas del caso razonado para hoy",
      (await page.innerText(".est-racha-num")) === "0" && /4 tarjetas/.test(await page.innerText("#estEmpezar")));
    const logros = await page.$$eval(".est-logro", (xs) => xs.map((x) => x.dataset.logro).join());
    verificar(`  ...con los logros: el del primer caso, hecho, y el próximo de cada tipo (${logros})`,
      await page.locator('.est-logro.hecho[data-logro="primerCaso"]').count() === 1 && logros === "primerCaso,casos10,aciertos5,racha3,dominadas10,paciente1,simulacro1,simulacro80");
    verificar("  ...y su dirección propia", page.url().endsWith("/app/estudiar"));
    verificar("  ...diciendo que es para aprender y que el diagnóstico lo confirma su tutor", /lo confirma tu tutor/.test(await page.innerText(".est-aviso-ia")));
    await captura("estudio_portada.png");
    await page.click("#estEmpezar");
    await page.waitForSelector("#estTarjeta", { timeout: 10000 });
    verificar("primero la de diagnóstico: el caso, la pregunta y las 2 opciones",
      (await page.getAttribute("#estTarjeta", "data-tipo")) === "dx" && /más probable/.test(await page.innerText(".est-pregunta"))
      && (await page.locator(".est-opcion").count()) === 2 && /Faringitis/.test(await page.innerText(".est-caso-caja")));
    verificar("  ...sin el nombre del paciente en ningún lado", !(await page.innerText("body")).includes("Paciente de Ana"));
    await page.locator(".est-opcion", { hasText: "Mononucleosis" }).click();
    await page.waitForSelector(".est-veredicto", { timeout: 10000 });
    const explica = await page.innerText("#estExplica");
    verificar("elegir la que no era → «el más probable era…», la correcta en verde y la suya en rojo",
      /El más probable era «Faringoamigdalitis estreptocócica»/.test(explica)
      && (await page.locator(".est-opcion.bien", { hasText: "Faringoamigdalitis" }).count()) === 1 && (await page.locator(".est-opcion.mal", { hasText: "Mononucleosis" }).count()) === 1);
    verificar("  ...con por qué, la perla y cuándo vuelve", /A favor de «Faringoamigdalitis estreptocócica»: fiebre; placas/.test(explica) && /Centor/.test(explica) && /Vuelve mañana/.test(explica));
    await captura("estudio_dx.png");
    await esperar(3000);
    verificar("  ...y ahí se queda: ningún aviso de cambio le repinta otra pantalla encima", (await page.locator(".est-veredicto").count()) === 1);
    await page.click("#estSiguiente");
    await page.waitForSelector('#estTarjeta[data-tipo="estudio"]', { timeout: 10000 });
    verificar("después, «¿qué estudio…?» de ese diagnóstico (2 de 4)", /Faringoamigdalitis estreptocócica/.test(await page.innerText(".est-pregunta")) && /2 de 4/.test(await page.innerText(".est-cuenta")));
    verificar("  ...sin la respuesta a la vista", !(await page.innerText("#estTarjeta")).includes("Test rápido"));
    await page.click("#estMostrar");
    verificar("«mostrar la respuesta» → la respuesta, y recién ahí «me acordaba / no me acordaba»",
      /Test rápido de estreptococo/.test(await page.innerText(".est-respuesta")) && (await page.locator("#estMeAcordaba").count()) === 1);
    await captura("estudio_recuerdo.png");
    await page.click("#estMeAcordaba");
    await page.waitForSelector('#estTarjeta[data-tipo="banderas"]', { timeout: 10000 });
    await page.click("#estReportar");
    await page.click('.est-motivo[data-motivo="respuesta"]');
    await page.waitForSelector("#estDeshacer", { timeout: 10000 });
    let tb = await M.TarjetaEstudio.findOne({ consultaId: c._id, tipo: "banderas" }).lean();
    verificar("«esta pregunta está mal» → se elige qué (sin texto libre) y queda marcada", tb?.reportada?.motivo === "respuesta" && !!tb.reportada.en);
    await page.click("#estDeshacer");
    await page.waitForSelector("#estMostrar", { timeout: 10000 });
    tb = await M.TarjetaEstudio.findOne({ consultaId: c._id, tipo: "banderas" }).lean();
    verificar("  ...«deshacer» → vuelve la misma tarjeta, sin la marca", !tb.reportada?.en && (await page.getAttribute("#estTarjeta", "data-tipo")) === "banderas");
    await page.click("#estMostrar");
    await page.click("#estNoMeAcordaba");
    await page.waitForSelector('#estTarjeta[data-tipo="faltoPreguntar"]', { timeout: 10000 });
    await page.click("#estMostrar");
    await page.click("#estMeAcordaba");
    await page.waitForSelector(".est-fin", { timeout: 10000 });
    const fin = await page.innerText(".est-fin");
    verificar(`al terminar: cuántas bien, la racha en 1 y que sumó el día («${fin.replace(/\s+/g, " ").slice(0, 70)}…»)`,
      /Listo por hoy/.test(fin) && /2 de 4 bien/.test(fin) && (await page.innerText(".est-fin .est-racha-num")) === "1" && /Sumaste un día/.test(fin));
    await captura("estudio_fin.png");
    const guardadas = await M.TarjetaEstudio.find({ consultaId: c._id }).lean();
    const cajas = Object.fromEntries(guardadas.map(x => [x.tipo, x.caja]));
    verificar("en la base: las que sabía subieron de caja; las que no, vuelven mañana a la 1",
      cajas.dx === 1 && cajas.estudio === 2 && cajas.banderas === 1 && cajas.faltoPreguntar === 2 && guardadas.every(x => x.vistas === 1));
    await page.click("#estRepasar");
    await page.waitForSelector("#estTarjeta", { timeout: 10000 });
    verificar("«repasar más» → las de mañana, avisando que es un repaso extra", /Repaso extra/.test(await page.innerText("#estTarjeta")));
    await page.evaluate(() => renderDashboard());
    await page.waitForSelector("#estAvisoInicio .est-inicio", { timeout: 10000 });
    verificar("en el inicio: la racha en 1 y «al día con tus tarjetas»",
      /al día con tus tarjetas/.test(await page.innerText("#estAvisoInicio")) && (await page.innerText("#estAvisoInicio .est-racha-num")) === "1");
    const enPt = await page.evaluate(async () => { fijarIdioma("pt"); await renderEstudiar(); const x = document.querySelector(".est-portada")?.innerText || ""; fijarIdioma("es"); return x; });
    verificar("en portugués: «Estudar com seus casos»", /Estudar com seus casos/.test(enPt) && /dias seguidos|dia seguido/.test(enPt));

    console.log("\n── 4. En la compu ──");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${PUERTO}/app/pacientes`);
    await page.waitForSelector(".escr-nav-item", { timeout: 20000 });
    const menu = await page.$$eval(".escr-nav-item", (xs) => xs.map((x) => x.dataset.id));
    verificar(`el menú tiene solo inicio, pacientes, grabar, estudiar y configuración (${menu.join(", ")})`, menu.join() === "inicio,pacientes,voz,estudiar,configuracion");
    await page.click('.escr-nav-item[data-id="estudiar"]');
    await page.waitForSelector(".est-portada", { timeout: 15000 });
    verificar("«Estudiar» en el menú → la portada, con su título arriba", (await page.innerText("#escrTituloPantalla")) === "Estudiar");
    await page.reload();
    await page.waitForSelector(".est-portada", { timeout: 20000 }).catch(() => {});
    verificar("  ...y al recargar sigue ahí (/app/estudiar)", (await page.locator(".est-portada").count()) === 1);
    await page.click('.escr-nav-item[data-id="inicio"]');
    await page.waitForSelector("#estAvisoInicio .est-aviso", { timeout: 15000 }).catch(() => {});
    // A esta altura ya gastó sus 12 horas (sección 3): el aviso es ese.
    verificar("el inicio de la compu muestra el aviso del acceso y lo de estudiar (antes no se veía)",
      /Usaste las 12 horas/.test(await page.innerText("#estAvisoInicio").catch(() => "")) && (await page.locator("#estAvisoInicio #estIrEstudiar").count()) === 1);
    verificar("  ...y no ofrece la agenda", !(await page.locator("#escrBtnIrAgenda").count()));
    await captura("estudio_inicio_compu.png");
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
