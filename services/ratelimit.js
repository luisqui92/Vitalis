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

function getIP(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0].trim()) ||
         req.headers["x-real-ip"] ||
         req.socket?.remoteAddress ||
         "unknown";
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

// Login/registro/2FA necesitan un límite mucho más estricto que el resto de
// la API: 60/min (limitMedico) es razonable para uso normal, pero deja
// margen de sobra para adivinar contraseñas o códigos de 2FA por fuerza
// bruta. Acá: 8 intentos cada 10 minutos por IP.
//
// Y acá SÍ va por IP: en el login todavía no hay token, así que no existe
// el médico al que cobrarle el intento. Es justo el caso que claveDeMedico
// resuelve cayéndose a la IP.
const limitAuth = rateLimit("auth", 8, 10 * 60 * 1000, "Demasiados intentos. Esperá unos minutos antes de volver a intentar.");

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

const limitLoginPorCuenta = rateLimitPorClave(
  "authCuenta", 10, 15 * 60 * 1000,
  "Demasiados intentos para esta cuenta. Esperá unos minutos antes de volver a intentar.",
  (req) => {
    // Por los dígitos y no por el texto: el login acepta el número escrito
    // de cualquier forma (services/telefono.js), y si el límite contara
    // «+5511…», «5511…» y «++5511…» por separado, alternarlos daría el
    // triple de intentos contra la misma cuenta.
    const texto = String(req.body?.phone || "").trim();
    const phone = texto.replace(/\D/g, "") || texto;
    return phone ? `login:${phone}` : null;
  }
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

module.exports = { rateLimit, rateLimitPorClave, claveDeMedico, limitMedico, limitVistaPrevia, limitAuth, limitReservaPublica, limitLoginPorCuenta, limit2faPorSesion, getIP };
