#!/usr/bin/env node
// Symphomed — Códigos de invitación para estudiantes, internos y residentes.
//
// Un código, una persona (ver modulos/estudiantes/cuenta.js). Se lo pasás por
// WhatsApp; entra a Symphomed, toca «Tengo un código de estudiante» y crea su
// cuenta. El código queda usado y anotado a su nombre.
//
// Uso:
//   node scripts/codigos_estudiante.js crear --nivel interno --meses 6
//        [--horas 12] [--precio 89] [--moneda BOB] [--cantidad 5] [--nota "Univalle 5to año"]
//   node scripts/codigos_estudiante.js listar            (los sin usar y los de los últimos 90 días)
//   node scripts/codigos_estudiante.js listar --todos
//   node scripts/codigos_estudiante.js anular EST-AB12CD
//   node scripts/codigos_estudiante.js cuentas           (los estudiantes, con horas y vencimiento)
//   node scripts/codigos_estudiante.js renovar <telefono> --meses 6 [--horas 12]
//   node scripts/codigos_estudiante.js convertir <telefono>   (se recibió: pasa a cuenta de médico)
//
// Niveles: estudiante (6 h/mes), interno (12 h/mes), residente (25 h/mes).
// --horas cambia ese tope; --precio es lo que cobraste, en bolivianos o reales,
// para que quede anotado. Un código sin usar vence a los 60 días.
const path = require("path");
const readline = require("readline");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }

const mongoose = require("mongoose");
const { Medico, AuditLog } = require("../db/models");
const { CodigoEstudiante } = require("../modulos/estudiantes/modelos");
const { NIVELES, generarCodigo, normalizarCodigo, estadoDe } = require("../modulos/estudiantes/cuenta");
const { buscarPorTelefono } = require("../services/telefono");

const VENCE_SIN_USAR_DIAS = 60;
const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

function opcion(argv, nombre) {
  const i = argv.indexOf("--" + nombre);
  return i > -1 ? argv[i + 1] : undefined;
}
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
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const fallar = (msg) => { console.error(ROJO(`\n  ❌ ${msg}\n`)); process.exitCode = 1; };

async function crear(argv) {
  const nivel = opcion(argv, "nivel");
  const meses = Number(opcion(argv, "meses"));
  if (!NIVELES[nivel]) return fallar(`--nivel tiene que ser ${Object.keys(NIVELES).join(", ")}`);
  if (!Number.isInteger(meses) || meses < 1 || meses > 24) return fallar("--meses tiene que ser un número de 1 a 24");
  const horasMes = opcion(argv, "horas") !== undefined ? Number(opcion(argv, "horas")) : NIVELES[nivel].horasMes;
  if (!(horasMes > 0)) return fallar("--horas tiene que ser un número mayor que 0");
  const moneda = (opcion(argv, "moneda") || "BOB").toUpperCase();
  if (!["BOB", "BRL"].includes(moneda)) return fallar("--moneda tiene que ser BOB o BRL");
  const precio = opcion(argv, "precio");
  const precioCentavos = precio !== undefined ? Math.round(Number(precio) * 100) : NIVELES[nivel].precio[moneda] * meses;
  if (!(precioCentavos >= 0)) return fallar("--precio tiene que ser un número");
  const cantidad = Number(opcion(argv, "cantidad") || 1);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) return fallar("--cantidad tiene que ser de 1 a 50");
  const nota = String(opcion(argv, "nota") || "").slice(0, 200);
  const vence = new Date(Date.now() + VENCE_SIN_USAR_DIAS * 86400000);

  await conectar();
  const hechos = [];
  while (hechos.length < cantidad) {
    try {
      const c = await CodigoEstudiante.create({ codigo: generarCodigo(), nivel, meses, horasMes, precioCentavos, moneda, nota, vence, creadoPor: "script" });
      hechos.push(c);
    } catch (e) {
      if (e.code !== 11000) throw e;   // un código repetido: se saca otro
    }
  }
  const simbolo = moneda === "BRL" ? "R$" : "Bs";
  console.log(VERDE(`\n  ✅ ${hechos.length} código(s) de ${nivel}, ${meses} mes(es), ${horasMes} h de audio por mes, ${simbolo} ${(precioCentavos / 100).toFixed(2)}:\n`));
  for (const c of hechos) console.log(`     ${c.codigo}`);
  console.log(GRIS(`\n  Cada uno sirve para UNA persona. Si nadie lo usa, vence el ${dia(vence)}.`));
  console.log(GRIS("  Se usa en symphomed: «Entrar» → «Tengo un código de estudiante».\n"));
}

async function listar(argv) {
  await conectar();
  const filtro = argv.includes("--todos") ? {}
    : { $or: [{ usadoPor: null, anulado: false }, { updatedAt: { $gte: new Date(Date.now() - 90 * 86400000) } }] };
  const cods = await CodigoEstudiante.find(filtro).sort({ createdAt: -1 }).limit(200).lean();
  if (!cods.length) return console.log("\n  No hay códigos.\n");
  console.log("");
  for (const c of cods) {
    const estado = c.anulado ? ROJO("anulado")
      : c.usadoPor ? `usado por ${c.usadoPor} el ${dia(c.usadoEn)}`
        : c.vence < new Date() ? ROJO("vencido sin usar") : VERDE("libre") + GRIS(` (vence ${dia(c.vence)})`);
    console.log(`  ${c.codigo}  ${c.nivel.padEnd(10)} ${String(c.meses).padStart(2)} mes(es) ${String(c.horasMes).padStart(3)} h  ${estado}${c.nota ? GRIS("  · " + c.nota) : ""}`);
  }
  console.log("");
}

async function anular(argv) {
  const codigo = normalizarCodigo(argv[1]);
  if (!codigo) return fallar("Falta el código: node scripts/codigos_estudiante.js anular EST-AB12CD");
  await conectar();
  const r = await CodigoEstudiante.updateOne({ codigo, usadoPor: null }, { $set: { anulado: true } });
  if (r.modifiedCount) return console.log(VERDE(`\n  ✅ ${codigo} anulado: ya no sirve para entrar.\n`));
  const c = await CodigoEstudiante.findOne({ codigo }).lean();
  fallar(!c ? `${codigo} no existe` : `${codigo} ya lo usó ${c.usadoPor}: anularlo no le saca la cuenta. Para eso, desactivá la cuenta.`);
}

async function cuentas() {
  await conectar();
  const xs = await Medico.find({ "estudiante.nivel": { $exists: true } }).select("phone nombre estudiante").lean();
  if (!xs.length) return console.log("\n  No hay cuentas de estudiante.\n");
  console.log("");
  for (const m of xs) {
    const e = await estadoDe(m);
    const vence = e.vencido ? ROJO(`VENCIDO ${dia(e.hasta)}`) : e.diasRestantes <= 7 ? ROJO(`vence ${dia(e.hasta)}`) : `vence ${dia(e.hasta)}`;
    const horas = e.sinHoras ? ROJO(`${e.horasUsadas}/${e.horasMes} h`) : `${e.horasUsadas}/${e.horasMes} h`;
    console.log(`  ${m.phone.padEnd(14)} ${String(m.nombre).slice(0, 30).padEnd(32)} ${e.nivel.padEnd(10)} ${horas.padEnd(12)} ${vence}`);
  }
  console.log("");
}

async function cuentaDeEstudiante(texto) {
  const m = await buscarPorTelefono(Medico, texto);
  if (!m) { fallar(`No hay ninguna cuenta con ${texto}`); return null; }
  if (!m.estudiante?.nivel) { fallar(`${m.nombre} (${m.phone}) no es una cuenta de estudiante`); return null; }
  return m;
}

async function renovar(argv) {
  const meses = Number(opcion(argv, "meses"));
  if (!argv[1] || !Number.isInteger(meses) || meses < 1 || meses > 24) return fallar("Uso: renovar <telefono> --meses 6 [--horas 12]");
  await conectar();
  const m = await cuentaDeEstudiante(argv[1]);
  if (!m) return;
  // Se suma desde hoy si ya venció, o desde el vencimiento si todavía no:
  // renovar antes de tiempo no le hace perder días.
  const base = m.estudiante.hasta && new Date(m.estudiante.hasta) > new Date() ? new Date(m.estudiante.hasta) : new Date();
  base.setMonth(base.getMonth() + meses);
  const set = { "estudiante.hasta": base, "suscripcion.hasta": base };
  if (opcion(argv, "horas") !== undefined) {
    const h = Number(opcion(argv, "horas"));
    if (!(h > 0)) return fallar("--horas tiene que ser un número mayor que 0");
    set["estudiante.horasMes"] = h;
  }
  await Medico.updateOne({ _id: m._id }, { $set: set });
  await AuditLog.create({ medicoPhone: "script", accion: "renovar_estudiante", recurso: `Medico:${m.phone}`, detalle: `+${meses} mes(es), hasta ${dia(base)}` }).catch(() => {});
  console.log(VERDE(`\n  ✅ ${m.nombre}: acceso hasta el ${dia(base)}${set["estudiante.horasMes"] ? `, ${set["estudiante.horasMes"]} h por mes` : ""}.\n`));
}

async function convertir(argv) {
  if (!argv[1]) return fallar("Uso: convertir <telefono>");
  await conectar();
  const m = await cuentaDeEstudiante(argv[1]);
  if (!m) return;
  console.log(`\n  ${m.nombre} (${m.phone}) pasa a ser una cuenta de MÉDICO: va a poder recetar, escribirle a pacientes y cobrar.`);
  console.log("  Sus pacientes y consultas siguen. Las notas que grabó como estudiante conservan la marca.");
  if (await preguntar("  Escribí SI para confirmar: ") !== "SI") return console.log("  Cancelado. No se tocó nada.\n");
  await Medico.updateOne({ _id: m._id }, { $unset: { estudiante: 1 }, $set: { especialidad: "Medicina general" } });
  await AuditLog.create({ medicoPhone: "script", accion: "convertir_estudiante_a_medico", recurso: `Medico:${m.phone}` }).catch(() => {});
  console.log(VERDE("\n  ✅ Listo. Que cierre sesión y vuelva a entrar para ver el Symphomed completo.\n"));
}

async function main() {
  const argv = process.argv.slice(2);
  const acciones = { crear, listar, anular, cuentas, renovar, convertir };
  const accion = acciones[argv[0]];
  if (!accion) {
    console.error("\n  Uso: node scripts/codigos_estudiante.js crear|listar|anular|cuentas|renovar|convertir …");
    console.error("  Ejemplo: node scripts/codigos_estudiante.js crear --nivel interno --meses 6\n");
    process.exitCode = 1;
    return;
  }
  await accion(argv);
}

main()
  .catch((e) => { console.error(ROJO(`\n  ❌ ${e.message}\n`)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
