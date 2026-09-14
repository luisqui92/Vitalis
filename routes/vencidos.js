// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — El panel de lo que se pasó
// ═══════════════════════════════════════════════════════════════════════════
// Una sola ruta. El porqué y el cálculo están en services/vencidos.js.
//
// Va aparte del panel principal a propósito: se pide sin bloquear, y si
// tarda o falla el médico entra igual. Mismo criterio que la bandeja DICOM.
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute } = require("../services/httpHelpers");
const { loQueSePaso } = require("../services/vencidos");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  app.get("/medico/vencidos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    res.json(await loQueSePaso(req.adminUser.usuario));
  }));
};
