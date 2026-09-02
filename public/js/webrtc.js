// Vitalis — La videollamada, navegador a navegador.
//
// Lo usan las dos pantallas: la del médico (teleconsultaMedico.js) y la del
// paciente (teleconsulta.js). El audio y el video van DIRECTO de uno al
// otro; por el servidor solo pasan los mensajes de arranque de la
// negociación (ver services/senalizacion.js).
//
// ═══ POR QUÉ ESTO PARECE MÁS COMPLICADO DE LO QUE DEBERÍA ══════════════════
//
// Porque una videollamada tiene tres formas de fallar que no se parecen en
// nada, y las tres pasan seguido:
//
//   1. El navegador no da cámara/micrófono. Es lo más común de todo, y
//      hay que decirlo con palabras, no dejar una pantalla negra.
//   2. Los dos extremos no logran verse (NAT simétrico, típico entre dos
//      redes móviles). Ahí hace falta TURN, y sin TURN la llamada "conecta"
//      y no se escucha nada — el peor de los tres, porque parece que anda.
//   3. Se corta la conexión en el medio. Hay que avisar y reintentar.
//
// El caso 2 es el que justifica todo el resto del archivo: se mira el estado
// real de la conexión y se avisa, en vez de mostrar un cuadro negro.

let rtcConexion = null;
let rtcSocket = null;
let rtcStreamLocal = null;

function rtcCerrar() {
  try { rtcSocket?.close(); } catch { /* ya estaba cerrado */ }
  try { rtcConexion?.close(); } catch { /* idem */ }
  // Soltar la cámara y el micrófono de verdad: si no, la lucecita del
  // dispositivo queda prendida después de colgar y —con razón— asusta.
  rtcStreamLocal?.getTracks().forEach(t => t.stop());
  rtcSocket = null; rtcConexion = null; rtcStreamLocal = null;
}

// Arranca la llamada dentro de dos <video> que ya existen en la pantalla.
//
//   datos   — { token, ice, hayTurn } que devolvió el servidor
//   idLocal / idRemoto — ids de los <video>
//   alEstado(texto, esProblema) — para que cada pantalla lo muestre a su modo
// alStreams (opcional) se llama cuando llega el audio del otro extremo, con
// las dos puntas: el micrófono de acá y lo que llega de allá. Es el momento
// exacto en que se puede grabar en dos canales — antes no hay con qué, y no
// hay consulta que grabar.
async function rtcIniciar(datos, { idLocal, idRemoto, alEstado, alStreams }) {
  rtcCerrar();
  const decir = (t, malo) => { try { alEstado?.(t, Boolean(malo)); } catch { /* la pantalla se fue */ } };

  // 1. Cámara y micrófono. Va primero porque es lo que más falla, y porque
  // sin permiso no tiene sentido armar nada de lo demás.
  try {
    rtcStreamLocal = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    // Distinguir "dijo que no" de "no hay cámara" importa: la solución es
    // distinta y el paciente no tiene por qué deducirla.
    decir(e?.name === "NotAllowedError"
      ? t("tele.sinPermiso")
      : t("tele.sinCamara"), true);
    return false;
  }

  const vLocal = document.getElementById(idLocal);
  if (vLocal) { vLocal.srcObject = rtcStreamLocal; vLocal.muted = true; vLocal.play?.().catch(() => {}); }

  rtcConexion = new RTCPeerConnection({ iceServers: datos.ice || [] });
  rtcStreamLocal.getTracks().forEach(pista => rtcConexion.addTrack(pista, rtcStreamLocal));

  rtcConexion.ontrack = (ev) => {
    const vRemoto = document.getElementById(idRemoto);
    if (vRemoto && ev.streams[0]) {
      vRemoto.srcObject = ev.streams[0];
      vRemoto.play?.().catch(() => {});
    }
    // ontrack se dispara una vez por pista (audio y video llegan por
    // separado), así que esto puede llamarse dos veces con el mismo stream.
    // Quien escucha tiene que aguantar que lo llamen de nuevo.
    if (ev.streams[0]) {
      try { alStreams?.(rtcStreamLocal, ev.streams[0]); } catch { /* la pantalla se fue */ }
    }
  };

  rtcConexion.onconnectionstatechange = () => {
    const estado = rtcConexion?.connectionState;
    if (estado === "connected") decir(t("tele.conectado"), false);
    if (estado === "failed") {
      // Acá es donde se nota la falta de TURN, y es el momento de decirlo
      // en vez de dejar una pantalla negra sin explicación.
      decir(datos.hayTurn ? t("tele.fallo") : t("tele.falloSinTurn"), true);
    }
    if (estado === "disconnected") decir(t("tele.reconectando"), true);
  };

  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  rtcSocket = new WebSocket(`${wsProto}//${location.host}/ws-tele?token=${encodeURIComponent(datos.token)}`);

  rtcConexion.onicecandidate = (ev) => {
    if (ev.candidate && rtcSocket?.readyState === 1) {
      rtcSocket.send(JSON.stringify({ tipo: "candidato", candidato: ev.candidate }));
    }
  };

  rtcSocket.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!rtcConexion) return;

    if (msg.tipo === "esperando") return decir(t("tele.esperandoAlOtro"), false);

    // Uno solo arma la oferta, o las dos chocan. El servidor decide cuál.
    if (msg.tipo === "listo" && msg.iniciar) {
      const oferta = await rtcConexion.createOffer();
      await rtcConexion.setLocalDescription(oferta);
      rtcSocket.send(JSON.stringify({ tipo: "oferta", sdp: oferta }));
      return decir(t("tele.conectando"), false);
    }
    if (msg.tipo === "listo") return decir(t("tele.conectando"), false);

    if (msg.tipo === "oferta") {
      await rtcConexion.setRemoteDescription(msg.sdp);
      const respuesta = await rtcConexion.createAnswer();
      await rtcConexion.setLocalDescription(respuesta);
      rtcSocket.send(JSON.stringify({ tipo: "respuesta", sdp: respuesta }));
      return;
    }
    if (msg.tipo === "respuesta") {
      await rtcConexion.setRemoteDescription(msg.sdp);
      return;
    }
    if (msg.tipo === "candidato" && msg.candidato) {
      // Un candidato que llega antes de la descripción remota tira error y
      // no pasa nada: se descarta y la conexión igual se arma con los otros.
      try { await rtcConexion.addIceCandidate(msg.candidato); } catch { /* llegó a destiempo */ }
      return;
    }
    if (msg.tipo === "se_fue" || msg.tipo === "colgo") {
      const vRemoto = document.getElementById(idRemoto);
      if (vRemoto) vRemoto.srcObject = null;
      return decir(t("tele.seDesconecto"), true);
    }
  };

  rtcSocket.onclose = () => decir(t("tele.sinSenal"), true);
  rtcSocket.onerror = () => decir(t("tele.sinSenal"), true);

  decir(t("tele.esperandoAlOtro"), false);
  return true;
}

// Avisar al otro extremo antes de cortar, para que no se quede mirando una
// imagen congelada esperando a alguien que ya se fue.
function rtcColgar() {
  if (rtcSocket?.readyState === 1) {
    try { rtcSocket.send(JSON.stringify({ tipo: "colgo" })); } catch { /* da igual, ya cerramos */ }
  }
  rtcCerrar();
}

// Si alguien cierra la pestaña en el medio, la cámara se apaga igual.
window.addEventListener("beforeunload", () => { try { rtcCerrar(); } catch { /* nada */ } });
