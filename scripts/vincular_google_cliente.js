#!/usr/bin/env node
// Soporte por SSH: autorización puntual, no cambia teléfonos ni contraseñas.
const readline = require("node:readline/promises");
const os = require("node:os");
const mongoose = require("mongoose");
const { Medico } = require("../db/models");
const { patronTelefono, emitir } = require("../services/googleVinculacion");

async function main() {
  if (!process.stdin.isTTY) throw new Error("Ejecutá node scripts/vincular_google_cliente.js directamente en la terminal SSH.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const telefono = await rl.question("Teléfono del cliente, con código de país: ");
    const patron = patronTelefono(telefono);
    await mongoose.connection.asPromise();
    const cuentas = await Medico.find({ phone: patron }).select("nombre phone activo estadoCuenta googleSub googleSolo").limit(3).lean();
    if (cuentas.length !== 1) {
      console.log(cuentas.map(c => ({ id: String(c._id), nombre: c.nombre, telefono: c.phone })));
      throw new Error(cuentas.length ? "Hay varias cuentas con esos dígitos. No se eligió ninguna ni se modificó nada." : "No se encontró ese teléfono. Revisá los dígitos y el código de país.");
    }
    const c = cuentas[0];
    if (c.googleSub || c.googleSolo) throw new Error("La cuenta ya tiene Google vinculado. No se reemplazará.");
    console.log(`\nCuenta: ${c.nombre}\nTeléfono guardado: ${c.phone}\nID: ${c._id}`);
    const email = (await rl.question("Correo de Google que el cliente confirmó que usará: ")).trim().toLowerCase();
    console.log(`\nSe autorizará únicamente ${email}. El teléfono y los datos se conservan.`);
    const confirmacion = await rl.question(`Tras verificar la identidad del cliente, escribí VINCULAR ${c._id}: `);
    if (confirmacion.trim() !== `VINCULAR ${c._id}`) { console.log("Cancelado; no se modificó nada."); return; }
    const r = await emitir({ cuentaId: c._id, email, actor: "ssh:" + os.userInfo().username });
    console.log(`\nEnlace privado para el cliente (vence ${r.vence.toISOString()}):\n${r.enlace}\n`);
    console.log("Enviáselo directamente al cliente. Debe abrirlo y confirmar Google. No lo publiques ni mandes una captura del enlace.");
  } finally { rl.close(); }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
