// Symphomed — Recordatorios Médicos: una sola lista de "qué se viene" en todo
// el panel del médico (no por paciente), visible en el Dashboard.

// Las claves ("control", "vacuna"...) son lo que se guarda en la base y no
// se traducen nunca. La etiqueta se resuelve en cada llamada y no en una
// constante de arriba: este archivo se carga antes del login, cuando todavía
// no se sabe en qué idioma trabaja el médico.
const TIPOS_RECORDATORIO_CLAVES = ["control", "medicamento", "estudio", "vacuna", "otro"];
function tiposRecordatorio() {
  const salida = {};
  for (const k of TIPOS_RECORDATORIO_CLAVES) salida[k] = t("record.tipo." + k);
  return salida;
}

// Pantalla propia (antes era una tarjeta fija arriba del dashboard, que
// ocupaba media pantalla del celular incluso sin recordatorios). Ahora se
// entra desde el ícono de campana, que avisa con un contador si hay algo
// pendiente.
async function renderRecordatorios() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("record.cargando")}</div>`;
  try {
    const [dataRecordatorios, dataPacientes] = await Promise.all([
      api("/medico/recordatorios"),
      api("/medico/pacientes"),
    ]);
    const pacientes = dataPacientes.pacientes || [];
    app.innerHTML = `
      <button class="back" id="btnBack">${t("record.volver")}</button>
      ${tabRecordatoriosHtml(dataRecordatorios.recordatorios || [], pacientes)}`;
    document.getElementById("btnBack").onclick = renderDashboard;
    wireRecordatorios(pacientes);
  } catch (e) {
    if (e.status === 401) return logout();
    if (typeof reportarError === "function") reportarError(e, "renderRecordatorios");
    app.innerHTML = `<div class="error">${esc(e.error || t("record.error"))}</div>`;
  }
}

function tabRecordatoriosHtml(recordatorios, pacientes) {
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("record.titulo")}</div>
      ${recordatorios.length === 0 ? `<div class="hint">${t("record.vacio")}</div>` : recordatorios.map(r => `
        <div class="item" style="cursor:default">
          <div class="top">
            <div class="nombre">${esc(tiposRecordatorio()[r.tipo] || r.tipo)} — ${esc(r.titulo)}</div>
            <button class="link" data-borrar-recordatorio="${r._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
          </div>
          <div class="paciente-info">${esc(r.pacienteNombre)}</div>
          <div class="fecha">${new Date(r.fecha).toLocaleDateString(localeActual())}</div>
          <button class="item-action" data-completar-recordatorio="${r._id}">${t("record.marcarHecho")}</button>
        </div>`).join("")}
      <button type="button" class="link" id="btnNuevoRecordatorio" style="margin-top:${recordatorios.length ? "10px" : "0"}">${t("record.nuevo")}</button>
      <div id="recordFormBox" style="display:none;margin-top:12px">
        <label>${t("record.paciente")}</label>
        <select id="recordPaciente">
          ${pacientes.map(p => `<option value="${p._id}">${esc(p.nombre)}</option>`).join("")}
        </select>
        <label>${t("record.tipo")}</label>
        <select id="recordTipo">
          ${Object.entries(tiposRecordatorio()).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}
        </select>
        <label>${t("record.tituloCampo")}</label>
        <input id="recordTitulo" type="text" placeholder="${t("record.tituloPlaceholder")}">
        <label>${t("record.fecha")}</label>
        <input id="recordFecha" type="date">
        <div id="recordErr"></div>
        <button class="secondary" id="btnGuardarRecordatorio">${t("record.guardar")}</button>
      </div>
    </div>`;
}

function wireRecordatorios(pacientes) {
  const btnNuevo = document.getElementById("btnNuevoRecordatorio");
  const formBox = document.getElementById("recordFormBox");
  if (pacientes.length === 0) {
    btnNuevo.disabled = true;
    btnNuevo.title = t("record.registraPaciente");
  } else {
    btnNuevo.onclick = () => { formBox.style.display = formBox.style.display === "none" ? "block" : "none"; };
  }

  const btnGuardar = document.getElementById("btnGuardarRecordatorio");
  if (btnGuardar) {
    btnGuardar.onclick = async () => {
      const errBox = document.getElementById("recordErr");
      errBox.innerHTML = "";
      const pacienteId = document.getElementById("recordPaciente").value;
      const tipo = document.getElementById("recordTipo").value;
      const titulo = document.getElementById("recordTitulo").value.trim();
      const fecha = document.getElementById("recordFecha").value;
      if (!titulo || !fecha) { errBox.innerHTML = `<div class="error">${t("record.errFaltanDatos")}</div>`; return; }
      try {
        await api("/medico/pacientes/" + pacienteId + "/recordatorios", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ tipo, titulo, fecha }),
        });
        renderRecordatorios();
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || t("record.errGuardar"))}</div>`;
      }
    };
  }

  document.querySelectorAll("[data-completar-recordatorio]").forEach(btn => {
    btn.onclick = async () => {
      await api("/medico/recordatorios/" + btn.dataset.completarRecordatorio, {
        method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ completado: true }),
      });
      renderRecordatorios();
    };
  });
  document.querySelectorAll("[data-borrar-recordatorio]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm(t("record.confirmarBorrar"))) return;
      await api("/medico/recordatorios/" + btn.dataset.borrarRecordatorio, { method: "DELETE" });
      renderRecordatorios();
    };
  });
}
