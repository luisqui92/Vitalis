// Symphomed Ganadería — El enlace del dueño a su finca (LlaveFinca)
//
// Lo comparten la ruta que lo emite y lo usa (routes/accesoDueno.js) y la
// que edita la finca (routes/lotesGanado.js), que lo corta cuando cambia el
// WhatsApp del dueño.
const crypto = require("crypto");
const { LlaveFinca } = require("../db/models");

const nuevoToken = () => crypto.randomBytes(24).toString("base64url");
const hashDe = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

async function revocarLlaves(fincaId) {
  const r = await LlaveFinca.updateMany({ fincaId, revocadaEn: null }, { $set: { revocadaEn: new Date() } });
  return r.modifiedCount || 0;
}

// Lo que el veterinario ve del acceso de una finca. Nunca el enlace: no se
// guarda (ver LlaveFinca).
function estadoAcceso(llave) {
  if (!llave) return null;
  return { enviadaA: llave.enviadaA || "", desde: llave.createdAt, ultimoUso: llave.ultimoUso, usos: llave.usos || 0 };
}

module.exports = { nuevoToken, hashDe, revocarLlaves, estadoAcceso };
