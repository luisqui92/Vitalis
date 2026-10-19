// Symphomed — Estado de las copias de seguridad, visible para el médico.
// Un respaldo que anda pero que nadie mira es medio respaldo: el día que
// empieza a fallar, la única forma de enterarse a tiempo es que esté a la
// vista en la misma pantalla donde el médico ya entra.
const { Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { esOperador } = require("../services/operadores");
const { asyncRoute } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const backup = require("../services/backup");

const requireSesion = requireAuth(["medico", "admin"]);

async function puedeEjecutarBackup(phone) {
  if (!esOperador(phone)) return false;
  const cuenta = await Medico.findOne({ phone }).select("dosFA activo").lean();
  return Boolean(cuenta?.activo !== false && cuenta?.dosFA?.activo);
}

function requireOperadorBackup(req, res, next) {
  puedeEjecutarBackup(req.adminUser?.usuario)
    .then((permitido) => {
      if (!permitido) {
        registrar({
          req,
          medicoPhone: req.adminUser?.usuario,
          accion: "backup_manual_denegado",
          recurso: "Backup",
          exito: false,
        });
        return res.status(404).json({ error: "No encontrado" });
      }
      next();
    })
    .catch(next);
}

module.exports = function (app) {
  app.get("/medico/backups", limitMedico, requireSesion, asyncRoute(async (req, res) => {
    res.json({
      ...(await backup.estado()),
      puedeEjecutar: await puedeEjecutarBackup(req.adminUser.usuario),
    });
  }));

  // Hacer uno a mano. Sirve para dos momentos concretos: antes de tocar algo
  // grande, y para que el médico compruebe con sus propios ojos que funciona
  // — que es lo que hace que confíe en el sistema.
  app.post("/medico/backups", limitMedico, requireSesion, requireOperadorBackup, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    registrar({ req, medicoPhone, accion: "backup_manual", recurso: "Backup" });
    const manifiesto = await backup.hacerBackup();
    // Lo está haciendo otro proceso (scripts/respaldar_ahora.js, antes de un
    // despliegue): la base anda bien, decir que no está disponible es mentir.
    if (manifiesto.motivo === "en_curso_otro_proceso") {
      return res.status(409).json({ error: "Ya se está haciendo una copia en este momento. Esperá unos minutos y mirá el estado." });
    }
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
      externo: manifiesto.externo?.verificado === true,
    });
  }));
};
