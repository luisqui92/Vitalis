// Vitalis — La teleconsulta, del lado del médico.
//
// Vive en la ficha del paciente, debajo del nombre: es una forma de atender
// a ESE paciente, no una sección aparte. Una pestaña más habría quedado
// escondida entre las otras quince.
//
// La pantalla del paciente está en teleconsulta.js. Los nombres de acá van
// con prefijo teleMed* porque en Vitalis todo function de primer nivel es
// global y el último que carga gana, en silencio.

// Si el servidor tiene proveedor de video configurado. Se pregunta una sola
// vez por sesión: prometer una videollamada que después no abre es peor que
// no ofrecerla, así que si no está configurado la tarjeta no se dibuja.
let TELE_DISPONIBLE = null;

async function teleMedDisponible() {
  if (TELE_DISPONIBLE !== null) return TELE_DISPONIBLE;
  try {
    const e = await api("/medico/teleconsulta/estado");
    TELE_DISPONIBLE = Boolean(e.disponible);
  } catch {
    TELE_DISPONIBLE = false;
  }
  return TELE_DISPONIBLE;
}

function teleMedCajaHtml() {
  return `<div id="teleMedBox"></div>`;
}

async function teleMedPintar(pacienteId, pacienteTelefono) {
  const caja = document.getElementById("teleMedBox");
  if (!caja) return;
  if (!await teleMedDisponible()) { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  let lista = [];
  try {
    const r = await api("/medico/teleconsultas");
    lista = (r.teleconsultas || []).filter(t => String(t.pacienteId) === String(pacienteId));
  } catch { /* sin lista se ofrece crear igual */ }
  if (!caja.isConnected) return;

  const activa = lista.find(t => t.estado === "creada" || t.estado === "en_curso");
  caja.innerHTML = activa
    ? teleMedActivaHtml(activa)
    : `<div class="card card-secundaria">
         <div style="font-weight:600">${t("tele.titulo")}</div>
         <div class="hint" style="margin:2px 0 10px">${t("tele.ayuda")}</div>
         <button class="secondary" id="teleMedCrear">${t("tele.crear")}</button>
       </div>`;

  const crear = document.getElementById("teleMedCrear");
  if (crear) {
    crear.onclick = async () => {
      crear.disabled = true;
      try {
        await api(`/medico/pacientes/${pacienteId}/teleconsulta`, { method: "POST", body: "{}" , headers: { "Content-Type": "application/json" } });
        teleMedPintar(pacienteId, pacienteTelefono);
      } catch (e) {
        crear.disabled = false;
        caja.insertAdjacentHTML("beforeend", `<div class="error">${esc(e.error || t("tele.errCrear"))}</div>`);
      }
    };
  }
  if (activa) teleMedEnganchar(activa, pacienteId, pacienteTelefono);
}

function teleMedActivaHtml(tc) {
  const url = `${location.origin}${tc.enlace}`;
  // Que el consentimiento esté a la vista y no escondido: es lo que decide
  // si esta consulta se puede grabar, y el médico tiene que saberlo ANTES
  // de empezar a hablar, no descubrirlo después.
  const consintio = tc.consentimiento?.aceptado;
  return `
    <div class="card card-secundaria" style="border-color:var(--primary)">
      <div style="font-weight:600">${t("tele.titulo")}</div>

      <div class="saldo-aviso ${consintio ? "" : "saldo-aviso-grave"}" style="margin:8px 0">
        ${consintio ? t("tele.consintio") : t("tele.esperandoConsentimiento")}
      </div>

      <div class="hint" style="margin:0 0 6px">${t("tele.enlacePaciente")}</div>
      <input id="teleMedUrl" type="text" readonly value="${esc(url)}" style="font-size:13px">
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="secondary" id="teleMedCopiar" style="margin:0">${t("tele.copiar")}</button>
        <button class="secondary" id="teleMedWhatsapp" style="margin:0">${t("tele.porWhatsapp")}</button>
      </div>

      <button class="primary" id="teleMedEntrar" style="margin-top:10px">${t("tele.entrar")}</button>
      <button class="link" id="teleMedCancelar" style="width:auto;color:var(--danger)">${t("tele.cancelar")}</button>
    </div>`;
}

function teleMedEnganchar(tc, pacienteId, pacienteTelefono) {
  const url = `${location.origin}${tc.enlace}`;

  document.getElementById("teleMedCopiar").onclick = async () => {
    const btn = document.getElementById("teleMedCopiar");
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = t("tele.copiado");
    } catch {
      // Sin permiso de portapapeles (pasa en algunos navegadores móviles),
      // se selecciona para que se pueda copiar a mano en vez de no hacer nada.
      document.getElementById("teleMedUrl").select();
    }
  };

  document.getElementById("teleMedWhatsapp").onclick = () => {
    const texto = t("tele.mensajeWhatsapp", { enlace: url });
    const destino = String(pacienteTelefono || "").replace(/\D/g, "");
    window.open(
      destino ? `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`
              : `https://wa.me/?text=${encodeURIComponent(texto)}`,
      "_blank", "noopener");
  };

  document.getElementById("teleMedEntrar").onclick = () => teleMedEntrar(tc, pacienteId, pacienteTelefono);

  document.getElementById("teleMedCancelar").onclick = async () => {
    if (!confirm(t("tele.confirmarCancelar"))) return;
    try {
      await api(`/medico/teleconsulta/${tc._id}/cancelar`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    } catch { /* si falla, al repintar sigue apareciendo */ }
    teleMedPintar(pacienteId, pacienteTelefono);
  };
}

async function teleMedEntrar(tc, pacienteId, pacienteTelefono) {
  const btn = document.getElementById("teleMedEntrar");
  if (btn) btn.disabled = true;
  let sala;
  try {
    sala = await api(`/medico/teleconsulta/${tc._id}/entrar`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  } catch (e) {
    if (btn) btn.disabled = false;
    alert(e.error || t("tele.errEntrar"));
    return;
  }

  detenerPolling();
  app.innerHTML = `
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
        <button class="secondary" id="teleMedSalir" style="margin:0;width:auto">${t("tele.terminar")}</button>
        <div class="hint" style="margin:0">${esc(sala.pacienteNombre || "")}</div>
      </div>
      ${sala.consentimiento ? "" : `<div class="saldo-aviso saldo-aviso-grave">${t("tele.esperandoConsentimiento")}</div>`}
      <div id="teleGrabando" class="saldo-aviso" style="display:none;margin:8px 0">${t("tele.grabando")}</div>
      <div id="teleEstado" class="hint" style="margin:8px 0"></div>
      <div style="position:relative;border-radius:12px;overflow:hidden;background:#000">
        <video id="teleRemoto" playsinline autoplay style="width:100%;display:block;min-height:240px"></video>
        <video id="teleLocal" playsinline autoplay muted
          style="position:absolute;right:10px;bottom:10px;width:28%;max-width:160px;border-radius:8px;border:2px solid rgba(255,255,255,.7)"></video>
      </div>
    </div>`;

  rtcIniciar(sala, {
    idLocal: "teleLocal", idRemoto: "teleRemoto",
    alEstado: (texto, malo) => {
      const caja = document.getElementById("teleEstado");
      if (caja) { caja.textContent = texto; caja.style.color = malo ? "var(--danger)" : ""; }
    },
    // Recién cuando hay alguien del otro lado: antes no hay consulta que
    // grabar, y —más importante— el paciente no pudo haber entrado sin
    // aceptar la grabación, así que su presencia ES el consentimiento.
    alStreams: (streamMedico, streamPaciente) => {
      if (typeof teleGrabIniciar !== "function") return;
      if (teleGrabIniciar(streamMedico, streamPaciente)) {
        const aviso = document.getElementById("teleGrabando");
        if (aviso) aviso.style.display = "";
      }
    },
  });

  document.getElementById("teleMedSalir").onclick = async () => {
    const btnSalir = document.getElementById("teleMedSalir");
    if (btnSalir) btnSalir.disabled = true;

    // El orden importa: primero se cierra la grabación, DESPUÉS se cuelga.
    // Al revés, colgar apaga el micrófono y lo último que dijeron se pierde.
    const grabado = typeof teleGrabDetener === "function" ? await teleGrabDetener() : null;
    rtcColgar();

    try {
      await api(`/medico/teleconsulta/${tc._id}/terminar`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    } catch { /* volver a la ficha igual: dejarlo encerrado sería peor */ }

    if (!grabado) return renderPacienteDetalle(pacienteId);

    // Subir puede tardar. Que se vea, o el médico va a pensar que se colgó y
    // va a recargar justo cuando el audio está viajando.
    app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("tele.subiendo")}</div>`;
    try {
      const data = await subirConsulta(pacienteId, grabado.blob, grabado.mimeType, { teleconsultaId: tc._id });
      renderDetalle(data.consulta._id);
    } catch (e) {
      // La consulta ya pasó y el audio existe. Perderlo por un error de red
      // sería lo peor que puede hacer esta pantalla, así que se ofrece
      // reintentar con la grabación todavía en memoria.
      teleMedOfrecerReintento(grabado, pacienteId, tc._id, e);
    }
  };
}

function teleMedOfrecerReintento(grabado, pacienteId, teleconsultaId, error) {
  app.innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:20px 0">
      <div class="error">${esc(error?.error || t("tele.errSubirGrabacion"))}</div>
      <div class="hint" style="margin:10px 0">${t("tele.grabacionEnMemoria")}</div>
      <button class="primary" id="teleMedReintentar">${t("tele.reintentarSubida")}</button>
      <button class="link" id="teleMedDescartar" style="color:var(--danger)">${t("tele.descartarGrabacion")}</button>
    </div>`;

  document.getElementById("teleMedReintentar").onclick = async () => {
    const btn = document.getElementById("teleMedReintentar");
    btn.disabled = true;
    btn.textContent = t("tele.subiendo");
    try {
      const data = await subirConsulta(pacienteId, grabado.blob, grabado.mimeType, { teleconsultaId });
      renderDetalle(data.consulta._id);
    } catch (e) {
      teleMedOfrecerReintento(grabado, pacienteId, teleconsultaId, e);
    }
  };
  document.getElementById("teleMedDescartar").onclick = () => {
    if (!confirm(t("tele.confirmarDescartar"))) return;
    renderPacienteDetalle(pacienteId);
  };
}
