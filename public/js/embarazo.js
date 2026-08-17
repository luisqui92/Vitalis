// Vitalis Obstetricia — control de embarazo: FUM/FPP y semanas de
// gestación (calculadas al vuelo, nunca guardadas, para no desincronizarse
// con el paso de los días). Los controles control a control (peso
// materno, altura uterina, frecuencia cardíaca fetal) viven en la pestaña
// "Controles", que es el módulo de Mediciones de siempre con 3 tipos
// nuevos — no hay que duplicar esa infraestructura acá.

const DESENLACES_EMBARAZO_INFO = {
  parto_vaginal: "Parto vaginal",
  cesarea: "Cesárea",
  aborto: "Aborto",
  otro: "Otro",
};

function trimestreDe(semanas) {
  if (semanas < 14) return "1er trimestre";
  if (semanas < 28) return "2do trimestre";
  return "3er trimestre";
}

async function renderTabEmbarazo(pacienteId) {
  const box = document.getElementById("embarazoBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/embarazo`);
    pintarEmbarazo(pacienteId, data.activo, data.historial || []);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar el embarazo")}</div>`;
  }
}

function pintarEmbarazo(pacienteId, activo, historial) {
  const box = document.getElementById("embarazoBox");
  if (!box) return;

  if (!activo) {
    box.innerHTML = `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">Iniciar seguimiento de embarazo</div>
        <label>Fecha de última menstruación (FUM)</label>
        <input id="embFum" type="date" max="${new Date().toISOString().slice(0, 10)}">
        <div id="embPreview" class="hint" style="margin-top:8px"></div>
        <label style="margin-top:8px">Notas (opcional)</label>
        <input id="embNotas" type="text" placeholder="Ej: primer control, embarazo gemelar...">
        <div id="embErr"></div>
        <button class="primary" id="btnIniciarEmbarazo">Iniciar seguimiento</button>
      </div>
      ${historialEmbarazoHtml(historial)}`;

    const fumInput = document.getElementById("embFum");
    const previewEl = document.getElementById("embPreview");
    fumInput.oninput = () => {
      if (!fumInput.value) { previewEl.textContent = ""; return; }
      const fum = new Date(fumInput.value + "T00:00:00");
      const fpp = new Date(fum.getTime() + 280 * 24 * 60 * 60 * 1000);
      const dias = Math.max(0, Math.floor((Date.now() - fum.getTime()) / (24 * 60 * 60 * 1000)));
      const semanas = Math.floor(dias / 7);
      previewEl.textContent = `FPP estimada: ${fpp.toLocaleDateString("es-BO")} · Semanas actuales: ${semanas} (${trimestreDe(semanas)})`;
    };

    document.getElementById("btnIniciarEmbarazo").onclick = async () => {
      const errBox = document.getElementById("embErr");
      errBox.innerHTML = "";
      const fum = fumInput.value;
      if (!fum) { errBox.innerHTML = `<div class="error">Elegí la fecha de última menstruación</div>`; return; }
      try {
        await api(`/medico/pacientes/${pacienteId}/embarazo`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fum, notas: document.getElementById("embNotas").value.trim() }),
        });
        renderTabEmbarazo(pacienteId);
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo iniciar el embarazo")}</div>`;
      }
    };
    wireHistorialEmbarazo(pacienteId);
    return;
  }

  const semanas = activo.semanasGestacion?.semanas ?? 0;
  const dias = activo.semanasGestacion?.dias ?? 0;
  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="hint" style="text-align:left">${trimestreDe(semanas)}</div>
      <div style="font-size:38px;font-weight:700;margin:6px 0">${semanas}<span style="font-size:18px;font-weight:600">s ${dias}d</span></div>
      <div class="hint">semanas de gestación</div>
      <div style="display:flex;justify-content:space-around;margin-top:16px;text-align:left">
        <div><div class="hint">FUM</div><div style="font-weight:600">${new Date(activo.fum).toLocaleDateString("es-BO")}</div></div>
        <div><div class="hint">FPP</div><div style="font-weight:600">${new Date(activo.fpp).toLocaleDateString("es-BO")}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Notas</div>
      <input id="embNotasEdit" type="text" value="${esc(activo.notas || "")}" placeholder="Ej: embarazo gemelar, antecedente de cesárea...">
      <div id="embEditErr"></div>
      <button class="secondary" id="btnGuardarNotasEmbarazo">Guardar notas</button>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Finalizar embarazo</div>
      <select id="embDesenlace">
        <option value="">— Elegí el desenlace —</option>
        ${Object.entries(DESENLACES_EMBARAZO_INFO).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
      </select>
      <label>Fecha</label>
      <input id="embFechaFin" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <div id="embFinErr"></div>
      <button class="secondary" id="btnFinalizarEmbarazo" style="color:var(--danger)">Finalizar</button>
    </div>
    ${historialEmbarazoHtml(historial)}`;

  document.getElementById("btnGuardarNotasEmbarazo").onclick = async () => {
    const errBox = document.getElementById("embEditErr");
    errBox.innerHTML = "";
    try {
      await api(`/medico/embarazo/${activo._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notas: document.getElementById("embNotasEdit").value.trim() }),
      });
      renderTabEmbarazo(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };

  document.getElementById("btnFinalizarEmbarazo").onclick = async () => {
    const errBox = document.getElementById("embFinErr");
    errBox.innerHTML = "";
    const desenlace = document.getElementById("embDesenlace").value;
    if (!desenlace) { errBox.innerHTML = `<div class="error">Elegí el desenlace</div>`; return; }
    if (!confirm("¿Finalizar este embarazo? Se puede seguir viendo en el historial.")) return;
    try {
      await api(`/medico/embarazo/${activo._id}/finalizar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desenlace, fechaFin: document.getElementById("embFechaFin").value }),
      });
      renderTabEmbarazo(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo finalizar")}</div>`;
    }
  };
  wireHistorialEmbarazo(pacienteId);
}

function historialEmbarazoHtml(historial) {
  if (!historial.length) return "";
  return `
    <div class="seccion-titulo">Embarazos anteriores</div>
    ${historial.map(h => `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${DESENLACES_EMBARAZO_INFO[h.desenlace] || h.desenlace || "Finalizado"}</div>
          <button class="link" data-borrar-embarazo="${h._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">FUM ${new Date(h.fum).toLocaleDateString("es-BO")} · Finalizó ${h.fechaFin ? new Date(h.fechaFin).toLocaleDateString("es-BO") : "—"}</div>
        ${h.notas ? `<div class="paciente-info">📝 ${esc(h.notas)}</div>` : ""}
      </div>`).join("")}`;
}

function wireHistorialEmbarazo(pacienteId) {
  document.querySelectorAll("[data-borrar-embarazo]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Eliminar este registro de embarazo?")) return;
      await api("/medico/embarazo/" + btn.dataset.borrarEmbarazo, { method: "DELETE" });
      renderTabEmbarazo(pacienteId);
    };
  });
}
