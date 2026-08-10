// Vitalis — utilidades chicas compartidas entre rutas
const { CONFIG } = require("../config");

// Día boliviano (para resetear el código diario de vinculación del celular).
function fechaStrBolivia(date = new Date()) {
  const t = new Date(date.getTime() + CONFIG.OFFSET_HORAS * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

module.exports = { fechaStrBolivia };
