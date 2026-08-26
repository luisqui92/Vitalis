// Vitalis — Ver las cuentas de demostración, y ponerles contraseña nueva.
//
// Las contraseñas se guardan con bcrypt: no se pueden leer, ni siquiera
// desde acá. Eso está bien y es a propósito. Cuando una se pierde, lo que
// corresponde es ponerle otra, no recuperarla.
//
// Uso:
//   node scripts/cuentas_demo.js                        (lista las cuentas)
//   node scripts/cuentas_demo.js <telefono> --clave     (le pone una nueva)
//   node scripts/cuentas_demo.js <telefono> --clave "loquesea"
//
// Sin la contraseña escrita, genera una y la muestra UNA sola vez.
//
// ⚠️ Solo para cuentas de demostración. Si el teléfono corresponde a una
// cuenta con pacientes reales, avisa y no hace nada: cambiarle la contraseña
// a un médico que está atendiendo lo deja afuera de su propio consultorio.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica } = require("../db/models");
const { hashPassword } = require("../services/auth");

// Los teléfonos con los que se crearon las demos, según los ejemplos de cada
// script de seed. Si alguien usó otro, igual aparece en la lista de abajo.
const DEMOS_CONOCIDAS = {
  "78811001": "Medicina general",
  "78811002": "Ginecología y obstetricia",
  "78811005": "Neurodesarrollo",
  "78822001": "Estética · Vitalis Face",
  "78822010": "Estética · simulador",
  "78833001": "Oftalmología",
  "78844001": "Veterinaria",
  "78804988": "Odontología",
};

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const ponerClave = process.argv.includes("--clave");
  const claveDada = process.argv[process.argv.indexOf("--clave") + 1];
  const clave = ponerClave
    ? (claveDada && claveDada !== phone ? claveDada : crypto.randomBytes(9).toString("base64url"))
    : null;

  await mongoose.connect(CONFIG.MONGODB_URI);

  if (!phone) {
    const medicos = await Medico.find({}).select("phone nombre tipoEspecialidad rol activo createdAt").sort({ createdAt: 1 }).lean();
    console.log(`\n${medicos.length} cuenta(s):\n`);
    for (const m of medicos) {
      const pacientes = await Paciente.countDocuments({ medicoPhone: m.phone });
      const consultas = await ConsultaMedica.countDocuments({ medicoPhone: m.phone });
      const etiqueta = DEMOS_CONOCIDAS[m.phone] ? `  ← demo: ${DEMOS_CONOCIDAS[m.phone]}` : "";
      console.log(`  +${m.phone}  ${m.nombre}`);
      console.log(`     ${m.tipoEspecialidad} · rol ${m.rol || "medico"}${m.activo === false ? " · INACTIVA" : ""}`);
      console.log(`     ${pacientes} paciente(s), ${consultas} consulta(s)${etiqueta}\n`);
    }
    console.log("Para ponerle contraseña nueva a una:");
    console.log("  node scripts/cuentas_demo.js <telefono> --clave\n");
    await mongoose.disconnect();
    return;
  }

  const medico = await Medico.findOne({ phone });
  if (!medico) {
    console.error(`❌ No hay ninguna cuenta con el teléfono ${phone}.`);
    console.error("   Corré el script sin argumentos para ver las que hay.");
    await mongoose.disconnect();
    process.exit(1);
  }

  const pacientes = await Paciente.countDocuments({ medicoPhone: phone });
  const consultas = await ConsultaMedica.countDocuments({ medicoPhone: phone });
  console.log(`\n+${medico.phone}  ${medico.nombre}`);
  console.log(`${medico.tipoEspecialidad} · ${pacientes} paciente(s), ${consultas} consulta(s)`);

  if (!ponerClave) {
    console.log("\nLa contraseña no se puede leer: bcrypt es de una sola vía.");
    console.log(`Para ponerle una nueva:  node scripts/cuentas_demo.js ${phone} --clave\n`);
    await mongoose.disconnect();
    return;
  }

  // El freno que importa. Una cuenta de demo tiene pacientes inventados; si
  // hay muchos y no está en la lista de demos, lo más probable es que sea
  // un médico de verdad — y dejarlo afuera de su consultorio en medio de una
  // jornada es un daño real.
  const esDemoConocida = Boolean(DEMOS_CONOCIDAS[phone]);
  if (!esDemoConocida && pacientes > 12) {
    console.error(`\n❌ Esta cuenta no está en la lista de demos y tiene ${pacientes} pacientes.`);
    console.error("   Parece un médico de verdad. No le voy a cambiar la contraseña.");
    console.error("   Si igual hay que hacerlo, que lo pida esa persona y hacelo a mano.");
    await mongoose.disconnect();
    process.exit(1);
  }

  medico.passwordHash = await hashPassword(clave);
  await medico.save();
  console.log(`\n✅ Contraseña nueva para +${phone}:\n`);
  console.log(`      ${clave}\n`);
  console.log("Se muestra UNA sola vez. Anotala ahora.");
  console.log("Si es una cuenta que vas a mostrar en una demo, guardala donde guardes");
  console.log("las demás — no en un WhatsApp.\n");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("💥", e.message);
  process.exit(1);
});
