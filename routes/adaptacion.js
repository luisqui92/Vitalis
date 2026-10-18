// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — «Así escribo yo»: lo que la IA aprendió de cada profesional, a
// la vista y en sus manos (services/adaptacion.js)
// ═══════════════════════════════════════════════════════════════════════════
//
//   GET   /medico/adaptacion             lo aprendido y lo que eligió él
//   PATCH /medico/adaptacion             el largo de la nota y las viñetas del plan
//   POST  /medico/adaptacion/agregar     una palabra, una abreviatura o una frase
//   POST  /medico/adaptacion/quitar      sacar algo, aprendido o agregado
//   POST  /medico/adaptacion/reiniciar   volver a empezar
//
// Todo sobre la propia cuenta: ninguna lleva el id de nadie más.
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const adaptacion = require("../services/adaptacion");

const requireMedico = requireAuth(["medico"]);

// Los errores de dato del servicio (status 400) llegan como lo que son.
const conErrores = (fn) => asyncRoute(async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status === 400) throw new ErrorHttp(400, e.message);
    throw e;
  }
});

module.exports = function (app) {
  app.get("/medico/adaptacion", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    res.json(await adaptacion.vista(req.adminUser.usuario));
  }));

  app.patch("/medico/adaptacion", limitMedico, requireMedico, conErrores(async (req, res) => {
    await adaptacion.cambiar(req.adminUser.usuario, { largo: req.body?.largo, vinetas: req.body?.vinetas });
    res.json({ ok: true });
  }));

  app.post("/medico/adaptacion/agregar", limitMedico, requireMedico, conErrores(async (req, res) => {
    const { tipo, texto, corto, largo } = req.body || {};
    await adaptacion.agregar(req.adminUser.usuario, { tipo, texto, corto, largo });
    res.json({ ok: true });
  }));

  app.post("/medico/adaptacion/quitar", limitMedico, requireMedico, conErrores(async (req, res) => {
    await adaptacion.quitar(req.adminUser.usuario, req.body?.clave);
    res.json({ ok: true });
  }));

  app.post("/medico/adaptacion/reiniciar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    await adaptacion.reiniciar(medicoPhone);
    registrar({ req, medicoPhone, accion: "adaptacion_reiniciada", recurso: `Adaptacion:${medicoPhone}` });
    res.json({ ok: true });
  }));
};
