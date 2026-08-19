// Vitalis — Nueva consulta (local o control remoto) y el detalle de una
// consulta (transcripción + nota clínica).

// Íconos del botón de grabar (SVG en vez de emoji: se ve nítido y
// consistente en cualquier celular, y toma el color por currentColor).
const ICONO_MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICONO_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>`;

// ─── NUEVA CONSULTA (grabar con el logo de Vitalis latiendo, o subir archivo) ──
function renderNuevaConsulta(pacienteId, pacienteNombre) {
  detenerPolling();
  app.innerHTML = `
    <button class="back" id="btnBack">← Volver</button>
    <div class="card">
      <div class="hint" style="margin-bottom:14px">Paciente: <b>${esc(pacienteNombre)}</b></div>

      <div class="listen-panel" id="listenPanel">
        <div class="listen-orb" id="audioOrb">
          <div class="listen-ring"></div>
          <div class="listen-ring listen-ring-2"></div>
          <img src="/logo.png" alt="" class="listen-logo">
        </div>
        <div class="listen-time" id="recTime">00:00</div>
        <div class="listen-label">🎙️ Escuchando la consulta...</div>
        <div class="live-caption" id="liveCaption"></div>
      </div>

      <div class="rec-box">
        <button class="rec-btn" id="recBtn">${ICONO_MIC}</button>
        <div class="rec-status" id="recStatus">Tocá para grabar</div>
      </div>
      <label class="file-label" for="ncFile">📁 O subí un archivo de audio ya grabado</label>
      <input type="file" id="ncFile" accept="audio/*" style="display:none">
      <div id="ncErr"></div>
      <button class="primary" id="ncSubir" style="display:none">Subir y transcribir</button>
      <button class="link" id="btnRemota">💻📱 ¿Esta compu no tiene micrófono? Grabar con el celular vinculado</button>
    </div>`;
  document.getElementById("btnBack").onclick = () => renderPacienteDetalle(pacienteId, "consultas");
  document.getElementById("btnRemota").onclick = () => renderNuevaConsultaRemota(pacienteId, pacienteNombre);

  let mediaRecorder = null, chunks = [], blob = null, mimeType = "audio/webm";
  let seconds = 0, timerId = null;
  const recBtn = document.getElementById("recBtn");
  const recTime = document.getElementById("recTime");
  const recStatus = document.getElementById("recStatus");
  const ncSubir = document.getElementById("ncSubir");
  const ncErr = document.getElementById("ncErr");
  const listenPanel = document.getElementById("listenPanel");
  const liveCaption = document.getElementById("liveCaption");
  const onda = crearIndicadorAudio(document.getElementById("audioOrb"));
  const transcriptorVivo = crearTranscriptorEnVivo(texto => { liveCaption.textContent = texto; });

  recBtn.onclick = async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
        mimeType = tipos.find(t => MediaRecorder.isTypeSupported(t)) || "";
        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        chunks = [];
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          blob = new Blob(chunks, { type: mimeType || "audio/webm" });
          stream.getTracks().forEach(t => t.stop());
          onda.detener();
          transcriptorVivo.detener();
          listenPanel.style.display = "none";
          recStatus.textContent = "Grabación lista (" + fmt(seconds) + ")";
          ncSubir.style.display = "block";
        };
        mediaRecorder.start();
        seconds = 0; recTime.textContent = "00:00"; liveCaption.textContent = "";
        listenPanel.style.display = "block";
        onda.iniciar(stream);
        transcriptorVivo.iniciar(stream);
        timerId = setInterval(() => { seconds++; recTime.textContent = fmt(seconds); }, 1000);
        recBtn.classList.add("recording");
        recBtn.innerHTML = ICONO_STOP;
        recStatus.textContent = "Grabando... tocá para detener";
        ncSubir.style.display = "none";
      } catch (e) {
        ncErr.innerHTML = `<div class="error">No se pudo acceder al micrófono: ${esc(e.message)}</div>`;
      }
    } else {
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
    recStatus.textContent = "Archivo listo: " + f.name;
    ncSubir.style.display = "block";
  };

  ncSubir.onclick = async () => {
    if (!blob) return;
    ncErr.innerHTML = "";
    ncSubir.disabled = true;
    ncSubir.textContent = "Subiendo audio...";
    try {
      const data = await subirConsulta(pacienteId, blob, mimeType);
      renderDetalle(data.consulta._id);
    } catch (e) {
      // no se pierde la grabación: se puede reintentar sin volver a grabar
      ncSubir.disabled = false;
      ncSubir.textContent = "Reintentar subir";
      ncErr.innerHTML = `<div class="error">${esc(e.error || "No se pudo subir. Revisá tu conexión y volvé a intentar.")}</div>`;
    }
  };
}

// ─── NUEVA CONSULTA — CONTROL REMOTO (desde la compu, graba el celular) ─
// Requiere que el médico ya haya vinculado su celular hoy (ver vinculacion.js).
async function renderNuevaConsultaRemota(pacienteId, pacienteNombre) {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const data = await api("/medico/vinculacion");
    pintarControlRemoto(data.vinculacion, pacienteId, pacienteNombre);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando la vinculación")}</div>`;
  }
}

function pintarControlRemoto(v, pacienteId, pacienteNombre) {
  let cuerpo = "";
  if (!v.vinculado) {
    cuerpo = `
      <div class="hint" style="margin-bottom:14px">Todavía no vinculaste tu celular hoy. Abrí Vitalis en el celular, tocá "Vincular como micrófono" e ingresá este código:</div>
      <div style="text-align:center;font-size:38px;font-weight:700;letter-spacing:4px;color:var(--primary);padding:18px 0">${esc(v.codigo)}</div>
      <div class="hint">Esta pantalla se actualiza sola apenas lo vincules.</div>`;
  } else if (v.estado === "armado") {
    cuerpo = `
      <div class="hint" style="margin-bottom:14px">📱 Celular vinculado y listo, apoyado con la pantalla prendida.</div>
      <button class="primary" id="btnIniciarRemoto" style="margin-top:0">🎙️ Iniciar grabación remota</button>`;
  } else if (v.estado === "grabando") {
    cuerpo = `
      <div class="listen-panel" style="display:block">
        <div class="listen-label" style="margin-bottom:6px">⏺ Grabando en el celular vinculado...</div>
      </div>
      <button class="primary" id="btnDetenerRemoto" style="margin-top:0;background:var(--danger)">⏹️ Detener grabación</button>`;
  }

  app.innerHTML = `
    <button class="back" id="btnBack">← Volver</button>
    <div class="card">
      <div class="hint" style="margin-bottom:14px">Paciente: <b>${esc(pacienteNombre)}</b></div>
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
      document.getElementById("ncrErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo mandar la orden")}</div>`;
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
async function renderDetalle(id, esRefrescoAutomatico) {
  detenerPolling();
  if (!esRefrescoAutomatico) app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const data = await api("/medico/consultas/" + id);
    const c = data.consulta;

    const yaConfirmada = !!c.confirmadaEn;
    const n = c.notaClinica;
    const hayNota = c.estado === "completado" && c.notaClinicaEstado === "completado" && n;

    // ── NOTA CLÍNICA ──
    // Antes de confirmar es un formulario: la IA se equivoca (nombres de
    // medicamentos, una pieza mal escuchada) y el médico tiene que poder
    // corregirlo antes de que eso quede en el Kardex. Después de confirmar
    // se muestra como texto, ya sin editar.
    let notaHtml = "";
    if (c.estado === "completado") {
      if (c.notaClinicaEstado === "pendiente") {
        notaHtml = `<div class="card"><div class="hint">🧠 Generando nota clínica...</div></div>`;
      } else if (c.notaClinicaEstado === "error") {
        notaHtml = `<div class="card"><div class="error">⚠️ No se pudo generar la nota clínica automática. La transcripción completa queda más abajo.</div></div>`;
      } else if (n && yaConfirmada) {
        const meds = (n.medicamentosRecetados || []).map(m =>
          esc(m.nombre + (m.dosis ? " " + m.dosis : "") + (m.frecuencia ? " — " + m.frecuencia : ""))
        ).join("; ");
        notaHtml = `
          <div class="card">
            <div class="nota-titulo">🧠 Nota clínica${c.notaEditadaPorMedico ? " (corregida por vos)" : ""}</div>
            <div class="hint" style="color:var(--success);margin-bottom:10px">✅ Consulta confirmada el ${new Date(c.confirmadaEn).toLocaleString("es-BO")}</div>
            ${n.motivoConsulta ? `<div class="nota-campo"><b>Motivo:</b> ${esc(n.motivoConsulta)}</div>` : ""}
            ${(n.sintomas||[]).length ? `<div class="nota-campo"><b>Síntomas:</b> ${esc(n.sintomas.join(", "))}</div>` : ""}
            ${n.antecedentesRelevantes ? `<div class="nota-campo"><b>Antecedentes:</b> ${esc(n.antecedentesRelevantes)}</div>` : ""}
            ${n.diagnostico ? `<div class="nota-campo"><b>Diagnóstico:</b> ${esc(n.diagnostico)}</div>` : ""}
            ${(n.diagnosticosDiferenciales||[]).length ? `<div class="nota-campo"><b>Diferenciales:</b> ${esc(n.diagnosticosDiferenciales.join(", "))}</div>` : ""}
            ${n.plan ? `<div class="nota-campo"><b>Plan:</b> ${esc(n.plan)}</div>` : ""}
            ${meds ? `<div class="nota-campo"><b>Medicamentos:</b> ${meds}</div>` : ""}
            ${(n.examenesSolicitados||[]).length ? `<div class="nota-campo"><b>Exámenes:</b> ${esc(n.examenesSolicitados.join(", "))}</div>` : ""}
            ${n.proximoControl ? `<div class="nota-campo"><b>Próximo control:</b> ${esc(n.proximoControl)}</div>` : ""}
          </div>`;
      } else if (n) {
        notaHtml = `
          <div class="card">
            <div class="nota-titulo">🧠 Nota clínica generada por IA</div>
            <div class="hint" style="margin-bottom:12px">Revisá y corregí lo que haga falta. Se guarda cuando confirmás.</div>
            <label>Motivo de consulta</label>
            <input id="nfMotivo" type="text" value="${esc(n.motivoConsulta || "")}">
            <label>Síntomas <span class="hint">(separados por coma)</span></label>
            <input id="nfSintomas" type="text" value="${esc((n.sintomas || []).join(", "))}">
            <label>Antecedentes relevantes</label>
            <textarea id="nfAntecedentes" rows="2">${esc(n.antecedentesRelevantes || "")}</textarea>
            <label>Diagnóstico</label>
            <input id="nfDiagnostico" type="text" value="${esc(n.diagnostico || "")}">
            <label>Diagnósticos diferenciales <span class="hint">(separados por coma)</span></label>
            <input id="nfDiferenciales" type="text" value="${esc((n.diagnosticosDiferenciales || []).join(", "))}">
            <label>Plan</label>
            <textarea id="nfPlan" rows="3">${esc(n.plan || "")}</textarea>
            <label>Medicamentos</label>
            <div id="nfMeds">
              ${(n.medicamentosRecetados || []).map((m, i) => `
                <div class="med-row" data-i="${i}" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
                  <input class="nf-med-nombre" type="text" placeholder="Medicamento" value="${esc(m.nombre || "")}" style="flex:2;margin:0">
                  <input class="nf-med-dosis" type="text" placeholder="Dosis" value="${esc(m.dosis || "")}" style="flex:1;margin:0">
                  <input class="nf-med-frec" type="text" placeholder="Frecuencia" value="${esc(m.frecuencia || "")}" style="flex:1;margin:0">
                  <button class="link nf-med-quitar" title="Quitar" style="margin:0;width:auto">✕</button>
                </div>`).join("")}
            </div>
            <button class="link" id="nfMedAgregar" style="margin:0 0 10px 0;width:auto">➕ Agregar medicamento</button>
            <label>Exámenes solicitados <span class="hint">(separados por coma)</span></label>
            <input id="nfExamenes" type="text" value="${esc((n.examenesSolicitados || []).join(", "))}">
            <label>Próximo control</label>
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

      const reconsulta = n.reconsultaSugerida;
      if (reconsulta?.fechaHora && reconsulta.estado === "pendiente") {
        // datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local, no UTC.
        const f = new Date(reconsulta.fechaHora);
        const valorInput = new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        filas.push(`
          <div class="conf-fila">
            <label class="conf-check"><input type="checkbox" id="cfReconsulta" checked>
              <span><b>Agendar reconsulta</b> y avisarle al paciente por WhatsApp</span></label>
            ${reconsulta.textoOriginal ? `<div class="hint">Dijiste: "${esc(reconsulta.textoOriginal)}"</div>` : ""}
            <input id="cfReconsultaFecha" type="datetime-local" value="${valorInput}">
          </div>`);
      }

      (n.tratamientosSugeridos || []).filter(t => t.estado === "pendiente").forEach(t => {
        filas.push(`
          <div class="conf-fila" data-tratsug="${t._id}">
            <label class="conf-check"><input type="checkbox" class="cf-trat" checked>
              <span><b>Agregar al presupuesto</b></span></label>
            <div class="hint">Dijiste: "${esc(t.itemMencionado)}"</div>
            <input class="ts-nombre" type="text" value="${esc(t.catalogoNombreSugerido || t.itemMencionado || "")}">
            <div style="display:flex;gap:10px">
              <div style="flex:1"><label>Pieza (FDI)</label>
                <input class="ts-pieza" type="number" min="11" max="48" value="${t.piezaFdi ?? ""}"></div>
              <div style="flex:1"><label>Precio (Bs.)</label>
                <input class="ts-precio" type="number" min="0" step="0.01" value="${t.precioCatalogo ?? ""}"></div>
            </div>
          </div>`);
      });

      if ((n.medicamentosRecetados || []).length) {
        filas.push(`
          <div class="conf-fila">
            <label class="conf-check"><input type="checkbox" id="cfReceta" checked>
              <span><b>Generar receta</b> con los medicamentos de la nota</span></label>
          </div>`);
      }

      (n.medicamentosRecetados || []).forEach((m, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-med" data-i="${i}" checked>
            <span>Cargar a <b>Medicación</b>: ${esc(m.nombre + (m.dosis ? " " + m.dosis : ""))}</span></label>
        </div>`));

      (n.antecedentesPersonalesNuevos || []).forEach((a, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-antp" data-i="${i}" checked>
            <span>Agregar <b>antecedente</b>: ${esc(a)}</span></label>
        </div>`));

      (n.antecedentesFamiliaresNuevos || []).forEach((a, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-antf" data-i="${i}" checked>
            <span>Agregar <b>antecedente familiar</b>: ${esc(a.parentesco + ": " + a.condicion)}</span></label>
        </div>`));

      (n.vacunasMencionadas || []).forEach((v, i) => filas.push(`
        <div class="conf-fila">
          <label class="conf-check"><input type="checkbox" class="cf-vac" data-i="${i}" checked>
            <span>Agregar <b>vacuna</b>: ${esc(v.nombre + (v.dosis ? " — " + v.dosis : ""))}</span></label>
        </div>`));

      confirmarHtml = `
        <div class="card">
          ${filas.length ? `
            <div class="nota-titulo">✅ Qué aplicar al confirmar</div>
            <div class="hint" style="margin-bottom:10px">Desmarcá lo que no corresponda. Nada se carga hasta que confirmes.</div>
            ${filas.join("")}` : `
            <div class="hint">No detecté nada para cargar al Kardex en esta consulta.</div>`}
          <div id="confirmarErr"></div>
          <button class="primary" id="btnConfirmarConsulta" style="margin-top:14px">Confirmar consulta</button>
        </div>`;
    }

    let body = "";
    if (c.estado === "procesando") {
      body = `<div class="hint">⏳ Transcribiendo tu consulta... para audios largos puede tardar varios minutos. Esta pantalla se actualiza sola, no hace falta que hagas nada.</div>`;
    } else if (c.estado === "error") {
      body = `<div class="error">⚠️ ${esc(c.error || "Ocurrió un error al transcribir")}</div>`;
    } else if (c.segmentos && c.segmentos.length) {
      body = `<div class="seccion-titulo">Transcripción</div>` + c.segmentos.map(s => `
        <div class="segmento h${s.hablante && s.hablante.charCodeAt(0) % 2}">
          <div class="quien">Hablante ${esc(s.hablante)}</div>
          <div class="texto">${esc(s.texto)}</div>
        </div>`).join("");
    } else {
      body = `<div class="hint">${esc(c.transcripcionCompleta || "Sin transcripción")}</div>`;
    }

    app.innerHTML = `
      <button class="back" id="btnBack">← Volver</button>
      <div class="card">
        <div class="nombre" style="font-size:16px;font-weight:600">${esc(c.pacienteNombre || "Sin nombre de paciente")}</div>
        <div class="fecha">${new Date(c.createdAt).toLocaleString("es-BO")}${c.duracionSegundos ? " · " + Math.round(c.duracionSegundos/60) + " min" : ""}</div>
      </div>
      ${notaHtml}
      ${confirmarHtml}
      <div style="margin-top:14px">${body}</div>
    `;
    document.getElementById("btnBack").onclick = () => renderPacienteDetalle(c.pacienteId, "consultas");

    // ── medicamentos: quitar / agregar filas en la nota editable ──
    const medsBox = document.getElementById("nfMeds");
    if (medsBox) {
      medsBox.onclick = (e) => {
        const quitar = e.target.closest(".nf-med-quitar");
        if (!quitar) return;
        e.preventDefault();
        quitar.closest(".med-row").remove();
      };
      document.getElementById("nfMedAgregar").onclick = (e) => {
        e.preventDefault();
        const fila = document.createElement("div");
        fila.className = "med-row";
        fila.style.cssText = "display:flex;gap:6px;margin-bottom:6px;align-items:center";
        fila.innerHTML = `
          <input class="nf-med-nombre" type="text" placeholder="Medicamento" style="flex:2;margin:0">
          <input class="nf-med-dosis" type="text" placeholder="Dosis" style="flex:1;margin:0">
          <input class="nf-med-frec" type="text" placeholder="Frecuencia" style="flex:1;margin:0">
          <button class="link nf-med-quitar" title="Quitar" style="margin:0;width:auto">✕</button>`;
        medsBox.appendChild(fila);
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
          medicamentosRecetados: [...document.querySelectorAll("#nfMeds .med-row")].map(r => ({
            nombre: r.querySelector(".nf-med-nombre").value.trim(),
            dosis: r.querySelector(".nf-med-dosis").value.trim(),
            frecuencia: r.querySelector(".nf-med-frec").value.trim(),
          })).filter(m => m.nombre),
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
          medicamentos: [...document.querySelectorAll(".cf-med:checked")].map(x => Number(x.dataset.i)),
          antecedentesPersonales: [...document.querySelectorAll(".cf-antp:checked")].map(x => Number(x.dataset.i)),
          antecedentesFamiliares: [...document.querySelectorAll(".cf-antf:checked")].map(x => Number(x.dataset.i)),
          vacunas: [...document.querySelectorAll(".cf-vac:checked")].map(x => Number(x.dataset.i)),
        };

        btnConfirmar.disabled = true;
        btnConfirmar.textContent = "Confirmando...";
        try {
          const r = await api(`/medico/consultas/${c._id}/confirmar`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nota, aplicar }),
          });
          // Si algo puntual falló (típico: el WhatsApp de la reconsulta), el
          // resto igual se aplicó — se avisa sin perder lo que ya se guardó.
          if (r.fallado?.length) {
            alert("Se confirmó la consulta, pero esto no se pudo aplicar:\n\n• " + r.fallado.join("\n• "));
          }
          if (r.recetaId) return renderReceta(r.recetaId);
          renderDetalle(id);
        } catch (e) {
          errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo confirmar")}</div>`;
          btnConfirmar.disabled = false;
          btnConfirmar.textContent = "Confirmar consulta";
        }
      };
    }

    if (c.estado === "procesando" || (c.estado === "completado" && c.notaClinicaEstado === "pendiente")) {
      pollTimeout = setTimeout(() => renderDetalle(id, true), 8000);
    }
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando la consulta")}</div>`;
  }
}
