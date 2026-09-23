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

  // ═══ EL BUG REAL: una cuenta vieja con un dato que ya no entra en el
  // esquema de hoy ═══════════════════════════════════════════════════════
  //
  // Pasó en producción: una cuenta con estadoCuenta: "Aprobada" (con
  // mayúscula, de antes de que el enum existiera o se hiciera estricto).
  // medico.save() revalida el documento ENTERO, así que activarla tiraba
  // "Medico validation failed: estadoCuenta: `Aprobada` is not a valid
  // enum value" — un error que no tiene nada que ver con lo que se estaba
  // pidiendo. Se inserta con el driver crudo, no con Medico.create(), porque
  // justamente Mongoose no dejaría crear un documento así — es el mismo
  // camino por el que debió haber entrado el dato real, hace tiempo.
  console.log("\n── Una cuenta con un dato legado inválido igual se puede activar ──");
  await mongoose.connection.collection("medicos").insertOne({
    phone: "68548005", nombre: "Dra. Con Dato Viejo",
    passwordHash: await hashPassword("ClaveVieja1234!"),
    activo: false, estadoCuenta: "Aprobada", tipoEspecialidad: "medicina_general",
  });
  const r4 = await correr(["68548005", "--activar"], env);
  verificar("el script termina sin error, pese al dato inválido", r4.code === 0);
  verificar("dice que la reactivó", /reactivada/.test(r4.salida));
  const m4 = await mongoose.connection.collection("medicos").findOne({ phone: "68548005" });
  verificar("  ...y activo quedó en true en la base", m4.activo === true);
  verificar("  ...sin tocar (ni «corregir») el dato viejo que no pidieron tocar",
    m4.estadoCuenta === "Aprobada");

  // ═══ --moneda: el caso real que lo motivó — un médico brasileño que
  // quedó con la moneda por defecto (BOB) porque el registro nunca pregunta
  // de qué país es ══════════════════════════════════════════════════════
  console.log("\n── --moneda corrige en qué moneda cobra la cuenta ──");
  const { MovimientoSaldo } = require(path.join(RAIZ, "db", "models"));
  await Medico.create({
    phone: "11943701404", nombre: "Jose Salomon Perez Antelo",
    passwordHash: await hashPassword("ClaveVieja1234!"), activo: true, estadoCuenta: "aprobada",
    // Sin moneda explícita — así se registra cualquier médico hoy, sea de
    // donde sea (ver el default en db/models.js).
  });
  const r5 = await correr(["11943701404", "--moneda", "BRL"], env);
  verificar("el script termina sin error", r5.code === 0);
  verificar("dice que la cambió de BOB a BRL", /cambiada de BOB a BRL/.test(r5.salida));
  const m5 = await Medico.findOne({ phone: "11943701404" }).lean();
  verificar("  ...y moneda quedó en BRL en la base", m5.moneda === "BRL");

  console.log("\n── Pedir la misma moneda que ya tiene no rompe nada ──");
  const r6 = await correr(["11943701404", "--moneda", "BRL"], env);
  verificar("el script termina sin error", r6.code === 0);
  verificar("dice que ya estaba en esa moneda", /Ya estaba en BRL/.test(r6.salida));

  console.log("\n── Una moneda que no existe se rechaza ──");
  const r7 = await correr(["11943701404", "--moneda", "USD"], env);
  verificar("el script falla (exit != 0)", r7.code !== 0);
  verificar("  ...y no tocó nada", (await Medico.findOne({ phone: "11943701404" }).lean()).moneda === "BRL");

  console.log("\n── Si ya hay movimientos de saldo, avisa que no se convierten ──");
  await Medico.create({
    phone: "11943701405", nombre: "Con Movimientos Previos",
    passwordHash: await hashPassword("ClaveVieja1234!"), activo: true, estadoCuenta: "aprobada", moneda: "BOB",
  });
  await MovimientoSaldo.create({ medicoPhone: "11943701405", tipo: "carga", montoCentavos: 20000, saldoDespuesCentavos: 20000 });
  const r8 = await correr(["11943701405", "--moneda", "BRL"], env);
  verificar("igual la cambia", r8.code === 0 && /cambiada de BOB a BRL/.test(r8.salida));
  verificar("  ...pero avisa que los movimientos viejos no se convierten", /1 movimiento\(s\)/.test(r8.salida));

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
