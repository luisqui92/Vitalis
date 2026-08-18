// Vitalis — Las 4 pantallas de escritorio que no existían como concepto en
// la app móvil (ahí todo se navega paciente por paciente): Vitalis Voice,
// Indicaciones, Estudios e imágenes, Reportes y Finanzas. Consumen los
// listados cruzados de routes/dashboardEscritorio.js (más /medico/citas
// para Voice). Se cargan antes que escritorio.js para que sus funciones
// ya existan cuando este arma el sidebar.

// ─── VITALIS VOICE (citas gestionadas por el recepcionista telefónico) ──
async function renderVozEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando llamadas...</div>`;
  try {
    const desde = new Date(); desde.setDate(desde.getDate() - 60);
    const hasta = new Date(); hasta.setDate(hasta.getDate() + 30);
    const data = await api(`/medico/citas?desde=${desde.toISOString()}&hasta=${hasta.toISOString()}`);
    const llamadas = (data.citas || []).filter(c => c.origen === "voz").sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    pintarVozEscritorio(llamadas);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando Vitalis Voice")}</div>`;
  }
}
function pintarVozEscritorio(llamadas) {
  const ESTADO_LABEL = { confirmada: "Confirmada", cancelada: "Cancelada", completada: "Completada" };
  app.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">📞 Vitalis Voice</div>
      <div class="hint" style="margin-top:0">Citas agendadas o canceladas por el recepcionista de voz (llamadas telefónicas), últimos 60 días y próximos 30.</div>
      ${llamadas.length === 0 ? `<div class="hint">Todavía no se registró ninguna llamada gestionada por el asistente de voz.</div>` : `
        <div class="escr-lista" style="margin-top:12px">
          ${llamadas.map(c => `
            <div class="escr-lista-item">
              <div>
                <div class="escr-lista-titulo">${esc(c.pacienteNombre || "Sin nombre")}</div>
                <div class="escr-lista-sub">${esc(new Date(c.fecha).toLocaleString("es-BO"))}${c.motivo ? " · " + esc(c.motivo) : ""} · ${ESTADO_LABEL[c.estado] || c.estado}</div>
              </div>
            </div>`).join("")}
        </div>`}
    </div>`;
}

// ─── INDICACIONES (recetas, cruzado entre pacientes) ─────────────────────
async function renderIndicacionesEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando indicaciones...</div>`;
  try {
    const data = await api("/medico/recetas");
    pintarIndicacionesEscritorio(data.recetas || []);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando indicaciones")}</div>`;
  }
}
function pintarIndicacionesEscritorio(recetas) {
  app.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">📄 Indicaciones</div>
      ${recetas.length === 0 ? `<div class="hint">Todavía no se generó ninguna receta.</div>` : `
        <div class="escr-lista">
          ${recetas.map(r => {
            const meds = (r.medicamentos || []).map(m => esc(m.nombre + (m.dosis ? " " + m.dosis : ""))).join(", ");
            return `
              <div class="escr-lista-item escr-lista-item-click" data-paciente-id="${r.pacienteId?._id || ""}">
                <div>
                  <div class="escr-lista-titulo">${esc(r.pacienteId?.nombre || "Paciente eliminado")}</div>
                  <div class="escr-lista-sub">${esc(new Date(r.fecha).toLocaleDateString("es-BO"))}${meds ? " · " + meds : ""}${r.indicaciones ? " · " + esc(r.indicaciones.slice(0, 80)) : ""}</div>
                </div>
              </div>`;
          }).join("")}
        </div>`}
    </div>`;
  document.querySelectorAll("[data-paciente-id]").forEach(el => {
    if (el.dataset.pacienteId) el.onclick = () => renderPacienteDetalle(el.dataset.pacienteId, "recetas");
  });
}

// ─── ESTUDIOS E IMÁGENES (cruzado entre pacientes) ───────────────────────
async function renderEstudiosEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando estudios...</div>`;
  try {
    const data = await api("/medico/estudios");
    pintarEstudiosEscritorio(data.estudios || []);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando estudios")}</div>`;
  }
}
function pintarEstudiosEscritorio(estudios) {
  const tipos = tiposEstudioActivos();
  app.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">🩻 Estudios e imágenes</div>
      ${estudios.length === 0 ? `<div class="hint">Todavía no se cargó ningún estudio.</div>` : `
        <div class="escr-lista">
          ${estudios.map(e => `
            <div class="escr-lista-item escr-lista-item-click" data-paciente-id="${e.pacienteId?._id || ""}">
              <div>
                <div class="escr-lista-titulo">${esc(e.pacienteId?.nombre || "Paciente eliminado")} — ${esc(e.nombre)}</div>
                <div class="escr-lista-sub">${esc(tipos[e.tipo] || e.tipo)}${e.anguloFoto ? " · " + esc(e.anguloFoto) : ""} · ${esc(new Date(e.fecha).toLocaleDateString("es-BO"))}</div>
              </div>
            </div>`).join("")}
        </div>`}
    </div>`;
  document.querySelectorAll("[data-paciente-id]").forEach(el => {
    if (el.dataset.pacienteId) el.onclick = () => renderPacienteDetalle(el.dataset.pacienteId, "estudios");
  });
}

// ─── REPORTES (consultas/citas/pacientes nuevos por mes, últimos 6) ─────
function escrUltimosSeisMeses() {
  const base = new Date(); base.setDate(1);
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const x = new Date(base.getFullYear(), base.getMonth() - i, 1);
    meses.push({ clave: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`, label: x.toLocaleDateString("es-BO", { month: "short" }) });
  }
  return meses;
}
function escrBarritasHtml(porMes, meses) {
  const max = Math.max(1, ...meses.map(m => porMes[m.clave] || 0));
  return `<div class="escr-barras">${meses.map(m => {
    const v = porMes[m.clave] || 0;
    const alto = Math.max(4, Math.round((v / max) * 100));
    return `
      <div class="escr-barra-col">
        <div class="escr-barra-valor">${v}</div>
        <div class="escr-barra" style="height:${alto}%"></div>
        <div class="escr-barra-label">${esc(m.label)}</div>
      </div>`;
  }).join("")}</div>`;
}
async function renderReportesEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando reportes...</div>`;
  try {
    const data = await api("/medico/reportes/resumen");
    pintarReportesEscritorio(data);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando reportes")}</div>`;
  }
}
function pintarReportesEscritorio(r) {
  const meses = escrUltimosSeisMeses();
  app.innerHTML = `
    <div class="escr-stats">
      ${escrStatCardHtml(r.totalConsultas, "Consultas (6 meses)")}
      ${escrStatCardHtml(r.porcentajeConsultasCompletadas + "%", "Consultas completadas")}
      ${escrStatCardHtml(r.totalCitas, "Citas (6 meses)")}
      ${escrStatCardHtml(r.citasCanceladas, "Citas canceladas")}
    </div>
    <div class="escr-grid-2">
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">🎙️ Consultas por mes</div>
        ${escrBarritasHtml(r.consultasPorMes, meses)}
      </div>
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">📅 Citas por mes</div>
        ${escrBarritasHtml(r.citasPorMes, meses)}
      </div>
    </div>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">👤 Pacientes nuevos por mes</div>
      ${escrBarritasHtml(r.pacientesNuevosPorMes, meses)}
    </div>
  `;
}

// ─── FINANZAS (solo tiene datos reales en especialidades con Plan de
// tratamiento — odontología, estética, oftalmología; en las demás da todo
// en cero, y se lo decimos así de claro, no es un error). ─────────────────
async function renderFinanzasEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando finanzas...</div>`;
  try {
    const data = await api("/medico/finanzas/resumen");
    pintarFinanzasEscritorio(data);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando finanzas")}</div>`;
  }
}
function pintarFinanzasEscritorio(r) {
  const sinPlanes = MEDICO_TIPO_ESPECIALIDAD !== "odontologia" && MEDICO_TIPO_ESPECIALIDAD !== "estetica" && MEDICO_TIPO_ESPECIALIDAD !== "oftalmologia";
  app.innerHTML = `
    ${sinPlanes ? `<div class="card"><div class="hint" style="margin-top:0">Finanzas todavía solo lleva el detalle de los planes de tratamiento (Odontología, Vitalis Face y Vitalis Visión) — tu especialidad no los usa, así que estos números van a quedar en cero.</div></div>` : ""}
    <div class="escr-stats">
      ${escrStatCardHtml(money(r.totalFacturado), "Facturado")}
      ${escrStatCardHtml(money(r.totalCobrado), "Cobrado")}
      ${escrStatCardHtml(money(r.saldoPendiente), "Saldo pendiente")}
      ${escrStatCardHtml(r.cantidadPlanes, "Planes de tratamiento")}
    </div>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">💵 Pagos recientes</div>
      ${r.pagosRecientes.length === 0 ? `<div class="hint">Todavía no se registró ningún pago.</div>` : `
        <div class="escr-lista">
          ${r.pagosRecientes.map(p => `
            <div class="escr-lista-item">
              <div>
                <div class="escr-lista-titulo">${esc(p.pacienteNombre || "")} — ${esc(p.tratamiento || "")}</div>
                <div class="escr-lista-sub">${esc(new Date(p.fecha).toLocaleDateString("es-BO"))}</div>
              </div>
              <div class="escr-lista-titulo" style="margin-left:auto">${money(p.monto)}</div>
            </div>`).join("")}
        </div>`}
    </div>
  `;
}
