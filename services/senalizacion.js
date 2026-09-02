// Vitalis — La señalización de la teleconsulta.
//
// ═══ QUÉ HACE Y, SOBRE TODO, QUÉ NO ════════════════════════════════════════
//
// Para que dos navegadores se conecten directo tienen que intercambiar unos
// mensajes primero: qué códecs soportan y por qué direcciones IP se pueden
// alcanzar (la "oferta", la "respuesta" y los candidatos ICE). Ese
// intercambio necesita un intermediario, y ese intermediario es esto.
//
// Lo que pasa por acá son esos mensajes de arranque y NADA MÁS. Ni un byte
// de audio ni de video: eso va directo de un navegador al otro (o por TURN
// si no logran verse, ver services/video.js). Este archivo podría leer los
// mensajes que relaya y no encontraría una palabra de lo que se dijo en la
// consulta.
//
// ═══ DOS Y NO MÁS ══════════════════════════════════════════════════════════
//
// Una sala acepta exactamente dos ocupantes. No es una limitación técnica
// —relayar entre tres sería igual de fácil— sino la regla: una consulta es
// entre un médico y su paciente. Un tercero conectado a la señalización
// podría negociar su propia conexión y quedar escuchando.
//
// Por eso el tercero que llega se rechaza, y por eso cada papel entra una
// sola vez: si el médico se reconecta, el socket viejo se cierra.
const { WebSocketServer } = require("ws");
const { registrarWs } = require("./wsRuteo");
const { verificarTokenDeSenal } = require("./video");
const { log } = require("../config");

// sala -> { medico: socket|null, paciente: socket|null }
const salas = new Map();

function otroExtremo(sala, papel) {
  const s = salas.get(sala);
  if (!s) return null;
  return papel === "medico" ? s.paciente : s.medico;
}

function mandar(socket, obj) {
  if (socket && socket.readyState === 1) {
    try { socket.send(JSON.stringify(obj)); } catch { /* se cierra solo */ }
  }
}

function iniciarSenalizacion(httpServer) {
  // noServer + registrarWs, NO { server, path }: ver services/wsRuteo.js —
  // montarlo de la otra forma rompía esta ruta Y la del tiempo real.
  const wss = registrarWs(httpServer, "/ws-tele", new WebSocketServer({ noServer: true }));

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const datos = verificarTokenDeSenal(url.searchParams.get("token"));
    if (!datos) {
      socket.close(4001, "No autorizado");
      return;
    }
    const { sala, papel } = datos;

    if (!salas.has(sala)) salas.set(sala, { medico: null, paciente: null });
    const ocupantes = salas.get(sala);

    // El mismo papel reconectando (se le cortó el wifi, recargó la página)
    // reemplaza a su socket anterior. El anterior ya no sirve para nada y
    // dejarlo abierto solo confunde a quien esté del otro lado.
    if (ocupantes[papel]) {
      try { ocupantes[papel].close(4002, "Reemplazado por una conexión nueva"); } catch { /* ya estaba muerto */ }
    }
    ocupantes[papel] = socket;

    // Si el otro ya está, se avisan mutuamente: recién ahí tiene sentido
    // empezar a negociar. Quien recibe "listo" con iniciar:true arma la
    // oferta — hace falta que UNO solo la arme, o las dos ofertas chocan.
    const otro = otroExtremo(sala, papel);
    if (otro) {
      mandar(socket, { tipo: "listo", iniciar: papel === "medico" });
      mandar(otro, { tipo: "listo", iniciar: otro === ocupantes.medico });
    } else {
      mandar(socket, { tipo: "esperando" });
    }

    socket.on("message", (crudo) => {
      let msg;
      try { msg = JSON.parse(crudo); } catch { return; }
      // Solo se relayan los tipos de la negociación. Un relay que reenvía
      // cualquier cosa es un chat anónimo gratis montado adentro de un
      // sistema de historias clínicas.
      if (!["oferta", "respuesta", "candidato", "colgo"].includes(msg?.tipo)) return;
      mandar(otroExtremo(sala, papel), msg);
    });

    socket.on("close", () => {
      const s = salas.get(sala);
      if (!s) return;
      if (s[papel] === socket) s[papel] = null;
      // Al que queda se le avisa, para que muestre "se desconectó" en vez de
      // una pantalla congelada que no dice nada.
      mandar(otroExtremo(sala, papel), { tipo: "se_fue", papel });
      if (!s.medico && !s.paciente) salas.delete(sala);
    });

    socket.on("error", () => { /* se limpia con el close que sigue */ });
  });

  log.info("[TELECONSULTA] señalización escuchando en /ws-tele");
  return wss;
}

// Para las pruebas: cuántas salas hay abiertas ahora mismo.
function salasAbiertas() {
  return salas.size;
}

module.exports = { iniciarSenalizacion, salasAbiertas };
