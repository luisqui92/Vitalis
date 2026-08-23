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
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando bandeja...</div>`;
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
    if (seriePantallaVigente(serie)) app.innerHTML = `<div class="error">${esc(e.error || "Error cargando la bandeja")}</div>`;
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
    <button class="back" id="bdBack">← Panel</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">📥 Estudios sin asignar</div>
      <div class="hint">
        Lo que llegó de la caja y todavía no sabemos de quién es. Si el técnico escribe
        el <b>código del paciente</b> en el equipo, el estudio se archiva solo y no pasa
        por acá.
      </div>
    </div>

    ${entrantes.length === 0 ? `
      <div class="empty">
        La bandeja está vacía — que es como tiene que estar.
      </div>` : entrantes.map(e => `
      <div class="card" data-entrante="${e._id}">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <img data-previa="${e._id}" alt="" style="width:92px;height:92px;object-fit:cover;border-radius:8px;background:var(--bg);flex:none">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(e.nombre || e.modalidad || "Estudio")}</div>
            <div class="paciente-info">
              ${e.pacienteDicom ? `Llegó como <b>${esc(e.pacienteDicom)}</b>` : "El equipo no mandó nombre"}
              ${e.codigoDicom ? ` · código ${esc(e.codigoDicom)}` : ""}
            </div>
            <div class="fecha">
              ${new Date(e.fecha).toLocaleString("es-BO")}
              ${e.modalidad ? ` · ${esc(e.modalidad)}` : ""}${e.tamano ? ` · ${esc(e.tamano)}` : ""}
              ${e.equipo ? ` · ${esc(e.equipo)}` : ""}
            </div>
            ${e.conMilimetros
              ? `<div class="fecha" style="color:var(--success)">Trae la escala del equipo — se mide en milímetros sin calibrar</div>`
              : `<div class="fecha" style="color:var(--warning)">Sin escala en el archivo — las medidas van en píxeles hasta calibrar</div>`}
          </div>
        </div>

        <label style="margin-top:10px">¿De quién es?</label>
        <select data-paciente-de="${e._id}">
          <option value="">Elegí el paciente…</option>
          ${opcionesPacientes}
        </select>
        <input type="text" data-nombre-de="${e._id}" value="${esc(e.nombre || "")}" placeholder="Nombre del estudio">
        <div data-err-de="${e._id}"></div>
        <div style="display:flex;gap:8px">
          <button class="secondary" data-asignar="${e._id}" style="flex:1">Guardar en la ficha</button>
          <button class="link" data-descartar="${e._id}" style="width:auto;color:var(--danger)">Descartar</button>
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
        caja.innerHTML = `<div class="error">Elegí a qué paciente va antes de guardarlo.</div>`;
        return;
      }
      btn.disabled = true;
      btn.textContent = "Guardando...";
      try {
        await api(`/medico/dicom/bandeja/${id}/asignar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pacienteId, nombre: document.querySelector(`[data-nombre-de="${id}"]`).value.trim() }),
        });
        renderBandejaDicom();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Guardar en la ficha";
        caja.innerHTML = `<div class="error">${esc(e.error || "No se pudo asignar")}</div>`;
      }
    };
  });

  document.querySelectorAll("[data-descartar]").forEach(btn => {
    btn.onclick = async () => {
      // Descartar borra la vista previa de Vitalis. El DICOM original sigue
      // en la caja de la clínica, así que no se pierde el estudio — pero
      // conviene decirlo, porque desde acá parece que se borra todo.
      if (!confirm("Se saca de la bandeja y se borra la vista previa.\n\nEl estudio original sigue guardado en la caja de la clínica.\n\n¿Descartar?")) return;
      btn.disabled = true;
      try {
        await api(`/medico/dicom/bandeja/${btn.dataset.descartar}`, { method: "DELETE" });
        renderBandejaDicom();
      } catch (e) {
        btn.disabled = false;
        alert(e.error || "No se pudo descartar");
      }
    };
  });
}
