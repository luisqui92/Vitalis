// Symphomed — La pantalla de una consulta, con todas las formas que puede
// tener una consulta guardada.
//
// Caso real: un médico de Brasil abría una consulta y veía «Erro ao carregar
// a consulta», sin más. La nota tenía una fila vacía (null) en la lista de
// medicamentos —la IA a veces la deja— y la pantalla se caía al leer
// «fila.nombre». El mensaje genérico escondía un error de JavaScript.
//
// Se abre la pantalla con cada forma (en proceso, con error, en vivo, con
// diferencias, confirmada, de estudiante, con filas vacías…) y en los dos
// idiomas, y ninguna puede terminar en «error al cargar».
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");
const http = require("http");
const { spawn } = require("child_process");
const PUERTO = 3961;
function cargarPlaywright() {
  for (const c of ["playwright", "/opt/node22/lib/node_modules/playwright", path.join(RAIZ, "node_modules", "playwright")]) {
    try { return require(c); } catch { /* seguimos */ }
  }
  return null;
}
const pw = cargarPlaywright();
let MongoMemoryServer;
try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
let fallos = 0;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const traer = (ruta) => new Promise((ok, mal) => { const r = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta }, (x) => { x.resume(); x.on("end", () => ok(x.statusCode)); }); r.on("error", mal); });

const ID = "0123456789abcdef01234567";
const base = { _id: ID, pacienteId: "0123456789abcdef01234568", pacienteNombre: "Paciente", createdAt: new Date().toISOString() };
const nota = { motivoConsulta: "Dor", sintomas: ["febre"], diagnostico: "Faringite", plan: "Repouso", medicamentosRecetados: [{ nombre: "Amoxicilina", dosis: "500 mg" }], examenesSolicitados: [] };
const FORMAS = {
  procesando: { ...base, estado: "procesando", notaClinicaEstado: "pendiente" },
  error: { ...base, estado: "error", error: "falló", notaClinicaEstado: "pendiente" },
  sinNota: { ...base, estado: "completado", notaClinicaEstado: "pendiente", segmentos: [{ hablante: "A", texto: "hola" }] },
  notaError: { ...base, estado: "completado", notaClinicaEstado: "error", segmentos: [] },
  editable: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: nota, segmentos: [{ hablante: "A", texto: "x" }], verificacionMedicamentos: [{ estado: "ok" }] },
  editableNoNombrado: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: nota, verificacionMedicamentos: [{ estado: "desconocido", noNombrado: true }] },
  editableSinVerif: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: nota },
  confirmada: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: nota, confirmadaEn: new Date().toISOString(), segmentos: [] },
  notaVacia: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: {}, segmentos: [] },
  // Lo que la IA a veces deja: una fila vacía en los medicamentos.
  medsNull: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: { ...nota, medicamentosRecetados: [null, { nombre: "X" }] }, verificacionMedicamentos: [null, { estado: "ok" }] },
  sinMeds: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "x" } },
  reconsulta: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: { ...nota, reconsultaSugerida: { fechaHora: new Date().toISOString(), estado: "pendiente", textoOriginal: "x" } } },
  hilo: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: nota, hiloClinico: { conexiones: [{ consultaId: ID, queDijoEntonces: "a", porQueImporta: "b" }], preguntas: ["c"] } },
  vivoPendiente: { ...base, estado: "procesando", notaFuente: "vivo", notaClinicaEstado: "pendiente", transcripcionEnVivo: "x", verificacion: { estado: "pendiente" } },
  vivoNota: { ...base, estado: "procesando", notaFuente: "vivo", notaClinicaEstado: "completado", notaClinica: nota, transcripcionEnVivo: "x", verificacion: { estado: "pendiente" } },
  vivoDif: { ...base, estado: "completado", notaFuente: "vivo", notaClinicaEstado: "completado", notaClinica: nota, segmentos: [], verificacion: { estado: "diferencias", diferencias: [{ tipo: "dosis", indice: 0, enAudio: "x", medicamento: { nombre: "A", dosis: "1" } }, { tipo: "falta", indice: null, enAudio: "y", medicamento: { nombre: "B" } }] } },
  vivoError: { ...base, estado: "error", notaFuente: "vivo", notaClinicaEstado: "completado", notaClinica: nota, verificacion: { estado: "error" } },
  tele: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: nota, segmentos: [{ hablante: "A", quien: "medico", texto: "x" }] },
  tratamientos: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: { ...nota, tratamientosSugeridos: [{ _id: "t1", estado: "pendiente", itemMencionado: "x", piezaFdi: 11 }] } },
  antecedentes: { ...base, estado: "completado", notaClinicaEstado: "completado", notaClinica: { ...nota, antecedentesPersonalesNuevos: ["HAS"], antecedentesFamiliaresNuevos: [{ parentesco: "mae", condicion: "DM" }], vacunasMencionadas: [{ nombre: "BCG" }] } },
  // La forma exacta de una consulta real que mostró «Erro ao carregar a
  // consulta» (un médico de Brasil): campos en null donde la pantalla
  // esperaba listas u objetos, verificación sin estado, hilo sin conexiones.
  yerko: { ...base, estado: "completado", notaClinicaEstado: "completado", notaFuente: "audio", transcripcionEnVivo: "",
    verificacion: { estado: "" }, hiloClinico: { generadoEn: null }, confirmadaEn: null, notaEditadaPorMedico: false,
    duracionSegundos: 600, tiempos: { transcripcionMs: 30000, notaMs: 9000 }, transcripcionCompleta: "texto",
    segmentos: Array.from({ length: 40 }, (_, i) => ({ hablante: i % 2 ? "B" : "A", quien: "", texto: "frase", inicioSeg: i, finSeg: i + 1 })),
    notaClinica: { motivoConsulta: "m", sintomas: ["a", "b"], antecedentesRelevantes: "x", diagnostico: "d", diagnosticosDiferenciales: null,
      plan: "p", medicamentosRecetados: [{ nombre: "A", dosis: "1", frecuencia: null }, { nombre: "B", dosis: "2", frecuencia: null }],
      examenesSolicitados: ["e1", "e2"], proximoControl: "c", reconsultaSugerida: null, antecedentesPersonalesNuevos: [], antecedentesFamiliaresNuevos: [],
      vacunasMencionadas: [], tratamientosSugeridos: [], examenOcularSugerido: [], odontogramaSugerido: [], ginecoSugerido: [] },
    verificacionMedicamentos: [{ estado: "ok" }, { estado: "desconocido", noNombrado: true }] },
  estudiante: { ...base, estado: "completado", deEstudiante: true, notaClinicaEstado: "completado", notaClinica: nota },
};

(async () => {
  if (!pw || !MongoMemoryServer) { console.log("⏭️  SALTEADA: falta Playwright o la base de prueba. Esto NO es un ✅."); process.exit(0); }
  const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", process.env.CHROMIUM_PATH].find(p => p && fs.existsSync(p));
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "formas";
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), OPENAI_KEY: "x" };
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require(path.join(RAIZ, "node_modules", "mongoose"));
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await M.Medico.create({ phone: "70042001", nombre: "Dr. Formas", passwordHash: await hashPassword("Prueba123."), activo: true, idioma: "es" });
  await M.Medico.create({ phone: "5511900042002", nombre: "Dr. Formas BR", passwordHash: await hashPassword("Prueba123."), activo: true, idioma: "pt", moneda: "BRL" });
  const srv = spawn(process.execPath, [path.join(RAIZ, "index.js")], { cwd: RAIZ, env, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if (await traer("/health") === 200) break; } catch { } await esperar(500); }
  const b = await pw.chromium.launch({ executablePath: exe });
  for (const [phone, idioma] of [["70042001", "es"], ["5511900042002", "pt"]]) {
  console.log(`── ${idioma === "es" ? "Español" : "Portugués"} ──`);
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  let actual = null;
  await page.route(`**/medico/consultas/${ID}`, (r) => r.fulfill({ json: { consulta: actual } }));
  await page.goto(`http://127.0.0.1:${PUERTO}/app`);
  await page.fill("#lPhone", phone); await page.fill("#lPass", "Prueba123."); await page.click("#lBtn");
  await page.waitForSelector("#avatarHomeBox", { timeout: 20000 });
  for (const [nombre, c] of Object.entries(FORMAS)) {
    actual = c;
    errores.length = 0;
    const msg = await page.evaluate(async (id) => {
      try { await renderDetalle(id); } catch (e) { return "THROW " + e.message; }
      return document.getElementById("app").innerText.slice(0, 120);
    }, ID);
    const mal = /carregar a consulta|cargar la consulta|THROW/i.test(msg) || errores.length;
    if (mal) fallos++;
    console.log(`${mal ? "❌" : "✅"} ${nombre}${mal ? " → " + msg.replace(/\s+/g, " ") + " " + errores.join(" | ") : ""}`);
    await page.evaluate(() => detenerPolling());
  }
  if (idioma === "es") {
    // El servidor reiniciándose: dos pedidos sin respuesta, después sí.
    let caidas = 2;
    actual = FORMAS.editable;
    await page.unroute(`**/medico/consultas/${ID}`);
    await page.route(`**/medico/consultas/${ID}`, (r) => (caidas-- > 0 ? r.abort("connectionrefused") : r.fulfill({ json: { consulta: actual } })));
    await page.evaluate((id) => { renderDetalle(id); }, ID);
    await page.waitForSelector("#nfDiagnostico", { timeout: 15000 }).catch(() => {});
    const ok = await page.locator("#nfDiagnostico").count() === 1;
    if (!ok) fallos++;
    console.log(`${ok ? "✅" : "❌"} el servidor no contesta dos veces (reiniciándose) → reintenta solo y abre la consulta`);
    // Una respuesta de verdad (no existe): se muestra al toque, con «Intentar de nuevo».
    await page.unroute(`**/medico/consultas/${ID}`);
    await page.route(`**/medico/consultas/${ID}`, (r) => r.fulfill({ status: 404, json: { error: "Consulta no encontrada" } }));
    const t0 = Date.now();
    await page.evaluate((id) => { renderDetalle(id); }, ID);
    await page.waitForSelector("#btnReintentarDetalle", { timeout: 5000 }).catch(() => {});
    const ok2 = (await page.locator("#btnReintentarDetalle").count()) === 1 && Date.now() - t0 < 2000 && /no encontrada/.test(await page.innerText("#app"));
    if (!ok2) fallos++;
    console.log(`${ok2 ? "✅" : "❌"} un 404 se muestra enseguida, con su mensaje y «Intentar de nuevo»`);
    await page.evaluate(() => detenerPolling());
  }
  await page.close();
  }
  await b.close(); srv.kill(); await mongoose.disconnect(); await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
