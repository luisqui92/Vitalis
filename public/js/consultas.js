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

    let notaHtml = "";
    if (c.estado === "completado") {
      if (c.notaClinicaEstado === "pendiente") {
        notaHtml = `<div class="card"><div class="hint">🧠 Generando nota clínica...</div></div>`;
      } else if (c.notaClinicaEstado === "error") {
        notaHtml = `<div class="card"><div class="error">⚠️ No se pudo generar la nota clínica automática. La transcripción completa queda más abajo.</div></div>`;
      } else if (c.notaClinica) {
        const n = c.notaClinica;
        const meds = (n.medicamentosRecetados || []).map(m =>
          esc(m.nombre + (m.dosis ? " " + m.dosis : "") + (m.frecuencia ? " — " + m.frecuencia : ""))
        ).join("; ");
        notaHtml = `
          <div class="card">
            <div class="nota-titulo">🧠 Nota clínica generada por IA (revisar antes de usar)</div>
            ${n.motivoConsulta ? `<div class="nota-campo"><b>Motivo:</b> ${esc(n.motivoConsulta)}</div>` : ""}
            ${(n.sintomas||[]).length ? `<div class="nota-campo"><b>Síntomas:</b> ${esc(n.sintomas.join(", "))}</div>` : ""}
            ${n.antecedentesRelevantes ? `<div class="nota-campo"><b>Antecedentes:</b> ${esc(n.antecedentesRelevantes)}</div>` : ""}
            ${n.diagnostico ? `<div class="nota-campo"><b>Diagnóstico:</b> ${esc(n.diagnostico)}</div>` : ""}
            ${(n.diagnosticosDiferenciales||[]).length ? `<div class="nota-campo"><b>Diferenciales:</b> ${esc(n.diagnosticosDiferenciales.join(", "))}</div>` : ""}
            ${n.plan ? `<div class="nota-campo"><b>Plan:</b> ${esc(n.plan)}</div>` : ""}
            ${meds ? `<div class="nota-campo"><b>Medicamentos:</b> ${meds}</div>` : ""}
            ${(n.examenesSolicitados||[]).length ? `<div class="nota-campo"><b>Exámenes:</b> ${esc(n.examenesSolicitados.join(", "))}</div>` : ""}
            ${n.proximoControl ? `<div class="nota-campo"><b>Próximo control:</b> ${esc(n.proximoControl)}</div>` : ""}
            ${(n.medicamentosRecetados||[]).length ? `<button class="secondary" id="btnGenerarReceta" style="margin-top:14px">📝 Generar receta con estos medicamentos</button>` : ""}
          </div>`;
      }
    }

    let sugerenciasHtml = "";
    if (c.estado === "completado" && c.notaClinicaEstado === "completado" && c.notaClinica) {
      const n = c.notaClinica;
      const items = [];
      (n.medicamentosRecetados || []).forEach((m, i) => items.push({
        tipo: "medicamento", i,
        texto: esc(m.nombre + (m.dosis ? " " + m.dosis : "") + (m.frecuencia ? " — " + m.frecuencia : "")),
      }));
      (n.antecedentesPersonalesNuevos || []).forEach((a, i) => items.push({ tipo: "antp", i, texto: esc(a) }));
      (n.antecedentesFamiliaresNuevos || []).forEach((a, i) => items.push({
        tipo: "antf", i, texto: esc(`${a.parentesco}: ${a.condicion}`),
      }));
      (n.vacunasMencionadas || []).forEach((v, i) => items.push({
        tipo: "vacuna", i,
        texto: esc(v.nombre + (v.dosis ? " — " + v.dosis : "") + (v.fecha ? " (" + v.fecha + ")" : "")),
      }));
      if (items.length) {
        sugerenciasHtml = `
          <div class="card">
            <div class="nota-titulo">➕ Sugerencias para el Kardex</div>
            <div class="hint" style="margin-bottom:10px">Detectado en esta consulta. Revisá y agregá lo que corresponda — no se carga nada solo.</div>
            ${items.map(it => `
              <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
                <span>${it.texto}</span>
                <button class="link" data-sugerencia="${it.tipo}:${it.i}" style="margin:0;width:auto;white-space:nowrap">➕ Agregar</button>
              </div>`).join("")}
          </div>`;
      }
    }

    let reconsultaHtml = "";
    const reconsulta = c.notaClinica?.reconsultaSugerida;
    if (reconsulta?.fechaHora) {
      if (reconsulta.estado === "pendiente") {
        // datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local, no UTC.
        const f = new Date(reconsulta.fechaHora);
        const valorInput = new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        reconsultaHtml = `
          <div class="card">
            <div class="nota-titulo">🗓️ Reconsulta sugerida</div>
            ${reconsulta.textoOriginal ? `<div class="hint" style="margin-bottom:10px">Detecté esto en la consulta: "${esc(reconsulta.textoOriginal)}"</div>` : ""}
            <label>Fecha y hora (revisá antes de avisarle al paciente)</label>
            <input id="reconsultaFecha" type="datetime-local" value="${valorInput}">
            <div id="reconsultaErr"></div>
            <button class="primary" id="btnConfirmarReconsulta">Confirmar y avisar por WhatsApp</button>
            <button class="link" id="btnDescartarReconsulta">Descartar</button>
          </div>`;
      } else if (reconsulta.estado === "confirmada") {
        reconsultaHtml = `<div class="card"><div class="hint" style="color:var(--success)">✅ Reconsulta confirmada — se le avisó al paciente por WhatsApp.</div></div>`;
      }
    }

    let tratamientosHtml = "";
    const tratSugeridos = c.notaClinica?.tratamientosSugeridos;
    if (tratSugeridos && tratSugeridos.length) {
      const pendientes = tratSugeridos.filter(t => t.estado === "pendiente");
      const resueltos = tratSugeridos.filter(t => t.estado !== "pendiente");
      if (pendientes.length || resueltos.length) {
        tratamientosHtml = `
          <div class="card">
            <div class="nota-titulo">🦷 Tratamientos mencionados</div>
            <div class="hint" style="margin-bottom:10px">Detecté esto en la consulta. Revisá el nombre, la pieza y el precio antes de agregarlo al presupuesto — no se carga nada solo.</div>
            ${pendientes.map(t => `
              <div class="dato-row" data-tratsug="${t._id}" style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">
                <div class="hint" style="margin-bottom:8px">Detecté esto en la consulta: "${esc(t.itemMencionado)}"</div>
                <label>Tratamiento</label>
                <input class="ts-nombre" type="text" value="${esc(t.catalogoNombreSugerido || t.itemMencionado || "")}">
                <div style="display:flex;gap:10px">
                  <div style="flex:1">
                    <label>Pieza (FDI, opcional)</label>
                    <input class="ts-pieza" type="number" min="11" max="48" value="${t.piezaFdi ?? ""}">
                  </div>
                  <div style="flex:1">
                    <label>Precio (Bs.)</label>
                    <input class="ts-precio" type="number" min="0" step="0.01" value="${t.precioCatalogo ?? ""}">
                  </div>
                </div>
                <div class="ts-err"></div>
                <button class="primary ts-btn-agregar" style="margin-top:8px">Agregar al presupuesto</button>
                <button class="link ts-btn-descartar">Descartar</button>
              </div>`).join("")}
            ${resueltos.map(t => `
              <div class="hint" style="margin-top:8px;color:${t.estado === "agregado" ? "var(--success)" : "inherit"}">
                ${t.estado === "agregado" ? "✅ Agregado al presupuesto" : "— Descartado"}: "${esc(t.itemMencionado)}"
              </div>`).join("")}
          </div>`;
      }
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
      ${reconsultaHtml}
      ${tratamientosHtml}
      ${sugerenciasHtml}
      <div style="margin-top:14px">${body}</div>
    `;
    document.getElementById("btnBack").onclick = () => renderPacienteDetalle(c.pacienteId, "consultas");

    const btnConfirmarReconsulta = document.getElementById("btnConfirmarReconsulta");
    if (btnConfirmarReconsulta) {
      btnConfirmarReconsulta.onclick = async () => {
        const errBox = document.getElementById("reconsultaErr");
        errBox.innerHTML = "";
        btnConfirmarReconsulta.disabled = true;
        btnConfirmarReconsulta.textContent = "Enviando...";
        try {
          const fechaHora = document.getElementById("reconsultaFecha").value;
          await api(`/medico/consultas/${c._id}/reconsulta/confirmar`, {
            method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ fechaHora }),
          });
          renderDetalle(id);
        } catch (e) {
          errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo confirmar")}</div>`;
          btnConfirmarReconsulta.disabled = false;
          btnConfirmarReconsulta.textContent = "Confirmar y avisar por WhatsApp";
        }
      };
    }
    const btnDescartarReconsulta = document.getElementById("btnDescartarReconsulta");
    if (btnDescartarReconsulta) {
      btnDescartarReconsulta.onclick = async () => {
        await api(`/medico/consultas/${c._id}/reconsulta/descartar`, { method: "POST" });
        renderDetalle(id);
      };
    }

    document.querySelectorAll("[data-tratsug]").forEach(row => {
      const itemId = row.dataset.tratsug;
      const errBox = row.querySelector(".ts-err");
      const btnAgregar = row.querySelector(".ts-btn-agregar");
      const btnDescartar = row.querySelector(".ts-btn-descartar");

      btnAgregar.onclick = async () => {
        errBox.innerHTML = "";
        const nombre = row.querySelector(".ts-nombre").value.trim();
        const piezaFdi = row.querySelector(".ts-pieza").value;
        const precio = row.querySelector(".ts-precio").value;
        btnAgregar.disabled = true;
        btnAgregar.textContent = "Agregando...";
        try {
          await api(`/medico/consultas/${c._id}/tratamientos-sugeridos/${itemId}/agregar`, {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ nombre, precio, piezaFdi }),
          });
          renderDetalle(id);
        } catch (e) {
          errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo agregar")}</div>`;
          btnAgregar.disabled = false;
          btnAgregar.textContent = "Agregar al presupuesto";
        }
      };
      btnDescartar.onclick = async () => {
        await api(`/medico/consultas/${c._id}/tratamientos-sugeridos/${itemId}/descartar`, { method: "POST" });
        renderDetalle(id);
      };
    });

    const btnGenerarReceta = document.getElementById("btnGenerarReceta");
    if (btnGenerarReceta) {
      btnGenerarReceta.onclick = async () => {
        btnGenerarReceta.disabled = true;
        btnGenerarReceta.textContent = "Generando...";
        try {
          const data = await api("/medico/pacientes/" + c.pacienteId + "/recetas", {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ medicamentos: c.notaClinica.medicamentosRecetados, consultaId: c._id }),
          });
          renderReceta(data.receta._id);
        } catch (e) {
          btnGenerarReceta.disabled = false;
          btnGenerarReceta.textContent = "📝 Generar receta con estos medicamentos";
        }
      };
    }

    document.querySelectorAll("[data-sugerencia]").forEach(btn => {
      btn.onclick = async () => {
        const [tipo, iStr] = btn.dataset.sugerencia.split(":");
        const i = Number(iStr);
        const n = c.notaClinica;
        btn.disabled = true;
        try {
          if (tipo === "medicamento") {
            const m = n.medicamentosRecetados[i];
            await api("/medico/pacientes/" + c.pacienteId + "/medicamentos", {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ nombre: m.nombre, dosis: m.dosis || "", frecuencia: m.frecuencia || "" }),
            });
          } else if (tipo === "antp") {
            await api("/medico/pacientes/" + c.pacienteId + "/antecedentes-personales", {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ texto: n.antecedentesPersonalesNuevos[i] }),
            });
          } else if (tipo === "antf") {
            const a = n.antecedentesFamiliaresNuevos[i];
            await api("/medico/pacientes/" + c.pacienteId + "/antecedentes-familiares", {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ parentesco: a.parentesco, condicion: a.condicion }),
            });
          } else if (tipo === "vacuna") {
            const v = n.vacunasMencionadas[i];
            // toISOString() es siempre UTC — una consulta cargada de noche
            // en Bolivia (UTC-4) ya cae en el día siguiente en UTC, y la
            // vacuna quedaba anotada un día adelantada. Mismo truco que la
            // línea de arriba (reconsulta): restar el offset local antes
            // de cortar a solo la fecha.
            const fCreada = new Date(c.createdAt);
            const fecha = v.fecha || new Date(fCreada.getTime() - fCreada.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            await api("/medico/pacientes/" + c.pacienteId + "/vacunas", {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ nombre: v.nombre, dosis: v.dosis || "", fecha }),
            });
          }
          btn.textContent = "✅ Agregado";
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "⚠️ Reintentar";
        }
      };
    });

    if (c.estado === "procesando" || (c.estado === "completado" && c.notaClinicaEstado === "pendiente")) {
      pollTimeout = setTimeout(() => renderDetalle(id, true), 8000);
    }
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando la consulta")}</div>`;
  }
}
