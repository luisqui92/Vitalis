// Symphomed — Filas vacías en las listas de la nota.
//
// Una fila vacía (null) en los medicamentos hacía caer la pantalla de la
// consulta (ver probar_consulta_formas.js). Acá: que no se guarden más —ni
// desde la nota de la IA ni desde otro camino— y que el script limpie las
// que quedaron, sin tocar nada más.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function correr(uri, args) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", "limpiar_notas.js"), ...args], { cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri } });
    let salida = ""; h.stdout.on("data", (d) => { salida += d; }); h.stderr.on("data", (d) => { salida += d; });
    h.on("exit", (codigo) => resolve({ codigo, salida }));
  });
}

(async () => {
  console.log("── 1. La nota que devuelve la IA ──");
  const { normalizarNota } = require(path.join(RAIZ, "services", "notaClinica"));
  const n = normalizarNota({
    motivoConsulta: "Dolor",
    medicamentosRecetados: [null, "Amoxicilina 500 mg cada 8 horas", { nombre: "Paracetamol", dosis: "500 mg" }, "", ["raro"]],
    vacunasMencionadas: ["BCG", null],
    antecedentesFamiliaresNuevos: [null, "diabetes en la madre"],
  }).nota;
  verificar("una fila vacía se descarta", !n.medicamentosRecetados.some(x => x == null));
  verificar("un medicamento escrito como texto suelto se convierte, sin perderse",
    n.medicamentosRecetados.length === 2 && n.medicamentosRecetados[0].nombre === "Amoxicilina 500 mg cada 8 horas" && n.medicamentosRecetados[1].dosis === "500 mg");
  const conTexto = normalizarNota({ motivoConsulta: "Fiebre", sintomas: "fiebre de 38,5 °C, tos; dolor\ncefalea", examenesSolicitados: "Hemograma,PCR" }).nota;
  verificar(`una lista que llega como texto se corta por coma, punto y coma o renglón, pero no por la coma decimal (${JSON.stringify(conTexto.sintomas)})`,
    JSON.stringify(conTexto.sintomas) === JSON.stringify(["fiebre de 38,5 °C", "tos", "dolor", "cefalea"])
    && JSON.stringify(conTexto.examenesSolicitados) === JSON.stringify(["Hemograma", "PCR"]));
  verificar("lo mismo en vacunas y antecedentes familiares",
    n.vacunasMencionadas.length === 1 && n.vacunasMencionadas[0].nombre === "BCG" && n.antecedentesFamiliaresNuevos[0].condicion === "diabetes en la madre");

  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Base SALTEADA. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "filas_vacias";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  await mongoose.connection.dropDatabase();
  const pac = await M.Paciente.create({ medicoPhone: "5511900043001", nombre: "P" });
  await M.Medico.create({ phone: "5511900043001", nombre: "Dr. Yerko de Prueba", passwordHash: "x" });

  console.log("\n── 2. Ningún camino guarda una fila vacía ──");
  const c = new M.ConsultaMedica({ medicoPhone: "5511900043001", pacienteId: pac._id, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: { motivoConsulta: "x", medicamentosRecetados: [{ nombre: "Amoxicilina" }] } });
  await c.save();
  c.notaClinica.medicamentosRecetados.push(null);
  c.set("notaClinica.vacunasMencionadas", [null, { nombre: "BCG" }]);
  await c.save();
  const guardada = await M.ConsultaMedica.findById(c._id).lean();
  verificar("al guardar se sacan las filas vacías, y lo demás queda igual",
    guardada.notaClinica.medicamentosRecetados.length === 1 && guardada.notaClinica.medicamentosRecetados[0].nombre === "Amoxicilina"
    && guardada.notaClinica.vacunasMencionadas.length === 1);

  console.log("\n── 3. Las que quedaron de antes: el script ──");
  // Como estaban en la base: escritas sin pasar por Mongoose.
  const col = mongoose.connection.collection("consultamedicas");
  const { insertedId } = await col.insertOne({ medicoPhone: "5511900043001", pacienteId: pac._id, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: { motivoConsulta: "Dor", medicamentosRecetados: [null, { nombre: "Dipirona", dosis: "1 g" }] }, createdAt: new Date() });
  let r = await correr(uri, []);
  verificar("sin --hacelo: dice quién tiene consultas con filas vacías, y no toca nada",
    /5511900043001/.test(r.salida) && /Dr\. Yerko de Prueba/.test(r.salida) && /1 consulta/.test(r.salida)
    && (await col.findOne({ _id: insertedId })).notaClinica.medicamentosRecetados.length === 2);
  r = await correr(uri, ["--hacelo"]);
  const limpia = await col.findOne({ _id: insertedId });
  verificar("con --hacelo: saca la fila vacía", r.codigo === 0 && limpia.notaClinica.medicamentosRecetados.length === 1);
  verificar("  ...y el medicamento de verdad queda intacto", limpia.notaClinica.medicamentosRecetados[0].nombre === "Dipirona" && limpia.notaClinica.medicamentosRecetados[0].dosis === "1 g");
  r = await correr(uri, []);
  verificar("corrido otra vez: no queda ninguna", /Ninguna consulta/.test(r.salida));

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
