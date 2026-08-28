// Vitalis — Una clínica de demo completa, con varios consultorios y datos
// en cada uno.
//
// Los seeds que ya existían arman UN médico con una historia clínica
// profunda. Este arma lo otro: la clínica vista desde arriba. Sirve para
// mostrar el panel del administrador, la agenda unificada, la ocupación por
// sala — que con un solo consultorio no se entienden.
//
// Qué deja armado:
//
//   · Una clínica con su cuenta administrativa (rol "admin": no ve ninguna
//     ficha, solo números).
//   · Cuatro consultorios con especialidades distintas, y a propósito NO
//     todos con el mismo vínculo: dos empleados y uno que alquila, porque
//     el panel muestra cosas distintas según eso (ver más abajo).
//   · Pacientes, consultas repartidas en los últimos meses y citas de HOY
//     en cada consultorio, así el panel y la agenda tienen qué mostrar.
//   · Y lo que de verdad justifica una clínica: DOS PERSONAS ATENDIDAS EN
//     MÁS DE UN CONSULTORIO, una de ellas con una alergia cargada por un
//     médico y visible para el otro.
//
// ═══ POR QUÉ UNO ALQUILA Y LOS OTROS NO ════════════════════════════════════
//
// No es decoración. El administrador ve la facturación de los EMPLEADOS
// —esa plata es de la clínica— y del que alquila ve solamente que usó la
// sala, nunca cuánto cobró: esa plata no es de la clínica. Una demo donde
// todos son empleados muestra un panel que no existe.
//
// ═══ LO QUE ESTA DEMO NO PUEDE MOSTRAR, PORQUE NO EXISTE ═══════════════════
//
// El administrador no ve ni una consulta, ni un diagnóstico, ni un motivo.
// La agenda le dice CUÁNDO y CON QUIÉN, nunca POR QUÉ. Y del consultorio
// que alquila, la hora aparece ocupada y sin nombre. Si alguien pide ver
// "la historia clínica desde el panel", la respuesta es que no hay dónde
// pedirla, y es a propósito.
//
// Uso: node scripts/seed_clinica_demo.js [telefonoAdmin] ["Nombre clínica"] [password]
// Ej:  node scripts/seed_clinica_demo.js 79000000
//
// Es idempotente: no duplica la clínica ni los pacientes, y no le pisa la
// contraseña a ninguna cuenta que ya exista.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Clinica, PersonaClinica, Medico, Paciente, ConsultaMedica, Cita } = require("../db/models");
const { hashPassword } = require("../services/auth");

// ─── LOS CUATRO CONSULTORIOS ──────────────────────────────────────────────
const CONSULTORIOS = [
  {
    sufijo: 1, nombre: "Dra. Carla Mendoza", especialidad: "Medicina General",
    tipoEspecialidad: "medicina_general", vinculo: "empleado", consultorio: "Consultorio 1",
    pacientes: [
      { nombre: "Juan Pérez Quiroga", sexo: "M", nac: "1978-04-12", tel: "70011122" },
      { nombre: "Rosa Villarroel", sexo: "F", nac: "1965-09-30", tel: "70011123" },
      { nombre: "Marco Antonio Salazar", sexo: "M", nac: "1990-01-22", tel: "70011124" },
      { nombre: "Elena Choque", sexo: "F", nac: "1983-07-05", tel: "70011125" },
    ],
    motivos: ["Control de presión arterial", "Dolor lumbar de una semana", "Chequeo anual", "Cuadro gripal"],
  },
  {
    sufijo: 2, nombre: "Dr. Sergio Ledezma", especialidad: "Odontología",
    tipoEspecialidad: "odontologia", vinculo: "empleado", consultorio: "Consultorio 2",
    pacientes: [
      { nombre: "Juan Pérez Quiroga", sexo: "M", nac: "1978-04-12", tel: "70011122" }, // el mismo de arriba
      { nombre: "Patricia Nogales", sexo: "F", nac: "1995-11-18", tel: "70011126" },
      { nombre: "Luis Fernando Arce", sexo: "M", nac: "1972-02-14", tel: "70011127" },
    ],
    motivos: ["Dolor en molar inferior derecho", "Limpieza y control", "Revisión de conducto"],
  },
  {
    sufijo: 3, nombre: "Dra. Andrea Peñaranda", especialidad: "Ginecología",
    tipoEspecialidad: "ginecologia", vinculo: "alquila", consultorio: "Consultorio 3",
    pacientes: [
      { nombre: "Rosa Villarroel", sexo: "F", nac: "1965-09-30", tel: "70011123" }, // también la ve la clínica general
      { nombre: "Silvia Mamani", sexo: "F", nac: "1988-06-09", tel: "70011128" },
      { nombre: "Gabriela Ríos", sexo: "F", nac: "1993-03-27", tel: "70011129" },
    ],
    motivos: ["Control ginecológico anual", "Control prenatal", "Consulta por dolor pélvico"],
  },
  {
    sufijo: 4, nombre: "Dr. Iván Terceros", especialidad: "Pediatría",
    tipoEspecialidad: "pediatria", vinculo: "empleado", consultorio: "Consultorio 4",
    pacientes: [
      { nombre: "Mateo Salazar Choque", sexo: "M", nac: "2021-05-14", tel: "70011124" },
      { nombre: "Valentina Arce", sexo: "F", nac: "2019-10-02", tel: "70011127" },
      { nombre: "Emilia Nogales", sexo: "F", nac: "2023-08-21", tel: "70011126" },
    ],
    motivos: ["Control de niño sano", "Fiebre de dos días", "Control de vacunas"],
  },
];

// Las personas que se atienden en más de un consultorio. Es lo único que la
// clínica comparte de verdad, y la alergia es la única excepción clínica:
// dice qué NO darle a alguien, no qué tiene.
const COMPARTIDAS = [
  { nombre: "Juan Pérez Quiroga", documento: "4821566", alergias: ["Penicilina"] },
  { nombre: "Rosa Villarroel", documento: "3190847", alergias: [] },
];

function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

function hoyALas(hora, minuto = 0) {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  return d;
}

async function main() {
  const phoneAdmin = String(process.argv[2] || "79000000").trim();
  const nombreClinica = String(process.argv[3] || "Clínica Vitalis Demo").trim();
  const passwordDada = String(process.argv[4] || "").trim();
  const password = passwordDada || crypto.randomBytes(9).toString("base64url");

  if (!/^[0-9]{6,15}$/.test(phoneAdmin)) {
    console.error(`❌ "${phoneAdmin}" no parece un teléfono.`);
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  const hash = await hashPassword(password);
  let contrasenaNueva = false;

  // ─── LA CLÍNICA ─────────────────────────────────────────────────────────
  let clinica = await Clinica.findOne({ nombre: nombreClinica });
  if (!clinica) {
    clinica = await Clinica.create({ nombre: nombreClinica });
    console.log(`✅ Clínica creada: ${nombreClinica}`);
  } else {
    console.log(`ℹ️  La clínica "${nombreClinica}" ya existía.`);
  }

  // ─── EL ADMINISTRADOR ───────────────────────────────────────────────────
  let admin = await Medico.findOne({ phone: phoneAdmin });
  if (!admin) {
    admin = await Medico.create({
      phone: phoneAdmin, nombre: `Administración — ${nombreClinica}`,
      passwordHash: hash, activo: true, rol: "admin", clinicaId: clinica._id,
    });
    contrasenaNueva = true;
    console.log(`✅ Administrador: +${phoneAdmin}`);
  } else {
    // No se le pisa la contraseña a una cuenta que ya existe: alguien la
    // puede estar usando ahora mismo.
    admin.rol = "admin";
    admin.clinicaId = clinica._id;
    await admin.save();
    console.log(`ℹ️  +${phoneAdmin} ya existía — ahora administra "${nombreClinica}" (contraseña sin cambios).`);
  }

  // ─── LAS PERSONAS COMPARTIDAS ───────────────────────────────────────────
  const personaPorNombre = {};
  for (const p of COMPARTIDAS) {
    let persona = await PersonaClinica.findOne({ clinicaId: clinica._id, documento: p.documento });
    if (!persona) {
      persona = await PersonaClinica.create({
        clinicaId: clinica._id, nombre: p.nombre, documento: p.documento,
        alergias: p.alergias,
        alergiasActualizadasPor: p.alergias.length ? `7900000${CONSULTORIOS[0].sufijo}` : "",
        alergiasActualizadasEn: p.alergias.length ? hace(40) : null,
      });
    }
    personaPorNombre[p.nombre] = persona;
  }

  // ─── LOS CONSULTORIOS ───────────────────────────────────────────────────
  for (const c of CONSULTORIOS) {
    const phone = `7900000${c.sufijo}`;
    let medico = await Medico.findOne({ phone });
    if (!medico) {
      medico = await Medico.create({
        phone, nombre: c.nombre, passwordHash: hash, activo: true,
        especialidad: c.especialidad, tipoEspecialidad: c.tipoEspecialidad,
        rol: "medico", clinicaId: clinica._id, vinculo: c.vinculo, consultorio: c.consultorio,
      });
      contrasenaNueva = true;
    } else {
      medico.clinicaId = clinica._id;
      medico.vinculo = c.vinculo;
      medico.consultorio = c.consultorio;
      await medico.save();
    }

    // Si ya tiene pacientes, este consultorio ya se sembró: no se duplica.
    const yaTiene = await Paciente.countDocuments({ medicoPhone: phone });
    if (yaTiene) {
      console.log(`ℹ️  ${c.consultorio} — ${c.nombre}: ya tenía ${yaTiene} paciente(s), se deja como está.`);
      continue;
    }

    let nConsultas = 0;
    for (let i = 0; i < c.pacientes.length; i++) {
      const p = c.pacientes[i];
      const paciente = await Paciente.create({
        medicoPhone: phone, nombre: p.nombre, sexo: p.sexo,
        fechaNacimiento: new Date(p.nac), telefono: p.tel,
        // La ficha se vincula a la persona de la clínica SOLO cuando es una
        // de las compartidas. Vincular a ciegas fusionaría historias
        // clínicas de dos personas distintas, y eso no tiene vuelta atrás.
        personaId: personaPorNombre[p.nombre]?._id || null,
      });

      // Consultas repartidas en los últimos meses: algunas de este mes (para
      // que el panel muestre un número) y otras más atrás (para que el
      // gráfico de seis meses no sea una sola barra).
      for (const dias of [3, 12, 27, 48, 75]) {
        if (dias > 30 && i % 2) continue; // no todos tienen historia larga
        const fecha = hace(dias + i);
        const consulta = await ConsultaMedica.create({
          medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: p.nombre,
          estado: "completado", duracionSegundos: 480 + i * 60,
          transcripcionCompleta: `${c.motivos[i % c.motivos.length]}. Consulta de demostración.`,
          notaClinicaEstado: "completado",
        });
        // Mongoose pisa createdAt en cada save (por timestamps:true), así que
        // la fecha real se fija por debajo del ODM.
        await ConsultaMedica.collection.updateOne(
          { _id: consulta._id }, { $set: { createdAt: fecha, updatedAt: fecha } });
        nConsultas++;
      }

      // Una cita HOY por paciente, en horas distintas, para que la agenda
      // unificada y la ocupación por sala tengan algo que mostrar.
      await Cita.create({
        medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: p.nombre,
        pacienteTelefono: p.tel,
        fecha: hoyALas(8 + c.sufijo + i * 2, (c.sufijo * 10) % 60),
        duracionMinutos: 30, motivo: c.motivos[i % c.motivos.length],
        estado: "confirmada", origen: "manual",
      });
    }
    console.log(`✅ ${c.consultorio} — ${c.nombre} (+${phone}) · ${c.vinculo} · ${c.pacientes.length} paciente(s), ${nConsultas} consulta(s)`);
  }

  // ─── CÓMO ENTRAR ────────────────────────────────────────────────────────
  console.log(`\n🏥 ${nombreClinica}`);
  console.log(`   Panel de clínica:  +${phoneAdmin}`);
  for (const c of CONSULTORIOS) {
    console.log(`   ${c.consultorio.padEnd(14)}     +7900000${c.sufijo}  ${c.nombre} (${c.vinculo})`);
  }
  if (contrasenaNueva) {
    console.log(`\n   Contraseña${passwordDada ? "" : " generada"} para las cuentas NUEVAS: ${password}`);
    console.log("   Se muestra una sola vez. Anotala ahora.");
    console.log("   Son cuentas reales en un servidor real: si esto no es una demo, poneles otra.");
  }

  console.log("\nQué mirar en el panel del administrador:");
  console.log("  · La agenda de hoy con los cuatro consultorios juntos. Del Consultorio 3");
  console.log("    (alquila) la hora aparece ocupada y SIN nombre: esa relación no es de la clínica.");
  console.log("  · Juan Pérez Quiroga se atiende en el 1 y en el 2, y su alergia a la penicilina");
  console.log("    la cargó la Dra. Mendoza y la ve el Dr. Ledezma. Es exactamente el accidente");
  console.log("    que una clínica existe para evitar.");
  console.log("  · Rosa Villarroel se atiende en el 1 y en el 3.");
  console.log("  · Lo que NO vas a encontrar: una consulta, un diagnóstico, un motivo. El panel");
  console.log("    cuenta consultas, no las abre. Compartir identidad no es compartir historia.");

  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
