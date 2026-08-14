// Vitalis Visión — Mapa ocular: diagrama 2D (corte esquemático, no 3D — la
// vuelta 3D queda pendiente hasta tener un modelo con licencia y estructuras
// separadas, mismo criterio que se usó para el odontograma). Cada ojo (OD/OI)
// se dibuja aparte, con sus 12 estructuras clickeables y su propio timeline.

const ESTADOS_ESTRUCTURA_INFO = {
  normal:     { label: "Normal",              icono: "🟢", color: "#15803d" },
  leve:       { label: "Alteración leve",     icono: "🟡", color: "#ca8a04" },
  moderado:   { label: "Alteración moderada", icono: "🟠", color: "#c2410c" },
  importante: { label: "Alteración importante", icono: "🔴", color: "#b91c1c" },
};

const ESTRUCTURAS_OCULARES_INFO = {
  cornea:            "Córnea",
  iris:              "Iris",
  pupila:            "Pupila",
  cristalino:        "Cristalino",
  esclerotica:       "Esclerótica",
  conjuntiva:        "Conjuntiva",
  camara_anterior:   "Cámara anterior",
  retina:            "Retina",
  macula:            "Mácula",
  nervio_optico:     "Nervio óptico",
  vasos_sanguineos:  "Vasos sanguíneos",
  vitreo:            "Vítreo",
};
const ORDEN_ESTRUCTURAS = Object.keys(ESTRUCTURAS_OCULARES_INFO);

async function renderTabExamenOcular(pacienteId) {
  const box = document.getElementById("examenOcularBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando mapa ocular...</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/examen-ocular`);
    pintarExamenOcular(pacienteId, data.examen);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar el mapa ocular")}</div>`;
  }
}

// Diagrama de corte esquemático de UN ojo (frente a la izquierda, fondo del
// ojo a la derecha). porEstructura: { [estructura]: item }.
function ojoSvgHtml(ojo, porEstructura) {
  const color = (estructura) => (ESTADOS_ESTRUCTURA_INFO[porEstructura[estructura]?.estado || "normal"] || ESTADOS_ESTRUCTURA_INFO.normal).color;
  const g = (estructura, contenido) => `<g class="estructura-ocular" data-ojo="${ojo}" data-estructura="${estructura}" style="cursor:pointer">${contenido}</g>`;

  return `
    <svg viewBox="0 0 300 220" style="width:100%;max-width:320px;height:auto">
      ${g("esclerotica", `<circle cx="175" cy="110" r="78" fill="${color("esclerotica")}" fill-opacity="0.18" stroke="${color("esclerotica")}" stroke-width="3"/>`)}
      ${g("vitreo", `<circle cx="185" cy="110" r="60" fill="${color("vitreo")}" fill-opacity="0.15" stroke="${color("vitreo")}" stroke-width="2"/>`)}
      ${g("retina", `<path d="M 207 52 A 76 76 0 0 1 207 168" fill="none" stroke="${color("retina")}" stroke-width="11" stroke-linecap="round"/>`)}
      ${g("vasos_sanguineos", `
        <path d="M 240 110 L 216 82" stroke="${color("vasos_sanguineos")}" stroke-width="2" fill="none"/>
        <path d="M 240 110 L 216 138" stroke="${color("vasos_sanguineos")}" stroke-width="2" fill="none"/>
        <path d="M 240 110 L 228 68" stroke="${color("vasos_sanguineos")}" stroke-width="2" fill="none"/>
        <path d="M 240 110 L 228 152" stroke="${color("vasos_sanguineos")}" stroke-width="2" fill="none"/>`)}
      ${g("macula", `<circle cx="246" cy="110" r="7" fill="${color("macula")}"/>`)}
      ${g("nervio_optico", `<path d="M 251 98 L 276 90 L 276 130 L 251 122 Z" fill="${color("nervio_optico")}" fill-opacity="0.7" stroke="${color("nervio_optico")}" stroke-width="2"/>`)}
      ${g("camara_anterior", `<ellipse cx="108" cy="110" rx="20" ry="42" fill="${color("camara_anterior")}" fill-opacity="0.18" stroke="${color("camara_anterior")}" stroke-width="1.5" stroke-dasharray="3 3"/>`)}
      ${g("cristalino", `<ellipse cx="130" cy="110" rx="13" ry="32" fill="${color("cristalino")}" fill-opacity="0.55" stroke="${color("cristalino")}" stroke-width="2"/>`)}
      ${g("iris", `<circle cx="108" cy="110" r="27" fill="none" stroke="${color("iris")}" stroke-width="15"/>`)}
      ${g("pupila", `<circle cx="108" cy="110" r="10" fill="${color("pupila")}"/>`)}
      ${g("cornea", `<path d="M 96 58 Q 52 110 96 162" fill="#dff5ff" fill-opacity="0.3" stroke="${color("cornea")}" stroke-width="3"/>`)}
      ${g("conjuntiva", `<path d="M 98 46 A 78 78 0 0 0 62 78" fill="none" stroke="${color("conjuntiva")}" stroke-width="3" stroke-linecap="round"/>`)}
    </svg>`;
}

function pintarExamenOcular(pacienteId, examen) {
  const box = document.getElementById("examenOcularBox");
  if (!box) return;

  const porOjo = { OD: {}, OI: {} };
  examen.estructuras.forEach(e => { porOjo[e.ojo][e.estructura] = e; });

  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="seccion-titulo" style="margin-top:0;text-align:left">👁️ Mapa ocular</div>
      <div class="hint" style="text-align:left;margin-bottom:10px">Tocá cualquier estructura para ver el detalle y el historial. Lo que se marca "🎙️ por voz" viene de una consulta grabada — revisalo y corregilo si hace falta.</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:center">
        <div>
          <div style="font-weight:700;margin-bottom:6px">OD — Ojo derecho</div>
          ${ojoSvgHtml("OD", porOjo.OD)}
        </div>
        <div>
          <div style="font-weight:700;margin-bottom:6px">OI — Ojo izquierdo</div>
          ${ojoSvgHtml("OI", porOjo.OI)}
        </div>
      </div>
      <div class="odonto-leyenda">
        ${Object.entries(ESTADOS_ESTRUCTURA_INFO).map(([k, v]) => `
          <span class="odonto-leyenda-item"><i style="background:${v.color};border:1px solid ${v.color}"></i>${v.icono} ${v.label}</span>`).join("")}
      </div>
    </div>
    <div id="estructuraDetalleBox"></div>`;

  document.querySelectorAll(".estructura-ocular").forEach(g => {
    g.onclick = () => pintarDetalleEstructura(pacienteId, g.dataset.ojo, porOjo[g.dataset.ojo][g.dataset.estructura]);
  });
}

function pintarDetalleEstructura(pacienteId, ojo, item) {
  const box = document.getElementById("estructuraDetalleBox");
  const nombreEstructura = ESTRUCTURAS_OCULARES_INFO[item.estructura] || item.estructura;
  const nombreOjo = ojo === "OD" ? "Ojo derecho (OD)" : "Ojo izquierdo (OI)";

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${esc(nombreEstructura)} — ${esc(nombreOjo)}</div>
      <label>Estado</label>
      <select id="estrEstado">
        ${Object.entries(ESTADOS_ESTRUCTURA_INFO).map(([k, v]) => `<option value="${k}" ${k === item.estado ? "selected" : ""}>${v.icono} ${v.label}</option>`).join("")}
      </select>
      <label>Notas / hallazgo</label>
      <textarea id="estrNotas" rows="2" placeholder="Detalle del hallazgo...">${esc(item.notas || "")}</textarea>
      <div id="estrErr"></div>
      <button class="primary" id="btnGuardarEstructura">Guardar</button>

      ${item.historial?.length ? `
        <div class="seccion-titulo" style="margin-top:18px">Historial</div>
        <div class="odonto-timeline">
          ${[...item.historial].reverse().map(h => {
            const info = ESTADOS_ESTRUCTURA_INFO[h.estado] || ESTADOS_ESTRUCTURA_INFO.normal;
            return `
              <div class="odonto-timeline-item">
                <div class="odonto-timeline-icono" style="background:${info.color}">${info.icono}</div>
                <div class="odonto-timeline-contenido">
                  <div class="odonto-timeline-fecha">${new Date(h.fecha).toLocaleDateString("es-BO")}${h.fuente === "voz" ? " · 🎙️ por voz" : ""}</div>
                  <div class="odonto-timeline-titulo">${esc(info.label)}</div>
                  ${h.notas ? `<div class="odonto-timeline-notas">${esc(h.notas)}</div>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>
      ` : ""}
    </div>`;

  document.getElementById("btnGuardarEstructura").onclick = async () => {
    const errBox = document.getElementById("estrErr");
    errBox.innerHTML = "";
    const estado = document.getElementById("estrEstado").value;
    const notas = document.getElementById("estrNotas").value.trim();
    try {
      await api(`/medico/pacientes/${pacienteId}/examen-ocular/${ojo}/${item.estructura}`, {
        method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ estado, notas }),
      });
      renderTabExamenOcular(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };
}
