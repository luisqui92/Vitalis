// Vitalis — Estado de las copias de seguridad, visible para el médico.
// Un respaldo que anda pero que nadie mira es medio respaldo: el día que
// empieza a fallar, la única forma de enterarse a tiempo es que esté a la
// vista en la misma pantalla donde el médico ya entra.
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const backup = require("../services/backup");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  app.get("/medico/backups", limitMedico, requireMedico, asyncRoute(async (_req, res) => {
    res.json(await backup.estado());
  }));

  // Hacer uno a mano. Sirve para dos momentos concretos: antes de tocar algo
  // grande, y para que el médico compruebe con sus propios ojos que funciona
  // — que es lo que hace que confíe en el sistema.
  app.post("/medico/backups", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    registrar({ req, medicoPhone, accion: "backup_manual", recurso: "Backup" });
    const manifiesto = await backup.hacerBackup();
    if (manifiesto.salteado) {
      return res.status(503).json({ error: "La base de datos no está disponible en este momento. Probá de nuevo en un minuto." });
    }
    res.json({
      ok: manifiesto.verificado !== false,
      documentos: manifiesto.documentos,
      archivos: manifiesto.archivos,
      segundos: manifiesto.segundos,
      verificado: manifiesto.verificado,
      cifrado: manifiesto.cifrado,
    });
  }));
};
