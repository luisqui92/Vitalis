// Vitalis — A dónde le paga el médico a Vitalis.
//
// ═══ POR QUÉ ESTO NO VIVE SOLO EN EL .env ══════════════════════════════════
//
// Son datos que cambian: se abre otra cuenta, cambia el titular, se agrega un
// WhatsApp. Pedirle a alguien que entre por SSH, edite un archivo y reinicie
// el servidor para corregir un número de cuenta es la mejor forma de
// garantizar que ese número quede desactualizado — y un número de cuenta
// desactualizado significa pagos que se pierden.
//
// Así que la fuente principal es la base de datos, editable desde la pantalla
// de Pagos. El .env queda como respaldo para el primer arranque, cuando
// todavía no hay nada cargado.
//
//   PAGO_QR_IMAGEN=/pago-qr.jpg          (archivo en public/, opcional)
//   PAGO_BANCO / PAGO_CUENTA / PAGO_TITULAR / PAGO_DOCUMENTO / PAGO_WHATSAPP
//
// El QR sigue siendo un archivo y no un campo: es una imagen, y subir
// archivos desde el navegador es una superficie que no vale la pena abrir
// para algo que se cambia una vez cada varios años. Si el archivo está donde
// se espera, se usa solo.
const fs = require("fs");
const path = require("path");
const { ConfigPago } = require("../db/models");

const QR_POR_DEFECTO = ["/pago-qr.jpg", "/pago-qr.png"]
  .find(rel => fs.existsSync(path.join(__dirname, "..", "public", rel))) || "";

function delEntorno() {
  return {
    banco: String(process.env.PAGO_BANCO || "").trim(),
    cuenta: String(process.env.PAGO_CUENTA || "").trim(),
    titular: String(process.env.PAGO_TITULAR || "").trim(),
    documento: String(process.env.PAGO_DOCUMENTO || "").trim(),
    whatsapp: String(process.env.PAGO_WHATSAPP || "").replace(/\D/g, ""),
  };
}

// Lo que ve el médico. Gana lo que esté cargado en la base; si un campo está
// vacío ahí, se cae al .env — así una instalación que ya tenía todo en el
// entorno sigue funcionando igual hasta que alguien lo edite por pantalla.
async function datosDePago() {
  let guardado = null;
  try {
    guardado = await ConfigPago.findOne({ clave: "unico" }).lean();
  } catch {
    // Que falle esta consulta no puede dejar sin pantalla de recarga a nadie:
    // se sigue con lo del entorno.
  }
  const env = delEntorno();
  const tomar = (campo) => String(guardado?.[campo] || env[campo] || "").trim();

  const qr = String(process.env.PAGO_QR_IMAGEN || QR_POR_DEFECTO).trim();
  const banco = tomar("banco");
  const cuenta = tomar("cuenta");
  const titular = tomar("titular");
  const documento = tomar("documento");
  const whatsapp = tomar("whatsapp").replace(/\D/g, "");

  return {
    qr, banco, cuenta, titular, documento, whatsapp,
    // Con esto la pantalla decide si mostrar la tarjeta o avisar que todavía
    // no hay dónde pagar, en vez de dejar al médico adivinando.
    configurado: Boolean(qr || (banco && cuenta)),
  };
}

// Lo guarda un operador desde la pantalla de Pagos.
async function guardarDatosDePago(campos, quien) {
  const limpio = {
    banco: String(campos.banco || "").trim().slice(0, 80),
    cuenta: String(campos.cuenta || "").trim().slice(0, 60),
    titular: String(campos.titular || "").trim().slice(0, 80),
    documento: String(campos.documento || "").trim().slice(0, 40),
    whatsapp: String(campos.whatsapp || "").replace(/\D/g, "").slice(0, 20),
    actualizadoPor: quien,
  };
  await ConfigPago.findOneAndUpdate({ clave: "unico" }, { $set: limpio }, { upsert: true, new: true });
  return datosDePago();
}

module.exports = { datosDePago, guardarDatosDePago };
