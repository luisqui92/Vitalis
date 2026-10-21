// Symphomed — La cuenta de estudiante: entrar con un código y ver cómo está
// el acceso (ver ../cuenta.js).
const { Medico } = require("../../../db/models");
const { CodigoEstudiante } = require("../modelos");
const { hashPassword, requireAuth } = require("../../../services/auth");
const { registrar } = require("../../../services/auditoria");
const { limitAuth } = require("../../../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../../../services/httpHelpers");
const { soloDigitos, buscarPorTelefono } = require("../../../services/telefono");
const { zonaPorMoneda } = require("../../../services/zonaHoraria");
const { tokenDeMedico, datosDeSesion } = require("../../../services/sesionMedico");
const { log } = require("../../../config");
const { normalizarCodigo, estadoDe } = require("../cuenta");
const { carreraValida, configDe, nivelValido, tituloDe } = require("../carreras");
const { identidadParaRegistro } = require("../../../services/googleAcceso");

// Como el resto de las rutas de la propia cuenta (routes/medicoAuth.js).
const requireMedico = requireAuth(["medico", "admin"]);

// Cómo está la cuenta: horas usadas, vencimiento, si puede grabar. La
// pantalla lo pide para avisar ANTES de grabar. Es parte de las reglas de la
// cuenta: se monta aunque el módulo esté apagado.
function estado(app) {
  app.get("/medico/estudiante/estado", requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario }).select("phone estudiante").lean();
    res.json({ estudiante: await estadoDe(medico) });
  }));
}

// ─── REGISTRO DE ESTUDIANTE, CON CÓDIGO DE INVITACIÓN ──────────────────────
//
// A diferencia del registro de médico, no queda en fila: el código ES la
// aprobación (lo dio Symphomed a una persona puntual) y se entra al toque.
// Un código sirve una sola vez: se reclama con un update atómico, así dos
// personas con el mismo código no pueden quedarse las dos con él.
function registro(app) {
  app.post("/medico/registro-estudiante", limitAuth, asyncRoute(async (req, res) => {
    const codigo = normalizarCodigo(req.body?.codigo);
    const phone = soloDigitos(req.body?.phone);
    const nombre = String(req.body?.nombre || "").trim().slice(0, 120);
    const password = String(req.body?.password || "");
    const universidad = String(req.body?.universidad || "").trim().slice(0, 120);
    const idioma = ["es", "pt"].includes(req.body?.idioma) ? req.body.idioma : "es";
    const google = await identidadParaRegistro(req);
    if (!codigo || !nombre) throw new ErrorHttp(400, "Faltan el código y tu nombre");
    if (!/^\d{6,15}$/.test(phone)) throw new ErrorHttp(400, "Ese teléfono no parece válido: escribilo con el código de país, por ejemplo +59170000000.");
    if (!google && password.length < 8) throw new ErrorHttp(400, "La contraseña debe tener al menos 8 caracteres");
    if (await buscarPorTelefono(Medico, phone, { select: "_id", lean: true })) {
      throw new ErrorHttp(409, "Ese teléfono ya tiene una cuenta. Entrá con tu contraseña.");
    }

    const ahora = new Date();
    const cod = await CodigoEstudiante.findOneAndUpdate(
      { codigo, usadoPor: null, anulado: false, vence: { $gt: ahora } },
      { $set: { usadoPor: phone, usadoEn: ahora } },
      { new: true });
    if (!cod) {
      registrar({ req, medicoPhone: phone, accion: "codigo_estudiante_invalido", exito: false, detalle: codigo });
      throw new ErrorHttp(400, "Ese código no existe, ya se usó o venció. Pedí uno nuevo a Symphomed.");
    }

    const hasta = new Date(ahora);
    hasta.setMonth(hasta.getMonth() + cod.meses);
    const moneda = cod.moneda || (idioma === "pt" ? "BRL" : "BOB");
    // La carrera la trae el código (carreras.js): decide el título, la
    // especialidad del núcleo —y con ella el formato de su nota— y las áreas
    // en las que practica.
    const carrera = carreraValida(cod.carrera);
    let medico;
    try {
      if (!nivelValido(carrera, cod.nivel)) throw new ErrorHttp(400, "Ese código no es válido. Pedí uno nuevo a Symphomed.");
      medico = await Medico.create({
        phone, nombre, idioma,
        especialidad: tituloDe(carrera, cod.nivel, idioma),
        tipoEspecialidad: configDe(carrera).tipoEspecialidad,
        moneda,
        // Su «hoy»: el de la racha de estudio (../estudio.js). Sin esto un
        // estudiante de Brasil quedaba con la hora de Bolivia.
        zonaHoraria: zonaPorMoneda(moneda),
        ...(google || { passwordHash: await hashPassword(password) }),
        activo: true,
        estadoCuenta: "aprobada",
        estudiante: { nivel: cod.nivel, carrera, hasta, horasMes: cod.horasMes, codigo: cod.codigo, universidad },
        // El plan que ya existe hace que sus consultas no descuenten saldo:
        // lo que pagó por el código cubre el período.
        suscripcion: { plan: "mensual", desde: ahora, hasta, precioCentavos: cod.precioCentavos, moneda: cod.moneda, activadaPor: "codigo:" + cod.codigo },
      });
    } catch (e) {
      // El código vuelve a quedar libre: la cuenta no se creó.
      await CodigoEstudiante.updateOne({ _id: cod._id }, { $set: { usadoPor: null, usadoEn: null } }).catch(() => {});
      throw e;
    }
    registrar({ req, medicoPhone: phone, accion: "registro_estudiante", detalle: `${cod.codigo} · ${carrera} · ${cod.nivel} · ${cod.meses} mes(es)` });
    log.info(`[ESTUDIANTES] ${nombre} (${phone}) entró con ${cod.codigo} — ${carrera}, ${cod.nivel}, ${cod.meses} mes(es)`);
    // La misma sesión que da el login (services/sesionMedico.js).
    res.json({ token: tokenDeMedico(medico), ...datosDeSesion(medico) });
  }));
}

module.exports = { estado, registro };
