// Vitalis — Centro de Estudios: laboratorios, radiografías, ecografías,
// tomografías, resonancias, ECG y fotos clínicas, todos ligados al paciente.
//
// Las fotos clínicas (cirugía plástica, dermatología) suman dos cosas más:
// una guía en cámara para repetir siempre el mismo ángulo (frontal, perfil,
// 3/4), y un comparador de antes/después con slider entre dos fechas del
// mismo ángulo.

const TIPOS_ESTUDIO = {
  laboratorio: "🧪 Laboratorio",
  radiografia: "🦴 Radiografía",
  ecografia: "🔊 Ecografía",
  tomografia: "🌀 Tomografía",
  resonancia: "🧲 Resonancia",
  ecg: "💓 ECG",
  foto: "📷 Foto clínica",
  otro: "📄 Otro",
};
// Vitalis Visión: tipos de estudio propios de oftalmología, se suman a la
// lista general solo para esa especialidad.
const TIPOS_ESTUDIO_OFTALMOLOGIA = {
  oct: "🩻 OCT",
  fondo_ojo: "👁️ Fondo de ojo",
  campimetria: "🗺️ Campimetría",
  biometria: "📏 Biometría",
};
function tiposEstudioActivos() {
  return MEDICO_TIPO_ESPECIALIDAD === "oftalmologia" ? { ...TIPOS_ESTUDIO, ...TIPOS_ESTUDIO_OFTALMOLOGIA } : TIPOS_ESTUDIO;
}
const LADOS_OJO = { OD: "Ojo derecho (OD)", OI: "Ojo izquierdo (OI)", ambos: "Ambos ojos" };

// Odontología/medicina general: 3 ángulos alcanza. Vitalis Face (estética/
// plástica/dermatología) usa 5, para un seguimiento más fino de un
// procedimiento (nariz, mentón, etc.) — ver angulosFotoActivos().
const ANGULOS_FOTO_3 = {
  frontal: "Frontal",
  perfil: "Perfil",
  tres_cuartos: "3/4",
};
const ANGULOS_FOTO_5 = {
  frontal: "Frontal",
  angulo45_derecha: "45° derecha",
  perfil_derecho: "Perfil derecho",
  angulo45_izquierda: "45° izquierda",
  perfil_izquierdo: "Perfil izquierdo",
};
const ANGULOS_FOTO_TODOS = { ...ANGULOS_FOTO_3, ...ANGULOS_FOTO_5 };
function angulosFotoActivos() { return MEDICO_TIPO_ESPECIALIDAD === "estetica" ? ANGULOS_FOTO_5 : ANGULOS_FOTO_3; }

function tabEstudiosHtml(estudios) {
  const hayFotos = estudios.some(e => e.tipo === "foto" && e.anguloFoto);
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Subir estudio</div>
      <select id="estTipo">
        ${Object.entries(tiposEstudioActivos()).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}
      </select>
      <input id="estNombre" type="text" placeholder="Título (ej: Hemograma completo)" style="margin-top:8px">
      <label>Fecha</label>
      <input id="estFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">

      ${MEDICO_TIPO_ESPECIALIDAD === "oftalmologia" ? `
        <label>Ojo</label>
        <div class="chip-row" id="estLadoOjoChips">
          ${Object.entries(LADOS_OJO).map(([k, l]) => `<button type="button" class="chip" data-lado-ojo="${k}">${l}</button>`).join("")}
        </div>
      ` : ""}

      <div id="estAnguloBox" style="display:none;margin-top:8px">
        <label>Ángulo de la foto</label>
        <div class="chip-row" id="estAnguloChips">
          ${Object.entries(angulosFotoActivos()).map(([k, l]) => `<button type="button" class="chip" data-angulo="${k}">${l}</button>`).join("")}
        </div>
        <button type="button" class="secondary" id="btnFotoGuiada" style="margin-top:6px">📸 Tomar foto guiada</button>
      </div>

      <label class="file-label" for="estArchivo" style="margin-top:10px">📎 Elegir imagen o PDF</label>
      <input type="file" id="estArchivo" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style="display:none">
      <div id="estArchivoNombre" class="hint"></div>
      <div id="estErr"></div>
      <button class="secondary" id="btnSubirEstudio">⬆️ Subir</button>
    </div>
    ${hayFotos ? `<button class="secondary" id="btnCompararFotos">🔀 Comparar antes / después</button>` : ""}
    ${estudios.length === 0 ? `<div class="empty">Todavía no hay estudios cargados.</div>` : ""}
    ${estudios.map(e => `
      <div class="item" data-ver-estudio="${e._id}">
        <div class="top">
          <div class="nombre">${esc(tiposEstudioActivos()[e.tipo] || TIPOS_ESTUDIO_OFTALMOLOGIA[e.tipo] || e.tipo)}${e.anguloFoto ? " · " + esc(ANGULOS_FOTO_TODOS[e.anguloFoto] || e.anguloFoto) : ""}${e.ladoOjo ? " · " + esc(LADOS_OJO[e.ladoOjo] || e.ladoOjo) : ""} — ${esc(e.nombre)}</div>
          <button class="link" data-borrar-estudio="${e._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">${new Date(e.fecha).toLocaleDateString("es-BO")}</div>
        ${e.notas ? `<div class="paciente-info">📝 ${esc(e.notas)}</div>` : ""}
        ${MEDICO_TIPO_ESPECIALIDAD === "estetica" && e.tipo === "foto" && e.anguloFoto === "frontal" ? `
        <button class="item-action" data-mapa-facial="${e._id}" style="margin-top:10px">🧭 Ver mapa anatómico y simetría</button>` : ""}
      </div>`).join("")}
  `;
}

function wireTabEstudios(p, estudios) {
  let archivoSeleccionado = null;
  let anguloElegido = null;
  let ladoOjoElegido = null;
  const inputArchivo = document.getElementById("estArchivo");
  const nombreArchivoEl = document.getElementById("estArchivoNombre");
  const tipoSelect = document.getElementById("estTipo");
  const anguloBox = document.getElementById("estAnguloBox");

  function actualizarVisibilidadAngulo() {
    anguloBox.style.display = tipoSelect.value === "foto" ? "block" : "none";
  }
  tipoSelect.onchange = actualizarVisibilidadAngulo;
  actualizarVisibilidadAngulo();

  document.querySelectorAll("#estAnguloChips [data-angulo]").forEach(btn => {
    btn.onclick = () => {
      anguloElegido = btn.dataset.angulo;
      document.querySelectorAll("#estAnguloChips [data-angulo]").forEach(b => b.classList.toggle("activo", b === btn));
    };
  });

  document.querySelectorAll("#estLadoOjoChips [data-lado-ojo]").forEach(btn => {
    btn.onclick = () => {
      ladoOjoElegido = btn.dataset.ladoOjo;
      document.querySelectorAll("#estLadoOjoChips [data-lado-ojo]").forEach(b => b.classList.toggle("activo", b === btn));
    };
  });

  function setArchivoSeleccionado(file, nombreVisible) {
    archivoSeleccionado = file;
    nombreArchivoEl.textContent = file ? "Archivo: " + (nombreVisible || file.name) : "";
  }

  inputArchivo.onchange = (e) => setArchivoSeleccionado(e.target.files[0] || null);

  const btnFotoGuiada = document.getElementById("btnFotoGuiada");
  if (btnFotoGuiada) {
    btnFotoGuiada.onclick = () => {
      abrirCamaraGuiada(anguloElegido, (blob, angulo) => {
        setArchivoSeleccionado(new File([blob], "foto-" + angulo + ".jpg", { type: "image/jpeg" }), "foto tomada ahora");
        if (!document.getElementById("estNombre").value.trim()) {
          document.getElementById("estNombre").value = "Foto clínica — " + (ANGULOS_FOTO_TODOS[angulo] || angulo);
        }
      });
    };
  }

  const btnSubir = document.getElementById("btnSubirEstudio");
  btnSubir.onclick = async () => {
    const errBox = document.getElementById("estErr");
    errBox.innerHTML = "";
    const nombre = document.getElementById("estNombre").value.trim();
    const fecha = document.getElementById("estFecha").value;
    const tipo = tipoSelect.value;
    if (!nombre || !fecha) { errBox.innerHTML = `<div class="error">Título y fecha son obligatorios</div>`; return; }
    if (!archivoSeleccionado) { errBox.innerHTML = `<div class="error">Elegí una imagen o PDF</div>`; return; }
    if (tipo === "foto" && !anguloElegido) { errBox.innerHTML = `<div class="error">Elegí el ángulo de la foto</div>`; return; }

    btnSubir.disabled = true;
    btnSubir.textContent = "Subiendo...";
    try {
      let qs = "?tipo=" + encodeURIComponent(tipo) + "&nombre=" + encodeURIComponent(nombre) + "&fecha=" + encodeURIComponent(fecha);
      if (tipo === "foto" && anguloElegido) qs += "&anguloFoto=" + encodeURIComponent(anguloElegido);
      if (ladoOjoElegido) qs += "&ladoOjo=" + encodeURIComponent(ladoOjoElegido);
      await api("/medico/pacientes/" + p._id + "/estudios" + qs, {
        method: "POST",
        headers: { "Content-Type": archivoSeleccionado.type || "application/octet-stream" },
        body: archivoSeleccionado,
      });
      renderPacienteDetalle(p._id, "estudios");
    } catch (e) {
      btnSubir.disabled = false;
      btnSubir.textContent = "⬆️ Subir";
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo subir el archivo")}</div>`;
    }
  };

  document.querySelectorAll("[data-ver-estudio]").forEach(el => {
    el.onclick = () => abrirArchivoEstudio(el.dataset.verEstudio);
  });
  document.querySelectorAll("[data-mapa-facial]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const blob = await traerBlobEstudio(btn.dataset.mapaFacial);
      if (!blob) { alert("No se pudo cargar la foto"); return; }
      abrirAnalisisFacial(blob);
    };
  });
  document.querySelectorAll("[data-borrar-estudio]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("¿Eliminar este estudio?")) return;
      await api("/medico/estudios/" + btn.dataset.borrarEstudio, { method: "DELETE" });
      renderPacienteDetalle(p._id, "estudios");
    };
  });

  const btnComparar = document.getElementById("btnCompararFotos");
  if (btnComparar) {
    btnComparar.onclick = () => abrirComparadorFotos(estudios.filter(e => e.tipo === "foto" && e.anguloFoto));
  }
}

// El archivo puede ser grande y va con Authorization por header (no por URL),
// así que se trae como blob y se abre en una pestaña nueva en vez de un <a href>.
async function abrirArchivoEstudio(id) {
  try {
    const blob = await traerBlobEstudio(id);
    if (!blob) { alert("No se pudo abrir el archivo"); return; }
    window.open(URL.createObjectURL(blob), "_blank");
  } catch (e) {
    alert("No se pudo abrir el archivo");
  }
}

async function traerBlobEstudio(id) {
  const headers = {};
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const res = await fetch(API + "/medico/estudios/" + id + "/archivo", { headers });
  if (!res.ok) return null;
  return await res.blob();
}

// ─── CÁMARA GUIADA ───────────────────────────────────────────────────────
// Overlay de pantalla completa (fuera de #app, para no perder el formulario
// de abajo) con un dibujo guía según el ángulo elegido, para que la foto de
// hoy quede alineada igual que la de la próxima visita.
function guiaSvgPara(angulo) {
  // "perfil_izquierdo" / "angulo45_izquierda" reusan el mismo dibujo que su
  // versión derecha, solo espejado — así no hay que dibujar cada guía dos veces.
  const espejado = angulo.includes("izquierd");
  let interior;
  if (angulo.startsWith("perfil")) {
    interior = `
      <path d="M 190 90 Q 230 100 232 150 Q 234 180 250 195 Q 235 205 232 215 Q 236 235 220 245 Q 224 260 205 268 L 195 300 Q 190 330 180 350 L 130 350 L 130 90 Z"
            fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 5" opacity="0.85"/>
      <line x1="0" y1="170" x2="300" y2="170" stroke="#fff" stroke-width="1" stroke-dasharray="3 6" opacity="0.5"/>`;
  } else if (angulo.startsWith("angulo45") || angulo === "tres_cuartos") {
    interior = `
      <ellipse cx="160" cy="190" rx="95" ry="130" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 5" opacity="0.85"/>
      <line x1="0" y1="170" x2="300" y2="170" stroke="#fff" stroke-width="1" stroke-dasharray="3 6" opacity="0.5"/>
      <line x1="185" y1="70" x2="185" y2="310" stroke="#fff" stroke-width="1" stroke-dasharray="3 6" opacity="0.4"/>`;
  } else {
    // frontal (default)
    interior = `
      <ellipse cx="150" cy="190" rx="90" ry="130" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 5" opacity="0.85"/>
      <line x1="0" y1="170" x2="300" y2="170" stroke="#fff" stroke-width="1" stroke-dasharray="3 6" opacity="0.5"/>
      <line x1="150" y1="60" x2="150" y2="320" stroke="#fff" stroke-width="1" stroke-dasharray="3 6" opacity="0.4"/>`;
  }
  const grupo = espejado ? `<g transform="scale(-1,1) translate(-300,0)">${interior}</g>` : interior;
  return `<svg viewBox="0 0 300 400" width="100%" height="100%" style="position:absolute;inset:0;pointer-events:none">${grupo}</svg>`;
}

async function abrirCamaraGuiada(anguloInicial, onCapturada) {
  let angulo = anguloInicial || "frontal";
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:#000;z-index:999;display:flex;flex-direction:column;";
  overlay.innerHTML = `
    <div style="flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center">
      <video id="camVideo" autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>
      <div id="camGuia" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${guiaSvgPara(angulo)}</div>
      <div class="hint" style="position:absolute;top:10px;left:0;right:0;text-align:center;color:#fff;text-shadow:0 1px 3px #000">Alineá la cara con la guía</div>
    </div>
    <div style="padding:14px;background:#111">
      <div class="chip-row" id="camAnguloChips" style="justify-content:center;margin-bottom:10px">
        ${Object.entries(angulosFotoActivos()).map(([k, l]) => `<button type="button" class="chip ${k === angulo ? "activo" : ""}" data-cam-angulo="${k}">${l}</button>`).join("")}
      </div>
      <div style="display:flex;gap:10px">
        <button class="secondary" id="btnCamCancelar" style="flex:1">Cancelar</button>
        <button class="primary" id="btnCamCapturar" style="flex:1">📸 Capturar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const video = overlay.querySelector("#camVideo");
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = stream;
  } catch (e) {
    overlay.remove();
    alert("No se pudo acceder a la cámara. Podés elegir un archivo con el botón de abajo en su lugar.");
    return;
  }

  function cerrar() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    overlay.remove();
  }

  overlay.querySelectorAll("[data-cam-angulo]").forEach(btn => {
    btn.onclick = () => {
      angulo = btn.dataset.camAngulo;
      overlay.querySelectorAll("[data-cam-angulo]").forEach(b => b.classList.toggle("activo", b === btn));
      overlay.querySelector("#camGuia").innerHTML = guiaSvgPara(angulo);
    };
  });
  overlay.querySelector("#btnCamCancelar").onclick = cerrar;
  overlay.querySelector("#btnCamCapturar").onclick = () => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      cerrar();
      if (blob) onCapturada(blob, angulo);
    }, "image/jpeg", 0.92);
  };
}

// ─── COMPARADOR ANTES / DESPUÉS ──────────────────────────────────────────
async function abrirComparadorFotos(fotos) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:var(--bg);z-index:999;overflow-y:auto;padding:16px;";
  const porAngulo = {};
  fotos.forEach(f => (porAngulo[f.anguloFoto] = porAngulo[f.anguloFoto] || []).push(f));
  const angulosDisponibles = Object.keys(porAngulo);
  let anguloElegido = angulosDisponibles[0];

  function opcionesFecha(lista) {
    return lista
      .slice()
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map(f => `<option value="${f._id}">${new Date(f.fecha).toLocaleDateString("es-BO")} — ${esc(f.nombre)}</option>`)
      .join("");
  }

  function pintar() {
    const lista = porAngulo[anguloElegido] || [];
    overlay.innerHTML = `
      <button class="back" id="cmpVolver">← Volver</button>
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">🔀 Comparar antes / después</div>
        <div class="chip-row">
          ${angulosDisponibles.map(a => `<button type="button" class="chip ${a === anguloElegido ? "activo" : ""}" data-cmp-angulo="${a}">${ANGULOS_FOTO_TODOS[a] || a}</button>`).join("")}
        </div>
        <div style="display:flex;gap:10px;margin-top:10px">
          <div style="flex:1"><label>Antes</label><select id="cmpAntes">${opcionesFecha(lista)}</select></div>
          <div style="flex:1"><label>Después</label><select id="cmpDespues">${opcionesFecha(lista)}</select></div>
        </div>
        ${lista.length < 2 ? `<div class="hint" style="margin-top:8px">Necesitás al menos 2 fotos de este mismo ángulo para comparar.</div>` : `<div id="cmpSliderBox" style="margin-top:14px"></div>`}
      </div>`;
    overlay.querySelector("#cmpVolver").onclick = () => overlay.remove();
    overlay.querySelectorAll("[data-cmp-angulo]").forEach(btn => {
      btn.onclick = () => { anguloElegido = btn.dataset.cmpAngulo; pintar(); };
    });
    if (lista.length >= 2) {
      const selAntes = overlay.querySelector("#cmpAntes");
      const selDespues = overlay.querySelector("#cmpDespues");
      selDespues.selectedIndex = lista.length - 1; // por defecto: la más vieja vs. la más nueva
      const actualizar = () => pintarSlider(overlay.querySelector("#cmpSliderBox"), lista, selAntes.value, selDespues.value);
      selAntes.onchange = actualizar;
      selDespues.onchange = actualizar;
      actualizar();
    }
  }
  pintar();
  document.body.appendChild(overlay);
}

async function pintarSlider(box, lista, idAntes, idDespues) {
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando fotos...</div>`;
  const antes = lista.find(f => f._id === idAntes);
  const despues = lista.find(f => f._id === idDespues);
  const [blobAntes, blobDespues] = await Promise.all([traerBlobEstudio(idAntes), traerBlobEstudio(idDespues)]);
  if (!blobAntes || !blobDespues) { box.innerHTML = `<div class="error">No se pudieron cargar las fotos</div>`; return; }
  const urlAntes = URL.createObjectURL(blobAntes);
  const urlDespues = URL.createObjectURL(blobDespues);

  box.innerHTML = `
    <div id="sliderCont" style="position:relative;width:100%;aspect-ratio:3/4;max-height:70vh;border-radius:12px;overflow:hidden;touch-action:none;user-select:none;cursor:ew-resize">
      <img src="${urlAntes}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
      <div id="sliderTop" style="position:absolute;inset:0;width:100%;height:100%;overflow:hidden;clip-path:inset(0 50% 0 0)">
        <img src="${urlDespues}" style="width:100%;height:100%;object-fit:cover">
      </div>
      <div id="sliderHandle" style="position:absolute;top:0;bottom:0;left:50%;width:3px;background:#fff;box-shadow:0 0 6px rgba(0,0,0,.5);transform:translateX(-50%)"></div>
      <div style="position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.55);color:#fff;padding:4px 10px;border-radius:6px;font-size:12px">Antes · ${new Date(antes.fecha).toLocaleDateString("es-BO")}</div>
      <div style="position:absolute;right:10px;bottom:10px;background:rgba(0,0,0,.55);color:#fff;padding:4px 10px;border-radius:6px;font-size:12px">Después · ${new Date(despues.fecha).toLocaleDateString("es-BO")}</div>
    </div>`;

  const cont = box.querySelector("#sliderCont");
  const top = box.querySelector("#sliderTop");
  const handle = box.querySelector("#sliderHandle");
  function mover(clientX) {
    const rect = cont.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    top.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    handle.style.left = pct + "%";
  }
  let arrastrando = false;
  cont.onpointerdown = (e) => { arrastrando = true; mover(e.clientX); };
  window.addEventListener("pointermove", (e) => { if (arrastrando) mover(e.clientX); });
  window.addEventListener("pointerup", () => { arrastrando = false; });
}
