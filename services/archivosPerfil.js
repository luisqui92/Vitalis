// Symphomed — Dónde y cómo se guardan en disco las fotos de perfil de los
// médicos. Carpeta propia y no uploads/estudios: una foto de perfil no es un
// documento clínico —no pertenece a ningún paciente— y mezclarla con
// estudios confundiría cualquier backup o limpieza que opere por carpeta.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Fuera de /public, mismo motivo que uploads/estudios: nadie llega acá por
// URL directa, siempre pasa por la ruta que sirve la foto del propio médico.
const DIR_PERFILES = path.join(__dirname, "..", "uploads", "perfiles");
fs.mkdirSync(DIR_PERFILES, { recursive: true });

const EXT_POR_MIME = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
};

// Sin GIF ni PDF a propósito: es un retrato, no un estudio — no hace falta
// la misma lista amplia que archivosEstudio.js.
const TIPOS_FOTO_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"];

function extensionParaMime(mime) {
  return EXT_POR_MIME[mime] || ".bin";
}

function guardarFotoPerfil(buffer, mime) {
  const archivoNombre = crypto.randomUUID() + extensionParaMime(mime);
  fs.writeFileSync(path.join(DIR_PERFILES, archivoNombre), buffer);
  return archivoNombre;
}

function borrarFotoPerfil(archivoNombre) {
  if (!archivoNombre) return;
  fs.unlink(path.join(DIR_PERFILES, archivoNombre), () => {});
}

module.exports = { DIR_PERFILES, TIPOS_FOTO_PERMITIDOS, guardarFotoPerfil, borrarFotoPerfil };
