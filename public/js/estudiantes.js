// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Módulo de estudiantes, del lado de la pantalla
// ═══════════════════════════════════════════════════════════════════════════
//
// Un Symphomed más simple: sus casos, grabar la consulta y la nota. Lo que no
// le corresponde (recetar, escribirle a pacientes, turnos, cobros) no se
// dibuja — pero el que decide es el servidor (modulos/estudiantes): esto
// solo evita mostrar botones que contestarían «no disponible».
//
// Este archivo es la entrada del módulo en la pantalla: la cuenta, entrar
// con un código, el aviso de su acceso y, al final, TODO lo que el módulo
// engancha en las pantallas del núcleo (public/js/extensiones.js). Ninguna
// pantalla del núcleo llama a nada de acá. El resto del módulo:
//   estudiantesTutor.js            «te falta preguntar» y el razonamiento
//   estudiantesEstudio.js          Estudiar: tarjetas, racha, logros
//   estudiantesPacienteVirtual.js  el paciente virtual
//   estudiantesSimulacros.js       los simulacros
//   estudiantesCalculadora.js      la calculadora de medicación

// { nivel, hasta, horasMes } o null. Llega con el login, como el rol.
let ES_ESTUDIANTE = (() => {
  try { return JSON.parse(localStorage.getItem("salud_estudiante") || "null"); } catch { return null; }
})();

function fijarEstudiante(datos) {
  ES_ESTUDIANTE = datos && datos.nivel ? datos : null;
  try {
    if (ES_ESTUDIANTE) localStorage.setItem("salud_estudiante", JSON.stringify(ES_ESTUDIANTE));
    else localStorage.removeItem("salud_estudiante");
  } catch { /* sin almacenamiento: vale para esta sesión */ }
}

const esCuentaEstudiante = () => Boolean(ES_ESTUDIANTE && ES_ESTUDIANTE.nivel);

// Si el módulo está prendido en este servidor (/modulos.js). Apagado, quedan
// las reglas de las cuentas que ya existen y no se ofrece nada de estudio:
// lo mismo que hace el servidor (modulos/estudiantes/index.js).
const ESTUDIANTES_PRENDIDO = Extensiones.moduloPrendido("estudiantes");

// Los íconos del módulo: «Estudiar» y la racha.
const ICONOS_ESTUDIANTE = {
  birrete: svgIcono(`<path d="M2.5 9.5L12 5l9.5 4.5L12 14 2.5 9.5z"/><path d="M6.5 11.6v4c0 1.6 2.5 2.9 5.5 2.9s5.5-1.3 5.5-2.9v-4"/><path d="M21.5 9.5v5"/>`),
  fuego: svgIcono(`<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.4 2.4-5.3 3.6-7.6.5 1.6 1.4 2.6 2.4 3.1.4-2.8 1.5-5.4 3.7-7.4.2 3 1.4 4.6 2.4 6.3 1 1.6 1.9 3.3 1.9 5.6 0 3.5-3.5 6.1-7.5 6.1z"/><path d="M12 21c-1.6 0-2.8-1.2-2.8-2.8 0-1.7 1.3-2.6 1.9-3.9.4.9 1 1.4 1.6 1.6.3-1.2.8-2 1.6-2.7.3 1.2.9 2 1.3 2.8.3.5.4 1.1.4 1.8 0 1.8-1.6 3.2-4 3.2z"/>`),
};

// ─── ENTRAR CON UN CÓDIGO ──────────────────────────────────────────────────
async function renderRegistroEstudiante() {
  detenerPolling();
  app.innerHTML = `<div class="card reg-card"><h2>${t("est.abierto.titulo")}</h2><p>${t("est.abierto.oferta")}</p><p class="hint">${t("est.abierto.audio")}</p>
    <p class="hint">${t("est.abierto.navegador")}</p><p class="hint">${t("est.abierto.practicas")}</p>
    <div id="estRegistroAbierto"><p>${t("google.cargando")}</p></div>
    <button class="link" id="estTengoCodigo">${t("est.abierto.tengoCodigo")}</button>
    <button class="link" id="estYaTengoCuenta">${t("auth.reg.irLogin")}</button>${selectorIdiomaHtml()}</div>`;
  document.getElementById("estTengoCodigo").onclick = renderRegistroEstudianteInvitacion;
  document.getElementById("estYaTengoCuenta").onclick = renderLogin;
  cablearSelectorIdioma(renderRegistroEstudiante);
  const caja = document.getElementById("estRegistroAbierto");
  try {
    const c = await api("/medico/estudiante/registro-config");
    if (!caja.isConnected) return;
    if (!c.disponible) { caja.textContent = t("est.abierto.noDisponible"); return; }
    caja.innerHTML = `<div id="googleEntrada"></div><p class="hint">${t("est.abierto.elegir")}</p>`;
    await pintarBotonGoogle();
  } catch (_) { if (caja.isConnected) caja.textContent = t("est.abierto.noDisponible"); }
}
function renderRegistroEstudianteInvitacion() {
  detenerPolling();
  app.innerHTML = `
    <div class="card reg-card">
      <div class="nota-titulo" style="margin-top:0">${t("est.reg.titulo")}</div>
      <div class="hint" style="margin-bottom:12px">${t("est.reg.bajada")}</div>
      <div id="googleEntrada" style="margin-bottom:16px"></div>
      <label for="eCodigo">${t("est.reg.codigo")}</label>
      <input id="eCodigo" type="text" autocapitalize="characters" autocomplete="off" placeholder="EST-AB12CD">
      <label for="eNombre">${t("auth.reg.nombre")}</label>
      <input id="eNombre" type="text" autocomplete="name">
      <label for="ePhone">${t("auth.telefono")}</label>
      <input id="ePhone" type="tel" autocomplete="tel" placeholder="${t("auth.telefonoPlaceholder")}">
      <label for="eUniversidad">${t("est.reg.universidad")}</label>
      <input id="eUniversidad" type="text" placeholder="${t("est.reg.universidadPlaceholder")}">
      <label for="ePass">${t("auth.reg.password")}</label>
      <input id="ePass" type="password" autocomplete="new-password" placeholder="••••••••">
      <div class="hint">${t("auth.reg.passwordAyuda")}</div>
      <div id="eErr"></div>
      <button class="primary" id="eBtn">${t("est.reg.entrar")}</button>
      <button class="link" id="eGoLogin">${t("auth.reg.irLogin")}</button>
    </div>`;
  document.getElementById("eGoLogin").onclick = renderLogin;
  if (typeof pintarBotonGoogle === "function") pintarBotonGoogle();
  document.getElementById("eBtn").onclick = async () => {
    const val = (id) => document.getElementById(id).value.trim();
    const errBox = document.getElementById("eErr");
    errBox.innerHTML = "";
    const datos = { codigo: val("eCodigo"), nombre: val("eNombre"), phone: val("ePhone"), universidad: val("eUniversidad"),
      password: document.getElementById("ePass").value, idioma: MEDICO_IDIOMA };
    if (!datos.codigo || !datos.nombre || !datos.phone) { errBox.innerHTML = `<div class="error">${t("est.reg.errFaltan")}</div>`; return; }
    if (datos.password.length < 8) { errBox.innerHTML = `<div class="error">${t("auth.reg.errPasswordCorta")}</div>`; return; }
    const btn = document.getElementById("eBtn");
    btn.disabled = true;
    try {
      const data = await api("/medico/registro-estudiante", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
      });
      completarLogin(data);
    } catch (e) {
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("est.reg.errGeneral"))}</div>`;
    }
  };
}

// ─── CÓMO ESTÁ SU ACCESO ───────────────────────────────────────────────────
// Lo que se usó del mes y cuándo vence. Se muestra en el inicio y frena la
// grabación ANTES de empezar, que es cuando todavía se puede hacer algo.
async function estadoEstudiante() {
  try { return (await api("/medico/estudiante/estado")).estudiante; } catch { return null; }
}

function avisoEstudianteHtml(e) {
  if (!e) return "";
  const fecha = e.hasta ? new Date(e.hasta).toLocaleDateString(localeActual()) : "";
  // Medicina, como siempre; las otras carreras dicen cuál es.
  const nivel = t("est.nivel." + e.nivel) + (e.carrera && e.carrera !== "medicina" ? " · " + t("est.carrera." + e.carrera) : "");
  const continuar = `<button type="button" class="primary" id="estVerPlan">${t("est.abierto.verPlan")}</button>`;
  if (e.prueba) return `<div class="card est-aviso"><strong>${t("est.abierto.prueba")}</strong><p>${t("est.abierto.restante", { minutos: Math.floor(e.segundosRestantes / 60), dias: e.diasRestantes })}</p><p class="hint">${t("est.abierto.audio")}</p>${e.bloqueado ? `<p>${esc(e.motivo)}</p>` : ""}${continuar}</div>`;
  if (e.bloqueado) return `<div class="error est-aviso" style="margin-top:0">⚠️ ${esc(e.motivo)}${continuar}</div>`;
  const porVencer = e.diasRestantes <= 7;
  return `<div class="card card-secundaria est-aviso"${porVencer ? ` style="border-color:var(--warning)"` : ""}>
    <div><b>🎓 ${esc(nivel)}</b> · ${t(porVencer ? "est.aviso.venceProntoEl" : "est.aviso.venceEl", { fecha: esc(fecha), dias: e.diasRestantes })}</div>
    <div class="hint" style="margin:4px 0 0">${t("est.aviso.horas", { usadas: e.horasUsadas, total: e.horasMes })}</div>
  </div>`;
}

// ─── EN EL INICIO ──────────────────────────────────────────────────────────
// Arriba de todo: el aviso de su acceso y, debajo, la racha y lo que tiene
// para estudiar hoy (public/js/estudiantesEstudio.js). Sin frenar el resto de la
// pantalla: el inicio deja un hueco (#estAvisoInicio) y esto lo llena cuando
// llegan los datos. Si para entonces ya se fue a otra pantalla, el hueco no
// existe y no se pinta nada encima de lo que esté mirando.
//
// Antes se agregaba al principio de #app, que en la compu es el contenedor
// del celular y está oculto: en el escritorio el aviso no se veía nunca.
function huecoAvisoEstudianteHtml() {
  return esCuentaEstudiante() ? `<div id="estAvisoInicio"></div>` : "";
}

async function pintarAvisoEstudiante() {
  if (!esCuentaEstudiante()) return;
  const [e, estudio] = await Promise.all([
    estadoEstudiante(),
    ESTUDIANTES_PRENDIDO ? resumenEstudio() : null,
  ]);
  const hueco = document.getElementById("estAvisoInicio");
  if (!hueco) return;
  hueco.innerHTML = avisoEstudianteHtml(e) + (ESTUDIANTES_PRENDIDO ? estudioInicioHtml(estudio) : "");
  const plan = document.getElementById("estVerPlan");
  if (plan) plan.onclick = renderPlanEstudiante;
  const ir = document.getElementById("estIrEstudiar");
  if (ir) ir.onclick = () => renderEstudiar();
}

// La marca que lleva cada nota grabada desde una cuenta de estudiante.
function marcaNotaEstudianteHtml() {
  return `<div class="error est-marca" style="margin-top:0">🎓 ${t("est.marcaNota")}</div>`;
}

// ═══ LO QUE ENGANCHA EN EL NÚCLEO (public/js/extensiones.js) ═══════════════
//
// Primero, las reglas de la cuenta: van siempre, aunque el módulo esté
// apagado en el servidor.

Extensiones.agregar("sesion.entrar", (datos) => fijarEstudiante(datos.estudiante));
Extensiones.agregar("sesion.salir", () => fijarEstudiante(null));

// Lo que una cuenta de estudiante no hace no se dibuja (el servidor lo frena
// igual: modulos/estudiantes/restricciones.js).
const NO_PUEDE_ESTUDIANTE = ["agenda", "recetar", "reconsulta", "presupuestos", "saldo", "compartirPaciente"];
Extensiones.negar(() => (esCuentaEstudiante() ? NO_PUEDE_ESTUDIANTE : []));

// Vencida o sin horas del mes: se dice ANTES de grabar.
Extensiones.agregar("grabar", async () => {
  if (!esCuentaEstudiante()) return "";
  const e = await estadoEstudiante();
  return e?.bloqueado ? e.motivo : "";
});

// La marca de cada nota grabada desde una cuenta de estudiante: queda aunque
// después se reciba.
Extensiones.agregar("consulta.nota", (c) => (c?.deEstudiante ? marcaNotaEstudianteHtml() : ""));

// Arriba del panel: cómo está su acceso (y, prendido, su racha).
Extensiones.agregar("panel.aviso", () => (esCuentaEstudiante()
  ? { html: huecoAvisoEstudianteHtml(), alPintar: pintarAvisoEstudiante } : ""));

// La ficha del paciente, sin Recetas ni Informes: no receta, y no firma ni
// emite informes (el servidor lo frena igual).
const PESTANAS_SIN_ESTUDIANTE = ["recetas", "informes"];
Extensiones.agregar("kardex.pestanas", (pestanas) => (esCuentaEstudiante()
  ? Object.fromEntries(Object.entries(pestanas).filter(([clave]) => !PESTANAS_SIN_ESTUDIANTE.includes(clave)))
  : pestanas));

// El menú de la compu: sus casos, grabar, estudiar y su configuración.
// Agenda, indicaciones, estudios, reportes y finanzas son de un consultorio.
const MENU_ESTUDIANTE = ["inicio", "pacientes", "voz", "estudiar", "configuracion"];
const MENU_ESTUDIAR = { id: "estudiar", claveLabel: "escr.nav.estudiar", icono: ICONOS_ESTUDIANTE.birrete, fn: "renderEstudiar" };
Extensiones.agregar("escritorio.menu", (items) => {
  if (!esCuentaEstudiante()) return items;
  return (ESTUDIANTES_PRENDIDO ? [...items, MENU_ESTUDIAR] : items)
    .filter(i => MENU_ESTUDIANTE.includes(i.id))
    .sort((a, b) => MENU_ESTUDIANTE.indexOf(a.id) - MENU_ESTUDIANTE.indexOf(b.id));
});

// Y lo que el estudiante hace: solo con el módulo prendido.
if (ESTUDIANTES_PRENDIDO) {
  // «Tengo un código de estudiante», debajo del login.
  Extensiones.agregar("login", () => ({
    html: `
      <button class="link" id="lGoEstudiante" style="font-size:13px">${t("est.irRegistro")}</button>`,
    alPintar: () => { document.getElementById("lGoEstudiante").onclick = renderRegistroEstudiante; },
  }));

  // «Estudiar» en el panel del celular, donde un médico tiene la agenda.
  Extensiones.agregar("panel.pestanas", () => (esCuentaEstudiante() ? {
    html: `<button class="tab" id="btnEstudiar"><span class="tab-icono">${ICONOS_ESTUDIANTE.birrete}</span>${t("pacientes.tab.estudiar")}</button>`,
    alPintar: () => { const b = document.getElementById("btnEstudiar"); if (b) b.onclick = () => renderEstudiar(); },
  } : ""));

  // El tutor (public/js/estudiantesTutor.js): mientras graba, y en la consulta.
  Extensiones.agregar("notaEnVivo", ({ conNota, extras }) => tutorEnVivoHtml(extras?.tutor, conNota));
  Extensiones.agregar("consulta.despues", (c) => ({ html: razonamientoTarjetaHtml(c), alPintar: () => engancharRazonamiento(c._id) }));

  // Sus pantallas: con dirección propia, sin repintarse solas, y todas
  // marcan «Estudiar» en el menú de la compu.
  const marcaEstudiar = { id: "estudiar", claveLabel: "escr.nav.estudiar" };
  Extensiones.pantalla({ fn: "renderEstudiar", tipo: "estudiar", ruta: "estudiar", menu: marcaEstudiar });
  Extensiones.pantalla({ fn: "renderPacienteVirtual", tipo: "pacienteVirtual", ruta: "paciente-virtual", menu: marcaEstudiar });
  Extensiones.pantalla({ fn: "renderSimulacros", tipo: "simulacros", ruta: "simulacros", menu: marcaEstudiar });
  Extensiones.pantalla({ fn: "renderCalculadora", tipo: "calculadora", ruta: "calculadora", menu: marcaEstudiar });
}

// El núcleo ofrece el formulario; el módulo conserva sus campos y su ruta.
Extensiones.agregar("registro.google", perfiles => ESTUDIANTES_PRENDIDO ? [...perfiles, {
  id: "estudiante", titulo: t("google.estudiante"), ruta: "/medico/registro-estudiante",
  html: `<p>${t("est.abierto.oferta")}</p><p class="hint">${t("est.abierto.audio")}</p><details><summary>${t("est.abierto.tengoCodigo")}</summary><label for="gCodigo">${t("google.codigo")}</label>
    <input id="gCodigo" autocomplete="off" placeholder="EST-AB12CD" maxlength="30">
    <div class="hint">${t("google.codigoAyuda")}</div></details>
    <label for="gCarrera">${t("perfil.carrera")}</label><select id="gCarrera"><option value="">${t("perfil.seleccionar")}</option>${["medicina", "enfermeria", "odontologia"].map(c => `<option value="${c}">${t("est.carrera." + c)}</option>`).join("")}</select>
    <label for="gNivel">${t("perfil.nivel")}</label><select id="gNivel"><option value="">${t("perfil.seleccionar")}</option>${["estudiante", "interno", "residente"].map(n => `<option value="${n}">${t("est.nivel." + n)}</option>`).join("")}</select>
    <label for="gUniversidad">${t("perfil.universidad")}</label><input id="gUniversidad" maxlength="120">
    <label for="gPeriodo">${t("perfil.periodo")}</label><input id="gPeriodo" maxlength="40">`,
  alPintar: () => {
    const carrera = document.getElementById("gCarrera"), nivel = document.getElementById("gNivel");
    carrera.onchange = () => {
      const residente = nivel.querySelector('option[value="residente"]');
      residente.disabled = carrera.value !== "medicina";
      if (residente.disabled && nivel.value === "residente") nivel.value = "";
    };
    carrera.onchange();
  },
  datos: () => ({ codigo: document.getElementById("gCodigo").value.trim(), carrera: document.getElementById("gCarrera").value,
    nivel: document.getElementById("gNivel").value, universidad: document.getElementById("gUniversidad").value.trim(), periodo: document.getElementById("gPeriodo").value.trim() }),
}] : perfiles);

async function renderPlanEstudiante() {
  detenerPolling();
  app.innerHTML = `<div class="card" id="estPlanCaja"><p>${t("google.cargando")}</p></div>`;
  const caja = document.getElementById("estPlanCaja");
  try {
    const d = await api("/medico/estudiante/plan"); if (!caja.isConnected) return;
    const p = d.pago || {}, s = d.suscripcion;
    const qr = typeof p.qr === "string" && (/^https:\/\//.test(p.qr) || /^\/(?!\/)/.test(p.qr)) ? p.qr : "";
    const numero = String(p.whatsapp || "").replace(/\D/g, "");
    const whatsapp = /^[1-9]\d{6,14}$/.test(numero) ? numero : "";
    const banco = String(p.banco || "").trim(), cuenta = String(p.cuenta || "").trim(), titular = String(p.titular || "").trim();
    const medioDePago = Boolean(qr || (banco && cuenta));
    // No invitar a transferir si no hay un canal donde entregar el comprobante.
    const disponible = medioDePago && Boolean(whatsapp);
    const mensaje = t("est.abierto.mensajePago", { precio: s.precios.mensualTexto });
    const enlaceWhatsApp = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(mensaje)}` : "";
    caja.innerHTML = `<h2>${t("est.abierto.plan")}</h2><p>${t("est.abierto.precio", { precio: esc(s.precios.mensualTexto), horas: s.horasMes })}</p>
      <p>${t(disponible ? "est.abierto.pago" : medioDePago ? "est.abierto.sinCanalPago" : "est.abierto.sinPago")}</p>
      ${disponible ? `
        <h3>${t("est.abierto.pasoPagar")}</h3>
        ${qr ? `<img src="${esc(qr)}" alt="${t("est.abierto.qrAlt")}" style="display:block;max-width:100%;width:280px;height:auto;margin:16px auto">
          <a class="secondary" style="display:block;text-align:center;margin:12px 0" href="${esc(qr)}" target="_blank" rel="noopener noreferrer">${t("est.abierto.abrirQr")}</a>
          ${/^\/(?!\/)/.test(qr) && !qr.includes("\\") ? `<a class="secondary" style="display:block;text-align:center;margin:12px 0" href="${esc(qr)}" download>${t("est.abierto.guardarQr")}</a>` : ""}
          <p class="hint">${t("est.abierto.qrAyuda")}</p>` : ""}
        ${banco ? `<p>${esc(banco)}</p>` : ""}
        ${cuenta ? `<p>${t("est.abierto.cuenta")}: ${esc(cuenta)}</p>` : ""}
        ${titular ? `<p>${t("est.abierto.titular")}: ${esc(titular)}</p>` : ""}
        <p class="hint">${t("est.abierto.verificarPago", { precio: esc(s.precios.mensualTexto) })}</p>
        <h3>${t("est.abierto.pasoComprobante")}</h3>
        <p>${t("est.abierto.adjuntarComprobante")}</p>` : ""}
      ${whatsapp ? `<a class="primary" style="display:block;text-align:center;margin:16px 0" href="${esc(enlaceWhatsApp)}" target="_blank" rel="noopener noreferrer">${t(disponible ? "est.abierto.comprobante" : "est.abierto.consultarPago")}</a><p class="hint">WhatsApp: +${esc(whatsapp)}</p>` : ""}
      ${disponible ? `<p class="hint">${t("est.abierto.activacionPago")}</p>` : ""}
      <button type="button" class="link" id="estPlanVolver">${t("est.abierto.volver")}</button>`;
    document.getElementById("estPlanVolver").onclick = irAPantallaInicial;
  } catch (e) { if (caja.isConnected) caja.innerHTML = `<p class="error">${esc(e.error || t("google.error"))}</p><button type="button" class="link" id="estPlanVolver">${t("est.abierto.volver")}</button>`;
    const volver = document.getElementById("estPlanVolver"); if (volver) volver.onclick = irAPantallaInicial; }
}
