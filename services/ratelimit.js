// Symphomed — Rate Limiting en memoria (sin dependencias externas)
const { log } = require("../config");
// Solo para saber DE QUIÉN es el pedido antes de contarlo — ver
// claveDeMedico(). auth.js no importa nada de acá, así que no hay ciclo.
const { verificarToken } = require("./auth");

// Los "store" se crean solos la primera vez que alguien pide un limitador
// con ese nombre (ver almacen()). Antes había que acordarse de agregarlo
// acá a mano, y olvidarse no fallaba al arrancar: fallaba con un 500 recién
// cuando alguien pegaba a esa ruta.
const stores = {};

function almacen(nombre) {
  if (!stores[nombre]) stores[nombre] = new Map();
  return stores[nombre];
}

// Limpieza periódica para no acumular claves (IPs, cuentas, sesiones)
//
// .unref() al final: sin eso, este temporizador —pensado para el servidor
// que corre para siempre— mantiene vivo a CUALQUIER proceso que cargue este
// archivo, aunque sea un script de una sola vez que ya terminó su trabajo.
// Pasó de verdad: scripts/crear_socio.js requiere services/auditoria, que
// requiere esto, y el proceso quedaba colgado sin ningún error ni log — solo
// el cursor esperando, hasta matarlo a mano.
//
// unref() no apaga el temporizador ni cambia nada para el servidor: le dice
// al runtime "no me cuentes como motivo para seguir vivo". Si el proceso
// sigue corriendo por cualquier otra razón —que en el servidor siempre la
// hay—, esto sigue disparando cada 5 minutos exactamente igual.
setInterval(() => {
  const now = Date.now();
  for (const store of Object.values(stores)) {
    for (const [clave, data] of store.entries()) {
      if (data.resetAt < now) store.delete(clave);
    }
  }
}, 5 * 60 * 1000).unref(); // cada 5 min

// ═══ DE QUÉ IP VIENE UN PEDIDO ═════════════════════════════════════════════
//
// req.ip, que Express arma según «trust proxy» (index.js: 1 salto, el nginx
// propio): de X-Forwarded-For toma el ÚLTIMO valor, el que agregó nginx con
// la IP que vio de verdad. Antes se leía la cabecera a mano y se tomaba el
// PRIMERO, que lo escribe el cliente: cambiándolo en cada pedido se esquivaba
// cualquier límite de este archivo (auditoría de QA, M1).
//
// Eso vale solo si nginx manda X-Forwarded-For. Si no la manda, todo llega
// desde 127.0.0.1 y cada límite por IP lo comparte la plataforma entera:
// ocho contraseñas mal escritas en cualquier consultorio del país, y nadie
// más entra por diez minutos. Para ese caso quedan dos cosas:
//   · un aviso en el log, una sola vez, para que alguien arregle nginx;
//   · X-Real-IP como respaldo, solo si el pedido viene de esta misma máquina
//     y sin X-Forwarded-For: es justo lo que llega de un nginx que pone una
//     y no la otra. No abre nada nuevo: con un nginx que no pone ninguna de
//     las dos, el cliente igual podría escribir X-Forwarded-For y req.ip la
//     tomaría.
const DESDE_ESTA_MAQUINA = /^(127\.|::1$|::ffff:127\.)/;
let avisoSinXff = false;

function getIP(req) {
  const directa = req.socket?.remoteAddress || "";
  if (DESDE_ESTA_MAQUINA.test(directa) && !req.headers?.["x-forwarded-for"]) {
    if (!avisoSinXff) {
      avisoSinXff = true;
      log.warn(`[RATE_LIMIT] llegó un pedido desde ${directa} sin X-Forwarded-For (${req.method} ${req.originalUrl || req.url}). ` +
        "Si pasó por nginx, falta «proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;» y todos los visitantes cuentan como una sola IP. " +
        "Si fue un curl desde el propio servidor, no hay nada que arreglar.");
    }
    const real = String(req.headers?.["x-real-ip"] || "").trim();
    if (real) return real;
  }
  return req.ip || directa || "unknown";
}

function rateLimit(storeName, max, windowMs, message) {
  return (req, res, next) => {
    const ip = getIP(req);
    const store = almacen(storeName);
    const now = Date.now();
    const data = store.get(ip);

    if (!data || data.resetAt < now) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (data.count >= max) {
      const waitSec = Math.ceil((data.resetAt - now) / 1000);
      res.setHeader("Retry-After", waitSec);
      log.warn(`[RATE_LIMIT] IP ${ip} bloqueada en ${storeName} (${data.count}/${max})`);
      return res.status(429).json({
        error: message || "Demasiadas peticiones. Esperá un momento.",
        retryAfter: waitSec
      });
    }

    data.count++;
    next();
  };
}

// La cuota de las rutas de médico es de CADA MÉDICO, no de la IP.
//
// Una clínica de siete consultorios sale a internet con una sola IP: la del
// router de la clínica. Con la cuota por IP, esos siete médicos se repartían
// treinta pedidos por minuto entre todos, y al tercero que abría un Kardex
// al mismo tiempo le salía un 429 sin haber hecho nada raro. Peor todavía,
// era invisible en las pruebas: cada uno probando desde su casa nunca lo veía.
//
// La firma del token se verifica antes de usar el usuario como clave. Si la
// clave saliera de un token sin verificar, cualquiera podría mandar pedidos
// a nombre de otro médico y dejarlo sin cuota — un ataque barato y difícil
// de diagnosticar desde el lado del médico bloqueado.
function claveDeMedico(req) {
  const token = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token;
  const payload = verificarToken(token);
  if (payload?.usuario) return `medico:${payload.usuario}`;
  // Sin token válido no hay a quién cobrarle el pedido. Se cae a la IP, que
  // además es lo único que frena a quien pega sin haber iniciado sesión —
  // esos pedidos igual terminan en 401, pero cuestan.
  return `ip:${getIP(req)}`;
}

// 60/min por médico. Abrir un Kardex con sus pestañas dispara del orden de
// diez pedidos, así que treinta —que era el número de antes, pero repartido
// entre todos— daban tres pantallas por minuto. Sigue siendo un freno firme
// para bajarse la base de pacientes de a poco.
const limitMedico = rateLimitPorClave(
  "medico", 60, 60 * 1000,
  "Demasiadas peticiones. Esperá un momento.",
  claveDeMedico
);

// El permiso para la vista previa en vivo: cada uno abre una conexión con
// AssemblyAI que se cobra por el tiempo que queda abierta, y la pantalla
// pide uno solo por grabación. Veinte cada diez minutos sobra para
// cualquiera que esté atendiendo, y frena a quien los pida en cantidad
// (segunda revisión de QA del 9 de octubre de 2026, E06). Si se pasa, la
// pantalla graba igual, sin vista previa.
const limitVistaPrevia = rateLimitPorClave(
  "vistaPrevia", 20, 10 * 60 * 1000,
  "Demasiados pedidos de vista previa. Esperá unos minutos: la grabación sigue sin ella.",
  claveDeMedico
);

// ═══ EN LA PUERTA SE CUENTA LO QUE SALE MAL ════════════════════════════════
//
// Igual que rateLimit, pero un pedido que termina bien devuelve su lugar.
//
// Una clínica de siete consultorios entra por una sola IP (la del router), y
// con 2FA cada ingreso son dos pedidos. Contando todo, al quinto médico que
// llegaba a empezar el turno le salía un 429 y se quedaba diez minutos
// afuera sin haber errado una letra (auditoría de QA, M12). Quien prueba
// contraseñas, en cambio, solo junta errores: para él el límite es el mismo.
//
// El lugar se ocupa AL ENTRAR y se devuelve al terminar bien, no al revés.
// Contar recién al terminar dejaría pasar mil intentos a la vez: mientras
// bcrypt piensa el primero, ninguno terminó y el contador sigue en cero.
function rateLimitFallidos(storeName, max, windowMs, message) {
  const contarTodo = rateLimit(storeName, max, windowMs, message);
  return (req, res, next) => {
    contarTodo(req, res, () => {
      const registro = almacen(storeName).get(getIP(req));
      res.on("finish", () => {
        if (res.statusCode < 400 && registro && registro.count > 0) registro.count--;
      });
      next();
    });
  };
}

// Login/2FA necesitan un límite mucho más estricto que el resto de la API:
// 60/min (limitMedico) es razonable para uso normal, pero deja margen de
// sobra para adivinar contraseñas o códigos de 2FA por fuerza bruta. Acá: 8
// intentos FALLIDOS cada 10 minutos por IP.
//
// Y acá SÍ va por IP: en el login todavía no hay token, así que no existe
// el médico al que cobrarle el intento. Es justo el caso que claveDeMedico
// resuelve cayéndose a la IP.
const limitAuth = rateLimitFallidos("auth", 8, 10 * 60 * 1000, "Demasiados intentos. Esperá unos minutos antes de volver a intentar.");

// El registro, en cambio, cuenta TODO: ahí lo que hay que frenar es
// justamente lo que sale bien. Cada solicitud aceptada entra a la fila y le
// manda un aviso a quien aprueba (routes/medicoAuth.js), y con
// limitAuth una sola IP podría llenarla sin un solo error.
const limitRegistro = rateLimit("registro", 8, 10 * 60 * 1000, "Demasiadas solicitudes seguidas. Esperá unos minutos antes de volver a intentar.");

// Página pública de reserva (sin login) — la usa cualquiera que abra el
// link, así que necesita su propio límite en vez de compartir el de medico.
const limitReservaPublica = rateLimit("reservaPublica", 20, 60 * 1000, "Demasiados intentos. Esperá un momento.");

// limitAuth (arriba) limita por IP, pero un atacante con muchas IPs
// (proxies, botnet) tiene intentos ilimitados contra UNA sola cuenta. Este
// limitador es igual pero la clave es la propia cuenta (o sesión de 2FA),
// no la IP — así una cuenta puntual queda protegida sin importar desde
// cuántas IPs distintas la ataquen. Si keyFn no devuelve nada (ej. body sin
// phone), no bloquea nada — limitAuth por IP sigue aplicando igual.
function rateLimitPorClave(storeName, max, windowMs, message, keyFn) {
  return (req, res, next) => {
    const clave = keyFn(req);
    if (!clave) return next();
    const store = almacen(storeName);
    const now = Date.now();
    const data = store.get(clave);

    if (!data || data.resetAt < now) {
      store.set(clave, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (data.count >= max) {
      const waitSec = Math.ceil((data.resetAt - now) / 1000);
      res.setHeader("Retry-After", waitSec);
      log.warn(`[RATE_LIMIT] cuenta ${clave} bloqueada en ${storeName} (${data.count}/${max})`);
      return res.status(429).json({
        error: message || "Demasiados intentos. Esperá un momento.",
        retryAfter: waitSec
      });
    }

    data.count++;
    next();
  };
}

function porTelefono(prefijo) {
  return (req) => {
    // Por los dígitos y no por el texto: el login acepta el número escrito
    // de cualquier forma (services/telefono.js), y si el límite contara
    // «+5511…», «5511…» y «++5511…» por separado, alternarlos daría el
    // triple de intentos contra la misma cuenta.
    const texto = String(req.body?.phone || "").trim();
    const phone = texto.replace(/\D/g, "") || texto;
    return phone ? `${prefijo}:${phone}` : null;
  };
}

const limitLoginPorCuenta = rateLimitPorClave(
  "authCuenta", 10, 15 * 60 * 1000,
  "Demasiados intentos para esta cuenta. Esperá unos minutos antes de volver a intentar.",
  porTelefono("login")
);

// Lo mismo para la puerta de los socios (routes/socio.js), que tenía solo el
// límite por IP. Y una sesión de socio da de alta médicos ya aprobados, sin
// pasar por la fila: es la cuenta que menos conviene dejar a la fuerza bruta.
// Clave aparte de la del médico: un mismo número puede ser las dos cosas, y
// errar en una puerta no tiene por qué cerrar la otra.
const limitLoginSocioPorCuenta = rateLimitPorClave(
  "authCuenta", 10, 15 * 60 * 1000,
  "Demasiados intentos para esta cuenta. Esperá unos minutos antes de volver a intentar.",
  porTelefono("socio")
);

// El código de 2FA se prueba contra un tempToken puntual (vence a los 5
// min) — se limita por ese token en vez de por teléfono para no depender de
// decodificarlo acá.
const limit2faPorSesion = rateLimitPorClave(
  "authCuenta", 15, 5 * 60 * 1000,
  "Demasiados intentos de código. Iniciá sesión de nuevo.",
  (req) => {
    const t = String(req.body?.tempToken || "").trim();
    return t ? `2fa:${t.slice(0, 60)}` : null;
  }
);

module.exports = { rateLimit, rateLimitPorClave, rateLimitFallidos, claveDeMedico, limitMedico, limitVistaPrevia, limitAuth, limitRegistro, limitReservaPublica, limitLoginPorCuenta, limitLoginSocioPorCuenta, limit2faPorSesion, getIP };
