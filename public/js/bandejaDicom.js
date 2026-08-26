// ═══════════════════════════════════════════════════════════════════════════
// Bandeja de estudios — lo que llegó de la caja y todavía no tiene dueño
// ═══════════════════════════════════════════════════════════════════════════
// En un consultorio con un sillón, la ventana de captura alcanza: el médico
// abre la ficha, dispara, y la placa cae ahí. En un centro de imagen no —los
// estudios llegan todo el día desde varios equipos y nadie está apretando un
// botón por cada uno—, así que caen acá con el nombre que el técnico tipeó
// en el aparato y el médico los asigna.
//
// Lo mejor de todo es que esta pantalla ESTÉ VACÍA: si el técnico pone el
// código del paciente en el equipo, el estudio se archiva solo y nunca pasa
// por acá. La bandeja es la red, no el camino.

let bandejaPacientes = null; // se cachea: la lista no cambia mientras asignás

async function renderBandejaDicom() {
  if (typeof detenerPolling === "function") detenerPolling();
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("dicom.cargando")}</div>`;
  let entrantes = [];
  try {
    const [b, p] = await Promise.all([
      api("/medico/dicom/bandeja"),
      bandejaPacientes ? Promise.resolve({ pacientes: bandejaPacientes }) : api("/medico/pacientes"),
    ]);
    entrantes = b.entrantes || [];
    bandejaPacientes = p.pacientes || [];
  } catch (e) {
    if (e.status === 401) return logout();
    if (seriePantallaVigente(serie)) app.innerHTML = `<div class="error">${esc(e.error || t("dicom.error"))}</div>`;
    return;
  }
  if (!seriePantallaVigente(serie)) return;
  pintarBandejaDicom(entrantes);
}

function pintarBandejaDicom(entrantes) {
  const opcionesPacientes = (bandejaPacientes || [])
    .map(p => `<option value="${p._id}">${esc(p.nombre)}${p.codigo ? ` · ${esc(p.codigo)}` : ""}</option>`)
    .join("");

  app.innerHTML = `
    <button class="back" id="bdBack">${t("dicom.volver")}</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("dicom.titulo")}</div>
      <div class="hint">
        ${t("dicom.explicacion")}
      </div>
    </div>

    ${entrantes.length === 0 ? `
      <div class="empty">
        ${t("dicom.vacia")}
      </div>` : entrantes.map(e => `
      <div class="card" data-entrante="${e._id}">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <img data-previa="${e._id}" alt="" style="width:92px;height:92px;object-fit:cover;border-radius:8px;background:var(--bg);flex:none">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(e.nombre || e.modalidad || t("dicom.estudio"))}</div>
            <div class="paciente-info">
              ${e.pacienteDicom ? t("dicom.llegoComo", { nombre: esc(e.pacienteDicom) }) : t("dicom.sinNombre")}
              ${e.codigoDicom ? t("dicom.codigo", { codigo: esc(e.codigoDicom) }) : ""}
            </div>
            <div class="fecha">
              ${new Date(e.fecha).toLocaleString(localeActual())}
              ${e.modalidad ? ` · ${esc(e.modalidad)}` : ""}${e.tamano ? ` · ${esc(e.tamano)}` : ""}
              ${e.equipo ? ` · ${esc(e.equipo)}` : ""}
            </div>
            ${e.conMilimetros
              ? `<div class="fecha" style="color:var(--success)">${t("dicom.conEscala")}</div>`
              : `<div class="fecha" style="color:var(--warning)">${t("dicom.sinEscala")}</div>`}
          </div>
        </div>

        <label style="margin-top:10px">${t("dicom.deQuien")}</label>
        <select data-paciente-de="${e._id}">
          <option value="">${t("dicom.elegirPaciente")}</option>
          ${opcionesPacientes}
        </select>
        <input type="text" data-nombre-de="${e._id}" value="${esc(e.nombre || "")}" placeholder="${t("dicom.nombrePlaceholder")}">
        <div data-err-de="${e._id}"></div>
        <div style="display:flex;gap:8px">
          <button class="secondary" data-asignar="${e._id}" style="flex:1">${t("dicom.guardar")}</button>
          <button class="link" data-descartar="${e._id}" style="width:auto;color:var(--danger)">${t("dicom.descartar")}</button>
        </div>
      </div>`).join("")}`;

  document.getElementById("bdBack").onclick = () => renderDashboard();

  // Las previas viajan con Authorization por cabecera, así que no se pueden
  // poner como src directo: van como blob local.
  entrantes.forEach(async (e) => {
    const el = document.querySelector(`[data-previa="${e._id}"]`);
    if (!el) return;
    try {
      const r = await fetch(`${API}/medico/dicom/bandeja/${e._id}/imagen`, { headers: { Authorization: "Bearer " + TOKEN } });
      if (!r.ok) return;
      const blob = await r.blob();
      if (el.isConnected) el.src = URL.createObjectURL(blob);
    } catch { /* si una miniatura no carga, el resto sigue andando */ }
  });

  document.querySelectorAll("[data-asignar]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.asignar;
      const pacienteId = document.querySelector(`[data-paciente-de="${id}"]`).value;
      const caja = document.querySelector(`[data-err-de="${id}"]`);
      if (!pacienteId) {
        caja.innerHTML = `<div class="error">${t("dicom.errSinPaciente")}</div>`;
        return;
      }
      btn.disabled = true;
      btn.textContent = t("dicom.guardando");
      try {
        await api(`/medico/dicom/bandeja/${id}/asignar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pacienteId, nombre: document.querySelector(`[data-nombre-de="${id}"]`).value.trim() }),
        });
        renderBandejaDicom();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = t("dicom.guardar");
        caja.innerHTML = `<div class="error">${esc(e.error || t("dicom.errAsignar"))}</div>`;
      }
    };
  });

  document.querySelectorAll("[data-descartar]").forEach(btn => {
    btn.onclick = async () => {
      // Descartar borra la vista previa de Vitalis. El DICOM original sigue
      // en la caja de la clínica, así que no se pierde el estudio — pero
      // conviene decirlo, porque desde acá parece que se borra todo.
      if (!confirm(t("dicom.confirmarDescartar"))) return;
      btn.disabled = true;
      try {
        await api(`/medico/dicom/bandeja/${btn.dataset.descartar}`, { method: "DELETE" });
        renderBandejaDicom();
      } catch (e) {
        btn.disabled = false;
        alert(e.error || t("dicom.errDescartar"));
      }
    };
  });
}
