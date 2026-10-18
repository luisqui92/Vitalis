// Symphomed — Los errores de la pantalla llegan al servidor (public/js/errores.js).
//
// Caso real: un médico vio «Erro ao carregar a consulta» y nos enteramos por
// una foto, sin saber qué había fallado. Lo que se prueba:
//   · que lo que llega se limpia (teléfonos, correos, ids) y se agrupa;
//   · que el ruido (cortes de red, respuestas del servidor) no se manda;
//   · de punta a punta con el JS OFUSCADO, como en producción: un error en
//     la pantalla de la consulta llega solo, y el script lo traduce a la
//     línea del código original con el mapa de esa versión.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3962;

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
function cargarPlaywright() {
  for (const c of ["playwright", "/opt/node22/lib/node_modules/playwright", path.join(RAIZ, "node_modules", "playwright")]) {
    try { return require(c); } catch { /* seguimos */ }
  }
  return null;
}
const traer = (ruta) => new Promise((ok, mal) => { const r = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta }, (x) => { x.resume(); x.on("end", () => ok(x.statusCode)); }); r.on("error", mal); });
function postear(cuerpo, ip, token) {
  return new Promise((resolve) => {
    const datos = JSON.stringify(cuerpo);
    const req = http.request({ host: "127.0.0.1", port: PUERTO, method: "POST", path: "/errores-cliente",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(datos), "x-forwarded-for": ip, ...(token ? { authorization: "Bearer " + token } : {}) } },
    (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", () => resolve(0));
    req.end(datos);
  });
}

(async () => {
  console.log("── 1. Lo que llega se limpia ──");
  const { limpiar, primerMarco } = require(path.join(RAIZ, "services", "erroresCliente"));
  const l = limpiar("falló con 59170012345 y ana@mail.com en 0123456789abcdef01234567", 300);
  verificar("teléfonos, correos e ids se tapan", !/59170012345|ana@mail|0123456789abcdef/.test(l) && /#/.test(l) && /«correo»/.test(l) && /:id/.test(l));
  // El ofuscado es una sola línea: pasada la mitad, la columna tiene seis cifras.
  const pila = limpiar("TypeError: x\n    at renderDetalle (https://app.symphomed.com/js/consultas.js:1:104213) 59170012345", 300);
  verificar(`  ...pero no el lugar en el código, aunque la columna tenga seis cifras (${pila.replace(/\n\s*/g, " ")})`,
    /consultas\.js:1:104213/.test(pila) && !/59170012345/.test(pila) && JSON.stringify(primerMarco(pila)) === JSON.stringify({ archivo: "consultas.js", linea: 1, columna: 104213 }));
  verificar("de la pila se toma el primer lugar de nuestro código", JSON.stringify(primerMarco("at x (https://app.symphomed.com/js/consultas.js:1:48213)")) === JSON.stringify({ archivo: "consultas.js", linea: 1, columna: 48213 }));

  const pw = cargarPlaywright();
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  El resto SALTEADO: falta Playwright o la base. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "errores_pantalla";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO) };
  let servidor, browser, mongoose, copia;
  try {
    // Una copia del proyecto, ofuscada como en un despliegue.
    copia = fs.mkdtempSync(path.join(require("os").tmpdir(), "symphomed-errores-"));
    for (const x of fs.readdirSync(RAIZ)) {
      if ([".git", "ofuscado-mapas"].includes(x)) continue;
      if (x === "node_modules") fs.symlinkSync(path.join(RAIZ, x), path.join(copia, x));
      else fs.cpSync(path.join(RAIZ, x), path.join(copia, x), { recursive: true });
    }
    const of = spawnSync(process.execPath, [path.join(copia, "scripts", "ofuscar.js")], { cwd: copia, encoding: "utf8" });
    if (of.status !== 0) throw new Error("ofuscar falló:\n" + of.stdout + of.stderr);
    const version = JSON.parse(fs.readFileSync(path.join(copia, "ofuscado-mapas", "actual.json"), "utf8")).version;
    verificar(`el despliegue deja los mapas fuera de public/ (versión ${version})`, fs.existsSync(path.join(copia, "ofuscado-mapas", version, "consultas.js.map"))
      && !fs.readdirSync(path.join(copia, "public", "js")).some(f => f.endsWith(".map")));
    verificar("  ...y el ofuscado no dice dónde está su mapa", !/sourceMappingURL/.test(fs.readFileSync(path.join(copia, "public", "js", "consultas.js"), "utf8")));

    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require(path.join(RAIZ, "node_modules", "mongoose"));
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.create({ phone: "70043001", nombre: "Dr. Errores", passwordHash: await hashPassword("Prueba123."), activo: true });
    servidor = spawn(process.execPath, [path.join(copia, "index.js")], { cwd: copia, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }

    console.log("\n── 2. La ruta ──");
    const tk = generarToken("70043001", "medico", 36e5);
    const e1 = { mensaje: "x is not a function", pila: "at f (https://app.symphomed.com/js/agenda.js:1:500)", pantalla: "/app/agenda" };
    verificar("sin sesión → 204, se guarda", (await postear(e1, "203.0.113.1")) === 204);
    await postear(e1, "203.0.113.1", tk);
    await esperar(300);
    const g = await M.ErrorCliente.find({ mensaje: "x is not a function" }).lean();
    verificar("el mismo error dos veces → una fila con «2 veces», y a qué médico le pasó", g.length === 1 && g[0].veces === 2 && g[0].medicos.join() === "70043001");
    let ultimo = 204;
    for (let i = 0; i < 31; i++) ultimo = await postear({ mensaje: "otro " + i }, "203.0.113.9");
    verificar("más de 30 avisos en 10 minutos desde el mismo lugar → se cortan (429)", ultimo === 429);

    console.log("\n── 3. De punta a punta, con el JS ofuscado ──");
    browser = await pw.chromium.launch({ executablePath: ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", process.env.CHROMIUM_PATH].find(p => p && fs.existsSync(p)) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${PUERTO}/app`);
    await page.fill("#lPhone", "70043001"); await page.fill("#lPass", "Prueba123."); await page.click("#lBtn");
    await page.waitForSelector("#avatarHomeBox", { timeout: 20000 });
    // Una consulta con una forma que la pantalla no espera: un error de verdad
    // adentro de renderDetalle, en el código ofuscado.
    const ID = "0123456789abcdef01234599";
    await page.route(`**/medico/consultas/${ID}`, (r) => r.fulfill({ json: { consulta: { _id: ID, createdAt: new Date().toISOString(), estado: "completado",
      notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "x", medicamentosRecetados: "texto en vez de lista" } } } }));
    const t0 = Date.now();
    await page.evaluate((id) => { renderDetalle(id); }, ID);
    await page.waitForSelector("#btnReintentarDetalle", { timeout: 15000 }).catch(() => {});
    verificar("un error de la pantalla (no del servidor) se muestra enseguida, sin reintentos inútiles", Date.now() - t0 < 2500);
    let reg = null;
    for (let i = 0; i < 40 && !reg; i++) { reg = await M.ErrorCliente.findOne({ contexto: "renderDetalle" }).lean(); if (!reg) await esperar(250); }
    verificar("…y llega solo al servidor, con la pantalla, el médico y la versión", !!reg && reg.medicos.includes("70043001") && reg.version === version && /\/app/.test(reg.pantalla));
    // Ruido: una respuesta 404 sin atrapar y un corte de red no se mandan.
    const antes = await M.ErrorCliente.countDocuments();
    await page.evaluate(() => { Promise.reject({ status: 404, error: "no" }); Promise.reject(new TypeError("Failed to fetch")); });
    await esperar(1500);
    verificar("una respuesta del servidor o un corte de red sin atrapar no se mandan", (await M.ErrorCliente.countDocuments()) === antes);
    await page.evaluate(() => { setTimeout(() => { throw new Error("error global de prueba"); }, 0); });
    let glob = null;
    for (let i = 0; i < 40 && !glob; i++) { glob = await M.ErrorCliente.findOne({ mensaje: "error global de prueba" }).lean(); if (!glob) await esperar(250); }
    verificar("un error suelto, fuera de cualquier pantalla, también llega", !!glob && glob.contexto === "global");

    console.log("\n── 4. El script lo traduce al código original ──");
    const r = spawnSync(process.execPath, [path.join(copia, "scripts", "errores_pantalla.js")], { cwd: copia, env, encoding: "utf8" });
    const salida = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
    const linea = (salida.split("\n").find(x => /dónde: consultas\.js:\d+/.test(x)) || "").trim();
    verificar(`dice el archivo y la línea ORIGINAL, con el código («${linea.slice(0, 110)}»)`, /dónde: consultas\.js:\d+\s+→\s+\S/.test(linea) && !/consultas\.js:1:\d{4,}/.test(linea));
    verificar("  ...y cuántas veces y a cuántos médicos", /1 vez\/veces · 1 médico/.test(salida));
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
