// Vitalis Odonto — Odontograma: grid FDI de 32 piezas, clickeable, con
// historial por pieza. (Dentición temporal queda para una próxima vuelta.)

const ESTADOS_PIEZA_INFO = {
  sano:                 { label: "Sano",                color: "#ffffff", texto: "#0f2733", borde: "#dbe6ea" },
  caries:                { label: "Caries",               color: "#b91c1c", texto: "#fff" },
  obturado:              { label: "Obturado",             color: "#2563eb", texto: "#fff" },
  corona:                { label: "Corona",                color: "#ca8a04", texto: "#fff" },
  endodoncia:            { label: "Endodoncia",           color: "#7c3aed", texto: "#fff" },
  extraccion_indicada:   { label: "Extracción indicada",  color: "#b45309", texto: "#fff" },
  ausente:               { label: "Ausente",              color: "#5b7480", texto: "#fff" },
  fractura:              { label: "Fractura",              color: "#7c2d12", texto: "#fff" },
  implante:              { label: "Implante",             color: "#15803d", texto: "#fff" },
  sellante:              { label: "Sellante",             color: "#06b6d4", texto: "#fff" },
};

const FILA_SUPERIOR = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const FILA_INFERIOR = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

async function renderTabOdontograma(pacienteId) {
  const box = document.getElementById("odontogramaBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando odontograma...</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/odontograma`);
    pintarOdontograma(pacienteId, data.odontograma);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar el odontograma")}</div>`;
  }
}

function piezaBtnHtml(pieza) {
  const info = ESTADOS_PIEZA_INFO[pieza.estado] || ESTADOS_PIEZA_INFO.sano;
  return `
    <button class="pieza-dental" data-numero="${pieza.numero}"
      style="background:${info.color};color:${info.texto};border-color:${info.borde || info.color}">
      ${pieza.numero}
    </button>`;
}

function pintarOdontograma(pacienteId, odontograma) {
  const box = document.getElementById("odontogramaBox");
  if (!box) return;
  const porNumero = {};
  odontograma.piezas.forEach(p => { porNumero[p.numero] = p; });

  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="seccion-titulo" style="margin-top:0;text-align:left">🦷 Odontograma</div>
      <div class="odonto-fila">${FILA_SUPERIOR.map(n => piezaBtnHtml(porNumero[n])).join("")}</div>
      <div class="odonto-fila" style="margin-top:6px">${FILA_INFERIOR.map(n => piezaBtnHtml(porNumero[n])).join("")}</div>
      <div class="odonto-leyenda">
        ${Object.entries(ESTADOS_PIEZA_INFO).map(([k, v]) => `
          <span class="odonto-leyenda-item"><i style="background:${v.color};border:1px solid ${v.borde || v.color}"></i>${v.label}</span>`).join("")}
      </div>
    </div>
    <div id="piezaDetalleBox"></div>`;

  document.querySelectorAll(".pieza-dental").forEach(btn => {
    btn.onclick = () => pintarDetallePieza(pacienteId, porNumero[Number(btn.dataset.numero)]);
  });
}

function pintarDetallePieza(pacienteId, pieza) {
  const box = document.getElementById("piezaDetalleBox");
  const info = ESTADOS_PIEZA_INFO[pieza.estado] || ESTADOS_PIEZA_INFO.sano;
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Pieza ${pieza.numero}</div>
      <label>Estado</label>
      <select id="piezaEstado">
        ${Object.entries(ESTADOS_PIEZA_INFO).map(([k, v]) => `<option value="${k}" ${k === pieza.estado ? "selected" : ""}>${v.label}</option>`).join("")}
      </select>
      <label>Notas</label>
      <textarea id="piezaNotas" rows="2" placeholder="Detalle del hallazgo o tratamiento...">${esc(pieza.notas || "")}</textarea>
      <div id="piezaErr"></div>
      <button class="primary" id="btnGuardarPieza">Guardar</button>

      ${pieza.historial?.length ? `
        <div class="seccion-titulo" style="margin-top:16px">Historial</div>
        ${[...pieza.historial].reverse().map(h => `
          <div class="item" style="cursor:default">
            <div class="top">
              <div class="nombre">${esc((ESTADOS_PIEZA_INFO[h.estado] || {}).label || h.estado)}</div>
              <div class="fecha">${new Date(h.fecha).toLocaleDateString("es-BO")}</div>
            </div>
            ${h.notas ? `<div class="preview">${esc(h.notas)}</div>` : ""}
          </div>`).join("")}
      ` : ""}
    </div>`;

  document.getElementById("btnGuardarPieza").onclick = async () => {
    const errBox = document.getElementById("piezaErr");
    errBox.innerHTML = "";
    const estado = document.getElementById("piezaEstado").value;
    const notas = document.getElementById("piezaNotas").value.trim();
    try {
      await api(`/medico/pacientes/${pacienteId}/odontograma/${pieza.numero}`, {
        method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ estado, notas }),
      });
      renderTabOdontograma(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };
}
