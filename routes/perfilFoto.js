// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Foto de perfil del médico (su propio panel, nadie más la ve)
// ═══════════════════════════════════════════════════════════════════════════
//
// Tres puertas, todas del propio médico sobre su propia cuenta:
//   POST   /medico/perfil/foto   subir o reemplazar
//   GET    /medico/perfil/foto   ver la propia
//   DELETE /medico/perfil/foto   quitarla
//
// Mismo patrón que routes/estudios.js: el archivo se sube como cuerpo crudo
// (igual que el audio de las consultas), se guarda en disco fuera de
// /public con un nombre al azar, y Mongo solo guarda la referencia.
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { DIR_PERFILES, TIPOS_FOTO_PERMITIDOS, guardarFotoPerfil, borrarFotoPerfil } = require("../services/archivosPerfil");

const requireMedico = requireAuth(["medico"]);

// 5 MB alcanza de sobra para un retrato — no es un estudio ni una
// radiografía, no hace falta el límite de 20mb de archivosEstudio.js.
const fotoRaw = express.raw({ type: TIPOS_FOTO_PERMITIDOS, limit: "5mb" });

module.exports = function (app) {

  app.post("/medico/perfil/foto", limitMedico, requireMedico, fotoRaw, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const archivo = req.body;
    if (!Buffer.isBuffer(archivo) || archivo.length === 0) {
      throw new ErrorHttp(400, "Falta la foto, o el formato no está permitido (jpg, png o webp)");
    }
    const mime = String(req.headers["content-type"] || "").split(";")[0].trim();

    const medico = await Medico.findOne({ phone: medicoPhone });
    if (!medico) throw new ErrorHttp(404, "Cuenta no encontrada");

    // La vieja se borra DESPUÉS de guardar la nueva, no antes: si guardar
    // fallara a mitad de camino, mejor quedarse con un archivo huérfano en
    // disco (se puede limpiar después) que dejar al médico sin ninguna foto.
    const nombreViejo = medico.fotoPerfil?.archivoNombre;
    const archivoNombre = guardarFotoPerfil(archivo, mime);
    medico.fotoPerfil = { archivoNombre, archivoMime: mime, actualizadaEn: new Date() };
    await medico.save();
    if (nombreViejo) borrarFotoPerfil(nombreViejo);

    registrar({ req, medicoPhone, accion: "subir_foto_perfil" });
    res.status(201).json({ ok: true });
  }));

  app.get("/medico/perfil/foto", requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario }).select("fotoPerfil").lean();
    const foto = medico?.fotoPerfil;
    if (!foto?.archivoNombre) throw new ErrorHttp(404, "Todavía no subiste una foto");
    const ruta = path.join(DIR_PERFILES, foto.archivoNombre);
    if (!fs.existsSync(ruta)) throw new ErrorHttp(404, "Todavía no subiste una foto");
    res.setHeader("Content-Type", foto.archivoMime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(ruta);
  }));

  app.delete("/medico/perfil/foto", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const medico = await Medico.findOne({ phone: medicoPhone });
    if (!medico) throw new ErrorHttp(404, "Cuenta no encontrada");
    const nombreViejo = medico.fotoPerfil?.archivoNombre;
    if (!nombreViejo) return res.json({ ok: true });

    medico.fotoPerfil = { archivoNombre: "", archivoMime: "", actualizadaEn: null };
    await medico.save();
    borrarFotoPerfil(nombreViejo);

    registrar({ req, medicoPhone, accion: "quitar_foto_perfil" });
    res.json({ ok: true });
  }));
};
