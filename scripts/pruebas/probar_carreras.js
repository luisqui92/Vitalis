// Symphomed — Las carreras de las cuentas de estudiante (medicina y
// enfermería, modulos/estudiantes/carreras.js).
//
// La carrera sale del código de invitación y decide tres cosas: el título de
// la cuenta, la especialidad del núcleo (y con ella el formato de su nota) y
// las áreas en las que practica con el paciente virtual y los simulacros. Lo
// que se prueba:
//   1. La configuración: ningún área es de dos carreras.
//   2. El script: --carrera, con los niveles de cada una; convertir solo en
//      medicina.
//   3. Entrar con un código de enfermería: título, especialidad, sesión.
//   4. Las áreas: las de su carrera, y una de otra carrera no sirve.
//   5. Medicina, igual que antes (también un código de antes, sin carrera).
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
let nIp = 0;
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = { "X-Forwarded-For": `198.18.1.${(nIp++ % 250) + 1}` };
    if (token) headers.authorization = "Bearer " + token;
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0, cuerpo: null }));
    if (datos) req.write(datos);
    req.end();
  });
}
function correrScript(uri, args, entrada = null) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", "codigos_estudiante.js"), ...args], { cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri } });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    if (entrada !== null) h.stdin.write(entrada + "\n");
    h.stdin.end();
    h.on("exit", (codigo) => resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}
const codigosDe = (salida) => salida.match(/EST-[A-Z0-9]{6}/g) || [];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const C = require(path.join(RAIZ, "modulos", "estudiantes", "carreras"));
  console.log("── 1. La configuración ──");
  const todas = Object.entries(C.CARRERAS).flatMap(([nombre, c]) => [...new Set([...c.areasSimulacro, ...c.areasPaciente])].map(a => [a, nombre]));
  const repetidas = todas.filter(([a], i) => todas.findIndex(([b]) => b === a) !== i);
  verificar(`ningún área es de dos carreras (${todas.length} áreas)`, repetidas.length === 0);
  verificar("cada área dice de qué carrera es", todas.every(([a, n]) => C.carreraDeArea(a) === n));
  verificar("las de enfermería empiezan con «enf_»", C.CARRERAS.enfermeria.areasSimulacro.concat(C.CARRERAS.enfermeria.areasPaciente).every(a => a.startsWith("enf_")));
  verificar("una cuenta sin carrera es de medicina", C.carreraDe({ estudiante: { nivel: "interno" } }) === "medicina" && C.carreraDe({ estudiante: { carrera: "astrologia" } }) === "medicina");
  verificar("el título en su idioma", C.tituloDe("enfermeria", "estudiante", "es") === "Estudiante de enfermería" && C.tituloDe("enfermeria", "interno", "pt") === "Interno de enfermagem");
  verificar("enfermería no tiene residentes", !C.nivelValido("enfermeria", "residente") && C.nivelValido("medicina", "residente"));

  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "carreras_prueba";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = { ...require(path.join(RAIZ, "db", "models")), ...require(path.join(RAIZ, "modulos", "estudiantes", "modelos")) };
  await mongoose.connection.dropDatabase();
  await M.CodigoEstudiante.syncIndexes();

  // Nada sale de verdad: la IA no contesta (los casos y las preguntas que
  // hacen falta se cargan a mano).
  const ia = require(path.join(RAIZ, "services", "ia"));
  ia.pedirJson = async () => { throw new Error("sin IA en esta prueba"); };
  ia.pedirTexto = async () => { throw new Error("sin IA en esta prueba"); };
  const sim = require(path.join(RAIZ, "modulos", "estudiantes", "simulacros"));

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  for (const r of ["medicoAuth", "consultaMedica"]) require(path.join(RAIZ, "routes", r))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (metodo, ruta, token, cuerpo) => pedir(servidor.address().port, metodo, ruta, token, cuerpo);

  console.log("\n── 2. El script, con la carrera ──");
  let r = await correrScript(uri, ["crear", "--carrera", "enfermeria", "--nivel", "estudiante", "--meses", "6", "--cantidad", "2"]);
  const deEnfermeria = codigosDe(r.salida);
  verificar(`«crear --carrera enfermeria --nivel estudiante» → 2 códigos de enfermería (${deEnfermeria.join(", ")})`, r.codigo === 0 && deEnfermeria.length === 2
    && (await M.CodigoEstudiante.find({ codigo: { $in: deEnfermeria } }).lean()).every(c => c.carrera === "enfermeria" && c.nivel === "estudiante"));
  r = await correrScript(uri, ["crear", "--carrera", "enfermeria", "--nivel", "residente", "--meses", "6"]);
  verificar("enfermería con nivel residente → error, nada creado", r.codigo === 1 && /estudiante, interno/.test(r.salida) && (await M.CodigoEstudiante.countDocuments()) === 2);
  r = await correrScript(uri, ["crear", "--carrera", "astrologia", "--nivel", "estudiante", "--meses", "6"]);
  verificar("una carrera que no existe → error", r.codigo === 1 && /medicina, enfermeria/.test(r.salida));
  r = await correrScript(uri, ["crear", "--nivel", "interno", "--meses", "1"]);
  const deMedicina = codigosDe(r.salida)[0];
  verificar("sin --carrera, medicina como siempre", r.codigo === 0 && (await M.CodigoEstudiante.findOne({ codigo: deMedicina }).lean())?.carrera === "medicina");
  r = await correrScript(uri, ["listar"]);
  verificar("«listar» dice la carrera de cada uno", deEnfermeria.every(c => new RegExp(`${c}\\s+enfermeria`).test(r.salida)) && new RegExp(`${deMedicina}\\s+medicina`).test(r.salida));

  console.log("\n── 3. Entrar con un código de enfermería ──");
  const REG = (codigo, phone, extra = {}) => ({ codigo, phone, nombre: "Rosa Enfermera", password: "Prueba123.", universidad: "UMSA", ...extra });
  r = await P("POST", "/medico/registro-estudiante", null, REG(deEnfermeria[0], "59170050001"));
  verificar(`entra (${r.estado}) y la sesión dice la carrera`, r.estado === 200 && r.cuerpo?.estudiante?.carrera === "enfermeria" && r.cuerpo?.estudiante?.nivel === "estudiante");
  const tk = r.cuerpo?.token;
  const rosa = await M.Medico.findOne({ phone: "59170050001" }).lean();
  verificar("  ...cuenta de enfermería: carrera, especialidad del núcleo y título", rosa?.estudiante?.carrera === "enfermeria"
    && rosa.tipoEspecialidad === "enfermeria" && rosa.especialidad === "Estudiante de enfermería");
  r = await P("POST", "/medico/registro-estudiante", null, REG(deEnfermeria[1], "5511900050002", { idioma: "pt" }));
  const bia = await M.Medico.findOne({ phone: "5511900050002" }).lean();
  verificar("en portugués, el título en portugués", r.estado === 200 && bia?.especialidad === "Estudante de enfermagem");
  r = await P("GET", "/medico/estudiante/estado", tk);
  verificar("el estado de la cuenta dice la carrera", r.estado === 200 && r.cuerpo?.estudiante?.carrera === "enfermeria");
  r = await P("POST", "/medico/login", null, { phone: "59170050001", password: "Prueba123." });
  verificar("al volver a entrar, la sesión también dice la carrera", r.estado === 200 && r.cuerpo?.estudiante?.carrera === "enfermeria");
  r = await correrScript(uri, ["convertir", "59170050001"], "SI");
  verificar("«convertir» una cuenta de enfermería en una de médico → no", r.codigo === 1 && /enfermeria/.test(r.salida)
    && (await M.Medico.findOne({ phone: "59170050001" }).lean()).estudiante?.carrera === "enfermeria");
  r = await correrScript(uri, ["cuentas"]);
  verificar("«cuentas» dice la carrera", /59170050001.*enfermeria/.test(r.salida));

  console.log("\n── 4. Las áreas de su carrera ──");
  r = await P("GET", "/medico/simulacros", tk);
  verificar(`simulacros: las áreas de enfermería (${(r.cuerpo?.areas || []).length})`, r.estado === 200 && JSON.stringify(r.cuerpo?.areas) === JSON.stringify(C.CARRERAS.enfermeria.areasSimulacro));
  r = await P("POST", "/medico/simulacros", tk, { area: "clinica", cantidad: 10, modo: "practica" });
  verificar("un simulacro de un área de medicina → 400", r.estado === 400);
  // Un mixto de enfermería mezcla SOLO preguntas de enfermería, aunque el
  // banco tenga de medicina.
  const pregunta = (area, i) => ({ idioma: "es", area, tema: "t", enunciado: `Pregunta ${i} de ${area}, con su caso y su pregunta al final.`,
    opciones: ["a", "b", "c", "d", "e"], correcta: 0, explicacion: "x", porOpcion: ["", "", "", "", ""] });
  await M.PreguntaSimulacro.insertMany([
    ...C.CARRERAS.enfermeria.areasSimulacro.flatMap(a => [1, 2, 3].map(i => pregunta(a, i))),
    ...C.CARRERAS.medicina.areasSimulacro.flatMap(a => [1, 2, 3].map(i => pregunta(a, i))),
  ]);
  r = await P("POST", "/medico/simulacros", tk, { area: "mixto", cantidad: 10, modo: "practica" });
  verificar(`un simulacro «todas las áreas» se crea (${r.estado}) y queda de enfermería`, r.estado === 200
    && (await M.Simulacro.findById(r.cuerpo?.simulacro?._id).lean())?.carrera === "enfermeria");
  let mixto;
  for (let i = 0; i < 40; i++) {
    mixto = await M.Simulacro.findById(r.cuerpo?.simulacro?._id).lean();
    if (mixto?.estado !== "preparando") break;
    await esperar(100);
  }
  const elegidas = await M.PreguntaSimulacro.find({ _id: { $in: (mixto?.preguntas || []).map(p => p.preguntaId) } }).lean();
  verificar(`  ...con 10 preguntas, todas de enfermería (${mixto?.estado})`, mixto?.estado === "listo" && elegidas.length === 10 && elegidas.every(p => p.area.startsWith("enf_")));
  r = await P("GET", "/medico/pacientes-virtuales", tk);
  verificar("paciente virtual: las áreas de enfermería", r.estado === 200 && JSON.stringify(r.cuerpo?.areas) === JSON.stringify(C.CARRERAS.enfermeria.areasPaciente));
  r = await P("POST", "/medico/pacientes-virtuales", tk, { area: "clinica", dificultad: "basico" });
  verificar("un paciente de un área de medicina → 400", r.estado === 400);
  r = await P("POST", "/medico/pacientes-virtuales", tk, { area: "cualquiera", dificultad: "basico" });
  verificar(`«cualquiera» elige entre las de enfermería (${r.cuerpo?.simulacion?.area})`, r.estado === 200 && C.CARRERAS.enfermeria.areasPaciente.includes(r.cuerpo?.simulacion?.area));

  console.log("\n── 5. Medicina, igual que antes ──");
  r = await P("POST", "/medico/registro-estudiante", null, REG(deMedicina, "59170050003", { nombre: "Ana Interna" }));
  const ana = await M.Medico.findOne({ phone: "59170050003" }).lean();
  verificar("un código de medicina → cuenta de medicina general, «Interno de medicina»", r.estado === 200 && ana?.estudiante?.carrera === "medicina"
    && ana.tipoEspecialidad === "medicina_general" && ana.especialidad === "Interno de medicina");
  // Un código de antes de las carreras: sin el campo.
  await M.CodigoEstudiante.collection.insertOne({ codigo: "EST-VIEJ00", nivel: "estudiante", meses: 1, horasMes: 3, precioCentavos: 0, moneda: "BOB",
    nota: "", vence: new Date(Date.now() + 86400000), anulado: false, usadoPor: null, usadoEn: null, creadoPor: "script" });
  r = await P("POST", "/medico/registro-estudiante", null, REG("EST-VIEJ00", "59170050004", { nombre: "Juan de antes" }));
  const juan = await M.Medico.findOne({ phone: "59170050004" }).lean();
  verificar("un código de antes, sin carrera → medicina", r.estado === 200 && juan?.estudiante?.carrera === "medicina" && juan.tipoEspecialidad === "medicina_general");
  const tkAna = r.estado === 200 ? (await P("POST", "/medico/login", null, { phone: "59170050003", password: "Prueba123." })).cuerpo?.token : null;
  r = await P("GET", "/medico/simulacros", tkAna);
  verificar("sus áreas, las de medicina", JSON.stringify(r.cuerpo?.areas) === JSON.stringify(sim.AREAS));
  r = await P("POST", "/medico/simulacros", tkAna, { area: "enf_fundamentos", cantidad: 10, modo: "practica" });
  verificar("  ...y un área de enfermería no es para ella → 400", r.estado === 400);
  // Una cuenta de antes de las carreras (sin el campo) sigue con lo suyo.
  await M.Medico.updateOne({ phone: "59170050004" }, { $unset: { "estudiante.carrera": 1 } });
  r = await P("POST", "/medico/login", null, { phone: "59170050004", password: "Prueba123." });
  verificar("una cuenta de antes, sin carrera: entra como de medicina", r.estado === 200 && r.cuerpo?.estudiante?.carrera === "medicina");

  servidor.close();
  await esperar(200);
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
