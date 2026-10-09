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
    pintarFotoPerfil();
    // Solo si esta cuenta maneja saldo (public/js/extensiones.js → puede):
    // una cuenta de estudiante, por ejemplo, entra con un código.
    if (puede("saldo")) pintarSaldo();
    // Sin await, como los demás: si Memed no contesta, Configuración se abre
    // igual. Y en cuentas que no recetan por Memed no dibuja nada.
    if (typeof memedPintarConsejo === "function") memedPintarConsejo();
    // Mismo corte que ya usa el servidor para esta puerta (requireAuth de
    // /medico/baja/solicitar): un director es "medico" para el token igual
    // que un médico de a pie — ver el comentario de tokenDeMedico en
    // services/sesionMedico.js. Solo el personal administrativo (rol "admin") no tiene
    // este botón, porque esa cuenta no la creó por su cuenta: la dio de alta
    // el director de la clínica, así que no es sobre ella que rige 5.1.1(v).
    if (typeof MEDICO_ROL === "undefined" || MEDICO_ROL !== "admin") pintarCerrarCuenta();
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando seguridad")}</div>`;
  }
}

function pintarSeguridad(dosFAActivo, eventos) {
  app.innerHTML = `
    <button class="back" id="btnBack">← Panel</button>

    <div id="fotoPerfilBox"></div>

    <div id="saldoBox"></div>
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
          <div class="fecha">${fechaHora(ev.createdAt)} · IP ${esc(ev.ip || "—")}</div>
        </div>`).join("")}
    </div>

    <div id="cerrarCuentaBox"></div>`;

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
  ultimo_fallo: "La última copia no pasó la restauración de prueba. Revisá los logs del servidor.",
  ultimo_sin_copia_externa: "La última copia no quedó verificada fuera del servidor.",
  configuracion_insegura: "La protección de producción está activa, pero falta cifrado o almacenamiento externo verificable.",
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
          ${u.documentos.toLocaleString(localeActual())} registros · ${u.archivos} archivos · ${esc(pesoLegible(u.bytes))} · tardó ${u.segundos}s
        </div>
        <div class="hint" style="margin-top:2px">
          ${e.cuantos} ${e.cuantos === 1 ? "copia guardada" : "copias guardadas"} ·
          ${u.cifrado ? "cifradas" : '<span style="color:var(--warning)">sin cifrar</span>'} ·
          ${e.afuera
            ? "copia externa verificada"
            : e.afueraConfigurado
              ? '<span style="color:var(--warning)">última copia externa pendiente o fallida</span>'
              : '<span style="color:var(--warning)">destino externo sin configurar</span>'}
        </div>
      ` : `<div class="hint">Todavía no hay ninguna copia.</div>`}

      ${!e.afuera ? `
        <div class="hint" style="margin-top:10px;color:var(--warning)">
          La protección no está completa hasta que la última copia cifrada también figure
          como verificada fuera de este servidor.
        </div>` : ""}

      <div id="backupErr"></div>
      ${e.puedeEjecutar
        ? '<button class="secondary" id="btnBackupAhora" style="margin-top:10px">Hacer una copia ahora</button>'
        : '<div class="hint" style="margin-top:10px">Las copias automáticas se ejecutan sin intervención. Solo un operador con 2FA puede iniciar una manual.</div>'}
    </div>`;

  const btnBackup = document.getElementById("btnBackupAhora");
  if (!btnBackup) return;
  btnBackup.onclick = async () => {
    const btn = btnBackup;
    btn.disabled = true;
    btn.textContent = "Copiando y verificando...";
    try {
      const r = await api("/medico/backups", { method: "POST" });
      alert(r.verificado === true && r.externo === true
        ? `Listo: ${r.documentos} registros y ${r.archivos} archivos.\n\nSe restauró en una base de prueba y la copia externa quedó verificada.`
        : r.verificado === true
          ? `La copia local pasó la restauración, pero la copia externa NO quedó verificada. Revisá el estado antes de confiar en ella.`
          : `La copia se hizo pero NO pasó la restauración de prueba. Avisale a soporte antes de confiar en ella.`);
      pintarEstadoBackups();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Hacer una copia ahora";
      const caja2 = document.getElementById("backupErr");
      if (caja2) caja2.innerHTML = `<div class="error">${esc(err.error || "No se pudo hacer la copia")}</div>`;
    }
  };
}

// ─── FOTO DE PERFIL ───────────────────────────────────────────────────────
// Solo la ve el propio médico en su panel — nunca un paciente, nunca un
// documento clínico. El archivo se sube como cuerpo crudo, mismo patrón que
// estudios.js, y se cachea en memoria vía traerBlobFotoPerfil (estado.js)
// para que el panel no la vuelva a pedir cada vez que se repinta.
async function pintarFotoPerfil() {
  const caja = document.getElementById("fotoPerfilBox");
  if (!caja) return;
  const blob = await traerBlobFotoPerfil();
  const url = blob ? URL.createObjectURL(blob) : null;

  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("config.foto.titulo")}</div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
        <span class="avatar avatar-sm" id="fotoPerfilAvatar"
          style="${url ? `background-image:url('${url}');background-size:cover;background-position:center;color:transparent` : ""}"
          aria-hidden="true">${url ? "" : esc(iniciales(MEDICO_NOMBRE))}</span>
        <div class="hint" style="margin:0">${t("config.foto.ayuda")}</div>
      </div>
      <input type="file" id="fotoPerfilInput" accept="image/jpeg,image/png,image/webp" style="display:none">
      <div id="fotoPerfilErr"></div>
      <button class="secondary" id="btnSubirFoto">${url ? t("config.foto.cambiar") : t("config.foto.subir")}</button>
      ${url ? `<button class="secondary" id="btnQuitarFoto" style="color:var(--danger)">${t("config.foto.quitar")}</button>` : ""}
    </div>`;

  const input = document.getElementById("fotoPerfilInput");
  const errBox = document.getElementById("fotoPerfilErr");
  document.getElementById("btnSubirFoto").onclick = () => input.click();

  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    errBox.innerHTML = "";
    // 5 MB del lado del cliente, para avisar antes de subir en vez de que
    // el rechazo llegue recién después de esperar la subida entera.
    if (file.size > 5 * 1024 * 1024) {
      errBox.innerHTML = `<div class="error">${t("config.foto.errPeso")}</div>`;
      return;
    }
    try {
      await api("/medico/perfil/foto", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      invalidarFotoPerfilCache();
      pintarFotoPerfil();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("config.foto.errSubir"))}</div>`;
    }
  };

  const btnQuitar = document.getElementById("btnQuitarFoto");
  if (btnQuitar) btnQuitar.onclick = async () => {
    if (!confirm(t("config.foto.confirmarQuitar"))) return;
    try {
      await api("/medico/perfil/foto", { method: "DELETE" });
      invalidarFotoPerfilCache();
      pintarFotoPerfil();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("config.foto.errQuitar"))}</div>`;
    }
  };
}

// ─── CERRAR LA PROPIA CUENTA ──────────────────────────────────────────────
// Existe por un requisito de las tiendas de apps (App Store 5.1.1(v) y la
// política de borrado de cuenta de Google Play), no por un pedido de algún
// médico — ver el comentario largo en db/models.js junto a SolicitudBaja
// sobre qué hace y qué NO hace (no borra historias clínicas).
async function pintarCerrarCuenta() {
  const caja = document.getElementById("cerrarCuentaBox");
  if (!caja) return;
  let e;
  try {
    e = await api("/medico/baja/estado");
  } catch { return; }

  if (e.pendiente) {
    caja.innerHTML = `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("config.baja.titulo")}</div>
        <div class="hint">${t("config.baja.pendienteAyuda", { fecha: fechaHora(e.pedidaEn) })}</div>
      </div>`;
    return;
  }

  caja.innerHTML = `
    <div class="card" style="border-color:var(--danger)">
      <div class="seccion-titulo" style="margin-top:0;color:var(--danger)">${t("config.baja.titulo")}</div>
      <div class="hint" style="margin-bottom:10px">${t("config.baja.ayuda")}</div>
      <label>${t("config.baja.motivoLabel")}</label>
      <textarea id="bajaMotivo" rows="2" placeholder="${esc(t("config.baja.motivoPlaceholder"))}"></textarea>
      <div id="bajaErr"></div>
      <button class="secondary" id="btnPedirBaja" style="color:var(--danger)">${t("config.baja.boton")}</button>
    </div>`;

  document.getElementById("btnPedirBaja").onclick = async () => {
    if (!confirm(t("config.baja.confirmar"))) return;
    const errBox = document.getElementById("bajaErr");
    errBox.innerHTML = "";
    const motivo = document.getElementById("bajaMotivo").value.trim();
    try {
      await api("/medico/baja/solicitar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      pintarCerrarCuenta();
    } catch (err) {
      errBox.innerHTML = `<div class="error">${esc(err.error || t("config.baja.errEnviar"))}</div>`;
    }
  };
}
