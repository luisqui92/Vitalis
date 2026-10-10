// Symphomed — La nota en vivo, en un navegador de verdad.
//
// Se graba con el micrófono falso de Chromium y una vista previa de
// AssemblyAI de mentira (el WebSocket lo contesta la prueba). Lo que importa:
//   · mientras se graba, la nota se va armando en la pantalla;
//   · al terminar, si el texto llegó entero, se manda con la grabación;
//   · si la vista previa se cortó, NO se manda: la nota sale del audio;
//   · en la consulta, mientras llega la verificación, lo que el médico está
//     corrigiendo NO se borra, el botón de confirmar espera, y las
//     diferencias aparecen con su botón (y la nota no cambia sola).
//
// Con OFUSCADO=1 corre contra el JS ofuscado, que es el que se sirve en
// producción: así se encontró que el ofuscador podía romper la grabación
// (ver scripts/ofuscar.js → «CADA ARCHIVO CON SU PREFIJO»).
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3957;
const CLAVE = "Symphomed1234";
const MED = "70041001";
const CONSULTA = "0123456789abcdef01234567";

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

// Lo que «se dice» en la consulta: por turnos, como los manda AssemblyAI.
const TURNOS = [
  "Buenos días doctor, me duele mucho la garganta desde hace tres días.",
  "Tengo fiebre por las noches y me cuesta tragar.",
  "Vamos a revisar. Tiene las amígdalas inflamadas con placas.",
  "Le voy a dar amoxicilina cincuenta cada ocho horas por siete días.",
];

const NOTA_VIVO = {
  motivoConsulta: "Dolor de garganta", sintomas: ["fiebre", "odinofagia"], diagnostico: "Faringoamigdalitis aguda",
  plan: "Antibiótico y control en 7 días", medicamentosRecetados: [{ nombre: "Amoxicilina", dosis: "50 mg", frecuencia: "cada 8 horas" }],
};

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "nota_en_vivo_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" };
  let servidor, browser, mongoose, copiaOfuscada = null;
  try {
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.create({ phone: MED, nombre: "Dra. En Vivo", passwordHash: await hashPassword(CLAVE), activo: true, tipoEspecialidad: "medicina_general" });
    const paciente = await M.Paciente.create({ medicoPhone: MED, nombre: "Juana Pérez" });

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
    browser = await pw.chromium.launch({
      executablePath: navegador(),
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));

    // ─── Lo que contesta la prueba en lugar de AssemblyAI y la IA ────────
    let modo = "entero";   // o "corte": la vista previa se cae a mitad
    await page.routeWebSocket(/\/ws-vista-previa/, (ws) => {
      ws.onMessage(() => { /* el audio que manda el navegador: se ignora */ });
      TURNOS.forEach((texto, i) => setTimeout(() => {
        try { ws.send(JSON.stringify({ transcript: texto, end_of_turn: true })); } catch { /* ya cerrado */ }
      }, 800 * (i + 1)));
      if (modo === "corte") setTimeout(() => { try { ws.close({ code: 1011, reason: "se cayó" }); } catch { /* ya cerrado */ } }, 800 * TURNOS.length + 500);
    });
    await page.route("**/medico/transcripcion-token", (r) => r.fulfill({ json: { pase: "p", ruta: "/ws-vista-previa" } }));
    const borradores = [];
    await page.route("**/medico/consultas/nota-en-vivo", async (r) => {
      borradores.push(JSON.parse(r.request().postData() || "{}"));
      await esperar(300);
      r.fulfill({ json: { nota: NOTA_VIVO } });
    });
    let subidas = 0;
    const textosEnVivo = [];
    await page.route((url) => url.pathname === "/medico/consultas", (r) => {
      if (r.request().method() !== "POST") return r.continue();
      subidas++;
      r.fulfill({ status: 202, json: { ok: true, consulta: { _id: CONSULTA } } });
    });
    await page.route(`**/medico/consultas/${CONSULTA}/texto-en-vivo`, (r) => {
      textosEnVivo.push(JSON.parse(r.request().postData() || "{}"));
      r.fulfill({ status: 202, json: { ok: true, usada: true } });
    });
    // La consulta: primero con la nota en vivo y la verificación pendiente;
    // cuando la prueba lo dice, verificada con diferencias.
    let verificada = false;
    await page.route(`**/medico/consultas/${CONSULTA}`, (r) => {
      const base = { _id: CONSULTA, pacienteId: String(paciente._id), pacienteNombre: "Juana Pérez", createdAt: new Date().toISOString(),
        notaFuente: "vivo", notaClinicaEstado: "completado", notaClinica: NOTA_VIVO, transcripcionEnVivo: TURNOS.join(" "),
        // Como si la Amoxicilina no se hubiera nombrado (services/notaEnVivo.js → nombradoEnTexto).
        verificacionMedicamentos: [{ estado: "ok", noNombrado: true }] };
      const consulta = !verificada
        ? { ...base, estado: "procesando", verificacion: { estado: "pendiente" } }
        : { ...base, estado: "completado", duracionSegundos: 60, segmentos: [{ hablante: "A", texto: "Buenos días doctor (transcripción completa)" }],
          verificacion: { estado: "diferencias", diferencias: [
            { tipo: "dosis", indice: 0, enNota: "Amoxicilina 50 mg cada 8 horas", enAudio: "Amoxicilina 500 mg cada 8 horas",
              medicamento: { nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 horas" } },
            { tipo: "falta", indice: null, enNota: "", enAudio: "Paracetamol 1 g cada 8 horas",
              medicamento: { nombre: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 horas" } },
          ] } };
      r.fulfill({ json: { consulta } });
    });

    await page.goto(`http://127.0.0.1:${PUERTO}/app`);
    await page.fill("#lPhone", MED);
    await page.fill("#lPass", CLAVE);
    await page.click("#lBtn");
    await page.waitForSelector("#avatarHomeBox", { timeout: 25000 });

    const grabar = async (segundos) => {
      await page.evaluate(([id, nombre]) => renderNuevaConsulta(id, nombre), [String(paciente._id), "Juana Pérez"]);
      await page.waitForSelector("#recBtn");
      await page.click("#recBtn");
      await esperar(segundos * 1000);
      await page.click("#recBtn");
      await page.waitForSelector("#ncSubir", { state: "visible", timeout: 10000 });
    };

    console.log("── 1. Mientras se graba, la nota se va armando ──");
    // Un turno del borrador son 45 s: se graba un poco más que eso.
    await page.evaluate(([id, nombre]) => renderNuevaConsulta(id, nombre), [String(paciente._id), "Juana Pérez"]);
    await page.click("#recBtn");
    await page.waitForFunction(() => /Faringoamigdalitis/.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 60000 });
    verificar("al minuto de grabar, la nota en vivo ya muestra el diagnóstico", true);
    verificar("  ...y el pedido llevó el texto de la vista previa", /amoxicilina cincuenta/.test(borradores[0]?.texto || "") && borradores[0]?.pacienteId === String(paciente._id));
    verificar("  ...todavía con la grabación en curso", await page.evaluate(() => document.getElementById("recBtn").classList.contains("recording")));
    await page.click("#recBtn");
    await page.waitForSelector("#ncSubir", { state: "visible", timeout: 10000 });
    await page.waitForFunction(() => /Así queda la nota/.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 10000 }).catch(() => {});
    verificar("al terminar, la nota queda en pantalla antes de subir", /Así queda la nota/.test(await page.innerText("#notaVivo")));

    console.log("\n── 2. Al subir, el texto entero va con la grabación ──");
    await page.click("#ncSubir");
    await page.waitForSelector("#verifBox", { timeout: 15000 });
    verificar("se subió la grabación una vez", subidas === 1);
    verificar("y se mandó el texto en vivo de ESA consulta, entero", textosEnVivo.length === 1 && TURNOS.every((x) => textosEnVivo[0].texto.includes(x)));

    console.log("\n── 3. La consulta, mientras se verifica ──");
    verificar("la nota se ve ya, con la transcripción completa todavía en camino", (await page.inputValue("#nfDiagnostico")) === "Faringoamigdalitis aguda");
    verificar("dice que se está verificando", /Verificando medicamentos/.test(await page.innerText("#verifBox")));
    verificar("el botón de confirmar espera", await page.isDisabled("#btnConfirmarConsulta"));
    verificar("un medicamento que no se nombró avisa en su fila", /No aparece en lo que se dijo/.test(await page.innerText(".med-row[data-i='0'] .nf-med-aviso")));
    verificar("  ...y su casilla «Cargar a Medicación» empieza DESMARCADA", !(await page.isChecked("#cfMeds .cf-med[data-k='0']")));
    await page.check("#cfMeds .cf-med[data-k='0']");
    await page.fill("#nfPlan", "Mi corrección del plan");
    await page.focus("#nfMotivo");
    verificada = true;
    await page.waitForFunction(() => /no coincide/.test(document.getElementById("verifBox")?.innerText || ""), null, { timeout: 15000 }).catch(() => {});
    verificar("llega la verificación: «no coincide en 2 punto(s)»", /no coincide en 2/.test(await page.innerText("#verifBox")));
    verificar("  ...y lo que el médico estaba corrigiendo SIGUE ahí", (await page.inputValue("#nfPlan")) === "Mi corrección del plan");
    verificar("  ...el botón de confirmar se habilita", !(await page.isDisabled("#btnConfirmarConsulta")));
    verificar("  ...la transcripción completa reemplaza a la del texto en vivo", /transcripción completa/.test(await page.innerText("#cuerpoTranscripcion")));
    verificar("la dosis NO cambió sola: sigue en 50 mg", (await page.inputValue(".med-row[data-i='0'] .nf-med-dosis")) === "50 mg");
    verificar("  ...pero la fila dice lo del audio, con su botón", /500 mg/.test(await page.innerText(".med-row[data-i='0'] .nf-med-verif")));
    await page.click(".verif-usar");
    verificar("tocar «Usar lo del audio» → 500 mg", (await page.inputValue(".med-row[data-i='0'] .nf-med-dosis")) === "500 mg");
    await page.click(".verif-agregar");
    const nombres = await page.$$eval("#nfMeds .nf-med-nombre", (xs) => xs.map((x) => x.value));
    verificar("tocar «Agregar» suma el que faltaba (Paracetamol)", nombres.includes("Paracetamol"));
    const etiquetas = async () => page.$$eval("#cfMeds .conf-fila", (xs) => xs.map((x) => ({ texto: x.innerText.trim(), marcado: x.querySelector("input").checked })));
    let cf = await etiquetas();
    verificar("«Cargar a Medicación» dice lo que la nota dice AHORA (500 mg, y el agregado)",
      cf.length === 2 && /Amoxicilina 500 mg/.test(cf[0].texto) && /Paracetamol 1 g/.test(cf[1].texto));
    await page.screenshot({ path: path.join(process.env.CAPTURAS || "/tmp", "nota_en_vivo_consulta.png"), fullPage: true });

    // El bug de antes: las casillas iban por posición. Se desmarca el
    // Paracetamol, se corrige la Amoxicilina y se BORRA su fila: lo que queda
    // marcado tiene que seguir siendo lo que el médico eligió.
    await page.uncheck("#cfMeds .cf-med[data-k='n1']");
    await page.fill(".med-row[data-i='0'] .nf-med-dosis", "750 mg");
    cf = await etiquetas();
    verificar("corregir una dosis actualiza la etiqueta y respeta lo desmarcado", /Amoxicilina 750 mg/.test(cf[0].texto) && cf[1].marcado === false);
    await page.click(".med-row[data-i='0'] .nf-med-quitar");
    cf = await etiquetas();
    verificar("borrar la fila de la Amoxicilina: queda solo el Paracetamol, todavía desmarcado", cf.length === 1 && /Paracetamol/.test(cf[0].texto) && !cf[0].marcado);
    await page.check("#cfMeds .cf-med[data-k='n1']");
    let confirmado = null;
    await page.route(`**/medico/consultas/${CONSULTA}/confirmar`, (r) => {
      confirmado = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ json: { ok: true, aplicado: [], fallado: [] } });
    });
    await page.click("#btnConfirmarConsulta");
    for (let i = 0; i < 50 && !confirmado; i++) await esperar(100);
    verificar("al confirmar se carga el que está marcado, y no otro (antes: el número corrido)",
      confirmado?.nota?.medicamentosRecetados?.length === 1 && confirmado.nota.medicamentosRecetados[0].nombre === "Paracetamol"
      && JSON.stringify(confirmado.aplicar?.medicamentos) === "[0]");
    verificar("  ...con el plan que corrigió el médico", confirmado?.nota?.plan === "Mi corrección del plan");
    // Después de confirmar la pantalla se vuelve a pedir: que termine antes
    // de abrir otra, o la tapa.
    await page.waitForLoadState("networkidle");
    await esperar(1000);

    console.log("\n── 4. Si la vista previa se cortó, no se usa ──");
    modo = "corte";
    const antes = textosEnVivo.length;
    await grabar(6);
    await page.waitForFunction(() => /se cortó/.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    verificar("la pantalla avisa que la nota va a salir de la grabación", /se cortó/.test(await page.innerText("#notaVivo")));
    verificada = false;
    await page.click("#ncSubir");
    await page.waitForSelector("#btnBack", { timeout: 15000 });
    await esperar(500);
    verificar("  ...y NO se mandó el texto en vivo", textosEnVivo.length === antes && subidas === 2);

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
    if (copiaOfuscada) fs.rmSync(copiaOfuscada, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
