// Vitalis Odonto — Odontograma: arcada dibujada en SVG (2D, no 3D — ver
// conversación) con panel de detalle tipo timeline por pieza. (Dentición
// temporal queda para una próxima vuelta.)

const ESTADOS_PIEZA_INFO = {
  sano:                 { label: "Sano",                icono: "✅", color: "#ffffff", texto: "#0f2733", borde: "#c7d3da" },
  caries:                { label: "Caries",               icono: "🦠", color: "#b91c1c", texto: "#fff" },
  obturado:              { label: "Obturado",             icono: "🩹", color: "#2563eb", texto: "#fff" },
  corona:                { label: "Corona",                icono: "👑", color: "#ca8a04", texto: "#fff" },
  endodoncia:            { label: "Endodoncia",           icono: "💉", color: "#7c3aed", texto: "#fff" },
  extraccion_indicada:   { label: "Extracción indicada",  icono: "⚠️", color: "#b45309", texto: "#fff" },
  ausente:               { label: "Ausente",              icono: "❌", color: "#5b7480", texto: "#fff" },
  fractura:              { label: "Fractura",              icono: "💥", color: "#7c2d12", texto: "#fff" },
  implante:              { label: "Implante",             icono: "🔩", color: "#15803d", texto: "#fff" },
  sellante:              { label: "Sellante",             icono: "🛡️", color: "#06b6d4", texto: "#fff" },
};

const FILA_SUPERIOR = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const FILA_INFERIOR = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

// Distribuye N piezas a lo largo de medio óvalo — t de 180° a 0° (pasando
// por 90°) da un valle ∪ (arco superior: los incisivos al centro, abajo,
// cerca de la arcada inferior); invertido=true (t de 180° a 360°, pasando
// por 270°) da un domo ∩ (arco inferior, mismo criterio pero al revés).
function posicionesArco(n, cx, cy, rx, ry, invertido) {
  const tFin = invertido ? 360 : 0;
  const pos = [];
  for (let i = 0; i < n; i++) {
    const t = (180 + (tFin - 180) * (i / (n - 1))) * Math.PI / 180;
    pos.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return pos;
}

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

function piezaSvgHtml(pieza, pos) {
  const info = ESTADOS_PIEZA_INFO[pieza.estado] || ESTADOS_PIEZA_INFO.sano;
  const w = 24, h = 28;
  return `
    <g class="pieza-dental" data-numero="${pieza.numero}" transform="translate(${pos.x - w/2},${pos.y - h/2})" style="cursor:pointer">
      <rect width="${w}" height="${h}" rx="7" fill="${info.color}" stroke="${info.borde || info.color}" stroke-width="1.5"></rect>
      <text x="${w/2}" y="${h/2 + 4}" text-anchor="middle" font-size="9" font-weight="700" fill="${info.texto}">${pieza.numero}</text>
    </g>`;
}

function pintarOdontograma(pacienteId, odontograma) {
  const box = document.getElementById("odontogramaBox");
  if (!box) return;
  const porNumero = {};
  odontograma.piezas.forEach(p => { porNumero[p.numero] = p; });

  const W = 400, H = 260;
  const posSup = posicionesArco(16, W/2, 95, 175, 40, false);
  const posInf = posicionesArco(16, W/2, 205, 175, 40, true);

  const svgPiezas = [
    ...FILA_SUPERIOR.map((n, i) => piezaSvgHtml(porNumero[n], posSup[i])),
    ...FILA_INFERIOR.map((n, i) => piezaSvgHtml(porNumero[n], posInf[i])),
  ].join("");

  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="seccion-titulo" style="margin-top:0;text-align:left">🦷 Odontograma</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;height:auto">${svgPiezas}</svg>
      <div class="odonto-leyenda">
        ${Object.entries(ESTADOS_PIEZA_INFO).map(([k, v]) => `
          <span class="odonto-leyenda-item"><i style="background:${v.color};border:1px solid ${v.borde || v.color}"></i>${v.label}</span>`).join("")}
      </div>
    </div>
    <div id="piezaDetalleBox"></div>`;

  document.querySelectorAll(".pieza-dental").forEach(g => {
    g.onclick = () => pintarDetallePieza(pacienteId, porNumero[Number(g.dataset.numero)]);
  });
}

function pintarDetallePieza(pacienteId, pieza) {
  const box = document.getElementById("piezaDetalleBox");
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Pieza ${pieza.numero}</div>
      <label>Estado</label>
      <select id="piezaEstado">
        ${Object.entries(ESTADOS_PIEZA_INFO).map(([k, v]) => `<option value="${k}" ${k === pieza.estado ? "selected" : ""}>${v.icono} ${v.label}</option>`).join("")}
      </select>
      <label>Notas</label>
      <textarea id="piezaNotas" rows="2" placeholder="Detalle del hallazgo o tratamiento...">${esc(pieza.notas || "")}</textarea>
      <div id="piezaErr"></div>
      <button class="primary" id="btnGuardarPieza">Guardar</button>

      ${pieza.historial?.length ? `
        <div class="seccion-titulo" style="margin-top:18px">Historial de la pieza</div>
        <div class="odonto-timeline">
          ${[...pieza.historial].reverse().map(h => {
            const info = ESTADOS_PIEZA_INFO[h.estado] || ESTADOS_PIEZA_INFO.sano;
            return `
              <div class="odonto-timeline-item">
                <div class="odonto-timeline-icono" style="background:${info.color}">${info.icono}</div>
                <div class="odonto-timeline-contenido">
                  <div class="odonto-timeline-fecha">${new Date(h.fecha).toLocaleDateString("es-BO")}</div>
                  <div class="odonto-timeline-titulo">${esc(info.label)}</div>
                  ${h.notas ? `<div class="odonto-timeline-notas">${esc(h.notas)}</div>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>
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
