// Symphomed — Lo que «pasa» en los videos para estudiantes: las consultas que
// se graban, lo que contesta la IA de mentira, los casos del paciente virtual
// y las preguntas de los simulacros (scripts/demo/videos_estudiantes.js).
//
// Todo inventado: los pacientes, los nombres y las conversaciones. Nada sale
// de la base de nadie.
//
// Las preguntas y los casos los ven estudiantes: son contenido de libro, sin
// dosis de medicamentos (una dosis tiene que salir de un formulario oficial,
// no de memoria) y sin etiquetas de taxonomías con licencia (NANDA-I, NIC, NOC).

// ─── La consulta de medicina: dolor de garganta ──────────────────────────────
// Por turnos, como los manda la vista previa de AssemblyAI.
const DIALOGO_MED = [
  "Buenos días, soy Ana, estudiante de medicina. ¿Qué le trae por aquí?",
  "Buenos días, doctorcita. Me duele mucho la garganta desde hace tres días.",
  "¿Ha tenido fiebre?",
  "Sí, anoche tuve treinta y ocho y medio, con escalofríos.",
  "¿Le duele al tragar?",
  "Mucho, casi no puedo comer.",
  "¿Tiene tos o moqueo?",
  "No, tos no tengo, ni moco.",
  "¿Es alérgico a algún medicamento?",
  "Que yo sepa, no.",
  "Voy a revisarle la garganta y el cuello. Tiene las amígdalas inflamadas, con placas blancas, y ganglios dolorosos en el cuello.",
  "Voy a comentar su caso con mi docente para el tratamiento. Mientras tanto, tome bastante líquido y descanse.",
  "Gracias, doctorcita.",
];

// La nota, según lo que ya se dijo: el borrador en vivo empieza con poco.
function notaMed(texto) {
  const t = String(texto || "").toLowerCase();
  const nota = {
    motivoConsulta: "Dolor de garganta de 3 días de evolución",
    sintomas: ["odinofagia", "fiebre de 38,5 °C con escalofríos"],
    antecedentesRelevantes: null, diagnostico: null, diagnosticosDiferenciales: [], plan: null,
    medicamentosRecetados: [], examenesSolicitados: [], proximoControl: null,
    reconsultaSugerida: { fechaHora: null, textoOriginal: null },
    tratamientosSugeridos: [], examenOcularSugerido: [], odontogramaSugerido: [], ginecoSugerido: [],
    antecedentesPersonalesNuevos: [], antecedentesFamiliaresNuevos: [], vacunasMencionadas: [],
  };
  if (/no puedo comer/.test(t)) nota.sintomas.push("dificultad para comer");
  if (/tos no tengo/.test(t)) nota.antecedentesRelevantes = "Sin tos ni rinorrea.";
  if (/que yo sepa, no/.test(t)) nota.antecedentesRelevantes = "Sin tos ni rinorrea. Niega alergias a medicamentos.";
  if (/placas blancas/.test(t)) {
    nota.diagnostico = "Faringoamigdalitis aguda";
    nota.sintomas.push("amígdalas inflamadas con placas blancas", "adenopatías cervicales dolorosas");
  }
  if (/mi docente/.test(t)) nota.plan = "Se comenta el caso con el docente para definir el tratamiento. Abundantes líquidos y reposo.";
  return nota;
}

// «Te falta preguntar»: solo lo que todavía no se preguntó.
function tutorMed(texto) {
  const t = String(texto || "").toLowerCase();
  const preguntas = [
    !/\btos\b/.test(t) && { pregunta: "¿Tiene tos o moqueo?", porQue: "Su ausencia orienta a una causa bacteriana" },
    !/alérgic/.test(t) && { pregunta: "¿Es alérgico a algún medicamento?", porQue: "Cambia qué se le puede indicar" },
    { pregunta: "¿Estuvo con alguien con dolor de garganta?", porQue: "El contagio cercano apoya una infección" },
    { pregunta: "¿Le cuesta abrir la boca o tragar la saliva?", porQue: "Descarta un absceso periamigdalino" },
  ].filter(Boolean);
  return {
    preguntas,
    banderasRojas: ["Dificultad para respirar", "No poder tragar ni la saliva", "Voz apagada o boca que no abre (absceso)"],
  };
}

// El razonamiento, después de que la estudiante dijo lo suyo.
function razonamientoMed(principal) {
  const acerto = /estrept|bacteri/i.test(principal || "");
  return {
    diferenciales: [
      { diagnostico: "Faringoamigdalitis estreptocócica", aFavor: ["fiebre de 38,5 °C", "placas en las amígdalas", "ganglios cervicales dolorosos", "sin tos ni moco"],
        enContra: ["no se confirmó con un test"], estudio: "Test rápido de estreptococo o cultivo de fauces" },
      { diagnostico: "Faringitis viral", aFavor: ["dolor de garganta de pocos días"], enContra: ["no tiene tos ni moco", "fiebre alta con placas"],
        estudio: "Test rápido negativo y evolución" },
      { diagnostico: "Mononucleosis infecciosa", aFavor: ["placas", "fiebre"], enContra: ["no se buscaron ganglios detrás del cuello ni bazo grande"],
        estudio: "Monotest y hemograma" },
    ],
    banderasRojas: ["Absceso periamigdalino: boca que no abre, voz apagada, úvula desviada", "Dificultad para respirar o para tragar la saliva"],
    faltoPreguntar: ["¿Estuvo con alguien con dolor de garganta?", "¿Le cuesta abrir la boca?", "¿Tuvo cuadros parecidos este año?"],
    comparacion: {
      acertoPrincipal: acerto,
      comentario: acerto
        ? "Bien: juntaste la fiebre, las placas y los ganglios sin tos. Antes de indicar antibiótico, confirmalo con un test."
        : "Pensaste en lo viral, pero la fiebre, las placas y los ganglios dolorosos sin tos ni moco orientan a una causa bacteriana. Antes de decidir, conviene confirmarlo con un test rápido.",
      noConsideraste: acerto ? [] : [{ diagnostico: "Faringoamigdalitis estreptocócica", porQue: "fiebre, placas y ganglios dolorosos, sin tos" }],
    },
    perla: "Fiebre, placas, ganglios del cuello dolorosos y sin tos son los criterios de Centor: con tres o más, pensá en estreptococo y confirmalo antes de indicar antibiótico.",
  };
}

// ─── La atención de enfermería: neumonía en internación ──────────────────────
const DIALOGO_ENF = [
  "Buenos días, doña Rosa, soy Lucía, estudiante de enfermería. ¿Cómo se siente hoy?",
  "Cansada, señorita, me cuesta respirar.",
  "Le voy a controlar los signos vitales. Presión ciento treinta sobre ochenta, pulso ciento cuatro, respiración veintiséis por minuto, temperatura treinta y ocho con cuatro, saturación ochenta y nueve por ciento.",
  "¿Tiene dolor en algún lado?",
  "Me duele el costado derecho cuando toso, como un cinco de diez.",
  "¿Está comiendo y tomando agua?",
  "Casi nada, no tengo hambre.",
  "¿Cómo durmió anoche?",
  "Mal, sentada, porque acostada me falta el aire.",
  "La voy a dejar semisentada para que respire mejor. Si se siente más agitada, me avisa con el timbre.",
  "Gracias, hijita.",
];

function notaEnf(texto) {
  const t = String(texto || "").toLowerCase();
  const nota = {
    motivoConsulta: "Dificultad para respirar y cansancio",
    valoracion: [{ patron: "actividad", hallazgos: "Disnea y cansancio; frecuencia respiratoria de 26 por minuto" }],
    signosVitales: { PA: null, FC: null, FR: null, T: null, SatO2: null, dolor: null, glucemia: null },
    diagnosticosEnfermeria: [], objetivos: [], intervenciones: [], evaluacion: null, educacion: null,
  };
  if (/ciento treinta/.test(t)) {
    Object.assign(nota.signosVitales, { PA: "130/80 mmHg", FC: "104 lpm", FR: "26 rpm", T: "38,4 °C", SatO2: "89 %" });
    nota.diagnosticosEnfermeria.push({ problema: "Oxigenación insuficiente", etiologia: "neumonía con secreciones", signos: "FR 26 rpm y saturación de 89 %" });
  }
  if (/cinco de diez/.test(t)) {
    nota.signosVitales.dolor = "5/10";
    nota.valoracion.push({ patron: "cognitivo", hallazgos: "Dolor en el costado derecho al toser, 5/10" });
    nota.diagnosticosEnfermeria.push({ problema: "Dolor agudo", etiologia: "tos con inflamación del pulmón", signos: "dolor 5/10 al toser" });
  }
  if (/casi nada/.test(t)) {
    nota.valoracion.unshift({ patron: "nutricional", hallazgos: "Come y toma muy poco; sin apetito" });
    nota.diagnosticosEnfermeria.push({ problema: "Riesgo de deshidratación", etiologia: "fiebre y poca ingesta de líquidos", signos: null });
  }
  if (/sentada/.test(t)) nota.valoracion.push({ patron: "sueno", hallazgos: "Durmió mal, sentada, porque acostada le falta el aire" });
  if (/semisentada/.test(t)) {
    nota.objetivos = ["Respira con menos esfuerzo y mejora la saturación durante el turno", "Refiere dolor menor a 3/10 al toser"];
    nota.intervenciones = ["Posición semisentada", "Control de signos vitales y saturación", "Ayudar a toser y eliminar secreciones",
      "Ofrecer líquidos de a poco y seguido", "Avisar al médico si la saturación baja"];
    nota.educacion = "Se le explicó que avise con el timbre si se siente más agitada.";
  }
  return nota;
}

function tutorEnf(texto) {
  const t = String(texto || "").toLowerCase();
  const preguntas = [
    !/durmió/.test(t) && { pregunta: "¿Cómo durmió anoche?", porQue: "Si duerme sentada por la falta de aire, cambia cómo acomodarla" },
    { pregunta: "¿Orinó hoy? ¿Cuántas veces?", porQue: "Con fiebre y poca agua, puede estar deshidratándose" },
    { pregunta: "¿Puede levantarse sola al baño?", porQue: "Con debilidad y oxígeno bajo, aumenta el riesgo de caídas" },
    { pregunta: "Controlar la saturación después de acomodarla", porQue: "Muestra si la posición la ayuda a respirar" },
  ].filter(Boolean);
  return { preguntas, banderasRojas: ["Saturación que sigue bajando", "Confusión o somnolencia", "Respiración cada vez más rápida"] };
}

function razonamientoEnf(principal) {
  const acerto = /oxigen|respir/i.test(principal || "");
  return {
    diferenciales: [
      { diagnostico: "Oxigenación insuficiente", aFavor: ["saturación de 89 %", "respira 26 por minuto", "duerme sentada por la falta de aire"],
        enContra: [], estudio: "Posición semisentada y control de la saturación" },
      { diagnostico: "Dolor agudo", aFavor: ["dolor 5/10 en el costado derecho al toser"], enContra: ["no amenaza la vida como la falta de oxígeno"],
        estudio: "Valorar el dolor antes y después de cada intervención" },
      { diagnostico: "Riesgo de deshidratación", aFavor: ["fiebre", "casi no toma líquidos"], enContra: ["no se valoró la diuresis"],
        estudio: "Ofrecer líquidos de a poco y llevar el balance" },
    ],
    banderasRojas: ["Saturación que sigue bajando", "Confusión o somnolencia", "Respiración cada vez más rápida"],
    faltoPreguntar: ["¿Orinó hoy?", "¿Puede levantarse sola?"],
    comparacion: {
      acertoPrincipal: acerto,
      comentario: acerto
        ? "Bien: priorizaste la oxigenación, que es lo que amenaza la vida. Te faltó valorar la diuresis y el riesgo de caídas."
        : "El dolor es real, pero lo prioritario es la oxigenación: saturación de 89 % y 26 respiraciones por minuto van primero.",
      noConsideraste: acerto ? [] : [{ diagnostico: "Oxigenación insuficiente", porQue: "saturación de 89 % y frecuencia de 26" }],
    },
    perla: "En un paciente con neumonía, lo primero es la oxigenación: la posición semisentada y el control de la saturación van antes que todo lo demás.",
  };
}

// ─── El paciente virtual de medicina: apendicitis ────────────────────────────
const CASO_MED = {
  paciente: { nombre: "Jimena Vargas", edad: 21, edadMeses: null, sexo: "Femenino", ocupacion: "estudiante" },
  quienHabla: "el paciente", lugar: "emergencia",
  motivo: "Me duele mucho la barriga desde ayer, doctora.",
  personalidad: "preocupada y colaboradora",
  historia: ["El dolor empezó hace 20 horas alrededor del ombligo", "Hace 8 horas se fue abajo a la derecha", "Tuvo náuseas y vomitó una vez",
    "No tiene hambre", "Anoche se sintió con fiebre"],
  antecedentes: { personales: ["ninguno"], familiares: [], medicamentos: [], alergias: [], habitos: [], ginecoObstetricos: ["última menstruación hace 2 semanas, normal"] },
  negativos: ["diarrea", "ardor al orinar", "sangrado vaginal"],
  signosVitales: { PA: "110/70 mmHg", FC: "102 lpm", FR: "18 rpm", T: "38,1 °C", SatO2: "97 %" },
  examenFisico: [
    { region: "Abdomen", hallazgo: "Dolor a la palpación en la fosa ilíaca derecha, con defensa; signo de Blumberg positivo." },
    { region: "Aspecto general", hallazgo: "Lúcida, con facies de dolor; prefiere quedarse quieta." },
  ],
  estudios: [
    { nombre: "Hemograma", resultado: "Leucocitos 14.500/mm³ con 85 % de neutrófilos. Hemoglobina 13,2 g/dL." },
    { nombre: "Test de embarazo", resultado: "Negativo." },
    { nombre: "Ecografía abdominal", resultado: "Apéndice no compresible de 9 mm, con escaso líquido alrededor." },
    { nombre: "Examen de orina", resultado: "Sin leucocitos ni nitritos." },
  ],
  diagnostico: "Apendicitis aguda",
  diferenciales: [
    { diagnostico: "Embarazo ectópico", porQueNo: "Menstruación normal hace 2 semanas y test de embarazo negativo" },
    { diagnostico: "Infección urinaria", porQueNo: "Sin síntomas urinarios y orina sin leucocitos ni nitritos" },
    { diagnostico: "Gastroenteritis aguda", porQueNo: "Sin diarrea, y el dolor se localizó en la fosa ilíaca derecha" },
  ],
  preguntasClave: ["¿Dónde empezó el dolor?", "¿Se movió el dolor?", "¿Tuvo fiebre?", "¿Náuseas o vómitos?", "¿Cuándo fue su última menstruación?",
    "¿Molestias al orinar?", "¿Diarrea?"],
  banderasRojas: ["Signos de peritonitis generalizada", "Inestabilidad hemodinámica"],
  estudiosPertinentes: ["Hemograma", "Test de embarazo", "Ecografía abdominal", "Examen de orina"],
  perla: "El dolor que empieza alrededor del ombligo y se va a la fosa ilíaca derecha es muy sugestivo de apendicitis.",
};

const RESPUESTAS_MED = [
  [/dónde|donde|empez/i, "Empezó acá, alrededor del ombligo, y después se me fue para abajo, a la derecha."],
  [/fiebre|temperatura/i, "Anoche me sentí con fiebre, pero no me controlé."],
  [/vómit|vomit|náusea|nausea/i, "Tengo náuseas, y vomité una vez."],
  [/menstru|regla/i, "Me vino hace dos semanas, normal."],
  [/orina|orinar|pis/i, "No, eso normal."],
  [/diarrea|deposic/i, "No, diarrea no tengo."],
  [/comer|hambre|apetito/i, "No tengo nada de hambre."],
  [/hola|soy/i, "Hola, doctora. Me duele mucho, acá abajo."],
];

const EVALUACION_MED = {
  preguntasClave: CASO_MED.preguntasClave.map((_, i) => ({ hecha: i < 5 })),
  banderasRojas: [{ explorada: true }, { explorada: false }],
  estudios: { pertinentes: ["Hemograma", "Ecografía abdominal"], faltaron: ["Test de embarazo"], innecesarios: [] },
  diagnostico: { acerto: true, comentario: "Llegaste por la migración del dolor y el Blumberg positivo, y lo apoyaste con el hemograma." },
  diferenciales: { considero: ["Embarazo ectópico"], faltaron: ["Infección urinaria"] },
  comunicacion: { bien: ["Te presentaste y preguntaste con palabras simples"], mejorar: ["Preguntar por molestias al orinar y por diarrea"] },
  comentario: "Buena entrevista: ordenada y con el examen correcto. En una mujer joven con dolor abdominal, pedí siempre un test de embarazo.",
};

// ─── El paciente virtual de enfermería: neumonía en internación ──────────────
const CASO_ENF = {
  paciente: { nombre: "Rosa Quispe", edad: 74, edadMeses: null, sexo: "Femenino", ocupacion: "jubilada" },
  quienHabla: "el paciente", lugar: "internacion", diagnosticoMedico: "Neumonía adquirida en la comunidad",
  motivo: "Me cuesta respirar, señorita, y estoy muy cansada.",
  personalidad: "cansada y colaboradora",
  historia: ["Tose con flema amarilla desde hace 4 días", "Se cansa al ir al baño", "Come poco y toma poca agua",
    "Duerme sentada porque acostada le falta el aire", "Le duele el costado derecho al toser"],
  antecedentes: { personales: ["Presión alta"], familiares: [], medicamentos: ["Pastilla para la presión"], alergias: [], habitos: [], ginecoObstetricos: [] },
  negativos: ["dolor de pecho al caminar", "mareos"],
  signosVitales: { PA: "130/80 mmHg", FC: "104 lpm", FR: "26 rpm", T: "38,4 °C", SatO2: "89 %" },
  examenFisico: [
    { region: "Respiración", hallazgo: "Respira rápido y usa los músculos del cuello; crepitantes en la base derecha. Tos con flema amarilla." },
    { region: "Piel y mucosas", hallazgo: "Piel caliente; mucosas secas." },
    { region: "Movilidad", hallazgo: "Se levanta con ayuda; se cansa al caminar al baño." },
    { region: "Dolor", hallazgo: "Dolor 5/10 en el costado derecho al toser." },
  ],
  estudios: [
    { nombre: "Riesgo de caídas", resultado: "Escala de Morse: 45 puntos, riesgo alto de caídas." },
    { nombre: "Escala de Braden", resultado: "16 puntos: riesgo bajo de lesiones por presión." },
    { nombre: "Escala de dolor", resultado: "EVA 5/10 al toser." },
    { nombre: "Balance hídrico", resultado: "Ingresos 600 mL y egresos 900 mL en 24 horas." },
  ],
  diagnostico: "Oxigenación insuficiente",
  diferenciales: [
    { diagnostico: "Riesgo de caídas", porQueNo: "Es real (Morse 45), pero lo prioritario hoy es la oxigenación" },
    { diagnostico: "Dolor agudo", porQueNo: "Duele al toser (5/10), pero no amenaza la vida como la falta de oxígeno" },
    { diagnostico: "Riesgo de deshidratación", porQueNo: "Toma poco líquido, pero lo urgente es respirar mejor" },
  ],
  preguntasClave: ["¿Le falta el aire?", "¿Cómo durmió?", "¿Está comiendo y tomando agua?", "¿Tiene dolor?", "¿Puede levantarse sola?", "¿Orinó hoy?"],
  banderasRojas: ["Saturación que sigue bajando", "Confusión o somnolencia", "Respiración cada vez más rápida"],
  estudiosPertinentes: ["Saturación de oxígeno", "Riesgo de caídas", "Escala de dolor", "Balance hídrico"],
  intervencionesClave: ["Posición semisentada", "Control de saturación y frecuencia respiratoria", "Oxígeno según indicación médica",
    "Ayudar a toser y eliminar secreciones", "Ofrecer líquidos de a poco"],
  perla: "En un paciente con neumonía, lo primero es la oxigenación: la posición semisentada y el control de la saturación van antes que todo lo demás.",
};

const RESPUESTAS_ENF = [
  [/aire|respir/i, "Sí, me cuesta mucho respirar, más cuando me acuesto."],
  [/dorm|durm/i, "Mal, sentada, porque acostada me ahogo."],
  [/comi|comer|agua|líquido|liquido|tomando/i, "Casi nada, no tengo hambre y me da flojera tomar agua."],
  [/dolor|duele/i, "Me duele el costado derecho cuando toso, como un cinco de diez."],
  [/levant|baño|camin/i, "Sola no puedo, me mareo un poco y me canso."],
  [/orin/i, "Poquito, hijita, una sola vez desde la mañana."],
  [/hola|soy/i, "Hola, señorita. Me cuesta respirar."],
];

const EVALUACION_ENF = {
  preguntasClave: CASO_ENF.preguntasClave.map((_, i) => ({ hecha: i < 4 })),
  banderasRojas: [{ explorada: true }, { explorada: false }, { explorada: true }],
  estudios: { pertinentes: ["Riesgo de caídas"], faltaron: ["Balance hídrico"], innecesarios: [] },
  diagnostico: { acerto: true, comentario: "Priorizaste la oxigenación: la saturación de 89 % y la frecuencia de 26 lo sostienen." },
  diferenciales: { considero: ["Riesgo de caídas"], faltaron: ["Riesgo de deshidratación"] },
  intervenciones: { adecuadas: ["Posición semisentada", "Control de la saturación"], faltaron: ["Ofrecer líquidos de a poco"], inadecuadas: [] },
  comunicacion: { bien: ["Te presentaste y le explicaste lo que ibas a hacer"], mejorar: ["Preguntar si orinó hoy"] },
  comentario: "Muy buena valoración. Sumá el balance de líquidos: con fiebre y poca agua, se puede deshidratar.",
};

// Lo que encuentra la práctica al examinar o al pedir algo: del guion, por palabra.
function delGuion(lista, pedido, porDefecto) {
  const p = String(pedido || "").toLowerCase();
  const x = lista.find(e => p.includes(String(e.region || e.nombre).toLowerCase().split(" ")[0]))
    || lista.find(e => String(e.region || e.nombre).toLowerCase().split(" ").some(w => w.length > 4 && p.includes(w)));
  return x ? (x.hallazgo || x.resultado) : porDefecto;
}

// ─── Los simulacros ──────────────────────────────────────────────────────────
// Diez por área (un simulacro tiene al menos diez preguntas). Contenido de
// libro, sin dosis.
const pregunta = (tema, enunciado, opciones, correcta, explicacion, porOpcion) => ({ tema, enunciado, opciones, correcta, explicacion, porOpcion });

const PREGUNTAS_MED = [
  pregunta("Faringoamigdalitis",
    "Paciente de 22 años con dolor de garganta de 2 días, fiebre de 38,6 °C, exudado amigdalino y adenopatías cervicales anteriores dolorosas, sin tos. ¿Qué herramienta clínica orienta la probabilidad de que sea estreptocócica?",
    ["Criterios de Centor", "Escala de Wells", "Puntaje CURB-65", "Criterios de Ranson", "Escala de Glasgow"], 0,
    "Los criterios de Centor (fiebre, exudado amigdalino, adenopatías cervicales anteriores dolorosas y ausencia de tos) estiman la probabilidad de faringitis estreptocócica y orientan a confirmarla con un test rápido o un cultivo.",
    ["Correcta: son los criterios para la faringitis estreptocócica.", "Wells estima la probabilidad de trombosis venosa profunda o de tromboembolismo pulmonar.",
      "CURB-65 valora la gravedad de la neumonía.", "Ranson estima la gravedad de la pancreatitis aguda.", "Glasgow valora el nivel de conciencia."]),
  pregunta("Diabetes",
    "¿A partir de qué valor de glucemia plasmática en ayunas, confirmado en una segunda medición, se diagnostica diabetes mellitus?",
    ["100 mg/dL", "110 mg/dL", "126 mg/dL", "140 mg/dL", "200 mg/dL"], 2,
    "Una glucemia en ayunas de 126 mg/dL o más, confirmada, es diagnóstica de diabetes. Entre 100 y 125 mg/dL corresponde a glucemia alterada en ayunas.",
    ["Es el límite inferior de la glucemia alterada en ayunas.", "Está dentro del rango de glucemia alterada en ayunas.", "Correcta.",
      "No es el umbral en ayunas.", "200 mg/dL es el umbral de una glucemia al azar con síntomas, o a las 2 horas de la sobrecarga oral de glucosa."]),
  pregunta("Neumonía",
    "Para decidir si un adulto con neumonía adquirida en la comunidad puede tratarse en forma ambulatoria, ¿qué escala se usa?",
    ["CURB-65", "Centor", "Wells", "Child-Pugh", "NIHSS"], 0,
    "CURB-65 (confusión, urea, frecuencia respiratoria, presión arterial y edad de 65 años o más) estima la gravedad de la neumonía y ayuda a decidir dónde tratarla.",
    ["Correcta.", "Centor es para la faringitis estreptocócica.", "Wells es para trombosis venosa profunda y tromboembolismo pulmonar.",
      "Child-Pugh clasifica la gravedad de la cirrosis.", "NIHSS mide la gravedad del accidente cerebrovascular."]),
  pregunta("Colecistitis",
    "Mujer de 45 años con dolor en el hipocondrio derecho y fiebre. Al palpar bajo el reborde costal derecho, detiene la inspiración por dolor. ¿Qué signo es y qué sugiere?",
    ["Signo de Murphy: colecistitis aguda", "Signo de Blumberg: apendicitis", "Signo de Rovsing: pancreatitis", "Signo de Cullen: colecistitis", "Signo de Murphy: apendicitis"], 0,
    "El signo de Murphy (se interrumpe la inspiración al palpar el punto cístico) sugiere colecistitis aguda.",
    ["Correcta.", "Blumberg es el dolor a la descompresión, propio de la irritación peritoneal.",
      "Rovsing es el dolor en la fosa ilíaca derecha al presionar la izquierda, en la apendicitis.",
      "Cullen es la equimosis periumbilical, por ejemplo en la pancreatitis hemorrágica.", "El signo es el correcto, pero no corresponde a la apendicitis."]),
  pregunta("Tromboembolismo pulmonar",
    "Para estimar la probabilidad clínica de tromboembolismo pulmonar antes de pedir estudios, ¿qué escala se usa?",
    ["Escala de Wells", "CURB-65", "Criterios de Centor", "Escala de Braden", "Puntaje de Apgar"], 0,
    "La escala de Wells (o la de Ginebra) estima la probabilidad clínica de tromboembolismo pulmonar y orienta qué estudio pedir, como el dímero D o la angiotomografía.",
    ["Correcta.", "CURB-65 es para la neumonía.", "Centor es para la faringitis estreptocócica.", "Braden valora el riesgo de lesiones por presión.", "Apgar valora al recién nacido."]),
  pregunta("Hipotiroidismo",
    "¿Qué patrón de laboratorio es típico del hipotiroidismo primario?",
    ["TSH elevada y T4 libre baja", "TSH baja y T4 libre alta", "TSH baja y T4 libre baja", "TSH normal y T4 libre alta", "TSH elevada y T4 libre alta"], 0,
    "En el hipotiroidismo primario la tiroides produce poca hormona (T4 libre baja) y la hipófisis responde aumentando la TSH.",
    ["Correcta.", "Es el patrón del hipertiroidismo primario.", "Orienta a un hipotiroidismo central (hipofisario o hipotalámico).",
      "No corresponde a un hipotiroidismo.", "Es raro y orienta a otras causas, como un adenoma productor de TSH."]),
  pregunta("Anemia",
    "Mujer de 30 años con cansancio y menstruaciones abundantes. Hemoglobina baja con VCM disminuido. ¿Qué dato apoya más una anemia ferropénica?",
    ["Ferritina sérica baja", "Ferritina sérica elevada", "Vitamina B12 baja", "Reticulocitos muy elevados", "VCM aumentado"], 0,
    "La ferritina baja refleja depósitos de hierro agotados y es el dato más útil para confirmar la ferropenia.",
    ["Correcta.", "Una ferritina alta no apoya la ferropenia (también sube con la inflamación).", "La falta de vitamina B12 da una anemia macrocítica.",
      "Los reticulocitos muy elevados orientan a hemólisis o a un sangrado agudo con buena respuesta de la médula.", "Un VCM aumentado es macrocitosis, lo contrario de este caso."]),
  pregunta("Cetoacidosis diabética",
    "¿Qué combinación define a la cetoacidosis diabética?",
    ["Hiperglucemia, acidosis metabólica y cetonemia", "Hiperglucemia, alcalosis y deshidratación", "Hipoglucemia, acidosis y cetonuria",
      "Hiperglucemia con hiperosmolaridad y sin acidosis", "Glucemia normal y acidosis láctica"], 0,
    "La cetoacidosis diabética combina hiperglucemia, acidosis metabólica con anión gap aumentado y cuerpos cetónicos elevados.",
    ["Correcta.", "Hay acidosis, no alcalosis.", "Cursa con hiperglucemia, no con hipoglucemia.", "Es el estado hiperosmolar hiperglucémico.", "No es una cetoacidosis diabética."]),
  pregunta("Insuficiencia cardíaca",
    "¿Qué clasificación gradúa la limitación de la actividad física en un paciente con insuficiencia cardíaca?",
    ["NYHA (New York Heart Association)", "Child-Pugh", "Killip", "Glasgow", "Forrest"], 0,
    "La clasificación de la NYHA va de la clase I a la IV según cuánto limitan los síntomas la actividad física.",
    ["Correcta.", "Child-Pugh es para la cirrosis.", "Killip clasifica la insuficiencia cardíaca en el infarto agudo según el examen físico, no según la actividad.",
      "Glasgow valora el nivel de conciencia.", "Forrest clasifica el sangrado de una úlcera péptica en la endoscopia."]),
  pregunta("Apendicitis",
    "Varón de 19 años con dolor que empezó alrededor del ombligo y migró a la fosa ilíaca derecha, con náuseas y fiebre leve. ¿Cuál es el diagnóstico más probable?",
    ["Apendicitis aguda", "Gastroenteritis aguda", "Cólico renal", "Pancreatitis aguda", "Colecistitis aguda"], 0,
    "La migración del dolor periumbilical a la fosa ilíaca derecha, con náuseas y fiebre, es muy sugestiva de apendicitis aguda.",
    ["Correcta.", "La gastroenteritis suele dar diarrea y un dolor difuso, sin migración.", "El cólico renal es un dolor lumbar que irradia a los genitales, con síntomas urinarios.",
      "La pancreatitis da un dolor epigástrico en cinturón.", "La colecistitis duele en el hipocondrio derecho."]),
];

const PREGUNTAS_ENF = [
  pregunta("Escala de Glasgow", "¿Cuál es el puntaje mínimo posible en la escala de coma de Glasgow?", ["3", "0", "1", "5", "8"], 0,
    "Cada componente (ocular, verbal y motor) suma al menos 1 punto: el mínimo es 3 y el máximo, 15.",
    ["Correcta.", "No existe el 0: cada componente vale al menos 1.", "Ningún componente vale 0, así que el total no baja de 3.", "5 no es el mínimo.",
      "8 o menos indica un compromiso grave de la conciencia, pero no es el mínimo."]),
  pregunta("Higiene de manos", "Según los 5 momentos de la OMS, ¿cuál de estos NO es un momento para la higiene de manos?",
    ["Antes de tocar al paciente", "Antes de una tarea limpia o aséptica", "Después del riesgo de exposición a fluidos corporales", "Después de tocar al paciente",
      "Antes de saludar a un colega en el pasillo"], 4,
    "Los 5 momentos son: antes de tocar al paciente, antes de una tarea limpia o aséptica, después del riesgo de exposición a fluidos corporales, después de tocar al paciente y después del contacto con su entorno.",
    ["Es el momento 1.", "Es el momento 2.", "Es el momento 3.", "Es el momento 4.", "Correcta: no es uno de los 5 momentos."]),
  pregunta("Escala de Braden", "¿Qué valora la escala de Braden?",
    ["El riesgo de lesiones por presión", "El riesgo de caídas", "El nivel de conciencia", "La intensidad del dolor", "El estado nutricional"], 0,
    "La escala de Braden valora el riesgo de lesiones por presión: percepción sensorial, humedad, actividad, movilidad, nutrición y fricción.",
    ["Correcta.", "El riesgo de caídas se valora, por ejemplo, con la escala de Morse.", "El nivel de conciencia se valora con la escala de Glasgow.",
      "El dolor se valora con la EVA o la escala numérica.", "Incluye la nutrición como un ítem, pero no es una escala nutricional."]),
  pregunta("Escala de Morse", "¿Para qué se usa la escala de Morse?",
    ["Valorar el riesgo de caídas", "Valorar el riesgo de lesiones por presión", "Medir el dolor", "Valorar el nivel de conciencia", "Valorar la dependencia en las actividades diarias"], 0,
    "La escala de Morse valora el riesgo de caídas en pacientes hospitalizados.",
    ["Correcta.", "Eso lo valora la escala de Braden.", "Para el dolor se usan la EVA o la escala numérica.", "Eso lo valora la escala de Glasgow.",
      "Eso lo valoran escalas como la de Barthel."]),
  pregunta("Posiciones", "Un paciente tiene dificultad para respirar. ¿Qué posición favorece la expansión pulmonar?",
    ["Fowler o semi-Fowler", "Trendelenburg", "Decúbito lateral de Sims", "Decúbito supino plano", "Litotomía"], 0,
    "Con la cabecera elevada (Fowler o semi-Fowler) el diafragma desciende y el paciente respira con menos esfuerzo.",
    ["Correcta.", "Con la cabeza más baja que los pies, las vísceras empujan el diafragma y dificultan la respiración.",
      "La posición de Sims se usa para otros fines, como un enema; no es la indicada para la disnea.", "Acostado plano, el diafragma sube y respira con más esfuerzo.",
      "Es una posición para procedimientos ginecológicos y urológicos."]),
  pregunta("Goteo", "Hay que pasar 1.000 mL de solución en 8 horas con un equipo de macrogotero (20 gotas = 1 mL). ¿Cuántas gotas por minuto?",
    ["42 gotas/min", "21 gotas/min", "28 gotas/min", "63 gotas/min", "125 gotas/min"], 0,
    "Gotas por minuto = volumen (mL) × factor (gotas/mL) ÷ tiempo (min) = 1.000 × 20 ÷ 480 = 41,7, que se redondea a 42.",
    ["Correcta.", "Es la mitad del resultado.", "Corresponde a pasarlo en 12 horas.", "Corresponde a un equipo de 30 gotas/mL.", "125 es el caudal en mL por hora, no las gotas por minuto."]),
  pregunta("Microgotero", "Con un equipo de microgotero (60 microgotas = 1 mL), ¿cuántas microgotas por minuto hacen falta para pasar 30 mL por hora?",
    ["30 microgotas/min", "60 microgotas/min", "10 microgotas/min", "15 microgotas/min", "120 microgotas/min"], 0,
    "Con microgotero, las microgotas por minuto son iguales a los mL por hora: 30 × 60 ÷ 60 = 30.",
    ["Correcta.", "Es el doble de lo indicado.", "Es un tercio de lo indicado.", "Es la mitad de lo indicado.", "Es cuatro veces lo indicado."]),
  pregunta("Vías de administración", "¿Con qué ángulo se inserta habitualmente la aguja en una inyección intramuscular?", ["90°", "45°", "15°", "30°", "180°"], 0,
    "La intramuscular se aplica a 90°; la subcutánea, habitualmente a 45°, y la intradérmica, a 10–15°.",
    ["Correcta.", "Es el ángulo habitual de la vía subcutánea.", "Es el ángulo de la vía intradérmica.", "No es el ángulo habitual de estas vías.",
      "No es un ángulo posible para una inyección."]),
  pregunta("Lesiones por presión", "Piel intacta, con un enrojecimiento que no palidece al presionar, sobre el sacro. ¿Qué estadio de lesión por presión es?",
    ["Estadio 1", "Estadio 2", "Estadio 3", "Estadio 4", "No es una lesión por presión"], 0,
    "El estadio 1 es el eritema que no palidece, con la piel intacta. En el estadio 2 ya hay pérdida parcial de la piel.",
    ["Correcta.", "El estadio 2 tiene pérdida parcial del espesor de la piel, como una ampolla o una úlcera superficial.",
      "El estadio 3 tiene pérdida total del espesor de la piel, con grasa visible.", "El estadio 4 expone músculo, tendón o hueso.",
      "Un eritema que no palidece sobre una prominencia ósea ya es una lesión por presión."]),
  pregunta("Oximetría de pulso", "¿Qué mide el oxímetro de pulso?",
    ["La saturación de oxígeno de la hemoglobina", "La presión parcial de oxígeno en la sangre arterial", "La frecuencia respiratoria", "El dióxido de carbono espirado",
      "La hemoglobina total"], 0,
    "El oxímetro de pulso estima, sin pinchar, qué porcentaje de la hemoglobina está saturada de oxígeno, y además muestra el pulso.",
    ["Correcta.", "La presión parcial de oxígeno se mide con una gasometría arterial.", "La frecuencia respiratoria se cuenta observando al paciente.",
      "El CO2 espirado se mide con un capnógrafo.", "La hemoglobina total se mide en un hemograma."]),
];

// ─── Lo que ya corrigió Ana antes (para «Así escribo yo») ────────────────────
// Consultas confirmadas de pacientes inventados, con lo que escribió la IA y
// lo que dejó ella.
const HISTORIA_ANA = [
  { paciente: "Juan Pérez", nota: { motivoConsulta: "Palpitaciones", plan: "Se solicita Holter de 24 horas.", diagnostico: "Palpitaciones; HTA", examenesSolicitados: ["Perfil lipídico"] },
    correcciones: [["motivoConsulta", "Paciente refiere palpitaciones", "Palpitaciones"], ["plan", "Se solicita jolter de 24 horas.", "Se solicita Holter de 24 horas."],
      ["diagnostico", "Palpitaciones; hipertensión arterial", "Palpitaciones; HTA"]] },
  { paciente: "María Choque", nota: { motivoConsulta: "Mareos", plan: "Pedimos Holter.", antecedentesRelevantes: "HTA hace años", examenesSolicitados: ["Perfil lipídico", "Electrocardiograma"] },
    correcciones: [["motivoConsulta", "Paciente refiere mareos", "Mareos"], ["plan", "Pedimos jolter.", "Pedimos Holter."],
      ["antecedentesRelevantes", "Hipertensión arterial hace años", "HTA hace años"]] },
  { paciente: "Pedro Flores", nota: { motivoConsulta: "Control", plan: "Enalapril c/12 h. Control en un mes.", examenesSolicitados: ["Electrocardiograma"] },
    correcciones: [["plan", "Enalapril cada 12 horas. Control en un mes.", "Enalapril c/12 h. Control en un mes."]] },
  { paciente: "Lucía Rojas", nota: { motivoConsulta: "Control de glucemia", plan: "Metformina c/8 h. Control con resultados.", examenesSolicitados: ["Perfil lipídico"] },
    correcciones: [["plan", "Metformina cada 8 horas. Control con resultados.", "Metformina c/8 h. Control con resultados."]] },
];

module.exports = {
  DIALOGO_MED, notaMed, tutorMed, razonamientoMed,
  DIALOGO_ENF, notaEnf, tutorEnf, razonamientoEnf,
  CASO_MED, RESPUESTAS_MED, EVALUACION_MED, CASO_ENF, RESPUESTAS_ENF, EVALUACION_ENF, delGuion,
  PREGUNTAS_MED, PREGUNTAS_ENF, HISTORIA_ANA,
};
