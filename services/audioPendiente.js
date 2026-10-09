// Symphomed — El audio de una consulta, guardado en disco mientras se
// transcribe.
//
// ═══ POR QUÉ ════════════════════════════════════════════════════════════════
//
// El teléfono borra su copia de la grabación apenas el servidor le contesta
// que la recibió (202). Hasta ahora, después de eso el audio vivía solo en la
// memoria del proceso mientras AssemblyAI lo transcribía: si el servidor se
// reiniciaba en ese rato —un despliegue, una caída—, la consulta se perdía y
// quedaba «procesando» para siempre (informe de QA del 9 de octubre de 2026).
//
// Ahora el audio se escribe acá ANTES de contestar, y se borra cuando la
// transcripción termina, bien o mal. Lo que hay acá al arrancar es lo que se
// interrumpió, y se retoma (routes/consultaMedica.js, retomarConsultas).
//
// Fuera de /public, como los estudios: es la voz de un paciente. Y solo el
// tiempo que dura la transcripción: no es un archivo de grabaciones.
const fs = require("fs");
const path = require("path");

const DIR_AUDIO = process.env.DIR_AUDIO_PENDIENTE || path.join(__dirname, "..", "uploads", "audio-pendiente");
fs.mkdirSync(DIR_AUDIO, { recursive: true });

const EXT = ".audio";
const archivoDe = (id) => path.join(DIR_AUDIO, String(id).replace(/[^a-f0-9]/gi, "") + EXT);

// Primero a un archivo aparte, y recién completo y en el disco, con su
// nombre: si el servidor se cae a mitad de la escritura, no queda un audio
// cortado que parezca entero.
async function guardar(id, buffer) {
  const final = archivoDe(id);
  const parcial = `${final}.parcial`;
  const fh = await fs.promises.open(parcial, "w", 0o600);
  try {
    await fh.writeFile(buffer);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.promises.rename(parcial, final);
}

// null si no está.
async function leer(id) {
  try {
    return await fs.promises.readFile(archivoDe(id));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function borrar(id) {
  try {
    await fs.promises.unlink(archivoDe(id));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

// Los ids de los audios guardados antes de «antesDe» (lo de después es de
// subidas que están pasando ahora). Los que quedaron a medio escribir se
// tiran: de esos el teléfono todavía tiene su copia, porque no llegó a
// recibir el 202.
async function guardados(antesDe = new Date()) {
  const ids = [];
  for (const nombre of await fs.promises.readdir(DIR_AUDIO)) {
    const ruta = path.join(DIR_AUDIO, nombre);
    const stat = await fs.promises.stat(ruta).catch(() => null);
    if (!stat || stat.mtime >= antesDe) continue;
    if (nombre.endsWith(".parcial")) await fs.promises.unlink(ruta).catch(() => {});
    else if (nombre.endsWith(EXT)) ids.push(nombre.slice(0, -EXT.length));
  }
  return ids;
}

module.exports = { DIR_AUDIO, guardar, leer, borrar, guardados };
