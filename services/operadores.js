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
const OPERADORES = String(process.env.OPERADORES_SALDO || "")
  .split(",").map(s => s.trim()).filter(Boolean);

function esOperador(phone) {
  return OPERADORES.includes(String(phone));
}

function todosLosOperadores() {
  return [...OPERADORES];
}

module.exports = { esOperador, todosLosOperadores };
