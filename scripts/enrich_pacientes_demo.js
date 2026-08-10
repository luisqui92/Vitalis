// Vitalis — le suma historia clínica larga a los pacientes de demo que ya
// existen (los que creó antes scripts/seed_pacientes_demo.js): más
// consultas espaciadas en el tiempo, medicamentos activos/pasados, vacunas,
// evolución clínica (signos vitales con tendencia), estudios (con archivo
// real, para que se puedan abrir) y una receta por paciente.
//
// Uso: node scripts/enrich_pacientes_demo.js <telefono_del_medico>
// Ej:  node scripts/enrich_pacientes_demo.js 62741818
//
// Es idempotente: si un paciente ya tiene más de una consulta (señal de que
// ya se enriqueció antes), lo salta.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, Vacuna, Medicion, Estudio, Receta } = require("../db/models");

function hace(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d;
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

// PDF mínimo pero válido, para que los "estudios" de demo se puedan abrir
// de verdad (no hace falta que sea un PDF real de un laboratorio).
function crearPdfSimple(lineas) {
  const contenido = lineas.map((l, i) => `BT /F1 12 Tf 50 ${740 - i * 20} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const stream = `${contenido}`;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length ${stream.length}>>
stream
${stream}
endstream
endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
  return Buffer.from(pdf, "utf-8");
}

const DIR_ESTUDIOS = path.join(__dirname, "..", "uploads", "estudios");

const HISTORIAS = {
  "María Elena Rojas": {
    consultasExtra: [
      { mesesAtras: 5, motivoConsulta: "Control de presión arterial", sintomas: ["cefalea leve"], antecedentesRelevantes: "Hipertensión diagnosticada hace 5 años", diagnostico: "Hipertensión arterial no controlada", diagnosticosDiferenciales: [], plan: "Ajuste de dosis, control de sal", medicamentosRecetados: [{ nombre: "Losartán", dosis: "50mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["perfil lipídico"], proximoControl: "En 2 meses", transcripcionCompleta: "Doctor, vengo por el control de presión. Está en 145 sobre 92, un poco alta todavía. Vamos a mantener el Losartán y agregar un diurético suave.", duracionSegundos: 380 },
      { mesesAtras: 3, motivoConsulta: "Control de presión, seguimiento", sintomas: [], antecedentesRelevantes: "En tratamiento con Losartán + Hidroclorotiazida", diagnostico: "Hipertensión arterial en mejor control", diagnosticosDiferenciales: [], plan: "Continuar esquema actual, control en 2 meses", medicamentosRecetados: [{ nombre: "Hidroclorotiazida", dosis: "12.5mg", frecuencia: "1 vez al día" }], examenesSolicitados: [], proximoControl: "En 2 meses", transcripcionCompleta: "Doctor, me he estado sintiendo mejor, menos dolor de cabeza. La presión ahora está en 138 sobre 88, vamos mejorando. Seguimos igual con la medicación.", duracionSegundos: 300 },
      { mesesAtras: 1, motivoConsulta: "Control de presión", sintomas: [], antecedentesRelevantes: "Buena adherencia al tratamiento", diagnostico: "Hipertensión arterial controlada", diagnosticosDiferenciales: [], plan: "Mantener esquema, agregar aspirina preventiva, control en 3 meses", medicamentosRecetados: [{ nombre: "Aspirina", dosis: "100mg", frecuencia: "1 vez al día" }], examenesSolicitados: [], proximoControl: "En 3 meses", transcripcionCompleta: "Doctor, la presión ahora está en 128 sobre 82, muy buen control. Vamos a agregar una aspirina de baja dosis como prevención cardiovascular.", duracionSegundos: 260 },
    ],
    medicamentos: [
      { nombre: "Losartán", dosis: "50mg", frecuencia: "1 vez al día", mesesInicio: 5, mesesFin: null },
      { nombre: "Hidroclorotiazida", dosis: "12.5mg", frecuencia: "1 vez al día", mesesInicio: 3, mesesFin: null },
      { nombre: "Aspirina", dosis: "100mg", frecuencia: "1 vez al día", mesesInicio: 1, mesesFin: null },
    ],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 4 }, { nombre: "Antitetánica", dosis: "Refuerzo", mesesAtras: 8 }],
    mediciones: [
      { tipo: "presion", valor: 145, valorSecundario: 92, mesesAtras: 5 },
      { tipo: "presion", valor: 138, valorSecundario: 88, mesesAtras: 3 },
      { tipo: "presion", valor: 132, valorSecundario: 85, mesesAtras: 2 },
      { tipo: "presion", valor: 128, valorSecundario: 82, mesesAtras: 1 },
      { tipo: "peso", valor: 71, mesesAtras: 3 },
      { tipo: "colesterol", valor: 210, mesesAtras: 5 },
    ],
    estudios: [
      { tipo: "laboratorio", nombre: "Perfil lipídico", mesesAtras: 5, lineas: ["Perfil lipídico — María Elena Rojas", "Colesterol total: 210 mg/dL", "LDL: 135 mg/dL", "HDL: 48 mg/dL", "Triglicéridos: 160 mg/dL"] },
      { tipo: "ecg", nombre: "Electrocardiograma de control", mesesAtras: 3, lineas: ["ECG — María Elena Rojas", "Ritmo sinusal, sin alteraciones agudas", "FC: 76 lpm"] },
    ],
  },
  "Carlos Mamani Choque": {
    consultasExtra: [
      { mesesAtras: 6, motivoConsulta: "Control de diabetes", sintomas: ["poliuria", "polidipsia"], antecedentesRelevantes: "Diabetes tipo 2, 3 años de evolución", diagnostico: "Diabetes tipo 2 con control subóptimo", diagnosticosDiferenciales: [], plan: "Ajuste de metformina, reforzar dieta", medicamentosRecetados: [{ nombre: "Metformina", dosis: "850mg", frecuencia: "2 veces al día" }], examenesSolicitados: ["hemoglobina glicosilada"], proximoControl: "En 3 meses", transcripcionCompleta: "Doctor, sigo con sed y yendo mucho al baño. La hemoglobina glicosilada salió en 8.2%, todavía alta. Vamos a subir la metformina y reforzar la dieta.", duracionSegundos: 350 },
      { mesesAtras: 3, motivoConsulta: "Control de diabetes, seguimiento", sintomas: [], antecedentesRelevantes: "Mejoría parcial con ajuste de metformina", diagnostico: "Diabetes tipo 2, mejor control", diagnosticosDiferenciales: [], plan: "Agregar segundo hipoglucemiante, control en 3 meses", medicamentosRecetados: [{ nombre: "Glibenclamida", dosis: "5mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["glucosa en ayunas"], proximoControl: "En 3 meses", transcripcionCompleta: "Doctor, me he sentido mejor, menos cansado. La glucosa en ayunas bajó a 145. Vamos a agregar otro medicamento para terminar de controlarla.", duracionSegundos: 310 },
      { mesesAtras: 1, motivoConsulta: "Control de diabetes", sintomas: [], antecedentesRelevantes: "Buena respuesta al esquema combinado", diagnostico: "Diabetes tipo 2 casi en meta", diagnosticosDiferenciales: [], plan: "Mantener esquema actual, control en 2 meses", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 2 meses", transcripcionCompleta: "Doctor, la glucosa ahora está en 118 en ayunas, mucho mejor. Sigamos igual con la metformina y la glibenclamida.", duracionSegundos: 240 },
    ],
    medicamentos: [
      { nombre: "Metformina", dosis: "850mg", frecuencia: "2 veces al día", mesesInicio: 6, mesesFin: null },
      { nombre: "Glibenclamida", dosis: "5mg", frecuencia: "1 vez al día", mesesInicio: 3, mesesFin: null },
    ],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 5 }, { nombre: "Neumococo", dosis: "Única", mesesAtras: 10 }],
    mediciones: [
      { tipo: "glucosa", valor: 180, mesesAtras: 6 },
      { tipo: "glucosa", valor: 145, mesesAtras: 3 },
      { tipo: "glucosa", valor: 130, mesesAtras: 2 },
      { tipo: "glucosa", valor: 118, mesesAtras: 1 },
      { tipo: "peso", valor: 84, mesesAtras: 4 },
      { tipo: "peso", valor: 81, mesesAtras: 1 },
    ],
    estudios: [
      { tipo: "laboratorio", nombre: "Hemoglobina glicosilada", mesesAtras: 6, lineas: ["Laboratorio — Carlos Mamani Choque", "Hemoglobina glicosilada (HbA1c): 8.2%", "Glucosa en ayunas: 178 mg/dL"] },
      { tipo: "laboratorio", nombre: "Hemoglobina glicosilada — control", mesesAtras: 1, lineas: ["Laboratorio — Carlos Mamani Choque", "Hemoglobina glicosilada (HbA1c): 6.9%", "Glucosa en ayunas: 118 mg/dL", "Mejoría significativa respecto a control previo"] },
    ],
  },
  "Sofía Fernández Rivas": {
    consultasExtra: [
      { mesesAtras: 4, motivoConsulta: "Control por asma, episodio de tos nocturna", sintomas: ["tos nocturna", "sibilancias"], antecedentesRelevantes: "Crisis asmática leve hace 4 meses", diagnostico: "Asma leve intermitente", diagnosticosDiferenciales: [], plan: "Iniciar controlador diario, salbutamol de rescate", medicamentosRecetados: [{ nombre: "Budesonida", dosis: "inhalador", frecuencia: "2 veces al día" }], examenesSolicitados: [], proximoControl: "En 2 meses", transcripcionCompleta: "Doctora, mi hija sigue con tos de noche a veces. Vamos a empezar un inhalador de control diario además del salbutamol para cuando le pasa.", duracionSegundos: 280 },
      { mesesAtras: 1, motivoConsulta: "Control de asma", sintomas: [], antecedentesRelevantes: "Buena respuesta al controlador", diagnostico: "Asma leve bien controlada", diagnosticosDiferenciales: [], plan: "Continuar esquema, control en 3 meses", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 3 meses", transcripcionCompleta: "Doctora, casi no ha tosido de noche desde que empezó el inhalador diario. Muy buena evolución, seguimos igual.", duracionSegundos: 200 },
    ],
    medicamentos: [
      { nombre: "Salbutamol", dosis: "inhalador", frecuencia: "según necesidad", mesesInicio: 4, mesesFin: null },
      { nombre: "Budesonida", dosis: "inhalador", frecuencia: "2 veces al día", mesesInicio: 4, mesesFin: null },
    ],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 3 }, { nombre: "Pentavalente", dosis: "Refuerzo", mesesAtras: 12 }],
    mediciones: [
      { tipo: "saturacion", valor: 96, mesesAtras: 4 },
      { tipo: "saturacion", valor: 98, mesesAtras: 1 },
      { tipo: "peso", valor: 24, mesesAtras: 2 },
    ],
    estudios: [
      { tipo: "otro", nombre: "Espirometría", mesesAtras: 4, lineas: ["Espirometría — Sofía Fernández Rivas", "Patrón compatible con vía aérea reactiva leve", "Buena respuesta a broncodilatador"] },
    ],
  },
  "Juan Condori Apaza": {
    consultasExtra: [
      { mesesAtras: 3, motivoConsulta: "Control por gastritis", sintomas: ["ardor epigástrico leve"], antecedentesRelevantes: "Gastritis crónica en tratamiento", diagnostico: "Gastritis crónica, mejoría parcial", diagnosticosDiferenciales: [], plan: "Continuar omeprazol, solicitar endoscopía de control", medicamentosRecetados: [{ nombre: "Omeprazol", dosis: "20mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["endoscopía"], proximoControl: "Con resultado de endoscopía", transcripcionCompleta: "Doctor, sigo con algo de ardor pero menos que antes. Vamos a pedirle una endoscopía para ver bien cómo está el estómago.", duracionSegundos: 300 },
      { mesesAtras: 1, motivoConsulta: "Control con resultado de endoscopía", sintomas: [], antecedentesRelevantes: "Endoscopía sin lesiones significativas", diagnostico: "Gastritis crónica leve, endoscopía sin alarma", diagnosticosDiferenciales: [], plan: "Continuar omeprazol 4 semanas más, evitar irritantes", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 2 meses si persisten síntomas", transcripcionCompleta: "Doctor, la endoscopía salió bien, solo gastritis leve, nada grave. Vamos a seguir con el omeprazol un tiempo más.", duracionSegundos: 260 },
    ],
    medicamentos: [{ nombre: "Omeprazol", dosis: "20mg", frecuencia: "1 vez al día, en ayunas", mesesInicio: 3, mesesFin: null }],
    vacunas: [{ nombre: "Hepatitis A", dosis: "Única", mesesAtras: 6 }, { nombre: "Influenza", dosis: "Anual", mesesAtras: 4 }],
    mediciones: [{ tipo: "peso", valor: 78, mesesAtras: 3 }, { tipo: "peso", valor: 77, mesesAtras: 1 }],
    estudios: [{ tipo: "laboratorio", nombre: "Endoscopía digestiva alta", mesesAtras: 1, lineas: ["Endoscopía — Juan Condori Apaza", "Mucosa gástrica con gastritis leve", "Sin lesiones ulcerosas ni signos de alarma", "Test de H. pylori: negativo"] }],
  },
  "Ana Paola Vargas": {
    consultasExtra: [
      { mesesAtras: 4, motivoConsulta: "Migraña, crisis más frecuentes", sintomas: ["cefalea pulsátil", "náuseas"], antecedentesRelevantes: "Migraña sin aura, episodios más seguidos últimamente", diagnostico: "Migraña sin aura, aumento de frecuencia", diagnosticosDiferenciales: [], plan: "Iniciar profilaxis, solicitar resonancia para descartar causas secundarias", medicamentosRecetados: [{ nombre: "Propranolol", dosis: "40mg", frecuencia: "1 vez al día" }], examenesSolicitados: ["resonancia magnética cerebral"], proximoControl: "Con resultado de resonancia", transcripcionCompleta: "Doctor, me están dando más seguido los dolores de cabeza, casi 3 por semana. Vamos a empezar un tratamiento preventivo y pedir una resonancia para estar tranquilos.", duracionSegundos: 340 },
      { mesesAtras: 2, motivoConsulta: "Control con resultado de resonancia", sintomas: [], antecedentesRelevantes: "Resonancia sin hallazgos patológicos", diagnostico: "Migraña sin aura, sin causa secundaria", diagnosticosDiferenciales: [], plan: "Continuar propranolol, reevaluar en 2 meses", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 2 meses", transcripcionCompleta: "Doctor, la resonancia salió normal, qué alivio. Los dolores también bajaron desde que tomo el propranolol.", duracionSegundos: 220 },
    ],
    medicamentos: [
      { nombre: "Ibuprofeno", dosis: "400mg", frecuencia: "al inicio del dolor", mesesInicio: 4, mesesFin: null },
      { nombre: "Propranolol", dosis: "40mg", frecuencia: "1 vez al día", mesesInicio: 4, mesesFin: null },
    ],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 5 }, { nombre: "VPH", dosis: "2da dosis", mesesAtras: 9 }],
    mediciones: [{ tipo: "presion", valor: 118, valorSecundario: 76, mesesAtras: 4 }, { tipo: "presion", valor: 112, valorSecundario: 72, mesesAtras: 1 }],
    estudios: [{ tipo: "resonancia", nombre: "Resonancia magnética cerebral", mesesAtras: 2, lineas: ["RM cerebral — Ana Paola Vargas", "Estudio sin alteraciones estructurales significativas", "Sin hallazgos que expliquen cefalea secundaria"] }],
  },
  "Roberto Quispe Ticona": {
    consultasExtra: [
      { mesesAtras: 4, motivoConsulta: "Control de lumbalgia", sintomas: [], antecedentesRelevantes: "Lumbalgia mecánica, respondió bien al tratamiento inicial", diagnostico: "Lumbalgia mecánica resuelta", diagnosticosDiferenciales: [], plan: "Ejercicios de fortalecimiento, alta de tratamiento farmacológico", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "Si reaparece el dolor", transcripcionCompleta: "Doctor, ya casi no me duele la espalda, mucho mejor. Vamos a dejar los ejercicios de fortalecimiento nomás por ahora.", duracionSegundos: 220 },
      { mesesAtras: 1, motivoConsulta: "Nuevo episodio de dolor lumbar", sintomas: ["dolor lumbar", "irradiación a pierna derecha"], antecedentesRelevantes: "Episodio previo similar, cargó peso en el trabajo de nuevo", diagnostico: "Lumbalgia mecánica, nuevo episodio con posible compromiso radicular", diagnosticosDiferenciales: ["ciática"], plan: "Antiinflamatorio, solicitar radiografía de columna", medicamentosRecetados: [{ nombre: "Naproxeno", dosis: "500mg", frecuencia: "2 veces al día por 7 días" }], examenesSolicitados: ["radiografía de columna lumbar"], proximoControl: "Con resultado de radiografía", transcripcionCompleta: "Doctor, me volvió a doler la espalda, esta vez se me va hasta la pierna derecha. Vamos a pedir una radiografía y darle un antiinflamatorio más fuerte.", duracionSegundos: 310 },
    ],
    medicamentos: [
      { nombre: "Diclofenaco", dosis: "50mg", frecuencia: "2 veces al día por 5 días", mesesInicio: 4, mesesFin: 4 },
      { nombre: "Naproxeno", dosis: "500mg", frecuencia: "2 veces al día por 7 días", mesesInicio: 1, mesesFin: null },
    ],
    vacunas: [{ nombre: "Antitetánica", dosis: "Refuerzo", mesesAtras: 7 }, { nombre: "Influenza", dosis: "Anual", mesesAtras: 3 }],
    mediciones: [{ tipo: "peso", valor: 88, mesesAtras: 4 }, { tipo: "peso", valor: 90, mesesAtras: 1 }],
    estudios: [{ tipo: "radiografia", nombre: "Radiografía de columna lumbar", mesesAtras: 1, lineas: ["Radiografía columna lumbar — Roberto Quispe Ticona", "Rectificación de la lordosis lumbar", "Sin fracturas ni listesis", "Espacios discales conservados"] }],
  },
  "Lucía Torres Mendoza": {
    consultasExtra: [
      { mesesAtras: 5, motivoConsulta: "Control de rinitis alérgica", sintomas: ["congestión nasal persistente"], antecedentesRelevantes: "Rinitis alérgica, síntomas persisten pese a antihistamínico", diagnostico: "Rinitis alérgica moderada", diagnosticosDiferenciales: [], plan: "Agregar corticoide nasal", medicamentosRecetados: [{ nombre: "Fluticasona", dosis: "spray nasal", frecuencia: "1 vez al día" }], examenesSolicitados: ["prueba de alergias"], proximoControl: "En 2 meses", transcripcionCompleta: "Doctora, la loratadina sola no me alcanza, sigo tapada. Vamos a agregar un spray nasal y pedir una prueba de alergias para identificar qué le está afectando.", duracionSegundos: 270 },
      { mesesAtras: 2, motivoConsulta: "Control con resultado de prueba de alergias", sintomas: [], antecedentesRelevantes: "Prueba de alergias positiva a ácaros del polvo", diagnostico: "Rinitis alérgica por ácaros del polvo", diagnosticosDiferenciales: [], plan: "Medidas de control ambiental, continuar tratamiento", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 3 meses", transcripcionCompleta: "Doctora, la prueba dio positivo para ácaros del polvo. Le voy a dar recomendaciones para reducir la exposición en la casa.", duracionSegundos: 240 },
    ],
    medicamentos: [
      { nombre: "Loratadina", dosis: "10mg", frecuencia: "1 vez al día", mesesInicio: 5, mesesFin: null },
      { nombre: "Fluticasona", dosis: "spray nasal", frecuencia: "1 vez al día", mesesInicio: 5, mesesFin: null },
    ],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 4 }],
    mediciones: [],
    estudios: [{ tipo: "otro", nombre: "Prueba de alergias (panel respiratorio)", mesesAtras: 2, lineas: ["Prueba de alergias — Lucía Torres Mendoza", "Positivo: ácaros del polvo (Dermatophagoides)", "Negativo: pólenes, epitelio de animales"] }],
  },
  "Fernando Aguilar Paz": {
    consultasExtra: [
      { mesesAtras: 2, motivoConsulta: "Control con resultado de urocultivo", sintomas: [], antecedentesRelevantes: "Infección urinaria tratada con ciprofloxacino", diagnostico: "Infección urinaria resuelta", diagnosticosDiferenciales: [], plan: "Alta, medidas de hidratación e higiene", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "Si reaparecen síntomas", transcripcionCompleta: "Doctor, ya no me arde para nada, se me quitó todo. El urocultivo de control salió negativo, muy bien.", duracionSegundos: 200 },
    ],
    medicamentos: [{ nombre: "Ciprofloxacino", dosis: "500mg", frecuencia: "2 veces al día por 5 días", mesesInicio: 2, mesesFin: 2 }],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 3 }, { nombre: "Antitetánica", dosis: "Refuerzo", mesesAtras: 10 }],
    mediciones: [],
    estudios: [{ tipo: "laboratorio", nombre: "Urocultivo de control", mesesAtras: 2, lineas: ["Urocultivo — Fernando Aguilar Paz", "Resultado: negativo", "Sin desarrollo bacteriano"] }],
  },
  "Patricia Salazar Nina": {
    consultasExtra: [
      { mesesAtras: 3, motivoConsulta: "Control con resultado de perfil tiroideo", sintomas: ["ansiedad persistente"], antecedentesRelevantes: "Perfil tiroideo normal", diagnostico: "Trastorno de ansiedad, sin causa tiroidea", diagnosticosDiferenciales: [], plan: "Iniciar tratamiento farmacológico junto con apoyo psicológico", medicamentosRecetados: [{ nombre: "Sertralina", dosis: "50mg", frecuencia: "1 vez al día" }], examenesSolicitados: [], proximoControl: "En 1 mes", transcripcionCompleta: "Doctor, el perfil tiroideo salió normal. Como los síntomas siguen, vamos a empezar un tratamiento para la ansiedad además del apoyo psicológico.", duracionSegundos: 320 },
      { mesesAtras: 1, motivoConsulta: "Control de ansiedad", sintomas: [], antecedentesRelevantes: "En tratamiento con sertralina y psicoterapia", diagnostico: "Trastorno de ansiedad, mejoría", diagnosticosDiferenciales: [], plan: "Continuar esquema actual, control en 2 meses", medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 2 meses", transcripcionCompleta: "Doctor, me siento bastante mejor, duermo mejor y las palpitaciones casi no me dan. Seguimos igual con el tratamiento.", duracionSegundos: 250 },
    ],
    medicamentos: [{ nombre: "Sertralina", dosis: "50mg", frecuencia: "1 vez al día", mesesInicio: 3, mesesFin: null }],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 4 }],
    mediciones: [{ tipo: "presion", valor: 128, valorSecundario: 84, mesesAtras: 3 }, { tipo: "presion", valor: 118, valorSecundario: 76, mesesAtras: 1 }],
    estudios: [{ tipo: "laboratorio", nombre: "Perfil tiroideo", mesesAtras: 3, lineas: ["Perfil tiroideo — Patricia Salazar Nina", "TSH: 2.1 mUI/L (normal)", "T4 libre: 1.2 ng/dL (normal)"] }],
  },
  "Diego Choque Flores": {
    consultasExtra: [
      { mesesAtras: 2, motivoConsulta: "Control, nuevo resfrío", sintomas: ["congestión nasal", "tos leve"], antecedentesRelevantes: "Episodio previo de faringitis viral resuelto", diagnostico: "Resfrío común", diagnosticosDiferenciales: [], plan: "Manejo sintomático, líquidos abundantes", medicamentosRecetados: [{ nombre: "Paracetamol", dosis: "según peso", frecuencia: "cada 6-8 horas si hay fiebre" }], examenesSolicitados: [], proximoControl: "Si empeora", transcripcionCompleta: "Doctora, mi hijo está con la nariz tapada y tos leve de nuevo. Parece un resfrío común, nada grave, con líquidos y paracetamol si le da fiebre alcanza.", duracionSegundos: 210 },
    ],
    medicamentos: [{ nombre: "Paracetamol", dosis: "según peso", frecuencia: "cada 6-8 horas si hay fiebre", mesesInicio: 2, mesesFin: 2 }],
    vacunas: [{ nombre: "Influenza", dosis: "Anual", mesesAtras: 3 }, { nombre: "Pentavalente", dosis: "Refuerzo", mesesAtras: 8 }],
    mediciones: [{ tipo: "peso", valor: 22, mesesAtras: 4 }, { tipo: "peso", valor: 23, mesesAtras: 1 }],
    estudios: [],
  },
};

async function main() {
  const medicoPhone = String(process.argv[2] || "").trim();
  if (!medicoPhone) {
    console.error("Uso: node scripts/enrich_pacientes_demo.js <telefono_del_medico>");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");
  fs.mkdirSync(DIR_ESTUDIOS, { recursive: true });

  const medico = await Medico.findOne({ phone: medicoPhone });
  if (!medico) {
    console.error(`❌ No existe ningún médico registrado con el teléfono ${medicoPhone}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Enriqueciendo pacientes de demo para: ${medico.nombre} (+${medico.phone})\n`);

  let enriquecidos = 0, saltados = 0, noEncontrados = 0;

  for (const [nombre, historia] of Object.entries(HISTORIAS)) {
    const paciente = await Paciente.findOne({ medicoPhone, nombre });
    if (!paciente) {
      console.log(`⚠️  No encontrado: ${nombre} — ¿corriste antes seed_pacientes_demo.js?`);
      noEncontrados++;
      continue;
    }

    const consultasActuales = await ConsultaMedica.countDocuments({ pacienteId: paciente._id });
    if (consultasActuales > 1) {
      console.log(`⏭️  Ya tiene historia larga: ${nombre} — salteado`);
      saltados++;
      continue;
    }

    // ─── Consultas extra ───────────────────────────────────────────────
    let ultimaConsultaId = null;
    for (const c of historia.consultasExtra) {
      const fecha = hace(c.mesesAtras);
      const consulta = await ConsultaMedica.create({
        medicoPhone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
        estado: "completado", duracionSegundos: c.duracionSegundos,
        transcripcionCompleta: c.transcripcionCompleta,
        segmentos: generarSegmentos(c.transcripcionCompleta, c.duracionSegundos),
        notaClinicaEstado: "completado",
        notaClinica: {
          motivoConsulta: c.motivoConsulta, sintomas: c.sintomas, antecedentesRelevantes: c.antecedentesRelevantes,
          diagnostico: c.diagnostico, diagnosticosDiferenciales: c.diagnosticosDiferenciales, plan: c.plan,
          medicamentosRecetados: c.medicamentosRecetados, examenesSolicitados: c.examenesSolicitados, proximoControl: c.proximoControl,
        },
        createdAt: fecha, updatedAt: fecha,
      });
      ultimaConsultaId = consulta._id;
    }

    // ─── Medicamentos ───────────────────────────────────────────────────
    for (const m of historia.medicamentos) {
      await Medicamento.create({
        pacienteId: paciente._id, medicoPhone, nombre: m.nombre, dosis: m.dosis, frecuencia: m.frecuencia,
        fechaInicio: hace(m.mesesInicio), fechaFin: m.mesesFin != null ? hace(m.mesesFin) : null,
      });
    }

    // ─── Vacunas ────────────────────────────────────────────────────────
    for (const v of historia.vacunas) {
      await Vacuna.create({ pacienteId: paciente._id, medicoPhone, nombre: v.nombre, dosis: v.dosis, fecha: hace(v.mesesAtras) });
    }

    // ─── Mediciones (evolución clínica) ────────────────────────────────
    for (const med of historia.mediciones) {
      await Medicion.create({
        pacienteId: paciente._id, medicoPhone, tipo: med.tipo, valor: med.valor,
        valorSecundario: med.valorSecundario ?? null, fecha: hace(med.mesesAtras),
      });
    }

    // ─── Estudios (con archivo real) ────────────────────────────────────
    for (const e of historia.estudios) {
      const archivoNombre = crypto.randomUUID() + ".pdf";
      fs.writeFileSync(path.join(DIR_ESTUDIOS, archivoNombre), crearPdfSimple(e.lineas));
      const buffer = fs.readFileSync(path.join(DIR_ESTUDIOS, archivoNombre));
      await Estudio.create({
        pacienteId: paciente._id, medicoPhone, tipo: e.tipo, nombre: e.nombre,
        archivoNombre, archivoMime: "application/pdf", archivoTamano: buffer.length,
        fecha: hace(e.mesesAtras),
      });
    }

    // ─── Una receta, a partir de la consulta más reciente con medicamentos ──
    const consultaConMeds = [...historia.consultasExtra].reverse().find(c => c.medicamentosRecetados?.length);
    if (consultaConMeds) {
      await Receta.create({
        pacienteId: paciente._id, medicoPhone, consultaId: ultimaConsultaId,
        medicamentos: consultaConMeds.medicamentosRecetados.map(m => ({ nombre: m.nombre, dosis: m.dosis || "", frecuencia: m.frecuencia || "", duracion: "" })),
        indicaciones: consultaConMeds.plan || "", fecha: hace(consultaConMeds.mesesAtras),
      });
    }

    console.log(`✅ Enriquecido: ${nombre} — +${historia.consultasExtra.length} consultas, +${historia.medicamentos.length} medicamentos, +${historia.vacunas.length} vacunas, +${historia.mediciones.length} mediciones, +${historia.estudios.length} estudios`);
    enriquecidos++;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🏁 Listo. Enriquecidos: ${enriquecidos} · Ya tenían historia: ${saltados} · No encontrados: ${noEncontrados}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
