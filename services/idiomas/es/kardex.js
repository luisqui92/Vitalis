// Symphomed — Español · el Kardex en PDF (services/kardexPdf.js).
const plural = (n, uno, varios) => (n === 1 ? uno : varios);

module.exports = {
  titulo: "Kardex del paciente",
  // Empieza el nombre del archivo: Kardex_Ana_Perez_2026-10-01.pdf
  archivo: "Kardex",
  generado: "Generado el",
  pagina: (n, total) => `Página ${n} de ${total}`,
  confidencial: "Documento confidencial: contiene datos de salud.",
  // Arriba de la hoja, cuando una consulta sigue de la anterior.
  continuacion: (de) => `${de} (continuación)`,

  secciones: {
    paciente: "Datos del paciente",
    antecedentes: "Antecedentes personales",
    familiares: "Antecedentes familiares",
    medicacion: "Medicación",
    consultas: "Consultas",
    recetas: "Recetas emitidas",
    informes: "Estudios con informe firmado",
    vacunas: "Vacunas",
    mediciones: "Controles y mediciones",
    tratamientos: "Plan de tratamiento",
  },

  campos: {
    nombre: "Nombre",
    nacimiento: "Fecha de nacimiento",
    edad: (n) => `${n} ${plural(n, "año", "años")}`,
    sexo: "Sexo",
    documento: "Documento",
    codigo: "Código",
    especie: "Especie",
    raza: "Raza",
    dueno: "Dueño",
    tutor: "Tutor",
  },

  alergias: {
    titulo: "ALERGIAS",
    // Se dice siempre: un hueco se lee como «no tiene».
    ninguna: "No hay alergias registradas. Que no estén registradas no significa que no tenga: confirmar con el paciente antes de indicar medicación.",
  },

  medicacion: {
    columnas: ["Medicamento", "Dosis", "Frecuencia", "Desde", "Estado"],
    activo: "En curso",
    hasta: (fecha) => `Hasta ${fecha}`,
  },

  consulta: {
    motivo: "Motivo de consulta",
    sintomas: "Síntomas",
    diagnostico: "Diagnóstico",
    plan: "Plan",
    recetado: "Medicamentos indicados",
    examenes: "Exámenes solicitados",
    proximoControl: "Próximo control",
    sinConfirmar: (n) => `${plural(n, "Hay 1 consulta", `Hay ${n} consultas`)} con la nota sin confirmar: ${plural(n, "no se incluye", "no se incluyen")} hasta que el médico ${plural(n, "la revise y la confirme", "las revise y las confirme")} en Symphomed.`,
    sinNota: (mostradas, total) => `Se muestran ${mostradas} de ${total} consultas confirmadas: las demás no tienen nota clínica.`,
  },

  // La nota de enfermería (services/notaClinica.js).
  enfermeria: {
    signosVitales: "Signos vitales",
    signos: { PA: "PA", FC: "FC", FR: "FR", T: "T°", SatO2: "SatO2", dolor: "Dolor", glucemia: "Glucemia" },
    valoracion: "Valoración por patrones funcionales",
    patrones: {
      percepcion_salud: "Percepción y manejo de la salud", nutricional: "Nutricional-metabólico", eliminacion: "Eliminación",
      actividad: "Actividad-ejercicio", sueno: "Sueño-descanso", cognitivo: "Cognitivo-perceptivo",
      autopercepcion: "Autopercepción-autoconcepto", rol: "Rol-relaciones", sexualidad: "Sexualidad-reproducción",
      afrontamiento: "Afrontamiento-tolerancia al estrés", valores: "Valores-creencias",
    },
    diagnosticos: "Diagnósticos de enfermería",
    rc: "r/c",
    mp: "m/p",
    objetivos: "Objetivos",
    intervenciones: "Intervenciones",
    evaluacion: "Evaluación",
    educacion: "Educación al paciente y la familia",
  },

  recetas: {
    indicaciones: "Indicaciones",
    memed: "emitida por Memed",
  },

  informes: {
    conclusion: "Conclusión",
    recomendaciones: "Recomendaciones",
  },

  vacunas: { columnas: ["Vacuna", "Dosis", "Fecha"] },

  mediciones: {
    columnas: ["Fecha", "Control", "Valor"],
    // Los mismos nombres que la pestaña de evolución (public/i18n/es/mediciones.js).
    tipos: {
      presion: "Presión arterial", glucosa: "Glucosa", peso: "Peso", imc: "IMC",
      saturacion: "Saturación O₂", colesterol: "Colesterol", temperatura: "Temperatura",
      frecuenciaCardiaca: "Frec. cardíaca", presionIntraocularOD: "Presión intraocular OD",
      presionIntraocularOI: "Presión intraocular OI", talla: "Talla", perimetroCefalico: "Perímetro cefálico",
      pesoMaterno: "Peso materno", alturaUterina: "Altura uterina", fcf: "Frec. cardíaca fetal",
    },
  },

  tratamientos: {
    columnas: ["Tratamiento", "Pieza", "Estado"],
    estados: { pendiente: "Pendiente", en_proceso: "En proceso", realizado: "Realizado" },
  },

  // Al final del documento: qué no está y por qué (services/resumenCompartido.js → SIEMPRE_FUERA).
  excluye: "No se incluyen la grabación ni la transcripción de las consultas, los resúmenes automáticos ni los diagnósticos diferenciales: son material de trabajo, no la historia clínica.",
  firma: "Firma y sello",
};
