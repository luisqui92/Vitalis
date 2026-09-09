// Symphomed — Crea una clínica y le pone un administrador.
//
// El administrador NO es médico: no ve ninguna ficha. Si además atiende
// pacientes, usá --rol director en vez de admin.
//
// Uso: node scripts/crear_clinica.js "Nombre de la clínica" <telefonoAdmin> [password] [--rol director]
// Ej:  node scripts/crear_clinica.js "Clínica San Rafael" 78811000 admin12345
//
// Es idempotente: si la clínica y el admin ya existen, no los duplica ni le
// pisa la contraseña a nadie.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Clinica, Medico } = require("../db/models");
const { hashPassword } = require("../services/auth");

async function main() {
  const nombre = String(process.argv[2] || "").trim();
  const phone = String(process.argv[3] || "").trim();
  const rolPedido = process.argv.includes("--rol") ? process.argv[process.argv.indexOf("--rol") + 1] : "admin";
  const argsSinFlags = process.argv.slice(4).filter(a => a !== "--rol" && a !== rolPedido);
  const passwordGenerada = argsSinFlags.length === 0;
  const password = argsSinFlags[0] || crypto.randomBytes(9).toString("base64url");

  if (!nombre || !phone) {
    console.error('Uso: node scripts/crear_clinica.js "Nombre" <telefonoAdmin> [password] [--rol director]');
    process.exit(1);
  }
  if (!["admin", "director"].includes(rolPedido)) {
    console.error(`❌ --rol tiene que ser "admin" o "director", no ${rolPedido}`);
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);

  let clinica = await Clinica.findOne({ nombre });
  if (!clinica) {
    clinica = await Clinica.create({ nombre });
    console.log(`✅ Clínica creada: ${nombre}`);
  } else {
    console.log(`ℹ️  La clínica "${nombre}" ya existía.`);
  }

  let admin = await Medico.findOne({ phone });
  if (!admin) {
    admin = await Medico.create({
      phone, nombre: `Administración — ${nombre}`,
      passwordHash: await hashPassword(password), activo: true,
      rol: rolPedido, clinicaId: clinica._id,
    });
    console.log(`✅ Cuenta ${rolPedido} creada: +${phone} — contraseña${passwordGenerada ? " generada" : ""}: ${password}`);
  } else {
    // No se le pisa la contraseña a una cuenta que ya existe: alguien la
    // puede estar usando ahora mismo.
    admin.rol = rolPedido;
    admin.clinicaId = clinica._id;
    await admin.save();
    console.log(`ℹ️  La cuenta +${phone} ya existía — ahora es ${rolPedido} de "${nombre}" (contraseña sin cambios).`);
  }

  console.log(`\n🏥 Clínica: ${clinica._id}`);
  console.log(`   Para sumar médicos, entrá con +${phone} y usá el panel, o:`);
  console.log(`   node scripts/vincular_medico.js ${phone} <telefonoMedico> [empleado|alquila] ["Consultorio 3"]`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
