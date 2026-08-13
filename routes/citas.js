// ChatGo Salud — Agenda: citas manuales desde la web (las que llegan solas
// por WhatsApp usan services/reservaCitas.js) y configuración del horario
// de atención / calendario de Google del médico.
const { Medico, Paciente, Cita } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { obtenerHorariosDisponibles } = require("../services/agenda");
const { crearEvento, actualizarEvento, eliminarEvento } = require("../services/googleCalendar");
const { enviarTexto } = require("../services/baileysWhatsapp");
const { formatearFechaCompleta } = require("../services/reservaCitas");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);
const DIAS_VALIDOS = ["confirmada", "cancelada", "completada"];

module.exports = function (app) {
  // ─── HORARIO DE ATENCIÓN ─────────────────────────────────────────────────
  app.get("/medico/horario", requireMedico, asyncRoute(async (req, res) => {
    const horario = await Medico.findOne({ phone: req.adminUser.usuario })
      .select("horarioAtencion duracionConsultaMinutos googleCalendarId infoConsultorio").lean();
    res.json({ horario });
  }));

  app.patch("/medico/horario", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario });
    if (Array.isArray(req.body?.horarioAtencion)) {
      medico.horarioAtencion = req.body.horarioAtencion
        .map(h => ({ diaSemana: Number(h?.diaSemana), horaInicio: String(h?.horaInicio || ""), horaFin: String(h?.horaFin || "") }))
        .filter(h => !Number.isNaN(h.diaSemana) && h.horaInicio && h.horaFin);
    }
    if (req.body?.duracionConsultaMinutos !== undefined) {
      medico.duracionConsultaMinutos = Number(req.body.duracionConsultaMinutos) || 30;
    }
    if (req.body?.googleCalendarId !== undefined) {
      medico.googleCalendarId = String(req.body.googleCalendarId).trim();
    }
    if (req.body?.infoConsultorio !== undefined) {
      medico.infoConsultorio = String(req.body.infoConsultorio).trim();
    }
    await medico.save();
    res.json({ ok: true, horario: medico });
  }));

  // ─── HORARIOS DISPONIBLES (para armar una cita a mano desde la web) ─────
  app.get("/medico/citas/disponibilidad", requireMedico, asyncRoute(async (req, res) => {
    const dias = await obtenerHorariosDisponibles(req.adminUser.usuario, Number(req.query.dias) || 14);
    res.json({ dias });
  }));

  // ─── LISTAR CITAS EN UN RANGO ────────────────────────────────────────────
  app.get("/medico/citas", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const desde = req.query.desde ? new Date(req.query.desde) : new Date();
    const hasta = req.query.hasta ? new Date(req.query.hasta) : new Date(Date.now() + 14 * 24 * 3600000);
    const citas = await Cita.find({ medicoPhone, fecha: { $gte: desde, $lte: hasta } }).sort({ fecha: 1 }).lean();
    res.json({ citas });
  }));

  // ─── CREAR CITA A MANO ───────────────────────────────────────────────────
  app.post("/medico/citas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const fecha = req.body?.fecha ? new Date(req.body.fecha) : null;
    if (!fecha) throw new ErrorHttp(400, "fecha es requerida");

    let pacienteNombre = String(req.body?.pacienteNombre || "").trim();
    let pacienteId = null;
    if (req.body?.pacienteId) {
      const paciente = await obtenerOFallar(Paciente, { _id: req.body.pacienteId, medicoPhone }, "Paciente no encontrado");
      pacienteId = paciente._id;
      if (!pacienteNombre) pacienteNombre = paciente.nombre;
    }
    if (!pacienteNombre) throw new ErrorHttp(400, "pacienteNombre es requerido (o elegí un paciente)");

    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    const cita = await Cita.create({
      medicoPhone, pacienteId, pacienteNombre,
      pacienteTelefono: String(req.body?.pacienteTelefono || "").trim(),
      fecha, duracionMinutos: Number(req.body?.duracionMinutos) || medico?.duracionConsultaMinutos || 30,
      motivo: String(req.body?.motivo || "").trim(),
      estado: "confirmada", origen: "manual",
    });

    if (medico?.googleCalendarId) {
      const eventId = await crearEvento(medico.googleCalendarId, cita);
      if (eventId) { cita.googleEventId = eventId; await cita.save(); }
    }

    // Si se cargó un teléfono, avisamos por WhatsApp igual que cuando la
    // cita la reserva el propio paciente — no depende de por dónde se creó.
    if (cita.pacienteTelefono) {
      const primerNombre = cita.pacienteNombre.split(" ")[0];
      enviarTexto(cita.pacienteTelefono, `✅ ${primerNombre}, tu cita con ${medico?.nombre || "el consultorio"} quedó confirmada para el ${formatearFechaCompleta(cita.fecha)}. Te esperamos.\n\nSi necesitás cancelarla, escribí "cancelar" acá mismo, o avisanos directo en el consultorio.`)
        .catch(e => log.error(`[CITAS] no se pudo mandar la confirmación por WhatsApp a ${cita.pacienteTelefono}:`, e.message));
    }

    res.status(201).json({ ok: true, cita });
  }));

  // ─── CREAR FICHA DE PACIENTE A PARTIR DE UNA CITA (ej: reservó por
  // WhatsApp y todavía no tiene Kardex) ────────────────────────────────────
  // El médico revisa/corrige nombre y teléfono antes de confirmar — nunca
  // se crea nada sin que él lo vea primero. Si ya existe un paciente con
  // ese mismo teléfono, se vincula la cita a esa ficha en vez de duplicarla.
  app.post("/medico/citas/:id/crear-paciente", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const cita = await obtenerOFallar(Cita, { _id: req.params.id, medicoPhone }, "Cita no encontrada");
    if (cita.pacienteId) throw new ErrorHttp(409, "Esta cita ya tiene una ficha de paciente vinculada");

    const nombre = String(req.body?.nombre || cita.pacienteNombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "Falta el nombre del paciente");
    const telefono = String(req.body?.telefono || cita.pacienteTelefono || "").trim();

    let paciente = telefono ? await Paciente.findOne({ medicoPhone, telefono }) : null;
    let yaExistia = !!paciente;
    if (!paciente) {
      paciente = await Paciente.create({ medicoPhone, nombre, telefono });
    }

    cita.pacienteId = paciente._id;
    if (!cita.pacienteTelefono && telefono) cita.pacienteTelefono = telefono;
    await cita.save();

    registrar({ req, medicoPhone, accion: yaExistia ? "cita_vinculada_a_paciente_existente" : "paciente_creado_desde_cita", recurso: `Paciente:${paciente._id}` });
    res.status(201).json({ ok: true, paciente, yaExistia });
  }));

  // ─── EDITAR / CANCELAR CITA ──────────────────────────────────────────────
  app.patch("/medico/citas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const cita = await obtenerOFallar(Cita, { _id: req.params.id, medicoPhone }, "Cita no encontrada");

    if (req.body?.fecha !== undefined) cita.fecha = new Date(req.body.fecha);
    if (req.body?.motivo !== undefined) cita.motivo = String(req.body.motivo).trim();
    if (req.body?.estado !== undefined && DIAS_VALIDOS.includes(req.body.estado)) cita.estado = req.body.estado;
    await cita.save();

    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    if (medico?.googleCalendarId && cita.googleEventId) {
      if (cita.estado === "cancelada") await eliminarEvento(medico.googleCalendarId, cita.googleEventId);
      else await actualizarEvento(medico.googleCalendarId, cita.googleEventId, cita);
    }
    res.json({ ok: true, cita });
  }));

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/citas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const cita = await Cita.findOneAndDelete({ _id: req.params.id, medicoPhone });
    if (!cita) throw new ErrorHttp(404, "Cita no encontrada");
    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    if (medico?.googleCalendarId && cita.googleEventId) await eliminarEvento(medico.googleCalendarId, cita.googleEventId);
    res.json({ ok: true });
  }));
};
