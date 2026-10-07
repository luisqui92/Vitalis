// Symphomed — Login y registro de médicos.

// Las áreas, en el orden en que se ofrecen al registrarse. Los valores son
// los que guarda la base y NO se traducen nunca: son identificadores, no
// texto. Lo que se traduce es la etiqueta, con t("area." + valor).
const AREAS = ["medicina_general", "odontologia", "estetica", "oftalmologia", "ginecologia", "pediatria", "neurodesarrollo", "fisioterapia", "veterinaria"];

// ─── SELECTOR DE IDIOMA (solo antes de entrar) ────────────────────────────
// Antes del login el sistema todavía no sabe quién es el médico, así que no
// puede saber su idioma. Sin esto, un médico brasileño ve su primera
// pantalla de Symphomed en español — que es exactamente la impresión que no
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
      <button class="link" id="lGoOlvide" style="font-size:13px">${t("auth.olvide")}</button>
      <button class="link" id="lGoEstudiante" style="font-size:13px">${t("est.irRegistro")}</button>
      ${selectorIdiomaHtml()}
    </div>`;
  cablearSelectorIdioma(renderLogin);
  document.getElementById("lGoReg").onclick = renderRegistro;
  // public/js/estudiantes.js: si no está cargado, el enlace no hace nada en
  // vez de romper el login entero.
  document.getElementById("lGoEstudiante").onclick = () => { if (typeof renderRegistroEstudiante === "function") renderRegistroEstudiante(); };
  document.getElementById("lGoOlvide").onclick = () => renderOlvideClave(document.getElementById("lPhone").value.trim());
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

// ═══ OLVIDÉ MI CONTRASEÑA ═══════════════════════════════════════════════════
//
// Un solo campo y un botón. La respuesta que llega es SIEMPRE la misma —"si
// ese número está registrado…"— exista o no exista la cuenta, y por eso la
// pantalla nunca puede decir "cuenta no encontrada": eso sería exactamente lo
// que la ruta del servidor está diseñada para no revelar (ver el porqué junto
// al modelo SolicitudReseteo en db/models.js).
//
// Se le pasa el teléfono ya tipeado en el login, para no hacerlo escribirlo
// dos veces — es lo único que se lleva de una pantalla a la otra.
function renderOlvideClave(telefonoDeArranque) {
  app.innerHTML = `
    <div class="card">
      <div class="hint" style="margin-bottom:14px">${t("auth.olvide.ayuda")}</div>
      <label>${t("auth.telefono")}</label>
      <input id="ocPhone" type="tel" placeholder="${t("auth.telefonoPlaceholder")}" value="${esc(telefonoDeArranque || "")}">
      <div id="ocErr"></div>
      <button class="primary" id="ocBtn">${t("auth.olvide.enviar")}</button>
      <button class="link" id="ocVolver">${t("auth.olvide.volver")}</button>
    </div>`;
  document.getElementById("ocVolver").onclick = renderLogin;
  document.getElementById("ocBtn").onclick = async () => {
    const phone = document.getElementById("ocPhone").value.trim();
    const errBox = document.getElementById("ocErr");
    errBox.innerHTML = "";
    if (!phone) { errBox.innerHTML = `<div class="error">${t("auth.olvide.errFalta")}</div>`; return; }
    const btn = document.getElementById("ocBtn");
    btn.disabled = true;
    try {
      // No hay try/catch que distinga "existe" de "no existe": la ruta
      // contesta 200 con el mismo mensaje en los dos casos. Un error acá es
      // de red, no de la cuenta.
      await api("/reseteo-clave/solicitar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: phone }),
      });
      app.innerHTML = `
        <div class="card">
          <div class="hint">${t("auth.olvide.enviado")}</div>
          <button class="primary" id="ocVolver2" style="margin-top:14px">${t("auth.olvide.volver")}</button>
        </div>`;
      document.getElementById("ocVolver2").onclick = renderLogin;
    } catch (e) {
      // Esto SÍ puede ser un mensaje distinto del de éxito: no dice nada
      // sobre si la cuenta existe, dice que el PEDIDO no llegó —demasiados
      // intentos, o la red— y eso es seguro de mostrar tal cual.
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("auth.olvide.errEnviar"))}</div>`;
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
  MEDICO_MONEDA = data.moneda || "BOB";
  localStorage.setItem("salud_moneda", MEDICO_MONEDA);
  MEDICO_ROL = data.rol || "medico";
  localStorage.setItem("salud_rol", MEDICO_ROL);
  MEDICO_CLINICA = data.clinica || "";
  localStorage.setItem("salud_clinica", MEDICO_CLINICA);
  // Igual que el rol: solo decide qué se DIBUJA. El permiso de verdad lo
  // revisa el servidor en cada pedido, así que alguien que se ponga esto en
  // true a mano ve una pestaña que le contesta 404.
  ES_OPERADOR = Boolean(data.operador);
  localStorage.setItem("salud_operador", ES_OPERADOR ? "1" : "");
  // Cuenta de estudiante: decide qué se dibuja (public/js/estudiantes.js).
  if (typeof fijarEstudiante === "function") fijarEstudiante(data.estudiante);
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
// Y una cuenta que solo aprueba pagos no tiene ni pacientes ni clínica: su
// panel son los pagos. Va primero porque también es administrativa, y si
// preguntáramos al revés terminaría en una clínica que no existe.
function irAPantallaInicial() {
  // El botón de salir se mostraba en UN solo lugar: adentro del panel de
  // pacientes. Una cuenta administrativa —la de la clínica, la de pagos—
  // nunca pasa por ahí, así que quedaba sin forma de cerrar sesión: había
  // que borrar los datos del navegador. En una pantalla que aprueba plata,
  // no poder salir no es una molestia, es que la sesión queda abierta en el
  // celular de quien sea que lo agarre después.
  //
  // Va acá y no en cada pantalla porque acá pasan TODAS las cuentas al
  // entrar, incluidas las que agreguemos mañana.
  // El texto se fija acá y no en el HTML porque en el HTML estaba en español
  // fijo: no hay mecanismo de traducción para el marcado suelto, así que un
  // médico brasileño leía "Salir" en medio de una interfaz en portugués.
  if (typeof btnLogout !== "undefined" && btnLogout) {
    btnLogout.textContent = t("comun.salir");
    btnLogout.style.display = "inline-block";
  }

  if (typeof esSoloPagos === "function" && esSoloPagos()) return renderPagos();
  if (typeof esSoloAdministrador === "function" && esSoloAdministrador()) return renderClinica();

  // ═══ /?consulta=<id> — a dónde lleva tocar la notificación ═══════════════
  //
  // Cuando la nota clínica queda lista, el servidor le manda al médico una
  // notificación con esta dirección. Sin esto, tocarla lo dejaba en el panel
  // buscando cuál de las consultas era la que se avisó — y avisar algo que
  // después hay que ir a buscar no le ahorra nada a nadie.
  //
  // Se limpia la barra de direcciones apenas se usa. Si quedara puesta, un
  // F5 o un "volver" lo devolverían a esa consulta en vez de a donde estaba,
  // horas después, sin entender por qué.
  const pedida = new URLSearchParams(location.search).get("consulta");
  if (pedida && /^[a-f0-9]{24}$/i.test(pedida) && typeof renderDetalle === "function") {
    history.replaceState(null, "", location.pathname);
    // El escritorio se arma igual: el detalle se pinta adentro de su
    // contenedor, no en lugar de él.
    if (typeof activarEscritorioSiCorresponde === "function") activarEscritorioSiCorresponde();
    return renderDetalle(pedida);
  }

  // El escritorio se arma ANTES de mirar la dirección: las pantallas pintan
  // adentro de su contenedor, así que si se restaura una ficha sin el shell
  // armado, se dibuja en el lugar equivocado.
  const hayEscritorio = typeof activarEscritorioSiCorresponde === "function" && activarEscritorioSiCorresponde();

  // Si la barra de direcciones apunta a una pantalla concreta —una recarga
  // con la ficha abierta, un enlace que le pasaron— se abre esa. Ver
  // public/js/rutas.js.
  if (typeof abrirDesdeLaDireccion === "function" && abrirDesdeLaDireccion()) return;

  if (hayEscritorio) return renderInicioEscritorio();
  renderDashboard();
}

// A dónde vuelve el botón "← Panel". No es siempre el panel de pacientes: el
// administrativo no tiene, y el de pagos tampoco tiene clínica. Cada cuenta
// vuelve a la suya. Vive acá, al lado de irAPantallaInicial, porque es la
// misma pregunta hecha en otro momento.
function volverAlPanel() {
  if (typeof esSoloPagos === "function" && esSoloPagos()) return renderPagos();
  if (typeof esSoloAdministrador === "function" && esSoloAdministrador()) return renderClinica();
  return renderDashboard();
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

// ─── REGISTRO ────────────────────────────────────────────────────────────
//
// Dos pasos, no un formulario largo. No es decoración: pedirle la matrícula
// profesional a alguien que todavía no sabe qué es Symphomed se siente una
// intromisión, y abandona. Primero quién sos —lo que cualquiera espera—, y
// recién después lo profesional, ya explicado por qué se pide.
//
// Y hay una tercera pantalla que antes no existía y era la que más falta
// hacía: la de después. La cuenta ahora NO entra al instante, así que un
// "✅ cuenta creada, ahora ingresá" seguido de un login que lo rechaza es la
// peor forma de recibir a alguien.
let REG_DATOS = {};

function regPasosHtml(pasoActual) {
  return `<div class="reg-pasos">
    ${[1, 2].map(n => `<span class="reg-paso ${n === pasoActual ? "activo" : ""} ${n < pasoActual ? "hecho" : ""}"></span>`).join("")}
  </div>`;
}

function regEncabezadoHtml(paso, titulo, bajada) {
  return `
    <div class="reg-marca">Symphomed</div>
    ${regPasosHtml(paso)}
    <div class="reg-titulo">${titulo}</div>
    <div class="reg-bajada">${bajada}</div>`;
}

function renderRegistro() {
  detenerPolling();
  REG_DATOS = {};
  return renderRegistroPaso1();
}

function renderRegistroPaso1() {
  app.innerHTML = `
    <div class="card reg-card">
      ${regEncabezadoHtml(1, t("auth.reg.paso1Titulo"), t("auth.reg.paso1Bajada"))}

      <label>${t("auth.reg.nombre")}</label>
      <input id="rNombre" type="text" autocomplete="name" placeholder="${ES_LANDING_VETERINARIA ? t("auth.reg.nombrePlaceholderVet") : t("auth.reg.nombrePlaceholder")}" value="${esc(REG_DATOS.nombre || "")}">

      <label>${t("auth.telefono")}</label>
      <input id="rPhone" type="tel" autocomplete="tel" placeholder="${t("auth.telefonoPlaceholder")}" value="${esc(REG_DATOS.phone || "")}">
      <div class="hint">${t("auth.reg.telefonoAyuda")}</div>

      <label>${t("auth.reg.password")}</label>
      <input id="rPass" type="password" autocomplete="new-password" placeholder="••••••••">
      <div class="reg-fuerza"><span id="rFuerzaBarra"></span></div>
      <div class="hint" id="rFuerzaTexto">${t("auth.reg.passwordAyuda")}</div>

      <div id="rErr"></div>
      <button class="primary" id="rSiguiente">${t("auth.reg.siguiente")}</button>
      <button class="link" id="rGoLogin">${t("auth.reg.irLogin")}</button>
      ${selectorIdiomaHtml()}
    </div>`;
  cablearSelectorIdioma(renderRegistroPaso1);
  document.getElementById("rGoLogin").onclick = renderLogin;

  // Una barra que se llena mientras escribe dice más que un texto que avisa
  // recién al enviar, cuando ya hay que volver atrás a corregir.
  const pass = document.getElementById("rPass");
  pass.oninput = () => {
    const largo = pass.value.length;
    const nivel = largo === 0 ? 0 : largo < 8 ? 1 : largo < 12 ? 2 : 3;
    const barra = document.getElementById("rFuerzaBarra");
    barra.className = `n${nivel}`;
    document.getElementById("rFuerzaTexto").textContent =
      nivel === 0 ? t("auth.reg.passwordAyuda")
      : nivel === 1 ? t("auth.reg.passwordCorta")
      : nivel === 2 ? t("auth.reg.passwordBien")
      : t("auth.reg.passwordFuerte");
  };

  document.getElementById("rSiguiente").onclick = () => {
    const nombre = document.getElementById("rNombre").value.trim();
    const phone = document.getElementById("rPhone").value.trim();
    const password = document.getElementById("rPass").value;
    const errBox = document.getElementById("rErr");
    errBox.innerHTML = "";
    // Se valida ACÁ y no al final: descubrir en el paso 2 que la contraseña
    // del paso 1 era corta obliga a volver, y ahí es donde se abandona.
    if (!nombre || !phone) { errBox.innerHTML = `<div class="error">${t("auth.reg.errFaltanDatos")}</div>`; return; }
    if (password.length < 8) { errBox.innerHTML = `<div class="error">${t("auth.reg.errPasswordCorta")}</div>`; return; }
    REG_DATOS = { ...REG_DATOS, nombre, phone, password };
    renderRegistroPaso2();
  };
}

function renderRegistroPaso2() {
  // /veterinaria es una landing dedicada — el selector de área no aporta
  // nada ahí (todo el que se registra por esa puerta es veterinaria).
  const selectorArea = ES_LANDING_VETERINARIA
    ? `<input type="hidden" id="rTipoEsp" value="veterinaria">`
    : `<label>${t("auth.reg.area")}</label>
      <select id="rTipoEsp">
        ${AREAS.map(a => `<option value="${a}" ${REG_DATOS.tipoEspecialidad === a ? "selected" : ""}>${t("area." + a)}</option>`).join("\n        ")}
      </select>`;

  app.innerHTML = `
    <div class="card reg-card">
      ${regEncabezadoHtml(2, t("auth.reg.paso2Titulo"), t("auth.reg.paso2Bajada"))}

      ${selectorArea}

      <label>${t("auth.reg.especialidad")}</label>
      <input id="rEsp" type="text" placeholder="${ES_LANDING_VETERINARIA ? t("auth.reg.especialidadPlaceholderVet") : t("auth.reg.especialidadPlaceholder")}" value="${esc(REG_DATOS.especialidad || "")}">

      <label>${t("auth.reg.matricula")}</label>
      <input id="rMatricula" type="text" placeholder="${t("auth.reg.matriculaPlaceholder")}" value="${esc(REG_DATOS.matricula || "")}">
      <div class="hint">${t("auth.reg.matriculaAyuda")}</div>

      <label>${t("auth.reg.mensaje")}</label>
      <textarea id="rMensaje" rows="3" placeholder="${t("auth.reg.mensajePlaceholder")}">${esc(REG_DATOS.mensaje || "")}</textarea>

      <div id="rErr"></div>
      <button class="primary" id="rBtn">${t("auth.reg.boton")}</button>
      <button class="link" id="rVolver">${t("auth.reg.volver")}</button>
    </div>`;

  document.getElementById("rVolver").onclick = () => {
    // Se guarda lo escrito antes de volver: perder lo tipeado por tocar
    // "atrás" es de las cosas que hacen abandonar un formulario.
    REG_DATOS.tipoEspecialidad = document.getElementById("rTipoEsp").value;
    REG_DATOS.especialidad = document.getElementById("rEsp").value.trim();
    REG_DATOS.matricula = document.getElementById("rMatricula").value.trim();
    REG_DATOS.mensaje = document.getElementById("rMensaje").value.trim();
    renderRegistroPaso1();
  };

  document.getElementById("rBtn").onclick = async () => {
    const btn = document.getElementById("rBtn");
    const errBox = document.getElementById("rErr");
    const matricula = document.getElementById("rMatricula").value.trim();
    errBox.innerHTML = "";
    if (!matricula) { errBox.innerHTML = `<div class="error">${t("auth.reg.errMatricula")}</div>`; return; }

    const cuerpo = {
      ...REG_DATOS,
      tipoEspecialidad: document.getElementById("rTipoEsp").value,
      especialidad: document.getElementById("rEsp").value.trim(),
      matricula,
      mensaje: document.getElementById("rMensaje").value.trim(),
      idioma: MEDICO_IDIOMA,
    };
    btn.disabled = true;
    btn.textContent = t("auth.reg.enviando");
    try {
      await api("/medico/registro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      renderRegistroEnviado(cuerpo.nombre);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = t("auth.reg.boton");
      errBox.innerHTML = `<div class="error">${esc(e.error || t("auth.reg.errRegistrar"))}</div>`;
    }
  };
}

// La pantalla que antes no existía. La cuenta NO entra todavía, así que esto
// tiene que decir claramente qué pasó, qué falta y cuánto puede tardar — si
// no, la persona intenta entrar, la rechazan, y cree que Symphomed está roto.
function renderRegistroEnviado(nombre) {
  app.innerHTML = `
    <div class="card reg-card reg-listo">
      <div class="reg-tilde">✓</div>
      <div class="reg-titulo">${t("auth.reg.enviadaTitulo", { nombre: esc(String(nombre || "").split(" ")[0] || "") })}</div>
      <div class="reg-bajada">${t("auth.reg.enviadaBajada")}</div>

      <div class="reg-pasos-lista">
        <div class="reg-item"><span class="reg-num hecho">✓</span><div><b>${t("auth.reg.hito1")}</b><div class="hint">${t("auth.reg.hito1Detalle")}</div></div></div>
        <div class="reg-item"><span class="reg-num ahora">2</span><div><b>${t("auth.reg.hito2")}</b><div class="hint">${t("auth.reg.hito2Detalle")}</div></div></div>
        <div class="reg-item"><span class="reg-num">3</span><div><b>${t("auth.reg.hito3")}</b><div class="hint">${t("auth.reg.hito3Detalle")}</div></div></div>
      </div>

      <button class="primary" id="rListoLogin">${t("auth.reg.entendido")}</button>
    </div>`;
  document.getElementById("rListoLogin").onclick = renderLogin;
}

