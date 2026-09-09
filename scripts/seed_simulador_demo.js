// Symphomed — Demo del simulador quirúrgico con fotos reales
//
// El seeder de estética (seed_estetica_demo.js) llena la cuenta con
// pacientes, tratamientos y saldos, pero sus fotos son cuadrados de color
// sólido: sirven para mostrar la ficha, no para el simulador. El simulador
// necesita una cara de verdad — sin ella no hay nada que detectar ni nada
// que marcar.
//
// Esto carga un paciente con las cinco vistas del protocolo de estética
// (frontal, 45° y perfil de los dos lados), que es exactamente lo que se le
// pide a un paciente antes de una rinoplastia, y deja la cuenta lista para
// abrir el simulador en una reunión sin tener que sacarle una foto a nadie
// en el momento.
//
// Uso: node scripts/seed_simulador_demo.js <telefono> ["Nombre"] [password]
// Ej:  node scripts/seed_simulador_demo.js 78822010
//
// Es idempotente: si la cuenta existe no le toca la contraseña, y si el
// paciente demo ya tiene las fotos cargadas no las duplica.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, Estudio } = require("../db/models");
const { hashPassword } = require("../services/auth");
const { siguienteCodigo } = require("../services/codigos");

const DIR_ESTUDIOS = path.join(__dirname, "..", "uploads", "estudios");
const DIR_FOTOS = path.join(__dirname, "demo_fotos_simulador");
const NOMBRE_PACIENTE = "Paciente Demo — Simulador";

// El orden importa: es el orden en que se le pide al paciente que se pare,
// y el que espera la pantalla de comparación de la ficha.
const VISTAS = [
  { archivo: "foto1.jpg", angulo: "frontal",            nombre: "Frontal — preoperatorio" },
  { archivo: "foto2.jpg", angulo: "angulo45_derecha",   nombre: "45° derecha — preoperatorio" },
  { archivo: "foto3.jpg", angulo: "perfil_derecho",     nombre: "Perfil derecho — preoperatorio" },
  { archivo: "foto4.jpg", angulo: "angulo45_izquierda", nombre: "45° izquierda — preoperatorio" },
  { archivo: "foto5.jpg", angulo: "perfil_izquierdo",   nombre: "Perfil izquierdo — preoperatorio" },
];

function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "Dr. Marcelo Vaca").trim();
  const passwordGenerada = !process.argv[4];
  const password = String(process.argv[4] || crypto.randomBytes(9).toString("base64url")).trim();
  if (!phone) {
    console.error('Uso: node scripts/seed_simulador_demo.js <telefono> ["Nombre"] [password]');
    process.exit(1);
  }

  const faltan = VISTAS.filter(v => !fs.existsSync(path.join(DIR_FOTOS, v.archivo)));
  if (faltan.length) {
    console.error(`❌ Faltan las fotos del demo en ${DIR_FOTOS}: ${faltan.map(f => f.archivo).join(", ")}`);
    console.error("   Vienen con el repositorio; si no están, revisá que el git pull haya traído scripts/demo_fotos_simulador/.");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");
  fs.mkdirSync(DIR_ESTUDIOS, { recursive: true });

  let medico = await Medico.findOne({ phone });
  const cuentaNueva = !medico;
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, especialidad: "Cirugía plástica y estética", tipoEspecialidad: "estetica",
      passwordHash: await hashPassword(password), activo: true,
    });
    console.log(`✅ Cuenta creada: ${nombre} (+${phone})`);
    console.log(`   Contraseña${passwordGenerada ? " generada" : ""}: ${password}\n`);
  } else if (medico.tipoEspecialidad !== "estetica") {
    // Cambiarle la especialidad a una cuenta que ya está en uso le daría
    // vuelta la interfaz entera al médico que la usa todos los días. Mejor
    // parar acá que "arreglarlo" por dentro.
    console.error(`❌ La cuenta +${phone} existe pero es de "${medico.tipoEspecialidad}", no de estética.`);
    console.error("   El botón de simular solo aparece en cuentas de estética, y el tipo de");
    console.error("   especialidad no se cambia después de crear la cuenta. Usá otro teléfono.");
    await mongoose.disconnect();
    process.exit(1);
  } else {
    console.log(`ℹ️  La cuenta +${phone} ya existía (${medico.nombre}). Contraseña sin cambios.\n`);
  }

  let paciente = await Paciente.findOne({ medicoPhone: phone, nombre: NOMBRE_PACIENTE });
  if (!paciente) {
    paciente = await Paciente.create({
      medicoPhone: phone,
      nombre: NOMBRE_PACIENTE,
      fechaNacimiento: new Date("1988-03-12"),
      sexo: "Masculino",
      codigo: await siguienteCodigo(Paciente, phone, "P"),
      notas: "Consulta por rinoplastia. Fotos del protocolo de cinco vistas. "
           + "Sin cirugías previas, sin alergias conocidas.",
    });
    console.log(`✅ Paciente creado: ${paciente.nombre} (${paciente.codigo})`);
  } else {
    console.log(`ℹ️  El paciente demo ya existía (${paciente.codigo || "sin código"}).`);
  }

  let cargadas = 0, salteadas = 0;
  for (const v of VISTAS) {
    const yaEsta = await Estudio.findOne({
      medicoPhone: phone, pacienteId: paciente._id, tipo: "foto", anguloFoto: v.angulo,
    }).lean();
    if (yaEsta) { salteadas++; continue; }

    const buf = fs.readFileSync(path.join(DIR_FOTOS, v.archivo));
    const archivoNombre = crypto.randomUUID() + ".jpg";
    fs.writeFileSync(path.join(DIR_ESTUDIOS, archivoNombre), buf);
    await Estudio.create({
      pacienteId: paciente._id, medicoPhone: phone, tipo: "foto",
      nombre: v.nombre,
      archivoNombre, archivoMime: "image/jpeg", archivoTamano: buf.length,
      fecha: hace(1), anguloFoto: v.angulo,
    });
    cargadas++;
  }
  console.log(`✅ Fotos: ${cargadas} cargadas${salteadas ? `, ${salteadas} ya estaban` : ""}\n`);

  console.log("─────────────────────────────────────────────");
  console.log("Para verlo:");
  console.log(`  1. Entrá con  usuario ${phone}   contraseña ${cuentaNueva ? password : "(la que ya tenía esta cuenta)"}`);
  console.log(`  2. Abrí "${NOMBRE_PACIENTE}" → pestaña Estudios`);
  console.log('  3. En cualquier foto: "✨ Simular cirugía sobre esta foto"');
  console.log("");
  console.log("  El PERFIL DERECHO es el que mejor muestra lo nuevo: el detector");
  console.log("  automático no puede leer un perfil cerrado, así que abre directo");
  console.log("  la pantalla para marcar los 10 puntos a mano.");
  console.log("─────────────────────────────────────────────");

  await mongoose.disconnect();
}

main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
