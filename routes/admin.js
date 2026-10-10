// Symphomed — Panel de clínica: varios consultorios, una sola vista de arriba.
//
// ═══ LO QUE ESTE ARCHIVO NO HACE ═══════════════════════════════════════════
//
// No devuelve una sola línea de historia clínica. Ni transcripciones, ni
// notas, ni diagnósticos, ni recetas, ni fotos, ni motivos de consulta.
// Cuenta consultas; no las lee.
//
// La única excepción es el nombre del paciente en la agenda del día, y solo
// de los médicos EMPLEADOS: quien recibe en la puerta necesita saber a quién
// espera. Un nombre y una hora son identidad y asistencia, no historia
// clínica — el POR QUÉ viene no aparece para nadie. Ver /admin/agenda, donde
// está escrita la regla completa.
//
// No es una limitación que no tuvimos ganas de resolver: un administrativo no
// es médico y no tiene por qué leer la consulta de un paciente. Si mañana
// alguien necesita que el director vea la ficha de un colega, eso es una
// interconsulta —con motivo y auditada— y no un permiso general del panel.
//
// La forma de garantizarlo es estructural, no una lista de cuidados: las
// consultas de acá abajo usan .countDocuments() y .aggregate() con $group.
// Ninguna hace .find() sobre una colección clínica. Si alguna vez hace falta
// una, que sea con una razón escrita al lado.
//
// ═══ EMPLEADO vs. ALQUILA ══════════════════════════════════════════════════
//
// Un médico que ALQUILA el consultorio factura por su cuenta: esa plata no
// es de la clínica y el panel no la muestra. De él se ve que usó la sala
// (cuántas consultas, qué días), que es lo que la clínica sí necesita saber
// para cobrar el alquiler y repartir horarios.
const express = require("express");
const mongoose = require("mongoose");
const { Clinica, Medico, Paciente, ConsultaMedica, Cita, TratamientoPlan, EquipoRayos } = require("../db/models");
const { requireAdmin } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

// Los teléfonos de los médicos de ESTA clínica. Todo lo demás se filtra por
// esta lista: el clinicaId sale del token (ver requireAdmin), nunca del
// cliente, así que un admin no puede pedir los números de otra clínica ni
// cambiando el pedido a mano.
//
// Sin la cuenta administrativa (rol "admin"): no atiende, no tiene consultorio
// ni pacientes. Con ella adentro, el panel contaba un consultorio de más
// («5 consultorios» en una clínica de 4) y la mostraba en la tabla como si
// fuera un médico. Un director (rol "director") sí atiende, y entra.
async function medicosDeLaClinica(clinicaId) {
  return Medico.find({ clinicaId, activo: true, rol: { $ne: "admin" } })
    .select("phone nombre especialidad tipoEspecialidad rol vinculo consultorio idioma createdAt")
    .sort({ nombre: 1 })
    .lean();
}

// Qué se manda de una cita al panel, según el vínculo del médico. Es UNA
// decisión y vive en UN lugar, aparte de la ruta, para poder probarla de
// verdad en vez de mirar el código y confiar: si mañana alguien agrega un
// campo a la respuesta, la prueba lo ve. Ver probar_permisos_clinica.js.
//
// El motivo y el teléfono no están acá ni condicionados: no existen en la
// salida, para nadie.
function citaParaElPanel(cita, vinculo) {
  return {
    fecha: cita.fecha,
    duracionMinutos: cita.duracionMinutos || 30,
    estado: cita.estado,
    // null, no "" — que quede claro en la respuesta que se oculta a
    // propósito, y no que la cita vino sin nombre.
    paciente: vinculo === "empleado" ? cita.pacienteNombre : null,
  };
}

function inicioDeMes(mesesAtras = 0) {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - mesesAtras);
  return d;
}

module.exports = function (app) {
  // ─── QUÉ CLÍNICA ES ─────────────────────────────────────────────────────
  app.get("/admin/clinica", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const clinica = await Clinica.findById(req.clinicaId).lean();
    if (!clinica) throw new ErrorHttp(404, "Clínica no encontrada");
    const medicos = await medicosDeLaClinica(req.clinicaId);
    res.json({ clinica, medicos });
  }));

  // ─── RESUMEN: ACTIVIDAD POR MÉDICO ──────────────────────────────────────
  // Cuántas consultas hizo cada uno y cuántos pacientes tiene. Números, no
  // contenido: countDocuments no puede devolver una nota clínica ni queriendo.
  app.get("/admin/resumen", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const medicos = await medicosDeLaClinica(req.clinicaId);
    const telefonos = medicos.map(m => m.phone);
    if (telefonos.length === 0) return res.json({ medicos: [], totales: { consultasMes: 0, pacientes: 0, citasHoy: 0 } });

    const desdeMes = inicioDeMes();
    const desde6 = inicioDeMes(5);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);

    const [porMedicoConsultas, porMedicoPacientes, porMedicoCitasHoy, porMes] = await Promise.all([
      ConsultaMedica.aggregate([
        { $match: { medicoPhone: { $in: telefonos }, createdAt: { $gte: desdeMes } } },
        { $group: { _id: "$medicoPhone", n: { $sum: 1 } } },
      ]),
      Paciente.aggregate([
        { $match: { medicoPhone: { $in: telefonos } } },
        { $group: { _id: "$medicoPhone", n: { $sum: 1 } } },
      ]),
      Cita.aggregate([
        { $match: { medicoPhone: { $in: telefonos }, estado: "confirmada", fecha: { $gte: hoy, $lt: manana } } },
        { $group: { _id: "$medicoPhone", n: { $sum: 1 } } },
      ]),
      ConsultaMedica.aggregate([
        { $match: { medicoPhone: { $in: telefonos }, createdAt: { $gte: desde6 } } },
        { $group: {
            _id: { mes: { $dateToString: { format: "%Y-%m", date: "$createdAt" } } },
            n: { $sum: 1 },
        } },
      ]),
    ]);

    const mapa = (filas) => Object.fromEntries(filas.map(f => [f._id, f.n]));
    const consultas = mapa(porMedicoConsultas);
    const pacientes = mapa(porMedicoPacientes);
    const citasHoy = mapa(porMedicoCitasHoy);

    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "admin_resumen_clinica", recurso: `Clinica:${req.clinicaId}` });

    res.json({
      medicos: medicos.map(m => ({
        phone: m.phone, nombre: m.nombre, especialidad: m.especialidad,
        tipoEspecialidad: m.tipoEspecialidad, rol: m.rol, vinculo: m.vinculo,
        consultorio: m.consultorio, idioma: m.idioma,
        consultasMes: consultas[m.phone] || 0,
        pacientes: pacientes[m.phone] || 0,
        citasHoy: citasHoy[m.phone] || 0,
      })),
      consultasPorMes: Object.fromEntries(porMes.map(f => [f._id.mes, f.n])),
      totales: {
        consultasMes: Object.values(consultas).reduce((a, b) => a + b, 0),
        pacientes: Object.values(pacientes).reduce((a, b) => a + b, 0),
        citasHoy: Object.values(citasHoy).reduce((a, b) => a + b, 0),
      },
    });
  }));

  // ─── OCUPACIÓN DE LAS SALAS ─────────────────────────────────────────────
  // Qué consultorio se está usando y cuál está libre. Es lo único que la
  // clínica necesita saber de un médico que alquila, y sirve igual para uno
  // en relación de dependencia.
  app.get("/admin/ocupacion", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const dias = Math.min(30, Math.max(1, Number(req.query.dias) || 7));
    const medicos = await medicosDeLaClinica(req.clinicaId);
    const telefonos = medicos.map(m => m.phone);
    const desde = new Date(); desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + dias);

    const filas = telefonos.length ? await Cita.aggregate([
      { $match: { medicoPhone: { $in: telefonos }, estado: "confirmada", fecha: { $gte: desde, $lt: hasta } } },
      { $group: {
          _id: { medico: "$medicoPhone", dia: { $dateToString: { format: "%Y-%m-%d", date: "$fecha" } } },
          n: { $sum: 1 },
      } },
    ]) : [];

    const porMedico = {};
    for (const f of filas) {
      (porMedico[f._id.medico] = porMedico[f._id.medico] || {})[f._id.dia] = f.n;
    }
    res.json({
      dias,
      salas: medicos.map(m => ({
        phone: m.phone, nombre: m.nombre,
        consultorio: m.consultorio || "", vinculo: m.vinculo,
        porDia: porMedico[m.phone] || {},
      })),
    });
  }));

  // ─── AGENDA DEL DÍA, LOS SIETE CONSULTORIOS JUNTOS ──────────────────────
  //
  // Lo que /admin/ocupacion da en números —cuántas citas por sala por día—
  // acá se abre a las horas. Es la pantalla que mira quien atiende la puerta.
  //
  // QUÉ SE VE Y QUÉ NO, y por qué está partido así:
  //
  //   • El MOTIVO no viaja nunca, para ningún médico. Es texto que escribe el
  //     paciente al reservar y suele ser clínico ("dolor de pecho"). El select
  //     de abajo lo deja afuera a propósito, para que agregar un campo al
  //     modelo mañana no lo cuele solo.
  //   • El TELÉFONO tampoco: llamar al paciente de otro médico no es tarea de
  //     la administración.
  //   • El NOMBRE viaja solo si el médico es EMPLEADO. La clínica lo recibe en
  //     la puerta, le abre la ficha, le cobra: ya sabe quién es.
  //   • Si el médico ALQUILA, la hora aparece ocupada y sin nombre. Sus
  //     pacientes son suyos; la clínica le alquila una sala, no le administra
  //     la consulta. Es la misma línea que ya separa /admin/finanzas.
  //
  // La hora se manda en ISO y la formatea el navegador en su propia zona. Para
  // un mostrador que está físicamente en la clínica eso da la hora correcta
  // sin que haya que configurar nada. (Lo que antes estaba anotado acá como
  // pendiente —America/La_Paz escrito a mano en el resto del sistema— ya está
  // resuelto: cada cuenta guarda su zona. Ver services/zonaHoraria.js.)
  app.get("/admin/agenda", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const medicos = await medicosDeLaClinica(req.clinicaId);
    const telefonos = medicos.map(m => m.phone);

    // La fecha llega como YYYY-MM-DD y se interpreta en la zona del servidor,
    // igual que el resto de la agenda. Cualquier cosa que no tenga esa forma
    // exacta es hoy: un query manoseado no puede hacer que la consulta
    // devuelva un rango raro.
    const pedida = String(req.query.fecha || "");
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(pedida)
      ? new Date(`${pedida}T00:00:00`)
      : new Date();
    if (Number.isNaN(desde.getTime())) throw new ErrorHttp(400, "Fecha inválida");
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1);

    // Este .find() es sobre Cita, que es una reserva —quién viene y cuándo—,
    // no una consulta. La regla de "acá no se lee contenido clínico" sigue en
    // pie: lo que la haría cierta o falsa es el select, y el select está
    // cerrado a mano.
    const citas = telefonos.length ? await Cita.find({
      medicoPhone: { $in: telefonos },
      estado: { $in: ["confirmada", "completada"] },
      fecha: { $gte: desde, $lt: hasta },
    })
      .select("medicoPhone fecha duracionMinutos estado pacienteNombre")
      .sort({ fecha: 1 })
      .lean() : [];

    const porMedico = {};
    for (const c of citas) (porMedico[c.medicoPhone] = porMedico[c.medicoPhone] || []).push(c);

    const salas = medicos.map(m => ({
      phone: m.phone, nombre: m.nombre,
      consultorio: m.consultorio || "", vinculo: m.vinculo,
      especialidad: m.especialidad, tipoEspecialidad: m.tipoEspecialidad,
      citas: (porMedico[m.phone] || []).map(c => citaParaElPanel(c, m.vinculo)),
    }));

    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "admin_agenda_clinica", recurso: `Clinica:${req.clinicaId}` });

    res.json({
      fecha: `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`,
      salas,
      total: citas.length,
      // Para poder decirlo en pantalla en vez de que el administrador crea
      // que faltan citas: son horas ocupadas sin nombre, no huecos.
      salasSinNombre: salas.filter(s => s.vinculo === "alquila" && s.citas.length).length,
    });
  }));

  // ─── FACTURACIÓN ────────────────────────────────────────────────────────
  // Solo de los médicos EMPLEADOS. El que alquila factura por su cuenta y
  // esa plata no es de la clínica: mostrarla sería enseñarle al dueño del
  // local cuánto gana su inquilino.
  app.get("/admin/finanzas", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const medicos = await medicosDeLaClinica(req.clinicaId);
    const empleados = medicos.filter(m => m.vinculo === "empleado");
    const telefonos = empleados.map(m => m.phone);
    const inquilinos = medicos.length - empleados.length;

    if (telefonos.length === 0) {
      return res.json({ porMedico: [], totales: { facturado: 0, cobrado: 0, pendiente: 0 }, inquilinosExcluidos: inquilinos });
    }

    const planes = await TratamientoPlan.aggregate([
      { $match: { medicoPhone: { $in: telefonos } } },
      { $project: {
          medicoPhone: 1, precio: { $ifNull: ["$precio", 0] },
          pagado: { $sum: { $map: { input: { $ifNull: ["$pagos", []] }, as: "p", in: "$$p.monto" } } },
      } },
      { $group: { _id: "$medicoPhone", facturado: { $sum: "$precio" }, cobrado: { $sum: "$pagado" }, items: { $sum: 1 } } },
    ]);

    const porTel = Object.fromEntries(planes.map(p => [p._id, p]));
    const porMedico = empleados.map(m => {
      const p = porTel[m.phone] || { facturado: 0, cobrado: 0, items: 0 };
      return {
        phone: m.phone, nombre: m.nombre, consultorio: m.consultorio || "",
        facturado: p.facturado, cobrado: p.cobrado,
        pendiente: p.facturado - p.cobrado, items: p.items,
      };
    });

    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "admin_finanzas_clinica", recurso: `Clinica:${req.clinicaId}` });

    res.json({
      porMedico,
      totales: {
        facturado: porMedico.reduce((a, m) => a + m.facturado, 0),
        cobrado: porMedico.reduce((a, m) => a + m.cobrado, 0),
        pendiente: porMedico.reduce((a, m) => a + m.pendiente, 0),
      },
      // Se dice cuántos quedaron afuera y por qué: un total que no cierra
      // sin explicación hace dudar del sistema entero.
      inquilinosExcluidos: inquilinos,
    });
  }));

  // ─── EQUIPOS DE LA CLÍNICA ──────────────────────────────────────────────
  app.get("/admin/equipos", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const telefonos = (await medicosDeLaClinica(req.clinicaId)).map(m => m.phone);
    const equipos = telefonos.length
      ? await EquipoRayos.find({ medicoPhone: { $in: telefonos }, activo: true })
          .select("nombre medicoPhone ultimoContacto subidas ultimaSubida")
          .lean()
      : [];
    const ahora = Date.now();
    res.json({
      equipos: equipos.map(e => ({
        ...e,
        conectado: Boolean(e.ultimoContacto && ahora - new Date(e.ultimoContacto).getTime() < 90 * 1000),
      })),
    });
  }));

  // ─── ALTA DE UN MÉDICO EN LA CLÍNICA ────────────────────────────────────
  // Solo suma a la clínica una cuenta que YA existe. Crear la cuenta sigue
  // siendo el registro de siempre, con su contraseña elegida por el médico:
  // el administrador no le pone la contraseña a nadie.
  app.post("/admin/medicos/:phone/vincular", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: String(req.params.phone).trim() });
    if (!medico) throw new ErrorHttp(404, "No hay ninguna cuenta con ese teléfono");
    if (medico.clinicaId && String(medico.clinicaId) !== String(req.clinicaId)) {
      throw new ErrorHttp(409, "Esa cuenta ya pertenece a otra clínica");
    }
    const vinculo = ["empleado", "alquila"].includes(req.body?.vinculo) ? req.body.vinculo : "empleado";
    // La clínica viaja en el token: si recién entra a la clínica, la sesión
    // abierta se corta y al volver a entrar ya la tiene. Cambiarle el
    // consultorio o el vínculo no toca el token: no lo saca.
    if (String(medico.clinicaId || "") !== String(req.clinicaId)) medico.sesionesDesde = new Date();
    medico.clinicaId = new mongoose.Types.ObjectId(String(req.clinicaId));
    medico.vinculo = vinculo;
    medico.consultorio = String(req.body?.consultorio || "").trim().slice(0, 60);
    await medico.save();
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "admin_vincular_medico", recurso: `Medico:${medico.phone}` });
    res.json({ ok: true, medico: { phone: medico.phone, nombre: medico.nombre, vinculo, consultorio: medico.consultorio } });
  }));

  // ─── BAJA ───────────────────────────────────────────────────────────────
  // Saca al médico de la clínica y NO le toca un solo dato clínico. Si
  // alquilaba, sus fichas nunca fueron de la clínica; si era empleado,
  // tampoco: la historia es del paciente y la escribió ese médico. Lo que se
  // corta es el acceso del administrador a sus números, no su trabajo.
  app.post("/admin/medicos/:phone/desvincular", limitMedico, requireAdmin, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: String(req.params.phone).trim(), clinicaId: req.clinicaId });
    if (!medico) throw new ErrorHttp(404, "Ese médico no está en tu clínica");
    if (medico.rol === "admin" || medico.rol === "director") {
      throw new ErrorHttp(409, "No se puede desvincular a quien administra la clínica");
    }
    medico.clinicaId = null;
    medico.consultorio = "";
    // Su sesión llevaba la clínica en el token: se corta, y al volver a
    // entrar ya no la tiene (services/auth.js, sesionVigente).
    medico.sesionesDesde = new Date();
    await medico.save();
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "admin_desvincular_medico", recurso: `Medico:${medico.phone}` });
    res.json({ ok: true });
  }));
};

// Expuesta solo para las pruebas: es la regla de qué ve el panel de una
// cita, y conviene poder ejecutarla sin levantar Express ni Mongo.
module.exports.citaParaElPanel = citaParaElPanel;
