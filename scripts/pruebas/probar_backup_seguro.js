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
