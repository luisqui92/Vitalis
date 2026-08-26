// Vitalis — Vista de escritorio: mismo backend y las mismas pantallas de
// siempre (renderDashboard, renderAgenda, renderSeguridad...), pero en
// pantallas anchas se arma un shell fijo de sidebar + barra superior en vez
// del layout de una sola columna centrada (pensado para el celular). Ninguna
// función de pantalla se toca: todas ya escriben en `app`, así que alcanza
// con reapuntar esa variable al contenedor del panel (#escritorioContent)
// cuando corresponde.
const ES_ESCRITORIO = window.matchMedia("(min-width: 1024px)").matches;

// Se arma recién con la primera pantalla real (Inicio), no en el login —
// un login centrado sigue siendo lo más simple y claro incluso en una
// pantalla grande.
let escrActivo = "inicio";

// Cada ítem guarda la CLAVE del texto, no el texto. Acá importa más que en
// otros lados: envolverParaEscritorio() se llama al final de este archivo y
// se queda con el label en un closure, así que un texto puesto acá quedaría
// congelado en el idioma que hubiera ANTES del login, para toda la sesión.
const ESCR_NAV_ITEMS = [
  { id: "inicio", claveLabel: "escr.nav.inicio", icono: ICONOS.tendencia, fn: "renderInicioEscritorio" },
  { id: "pacientes", claveLabel: "escr.nav.pacientes", icono: ICONOS.persona, fn: "renderDashboard" },
  { id: "agenda", claveLabel: "escr.nav.agenda", icono: ICONOS.calendario, fn: "renderAgenda" },
  { id: "voz", claveLabel: "escr.nav.voz", icono: ICONOS.mic, fn: "renderVozEscritorio" },
  { id: "indicaciones", claveLabel: "escr.nav.indicaciones", icono: ICONOS.documento, fn: "renderIndicacionesEscritorio" },
  { id: "estudios", claveLabel: "escr.nav.estudios", icono: ICONOS.frasco, fn: "renderEstudiosEscritorio" },
  { id: "reportes", claveLabel: "escr.nav.reportes", icono: ICONOS.tendencia, fn: "renderReportesEscritorio" },
  { id: "finanzas", claveLabel: "escr.nav.finanzas", icono: ICONOS.clipboard, fn: "renderFinanzasEscritorio" },
  { id: "configuracion", claveLabel: "escr.nav.configuracion", icono: ICONOS.escudo, fn: "renderSeguridad" },
];

// El panel de clínica solo aparece para quien administra una. Se agrega
// primero para que sea lo primero que ve un director al abrir el menú.
if (typeof esAdministrador === "function" && esAdministrador()) {
  ESCR_NAV_ITEMS.unshift({ id: "clinica", claveLabel: "clin.nav.clinica", icono: ICONOS.escudo, fn: "renderClinica" });
}

function escritorioShellActivo() {
  return ES_ESCRITORIO && document.getElementById("escritorioShell").style.display !== "none";
}

// Envuelve una función de pantalla existente para que, cada vez que se
// llame (desde el sidebar, o desde un botón interno como "← Panel" o
// "btnAgenda" dentro del dashboard móvil de pacientes), el sidebar y el
// título de la barra superior del escritorio se actualicen solos. Así no
// hace falta tocar pacientes.js/agenda.js/seguridad.js para que naveguen
// "bien" desde el escritorio — siguen sin saber que existe.
function envolverParaEscritorio(nombreFn, id, claveLabel) {
  const original = window[nombreFn];
  window[nombreFn] = function (...args) {
    if (escritorioShellActivo()) {
      escrActivo = id;
      pintarNavEscritorio();
      const titulo = document.getElementById("escrTituloPantalla");
      if (titulo) titulo.textContent = t(claveLabel);
    }
    return original.apply(this, args);
  };
}

function activarEscritorioSiCorresponde() {
  if (!ES_ESCRITORIO) return false;
  document.getElementById("headerMobile").style.display = "none";
  document.getElementById("app").style.display = "none";
  document.querySelector(".footer.no-imprimir").style.display = "none";
  document.getElementById("escritorioShell").style.display = "flex";
  app = document.getElementById("escritorioContent");
  document.getElementById("escrUsuario").textContent = MEDICO_NOMBRE || "";
  const marca = document.querySelector(".brand h1")?.textContent || t("marca.base");
  document.getElementById("escrMarcaTexto").textContent = marca;
  pintarNavEscritorio();
  return true;
}

function desactivarEscritorio() {
  if (!ES_ESCRITORIO) return;
  document.getElementById("escritorioShell").style.display = "none";
  document.getElementById("headerMobile").style.display = "";
  document.querySelector(".footer.no-imprimir").style.display = "";
  document.getElementById("app").style.display = "";
  app = document.getElementById("app");
}

function pintarNavEscritorio() {
  const nav = document.getElementById("escrNav");
  nav.innerHTML = ESCR_NAV_ITEMS.map(it => `
    <button class="escr-nav-item${it.id === escrActivo ? " activo" : ""}" data-id="${it.id}">
      <span class="escr-nav-icono">${it.icono}</span>${esc(t(it.claveLabel))}
    </button>`).join("");
  nav.querySelectorAll(".escr-nav-item").forEach(btn => {
    btn.onclick = () => {
      const item = ESCR_NAV_ITEMS.find(i => i.id === btn.dataset.id);
      window[item.fn]();
    };
  });
}

// Este script va al final del <body>, así que el DOM ya existe — no hace
// falta esperar DOMContentLoaded.
document.getElementById("escrBtnLogout").onclick = logout;

// ─── INICIO (resumen del consultorio, con datos reales) ─────────────────
async function renderInicioEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("escr.cargando")}</div>`;
  try {
    const [dataPacientes, dataCitas, dataRecordatorios, dataConsultas] = await Promise.all([
      api("/medico/pacientes"),
      api("/medico/citas"),
      api("/medico/recordatorios"),
      api("/medico/consultas"),
    ]);
    pintarInicioEscritorio(
      dataPacientes.pacientes || [],
      dataCitas.citas || [],
      dataRecordatorios.recordatorios || [],
      dataConsultas.consultas || []
    );
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("escr.error"))}</div>`;
  }
}

function escrStatCardHtml(valor, label) {
  return `<div class="escr-stat"><div class="escr-stat-valor">${esc(String(valor))}</div><div class="escr-stat-label">${esc(label)}</div></div>`;
}

function pintarInicioEscritorio(pacientes, citas, recordatorios, consultas) {
  const hoyStr = fechaStrLocal(new Date());
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

  const citasHoy = citas
    .filter(c => c.estado === "confirmada" && fechaStrLocal(c.fecha) === hoyStr)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const consultasEsteMes = consultas.filter(c => new Date(c.createdAt) >= inicioMes).length;
  const pacientesRecientes = [...pacientes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const consultasRecientes = consultas.slice(0, 5);
  const notasConError = consultas.filter(c => c.notaClinicaEstado === "error").slice(0, 5);

  const esVet = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";

  app.innerHTML = `
    <div class="escr-stats">
      ${escrStatCardHtml(pacientes.length, t(esVet ? "escr.stat.mascotas" : "escr.stat.pacientes"))}
      ${escrStatCardHtml(citasHoy.length, t("escr.stat.citasHoy"))}
      ${escrStatCardHtml(consultasEsteMes, t("escr.stat.consultasMes"))}
      ${escrStatCardHtml(recordatorios.length, t("escr.stat.recordatorios"))}
    </div>

    <div class="escr-grid-2">
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("escr.agendaHoy")}</div>
        ${citasHoy.length === 0 ? `<div class="hint">${t("escr.sinCitasHoy")}</div>` : `
          <div class="escr-lista">
            ${citasHoy.map(c => `
              <div class="escr-lista-item">
                <div class="escr-lista-hora">${esc(new Date(c.fecha).toLocaleTimeString(localeActual(), { hour: "2-digit", minute: "2-digit" }))}</div>
                <div>
                  <div class="escr-lista-titulo">${esc(c.pacienteNombre || t("escr.sinNombre"))}</div>
                  ${c.motivo ? `<div class="escr-lista-sub">${esc(c.motivo)}</div>` : ""}
                </div>
              </div>`).join("")}
          </div>`}
      </div>

      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("escr.acciones")}</div>
        <div class="escr-acciones">
          <button class="secondary" id="escrBtnNuevoPaciente">${t(esVet ? "escr.nuevoPacienteVet" : "escr.nuevoPaciente")}</button>
          <button class="secondary" id="escrBtnIrAgenda">${t("escr.irAgenda")}</button>
          <button class="secondary" id="escrBtnIrConfig">${t("escr.irConfig")}</button>
        </div>
      </div>
    </div>

    <div class="escr-grid-2">
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("escr.pendientes")}</div>
        ${recordatorios.length === 0 && notasConError.length === 0 ? `<div class="hint">${t("escr.alDia")}</div>` : `
          <div class="escr-lista">
            ${recordatorios.slice(0, 5).map(r => `
              <div class="escr-lista-item">
                <div>
                  <div class="escr-lista-titulo">${esc(tiposRecordatorio()[r.tipo] || "🔔")} ${esc(r.titulo)} — ${esc(r.pacienteNombre)}</div>
                  <div class="escr-lista-sub">${r.fecha ? esc(new Date(r.fecha).toLocaleDateString(localeActual())) : ""}</div>
                </div>
              </div>`).join("")}
            ${notasConError.map(c => `
              <div class="escr-lista-item escr-lista-item-error" data-consulta-id="${c._id}">
                <div>
                  <div class="escr-lista-titulo">${t("escr.notaError", { paciente: esc(c.pacienteNombre || "") })}</div>
                  <div class="escr-lista-sub">${t("escr.revisarReintentar")}</div>
                </div>
              </div>`).join("")}
          </div>`}
      </div>

      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t(esVet ? "escr.recientesVet" : "escr.recientes")}</div>
        ${pacientesRecientes.length === 0 ? `<div class="hint">${t("escr.sinPacientes")}</div>` : `
          <div class="escr-lista">
            ${pacientesRecientes.map(p => `
              <div class="escr-lista-item escr-lista-item-click" data-paciente-id="${p._id}">
                <div class="avatar avatar-xs">${esc(iniciales(p.nombre))}</div>
                <div><div class="escr-lista-titulo">${esc(p.nombre)}</div></div>
              </div>`).join("")}
          </div>`}
      </div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("escr.consultasRecientes")}</div>
      ${consultasRecientes.length === 0 ? `<div class="hint">${t("escr.sinConsultas")}</div>` : `
        <div class="escr-lista">
          ${consultasRecientes.map(c => `
            <div class="escr-lista-item escr-lista-item-click" data-consulta-id="${c._id}">
              <div>
                <div class="escr-lista-titulo">${esc(c.pacienteNombre || "")}</div>
                <div class="escr-lista-sub">${esc(new Date(c.createdAt).toLocaleString(localeActual()))} · ${t(c.estado === "completado" ? "escr.consulta.completada" : c.estado === "error" ? "escr.consulta.error" : "escr.consulta.procesando")}</div>
              </div>
            </div>`).join("")}
        </div>`}
    </div>
  `;

  document.getElementById("escrBtnNuevoPaciente").onclick = renderNuevoPaciente;
  document.getElementById("escrBtnIrAgenda").onclick = renderAgenda;
  document.getElementById("escrBtnIrConfig").onclick = renderSeguridad;
  document.querySelectorAll("[data-paciente-id]").forEach(el => {
    el.onclick = () => renderPacienteDetalle(el.dataset.pacienteId);
  });
  document.querySelectorAll("[data-consulta-id]").forEach(el => {
    el.onclick = () => renderDetalle(el.dataset.consultaId);
  });
}

ESCR_NAV_ITEMS.forEach(it => envolverParaEscritorio(it.fn, it.id, it.claveLabel));
