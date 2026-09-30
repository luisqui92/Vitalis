// Symphomed — Vincular este celular como micrófono remoto (ver también
// consultas.js: pintarControlRemoto, que vive del lado de la compu).

async function renderVincular() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("vincular.cargando")}</div>`;
  try {
    const data = await api("/medico/vinculacion");
    pintarVincular(data.vinculacion);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("vincular.error"))}</div>`;
  }
}

function pintarVincular(v) {
  if (!v.vinculado) {
    app.innerHTML = `
      <button class="back" id="btnBack">${t("vincular.volver")}</button>
      <div class="card">
        <div class="hint" style="margin-bottom:14px">${t("vincular.pedirCodigo")}</div>
        <input id="vCodigo" type="tel" maxlength="6" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:6px">
        <div id="vErr"></div>
        <button class="primary" id="vBtn">${t("vincular.boton")}</button>
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
        errBox.innerHTML = `<div class="error">${esc(e.error || t("vincular.errVincular"))}</div>`;
      }
    };
    return;
  }

  // Ya vinculado: queda "armado" mirando si la compu mandó una orden.
  app.innerHTML = `
    <button class="back" id="btnBack">${t("vincular.volver")}</button>
    <div class="card" id="vCard">
      <div class="hint">${t("vincular.listo")}</div>
      <div class="hint" style="margin-top:10px" id="vEstado">${t("vincular.esperando")}</div>
      <div id="grabPendientesRemoto"></div>
    </div>`;
  // Una grabación de este celular que quedó sin subir (la página se cerró a
  // mitad): se ofrece subirla. Ver respaldoGrabacion en audio.js.
  ofrecerGrabacionesPendientes(document.getElementById("grabPendientesRemoto"), {
    onSubir: async (b, mime, g) => { await subirConsulta(g.pacienteId, b, mime); },
  });

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
      if (!confirm(t("vincular.confirmarSalir"))) return;
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
          <img src="/img/simbolo.webp" alt="" class="listen-logo">
        </div>
        <div class="listen-time" id="recTimeRemoto">00:00</div>
        <div class="listen-label">${t("vincular.grabando", { paciente: esc(pacienteNombre) })}</div>
      </div>
      <div class="hint" style="text-align:center">${t("vincular.esperandoDetener")}</div>
      <div class="hint" style="text-align:center">📱 ${t("consulta.pantallaEncendida")}</div>
      <div id="recAvisoRemoto"></div>
      <button class="secondary" id="btnDetenerLocal">${t("vincular.detenerAca")}</button>`;
    const visual = crearIndicadorAudio(document.getElementById("audioOrbRemoto"));
    const recTime = document.getElementById("recTimeRemoto");

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    mimeType = tipos.find(t => MediaRecorder.isTypeSupported(t)) || "";
    mediaRecorder = crearGrabadora(stream, mimeType);
    chunks = [];
    const respaldoId = await respaldoGrabacion.iniciar({ pacienteId, pacienteNombre, mimeType: mimeType || "audio/webm" });
    // Este es el caso MÁS expuesto a que la pantalla se apague: el celular
    // queda apoyado en el escritorio mientras el médico usa la compu. El
    // cuidador (audio.js) pide que no se apague y avisa si igual pasó.
    // El reloj es el tiempo real, no la cuenta de tics que el celular frena.
    const inicio = Date.now();
    const timerId = setInterval(() => { recTime.textContent = fmt(Math.round((Date.now() - inicio) / 1000)); }, 1000);
    const avisoRemoto = document.getElementById("recAvisoRemoto");
    const guardian = crearGuardianGrabacion(stream, { onAviso: (tipo, datos) => {
      if (tipo === "normal") { avisoRemoto.innerHTML = ""; return; }
      const texto = textoAvisoGrabacion(tipo, datos);
      avisoRemoto.innerHTML = `<div class="error">⚠️ ${texto}</div>`;
    } });
    mediaRecorder.ondataavailable = e => {
      chunks.push(e.data);
      respaldoGrabacion.agregar(respaldoId, e.data);
    };
    mediaRecorder.onstop = async () => {
      clearInterval(timerId);
      guardian.detener();
      visual.detener();
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      document.getElementById("vCard").innerHTML = `<div class="hint">${t("vincular.subiendo")}</div>`;
      try {
        const data = await subirConsulta(pacienteActual.pacienteId, blob, mimeType);
        respaldoGrabacion.borrar(respaldoId);
        liberarGrabacion();
        await api("/medico/vinculacion/estado", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ estado: "armado", consultaId: data.consulta._id }),
        });
      } catch (e) {
        // No se subió: queda en el respaldo del teléfono y se ofrece subirla
        // en esta misma pantalla.
        liberarGrabacion();
        await api("/medico/vinculacion/estado", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ estado: "armado" }),
        }).catch(() => {});
      }
      pintarVincular({ vinculado: true, estado: "armado" });
    };
    mediaRecorder.start(5000);
    // Salir por cualquier lado detiene y sube lo grabado (la misma vía que
    // «Detener acá mismo»).
    marcarGrabacionEnCurso(() => { try { if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch { /* ya estaba */ } });
    pedirPermisoAvisoGrabacion();
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
