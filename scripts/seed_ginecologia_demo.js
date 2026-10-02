// Symphomed Gineco — Crea (o actualiza) una cuenta de ginecología y
// obstetricia de demo con 8 pacientes: embarazadas en distintos trimestres,
// un embarazo ya terminado (con desenlace) y pacientes ginecológicas sin
// embarazo. Cada una con consultas espaciadas en el tiempo, ecografías y
// laboratorios (archivo real, se pueden abrir), controles con tendencia
// para las gráficas y el Brief Clínico ya armado — para no depender de una
// llamada a OpenAI en plena demo.
//
// Uso: node scripts/seed_ginecologia_demo.js <telefono> ["Nombre completo"] [password]
// Ej:  node scripts/seed_ginecologia_demo.js 78811002
//
// Es idempotente: si la médica ya existe no le toca la contraseña; si una
// paciente ya tiene consultas cargadas, la saltea.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, Medicion, Estudio, Embarazo, ExamenGinecologico, ORGANOS_GINECO } = require("../db/models");
const { hashPassword } = require("../services/auth");

const { CLAVE_DEMO } = require("./lib/claveDemo");
function hace(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d;
}
function haceDias(dias) {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

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

// PDF mínimo pero válido, para que las ecografías y laboratorios de demo se
// puedan abrir de verdad desde el Kardex.
function crearPdfSimple(lineas) {
  const contenido = lineas.map((l, i) => `BT /F1 12 Tf 50 ${740 - i * 20} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length ${contenido.length}>>
stream
${contenido}
endstream
endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
  return Buffer.from(pdf, "utf-8");
}

const DIR_ESTUDIOS = path.join(__dirname, "..", "uploads", "estudios");

// "semanasHoy" es a cuántas semanas de gestación tiene que estar HOY: de ahí
// se calcula la FUM hacia atrás, así la demo siempre muestra semanas
// coherentes sin importar cuándo se corra el script.
const PACIENTES_DEMO = [
  {
    nombre: "Camila Andrea Rojas Peña", fechaNacimiento: "1996-04-18", sexo: "Femenino", telefono: "70501101",
    antecedentesPersonales: ["Primigesta", "Sin antecedentes patológicos de relevancia"],
    antecedentesFamiliares: [{ parentesco: "Madre", condicion: "Hipertensión arterial" }],
    embarazo: { semanasHoy: 12, notas: "Primigesta. Embarazo deseado y controlado desde la semana 6." },
    consultas: [
      { mesesAtras: 2, motivoConsulta: "Primer control prenatal", sintomas: ["náuseas matutinas", "somnolencia"], antecedentesRelevantes: "Primigesta, FUM confirmada por ecografía", diagnostico: "Embarazo de 6 semanas, curso normal", diagnosticosDiferenciales: [], plan: "Ácido fólico, ecografía de datación, laboratorios de primer trimestre", medicamentosRecetados: [{ nombre: "Ácido fólico", dosis: "5mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["hemograma", "grupo y factor", "ecografía obstétrica"], proximoControl: "En 4 semanas", transcripcionCompleta: "Doctora, me hice el test y salió positivo. Estás de seis semanas según la fecha de última menstruación. Las náuseas son normales en el primer trimestre. Te voy a pedir los laboratorios y una ecografía de datación, y empezá con ácido fólico desde hoy.", duracionSegundos: 420 },
      { mesesAtras: 0, motivoConsulta: "Control prenatal del primer trimestre", sintomas: ["náuseas en disminución"], antecedentesRelevantes: "Ecografía confirma embarazo único de 12 semanas", diagnostico: "Embarazo de 12 semanas, evolución normal", diagnosticosDiferenciales: [], plan: "Continuar ácido fólico, sumar hierro. Ecografía morfológica entre semana 20 y 22", medicamentosRecetados: [{ nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["ecografía morfológica"], proximoControl: "En 4 semanas", transcripcionCompleta: "Doctora, ya casi no tengo náuseas. Muy bien, eso es lo esperable a esta altura. La ecografía muestra un embarazo único, con latido presente y translucencia nucal normal. Vamos a agregar hierro desde ahora.", duracionSegundos: 380 },
    ],
    medicamentos: [
      { nombre: "Ácido fólico", dosis: "5mg", frecuencia: "1 vez al día", mesesInicio: 2, mesesFin: null },
      { nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "1 vez al día", mesesInicio: 0, mesesFin: null },
    ],
    mediciones: [
      { tipo: "peso", valor: 58, mesesAtras: 2 }, { tipo: "peso", valor: 59, mesesAtras: 1 }, { tipo: "peso", valor: 60, mesesAtras: 0 },
      { tipo: "presion", valor: 110, valorSecundario: 70, mesesAtras: 2 },
      { tipo: "presion", valor: 108, valorSecundario: 68, mesesAtras: 0 },
    ],
    estudios: [
      { tipo: "ecografia", nombre: "Ecografía obstétrica de datación", mesesAtras: 2, lineas: ["Ecografia obstetrica transvaginal - Camila Andrea Rojas Pena", "Saco gestacional unico intrauterino", "Embrion con latido presente, FCF 148 lpm", "LCC 5.4 mm - compatible con 6 semanas 2 dias"] },
      { tipo: "ecografia", nombre: "Ecografía de translucencia nucal (11-14 sem)", mesesAtras: 0, lineas: ["Ecografia 11-14 semanas - Camila Andrea Rojas Pena", "Embarazo unico, feto vivo", "LCC 58 mm - 12 semanas 1 dia", "Translucencia nucal: 1.4 mm (normal)", "Hueso nasal presente"] },
      { tipo: "laboratorio", nombre: "Laboratorios de primer trimestre", mesesAtras: 2, lineas: ["Laboratorio - Camila Andrea Rojas Pena", "Hemoglobina: 12.4 g/dL", "Grupo y factor: O Rh positivo", "Glucemia en ayunas: 82 mg/dL", "VDRL: no reactivo / VIH: no reactivo"] },
    ],
  },
  {
    nombre: "Valeria Nicole Ticona Mamani", fechaNacimiento: "1993-08-25", sexo: "Femenino", telefono: "70501102",
    antecedentesPersonales: ["Segunda gesta, un parto vaginal previo"],
    antecedentesFamiliares: [{ parentesco: "Madre", condicion: "Diabetes tipo 2" }],
    embarazo: { semanasHoy: 25, notas: "Segunda gesta. Antecedente familiar de diabetes: se controla curva de glucosa." },
    consultas: [
      { mesesAtras: 3, motivoConsulta: "Control prenatal del segundo trimestre", sintomas: [], antecedentesRelevantes: "Segunda gesta, parto vaginal previo sin complicaciones", diagnostico: "Embarazo de 13 semanas, evolución normal", diagnosticosDiferenciales: [], plan: "Continuar suplementos, ecografía morfológica en semana 20", medicamentosRecetados: [{ nombre: "Ácido fólico", dosis: "5mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["ecografía morfológica"], proximoControl: "En 6 semanas", transcripcionCompleta: "Doctora, esta vez me siento mucho mejor que en el primer embarazo. El control está bien, presión normal y el útero crece acorde. Nos vemos para la morfológica alrededor de la semana veinte.", duracionSegundos: 330 },
      { mesesAtras: 1, motivoConsulta: "Ecografía morfológica y control", sintomas: ["movimientos fetales presentes"], antecedentesRelevantes: "Antecedente familiar de diabetes materna", diagnostico: "Embarazo de 21 semanas, morfología fetal normal", diagnosticosDiferenciales: [], plan: "Solicitar test de tolerancia oral a la glucosa entre semana 24 y 28", medicamentosRecetados: [], examenesSolicitados: ["test de tolerancia oral a la glucosa"], proximoControl: "En 4 semanas", transcripcionCompleta: "Doctora, ya siento los movimientos hace un par de semanas. La morfológica salió sin hallazgos, anatomía fetal normal y placenta bien insertada. Como tu mamá es diabética, en el próximo control pedimos la curva de tolerancia a la glucosa.", duracionSegundos: 400 },
      { mesesAtras: 0, motivoConsulta: "Control con resultado de curva de glucosa", sintomas: [], antecedentesRelevantes: "Curva de tolerancia a la glucosa alterada", diagnostico: "Diabetes gestacional", diagnosticosDiferenciales: [], plan: "Plan nutricional, automonitoreo de glucemias, control en 2 semanas", medicamentosRecetados: [], examenesSolicitados: ["perfil glucémico"], proximoControl: "En 2 semanas", transcripcionCompleta: "Doctora, la curva salió un poco alterada. Efectivamente estás con diabetes gestacional. No te asustes, en la mayoría de los casos se controla solo con alimentación. Vamos a derivarte a nutrición y vas a medirte la glucosa en casa.", duracionSegundos: 450 },
    ],
    medicamentos: [
      { nombre: "Ácido fólico", dosis: "5mg", frecuencia: "1 vez al día", mesesInicio: 3, mesesFin: null },
      { nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "1 vez al día", mesesInicio: 1, mesesFin: null },
    ],
    mediciones: [
      { tipo: "peso", valor: 63, mesesAtras: 3 }, { tipo: "peso", valor: 66, mesesAtras: 2 }, { tipo: "peso", valor: 68, mesesAtras: 1 }, { tipo: "peso", valor: 70, mesesAtras: 0 },
      { tipo: "presion", valor: 112, valorSecundario: 72, mesesAtras: 3 },
      { tipo: "presion", valor: 115, valorSecundario: 74, mesesAtras: 1 },
      { tipo: "presion", valor: 118, valorSecundario: 76, mesesAtras: 0 },
      { tipo: "glucosa", valor: 88, mesesAtras: 3 }, { tipo: "glucosa", valor: 105, mesesAtras: 1 }, { tipo: "glucosa", valor: 132, mesesAtras: 0 },
    ],
    estudios: [
      { tipo: "ecografia", nombre: "Ecografía morfológica (semana 21)", mesesAtras: 1, lineas: ["Ecografia morfologica - Valeria Nicole Ticona Mamani", "Embarazo unico, feto vivo, presentacion cefalica", "Biometria acorde a 21 semanas 3 dias", "Anatomia fetal sin hallazgos patologicos", "Placenta anterior, grado 0. Liquido amniotico normal"] },
      { tipo: "laboratorio", nombre: "Test de tolerancia oral a la glucosa", mesesAtras: 0, lineas: ["Curva de tolerancia oral a la glucosa - Valeria Nicole Ticona Mamani", "Basal: 96 mg/dL", "1 hora: 189 mg/dL (elevado)", "2 horas: 162 mg/dL (elevado)", "Interpretacion: compatible con diabetes gestacional"] },
    ],
  },
  {
    nombre: "Daniela Fernanda Quispe Luna", fechaNacimiento: "1990-11-30", sexo: "Femenino", telefono: "70501103",
    antecedentesPersonales: ["Tercera gesta", "Cesárea previa hace 4 años"],
    antecedentesFamiliares: [],
    embarazo: { semanasHoy: 36, notas: "Cesárea previa. Se evalúa vía de parto cerca del término." },
    consultas: [
      { mesesAtras: 2, motivoConsulta: "Control prenatal del tercer trimestre", sintomas: ["lumbalgia"], antecedentesRelevantes: "Cesárea previa hace 4 años", diagnostico: "Embarazo de 27 semanas, evolución normal", diagnosticosDiferenciales: [], plan: "Continuar controles, ecografía de crecimiento en 4 semanas", medicamentosRecetados: [{ nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["ecografía de crecimiento"], proximoControl: "En 4 semanas", transcripcionCompleta: "Doctora, me duele bastante la espalda baja. Es muy común en el tercer trimestre por el peso del útero. El bebé está creciendo bien. Vamos a controlar el crecimiento con una ecografía en un mes.", duracionSegundos: 350 },
      { mesesAtras: 0, motivoConsulta: "Control de término, evaluación de vía de parto", sintomas: ["contracciones de Braxton Hicks"], antecedentesRelevantes: "Cesárea previa, cicatriz uterina", diagnostico: "Embarazo de 36 semanas, presentación cefálica", diagnosticosDiferenciales: [], plan: "Programar cesárea electiva a las 39 semanas. Signos de alarma explicados", medicamentosRecetados: [], examenesSolicitados: ["ecografía de control"], proximoControl: "En 1 semana", transcripcionCompleta: "Doctora, siento contracciones que van y vienen pero no duelen. Esas son de Braxton Hicks, son normales. El bebé está de cabeza y con buen peso. Dado el antecedente de cesárea, vamos a programar una cesárea electiva a las treinta y nueve semanas.", duracionSegundos: 480 },
    ],
    medicamentos: [{ nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "1 vez al día", mesesInicio: 4, mesesFin: null }],
    mediciones: [
      { tipo: "peso", valor: 68, mesesAtras: 4 }, { tipo: "peso", valor: 72, mesesAtras: 2 }, { tipo: "peso", valor: 76, mesesAtras: 0 },
      { tipo: "presion", valor: 118, valorSecundario: 75, mesesAtras: 4 },
      { tipo: "presion", valor: 122, valorSecundario: 78, mesesAtras: 2 },
      { tipo: "presion", valor: 124, valorSecundario: 80, mesesAtras: 0 },
      { tipo: "frecuenciaCardiaca", valor: 84, mesesAtras: 0 },
    ],
    estudios: [
      { tipo: "ecografia", nombre: "Ecografía de crecimiento (semana 32)", mesesAtras: 1, lineas: ["Ecografia de crecimiento - Daniela Fernanda Quispe Luna", "Feto unico vivo, presentacion cefalica", "Peso fetal estimado: 1850 g (percentil 55)", "Liquido amniotico normal, ILA 14 cm", "Doppler de arteria umbilical normal"] },
      { tipo: "ecografia", nombre: "Ecografía de control (semana 36)", mesesAtras: 0, lineas: ["Ecografia obstetrica - Daniela Fernanda Quispe Luna", "Feto unico vivo, presentacion cefalica, dorso a la izquierda", "Peso fetal estimado: 2740 g (percentil 50)", "Placenta posterior grado II", "Cicatriz uterina de aspecto conservado"] },
      { tipo: "laboratorio", nombre: "Hemograma del tercer trimestre", mesesAtras: 0, lineas: ["Laboratorio - Daniela Fernanda Quispe Luna", "Hemoglobina: 11.2 g/dL", "Hematocrito: 34%", "Plaquetas: 215.000", "Sin datos de anemia severa"] },
    ],
  },
  {
    nombre: "Gabriela Soledad Vargas Ríos", fechaNacimiento: "1994-02-14", sexo: "Femenino", telefono: "70501104",
    antecedentesPersonales: ["Un parto vaginal (hace 5 meses)"],
    antecedentesFamiliares: [],
    // Embarazo YA TERMINADO: sirve para mostrar el cierre con desenlace.
    embarazoCerrado: { semanasAlParto: 39, mesesDesdeParto: 5, desenlace: "parto_vaginal", notas: "Parto vaginal a las 39 semanas, sin complicaciones. Recién nacido de 3.250 kg." },
    consultas: [
      { mesesAtras: 6, motivoConsulta: "Control de término", sintomas: [], antecedentesRelevantes: "Embarazo de curso normal", diagnostico: "Embarazo de 38 semanas, presentación cefálica", diagnosticosDiferenciales: [], plan: "Control semanal hasta el parto. Signos de alarma explicados", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 1 semana", transcripcionCompleta: "Doctora, ya estoy con muchas ganas de que nazca. Está todo perfecto, el bebé está encajado y de cabeza. Podés entrar en trabajo de parto cualquier día de estos.", duracionSegundos: 300 },
      { mesesAtras: 4, motivoConsulta: "Control puerperal", sintomas: [], antecedentesRelevantes: "Parto vaginal hace 4 semanas", diagnostico: "Puerperio de evolución normal", diagnosticosDiferenciales: [], plan: "Lactancia a demanda. Retomar anticoncepción, control ginecológico anual", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 6 meses", transcripcionCompleta: "Doctora, la lactancia va bien, aunque estoy cansada. El útero ya involucionó bien y la episiotomía cicatrizó perfecto. Vamos a conversar sobre anticoncepción compatible con la lactancia.", duracionSegundos: 360 },
    ],
    medicamentos: [{ nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "1 vez al día", mesesInicio: 6, mesesFin: 3 }],
    mediciones: [
      { tipo: "peso", valor: 74, mesesAtras: 6 }, { tipo: "peso", valor: 66, mesesAtras: 4 }, { tipo: "peso", valor: 62, mesesAtras: 1 },
      { tipo: "presion", valor: 116, valorSecundario: 74, mesesAtras: 6 },
      { tipo: "presion", valor: 112, valorSecundario: 70, mesesAtras: 1 },
    ],
    estudios: [
      { tipo: "ecografia", nombre: "Ecografía de término (semana 38)", mesesAtras: 6, lineas: ["Ecografia obstetrica - Gabriela Soledad Vargas Rios", "Feto unico vivo, presentacion cefalica encajada", "Peso fetal estimado: 3150 g", "Liquido amniotico normal", "Placenta grado III"] },
    ],
  },
  {
    nombre: "Rosa María Colque Aduviri", fechaNacimiento: "1978-06-09", sexo: "Femenino", telefono: "70501105",
    gineco: [{ organo: "utero", hallazgo: "mioma", notas: "Mioma intramural en cara posterior de 42 mm", mesesAtras: 3 }],
    antecedentesPersonales: ["Miomatosis uterina", "Dos partos vaginales previos"],
    antecedentesFamiliares: [{ parentesco: "Hermana", condicion: "Cáncer de mama" }],
    consultas: [
      { mesesAtras: 5, motivoConsulta: "Sangrado menstrual abundante", sintomas: ["menorragia", "cansancio"], antecedentesRelevantes: "Dos partos vaginales previos", diagnostico: "Miomatosis uterina con anemia secundaria", diagnosticosDiferenciales: ["pólipo endometrial"], plan: "Ecografía transvaginal, hemograma, iniciar hierro", medicamentosRecetados: [{ nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "2 veces al día" }], examenesSolicitados: ["ecografía transvaginal", "hemograma"], proximoControl: "En 1 mes", transcripcionCompleta: "Doctora, hace meses que sangro muchísimo en cada regla y ando siempre cansada. Vamos a pedir una ecografía transvaginal y un hemograma. Sospecho miomas, y el cansancio puede ser por anemia.", duracionSegundos: 400 },
      { mesesAtras: 3, motivoConsulta: "Control con resultados", sintomas: ["menorragia persistente"], antecedentesRelevantes: "Ecografía confirma mioma intramural de 4 cm", diagnostico: "Miomatosis uterina sintomática, anemia ferropénica en tratamiento", diagnosticosDiferenciales: [], plan: "Continuar hierro, evaluar tratamiento hormonal vs. quirúrgico", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 2 meses", transcripcionCompleta: "Doctora, la ecografía muestra un mioma intramural de cuatro centímetros y la hemoglobina bajó a nueve con dos. Vamos a seguir con el hierro y conversar las opciones de tratamiento.", duracionSegundos: 380 },
      { mesesAtras: 0, motivoConsulta: "Control ginecológico anual y seguimiento", sintomas: [], antecedentesRelevantes: "Hemoglobina en recuperación con hierro oral", diagnostico: "Miomatosis uterina estable, anemia corregida", diagnosticosDiferenciales: [], plan: "Papanicolau anual, mamografía por antecedente familiar, control en 6 meses", medicamentosRecetados: [], examenesSolicitados: ["papanicolau", "mamografía"], proximoControl: "En 6 meses", transcripcionCompleta: "Doctora, me siento con mucha más energía y el sangrado bajó bastante. La hemoglobina subió a once con ocho. Aprovechamos para el papanicolau anual, y por el antecedente de tu hermana te pido también una mamografía.", duracionSegundos: 420 },
    ],
    medicamentos: [{ nombre: "Sulfato ferroso", dosis: "60mg", frecuencia: "2 veces al día", mesesInicio: 5, mesesFin: null }],
    mediciones: [
      { tipo: "peso", valor: 68, mesesAtras: 5 }, { tipo: "peso", valor: 67, mesesAtras: 0 },
      { tipo: "presion", valor: 126, valorSecundario: 82, mesesAtras: 5 },
      { tipo: "presion", valor: 122, valorSecundario: 78, mesesAtras: 0 },
    ],
    estudios: [
      { tipo: "ecografia", nombre: "Ecografía transvaginal", mesesAtras: 3, lineas: ["Ecografia transvaginal - Rosa Maria Colque Aduviri", "Utero en anteversoflexion, 98 x 62 x 70 mm", "Mioma intramural en cara posterior de 42 mm", "Endometrio de 8 mm, homogeneo", "Ovarios de aspecto normal"] },
      { tipo: "laboratorio", nombre: "Hemograma", mesesAtras: 3, lineas: ["Laboratorio - Rosa Maria Colque Aduviri", "Hemoglobina: 9.2 g/dL (baja)", "Hematocrito: 28%", "VCM: 74 fL - anemia microcitica", "Ferritina: 8 ng/mL (baja)"] },
      { tipo: "laboratorio", nombre: "Hemograma de control", mesesAtras: 0, lineas: ["Laboratorio - Rosa Maria Colque Aduviri", "Hemoglobina: 11.8 g/dL", "Hematocrito: 36%", "Ferritina: 34 ng/mL", "Evolucion favorable con hierro oral"] },
    ],
  },
  {
    nombre: "Andrea Paola Mendoza Sillerico", fechaNacimiento: "1999-09-21", sexo: "Femenino", telefono: "70501106",
    gineco: [
      { organo: "ovario_derecho", hallazgo: "quiste", notas: "12 folículos periféricos, patrón poliquístico", mesesAtras: 3 },
      { organo: "ovario_izquierdo", hallazgo: "quiste", notas: "14 folículos periféricos, patrón poliquístico", mesesAtras: 3 },
    ],
    antecedentesPersonales: ["Síndrome de ovario poliquístico"],
    antecedentesFamiliares: [{ parentesco: "Madre", condicion: "Diabetes tipo 2" }],
    consultas: [
      { mesesAtras: 4, motivoConsulta: "Ciclos irregulares y acné", sintomas: ["oligomenorrea", "acné", "aumento de peso"], antecedentesRelevantes: "Ciclos irregulares desde la adolescencia", diagnostico: "Sospecha de síndrome de ovario poliquístico", diagnosticosDiferenciales: ["hipotiroidismo", "hiperprolactinemia"], plan: "Ecografía transvaginal, perfil hormonal, perfil tiroideo", medicamentosRecetados: [], examenesSolicitados: ["ecografía transvaginal", "perfil hormonal", "perfil tiroideo"], proximoControl: "En 1 mes", transcripcionCompleta: "Doctora, me viene la regla cada dos o tres meses y tengo mucho acné. Vamos a estudiarlo bien: pedimos ecografía, perfil hormonal y también tiroides, porque hay otras causas que dan lo mismo.", duracionSegundos: 400 },
      { mesesAtras: 2, motivoConsulta: "Control con resultados", sintomas: [], antecedentesRelevantes: "Ecografía con ovarios de aspecto poliquístico, tiroides normal", diagnostico: "Síndrome de ovario poliquístico", diagnosticosDiferenciales: [], plan: "Cambios en el estilo de vida, metformina, anticonceptivo para regularizar ciclos", medicamentosRecetados: [{ nombre: "Metformina", dosis: "850mg", frecuencia: "1 vez al día" }], examenesSolicitados: [], proximoControl: "En 3 meses", transcripcionCompleta: "Doctora, la ecografía confirma ovarios poliquísticos y la tiroides salió normal. Entonces es síndrome de ovario poliquístico. Vamos a trabajar con alimentación, actividad física y metformina.", duracionSegundos: 440 },
      { mesesAtras: 0, motivoConsulta: "Control de SOP", sintomas: ["ciclos más regulares"], antecedentesRelevantes: "Buena adherencia al tratamiento", diagnostico: "Síndrome de ovario poliquístico en mejor control", diagnosticosDiferenciales: [], plan: "Continuar esquema, control en 4 meses", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 4 meses", transcripcionCompleta: "Doctora, este último tiempo me vino la regla dos veces seguidas casi en fecha y bajé unos kilos. Excelente, eso indica que estás ovulando mejor. Seguimos igual.", duracionSegundos: 300 },
    ],
    medicamentos: [{ nombre: "Metformina", dosis: "850mg", frecuencia: "1 vez al día", mesesInicio: 2, mesesFin: null }],
    mediciones: [
      { tipo: "peso", valor: 78, mesesAtras: 4 }, { tipo: "peso", valor: 76, mesesAtras: 2 }, { tipo: "peso", valor: 73, mesesAtras: 0 },
      { tipo: "glucosa", valor: 104, mesesAtras: 4 }, { tipo: "glucosa", valor: 96, mesesAtras: 0 },
      { tipo: "imc", valor: 29, mesesAtras: 4 }, { tipo: "imc", valor: 27, mesesAtras: 0 },
    ],
    estudios: [
      { tipo: "ecografia", nombre: "Ecografía transvaginal", mesesAtras: 3, lineas: ["Ecografia transvaginal - Andrea Paola Mendoza Sillerico", "Utero de tamano normal, endometrio 6 mm", "Ovario derecho: 12 foliculos perifericos, volumen 11 cc", "Ovario izquierdo: 14 foliculos perifericos, volumen 12 cc", "Hallazgos compatibles con ovarios poliquisticos"] },
      { tipo: "laboratorio", nombre: "Perfil hormonal y tiroideo", mesesAtras: 3, lineas: ["Laboratorio - Andrea Paola Mendoza Sillerico", "LH/FSH: 2.6 (elevado)", "Testosterona total: 78 ng/dL (limite alto)", "TSH: 2.4 mUI/L (normal)", "Prolactina: 14 ng/mL (normal)"] },
    ],
  },
  {
    nombre: "Lucía Beatriz Flores Aramayo", fechaNacimiento: "1985-12-05", sexo: "Femenino", telefono: "70501107",
    gineco: [{ organo: "cuello_uterino", hallazgo: "normal", notas: "Colposcopía sin lesión intraepitelial, test de Schiller negativo", mesesAtras: 4 }],
    antecedentesPersonales: ["Papanicolau con ASCUS hace 1 año"],
    antecedentesFamiliares: [],
    consultas: [
      { mesesAtras: 6, motivoConsulta: "Control con papanicolau alterado", sintomas: [], antecedentesRelevantes: "Papanicolau previo con ASCUS", diagnostico: "ASCUS en papanicolau, pendiente estudio", diagnosticosDiferenciales: [], plan: "Colposcopía y test de VPH", medicamentosRecetados: [], examenesSolicitados: ["colposcopía", "test de VPH"], proximoControl: "En 1 mes", transcripcionCompleta: "Doctora, me llamaron porque el papanicolau salió alterado. Salió ASCUS, que son células atípicas de significado indeterminado. No es cáncer. Vamos a completar el estudio con colposcopía y test de VPH.", duracionSegundos: 420 },
      { mesesAtras: 4, motivoConsulta: "Resultado de colposcopía y VPH", sintomas: [], antecedentesRelevantes: "Colposcopía sin lesión, VPH de alto riesgo negativo", diagnostico: "ASCUS con VPH negativo, riesgo bajo", diagnosticosDiferenciales: [], plan: "Repetir papanicolau en 12 meses", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 12 meses", transcripcionCompleta: "Doctora, ¿salió bien? Sí, muy buenas noticias: la colposcopía no mostró ninguna lesión y el test de VPH de alto riesgo salió negativo. Con eso el riesgo es muy bajo, repetimos el papanicolau en un año.", duracionSegundos: 350 },
    ],
    medicamentos: [],
    mediciones: [{ tipo: "peso", valor: 64, mesesAtras: 6 }, { tipo: "presion", valor: 118, valorSecundario: 76, mesesAtras: 4 }],
    estudios: [
      { tipo: "laboratorio", nombre: "Papanicolau", mesesAtras: 6, lineas: ["Citologia cervical - Lucia Beatriz Flores Aramayo", "ASCUS - celulas escamosas atipicas de significado indeterminado", "Sin celulas endocervicales atipicas", "Se sugiere completar estudio"] },
      { tipo: "otro", nombre: "Colposcopía", mesesAtras: 4, lineas: ["Colposcopia - Lucia Beatriz Flores Aramayo", "Union escamocolumnar visible", "Sin imagenes de lesion intraepitelial", "Test de Schiller negativo", "No se toma biopsia"] },
      { tipo: "laboratorio", nombre: "Test de VPH de alto riesgo", mesesAtras: 4, lineas: ["Test de VPH - Lucia Beatriz Flores Aramayo", "VPH alto riesgo: NEGATIVO", "Genotipos 16 y 18: no detectados"] },
    ],
  },
  {
    nombre: "Mariana Isabel Choque Zeballos", fechaNacimiento: "1972-03-17", sexo: "Femenino", telefono: "70501108",
    gineco: [
      { organo: "endometrio", hallazgo: "engrosamiento", notas: "Endometrio de 11 mm, se controla evolución", mesesAtras: 2 },
      { organo: "mama_derecha", hallazgo: "nodulo", notas: "Nódulo palpable de 1 cm, cuadrante superoexterno", mesesAtras: 2 },
    ],
    antecedentesPersonales: ["Perimenopausia"],
    antecedentesFamiliares: [{ parentesco: "Madre", condicion: "Osteoporosis" }],
    consultas: [
      { mesesAtras: 5, motivoConsulta: "Sofocos y ciclos irregulares", sintomas: ["sofocos", "insomnio", "irritabilidad"], antecedentesRelevantes: "Ciclos irregulares desde hace 8 meses", diagnostico: "Perimenopausia sintomática", diagnosticosDiferenciales: ["disfunción tiroidea"], plan: "Perfil hormonal y tiroideo, densitometría por antecedente familiar", medicamentosRecetados: [], examenesSolicitados: ["perfil hormonal", "densitometría ósea"], proximoControl: "En 6 semanas", transcripcionCompleta: "Doctora, tengo unos calores insoportables sobre todo de noche y no duermo bien. Es muy compatible con la perimenopausia. Igual pedimos hormonas y tiroides para confirmar, y una densitometría porque tu mamá tuvo osteoporosis.", duracionSegundos: 430 },
      { mesesAtras: 2, motivoConsulta: "Control con resultados", sintomas: ["sofocos persistentes"], antecedentesRelevantes: "FSH elevada, densitometría con osteopenia", diagnostico: "Perimenopausia con osteopenia", diagnosticosDiferenciales: [], plan: "Calcio y vitamina D, actividad física con carga, evaluar terapia hormonal", medicamentosRecetados: [{ nombre: "Calcio + Vitamina D", dosis: "600mg/400UI", frecuencia: "2 veces al día" }], examenesSolicitados: [], proximoControl: "En 4 meses", transcripcionCompleta: "Doctora, la FSH está elevada, lo que confirma la perimenopausia. La densitometría muestra osteopenia, todavía no osteoporosis. Empezamos calcio con vitamina D y ejercicio con carga.", duracionSegundos: 460 },
    ],
    medicamentos: [{ nombre: "Calcio + Vitamina D", dosis: "600mg/400UI", frecuencia: "2 veces al día", mesesInicio: 2, mesesFin: null }],
    mediciones: [
      { tipo: "peso", valor: 71, mesesAtras: 5 }, { tipo: "peso", valor: 70, mesesAtras: 2 },
      { tipo: "presion", valor: 128, valorSecundario: 84, mesesAtras: 5 },
      { tipo: "presion", valor: 124, valorSecundario: 80, mesesAtras: 2 },
      { tipo: "colesterol", valor: 218, mesesAtras: 5 }, { tipo: "colesterol", valor: 198, mesesAtras: 2 },
    ],
    estudios: [
      { tipo: "laboratorio", nombre: "Perfil hormonal", mesesAtras: 3, lineas: ["Laboratorio - Mariana Isabel Choque Zeballos", "FSH: 42 mUI/mL (elevada)", "Estradiol: 22 pg/mL (bajo)", "TSH: 1.9 mUI/L (normal)", "Compatible con transicion menopausica"] },
      { tipo: "otro", nombre: "Densitometría ósea", mesesAtras: 3, lineas: ["Densitometria osea - Mariana Isabel Choque Zeballos", "Columna lumbar L1-L4: T-score -1.8 (osteopenia)", "Cuello femoral: T-score -1.4 (osteopenia)", "Se sugiere suplementacion y ejercicio con carga"] },
    ],
  },
];

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "Dra. Andrea Salvatierra").trim();
  const passwordGenerada = !process.argv[4];
  const password = String(process.argv[4] || CLAVE_DEMO).trim();
  if (!phone) {
    console.error('Uso: node scripts/seed_ginecologia_demo.js <telefono> ["Nombre"] [password]');
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");
  fs.mkdirSync(DIR_ESTUDIOS, { recursive: true });

  let medico = await Medico.findOne({ phone });
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, especialidad: "Ginecología y Obstetricia", tipoEspecialidad: "ginecologia",
      passwordHash: await hashPassword(password), activo: true,
    });
    console.log(`✅ Cuenta creada: ${nombre} (+${phone}) — contraseña${passwordGenerada ? " de prueba" : ""}: ${password}`);
  } else if (medico.tipoEspecialidad !== "ginecologia") {
    medico.tipoEspecialidad = "ginecologia";
    await medico.save();
    console.log(`ℹ️  La cuenta +${phone} ya existía (${medico.nombre}) — la pasé a ginecología. Contraseña sin cambios.`);
  } else {
    console.log(`ℹ️  La cuenta +${phone} ya existía y ya era de ginecología (${medico.nombre}). Contraseña sin cambios.`);
  }

  let creadas = 0, salteadas = 0;

  for (const base of PACIENTES_DEMO) {
    let paciente = await Paciente.findOne({ medicoPhone: phone, nombre: base.nombre });
    if (!paciente) {
      paciente = await Paciente.create({
        medicoPhone: phone, nombre: base.nombre, fechaNacimiento: new Date(base.fechaNacimiento),
        sexo: base.sexo, telefono: base.telefono,
        antecedentesPersonales: base.antecedentesPersonales || [],
        antecedentesFamiliares: base.antecedentesFamiliares || [],
      });
    }

    if (await ConsultaMedica.countDocuments({ pacienteId: paciente._id }) > 0) {
      console.log(`⏭️  Ya tiene historia cargada: ${base.nombre} — salteada`);
      salteadas++;
      continue;
    }

    for (const c of base.consultas) {
      const fecha = hace(c.mesesAtras);
      const consulta = await ConsultaMedica.create({
        medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
        estado: "completado", duracionSegundos: c.duracionSegundos,
        transcripcionCompleta: c.transcripcionCompleta,
        segmentos: generarSegmentos(c.transcripcionCompleta, c.duracionSegundos),
        notaClinicaEstado: "completado",
        notaClinica: {
          motivoConsulta: c.motivoConsulta, sintomas: c.sintomas, antecedentesRelevantes: c.antecedentesRelevantes,
          diagnostico: c.diagnostico, diagnosticosDiferenciales: c.diagnosticosDiferenciales, plan: c.plan,
          medicamentosRecetados: c.medicamentosRecetados, examenesSolicitados: c.examenesSolicitados,
          proximoControl: c.proximoControl,
        },
        confirmadaEn: fecha,
      });
      // Mongoose pisa createdAt/updatedAt en cada .save() por {timestamps:true},
      // así que la fecha vieja solo queda con un update directo a la colección.
      await ConsultaMedica.collection.updateOne({ _id: consulta._id }, { $set: { createdAt: fecha, updatedAt: fecha } });
    }

    for (const m of base.medicamentos) {
      await Medicamento.create({
        pacienteId: paciente._id, medicoPhone: phone, nombre: m.nombre, dosis: m.dosis, frecuencia: m.frecuencia,
        fechaInicio: hace(m.mesesInicio), fechaFin: m.mesesFin != null ? hace(m.mesesFin) : null,
      });
    }

    for (const med of base.mediciones) {
      await Medicion.create({
        pacienteId: paciente._id, medicoPhone: phone, tipo: med.tipo, valor: med.valor,
        valorSecundario: med.valorSecundario ?? null, fecha: hace(med.mesesAtras),
      });
    }

    for (const e of base.estudios) {
      const archivoNombre = crypto.randomUUID() + ".pdf";
      const contenido = crearPdfSimple(e.lineas);
      fs.writeFileSync(path.join(DIR_ESTUDIOS, archivoNombre), contenido);
      await Estudio.create({
        pacienteId: paciente._id, medicoPhone: phone, tipo: e.tipo, nombre: e.nombre,
        archivoNombre, archivoMime: "application/pdf", archivoTamano: contenido.length,
        fecha: hace(e.mesesAtras),
      });
    }

    // Mapa ginecológico: solo se crea si esta paciente tiene hallazgos, con
    // los demás órganos en normal.
    if (base.gineco?.length) {
      const organos = ORGANOS_GINECO.map(organo => {
        const h = base.gineco.find(x => x.organo === organo);
        if (!h) return { organo, hallazgo: "normal", notas: "", historial: [] };
        return {
          organo, hallazgo: h.hallazgo, notas: h.notas,
          historial: [{ fecha: hace(h.mesesAtras), hallazgo: h.hallazgo, notas: h.notas, fuente: "voz" }],
        };
      });
      await ExamenGinecologico.findOneAndUpdate(
        { pacienteId: paciente._id },
        { pacienteId: paciente._id, medicoPhone: phone, organos },
        { upsert: true }
      );
    }

    // Embarazo en curso: la FUM se calcula hacia atrás desde las semanas que
    // tiene que mostrar HOY, para que la demo siempre dé números coherentes.
    if (base.embarazo) {
      const fum = haceDias(base.embarazo.semanasHoy * 7);
      await Embarazo.create({
        pacienteId: paciente._id, medicoPhone: phone,
        fum, fpp: new Date(fum.getTime() + 280 * 24 * 60 * 60 * 1000),
        activo: true, notas: base.embarazo.notas,
      });
    }

    // Embarazo ya terminado, para mostrar el cierre con desenlace.
    if (base.embarazoCerrado) {
      const ec = base.embarazoCerrado;
      const fechaParto = hace(ec.mesesDesdeParto);
      const fum = new Date(fechaParto.getTime() - ec.semanasAlParto * 7 * 24 * 60 * 60 * 1000);
      await Embarazo.create({
        pacienteId: paciente._id, medicoPhone: phone,
        fum, fpp: new Date(fum.getTime() + 280 * 24 * 60 * 60 * 1000),
        activo: false, fechaFin: fechaParto, desenlace: ec.desenlace, notas: ec.notas,
      });
    }

    // Brief Clínico ya armado, para que se vea completo sin depender de que
    // OpenAI responda rápido en plena demo.
    const ultima = base.consultas[base.consultas.length - 1];
    paciente.antecedentesPersonales = base.antecedentesPersonales || [];
    paciente.antecedentesFamiliares = base.antecedentesFamiliares || [];
    paciente.briefClinicoEstado = "completado";
    paciente.briefClinicoActualizadoEn = new Date();
    paciente.briefClinico = {
      estadoActual: ultima.diagnostico || null,
      cambiosDesdeUltimaConsulta: base.consultas.length > 1 ? "Evolución favorable respecto al control anterior." : null,
      medicamentosActivos: base.medicamentos.filter(m => m.mesesFin == null).map(m => `${m.nombre} ${m.dosis}`.trim()),
      examenesPendientes: ultima.examenesSolicitados || [],
      alertas: [],
      factoresRiesgo: (base.antecedentesFamiliares || []).map(a => `${a.parentesco}: ${a.condicion}`),
      preguntasSugeridas: [],
    };
    await paciente.save();

    const detalle = [
      `${base.consultas.length} consulta(s)`,
      `${base.estudios.length} estudio(s)`,
      `${base.mediciones.length} control(es)`,
      base.embarazo ? `embarazo de ${base.embarazo.semanasHoy} semanas` : null,
      base.embarazoCerrado ? `embarazo cerrado (${base.embarazoCerrado.desenlace.replace("_", " ")})` : null,
      base.gineco?.length ? `${base.gineco.length} hallazgo(s) en el mapa` : null,
    ].filter(Boolean).join(" · ");
    console.log(`✅ ${base.nombre} — ${detalle}`);
    creadas++;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🏁 Listo. Pacientes cargadas: ${creadas} · Ya existían: ${salteadas}`);
  console.log(`\nEntrá con: teléfono ${phone} / la contraseña de arriba (si la cuenta era nueva).`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
