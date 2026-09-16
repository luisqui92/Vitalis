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
async function registrarMovimiento(req, insumo, datos) {
  const tipo = datos.tipo;
  const cantidad = Number(datos.cantidad);
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new ErrorHttp(400, "La cantidad tiene que ser un número positivo");
  }

  let stockNuevo;
  if (tipo === "entrada") stockNuevo = (insumo.stock || 0) + cantidad;
  else if (tipo === "salida") stockNuevo = (insumo.stock || 0) - cantidad;
  else if (tipo === "ajuste") stockNuevo = cantidad;
  else throw new ErrorHttp(400, "Tipo de movimiento desconocido");

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
  const mov = await MovimientoInsumo.create({
    insumoId: insumo._id,
    clinicaId: insumo.clinicaId || null,
    medicoPhone: insumo.medicoPhone || "",
    tipo, cantidad,
    stockDespues: stockNuevo,
    costoUnitarioCentavos: Number(datos.costoUnitarioCentavos) || 0,
    motivo: String(datos.motivo || "").trim().slice(0, 300),
    pacienteId: datos.pacienteId || null,
    registradoPor: req.adminUser?.usuario || "",
    fecha: datos.fecha ? new Date(datos.fecha) : new Date(),
  });

  insumo.stock = stockNuevo;
  // El costo se actualiza solo en las entradas: una salida no cambia lo que
  // costó comprarlo.
  if (tipo === "entrada" && Number(datos.costoUnitarioCentavos) > 0) {
    insumo.costoUnitarioCentavos = Number(datos.costoUnitarioCentavos);
  }
  if (datos.venceEl) insumo.venceEl = new Date(datos.venceEl);
  await insumo.save();

  return { movimiento: mov, insumo };
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
  duenoDe, insumoDelDueno, registrarMovimiento, loQueFalta, valorDelStock,
  DIAS_AVISO_VENCIMIENTO,
};
