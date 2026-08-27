// Vitalis — Mudar una cuenta de médico a otro número de teléfono.
//
// ═══ POR QUÉ ESTO NO ES CAMBIAR UN CAMPO ═══════════════════════════════════
//
// El teléfono no es un dato de contacto del médico: es su IDENTIDAD en toda
// la base. Cada paciente, cada consulta, cada receta, cada estudio, cada
// recordatorio y cada línea de auditoría cuelga de `medicoPhone`. Son ~30
// colecciones.
//
// Editar Medico.phone a mano y nada más deja al médico entrando a una cuenta
// vacía, con doce pacientes y cuarenta y siete consultas huérfanas que
// siguen ahí pero que ya no son de nadie. No se pierde el dato: se pierde el
// dueño, que en una historia clínica es casi lo mismo.
//
// Por eso este script mueve TODO junto, y por eso el listado de colecciones
// no está escrito a mano: se recorre `mongoose.models` y se actualiza
// cualquier modelo que tenga `medicoPhone`. Una colección nueva que alguien
// agregue el año que viene queda cubierta sola. Un listado a mano se
// desactualiza en silencio, y el síntoma aparece meses después.
//
// ═══ LOS CAMPOS DE "QUIÉN HIZO ESTO" TAMBIÉN SE MUEVEN ═════════════════════
//
// acreditadoPor, revisadaPor, actualizadoPor, alergiasActualizadasPor: esos
// no dicen de quién ES el registro sino QUIÉN LO TOCÓ. Se mueven igual, y no
// por prolijidad.
//
// Si no se movieran, quedarían apuntando a un número que a partir de mañana
// es de OTRA PERSONA. La auditoría diría que quien hoy tiene ese teléfono
// aprobó pagos que nunca aprobó y tocó alergias que nunca tocó. Un registro
// de auditoría que atribuye mal es peor que no tenerlo: se le cree.
//
// ═══ SE PUEDE VOLVER A CORRER ══════════════════════════════════════════════
//
// Sin transacciones (Mongo las pide con replica set), una corrida que se
// corta a la mitad deja el trabajo incompleto. La red de seguridad es que
// cada update es "los que digan VIEJO, pasan a NUEVO": correrlo de nuevo
// termina lo que faltó y no hace nada sobre lo ya movido. Si se corta,
// se vuelve a correr. En Atlas sí hay transacción y va todo o nada.
//
// Uso:
//   node scripts/cambiar_telefono.js <viejo> <nuevo>            ← muestra el plan
//   node scripts/cambiar_telefono.js <viejo> <nuevo> --hacelo   ← lo hace
//
// Sin --hacelo NO toca nada. Contá los registros del plan antes de insistir.
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
require("../db/models");

// Los campos que dicen QUIÉN hizo algo, en vez de de quién es el registro.
const CAMPOS_DE_ACTOR = [
  "acreditadoPor", "revisadaPor", "actualizadoPor", "alergiasActualizadasPor",
];

// Qué hay que tocar, preguntándoselo a los modelos y no a la memoria de nadie.
function planDeMudanza() {
  const tareas = [];
  for (const [nombre, Modelo] of Object.entries(mongoose.models)) {
    if (nombre === "Medico") continue; // ese va aparte, con su propio campo
    const rutas = Modelo.schema.paths;
    if (rutas.medicoPhone) tareas.push({ modelo: nombre, Modelo, campo: "medicoPhone" });
    for (const campo of CAMPOS_DE_ACTOR) {
      if (rutas[campo]) tareas.push({ modelo: nombre, Modelo, campo });
    }
  }
  return tareas.sort((a, b) => a.modelo.localeCompare(b.modelo) || a.campo.localeCompare(b.campo));
}

// Mongo solo hace transacciones sobre un replica set o un mongos. Atlas es
// replica set, así que en producción van; un mongod suelto (una prueba, un
// desarrollo local) no, y ahí se mueve colección por colección.
async function soportaTransacciones() {
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    return false;
  }
}

async function main() {
  const viejo = String(process.argv[2] || "").trim();
  const nuevo = String(process.argv[3] || "").trim();
  const hacelo = process.argv.includes("--hacelo");

  if (!viejo || !nuevo) {
    console.error("Uso: node scripts/cambiar_telefono.js <viejo> <nuevo> [--hacelo]");
    process.exit(1);
  }
  if (viejo === nuevo) {
    console.error("❌ Son el mismo número.");
    process.exit(1);
  }
  if (!/^[0-9]{6,15}$/.test(nuevo)) {
    console.error(`❌ "${nuevo}" no parece un teléfono (solo dígitos, 6 a 15).`);
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  const { Medico, AuditLog } = mongoose.models;

  const cuenta = await Medico.findOne({ phone: viejo }).lean();
  if (!cuenta) {
    console.error(`❌ No hay ninguna cuenta con +${viejo}.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  // Si el destino ya existe, mudarse encima fusionaría dos cuentas: los
  // pacientes de una aparecerían en la ficha de la otra. Eso no se arregla
  // con un "deshacer".
  const ocupado = await Medico.findOne({ phone: nuevo }).select("nombre").lean();
  if (ocupado) {
    console.error(`❌ +${nuevo} ya está tomado por "${ocupado.nombre}".`);
    console.error("   Mudarse encima mezclaría los pacientes de las dos cuentas. Elegí otro número.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n📋 Mudar "${cuenta.nombre}" (rol ${cuenta.rol || "medico"})`);
  console.log(`   +${viejo}  →  +${nuevo}\n`);

  const tareas = planDeMudanza();
  let total = 0;
  const conDatos = [];
  for (const tarea of tareas) {
    const n = await tarea.Modelo.countDocuments({ [tarea.campo]: viejo });
    total += n;
    if (n) conDatos.push({ ...tarea, n });
  }

  if (!conDatos.length) {
    console.log("   (sin registros colgando de ese número — solo se cambia la cuenta)");
  } else {
    for (const t of conDatos) {
      console.log(`   ${String(t.n).padStart(6)}  ${t.modelo}.${t.campo}`);
    }
  }
  console.log(`   ${String(total).padStart(6)}  registros en total\n`);

  if (!hacelo) {
    console.log("Esto fue solo el plan. NO se tocó nada.");
    console.log("Para hacerlo de verdad:");
    console.log(`  node scripts/cambiar_telefono.js ${viejo} ${nuevo} --hacelo`);
    console.log("\nHacelo cuando nadie esté usando el sistema.");
    await mongoose.disconnect();
    return;
  }

  // ─── LA MUDANZA ─────────────────────────────────────────────────────────
  // Con transacción si la base la soporta (Atlas sí, un mongod suelto no).
  // Si no hay, se hace igual y la red de seguridad es poder volver a correrlo.
  //
  // Se le PREGUNTA a la base si puede, en vez de intentar y ver qué pasa:
  // startSession() y startTransaction() no fallan contra un mongod suelto
  // —devuelven una sesión de lo más convincente— y el error recién aparece
  // en la primera escritura, con la mudanza ya empezada. Un try/catch
  // alrededor de startTransaction parece la red de seguridad y no atrapa
  // nada. Lo encontró la prueba.
  let sesion = null;
  if (await soportaTransacciones()) {
    sesion = await mongoose.startSession();
    sesion.startTransaction();
  }
  if (!sesion) {
    console.log("⚠️  Esta base no soporta transacciones: va colección por colección.");
    console.log("   Si se corta a la mitad, volvé a correr el mismo comando y termina.\n");
  }
  const opciones = sesion ? { session: sesion } : {};

  try {
    let movidos = 0;
    for (const t of conDatos) {
      const r = await t.Modelo.updateMany({ [t.campo]: viejo }, { $set: { [t.campo]: nuevo } }, opciones);
      movidos += r.modifiedCount || 0;
      console.log(`   ✅ ${String(r.modifiedCount || 0).padStart(6)}  ${t.modelo}.${t.campo}`);
    }
    // La cuenta, al final: hasta acá el médico todavía entra con el número
    // viejo. Es el último paso porque es el que cambia con qué se ingresa.
    await Medico.updateOne({ phone: viejo }, { $set: { phone: nuevo } }, opciones);
    console.log(`   ✅       1  Medico.phone`);

    // La mudanza misma queda anotada, en el número NUEVO —que es donde vive
    // ahora esta cuenta— diciendo de dónde vino. Sin esto, el historial
    // arrancaría de la nada y parecería que la cuenta apareció sola.
    await AuditLog.create([{
      medicoPhone: nuevo, accion: "cambio_de_telefono",
      recurso: `+${viejo} → +${nuevo}`,
      detalle: `${movidos} registros mudados`,
    }], opciones);

    if (sesion) { await sesion.commitTransaction(); console.log("\n   (en una sola transacción)"); }
    console.log(`\n✅ Listo. "${cuenta.nombre}" ahora entra con +${nuevo}, con la misma contraseña.`);
  } catch (e) {
    if (sesion) { await sesion.abortTransaction(); console.error("\n↩️  Se deshizo todo: la transacción no se confirmó."); }
    else { console.error("\n⚠️  Se cortó a la mitad. Volvé a correr el MISMO comando para terminar."); }
    throw e;
  } finally {
    if (sesion) await sesion.endSession();
  }

  // ─── LO QUE ESTE SCRIPT NO TOCA ─────────────────────────────────────────
  const { esOperador } = require("../services/operadores");
  if (esOperador(viejo)) {
    console.log(`\n⚠️  OJO: +${viejo} está en OPERADORES_SALDO del .env, y eso NO se movió solo.`);
    console.log("   Ese permiso vive en el entorno a propósito (ver routes/operadorSaldo.js).");
    console.log(`   Si el permiso de aprobar pagos tiene que seguir a esta cuenta, cambiá el .env a +${nuevo}.`);
    console.log(`   Si se queda con quien reciba +${viejo}, dejalo como está.`);
  }
  console.log(`\nTampoco se toca el WhatsApp: los pacientes que le escriban al viejo número`);
  console.log(`no van a llegar a esta cuenta. Eso se cambia en la configuración de WhatsApp.`);

  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
