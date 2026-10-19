// ChatGo Salud — Agenda: citas manuales desde la web (las que llegan solas
// por WhatsApp usan services/reservaCitas.js) y configuración del horario
// de atención / calendario de Google del médico.
const { Medico, Paciente, Cita } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { obtenerHorariosDisponibles, horarioSigueLibre, franjaValida, duracionValida, duracionDe, DURACION_MIN, DURACION_MAX, FRANJAS_MAX } = require("../services/agenda");
const { localAInstante, ZONA_POR_DEFECTO } = require("../services/zonaHoraria");

// La zona en la que trabaja esta cuenta. Se pregunta a la base y no se
// asume: era un desfase fijo de −4h, y a un médico brasileño le guardaba
// cada turno una hora corrido. Ver services/zonaHoraria.js.
async function zonaDe(medicoPhone) {
  const m = await Medico.findOne({ phone: medicoPhone }).select("zonaHoraria").lean();
  return m?.zonaHoraria || ZONA_POR_DEFECTO;
}
const { crearEvento, actualizarEvento, eliminarEvento } = require("../services/googleCalendar");
const { enviarTextoOPlantilla, PLANTILLAS } = require("../services/metaWhatsapp");
const { formatearFechaCompleta } = require("../services/reservaCitas");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);
const DIAS_VALIDOS = ["confirmada", "cancelada", "completada"];
const SE_SUPERPONE = "Ese horario se superpone con otra cita confirmada o con tu Google Calendar.";

// ─── AVISOS AL PACIENTE CUANDO EL CONSULTORIO CAMBIA SU CITA ─────────────
// Antes mover o cancelar una cita desde el panel no le avisaba nada al
// paciente, que seguía yendo a la hora vieja (auditoría del comité de QA,
// octubre de 2026, M4). Van sin await y con su propio catch: un WhatsApp
// caído no puede deshacer un cambio de agenda que ya quedó guardado.
function avisarCambio(cita, medico) {
  const primerNombre = String(cita.pacienteNombre || "").split(" ")[0];
  const quien = medico?.nombre || "el consultorio";
  const cuando = formatearFechaCompleta(cita.fecha, medico?.zonaHoraria);
  enviarTextoOPlantilla(cita.pacienteTelefono,
    `🔁 ${primerNombre}, su cita con ${quien} se cambió para el ${cuando}. Le esperamos.\n\nSi necesita cambiarla o cancelarla, avísenos directo en el consultorio.`,
    // Fuera de la ventana de 24 h sale la de cita confirmada, con la fecha
    // nueva: dice lo que importa, cuándo tiene que ir.
    { plantilla: PLANTILLAS.citaConfirmada, parametros: [primerNombre, quien, cuando], idioma: medico?.idioma })
    .catch(e => log.error(`[CITAS] no se pudo avisar el cambio por WhatsApp a ${cita.pacienteTelefono}:`, e.message));
}
function avisarCancelacion(cita, fecha, medico) {
  const primerNombre = String(cita.pacienteNombre || "").split(" ")[0];
  const quien = medico?.nombre || "el consultorio";
  const cuando = formatearFechaCompleta(fecha, medico?.zonaHoraria);
  enviarTextoOPlantilla(cita.pacienteTelefono,
    `❌ ${primerNombre}, su cita con ${quien} del ${cuando} fue cancelada por el consultorio. Si desea una nueva cita, responda a este mensaje.`,
    { plantilla: PLANTILLAS.citaCancelada, parametros: [primerNombre, quien, cuando], idioma: medico?.idioma })
    .catch(e => log.error(`[CITAS] no se pudo avisar la cancelación por WhatsApp a ${cita.pacienteTelefono}:`, e.message));
}

module.exports = function (app) {
  // ─── HORARIO DE ATENCIÓN ─────────────────────────────────────────────────
  app.get("/medico/horario", requireMedico, asyncRoute(async (req, res) => {
    const horario = await Medico.findOne({ phone: req.adminUser.usuario })
      .select("horarioAtencion duracionConsultaMinutos googleCalendarId infoConsultorio").lean();
    res.json({ horario });
  }));

  // Con una duración imposible o un horario mal formado, el cálculo de
  // horarios libres colgaba el servidor entero (services/agenda.js, S07): se
  // rechaza acá, con el motivo, antes de guardarlo.
  app.patch("/medico/horario", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario });
    if (Array.isArray(req.body?.horarioAtencion)) {
      // Una fila sin horas es un día que no se marcó: se deja afuera, como
      // siempre. Una con horas que no son horas, o que termina antes de
      // empezar, es un error de carga y se dice.
      const franjas = req.body.horarioAtencion
        .map(h => ({ diaSemana: Number(h?.diaSemana), horaInicio: String(h?.horaInicio || ""), horaFin: String(h?.horaFin || "") }))
        .filter(h => h.horaInicio && h.horaFin);
      // La regla es la misma con la que se arman los horarios
      // (services/agenda.js, franjaValida).
      const mal = franjas.find(h => !franjaValida(h));
      if (mal || franjas.length > FRANJAS_MAX) {
        throw new ErrorHttp(400, "Revisá el horario: cada día necesita una hora de inicio y una de fin (HH:MM), y el fin después del inicio.");
      }
      medico.horarioAtencion = franjas;
    }
    const duracion = req.body?.duracionConsultaMinutos;
    if (duracion !== undefined && duracion !== null && duracion !== "") {
      if (!duracionValida(duracion)) {
        throw new ErrorHttp(400, `La duración de cada consulta tiene que ser de ${DURACION_MIN} a ${DURACION_MAX} minutos.`);
      }
      medico.duracionConsultaMinutos = duracionValida(duracion);
    }
    if (req.body?.googleCalendarId !== undefined) {
      medico.googleCalendarId = String(req.body.googleCalendarId).trim();
    }
    if (req.body?.infoConsultorio !== undefined) {
      medico.infoConsultorio = String(req.body.infoConsultorio).trim();
    }
    await medico.save();
    // Lo del horario, como el GET de arriba: el documento entero traía la
    // contraseña cifrada y el secreto del segundo factor.
    const { horarioAtencion, duracionConsultaMinutos, googleCalendarId, infoConsultorio } = medico.toObject();
    res.json({ ok: true, horario: { horarioAtencion, duracionConsultaMinutos, googleCalendarId, infoConsultorio } });
  }));

  // ─── HORARIOS DISPONIBLES (para armar una cita a mano desde la web) ─────
  // Con limitMedico, como las que escriben en la agenda: de todas, es la que
  // más le cuesta al servidor.
  app.get("/medico/citas/disponibilidad", limitMedico, requireMedico, asyncRoute(async (req, res) => {
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
    // Viene de un <input type="datetime-local"> ("YYYY-MM-DDTHH:mm", sin
    // timezone) — el médico lo tipeó pensando en SU hora de pared, no en la
    // del server (que en producción corre en UTC). Un new Date(...) directo
    // lo interpretaría como hora del server y correría la cita varias horas.
    const zona = await zonaDe(medicoPhone);
    const fecha = req.body?.fecha ? localAInstante(zona, req.body.fecha) : null;
    if (!fecha || isNaN(fecha.getTime())) throw new ErrorHttp(400, "fecha es requerida");

    let pacienteNombre = String(req.body?.pacienteNombre || "").trim();
    let pacienteId = null;
    if (req.body?.pacienteId) {
      const paciente = await obtenerOFallar(Paciente, { _id: req.body.pacienteId, medicoPhone }, "Paciente no encontrado");
      pacienteId = paciente._id;
      if (!pacienteNombre) pacienteNombre = paciente.nombre;
    }
    if (!pacienteNombre) throw new ErrorHttp(400, "pacienteNombre es requerido (o elegí un paciente)");

    const pedida = req.body?.duracionMinutos;
    if (pedida !== undefined && pedida !== null && pedida !== "" && !duracionValida(pedida)) {
      throw new ErrorHttp(400, `La duración de la cita tiene que ser de ${DURACION_MIN} a ${DURACION_MAX} minutos.`);
    }
    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    const duracionMinutos = duracionValida(pedida) || duracionDe(medico?.duracionConsultaMinutos);
    // Las citas a mano no revisaban nada: dos solapadas (10:00 y 10:15) se
    // guardaban las dos, y dos a la misma hora exacta daban un 500 (M4). Se
    // mira lo mismo que en la reserva del paciente —las otras citas
    // confirmadas y el Google Calendar del médico—, y el índice único de Cita
    // sigue frenando dos pedidos a la misma hora exacta. Dos solapados pero no
    // iguales que lleguen en el mismo instante pasan los dos: es la agenda de
    // un solo médico cargada a mano, y se acepta.
    if (!(await horarioSigueLibre(medicoPhone, fecha, duracionMinutos))) throw new ErrorHttp(409, SE_SUPERPONE);
    let cita;
    try {
      cita = await Cita.create({
        medicoPhone, pacienteId, pacienteNombre,
        pacienteTelefono: String(req.body?.pacienteTelefono || "").trim(),
        fecha, duracionMinutos,
        motivo: String(req.body?.motivo || "").trim(),
        estado: "confirmada", origen: "manual",
      });
    } catch (e) {
      if (e?.code === 11000) throw new ErrorHttp(409, SE_SUPERPONE);
      throw e;
    }

    let avisoCalendario = null;
    if (medico?.googleCalendarId) {
      const eventId = await crearEvento(medico.googleCalendarId, cita);
      if (eventId) { cita.googleEventId = eventId; await cita.save(); }
      else avisoCalendario = "La cita se guardó bien en Symphomed, pero no se pudo crear en Google Calendar.";
    }

    // Si se cargó un teléfono, avisamos por WhatsApp igual que cuando la
    // cita la reserva el propio paciente — no depende de por dónde se creó.
    if (cita.pacienteTelefono) {
      const primerNombre = cita.pacienteNombre.split(" ")[0];
      // Este es EL caso que más se cae fuera de la ventana de 24 h: la cita la
      // cargó el médico en su panel, así que el paciente puede no haberle
      // escrito nunca al WhatsApp del consultorio. Sin la plantilla de
      // respaldo, no recibía nada y el médico veía "cita creada ✓".
      const cuando = formatearFechaCompleta(cita.fecha, zona);
      const quien = medico?.nombre || "el consultorio";
      enviarTextoOPlantilla(cita.pacienteTelefono,
        `✅ ${primerNombre}, su cita con ${quien} quedó confirmada para el ${cuando}. Le esperamos.\n\nSi necesita cancelarla, responda "cancelar" a este mensaje, o avísenos directo en el consultorio.`,
        { plantilla: PLANTILLAS.citaConfirmada, parametros: [primerNombre, quien, cuando], idioma: medico?.idioma })
        .catch(e => log.error(`[CITAS] no se pudo mandar la confirmación por WhatsApp a ${cita.pacienteTelefono}:`, e.message));
    }

    res.status(201).json({ ok: true, cita, avisoCalendario });
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

    const fechaAntes = new Date(cita.fecha);
    const estadoAntes = cita.estado;
    if (req.body?.fecha !== undefined) {
      const fecha = localAInstante(await zonaDe(medicoPhone), req.body.fecha);
      // Sin esto, una fecha que no es fecha llegaba a la base y volvía un 500.
      if (isNaN(fecha.getTime())) throw new ErrorHttp(400, "Fecha inválida");
      cita.fecha = fecha;
    }
    if (req.body?.motivo !== undefined) cita.motivo = String(req.body.motivo).trim();
    if (req.body?.estado !== undefined) {
      // Antes un estado que no existe se ignoraba en silencio y respondía ok.
      if (!DIAS_VALIDOS.includes(req.body.estado)) throw new ErrorHttp(400, "Estado inválido");
      cita.estado = req.body.estado;
    }
    // Moverla, o volver a confirmar una cancelada, puede pisar otra (M4).
    const cambioHorario = cita.fecha.getTime() !== fechaAntes.getTime();
    if (cita.estado === "confirmada" && (cambioHorario || estadoAntes !== "confirmada")) {
      const suEvento = estadoAntes === "confirmada" && cita.googleEventId
        ? { desde: fechaAntes, hasta: new Date(fechaAntes.getTime() + duracionDe(cita.duracionMinutos) * 60000) }
        : {};
      if (!(await horarioSigueLibre(medicoPhone, cita.fecha, cita.duracionMinutos, { citaId: cita._id, ...suEvento }))) {
        throw new ErrorHttp(409, SE_SUPERPONE);
      }
    }
    try {
      await cita.save();
    } catch (e) {
      if (e?.code === 11000) throw new ErrorHttp(409, SE_SUPERPONE);
      throw e;
    }

    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    if (cita.pacienteTelefono) {
      if (cita.estado === "confirmada" && cambioHorario && cita.fecha.getTime() > Date.now()) avisarCambio(cita, medico);
      else if (cita.estado === "cancelada" && estadoAntes === "confirmada" && fechaAntes.getTime() > Date.now()) avisarCancelacion(cita, fechaAntes, medico);
    }
    // El calendario es un espejo (no la fuente de verdad, ver
    // services/googleCalendar.js) — si esto falla la cita en Symphomed ya
    // quedó bien guardada igual, pero antes el médico nunca se enteraba: el
    // evento viejo seguía "ocupando" ese horario en Google Calendar para
    // siempre. Se avisa en la respuesta para que lo revise a mano ahí.
    let avisoCalendario = null;
    if (medico?.googleCalendarId && cita.googleEventId) {
      const sincronizo = cita.estado === "cancelada"
        ? await eliminarEvento(medico.googleCalendarId, cita.googleEventId)
        : await actualizarEvento(medico.googleCalendarId, cita.googleEventId, cita);
      if (!sincronizo) avisoCalendario = "La cita se guardó bien en Symphomed, pero no se pudo actualizar en Google Calendar — revisalo ahí a mano.";
    }
    res.json({ ok: true, cita, avisoCalendario });
  }));

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/citas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const cita = await Cita.findOneAndDelete({ _id: req.params.id, medicoPhone });
    if (!cita) throw new ErrorHttp(404, "Cita no encontrada");
    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    // Borrar una cita que el paciente tiene por delante también es
    // cancelársela, y se entera igual.
    if (cita.pacienteTelefono && cita.estado === "confirmada" && new Date(cita.fecha).getTime() > Date.now()) {
      avisarCancelacion(cita, cita.fecha, medico);
    }
    let avisoCalendario = null;
    if (medico?.googleCalendarId && cita.googleEventId) {
      const sincronizo = await eliminarEvento(medico.googleCalendarId, cita.googleEventId);
      if (!sincronizo) avisoCalendario = "La cita se borró de Symphomed, pero no se pudo borrar en Google Calendar — revisalo ahí a mano.";
    }
    res.json({ ok: true, avisoCalendario });
  }));
};
