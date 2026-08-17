// Vitalis — Evolución Clínica: signos vitales del paciente en el tiempo
// (presión, glucosa, peso, saturación...) con gráfico de tendencia simple
// dibujado a mano en <canvas>, sin librerías externas.

const TIPOS_MEDICION = {
  presion:             { label: "Presión arterial", unidad: "mmHg", doble: true },
  glucosa:             { label: "Glucosa",           unidad: "mg/dL" },
  peso:                { label: "Peso",              unidad: "kg" },
  imc:                 { label: "IMC",               unidad: "" },
  saturacion:          { label: "Saturación O₂",     unidad: "%" },
  colesterol:          { label: "Colesterol",        unidad: "mg/dL" },
  temperatura:         { label: "Temperatura",       unidad: "°C" },
  frecuenciaCardiaca:  { label: "Frec. cardíaca",    unidad: "lpm" },
  // Vitalis Visión (oftalmología): presión intraocular por ojo — el
  // umbral de alerta (>21 mmHg, o tendencia en alza) es el estándar
  // clínico para sospecha de glaucoma.
  presionIntraocularOD: { label: "Presión intraocular OD", unidad: "mmHg", alertaUmbral: 21 },
  presionIntraocularOI: { label: "Presión intraocular OI", unidad: "mmHg", alertaUmbral: 21 },
  // Vitalis Obstetricia: controles prenatales, control a control.
  pesoMaterno:         { label: "Peso materno",       unidad: "kg" },
  alturaUterina:       { label: "Altura uterina",      unidad: "cm" },
  fcf:                 { label: "Frec. cardíaca fetal", unidad: "lpm" },
};

let evolucionTipoActivo = null;

function primerTipoConDatos(mediciones) {
  for (const key of Object.keys(TIPOS_MEDICION)) {
    if (mediciones.some(m => m.tipo === key)) return key;
  }
  return Object.keys(TIPOS_MEDICION)[0];
}

function puntosDe(mediciones, tipo) {
  return mediciones.filter(m => m.tipo === tipo).slice().sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

// ─── GRÁFICO DE TENDENCIA (línea simple, hasta 2 series para presión) ──
function dibujarGraficoEvolucion(canvas, puntos, doble) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (puntos.length === 0) return;

  const pad = 22;
  const valores = puntos.flatMap(p => p.valorSecundario != null ? [p.valor, p.valorSecundario] : [p.valor]);
  let min = Math.min(...valores), max = Math.max(...valores);
  if (min === max) { min -= 1; max += 1; }
  const margen = (max - min) * 0.18;
  min -= margen; max += margen;

  const x = i => pad + (puntos.length > 1 ? (i / (puntos.length - 1)) * (w - pad * 2) : (w - pad * 2) / 2);
  const y = v => h - pad - ((v - min) / (max - min)) * (h - pad * 2);

  ctx.strokeStyle = "#dbe6ea";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();

  function linea(color, getVal) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // getVal(p) puede dar null (ej: un registro viejo de presión sin la
    // diastólica cargada) — sin este chequeo, x/NaN cortaba el trazo en
    // silencio desde ese punto en vez de simplemente saltarlo.
    let enTrazo = false;
    puntos.forEach((p, i) => {
      const v = getVal(p);
      if (v == null) { enTrazo = false; return; }
      const px = x(i), py = y(v);
      if (!enTrazo) { ctx.moveTo(px, py); enTrazo = true; } else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = color;
    puntos.forEach((p, i) => {
      const v = getVal(p);
      if (v == null) return;
      ctx.beginPath();
      ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  linea("#0e7490", p => p.valor);
  if (doble) linea("#b45309", p => p.valorSecundario);
}

// Alerta simple de tendencia — no reemplaza el criterio del especialista,
// solo lo señala para que lo revise. Dos casos: el último valor ya pasó el
// umbral, o viene subiendo en las últimas 3 mediciones.
function calcularAlertaMedicion(puntos, tipo) {
  if (!tipo.alertaUmbral || puntos.length === 0) return null;
  const ultimo = puntos[puntos.length - 1];
  if (ultimo.valor > tipo.alertaUmbral) {
    return `Último valor (${ultimo.valor} ${tipo.unidad}) por encima de lo esperado (${tipo.alertaUmbral} ${tipo.unidad}).`;
  }
  if (puntos.length >= 3) {
    const ultimos3 = puntos.slice(-3);
    if (ultimos3[0].valor < ultimos3[1].valor && ultimos3[1].valor < ultimos3[2].valor) {
      return `Tendencia en alza en las últimas 3 mediciones: ${ultimos3.map(p => p.valor).join(" → ")} ${tipo.unidad}.`;
    }
  }
  return null;
}

// ─── HTML DE LA PESTAÑA ─────────────────────────────────────────────────
function tabEvolucionHtml(mediciones) {
  if (!evolucionTipoActivo || !TIPOS_MEDICION[evolucionTipoActivo]) evolucionTipoActivo = primerTipoConDatos(mediciones);
  const tipo = TIPOS_MEDICION[evolucionTipoActivo];
  const puntos = puntosDe(mediciones, evolucionTipoActivo);
  const alerta = calcularAlertaMedicion(puntos, tipo);

  const chips = Object.entries(TIPOS_MEDICION).map(([key, t]) => `
    <button class="chip ${key === evolucionTipoActivo ? "activo" : ""}" data-tipo-chip="${key}">${esc(t.label)}</button>
  `).join("");

  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Agregar medición</div>
      <select id="medTipo">
        ${Object.entries(TIPOS_MEDICION).map(([key, t]) => `<option value="${key}" ${key === evolucionTipoActivo ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
      </select>
      <input id="medValor" type="number" step="any" placeholder="${tipo.doble ? "Sistólica" : "Valor"}${tipo.unidad ? " (" + tipo.unidad + ")" : ""}" style="margin-top:8px">
      <input id="medValor2" type="number" step="any" placeholder="Diastólica (mmHg)" style="margin-top:8px;${tipo.doble ? "" : "display:none"}">
      <label>Fecha</label>
      <input id="medFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <button class="secondary" id="btnAgregarMedicion">➕ Agregar</button>
    </div>

    <div class="chip-row">${chips}</div>

    ${alerta ? `
      <div class="card" style="border-left:3px solid var(--warning)">
        <div style="font-weight:700;color:var(--warning)">⚠️ Evolución detectada</div>
        <div class="hint" style="margin-top:4px">${esc(alerta)} Revisar según criterio del especialista.</div>
      </div>` : ""}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${esc(tipo.label)}</div>
      ${puntos.length === 0
        ? `<div class="hint">Sin mediciones registradas todavía.</div>`
        : `<canvas id="evolucionCanvas" style="width:100%;height:150px;display:block"></canvas>
           ${tipo.doble ? `<div class="chart-legend"><span><i style="background:#0e7490"></i>Sistólica</span><span><i style="background:#b45309"></i>Diastólica</span></div>` : ""}`}
    </div>

    ${puntos.slice().reverse().map(p => `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${p.valorSecundario != null ? p.valor + "/" + p.valorSecundario : p.valor}${tipo.unidad ? " " + esc(tipo.unidad) : ""}</div>
          <button class="link" data-borrar-medicion="${p._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">${new Date(p.fecha).toLocaleDateString("es-BO")}</div>
        ${p.notas ? `<div class="paciente-info">📝 ${esc(p.notas)}</div>` : ""}
      </div>`).join("")}
  `;
}

// ─── WIRING (llamado después de pintar la pestaña) ──────────────────────
function wireTabEvolucion(p, mediciones) {
  const tipoSelect = document.getElementById("medTipo");
  const valor1Input = document.getElementById("medValor");
  const valor2Input = document.getElementById("medValor2");

  tipoSelect.onchange = () => {
    const t = TIPOS_MEDICION[tipoSelect.value];
    valor2Input.style.display = t.doble ? "block" : "none";
    valor1Input.placeholder = (t.doble ? "Sistólica" : "Valor") + (t.unidad ? " (" + t.unidad + ")" : "");
  };

  document.querySelectorAll("[data-tipo-chip]").forEach(btn => {
    btn.onclick = () => {
      evolucionTipoActivo = btn.dataset.tipoChip;
      document.getElementById("tabContent").innerHTML = tabEvolucionHtml(mediciones);
      wireTabEvolucion(p, mediciones);
    };
  });

  const canvas = document.getElementById("evolucionCanvas");
  if (canvas) {
    dibujarGraficoEvolucion(canvas, puntosDe(mediciones, evolucionTipoActivo), TIPOS_MEDICION[evolucionTipoActivo].doble);
  }

  document.getElementById("btnAgregarMedicion").onclick = async () => {
    const tipo = tipoSelect.value;
    const t = TIPOS_MEDICION[tipo];
    const valor = parseFloat(valor1Input.value);
    const valorSecundario = t.doble ? parseFloat(valor2Input.value) : null;
    const fecha = document.getElementById("medFecha").value;
    if (Number.isNaN(valor) || !fecha || (t.doble && Number.isNaN(valorSecundario))) return;
    try {
      await api("/medico/pacientes/" + p._id + "/mediciones", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ tipo, valor, valorSecundario, fecha }),
      });
      evolucionTipoActivo = tipo;
      renderPacienteDetalle(p._id, "evolucion");
    } catch (e) { /* se queda en la pantalla, el médico puede reintentar */ }
  };

  document.querySelectorAll("[data-borrar-medicion]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Eliminar esta medición?")) return;
      await api("/medico/mediciones/" + btn.dataset.borrarMedicion, { method: "DELETE" });
      renderPacienteDetalle(p._id, "evolucion");
    };
  });
}
