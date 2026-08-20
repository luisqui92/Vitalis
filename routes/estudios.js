// ChatGo Salud — Centro de Estudios: laboratorios, radiografías, ecografías,
// tomografías, resonancias, ECG, fotos clínicas. Los archivos se guardan en
// disco fuera de /public (no quedan accesibles sin pasar por acá) y solo se
// sirven al médico dueño del paciente, igual que cualquier otro dato clínico.
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Paciente, Estudio } = require("../db/models");
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

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/estudios/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const estudio = await Estudio.findOneAndDelete({ _id: req.params.id, medicoPhone });
    if (!estudio) throw new ErrorHttp(404, "Estudio no encontrado");
    fs.unlink(path.join(DIR_ESTUDIOS, estudio.archivoNombre), () => {});
    registrar({ req, medicoPhone, accion: "borrar_estudio", recurso: `Estudio:${req.params.id}` });
    res.json({ ok: true });
  }));
};
