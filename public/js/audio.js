// Symphomed — grabación de audio: onda de voz en vivo, subida de consultas, y
// vista previa de transcripción en vivo (WebSocket a AssemblyAI). Lo usan
// tanto la grabación local (consultas.js) como el celular vinculado
// (vinculacion.js).

// Hace "latir" el logo de Symphomed (círculo con anillos alrededor) en
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

// ═══ EL CUIDADOR DE LA GRABACIÓN ═══════════════════════════════════════════
//
// Caso real: una consulta de 32 minutos que llegó con el audio de los
// primeros minutos y el resto en silencio. El archivo duraba 32 minutos —el
// grabador del navegador sigue contando— pero el micrófono había dejado de
// captar: en el celular, cuando la pantalla se apaga o el médico cambia de
// app, el sistema le corta el micrófono a la página. Nadie se enteró hasta
// ver la transcripción, cuando la consulta ya no se podía repetir.
//
// Esto hace tres cosas mientras se graba:
//   · pide que la pantalla NO se apague (Screen Wake Lock), y lo vuelve a
//     pedir cuando la página vuelve a estar a la vista;
//   · si igual la página se ocultó o el sistema silenció el micrófono, lo
//     cuenta y avisa AL VOLVER cuánto tiempo pudo no grabarse;
//   · si no entra sonido por un rato largo, avisa en ese momento (y vibra):
//     un micrófono tapado o un celular en el bolsillo se arreglan en el
//     momento, no después.
//
// onAviso(tipo, datos): "oculto" {segundos} · "silencio" {segundos} ·
// "cortado" {} · "normal" {} (volvió el sonido).
const SILENCIO_AVISO_SEGUNDOS = 90;

function crearGuardianGrabacion(stream, { onAviso = () => {} } = {}) {
  let wakeLock = null, activo = true;
  let ocultoDesde = null, ocultoMs = 0;
  let muteDesde = null, muteMs = 0;
  let silencioSeg = 0, silencioTotalSeg = 0, avisoSilencioDado = false;
  let audioCtx = null, analyser = null, datos = null, reloj = null;
  const pista = stream.getAudioTracks()[0];

  async function pedirPantalla() {
    if (!activo || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch { /* el navegador no lo permite: quedan los avisos */ }
  }

  function alCambiarVisibilidad() {
    if (!activo) return;
    if (document.visibilityState === "hidden") {
      ocultoDesde = Date.now();
    } else {
      if (ocultoDesde) {
        const seg = Math.round((Date.now() - ocultoDesde) / 1000);
        ocultoMs += Date.now() - ocultoDesde;
        ocultoDesde = null;
        // Unos segundos (mirar una notificación) no cortan nada que importe.
        if (seg >= 10) onAviso("oculto", { segundos: seg });
      }
      pedirPantalla();
    }
  }

  function alSilenciar() { if (activo && !muteDesde) muteDesde = Date.now(); }
  function alReactivar() {
    if (!muteDesde) return;
    muteMs += Date.now() - muteDesde;
    const seg = Math.round((Date.now() - muteDesde) / 1000);
    muteDesde = null;
    if (seg >= 10) onAviso("oculto", { segundos: seg });
  }
  function alTerminarPista() { if (activo) onAviso("cortado", {}); }

  // El nivel se mide cada segundo con su propio analizador (el del logo
  // anima con requestAnimationFrame, que el navegador frena en segundo plano).
  function medir() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(datos);
    let suma = 0;
    for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; suma += v * v; }
    const rms = Math.sqrt(suma / datos.length);
    if (rms < 0.01) {
      silencioSeg++;
      silencioTotalSeg++;
      if (silencioSeg >= SILENCIO_AVISO_SEGUNDOS && !avisoSilencioDado) {
        avisoSilencioDado = true;
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ }
        onAviso("silencio", { segundos: silencioSeg });
      }
    } else {
      if (avisoSilencioDado) onAviso("normal", {});
      silencioSeg = 0;
      avisoSilencioDado = false;
    }
  }

  document.addEventListener("visibilitychange", alCambiarVisibilidad);
  if (pista) {
    pista.addEventListener("mute", alSilenciar);
    pista.addEventListener("unmute", alReactivar);
    pista.addEventListener("ended", alTerminarPista);
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    datos = new Uint8Array(analyser.fftSize);
    reloj = setInterval(medir, 1000);
  } catch { /* sin medición de nivel: quedan los otros avisos */ }
  pedirPantalla();

  return {
    // Lo que pasó durante la grabación, para decirlo ANTES de subirla.
    resumen() {
      const ahora = Date.now();
      const oculto = ocultoMs + (ocultoDesde ? ahora - ocultoDesde : 0);
      const mute = muteMs + (muteDesde ? ahora - muteDesde : 0);
      return {
        segundosSinMicrofono: Math.round(Math.max(oculto, mute) / 1000),
        segundosEnSilencio: silencioTotalSeg,
      };
    },
    detener() {
      activo = false;
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      if (pista) {
        pista.removeEventListener("mute", alSilenciar);
        pista.removeEventListener("unmute", alReactivar);
        pista.removeEventListener("ended", alTerminarPista);
      }
      if (reloj) clearInterval(reloj);
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = null; analyser = null;
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
    },
  };
}

// Sube el audio grabado/subido y crea la consulta. Se usa tanto grabando
// local como desde el celular vinculado como micrófono remoto.
// teleconsultaId, cuando viene, dice dos cosas: que esta consulta salió de
// una videollamada (y por lo tanto el audio tiene al médico y al paciente en
// canales separados), y a cuál engancharla.
async function subirConsulta(pacienteId, blob, mimeType, { teleconsultaId } = {}) {
  let url = "/medico/consultas?pacienteId=" + encodeURIComponent(pacienteId);
  if (teleconsultaId) url += "&teleconsultaId=" + encodeURIComponent(teleconsultaId);
  return api(url, {
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
      const { token, keyterms, idioma, medicalMode } = await api("/medico/transcripcion-token");
      // Mismo criterio que la transcripción final (services/assemblyai.js):
      // Medical Mode + vocabulario de la especialidad, para que lo que se ve
      // mientras se habla se parezca a lo que después queda guardado.
      // Los parámetros de lista (language_codes, keyterms_prompt) van como
      // array JSON codificado en la URL — probado contra la API: mandarlos
      // como parámetros repetidos devuelve "Invalid JSON array".
      //
      // El idioma lo manda el servidor, sacado de la cuenta del médico, y no
      // se toma de MEDICO_IDIOMA: si el navegador lo eligiera por su cuenta,
      // la vista previa y la transcripción final podrían quedar en idiomas
      // distintos para la misma consulta. Si el servidor no lo mandara —una
      // versión vieja—, español, que es como estaba antes.
      const lang = idioma || "es";
      const params = new URLSearchParams({
        sample_rate: "16000",
        encoding: "pcm_s16le",
        speech_model: "universal-3-5-pro",
        mode: "balanced",
        language_codes: JSON.stringify([lang]),
        token,
      });
      // Medical Mode no existe para portugués: la API ignora el parámetro.
      // Quién lo tiene y quién no lo decide el servidor y viaja en la
      // respuesta — tener acá una copia de la lista de idiomas es tener dos
      // fuentes de verdad que algún día no van a coincidir.
      if (medicalMode) params.set("domain", "medical-v1");
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
