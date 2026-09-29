#!/usr/bin/env node
// Symphomed — Volver a generar la nota clínica de una consulta, desde la
// terminal del servidor.
//
// Hace lo mismo que el botón «Volver a generar la nota» de la pantalla de la
// consulta (routes/consultaMedica.js): usa la transcripción que ya está
// guardada —no se graba ni se transcribe nada de nuevo, y no se cobra otra
// vez— y le pide la nota a la IA. Existe para los casos en que hace falta
// ANTES de que el botón esté desplegado, o para un operador que no tiene la
// sesión del médico.
//
// Las mismas reglas que el botón: solo si la nota está en error o vacía, y
// nunca en una consulta ya confirmada. Una nota con contenido se corrige a
// mano: regenerarla pisaría lo que el médico ya miró.
//
// Uso:
//   node scripts/regenerar_nota.js "Natália"         (busca por paciente y muestra)
//   node scripts/regenerar_nota.js --id <consultaId>  (la regenera, pide SI)
const path = require("path");
const readline = require("readline");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }

const mongoose = require("mongoose");
const modelos = require("../db/models"); // abre la conexión con MONGODB_URI
const { Medico, Paciente, ConsultaMedica, Medicamento, CatalogoTratamiento } = modelos;
const notaClinica = require("../services/notaClinica");

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (a) => { rl.close(); r(a.trim()); }));
}

// El mismo criterio que notaVacia() del servicio (si la versión instalada ya
// lo trae, se usa esa).
function vacia(n) {
  if (typeof notaClinica.notaVacia === "function") return notaClinica.notaVacia(n);
  const lleno = (v) => (Array.isArray(v) ? v.some(x => x && (typeof x !== "string" || x.trim())) : typeof v === "string" && v.trim().length > 0);
  return !["motivoConsulta", "sintomas", "antecedentesRelevantes", "diagnostico", "plan", "medicamentosRecetados", "examenesSolicitados"]
    .some(c => lleno(n?.[c]));
}

const escapar = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "Natalia" tiene que encontrar a "Natália": se busca sin importar tildes.
function patronSinTildes(texto) {
  const grupos = { a: "aáàâãä", e: "eéèêë", i: "iíìîï", o: "oóòôõö", u: "uúùûü", c: "cç", n: "nñ" };
  const base = String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return new RegExp(base.split("").map(ch => (grupos[ch] ? `[${grupos[ch]}]` : escapar(ch))).join(""), "i");
}

async function conectar() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    mongoose.connection.once("open", resolve);
    mongoose.connection.once("error", reject);
    setTimeout(() => reject(new Error("MongoDB no respondió en 30 segundos")), 30000);
  });
}

function linea(c) {
  const estado = c.confirmadaEn ? "CONFIRMADA" : c.notaClinicaEstado === "error" ? "nota en ERROR"
    : c.notaClinicaEstado === "completado" && vacia(c.notaClinica) ? "nota VACÍA" : `nota ${c.notaClinicaEstado || "—"}`;
  const min = c.duracionSegundos ? ` · ${Math.round(c.duracionSegundos / 60)} min` : "";
  return `  ${c._id}  ${new Date(c.createdAt).toLocaleString("es-BO")}${min}  ${c.pacienteNombre}  (+${c.medicoPhone})  → ${estado}`;
}

async function buscar(texto) {
  const consultas = await ConsultaMedica.find({ pacienteNombre: patronSinTildes(texto) })
    .select("pacienteNombre medicoPhone createdAt duracionSegundos notaClinicaEstado notaClinica confirmadaEn estado")
    .sort({ createdAt: -1 }).limit(15).lean();
  if (!consultas.length) { console.log(`\n  No hay consultas de un paciente que se llame como «${texto}».\n`); return; }
  console.log(`\n  Consultas de «${texto}» (de la más nueva a la más vieja):\n`);
  consultas.forEach(c => console.log(linea(c)));
  console.log("\n  Para regenerar una (solo las que dicen VACÍA o ERROR):");
  console.log("    node scripts/regenerar_nota.js --id <el número largo de la izquierda>\n");
}

async function regenerar(id) {
  if (!mongoose.isValidObjectId(id)) throw new Error(`«${id}» no es un id de consulta`);
  const consulta = await ConsultaMedica.findById(id);
  if (!consulta) throw new Error("No existe esa consulta");
  console.log("\n" + linea(consulta.toObject()));
  if (consulta.confirmadaEn) throw new Error("Esta consulta ya fue confirmada: la nota no se toca");
  if (consulta.estado !== "completado" || !String(consulta.transcripcionCompleta || "").trim()) {
    throw new Error("Esta consulta no tiene transcripción");
  }
  if (consulta.notaClinicaEstado === "completado" && !vacia(consulta.notaClinica)) {
    throw new Error("La nota ya tiene contenido: se corrige a mano desde la pantalla");
  }

  const [paciente, medico] = await Promise.all([
    Paciente.findOne({ _id: consulta.pacienteId, medicoPhone: consulta.medicoPhone }).lean(),
    Medico.findOne({ phone: consulta.medicoPhone }).select("idioma tipoEspecialidad").lean(),
  ]);
  if (!paciente) throw new Error("No se encontró el paciente de esa consulta");
  const palabras = String(consulta.transcripcionCompleta).split(/\s+/).filter(Boolean).length;
  console.log(`\n  Transcripción: ${palabras} palabras · idioma de la nota: ${medico?.idioma || "es"}`);
  if (await preguntar("\n  Escribí SI para generar la nota: ") !== "SI") { console.log("  Cancelado. No se tocó nada.\n"); return; }

  const esp = medico?.tipoEspecialidad;
  const medicamentosActivos = await Medicamento.find({ pacienteId: paciente._id, medicoPhone: consulta.medicoPhone, fechaFin: null }).select("nombre").lean();
  const catalogo = ["odontologia", "estetica"].includes(esp) && CatalogoTratamiento
    ? (await CatalogoTratamiento.find({ medicoPhone: consulta.medicoPhone }).select("nombre").lean()).map(c => c.nombre) : [];

  console.log("  Generando… (una consulta larga puede tardar hasta un minuto)");
  const nota = await notaClinica.generarNotaClinica(consulta.transcripcionCompleta, {
    antecedentesPersonales: paciente.antecedentesPersonales || [],
    antecedentesFamiliares: paciente.antecedentesFamiliares || [],
    medicamentosActivos: medicamentosActivos.map(m => m.nombre),
    catalogoTratamientos: catalogo,
    estructurasOculares: esp === "oftalmologia" ? (modelos.ESTRUCTURAS_OCULARES || []) : [],
    estadosPiezaDental: esp === "odontologia" ? (modelos.ESTADOS_PIEZA_DENTAL || []) : [],
    organosGineco: esp === "ginecologia" ? (modelos.ORGANOS_GINECO || []) : [],
    hallazgosGineco: esp === "ginecologia" ? (modelos.HALLAZGOS_GINECO || []) : [],
    veterinaria: esp === "veterinaria",
    especie: esp === "veterinaria" ? paciente.especie : "",
    raza: esp === "veterinaria" ? paciente.raza : "",
  }, medico?.idioma);

  if (vacia(nota)) throw new Error("La IA devolvió la nota vacía otra vez. No se guardó nada; probá de nuevo en un rato.");
  consulta.notaClinica = nota;
  consulta.notaClinicaEstado = "completado";
  consulta.notaClinicaError = undefined;
  await consulta.save();

  console.log("\n  ✅ Nota generada y guardada. El médico la ve al abrir la consulta, para revisarla y confirmarla.");
  console.log(`     Motivo: ${nota.motivoConsulta || "—"}`);
  console.log(`     Diagnóstico: ${nota.diagnostico || "—"}\n`);
}

(async () => {
  await conectar();
  const iId = process.argv.indexOf("--id");
  if (iId !== -1) await regenerar(process.argv[iId + 1]);
  else if (process.argv[2]) await buscar(process.argv.slice(2).join(" "));
  else console.log('\n  Uso: node scripts/regenerar_nota.js "nombre del paciente"   ·   node scripts/regenerar_nota.js --id <consultaId>\n');
})()
  .catch((e) => { console.error(`\n  ❌ ${e.message}\n`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
