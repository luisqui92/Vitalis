// Symphomed — Autenticación de los equipos que suben imágenes solos
//
// Hay dos clases de equipo y las dos entran por la misma puerta: el agente
// que vigila una carpeta en la PC del consultorio (agente-rayos/) y la Caja
// Symphomed, que recibe DICOM de los aparatos por C-STORE (caja-dicom/).
// Comparten el modelo EquipoRayos y este par de funciones; vive acá y no
// dentro de una ruta porque las dos rutas lo necesitan.
const crypto = require("crypto");
const { EquipoRayos } = require("../db/models");

// Mismo criterio que una contraseña: se guarda el hash, el token en claro se
// muestra una sola vez y no se puede volver a ver. Si se pierde, se genera
// otro — es un botón, no un drama.
function generarToken() {
  return "vrx_" + crypto.randomBytes(24).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// Autentica por el header X-Equipo-Token. Devuelve el equipo, o null — y en
// ese caso ya respondió el error, así que quien llama solo tiene que salir.
async function equipoDesdeRequest(req, res) {
  const token = String(req.headers["x-equipo-token"] || "").trim();
  if (!token) {
    res.status(401).json({ error: "Falta el token del equipo (header X-Equipo-Token)" });
    return null;
  }
  const equipo = await EquipoRayos.findOne({ tokenHash: hashToken(token), activo: true });
  if (!equipo) {
    res.status(401).json({ error: "Token de equipo inválido o dado de baja" });
    return null;
  }
  return equipo;
}

function capturaVigente(captura) {
  return Boolean(captura && new Date(captura.expiraEn).getTime() > Date.now());
}

module.exports = { generarToken, hashToken, equipoDesdeRequest, capturaVigente };
