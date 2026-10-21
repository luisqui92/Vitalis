// Symphomed — Simulacros por especialidad (cuentas de estudiante, etapa 4).
//
// Preguntas tipo examen de residencia (modulos/estudiantes/simulacros.js). En práctica,
// la respuesta y la explicación aparecen al contestar cada una; en examen,
// con reloj y recién al final. Las que erra pasan a sus tarjetas de repaso.

// Las de medicina; las de cada carrera las manda el servidor (d.areas).
const SIM_AREAS = ["mixto", "clinica", "pediatria", "gineco", "cirugia", "salud_publica"];
const SIM_CANTIDADES = [10, 20, 40];
const SIM_MODOS = ["practica", "examen"];

// El simulacro abierto: la vista que mandó el servidor y por qué pregunta va.
let SIM = null;
let SIM_ELECCION = { area: "mixto", cantidad: 20, modo: "practica" };
let SIM_CLAVE = null;   // como PV_CLAVE (estudiantesPacienteVirtual.js)

// ─── EL INICIO ─────────────────────────────────────────────────────────────

async function renderSimulacros() {
  detenerPolling();
  simPararReloj();
  SIM = null;
  app.innerHTML = `<div class="loading" id="simCargando"><div class="spinner"></div>${t("sim.cargando")}</div>`;
  try {
    const d = await api("/medico/simulacros");
    if (!document.getElementById("simCargando")) return;
    pintarInicioSim(d);
  } catch (e) {
    if (e.status === 401) return logout();
    if (typeof reportarError === "function") reportarError(e, "renderSimulacros");
    if (!document.getElementById("simCargando")) return;
    app.innerHTML = `${volverEstudioHtml()}${pestanasEstudioHtml("simulacros")}<div class="error">${esc(e.error || t("sim.error"))}</div>`;
    engancharVolverEstudio();
    engancharPestanasEstudio();
  }
}

function pintarInicioSim(d) {
  const cupo = d.cupo || { quedan: 0, limite: 0 };
  const abierto = d.enCurso;
  app.innerHTML = `
    ${volverEstudioHtml()}
    ${pestanasEstudioHtml("simulacros")}
    <div class="card sim-portada">
      <div class="nota-titulo" style="margin-top:0">${t("sim.titulo")}</div>
      <div class="hint" style="margin:0 0 12px">${t((d.areas || []).some(a => /^enf_/.test(a)) ? "sim.enf.bajada" : (d.areas || []).some(a => /^odo_/.test(a)) ? "odoEst.simBajada" : "sim.bajada")}</div>
      ${abierto ? `<button class="secondary" id="simSeguir" style="margin:0 0 12px">${t("sim.seguir", { area: esc(nombreArea(abierto.area)), n: abierto.respondidas, total: abierto.cantidad })}</button>` : ""}
      <div class="est-rotulo">${t("sim.area")}</div>
      ${chipsHtml("simAreas", ["mixto", ...(d.areas || SIM_AREAS.slice(1))], SIM_ELECCION.area, a => "estudio.area." + a)}
      <div class="est-rotulo">${t("sim.cuantas")}</div>
      ${chipsHtml("simCantidades", SIM_CANTIDADES, SIM_ELECCION.cantidad, n => "sim.cantidad." + n)}
      <div class="est-rotulo">${t("sim.modo")}</div>
      ${chipsHtml("simModos", SIM_MODOS, SIM_ELECCION.modo, m => "sim.modo." + m)}
      <div class="hint" id="simModoAyuda" style="margin-top:6px">${t("sim.modoAyuda." + SIM_ELECCION.modo)}</div>
      <button class="primary" id="simEmpezar"${cupo.quedan ? "" : " disabled"}>${t("sim.empezar")}</button>
      <div class="hint">${cupo.quedan ? t("sim.cupo", { quedan: cupo.quedan, limite: cupo.limite }) : t("sim.sinCupo", { limite: cupo.limite })}</div>
      <div id="simErr"></div>
    </div>
    ${progresoSimHtml(d.progreso)}
    ${historialSimHtml(d.historial)}
    <div class="hint est-aviso-ia">📝 ${t("sim.aviso")}</div>`;
  engancharVolverEstudio();
  engancharPestanasEstudio();
  SIM_CLAVE = claveDePedido();
  engancharChips("simAreas", v => { SIM_ELECCION.area = v; SIM_CLAVE = claveDePedido(); });
  engancharChips("simCantidades", v => { SIM_ELECCION.cantidad = Number(v); SIM_CLAVE = claveDePedido(); });
  engancharChips("simModos", v => {
    SIM_ELECCION.modo = v;
    SIM_CLAVE = claveDePedido();
    document.getElementById("simModoAyuda").textContent = t("sim.modoAyuda." + v);
  });
  if (abierto) document.getElementById("simSeguir").onclick = () => abrirSimulacro(String(abierto._id));
  document.getElementById("simEmpezar").onclick = empezarSim;
  document.querySelectorAll(".sim-hist[data-id]").forEach(b => { b.onclick = () => abrirSimulacro(b.dataset.id); });
}

// Cómo le va en cada área: una barra por área, con el % de aciertos.
function progresoSimHtml(progreso) {
  if (!progreso || !progreso.length) return "";
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("sim.progreso")}</div>
      ${progreso.map(p => `
        <div class="sim-barra-fila">
          <div class="sim-barra-nombre">${esc(nombreArea(p.area))}</div>
          <div class="sim-barra" role="img" aria-label="${p.pct}%"><span style="width:${Math.max(2, p.pct)}%"></span></div>
          <div class="sim-barra-dato"><b>${p.pct}%</b> · ${t("sim.preguntasN", { n: p.preguntas })}</div>
        </div>`).join("")}
    </div>`;
}

function historialSimHtml(historial) {
  if (!historial || !historial.length) return "";
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("sim.historial")}</div>
      ${historial.map(h => `
        <button type="button" class="item sim-hist" data-id="${esc(String(h._id))}">
          <span class="nombre">${h.aciertos}/${h.cantidad} · ${esc(nombreArea(h.area))}</span>
          <span class="paciente-info">${t("sim.modo." + h.modo)} · ${esc(fechaEstudio(h.terminadoEn))}</span>
        </button>`).join("")}
    </div>`;
}

async function empezarSim() {
  const btn = document.getElementById("simEmpezar");
  btn.disabled = true;
  try {
    const d = await api("/medico/simulacros", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...SIM_ELECCION, clave: SIM_CLAVE }),
    });
    seguirSimulacro(d.simulacro);
  } catch (e) {
    if (e.status === 401) return logout();
    btn.disabled = false;
    document.getElementById("simErr").innerHTML = `<div class="error">${esc(e.error || t("sim.error"))}</div>`;
  }
}

async function abrirSimulacro(id) {
  app.innerHTML = `<div class="loading" id="simCargando"><div class="spinner"></div>${t("sim.cargando")}</div>`;
  try {
    const d = await api(`/medico/simulacros/${id}`);
    if (!document.getElementById("simCargando")) return;
    seguirSimulacro(d.simulacro);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("sim.error"))}</div>`;
  }
}

async function seguirSimulacro(s) {
  if (s.estado === "preparando") {
    app.innerHTML = `
      <div class="card" id="simPreparando">
        <div class="loading" style="padding:10px 0"><div class="spinner"></div>${t("sim.preparando")}</div>
        <div class="hint">${t("sim.preparandoAyuda")}</div>
        <button class="link" id="simCancelar">${t("sim.volverAlInicio")}</button>
      </div>`;
    document.getElementById("simCancelar").onclick = renderSimulacros;
    let listo;
    try { listo = await esperarEstudio(`/medico/simulacros/${s._id}`, "simulacro", "simPreparando", ["listo", "terminado", "error"]); }
    catch { listo = { estado: "error" }; }
    if (!listo) return;
    return seguirSimulacro(listo);
  }
  if (s.estado === "terminado") return pintarResultadoSim(s);
  if (s.estado === "listo") {
    const primeraSinContestar = s.preguntas.findIndex(p => p.elegida == null);
    SIM = { s, i: primeraSinContestar === -1 ? 0 : primeraSinContestar, cargadoEn: Date.now(), reloj: null };
    return pintarPreguntaSim();
  }
  app.innerHTML = `
    ${volverEstudioHtml()}
    <div class="card"><div class="error" style="margin-top:0">${t("sim.noSalio")}</div>
      <button class="primary" id="simReintentar">${t("sim.otro")}</button></div>`;
  engancharVolverEstudio();
  document.getElementById("simReintentar").onclick = renderSimulacros;
}

// ─── UNA PREGUNTA ──────────────────────────────────────────────────────────

const simRestantes = () => (SIM?.s.segundosRestantes == null ? null
  : Math.max(0, SIM.s.segundosRestantes - Math.floor((Date.now() - SIM.cargadoEn) / 1000)));
const simReloj = (seg) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;

function simPararReloj() {
  if (SIM?.reloj) { clearInterval(SIM.reloj); SIM.reloj = null; }
}

function explicacionSimHtml(p) {
  const elegida = p.elegida;
  const porOpcion = p.porOpcion || [];
  return `
    <div class="est-veredicto ${p.acerto ? "bien" : "mal"}">${p.acerto ? "✓ " + t("estudio.bienPregunta") : "✗ " + t("estudio.malPregunta", { opcion: esc(p.opciones[p.correcta] || "") })}</div>
    ${!p.acerto && elegida != null && porOpcion[elegida] ? `<div class="nota-campo"><b>${t("estudio.porQueNoTuya")}</b> ${esc(porOpcion[elegida])}</div>` : ""}
    ${p.explicacion ? `<div class="tutor-perla">💡 ${esc(p.explicacion)}</div>` : ""}`;
}

function pintarPreguntaSim() {
  const s = SIM.s;
  const p = s.preguntas[SIM.i];
  const revelada = "correcta" in p;
  const ultima = SIM.i === s.preguntas.length - 1;
  const examen = s.modo === "examen";
  const avance = Math.round((s.preguntas.filter(x => x.elegida != null).length / s.preguntas.length) * 100);
  app.innerHTML = `
    <div class="est-arriba">
      <button class="back" id="simSalir">${t("sim.salir")}</button>
      <span class="hint est-cuenta">${t("estudio.deTantas", { i: SIM.i + 1, n: s.preguntas.length })}${examen ? ` · <span class="sim-reloj" id="simReloj">${simReloj(simRestantes() || 0)}</span>` : ""}</span>
    </div>
    <div class="est-progreso"><span style="width:${avance}%"></span></div>
    <div class="card est-tarjeta sim-pregunta" id="simPregunta">
      <div class="est-caso-rotulo">${esc(nombreArea(p.area || s.area))}${p.tema ? ` · <span>${esc(p.tema)}</span>` : ""}</div>
      <div class="sim-enunciado">${esc(p.enunciado)}</div>
      <div class="est-opciones">${p.opciones.map((o, k) => {
        const clases = ["est-opcion"];
        if (p.elegida === k) clases.push("elegida");
        if (revelada) clases.push(k === p.correcta ? "bien" : k === p.elegida ? "mal" : "apagada");
        return `<button type="button" class="${clases.join(" ")}" data-k="${k}"${revelada ? " disabled" : ""}>
          <span class="est-letra">${LETRAS_OPCION[k]}</span><span class="est-opcion-txt">${esc(o)}</span></button>`;
      }).join("")}</div>
      <div id="simExplica">${revelada && !examen ? explicacionSimHtml(p) : ""}</div>
      <div id="simErr"></div>
      <div class="sim-nav">
        ${examen && SIM.i > 0 ? `<button type="button" class="secondary" id="simAnterior">${t("sim.anterior")}</button>` : "<span></span>"}
        ${ultima
          ? `<button type="button" class="primary" id="simTerminar"${!examen && !revelada ? " disabled" : ""}>${t(examen ? "sim.entregar" : "sim.verResultado")}</button>`
          : `<button type="button" class="primary" id="simSiguiente"${!examen && !revelada ? " disabled" : ""}>${t("estudio.siguiente")}</button>`}
      </div>
      ${examen && !ultima ? `<button type="button" class="link" id="simEntregarYa">${t("sim.entregarYa")}</button>` : ""}
      <div class="est-pie"><button type="button" class="link est-reportar" id="simReportar">⚑ ${t("estudio.reportar")}</button></div>
      <div id="simReporte"></div>
    </div>`;
  irArribaEstudio();
  document.getElementById("simSalir").onclick = () => { simPararReloj(); renderSimulacros(); };
  document.querySelectorAll("#simPregunta .est-opcion").forEach(b => { b.onclick = () => responderSim(Number(b.dataset.k)); });
  const sig = document.getElementById("simSiguiente");
  if (sig) sig.onclick = () => { SIM.i++; pintarPreguntaSim(); };
  const ant = document.getElementById("simAnterior");
  if (ant) ant.onclick = () => { SIM.i--; pintarPreguntaSim(); };
  const fin = document.getElementById("simTerminar");
  if (fin) fin.onclick = terminarSim;
  const ya = document.getElementById("simEntregarYa");
  if (ya) ya.onclick = () => { if (confirm(t("sim.confirmarEntregar"))) terminarSim(); };
  document.getElementById("simReportar").onclick = () => abrirReporteSim(p);
  if (examen && !SIM.reloj) {
    SIM.reloj = setInterval(() => {
      const quedan = simRestantes();
      const reloj = document.getElementById("simReloj");
      if (!reloj) return simPararReloj();   // se fue a otra pantalla
      reloj.textContent = simReloj(quedan);
      reloj.classList.toggle("poco", quedan <= 60);
      if (quedan <= 0) { simPararReloj(); terminarSim(); }
    }, 1000);
  }
}

async function responderSim(k) {
  const s = SIM.s;
  const p = s.preguntas[SIM.i];
  if ("correcta" in p) return;
  const botones = [...document.querySelectorAll("#simPregunta .est-opcion")];
  botones.forEach(b => { b.disabled = true; });
  try {
    const r = await api(`/medico/simulacros/${s._id}/responder`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indice: SIM.i, opcion: k }),
    });
    p.elegida = k;
    if (s.modo === "practica") Object.assign(p, { acerto: r.acerto, correcta: r.correcta, explicacion: r.explicacion, porOpcion: r.porOpcion });
    pintarPreguntaSim();
  } catch (e) {
    if (e.status === 401) return logout();
    // Se terminó el tiempo, o el simulacro se cerró mientras viajaba la
    // respuesta: se va al resultado, que dice lo que quedó guardado.
    if (e.status === 409 && /tiempo|terminó/i.test(e.error || "")) return terminarSim();
    botones.forEach(b => { b.disabled = false; });
    const err = document.getElementById("simErr");
    if (err) err.innerHTML = `<div class="error">${esc(e.error || t("sim.error"))}</div>`;
  }
}

async function terminarSim() {
  if (!SIM) return;
  const id = SIM.s._id;
  simPararReloj();
  app.innerHTML = `<div class="loading" id="simCargando"><div class="spinner"></div>${t("sim.corrigiendo")}</div>`;
  try {
    const d = await api(`/medico/simulacros/${id}/terminar`, { method: "POST" });
    SIM = null;
    pintarResultadoSim(d.simulacro);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("sim.error"))}</div>`;
  }
}

function abrirReporteSim(p) {
  const caja = document.getElementById("simReporte");
  if (!caja) return;
  caja.innerHTML = `<div class="est-reporte">
    <div class="hint" style="margin:0 0 6px">${t("estudio.reporte.queEstaMal")}</div>
    ${MOTIVOS_REPORTE_ESTUDIO.map(m => `<button type="button" class="secondary sim-motivo" data-motivo="${m}">${t("estudio.reporte." + m)}</button>`).join("")}
  </div>`;
  caja.querySelectorAll(".sim-motivo").forEach(b => {
    b.onclick = async () => {
      caja.querySelectorAll(".sim-motivo").forEach(x => { x.disabled = true; });
      try {
        await api(`/medico/simulacros/preguntas/${p.preguntaId}/reportar`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: b.dataset.motivo }),
        });
        caja.innerHTML = `<div class="hint">${t("sim.reporteListo")}</div>`;
      } catch (e) {
        caja.innerHTML = `<div class="error">${esc(e.error || t("sim.error"))}</div>`;
      }
    };
  });
}

// ─── EL RESULTADO ──────────────────────────────────────────────────────────

function pintarResultadoSim(s) {
  const total = s.preguntas.length || s.cantidad || 0;
  const pct = total ? Math.round((s.aciertos * 100) / total) : 0;
  const erradas = s.preguntas.filter(p => !p.acerto);
  app.innerHTML = `
    <button class="back" id="simVolver">${t("sim.volverAlInicio")}</button>
    <div class="card est-fin sim-fin">
      <div class="est-fin-titulo">${t("sim.resultado", { bien: s.aciertos, total })}</div>
      <div class="sim-pct${pct >= 80 ? " alto" : ""}">${pct}%</div>
      <div class="est-fin-cifra">${esc(nombreArea(s.area))} · ${t("sim.modo." + s.modo)}</div>
      <div class="hint">${erradas.length ? t(erradas.length === 1 ? "sim.erradasUna" : "sim.erradasVarias", { n: erradas.length }) : t("sim.todasBien")}</div>
      <button class="primary" id="simOtro">${t("sim.otro")}</button>
      ${erradas.length ? `<button class="secondary" id="simIrTarjetas">${t("sim.irTarjetas")}</button>` : ""}
    </div>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("sim.repaso")}</div>
      ${s.preguntas.map((p, i) => `
        <details class="sim-repaso${p.acerto ? " bien" : " mal"}">
          <summary><span aria-hidden="true">${p.acerto ? "✓" : "✗"}</span> ${i + 1}. ${esc(p.tema || nombreArea(p.area || s.area))}</summary>
          <div class="sim-enunciado">${esc(p.enunciado)}</div>
          ${p.elegida != null && !p.acerto ? `<div class="nota-campo"><b>${t("sim.tuRespuesta")}</b> ${esc(p.opciones[p.elegida] || "")}</div>` : ""}
          ${p.elegida == null ? `<div class="nota-campo"><b>${t("sim.sinContestar")}</b></div>` : ""}
          <div class="nota-campo"><b>${t("sim.laCorrecta")}</b> ${esc(p.opciones[p.correcta] || "")}</div>
          ${p.explicacion ? `<div class="tutor-perla">💡 ${esc(p.explicacion)}</div>` : ""}
        </details>`).join("")}
    </div>`;
  irArribaEstudio();
  document.getElementById("simVolver").onclick = renderSimulacros;
  document.getElementById("simOtro").onclick = renderSimulacros;
  const tarjetas = document.getElementById("simIrTarjetas");
  if (tarjetas) tarjetas.onclick = () => renderEstudiar();
}
