// Symphomed — Cuentas de estudiante (services/estudiantes.js).
//
// Se prueba lo que un estudiante PUEDE (entrar con su código, grabar, tener
// sus casos) y lo que NO (recetar, escribirle a pacientes, dar turnos,
// cobrar), todo del lado del servidor, que es el que decide. Y el script con
// el que Symphomed crea y maneja los códigos, corrido de verdad.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let nIp = 0;
function pedir(puerto, metodo, ruta, token, cuerpo, binario = false) {
  return new Promise((resolve) => {
    const headers = { "X-Forwarded-For": `198.18.0.${(nIp++ % 250) + 1}` };
    if (token) headers.authorization = "Bearer " + token;
    let datos = null;
    if (Buffer.isBuffer(cuerpo)) { datos = cuerpo; headers["content-type"] = "audio/ogg"; }
    else if (cuerpo !== undefined) { datos = JSON.stringify(cuerpo); headers["content-type"] = "application/json"; }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      const partes = [];
      res.on("data", (c) => partes.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(partes);
        let j = null; if (!binario) { try { j = JSON.parse(buf.toString()); } catch { /* no era JSON */ } }
        resolve({ estado: res.statusCode, cuerpo: j, buf });
      });
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

function textoPdf(buf) {
  const s = buf.toString("latin1");
  let todo = "";
  for (const m of s.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const desde = m.index + m[0].length;
    try { todo += zlib.inflateSync(Buffer.from(s.slice(desde, desde + Number(m[1])), "latin1")).toString("latin1"); } catch { /* imagen */ }
  }
  return todo;
}

(async () => {
  const { rutaBloqueada, normalizarCodigo, generarCodigo } = require(path.join(RAIZ, "services", "estudiantes"));
  console.log("── 1. Las reglas ──");
  verificar("un código se escribe como venga: «est ab12cd» → «EST-AB12CD»", normalizarCodigo("est ab12cd") === "EST-AB12CD" && normalizarCodigo("AB12CD") === "EST-AB12CD");
  verificar("los códigos no usan letras que se confunden (0, O, 1, I, L)", Array.from({ length: 50 }, generarCodigo).every(c => /^EST-[A-HJKMNP-Z2-9]{6}$/.test(c)));
  verificar("recetar está bloqueado", rutaBloqueada("POST", "/medico/pacientes/abc/recetas") && rutaBloqueada("POST", "/medico/recetas/x/enviar"));
  verificar("ver su agenda (vacía) no, crear un turno sí", !rutaBloqueada("GET", "/medico/citas") && rutaBloqueada("POST", "/medico/citas"));
  verificar("Memed y la teleconsulta, ni para leer", rutaBloqueada("GET", "/medico/pacientes/abc/memed/sesion") && rutaBloqueada("GET", "/medico/teleconsultas"));
  verificar("reconsulta por WhatsApp, llave del paciente, informes enviados: bloqueados",
    rutaBloqueada("POST", "/medico/consultas/x/reconsulta/confirmar") && rutaBloqueada("POST", "/medico/pacientes/x/llave") && rutaBloqueada("POST", "/medico/informes/x/enviar"));
  verificar("grabar, sus pacientes y su nota: abiertos",
    !rutaBloqueada("POST", "/medico/consultas") && !rutaBloqueada("POST", "/medico/pacientes") && !rutaBloqueada("POST", "/medico/consultas/x/confirmar")
    && !rutaBloqueada("GET", "/medico/pacientes/x/kardex.pdf") && !rutaBloqueada("POST", "/medico/pacientes/x/medicamentos"));

  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "estudiantes_prueba";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken, verificarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await M.CodigoEstudiante.syncIndexes();

  // Nada sale de verdad: ni AssemblyAI ni WhatsApp.
  const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));
  assemblyai.transcribirConsultaMedica = () => new Promise(() => {});
  assemblyai.crearTokenStreaming = async () => "token-de-prueba";
  const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
  const enviados = [];
  meta.enviarTextoOPlantilla = async (...a) => { enviados.push(a); return { ok: true }; };
  const { procesarRecordatoriosVencidos } = require(path.join(RAIZ, "services", "recordatorioMedicamento"));

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use(require(path.join(RAIZ, "services", "estudiantes")).middlewareEstudiantes);
  for (const r of ["medicoAuth", "consultaMedica", "kardexPdf"]) require(path.join(RAIZ, "routes", r))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const P = (metodo, ruta, token, cuerpo, bin) => pedir(puerto, metodo, ruta, token, cuerpo, bin);

  console.log("\n── 2. El script crea los códigos ──");
  let r = await correrScript(uri, ["crear", "--nivel", "interno", "--meses", "6", "--cantidad", "3", "--nota", "Univalle 5to año"]);
  const codigos = codigosDe(r.salida);
  verificar(`«crear --nivel interno --meses 6 --cantidad 3» → 3 códigos (${codigos.join(", ")})`, r.codigo === 0 && codigos.length === 3);
  const enBase = await M.CodigoEstudiante.find({}).lean();
  verificar("  ...de interno, 12 h por mes y Bs 89 × 6 meses, por defecto", enBase.length === 3 && enBase.every(c => c.nivel === "interno" && c.horasMes === 12 && c.precioCentavos === 8900 * 6 && c.nota === "Univalle 5to año"));
  r = await correrScript(uri, ["crear", "--nivel", "decano", "--meses", "6"]);
  verificar("un nivel que no existe → error, nada creado", r.codigo === 1 && (await M.CodigoEstudiante.countDocuments()) === 3);
  r = await correrScript(uri, ["crear", "--nivel", "residente", "--meses", "1", "--horas", "2"]);
  const codResidente = codigosDe(r.salida)[0];
  r = await correrScript(uri, ["listar"]);
  verificar("«listar» muestra los libres", codigos.every(c => r.salida.includes(c)) && /libre/.test(r.salida));

  console.log("\n── 3. Entrar con un código ──");
  const REG = (codigo, phone, extra = {}) => ({ codigo, phone, nombre: "Ana Interna", password: "Prueba123.", universidad: "Univalle", ...extra });
  r = await P("POST", "/medico/registro-estudiante", null, REG(codigos[0].toLowerCase().replace("-", " "), "+591 7004 0001"));
  verificar("con el código (escrito en minúscula y con espacio) → entra directo, con sesión", r.estado === 200 && !!r.cuerpo?.token);
  const tkEst = r.cuerpo.token;
  verificar("  ...el token lleva la marca de estudiante", verificarToken(tkEst)?.estudiante === true);
  verificar("  ...y la sesión dice el nivel, para dibujar el Symphomed simple", r.cuerpo.estudiante?.nivel === "interno");
  const ana = await M.Medico.findOne({ phone: "59170040001" }).lean();
  const enSeisMeses = new Date(); enSeisMeses.setMonth(enSeisMeses.getMonth() + 6);
  verificar("  ...cuenta activa, aprobada, con el teléfono en dígitos", ana?.activo && ana.estadoCuenta === "aprobada");
  verificar("  ...acceso por 6 meses, y el plan cubre sus consultas (no descuentan saldo)",
    Math.abs(new Date(ana.estudiante.hasta) - enSeisMeses) < 86400000 && Math.abs(new Date(ana.suscripcion.hasta) - enSeisMeses) < 86400000);
  verificar("  ...el código queda usado por ella", (await M.CodigoEstudiante.findOne({ codigo: codigos[0] }).lean()).usadoPor === "59170040001");
  r = await P("POST", "/medico/registro-estudiante", null, REG(codigos[0], "59170040009"));
  verificar("el MISMO código otra vez → no sirve", r.estado === 400);
  r = await P("POST", "/medico/registro-estudiante", null, REG("EST-ZZZZZZ", "59170040009"));
  verificar("un código inventado → no sirve", r.estado === 400);
  r = await P("POST", "/medico/registro-estudiante", null, REG(codigos[1], "+59170040001"));
  verificar("un teléfono que ya tiene cuenta → 409, y el código NO se gasta", r.estado === 409 && !(await M.CodigoEstudiante.findOne({ codigo: codigos[1] }).lean()).usadoPor);
  await correrScript(uri, ["anular", codigos[1]]);
  r = await P("POST", "/medico/registro-estudiante", null, REG(codigos[1], "59170040009"));
  verificar("«anular» un código libre → ya no sirve", r.estado === 400);
  await M.CodigoEstudiante.updateOne({ codigo: codigos[2] }, { $set: { vence: new Date(Date.now() - 1000) } });
  r = await P("POST", "/medico/registro-estudiante", null, REG(codigos[2], "59170040009"));
  verificar("un código vencido sin usar → no sirve", r.estado === 400);
  r = await correrScript(uri, ["anular", codigos[0]]);
  verificar("anular uno ya usado → avisa que no le saca la cuenta", r.codigo === 1 && /ya lo usó/.test(r.salida));
  const [a1, a2] = await Promise.all([
    P("POST", "/medico/registro-estudiante", null, REG(codResidente, "59170040021")),
    P("POST", "/medico/registro-estudiante", null, REG(codResidente, "59170040022")),
  ]);
  verificar("dos personas a la vez con el mismo código → entra UNA", [a1.estado, a2.estado].sort().join() === "200,400");
  const tkRes = (a1.estado === 200 ? a1 : a2).cuerpo.token;
  const telRes = a1.estado === 200 ? "59170040021" : "59170040022";

  console.log("\n── 4. Lo que un estudiante no puede hacer (lo corta el servidor) ──");
  await M.Medico.create({ phone: "70049999", nombre: "Dr. Médico", passwordHash: await hashPassword("Prueba123."), activo: true });
  const tkMed = generarToken("70049999", "medico", 36e5);
  const pac = await M.Paciente.create({ medicoPhone: "59170040001", nombre: "Paciente de Ana", telefono: "59170000001" });
  for (const [metodo, ruta] of [["POST", `/medico/pacientes/${pac._id}/recetas`], ["POST", "/medico/citas"], ["GET", "/medico/teleconsultas"],
    ["POST", `/medico/pacientes/${pac._id}/llave`], ["POST", "/medico/consultas/x/reconsulta/confirmar"], ["POST", "/medico/finanzas/cobros"]]) {
    const est = await P(metodo, ruta, tkEst, metodo === "POST" ? {} : undefined);
    const med = await P(metodo, ruta, tkMed, metodo === "POST" ? {} : undefined);
    verificar(`${metodo} ${ruta.replace(String(pac._id), ":id")} → estudiante 403, médico no`, est.estado === 403 && est.cuerpo?.estudiante === true && med.estado !== 403);
  }
  r = await P("GET", "/medico/consultas", tkEst);
  verificar("sus consultas sí las ve", r.estado === 200);

  console.log("\n── 5. Confirmar una nota: sin receta, sin WhatsApp ──");
  const c1 = await M.ConsultaMedica.create({ medicoPhone: "59170040001", pacienteId: pac._id, pacienteNombre: pac.nombre, estado: "completado",
    deEstudiante: true, transcripcionCompleta: "le doy amoxicilina quinientos", notaClinicaEstado: "completado",
    notaClinica: { motivoConsulta: "Faringitis", medicamentosRecetados: [{ nombre: "Amoxicilina", dosis: "500 mg" }],
      reconsultaSugerida: { fechaHora: new Date(Date.now() + 7 * 86400000), textoOriginal: "en 7 días", estado: "pendiente" } } });
  r = await P("POST", `/medico/consultas/${c1._id}/confirmar`, tkEst, {
    nota: { motivoConsulta: "Faringitis", medicamentosRecetados: [{ origen: 0, nombre: "Amoxicilina", dosis: "500 mg" }] },
    aplicar: { receta: true, reconsulta: { activo: true, fechaHora: new Date(Date.now() + 7 * 86400000).toISOString() }, medicamentos: [0] } });
  verificar("confirmar → 200, la nota queda", r.estado === 200);
  verificar("  ...pero NO se generó receta aunque la pidió", !r.cuerpo?.recetaId && (await M.Receta.countDocuments({ medicoPhone: "59170040001" })) === 0);
  verificar("  ...ni turno ni WhatsApp de reconsulta", (await M.Cita.countDocuments({ medicoPhone: "59170040001" })) === 0 && enviados.length === 0);
  verificar("  ...y la medicación sí quedó en SU caso", (await M.Medicamento.countDocuments({ medicoPhone: "59170040001", nombre: "Amoxicilina" })) === 1);

  console.log("\n── 6. El recordatorio de medicamento al paciente no sale ──");
  await M.Medicamento.create({ pacienteId: pac._id, medicoPhone: "59170040001", nombre: "Losartán", frecuencia: "cada 3 días",
    fechaInicio: new Date(Date.now() - 10 * 86400000), recordatorio: { activo: true, intervaloDias: 3 } });
  await procesarRecordatoriosVencidos();
  verificar("ningún WhatsApp al paciente, y el recordatorio quedó apagado",
    enviados.length === 0 && !(await M.Medicamento.findOne({ nombre: "Losartán" }).lean()).recordatorio.activo);

  console.log("\n── 7. Grabar: con acceso sí, vencido o sin horas no ──");
  r = await P("GET", "/medico/estudiante/estado", tkEst);
  verificar("el estado dice nivel, horas y vencimiento", r.cuerpo?.estudiante?.nivel === "interno" && r.cuerpo.estudiante.horasMes === 12 && !r.cuerpo.estudiante.bloqueado);
  r = await P("POST", `/medico/consultas?pacienteId=${pac._id}`, tkEst, Buffer.from("audio"));
  verificar("con acceso, sube la grabación → 202", r.estado === 202);
  verificar("  ...y la consulta queda marcada como de estudiante", (await M.ConsultaMedica.findById(r.cuerpo.consulta._id).lean()).deEstudiante === true);
  // La residente tiene 2 h por mes: se le cargan 2 h usadas este mes.
  const pacRes = await M.Paciente.create({ medicoPhone: telRes, nombre: "Paciente de la residente" });
  await M.ConsultaMedica.create({ medicoPhone: telRes, pacienteId: pacRes._id, estado: "completado", duracionSegundos: 2 * 3600 });
  r = await P("GET", "/medico/estudiante/estado", tkRes);
  verificar("usó sus 2 horas del mes → el estado dice que no puede grabar, y por qué", r.cuerpo.estudiante.sinHoras && /horas de audio/.test(r.cuerpo.estudiante.motivo));
  r = await P("GET", "/medico/transcripcion-token", tkRes);
  verificar("  ...no puede empezar a grabar (402)", r.estado === 402);
  r = await P("POST", `/medico/consultas?pacienteId=${pacRes._id}`, tkRes, Buffer.from("audio"));
  verificar("  ...ni subir (402)", r.estado === 402);
  await M.Medico.updateOne({ phone: "59170040001" }, { $set: { "estudiante.hasta": new Date(Date.now() - 86400000) } });
  r = await P("GET", "/medico/transcripcion-token", tkEst);
  verificar("acceso vencido → no graba, y le dice que pida la renovación", r.estado === 402 && /venció/.test(r.cuerpo?.error || ""));
  r = await P("GET", "/medico/consultas", tkEst);
  verificar("  ...pero sus casos los sigue viendo", r.estado === 200);
  r = await P("POST", "/medico/login", null, { phone: "59170040001", password: "Prueba123." });
  verificar("  ...y puede entrar", r.estado === 200);

  console.log("\n── 8. El Kardex en PDF lleva la marca ──");
  r = await P("GET", `/medico/pacientes/${pac._id}/kardex.pdf`, tkEst, undefined, true);
  verificar("«REGISTRO DE ESTUDIANTE», arriba de todo", r.estado === 200 && /REGISTRO DE ESTUDIANTE/.test(textoPdf(r.buf)));
  const pacMed = await M.Paciente.create({ medicoPhone: "70049999", nombre: "Paciente del médico" });
  r = await P("GET", `/medico/pacientes/${pacMed._id}/kardex.pdf`, tkMed, undefined, true);
  verificar("el de un médico, no", r.estado === 200 && !/REGISTRO DE ESTUDIANTE/.test(textoPdf(r.buf)));

  console.log("\n── 9. Renovar, ver las cuentas y recibirse ──");
  r = await correrScript(uri, ["renovar", "+59170040001", "--meses", "3"]);
  const tras = await M.Medico.findOne({ phone: "59170040001" }).lean();
  verificar("«renovar» un vencido → 3 meses desde hoy, y vuelve a grabar", r.codigo === 0 && new Date(tras.estudiante.hasta) > new Date(Date.now() + 80 * 86400000));
  r = await P("GET", "/medico/transcripcion-token", tkEst);
  verificar("  ...el token de la vista previa ya sale", r.estado === 200);
  r = await correrScript(uri, ["cuentas"]);
  verificar("«cuentas» lista a los estudiantes con sus horas", /Ana Interna/.test(r.salida) && /\/12 h/.test(r.salida));
  r = await correrScript(uri, ["convertir", "59170040001"], "no");
  verificar("«convertir» sin escribir SI → no toca nada", /Cancelado/.test(r.salida) && !!(await M.Medico.findOne({ phone: "59170040001" }).lean()).estudiante?.nivel);
  r = await correrScript(uri, ["convertir", "59170040001"], "SI");
  const medicoYa = await M.Medico.findOne({ phone: "59170040001" }).lean();
  verificar("«convertir» con SI → cuenta de médico, con sus casos", r.codigo === 0 && !medicoYa.estudiante?.nivel && (await M.Paciente.countDocuments({ medicoPhone: "59170040001" })) === 1);
  r = await P("POST", "/medico/login", null, { phone: "59170040001", password: "Prueba123." });
  verificar("  ...al volver a entrar, el token ya no es de estudiante", r.estado === 200 && !verificarToken(r.cuerpo.token)?.estudiante && !r.cuerpo.estudiante);
  r = await P("GET", `/medico/pacientes/${pac._id}/kardex.pdf`, r.cuerpo.token, undefined, true);
  verificar("  ...y lo que grabó como estudiante conserva la marca en el PDF", /REGISTRO DE ESTUDIANTE/.test(textoPdf(r.buf)));

  servidor.close();
  await esperar(200);
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
