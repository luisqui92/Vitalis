// Vitalis — Ponerle moneda a las cuentas y a los movimientos que ya existen.
//
// Hasta ahora el saldo era un número sin unidad: funcionaba porque todos
// cobraban en bolivianos. Con el primer médico en Brasil dejó de alcanzar —
// el panel llegó a sumar bolivianos con reales y a mostrar el total como
// "Bs", que es una cifra falsa que nadie mira con sospecha.
//
// Este script le pone la unidad a lo que ya está guardado.
//
// ═══ DE DÓNDE SALE LA MONEDA DE UNA CUENTA VIEJA ═══════════════════════════
//
// Del idioma, que es el único dato de país que hay. NO es la regla de aquí en
// adelante: de ahora en más la moneda es un campo propio y cambiar el idioma
// no la toca (ver services/monedas.js). Esto es solo para adivinar el pasado
// con lo único que dejó escrito.
//
// ═══ Y LA DE UN MOVIMIENTO ═════════════════════════════════════════════════
//
// De la cuenta a la que pertenece. Es una aproximación honesta: si alguien
// cambió de país en el medio, sus movimientos viejos quedan etiquetados con
// la moneda de hoy. No hay forma de saberlo mejor —el dato no se guardó— y
// es preferible a dejarlos sin unidad, que es lo que hace que no se puedan
// sumar nunca.
//
// Uso:
//   node scripts/migrar_monedas.js            ← muestra el plan, no toca nada
//   node scripts/migrar_monedas.js --hacelo   ← lo hace
//
// Se puede correr de nuevo: solo toca lo que todavía no tiene moneda.
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, MovimientoSaldo } = require("../db/models");
const monedas = require("../services/monedas");

async function main() {
  const hacelo = process.argv.includes("--hacelo");
  await mongoose.connect(CONFIG.MONGODB_URI);

  // "Sin moneda" es el campo ausente. Una cuenta que ya dice BOB no se toca:
  // puede haberla puesto una persona a propósito.
  const sinMoneda = { $or: [{ moneda: { $exists: false } }, { moneda: null }] };

  const cuentas = await Medico.find(sinMoneda).select("phone nombre idioma").lean();
  const porMoneda = { BOB: [], BRL: [] };
  for (const c of cuentas) porMoneda[monedas.monedaSegunIdioma(c.idioma)].push(c);

  const movsSinMoneda = await MovimientoSaldo.countDocuments(sinMoneda);

  console.log(`\n📋 Cuentas sin moneda: ${cuentas.length}`);
  for (const [cod, lista] of Object.entries(porMoneda)) {
    if (!lista.length) continue;
    console.log(`   ${lista.length} → ${cod} (${monedas.config(cod).simbolo})`);
    for (const c of lista.slice(0, 10)) console.log(`      +${c.phone}  ${c.nombre}`);
    if (lista.length > 10) console.log(`      … y ${lista.length - 10} más`);
  }
  console.log(`\n📋 Movimientos sin moneda: ${movsSinMoneda}`);

  if (!hacelo) {
    console.log("\nEsto fue el plan. NO se tocó nada.");
    console.log("Para hacerlo:  node scripts/migrar_monedas.js --hacelo\n");
    await mongoose.disconnect();
    return;
  }

  for (const [cod, lista] of Object.entries(porMoneda)) {
    if (!lista.length) continue;
    const r = await Medico.updateMany(
      { phone: { $in: lista.map(c => c.phone) } }, { $set: { moneda: cod } });
    console.log(`✅ ${r.modifiedCount} cuenta(s) → ${cod}`);
  }

  // Los movimientos, por la moneda de su cuenta. De a una moneda por vez,
  // para no tener que traer todos los movimientos a memoria.
  let movidos = 0;
  for (const cod of monedas.CODIGOS) {
    const telefonos = (await Medico.find({ moneda: cod }).select("phone").lean()).map(m => m.phone);
    if (!telefonos.length) continue;
    const r = await MovimientoSaldo.updateMany(
      { medicoPhone: { $in: telefonos }, ...sinMoneda }, { $set: { moneda: cod } });
    movidos += r.modifiedCount || 0;
    if (r.modifiedCount) console.log(`✅ ${r.modifiedCount} movimiento(s) → ${cod}`);
  }

  // Lo que quedó sin dueño: movimientos de cuentas borradas. Se les pone la
  // moneda por defecto y se avisa, en vez de dejarlos afuera de todas las
  // sumas para siempre sin que nadie se entere.
  const huerfanos = await MovimientoSaldo.updateMany(sinMoneda, { $set: { moneda: monedas.POR_DEFECTO } });
  if (huerfanos.modifiedCount) {
    console.log(`⚠️  ${huerfanos.modifiedCount} movimiento(s) de cuentas que ya no existen → ${monedas.POR_DEFECTO} (revisalos si el número te sorprende)`);
  }

  console.log(`\n✅ Listo. ${movidos + (huerfanos.modifiedCount || 0)} movimiento(s) con moneda.\n`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
