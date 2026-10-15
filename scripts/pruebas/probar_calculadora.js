// Symphomed — La calculadora de medicación de las cuentas de estudiante.
//
// Lo que se prueba:
//   1. Las fórmulas del servidor (modulos/estudiantes/calculos.js) con
//      ejercicios resueltos, y que rechazan lo que no es un problema real (un
//      factor de goteo que no existe, un dato fuera de rango, una dilución que
//      concentra).
//   2. Cómo se leen los números de un texto (coma decimal, punto de miles) y
//      cuándo un número «es» el resultado.
//   3. Las fórmulas de la pantalla (public/js/estudiantesCalculadora.js) dan
//      lo mismo que las del servidor, con miles de datos al azar: si alguien
//      cambia una y no la otra, la calculadora y los simulacros dirían cosas
//      distintas.
//   4. En un navegador de verdad: la pestaña, cada cálculo con su fórmula a la
//      vista, los avisos de un dato fuera de rango, y en portugués.
// Con OFUSCADO=1 la parte del navegador corre contra el JS ofuscado.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3976;
const TEL = "59170098001";
const TEL_PT = "5511970098002";

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const cerca = (a, b, margen = 1e-9) => Math.abs(a - b) <= margen;
const C = require(path.join(RAIZ, "modulos", "estudiantes", "calculos"));

console.log("── 1. Las fórmulas del servidor ──");
verificar("goteo: 1000 mL en 8 h con macrogotero de 20 → 41,67 gotas/min", cerca(C.calcular("goteo", { volumenMl: 1000, minutos: 480, factor: 20 }), 1000 * 20 / 480));
verificar("  ...la regla de siempre: volumen ÷ (horas × 3)", cerca(C.calcular("goteo", { volumenMl: 1000, minutos: 480, factor: 20 }), 1000 / (8 * 3)));
verificar("  ...con microgotero, microgotas/min = mL/h",
  cerca(C.calcular("goteo", { volumenMl: 500, minutos: 240, factor: 60 }), C.calcular("mlHora", { volumenMl: 500, minutos: 240 })));
verificar("mL por hora: 500 mL en 4 h → 125", cerca(C.calcular("mlHora", { volumenMl: 500, minutos: 240 }), 125));
verificar("dosis por peso: 50 mg/kg/día, 20 kg, en 3 tomas → 333,3 mg por toma", cerca(C.calcular("dosisPorPeso", { dosisPorKg: 50, pesoKg: 20, tomas: 3 }), 1000 / 3));
verificar("  ...sin tomas es dosis única: 15 mg/kg × 20 kg → 300 mg", cerca(C.calcular("dosisPorPeso", { dosisPorKg: 15, pesoKg: 20 }), 300));
verificar("volumen: 250 mg de una presentación de 500 mg en 5 mL → 2,5 mL", cerca(C.calcular("volumen", { dosis: 250, cantidad: 500, volumenMl: 5 }), 2.5));
verificar("dilución: de 10 % a 2 %, 500 mL finales → 100 mL de la inicial", cerca(C.calcular("dilucion", { c1: 10, c2: 2, v2: 500 }), 100));
verificar("infusión: 5 mcg/kg/min, 70 kg, 400 mg en 250 mL → 13,125 mL/h", cerca(C.calcular("infusion", { dosisMcgKgMin: 5, pesoKg: 70, mg: 400, volumenMl: 250 }), 13.125));
verificar("los números pueden venir como texto, con coma decimal", cerca(C.calcular("volumen", { dosis: "2,5", cantidad: "5", volumenMl: "1" }), 0.5));
const nulos = [
  ["un factor de goteo que no es de ningún equipo (25)", "goteo", { volumenMl: 1000, minutos: 480, factor: 25 }],
  ["un tiempo de cero", "goteo", { volumenMl: 1000, minutos: 0, factor: 20 }],
  ["un volumen negativo", "mlHora", { volumenMl: -5, minutos: 60 }],
  ["un peso de 500 kg", "dosisPorPeso", { dosisPorKg: 10, pesoKg: 500, tomas: 1 }],
  ["tomas que no son enteras", "dosisPorPeso", { dosisPorKg: 10, pesoKg: 20, tomas: 2.5 }],
  ["una dilución que concentra (de 2 % a 10 %)", "dilucion", { c1: 2, c2: 10, v2: 500 }],
  ["un dato que falta", "infusion", { dosisMcgKgMin: 5, pesoKg: 70, mg: 400 }],
  ["un tipo que no existe", "magia", { x: 1 }],
  ["un dato que no es un número", "volumen", { dosis: "mucho", cantidad: 500, volumenMl: 5 }],
];
for (const [que, tipo, datos] of nulos) verificar(`  sin resultado con ${que}`, C.calcular(tipo, datos) === null);

console.log("\n── 2. Los números de un texto ──");
const lectura = [
  ["41,7 gotas/min", [41.7]], ["42 gotas por minuto", [42]], ["2.500 mL en 8 h", [2500, 8]], ["1 000 mL", [1000]],
  ["1.000,5 mg", [1000.5]], ["0.125 mg", [0.125]], ["0,125 mg", [0.125]], ["1.5 mL", [1.5]], ["20, 30 y 40", [20, 30, 40]],
];
for (const [texto, esperado] of lectura) {
  const leido = C.numerosDe(texto);
  verificar(`«${texto}» → ${JSON.stringify(leido)}`, JSON.stringify(leido) === JSON.stringify(esperado));
}
verificar("42 y 41,7 son el resultado 41,67; 41 no", C.coincide(42, 41.667) && C.coincide(41.7, 41.667) && !C.coincide(41, 41.667));
verificar("167 es 166,67; 160 no", C.coincide(167, 166.667) && !C.coincide(160, 166.667));
verificar("2,5 es 2,5; 2,6 no", C.coincide(2.5, 2.5) && !C.coincide(2.6, 2.5));

console.log("\n── 3. Las fórmulas de la pantalla dan lo mismo ──");
const codigo = fs.readFileSync(path.join(RAIZ, "public", "js", "estudiantesCalculadora.js"), "utf8");
const contexto = vm.createContext({ Intl });
vm.runInContext(codigo + "\n;this.__exp = { CALC_FORMULAS, calcNumero };", contexto);
const { CALC_FORMULAS, calcNumero } = contexto.__exp;
verificar(`la pantalla tiene las mismas fórmulas que el servidor (${Object.keys(CALC_FORMULAS).join(", ")})`,
  Object.keys(CALC_FORMULAS).sort().join() === C.TIPOS.slice().sort().join());
let semilla = 20261015;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const entre = (min, max) => min + azar() * (max - min);
let distintas = 0, probadas = 0;
for (let i = 0; i < 2000; i++) {
  const datos = {
    volumenMl: entre(1, 3000), minutos: entre(5, 1440), factor: C.FACTORES_GOTEO[i % 4], dosisPorKg: entre(0.01, 100), pesoKg: entre(0.5, 150),
    tomas: 1 + (i % 6), dosis: entre(0.1, 2000), cantidad: entre(0.1, 2000), c1: entre(1, 100), v2: entre(1, 1000),
    dosisMcgKgMin: entre(0.01, 20), mg: entre(1, 1000),
  };
  datos.c2 = datos.c1 * entre(0.01, 0.99);
  for (const tipo of C.TIPOS) {
    probadas++;
    const servidor = C.calcular(tipo, datos);
    const pantalla = CALC_FORMULAS[tipo](datos);
    if (servidor === null || !cerca(servidor, pantalla, Math.abs(servidor) * 1e-12)) distintas++;
  }
}
verificar(`${probadas} cálculos al azar: ${distintas} distintos`, distintas === 0 && probadas === 12000);
const textos = ["41,7", "1.000", "1 000", "1.000,5", "0.125", "0,125", "1.5", "2500", "12,75"];
verificar("la pantalla lee los números como el servidor", textos.every(x => calcNumero(x) === C.numerosDe(x)[0]));
verificar("  ...y un texto que no es un número no es un número", ["", "abc", "1,2,3x", "-5"].every(x => Number.isNaN(calcNumero(x))));

// ─── 4. En un navegador de verdad ──────────────────────────────────────────
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
  if (!pw || !MongoMemoryServer) {
    console.log("⏭️  La parte del navegador SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅.");
    process.exit(fallos ? 1 : 0);
  }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "calculadora_pantalla";
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
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    const hasta = new Date(Date.now() + 180 * 86400000);
    await M.Medico.create({ phone: TEL, nombre: "Ana Enfermera", passwordHash: await hashPassword("Prueba123."), activo: true, idioma: "es",
      tipoEspecialidad: "enfermeria", estudiante: { nivel: "estudiante", hasta, horasMes: 6, carrera: "enfermeria" } });
    await M.Medico.create({ phone: TEL_PT, nombre: "Ana Enfermeira", passwordHash: await hashPassword("Prueba123."), activo: true, idioma: "pt",
      tipoEspecialidad: "enfermeria", estudiante: { nivel: "estudiante", hasta, horasMes: 6, carrera: "enfermeria" } });

    servidor = spawn(process.execPath, [path.join(raiz, "index.js")], { cwd: raiz, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
    browser = await pw.chromium.launch({ executablePath: navegador() });

    async function entrar(telefono) {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      await page.goto(`http://127.0.0.1:${PUERTO}/app`);
      await page.fill("#lPhone", telefono);
      await page.fill("#lPass", "Prueba123.");
      await page.click("#lBtn");
      await page.waitForSelector("#btnEstudiar", { timeout: 20000 });
      await page.click("#btnEstudiar");
      await page.waitForSelector(".est-pestanas", { timeout: 15000 });
      await page.click('.est-pestana[data-pestana="calculadora"]');
      await page.waitForSelector("#calcResultado .calc-grande", { timeout: 15000 });
      return { page, errores };
    }
    const resultado = (page) => page.innerText("#calcResultado");
    const elegir = async (page, cual) => { await page.click(`#calcCual .est-chip[data-valor="${cual}"]`); await page.waitForSelector("#calcResultado"); };
    const escribir = async (page, k, valor) => { await page.fill(`#calc_${k}`, valor); };
    const sinClaves = (texto) => !/\bcalc\.[a-zA-Z]+\.?[a-zA-Z/%]*/.test(texto);

    console.log("\n── 4. En un navegador de verdad ──");
    const { page, errores } = await entrar(TEL);
    verificar("la pestaña «Calculadora» de Estudiar, con su dirección propia",
      page.url().endsWith("/app/calculadora") && /Calculadora/.test(await page.innerText('.est-pestana[data-pestana="calculadora"]')));
    let r = await resultado(page);
    verificar(`abre con un ejemplo resuelto: 1000 mL en 8 h → 42 gotas/min y 125 mL/h (${r.split("\n")[0]})`,
      /^42 gotas\/min/.test(r) && /125 mL\/h/.test(r) && /41,7 exactas/.test(r));
    verificar("  ...con la fórmula y sus números a la vista", /1\.?000 mL × 20 gotas\/mL ÷ 480 min = 41,7/.test(r) && /volumen ÷ \(horas × 3\)/.test(r));
    await page.click('#calcFactor .est-chip[data-valor="60"]');
    r = await resultado(page);
    verificar(`con microgotero: 125 microgotas/min (${r.split("\n")[0]})`, /^125 microgotas\/min/.test(r) && /microgotas\/min = mL\/h/.test(r));
    await page.selectOption("#calcTiempo", "min");
    await escribir(page, "tiempo", "30");
    await escribir(page, "volumenMl", "100");
    r = await resultado(page);
    verificar(`100 mL en 30 minutos con microgotero: 200 microgotas/min y 200 mL/h (${r.split("\n")[0]})`, /^200 microgotas\/min/.test(r) && /200 mL\/h/.test(r));
    await escribir(page, "volumenMl", "9000");
    r = await resultado(page);
    verificar(`un volumen fuera de rango lo dice en el campo y no calcula (${(await page.innerText("#calcErr_volumenMl")).trim()})`,
      /Entre 0,1 y 5\.000 mL/.test(await page.innerText("#calcErr_volumenMl")) && /Completá los datos/.test(r));
    await escribir(page, "volumenMl", "1.000,5abc");
    verificar("  ...y uno que no es un número también", /solo el número/.test(await page.innerText("#calcErr_volumenMl")));

    await elegir(page, "dosisPorPeso");
    r = await resultado(page);
    verificar(`dosis por peso: 15 mg/kg × 20 kg = 300 mg por dosis (${r.split("\n")[0]})`, /^300 mg por dosis/.test(r) && /15 mg\/kg × 20 kg = 300 mg/.test(r));
    await page.click('#calcPorDia .est-chip[data-valor="dia"]');
    await page.click('#calcTomas .est-chip[data-valor="3"]');
    await escribir(page, "dosisPorKg", "50");
    r = await resultado(page);
    verificar(`por día, en 3 tomas: 333,33 mg por toma y 1.000 mg por día (${r.split("\n")[0]})`,
      /^333,33 mg por toma/.test(r) && /1\.000 mg por día, en 3 tomas \(cada 8 h\)/.test(r));
    await page.click('#calcUnidadDosis .est-chip[data-valor="mcg"]');
    verificar("cambiar la unidad del medicamento cambia la del campo y conserva los números",
      (await page.$eval("#calc_dosisPorKg", (x) => x.parentElement.querySelector(".calc-u").innerText)) === "mcg/kg"
      && (await page.inputValue("#calc_dosisPorKg")) === "50");

    await elegir(page, "volumen");
    await page.click('#calcUnidadDosis .est-chip[data-valor="mg"]');
    r = await resultado(page);
    verificar(`volumen: 250 mg de 500 mg en 5 mL → 2,5 mL, concentración 100 mg/mL (${r.split("\n")[0]})`, /^2,5 mL/.test(r) && /100 mg\/mL/.test(r));
    await escribir(page, "dosis", "750");
    verificar("  ...una dosis mayor que la presentación avisa que hace falta más de una ampolla", /más de una ampolla/.test(await resultado(page)));

    await elegir(page, "dilucion");
    r = await resultado(page);
    verificar(`dilución: de 10 % a 2 %, 500 mL → 100 mL de la inicial y 400 de diluyente (${r.split("\n")[0]})`,
      /^100 mL de la solución inicial/.test(r) && /\+ 400 mL de diluyente, hasta 500 mL/.test(r) && /C1 × V1 = C2 × V2/.test(r));
    await escribir(page, "c2", "20");
    verificar("  ...pedir más concentración que la inicial no se calcula: se explica", /diluir no concentra/.test(await resultado(page)));

    await elegir(page, "infusion");
    r = await resultado(page);
    verificar(`infusión: 5 mcg/kg/min, 70 kg, 400 mg en 250 mL → 13,1 mL/h (${r.split("\n")[0]})`, /^13,1 mL\/h/.test(r) && /1\.600 mcg\/mL/.test(r));

    await elegir(page, "unidades");
    r = await resultado(page);
    verificar(`unidades: 0,5 g = 500 mg = 500.000 mcg (${r.replace(/\n/g, " ")})`, /0,5\s*g/.test(r) && /500\s*mg/.test(r) && /500\.000\s*mcg/.test(r));
    await page.click('#calcDe .est-chip[data-valor="%"]');
    await escribir(page, "valor", "0,9");
    r = await resultado(page);
    verificar(`0,9 % → 9 mg/mL (${r.split("\n")[0]})`, /^9 mg\/mL/.test(r) && /0,9 % = 0,9 g en 100 mL/.test(r));

    await elegir(page, "goteo");
    verificar("al volver a un cálculo, sus datos siguen ahí", (await page.inputValue("#calc_tiempo")) === "30" && (await page.inputValue("#calcTiempo")) === "min");
    const todo = await page.innerText("body");
    verificar("el aviso: la dosis la indica quien prescribe y la verifica el profesional a cargo", /formulario oficial/.test(todo) && /profesional a cargo/.test(todo));
    verificar("sin claves sin traducir", sinClaves(todo));
    verificar(`sin errores en la página${errores.length ? ": " + errores.join(" | ") : ""}`, errores.length === 0);
    if (process.env.CAPTURA) await page.screenshot({ path: path.join(process.env.CAPTURA, "calculadora.png"), fullPage: true });

    const pt = await entrar(TEL_PT);
    r = await resultado(pt.page);
    const cuerpoPt = await pt.page.innerText("body");
    verificar(`en portugués: «Cálculos de medicação», «Gotejamento», «exatas» (${r.split("\n")[0]})`,
      /Cálculos de medicação/.test(cuerpoPt) && /Gotejamento/.test(cuerpoPt) && /41,7 exatas/.test(r) && sinClaves(cuerpoPt));
    verificar(`  ...sin errores en la página${pt.errores.length ? ": " + pt.errores.join(" | ") : ""}`, pt.errores.length === 0);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill("SIGKILL");
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    if (copia) fs.rmSync(copia, { recursive: true, force: true });
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
