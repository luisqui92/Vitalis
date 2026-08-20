// ═══════════════════════════════════════════════════════════════════════════
// Vitalis Rayos — la radiografía entra sola a la ficha del paciente
// ═══════════════════════════════════════════════════════════════════════════
// El equipo de rayos (un Woodpecker Mini Ray, por ejemplo) no habla con
// nadie: solo dispara. La imagen la produce el sensor y la recibe el
// software del fabricante (Ai-Dental, DBSWIN, VixWin, CS Imaging...) en una
// PC del consultorio, que la deja en una carpeta del disco.
//
// El puente es agente-rayos/agente.js: un programita que corre en ESA PC,
// vigila esa carpeta y sube lo nuevo por HTTPS a estas rutas. Sale hacia
// afuera, así que no hace falta IP fija, ni abrir puertos, ni tocar el
// router del consultorio.
//
// El problema difícil no es mover el archivo, es saber DE QUÉ PACIENTE es.
// En vez de intentar cruzar nombres entre dos sistemas (que se escriben
// distinto y se equivocan), Vitalis usa una "ventana de captura": el médico
// abre la ficha del paciente, toca "Capturar radiografía", y durante los
// minutos siguientes todo lo que llegue del equipo se guarda ahí. Cero
// tipeo, cero ambigüedad, y si se olvidó de abrirla el agente guarda la
// imagen y reintenta un rato.
const express = require("express");
const crypto = require("crypto");
const { Paciente, Estudio, EquipoRayos, CapturaPendiente } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { TIPOS_ARCHIVO_PERMITIDOS, guardarArchivoEstudio } = require("../services/archivosEstudio");
const { avisarCambio } = require("../services/realtime");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// El agente pregunta "¿hay alguien esperando radiografía?" cada pocos
// segundos, así que este límite es holgado a propósito — pero existe, para
// que un agente mal configurado (o un token filtrado) no pueda martillar.
const limitEquipoConsulta = rateLimit("rayosConsulta", 600, 60 * 1000, "Demasiadas consultas del equipo — revisá el intervalo del agente.");
const limitEquipoSubida = rateLimit("rayosSubida", 60, 60 * 1000, "Demasiadas subidas seguidas del equipo.");

const archivoRaw = express.raw({ type: TIPOS_ARCHIVO_PERMITIDOS, limit: "20mb" });

// Cuánto dura por defecto una ventana de captura. Suficiente para acomodar
// al paciente, poner el sensor y disparar un par de veces, pero no tanto
// como para que quede abierta olvidada y la próxima placa caiga en el
// paciente equivocado.
const MINUTOS_VENTANA = 10;
const MINUTOS_VENTANA_MAX = 60;

// ─── TOKENS DEL EQUIPO ────────────────────────────────────────────────────
// Mismo criterio que una contraseña: se guarda el hash, el token en claro
// se muestra una sola vez y no se puede volver a ver. Si se pierde, se
// genera otro (es un botón, no un drama).
function generarToken() {
  return "vrx_" + crypto.randomBytes(24).toString("hex");
}
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// Autentica al agente por el header X-Equipo-Token. Devuelve el equipo o
// null (y en ese caso ya respondió el error).
async function equipoDesdeRequest(req, res) {
  const token = String(req.headers["x-equipo-token"] || "").trim();
  if (!token) {
    res.status(401).json({ error: "Falta el token del equipo (header X-Equipo-Token)" });
    return null;
  }
  const equipo = await EquipoRayos.findOne({ tokenHash: hashToken(token), activo: true });
  if (!equipo) {
    res.status(401).json({ error: "Token de equipo inválido o dado de baja" });
    return null;
  }
  return equipo;
}

function capturaVigente(captura) {
  return Boolean(captura && new Date(captura.expiraEn).getTime() > Date.now());
}

module.exports = function (app) {
  // ═══ LADO MÉDICO (desde el navegador, con la sesión de siempre) ═════════

  // ─── ESTADO COMPLETO (equipos + ventana abierta) ─────────────────────────
  // Una sola ruta y no dos, porque la pestaña Estudios necesita las dos
  // cosas juntas cada vez que se abre: pedirlas por separado duplicaba las
  // peticiones de una pantalla que ya hace varias.
  //
  // Nunca devuelve el token (no lo tenemos: guardamos el hash). "conectado"
  // se calcula acá y no se guarda, para que sea la verdad del momento.
  app.get("/medico/rayos/estado", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const [equipos, captura] = await Promise.all([
      EquipoRayos.find({ medicoPhone, activo: true }).sort({ createdAt: 1 }).lean(),
      CapturaPendiente.findOne({ medicoPhone }).lean(),
    ]);
    res.json({
      equipos: equipos.map(e => ({
        _id: e._id,
        nombre: e.nombre,
        ultimoContacto: e.ultimoContacto,
        ultimaSubida: e.ultimaSubida,
        subidas: e.subidas,
        // 90 s de gracia: el agente saluda cada pocos segundos, así que si
        // hace un minuto y medio que no aparece, esa PC está apagada o sin
        // internet.
        conectado: Boolean(e.ultimoContacto && Date.now() - new Date(e.ultimoContacto).getTime() < 90 * 1000),
      })),
      captura: capturaVigente(captura) ? {
        pacienteId: captura.pacienteId,
        pacienteNombre: captura.pacienteNombre,
        expiraEn: captura.expiraEn,
        recibidas: captura.recibidas,
      } : null,
    });
  }));

  // ─── DAR DE ALTA UN EQUIPO ───────────────────────────────────────────────
  app.post("/medico/rayos/equipos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const nombre = String(req.body?.nombre || "").trim() || "Equipo de rayos";
    const token = generarToken();
    const equipo = await EquipoRayos.create({ medicoPhone, nombre, tokenHash: hashToken(token) });
    registrar({ req, medicoPhone, accion: "alta_equipo_rayos", recurso: `EquipoRayos:${equipo._id}` });
    // Única vez en la vida que este token viaja en claro.
    res.status(201).json({ ok: true, equipo: { _id: equipo._id, nombre: equipo.nombre }, token });
  }));

  // ─── REGENERAR EL TOKEN ──────────────────────────────────────────────────
  app.post("/medico/rayos/equipos/:id/token", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const equipo = await obtenerOFallar(EquipoRayos, { _id: req.params.id, medicoPhone }, "Equipo no encontrado");
    const token = generarToken();
    equipo.tokenHash = hashToken(token);
    await equipo.save();
    registrar({ req, medicoPhone, accion: "regenerar_token_equipo", recurso: `EquipoRayos:${equipo._id}` });
    res.json({ ok: true, token });
  }));

  // ─── DAR DE BAJA ─────────────────────────────────────────────────────────
  // Baja lógica: el registro queda (para la auditoría de quién subió qué),
  // pero el token deja de servir en el acto.
  app.delete("/medico/rayos/equipos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const equipo = await EquipoRayos.findOneAndUpdate(
      { _id: req.params.id, medicoPhone },
      { activo: false, tokenHash: "baja:" + crypto.randomUUID() },
    );
    if (!equipo) throw new ErrorHttp(404, "Equipo no encontrado");
    registrar({ req, medicoPhone, accion: "baja_equipo_rayos", recurso: `EquipoRayos:${req.params.id}` });
    res.json({ ok: true });
  }));

  // ─── ABRIR LA VENTANA DE CAPTURA ─────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/captura", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const minutos = Math.min(Math.max(Number(req.body?.minutos) || MINUTOS_VENTANA, 1), MINUTOS_VENTANA_MAX);
    const expiraEn = new Date(Date.now() + minutos * 60 * 1000);

    // upsert por médico: abrir una ventana nueva cierra la anterior sola.
    const captura = await CapturaPendiente.findOneAndUpdate(
      { medicoPhone },
      {
        medicoPhone,
        pacienteId: paciente._id,
        pacienteNombre: paciente.nombre,
        tipo: String(req.body?.tipo || "radiografia").trim(),
        nombre: String(req.body?.nombre || "").trim() || "Radiografía",
        notas: String(req.body?.notas || "").trim(),
        expiraEn,
        recibidas: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    registrar({ req, medicoPhone, accion: "abrir_captura_rayos", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true, captura: { pacienteId: captura.pacienteId, pacienteNombre: captura.pacienteNombre, expiraEn: captura.expiraEn, recibidas: 0 } });
  }));

  // ─── CERRAR LA VENTANA A MANO ────────────────────────────────────────────
  app.delete("/medico/rayos/captura", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    await CapturaPendiente.deleteOne({ medicoPhone: req.adminUser.usuario });
    res.json({ ok: true });
  }));

  // ═══ LADO EQUIPO (desde la PC del consultorio, con X-Equipo-Token) ══════

  // ─── SALUDO + "¿HAY ALGUIEN ESPERANDO?" ──────────────────────────────────
  // El agente pega acá cada pocos segundos. Sirve para dos cosas a la vez:
  // que el médico vea el equipo como conectado, y que el agente sepa si
  // puede subir ya o tiene que esperar con la imagen guardada.
  app.get("/equipo/rayos/estado", limitEquipoConsulta, asyncRoute(async (req, res) => {
    const equipo = await equipoDesdeRequest(req, res);
    if (!equipo) return;

    // updateOne y no save() para no pisar otros campos si el agente y una
    // subida caen al mismo tiempo.
    await EquipoRayos.updateOne({ _id: equipo._id }, { ultimoContacto: new Date() });

    const captura = await CapturaPendiente.findOne({ medicoPhone: equipo.medicoPhone }).lean();
    if (!capturaVigente(captura)) return res.json({ ok: true, capturaActiva: false });

    res.json({
      ok: true,
      capturaActiva: true,
      paciente: captura.pacienteNombre,
      tipo: captura.tipo,
      nombre: captura.nombre,
      expiraEn: captura.expiraEn,
    });
  }));

  // ─── SUBIR LA IMAGEN ─────────────────────────────────────────────────────
  // El cuerpo es el archivo crudo, igual que la subida manual del médico.
  // El nombre original del archivo viaja en un header (X-Archivo-Nombre) y
  // se usa solo como referencia en las notas — nunca para armar la ruta en
  // disco, que siempre es un UUID nuestro.
  app.post("/equipo/rayos/estudio", limitEquipoSubida, archivoRaw, asyncRoute(async (req, res) => {
    const equipo = await equipoDesdeRequest(req, res);
    if (!equipo) return;

    const archivo = req.body;
    if (!Buffer.isBuffer(archivo) || archivo.length === 0) {
      throw new ErrorHttp(400, "Falta el archivo, o el tipo no está permitido (jpg, png, webp, gif o pdf)");
    }

    const captura = await CapturaPendiente.findOne({ medicoPhone: equipo.medicoPhone });
    if (!capturaVigente(captura)) {
      // 409 y no 400: no es que el agente esté mal, es que todavía no hay
      // un paciente esperando. El agente guarda la imagen y reintenta.
      return res.status(409).json({ error: "sin_captura_activa", mensaje: "Nadie está esperando una imagen ahora mismo — el médico tiene que abrir la ficha del paciente y tocar 'Capturar radiografía'." });
    }

    // La ventana está abierta contra un paciente que puede haberse borrado
    // mientras tanto — pasa poco, pero un estudio huérfano no se puede ver
    // ni borrar después desde ningún lado.
    const paciente = await Paciente.findOne({ _id: captura.pacienteId, medicoPhone: equipo.medicoPhone }).lean();
    if (!paciente) {
      await CapturaPendiente.deleteOne({ _id: captura._id });
      return res.status(409).json({ error: "paciente_no_encontrado", mensaje: "El paciente de la captura ya no existe." });
    }

    const mime = String(req.headers["content-type"] || "").split(";")[0].trim();
    const archivoNombre = guardarArchivoEstudio(archivo, mime);
    const original = String(req.headers["x-archivo-nombre"] || "").trim().slice(0, 120);

    const numero = captura.recibidas + 1;
    const estudio = await Estudio.create({
      pacienteId: paciente._id,
      medicoPhone: equipo.medicoPhone,
      tipo: captura.tipo,
      // Si se dispara más de una placa en la misma ventana, que no queden
      // tres estudios llamados igual.
      nombre: numero > 1 ? `${captura.nombre} (${numero})` : captura.nombre,
      archivoNombre, archivoMime: mime, archivoTamano: archivo.length,
      fecha: new Date(),
      notas: [captura.notas, `Capturada por ${equipo.nombre}`, original && `archivo: ${original}`].filter(Boolean).join(" · "),
    });

    captura.recibidas = numero;
    await captura.save();
    await EquipoRayos.updateOne({ _id: equipo._id }, { ultimaSubida: new Date(), ultimoContacto: new Date(), $inc: { subidas: 1 } });

    registrar({ req, medicoPhone: equipo.medicoPhone, accion: "subir_estudio_equipo", recurso: `Estudio:${estudio._id}` });
    log.info(`[RAYOS] ${equipo.nombre} → ${paciente.nombre}: ${captura.tipo} (${Math.round(archivo.length / 1024)} KB)`);

    // Que la imagen aparezca sola en la pantalla del médico, sin refrescar.
    avisarCambio(equipo.medicoPhone);

    res.status(201).json({ ok: true, estudioId: estudio._id, paciente: paciente.nombre, numero });
  }));
};
