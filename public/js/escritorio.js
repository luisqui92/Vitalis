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

const ESCR_NAV_ITEMS = [
  { id: "inicio", label: "Inicio", icono: ICONOS.tendencia },
  { id: "pacientes", label: "Pacientes", icono: ICONOS.persona },
  { id: "agenda", label: "Agenda", icono: ICONOS.calendario },
  { id: "configuracion", label: "Configuración", icono: ICONOS.escudo },
];

function escritorioShellActivo() {
  return ES_ESCRITORIO && document.getElementById("escritorioShell").style.display !== "none";
}

// Envuelve una función de pantalla existente para que, cada vez que se
// llame (desde el sidebar, o desde un botón interno como "← Panel" o
// "btnAgenda" dentro del dashboard móvil de pacientes), el sidebar y el
// título de la barra superior del escritorio se actualicen solos. Así no
// hace falta tocar pacientes.js/agenda.js/seguridad.js para que naveguen
// "bien" desde el escritorio — siguen sin saber que existe.
function envolverParaEscritorio(nombreFn, id, label) {
  const original = window[nombreFn];
  window[nombreFn] = function (...args) {
    if (escritorioShellActivo()) {
      escrActivo = id;
      pintarNavEscritorio();
      const titulo = document.getElementById("escrTituloPantalla");
      if (titulo) titulo.textContent = label;
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
  const marca = document.querySelector(".brand h1")?.textContent || "Vitalis";
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
      <span class="escr-nav-icono">${it.icono}</span>${esc(it.label)}
    </button>`).join("");
  nav.querySelectorAll(".escr-nav-item").forEach(btn => {
    btn.onclick = () => {
      const item = ESCR_NAV_ITEMS.find(i => i.id === btn.dataset.id);
      if (item.id === "inicio") renderInicioEscritorio();
      else if (item.id === "pacientes") renderDashboard();
      else if (item.id === "agenda") renderAgenda();
      else if (item.id === "configuracion") renderSeguridad();
    };
  });
}

// Este script va al final del <body>, así que el DOM ya existe — no hace
// falta esperar DOMContentLoaded.
document.getElementById("escrBtnLogout").onclick = logout;

// ─── INICIO (resumen del consultorio, con datos reales) ─────────────────
async function renderInicioEscritorio() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando tu panel...</div>`;
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
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando el panel")}</div>`;
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
      ${escrStatCardHtml(pacientes.length, esVet ? "Mascotas" : "Pacientes")}
      ${escrStatCardHtml(citasHoy.length, "Citas hoy")}
      ${escrStatCardHtml(consultasEsteMes, "Consultas este mes")}
      ${escrStatCardHtml(recordatorios.length, "Recordatorios pendientes")}
    </div>

    <div class="escr-grid-2">
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">📅 Agenda de hoy</div>
        ${citasHoy.length === 0 ? `<div class="hint">No tenés citas confirmadas para hoy.</div>` : `
          <div class="escr-lista">
            ${citasHoy.map(c => `
              <div class="escr-lista-item">
                <div class="escr-lista-hora">${esc(new Date(c.fecha).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }))}</div>
                <div>
                  <div class="escr-lista-titulo">${esc(c.pacienteNombre || "Sin nombre")}</div>
                  ${c.motivo ? `<div class="escr-lista-sub">${esc(c.motivo)}</div>` : ""}
                </div>
              </div>`).join("")}
          </div>`}
      </div>

      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">⚡ Acciones rápidas</div>
        <div class="escr-acciones">
          <button class="secondary" id="escrBtnNuevoPaciente">${esVet ? "🐾" : "➕"} Nuevo ${esVet ? "paciente" : "paciente"}</button>
          <button class="secondary" id="escrBtnIrAgenda">📅 Ir a la agenda</button>
          <button class="secondary" id="escrBtnIrConfig">⚙️ Configuración</button>
        </div>
      </div>
    </div>

    <div class="escr-grid-2">
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">🔔 Pendientes</div>
        ${recordatorios.length === 0 && notasConError.length === 0 ? `<div class="hint">Estás al día — no hay nada pendiente.</div>` : `
          <div class="escr-lista">
            ${recordatorios.slice(0, 5).map(r => `
              <div class="escr-lista-item">
                <div>
                  <div class="escr-lista-titulo">${esc(TIPOS_RECORDATORIO[r.tipo] || "🔔")} ${esc(r.titulo)} — ${esc(r.pacienteNombre)}</div>
                  <div class="escr-lista-sub">${r.fecha ? esc(new Date(r.fecha).toLocaleDateString("es-BO")) : ""}</div>
                </div>
              </div>`).join("")}
            ${notasConError.map(c => `
              <div class="escr-lista-item escr-lista-item-error" data-consulta-id="${c._id}">
                <div>
                  <div class="escr-lista-titulo">⚠️ Nota clínica con error — ${esc(c.pacienteNombre || "")}</div>
                  <div class="escr-lista-sub">Revisar y reintentar</div>
                </div>
              </div>`).join("")}
          </div>`}
      </div>

      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${esVet ? "🐾 Mascotas recientes" : "👤 Pacientes recientes"}</div>
        ${pacientesRecientes.length === 0 ? `<div class="hint">Todavía no registraste ningún ${esVet ? "paciente" : "paciente"}.</div>` : `
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
      <div class="seccion-titulo" style="margin-top:0">🎙️ Consultas recientes</div>
      ${consultasRecientes.length === 0 ? `<div class="hint">Todavía no hay consultas registradas.</div>` : `
        <div class="escr-lista">
          ${consultasRecientes.map(c => `
            <div class="escr-lista-item escr-lista-item-click" data-consulta-id="${c._id}">
              <div>
                <div class="escr-lista-titulo">${esc(c.pacienteNombre || "")}</div>
                <div class="escr-lista-sub">${esc(new Date(c.createdAt).toLocaleString("es-BO"))} · ${c.estado === "completado" ? "Completada" : c.estado === "error" ? "Con error" : "Procesando"}</div>
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

envolverParaEscritorio("renderDashboard", "pacientes", "Pacientes");
envolverParaEscritorio("renderAgenda", "agenda", "Agenda");
envolverParaEscritorio("renderSeguridad", "configuracion", "Configuración");
envolverParaEscritorio("renderInicioEscritorio", "inicio", "Inicio");
