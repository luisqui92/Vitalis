// Vitalis — Dónde y cómo se guardan en disco los archivos de estudios
// (radiografías, laboratorios, fotos clínicas). Vive acá y no dentro de
// routes/estudios.js porque hay dos caminos de entrada al mismo lugar: el
// médico subiendo un archivo a mano desde el navegador, y el agente de
// Vitalis Rayos subiendo la radiografía sola desde la PC del consultorio.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Fuera de /public a propósito: nadie llega a un estudio por URL directa,
// siempre tiene que pasar por la ruta que verifica que el médico sea el
// dueño del paciente.
const DIR_ESTUDIOS = path.join(__dirname, "..", "uploads", "estudios");
fs.mkdirSync(DIR_ESTUDIOS, { recursive: true });

const EXT_POR_MIME = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "application/pdf": ".pdf",
};

// Lista blanca explícita (no "image/*"): un SVG también matchea ese glob,
// y como el archivo se sirve después con el mismo Content-Type que se
// subió y el navegador lo abre en una pestaña propia (mismo origen), un
// SVG con <script> adentro correría con acceso al localStorage del
// médico — ahí vive el token de sesión. Nadie sube estudios/fotos
// clínicas en SVG, así que sacarlo de la lista no le saca nada a nadie.
const TIPOS_ARCHIVO_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

function extensionParaMime(mime) {
  if (EXT_POR_MIME[mime]) return EXT_POR_MIME[mime];
  const sub = String(mime || "").split("/")[1];
  return sub ? "." + sub.replace(/[^a-z0-9]/gi, "").slice(0, 10) : ".bin";
}

// Devuelve el nombre random con el que quedó guardado en disco.
function guardarArchivoEstudio(buffer, mime) {
  const archivoNombre = crypto.randomUUID() + extensionParaMime(mime);
  fs.writeFileSync(path.join(DIR_ESTUDIOS, archivoNombre), buffer);
  return archivoNombre;
}

module.exports = { DIR_ESTUDIOS, TIPOS_ARCHIVO_PERMITIDOS, extensionParaMime, guardarArchivoEstudio };
