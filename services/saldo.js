// Symphomed — Saldo prepago del médico.
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
const { Clinica, Medico, MovimientoSaldo } = require("../db/models");
const monedas = require("./monedas");
const suscripciones = require("./suscripciones");
const { log } = require("../config");

// En centavos de boliviano. Configurable por entorno porque el precio va a
// cambiar, y cuando cambie no se pueden retocar los cobros ya hechos: cada
// movimiento guarda el monto que se cobró ese día.
// Los valores de la moneda por defecto. Se mantienen exportados porque hay
// pantallas y pruebas que los piden, pero adentro de este archivo TODO se
// resuelve por la moneda del médico: ver monedas.config().
const PRECIO_CONSULTA = monedas.config("BOB").precioConsulta;
// Hasta dónde se deja llegar el saldo negativo. Cinco consultas de margen:
// suficiente para que nadie quede a mitad de una jornada sin poder trabajar,
// poco para que no sea un servicio gratis.
const LIMITE_NEGATIVO = -5 * PRECIO_CONSULTA;
// Desde cuántas consultas restantes se le empieza a avisar.
const AVISAR_DESDE = 5;

// Cuántas consultas gratis tiene una cuenta nueva. Va en el entorno para
// poder moverlo en una campaña sin desplegar.
//
// Es un NÚMERO DE CONSULTAS y no un monto de saldo regalado: si fuera saldo,
// el día que cambie el precio cambiaría también cuántas son gratis, sin que
// nadie lo decida.
const CONSULTAS_GRATIS = Number(process.env.CONSULTAS_GRATIS || 4);
// Recarga mínima. Es una regla comercial —no tiene sentido procesar a mano
// una transferencia de Bs 20— pero NO es un bloqueo absoluto: ver cargar().
const RECARGA_MINIMA = monedas.config("BOB").recargaMinima;

function bolivianos(centavos) {
  return (centavos / 100).toFixed(2);
}

// ─── LECTURA ──────────────────────────────────────────────────────────────

// La moneda de una cuenta, en un solo lugar. Si mañana deja de vivir en
// Medico.moneda, se cambia acá y no en ocho consultas repartidas.
async function monedaDe(medicoPhone) {
  const m = await Medico.findOne({ phone: medicoPhone }).select("moneda").lean();
  return monedas.normalizar(m?.moneda);
}

async function estadoDe(medicoPhone) {
  const medico = await Medico.findOne({ phone: medicoPhone }).select("saldoCentavos moneda suscripcion consultasGratisUsadas clinicaId").lean();
  // El plan puede venir del centro donde trabaja. Se busca SOLO si pertenece
  // a uno: la enorme mayoría de los médicos no, y una consulta de más por
  // cada pintado de pantalla se paga en todas.
  const clinica = medico?.clinicaId
    ? await Clinica.findById(medico.clinicaId).select("suscripcion").lean()
    : null;
  const saldoCentavos = medico?.saldoCentavos || 0;
  const moneda = monedas.normalizar(medico?.moneda);
  const cfg = monedas.config(moneda);
  // Se redondea para abajo: si le quedan Bs 18 y cada consulta son 12, le
  // queda UNA, no una y media. Decirle 1.5 sería mentirle.
  const consultasRestantes = Math.max(0, Math.floor(saldoCentavos / cfg.precioConsulta));
  const limiteNegativo = -5 * cfg.precioConsulta;
  const plan = suscripciones.estado(medico, clinica);
  const gratisUsadas = Math.min(medico?.consultasGratisUsadas || 0, CONSULTAS_GRATIS);
  const gratisRestantes = CONSULTAS_GRATIS - gratisUsadas;
  return {
    saldoCentavos,
    moneda, simbolo: cfg.simbolo,
    saldoBs: bolivianos(saldoCentavos),
    precioConsultaCentavos: cfg.precioConsulta,
    consultasRestantes,
    enNegativo: saldoCentavos < 0,
    // "Bajo" incluye el negativo, no solo el que está por acabarse.
    //
    // Con plan vigente los dos avisos se apagan: las consultas no descuentan,
    // así que un saldo en cero —o en rojo, de antes de contratar— no
    // significa nada. Sin esto, un médico que acaba de pagar R$ 400 vería
    // "te queda poco saldo" y podría quedar bloqueado.
    // Tampoco se avisa mientras le queden de cortesía: una cuenta nueva
    // arranca en cero y vería "te queda poco saldo" antes de haber usado
    // Symphomed una sola vez.
    bajo: !plan.activa && gratisRestantes === 0 && consultasRestantes <= AVISAR_DESDE,
    // Si ya no puede ni empezar otra consulta.
    bloqueado: !plan.activa && gratisRestantes === 0 && saldoCentavos <= limiteNegativo,
    limiteNegativoCentavos: limiteNegativo,
    recargaMinimaCentavos: cfg.recargaMinima,
    suscripcion: plan,
    // Las de cortesía. La pantalla las usa para avisar ANTES de que se
    // acaben —cuando el médico todavía puede decidir con calma— y no el día
    // que se topa con que ya no puede transcribir.
    gratis: {
      total: CONSULTAS_GRATIS,
      usadas: gratisUsadas,
      restantes: gratisRestantes,
      enCortesia: gratisRestantes > 0,
      // Sobre las dos últimas ya conviene mostrar los planes.
      porAcabarse: gratisRestantes > 0 && gratisRestantes <= 2,
    },
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
async function aplicar({ medicoPhone, tipo, montoCentavos, concepto, consultaId, acreditadoPor, referencia, referenciaClave, moneda }) {
  const cuenta = await Medico.findOne({ phone: medicoPhone }).select("moneda").lean();
  if (!cuenta) {
    throw new Error(`No existe la cuenta ${medicoPhone}`);
  }
  // La moneda la manda quien llama solo si ya la resolvió; si no, sale de la
  // cuenta. Nunca queda vacía: un asiento sin moneda no se puede sumar.
  const monedaMov = monedas.normalizar(moneda || cuenta.moneda);

  // 1. Reservar. Acá es donde el índice único ataja el cobro doble.
  const mov = await MovimientoSaldo.create({
    medicoPhone, tipo, montoCentavos, moneda: monedaMov,
    concepto: concepto || "", consultaId: consultaId || null,
    acreditadoPor: acreditadoPor || "", referencia: referencia || "",
    referenciaClave: referenciaClave || null,
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

// Para comparar referencias sin que un espacio de más o una mayúscula hagan
// pasar la misma transferencia por dos distintas.
function claveDeReferencia(referencia) {
  const limpia = String(referencia || "").toUpperCase().replace(/\s+/g, " ").trim();
  return limpia || null;
}

// Acreditar una transferencia o un QR. Lo hace una persona que vio el
// comprobante; por eso pide quién y contra qué referencia — una carga sin eso
// es plata que apareció de la nada.
//
// ⚠️ LA REFERENCIA TIENE QUE SALIR DEL BANCO, NO DEL COMPROBANTE QUE MANDÓ EL
// MÉDICO. Una captura de pantalla se falsifica en dos minutos con cualquier
// editor de imágenes, y el operador que la mira no tiene cómo notarlo. Lo
// único que prueba que el dinero entró es verlo en el extracto o en la app
// del banco. Esto el código no lo puede garantizar: es del procedimiento.
async function cargar({ medicoPhone, montoCentavos, acreditadoPor, referencia, concepto, permitirMenorAlMinimo }) {
  const monto = Math.round(Number(montoCentavos));
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto a cargar tiene que ser un número positivo");
  if (!acreditadoPor) throw new Error("Falta quién acredita la carga");

  // El mínimo frena, pero no es absoluto, y la diferencia importa: si el
  // médico transfirió menos igual, LA PLATA YA ESTÁ EN LA CUENTA DEL BANCO.
  // Negarse a acreditarla no le enseña la regla — es quedarse con su dinero.
  // Por eso el operador puede pasar por encima a propósito, y queda escrito
  // en el concepto del movimiento que fue una excepción.
  // El mínimo es el DE SU MONEDA: R$ 100 y Bs 100 no son la misma exigencia,
  // y aplicarle a un médico brasileño el mínimo boliviano sería inventarle
  // una regla comercial que nadie decidió.
  const monedaCuenta = await monedaDe(medicoPhone);
  const cfg = monedas.config(monedaCuenta);

  if (monto < cfg.recargaMinima && !permitirMenorAlMinimo) {
    const e = new Error(
      `La recarga mínima es ${monedas.conSimbolo(cfg.recargaMinima, monedaCuenta)} y esta es de ${monedas.conSimbolo(monto, monedaCuenta)}.`
    );
    e.codigo = "menor_al_minimo";
    e.minimoCentavos = cfg.recargaMinima;
    throw e;
  }

  // Sin referencia no hay contra qué comparar, y el índice único no puede
  // atajar nada: una carga sin comprobante se puede repetir infinitas veces
  // sin que el sistema lo note. Por eso es obligatoria, incluso en efectivo
  // (ahí sirve algo como "efectivo 2026-08-26 recibido por Luis").
  if (!claveDeReferencia(referencia)) {
    throw new Error("Falta la referencia del comprobante. Sin ella la misma carga se puede repetir sin que nadie lo note.");
  }

  // Se busca antes para poder decir CUÁL fue la carga anterior. El guardia de
  // verdad sigue siendo el índice único (dos operadores a la vez).
  const referenciaClave = claveDeReferencia(referencia);
  if (referenciaClave) {
    const yaCargada = await MovimientoSaldo.findOne({ tipo: "carga", referenciaClave })
      .select("medicoPhone montoCentavos createdAt acreditadoPor").lean();
    if (yaCargada) {
      const e = new Error(
        `La referencia "${referencia}" ya se acreditó el ${new Date(yaCargada.createdAt).toLocaleString("es-BO")} ` +
        `a +${yaCargada.medicoPhone} por ${monedas.conSimbolo(yaCargada.montoCentavos, yaCargada.moneda)} (${yaCargada.acreditadoPor}).`
      );
      e.codigo = "referencia_repetida";
      e.anterior = yaCargada;
      throw e;
    }
  }

  const bajoMinimo = monto < cfg.recargaMinima;
  const mov = await aplicar({
    medicoPhone, tipo: "carga", montoCentavos: monto,
    moneda: monedaCuenta,
    concepto: concepto || `Carga de ${monedas.conSimbolo(monto, monedaCuenta)}${bajoMinimo ? " (bajo el mínimo, autorizada)" : ""}`,
    acreditadoPor, referencia, referenciaClave,
  });
  log.info(`[SALDO] carga de ${monedas.conSimbolo(monto, monedaCuenta)} a ${medicoPhone} por ${acreditadoPor} [${referencia || "sin referencia"}] — queda ${monedas.conSimbolo(mov.saldoDespuesCentavos, monedaCuenta)}`);
  return mov;
}

// Cobrar una consulta ya transcrita. Idempotente: si esa consulta ya se
// cobró, no hace nada y lo dice.
//
// NO valida saldo. Para cuando esto corre, la consulta ya está transcrita: el
// trabajo está hecho y la plata gastada. Negarse acá solo dejaría al médico
// sin su nota clínica, y encima ya pagamos nosotros la transcripción.
// "concepto" es opcional a propósito: lo único que lo necesita hoy es el
// dictado de campo de Ganadería (routes/lotesGanado.js), que cobra lo mismo
// y por el mismo mecanismo que una consulta humana, pero el libro de
// movimientos tiene que decir qué fue de verdad — un médico que además
// atiende gente no puede ver "Consulta transcrita" en su saldo por un lote
// de pollos. Sin este parámetro, el comportamiento es EXACTAMENTE el de
// antes: ningún llamado existente pasa "concepto", así que ninguno cambia.
async function cobrarConsulta({ medicoPhone, consultaId, concepto }) {
  const base = concepto || "Consulta transcrita";
  const conceptoCortesia = concepto ? `${concepto} de cortesía` : "Consulta de cortesía";
  // El guardia de verdad es el índice único; esta consulta es solo para no
  // pegarle a Mongo con un insert que sabemos que va a fallar.
  const yaCobrada = await MovimientoSaldo.findOne({ tipo: "consumo", consultaId }).select("_id").lean();
  if (yaCobrada) return { cobrado: false, motivo: "ya_cobrada" };

  // El precio es el de SU moneda. Cobrarle 1200 centavos a un médico
  // brasileño porque ese es el precio boliviano sería cobrarle un número, no
  // un precio.
  const medico = await Medico.findOne({ phone: medicoPhone }).select("moneda suscripcion clinicaId").lean();
  const clinica = medico?.clinicaId
    ? await Clinica.findById(medico.clinicaId).select("suscripcion").lean()
    : null;
  const monedaCuenta = monedas.normalizar(medico?.moneda);
  const cfg = monedas.config(monedaCuenta);

  // ═══ CON PLAN VIGENTE NO SE DESCUENTA — PERO SE ANOTA ═══════════════════
  //
  // El movimiento se escribe igual, con monto cero. Parece redundante y no
  // lo es: es la única forma de saber cuántas consultas hace un plan de
  // R$ 400, y eso es lo que contesta si el precio está bien puesto o si hay
  // alguien haciendo 300 al mes mientras la transcripción se paga por
  // consulta.
  //
  // Además el índice único por consultaId sigue valiendo, así que un
  // suscriptor tampoco puede duplicar el registro de una misma consulta.
  const conPlan = suscripciones.vigente(medico, clinica);

  // ═══ LAS DE CORTESÍA, ANTES DE COBRAR ═══════════════════════════════════
  //
  // El $inc con la condición adentro del filtro es lo que lo hace seguro: si
  // dos consultas terminan de transcribirse al mismo tiempo con una sola
  // gratis disponible, la base deja pasar UNA. Preguntar primero y sumar
  // después dejaría pasar las dos, y regalaríamos consultas de a pares sin
  // enterarnos.
  let deCortesia = false;
  if (!conPlan) {
    const consumida = await Medico.findOneAndUpdate(
      { phone: medicoPhone, consultasGratisUsadas: { $lt: CONSULTAS_GRATIS } },
      { $inc: { consultasGratisUsadas: 1 } },
      { new: true, projection: { consultasGratisUsadas: 1 } }
    );
    deCortesia = Boolean(consumida);
  }
  const sinCargo = conPlan || deCortesia;

  try {
    const mov = await aplicar({
      medicoPhone, tipo: "consumo",
      montoCentavos: sinCargo ? 0 : -cfg.precioConsulta,
      moneda: monedaCuenta,
      concepto: conPlan ? `${base} (plan ${medico.suscripcion.plan})`
        : deCortesia ? conceptoCortesia
        : base,
      consultaId,
    });
    if (sinCargo) return { cobrado: true, conPlan, deCortesia, movimiento: mov, saldoCentavos: mov.saldoDespuesCentavos };
    if (mov.saldoDespuesCentavos < 0) {
      log.warn(`[SALDO] ${medicoPhone} quedó en ${monedas.conSimbolo(mov.saldoDespuesCentavos, monedaCuenta)} — la consulta se completó igual`);
    }
    return { cobrado: true, movimiento: mov, saldoCentavos: mov.saldoDespuesCentavos };
  } catch (e) {
    // La cortesía ya se descontó ANTES de escribir el movimiento, así que si
    // el movimiento no se escribió hay que devolverla. Sin esto, dos procesos
    // cobrando la misma consulta le queman una consulta gratis al médico por
    // un choque que no tuvo nada que ver con él.
    if (deCortesia) {
      await Medico.updateOne({ phone: medicoPhone }, { $inc: { consultasGratisUsadas: -1 } })
        .catch(() => log.error(`[SALDO] no se pudo devolver la consulta de cortesía a ${medicoPhone}`));
    }
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
  estadoDe, movimientosDe, cargar, cobrarConsulta, ajustar, reconciliar, claveDeReferencia,
  bolivianos, monedaDe, PRECIO_CONSULTA, LIMITE_NEGATIVO, AVISAR_DESDE, RECARGA_MINIMA, CONSULTAS_GRATIS,
};
