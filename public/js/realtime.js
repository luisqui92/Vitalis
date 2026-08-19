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

function refrescarPantallaActual() {
  if (!PANTALLA_ACTUAL) return;
  const { tipo, params } = PANTALLA_ACTUAL;
  if (tipo === "dashboard") renderDashboard();
  else if (tipo === "agenda") renderAgenda();
  else if (tipo === "pacienteDetalle") renderPacienteDetalle(params.pacienteId, params.tabActiva);
  else if (tipo === "inicioEscritorio" && typeof renderInicioEscritorio === "function") renderInicioEscritorio();
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
