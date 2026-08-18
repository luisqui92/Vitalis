// Vitalis — Recepcionista de voz (Vapi): recibe los "tool calls" que el
// asistente de voz dispara durante una llamada real y ejecuta la acción
// correspondiente (services/vapiHerramientas.js), devolviendo el resultado
// en texto para que el asistente lo diga en voz alta. Quien conduce la
// conversación es el propio LLM de Vapi (configurado en su dashboard con
// el prompt y las tools) — acá solo se ejecutan las acciones.
//
// Formato del webhook (ver docs.vapi.ai/tools/custom-tools):
//   entra:  { message: { type: "tool-calls", call, toolCallList: [{id,name,arguments}] } }
//   sale:   { results: [{ toolCallId, result }] }
const { CONFIG, log } = require("../config");
const { Medico } = require("../db/models");
const { listarEspecialidades, consultarDisponibilidad, agendarCita, consultarMisCitas, cancelarCita } = require("../services/vapiHerramientas");

const HERRAMIENTAS = {
  listar_especialidades: listarEspecialidades,
  consultar_disponibilidad: consultarDisponibilidad,
  agendar_cita: agendarCita,
  consultar_mis_citas: consultarMisCitas,
  cancelar_cita: cancelarCita,
};

module.exports = function (app) {
  // Cada médico/consultorio tiene su propio Assistant en Vapi, configurado
  // con esta URL (con SU teléfono en la ruta) como Server URL — salvo el
  // "súper número" (/vapi/webhook/super), que atiende a TODOS los
  // consultorios de WHATSAPP_ESPECIALIDADES_MEDICOS: ahí el asistente
  // pregunta la especialidad primero y la manda como argumento en cada
  // herramienta (ver services/vapiHerramientas.js), en vez de tener un
  // médico fijo en la URL.
  app.post("/vapi/webhook/:medicoPhone", async (req, res) => {
    try {
      // Sin secreto configurado no hay forma segura de confirmar que esto
      // viene de Vapi y no de cualquiera que adivine la URL — mejor
      // rechazar todo que dejar la agenda del consultorio abierta.
      if (!CONFIG.VAPI_SERVER_SECRET) {
        log.error("[VAPI] VAPI_SERVER_SECRET no configurado — rechazando webhook");
        return res.status(503).json({ error: "No configurado" });
      }
      const secretoRecibido = req.get("x-vapi-secret") || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (secretoRecibido !== CONFIG.VAPI_SERVER_SECRET) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const paramMedicoPhone = String(req.params.medicoPhone || "").trim();
      const esSuperNumero = paramMedicoPhone === "super";
      let medicoPhone = null;
      if (esSuperNumero) {
        if (!CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.length) return res.status(503).json({ error: "Súper número no configurado" });
      } else {
        const medico = await Medico.findOne({ phone: paramMedicoPhone, activo: true }).select("_id").lean();
        if (!medico) return res.status(404).json({ error: "Consultorio no encontrado" });
        medicoPhone = paramMedicoPhone;
      }

      const msg = req.body?.message;
      if (msg?.type !== "tool-calls") {
        // Otros eventos (status-update, end-of-call-report, etc.) no
        // necesitan ninguna acción de nuestra parte — un 200 alcanza.
        return res.json({ ok: true });
      }

      const numeroLlamante = msg.call?.customer?.number || null;
      // Se aceptan las dos formas documentadas del payload (toolCallList
      // plano, o toolWithToolCallList anidado) por si la cuenta usa otra
      // versión de la API de la documentada al escribir esto.
      const llamadas = msg.toolCallList
        || (msg.toolWithToolCallList || []).map(t => ({ id: t.toolCall?.id, name: t.name, arguments: t.toolCall?.parameters }));

      const results = await Promise.all(llamadas.map(async (llamada) => {
        const nombre = llamada.name;
        const args = { ...(llamada.arguments || llamada.parameters || {}) };
        // El teléfono de quien llama ya lo sabemos por el caller ID — no
        // hace falta que el asistente se lo tenga que preguntar al
        // paciente, salvo que esté agendando/cancelando a nombre de otro.
        if (!args.pacienteTelefono && numeroLlamante) args.pacienteTelefono = numeroLlamante;

        const handler = HERRAMIENTAS[nombre];
        let resultado;
        if (!handler) {
          resultado = `Herramienta desconocida: ${nombre}.`;
        } else {
          try {
            resultado = await handler(medicoPhone, args);
          } catch (e) {
            log.error("[VAPI]", nombre, e.message);
            resultado = "Hubo un problema técnico procesando esto — pedile disculpas al paciente y sugerile que llame de nuevo en un momento, o que se comunique directo con la clínica.";
          }
        }
        return { toolCallId: llamada.id, result: resultado };
      }));

      res.json({ results });
    } catch (e) {
      log.error("[VAPI] webhook", e.message);
      res.status(500).json({ error: "Error interno" });
    }
  });
};
