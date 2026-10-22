// Symphomed — El plan mensual/anual, la otra forma de pagar.
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
const extensiones = require("./extensiones");

// Cuántos meses da cada plan. El anual son doce meses al precio de once —
// el "mes gratis" no es un descuento suelto, es el mes trece.
const PLANES = {
  mensual: { meses: 1, mesesCobrados: 1 },
  anual: { meses: 12, mesesCobrados: 11 },
};

// El precio de un mes, por moneda. Se lee del entorno para poder cambiarlo
// sin desplegar: un precio metido en el código es un precio que hay que
// programar para corregir.
// Cada plan mensual tiene que valer lo mismo que un número redondo de
// consultas sueltas, porque ese número ES el argumento de venta: a Bs 12 la
// consulta, Bs 900 son 75 consultas — el punto exacto desde el que conviene
// el plan, y el que dice la página de symphomed.com. Si se cambia uno de los
// dos precios sin el otro, la web pasa a mentir.
//
//   BOB: 90000 ÷ 1200 = 75 consultas
//   BRL: 40000 ÷ 1000 = 40 consultas
const PLAN_MENSUAL_POR_DEFECTO = { BOB: 90000, BRL: 40000 };

function precioMensual(moneda) {
  const m = monedas.normalizar(moneda);
  const env = Number(process.env[`PLAN_MENSUAL_CENTAVOS_${m}`]);
  return Number.isFinite(env) && env > 0
    ? env
    : (PLAN_MENSUAL_POR_DEFECTO[m] || PLAN_MENSUAL_POR_DEFECTO.BOB);
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
//
// ═══ DOS LUGARES DE DONDE PUEDE VENIR EL PLAN ═════════════════════════════
//
// El propio del médico, o el del CENTRO donde trabaja. Un centro de terapia
// de neurodesarrollo —fonoaudióloga, terapista ocupacional, psicopedagoga,
// psicóloga— es un cliente que comparte fichas, no cuatro clientes sueltos.
//
// Se mira primero el propio: si un profesional pagó su plan y además el
// centro paga el suyo, el que vale es el que él pagó —es el que le da
// cobertura si mañana se va del centro— y el del centro queda de red.
//
// `clinica` es opcional. Quien no la pase obtiene el comportamiento de
// siempre, que es lo que hace que este cambio no pueda romper nada de lo que
// ya funcionaba.
function vigenteEn(titular, ahora) {
  if (titular?.suscripcion?.ambito === "educativo" && !titular?.estudiante?.nivel) return false;
  const hasta = titular?.suscripcion?.hasta;
  return Boolean(hasta && new Date(hasta) > ahora);
}

function vigente(medico, clinica = null, ahora = new Date()) {
  // Compatibilidad: alguien puede seguir llamando vigente(medico, fecha).
  // Sin esto, pasarle una fecha como segundo argumento la tomaría por una
  // clínica sin suscripción y devolvería siempre lo del médico — que es el
  // caso correcto por casualidad, hasta que deje de serlo.
  if (clinica instanceof Date) { ahora = clinica; clinica = null; }
  return vigenteEn(medico, ahora) || vigenteEn(clinica, ahora);
}

// De dónde sale el plan que está cubriendo a este médico ahora mismo.
// Devuelve null si no hay ninguno.
function titularDelPlan(medico, clinica = null, ahora = new Date()) {
  if (vigenteEn(medico, ahora)) return { origen: "propio", titular: medico };
  if (vigenteEn(clinica, ahora)) return { origen: "clinica", titular: clinica };
  return null;
}

function diasRestantes(medico, clinica = null, ahora = new Date()) {
  if (clinica instanceof Date) { ahora = clinica; clinica = null; }
  const quien = titularDelPlan(medico, clinica, ahora);
  if (!quien) return 0;
  return Math.ceil((new Date(quien.titular.suscripcion.hasta) - ahora) / 86400000);
}

// Estado para mostrar. Devuelve siempre algo: "sin plan" es una respuesta.
function estado(medico, clinica = null, ahora = new Date()) {
  if (clinica instanceof Date) { ahora = clinica; clinica = null; }
  const propio = extensiones.sumar("suscripcion.estado", { medico, ahora }).suscripcion;
  if (propio) return propio;
  const quien = titularDelPlan(medico, clinica, ahora);
  const s = quien ? quien.titular.suscripcion : {};
  const activa = Boolean(quien);
  // La moneda es SIEMPRE la del médico, aunque el plan lo pague el centro:
  // los precios que se le muestran son los que él pagaría si contratara, y
  // un profesional boliviano en un centro que factura en reales tiene que
  // seguir viendo bolivianos.
  const moneda = monedas.normalizar(medico?.moneda);
  const dias = diasRestantes(medico, clinica, ahora);
  return {
    activa,
    // De dónde viene la cobertura. La pantalla lo necesita: a un profesional
    // cubierto por su centro no se le puede ofrecer renovar un plan que no
    // es suyo ni avisarle que "su" plan vence — no es suyo, y el que tiene
    // que renovar es el director.
    origen: quien ? quien.origen : "",
    plan: activa ? s.plan : "",
    hasta: activa ? s.hasta : null,
    diasRestantes: dias,
    // Con menos de una semana ya conviene avisarle, no el último día.
    porVencer: activa && dias <= 7,
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
// días a Symphomed y se los sacaría al médico, que es exactamente lo que uno
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
  PLANES, precioMensual, precioDelPlan, vigente, vigenteEn, titularDelPlan,
  diasRestantes, estado, nuevoVencimiento,
};
