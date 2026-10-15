// Symphomed — El módulo de estudiantes: la frontera y el interruptor.
//
// ═══ POR QUÉ ═════════════════════════════════════════════════════════════
//
// Todo lo de estudiantes vive en modulos/estudiantes/ (servidor) y en
// public/js/estudiantes*.js (pantalla), y entra al núcleo solo por los
// puntos de extensión (services/extensiones.js, public/js/extensiones.js).
// Eso no se sostiene solo: alcanza con que alguien, apurado, escriba
// `if (req.adminUser.estudiante)` en una ruta del núcleo, o llame a una
// función del módulo desde pacientes.js, para que el módulo vuelva a estar
// desparramado. Esta prueba es la que lo nota.
//
// Y el interruptor (MODULO_ESTUDIANTES=apagado): apagado, el módulo deja de
// ofrecer lo suyo, pero las reglas de las cuentas que ya existen SIGUEN. Un
// estudiante nunca puede pasar a recetar porque alguien apagó el módulo.
//
//   1. El servidor: el núcleo no importa el módulo ni nombra al estudiante.
//   2. La pantalla: lo mismo, más el orden de carga y los estilos.
//   3. El interruptor, en el proceso: qué se engancha y qué rutas hay.
//   4. Los puntos de extensión por dentro (servidor y pantalla): qué pasa si
//      un módulo falla, se engancha mal o pide algo que no existe.
//   5. El interruptor apagado de punta a punta: el servidor de verdad y un
//      navegador, con una cuenta de estudiante que ya existía.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = 3972;
// La configuración se queja (con razón) si falta: acá es una prueba.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// El código sin comentarios: lo que se ejecuta. Los comentarios pueden
// contar la historia («antes un estudiante…»); el código no puede depender
// del módulo.
function sinComentarios(codigo) {
  let out = "", i = 0, cadena = null;
  while (i < codigo.length) {
    const c = codigo[i], d = codigo[i + 1];
    if (!cadena) {
      if (c === "/" && d === "/") { while (i < codigo.length && codigo[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") {
        i += 2;
        while (i < codigo.length && !(codigo[i] === "*" && codigo[i + 1] === "/")) { if (codigo[i] === "\n") out += "\n"; i++; }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") cadena = c;
      out += c; i++; continue;
    }
    if (c === "\\") { out += c + (d || ""); i += 2; continue; }
    if (c === cadena) cadena = null;
    out += c; i++;
  }
  return out;
}

const archivosJs = (dir, filtro = () => true) => fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? archivosJs(path.join(dir, e.name), filtro) : (e.name.endsWith(".js") && filtro(e.name) ? [path.join(dir, e.name)] : []));

const NOMBRA_AL_MODULO = /estudiant|tutorClinico|simulacro|pacientes?Virtual|pacientes-virtuales|razonamientoDiagnostico|TarjetaEstudio|RachaEstudio|CodigoEstudiante/i;

console.log("── 1. El servidor: el núcleo no conoce al módulo ──");
{
  const nucleo = [...archivosJs("routes"), ...archivosJs("services"), ...archivosJs("db"), ...archivosJs("config"), "index.js"];
  verificar(`se revisan ${nucleo.length} archivos del núcleo`, nucleo.length > 80);
  const importan = nucleo.filter(f => f !== "index.js" && /require\([^)]*modulos/.test(sinComentarios(leer(f))));
  verificar(`ninguno hace require de modulos/${importan.length ? ` (lo hacen: ${importan.join(", ")})` : ""}`, importan.length === 0);
  verificar("  ...salvo index.js, que es donde se montan", /require\("\.\/modulos\/estudiantes"\)/.test(leer("index.js")));

  // Lo único que queda en el núcleo, a propósito y en producción desde la
  // etapa 1: la forma de la cuenta y la marca de las notas (db/models.js),
  // la variable del interruptor (config) y el montaje (index.js).
  const PERMITIDO = [
    ["db/models.js", /^\s*estudiante: \{$/],
    ["db/models.js", /^\s*nivel: \{ type: String, enum: \["estudiante", "interno", "residente"\] \},$/],
    ["db/models.js", /^\s*deEstudiante: \{ type: Boolean, default: false \},$/],
    ["config/index.js", /^\s*MODULO_ESTUDIANTES: process\.env\.MODULO_ESTUDIANTES \|\| "prendido",$/],
    ["index.js", /^const MODULOS = \[require\("\.\/modulos\/estudiantes"\)\];$/],
  ];
  const nombran = [];
  for (const f of nucleo) {
    sinComentarios(leer(f)).split("\n").forEach((linea, i) => {
      if (!NOMBRA_AL_MODULO.test(linea)) return;
      if (PERMITIDO.some(([archivo, re]) => archivo === f && re.test(linea))) return;
      nombran.push(`${f}:${i + 1}: ${linea.trim().slice(0, 100)}`);
    });
  }
  verificar(`ni una línea de código del núcleo nombra al estudiante${nombran.length ? `:\n     ${nombran.join("\n     ")}` : ""}`, nombran.length === 0);

  // El módulo entra por los puntos que el núcleo declaró: si el núcleo usa
  // uno que no está en la lista, el servidor no arranca (services/extensiones.js).
  const ext = require(path.join(RAIZ, "services", "extensiones"));
  const usados = new Set();
  for (const f of nucleo) for (const m of sinComentarios(leer(f)).matchAll(/extensiones\.(?:sumar|revisar|permite|lista|extras)\("([\w.]+)"/g)) usados.add(m[1]);
  const sinDeclarar = [...usados].filter(p => !ext.PUNTOS[p]);
  verificar(`el núcleo llama ${usados.size} puntos de extensión, todos declarados`, usados.size >= 9 && sinDeclarar.length === 0);
  const sinUso = Object.keys(ext.PUNTOS).filter(p => !usados.has(p));
  verificar(`  ...y no hay puntos declarados que el núcleo no llame${sinUso.length ? ` (${sinUso.join(", ")})` : ""}`, sinUso.length === 0);
}

console.log("\n── 1b. Lo que puede un estudiante, ruta por ruta ──");
{
  // Las rutas de verdad, leídas del código (routes/, modulos/ e index.js).
  const fuentes = [...archivosJs("routes"), ...archivosJs("modulos"), "index.js"];
  const rutas = [];
  for (const f of fuentes) {
    for (const m of leer(f).matchAll(/app\.(get|post|put|patch|delete)\(\s*"(\/medico\/[^"]+)"/g)) rutas.push({ metodo: m[1].toUpperCase(), ruta: m[2], f });
  }
  const { rutaPermitida, ESCRITURA_PERMITIDA } = require(path.join(RAIZ, "modulos", "estudiantes", "restricciones"));
  const ejemplo = (r) => r.replace(/:[A-Za-z]+/g, "a1b2c3");
  const escrituras = rutas.filter(r => r.metodo !== "GET");
  verificar(`se leyeron ${rutas.length} rutas de médico (${escrituras.length} que escriben)`, rutas.length > 250 && escrituras.length > 150);
  const abiertas = escrituras.filter(r => rutaPermitida(r.metodo, ejemplo(r.ruta)));
  const muertas = ESCRITURA_PERMITIDA.filter(([metodos, re]) => !escrituras.some(r => metodos.split(" ").includes(r.metodo) && re.test(ejemplo(r.ruta).toLowerCase())));
  verificar(`cada entrada de la lista de lo permitido es una ruta que existe${muertas.length ? ` (sobran: ${muertas.map(([m, re]) => m + " " + re).join(", ")})` : ""}`, muertas.length === 0);
  // Lo que un estudiante no hace nunca, aunque mañana alguien agrande la lista.
  const NUNCA = /\/(recetas|recetas-opticas|memed|reconsulta|tratamientos-sugeridos|tratamientos|catalogo-tratamientos|insumos|informes|informes-familia|membrete|llave|resumenes|citas|horario|teleconsulta|teleconsultas|recargas|whatsapp|dicom|rayos|equipos|equipo|captura|persona|personas|backups|operador|solicitudes-cuenta|registro)(\/|$)/;
  const sensibles = abiertas.filter(r => NUNCA.test(r.ruta));
  verificar(`ninguna escritura sensible abierta (recetas, informes, membrete, turnos, cobros, compartir…)${sensibles.length ? `: ${sensibles.map(r => r.metodo + " " + r.ruta).join(", ")}` : ""}`, sensibles.length === 0);
  verificar(`  ...y lo abierto es lo de siempre: ${abiertas.length} de ${escrituras.length} escrituras`, abiertas.length >= 70 && abiertas.length <= 100);
  // E01: con mayúsculas o una barra al final, Express encuentra la misma
  // ruta; el freno tiene que decidir lo mismo.
  const distinto = rutas.filter(r => {
    const base = ejemplo(r.ruta);
    const dice = rutaPermitida(r.metodo, base);
    return [base.toUpperCase(), base + "/", base.replace("/medico/", "/Medico/") + "/"].some(v => rutaPermitida(r.metodo, v) !== dice);
  });
  verificar(`en las ${rutas.length} rutas, mayúsculas o barra final no cambian la decisión${distinto.length ? `: ${distinto.slice(0, 3).map(r => r.metodo + " " + r.ruta).join(", ")}` : ""}`, distinto.length === 0);
}

console.log("\n── 2. La pantalla: las del núcleo no conocen al módulo ──");
{
  const delModulo = archivosJs(path.join("public", "js"), n => n.startsWith("estudiantes"));
  const nucleo = archivosJs(path.join("public", "js"), n => !n.startsWith("estudiantes"));
  verificar(`el módulo son ${delModulo.length} archivos (public/js/estudiantes*.js)`, delModulo.length === 6);
  const nombran = [];
  for (const f of nucleo) {
    sinComentarios(leer(f)).split("\n").forEach((linea, i) => {
      if (NOMBRA_AL_MODULO.test(linea)) nombran.push(`${f}:${i + 1}: ${linea.trim().slice(0, 100)}`);
    });
  }
  verificar(`ninguna pantalla del núcleo nombra al estudiante${nombran.length ? `:\n     ${nombran.join("\n     ")}` : ""}`, nombran.length === 0);

  // Ni usa ningún nombre global del módulo (una función, una constante): todo
  // pasa por Extensiones. (Una clave de objeto que se llame igual no cuenta.)
  const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  const globales = new Set();
  for (const f of delModulo) for (const m of leer(f).matchAll(DECL)) globales.add(m[1] || m[2]);
  const usos = [];
  for (const f of nucleo) {
    const codigo = sinComentarios(leer(f));
    for (const nombre of globales) {
      if (new RegExp(`(?<![\\w$.])${nombre.replace(/\$/g, "\\$")}(?![\\w$])(?!\\s*:)`).test(codigo)) usos.push(`${f} usa «${nombre}»`);
    }
  }
  verificar(`ninguna usa los ${globales.size} nombres globales del módulo${usos.length ? `:\n     ${usos.join("\n     ")}` : ""}`, globales.size > 50 && usos.length === 0);

  const html = leer("index.html");
  const pos = (src) => html.indexOf(`<script src="${src}"></script>`);
  verificar("index.html carga /modulos.js y los puntos de extensión antes que cualquier pantalla",
    pos("/modulos.js") > 0 && pos("/modulos.js") < pos("/js/extensiones.js") && pos("/js/extensiones.js") < pos("/js/estado.js"));
  const scriptsModulo = delModulo.map(f => pos("/js/" + path.basename(f)));
  verificar("  ...los del módulo después del núcleo (consultas.js, pacientes.js)",
    scriptsModulo.every(p => p > pos("/js/consultas.js") && p > pos("/js/pacientes.js")));
  verificar("  ...y antes de escritorio.js, realtime.js y rutas.js, que toman de ahí sus pantallas",
    scriptsModulo.every(p => p > 0 && p < pos("/js/escritorio.js") && p < pos("/js/realtime.js") && p < pos("/js/rutas.js")));

  const reglas = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map(m => m[1].trim()).filter(s => !s.startsWith("@"));
  // calc-: la calculadora de medicación (public/js/estudiantesCalculadora.js).
  const CLASE_DEL_MODULO = /\.(tutor|est|pv|sim|calc)-/;
  verificar("estilos.css no tiene estilos del módulo", !reglas(leer("public", "estilos.css")).some(s => CLASE_DEL_MODULO.test(s)));
  const propias = reglas(leer("public", "estudiantes.css"));
  verificar(`estudiantes.css solo tiene los suyos (${propias.length} reglas)`, propias.length > 50 && propias.every(s => s.split(",").every(x => CLASE_DEL_MODULO.test(x))));
  verificar("  ...y se carga después de estilos.css", html.indexOf('href="/estudiantes.css"') > html.indexOf('href="/estilos.css"'));
}

console.log("\n── 3. El interruptor, en el proceso ──");
{
  // Cada caso en su propio proceso: los enganches son de todo el proceso.
  const montar = (valor) => {
    const codigo = `
      process.env.MONGODB_URI = "mongodb://127.0.0.1:1/x";
      const { CONFIG } = require(${JSON.stringify(path.join(RAIZ, "config"))});
      CONFIG.MODULO_ESTUDIANTES = ${JSON.stringify(valor)};
      const app = require("express")();
      require(${JSON.stringify(path.join(RAIZ, "modulos", "estudiantes"))}).montar(app);
      const rutas = app._router.stack.filter(l => l.route).map(l => Object.keys(l.route.methods)[0].toUpperCase() + " " + l.route.path);
      const middlewares = app._router.stack.filter(l => !l.route && l.name === "middlewareEstudiantes").length;
      console.log("@@" + JSON.stringify({ enganches: require(${JSON.stringify(path.join(RAIZ, "services", "extensiones"))}).enganchados(), rutas, middlewares }));
      process.exit(0);`;
    const r = spawnSync(process.execPath, ["-e", codigo], { cwd: RAIZ, encoding: "utf8", env: { ...process.env, JWT_SECRET: "x".repeat(64) } });
    const linea = (r.stdout || "").split("\n").find(l => l.startsWith("@@"));
    if (!linea) throw new Error("no montó:\n" + r.stdout + r.stderr);
    return JSON.parse(linea.slice(2));
  };
  const REGLAS = ["sesion.token", "sesion.datos", "consulta.antesDeGrabar", "vistaPrevia.durante", "consulta.alCrear", "consulta.alConfirmar", "paciente.mensajes", "kardex.alertas"];
  const FUNCIONES = ["notaEnVivo.extras", "consulta.detalle"];

  const prendido = montar("prendido");
  verificar("prendido: las reglas y las funciones, enganchadas", [...REGLAS, ...FUNCIONES].every(p => prendido.enganches[p] === 1));
  verificar("  ...el freno de rutas, antes de las del núcleo", prendido.middlewares === 1);
  verificar(`  ...y todas sus rutas (${prendido.rutas.length})`, prendido.rutas.includes("POST /medico/registro-estudiante")
    && prendido.rutas.includes("POST /medico/consultas/:id/razonamiento") && prendido.rutas.includes("GET /medico/estudio/hoy")
    && prendido.rutas.includes("POST /medico/pacientes-virtuales") && prendido.rutas.includes("POST /medico/simulacros"));

  for (const valor of ["apagado", "APAGADO", "off", "0", "no", "false"]) {
    const apagado = montar(valor);
    const ok = REGLAS.every(p => apagado.enganches[p] === 1) && FUNCIONES.every(p => apagado.enganches[p] === 0)
      && apagado.middlewares === 1 && JSON.stringify(apagado.rutas) === JSON.stringify(["GET /medico/estudiante/estado"]);
    verificar(`MODULO_ESTUDIANTES=${valor}: siguen las reglas (y el estado de la cuenta); sin funciones ni rutas de estudio`, ok);
  }
}

// ─── 5. Apagado, de punta a punta ─────────────────────────────────────────
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
function pedir(metodo, ruta, token, cuerpo) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({ host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: {
      ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    } }, (res) => {
      let txt = ""; res.on("data", (c) => { txt += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(txt); } catch { /* no es JSON */ } resolve({ estado: res.statusCode, txt, json }); });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

async function puntosPorDentro() {
  console.log("\n── 4. Los puntos de extensión, por dentro ──");
  // El del servidor. En este proceso no hay ningún módulo montado: lo que se
  // engancha acá es de la prueba.
  const ext = require(path.join(RAIZ, "services", "extensiones"));
  const tira = (fn) => { try { fn(); return false; } catch { return true; } };
  verificar("servidor: engancharse a un punto que no existe es un error (no un enganche que no corre nunca)",
    tira(() => ext.enganchar("consulta.alGuardar", () => ({}))));
  verificar("  ...y llamar un punto con la forma que no es la suya, también", tira(() => ext.sumar("consulta.antesDeGrabar", {})));
  const marca = () => ({ marca: true });
  ext.enganchar("sesion.token", marca);
  ext.enganchar("sesion.token", marca);
  ext.enganchar("sesion.token", () => ({ otra: 1 }));
  verificar("  ...«sumar» junta lo de todos, y la misma función dos veces cuenta una",
    JSON.stringify(ext.sumar("sesion.token", {})) === '{"marca":true,"otra":1}' && ext.enganchados()["sesion.token"] === 2);
  ext.enganchar("sesion.datos", () => { throw new Error("falla de permisos"); });
  verificar("  ...si un enganche de «sumar» falla, falla el pedido (decide permisos: no se sigue sin él)", tira(() => ext.sumar("sesion.datos", {})));
  ext.enganchar("consulta.detalle", async () => { throw new Error("se cayó el módulo"); });
  ext.enganchar("consulta.detalle", async () => ({ algo: 1 }));
  const extras = await ext.extras("consulta.detalle", {}).catch(() => null);
  verificar("  ...si uno de «extras» falla, se sigue con lo de los demás (la consulta se abre igual)", JSON.stringify(extras) === '{"algo":1}');
  ext.enganchar("consulta.antesDeGrabar", async () => { const e = new Error("sin horas"); e.status = 402; throw e; });
  let frenado = null;
  try { await ext.revisar("consulta.antesDeGrabar", {}); } catch (e) { frenado = e; }
  verificar("  ...«revisar» frena con el error del módulo", frenado?.status === 402);
  ext.enganchar("paciente.mensajes", async () => true);
  ext.enganchar("paciente.mensajes", async () => false);
  verificar("  ...«permite»: con que uno diga que no, es no", (await ext.permite("paciente.mensajes", {})) === false);
  ext.enganchar("kardex.alertas", async () => [{ titulo: "A" }]);
  ext.enganchar("kardex.alertas", async () => null);
  verificar("  ...«lista» junta las listas (y lo que no es lista no cuenta)", JSON.stringify(await ext.lista("kardex.alertas", {})) === '[{"titulo":"A"}]');

  // El de la pantalla, en un navegador de mentira.
  const vm = require("vm");
  const correr = (modulos) => {
    const ctx = { console, window: { MODULOS: modulos } };
    vm.createContext(ctx);
    vm.runInContext(leer("public", "js", "extensiones.js") + "\n;this.E = Extensiones; this.puede = puede;", ctx);
    return ctx;
  };
  const { E, puede } = correr(undefined);
  verificar("pantalla: sin módulos, todo permiso dice que sí", E.PERMISOS.every(p => puede(p)));
  verificar("  ...un permiso que no existe es un error", tira(() => puede("volar")));
  verificar("  ...y un punto que no existe, o con la forma equivocada, también", tira(() => E.agregar("panel.costado", () => "")) && tira(() => E.filtrar("login", [])));
  let negar = true;
  E.negar(() => (negar ? ["agenda", "recetar"] : []));
  verificar("  ...un módulo niega un permiso para la cuenta de ahora", !puede("agenda") && !puede("recetar") && puede("saldo"));
  negar = false;
  verificar("  ...y se vuelve a preguntar cada vez (otra cuenta, otro permiso)", puede("agenda"));
  const pintados = [];
  E.agregar("panel.pestanas", () => ({ html: "<a>", alPintar: () => pintados.push("a") }));
  E.agregar("panel.pestanas", () => "<b>");
  E.agregar("panel.pestanas", () => "");
  const lugar = E.lugar("panel.pestanas");
  verificar("  ...un lugar junta el HTML de todos, y cada pedazo por separado", lugar.html === "<a><b>" && JSON.stringify(lugar.partes) === '["<a>","<b>"]');
  verificar("  ...y lo engancha recién cuando se pide, ya pintado", pintados.length === 0 && (lugar.alPintar(), pintados.join() === "a"));
  E.agregar("escritorio.menu", (xs) => [...xs, "estudiar"]);
  E.agregar("escritorio.menu", (xs) => xs.filter(x => x !== "agenda"));
  verificar("  ...los filtros se encadenan en orden", JSON.stringify(E.filtrar("escritorio.menu", ["inicio", "agenda"])) === '["inicio","estudiar"]');
  E.agregar("grabar", async () => "");
  E.agregar("grabar", async () => "Sin horas este mes");
  verificar("  ...«revisar» devuelve el primer motivo para no hacerlo", (await E.revisar("grabar")) === "Sin horas este mes");
  verificar("  ...el interruptor: apagado solo si el servidor dice que está apagado",
    correr({ estudiantes: false }).E.moduloPrendido("estudiantes") === false
    && correr({ estudiantes: true }).E.moduloPrendido("estudiantes") === true && E.moduloPrendido("estudiantes") === true);
}

(async () => {
  await puntosPorDentro();
  console.log("\n── 5. Apagado, con el servidor de verdad y un navegador ──");
  const pw = cargarPlaywright();
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!pw || !MongoMemoryServer) {
    console.log("⏭️  Punto 5 SALTEADO: falta Playwright o la base de prueba. Esto NO es un ✅.");
    console.log(fallos === 0 ? "\n🏁 TODO BIEN (sin el punto 5)" : `\n💥 ${fallos} FALLO(S)`);
    process.exit(fallos === 0 ? 0 : 1);
  }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "modulo_estudiantes";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "x".repeat(64), OPENAI_KEY: "sk-de-prueba", MODULO_ESTUDIANTES: "apagado" };
  let servidor, browser, mongoose;
  try {
    process.env.MONGODB_URI = uri;
    require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
    mongoose = require("mongoose");
    await mongoose.connect(uri);
    const M = require(path.join(RAIZ, "db", "models"));
    const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
    const passwordHash = await hashPassword("Prueba123.");
    const EST = "59170097001", MED = "70097009";
    await M.Medico.create({ phone: EST, nombre: "Eva Estudiante", passwordHash, activo: true, estadoCuenta: "aprobada", idioma: "es",
      estudiante: { nivel: "interno", hasta: new Date(Date.now() + 90 * 86400000), horasMes: 12 } });
    await M.Medico.create({ phone: MED, nombre: "Dr. Médico", passwordHash, activo: true, estadoCuenta: "aprobada", idioma: "es" });
    const pac = await M.Paciente.create({ medicoPhone: EST, nombre: "Paciente de Eva" });
    const c = await M.ConsultaMedica.create({ medicoPhone: EST, pacienteId: pac._id, pacienteNombre: pac.nombre, estado: "completado", deEstudiante: true,
      notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "Dolor de garganta", diagnostico: "Faringitis", medicamentosRecetados: [{ nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" }] },
      transcripcionCompleta: "Buenos días doctor me duele la garganta hace tres días tengo fiebre y me cuesta tragar la comida desde ayer" });

    servidor = spawn(process.execPath, [path.join(RAIZ, "index.js")], { cwd: RAIZ, env, stdio: "ignore" });
    for (let i = 0; i < 80; i++) { try { if ((await pedir("GET", "/health")).estado === 200) break; } catch { /* todavía no */ } await esperar(500); }

    let r = await pedir("GET", "/modulos.js");
    verificar("/modulos.js le dice a la pantalla que está apagado", r.estado === 200 && /window\.MODULOS = \{"estudiantes":false\}/.test(r.txt));
    r = await pedir("POST", "/medico/registro-estudiante", null, { codigo: "EST-AB12CD", nombre: "Nadie", phone: "+59170097002", password: "Prueba123." });
    verificar("no se entra con códigos nuevos (la ruta no existe)", r.estado === 404);
    r = await pedir("POST", "/medico/login", null, { phone: EST, password: "Prueba123." });
    const tkEst = r.json?.token;
    verificar("la estudiante que ya existía entra, y su sesión sigue diciendo que es de estudiante", r.estado === 200 && r.json?.estudiante?.nivel === "interno");
    r = await pedir("GET", "/medico/estudio/resumen", tkEst);
    verificar("Estudiar no existe", r.estado === 404);
    r = await pedir("POST", `/medico/consultas/${c._id}/razonamiento`, tkEst, { principal: "Faringitis" });
    verificar("  ...ni el razonamiento, ni el paciente virtual, ni los simulacros", r.estado === 404
      && (await pedir("GET", "/medico/pacientes-virtuales", tkEst)).estado === 404 && (await pedir("GET", "/medico/simulacros", tkEst)).estado === 404);
    r = await pedir("POST", "/medico/citas", tkEst, { pacienteId: String(pac._id), fecha: new Date().toISOString() });
    verificar("las reglas SIGUEN: dar un turno → 403", r.estado === 403 && r.json?.estudiante === true);
    r = await pedir("POST", `/medico/pacientes/${pac._id}/recetas`, tkEst, {});
    verificar("  ...recetar → 403", r.estado === 403);
    r = await pedir("GET", "/medico/estudiante/estado", tkEst);
    verificar("  ...y el estado de su acceso (horas, vencimiento) sigue", r.estado === 200 && r.json?.estudiante?.horasMes === 12);
    r = await pedir("GET", `/medico/consultas/${c._id}`, tkEst);
    verificar("  ...su consulta abre, con la marca de estudiante y sin nada de estudio", r.estado === 200 && r.json?.consulta?.deEstudiante === true
      && JSON.stringify(r.json.consulta.extras) === "{}");
    r = await pedir("POST", "/medico/login", null, { phone: MED, password: "Prueba123." });
    const tkMed = r.json?.token;
    verificar("un médico, igual que siempre", r.estado === 200 && r.json?.estudiante === null
      && (await pedir("GET", "/medico/consultas", tkMed)).estado === 200);

    browser = await pw.chromium.launch({ executablePath: navegador() });
    // En la hora de la cuenta, como un estudiante de verdad.
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/La_Paz" })).newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await page.goto(`http://127.0.0.1:${PUERTO}/app`);
    await page.waitForSelector("#lPhone");
    verificar("en el login no se ofrece «Tengo un código de estudiante»", !(await page.locator("#lGoEstudiante").count()));
    await page.fill("#lPhone", "+" + EST);
    await page.fill("#lPass", "Prueba123.");
    await page.click("#lBtn");
    await page.waitForSelector("#avatarHomeBox", { timeout: 20000 });
    await page.waitForSelector("#estAvisoInicio .est-aviso", { timeout: 10000 }).catch(() => {});
    verificar("su panel: el aviso de su acceso sigue arriba", /Interno/.test(await page.innerText("#estAvisoInicio").catch(() => "")));
    verificar("  ...sin la racha ni «Estudiá con tus casos»", !(await page.locator(".est-inicio").count()) && !(await page.locator("#estIrEstudiar").count()));
    verificar("  ...sin «Estudiar» y, como siempre, sin agenda", !(await page.locator("#btnEstudiar").count()) && !(await page.locator("#btnAgenda").count()));
    await page.evaluate((id) => renderDetalle(id), String(c._id));
    await page.waitForSelector(".est-marca", { timeout: 10000 }).catch(() => {});
    verificar("su consulta: con la marca «Nota de estudiante»", /Nota de estudiante/.test(await page.innerText(".est-marca").catch(() => "")));
    verificar("  ...sin «¿cuál es tu diagnóstico?»", !(await page.locator("#razonamientoCard").count()));
    verificar("  ...y al confirmar, sin receta ni reconsulta (las reglas siguen en la pantalla)", !(await page.locator("#cfReceta").count()) && !(await page.locator("#cfReconsulta").count()));
    await page.goto(`http://127.0.0.1:${PUERTO}/app/estudiar`);
    await page.waitForSelector("#avatarHomeBox, .est-portada", { timeout: 20000 }).catch(() => {});
    verificar("/app/estudiar no lleva a ningún lado: vuelve a su panel", !(await page.locator(".est-portada").count()) && (await page.locator("#avatarHomeBox").count()) === 1);
    verificar("sin errores de JavaScript", !errores.length);
    if (errores.length) console.log("   " + errores.join("\n   "));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (servidor) servidor.kill();
    if (mongoose) await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
  }
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
