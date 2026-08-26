// Vitalis — Login y registro de médicos.

// Las áreas, en el orden en que se ofrecen al registrarse. Los valores son
// los que guarda la base y NO se traducen nunca: son identificadores, no
// texto. Lo que se traduce es la etiqueta, con t("area." + valor).
const AREAS = ["medicina_general", "odontologia", "estetica", "oftalmologia", "ginecologia", "pediatria", "neurodesarrollo", "veterinaria"];

// ─── SELECTOR DE IDIOMA (solo antes de entrar) ────────────────────────────
// Antes del login el sistema todavía no sabe quién es el médico, así que no
// puede saber su idioma. Sin esto, un médico brasileño ve su primera
// pantalla de Vitalis en español — que es exactamente la impresión que no
// queremos dar.
//
// Lo que se elige acá manda dos cosas y ninguna más: el idioma de estas
// pantallas, y el idioma con el que nace una cuenta nueva al registrarse.
// Apenas el médico entra, manda el idioma de SU CUENTA (ver completarLogin):
// el de acá era una preferencia de este navegador, el de la cuenta es el
// idioma en el que ese médico trabaja de verdad.
function selectorIdiomaHtml() {
  const opcion = (codigo, etiqueta) =>
    `<button type="button" class="link idioma-opcion" data-idioma="${codigo}" style="width:auto;margin:0 6px;${MEDICO_IDIOMA === codigo ? "font-weight:600;text-decoration:underline" : "opacity:.6"}">${etiqueta}</button>`;
  return `<div style="text-align:center;margin-top:14px;font-size:13px">
      ${opcion("es", "Español")}·${opcion("pt", "Português")}
    </div>`;
}

function cablearSelectorIdioma(repintar) {
  document.querySelectorAll(".idioma-opcion").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.idioma === MEDICO_IDIOMA) return;
      fijarIdioma(btn.dataset.idioma);
      repintar();
    };
  });
}

function renderLogin() {
  detenerPolling();
  app.innerHTML = `
    <div class="card">
      <label>${t("auth.telefono")}</label>
      <input id="lPhone" type="tel" placeholder="${t("auth.telefonoPlaceholder")}">
      <label>${t("auth.password")}</label>
      <input id="lPass" type="password" placeholder="••••••••">
      <div id="lErr"></div>
      <button class="primary" id="lBtn">${t("auth.ingresar")}</button>
      <button class="link" id="lGoReg">${t("auth.irRegistro")}</button>
      ${selectorIdiomaHtml()}
    </div>`;
  cablearSelectorIdioma(renderLogin);
  document.getElementById("lGoReg").onclick = renderRegistro;
  document.getElementById("lBtn").onclick = async () => {
    const phone = document.getElementById("lPhone").value.trim();
    const password = document.getElementById("lPass").value;
    const errBox = document.getElementById("lErr");
    errBox.innerHTML = "";
    if (!phone || !password) { errBox.innerHTML = `<div class="error">${t("auth.errFaltanDatos")}</div>`; return; }
    try {
      const data = await api("/medico/login", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ phone, password }) });
      if (data.requiere2fa) return renderLogin2FA(data.tempToken);
      completarLogin(data);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("auth.errIngresar"))}</div>`;
    }
  };
}

function completarLogin(data) {
  TOKEN = data.token; MEDICO_NOMBRE = data.nombre;
  MEDICO_TIPO_ESPECIALIDAD = data.tipoEspecialidad || "medicina_general";
  localStorage.setItem("salud_token", TOKEN);
  localStorage.setItem("salud_nombre", MEDICO_NOMBRE);
  localStorage.setItem("salud_tipo_especialidad", MEDICO_TIPO_ESPECIALIDAD);
  // El idioma llega del servidor igual que la especialidad: es un dato de la
  // cuenta, no del navegador. Se fija antes de pintar nada.
  fijarIdioma(data.idioma || "es");
  MEDICO_ROL = data.rol || "medico";
  localStorage.setItem("salud_rol", MEDICO_ROL);
  aplicarTemaSegunEspecialidad();
  if (typeof conectarTiempoReal === "function") conectarTiempoReal();
  irAPantallaInicial();
}

// Un administrativo NO es médico: sus rutas clínicas están cerradas del
// lado del servidor, así que mandarlo al panel de pacientes sería mandarlo
// a una pantalla de errores. Va directo a su clínica.
//
// Un director sí es médico, y arranca donde arranca cualquiera: en sus
// pacientes. La clínica está a un clic, en el menú.
function irAPantallaInicial() {
  if (typeof esSoloAdministrador === "function" && esSoloAdministrador()) return renderClinica();
  if (typeof activarEscritorioSiCorresponde === "function" && activarEscritorioSiCorresponde()) return renderInicioEscritorio();
  renderDashboard();
}

// ─── LOGIN, paso 2: código de la app autenticadora (si el médico tiene 2FA) ──
function renderLogin2FA(tempToken) {
  app.innerHTML = `
    <div class="card">
      <div class="hint" style="margin-bottom:14px">${t("auth.2fa.ayuda")}</div>
      <input id="lCodigo" type="tel" inputmode="numeric" maxlength="6" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:6px">
      <div id="l2Err"></div>
      <button class="primary" id="l2Btn">${t("auth.2fa.confirmar")}</button>
      <button class="link" id="l2Volver">${t("auth.2fa.volver")}</button>
    </div>`;
  document.getElementById("l2Volver").onclick = renderLogin;
  document.getElementById("l2Btn").onclick = async () => {
    const codigo = document.getElementById("lCodigo").value.trim();
    const errBox = document.getElementById("l2Err");
    errBox.innerHTML = "";
    try {
      const data = await api("/medico/login/2fa", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ tempToken, codigo }) });
      completarLogin(data);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("auth.2fa.errCodigo"))}</div>`;
    }
  };
}

function renderRegistro() {
  detenerPolling();
  // /veterinaria es una landing dedicada — el selector de área no aporta
  // nada ahí (todo el que se registra por esa puerta es veterinaria), así
  // que se reemplaza por un valor fijo en vez de obligar a elegirlo.
  const selectorArea = ES_LANDING_VETERINARIA
    ? `<input type="hidden" id="rTipoEsp" value="veterinaria">`
    : `<label>${t("auth.reg.area")}</label>
      <select id="rTipoEsp">
        ${AREAS.map(a => `<option value="${a}">${t("area." + a)}</option>`).join("\n        ")}
      </select>`;
  app.innerHTML = `
    <div class="card">
      <label>${t("auth.telefono")}</label>
      <input id="rPhone" type="tel" placeholder="${t("auth.telefonoPlaceholder")}">
      <label>${t("auth.reg.nombre")}</label>
      <input id="rNombre" type="text" placeholder="${ES_LANDING_VETERINARIA ? t("auth.reg.nombrePlaceholderVet") : t("auth.reg.nombrePlaceholder")}">
      ${selectorArea}
      <label>${t("auth.reg.especialidad")}</label>
      <input id="rEsp" type="text" placeholder="${ES_LANDING_VETERINARIA ? t("auth.reg.especialidadPlaceholderVet") : t("auth.reg.especialidadPlaceholder")}">
      <label>${t("auth.reg.password")}</label>
      <input id="rPass" type="password" placeholder="••••••••">
      <div id="rErr"></div>
      <button class="primary" id="rBtn">${t("auth.reg.boton")}</button>
      <button class="link" id="rGoLogin">${t("auth.reg.irLogin")}</button>
      ${selectorIdiomaHtml()}
    </div>`;
  cablearSelectorIdioma(renderRegistro);
  document.getElementById("rGoLogin").onclick = renderLogin;
  document.getElementById("rBtn").onclick = async () => {
    const phone = document.getElementById("rPhone").value.trim();
    const nombre = document.getElementById("rNombre").value.trim();
    const especialidad = document.getElementById("rEsp").value.trim();
    const tipoEspecialidad = document.getElementById("rTipoEsp").value;
    const password = document.getElementById("rPass").value;
    const errBox = document.getElementById("rErr");
    errBox.innerHTML = "";
    if (!phone || !nombre || !password) { errBox.innerHTML = `<div class="error">${t("auth.reg.errFaltanDatos")}</div>`; return; }
    try {
      await api("/medico/registro", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ phone, nombre, especialidad, tipoEspecialidad, password, idioma: MEDICO_IDIOMA }) });
      errBox.innerHTML = `<div class="hint">${t("auth.reg.creada")}</div>`;
      setTimeout(renderLogin, 1200);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("auth.reg.errRegistrar"))}</div>`;
    }
  };
}
