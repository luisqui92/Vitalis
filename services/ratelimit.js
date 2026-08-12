// Vitalis — Rate Limiting en memoria (sin dependencias externas)
const { log } = require("../config");

const stores = { medico: new Map(), auth: new Map() };

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

module.exports = { rateLimit, limitMedico, limitAuth, getIP };
