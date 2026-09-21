// Symphomed — TODAS las cuentas que existen, y cómo ponerles contraseña nueva.
//
// Lista todas, no solo las de demostración: las que se crearon con los
// scripts de seed, las que se registró un médico solo, y las que alguien
// hizo hace meses y ya nadie recuerda.
//
// ═══ LAS CONTRASEÑAS NO SE PUEDEN VER ══════════════════════════════════════
//
// Ni desde acá ni desde ningún lado. Se guardan con bcrypt, que es de una
// sola vía: de la contraseña se llega al hash, del hash no se vuelve. Eso no
// es una limitación de este script, es lo que hace que robarse la base de
// datos no sea robarse las contraseñas de todos los médicos.
//
// Cuando una se pierde, lo que corresponde es poner otra.
//
// Uso:
//   node scripts/cuentas.js                          (lista todas)
//   node scripts/cuentas.js <telefono>               (mira una)
//   node scripts/cuentas.js <telefono> --clave       (le pone una nueva)
//   node scripts/cuentas.js <telefono> --clave "la-que-quieras"
//   node scripts/cuentas.js <telefono> --activar     (reactiva una cuenta apagada)
//
// Sin la contraseña escrita, genera una y la muestra UNA sola vez.
//
// ⚠️ Cambiarle la contraseña a un médico que está atendiendo lo deja afuera
// de su propio consultorio. Por eso, si la cuenta tiene muchos pacientes y
// no es una demo conocida, el script frena y hay que insistir con --igual.
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
  "78822001": "Estética · Symphomed Face",
  "78822010": "Estética · simulador",
  "78833001": "Oftalmología",
  "78844001": "Veterinaria",
  "78804988": "Odontología",
};

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const activar = process.argv.includes("--activar");
  const ponerClave = process.argv.includes("--clave");
  const claveDada = process.argv[process.argv.indexOf("--clave") + 1];
  const clave = ponerClave
    ? (claveDada && !claveDada.startsWith("--") && claveDada !== phone ? claveDada : crypto.randomBytes(9).toString("base64url"))
    : null;

  await mongoose.connect(CONFIG.MONGODB_URI);

  if (!phone) {
    const medicos = await Medico.find({}).select("phone nombre tipoEspecialidad rol activo createdAt").sort({ createdAt: 1 }).lean();
    console.log(`\n${medicos.length} cuenta(s) en la base — todas, no solo las de demo:\n`);
    for (const m of medicos) {
      const pacientes = await Paciente.countDocuments({ medicoPhone: m.phone });
      const consultas = await ConsultaMedica.countDocuments({ medicoPhone: m.phone });
      const etiqueta = DEMOS_CONOCIDAS[m.phone] ? `  ← demo: ${DEMOS_CONOCIDAS[m.phone]}` : "";
      console.log(`  +${m.phone}  ${m.nombre}`);
      // Las cuentas viejas no tienen tipoEspecialidad: son de antes de que
      // existiera el campo. Imprimir "undefined" hace pensar que algo está
      // roto cuando lo único que pasa es que ese dato no existe.
      const area = m.tipoEspecialidad || "sin especialidad definida";
      console.log(`     ${area} · rol ${m.rol || "medico"}${m.activo === false ? " · INACTIVA" : ""}`);
      console.log(`     ${pacientes} paciente(s), ${consultas} consulta(s)${etiqueta}\n`);
    }
    console.log("Las contraseñas no aparecen porque no se pueden leer (bcrypt).");
    console.log("Para ponerle una nueva a alguna:");
    console.log("  node scripts/cuentas.js <telefono> --clave\n");
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
  if (medico.activo === false) console.log("Estado: INACTIVA");

  // Reactivar es de bajo riesgo — al revés que cambiar la contraseña, no deja
  // a nadie afuera de su consultorio: en el peor caso, alguien que no debía
  // entrar puede entrar de nuevo. Por eso no lleva el mismo freno de
  // --clave/--igual, solo confirma qué estaba pasando antes de tocarlo.
  if (activar) {
    if (medico.activo !== false) {
      console.log("\nEsta cuenta ya estaba activa — no había nada que hacer.\n");
    } else {
      // updateOne y no medico.save(): guardar el documento entero lo
      // revalida entero, y una cuenta vieja puede tener un dato que ya no
      // entra en el esquema de hoy (p. ej. "Aprobada" con mayúscula, de
      // antes de que el enum se pusiera estricto) — eso no tiene nada que
      // ver con activarla, y no debería impedirlo.
      await Medico.updateOne({ phone }, { $set: { activo: true } });
      console.log(`\n✅ Cuenta de +${phone} reactivada. Ya puede entrar con su contraseña de siempre.\n`);
    }
    if (!ponerClave) {
      await mongoose.disconnect();
      return;
    }
  }

  if (!ponerClave) {
    console.log("\nLa contraseña no se puede leer: bcrypt es de una sola vía.");
    console.log(`Para ponerle una nueva:  node scripts/cuentas.js ${phone} --clave\n`);
    await mongoose.disconnect();
    return;
  }

  // El freno que importa. Una cuenta de demo tiene pacientes inventados; si
  // hay muchos y no está en la lista de demos, lo más probable es que sea
  // un médico de verdad — y dejarlo afuera de su consultorio en medio de una
  // jornada es un daño real.
  const esDemoConocida = Boolean(DEMOS_CONOCIDAS[phone]);
  const insistir = process.argv.includes("--igual");
  if (!esDemoConocida && pacientes > 12 && !insistir) {
    console.error(`\n⚠️  Esta cuenta no está en la lista de demos y tiene ${pacientes} pacientes.`);
    console.error("   Puede ser un médico atendiendo de verdad, y cambiarle la contraseña");
    console.error("   lo deja afuera de su consultorio hasta que alguien le pase la nueva.");
    console.error("");
    console.error("   Si la cuenta es tuya o ya lo hablaste con esa persona:");
    console.error(`     node scripts/cuentas.js ${phone} --clave --igual`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Mismo motivo que en --activar: updateOne toca solo este campo, en vez
  // de revalidar el documento entero contra el esquema de hoy.
  await Medico.updateOne({ phone }, { $set: { passwordHash: await hashPassword(clave) } });
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
