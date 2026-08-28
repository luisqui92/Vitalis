// Vitalis — Quién puede administrar los pagos.
//
// Vive aparte porque lo necesitan dos archivos: routes/operadorSaldo.js para
// dejar entrar, y routes/recargas.js para saber a quién avisarle cuando un
// médico declara un pago. Duplicar la lista en los dos es cómo terminan
// diciendo cosas distintas.
//
// La lista está en el ENTORNO y no en la base de datos a propósito — ver el
// encabezado de routes/operadorSaldo.js. Vacía por defecto: si alguien
// despliega Vitalis sin configurarla, nadie puede emitir saldo, en vez de que
// pueda cualquiera.
const { log } = require("../config");

const OPERADORES = String(process.env.OPERADORES_SALDO || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Se anuncia al arrancar. Esta lista se lee UNA vez, cuando el módulo se
// carga, así que si el .env se editó después del último reinicio la variable
// está en el archivo y no en el proceso — y desde afuera las dos situaciones
// se ven idénticas: el operador entra y le dicen que no tiene permiso.
//
// Peor todavía: traerEstadoOperador() del frontend convierte CUALQUIER error
// —403, 429, un 500— en "no tenés permiso". Así que ese cartel puede estar
// señalando la causa equivocada. Esta línea en el log es la única forma
// barata de saber qué leyó el proceso que está corriendo ahora mismo.
log.info(OPERADORES.length
  ? `[OPERADORES_SALDO] ${OPERADORES.length} operador(es): ${OPERADORES.join(", ")}`
  : "[OPERADORES_SALDO] vacía — nadie puede aprobar pagos");

function esOperador(phone) {
  return OPERADORES.includes(String(phone));
}

function todosLosOperadores() {
  return [...OPERADORES];
}

module.exports = { esOperador, todosLosOperadores };
