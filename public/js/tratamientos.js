// Vitalis Odonto — Plan de tratamiento y presupuesto: catálogo reutilizable
// (nombre + precio) y, por paciente, una lista de ítems opcionalmente
// ligados a una pieza del odontograma, con pagos registrados contra cada
// uno. Saldo = precio - suma de pagos, siempre calculado al vuelo.
const ESTADO_TRATAMIENTO_INFO = {
  pendiente: { label: "Pendiente", clase: "badge-procesando" },
  en_proceso: { label: "En proceso", clase: "badge-procesando" },
  realizado: { label: "Realizado", clase: "badge-completado" },
};

// Vitalis Face: en vez de pieza FDI (odontología), un tratamiento se
// ubica en una región del rostro — mismas etiquetas que el mapa anatómico
// de la referencia de diseño.
const REGIONES_FACIALES = [
  "Frente", "Ceja derecha", "Ceja izquierda", "Ojo derecho", "Ojo izquierdo",
  "Mejilla derecha", "Mejilla izquierda", "Nariz", "Labio superior", "Labio inferior",
  "Oreja derecha", "Oreja izquierda", "Mandíbula", "Mentón", "Cuello", "Otra",
];

function money(n) { return "Bs " + Number(n || 0).toFixed(2).replace(/\.00$/, ""); }
function totalPagado(item) { return (item.pagos || []).reduce((s, p) => s + p.monto, 0); }

let CATALOGO_CACHE = null;

async function renderTabPlanTratamiento(pacienteId) {
  const box = document.getElementById("planBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando plan de tratamiento...</div>`;
  try {
    const [dataTrat, dataCat] = await Promise.all([
      api(`/medico/pacientes/${pacienteId}/tratamientos`),
      api("/medico/catalogo-tratamientos"),
    ]);
    CATALOGO_CACHE = dataCat.catalogo || [];
    pintarPlan(pacienteId, dataTrat.tratamientos || []);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar el plan de tratamiento")}</div>`;
  }
}

function pintarPlan(pacienteId, items) {
  const box = document.getElementById("planBox");
  if (!box) return;

  const total = items.reduce((s, i) => s + i.precio, 0);
  const pagado = items.reduce((s, i) => s + totalPagado(i), 0);
  const saldo = total - pagado;

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">💰 Plan de tratamiento</div>
      <div class="plan-resumen">
        <div><div class="plan-resumen-num">${money(total)}</div><div class="plan-resumen-lbl">Total</div></div>
        <div><div class="plan-resumen-num" style="color:var(--success)">${money(pagado)}</div><div class="plan-resumen-lbl">Pagado</div></div>
        <div><div class="plan-resumen-num" style="color:${saldo > 0 ? "var(--danger)" : "var(--success)"}">${money(saldo)}</div><div class="plan-resumen-lbl">Saldo</div></div>
      </div>
      <button class="secondary" id="btnAgregarTratamiento">➕ Agregar tratamiento</button>
      <button class="link" id="btnGestionarCatalogo">⚙️ Gestionar catálogo de precios</button>
      <div id="formTratamientoBox"></div>
      <div id="catalogoBox"></div>
    </div>

    ${items.length === 0 ? `<div class="empty">Todavía no hay tratamientos cargados.</div>` : items.map(item => itemPlanHtml(item)).join("")}
  `;

  document.getElementById("btnAgregarTratamiento").onclick = () => pintarFormNuevoTratamiento(pacienteId);
  document.getElementById("btnGestionarCatalogo").onclick = () => pintarCatalogo(pacienteId);

  document.querySelectorAll("[data-toggle-item]").forEach(el => {
    el.onclick = () => {
      const det = document.getElementById("det_" + el.dataset.toggleItem);
      if (det) det.style.display = det.style.display === "none" ? "block" : "none";
    };
  });

  items.forEach(item => wireItemPlan(pacienteId, item));
}

function itemPlanHtml(item) {
  const pagado = totalPagado(item);
  const saldo = item.precio - pagado;
  const info = ESTADO_TRATAMIENTO_INFO[item.estado] || ESTADO_TRATAMIENTO_INFO.pendiente;
  return `
    <div class="item" data-toggle-item="${item._id}" style="cursor:pointer">
      <div class="top">
        <div class="nombre">${esc(item.nombre)}${item.piezaFdi ? ` — pieza ${item.piezaFdi}` : item.regionFacial ? ` — ${esc(item.regionFacial)}` : ""}</div>
        <span class="badge ${info.clase}">${info.label}</span>
      </div>
      <div class="paciente-info">${money(item.precio)}${pagado > 0 ? ` · pagado ${money(pagado)} · saldo ${money(saldo)}` : ""}</div>
      ${item.notas ? `<div class="preview">${esc(item.notas)}</div>` : ""}
    </div>
    <div id="det_${item._id}" class="card" style="display:none;margin-top:-4px">
      <label>Estado</label>
      <select id="estado_${item._id}">
        ${Object.entries(ESTADO_TRATAMIENTO_INFO).map(([k, v]) => `<option value="${k}" ${k === item.estado ? "selected" : ""}>${v.label}</option>`).join("")}
      </select>
      <div id="errEstado_${item._id}"></div>
      <button class="link" id="btnBorrar_${item._id}" style="color:var(--danger)">Eliminar tratamiento</button>

      <div class="seccion-titulo" style="margin-top:14px">Registrar pago</div>
      <input id="montoPago_${item._id}" type="number" min="0" step="0.01" placeholder="Monto">
      <div id="errPago_${item._id}"></div>
      <button class="secondary" id="btnPagar_${item._id}">Agregar pago</button>

      ${item.pagos?.length ? `
        <div class="seccion-titulo" style="margin-top:14px">Historial de pagos</div>
        ${[...item.pagos].reverse().map(p => `
          <div class="item" style="cursor:default">
            <div class="top">
              <div class="nombre">${money(p.monto)}</div>
              <button class="link" data-borrar-pago="${item._id}:${p._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
            </div>
            <div class="fecha">${new Date(p.fecha).toLocaleDateString("es-BO")}</div>
          </div>`).join("")}
      ` : ""}
    </div>`;
}

function wireItemPlan(pacienteId, item) {
  const selEstado = document.getElementById(`estado_${item._id}`);
  if (selEstado) selEstado.onchange = async () => {
    const errBox = document.getElementById(`errEstado_${item._id}`);
    errBox.innerHTML = "";
    try {
      await api(`/medico/tratamientos/${item._id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ estado: selEstado.value }) });
      renderTabPlanTratamiento(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo actualizar")}</div>`;
    }
  };

  const btnBorrar = document.getElementById(`btnBorrar_${item._id}`);
  if (btnBorrar) btnBorrar.onclick = async () => {
    if (!confirm("¿Eliminar este tratamiento del plan?")) return;
    await api(`/medico/tratamientos/${item._id}`, { method: "DELETE" });
    renderTabPlanTratamiento(pacienteId);
  };

  const btnPagar = document.getElementById(`btnPagar_${item._id}`);
  if (btnPagar) btnPagar.onclick = async () => {
    const errBox = document.getElementById(`errPago_${item._id}`);
    errBox.innerHTML = "";
    const monto = document.getElementById(`montoPago_${item._id}`).value;
    try {
      await api(`/medico/tratamientos/${item._id}/pagos`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ monto }) });
      renderTabPlanTratamiento(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo registrar el pago")}</div>`;
    }
  };

  document.querySelectorAll(`[data-borrar-pago^="${item._id}:"]`).forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const [, pagoId] = btn.dataset.borrarPago.split(":");
      if (!confirm("¿Eliminar este pago?")) return;
      await api(`/medico/tratamientos/${item._id}/pagos/${pagoId}`, { method: "DELETE" });
      renderTabPlanTratamiento(pacienteId);
    };
  });
}

function pintarFormNuevoTratamiento(pacienteId) {
  const box = document.getElementById("formTratamientoBox");
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Nuevo tratamiento</div>
      ${CATALOGO_CACHE.length ? `
        <label>Del catálogo (opcional)</label>
        <select id="ntCatalogo">
          <option value="">— Escribir a mano —</option>
          ${CATALOGO_CACHE.map(c => `<option value="${c._id}">${esc(c.nombre)} — ${money(c.precio)}</option>`).join("")}
        </select>
      ` : ""}
      <label>Nombre</label>
      <input id="ntNombre" type="text" placeholder="Ej: Corona, Resina, Implante...">
      <label>Precio (Bs)</label>
      <input id="ntPrecio" type="number" min="0" step="0.01" placeholder="0">
      ${MEDICO_TIPO_ESPECIALIDAD === "estetica" ? `
        <label>Región del rostro (opcional)</label>
        <select id="ntRegion">
          <option value="">— Sin región —</option>
          ${REGIONES_FACIALES.map(r => `<option value="${r}">${r}</option>`).join("")}
        </select>
      ` : `
        <label>Pieza (FDI, opcional)</label>
        <input id="ntPieza" type="number" min="11" max="48" placeholder="Ej: 36">
      `}
      <label>Notas (opcional)</label>
      <input id="ntNotas" type="text" placeholder="Detalle">
      <div id="ntErr"></div>
      <button class="primary" id="btnGuardarTratamiento">Guardar</button>
    </div>`;

  const selCatalogo = document.getElementById("ntCatalogo");
  if (selCatalogo) selCatalogo.onchange = () => {
    const c = CATALOGO_CACHE.find(x => x._id === selCatalogo.value);
    if (c) { document.getElementById("ntNombre").value = c.nombre; document.getElementById("ntPrecio").value = c.precio; }
  };

  document.getElementById("btnGuardarTratamiento").onclick = async () => {
    const errBox = document.getElementById("ntErr");
    errBox.innerHTML = "";
    const nombre = document.getElementById("ntNombre").value.trim();
    const precio = document.getElementById("ntPrecio").value;
    const piezaFdi = document.getElementById("ntPieza")?.value;
    const regionFacial = document.getElementById("ntRegion")?.value;
    const notas = document.getElementById("ntNotas").value.trim();
    if (!nombre || precio === "") { errBox.innerHTML = `<div class="error">Completá nombre y precio</div>`; return; }
    try {
      await api(`/medico/pacientes/${pacienteId}/tratamientos`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ nombre, precio, piezaFdi: piezaFdi || undefined, regionFacial: regionFacial || undefined, notas }),
      });
      renderTabPlanTratamiento(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };
}

function pintarCatalogo(pacienteId) {
  const box = document.getElementById("catalogoBox");
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Catálogo de precios</div>
      <div class="hint" style="margin-bottom:10px">Se reutiliza para todos tus pacientes.</div>
      ${CATALOGO_CACHE.length === 0 ? `<div class="empty">Todavía no cargaste ningún ítem.</div>` : CATALOGO_CACHE.map(c => `
        <div class="item" style="cursor:default">
          <div class="top">
            <div class="nombre">${esc(c.nombre)} — ${money(c.precio)}</div>
            <button class="link" data-borrar-catalogo="${c._id}" style="margin:0;width:auto;color:var(--danger)">Eliminar</button>
          </div>
        </div>`).join("")}
      <label style="margin-top:14px">Nombre</label>
      <input id="catNombre" type="text" placeholder="Ej: Corona">
      <label>Precio (Bs)</label>
      <input id="catPrecio" type="number" min="0" step="0.01" placeholder="0">
      <div id="catErr"></div>
      <button class="secondary" id="btnAgregarCatalogo">➕ Agregar al catálogo</button>
    </div>`;

  document.getElementById("btnAgregarCatalogo").onclick = async () => {
    const errBox = document.getElementById("catErr");
    errBox.innerHTML = "";
    const nombre = document.getElementById("catNombre").value.trim();
    const precio = document.getElementById("catPrecio").value;
    if (!nombre || precio === "") { errBox.innerHTML = `<div class="error">Completá nombre y precio</div>`; return; }
    try {
      await api("/medico/catalogo-tratamientos", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ nombre, precio }) });
      const data = await api("/medico/catalogo-tratamientos");
      CATALOGO_CACHE = data.catalogo || [];
      pintarCatalogo(pacienteId);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };

  document.querySelectorAll("[data-borrar-catalogo]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Eliminar este ítem del catálogo?")) return;
      await api(`/medico/catalogo-tratamientos/${btn.dataset.borrarCatalogo}`, { method: "DELETE" });
      const data = await api("/medico/catalogo-tratamientos");
      CATALOGO_CACHE = data.catalogo || [];
      pintarCatalogo(pacienteId);
    };
  });
}
