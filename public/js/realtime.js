// Vitalis — Tiempo real: si el médico tiene la sesión abierta en dos
// dispositivos a la vez (celular y compu, por ejemplo), un cambio hecho en
// uno actualiza al otro solo, sin tocar nada. El servidor no manda eventos
// finitos por tipo de dato (ver services/realtime.js) — solo avisa "algo
// cambió", y acá se decide qué volver a pedir según qué esté mostrando la
// pantalla en ese momento. Para saber qué está mostrando sin tener que
// tocar cada pantalla, se usa el mismo truco de "envolver" la función que
// ya usa escritorio.js: se guarda qué se llamó y con qué, y ante un aviso
// de cambio se vuelve a llamar igual (con datos frescos del servidor).
let socketTiempoReal = null;
let reintentoTiempoRealMs = 1000;
let PANTALLA_ACTUAL = null; // { tipo, params } | null

function conectarTiempoReal() {
  if (!TOKEN) return;
  if (socketTiempoReal && (socketTiempoReal.readyState === WebSocket.OPEN || socketTiempoReal.readyState === WebSocket.CONNECTING)) return;
  const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
  socketTiempoReal = new WebSocket(`${protocolo}//${location.host}/ws?token=${encodeURIComponent(TOKEN)}`);

  socketTiempoReal.onopen = () => { reintentoTiempoRealMs = 1000; };
  socketTiempoReal.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.tipo === "cambio") refrescarPantallaActual();
  };
  socketTiempoReal.onclose = () => {
    socketTiempoReal = null;
    if (!TOKEN) return; // se deslogueó, no tiene sentido reconectar
    setTimeout(conectarTiempoReal, reintentoTiempoRealMs);
    reintentoTiempoRealMs = Math.min(reintentoTiempoRealMs * 2, 30000);
  };
  socketTiempoReal.onerror = () => {}; // el "close" que sigue ya maneja el reintento
}

function desconectarTiempoReal() {
  PANTALLA_ACTUAL = null;
  reintentoTiempoRealMs = 1000;
  if (socketTiempoReal) {
    socketTiempoReal.onclose = null; // no reconectar por un cierre intencional
    socketTiempoReal.close();
    socketTiempoReal = null;
  }
}

// Hay pantallas que son un formulario abierto, con texto a medio escribir:
// el editor de informes (el médico está dictando el diagnóstico) y el
// membrete. Repintarlas por un aviso de cambio le borraría lo escrito — y
// el aviso muchas veces lo dispara el guardado del propio médico, así que
// se borraría solo. Se registran igual, para que el aviso no caiga sobre la
// pantalla anterior y lo saque de acá; refrescarlas es no hacer nada.
//
// La sala de la teleconsulta va en la misma bolsa, y ahí no es que se
// perdería lo escrito: repintar arranca los <video> del DOM y con ellos la
// conexión WebRTC. La llamada se corta en la mitad, con el paciente del
// otro lado.
const PANTALLAS_SIN_REFRESCO = new Set(["editorInforme", "membrete", "salaTele"]);

function refrescarPantallaActual() {
  if (!PANTALLA_ACTUAL) return;
  const { tipo, params } = PANTALLA_ACTUAL;
  if (PANTALLAS_SIN_REFRESCO.has(tipo)) return;
  if (tipo === "dashboard") renderDashboard();
  else if (tipo === "agenda") renderAgenda();
  else if (tipo === "pacienteDetalle") renderPacienteDetalle(params.pacienteId, params.tabActiva);
  else if (tipo === "inicioEscritorio" && typeof renderInicioEscritorio === "function") renderInicioEscritorio();
  else if (tipo === "recordatorios") renderRecordatorios();
  // La bandeja SÍ se refresca sola: es una pantalla de espera, y lo que se
  // espera es justamente que aparezca algo nuevo.
  else if (tipo === "bandejaDicom" && typeof renderBandejaDicom === "function") renderBandejaDicom();
  // preservarToken: este repintado no lo pidió el médico, así que no puede
  // hacerle desaparecer el token que está copiando en ese momento.
  else if (tipo === "equiposRayos" && typeof renderEquiposRayos === "function") renderEquiposRayos(params.pacienteVuelta, { preservarToken: true });
}

function envolverParaTiempoReal(nombreFn, calcularPantalla) {
  const original = window[nombreFn];
  if (typeof original !== "function") return;
  window[nombreFn] = function (...args) {
    PANTALLA_ACTUAL = calcularPantalla(...args);
    return original.apply(this, args);
  };
}

envolverParaTiempoReal("renderDashboard", () => ({ tipo: "dashboard", params: {} }));
envolverParaTiempoReal("renderAgenda", () => ({ tipo: "agenda", params: {} }));
// pintarKardex es la función que de verdad pinta la ficha del paciente —
// la llaman tanto renderPacienteDetalle (al entrar) como el clic en cada
// pestaña (con los datos ya en memoria, sin pedir de nuevo) — envolver
// ESA alcanza para las dos, sin duplicar el seguimiento.
envolverParaTiempoReal("pintarKardex", (p, _c, _m, _v, _med, _est, _rec, tabActiva) => ({ tipo: "pacienteDetalle", params: { pacienteId: p._id, tabActiva } }));
envolverParaTiempoReal("renderInicioEscritorio", () => ({ tipo: "inicioEscritorio", params: {} }));
envolverParaTiempoReal("renderRecordatorios", () => ({ tipo: "recordatorios", params: {} }));
// Sin esto, dar de alta un equipo de rayos (un POST) hacía que el aviso de
// cambio repintara la pantalla ANTERIOR y saltara fuera de la de equipos,
// justo en el único momento en que el token está a la vista.
envolverParaTiempoReal("renderEquiposRayos", (pacienteVuelta) => ({ tipo: "equiposRayos", params: { pacienteVuelta } }));
envolverParaTiempoReal("renderBandejaDicom", () => ({ tipo: "bandejaDicom", params: {} }));
// Entrar a la videoconsulta ES un POST del propio médico, así que dispara un
// aviso de cambio a los dos segundos. Sin registrarse acá, ese aviso caía
// sobre la pantalla anterior —la ficha del paciente— y la repintaba encima
// de la sala: el médico entraba, veía la videollamada un instante y volvía
// solo a la ficha, sin tocar nada y sin ningún error.
//
// Es el mismo caso que renderEquiposRayos acá arriba. Es lo que pasa cuando
// una pantalla se pinta sin decir que existe.
envolverParaTiempoReal("teleMedEntrar", () => ({ tipo: "salaTele", params: {} }));
// Estas dos van a PANTALLAS_SIN_REFRESCO: se registran para que el aviso de
// cambio sepa que el médico ya no está en la ficha del paciente, y ahí se
// queda quieto en vez de repintarla encima del informe a medio escribir.
envolverParaTiempoReal("renderEditorInforme", (pacienteId, informeId) => ({ tipo: "editorInforme", params: { pacienteId, informeId } }));
envolverParaTiempoReal("renderMembrete", () => ({ tipo: "membrete", params: {} }));
