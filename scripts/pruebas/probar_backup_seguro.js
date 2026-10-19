#!/usr/bin/env node
// Prueba focalizada del respaldo seguro: configuración cerrada, cifrado
// autenticado y rechazo de una clave insuficiente.
const assert = require("assert");

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/symphomed_prueba";
process.env.OPENAI_KEY ||= "prueba";
process.env.JWT_SECRET ||= "prueba-prueba-prueba-prueba";
process.env.BACKUP_CLAVE = "clave-de-prueba-".repeat(4);
process.env.BACKUP_COMANDO_SUBIDA = "true {archivo}";
process.env.BACKUP_COMANDO_VERIFICAR = "true {archivo}";
process.env.BACKUP_EXIGIR_SEGURO = "1";

const backup = require("../../services/backup");

const cfg = backup.validarConfiguracionBackup();
assert.equal(cfg.ok, true, "la configuración completa debe aceptarse");

const original = Buffer.from("historia clínica de prueba", "utf8");
const cifrado = backup.cifrar(original);
assert.equal(cifrado.cifrado, true, "la copia debe quedar cifrada");
assert.notDeepEqual(cifrado.buffer, original, "el texto claro no puede ser el archivo final");
assert.deepEqual(backup.descifrar(cifrado.buffer), original, "el cifrado debe poder abrirse con la misma clave");

const alterado = Buffer.from(cifrado.buffer);
alterado[alterado.length - 1] ^= 1;
assert.throws(
  () => backup.descifrar(alterado),
  /clave no es la correcta|archivo está dañado/,
  "AES-GCM debe detectar una copia modificada"
);

assert.throws(
  () => backup.validarConfiguracionBackup({
    estricto: true,
    clave: "corta",
    comandoSubida: "true {archivo}",
    comandoVerificar: "true {archivo}",
  }),
  /Configuración de respaldos insegura/,
  "el modo cerrado debe rechazar una clave corta"
);

console.log("✓ backup seguro: configuración, cifrado autenticado y rechazo fail-closed");

// El tar de los estudios se cifra de archivo a archivo, sin cargarlo en
// memoria (readFile no pasa de 2 GiB). Tiene que salir con el MISMO formato
// que cifrar(): los respaldos ya guardados y los nuevos se abren igual.
(async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const crypto = require("crypto");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-seguro-"));
  try {
    const claro = path.join(dir, "estudios.tar.gz");
    const datos = crypto.randomBytes(3 * 1024 * 1024 + 7); // varios pedazos de lectura
    fs.writeFileSync(claro, datos);

    const cifradoNuevo = path.join(dir, "nuevo.bin");
    await backup.cifrarArchivo(claro, cifradoNuevo);
    const bytesNuevo = fs.readFileSync(cifradoNuevo);
    assert.equal(bytesNuevo.subarray(0, 10).toString(), "VITALISBK1", "el archivo cifrado lleva la misma cabecera");
    assert.equal(bytesNuevo.length, datos.length + 10 + 16 + 12 + 16, "cabecera + cuerpo, sin nada de más");
    assert.equal((fs.statSync(cifradoNuevo).mode & 0o777).toString(8), "600", "el cifrado solo lo lee el dueño");
    assert.deepEqual(backup.descifrar(bytesNuevo), datos, "lo cifrado por pedazos se abre con descifrar() de siempre");

    const restaurado = path.join(dir, "vuelta.tar.gz");
    assert.deepEqual(await backup.descifrarArchivo(cifradoNuevo, restaurado), { cifrado: true });
    assert.deepEqual(fs.readFileSync(restaurado), datos, "y con descifrarArchivo(), por pedazos");

    // Un tar cifrado antes de este cambio, con cifrar() en memoria.
    const viejo = path.join(dir, "viejo.bin");
    fs.writeFileSync(viejo, backup.cifrar(datos).buffer);
    const restauradoViejo = path.join(dir, "vuelta-viejo.tar.gz");
    await backup.descifrarArchivo(viejo, restauradoViejo);
    assert.deepEqual(fs.readFileSync(restauradoViejo), datos, "descifrarArchivo() abre los respaldos hechos con cifrar()");

    // Uno tocado: GCM lo detecta al final, cuando ya se escribió casi todo.
    // No puede quedar ni el destino ni el temporal con cara de bueno.
    const tocado = Buffer.from(bytesNuevo);
    tocado[tocado.length - 100] ^= 1;
    fs.writeFileSync(path.join(dir, "tocado.bin"), tocado);
    const destinoTocado = path.join(dir, "tocado.tar.gz");
    await assert.rejects(
      backup.descifrarArchivo(path.join(dir, "tocado.bin"), destinoTocado),
      /clave no es la correcta|archivo está dañado/,
      "un tar cifrado y modificado no se abre"
    );
    assert.equal(fs.existsSync(destinoTocado) || fs.existsSync(destinoTocado + ".tmp"), false, "y no deja nada a medio descifrar");

    // Sin cifrar (un respaldo hecho sin BACKUP_CLAVE): se copia tal cual.
    const copia = path.join(dir, "copia.tar.gz");
    assert.deepEqual(await backup.descifrarArchivo(claro, copia), { cifrado: false });
    assert.deepEqual(fs.readFileSync(copia), datos);
    console.log("✓ backup seguro: el tar se cifra y descifra por pedazos, con el mismo formato");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
