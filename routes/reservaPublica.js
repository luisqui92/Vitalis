// Symphomed — Reserva de citas por link (sin login): la página que abre el
// paciente desde el WhatsApp para ver el calendario real y elegir
// día/hora/nombre en un solo lugar, en vez de contar números en una lista
// de texto. El link trae un token firmado (mismo mecanismo que el login de
// médicos) con el número de WhatsApp del paciente adentro — así no hace
// falta pedir contraseña ni guardar una sesión aparte: todo se resuelve en
// esta única pantalla.
const { Medico } = require("../db/models");
const { generarToken, verificarToken } = require("../services/auth");
const { obtenerHorariosDisponibles, horarioSigueLibre, duracionDe } = require("../services/agenda");
const { crearCitaConfirmada } = require("../services/crearCita");
const { formatearFechaCompleta } = require("../services/reservaCitas");
const { enviarTextoOPlantilla, PLANTILLAS } = require("../services/metaWhatsapp");
const { limitReservaPublica } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { CONFIG, log } = require("../config");

// El token firma el número de teléfono del paciente (API oficial de Meta,
// no hace falta ninguna dirección especial para poder escribirle de vuelta
// más adelante — a diferencia de Baileys, que a veces identificaba al
// paciente con un LID en vez del número real).
function datosDesdeToken(token) {
  const payload = verificarToken(token);
  if (!payload || payload.rol !== "reserva_publica") return null;
  return { numero: payload.usuario };
}

module.exports = function (app) {
  // Datos para la llamada de voz por navegador (sin número de teléfono) —
  // ver public/js/reservarLlamada.js. La Public Key y el Assistant ID de
  // Vapi están pensados para exponerse al navegador, no son secretos (el
  // secreto real, VAPI_SERVER_SECRET, nunca sale del servidor).
  app.get("/reserva-publica/config", (_req, res) => {
    res.json({
      vapiPublicKey: CONFIG.VAPI_PUBLIC_KEY,
      vapiAssistantId: CONFIG.VAPI_ASSISTANT_ID,
      configurado: Boolean(CONFIG.VAPI_PUBLIC_KEY && CONFIG.VAPI_ASSISTANT_ID),
    });
  });

  app.get("/reserva-publica/disponibilidad", limitReservaPublica, asyncRoute(async (req, res) => {
    const datos = datosDesdeToken(String(req.query.token || ""));
    if (!datos) throw new ErrorHttp(401, "Este link venció o no es válido. Escribile de nuevo al WhatsApp del consultorio para conseguir uno nuevo.");

    const medicoPhone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE;
    const medico = await Medico.findOne({ phone: medicoPhone, activo: true }).lean();
    if (!medico) throw new ErrorHttp(404, "No encontramos el consultorio.");

    const dias = await obtenerHorariosDisponibles(medicoPhone, 21);
    res.json({ medicoNombre: medico.nombre, dias });
  }));

  app.post("/reserva-publica/confirmar", limitReservaPublica, asyncRoute(async (req, res) => {
    const datos = datosDesdeToken(String(req.body?.token || ""));
    if (!datos) throw new ErrorHttp(401, "Este link venció o no es válido. Escribile de nuevo al WhatsApp del consultorio para conseguir uno nuevo.");
    const { numero } = datos;

    const medicoPhone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE;
    const medico = await Medico.findOne({ phone: medicoPhone, activo: true }).lean();
    if (!medico) throw new ErrorHttp(404, "No encontramos el consultorio.");

    const pacienteNombre = String(req.body?.pacienteNombre || "").trim();
    const motivo = String(req.body?.motivo || "").trim();
    if (pacienteNombre.length < 2) throw new ErrorHttp(400, "Necesitamos un nombre válido.");

    const fecha = new Date(String(req.body?.fecha || ""));
    if (isNaN(fecha.getTime())) throw new ErrorHttp(400, "Horario inválido.");

    const libre = await horarioSigueLibre(medicoPhone, fecha, duracionDe(medico.duracionConsultaMinutos));
    if (!libre) throw new ErrorHttp(409, "Ups, ese horario se acaba de ocupar. Elegí otro.");

    let cita;
    try {
      cita = await crearCitaConfirmada({
        medicoPhone, medico, pacienteTelefono: numero, pacienteNombre, fecha, motivo, origen: "whatsapp_web",
      });
    } catch (e) {
      // crearCitaConfirmada revalida por su cuenta (más cerca del guardado
      // real que la revisión de arriba) — si perdió la carrera contra otra
      // reserva casi simultánea, cae acá en vez de un 500 genérico.
      if (e.horarioOcupado) throw new ErrorHttp(409, "Ups, ese horario se acaba de ocupar. Elegí otro.");
      throw e;
    }

    const primerNombre = pacienteNombre.split(" ")[0];
    // Reservó desde la PÁGINA, no por WhatsApp: es muy probable que nunca le
    // haya escrito al consultorio, así que casi siempre cae fuera de la
    // ventana de 24 h y va por la plantilla.
    const cuando = formatearFechaCompleta(cita.fecha);
    enviarTextoOPlantilla(numero,
      `✅ ${primerNombre}, su cita con ${medico.nombre} quedó confirmada para el ${cuando}. Le esperamos.\n\nSi necesita cancelarla, responda "cancelar" a este mensaje, o avísenos directo en el consultorio.`,
      { plantilla: PLANTILLAS.citaConfirmada, parametros: [primerNombre, medico.nombre, cuando], idioma: medico.idioma })
      .catch(e => log.error(`[RESERVA_PUBLICA] no se pudo mandar la confirmación por WhatsApp a ${numero}:`, e.message));

    res.json({ ok: true, fecha: cita.fecha });
  }));
};
