// Vitalis — Rate Limiting en memoria (sin dependencias externas)
const { log } = require("../config");

const stores = { medico: new Map(), auth: new Map(), reservaPublica: new Map(), authCuenta: new Map() };

// Limpieza periódica para no acumular IPs
setInterval(() => {
  const now = Date.now();
  for (const store of Object.values(stores)) {
    for (const [ip, data] of store.entries()) {
      if (data.resetAt < now) store.delete(ip);
    }
  }
}, 5 * 60 * 1000); // cada 5 min

function getIP(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0].trim()) ||
         req.headers["x-real-ip"] ||
         req.socket?.remoteAddress ||
         "unknown";
}

function rateLimit(storeName, max, windowMs, message) {
  return (req, res, next) => {
    const ip = getIP(req);
    const store = stores[storeName];
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

const limitMedico = rateLimit("medico", 30, 60 * 1000, "Demasiadas peticiones. Esperá un momento.");

// Login/registro/2FA necesitan un límite mucho más estricto que el resto de
// la API: 30/min (limitMedico) es razonable para uso normal, pero deja
// margen de sobra para adivinar contraseñas o códigos de 2FA por fuerza
// bruta. Acá: 8 intentos cada 10 minutos por IP.
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
    const store = stores[storeName];
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
    const phone = String(req.body?.phone || "").trim();
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

module.exports = { rateLimit, limitMedico, limitAuth, limitReservaPublica, limitLoginPorCuenta, limit2faPorSesion, getIP };
