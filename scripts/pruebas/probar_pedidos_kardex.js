// Symphomed — Recorrer las pestañas del Kardex no puede trabar al médico.
//
// Caso encontrado en la revisión de QA: el Kardex se repinta entero en cada
// pestaña, y tres cajas (persona de la clínica, teleconsultas, resúmenes
// compartidos) volvían a pedirse al servidor en cada clic. Recorrer las
// pestañas de tres pacientes eran 118 pedidos en 25 segundos; el servidor
// corta a los 60 por minuto y el médico veía «Demasiadas peticiones».
//
// Lo que se prueba, con el servidor real y un navegador:
//   · cambiar de pestaña no vuelve a pedir esas cajas (apiReciente, estado.js);
//   · ningún pedido termina bloqueado (429);
//   · y lo recordado NO deja ver algo viejo: abrir un paciente lo trae fresco,
//     y guardar un cambio (las alergias) lo vuelve a pedir.
const path = require("path");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3958;

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
function traer(ruta) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "pedidos_kardex_prueba";
  const salida = { texto: "" };
  const proceso = spawn(process.execPath, [path.join(RAIZ, "index.js")], {
    cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proceso.stdout.on("data", d => salida.texto += d);
  proceso.stderr.on("data", d => salida.texto += d);
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      if (proceso.exitCode !== null) throw new Error("Symphomed no arrancó:\n" + salida.texto.slice(-2000));
      try { if (await traer("/health") === 200) break; } catch { /* todavía no */ }
      await new Promise(r => setTimeout(r, 500));
    }
    process.env.MONGODB_URI = uri;
    process.env.JWT_SECRET = "x".repeat(64);
    const mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
    const TEL = "70000555";
    await M.Medico.create({ phone: TEL, nombre: "Dra. Pestañas", passwordHash: await hashPassword("Prueba123."), tipoEspecialidad: "medicina_general" });
    const pacientes = [];
    for (let i = 0; i < 3; i++) pacientes.push(await M.Paciente.create({ medicoPhone: TEL, nombre: `Paciente ${i + 1}` }));
    const token = generarToken(TEL, "medico", 36e5);

    browser = await pw.chromium.launch({ executablePath: navegador() });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((tk) => { localStorage.setItem("salud_token", tk); localStorage.setItem("salud_nombre", "Dra. Pestañas"); }, token);
    const page = await ctx.newPage();
    const pedidos = [];
    let bloqueados = 0;
    page.on("request", r => pedidos.push(r.url().replace(/^https?:\/\/[^/]+/, "")));
    page.on("response", r => { if (r.status() === 429) bloqueados++; });
    const errores = [];
    page.on("pageerror", e => errores.push(e.message));

    await page.goto(`http://127.0.0.1:${PUERTO}/app/pacientes`);
    await page.waitForSelector(".item", { timeout: 15000 });
    const desde = pedidos.length;
    let pestañas = 0;
    for (let p = 0; p < pacientes.length; p++) {
      // Como un médico: tocar el paciente en la lista y recorrer todas sus pestañas.
      await page.locator(".item").nth(p).click();
      await page.waitForSelector(".tab", { timeout: 10000 });
      const n = await page.locator(".tab").count();
      for (let i = 0; i < n; i++) { await page.locator(".tab").nth(i).click(); await page.waitForTimeout(250); pestañas++; }
      await page.locator("#btnBack").click();
      await page.waitForSelector(".item", { timeout: 10000 });
    }
    const recorrido = pedidos.slice(desde);
    const cuantos = (re) => recorrido.filter(u => re.test(u)).length;
    verificar(`${pestañas} pestañas en ${pacientes.length} pacientes: la persona se pidió ${cuantos(/\/persona$/)} veces (una por paciente)`, cuantos(/\/persona$/) === pacientes.length);
    verificar(`  ...las teleconsultas ${cuantos(/\/medico\/teleconsultas$/)} y los resúmenes ${cuantos(/\/resumenes$/)} (una por paciente, no por pestaña)`,
      cuantos(/\/medico\/teleconsultas$/) <= pacientes.length && cuantos(/\/resumenes$/) <= pacientes.length);
    verificar(`ningún pedido bloqueado por el límite (total: ${recorrido.length})`, bloqueados === 0);

    // Lo recordado no puede mostrar algo viejo: guardar alergias lo vuelve a pedir.
    await page.locator(".item").first().click();
    // El campo de alergias está en «Más acciones», que arranca plegado.
    await page.waitForSelector(".kardex-mas summary", { timeout: 10000 });
    await page.click(".kardex-mas summary");
    await page.waitForSelector("#btnGuardarAlergias", { timeout: 10000 });
    await page.fill("#personaAlergias", "Penicilina");
    const antes = pedidos.filter(u => /\/persona$/.test(u)).length;
    await page.click("#btnGuardarAlergias");
    await page.waitForTimeout(800);
    await page.locator(".tab").nth(1).click();
    await page.waitForTimeout(800);
    verificar("después de guardar un cambio, se vuelve a pedir (nada viejo en pantalla)", pedidos.filter(u => /\/persona$/.test(u)).length > antes);
    verificar("  ...y la alergia guardada se ve arriba del Kardex", /Penicilina/.test(await page.locator(".persona-alergias").innerText().catch(() => "")));
    // La regla por sí sola, sin el aviso de cambio del servidor de por medio
    // (que también olvida, y taparía si esta regla se rompe).
    // Se apagan los avisos de cambio del servidor mientras tanto (si llega
    // uno, olvida todo y la cuenta deja de medir esta regla), y se usa una
    // dirección que ninguna pantalla pide sola (el estado de la
    // teleconsulta se pide una vez por sesión y queda en una variable).
    await page.waitForTimeout(1500);
    const regla = await page.evaluate(async (id) => {
      window.refrescarPantallaActual = () => {};
      const RUTA = "/medico/teleconsulta/estado";
      const veces = () => performance.getEntriesByType("resource").filter(e => e.name.endsWith(RUTA)).length;
      olvidarApiReciente();
      const a = veces();
      await apiReciente(RUTA);
      await apiReciente(RUTA);
      const b = veces();
      // Un POST sin efectos (la vista previa de un resumen) cuenta como cambio.
      await api(`/medico/pacientes/${id}/resumenes/previa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alcance: "resumen" }) }).catch(() => {});
      await apiReciente(RUTA);
      return { dosVecesUnPedido: b - a === 1, despuesDelCambio: veces() - b === 1 };
    }, String(pacientes[0]._id));
    verificar("pedir dos veces lo mismo seguido → un solo pedido", regla.dosVecesUnPedido);
    verificar("cualquier cambio (un POST) olvida lo recordado → se vuelve a pedir", regla.despuesDelCambio);
    verificar("sin errores de JavaScript", !errores.length);
    await mongoose.disconnect();
  } finally {
    if (browser) await browser.close();
    proceso.kill();
    await mongod.stop();
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
