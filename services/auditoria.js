// Vitalis — Log de auditoría: quién accedió a qué y cuándo. Nunca debe
// romper ni frenar el pedido real que la disparó (si falla, se loguea el
// error y listo — perder un registro de auditoría es mejor que tirar abajo
// la app por eso).
const { AuditLog } = require("../db/models");
const { getIP } = require("./ratelimit");
const { log } = require("../config");

function registrar({ req, medicoPhone, accion, recurso = "", detalle = "", exito = true }) {
  AuditLog.create({
    medicoPhone: medicoPhone || "",
    accion,
    recurso,
    detalle,
    ip: req ? getIP(req) : "",
    exito,
  }).catch(e => log.error("[AUDITORIA] no se pudo registrar:", e.message));
}

module.exports = { registrar };
