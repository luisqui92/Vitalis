// Symphomed — scripts/poblar_demo.js: pacientes de ejemplo para cuentas que ya existen.
//
// Se ejecuta el script de verdad, escribiéndole SI por teclado, contra una base
// de prueba con cuentas de varias especialidades que NO tienen pacientes.
// Lo que importa:
//   · que cada cuenta reciba pacientes de SU especialidad, y que no se la
//     convierta (los seeds, corridos a mano, convierten la cuenta);
//   · que la contraseña no cambie;
//   · que una cuenta con muchos pacientes (un médico de verdad), una inactiva y
//     el administrador de una clínica no se toquen;
//   · que no duplique si se corre dos veces.
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

function correr(uri, args, entrada) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", "poblar_demo.js"), ...args], { cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri } });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    if (entrada !== null) h.stdin.write(entrada + "\n");
    h.stdin.end();
    const corte = setTimeout(() => h.kill(), 240000);
    h.on("exit", (codigo) => { clearTimeout(corte); resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }); });
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de datos. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "poblar_demo_prueba";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const hash = await hashPassword("ClaveQueNoSeToca1");
  const cuenta = (phone, nombre, extra = {}) => M.Medico.create({ phone, nombre, passwordHash: hash, activo: true, ...extra });
  await cuenta("70020001", "Dra. Medicina General", { tipoEspecialidad: "medicina_general" });
  await cuenta("70020002", "Dr. Odontólogo", { tipoEspecialidad: "odontologia" });
  await cuenta("70020003", "Dra. Veterinaria", { tipoEspecialidad: "veterinaria" });
  await cuenta("70020009", "Lic. Fisio", { tipoEspecialidad: "fisioterapia" });
  await cuenta("5511900020004", "Dra. Brasil", { tipoEspecialidad: "medicina_general", idioma: "pt", moneda: "BRL" });
  await cuenta("70020005", "Dr. Pediatra", { tipoEspecialidad: "pediatria" });
  await cuenta("70020006", "Administración Clínica", { rol: "admin" });
  await cuenta("70020007", "Dr. Real Con Muchos", { tipoEspecialidad: "medicina_general" });
  for (let i = 0; i < 40; i++) await M.Paciente.create({ medicoPhone: "70020007", nombre: `Paciente real ${i}` });
  await cuenta("70020008", "Dr. Inactivo", { tipoEspecialidad: "odontologia", activo: false });
  const n = (phone) => M.Paciente.countDocuments({ medicoPhone: phone });
  const antes = Object.fromEntries((await M.Medico.find({}).lean()).map(m => [m.phone, { esp: m.tipoEspecialidad, hash: m.passwordHash, idioma: m.idioma, moneda: m.moneda }]));
  const igual = async (phone) => { const m = await M.Medico.findOne({ phone }).lean(); return m.tipoEspecialidad === antes[phone].esp && m.passwordHash === antes[phone].hash && m.idioma === antes[phone].idioma && m.moneda === antes[phone].moneda; };

  console.log("── 1. Sin escribir SI, no se toca nada ──");
  let r = await correr(uri, ["70020001"], "no");
  verificar("responde «Cancelado» y la cuenta sigue vacía", /Cancelado/.test(r.salida) && (await n("70020001")) === 0);

  console.log("\n── 2. Cada cuenta recibe lo de SU especialidad ──");
  const TODAS = ["70020001", "70020002", "70020003", "70020009", "5511900020004", "70020005", "70020006", "70020007", "70020008", "70029999"];
  r = await correr(uri, TODAS, "SI");
  verificar("el plan muestra qué seed corre en cada cuenta",
    /70020001.*seed_medicina_general_demo/.test(r.salida) && /70020002.*seed_odontologo_demo/.test(r.salida)
    && /70020003.*seed_veterinaria_demo/.test(r.salida) && /70020009.*seed_fisioterapia_demo/.test(r.salida)
    && /5511900020004.*seed_brasil_demo/.test(r.salida));
  for (const [phone, nombre] of [["70020001", "medicina general"], ["70020002", "odontología"], ["70020003", "veterinaria"], ["70020009", "fisioterapia"], ["5511900020004", "Brasil"]]) {
    verificar(`${nombre}: quedó con pacientes de ejemplo (${await n(phone)})`, (await n(phone)) >= 3);
  }
  verificar("NINGUNA cuenta cambió de especialidad, de idioma, de moneda ni de contraseña",
    (await Promise.all(["70020001", "70020002", "70020003", "70020009", "5511900020004"].map(igual))).every(Boolean));
  verificar("fisioterapia avisa que además crea los colegas, y los crea", /además crea los colegas/.test(r.salida) && Boolean(await M.Medico.findOne({ phone: "70020009-01" })));
  verificar("Brasil avisa que carga los datos de cobro si no hay ninguno", /datos de cobro de Brasil/.test(r.salida));

  console.log("\n── 3. Lo que NO se toca ──");
  verificar("pediatría: dice que no hay ejemplos y no inventa", /no hay pacientes de ejemplo para «pediatria»/.test(r.salida) && (await n("70020005")) === 0);
  verificar("el administrador de la clínica: no ve fichas, no se toca", /administrador de una clínica/.test(r.salida) && (await n("70020006")) === 0);
  verificar("un médico con 40 pacientes: se niega, y sus pacientes quedan en 40", /ya tiene 40 pacientes/.test(r.salida) && (await n("70020007")) === 40);
  verificar("una cuenta inactiva: no se toca", /INACTIVA/.test(r.salida) && (await n("70020008")) === 0);
  verificar("un teléfono que no existe se dice y no se crea", /70029999\s+no existe/.test(r.salida) && !(await M.Medico.findOne({ phone: "70029999" })));

  console.log("\n── 4. No duplica ──");
  const antesDe = await n("70020002");
  r = await correr(uri, ["70020002"], "SI");
  verificar(`corrido otra vez: sigue con ${antesDe} pacientes`, r.codigo === 0 && (await n("70020002")) === antesDe);

  console.log("\n── 5. Mal usado ──");
  r = await correr(uri, [], null);
  verificar("sin teléfonos: explica el uso y sale con error", r.codigo === 1 && /Uso:/.test(r.salida));

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
