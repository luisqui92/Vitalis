// Los tickets de solicitud solo viven en esta vista, nunca en localStorage.
function camposProfesionalesHtml(p, d = {}) {
  const campo = (s, label, max, valor = "", extra = "") => `<label for="${p}${s}">${t(label)}</label><input id="${p}${s}" maxlength="${max}" value="${esc(valor)}" ${extra}>`;
  return campo("Pais", "perfil.pais", 2, d.pais || "", 'placeholder="BO / BR" autocapitalize="characters"') + campo("Profesion", "perfil.profesion", 100, d.profesion || "") +
    `<label for="${p}Area">${t("auth.reg.area")}</label><select id="${p}Area"><option value="">${t("perfil.seleccionar")}</option>${AREAS.map(a => `<option value="${a}" ${d.tipoEspecialidad === a ? "selected" : ""}>${t("area." + a)}</option>`).join("")}</select>` +
    campo("Matricula", "auth.reg.matricula", 60, d.matricula || "") +
    `<label for="${p}Etapa">${t("perfil.etapa")}</label><select id="${p}Etapa"><option value="profesional">${t("google.profesional")}</option><option value="residente" ${d.etapa === "residente" ? "selected" : ""}>${t("est.nivel.residente")}</option></select><p class="hint">${t("perfil.residenteAyuda")}</p><p class="hint">${t("google.aprobacion")}</p>`;
}
function leerCamposProfesionales(p) {
  const val = s => document.getElementById(p + s).value.trim();
  return { pais: val("Pais").toUpperCase(), profesion: val("Profesion"), tipoEspecialidad: val("Area"), matricula: val("Matricula"), etapa: val("Etapa") };
}
function pintarContactoTelefono(caja, datos) {
  if (!caja) return;
  caja.innerHTML = `<p>${esc(datos.phone || "")}</p><p class="hint">${t(datos.telefonoVerificado ? "perfil.telefonoVerificado" : "perfil.contactoSinVerificar")}</p>`;
}
function renderSolicitudGoogle(datos) {
  detenerPolling(); ++GOOGLE_VISTA;
  app.innerHTML = `<div class="card reg-card"><h2>${t(datos.estado === "rechazada" ? "perfil.rechazada" : "google.pendiente")}</h2><p>${t("perfil.solicitudAyuda")}</p>${datos.motivo ? `<p class="error">${esc(datos.motivo)}</p>` : ""}
    <div id="solTelefono"></div><details><summary>${t("perfil.completarSolicitud")}</summary>${camposProfesionalesHtml("sol", datos.datos || {})}<button class="primary" id="solActualizar">${t("perfil.enviarRevision")}</button><div id="solError" role="status"></div></details>
    <button class="link" id="solVolver">${t("auth.ingresar")}</button></div>`;
  pintarContactoTelefono(document.getElementById("solTelefono"), datos);
  document.getElementById("solVolver").onclick = renderLogin;
  const btn = document.getElementById("solActualizar");
  btn.onclick = async () => {
    btn.disabled = true; const err = document.getElementById("solError");
    try {
      await api("/medico/google/solicitud/actualizar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...leerCamposProfesionales("sol"), solicitudTicket: datos.solicitudTicket }) });
      if (btn.isConnected) err.textContent = t("perfil.revisionEnviada");
    } catch (e) { if (btn.isConnected) { err.textContent = e.error || t("google.error"); btn.disabled = false; } }
  };
}
async function pintarPerfilAcceso() {
  const caja = document.getElementById("perfilAcceso"); if (!caja) return;
  try {
    const d = await api("/medico/perfil-acceso"); if (!caja.isConnected) return;
    const conversion = d.solicitud?.tipo === "conversion";
    caja.innerHTML = `<div class="card"><div class="seccion-titulo">${t("perfil.miPerfil")}</div><p>${t(d.perfil === "educativo" ? "google.estudiante" : "google.profesional")}${d.formacion?.nivel === "residente" ? ` · ${t("est.nivel.residente")}` : ""}</p><p class="hint">${t("perfil.habilitacion")} ${t("perfil.estado." + d.habilitacion)}</p><div id="perfilTelefono"></div>
      ${conversion ? `<p>${t("perfil.solicitudEstado")} ${t("perfil.solicitud." + d.solicitud.estado)}</p>${d.solicitud.motivo ? `<p>${esc(d.solicitud.motivo)}</p>` : ""}` : ""}
      ${d.perfil === "educativo" && !(conversion && d.solicitud.estado === "pendiente") ? `<details><summary>${t("perfil.solicitarProfesional")}</summary><p>${t("perfil.conversionAyuda")}</p>${camposProfesionalesHtml("conv")}<button id="convEnviar" class="primary">${t("perfil.enviarRevision")}</button><div id="convError" role="status"></div></details>` : ""}
      ${conversion && d.solicitud.estado === "pendiente" ? `<p class="hint">${t("perfil.sigueEducativo")}</p>` : ""}</div>`;
    pintarContactoTelefono(document.getElementById("perfilTelefono"), d);
    const btn = document.getElementById("convEnviar");
    if (btn) btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api("/medico/perfil-acceso/solicitar-profesional", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(leerCamposProfesionales("conv")) });
        if (caja.isConnected) await pintarPerfilAcceso();
      } catch (e) { if (btn.isConnected) { document.getElementById("convError").textContent = e.error || t("google.error"); btn.disabled = false; } }
    };
  } catch (e) { if (caja.isConnected) caja.innerHTML = `<div class="error">${esc(e.error || t("google.error"))}</div>`; }
}
