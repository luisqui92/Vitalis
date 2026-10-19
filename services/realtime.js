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
const { verificarToken, sesionVigente } = require("./auth");
const { log } = require("../config");

// medicoPhone -> Set de sockets abiertos (uno por pestaña/dispositivo).
const conexionesPorMedico = new Map();

// Las pruebas lo achican; en producción no se toca. Va antes de iniciar el
// servidor: el latido se arma una vez, al arrancar.
const AJUSTES = { LATIDO_MS: 30 * 1000 };

function iniciarServidorTiempoReal(httpServer) {
  // noServer + registrarWs, NO { server, path }: dos WebSocketServer colgados
  // del mismo servidor HTTP se destruyen las conexiones entre ellos. Está
  // explicado en services/wsRuteo.js.
  const wss = registrarWs(httpServer, "/ws", new WebSocketServer({ noServer: true }));

  wss.on("connection", (socket, req) => {
    // El token va en la URL solo acá: el navegador no deja ponerle cabeceras
    // a un WebSocket (services/auth.js).
    const url = new URL(req.url, "http://localhost");
    const payload = verificarToken(url.searchParams.get("token"));
    if (!payload || payload.rol !== "medico") {
      socket.close(4001, "No autorizado");
      return;
    }
    socket.on("error", () => {}); // se limpia solo con el "close" que sigue
    // Antes de la consulta de abajo: el latido puede pasar mientras tanto.
    socket.vivo = true;
    socket.on("pong", () => { socket.vivo = true; });
    socket.sesion = payload;

    // La misma regla que requireAuth: una cuenta dada de baja, o una sesión
    // de antes de «cerrar todas» o de un cambio de clave, no abre el canal.
    // Mientras se consulta, el socket ya está abierto pero no recibe nada.
    sesionVigente(payload).then((vigente) => {
      if (socket.readyState !== socket.OPEN) return; // se fue mientras tanto
      if (!vigente) { socket.close(4001, "Sesión no válida"); return; }
      registrarSocket(socket, payload.usuario);
    }, () => socket.close(1011, "No se pudo verificar la sesión"));
  });

  // ═══ EL LATIDO ═══════════════════════════════════════════════════════════
  //
  // Un celular que pierde la señal no manda "close": su socket quedaba para
  // siempre en conexionesPorMedico (auditoría de QA, B-L4). Cada LATIDO_MS se
  // le hace ping a cada uno, y el que no contestó el anterior se corta (eso
  // dispara el "close" que lo limpia). De paso nginx no corta /ws por callado.
  //
  // Y se vuelve a mirar la sesión. Revisarla solo al conectar dejaba abierto,
  // en el aparato perdido, el socket que ya estaba abierto antes de «cerrar
  // todas» o de la baja, recibiendo avisos hasta que se reconectara. También
  // corta el token que venció mientras el socket seguía abierto.
  const latido = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.vivo) { socket.terminate(); continue; }
      socket.vivo = false;
      try { socket.ping(); } catch { /* se corta en la próxima vuelta */ }
      revisarSesion(socket);
    }
  }, AJUSTES.LATIDO_MS);
  latido.unref();
  wss.on("close", () => clearInterval(latido));

  return wss;
}

function registrarSocket(socket, medicoPhone) {
  socket.registrado = true;
  if (!conexionesPorMedico.has(medicoPhone)) conexionesPorMedico.set(medicoPhone, new Set());
  conexionesPorMedico.get(medicoPhone).add(socket);

  socket.on("close", () => {
    const set = conexionesPorMedico.get(medicoPhone);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) conexionesPorMedico.delete(medicoPhone);
  });
}

async function revisarSesion(socket) {
  if (!socket.registrado || socket.revisando) return;
  socket.revisando = true;
  try {
    const vale = Number(socket.sesion.exp) > Date.now() && await sesionVigente(socket.sesion);
    if (!vale && socket.readyState === socket.OPEN) socket.close(4001, "Sesión no válida");
  } catch (e) {
    // La base no contestó: no se corta a todos por eso. Se vuelve a mirar
    // en el próximo latido.
    log.warn("[TIEMPO_REAL] no se pudo revisar una sesión:", e.message);
  } finally {
    socket.revisando = false;
  }
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

module.exports = { AJUSTES, iniciarServidorTiempoReal, middlewareAvisarCambios, avisarCambio, sinCambios };
