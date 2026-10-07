// Symphomed — Nueva consulta (local o control remoto) y el detalle de una
// consulta (transcripción + nota clínica).

// Íconos del botón de grabar (SVG en vez de emoji: se ve nítido y
// consistente en cualquier celular, y toma el color por currentColor).
const ICONO_MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICONO_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>`;

// ─── EL HILO CON LAS CONSULTAS ANTERIORES ─────────────────────────────────
//
// Va ARRIBA de la nota de hoy, no debajo: es lo que conviene leer antes de
// quedarse con el diagnóstico, no un apéndice que se mira si sobra tiempo.
//
// Si no hay conexiones no dibuja NADA — ni un título, ni un "sin hallazgos".
// Un cartel que aparece siempre se deja de leer, y el día que dice algo
// tampoco se lee (ver el encabezado de services/hiloClinico.js).
function hiloClinicoHtml(c) {
  const h = c?.hiloClinico;
  if (!h?.conexiones?.length) return "";
  return `
    <div class="card card-secundaria" style="border-color:var(--warning)">
      <div class="nota-titulo" style="margin-top:0">${t("hilo.titulo")}</div>
      <div class="hint" style="margin:0 0 10px">${t("hilo.ayuda")}</div>
      ${h.conexiones.map(x => `
        <div class="nota-campo" style="margin-bottom:10px">
          <div>${esc(x.queDijoEntonces)}</div>
          <div class="hint" style="margin:2px 0 0">${esc(x.porQueImporta)}</div>
          <button class="link" data-hilo="${esc(String(x.consultaId))}" style="width:auto;margin:2px 0 0">${t("hilo.verConsulta")}</button>
        </div>`).join("")}
      ${(h.preguntas || []).length ? `
        <div class="nota-campo"><b>${t("hilo.preguntas")}</b>
          <ul style="margin:4px 0 0;padding-left:18px">
            ${h.preguntas.map(p => `<li>${esc(p)}</li>`).join("")}
          </ul>
        </div>` : ""}
    </div>`;
}

// Abrir la consulta citada. Es lo que hace que el hilo sea verificable en vez
// de una afirmación: el médico puede ir a leer qué decía de verdad.
function engancharHiloClinico() {
  document.querySelectorAll("[data-hilo]").forEach(b => {
    b.onclick = () => renderDetalle(b.dataset.hilo);
  });
}

// ─── NUEVA CONSULTA (grabar con el logo de Symphomed latiendo, o subir archivo) ──
function renderNuevaConsulta(pacienteId, pacienteNombre) {
  detenerPolling();
  app.innerHTML = `
    <button class="back" id="btnBack">${t("consulta.volver")}</button>
    <div class="card">
      <div class="hint" style="margin-bottom:14px">${t("consulta.paciente")} <b>${esc(pacienteNombre)}</b></div>
      <div id="grabPendientes"></div>

      <div class="listen-panel" id="listenPanel">
        <div class="listen-orb" id="audioOrb">
          <div class="listen-ring"></div>
          <div class="listen-ring listen-ring-2"></div>
          <img src="/img/simbolo.webp" alt="" class="listen-logo">
        </div>
        <div class="listen-time" id="recTime">00:00</div>
        <div class="listen-label">${t("consulta.escuchando")}</div>
        <div class="live-caption" id="liveCaption"></div>
        <div id="recAviso"></div>
      </div>
      <div class="nota-vivo" id="notaVivo" style="display:none"></div>

      <div class="rec-box">
        <button class="rec-btn" id="recBtn">${ICONO_MIC}</button>
        <div class="rec-status" id="recStatus">${t("consulta.tocarGrabar")}</div>
      </div>
      <div class="hint" style="text-align:center;margin-top:6px">📱 ${t("consulta.pantallaEncendida")}</div>
      <label class="file-label" for="ncFile">${t("consulta.subirArchivo")}</label>
      <input type="file" id="ncFile" accept="audio/*" style="display:none">
      <div id="ncErr"></div>
      <button class="primary" id="ncSubir" style="display:none">${t("consulta.subirTranscribir")}</button>
      <button class="link" id="btnRemota">${t("consulta.linkRemota")}</button>
    </div>`;
  document.getElementById("btnBack").onclick = () => renderPacienteDetalle(pacienteId, "consultas");
  document.getElementById("btnRemota").onclick = () => {
    if (!confirmarSalidaDeGrabacion()) return;
    renderNuevaConsultaRemota(pacienteId, pacienteNombre);
  };

  let mediaRecorder = null, chunks = [], blob = null, mimeType = "audio/webm";
  let seconds = 0, timerId = null, inicioGrabacion = 0;
  const recBtn = document.getElementById("recBtn");
  const recTime = document.getElementById("recTime");
  const recStatus = document.getElementById("recStatus");
  const ncSubir = document.getElementById("ncSubir");
  const ncErr = document.getElementById("ncErr");
  const listenPanel = document.getElementById("listenPanel");
  const liveCaption = document.getElementById("liveCaption");
  const onda = crearIndicadorAudio(document.getElementById("audioOrb"));
  const transcriptorVivo = crearTranscriptorEnVivo(texto => { liveCaption.textContent = texto; });
  const notaVivo = crearNotaEnVivo(pacienteId, document.getElementById("notaVivo"), transcriptorVivo);
  const recAviso = document.getElementById("recAviso");
  let guardian = null;
  // Id del respaldo en el teléfono de ESTA toma (ver respaldoGrabacion en
  // audio.js). Se borra al subirla.
  let respaldoId = null;
  // Si el médico sale de la pantalla a mitad de la grabación y lo confirma,
  // se detiene sin pintar nada (la pantalla ya no está).
  let salioDeLaPantalla = false;

  // Cuenta de estudiante sin acceso (vencida o sin horas del mes): se dice
  // ANTES de grabar, que es cuando todavía se puede hacer algo
  // (public/js/estudiantes.js). El servidor frena igual si llegara.
  if (typeof esCuentaEstudiante === "function" && esCuentaEstudiante()) {
    estadoEstudiante().then((e) => {
      if (!e?.bloqueado || !document.body.contains(recBtn)) return;
      recBtn.disabled = true;
      recStatus.innerHTML = `<div class="error" style="margin-top:0">⚠️ ${esc(e.motivo)}</div>`;
    });
  }

  // Una grabación que quedó sin subir (la página se cerró, se salió a mitad):
  // se ofrece subirla antes de grabar otra.
  ofrecerGrabacionesPendientes(document.getElementById("grabPendientes"), {
    pacienteId,
    onSubir: async (b, mime) => {
      const data = await subirConsulta(pacienteId, b, mime);
      renderDetalle(data.consulta._id);
    },
  });
  const minutosDe = (seg) => Math.max(1, Math.round(seg / 60));
  const mostrarAviso = (tipo, datos) => {
    if (tipo === "normal") { recAviso.innerHTML = ""; return; }
    const texto = textoAvisoGrabacion(tipo, datos);
    recAviso.innerHTML = `<div class="error">⚠️ ${texto}</div>`;
  };

  recBtn.onclick = async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
        mimeType = tipos.find(t => MediaRecorder.isTypeSupported(t)) || "";
        mediaRecorder = crearGrabadora(stream, mimeType);
        chunks = [];
        // Una toma nueva reemplaza a la anterior que no se subió: grabar de
        // nuevo es decidir que esa no va.
        if (respaldoId) respaldoGrabacion.borrar(respaldoId);
        respaldoId = await respaldoGrabacion.iniciar({ pacienteId, pacienteNombre, mimeType: mimeType || "audio/webm" });
        const idDeEstaToma = respaldoId;
        mediaRecorder.ondataavailable = e => {
          chunks.push(e.data);
          respaldoGrabacion.agregar(idDeEstaToma, e.data);
        };
        mediaRecorder.onstop = () => {
          blob = new Blob(chunks, { type: mimeType || "audio/webm" });
          if (salioDeLaPantalla) {
            // Salió confirmando: queda en el respaldo del teléfono, para
            // subirla desde la consulta del paciente.
            if (guardian) guardian.detener();
            guardian = null;
            stream.getTracks().forEach(t => t.stop());
            onda.detener();
            transcriptorVivo.detener();
            notaVivo.detener();
            return;
          }
          // Se lee ANTES de detener el cuidador: dice cuánto de la grabación
          // pudo quedar sin sonido, y eso se muestra antes de subirla.
          const r = guardian ? guardian.resumen() : null;
          if (guardian) guardian.detener();
          guardian = null;
          stream.getTracks().forEach(t => t.stop());
          onda.detener();
          transcriptorVivo.detener();
          notaVivo.terminar(seconds);
          listenPanel.style.display = "none";
          recStatus.textContent = t("consulta.grabacionLista", { tiempo: fmt(seconds) });
          const sinMicro = r ? r.segundosSinMicrofono : 0;
          const enSilencio = r ? r.segundosEnSilencio : 0;
          if (sinMicro >= 60 || (seconds >= 120 && enSilencio / seconds >= 0.5)) {
            ncErr.innerHTML = `<div class="error">⚠️ ${sinMicro >= 60
              ? t("consulta.resumenSinMicrofono", { min: minutosDe(sinMicro), total: fmt(seconds) })
              : t("consulta.resumenSilencio", { min: minutosDe(enSilencio), total: fmt(seconds) })}</div>`;
          }
          ncSubir.style.display = "block";
        };
        // De a pedazos de 5 s: cada uno va al respaldo del teléfono apenas
        // llega, así un cierre inesperado no se lleva la grabación entera.
        mediaRecorder.start(5000);
        guardian = crearGuardianGrabacion(stream, { onAviso: mostrarAviso });
        marcarGrabacionEnCurso(() => {
          salioDeLaPantalla = true;
          clearInterval(timerId);
          try { if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch { /* ya estaba */ }
        });
        pedirPermisoAvisoGrabacion();
        recAviso.innerHTML = ""; ncErr.innerHTML = "";
        seconds = 0; recTime.textContent = "00:00"; liveCaption.textContent = "";
        listenPanel.style.display = "block";
        onda.iniciar(stream);
        transcriptorVivo.iniciar(stream);
        notaVivo.iniciar();
        // El tiempo es el REAL transcurrido, no la cuenta de "tics": con la
        // pantalla apagada el celular frena los temporizadores, y el reloj
        // decía 1:36 cuando habían pasado cinco minutos.
        inicioGrabacion = Date.now();
        timerId = setInterval(() => { seconds = Math.round((Date.now() - inicioGrabacion) / 1000); recTime.textContent = fmt(seconds); }, 1000);
        recBtn.classList.add("recording");
        recBtn.innerHTML = ICONO_STOP;
        recStatus.textContent = t("consulta.grabando");
        ncSubir.style.display = "none";
      } catch (e) {
        ncErr.innerHTML = `<div class="error">${t("consulta.errMicrofono", { mensaje: esc(e.message) })}</div>`;
      }
    } else {
      seconds = Math.round((Date.now() - inicioGrabacion) / 1000);
      mediaRecorder.stop();
      clearInterval(timerId);
      recBtn.classList.remove("recording");
      recBtn.innerHTML = ICONO_MIC;
    }
  };

  document.getElementById("ncFile").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    blob = f; mimeType = f.type || "audio/mpeg";
    // Un archivo subido no tiene texto en vivo: la nota sale del audio.
    notaVivo.descartar();
    recStatus.textContent = t("consulta.archivoListo", { nombre: f.name });
    ncSubir.style.display = "block";
  };

  ncSubir.onclick = async () => {
    if (!blob) return;
    ncErr.innerHTML = "";
    ncSubir.disabled = true;
    ncSubir.textContent = t("consulta.subiendo");
    try {
      const data = await subirConsulta(pacienteId, blob, mimeType);
      // Si el texto en vivo llegó entero, la nota sale de ahí y no hay que
      // esperar a la transcripción completa. Si esto falla, no pasa nada:
      // la nota sale del audio, como antes.
      await notaVivo.entregar(data.consulta._id);
      // Subida: ya no hay nada que proteger ni que respaldar.
      respaldoGrabacion.borrar(respaldoId);
      respaldoId = null;
      liberarGrabacion();
      renderDetalle(data.consulta._id);
    } catch (e) {
      // no se pierde la grabación: se puede reintentar sin volver a grabar
      ncSubir.disabled = false;
      ncSubir.textContent = t("consulta.reintentar");
      ncErr.innerHTML = `<div class="error">${esc(e.error || t("consulta.errSubir"))}</div>`;
    }
  };
}

// ─── LA NOTA EN VIVO, MIENTRAS SE GRABA (ver services/notaEnVivo.js) ────
//
// Cada tanto, el texto de la vista previa va al servidor y vuelve como nota.
// Un pedido por vez: si la IA todavía no contestó el anterior, se espera al
// siguiente turno con el texto más nuevo, en vez de encolar versiones viejas.
const NOTA_VIVO_CADA_MS = 45000;

function crearNotaEnVivo(pacienteId, caja, transcriptor) {
  let timer = null, enCurso = null, ultimoTexto = "", nota = null, noNombrados = [];
  let completo = false, textoFinal = "", terminando = null;
  const palabras = (txt) => String(txt || "").split(/\s+/).filter(Boolean).length;

  function pintar(estado) {
    if (!nota && estado !== "corte") {
      caja.style.display = "block";
      caja.innerHTML = `<div class="nota-titulo" style="margin-top:0">${t("vivo.titulo")}</div>
        <div class="hint">${t(estado === "pidiendo" ? "vivo.actualizando" : "vivo.esperando")}</div>`;
      return;
    }
    if (estado === "corte") {
      caja.style.display = "block";
      caja.innerHTML = `<div class="hint">${t("vivo.corte")}</div>`;
      return;
    }
    const n = nota;
    const campo = (clave, valor) => valor ? `<div class="nota-campo"><b>${t(clave)}</b> ${esc(valor)}</div>` : "";
    // Lo que la IA puso y nadie nombró se marca ya, mientras se graba.
    const meds = (n.medicamentosRecetados || []).map((m, i) => [m?.nombre, m?.dosis, m?.frecuencia].filter(Boolean).join(" ")
      + (noNombrados.includes(i) ? " " + t("vivo.noNombrado") : "")).join("; ");
    caja.style.display = "block";
    caja.innerHTML = `
      <div class="nota-titulo" style="margin-top:0">${t("vivo.titulo")}</div>
      <div class="hint" style="margin-bottom:8px">${t(estado === "final" ? "vivo.final" : estado === "pidiendo" ? "vivo.actualizando" : "vivo.ayuda")}</div>
      ${campo("nota.motivo", n.motivoConsulta)}
      ${campo("nota.sintomas", (n.sintomas || []).join(", "))}
      ${campo("nota.antecedentes", n.antecedentesRelevantes)}
      ${campo("nota.diagnostico", n.diagnostico)}
      ${campo("nota.diferenciales", (n.diagnosticosDiferenciales || []).join(", "))}
      ${campo("nota.plan", n.plan)}
      ${campo("nota.medicamentos", meds)}
      ${campo("nota.examenes", (n.examenesSolicitados || []).join(", "))}`;
  }

  function pedir(texto, estadoAlTerminar) {
    ultimoTexto = texto;
    pintar("pidiendo");
    enCurso = api("/medico/consultas/nota-en-vivo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pacienteId, texto }),
    })
      .then(r => { if (r?.nota) { nota = r.nota; noNombrados = Array.isArray(r.noNombrados) ? r.noNombrados : []; } })
      .catch(() => { /* un borrador que no salió no frena nada */ })
      .finally(() => { enCurso = null; pintar(estadoAlTerminar); });
    return enCurso;
  }

  function turno() {
    if (enCurso) return;
    const { texto } = transcriptor.resultado();
    if (palabras(texto) < 15 || texto === ultimoTexto) return;
    pedir(texto, "vivo");
  }

  async function terminarAhora(segundosGrabados) {
    clearInterval(timer); timer = null;
    const r = transcriptor.resultado();
    completo = textoEnVivoCompleto(r, segundosGrabados) && palabras(r.texto) >= 15;
    textoFinal = completo ? r.texto : "";
    if (!completo) {
      if (palabras(r.texto) >= 15) pintar("corte"); else caja.style.display = "none";
      return;
    }
    if (enCurso) await enCurso;
    if (r.texto !== ultimoTexto) pedir(r.texto, "final"); else pintar("final");
  }

  return {
    iniciar() {
      clearInterval(timer);
      nota = null; noNombrados = []; ultimoTexto = ""; completo = false; textoFinal = ""; enCurso = null;
      pintar("esperando");
      timer = setInterval(turno, NOTA_VIVO_CADA_MS);
    },
    detener() { clearInterval(timer); timer = null; },
    descartar() { clearInterval(timer); timer = null; completo = false; textoFinal = ""; caja.style.display = "none"; },
    // Al tocar «Terminar»: si el texto llegó entero, un último borrador con
    // todo, para que el médico vea la nota antes de subir. El servidor lo
    // guarda y lo reusa al subir: no se le pide dos veces lo mismo a la IA.
    terminar(segundosGrabados) {
      terminando = terminarAhora(segundosGrabados);
      return terminando;
    },
    // Ya subida la grabación: el texto entero va con ella, y la nota sale
    // de ahí. Se espera el último borrador para que el servidor lo reuse.
    async entregar(consultaId) {
      if (!completo || !textoFinal) return;
      try {
        if (terminando) await terminando;
        if (enCurso) await enCurso;
        await api(`/medico/consultas/${consultaId}/texto-en-vivo`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto: textoFinal }),
        });
      } catch { /* la nota sale de la transcripción completa */ }
      completo = false; textoFinal = "";
    },
  };
}

// ─── NUEVA CONSULTA — CONTROL REMOTO (desde la compu, graba el celular) ─
// Requiere que el médico ya haya vinculado su celular hoy (ver vinculacion.js).
async function renderNuevaConsultaRemota(pacienteId, pacienteNombre) {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("consulta.cargando")}</div>`;
  try {
    const data = await api("/medico/vinculacion");
    pintarControlRemoto(data.vinculacion, pacienteId, pacienteNombre);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("consulta.errVinculacion"))}</div>`;
  }
}

function pintarControlRemoto(v, pacienteId, pacienteNombre) {
  let cuerpo = "";
  if (!v.vinculado) {
    cuerpo = `
      <div class="hint" style="margin-bottom:14px">${t("consulta.remota.sinVincular")}</div>
      <div style="text-align:center;font-size:38px;font-weight:700;letter-spacing:4px;color:var(--primary);padding:18px 0">${esc(v.codigo)}</div>
      <div class="hint">${t("consulta.remota.esperando")}</div>`;
  } else if (v.estado === "armado") {
    cuerpo = `
      <div class="hint" style="margin-bottom:14px">${t("consulta.remota.listo")}</div>
      <button class="primary" id="btnIniciarRemoto" style="margin-top:0">${t("consulta.remota.iniciar")}</button>`;
  } else if (v.estado === "grabando") {
    cuerpo = `
      <div class="listen-panel" style="display:block">
        <div class="listen-label" style="margin-bottom:6px">${t("consulta.remota.grabando")}</div>
      </div>
      <button class="primary" id="btnDetenerRemoto" style="margin-top:0;background:var(--danger)">${t("consulta.remota.detener")}</button>`;
  }

  app.innerHTML = `
    <button class="back" id="btnBack">${t("consulta.volver")}</button>
    <div class="card">
      <div class="hint" style="margin-bottom:14px">${t("consulta.paciente")} <b>${esc(pacienteNombre)}</b></div>
      ${cuerpo}
      <div id="ncrErr"></div>
    </div>`;
  document.getElementById("btnBack").onclick = () => renderPacienteDetalle(pacienteId, "consultas");

  const btnIniciar = document.getElementById("btnIniciarRemoto");
  if (btnIniciar) btnIniciar.onclick = async () => {
    try {
      await api("/medico/vinculacion/comando", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ accion: "iniciar", pacienteId, pacienteNombre }),
      });
      pollTimeout = setTimeout(() => renderNuevaConsultaRemota(pacienteId, pacienteNombre), 1500);
    } catch (e) {
      document.getElementById("ncrErr").innerHTML = `<div class="error">${esc(e.error || t("consulta.remota.errOrden"))}</div>`;
    }
  };

  const btnDetener = document.getElementById("btnDetenerRemoto");
  if (btnDetener) btnDetener.onclick = async () => {
    try {
      await api("/medico/vinculacion/comando", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ accion: "detener" }),
      });
    } catch (e) { /* seguimos igual esperando a que el celular reporte */ }
  };

  // Auto-refresco: si todavía no está vinculado, o está grabando (esperando
  // que el celular suba y reporte el resultado), seguimos consultando solos.
  if (!v.vinculado || v.estado === "grabando") {
    pollTimeout = setTimeout(async () => {
      try {
        const data = await api("/medico/vinculacion");
        if (data.vinculacion.estado === "armado" && data.vinculacion.consultaId) {
          return renderDetalle(data.vinculacion.consultaId);
        }
        pintarControlRemoto(data.vinculacion, pacienteId, pacienteNombre);
      } catch (e) {
        if (e.status === 401) return logout();
      }
    }, v.vinculado ? 2000 : 3000);
  }
}

// ─── DETALLE DE CONSULTA: transcripción + nota clínica generada por IA ──
// Mientras la transcripción o la nota clínica siguen en camino, esta
// pantalla se refresca sola cada 8s hasta que ambas terminan.
// El aviso bajo un medicamento de la nota que no está en la lista oficial
// (routes/consultaMedica.js → verificacionMedicamentos). "ok" o sin dato:
// nada. La sugerencia es un botón: solo cambia si el médico la toca.
function avisoMedicamentoHtml(v) {
  if (!v) return "";
  // Un medicamento que nadie nombró en la consulta (la IA completó por su
  // cuenta: services/notaEnVivo.js → nombradoEnTexto). Va primero: es lo más
  // grave que puede tener una receta.
  const noNombrado = v.noNombrado ? `<div class="nf-med-desconocido med-aviso">${t("nota.med.noNombrado")}</div>` : "";
  if (v.estado === "ok" || !v.estado) return noNombrado;
  if (v.estado === "parecido" && v.sugerencia) {
    return noNombrado + `<button type="button" class="nf-med-sugerencia med-aviso" data-nombre="${esc(v.sugerencia)}">${t("nota.med.quisisteDecir", { nombre: esc(v.sugerencia) })}</button>`;
  }
  return noNombrado + `<div class="nf-med-desconocido med-aviso">${t("nota.med.desconocido")}</div>`;
}

// La nota llegó "completa" pero sin nada adentro: pasó con una consulta en
// portugués cuyo JSON vino con las claves cambiadas (ver
// services/notaClinica.js). Mismo criterio que notaVacia() del servidor.
function notaClinicaVaciaCliente(n) {
  const lleno = (v) => (Array.isArray(v) ? v.some(x => x && (typeof x !== "string" || x.trim())) : typeof v === "string" && v.trim().length > 0);
  return !["motivoConsulta", "sintomas", "antecedentesRelevantes", "diagnostico", "plan", "medicamentosRecetados", "examenesSolicitados"]
    .some(c => lleno(n?.[c]));
}

function botonRegenerarNotaHtml() {
  return `<button class="secondary" id="btnRegenerarNota">🔄 ${t("nota.regenerar")}</button>
    <div class="hint">${t("nota.regenerarAyuda")}</div>`;
}

// "quien" solo viene de la teleconsulta, donde el médico y el paciente se
// grabaron en canales separados y no hay nada que adivinar. En la consulta
// presencial no está, y ahí sigue el "Hablante A / B" de la diarización —
// decir "Médico" sobre una adivinanza sería inventar una certeza que no
// tenemos.
function transcripcionHtml(segmentos) {
  return `<div class="seccion-titulo">${t("consulta.transcripcion")}</div>` + segmentos.map(s => `
    <div class="segmento h${s.quien ? (s.quien === "medico" ? 0 : 1) : (s.hablante && s.hablante.charCodeAt(0) % 2)}">
      <div class="quien">${s.quien
        ? t(s.quien === "medico" ? "consulta.quienMedico" : "consulta.quienPaciente")
        : t("consulta.hablante", { n: esc(s.hablante) })}</div>
      <div class="texto">${esc(s.texto)}</div>
    </div>`).join("");
}

// Las filas de medicamentos de la nota que tienen nombre, en orden: lo que
// se manda al confirmar.
function filasMedicamentos() {
  return [...document.querySelectorAll("#nfMeds .med-row")].filter(r => r.querySelector(".nf-med-nombre").value.trim());
}

// Las filas de la nota original con un medicamento que nadie nombró en la
// consulta: su casilla empieza DESMARCADA, para que llegar al Kardex sea una
// decisión del médico y no un tilde que no vio.
let filasNoNombradas = new Set();

// Una casilla «Cargar a Medicación» por fila, con lo que la fila dice ahora.
// Lo que el médico ya desmarcó queda desmarcado (por fila, no por posición).
function pintarChecksMedicacion() {
  const caja = document.getElementById("cfMeds");
  if (!caja) return;
  const antes = new Map([...caja.querySelectorAll(".cf-med")].map(x => [x.dataset.k, x.checked]));
  caja.innerHTML = filasMedicamentos().map(r => {
    const nombre = r.querySelector(".nf-med-nombre").value.trim();
    const dosis = r.querySelector(".nf-med-dosis").value.trim();
    const k = r.dataset.k;
    return `<div class="conf-fila">
      <label class="conf-check"><input type="checkbox" class="cf-med" data-k="${esc(k)}"${(antes.has(k) ? antes.get(k) : !filasNoNombradas.has(k)) ? " checked" : ""}>
        <span>${t("confirmar.medicacion", { item: esc(nombre + (dosis ? " " + dosis : "")) })}</span></label>
    </div>`;
  }).join("");
}

// ─── LA VERIFICACIÓN DE LA NOTA EN VIVO (services/notaEnVivo.js) ────────
//
// La nota se escribió con el texto en vivo; la transcripción completa la
// compara después. Lo que no coincide se MUESTRA con un botón: la nota no se
// cambia sola.
function verificacionHtml(v) {
  const estado = v?.estado || "";
  if (estado === "pendiente" || estado === "verificando") return `<div class="hint verif-aviso">${t("verif.pendiente")}</div>`;
  if (estado === "ok") return `<div class="hint verif-aviso" style="color:var(--success)">${t("verif.ok")}</div>`;
  if (estado === "error") return `<div class="error verif-aviso">${t("verif.error")}</div>`;
  if (estado !== "diferencias") return "";
  const faltan = (v.diferencias || []).map((d, k) => ({ d, k })).filter(x => x.d.tipo === "falta");
  return `<div class="error verif-aviso">${t("verif.diferencias", { n: (v.diferencias || []).length })}</div>
    ${faltan.map(({ d, k }) => `
      <div class="verif-falta" style="margin:6px 0">${t("verif.falta", { texto: esc(d.enAudio) })}
        <button type="button" class="link verif-agregar" data-k="${k}" style="width:auto;margin:0 0 0 6px">${t("verif.agregar")}</button>
      </div>`).join("")}`;
}

// Las marcas que van en la fila de cada medicamento, por su número de fila
// en la nota original (data-i).
function pintarVerificacionEnFilas(v) {
  document.querySelectorAll("#nfMeds .med-row .nf-med-verif").forEach(x => { x.innerHTML = ""; });
  (v?.diferencias || []).forEach((d, k) => {
    if (d.indice === null || d.indice === undefined) return;
    const caja = document.querySelector(`#nfMeds .med-row[data-i="${d.indice}"] .nf-med-verif`);
    if (!caja) return;
    caja.innerHTML = d.tipo === "dosis"
      ? `<div class="med-aviso nf-med-desconocido">${t("verif.dosis", { texto: esc(d.enAudio) })}
          <button type="button" class="link verif-usar" data-k="${k}" style="width:auto;margin:0 0 0 6px">${t("verif.usarAudio")}</button></div>`
      : `<div class="med-aviso nf-med-desconocido">${t("verif.noMencionado")}</div>`;
  });
}

let verificacionActual = null;

async function vigilarVerificacion(id) {
  detenerPolling();
  let c;
  try {
    c = (await api("/medico/consultas/" + id)).consulta;
  } catch (e) {
    if (e.status === 401) return logout();
    pollTimeout = setTimeout(() => vigilarVerificacion(id), 8000);
    return;
  }
  // Si el médico ya salió de esta pantalla, no hay nada que actualizar.
  const caja = document.getElementById("verifBox");
  const boton = document.getElementById("btnConfirmarConsulta");
  if (!caja || !boton) return;
  verificacionActual = c.verificacion;
  caja.innerHTML = verificacionHtml(c.verificacion);
  pintarVerificacionEnFilas(c.verificacion);
  const esperando = !c.confirmadaEn && ["pendiente", "verificando"].includes(c.verificacion?.estado);
  if (!esperando && boton.disabled && boton.textContent === t("verif.esperarConfirmar")) {
    boton.disabled = false;
    boton.textContent = t("confirmar.boton");
  }
  if (c.estado !== "procesando") {
    const cuerpo = document.getElementById("cuerpoTranscripcion");
    if (cuerpo && c.segmentos?.length) {
      cuerpo.innerHTML = transcripcionHtml(c.segmentos);
    } else if (cuerpo && c.estado === "error") {
      cuerpo.innerHTML = `<div class="error">⚠️ ${esc(c.error || t("consulta.errTranscribir"))}</div>`;
    }
  }
  if (c.estado === "procesando" || esperando) pollTimeout = setTimeout(() => vigilarVerificacion(id), 5000);
}

async function renderDetalle(id, esRefrescoAutomatico) {
  detenerPolling();
  if (!esRefrescoAutomatico) app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("consulta.cargando")}</div>`;
  try {
    const data = await api("/medico/consultas/" + id);
    const c = data.consulta;

    const yaConfirmada = !!c.confirmadaEn;
    const n = c.notaClinica;
    // La nota en vivo se muestra apenas está, aunque la transcripción
    // completa siga en camino: para eso existe (services/notaEnVivo.js).
    const enVivo = c.notaFuente === "vivo";
    const hayNota = (c.estado === "completado" || enVivo) && c.notaClinicaEstado === "completado" && n;
    const esperandoVerif = enVivo && !yaConfirmada && ["pendiente", "verificando"].includes(c.verificacion?.estado);

    // ── NOTA CLÍNICA ──
    // Antes de confirmar es un formulario: la IA se equivoca (nombres de
    // medicamentos, una pieza mal escuchada) y el médico tiene que poder
    // corregirlo antes de que eso quede en el Kardex. Después de confirmar
    // se muestra como texto, ya sin editar.
    let notaHtml = "";
    if (c.estado === "completado" || enVivo) {
      if (c.notaClinicaEstado === "pendiente") {
        notaHtml = `<div class="card"><div class="hint">${t("nota.generando")}</div></div>`;
      } else if (c.notaClinicaEstado === "error") {
        notaHtml = `<div class="card"><div class="error">${t("nota.error")}</div>${yaConfirmada ? "" : botonRegenerarNotaHtml()}</div>`;
      } else if (n && yaConfirmada) {
        const meds = (n.medicamentosRecetados || []).filter(Boolean).map(m =>
          esc(m.nombre + (m.dosis ? " " + m.dosis : "") + (m.frecuencia ? " — " + m.frecuencia : ""))
        ).join("; ");
        notaHtml = `
          <div class="card">
            <div class="nota-titulo">${t("nota.titulo")}${c.notaEditadaPorMedico ? t("nota.corregida") : ""}</div>
            ${c.deEstudiante && typeof marcaNotaEstudianteHtml === "function" ? marcaNotaEstudianteHtml() : ""}
            <div class="hint" style="color:var(--success);margin-bottom:10px">${t("nota.confirmada", { fecha: new Date(c.confirmadaEn).toLocaleString(localeActual()) })}</div>
            ${n.motivoConsulta ? `<div class="nota-campo"><b>${t("nota.motivo")}</b> ${esc(n.motivoConsulta)}</div>` : ""}
            ${(n.sintomas||[]).length ? `<div class="nota-campo"><b>${t("nota.sintomas")}</b> ${esc(n.sintomas.join(", "))}</div>` : ""}
            ${n.antecedentesRelevantes ? `<div class="nota-campo"><b>${t("nota.antecedentes")}</b> ${esc(n.antecedentesRelevantes)}</div>` : ""}
            ${n.diagnostico ? `<div class="nota-campo"><b>${t("nota.diagnostico")}</b> ${esc(n.diagnostico)}</div>` : ""}
            ${(n.diagnosticosDiferenciales||[]).length ? `<div class="nota-campo"><b>${t("nota.diferenciales")}</b> ${esc(n.diagnosticosDiferenciales.join(", "))}</div>` : ""}
            ${n.plan ? `<div class="nota-campo"><b>${t("nota.plan")}</b> ${esc(n.plan)}</div>` : ""}
            ${meds ? `<div class="nota-campo"><b>${t("nota.medicamentos")}</b> ${meds}</div>` : ""}
            ${(n.examenesSolicitados||[]).length ? `<div class="nota-campo"><b>${t("nota.examenes")}</b> ${esc(n.examenesSolicitados.join(", "))}</div>` : ""}
            ${n.proximoControl ? `<div class="nota-campo"><b>${t("nota.proximoControl")}</b> ${esc(n.proximoControl)}</div>` : ""}
          </div>`;
      } else if (n) {
        notaHtml = `
          <div class="card">
            <div class="nota-titulo">${t("nota.tituloIA")}</div>
            ${c.deEstudiante && typeof marcaNotaEstudianteHtml === "function" ? marcaNotaEstudianteHtml() : ""}
            ${enVivo ? `<div id="verifBox">${verificacionHtml(c.verificacion)}</div>` : ""}
            ${notaClinicaVaciaCliente(n) ? `<div class="error" style="margin-top:0">${t("nota.vacia")}</div>${botonRegenerarNotaHtml()}` : ""}
            <div class="hint" style="margin-bottom:12px">${t("nota.revisar")}</div>
            <label>${t("nota.campo.motivo")}</label>
            <input id="nfMotivo" type="text" value="${esc(n.motivoConsulta || "")}">
            <label>${t("nota.campo.sintomas")} <span class="hint">${t("nota.separadosComa")}</span></label>
            <input id="nfSintomas" type="text" value="${esc((n.sintomas || []).join(", "))}">
            <label>${t("nota.campo.antecedentes")}</label>
            <textarea id="nfAntecedentes" rows="2">${esc(n.antecedentesRelevantes || "")}</textarea>
            <label>${t("nota.campo.diagnostico")}</label>
            <input id="nfDiagnostico" type="text" value="${esc(n.diagnostico || "")}">
            <label>${t("nota.campo.diferenciales")} <span class="hint">${t("nota.separadosComa")}</span></label>
            <input id="nfDiferenciales" type="text" value="${esc((n.diagnosticosDiferenciales || []).join(", "))}">
            <label>${t("nota.campo.plan")}</label>
            <textarea id="nfPlan" rows="3">${esc(n.plan || "")}</textarea>
            <label>${t("nota.campo.medicamentos")}</label>
            <div id="nfMeds">
              ${(n.medicamentosRecetados || []).map((m, i) => [m || {}, i]).map(([m, i]) => `
                <div class="med-row" data-i="${i}" data-k="${i}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;align-items:center">
                  <input class="nf-med-nombre" type="text" placeholder="${t("nota.med.nombre")}" value="${esc(m.nombre || "")}" style="flex:2;margin:0">
                  <input class="nf-med-dosis" type="text" placeholder="${t("nota.med.dosis")}" value="${esc(m.dosis || "")}" style="flex:1;margin:0">
                  <input class="nf-med-frec" type="text" placeholder="${t("nota.med.frecuencia")}" value="${esc(m.frecuencia || "")}" style="flex:1;margin:0">
                  <button class="link nf-med-quitar" title="${t("nota.med.quitar")}" style="margin:0;width:auto">✕</button>
                  <div class="nf-med-aviso" style="flex-basis:100%">${avisoMedicamentoHtml(c.verificacionMedicamentos?.[i])}</div>
                  <div class="nf-med-verif" style="flex-basis:100%"></div>
                </div>`).join("")}
            </div>
            <button class="link" id="nfMedAgregar" style="margin:0 0 10px 0;width:auto">${t("nota.med.agregar")}</button>
            <label>${t("nota.campo.examenes")} <span class="hint">${t("nota.separadosComa")}</span></label>
            <input id="nfExamenes" type="text" value="${esc((n.examenesSolicitados || []).join(", "))}">
            <label>${t("nota.campo.proximoControl")}</label>
            <input id="nfProximoControl" type="text" value="${esc(n.proximoControl || "")}">
          </div>`;
      }
    }

    // ── QUÉ APLICAR AL CONFIRMAR ──
    // Todo junto y marcado por defecto: el médico desmarca lo que la IA
    // haya entendido mal y confirma una sola vez.
    let confirmarHtml = "";
    if (hayNota && !yaConfirmada) {
      const filas = [];

      // Una cuenta de estudiante no receta, no agenda reconsultas por WhatsApp
      // ni arma presupuestos: esas filas no se ofrecen (el servidor tampoco
      // las aplicaría — routes/consultaMedica.js, confirmar).
      const estudiante = typeof esCuentaEstudiante === "function" && esCuentaEstudiante();
      const reconsulta = n.reconsultaSugerida;
      if (!estudiante && reconsulta?.fechaHora && reconsulta.estado === "pendiente") {
        // datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local, no UTC.
        const f = new Date(reconsulta.fechaHora);
        const valorInput = new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        filas.push(`
          <div class="conf-fila">
            <label class="conf-check"><input type="checkbox" id="cfReconsulta" checked>
              <span>${t("confirmar.reconsulta")}</span></label>
            ${reconsulta.textoOriginal ? `<div class="hint">${t("confirmar.dijiste", { texto: esc(reconsulta.textoOriginal) })}</div>` : ""}
            <input id="cfReconsultaFecha" type="datetime-local" value="${valorInput}">
          </div>`);
      }

      // El parámetro se llama "trat" y no "t": dentro de este bloque "t" es
      // la función de traducción, y usarla de nombre de variable la taparía.
      (estudiante ? [] : (n.tratamientosSugeridos || [])).filter(trat => trat.estado === "pendiente").forEach(trat => {
        filas.push(`
          <div class="conf-fila" data-tratsug="${trat._id}">
            <label class="conf-check"><input type="checkbox" class="cf-trat" checked>
              <span>${t("confirmar.presupuesto")}</span></label>
            <div class="hint">${t("confirmar.dijiste", { texto: esc(trat.itemMencionado) })}</div>
            <input class="ts-nombre" type="text" value="${esc(trat.catalogoNombreSugerido || trat.itemMencionado || "")}">
            <div style="display:flex;gap:10px">
              <div style="flex:1"><label>${t("confirmar.pieza")}</label>
                <input class="ts-pieza" type="number" min="11" max="48" value="${trat.piezaFdi ?? ""}"></div>
              <div style="flex:1"><label>${t("confirmar.precio")}</label>
                <input class="ts-precio" type="number" min="0" step="0.01" value="${trat.precioCatalogo ?? ""}"></div>
            </div>
          </div>`);
      });

      if (!estudiante && (n.medicamentosRecetados || []).length) {
        filas.push(`
          <div class="conf-fila">
            <label class="conf-check"><input type="checkbox" id="cfReceta" checked>
              <span>${t("confirmar.receta")}</span></label>
          </div>`);
      }

      // «Cargar a Medicación» sigue a las filas de la nota tal como están
      // AHORA (pintarChecksMedicacion): antes se armaba una vez con la nota
      // original, y una dosis corregida seguía diciendo la vieja, un
      // medicamento agregado no aparecía, y al borrar una fila los números
      // se corrían y se cargaba OTRO.
      filas.push(`<div id="cfMeds"></div>`);

      (n.antecedentesPersonalesNuevos || []).forEach((a, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-antp" data-i="${i}" checked>
            <span>${t("confirmar.antecedente", { item: esc(a) })}</span></label>
        </div>`));

      (n.antecedentesFamiliaresNuevos || []).forEach((a, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-antf" data-i="${i}" checked>
            <span>${t("confirmar.antecedenteFamiliar", { item: esc(a.parentesco + ": " + a.condicion) })}</span></label>
        </div>`));

      (n.vacunasMencionadas || []).forEach((v, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-vac" data-i="${i}" checked>
            <span>${t("confirmar.vacuna", { item: esc(v.nombre + (v.dosis ? " — " + v.dosis : "")) })}</span></label>
        </div>`));

      confirmarHtml = `
        <div class="card">
          ${filas.length > 1 || (n.medicamentosRecetados || []).length ? `
            <div class="nota-titulo">${t("confirmar.titulo")}</div>
            <div class="hint" style="margin-bottom:10px">${t("confirmar.ayuda")}</div>
            ${filas.join("")}` : `
            <div class="hint">${t("confirmar.nada")}</div>
            ${filas.join("")}`}
          <div id="confirmarErr"></div>
          <button class="primary" id="btnConfirmarConsulta" style="margin-top:14px"${esperandoVerif ? " disabled" : ""}>${t(esperandoVerif ? "verif.esperarConfirmar" : "confirmar.boton")}</button>
        </div>`;
    }

    let body = "";
    if (c.estado === "procesando" && enVivo) {
      body = `<div class="hint">${t("consulta.procesandoVivo")}</div>
        <div class="hint" style="white-space:pre-wrap">${esc(c.transcripcionEnVivo || "")}</div>`;
    } else if (c.estado === "procesando") {
      body = `<div class="hint">${t("consulta.procesando")}</div>`;
    } else if (c.estado === "error") {
      body = `<div class="error">⚠️ ${esc(c.error || t("consulta.errTranscribir"))}</div>`;
    } else if (c.segmentos && c.segmentos.length) {
      body = transcripcionHtml(c.segmentos);
    } else {
      body = `<div class="hint">${esc(c.transcripcionCompleta || t("consulta.sinTranscripcion"))}</div>`;
    }

    app.innerHTML = `
      <button class="back" id="btnBack">${t("consulta.volver")}</button>
      <div class="card">
        <div class="nombre" style="font-size:16px;font-weight:600">${esc(c.pacienteNombre || t("consulta.sinNombre"))}</div>
        <div class="fecha">${new Date(c.createdAt).toLocaleString(localeActual())}${c.duracionSegundos ? " · " + Math.round(c.duracionSegundos/60) + t("consulta.min") : ""}</div>
      </div>
      ${hiloClinicoHtml(c)}
      ${notaHtml}
      ${confirmarHtml}
      <div style="margin-top:14px" id="cuerpoTranscripcion">${body}</div>
    `;
    document.getElementById("btnBack").onclick = () => renderPacienteDetalle(c.pacienteId, "consultas");
    engancharHiloClinico();

    // ── medicamentos: quitar / agregar filas en la nota editable ──
    const medsBox = document.getElementById("nfMeds");
    filasNoNombradas = new Set((c.verificacionMedicamentos || []).map((v, i) => (v?.noNombrado ? String(i) : null)).filter(Boolean));
    if (medsBox) {
      medsBox.onclick = (e) => {
        // Tocar la sugerencia es la ÚNICA forma en que el nombre cambia sin
        // que el médico lo escriba: el sistema nunca lo reemplaza solo.
        const sug = e.target.closest(".nf-med-sugerencia");
        if (sug) {
          e.preventDefault();
          const fila = sug.closest(".med-row");
          const n = sug.dataset.nombre;
          fila.querySelector(".nf-med-nombre").value = n.charAt(0).toUpperCase() + n.slice(1);
          fila.querySelector(".nf-med-aviso").innerHTML = "";
          return;
        }
        const usar = e.target.closest(".verif-usar");
        if (usar) {
          e.preventDefault();
          const d = verificacionActual?.diferencias?.[Number(usar.dataset.k)];
          const fila = usar.closest(".med-row");
          if (d?.medicamento && fila) {
            fila.querySelector(".nf-med-dosis").value = d.medicamento.dosis || "";
            fila.querySelector(".nf-med-frec").value = d.medicamento.frecuencia || "";
            fila.querySelector(".nf-med-verif").innerHTML = "";
            pintarChecksMedicacion();
          }
          return;
        }
        const quitar = e.target.closest(".nf-med-quitar");
        if (!quitar) return;
        e.preventDefault();
        quitar.closest(".med-row").remove();
        pintarChecksMedicacion();
      };
      medsBox.addEventListener("input", pintarChecksMedicacion);
      // Al terminar de escribir un nombre (salir del campo), se revisa ese.
      medsBox.addEventListener("change", async (e) => {
        const input = e.target.closest(".nf-med-nombre");
        if (!input) return;
        const aviso = input.closest(".med-row").querySelector(".nf-med-aviso");
        const nombre = input.value.trim();
        if (!nombre) { aviso.innerHTML = ""; return; }
        try {
          const r = await api(`/medico/medicamentos/verificar?nombre=${encodeURIComponent(nombre)}`);
          // Si mientras tanto lo volvió a cambiar, esta respuesta ya no vale.
          if (input.value.trim() === nombre) aviso.innerHTML = avisoMedicamentoHtml(r);
        } catch { /* sin aviso: no bloquea nada */ }
      });
      let filasNuevas = 0;
      const agregarFila = (m = {}) => {
        const fila = document.createElement("div");
        fila.className = "med-row";
        fila.dataset.k = "n" + (++filasNuevas);
        fila.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;align-items:center";
        fila.innerHTML = `
          <input class="nf-med-nombre" type="text" placeholder="${t("nota.med.nombre")}" value="${esc(m.nombre || "")}" style="flex:2;margin:0">
          <input class="nf-med-dosis" type="text" placeholder="${t("nota.med.dosis")}" value="${esc(m.dosis || "")}" style="flex:1;margin:0">
          <input class="nf-med-frec" type="text" placeholder="${t("nota.med.frecuencia")}" value="${esc(m.frecuencia || "")}" style="flex:1;margin:0">
          <button class="link nf-med-quitar" title="${t("nota.med.quitar")}" style="margin:0;width:auto">✕</button>
          <div class="nf-med-aviso" style="flex-basis:100%"></div>`;
        medsBox.appendChild(fila);
        pintarChecksMedicacion();
      };
      pintarChecksMedicacion();
      document.getElementById("nfMedAgregar").onclick = (e) => {
        e.preventDefault();
        agregarFila();
      };
      // Lo que el audio completo dice distinto: solo cambia si el médico
      // toca el botón, igual que la sugerencia de nombre.
      verificacionActual = c.verificacion;
      const verifBox = document.getElementById("verifBox");
      if (verifBox) verifBox.onclick = (e) => {
        const b = e.target.closest(".verif-agregar");
        if (!b) return;
        e.preventDefault();
        const d = verificacionActual?.diferencias?.[Number(b.dataset.k)];
        if (d?.medicamento) agregarFila(d.medicamento);
        b.closest(".verif-falta").remove();
      };
    }

    // ── un solo botón: guarda la nota corregida y aplica lo marcado ──
    const btnConfirmar = document.getElementById("btnConfirmarConsulta");
    if (btnConfirmar) {
      btnConfirmar.onclick = async () => {
        const errBox = document.getElementById("confirmarErr");
        errBox.innerHTML = "";
        const val = (id) => (document.getElementById(id)?.value || "").trim();
        const lista = (id) => val(id).split(",").map(x => x.trim()).filter(Boolean);
        const marcado = (id) => !!document.getElementById(id)?.checked;

        const nota = {
          motivoConsulta: val("nfMotivo"),
          sintomas: lista("nfSintomas"),
          antecedentesRelevantes: val("nfAntecedentes"),
          diagnostico: val("nfDiagnostico"),
          diagnosticosDiferenciales: lista("nfDiferenciales"),
          plan: val("nfPlan"),
          examenesSolicitados: lista("nfExamenes"),
          proximoControl: val("nfProximoControl"),
          medicamentosRecetados: filasMedicamentos().map(r => ({
            // De qué fila de la nota original salió: así el servidor sabe
            // qué nombre corrigió el médico, y lo aprende.
            origen: r.dataset.i !== undefined ? Number(r.dataset.i) : null,
            nombre: r.querySelector(".nf-med-nombre").value.trim(),
            dosis: r.querySelector(".nf-med-dosis").value.trim(),
            frecuencia: r.querySelector(".nf-med-frec").value.trim(),
          })),
        };

        const aplicar = {
          reconsulta: document.getElementById("cfReconsulta")
            ? { activo: marcado("cfReconsulta"), fechaHora: val("cfReconsultaFecha") }
            : null,
          receta: marcado("cfReceta"),
          tratamientos: [...document.querySelectorAll("[data-tratsug]")]
            .filter(r => r.querySelector(".cf-trat").checked)
            .map(r => ({
              itemId: r.dataset.tratsug,
              nombre: r.querySelector(".ts-nombre").value.trim(),
              piezaFdi: r.querySelector(".ts-pieza").value,
              precio: r.querySelector(".ts-precio").value,
            })),
          // Posiciones en la lista que se manda arriba (nota.medicamentosRecetados),
          // que es contra la que el servidor las busca.
          medicamentos: filasMedicamentos()
            .map((r, j) => (document.querySelector(`#cfMeds .cf-med[data-k="${r.dataset.k}"]`)?.checked ? j : -1))
            .filter(j => j >= 0),
          antecedentesPersonales: [...document.querySelectorAll(".cf-antp:checked")].map(x => Number(x.dataset.i)),
          antecedentesFamiliares: [...document.querySelectorAll(".cf-antf:checked")].map(x => Number(x.dataset.i)),
          vacunas: [...document.querySelectorAll(".cf-vac:checked")].map(x => Number(x.dataset.i)),
        };

        btnConfirmar.disabled = true;
        btnConfirmar.textContent = t("confirmar.confirmando");
        try {
          const r = await api(`/medico/consultas/${c._id}/confirmar`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nota, aplicar }),
          });
          // Si algo puntual falló (típico: el WhatsApp de la reconsulta), el
          // resto igual se aplicó — se avisa sin perder lo que ya se guardó.
          if (r.fallado?.length) {
            alert(t("confirmar.parcial") + "\n\n• " + r.fallado.join("\n• "));
          }
          if (r.recetaId) return renderReceta(r.recetaId);
          renderDetalle(id);
        } catch (e) {
          errBox.innerHTML = `<div class="error">${esc(e.error || t("confirmar.errConfirmar"))}</div>`;
          btnConfirmar.disabled = false;
          btnConfirmar.textContent = t("confirmar.boton");
        }
      };
    }

    const btnRegenerar = document.getElementById("btnRegenerarNota");
    if (btnRegenerar) {
      btnRegenerar.onclick = async () => {
        btnRegenerar.disabled = true;
        btnRegenerar.textContent = t("nota.regenerando");
        try {
          await api(`/medico/consultas/${id}/nota/regenerar`, { method: "POST" });
          renderDetalle(id);
        } catch (e) {
          btnRegenerar.disabled = false;
          btnRegenerar.textContent = t("nota.regenerar");
          alert(e.error || t("nota.errRegenerar"));
        }
      };
    }

    if (enVivo && hayNota) pintarVerificacionEnFilas(c.verificacion);

    // Con la nota en vivo en pantalla, el médico puede estar corrigiéndola
    // mientras llega la transcripción completa: repintar todo le borraría lo
    // que escribió. Se actualiza solo lo que cambia —la verificación, el
    // botón y la transcripción—, sin tocar los campos.
    if (hayNota && !yaConfirmada && (c.estado === "procesando" || esperandoVerif)) {
      pollTimeout = setTimeout(() => vigilarVerificacion(id), 5000);
    } else if (c.estado === "procesando" || ((c.estado === "completado" || enVivo) && c.notaClinicaEstado === "pendiente")) {
      pollTimeout = setTimeout(() => renderDetalle(id, true), enVivo ? 3000 : 8000);
    }
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("consulta.errCargar"))}</div>`;
  }
}
