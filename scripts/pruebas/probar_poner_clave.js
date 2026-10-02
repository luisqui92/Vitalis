// Symphomed — scripts/poner_clave.js: una clave conocida para cuentas de prueba.
//
// Se ejecuta el script de verdad (como lo corre alguien en el servidor),
// escribiéndole SI por teclado, contra una base de prueba. Se comprueba:
//   · que la clave nueva sirve para entrar y la vieja ya no;
//   · que sin escribir SI no se toca nada;
//   · que una cuenta con muchos pacientes (un médico de verdad) se respeta,
//     salvo --forzar, y que una inactiva no se toca;
//   · que un teléfono que no existe se dice y no se crea;
//   · que cada cambio queda en la auditoría y que --demos alcanza a las
//     cuentas de los seeds.
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
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", "poner_clave.js"), ...args], {
      cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri },
    });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    if (entrada !== null) h.stdin.write(entrada + "\n");
    h.stdin.end();
    h.on("exit", (codigo) => resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de datos. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "poner_clave_prueba";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, verificarPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const vieja = await hashPassword("ClaveAlAzarVieja1");
  const cuenta = (phone, nombre, extra = {}) => M.Medico.create({ phone, nombre, passwordHash: vieja, activo: true, ...extra });
  await cuenta("79000000", "Administración — Clínica Demo", { rol: "admin" });
  await cuenta("79000001", "Dra. Carolina Mendoza");
  await cuenta("123", "Lic. Fernanda Suárez");
  await cuenta("78811007", "Lic. Fernanda Zeballos");
  await cuenta("79000002", "Dr. Real Con Muchos", {});
  for (let i = 0; i < 40; i++) await M.Paciente.create({ medicoPhone: "79000002", nombre: `Paciente real ${i}` });
  await cuenta("79000003", "Dr. Inactivo", { activo: false });
  // verificarPassword devuelve { ok, requiereRehash }: hay que mirar .ok (el
  // objeto en sí es siempre «verdadero» y la prueba pasaría vacía).
  const entra = async (phone, clave) => (await verificarPassword(clave, (await M.Medico.findOne({ phone }).lean()).passwordHash)).ok === true;
  const NUEVA = "Symphomed1234";

  console.log("── 1. Sin escribir SI, no se toca nada ──");
  let r = await correr(uri, ["--clave", NUEVA, "79000001"], "no");
  verificar("responde «Cancelado»", /Cancelado/.test(r.salida));
  verificar("la clave vieja sigue sirviendo", await entra("79000001", "ClaveAlAzarVieja1"));
  verificar("la nueva no", !(await entra("79000001", NUEVA)));

  console.log("\n── 2. Con SI, cambia ──");
  r = await correr(uri, ["--clave", NUEVA, "79000001"], "SI");
  verificar("sale con éxito y muestra usuario y clave", r.codigo === 0 && /79000001\s+Symphomed1234/.test(r.salida));
  verificar("la clave nueva sirve para entrar", await entra("79000001", NUEVA));
  verificar("la vieja ya no", !(await entra("79000001", "ClaveAlAzarVieja1")));
  verificar("queda en la auditoría", (await M.AuditLog.countDocuments({ accion: "poner_clave_script", recurso: "Medico:79000001" })) === 1);
  verificar("no cambió la de otra cuenta", await entra("123", "ClaveAlAzarVieja1"));

  console.log("\n── 3. Los frenos ──");
  r = await correr(uri, ["--clave", NUEVA, "79000002", "79000003", "70000000"], "SI");
  verificar("más de 25 pacientes: se niega (parece un médico de verdad)", /tiene 40 pacientes/.test(r.salida) && await entra("79000002", "ClaveAlAzarVieja1"));
  verificar("inactiva: no se toca", /INACTIVA/.test(r.salida) && await entra("79000003", "ClaveAlAzarVieja1"));
  verificar("un teléfono que no existe se dice, y no se crea", /70000000\s+no existe/.test(r.salida) && !(await M.Medico.findOne({ phone: "70000000" })));
  verificar("si no queda ninguna cuenta, no pregunta ni cambia nada", /Ninguna cuenta para cambiar/.test(r.salida));
  r = await correr(uri, ["--clave", NUEVA, "--forzar", "79000002"], "SI");
  verificar("con --forzar sí lo hace", await entra("79000002", NUEVA));

  console.log("\n── 4. --demos ──");
  r = await correr(uri, ["--clave", NUEVA, "--demos"], "SI");
  verificar("alcanza al administrador de la clínica, el centro de neuro y el de fisio",
    await entra("79000000", NUEVA) && await entra("123", NUEVA) && await entra("78811007", NUEVA));
  verificar("dice cuáles no existen (no inventa cuentas)", /123-01\s+no existe/.test(r.salida) && !(await M.Medico.findOne({ phone: "123-01" })));

  console.log("\n── 5. La clave por defecto es la de todas las cuentas de prueba ──");
  await M.Medico.updateOne({ phone: "79000001" }, { $set: { passwordHash: vieja } });
  r = await correr(uri, ["79000001"], "SI");
  verificar("sin --clave se usa Symphomed1234 (la misma que en los seeds)", /«Symphomed1234»/.test(r.salida) && await entra("79000001", "Symphomed1234"));

  console.log("\n── 6. Mal usado ──");
  r = await correr(uri, ["--clave"], null);
  verificar("--clave sin valor: no cae en silencio en otra clave", r.codigo === 1 && /Uso:/.test(r.salida));
  r = await correr(uri, ["--clave", NUEVA], null);
  verificar("sin teléfonos: explica el uso y sale con error", r.codigo === 1 && /Uso:/.test(r.salida));

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
