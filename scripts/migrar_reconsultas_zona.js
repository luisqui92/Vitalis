#!/usr/bin/env node
// Symphomed — Corregir la hora de las reconsultas pendientes que se guardaron
// antes del arreglo de zona horaria.
//
// Hasta el arreglo, la hora que devuelve la IA ("2026-10-17T10:00", hora del
// consultorio, sin zona) se guardaba como si fuera la del servidor. En un
// servidor en UTC, las 10:00 de La Paz quedaban como las 10:00 UTC, que son
// las 06:00 de La Paz (auditoría del comité de QA, A2). Desde el arreglo se
// guardan bien (services/notaClinica.js, sanearNota), pero las que ya estaban
// esperando confirmación siguen corridas: al confirmarlas, el paciente
// recibiría la hora mal.
//
// ═══ QUÉ SE TOCA Y QUÉ NO ══════════════════════════════════════════════════
//
// Solo las reconsultas pendientes, con fecha, de consultas sin confirmar, y
// que no se modificaron después del despliegue (--hasta): esas las escribió
// el código viejo. Una consulta confirmada no se toca: el WhatsApp ya salió.
//
// La hora que dijo el médico se recupera leyendo lo guardado en la zona en
// que corría el servidor (--zona-servidor), y se vuelve a guardar en la zona
// de la cuenta. Al guardarse cambia updatedAt, así que correrlo dos veces con
// el mismo --hasta no las corre dos veces.
//
// ═══ LOS DOS DATOS QUE HAY QUE SACAR DEL SERVIDOR ═════════════════════════
//
//   --hasta          cuándo se desplegó el arreglo (el reinicio de pm2:
//                    `pm2 describe symphomed`, «created at»).
//   --zona-servidor  la zona con que corría el proceso viejo: `pm2 env <id>`
//                    (la variable TZ) o, si no tiene, la del sistema
//                    (`timedatectl`). Si era America/La_Paz, las cuentas de
//                    Bolivia ya estaban bien y solo cambian las de otras zonas.
//
// No se adivina ninguno de los dos: equivocarse corre las horas que hoy están
// bien.
//
// Uso:
//   node scripts/migrar_reconsultas_zona.js --hasta=2026-10-20T03:00:00Z --zona-servidor=UTC            ← muestra el plan
//   node scripts/migrar_reconsultas_zona.js --hasta=2026-10-20T03:00:00Z --zona-servidor=UTC --hacelo   ← lo hace
const path = require("path");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* opcional */ }
const mongoose = require("mongoose");
const { ConsultaMedica, Medico } = require("../db/models");
const { localAInstante, desfaseMs, horaEnZona, fechaStrEnZona, zonaValida, ZONA_POR_DEFECTO } = require("../services/zonaHoraria");

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

function argumento(nombre) {
  const a = process.argv.find(x => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : "";
}

// "YYYY-MM-DDTHH:mm" de un instante, en una zona: lo que el código viejo
// había leído del texto de la IA.
function horaDePared(instante, zona) {
  return new Date(instante.getTime() + desfaseMs(zona, instante)).toISOString().slice(0, 16);
}

async function main() {
  const hacelo = process.argv.includes("--hacelo");
  const hasta = new Date(argumento("hasta"));
  const zonaServidor = argumento("zona-servidor");
  if (isNaN(hasta.getTime())) throw new Error("Falta --hasta=<cuándo se desplegó el arreglo>, por ejemplo --hasta=2026-10-20T03:00:00Z");
  if (hasta.getTime() > Date.now()) throw new Error("--hasta está en el futuro: tiene que ser el momento del despliegue, que ya pasó");
  if (!zonaServidor || zonaValida(zonaServidor) !== zonaServidor) {
    throw new Error("Falta --zona-servidor=<zona del proceso viejo>, por ejemplo --zona-servidor=UTC (ver el comentario de arriba)");
  }
  await conectar();

  // Sin «estado» guardado también es pendiente: es el valor por omisión, y
  // la nota que escribe la IA no lo trae.
  const filtro = {
    confirmadaEn: null,
    "notaClinica.reconsultaSugerida.estado": { $in: ["pendiente", null] },
    "notaClinica.reconsultaSugerida.fechaHora": { $ne: null },
    updatedAt: { $lt: hasta },
  };
  const consultas = await ConsultaMedica.find(filtro).select("medicoPhone notaClinica.reconsultaSugerida.fechaHora").lean();
  const zonas = new Map();
  const cambios = [];
  for (const c of consultas) {
    if (!zonas.has(c.medicoPhone)) {
      const m = await Medico.findOne({ phone: c.medicoPhone }).select("zonaHoraria").lean();
      zonas.set(c.medicoPhone, m?.zonaHoraria || ZONA_POR_DEFECTO);
    }
    const zona = zonas.get(c.medicoPhone);
    const antes = new Date(c.notaClinica.reconsultaSugerida.fechaHora);
    const despues = localAInstante(zona, horaDePared(antes, zonaServidor));
    if (isNaN(despues.getTime()) || despues.getTime() === antes.getTime()) continue;
    cambios.push({ c, zona, antes, despues });
  }

  if (!cambios.length) {
    console.log(`\n  ✅ Ninguna reconsulta pendiente para corregir (${consultas.length} revisada(s)).\n`);
    return;
  }
  console.log(`\n  Reconsultas pendientes con la hora corrida: ${cambios.length}\n`);
  for (const { c, zona, antes, despues } of cambios) {
    console.log(`  ${String(c.medicoPhone).padEnd(16)} ${c._id}  ${fechaStrEnZona(zona, antes)} ${horaEnZona(zona, antes)} → ${fechaStrEnZona(zona, despues)} ${horaEnZona(zona, despues)} (${zona})`);
  }
  if (!hacelo) {
    console.log("\n  No se tocó nada. Para corregirlas, lo mismo con --hacelo al final.\n");
    return;
  }
  let corregidas = 0;
  for (const { c, antes, despues } of cambios) {
    // Solo si sigue igual: si el médico la confirmó mientras tanto, no se toca.
    const r = await ConsultaMedica.updateOne(
      { _id: c._id, confirmadaEn: null, "notaClinica.reconsultaSugerida.fechaHora": antes },
      { $set: { "notaClinica.reconsultaSugerida.fechaHora": despues } });
    corregidas += r.modifiedCount || 0;
  }
  console.log(`\n  ✅ Listo: ${corregidas} reconsulta(s) corregida(s).\n`);
}

main()
  .catch((e) => { console.error(`\n  ❌ ${e.message}\n`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
