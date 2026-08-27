// Vitalis — ¿Por qué no veo el panel de Pagos?
//
// El panel de Pagos aparece cuando se cumplen TRES cosas a la vez, y ninguna
// de las tres se ve desde la pantalla:
//
//   1. La cuenta existe.
//   2. El teléfono está en OPERADORES_SALDO, en el .env del servidor.
//   3. Esa cuenta tiene el segundo factor activo.
//
// Si falta cualquiera, el resultado es el mismo desde afuera: no hay panel.
// Sin nada que lo distinga, uno termina adivinando cuál de las tres es —o
// peor, tocando el .env cuando lo que faltaba era el 2FA.
//
// Esto no arregla nada ni cambia nada. Solo mira y dice cuál falta.
//
// Uso: node scripts/revisar_operador.js 62741818
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico } = require("../db/models");
const { esOperador, todosLosOperadores } = require("../services/operadores");

async function main() {
  const phone = String(process.argv[2] || "").trim();
  if (!phone) {
    console.error("Uso: node scripts/revisar_operador.js <telefono>");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  const cuenta = await Medico.findOne({ phone }).select("nombre rol dosFA activo").lean();

  console.log(`\n── Panel de Pagos para +${phone} ──\n`);

  const existe = Boolean(cuenta);
  const enLista = esOperador(phone);
  const con2fa = Boolean(cuenta?.dosFA?.activo);

  console.log(existe
    ? `  ✅ La cuenta existe — "${cuenta.nombre}" (rol ${cuenta.rol || "medico"})`
    : `  ❌ No existe ninguna cuenta con ese número`);
  console.log(`  ${enLista ? "✅" : "❌"} Está en OPERADORES_SALDO (.env)`);
  console.log(`  ${con2fa ? "✅" : "❌"} Tiene la verificación en dos pasos activa`);

  console.log("");
  if (existe && enLista && con2fa) {
    console.log("✅ Todo en orden: esta cuenta ve el panel de Pagos y puede aprobar.");
    console.log("   Si aun así no lo ves en pantalla: cerrá sesión y volvé a entrar.");
    console.log("   El menú se arma al iniciar sesión, así que una sesión vieja no lo trae.");
    await mongoose.disconnect();
    return;
  }

  console.log("Falta esto:\n");
  // Si la cuenta no existe, lo demás es ruido: mandarlo a editar el .env por
  // un número que no tiene cuenta es hacerle tocar el archivo más delicado
  // del servidor para nada.
  if (!existe) {
    console.log(`  · No hay ninguna cuenta con +${phone}. Revisá el número.`);
    console.log("    Si el número está bien, primero hay que crear la cuenta.");
    console.log("");
    await mongoose.disconnect();
    return;
  }
  if (!enLista) {
    const actuales = todosLosOperadores();
    console.log("  · Agregar el teléfono a OPERADORES_SALDO en el .env y reiniciar:");
    console.log(`      OPERADORES_SALDO=${[...actuales, phone].join(",")}`);
    console.log("      pm2 restart vitalis");
    if (!actuales.length) {
      // Vacía por defecto a propósito: si nadie la configuró, nadie emite
      // saldo, en vez de que pueda cualquiera.
      console.log("    (hoy está vacía: nadie puede aprobar pagos)");
    } else {
      console.log(`    (hoy figuran: ${actuales.map(p => "+" + p).join(", ")})`);
    }
  }
  if (existe && !con2fa) {
    console.log(`  · Entrar con +${phone} y activar la verificación en dos pasos`);
    console.log("    en Configuración. Es obligatorio para aprobar pagos: una cuenta");
    console.log("    que emite saldo sin 2FA está a un phishing de que otro lo emita");
    console.log("    en su nombre.");
  }
  console.log("");

  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
