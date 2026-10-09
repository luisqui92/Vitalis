#!/usr/bin/env node
// Symphomed — Qué falló en las pantallas de los médicos.
//
// Los errores que mandan los celulares y las compus (public/js/errores.js),
// agrupados: cuántas veces, a cuántos médicos, cuándo, en qué pantalla y
// dónde en el código — traducido del ofuscado a la línea original con el
// mapa de esa versión (scripts/ofuscar.js). Sin datos de pacientes.
//
// Uso:
//   node scripts/errores_pantalla.js             (los de los últimos 7 días)
//   node scripts/errores_pantalla.js --dias 30
const path = require("path");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }
const mongoose = require("mongoose");
const { ErrorCliente } = require("../db/models");
const { traducir } = require("../services/erroresCliente");

const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

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

const hora = (d) => new Date(d).toLocaleString("es-BO", { timeZone: "America/La_Paz", dateStyle: "short", timeStyle: "short" });

async function main() {
  const i = process.argv.indexOf("--dias");
  const dias = i > -1 ? Number(process.argv[i + 1]) || 7 : 7;
  await conectar();
  const errores = await ErrorCliente.find({ ultima: { $gte: new Date(Date.now() - dias * 86400000) } }).sort({ ultima: -1 }).limit(50).lean();
  if (!errores.length) {
    console.log(`\n  ✅ Ningún error de pantalla en los últimos ${dias} días.\n`);
    return;
  }
  console.log(`\n  Errores de pantalla, últimos ${dias} días (el más reciente primero):\n`);
  for (const e of errores) {
    console.log(ROJO(`  ● ${e.mensaje}`));
    console.log(`    ${e.veces} vez/veces · ${e.medicos.length} médico(s) · última: ${hora(e.ultima)} · primera: ${hora(e.primera)}`);
    console.log(`    pantalla: ${e.pantalla || "?"} · contexto: ${e.contexto || "?"} · idioma: ${e.idioma || "?"} · versión: ${e.version}`);
    const donde = traducir(e.pila, e.version);
    if (donde) console.log(`    dónde: ${donde}`);
    if (e.medicos.length) console.log(GRIS(`    médicos: ${e.medicos.join(", ")}`));
    console.log("");
  }
  console.log(GRIS("  Pasale esto a quien mantiene Symphomed: con el «dónde» se encuentra la causa.\n"));
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
