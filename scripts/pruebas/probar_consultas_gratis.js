// Symphomed — Las consultas de cortesía: ni una de más, ni una de menos.
//
// Cada cuenta nueva tiene 4 consultas gratis. Es lo que permite que un médico
// sepa si esto le sirve antes de pagar — para la cuarta ya sabe si le ahorra
// tiempo, y recién ahí la decisión es honesta.
//
// Pero regalar es fácil de hacer mal en las dos direcciones:
//
//   · de más — dos consultas que terminan de transcribirse al mismo tiempo
//     consumen UNA sola gratis si se pregunta antes y se suma después. Ahí
//     se regalan consultas de a pares y no se entera nadie;
//   · de menos — si el cobro falla después de haber descontado la cortesía,
//     el médico pierde una gratis por un choque que no fue culpa suya.
//
// Por eso esta prueba corre contra una base real y no con objetos falsos: lo
// que se está comprobando es lo que hace Mongo, no lo que dice el código.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.CONSULTAS_GRATIS = "4";

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("vitalis_prueba");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);

  const { Medico, MovimientoSaldo } = require(path.join(RAIZ, "db", "models"));
  const saldos = require(path.join(RAIZ, "services", "saldo"));
  await mongoose.connection.dropDatabase();
  await MovimientoSaldo.syncIndexes();

  const nueva = async (phone, extra = {}) => Medico.create({
    phone, nombre: `Dr. ${phone}`, passwordHash: "x", activo: true, moneda: "BRL", ...extra,
  });
  const idFalso = () => new mongoose.Types.ObjectId();

  console.log("── 1. Las primeras cuatro no cobran ──");
  await nueva("5511000001");
  for (let i = 1; i <= 4; i++) {
    const r = await saldos.cobrarConsulta({ medicoPhone: "5511000001", consultaId: idFalso() });
    verificar(`consulta ${i}: de cortesía, saldo intacto`, r.deCortesia === true && r.saldoCentavos === 0);
  }

  console.log("\n── 2. La quinta sí ──");
  const quinta = await saldos.cobrarConsulta({ medicoPhone: "5511000001", consultaId: idFalso() });
  verificar("ya no es de cortesía", !quinta.deCortesia);
  verificar("  ...y descuenta R$ 10,00", quinta.saldoCentavos === -1000);

  console.log("\n── 3. Todas quedan en el libro mayor, también las gratis ──");
  // Aunque no descuenten. Es lo único que permite saber cuántas consultas
  // hace alguien que todavía no paga — y si las 4 alcanzan o sobran.
  const movs = await MovimientoSaldo.find({ medicoPhone: "5511000001", tipo: "consumo" }).lean();
  verificar("hay 5 movimientos, no 1", movs.length === 5);
  const cortesias = movs.filter(m => m.montoCentavos === 0);
  verificar("  ...4 en cero", cortesias.length === 4);
  verificar("  ...y se puede saber cuáles fueron gratis",
    cortesias.every(m => /cortes/i.test(m.concepto)));

  console.log("\n── 4. Dos consultas a la vez no consumen una sola ──");
  // El caso que regala consultas: preguntar "¿le quedan?" y sumar después
  // deja pasar las dos si ocurren al mismo tiempo. El $inc con la condición
  // adentro del filtro lo impide del lado de la base.
  await nueva("5511000002");
  await Medico.updateOne({ phone: "5511000002" }, { $set: { consultasGratisUsadas: 3 } });
  const [a, b] = await Promise.all([
    saldos.cobrarConsulta({ medicoPhone: "5511000002", consultaId: idFalso() }),
    saldos.cobrarConsulta({ medicoPhone: "5511000002", consultaId: idFalso() }),
  ]);
  const gratisDadas = [a, b].filter(r => r.deCortesia).length;
  verificar("con una sola disponible, solo una sale gratis", gratisDadas === 1);
  const m2 = await Medico.findOne({ phone: "5511000002" }).lean();
  verificar("  ...y el contador no pasa de 4", m2.consultasGratisUsadas === 4);

  console.log("\n── 5. Si el cobro falla, la cortesía se devuelve ──");
  // Cobrar dos veces la MISMA consulta: la segunda choca contra el índice
  // único. El médico no puede perder una gratis por eso.
  await nueva("5511000003");
  const mismaConsulta = idFalso();
  await saldos.cobrarConsulta({ medicoPhone: "5511000003", consultaId: mismaConsulta });
  const usadasAntes = (await Medico.findOne({ phone: "5511000003" }).lean()).consultasGratisUsadas;
  const repetida = await saldos.cobrarConsulta({ medicoPhone: "5511000003", consultaId: mismaConsulta });
  const usadasDespues = (await Medico.findOne({ phone: "5511000003" }).lean()).consultasGratisUsadas;
  verificar("el segundo intento no cobra", repetida.cobrado === false);
  verificar("  ...y no le quema una gratis", usadasDespues === usadasAntes);

  console.log("\n── 6. Con plan no se gastan las de cortesía ──");
  // Quedan guardadas por si algún día vuelve al prepago. Gastárselas
  // mientras paga R$ 400 al mes sería cobrarle dos veces lo mismo.
  const enUnMes = new Date(Date.now() + 30 * 86400000);
  await nueva("5511000004", { suscripcion: { plan: "mensual", hasta: enUnMes, desde: new Date() } });
  const conPlan = await saldos.cobrarConsulta({ medicoPhone: "5511000004", consultaId: idFalso() });
  verificar("no descuenta saldo", conPlan.saldoCentavos === 0 && conPlan.conPlan === true);
  const m4 = await Medico.findOne({ phone: "5511000004" }).lean();
  verificar("  ...y las 4 gratis siguen enteras", (m4.consultasGratisUsadas || 0) === 0);

  console.log("\n── 7. Lo que ve la pantalla ──");
  const nuevo = await saldos.estadoDe("5511000004");
  verificar("una cuenta con plan no muestra 'saldo bajo'", nuevo.bajo === false);

  await nueva("5511000005");
  const recien = await saldos.estadoDe("5511000005");
  verificar("una cuenta recién creada tampoco", recien.bajo === false);
  verificar("  ...y dice que está en cortesía", recien.gratis.enCortesia === true);
  verificar("  ...con las 4 disponibles", recien.gratis.restantes === 4);
  verificar("  ...sin apurarla todavía", recien.gratis.porAcabarse === false);

  await Medico.updateOne({ phone: "5511000005" }, { $set: { consultasGratisUsadas: 3 } });
  const porAcabarse = await saldos.estadoDe("5511000005");
  verificar("con una sola restante, sí avisa", porAcabarse.gratis.porAcabarse === true);

  await Medico.updateOne({ phone: "5511000005" }, { $set: { consultasGratisUsadas: 4 } });
  const agotadas = await saldos.estadoDe("5511000005");
  verificar("agotadas: ya no está en cortesía", agotadas.gratis.enCortesia === false);
  verificar("  ...y recién ahí aparece el aviso de saldo", agotadas.bajo === true);

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
