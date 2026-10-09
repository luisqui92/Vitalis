#!/usr/bin/env node
// Symphomed — Pacientes de ejemplo para cuentas que YA existen.
//
// Para una demostración: una cuenta vacía no muestra nada. Los seeds de
// demostración (seed_*_demo.js) ya arman pacientes con historia, pero tienen
// una trampa para una cuenta que ya existe: la CONVIERTEN a la especialidad
// del seed (el de odontología la pasa a odontología; el de Brasil le cambia el
// idioma y la moneda). Correr el seed equivocado sobre la cuenta equivocada es
// quedarse con otra cuenta sin enterarse.
//
// Este script lee la especialidad ACTUAL de cada cuenta y corre solo el seed que
// le corresponde, así que nada se convierte. Los seeds no duplican: saltan los
// pacientes que ya existen (por nombre), así que se puede correr dos veces.
// La contraseña no se toca.
//
// Uso:
//   node scripts/poblar_demo.js <telefono> [<telefono>...]
//   node scripts/poblar_demo.js --demos            (las cuentas de los seeds de demo)
//
// Frenos:
//   · muestra qué va a correr en cada cuenta, y pide escribir SI;
//   · se niega con las cuentas que ya tienen más de 25 pacientes (no parecen de
//     demostración), salvo --forzar;
//   · no toca una cuenta inactiva ni al administrador de una clínica (no ve
//     fichas: sus números salen de los consultorios).
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }

const mongoose = require("mongoose");
const { Medico, Paciente, ConfigPago } = require("../db/models");

const MAX_PACIENTES = 25;

// Cuentas que dejan los seeds de demostración (ver poner_clave.js).
const DEMOS = ["79000001", "79000002", "79000003", "79000004", "123", "78811007"];

// Especialidad → qué seed la puebla. «crea»: cuentas nuevas que ese seed deja
// además de los pacientes, para decirlo antes de correrlo.
const SEEDS = {
  medicina_general: { archivo: "seed_medicina_general_demo.js" },
  odontologia: { archivo: "seed_odontologo_demo.js" },
  oftalmologia: { archivo: "seed_oftalmologia_demo.js" },
  ginecologia: { archivo: "seed_ginecologia_demo.js" },
  veterinaria: { archivo: "seed_veterinaria_demo.js" },
  estetica: { archivo: "seed_estetica_demo.js" },
  fisioterapia: { archivo: "seed_fisioterapia_demo.js", crea: "los colegas -01 y -02 del centro" },
  neurodesarrollo: { archivo: "seed_neurodesarrollo_demo.js", crea: "los colegas -01, -02 y -03 del centro" },
};
const SEED_BRASIL = { archivo: "seed_brasil_demo.js" };

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
    // unref: si la base ya contestó, este reloj no deja la terminal abierta
    // 30 segundos más después de terminar.
    setTimeout(() => reject(new Error("MongoDB no respondió en 30 segundos")), 30000).unref();
  });
}

function correrSeed(archivo, phone) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(__dirname, archivo), phone], { cwd: path.join(__dirname, ".."), env: process.env });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    h.on("exit", (codigo) => resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}

// Qué le corresponde a esta cuenta, o por qué no se la toca.
async function planDe(m, pacientes, forzar) {
  if (m.activo === false) return { no: "INACTIVA: no se toca" };
  if (m.rol === "admin") return { no: "es el administrador de una clínica: no ve fichas, sus números salen de los consultorios" };
  if (pacientes > MAX_PACIENTES && !forzar) return { no: `ya tiene ${pacientes} pacientes: no parece de demostración (--forzar para hacerlo igual)` };
  const esp = m.tipoEspecialidad || "medicina_general";
  const brasilera = m.moneda === "BRL" || m.idioma === "pt";
  if (brasilera && esp === "medicina_general") {
    const hayCobro = await ConfigPago.findOne({ clave: "br" }).lean();
    return { seed: SEED_BRASIL, aviso: hayCobro ? "" : "también carga los datos de cobro de Brasil (hoy no hay ninguno)" };
  }
  const seed = SEEDS[esp];
  if (!seed) return { no: `no hay pacientes de ejemplo para «${esp}»` };
  return { seed, aviso: brasilera ? "los ejemplos están en español" : "" };
}

async function main() {
  const argv = process.argv.slice(2);
  const forzar = argv.includes("--forzar");
  const telefonos = [...new Set([...(argv.includes("--demos") ? DEMOS : []), ...argv.filter((a) => !a.startsWith("--"))])];
  if (!telefonos.length) {
    console.error("\n  Uso: node scripts/poblar_demo.js <telefono> [<telefono>...]");
    console.error("       node scripts/poblar_demo.js --demos\n");
    process.exit(1);
  }

  await conectar();
  const trabajo = [];
  console.log("\n  Cuentas:\n");
  for (const phone of telefonos) {
    const m = await Medico.findOne({ phone }).select("phone nombre rol activo tipoEspecialidad idioma moneda").lean();
    if (!m) { console.log(GRIS(`  ${phone.padEnd(14)} no existe`)); continue; }
    const pacientes = await Paciente.countDocuments({ medicoPhone: phone });
    const plan = await planDe(m, pacientes, forzar);
    const cabeza = `  ${phone.padEnd(14)} ${String(m.nombre || "").slice(0, 28).padEnd(30)} ${String(m.tipoEspecialidad || "").padEnd(17)} ${String(pacientes).padStart(3)} pac.`;
    if (plan.no) { console.log(`${cabeza}  ${ROJO(plan.no)}`); continue; }
    console.log(`${cabeza}  → ${plan.seed.archivo}${plan.seed.crea ? GRIS(` (además crea ${plan.seed.crea})`) : ""}${plan.aviso ? ROJO(`  ⚠ ${plan.aviso}`) : ""}`);
    trabajo.push({ m, pacientes, plan });
  }

  if (!trabajo.length) { console.log("\n  Ninguna cuenta para poblar.\n"); return; }
  console.log(`\n  Se van a agregar pacientes de ejemplo a ${trabajo.length} cuenta(s). No se cambia la especialidad ni la contraseña.`);
  if (await preguntar("  Escribí SI para confirmar: ") !== "SI") { console.log("  Cancelado. No se tocó nada.\n"); return; }

  console.log("");
  let falló = false;
  for (const { m, pacientes, plan } of trabajo) {
    const r = await correrSeed(plan.seed.archivo, m.phone);
    const despues = await Paciente.countDocuments({ medicoPhone: m.phone });
    if (r.codigo === 0) {
      console.log(`  ${VERDE("✅")} ${m.phone.padEnd(14)} ${pacientes} → ${despues} pacientes`);
    } else {
      falló = true;
      console.log(`  ${ROJO("❌")} ${m.phone.padEnd(14)} el seed falló (código ${r.codigo}):`);
      console.log(GRIS(r.salida.split("\n").filter(Boolean).slice(-6).map((l) => "       " + l).join("\n")));
    }
  }
  console.log(falló ? ROJO("\n  Alguna cuenta falló: miralo arriba.\n") : GRIS("\n  Listo. Podés correrlo de nuevo sin miedo: no duplica.\n"));
  if (falló) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
