// ChatGo — AssemblyAI (transcripción de consultas médicas: diarización + Medical Mode)
// Prioridad del médico: separar bien quién habla (médico vs paciente).
// speaker_labels hace la diarización; domain=medical-v1 + keyterms_prompt afinan
// el reconocimiento de fármacos y términos clínicos.
//
// ═══ POR QUÉ EL PORTUGUÉS NO ES SOLO CAMBIAR "es" POR "pt" ═════════════════
//
// El Medical Mode de AssemblyAI (domain: "medical-v1") solo existe para
// inglés, español, alemán y francés. Para portugués la API IGNORA el
// parámetro y devuelve un aviso: la transcripción sale igual, pero sin el
// modelo que entiende medicamentos, dosis y procedimientos.
//   https://www.assemblyai.com/docs/pre-recorded-audio/medical-mode
//
// O sea que en portugués perdemos justamente lo que Symphomed vende. Lo único
// que queda para compensar es keyterms_prompt, que sí funciona en cualquier
// idioma. Por eso el vocabulario de abajo no es un extra en portugués: es lo
// principal.
//
// Y no es la lista en español traducida. En Brasil se dice losartana y no
// losartán, varfarina y no warfarina, dipirona por metamizol, cinomose por
// moquillo, puericultura por control de niño sano. Un término mal escrito no
// solo no ayuda: le enseña al modelo una palabra que nadie va a decir.
//
// ⚠️ ESTA LISTA NO LA REVISÓ TODAVÍA UN MÉDICO BRASILEÑO. Está armada con la
// nomenclatura DCB (Denominação Comum Brasileira, la oficial de ANVISA)
// donde corresponde, pero hasta que alguien que atiende en Brasil la lea,
// tratala como un borrador informado y no como algo verificado.
const axios = require("axios");
const { CONFIG, log } = require("../config");

// Idiomas donde domain: "medical-v1" hace algo. Con cualquier otro, mandarlo
// no rompe —la API lo ignora— pero preferimos no mandarlo y dejar dicho en
// el log que esa consulta fue sin Medical Mode.
const IDIOMAS_CON_MEDICAL_MODE = ["en", "es", "de", "fr"];

const KEYTERMS_MEDICOS_ES = [
  "paracetamol", "ibuprofeno", "amoxicilina", "diclofenaco", "omeprazol",
  "loratadina", "metformina", "losartán", "atorvastatina", "azitromicina",
  "ciprofloxacino", "prednisona", "salbutamol", "insulina", "warfarina",
  "hipertensión", "diabetes", "gastritis", "faringitis", "bronquitis",
  "presión arterial", "glucosa", "colesterol", "electrocardiograma",
  "radiografía", "resonancia magnética", "tomografía", "biopsia",
];

// Vocabulario propio de cada rama, que se suma al general. Sin esto, un
// odontólogo dictando "pieza 36 con caries oclusal" pelea contra un modelo
// afinado para medicina general — y justamente esos términos son los que
// después alimentan el odontograma automático.
const KEYTERMS_POR_ESPECIALIDAD_ES = {
  odontologia: [
    "odontograma", "pieza dental", "caries", "caries oclusal", "caries interproximal",
    "endodoncia", "obturación", "resina", "amalgama", "corona", "sellante",
    "extracción", "exodoncia", "implante", "periodontitis", "gingivitis",
    "sarro", "placa bacteriana", "profilaxis", "pulpitis", "absceso",
    "maxilar", "mandíbula", "molar", "premolar", "canino", "incisivo",
    "oclusión", "bruxismo", "ortodoncia", "brackets", "prótesis",
  ],
  oftalmologia: [
    "agudeza visual", "miopía", "astigmatismo", "hipermetropía", "presbicia",
    "catarata", "glaucoma", "retina", "córnea", "cristalino", "conjuntivitis",
    "presión intraocular", "fondo de ojo", "mácula", "nervio óptico",
    "queratitis", "uveítis", "estrabismo", "dioptrías",
  ],
  ginecologia: [
    "embarazo", "gestación", "semanas de gestación", "ecografía obstétrica",
    "papanicolau", "colposcopía", "menstruación", "amenorrea", "endometrio",
    "ovario", "útero", "cesárea", "parto", "anticonceptivo", "menopausia",
    "preeclampsia", "trimestre",
  ],
  neurodesarrollo: [
    "autismo", "trastorno del espectro autista", "TEA", "síndrome de Down",
    "trisomía 21", "neurodesarrollo", "perfil sensorial", "hiperreactividad",
    "hiporreactividad", "estereotipias", "ecolalia", "desregulación",
    "comunicación aumentativa", "PECS", "integración sensorial",
    "terapia ocupacional", "fonoaudiología", "psicomotricidad",
    "nivel de apoyo", "conductas restringidas", "interés restringido",
    "anticipación", "agenda visual", "TDAH", "hipotonía", "atlantoaxial",
    "hipotiroidismo", "estimulación temprana", "inclusión escolar",
  ],
  pediatria: [
    "percentil", "curva de crecimiento", "perímetro cefálico", "edad corregida",
    "prematuro", "recién nacido", "lactante", "pretérmino", "a término",
    "lactancia materna", "ablactación", "fontanela", "reflejo de Moro",
    "desarrollo psicomotor", "control de niño sano", "pentavalente",
    "bronquiolitis", "otitis media", "faringoamigdalitis", "exantema",
    "convulsión febril", "deshidratación", "diarrea aguda", "peso al nacer",
    "talla", "milígramos por kilo", "gotas", "jarabe", "suspensión",
  ],
  veterinaria: [
    "canino", "felino", "desparasitación", "vacuna antirrábica", "moquillo",
    "parvovirus", "castración", "esterilización", "garrapata", "pulgas",
    "dermatitis", "otitis", "peso corporal", "raza", "mestizo",
  ],
  estetica: [
    "toxina botulínica", "bótox", "ácido hialurónico", "relleno dérmico",
    "peeling", "mesoterapia", "lipopapada", "hilos tensores", "colágeno",
    "arrugas", "surco nasogeniano", "flacidez", "melasma", "láser",
  ],
};

// ─── PORTUGUÉS DE BRASIL ──────────────────────────────────────────────────
// Ver el aviso de arriba: acá el vocabulario no acompaña al Medical Mode,
// lo reemplaza.
const KEYTERMS_MEDICOS_PT = [
  // Nombres DCB. Los que difieren del español están marcados porque son los
  // que más fácil se cuelan mal traducidos.
  "paracetamol", "ibuprofeno", "amoxicilina", "diclofenaco", "omeprazol",
  "dipirona",              // en español sería metamizol; en Brasil es lo más recetado que hay
  "loratadina", "metformina",
  "losartana",             // NO "losartán"
  "atorvastatina", "azitromicina", "ciprofloxacino", "prednisona",
  "salbutamol", "insulina",
  "varfarina",             // NO "warfarina"
  "hipertensão", "diabetes", "gastrite", "faringite", "bronquite",
  "pressão arterial",
  "glicemia",              // en Brasil se dice glicemia, no glucosa
  "colesterol", "eletrocardiograma", "hemograma",
  "radiografia", "ressonância magnética", "tomografia", "biópsia",
  // Cómo se dictan las indicaciones en Brasil. Sin esto, la posología —que
  // es lo que no se puede equivocar— sale hecha pedazos.
  "posologia", "comprimido", "via oral", "de 8 em 8 horas", "em jejum",
];

const KEYTERMS_POR_ESPECIALIDAD_PT = {
  odontologia: [
    "odontograma", "dente", "cárie", "cárie oclusal", "cárie interproximal",
    "endodontia", "tratamento de canal",   // lo segundo es como lo dice todo el mundo
    "restauração", "resina", "amálgama", "coroa", "selante",
    "extração", "exodontia", "implante", "periodontite", "gengivite",
    "tártaro", "placa bacteriana", "profilaxia", "pulpite", "abscesso",
    "maxila", "mandíbula", "molar", "pré-molar", "canino", "incisivo",
    "oclusão", "bruxismo", "ortodontia", "aparelho", "prótese",
  ],
  oftalmologia: [
    "acuidade visual", "miopia", "astigmatismo", "hipermetropia", "presbiopia",
    "catarata", "glaucoma", "retina", "córnea", "cristalino", "conjuntivite",
    "pressão intraocular", "fundo de olho", "mácula", "nervo óptico",
    "ceratite", "uveíte", "estrabismo", "dioptrias", "grau",
  ],
  ginecologia: [
    "gravidez", "gestação", "semanas de gestação",
    "ultrassom obstétrico",   // en Brasil "ultrassom", no "ecografía"
    "exame preventivo", "papanicolau", "colposcopia",
    "menstruação", "amenorreia", "endométrio", "ovário", "útero",
    "cesariana",              // NO "cesárea"
    "parto", "anticoncepcional", "menopausa", "pré-eclâmpsia", "trimestre",
  ],
  neurodesarrollo: [
    "autismo", "transtorno do espectro autista", "TEA", "síndrome de Down",
    "trissomia 21", "neurodesenvolvimento", "perfil sensorial",
    "hiper-reatividade", "hiporreatividade", "estereotipias", "ecolalia",
    "desregulação", "comunicação aumentativa", "PECS", "integração sensorial",
    "terapia ocupacional", "fonoaudiologia", "psicomotricidade",
    "nível de suporte", "comportamentos restritos", "interesse restrito",
    "antecipação", "agenda visual", "TDAH", "hipotonia", "atlantoaxial",
    "hipotireoidismo",
    "estimulação precoce",    // en español "estimulación temprana"
    "inclusão escolar",
  ],
  pediatria: [
    "percentil", "curva de crescimento", "perímetro cefálico", "idade corrigida",
    "prematuro", "recém-nascido", "lactente", "pré-termo", "a termo",
    "aleitamento materno", "introdução alimentar", "fontanela", "reflexo de Moro",
    "desenvolvimento neuropsicomotor",
    "puericultura",           // el "control de niño sano" brasileño
    "pentavalente", "bronquiolite", "otite média", "faringoamigdalite",
    "exantema", "convulsão febril", "desidratação", "diarreia aguda",
    "peso ao nascer", "estatura", "miligramas por quilo", "gotas", "xarope",
    "suspensão",
  ],
  veterinaria: [
    "canino", "felino",
    "vermifugação",           // desparasitación
    "vacina antirrábica",
    "cinomose",               // moquillo
    "parvovirose", "castração", "esterilização", "carrapato", "pulgas",
    "dermatite", "otite", "peso corporal", "raça",
    "sem raça definida", "SRD",
  ],
  estetica: [
    "toxina botulínica", "botox", "ácido hialurônico",
    "preenchimento",          // el "relleno dérmico"
    "peeling", "mesoterapia", "papada",
    "fios de sustentação",    // hilos tensores
    "colágeno", "rugas", "sulco nasogeniano", "flacidez", "melasma", "laser",
  ],
};

const KEYTERMS_MEDICOS = { es: KEYTERMS_MEDICOS_ES, pt: KEYTERMS_MEDICOS_PT };
const KEYTERMS_ESPECIALIDAD = { es: KEYTERMS_POR_ESPECIALIDAD_ES, pt: KEYTERMS_POR_ESPECIALIDAD_PT };

// AssemblyAI acepta hasta 100 términos en streaming (más en batch, pero
// mantenemos una sola lista para que la vista previa y la transcripción
// final reconozcan exactamente el mismo vocabulario).
const MAX_KEYTERMS = 100;

// El idioma sale de la cuenta del médico. Uno desconocido cae en español y
// no en vacío: mejor el vocabulario equivocado que ninguno.
function idiomaSoportado(idioma) {
  return KEYTERMS_MEDICOS[idioma] ? idioma : "es";
}

function keytermsPara(tipoEspecialidad, idioma) {
  const lang = idiomaSoportado(idioma);
  const propios = KEYTERMS_ESPECIALIDAD[lang][tipoEspecialidad] || [];
  return [...KEYTERMS_MEDICOS[lang], ...propios].slice(0, MAX_KEYTERMS);
}

async function subirAudio(audioBuffer) {
  const res = await axios.post("https://api.assemblyai.com/v2/upload", audioBuffer, {
    headers: { Authorization: CONFIG.ASSEMBLYAI_API_KEY, "Content-Type": "application/octet-stream" },
    timeout: CONFIG.TIMEOUT_ASSEMBLYAI,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return res.data.upload_url;
}

// ═══ DOS CANALES LE GANAN A LA DIARIZACIÓN ═══════════════════════════════════
//
// En una consulta presencial las dos voces entran por el mismo micrófono, así
// que separar quién dijo qué es un problema de adivinanza: eso es la
// diarización (speaker_labels), y devuelve "A" y "B" sin saber cuál de los
// dos es el médico.
//
// En una teleconsulta ese problema no existe, y no hay que resolverlo: hay
// mejor. El micrófono del médico y el audio que llega del paciente son dos
// fuentes distintas desde el principio. Se graban en canales separados —el
// médico en el izquierdo, el paciente en el derecho— y entonces no se
// adivina nada: el canal 1 ES el médico, por construcción.
//
// multichannel y speaker_labels no van juntos, y está bien que no vayan:
// pedir diarización sobre un audio donde ya sabés quién es quién es pedirle
// al modelo que dude de un dato que ya tenés.
async function pedirTranscripcion(audioUrl, tipoEspecialidad, idioma, { multicanal = false } = {}) {
  const lang = idiomaSoportado(idioma);
  const conMedicalMode = IDIOMAS_CON_MEDICAL_MODE.includes(lang);
  if (!conMedicalMode) {
    // Que quede en el log de esa consulta y no solo en un comentario: si
    // mañana una nota clínica en portugués sale con un medicamento mal, esto
    // es lo primero que hay que mirar.
    log.warn(`[ASSEMBLYAI] ${lang}: sin Medical Mode (solo ${IDIOMAS_CON_MEDICAL_MODE.join("/")}). Va con keyterms nada más.`);
  }
  const res = await axios.post(
    "https://api.assemblyai.com/v2/transcript",
    {
      audio_url: audioUrl,
      language_code: lang,
      ...(multicanal ? { multichannel: true } : { speaker_labels: true }),
      // Un RANGO, no un número exacto. Antes iba speakers_expected: 2, con el
      // comentario de que era "solo una ayuda, no un límite estricto". Eso
      // era falso: la documentación dice que speakers_expected se use SOLO
      // cuando uno está seguro, porque un valor incorrecto empeora la
      // precisión, y lista precisamente "speakers_expected mal puesto" entre
      // las causas de que la transcripción salga con un solo hablante.
      //   https://www.assemblyai.com/docs/speech-to-text/speaker-diarization
      //
      // Y una consulta no siempre son dos personas: en pediatría siempre hay
      // madre o padre, en geriatría suele haber acompañante, y a veces el
      // médico dicta solo. Afirmarle "acá hay exactamente dos" cuando hay
      // tres es pedirle que se equivoque.
      //
      // El mínimo en 1 y no en 2 a propósito: forzar dos voces en una
      // grabación donde solo habla el médico lo parte en dos hablantes
      // inventados, que es peor que no separar nada.
      ...(multicanal ? {} : { speaker_options: { min_speakers_expected: 1, max_speakers_expected: 4 } }),
      // Solo donde existe. Mandarlo igual no rompe (la API lo ignora), pero
      // así la petición dice la verdad de lo que va a pasar.
      ...(conMedicalMode ? { domain: "medical-v1" } : {}),
      keyterms_prompt: keytermsPara(tipoEspecialidad, lang),
    },
    {
      headers: { Authorization: CONFIG.ASSEMBLYAI_API_KEY, "Content-Type": "application/json" },
      timeout: CONFIG.TIMEOUT_ASSEMBLYAI,
    }
  );
  return res.data.id;
}

async function esperarTranscripcion(id) {
  const inicio = Date.now();
  while (Date.now() - inicio < CONFIG.TIMEOUT_TRANSCRIPCION_TOTAL) {
    const res = await axios.get(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { Authorization: CONFIG.ASSEMBLYAI_API_KEY },
      timeout: CONFIG.TIMEOUT_ASSEMBLYAI,
    });
    if (res.data.status === "completed") return res.data;
    if (res.data.status === "error") throw new Error(res.data.error || "AssemblyAI falló al transcribir");
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Tiempo de espera agotado transcribiendo el audio");
}

// Canal 1 = izquierdo = micrófono del médico. Canal 2 = derecho = lo que
// llegó del paciente. Lo decide public/js/grabacionTele.js al mezclar, y es
// la única convención que ata las dos puntas: si alguna vez se da vuelta
// allá, hay que darla vuelta acá.
//
// Devuelve "" si el canal no vino o no es uno de los dos esperados. Vacío
// significa "no sé", y la pantalla muestra el hablante genérico: preferible
// a etiquetar de médico algo que dijo el paciente, que es exactamente el
// tipo de error que después nadie revisa.
function quienSegunCanal(canal) {
  const n = String(canal ?? "").trim();
  if (n === "1") return "medico";
  if (n === "2") return "paciente";
  return "";
}

async function transcribirConsultaMedica(audioBuffer, tipoEspecialidad, idioma, { multicanal = false } = {}) {
  if (!CONFIG.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY no configurado");
  }

  const audioUrl = await subirAudio(audioBuffer);
  const id = await pedirTranscripcion(audioUrl, tipoEspecialidad, idioma, { multicanal });
  const data = await esperarTranscripcion(id);

  const segmentos = (data.utterances || []).map(u => ({
    hablante: u.speaker,   // "A", "B"... AssemblyAI no sabe cuál es médico/paciente
    quien: multicanal ? quienSegunCanal(u.channel) : "",
    texto: u.text,
    inicioSeg: u.start / 1000,
    finSeg: u.end / 1000,
  }));

  // Si se pidió multicanal y no volvió ni un canal, la grabación salió mono
  // (un navegador que no respetó la mezcla) o la respuesta no trae channel.
  // No es motivo para tirar la transcripción —el texto está igual—, pero
  // tiene que quedar escrito: la próxima vez que alguien mire por qué la
  // teleconsulta no dice quién habló, esto lo contesta.
  if (multicanal && segmentos.length && !segmentos.some(s => s.quien)) {
    log.warn("[ASSEMBLYAI] multicanal pedido pero ningún segmento trae canal — se guarda sin médico/paciente");
  }

  return {
    transcripcionCompleta: data.text || "",
    segmentos,
    duracionSegundos: data.audio_duration || null,
  };
}

// Token de corta duración para que el navegador se conecte DIRECTO al
// WebSocket de streaming de AssemblyAI (vista previa en vivo mientras se
// graba). Nunca se manda la API key real al navegador.
async function crearTokenStreaming() {
  if (!CONFIG.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY no configurado");
  }
  const res = await axios.get("https://streaming.assemblyai.com/v3/token", {
    params: { expires_in_seconds: 60 },
    headers: { Authorization: CONFIG.ASSEMBLYAI_API_KEY },
    timeout: CONFIG.TIMEOUT_ASSEMBLYAI,
  });
  return res.data.token;
}

module.exports = { transcribirConsultaMedica, crearTokenStreaming, keytermsPara, idiomaSoportado, IDIOMAS_CON_MEDICAL_MODE };
