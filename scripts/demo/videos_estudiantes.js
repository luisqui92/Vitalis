// Symphomed — Los videos del tutorial para estudiantes, grabados solos.
//
// Levanta un Symphomed aislado —base en memoria, pacientes inventados y la IA
// de mentira de scripts/demo/ia_demo.js— y graba cada video en tamaño de
// celular, con subtítulos y los toques a la vista. No sale nada a internet ni
// se toca una base de verdad: no hace falta ninguna clave.
//
// Uso:
//   FFMPEG=/ruta/a/ffmpeg node scripts/demo/videos_estudiantes.js [--solo 2,3] [--hasta 4] [--salida carpeta] [--ensayo]
//     --solo    graba esos; los pasos de los demás se hacen igual, rápido y sin grabar
//     --hasta   corta después de ese video
//     --salida  dónde quedan los MP4 y las capturas (por defecto, ./videos_estudiantes)
//     --ensayo  sin video: solo capturas de cada paso, para revisar rápido
// Hace falta Playwright, mongodb-memory-server y un ffmpeg con libx264.
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const C = require("./contenido");
// Lo pide config/index.js, que esta demo carga para apuntar a su base.
process.env.JWT_SECRET = process.env.JWT_SECRET || "demo-".repeat(16);

const RAIZ = path.join(__dirname, "..", "..");
const PUERTO = Number(process.env.PUERTO_DEMO || 3991);
const BASE = `http://127.0.0.1:${PUERTO}`;
const TOTAL = 11;
const ANCHO = 390, ALTO = 844;

const argv = process.argv.slice(2);
const opcion = (n) => { const i = argv.indexOf("--" + n); return i > -1 ? argv[i + 1] : undefined; };
const ENSAYO = argv.includes("--ensayo");
const SOLO = opcion("solo") ? opcion("solo").split(",").map(Number) : null;
const HASTA = Number(opcion("hasta") || TOTAL);
const SALIDA = path.resolve(opcion("salida") || "videos_estudiantes");
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const digitos = (t) => String(t).replace(/\D/g, "");
function cargar(nombres) {
  for (const n of nombres) { try { return require(n); } catch { /* el siguiente */ } }
  return null;
}
const traer = (ruta) => new Promise((resolve, reject) => {
  const r = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta }, (x) => { x.resume(); x.on("end", () => resolve(x.statusCode)); });
  r.on("error", reject); r.setTimeout(5000, () => r.destroy(new Error("timeout")));
});

// ─── Las cuentas de la demo (inventadas) ─────────────────────────────────────
const ANA = { nombre: "Ana Gutiérrez", phone: "+59170000101", clave: "Estudio2026", universidad: "Facultad de Medicina, 6.º año" };
const LUCIA = { nombre: "Lucía Fernández", phone: "+59170000102", clave: "Estudio2026", universidad: "Carrera de Enfermería, 4.º año" };

// ─── Lo que pasa en cada video: el estado de la demo ─────────────────────────
const estado = { consultaMed: null, consultaEnf: null, pacienteMed: null, pacienteEnf: null, sesion: {} };

// ═══ CÓMO SE MUEVE LA DEMO EN LA PANTALLA ════════════════════════════════════
// «grabando» decide el ritmo: grabando, todo a velocidad de lectura; si no,
// lo más rápido posible (el paso se hace igual, para el video siguiente).
function manos(page, grabando, carpeta) {
  let fotos = 0;
  const leerMs = (t) => Math.min(7000, Math.max(2600, 1500 + t.replace(/<[^>]+>/g, "").length * 52));
  const h = {
    page,
    async sub(html, { abajo = false, ms } = {}) {
      await page.evaluate(([x, a]) => window.__demo.sub(x, a), [html, abajo]);
      await esperar(grabando ? (ms ?? leerMs(html)) : 60);
    },
    async sinSub() { await page.evaluate(() => window.__demo.sinSub()); await esperar(grabando ? 350 : 0); },
    async pausa(ms) { await esperar(grabando ? ms : Math.min(ms, 150)); },
    async ver(selector, timeout = 30000) { await page.locator(selector).first().waitFor({ state: "visible", timeout }); },
    async centrar(selector) {
      await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await esperar(grabando ? 900 : 120);
    },
    // El principio de una caja alta, debajo del subtítulo de arriba.
    async alPrincipio(selector) {
      await page.locator(selector).first().evaluate((el) => scrollTo({ top: el.getBoundingClientRect().top + scrollY - 120, behavior: "smooth" }));
      await esperar(grabando ? 900 : 120);
    },
    async arriba() { await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await esperar(grabando ? 700 : 100); },
    async bajar(px) { await page.evaluate((y) => scrollBy({ top: y, behavior: "smooth" }), px); await esperar(grabando ? 900 : 100); },
    async tocar(selector, { antes = 380 } = {}) {
      const el = page.locator(selector).first();
      await el.waitFor({ state: "visible", timeout: 30000 });
      await el.scrollIntoViewIfNeeded();
      const caja = await el.boundingBox();
      const x = caja.x + caja.width / 2, y = caja.y + Math.min(caja.height / 2, 22);
      if (grabando) { await page.mouse.move(x, y, { steps: 14 }); await esperar(antes); }
      else await page.mouse.move(x, y);
      await page.mouse.down(); await esperar(grabando ? 90 : 10); await page.mouse.up();
      await esperar(grabando ? 250 : 30);
    },
    // Llevar el dedo hasta algo sin tocarlo: una lista desplegable o una
    // fecha abren el selector nativo, que en el video no se ve y traba.
    async senalar(selector) {
      const el = page.locator(selector).first();
      await el.scrollIntoViewIfNeeded();
      const caja = await el.boundingBox();
      await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: grabando ? 14 : 1 });
      await esperar(grabando ? 450 : 0);
    },
    async escribir(selector, texto, { demora = 42 } = {}) {
      await h.tocar(selector);
      if (grabando) await page.keyboard.type(texto, { delay: demora });
      else await page.fill(selector, texto);
      await esperar(grabando ? 250 : 0);
    },
    async foto(nombre) {
      if (!carpeta) return;
      fotos++;
      await page.screenshot({ path: path.join(carpeta, `${String(fotos).padStart(2, "0")}_${nombre}.png`) }).catch(() => {});
    },
  };
  return h;
}

// ═══ EL SERVIDOR DE LA DEMO ══════════════════════════════════════════════════
async function levantar() {
  let MongoMemoryServer;
  ({ MongoMemoryServer } = cargar(["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) || {});
  if (!MongoMemoryServer) throw new Error("falta mongodb-memory-server");
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  const uri = mongod.getUri() + "symphomed_demo";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require(path.join(RAIZ, "node_modules", "mongoose"));
  await mongoose.connect(uri);

  // Lo que el banco ya tiene: el caso de cada carrera y diez preguntas por área.
  const E = require(path.join(RAIZ, "modulos", "estudiantes", "modelos"));
  await E.CasoVirtual.create([
    { idioma: "es", area: "cirugia", dificultad: "intermedio", guion: C.CASO_MED },
    { idioma: "es", area: "enf_hospitalizacion", dificultad: "basico", guion: C.CASO_ENF },
  ]);
  await E.PreguntaSimulacro.insertMany([
    ...C.PREGUNTAS_MED.map((p) => ({ idioma: "es", area: "clinica", ...p })),
    ...C.PREGUNTAS_ENF.map((p) => ({ idioma: "es", area: "enf_fundamentos", ...p })),
  ]);

  // Sin ninguna clave de verdad: lo que el entorno tenga de eso no pasa.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASS|URI|NODE_OPTIONS/i.test(k)));
  const dialogo = path.join(os.tmpdir(), `symphomed-demo-dialogo-${process.pid}`);
  fs.writeFileSync(dialogo, "med");
  Object.assign(env, {
    MONGODB_URI: uri, PORT: String(PUERTO), JWT_SECRET: "demo-".repeat(16), OPENAI_KEY: "sk-demo", ASSEMBLYAI_API_KEY: "demo",
    SYMPHOMED_DEMO: "1", SYMPHOMED_DEMO_DIALOGO: dialogo, NODE_OPTIONS: `--require ${path.join(__dirname, "ia_demo.js")}`,
  });

  // Los códigos, como los crea el script de verdad. Sin spawnSync: con este
  // proceso trabado esperando, la base en memoria (que escribe su log acá) se
  // traba también y el script nunca la encuentra.
  const codigo = (...extra) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(RAIZ, "scripts", "codigos_estudiante.js"), "crear", "--nivel", "interno", "--meses", "6", ...extra],
      { cwd: RAIZ, env: { ...env, NODE_OPTIONS: "" } });
    let salida = "";
    p.stdout.on("data", (d) => { salida += d; });
    p.stderr.on("data", (d) => { salida += d; });
    p.on("close", () => {
      const m = salida.match(/EST-[A-Z0-9]{6}/);
      if (m) resolve(m[0]); else reject(new Error("no salió el código:\n" + salida));
    });
  });
  ANA.codigo = await codigo("--nota", "Demo: Ana");
  LUCIA.codigo = await codigo("--carrera", "enfermeria", "--nota", "Demo: Lucía");

  const log = fs.openSync(path.join(SALIDA, "servidor.log"), "w");
  const servidor = spawn(process.execPath, [path.join(RAIZ, "index.js")], { cwd: RAIZ, env, stdio: ["ignore", log, log] });
  for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { /* todavía no */ } await esperar(500); }
  return { mongod, mongoose, servidor, dialogo, M: require(path.join(RAIZ, "db", "models")) };
}

// ═══ CADA VIDEO ══════════════════════════════════════════════════════════════
// portada: lo que dice la tarjeta del principio. hacer(h, ctx): lo que pasa.
const VIDEOS = [];
const video = (numero, carrera, titulo, bajada, hacer, { quien = ANA, inicio = "/app", microfono = false, antes = null } = {}) =>
  VIDEOS.push({ numero, carrera, titulo, bajada, hacer, quien, inicio, microfono, antes });
// Lo que hace falta entre un video y otro, sin grabar (numero 0).
const paso = (titulo, hacer, opciones = {}) => video(0, "", titulo, "", hacer, opciones);

// La vista previa en vivo de mentira: lo que «se dice», turno por turno.
// Playwright cambia el WebSocket de la página al cargarla: la ruta se pone
// antes de abrir la app (grabarVideo) y lo que se dice, recién al grabar.
const vivos = new WeakMap();
function prepararVistaPrevia(page) {
  const vivo = { turnos: [], cadaMs: 2500, alTerminar: () => {} };
  vivos.set(page, vivo);
  return page.routeWebSocket(/\/ws-vista-previa/, (ws) => {
    ws.onMessage(() => { /* el audio del navegador: no se usa */ });
    const { turnos, cadaMs, alTerminar } = vivo;
    turnos.forEach((texto, i) => setTimeout(() => {
      try { ws.send(JSON.stringify({ transcript: texto, end_of_turn: true })); } catch { /* ya se cerró */ }
      if (i === turnos.length - 1) alTerminar();
    }, 900 + cadaMs * i));
  });
}
function vistaPrevia(page, turnos, cadaMs) {
  const vivo = vivos.get(page);
  return new Promise((resolve) => Object.assign(vivo, { turnos, cadaMs, alTerminar: resolve }));
}

// ─── 1. Entrar con tu código ─────────────────────────────────────────────────
async function registrar(h, persona, conSubtitulos) {
  const { page } = h;
  const sub = conSubtitulos ? h.sub : async () => {};
  await h.ver("#lGoEstudiante");
  await sub("Tu docente te da un <em>código de estudiante</em>. Con él creás tu cuenta.");
  await h.tocar("#lGoEstudiante");
  await h.ver("#eCodigo");
  await h.foto("registro");
  await h.escribir("#eCodigo", persona.codigo, { demora: 70 });
  await sub("Escribí el código tal como te llegó. Sirve una sola vez: queda a tu nombre.");
  await h.escribir("#eNombre", persona.nombre);
  await h.escribir("#ePhone", persona.phone, { demora: 55 });
  await h.escribir("#eUniversidad", persona.universidad);
  await h.escribir("#ePass", persona.clave, { demora: 60 });
  await sub("Tu teléfono con el código del país, y una clave de 8 letras o más.");
  await h.foto("registro_lleno");
  await h.tocar("#eBtn");
  await h.ver("#avatarHomeBox", 30000);
  await page.waitForFunction(() => (document.getElementById("estAvisoInicio")?.innerText || "").trim().length > 0, null, { timeout: 15000 }).catch(() => {});
}

async function nuevoPaciente(h, nombre, fecha, sexo) {
  const { page } = h;
  await h.tocar("#btnNuevoPaciente");
  await h.ver("#pNombre");
  await h.escribir("#pNombre", nombre);
  await h.senalar("#pFecha");
  await page.fill("#pFecha", fecha);
  await h.senalar("#pSexo");
  await page.selectOption("#pSexo", sexo);
  await h.foto("paciente");
  await h.tocar("#pBtn");
  await h.ver("#btnNuevaConsulta", 20000);
}

video(1, "Medicina", "Entrar con tu código", "Tu docente te da un código. Con él creás tu cuenta en un minuto.", async (h) => {
  await registrar(h, ANA, true);
  await h.pausa(600);
  await h.foto("inicio");
  await h.sub("Listo, ya entraste. Arriba ves tu acceso: <em>hasta cuándo vale</em> y las horas de grabación del mes.");
  await h.sub("Desde acá cargás a tus pacientes, grabás tus consultas y estudiás.", { abajo: true });
  await h.pausa(800);
});

// ─── 2. Grabar tu primera consulta ───────────────────────────────────────────
video(2, "Medicina", "Grabar tu primera consulta", "Atendés como siempre: la nota se escribe sola y el tutor te avisa qué falta.", async (h, { grabando, M }) => {
  const { page } = h;
  const terminado = vistaPrevia(page, C.DIALOGO_MED, grabando ? 2500 : 500);
  await h.ver("#btnNuevoPaciente");
  await h.sub("Primero, el paciente. Tocá <em>Nuevo paciente</em>.");
  await nuevoPaciente(h, "Carlos Mamani", "1998-03-14", "Masculino");
  await h.foto("ficha");
  await h.sub("En su ficha, tocá <em>Nueva consulta</em>.");
  await h.tocar("#btnNuevaConsulta");
  await h.ver("#recBtn");
  await h.sub("Tocá el micrófono y atendé como siempre. <em>Siempre con el permiso del paciente.</em>");
  await h.tocar("#recBtn");
  await h.sub("Symphomed escucha y va escribiendo lo que se habla.", { abajo: true });
  await page.waitForFunction(() => /Motivo|motivo/.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 60000 });
  await h.centrar("#notaVivo");
  await h.foto("nota_en_vivo");
  await h.sub("Mientras atendés, <em>la nota se va armando sola</em>.");
  await page.waitForFunction(() => /preguntar/i.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 30000 }).catch(() => {});
  await h.foto("tutor_en_vivo");
  await h.sub("Y el tutor te avisa <em>qué te falta preguntar</em>. Lo que ya preguntaste, desaparece.", { abajo: true });
  await terminado;
  await h.pausa(2500);
  await h.foto("antes_de_terminar");
  await h.sub("Al terminar la consulta, tocá de nuevo el micrófono.");
  await h.tocar("#recBtn");
  await h.ver("#ncSubir", 15000);
  await page.waitForFunction(() => /Así queda la nota/.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 20000 }).catch(() => {});
  await h.centrar("#notaVivo");
  await h.foto("nota_final");
  await h.sub("Ves la nota antes de subirla. Tocá <em>Subir y transcribir</em>.");
  await h.tocar("#ncSubir");
  await page.waitForFunction(() => document.getElementById("btnConfirmarConsulta") || document.getElementById("rzPrincipal"), null, { timeout: 40000 });
  await h.pausa(800);
  estado.consultaMed = String((await M.ConsultaMedica.findOne({ medicoPhone: digitos(ANA.phone) }).sort({ createdAt: -1 }).lean())?._id || "");
  await h.foto("consulta");
  await h.sub("Se guarda en la ficha de Carlos. Ahora te toca pensar a vos.");
}, { microfono: true });

// ─── 3. Tu razonamiento ──────────────────────────────────────────────────────
video(3, "Medicina", "Tu razonamiento", "Primero decís vos qué tiene el paciente. Después el tutor te muestra cómo razonarlo.", async (h) => {
  const { page } = h;
  await h.ver("#rzPrincipal", 30000);
  await h.centrar("#rzPrincipal");
  await h.foto("razonamiento_vacio");
  await h.sub("Antes de ver nada, el tutor te pide <em>tu diagnóstico</em>. Pensalo vos primero.");
  await h.escribir("#rzPrincipal", "Faringitis viral");
  await h.escribir("#rzDiferenciales", "Mononucleosis");
  await h.sub("Ana cree que es viral. Veamos qué le dice el tutor.");
  await h.tocar("#rzBtn");
  await h.ver(".tutor-dx", 30000);
  await h.pausa(500);
  await h.alPrincipio("#razonamientoCard");
  await h.foto("razonamiento");
  await h.sub("Te dice en qué acertaste, <em>qué no consideraste</em> y por qué.");
  await h.centrar(".tutor-dx");
  await h.sub("Los diferenciales, con lo que está <em>a favor</em> y <em>en contra</em> en este paciente, y qué estudio los distingue.");
  await h.bajar(380);
  await h.foto("razonamiento_2");
  await h.sub("Y una perla: la enseñanza del caso, en una frase.", { abajo: true });
  if (await page.locator("#rzIrEstudiar").count()) await h.centrar("#rzIrEstudiar");
  await h.foto("razonamiento_tarjetas");
  await h.sub("Con este caso se armaron <em>tarjetas de repaso</em> para estudiar después.", { abajo: true });
}, { inicio: () => `/app?consulta=${estado.consultaMed}` });

// ─── 4. Revisar y confirmar la nota ──────────────────────────────────────────
video(4, "Medicina", "Revisar y confirmar la nota", "La nota es tuya: corregí lo que haga falta y confirmala.", async (h) => {
  const { page } = h;
  await h.ver("#nfMotivo", 30000);
  await h.centrar("#nfMotivo");
  await h.foto("nota");
  await h.sub("La nota quedó escrita. <em>Revisala siempre</em>: la IA ayuda, pero la responsable sos vos.");
  await h.centrar("#nfPlan");
  await h.tocar("#nfPlan");
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Control en 48 horas.", { delay: 45 });
  await h.sub("Corregí o agregá lo que haga falta. Con tus cambios, la IA aprende <em>cómo escribís vos</em>.");
  await h.foto("nota_editada");
  await h.centrar("#btnConfirmarConsulta");
  await h.sub("Cuando está bien, tocá <em>Confirmar</em>.", { abajo: true });
  await h.tocar("#btnConfirmarConsulta");
  await page.waitForFunction(() => !document.getElementById("btnConfirmarConsulta") || document.getElementById("btnConfirmarConsulta").disabled, null, { timeout: 20000 }).catch(() => {});
  await h.pausa(1200);
  await h.foto("confirmada");
  await h.sub("Confirmada: queda en la ficha del paciente, marcada como <em>nota de estudiante</em>.");
}, { inicio: () => `/app?consulta=${estado.consultaMed}` });

// ─── 5. Estudiar con tus casos ───────────────────────────────────────────────
// Una tarjeta a la vez, hasta el final. Las de opciones se contestan bien
// (la que dice «estreptoc…»); las de recordar, una «me acordaba» y otra no.
async function repasarTarjetas(h, { conSubtitulos = true } = {}) {
  const { page } = h;
  let vistas = 0, recuerdos = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForFunction(() => document.getElementById("estTarjeta") || document.querySelector(".est-fin"), null, { timeout: 20000 });
    if (await page.locator(".est-fin").count()) return;
    const tipo = await page.getAttribute("#estTarjeta", "data-tipo");
    vistas++;
    if (await page.locator("#estTarjeta .est-opcion").count()) {
      if (vistas === 1 && conSubtitulos) await h.sub("Cada tarjeta sale de <em>un paciente que atendiste</em>: ¿cuál era el diagnóstico?");
      const textos = await page.locator("#estTarjeta .est-opcion").allInnerTexts();
      const k = Math.max(0, textos.findIndex((x) => /estreptoc/i.test(x)));
      await h.tocar(`#estTarjeta .est-opcion >> nth=${k}`);
      await h.ver("#estExplica .est-veredicto", 15000);
      await h.centrar("#estExplica");
      await h.foto(`tarjeta_${tipo}`);
      if (conSubtitulos) await h.sub("Te dice por qué, con los datos de <em>tu</em> paciente.", { abajo: true });
      await h.tocar("#estSiguiente");
    } else {
      if (conSubtitulos && recuerdos === 0) await h.sub("Otras son para recordar: pensá la respuesta y tocá <em>Mostrar</em>.");
      await h.tocar("#estMostrar");
      await h.ver("#estMeAcordaba");
      await h.centrar(".est-autoeval");
      await h.foto(`tarjeta_${tipo}`);
      if (conSubtitulos && recuerdos === 0) await h.sub("Sé honesta: si no te acordabas, la tarjeta <em>vuelve antes</em>.", { abajo: true });
      else await h.pausa(1500);
      await h.tocar(recuerdos === 1 ? "#estNoMeAcordaba" : "#estMeAcordaba");
      recuerdos++;
    }
  }
}

video(5, "Medicina", "Estudiar con tus casos", "Tus pacientes se vuelven tarjetas de repaso, y vuelven justo cuando estás por olvidarlas.", async (h) => {
  const { page } = h;
  await h.ver("#estIrEstudiar", 20000);
  await h.centrar("#estAvisoInicio");
  await h.foto("inicio");
  await h.sub("En el inicio ves tu <em>racha</em> y lo que tenés para repasar hoy. Tocá <em>Estudiar</em>.");
  await h.tocar("#estIrEstudiar");
  await h.ver(".est-portada", 20000);
  await h.foto("portada");
  await h.sub("Con el caso de Carlos se armaron <em>tarjetas de repaso</em>.");
  await h.tocar("#estEmpezar");
  await repasarTarjetas(h);
  await h.ver(".est-fin", 20000);
  await h.foto("fin");
  await h.sub("Al terminar, tu racha suma un día. Cada tarjeta vuelve <em>cuando estás por olvidarla</em>.");
});

// ─── 6. Paciente virtual (medicina) ──────────────────────────────────────────
async function preguntarPV(h, texto) {
  const { page } = h;
  await h.escribir("#pvTexto", texto, { demora: 32 });
  await h.tocar("#pvEnviar");
  await page.waitForFunction(() => !document.querySelector(".pv-escribiendo") && !document.getElementById("pvTexto")?.disabled, null, { timeout: 30000 });
  await h.pausa(500);
}
async function pedirPV(h, boton, cual) {
  const { page } = h;
  await h.tocar(boton);
  await h.ver(`.pv-pedido[data-texto="${cual}"]`);
  await h.pausa(500);
  await h.tocar(`.pv-pedido[data-texto="${cual}"]`);
  await page.waitForFunction(() => !document.querySelector(".pv-escribiendo") && !document.getElementById("pvTexto")?.disabled, null, { timeout: 30000 });
  await h.pausa(600);
}
async function abrirEstudiar(h, pestana) {
  await h.ver("#btnEstudiar", 20000);
  await h.tocar("#btnEstudiar");
  await h.ver(".est-pestanas", 20000);
  if (pestana) await h.tocar(`.est-pestana[data-pestana="${pestana}"]`);
}

video(6, "Medicina", "Paciente virtual", "Practicá la entrevista como en un examen práctico: preguntás, examinás, pedís estudios y te evalúan.", async (h) => {
  const { page } = h;
  await abrirEstudiar(h, null);
  await h.sub("En Estudiar, la pestaña <em>Paciente virtual</em>: practicás una entrevista como en un ECOE.");
  await h.tocar('.est-pestana[data-pestana="paciente"]');
  await h.ver("#pvEmpezar", 20000);
  await h.tocar('#pvAreas .est-chip[data-valor="cirugia"]');
  await h.tocar('#pvDificultades .est-chip[data-valor="intermedio"]');
  await h.foto("elegir");
  await h.sub("Elegí el área y la dificultad. Cada caso es inventado y lo ves una sola vez.");
  await h.tocar("#pvEmpezar");
  await h.ver("#pvChat", 40000);
  await h.pausa(600);
  await h.foto("caso");
  await h.sub("La paciente te dice por qué viene. <em>Preguntale como a una paciente real.</em>");
  await preguntarPV(h, "Hola, soy Ana, estudiante de medicina. ¿Dónde empezó el dolor?");
  await h.sub("Contesta solo lo que le preguntás, con sus palabras.", { abajo: true });
  await preguntarPV(h, "¿Tuvo fiebre?");
  await preguntarPV(h, "¿Tuvo náuseas o vómitos?");
  await preguntarPV(h, "¿Cuándo fue su última menstruación?");
  await h.foto("entrevista");
  await h.sub("También podés <em>examinarla</em>…");
  await pedirPV(h, "#pvExaminar", "Abdomen");
  await h.sub("…y <em>pedir estudios</em>. Los resultados salen del caso.", { abajo: true });
  await pedirPV(h, "#pvPedir", "Hemograma");
  await pedirPV(h, "#pvPedir", "Ecografía abdominal");
  await h.foto("estudios");
  await h.sub("Cuando tengas tu diagnóstico, tocá <em>Terminar</em>.");
  await h.tocar("#pvTerminar");
  await h.ver("#pvPrincipal");
  await h.escribir("#pvPrincipal", "Apendicitis aguda");
  await h.escribir("#pvDiferenciales", "Embarazo ectópico");
  await h.foto("respuesta");
  await h.tocar("#pvVerEval");
  await h.ver(".pv-eval", 40000);
  await h.pausa(500);
  await h.alPrincipio(".pv-eval");
  await h.foto("evaluacion");
  await h.sub("La evaluación: qué <em>preguntas clave</em> hiciste y cuáles no, los estudios y tu diagnóstico.");
  await h.bajar(420);
  await h.foto("evaluacion_2");
  await h.sub("Y cómo te comunicaste: qué hiciste bien y <em>qué mejorar</em>.", { abajo: true });
});

// ─── 7. Simulacros (medicina) ────────────────────────────────────────────────
async function contestarSimulacro(h, { lentas = 3, errar = 2, total = 10, salirDespues = 0 } = {}) {
  const { page } = h;
  for (let n = 1; n <= total; n++) {
    await page.waitForFunction((x) => (document.querySelector(".est-cuenta")?.innerText || "").startsWith(`${x} de`), n, { timeout: 20000 });
    const enunciado = (await page.innerText(".sim-enunciado")).trim();
    const p = await require(path.join(RAIZ, "modulos", "estudiantes", "modelos")).PreguntaSimulacro.findOne({ enunciado }).lean();
    const k = n === errar ? (p.correcta + 1) % p.opciones.length : p.correcta;
    const despacio = n <= lentas;
    if (despacio) await h.pausa(1800);
    if (despacio) await h.tocar(`#simPregunta .est-opcion[data-k="${k}"]`);
    else await page.click(`#simPregunta .est-opcion[data-k="${k}"]`);
    await h.ver("#simExplica .est-veredicto", 15000);
    if (n === 1) {
      await h.foto("bien");
      await h.sub("En modo práctica, ves al toque si acertaste y <em>por qué</em>.", { abajo: true });
    }
    if (n === errar) {
      await h.centrar("#simExplica");
      await h.foto("mal");
      await h.sub("Si errás, te dice cuál era y <em>por qué cada opción</em> está bien o mal.", { abajo: true });
    }
    if (salirDespues && n === salirDespues) return;
    if (n === lentas && total > lentas) await h.sub("Así hasta terminar…", { ms: 1600 });
    if (n < total) { if (despacio) await h.tocar("#simSiguiente"); else { await page.click("#simSiguiente"); await h.pausa(250); } }
  }
}

video(7, "Medicina", "Simulacros", "Preguntas tipo examen de residencia, por especialidad, con la explicación de cada opción.", async (h, { M }) => {
  const { page } = h;
  await abrirEstudiar(h, null);
  await h.sub("La pestaña <em>Simulacros</em>: preguntas tipo examen de residencia.");
  await h.tocar('.est-pestana[data-pestana="simulacros"]');
  await h.ver("#simEmpezar", 20000);
  await h.tocar('#simAreas .est-chip[data-valor="clinica"]');
  await h.tocar('#simCantidades .est-chip[data-valor="10"]');
  await h.tocar('#simModos .est-chip[data-valor="practica"]');
  await h.foto("elegir");
  await h.sub("Elegí el área, cuántas preguntas y el modo: <em>práctica</em> o <em>examen</em> con reloj.");
  await h.tocar("#simEmpezar");
  await h.ver("#simPregunta", 60000);
  await h.foto("pregunta");
  await contestarSimulacro(h);
  await h.tocar("#simTerminar");
  await h.ver(".sim-fin", 20000);
  await h.pausa(500);
  await h.foto("resultado");
  await h.sub("Tu resultado. Las que erraste <em>vuelven como tarjetas</em> en tu repaso.");
  await h.bajar(380);
  await h.sub("Y podés repasar cada pregunta con su respuesta.", { abajo: true });
});

// ─── 8. Así escribo yo ───────────────────────────────────────────────────────
// Lo que Ana corrigió antes en otras consultas (inventadas): de ahí aprende.
async function sembrarHistoria(M) {
  const medicoPhone = digitos(ANA.phone);
  for (const [i, x] of C.HISTORIA_ANA.entries()) {
    const p = await M.Paciente.create({ medicoPhone, nombre: x.paciente });
    const c = await M.ConsultaMedica.create({ medicoPhone, pacienteId: p._id, pacienteNombre: p.nombre, estado: "completado",
      notaClinicaEstado: "completado", confirmadaEn: new Date(Date.now() - (10 - i) * 86400000), notaEditadaPorMedico: true, notaClinica: x.nota });
    await M.CorreccionIA.create(x.correcciones.map(([campo, valorSugerido, valorFinal]) =>
      ({ medicoPhone, tipo: "nota", consultaId: c._id, campo, valorSugerido, valorFinal })));
  }
}

video(8, "Medicina", "Así escribo yo", "La IA aprende tus palabras y tu forma de escribir de lo que corregís. Vos decidís qué se queda.", async (h) => {
  const { page } = h;
  await h.ver("#avatarHomeBox", 20000);
  await h.sub("Cada vez que corregís una nota, la IA aprende <em>cómo escribís vos</em>.");
  await h.tocar("#avatarHomeBox");
  await page.waitForFunction(() => (document.getElementById("adaptacionBox")?.innerText || "").trim().length > 20, null, { timeout: 20000 });
  await h.alPrincipio("#adaptacionBox");
  await h.foto("asi_escribo_yo");
  await h.sub("En Configuración, <em>Así escribo yo</em> te muestra lo que aprendió de tus correcciones.");
  await h.bajar(300);
  await h.foto("asi_escribo_yo_2");
  await h.sub("Las palabras que corregiste («jolter» → <em>Holter</em>), tus abreviaturas y lo que siempre borrás.", { abajo: true });
  await h.bajar(300);
  await h.foto("asi_escribo_yo_3");
  await h.sub("Si algo no te sirve, lo sacás. <em>Nunca cambia un dato clínico</em>: solo la forma.", { abajo: true });
}, { antes: sembrarHistoria });

// ─── Lucía (enfermería): su cuenta y su paciente, sin grabar ─────────────────
paso("Lucía entra y carga a su paciente", async (h) => {
  await registrar(h, LUCIA, false);
  await nuevoPaciente(h, "Rosa Quispe", "1952-06-20", "Femenino");
}, { quien: LUCIA });

// ─── 9. La nota de enfermería ────────────────────────────────────────────────
video(9, "Enfermería", "La nota de enfermería", "Grabás la atención y sale la nota con el proceso de enfermería: valoración, diagnósticos e intervenciones.", async (h, { grabando, M }) => {
  const { page } = h;
  const terminado = vistaPrevia(page, C.DIALOGO_ENF, grabando ? 2500 : 500);
  await h.ver("text=Rosa Quispe", 20000);
  await h.sub("Lucía es estudiante de enfermería. Abre la ficha de su paciente.");
  await h.tocar("text=Rosa Quispe");
  await h.ver("#btnNuevaConsulta", 20000);
  await h.tocar("#btnNuevaConsulta");
  await h.ver("#recBtn");
  await h.sub("Graba la atención, <em>siempre con el permiso del paciente</em>.");
  await h.tocar("#recBtn");
  await page.waitForFunction(() => (document.getElementById("notaVivo")?.innerText || "").length > 120, null, { timeout: 60000 });
  await h.centrar("#notaVivo");
  await h.foto("nota_en_vivo");
  await h.sub("La nota sale con el <em>proceso de enfermería</em>: signos vitales, valoración y diagnósticos.", { abajo: true });
  await page.waitForFunction(() => /valorar/i.test(document.getElementById("notaVivo")?.innerText || ""), null, { timeout: 30000 }).catch(() => {});
  await h.foto("tutor_en_vivo");
  await h.sub("Y el tutor le avisa <em>qué le falta valorar</em>.", { abajo: true });
  await terminado;
  await h.pausa(2000);
  await h.tocar("#recBtn");
  await h.ver("#ncSubir", 15000);
  await h.pausa(1200);
  await h.tocar("#ncSubir");
  await page.waitForFunction(() => document.getElementById("nfeSv_PA") || document.getElementById("rzPrincipal"), null, { timeout: 40000 });
  await h.pausa(800);
  estado.consultaEnf = String((await M.ConsultaMedica.findOne({ medicoPhone: digitos(LUCIA.phone) }).sort({ createdAt: -1 }).lean())?._id || "");
  await h.centrar("#nfeSv_PA");
  await h.foto("nota_enf");
  await h.sub("Los signos vitales quedan en su lugar, listos para revisar.");
  await h.centrar("#nfeDiagnosticos");
  await h.foto("diagnosticos");
  await h.sub("Diagnósticos de enfermería con <em>problema, causa y signos</em>, en palabras de la carrera.");
  await h.centrar("#rzPrincipal");
  await h.sub("Antes de ver el análisis, Lucía escribe <em>su diagnóstico prioritario</em>.", { abajo: true });
  await h.escribir("#rzPrincipal", "Oxigenación insuficiente");
  await h.escribir("#rzDiferenciales", "Dolor agudo");
  await h.tocar("#rzBtn");
  await h.ver(".tutor-dx", 30000);
  await h.pausa(500);
  await h.alPrincipio("#razonamientoCard");
  await h.foto("razonamiento_enf");
  await h.sub("¡Acertó! El tutor le confirma la prioridad y le marca <em>qué faltó valorar</em>.");
  await h.sub("Después revisa la nota y la confirma, como en medicina.", { abajo: true });
}, { quien: LUCIA, microfono: true });

// ─── 10. Calculadora ─────────────────────────────────────────────────────────
video(10, "Enfermería", "Calculadora", "Goteo, microgotero y diluciones: ponés los datos de la indicación y la cuenta sale sola.", async (h) => {
  const { page } = h;
  await abrirEstudiar(h, null);
  await h.sub("En Estudiar, la pestaña <em>Calculadora</em>.");
  await h.tocar('.est-pestana[data-pestana="calculadora"]');
  await h.ver("#calcResultado", 20000);
  await h.centrar("#calcResultado");
  await h.foto("goteo");
  await h.sub("Goteo: 1.000 mL en 8 horas con macrogotero son <em>42 gotas por minuto</em>.");
  await h.centrar("#calc_volumenMl");
  await page.fill("#calc_volumenMl", "");
  await h.escribir("#calc_volumenMl", "500", { demora: 120 });
  await page.fill("#calc_tiempo", "");
  await h.escribir("#calc_tiempo", "4", { demora: 120 });
  await h.tocar('#calcFactor .est-chip[data-valor="60"]');
  await h.centrar("#calcResultado");
  await h.foto("microgotero");
  await h.sub("Cambiás los datos y el resultado se actualiza. Con microgotero, <em>125 microgotas por minuto</em>.");
  await h.tocar('#calcCual .est-chip[data-valor="dilucion"]');
  await h.ver("#calc_c1");
  await h.centrar("#calcResultado");
  await h.foto("dilucion");
  await h.sub("También diluciones, mL por hora y cambio de unidades.", { abajo: true });
  await h.sub("Los datos salen <em>de la indicación médica</em>: la calculadora solo hace la cuenta.", { abajo: true });
}, { quien: LUCIA });

// ─── 11. Simulacros y paciente virtual de enfermería ─────────────────────────
video(11, "Enfermería", "Practicar enfermería", "Simulacros de la carrera y un paciente virtual para practicar la valoración.", async (h, { M }) => {
  const { page } = h;
  await abrirEstudiar(h, "simulacros");
  await h.ver("#simEmpezar", 20000);
  await h.tocar('#simAreas .est-chip[data-valor="enf_fundamentos"]');
  await h.tocar('#simCantidades .est-chip[data-valor="10"]');
  await h.foto("sim_elegir");
  await h.sub("Los simulacros de enfermería tienen <em>las áreas de la carrera</em>.");
  await h.tocar("#simEmpezar");
  await h.ver("#simPregunta", 60000);
  await contestarSimulacro(h, { lentas: 2, errar: 2, total: 2, salirDespues: 2 });
  await h.sub("Ahora, el <em>paciente virtual</em> de enfermería.");
  await h.tocar("#simSalir");
  await h.ver(".est-pestanas", 20000);
  await h.tocar('.est-pestana[data-pestana="paciente"]');
  await h.ver("#pvEmpezar", 20000);
  await h.tocar('#pvAreas .est-chip[data-valor="enf_hospitalizacion"]');
  await h.tocar('#pvDificultades .est-chip[data-valor="basico"]');
  await h.tocar("#pvEmpezar");
  await h.ver("#pvChat", 40000);
  await h.pausa(600);
  await h.foto("pv_enf");
  await h.sub("Doña Rosa está internada. Lucía la <em>valora</em>.");
  await preguntarPV(h, "Buenos días, doña Rosa, soy Lucía, estudiante de enfermería. ¿Le falta el aire?");
  await preguntarPV(h, "¿Cómo durmió anoche?");
  await preguntarPV(h, "¿Está comiendo y tomando agua?");
  await h.sub("Puede valorar la respiración y aplicar <em>escalas</em>.", { abajo: true });
  await pedirPV(h, "#pvExaminar", "Respiración");
  await pedirPV(h, "#pvPedir", "Riesgo de caídas");
  await h.foto("pv_enf_valoracion");
  await h.tocar("#pvTerminar");
  await h.ver("#pvPrincipal");
  await h.escribir("#pvPrincipal", "Oxigenación insuficiente");
  await h.escribir("#pvDiferenciales", "Riesgo de caídas");
  await h.escribir("#pvPlan", "Posición semisentada y control de la saturación.");
  await h.sub("Al terminar: su diagnóstico prioritario y <em>sus intervenciones</em>.", { abajo: true });
  await h.tocar("#pvVerEval");
  await h.ver(".pv-eval", 40000);
  await h.pausa(500);
  await h.alPrincipio(".pv-eval");
  await h.foto("pv_enf_eval");
  await h.sub("La evaluación le dice qué intervenciones fueron adecuadas y <em>cuáles faltaron</em>.");
}, { quien: LUCIA });

// ═══ LA GRABACIÓN DE CADA UNO ════════════════════════════════════════════════
// El video de Playwright graba en píxeles CSS (390 de ancho) aunque la página
// tenga el doble de densidad: sale borroso y con relleno gris. El screencast
// de Chromium da cada cuadro a resolución completa (780 × 1688), con la hora
// en que se pintó; ffmpeg los arma respetando esos tiempos.
async function filmar(page, carpeta) {
  const cdp = await page.context().newCDPSession(page);
  const cuadros = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const archivo = path.join(carpeta, `c${String(cuadros.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(archivo, Buffer.from(data, "base64"));
    cuadros.push({ archivo, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: ANCHO * 2, maxHeight: ALTO * 2 });
  return {
    async parar() {
      const fin = Date.now() / 1000;
      await cdp.send("Page.stopScreencast").catch(() => {});
      return { cuadros, fin };
    },
  };
}

function armarVideo({ cuadros, fin }, destino) {
  if (!cuadros.length) throw new Error("no se filmó ningún cuadro");
  const lista = cuadros.map((c, i) => `file '${c.archivo}'\nduration ${Math.max(0.001, (i + 1 < cuadros.length ? cuadros[i + 1].t : fin) - c.t).toFixed(3)}`);
  // El último se repite: el formato concat no usa la duración del último.
  lista.push(`file '${cuadros[cuadros.length - 1].archivo}'`);
  const archivoLista = path.join(path.dirname(cuadros[0].archivo), "lista.txt");
  fs.writeFileSync(archivoLista, "ffconcat version 1.0\n" + lista.join("\n") + "\n");
  const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", archivoLista,
    "-vf", `scale=${ANCHO * 2}:${ALTO * 2}:force_original_aspect_ratio=decrease,pad=${ANCHO * 2}:${ALTO * 2}:(ow-iw)/2:(oh-ih)/2:color=0x071a25,fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", "-an", destino], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg falló: " + r.stderr);
}

async function grabarVideo(browser, v, M) {
  const grabando = !ENSAYO && v.numero > 0 && (!SOLO || SOLO.includes(v.numero));
  if (v.antes) await v.antes(M);
  const carpetaFotos = path.join(SALIDA, "capturas", String(v.numero).padStart(2, "0"));
  fs.mkdirSync(carpetaFotos, { recursive: true });
  const crudo = fs.mkdtempSync(path.join(os.tmpdir(), "symphomed-video-"));
  const ctx = await browser.newContext({
    viewport: { width: ANCHO, height: ALTO }, deviceScaleFactor: 2, locale: "es-BO", timezoneId: "America/La_Paz",
    permissions: v.microfono ? ["microphone"] : [],
    storageState: estado.sesion[v.quien.phone] || undefined,
  });
  // La nota en vivo se pide cada 45 s: en el video, cada 7 (y nada más cambia).
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = function (fn, ms, ...resto) { return si.call(this, fn, ms === 45000 ? 7000 : ms, ...resto); };
  });
  await ctx.addInitScript((p) => { window.__demoPortada = p; },
    grabando ? { numero: v.numero, total: TOTAL, titulo: v.titulo, bajada: v.bajada, carrera: v.carrera } : null);
  await ctx.addInitScript({ path: path.join(__dirname, "capa.js") });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  if (v.microfono) await prepararVistaPrevia(page);
  const url = typeof v.inicio === "function" ? v.inicio() : v.inicio;
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.mouse.move(ANCHO / 2, ALTO - 120);
  let camara = null;
  if (grabando) {
    await page.waitForFunction(() => document.getElementById("demo-portada")?.classList.contains("ver"), null, { timeout: 10000 });
    await esperar(300);
    camara = await filmar(page, crudo);
    await esperar(3000); await page.evaluate(() => window.__demo.sinPortada()); await esperar(600);
  }
  const h = manos(page, grabando, carpetaFotos);
  try {
    await v.hacer(h, { grabando, page, ctx, M });
    if (grabando) { await esperar(1400); await h.sinSub(); await esperar(500); }
  } catch (e) {
    await h.foto("ERROR");
    throw new Error(`video ${v.numero} (${v.titulo}): ${e.message}`);
  } finally {
    estado.sesion[v.quien.phone] = await ctx.storageState().catch(() => estado.sesion[v.quien.phone]);
    const filmado = camara ? await camara.parar() : null;
    await ctx.close();
    if (errores.length) console.log(`   ⚠️  errores de la página en el video ${v.numero}: ${errores.join(" | ")}`);
    if (filmado) {
      const nombre = `${String(v.numero).padStart(2, "0")}_${v.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}.mp4`;
      armarVideo(filmado, path.join(SALIDA, nombre));
      console.log(`   🎬 ${nombre} (${filmado.cuadros.length} cuadros, ${Math.round(filmado.fin - filmado.cuadros[0].t)} s)`);
    }
    fs.rmSync(crudo, { recursive: true, force: true });
  }
}

(async () => {
  const pw = cargar(["playwright", "/opt/node22/lib/node_modules/playwright", path.join(RAIZ, "node_modules", "playwright")]);
  if (!pw) { console.log("Falta Playwright."); process.exit(1); }
  fs.mkdirSync(SALIDA, { recursive: true });
  let demo, browser;
  try {
    demo = await levantar();
    console.log(`Demo en ${BASE} · códigos ${ANA.codigo} (Ana) y ${LUCIA.codigo} (Lucía)`);
    browser = await pw.chromium.launch({
      executablePath: ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => fs.existsSync(p)),
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    for (const v of VIDEOS) {
      if (v.numero > HASTA) break;
      console.log(v.numero ? `── ${v.numero}. ${v.titulo}` : `── (${v.titulo})`);
      fs.writeFileSync(demo.dialogo, v.quien === LUCIA ? "enf" : "med");
      await grabarVideo(browser, v, demo.M);
    }
  } catch (e) {
    console.log("❌", e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (demo) {
      demo.servidor.kill();
      fs.rmSync(demo.dialogo, { force: true });
      await demo.mongoose.disconnect().catch(() => {});
      await demo.mongod.stop().catch(() => {});
    }
  }
})();
