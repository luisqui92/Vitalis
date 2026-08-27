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
const { Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { rateLimit } = require("../services/ratelimit");
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

// Más estricto que el resto de la API a propósito: un operador legítimo hace
// unas pocas recargas por día. Cientos de intentos por minuto no son un
// operador apurado, son otra cosa.
const limitOperador = rateLimit("operadorSaldo", 20, 60 * 1000,
  "Demasiadas operaciones seguidas. Esperá un momento.");

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
