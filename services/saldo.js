// Vitalis — Saldo prepago del médico.
//
// El médico carga plata (transferencia o QR) y cada consulta transcrita le
// descuenta el precio. Acá viven las reglas, que son pocas pero ninguna es
// negociable.
//
// ═══ 1. SE COBRA CUANDO LA CONSULTA SALIÓ BIEN ═════════════════════════════
//
// No al subir el audio: al terminar la transcripción. Si AssemblyAI falla y
// ya le cobramos, el médico pagó por nada — y uno al que le pasa eso una vez
// no vuelve a confiar en el saldo, con razón. El cobro se engancha al estado
// "completado" de la consulta.
//
// ═══ 2. UNA CONSULTA SE COBRA UNA SOLA VEZ ═════════════════════════════════
//
// La transcripción puede reintentar. Lo que lo impide no es un if: es el
// índice único de MovimientoSaldo sobre consultaId. Un if se puede saltear
// con dos procesos a la vez; el índice no.
//
// ═══ 3. NUNCA SE CORTA UNA CONSULTA EMPEZADA ═══════════════════════════════
//
// El médico está con el paciente adelante. Si el saldo se acaba mientras la
// consulta se transcribe, se termina igual y el saldo queda en NEGATIVO. Se
// cobra en la próxima recarga.
//
// Perder la consulta de un médico por Bs 12 cuesta muchísimo más que Bs 12.
//
// Eso sí, el negativo tiene un piso (LIMITE_NEGATIVO): sin él, una cuenta sin
// saldo podría transcribir para siempre. El piso es de varias consultas, no
// de una, justamente para que nadie se quede sin atender por el margen.
//
// ═══ 4. LA VERDAD SON LOS MOVIMIENTOS ══════════════════════════════════════
//
// Medico.saldoCentavos es una copia rápida. Si alguna vez no coincide con la
// suma de los movimientos, gana la suma — ver reconciliar().
const { Medico, MovimientoSaldo } = require("../db/models");
const { log } = require("../config");

// En centavos de boliviano. Configurable por entorno porque el precio va a
// cambiar, y cuando cambie no se pueden retocar los cobros ya hechos: cada
// movimiento guarda el monto que se cobró ese día.
const PRECIO_CONSULTA = Number(process.env.PRECIO_CONSULTA_CENTAVOS || 1200);
// Hasta dónde se deja llegar el saldo negativo. Cinco consultas de margen:
// suficiente para que nadie quede a mitad de una jornada sin poder trabajar,
// poco para que no sea un servicio gratis.
const LIMITE_NEGATIVO = -5 * PRECIO_CONSULTA;
// Desde cuántas consultas restantes se le empieza a avisar.
const AVISAR_DESDE = 5;

function bolivianos(centavos) {
  return (centavos / 100).toFixed(2);
}

// ─── LECTURA ──────────────────────────────────────────────────────────────
async function estadoDe(medicoPhone) {
  const medico = await Medico.findOne({ phone: medicoPhone }).select("saldoCentavos").lean();
  const saldoCentavos = medico?.saldoCentavos || 0;
  // Se redondea para abajo: si le quedan Bs 18 y cada consulta son 12, le
  // queda UNA, no una y media. Decirle 1.5 sería mentirle.
  const consultasRestantes = Math.max(0, Math.floor(saldoCentavos / PRECIO_CONSULTA));
  return {
    saldoCentavos,
    saldoBs: bolivianos(saldoCentavos),
    precioConsultaCentavos: PRECIO_CONSULTA,
    consultasRestantes,
    enNegativo: saldoCentavos < 0,
    // "Bajo" incluye el negativo, no solo el que está por acabarse.
    bajo: consultasRestantes <= AVISAR_DESDE,
    // Si ya no puede ni empezar otra consulta.
    bloqueado: saldoCentavos <= LIMITE_NEGATIVO,
    limiteNegativoCentavos: LIMITE_NEGATIVO,
  };
}

async function movimientosDe(medicoPhone, limite = 50) {
  return MovimientoSaldo.find({ medicoPhone })
    .select("tipo montoCentavos saldoDespuesCentavos concepto referencia createdAt")
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, limite)))
    .lean();
}

// ─── ESCRITURA ────────────────────────────────────────────────────────────
// El orden importa y NO es intercambiable. Primero se reserva el movimiento,
// después se mueve el saldo.
//
// Al revés parece más natural y está mal. El índice único sobre consultaId es
// lo único que impide cobrar dos veces la misma consulta, y si el $inc va
// primero, ocho intentos simultáneos descuentan ocho veces y recién después
// siete de ellos chocan contra el índice: queda un solo movimiento y el saldo
// descontado ocho veces. No es hipotético — así estaba escrito, y lo encontró
// la prueba 4 de probar_saldo.js con ocho cobros en paralelo.
//
// Escribiendo el movimiento primero, el que pierde la carrera no llega nunca a
// tocar el saldo.
//
// Si fallara el paso 2 o el 3, quedaría un movimiento anotado y el saldo sin
// actualizar. Eso lo detecta y lo arregla reconciliar(), y es el lado seguro
// para fallar: el libro dice que se cobró y la copia se pone al día. Al revés
// —plata descontada sin registro— no hay cómo reconstruirlo.
async function aplicar({ medicoPhone, tipo, montoCentavos, concepto, consultaId, acreditadoPor, referencia }) {
  if (!await Medico.exists({ phone: medicoPhone })) {
    throw new Error(`No existe la cuenta ${medicoPhone}`);
  }

  // 1. Reservar. Acá es donde el índice único ataja el cobro doble.
  const mov = await MovimientoSaldo.create({
    medicoPhone, tipo, montoCentavos,
    concepto: concepto || "", consultaId: consultaId || null,
    acreditadoPor: acreditadoPor || "", referencia: referencia || "",
  });

  // 2. Recién ahora se mueve el saldo. $inc es atómico: dos consultas que
  //    terminan al mismo tiempo se suman, no se pisan.
  const medico = await Medico.findOneAndUpdate(
    { phone: medicoPhone },
    { $inc: { saldoCentavos: montoCentavos } },
    { new: true, projection: { saldoCentavos: 1 } }
  );

  // 3. Anotar cómo quedó, para poder auditar este movimiento suelto sin
  //    recalcular toda la historia.
  mov.saldoDespuesCentavos = medico.saldoCentavos;
  await mov.save();
  return mov;
}

// Acreditar una transferencia o un QR. Lo hace una persona que vio el
// comprobante; por eso pide quién y contra qué referencia — una carga sin eso
// es plata que apareció de la nada.
async function cargar({ medicoPhone, montoCentavos, acreditadoPor, referencia, concepto }) {
  const monto = Math.round(Number(montoCentavos));
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto a cargar tiene que ser un número positivo");
  if (!acreditadoPor) throw new Error("Falta quién acredita la carga");
  const mov = await aplicar({
    medicoPhone, tipo: "carga", montoCentavos: monto,
    concepto: concepto || `Carga de Bs ${bolivianos(monto)}`,
    acreditadoPor, referencia,
  });
  log.info(`[SALDO] carga de Bs ${bolivianos(monto)} a ${medicoPhone} por ${acreditadoPor} — queda Bs ${bolivianos(mov.saldoDespuesCentavos)}`);
  return mov;
}

// Cobrar una consulta ya transcrita. Idempotente: si esa consulta ya se
// cobró, no hace nada y lo dice.
//
// NO valida saldo. Para cuando esto corre, la consulta ya está transcrita: el
// trabajo está hecho y la plata gastada. Negarse acá solo dejaría al médico
// sin su nota clínica, y encima ya pagamos nosotros la transcripción.
async function cobrarConsulta({ medicoPhone, consultaId }) {
  // El guardia de verdad es el índice único; esta consulta es solo para no
  // pegarle a Mongo con un insert que sabemos que va a fallar.
  const yaCobrada = await MovimientoSaldo.findOne({ tipo: "consumo", consultaId }).select("_id").lean();
  if (yaCobrada) return { cobrado: false, motivo: "ya_cobrada" };

  try {
    const mov = await aplicar({
      medicoPhone, tipo: "consumo", montoCentavos: -PRECIO_CONSULTA,
      concepto: "Consulta transcrita", consultaId,
    });
    if (mov.saldoDespuesCentavos < 0) {
      log.warn(`[SALDO] ${medicoPhone} quedó en Bs ${bolivianos(mov.saldoDespuesCentavos)} — la consulta se completó igual`);
    }
    return { cobrado: true, movimiento: mov, saldoCentavos: mov.saldoDespuesCentavos };
  } catch (e) {
    // 11000 = el índice único atajó un cobro doble. Es el caso bueno, no un
    // error: significa que dos procesos intentaron cobrar la misma consulta.
    if (e.code === 11000) return { cobrado: false, motivo: "ya_cobrada" };
    throw e;
  }
}

// Corrección a mano. Pide motivo porque un ajuste sin explicación es
// exactamente lo que hace que un médico desconfíe del saldo.
async function ajustar({ medicoPhone, montoCentavos, concepto, acreditadoPor }) {
  const monto = Math.round(Number(montoCentavos));
  if (!Number.isFinite(monto) || monto === 0) throw new Error("El ajuste tiene que ser distinto de cero");
  if (!concepto) throw new Error("Un ajuste sin motivo escrito no se hace");
  if (!acreditadoPor) throw new Error("Falta quién hace el ajuste");
  return aplicar({ medicoPhone, tipo: "ajuste", montoCentavos: monto, concepto, acreditadoPor });
}

// ─── AUDITORÍA ────────────────────────────────────────────────────────────
// Suma todos los movimientos y compara con la copia rápida. Un descuadre
// significa que algo escribió el saldo sin dejar movimiento — y hay que
// mirarlo, no taparlo. Por eso por defecto solo INFORMA.
async function reconciliar(medicoPhone, { corregir = false } = {}) {
  const filas = await MovimientoSaldo.aggregate([
    { $match: { medicoPhone } },
    { $group: { _id: null, total: { $sum: "$montoCentavos" }, n: { $sum: 1 } } },
  ]);
  const segunMovimientos = filas[0]?.total || 0;
  const medico = await Medico.findOne({ phone: medicoPhone }).select("saldoCentavos").lean();
  const enLaCuenta = medico?.saldoCentavos || 0;
  const diferencia = enLaCuenta - segunMovimientos;

  if (diferencia !== 0 && corregir) {
    await Medico.updateOne({ phone: medicoPhone }, { $set: { saldoCentavos: segunMovimientos } });
    log.warn(`[SALDO] ${medicoPhone} descuadrado en Bs ${bolivianos(diferencia)} — corregido a Bs ${bolivianos(segunMovimientos)}`);
  }
  return {
    medicoPhone, movimientos: filas[0]?.n || 0,
    segunMovimientos, enLaCuenta, diferencia,
    cuadra: diferencia === 0,
    corregido: diferencia !== 0 && corregir,
  };
}

module.exports = {
  estadoDe, movimientosDe, cargar, cobrarConsulta, ajustar, reconciliar,
  bolivianos, PRECIO_CONSULTA, LIMITE_NEGATIVO, AVISAR_DESDE,
};
