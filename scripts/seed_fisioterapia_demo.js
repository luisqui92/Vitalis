// Symphomed Fisioterapia — Crea (o actualiza) una cuenta de kinesiología de
// demo con 5 pacientes en distintos momentos del tratamiento.
//
// La demo está armada para que se vean las cosas que Symphomed hace y una
// planilla no:
//
//  · EL LADO BIEN ANOTADO. Mirando a alguien de frente su hombro derecho está
//    a la izquierda de quien mira, y Symphomed lo deduce solo. Marcelo tiene
//    el hombro DERECHO congelado y en la ficha dice derecho.
//  · LA GONIOMETRÍA CONTRA LA REFERENCIA. 95° de flexión de hombro no dicen
//    nada solos; contra los 180° de referencia dicen que está en la mitad.
//  · LA AYUDA QUE BAJA. Rosa pasó de necesitar que la tomen de la mano a
//    subir escalones sola. El porcentaje ayuda, pero lo que se está midiendo
//    es eso.
//  · EL CASO INCÓMODO. Diego bajó la ayuda PERO le subió el dolor. Symphomed
//    lo dice en pantalla en vez de mostrarlo como un avance: probablemente
//    esté compensando.
//  · UNA BANDERA ROJA. Norma tiene dolor nocturno que no cede y antecedente
//    oncológico — eso se deriva, no se trata, y aparece arriba de todo.
//
// Uso: node scripts/seed_fisioterapia_demo.js <telefono> ["Nombre"] [password]
// Ej:  node scripts/seed_fisioterapia_demo.js 78811007
//      node scripts/seed_fisioterapia_demo.js 78811007 --borrar
//
// Es idempotente: si el profesional ya existe no le toca la contraseña, y si
// un paciente ya tiene evaluación cargada, lo saltea.
const path = require("path");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const {
  Medico, Paciente, EvaluacionFisio, MedicionFisio, ObjetivoFisio,
  TratamientoPlan, Recordatorio,
} = require("../db/models");
const { hashPassword } = require("../services/auth");
const { siguienteCodigo } = require("../services/codigos");

const DIA = 24 * 60 * 60 * 1000;
const haceDias = (d) => new Date(Date.now() - d * DIA);
function nacimientoHace(años) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - años);
  return d;
}

// ─── LOS PACIENTES ────────────────────────────────────────────────────────
// Cinco cuadros distintos a propósito: si todos fueran "lumbalgia" la demo no
// mostraría nada de lo que el módulo sabe hacer.
const PACIENTES = [
  {
    nombre: "Marcelo Arandia Vaca",
    edad: 54, sexo: "Masculino", telefono: "59177845612",
    evaluacion: {
      motivo: "No puede levantar el brazo derecho para alcanzar el estante",
      mecanismo: "Empezó de a poco, sin golpe. Tres meses de evolución.",
      desdeDias: 95,
      notas: "Capsulitis adhesiva. Diabético, controlado.",
    },
    // El hombro DERECHO. De frente, eso se marca a la IZQUIERDA de la pantalla.
    dolor: [
      { region: "hombro", lado: "derecho", vista: "frente", x: 30, y: 19, intensidad: 6, tipo: "mecanico",
        notas: "Al elevar por encima del hombro" },
    ],
    // La flexión mejora de 70 a 95 sobre 180 de referencia: se ve el avance
    // y se ve que todavía falta la mitad.
    goniometria: [
      { zona: "hombro", movimiento: "flexion", lado: "derecho", valor: 70, dias: 60 },
      { zona: "hombro", movimiento: "flexion", lado: "derecho", valor: 82, dias: 30 },
      { zona: "hombro", movimiento: "flexion", lado: "derecho", valor: 95, dias: 3 },
      { zona: "hombro", movimiento: "abduccion", lado: "derecho", valor: 88, dias: 3 },
      { zona: "hombro", movimiento: "rotacion_externa", lado: "derecho", valor: 25, dias: 3 },
      // El lado sano, para comparar. Es lo que hace un kinesiólogo de verdad.
      { zona: "hombro", movimiento: "flexion", lado: "izquierdo", valor: 175, dias: 3 },
    ],
    objetivos: [
      {
        titulo: "Alcanza el estante de arriba de la cocina",
        area: "funcional",
        criterio: "10 alcances por encima de la cabeza, sin compensar con el tronco",
        sesiones: [
          { intentos: 10, logros: 2, ayuda: "fisica_parcial", dolor: 7, dias: 56 },
          { intentos: 10, logros: 4, ayuda: "fisica_parcial", dolor: 6, dias: 42 },
          { intentos: 10, logros: 6, ayuda: "gestual", dolor: 5, dias: 28 },
          { intentos: 10, logros: 7, ayuda: "verbal", dolor: 4, dias: 14 },
          { intentos: 10, logros: 8, ayuda: "independiente", dolor: 3, dias: 3 },
        ],
      },
    ],
  },

  {
    nombre: "Rosa Mamani Choque",
    edad: 71, sexo: "Femenino", telefono: "59176112233",
    evaluacion: {
      motivo: "Después de la prótesis de cadera no puede subir sola al micro",
      mecanismo: "Prótesis total de cadera izquierda hace 2 meses, por artrosis.",
      desdeDias: 62,
      notas: "Vive sola en un primer piso sin ascensor. Ese es el objetivo real.",
    },
    dolor: [
      { region: "cadera", lado: "izquierdo", vista: "frente", x: 41, y: 46, intensidad: 3, tipo: "mecanico",
        notas: "Solo al final del día" },
    ],
    goniometria: [
      { zona: "cadera", movimiento: "flexion", lado: "izquierdo", valor: 75, dias: 45 },
      { zona: "cadera", movimiento: "flexion", lado: "izquierdo", valor: 95, dias: 20 },
      { zona: "cadera", movimiento: "flexion", lado: "izquierdo", valor: 108, dias: 2 },
      { zona: "cadera", movimiento: "abduccion", lado: "izquierdo", valor: 32, dias: 2 },
      { zona: "rodilla", movimiento: "extension", lado: "izquierdo", valor: 0, dias: 2 },
    ],
    objetivos: [
      {
        // El caso que mejor muestra para qué sirve la escala de ayuda: el
        // porcentaje casi no se movió, pero pasó de la mano a sola.
        titulo: "Sube un piso de escalera sin baranda",
        area: "marcha",
        criterio: "10 escalones alternando pies, sin apoyo de manos",
        sesiones: [
          { intentos: 10, logros: 6, ayuda: "fisica_total", dolor: 4, dias: 50 },
          { intentos: 10, logros: 6, ayuda: "fisica_parcial", dolor: 3, dias: 38 },
          { intentos: 10, logros: 7, ayuda: "gestual", dolor: 3, dias: 24 },
          { intentos: 10, logros: 7, ayuda: "verbal", dolor: 2, dias: 12 },
          { intentos: 10, logros: 8, ayuda: "independiente", dolor: 2, dias: 2 },
        ],
      },
      {
        titulo: "Se levanta de la silla sin usar los brazos",
        area: "fuerza",
        criterio: "5 repeticiones seguidas desde silla de altura estándar",
        sesiones: [
          { intentos: 5, logros: 1, ayuda: "fisica_parcial", dolor: 3, dias: 38 },
          { intentos: 5, logros: 3, ayuda: "verbal", dolor: 2, dias: 20 },
          { intentos: 5, logros: 5, ayuda: "independiente", dolor: 1, dias: 2 },
        ],
        estado: "logrado",
      },
    ],
  },

  {
    nombre: "Diego Villarroel Peña",
    edad: 28, sexo: "Masculino", telefono: "59179556677",
    evaluacion: {
      motivo: "Dolor lumbar que vuelve cada vez que retoma el gimnasio",
      mecanismo: "Levantó peso girando el tronco. Tercera recaída en un año.",
      desdeDias: 40,
      notas: "Trabaja 9 horas sentado. Quiere volver a levantar pesas.",
    },
    dolor: [
      { region: "lumbar", lado: "central", vista: "espalda", x: 50, y: 36, intensidad: 5, tipo: "mecanico",
        notas: "Cede acostado, aparece al estar parado" },
      { region: "muslo", lado: "derecho", vista: "espalda", x: 43, y: 56, intensidad: 3, tipo: "referido",
        notas: "Irradia hasta la mitad del muslo, no pasa la rodilla" },
    ],
    goniometria: [
      { zona: "lumbar", movimiento: "flexion", lado: "central", valor: 38, dias: 30 },
      { zona: "lumbar", movimiento: "flexion", lado: "central", valor: 48, dias: 5 },
      { zona: "lumbar", movimiento: "extension", lado: "central", valor: 15, dias: 5 },
      { zona: "cadera", movimiento: "flexion", lado: "derecho", valor: 95, dias: 5 },
    ],
    objetivos: [
      {
        // ═══ EL CASO INCÓMODO ═════════════════════════════════════════════
        // Bajó la ayuda, subió el dolor. En dos gráficos separados esto se
        // lee como un avance. Junto, Symphomed lo marca: probablemente esté
        // compensando, y darlo por logrado sería un error.
        titulo: "Levanta una caja de 10 kg del piso sin dolor",
        area: "funcional",
        criterio: "5 levantadas con técnica correcta, dolor 0-2",
        sesiones: [
          { intentos: 5, logros: 1, ayuda: "fisica_parcial", dolor: 2, dias: 35 },
          { intentos: 5, logros: 3, ayuda: "gestual", dolor: 4, dias: 21 },
          { intentos: 5, logros: 4, ayuda: "verbal", dolor: 5, dias: 12 },
          { intentos: 5, logros: 5, ayuda: "independiente", dolor: 6, dias: 4 },
        ],
      },
    ],
  },

  {
    nombre: "Norma Gutiérrez Loayza",
    edad: 63, sexo: "Femenino", telefono: "59177334455",
    evaluacion: {
      motivo: "Dolor dorsal que la despierta de noche",
      mecanismo: "Sin traumatismo. Dos meses, en aumento.",
      desdeDias: 58,
      // ═══ LO QUE NO SE TRATA ═══════════════════════════════════════════
      // Dolor nocturno que no cede + antecedente oncológico + pérdida de
      // peso. Esto se deriva. El módulo lo pone arriba de todo y en rojo.
      banderasRojas: ["dolor_nocturno_no_cede", "antecedente_oncologico", "perdida_peso_inexplicada"],
      notas: "DERIVADA a su oncólogo el mismo día. No se inició tratamiento kinésico.",
    },
    dolor: [
      { region: "dorsal", lado: "central", vista: "espalda", x: 50, y: 26, intensidad: 8, tipo: "sin_clasificar",
        notas: "No cambia con la posición. La despierta a las 3 de la mañana." },
    ],
    goniometria: [],
    objetivos: [],
  },

  {
    nombre: "Kevin Salazar Ortiz",
    edad: 19, sexo: "Masculino", telefono: "59178990011",
    evaluacion: {
      motivo: "Esguince de tobillo jugando fútbol, quiere volver a jugar",
      mecanismo: "Se dobló el tobillo cayendo de un salto. Grado II.",
      desdeDias: 21,
      notas: "Deportista. El riesgo es que vuelva antes de tiempo.",
    },
    dolor: [
      { region: "tobillo", lado: "izquierdo", vista: "frente", x: 58, y: 87, intensidad: 4, tipo: "inflamatorio",
        notas: "Al apoyar en terreno irregular" },
    ],
    goniometria: [
      { zona: "tobillo", movimiento: "flexion_dorsal", lado: "izquierdo", valor: 8, dias: 18 },
      { zona: "tobillo", movimiento: "flexion_dorsal", lado: "izquierdo", valor: 14, dias: 8 },
      { zona: "tobillo", movimiento: "flexion_dorsal", lado: "izquierdo", valor: 18, dias: 1 },
      { zona: "tobillo", movimiento: "flexion_dorsal", lado: "derecho", valor: 20, dias: 1 },
      { zona: "tobillo", movimiento: "inversion", lado: "izquierdo", valor: 22, dias: 1 },
    ],
    objetivos: [
      {
        titulo: "Se para en un pie 30 segundos con los ojos cerrados",
        area: "equilibrio",
        criterio: "3 intentos de 30 segundos sin apoyar el otro pie",
        sesiones: [
          { intentos: 3, logros: 0, ayuda: "fisica_parcial", dolor: 3, dias: 15 },
          { intentos: 3, logros: 1, ayuda: "gestual", dolor: 2, dias: 8 },
          { intentos: 3, logros: 2, ayuda: "independiente", dolor: 1, dias: 1 },
        ],
      },
    ],
  },
];

function avisarSiEsDebil(phone, password) {
  const debil = phone.replace(/\D/g, "").length < 7
    || password.length < 12
    || /symphomed|demo|1234|password|admin/i.test(password);
  if (!debil) return;
  console.log("");
  console.log("  ⚠️  ESTA CUENTA ES DE DEMOSTRACIÓN, NO LA DEJES EN PRODUCCIÓN");
  console.log("");
  console.log(`      "${phone}" con una contraseña adivinable es una credencial válida`);
  console.log("      mientras exista, en el mismo servidor donde están las historias");
  console.log("      clínicas reales. Sirve para mostrar Symphomed y para nada más.");
  console.log("");
  console.log(`      Cuando termines la demostración:  node ${path.basename(__filename)} ${phone} --borrar`);
  console.log("");
}

async function borrarTodo(phone) {
  const pacientes = await Paciente.find({ medicoPhone: phone }).select("_id nombre").lean();
  const ids = pacientes.map(p => p._id);
  const borrados = await Promise.all([
    EvaluacionFisio.deleteMany({ medicoPhone: phone }),
    MedicionFisio.deleteMany({ medicoPhone: phone }),
    ObjetivoFisio.deleteMany({ medicoPhone: phone }),
    TratamientoPlan.deleteMany({ medicoPhone: phone }),
    Recordatorio.deleteMany({ medicoPhone: phone }),
    Paciente.deleteMany({ _id: { $in: ids } }),
  ]);
  await Medico.deleteOne({ phone });
  console.log(`\n  Borrado: ${pacientes.length} paciente(s) y la cuenta ${phone}.`);
  console.log(`  Evaluaciones ${borrados[0].deletedCount} · mediciones ${borrados[1].deletedCount} · objetivos ${borrados[2].deletedCount}\n`);
}

(async () => {
  const phone = process.argv[2];
  if (!phone) {
    console.error("\n  Falta el teléfono.\n  Uso: node scripts/seed_fisioterapia_demo.js <telefono> [\"Nombre\"] [password]\n");
    process.exit(1);
  }
  await mongoose.connect(CONFIG.MONGODB_URI);

  if (process.argv.includes("--borrar")) {
    await borrarTodo(phone);
    await mongoose.disconnect();
    return;
  }

  const nombre = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "Lic. Fernanda Zeballos";
  const password = process.argv[4] || "Symphomed123";

  let medico = await Medico.findOne({ phone });
  if (medico) {
    // No se le pisa la contraseña a una cuenta que ya existe: puede ser la
    // de alguien que la está usando de verdad.
    medico.tipoEspecialidad = "fisioterapia";
    medico.especialidad = "Kinesiología y fisioterapia";
    await medico.save();
    console.log(`\n  Cuenta ${phone} ya existía — se ajustó la especialidad, la contraseña quedó como estaba.`);
  } else {
    medico = await Medico.create({
      phone, nombre,
      especialidad: "Kinesiología y fisioterapia",
      tipoEspecialidad: "fisioterapia",
      passwordHash: await hashPassword(password),
      activo: true,
    });
    console.log(`\n  Cuenta creada: ${nombre} (${phone})`);
  }

  let creados = 0;
  for (const p of PACIENTES) {
    let ficha = await Paciente.findOne({ medicoPhone: phone, nombre: p.nombre });
    if (!ficha) {
      ficha = await Paciente.create({
        nombre: p.nombre, medicoPhone: phone,
        codigo: await siguienteCodigo(Paciente, phone),
        fechaNacimiento: nacimientoHace(p.edad),
        sexo: p.sexo, telefono: p.telefono,
      });
      creados++;
    }

    if (await EvaluacionFisio.findOne({ pacienteId: ficha._id })) {
      console.log(`   · ${p.nombre} — ya tenía evaluación, se saltea`);
      continue;
    }

    await EvaluacionFisio.create({
      pacienteId: ficha._id, medicoPhone: phone,
      motivo: p.evaluacion.motivo,
      mecanismo: p.evaluacion.mecanismo,
      desde: haceDias(p.evaluacion.desdeDias),
      banderasRojas: p.evaluacion.banderasRojas || [],
      notas: p.evaluacion.notas || "",
      puntosDolor: p.dolor.map(d => ({
        region: d.region, lado: d.lado, vista: d.vista,
        x: d.x, y: d.y, intensidad: d.intensidad, tipo: d.tipo, notas: d.notas || "",
      })),
    });

    // Cada punto del mapa arranca su serie de tiempo, igual que cuando lo
    // marca una persona desde la pantalla.
    for (const d of p.dolor) {
      await MedicionFisio.create({
        pacienteId: ficha._id, medicoPhone: phone,
        clase: "dolor", zona: d.region, lado: d.lado, valor: d.intensidad, fecha: haceDias(1),
      });
    }

    for (const g of p.goniometria) {
      await MedicionFisio.create({
        pacienteId: ficha._id, medicoPhone: phone,
        clase: "goniometria", zona: g.zona, movimiento: g.movimiento, lado: g.lado,
        valor: g.valor, fecha: haceDias(g.dias),
      });
    }

    for (const o of p.objetivos) {
      await ObjetivoFisio.create({
        pacienteId: ficha._id, medicoPhone: phone,
        titulo: o.titulo, area: o.area, criterio: o.criterio,
        estado: o.estado || "activo",
        fechaInicio: haceDias(o.sesiones.length ? o.sesiones[0].dias + 5 : 30),
        fechaCierre: o.estado && o.estado !== "activo" ? haceDias(1) : null,
        progreso: o.sesiones.map(s => ({
          fecha: haceDias(s.dias), logros: s.logros, intentos: s.intentos,
          ayuda: s.ayuda, dolor: s.dolor, profesional: nombre,
        })),
      });
    }

    const bandera = (p.evaluacion.banderasRojas || []).length ? "  🚩 con banderas rojas" : "";
    console.log(`   ✓ ${p.nombre} — ${p.dolor.length} punto(s) de dolor · ${p.goniometria.length} medida(s) · ${p.objetivos.length} objetivo(s)${bandera}`);
  }

  // ─── Un bono de sesiones sin terminar, para que Finanzas tenga datos ────
  const rosa = await Paciente.findOne({ medicoPhone: phone, nombre: "Rosa Mamani Choque" });
  if (rosa && !(await TratamientoPlan.findOne({ pacienteId: rosa._id }))) {
    await TratamientoPlan.create({
      pacienteId: rosa._id, medicoPhone: phone,
      nombre: "Bono de 10 sesiones — rehabilitación post prótesis",
      precio: 1200, estado: "en_proceso",
      pagos: [{ monto: 600, fecha: haceDias(45), notas: "Adelanto" }],
    });
  }

  console.log(`\n  Listo — ${creados} paciente${creados === 1 ? "" : "s"} nuevo${creados === 1 ? "" : "s"}.`);
  console.log(`\n  Entrá con ${phone} / ${password}`);
  console.log("");
  console.log("  Qué mirar:");
  console.log("   · Marcelo  — hombro DERECHO, marcado a la izquierda de la silueta. El lado está bien.");
  console.log("   · Rosa     — el porcentaje casi no se movió, pero pasó de la mano a sola.");
  console.log("   · Diego    — bajó la ayuda y SUBIÓ el dolor. Symphomed lo dice en vez de festejarlo.");
  console.log("   · Norma    — banderas rojas arriba de todo. Eso se deriva, no se trata.");
  avisarSiEsDebil(phone, password);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("\n  ✖", e.message, "\n");
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
