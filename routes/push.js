// Vitalis — Suscripción del navegador a las notificaciones (Web Push).
// El navegador se suscribe solo contra el servicio de push de su fabricante
// (Google/Mozilla/Apple) y nos deja acá el "endpoint" que resultó, que es
// por donde después le llegamos. Ver services/push.js para el envío.
const { SuscripcionPush } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { pushConfigurado, notificarMedico } = require("../services/push");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { CONFIG } = require("../config");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // La clave pública es justamente para entregársela al navegador: sin ella
  // no puede suscribirse. No sirve para mandar nada (eso lo firma la privada).
  app.get("/medico/push/config", requireMedico, asyncRoute(async (req, res) => {
    const suscripciones = await SuscripcionPush.countDocuments({ medicoPhone: req.adminUser.usuario });
    res.json({
      configurado: pushConfigurado(),
      clavePublica: CONFIG.VAPID_PUBLIC_KEY || "",
      dispositivos: suscripciones,
    });
  }));

  app.post("/medico/push/suscribir", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new ErrorHttp(400, "Suscripción incompleta");
    }
    // Mismo navegador que vuelve a suscribirse: se actualiza en vez de
    // duplicar (el endpoint es único). Puede cambiar de médico si dos
    // usan el mismo dispositivo, así que también se pisa el medicoPhone.
    await SuscripcionPush.findOneAndUpdate(
      { endpoint },
      {
        endpoint,
        medicoPhone: req.adminUser.usuario,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        navegador: String(req.headers["user-agent"] || "").slice(0, 200),
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  }));

  app.post("/medico/push/baja", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (!endpoint) throw new ErrorHttp(400, "Falta el endpoint");
    await SuscripcionPush.deleteOne({ endpoint, medicoPhone: req.adminUser.usuario });
    res.json({ ok: true });
  }));

  // Para que el médico compruebe que le llega de verdad, sin tener que
  // esperar a que un paciente reserve.
  app.post("/medico/push/probar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const r = await notificarMedico(req.adminUser.usuario, {
      titulo: "Vitalis",
      cuerpo: "Las notificaciones están activadas. Así vas a ver las reservas nuevas.",
      url: "/",
    });
    if (!r.enviadas) throw new ErrorHttp(400, "No se pudo enviar — " + (r.motivo || "revisá el permiso del navegador"));
    res.json({ ok: true, enviadas: r.enviadas });
  }));
};
