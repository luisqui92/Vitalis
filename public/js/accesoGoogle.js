// Botón oficial de Google. No se cargan scripts externos si no está configurado.
let GOOGLE_SDK_PROMESA;
let GOOGLE_VISTA = 0;

function cargarSdkGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!GOOGLE_SDK_PROMESA) GOOGLE_SDK_PROMESA = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const reloj = setTimeout(() => { script.remove(); GOOGLE_SDK_PROMESA = null; reject(new Error("Google")); }, 15000);
    script.onload = () => { clearTimeout(reloj); resolve(); };
    script.onerror = () => { clearTimeout(reloj); script.remove(); GOOGLE_SDK_PROMESA = null; reject(new Error("Google")); };
    document.head.appendChild(script);
  });
  return GOOGLE_SDK_PROMESA;
}

async function pintarBotonGoogle(id = "googleEntrada", accion) {
  const caja = document.getElementById(id);
  if (!caja) return;
  const vista = ++GOOGLE_VISTA;
  const vigente = () => caja.isConnected && vista === GOOGLE_VISTA;
  const error = (e) => { if (vigente()) caja.innerHTML = `<div class="error">${esc(e?.error || t("google.error"))}</div><button type="button" class="secondary" id="googleReintentar">${t("google.reintentar")}</button>`;
    const btn = caja.querySelector("#googleReintentar");
    if (btn) btn.onclick = () => pintarBotonGoogle(id, accion);
  };
  try {
    const config = await api("/medico/google/config");
    if (!vigente() || !config.disponible) return;
    caja.innerHTML = `<div class="hint">${t("google.cargando")}</div>`;
    await cargarSdkGoogle();
    if (!vigente()) return;
    const desafio = await api("/medico/google/iniciar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!vigente()) return;
    caja.innerHTML = "";
    window.google.accounts.id.initialize({ client_id: desafio.clientId, nonce: desafio.nonce, auto_select: false,
      callback: async (r) => {
        if (!vigente()) return;
        caja.innerHTML = `<div class="hint">${t("google.cargando")}</div>`;
        try {
          if (accion) { await accion(r.credential); return; }
          const data = await api("/medico/google/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: r.credential }) });
          if (!vigente()) return;
          if (data.requiere2fa) return renderLogin2FA(data.tempToken);
          if (data.registro) return renderPerfilGoogle(data);
          completarLogin(data);
        } catch (e) { error(e); }
      },
    });
    window.google.accounts.id.renderButton(caja, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: MEDICO_IDIOMA, width: Math.min(360, caja.clientWidth || 300) });
  } catch (e) { error(e); }
}

function renderPerfilGoogle(perfil) {
  detenerPolling();
  ++GOOGLE_VISTA;
  const perfiles = Extensiones.filtrar("registro.google", [{
    id: "profesional", titulo: t("google.profesional"), ruta: "/medico/registro",
    html: `<label for="gArea">${t("auth.reg.area")}</label>
      <select id="gArea">${AREAS.map(a => `<option value="${a}">${t("area." + a)}</option>`).join("")}</select>
      <label for="gMatricula">${t("auth.reg.matricula")}</label><input id="gMatricula" maxlength="60">
      <div class="hint">${t("google.aprobacion")}</div>`,
    datos: () => ({ tipoEspecialidad: document.getElementById("gArea").value, matricula: document.getElementById("gMatricula").value.trim() }),
  }]);
  app.innerHTML = `<div class="card reg-card">
    <div class="reg-titulo">${t("google.completar")}</div>
    <p>${esc(perfil.email)}</p>
    <label for="gNombre">${t("auth.reg.nombre")}</label>
    <input id="gNombre" autocomplete="name" maxlength="120" value="${esc(perfil.nombre || "")}">
    <label for="gPhone">${t("google.telefono")}</label>
    <input id="gPhone" type="tel" autocomplete="tel" placeholder="+59170000000">
    <div class="hint">${t("google.telefonoAyuda")}</div>
    <label for="gTipo">${t("google.perfil")}</label>
    <select id="gTipo">${perfiles.map(p => `<option value="${esc(p.id)}">${esc(p.titulo)}</option>`).join("")}</select>
    ${perfiles.map((p, i) => `<div data-google-perfil="${esc(p.id)}" ${i ? "hidden" : ""}>${p.html}</div>`).join("")}
    <div id="gError"></div>
    <button class="primary" id="gCrear">${t("google.crear")}</button>
    <button class="link" id="gExistente">${t("google.existente")}</button>
    <div class="hint">${t("google.existenteAyuda")}</div>
  </div>`;
  const tipo = document.getElementById("gTipo");
  tipo.onchange = () => {
    document.querySelectorAll("[data-google-perfil]").forEach(n => { n.hidden = n.dataset.googlePerfil !== tipo.value; });
  };
  document.getElementById("gExistente").onclick = renderLogin;
  const btn = document.getElementById("gCrear");
  btn.onclick = async () => {
    const val = id => document.getElementById(id).value.trim();
    const err = document.getElementById("gError");
    err.innerHTML = "";
    const datos = { nombre: val("gNombre"), phone: val("gPhone"), idioma: MEDICO_IDIOMA, googleTicket: perfil.googleTicket };
    if (!datos.nombre || !datos.phone) { err.textContent = t("google.faltan"); return; }
    const elegido = perfiles.find(p => p.id === tipo.value);
    Object.assign(datos, elegido.datos());
    btn.disabled = true;
    try {
      const data = await api(elegido.ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
      if (!btn.isConnected) return;
      if (data.token) completarLogin(data);
      else {
        app.innerHTML = `<div class="card"><h2>${t("google.pendiente")}</h2><p>${t("google.pendienteAyuda")}</p><button class="primary" id="gVolver">${t("auth.ingresar")}</button></div>`;
        document.getElementById("gVolver").onclick = renderLogin;
      }
    } catch (e) { if (btn.isConnected) { btn.disabled = false; err.innerHTML = `<div class="error">${esc(e.error || t("google.error"))}</div>`; } }
  };
}

async function pintarGoogleSeguridad() {
  const caja = document.getElementById("googleSeguridad");
  if (!caja) return;
  try {
    const e = await api("/medico/google/estado");
    if (!caja.isConnected || !e.disponible) return;
    if (e.vinculado) {
      caja.innerHTML = `<div class="card"><div class="seccion-titulo">Google</div><p>${esc(e.email)}</p><div class="hint">${t("google.vinculado")}</div>
        ${e.soloGoogle ? `<p>${t("google.recuperacion")}</p><a href="https://accounts.google.com/signin/recovery" target="_blank" rel="noopener noreferrer">${t("google.recuperar")}</a>` : ""}</div>`;
      return;
    }
    caja.innerHTML = `<div class="card"><div class="seccion-titulo">${t("google.vincular")}</div>
      <p>${t("google.vincularAyuda")}</p>
      <label for="gPassword">${t("auth.password")}</label><input id="gPassword" type="password" autocomplete="current-password">
      <label for="gTotp">${t("google.totp")}</label><input id="gTotp" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
      <div id="googleVincularBoton"></div></div>`;
    await pintarBotonGoogle("googleVincularBoton", async credential => {
      const password = document.getElementById("gPassword").value;
      const codigo = document.getElementById("gTotp").value.trim();
      await api("/medico/google/vincular", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential, password, codigo }) });
      if (caja.isConnected) pintarGoogleSeguridad();
    });
  } catch (e) { if (caja.isConnected) caja.innerHTML = `<div class="error">${esc(e.error || t("google.error"))}</div>`; }
}
