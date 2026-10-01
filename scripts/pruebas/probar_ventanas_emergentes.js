// Symphomed — La pestaña del PDF que abre un iframe de otro dominio.
//
// Caso real: en Brasil, un médico tocó «baixar» la receta en el módulo de
// Memed desde la PC y se quedó cargando para siempre: ni PDF ni error.
//
// Memed corre en un iframe de su dominio. Abre la pestaña al tocar el botón
// (si la abriera después, el navegador la bloquearía), genera el PDF y
// recién ahí la manda al PDF. Con Cross-Origin-Opener-Policy: same-origin
// —lo que helmet pone por defecto— esa pestaña le vuelve como null.
//
// Acá se reproduce con un navegador real: una página con la cabecera, un
// iframe de otro origen que hace lo mismo que Memed, y se mira si el PDF
// llega. Con same-origin NO llega (así se comprueba que la prueba detecta
// el problema); con la de index.js, sí.
const http = require("http");
const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

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
  return undefined; // que Playwright use el suyo
}

// La política que de verdad manda Symphomed, leída de index.js.
function politicaDeSymphomed() {
  const m = fs.readFileSync(path.join(RAIZ, "index.js"), "utf8").match(/crossOriginOpenerPolicy:\s*\{\s*policy:\s*"([^"]+)"/);
  return m ? m[1] : "same-origin"; // sin nada, helmet pone same-origin
}

const PUERTO_A = 3961, PUERTO_B = 3962;

const memedFalso = http.createServer((q, r) => {
  if (q.url === "/receta.pdf") { r.setHeader("content-type", "application/pdf"); return r.end("%PDF-1.4 receta"); }
  r.setHeader("content-type", "text/html");
  r.end(`<button id="b" onclick="
    const w = window.open('about:blank', '_blank');
    window.estado = { abrio: !!w };
    setTimeout(() => {
      try { w.location.href = 'http://localhost:${PUERTO_B}/receta.pdf'; window.estado.mando = true; }
      catch (e) { window.estado.error = e.message; }
    }, 800);
  ">Baixar PDF</button>`);
});

async function probar(browser, coop) {
  const symphomed = http.createServer((q, r) => {
    r.setHeader("Cross-Origin-Opener-Policy", coop);
    r.setHeader("content-type", "text/html");
    r.end(`<iframe src="http://localhost:${PUERTO_B}/modulo"></iframe>`);
  });
  await new Promise(r => symphomed.listen(PUERTO_A, "127.0.0.1", r));
  const ctx = await browser.newContext();
  let llegoPdf = false;
  ctx.on("page", p => p.on("response", res => { if (res.url().endsWith("/receta.pdf")) llegoPdf = true; }));
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PUERTO_A}/`);
  const frame = page.frames().find(f => f.url().includes(String(PUERTO_B)));
  await frame.click("#b");
  for (let i = 0; i < 30 && !llegoPdf; i++) await page.waitForTimeout(100);
  const estado = await frame.evaluate(() => window.estado);
  await ctx.close();
  symphomed.close();
  return { llegoPdf, estado };
}

(async () => {
  const pw = cargarPlaywright();
  if (!pw) { console.log("⏭️  SALTEADA: no hay Playwright. Esto NO es un ✅."); process.exit(0); }
  await new Promise(r => memedFalso.listen(PUERTO_B, r));
  const browser = await pw.chromium.launch({ executablePath: navegador() });
  try {
    const malo = await probar(browser, "same-origin");
    verificar("con same-origin (lo de antes) el PDF NO llega: la prueba detecta el problema", !malo.llegoPdf && !malo.estado?.abrio);
    const coop = politicaDeSymphomed();
    const bueno = await probar(browser, coop);
    verificar(`con la de Symphomed (${coop}) la pestaña se abre y el PDF llega`, bueno.llegoPdf && bueno.estado?.abrio);
  } finally {
    await browser.close();
    memedFalso.close();
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
