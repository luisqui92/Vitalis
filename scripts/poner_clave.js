#!/usr/bin/env node
// Symphomed — Ponerle una contraseña CONOCIDA a cuentas de prueba.
//
// Para cuando hay una demo mañana y nadie se acuerda con qué clave quedó cada
// cuenta (los seeds generan una al azar y la muestran una sola vez). Las
// contraseñas se guardan cifradas: no hay forma de recuperarlas, solo de
// ponerlas de nuevo.
//
// Uso:
//   node scripts/poner_clave.js --clave "Symphomed1234" --demos
//   node scripts/poner_clave.js --clave "Symphomed1234" 79000000 78811007 ...
//
// --demos son las cuentas que crean los seeds de demostración (la clínica
// demo: 79000000 a 79000004; el centro de neurodesarrollo: 123 y 123-01 a -03;
// el de fisioterapia: 78811007 y sus dos colegas). Cualquier otro teléfono se
// pasa a mano.
//
// ═══ POR QUÉ TIENE FRENOS ══════════════════════════════════════════════════
//
// Cambiarle la contraseña a alguien lo saca de su cuenta hasta que se entere
// de la nueva. Este script corre en el mismo servidor que las historias
// reales, así que:
//   · muestra nombre, rol, pacientes y fecha de cada cuenta ANTES de tocar
//     nada, y pide escribir SI;
//   · se niega con las cuentas que tienen más de 25 pacientes (una demo no los
//     tiene; un médico de verdad sí). Con --forzar se hace igual;
//   · no toca una cuenta inactiva: aunque la clave fuera la correcta, no
//     podría entrar, y el problema es otro;
//   · cada cambio queda en la auditoría.
const path = require("path");
const readline = require("readline");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }

const mongoose = require("mongoose");
const { Medico, Paciente, AuditLog } = require("../db/models");
const { hashPassword } = require("../services/auth");

const DEMOS = [
  "79000000", "79000001", "79000002", "79000003", "79000004",
  "123", "123-01", "123-02", "123-03",
  "78811007", "78811007-01", "78811007-02",
];
const MAX_PACIENTES = 25;

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (a) => { rl.close(); r(a.trim()); }));
}

async function conectar() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    mongoose.connection.once("open", resolve);
    mongoose.connection.once("error", reject);
    setTimeout(() => reject(new Error("MongoDB no respondió en 30 segundos")), 30000);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const iClave = argv.indexOf("--clave");
  const clave = iClave > -1 ? String(argv[iClave + 1] || "").trim() : "";
  const forzar = argv.includes("--forzar");
  // Los teléfonos son lo que queda sin las opciones ni el valor de --clave.
  const resto = argv.filter((a, i) => !a.startsWith("--") && i !== iClave + 1);
  const telefonos = [...new Set([...(argv.includes("--demos") ? DEMOS : []), ...resto])];

  if (!clave || !telefonos.length) {
    console.error('\n  Uso: node scripts/poner_clave.js --clave "LaClave" --demos');
    console.error('       node scripts/poner_clave.js --clave "LaClave" <telefono> [<telefono>...]\n');
    process.exit(1);
  }
  if (clave.length < 8) console.log(ROJO("\n  ⚠️  La clave tiene menos de 8 caracteres: es muy fácil de adivinar."));

  await conectar();
  const cuentas = [];
  console.log("\n  Cuentas encontradas:\n");
  for (const phone of telefonos) {
    const m = await Medico.findOne({ phone }).select("phone nombre rol activo createdAt").lean();
    if (!m) { console.log(GRIS(`  ${phone.padEnd(14)} no existe`)); continue; }
    const pacientes = await Paciente.countDocuments({ medicoPhone: phone });
    let nota = "";
    if (m.activo === false) nota = ROJO("  INACTIVA: no se toca");
    else if (pacientes > MAX_PACIENTES && !forzar) nota = ROJO(`  tiene ${pacientes} pacientes: no parece de prueba, no se toca (--forzar para hacerlo igual)`);
    console.log(`  ${phone.padEnd(14)} ${String(m.nombre || "").slice(0, 34).padEnd(36)} ${String(m.rol || "medico").padEnd(8)} ${String(pacientes).padStart(3)} pac.  ${m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 10) : ""}${nota}`);
    if (!nota) cuentas.push(m);
  }

  if (!cuentas.length) { console.log("\n  Ninguna cuenta para cambiar.\n"); return; }
  console.log(`\n  Se le va a poner la clave nueva a ${cuentas.length} cuenta(s).`);
  if (await preguntar("  Escribí SI para confirmar: ") !== "SI") { console.log("  Cancelado. No se tocó nada.\n"); return; }

  const hash = await hashPassword(clave);
  for (const m of cuentas) {
    await Medico.updateOne({ phone: m.phone }, { $set: { passwordHash: hash } });
    // Esperado: perder una línea de auditoría no frena el cambio, pero acá se
    // espera para que el proceso no termine antes de que se escriba.
    await AuditLog.create({ medicoPhone: "script", accion: "poner_clave_script", recurso: `Medico:${m.phone}`, detalle: "contraseña nueva por script" })
      .catch((e) => console.error(`  (no se pudo anotar en la auditoría: ${e.message})`));
  }

  console.log(VERDE(`\n  ✅ Listo. Entrá con la clave nueva:\n`));
  for (const m of cuentas) console.log(`     ${m.phone.padEnd(14)} ${clave}    ${GRIS(m.nombre || "")}`);
  console.log(GRIS("\n  Son cuentas de prueba en un servidor real: cuando termines, borralas con el --borrar de su seed.\n"));
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
