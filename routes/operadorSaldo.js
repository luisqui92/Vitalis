// Symphomed — Pantalla de operador: acreditar recargas sin entrar por SSH.
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
const { Medico, SolicitudRecarga, MovimientoSaldo } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { rateLimitPorClave, claveDeMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { esOperador } = require("../services/operadores");
const { notificarMedico } = require("../services/push");
const saldos = require("../services/saldo");
const monedas = require("../services/monedas");
const suscripciones = require("../services/suscripciones");
const { datosDePago, guardarDatosDePago, normalizarPais } = require("../services/datosPago");
const { log } = require("../config");

// ═══ POR QUÉ ACÁ DICE "admin" Y EN LAS RUTAS CLÍNICAS NO ═══════════════════
//
// Quien administra la plata no debería ser el mismo que la gasta. Mientras
// esto exigía rol "medico", un operador de recargas tenía que ser además una
// cuenta de médico: consumía Bs 12 por consulta Y podía aprobar sus propias
// recargas. La separación que uno querría al contratar a alguien para
// manejar cobranzas no se podía ni configurar.
//
// Una cuenta con rol "admin" es exactamente lo contrario: es la cuenta
// administrativa que ya existe en Symphomed y que las 30 rutas clínicas
// rechazan solas (ver el comentario de tokenDeMedico en medicoAuth.js). No
// tiene pacientes, no puede abrir una ficha, no consume saldo. Es la cuenta
// correcta para esto.
//
// Esto NO afloja el permiso: no deja entrar a nadie nuevo. El portero de
// verdad sigue siendo requireOperador —lista en el .env + 2FA— y un admin
// que no esté en OPERADORES_SALDO se lleva el mismo 404 que cualquiera.
// Lo único que cambia es que ahora el operador PUEDE no ser médico.
const requireSesion = requireAuth(["medico", "admin"]);


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
  app.get("/medico/operador/estado", limitOperador, requireSesion, asyncRoute(async (req, res) => {
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
  app.get("/medico/operador/buscar", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 3) return res.json({ medicos: [] });

    const porNombre = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const medicos = await Medico.find({ $or: [{ phone: porNombre }, { nombre: porNombre }] })
      .select("phone nombre tipoEspecialidad saldoCentavos activo moneda")
      .limit(15)
      .lean();

    res.json({
      medicos: medicos.map(m => ({
        phone: m.phone, nombre: m.nombre,
        tipoEspecialidad: m.tipoEspecialidad || "",
        activo: m.activo !== false,
        saldoCentavos: m.saldoCentavos || 0,
        // El operador ve las dos monedas en la misma lista, así que cada
        // médico tiene que decir la suya. Sin esto, "200" al lado de un
        // nombre es un número sin unidad en una pantalla de plata.
        moneda: monedas.normalizar(m.moneda),
        simbolo: monedas.config(m.moneda).simbolo,
        saldoBs: saldos.bolivianos(m.saldoCentavos || 0),
      })),
    });
  }));

  // ─── VER UNA CUENTA ANTES DE ACREDITARLE ───────────────────────────────
  app.get("/medico/operador/cuenta/:phone", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const phone = String(req.params.phone).trim();
    const medico = await Medico.findOne({ phone }).select("phone nombre tipoEspecialidad activo moneda").lean();
    if (!medico) throw new ErrorHttp(404, "No hay ninguna cuenta con ese teléfono");
    const [estado, movimientos] = await Promise.all([
      saldos.estadoDe(phone),
      saldos.movimientosDe(phone, 20),
    ]);
    res.json({ medico, ...estado, movimientos });
  }));

  // ─── DÓNDE NOS PAGAN ───────────────────────────────────────────────────
  // Editable desde la pantalla y no por SSH: es un número de cuenta que
  // cambia, y lo que se cambia con dificultad se queda desactualizado.
  // Acá sí el país viene por parámetro: el operador administra los dos, no
  // solo el suyo. Es lo contrario de la ruta del médico, donde el país sale
  // de su cuenta justamente para que no pueda elegirlo.
  app.get("/medico/operador/datos-pago", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    res.json(await datosDePago(normalizarPais(req.query.pais)));
  }));

  app.put("/medico/operador/datos-pago", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const pais = normalizarPais(req.body?.pais);
    const datos = await guardarDatosDePago(req.body || {}, req.adminUser.usuario, pais);
    // Se audita con el detalle: si un día los pagos empiezan a caer en una
    // cuenta que no es la nuestra, esto dice quién la cambió y cuándo. Y con
    // el país, porque ahora son dos cuentas y "cambió la cuenta" sin decir
    // cuál no alcanza para reconstruir nada.
    registrar({
      req, medicoPhone: req.adminUser.usuario, accion: "cambiar_datos_pago",
      recurso: `[${pais}] ${datos.banco} ${datos.cuenta} (${datos.titular})`,
    });
    res.json({ ok: true, ...datos });
  }));

  // ─── EL PANEL DE PAGOS ─────────────────────────────────────────────────
  //
  // Lo que la cola no dice: cuánto entró, cuánto se consumió, y quiénes están
  // trabajando en negativo. La cola es el trabajo de hoy; esto es el estado
  // del negocio.
  //
  // Todo sale de MovimientoSaldo, que es el libro. No hay un contador aparte
  // que se pueda desincronizar — ver el comentario del modelo en db/models.js.
  app.get("/medico/operador/resumen", limitOperador, requireSesion, requireOperador, asyncRoute(async (_req, res) => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);

    // ═══ SE AGRUPA POR MONEDA, Y NO ES UN DETALLE DE PRESENTACIÓN ═════════
    //
    // Antes esto sumaba TODOS los movimientos en un solo número y lo mostraba
    // como "Bs". Con un solo médico brasileño en la base, esa cifra ya era
    // falsa: bolivianos y reales sumados como si fueran lo mismo.
    //
    // Y falla en silencio, que es lo peor: nadie mira un total y sospecha.
    // Por eso ahora no hay un total: hay uno por moneda, y no existe forma de
    // pedir la suma de las dos.
    const sumarPorMoneda = async (filtro) => {
      const filas = await MovimientoSaldo.aggregate([
        { $match: filtro },
        { $group: { _id: "$moneda", total: { $sum: "$montoCentavos" }, n: { $sum: 1 } } },
      ]);
      return filas.map(f => ({
        moneda: monedas.normalizar(f._id),
        simbolo: monedas.config(f._id).simbolo,
        centavos: f.total, n: f.n,
        monto: monedas.monto(f.total),
      }));
    };

    const [cargasHoy, cargasMes, consumoMes, pendientes, ultimasCargas] = await Promise.all([
      sumarPorMoneda({ tipo: "carga", createdAt: { $gte: hoy } }),
      sumarPorMoneda({ tipo: "carga", createdAt: { $gte: mes } }),
      sumarPorMoneda({ tipo: "consumo", createdAt: { $gte: mes } }),
      SolicitudRecarga.countDocuments({ estado: "pendiente" }),
      MovimientoSaldo.find({ tipo: "carga" })
        .select("medicoPhone montoCentavos moneda referencia acreditadoPor createdAt")
        .sort({ createdAt: -1 }).limit(25).lean(),
    ]);

    // Quiénes están en negativo: son los que atendieron con el saldo agotado
    // y le deben a la casa. Es el número que dice si el modelo prepago está
    // funcionando o se está convirtiendo en fiado.
    const enNegativo = await Medico.find({ saldoCentavos: { $lt: 0 } })
      .select("phone nombre saldoCentavos moneda").sort({ saldoCentavos: 1 }).limit(20).lean();

    // El nombre de cada médico para las últimas cargas, en una sola consulta.
    const telefonos = [...new Set(ultimasCargas.map(c => c.medicoPhone))];
    const nombres = Object.fromEntries(
      (await Medico.find({ phone: { $in: telefonos } }).select("phone nombre").lean())
        .map(m => [m.phone, m.nombre])
    );

    // La deuda también por moneda: sumar lo que deben unos en Bs con lo que
    // deben otros en R$ da un número que no significa nada.
    const deudaPorMoneda = {};
    for (const m of enNegativo) {
      const cod = monedas.normalizar(m.moneda);
      deudaPorMoneda[cod] = (deudaPorMoneda[cod] || 0) - m.saldoCentavos;
    }

    res.json({
      pendientes,
      cargasHoy, cargasMes,
      // El consumo viene negativo en el libro (es una resta). Se da vuelta
      // para mostrarlo, porque "consumido: -480" se lee como un error.
      consumoMes: consumoMes.map(c => ({ ...c, centavos: -c.centavos, monto: monedas.monto(-c.centavos) })),
      enNegativo: enNegativo.map(m => ({
        phone: m.phone, nombre: m.nombre,
        moneda: monedas.normalizar(m.moneda),
        simbolo: monedas.config(m.moneda).simbolo,
        saldoBs: saldos.bolivianos(m.saldoCentavos),
      })),
      deudaTotal: Object.entries(deudaPorMoneda).map(([moneda, centavos]) => ({
        moneda, simbolo: monedas.config(moneda).simbolo, monto: monedas.monto(centavos),
      })),
      ultimasCargas: ultimasCargas.map(c => ({
        ...c, nombre: nombres[c.medicoPhone] || c.medicoPhone,
        moneda: monedas.normalizar(c.moneda),
        simbolo: monedas.config(c.moneda).simbolo,
        montoBs: saldos.bolivianos(c.montoCentavos),
      })),
    });
  }));

  // ─── LA COLA DE AVISOS DE PAGO ─────────────────────────────────────────
  // Lo que el operador mira apenas entra: quién dice haber pagado y todavía
  // no se le acreditó. Los más viejos primero — el que avisó ayer viene
  // esperando más que el de recién.
  app.get("/medico/operador/solicitudes", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const estado = ["pendiente", "acreditada", "rechazada"].includes(req.query.estado) ? req.query.estado : "pendiente";
    const solicitudes = await SolicitudRecarga.find({ estado })
      .sort(estado === "pendiente" ? { createdAt: 1 } : { revisadaEn: -1 })
      .limit(50).lean();

    // El saldo actual de cada uno, para que el operador vea de una si el
    // médico está trabajando en negativo y conviene apurarse.
    const conSaldo = await Promise.all(solicitudes.map(async (s) => {
      const estado = await saldos.estadoDe(s.medicoPhone);
      return {
        ...s,
        montoBs: saldos.bolivianos(s.montoCentavos),
        // El símbolo sale del ESTADO del médico, o sea de su moneda: el
        // operador ve las dos en la misma cola y "200" sin unidad, en una
        // pantalla donde se aprueba plata, es una invitación al error.
        simbolo: estado.simbolo,
        saldo: estado,
      };
    }));

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
  app.post("/medico/operador/solicitudes/:id/aprobar", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
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
    const estado = await saldos.estadoDe(solicitud.medicoPhone);
    res.json({ ok: true, ...estado });

    // Que el médico se entere sin tener que estar mirando la pantalla: pagó y
    // está esperando para poder trabajar.
    notificarMedico(solicitud.medicoPhone, {
      titulo: "Saldo acreditado",
      cuerpo: `Se acreditaron Bs ${saldos.bolivianos(Math.round(bolivianos * 100))}. Saldo: Bs ${estado.saldoBs}.`,
      url: "/",
    }).catch(() => { /* el saldo ya está cargado, el aviso es un extra */ });
  }));

  // ─── RECHAZAR ──────────────────────────────────────────────────────────
  // Con motivo obligatorio. Un rechazo sin explicación deja al médico sin
  // saber si tiene que volver a pagar, mandar otro comprobante o llamar.
  app.post("/medico/operador/solicitudes/:id/rechazar", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
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

    // El rechazo importa más que la aprobación: el médico se quedó esperando
    // un saldo que no va a llegar, y tiene que enterarse ahora, no cuando
    // vaya a grabar una consulta.
    notificarMedico(solicitud.medicoPhone, {
      titulo: "No pudimos confirmar tu pago",
      cuerpo: motivo,
      url: "/",
    }).catch(() => { /* lo va a ver igual en la pantalla de saldo */ });
  }));

  // ─── ACREDITAR ─────────────────────────────────────────────────────────
  // La operación que crea dinero. Reusa services/saldo.js sin atajos: el
  // mínimo, el rechazo de referencias repetidas y el libro de movimientos son
  // los mismos que usa el script. Dos caminos distintos para crear plata, con
  // reglas distintas, es cómo aparecen los agujeros.
  // ─── ACTIVAR UN PLAN ────────────────────────────────────────────────────
  //
  // La otra forma de cobrar: en vez de acreditar saldo, se le da un período
  // en el que las consultas no descuentan nada.
  //
  // Mismo candado que acreditar plata —lista de operadores, 2FA, auditoría—
  // porque es exactamente lo mismo: dar servicio a cambio de un pago que
  // alguien dice haber recibido.
  app.post("/medico/operador/plan", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const destino = String(req.body?.phone || "").trim();
    const plan = String(req.body?.plan || "").trim();
    const referencia = String(req.body?.referencia || "").trim().slice(0, 120);

    if (!destino) throw new ErrorHttp(400, "Falta el teléfono del médico");
    if (!suscripciones.PLANES[plan]) throw new ErrorHttp(400, "Plan desconocido: tiene que ser mensual o anual");
    // La referencia del pago es obligatoria por la misma razón que en las
    // recargas: dentro de seis meses, "¿por qué esta cuenta tiene plan?"
    // tiene que tener respuesta.
    if (!referencia) throw new ErrorHttp(400, "Poné la referencia del pago");

    const medico = await Medico.findOne({ phone: destino });
    if (!medico) throw new ErrorHttp(404, "No encontramos ese médico");

    const moneda = monedas.normalizar(medico.moneda);
    const precio = suscripciones.precioDelPlan(plan, moneda);
    const hasta = suscripciones.nuevoVencimiento(medico, plan);
    const renovacion = suscripciones.vigente(medico);

    medico.suscripcion = {
      plan,
      // En una renovación se conserva desde cuándo es cliente. Pisarlo con
      // la fecha de hoy borraría que este médico paga desde hace un año.
      desde: medico.suscripcion?.desde || new Date(),
      hasta,
      precioCentavos: precio,
      moneda,
      activadaPor: quien,
    };
    await medico.save();

    registrar({
      req, medicoPhone: quien, accion: renovacion ? "plan_renovado" : "plan_activado",
      recurso: `Medico:${destino}`,
      detalle: `${plan} · ${monedas.conSimbolo(precio, moneda)} · hasta ${hasta.toISOString().slice(0, 10)} · ref ${referencia}`,
    });
    log.info(`[PLAN] ${quien} ${renovacion ? "renovó" : "activó"} plan ${plan} a ${medico.nombre} (${destino}) hasta ${hasta.toISOString().slice(0, 10)}`);

    notificarMedico(destino, {
      titulo: renovacion ? "Tu plan se renovó" : "Tu plan está activo",
      cuerpo: `${plan === "anual" ? "Anual" : "Mensual"} · hasta ${hasta.toLocaleDateString("es-BO")}`,
      url: "/",
    }).catch(() => { /* que no llegue el aviso no puede tumbar la activación */ });

    res.json({
      ok: true, plan, renovacion,
      hasta, precioCentavos: precio,
      precioTexto: monedas.conSimbolo(precio, moneda),
      medico: { phone: medico.phone, nombre: medico.nombre },
    });
  }));

  app.post("/medico/operador/acreditar", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
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
    const medico = await Medico.findOne({ phone: destino }).select("nombre moneda").lean();
    if (!medico) throw new ErrorHttp(404, "No hay ninguna cuenta con ese teléfono");

    // El techo es el de SU moneda, y el mensaje lo dice con su símbolo: a un
    // médico brasileño no se le habla de bolivianos.
    const moneda = monedas.normalizar(medico.moneda);
    const cfg = monedas.config(moneda);
    if (Math.round(bolivianos * 100) > cfg.techoPorCarga) {
      throw new ErrorHttp(400, `Más de ${monedas.conSimbolo(cfg.techoPorCarga, moneda)} en una sola carga: si es correcto, hacelo desde el servidor.`);
    }

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
        // Con la moneda: "Medico:X 200 ref:Y" en un registro de auditoría de
        // plata no dice si entraron bolivianos o reales.
        recurso: `Medico:${destino} ${monedas.conSimbolo(Math.round(bolivianos * 100), moneda)} ref:${referencia}`,
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
