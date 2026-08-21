// Vitalis — Login y registro de médicos.

function renderLogin() {
  detenerPolling();
  app.innerHTML = `
    <div class="card">
      <label>Teléfono</label>
      <input id="lPhone" type="tel" placeholder="591XXXXXXXX">
      <label>Contraseña</label>
      <input id="lPass" type="password" placeholder="••••••••">
      <div id="lErr"></div>
      <button class="primary" id="lBtn">Ingresar</button>
      <button class="link" id="lGoReg">¿No tenés cuenta? Registrate</button>
    </div>`;
  document.getElementById("lGoReg").onclick = renderRegistro;
  document.getElementById("lBtn").onclick = async () => {
    const phone = document.getElementById("lPhone").value.trim();
    const password = document.getElementById("lPass").value;
    const errBox = document.getElementById("lErr");
    errBox.innerHTML = "";
    if (!phone || !password) { errBox.innerHTML = `<div class="error">Completá teléfono y contraseña</div>`; return; }
    try {
      const data = await api("/medico/login", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ phone, password }) });
      if (data.requiere2fa) return renderLogin2FA(data.tempToken);
      completarLogin(data);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo iniciar sesión")}</div>`;
    }
  };
}

function completarLogin(data) {
  TOKEN = data.token; MEDICO_NOMBRE = data.nombre;
  MEDICO_TIPO_ESPECIALIDAD = data.tipoEspecialidad || "medicina_general";
  localStorage.setItem("salud_token", TOKEN);
  localStorage.setItem("salud_nombre", MEDICO_NOMBRE);
  localStorage.setItem("salud_tipo_especialidad", MEDICO_TIPO_ESPECIALIDAD);
  aplicarTemaSegunEspecialidad();
  if (typeof conectarTiempoReal === "function") conectarTiempoReal();
  if (typeof activarEscritorioSiCorresponde === "function" && activarEscritorioSiCorresponde()) renderInicioEscritorio();
  else renderDashboard();
}

// ─── LOGIN, paso 2: código de la app autenticadora (si el médico tiene 2FA) ──
function renderLogin2FA(tempToken) {
  app.innerHTML = `
    <div class="card">
      <div class="hint" style="margin-bottom:14px">🔐 Ingresá el código de 6 dígitos de tu app autenticadora (Google Authenticator, Authy...).</div>
      <input id="lCodigo" type="tel" inputmode="numeric" maxlength="6" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:6px">
      <div id="l2Err"></div>
      <button class="primary" id="l2Btn">Confirmar</button>
      <button class="link" id="l2Volver">← Volver</button>
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
      errBox.innerHTML = `<div class="error">${esc(e.error || "Código incorrecto")}</div>`;
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
    : `<label>Área</label>
      <select id="rTipoEsp">
        <option value="medicina_general">🩺 Medicina general</option>
        <option value="odontologia">🦷 Odontología</option>
        <option value="estetica">💉 Estética / Plástica / Dermatología</option>
        <option value="oftalmologia">👁️ Oftalmología</option>
        <option value="ginecologia">🤰 Ginecología y Obstetricia</option>
        <option value="pediatria">🧸 Pediatría</option>
        <option value="veterinaria">🐾 Veterinaria</option>
      </select>`;
  app.innerHTML = `
    <div class="card">
      <label>Teléfono</label>
      <input id="rPhone" type="tel" placeholder="591XXXXXXXX">
      <label>Nombre completo</label>
      <input id="rNombre" type="text" placeholder="${ES_LANDING_VETERINARIA ? "Dra. Fulana Pérez (veterinaria)" : "Dra. Fulana Pérez"}">
      ${selectorArea}
      <label>Especialidad (opcional)</label>
      <input id="rEsp" type="text" placeholder="${ES_LANDING_VETERINARIA ? "Medicina veterinaria general" : "Medicina general"}">
      <label>Contraseña (mínimo 8 caracteres)</label>
      <input id="rPass" type="password" placeholder="••••••••">
      <div id="rErr"></div>
      <button class="primary" id="rBtn">Registrarme</button>
      <button class="link" id="rGoLogin">Ya tengo cuenta, ingresar</button>
    </div>`;
  document.getElementById("rGoLogin").onclick = renderLogin;
  document.getElementById("rBtn").onclick = async () => {
    const phone = document.getElementById("rPhone").value.trim();
    const nombre = document.getElementById("rNombre").value.trim();
    const especialidad = document.getElementById("rEsp").value.trim();
    const tipoEspecialidad = document.getElementById("rTipoEsp").value;
    const password = document.getElementById("rPass").value;
    const errBox = document.getElementById("rErr");
    errBox.innerHTML = "";
    if (!phone || !nombre || !password) { errBox.innerHTML = `<div class="error">Completá teléfono, nombre y contraseña</div>`; return; }
    try {
      await api("/medico/registro", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ phone, nombre, especialidad, tipoEspecialidad, password }) });
      errBox.innerHTML = `<div class="hint">✅ Cuenta creada. Ahora ingresá con tu teléfono y contraseña.</div>`;
      setTimeout(renderLogin, 1200);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo registrar")}</div>`;
    }
  };
}
