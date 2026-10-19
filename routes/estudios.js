// ChatGo Salud — Centro de Estudios: laboratorios, radiografías, ecografías,
// tomografías, resonancias, ECG, fotos clínicas. Los archivos se guardan en
// disco fuera de /public (no quedan accesibles sin pasar por acá) y solo se
// sirven al médico dueño del paciente, igual que cualquier otro dato clínico.
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Paciente, Estudio, Informe } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { DIR_ESTUDIOS, TIPOS_ARCHIVO_PERMITIDOS, guardarArchivoEstudio } = require("../services/archivosEstudio");

const requireMedico = requireAuth(["medico"]);

// Acepta el archivo como body crudo, igual que el audio de las consultas.
const archivoRaw = express.raw({ type: TIPOS_ARCHIVO_PERMITIDOS, limit: "20mb" });

module.exports = function (app) {
  // ─── SUBIR ESTUDIO ───────────────────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/estudios", limitMedico, requireMedico, archivoRaw, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const archivo = req.body;
    if (!Buffer.isBuffer(archivo) || archivo.length === 0) {
      throw new ErrorHttp(400, "Falta el archivo, o el tipo no está permitido (jpg, png, webp, gif o pdf)");
    }
    const nombre = String(req.query.nombre || "").trim();
    const fecha = req.query.fecha ? new Date(req.query.fecha) : null;
    if (!nombre || !fecha) throw new ErrorHttp(400, "nombre y fecha son requeridos");
    // Antes de escribir el archivo: si la fecha no sirve, el Estudio.create
    // de abajo falla y el archivo (hasta 20 MB) quedaba en disco sin nadie
    // que lo apunte ni lo borre.
    if (Number.isNaN(fecha.getTime())) throw new ErrorHttp(400, "fecha no es válida");
    const tipo = String(req.query.tipo || "otro").trim();

    const mime = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
    const archivoNombre = guardarArchivoEstudio(archivo, mime);

    const estudio = await Estudio.create({
      pacienteId: paciente._id, medicoPhone, tipo, nombre,
      archivoNombre, archivoMime: mime, archivoTamano: archivo.length,
      fecha, notas: String(req.query.notas || "").trim(),
      anguloFoto: tipo === "foto" ? String(req.query.anguloFoto || "").trim() : "",
      ladoOjo: String(req.query.ladoOjo || "").trim(),
    });
    registrar({ req, medicoPhone, accion: "subir_estudio", recurso: `Estudio:${estudio._id}` });
    res.status(201).json({ ok: true, estudio });
  }));

  // ─── VER/DESCARGAR EL ARCHIVO ────────────────────────────────────────────
  app.get("/medico/estudios/:id/archivo", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const estudio = await obtenerOFallar(Estudio, { _id: req.params.id, medicoPhone }, "Estudio no encontrado");
    const ruta = path.join(DIR_ESTUDIOS, estudio.archivoNombre);
    if (!fs.existsSync(ruta)) throw new ErrorHttp(404, "Archivo no encontrado");
    registrar({ req, medicoPhone, accion: "ver_estudio", recurso: `Estudio:${estudio._id}` });
    res.setHeader("Content-Type", estudio.archivoMime);
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.sendFile(ruta);
  }));

  // ─── AJUSTES Y MEDICIONES DEL VISOR ──────────────────────────────────────
  // El archivo original NUNCA se modifica: acá solo se guarda cómo mirarlo y
  // qué se midió encima. Una radiografía es un documento clínico y legal —
  // si un ajuste de contraste pisara el archivo, se perdería la prueba de lo
  // que de verdad capturó el equipo.
  app.patch("/medico/estudios/:id/visor", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const estudio = await obtenerOFallar(Estudio, { _id: req.params.id, medicoPhone }, "Estudio no encontrado");

    const a = req.body?.ajustesVisor;
    if (a && typeof a === "object") {
      const entre = (v, min, max, def) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
      };
      estudio.ajustesVisor = {
        brillo: entre(a.brillo, 20, 250, 100),
        contraste: entre(a.contraste, 20, 350, 100),
        invertido: Boolean(a.invertido),
        // Solo los cuatro giros rectos: un giro libre desalinea las
        // mediciones ya tomadas sin que se note.
        rotacion: [0, 90, 180, 270].includes(Number(a.rotacion)) ? Number(a.rotacion) : 0,
        espejo: Boolean(a.espejo),
      };
    }

    if (Array.isArray(req.body?.mediciones)) {
      const punto = (p) => ({ x: Number(p?.x), y: Number(p?.y) });
      estudio.mediciones = req.body.mediciones
        .filter(m => ["distancia", "angulo"].includes(m?.tipo) && Array.isArray(m.puntos))
        .map(m => ({
          tipo: m.tipo,
          // Una distancia son 2 puntos y un ángulo 3. Guardar una medición
          // incompleta deja una línea suelta que después no se puede borrar.
          puntos: m.puntos.slice(0, m.tipo === "angulo" ? 3 : 2).map(punto),
          etiqueta: String(m.etiqueta || "").trim().slice(0, 80),
          valor: Number.isFinite(Number(m.valor)) ? Number(m.valor) : null,
          unidad: ["mm", "px", "grados"].includes(m.unidad) ? m.unidad : "",
          fecha: m.fecha ? new Date(m.fecha) : new Date(),
        }))
        .filter(m => m.puntos.length === (m.tipo === "angulo" ? 3 : 2) && m.puntos.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
        .slice(0, 50);
    }

    if (req.body?.calibracion !== undefined) {
      const c = req.body.calibracion;
      const mm = Number(c?.mmPorPixel);
      const mmY = Number(c?.mmPorPixelY);
      const valida = (n) => Number.isFinite(n) && n > 0 && n < 100;
      // Una calibración absurda (cero, negativa, o un píxel de un metro)
      // convierte todas las mediciones en números sin sentido pero con
      // pinta de clínicos, que es lo peligroso.
      //
      // El origen viene del cliente pero NO se le cree: "dicom" solo se
      // acepta si el estudio de verdad entró por un DICOM. Si no, cualquiera
      // podría hacer pasar una calibración a ojo por una medida del equipo,
      // que es justo la distinción que el informe muestra.
      const origenPedido = String(c?.origen || "");
      const puedeSerDicom = Boolean(estudio.dicom?.sopInstanceUID);
      estudio.calibracion = c && valida(mm)
        ? {
            mmPorPixel: mm,
            mmPorPixelY: valida(mmY) ? mmY : null,
            referencia: String(c.referencia || "").slice(0, 160),
            fecha: new Date(),
            origen: origenPedido === "dicom" && puedeSerDicom ? "dicom" : (origenPedido ? "manual" : ""),
            planoDetector: Boolean(c.planoDetector) && puedeSerDicom,
          }
        : { mmPorPixel: null, mmPorPixelY: null, referencia: "", fecha: null, origen: "", planoDetector: false };
    }

    // Los puntos del perfil marcados a mano (Symphomed Face). Se exige la lista
    // COMPLETA: si falta uno, los índices se corren y el ángulo nasolabial
    // pasa a calcularse sobre el labio equivocado — un número creíble y mal,
    // que es la peor clase de número. El largo lo fija el cliente
    // (SF_PUNTOS_PERFIL) y acá se acota a un rango sano.
    if (req.body?.perfilMarcado !== undefined) {
      const p = req.body.perfilMarcado;
      const dentro = (n) => Number.isFinite(n) && n >= -0.2 && n <= 1.2;
      estudio.perfilMarcado = Array.isArray(p) && p.length >= 8 && p.length <= 16
        && p.every(q => dentro(Number(q?.x)) && dentro(Number(q?.y)))
        ? p.map(q => ({ x: Number(q.x), y: Number(q.y) }))
        : [];
    }

    // Anotaciones de Symphomed Face. Se guarda la lista completa que manda el
    // cliente: es lo que el médico ve en pantalla, y mezclarla con la que ya
    // estaba dejaría duplicados al reabrir.
    if (Array.isArray(req.body?.anotaciones)) {
      const dentro = (n) => Number.isFinite(n) && n >= -0.2 && n <= 1.2;
      estudio.anotaciones = req.body.anotaciones
        .filter(a => dentro(Number(a?.x)) && dentro(Number(a?.y)))
        .map(a => ({
          x: Number(a.x), y: Number(a.y),
          texto: String(a.texto || "").trim().slice(0, 200),
          fecha: a.fecha ? new Date(a.fecha) : new Date(),
        }))
        .filter(a => a.texto)
        .slice(0, 40);
    }

    await estudio.save();
    registrar({ req, medicoPhone, accion: "editar_visor_estudio", recurso: `Estudio:${estudio._id}` });
    res.json({ ok: true, estudio });
  }));

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/estudios/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    // Una imagen que va en un informe firmado no se borra: el paciente ya
    // tiene ese informe, y sin el archivo le quedan imágenes que no cargan
    // (informe de QA del 16 de octubre de 2026, A11). La de un borrador sí.
    const firmado = await Informe.findOne({ medicoPhone, estado: "firmado", estudiosIncluidos: req.params.id }).select("codigo").lean();
    if (firmado) throw new ErrorHttp(409, `Esta imagen va en el informe firmado ${firmado.codigo} y no se puede borrar: el paciente ya lo tiene.`);
    const estudio = await Estudio.findOneAndDelete({ _id: req.params.id, medicoPhone });
    if (!estudio) throw new ErrorHttp(404, "Estudio no encontrado");
    fs.unlink(path.join(DIR_ESTUDIOS, estudio.archivoNombre), () => {});
    registrar({ req, medicoPhone, accion: "borrar_estudio", recurso: `Estudio:${req.params.id}` });
    res.json({ ok: true });
  }));
};
