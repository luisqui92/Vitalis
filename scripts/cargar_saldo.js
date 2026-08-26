// Vitalis — Acreditar una transferencia o un QR al saldo de un médico.
//
// Lo corre una persona que YA vio el comprobante. Por eso pide contra qué
// referencia se acredita: una carga sin comprobante es plata que apareció de
// la nada, y el día que los números no cierren no hay cómo reconstruirlo.
//
// Uso:
//   node scripts/cargar_saldo.js <telefono> <bolivianos> "<referencia>"
//   node scripts/cargar_saldo.js 76660555 200 "QR BCP 4471-2290"
//
//   node scripts/cargar_saldo.js <telefono>              (ver saldo y últimos movimientos)
//   node scripts/cargar_saldo.js --revisar               (buscar descuadres en todas)
//
// El monto va en BOLIVIANOS, como figura en el comprobante. Adentro se guarda
// en centavos enteros — ver el comentario de MovimientoSaldo en db/models.js.
const readline = require("readline");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico } = require("../db/models");
const saldos = require("../services/saldo");

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (a) => { rl.close(); r(a.trim()); }));
}

function fecha(d) {
  return new Date(d).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function mostrar(phone) {
  const medico = await Medico.findOne({ phone }).select("nombre tipoEspecialidad").lean();
  if (!medico) {
    console.error(`❌ No hay ninguna cuenta con el teléfono ${phone}.`);
    return null;
  }
  const estado = await saldos.estadoDe(phone);
  console.log(`\n+${phone}  ${medico.nombre}  (${medico.tipoEspecialidad})`);
  console.log(`Saldo: Bs ${estado.saldoBs}  ·  alcanza para ${estado.consultasRestantes} consulta(s)`);
  if (estado.enNegativo) console.log("⚠️  En negativo: consultas que se completaron con el saldo agotado.");
  else if (estado.bajo) console.log("⚠️  Saldo bajo.");

  const movs = await saldos.movimientosDe(phone, 12);
  if (movs.length) {
    console.log("\nÚltimos movimientos:");
    for (const m of movs) {
      const signo = m.montoCentavos >= 0 ? "+" : "−";
      const monto = `${signo}Bs ${saldos.bolivianos(Math.abs(m.montoCentavos))}`.padStart(12);
      console.log(`  ${fecha(m.createdAt)}  ${monto}  → Bs ${saldos.bolivianos(m.saldoDespuesCentavos).padStart(8)}   ${m.concepto}${m.referencia ? ` [${m.referencia}]` : ""}`);
    }
  } else {
    console.log("\n(sin movimientos todavía)");
  }
  return medico;
}

async function revisarTodas() {
  const medicos = await Medico.find({}).select("phone nombre").lean();
  console.log(`\nRevisando ${medicos.length} cuenta(s)...\n`);
  let descuadradas = 0;
  for (const m of medicos) {
    const r = await saldos.reconciliar(m.phone);
    if (!r.cuadra) {
      descuadradas++;
      console.log(`❌ +${m.phone} ${m.nombre}`);
      console.log(`   en la cuenta: Bs ${saldos.bolivianos(r.enLaCuenta)} · según movimientos: Bs ${saldos.bolivianos(r.segunMovimientos)} · difiere Bs ${saldos.bolivianos(r.diferencia)}`);
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
    console.error('Uso: node scripts/cargar_saldo.js <telefono> <bolivianos> "<referencia>"');
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
    console.error(`\n❌ "${bs}" no es un monto válido en bolivianos.`);
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
  console.log(`\n→ Acreditar Bs ${monto.toFixed(2)} a ${medico.nombre} (+${phone})`);
  console.log(`   Referencia: ${referencia}`);
  console.log("");
  console.log("   ⚠️  ¿Viste este pago en el BANCO, no solo en la captura que te mandaron?");
  console.log("      Una captura de pantalla se falsifica en dos minutos.");
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
    });
  } catch (e) {
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
