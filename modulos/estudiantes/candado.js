// Symphomed — Un candado en la base, para lo que no puede pasar dos veces a
// la vez.
//
// ═══ PARA QUÉ ═══════════════════════════════════════════════════════════════
//
// Dos pedidos que llegan juntos leen lo mismo antes de que cualquiera de los
// dos escriba. Con 19 de 20 prácticas usadas, dos «empezar» simultáneos veían
// los dos «queda una» y creaban dos; con 79 de 80 mensajes, dos preguntas
// juntas pasaban las dos y pagaban dos respuestas de la IA (informe de QA del
// 9 de octubre de 2026, E03 y E04).
//
// El candado hace que el segundo pedido encuentre la puerta cerrada y se
// entere al toque («esperá un momento»), en vez de leer lo mismo que el
// primero. Vive en la base y no en la memoria del proceso: sirve igual con
// varios servidores.
//
// Si el proceso se cae con el candado puesto, vence solo (ms), y su dueño
// solo puede abrir el suyo: si tardó tanto que venció y otro lo tomó, no le
// abre la puerta a ese otro.
const crypto = require("crypto");
const { Candado } = require("./modelos");
const { ErrorHttp } = require("../../services/httpHelpers");

async function conCandado(clave, mensajeOcupado, fn, { ms = 60000 } = {}) {
  // El candado ES el índice único de la clave: hasta que existe, dos pedidos
  // podrían tomar el mismo. Mongoose lo crea al arrancar; la primera vez se
  // espera a que esté (las siguientes, esto ya está resuelto).
  await Candado.init();
  const ahora = new Date();
  const dueno = crypto.randomBytes(8).toString("hex");
  try {
    // Libre (o vencido): se toma. Tomado: el upsert choca con el índice único
    // de la clave, y eso quiere decir «ocupado».
    await Candado.findOneAndUpdate(
      { clave, hasta: { $lt: ahora } },
      { $set: { hasta: new Date(ahora.getTime() + ms), dueno } },
      { upsert: true });
  } catch (e) {
    if (e?.code === 11000) throw new ErrorHttp(409, mensajeOcupado);
    throw e;
  }
  try {
    return await fn();
  } finally {
    await Candado.updateOne({ clave, dueno }, { $set: { hasta: new Date(0) } }).catch(() => {});
  }
}

// La otra mitad: un pedido que llega dos veces, no a la vez sino uno después
// del otro (se cortó la conexión antes de la respuesta y la pantalla lo
// repite). La pantalla manda una clave por pedido; si ya se hizo, se
// devuelve lo hecho en vez de hacerlo otra vez. Una clave rara se ignora: el
// pedido sigue, sin esa protección.
function claveDelPedido(req) {
  const clave = String(req.body?.clave || "").trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(clave) ? clave : "";
}

module.exports = { conCandado, claveDelPedido };
