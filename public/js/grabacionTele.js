// Vitalis — Grabar la teleconsulta en dos canales.
//
// ═══ POR QUÉ NO ES UNA GRABACIÓN MÁS ═══════════════════════════════════════
//
// En la consulta presencial las dos voces entran por el mismo micrófono, y
// separar quién dijo qué queda en manos de la diarización: un modelo mirando
// timbres de voz y decidiendo "acá cambió el hablante". Devuelve "A" y "B", y
// no sabe cuál de los dos es el médico. A veces se equivoca, y cuando se
// equivoca lo hace en silencio.
//
// En la teleconsulta ese problema NO EXISTE, y lo importante es no
// resolverlo igual. El micrófono del médico y el audio que llega del paciente
// son dos fuentes distintas desde el principio. Basta con no mezclarlas:
//
//     micrófono del médico  ──►  canal izquierdo
//     audio del paciente    ──►  canal derecho
//
// Y entonces no se adivina nada. El canal 1 ES el médico, por construcción.
// Un dato, no una inferencia.
//
// ═══ EL CONSENTIMIENTO NO SE CHEQUEA ACÁ, Y ES A PROPÓSITO ═════════════════
//
// Podría preguntarse "¿aceptó grabar?" antes de empezar, pero sería una
// segunda copia de una regla que ya vive en el servidor, y las segundas
// copias se desincronizan.
//
// La garantía es más fuerte que un if: el paciente NO PUEDE entrar a la sala
// sin haber aceptado — la ruta que reparte el token lo rechaza con 403. Así
// que si hay alguien del otro lado, aceptó. Esto arranca cuando llega el
// audio del paciente, o sea después de esa puerta, nunca antes.
//
// Por eso también graba solo el médico: su navegador ya tiene las dos puntas.
let teleGrabRec = null;
let teleGrabTrozos = [];
let teleGrabMime = "";
let teleGrabCtx = null;

function teleGrabGrabando() {
  return Boolean(teleGrabRec && teleGrabRec.state === "recording");
}

// Devuelve true si arrancó. No tira nunca: que falle la grabación no puede
// tumbar una consulta que ya está pasando, con el paciente en pantalla.
function teleGrabIniciar(streamMedico, streamPaciente) {
  if (teleGrabGrabando()) return true;
  if (!window.MediaRecorder || !window.AudioContext && !window.webkitAudioContext) return false;

  const pistasMedico = streamMedico?.getAudioTracks?.() || [];
  const pistasPaciente = streamPaciente?.getAudioTracks?.() || [];
  if (!pistasMedico.length || !pistasPaciente.length) return false;

  try {
    teleGrabCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Algunos navegadores lo entregan suspendido hasta que hay un gesto del
    // usuario. Acá lo hubo (tocó "Entrar"), pero pedirlo igual no cuesta.
    teleGrabCtx.resume?.().catch(() => {});

    // Dos entradas, una salida estéreo. Cada fuente va a SU canal y solo a
    // ese: si las dos fueran a los dos, tendríamos un mono disfrazado y toda
    // la ventaja se pierde sin que se note.
    const mezclador = teleGrabCtx.createChannelMerger(2);
    teleGrabCtx.createMediaStreamSource(new MediaStream([pistasMedico[0]])).connect(mezclador, 0, 0);
    teleGrabCtx.createMediaStreamSource(new MediaStream([pistasPaciente[0]])).connect(mezclador, 0, 1);

    const destino = teleGrabCtx.createMediaStreamDestination();
    mezclador.connect(destino);

    const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    teleGrabMime = tipos.find(t => MediaRecorder.isTypeSupported(t)) || "";
    teleGrabRec = new MediaRecorder(destino.stream, teleGrabMime ? { mimeType: teleGrabMime } : undefined);
    teleGrabTrozos = [];
    teleGrabRec.ondataavailable = (e) => { if (e.data && e.data.size) teleGrabTrozos.push(e.data); };
    // Un trozo por segundo en vez de uno solo al final: si el navegador se
    // cierra mal, lo que ya se juntó sigue en memoria y se puede subir.
    teleGrabRec.start(1000);
    return true;
  } catch {
    teleGrabLimpiar();
    return false;
  }
}

function teleGrabLimpiar() {
  try { teleGrabCtx?.close(); } catch { /* ya estaba cerrado */ }
  teleGrabCtx = null;
  teleGrabRec = null;
}

// Corta y devuelve { blob, mimeType } — o null si no había nada grabado.
// Nunca rechaza: quien llama está terminando una consulta y no puede quedar
// colgado esperando.
function teleGrabDetener() {
  return new Promise((resolver) => {
    if (!teleGrabRec) return resolver(null);
    if (teleGrabRec.state === "inactive") {
      const r = teleGrabArmarBlob();
      teleGrabLimpiar();
      return resolver(r);
    }
    // Si el "stop" nunca llega (pasa en algunos navegadores móviles), se
    // devuelve lo que haya en vez de dejar al médico esperando para siempre.
    const reloj = setTimeout(() => {
      const r = teleGrabArmarBlob();
      teleGrabLimpiar();
      resolver(r);
    }, 4000);
    teleGrabRec.onstop = () => {
      clearTimeout(reloj);
      const r = teleGrabArmarBlob();
      teleGrabLimpiar();
      resolver(r);
    };
    try { teleGrabRec.stop(); } catch { clearTimeout(reloj); teleGrabLimpiar(); resolver(null); }
  });
}

function teleGrabArmarBlob() {
  if (!teleGrabTrozos.length) return null;
  const tipo = teleGrabMime || "audio/webm";
  const blob = new Blob(teleGrabTrozos, { type: tipo });
  teleGrabTrozos = [];
  // Un webm de dos segundos es alguien que entró y colgó, no una consulta.
  // Subirlo gasta saldo del médico y ensucia la ficha con una consulta vacía.
  if (blob.size < 8000) return null;
  return { blob, mimeType: tipo };
}
