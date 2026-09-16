// Symphomed Obstetricia — control de embarazo: FUM/FPP y semanas de
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

// Tamaño del bebé comparado con algo cotidiano: es la forma en que las
// pacientes realmente entienden "estás de 20 semanas", y la que usan las
// guías de control prenatal para explicarlo en consulta.
const REFERENCIAS_FETALES = [
  { hasta: 6,  emoji: "🫘", fruta: "una lenteja",       medida: "4 mm" },
  { hasta: 8,  emoji: "🫐", fruta: "un arándano",       medida: "1,5 cm" },
  { hasta: 10, emoji: "🍓", fruta: "una frutilla",      medida: "3 cm" },
  { hasta: 12, emoji: "🍋", fruta: "un limón",          medida: "5 cm" },
  { hasta: 16, emoji: "🥑", fruta: "una palta",         medida: "11 cm · 100 g" },
  { hasta: 20, emoji: "🍌", fruta: "un plátano",        medida: "25 cm · 300 g" },
  { hasta: 24, emoji: "🌽", fruta: "un choclo",         medida: "30 cm · 600 g" },
  { hasta: 28, emoji: "🍆", fruta: "una berenjena",     medida: "37 cm · 1 kg" },
  { hasta: 32, emoji: "🥥", fruta: "un coco",           medida: "42 cm · 1,7 kg" },
  { hasta: 36, emoji: "🍈", fruta: "un melón",          medida: "47 cm · 2,6 kg" },
  { hasta: 99, emoji: "🎃", fruta: "una sandía chica",  medida: "50 cm · 3,3 kg" },
];
function referenciaFetal(semanas) {
  return REFERENCIAS_FETALES.find(r => semanas <= r.hasta) || REFERENCIAS_FETALES[REFERENCIAS_FETALES.length - 1];
}

// Silueta de perfil cuya panza crece con las semanas. No es una ecografía
// ni pretende serlo: es la referencia visual de en qué momento del embarazo
// está la paciente, que se lee de un vistazo mejor que un número.
function siluetaEmbarazoSvg(semanas) {
  // Hasta la semana 8 casi no se nota; de ahí crece hasta el término. La
  // panza se dibuja como un círculo propio que crece sobre un torso fijo:
  // es mucho más predecible que deformar el contorno del cuerpo, y se lee
  // igual de bien en 12 semanas que en 40.
  const avance = Math.min(1, Math.max(0, (semanas - 8) / 32));
  const rPanza = 16 + avance * 22;
  // El borde de atrás queda fijo contra la espalda y la panza crece SOLO
  // hacia adelante — si se centra sobre el torso, a término se ve como una
  // pelota alrededor del cuerpo en vez de un vientre.
  const cxPanza = 74 + rPanza;
  const cyPanza = 116;
  const rBebe = 4 + avance * 11;

  return `
    <svg viewBox="0 0 190 220" style="width:100%;max-width:170px;height:auto;margin:8px auto 0;display:block" aria-label="Silueta del embarazo a las ${semanas} semanas">
      <g fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-opacity="0.5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <!-- cabeza y cuello, pegados al torso -->
        <circle cx="86" cy="26" r="15"/>
        <path d="M 80 40 L 80 50 L 92 50 L 92 40 Z" stroke="none" fill-opacity="0.18"/>
        <!-- torso de perfil, mirando a la derecha -->
        <path d="M 86 46
                 C 72 50, 66 64, 68 82
                 C 70 108, 66 150, 64 196
                 L 86 196
                 C 88 158, 90 130, 92 108
                 C 96 88, 98 62, 92 46 Z"/>
        <!-- brazo, apoyado sobre la panza -->
        <path d="M 92 62 C 108 70, ${cxPanza + rPanza * 0.6} ${cyPanza - rPanza * 0.7}, ${cxPanza + rPanza * 0.2} ${cyPanza + rPanza * 0.55}"
              fill="none" stroke-opacity="0.4"/>
      </g>
      <!-- la panza: crece con las semanas -->
      <circle cx="${cxPanza}" cy="${cyPanza}" r="${rPanza}"
              fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-opacity="0.55" stroke-width="2"/>
      <!-- el bebé adentro -->
      <circle cx="${cxPanza + 2}" cy="${cyPanza}" r="${rBebe}" fill="var(--primary)" fill-opacity="0.9"/>
    </svg>`;
}

// Barra de las 40 semanas con los tres trimestres marcados.
function barraProgresoEmbarazo(semanas) {
  const pct = Math.min(100, (semanas / 40) * 100);
  return `
    <div style="margin:12px 0 6px">
      <div style="position:relative;height:9px;border-radius:5px;background:var(--border);overflow:hidden">
        <div style="position:absolute;inset:0 auto 0 0;width:${pct}%;background:var(--primary);border-radius:5px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text-muted);margin-top:4px">
        <span>0s</span><span>13s</span><span>27s</span><span>40s</span>
      </div>
    </div>`;
}

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
      previewEl.textContent = `FPP estimada: ${fpp.toLocaleDateString(localeActual())} · Semanas actuales: ${semanas} (${trimestreDe(semanas)})`;
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
  const faltan = Math.max(0, Math.ceil((new Date(activo.fpp).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000)));
  const ref = referenciaFetal(semanas);
  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="hint" style="text-align:left">${trimestreDe(semanas)}</div>
      <div style="font-size:38px;font-weight:700;margin:6px 0">${semanas}<span style="font-size:18px;font-weight:600">s ${dias}d</span></div>
      <div class="hint">semanas de gestación</div>
      ${siluetaEmbarazoSvg(semanas)}
      <div class="hint" style="margin-top:6px">
        ${ref.emoji} Del tamaño de ${ref.fruta} · ~${ref.medida}
      </div>
      ${barraProgresoEmbarazo(semanas)}
      <div class="hint">${faltan > 0 ? `Faltan unas ${faltan} semana${faltan === 1 ? "" : "s"} para la fecha probable de parto` : "Ya llegó a la fecha probable de parto"}</div>
      <div style="display:flex;justify-content:space-around;margin-top:16px;text-align:left">
        <div><div class="hint">FUM</div><div style="font-weight:600">${fechaCorta(activo.fum)}</div></div>
        <div><div class="hint">FPP</div><div style="font-weight:600">${fechaCorta(activo.fpp)}</div></div>
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
        <div class="fecha">FUM ${fechaCorta(h.fum)} · Finalizó ${h.fechaFin ? fechaCorta(h.fechaFin) : "—"}</div>
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
