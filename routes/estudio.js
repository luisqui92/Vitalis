// Symphomed — Estudiar con los casos propios (ver services/estudio.js).
//
// Solo para cuentas de estudiante. No cuesta nada (no hay IA acá: las
// tarjetas salen del razonamiento ya guardado), así que se puede estudiar
// aunque el acceso esté vencido o sin horas: lo que se frena es grabar.
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { sinCambios } = require("../services/realtime");
const estudio = require("../services/estudio");

const requireMedico = requireAuth(["medico"]);

function soloEstudiantes(req) {
  if (!req.adminUser.estudiante) throw new ErrorHttp(403, "Estudiar con tus casos es de las cuentas de estudiante.");
  return req.adminUser.usuario;
}

// Responder una tarjeta no cambia nada de lo que muestran las otras
// pantallas (pacientes, consultas): sin esto, cada respuesta le haría
// recargar el panel a la compu que tiene abierta al lado (services/realtime.js).
function escritura(req, res) {
  sinCambios(res);
  return soloEstudiantes(req);
}

module.exports = function (app) {
  // Lo que toca hoy, con el resumen (racha, logros, casos por razonar).
  app.get("/medico/estudio/hoy", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    const zona = await estudio.zonaDe(medicoPhone);
    await estudio.asegurarTarjetas(medicoPhone);
    const [tarjetas, resumen] = await Promise.all([
      estudio.tarjetasParaHoy(medicoPhone),
      estudio.resumen(medicoPhone, zona),
    ]);
    res.json({ tarjetas: tarjetas.map(t => estudio.paraMostrar(t)), resumen });
  }));

  // «Repasar más»: las que todavía no tocaban, las que menos sabe primero.
  app.get("/medico/estudio/repaso", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    const tarjetas = await estudio.tarjetasDeRepaso(medicoPhone);
    res.json({ tarjetas: tarjetas.map(t => estudio.paraMostrar(t)) });
  }));

  // Solo el resumen, para el inicio: la racha y cuántas hay para hoy.
  app.get("/medico/estudio/resumen", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    const zona = await estudio.zonaDe(medicoPhone);
    await estudio.asegurarTarjetas(medicoPhone);
    res.json({ resumen: await estudio.resumen(medicoPhone, zona) });
  }));

  app.post("/medico/estudio/tarjetas/:id/responder", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const zona = await estudio.zonaDe(medicoPhone);
    res.json(await estudio.responder(medicoPhone, req.params.id, req.body || {}, zona));
  }));

  app.post("/medico/estudio/tarjetas/:id/reportar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    await estudio.reportar(medicoPhone, req.params.id, String(req.body?.motivo || ""));
    res.json({ ok: true });
  }));

  app.delete("/medico/estudio/tarjetas/:id/reportar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    await estudio.deshacerReporte(medicoPhone, req.params.id);
    res.json({ ok: true });
  }));
};
