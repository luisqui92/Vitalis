#!/usr/bin/env node
// Symphomed — Los bancos de estudio: casos del paciente virtual y preguntas
// de simulacro (modulos/estudiantes/pacienteVirtual.js y simulacros.js).
//
// Se llenan solos cuando un estudiante pide algo que no hay, pero eso lo hace
// esperar. Precargarlos una vez evita la espera de los primeros. Todo lo que
// hay acá es inventado (ningún paciente real), así que se puede mostrar.
//
// Uso:
//   node scripts/banco_estudio.js                    (cuánto hay en cada banco, por idioma y área)
//   node scripts/banco_estudio.js preguntas --idioma es --area pediatria --n 30
//   node scripts/banco_estudio.js preguntas --idioma es --todas --n 20      (20 por área)
//   node scripts/banco_estudio.js casos --idioma es --area clinica --dificultad intermedio --n 3
//   node scripts/banco_estudio.js casos --idioma es --todas --n 2           (2 por área y dificultad)
//   node scripts/banco_estudio.js reportadas         (lo que los estudiantes marcaron como mal)
//   node scripts/banco_estudio.js restaurar <id>     (vuelve al banco algo que se sacó por reportes)
//
// Cuesta centavos de dólar: unas 20 preguntas o un caso, alrededor de 1 centavo.
const path = require("path");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }
const mongoose = require("mongoose");
const { PreguntaSimulacro, CasoVirtual } = require("../modulos/estudiantes/modelos");
const simulacros = require("../modulos/estudiantes/simulacros");
const pv = require("../modulos/estudiantes/pacienteVirtual");

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
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
const opcion = (argv, nombre) => { const i = argv.indexOf("--" + nombre); return i > -1 ? argv[i + 1] : undefined; };
const fallar = (msg) => { console.error(ROJO(`\n  ❌ ${msg}\n`)); process.exitCode = 1; };

async function estado() {
  const [preguntas, casos] = await Promise.all([
    PreguntaSimulacro.aggregate([{ $group: { _id: { idioma: "$idioma", area: "$area" }, n: { $sum: 1 }, ocultas: { $sum: { $cond: ["$oculta", 1, 0] } } } }, { $sort: { _id: 1 } }]),
    CasoVirtual.aggregate([{ $group: { _id: { idioma: "$idioma", area: "$area", dificultad: "$dificultad" }, n: { $sum: 1 }, usos: { $sum: "$usos" }, ocultos: { $sum: { $cond: ["$oculto", 1, 0] } } } }, { $sort: { _id: 1 } }]),
  ]);
  console.log("\n  Preguntas de simulacro:");
  if (!preguntas.length) console.log(GRIS("    (ninguna todavía)"));
  for (const x of preguntas) console.log(`    ${x._id.idioma} · ${x._id.area.padEnd(14)} ${String(x.n).padStart(4)}${x.ocultas ? ROJO(`  (${x.ocultas} sacadas por reportes)`) : ""}`);
  console.log("\n  Casos del paciente virtual:");
  if (!casos.length) console.log(GRIS("    (ninguno todavía)"));
  for (const x of casos) console.log(`    ${x._id.idioma} · ${x._id.area.padEnd(12)} ${x._id.dificultad.padEnd(11)} ${String(x.n).padStart(3)} caso(s), usados ${x.usos} vez/veces${x.ocultos ? ROJO(`  (${x.ocultos} sacados)`) : ""}`);
  console.log("");
}

async function preguntas(argv) {
  const idioma = opcion(argv, "idioma") || "es";
  const n = Number(opcion(argv, "n") || 20);
  const areas = argv.includes("--todas") ? simulacros.AREAS : [opcion(argv, "area")];
  if (areas.some(a => !simulacros.AREAS.includes(a))) return fallar(`--area tiene que ser ${simulacros.AREAS.join(", ")} (o --todas)`);
  if (!(n > 0 && n <= 100)) return fallar("--n tiene que ser de 1 a 100");
  for (const area of areas) {
    let hechas = 0;
    // De a 20: es lo que sale en un pedido (cuatro lotes de cinco, a la par).
    while (hechas < n) {
      const nuevas = await simulacros.generarPreguntas(idioma, area, Math.min(20, n - hechas));
      if (!nuevas) break;
      hechas += nuevas;
    }
    console.log(VERDE(`  ✅ ${area} (${idioma}): ${hechas} pregunta(s) nueva(s), verificadas.`));
  }
}

async function casos(argv) {
  const idioma = opcion(argv, "idioma") || "es";
  const n = Number(opcion(argv, "n") || 1);
  const areas = argv.includes("--todas") ? pv.AREAS : [opcion(argv, "area")];
  const dificultades = argv.includes("--todas") ? pv.DIFICULTADES : [opcion(argv, "dificultad") || "intermedio"];
  if (areas.some(a => !pv.AREAS.includes(a))) return fallar(`--area tiene que ser ${pv.AREAS.join(", ")} (o --todas)`);
  if (dificultades.some(d => !pv.DIFICULTADES.includes(d))) return fallar(`--dificultad tiene que ser ${pv.DIFICULTADES.join(", ")}`);
  if (!(n > 0 && n <= 10)) return fallar("--n tiene que ser de 1 a 10");
  for (const area of areas) {
    for (const dificultad of dificultades) {
      let hechos = 0;
      for (let i = 0; i < n; i++) {
        try {
          const c = await pv.generarCaso(idioma, area, dificultad);
          // Recién creado no lo usó nadie (generarCaso lo cuenta como usado,
          // porque normalmente lo pide un estudiante).
          await CasoVirtual.updateOne({ _id: c._id }, { $set: { usos: 0 } });
          hechos++;
        } catch (e) { console.log(ROJO(`  ❌ ${area}/${dificultad}: ${e.message}`)); }
      }
      console.log(VERDE(`  ✅ ${area} · ${dificultad} (${idioma}): ${hechos} caso(s) nuevo(s).`));
    }
  }
}

async function reportadas() {
  const [ps, cs] = await Promise.all([
    PreguntaSimulacro.find({ "reportes.0": { $exists: true } }).sort({ updatedAt: -1 }).limit(30).lean(),
    CasoVirtual.find({ "reportes.0": { $exists: true } }).sort({ updatedAt: -1 }).limit(30).lean(),
  ]);
  if (!ps.length && !cs.length) return console.log("\n  Nadie marcó nada como mal.\n");
  for (const p of ps) {
    console.log(`\n  ${p.oculta ? ROJO("[SACADA]") : "[reportada]"} pregunta ${p._id} · ${p.area} · ${p.reportes.map(r => r.motivo).join(", ")}`);
    console.log(`    ${p.enunciado}`);
    p.opciones.forEach((o, i) => console.log(`    ${i === p.correcta ? VERDE("→") : " "} ${i}. ${o}`));
    console.log(GRIS(`    ${p.explicacion}`));
  }
  for (const c of cs) {
    console.log(`\n  ${c.oculto ? ROJO("[SACADO]") : "[reportado]"} caso ${c._id} · ${c.area} · ${c.dificultad} · ${c.reportes.map(r => r.motivo).join(", ")}`);
    console.log(`    ${c.guion?.motivo} → ${c.guion?.diagnostico}`);
  }
  console.log(GRIS("\n  Para devolver uno al banco: node scripts/banco_estudio.js restaurar <id>\n"));
}

async function restaurar(id) {
  if (!mongoose.isValidObjectId(id)) return fallar("Falta el id: node scripts/banco_estudio.js restaurar <id>");
  const a = await PreguntaSimulacro.updateOne({ _id: id }, { $set: { oculta: false, reportes: [] } });
  const b = await CasoVirtual.updateOne({ _id: id }, { $set: { oculto: false, reportes: [] } });
  if (!a.matchedCount && !b.matchedCount) return fallar("No hay ninguna pregunta ni caso con ese id");
  console.log(VERDE("\n  ✅ Vuelve al banco, sin reportes.\n"));
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  await conectar();
  if (!comando) return estado();
  if (comando === "preguntas") return preguntas(resto);
  if (comando === "casos") return casos(resto);
  if (comando === "reportadas") return reportadas();
  if (comando === "restaurar") return restaurar(resto[0]);
  fallar("Uso: node scripts/banco_estudio.js [preguntas|casos|reportadas|restaurar] …");
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
