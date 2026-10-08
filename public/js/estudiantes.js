// Symphomed — Cuentas de estudiante, del lado de la pantalla.
//
// Un Symphomed más simple: sus casos, grabar la consulta y la nota. Lo que no
// le corresponde (recetar, escribirle a pacientes, turnos, cobros) no se
// dibuja — pero el que decide es el servidor (services/estudiantes.js): esto
// solo evita mostrar botones que contestarían «no disponible».

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

// ─── ENTRAR CON UN CÓDIGO ──────────────────────────────────────────────────
function renderRegistroEstudiante() {
  detenerPolling();
  app.innerHTML = `
    <div class="card reg-card">
      <div class="nota-titulo" style="margin-top:0">${t("est.reg.titulo")}</div>
      <div class="hint" style="margin-bottom:12px">${t("est.reg.bajada")}</div>
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
  const nivel = t("est.nivel." + e.nivel);
  if (e.bloqueado) return `<div class="error est-aviso" style="margin-top:0">⚠️ ${esc(e.motivo)}</div>`;
  const porVencer = e.diasRestantes <= 7;
  return `<div class="card card-secundaria est-aviso"${porVencer ? ` style="border-color:var(--warning)"` : ""}>
    <div><b>🎓 ${esc(nivel)}</b> · ${t(porVencer ? "est.aviso.venceProntoEl" : "est.aviso.venceEl", { fecha: esc(fecha), dias: e.diasRestantes })}</div>
    <div class="hint" style="margin:4px 0 0">${t("est.aviso.horas", { usadas: e.horasUsadas, total: e.horasMes })}</div>
  </div>`;
}

// ─── EN EL INICIO ──────────────────────────────────────────────────────────
// Arriba de todo: el aviso de su acceso y, debajo, la racha y lo que tiene
// para estudiar hoy (public/js/estudio.js). Sin frenar el resto de la
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
    typeof resumenEstudio === "function" ? resumenEstudio() : null,
  ]);
  const hueco = document.getElementById("estAvisoInicio");
  if (!hueco) return;
  hueco.innerHTML = avisoEstudianteHtml(e) + (typeof estudioInicioHtml === "function" ? estudioInicioHtml(estudio) : "");
  const ir = document.getElementById("estIrEstudiar");
  if (ir) ir.onclick = () => renderEstudiar();
}

// La marca que lleva cada nota grabada desde una cuenta de estudiante.
function marcaNotaEstudianteHtml() {
  return `<div class="error est-marca" style="margin-top:0">🎓 ${t("est.marcaNota")}</div>`;
}
