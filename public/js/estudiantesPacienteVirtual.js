// Symphomed — El paciente virtual (cuentas de estudiante, etapa 4).
//
// Practicar la entrevista con un paciente simulado (modulos/estudiantes/pacienteVirtual.js):
// le pregunta como en una consulta, lo examina, pide estudios y al final da
// su diagnóstico. El guion no llega a la pantalla hasta que termina: lo único
// que se ve es lo que contestó el paciente.
//
// Se le puede escribir o dictar (el micrófono del teclado, o el botón si el
// navegador sabe pasar voz a texto), y el paciente puede contestar en voz
// alta: es una práctica de entrevista, no un chat.

// Las de medicina; las de cada carrera las manda el servidor (d.areas).
const PV_AREAS = ["cualquiera", "clinica", "pediatria", "gineco", "cirugia", "emergencias"];
const PV_DIFICULTADES = ["basico", "intermedio", "avanzado"];
const PV_EXAMENES = ["signos", "general", "cabeza", "torax", "corazon", "abdomen", "extremidades", "neuro", "piel", "gineco"];
const PV_ESTUDIOS = ["hemograma", "quimica", "orina", "pcr", "rxTorax", "ecoAbdomen", "ecg", "embarazo"];
// Enfermería practica la valoración: se valora (en vez de examinar) y se
// piden escalas, controles y datos (en vez de estudios). Las áreas de
// enfermería empiezan con «enf_» (modulos/estudiantes/carreras.js).
const PV_VALORACIONES = ["signos", "general", "piel", "respiratorio", "cardiovascular", "abdomen", "eliminacion", "neuro", "dolor", "movilidad"];
const PV_ESCALAS = ["eva", "glasgow", "braden", "caidas", "balance", "glucemia", "hemograma", "electrolitos"];
const pvEsEnfermeria = (area) => /^enf_/.test(area || "");
// La clave de enfermería si el área es de enfermería: «pv.examinar» → «pv.enf.examinar».
const pvT = (enf, clave, vars) => t(enf ? clave.replace(/^pv\./, "pv.enf.") : clave, vars);
const PV_MOTIVOS_REPORTE = ["incoherente", "paciente", "evaluacion"];

// La práctica abierta.
let PV = null;
let PV_DICTADO = null;
let PV_ELECCION = { area: "cualquiera", dificultad: "intermedio" };
// La clave de «empezar» (claveDePedido): la misma mientras no cambie lo que
// eligió, para que tocar otra vez después de un corte no gaste otro cupo.
let PV_CLAVE = null;

const pvVozActiva = () => { try { return localStorage.getItem("pv_voz") === "1"; } catch { return false; } };
function pvFijarVoz(si) { try { localStorage.setItem("pv_voz", si ? "1" : "0"); } catch { /* sin almacenamiento */ } }

// ─── EL INICIO ─────────────────────────────────────────────────────────────

async function renderPacienteVirtual() {
  detenerPolling();
  pvCallar();
  PV = null;
  app.innerHTML = `<div class="loading" id="pvCargando"><div class="spinner"></div>${t("pv.cargando")}</div>`;
  try {
    const d = await api("/medico/pacientes-virtuales");
    if (!document.getElementById("pvCargando")) return;
    pintarInicioPV(d);
  } catch (e) {
    if (e.status === 401) return logout();
    if (typeof reportarError === "function") reportarError(e, "renderPacienteVirtual");
    if (!document.getElementById("pvCargando")) return;
    app.innerHTML = `${volverEstudioHtml()}${pestanasEstudioHtml("paciente")}<div class="error">${esc(e.error || t("pv.error"))}</div>`;
    engancharVolverEstudio();
    engancharPestanasEstudio();
  }
}

function edadPV(p) {
  if (!p) return "";
  if (p.edadMeses != null) return t("estudio.caso.meses", { n: p.edadMeses });
  return p.edad != null ? t("pacientes.anos", { n: p.edad }) : "";
}

function pintarInicioPV(d) {
  const cupo = d.cupo || { quedan: 0, limite: 0 };
  const abierta = d.enCurso;
  const enf = (d.areas || []).some(pvEsEnfermeria);
  const dental = (d.areas || []).some(pvEsOdontologia);
  if (PV_ELECCION.area !== "cualquiera" && !(d.areas || PV_AREAS).includes(PV_ELECCION.area)) PV_ELECCION.area = "cualquiera";
  app.innerHTML = `
    ${volverEstudioHtml()}
    ${pestanasEstudioHtml("paciente")}
    <div class="card pv-portada">
      <div class="nota-titulo" style="margin-top:0">${t("pv.titulo")}</div>
      <div class="hint" style="margin:0 0 12px">${dental ? t("odoEst.bajada") : pvT(enf, "pv.bajada")}</div>
      ${abierta ? `<button class="secondary" id="pvSeguir" style="margin:0 0 12px">${abierta.paciente?.nombre
        ? t("pv.seguirCon", { nombre: esc(abierta.paciente.nombre) }) : t("pv.seguir")}</button>` : ""}
      <div class="est-rotulo">${t("pv.area")}</div>
      ${chipsHtml("pvAreas", ["cualquiera", ...(d.areas || PV_AREAS.slice(1))], PV_ELECCION.area, a => "estudio.area." + a)}
      <div class="est-rotulo">${t("pv.dificultad")}</div>
      ${chipsHtml("pvDificultades", PV_DIFICULTADES, PV_ELECCION.dificultad, x => "pv.dificultad." + x)}
      <div class="hint" id="pvDificultadAyuda" style="margin-top:6px">${pvT(enf, "pv.dificultadAyuda." + PV_ELECCION.dificultad)}</div>
      <button class="primary" id="pvEmpezar"${cupo.quedan ? "" : " disabled"}>${t("pv.empezar")}</button>
      <div class="hint">${cupo.quedan ? t("pv.cupo", { quedan: cupo.quedan, limite: cupo.limite }) : t("pv.sinCupo", { limite: cupo.limite })}</div>
      <div id="pvErr"></div>
    </div>
    ${historialPVHtml(d.historial)}
    <div class="hint est-aviso-ia">🎓 ${t("pv.aviso")}</div>`;
  engancharVolverEstudio();
  engancharPestanasEstudio();
  PV_CLAVE = claveDePedido();
  engancharChips("pvAreas", v => { PV_ELECCION.area = v; PV_CLAVE = claveDePedido(); });
  engancharChips("pvDificultades", v => {
    PV_ELECCION.dificultad = v;
    PV_CLAVE = claveDePedido();
    document.getElementById("pvDificultadAyuda").textContent = pvT(enf, "pv.dificultadAyuda." + v);
  });
  if (abierta) document.getElementById("pvSeguir").onclick = () => abrirPracticaPV(String(abierta._id));
  document.getElementById("pvEmpezar").onclick = empezarPV;
  document.querySelectorAll(".pv-hist[data-id]").forEach(b => { b.onclick = () => abrirPracticaPV(b.dataset.id); });
}

function historialPVHtml(historial) {
  if (!historial || !historial.length) return "";
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("pv.historial")}</div>
      ${historial.map(h => `
        <button type="button" class="item pv-hist" data-id="${esc(String(h._id))}">
          <span class="nombre">${h.acerto ? "✓" : "✗"} ${esc(h.diagnostico)}</span>
          <span class="paciente-info">${esc(nombreArea(h.area))} · ${esc(fechaEstudio(h.createdAt))} · ${t("pv.preguntasClaveDe", { hechas: h.preguntasHechas, total: h.preguntasTotal })}</span>
        </button>`).join("")}
    </div>`;
}

async function empezarPV() {
  const btn = document.getElementById("pvEmpezar");
  btn.disabled = true;
  try {
    const d = await api("/medico/pacientes-virtuales", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...PV_ELECCION, clave: PV_CLAVE }),
    });
    seguirPracticaPV(d.simulacion);
  } catch (e) {
    if (e.status === 401) return logout();
    btn.disabled = false;
    document.getElementById("pvErr").innerHTML = `<div class="error">${esc(e.error || t("pv.error"))}</div>`;
  }
}

async function abrirPracticaPV(id) {
  app.innerHTML = `<div class="loading" id="pvCargando"><div class="spinner"></div>${t("pv.cargando")}</div>`;
  try {
    const d = await api(`/medico/pacientes-virtuales/${id}`);
    if (!document.getElementById("pvCargando")) return;
    seguirPracticaPV(d.simulacion);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("pv.error"))}</div>`;
  }
}

// Según cómo esté: preparándose, en curso o terminada.
async function seguirPracticaPV(sim) {
  if (sim.estado === "preparando") {
    app.innerHTML = `
      <div class="card pv-preparando" id="pvPreparando">
        <div class="loading" style="padding:10px 0"><div class="spinner"></div>${t("pv.preparando")}</div>
        <div class="hint">${t("pv.preparandoAyuda")}</div>
        <button class="link" id="pvCancelar">${t("pv.volverAlInicio")}</button>
      </div>`;
    document.getElementById("pvCancelar").onclick = renderPacienteVirtual;
    let listo;
    try { listo = await esperarEstudio(`/medico/pacientes-virtuales/${sim._id}`, "simulacion", "pvPreparando", ["en_curso", "terminada", "error", "abandonada"]); }
    catch { listo = { estado: "error" }; }
    if (!listo) return;   // se fue a otra pantalla
    return seguirPracticaPV(listo);
  }
  if (sim.estado === "en_curso" || sim.estado === "evaluando") return pintarChatPV(sim);
  if (sim.estado === "terminada") return pintarEvaluacionPV(sim);
  app.innerHTML = `
    ${volverEstudioHtml()}
    <div class="card"><div class="error" style="margin-top:0">${t(sim.estado === "abandonada" ? "pv.abandonada" : "pv.noSalio")}</div>
      <button class="primary" id="pvReintentar">${t("pv.otroPaciente")}</button></div>`;
  engancharVolverEstudio();
  document.getElementById("pvReintentar").onclick = renderPacienteVirtual;
}

// ─── LA ENTREVISTA ─────────────────────────────────────────────────────────

function burbujaPV(m, enf = false) {
  if (m.rol === "estudiante") {
    const etiqueta = m.tipo === "examen" ? `<span class="pv-tipo">${pvT(enf, "pv.examina")}</span>` : m.tipo === "estudio" ? `<span class="pv-tipo">${t("pv.pide")}</span>` : "";
    return `<div class="pv-msj pv-est">${etiqueta}${esc(m.texto)}</div>`;
  }
  if (m.rol === "paciente") return `<div class="pv-msj pv-pac">${esc(m.texto)}</div>`;
  return `<div class="pv-msj pv-sis"><span class="pv-tipo">${m.tipo === "examen" ? pvT(enf, "pv.hallazgo") : t("pv.resultado")}</span>${esc(m.texto)}</div>`;
}

const pvDictadoDisponible = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

function pintarChatPV(sim) {
  // fallida: el último pedido que no llegó, para reintentarlo con su clave.
  PV = { sim, enviando: false, fallida: null };
  const enf = pvEsEnfermeria(sim.area);
  const p = sim.paciente || {};
  const quienHabla = /madre|padre|m[aã]e|pai/i.test(sim.quienHabla || "") ? sim.quienHabla : "";
  app.innerHTML = `
    <div class="est-arriba">
      <button class="back" id="pvSalir">${t("pv.salir")}</button>
      <button type="button" class="link pv-voz" id="pvVoz" aria-pressed="${pvVozActiva()}">${pvVozActiva() ? "🔊 " + t("pv.vozSi") : "🔈 " + t("pv.vozNo")}</button>
    </div>
    <div class="card pv-chat" id="pvChat">
      <div class="pv-cabecera">
        <span class="avatar avatar-sm" aria-hidden="true">${esc(iniciales(p.nombre || "?"))}</span>
        <div>
          <div><b>${esc(p.nombre || "")}</b>${edadPV(p) ? ` · ${esc(edadPV(p))}` : ""}${p.sexo ? ` · ${esc(sexoEstudio(p.sexo))}` : ""}</div>
          <div class="hint" style="margin:2px 0 0">${t("pv.lugar." + (sim.lugar || "consultorio"))}${quienHabla ? ` · ${t("pv.hablaCon", { quien: esc(quienHabla) })}` : ""}</div>
          ${sim.diagnosticoMedico ? `<div class="hint pv-dx-medico" style="margin:2px 0 0">${t("pv.enf.dxMedico", { dx: esc(sim.diagnosticoMedico) })}</div>` : ""}
        </div>
      </div>
      <div class="pv-mensajes" id="pvMensajes" aria-live="polite">${(sim.mensajes || []).map(m => burbujaPV(m, enf)).join("")}</div>
      <div id="pvPanel"></div>
      <div class="pv-acciones">
        <button type="button" class="secondary" id="pvExaminar">🩺 ${pvT(enf, "pv.examinar")}</button>
        <button type="button" class="secondary" id="pvPedir">${enf ? "📋" : "🧪"} ${pvT(enf, "pv.pedirEstudio")}</button>
        <button type="button" class="secondary" id="pvTerminar">🏁 ${t("pv.terminar")}</button>
      </div>
      <form class="pv-escribir" id="pvForm">
        <input id="pvTexto" type="text" maxlength="400" autocomplete="off" placeholder="${t("pv.escribi")}" aria-label="${t("pv.escribi")}">
        ${pvDictadoDisponible() ? `<button type="button" class="pv-mic" id="pvDictar" aria-label="${t("pv.dictar")}">🎤</button>` : ""}
        <button type="submit" class="pv-enviar" id="pvEnviar">${t("pv.enviar")}</button>
      </form>
      <div id="pvErr"></div>
      <div class="hint">${t("pv.consejo")} <span id="pvCuenta">${t("pv.cuenta", { n: sim.preguntasHechas || 0, max: sim.maxMensajes || 80 })}</span></div>
    </div>
    ${pvEsOdontologia(sim.area) ? odontogramaEstudianteHtml() : ""}`;
  if (pvEsOdontologia(sim.area)) montarOdontogramaEstudiante(sim);
  irArribaEstudio();
  pvAlFinal();
  document.getElementById("pvSalir").onclick = () => { if (!odontogramaPendientePV()) renderPacienteVirtual(); };
  document.getElementById("pvVoz").onclick = () => {
    pvFijarVoz(!pvVozActiva());
    pvCallar();
    const b = document.getElementById("pvVoz");
    b.textContent = pvVozActiva() ? "🔊 " + t("pv.vozSi") : "🔈 " + t("pv.vozNo");
    b.setAttribute("aria-pressed", String(pvVozActiva()));
  };
  document.getElementById("pvForm").onsubmit = (ev) => {
    ev.preventDefault();
    const input = document.getElementById("pvTexto");
    const texto = input.value.trim();
    if (texto) enviarPV("pregunta", texto, input);
  };
  const mic = document.getElementById("pvDictar");
  if (mic) mic.onclick = () => dictarPV(mic, document.getElementById("pvTexto"));
  document.getElementById("pvExaminar").onclick = () => panelPedidoPV("examen");
  document.getElementById("pvPedir").onclick = () => panelPedidoPV("estudio");
  document.getElementById("pvTerminar").onclick = panelTerminarPV;
}

function pvAlFinal() {
  const caja = document.getElementById("pvMensajes");
  if (caja) caja.scrollTop = caja.scrollHeight;
}

async function enviarPV(tipo, texto, input) {
  if (!PV || PV.enviando) return;
  PV.enviando = true;
  const caja = document.getElementById("pvMensajes");
  const err = document.getElementById("pvErr");
  err.innerHTML = "";
  const temporal = document.createElement("div");
  const enf = pvEsEnfermeria(PV.sim.area);
  temporal.innerHTML = burbujaPV({ rol: "estudiante", tipo, texto }, enf) + `<div class="pv-msj pv-pac pv-escribiendo">${t(tipo === "pregunta" ? "pv.escribiendo" : "pv.buscando")}</div>`;
  const nodos = [...temporal.children];
  nodos.forEach(n => caja.appendChild(n));
  if (input) input.value = "";
  pvAlFinal();
  const botones = document.querySelectorAll("#pvChat button, #pvTexto");
  botones.forEach(b => { b.disabled = true; });
  // Lo mismo que no llegó recién va con la misma clave: si el servidor ya lo
  // había contestado, devuelve esa respuesta y no se pregunta dos veces.
  const fallida = PV.fallida;
  const clave = fallida && fallida.tipo === tipo && fallida.texto === texto ? fallida.clave : claveDePedido();
  try {
    const r = await api(`/medico/pacientes-virtuales/${PV.sim._id}/mensajes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, texto, clave }),
    });
    if (PV) PV.fallida = null;
    if (!document.getElementById("pvMensajes")) return;
    nodos[1].outerHTML = burbujaPV(r.mensajes[1], enf);
    PV.sim.mensajes.push(...r.mensajes);
    PV.sim.preguntasHechas = (PV.sim.preguntasHechas || 0) + 1;
    const cuenta = document.getElementById("pvCuenta");
    if (cuenta) cuenta.textContent = t("pv.cuenta", { n: PV.sim.preguntasHechas, max: PV.sim.maxMensajes || 80 });
    if (r.mensajes[1].rol === "paciente") hablarPV(r.mensajes[1].texto);
    pvAlFinal();
  } catch (e) {
    if (e.status === 401) return logout();
    if (PV) PV.fallida = { tipo, texto, clave };
    nodos.forEach(n => n.remove());
    if (input && tipo === "pregunta") input.value = texto;   // para reintentar sin volver a escribir
    if (document.getElementById("pvErr")) document.getElementById("pvErr").innerHTML = `<div class="error">${esc(e.error || t("pv.error"))}</div>`;
  } finally {
    if (PV) PV.enviando = false;
    document.querySelectorAll("#pvChat button, #pvTexto").forEach(b => { b.disabled = false; });
    const panel = document.getElementById("pvPanel");
    // Cerrado del todo: si quedara «abierto», el próximo toque en el mismo
    // botón lo cerraría en vez de abrirlo, y parecería que no hace nada.
    if (panel && tipo !== "pregunta") { panel.innerHTML = ""; panel.dataset.abierto = ""; }
  }
}

// Examinar o pedir un estudio: lo más común a un toque, o escrito.
function panelPedidoPV(tipo) {
  const panel = document.getElementById("pvPanel");
  if (panel.dataset.abierto === tipo) { panel.innerHTML = ""; panel.dataset.abierto = ""; return; }
  panel.dataset.abierto = tipo;
  const enf = pvEsEnfermeria(PV.sim.area);
  const dental = pvEsOdontologia(PV.sim.area);
  const lista = dental ? (PV.sim.exploracionesDentales?.[tipo] || []) : enf ? (tipo === "examen" ? PV_VALORACIONES : PV_ESCALAS) : tipo === "examen"
    ? PV_EXAMENES.filter(x => x !== "gineco" || PV.sim.area === "gineco")
    : PV_ESTUDIOS;
  const prefijo = enf ? (tipo === "examen" ? "pv.enf.va." : "pv.enf.es.") : tipo === "examen" ? "pv.ex." : "pv.es.";
  panel.innerHTML = `
    <div class="pv-panel">
      <div class="est-rotulo" style="margin-top:0">${pvT(enf, tipo === "examen" ? "pv.queExaminas" : "pv.quePedis")}</div>
      <div class="est-chips">${lista.map(x => `<button type="button" class="est-chip pv-pedido" data-texto="${esc(dental ? x : t(prefijo + x))}">${esc(dental ? x : t(prefijo + x))}</button>`).join("")}</div>
      <div class="pv-otro">
        <input id="pvOtro" type="text" maxlength="200" placeholder="${pvT(enf, tipo === "examen" ? "pv.otroExamen" : "pv.otroEstudio")}">
        <button type="button" class="pv-enviar" id="pvOtroBtn">${t("pv.pedir")}</button>
      </div>
    </div>`;
  panel.querySelectorAll(".pv-pedido").forEach(b => { b.onclick = () => enviarPV(tipo, b.dataset.texto); });
  document.getElementById("pvOtroBtn").onclick = () => {
    const v = document.getElementById("pvOtro").value.trim();
    if (v) enviarPV(tipo, v);
  };
}

function panelTerminarPV() {
  if (odontogramaPendientePV()) return;
  const panel = document.getElementById("pvPanel");
  if (panel.dataset.abierto === "terminar") { panel.innerHTML = ""; panel.dataset.abierto = ""; return; }
  panel.dataset.abierto = "terminar";
  const enf = pvEsEnfermeria(PV.sim.area);
  const hechas = (PV.sim.mensajes || []).filter(m => m.rol === "estudiante" && m.tipo === "pregunta").length;
  panel.innerHTML = `
    <div class="pv-panel">
      <div class="est-rotulo" style="margin-top:0">${pvT(enf, "pv.tuDiagnostico")}</div>
      <label for="pvPrincipal">${t(enf ? "tutor.enf.principal" : "tutor.principal")}</label>
      <input id="pvPrincipal" type="text" maxlength="160">
      <label for="pvDiferenciales">${t(enf ? "tutor.enf.diferenciales" : "tutor.diferenciales")} <span class="hint">${t("nota.separadosComa")}</span></label>
      <input id="pvDiferenciales" type="text" maxlength="400">
      <label for="pvPlan">${pvEsOdontologia(PV.sim.area) ? t("odoEst.plan") : pvT(enf, "pv.conducta")} <span class="hint">${pvEsOdontologia(PV.sim.area) ? t("odoEst.planAyuda") : t("pv.opcional")}</span></label>
      <textarea id="pvPlan" rows="${enf ? 3 : 2}" maxlength="600"></textarea>
      <div id="pvTermErr"></div>
      <button class="primary" id="pvVerEval">${t("pv.verEvaluacion")}</button>
      <div class="hint">${hechas < (PV.sim.minPreguntas || 3) ? t("pv.faltanPreguntas", { n: PV.sim.minPreguntas || 3 }) : t("pv.despuesNoSePuede")}</div>
    </div>`;
  document.getElementById("pvPrincipal").focus();
  document.getElementById("pvVerEval").onclick = async () => {
    if (odontogramaPendientePV()) return;
    const principal = document.getElementById("pvPrincipal").value.trim();
    const errBox = document.getElementById("pvTermErr");
    errBox.innerHTML = "";
    if (principal.length < 3) { errBox.innerHTML = `<div class="error">${t(enf ? "tutor.enf.errPrincipal" : "tutor.errPrincipal")}</div>`; return; }
    const btn = document.getElementById("pvVerEval");
    btn.disabled = true;
    btn.textContent = t("pv.evaluando");
    try {
      const r = await api(`/medico/pacientes-virtuales/${PV.sim._id}/terminar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principal,
          diferenciales: document.getElementById("pvDiferenciales").value.split(",").map(x => x.trim()).filter(Boolean),
          plan: document.getElementById("pvPlan").value.trim(),
        }),
      });
      pvCallar();
      pintarEvaluacionPV(r.simulacion);
    } catch (e) {
      if (e.status === 401) return logout();
      if (!document.getElementById("pvVerEval")) return;
      btn.disabled = false;
      btn.textContent = t("pv.verEvaluacion");
      errBox.innerHTML = `<div class="error">${esc(e.error || t("pv.error"))}</div>`;
    }
  };
}

// ─── VOZ ───────────────────────────────────────────────────────────────────
// Del navegador, sin servidor: el paciente habla con la voz del sistema, y el
// dictado (donde existe) pasa la voz del estudiante a texto.
function hablarPV(texto) {
  if (!pvVozActiva() || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = localeActual();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* sin voz: queda el texto */ }
}

function pvCallar() {
  try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* nada que callar */ }
  if (PV_DICTADO) { try { PV_DICTADO.stop(); } catch { /* ya terminó */ } PV_DICTADO = null; }
}

function dictarPV(boton, input) {
  const Reconocer = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconocer || !input) return;
  if (PV_DICTADO) { try { PV_DICTADO.stop(); } catch { /* ya terminó */ } return; }
  const base = input.value ? input.value + " " : "";
  const rec = new Reconocer();
  rec.lang = localeActual();
  rec.interimResults = true;
  rec.onresult = (ev) => {
    let dicho = "";
    for (const r of ev.results) dicho += r[0].transcript;
    input.value = (base + dicho).slice(0, 400);
  };
  rec.onend = () => { PV_DICTADO = null; boton.classList.remove("activo"); };
  rec.onerror = () => { PV_DICTADO = null; boton.classList.remove("activo"); };
  PV_DICTADO = rec;
  boton.classList.add("activo");
  try { rec.start(); } catch { PV_DICTADO = null; boton.classList.remove("activo"); }
}

// ─── LA EVALUACIÓN ─────────────────────────────────────────────────────────

function chequeosPV(items, campo, texto) {
  return `<ul class="pv-check">${(items || []).map(x => `<li class="${x[campo] ? "si" : "no"}"><span aria-hidden="true">${x[campo] ? "✓" : "✗"}</span> ${esc(x[texto])}</li>`).join("")}</ul>`;
}

function listaPV(items, clase, signo) {
  return (items || []).length ? `<ul class="pv-check">${items.map(x => `<li class="${clase}"><span aria-hidden="true">${signo}</span> ${esc(x)}</li>`).join("")}</ul>` : "";
}

function casoCompletoPVHtml(g, enf = false) {
  if (!g) return "";
  const ant = g.antecedentes || {};
  const antecedentes = [...(ant.personales || []), ...(ant.familiares || []), ...(ant.medicamentos || []), ...(ant.alergias || []), ...(ant.habitos || []), ...(ant.ginecoObstetricos || [])];
  return `
    <details class="pv-detalle">
      <summary>${t("pv.casoCompleto")}</summary>
      ${g.diagnosticoMedico ? `<div class="nota-campo">${t("pv.enf.dxMedico", { dx: esc(g.diagnosticoMedico) })}</div>` : ""}
      <div class="nota-campo"><b>${t("estudio.caso.motivo")}</b> ${esc(g.motivo)}</div>
      <div class="nota-campo"><b>${t("pv.historia")}</b></div><ul class="tutor-lista">${(g.historia || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      ${antecedentes.length ? `<div class="nota-campo"><b>${t("estudio.caso.antecedentes")}</b> ${esc(antecedentes.join("; "))}</div>` : ""}
      ${(g.negativos || []).length ? `<div class="nota-campo"><b>${t("pv.niega")}</b> ${esc(g.negativos.join("; "))}</div>` : ""}
      <div class="nota-campo"><b>${t("pv.ex.signos")}:</b> ${esc(Object.entries(g.signosVitales || {}).map(([k, v]) => `${k} ${v}`).join(" · "))}</div>
      <div class="nota-campo"><b>${pvT(enf, "pv.examenFisico")}</b></div><ul class="tutor-lista">${(g.examenFisico || []).map(x => `<li><b>${esc(x.region)}:</b> ${esc(x.hallazgo)}</li>`).join("")}</ul>
      ${(g.estudios || []).length ? `<div class="nota-campo"><b>${pvT(enf, "pv.estudios")}</b></div><ul class="tutor-lista">${g.estudios.map(x => `<li><b>${esc(x.nombre)}:</b> ${esc(x.resultado)}</li>`).join("")}</ul>` : ""}
      <div class="nota-campo"><b>${pvT(enf, "pv.diagnostico")}</b> ${esc(g.diagnostico)}</div>
      <div class="nota-campo"><b>${pvT(enf, "pv.diferencialesCaso")}</b></div>
      <ul class="tutor-lista">${(g.diferenciales || []).map(x => `<li><b>${esc(x.diagnostico)}</b> — ${esc(x.porQueNo)}</li>`).join("")}</ul>
      ${(g.intervencionesClave || []).length ? `<div class="nota-campo"><b>${t("pv.enf.intervencionesClave")}</b></div>
        <ul class="tutor-lista">${g.intervencionesClave.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </details>`;
}

function pintarEvaluacionPV(sim) {
  PV = null;
  const enf = pvEsEnfermeria(sim.area);
  const ev = sim.evaluacion || {};
  const g = sim.guion || {};
  const r = sim.respuesta || {};
  const hechas = (ev.preguntasClave || []).filter(x => x.hecha).length;
  const exploradas = (ev.banderasRojas || []).filter(x => x.explorada).length;
  app.innerHTML = `
    <button class="back" id="pvVolver">${t("pv.volverAlInicio")}</button>
    <div class="card pv-eval">
      <div class="nota-titulo" style="margin-top:0">${t("pv.tuEvaluacion")} · ${esc(g.paciente?.nombre || "")}</div>
      <div class="tutor-aviso">🎓 ${t("pv.avisoEvaluacion")}</div>
      <div class="${ev.diagnostico?.acerto ? "tutor-bien" : "tutor-mal"}">${ev.diagnostico?.acerto
        ? "✓ " + pvT(enf, "pv.acertaste", { dx: esc(g.diagnostico || "") }) : "✗ " + pvT(enf, "pv.eraOtro", { dx: esc(g.diagnostico || "") })}</div>
      <div class="nota-campo"><b>${t("tutor.tuRespuesta")}</b> ${esc(r.principal || "")}${(r.diferenciales || []).length ? ` · <span class="hint">${esc(r.diferenciales.join(", "))}</span>` : ""}</div>
      ${enf && r.plan ? `<div class="nota-campo"><b>${t("pv.enf.tusIntervenciones")}</b> ${esc(r.plan)}</div>` : ""}
      ${ev.comentario ? `<div class="nota-campo">${esc(ev.comentario)}</div>` : ""}
      <div class="pv-puntos">
        <div><b>${hechas}/${(ev.preguntasClave || []).length}</b><span>${pvT(enf, "pv.preguntasClave")}</span></div>
        <div><b>${exploradas}/${(ev.banderasRojas || []).length}</b><span>${pvT(enf, "pv.banderas")}</span></div>
        <div><b>${(ev.estudios?.pertinentes || []).length}</b><span>${pvT(enf, "pv.estudiosBien")}</span></div>
      </div>
      <div class="nota-titulo">${pvT(enf, "pv.preguntasClave")}</div>
      ${chequeosPV(ev.preguntasClave, "hecha", "pregunta")}
      ${(ev.banderasRojas || []).length ? `<div class="nota-titulo">${pvT(enf, "pv.banderas")}</div>${chequeosPV(ev.banderasRojas, "explorada", "bandera")}` : ""}
      <div class="nota-titulo">${pvT(enf, "pv.estudios")}</div>
      ${listaPV(ev.estudios?.pertinentes, "si", "✓")}${listaPV(ev.estudios?.faltaron, "no", "✗")}${listaPV(ev.estudios?.innecesarios, "ojo", "–")}
      ${!(ev.estudios?.pertinentes || []).length && !(ev.estudios?.faltaron || []).length ? `<div class="hint">${pvT(enf, "pv.sinEstudios")}</div>` : ""}
      <div class="nota-titulo">${pvT(enf, "pv.diferencialesCaso")}</div>
      ${listaPV(ev.diferenciales?.considero, "si", "✓")}${listaPV(ev.diferenciales?.faltaron, "no", "✗")}
      ${ev.intervenciones ? `<div class="nota-titulo">${t("pv.enf.intervenciones")}</div>
        ${listaPV(ev.intervenciones.adecuadas, "si", "✓")}${listaPV(ev.intervenciones.faltaron, "no", "✗")}${listaPV(ev.intervenciones.inadecuadas, "ojo", "⚠")}
        ${![...(ev.intervenciones.adecuadas || []), ...(ev.intervenciones.faltaron || []), ...(ev.intervenciones.inadecuadas || [])].length ? `<div class="hint">${t("pv.enf.sinIntervenciones")}</div>` : ""}` : ""}
      ${pvEsOdontologia(sim.area) ? evaluacionDentalHtml(sim) : ""}
      <div class="nota-titulo">${t("pv.comunicacion")}</div>
      ${listaPV(ev.comunicacion?.bien, "si", "✓")}${listaPV(ev.comunicacion?.mejorar, "ojo", "→")}
      ${g.perla ? `<div class="tutor-perla">💡 ${esc(g.perla)}</div>` : ""}
      ${casoCompletoPVHtml(g, enf)}
      <details class="pv-detalle">
        <summary>${t("pv.laConversacion")}</summary>
        <div class="pv-mensajes pv-mensajes-libres">${(sim.mensajes || []).map(m => burbujaPV(m, enf)).join("")}</div>
      </details>
      <button class="primary" id="pvOtro">${t("pv.otroPaciente")}</button>
      <div class="est-pie"><button type="button" class="link est-reportar" id="pvReportar">⚑ ${t("pv.casoMal")}</button></div>
      <div id="pvReporte"></div>
    </div>`;
  irArribaEstudio();
  document.getElementById("pvVolver").onclick = renderPacienteVirtual;
  document.getElementById("pvOtro").onclick = renderPacienteVirtual;
  const repasarDental = document.getElementById("odoEstRepasar");
  if (repasarDental) repasarDental.onclick = async () => {
    repasarDental.disabled = true;
    try {
      await api(`/medico/pacientes-virtuales/${sim._id}/repaso`, { method: "POST" });
      renderEstudiar();
    } catch (e) { repasarDental.textContent = e.error || t("pv.error"); repasarDental.disabled = false; }
  };
  document.getElementById("pvReportar").onclick = () => {
    const caja = document.getElementById("pvReporte");
    caja.innerHTML = `<div class="est-reporte">
      <div class="hint" style="margin:0 0 6px">${t("estudio.reporte.queEstaMal")}</div>
      ${PV_MOTIVOS_REPORTE.map(m => `<button type="button" class="secondary pv-motivo" data-motivo="${m}">${t("pv.reporte." + m)}</button>`).join("")}
    </div>`;
    caja.querySelectorAll(".pv-motivo").forEach(b => {
      b.onclick = async () => {
        caja.querySelectorAll(".pv-motivo").forEach(x => { x.disabled = true; });
        try {
          await api(`/medico/pacientes-virtuales/${sim._id}/reportar`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: b.dataset.motivo }),
          });
          caja.innerHTML = `<div class="hint">${t("pv.reporteListo")}</div>`;
        } catch (e) {
          caja.innerHTML = `<div class="error">${esc(e.error || t("pv.error"))}</div>`;
        }
      };
    });
  };
}
