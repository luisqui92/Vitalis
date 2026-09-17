// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — El resumen que el paciente se lleva a otro consultorio
// ═══════════════════════════════════════════════════════════════════════════
//
// El porqué del modelo está en db/models.js y el de qué entra y qué no, en
// services/resumenCompartido.js. Acá va lo del flujo:
//
// · TRES PUERTAS, TRES CANDADOS DISTINTOS.
//     /medico/...            sesión de médico, su propio kardex
//     /mi/:llave             posesión de la llave del paciente
//     /r/:token              posesión del enlace compartido
//   Nunca se mezclan. La de abajo no puede llegar a lo de la de arriba: desde
//   /r/:token solo se lee el `contenido` que ya estaba congelado, no el kardex.
//
// · EL PACIENTE NO PIDE PERMISO. Desde su llave genera el resumen que quiera,
//   del alcance que quiera. No es una concesión: es su historia. Lo que el
//   médico controla es a quién le emite la llave, no qué hace con lo suyo.
//
// · TODO QUEDA AUDITADO. Compartir una historia clínica con un tercero es un
//   acto que en dos años alguien puede preguntar quién hizo. Las dos puntas
//   —médico y paciente— escriben en el mismo registro.
const crypto = require("crypto");
const {
  Paciente, PersonaClinica, ConsultaMedica, Medicamento, Informe, Vacuna,
  Medicion, TratamientoPlan, Membrete, Medico, ResumenCompartido, LlavePaciente,
} = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { enviarTextoOPlantilla, PLANTILLAS } = require("../services/metaWhatsapp");
const { SECCIONES, normalizarSecciones, armarContenido, seccionesPorDefecto } = require("../services/resumenCompartido");
const { CONFIG, log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// Las dos puertas públicas tienen su propio límite, y más apretado que el del
// médico: son de las pocas de Symphomed que cualquiera con el enlace puede
// tocar, y la de la llave además deja GENERAR cosas.
const limitPublico = rateLimit("resumenPublico", 40, 60 * 1000, "Demasiadas peticiones. Esperá un momento.");
const limitLlave = rateLimit("llavePaciente", 20, 60 * 1000, "Demasiadas peticiones. Esperá un momento.");

// 90 días. Más corto que el año del informe de avance, y por una razón
// concreta: aquel la familia lo vuelve a abrir durante meses, este se abre una
// vez —en la consulta con el otro médico— y después no debería seguir vivo en
// un chat. Si hace falta de nuevo, se genera de nuevo: cuesta un toque.
const DIAS_VALIDEZ = 90;

const nuevoToken = () => crypto.randomBytes(24).toString("base64url");

function base(req) {
  return (CONFIG.APP_URL || "").replace(/\/+$/, "")
    || (req ? `${req.protocol}://${req.get("host")}` : "");
}
const enlaceResumen = (r, req) => `${base(req)}/r/${r.token}`;
const enlaceLlave = (l, req) => `${base(req)}/mi/${l.token}`;

// ─── Leer el kardex una sola vez ───────────────────────────────────────────
//
// Lo usan la previsualización y el guardado, para que sean idénticos. Ver el
// comentario de armarContenido() sobre por qué eso no es opcional.
async function leerKardex(paciente) {
  const filtro = { pacienteId: paciente._id, medicoPhone: paciente.medicoPhone };
  const [persona, consultas, medicamentos, informes, vacunas, mediciones, tratamientos] = await Promise.all([
    paciente.personaId ? PersonaClinica.findById(paciente.personaId).lean() : null,
    // Solo las confirmadas por el médico: una nota clínica que la IA escribió
    // y que él todavía no revisó no puede salir del consultorio. Es un
    // borrador de máquina, igual que el brief.
    ConsultaMedica.find({ ...filtro, confirmadaEn: { $ne: null } }).sort({ createdAt: -1 }).lean(),
    Medicamento.find(filtro).sort({ fechaInicio: -1 }).lean(),
    Informe.find({ ...filtro, estado: "firmado" }).sort({ fechaEstudio: -1 }).lean(),
    Vacuna.find(filtro).sort({ fecha: -1 }).lean(),
    Medicion.find(filtro).sort({ fecha: -1 }).limit(200).lean(),
    TratamientoPlan.find(filtro).sort({ createdAt: 1 }).lean(),
  ]);
  return { paciente, persona, consultas, medicamentos, informes, vacunas, mediciones, tratamientos };
}

async function firmaDe(medicoPhone) {
  const [membrete, medico] = await Promise.all([
    Membrete.findOne({ medicoPhone }).lean(),
    Medico.findOne({ phone: medicoPhone }).lean(),
  ]);
  return {
    firmaNombre: membrete?.profesionalNombre || medico?.nombre || "",
    firmaCentro: membrete?.nombreCentro || "",
    // El teléfono del consultorio, no el personal del médico: es para que el
    // colega pueda llamar y preguntar, y ese llamado entra por el mostrador.
    firmaTelefono: membrete?.telefono || "",
  };
}

// Lo que se le muestra a quien abre el enlace. NO es el documento entero de la
// base: `importadoPor`, `medicoPhone` y `pacienteId` se quedan acá. Quien
// recibe un resumen no tiene por qué saber qué otros médicos lo abrieron.
function paraElQueLoRecibe(r) {
  return {
    alcance: r.alcance,
    contenido: r.contenido,
    compartidoEn: r.createdAt,
    generadoPor: r.generadoPor,
    firma: { nombre: r.firmaNombre, centro: r.firmaCentro, telefono: r.firmaTelefono },
    vence: r.tokenExpira,
  };
}

// Lo que ve quien lo generó: sin el contenido (que ya conoce) y con lo que le
// sirve para decidir si revocarlo.
function paraElQueLoGenero(r, req) {
  return {
    id: r._id, alcance: r.alcance, secciones: r.secciones,
    generadoPor: r.generadoPor, creadoEn: r.createdAt,
    vence: r.tokenExpira, revocadoEn: r.revocadoEn,
    vistas: r.vistas, vistoEn: r.vistoEn,
    importes: (r.importadoPor || []).length,
    enlace: r.revocadoEn ? null : enlaceResumen(r, req),
  };
}

module.exports = (app) => {

  // ═══ LADO MÉDICO ════════════════════════════════════════════════════════

  // Qué se puede compartir y qué viene marcado por defecto. La pantalla lo
  // pide para armar la lista de casillas sin tener las secciones duplicadas
  // en el frontend, que es como se desincronizan.
  app.get("/medico/resumenes/secciones", limitMedico, requireMedico, asyncRoute(async (_req, res) => {
    res.json({
      secciones: SECCIONES,
      porDefecto: { resumen: seccionesPorDefecto("resumen"), completo: seccionesPorDefecto("completo") },
      diasValidez: DIAS_VALIDEZ,
    });
  }));

  // Previsualizar: lo mismo que se va a compartir, sin crear nada. El médico
  // ve exactamente lo que va a ver el colega ANTES de que exista un enlace.
  app.post("/medico/pacientes/:pacienteId/resumenes/previa", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const alcance = req.body?.alcance === "completo" ? "completo" : "resumen";
    const secciones = normalizarSecciones(req.body?.secciones, alcance);
    const datos = await leerKardex(paciente);
    res.json({
      alcance, secciones,
      contenido: armarContenido(datos, { alcance, secciones }),
      firma: await firmaDe(medicoPhone),
    });
  }));

  app.get("/medico/pacientes/:pacienteId/resumenes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const lista = await ResumenCompartido.find({ pacienteId: req.params.pacienteId, medicoPhone })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ resumenes: lista.map(r => paraElQueLoGenero(r, req)) });
  }));

  app.post("/medico/pacientes/:pacienteId/resumenes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const alcance = req.body?.alcance === "completo" ? "completo" : "resumen";
    const secciones = normalizarSecciones(req.body?.secciones, alcance);
    const datos = await leerKardex(paciente);
    const contenido = armarContenido(datos, { alcance, secciones });

    const r = await ResumenCompartido.create({
      pacienteId: paciente._id, medicoPhone,
      generadoPor: "medico", ...(await firmaDe(medicoPhone)),
      alcance, secciones, contenido,
      token: nuevoToken(), tokenExpira: new Date(Date.now() + DIAS_VALIDEZ * 86400000),
    });

    registrar({ req, medicoPhone, accion: "compartir_resumen",
      recurso: `Paciente:${paciente._id}`, detalle: `${alcance} · ${secciones.join(",")}` });
    res.json({ ok: true, resumen: paraElQueLoGenero(r, req), enlace: enlaceResumen(r, req) });
  }));

  // Revocar. No se borra: el registro de que ESE día se compartió eso tiene
  // que quedar, y borrarlo sería borrar la prueba de un acto. Lo que se corta
  // es el acceso.
  app.post("/medico/resumenes/:id/revocar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await obtenerOFallar(ResumenCompartido, { _id: req.params.id, medicoPhone }, "Resumen no encontrado");
    if (r.revocadoEn) return res.json({ ok: true, resumen: paraElQueLoGenero(r, req) });
    r.revocadoEn = new Date();
    r.revocadoPor = medicoPhone;
    await r.save();
    registrar({ req, medicoPhone, accion: "revocar_resumen", recurso: `ResumenCompartido:${r._id}` });
    res.json({ ok: true, resumen: paraElQueLoGenero(r, req) });
  }));

  // ─── La llave del paciente ───────────────────────────────────────────────
  //
  // Emitirla es del médico porque es él quien tiene el número verificado del
  // paciente en la ficha. Lo que el paciente haga DESPUÉS con lo suyo no pasa
  // por acá.
  app.post("/medico/pacientes/:pacienteId/llave", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const destino = String(req.body?.telefono || paciente.telefono || "").replace(/\D/g, "");
    if (!destino) throw new ErrorHttp(400, "No hay un teléfono al que mandarla. Cargalo en la ficha o escribilo acá.");

    // Emitir una nueva revoca la anterior. Es lo que hace que «se me fue al
    // número equivocado» tenga arreglo, y por eso se revoca ANTES de crear:
    // el índice único parcial de LlavePaciente no deja dos vivas.
    await LlavePaciente.updateMany({ pacienteId: paciente._id, revocadaEn: null }, { $set: { revocadaEn: new Date() } });
    const llave = await LlavePaciente.create({
      pacienteId: paciente._id, medicoPhone, token: nuevoToken(),
      emitidaPor: medicoPhone, enviadaA: destino,
    });

    const enlace = enlaceLlave(llave, req);
    const primerNombre = String(paciente.nombre || "").split(" ")[0];
    // El mensaje no dice ni un diagnóstico ni una especialidad: la vista
    // previa de WhatsApp se ve en la pantalla bloqueada. Mismo criterio que
    // el informe de avance (ver routes/informeFamilia.js).
    const texto =
      `Hola ${primerNombre}. Este es el enlace a tu historia clínica.\n\n` +
      `Desde ahí podés verla y, si vas a otro médico, generar un enlace para mostrársela. ` +
      `No hace falta contraseña.\n\n${enlace}\n\n` +
      `Guardá este mensaje y no lo reenvíes: quien lo tenga puede abrir tu historia.`;

    try {
      await enviarTextoOPlantilla(destino, texto,
        { plantilla: PLANTILLAS.llavePaciente, parametros: [primerNombre, enlace] });
    } catch (e) {
      log.error("[RESUMEN] falló el envío de la llave:", e.response?.data?.error?.message || e.message);
      // La llave YA existe y es válida: que el envío falle no es motivo para
      // perderla. Se le devuelve el enlace al médico para que lo mande él.
      registrar({ req, medicoPhone, accion: "emitir_llave_paciente", recurso: `Paciente:${paciente._id}`, detalle: "envío falló" });
      return res.json({ ok: true, enlace, enviadaA: null,
        aviso: "No se pudo mandar por WhatsApp. Copiá el enlace y mandáselo vos." });
    }

    registrar({ req, medicoPhone, accion: "emitir_llave_paciente", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true, enlace, enviadaA: destino });
  }));

  app.post("/medico/pacientes/:pacienteId/llave/revocar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const n = await LlavePaciente.updateMany({ pacienteId: paciente._id, revocadaEn: null },
      { $set: { revocadaEn: new Date() } });
    registrar({ req, medicoPhone, accion: "revocar_llave_paciente", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true, revocadas: n.modifiedCount || 0 });
  }));

  // ═══ LADO PACIENTE (por la llave, sin cuenta) ═══════════════════════════

  async function llaveOFallar(token) {
    if (!token || token.length < 20) throw new ErrorHttp(404, "Este enlace no es válido.");
    const llave = await LlavePaciente.findOne({ token, revocadaEn: null });
    if (!llave) throw new ErrorHttp(404, "Este enlace ya no es válido. Pedile uno nuevo a tu consultorio.");
    return llave;
  }

  // Lo que el paciente ve de lo suyo: el alcance completo, siempre. Lo que
  // elige es qué COMPARTIR, no qué mirar.
  app.get("/mi/:llave/datos", limitLlave, asyncRoute(async (req, res) => {
    const llave = await llaveOFallar(req.params.llave);
    const paciente = await Paciente.findOne({ _id: llave.pacienteId, medicoPhone: llave.medicoPhone });
    if (!paciente) throw new ErrorHttp(404, "Esta ficha ya no existe.");

    llave.usos = (llave.usos || 0) + 1;
    llave.ultimoUso = new Date();
    await llave.save();

    const secciones = normalizarSecciones(null, "completo");
    const datos = await leerKardex(paciente);
    const mios = await ResumenCompartido.find({ pacienteId: paciente._id, generadoPor: "paciente" })
      .sort({ createdAt: -1 }).limit(20).lean();

    res.json({
      contenido: armarContenido(datos, { alcance: "completo", secciones }),
      firma: await firmaDe(llave.medicoPhone),
      secciones: SECCIONES,
      porDefecto: { resumen: seccionesPorDefecto("resumen"), completo: seccionesPorDefecto("completo") },
      compartidos: mios.map(r => paraElQueLoGenero(r, req)),
      diasValidez: DIAS_VALIDEZ,
    });
  }));

  // El paciente genera su propio enlace. No pide permiso a nadie: ver el
  // encabezado de este archivo.
  app.post("/mi/:llave/compartir", limitLlave, asyncRoute(async (req, res) => {
    const llave = await llaveOFallar(req.params.llave);
    const paciente = await Paciente.findOne({ _id: llave.pacienteId, medicoPhone: llave.medicoPhone });
    if (!paciente) throw new ErrorHttp(404, "Esta ficha ya no existe.");

    const alcance = req.body?.alcance === "completo" ? "completo" : "resumen";
    const secciones = normalizarSecciones(req.body?.secciones, alcance);
    const datos = await leerKardex(paciente);

    const r = await ResumenCompartido.create({
      pacienteId: paciente._id, medicoPhone: llave.medicoPhone,
      generadoPor: "paciente", ...(await firmaDe(llave.medicoPhone)),
      alcance, secciones, contenido: armarContenido(datos, { alcance, secciones }),
      token: nuevoToken(), tokenExpira: new Date(Date.now() + DIAS_VALIDEZ * 86400000),
    });

    // Queda en el mismo registro que lo del médico. El paciente no tiene
    // sesión, así que se anota bajo el consultorio de la ficha, diciendo que
    // el acto fue del paciente.
    registrar({ req, medicoPhone: llave.medicoPhone, accion: "compartir_resumen_paciente",
      recurso: `Paciente:${paciente._id}`, detalle: alcance });
    res.json({ ok: true, resumen: paraElQueLoGenero(r, req), enlace: enlaceResumen(r, req) });
  }));

  // El paciente revoca lo que el paciente generó. Lo que generó el médico lo
  // revoca el médico: cada uno corta lo suyo, que es lo único que no genera
  // una discusión sobre quién le sacó el acceso a quién.
  app.post("/mi/:llave/compartidos/:id/revocar", limitLlave, asyncRoute(async (req, res) => {
    const llave = await llaveOFallar(req.params.llave);
    const r = await ResumenCompartido.findOne({
      _id: req.params.id, pacienteId: llave.pacienteId, generadoPor: "paciente",
    });
    if (!r) throw new ErrorHttp(404, "Ese enlace no existe.");
    if (!r.revocadoEn) {
      r.revocadoEn = new Date();
      r.revocadoPor = "paciente";
      await r.save();
      registrar({ req, medicoPhone: llave.medicoPhone, accion: "revocar_resumen_paciente",
        recurso: `ResumenCompartido:${r._id}` });
    }
    res.json({ ok: true, resumen: paraElQueLoGenero(r, req) });
  }));

  // ═══ LA PUERTA PÚBLICA: el colega que recibe el enlace ══════════════════

  app.get("/r/:token/datos", limitPublico, asyncRoute(async (req, res) => {
    const token = req.params.token;
    if (!token || token.length < 20) throw new ErrorHttp(404, "Este enlace no es válido.");
    const r = await ResumenCompartido.findOne({ token });
    if (!r) throw new ErrorHttp(404, "Este resumen no existe o el enlace ya no es válido.");
    if (r.revocadoEn) throw new ErrorHttp(410, "Quien compartió este resumen dio de baja el enlace.");
    if (r.tokenExpira < new Date()) throw new ErrorHttp(410, "Este enlace venció. Pedí uno nuevo a quien te lo mandó.");

    r.vistas = (r.vistas || 0) + 1;
    if (!r.vistoEn) r.vistoEn = new Date();
    await r.save();

    res.json({ resumen: paraElQueLoRecibe(r) });
  }));

  // ═══ EL EMBUDO ══════════════════════════════════════════════════════════
  //
  // Un médico que abre este enlace es el único que llega a Symphomed sin que
  // nadie lo haya ido a buscar: lo trajo su propio paciente, y ya vio el
  // producto funcionando sobre un caso que le importa.
  //
  // Sin estos dos números, en seis meses nadie va a poder decir si esto trajo
  // un cliente o si fue una función linda que no movió nada. Y esa respuesta
  // decide si se le pone más trabajo encima o se deja como está.

  // Tocó «importar» sin tener cuenta. Es interés, no una solicitud: la mitad
  // de arriba del embudo, que es la que no se ve en ningún otro lado.
  app.post("/r/:token/interes", limitPublico, asyncRoute(async (req, res) => {
    await ResumenCompartido.updateOne({ token: req.params.token }, { $inc: { interesProfesional: 1 } });
    res.json({ ok: true });
  }));

  // ═══ IMPORTAR A MI KARDEX ═══════════════════════════════════════════════
  //
  // Lo que de verdad quiere el médico que recibe el enlace: no volver a
  // tipear a este paciente. Es la única parte de todo esto que le ahorra
  // trabajo a ÉL, y por eso es el botón principal de la página.
  //
  // ═══ QUÉ SE IMPORTA, Y POR QUÉ TAN POCO ═════════════════════════════════
  //
  // Se crea una ficha con la identidad y las alergias, y el resumen queda
  // adjunto como una nota con su enlace. NO se copian las consultas del otro
  // médico adentro de la ficha nueva.
  //
  // Es deliberado y es lo más importante de esta función: las consultas de
  // otro consultorio no son las de este. Copiadas adentro quedan
  // indistinguibles de las propias, y en un año nadie sabe cuáles escribió él
  // y cuáles heredó — con su firma encima de las dos. Lo que se hereda es el
  // contexto, no la autoría.
  //
  // Las alergias sí se copian, por lo mismo que se comparten entre médicos de
  // una clínica (ver PersonaClinica en db/models.js): no son un diagnóstico,
  // son una advertencia sobre qué NO darle, y es exactamente el dato que hace
  // falta antes de la primera receta.
  app.post("/r/:token/importar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await ResumenCompartido.findOne({ token: req.params.token });
    if (!r) throw new ErrorHttp(404, "Este resumen no existe o el enlace ya no es válido.");
    if (r.revocadoEn) throw new ErrorHttp(410, "Quien compartió este resumen dio de baja el enlace.");
    if (r.tokenExpira < new Date()) throw new ErrorHttp(410, "Este enlace venció.");

    // Su propio resumen no se importa: le crearía una ficha duplicada del
    // paciente que ya tiene abierto.
    if (r.medicoPhone === medicoPhone) {
      throw new ErrorHttp(409, "Este resumen salió de tu propio consultorio: el paciente ya está en tu kardex.");
    }

    const ident = r.contenido?.identidad || {};
    const nombre = String(ident.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(422, "Este resumen no trae el nombre del paciente, así que no se puede crear la ficha.");

    // Si ya lo importó antes, se le devuelve el que hay en vez de crear otro.
    // Tocar dos veces el botón —que va a pasar— no puede dejarle dos fichas
    // del mismo paciente, que después hay que fusionar a mano.
    const yaEsta = await Paciente.findOne({ medicoPhone, nombre,
      ...(ident.fechaNacimiento ? { fechaNacimiento: new Date(ident.fechaNacimiento) } : {}) }).lean();
    if (yaEsta) return res.json({ ok: true, pacienteId: yaEsta._id, yaExistia: true });

    const alergias = r.contenido?.alergias?.lista || [];
    const deDonde = r.firmaCentro || r.firmaNombre || "otro consultorio";
    const paciente = await Paciente.create({
      medicoPhone, nombre,
      fechaNacimiento: ident.fechaNacimiento ? new Date(ident.fechaNacimiento) : null,
      sexo: ident.sexo || "",
      // Las alergias entran como antecedente porque esta ficha todavía no
      // está vinculada a ninguna PersonaClinica —eso lo confirma el médico a
      // mano, nunca el sistema—. Prefijadas para que se vean como lo que son:
      // algo que llegó de afuera y que conviene confirmar con el paciente.
      antecedentesPersonales: alergias.map(a => `Alergia: ${a} (según resumen de ${deDonde})`),
      notas: `Ficha creada desde un resumen clínico compartido por el paciente.\n` +
             `Origen: ${deDonde}.\n` +
             `El resumen completo está en ${base(req)}/r/${r.token} (vence el ${r.tokenExpira.toISOString().slice(0, 10)}).`,
    });

    if (!r.importadoPor.includes(medicoPhone)) {
      r.importadoPor.push(medicoPhone);
      await r.save();
    }

    registrar({ req, medicoPhone, accion: "importar_resumen",
      recurso: `Paciente:${paciente._id}`, detalle: `de ${r.medicoPhone}` });
    res.json({ ok: true, pacienteId: paciente._id, yaExistia: false });
  }));
};
