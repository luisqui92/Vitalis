// Vitalis — Vincular este celular como micrófono remoto (ver también
// consultas.js: pintarControlRemoto, que vive del lado de la compu).

async function renderVincular() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const data = await api("/medico/vinculacion");
    pintarVincular(data.vinculacion);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando la vinculación")}</div>`;
  }
}

function pintarVincular(v) {
  if (!v.vinculado) {
    app.innerHTML = `
      <button class="back" id="btnBack">← Volver</button>
      <div class="card">
        <div class="hint" style="margin-bottom:14px">Escribí el código de 6 dígitos que aparece en la compu:</div>
        <input id="vCodigo" type="tel" maxlength="6" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:6px">
        <div id="vErr"></div>
        <button class="primary" id="vBtn">Vincular</button>
      </div>`;
    document.getElementById("btnBack").onclick = renderDashboard;
    document.getElementById("vBtn").onclick = async () => {
      const codigo = document.getElementById("vCodigo").value.trim();
      const errBox = document.getElementById("vErr");
      errBox.innerHTML = "";
      try {
        const data = await api("/medico/vinculacion/vincular", {
          method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ codigo }),
        });
        pintarVincular(data.vinculacion);
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo vincular")}</div>`;
      }
    };
    return;
  }

  // Ya vinculado: queda "armado" mirando si la compu mandó una orden.
  app.innerHTML = `
    <button class="back" id="btnBack">← Volver</button>
    <div class="card" id="vCard">
      <div class="hint">📱 Celular vinculado. Dejalo con la pantalla prendida al lado de la compu.</div>
      <div class="hint" style="margin-top:10px" id="vEstado">🟢 Esperando la orden de grabar...</div>
    </div>`;

  let mediaRecorder = null, chunks = [], mimeType = "audio/webm", stream = null;

  // "← Volver" vive afuera de #vCard (nunca se reescribe al arrancar una
  // grabación), así que sin este chequeo se podía salir de esta pantalla
  // con el micrófono todavía grabando: el poll que detiene todo
  // (ciclo() más abajo) se corta con detenerPolling(), pero nadie más
  // llama a mediaRecorder.stop() — el micrófono queda prendido y lo que se
  // grabó hasta ahí se pierde (nunca se sube). Si hay una grabación en
  // curso, primero se detiene por la misma vía seria de siempre (la que ya
  // usa "Detener acá mismo": sube lo grabado y libera el micrófono) en vez
  // de navegar directo.
  document.getElementById("btnBack").onclick = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      if (!confirm('Hay una grabación en curso. Hay que detenerla antes de salir (se sube la consulta grabada hasta ahora). ¿Detener y volver?')) return;
      mediaRecorder.stop();
      return;
    }
    renderDashboard();
  };
  let pacienteActual = null;

  async function arrancarGrabacionRemota(pacienteId, pacienteNombre) {
    pacienteActual = { pacienteId, pacienteNombre };
    document.getElementById("vCard").innerHTML = `
      <div class="listen-panel" style="display:block">
        <div class="listen-orb" id="audioOrbRemoto">
          <div class="listen-ring"></div>
          <div class="listen-ring listen-ring-2"></div>
          <img src="/logo.png" alt="" class="listen-logo">
        </div>
        <div class="listen-time" id="recTimeRemoto">00:00</div>
        <div class="listen-label">🎙️ Grabando: ${esc(pacienteNombre)}</div>
      </div>
      <div class="hint" style="text-align:center">Esperando que la compu diga "detener"...</div>
      <button class="secondary" id="btnDetenerLocal">⏹️ Detener acá mismo</button>`;
    const visual = crearIndicadorAudio(document.getElementById("audioOrbRemoto"));
    const recTime = document.getElementById("recTimeRemoto");

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    mimeType = tipos.find(t => MediaRecorder.isTypeSupported(t)) || "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    let seconds = 0;
    const timerId = setInterval(() => { seconds++; recTime.textContent = fmt(seconds); }, 1000);
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      clearInterval(timerId);
      visual.detener();
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      document.getElementById("vCard").innerHTML = `<div class="hint">⏳ Subiendo la grabación...</div>`;
      try {
        const data = await subirConsulta(pacienteActual.pacienteId, blob, mimeType);
        await api("/medico/vinculacion/estado", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ estado: "armado", consultaId: data.consulta._id }),
        });
      } catch (e) {
        await api("/medico/vinculacion/estado", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ estado: "armado" }),
        }).catch(() => {});
      }
      pintarVincular({ vinculado: true, estado: "armado" });
    };
    mediaRecorder.start();
    visual.iniciar(stream);
    document.getElementById("btnDetenerLocal").onclick = () => mediaRecorder.stop();

    await api("/medico/vinculacion/estado", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ estado: "grabando" }),
    }).catch(() => {});
  }

  (async function ciclo() {
    try {
      const data = await api("/medico/vinculacion");
      const vv = data.vinculacion;
      if (!vv.vinculado) return renderVincular(); // se desvinculó (cambió el día)

      if (vv.comandoPendiente?.accion === "iniciar" && (!mediaRecorder || mediaRecorder.state === "inactive")) {
        await arrancarGrabacionRemota(vv.comandoPendiente.pacienteId, vv.comandoPendiente.pacienteNombre);
      } else if (vv.comandoPendiente?.accion === "detener" && mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    } catch (e) {
      if (e.status === 401) return logout();
    }
    pollTimeout = setTimeout(ciclo, 1500);
  })();
}
