// ChatGo — AssemblyAI (transcripción de consultas médicas: diarización + Medical Mode)
// Prioridad del médico: separar bien quién habla (médico vs paciente).
// speaker_labels hace la diarización; domain=medical-v1 + keyterms_prompt afinan
// el reconocimiento de fármacos y términos clínicos.
//
// El vocabulario de cada idioma (y por qué el portugués lo necesita más que
// el español: no tiene Medical Mode) vive en
// services/idiomas/<idioma>/transcripcion.js.
const axios = require("axios");
const { CONFIG, log } = require("../config");
const { idiomaSoportado, perfil } = require("./idiomas");

// Idiomas donde domain: "medical-v1" hace algo. Con cualquier otro, mandarlo
// no rompe —la API lo ignora— pero preferimos no mandarlo y dejar dicho en
// el log que esa consulta fue sin Medical Mode.
const IDIOMAS_CON_MEDICAL_MODE = ["en", "es", "de", "fr"];

// AssemblyAI acepta hasta 100 términos en streaming (más en batch, pero
// mantenemos una sola lista para que la vista previa y la transcripción
// final reconozcan exactamente el mismo vocabulario).
const MAX_KEYTERMS = 100;

// Cuántos lugares, como mucho, se llevan los medicamentos del propio médico.
const MAX_KEYTERMS_DEL_MEDICO = 25;

// Orden = prioridad (si algo se corta al llegar a 100, es lo último):
//   1. lo que ESTE médico receta (services/vocabularioMedico.js): es lo más
//      probable que diga, y lo que ninguna lista general va a tener —sus
//      marcas, sus combinaciones—.
//   2. su especialidad.
//   3. el vocabulario general del idioma (incluye cómo se dicta la posología).
//   4. los fármacos más recetados, hasta llenar.
// Sin repetidos: «Losartana» del médico y «losartana» de la lista son uno.
function keytermsPara(tipoEspecialidad, idioma, delMedico = []) {
  const lang = idiomaSoportado(idioma);
  const vistos = new Set();
  const clave = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const lista = [];
  const sumar = (terminos, tope = Infinity) => {
    let n = 0;
    for (const t of terminos) {
      if (lista.length >= MAX_KEYTERMS || n >= tope) return;
      const txt = String(t || "").trim();
      // AssemblyAI rechaza términos de más de 6 palabras.
      if (!txt || txt.split(/\s+/).length > 6 || vistos.has(clave(txt))) continue;
      vistos.add(clave(txt));
      lista.push(txt);
      n++;
    }
  };
  sumar(Array.isArray(delMedico) ? delMedico : [], MAX_KEYTERMS_DEL_MEDICO);
  const vocab = perfil(lang).transcripcion;
  sumar(vocab.porEspecialidad[tipoEspecialidad] || []);
  sumar(vocab.generales);
  sumar(vocab.farmacos);
  return lista;
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
async function pedirTranscripcion(audioUrl, tipoEspecialidad, idioma, { multicanal = false, delMedico = [] } = {}) {
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
      keyterms_prompt: keytermsPara(tipoEspecialidad, lang, delMedico),
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

async function transcribirConsultaMedica(audioBuffer, tipoEspecialidad, idioma, { multicanal = false, delMedico = [] } = {}) {
  if (!CONFIG.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY no configurado");
  }

  const audioUrl = await subirAudio(audioBuffer);
  const id = await pedirTranscripcion(audioUrl, tipoEspecialidad, idioma, { multicanal, delMedico });
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

// ─── La nota de voz de un paciente por WhatsApp ────────────────────────────
//
// ═══ POR QUÉ NO SE REUSA transcribirConsultaMedica ═════════════════════════
//
// Aquella pide diarización —separar quién habla— porque una consulta son dos
// o tres voces sobre el mismo micrófono. Una nota de voz de WhatsApp es una
// persona sola diciendo "hola doctora, quiero turno para el jueves".
//
// Pedir diarización ahí no es solo gastar de más: el motor puede partir a la
// misma persona en dos hablantes inventados cuando hace una pausa, y la
// transcripción vuelve descuartizada.
//
// El vocabulario clínico SÍ se mantiene: el paciente nombra su medicación
// ("me quedé sin la losartana") y es justo donde una transcripción común se
// equivoca.
async function transcribirNotaDeVoz(audioBuffer, tipoEspecialidad, idioma) {
  if (!CONFIG.ASSEMBLYAI_API_KEY) throw new Error("ASSEMBLYAI_API_KEY no configurado");

  const lang = idiomaSoportado(idioma);
  const audioUrl = await subirAudio(audioBuffer);
  const res = await axios.post(
    "https://api.assemblyai.com/v2/transcript",
    {
      audio_url: audioUrl,
      language_code: lang,
      keyterms_prompt: keytermsPara(tipoEspecialidad, lang),
      // Sin speaker_labels, sin multichannel y sin domain: una voz, un texto.
    },
    {
      headers: { Authorization: CONFIG.ASSEMBLYAI_API_KEY, "Content-Type": "application/json" },
      timeout: CONFIG.TIMEOUT_ASSEMBLYAI,
    }
  );
  const data = await esperarTranscripcion(res.data.id);
  return { texto: data.text || "", duracionSegundos: data.audio_duration || null };
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

module.exports = { transcribirConsultaMedica, transcribirNotaDeVoz, crearTokenStreaming, keytermsPara, idiomaSoportado, IDIOMAS_CON_MEDICAL_MODE, MAX_KEYTERMS };
