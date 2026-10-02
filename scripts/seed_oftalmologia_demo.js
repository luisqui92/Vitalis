// Symphomed Visión — Crea (o actualiza) una cuenta de oftalmología de demo
// con mapa ocular (varias estructuras con hallazgos, historial con
// fuente "voz"/"manual"), recetas ópticas, procedimientos (cirugía de
// catarata, láser...) y un Brief Clínico ya armado.
//
// Uso: node scripts/seed_oftalmologia_demo.js <telefono> ["Nombre completo"] [password]
// Ej:  node scripts/seed_oftalmologia_demo.js 78833001
//
// Es idempotente: si el médico ya existe no le toca la contraseña; si un
// paciente ya tiene un examen ocular con algún hallazgo cargado, lo saltea.
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, CatalogoTratamiento, TratamientoPlan, ExamenOcular, RecetaOptica, OJOS, ESTRUCTURAS_OCULARES } = require("../db/models");
const { hashPassword } = require("../services/auth");

const { CLAVE_DEMO } = require("./lib/claveDemo");
function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

const CATALOGO = [
  { nombre: "Cirugía de catarata (facoemulsificación)", precio: 4500 },
  { nombre: "Cirugía de pterigión", precio: 1800 },
  { nombre: "Tratamiento láser — retinopatía diabética", precio: 1200 },
  { nombre: "Inyección intravítrea", precio: 950 },
  { nombre: "Cirugía de glaucoma", precio: 5200 },
  { nombre: "Blefaroplastia", precio: 2600 },
];

// Estructura vacía (todo "normal") para las 12×2 estructuras — mismo
// patrón que el auto-create en routes/consultaMedica.js/examenOcular.js.
function estructurasVacias() {
  const arr = [];
  for (const ojo of OJOS) for (const estructura of ESTRUCTURAS_OCULARES) {
    arr.push({ ojo, estructura, estado: "normal", notas: "", historial: [] });
  }
  return arr;
}

const PACIENTES = [
  {
    nombre: "Esteban Rivas Colque", fechaNacimiento: "1951-03-08", sexo: "Masculino", telefono: "70144401",
    antecedentesPersonales: ["Diabetes tipo 2 de 12 años de evolución"],
    consulta: {
      motivoConsulta: "Control oftalmológico por diabetes, visión borrosa progresiva",
      sintomas: ["visión borrosa", "dificultad para leer de cerca"],
      antecedentesRelevantes: "Diabetes tipo 2 de 12 años, control glicémico irregular",
      diagnostico: "Catarata madura ojo derecho, retinopatía diabética leve ojo izquierdo",
      plan: "Programar cirugía de catarata OD, control de retinopatía en 6 meses",
      medicamentosRecetados: [], examenesSolicitados: ["OCT macular"], proximoControl: "Pre-quirúrgico en 2 semanas",
      transcripcionCompleta: "Doctor, cada vez veo más borroso del ojo derecho, ya casi no puedo leer. El cristalino derecho está bien opaco, cristalino con opacidad importante en el derecho. La retina del izquierdo tiene unos microaneurismas leves, vasos sanguíneos con alteración leve en el izquierdo. Vamos a programar la cirugía de catarata para el derecho.",
      duracionSegundos: 340,
    },
    hallazgos: [
      { ojo: "OD", estructura: "cristalino", estado: "importante", notas: "Opacidad importante, catarata madura" },
      { ojo: "OI", estructura: "vasos_sanguineos", estado: "leve", notas: "Microaneurismas leves compatibles con retinopatía diabética inicial" },
    ],
    tratamientos: [{ nombre: "Cirugía de catarata (facoemulsificación)", precio: 4500, diasAtras: 3, pagos: [1500] }],
    recetaOptica: { od: { esfera: -1.5, cilindro: -0.5, eje: 90 }, oi: { esfera: -1.0, cilindro: -0.25, eje: 85 }, distanciaPupilar: 62 },
  },
  {
    nombre: "Rosario Mendoza Callisaya", fechaNacimiento: "1965-09-21", sexo: "Femenino", telefono: "70144402",
    antecedentesPersonales: ["Glaucoma de ángulo abierto diagnosticado hace 4 años"],
    consulta: {
      motivoConsulta: "Control de glaucoma, presión intraocular",
      sintomas: [], antecedentesRelevantes: "Glaucoma de ángulo abierto en tratamiento con hipotensores",
      diagnostico: "Glaucoma de ángulo abierto con presión intraocular elevada pese a tratamiento",
      plan: "Ajustar hipotensor tópico, considerar cirugía si no responde en 1 mes",
      medicamentosRecetados: [{ nombre: "Latanoprost", dosis: "0.005%", frecuencia: "1 gota cada noche" }],
      examenesSolicitados: ["campo visual"], proximoControl: "En 1 mes",
      transcripcionCompleta: "Doctora, la presión sigue alta pese al tratamiento. El nervio óptico derecho tiene una excavación aumentada, nervio óptico con alteración moderada en el derecho. Vamos a cambiar la gota y pedir un campo visual de control.",
      duracionSegundos: 290,
    },
    hallazgos: [
      { ojo: "OD", estructura: "nervio_optico", estado: "moderado", notas: "Excavación aumentada, sospecha de progresión glaucomatosa" },
    ],
    tratamientos: [],
    recetaOptica: { od: { esfera: 0.5, cilindro: 0, eje: null }, oi: { esfera: 0.25, cilindro: 0, eje: null }, distanciaPupilar: 60 },
  },
  {
    nombre: "Marco Antonio Guzmán", fechaNacimiento: "1998-01-17", sexo: "Masculino", telefono: "70144403",
    antecedentesPersonales: [],
    consulta: {
      motivoConsulta: "Control de miopía, cambio de lentes",
      sintomas: ["visión borrosa de lejos"], antecedentesRelevantes: "Miopía diagnosticada en la adolescencia, uso de lentes desde los 15 años",
      diagnostico: "Progresión leve de miopía bilateral, resto del examen sin alteraciones",
      plan: "Actualizar receta óptica, control anual",
      medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 1 año",
      transcripcionCompleta: "Doctor, siento que veo un poco más borroso de lejos que el año pasado. El resto del examen está todo normal, córnea transparente en ambos, retina sin alteraciones en ambos. Vamos a actualizar la receta de lentes.",
      duracionSegundos: 210,
    },
    hallazgos: [],
    tratamientos: [],
    recetaOptica: { od: { esfera: -3.25, cilindro: -0.75, eje: 175 }, oi: { esfera: -3.5, cilindro: -0.5, eje: 5 }, distanciaPupilar: 64 },
  },
  {
    nombre: "Isabel Choque Ramírez", fechaNacimiento: "1958-06-30", sexo: "Femenino", telefono: "70144404",
    antecedentesPersonales: ["Pterigión ojo izquierdo diagnosticado hace 1 año"],
    consulta: {
      motivoConsulta: "Control de pterigión, molestia y enrojecimiento ocular",
      sintomas: ["ojo rojo", "sensación de cuerpo extraño"],
      antecedentesRelevantes: "Pterigión izquierdo en crecimiento lento, exposición solar frecuente por trabajo",
      diagnostico: "Pterigión izquierdo con crecimiento hacia el eje visual, indicación quirúrgica",
      plan: "Programar cirugía de pterigión, uso de lágrimas artificiales mientras tanto",
      medicamentosRecetados: [{ nombre: "Lágrimas artificiales", dosis: "sin conservantes", frecuencia: "cada 4 horas" }],
      examenesSolicitados: [], proximoControl: "Pre-quirúrgico en 3 semanas",
      transcripcionCompleta: "Doctor, cada vez me molesta más ese ojo izquierdo, se me pone rojo seguido. La conjuntiva del izquierdo tiene un pterigión que ya casi llega al borde de la pupila, conjuntiva con alteración moderada en el izquierdo. Ya está indicado operarlo.",
      duracionSegundos: 260,
    },
    hallazgos: [
      { ojo: "OI", estructura: "conjuntiva", estado: "moderado", notas: "Pterigión en crecimiento, se acerca al eje visual" },
    ],
    tratamientos: [{ nombre: "Cirugía de pterigión", precio: 1800, diasAtras: 0, pagos: [] }],
    recetaOptica: null,
  },
];

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "Dr. Ricardo Peñaranda").trim();
  const passwordGenerada = !process.argv[4];
  const password = String(process.argv[4] || CLAVE_DEMO).trim();
  if (!phone) {
    console.error('Uso: node scripts/seed_oftalmologia_demo.js <telefono> ["Nombre"] [password]');
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");

  let medico = await Medico.findOne({ phone });
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, especialidad: "Oftalmología", tipoEspecialidad: "oftalmologia",
      passwordHash: await hashPassword(password), activo: true,
    });
    console.log(`✅ Cuenta creada: ${nombre} (+${phone}) — contraseña${passwordGenerada ? " de prueba" : ""}: ${password}`);
  } else {
    console.log(`ℹ️  La cuenta +${phone} ya existía (${medico.nombre}). Contraseña sin cambios.`);
  }

  let catalogoCreados = 0;
  for (const item of CATALOGO) {
    const existe = await CatalogoTratamiento.findOne({ medicoPhone: phone, nombre: item.nombre });
    if (!existe) { await CatalogoTratamiento.create({ medicoPhone: phone, ...item }); catalogoCreados++; }
  }
  console.log(`✅ Catálogo: ${catalogoCreados} ítems nuevos`);

  let creados = 0, saltados = 0;
  for (const p of PACIENTES) {
    let paciente = await Paciente.findOne({ medicoPhone: phone, nombre: p.nombre });
    if (!paciente) {
      paciente = await Paciente.create({
        medicoPhone: phone, nombre: p.nombre, fechaNacimiento: new Date(p.fechaNacimiento),
        sexo: p.sexo, telefono: p.telefono, antecedentesPersonales: p.antecedentesPersonales,
      });
    }

    // Ojo con basar esto en "¿tiene algún hallazgo?" — un paciente con
    // examen normal (sin hallazgos a propósito, como Marco Antonio Guzmán)
    // nunca se detectaría como "ya cargado" y se duplicaría en cada
    // corrida. La cuenta de consultas es robusta para cualquier paciente.
    const yaCargado = await ConsultaMedica.countDocuments({ pacienteId: paciente._id }) > 0;
    if (yaCargado) {
      console.log(`⏭️  Ya tiene historia cargada: ${p.nombre} — salteado`);
      saltados++;
      continue;
    }
    let examen = await ExamenOcular.findOne({ pacienteId: paciente._id });
    if (!examen) examen = await ExamenOcular.create({ pacienteId: paciente._id, medicoPhone: phone, estructuras: estructurasVacias() });

    const consultaFecha = hace(5);
    const consulta = await ConsultaMedica.create({
      medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
      estado: "completado", duracionSegundos: p.consulta.duracionSegundos, transcripcionCompleta: p.consulta.transcripcionCompleta,
      segmentos: [{ hablante: "A", texto: p.consulta.transcripcionCompleta, inicioSeg: 0, finSeg: p.consulta.duracionSegundos }],
      notaClinicaEstado: "completado",
      notaClinica: {
        motivoConsulta: p.consulta.motivoConsulta, sintomas: p.consulta.sintomas, antecedentesRelevantes: p.consulta.antecedentesRelevantes,
        diagnostico: p.consulta.diagnostico, plan: p.consulta.plan, medicamentosRecetados: p.consulta.medicamentosRecetados,
        examenesSolicitados: p.consulta.examenesSolicitados, proximoControl: p.consulta.proximoControl,
      },
    });
    // Mongoose pisa createdAt/updatedAt en CADA .save() (por el
    // {timestamps:true} del schema) — un update directo a la colección
    // (sin pasar por los hooks) es la única forma confiable de dejar la
    // fecha vieja de verdad.
    await ConsultaMedica.collection.updateOne({ _id: consulta._id }, { $set: { createdAt: consultaFecha, updatedAt: consultaFecha } });

    for (const h of p.hallazgos) {
      const item = examen.estructuras.find(e => e.ojo === h.ojo && e.estructura === h.estructura);
      item.estado = h.estado;
      item.notas = h.notas;
      item.historial.push({ fecha: consultaFecha, estado: h.estado, notas: h.notas, fuente: "voz", consultaId: consulta._id });
    }
    await examen.save();

    for (const m of p.consulta.medicamentosRecetados) {
      await Medicamento.create({ pacienteId: paciente._id, medicoPhone: phone, nombre: m.nombre, dosis: m.dosis, frecuencia: m.frecuencia, fechaInicio: consultaFecha });
    }

    for (const t of p.tratamientos) {
      const totalPagado = t.pagos.reduce((s, m) => s + m, 0);
      await TratamientoPlan.create({
        pacienteId: paciente._id, medicoPhone: phone, nombre: t.nombre, precio: t.precio,
        estado: totalPagado >= t.precio && t.precio > 0 ? "realizado" : totalPagado > 0 ? "en_proceso" : "pendiente",
        pagos: t.pagos.map((monto, i) => ({ monto, fecha: hace(t.diasAtras - i) })),
      });
    }

    if (p.recetaOptica) {
      await RecetaOptica.create({
        pacienteId: paciente._id, medicoPhone: phone, consultaId: consulta._id,
        od: p.recetaOptica.od, oi: p.recetaOptica.oi, distanciaPupilar: p.recetaOptica.distanciaPupilar, fecha: consultaFecha,
      });
    }

    paciente.briefClinicoEstado = "completado";
    paciente.briefClinicoActualizadoEn = new Date();
    paciente.briefClinico = {
      estadoActual: p.consulta.diagnostico || null,
      cambiosDesdeUltimaConsulta: null,
      medicamentosActivos: p.consulta.medicamentosRecetados.map(m => `${m.nombre} ${m.dosis}`.trim()),
      examenesPendientes: p.consulta.examenesSolicitados,
      alertas: p.hallazgos.filter(h => h.estado === "importante" || h.estado === "moderado").map(h => `${h.ojo} — ${h.estructura}: ${h.notas}`),
      factoresRiesgo: p.antecedentesPersonales,
      preguntasSugeridas: [],
      diagnosticosDiferenciales: [],
    };
    await paciente.save();

    console.log(`✅ Paciente listo: ${p.nombre} (${p.hallazgos.length} hallazgos oculares, ${p.tratamientos.length} procedimientos)`);
    creados++;
  }

  console.log(`\nListo. ${creados} pacientes cargados, ${saltados} ya tenían mapa ocular y se saltearon.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
