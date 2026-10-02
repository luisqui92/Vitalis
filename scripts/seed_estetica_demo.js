// Symphomed Face — Crea (o actualiza) una cuenta de estética/dermatología/
// plástica de demo con catálogo de procedimientos, pacientes con plan de
// tratamiento (con pagos parciales, para mostrar el saldo), fotos clínicas
// guiadas por ángulo (con archivo real, se pueden abrir y comparar antes/
// después) y un Brief Clínico ya armado.
//
// Uso: node scripts/seed_estetica_demo.js <telefono> ["Nombre completo"] [password]
// Ej:  node scripts/seed_estetica_demo.js 78822001
//
// Es idempotente: si el médico ya existe no le toca la contraseña; si un
// paciente ya tiene tratamientos cargados, lo saltea.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, CatalogoTratamiento, TratamientoPlan, Estudio } = require("../db/models");
const { hashPassword } = require("../services/auth");

const { CLAVE_DEMO } = require("./lib/claveDemo");
function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

// ─── PNG mínimo (foto clínica placeholder, color sólido) ──────────────────
// No hay ninguna librería de imágenes entre las dependencias (a propósito,
// el proyecto no usa build step) — se arma el PNG a mano con zlib (nativo
// de Node) para el IDAT y un CRC32 propio, nada de librerías nuevas.
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunkPng(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function pngSolido(w, h, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < w; x++) {
      // Un degradé chico para que no se vea un cuadrado 100% plano.
      const t = x / w;
      raw[rowStart + 1 + x * 3] = Math.round(r * (0.85 + 0.15 * t));
      raw[rowStart + 1 + x * 3 + 1] = Math.round(g * (0.85 + 0.15 * t));
      raw[rowStart + 1 + x * 3 + 2] = Math.round(b * (0.85 + 0.15 * t));
    }
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunkPng("IHDR", ihdr), chunkPng("IDAT", idatData), chunkPng("IEND", Buffer.alloc(0))]);
}

function crearPdfSimple(lineas) {
  const contenido = lineas.map((l, i) => `BT /F1 12 Tf 50 ${740 - i * 20} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length ${contenido.length}>>
stream
${contenido}
endstream
endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
  return Buffer.from(pdf, "utf-8");
}

const DIR_ESTUDIOS = path.join(__dirname, "..", "uploads", "estudios");

const CATALOGO = [
  { nombre: "Toxina botulínica — tercio superior", precio: 850 },
  { nombre: "Ácido hialurónico — labios", precio: 1100 },
  { nombre: "Ácido hialurónico — pómulos", precio: 1400 },
  { nombre: "Rinomodelación no quirúrgica", precio: 1600 },
  { nombre: "Peeling químico facial", precio: 450 },
  { nombre: "Limpieza facial profunda", precio: 280 },
  { nombre: "Hilos tensores — mentón/mandíbula", precio: 2200 },
  { nombre: "Mesoterapia facial", precio: 500 },
  { nombre: "Bioestimulador de colágeno", precio: 1800 },
  { nombre: "Depilación láser — sesión", precio: 350 },
];

const PACIENTES = [
  {
    nombre: "Camila Rosales Durán", fechaNacimiento: "1994-05-14", sexo: "Femenino", telefono: "70133401",
    antecedentesPersonales: ["Sin alergias conocidas"],
    consulta: {
      motivoConsulta: "Consulta por líneas de expresión en frente y arrugas periorbitarias",
      sintomas: [], antecedentesRelevantes: "Primera vez en tratamiento estético",
      diagnostico: "Líneas dinámicas leves-moderadas en tercio superior",
      plan: "Toxina botulínica en frente y patas de gallo, control en 15 días",
      medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 15 días",
      transcripcionCompleta: "Doctora, quiero tratarme estas líneas de la frente que se me marcan mucho cuando gesticulo. Vamos a aplicar toxina botulínica en frente y en las patas de gallo, vas a ver el efecto completo en unos 10 a 15 días.",
      duracionSegundos: 260,
    },
    tratamientos: [
      { nombre: "Toxina botulínica — tercio superior", regionFacial: "Frente", precio: 850, diasAtras: 10, pagos: [850] },
      { nombre: "Ácido hialurónico — labios", regionFacial: "Labio superior", precio: 1100, diasAtras: 3, pagos: [500] },
    ],
    fotos: [
      { angulo: "frontal", diasAtras: 10, color: [214, 178, 148], nombre: "Antes — control inicial" },
      { angulo: "frontal", diasAtras: 1, color: [222, 190, 162], nombre: "Después — 10 días" },
      { angulo: "perfil_derecho", diasAtras: 10, color: [210, 172, 142] },
    ],
  },
  {
    nombre: "Andrea Ibáñez Soliz", fechaNacimiento: "1988-11-02", sexo: "Femenino", telefono: "70133402",
    antecedentesPersonales: [],
    consulta: {
      motivoConsulta: "Control post rinomodelación",
      sintomas: ["leve sensibilidad en dorso nasal"],
      antecedentesRelevantes: "Rinomodelación realizada hace 2 semanas",
      diagnostico: "Evolución favorable, edema residual mínimo",
      plan: "Continuar cuidados, control en 1 mes",
      medicamentosRecetados: [{ nombre: "Ibuprofeno", dosis: "400mg", frecuencia: "si hay molestia" }],
      examenesSolicitados: [], proximoControl: "En 1 mes",
      transcripcionCompleta: "Doctora, ya casi no siento nada, solo un poco sensible al tacto todavía. Se ve muy natural el resultado. Vamos a controlar de nuevo en un mes para ver cómo asienta del todo.",
      duracionSegundos: 220,
    },
    tratamientos: [
      { nombre: "Rinomodelación no quirúrgica", regionFacial: "Nariz", precio: 1600, diasAtras: 14, pagos: [1600] },
    ],
    fotos: [
      { angulo: "perfil_derecho", diasAtras: 14, color: [218, 182, 152] },
      { angulo: "angulo45_derecha", diasAtras: 14, color: [216, 180, 150] },
    ],
  },
  {
    nombre: "Gabriela Núñez Rojas", fechaNacimiento: "1979-02-27", sexo: "Femenino", telefono: "70133403",
    antecedentesPersonales: ["Piel sensible, reacción previa a un peeling agresivo hace años"],
    consulta: {
      motivoConsulta: "Consulta por flacidez en tercio inferior y mentón",
      sintomas: [], antecedentesRelevantes: "Piel sensible, reacción previa a un peeling agresivo",
      diagnostico: "Flacidez leve-moderada tercio inferior, candidata a hilos tensores",
      plan: "Hilos tensores en mentón/mandíbula, evitar peelings agresivos por antecedente",
      medicamentosRecetados: [], examenesSolicitados: [], proximoControl: "En 3 semanas",
      transcripcionCompleta: "Doctora, siento que se me ha ido cayendo un poco la piel acá en la mandíbula. Como tuvo una reacción con un peeling antes, mejor vamos por hilos tensores en el mentón y la mandíbula, es menos agresivo para su piel.",
      duracionSegundos: 300,
    },
    tratamientos: [
      { nombre: "Hilos tensores — mentón/mandíbula", regionFacial: "Mandíbula", precio: 2200, diasAtras: 5, pagos: [1000] },
      { nombre: "Bioestimulador de colágeno", regionFacial: "Mejilla derecha", precio: 1800, diasAtras: 0, pagos: [] },
    ],
    fotos: [
      { angulo: "frontal", diasAtras: 5, color: [206, 168, 138] },
    ],
  },
  {
    nombre: "Valentina Herrera Castro", fechaNacimiento: "1997-08-19", sexo: "Femenino", telefono: "70133404",
    antecedentesPersonales: [],
    consulta: {
      motivoConsulta: "Control de acné y solicitud de limpieza facial",
      sintomas: ["comedones", "brotes ocasionales en zona T"],
      antecedentesRelevantes: "Acné leve-moderado de larga data",
      diagnostico: "Acné leve-moderado, piel mixta",
      plan: "Limpieza facial profunda + peeling químico suave, esquema de 3 sesiones mensuales",
      medicamentosRecetados: [{ nombre: "Adapaleno", dosis: "gel 0.1%", frecuencia: "por la noche" }],
      examenesSolicitados: [], proximoControl: "En 4 semanas",
      transcripcionCompleta: "Doctora, sigo con esos granitos en la frente y la nariz. Vamos a empezar con una limpieza profunda más un peeling suave, y un gel para usar de noche. Con 3 sesiones deberíamos ver bastante cambio.",
      duracionSegundos: 240,
    },
    tratamientos: [
      { nombre: "Limpieza facial profunda", regionFacial: "Otra", precio: 280, diasAtras: 20, pagos: [280] },
      { nombre: "Peeling químico facial", regionFacial: "Otra", precio: 450, diasAtras: 20, pagos: [450] },
    ],
    fotos: [
      { angulo: "frontal", diasAtras: 20, color: [224, 192, 164] },
    ],
  },
];

async function main() {
  const phone = String(process.argv[2] || "").trim();
  const nombre = String(process.argv[3] || "Dra. Camila Suárez").trim();
  const passwordGenerada = !process.argv[4];
  const password = String(process.argv[4] || CLAVE_DEMO).trim();
  if (!phone) {
    console.error('Uso: node scripts/seed_estetica_demo.js <telefono> ["Nombre"] [password]');
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");
  fs.mkdirSync(DIR_ESTUDIOS, { recursive: true });

  let medico = await Medico.findOne({ phone });
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, especialidad: "Estética / Dermatología", tipoEspecialidad: "estetica",
      passwordHash: await hashPassword(password), activo: true,
    });
    console.log(`✅ Cuenta creada: ${nombre} (+${phone}) — contraseña${passwordGenerada ? " de prueba" : ""}: ${password}`);
  } else {
    console.log(`ℹ️  La cuenta +${phone} ya existía (${medico.nombre}). Contraseña sin cambios.`);
  }

  let catalogoCreados = 0;
  for (const item of CATALOGO) {
    const existe = await CatalogoTratamiento.findOne({ medicoPhone: phone, nombre: item.nombre });
    if (!existe) { await CatalogoTratamiento.create({ medicoPhone: phone, ...item }); catalogoCreados++; }
  }
  console.log(`✅ Catálogo: ${catalogoCreados} ítems nuevos (${CATALOGO.length - catalogoCreados} ya existían)`);

  let creados = 0, saltados = 0;
  for (const p of PACIENTES) {
    let paciente = await Paciente.findOne({ medicoPhone: phone, nombre: p.nombre });
    if (!paciente) {
      paciente = await Paciente.create({
        medicoPhone: phone, nombre: p.nombre, fechaNacimiento: new Date(p.fechaNacimiento),
        sexo: p.sexo, telefono: p.telefono, antecedentesPersonales: p.antecedentesPersonales,
      });
    }

    const yaTiene = await TratamientoPlan.countDocuments({ pacienteId: paciente._id });
    if (yaTiene > 0) {
      console.log(`⏭️  Ya tiene tratamientos: ${p.nombre} — salteado`);
      saltados++;
      continue;
    }

    const c = p.consulta;
    const consultaDiasAtras = p.tratamientos[0]?.diasAtras ?? 7;
    const consulta = await ConsultaMedica.create({
      medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
      estado: "completado", duracionSegundos: c.duracionSegundos, transcripcionCompleta: c.transcripcionCompleta,
      segmentos: [{ hablante: "A", texto: c.transcripcionCompleta, inicioSeg: 0, finSeg: c.duracionSegundos }],
      notaClinicaEstado: "completado",
      notaClinica: {
        motivoConsulta: c.motivoConsulta, sintomas: c.sintomas, antecedentesRelevantes: c.antecedentesRelevantes,
        diagnostico: c.diagnostico, plan: c.plan, medicamentosRecetados: c.medicamentosRecetados,
        examenesSolicitados: c.examenesSolicitados, proximoControl: c.proximoControl,
      },
    });
    // Mongoose pisa createdAt/updatedAt en CADA .save() — un update directo
    // a la colección (sin pasar por los hooks) es la única forma confiable
    // de dejar la fecha vieja de verdad (ver misma nota en los otros seeds).
    await ConsultaMedica.collection.updateOne({ _id: consulta._id }, { $set: { createdAt: hace(consultaDiasAtras), updatedAt: hace(consultaDiasAtras) } });

    for (const m of c.medicamentosRecetados) {
      await Medicamento.create({ pacienteId: paciente._id, medicoPhone: phone, nombre: m.nombre, dosis: m.dosis, frecuencia: m.frecuencia, fechaInicio: hace(5) });
    }

    for (const t of p.tratamientos) {
      const totalPagado = t.pagos.reduce((s, m) => s + m, 0);
      await TratamientoPlan.create({
        pacienteId: paciente._id, medicoPhone: phone, nombre: t.nombre, regionFacial: t.regionFacial, precio: t.precio,
        estado: totalPagado >= t.precio ? "realizado" : totalPagado > 0 ? "en_proceso" : "pendiente",
        pagos: t.pagos.map((monto, i) => ({ monto, fecha: hace(t.diasAtras - i) })),
      });
    }

    for (const f of p.fotos) {
      const archivoNombre = crypto.randomUUID() + ".png";
      const buf = pngSolido(480, 640, f.color);
      fs.writeFileSync(path.join(DIR_ESTUDIOS, archivoNombre), buf);
      await Estudio.create({
        pacienteId: paciente._id, medicoPhone: phone, tipo: "foto",
        nombre: f.nombre || "Foto clínica",
        archivoNombre, archivoMime: "image/png", archivoTamano: buf.length,
        fecha: hace(f.diasAtras), anguloFoto: f.angulo,
      });
    }

    paciente.briefClinicoEstado = "completado";
    paciente.briefClinicoActualizadoEn = new Date();
    paciente.briefClinico = {
      estadoActual: c.diagnostico || null,
      cambiosDesdeUltimaConsulta: null,
      medicamentosActivos: c.medicamentosRecetados.map(m => `${m.nombre} ${m.dosis}`.trim()),
      examenesPendientes: [],
      alertas: [],
      factoresRiesgo: p.antecedentesPersonales,
      preguntasSugeridas: [],
      diagnosticosDiferenciales: [],
    };
    await paciente.save();

    console.log(`✅ Paciente listo: ${p.nombre} (${p.tratamientos.length} tratamientos, ${p.fotos.length} fotos)`);
    creados++;
  }

  console.log(`\nListo. ${creados} pacientes cargados, ${saltados} ya tenían tratamientos y se saltearon.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
