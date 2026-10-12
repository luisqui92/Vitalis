// Symphomed Fisioterapia — Arma un CENTRO KINÉSICO de demostración completo:
// la clínica, tres profesionales, nueve pacientes con su historia, la agenda
// de la semana, los bonos de sesiones cobrados a medias y los avisos que se
// pasaron.
//
// No son cinco fichas sueltas: es un consultorio andando, para que la demo se
// pueda dar entrando y tocando, sin tener que cargar nada en el momento.
//
// ═══ QUÉ MOSTRAR, Y EN QUÉ ORDEN ═══════════════════════════════════════════
//
//  · EL LADO BIEN ANOTADO. Mirando a alguien de frente su hombro derecho está
//    a la izquierda de quien mira, y Symphomed lo deduce solo. Marcelo tiene
//    el hombro DERECHO congelado y en la ficha dice derecho.
//  · LA GONIOMETRÍA CONTRA LA REFERENCIA. 95° de flexión de hombro no dicen
//    nada solos; contra los 180° de referencia dicen que está en la mitad —
//    y al lado está el hombro sano en 175° para comparar.
//  · LA AYUDA QUE BAJA. Rosa pasó de que la tomen de la mano a subir
//    escalones sola. El porcentaje casi no se movió; eso es lo que se mide.
//  · EL CASO INCÓMODO. Diego bajó la ayuda PERO le subió el dolor. Symphomed
//    lo dice en pantalla en vez de mostrarlo como un avance.
//  · UNA BANDERA ROJA. Norma tiene dolor nocturno que no cede y antecedente
//    oncológico — eso se deriva, no se trata, y aparece arriba de todo.
//  · EL CENTRO. Tres kinesiólogos con sus propios pacientes: cada uno ve los
//    suyos y ninguno ve los del otro. En fisioterapia NO hay ficha compartida
//    como en neurodesarrollo, y la demo tiene que mostrar esa diferencia.
//  · LA PLATA. Bonos de sesiones a medio pagar, que es exactamente como se
//    cobra rehabilitación y lo que hace que Finanzas tenga algo que sumar.
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
  TratamientoPlan, Recordatorio, Cita, ConsultaMedica, Clinica, PersonaClinica,
} = require("../db/models");
const { hashPassword } = require("../services/auth");
const { siguienteCodigo } = require("../services/codigos");

const { CLAVE_DEMO } = require("./lib/claveDemo");
const DIA = 24 * 60 * 60 * 1000;
const haceDias = (d) => new Date(Date.now() - d * DIA);
const enDias = (d) => new Date(Date.now() + d * DIA);
function nacimientoHace(años) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - años);
  return d;
}
// Una hora concreta de un día concreto, para que la agenda no quede toda a
// la misma hora que se corrió el seed.
function aLasHoras(diasDesdeHoy, hora, minutos = 0) {
  const d = new Date(Date.now() + diasDesdeHoy * DIA);
  d.setHours(hora, minutos, 0, 0);
  return d;
}

// ═══ LOS TURNOS DE HOY TIENEN QUE SER DE HOY, PERO MÁS TARDE ═══════════════
//
// Si la demo se arma a las siete de la tarde, un turno "hoy a las nueve" ya
// pasó y la Agenda lo esconde: se abre casi vacía justo cuando se la quiere
// mostrar. Los de hoy se cuelgan de la próxima hora en punto y van saliendo
// de a 45 minutos, así la agenda del día tiene contenido corra cuando corra.
function dentroDe(pasos) {
  const d = new Date();
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  d.setMinutes(d.getMinutes() + pasos * 45);
  return d;
}

// Los segmentos de la transcripción, para que la pestaña de Sesiones tenga
// algo que mostrar y no solo la nota ya redactada.
function generarSegmentos(transcripcion, duracionSegundos) {
  const partes = transcripcion.split(". ").filter(Boolean);
  const paso = duracionSegundos / partes.length;
  return partes.map((texto, i) => ({
    hablante: i % 2 === 0 ? "A" : "B",
    texto: texto.trim().endsWith(".") ? texto.trim() : texto.trim() + ".",
    inicioSeg: Math.round(i * paso),
    finSeg: Math.round((i + 1) * paso),
  }));
}

// ─── LOS COLEGAS DEL CENTRO ───────────────────────────────────────────────
// Cuelgan del teléfono de la cuenta principal para no chocar con números
// reales: si la demo entra con "78811007", ellos son "78811007-01" y "-02".
// Feo de leer y sin riesgo de pisarle la cuenta a nadie.
const COLEGAS = [
  { sufijo: "01", nombre: "Lic. Andrés Mercado", especialidad: "Kinesiología deportiva" },
  { sufijo: "02", nombre: "Lic. Paola Rojas", especialidad: "Kinesiología neurológica y respiratoria" },
];

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

// ─── LOS PACIENTES DE LOS COLEGAS ─────────────────────────────────────────
//
// Más chicos a propósito: no hacen falta para mostrar el módulo, hacen falta
// para mostrar que el centro tiene tres agendas y que cada uno ve SOLO lo
// suyo. Entrando con 78811007-01 no aparece ni Marcelo ni Rosa.
const PACIENTES_COLEGAS = [
  {
    sufijo: "01",  // Andrés, deportiva
    nombre: "Camila Terceros Justiniano", edad: 23, sexo: "Femenino", telefono: "59176778899",
    evaluacion: {
      motivo: "Dolor en la rodilla derecha al correr más de 3 km",
      mecanismo: "Sin golpe. Aumentó el volumen de entrenamiento de golpe para una media maratón.",
      desdeDias: 35,
      notas: "Síndrome de dolor patelofemoral. Corre 5 veces por semana.",
    },
    dolor: [{ region: "rodilla", lado: "derecho", vista: "frente", x: 42, y: 66, intensidad: 4, tipo: "mecanico",
      notas: "Alrededor de la rótula, peor bajando escaleras" }],
    goniometria: [
      { zona: "rodilla", movimiento: "flexion", lado: "derecho", valor: 128, dias: 20 },
      { zona: "rodilla", movimiento: "flexion", lado: "derecho", valor: 134, dias: 2 },
      { zona: "cadera", movimiento: "rotacion_interna", lado: "derecho", valor: 28, dias: 2 },
    ],
    objetivos: [{
      titulo: "Sentadilla a una pierna sin que la rodilla caiga adentro",
      area: "fuerza", criterio: "10 repeticiones controladas, sin valgo",
      sesiones: [
        { intentos: 10, logros: 3, ayuda: "gestual", dolor: 4, dias: 25 },
        { intentos: 10, logros: 6, ayuda: "verbal", dolor: 3, dias: 12 },
        { intentos: 10, logros: 9, ayuda: "independiente", dolor: 1, dias: 2 },
      ],
    }],
  },
  {
    sufijo: "01",
    nombre: "Joaquín Ledezma Arce", edad: 34, sexo: "Masculino", telefono: "59177001122",
    evaluacion: {
      motivo: "Vuelve al fútbol después de la reconstrucción de ligamento cruzado",
      mecanismo: "Rotura de LCA izquierdo, operado hace 5 meses.",
      desdeDias: 150,
      notas: "El riesgo acá es que vuelva antes de tiempo. Falta simetría de fuerza.",
    },
    dolor: [],
    goniometria: [
      { zona: "rodilla", movimiento: "flexion", lado: "izquierdo", valor: 132, dias: 3 },
      { zona: "rodilla", movimiento: "extension", lado: "izquierdo", valor: 0, dias: 3 },
      { zona: "rodilla", movimiento: "flexion", lado: "derecho", valor: 135, dias: 3 },
    ],
    objetivos: [{
      titulo: "Salto a una pierna alcanza el 90% de la pierna sana",
      area: "funcional", criterio: "3 saltos de distancia, promedio ≥90% del lado sano",
      sesiones: [
        { intentos: 3, logros: 0, ayuda: "verbal", dolor: 1, dias: 40 },
        { intentos: 3, logros: 1, ayuda: "independiente", dolor: 0, dias: 20 },
        { intentos: 3, logros: 2, ayuda: "independiente", dolor: 0, dias: 3 },
      ],
    }],
  },
  {
    sufijo: "02",  // Paola, neuro y respiratoria
    nombre: "Don Hugo Paredes Careaga", edad: 78, sexo: "Masculino", telefono: "59176445566",
    evaluacion: {
      motivo: "Después del ACV no puede abrir la mano derecha para agarrar el bastón",
      mecanismo: "ACV isquémico hace 7 meses, hemiparesia derecha.",
      desdeDias: 210,
      notas: "Vive con la hija. El objetivo que ella pidió es que pueda comer solo.",
    },
    dolor: [{ region: "hombro", lado: "derecho", vista: "frente", x: 31, y: 19, intensidad: 5, tipo: "mecanico",
      notas: "Hombro doloroso del hemipléjico, con subluxación" }],
    goniometria: [
      { zona: "hombro", movimiento: "flexion", lado: "derecho", valor: 55, dias: 30 },
      { zona: "hombro", movimiento: "flexion", lado: "derecho", valor: 68, dias: 4 },
      { zona: "codo", movimiento: "extension", lado: "derecho", valor: 25, dias: 4 },
      { zona: "muneca", movimiento: "extension", lado: "derecho", valor: 15, dias: 4 },
    ],
    objetivos: [{
      // El caso donde la escala de ayuda es TODO: el porcentaje es bajo y va
      // a seguir siendo bajo, y aun así el hombre mejoró muchísimo.
      titulo: "Lleva la cuchara a la boca con la mano derecha",
      area: "funcional", criterio: "5 llevadas sin volcar el contenido",
      sesiones: [
        { intentos: 5, logros: 0, ayuda: "fisica_total", dolor: 4, dias: 90 },
        { intentos: 5, logros: 1, ayuda: "fisica_total", dolor: 4, dias: 62 },
        { intentos: 5, logros: 1, ayuda: "fisica_parcial", dolor: 3, dias: 40 },
        { intentos: 5, logros: 2, ayuda: "fisica_parcial", dolor: 3, dias: 20 },
        { intentos: 5, logros: 2, ayuda: "gestual", dolor: 2, dias: 4 },
      ],
    }],
  },
  {
    sufijo: "02",
    nombre: "Lucía Ferrufino Balcázar", edad: 6, sexo: "Femenino", telefono: "59178223344",
    evaluacion: {
      motivo: "Kinesiología respiratoria por fibrosis quística",
      mecanismo: "Diagnóstico al año y medio. Sesiones de mantenimiento.",
      desdeDias: 400,
      notas: "La mamá hace las técnicas en casa. Acá se controla y se corrige.",
    },
    dolor: [],
    goniometria: [],
    objetivos: [{
      titulo: "Hace el ciclo activo de la respiración sola",
      area: "respiratorio", criterio: "3 ciclos completos sin que se lo vayan diciendo paso por paso",
      sesiones: [
        { intentos: 3, logros: 1, ayuda: "verbal", dolor: 0, dias: 60 },
        { intentos: 3, logros: 2, ayuda: "verbal", dolor: 0, dias: 30 },
        { intentos: 3, logros: 3, ayuda: "independiente", dolor: 0, dias: 6 },
      ],
    }],
  },
];

// ─── LAS SESIONES GRABADAS ────────────────────────────────────────────────
//
// Para que la pestaña de Sesiones tenga contenido: son consultas normales de
// Symphomed, con su transcripción y la nota clínica ya redactada. Van cortas
// a propósito — la demo se lee, no se estudia.
const SESIONES = {
  "Marcelo Arandia Vaca": [
    {
      dias: 3, duracionSegundos: 1140,
      transcripcion: "Buenas tardes Marcelo, cómo anduvo el hombro esta semana. Mejor licenciada, ya puedo colgar la ropa sin que me duela tanto. Vamos a medir de nuevo la flexión. Da noventa y cinco grados, la vez pasada fue ochenta y dos. Sigue costando la rotación externa. Vamos a insistir con las movilizaciones y el ejercicio del bastón en casa, tres series de diez, dos veces por día.",
      motivoConsulta: "Control de capsulitis adhesiva de hombro derecho, semana 8",
      sintomas: "Dolor al elevar por encima del hombro, 6/10. Mejoría subjetiva en actividades de la vida diaria.",
      antecedentesRelevantes: "Diabetes tipo 2 controlada. Sin traumatismo previo.",
      diagnostico: "Capsulitis adhesiva de hombro derecho, fase de rigidez en mejoría",
      plan: "Movilización articular pasiva. Ejercicio con bastón 3x10 dos veces por día en domicilio. Control en una semana.",
      proximoControl: "En 7 días",
    },
  ],
  "Rosa Mamani Choque": [
    {
      dias: 2, duracionSegundos: 1320,
      transcripcion: "Doña Rosa, hoy vamos a probar la escalera sin que yo la sostenga. Ay licenciada, me da miedo. Yo me quedo al lado suyo pero no la toco, usted use solamente la baranda si la necesita. Muy bien, subió los diez escalones. No usé la baranda, me di cuenta recién ahora. Eso es lo que quería escuchar, hace dos meses subía de la mano mía.",
      motivoConsulta: "Rehabilitación post artroplastia total de cadera izquierda, semana 9",
      sintomas: "Dolor 2/10 solo al final del día. Sin claudicación en superficie plana.",
      antecedentesRelevantes: "Vive sola en un primer piso sin ascensor. Ese es el objetivo funcional real.",
      diagnostico: "Evolución favorable post PTC izquierda",
      plan: "Progresar a escalera sin baranda con supervisión. Fortalecimiento de abductores. Alta prevista en 3 semanas.",
      proximoControl: "En 7 días",
    },
  ],
  "Diego Villarroel Peña": [
    {
      dias: 4, duracionSegundos: 1020,
      transcripcion: "Diego contame cómo fue la semana. Levanté las cajas como me dijiste y las cinco me salieron bien. Perfecto pero decime una cosa, te dolió. Un poco sí, como un seis. Ahí está el tema, las cinco te salen pero el dolor subió de dos a seis. Eso me dice que lo estás logrando compensando con otra cosa, no que estés mejor. Vamos a bajar la carga y mirar la técnica de nuevo.",
      motivoConsulta: "Control de lumbalgia mecánica recurrente, tercera recaída",
      sintomas: "Dolor lumbar 5/10 en bipedestación, irradiado a cara posterior de muslo derecho sin sobrepasar la rodilla.",
      antecedentesRelevantes: "Trabajo sedentario 9 horas. Tres episodios en el último año.",
      diagnostico: "Lumbalgia mecánica recurrente. Logro del objetivo con aumento del dolor: sospecha de compensación.",
      plan: "Reducir carga. Revisar patrón de bisagra de cadera. NO progresar hasta que el dolor baje a 0-2.",
      proximoControl: "En 7 días",
    },
  ],
  "Norma Gutiérrez Loayza": [
    {
      dias: 1, duracionSegundos: 780,
      transcripcion: "Señora Norma, cuénteme del dolor de la espalda. Me despierta de noche a las tres de la mañana, licenciada, y no se me pasa con nada. Cambia si se acuesta de otro lado. No, es igual en cualquier posición. Usted me había comentado del tratamiento oncológico. Sí, hace cuatro años. Y bajó de peso últimamente. Unos seis kilos sin hacer dieta. Norma, yo hoy no le voy a hacer tratamiento. La voy a mandar a su oncólogo hoy mismo.",
      motivoConsulta: "Dolor dorsal de dos meses de evolución, en aumento",
      sintomas: "Dolor dorsal 8/10 que despierta por la noche, no modificado por la posición. Pérdida de 6 kg no intencional.",
      antecedentesRelevantes: "Antecedente oncológico hace 4 años.",
      diagnostico: "Dolor dorsal con banderas rojas. NO se inicia tratamiento kinésico.",
      plan: "DERIVACIÓN a oncología el mismo día. Se contacta a la paciente para confirmar que asistió.",
      proximoControl: "Según indique oncología",
    },
  ],
};

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

// Borra el centro entero: el titular Y los colegas. Si borrara solo la
// cuenta principal dejaría dos kinesiólogos huérfanos con pacientes, que es
// la peor forma de "limpiar" una demo.
async function borrarTodo(phone) {
  const telefonos = [phone, ...COLEGAS.map(c => `${phone}-${c.sufijo}`)];
  const pacientes = await Paciente.find({ medicoPhone: { $in: telefonos } }).select("_id personaId").lean();
  const ids = pacientes.map(p => p._id);
  const personaIds = pacientes.map(p => p.personaId).filter(Boolean);

  const porTelefono = { medicoPhone: { $in: telefonos } };
  const borrados = await Promise.all([
    EvaluacionFisio.deleteMany(porTelefono),
    MedicionFisio.deleteMany(porTelefono),
    ObjetivoFisio.deleteMany(porTelefono),
    TratamientoPlan.deleteMany(porTelefono),
    Recordatorio.deleteMany(porTelefono),
    Cita.deleteMany(porTelefono),
    ConsultaMedica.deleteMany(porTelefono),
    Paciente.deleteMany({ _id: { $in: ids } }),
    PersonaClinica.deleteMany({ _id: { $in: personaIds } }),
  ]);
  await Medico.deleteMany({ phone: { $in: telefonos } });
  await Clinica.deleteOne({ nombre: "Centro Kinésico Movimiento (demo)" });

  console.log(`\n  Borrado el centro entero: ${pacientes.length} paciente(s) y ${telefonos.length} cuenta(s).`);
  console.log(`  Evaluaciones ${borrados[0].deletedCount} · mediciones ${borrados[1].deletedCount} · objetivos ${borrados[2].deletedCount}`);
  console.log(`  Sesiones ${borrados[6].deletedCount} · citas ${borrados[5].deletedCount} · bonos ${borrados[3].deletedCount}\n`);
}

// ─── Crear un paciente con toda su historia de fisio ──────────────────────
// Se usa igual para los del titular y para los de los colegas: la única
// diferencia es de qué teléfono cuelga.
async function cargarPaciente(p, telefono, nombreProfesional, clinicaId) {
  let ficha = await Paciente.findOne({ medicoPhone: telefono, nombre: p.nombre });
  let nuevo = false;
  if (!ficha) {
    ficha = await Paciente.create({
      nombre: p.nombre, medicoPhone: telefono,
      codigo: await siguienteCodigo(Paciente, telefono, "P"),
      fechaNacimiento: nacimientoHace(p.edad),
      sexo: p.sexo, telefono: p.telefono,
    });
    nuevo = true;
  }

  // La identidad compartida del centro: es lo que hace que si mañana lo
  // atiende otro colega, sus alergias se vean igual.
  if (clinicaId && !ficha.personaId) {
    const persona = await PersonaClinica.create({
      clinicaId, nombre: ficha.nombre, fechaNacimiento: ficha.fechaNacimiento,
      sexo: ficha.sexo, telefono: ficha.telefono,
    });
    ficha.personaId = persona._id;
    await ficha.save();
  }

  if (await EvaluacionFisio.findOne({ pacienteId: ficha._id })) {
    console.log(`   · ${p.nombre} — ya tenía evaluación, se saltea`);
    return { ficha, nuevo, salteado: true };
  }

  await EvaluacionFisio.create({
    pacienteId: ficha._id, medicoPhone: telefono,
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
      pacienteId: ficha._id, medicoPhone: telefono,
      clase: "dolor", zona: d.region, lado: d.lado, valor: d.intensidad, fecha: haceDias(1),
    });
  }

  for (const g of p.goniometria) {
    await MedicionFisio.create({
      pacienteId: ficha._id, medicoPhone: telefono,
      clase: "goniometria", zona: g.zona, movimiento: g.movimiento, lado: g.lado,
      valor: g.valor, fecha: haceDias(g.dias),
    });
  }

  for (const o of p.objetivos) {
    await ObjetivoFisio.create({
      pacienteId: ficha._id, medicoPhone: telefono,
      titulo: o.titulo, area: o.area, criterio: o.criterio,
      estado: o.estado || "activo",
      fechaInicio: haceDias(o.sesiones.length ? o.sesiones[0].dias + 5 : 30),
      fechaCierre: o.estado && o.estado !== "activo" ? haceDias(1) : null,
      progreso: o.sesiones.map(s => ({
        fecha: haceDias(s.dias), logros: s.logros, intentos: s.intentos,
        ayuda: s.ayuda, dolor: s.dolor, profesional: nombreProfesional,
      })),
    });
  }

  // La sesión grabada, con su transcripción y su nota.
  for (const s of (SESIONES[p.nombre] || [])) {
    const fecha = haceDias(s.dias);
    const consulta = await ConsultaMedica.create({
      medicoPhone: telefono, pacienteId: ficha._id, pacienteNombre: ficha.nombre,
      estado: "completado", duracionSegundos: s.duracionSegundos,
      transcripcionCompleta: s.transcripcion,
      segmentos: generarSegmentos(s.transcripcion, s.duracionSegundos),
      notaClinicaEstado: "completado",
      notaClinica: {
        motivoConsulta: s.motivoConsulta, sintomas: s.sintomas,
        antecedentesRelevantes: s.antecedentesRelevantes, diagnostico: s.diagnostico,
        plan: s.plan, proximoControl: s.proximoControl,
      },
    });
    // Mongoose pisa createdAt en cada save por el {timestamps:true}. Un
    // update directo a la colección es la única forma de dejar la fecha
    // vieja de verdad.
    await ConsultaMedica.collection.updateOne(
      { _id: consulta._id }, { $set: { createdAt: fecha, updatedAt: fecha } }
    );
  }

  const bandera = (p.evaluacion.banderasRojas || []).length ? "  🚩 con banderas rojas" : "";
  const sesiones = (SESIONES[p.nombre] || []).length;
  console.log(`   ✓ ${p.nombre} — ${p.dolor.length} dolor · ${p.goniometria.length} medida(s) · ${p.objetivos.length} objetivo(s)${sesiones ? ` · ${sesiones} sesión grabada` : ""}${bandera}`);
  return { ficha, nuevo, salteado: false };
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
  const password = process.argv[4] || CLAVE_DEMO;

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

  // ─── EL CENTRO ─────────────────────────────────────────────────────────
  let centro = await Clinica.findOne({ nombre: "Centro Kinésico Movimiento (demo)" });
  if (!centro) {
    centro = await Clinica.create({
      nombre: "Centro Kinésico Movimiento (demo)",
      ciudad: "Santa Cruz de la Sierra",
      direccion: "Av. Banzer 3er anillo",
      activa: true,
    });
  }
  await Medico.updateOne({ phone }, { $set: { clinicaId: centro._id } });

  const profesionales = { [phone]: nombre };
  for (const c of COLEGAS) {
    const suPhone = `${phone}-${c.sufijo}`;
    profesionales[suPhone] = c.nombre;
    let m = await Medico.findOne({ phone: suPhone });
    if (!m) {
      await Medico.create({
        phone: suPhone, nombre: c.nombre, especialidad: c.especialidad,
        tipoEspecialidad: "fisioterapia", clinicaId: centro._id,
        passwordHash: await hashPassword(password), activo: true,
      });
    } else {
      m.clinicaId = centro._id; m.tipoEspecialidad = "fisioterapia"; await m.save();
    }
  }
  console.log(`  Centro: ${centro.nombre} — ${nombre} + ${COLEGAS.length} colegas`);

  // ─── LOS PACIENTES ─────────────────────────────────────────────────────
  console.log("");
  let creados = 0;
  const fichas = {};
  for (const p of PACIENTES) {
    const r = await cargarPaciente(p, phone, nombre, centro._id);
    fichas[p.nombre] = r.ficha;
    if (r.nuevo) creados++;
  }

  console.log("");
  for (const p of PACIENTES_COLEGAS) {
    const suPhone = `${phone}-${p.sufijo}`;
    const r = await cargarPaciente(p, suPhone, profesionales[suPhone], centro._id);
    fichas[p.nombre] = r.ficha;
    if (r.nuevo) creados++;
  }

  // ─── LOS BONOS DE SESIONES ─────────────────────────────────────────────
  // Así se cobra rehabilitación: un bono de N sesiones que se paga en parte
  // al principio y se termina de pagar después. Es lo que hace que la
  // pantalla de Finanzas tenga algo que sumar.
  const BONOS = [
    { paciente: "Rosa Mamani Choque", telefono: phone,
      nombre: "Bono de 10 sesiones — rehabilitación post prótesis", precio: 1200,
      estado: "en_proceso", pagos: [{ monto: 600, dias: 45, notas: "Adelanto" }] },
    { paciente: "Marcelo Arandia Vaca", telefono: phone,
      nombre: "Bono de 12 sesiones — hombro congelado", precio: 1440,
      estado: "en_proceso", pagos: [{ monto: 720, dias: 60, notas: "Mitad al empezar" }, { monto: 360, dias: 20, notas: "Segunda cuota" }] },
    { paciente: "Kevin Salazar Ortiz", telefono: phone,
      nombre: "Bono de 8 sesiones — esguince de tobillo", precio: 880,
      estado: "en_proceso", pagos: [{ monto: 880, dias: 20, notas: "Pagó todo junto" }] },
    { paciente: "Diego Villarroel Peña", telefono: phone,
      nombre: "Bono de 10 sesiones — lumbalgia", precio: 1100,
      estado: "pendiente", pagos: [] },
    { paciente: "Camila Terceros Justiniano", telefono: `${phone}-01`,
      nombre: "Bono de 8 sesiones — rodilla del corredor", precio: 960,
      estado: "en_proceso", pagos: [{ monto: 480, dias: 30, notas: "Adelanto" }] },
    { paciente: "Joaquín Ledezma Arce", telefono: `${phone}-01`,
      nombre: "Programa de retorno al deporte — 20 sesiones", precio: 2600,
      estado: "en_proceso", pagos: [{ monto: 1300, dias: 120, notas: "Primera mitad" }] },
    { paciente: "Don Hugo Paredes Careaga", telefono: `${phone}-02`,
      nombre: "Bono mensual domiciliario — neurorrehabilitación", precio: 1800,
      estado: "en_proceso", pagos: [{ monto: 1800, dias: 15, notas: "Mes completo" }] },
  ];
  let bonos = 0, facturado = 0, cobrado = 0;
  for (const b of BONOS) {
    const ficha = fichas[b.paciente];
    if (!ficha) continue;
    facturado += b.precio;
    cobrado += b.pagos.reduce((a, p) => a + p.monto, 0);
    if (await TratamientoPlan.findOne({ pacienteId: ficha._id, nombre: b.nombre })) continue;
    await TratamientoPlan.create({
      pacienteId: ficha._id, medicoPhone: b.telefono,
      nombre: b.nombre, precio: b.precio, estado: b.estado,
      pagos: b.pagos.map(p => ({ monto: p.monto, fecha: haceDias(p.dias), notas: p.notas })),
    });
    bonos++;
  }
  console.log(`\n  ${bonos} bono(s) de sesiones — Bs ${facturado} facturado, Bs ${cobrado} cobrado`);

  // ─── LA AGENDA ─────────────────────────────────────────────────────────
  // Hoy y los próximos días, en horarios de consultorio. Sin esto la Agenda
  // se abre vacía y la demo tiene que empezar cargando turnos a mano.
  const TURNOS = [
    // Hoy, desde la próxima hora en punto (ver dentroDe).
    { paciente: "Marcelo Arandia Vaca", telefono: phone, enPasos: 0, motivo: "Control de hombro — semana 9" },
    { paciente: "Rosa Mamani Choque", telefono: phone, enPasos: 1, motivo: "Escalera sin baranda" },
    { paciente: "Kevin Salazar Ortiz", telefono: phone, enPasos: 2, motivo: "Propiocepción de tobillo" },
    { paciente: "Camila Terceros Justiniano", telefono: `${phone}-01`, enPasos: 0, motivo: "Fuerza de glúteo medio" },
    { paciente: "Joaquín Ledezma Arce", telefono: `${phone}-01`, enPasos: 2, motivo: "Test de salto — simetría" },
    // Los próximos días, en horario de consultorio.
    { paciente: "Diego Villarroel Peña", telefono: phone, dia: 1, hora: 16, motivo: "Revisar técnica de levantamiento" },
    { paciente: "Marcelo Arandia Vaca", telefono: phone, dia: 3, hora: 9, motivo: "Control semanal" },
    { paciente: "Rosa Mamani Choque", telefono: phone, dia: 4, hora: 10, motivo: "Control semanal" },
    { paciente: "Kevin Salazar Ortiz", telefono: phone, dia: 2, hora: 11, minutos: 30, motivo: "Test funcional" },
    { paciente: "Don Hugo Paredes Careaga", telefono: `${phone}-02`, dia: 1, hora: 15, motivo: "Domicilio — mano y hombro" },
    { paciente: "Lucía Ferrufino Balcázar", telefono: `${phone}-02`, dia: 2, hora: 14, motivo: "Kinesiología respiratoria" },
  ];
  let turnos = 0;
  for (const tu of TURNOS) {
    const ficha = fichas[tu.paciente];
    if (!ficha) continue;
    const fecha = tu.enPasos !== undefined ? dentroDe(tu.enPasos) : aLasHoras(tu.dia, tu.hora, tu.minutos || 0);
    if (await Cita.findOne({ medicoPhone: tu.telefono, pacienteId: ficha._id, fecha })) continue;
    await Cita.create({
      medicoPhone: tu.telefono, pacienteId: ficha._id,
      pacienteNombre: ficha.nombre, pacienteTelefono: ficha.telefono,
      fecha, duracionMinutos: 45, motivo: tu.motivo,
      estado: "confirmada", origen: "manual",
    });
    turnos++;
  }
  console.log(`  ${turnos} turno(s) en la agenda de la semana`);

  // ─── LO QUE SE PASÓ ────────────────────────────────────────────────────
  // El panel de arriba del escritorio necesita tener algo, porque es lo
  // primero que se ve al entrar y vacío no muestra nada.
  const OLVIDOS = [
    { paciente: "Norma Gutiérrez Loayza", telefono: phone,
      titulo: "Confirmar que fue al oncólogo", dias: 5 },
    { paciente: "Diego Villarroel Peña", telefono: phone,
      titulo: "Pedirle el informe de la resonancia lumbar", dias: 18 },
    { paciente: "Kevin Salazar Ortiz", telefono: phone,
      titulo: "Test funcional antes del alta deportiva", dias: 9 },
    { paciente: "Don Hugo Paredes Careaga", telefono: `${phone}-02`,
      titulo: "Hablar con la hija sobre la férula nocturna", dias: 12 },
  ];
  let olvidos = 0;
  for (const o of OLVIDOS) {
    const ficha = fichas[o.paciente];
    if (!ficha) continue;
    if (await Recordatorio.findOne({ pacienteId: ficha._id, titulo: o.titulo })) continue;
    await Recordatorio.create({
      pacienteId: ficha._id, pacienteNombre: ficha.nombre, medicoPhone: o.telefono,
      tipo: "control", titulo: o.titulo, fecha: haceDias(o.dias),
    });
    olvidos++;
  }
  console.log(`  ${olvidos} aviso(s) vencido(s) en el panel de «se te pasó»`);

  // ─── CÓMO USARLO ───────────────────────────────────────────────────────
  console.log(`\n  Listo — ${creados} paciente${creados === 1 ? "" : "s"} nuevo${creados === 1 ? "" : "s"} en el centro.`);
  console.log(`\n  Entrá con ${phone} / ${password}`);
  console.log(`  Los colegas: ${phone}-01 (deportiva) y ${phone}-02 (neuro y respiratoria), misma contraseña.`);
  console.log("");
  console.log("  ── Qué mostrar, en este orden ──────────────────────────────────");
  console.log("");
  console.log("   1. MARCELO — hombro congelado.");
  console.log("      Evaluación: el punto está a la IZQUIERDA de la silueta y la ficha");
  console.log("      dice hombro DERECHO. De frente está cruzado y Symphomed lo sabe.");
  console.log("      Movilidad: el hombro sano marca 175° (97%) y el enfermo 95° (53%).");
  console.log("      Los dos al lado del otro, se lee de un vistazo.");
  console.log("");
  console.log("   2. ROSA — prótesis de cadera, 71 años, vive en un primer piso.");
  console.log("      Objetivos: el porcentaje pasó de 6/10 a 8/10, casi nada.");
  console.log("      Pero pasó de que la tomen de la mano a subir sola. ESO es el avance,");
  console.log("      y es lo que una planilla de porcentajes no muestra.");
  console.log("");
  console.log("   3. DIEGO — lumbalgia. El caso incómodo.");
  console.log("      Bajó la ayuda hasta independiente PERO el dolor subió de 2 a 6.");
  console.log("      Symphomed lo dice en pantalla: «revisá si está compensando antes");
  console.log("      de darlo por logrado». En dos gráficos separados eso no se ve.");
  console.log("");
  console.log("   4. NORMA — banderas rojas arriba de todo y en rojo.");
  console.log("      Dolor nocturno que no cede + antecedente oncológico + bajó 6 kg.");
  console.log("      Eso se deriva, no se trata. La sesión grabada lo dice.");
  console.log("");
  console.log("   5. EL CENTRO — salí y entrá con " + phone + "-01.");
  console.log("      No aparece ni Marcelo ni Rosa: cada kinesiólogo ve SOLO lo suyo.");
  console.log("      En fisioterapia no hay ficha compartida como en neurodesarrollo.");
  console.log("");
  avisarSiEsDebil(phone, password);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("\n  ✖", e.message, "\n");
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
