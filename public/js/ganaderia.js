// Symphomed Ganadería — lotes de producción animal (bovino, porcino,
// avícola). Mismo patrón que agenda.js: pinta en `app`, listo para
// escritorio.js y rutas.js sin que ninguna de las dos sepa que esto existe.

const ESPECIES_GANADO = ["bovino", "porcino", "avicola"];
const TIPOS_EVENTO_GANADO = ["mortalidad", "vacunacion", "tratamiento", "pesaje"];

// Se mantiene entre pantallas: volver del detalle de un lote no reinicia el
// filtro que el médico ya había elegido — mismo criterio que
// diaAgendaElegido en agenda.js.
let ganaderiaFiltro = "activo";

async function renderGanaderia() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("ganaderia.cargando")}</div>`;
  try {
    const query = ganaderiaFiltro === "todos" ? "" : `?estado=${ganaderiaFiltro}`;
    const data = await api(`/medico/lotes${query}`);
    pintarGanaderia(data.lotes || []);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.error"))}</div>`;
  }
}

function pintarGanaderia(lotes) {
  app.innerHTML = `
    <button class="back" id="btnBack">${t("ganaderia.volver")}</button>
    <button class="secondary" id="btnNuevoLote">➕ ${t("ganaderia.nuevoLote")}</button>

    <div id="loteFormBox" style="display:none;margin-top:12px" class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.nuevoLote")}</div>
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
      ${lotes.length === 0 ? `<div class="empty">${t("ganaderia.vacio")}</div>` : lotes.map(l => `
        <div class="item" data-lote="${l._id}" style="cursor:pointer">
          <div class="top">
            <div class="nombre">${ICONOS.pata}${esc(l.nombre)} <span class="hint">(${esc(l.codigo)})</span></div>
          </div>
          <div class="paciente-info">${t("ganaderia.especie." + l.especie)} · ${t("ganaderia.item.cantidad", { actual: l.cantidadActual, inicial: l.cantidadInicial })}</div>
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
    const data = await api(`/medico/lotes/${id}`);
    pintarLoteDetalle(data);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("ganaderia.error"))}</div>`;
  }
}

function retiroVigenteHtml(r) {
  const partes = [];
  if (r.fechaLibreCarne) partes.push(t("ganaderia.detalle.libreCarne", { fecha: new Date(r.fechaLibreCarne).toLocaleDateString(localeActual()) }));
  if (r.fechaLibreLeche) partes.push(t("ganaderia.detalle.libreLeche", { fecha: new Date(r.fechaLibreLeche).toLocaleDateString(localeActual()) }));
  return `<div class="hint">🔒 ${esc(r.producto)}: ${partes.join(" · ")}</div>`;
}

function eventoItemHtml(e) {
  const fecha = new Date(e.fecha).toLocaleDateString(localeActual());
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
  const { lote, eventos, mortalidad, retirosVigentes, curvaPeso } = data;

  app.innerHTML = `
    <button class="back" id="btnBack">${t("ganaderia.detalle.volver")}</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${ICONOS.pata}${esc(lote.nombre)} <span class="hint">(${esc(lote.codigo)})</span></div>
      <div class="paciente-info">${t("ganaderia.especie." + lote.especie)}${lote.proposito ? ` · ${esc(lote.proposito)}` : ""}${lote.ubicacion ? ` · ${esc(lote.ubicacion)}` : ""}</div>
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
          <div class="paciente-info">${new Date(p.fecha).toLocaleDateString(localeActual())} — ${p.pesoPromedioKg} kg (${t("ganaderia.curva.muestra", { n: p.tamanoMuestra })})</div>
        `).join("")}
      </div>` : ""}

    <div class="card" style="margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${t("ganaderia.eventos.titulo")}</div>
      ${eventos.length === 0 ? `<div class="empty">${t("ganaderia.eventos.vacio")}</div>` : eventos.map(eventoItemHtml).join("")}
    </div>
  `;

  document.getElementById("btnBack").onclick = renderGanaderia;

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
