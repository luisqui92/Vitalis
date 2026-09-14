// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — El informe de avance para la familia
// ═══════════════════════════════════════════════════════════════════════════
// El porqué está en services/informeFamilia.js y en db/models.js. Acá va lo
// que hace falta decir del flujo:
//
// · SE ARMA SOLO, SE ENVÍA A MANO. El borrador sale de lo que el equipo ya
//   registró sesión por sesión. Si hubiera que escribirlo de cero, no
//   existiría: nadie tiene media hora por familia por mes. Pero el envío es
//   un acto del profesional, siempre.
//
// · AL ENVIAR SE CONGELA. Después de enviado no se edita ni una coma: la
//   madre ya lo leyó. Si hay un error, se hace otro. Mismo criterio que el
//   informe firmado de routes/informes.js.
//
// · LA FAMILIA NO TIENE CUENTA. Entra por /avance/<token>, sin contraseña.
//   El enlace ES la credencial, y vence.
const crypto = require("crypto");
const { Paciente, InformeFamilia, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { enviarTextoOPlantilla, PLANTILLAS } = require("../services/metaWhatsapp");
const { armarBorrador, tieneAlgoQueContar, listaLimpia, PERIODO_DIAS } = require("../services/informeFamilia");
const { CONFIG, log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// El enlace de la familia es público, así que tiene su propio límite: es una
// de las pocas puertas de Symphomed que cualquiera puede tocar.
const limitPublico = rateLimit("avanceFamilia", 40, 60 * 1000, "Demasiadas peticiones. Esperá un momento.");

// Un año. Más largo que los 90 días del informe con membrete, y a propósito:
// aquel se lee una vez y se archiva; este la familia lo vuelve a abrir —se lo
// muestra a la escuela, al pediatra, a la abuela— y un enlace vencido en ese
// momento es exactamente el tipo de fricción que este informe existe para no
// tener.
const DIAS_VALIDEZ_ENLACE = 365;

function enlaceDe(informe, req) {
  if (!informe.tokenPublico) return null;
  const base = (CONFIG.APP_URL || "").replace(/\/+$/, "")
    || (req ? `${req.protocol}://${req.get("host")}` : "");
  return `${base}/avance/${informe.tokenPublico}`;
}

function fechaOFallar(v, porDefecto) {
  if (v === undefined || v === null || v === "") return porDefecto;
  const d = new Date(v);
  if (isNaN(d)) throw new ErrorHttp(400, "Fecha inválida");
  return d;
}

// Lo que se le manda al navegador de la familia. Va por separado del
// documento de la base para que quede a la vista qué sale de Symphomed sin
// sesión: ni el id del paciente, ni el teléfono del médico, ni las fechas de
// la ficha. Solo el informe.
function paraLaFamilia(inf) {
  return {
    nombre: inf.nombre, desde: inf.desde, hasta: inf.hasta,
    fortalezas: inf.fortalezas, intereses: inf.intereses,
    avances: inf.avances, enCasa: inf.enCasa, siguiendo: inf.siguiendo,
    nota: inf.nota, profesional: inf.profesional, centro: inf.centro,
    enviadoEn: inf.enviadoEn,
  };
}

module.exports = function (app) {
  // ─── LISTA ───────────────────────────────────────────────────────────────
  app.get("/medico/pacientes/:pacienteId/informes-familia", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const informes = await InformeFamilia.find({ pacienteId: paciente._id, medicoPhone })
      .sort({ createdAt: -1 }).limit(40).lean();
    res.json({
      informes: informes.map(i => ({ ...i, enlace: enlaceDe(i, req) })),
      periodoDias: PERIODO_DIAS,
    });
  }));

  // ─── ARMAR EL BORRADOR ───────────────────────────────────────────────────
  // Crea el informe ya lleno con lo que hay registrado. El profesional lo
  // abre, saca lo que no va, escribe su párrafo y recién ahí lo manda.
  app.post("/medico/pacientes/:pacienteId/informes-familia", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const hasta = fechaOFallar(req.body?.hasta, new Date());
    const desde = fechaOFallar(req.body?.desde, new Date(hasta.getTime() - PERIODO_DIAS * 86400000));
    if (desde >= hasta) throw new ErrorHttp(400, "El período está al revés: la fecha de inicio tiene que ser anterior a la del final.");

    const borrador = await armarBorrador({ pacienteId: paciente._id, medicoPhone, desde, hasta });
    if (!borrador) throw new ErrorHttp(404, "Paciente no encontrado");
    if (!tieneAlgoQueContar(borrador)) {
      // No es un error del profesional: es que todavía no hay con qué. Se
      // dice así, y se dice qué falta cargar.
      throw new ErrorHttp(409,
        "Todavía no hay avances registrados en ese período. Cargá el progreso de los objetivos " +
        "(o ampliá las fechas) y el informe se arma solo.");
    }

    const medico = await Medico.findOne({ phone: medicoPhone }).select("nombre").lean();
    const informe = await InformeFamilia.create({
      pacienteId: paciente._id, medicoPhone,
      ...borrador,
      profesional: medico?.nombre || "",
      centro: "",
    });

    registrar({ req, medicoPhone, accion: "crear_informe_familia", recurso: `InformeFamilia:${informe._id}` });
    res.json({ ok: true, informe });
  }));

  app.get("/medico/informes-familia/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(InformeFamilia, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    res.json({ informe, enlace: enlaceDe(informe, req) });
  }));

  // ─── EDITAR (solo mientras es borrador) ──────────────────────────────────
  app.patch("/medico/informes-familia/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(InformeFamilia, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    if (informe.estado === "enviado") {
      throw new ErrorHttp(409, "Este informe ya lo recibió la familia y no se puede cambiar. Si hay un error, armá uno nuevo.");
    }

    const b = req.body || {};
    // La nota es el campo que de verdad se edita. El tope no es arbitrario:
    // esto se lee en un celular, y un párrafo largo no se lee.
    if (b.nota !== undefined) informe.nota = String(b.nota).slice(0, 1500);
    if (b.profesional !== undefined) informe.profesional = String(b.profesional).trim().slice(0, 120);
    if (b.centro !== undefined) informe.centro = String(b.centro).trim().slice(0, 120);
    // Las listas se pueden podar: el profesional saca lo que no quiere que
    // salga. Se reemplazan enteras, no se mezclan — mezclar haría imposible
    // borrar el último elemento.
    for (const campo of ["fortalezas", "intereses", "enCasa", "siguiendo"]) {
      if (b[campo] !== undefined) informe[campo] = listaLimpia(b[campo]);
    }
    if (Array.isArray(b.avances)) {
      // De los avances solo se permite QUITAR, no reescribir: los números y
      // el nivel de ayuda salen de lo que cargó el equipo sesión por sesión.
      // Un informe donde las cifras se pueden tipear a mano deja de ser un
      // registro.
      const dejar = new Set(b.avances.map(a => String(a?.titulo ?? a)));
      informe.avances = informe.avances.filter(a => dejar.has(a.titulo));
    }
    await informe.save();
    res.json({ ok: true, informe });
  }));

  // ─── ENVIAR ──────────────────────────────────────────────────────────────
  app.post("/medico/informes-familia/:id/enviar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(InformeFamilia, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    if (informe.estado === "enviado") throw new ErrorHttp(409, "Este informe ya se envió.");

    const paciente = await Paciente.findOne({ _id: informe.pacienteId, medicoPhone }).lean();
    const destino = String(req.body?.telefono || paciente?.telefono || "").replace(/\D/g, "");
    if (!destino) throw new ErrorHttp(400, "No hay un teléfono al que mandarlo. Cargalo en la ficha o escribilo acá.");

    // El enlace se crea al enviar y no antes: un borrador no se comparte.
    informe.tokenPublico = crypto.randomBytes(24).toString("base64url");
    informe.tokenExpira = new Date(Date.now() + DIAS_VALIDEZ_ENLACE * 86400000);
    const enlace = enlaceDe(informe, req);

    // El mensaje no dice nada del chico. La vista previa de WhatsApp aparece
    // en la pantalla bloqueada de un teléfono que en muchas casas es
    // compartido, y acá el dato es más sensible que en cualquier otro aviso
    // de Symphomed: una condición del neurodesarrollo no se anuncia en una
    // notificación. El contenido vive detrás del enlace.
    const primerNombre = String(informe.nombre || "").split(" ")[0];
    const deQuien = informe.centro || informe.profesional || "el equipo";
    const texto =
      `Hola. Le compartimos el informe de avance de ${primerNombre}.\n\n` +
      `Es un resumen de cómo le fue en estas semanas, escrito para leer en el celular. ` +
      `No hace falta contraseña ni instalar nada: toque el enlace y se abre.\n\n${enlace}\n\n` +
      `Si algo no se entiende, escríbanos por acá.\n${deQuien}`;

    try {
      await enviarTextoOPlantilla(destino, texto,
        { plantilla: PLANTILLAS.avanceFamilia, parametros: [primerNombre, deQuien, enlace] });
    } catch (e) {
      const codigo = e.response?.data?.error?.code;
      log.error("[AVANCE] falló el envío por WhatsApp:", e.response?.data?.error?.message || e.message);
      throw new ErrorHttp(502,
        (codigo === 132000 || codigo === 132001)
          ? "La plantilla «avance_familia» todavía no está aprobada en Meta, así que no se le puede escribir " +
            "a una familia que no haya escrito en las últimas 24 horas. Mientras tanto, copiá el enlace y mandáselo vos."
          : "WhatsApp rechazó el envío. Revisá que ese número tenga WhatsApp. " +
            "Mientras tanto podés copiar el enlace y mandárselo vos.");
    }

    informe.estado = "enviado";
    informe.enviadoEn = new Date();
    informe.enviadoA = destino;
    await informe.save();

    registrar({ req, medicoPhone, accion: "enviar_informe_familia", recurso: `InformeFamilia:${informe._id}` });
    res.json({ ok: true, informe, enlace, enviadoA: destino });
  }));

  app.delete("/medico/informes-familia/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(InformeFamilia, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    // Mismo criterio que el informe firmado: borrarlo de la base no lo borra
    // del teléfono de la familia, solo destruye el registro de qué se dijo.
    if (informe.estado === "enviado") throw new ErrorHttp(409, "Un informe que la familia ya recibió no se borra.");
    await InformeFamilia.deleteOne({ _id: informe._id });
    registrar({ req, medicoPhone, accion: "borrar_informe_familia", recurso: `InformeFamilia:${req.params.id}` });
    res.json({ ok: true });
  }));

  // ═══ LADO FAMILIA (sin sesión, por enlace) ═══════════════════════════════
  app.get("/informe-familia/:token", limitPublico, asyncRoute(async (req, res) => {
    const token = req.params.token;
    if (!token || token.length < 20) throw new ErrorHttp(404, "Este informe no existe o el enlace ya no es válido.");
    // Solo los enviados: un borrador no se abre ni con el token en la mano.
    const informe = await InformeFamilia.findOne({ tokenPublico: token, estado: "enviado" });
    if (!informe) throw new ErrorHttp(404, "Este informe no existe o el enlace ya no es válido.");
    if (informe.tokenExpira && informe.tokenExpira < new Date()) {
      throw new ErrorHttp(410, "Este enlace venció. Pedile uno nuevo al equipo que atiende a tu hijo o hija.");
    }

    // Que el profesional sepa si la familia lo abrió. No es curiosidad: un
    // informe que nunca se abre es una señal de que hay que llamar por
    // teléfono, que es justo lo que esta función existe para detectar.
    informe.vistas = (informe.vistas || 0) + 1;
    if (!informe.vistoEn) informe.vistoEn = new Date();
    await informe.save();

    res.json({ informe: paraLaFamilia(informe) });
  }));
};
