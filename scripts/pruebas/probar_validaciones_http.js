// Symphomed — Un id o una fecha mal escritos son un 400 (o un 404), no un
// "Error interno".
//
// asyncRoute (services/httpHelpers.js) convertía en 500 todo lo que no fuera
// un ErrorHttp. Un id "abc" en la URL, una fecha "no-es-fecha" o un 31 de
// febrero terminaban en un CastError o un ValidationError de Mongoose, y el
// médico veía "Error interno" sin saber qué corregir. Peor: el 31 de febrero
// muchas veces ni fallaba, porque new Date() lo acomoda en el 3 de marzo y se
// guardaba ahí (auditoría de QA, M2). Lo que se prueba:
//   1. asyncRoute: CastError → 400 (o 404 si es el id), ValidationError → 400,
//      un duplicado → 409, y un error después de responder no responde dos
//      veces.
//   2. Ids mal escritos → 404, en las rutas que buscan con obtenerOFallar y
//      en las que borran directo.
//   3. Fechas de un <input type="date"> que no existen → 400, y no se guarda
//      nada: mediciones, vacunas, recetas, el fin de un embarazo.
//   4. Fechas de un <input type="datetime-local"> (citas) que no existen →
//      400, y la cita queda como estaba.
//   5. Lo que andaba sigue andando: un medicamento se da de baja con la hora
//      completa, y una fecha válida se guarda en su día.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
// Sin el arreglo, un error después de responder hacía que asyncRoute
// respondiera dos veces: ERR_HTTP_HEADERS_SENT dentro del catch, una promesa
// rechazada que nadie atiende, y Node tira el proceso entero.
const rechazosSueltos = [];
process.on("unhandledRejection", (e) => { rechazosSueltos.push(e); });

function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.setTimeout(10000, () => req.destroy(new Error("sin respuesta")));
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

(async () => {
  console.log("── 0. Las fechas, sin base ──");
  const { fechaCivilValida, ErrorHttp } = require(path.join(RAIZ, "services", "httpHelpers"));
  const tira400 = (fn) => { try { fn(); return false; } catch (e) { return e instanceof ErrorHttp && e.status === 400; } };
  verificar("services/httpHelpers.js tiene fechaCivilValida", typeof fechaCivilValida === "function");
  if (typeof fechaCivilValida === "function") {
    verificar("fechaCivilValida: el 16 de septiembre queda al mediodía UTC de ese día",
      fechaCivilValida("2026-09-16").toISOString() === "2026-09-16T12:00:00.000Z");
    verificar("  ...el 31 de febrero → 400 (new Date lo pasaba al 3 de marzo)", tira400(() => fechaCivilValida("2026-02-31")));
    verificar("  ...el 29 de febrero de un año que no es bisiesto → 400", tira400(() => fechaCivilValida("2026-02-29")));
    verificar("  ...y el de uno que sí → vale", fechaCivilValida("2028-02-29").toISOString().startsWith("2028-02-29"));
    verificar("  ...«31/02/2026» y «ayer» → 400", tira400(() => fechaCivilValida("31/02/2026")) && tira400(() => fechaCivilValida("ayer")));
  }

  const z = require(path.join(RAIZ, "services", "zonaHoraria"));
  const invalida = (s) => isNaN(z.localAInstante("America/La_Paz", s).getTime());
  verificar("localAInstante: «2026-13-45T25:99» es inválida (antes daba el 15 de febrero de 2027)", invalida("2026-13-45T25:99"));
  verificar("  ...el 30 de febrero a las 10:00, inválida", invalida("2026-02-30T10:00"));
  verificar("  ...las 24:00 y los 60 minutos, inválidos", invalida("2026-09-16T24:00") && invalida("2026-09-16T10:60"));
  verificar("  ...el mes 00, inválido", invalida("2026-00-10T10:00"));
  verificar("  ...las 23:59 de un día que existe siguen valiendo",
    z.localAInstante("America/La_Paz", "2026-09-16T23:59").toISOString() === "2026-09-17T03:59:00.000Z");
  verificar("  ...y el 29 de febrero de un bisiesto también",
    z.localAInstante("America/Sao_Paulo", "2028-02-29T09:00").toISOString() === "2028-02-29T12:00:00.000Z");

  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de prueba. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "validaciones_http";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { asyncRoute } = require(path.join(RAIZ, "services", "httpHelpers"));
  await mongoose.connection.dropDatabase();
  await M.Medico.syncIndexes();

  const express = require("express");
  const app = express();
  app.use(express.json());
  for (const r of ["recetas", "mediciones", "vacunas", "citas", "embarazo", "medicamentos"]) require(path.join(RAIZ, "routes", r))(app);
  // Dos rutas de prueba para lo que ninguna ruta real hace a propósito.
  app.post("/prueba/duplicado", asyncRoute(async (req, res) => {
    await M.Medico.create({ phone: "70077001", nombre: "Otra vez el mismo teléfono", passwordHash: "x" });
    res.json({ ok: true });
  }));
  app.post("/prueba/despues-de-responder", asyncRoute(async (req, res) => {
    res.status(202).json({ ok: true });
    await new Promise(r => setImmediate(r));
    throw new Error("falló el trabajo que siguió después del 202");
  }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;

  // Un médico por sección: limitMedico deja 60 pedidos por minuto a cada uno.
  const MEDICOS = ["70077001", "70077002", "70077003", "70077004"];
  for (const phone of MEDICOS) await M.Medico.create({ phone, nombre: `Dr. ${phone}`, passwordHash: "x", activo: true });
  const tk = Object.fromEntries(MEDICOS.map(p => [p, generarToken(p, "medico", 36e5)]));
  const como = (phone) => (metodo, ruta, cuerpo) => pedir(puerto, metodo, ruta, tk[phone], cuerpo);
  const pacientes = {};
  for (const phone of MEDICOS) pacientes[phone] = await M.Paciente.create({ medicoPhone: phone, nombre: "Ana Pérez" });

  console.log("\n── 1. asyncRoute ──");
  let P = como(MEDICOS[0]);
  let r = await P("POST", "/prueba/duplicado", {});
  verificar(`un duplicado (E11000) → 409, no 500 (${r.estado})`, r.estado === 409 && /Ya existe/.test(r.cuerpo?.error || ""));
  r = await P("POST", "/prueba/despues-de-responder", {});
  await new Promise(ok => setTimeout(ok, 50));
  verificar(`un error después del 202 → el cliente recibe su 202 (${r.estado})`, r.estado === 202);
  verificar("  ...y no se intenta responder dos veces (ninguna promesa rechazada suelta)", rechazosSueltos.length === 0);

  console.log("\n── 2. Ids mal escritos → 404 ──");
  r = await P("GET", "/medico/recetas/abc");
  verificar(`GET /medico/recetas/abc → 404 «Receta no encontrada» (${r.estado})`, r.estado === 404 && r.cuerpo?.error === "Receta no encontrada");
  r = await P("POST", "/medico/pacientes/abc/mediciones", { tipo: "peso", valor: 70, fecha: "2026-09-16" });
  verificar(`POST a un paciente «abc» → 404 «Paciente no encontrado» (${r.estado})`, r.estado === 404 && r.cuerpo?.error === "Paciente no encontrado");
  r = await P("DELETE", "/medico/vacunas/xyz");
  verificar(`DELETE /medico/vacunas/xyz (borra directo, sin obtenerOFallar) → 404 (${r.estado})`, r.estado === 404);
  r = await P("DELETE", "/medico/mediciones/zzz");
  verificar(`DELETE /medico/mediciones/zzz → 404 (${r.estado})`, r.estado === 404);
  r = await P("PATCH", "/medico/citas/123", { motivo: "x" });
  verificar(`PATCH /medico/citas/123 → 404 (${r.estado})`, r.estado === 404);

  console.log("\n── 3. Fechas de un <input type=\"date\"> ──");
  const pac = pacientes[MEDICOS[0]];
  const cuantas = (Modelo) => Modelo.countDocuments({ pacienteId: pac._id });
  for (const fecha of ["no-es-fecha", "2026-02-30", "16/09/2026"]) {
    r = await P("POST", `/medico/pacientes/${pac._id}/mediciones`, { tipo: "peso", valor: 70, fecha });
    verificar(`una medición con fecha «${fecha}» → 400 (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && /fecha/.test(r.cuerpo?.error || ""));
  }
  verificar("  ...y no se guardó ninguna", (await cuantas(M.Medicion)) === 0);
  r = await P("POST", `/medico/pacientes/${pac._id}/mediciones`, { tipo: "peso", valor: 70, fecha: "2026-09-16" });
  verificar(`una medición del 16 de septiembre → 201, guardada ese día (${r.cuerpo?.medicion?.fecha})`,
    r.estado === 201 && r.cuerpo?.medicion?.fecha === "2026-09-16T12:00:00.000Z");

  for (const fecha of ["31/02/2026", "2026-02-31"]) {
    r = await P("POST", `/medico/pacientes/${pac._id}/vacunas`, { nombre: "Antitetánica", fecha });
    verificar(`una vacuna con fecha «${fecha}» → 400 (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400);
  }
  verificar("  ...y no se guardó ninguna (antes el 31 de febrero quedaba el 3 de marzo)", (await cuantas(M.Vacuna)) === 0);
  r = await P("POST", `/medico/pacientes/${pac._id}/vacunas`, { nombre: "Antitetánica", fecha: "2026-02-28" });
  verificar("una vacuna del 28 de febrero → 201, ese día", r.estado === 201 && String(r.cuerpo?.vacuna?.fecha).startsWith("2026-02-28"));
  r = await P("POST", `/medico/pacientes/${pac._id}/vacunas`, { nombre: "Antitetánica" });
  verificar("una vacuna sin fecha → 400 «nombre y fecha son requeridos», como antes", r.estado === 400 && /requeridos/.test(r.cuerpo?.error || ""));

  r = await P("POST", `/medico/pacientes/${pac._id}/recetas`, { medicamentos: [{ nombre: "Paracetamol" }], consultaId: "nope" });
  verificar(`una receta con consultaId «nope» → 400 que nombra el campo (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && /consultaId/.test(r.cuerpo?.error || ""));
  r = await P("POST", `/medico/pacientes/${pac._id}/recetas`, { medicamentos: [{ nombre: "Paracetamol" }], fecha: "2026-02-30" });
  verificar(`una receta del 30 de febrero → 400, como ya respondía (${r.estado})`, r.estado === 400 && r.cuerpo?.error === "fecha no es válida");
  verificar("  ...y no se guardó ninguna receta", (await cuantas(M.Receta)) === 0);
  r = await P("POST", `/medico/pacientes/${pac._id}/recetas`, { medicamentos: [{ nombre: "Paracetamol" }], fecha: "2026-09-16" });
  verificar("una receta del 16 de septiembre → 201, con su día civil", r.estado === 201 && r.cuerpo?.receta?.fechaCivil === "2026-09-16");

  const emb = await M.Embarazo.create({ pacienteId: pac._id, medicoPhone: MEDICOS[0], fum: new Date("2026-01-10"), fpp: new Date("2026-10-17") });
  for (const fechaFin of ["nope", "2026-02-30"]) {
    r = await P("POST", `/medico/embarazo/${emb._id}/finalizar`, { desenlace: "parto_vaginal", fechaFin });
    verificar(`finalizar un embarazo con fecha «${fechaFin}» → 400 (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && /fecha de finalización/.test(r.cuerpo?.error || ""));
  }
  verificar("  ...y el embarazo sigue activo", (await M.Embarazo.findById(emb._id).lean()).activo === true);
  r = await P("POST", `/medico/embarazo/${emb._id}/finalizar`, { desenlace: "parto_vaginal", fechaFin: "2026-09-30" });
  verificar("con una fecha que existe → 200, finalizado ese día", r.estado === 200 && r.cuerpo?.embarazo?.activo === false
    && String(r.cuerpo?.embarazo?.fechaFin).startsWith("2026-09-30"));

  console.log("\n── 4. Fechas de un <input type=\"datetime-local\"> (citas) ──");
  P = como(MEDICOS[1]);
  r = await P("POST", "/medico/citas", { pacienteNombre: "Ana", fecha: "2026-02-31T10:00" });
  verificar(`crear una cita el 31 de febrero → 400 (${r.estado})`, r.estado === 400);
  r = await P("POST", "/medico/citas", { pacienteNombre: "Ana", fecha: "2026-09-16T14:30" });
  verificar("crear una a las 14:30 de Bolivia → 201, 18:30 UTC", r.estado === 201 && r.cuerpo?.cita?.fecha === "2026-09-16T18:30:00.000Z");
  const citaId = r.cuerpo?.cita?._id;
  for (const fecha of ["mañana", "2026-13-45T25:99", "2026-02-30T10:00"]) {
    r = await P("PATCH", `/medico/citas/${citaId}`, { fecha });
    verificar(`moverla a «${fecha}» → 400 (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400);
  }
  verificar("  ...y sigue el 16 a las 14:30 (antes «2026-13-45T25:99» la guardaba en 2027)",
    (await M.Cita.findById(citaId).lean()).fecha.toISOString() === "2026-09-16T18:30:00.000Z");
  r = await P("PATCH", `/medico/citas/${citaId}`, { fecha: "2026-09-17T09:00" });
  verificar("moverla a una hora que existe → 200", r.estado === 200 && r.cuerpo?.cita?.fecha === "2026-09-17T13:00:00.000Z");
  r = await P("GET", "/medico/citas?desde=zzz");
  verificar(`listar citas desde «zzz» → 400, no 500 (${r.estado})`, r.estado === 400);

  console.log("\n── 5. Lo que andaba sigue andando (medicamentos) ──");
  P = como(MEDICOS[2]);
  const pac2 = pacientes[MEDICOS[2]];
  r = await P("POST", `/medico/pacientes/${pac2._id}/medicamentos`, { nombre: "Enalapril", fechaInicio: "ayer" });
  verificar(`un medicamento con fechaInicio «ayer» → 400 que nombra el campo (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && /fechaInicio/.test(r.cuerpo?.error || ""));
  r = await P("POST", `/medico/pacientes/${pac2._id}/medicamentos`, { nombre: "Enalapril" });
  const medId = r.cuerpo?.medicamento?._id;
  verificar("uno sin fechas → 201", r.estado === 201 && medId);
  r = await P("PATCH", `/medico/medicamentos/${medId}`, { fechaFin: "ayer" });
  verificar(`ponerle fechaFin «ayer» → 400 (${r.estado})`, r.estado === 400);
  // Es lo que manda «Dar de baja» en la pantalla (public/js/pacientes.js).
  r = await P("PATCH", `/medico/medicamentos/${medId}`, { fechaFin: "2026-09-16T21:15:00.000Z" });
  verificar("darlo de baja con la hora completa, como la pantalla → 200", r.estado === 200 && r.cuerpo?.medicamento?.fechaFin === "2026-09-16T21:15:00.000Z");

  // La auditoría se escribe sin esperar a la respuesta: se le da un momento.
  await new Promise(ok => setTimeout(ok, 200));
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
