// Symphomed — Suma un médico ya registrado a una clínica.
//
// No crea la cuenta: el médico se registra él mismo, con su propia
// contraseña. Esto solo lo asocia a la clínica.
//
// Uso: node scripts/vincular_medico.js <telefonoAdmin> <telefonoMedico> [empleado|alquila] ["Consultorio 3"]
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Clinica, Medico } = require("../db/models");

async function main() {
  const [, , phoneAdmin, phoneMedico, vinculoArg, consultorio] = process.argv;
  const vinculo = ["empleado", "alquila"].includes(vinculoArg) ? vinculoArg : "empleado";
  if (!phoneAdmin || !phoneMedico) {
    console.error('Uso: node scripts/vincular_medico.js <telefonoAdmin> <telefonoMedico> [empleado|alquila] ["Consultorio 3"]');
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  const admin = await Medico.findOne({ phone: String(phoneAdmin).trim() });
  if (!admin?.clinicaId) {
    console.error(`❌ +${phoneAdmin} no administra ninguna clínica.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const medico = await Medico.findOne({ phone: String(phoneMedico).trim() });
  if (!medico) {
    console.error(`❌ No hay ninguna cuenta con el teléfono +${phoneMedico}. El médico tiene que registrarse primero.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (medico.clinicaId && String(medico.clinicaId) !== String(admin.clinicaId)) {
    console.error(`❌ +${phoneMedico} ya pertenece a otra clínica.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  medico.clinicaId = admin.clinicaId;
  medico.vinculo = vinculo;
  if (consultorio) medico.consultorio = String(consultorio).trim();
  await medico.save();

  const clinica = await Clinica.findById(admin.clinicaId).lean();
  console.log(`✅ ${medico.nombre} (+${medico.phone}) → "${clinica.nombre}" · ${vinculo}${medico.consultorio ? " · " + medico.consultorio : ""}`);
  if (vinculo === "alquila") {
    console.log("   Ojo: alquila el consultorio, así que el panel NO le va a mostrar su facturación al administrador.");
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
