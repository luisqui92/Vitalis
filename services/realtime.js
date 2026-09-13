// Symphomed — Tiempo real: si un médico tiene la sesión abierta en dos
// dispositivos a la vez (celular y compu, por ejemplo), un cambio hecho en
// uno se refleja solo en el otro, sin que tenga que tocar nada.
//
// No hay eventos finitos por tipo de dato (paciente, cita, recordatorio...)
// — sería un mantenimiento enorme tener que acordarse de emitir el evento
// correcto en cada una de las decenas de rutas que escriben algo. En vez de
// eso, un solo middleware genérico avisa "algo cambió" cada vez que un
// médico autenticado hace un POST/PATCH/PUT/DELETE que termina bien — el
// frontend decide qué volver a pedir según qué pantalla esté mirando en ese
// momento (ver public/js/realtime.js).
const { WebSocketServer } = require("ws");
const { registrarWs } = require("./wsRuteo");
const { verificarToken } = require("./auth");
const { log } = require("../config");

// medicoPhone -> Set de sockets abiertos (uno por pestaña/dispositivo).
const conexionesPorMedico = new Map();

function iniciarServidorTiempoReal(httpServer) {
  // noServer + registrarWs, NO { server, path }: dos WebSocketServer colgados
  // del mismo servidor HTTP se destruyen las conexiones entre ellos. Está
  // explicado en services/wsRuteo.js.
  const wss = registrarWs(httpServer, "/ws", new WebSocketServer({ noServer: true }));

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const payload = verificarToken(url.searchParams.get("token"));
    if (!payload || payload.rol !== "medico") {
      socket.close(4001, "No autorizado");
      return;
    }
    const medicoPhone = payload.usuario;
    if (!conexionesPorMedico.has(medicoPhone)) conexionesPorMedico.set(medicoPhone, new Set());
    conexionesPorMedico.get(medicoPhone).add(socket);

    socket.on("close", () => {
      const set = conexionesPorMedico.get(medicoPhone);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) conexionesPorMedico.delete(medicoPhone);
    });
    socket.on("error", () => {}); // se limpia solo con el "close" que sigue
  });

  return wss;
}

// Avisa a TODAS las conexiones abiertas de ese médico (incluida la que
// originó el cambio — no vale la pena distinguir cuál fue, total volver a
// pedir los mismos datos que ya tenía no rompe nada, solo es un pedido de
// más).
function avisarCambio(medicoPhone) {
  const set = conexionesPorMedico.get(medicoPhone);
  if (!set || set.size === 0) return;
  const mensaje = JSON.stringify({ tipo: "cambio" });
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(mensaje);
  }
}

// ═══ HAY POST QUE NO CAMBIAN NADA ═════════════════════════════════════════
//
// El método no alcanza para saber si algo cambió. Preguntarle al Kardex por
// un paciente es un POST —la pregunta va en el cuerpo, no en la URL— y no
// escribe una sola letra en la base.
//
// Tratarlo como escritura tenía una consecuencia que no se ve leyendo este
// archivo: el aviso vuelve al NAVEGADOR DEL PROPIO MÉDICO, que repinta la
// pantalla del paciente entera. O sea que su propia pregunta le rearmaba la
// página abajo de los ojos y lo mandaba de vuelta arriba de todo, teniendo
// que bajar a buscar la respuesta que acababa de pedir.
//
// Una ruta que sabe que no cambió nada lo dice con sinCambios(res). No se
// hace por lista de rutas a propósito: una lista se desactualiza en silencio
// —alguien agrega un POST de consulta y nadie se acuerda de anotarlo— y el
// síntoma vuelve sin que nadie relacione una cosa con la otra.
function sinCambios(res) {
  res.locals.sinCambios = true;
}

// Middleware: se engancha una sola vez en index.js, antes de las rutas.
// Lee req.adminUser recién en el callback de "finish" (se completa async,
// para entonces las rutas ya corrieron y ya lo dejaron seteado si el
// pedido pasó por requireAuth).
function middlewareAvisarCambios(req, res, next) {
  res.on("finish", () => {
    const esEscritura = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
    if (esEscritura && !res.locals.sinCambios && res.statusCode < 400 && req.adminUser?.usuario) {
      avisarCambio(req.adminUser.usuario);
    }
  });
  next();
}

module.exports = { iniciarServidorTiempoReal, middlewareAvisarCambios, avisarCambio, sinCambios };
