// Symphomed — Crea la cuenta de quien administra los pagos.
//
// ═══ POR QUÉ EXISTE ESTE SCRIPT Y NO ALCANZA CON UNA CUENTA DE MÉDICO ══════
//
// Hasta ahora, para que alguien pudiera aprobar recargas había que ponerlo en
// OPERADORES_SALDO, y esa lista solo servía sobre una cuenta de MÉDICO. O
// sea: quien manejaba la plata era también alguien que la gastaba. Consumía
// Bs 12 por consulta y podía aprobar sus propias recargas, sin que nadie más
// mirara. Mientras la única cuenta de operador sea la del dueño da lo mismo;
// el día que entra otra persona a manejar cobranzas, no.
//
// Esta cuenta es lo contrario:
//   · rol "admin" → las 30 rutas clínicas la rechazan solas. No abre una
//     ficha, no ve un diagnóstico, no tiene pacientes.
//   · sin clínica → tampoco administra consultorios ajenos.
//   · no consume saldo, porque no atiende: no hay nada que cobrarle.
//
// Lo único que puede hacer es lo que dice el nombre: ver la cola de avisos de
// pago, verificarlos en el banco, y acreditar o rechazar.
//
// ═══ CREAR LA CUENTA NO LE DA EL PERMISO ═══════════════════════════════════
//
// Esto crea la cuenta y nada más. Para que pueda acreditar faltan dos cosas
// que este script NO puede hacer solo, a propósito:
//
//   1. Agregar el teléfono a OPERADORES_SALDO en el .env y reiniciar. El
//      permiso vive en el entorno y no en la base justamente para que no
//      alcance con escribir en Mongo para darse el poder de emitir saldo
//      (ver el encabezado de routes/operadorSaldo.js).
//   2. Que la persona entre y active el segundo factor en Configuración.
//      Hasta que lo haga, las rutas de operador le contestan que lo active.
//
// Uso: node scripts/crear_operador.js <telefono> "Nombre y Apellido" [password]
// Ej:  node scripts/crear_operador.js 71234567 "María Pagos"
//
// Es idempotente y NO le pisa la contraseña a una cuenta que ya exista.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico } = require("../db/models");
const { hashPassword } = require("../services/auth");
const { esOperador } = require("../services/operadores");

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "").trim();
  const passwordDada = String(process.argv[4] || "").trim();
  const password = passwordDada || crypto.randomBytes(9).toString("base64url");

  if (!phone || !nombre) {
    console.error('Uso: node scripts/crear_operador.js <telefono> "Nombre y Apellido" [password]');
    process.exit(1);
  }
  if (passwordDada && passwordDada.length < 8) {
    console.error("❌ La contraseña tiene que tener al menos 8 caracteres.");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);

  let cuenta = await Medico.findOne({ phone });
  if (!cuenta) {
    cuenta = await Medico.create({
      phone, nombre,
      passwordHash: await hashPassword(password),
      activo: true, rol: "admin", clinicaId: null,
    });
    console.log(`✅ Cuenta de pagos creada: +${phone} — ${nombre}`);
    console.log(`   Contraseña${passwordDada ? "" : " generada"}: ${password}`);
  } else if (cuenta.rol === "medico" || cuenta.rol === "director") {
    // No se convierte sola. Si +59171234567 es un médico con pacientes y
    // alguien tipea mal un número, pasarla a "admin" le cerraría en el acto
    // el acceso a todas sus fichas. Es exactamente el error que un script
    // "servicial" comete una sola vez.
    console.error(`❌ +${phone} ya existe y es una cuenta de ${cuenta.rol} — atiende pacientes.`);
    console.error("   No la convierto en administrativa: perdería el acceso a sus fichas.");
    console.error("   Usá otro teléfono para la cuenta de pagos.");
    await mongoose.disconnect();
    process.exit(1);
  } else {
    console.log(`ℹ️  La cuenta +${phone} ya existía como administrativa (contraseña sin cambios).`);
  }

  // ─── LO QUE FALTA ───────────────────────────────────────────────────────
  console.log("\nPara que pueda aprobar pagos faltan dos pasos:\n");
  if (esOperador(phone)) {
    console.log(`  1. ✅ +${phone} ya está en OPERADORES_SALDO.`);
  } else {
    console.log("  1. Agregá el teléfono a OPERADORES_SALDO en el .env y reiniciá:");
    console.log(`       OPERADORES_SALDO=...,${phone}`);
    console.log("       pm2 restart vitalis");
  }
  console.log(`  2. Que entre con +${phone} y active la verificación en dos pasos`);
  console.log("     en Configuración. Sin eso, no puede acreditar (es obligatorio).\n");
  console.log("Esta cuenta NO ve ninguna historia clínica ni consume saldo.");

  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
