// Symphomed — Tiempo real: si el médico tiene la sesión abierta en dos
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
//
// "dictadoLote" es la misma idea aplicada al dictado de campo de Ganadería
// (public/js/ganaderia.js): subir el audio ES un POST del propio médico —
// crea la nota de voz—, y sin este freno el aviso de cambio repintaba el
// detalle del lote EN MEDIO de la grabación/subida, tirando la caja de
// dictado abajo del médico. No hay ningún "renderX" que envolver acá —el
// dictado vive adentro de la misma pantalla de siempre—, así que
// ganaderia.js marca y desmarca PANTALLA_ACTUAL a mano, en vez de con
// envolverParaTiempoReal().
const PANTALLAS_SIN_REFRESCO = new Set(["editorInforme", "membrete", "salaTele", "dictadoLote"]);

// ═══ UN REPINTADO QUE NO PIDIÓ EL MÉDICO NO PUEDE MOVERLE LA PÁGINA ═══════
//
// Estos repintados los dispara un aviso del servidor: una cita que entró por
// WhatsApp, un estudio que subió el equipo de rayos. El médico no tocó nada —
// puede estar leyendo la mitad de una historia clínica.
//
// Repintar arma el HTML de cero, así que el navegador manda el scroll arriba
// de todo. El médico pierde el renglón que estaba leyendo y tiene que volver
// a bajar a buscarlo, sin entender por qué se movió.
//
// En el escritorio el que scrollea es #escritorioContent; en el celular, la
// ventana. Se guardan los dos y se restauran los dos: cuál está activo
// depende de la pantalla, y preguntarlo acá sería otra cosa que se
// desincroniza.
function guardarScroll() {
  const caja = document.getElementById("escritorioContent");
  return { caja: caja ? caja.scrollTop : 0, ventana: window.scrollY || 0 };
}

function restaurarScroll(pos) {
  // En el mismo cuadro no alcanza: el contenido recién se mide después de
  // que el navegador lo acomoda, y hasta entonces la página no tiene alto
  // suficiente para scrollear hasta donde estaba.
  requestAnimationFrame(function () {
    const caja = document.getElementById("escritorioContent");
    if (caja && pos.caja) caja.scrollTop = pos.caja;
    if (pos.ventana) window.scrollTo(0, pos.ventana);
  });
}

function refrescarPantallaActual() {
  if (!PANTALLA_ACTUAL) return;
  // Algo cambió desde otro aparato: lo recordado puede estar viejo.
  if (typeof olvidarApiReciente === "function") olvidarApiReciente();
  // Con una grabación en curso no se repinta nada: la pantalla de grabar no
  // está registrada acá, así que el aviso caía sobre la anterior (la ficha
  // del paciente) y la repintaba ENCIMA de la grabación — que quedaba sin
  // botón para detenerla ni subirla, sin que el médico tocara nada.
  if (typeof hayGrabacionEnCurso === "function" && hayGrabacionEnCurso()) return;
  const { tipo, params } = PANTALLA_ACTUAL;
  if (PANTALLAS_SIN_REFRESCO.has(tipo)) return;

  // Y si el médico está escribiendo, no se le toca la pantalla. Repintar le
  // arranca el campo del DOM con lo que llevaba escrito adentro — y lo peor
  // es que no se pierde "un texto": se pierde a mitad de una frase, que es
  // cuando más molesta.
  const foco = document.activeElement;
  if (foco && (foco.tagName === "INPUT" || foco.tagName === "TEXTAREA" || foco.isContentEditable)) return;

  const pos = guardarScroll();
  if (tipo === "dashboard") renderDashboard();
  else if (tipo === "agenda") renderAgenda();
  else if (tipo === "pacienteDetalle") renderPacienteDetalle(params.pacienteId, params.tabActiva);
  else if (tipo === "ganaderia") renderGanaderia();
  else if (tipo === "animalDetalle") renderAnimalDetalle(params.animalId);
  else if (tipo === "loteDetalle") renderLoteDetalle(params.loteId);
  else if (tipo === "inicioEscritorio" && typeof renderInicioEscritorio === "function") renderInicioEscritorio();
  else if (tipo === "recordatorios") renderRecordatorios();
  // La bandeja SÍ se refresca sola: es una pantalla de espera, y lo que se
  // espera es justamente que aparezca algo nuevo.
  else if (tipo === "bandejaDicom" && typeof renderBandejaDicom === "function") renderBandejaDicom();
  // preservarToken: este repintado no lo pidió el médico, así que no puede
  // hacerle desaparecer el token que está copiando en ese momento.
  else if (tipo === "equiposRayos" && typeof renderEquiposRayos === "function") renderEquiposRayos(params.pacienteVuelta, { preservarToken: true });

  restaurarScroll(pos);
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
// Sin esto, cargar un lote o un evento (un POST) dispara el aviso de cambio
// de siempre, y ese aviso repintaba la pantalla ANTERIOR — la lista de
// pacientes, si era la última registrada— sacando al médico de Ganadería
// justo después de guardar. Mismo bug que ya pasó con renderEquiposRayos.
envolverParaTiempoReal("renderGanaderia", () => ({ tipo: "ganaderia", params: {} }));
envolverParaTiempoReal("renderLoteDetalle", (loteId) => ({ tipo: "loteDetalle", params: { loteId } }));
envolverParaTiempoReal("renderAnimalDetalle", (animalId) => ({ tipo: "animalDetalle", params: { animalId } }));
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
