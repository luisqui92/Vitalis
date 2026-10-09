#!/usr/bin/env node
// Symphomed — Hacer un respaldo YA, desde la terminal del servidor.
//
// Es el mismo respaldo que Symphomed hace solo cada día (services/backup.js):
// toda la base + uploads/, cifrado si hay clave, y VERIFICADO restaurándolo
// en una base aparte. Existe para el momento justo antes de un despliegue:
// el botón de Panel → Seguridad pide un operador con 2FA, y este paso no
// puede depender de tener el celular a mano.
//
// Uso:   node scripts/respaldar_ahora.js
// Sale con código 1 si el respaldo no quedó verificado: en ese caso NO se
// despliega.
const path = require("path");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }

const mongoose = require("mongoose");
require("../db/models"); // abre la conexión con MONGODB_URI
const { hacerBackup, DIR_BACKUPS } = require("../services/backup");

function humano(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes || 0) + " B";
}

(async () => {
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once("open", resolve);
      mongoose.connection.once("error", reject);
      // unref: si la base ya contestó, este reloj no deja la terminal abierta
      // 30 segundos más después de terminar.
      setTimeout(() => reject(new Error("MongoDB no respondió en 30 segundos")), 30000).unref();
    });
  }
  console.log("\n  Haciendo el respaldo (la base entera + uploads/, y verificándolo)…\n");
  const m = await hacerBackup({ verificar: true });
  if (m?.salteado) throw new Error(`se salteó: ${m.motivo}`);

  const ok = m.verificado === true;
  console.log(`  ${ok ? "✅" : "❌"} ${new Date(m.fecha).toLocaleString("es-BO")}`);
  console.log(`     ${m.documentos} documentos · ${m.archivos} archivos · ${humano((m.bytesBase || 0) + (m.bytesArchivos || 0))} · ${m.cifrado ? "cifrado" : "SIN CIFRAR"}`);
  console.log(`     verificado restaurándolo: ${ok ? "SÍ" : "NO"}`);
  console.log(`     copia afuera del servidor: ${m.externo?.verificado ? "sí, verificada" : (m.externo?.estado || "no configurada")}`);
  console.log(`     carpeta: ${DIR_BACKUPS}`);
  console.log(`     archivo: ${m.archivoBase}\n`);
  if (!ok) {
    console.log("  ❌ El respaldo NO quedó verificado. No despliegues: avisá antes.\n");
    process.exitCode = 1;
  }
})()
  .catch((e) => {
    console.error("\n  ❌ No se pudo hacer el respaldo:", e.message, "\n  No despliegues: avisá antes.\n");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
