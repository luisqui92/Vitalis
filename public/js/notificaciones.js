// Symphomed — Notificaciones del navegador (Web Push) para el médico.
// Se activan desde Seguridad. Cuando entra una reserva, el aviso le llega
// al celular aunque tenga Symphomed cerrado (lo despierta el service worker,
// public/sw.js).

// La clave pública viene del servidor en base64url; la API del navegador la
// pide como bytes.
function base64UrlABytes(base64) {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(normal);
  return Uint8Array.from([...crudo].map(c => c.charCodeAt(0)));
}

function soportaNotificaciones() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iPhone/iPad solo permiten notificaciones web si la página se abrió desde
// la pantalla de inicio (no desde Safari). Vale la pena detectarlo para
// poder explicarlo, en vez de dejar al médico peleando con un botón que no
// hace nada.
function esIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function instaladaEnPantallaInicio() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

async function registrarServiceWorker() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

async function suscripcionActual() {
  if (!soportaNotificaciones()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

async function activarNotificaciones() {
  if (!soportaNotificaciones()) {
    throw new Error(t("notif.sinSoporte"));
  }
  if (esIOS() && !instaladaEnPantallaInicio()) {
    throw new Error(t("notif.iosError"));
  }

  const cfg = await api("/medico/push/config");
  if (!cfg.configurado || !cfg.clavePublica) {
    throw new Error(t("notif.sinConfigurar"));
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    throw new Error(t("notif.sinPermiso"));
  }

  const reg = await registrarServiceWorker();
  await navigator.serviceWorker.ready;

  // Si ya había una suscripción de antes (por ejemplo con otras claves del
  // servidor), se da de baja: reusarla haría que los envíos fallen en
  // silencio.
  const previa = await reg.pushManager.getSubscription();
  if (previa) await previa.unsubscribe().catch(() => {});

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlABytes(cfg.clavePublica),
  });

  const json = sub.toJSON();
  await api("/medico/push/suscribir", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return true;
}

async function desactivarNotificaciones() {
  const sub = await suscripcionActual();
  if (!sub) return;
  await api("/medico/push/baja", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// Bloque que se inserta en la pantalla de Seguridad.
function notificacionesHtml() {
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("notif.titulo")}</div>
      <div class="hint" style="margin-bottom:10px">${t("notif.ayuda")}</div>
      <div id="notifEstado" class="hint">${t("notif.verificando")}</div>
      <div id="notifErr"></div>
      <button class="secondary" id="btnNotifActivar" style="display:none">${t("notif.activar")}</button>
      <button class="link" id="btnNotifProbar" style="display:none">${t("notif.probar")}</button>
      <button class="link" id="btnNotifDesactivar" style="display:none;color:var(--danger)">${t("notif.desactivar")}</button>
    </div>`;
}

async function wireNotificaciones() {
  const estado = document.getElementById("notifEstado");
  const err = document.getElementById("notifErr");
  const btnActivar = document.getElementById("btnNotifActivar");
  const btnProbar = document.getElementById("btnNotifProbar");
  const btnDesactivar = document.getElementById("btnNotifDesactivar");
  if (!estado) return;

  async function pintar() {
    err.innerHTML = "";
    btnActivar.style.display = "none";
    btnProbar.style.display = "none";
    btnDesactivar.style.display = "none";

    if (!soportaNotificaciones()) {
      estado.textContent = t("notif.sinSoporte");
      return;
    }
    if (esIOS() && !instaladaEnPantallaInicio()) {
      estado.innerHTML = t("notif.iosEstado");
      return;
    }
    if (Notification.permission === "denied") {
      estado.textContent = t("notif.bloqueadas");
      return;
    }

    const sub = await suscripcionActual();
    if (sub) {
      estado.innerHTML = t("notif.activadas");
      btnProbar.style.display = "block";
      btnDesactivar.style.display = "block";
    } else {
      estado.textContent = t("notif.noActivadas");
      btnActivar.style.display = "block";
    }
  }

  btnActivar.onclick = async () => {
    err.innerHTML = "";
    btnActivar.disabled = true;
    btnActivar.textContent = t("notif.activando");
    try {
      await activarNotificaciones();
      await pintar();
    } catch (e) {
      err.innerHTML = `<div class="error">${esc(e.error || e.message || t("notif.errActivar"))}</div>`;
    } finally {
      btnActivar.disabled = false;
      btnActivar.textContent = t("notif.activar");
    }
  };

  btnProbar.onclick = async () => {
    err.innerHTML = "";
    btnProbar.textContent = t("notif.enviando");
    try {
      await api("/medico/push/probar", { method: "POST" });
      btnProbar.textContent = t("notif.enviada");
      setTimeout(() => { btnProbar.textContent = t("notif.probar"); }, 4000);
    } catch (e) {
      err.innerHTML = `<div class="error">${esc(e.error || t("notif.errEnviar"))}</div>`;
      btnProbar.textContent = t("notif.probar");
    }
  };

  btnDesactivar.onclick = async () => {
    await desactivarNotificaciones();
    await pintar();
  };

  await pintar();
}
