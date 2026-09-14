// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — Armar y mantener el equipo tratante
// ═══════════════════════════════════════════════════════════════════════════
// El porqué está en db/models.js y la regla de acceso en
// services/equipoNeuro.js. Acá va lo que hace falta decir del flujo:
//
// · SIN AUTORIZACIÓN DE LA FAMILIA NO SE ARMA. Es el primer campo del
//   formulario y es obligatorio, no una casilla al final.
//
// · SE ARMA SOBRE UNA PERSONA, NO SOBRE UNA FICHA. El chico tiene que estar
//   asociado a una persona de la clínica (ver routes/personas.js): es lo
//   único que permite que dos profesionales sepan que hablan del mismo chico.
//
// · SOLO UN MIEMBRO AGREGA MIEMBROS. Ser director no alcanza, igual que en
//   todo lo demás. Y solo se puede agregar a alguien del mismo centro y de
//   la misma rama.
//
// · SALIR DEL EQUIPO NO BORRA LO QUE HIZO. Se lo saca de la lista y deja de
//   ver la ficha; lo que cargó queda, porque es parte de la historia del
//   chico y no de la cuenta del profesional.
const { Paciente, Medico, PersonaClinica, EquipoNeuro, PerfilNeuro, ObjetivoNeuro } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { esMiembro, esDeNeuro } = require("../services/equipoNeuro");

const requireMedico = requireAuth(["medico"]);

// Lo que se le manda de un equipo a un profesional. Whitelist y no el
// documento entero, por el mismo motivo que personaParaElMedico: mandar el
// documento de Mongo es cómo se filtran los campos que nadie miró.
function equipoParaElMedico(equipo, medicoPhone) {
  return {
    _id: equipo._id,
    personaId: equipo.personaId,
    pacienteIdTitular: equipo.pacienteIdTitular,
    soyTitular: equipo.medicoPhoneTitular === medicoPhone,
    // El teléfono SÍ va, al revés que en personaParaElMedico. Allá se oculta
    // porque decir quién más atiende a una persona es justo lo que no
    // corresponde saber. Acá es al revés: los miembros del equipo son colegas
    // que trabajan sobre el mismo chico con autorización de la familia, y
    // saber con quién comparte la ficha es parte de lo que tiene que ver
    // quien está adentro. Además hace falta para poder sacar a alguien.
    miembros: (equipo.miembros || []).map(m => ({
      telefono: m.medicoPhone, nombre: m.nombre, rol: m.rol, agregadoEn: m.agregadoEn,
      esTitular: m.medicoPhone === equipo.medicoPhoneTitular,
      soyYo: m.medicoPhone === medicoPhone,
    })),
    autorizacion: {
      porQuien: equipo.autorizacion?.porQuien || "",
      vinculo: equipo.autorizacion?.vinculo || "",
      fecha: equipo.autorizacion?.fecha || null,
      nota: equipo.autorizacion?.nota || "",
    },
    creadoEn: equipo.createdAt,
  };
}

// Qué tenía cargado por su cuenta la persona que se suma, para poder
// avisarlo. Devuelve null si no tenía nada, que es el caso normal.
async function loQueTeniaCargado(telefono, personaId) {
  const suya = await Paciente.findOne({ medicoPhone: telefono, personaId }).select("_id").lean();
  if (!suya) return null;
  const [perfil, objetivos] = await Promise.all([
    PerfilNeuro.exists({ pacienteId: suya._id, medicoPhone: telefono }),
    ObjetivoNeuro.countDocuments({ pacienteId: suya._id, medicoPhone: telefono }),
  ]);
  if (!perfil && !objetivos) return null;
  return { perfil: Boolean(perfil), objetivos };
}

// El centro del profesional sale SIEMPRE de su cuenta, nunca del pedido: si
// viniera del cliente, cualquiera armaría equipos en otro centro cambiando
// un parámetro. Mismo criterio que clinicaDelMedico en routes/personas.js.
async function contextoDe(medicoPhone) {
  const m = await Medico.findOne({ phone: medicoPhone }).select("clinicaId tipoEspecialidad nombre especialidad").lean();
  return m || null;
}

module.exports = function (app) {
  // ─── VER EL EQUIPO DE UN CHICO ───────────────────────────────────────────
  app.get("/medico/pacientes/:pacienteId/equipo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await Paciente.findOne({ _id: req.params.pacienteId, medicoPhone }).select("personaId").lean();
    // Puede estar entrando por la ficha titular de un equipo del que es
    // miembro, y entonces el paciente no es "suyo".
    const equipo = paciente?.personaId
      ? await EquipoNeuro.findOne({ personaId: paciente.personaId, activo: true }).lean()
      : await EquipoNeuro.findOne({ pacienteIdTitular: req.params.pacienteId, activo: true }).lean();

    if (!equipo) {
      if (!paciente) throw new ErrorHttp(404, "Paciente no encontrado");
      return res.json({ equipo: null, tienePersona: Boolean(paciente.personaId) });
    }
    if (!esMiembro(equipo, medicoPhone)) throw new ErrorHttp(404, "Paciente no encontrado");
    res.json({ equipo: equipoParaElMedico(equipo, medicoPhone), tienePersona: true });
  }));

  // ─── ARMARLO ─────────────────────────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/equipo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const yo = await contextoDe(medicoPhone);
    if (yo?.tipoEspecialidad !== "neurodesarrollo") {
      // No es un permiso que se pueda pedir: la ficha compartida es una regla
      // de esta rama y en las demás manda la interconsulta.
      throw new ErrorHttp(400, "La ficha compartida del equipo existe solo en Symphomed Neurodesarrollo.");
    }
    if (!yo.clinicaId) {
      throw new ErrorHttp(400, "Para armar un equipo la cuenta tiene que estar dentro de un centro.");
    }

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    if (!paciente.personaId) {
      // Sin la persona compartida no hay forma de que otro profesional sepa
      // que su Leonardo Aguilar y este son el mismo chico.
      throw new ErrorHttp(400,
        "Antes de armar el equipo hay que asociar la ficha a una persona del centro, " +
        "en la pestaña Paciente. Es lo que permite que los demás sepan que hablan del mismo chico.");
    }
    const persona = await PersonaClinica.findOne({ _id: paciente.personaId, clinicaId: yo.clinicaId }).lean();
    if (!persona) throw new ErrorHttp(400, "Esa persona no es de este centro.");

    const a = req.body?.autorizacion || {};
    const porQuien = String(a.porQuien || "").trim().slice(0, 120);
    const vinculo = String(a.vinculo || "").trim().slice(0, 60);
    const fecha = a.fecha ? new Date(a.fecha) : new Date();
    if (!porQuien) {
      throw new ErrorHttp(400,
        "Falta quién de la familia autorizó a compartir la ficha. Sin eso el equipo no se arma: " +
        "compartir la ficha de un chico es una decisión de su familia, no del centro.");
    }
    if (isNaN(fecha.getTime())) throw new ErrorHttp(400, "La fecha de la autorización no es válida");
    if (fecha.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new ErrorHttp(400, "La fecha de la autorización está en el futuro");

    const yaHay = await EquipoNeuro.findOne({ personaId: persona._id }).lean();
    if (yaHay) {
      if (!esMiembro(yaHay, medicoPhone)) throw new ErrorHttp(404, "Paciente no encontrado");
      throw new ErrorHttp(409, "Este chico ya tiene un equipo armado.");
    }

    const equipo = await EquipoNeuro.create({
      clinicaId: yo.clinicaId,
      personaId: persona._id,
      pacienteIdTitular: paciente._id,
      medicoPhoneTitular: medicoPhone,
      miembros: [{
        medicoPhone, nombre: yo.nombre || "", rol: String(req.body?.rol || yo.especialidad || "").trim().slice(0, 60),
        agregadoPor: medicoPhone,
      }],
      autorizacion: { porQuien, vinculo, fecha, registradaPor: medicoPhone, nota: String(a.nota || "").trim().slice(0, 500) },
    });

    registrar({ req, medicoPhone, accion: "crear_equipo_neuro", recurso: `EquipoNeuro:${equipo._id}`,
      detalle: `autoriza:${porQuien}${vinculo ? ` (${vinculo})` : ""}` });
    res.status(201).json({ ok: true, equipo: equipoParaElMedico(equipo, medicoPhone) });
  }));

  // ─── SUMAR A UN COLEGA ───────────────────────────────────────────────────
  app.post("/medico/equipos/:id/miembros", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const equipo = await EquipoNeuro.findOne({ _id: req.params.id, activo: true });
    // 404 y no 403: decir "no tenés permiso" confirmaría que ese equipo
    // existe, y con eso se puede averiguar si un chico se atiende acá.
    if (!equipo || !esMiembro(equipo, medicoPhone)) throw new ErrorHttp(404, "Equipo no encontrado");

    const telefono = String(req.body?.telefono || "").replace(/\D/g, "");
    if (!telefono) throw new ErrorHttp(400, "¿A quién sumamos? Poné su teléfono de Symphomed.");
    if (telefono === medicoPhone || esMiembro(equipo, telefono)) {
      throw new ErrorHttp(409, "Esa persona ya está en el equipo.");
    }

    const colega = await Medico.findOne({ phone: telefono, activo: true }).select("nombre especialidad clinicaId tipoEspecialidad").lean();
    // Mismo mensaje para "no existe" y "no es de este centro": si fueran
    // distintos, probar teléfonos diría quién tiene cuenta en Symphomed.
    const sirve = colega
      && String(colega.clinicaId || "") === String(equipo.clinicaId)
      && colega.tipoEspecialidad === "neurodesarrollo";
    if (!sirve) {
      throw new ErrorHttp(404, "No encontramos a ningún profesional de neurodesarrollo de este centro con ese número.");
    }

    equipo.miembros.push({
      medicoPhone: telefono,
      nombre: colega.nombre || "",
      rol: String(req.body?.rol || colega.especialidad || "").trim().slice(0, 60),
      agregadoPor: medicoPhone,
    });
    await equipo.save();

    registrar({ req, medicoPhone, accion: "sumar_al_equipo_neuro", recurso: `EquipoNeuro:${equipo._id}`,
      detalle: `suma:${telefono}` });

    // ═══ LO QUE ESTA PERSONA TENÍA CARGADO POR SU CUENTA ══════════════════
    //
    // Si la colega ya venía atendiendo a este chico, tiene su propio perfil y
    // sus propios objetivos en SU ficha. Desde ahora trabaja sobre la titular,
    // así que eso deja de verse — no se borra, pero deja de estar a la vista,
    // que desde su silla es lo mismo hasta que alguien se lo explica.
    //
    // No se copia nada: fusionar dos perfiles sensoriales automáticamente es
    // decidir cuál gana, y esa decisión no la puede tomar el sistema. Se dice
    // que existe y cuánto hay, y el equipo resuelve qué hacer.
    res.json({
      ok: true,
      equipo: equipoParaElMedico(equipo, medicoPhone),
      traeFichaPropia: await loQueTeniaCargado(telefono, equipo.personaId),
    });
  }));

  // ─── SACAR A ALGUIEN ─────────────────────────────────────────────────────
  app.delete("/medico/equipos/:id/miembros/:telefono", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const equipo = await EquipoNeuro.findOne({ _id: req.params.id, activo: true });
    if (!equipo || !esMiembro(equipo, medicoPhone)) throw new ErrorHttp(404, "Equipo no encontrado");

    const telefono = String(req.params.telefono || "").replace(/\D/g, "");
    if (telefono === equipo.medicoPhoneTitular) {
      // La ficha es suya: sacarlo dejaría un equipo trabajando sobre una
      // ficha de alguien que no lo integra. Si se va del centro, lo que
      // corresponde es cerrar el equipo, no dejarlo huérfano.
      throw new ErrorHttp(409,
        "No se puede sacar a quien tiene la ficha. Si esta persona deja de atender al chico, " +
        "cerrá el equipo y que lo arme quien siga a cargo.");
    }
    const antes = equipo.miembros.length;
    equipo.miembros = equipo.miembros.filter(m => m.medicoPhone !== telefono);
    if (equipo.miembros.length === antes) throw new ErrorHttp(404, "Esa persona no está en el equipo.");
    await equipo.save();

    // Lo que cargó NO se borra: es parte de la historia del chico, no de la
    // cuenta del profesional. Deja de ver la ficha y nada más.
    registrar({ req, medicoPhone, accion: "sacar_del_equipo_neuro", recurso: `EquipoNeuro:${equipo._id}`,
      detalle: `saca:${telefono}` });
    res.json({ ok: true, equipo: equipoParaElMedico(equipo, medicoPhone) });
  }));

  // ─── CERRARLO ────────────────────────────────────────────────────────────
  // Cuando la familia retira la autorización, o el chico deja el centro.
  app.delete("/medico/equipos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const equipo = await EquipoNeuro.findOne({ _id: req.params.id, activo: true });
    if (!equipo || !esMiembro(equipo, medicoPhone)) throw new ErrorHttp(404, "Equipo no encontrado");

    // Se marca inactivo, no se borra. Borrarlo destruiría el registro de que
    // la familia autorizó y de quién entró a la ficha mientras duró — que es
    // justamente lo que hay que conservar.
    equipo.activo = false;
    await equipo.save();
    registrar({ req, medicoPhone, accion: "cerrar_equipo_neuro", recurso: `EquipoNeuro:${equipo._id}` });
    res.json({ ok: true });
  }));

  // ─── LOS CHICOS QUE COMPARTO ─────────────────────────────────────────────
  // La lista de pacientes de siempre muestra los propios. Esta trae los que
  // el profesional ve por estar en un equipo, y va aparte a propósito:
  // mezclarlos escondería que la ficha es de otro.
  app.get("/medico/equipos/compartidos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const { neuro, clinicaId } = await esDeNeuro(medicoPhone);
    if (!neuro || !clinicaId) return res.json({ pacientes: [] });

    const equipos = await EquipoNeuro.find({
      clinicaId, activo: true, "miembros.medicoPhone": medicoPhone,
      medicoPhoneTitular: { $ne: medicoPhone },   // los propios ya salen en la lista normal
    }).lean();
    if (!equipos.length) return res.json({ pacientes: [] });

    const fichas = await Paciente.find({ _id: { $in: equipos.map(e => e.pacienteIdTitular) } })
      .select("_id nombre codigo fechaNacimiento").lean();
    const porId = new Map(fichas.map(f => [String(f._id), f]));

    res.json({
      pacientes: equipos.map(e => {
        const f = porId.get(String(e.pacienteIdTitular));
        return {
          _id: e.pacienteIdTitular,
          nombre: f?.nombre || "",
          codigo: f?.codigo || "",
          fechaNacimiento: f?.fechaNacimiento || null,
          equipoId: e._id,
          miembros: (e.miembros || []).length,
        };
      }).filter(p => p.nombre),
    });
  }));
};
