// ChatGo — AssemblyAI (transcripción de consultas médicas: diarización + Medical Mode)
// Prioridad del médico: separar bien quién habla (médico vs paciente).
// speaker_labels hace la diarización; domain=medical-v1 + keyterms_prompt afinan
// el reconocimiento de fármacos y términos clínicos en español.
const axios = require("axios");
const { CONFIG, log } = require("../config");

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
const KEYTERMS_POR_ESPECIALIDAD = {
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

// AssemblyAI acepta hasta 100 términos en streaming (más en batch, pero
// mantenemos una sola lista para que la vista previa y la transcripción
// final reconozcan exactamente el mismo vocabulario).
const MAX_KEYTERMS = 100;

function keytermsPara(tipoEspecialidad) {
  const propios = KEYTERMS_POR_ESPECIALIDAD[tipoEspecialidad] || [];
  return [...KEYTERMS_MEDICOS_ES, ...propios].slice(0, MAX_KEYTERMS);
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

async function pedirTranscripcion(audioUrl, tipoEspecialidad) {
  const res = await axios.post(
    "https://api.assemblyai.com/v2/transcript",
    {
      audio_url: audioUrl,
      language_code: "es",
      speaker_labels: true,
      // Sin esto, el modelo tiene que adivinar cuántas voces distintas hay
      // y en grabaciones donde una voz domina (médico más cerca del micrófono
      // que el paciente) suele terminar atribuyendo todo a un solo hablante.
      // Una consulta es médico + paciente casi siempre — si en algún caso
      // hay una tercera persona (acompañante), el modelo igual puede
      // detectarla, este número es solo una ayuda, no un límite estricto.
      speakers_expected: 2,
      domain: "medical-v1",
      keyterms_prompt: keytermsPara(tipoEspecialidad),
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

async function transcribirConsultaMedica(audioBuffer, tipoEspecialidad) {
  if (!CONFIG.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY no configurado");
  }

  const audioUrl = await subirAudio(audioBuffer);
  const id = await pedirTranscripcion(audioUrl, tipoEspecialidad);
  const data = await esperarTranscripcion(id);

  const segmentos = (data.utterances || []).map(u => ({
    hablante: u.speaker,   // "A", "B"... AssemblyAI no sabe cuál es médico/paciente
    texto: u.text,
    inicioSeg: u.start / 1000,
    finSeg: u.end / 1000,
  }));

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

module.exports = { transcribirConsultaMedica, crearTokenStreaming, keytermsPara };
