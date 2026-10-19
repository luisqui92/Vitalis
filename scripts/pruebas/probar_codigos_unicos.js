// Symphomed — Códigos de paciente sin repetidos.
//
// El código del paciente (P-0001) es lo que el técnico tipea en el equipo de
// imagen para que el estudio se archive solo. Se sacaba contando lo que ya
// había, y eso no reserva nada: dos altas a la vez salían con el mismo
// código, y la caja DICOM le daba el estudio a cualquiera de los dos
// (revisión integral del 11 de octubre de 2026, S06). Lo que se prueba:
//   1. Altas a la vez: códigos distintos (la función y la ruta).
//   2. El contador arranca donde terminan los códigos que ya hay.
//   3. El índice único por consultorio.
//   4. Informes a la vez: códigos distintos.
//   5. La caja DICOM no archiva sola con un código que es de dos pacientes,
//      ni lo manda a la ventana de captura abierta: con un código que no es
//      de un solo paciente, va a la bandeja.
//   6. El script de los repetidos de antes: mira sin tocar, y arregla.
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function pedir(puerto, metodo, ruta, { token, cuerpo, headers = {}, crudo } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    if (token) h.authorization = "Bearer " + token;
    let datos = null;
    if (crudo) { datos = crudo; h["content-length"] = crudo.length; }
    else if (cuerpo !== undefined) { datos = JSON.stringify(cuerpo); h["content-type"] = "application/json"; h["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: h }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}
function correrScript(uri, args, entrada) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", "codigos_repetidos.js"), ...args], { cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri } });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    if (entrada !== undefined) h.stdin.write(entrada + "\n");
    h.stdin.end();
    h.on("exit", (codigo) => resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}
const distintos = (lista) => new Set(lista).size === lista.length;

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "codigos_unicos";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { siguienteCodigo } = require(path.join(RAIZ, "services", "codigos"));
  const { hashToken } = require(path.join(RAIZ, "services", "equipoAuth"));
  await mongoose.connection.dropDatabase();
  await Promise.all([M.Paciente, M.Informe, M.Contador].map(x => x.syncIndexes()));

  const express = require("express");
  const app = express();
  app.use(express.json());
  for (const r of ["pacientes", "informes", "cajaDicom"]) require(path.join(RAIZ, "routes", r))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;
  const MED = "70066001", OTRO = "70066002";
  for (const phone of [MED, OTRO]) await M.Medico.create({ phone, nombre: `Dr. ${phone}`, passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);

  console.log("── 1. Altas a la vez: códigos distintos ──");
  const veinte = await Promise.all(Array.from({ length: 20 }, () => siguienteCodigo(M.Paciente, MED, "P")));
  verificar(`veinte pedidos a la vez → veinte códigos distintos (${veinte.slice(0, 3).join(", ")}…)`, distintos(veinte));
  verificar("  ...del P-0001 al P-0020, sin saltos", veinte.slice().sort().join() === Array.from({ length: 20 }, (_, i) => `P-${String(i + 1).padStart(4, "0")}`).join());
  const altas = await Promise.all(Array.from({ length: 12 }, (_, i) => pedir(puerto, "POST", "/medico/pacientes", { token: tk, cuerpo: { nombre: `Paciente ${i}` } })));
  const codigosRuta = altas.map(r => r.cuerpo?.paciente?.codigo);
  verificar(`doce altas a la vez por la ruta → 201 y doce códigos distintos`, altas.every(r => r.estado === 201) && distintos(codigosRuta));

  console.log("\n── 2. El contador arranca donde terminan los que ya hay ──");
  // Un consultorio con códigos de antes del contador: un hueco (P-0004 a
  // P-0006 se borraron) y uno de emergencia de seis cifras.
  for (const codigo of ["P-0001", "P-0002", "P-0003", "P-0007", "P-482913"]) await M.Paciente.create({ medicoPhone: OTRO, nombre: codigo, codigo });
  verificar("el primero después de P-0007 es P-0008 (ni repite ni salta a seis cifras)", await siguienteCodigo(M.Paciente, OTRO, "P") === "P-0008");
  await M.Paciente.create({ medicoPhone: OTRO, nombre: "puesto a mano", codigo: "P-0009" });
  verificar("uno que ya existe adelante del contador se saltea → P-0010", await siguienteCodigo(M.Paciente, OTRO, "P") === "P-0010");

  console.log("\n── 3. El índice único ──");
  let error = null;
  try { await M.Paciente.create({ medicoPhone: MED, nombre: "repetido", codigo: codigosRuta[0] }); } catch (e) { error = e; }
  verificar("el mismo código dos veces en un consultorio no entra (11000)", error?.code === 11000);
  error = null;
  try { await M.Paciente.create({ medicoPhone: "70066003", nombre: "otro consultorio", codigo: codigosRuta[0] }); } catch (e) { error = e; }
  verificar("  ...en otro consultorio, el mismo código sí", !error);
  error = null;
  try { await M.Paciente.create([{ medicoPhone: MED, nombre: "sin código 1" }, { medicoPhone: MED, nombre: "sin código 2" }]); } catch (e) { error = e; }
  verificar("  ...y los que no tienen código, los que sean", !error);

  console.log("\n── 4. Informes a la vez ──");
  const pac = await M.Paciente.create({ medicoPhone: MED, nombre: "Para informes" });
  const informes = await Promise.all(Array.from({ length: 6 }, () => pedir(puerto, "POST", `/medico/pacientes/${pac._id}/informes`, { token: tk, cuerpo: { titulo: "Rx" } })));
  verificar(`seis informes a la vez → 201 y seis códigos INF distintos`, informes.every(r => r.estado === 201) && distintos(informes.map(r => r.cuerpo?.informe?.codigo)));
  const pacConCodigo = await M.Paciente.findById(pac._id).lean();
  verificar(`  ...y el paciente quedó con UN código, que no es de nadie más (${pacConCodigo.codigo})`,
    /^P-\d{4}$/.test(pacConCodigo.codigo) && (await M.Paciente.countDocuments({ medicoPhone: MED, codigo: pacConCodigo.codigo })) === 1);

  console.log("\n── 5. La caja DICOM con un código de dos pacientes ──");
  // Repetidos de antes del índice: se saca el índice para poder cargarlos.
  await M.Paciente.collection.dropIndex("medicoPhone_1_codigo_1");
  const viejo = await M.Paciente.create({ medicoPhone: MED, nombre: "El primero", codigo: "P-0500", createdAt: new Date(Date.now() - 86400000) });
  const nuevo = await M.Paciente.create({ medicoPhone: MED, nombre: "El segundo", codigo: "P-0500" });
  await M.Paciente.create({ medicoPhone: MED, nombre: "Único", codigo: "P-0600" });
  await M.EquipoRayos.create({ medicoPhone: MED, tokenHash: hashToken("token-caja"), activo: true });
  const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5a40000000049454e44ae426082", "hex");
  let sop = 1;
  const subir = (codigoEnEquipo) => pedir(puerto, "POST", "/equipo/dicom/estudio", {
    crudo: PNG,
    headers: { "content-type": "image/png", "x-equipo-token": "token-caja",
      "x-dicom-meta": Buffer.from(JSON.stringify({ sopInstanceUID: `1.2.840.10008.${sop++}`, modalidad: "DX", pacienteId: codigoEnEquipo, filas: 1, columnas: 1 })).toString("base64") },
  });
  let rc = await subir("P-0500");
  verificar(`un código que es de dos pacientes → a la bandeja, no a uno cualquiera (${rc.estado}, ${rc.cuerpo?.destino})`, rc.estado === 201 && rc.cuerpo?.destino === "bandeja");
  rc = await subir("p-0600");
  verificar(`un código de un solo paciente → se archiva solo (${rc.cuerpo?.destino}, por ${rc.cuerpo?.via})`, rc.estado === 201 && rc.cuerpo?.destino === "paciente" && rc.cuerpo?.via === "codigo");

  // Con la ventana de captura abierta. Antes, un código que no era de uno
  // solo seguía de largo y la placa caía en el paciente de la ventana
  // (informe de QA del 16 de octubre de 2026, A10).
  const enVentana = await M.Paciente.create({ medicoPhone: MED, nombre: "El de la ventana" });
  await M.CapturaPendiente.create({ medicoPhone: MED, pacienteId: enVentana._id, pacienteNombre: enVentana.nombre, expiraEn: new Date(Date.now() + 10 * 60000) });
  const enLaVentana = async () => M.Estudio.countDocuments({ medicoPhone: MED, pacienteId: enVentana._id });
  rc = await subir("P-0500");
  verificar(`con la ventana abierta, el código de dos pacientes → igual a la bandeja (${rc.cuerpo?.destino})`, rc.estado === 201 && rc.cuerpo?.destino === "bandeja");
  rc = await subir("P-0999");
  verificar(`  ...y un código que no es de nadie (el técnico se equivocó) → a la bandeja (${rc.cuerpo?.destino})`, rc.estado === 201 && rc.cuerpo?.destino === "bandeja");
  rc = await subir("p0600");
  verificar(`  ...y uno mal escrito, sin el guion → a la bandeja (${rc.cuerpo?.destino})`, rc.estado === 201 && rc.cuerpo?.destino === "bandeja");
  verificar("  ...ninguna de las tres cayó en el paciente de la ventana", (await enLaVentana()) === 0);
  rc = await subir("P-0600");
  verificar(`un código de un solo paciente, con la ventana abierta → a ese paciente (${rc.cuerpo?.via})`, rc.estado === 201 && rc.cuerpo?.via === "codigo" && (await enLaVentana()) === 0);
  rc = await subir("ECO-4471");
  verificar(`lo que el equipo pone solo en el Patient ID no apaga la ventana → al de la ventana (${rc.cuerpo?.via})`, rc.estado === 201 && rc.cuerpo?.via === "ventana" && (await enLaVentana()) === 1);
  rc = await subir("");
  verificar(`  ...y sin nada en el Patient ID, también (${rc.cuerpo?.via})`, rc.estado === 201 && rc.cuerpo?.via === "ventana" && (await enLaVentana()) === 2);

  console.log("\n── 6. El script de los repetidos de antes ──");
  let s = await correrScript(uri, []);
  verificar("sin --arreglar: los muestra, sin nombres", s.codigo === 0 && /1 código\(s\) repetido\(s\)/.test(s.salida) && s.salida.includes(String(nuevo._id)) && !/El primero|El segundo/.test(s.salida));
  verificar("  ...no tocó nada", (await M.Paciente.countDocuments({ medicoPhone: MED, codigo: "P-0500" })) === 2);
  verificar("  ...y avisa que falta el índice", /todavía no está/.test(s.salida));
  s = await correrScript(uri, ["--arreglar"], "no");
  verificar("--arreglar sin escribir SI → no cambia nada", (await M.Paciente.countDocuments({ medicoPhone: MED, codigo: "P-0500" })) === 2);
  s = await correrScript(uri, ["--arreglar"], "SI");
  const elViejo = await M.Paciente.findById(viejo._id).lean();
  const elNuevo = await M.Paciente.findById(nuevo._id).lean();
  verificar(`--arreglar: el más viejo se queda con P-0500, el otro pasa a ${elNuevo.codigo}`, s.codigo === 0 && elViejo.codigo === "P-0500" && /^P-\d{4}$/.test(elNuevo.codigo) && elNuevo.codigo !== "P-0500");
  verificar("  ...un código que no es de nadie más", (await M.Paciente.countDocuments({ medicoPhone: MED, codigo: elNuevo.codigo })) === 1);
  verificar("  ...queda anotado en la auditoría", Boolean(await M.AuditLog.exists({ accion: "recodificar_paciente_repetido", recurso: `Paciente:${nuevo._id}` })));
  const indices = await M.Paciente.collection.indexes();
  verificar("  ...y el índice único queda creado", indices.some(i => i.unique && i.key?.medicoPhone === 1 && i.key?.codigo === 1));
  s = await correrScript(uri, []);
  verificar("después: «No hay códigos de paciente repetidos», y sin el aviso rojo", /No hay códigos de paciente repetidos/.test(s.salida)
    && /índice de códigos únicos está creado/.test(s.salida) && !/\[CODIGOS\]/.test(s.salida));

  console.log("\n── 7. El aviso del índice, solo con repetidos de verdad ──");
  // En producción, el script dijo «No hay códigos repetidos» y abajo salió
  // el aviso rojo: cerró la conexión mientras Mongoose todavía armaba los
  // índices («Cannot use a session that has ended»), y el aviso tomaba
  // cualquier falla como repetidos.
  const { log } = require(path.join(RAIZ, "config"));
  const errorOriginal = log.error;
  const avisos = [];
  log.error = (...a) => { avisos.push(a.join(" ")); };
  const deCodigos = () => avisos.filter(a => /\[CODIGOS\]/.test(a)).length;
  M.Paciente.emit("index", Object.assign(new Error("Cannot use a session that has ended"), { name: "MongoExpiredSessionError" }));
  const trasCorte = deCodigos();
  M.Paciente.emit("index", Object.assign(new Error("Index build failed: E11000 duplicate key"), { code: 11000, codeName: "DuplicateKey" }));
  const trasRepetidos = deCodigos();
  log.error = errorOriginal;
  verificar("una conexión cerrada a mitad de armar los índices no avisa «repetidos»", trasCorte === 0);
  verificar("  ...un 11000, que son repetidos de verdad, sí", trasRepetidos === 1);

  // Las previas que guardó la caja, fuera.
  const { DIR_ESTUDIOS } = require(path.join(RAIZ, "services", "archivosEstudio"));
  for (const d of [...await M.Estudio.find({ medicoPhone: MED }).lean(), ...await M.EstudioEntrante.find({ medicoPhone: MED }).lean()]) {
    fs.rmSync(path.join(DIR_ESTUDIOS, d.archivoNombre), { force: true });
  }
  await new Promise((r) => setTimeout(r, 200));
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
