// Symphomed — Acreditar una transferencia o un QR al saldo de un médico.
//
// Lo corre una persona que YA vio el comprobante. Por eso pide contra qué
// referencia se acredita: una carga sin comprobante es plata que apareció de
// la nada, y el día que los números no cierren no hay cómo reconstruirlo.
//
// Uso:
//   node scripts/cargar_saldo.js <telefono> <monto> "<referencia>"
//   node scripts/cargar_saldo.js 76660555 200 "QR BCP 4471-2290"
//
//   Con --igual acredita un monto menor al mínimo. Es a propósito: si el
//   médico transfirió menos igual, la plata YA está en la cuenta del banco y
//   negarse a acreditarla es quedársela.
//
//   node scripts/cargar_saldo.js <telefono>              (ver saldo y últimos movimientos)
//   node scripts/cargar_saldo.js --revisar               (buscar descuadres en todas)
//
// El monto va en la MONEDA DE LA CUENTA, como figura en el comprobante:
// bolivianos para una cuenta de Bolivia, reales para una de Brasil. Adentro
// se guarda en centavos enteros — ver el comentario de MovimientoSaldo en
// db/models.js. Todo lo que se muestra lleva el símbolo de esa moneda: antes
// decía "Bs" siempre, y cargarle 100 a una cuenta en reales se leía como
// "Bs 100" aunque fueran R$ 100.
const readline = require("readline");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico } = require("../db/models");
const saldos = require("../services/saldo");
const monedas = require("../services/monedas");

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (a) => { rl.close(); r(a.trim()); }));
}

function fecha(d) {
  return new Date(d).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function mostrar(phone) {
  const medico = await Medico.findOne({ phone }).select("nombre tipoEspecialidad moneda").lean();
  if (!medico) {
    console.error(`❌ No hay ninguna cuenta con el teléfono ${phone}.`);
    return null;
  }
  const estado = await saldos.estadoDe(phone);
  const moneda = monedas.normalizar(medico.moneda);
  const plata = (c) => monedas.conSimbolo(c, moneda);
  console.log(`\n+${phone}  ${medico.nombre}  (${medico.tipoEspecialidad})  ·  cuenta en ${moneda}`);
  console.log(`Saldo: ${plata(estado.saldoCentavos)}  ·  alcanza para ${estado.consultasRestantes} consulta(s)`);
  if (estado.enNegativo) console.log("⚠️  En negativo: consultas que se completaron con el saldo agotado.");
  else if (estado.bajo) console.log("⚠️  Saldo bajo.");

  const movs = await saldos.movimientosDe(phone, 12);
  if (movs.length) {
    console.log("\nÚltimos movimientos:");
    for (const m of movs) {
      const signo = m.montoCentavos >= 0 ? "+" : "−";
      const monto = `${signo}${monedas.conSimbolo(Math.abs(m.montoCentavos), m.moneda || moneda)}`.padStart(13);
      console.log(`  ${fecha(m.createdAt)}  ${monto}  → ${plata(m.saldoDespuesCentavos).padStart(11)}   ${m.concepto}${m.referencia ? ` [${m.referencia}]` : ""}`);
    }
  } else {
    console.log("\n(sin movimientos todavía)");
  }
  return medico;
}

async function revisarTodas() {
  const medicos = await Medico.find({}).select("phone nombre moneda").lean();
  console.log(`\nRevisando ${medicos.length} cuenta(s)...\n`);
  let descuadradas = 0;
  for (const m of medicos) {
    const r = await saldos.reconciliar(m.phone);
    if (!r.cuadra) {
      descuadradas++;
      console.log(`❌ +${m.phone} ${m.nombre}`);
      const plata = (c) => monedas.conSimbolo(c, monedas.normalizar(m.moneda));
      console.log(`   en la cuenta: ${plata(r.enLaCuenta)} · según movimientos: ${plata(r.segunMovimientos)} · difiere ${plata(r.diferencia)}`);
    }
  }
  if (descuadradas === 0) {
    console.log("✅ Todas las cuentas cuadran con sus movimientos.");
  } else {
    console.log(`\n💥 ${descuadradas} cuenta(s) descuadrada(s).`);
    console.log("   Un descuadre significa que algo movió el saldo sin dejar movimiento.");
    console.log("   Mirá QUÉ pasó antes de corregirlo — el número correcto es el de los");
    console.log("   movimientos, pero taparlo esconde el error que lo causó.");
  }
}

async function main() {
  await mongoose.connect(CONFIG.MONGODB_URI);

  if (process.argv.includes("--revisar")) {
    await revisarTodas();
    await mongoose.disconnect();
    return;
  }

  const phone = String(process.argv[2] || "").trim();
  if (!phone) {
    console.error('Uso: node scripts/cargar_saldo.js <telefono> <monto en la moneda de la cuenta> "<referencia>"');
    console.error("     node scripts/cargar_saldo.js <telefono>          (ver saldo)");
    console.error("     node scripts/cargar_saldo.js --revisar           (buscar descuadres)");
    await mongoose.disconnect();
    process.exit(1);
  }

  const medico = await mostrar(phone);
  if (!medico) { await mongoose.disconnect(); process.exit(1); }

  const bs = process.argv[3];
  if (bs === undefined) { await mongoose.disconnect(); return; }

  const monto = Number(bs);
  if (!Number.isFinite(monto) || monto <= 0) {
    console.error(`\n❌ "${bs}" no es un monto válido.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const referencia = String(process.argv[4] || "").trim();
  if (!referencia) {
    console.error("\n❌ Falta la referencia del comprobante (nro de transferencia, QR, lo que sea).");
    console.error('   Ej: node scripts/cargar_saldo.js ' + phone + ' ' + monto + ' "QR BCP 4471-2290"');
    await mongoose.disconnect();
    process.exit(1);
  }

  // Confirmación con el monto y el nombre juntos: el error caro acá es
  // cargarle 200 a la cuenta equivocada, y eso solo se ve leyendo el nombre.
  const moneda = monedas.normalizar(medico.moneda);
  const minimo = monedas.config(moneda).recargaMinima;
  console.log(`\n→ Acreditar ${monedas.conSimbolo(Math.round(monto * 100), moneda)} a ${medico.nombre} (+${phone})  ·  cuenta en ${moneda}`);
  console.log(`   Referencia: ${referencia}`);
  console.log("");
  console.log("   ⚠️  ¿Viste este pago en el BANCO, no solo en la captura que te mandaron?");
  console.log("      Una captura de pantalla se falsifica en dos minutos.");
  if (Math.round(monto * 100) < minimo && process.argv.includes("--igual")) {
    console.log("");
    console.log(`   ℹ️  Está bajo el mínimo de ${monedas.conSimbolo(minimo, moneda)} — va como excepción,`);
    console.log("      y así queda anotado en el movimiento.");
  }
  const ok = await preguntar('\nEscribí SI para confirmar: ');
  if (ok !== "SI") {
    console.log("Cancelado. No se movió nada.");
    await mongoose.disconnect();
    return;
  }

  const quien = process.env.USER || process.env.LOGNAME || "servidor";
  try {
    await saldos.cargar({
      medicoPhone: phone,
      montoCentavos: Math.round(monto * 100),
      acreditadoPor: quien,
      referencia,
      permitirMenorAlMinimo: process.argv.includes("--igual"),
    });
  } catch (e) {
    if (e.codigo === "menor_al_minimo") {
      console.error(`\n⚠️  ${e.message}`);
      console.error("");
      console.error("   No se acreditó nada todavía. Pero pensá esto antes de rechazarlo:");
      console.error("   si el médico ya transfirió, esa plata está en tu cuenta del banco.");
      console.error("   No acreditársela no le enseña la regla — es quedarte con su dinero.");
      console.error("");
      console.error("   Si el pago entró y lo vas a acreditar igual:");
      console.error(`     node scripts/cargar_saldo.js ${phone} ${monto} "${referencia}" --igual`);
      console.error("");
      console.error("   Si todavía no transfirió, decile que el mínimo es " + monedas.conSimbolo(e.minimoCentavos, moneda) + ".");
      await mongoose.disconnect();
      process.exit(1);
    }
    if (e.codigo === "referencia_repetida") {
      console.error(`\n❌ ${e.message}`);
      console.error("");
      console.error("   No se acreditó nada. Si es una transferencia NUEVA, usá su");
      console.error("   referencia real del banco: dos transferencias distintas nunca");
      console.error("   comparten el mismo número.");
      console.error("   Si el médico mandó el mismo comprobante otra vez, ya está cobrado.");
      await mongoose.disconnect();
      process.exit(1);
    }
    throw e;
  }

  console.log("");
  await mostrar(phone);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("💥", e.message);
  process.exit(1);
});
