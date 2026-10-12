#!/usr/bin/env node
// Symphomed — Códigos de paciente repetidos dentro de un mismo consultorio.
//
// Hasta la revisión integral del 11 de octubre de 2026 (S06), dos altas a la
// vez podían salir con el mismo código (P-0001 y P-0001). Ahora no
// (services/codigos.js), y el paciente tiene un índice único por consultorio
// y código. Ese índice no se puede crear mientras queden repetidos de antes:
// el servidor anda igual, pero lo avisa en el log al arrancar.
//
// Uso:
//   node scripts/codigos_repetidos.js              solo mira: no cambia nada
//   node scripts/codigos_repetidos.js --arreglar   al paciente más viejo de cada grupo le
//                                                  deja su código; a los demás les da uno
//                                                  nuevo, y crea el índice
//
// No muestra nombres: con el id de la ficha alcanza para avisarle al médico
// cuál cambió de código (lo que el técnico tipea en el equipo de imagen).
const path = require("path");
const readline = require("readline");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }
const mongoose = require("mongoose");
const { Paciente, AuditLog } = require("../db/models");
const { siguienteCodigo } = require("../services/codigos");

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (a) => { rl.close(); r(a.trim()); }));
}
async function conectar() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    mongoose.connection.once("open", resolve);
    mongoose.connection.once("error", reject);
    setTimeout(() => reject(new Error("MongoDB no respondió en 30 segundos")), 30000).unref();
  });
}

// Los grupos de fichas con el mismo código en el mismo consultorio, cada uno
// del más viejo al más nuevo.
async function repetidos() {
  const grupos = await Paciente.aggregate([
    { $match: { codigo: { $gt: "" } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: { medicoPhone: "$medicoPhone", codigo: "$codigo" }, fichas: { $push: { id: "$_id", creado: "$createdAt" } }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $sort: { "_id.medicoPhone": 1, "_id.codigo": 1 } },
  ]).allowDiskUse(true);
  return grupos.map(g => ({ medicoPhone: g._id.medicoPhone, codigo: g._id.codigo, fichas: g.fichas }));
}

async function hayIndice() {
  const indices = await Paciente.collection.indexes().catch(() => []);
  return indices.some(i => i.unique && i.key?.medicoPhone === 1 && i.key?.codigo === 1);
}

async function main() {
  const arreglar = process.argv.includes("--arreglar");
  await conectar();
  const grupos = await repetidos();
  const sobran = grupos.reduce((n, g) => n + g.fichas.length - 1, 0);

  if (!grupos.length) {
    console.log(VERDE("\n  ✅ No hay códigos de paciente repetidos."));
  } else {
    console.log(`\n  ${ROJO(`${grupos.length} código(s) repetido(s)`)} — ${sobran} ficha(s) tendrían que cambiar de código:\n`);
    for (const g of grupos) {
      console.log(`  ${g.medicoPhone}  ${g.codigo}`);
      g.fichas.forEach((f, i) => console.log(`     ${i === 0 ? "se queda    " : "cambiaría   "} ficha ${f.id} ${GRIS(`(creada ${dia(f.creado)})`)}`));
    }
  }
  const indice = await hayIndice();
  console.log(indice ? VERDE("\n  ✅ El índice de códigos únicos está creado.\n") : `\n  ${ROJO("El índice de códigos únicos todavía no está.")}${grupos.length ? "" : " Se crea al reiniciar el servidor, o con --arreglar."}\n`);

  if (!arreglar) {
    if (grupos.length) console.log("  Para arreglarlo: node scripts/codigos_repetidos.js --arreglar\n");
    return;
  }
  if (grupos.length) {
    if (await preguntar(`  Se van a cambiar ${sobran} código(s). Escribí SI para seguir: `) !== "SI") {
      console.log("  Cancelado. No se tocó nada.\n");
      return;
    }
    for (const g of grupos) {
      const prefijo = g.codigo.split("-")[0] || "P";
      for (const f of g.fichas.slice(1)) {
        const nuevo = await siguienteCodigo(Paciente, g.medicoPhone, prefijo);
        const r = await Paciente.updateOne({ _id: f.id, codigo: g.codigo }, { $set: { codigo: nuevo } });
        if (!r.modifiedCount) continue;
        await AuditLog.create({ medicoPhone: "script", accion: "recodificar_paciente_repetido",
          recurso: `Paciente:${f.id}`, detalle: `${g.medicoPhone} ${g.codigo} → ${nuevo}` }).catch(() => {});
        console.log(`  ${g.medicoPhone}  ficha ${f.id}: ${g.codigo} → ${VERDE(nuevo)}`);
      }
    }
  }
  if (!indice) {
    try {
      await Paciente.createIndexes();
      console.log(VERDE("\n  ✅ Índice de códigos únicos creado.\n"));
    } catch (e) {
      console.log(ROJO(`\n  ❌ No se pudo crear el índice: ${e.message}\n`));
      process.exitCode = 1;
    }
  }
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
