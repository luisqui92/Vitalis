// Vitalis — Reserva de citas por link (sin login): la página que abre el
// paciente desde el WhatsApp para ver el calendario real y elegir
// día/hora/nombre en un solo lugar, en vez de contar números en una lista
// de texto. El link trae un token firmado (mismo mecanismo que el login de
// médicos) con el número de WhatsApp del paciente adentro — así no hace
// falta pedir contraseña ni guardar una sesión aparte: todo se resuelve en
// esta única pantalla.
const { Medico } = require("../db/models");
const { generarToken, verificarToken } = require("../services/auth");
const { obtenerHorariosDisponibles, horarioSigueLibre } = require("../services/agenda");
const { crearCitaConfirmada } = require("../services/crearCita");
const { formatearFechaCompleta } = require("../services/reservaCitas");
const { enviarTexto } = require("../services/baileysWhatsapp");
const { limitReservaPublica } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { CONFIG, log } = require("../config");

function numeroDesdeToken(token) {
  const payload = verificarToken(token);
  if (!payload || payload.rol !== "reserva_publica") return null;
  return payload.usuario;
}

module.exports = function (app) {
  app.get("/reserva-publica/disponibilidad", limitReservaPublica, asyncRoute(async (req, res) => {
    const numero = numeroDesdeToken(String(req.query.token || ""));
    if (!numero) throw new ErrorHttp(401, "Este link venció o no es válido. Escribile de nuevo al WhatsApp del consultorio para conseguir uno nuevo.");

    const medicoPhone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE;
    const medico = await Medico.findOne({ phone: medicoPhone, activo: true }).lean();
    if (!medico) throw new ErrorHttp(404, "No encontramos el consultorio.");

    const dias = await obtenerHorariosDisponibles(medicoPhone, 21);
    res.json({ medicoNombre: medico.nombre, dias });
  }));

  app.post("/reserva-publica/confirmar", limitReservaPublica, asyncRoute(async (req, res) => {
    const numero = numeroDesdeToken(String(req.body?.token || ""));
    if (!numero) throw new ErrorHttp(401, "Este link venció o no es válido. Escribile de nuevo al WhatsApp del consultorio para conseguir uno nuevo.");

    const medicoPhone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE;
    const medico = await Medico.findOne({ phone: medicoPhone, activo: true }).lean();
    if (!medico) throw new ErrorHttp(404, "No encontramos el consultorio.");

    const pacienteNombre = String(req.body?.pacienteNombre || "").trim();
    const motivo = String(req.body?.motivo || "").trim();
    if (pacienteNombre.length < 2) throw new ErrorHttp(400, "Necesitamos un nombre válido.");

    const fecha = new Date(String(req.body?.fecha || ""));
    if (isNaN(fecha.getTime())) throw new ErrorHttp(400, "Horario inválido.");

    const libre = await horarioSigueLibre(medicoPhone, fecha, medico.duracionConsultaMinutos || 30);
    if (!libre) throw new ErrorHttp(409, "Ups, ese horario se acaba de ocupar. Elegí otro.");

    const cita = await crearCitaConfirmada({
      medicoPhone, medico, pacienteTelefono: numero, pacienteNombre, fecha, motivo, origen: "whatsapp_web",
    });

    enviarTexto(numero, `✅ Listo, tu cita quedó confirmada para el ${formatearFechaCompleta(cita.fecha)}. Te esperamos.\n\nSi necesitás cancelarla, escribí "cancelar" acá mismo.`)
      .catch(e => log.error("[RESERVA_PUBLICA] no se pudo mandar la confirmación por WhatsApp:", e.message));

    res.json({ ok: true, fecha: cita.fecha });
  }));
};
