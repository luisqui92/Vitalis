// Symphomed — Pantalla de Seguridad: activar/desactivar 2FA y ver el
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
    // Aparte y sin await: si los respaldos tardan o fallan, la pantalla de
    // seguridad tiene que aparecer igual.
    pintarEstadoBackups();
    pintarSaldo();
    // Sin await, como los demás: si Memed no contesta, Configuración se abre
    // igual. Y en cuentas que no recetan por Memed no dibuja nada.
    if (typeof memedPintarConsejo === "function") memedPintarConsejo();
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando seguridad")}</div>`;
  }
}

function pintarSeguridad(dosFAActivo, eventos) {
  app.innerHTML = `
    <button class="back" id="btnBack">← Panel</button>

    <div id="saldoBox"></div>
    <!-- Solo en cuentas brasileñas: el consejo profesional con el que se
         firman las recetas. Se llena en renderSeguridad. -->
    <div id="memedConsejoBox"></div>

    ${notificacionesHtml()}

    <div id="backupsBox"></div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("config.idioma.titulo")}</div>
      <div class="hint" style="margin-bottom:10px">${t("config.idioma.ayuda")}</div>
      <select id="segIdioma">
        <option value="es" ${MEDICO_IDIOMA === "es" ? "selected" : ""}>Español</option>
        <option value="pt" ${MEDICO_IDIOMA === "pt" ? "selected" : ""}>Português</option>
      </select>
      <div id="segIdiomaErr"></div>
      <button class="secondary" id="btnGuardarIdioma">${t("config.idioma.guardar")}</button>
    </div>

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

  // No siempre "el panel" es el de pacientes: ver volverAlPanel(). Una cuenta
  // administrativa que llegó acá a activar su 2FA tiene que poder salir a su
  // propia pantalla y no a una que le va a contestar 403.
  document.getElementById("btnBack").onclick = volverAlPanel;

  document.getElementById("btnGuardarIdioma").onclick = async () => {
    const errBox = document.getElementById("segIdiomaErr");
    errBox.innerHTML = "";
    const idioma = document.getElementById("segIdioma").value;
    try {
      await api("/medico/idioma", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idioma }),
      });
      // Se fija recién cuando el servidor confirmó: si guardáramos antes, la
      // pantalla quedaría en un idioma que la cuenta no tiene.
      fijarIdioma(idioma);
      renderSeguridad();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("config.idioma.errGuardar"))}</div>`;
    }
  };
  wireNotificaciones();

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


// ─── COPIAS DE SEGURIDAD ──────────────────────────────────────────────────
// Un respaldo que anda pero que nadie mira es medio respaldo. Esto está en
// la pantalla donde el médico ya entra, y se pone rojo solo cuando hay algo
// de qué preocuparse — el resto del tiempo es una línea tranquila.
const PROBLEMAS_BACKUP = {
  nunca_se_hizo: "Todavía no se hizo ninguna copia de seguridad.",
  ultimo_fallo: "La última copia no pasó la verificación. Revisá los logs del servidor.",
  desactualizado: "Hace más de 48 horas que no se hace una copia.",
};

function hace(horas) {
  if (horas == null) return "";
  if (horas < 1) return "hace " + Math.max(1, Math.round(horas * 60)) + " min";
  if (horas < 48) return "hace " + Math.round(horas) + " h";
  return "hace " + Math.round(horas / 24) + " días";
}

function pesoLegible(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes > 1024) return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

async function pintarEstadoBackups() {
  const caja = document.getElementById("backupsBox");
  if (!caja) return;
  let e;
  try {
    e = await api("/medico/backups");
  } catch { return; }

  const u = e.ultimo;
  const problema = e.problema ? PROBLEMAS_BACKUP[e.problema] : null;

  caja.innerHTML = `
    <div class="card"${problema ? ' style="border-color:var(--danger)"' : ""}>
      <div class="seccion-titulo" style="margin-top:0">💾 Copias de seguridad</div>

      ${problema ? `<div class="error" style="margin-bottom:10px">${esc(problema)}</div>` : ""}

      ${u ? `
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <div style="font-weight:600">${u.verificado === true ? "✅ Verificada" : u.verificado === false ? "❌ Falló la verificación" : "Sin verificar"}</div>
          <div class="hint" style="margin:0">${esc(hace(e.horasDesdeUltimo))}</div>
        </div>
        <div class="hint" style="margin-top:4px">
          ${u.documentos.toLocaleString("es-BO")} registros · ${u.archivos} archivos · ${esc(pesoLegible(u.bytes))} · tardó ${u.segundos}s
        </div>
        <div class="hint" style="margin-top:2px">
          ${e.cuantos} ${e.cuantos === 1 ? "copia guardada" : "copias guardadas"} ·
          ${u.cifrado ? "cifradas" : '<span style="color:var(--warning)">sin cifrar</span>'} ·
          ${e.afuera ? "se envían fuera del servidor" : '<span style="color:var(--warning)">solo en este servidor</span>'}
        </div>
      ` : `<div class="hint">Todavía no hay ninguna copia.</div>`}

      ${!e.afuera ? `
        <div class="hint" style="margin-top:10px;color:var(--warning)">
          Ojo: una copia en el mismo disco protege de un borrado por error, no de que el
          disco se muera. Falta configurar el envío a otro lado.
        </div>` : ""}

      <div id="backupErr"></div>
      <button class="secondary" id="btnBackupAhora" style="margin-top:10px">Hacer una copia ahora</button>
    </div>`;

  document.getElementById("btnBackupAhora").onclick = async () => {
    const btn = document.getElementById("btnBackupAhora");
    btn.disabled = true;
    btn.textContent = "Copiando y verificando...";
    try {
      const r = await api("/medico/backups", { method: "POST" });
      alert(r.verificado === true
        ? `Listo: ${r.documentos} registros y ${r.archivos} archivos.\n\nSe restauró en una base de prueba para comprobar que sirve, y salió bien.`
        : `La copia se hizo pero NO pasó la verificación. Avisale a soporte antes de confiar en ella.`);
      pintarEstadoBackups();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Hacer una copia ahora";
      const caja2 = document.getElementById("backupErr");
      if (caja2) caja2.innerHTML = `<div class="error">${esc(err.error || "No se pudo hacer la copia")}</div>`;
    }
  };
}
