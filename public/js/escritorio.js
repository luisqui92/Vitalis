// Symphomed — Vista de escritorio: mismo backend y las mismas pantallas de
// siempre (renderDashboard, renderAgenda, renderSeguridad...), pero en
// pantallas anchas se arma un shell fijo de sidebar + barra superior en vez
// del layout de una sola columna centrada (pensado para el celular). Ninguna
// función de pantalla se toca: todas ya escriben en `app`, así que alcanza
// con reapuntar esa variable al contenedor del panel (#escritorioContent)
// cuando corresponde.
// ═══ EL ANCHO SE MIRA CADA VEZ, NO UNA SOLA ════════════════════════════════
//
// Esto era una constante evaluada al cargar el archivo y nunca más. O sea:
// la decisión de si estamos en escritorio o en celular se tomaba una sola
// vez en la vida de la pestaña.
//
// El síntoma: alguien achica la ventana de escritorio a ancho de celular —o
// gira una tablet, que es el caso más común— y la app sigue creyendo que
// tiene 1400px. El shell de escritorio queda armado adentro de una ventana
// angosta y aparece desborde horizontal hasta que se recarga.
//
// Ahora es una FUNCIÓN: cada quien que pregunta recibe la respuesta de ahora.
// Y además se escucha el cambio, para rearmar la pantalla en el momento en
// vez de esperar a que el usuario descubra solo que tiene que recargar.
const CONSULTA_ESCRITORIO = window.matchMedia("(min-width: 1024px)");
function esEscritorio() { return CONSULTA_ESCRITORIO.matches; }

// Se arma recién con la primera pantalla real (Inicio), no en el login —
// un login centrado sigue siendo lo más simple y claro incluso en una
// pantalla grande.
let escrActivo = "inicio";

// Cada ítem guarda la CLAVE del texto, no el texto. Acá importa más que en
// otros lados: envolverParaEscritorio() se llama al final de este archivo y
// se queda con el label en un closure, así que un texto puesto acá quedaría
// congelado en el idioma que hubiera ANTES del login, para toda la sesión.
// ═══ EL MENÚ SE ARMA CADA VEZ QUE SE DIBUJA ════════════════════════════════
//
// Antes esta lista se armaba UNA vez, al cargar la página, mirando el rol y la
// especialidad que había guardados de la sesión anterior. Quien inicia sesión
// sin recargar —que es lo normal— quedaba con el menú del que NO era: un
// director no veía «Clínica», un veterinario no veía «Ganadería» y el operador
// no veía «Pagos», hasta que recargaba la página.
//
// Ahora los fijos están acá y los que dependen de quién entró se deciden en
// escrNavItems(), cada vez que se pinta el menú.
const ESCR_NAV_FIJOS = [
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

// El panel de clínica solo aparece para quien administra una. Va primero para
// que sea lo primero que ve un director al abrir el menú.
const ESCR_NAV_CLINICA = { id: "clinica", claveLabel: "clin.nav.clinica", icono: ICONOS.escudo, fn: "renderClinica" };
// Los pagos también, para quien acredita. Va aparte del bloque de clínica
// porque son permisos distintos: administrar siete consultorios no da
// ninguna facultad sobre la plata, y al revés tampoco.
const ESCR_NAV_PAGOS = { id: "pagos", claveLabel: "op.nav.pagos", icono: ICONOS.tendencia, fn: "renderPagos" };
// Symphomed Ganadería: solo para quien atiende veterinaria — un consultorio
// de medicina general no tiene lotes que manejar, y agregarle el ítem igual
// solo ensuciaría un menú que ya no le sirve.
const ESCR_NAV_GANADERIA = { id: "ganaderia", claveLabel: "escr.nav.ganaderia", icono: ICONOS.pata, fn: "renderGanaderia" };

// Lo que ve una cuenta de estudiante (public/js/estudiantes.js): sus casos,
// grabar y su configuración. Agenda, indicaciones, estudios, reportes y
// finanzas son de un consultorio.
const ESCR_NAV_ESTUDIANTE = ["inicio", "pacientes", "voz", "configuracion"];

function escrNavItems() {
  if (typeof esCuentaEstudiante === "function" && esCuentaEstudiante()) {
    return ESCR_NAV_FIJOS.filter(i => ESCR_NAV_ESTUDIANTE.includes(i.id));
  }
  const items = ESCR_NAV_FIJOS.slice();
  if (typeof MEDICO_TIPO_ESPECIALIDAD !== "undefined" && MEDICO_TIPO_ESPECIALIDAD === "veterinaria") {
    const idx = items.findIndex(i => i.id === "configuracion");
    items.splice(idx === -1 ? items.length : idx, 0, ESCR_NAV_GANADERIA);
  }
  if (typeof esAdministrador === "function" && esAdministrador()) items.unshift(ESCR_NAV_CLINICA);
  if (typeof ES_OPERADOR !== "undefined" && ES_OPERADOR) items.unshift(ESCR_NAV_PAGOS);
  return items;
}

function escritorioShellActivo() {
  return esEscritorio() && document.getElementById("escritorioShell").style.display !== "none";
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
  if (!esEscritorio()) return false;
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
  if (!esEscritorio()) return;
  document.getElementById("escritorioShell").style.display = "none";
  document.getElementById("headerMobile").style.display = "";
  document.querySelector(".footer.no-imprimir").style.display = "";
  document.getElementById("app").style.display = "";
  app = document.getElementById("app");
}

function pintarNavEscritorio() {
  const nav = document.getElementById("escrNav");
  nav.innerHTML = escrNavItems().map(it => `
    <button class="escr-nav-item${it.id === escrActivo ? " activo" : ""}" data-id="${it.id}">
      <span class="escr-nav-icono">${it.icono}</span>${esc(t(it.claveLabel))}
    </button>`).join("");
  nav.querySelectorAll(".escr-nav-item").forEach(btn => {
    btn.onclick = () => {
      const item = escrNavItems().find(i => i.id === btn.dataset.id);
      window[item.fn]();
    };
  });
}

// ─── CUANDO LA VENTANA CRUZA EL UMBRAL ────────────────────────────────────
//
// Achicar la ventana, girar una tablet, abrir la consola del navegador: las
// tres cruzan los 1024px y hasta acá ninguna cambiaba nada hasta recargar.
//
// Se vuelve a dibujar la pantalla que estuviera abierta en vez de solo
// mostrar u ocultar el shell: las pantallas se arman distinto según el ancho
// —el Kardex, la agenda— y dejar el HTML viejo adentro del contenedor nuevo
// es justo el desborde horizontal que se quería arreglar.
//
// addEventListener y no el viejo addListener: este último está obsoleto y en
// algunos navegadores ya no existe. Se deja el respaldo igual porque un
// navegador viejo de un consultorio no es un caso hipotético.
function alCambiarElAncho() {
  // Antes de entrar (el login, por ejemplo) no hay nada que rearmar.
  if (!MEDICO_NOMBRE) return;
  if (esEscritorio()) activarEscritorioSiCorresponde();
  else desactivarEscritorioForzado();

  // La URL es la fuente de verdad de la pantalla abierta. Esto conserva una
  // ficha, una consulta y su pestaña exacta al girar la tablet o redimensionar
  // la ventana; escrActivo solo conoce las secciones del menú de escritorio.
  if (typeof abrirDesdeLaDireccion === "function" && abrirDesdeLaDireccion()) return;

  // Se repinta la pantalla actual. Si por algo no se puede, se cae al panel
  // de siempre, que es preferible a quedarse con el layout roto.
  const item = escrNavItems().find(i => i.id === escrActivo);
  const volverA = item && typeof window[item.fn] === "function" ? window[item.fn] : window.renderDashboard;
  try { volverA(); } catch { /* si falla, queda lo que había */ }
}

// desactivarEscritorio() arranca con `if (!esEscritorio()) return`, que
// servía cuando el ancho no cambiaba nunca. Ahora hay que poder apagar el
// shell JUSTO cuando la consulta dice que ya NO es escritorio, que es
// exactamente el caso que ese return bloquea.
function desactivarEscritorioForzado() {
  const shell = document.getElementById("escritorioShell");
  if (!shell || shell.style.display === "none") return;
  shell.style.display = "none";
  document.getElementById("headerMobile").style.display = "";
  document.querySelector(".footer.no-imprimir").style.display = "";
  document.getElementById("app").style.display = "";
  app = document.getElementById("app");
}

if (CONSULTA_ESCRITORIO.addEventListener) CONSULTA_ESCRITORIO.addEventListener("change", alCambiarElAncho);
else if (CONSULTA_ESCRITORIO.addListener) CONSULTA_ESCRITORIO.addListener(alCambiarElAncho);

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
    if (typeof reportarError === "function") reportarError(e, "renderInicioEscritorio");
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
              <button type="button" class="escr-lista-item escr-lista-item-error" data-consulta-id="${c._id}">
                <div>
                  <div class="escr-lista-titulo">${t("escr.notaError", { paciente: esc(c.pacienteNombre || "") })}</div>
                  <div class="escr-lista-sub">${t("escr.revisarReintentar")}</div>
                </div>
              </button>`).join("")}
          </div>`}
      </div>

      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t(esVet ? "escr.recientesVet" : "escr.recientes")}</div>
        ${pacientesRecientes.length === 0 ? `<div class="hint">${t("escr.sinPacientes")}</div>` : `
          <div class="escr-lista">
            ${pacientesRecientes.map(p => `
              <button type="button" class="escr-lista-item escr-lista-item-click" data-paciente-id="${p._id}">
                <div class="avatar avatar-xs">${esc(iniciales(p.nombre))}</div>
                <div><div class="escr-lista-titulo">${esc(p.nombre)}</div></div>
              </button>`).join("")}
          </div>`}
      </div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("escr.consultasRecientes")}</div>
      ${consultasRecientes.length === 0 ? `<div class="hint">${t("escr.sinConsultas")}</div>` : `
        <div class="escr-lista">
          ${consultasRecientes.map(c => `
            <button type="button" class="escr-lista-item escr-lista-item-click" data-consulta-id="${c._id}">
              <div>
                <div class="escr-lista-titulo">${esc(c.pacienteNombre || "")}</div>
                <div class="escr-lista-sub">${esc(new Date(c.createdAt).toLocaleString(localeActual()))} · ${t(c.estado === "completado" ? "escr.consulta.completada" : c.estado === "error" ? "escr.consulta.error" : "escr.consulta.procesando")}</div>
              </div>
            </button>`).join("")}
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

// Se envuelven TODAS las pantallas posibles, no las del rol de antes del login:
// el menú de quien entre se decide recién cuando entra.
[...ESCR_NAV_FIJOS, ESCR_NAV_CLINICA, ESCR_NAV_PAGOS, ESCR_NAV_GANADERIA]
  .filter(it => typeof window[it.fn] === "function")
  .forEach(it => envolverParaEscritorio(it.fn, it.id, it.claveLabel));
