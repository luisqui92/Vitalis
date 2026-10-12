// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Informes con membrete
// ═══════════════════════════════════════════════════════════════════════════
// En un centro de imagen el informe ES el producto: el paciente no paga por
// la placa, paga por la lectura del médico. Por eso tiene código propio,
// estado, firma y un enlace para entregarlo.
//
// Tres decisiones que valen la pena mirar antes del código:
//
// · Un informe FIRMADO no se edita más. Ya salió del consultorio y puede
//   estar en manos de otro médico; corregirlo por atrás sería reescribir un
//   documento que alguien ya leyó. Se hace uno nuevo que referencia al
//   anterior, como en cualquier servicio de imagenología serio.
//
// · Las imágenes descartadas NO se borran: se dejan fuera del informe. Al
//   paciente ya se le dio la dosis y esa placa es parte del registro.
//
// · El paciente entra por un enlace que vence, sin cuenta ni contraseña.
//   Alguien que recibe un informe una vez no va a crear un usuario, y una
//   cuenta más es superficie de ataque más.
//
// · Lo impreso se congela al firmar (abajo, «Lo que va impreso»).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Paciente, Estudio, Informe, Membrete, MembreteEmitido, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { DIR_ESTUDIOS } = require("../services/archivosEstudio");
const { enviarTextoOPlantilla, PLANTILLAS } = require("../services/metaWhatsapp");
const { siguienteCodigo } = require("../services/codigos");
const { CONFIG, log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// El enlace del paciente es público (sin sesión), así que tiene su propio
// límite: es la única puerta de Symphomed que cualquiera puede tocar.
const limitPublico = rateLimit("informePublico", 40, 60 * 1000, "Demasiadas peticiones. Esperá un momento.");

const DIAS_VALIDEZ_ENLACE = 90;

// Los códigos correlativos (P-0001, INF-0001) viven en services/codigos.js:
// los comparte con el alta de pacientes, que ahora le pone el código de una
// para que se pueda tipear en el equipo de imagen desde el primer día.

async function membreteDe(medicoPhone) {
  let m = await Membrete.findOne({ medicoPhone });
  if (!m) {
    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    m = await Membrete.create({
      medicoPhone,
      // Se arranca con lo que Symphomed ya sabe, para que el primer informe
      // salga presentable sin que nadie configure nada.
      nombreCentro: medico?.nombre || "",
      profesionalNombre: medico?.nombre || "",
      profesionalTitulo: medico?.especialidad || "",
      telefono: medicoPhone,
    });
  }
  return m;
}

// La edad que tenía el paciente en una fecha (la de la firma, en un informe
// firmado).
function edadEnFecha(fechaNacimiento, hasta) {
  if (!fechaNacimiento) return null;
  const n = new Date(fechaNacimiento), h = new Date(hasta || Date.now());
  let edad = h.getFullYear() - n.getFullYear();
  const m = h.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < n.getDate())) edad--;
  return edad >= 0 ? edad : null;
}

// ═══ LO QUE VA IMPRESO ════════════════════════════════════════════════════
//
// El membrete y los datos del paciente se congelan al firmar y no se vuelven
// a leer al mostrarlo: si el paciente cumple años o cambia de nombre, o el
// médico cambia de matrícula o de logo, el informe firmado tiene que seguir
// diciendo lo que decía el día que se firmó. Antes este comentario decía eso
// mismo, pero el enlace del paciente, la verificación y la impresión leían
// el membrete y el paciente de hoy (informe de QA del 9 de octubre de 2026).
const CAMPOS_MEMBRETE = ["nombreCentro", "direccion", "telefono", "ciudad", "profesionalNombre",
  "profesionalTitulo", "profesionalRegistro", "piePagina", "logo", "firma"];

// La versión del membrete de hoy: la misma copia para todos los informes que
// se firman con él (MembreteEmitido, en db/models.js).
async function versionDelMembrete(medicoPhone) {
  const m = await membreteDe(medicoPhone);
  const datos = Object.fromEntries(CAMPOS_MEMBRETE.map(c => [c, m[c] || ""]));
  const huella = crypto.createHash("sha256").update(JSON.stringify(datos)).digest("hex");
  try {
    return await MembreteEmitido.findOneAndUpdate({ medicoPhone, huella },
      { $setOnInsert: { medicoPhone, huella, ...datos } }, { upsert: true, new: true, lean: true });
  } catch (e) {
    // Dos firmas a la vez con un membrete nuevo: la otra ya la creó.
    if (e?.code === 11000) return MembreteEmitido.findOne({ medicoPhone, huella }).lean();
    throw e;
  }
}

// El paciente como figura en el informe que se firma en esa fecha.
async function pacienteAlFirmar(informe, firmadoEn) {
  const p = await Paciente.findOne({ _id: informe.pacienteId, medicoPhone: informe.medicoPhone }).lean();
  return { nombre: p?.nombre || "", codigo: p?.codigo || "", sexo: p?.sexo || "", edad: edadEnFecha(p?.fechaNacimiento, firmadoEn) };
}

// Lo impreso de un informe: lo congelado si está firmado, lo de hoy si es un
// borrador. Solo lo que se imprime: ni la huella ni de quién es.
async function impresoDe(informe) {
  const congelado = informe.membreteEmitido && await MembreteEmitido.findById(informe.membreteEmitido).lean();
  const m = congelado || await membreteDe(informe.medicoPhone);
  const membrete = Object.fromEntries(CAMPOS_MEMBRETE.map(c => [c, m[c] || ""]));
  const emitido = informe.pacienteEmitido?.toObject?.() || informe.pacienteEmitido;
  const paciente = emitido || await pacienteAlFirmar(informe, informe.firmadoEn || undefined);
  return { membrete, paciente };
}

// Los firmados antes de que lo impreso se congelara: se congelan con lo que
// mostraban hasta ahora, la primera vez que arranca el servidor con esto (lo
// llama index.js). Después ya no hay ninguno: no hace nada.
async function congelarInformesFirmados() {
  const viejos = await Informe.find({ estado: "firmado", membreteEmitido: null }).select("_id medicoPhone pacienteId firmadoEn").lean();
  const versiones = new Map();
  for (const inf of viejos) {
    if (!versiones.has(inf.medicoPhone)) versiones.set(inf.medicoPhone, await versionDelMembrete(inf.medicoPhone));
    await Informe.updateOne({ _id: inf._id, membreteEmitido: null },
      { $set: { membreteEmitido: versiones.get(inf.medicoPhone)._id, pacienteEmitido: await pacienteAlFirmar(inf, inf.firmadoEn) } });
  }
  return viejos.length;
}

module.exports = function (app) {
  // ═══ MEMBRETE ════════════════════════════════════════════════════════════
  app.get("/medico/membrete", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    res.json({ membrete: await membreteDe(req.adminUser.usuario) });
  }));

  app.patch("/medico/membrete", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const m = await membreteDe(medicoPhone);
    for (const campo of ["nombreCentro", "direccion", "telefono", "ciudad", "profesionalNombre", "profesionalTitulo", "profesionalRegistro", "piePagina"]) {
      if (req.body?.[campo] !== undefined) m[campo] = String(req.body[campo]).trim().slice(0, 200);
    }
    // Logo y firma llegan como data URI. Se acepta solo imagen y con tope de
    // tamaño: un logo de 5 MB haría lenta cada impresión y engordaría el
    // respaldo de la base para siempre.
    for (const campo of ["logo", "firma"]) {
      if (req.body?.[campo] === undefined) continue;
      const v = String(req.body[campo] || "");
      if (v === "") { m[campo] = ""; continue; }
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(v)) throw new ErrorHttp(400, "El logo y la firma tienen que ser una imagen PNG, JPG o WEBP");
      if (v.length > 400 * 1024) throw new ErrorHttp(400, "La imagen es muy pesada (máximo 300 KB). Reducila y volvé a intentar.");
      m[campo] = v;
    }
    await m.save();
    registrar({ req, medicoPhone, accion: "editar_membrete", recurso: "Membrete" });
    res.json({ ok: true, membrete: m });
  }));

  // ═══ INFORMES DEL MÉDICO ═════════════════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/informes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const informes = await Informe.find({ pacienteId: paciente._id, medicoPhone }).sort({ createdAt: -1 }).lean();
    res.json({ informes });
  }));

  app.post("/medico/pacientes/:pacienteId/informes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    // El paciente recibe su código la primera vez que se le hace un informe,
    // no al registrarlo: así los pacientes viejos también lo consiguen sin
    // tener que migrar nada.
    // Si dos informes salen a la vez, el código que queda es el primero.
    if (!paciente.codigo) {
      await Paciente.updateOne({ _id: paciente._id, codigo: { $in: [null, ""] } }, { codigo: await siguienteCodigo(Paciente, medicoPhone, "P") });
    }

    const informe = await Informe.create({
      pacienteId: paciente._id, medicoPhone,
      codigo: await siguienteCodigo(Informe, medicoPhone, "INF"),
      titulo: String(req.body?.titulo || "").trim(),
      tipoEstudio: String(req.body?.tipoEstudio || "").trim(),
      fechaEstudio: req.body?.fechaEstudio ? new Date(req.body.fechaEstudio) : new Date(),
      corrigeA: req.body?.corrigeA || null,
    });
    registrar({ req, medicoPhone, accion: "crear_informe", recurso: `Informe:${informe._id}` });
    res.status(201).json({ ok: true, informe });
  }));

  app.patch("/medico/informes/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(Informe, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    if (informe.estado === "firmado") {
      throw new ErrorHttp(409, "Este informe ya está firmado y no se puede editar. Creá uno nuevo que lo corrija.");
    }

    for (const campo of ["titulo", "tipoEstudio", "tecnica", "hallazgos", "conclusion", "recomendaciones"]) {
      if (req.body?.[campo] !== undefined) informe[campo] = String(req.body[campo]).slice(0, 20000);
    }
    if (req.body?.fechaEstudio) informe.fechaEstudio = new Date(req.body.fechaEstudio);

    if (Array.isArray(req.body?.estudiosIncluidos)) {
      // Solo se aceptan estudios que sean de ESTE paciente y de este médico.
      // Sin este filtro, alguien podría meter en su informe la radiografía
      // de otro paciente mandando un id a mano.
      const validos = await Estudio.find({
        _id: { $in: req.body.estudiosIncluidos.slice(0, 30) },
        pacienteId: informe.pacienteId,
        medicoPhone,
      }).select("_id").lean();
      informe.estudiosIncluidos = validos.map(e => e._id);
    }

    await informe.save();
    res.json({ ok: true, informe });
  }));

  // ─── FIRMAR ──────────────────────────────────────────────────────────────
  // Firmar congela lo impreso (arriba), y es de una sola vez: con dos «firmar»
  // juntos, uno firma y el otro recibe «ya está firmado». Antes los dos
  // firmaban, cada uno con su enlace, y valía el último que se guardaba.
  app.post("/medico/informes/:id/firmar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(Informe, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    if (informe.estado === "firmado") throw new ErrorHttp(409, "Ya está firmado");
    if (!informe.conclusion.trim()) throw new ErrorHttp(400, "Un informe sin conclusión no se puede firmar");

    const firmadoEn = new Date();
    const [version, pacienteEmitido] = await Promise.all([versionDelMembrete(medicoPhone), pacienteAlFirmar(informe, firmadoEn)]);
    const firmado = await Informe.findOneAndUpdate({ _id: informe._id, medicoPhone, estado: { $ne: "firmado" } }, { $set: {
      estado: "firmado", firmadoEn,
      // El enlace se crea al firmar y no antes: un borrador no se comparte.
      tokenPublico: crypto.randomBytes(24).toString("base64url"),
      tokenExpira: new Date(Date.now() + DIAS_VALIDEZ_ENLACE * 86400000),
      membreteEmitido: version._id, pacienteEmitido,
    } }, { new: true });
    if (!firmado) throw new ErrorHttp(409, "Ya está firmado");

    registrar({ req, medicoPhone, accion: "firmar_informe", recurso: `Informe:${firmado._id}` });
    res.json({ ok: true, informe: firmado, enlace: enlaceDe(firmado, req) });
  }));

  // Si APP_URL no está configurado, el enlace se arma con el dominio por el
  // que entró el pedido. Sin esto salía "/informe/xxx" a secas: el médico lo
  // copiaba, lo pegaba en WhatsApp y al paciente no le abría nada. Detrás de
  // nginx funciona porque index.js tiene trust proxy (X-Forwarded-Proto).
  function enlaceDe(informe, req) {
    if (!informe.tokenPublico) return null;
    const base = (CONFIG.APP_URL || "").replace(/\/+$/, "")
      || (req ? `${req.protocol}://${req.get("host")}` : "");
    return `${base}/informe/${informe.tokenPublico}`;
  }

  // ─── DATOS COMPLETOS PARA IMPRIMIR ───────────────────────────────────────
  app.get("/medico/informes/:id/completo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(Informe, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    const paciente = await Paciente.findOne({ _id: informe.pacienteId, medicoPhone }).lean();
    const estudios = await Estudio.find({ _id: { $in: informe.estudiosIncluidos }, medicoPhone }).lean();
    const impreso = await impresoDe(informe);
    res.json({
      informe,
      // Lo impreso, como en el enlace del paciente. El teléfono es el de hoy:
      // no va impreso, es para mandarlo.
      paciente: paciente && { ...impreso.paciente, telefono: paciente.telefono },
      estudios: estudios.map(e => ({ _id: e._id, nombre: e.nombre, tipo: e.tipo, fecha: e.fecha, ajustesVisor: e.ajustesVisor, mediciones: e.mediciones, calibracion: e.calibracion })),
      membrete: impreso.membrete,
      enlace: enlaceDe(informe, req),
    });
  }));

  // ─── ENVIAR AL PACIENTE POR WHATSAPP ─────────────────────────────────────
  app.post("/medico/informes/:id/enviar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(Informe, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    if (informe.estado !== "firmado") throw new ErrorHttp(400, "Firmá el informe antes de enviarlo");

    const paciente = await Paciente.findOne({ _id: informe.pacienteId, medicoPhone }).lean();
    const destino = String(req.body?.telefono || paciente?.telefono || "").replace(/\D/g, "");
    if (!destino) throw new ErrorHttp(400, "El paciente no tiene teléfono cargado");

    const { membrete } = await impresoDe(informe);
    // Cero contenido clínico en el mensaje: la vista previa de WhatsApp
    // aparece en la pantalla bloqueada de un teléfono que a veces es
    // compartido. El detalle vive detrás del enlace.
    const primerNombre = String(paciente?.nombre || "").split(" ")[0];
    const queEstudio = `${informe.titulo || informe.tipoEstudio || "Estudio"} — ${new Date(informe.fechaEstudio).toLocaleDateString("es-BO")}`;
    const enlace = enlaceDe(informe, req);
    const texto = `Hola ${primerNombre}. Su informe ya está disponible.\n\n` +
      `${queEstudio}\n\n` +
      `Puede verlo acá:\n${enlace}\n\n` +
      `El enlace vence en ${DIAS_VALIDEZ_ENLACE} días.\n${membrete.nombreCentro || ""}`;

    try {
      // Ni el título del estudio ni nada clínico viajan en la plantilla más
      // allá de lo que ya va en el texto libre: la vista previa de WhatsApp
      // aparece en la pantalla bloqueada de un teléfono que a veces es
      // compartido. El detalle sigue viviendo detrás del enlace.
      await enviarTextoOPlantilla(destino, texto,
        { plantilla: PLANTILLAS.informeListo, parametros: [primerNombre, queEstudio, enlace] });
    } catch (e) {
      // Hasta ahora acá caía todo lo que pasara de las 24 h, que era el caso
      // normal. Eso ahora lo resuelve la plantilla de respaldo: si el envío
      // llega igual hasta acá, es que la plantilla no está aprobada todavía o
      // que el número no recibe. Hay que decir CUÁL de las dos, porque las
      // dos se ven igual desde la pantalla del médico.
      const codigo = e.response?.data?.error?.code;
      log.error("[INFORME] falló el envío por WhatsApp:", e.response?.data?.error?.message || e.message);
      throw new ErrorHttp(502,
        (codigo === 132000 || codigo === 132001)
          ? "La plantilla «informe_listo» todavía no está aprobada en Meta, así que no se le puede escribir " +
            "a un paciente que no haya escrito en las últimas 24 horas. Mientras tanto, copiá el enlace y mandáselo vos."
          : "WhatsApp rechazó el envío. Revisá que ese número tenga WhatsApp. " +
            "Mientras tanto podés copiar el enlace y mandárselo vos.");
    }

    informe.compartidoEn = new Date();
    await informe.save();
    registrar({ req, medicoPhone, accion: "enviar_informe", recurso: `Informe:${informe._id}` });
    res.json({ ok: true, enviadoA: destino });
  }));

  app.delete("/medico/informes/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const informe = await obtenerOFallar(Informe, { _id: req.params.id, medicoPhone }, "Informe no encontrado");
    // Un informe firmado ya puede estar en manos del paciente o de otro
    // médico. Borrarlo de la base no lo borra de ahí, solo destruye el
    // registro de qué se dijo.
    if (informe.estado === "firmado") throw new ErrorHttp(409, "Un informe firmado no se borra. Si tiene un error, creá uno nuevo que lo corrija.");
    await Informe.deleteOne({ _id: informe._id });
    registrar({ req, medicoPhone, accion: "borrar_informe", recurso: `Informe:${req.params.id}` });
    res.json({ ok: true });
  }));

  // ═══ LADO PACIENTE (sin sesión, por enlace) ══════════════════════════════
  async function porToken(token) {
    if (!token || token.length < 20) return null;
    const informe = await Informe.findOne({ tokenPublico: token, estado: "firmado" });
    if (!informe) return null;
    if (informe.tokenExpira && informe.tokenExpira < new Date()) return { vencido: true, informe };
    return { informe };
  }

  app.get("/informe-publico/:token", limitPublico, asyncRoute(async (req, res) => {
    const r = await porToken(req.params.token);
    if (!r) throw new ErrorHttp(404, "Este informe no existe o el enlace ya no es válido.");
    if (r.vencido) throw new ErrorHttp(410, "Este enlace venció. Pedile uno nuevo a tu médico.");

    const informe = r.informe;
    const estudios = await Estudio.find({ _id: { $in: informe.estudiosIncluidos } }).lean();
    const { membrete, paciente } = await impresoDe(informe);

    // Que el médico sepa si el paciente lo abrió, que es la pregunta que
    // siempre hace el mostrador ("¿ya lo vio?").
    informe.vistas = (informe.vistas || 0) + 1;
    if (!informe.vistoEn) informe.vistoEn = new Date();
    await informe.save();

    res.json({
      informe: {
        codigo: informe.codigo, titulo: informe.titulo, tipoEstudio: informe.tipoEstudio,
        fechaEstudio: informe.fechaEstudio, firmadoEn: informe.firmadoEn,
        tecnica: informe.tecnica, hallazgos: informe.hallazgos,
        conclusion: informe.conclusion, recomendaciones: informe.recomendaciones,
      },
      // Del paciente va lo mínimo necesario para que se reconozca en su
      // propio informe. Nada de teléfono ni historial.
      paciente: { nombre: paciente.nombre || "", codigo: paciente.codigo || "", edad: paciente.edad ?? null },
      estudios: estudios.map(e => ({ _id: e._id, nombre: e.nombre, ajustesVisor: e.ajustesVisor })),
      membrete,
    });
  }));

  // Las imágenes del informe, servidas por el mismo token. Solo salen las
  // que están incluidas en ESE informe: tener el enlace no da acceso al
  // resto de los estudios del paciente.
  app.get("/informe-publico/:token/imagen/:estudioId", limitPublico, asyncRoute(async (req, res) => {
    const r = await porToken(req.params.token);
    if (!r || r.vencido) throw new ErrorHttp(404, "No disponible");
    const incluida = r.informe.estudiosIncluidos.some(id => String(id) === String(req.params.estudioId));
    if (!incluida) throw new ErrorHttp(404, "No disponible");

    const estudio = await Estudio.findById(req.params.estudioId).lean();
    if (!estudio) throw new ErrorHttp(404, "No disponible");
    const ruta = path.join(DIR_ESTUDIOS, estudio.archivoNombre);
    if (!fs.existsSync(ruta)) throw new ErrorHttp(404, "No disponible");
    res.setHeader("Content-Type", estudio.archivoMime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(ruta);
  }));

  // ─── VERIFICAR UN INFORME POR SU CÓDIGO ──────────────────────────────────
  // Cualquiera con el informe en la mano puede comprobar que es auténtico y
  // que dice lo mismo que dice Symphomed. Es lo que le da valor a la firma:
  // una imagen pegada la copia cualquiera, esto no.
  app.get("/informe-publico/:token/verificar", limitPublico, asyncRoute(async (req, res) => {
    const r = await porToken(req.params.token);
    if (!r) return res.json({ valido: false, motivo: "No encontramos ningún informe con ese enlace." });
    if (r.vencido) return res.json({ valido: false, motivo: "El enlace de este informe venció." });
    const { membrete } = await impresoDe(r.informe);
    res.json({
      valido: true,
      codigo: r.informe.codigo,
      firmadoEn: r.informe.firmadoEn,
      profesional: membrete.profesionalNombre,
      centro: membrete.nombreCentro,
    });
  }));
};

module.exports.congelarInformesFirmados = congelarInformesFirmados;
