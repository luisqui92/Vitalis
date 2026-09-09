// Symphomed — Revisa las correcciones que los médicos le hicieron a las
// sugerencias de la IA (reconsulta, tratamientos por voz, mapa ocular),
// agrupadas por tipo y campo, para ver en qué se equivoca más y afinar
// los prompts. Es de solo lectura, no cambia nada.
//
// Uso: node scripts/ver_correcciones_ia.js [telefono] [dias]
// Ej:  node scripts/ver_correcciones_ia.js              (todas, últimos 30 días)
//      node scripts/ver_correcciones_ia.js 78804988     (solo ese médico)
//      node scripts/ver_correcciones_ia.js 78804988 90  (últimos 90 días)
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { CorreccionIA } = require("../db/models");

async function main() {
  const telefono = String(process.argv[2] || "").trim();
  const dias = Number(process.argv[3]) || 30;
  const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log(`✅ Conectado a MongoDB — correcciones desde ${desde.toLocaleDateString("es-BO")}${telefono ? ` (médico ${telefono})` : " (todos los médicos)"}\n`);

  const filtro = { createdAt: { $gte: desde } };
  if (telefono) filtro.medicoPhone = telefono;
  const correcciones = await CorreccionIA.find(filtro).sort({ createdAt: -1 }).lean();

  if (correcciones.length === 0) {
    console.log("No hay correcciones registradas en ese rango.");
    await mongoose.disconnect();
    return;
  }

  const grupos = {};
  for (const c of correcciones) {
    const clave = `${c.tipo} — ${c.campo}`;
    (grupos[clave] = grupos[clave] || []).push(c);
  }

  const ordenados = Object.entries(grupos).sort((a, b) => b[1].length - a[1].length);
  for (const [clave, lista] of ordenados) {
    console.log(`━━━ ${clave} — ${lista.length} corrección(es) ━━━`);
    for (const c of lista.slice(0, 5)) {
      console.log(`  ${new Date(c.createdAt).toLocaleDateString("es-BO")} | IA dijo: "${c.valorSugerido || "(nada)"}" → médico dejó: "${c.valorFinal}"`);
    }
    if (lista.length > 5) console.log(`  ... y ${lista.length - 5} más`);
    console.log("");
  }

  console.log(`🏁 Total: ${correcciones.length} correcciones en ${Object.keys(grupos).length} categoría(s).`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
