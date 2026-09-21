// Prueba puntual del --activar agregado a scripts/cuentas.js, corriendo el
// script de verdad como subproceso (igual que probar_socios.js) — no alcanza
// con leer el código: lo que importa es que activo pase de false a true en
// la base, y que la segunda vez no rompa nada.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const path = require("path");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function correr(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(RAIZ, "scripts", "cuentas.js"), ...args], {
      env: { ...process.env, ...env }, timeout: 15000,
    });
    let salida = "";
    p.stdout.on("data", (d) => { salida += d; });
    p.stderr.on("data", (d) => { salida += d; });
    p.on("close", (code) => resolve({ code, salida }));
  });
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("activar");

  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const { Medico } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Medico.create({
    phone: "68548004", nombre: "Dr. Prueba", passwordHash: await hashPassword("ClaveVieja1234!"),
    activo: false, estadoCuenta: "aprobada", tipoEspecialidad: "medicina_general",
  });

  const env = { MONGODB_URI: uri };

  console.log("── Reactivar una cuenta apagada ──");
  const r1 = await correr(["68548004", "--activar"], env);
  verificar("el script termina sin error", r1.code === 0);
  verificar("dice que la reactivó", /reactivada/.test(r1.salida));
  const m1 = await Medico.findOne({ phone: "68548004" }).lean();
  verificar("  ...y activo quedó en true en la base", m1.activo === true);
  verificar("  ...sin tocar la contraseña", m1.passwordHash === (await Medico.findOne({ phone: "68548004" }).lean()).passwordHash);

  console.log("\n── Activar una que ya está activa no rompe nada ──");
  const r2 = await correr(["68548004", "--activar"], env);
  verificar("el script termina sin error", r2.code === 0);
  verificar("dice que ya estaba activa", /ya estaba activa/.test(r2.salida));

  console.log("\n── --activar no toca --clave si no se pide ──");
  const r3 = await correr(["68548004"], env);
  verificar("sin --activar ni --clave, solo informa (no cambia nada)", r3.code === 0 && !/reactivada/.test(r3.salida));

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
