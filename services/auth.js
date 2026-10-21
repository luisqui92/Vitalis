// Symphomed — Autenticación JWT + hash de contraseñas para médicos.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const COSTO_BCRYPT = 12;

// JWT_SECRET es obligatorio para evitar tokens predecibles
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET no está definido en variables de entorno. Symphomed no puede autenticar médicos de forma segura.");
  console.error("   Generá uno con: openssl rand -hex 32");
}

function hashPassword(pwd) {
  return bcrypt.hash(pwd, COSTO_BCRYPT);
}

// Los hashes viejos (de antes de esta migración a bcrypt) son SHA-256 en
// hex — 64 caracteres, sin el prefijo "$2" que identifica a bcrypt.
function esHashLegacySha256(hash) {
  return typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash);
}

// Devuelve { ok, requiereRehash } — requiereRehash=true cuando la
// contraseña era correcta pero el hash guardado todavía es el formato
// viejo, para que el caller la vuelva a guardar ya en bcrypt sin que el
// médico tenga que hacer nada (migración transparente en el próximo login).
async function verificarPassword(pwd, hashGuardado) {
  if (!hashGuardado) return { ok: false, requiereRehash: false };
  if (esHashLegacySha256(hashGuardado)) {
    const ok = crypto.createHash("sha256").update(pwd).digest("hex") === hashGuardado;
    return { ok, requiereRehash: ok };
  }
  const ok = await bcrypt.compare(pwd, hashGuardado);
  return { ok, requiereRehash: false };
}

// "extra" lleva lo de la clínica: { admin: true, clinicaId }. Va en el token
// y no se consulta en cada pedido porque cambia solo cuando el dueño de la
// clínica lo cambia, y el token dura 8 horas.
//
// Ojo con el reparto de responsabilidades, que es lo que hace segura toda
// esta parte: el ROL es lo que abre las rutas clínicas. Un administrativo
// tiene rol "admin", así que requireAuth(["medico"]) lo rechaza —el mismo
// camino de siempre, sin excepciones nuevas—. La bandera "admin" solo abre
// las rutas /admin, que no devuelven ni una línea de historia clínica.
// Un director lleva rol "medico" Y admin:true, y por eso pasa por las dos.
function generarToken(usuario, rol, duracionMs = 8 * 60 * 60 * 1000, extra = {}) {
  const payload = {
    usuario,
    rol,
    ...extra,
    exp: Date.now() + duracionMs,
    iat: Date.now(),
  };
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(b64)
    .digest("hex")
    .slice(0, 32);
  return `${b64}.${sig}`;
}

function verificarToken(token) {
  if (!token) return null;
  try {
    const [b64, sig] = token.split(".");
    const expectedSig = crypto
      .createHmac("sha256", process.env.JWT_SECRET)
      .update(b64)
      .digest("hex")
      .slice(0, 32);
    // Comparación en tiempo constante — con !== un atacante podría medir
    // cuántos bytes iniciales coinciden por la diferencia de tiempo de
    // respuesta y reconstruir la firma byte a byte.
    const sigBuf = Buffer.from(sig || "", "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (Date.now() > payload.exp) return null; // expirado
    return payload;
  } catch {
    return null;
  }
}

// ═══ UNA SESIÓN VALE MIENTRAS VALGA SU CUENTA ════════════════════════════
//
// Un token dura 8 horas, y la firma solo dice que lo emitimos nosotros, no
// que la cuenta siga en pie. Antes, dar de baja una cuenta, cambiarle la
// contraseña o los permisos no cortaba las sesiones que ya tenía abiertas:
// seguían entrando, y pidiéndole cosas a la IA, hasta que vencía el token
// (segunda revisión de QA del 9 de octubre de 2026, R02).
//
// Ahora, en cada pedido de una sesión de médico o de administrativo, se mira
// la cuenta: que exista, que no esté desactivada, y que la sesión no sea de
// antes de «sesionesDesde» (se pone al cambiar la contraseña, dar de baja o
// cambiar los permisos: db/models.js). Es una lectura chica por pedido, por
// el teléfono, que tiene índice.
//
// Las cuentas viejas no tienen «activo» ni «sesionesDesde» (y con lean() no
// hay valores por defecto): por eso «activo === false» y no «!activo».
const ROLES_DE_CUENTA = ["medico", "admin"];
const SESION_CORTADA = "Tu sesión ya no es válida. Volvé a iniciar sesión.";

async function sesionVigente(payload) {
  if (!ROLES_DE_CUENTA.includes(payload.rol)) return true;
  const { Medico } = require("../db/models");
  const cuenta = await Medico.findOne({ phone: payload.usuario }).select("activo sesionesDesde estadoCuenta estudiante perfilAcceso verificacionProfesional").lean();
  if (!cuenta || cuenta.activo === false) return false;
  if (["pendiente", "rechazada"].includes(cuenta.estadoCuenta)) return false;
  if (cuenta.perfilAcceso === "profesional" && cuenta.verificacionProfesional?.estado !== "verificada") return false;
  // No alcanza con una marca vieja del token: la cuenta decide en cada pedido.
  if (Boolean(cuenta.estudiante?.nivel) !== Boolean(payload.estudiante)) return false;
  if (cuenta.perfilAcceso === "educativo" && !cuenta.estudiante?.nivel) return false;
  return !(cuenta.sesionesDesde && Number(payload.iat) < new Date(cuenta.sesionesDesde).getTime());
}

// Middleware para proteger endpoints de médico
function requireAuth(rolesPermitidos = ["medico"]) {
  return async (req, res, next) => {
    const token = req.headers["authorization"]?.replace("Bearer ", "") ||
                  req.query.token;
    const payload = verificarToken(token);
    if (!payload) {
      return res.status(401).json({ error: "No autorizado — iniciá sesión" });
    }
    if (!rolesPermitidos.includes(payload.rol)) {
      return res.status(403).json({ error: "No tenés permiso para esta acción" });
    }
    try {
      if (!(await sesionVigente(payload))) return res.status(401).json({ error: SESION_CORTADA });
    } catch (e) {
      return next(e);
    }
    req.adminUser = payload;
    next();
  };
}

// Guardia de las rutas /admin. Exige la bandera admin Y una clínica: un
// administrador sin clínica no tiene nada que administrar, y dejarlo pasar
// abriría la puerta a que una consulta mal filtrada devuelva datos de todas.
//
// req.clinicaId queda listo para que cada ruta filtre por ahí. Ninguna ruta
// /admin debe aceptar un clinicaId que venga del cliente: sale del token o
// no sale.
async function requireAdmin(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token;
  const payload = verificarToken(token);
  if (!payload) return res.status(401).json({ error: "No autorizado — iniciá sesión" });
  if (!payload.admin) return res.status(403).json({ error: "No tenés permiso para esta acción" });
  if (!payload.clinicaId) return res.status(403).json({ error: "Tu cuenta no está asociada a ninguna clínica" });
  try {
    if (!(await sesionVigente(payload))) return res.status(401).json({ error: SESION_CORTADA });
  } catch (e) {
    return next(e);
  }
  req.adminUser = payload;
  req.clinicaId = payload.clinicaId;
  next();
}

// Guardia de las rutas /socio. Exige rol "socio" —que NO es "medico" ni
// "admin"— y un socioId en el token.
//
// ═══ POR QUÉ UN ROL PROPIO Y NO UNA BANDERA MÁS ════════════════════════════
//
// Porque así un socio no puede llegar a una ficha clínica ni por error. Las
// rutas médicas piden requireAuth(["medico"]) y las de clínica piden la
// bandera admin; con rol "socio" no pasa por ninguna de las dos, y eso no
// depende de que nadie se acuerde de filtrar: es la misma puerta de siempre,
// que simplemente no se le abre.
//
// Un socio es un vendedor. Ve cuántas cuentas tiene, cuánto consumen y
// cuánto debe. No ve un solo paciente, y no hay ruta que se lo permita.
function requireSocio(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token;
  const payload = verificarToken(token);
  if (!payload) return res.status(401).json({ error: "No autorizado — iniciá sesión" });
  if (payload.rol !== "socio" || !payload.socioId) {
    return res.status(403).json({ error: "No tenés permiso para esta acción" });
  }
  req.adminUser = payload;
  // Igual que clinicaId en requireAdmin: sale del token o no sale. Un
  // socioId que llegue en el cuerpo del pedido es elegir de quién ver la
  // cartera de clientes.
  req.socioId = payload.socioId;
  next();
}

module.exports = { hashPassword, verificarPassword, generarToken, verificarToken, sesionVigente, requireAuth, requireAdmin, requireSocio };
