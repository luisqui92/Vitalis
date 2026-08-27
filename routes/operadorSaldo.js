// Vitalis — Pantalla de operador: acreditar recargas sin entrar por SSH.
//
// ═══ ESTE ES EL ENDPOINT MÁS PELIGROSO DEL SISTEMA ═════════════════════════
//
// Todo lo demás lee o escribe datos clínicos. Esto FABRICA DINERO. Quien
// llegue acá puede darse saldo infinito, y encima el fraude no se ve como un
// error: se ve como una recarga más entre otras.
//
// Por eso está protegido con tres candados independientes, y hacen falta los
// tres a la vez:
//
//   1. UNA LISTA EN EL .env, no un permiso en la base.
//      OPERADORES_SALDO=62741818,71234567
//      Si el permiso viviera en la base de datos, quien consiga escribir en
//      Mongo —o cualquier futuro bug de escalada de privilegios— se hace
//      operador solo. Estando en el entorno, para dárselo hay que tener
//      acceso al servidor, que es exactamente el nivel que corresponde para
//      crear plata.
//
//   2. SEGUNDO FACTOR OBLIGATORIO.
//      Una cuenta de operador sin 2FA queda a un phishing de distancia de
//      poder emitir saldo. Si no lo tiene activo, estas rutas no le
//      responden y le dicen que lo active.
//
//   3. TODO QUEDA AUDITADO, con el nombre real de quien acreditó.
//      El script usaba el usuario de Linux y todos figuraban igual. Acá cada
//      movimiento lleva el teléfono del operador que lo hizo.
//
// Lo que este archivo NO hace: crear cuentas, cambiar contraseñas, ver
// historias clínicas. Un operador de recargas administra plata y nada más.
const { Medico, SolicitudRecarga } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { rateLimitPorClave, claveDeMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const saldos = require("../services/saldo");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// Los teléfonos habilitados, del entorno. Vacío = la pantalla no existe para
// nadie, que es el estado correcto por defecto: si alguien despliega Vitalis
// sin configurar esto, nadie puede emitir saldo, en vez de que pueda cualquiera.
const OPERADORES = String(process.env.OPERADORES_SALDO || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Por OPERADOR, no por IP. Con la cuota por IP, dos personas acreditando
// desde la misma oficina se la reparten, y un solo operador procesando diez
// avisos seguidos —que son varias llamadas cada uno— se bloquea a sí mismo a
// mitad de la tarea. Es el mismo error que ya había en limitMedico y que se
// arregló ahí; acá lo repetí y lo encontró la prueba, quedándose sin cuota
// contra 127.0.0.1.
//
// La firma del token se verifica antes de usarlo como clave (ver
// claveDeMedico): si no, cualquiera podría gastarle la cuota a un operador
// mandando pedidos a su nombre.
const limitOperador = rateLimitPorClave("operadorSaldo", 60, 60 * 1000,
  "Demasiadas operaciones seguidas. Esperá un momento.", claveDeMedico);

function esOperador(phone) {
  return OPERADORES.includes(String(phone));
}

// Los tres candados, en un solo lugar para que ninguna ruta se olvide de uno.
function requireOperador(req, res, next) {
  const phone = req.adminUser?.usuario;
  if (!esOperador(phone)) {
    // El mismo mensaje que si no existiera la ruta: a quien no es operador no
    // se le confirma que esta pantalla existe.
    log.warn(`[OPERADOR_SALDO] ${phone} intentó entrar y no está en OPERADORES_SALDO`);
    registrar({ req, medicoPhone: phone, accion: "operador_saldo_denegado", exito: false });
    return res.status(404).json({ error: "No encontrado" });
  }
  Medico.findOne({ phone }).select("dosFA nombre").lean()
    .then((medico) => {
      if (!medico?.dosFA?.activo) {
        return res.status(403).json({
          error: "Para acreditar saldo tenés que tener la verificación en dos pasos activa. Activala en Configuración y volvé a entrar.",
          requiere2fa: true,
        });
      }
      req.operador = medico;
      next();
    })
    .catch(next);
}

module.exports = function (app) {
  // ─── ¿SOY OPERADOR? ────────────────────────────────────────────────────
  // La pantalla pregunta esto para saber si mostrar la sección. Contesta
  // false sin ruido para todo el mundo: no es un permiso que se pida, es uno
  // que se tiene o no.
  app.get("/medico/operador/estado", limitOperador, requireMedico, asyncRoute(async (req, res) => {
    const phone = req.adminUser.usuario;
    if (!esOperador(phone)) return res.json({ operador: false });
    const medico = await Medico.findOne({ phone }).select("dosFA").lean();
    res.json({
      operador: true,
      // Si le falta el 2FA se lo decimos acá, para que la pantalla se lo pida
      // antes de que intente acreditar y le rebote.
      dosFAActivo: Boolean(medico?.dosFA?.activo),
      recargaMinimaCentavos: saldos.RECARGA_MINIMA,
      precioConsultaCentavos: saldos.PRECIO_CONSULTA,
    });
  }));

  // ─── BUSCAR AL MÉDICO A QUIEN ACREDITAR ────────────────────────────────
  // Devuelve identidad y saldo, nada clínico: un operador de recargas no
  // tiene por qué ver cuántos pacientes tiene nadie.
  app.get("/medico/operador/buscar", limitOperador, requireMedico, requireOperador, asyncRoute(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 3) return res.json({ medicos: [] });

    const porNombre = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const medicos = await Medico.find({ $or: [{ phone: porNombre }, { nombre: porNombre }] })
      .select("phone nombre tipoEspecialidad saldoCentavos activo")
      .limit(15)
      .lean();

    res.json({
      medicos: medicos.map(m => ({
        phone: m.phone, nombre: m.nombre,
        tipoEspecialidad: m.tipoEspecialidad || "",
        activo: m.activo !== false,
        saldoCentavos: m.saldoCentavos || 0,
        saldoBs: saldos.bolivianos(m.saldoCentavos || 0),
      })),
    });
  }));

  // ─── VER UNA CUENTA ANTES DE ACREDITARLE ───────────────────────────────
  app.get("/medico/operador/cuenta/:phone", limitOperador, requireMedico, requireOperador, asyncRoute(async (req, res) => {
    const phone = String(req.params.phone).trim();
    const medico = await Medico.findOne({ phone }).select("phone nombre tipoEspecialidad activo").lean();
    if (!medico) throw new ErrorHttp(404, "No hay ninguna cuenta con ese teléfono");
    const [estado, movimientos] = await Promise.all([
      saldos.estadoDe(phone),
      saldos.movimientosDe(phone, 20),
    ]);
    res.json({ medico, ...estado, movimientos });
  }));

  // ─── LA COLA DE AVISOS DE PAGO ─────────────────────────────────────────
  // Lo que el operador mira apenas entra: quién dice haber pagado y todavía
  // no se le acreditó. Los más viejos primero — el que avisó ayer viene
  // esperando más que el de recién.
  app.get("/medico/operador/solicitudes", limitOperador, requireMedico, requireOperador, asyncRoute(async (req, res) => {
    const estado = ["pendiente", "acreditada", "rechazada"].includes(req.query.estado) ? req.query.estado : "pendiente";
    const solicitudes = await SolicitudRecarga.find({ estado })
      .sort(estado === "pendiente" ? { createdAt: 1 } : { revisadaEn: -1 })
      .limit(50).lean();

    // El saldo actual de cada uno, para que el operador vea de una si el
    // médico está trabajando en negativo y conviene apurarse.
    const conSaldo = await Promise.all(solicitudes.map(async (s) => ({
      ...s,
      montoBs: saldos.bolivianos(s.montoCentavos),
      saldo: await saldos.estadoDe(s.medicoPhone),
    })));

    res.json({
      estado, solicitudes: conSaldo,
      pendientes: await SolicitudRecarga.countDocuments({ estado: "pendiente" }),
    });
  }));

  // ─── APROBAR UN AVISO ──────────────────────────────────────────────────
  //
  // El monto que se acredita es el que el OPERADOR vio en el banco, no el que
  // el médico declaró. Por eso viene como parámetro y no se toma de la
  // solicitud: si el médico dijo Bs 200 y entraron Bs 150, se acreditan 150 y
  // queda registrada la diferencia. Confiar en el número declarado sería
  // dejar que el médico se ponga su propio saldo con un paso extra.
  app.post("/medico/operador/solicitudes/:id/aprobar", limitOperador, requireMedico, requireOperador, asyncRoute(async (req, res) => {
    const solicitud = await SolicitudRecarga.findOne({ _id: req.params.id, estado: "pendiente" });
    if (!solicitud) throw new ErrorHttp(404, "Ese aviso ya no está pendiente");

    // Si no se aclara otra cosa, se acredita lo declarado — pero el operador
    // puede corregirlo, que es el caso que importa.
    const bolivianos = req.body?.bolivianos === undefined
      ? solicitud.montoCentavos / 100
      : Number(req.body.bolivianos);
    const referencia = String(req.body?.referencia || solicitud.referencia || "").trim();
    if (!Number.isFinite(bolivianos) || bolivianos <= 0) throw new ErrorHttp(400, "El monto tiene que ser un número positivo");
    if (bolivianos > 5000) throw new ErrorHttp(400, "Más de Bs 5.000 en una sola carga: si es correcto, hacelo desde el servidor.");
    if (!referencia) throw new ErrorHttp(400, "Falta la referencia del comprobante");

    let mov;
    try {
      mov = await saldos.cargar({
        medicoPhone: solicitud.medicoPhone,
        montoCentavos: Math.round(bolivianos * 100),
        acreditadoPor: req.adminUser.usuario,
        referencia,
        permitirMenorAlMinimo: Boolean(req.body?.igual),
      });
    } catch (e) {
      // La solicitud queda PENDIENTE: no se acreditó nada, así que marcarla
      // como resuelta sería mentir y dejar al médico esperando para siempre.
      if (e.codigo === "referencia_repetida") throw new ErrorHttp(409, e.message);
      if (e.codigo === "menor_al_minimo") throw new ErrorHttp(422, e.message);
      throw e;
    }

    solicitud.estado = "acreditada";
    solicitud.movimientoId = mov._id;
    solicitud.montoAcreditadoCentavos = Math.round(bolivianos * 100);
    solicitud.revisadaPor = req.adminUser.usuario;
    solicitud.revisadaEn = new Date();
    await solicitud.save();

    registrar({
      req, medicoPhone: req.adminUser.usuario, accion: "aprobar_recarga",
      recurso: `Solicitud:${solicitud._id} Medico:${solicitud.medicoPhone} Bs${bolivianos}`,
    });
    res.json({ ok: true, ...(await saldos.estadoDe(solicitud.medicoPhone)) });
  }));

  // ─── RECHAZAR ──────────────────────────────────────────────────────────
  // Con motivo obligatorio. Un rechazo sin explicación deja al médico sin
  // saber si tiene que volver a pagar, mandar otro comprobante o llamar.
  app.post("/medico/operador/solicitudes/:id/rechazar", limitOperador, requireMedico, requireOperador, asyncRoute(async (req, res) => {
    const motivo = String(req.body?.motivo || "").trim().slice(0, 300);
    if (!motivo) throw new ErrorHttp(400, "Escribí por qué se rechaza: el médico tiene que saber qué hacer ahora.");

    const solicitud = await SolicitudRecarga.findOne({ _id: req.params.id, estado: "pendiente" });
    if (!solicitud) throw new ErrorHttp(404, "Ese aviso ya no está pendiente");

    solicitud.estado = "rechazada";
    solicitud.motivoRechazo = motivo;
    solicitud.revisadaPor = req.adminUser.usuario;
    solicitud.revisadaEn = new Date();
    await solicitud.save();

    registrar({
      req, medicoPhone: req.adminUser.usuario, accion: "rechazar_recarga",
      recurso: `Solicitud:${solicitud._id} Medico:${solicitud.medicoPhone}`,
    });
    res.json({ ok: true });
  }));

  // ─── ACREDITAR ─────────────────────────────────────────────────────────
  // La operación que crea dinero. Reusa services/saldo.js sin atajos: el
  // mínimo, el rechazo de referencias repetidas y el libro de movimientos son
  // los mismos que usa el script. Dos caminos distintos para crear plata, con
  // reglas distintas, es cómo aparecen los agujeros.
  app.post("/medico/operador/acreditar", limitOperador, requireMedico, requireOperador, asyncRoute(async (req, res) => {
    const destino = String(req.body?.phone || "").trim();
    const bolivianos = Number(req.body?.bolivianos);
    const referencia = String(req.body?.referencia || "").trim();
    const igual = Boolean(req.body?.igual);

    if (!destino) throw new ErrorHttp(400, "Falta el teléfono del médico");
    if (!Number.isFinite(bolivianos) || bolivianos <= 0) throw new ErrorHttp(400, "El monto tiene que ser un número positivo");
    // Se valida acá y no solo adentro de cargar(): desde el servicio sale
    // como Error común, y asyncRoute lo convierte en un 500 "Error interno"
    // que al operador no le dice nada. Un dato que falta es culpa de quien
    // llena el formulario, no del servidor.
    if (!referencia) throw new ErrorHttp(400, "Falta la referencia del comprobante. Sin ella la misma carga se puede acreditar dos veces sin que nadie lo note.");
    // Un techo por operación. No protege de un operador deshonesto —puede
    // hacer varias— pero sí de un dedo que se resbala en el teclado numérico
    // y convierte Bs 200 en Bs 200000.
    if (bolivianos > 5000) throw new ErrorHttp(400, "Más de Bs 5.000 en una sola carga: si es correcto, hacelo desde el servidor.");

    const medico = await Medico.findOne({ phone: destino }).select("nombre").lean();
    if (!medico) throw new ErrorHttp(404, "No hay ninguna cuenta con ese teléfono");

    try {
      const mov = await saldos.cargar({
        medicoPhone: destino,
        montoCentavos: Math.round(bolivianos * 100),
        // El teléfono del operador, no un usuario de Linux compartido: si
        // alguna vez falta plata, el registro tiene que decir quién.
        acreditadoPor: req.adminUser.usuario,
        referencia,
        permitirMenorAlMinimo: igual,
      });
      registrar({
        req, medicoPhone: req.adminUser.usuario, accion: "acreditar_saldo",
        recurso: `Medico:${destino} Bs${bolivianos} ref:${referencia}`,
      });
      const estado = await saldos.estadoDe(destino);
      res.json({ ok: true, movimiento: { _id: mov._id, concepto: mov.concepto }, ...estado });
    } catch (e) {
      // Los dos rechazos con nombre propio se traducen a algo que la pantalla
      // pueda mostrar sin convertirlo en un 500 genérico.
      if (e.codigo === "referencia_repetida") throw new ErrorHttp(409, e.message);
      if (e.codigo === "menor_al_minimo") {
        const err = new ErrorHttp(422, e.message);
        err.publicMessage = e.message;
        throw err;
      }
      throw e;
    }
  }));
};
