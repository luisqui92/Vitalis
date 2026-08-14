// Vitalis — Registro de correcciones a lo que sugirió la IA. Se llama
// desde cada punto donde el médico puede editar una sugerencia antes de
// confirmarla (reconsulta, tratamiento por voz, mapa ocular). No es para
// mostrarle nada al médico — sirve para ver en qué se equivoca más la IA
// y afinar los prompts. Nunca debe romper ni frenar el flujo real.
const { CorreccionIA } = require("../db/models");
const { log } = require("../config");

async function registrarCorreccion({ medicoPhone, tipo, consultaId, campo, valorSugerido, valorFinal }) {
  const sugerido = String(valorSugerido ?? "").trim();
  const final = String(valorFinal ?? "").trim();
  if (sugerido === final) return; // no hubo corrección real, no vale la pena guardar
  try {
    await CorreccionIA.create({ medicoPhone, tipo, consultaId: consultaId || null, campo, valorSugerido: sugerido, valorFinal: final });
  } catch (e) {
    log.error("[CORRECCIONES_IA]", e.message);
  }
}

module.exports = { registrarCorreccion };
