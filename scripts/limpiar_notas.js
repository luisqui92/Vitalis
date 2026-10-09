#!/usr/bin/env node
// Symphomed — Sacar las filas vacías de las notas ya guardadas.
//
// Una nota con una fila vacía (null) en la lista de medicamentos —la IA a
// veces la deja— hacía caer la pantalla de esa consulta: «Error al cargar la
// consulta», sin más explicación. Desde ahora no se guardan más
// (services/notaClinica.js y el control al guardar en db/models.js); esto
// limpia las que quedaron de antes.
//
// Solo saca filas vacías: no toca ningún medicamento, dosis ni texto.
//
// Uso:
//   node scripts/limpiar_notas.js            ← muestra cuántas hay, por médico (no toca nada)
//   node scripts/limpiar_notas.js --hacelo   ← las limpia
const path = require("path");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }
const mongoose = require("mongoose");
const { ConsultaMedica, Medico, LISTAS_DE_LA_NOTA } = require("../db/models");

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

async function main() {
  const hacelo = process.argv.includes("--hacelo");
  await conectar();
  // «$type: null» sobre una lista mira sus elementos: las que tienen alguno
  // vacío. No agarra las que no tienen la lista.
  const filtro = { $or: LISTAS_DE_LA_NOTA.map(l => ({ [`notaClinica.${l}`]: { $type: "null" } })) };
  const porMedico = await ConsultaMedica.aggregate([{ $match: filtro }, { $group: { _id: "$medicoPhone", n: { $sum: 1 } } }]);
  if (!porMedico.length) {
    console.log("\n  ✅ Ninguna consulta tiene filas vacías en la nota.\n");
    return;
  }
  console.log("\n  Consultas con filas vacías en la nota:\n");
  for (const { _id, n } of porMedico) {
    const m = await Medico.findOne({ phone: _id }).select("nombre").lean();
    console.log(`  ${String(_id).padEnd(16)} ${String(m?.nombre || "").slice(0, 34).padEnd(36)} ${n} consulta(s)`);
  }
  if (!hacelo) {
    console.log("\n  No se tocó nada. Para limpiarlas: node scripts/limpiar_notas.js --hacelo\n");
    return;
  }
  const pull = Object.fromEntries(LISTAS_DE_LA_NOTA.map(l => [`notaClinica.${l}`, null]));
  const r = await ConsultaMedica.updateMany(filtro, { $pull: pull });
  console.log(`\n  ✅ Listo: ${r.modifiedCount} consulta(s) limpias. Ya se pueden abrir.\n`);
}

main()
  .catch((e) => { console.error(`\n  ❌ ${e.message}\n`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
