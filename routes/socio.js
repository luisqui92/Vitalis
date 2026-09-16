// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — El panel del socio
// ═══════════════════════════════════════════════════════════════════════════
//
// Un socio compra cupos al por mayor y los revende a su precio. Acá ve su
// cartera, da de alta clientes, mira cuánto consumen y cuánto le queda.
//
// LO QUE ESTE PANEL NO HACE, Y NO VA A HACER: mostrar un paciente. Ni el
// nombre, ni cuántos tiene cada médico por nombre y apellido, ni una sola
// línea de historia clínica. Un socio es un vendedor; el secreto médico no
// se reparte por la cadena comercial. Por eso el rol "socio" no pasa por
// requireAuth(["medico"]) y estas rutas no importan un solo modelo clínico.
//
// La regla de qué puede ver vive en services/socios.js, no acá.
const { Socio, Clinica, Medico, LoteCupos } = require("../db/models");
const { requireSocio, generarToken, verificarPassword, hashPassword } = require("../services/auth");
const { limitAuth, limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { cuposDe, exigirCupoLibre, clinicaDelSocio, medicoDelSocio, socioDeLaSesion } = require("../services/socios");
const { zonaPorMoneda } = require("../services/zonaHoraria");
const { log } = require("../config");

// Cuántas cuentas devuelve la cartera de una vez. Un socio con mil clientes
// no necesita verlos todos en una pantalla, y traerlos todos es el problema
// que ya tiene la lista de pacientes.
const TOPE_CARTERA = 200;

// Lo que se puede contar de una cuenta SIN contar nada clínico.
//
// Este proyector es la frontera del panel. Todo lo que devuelve la cartera
// pasa por acá, y por eso la lista de campos es explícita y corta en vez de
// un "todo menos algunas cosas": una lista negra se desactualiza sola el día
// que alguien agrega un campo al modelo, y ese día el campo nuevo sale por
// la API sin que nadie lo haya decidido.
function paraElSocio(cuenta, tipo) {
  return {
    tipo,                                   // "clinica" | "profesional"
    id: String(cuenta._id),
    nombre: cuenta.nombre,
    // El teléfono es cómo el socio contacta a SU cliente. Es su cliente.
    contacto: tipo === "clinica" ? (cuenta.telefono || "") : (cuenta.phone || ""),
    ciudad: cuenta.ciudad || "",
    activa: tipo === "clinica" ? cuenta.activa !== false : cuenta.activo !== false,
    plan: cuenta.suscripcion?.plan || "",
    planHasta: cuenta.suscripcion?.hasta || null,
    desde: cuenta.createdAt,
    // Solo para profesionales sueltos: cómo va de saldo. Es dato comercial
    // —le dice al socio a quién llamar para que recargue— y no dice nada de
    // ningún paciente.
    saldoCentavos: tipo === "profesional" ? (cuenta.saldoCentavos || 0) : null,
    especialidad: tipo === "profesional" ? (cuenta.especialidad || "") : "",
  };
}

module.exports = function (app) {
  // ═══ LOGIN ═══════════════════════════════════════════════════════════════
  //
  // Puerta aparte de la del médico y a propósito: un socio no tiene por qué
  // aparecer en la pantalla de login de los profesionales, ni al revés.
  //
  // Mismo orden que el login del médico: primero se verifica la contraseña y
  // RECIÉN DESPUÉS se mira si la cuenta está activa. Al revés, cualquiera
  // podría averiguar qué teléfonos son socios de Symphomed probando números.
  app.post("/socio/login", limitAuth, asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "");
    if (!phone || !password) throw new ErrorHttp(400, "phone y password son requeridos");

    const socio = await Socio.findOne({ phone });
    const { ok } = socio
      ? await verificarPassword(password, socio.passwordHash)
      : { ok: false };

    if (!ok) {
      registrar({ req, medicoPhone: phone, accion: "socio_login_fallido", exito: false });
      throw new ErrorHttp(401, "Teléfono o contraseña incorrectos");
    }
    if (!socio.activo) {
      registrar({ req, medicoPhone: phone, accion: "socio_login_inactivo", exito: false });
      throw new ErrorHttp(403, "Tu cuenta de socio está suspendida. Escribinos.");
    }

    const token = generarToken(socio.phone, "socio", 8 * 60 * 60 * 1000, { socioId: String(socio._id) });
    registrar({ req, medicoPhone: phone, accion: "socio_login" });
    res.json({ ok: true, token, nombre: socio.nombre, moneda: socio.moneda });
  }));

  // ═══ EL TABLERO ══════════════════════════════════════════════════════════
  app.get("/socio/resumen", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const socio = await socioDeLaSesion(req);
    const cupos = await cuposDe(socio._id);

    // Cuánto le cuesta al socio lo que tiene colocado, por mes. Lo que le
    // cobra a su cliente no está acá porque Symphomed no lo sabe: es su
    // precio y su margen.
    const costoMensualCentavos = cupos.usados * (socio.precioMayoristaCentavos || 0);

    res.json({
      socio: {
        nombre: socio.nombre, phone: socio.phone, moneda: socio.moneda,
        precioMayoristaCentavos: socio.precioMayoristaCentavos || 0,
      },
      cupos: {
        comprados: cupos.comprados,
        usados: cupos.usados,
        disponibles: cupos.disponibles,
        porClinicas: cupos.porClinicas,
        porProfesionales: cupos.porProfesionales,
      },
      costoMensualCentavos,
      invertidoCentavos: cupos.invertidoCentavos,
    });
  }));

  // ─── LA CARTERA ──────────────────────────────────────────────────────────
  app.get("/socio/cuentas", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const socioId = req.socioId;
    const [clinicas, medicos] = await Promise.all([
      Clinica.find({ socioId })
        .select("nombre telefono ciudad activa suscripcion createdAt")
        .sort({ nombre: 1 }).limit(TOPE_CARTERA).lean(),
      // Solo los sueltos: los que están dentro de una clínica ya aparecen
      // como parte de ella, y listarlos aparte haría contar dos veces al
      // mismo cliente.
      Medico.find({ socioId, clinicaId: null })
        .select("nombre phone activo especialidad suscripcion saldoCentavos createdAt")
        .sort({ nombre: 1 }).limit(TOPE_CARTERA).lean(),
    ]);

    res.json({
      cuentas: [
        ...clinicas.map(c => paraElSocio(c, "clinica")),
        ...medicos.map(m => paraElSocio(m, "profesional")),
      ],
      tope: TOPE_CARTERA,
    });
  }));

  // ═══ DAR DE ALTA ═════════════════════════════════════════════════════════
  //
  // Acá se gasta un cupo. Se verifica SIEMPRE contra la base y no contra lo
  // que dijo la pantalla: dos altas simultáneas con un solo cupo libre
  // pasarían las dos si se confiara en el número que el navegador ya tenía.
  app.post("/socio/clinicas", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const socio = await socioDeLaSesion(req);
    await exigirCupoLibre(socio._id);

    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "La cuenta necesita un nombre");

    const clinica = await Clinica.create({
      nombre,
      ciudad: String(req.body?.ciudad || "").trim(),
      direccion: String(req.body?.direccion || "").trim(),
      telefono: String(req.body?.telefono || "").trim(),
      socioId: socio._id,
      activa: true,
    });
    registrar({ req, medicoPhone: socio.phone, accion: "socio_alta_clinica", recurso: `Clinica:${clinica._id}` });
    log.info(`[SOCIOS] ${socio.nombre} dio de alta el centro "${nombre}"`);
    res.status(201).json({ ok: true, cuenta: paraElSocio(clinica, "clinica") });
  }));

  app.post("/socio/profesionales", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const socio = await socioDeLaSesion(req);
    await exigirCupoLibre(socio._id);

    const nombre = String(req.body?.nombre || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "");
    if (!nombre || !phone) throw new ErrorHttp(400, "nombre y phone son requeridos");
    if (password.length < 8) throw new ErrorHttp(400, "La contraseña tiene que tener al menos 8 caracteres");
    if (await Medico.findOne({ phone })) throw new ErrorHttp(409, "Ya existe una cuenta con ese teléfono");

    const medico = await Medico.create({
      phone, nombre,
      especialidad: String(req.body?.especialidad || "").trim(),
      tipoEspecialidad: String(req.body?.tipoEspecialidad || "medicina_general"),
      passwordHash: await hashPassword(password),
      socioId: socio._id,
      // La moneda y la zona horaria salen del socio: un socio brasileño está
      // vendiendo en Brasil. Es un punto de partida, no una atadura — las dos
      // se pueden cambiar después. Sin esto, cada cuenta que dé de alta un
      // socio de Brasil nace con la agenda en hora de Bolivia.
      moneda: socio.moneda === "BRL" ? "BRL" : "BOB",
      zonaHoraria: zonaPorMoneda(socio.moneda),
      // Entra directo: al socio ya lo aprobó Symphomed, y hacerle esperar la
      // cola de solicitudes a un cliente que él ya cobró sería mandarlo a
      // pedir permiso por algo que ya pagó.
      activo: true,
      estadoCuenta: "aprobada",
    });
    registrar({ req, medicoPhone: socio.phone, accion: "socio_alta_profesional", recurso: `Medico:${phone}` });
    log.info(`[SOCIOS] ${socio.nombre} dio de alta al profesional ${nombre} (${phone})`);
    res.status(201).json({ ok: true, cuenta: paraElSocio(medico, "profesional") });
  }));

  // ─── EDITAR LOS DATOS DE CONTACTO DE UNA CUENTA SUYA ─────────────────────
  app.patch("/socio/clinicas/:id", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const clinica = await clinicaDelSocio(req.socioId, req.params.id);
    for (const campo of ["nombre", "ciudad", "direccion", "telefono"]) {
      if (req.body?.[campo] !== undefined) clinica[campo] = String(req.body[campo]).trim();
    }
    await clinica.save();
    res.json({ ok: true, cuenta: paraElSocio(clinica, "clinica") });
  }));

  // ═══ PEDIR LA BAJA ═══════════════════════════════════════════════════════
  //
  // El socio PIDE la baja, no la ejecuta. Es deliberado y no es desconfianza:
  // el cupo se libera al desactivar, así que si el socio pudiera apagar y
  // prender cuentas solo, podría desactivar todo el 30 de cada mes, no pagar,
  // y reactivar el 1. Que la baja pase por Symphomed corta eso sin tener que
  // inventar reglas de "no podés reactivar antes de N días", que son las que
  // después nadie entiende.
  //
  // Y hay una razón más seria: adentro de esa cuenta hay historias clínicas
  // de pacientes reales. Apagarla es algo que decide quien responde por esos
  // datos, no quien la vendió.
  app.post("/socio/cuentas/:tipo/:id/baja", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const socio = await socioDeLaSesion(req);
    const motivo = String(req.body?.motivo || "").trim();

    const cuenta = req.params.tipo === "clinica"
      ? await clinicaDelSocio(socio._id, req.params.id)
      : await medicoDelSocio(socio._id, req.params.id);

    registrar({
      req, medicoPhone: socio.phone, accion: "socio_pide_baja",
      recurso: `${req.params.tipo}:${req.params.id}`, detalle: motivo,
    });
    log.info(`[SOCIOS] ${socio.nombre} pide la baja de ${cuenta.nombre} — ${motivo || "sin motivo"}`);

    res.json({
      ok: true,
      pedida: true,
      aviso: "La baja quedó pedida. Symphomed la procesa y el cupo se libera cuando se confirma.",
    });
  }));

  // ═══ LOS CUPOS ═══════════════════════════════════════════════════════════
  app.get("/socio/cupos", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const socio = await socioDeLaSesion(req);
    const cupos = await cuposDe(socio._id);
    res.json({
      ...cupos,
      precioMayoristaCentavos: socio.precioMayoristaCentavos || 0,
      moneda: socio.moneda,
    });
  }));

  // El socio NO se carga sus propios lotes: los carga Symphomed cuando
  // cobra. Un botón de "agregar 50 cupos" en el panel del socio es un botón
  // de emitir crédito contra uno mismo.
  //
  // Esta ruta existe solo para que el socio vea qué compró y cuándo, que es
  // lo que va a mirar cuando el número no le cierre.
  app.get("/socio/cupos/lotes", limitMedico, requireSocio, asyncRoute(async (req, res) => {
    const lotes = await LoteCupos.find({ socioId: req.socioId })
      .sort({ fecha: -1 }).limit(100).lean();
    res.json({ lotes });
  }));
};
