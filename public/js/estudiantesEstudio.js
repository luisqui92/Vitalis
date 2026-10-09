// Symphomed — Estudiar con los casos propios (cuentas de estudiante, etapa 3).
//
// Las tarjetas salen del razonamiento de cada caso (modulos/estudiantes/estudio.js):
// «¿cuál es el diagnóstico más probable?», qué estudio lo confirma, las
// banderas rojas y qué faltó preguntar. Van de a una. La de diagnóstico se
// contesta tocando una opción y la corrige el servidor; las otras se piensan,
// se da vuelta la tarjeta y él dice si se acordaba.
//
// La pantalla nunca presenta la respuesta como la verdad: es la del
// razonamiento de ese caso, y el diagnóstico lo confirma su tutor.
//
// Etapa 4: arriba, tres pestañas — sus casos (esto), el paciente virtual
// (public/js/estudiantesPacienteVirtual.js) y los simulacros
// (public/js/estudiantesSimulacros.js).
// Las preguntas que erra en un simulacro vuelven acá, como tarjetas.

// La sentada en curso: las tarjetas, por cuál va y cómo le va.
let SENTADA = null;
// El último resumen que llegó: para saber qué logros son nuevos al terminar.
let RESUMEN_ESTUDIO = null;

const LETRAS_OPCION = ["A", "B", "C", "D", "E"];
const ICONO_LOGRO = {
  primerCaso: "🩺", casos10: "📚", casos50: "🏛️", aciertos5: "🎯", aciertos25: "🏹",
  racha3: "🔥", racha7: "🔥", racha30: "🔥", dominadas10: "🧠", dominadas50: "🧠",
  paciente1: "🗣️", pacientes10: "🗣️", pacientes30: "🗣️", simulacro1: "📝", simulacros10: "📝", simulacro80: "🏆",
};
const MOTIVOS_REPORTE_ESTUDIO = ["respuesta", "pregunta", "datos"];
// Las que se contestan eligiendo una opción (la de diagnóstico de un caso y
// las de simulacro); las otras, «me acordaba o no».
const TARJETAS_DE_OPCIONES = ["dx", "pregunta"];

// ─── LAS TRES PESTAÑAS ─────────────────────────────────────────────────────
const PESTANAS_ESTUDIO = [
  { id: "casos", clave: "estudio.pestana.casos", fn: "renderEstudiar" },
  { id: "paciente", clave: "estudio.pestana.paciente", fn: "renderPacienteVirtual" },
  { id: "simulacros", clave: "estudio.pestana.simulacros", fn: "renderSimulacros" },
];

function pestanasEstudioHtml(activa) {
  return `<div class="est-pestanas" role="tablist">${PESTANAS_ESTUDIO.map(p => `
    <button type="button" role="tab" class="est-pestana${p.id === activa ? " activa" : ""}" data-pestana="${p.id}" aria-selected="${p.id === activa}">${t(p.clave)}</button>`).join("")}
  </div>`;
}

function engancharPestanasEstudio() {
  document.querySelectorAll(".est-pestana[data-pestana]").forEach(b => {
    const p = PESTANAS_ESTUDIO.find(x => x.id === b.dataset.pestana);
    b.onclick = () => { if (typeof window[p.fn] === "function") window[p.fn](); };
  });
}

// Lo que se espera mientras se prepara algo en el servidor (un paciente
// virtual, un simulacro): pregunta cada pocos segundos. Si el estudiante se
// fue a otra pantalla (la marca ya no está), deja de preguntar.
async function esperarEstudio(ruta, campo, marca, terminados, maxMs = 5 * 60 * 1000) {
  const hasta = Date.now() + maxMs;
  while (Date.now() < hasta) {
    await new Promise(r => setTimeout(r, 2500));
    if (!document.getElementById(marca)) return null;
    const d = await api(ruta);
    if (terminados.includes(d[campo]?.estado)) return d[campo];
  }
  return { estado: "error" };
}

// La clave de un pedido que no puede pasar dos veces (empezar una práctica o
// un simulacro, una pregunta al paciente virtual). Si se corta la conexión y
// se repite con la misma clave, el servidor devuelve lo que ya hizo en vez
// de gastar otra vez.
function claveDePedido() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

const nombreArea = (area) => t("estudio.area." + area);

// Para elegir una opción de una lista corta (área, dificultad, modo).
function chipsHtml(id, valores, elegido, clave) {
  return `<div class="est-chips" id="${id}">${valores.map(v => `
    <button type="button" class="est-chip${v === elegido ? " activo" : ""}" data-valor="${esc(String(v))}" aria-pressed="${v === elegido}">${t(clave(v))}</button>`).join("")}
  </div>`;
}

function engancharChips(id, alElegir) {
  const caja = document.getElementById(id);
  if (!caja) return;
  caja.querySelectorAll(".est-chip").forEach(b => {
    b.onclick = () => {
      caja.querySelectorAll(".est-chip").forEach(x => { x.classList.remove("activo"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("activo");
      b.setAttribute("aria-pressed", "true");
      alElegir(b.dataset.valor);
    };
  });
}

// ─── LA PORTADA ────────────────────────────────────────────────────────────

async function renderEstudiar() {
  detenerPolling();
  SENTADA = null;
  // Una marca propia para saber, cuando llegue la respuesta, si el
  // estudiante sigue acá o ya se fue a otra pantalla.
  app.innerHTML = `<div class="loading" id="estCargando"><div class="spinner"></div>${t("estudio.cargando")}</div>`;
  try {
    const data = await api("/medico/estudio/hoy");
    if (!document.getElementById("estCargando")) return;
    RESUMEN_ESTUDIO = data.resumen || null;
    pintarPortadaEstudio(data.resumen || {}, data.tarjetas || []);
  } catch (e) {
    if (e.status === 401) return logout();
    if (typeof reportarError === "function") reportarError(e, "renderEstudiar");
    if (!document.getElementById("estCargando")) return;
    app.innerHTML = `${volverEstudioHtml()}<div class="error">${esc(e.error || t("estudio.error"))}</div>`;
    engancharVolverEstudio();
  }
}

function volverEstudioHtml() {
  return `<button class="back" id="btnBack">${t("estudio.volver")}</button>`;
}

function engancharVolverEstudio() {
  const b = document.getElementById("btnBack");
  if (b) b.onclick = () => (typeof volverAlPanel === "function" ? volverAlPanel() : renderDashboard());
}

function rachaHtml(racha, grande = false) {
  const n = racha?.actual || 0;
  return `<div class="est-racha${n ? " viva" : ""}${grande ? " grande" : ""}">
    <span class="est-racha-icono" aria-hidden="true">${ICONOS_ESTUDIANTE.fuego}</span>
    <span class="est-racha-num">${n}</span>
    <span class="est-racha-txt">${t(n === 1 ? "estudio.racha.dia" : "estudio.racha.dias")}</span>
  </div>`;
}

function pintarPortadaEstudio(r, tarjetas) {
  const racha = r.racha || { actual: 0, mejor: 0, hoyHecho: false };
  const pie = racha.hoyHecho ? t("estudio.racha.hoyHecho") : racha.actual ? t("estudio.racha.seguila") : t("estudio.racha.empeza");
  const mejor = racha.mejor > racha.actual ? ` · ${t("estudio.racha.mejor", { n: racha.mejor })}` : "";
  const masDeUnaVez = (r.paraHoy || 0) > tarjetas.length;
  app.innerHTML = `
    ${volverEstudioHtml()}
    ${pestanasEstudioHtml("casos")}
    <div class="card est-portada">
      <div class="nota-titulo" style="margin-top:0">${t("estudio.titulo")}</div>
      <div class="est-cabeza">
        ${rachaHtml(racha)}
        <div class="est-cifras">
          <div><b>${r.paraHoy || 0}</b><span>${t("estudio.paraHoy")}</span></div>
          <div><b>${r.dominadas || 0}</b><span>${t("estudio.dominadas")}</span></div>
          <div><b>${r.aciertosPct == null ? "—" : r.aciertosPct + "%"}</b><span>${t("estudio.aciertos")}</span></div>
        </div>
      </div>
      <div class="hint est-racha-pie">${pie}${mejor}</div>
      ${tarjetas.length ? `
        <button class="primary" id="estEmpezar">${t(tarjetas.length === 1 ? "estudio.empezarUna" : "estudio.empezar", { n: tarjetas.length })}</button>
        ${masDeUnaVez ? `<div class="hint">${t("estudio.deAVeinte", { n: r.paraHoy })}</div>` : ""}`
      : r.total ? `
        <div class="est-listo">✓ ${t("estudio.nadaHoy")}</div>
        <button class="secondary" id="estRepasar">${t("estudio.repasarMas")}</button>`
      : `<div class="est-vacio">${t("estudio.sinTarjetas")}</div>`}
    </div>
    ${porRazonarHtml(r.porRazonar)}
    ${logrosHtml(r.logros)}
    <div class="hint est-aviso-ia">🎓 ${t("estudio.aviso")}</div>`;
  engancharVolverEstudio();
  engancharPestanasEstudio();
  const empezar = document.getElementById("estEmpezar");
  if (empezar) empezar.onclick = () => empezarSentada(tarjetas, "hoy");
  const repasar = document.getElementById("estRepasar");
  if (repasar) repasar.onclick = repasarMas;
  engancharCasosPorRazonar();
}

// Las consultas que todavía no razonó: cada una arma sus tarjetas.
function porRazonarHtml(pr, clase = "card") {
  if (!pr || !pr.total) return "";
  return `
    <div class="${clase}">
      <div class="seccion-titulo" style="margin-top:0">${t("estudio.porRazonar.titulo")}</div>
      <div class="hint" style="margin:0 0 8px">${t(pr.total === 1 ? "estudio.porRazonar.uno" : "estudio.porRazonar.varios", { n: pr.total })}</div>
      ${(pr.casos || []).map(c => `
        <button type="button" class="item est-caso" data-consulta="${esc(String(c._id))}">
          <span class="nombre">${esc(c.motivo || t("estudio.sinMotivo"))}</span>
          <span class="paciente-info">${esc(fechaEstudio(c.fecha))}</span>
        </button>`).join("")}
    </div>`;
}

function engancharCasosPorRazonar() {
  document.querySelectorAll(".est-caso[data-consulta]").forEach(b => {
    b.onclick = () => renderDetalle(b.dataset.consulta);
  });
}

// Los logrados y, de cada grupo (casos, aciertos, racha, dominadas), solo el
// próximo: diez medallas apagadas de entrada son una pared, no una meta.
function logrosHtml(logros) {
  if (!logros || !logros.length) return "";
  const proximoMostrado = new Set();
  const visibles = logros.filter(l => {
    if (l.hecho) return true;
    if (proximoMostrado.has(l.grupo)) return false;
    proximoMostrado.add(l.grupo);
    return true;
  });
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("estudio.logros")}</div>
      <div class="est-logros">
        ${visibles.map(l => `
          <div class="est-logro${l.hecho ? " hecho" : ""}" data-logro="${esc(l.id)}">
            <span class="est-logro-icono" aria-hidden="true">${ICONO_LOGRO[l.id] || "⭐"}</span>
            <span class="est-logro-nombre">${t("estudio.logro." + l.id)}</span>
            <span class="est-logro-prog">${l.hecho ? "✓" : `${l.actual}/${l.meta}`}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function fechaEstudio(f) {
  return typeof fechaLarga === "function" ? fechaLarga(f, { day: "numeric", month: "short", year: "numeric" }) : fechaCorta(f);
}

// ─── LA SENTADA ────────────────────────────────────────────────────────────

function empezarSentada(tarjetas, modo) {
  SENTADA = {
    tarjetas, modo, i: 0, bien: 0, respondidas: 0, subio: false,
    racha: RESUMEN_ESTUDIO?.racha || null,
    logrosAntes: new Set((RESUMEN_ESTUDIO?.logros || []).filter(l => l.hecho).map(l => l.id)),
  };
  pintarTarjeta();
}

async function repasarMas() {
  app.innerHTML = `<div class="loading" id="estCargando"><div class="spinner"></div>${t("estudio.cargando")}</div>`;
  try {
    const d = await api("/medico/estudio/repaso");
    if (!document.getElementById("estCargando")) return;
    if (!(d.tarjetas || []).length) {
      app.innerHTML = `${volverEstudioHtml()}<div class="card"><div class="est-listo">✓ ${t("estudio.nadaParaRepasar")}</div></div>`;
      engancharVolverEstudio();
      return;
    }
    empezarSentada(d.tarjetas, "repaso");
  } catch (e) {
    if (e.status === 401) return logout();
    if (!document.getElementById("estCargando")) return;
    app.innerHTML = `${volverEstudioHtml()}<div class="error">${esc(e.error || t("estudio.error"))}</div>`;
    engancharVolverEstudio();
  }
}

function sexoEstudio(sexo) {
  const clave = { Femenino: "sexo.femenino", Masculino: "sexo.masculino", Otro: "sexo.otro" }[sexo];
  return clave ? t(clave) : sexo;
}

// El caso, sin nombre: lo que se lee arriba de la pregunta.
function casoEstudioHtml(tj) {
  const c = tj.caso || {};
  const edad = c.edadMeses != null ? t("estudio.caso.meses", { n: c.edadMeses })
    : c.edad != null ? t("pacientes.anos", { n: c.edad }) : "";
  const quien = [c.sexo ? sexoEstudio(c.sexo) : "", edad].filter(Boolean).join(" · ");
  const lineas = [];
  if (c.motivo) lineas.push(`<div class="nota-campo"><b>${t("estudio.caso.motivo")}</b> ${esc(c.motivo)}</div>`);
  if ((c.sintomas || []).length) lineas.push(`<div class="nota-campo"><b>${t("estudio.caso.sintomas")}</b> ${esc(c.sintomas.join("; "))}</div>`);
  if (c.antecedentes) lineas.push(`<div class="nota-campo"><b>${t("estudio.caso.antecedentes")}</b> ${esc(c.antecedentes)}</div>`);
  if (!quien && !lineas.length) return "";
  return `
    <div class="est-caso-caja">
      <div class="est-caso-rotulo">${t("estudio.caso.titulo")}${quien ? ` · <span>${esc(quien)}</span>` : ""}</div>
      ${lineas.join("")}
    </div>`;
}

function preguntaEstudio(tj) {
  const dx = esc(tj.sobre || "");
  if (tj.tipo === "dx") return t("estudio.preg.dx");
  if (tj.tipo === "estudio") return t("estudio.preg.estudio", { dx });
  if (tj.tipo === "banderas") return dx ? t("estudio.preg.banderasDe", { dx }) : t("estudio.preg.banderas");
  return dx ? t("estudio.preg.faltoDe", { dx }) : t("estudio.preg.falto");
}

function pintarTarjeta() {
  const s = SENTADA;
  if (!s) return;
  if (s.i >= s.tarjetas.length) return terminarSentada();
  const tj = s.tarjetas[s.i];
  const avance = Math.round((s.i / s.tarjetas.length) * 100);
  app.innerHTML = `
    <div class="est-arriba">
      <button class="back" id="estSalir">${t("estudio.salir")}</button>
      <span class="hint est-cuenta">${t("estudio.deTantas", { i: s.i + 1, n: s.tarjetas.length })}</span>
    </div>
    <div class="est-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="${s.tarjetas.length}" aria-valuenow="${s.i}"><span style="width:${avance}%"></span></div>
    <div class="card est-tarjeta" id="estTarjeta" data-tipo="${esc(tj.tipo)}">
      ${s.modo === "repaso" ? `<div class="est-modo">${t("estudio.modoRepaso")}</div>` : ""}
      ${tj.tipo === "pregunta"
        ? `<div class="est-caso-caja"><div class="est-caso-rotulo">${t("estudio.deSimulacro", { area: esc(nombreArea(tj.area)) })}</div><div class="sim-enunciado">${esc(tj.enunciado)}</div></div>`
        : `${casoEstudioHtml(tj)}<div class="est-pregunta">${preguntaEstudio(tj)}</div>`}
      <div id="estZona">${TARJETAS_DE_OPCIONES.includes(tj.tipo) ? opcionesEstudioHtml(tj) : `<button class="secondary" id="estMostrar">${t("estudio.mostrar")}</button>`}</div>
      <div id="estExplica"></div>
      <div class="est-pie">
        <button type="button" class="link est-reportar" id="estReportar">⚑ ${t("estudio.reportar")}</button>
      </div>
      <div id="estReporte"></div>
    </div>`;
  irArribaEstudio();
  document.getElementById("estSalir").onclick = renderEstudiar;
  document.getElementById("estReportar").onclick = () => abrirReporte(tj);
  if (TARJETAS_DE_OPCIONES.includes(tj.tipo)) {
    document.querySelectorAll(".est-opcion").forEach(b => { b.onclick = () => responderOpcion(b, tj); });
  } else {
    document.getElementById("estMostrar").onclick = () => mostrarRespuesta(tj);
  }
}

// Cada tarjeta nueva arranca arriba: en el celular, la anterior pudo haber
// quedado scrolleada hasta la explicación.
function irArribaEstudio() {
  const caja = document.getElementById("escritorioContent");
  if (caja) caja.scrollTop = 0;
  try { window.scrollTo(0, 0); } catch { /* sin ventana que mover */ }
}

function opcionesEstudioHtml(tj) {
  return `<div class="est-opciones">${(tj.opciones || []).map((o, k) => `
    <button type="button" class="est-opcion" data-i="${Number(o.i)}">
      <span class="est-letra">${LETRAS_OPCION[k] || ""}</span><span class="est-opcion-txt">${esc(o.texto)}</span>
    </button>`).join("")}</div>`;
}

// De dónde salió: su consulta (se puede abrir) o un simulacro.
function fuenteEstudioHtml(tj) {
  if (tj.tipo === "pregunta") return `<span class="hint" style="margin:0">${t("estudio.deSimulacroFecha", { area: esc(nombreArea(tj.area)), fecha: esc(fechaEstudio(tj.fecha)) })}</span>`;
  return `<button type="button" class="link est-fuente" id="estFuente">${t("estudio.fuente", { fecha: esc(fechaEstudio(tj.caso?.fecha)) })}</button>`;
}

function engancharFuente(tj) {
  const b = document.getElementById("estFuente");
  if (b) b.onclick = () => renderDetalle(String(tj.consultaId));
}

function cuandoVuelve(proxima) {
  if (!proxima) return "";
  const dia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dias = Math.round((dia(proxima) - dia(new Date())) / 86400000);
  if (dias <= 0) return "";
  return dias === 1 ? t("estudio.vuelveManana") : t("estudio.vuelveEn", { n: dias });
}

function registrarResultado(r) {
  const s = SENTADA;
  if (!s) return;
  s.respondidas++;
  if (r.correcto) s.bien++;
  if (r.racha) {
    s.racha = r.racha;
    if (r.racha.subio) s.subio = true;
  }
}

async function responderOpcion(boton, tj) {
  const botones = [...document.querySelectorAll(".est-opcion")];
  botones.forEach(b => { b.disabled = true; });
  boton.classList.add("elegida");
  const explica = document.getElementById("estExplica");
  try {
    const r = await api(`/medico/estudio/tarjetas/${tj._id}/responder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opcion: Number(boton.dataset.i) }),
    });
    registrarResultado(r);
    const correcta = (tj.opciones || []).find(o => Number(o.i) === r.correcta);
    botones.forEach(b => {
      const i = Number(b.dataset.i);
      if (i === r.correcta) b.classList.add("bien");
      else if (b === boton) b.classList.add("mal");
      else b.classList.add("apagada");
    });
    const vuelve = cuandoVuelve(r.proxima);
    explica.innerHTML = `
      <div class="est-veredicto ${r.correcto ? "bien" : "mal"}">${tj.tipo === "pregunta"
        ? (r.correcto ? "✓ " + t("estudio.bienPregunta") : "✗ " + t("estudio.malPregunta", { opcion: esc(correcta?.texto || "") }))
        : (r.correcto ? "✓ " + t("estudio.bien") : "✗ " + t("estudio.mal", { dx: esc(correcta?.texto || "") }))}</div>
      ${!r.correcto && r.enContraElegida ? `<div class="nota-campo"><b>${t(tj.tipo === "pregunta" ? "estudio.porQueNoTuya" : "estudio.enContraTuya")}</b> ${esc(r.enContraElegida)}</div>` : ""}
      ${(r.aFavor || []).length ? `<div class="nota-campo"><b>${t("estudio.aFavorDe", { dx: esc(correcta?.texto || "") })}</b> ${esc(r.aFavor.join("; "))}</div>` : ""}
      ${r.perla ? `<div class="tutor-perla">💡 ${esc(r.perla)}</div>` : ""}
      <div class="est-sigue">
        ${vuelve ? `<span class="hint">${vuelve}</span>` : "<span></span>"}
        ${fuenteEstudioHtml(tj)}
      </div>
      <button class="primary" id="estSiguiente">${t("estudio.siguiente")}</button>`;
    engancharFuente(tj);
    document.getElementById("estSiguiente").onclick = avanzarEstudio;
  } catch (e) {
    if (e.status === 401) return logout();
    // Ya se había respondido (un toque desde otra pestaña): se sigue.
    if (e.status === 409) return avanzarEstudio();
    botones.forEach(b => { b.disabled = false; });
    boton.classList.remove("elegida");
    explica.innerHTML = `<div class="error">${esc(e.error || t("estudio.errResponder"))}</div>`;
  }
}

function mostrarRespuesta(tj) {
  const zona = document.getElementById("estZona");
  zona.innerHTML = `
    <div class="est-respuesta">
      <div class="est-respuesta-rotulo">${t("estudio.respuesta")}</div>
      <ul class="tutor-lista">${(tj.respuesta || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      ${tj.perla ? `<div class="tutor-perla">💡 ${esc(tj.perla)}</div>` : ""}
      <div class="est-sigue"><span class="hint">${t("estudio.honesto")}</span>${fuenteEstudioHtml(tj)}</div>
    </div>
    <div class="est-autoeval">
      <button class="secondary" id="estNoMeAcordaba">${t("estudio.noMeAcordaba")}</button>
      <button class="primary" id="estMeAcordaba">${t("estudio.meAcordaba")}</button>
    </div>`;
  engancharFuente(tj);
  document.getElementById("estNoMeAcordaba").onclick = () => responderRecuerdo(tj, false);
  document.getElementById("estMeAcordaba").onclick = () => responderRecuerdo(tj, true);
}

async function responderRecuerdo(tj, recordaba) {
  const botones = [...document.querySelectorAll(".est-autoeval button")];
  botones.forEach(b => { b.disabled = true; });
  try {
    const r = await api(`/medico/estudio/tarjetas/${tj._id}/responder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordaba }),
    });
    registrarResultado(r);
    avanzarEstudio();
  } catch (e) {
    if (e.status === 401) return logout();
    if (e.status === 409) return avanzarEstudio();
    botones.forEach(b => { b.disabled = false; });
    document.getElementById("estExplica").innerHTML = `<div class="error">${esc(e.error || t("estudio.errResponder"))}</div>`;
  }
}

function avanzarEstudio() {
  if (!SENTADA) return;
  SENTADA.i++;
  pintarTarjeta();
}

// ─── «ESTA PREGUNTA ESTÁ MAL» ──────────────────────────────────────────────
// Sin texto libre, a propósito: para avisar no hace falta escribir datos del
// caso, y así lo que se guarda no tiene nada de ningún paciente.
function abrirReporte(tj) {
  const caja = document.getElementById("estReporte");
  if (!caja) return;
  caja.innerHTML = `
    <div class="est-reporte">
      <div class="hint" style="margin:0 0 6px">${t("estudio.reporte.queEstaMal")}</div>
      ${MOTIVOS_REPORTE_ESTUDIO.map(m => `<button type="button" class="secondary est-motivo" data-motivo="${m}">${t("estudio.reporte." + m)}</button>`).join("")}
    </div>`;
  caja.querySelectorAll(".est-motivo").forEach(b => {
    b.onclick = async () => {
      caja.querySelectorAll(".est-motivo").forEach(x => { x.disabled = true; });
      try {
        await api(`/medico/estudio/tarjetas/${tj._id}/reportar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: b.dataset.motivo }),
        });
        caja.innerHTML = `
          <div class="est-reporte">
            <div class="hint" style="margin:0">${t("estudio.reporte.listo")}
              <button type="button" class="link" id="estDeshacer" style="width:auto;margin:0 0 0 6px">${t("estudio.reporte.deshacer")}</button></div>
            <button class="primary" id="estSaltar">${t("estudio.siguiente")}</button>
          </div>`;
        document.getElementById("estZona").innerHTML = "";
        document.getElementById("estExplica").innerHTML = "";
        document.getElementById("estReportar").style.display = "none";
        document.getElementById("estSaltar").onclick = avanzarEstudio;
        document.getElementById("estDeshacer").onclick = async () => {
          try { await api(`/medico/estudio/tarjetas/${tj._id}/reportar`, { method: "DELETE" }); } catch { /* queda marcada */ }
          pintarTarjeta();
        };
      } catch (e) {
        if (e.status === 401) return logout();
        caja.innerHTML = `<div class="error">${esc(e.error || t("estudio.errResponder"))}</div>`;
      }
    };
  });
}

// ─── AL TERMINAR ───────────────────────────────────────────────────────────

async function terminarSentada() {
  const s = SENTADA;
  app.innerHTML = `<div class="loading" id="estCargando"><div class="spinner"></div>${t("estudio.cargando")}</div>`;
  let resumen = null;
  try { resumen = (await api("/medico/estudio/resumen")).resumen; } catch { /* se muestra lo de la sentada */ }
  if (SENTADA !== s || !document.getElementById("estCargando")) return;
  const nuevos = resumen ? (resumen.logros || []).filter(l => l.hecho && !s.logrosAntes.has(l.id)) : [];
  if (resumen) RESUMEN_ESTUDIO = resumen;
  const racha = resumen?.racha || s.racha || { actual: 0 };
  app.innerHTML = `
    ${volverEstudioHtml()}
    <div class="card est-fin">
      <div class="est-fin-titulo">${t(s.modo === "repaso" ? "estudio.fin.repaso" : "estudio.fin.titulo")}</div>
      ${s.respondidas ? `<div class="est-fin-cifra">${t("estudio.fin.bien", { bien: s.bien, n: s.respondidas })}</div>` : ""}
      ${rachaHtml(racha, true)}
      ${s.subio ? `<div class="hint est-fin-sumaste">${t("estudio.fin.sumaste")}</div>` : ""}
      ${nuevos.length ? `<div class="est-nuevos">
        <div class="seccion-titulo">${t(nuevos.length === 1 ? "estudio.fin.logroNuevo" : "estudio.fin.logrosNuevos")}</div>
        ${nuevos.map(l => `<div class="est-logro hecho"><span class="est-logro-icono" aria-hidden="true">${ICONO_LOGRO[l.id] || "⭐"}</span><span class="est-logro-nombre">${t("estudio.logro." + l.id)}</span><span class="est-logro-prog">✓</span></div>`).join("")}
      </div>` : ""}
      ${resumen?.paraHoy ? `<button class="primary" id="estSeguir">${t("estudio.fin.seguir", { n: resumen.paraHoy })}</button>` : ""}
      <button class="secondary" id="estRepasar">${t("estudio.repasarMas")}</button>
      ${porRazonarHtml(resumen?.porRazonar, "est-fin-casos")}
    </div>`;
  SENTADA = null;
  engancharVolverEstudio();
  const seguir = document.getElementById("estSeguir");
  if (seguir) seguir.onclick = renderEstudiar;
  document.getElementById("estRepasar").onclick = repasarMas;
  engancharCasosPorRazonar();
}

// ─── EN EL INICIO ──────────────────────────────────────────────────────────
// La racha y cuántas hay para hoy, con un botón. Lo pinta
// pintarAvisoEstudiante (public/js/estudiantes.js) junto al aviso de su acceso.
async function resumenEstudio() {
  try { return (await api("/medico/estudio/resumen")).resumen; } catch { return null; }
}

function estudioInicioHtml(r) {
  if (!r) return "";
  const racha = r.racha || { actual: 0 };
  const texto = r.paraHoy ? t(r.paraHoy === 1 ? "estudio.inicio.una" : "estudio.inicio.varias", { n: r.paraHoy })
    : r.total ? t("estudio.inicio.alDia")
      : r.porRazonar?.total ? t("estudio.inicio.razona")
        : t("estudio.inicio.empeza");
  return `
    <div class="card card-secundaria est-inicio">
      <div class="est-inicio-fila">
        ${rachaHtml(racha)}
        <div class="est-inicio-txt">${texto}</div>
      </div>
      <button class="primary" id="estIrEstudiar">${t("estudio.inicio.boton")}</button>
    </div>`;
}
