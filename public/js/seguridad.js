// Vitalis — Pantalla de Seguridad: activar/desactivar 2FA y ver el
// registro de auditoría de la propia cuenta (quién entró, qué pacientes se
// vieron, etc.)

const ACCION_LABEL = {
  login: "🔓 Inicio de sesión",
  login_fallido: "⛔ Intento de inicio de sesión fallido",
  login_2fa_fallido: "⛔ Código 2FA incorrecto",
  registro: "🆕 Cuenta creada",
  ver_paciente: "👤 Vio la ficha de un paciente",
  ver_consulta: "🎙️ Vio la transcripción de una consulta",
  "2fa_activado": "🔐 2FA activado",
  "2fa_desactivado": "🔓 2FA desactivado",
};

async function renderSeguridad() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const [estado2fa, dataAuditoria] = await Promise.all([
      api("/medico/2fa/estado"),
      api("/medico/auditoria"),
    ]);
    pintarSeguridad(estado2fa.activo, dataAuditoria.eventos || []);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando seguridad")}</div>`;
  }
}

function pintarSeguridad(dosFAActivo, eventos) {
  app.innerHTML = `
    <button class="back" id="btnBack">← Panel</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">🔐 Verificación en dos pasos (2FA)</div>
      ${dosFAActivo ? `
        <div class="hint" style="color:var(--success);margin-bottom:10px">✅ Activada — además de tu contraseña, se pide un código de tu app autenticadora al ingresar.</div>
        <label>Confirmá tu contraseña para desactivarla</label>
        <input id="segPassDesactivar" type="password" placeholder="••••••••">
        <div id="segErrDesactivar"></div>
        <button class="secondary" id="btnDesactivar2FA" style="color:var(--danger)">Desactivar 2FA</button>
      ` : `
        <div class="hint" style="margin-bottom:10px">No está activada. Se recomienda activarla — protege tu cuenta aunque alguien llegue a saber tu contraseña.</div>
        <button class="secondary" id="btnActivar2FA">Activar 2FA</button>
      `}
      <div id="seg2faSetup"></div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">📋 Actividad reciente de la cuenta</div>
      ${eventos.length === 0 ? `<div class="hint">Todavía no hay actividad registrada.</div>` : eventos.map(ev => `
        <div class="item" style="cursor:default">
          <div class="top">
            <div class="nombre" style="font-size:13px">${esc(ACCION_LABEL[ev.accion] || ev.accion)}</div>
            ${ev.exito === false ? `<span class="badge badge-error">falló</span>` : ""}
          </div>
          <div class="fecha">${new Date(ev.createdAt).toLocaleString("es-BO")} · IP ${esc(ev.ip || "—")}</div>
        </div>`).join("")}
    </div>`;

  document.getElementById("btnBack").onclick = renderDashboard;

  const btnActivar = document.getElementById("btnActivar2FA");
  if (btnActivar) btnActivar.onclick = () => iniciarActivacion2FA();

  const btnDesactivar = document.getElementById("btnDesactivar2FA");
  if (btnDesactivar) btnDesactivar.onclick = async () => {
    const errBox = document.getElementById("segErrDesactivar");
    errBox.innerHTML = "";
    const password = document.getElementById("segPassDesactivar").value;
    try {
      await api("/medico/2fa/desactivar", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ password }) });
      renderSeguridad();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo desactivar")}</div>`;
    }
  };
}

async function iniciarActivacion2FA() {
  const box = document.getElementById("seg2faSetup");
  box.innerHTML = `<div class="hint" style="margin-top:14px">Generando código...</div>`;
  try {
    const data = await api("/medico/2fa/iniciar", { method: "POST" });
    box.innerHTML = `
      <div class="hint" style="margin:14px 0 10px">1. Escaneá este código con Google Authenticator, Authy, o cualquier app similar.</div>
      <img src="${data.qr}" style="width:180px;display:block;margin:0 auto 10px;border-radius:8px">
      <div class="hint" style="text-align:center;margin-bottom:14px">¿No podés escanear? Ingresá este código a mano: <br><b style="letter-spacing:1px">${esc(data.secreto)}</b></div>
      <label>2. Escribí el código de 6 dígitos que te muestra la app</label>
      <input id="seg2faCodigo" type="tel" inputmode="numeric" maxlength="6" placeholder="000000" style="text-align:center;font-size:22px;letter-spacing:6px">
      <div id="seg2faErr"></div>
      <button class="primary" id="btnConfirmar2FA">Confirmar y activar</button>`;
    document.getElementById("btnConfirmar2FA").onclick = async () => {
      const errBox = document.getElementById("seg2faErr");
      errBox.innerHTML = "";
      const codigo = document.getElementById("seg2faCodigo").value.trim();
      try {
        await api("/medico/2fa/confirmar", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ codigo }) });
        renderSeguridad();
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || "Código incorrecto")}</div>`;
      }
    };
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(e.error || "No se pudo generar el código")}</div>`;
  }
}
