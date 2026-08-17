// Vitalis Veterinaria — Crea (o actualiza) una cuenta de veterinaria de
// demo con mascotas (especie/raza/dueño), vacunas, medicación, evolución
// de peso y un Brief Clínico ya armado.
//
// Uso: node scripts/seed_veterinaria_demo.js <telefono> ["Nombre completo"] [password]
// Ej:  node scripts/seed_veterinaria_demo.js 78844001
//
// Es idempotente: si el médico ya existe no le toca la contraseña; si una
// mascota ya tiene más de una consulta cargada, la saltea.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, Vacuna, Medicion, Receta } = require("../db/models");
const { hashPassword } = require("../services/auth");

function hace(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d;
}

const MASCOTAS = [
  {
    nombre: "Firulais", especie: "Perro", raza: "Labrador", fechaNacimiento: "2021-06-15", sexo: "Macho",
    duenoNombre: "Marco Antonio Vargas", telefono: "70155501",
    antecedentesPersonales: [],
    consultas: [
      { mesesAtras: 5, motivoConsulta: "Control anual y refuerzo de vacunas", sintomas: [], diagnostico: "Perro sano, apto para vacunación", plan: "Refuerzo de vacuna óctuple, desparasitación", medicamentosRecetados: [], proximoControl: "En 12 meses", transcripcionCompleta: "Buenas, vengo a que le pongan el refuerzo anual a mi perro Firulais. Está comiendo bien, activo, sin ningún problema. Vamos a aplicar la vacuna óctuple y desparasitarlo también.", duracionSegundos: 200 },
      { mesesAtras: 1, motivoConsulta: "Cojera leve en pata trasera derecha después de jugar", sintomas: ["cojera leve", "dolor a la palpación"], diagnostico: "Esguince leve de rodilla derecha", plan: "Reposo relativo 1 semana, antiinflamatorio", medicamentosRecetados: [{ nombre: "Meloxicam", dosis: "según peso", frecuencia: "1 vez al día por 5 días" }], proximoControl: "En 1 semana si no mejora", transcripcionCompleta: "Doctora, desde ayer que jugó en el parque está cojeando de la pata trasera derecha. Al palpar la rodilla se queja un poco, parece un esguince leve. Vamos a darle reposo y un antiinflamatorio.", duracionSegundos: 240 },
    ],
    medicamentos: [{ nombre: "Meloxicam", dosis: "según peso", frecuencia: "1 vez al día por 5 días", mesesInicio: 1, mesesFin: 1 }],
    vacunas: [{ nombre: "Óctuple canina", dosis: "Refuerzo anual", mesesAtras: 5 }, { nombre: "Antirrábica", dosis: "Refuerzo anual", mesesAtras: 5 }],
    pesos: [{ valor: 28, mesesAtras: 5 }, { valor: 29.5, mesesAtras: 1 }],
  },
  {
    nombre: "Michi", especie: "Gato", raza: "Común europeo", fechaNacimiento: "2019-03-10", sexo: "Hembra",
    duenoNombre: "Daniela Fernández Rocha", telefono: "70155502",
    antecedentesPersonales: ["Esterilizada"],
    consultas: [
      { mesesAtras: 6, motivoConsulta: "Control y vacuna triple felina", sintomas: [], diagnostico: "Gata sana", plan: "Aplicar triple felina, control de peso", medicamentosRecetados: [], proximoControl: "En 12 meses", transcripcionCompleta: "Vengo a ponerle la vacuna a mi gata Michi, está comiendo bien y activa. Vamos a aplicar la triple felina y revisar el peso, está un poquito pasada pero nada preocupante.", duracionSegundos: 190 },
      { mesesAtras: 2, motivoConsulta: "Vómitos ocasionales y poco apetito", sintomas: ["vómitos ocasionales", "hiporexia"], diagnostico: "Gastritis leve, probable relacionada a bolas de pelo", plan: "Dieta blanda 3 días, pasta para bolas de pelo, control si persiste", medicamentosRecetados: [{ nombre: "Malta para gatos", dosis: "1 cm", frecuencia: "cada 2 días" }], proximoControl: "En 2 semanas si persiste", transcripcionCompleta: "Doctora, Michi ha estado vomitando de a poco y come menos que antes. Puede ser por bolas de pelo, vamos a darle una pasta para eso y una dieta blanda unos días a ver cómo evoluciona.", duracionSegundos: 260 },
    ],
    medicamentos: [{ nombre: "Malta para gatos", dosis: "1 cm", frecuencia: "cada 2 días", mesesInicio: 2, mesesFin: null }],
    vacunas: [{ nombre: "Triple felina", dosis: "Refuerzo anual", mesesAtras: 6 }, { nombre: "Antirrábica", dosis: "Refuerzo anual", mesesAtras: 6 }],
    pesos: [{ valor: 5.2, mesesAtras: 6 }, { valor: 4.9, mesesAtras: 2 }],
  },
  {
    nombre: "Rocky", especie: "Perro", raza: "Pitbull", fechaNacimiento: "2023-01-20", sexo: "Macho",
    duenoNombre: "Jorge Luis Mamani", telefono: "70155503",
    antecedentesPersonales: [],
    consultas: [
      { mesesAtras: 3, motivoConsulta: "Primer esquema de vacunación, cachorro", sintomas: [], diagnostico: "Cachorro sano, apto para iniciar esquema", plan: "Primera dosis óctuple, desparasitación, control en 21 días", medicamentosRecetados: [], proximoControl: "En 21 días", transcripcionCompleta: "Hola doctora, es la primera vez que traigo a mi cachorro Rocky, tiene 2 meses. Vamos a empezar el esquema de vacunas y desparasitarlo. Se ve muy sano y activo.", duracionSegundos: 220 },
      { mesesAtras: 2, motivoConsulta: "Segunda dosis de vacuna, control de peso", sintomas: [], diagnostico: "Buen desarrollo, curva de peso adecuada", plan: "Segunda dosis óctuple, continuar esquema", medicamentosRecetados: [], proximoControl: "En 21 días", transcripcionCompleta: "Doctora, Rocky sigue creciendo bien, come con ganas. Vamos con la segunda dosis de la vacuna, todo va según el calendario.", duracionSegundos: 180 },
    ],
    medicamentos: [],
    vacunas: [{ nombre: "Óctuple canina", dosis: "1ra dosis", mesesAtras: 3 }, { nombre: "Óctuple canina", dosis: "2da dosis", mesesAtras: 2 }],
    pesos: [{ valor: 6.5, mesesAtras: 3 }, { valor: 11.2, mesesAtras: 2 }],
  },
  {
    nombre: "Luna", especie: "Gato", raza: "Siamés", fechaNacimiento: "2016-08-05", sexo: "Hembra",
    duenoNombre: "Patricia Villca Suárez", telefono: "70155504",
    antecedentesPersonales: ["Enfermedad renal crónica en estadio inicial"],
    consultas: [
      { mesesAtras: 4, motivoConsulta: "Control de enfermedad renal crónica", sintomas: ["poliuria", "polidipsia leve"], diagnostico: "Enfermedad renal crónica estadio 2, estable", plan: "Dieta renal específica, control de creatinina en 3 meses", medicamentosRecetados: [], proximoControl: "En 3 meses", transcripcionCompleta: "Doctora, Luna sigue tomando bastante agua como le comentamos la vez pasada. Los valores de riñón están estables por ahora. Vamos a mantenerla con la dieta renal y controlar de nuevo en 3 meses.", duracionSegundos: 280 },
      { mesesAtras: 1, motivoConsulta: "Control con resultado de laboratorio", sintomas: [], diagnostico: "Enfermedad renal crónica estadio 2, función renal estable", plan: "Continuar dieta renal, control en 3 meses", medicamentosRecetados: [], proximoControl: "En 3 meses", transcripcionCompleta: "Doctora, el laboratorio salió parecido al anterior, la creatinina se mantiene estable. Vamos a seguir igual con la dieta renal.", duracionSegundos: 200 },
    ],
    medicamentos: [],
    vacunas: [{ nombre: "Triple felina", dosis: "Refuerzo anual", mesesAtras: 7 }],
    pesos: [{ valor: 3.8, mesesAtras: 4 }, { valor: 3.6, mesesAtras: 1 }],
  },
];

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "Dra. Fabiola Terrazas").trim();
  const passwordGenerada = !process.argv[4];
  const password = String(process.argv[4] || crypto.randomBytes(9).toString("base64url")).trim();
  if (!phone) {
    console.error('Uso: node scripts/seed_veterinaria_demo.js <telefono> ["Nombre"] [password]');
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");

  let medico = await Medico.findOne({ phone });
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, especialidad: "Medicina veterinaria general", tipoEspecialidad: "veterinaria",
      passwordHash: await hashPassword(password), activo: true,
    });
    console.log(`✅ Cuenta creada: ${nombre} (+${phone}) — contraseña${passwordGenerada ? " generada" : ""}: ${password}`);
  } else {
    console.log(`ℹ️  La cuenta +${phone} ya existía (${medico.nombre}). Contraseña sin cambios.`);
  }

  let creados = 0, saltados = 0;
  for (const m of MASCOTAS) {
    let paciente = await Paciente.findOne({ medicoPhone: phone, nombre: m.nombre, especie: m.especie });
    if (!paciente) {
      paciente = await Paciente.create({
        medicoPhone: phone, nombre: m.nombre, especie: m.especie, raza: m.raza,
        fechaNacimiento: new Date(m.fechaNacimiento), sexo: m.sexo, duenoNombre: m.duenoNombre,
        telefono: m.telefono, antecedentesPersonales: m.antecedentesPersonales,
      });
    }

    const consultasActuales = await ConsultaMedica.countDocuments({ pacienteId: paciente._id });
    if (consultasActuales > 0) {
      console.log(`⏭️  Ya tiene historia cargada: ${m.nombre} — salteado`);
      saltados++;
      continue;
    }

    for (const c of m.consultas) {
      const fecha = hace(c.mesesAtras);
      const consulta = await ConsultaMedica.create({
        medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
        estado: "completado", duracionSegundos: c.duracionSegundos, transcripcionCompleta: c.transcripcionCompleta,
        segmentos: [{ hablante: "A", texto: c.transcripcionCompleta, inicioSeg: 0, finSeg: c.duracionSegundos }],
        notaClinicaEstado: "completado",
        notaClinica: {
          motivoConsulta: c.motivoConsulta, sintomas: c.sintomas, diagnostico: c.diagnostico,
          plan: c.plan, medicamentosRecetados: c.medicamentosRecetados, proximoControl: c.proximoControl,
        },
      });
      // Mongoose pisa createdAt/updatedAt en CADA .save() (por el
      // {timestamps:true} del schema) — un update directo a la colección
      // (sin pasar por los hooks) es la única forma confiable de dejar la
      // fecha vieja de verdad.
      await ConsultaMedica.collection.updateOne({ _id: consulta._id }, { $set: { createdAt: fecha, updatedAt: fecha } });
    }

    for (const med of m.medicamentos) {
      await Medicamento.create({ pacienteId: paciente._id, medicoPhone: phone, nombre: med.nombre, dosis: med.dosis, frecuencia: med.frecuencia, fechaInicio: hace(med.mesesInicio), fechaFin: med.mesesFin != null ? hace(med.mesesFin) : null });
    }
    for (const v of m.vacunas) {
      await Vacuna.create({ pacienteId: paciente._id, medicoPhone: phone, nombre: v.nombre, dosis: v.dosis, fecha: hace(v.mesesAtras) });
    }
    for (const p of m.pesos) {
      await Medicion.create({ pacienteId: paciente._id, medicoPhone: phone, tipo: "peso", valor: p.valor, fecha: hace(p.mesesAtras) });
    }

    const ultimaConsulta = m.consultas[m.consultas.length - 1];
    if (ultimaConsulta.medicamentosRecetados.length) {
      await Receta.create({
        pacienteId: paciente._id, medicoPhone: phone, medicamentos: ultimaConsulta.medicamentosRecetados.map(x => ({ ...x, duracion: "" })),
        indicaciones: ultimaConsulta.plan, fecha: hace(ultimaConsulta.mesesAtras),
      });
    }

    paciente.briefClinicoEstado = "completado";
    paciente.briefClinicoActualizadoEn = new Date();
    paciente.briefClinico = {
      estadoActual: ultimaConsulta.diagnostico || null,
      cambiosDesdeUltimaConsulta: m.consultas.length > 1 ? "Evolución favorable respecto al control anterior." : null,
      medicamentosActivos: m.medicamentos.filter(x => x.mesesFin == null).map(x => `${x.nombre} ${x.dosis}`.trim()),
      examenesPendientes: [],
      alertas: [],
      factoresRiesgo: m.antecedentesPersonales,
      preguntasSugeridas: [],
      diagnosticosDiferenciales: [],
    };
    await paciente.save();

    console.log(`✅ Mascota lista: ${m.nombre} (${m.especie}, dueño: ${m.duenoNombre}) — ${m.consultas.length} consultas`);
    creados++;
  }

  console.log(`\nListo. ${creados} mascotas cargadas, ${saltados} ya tenían historia y se saltearon.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
