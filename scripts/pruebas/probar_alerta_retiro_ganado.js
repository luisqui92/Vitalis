// Symphomed Ganadería — alertas de retiro de medicamento, de punta a punta.
//
// Lo más frágil: un evento con DOS retiros (carne y leche) no tiene que
// avisar hasta que se vencen LOS DOS. Avisar con uno solo vencido sería
// peor que no avisar nada — le diría al dueño que ya puede vender la leche
// cuando en realidad todavía está en resguardo.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { notificarRetiroRegistrado } = require(path.join(RAIZ, "services", "alertaRetiroGanado"));

// ═══ 1. EL AVISO INMEDIATO: qué texto arma según lo que tenga el evento ════
console.log("── 1. notificarRetiroRegistrado() ──");
(async () => {
  const loteFalso = { codigo: "L-0003", nombre: "Galpón 3" };
  const medicoEs = { phone: "70000001", idioma: "es", moneda: "BOB" };
  const medicoBr = { phone: "70000002", idioma: "pt", moneda: "BRL" };

  const eventoSinRetiro = { producto: "Vitaminas", fecha: new Date() };
  const r1 = await notificarRetiroRegistrado(eventoSinRetiro, loteFalso, medicoEs);
  verificar("sin período de retiro, no manda nada (devuelve null)", r1 === null);

  console.log(fallos === 0 ? "" : ""); // separador silencioso

  // ═══ 2. EL TRABAJO EN SEGUNDO PLANO, DE PUNTA A PUNTA ═══════════════════
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("alertaretiroganado");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, LoteGanado, EventoLote } = require(path.join(RAIZ, "db", "models"));
  const { procesarRetirosLiberados } = require(path.join(RAIZ, "services", "alertaRetiroGanado"));
  await mongoose.connection.dropDatabase();

  const medico = await Medico.create({ phone: "70000001", nombre: "Dr. Ganadería", passwordHash: "x", idioma: "es" });
  const lote = await LoteGanado.create({
    medicoPhone: "70000001", especie: "avicola", nombre: "Galpón 3", codigo: "L-0003",
    cantidadInicial: 1000, cantidadActual: 950, fechaIngreso: new Date("2026-01-01"),
  });

  const hace20dias = new Date(Date.now() - 20 * 86400000);
  const hace10dias = new Date(Date.now() - 10 * 86400000);
  const hace2dias = new Date(Date.now() - 2 * 86400000);

  // A: solo retiro de carne, ya vencido (20 días atrás, 10 de retiro) — TIENE que avisar.
  const evA = await EventoLote.create({
    medicoPhone: "70000001", loteId: lote._id, tipo: "tratamiento", fecha: hace20dias,
    producto: "Enrofloxacina", diasRetiroCarne: 10,
  });
  // B: solo retiro de carne, todavía vigente (2 días atrás, 10 de retiro) — NO tiene que avisar.
  const evB = await EventoLote.create({
    medicoPhone: "70000001", loteId: lote._id, tipo: "tratamiento", fecha: hace2dias,
    producto: "Amoxicilina", diasRetiroCarne: 10,
  });
  // C: los DOS retiros, pero solo el de carne venció (5 días) — el de leche
  // (20 días) sigue en resguardo. NO tiene que avisar todavía: avisar acá
  // diría "ya podés vender la leche" cuando no es cierto.
  const evC = await EventoLote.create({
    medicoPhone: "70000001", loteId: lote._id, tipo: "tratamiento", fecha: hace10dias,
    producto: "Antibiótico Mixto", diasRetiroCarne: 5, diasRetiroLeche: 20,
  });
  // D: los DOS retiros, y los DOS ya vencieron (5 días cada uno, evento de
  // hace 10) — TIENE que avisar, con las dos acciones en el mismo mensaje.
  const evD = await EventoLote.create({
    medicoPhone: "70000001", loteId: lote._id, tipo: "tratamiento", fecha: hace10dias,
    producto: "Antibiótico Mixto Vencido", diasRetiroCarne: 5, diasRetiroLeche: 5,
  });
  // E: vencido, pero YA se avisó antes — no tiene que volver a contarse.
  const evE = await EventoLote.create({
    medicoPhone: "70000001", loteId: lote._id, tipo: "tratamiento", fecha: hace20dias,
    producto: "Ya Avisado", diasRetiroCarne: 5, avisoLiberacionEnviado: true,
  });
  // F: un pesaje, sin ningún retiro — no tiene que aparecer ni tocarse nunca.
  const evF = await EventoLote.create({
    medicoPhone: "70000001", loteId: lote._id, tipo: "pesaje", fecha: hace2dias,
    tamanoMuestra: 20, pesoPromedioKg: 1.5,
  });

  console.log("\n── 2. procesarRetirosLiberados() ──");
  const resultado = await procesarRetirosLiberados();
  verificar("reporta 2 enviados (solo A y D estaban de verdad vencidos del todo)", resultado.enviados === 2);
  verificar("  ...y 0 fallidos", resultado.fallidos === 0);

  const A = await EventoLote.findById(evA._id).lean();
  verificar("A: retiro de carne vencido → se marcó avisado", A.avisoLiberacionEnviado === true);

  const B = await EventoLote.findById(evB._id).lean();
  verificar("B: retiro de carne todavía vigente → NO se tocó", B.avisoLiberacionEnviado === false);

  const C = await EventoLote.findById(evC._id).lean();
  verificar("C: carne vencida pero leche NO → todavía no se avisa (falta la leche)",
    C.avisoLiberacionEnviado === false);

  const D = await EventoLote.findById(evD._id).lean();
  verificar("D: los dos retiros vencidos → se marcó avisado", D.avisoLiberacionEnviado === true);

  const E = await EventoLote.findById(evE._id).lean();
  verificar("E: ya estaba avisado → sigue avisado, no se re-procesó", E.avisoLiberacionEnviado === true);

  const F = await EventoLote.findById(evF._id).lean();
  verificar("F: un pesaje sin retiro → el campo ni se le agregó como true por error",
    F.avisoLiberacionEnviado === false);

  console.log("\n── 3. Correr de nuevo enseguida no vuelve a avisar lo ya avisado ──");
  const resultado2 = await procesarRetirosLiberados();
  verificar("segunda pasada inmediata: 0 enviados (A y D ya estaban marcados)", resultado2.enviados === 0);

  console.log("\n── 4. Si el retiro vence y el lote ya no existe, no se rompe ni reintenta para siempre ──");
  const loteFantasma = await LoteGanado.create({
    medicoPhone: "70000001", especie: "bovino", nombre: "Lote a borrar", codigo: "L-9999",
    cantidadInicial: 5, cantidadActual: 5, fechaIngreso: new Date("2026-01-01"),
  });
  const evFantasma = await EventoLote.create({
    medicoPhone: "70000001", loteId: loteFantasma._id, tipo: "tratamiento", fecha: hace20dias,
    producto: "X", diasRetiroCarne: 5,
  });
  await LoteGanado.deleteOne({ _id: loteFantasma._id });
  const resultado3 = await procesarRetirosLiberados();
  verificar("un lote borrado no cuenta como enviado ni como fallido", resultado3.enviados === 0 && resultado3.fallidos === 0);
  const fantasma = await EventoLote.findById(evFantasma._id).lean();
  verificar("  ...pero se marca igual, para no reintentarlo cada hora para siempre",
    fantasma.avisoLiberacionEnviado === true);

  await mongoose.disconnect();
  await mongod.stop();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
