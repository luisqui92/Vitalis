// Symphomed — Recepcionista de voz (Vapi): recibe los "tool calls" que el
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

// Confirma el secreto compartido, y devuelve el medicoPhone a usar (o null
// en modo súper número, para que services/vapiHerramientas.js lo resuelva
// por especialidad) — compartido entre las dos formas de conectar Vapi de
// abajo (el webhook de "función" clásico, y la herramienta "Solicitud de
// API" que es la que ofrece el dashboard actual de Vapi).
async function autorizarYResolverMedico(req, res) {
  if (!CONFIG.VAPI_SERVER_SECRET) {
    log.error("[VAPI] VAPI_SERVER_SECRET no configurado — rechazando webhook");
    res.status(503).json({ error: "No configurado" });
    return null;
  }
  const secretoRecibido = req.get("x-vapi-secret") || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (secretoRecibido !== CONFIG.VAPI_SERVER_SECRET) {
    res.status(401).json({ error: "No autorizado" });
    return null;
  }

  const paramMedicoPhone = String(req.params.medicoPhone || "").trim();
  if (paramMedicoPhone === "super") {
    if (!CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS.length) {
      res.status(503).json({ error: "Súper número no configurado" });
      return null;
    }
    return { medicoPhone: null };
  }
  const medico = await Medico.findOne({ phone: paramMedicoPhone, activo: true }).select("_id").lean();
  if (!medico) {
    res.status(404).json({ error: "Consultorio no encontrado" });
    return null;
  }
  return { medicoPhone: paramMedicoPhone };
}

module.exports = function (app) {
  // ─── "Solicitud de API" (el tipo de herramienta que ofrece hoy el
  // dashboard de Vapi): una URL por herramienta, cuerpo JSON plano de
  // entrada y de salida — sin ningún envoltorio. El teléfono de quien
  // llama se manda como campo estático de la herramienta en Vapi
  // ({{customer.number}} → pacienteTelefono), no hace falta extraerlo acá.
  // En consultar_mis_citas y cancelar_cita TIENE que ser ese campo fijo:
  // acá no hay forma de saber si el número lo dictó quien llama (A5).
  app.post("/vapi/api-tool/:medicoPhone/:herramienta", async (req, res) => {
    try {
      const resuelto = await autorizarYResolverMedico(req, res);
      if (!resuelto) return; // ya mandó la respuesta de error

      const handler = HERRAMIENTAS[req.params.herramienta];
      if (!handler) return res.status(404).json({ error: "Herramienta desconocida" });

      const resultado = await handler(resuelto.medicoPhone, req.body || {}).catch(e => {
        log.error("[VAPI api-tool]", req.params.herramienta, e.message);
        return "Hubo un problema técnico procesando esto — pedile disculpas y sugerile que llame de nuevo en un momento, o que se comunique directo con la clínica.";
      });
      res.json({ resultado });
    } catch (e) {
      log.error("[VAPI api-tool]", e.message);
      res.status(500).json({ error: "Error interno" });
    }
  });

  // ─── Webhook de "función" clásico (docs.vapi.ai/tools/custom-tools) —
  // se deja andando por si en algún momento se configura una tool así vía
  // la API/JSON de Vapi en vez del dashboard, aunque hoy el dashboard solo
  // ofrece "Solicitud de API" (la ruta de arriba). Cada médico/consultorio
  // usa esta URL con SU teléfono en la ruta, o "super" para el modo de
  // varias especialidades.
  app.post("/vapi/webhook/:medicoPhone", async (req, res) => {
    try {
      const resuelto = await autorizarYResolverMedico(req, res);
      if (!resuelto) return;
      const medicoPhone = resuelto.medicoPhone;

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
        // paciente, salvo que esté agendando a nombre de otro.
        //
        // Para VER o CANCELAR citas manda siempre el caller ID, nunca lo que
        // diga quien llama: dictando el número de otra persona se escuchaban
        // sus citas y se las cancelaba (auditoría del comité de QA, octubre
        // de 2026, A5). Sin caller ID —todas las llamadas desde la página
        // web— va vacío, y la herramienta deriva al WhatsApp. Solo al
        // AGENDAR se acepta otro número: reservar para un familiar es normal.
        if (nombre === "consultar_mis_citas" || nombre === "cancelar_cita") args.pacienteTelefono = numeroLlamante || "";
        else if (!args.pacienteTelefono && numeroLlamante) args.pacienteTelefono = numeroLlamante;

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
