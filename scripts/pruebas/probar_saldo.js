// Symphomed — El saldo prepago, contra una base de datos de verdad.
//
// Esto mueve plata. Un error acá no es una pantalla fea: es cobrarle de más a
// un médico, o cobrarle dos veces la misma consulta, o dejarlo sin poder
// atender por un descuadre de centavos. Todo lo de abajo corre contra Mongo
// porque las garantías que importan —el índice único que impide el cobro
// doble, la atomicidad del $inc— no existen fuera de la base.
//
//   MONGO_PRUEBAS="mongodb://localhost:27017/vitalis_prueba" node scripts/pruebas/probar_saldo.js
//   (o: npm i --no-save mongodb-memory-server)
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.PRECIO_CONSULTA_CENTAVOS = "1200";
process.env.RECARGA_MINIMA_CENTAVOS = "10000";

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
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
    console.log("   Esto NO es un ✅: el saldo mueve plata y quedó sin probar.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  const { Medico, MovimientoSaldo, ConsultaMedica } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  const saldos = require(path.join(RAIZ, "services", "saldo"));
  await mongoose.connection.dropDatabase();
  // Los índices no se crean solos si la colección está vacía y nadie escribió
  // todavía — y el índice único ES la garantía que se prueba abajo.
  await MovimientoSaldo.init();

  const hash = await hashPassword("Prueba123.");
  // Las dos arrancan con las consultas de cortesía YA usadas. Esta prueba es
  // sobre el prepago —cargar, cobrar, no cobrar dos veces— y con las cuatro
  // gratis disponibles las primeras consultas no descontarían nada, que es lo
  // correcto pero es otro comportamiento y tiene su propia prueba
  // (probar_consultas_gratis.js).
  const gratisAgotadas = { consultasGratisUsadas: 99 };
  const ana = await Medico.create({ phone: "70000001", nombre: "Dra. Ana", passwordHash: hash, ...gratisAgotadas });
  await Medico.create({ phone: "70000002", nombre: "Dr. Beto", passwordHash: hash, ...gratisAgotadas });

  console.log("── 1. Una cuenta nueva arranca en cero ──");
  let e = await saldos.estadoDe(ana.phone);
  verificar("saldo cero", e.saldoCentavos === 0);
  verificar("cero consultas disponibles", e.consultasRestantes === 0);
  verificar("no está bloqueada todavía: tiene margen", !e.bloqueado);

  console.log("\n── 2. Cargar una transferencia ──");
  await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 20000, acreditadoPor: "luis", referencia: "QR BCP 4471" });
  e = await saldos.estadoDe(ana.phone);
  verificar("Bs 200 quedan como 20000 centavos", e.saldoCentavos === 20000);
  verificar("y se muestran como 200.00", e.saldoBs === "200.00");
  verificar("alcanzan para 16 consultas de Bs 12", e.consultasRestantes === 16);
  verificar("no avisa saldo bajo", !e.bajo);

  const carga = await MovimientoSaldo.findOne({ medicoPhone: ana.phone, tipo: "carga" }).lean();
  verificar("la carga guarda quién la acreditó", carga.acreditadoPor === "luis");
  verificar("  ...y contra qué comprobante", carga.referencia === "QR BCP 4471");
  let rechazada = false;
  try { await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 5000, referencia: "x", permitirMenorAlMinimo: true }); } catch { rechazada = true; }
  verificar("una carga sin quién la acredita se rechaza", rechazada);
  rechazada = false;
  try { await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: -5000, acreditadoPor: "luis" }); } catch { rechazada = true; }
  verificar("una carga negativa también", rechazada);

  console.log("\n── 3. Cobrar una consulta ──");
  const c1 = await ConsultaMedica.create({ medicoPhone: ana.phone, pacienteId: new mongoose.Types.ObjectId(), estado: "completado" });
  const r1 = await saldos.cobrarConsulta({ medicoPhone: ana.phone, consultaId: c1._id });
  verificar("se cobra", r1.cobrado === true);
  verificar("quedan Bs 188", (await saldos.estadoDe(ana.phone)).saldoCentavos === 18800);
  const mov = await MovimientoSaldo.findOne({ consultaId: c1._id }).lean();
  verificar("el consumo queda ligado a esa consulta", String(mov.consultaId) === String(c1._id));
  verificar("y anota cómo quedó el saldo después", mov.saldoDespuesCentavos === 18800);
  verificar("sin 'concepto', el texto de siempre no cambió", mov.concepto === "Consulta transcrita");

  // Symphomed Ganadería reusa cobrarConsulta para el dictado de campo
  // (routes/lotesGanado.js), con el _id de un NotaVozLote — el libro de
  // movimientos tiene que decir qué fue de verdad, no "Consulta transcrita"
  // para un lote de pollos. Cuenta aparte, para no correr la cuenta de Ana
  // que el resto de esta prueba sigue de a Bs exactos.
  const vetGanaderia = await Medico.create({ phone: "70000009", nombre: "Dra. Vet", passwordHash: hash, ...gratisAgotadas });
  await saldos.cargar({ medicoPhone: vetGanaderia.phone, montoCentavos: 20000, referencia: "QR vet", acreditadoPor: "luis" });
  const notaVozFalsa = new mongoose.Types.ObjectId();
  await saldos.cobrarConsulta({ medicoPhone: vetGanaderia.phone, consultaId: notaVozFalsa, concepto: "Dictado de campo transcrito" });
  const movGanaderia = await MovimientoSaldo.findOne({ consultaId: notaVozFalsa }).lean();
  verificar("con 'concepto', el libro de movimientos dice qué fue de verdad", movGanaderia.concepto === "Dictado de campo transcrito");
  verificar("  ...y cobra el mismo precio que una consulta humana", movGanaderia.montoCentavos === -1200);

  console.log("\n── 4. La misma consulta NO se cobra dos veces ──");
  // Es el error más caro del modelo: la transcripción reintenta y el médico
  // paga doble sin enterarse.
  const r2 = await saldos.cobrarConsulta({ medicoPhone: ana.phone, consultaId: c1._id });
  verificar("el segundo intento no cobra", r2.cobrado === false && r2.motivo === "ya_cobrada");
  verificar("el saldo no se movió", (await saldos.estadoDe(ana.phone)).saldoCentavos === 18800);

  // Y ahora en paralelo, que es como pasa de verdad: dos procesos terminando
  // la misma consulta al mismo tiempo. Acá el if no alcanza — lo que salva es
  // el índice único.
  const c2 = await ConsultaMedica.create({ medicoPhone: ana.phone, pacienteId: new mongoose.Types.ObjectId(), estado: "completado" });
  const enParalelo = await Promise.all(
    Array.from({ length: 8 }, () => saldos.cobrarConsulta({ medicoPhone: ana.phone, consultaId: c2._id }))
  );
  const cobrados = enParalelo.filter(r => r.cobrado).length;
  verificar(`8 intentos simultáneos cobraron ${cobrados} vez/veces`, cobrados === 1);
  verificar("y se descontó Bs 12 una sola vez", (await saldos.estadoDe(ana.phone)).saldoCentavos === 17600);
  verificar("hay un solo movimiento para esa consulta",
    await MovimientoSaldo.countDocuments({ consultaId: c2._id }) === 1);

  console.log("\n── 5. Consultas distintas sí se cobran cada una ──");
  const varias = [];
  for (let i = 0; i < 3; i++) {
    varias.push(await ConsultaMedica.create({ medicoPhone: ana.phone, pacienteId: new mongoose.Types.ObjectId(), estado: "completado" }));
  }
  await Promise.all(varias.map(c => saldos.cobrarConsulta({ medicoPhone: ana.phone, consultaId: c._id })));
  verificar("tres consultas descuentan Bs 36", (await saldos.estadoDe(ana.phone)).saldoCentavos === 14000);

  console.log("\n── 6. El saldo de uno no toca el del otro ──");
  verificar("Beto sigue en cero", (await saldos.estadoDe("70000002")).saldoCentavos === 0);
  verificar("y no tiene movimientos", await MovimientoSaldo.countDocuments({ medicoPhone: "70000002" }) === 0);

  console.log("\n── 7. Aviso de saldo bajo, antes de que se acabe ──");
  const beto = "70000002";
  await saldos.cargar({ medicoPhone: beto, montoCentavos: 6000, acreditadoPor: "luis", referencia: "EFECTIVO 2026-08-26 recibido por Luis", permitirMenorAlMinimo: true });
  e = await saldos.estadoDe(beto);
  verificar("con Bs 60 le quedan 5 consultas", e.consultasRestantes === 5);
  verificar("  ...y ya se le avisa", e.bajo === true);
  verificar("  ...pero puede seguir trabajando", !e.bloqueado);

  console.log("\n── 8. Nunca se corta una consulta empezada ──");
  // Se le agota el saldo y se le sigue cobrando: las consultas ya estaban
  // transcritas. El saldo entra en negativo a propósito.
  for (let i = 0; i < 7; i++) {
    const c = await ConsultaMedica.create({ medicoPhone: beto, pacienteId: new mongoose.Types.ObjectId(), estado: "completado" });
    const r = await saldos.cobrarConsulta({ medicoPhone: beto, consultaId: c._id });
    verificar(`  consulta ${i + 1} de 7 se cobra igual`, r.cobrado === true);
  }
  e = await saldos.estadoDe(beto);
  verificar("el saldo quedó en negativo", e.saldoCentavos === -2400 && e.enNegativo);
  verificar("y las consultas restantes se muestran como 0, no como negativas", e.consultasRestantes === 0);

  console.log("\n── 9. Pero el negativo tiene piso ──");
  verificar("el límite son 5 consultas de margen", saldos.LIMITE_NEGATIVO === -6000);
  verificar("con Bs -24 todavía puede grabar", !(await saldos.estadoDe(beto)).bloqueado);
  // Desde Bs -24, tres consultas más lo dejan justo en el piso de Bs -60.
  for (let i = 0; i < 3; i++) {
    const c = await ConsultaMedica.create({ medicoPhone: beto, pacienteId: new mongoose.Types.ObjectId(), estado: "completado" });
    await saldos.cobrarConsulta({ medicoPhone: beto, consultaId: c._id });
  }
  e = await saldos.estadoDe(beto);
  verificar(`con Bs ${e.saldoBs} ya está bloqueado`, e.bloqueado === true);

  console.log("\n── 10. Recargar lo saca del negativo ──");
  await saldos.cargar({ medicoPhone: beto, montoCentavos: 10000, acreditadoPor: "luis", referencia: "QR 992" });
  e = await saldos.estadoDe(beto);
  verificar("Bs -60 + Bs 100 = Bs 40", e.saldoCentavos === 4000);
  verificar("  ...la deuda se descontó sola de la recarga", !e.enNegativo);
  verificar("  ...y vuelve a poder trabajar", !e.bloqueado);
  verificar("le quedan 3 consultas", e.consultasRestantes === 3);

  console.log("\n── 11. Los ajustes a mano piden motivo ──");
  let sinMotivo = false;
  try { await saldos.ajustar({ medicoPhone: beto, montoCentavos: 5000, acreditadoPor: "luis" }); } catch { sinMotivo = true; }
  verificar("un ajuste sin motivo escrito se rechaza", sinMotivo);
  await saldos.ajustar({ medicoPhone: beto, montoCentavos: 1200, concepto: "Consulta 4471 no se transcribió, se devuelve", acreditadoPor: "luis" });
  verificar("con motivo sí se aplica", (await saldos.estadoDe(beto)).saldoCentavos === 5200);

  console.log("\n── 11b. La recarga mínima ──");
  let bajoMinimo = null;
  try {
    await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 5000, acreditadoPor: "luis", referencia: "QR chico 001" });
  } catch (err) { bajoMinimo = err; }
  verificar("una recarga de Bs 50 se frena", bajoMinimo?.codigo === "menor_al_minimo");
  verificar("  ...diciendo cuál es el mínimo", /Bs 100\.00/.test(bajoMinimo?.message || ""));
  verificar("  ...y no se acreditó nada", await MovimientoSaldo.countDocuments({ referenciaClave: "QR CHICO 001" }) === 0);

  // Pero el operador puede acreditarla igual, y ésa es la parte que importa:
  // si el médico ya transfirió, la plata está en el banco y no acreditarla es
  // quedársela.
  const antesExcepcion = (await saldos.estadoDe(ana.phone)).saldoCentavos;
  const excepcion = await saldos.cargar({
    medicoPhone: ana.phone, montoCentavos: 5000, acreditadoPor: "luis",
    referencia: "QR chico 001", permitirMenorAlMinimo: true,
  });
  verificar("con la excepción sí se acredita", (await saldos.estadoDe(ana.phone)).saldoCentavos === antesExcepcion + 5000);
  verificar("  ...y queda escrito que fue bajo el mínimo", /bajo el mínimo/.test(excepcion.concepto));

  verificar("una recarga de exactamente Bs 100 pasa sin excepción",
    Boolean(await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 10000, acreditadoPor: "luis", referencia: "QR justo 100" })));
  verificar("el estado le dice al médico cuál es el mínimo",
    (await saldos.estadoDe(ana.phone)).recargaMinimaCentavos === 10000);

  console.log("\n── 12b. La misma transferencia NO se acredita dos veces ──");
  // El caso más probable de todos: el médico manda el mismo comprobante otra
  // vez porque no le llegó la confirmación, y el operador —que ve dos
  // mensajes con días de diferencia— lo carga dos veces.
  const REF = "QR BCP 9988-1122";
  await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 10000, acreditadoPor: "luis", referencia: REF });
  const antesDelIntento = (await saldos.estadoDe(ana.phone)).saldoCentavos;
  let repetida = null;
  try {
    await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 10000, acreditadoPor: "luis", referencia: REF });
  } catch (err) { repetida = err; }
  verificar("la segunda carga con la misma referencia se rechaza", repetida?.codigo === "referencia_repetida");
  verificar("  ...y dice cuándo y a quién se acreditó la primera", /ya se acreditó/.test(repetida?.message || ""));
  verificar("  ...y no se movió el saldo", (await saldos.estadoDe(ana.phone)).saldoCentavos === antesDelIntento);

  // Ni escribiéndola distinto: mayúsculas y espacios de más no la disfrazan.
  repetida = null;
  try {
    await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 10000, acreditadoPor: "luis", referencia: "  qr bcp   9988-1122 " });
  } catch (err) { repetida = err; }
  verificar("tampoco escrita en minúsculas y con espacios de más", repetida?.codigo === "referencia_repetida");

  // Pero a OTRO médico tampoco: la misma transferencia no puede acreditarse
  // dos veces ni repartida entre dos cuentas.
  repetida = null;
  try {
    await saldos.cargar({ medicoPhone: beto, montoCentavos: 10000, acreditadoPor: "luis", referencia: REF });
  } catch (err) { repetida = err; }
  verificar("ni acreditándosela a otro médico", repetida?.codigo === "referencia_repetida");

  // Y una carga sin referencia no se acepta: sin ella el índice no ataja nada.
  let sinRef = false;
  try { await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 5000, acreditadoPor: "luis", referencia: "  ", permitirMenorAlMinimo: true }); } catch { sinRef = true; }
  verificar("una carga sin referencia se rechaza", sinRef);

  // Una transferencia distinta sí entra.
  await saldos.cargar({ medicoPhone: ana.phone, montoCentavos: 5000, acreditadoPor: "luis", referencia: "QR BCP 9988-1123", permitirMenorAlMinimo: true });
  verificar("otra referencia sí se acredita", (await saldos.estadoDe(ana.phone)).saldoCentavos === antesDelIntento + 5000);

  console.log("\n── 12. Los movimientos cuadran con el saldo ──");
  for (const phone of [ana.phone, beto]) {
    const r = await saldos.reconciliar(phone);
    verificar(`+${phone}: ${r.movimientos} movimientos suman Bs ${saldos.bolivianos(r.segunMovimientos)} y la cuenta dice lo mismo`, r.cuadra);
  }

  // Y que el descuadre se DETECTE, no que no exista nunca. Se rompe a mano
  // el saldo cacheado, como si algo lo hubiera escrito sin dejar movimiento.
  await Medico.updateOne({ phone: ana.phone }, { $inc: { saldoCentavos: 500 } });
  const roto = await saldos.reconciliar(ana.phone);
  verificar("un descuadre se detecta", !roto.cuadra && roto.diferencia === 500);
  const arreglado = await saldos.reconciliar(ana.phone, { corregir: true });
  verificar("  ...y con corregir se arregla desde los movimientos", arreglado.corregido);
  verificar("  ...y después cuadra", (await saldos.reconciliar(ana.phone)).cuadra);

  // ═══ 12c. CUANDO UN PAÍS TODAVÍA NO PUEDE PAGAR SOLO ════════════════════
  //
  // No es un caso raro ni transitorio: es el estado normal mientras el cobro
  // de un país se hace a mano —alguien genera un enlace de pago por médico y
  // se lo manda—. Y es justo el estado en el que el médico NECESITA poder
  // escribir.
  //
  // Acá la pantalla mostraba un cartel y nada más. El enlace de WhatsApp
  // vivía adentro del camino en que SÍ hay cuenta cargada, así que se lo
  // sacábamos exactamente cuando hacía falta. Un médico que no puede pagar y
  // tampoco sabe a quién preguntarle, no paga.
  console.log("\n── 12c. Sin cuenta cargada, el médico igual sabe a quién escribir ──");
  const fsSaldo = require("fs");
  const pathSaldo = require("path");
  const RAIZ_SALDO = pathSaldo.join(__dirname, "..", "..");
  const PANTALLA = fsSaldo.readFileSync(pathSaldo.join(RAIZ_SALDO, "public", "js", "recarga.js"), "utf8");
  // El bloque del caso "no configurado", medido desde el `if` que lo abre
  // hasta el `const filas` que arranca el camino normal. Se buscan por
  // prefijo y no por la línea entera: la condición del if y la del filas
  // cambian cuando se agrega un caso —pasó al sumar el enlace propio— y una
  // prueba que se rompe por eso no está probando lo que dice probar.
  const desde = PANTALLA.indexOf("if (!d.configurado");
  const hasta = PANTALLA.indexOf("const filas =");
  const sinCuenta = desde > 0 && hasta > desde ? PANTALLA.slice(desde, hasta) : "";
  verificar("el aviso de «acá no se puede pagar solo» ofrece el WhatsApp",
    sinCuenta.length > 0 && /d\.whatsapp/.test(sinCuenta) && /wa\.me\//.test(sinCuenta));
  // Sin esto el arreglo no sirve: el dato tiene que llegar al navegador
  // aunque no haya cuenta cargada.
  const SERVICIO = fsSaldo.readFileSync(pathSaldo.join(RAIZ_SALDO, "services", "datosPago.js"), "utf8");
  verificar("  ...y el servidor lo manda aunque no haya cuenta cargada",
    /qr, banco, cuenta, titular, documento, whatsapp, ciudad,/.test(SERVICIO) &&
    /configurado: Boolean\(qr \|\| \(banco && cuenta\)\)/.test(SERVICIO));
  // El texto tiene que decir qué hacer, no que algo está roto: mientras el
  // cobro sea manual, esto es cómo funciona, no una falla por arreglarse.
  for (const idioma of ["es", "pt"]) {
    const textos = fsSaldo.readFileSync(pathSaldo.join(RAIZ_SALDO, "public", "i18n", idioma, "recarga.js"), "utf8");
    verificar(`  ...y en ${idioma} dice qué hacer, con el botón para hacerlo`,
      /"recarga\.escribinos":/.test(textos) &&
      /"recarga\.sinDatosPago": "[^"]*(enlace de pago|link de pagamento)/.test(textos));
  }

  console.log("\n── 13. El historial es legible para el médico ──");
  const movs = await saldos.movimientosDe(beto, 50);
  verificar("están todos los movimientos", movs.length >= 12);
  verificar("vienen del más nuevo al más viejo", new Date(movs[0].createdAt) >= new Date(movs[movs.length - 1].createdAt));
  verificar("cada uno dice cómo quedó el saldo", movs.every(m => typeof m.saldoDespuesCentavos === "number"));
  verificar("y ninguno tiene concepto vacío", movs.every(m => m.concepto && m.concepto.length > 3));

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
