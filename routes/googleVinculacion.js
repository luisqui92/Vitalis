const vinculacion = require("../services/googleVinculacion");
const { limitAuth } = require("../services/ratelimit");
const { asyncRoute } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

module.exports = function (app) {
  app.post("/medico/google/vincular-soporte", limitAuth, asyncRoute(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const cuenta = await vinculacion.confirmar(req);
    registrar({ req, medicoPhone: cuenta.phone, accion: "vincular_google_soporte", recurso: `Medico:${cuenta.cuentaId}` });
    // El ingreso posterior pasa por el flujo habitual, incluido el segundo factor.
    res.json({ ok: true });
  }));
};
