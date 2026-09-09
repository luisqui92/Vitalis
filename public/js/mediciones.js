// Symphomed — Evolución Clínica: signos vitales del paciente en el tiempo
// (presión, glucosa, peso, saturación...) con gráfico de tendencia simple
// dibujado a mano en <canvas>, sin librerías externas.

// La clave ("presion", "glucosa") es lo que se guarda en la base. La UNIDAD
// tampoco se traduce: mmHg, mg/dL y kg son las mismas en todos lados, y
// cambiarlas convertiría un número medido en otro. Lo único que cambia con
// el idioma es el nombre, y por eso sale de tiposMedicion() al llamar y no
// de una constante que se congelaría antes del login.
const MEDICIONES_META = {
  presion:             { unidad: "mmHg", doble: true },
  glucosa:             { unidad: "mg/dL" },
  peso:                { unidad: "kg" },
  imc:                 { unidad: "" },
  saturacion:          { unidad: "%" },
  colesterol:          { unidad: "mg/dL" },
  temperatura:         { unidad: "°C" },
  frecuenciaCardiaca:  { unidad: "lpm" },
  // Symphomed Visión (oftalmología): presión intraocular por ojo — el
  // umbral de alerta (>21 mmHg, o tendencia en alza) es el estándar
  // clínico para sospecha de glaucoma.
  presionIntraocularOD: { unidad: "mmHg", alertaUmbral: 21 },
  presionIntraocularOI: { unidad: "mmHg", alertaUmbral: 21 },
  // Symphomed Pediatría: van al gráfico normal de evolución como cualquier
  // otra medición, pero además son la materia prima de las curvas de
  // crecimiento (ver crecimiento.js), donde se leen contra la OMS.
  talla:               { unidad: "cm" },
  perimetroCefalico:   { unidad: "cm" },
  // Symphomed Obstetricia: controles prenatales, control a control.
  pesoMaterno:         { unidad: "kg" },
  alturaUterina:       { unidad: "cm" },
  fcf:                 { unidad: "lpm" },
};
function tiposMedicion() {
  const salida = {};
  for (const k of Object.keys(MEDICIONES_META)) salida[k] = { ...MEDICIONES_META[k], label: t("med." + k) };
  return salida;
}

let evolucionTipoActivo = null;

function primerTipoConDatos(mediciones) {
  for (const key of Object.keys(MEDICIONES_META)) {
    if (mediciones.some(m => m.tipo === key)) return key;
  }
  return Object.keys(MEDICIONES_META)[0];
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

  // Se devuelven las posiciones en pantalla de cada punto para poder saber
  // cuál se tocó y mostrar su valor (ver wireGraficoInteractivo).
  return puntos.map((p, i) => ({ punto: p, x: x(i) }));
}

// Al tocar el gráfico se resalta la medición más cercana y se muestra su
// valor y su fecha. En un celular no hay "hover", así que el mismo gesto
// (tocar) tiene que servir para leer el dato.
function wireGraficoInteractivo(canvas, posiciones, tipo) {
  const salida = document.getElementById("medicionTocada");
  if (!canvas || !salida || !posiciones?.length) return;

  function mostrarDesde(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    let mejor = posiciones[0], mejorDist = Infinity;
    for (const pos of posiciones) {
      const d = Math.abs(pos.x - x);
      if (d < mejorDist) { mejorDist = d; mejor = pos; }
    }
    const p = mejor.punto;
    const valor = p.valorSecundario != null ? `${p.valor}/${p.valorSecundario}` : p.valor;
    salida.innerHTML = `<b>${valor}${tipo.unidad ? " " + esc(tipo.unidad) : ""}</b> · ${new Date(p.fecha).toLocaleDateString(localeActual())}`;
  }

  canvas.onmousemove = (e) => mostrarDesde(e.clientX);
  canvas.ontouchstart = canvas.ontouchmove = (e) => {
    if (e.touches[0]) mostrarDesde(e.touches[0].clientX);
  };
  canvas.onmouseleave = () => { salida.innerHTML = ""; };
}

// "Antes pesaba X, ahora pesa Y": el dato que el médico busca de un vistazo
// y que hasta ahora había que sacar comparando dos filas de la lista.
function comparativaHtml(puntos, tipo) {
  if (puntos.length < 2) return "";
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const fmt = (p) => (p.valorSecundario != null ? `${p.valor}/${p.valorSecundario}` : `${p.valor}`);

  const delta = ultimo.valor - primero.valor;
  const deltaSec = ultimo.valorSecundario != null && primero.valorSecundario != null
    ? ultimo.valorSecundario - primero.valorSecundario : null;
  const signo = (n) => (n > 0 ? "+" : "") + Math.round(n * 10) / 10;
  // El color solo dice la DIRECCIÓN del cambio, no si es bueno o malo:
  // bajar de peso puede ser lo buscado o una alarma según el caso, y eso
  // lo juzga el médico, no la app.
  const color = delta === 0 ? "var(--text-muted)" : delta > 0 ? "#b45309" : "#0e7490";
  const flecha = delta === 0 ? "→" : delta > 0 ? "↑" : "↓";

  const meses = Math.max(1, Math.round((new Date(ultimo.fecha) - new Date(primero.fecha)) / (30 * 24 * 3600 * 1000)));

  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("evo.comoCambia")}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="text-align:center;flex:1">
          <div class="hint">${new Date(primero.fecha).toLocaleDateString(localeActual())}</div>
          <div style="font-size:22px;font-weight:700">${fmt(primero)}</div>
          <div class="hint">${t("evo.antes")}</div>
        </div>
        <div style="text-align:center;color:${color};font-weight:700;white-space:nowrap">
          <div style="font-size:20px">${flecha}</div>
          <div style="font-size:13px">${signo(delta)}${deltaSec != null ? "/" + signo(deltaSec) : ""}</div>
        </div>
        <div style="text-align:center;flex:1">
          <div class="hint">${new Date(ultimo.fecha).toLocaleDateString(localeActual())}</div>
          <div style="font-size:22px;font-weight:700;color:var(--primary)">${fmt(ultimo)}</div>
          <div class="hint">${t("evo.ahora")}</div>
        </div>
      </div>
      <div class="hint" style="text-align:center;margin-top:8px">
        ${t("evo.resumen", { n: puntos.length, meses, palabraMes: t(meses === 1 ? "evo.mes" : "evo.meses") })}${tipo.unidad ? " · " + esc(tipo.unidad) : ""}
      </div>
    </div>`;
}

// Alerta simple de tendencia — no reemplaza el criterio del especialista,
// solo lo señala para que lo revise. Dos casos: el último valor ya pasó el
// umbral, o viene subiendo en las últimas 3 mediciones.
function calcularAlertaMedicion(puntos, tipo) {
  if (!tipo.alertaUmbral || puntos.length === 0) return null;
  const ultimo = puntos[puntos.length - 1];
  if (ultimo.valor > tipo.alertaUmbral) {
    return t("evo.alertaUmbral", { valor: ultimo.valor, unidad: tipo.unidad, umbral: tipo.alertaUmbral });
  }
  if (puntos.length >= 3) {
    const ultimos3 = puntos.slice(-3);
    if (ultimos3[0].valor < ultimos3[1].valor && ultimos3[1].valor < ultimos3[2].valor) {
      return t("evo.alertaAlza", { valores: ultimos3.map(p => p.valor).join(" → "), unidad: tipo.unidad });
    }
  }
  return null;
}

// ─── HTML DE LA PESTAÑA ─────────────────────────────────────────────────
function tabEvolucionHtml(mediciones) {
  if (!evolucionTipoActivo || !MEDICIONES_META[evolucionTipoActivo]) evolucionTipoActivo = primerTipoConDatos(mediciones);
  const tipos = tiposMedicion();
  const tipo = tipos[evolucionTipoActivo];
  const puntos = puntosDe(mediciones, evolucionTipoActivo);
  const alerta = calcularAlertaMedicion(puntos, tipo);

  // "meta" y no "t": dentro de este map, "t" taparía la función de traducción.
  const chips = Object.entries(tipos).map(([key, meta]) => `
    <button class="chip ${key === evolucionTipoActivo ? "activo" : ""}" data-tipo-chip="${key}">${esc(meta.label)}</button>
  `).join("");

  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("evo.agregar")}</div>
      <select id="medTipo">
        ${Object.entries(tipos).map(([key, meta]) => `<option value="${key}" ${key === evolucionTipoActivo ? "selected" : ""}>${esc(meta.label)}</option>`).join("")}
      </select>
      <input id="medValor" type="number" step="any" placeholder="${t(tipo.doble ? "evo.sistolica" : "evo.valor")}${tipo.unidad ? " (" + tipo.unidad + ")" : ""}" style="margin-top:8px">
      <input id="medValor2" type="number" step="any" placeholder="${t("evo.diastolicaPlaceholder")}" style="margin-top:8px;${tipo.doble ? "" : "display:none"}">
      <label>${t("evo.fecha")}</label>
      <input id="medFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <button class="secondary" id="btnAgregarMedicion">${t("evo.btnAgregar")}</button>
    </div>

    <div class="chip-row">${chips}</div>

    ${alerta ? `
      <div class="card" style="border-left:3px solid var(--warning)">
        <div style="font-weight:700;color:var(--warning)">${t("evo.alertaTitulo")}</div>
        <div class="hint" style="margin-top:4px">${esc(alerta)}${t("evo.alertaPie")}</div>
      </div>` : ""}

    ${comparativaHtml(puntos, tipo)}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${esc(tipo.label)}</div>
      ${puntos.length === 0
        ? `<div class="hint">${t("evo.sinMediciones")}</div>`
        : `<canvas id="evolucionCanvas" style="width:100%;height:150px;display:block;touch-action:none"></canvas>
           <div id="medicionTocada" class="hint" style="text-align:center;min-height:18px;margin-top:4px"></div>
           <div class="hint" style="text-align:center;font-size:11px">${t("evo.tocarGrafico")}</div>
           ${tipo.doble ? `<div class="chart-legend"><span><i style="background:#0e7490"></i>${t("evo.legendaSistolica")}</span><span><i style="background:#b45309"></i>${t("evo.legendaDiastolica")}</span></div>` : ""}`}
    </div>

    ${puntos.slice().reverse().map(p => `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${p.valorSecundario != null ? p.valor + "/" + p.valorSecundario : p.valor}${tipo.unidad ? " " + esc(tipo.unidad) : ""}</div>
          <button class="link" data-borrar-medicion="${p._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">${new Date(p.fecha).toLocaleDateString(localeActual())}</div>
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
    const meta = MEDICIONES_META[tipoSelect.value];
    valor2Input.style.display = meta.doble ? "block" : "none";
    valor1Input.placeholder = t(meta.doble ? "evo.sistolica" : "evo.valor") + (meta.unidad ? " (" + meta.unidad + ")" : "");
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
    const tipoActual = tiposMedicion()[evolucionTipoActivo];
    const posiciones = dibujarGraficoEvolucion(canvas, puntosDe(mediciones, evolucionTipoActivo), tipoActual.doble);
    wireGraficoInteractivo(canvas, posiciones, tipoActual);
  }

  document.getElementById("btnAgregarMedicion").onclick = async () => {
    const tipo = tipoSelect.value;
    const meta = MEDICIONES_META[tipo];
    const valor = parseFloat(valor1Input.value);
    const valorSecundario = meta.doble ? parseFloat(valor2Input.value) : null;
    const fecha = document.getElementById("medFecha").value;
    if (Number.isNaN(valor) || !fecha || (meta.doble && Number.isNaN(valorSecundario))) return;
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
      if (!confirm(t("evo.confirmarBorrar"))) return;
      await api("/medico/mediciones/" + btn.dataset.borrarMedicion, { method: "DELETE" });
      renderPacienteDetalle(p._id, "evolucion");
    };
  });
}
