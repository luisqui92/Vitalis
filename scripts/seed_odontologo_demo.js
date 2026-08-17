// Vitalis Odonto — Crea (o actualiza) una cuenta de odontólogo de demo y le
// suma 5 pacientes con odontogramas ya cargados (varios estados, historial
// con fechas), para probar la arcada sin tener que cargar todo a mano.
//
// Uso: node scripts/seed_odontologo_demo.js <telefono> ["Nombre completo"] [password]
// Ej:  node scripts/seed_odontologo_demo.js 78804988
//      node scripts/seed_odontologo_demo.js 78804988 "Dr. Carlos Mendoza" miClave123
//
// Es idempotente: si el médico ya existe no le toca la contraseña ni el
// nombre; si un paciente de demo ya existe (mismo nombre) lo saltea.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, Odontograma } = require("../db/models");
const { hashPassword } = require("../services/auth");

function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

const PIEZAS_FDI_PERMANENTE = [
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
];

const PACIENTES_DEMO = [
  {
    nombre: "Luis Fernando Quispe Mamani", fechaNacimiento: "1992-03-15", sexo: "Masculino", telefono: "70011122",
    piezas: {
      36: { estado: "obturado", diasAtras: 20, historial: [
        { diasAtras: 90, estado: "caries", notas: "Caries oclusal profunda, dolor a la masticación y sensibilidad al frío." },
        { diasAtras: 45, estado: "endodoncia", notas: "Tratamiento de conducto realizado, compromiso pulpar confirmado." },
        { diasAtras: 20, estado: "obturado", notas: "Restauración con resina posterior a endodoncia." },
      ]},
      46: { estado: "corona", diasAtras: 60, historial: [{ diasAtras: 60, estado: "corona", notas: "Corona de porcelana tras fractura cuspídea." }] },
      18: { estado: "ausente", diasAtras: 400, historial: [{ diasAtras: 400, estado: "ausente", notas: "Extraída (tercer molar retenido)." }] },
    },
  },
  {
    nombre: "María José Fernández Rojas", fechaNacimiento: "1988-07-22", sexo: "Femenino", telefono: "70022233",
    piezas: {
      26: { estado: "caries", diasAtras: 5, historial: [{ diasAtras: 5, estado: "caries", notas: "Caries interproximal detectada en control de rutina." }] },
      11: { estado: "sellante", diasAtras: 200, historial: [{ diasAtras: 200, estado: "sellante", notas: "Sellante preventivo, fosas profundas." }] },
      47: { estado: "obturado", diasAtras: 150, historial: [{ diasAtras: 150, estado: "obturado", notas: "Restauración con resina, caries oclusal simple." }] },
    },
  },
  {
    nombre: "Jorge Andrés Villca Flores", fechaNacimiento: "1975-11-02", sexo: "Masculino", telefono: "70033344",
    piezas: {
      48: { estado: "extraccion_indicada", diasAtras: 3, historial: [{ diasAtras: 3, estado: "extraccion_indicada", notas: "Tercer molar semi-retenido, pericoronaritis a repetición." }] },
      16: { estado: "corona", diasAtras: 500, historial: [{ diasAtras: 500, estado: "corona", notas: "Corona metal-porcelana post endodoncia." }] },
      21: { estado: "fractura", diasAtras: 10, historial: [{ diasAtras: 10, estado: "fractura", notas: "Fractura coronaria por trauma, pendiente evaluar restauración." }] },
      36: { estado: "implante", diasAtras: 300, historial: [{ diasAtras: 300, estado: "implante", notas: "Implante osteointegrado, en función." }] },
    },
  },
  {
    nombre: "Camila Beatriz Torrez Guzmán", fechaNacimiento: "2001-01-30", sexo: "Femenino", telefono: "70044455",
    piezas: {
      14: { estado: "sano", diasAtras: 0, historial: [] },
      37: { estado: "caries", diasAtras: 15, historial: [{ diasAtras: 15, estado: "caries", notas: "Caries incipiente, control en 3 meses." }] },
    },
  },
  {
    nombre: "Ricardo Antonio Paredes Soliz", fechaNacimiento: "1965-05-18", sexo: "Masculino", telefono: "70055566",
    piezas: {
      11: { estado: "ausente", diasAtras: 600, historial: [{ diasAtras: 600, estado: "ausente", notas: "Pérdida por trauma antiguo." }] },
      21: { estado: "implante", diasAtras: 180, historial: [{ diasAtras: 180, estado: "implante", notas: "Implante + corona provisional, en espera de definitiva." }] },
      46: { estado: "endodoncia", diasAtras: 40, historial: [{ diasAtras: 40, estado: "endodoncia", notas: "Necrosis pulpar, tratamiento de conducto en curso." }] },
      47: { estado: "caries", diasAtras: 8, historial: [{ diasAtras: 8, estado: "caries", notas: "Caries oclusal moderada." }] },
    },
  },
];

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "Dr. Carlos Mendoza").trim();
  // Sin contraseña sin generar una al azar: un default fijo ("odonto2026")
  // es peligroso si alguna vez se corre este script contra producción sin
  // pasar el tercer argumento — quedaría una cuenta con clave adivinable.
  const passwordGenerada = !process.argv[4];
  const password = String(process.argv[4] || crypto.randomBytes(9).toString("base64url")).trim();
  if (!phone) {
    console.error('Uso: node scripts/seed_odontologo_demo.js <telefono> ["Nombre"] [password]');
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");

  let medico = await Medico.findOne({ phone });
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, especialidad: "Odontología general", tipoEspecialidad: "odontologia",
      passwordHash: await hashPassword(password), activo: true,
    });
    console.log(`✅ Cuenta creada: ${nombre} (+${phone}) — contraseña${passwordGenerada ? " generada" : ""}: ${password}`);
  } else {
    if (medico.tipoEspecialidad !== "odontologia") {
      medico.tipoEspecialidad = "odontologia";
      await medico.save();
      console.log(`ℹ️  La cuenta +${phone} ya existía (${medico.nombre}) — la pasé a tipoEspecialidad=odontologia. Contraseña sin cambios.`);
    } else {
      console.log(`ℹ️  La cuenta +${phone} ya existía y ya era de odontología (${medico.nombre}). Contraseña sin cambios.`);
    }
  }

  let creados = 0, saltados = 0;
  for (const p of PACIENTES_DEMO) {
    const yaExiste = await Paciente.findOne({ medicoPhone: phone, nombre: p.nombre });
    if (yaExiste) {
      console.log(`⏭️  Ya existe: ${p.nombre} — salteado`);
      saltados++;
      continue;
    }

    const paciente = await Paciente.create({
      medicoPhone: phone, nombre: p.nombre,
      fechaNacimiento: new Date(p.fechaNacimiento), sexo: p.sexo, telefono: p.telefono,
    });

    const piezas = PIEZAS_FDI_PERMANENTE.map(numero => {
      const custom = p.piezas[numero];
      if (!custom) return { numero, estado: "sano", notas: "", historial: [] };
      return {
        numero,
        estado: custom.estado,
        notas: custom.historial[custom.historial.length - 1]?.notas || "",
        historial: custom.historial.map(h => ({ fecha: hace(h.diasAtras), estado: h.estado, notas: h.notas })),
      };
    });
    await Odontograma.create({ pacienteId: paciente._id, medicoPhone: phone, piezas });

    const piezasConHallazgo = Object.keys(p.piezas).length;
    console.log(`✅ Paciente creado: ${p.nombre} — odontograma con ${piezasConHallazgo} pieza(s) con hallazgos`);
    creados++;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🏁 Listo. Pacientes creados: ${creados} · Ya existían: ${saltados}`);
  console.log(`\nEntrá con: teléfono ${phone} / contraseña la de arriba (si la cuenta era nueva).`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
