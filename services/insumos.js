// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Insumos: el stock es la suma de los movimientos
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══ POR QUÉ ESTE ARCHIVO EXISTE ═══════════════════════════════════════════
//
// Para que haya UN solo lugar donde se toca el stock. Si cada ruta sumara y
// restara por su cuenta, tarde o temprano una se olvida de escribir el
// movimiento y el número queda sin respaldo — y un inventario cuyo número no
// se puede explicar no es un inventario, es una estimación.
//
// La regla: nadie escribe Insumo.stock directamente. Se registra un
// movimiento y el stock sale de ahí.
const { Insumo, MovimientoInsumo } = require("../db/models");
const { ErrorHttp } = require("./httpHelpers");
const { log } = require("../config");

// De quién es este stock. Un centro lo comparte entre sus profesionales; un
// profesional solo lo tiene para él. Sale del token, nunca del cuerpo del
// pedido: un clinicaId que llegue del cliente es elegir el depósito de otro.
function duenoDe(req) {
  if (req.clinicaId) return { clinicaId: req.clinicaId };
  return { medicoPhone: req.adminUser.usuario };
}

// El insumo tiene que ser del mismo dueño que pregunta, o no existe.
// 404 y no 403, mismo criterio que en todo el resto: un 403 confirma que el
// insumo existe en otro consultorio.
async function insumoDelDueno(req, id) {
  const insumo = await Insumo.findOne({ _id: id, ...duenoDe(req) });
  if (!insumo) throw new ErrorHttp(404, "Ese insumo no existe");
  return insumo;
}

// ═══ EL MOVIMIENTO, QUE ES LO ÚNICO QUE CAMBIA EL STOCK ════════════════════
//
// El signo lo pone el TIPO, no el número: la cantidad siempre llega
// positiva. Un "-5" de entrada y un "5" de salida significan lo mismo y es
// exactamente el error que se comete cargando rápido entre dos pacientes.
//
// "ajuste" pone el stock EN un valor en vez de sumarle o restarle, porque es
// lo que pasa de verdad: alguien contó el estante y hay 18, no "hay 3 menos
// de los que decía". Que sea su propio tipo permite después distinguir el
// consumo real del error de carga, que es lo único que interesa mirar
// cuando el inventario no cuadra.
//
// ═══ UNA SOLA OPERACIÓN SOBRE EL STOCK ═════════════════════════════════════
//
// Antes el stock nuevo se calculaba desde la copia que había leído la ruta y
// se guardaba ese número: dos salidas a la vez de un stock de 10 (3 y 4)
// dejaban 6 o 7 en vez de 3, con los dos movimientos anotados (revisión
// integral del 11 de octubre de 2026, S08). Ahora suma o resta la base misma
// ($inc), y el ajuste pone el valor ($set), en una operación que además le
// da al movimiento su número de orden en el insumo. El movimiento anota el
// stock que quedó justo después de ESA operación.
//
// Con un ajuste y otros movimientos a la vez, vale el orden en que la base
// los aplicó, y queda escrito en cada movimiento: un ajuste es «conté y hay
// 18», y lo que salga después se resta de esos 18.
//
// Si el movimiento no se puede guardar, se deshace lo que se le hizo al
// stock: un número que cambia sin movimiento es lo que este archivo evita.
async function registrarMovimiento(req, insumo, datos) {
  const tipo = datos.tipo;
  const cantidad = Number(datos.cantidad);
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new ErrorHttp(400, "La cantidad tiene que ser un número positivo");
  }
  if (!["entrada", "salida", "ajuste"].includes(tipo)) throw new ErrorHttp(400, "Tipo de movimiento desconocido");

  // ═══ SE PERMITE STOCK NEGATIVO, Y ES A PROPÓSITO ═════════════════════════
  //
  // La tentación es rechazar la salida que deja el stock bajo cero. Pero en
  // un consultorio real eso pasa todo el tiempo y por un motivo inocente:
  // alguien usó algo y lo cargó tarde. Si Symphomed rechaza el movimiento,
  // la salida no se registra NUNCA y el inventario queda peor que en
  // negativo: queda mintiendo en positivo.
  //
  // Un stock en −3 es una señal clara de que falta cargar una entrada, y se
  // arregla con un ajuste. Un stock en 0 que en realidad es −3 no se ve.
  const delta = tipo === "entrada" ? cantidad : tipo === "salida" ? -cantidad : 0;
  const poner = {};
  if (tipo === "ajuste") poner.stock = cantidad;
  // El costo se actualiza solo en las entradas: una salida no cambia lo que
  // costó comprarlo.
  if (tipo === "entrada" && Number(datos.costoUnitarioCentavos) > 0) poner.costoUnitarioCentavos = Number(datos.costoUnitarioCentavos);
  if (datos.venceEl) poner.venceEl = new Date(datos.venceEl);
  const cambios = { $inc: { secuencia: 1, ...(delta ? { stock: delta } : {}) }, ...(Object.keys(poner).length ? { $set: poner } : {}) };

  const antes = await Insumo.findOneAndUpdate({ _id: insumo._id }, cambios, { new: false }).lean();
  if (!antes) throw new ErrorHttp(404, "Ese insumo no existe");
  const stockDespues = tipo === "ajuste" ? cantidad : (antes.stock || 0) + delta;
  const orden = (antes.secuencia || 0) + 1;

  let mov;
  try {
    mov = await MovimientoInsumo.create({
      insumoId: insumo._id,
      clinicaId: antes.clinicaId || null,
      medicoPhone: antes.medicoPhone || "",
      tipo, cantidad, orden,
      stockDespues,
      costoUnitarioCentavos: Number(datos.costoUnitarioCentavos) || 0,
      motivo: String(datos.motivo || "").trim().slice(0, 300),
      pacienteId: datos.pacienteId || null,
      registradoPor: req.adminUser?.usuario || "",
      fecha: datos.fecha ? new Date(datos.fecha) : new Date(),
    });
  } catch (e) {
    // El ajuste se deshace solo si nadie movió el insumo después: si no,
    // volver al número de antes pisaría a ese otro movimiento.
    const deshacer = tipo === "ajuste"
      ? Insumo.updateOne({ _id: insumo._id, secuencia: orden }, { $set: { stock: antes.stock || 0 } })
      : Insumo.updateOne({ _id: insumo._id }, { $inc: { stock: -delta } });
    const r = await deshacer.catch((e2) => { log.error(`[INSUMOS] insumo ${insumo._id}: no se pudo deshacer el stock:`, e2.message); return null; });
    if (r && !r.modifiedCount && tipo === "ajuste") log.error(`[INSUMOS] insumo ${insumo._id}: el ajuste no se pudo deshacer, hubo otro movimiento: revisalo con revisarStock`);
    throw e;
  }

  // El insumo como quedó justo después de este movimiento.
  return { movimiento: mov, insumo: { ...antes, ...poner, stock: stockDespues, secuencia: orden } };
}

// ═══ EL STOCK, REHECHO DESDE LOS MOVIMIENTOS ═══════════════════════════════
//
// Lo que tiene que cuadrar: el stock del insumo es lo que da aplicar sus
// movimientos en el orden en que la base los aplicó. Los de antes del número
// de orden van primero, por cuándo se cargaron.
async function revisarStock(insumoId) {
  const [insumo, movimientos] = await Promise.all([
    Insumo.findById(insumoId).select("stock").lean(),
    MovimientoInsumo.find({ insumoId }).sort({ orden: 1, createdAt: 1, _id: 1 }).select("tipo cantidad").lean(),
  ]);
  let segunMovimientos = 0;
  for (const m of movimientos) {
    if (m.tipo === "entrada") segunMovimientos += m.cantidad;
    else if (m.tipo === "salida") segunMovimientos -= m.cantidad;
    else segunMovimientos = m.cantidad;
  }
  const enElInsumo = insumo?.stock || 0;
  return { segunMovimientos, enElInsumo, cuadra: Math.abs(segunMovimientos - enElInsumo) < 1e-9 };
}

// ─── LO QUE HAY QUE REPONER ───────────────────────────────────────────────
//
// Dos motivos distintos, y se devuelven separados porque se resuelven
// distinto: lo que se está por acabar se compra, lo que está por vencer se
// usa primero o se descarta.
const DIAS_AVISO_VENCIMIENTO = 60;

async function loQueFalta(req) {
  const dueno = duenoDe(req);
  const limite = new Date(Date.now() + DIAS_AVISO_VENCIMIENTO * 86400000);

  const [bajos, porVencer] = await Promise.all([
    // $expr para comparar dos campos del mismo documento: no alcanza con un
    // $lte contra un valor fijo porque el mínimo lo define cada insumo.
    Insumo.find({
      ...dueno, activo: true, stockMinimo: { $gt: 0 },
      $expr: { $lte: ["$stock", "$stockMinimo"] },
    }).sort({ nombre: 1 }).limit(100).lean(),
    Insumo.find({
      ...dueno, activo: true,
      venceEl: { $ne: null, $lte: limite },
      stock: { $gt: 0 },
    }).sort({ venceEl: 1 }).limit(100).lean(),
  ]);

  return { bajos, porVencer, diasAviso: DIAS_AVISO_VENCIMIENTO };
}

// Cuánto vale el stock parado. Sirve para una sola cosa, que es la que
// pregunta el contador: cuánta plata hay quieta en el estante.
async function valorDelStock(req) {
  const [fila] = await Insumo.aggregate([
    { $match: { ...duenoDe(req), activo: true } },
    { $group: {
      _id: null,
      valorCentavos: { $sum: { $multiply: ["$stock", "$costoUnitarioCentavos"] } },
      items: { $sum: 1 },
      unidades: { $sum: "$stock" },
    } },
  ]);
  return fila || { valorCentavos: 0, items: 0, unidades: 0 };
}

module.exports = {
  duenoDe, insumoDelDueno, registrarMovimiento, revisarStock, loQueFalta, valorDelStock,
  DIAS_AVISO_VENCIMIENTO,
};
