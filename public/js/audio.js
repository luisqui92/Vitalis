// Vitalis — grabación de audio: onda de voz en vivo, subida de consultas, y
// vista previa de transcripción en vivo (WebSocket a AssemblyAI). Lo usan
// tanto la grabación local (consultas.js) como el celular vinculado
// (vinculacion.js).

// Hace "latir" el logo de Vitalis (círculo con anillos alrededor) en
// tiempo real según el volumen que capta el micrófono — reemplaza el
// barrido de barras genérico por algo que se sienta parte de la marca:
// cada vez que detecta voz, el logo pulsa más fuerte y los anillos se
// expanden, como un pulso cardíaco. Se usa tanto grabando local (compu con
// micrófono) como en el celular vinculado como micrófono remoto.
function crearIndicadorAudio(orbEl) {
  let audioCtx = null, analyser = null, dataArray = null, animId = null, nivelSuavizado = 0;

  function dibujar() {
    animId = requestAnimationFrame(dibujar);
    analyser.getByteTimeDomainData(dataArray);
    let sumaCuadrados = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128;
      sumaCuadrados += v * v;
    }
    const rms = Math.sqrt(sumaCuadrados / dataArray.length);
    // El ruido de fondo también tiene algo de RMS; restamos un piso para
    // que un ambiente en silencio no haga "latir" el logo todo el tiempo.
    const nivelCrudo = Math.min(1, Math.max(0, (rms - 0.02) * 6));
    nivelSuavizado += (nivelCrudo - nivelSuavizado) * 0.25;
    orbEl.style.setProperty("--nivel", nivelSuavizado.toFixed(3));
  }

  return {
    iniciar(stream) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.fftSize);
      dibujar();
    },
    detener() {
      if (animId) cancelAnimationFrame(animId);
      if (audioCtx) audioCtx.close();
      audioCtx = null; analyser = null;
      orbEl.style.setProperty("--nivel", 0);
    },
  };
}

// Sube el audio grabado/subido y crea la consulta. Se usa tanto grabando
// local como desde el celular vinculado como micrófono remoto.
async function subirConsulta(pacienteId, blob, mimeType) {
  return api("/medico/consultas?pacienteId=" + encodeURIComponent(pacienteId), {
    method: "POST",
    headers: { "Content-Type": mimeType || "audio/webm" },
    body: blob,
  });
}

// Vista previa en vivo: mientras se graba (para el archivo real, que es lo
// que se guarda), en paralelo se manda el audio en crudo (PCM 16kHz) al
// WebSocket de AssemblyAI para mostrar el texto apareciendo mientras se
// habla. Si esto falla por lo que sea, no afecta la grabación real — es
// solo decorativo, la transcripción de verdad sigue viniendo del archivo
// subido al terminar.
function crearTranscriptorEnVivo(onTexto) {
  let ws = null, audioCtx = null, workletNode = null, source = null, detenidoManualmente = false;

  const CODIGO_WORKLET = `
    class PCMWorklet extends AudioWorkletProcessor {
      constructor() {
        super();
        this.ratio = sampleRate / 16000;
        // process() se llama cada ~128 muestras (unos 2-3ms) — mandar un
        // mensaje por cada llamada da chunks de milisegundos, y AssemblyAI
        // rechaza (cierra con código 3007) cualquier chunk de menos de
        // 50ms. Por eso se acumula hasta juntar ~100ms (1600 muestras a
        // 16kHz) antes de mandar cada mensaje.
        this.pendientes = [];
        this.tamanoChunk = 1600;
      }
      process(inputs) {
        const input = inputs[0][0];
        if (input && input.length) {
          const outLen = Math.max(1, Math.floor(input.length / this.ratio));
          for (let i = 0; i < outLen; i++) {
            const srcIdx = i * this.ratio;
            const i0 = Math.floor(srcIdx);
            const i1 = Math.min(i0 + 1, input.length - 1);
            const frac = srcIdx - i0;
            const sample = input[i0] * (1 - frac) + input[i1] * frac;
            const s = Math.max(-1, Math.min(1, sample));
            this.pendientes.push(s < 0 ? s * 32768 : s * 32767);
          }
          while (this.pendientes.length >= this.tamanoChunk) {
            const listo = this.pendientes.splice(0, this.tamanoChunk);
            const buf = new Int16Array(listo);
            this.port.postMessage(buf.buffer, [buf.buffer]);
          }
        }
        return true;
      }
    }
    registerProcessor("pcm-worklet", PCMWorklet);
  `;

  async function iniciar(stream) {
    detenidoManualmente = false;
    try {
      const { token, keyterms } = await api("/medico/transcripcion-token");
      // Mismo criterio que la transcripción final (services/assemblyai.js):
      // Medical Mode + vocabulario de la especialidad, para que lo que se ve
      // mientras se habla se parezca a lo que después queda guardado.
      // Los parámetros de lista (language_codes, keyterms_prompt) van como
      // array JSON codificado en la URL — probado contra la API: mandarlos
      // como parámetros repetidos devuelve "Invalid JSON array".
      const params = new URLSearchParams({
        sample_rate: "16000",
        encoding: "pcm_s16le",
        speech_model: "universal-3-5-pro",
        domain: "medical-v1",
        mode: "balanced",
        language_codes: JSON.stringify(["es"]),
        token,
      });
      if (Array.isArray(keyterms) && keyterms.length) {
        params.set("keyterms_prompt", JSON.stringify(keyterms));
      }
      ws = new WebSocket("wss://streaming.assemblyai.com/v3/ws?" + params.toString());

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const blobUrl = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: "application/javascript" }));
      await audioCtx.audioWorklet.addModule(blobUrl);
      source = audioCtx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioCtx, "pcm-worklet");
      source.connect(workletNode);

      let textoAcumulado = "";
      workletNode.port.onmessage = (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Antes de cerrar el socket, AssemblyAI manda el motivo real en un
          // mensaje aparte (type:"Error") — se ignoraba porque no tiene
          // "transcript", y por eso el cierre (código 3007 y similares)
          // quedaba sin explicación visible.
          if (msg.error || msg.type === "Error") {
            onTexto("⚠️ Vista previa en vivo: " + (msg.error || msg.message || JSON.stringify(msg)));
            return;
          }
          if (!msg.transcript) return;
          if (msg.end_of_turn) {
            textoAcumulado += msg.transcript + " ";
            onTexto(textoAcumulado);
          } else {
            onTexto(textoAcumulado + msg.transcript);
          }
        } catch {}
      };
      // No afecta la grabación real, pero antes fallaba en silencio total —
      // ahora se avisa en el propio texto en vivo para poder diagnosticar
      // sin herramientas de desarrollador (el médico graba desde el celular).
      ws.onerror = () => {
        onTexto("⚠️ Vista previa en vivo no disponible (error de conexión). La grabación real no se ve afectada.");
      };
      ws.onclose = (ev) => {
        if (detenidoManualmente) return;
        if (ev.code !== 1000) {
          onTexto(`⚠️ Vista previa en vivo se cortó (código ${ev.code}${ev.reason ? ": " + ev.reason : ""}). La grabación real no se ve afectada.`);
        }
      };
    } catch (e) {
      onTexto("⚠️ Vista previa en vivo no disponible: " + e.message);
      console.warn("Transcripción en vivo no disponible:", e.message);
    }
  }

  function detener() {
    detenidoManualmente = true;
    if (workletNode) { try { workletNode.disconnect(); } catch {} }
    if (source) { try { source.disconnect(); } catch {} }
    if (audioCtx) { try { audioCtx.close(); } catch {} }
    // AssemblyAI factura la sesión hasta que se cierra: si solo se corta el
    // socket sin avisar, la da por viva y cobra hasta el tope de 3 horas.
    // Por eso primero se manda Terminate y recién después se cierra.
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {}
      try { ws.close(); } catch {}
    }
    ws = null; audioCtx = null; workletNode = null; source = null;
  }

  return { iniciar, detener };
}
