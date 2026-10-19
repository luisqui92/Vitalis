// Symphomed — "Preguntale a Symphomed": preguntas sobre cómo funciona el
// sistema. No se guarda la conversación (el historial lo manda el navegador
// para poder repreguntar), igual que la Memoria Clínica.
const { log } = require("../config");
const { Medico, Paciente, ConsultaMedica, Cita, Recordatorio } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { preguntarASymphomed } = require("../services/asistenteSymphomed");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { sinCambios } = require("../services/realtime");
const { hoyEnZona, instanteEnZona, ZONA_POR_DEFECTO } = require("../services/zonaHoraria");

const requireMedico = requireAuth(["medico"]);

const ETIQUETA_ESPECIALIDAD = {
  medicina_general: "Medicina general",
  odontologia: "Odontología",
  estetica: "Estética",
  oftalmologia: "Oftalmología",
  veterinaria: "Veterinaria",
  ginecologia: "Ginecología y Obstetricia",
};

module.exports = function (app) {
  app.post("/medico/asistente", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    // Es un POST porque la pregunta va en el cuerpo, pero no escribe
    // nada. Sin esto, el aviso de cambio vuelve al navegador del propio
    // médico y le repinta la pantalla entera abajo de los ojos: su propia
    // pregunta lo manda arriba de todo, a buscar la respuesta que pidió.
    sinCambios(res);
    const medicoPhone = req.adminUser.usuario;
    const pregunta = String(req.body?.pregunta || "").trim();
    if (!pregunta) throw new ErrorHttp(400, "Escribí una pregunta");
    if (pregunta.length > 800) throw new ErrorHttp(400, "La pregunta es demasiado larga");

    const medico = await Medico.findOne({ phone: medicoPhone }).select("nombre tipoEspecialidad zonaHoraria").lean();

    // Números propios del consultorio, para poder responder "¿cuántos
    // pacientes tengo?" o "¿qué tengo hoy?" sin que la IA los invente.
    const ahora = new Date();
    const hace30 = new Date(ahora.getTime() - 30 * 24 * 3600 * 1000);
    // El fin del día del consultorio, en la zona de la cuenta: setHours()
    // usa la del servidor (UTC), y a las 10:00 de Bolivia el día terminaba a
    // las 19:59 (las citas de la noche no contaban) y a las 21:00 contaba las
    // de mañana como de hoy (M10).
    const zona = medico?.zonaHoraria || ZONA_POR_DEFECTO;
    const h = hoyEnZona(zona, ahora);
    const finHoy = new Date(instanteEnZona(zona, h.anio, h.mesIndex, h.dia + 1, 0, 0).getTime() - 1);
    const en7 = new Date(ahora.getTime() + 7 * 24 * 3600 * 1000);

    const [pacientes, consultasMes, citasHoy, citasProximas, recordatorios] = await Promise.all([
      Paciente.countDocuments({ medicoPhone }),
      ConsultaMedica.countDocuments({ medicoPhone, createdAt: { $gte: hace30 } }),
      Cita.countDocuments({ medicoPhone, estado: "confirmada", fecha: { $gte: ahora, $lte: finHoy } }),
      Cita.countDocuments({ medicoPhone, estado: "confirmada", fecha: { $gte: ahora, $lte: en7 } }),
      Recordatorio.countDocuments({ medicoPhone, completado: false }),
    ]);

    try {
      const respuesta = await preguntarASymphomed(pregunta, {
        tipoEspecialidad: medico?.tipoEspecialidad,
        historial: Array.isArray(req.body?.historial) ? req.body.historial : [],
        datos: {
          nombreMedico: medico?.nombre,
          especialidadLabel: ETIQUETA_ESPECIALIDAD[medico?.tipoEspecialidad] || "",
          pacientes, consultasMes, citasHoy, citasProximas, recordatorios,
        },
      });
      res.json({ respuesta });
    } catch (e) {
      log.error("[ASISTENTE_SYMPHOMED]", e.response?.data || e.message);
      throw new ErrorHttp(502, "No se pudo responder ahora mismo. Probá de nuevo en un momento.");
    }
  }));
};
