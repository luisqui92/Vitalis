// Symphomed — Un solo portero para todos los WebSocket.
//
// ═══ EL ERROR QUE ESTO ARREGLA ═════════════════════════════════════════════
//
// Symphomed tiene dos WebSocket sobre el mismo servidor HTTP: /ws (el tiempo
// real, para que un cambio hecho en el celular aparezca solo en la compu) y
// /ws-tele (la señalización de la teleconsulta).
//
// La forma obvia de montarlos es la que usábamos:
//
//     new WebSocketServer({ server, path: "/ws" });
//     new WebSocketServer({ server, path: "/ws-tele" });
//
// Y está mal, aunque lea perfecto. Cada WebSocketServer creado con `server`
// agrega SU PROPIO escuchador del evento "upgrade", y un EventEmitter llama
// a TODOS los escuchadores. Entonces, con dos montados:
//
//   · Llega un upgrade a /ws-tele. El de /ws se despierta primero, ve que la
//     ruta no es la suya y —esto es lo que sorprende— no la deja pasar: la
//     mata con un 400. Cuando le toca al de /ws-tele, el socket ya está
//     muerto. La teleconsulta nunca conecta.
//
//   · Llega un upgrade a /ws. El de /ws completa el handshake bien. Después
//     se despierta el de /ws-tele, ve que no es su ruta, y escribe un 400
//     ADENTRO de la conexión que ya se había convertido en WebSocket. El
//     cliente recibe basura ("Invalid WebSocket frame: RSV1 must be clear")
//     y se cae.
//
// O sea: montar el segundo rompe los dos. Y no lo agarraba ninguna prueba,
// porque cada una levantaba el suyo solo — que es exactamente el caso que
// funciona.
//
// ═══ LA FORMA CORRECTA ═════════════════════════════════════════════════════
//
// Un único escuchador de "upgrade" que mira la ruta y le entrega el socket
// al que corresponda. Los WebSocketServer se crean con `noServer: true`, que
// significa "no te enganches solo, yo te aviso".
//
// Está acá y no en index.js a propósito: así el día que alguien agregue un
// tercer WebSocket, la única forma de montarlo es la buena.
const { log } = require("../config");

// httpServer -> Map(ruta -> WebSocketServer). WeakMap para no dejar vivo un
// servidor de prueba después de que la prueba termina.
const rutasPorServidor = new WeakMap();

function registrarWs(httpServer, ruta, wss) {
  let rutas = rutasPorServidor.get(httpServer);

  if (!rutas) {
    rutas = new Map();
    rutasPorServidor.set(httpServer, rutas);

    httpServer.on("upgrade", (req, socket, cabeza) => {
      // Un socket sin manejador de error tumba el proceso entero si el
      // cliente se va en la mitad del handshake.
      socket.on("error", () => {});

      let ruta;
      try {
        ruta = new URL(req.url, "http://localhost").pathname;
      } catch {
        ruta = "";
      }

      const destino = rutas.get(ruta);
      if (!destino) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      destino.handleUpgrade(req, socket, cabeza, (ws) => {
        destino.emit("connection", ws, req);
      });
    });
  }

  // Dos módulos peleándose la misma ruta es un error de programación, y el
  // segundo ganaría en silencio. Mejor que no arranque.
  if (rutas.has(ruta)) {
    throw new Error(`[WS] La ruta ${ruta} ya está registrada por otro módulo`);
  }
  rutas.set(ruta, wss);
  log.info(`[WS] ${ruta} montado`);
  return wss;
}

module.exports = { registrarWs };
