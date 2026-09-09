// Symphomed — Que mudar un teléfono no deje historias clínicas huérfanas.
//
// El teléfono es la identidad del médico en ~30 colecciones. Si la mudanza
// mueve la cuenta pero se olvida una colección, el síntoma no es un error:
// es un paciente que desaparece de la lista y sigue existiendo en la base.
// Eso no se nota el día que pasa.
//
// Por eso acá no se prueba "el script corre". Se prueba que DESPUÉS de
// correr no quede NADA colgando del número viejo, preguntándole a los
// modelos cuáles son —igual que hace el script— para que una colección
// nueva quede cubierta sola en los dos lados.
//
// Se ejecuta el script de verdad, como proceso aparte, porque la mitad de lo
// que hay que probar son sus validaciones y sus códigos de salida.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.OPERADORES_SALDO = "62741818";

const path = require("path");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const SCRIPT = path.join(RAIZ, "scripts", "cambiar_telefono.js");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// spawn y no execFileSync: bloquear el event loop del padre deja sin drenar
// el stdout del hijo y termina en un abrazo mortal. Ya pasó una vez.
function correr(args, env) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...env }, cwd: RAIZ,
    });
    let salida = "";
    hijo.stdout.on("data", (c) => { salida += c; });
    hijo.stderr.on("data", (c) => { salida += c; });
    hijo.on("error", reject);
    hijo.on("close", (codigo) => resolve({ codigo, salida }));
  });
}

async function conseguirMongo() {
  if (process.env.MONGO_PRUEBAS) {
    const nombre = (process.env.MONGO_PRUEBAS.split("/").pop() || "").split("?")[0].toLowerCase();
    if (!/prueba|test/.test(nombre)) {
      console.error(`❌ MONGO_PRUEBAS apunta a "${nombre}", que no dice ser de prueba. No.`);
      process.exit(1);
    }
    return { uri: process.env.MONGO_PRUEBAS, detener: async () => {} };
  }
  let MongoMemoryServer;
  for (const c of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(c)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) return null;
  const s = await MongoMemoryServer.create();
  return { uri: s.getUri() + "vitalis_prueba", detener: () => s.stop() };
}

async function main() {
  const mongo = await conseguirMongo();
  if (!mongo) {
    console.log("⏭️  SALTEADA: no hay base de datos para probar.");
    console.log("   MONGO_PRUEBAS=... o npm i --no-save mongodb-memory-server");
    console.log("   Esto NO es un ✅: la mudanza de historias clínicas quedó sin probar.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const VIEJO = "62741818";
  const NUEVO = "60011122";
  const OTRO = "79999999";
  const hash = await hashPassword("Prueba123.");

  // La cuenta a mudar, con datos colgando de todo tipo: fichas, consultas,
  // dinero, auditoría, y un campo de "quién lo hizo".
  await M.Medico.create({ phone: VIEJO, nombre: "Luis Quiroga", passwordHash: hash });
  await M.Medico.create({ phone: OTRO, nombre: "Dra. Vecina", passwordHash: hash });

  const paciente = await M.Paciente.create({ medicoPhone: VIEJO, nombre: "Juan Perez" });
  await M.Paciente.create({ medicoPhone: VIEJO, nombre: "Ana Lopez" });
  // Una ficha de la vecina: la mudanza no la puede tocar ni por error.
  await M.Paciente.create({ medicoPhone: OTRO, nombre: "Paciente ajeno" });
  await M.ConsultaMedica.create({ medicoPhone: VIEJO, pacienteId: paciente._id, motivo: "control" });
  await M.AuditLog.create({ medicoPhone: VIEJO, accion: "login" });
  await M.MovimientoSaldo.create({
    medicoPhone: OTRO, tipo: "carga", montoCentavos: 20000,
    referencia: "QR 1", referenciaClave: "QR 1", acreditadoPor: VIEJO,
  });

  console.log("── 1. Sin --hacelo no toca nada ──");
  const plan = await correr([VIEJO, NUEVO]);
  verificar("el plan sale bien", plan.codigo === 0);
  verificar("  ...y dice cuántos registros va a mover", /registros en total/.test(plan.salida));
  verificar("  ...avisando que no tocó nada", /NO se tocó nada/.test(plan.salida));
  verificar("  ...y la cuenta sigue en el número viejo",
    await M.Medico.exists({ phone: VIEJO }) !== null);
  verificar("  ...con sus pacientes donde estaban",
    await M.Paciente.countDocuments({ medicoPhone: VIEJO }) === 2);

  console.log("\n── 2. No se muda encima de una cuenta que existe ──");
  const encima = await correr([VIEJO, OTRO, "--hacelo"]);
  verificar("se niega", encima.codigo === 1);
  verificar("  ...diciendo que mezclaría los pacientes de las dos", /mezclaría/.test(encima.salida));
  verificar("  ...sin haber movido nada", await M.Paciente.countDocuments({ medicoPhone: VIEJO }) === 2);

  const inexistente = await correr(["70000000", NUEVO, "--hacelo"]);
  verificar("y una cuenta que no existe tampoco se muda", inexistente.codigo === 1);

  console.log("\n── 3. La mudanza ──");
  const hecho = await correr([VIEJO, NUEVO, "--hacelo"]);
  verificar("corre bien", hecho.codigo === 0);
  verificar("  ...y la cuenta entra con el número nuevo",
    await M.Medico.exists({ phone: NUEVO }) !== null);
  verificar("  ...y el viejo queda libre", await M.Medico.exists({ phone: VIEJO }) === null);
  verificar("  ...los dos pacientes se mudaron con ella",
    await M.Paciente.countDocuments({ medicoPhone: NUEVO }) === 2);
  verificar("  ...la consulta también",
    await M.ConsultaMedica.countDocuments({ medicoPhone: NUEVO }) === 1);
  verificar("  ...y la auditoría, que si no atribuiría mal",
    await M.AuditLog.countDocuments({ medicoPhone: NUEVO, accion: "login" }) === 1);
  verificar("  ...incluido quién acreditó un pago ajeno",
    await M.MovimientoSaldo.countDocuments({ acreditadoPor: NUEVO }) === 1);
  verificar("  ...y queda anotado de dónde vino esta cuenta",
    await M.AuditLog.countDocuments({ medicoPhone: NUEVO, accion: "cambio_de_telefono" }) === 1);

  // Lo importante de verdad: que no haya quedado NADA atrás. Se le pregunta a
  // los modelos, no a una lista escrita a mano — si mañana alguien agrega una
  // colección y se olvida del script, esta prueba lo agarra.
  console.log("\n── 4. Que no quede NADA colgando del número viejo ──");
  const CAMPOS = ["medicoPhone", "acreditadoPor", "revisadaPor", "actualizadoPor", "alergiasActualizadasPor"];
  const huerfanos = [];
  for (const [nombre, Modelo] of Object.entries(mongoose.models)) {
    for (const campo of CAMPOS) {
      if (!Modelo.schema.paths[campo]) continue;
      const n = await Modelo.countDocuments({ [campo]: VIEJO });
      if (n) huerfanos.push(`${nombre}.${campo}=${n}`);
    }
  }
  verificar(`no quedó ningún registro en +${VIEJO}${huerfanos.length ? " — " + huerfanos.join(", ") : ""}`,
    huerfanos.length === 0);
  verificar("y a la vecina no se le movió un solo dato",
    await M.Paciente.countDocuments({ medicoPhone: OTRO }) === 1);

  console.log("\n── 5. Avisa lo que NO puede mover solo ──");
  verificar("recuerda que OPERADORES_SALDO vive en el .env",
    /OPERADORES_SALDO/.test(hecho.salida));
  verificar("  ...y que el WhatsApp del número viejo no lo sigue",
    /WhatsApp/.test(hecho.salida));

  console.log("\n── 6. Correrlo de nuevo no rompe nada ──");
  // La red de seguridad de una corrida que se corta a la mitad.
  const otraVez = await correr([NUEVO, "60033344", "--hacelo"]);
  verificar("mudarlo otra vez funciona igual", otraVez.codigo === 0);
  verificar("  ...arrastrando de nuevo todo",
    await M.Paciente.countDocuments({ medicoPhone: "60033344" }) === 2);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongo.detener();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 la prueba se cayó:", e.stack || e.message);
  process.exit(1);
});
