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
  // Medicina, como siempre; las otras carreras dicen cuál es.
  const nivel = t("est.nivel." + e.nivel) + (e.carrera && e.carrera !== "medicina" ? " · " + t("est.carrera." + e.carrera) : "");
  if (e.bloqueado) return `<div class="error est-aviso" style="margin-top:0">⚠️ ${esc(e.motivo)}</div>`;
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
