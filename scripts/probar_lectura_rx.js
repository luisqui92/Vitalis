// Symphomed — Fase 0 de la segunda lectura de radiografías.
//
// Antes de que esto le aparezca a un odontólogo en una ficha, hay que saber
// si sirve. Este script es para averiguarlo, y para nada más.
//
// ═══ QUÉ HACE Y QUÉ NO ═════════════════════════════════════════════════════
//
// Lee las radiografías que YA están en Symphomed (las que subió el agente), le
// pide al modelo su descripción, y la imprime. NO escribe una sola línea en
// la base: ninguna ficha se toca, ningún paciente ve nada, nada queda en una
// historia clínica.
//
// ═══ CÓMO SE EVALÚA ESTO DE VERDAD ═════════════════════════════════════════
//
// La tentación es leer las salidas y decir "está bastante bien". Eso no mide
// nada: un texto que suena a odontólogo suena bien aunque esté equivocado.
//
// La única evaluación que sirve es contra la lectura del odontólogo, hecha
// ANTES de ver esto, y mirando dos cosas en este orden:
//
//   1. QUÉ SE LE PASÓ. Lesiones que el odontólogo vio y el modelo no. Es lo
//      único que puede hacer daño de verdad, porque un falso negativo leído
//      antes de mirar la placa hace que se mire peor.
//   2. QUÉ INVENTÓ. Cosas que describió y no están. Molesta y hace perder
//      tiempo, pero se descarta mirando.
//
// Si en 20 placas se le pasa aunque sea una lesión evidente, esto no sale de
// tu máquina. "Casi siempre acierta" no es un criterio para algo que se lee
// antes de mirar una radiografía.
//
// Uso:
//   node scripts/probar_lectura_rx.js <telefonoMedico>       ← sus últimas placas
//   node scripts/probar_lectura_rx.js <telefonoMedico> 5     ← las últimas 5
//   node scripts/probar_lectura_rx.js --archivo /ruta/a.jpg  ← una imagen suelta
//
// Guarda todo en lecturas-rx-<fecha>.json para poder comparar entre modelos
// y entre corridas, que a ojo no se puede.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Estudio, Paciente } = require("../db/models");
const { DIR_ESTUDIOS } = require("../services/archivosEstudio");
const { leerRadiografia, MODELO } = require("../services/lecturaRx");

function imprimir(lectura) {
  if (lectura.calidadImagen) console.log(`   📷 Calidad: ${lectura.calidadImagen}`);
  if (!lectura.observaciones.length) {
    console.log("   (sin observaciones — ojo: eso NO significa que la placa esté sana)");
  }
  for (const o of lectura.observaciones) {
    console.log(`   • [${o.ubicacion || "sin ubicar"}] ${o.seObserva}  (${o.claridad})`);
  }
  for (const z of lectura.zonasARevisar) console.log(`   👁  Mirar: ${z}`);
  for (const n of lectura.noPuedoEvaluar) console.log(`   ⛔ No evaluable: ${n}`);
  if (lectura.descartadasPorAfirmarAusencia) {
    // Si esto aparece seguido, el prompt no está alcanzando y hay que
    // apretarlo antes de mostrarle esto a nadie.
    console.log(`   ⚠️  ${lectura.descartadasPorAfirmarAusencia} observación(es) descartada(s) por afirmar una ausencia`);
  }
}

async function main() {
  const esArchivo = process.argv[2] === "--archivo";
  const resultados = [];

  console.log(`\nModelo: ${MODELO}`);
  console.log("Esto NO escribe nada en la base. Ninguna ficha se toca.\n");

  if (esArchivo) {
    const ruta = String(process.argv[3] || "").trim();
    if (!ruta || !fs.existsSync(ruta)) {
      console.error("Uso: node scripts/probar_lectura_rx.js --archivo /ruta/a/la/placa.jpg");
      process.exit(1);
    }
    console.log(`── ${path.basename(ruta)} ──`);
    const lectura = await leerRadiografia(ruta);
    imprimir(lectura);
    resultados.push({ archivo: ruta, lectura });
  } else {
    const phone = String(process.argv[2] || "").trim();
    const cuantas = Number(process.argv[3] || 10);
    if (!phone) {
      console.error("Uso: node scripts/probar_lectura_rx.js <telefonoMedico> [cuántas]");
      console.error("     node scripts/probar_lectura_rx.js --archivo /ruta/a.jpg");
      process.exit(1);
    }

    await mongoose.connect(CONFIG.MONGODB_URI);
    const estudios = await Estudio.find({
      medicoPhone: phone, tipo: "radiografia",
      archivoMime: { $in: ["image/jpeg", "image/png", "image/webp"] },
    }).sort({ fecha: -1 }).limit(cuantas).lean();

    if (!estudios.length) {
      console.log(`No hay radiografías de +${phone} todavía.`);
      console.log("Tomá una con el equipo y fijate que el agente esté corriendo.");
      await mongoose.disconnect();
      return;
    }

    for (const e of estudios) {
      const ruta = path.join(DIR_ESTUDIOS, e.archivoNombre);
      if (!fs.existsSync(ruta)) {
        console.log(`⚠️  Falta el archivo en disco: ${e.archivoNombre}`);
        continue;
      }
      const paciente = await Paciente.findById(e.pacienteId).select("nombre").lean();
      console.log(`── ${e.nombre} · ${paciente?.nombre || "?"} · ${new Date(e.fecha).toLocaleDateString()} ──`);
      try {
        const lectura = await leerRadiografia(ruta);
        imprimir(lectura);
        resultados.push({ estudioId: String(e._id), nombre: e.nombre, lectura });
      } catch (err) {
        console.log(`   ❌ ${err.response?.data?.error?.message || err.message}`);
      }
      console.log("");
    }
    await mongoose.disconnect();
  }

  const salida = `lecturas-rx-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  fs.writeFileSync(salida, JSON.stringify({ modelo: MODELO, resultados }, null, 2));

  console.log(`\n📄 Guardado en ${salida}`);
  console.log("\nAhora la parte que importa, y que ningún script puede hacer por vos:");
  console.log("  1. Que el odontólogo lea cada placa SIN ver esto.");
  console.log("  2. Recién después, comparar.");
  console.log("  3. Contar QUÉ SE LE PASÓ AL MODELO. Ese número decide todo.");
  console.log("\nSi se le pasó una lesión evidente aunque sea una vez, esto no sale de acá.");
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
