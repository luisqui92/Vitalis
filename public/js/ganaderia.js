// Symphomed Ganadería — lotes de producción animal (bovino, porcino,
// avícola). Mismo patrón que agenda.js: pinta en `app`, listo para
// escritorio.js y rutas.js sin que ninguna de las dos sepa que esto existe.

const ESPECIES_GANADO = ["bovino", "porcino", "avicola"];
const TIPOS_EVENTO_GANADO = ["mortalidad", "vacunacion", "tratamiento", "pesaje"];

// Se mantiene entre pantallas: volver del detalle de un lote no reinicia el
// filtro que el médico ya había elegido — mismo criterio que
// diaAgendaElegido en agenda.js.
// Los íconos de ICONOS son SVG sin tamaño propio: toman el ancho del
// contenedor. Adentro de una pestaña los achica .tab-icono; suelto en un
// título, ocupaba la tarjeta entera. Por eso va envuelto a su medida.
function iconoPata() {
  return `<span aria-hidden="true" style="display:inline-block;width:18px;height:18px;vertical-align:-3px;margin-right:6px">${ICONOS.pata}</span>`;
}

let ganaderiaFiltro = "activo";
// "" = todas las fincas. Mismo criterio que el filtro de estado: sobrevive
// a entrar y salir del detalle de un lote.
let ganaderiaFincaFiltro = "";

async function renderGanaderia() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("ganaderia.cargando")}</div>`;
  try {
    const params = new URLSearchParams();
    if (ganaderiaFiltro !== "todos") params.set("estado", ganaderiaFiltro);
    if (ganaderiaFincaFiltro) params.set("fincaId", ganaderiaFincaFiltro);
    const query = params.toString() ? `?${params}` : "";
    const [dataLotes, dataFincas] = await Promise.all([
      api(`/medico/lotes${query}`),
      api("/medico/fincas"),
    ]);
    const fincas = dataFincas.fincas || [];
    // La finca elegida pudo dejar de existir (o ser de otra sesión vieja):
    // se vuelve a "todas" en vez de mostrar una lista vacía sin explicación.
    if (ganaderiaFincaFiltro && !fincas.some(f => f._id === ganaderiaFincaFiltro)) {
      ganaderiaFincaFiltro = "";
      return renderGanaderia();
    }
    pintarGanaderia(dataLotes.lotes || [], fincas);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.error"))}</div>`;
  }
}

function opcionesFinca(fincas, elegida) {
  return `<option value="">${t("ganaderia.finca.sinFinca")}</option>` +
    fincas.map(f => `<option value="${f._id}"${f._id === elegida ? " selected" : ""}>${esc(f.nombre)}</option>`).join("");
}

function fincaItemHtml(f) {
  const dueno = [f.duenoNombre, f.duenoTelefono].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="item" style="cursor:default">
      <div class="top">
        <div class="nombre">${esc(f.nombre)} <span class="hint">(${esc(f.codigo)})</span></div>
        <button class="link" data-editar-finca="${f._id}" style="margin:0;width:auto">${t("ganaderia.finca.editar")}</button>
      </div>
      <div class="paciente-info">${dueno ? `${t("ganaderia.finca.dueno")}: ${dueno}` : `<span class="hint">${t("ganaderia.finca.sinDueno")}</span>`}</div>
      <div class="paciente-info">${t("ganaderia.finca.lotesActivos", { n: f.lotesActivos || 0 })}${f.ubicacion ? ` · ${esc(f.ubicacion)}` : ""}</div>
    </div>`;
}

// El mismo formulario sirve para crear y para editar: con "finca" viene
// relleno y guarda con PATCH.
function fincaFormHtml(finca) {
  const v = finca || {};
  return `
    <label>${t("ganaderia.finca.nombre")}</label>
    <input id="fincaNombre" type="text" value="${esc(v.nombre || "")}" placeholder="${t("ganaderia.finca.nombrePlaceholder")}">
    <label>${t("ganaderia.finca.ubicacion")}</label>
    <input id="fincaUbicacion" type="text" value="${esc(v.ubicacion || "")}">
    <label>${t("ganaderia.finca.duenoNombre")}</label>
    <input id="fincaDuenoNombre" type="text" value="${esc(v.duenoNombre || "")}">
    <label>${t("ganaderia.finca.duenoTelefono")}</label>
    <input id="fincaDuenoTelefono" type="tel" value="${esc(v.duenoTelefono || "")}">
    <div class="hint">${t("ganaderia.finca.duenoAyuda")}</div>
    <div id="fincaErr"></div>
    <button class="secondary" id="btnGuardarFinca" data-finca-id="${v._id || ""}">${t("ganaderia.finca.guardar")}</button>`;
}

function pintarGanaderia(lotes, fincas) {
  app.innerHTML = `
    <button class="back" id="btnBack">${t("ganaderia.volver")}</button>

    <div class="card">
      <div class="top" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="seccion-titulo" style="margin:0">${t("ganaderia.finca.titulo")}</div>
        <button class="link" id="btnNuevaFinca" style="margin:0;width:auto">➕ ${t("ganaderia.finca.nueva")}</button>
      </div>
      <div id="fincaFormBox" style="display:none;margin-top:10px"></div>
      ${fincas.length === 0 ? `<div class="hint" style="margin-top:8px">${t("ganaderia.finca.vacio")}</div>` : fincas.map(fincaItemHtml).join("")}
    </div>

    <button class="secondary" id="btnNuevoLote" style="margin-top:12px">➕ ${t("ganaderia.nuevoLote")}</button>

    <div id="loteFormBox" style="display:none;margin-top:12px" class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.nuevoLote")}</div>
      <label>${t("ganaderia.finca.label")}</label>
      <select id="loteFinca">${opcionesFinca(fincas, ganaderiaFincaFiltro)}</select>
      <label>${t("ganaderia.form.especie")}</label>
      <select id="loteEspecie">
        ${ESPECIES_GANADO.map(e => `<option value="${e}">${t("ganaderia.especie." + e)}</option>`).join("")}
      </select>
      <label>${t("ganaderia.form.nombre")}</label>
      <input id="loteNombre" type="text" placeholder="${t("ganaderia.form.nombrePlaceholder")}">
      <label>${t("ganaderia.form.cantidadInicial")}</label>
      <input id="loteCantidad" type="number" min="1" step="1">
      <label>${t("ganaderia.form.fechaIngreso")}</label>
      <input id="loteFecha" type="date">
      <label>${t("ganaderia.form.proposito")}</label>
      <input id="loteProposito" type="text" placeholder="${t("ganaderia.form.propositoPlaceholder")}">
      <label>${t("ganaderia.form.ubicacion")}</label>
      <input id="loteUbicacion" type="text" placeholder="${t("ganaderia.form.ubicacionPlaceholder")}">
      <div id="loteErr"></div>
      <button class="secondary" id="btnGuardarLote">${t("ganaderia.form.guardar")}</button>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="chip-row">
        ${["activo", "cerrado", "todos"].map(f => `
          <button type="button" class="chip${ganaderiaFiltro === f ? " activo" : ""}" data-filtro="${f}">${t("ganaderia.filtro." + f)}</button>
        `).join("")}
      </div>
      ${fincas.length ? `
        <select id="filtroFinca" style="margin-top:8px">
          <option value="">${t("ganaderia.finca.todas")}</option>
          ${fincas.map(f => `<option value="${f._id}"${f._id === ganaderiaFincaFiltro ? " selected" : ""}>${esc(f.nombre)}</option>`).join("")}
        </select>` : ""}
      ${lotes.length === 0 ? `<div class="empty">${t("ganaderia.vacio")}</div>` : lotes.map(l => `
        <div class="item" data-lote="${l._id}" style="cursor:pointer">
          <div class="top">
            <div class="nombre">${iconoPata()}${esc(l.nombre)} <span class="hint">(${esc(l.codigo)})</span></div>
          </div>
          <div class="paciente-info">${t("ganaderia.especie." + l.especie)} · ${t("ganaderia.item.cantidad", { actual: l.cantidadActual, inicial: l.cantidadInicial })}${l.fincaNombre ? ` · ${esc(l.fincaNombre)}` : ""}</div>
        </div>`).join("")}
    </div>
  `;

  document.getElementById("btnBack").onclick = renderDashboard;
  document.getElementById("btnNuevoLote").onclick = () => {
    const box = document.getElementById("loteFormBox");
    box.style.display = box.style.display === "none" ? "block" : "none";
  };
  document.querySelectorAll("[data-filtro]").forEach(btn => {
    btn.onclick = () => { ganaderiaFiltro = btn.dataset.filtro; renderGanaderia(); };
  });
  const filtroFinca = document.getElementById("filtroFinca");
  if (filtroFinca) filtroFinca.onchange = () => { ganaderiaFincaFiltro = filtroFinca.value; renderGanaderia(); };

  const abrirFormFinca = (finca) => {
    const box = document.getElementById("fincaFormBox");
    const mismo = box.style.display !== "none" && box.dataset.fincaId === (finca?._id || "");
    if (mismo) { box.style.display = "none"; return; }
    box.dataset.fincaId = finca?._id || "";
    box.innerHTML = fincaFormHtml(finca);
    box.style.display = "block";
    document.getElementById("btnGuardarFinca").onclick = async () => {
      const errBox = document.getElementById("fincaErr");
      errBox.innerHTML = "";
      const nombre = document.getElementById("fincaNombre").value.trim();
      if (!nombre) { errBox.innerHTML = `<div class="error">${t("ganaderia.finca.errNombre")}</div>`; return; }
      const cuerpo = {
        nombre,
        ubicacion: document.getElementById("fincaUbicacion").value.trim(),
        duenoNombre: document.getElementById("fincaDuenoNombre").value.trim(),
        duenoTelefono: document.getElementById("fincaDuenoTelefono").value.trim(),
      };
      try {
        await api(finca ? `/medico/fincas/${finca._id}` : "/medico/fincas", {
          method: finca ? "PATCH" : "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(cuerpo),
        });
        renderGanaderia();
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.finca.errGuardar"))}</div>`;
      }
    };
  };
  document.getElementById("btnNuevaFinca").onclick = () => abrirFormFinca(null);
  document.querySelectorAll("[data-editar-finca]").forEach(btn => {
    btn.onclick = () => abrirFormFinca(fincas.find(f => f._id === btn.dataset.editarFinca));
  });
  document.querySelectorAll("[data-lote]").forEach(item => {
    item.onclick = () => renderLoteDetalle(item.dataset.lote);
  });

  document.getElementById("btnGuardarLote").onclick = async () => {
    const errBox = document.getElementById("loteErr");
    errBox.innerHTML = "";
    const nombre = document.getElementById("loteNombre").value.trim();
    const cantidadInicial = document.getElementById("loteCantidad").value;
    const fechaIngreso = document.getElementById("loteFecha").value;
    if (!nombre || !cantidadInicial || !fechaIngreso) {
      errBox.innerHTML = `<div class="error">${t("ganaderia.form.errFaltanDatos")}</div>`;
      return;
    }
    try {
      await api("/medico/lotes", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          especie: document.getElementById("loteEspecie").value,
          fincaId: document.getElementById("loteFinca").value || null,
          nombre, cantidadInicial, fechaIngreso,
          proposito: document.getElementById("loteProposito").value.trim(),
          ubicacion: document.getElementById("loteUbicacion").value.trim(),
        }),
      });
      renderGanaderia();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.form.errGuardar"))}</div>`;
    }
  };
}

// ─── DETALLE DE UN LOTE ─────────────────────────────────────────────────────
async function renderLoteDetalle(id) {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("ganaderia.cargando")}</div>`;
  try {
    const [data, dataFincas, dataAnimales, dataProduccion, dataCostos] = await Promise.all([
      api(`/medico/lotes/${id}`),
      api("/medico/fincas"),
      api(`/medico/lotes/${id}/animales`),
      api(`/medico/lotes/${id}/produccion`),
      api(`/medico/lotes/${id}/costos`),
    ]);
    pintarLoteDetalle({
      ...data, fincas: dataFincas.fincas || [], animales: dataAnimales.animales || [],
      resumenRepro: dataAnimales.resumen, produccion: dataProduccion, costos: dataCostos,
    });
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.error"))}</div>`;
  }
}

function retiroVigenteHtml(r) {
  const partes = [];
  if (r.fechaLibreCarne) partes.push(t("ganaderia.detalle.libreCarne", { fecha: fechaCorta(r.fechaLibreCarne) }));
  if (r.fechaLibreLeche) partes.push(t("ganaderia.detalle.libreLeche", { fecha: fechaCorta(r.fechaLibreLeche) }));
  return `<div class="hint">🔒 ${esc(r.producto)}: ${partes.join(" · ")}</div>`;
}

function eventoItemHtml(e) {
  const fecha = fechaCorta(e.fecha);
  let linea = "";
  if (e.tipo === "mortalidad") {
    linea = `💀 ${t("ganaderia.eventos.mortalidad", { n: e.cantidadMuertes })}${e.causaPresunta ? ` — ${esc(e.causaPresunta)}` : ""}`;
  } else if (e.tipo === "vacunacion" || e.tipo === "tratamiento") {
    const icono = e.tipo === "vacunacion" ? "💉" : "💊";
    const retiro = (e.diasRetiroCarne != null || e.diasRetiroLeche != null) ? ` (${t("ganaderia.evento.tieneRetiro")})` : "";
    linea = `${icono} ${esc(e.producto)}${e.dosis ? ` — ${esc(e.dosis)}` : ""}${retiro}`;
  } else if (e.tipo === "pesaje") {
    linea = `⚖️ ${t("ganaderia.eventos.pesaje", { peso: e.pesoPromedioKg, n: e.tamanoMuestra })}`;
  }
  return `
    <div class="item" style="cursor:default">
      <div class="top"><div class="nombre">${linea}</div></div>
      <div class="fecha">${fecha}</div>
      ${e.notas ? `<div class="paciente-info">${esc(e.notas)}</div>` : ""}
    </div>`;
}

function pintarLoteDetalle(data) {
  const { lote, finca, fincas, eventos, mortalidad, retirosVigentes, curvaPeso, animales, resumenRepro, produccion, costos } = data;
  const conReproduccion = lote.especie === "bovino" || lote.especie === "porcino";
  const duenoTexto = finca ? [finca.duenoNombre, finca.duenoTelefono].filter(Boolean).map(esc).join(" · ") : "";

  app.innerHTML = `
    <button class="back" id="btnBack">${t("ganaderia.detalle.volver")}</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${iconoPata()}${esc(lote.nombre)} <span class="hint">(${esc(lote.codigo)})</span></div>
      <div class="paciente-info">${t("ganaderia.especie." + lote.especie)}${lote.proposito ? ` · ${esc(lote.proposito)}` : ""}${lote.ubicacion ? ` · ${esc(lote.ubicacion)}` : ""}</div>
      ${finca ? `
        <div class="paciente-info">${t("ganaderia.finca.label")}: <b>${esc(finca.nombre)}</b></div>
        <div class="paciente-info">${duenoTexto
          ? `${t("ganaderia.finca.dueno")}: ${duenoTexto}${finca.duenoTelefono ? ` <span class="hint">— ${t("ganaderia.finca.recibeAlertas")}</span>` : ""}`
          : `<span class="hint">${t("ganaderia.finca.sinDueno")}</span>`}</div>` : ""}
      ${fincas.length && lote.estado !== "cerrado" ? `
        <label style="margin-top:8px">${t("ganaderia.finca.cambiar")}</label>
        <select id="loteCambiarFinca">${opcionesFinca(fincas, lote.fincaId || "")}</select>` : ""}
      <div class="paciente-info">${t("ganaderia.item.cantidad", { actual: lote.cantidadActual, inicial: lote.cantidadInicial })}
        — ${t("ganaderia.detalle.mortalidad", { pct: mortalidad.porcentaje.toFixed(1), n: mortalidad.totalMuertes })}</div>
      ${lote.estado === "cerrado" ? `
        <div class="hint" style="margin-top:6px">${t("ganaderia.detalle.cerrado", { motivo: lote.motivoCierre || "—" })}</div>
      ` : `
        <button class="link" id="btnCerrarLote" style="color:var(--danger);margin-top:6px">${t("ganaderia.detalle.cerrar")}</button>
      `}
    </div>

    ${retirosVigentes.length ? `
      <div class="card" style="border-color:var(--warning)">
        <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.detalle.retiroTitulo")}</div>
        ${retirosVigentes.map(retiroVigenteHtml).join("")}
      </div>` : ""}

    ${produccion?.tipo ? produccionLoteHtml(lote, produccion, retirosVigentes) : ""}

    ${costos ? costosLoteHtml(lote, costos) : ""}

    ${conReproduccion ? reproduccionLoteHtml(lote, animales, resumenRepro) : ""}

    ${lote.estado !== "cerrado" ? `
      <button class="secondary" id="btnDictarNota" style="margin-top:12px">🎙 ${t("ganaderia.dictado.boton")}</button>
      <div id="dictadoBox" style="display:none;margin-top:12px" class="card">
        <div class="seccion-titulo" style="margin-top:0">🎙 ${t("ganaderia.dictado.boton")}</div>
        <div class="hint" style="margin-bottom:10px">${t("ganaderia.dictado.ayuda")}</div>
        <div id="dictadoEstado" class="hint"></div>
        <button class="secondary" id="btnGrabar">${t("ganaderia.dictado.grabar")}</button>
        <button class="secondary" id="btnSubirDictado" style="display:none">${t("ganaderia.dictado.subir")}</button>
        <div id="dictadoResultado"></div>
        <div id="dictadoErr"></div>
      </div>

      <button class="secondary" id="btnNuevoEvento" style="margin-top:12px">➕ ${t("ganaderia.detalle.nuevoEvento")}</button>
      <div id="eventoFormBox" style="display:none;margin-top:12px" class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.detalle.nuevoEvento")}</div>
        <label>${t("ganaderia.evento.tipo")}</label>
        <select id="eventoTipo">
          ${TIPOS_EVENTO_GANADO.map(tp => `<option value="${tp}">${t("ganaderia.evento.tipo." + tp)}</option>`).join("")}
        </select>
        <label>${t("ganaderia.evento.fecha")}</label>
        <input id="eventoFecha" type="date" value="${fechaStrLocalGanado(new Date())}">

        <div data-grupo="mortalidad">
          <label>${t("ganaderia.evento.cantidadMuertes")}</label>
          <input id="eventoCantidadMuertes" type="number" min="1" step="1">
          <label>${t("ganaderia.evento.causaPresunta")}</label>
          <input id="eventoCausa" type="text" placeholder="${t("ganaderia.evento.causaPlaceholder")}">
        </div>

        <div data-grupo="vacunacion tratamiento">
          <label>${t("ganaderia.evento.producto")}</label>
          <input id="eventoProducto" type="text" placeholder="${t("ganaderia.evento.productoPlaceholder")}">
          <label>${t("ganaderia.evento.dosis")}</label>
          <input id="eventoDosis" type="text">
          <label>${t("ganaderia.evento.viaAplicacion")}</label>
          <input id="eventoVia" type="text" placeholder="${t("ganaderia.evento.viaPlaceholder")}">
          <label>${t("ganaderia.evento.cantidadAplicada")}</label>
          <input id="eventoCantidadAplicada" type="number" min="0" step="1" placeholder="${t("ganaderia.evento.cantidadAplicadaPlaceholder", { n: lote.cantidadActual })}">
          <label>${t("ganaderia.evento.diasRetiroCarne")}</label>
          <input id="eventoDiasRetiroCarne" type="number" min="0" step="1">
          <label>${t("ganaderia.evento.diasRetiroLeche")}</label>
          <input id="eventoDiasRetiroLeche" type="number" min="0" step="1">
        </div>

        <div data-grupo="pesaje">
          <label>${t("ganaderia.evento.tamanoMuestra")}</label>
          <input id="eventoTamanoMuestra" type="number" min="1" step="1">
          <label>${t("ganaderia.evento.pesoPromedioKg")}</label>
          <input id="eventoPesoPromedio" type="number" min="0" step="0.01">
        </div>

        <label>${t("ganaderia.evento.notas")}</label>
        <input id="eventoNotas" type="text">
        <div id="eventoErr"></div>
        <button class="secondary" id="btnGuardarEvento">${t("ganaderia.evento.guardar")}</button>
      </div>` : ""}

    ${curvaPeso.length ? `
      <div class="card" style="margin-top:12px">
        <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.curva.titulo")}</div>
        ${curvaPeso.map(p => `
          <div class="paciente-info">${fechaCorta(p.fecha)} — ${p.pesoPromedioKg} kg (${t("ganaderia.curva.muestra", { n: p.tamanoMuestra })})</div>
        `).join("")}
      </div>` : ""}

    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.eventos.titulo")}</div>
      ${eventos.length === 0 ? `<div class="empty">${t("ganaderia.eventos.vacio")}</div>` : eventos.map(eventoItemHtml).join("")}
    </div>
  `;

  document.getElementById("btnBack").onclick = renderGanaderia;
  if (conReproduccion) engancharReproduccionLote(lote);
  if (produccion?.tipo) engancharProduccionLote(lote, produccion.tipo);
  if (costos) engancharCostosLote(lote);

  const selectFinca = document.getElementById("loteCambiarFinca");
  if (selectFinca) {
    selectFinca.onchange = async () => {
      try {
        await api(`/medico/lotes/${lote._id}`, {
          method: "PATCH", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ fincaId: selectFinca.value || null }),
        });
        renderLoteDetalle(lote._id);
      } catch (e) {
        alert(e.error || t("ganaderia.finca.errGuardar"));
      }
    };
  }

  const btnCerrar = document.getElementById("btnCerrarLote");
  if (btnCerrar) {
    btnCerrar.onclick = async () => {
      if (!confirm(t("ganaderia.detalle.confirmarCerrar"))) return;
      const motivoCierre = prompt(t("ganaderia.detalle.motivoPrompt")) || "";
      try {
        await api(`/medico/lotes/${lote._id}/cerrar`, {
          method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ motivoCierre }),
        });
        renderLoteDetalle(lote._id);
      } catch (e) {
        alert(e.error || t("ganaderia.detalle.errCerrar"));
      }
    };
  }

  const btnDictarNota = document.getElementById("btnDictarNota");
  if (btnDictarNota) {
    btnDictarNota.onclick = () => {
      const box = document.getElementById("dictadoBox");
      box.style.display = box.style.display === "none" ? "block" : "none";
    };

    let mediaRecorder = null, chunks = [], blob = null, mimeType = "audio/webm";
    const dictadoEstado = document.getElementById("dictadoEstado");
    const btnGrabar = document.getElementById("btnGrabar");
    const btnSubirDictado = document.getElementById("btnSubirDictado");
    const dictadoErr = document.getElementById("dictadoErr");
    const dictadoResultado = document.getElementById("dictadoResultado");

    btnGrabar.onclick = async () => {
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
          mimeType = tipos.find(tp => MediaRecorder.isTypeSupported(tp)) || "";
          mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          chunks = [];
          mediaRecorder.ondataavailable = e => chunks.push(e.data);
          mediaRecorder.onstop = () => {
            blob = new Blob(chunks, { type: mimeType || "audio/webm" });
            stream.getTracks().forEach(tr => tr.stop());
            dictadoEstado.textContent = t("ganaderia.dictado.listo");
            btnSubirDictado.style.display = "inline-block";
          };
          mediaRecorder.start();
          dictadoEstado.textContent = t("ganaderia.dictado.grabando");
          dictadoErr.innerHTML = ""; dictadoResultado.innerHTML = "";
          btnSubirDictado.style.display = "none";
          btnGrabar.textContent = t("ganaderia.dictado.detener");
        } catch (e) {
          dictadoErr.innerHTML = `<div class="error">${t("ganaderia.dictado.errMicrofono", { mensaje: esc(e.message) })}</div>`;
        }
      } else {
        mediaRecorder.stop();
        btnGrabar.textContent = t("ganaderia.dictado.grabar");
      }
    };

    // Subir el audio y esperar el resultado ES un POST del propio médico —
    // crea la nota de voz—, y sin esto el aviso de "algo cambió" de siempre
    // repintaba el detalle del lote ENCIMA de la caja de dictado, en plena
    // subida. Se marca a mano (no hay un renderX propio que envolver: el
    // dictado vive adentro de esta misma pantalla) y se desmarca apenas
    // termina, para que un cambio real de otro dispositivo vuelva a
    // refrescar el lote una vez que el dictado ya no está en el medio. Ver
    // el comentario de "dictadoLote" en PANTALLAS_SIN_REFRESCO (realtime.js).
    function marcarDictadoEnCurso() { PANTALLA_ACTUAL = { tipo: "dictadoLote", params: {} }; }
    function volverAMarcarLoteDetalle() { PANTALLA_ACTUAL = { tipo: "loteDetalle", params: { loteId: lote._id } }; }

    btnSubirDictado.onclick = async () => {
      if (!blob) return;
      dictadoErr.innerHTML = "";
      btnSubirDictado.disabled = true;
      dictadoEstado.textContent = t("ganaderia.dictado.subiendo");
      marcarDictadoEnCurso();
      try {
        const data = await api(`/medico/lotes/${lote._id}/notas-voz`, {
          method: "POST", headers: { "Content-Type": mimeType || "audio/webm" }, body: blob,
        });
        dictadoEstado.textContent = t("ganaderia.dictado.procesando");
        sondearNotaVoz(data.nota._id);
      } catch (e) {
        btnSubirDictado.disabled = false;
        dictadoErr.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.dictado.errSubir"))}</div>`;
        volverAMarcarLoteDetalle();
      }
    };

    function sondearNotaVoz(notaId) {
      pollTimeout = setTimeout(async () => {
        try {
          const data = await api(`/medico/notas-voz/${notaId}`);
          if (data.nota.estado === "procesando") return sondearNotaVoz(notaId);
          if (data.nota.estado === "error") {
            dictadoEstado.textContent = "";
            dictadoErr.innerHTML = `<div class="error">${t("ganaderia.dictado.errProcesar")}</div>`;
            btnSubirDictado.style.display = "none";
            volverAMarcarLoteDetalle();
            return;
          }
          dictadoEstado.textContent = "";
          const n = data.eventosCreados.length;
          dictadoResultado.innerHTML = `
            <div class="hint" style="margin-top:8px">"${esc(data.nota.transcripcionCompleta)}"</div>
            <div style="font-weight:600;margin-top:6px">${t(n === 1 ? "ganaderia.dictado.resultadoUno" : "ganaderia.dictado.resultadoVarios", { n })}</div>
            <button class="link" id="btnVerActualizado" style="margin-top:6px">${t("ganaderia.dictado.verActualizado")}</button>`;
          document.getElementById("btnVerActualizado").onclick = () => renderLoteDetalle(lote._id);
          btnSubirDictado.style.display = "none";
          volverAMarcarLoteDetalle();
        } catch (e) {
          if (e.status === 401) return logout();
        }
      }, 1200);
    }
  }

  const btnNuevoEvento = document.getElementById("btnNuevoEvento");
  if (btnNuevoEvento) {
    btnNuevoEvento.onclick = () => {
      const box = document.getElementById("eventoFormBox");
      box.style.display = box.style.display === "none" ? "block" : "none";
    };
    const selectTipo = document.getElementById("eventoTipo");
    const actualizarGrupos = () => {
      const tipo = selectTipo.value;
      document.querySelectorAll("[data-grupo]").forEach(div => {
        // Un mismo div puede pertenecer a más de un tipo (vacunación y
        // tratamiento comparten los mismos campos): se lee el atributo
        // como lista separada por espacio, no como igualdad exacta.
        const grupos = div.getAttribute("data-grupo").split(" ");
        div.style.display = grupos.includes(tipo) ? "block" : "none";
      });
    };
    selectTipo.onchange = actualizarGrupos;
    actualizarGrupos();

    document.getElementById("btnGuardarEvento").onclick = async () => {
      const errBox = document.getElementById("eventoErr");
      errBox.innerHTML = "";
      const tipo = selectTipo.value;
      const fecha = document.getElementById("eventoFecha").value;
      if (!fecha) { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }

      const cuerpo = { tipo, fecha, notas: document.getElementById("eventoNotas").value.trim() };
      if (tipo === "mortalidad") {
        cuerpo.cantidadMuertes = document.getElementById("eventoCantidadMuertes").value;
        cuerpo.causaPresunta = document.getElementById("eventoCausa").value.trim();
        if (!cuerpo.cantidadMuertes) { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }
      } else if (tipo === "vacunacion" || tipo === "tratamiento") {
        cuerpo.producto = document.getElementById("eventoProducto").value.trim();
        cuerpo.dosis = document.getElementById("eventoDosis").value.trim();
        cuerpo.viaAplicacion = document.getElementById("eventoVia").value.trim();
        const cantidadAplicada = document.getElementById("eventoCantidadAplicada").value;
        if (cantidadAplicada) cuerpo.cantidadAplicada = cantidadAplicada;
        const drc = document.getElementById("eventoDiasRetiroCarne").value;
        const drl = document.getElementById("eventoDiasRetiroLeche").value;
        if (drc) cuerpo.diasRetiroCarne = drc;
        if (drl) cuerpo.diasRetiroLeche = drl;
        if (!cuerpo.producto) { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }
      } else if (tipo === "pesaje") {
        cuerpo.tamanoMuestra = document.getElementById("eventoTamanoMuestra").value;
        cuerpo.pesoPromedioKg = document.getElementById("eventoPesoPromedio").value;
        if (!cuerpo.tamanoMuestra || !cuerpo.pesoPromedioKg) { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }
      }

      try {
        await api(`/medico/lotes/${lote._id}/eventos`, {
          method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(cuerpo),
        });
        renderLoteDetalle(lote._id);
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.evento.errGuardar"))}</div>`;
      }
    };
  }
}

// Mismo criterio que fechaStrLocal en agenda.js: la fecha del día en el
// huso horario del navegador, no en UTC — un <input type="date"> con el
// valor de "hoy" en UTC puede mostrar el día de mañana o de ayer según
// dónde esté parado el médico.
function fechaStrLocalGanado(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

// ─── REPRODUCCIÓN (vacas y cerdas) ──────────────────────────────────────────
//
// El estado de cada hembra lo calcula el servidor (services/reproduccion.js)
// a partir de sus eventos: acá solo se pinta. Si lo calculara la pantalla,
// una vaca podría verse preñada en el celular y vacía en el escritorio según
// qué versión del código tuviera cada uno.

const TIPOS_EVENTO_REPRO = ["servicio", "diagnostico", "parto", "aborto", "destete", "secado"];

// fechaCorta() es la de public/js/i18n.js: trata una fecha guardada a
// medianoche UTC como el día civil que escribió el médico. Una copia propia
// acá la pisaba para toda la app y corría un día las fechas en Bolivia.

function estadoReproHtml(repro, activa) {
  if (activa === false) return `<span class="hint">${t("ganaderia.repro.baja")}</span>`;
  const color = repro.prenez === "prenada" ? "var(--success)" : repro.prenez === "servida" ? "var(--primary)" : "var(--text-muted)";
  return `<b style="color:${color}">${t("ganaderia.repro.prenez." + repro.prenez)}</b>${repro.lactando ? ` · ${t("ganaderia.repro.lactando")}` : ""}`;
}

function alertaReproTexto(a) {
  return t("ganaderia.repro.alerta." + a.tipo, { dias: a.dias, fecha: fechaCorta(a.fecha) });
}

function reproduccionLoteHtml(lote, animales, resumen) {
  const r = resumen || { hembras: 0, prenadas: 0, porcentajePrenez: 0, diagnosticosPendientes: 0, proximosPartos: [] };
  return `
    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.repro.titulo")}</div>
      ${r.hembras ? `
        <div class="paciente-info">${t("ganaderia.repro.resumen", { hembras: r.hembras, prenadas: r.prenadas, pct: Math.round(r.porcentajePrenez) })}</div>
        ${r.diagnosticosPendientes ? `<div class="paciente-info" style="color:var(--warning)">⚠️ ${t("ganaderia.repro.diagnosticosPendientes", { n: r.diagnosticosPendientes })}</div>` : ""}
        ${r.proximosPartos.length ? `
          <div class="hint" style="margin-top:8px">${t("ganaderia.repro.proximosPartos")}</div>
          ${r.proximosPartos.slice(0, 5).map(p => `
            <div class="paciente-info">${esc(p.identificador)} — ${fechaCorta(p.fecha)} ${p.dias >= 0 ? t("ganaderia.repro.enDias", { n: p.dias }) : t("ganaderia.repro.haceDias", { n: -p.dias })}</div>
          `).join("")}` : ""}
      ` : `<div class="hint">${t("ganaderia.repro.vacio")}</div>`}

      ${animales.length ? `<div style="margin-top:10px">${animales.map(a => `
        <div class="item" data-animal="${a._id}" style="cursor:pointer${a.activa ? "" : ";opacity:.6"}">
          <div class="top">
            <div class="nombre">${esc(a.identificador)}${a.nombre ? ` <span class="hint">${esc(a.nombre)}</span>` : ""}</div>
            <div>${estadoReproHtml(a.reproduccion, a.activa)}</div>
          </div>
          ${a.activa && a.reproduccion.alertas.length ? `<div class="paciente-info" style="color:var(--warning)">⚠️ ${alertaReproTexto(a.reproduccion.alertas[0])}</div>` : ""}
          ${a.activa && !a.reproduccion.alertas.length && a.reproduccion.fechaProbableParto ? `<div class="paciente-info">${t("ganaderia.repro.pareEl", { fecha: fechaCorta(a.reproduccion.fechaProbableParto) })}</div>` : ""}
        </div>`).join("")}</div>` : ""}

      ${lote.estado !== "cerrado" ? `
        <button class="link" id="btnNuevaHembra" style="margin-top:8px">➕ ${t("ganaderia.repro.agregar")}</button>
        <div id="hembraFormBox" style="display:none;margin-top:8px">
          <label>${t("ganaderia.repro.identificador")}</label>
          <input id="hembraIdentificador" type="text" placeholder="${t("ganaderia.repro.identificadorPlaceholder")}">
          <label>${t("ganaderia.repro.nombre")}</label>
          <input id="hembraNombre" type="text">
          <label>${t("ganaderia.repro.raza")}</label>
          <input id="hembraRaza" type="text">
          <label>${t("ganaderia.repro.fechaNacimiento")}</label>
          <input id="hembraNacimiento" type="date">
          <div id="hembraErr"></div>
          <button class="secondary" id="btnGuardarHembra">${t("ganaderia.repro.guardar")}</button>
        </div>` : ""}
    </div>`;
}

function engancharReproduccionLote(lote) {
  document.querySelectorAll("[data-animal]").forEach(item => {
    item.onclick = () => renderAnimalDetalle(item.dataset.animal);
  });
  const btnNueva = document.getElementById("btnNuevaHembra");
  if (!btnNueva) return;
  btnNueva.onclick = () => {
    const box = document.getElementById("hembraFormBox");
    box.style.display = box.style.display === "none" ? "block" : "none";
  };
  document.getElementById("btnGuardarHembra").onclick = async () => {
    const errBox = document.getElementById("hembraErr");
    errBox.innerHTML = "";
    const identificador = document.getElementById("hembraIdentificador").value.trim();
    if (!identificador) { errBox.innerHTML = `<div class="error">${t("ganaderia.repro.errIdentificador")}</div>`; return; }
    try {
      await api(`/medico/lotes/${lote._id}/animales`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          identificador,
          nombre: document.getElementById("hembraNombre").value.trim(),
          raza: document.getElementById("hembraRaza").value.trim(),
          fechaNacimiento: document.getElementById("hembraNacimiento").value || null,
        }),
      });
      renderLoteDetalle(lote._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.repro.errGuardar"))}</div>`;
    }
  };
}

// ─── FICHA DE UNA HEMBRA ────────────────────────────────────────────────────
async function renderAnimalDetalle(id) {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("ganaderia.cargando")}</div>`;
  try {
    const [data, controles] = await Promise.all([
      api(`/medico/animales/${id}`),
      api(`/medico/animales/${id}/controles-lecheros`),
    ]);
    pintarAnimalDetalle({ ...data, controles });
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.error"))}</div>`;
  }
}

function eventoReproHtml(e) {
  let detalle = "";
  if (e.tipo === "servicio") {
    detalle = [e.metodo ? t("ganaderia.repro.metodo." + e.metodo) : "", e.reproductor].filter(Boolean).map(esc).join(" · ");
  } else if (e.tipo === "diagnostico") {
    detalle = t("ganaderia.repro.resultado." + e.resultado);
  } else if (e.tipo === "parto") {
    const partes = [];
    if (e.criasVivas != null) partes.push(t("ganaderia.repro.vivas", { n: e.criasVivas }));
    if (e.criasMuertas != null) partes.push(t("ganaderia.repro.muertas", { n: e.criasMuertas }));
    detalle = partes.join(" · ");
  } else if (e.tipo === "destete" && e.criasDestetadas != null) {
    detalle = t("ganaderia.repro.destetadas", { n: e.criasDestetadas });
  }
  return `
    <div class="item" style="cursor:default">
      <div class="top"><div class="nombre">${t("ganaderia.repro.tipo." + e.tipo)}</div><div class="fecha">${fechaCorta(e.fecha)}</div></div>
      ${detalle ? `<div class="paciente-info">${detalle}</div>` : ""}
      ${e.notas ? `<div class="paciente-info">${esc(e.notas)}</div>` : ""}
    </div>`;
}

function pintarAnimalDetalle(data) {
  const { animal, lote, eventos, reproduccion: r } = data;
  const ind = r.indicadores;
  const puedeCargar = animal.activa && lote?.estado !== "cerrado";

  app.innerHTML = `
    <button class="back" id="btnBack">${t("ganaderia.repro.volver")}</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${esc(animal.identificador)}${animal.nombre ? ` — ${esc(animal.nombre)}` : ""}</div>
      <div class="paciente-info">${t("ganaderia.especie." + animal.especie)}${animal.raza ? ` · ${esc(animal.raza)}` : ""}${lote ? ` · ${esc(lote.nombre)} (${esc(lote.codigo)})` : ""}</div>
      ${animal.fechaNacimiento ? `<div class="paciente-info">${t("ganaderia.repro.nacida", { fecha: fechaCorta(animal.fechaNacimiento) })}</div>` : ""}
      <div class="paciente-info" style="margin-top:6px">${estadoReproHtml(r, animal.activa)}</div>
      ${animal.activa && r.fechaProbableParto ? `<div class="paciente-info">${t("ganaderia.repro.pareEl", { fecha: fechaCorta(r.fechaProbableParto) })}</div>` : ""}
      ${animal.activa && r.diasAbiertos != null && r.prenez !== "prenada" ? `<div class="paciente-info">${t("ganaderia.repro.diasAbiertos", { n: r.diasAbiertos })}</div>` : ""}
      ${!animal.activa ? `<div class="hint">${t("ganaderia.repro.dadaDeBaja", { motivo: animal.motivoBaja || "—", fecha: fechaCorta(animal.fechaBaja) })}</div>` : ""}
      ${animal.activa ? `<button class="link" id="btnBajaAnimal" style="color:var(--danger);margin-top:6px">${t("ganaderia.repro.darDeBaja")}</button>` : ""}
    </div>

    ${animal.activa && r.alertas.length ? `
      <div class="card" style="border-color:var(--warning)">
        ${r.alertas.map(a => `<div class="paciente-info">⚠️ ${alertaReproTexto(a)}</div>`).join("")}
      </div>` : ""}

    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.repro.indicadores")}</div>
      <div class="paciente-info">${t("ganaderia.repro.partos", { n: ind.partos })}</div>
      ${ind.intervaloEntrePartosPromedio != null ? `<div class="paciente-info">${t("ganaderia.repro.iep", { n: Math.round(ind.intervaloEntrePartosPromedio) })}</div>` : ""}
      ${ind.criasVivasPromedio != null ? `<div class="paciente-info">${t("ganaderia.repro.criasPromedio", { n: ind.criasVivasPromedio.toFixed(1) })}</div>` : ""}
      ${ind.criasDestetadasPromedio != null ? `<div class="paciente-info">${t("ganaderia.repro.destetadasPromedio", { n: ind.criasDestetadasPromedio.toFixed(1) })}</div>` : ""}
    </div>

    ${data.controles?.aplica ? controlLecheroHtml(data.controles, puedeCargar) : ""}

    ${puedeCargar ? `
      <button class="secondary" id="btnNuevoEventoRepro" style="margin-top:12px">➕ ${t("ganaderia.repro.registrar")}</button>
      <div id="eventoReproBox" style="display:none;margin-top:12px" class="card">
        <label>${t("ganaderia.evento.tipo")}</label>
        <select id="reproTipo">${TIPOS_EVENTO_REPRO.map(tp => `<option value="${tp}">${t("ganaderia.repro.tipo." + tp)}</option>`).join("")}</select>
        <label>${t("ganaderia.evento.fecha")}</label>
        <input id="reproFecha" type="date" value="${fechaStrLocalGanado(new Date())}">
        <div data-grupo-repro="servicio">
          <label>${t("ganaderia.repro.metodoLabel")}</label>
          <select id="reproMetodo">
            <option value="">—</option>
            <option value="monta">${t("ganaderia.repro.metodo.monta")}</option>
            <option value="inseminacion">${t("ganaderia.repro.metodo.inseminacion")}</option>
          </select>
          <label>${t("ganaderia.repro.reproductor")}</label>
          <input id="reproReproductor" type="text" placeholder="${t("ganaderia.repro.reproductorPlaceholder")}">
        </div>
        <div data-grupo-repro="diagnostico">
          <label>${t("ganaderia.repro.resultadoLabel")}</label>
          <select id="reproResultado">
            <option value="prenada">${t("ganaderia.repro.resultado.prenada")}</option>
            <option value="vacia">${t("ganaderia.repro.resultado.vacia")}</option>
          </select>
        </div>
        <div data-grupo-repro="parto">
          <label>${t("ganaderia.repro.criasVivas")}</label>
          <input id="reproVivas" type="number" min="0" step="1">
          <label>${t("ganaderia.repro.criasMuertas")}</label>
          <input id="reproMuertas" type="number" min="0" step="1">
        </div>
        <div data-grupo-repro="destete">
          <label>${t("ganaderia.repro.criasDestetadas")}</label>
          <input id="reproDestetadas" type="number" min="0" step="1">
        </div>
        <label>${t("ganaderia.evento.notas")}</label>
        <input id="reproNotas" type="text">
        <div id="reproErr"></div>
        <button class="secondary" id="btnGuardarRepro">${t("ganaderia.evento.guardar")}</button>
      </div>` : ""}

    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.repro.historial")}</div>
      ${eventos.length ? eventos.map(eventoReproHtml).join("") : `<div class="empty">${t("ganaderia.repro.sinEventos")}</div>`}
    </div>
  `;

  document.getElementById("btnBack").onclick = () => renderLoteDetalle(animal.loteId);
  if (data.controles?.aplica && puedeCargar) engancharControlLechero(animal);

  const btnBaja = document.getElementById("btnBajaAnimal");
  if (btnBaja) {
    btnBaja.onclick = async () => {
      if (!confirm(t("ganaderia.repro.confirmarBaja"))) return;
      const motivo = prompt(t("ganaderia.repro.motivoBaja")) || "";
      try {
        await api(`/medico/animales/${animal._id}/baja`, {
          method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ motivo }),
        });
        renderAnimalDetalle(animal._id);
      } catch (e) {
        alert(e.error || t("ganaderia.repro.errGuardar"));
      }
    };
  }

  const btnNuevo = document.getElementById("btnNuevoEventoRepro");
  if (!btnNuevo) return;
  btnNuevo.onclick = () => {
    const box = document.getElementById("eventoReproBox");
    box.style.display = box.style.display === "none" ? "block" : "none";
  };
  const selectTipo = document.getElementById("reproTipo");
  const actualizar = () => {
    document.querySelectorAll("[data-grupo-repro]").forEach(div => {
      div.style.display = div.dataset.grupoRepro === selectTipo.value ? "block" : "none";
    });
  };
  selectTipo.onchange = actualizar;
  actualizar();

  document.getElementById("btnGuardarRepro").onclick = async () => {
    const errBox = document.getElementById("reproErr");
    errBox.innerHTML = "";
    const tipo = selectTipo.value;
    const fecha = document.getElementById("reproFecha").value;
    if (!fecha) { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }
    const cuerpo = { tipo, fecha, notas: document.getElementById("reproNotas").value.trim() };
    if (tipo === "servicio") {
      cuerpo.metodo = document.getElementById("reproMetodo").value;
      cuerpo.reproductor = document.getElementById("reproReproductor").value.trim();
    } else if (tipo === "diagnostico") {
      cuerpo.resultado = document.getElementById("reproResultado").value;
    } else if (tipo === "parto") {
      cuerpo.criasVivas = document.getElementById("reproVivas").value;
      cuerpo.criasMuertas = document.getElementById("reproMuertas").value;
    } else if (tipo === "destete") {
      cuerpo.criasDestetadas = document.getElementById("reproDestetadas").value;
    }
    try {
      await api(`/medico/animales/${animal._id}/eventos`, {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(cuerpo),
      });
      renderAnimalDetalle(animal._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.evento.errGuardar"))}</div>`;
    }
  };
}

// ─── PRODUCCIÓN (leche y huevos) ────────────────────────────────────────────
//
// Los números (promedios, caída, qué leche está en retiro) los calcula el
// servidor en services/produccion.js; acá solo se pintan.

function numeroCorto(n, decimales = 1) {
  return n == null ? "—" : Number(n).toLocaleString(localeActual(), { maximumFractionDigits: decimales });
}

function diaCortoProd(dia) {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString(localeActual(), { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

// Una barra por día, del más nuevo al más viejo. Barras hechas con un div y
// no con un gráfico: se leen igual en un celular chico, no necesitan
// ninguna librería y el número va al lado, que es lo que de verdad se mira.
function barrasProduccionHtml(tipo, serie) {
  const dias = serie.slice(-14).reverse();
  if (!dias.length) return "";
  const max = Math.max(...dias.map(r => r.cantidad), 1);
  return `<div style="display:grid;gap:4px;margin-top:10px">${dias.map(r => `
    <div style="display:grid;grid-template-columns:42px 1fr auto;gap:8px;align-items:center;font-size:12.5px;font-variant-numeric:tabular-nums">
      <span class="hint" style="margin:0">${diaCortoProd(r.dia)}</span>
      <span style="display:block;height:10px;border-radius:5px;background:var(--border)">
        <span style="display:block;height:10px;border-radius:5px;width:${Math.max(2, (r.cantidad / max) * 100)}%;background:${r.enRetiro ? "var(--warning)" : "var(--primary)"}"></span>
      </span>
      <span>${numeroCorto(r.cantidad)}${tipo === "huevos" && r.porAnimal != null ? ` · ${numeroCorto(r.porAnimal)}%` : ""}${r.enRetiro ? " 🔒" : ""}</span>
    </div>`).join("")}</div>`;
}

function produccionLoteHtml(lote, produccion, retirosVigentes) {
  const { tipo, resumen: r, controlLote } = produccion;
  const unidad = t("ganaderia.prod.unidad." + tipo);
  const retiroLecheHoy = tipo === "leche"
    ? (retirosVigentes || []).find(x => x.fechaLibreLeche && new Date(x.fechaLibreLeche) > new Date())
    : null;
  const variacion = r.variacionPct == null ? "" :
    ` <span style="color:${r.variacionPct < 0 ? "var(--danger)" : "var(--success)"}">${r.variacionPct > 0 ? "+" : ""}${Math.round(r.variacionPct)}%</span> ${t("ganaderia.prod.vsSemanaAnterior")}`;

  return `
    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.prod.titulo." + tipo)}</div>
      ${r.alertas.map(a => `<div class="paciente-info" style="color:var(--warning)">⚠️ ${t("ganaderia.prod.alerta." + a.tipo, { pct: a.pct, litros: numeroCorto(a.litros) })}</div>`).join("")}
      ${r.ultimo ? `
        <div class="paciente-info">${t("ganaderia.prod.ultimo", { dia: diaCortoProd(r.ultimo.dia), cantidad: numeroCorto(r.ultimo.cantidad), unidad })}${
          r.ultimo.porAnimal != null ? ` · ${t("ganaderia.prod.porAnimal." + tipo, { n: numeroCorto(r.ultimo.porAnimal) })}` : ""}</div>
        ${r.promedio7 != null ? `<div class="paciente-info">${t("ganaderia.prod.promedio7." + tipo, { n: numeroCorto(r.promedio7) })}${variacion}</div>` : ""}
        ${tipo === "leche" && r.vendible7 != null ? `<div class="paciente-info">${t("ganaderia.prod.vendible7", { n: numeroCorto(r.vendible7) })}</div>` : ""}
        ${barrasProduccionHtml(tipo, r.serie)}
      ` : `<div class="hint">${t("ganaderia.prod.vacio." + tipo)}</div>`}

      ${controlLote ? `
        <div class="hint" style="margin-top:10px">${t("ganaderia.prod.controlLote", { dia: diaCortoProd(controlLote.dia), n: controlLote.vacas, promedio: numeroCorto(controlLote.promedio) })}</div>
        ${controlLote.vacasDelDia.slice(0, 3).map(c => `<div class="paciente-info">${esc(c.identificador)} — ${numeroCorto(c.litros)} L</div>`).join("")}` : ""}

      ${lote.estado !== "cerrado" ? `
        <button class="link" id="btnCargarProduccion" style="margin-top:8px">➕ ${t("ganaderia.prod.cargar." + tipo)}</button>
        <div id="produccionFormBox" style="display:none;margin-top:8px">
          ${retiroLecheHoy ? `<div class="paciente-info" style="color:var(--warning)">🔒 ${t("ganaderia.prod.avisoRetiro", { producto: esc(retiroLecheHoy.producto), fecha: fechaCorta(retiroLecheHoy.fechaLibreLeche) })}</div>` : ""}
          <label>${t("ganaderia.evento.fecha")}</label>
          <input id="prodDia" type="date" value="${fechaStrLocalGanado(new Date())}">
          <label>${t("ganaderia.prod.cantidad." + tipo)}</label>
          <input id="prodCantidad" type="number" min="0" step="${tipo === "leche" ? "0.1" : "1"}">
          <label>${t("ganaderia.prod.animales." + tipo)}</label>
          <input id="prodAnimales" type="number" min="0" step="1" placeholder="${tipo === "huevos" ? t("ganaderia.prod.animalesPlaceholder", { n: produccion.cantidadActual }) : ""}">
          <div class="hint">${t("ganaderia.prod.corregir")}</div>
          <div id="prodErr"></div>
          <button class="secondary" id="btnGuardarProduccion">${t("ganaderia.evento.guardar")}</button>
        </div>` : ""}
    </div>`;
}

function engancharProduccionLote(lote, tipo) {
  const btn = document.getElementById("btnCargarProduccion");
  if (!btn) return;
  btn.onclick = () => {
    const box = document.getElementById("produccionFormBox");
    box.style.display = box.style.display === "none" ? "block" : "none";
  };
  document.getElementById("btnGuardarProduccion").onclick = async () => {
    const errBox = document.getElementById("prodErr");
    errBox.innerHTML = "";
    const dia = document.getElementById("prodDia").value;
    const cantidad = document.getElementById("prodCantidad").value;
    if (!dia || cantidad === "") { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }
    try {
      const data = await api(`/medico/lotes/${lote._id}/produccion`, {
        method: "PUT", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ dia, cantidad, animales: document.getElementById("prodAnimales").value }),
      });
      // Es el momento justo para frenar que esa leche vaya al tanque:
      // se dice ahora, no solo con el candadito en la lista.
      if (data.enRetiro) alert(t("ganaderia.prod.guardadoEnRetiro", { producto: data.productoRetiro || "" }));
      renderLoteDetalle(lote._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.evento.errGuardar"))}</div>`;
    }
  };
}

// ─── CONTROL LECHERO DE UNA VACA ────────────────────────────────────────────
function controlLecheroHtml(c, puedeCargar) {
  const ultimos = c.serie.slice(-10).reverse();
  return `
    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.prod.controlTitulo")}</div>
      ${c.ultimo ? `
        <div class="paciente-info">${t("ganaderia.prod.controlUltimo", { litros: numeroCorto(c.ultimo.litros), dia: diaCortoProd(c.ultimo.dia) })}${
          c.ultimo.del != null ? ` · ${t("ganaderia.prod.del", { n: c.ultimo.del })}` : ""}</div>
        ${c.promedioLactancia != null ? `<div class="paciente-info">${t("ganaderia.prod.promedioLactancia", { n: numeroCorto(c.promedioLactancia) })}</div>` : ""}
        ${c.pico ? `<div class="paciente-info">${t("ganaderia.prod.pico", { n: numeroCorto(c.pico.litros), dia: diaCortoProd(c.pico.dia) })}</div>` : ""}
        ${ultimos.map(x => `<div class="paciente-info" style="font-variant-numeric:tabular-nums">${diaCortoProd(x.dia)} — ${numeroCorto(x.litros)} L${x.del != null ? ` <span class="hint">(${t("ganaderia.prod.del", { n: x.del })})</span>` : ""}</div>`).join("")}
      ` : `<div class="hint">${t("ganaderia.prod.controlVacio")}</div>`}
      ${puedeCargar ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label>${t("ganaderia.evento.fecha")}</label><input id="controlDia" type="date" value="${fechaStrLocalGanado(new Date())}"></div>
          <div><label>${t("ganaderia.prod.litros")}</label><input id="controlLitros" type="number" min="0" step="0.1"></div>
        </div>
        <div id="controlErr"></div>
        <button class="secondary" id="btnGuardarControl">${t("ganaderia.prod.guardarControl")}</button>` : ""}
    </div>`;
}

function engancharControlLechero(animal) {
  const btn = document.getElementById("btnGuardarControl");
  if (!btn) return;
  btn.onclick = async () => {
    const errBox = document.getElementById("controlErr");
    errBox.innerHTML = "";
    const dia = document.getElementById("controlDia").value;
    const litros = document.getElementById("controlLitros").value;
    if (!dia || litros === "") { errBox.innerHTML = `<div class="error">${t("ganaderia.evento.errFaltanDatos")}</div>`; return; }
    try {
      await api(`/medico/animales/${animal._id}/controles-lecheros`, {
        method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ dia, litros }),
      });
      renderAnimalDetalle(animal._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.evento.errGuardar"))}</div>`;
    }
  };
}

// ─── ALIMENTO Y COSTOS ──────────────────────────────────────────────────────
//
// Los indicadores los calcula services/costos.js; acá solo se pintan. La
// plata llega en centavos y con la moneda de la cuenta.

function plataGanado(centavos, moneda) {
  if (centavos == null) return "—";
  const simbolo = moneda === "BRL" ? "R$" : "Bs";
  return `${simbolo} ${(centavos / 100).toLocaleString(localeActual(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function costosLoteHtml(lote, costos) {
  const { moneda, resumen: r, gastos, categorias, gastosOtraMoneda } = costos;
  const esEngorde = lote.especie === "porcino" || lote.especie === "avicola";
  const conGasto = categorias.filter(cat => r.porCategoria[cat] > 0);
  const u = r.porUnidad;

  return `
    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.costos.titulo")}</div>
      ${r.total > 0 ? `
        <div class="paciente-info">${t("ganaderia.costos.total", { monto: plataGanado(r.total, moneda) })}</div>
        <div style="display:grid;gap:4px;margin:8px 0">${conGasto.map(cat => `
          <div style="display:grid;grid-template-columns:92px 1fr auto;gap:8px;align-items:center;font-size:12.5px;font-variant-numeric:tabular-nums">
            <span class="hint" style="margin:0">${t("ganaderia.costos.categoria." + cat)}</span>
            <span style="display:block;height:10px;border-radius:5px;background:var(--border)">
              <span style="display:block;height:10px;border-radius:5px;width:${Math.max(2, (r.porCategoria[cat] / r.total) * 100)}%;background:var(--primary)"></span>
            </span>
            <span>${Math.round((r.porCategoria[cat] / r.total) * 100)}%</span>
          </div>`).join("")}</div>
      ` : ""}
      ${r.costoPorAnimal != null ? `<div class="paciente-info">${t("ganaderia.costos.porAnimal", { monto: plataGanado(r.costoPorAnimal, moneda) })}</div>` : ""}
      ${r.alimentoPorAnimalDia != null ? `<div class="paciente-info">${t("ganaderia.costos.alimentoPorAnimalDia", { kg: numeroCorto(r.alimentoPorAnimalDia, 3) })}</div>` : ""}
      ${r.conversion.valor != null ? `
        <div class="paciente-info">${t("ganaderia.costos.conversion", { n: numeroCorto(r.conversion.valor, 2), desde: diaCortoProd(r.conversion.desde), hasta: diaCortoProd(r.conversion.hasta) })}</div>
        <div class="hint">${t("ganaderia.costos.conversionAyuda")}</div>`
        : esEngorde && r.conversion.motivo !== "sin_ganancia" ? `<div class="hint">${t("ganaderia.costos.conversionFalta." + r.conversion.motivo)}</div>` : ""}
      ${u?.tipo === "leche" && u.costoPorLitro != null ? `
        <div class="paciente-info">${t("ganaderia.costos.porLitro", { monto: plataGanado(u.costoPorLitro, moneda) })}</div>
        ${u.costoPorLitroVendible != null && u.vendibles < u.litros ? `
          <div class="paciente-info">${t("ganaderia.costos.porLitroVendible", { monto: plataGanado(u.costoPorLitroVendible, moneda) })}</div>
          <div class="hint">${t("ganaderia.costos.porLitroVendibleAyuda")}</div>` : ""}` : ""}
      ${u?.tipo === "huevos" && u.costoPorDocena != null ? `<div class="paciente-info">${t("ganaderia.costos.porDocena", { monto: plataGanado(u.costoPorDocena, moneda) })}</div>` : ""}
      ${gastosOtraMoneda ? `<div class="hint">${t("ganaderia.costos.otraMoneda", { n: gastosOtraMoneda })}</div>` : ""}
      ${!gastos.length ? `<div class="hint">${t("ganaderia.costos.vacio")}</div>` : ""}

      ${lote.estado !== "cerrado" ? `
        <button class="link" id="btnNuevoGasto" style="margin-top:8px">➕ ${t("ganaderia.costos.cargar")}</button>
        <div id="gastoFormBox" style="display:none;margin-top:8px">
          <label>${t("ganaderia.evento.fecha")}</label>
          <input id="gastoDia" type="date" value="${fechaStrLocalGanado(new Date())}">
          <label>${t("ganaderia.costos.categoriaLabel")}</label>
          <select id="gastoCategoria">${categorias.map(cat => `<option value="${cat}">${t("ganaderia.costos.categoria." + cat)}</option>`).join("")}</select>
          <label>${t("ganaderia.costos.concepto")}</label>
          <input id="gastoConcepto" type="text" placeholder="${t("ganaderia.costos.conceptoPlaceholder")}">
          <div id="gastoKgBox">
            <label>${t("ganaderia.costos.kg")}</label>
            <input id="gastoKg" type="number" min="0" step="0.1">
          </div>
          <label>${t("ganaderia.costos.monto", { simbolo: moneda === "BRL" ? "R$" : "Bs" })}</label>
          <input id="gastoMonto" type="number" min="0" step="0.01">
          <div id="gastoErr"></div>
          <button class="secondary" id="btnGuardarGasto">${t("ganaderia.evento.guardar")}</button>
        </div>` : ""}

      ${gastos.length ? `<div style="margin-top:10px">${gastos.slice(0, 10).map(g => `
        <div class="item" style="cursor:default">
          <div class="top">
            <div class="nombre">${t("ganaderia.costos.categoria." + g.categoria)}${g.concepto ? ` <span class="hint">${esc(g.concepto)}</span>` : ""}</div>
            <button class="link" data-borrar-gasto="${g._id}" style="margin:0;width:auto;color:var(--danger)" aria-label="${t("ganaderia.costos.borrar")}">✕</button>
          </div>
          <div class="paciente-info" style="font-variant-numeric:tabular-nums">${diaCortoProd(g.dia)} · ${plataGanado(g.montoCentavos, g.moneda)}${g.kg != null ? ` · ${numeroCorto(g.kg)} kg` : ""}</div>
        </div>`).join("")}</div>` : ""}
    </div>`;
}

function engancharCostosLote(lote) {
  document.querySelectorAll("[data-borrar-gasto]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("ganaderia.costos.confirmarBorrar"))) return;
      try {
        await api(`/medico/gastos/${btn.dataset.borrarGasto}`, { method: "DELETE" });
        renderLoteDetalle(lote._id);
      } catch (e) {
        alert(e.error || t("ganaderia.evento.errGuardar"));
      }
    };
  });
  const btn = document.getElementById("btnNuevoGasto");
  if (!btn) return;
  btn.onclick = () => {
    const box = document.getElementById("gastoFormBox");
    box.style.display = box.style.display === "none" ? "block" : "none";
  };
  const selectCat = document.getElementById("gastoCategoria");
  const mostrarKg = () => { document.getElementById("gastoKgBox").style.display = selectCat.value === "alimento" ? "block" : "none"; };
  selectCat.onchange = mostrarKg;
  mostrarKg();

  document.getElementById("btnGuardarGasto").onclick = async () => {
    const errBox = document.getElementById("gastoErr");
    errBox.innerHTML = "";
    const categoria = selectCat.value;
    const monto = document.getElementById("gastoMonto").value;
    const kg = categoria === "alimento" ? document.getElementById("gastoKg").value : "";
    if (!monto && !kg) { errBox.innerHTML = `<div class="error">${t("ganaderia.costos.errVacio")}</div>`; return; }
    try {
      await api(`/medico/lotes/${lote._id}/gastos`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          dia: document.getElementById("gastoDia").value, categoria,
          concepto: document.getElementById("gastoConcepto").value.trim(), monto, kg,
        }),
      });
      renderLoteDetalle(lote._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.evento.errGuardar"))}</div>`;
    }
  };
}
