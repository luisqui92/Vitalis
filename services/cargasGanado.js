// Symphomed Ganadería — Las cargas de campo que hacen el veterinario Y el dueño
//
// Producción del día, muertes y gastos se cargan desde dos puertas: la
// sesión del veterinario (routes/produccion.js, costos.js, lotesGanado.js) y
// el enlace del dueño (routes/accesoDueno.js). Las reglas viven acá, una
// sola vez, para que no pueda pasar que el dueño cargue algo que el
// veterinario no podría —más muertes que animales vivos, un día que todavía
// no pasó— porque alguien arregló una puerta y se olvidó de la otra.
//
// Nada de esto verifica QUIÉN pide: eso lo hace cada ruta antes de llamar,
// y por eso todas reciben el lote ya cargado y ya autorizado.
const { LoteGanado, EventoLote, RegistroProduccion, GastoLote } = require("../db/models");
const { ErrorHttp, diaPasadoValido, numeroNoNegativo } = require("./httpHelpers");
const { CATEGORIAS_GASTO } = require("./costos");
const { diasEnRetiroLeche } = require("./produccion");

const TIPO_PRODUCCION = { bovino: "leche", avicola: "huevos" };

async function eventosConRetiroLeche(loteId, medicoPhone) {
  return EventoLote.find({ loteId, medicoPhone, diasRetiroLeche: { $gt: 0 } })
    .select("tipo fecha diasRetiroLeche producto").lean();
}

// No se puede reportar más muertes que animales vivos en el lote: eso es un
// error de carga, no un dato real.
function validarMuertes(lote, valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) throw new ErrorHttp(400, "cantidadMuertes debe ser un número entero mayor a 0");
  if (n > lote.cantidadActual) throw new ErrorHttp(400, `El lote solo tiene ${lote.cantidadActual} animales activos`);
  return n;
}

// La resta es atómica y condicionada: si dos personas cargan muertes a la
// vez (el dueño desde el galpón, el veterinario desde la camioneta), la
// segunda no puede dejar el lote en negativo por haber leído un
// cantidadActual que ya no era cierto.
async function registrarMortalidad(lote, { dia, cantidadMuertes, causaPresunta, notas, registradoPor, origen = "" }) {
  const n = validarMuertes(lote, cantidadMuertes);
  const fecha = new Date(diaPasadoValido(dia, "fecha"));
  const actualizado = await LoteGanado.findOneAndUpdate(
    { _id: lote._id, medicoPhone: lote.medicoPhone, cantidadActual: { $gte: n } },
    { $inc: { cantidadActual: -n } },
    { new: true }
  );
  if (!actualizado) throw new ErrorHttp(409, "El lote ya no tiene esa cantidad de animales. Recargá y volvé a intentar.");
  const evento = await EventoLote.create({
    medicoPhone: lote.medicoPhone, loteId: lote._id, tipo: "mortalidad", fecha,
    cantidadMuertes: n,
    causaPresunta: String(causaPresunta || "").trim().slice(0, 200),
    notas: String(notas || "").trim().slice(0, 1000),
    registradoPor: String(registradoPor || "").trim(), origen,
  });
  return { evento, lote: actualizado };
}

// Un registro por día: cargar el mismo día otra vez lo CORRIGE.
async function guardarProduccion(lote, cuerpo, { registradoPor = "", origen = "" } = {}) {
  const tipo = TIPO_PRODUCCION[lote.especie];
  if (!tipo) throw new ErrorHttp(400, "Los lotes de cerdos no llevan producción diaria: se sigue por los pesajes");
  if (lote.estado === "cerrado") throw new ErrorHttp(400, "El lote está cerrado");

  const dia = diaPasadoValido(cuerpo?.dia);
  const cantidad = numeroNoNegativo(cuerpo?.cantidad, "cantidad", { requerido: true });
  let animales = numeroNoNegativo(cuerpo?.animales, "animales");
  // Sin el dato, en aves se asume que ponen todas las gallinas vivas —
  // mismo criterio que la vacunación masiva—; sin eso no hay % de postura.
  if (animales == null && tipo === "huevos") animales = lote.cantidadActual;
  if (tipo === "huevos" && animales > lote.cantidadActual) {
    throw new ErrorHttp(400, `El lote tiene ${lote.cantidadActual} aves vivas`);
  }

  const registro = await RegistroProduccion.findOneAndUpdate(
    { medicoPhone: lote.medicoPhone, loteId: lote._id, tipo, dia },
    { $set: { cantidad, animales, notas: String(cuerpo?.notas || "").trim(), registradoPor, origen } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  // Se avisa en la misma respuesta si esa leche está en retiro: es el
  // momento justo en que alguien puede frenar que vaya al tanque.
  let retiro = null;
  if (tipo === "leche") retiro = diasEnRetiroLeche(await eventosConRetiroLeche(lote._id, lote.medicoPhone))(dia);
  return { registro, enRetiro: Boolean(retiro), productoRetiro: retiro ? retiro.producto : null };
}

async function registrarGasto(lote, cuerpo, { moneda, registradoPor = "", origen = "" }) {
  if (lote.estado === "cerrado") throw new ErrorHttp(400, "El lote está cerrado");
  const categoria = String(cuerpo?.categoria || "").trim();
  if (!CATEGORIAS_GASTO.includes(categoria)) throw new ErrorHttp(400, `categoria debe ser una de: ${CATEGORIAS_GASTO.join(", ")}`);
  const dia = diaPasadoValido(cuerpo?.dia);
  const monto = numeroNoNegativo(cuerpo?.monto, "monto");
  const kg = categoria === "alimento" ? numeroNoNegativo(cuerpo?.kg, "kg") : null;
  // Un gasto tiene que decir ALGO: plata, o kilos de alimento (el que se
  // produce en el campo no se compra, pero igual cuenta para la
  // conversión). Uno vacío es un error de carga, no un dato.
  if (!monto && !kg) {
    throw new ErrorHttp(400, categoria === "alimento" ? "Cargá el monto, los kilos, o los dos" : "monto es requerido");
  }
  return GastoLote.create({
    medicoPhone: lote.medicoPhone, loteId: lote._id, dia, categoria,
    concepto: String(cuerpo?.concepto || "").trim().slice(0, 200),
    // El monto llega en la unidad que se escribe (150,50) y se guarda en
    // centavos redondeados, como el resto de la plata.
    montoCentavos: monto != null ? Math.round(monto * 100) : null,
    moneda: moneda === "BRL" ? "BRL" : "BOB",
    kg, registradoPor, origen,
  });
}

module.exports = {
  TIPO_PRODUCCION, eventosConRetiroLeche, validarMuertes,
  registrarMortalidad, guardarProduccion, registrarGasto,
};
