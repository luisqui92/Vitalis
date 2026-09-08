// Vitalis — El reporte financiero, y a quién se le muestra.
//
// ═══ POR QUÉ EL ARCHIVO NO VIVE EN public/ ═════════════════════════════════
//
// Es la decisión que hace que todo lo demás signifique algo. express.static
// sirve TODO lo que hay en public/ sin preguntar nada — así tiene que ser,
// es el frontend. Si el reporte estuviera ahí, cualquiera que escriba la URL
// se lo lleva, y las rutas de abajo serían decoración.
//
// Por eso vive en vistas/, que no lo sirve nadie automáticamente, y llega al
// navegador únicamente por acá, después de pasar un portero.
//
// ═══ DOS PUERTAS, NO UNA ═══════════════════════════════════════════════════
//
//   · /report        — la del dueño. Pide sesión de operador (la misma lista
//                      OPERADORES_SALDO que aprueba pagos). Desde adentro se
//                      pueden emitir enlaces de invitación.
//   · /report/i/:cod — la del invitado. Sin cuenta y sin contraseña: el
//                      enlace ES la credencial, igual que /informe/:token y
//                      /teleconsulta/:token. Vence y se puede apagar.
//
// La segunda existe porque la alternativa real —darle la cuenta de operador
// a un inversor— es darle acceso a acreditar saldo. No es una comodidad: es
// la única forma de que mostrar el reporte no signifique entregar la caja.
//
// ═══ LA CSP SE REESCRIBE ACÁ, Y MÁS ESTRICTA ═══════════════════════════════
//
// La CSP global de Vitalis (index.js) permite scripts de 'self' pero no
// inline, y el reporte es una página con su script adentro. En vez de
// aflojar la política de toda la aplicación para una pantalla, se manda una
// CSP propia en esta respuesta, con un nonce por pedido — y de paso más
// cerrada que la global: ni conexiones salientes, ni frames, ni formularios.
//
// Van también dos cabeceras que en el resto de Vitalis no hacen falta:
// no-store, porque un reporte financiero no puede quedar en el disco de una
// notebook prestada, y noindex, porque un enlace de invitación que llegue a
// un buscador deja de ser una invitación.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { InvitacionReporte } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { rateLimitPorClave, claveDeMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { esOperador } = require("../services/operadores");
const { log } = require("../config");

const VISTAS = path.join(__dirname, "..", "vistas");
const DIAS_POR_DEFECTO = 30;
const DIAS_MAXIMO = 180;

// Se leen una vez al arrancar: son archivos nuestros, no cambian solos, y
// leerlos del disco en cada visita sería trabajo repetido sin motivo.
let PLANTILLA_REPORTE = "";
let PLANTILLA_ENTRADA = "";
try {
  PLANTILLA_REPORTE = fs.readFileSync(path.join(VISTAS, "reporte.html"), "utf8");
  PLANTILLA_ENTRADA = fs.readFileSync(path.join(VISTAS, "reporteEntrada.html"), "utf8");
} catch (e) {
  log.warn(`[REPORTE] No se pudieron leer las vistas: ${e.message}`);
}

// La CSP de esta pantalla. Más cerrada que la de Vitalis: el reporte no
// habla con nadie afuera, así que no hay por qué permitírselo.
function blindar(res, nonce) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
}

// Manda una vista con su nonce puesto. El marcador __NONCE__ se reemplaza en
// todas sus apariciones: si un día la página tiene dos <script>, los dos
// tienen que quedar autorizados o el segundo se cae en silencio.
function servirVista(res, plantilla, extra = {}) {
  if (!plantilla) throw new ErrorHttp(500, "El reporte no está disponible en este servidor");
  const nonce = crypto.randomBytes(16).toString("base64");
  blindar(res, nonce);
  let html = plantilla.replace(/__NONCE__/g, nonce);
  for (const [clave, valor] of Object.entries(extra)) {
    html = html.replace(new RegExp(`__${clave}__`, "g"), valor);
  }
  res.type("html").send(html);
}

// Un enlace de invitación sirve si existe, no lo apagaron y no venció. Las
// tres condiciones van juntas en la consulta y no en un if después: así no
// hay forma de agregar una rama que se olvide de una.
async function invitacionValida(codigo) {
  if (!codigo || typeof codigo !== "string" || codigo.length < 20) return null;
  return InvitacionReporte.findOne({
    codigo,
    revocada: { $ne: true },
    expiraEn: { $gt: new Date() },
  });
}

module.exports = (app) => {
  const requireSesion = requireAuth(["medico", "admin"]);

  // El mismo portero que el panel de saldo. A quien no es operador se le
  // contesta 404, no 403: no se le confirma que esta pantalla existe.
  function requireOperador(req, res, next) {
    const phone = req.adminUser?.usuario;
    if (!esOperador(phone)) {
      log.warn(`[REPORTE] ${phone} intentó entrar y no está en OPERADORES_SALDO`);
      registrar({ req, medicoPhone: phone, accion: "reporte_denegado", exito: false });
      return res.status(404).json({ error: "No encontrado" });
    }
    next();
  }

  // Por invitado y no por IP: dos personas mirando el reporte desde la misma
  // oficina no tienen por qué repartirse una cuota.
  const limitInvitado = rateLimitPorClave(
    "reporteInvitado", 60, 60 * 1000,
    "Demasiados pedidos seguidos. Esperá un momento.",
    (req) => `inv:${req.params?.codigo || ""}`
  );
  const limitOperador = rateLimitPorClave(
    "reporteOperador", 60, 60 * 1000,
    "Demasiados pedidos seguidos. Esperá un momento.",
    claveDeMedico
  );

  // ─── LA PUERTA DEL DUEÑO ────────────────────────────────────────────────
  //
  // Esta página no lleva ni un número del reporte. Es un cascarón que busca
  // la sesión que ya tiene el navegador y pide el contenido aparte. Tiene que
  // ser así: en una navegación normal el navegador no manda la cabecera
  // Authorization, así que el servidor no puede saber quién es hasta que el
  // JavaScript se lo diga.
  app.get("/report", (_req, res) => servirVista(res, PLANTILLA_ENTRADA));

  // El contenido de verdad. Acá sí hay portero.
  app.get("/report/vista", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "reporte_visto" });
    servirVista(res, PLANTILLA_REPORTE, { MODO: "operador" });
  }));

  // ─── LA PUERTA DEL INVITADO ─────────────────────────────────────────────
  //
  // El código viaja en la URL, así que el servidor sí puede decidir solo y no
  // hace falta ningún cascarón: se sirve el reporte directamente.
  app.get("/report/i/:codigo", limitInvitado, asyncRoute(async (req, res) => {
    const inv = await invitacionValida(req.params.codigo);
    if (!inv) {
      // El mismo 404 para un código inventado, uno vencido y uno apagado: si
      // se distinguieran, un enlace viejo confirmaría que alguna vez existió.
      return res.status(404).type("html").send(
        "<!doctype html><meta charset=utf-8><title>Enlace no válido</title>" +
        "<body style=\"font:16px system-ui;max-width:34em;margin:16vh auto;padding:0 1.5em;color:#15170F\">" +
        "<h1 style=\"font-size:1.4em\">Este enlace ya no sirve</h1>" +
        "<p style=\"color:#545A47\">Puede haber vencido o haber sido desactivado. " +
        "Pedí uno nuevo a quien te lo compartió.</p>"
      );
    }
    // Se anota que se abrió, sin bloquear la respuesta: que falle el contador
    // no puede impedir que el inversor vea el reporte.
    InvitacionReporte.updateOne(
      { _id: inv._id },
      { $inc: { visitas: 1 }, $set: { ultimaVisita: new Date() } }
    ).catch(() => {});
    servirVista(res, PLANTILLA_REPORTE, { MODO: "invitado" });
  }));

  // ─── EMITIR, LISTAR Y APAGAR INVITACIONES ───────────────────────────────
  app.post("/report/invitaciones", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const etiqueta = String(req.body?.etiqueta || "").trim().slice(0, 80);
    if (!etiqueta) throw new ErrorHttp(400, "Poné para quién es el enlace");

    const dias = Math.min(DIAS_MAXIMO, Math.max(1, Math.round(Number(req.body?.dias) || DIAS_POR_DEFECTO)));
    // 192 bits. No se adivina probando, así que el enlace puede ser la única
    // credencial sin que eso sea una imprudencia.
    const codigo = crypto.randomBytes(24).toString("base64url");

    const inv = await InvitacionReporte.create({
      codigo, etiqueta,
      creadaPor: req.adminUser.usuario,
      expiraEn: new Date(Date.now() + dias * 86400000),
    });
    registrar({
      req, medicoPhone: req.adminUser.usuario, accion: "reporte_invitacion_creada",
      detalle: `${etiqueta} · ${dias} días`,
    });
    res.json({ codigo: inv.codigo, etiqueta: inv.etiqueta, expiraEn: inv.expiraEn, visitas: 0 });
  }));

  app.get("/report/invitaciones", limitOperador, requireSesion, requireOperador, asyncRoute(async (_req, res) => {
    const lista = await InvitacionReporte.find({ revocada: { $ne: true } })
      .sort({ createdAt: -1 }).limit(50)
      .select("codigo etiqueta expiraEn visitas ultimaVisita createdAt").lean();
    res.json({ invitaciones: lista });
  }));

  app.delete("/report/invitaciones/:codigo", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    const r = await InvitacionReporte.updateOne(
      { codigo: req.params.codigo },
      { $set: { revocada: true } }
    );
    if (!r.matchedCount) throw new ErrorHttp(404, "Ese enlace no existe");
    registrar({
      req, medicoPhone: req.adminUser.usuario, accion: "reporte_invitacion_revocada",
      detalle: req.params.codigo.slice(0, 8),
    });
    res.json({ ok: true });
  }));
};
