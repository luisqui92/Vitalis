// Symphomed — Donde la pantalla avisa sus errores (ver services/erroresCliente.js).
//
// Sin sesión obligatoria: un error en la pantalla de entrar también importa.
// Con sesión, queda a qué médico le pasó (para saber a cuántos afecta).
// Con su propio límite por IP: nadie puede llenar la base mandando errores.
const { rateLimit } = require("../services/ratelimit");
const { verificarToken } = require("../services/auth");
const { registrarError } = require("../services/erroresCliente");
const { log } = require("../config");

const limitErrores = rateLimit("erroresCliente", 30, 10 * 60 * 1000, "Demasiados avisos de error.");

module.exports = function (app) {
  app.post("/errores-cliente", limitErrores, async (req, res) => {
    // Se contesta enseguida: la pantalla no espera nada de esto.
    res.status(204).end();
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      const payload = token ? verificarToken(token) : null;
      await registrarError(req.body || {}, payload?.usuario || null);
    } catch (e) {
      log.warn("[ERROR_PANTALLA] no se pudo guardar:", e.message);
    }
  });
};
