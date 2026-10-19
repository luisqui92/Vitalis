// Symphomed — Receta Digital: se arma desde una consulta o a mano, y se
// imprime/descarga como PDF con el diálogo nativo del navegador (sin sumar
// una librería de PDF en el servidor solo para esto).

function filaMedicamentoHtml() {
  return `
    <div class="rec-row">
      <input class="recNombre" type="text" placeholder="${t("receta.med.nombre")}">
      <input class="recDosis" type="text" placeholder="${t("receta.med.dosis")}" style="margin-top:8px">
      <input class="recFrecuencia" type="text" placeholder="${t("receta.med.frecuencia")}" style="margin-top:8px">
      <input class="recDuracion" type="text" placeholder="${t("receta.med.duracion")}" style="margin-top:8px">
      <button type="button" class="quitar-fila">${t("receta.quitar")}</button>
    </div>`;
}

function tabRecetasHtml(recetas) {
  return `
    <div id="memedBox"></div>
    <div class="card" id="recetaNuevaBox">
      <div class="seccion-titulo" style="margin-top:0">${t("receta.nueva")}</div>
      <label>${t("receta.fecha")}</label>
      <input id="recFecha" type="date" value="${fechaCalendarioLocal()}">
      <div id="recRows">${filaMedicamentoHtml()}</div>
      <button type="button" class="link" id="btnAgregarFila">${t("receta.agregarFila")}</button>
      <label>${t("receta.indicaciones")}</label>
      <textarea id="recIndicaciones" rows="3" placeholder="${t("receta.indicacionesPlaceholder")}"></textarea>
      <div id="recErr"></div>
      <button class="secondary" id="btnGuardarReceta">${t("receta.guardar")}</button>
    </div>
    ${recetas.length === 0 ? `<div class="empty">${t("receta.vacio")}</div>` : ""}
    ${recetas.map(r => `
      <div class="item" data-ver-receta="${r._id}"${r.anuladaEn ? ' style="opacity:.65"' : ""}>
        <div class="top">
          <div class="nombre">${marcaAnulada(r)}${r.origen === "memed" ? `<span class="badge badge-completado">${t("memed.firmada")}</span> ` : ""}${esc(r.medicamentos.map(m => m.nombre).join(", "))}</div>
          ${r.anuladaEn ? "" : `<button class="link" data-anular-receta="${r._id}" data-memed="${r.origen === "memed" ? "1" : ""}" title="${t("receta.anular")}" style="margin:0;width:auto;color:var(--danger)">✕</button>`}
        </div>
        <div class="fecha">${fechaCorta(r.fechaCivil || r.fecha)}</div>${motivoAnulada(r)}
      </div>`).join("")}
    ${MEDICO_TIPO_ESPECIALIDAD === "oftalmologia" ? `<div id="recetaOpticaBox" style="margin-top:18px"></div>` : ""}
  `;
}

// ─── ANULADAS ────────────────────────────────────────────────────────────
// Una receta emitida no se borra, se anula: sigue en la lista, marcada, con
// el motivo, y ya no se puede imprimir desde acá.
function marcaAnulada(r) {
  return r.anuladaEn ? `<span class="badge badge-error">${t("receta.anulada")}</span> ` : "";
}
function motivoAnulada(r) {
  return r.anuladaEn ? `<div class="hint">${esc(t("receta.anuladaMotivo", { fecha: fechaCorta(r.anuladaEn), motivo: r.anuladaMotivo || "—" }))}</div>` : "";
}
function avisoAnuladaHtml(r) {
  return r.anuladaEn ? `
    <div style="border:2px solid var(--danger);color:var(--danger);border-radius:8px;padding:10px;margin-bottom:16px;text-align:center;font-weight:700">
      ${esc(t("receta.anuladaMotivo", { fecha: fechaCorta(r.anuladaEn), motivo: r.anuladaMotivo || "—" }))}
    </div>` : "";
}

// El motivo es obligatorio en el servidor: se pide acá para no hacérselo
// descubrir con un error después de decidir. Devuelve true si se anuló.
async function anularRecetaConMotivo(ruta, pregunta) {
  const motivo = prompt(pregunta);
  if (motivo === null) return false;
  if (!motivo.trim()) { alert(t("receta.errMotivo")); return false; }
  try {
    await api(ruta, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: motivo.trim() }),
    });
    return true;
  } catch (e) {
    alert(e.error || t("receta.errAnular"));
    return false;
  }
}

// ─── RECETA ÓPTICA (Symphomed Visión) — esfera/cilindro/eje/adición por ojo,
// completamente distinta a una receta de medicamentos. ──────────────────
function campoOjoOpticaHtml(prefijo, label) {
  return `
    <div style="flex:1;min-width:120px">
      <div class="hint" style="margin-bottom:4px;font-weight:600">${label}</div>
      <input id="${prefijo}Esfera" type="number" step="0.25" placeholder="${t("optica.esfera")}">
      <input id="${prefijo}Cilindro" type="number" step="0.25" placeholder="${t("optica.cilindro")}" style="margin-top:6px">
      <input id="${prefijo}Eje" type="number" min="0" max="180" placeholder="${t("optica.eje")}" style="margin-top:6px">
      <input id="${prefijo}Adicion" type="number" step="0.25" placeholder="${t("optica.adicion")}" style="margin-top:6px">
    </div>`;
}

async function renderRecetaOpticaBox(pacienteId) {
  const box = document.getElementById("recetaOpticaBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>${t("optica.cargando")}</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/recetas-opticas`);
    pintarRecetaOpticaBox(pacienteId, data.recetas || []);
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(e.error || t("optica.errCargar"))}</div>`;
  }
}

function pintarRecetaOpticaBox(pacienteId, recetas) {
  const box = document.getElementById("recetaOpticaBox");
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("optica.nueva")}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${campoOjoOpticaHtml("ro_od", "OD")}
        ${campoOjoOpticaHtml("ro_oi", "OI")}
      </div>
      <label>${t("optica.dp")}</label>
      <input id="ro_dp" type="number" step="0.5" placeholder="${t("optica.dpPlaceholder")}">
      <label>${t("receta.fecha")}</label>
      <input id="ro_fecha" type="date" value="${fechaCalendarioLocal()}">
      <label>${t("optica.notas")}</label>
      <input id="ro_notas" type="text" placeholder="${t("optica.notasPlaceholder")}">
      <div id="ro_err"></div>
      <button class="secondary" id="btnGuardarRecetaOptica">${t("optica.guardar")}</button>
    </div>
    ${recetas.length === 0 ? `<div class="empty">${t("optica.vacio")}</div>` : ""}
    ${recetas.map(r => `
      <div class="item" data-ver-receta-optica="${r._id}"${r.anuladaEn ? ' style="opacity:.65"' : ""}>
        <div class="top">
          <div class="nombre">${marcaAnulada(r)}OD ${r.od.esfera ?? "—"} / OI ${r.oi.esfera ?? "—"}</div>
          ${r.anuladaEn ? "" : `<button class="link" data-anular-receta-optica="${r._id}" title="${t("receta.anular")}" style="margin:0;width:auto;color:var(--danger)">✕</button>`}
        </div>
        <div class="fecha">${fechaCorta(r.fechaCivil || r.fecha)}</div>${motivoAnulada(r)}
      </div>`).join("")}
  `;

  document.getElementById("btnGuardarRecetaOptica").onclick = async () => {
    const errBox = document.getElementById("ro_err");
    errBox.innerHTML = "";
    const val = (id) => { const v = document.getElementById(id).value; return v === "" ? undefined : v; };
    const od = { esfera: val("ro_odEsfera"), cilindro: val("ro_odCilindro"), eje: val("ro_odEje"), adicion: val("ro_odAdicion") };
    const oi = { esfera: val("ro_oiEsfera"), cilindro: val("ro_oiCilindro"), eje: val("ro_oiEje"), adicion: val("ro_oiAdicion") };
    if (!od.esfera && !od.cilindro && !oi.esfera && !oi.cilindro) {
      errBox.innerHTML = `<div class="error">${t("optica.errSinDatos")}</div>`;
      return;
    }
    const btn = document.getElementById("btnGuardarRecetaOptica");
    btn.disabled = true;
    btn.textContent = t("receta.guardando");
    try {
      await api(`/medico/pacientes/${pacienteId}/recetas-opticas`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ od, oi, distanciaPupilar: val("ro_dp"), fecha: document.getElementById("ro_fecha").value, notas: document.getElementById("ro_notas").value.trim() }),
      });
      renderRecetaOpticaBox(pacienteId);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = t("optica.guardar");
      errBox.innerHTML = `<div class="error">${esc(e.error || t("optica.errGuardar"))}</div>`;
    }
  };

  document.querySelectorAll("[data-ver-receta-optica]").forEach(el => {
    el.onclick = () => renderRecetaOptica(el.dataset.verRecetaOptica);
  });
  document.querySelectorAll("[data-anular-receta-optica]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (await anularRecetaConMotivo("/medico/recetas-opticas/" + btn.dataset.anularRecetaOptica, t("optica.motivoAnular"))) {
        renderRecetaOpticaBox(pacienteId);
      }
    };
  });
}

async function renderRecetaOptica(id) {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("receta.cargando")}</div>`;
  try {
    const { receta, paciente, medico } = await api("/medico/recetas-opticas/" + id);
    const edad = edadDesde(paciente.fechaNacimiento);
    const filaOjo = (label, o) => `
      <tr><td style="padding:4px 10px;font-weight:700">${label}</td>
        <td style="padding:4px 10px">${o.esfera ?? "—"}</td><td style="padding:4px 10px">${o.cilindro ?? "—"}</td>
        <td style="padding:4px 10px">${o.eje ?? "—"}°</td><td style="padding:4px 10px">${o.adicion ?? "—"}</td></tr>`;

    app.innerHTML = `
      <button class="back no-imprimir" id="btnBack">${t("receta.volver")}</button>
      <div class="card" style="padding:28px">
        <div style="text-align:center;margin-bottom:18px">
          <img src="/img/simbolo.webp" alt="" style="width:44px;height:44px;object-fit:contain">
          <div style="font-size:16px;font-weight:700;color:var(--primary);margin-top:4px">${t("marca.oftalmologia")}</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:12px">
          <div><b>${esc(medico.nombre)}</b>${medico.especialidad ? `<div>${esc(medico.especialidad)}</div>` : ""}</div>
          <div>${fechaCorta(receta.fechaCivil || receta.fecha)}</div>
        </div>
        ${avisoAnuladaHtml(receta)}
        <div style="font-size:13px;margin-bottom:20px"><b>${t("receta.paciente")}</b> ${esc(paciente.nombre)}${edad != null ? " · " + t("pacientes.anos", { n: edad }) : ""}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr><th></th><th style="padding:4px 10px;text-align:left">${t("optica.esfera")}</th><th style="padding:4px 10px;text-align:left">${t("optica.cilindro")}</th><th style="padding:4px 10px;text-align:left">${t("optica.ejeCorto")}</th><th style="padding:4px 10px;text-align:left">${t("optica.adicion")}</th></tr></thead>
          <tbody>${filaOjo("OD", receta.od)}${filaOjo("OI", receta.oi)}</tbody>
        </table>
        ${receta.distanciaPupilar ? `<div style="font-size:13px;margin-top:14px"><b>${t("optica.dpTitulo")}</b> ${receta.distanciaPupilar} mm</div>` : ""}
        ${receta.notas ? `<div style="font-size:13px;margin-top:10px;white-space:pre-wrap">${esc(receta.notas)}</div>` : ""}
      </div>
      ${receta.anuladaEn ? "" : `<button class="secondary no-imprimir" id="btnImprimirRecetaOptica">${t("receta.imprimir")}</button>`}
    `;
    document.getElementById("btnBack").onclick = () => renderPacienteDetalle(receta.pacienteId, "recetas");
    const btnImprimir = document.getElementById("btnImprimirRecetaOptica");
    if (btnImprimir) btnImprimir.onclick = () => window.print();
  } catch (e) {
    if (e.status === 401) return logout();
    if (typeof reportarError === "function") reportarError(e, "renderRecetaOptica");
    app.innerHTML = `<div class="error">${esc(e.error || t("optica.errCargarUna"))}</div>`;
  }
}

function wireTabRecetas(p, recetas) {
  if (MEDICO_TIPO_ESPECIALIDAD === "oftalmologia") renderRecetaOpticaBox(p._id);
  // Sin await: si la consulta tarda o falla, la pestaña se abre igual con la
  // receta de siempre. Lo que no puede pasar es lo contrario —quedar sin
  // ninguna forma de recetar porque una consulta no volvió.
  if (typeof memedPintarCaja === "function") memedPintarCaja(p._id);

  document.getElementById("btnAgregarFila").onclick = () => {
    document.getElementById("recRows").insertAdjacentHTML("beforeend", filaMedicamentoHtml());
  };

  document.getElementById("recRows").addEventListener("click", (e) => {
    if (e.target.classList.contains("quitar-fila")) {
      const filas = document.querySelectorAll(".rec-row");
      if (filas.length > 1) e.target.closest(".rec-row").remove();
    }
  });

  document.getElementById("btnGuardarReceta").onclick = async () => {
    const errBox = document.getElementById("recErr");
    errBox.innerHTML = "";
    const medicamentos = [...document.querySelectorAll(".rec-row")].map(fila => ({
      nombre: fila.querySelector(".recNombre").value.trim(),
      dosis: fila.querySelector(".recDosis").value.trim(),
      frecuencia: fila.querySelector(".recFrecuencia").value.trim(),
      duracion: fila.querySelector(".recDuracion").value.trim(),
    })).filter(m => m.nombre);

    if (medicamentos.length === 0) { errBox.innerHTML = `<div class="error">${t("receta.errSinMedicamentos")}</div>`; return; }

    const btn = document.getElementById("btnGuardarReceta");
    btn.disabled = true;
    btn.textContent = t("receta.guardando");
    try {
      const data = await api("/medico/pacientes/" + p._id + "/recetas", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          medicamentos,
          indicaciones: document.getElementById("recIndicaciones").value.trim(),
          fecha: document.getElementById("recFecha").value,
        }),
      });
      renderReceta(data.receta._id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = t("receta.guardar");
      errBox.innerHTML = `<div class="error">${esc(e.error || t("receta.errGuardar"))}</div>`;
    }
  };

  document.querySelectorAll("[data-ver-receta]").forEach(el => {
    el.onclick = () => renderReceta(el.dataset.verReceta);
  });
  document.querySelectorAll("[data-anular-receta]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      // La de Memed es un documento firmado que vive allá: anularla acá no
      // la anula en Memed, y la pregunta lo dice.
      const pregunta = t(btn.dataset.memed ? "receta.motivoAnularMemed" : "receta.motivoAnular");
      if (await anularRecetaConMotivo("/medico/recetas/" + btn.dataset.anularReceta, pregunta)) {
        renderPacienteDetalle(p._id, "recetas");
      }
    };
  });
}

// ─── VER/IMPRIMIR UNA RECETA ─────────────────────────────────────────────
async function renderReceta(id) {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("receta.cargando")}</div>`;
  try {
    const data = await api("/medico/recetas/" + id);
    const { receta, paciente, medico } = data;
    const edad = edadDesde(paciente.fechaNacimiento);
    // El registro profesional va en la receta: en papel, es lo que la hace
    // válida junto con la firma (CRM-SP 123456 en Brasil, la matrícula en
    // Bolivia). El consejo partido, si lo cargó; si no, el texto libre.
    const c = medico.conselho || {};
    const registro = c.sigla && c.uf && c.numero ? `${c.sigla}-${c.uf} ${c.numero}` : (medico.matricula || "");

    app.innerHTML = `
      <button class="back no-imprimir" id="btnBack">${t("receta.volver")}</button>
      <div class="card" id="recetaHoja" style="padding:28px">
        <div style="text-align:center;margin-bottom:18px">
          <img src="/img/simbolo.webp" alt="" style="width:44px;height:44px;object-fit:contain">
          <div style="font-size:16px;font-weight:700;color:var(--primary);margin-top:4px">${t("marca.base")}</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:12px">
          <div>
            <div><b>${esc(medico.nombre)}</b></div>
            ${medico.especialidad ? `<div>${esc(medico.especialidad)}</div>` : ""}
            ${registro ? `<div>${esc(registro)}</div>` : ""}
          </div>
          <div>${fechaCorta(receta.fechaCivil || receta.fecha)}</div>
        </div>
        ${avisoAnuladaHtml(receta)}
        <div style="font-size:13px;margin-bottom:20px">
          <b>${t("receta.paciente")}</b> ${esc(paciente.nombre)}${edad != null ? " · " + t("pacientes.anos", { n: edad }) : ""}${paciente.sexo ? " · " + esc(paciente.sexo) : ""}
        </div>
        <div class="seccion-titulo" style="margin-top:0">${t("receta.rp")}</div>
        ${receta.medicamentos.map((m, i) => `
          <div style="margin-bottom:14px">
            <div style="font-weight:600">${i + 1}. ${esc(m.nombre)}${m.dosis ? " — " + esc(m.dosis) : ""}</div>
            ${(m.frecuencia || m.duracion) ? `<div style="font-size:13px;color:var(--text-muted)">${[m.frecuencia, m.duracion].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
          </div>`).join("")}
        ${receta.indicaciones ? `
          <div class="seccion-titulo">${t("receta.indicacionesTitulo")}</div>
          <div style="font-size:13px;white-space:pre-wrap">${esc(receta.indicaciones)}</div>` : ""}
        <div class="receta-firma">
          <div class="receta-firma-linea"></div>
          <div><b>${esc(medico.nombre)}</b></div>
          ${registro ? `<div>${esc(registro)}</div>` : ""}
          <div class="receta-firma-pie">${t("receta.firma")}</div>
        </div>
      </div>
      ${receta.anuladaEn ? "" : `<button class="secondary no-imprimir" id="btnImprimirReceta">${t("receta.imprimir")}</button>`}
    `;
    document.getElementById("btnBack").onclick = () => renderPacienteDetalle(receta.pacienteId, "recetas");
    const btnImprimir = document.getElementById("btnImprimirReceta");
    if (btnImprimir) btnImprimir.onclick = () => window.print();
  } catch (e) {
    if (e.status === 401) return logout();
    if (typeof reportarError === "function") reportarError(e, "renderReceta");
    app.innerHTML = `<div class="error">${esc(e.error || t("receta.errCargar"))}</div>`;
  }
}
