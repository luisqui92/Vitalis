// Vitalis — El plan mensual/anual, la otra forma de pagar.
//
// ═══ DOS MODELOS, UNA CUENTA A LA VEZ ══════════════════════════════════════
//
//   · Prepago      — carga saldo, cada consulta le descuenta. Bien para
//                    quien atiende poco o está probando.
//   · Suscripción  — paga por mes o por año, las consultas no descuentan.
//                    Bien para quien atiende todos los días.
//
// A los precios de Brasil (R$ 10 la consulta, R$ 400 el mes) el plan se paga
// solo a partir de 40 consultas al mes. Eso NO es casualidad y conviene no
// perderlo de vista si algún día se tocan los números: si el plan valiera
// menos que 20 consultas, todo el mundo se pasaría al plan y el prepago no
// tendría sentido; si valiera más que 80, nadie lo tomaría.
//
// ═══ VENCER NO ES BLOQUEAR ═════════════════════════════════════════════════
//
// Cuando el plan se vence, la cuenta NO queda afuera: vuelve al prepago con
// el saldo que tenga, y el prepago a su vez tampoco corta en cero sino cinco
// consultas más abajo.
//
// Es la misma decisión de siempre: para cuando el sistema se entera de que
// hay que cobrar, el médico YA grabó la consulta, con el paciente adelante.
// Un plan vencido ayer no puede tirar a la basura una grabación que no se
// puede repetir. Se le avisa antes, que es cuando todavía puede hacer algo.
//
// ═══ LAS CONSULTAS DEL SUSCRIPTOR SE CUENTAN IGUAL ═════════════════════════
//
// Aunque no descuenten saldo, cada consulta de un suscriptor deja su
// movimiento en el libro mayor con monto cero. Parece redundante y no lo es:
// es el único modo de saber cuántas consultas hace un plan de R$ 400.
//
// Sin ese número no se puede responder la pregunta que decide el negocio:
// ¿el plan está bien puesto, o hay alguien haciendo 300 consultas al mes por
// R$ 400 mientras la transcripción y la IA se pagan por consulta?
const monedas = require("./monedas");

// Cuántos meses da cada plan. El anual son doce meses al precio de once —
// el "mes gratis" no es un descuento suelto, es el mes trece.
const PLANES = {
  mensual: { meses: 1, mesesCobrados: 1 },
  anual: { meses: 12, mesesCobrados: 11 },
};

// El precio de un mes, por moneda. Se lee del entorno para poder cambiarlo
// sin desplegar: un precio metido en el código es un precio que hay que
// programar para corregir.
function precioMensual(moneda) {
  const m = monedas.normalizar(moneda);
  const porDefecto = m === "BRL" ? 40000 : 40000;   // R$ 400,00 · Bs 400,00
  const env = Number(process.env[`PLAN_MENSUAL_CENTAVOS_${m}`]);
  return Number.isFinite(env) && env > 0 ? env : porDefecto;
}

// Lo que cuesta contratar cada plan, ya con el mes gratis aplicado.
function precioDelPlan(plan, moneda) {
  const def = PLANES[plan];
  if (!def) return 0;
  return precioMensual(moneda) * def.mesesCobrados;
}

// ═══ SI ESTÁ VIGENTE, Y NADA MÁS ═══════════════════════════════════════════
//
// Se compara contra la fecha y punto. No hay un campo "activo" que mantener
// en sincronía: un booleano guardado se queda en true después de vencido y
// nadie se entera hasta que alguien no paga durante meses.
function vigente(medico, ahora = new Date()) {
  const hasta = medico?.suscripcion?.hasta;
  return Boolean(hasta && new Date(hasta) > ahora);
}

function diasRestantes(medico, ahora = new Date()) {
  if (!vigente(medico, ahora)) return 0;
  return Math.ceil((new Date(medico.suscripcion.hasta) - ahora) / 86400000);
}

// Estado para mostrar. Devuelve siempre algo: "sin plan" es una respuesta.
function estado(medico, ahora = new Date()) {
  const s = medico?.suscripcion || {};
  const activa = vigente(medico, ahora);
  const moneda = monedas.normalizar(medico?.moneda);
  return {
    activa,
    plan: activa ? s.plan : "",
    hasta: activa ? s.hasta : null,
    diasRestantes: diasRestantes(medico, ahora),
    // Con menos de una semana ya conviene avisarle, no el último día.
    porVencer: activa && diasRestantes(medico, ahora) <= 7,
    // Lo que costaría contratar, para que la pantalla no tenga que saber
    // ningún precio: si un día cambian, cambian en un solo lugar.
    precios: {
      mensual: precioDelPlan("mensual", moneda),
      anual: precioDelPlan("anual", moneda),
      mensualTexto: monedas.conSimbolo(precioDelPlan("mensual", moneda), moneda),
      anualTexto: monedas.conSimbolo(precioDelPlan("anual", moneda), moneda),
      mesesGratis: PLANES.anual.meses - PLANES.anual.mesesCobrados,
    },
  };
}

// ═══ DESDE CUÁNDO CUENTA UNA RENOVACIÓN ════════════════════════════════════
//
// Si el plan sigue vigente, el nuevo período arranca cuando termina el
// anterior — no hoy. Si arrancara hoy, renovar antes de tiempo le REGALARÍA
// días a Vitalis y se los sacaría al médico, que es exactamente lo que uno
// no quiere que descubra alguien que pagó por adelantado.
//
// Si ya venció, arranca ahora: los días que estuvo sin plan no se cobran.
function nuevoVencimiento(medico, plan, ahora = new Date()) {
  const def = PLANES[plan];
  if (!def) throw new Error(`Plan desconocido: ${plan}`);
  const base = vigente(medico, ahora) ? new Date(medico.suscripcion.hasta) : new Date(ahora);
  const hasta = new Date(base);
  hasta.setMonth(hasta.getMonth() + def.meses);
  return hasta;
}

module.exports = {
  PLANES, precioMensual, precioDelPlan, vigente, diasRestantes, estado, nuevoVencimiento,
};
