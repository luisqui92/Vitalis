#!/usr/bin/env node
// Symphomed — Cómo vienen estudiando los estudiantes (modulos/estudiantes/estudio.js).
//
// Por cuenta: tarjetas, cuántas domina, cuántas respondió y acertó, la racha,
// y cuántas marcó «esta pregunta está mal» (y por qué: la respuesta, la
// pregunta o los datos del caso). Sirve para saber si lo usan y si el
// razonamiento arma buenas preguntas.
//
// Sin el contenido de ninguna tarjeta: son casos de pacientes, y los ve solo
// el estudiante que los atendió.
//
// Uso:
//   node scripts/estudio_reportes.js
const path = require("path");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }
const mongoose = require("mongoose");
const { Medico } = require("../db/models");
const { TarjetaEstudio, RachaEstudio } = require("../modulos/estudiantes/modelos");
const { rachaVisible } = require("../modulos/estudiantes/estudio");
const { zonaValida } = require("../services/zonaHoraria");

const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

async function conectar() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    mongoose.connection.once("open", resolve);
    mongoose.connection.once("error", reject);
    setTimeout(() => reject(new Error("MongoDB no respondió en 30 segundos")), 30000);
  });
}

const MOTIVOS = { respuesta: "la respuesta", pregunta: "la pregunta", datos: "los datos del caso" };

async function main() {
  await conectar();
  const [porCuenta, reportes, cuentas, rachasGuardadas] = await Promise.all([
    TarjetaEstudio.aggregate([
      { $group: {
        _id: "$medicoPhone",
        tarjetas: { $sum: 1 },
        dominadas: { $sum: { $cond: [{ $gte: ["$caja", 4] }, 1, 0] } },
        aciertos: { $sum: "$aciertos" },
        errores: { $sum: "$errores" },
        reportadas: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$reportada.en", null] }, null] }, 1, 0] } },
        ultimaVez: { $max: "$ultimaVez" },
      } },
    ]),
    TarjetaEstudio.aggregate([
      { $match: { "reportada.en": { $ne: null } } },
      { $group: { _id: { tipo: "$tipo", motivo: "$reportada.motivo" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    Medico.find({ "estudiante.nivel": { $exists: true } }).select("phone nombre zonaHoraria estudiante").lean(),
    RachaEstudio.find({}).lean(),
  ]);
  if (!cuentas.length) return console.log("\n  No hay cuentas de estudiante.\n");

  const datos = new Map(porCuenta.map(x => [x._id, x]));
  const rachas = new Map(rachasGuardadas.map(r => [r.medicoPhone, r]));
  console.log(`\n  Estudio — ${cuentas.length} cuenta(s) de estudiante:\n`);
  for (const m of cuentas) {
    const d = datos.get(m.phone);
    const racha = rachaVisible(rachas.get(m.phone), zonaValida(m.zonaHoraria));
    console.log(`  ● ${m.nombre} (${m.phone}) · ${m.estudiante.nivel}`);
    if (!d) { console.log(GRIS("    Todavía sin tarjetas: no razonó ningún caso.\n")); continue; }
    const respuestas = d.aciertos + d.errores;
    console.log(`    ${d.tarjetas} tarjeta(s), ${d.dominadas} dominada(s) · ${respuestas} respuesta(s)${respuestas ? `, ${Math.round((d.aciertos * 100) / respuestas)} % bien` : ""}`);
    console.log(`    racha: ${racha.actual} día(s) (mejor: ${racha.mejor})${d.ultimaVez ? ` · último repaso: ${new Date(d.ultimaVez).toISOString().slice(0, 10)}` : ""}`);
    if (d.reportadas) console.log(ROJO(`    marcó ${d.reportadas} como «está mal»`));
    console.log("");
  }
  if (reportes.length) {
    console.log("  Marcadas «está mal», por tipo y motivo:");
    for (const r of reportes) console.log(`    ${r._id.tipo} · ${MOTIVOS[r._id.motivo] || r._id.motivo || "?"}: ${r.n}`);
    console.log("");
  }
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
