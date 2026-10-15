// Symphomed — Português (Brasil) · o prontuário em PDF (services/kardexPdf.js).
//
// No Brasil o documento se chama «prontuário»: «Kardex» lá é a folha de
// medicação da enfermagem, e um médico que recebe um «Kardex» espera outra
// coisa.
const plural = (n, uno, varios) => (n === 1 ? uno : varios);

module.exports = {
  titulo: "Prontuário do paciente",
  archivo: "Prontuario",
  generado: "Gerado em",
  pagina: (n, total) => `Página ${n} de ${total}`,
  confidencial: "Documento confidencial: contém dados de saúde.",
  continuacion: (de) => `${de} (continuação)`,

  secciones: {
    paciente: "Dados do paciente",
    antecedentes: "Antecedentes pessoais",
    familiares: "Antecedentes familiares",
    medicacion: "Medicação",
    consultas: "Consultas",
    recetas: "Receitas emitidas",
    informes: "Exames com laudo assinado",
    vacunas: "Vacinas",
    mediciones: "Controles e medições",
    tratamientos: "Plano de tratamento",
  },

  campos: {
    nombre: "Nome",
    nacimiento: "Data de nascimento",
    edad: (n) => `${n} ${plural(n, "ano", "anos")}`,
    sexo: "Sexo",
    documento: "Documento",
    codigo: "Código",
    especie: "Espécie",
    raza: "Raça",
    // No Brasil, quem cuida do animal é o «tutor».
    dueno: "Tutor",
    tutor: "Responsável",
  },

  alergias: {
    titulo: "ALERGIAS",
    ninguna: "Não há alergias registradas. Não estar registrado não significa que não tenha: confirmar com o paciente antes de prescrever.",
  },

  medicacion: {
    columnas: ["Medicamento", "Dose", "Frequência", "Início", "Situação"],
    activo: "Em uso",
    hasta: (fecha) => `Até ${fecha}`,
  },

  consulta: {
    motivo: "Motivo da consulta",
    sintomas: "Sintomas",
    diagnostico: "Diagnóstico",
    plan: "Conduta",
    recetado: "Medicamentos prescritos",
    examenes: "Exames solicitados",
    proximoControl: "Próximo retorno",
    sinConfirmar: (n) => `${plural(n, "Há 1 consulta", `Há ${n} consultas`)} com a nota não confirmada: ${plural(n, "não é incluída", "não são incluídas")} até o médico ${plural(n, "revisá-la e confirmá-la", "revisá-las e confirmá-las")} no Symphomed.`,
    sinNota: (mostradas, total) => `São mostradas ${mostradas} de ${total} consultas confirmadas: as demais não têm nota clínica.`,
  },

  enfermeria: {
    signosVitales: "Sinais vitais",
    signos: { PA: "PA", FC: "FC", FR: "FR", T: "T", SatO2: "SatO2", dolor: "Dor", glucemia: "Glicemia" },
    valoracion: "Coleta de dados por padrões funcionais",
    patrones: {
      percepcion_salud: "Percepção e controle da saúde", nutricional: "Nutricional-metabólico", eliminacion: "Eliminação",
      actividad: "Atividade e exercício", sueno: "Sono e repouso", cognitivo: "Cognitivo-perceptivo",
      autopercepcion: "Autopercepção e autoconceito", rol: "Papéis e relacionamentos", sexualidad: "Sexualidade e reprodução",
      afrontamiento: "Enfrentamento e tolerância ao estresse", valores: "Valores e crenças",
    },
    diagnosticos: "Diagnósticos de enfermagem",
    rc: "relacionado a",
    mp: "evidenciado por",
    objetivos: "Resultados esperados",
    intervenciones: "Intervenções",
    evaluacion: "Avaliação",
    educacion: "Educação em saúde (paciente e família)",
  },

  recetas: {
    indicaciones: "Orientações",
    memed: "emitida pela Memed",
  },

  informes: {
    conclusion: "Conclusão",
    recomendaciones: "Recomendações",
  },

  vacunas: { columnas: ["Vacina", "Dose", "Data"] },

  mediciones: {
    columnas: ["Data", "Controle", "Valor"],
    tipos: {
      presion: "Pressão arterial", glucosa: "Glicemia", peso: "Peso", imc: "IMC",
      saturacion: "Saturação O₂", colesterol: "Colesterol", temperatura: "Temperatura",
      frecuenciaCardiaca: "Freq. cardíaca", presionIntraocularOD: "Pressão intraocular OD",
      presionIntraocularOI: "Pressão intraocular OE", talla: "Altura", perimetroCefalico: "Perímetro cefálico",
      pesoMaterno: "Peso materno", alturaUterina: "Altura uterina", fcf: "Freq. cardíaca fetal",
    },
  },

  tratamientos: {
    columnas: ["Tratamento", "Dente", "Situação"],
    estados: { pendiente: "Pendente", en_proceso: "Em andamento", realizado: "Realizado" },
  },

  excluye: "Não são incluídos a gravação nem a transcrição das consultas, os resumos automáticos nem os diagnósticos diferenciais: são material de trabalho, não o prontuário.",
  firma: "Assinatura e carimbo",
};
