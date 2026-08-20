// Vitalis Vet — Mapa corporal: se toca la silueta donde está la lesión y
// queda una marca, con su historial de controles (descripción, tamaño y
// foto por fecha) para ver si crece o cede.
//
// A diferencia del odontograma, acá la marca va donde caiga y no sobre una
// pieza predefinida: una lesión está en un punto, no en "el dorso" entero.
// Pero cada marca se autoetiqueta con la región anatómica en la que cayó,
// así el dato tiene además un nombre clínico con el que buscar y dictar.

const ESTADOS_LESION_INFO = {
  activa:         { label: "Activa",          color: "#c0392b" },
  en_tratamiento: { label: "En tratamiento",  color: "#c9944f" },
  resuelta:       { label: "Resuelta",        color: "#4a7d54" },
};

const REGIONES_CORPORALES_INFO = {
  hocico: "Hocico", cabeza: "Cabeza", cuello: "Cuello", dorso: "Dorso",
  torax: "Tórax", abdomen: "Abdomen", grupa: "Grupa", cola: "Cola",
  miembro_anterior: "Miembro anterior", miembro_posterior: "Miembro posterior",
  otra: "Otra zona",
};

// Regiones como rectángulos sobre el lienzo de 400x260 de la silueta, en
// porcentaje. Gana la primera que contiene al punto, así que el orden
// importa: las zonas chicas y específicas van antes que las grandes.
const REGIONES_MAPA = [
  { id: "hocico",           x: 6,  y: 34, w: 11, h: 14 },
  { id: "cabeza",           x: 17, y: 18, w: 13, h: 29 },
  { id: "cuello",           x: 26, y: 33, w: 9,  h: 24 },
  { id: "miembro_anterior", x: 28, y: 56, w: 16, h: 36 },
  { id: "miembro_posterior",x: 63, y: 56, w: 18, h: 36 },
  { id: "cola",             x: 75, y: 13, w: 13, h: 24 },
  { id: "grupa",            x: 67, y: 28, w: 14, h: 34 },
  { id: "dorso",            x: 35, y: 29, w: 33, h: 13 },
  { id: "torax",            x: 35, y: 42, w: 17, h: 24 },
  { id: "abdomen",          x: 52, y: 42, w: 16, h: 24 },
];

function regionDePunto(x, y) {
  const r = REGIONES_MAPA.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return r ? r.id : "otra";
}

let mapaLadoActivo = "izquierdo";
let mapaLesionAbierta = null;

// Silueta de perro de perfil, compuesta por formas superpuestas con la
// opacidad aplicada al grupo entero — así los solapes no se marcan y el
// conjunto se lee como una sola silueta.
//
// Se pinta con el color de TEXTO, no con el de marca: --text siempre
// contrasta contra el fondo del tema (claro sobre oscuro y al revés),
// mientras que el verde de veterinaria sobre su propio fondo oscuro deja
// la silueta casi invisible.
function siluetaAnimalSvg() {
  return `
    <g fill="var(--text)" opacity="0.22">
      <ellipse cx="212" cy="122" rx="88" ry="42"/>
      <ellipse cx="150" cy="128" rx="44" ry="40"/>
      <ellipse cx="278" cy="118" rx="44" ry="43"/>
      <path d="M104 108 L150 92 L162 132 L120 146 Z"/>
      <ellipse cx="88" cy="96" rx="30" ry="25" transform="rotate(-12 88 96)"/>
      <path d="M64 96 C48 94, 34 98, 30 106 C27 113, 34 119, 46 119 L68 116 Z"/>
      <path d="M96 84 C86 78, 82 64, 92 56 C102 48, 114 55, 113 68 C112 79, 106 88, 98 90 Z"/>
      <path d="M312 96 C338 84, 352 62, 348 44 C347 39, 341 38, 338 43 C342 60, 330 76, 306 88 Z"/>
    </g>
    <!-- patas del lado opuesto: más tenues, se leen detrás -->
    <g fill="var(--text)" opacity="0.12">
      <path d="M158 148 C154 178, 150 206, 149 234 L163 234 C164 206, 168 178, 172 150 Z"/>
      <path d="M272 148 C278 172, 264 190, 261 208 C259 220, 260 228, 261 234 L275 234 C274 226, 273 219, 275 209 C278 190, 292 172, 286 148 Z"/>
    </g>
    <g fill="var(--text)" opacity="0.22">
      <path d="M128 150 C124 180, 121 208, 120 236 L136 236 C137 208, 140 180, 144 152 Z"/>
      <path d="M300 150 C307 176, 292 194, 289 212 C287 224, 288 231, 289 236 L305 236 C304 230, 303 222, 305 211 C308 192, 324 174, 316 148 Z"/>
    </g>
    <circle cx="82" cy="90" r="3.4" fill="var(--text)" opacity="0.5"/>
    <circle cx="33" cy="104" r="4" fill="var(--text)" opacity="0.5"/>`;
}

async function renderTabMapaCorporal(pacienteId) {
  const box = document.getElementById("mapaCorporalBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando mapa corporal...</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/mapa-corporal`);
    pintarMapaCorporal(pacienteId, data.mapa);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar el mapa corporal")}</div>`;
  }
}

function pintarMapaCorporal(pacienteId, mapa) {
  const box = document.getElementById("mapaCorporalBox");
  if (!box) return;

  const deEsteLado = mapa.lesiones.filter(l => l.lado === mapaLadoActivo);
  const activas = mapa.lesiones.filter(l => l.estado !== "resuelta").length;

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">🐾 Mapa corporal</div>
      <div class="hint" style="margin-bottom:10px">
        Tocá la silueta donde está la lesión para marcarla. Tocá una marca existente para ver su evolución.
      </div>

      <div class="tabs" style="grid-template-columns:repeat(2,1fr);margin-bottom:12px">
        <button class="tab ${mapaLadoActivo === "izquierdo" ? "activo" : ""}" data-lado="izquierdo">Lado izquierdo</button>
        <button class="tab ${mapaLadoActivo === "derecho" ? "activo" : ""}" data-lado="derecho">Lado derecho</button>
      </div>

      <svg id="mapaCorporalSvg" viewBox="0 0 400 260"
           style="width:100%;max-width:440px;height:auto;display:block;margin:0 auto;cursor:crosshair;touch-action:manipulation${mapaLadoActivo === "derecho" ? ";transform:scaleX(-1)" : ""}">
        ${siluetaAnimalSvg()}
        ${deEsteLado.map(l => {
          const info = ESTADOS_LESION_INFO[l.estado] || ESTADOS_LESION_INFO.activa;
          const cx = (l.x / 100) * 400, cy = (l.y / 100) * 260;
          return `
            <g class="lesion-marca" data-id="${l._id}" style="cursor:pointer">
              <circle cx="${cx}" cy="${cy}" r="11" fill="${info.color}" fill-opacity="0.22" stroke="${info.color}" stroke-width="2.5"/>
              <circle cx="${cx}" cy="${cy}" r="3.4" fill="${info.color}"/>
            </g>`;
        }).join("")}
      </svg>

      <div class="odonto-leyenda">
        ${Object.entries(ESTADOS_LESION_INFO).map(([k, v]) => `
          <span class="odonto-leyenda-item"><i style="background:${v.color};border:1px solid ${v.color}"></i>${v.label}</span>`).join("")}
      </div>
      <div class="hint" style="margin-top:8px">
        ${mapa.lesiones.length === 0
          ? "Sin lesiones marcadas."
          : `${mapa.lesiones.length} lesión(es) marcada(s) · ${activas} sin resolver`}
      </div>
    </div>
    <div id="lesionDetalleBox"></div>`;

  document.querySelectorAll("[data-lado]").forEach(btn => {
    btn.onclick = () => {
      mapaLadoActivo = btn.dataset.lado;
      mapaLesionAbierta = null;
      pintarMapaCorporal(pacienteId, mapa);
    };
  });

  document.querySelectorAll(".lesion-marca").forEach(g => {
    g.onclick = (e) => {
      e.stopPropagation();
      const lesion = mapa.lesiones.find(l => String(l._id) === g.dataset.id);
      pintarDetalleLesion(pacienteId, lesion);
    };
  });

  const svg = document.getElementById("mapaCorporalSvg");
  svg.onclick = (e) => {
    if (e.target.closest(".lesion-marca")) return;
    const caja = svg.getBoundingClientRect();
    // Con el lado derecho la silueta va espejada, así que la posición
    // horizontal hay que desespejarla antes de guardarla: el dato queda
    // siempre en el sistema de la silueta, no en el de la pantalla.
    let x = ((e.clientX - caja.left) / caja.width) * 100;
    if (mapaLadoActivo === "derecho") x = 100 - x;
    const y = ((e.clientY - caja.top) / caja.height) * 100;
    pintarFormularioLesion(pacienteId, x, y);
  };

  if (mapaLesionAbierta) {
    const l = mapa.lesiones.find(x => String(x._id) === mapaLesionAbierta);
    if (l) pintarDetalleLesion(pacienteId, l);
  }
}

function pintarFormularioLesion(pacienteId, x, y) {
  mapaLesionAbierta = null;
  const region = regionDePunto(x, y);
  const box = document.getElementById("lesionDetalleBox");
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Nueva lesión</div>
      <div class="hint" style="margin-bottom:10px">
        Zona detectada: <b>${esc(REGIONES_CORPORALES_INFO[region])}</b> · lado ${esc(mapaLadoActivo)}
      </div>
      <label>Qué es</label>
      <input id="lesTitulo" type="text" placeholder="Ej: nódulo, herida, zona de alopecia">
      <label>Descripción</label>
      <textarea id="lesDesc" rows="2" placeholder="Aspecto, color, si duele, desde cuándo..."></textarea>
      <div style="display:flex;gap:10px">
        <div style="flex:1">
          <label>Tamaño (cm)</label>
          <input id="lesTamano" type="number" step="0.1" min="0" placeholder="2.5">
        </div>
        <div style="flex:1">
          <label>Estado</label>
          <select id="lesEstado">
            ${Object.entries(ESTADOS_LESION_INFO).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}
          </select>
        </div>
      </div>
      <label class="file-label" for="lesFoto">📷 Agregar foto (opcional)</label>
      <input type="file" id="lesFoto" accept="image/*" style="display:none">
      <div class="hint" id="lesFotoNombre"></div>
      <div id="lesErr"></div>
      <button class="primary" id="btnGuardarLesion">Marcar lesión</button>
      <button class="link" id="btnCancelarLesion">Cancelar</button>
    </div>`;

  document.getElementById("lesFoto").onchange = (e) => {
    const f = e.target.files[0];
    document.getElementById("lesFotoNombre").textContent = f ? "Foto elegida: " + f.name : "";
  };
  document.getElementById("btnCancelarLesion").onclick = () => { box.innerHTML = ""; };

  document.getElementById("btnGuardarLesion").onclick = async () => {
    const errBox = document.getElementById("lesErr");
    const btn = document.getElementById("btnGuardarLesion");
    errBox.innerHTML = "";
    const titulo = document.getElementById("lesTitulo").value.trim();
    if (!titulo) { errBox.innerHTML = `<div class="error">Poné al menos qué es</div>`; return; }
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const estudioId = await subirFotoLesionSiHay(pacienteId, titulo);
      await api(`/medico/pacientes/${pacienteId}/mapa-corporal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x, y, lado: mapaLadoActivo, region, titulo,
          descripcion: document.getElementById("lesDesc").value.trim(),
          tamanoCm: document.getElementById("lesTamano").value,
          estado: document.getElementById("lesEstado").value,
          estudioId,
        }),
      });
      renderTabMapaCorporal(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
      btn.disabled = false;
      btn.textContent = "Marcar lesión";
    }
  };
}

// La foto se sube al Centro de Estudios y a la lesión solo se le enlaza el
// id — así las fotos clínicas viven todas en el mismo lugar, con el mismo
// control de acceso, en vez de tener un segundo camino de archivos.
async function subirFotoLesionSiHay(pacienteId, titulo) {
  const input = document.getElementById("lesFoto") || document.getElementById("ctrlFoto");
  const archivo = input?.files?.[0];
  if (!archivo) return null;
  // El Centro de Estudios exige nombre y fecha; sin la fecha responde 400.
  const hoy = new Date();
  const fecha = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const data = await api(`/medico/pacientes/${pacienteId}/estudios?tipo=foto&fecha=${fecha}&nombre=${encodeURIComponent("Lesión: " + titulo)}`, {
    method: "POST", headers: { "Content-Type": archivo.type }, body: archivo,
  });
  return data.estudio?._id || null;
}

function pintarDetalleLesion(pacienteId, lesion) {
  if (!lesion) return;
  mapaLesionAbierta = String(lesion._id);
  const box = document.getElementById("lesionDetalleBox");
  const info = ESTADOS_LESION_INFO[lesion.estado] || ESTADOS_LESION_INFO.activa;
  const historial = [...(lesion.historial || [])].reverse();

  // Si hay al menos dos controles con medida, se muestra cuánto cambió:
  // es la pregunta que el veterinario se hace mirando la lesión.
  const conMedida = (lesion.historial || []).filter(h => h.tamanoCm != null);
  let evolucion = "";
  if (conMedida.length >= 2) {
    const primero = conMedida[0], ultimo = conMedida[conMedida.length - 1];
    const delta = ultimo.tamanoCm - primero.tamanoCm;
    const signo = delta > 0 ? "+" : "";
    const color = delta === 0 ? "var(--text-muted)" : delta > 0 ? "#c0392b" : "#4a7d54";
    evolucion = `
      <div class="hint" style="margin:8px 0 0">
        Tamaño: ${primero.tamanoCm} cm (${new Date(primero.fecha).toLocaleDateString("es-BO")})
        → <b style="color:${color}">${ultimo.tamanoCm} cm</b> (${new Date(ultimo.fecha).toLocaleDateString("es-BO")})
        · <b style="color:${color}">${signo}${Math.round(delta * 10) / 10} cm</b>
      </div>`;
  }

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">
        ${esc(lesion.titulo || "Lesión")} · ${esc(REGIONES_CORPORALES_INFO[lesion.region] || lesion.region)}
      </div>
      <div class="hint">
        <span style="color:${info.color};font-weight:700">${info.label}</span> · lado ${esc(lesion.lado)}
      </div>
      ${evolucion}

      <div class="seccion-titulo" style="margin-top:16px">Agregar control</div>
      <textarea id="ctrlDesc" rows="2" placeholder="Cómo está hoy..."></textarea>
      <div style="display:flex;gap:10px">
        <div style="flex:1">
          <label>Tamaño (cm)</label>
          <input id="ctrlTamano" type="number" step="0.1" min="0">
        </div>
        <div style="flex:1">
          <label>Estado</label>
          <select id="ctrlEstado">
            ${Object.entries(ESTADOS_LESION_INFO).map(([k, v]) => `<option value="${k}" ${k === lesion.estado ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </div>
      </div>
      <label class="file-label" for="ctrlFoto">📷 Foto de este control (opcional)</label>
      <input type="file" id="ctrlFoto" accept="image/*" style="display:none">
      <div class="hint" id="ctrlFotoNombre"></div>
      <div id="ctrlErr"></div>
      <button class="secondary" id="btnGuardarControl">Guardar control</button>

      <div class="seccion-titulo" style="margin-top:18px">Evolución</div>
      <div class="odonto-timeline">
        ${historial.map(h => `
          <div class="odonto-timeline-item">
            <div class="odonto-timeline-icono" style="background:${(ESTADOS_LESION_INFO[h.estado] || info).color}">🐾</div>
            <div class="odonto-timeline-contenido">
              <div class="odonto-timeline-fecha">
                ${new Date(h.fecha).toLocaleDateString("es-BO")}${h.fuente === "voz" ? " · 🎙️ por voz" : ""}
              </div>
              <div class="odonto-timeline-titulo">
                ${esc((ESTADOS_LESION_INFO[h.estado] || info).label)}${h.tamanoCm != null ? ` · ${h.tamanoCm} cm` : ""}
              </div>
              ${h.descripcion ? `<div class="odonto-timeline-notas">${esc(h.descripcion)}</div>` : ""}
              ${h.estudioId ? `<button class="link" data-foto-lesion="${h.estudioId}" style="margin:4px 0 0;width:auto">📷 Ver foto</button>` : ""}
            </div>
          </div>`).join("")}
      </div>

      <button class="link" id="btnBorrarLesion" style="color:var(--danger);margin-top:10px">Eliminar esta lesión</button>
    </div>`;

  document.getElementById("ctrlFoto").onchange = (e) => {
    const f = e.target.files[0];
    document.getElementById("ctrlFotoNombre").textContent = f ? "Foto elegida: " + f.name : "";
  };

  document.getElementById("btnGuardarControl").onclick = async () => {
    const errBox = document.getElementById("ctrlErr");
    const btn = document.getElementById("btnGuardarControl");
    errBox.innerHTML = "";
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      const estudioId = await subirFotoLesionSiHay(pacienteId, lesion.titulo || "control");
      await api(`/medico/pacientes/${pacienteId}/mapa-corporal/${lesion._id}/control`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: document.getElementById("ctrlDesc").value.trim(),
          tamanoCm: document.getElementById("ctrlTamano").value,
          estado: document.getElementById("ctrlEstado").value,
          estudioId,
        }),
      });
      renderTabMapaCorporal(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
      btn.disabled = false;
      btn.textContent = "Guardar control";
    }
  };

  document.querySelectorAll("[data-foto-lesion]").forEach(btn => {
    btn.onclick = () => abrirArchivoEstudio(btn.dataset.fotoLesion);
  });

  document.getElementById("btnBorrarLesion").onclick = async () => {
    if (!confirm("¿Eliminar esta lesión y todo su historial?")) return;
    await api(`/medico/pacientes/${pacienteId}/mapa-corporal/${lesion._id}`, { method: "DELETE" });
    mapaLesionAbierta = null;
    renderTabMapaCorporal(pacienteId);
  };
}
