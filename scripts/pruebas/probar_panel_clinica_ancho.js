// Symphomed — El panel de la clínica en una laptop, y el menú de escritorio.
//
// Caso real: el administrador de una clínica abrió su panel en una laptop y
// vio una columna angosta de 480 px (la del celular) con los costados vacíos y
// las tablas cortadas («Juan Pérez Q…»). El administrador no tiene menú
// lateral; su pantalla era esta y heredaba el ancho de celular.
//
// Encontrado de paso, y también se prueba acá:
//   · «5 consultorios» en una clínica de 4: se contaba la cuenta administrativa
//     como si fuera un consultorio, y aparecía en la tabla como un médico;
//   · el menú de escritorio se armaba una sola vez, al cargar la página, con el
//     rol de la sesión ANTERIOR: quien iniciaba sesión sin recargar (lo normal)
//     no veía «Clínica» (director), «Ganadería» (veterinario) ni «Pagos»;
//   · la fecha de la agenda decía «2 De Octubre».
//
// Se usa el login real (la gente no recarga la página después de entrar), la
// clínica demo de scripts/seed_clinica_demo.js y un navegador de verdad.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3956;
const CLAVE = "Symphomed1234";

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
const correr = (archivo, args, env) => new Promise((resolve) => {
  const h = spawn(process.execPath, [path.join(RAIZ, "scripts", archivo), ...args], { cwd: RAIZ, env });
  let salida = ""; h.stdout.on("data", (d) => { salida += d; }); h.stderr.on("data", (d) => { salida += d; });
  h.on("exit", (codigo) => resolve({ codigo, salida }));
});

(async () => {
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "panel_clinica_prueba";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba" };
  let servidor, browser, mongoose;
  try {
    const seed = await correr("seed_clinica_demo.js", ["79000000", "Clínica Symphomed Demo", CLAVE], env);
    if (seed.codigo !== 0) throw new Error("el seed de la clínica falló:\n" + seed.salida.slice(-500));

    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    await M.Medico.updateOne({ phone: "79000001" }, { $set: { rol: "director" } });
    await M.Medico.create({ phone: "70031001", nombre: "Dra. Veterinaria", passwordHash: await hashPassword(CLAVE), activo: true, tipoEspecialidad: "veterinaria", especialidad: "Veterinaria" });

    servidor = spawn(process.execPath, [path.join(RAIZ, "index.js")], { cwd: RAIZ, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await new Promise((r) => setTimeout(r, 500)); }
    browser = await pw.chromium.launch({ executablePath: navegador() });

    // Entra por el login de verdad, sin recargar, y devuelve la página.
    //
    // UNA vez por cuenta: el login tiene un límite de 8 intentos cada 10 minutos
    // por IP (services/ratelimit.js, contra la fuerza bruta) y esta prueba
    // entra desde la misma IP. Para ver otro tamaño de pantalla se cambia el
    // tamaño y se recarga la página, que es lo que haría una persona (y la
    // sesión se restaura sola).
    const sesiones = [];
    async function entrar(phone, ancho, alto) {
      const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
      const page = await ctx.newPage();
      const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      await page.goto(`http://127.0.0.1:${PUERTO}/app`);
      await page.fill("#lPhone", phone);
      await page.fill("#lPass", CLAVE);
      await page.click("#lBtn");
      const sesion = { page, ctx, errores };
      sesiones.push(sesion);
      return sesion;
    }
    async function enTamano(sesion, ancho, alto) {
      await sesion.page.setViewportSize({ width: ancho, height: alto });
      // /app/inicio (de la sesión en el escritorio) en un celular abre el inicio
      // del escritorio: la pantalla de pacientes se pide por su dirección.
      await sesion.page.goto(`http://127.0.0.1:${PUERTO}/app/pacientes`);
    }
    const cajas = (page) => page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), r: Math.round(b.right) }; };
      const stats = [...document.querySelectorAll(".clin-ancho > .escr-stats .escr-stat")].map((e) => Math.round(e.getBoundingClientRect().top));
      const tablas = [...document.querySelectorAll(".clin-tabla-caja")].map((c) => ({ recortada: c.scrollWidth > c.clientWidth + 1, esAgenda: !!c.closest(".clin-agenda-card") }));
      const fecha = document.querySelector("#clinAgendaFecha > div:first-child");
      return {
        wrap: r("#app"), agenda: r(".clin-agenda-card"), ocupacion: r(".clin-ocupacion-card"), consultorios: r(".clin-consultorios-card"),
        stats, tablas, scrollPagina: document.documentElement.scrollWidth > innerWidth + 1,
        fechaMayusculas: fecha ? getComputedStyle(fecha).textTransform : null,
        fechaPrimeraLetra: fecha ? getComputedStyle(fecha, "::first-letter").textTransform : null,
        fechaTexto: fecha ? fecha.textContent : "",
        texto: document.body.innerText,
      };
    });

    console.log("── 1. El administrador en una laptop ──");
    const admin = await entrar("79000000", 1600, 804);
    for (const [ancho, alto] of [[1600, 804], [1366, 768]]) {
      const { page, errores } = admin;
      if (ancho !== 1600) await enTamano(admin, ancho, alto);
      await page.waitForSelector(".clin-agenda-card", { timeout: 25000 });
      await page.waitForTimeout(800);
      const c = await cajas(page);
      verificar(`${ancho}×${alto}: el panel usa el ancho (${c.wrap.w} px, ya no 480)`, c.wrap.w >= 1000);
      verificar(`${ancho}×${alto}: la página no se desplaza de costado`, !c.scrollPagina);
      verificar(`${ancho}×${alto}: las 4 cifras van en una sola fila`, c.stats.length === 4 && new Set(c.stats).size === 1);
      verificar(`${ancho}×${alto}: la agenda y la ocupación van lado a lado`, c.agenda.r <= c.ocupacion.x && Math.abs(c.agenda.y - c.ocupacion.y) <= 4);
      verificar(`${ancho}×${alto}: ninguna tabla queda cortada de costado`, c.tablas.length >= 4 && c.tablas.every((t) => !t.recortada));
      verificar(`${ancho}×${alto}: «actividad por consultorio» ocupa todo el ancho, debajo`, c.consultorios.w >= c.wrap.w - 80 && c.consultorios.y > c.agenda.y);
      verificar(`${ancho}×${alto}: sin errores de JavaScript`, !errores.length);
      if (ancho === 1600) {
        verificar("fecha de la agenda: solo la primera letra en mayúscula («2 de octubre», no «2 De Octubre»)",
          c.fechaMayusculas === "none" && c.fechaPrimeraLetra === "uppercase" && !/ De /.test(c.fechaTexto));
        verificar("«4 consultorios» y «4 Médicos»: la cuenta administrativa no cuenta como consultorio", /4 consultorios/.test(c.texto) && !/5 consultorios/.test(c.texto));
        const api = await page.evaluate(async () => ({ clinica: await api("/admin/clinica"), resumen: await api("/admin/resumen"), ocupacion: await api("/admin/ocupacion?dias=7") }));
        verificar("el servidor lista 4 médicos (sin el administrador) en el panel, el resumen y la ocupación",
          api.clinica.medicos.length === 4 && api.resumen.medicos.length === 4 && api.ocupacion.salas.length === 4
          && ![...api.clinica.medicos, ...api.resumen.medicos].some((m) => m.rol === "admin" || /^Administración/.test(m.nombre)));
      }
    }

    console.log("\n── 2. En el celular no cambia nada ──");
    {
      await enTamano(admin, 390, 844);
      const { page, errores } = admin;
      await page.waitForSelector(".clin-agenda-card", { timeout: 25000 });
      await page.waitForTimeout(800);
      const c = await cajas(page);
      verificar("la columna sigue siendo del ancho del celular", c.wrap.w <= 390);
      verificar("las tarjetas van una debajo de otra, en el mismo orden de siempre", c.agenda.x === c.ocupacion.x && c.agenda.y < c.consultorios.y && c.consultorios.y < c.ocupacion.y);
      verificar("la página no se desplaza de costado", !c.scrollPagina);
      verificar("sin errores de JavaScript", !errores.length);
    }

    console.log("\n── 3. El menú de escritorio, al iniciar sesión sin recargar ──");
    const director = await entrar("79000001", 1440, 800);
    {
      const { page, errores } = director;
      await page.waitForSelector(".escr-nav-item", { timeout: 25000 });
      const ids = await page.evaluate(() => [...document.querySelectorAll(".escr-nav-item")].map((b) => b.dataset.id));
      verificar(`un director ve «Clínica» primero en el menú (${ids.slice(0, 3).join(", ")}…)`, ids[0] === "clinica" && ids.includes("pacientes"));
      if (ids.includes("clinica")) {
        await page.click('.escr-nav-item[data-id="clinica"]');
        await page.waitForSelector(".clin-agenda-card", { timeout: 25000 });
        const c = await cajas(page);
        verificar("…y su panel adentro del menú lateral también va en columnas", c.agenda.r <= c.ocupacion.x && c.tablas.every((t) => !t.recortada));
      } else {
        verificar("…y su panel adentro del menú lateral también va en columnas (no hay a dónde tocar)", false);
      }
      verificar("sin errores de JavaScript", !errores.length);
    }
    {
      const { page } = await entrar("70031001", 1440, 800);
      await page.waitForSelector(".escr-nav-item", { timeout: 25000 });
      const ids = await page.evaluate(() => [...document.querySelectorAll(".escr-nav-item")].map((b) => b.dataset.id));
      verificar("un veterinario ve «Ganadería» (antes solo después de recargar)", ids.includes("ganaderia") && !ids.includes("clinica"));
      const operador = await page.evaluate(() => { ES_OPERADOR = true; return escrNavItems().map((i) => i.id); });
      verificar("un operador de pagos ve «Pagos» primero", operador[0] === "pagos");
    }
    // Un médico común: ni Clínica, ni Ganadería, ni Pagos. Con dos pacientes,
    // para las secciones 4 y 5 (la pantalla de inicio).
    await M.Medico.create({ phone: "70031002", nombre: "Dr. Común", passwordHash: await hashPassword(CLAVE), activo: true, tipoEspecialidad: "medicina_general" });
    await M.Paciente.create({ medicoPhone: "70031002", nombre: "Ana Paola Vargas" });
    await M.Paciente.create({ medicoPhone: "70031002", nombre: "Carlos Mamani Choque" });
    const comun = await entrar("70031002", 1440, 800);
    {
      await comun.page.waitForSelector(".escr-nav-item", { timeout: 25000 });
      const ids = await comun.page.evaluate(() => [...document.querySelectorAll(".escr-nav-item")].map((b) => b.dataset.id));
      verificar("un médico común no ve ninguno de los tres", !ids.some((i) => ["clinica", "ganaderia", "pagos"].includes(i)));
    }

    console.log("\n── 4. La pantalla de inicio en el celular: las tarjetas llegan hasta el mismo borde ──");
    // El saludo de arriba es un <button class="card">, y un botón se achica al
    // contenido: quedaba en 264 px cuando todo lo demás medía 358.
    for (const ancho of [360, 390]) {
      await enTamano(comun, ancho, 800);
      const { page, errores } = comun;
      await page.waitForSelector("#avatarHomeBox", { timeout: 25000 });
      await page.waitForSelector(".item-paciente", { timeout: 25000 });
      const m = await page.evaluate(() => {
        const w = (s) => Math.round(document.querySelector(s).getBoundingClientRect().width);
        return { saludo: w("#avatarHomeBox"), paciente: w(".item-paciente"), buscador: w("input[placeholder*='uscar']") };
      });
      verificar(`${ancho} px: el saludo mide lo mismo que las tarjetas de pacientes y el buscador (${m.saludo} / ${m.paciente} / ${m.buscador})`,
        Math.abs(m.saludo - m.paciente) <= 1 && Math.abs(m.saludo - m.buscador) <= 1);
      verificar(`${ancho} px: sin errores de JavaScript`, !errores.length);
    }

    console.log("\n── 5. La barra de acciones del inicio, con aire, en celular ──");
    // «Recordatorios» y «Configuración» miden ~72 px y las columnas de una sola
    // fila ~75: 3 px de aire, y los textos pegados entre sí y al borde. La app
    // está en una columna de 480 px en todo lo que no sea el panel de
    // escritorio, así que también a 700 px.
    const medirBarra = (page) => page.evaluate(() => {
      const items = [...document.querySelectorAll(".tabs-inicio .tab")].map((t) => {
        const b = t.getBoundingClientRect();
        let texto = 0;
        for (const n of t.childNodes) {
          if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); texto = Math.max(texto, rg.getBoundingClientRect().width); }
        }
        return { top: Math.round(b.top), ancho: b.width, texto };
      });
      const filas = [...new Set(items.map((i) => i.top))].sort((a, b) => a - b).map((t) => items.filter((i) => i.top === t).length);
      const enc = document.querySelector("#headerSub");
      return { filas, aire: Math.round(Math.min(...items.map((i) => (i.ancho - i.texto) / 2))), saludoTarjeta: document.querySelector("#avatarHomeBox").innerText, encabezado: enc ? enc.innerText : document.body.innerText.slice(0, 300) };
    });
    for (const [sesion, nombre, esperadas] of [[comun, "médico (5 botones)", [3, 2]], [director, "director (6 botones)", [3, 3]]]) {
      for (const ancho of [360, 390, 700]) {
        await enTamano(sesion, ancho, 844);
        await sesion.page.waitForSelector(".tabs-inicio .tab", { timeout: 25000 });
        const m = await medirBarra(sesion.page);
        verificar(`${nombre} a ${ancho} px: ${m.filas.join(" + ")} por fila y ${m.aire} px de aire por lado como mínimo`,
          JSON.stringify(m.filas) === JSON.stringify(esperadas) && m.aire >= 6);
        if (sesion === comun && ancho === 390) {
          verificar("la tarjeta de arriba dice la especialidad, no repite el saludo del encabezado",
            /Medicina general/.test(m.saludoTarjeta) && !/Hola/.test(m.saludoTarjeta) && /Hola/.test(m.encabezado));
        }
        verificar(`${nombre} a ${ancho} px: sin errores de JavaScript`, !sesion.errores.length);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill();
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
