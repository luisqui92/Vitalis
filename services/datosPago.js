// Vitalis — A dónde paga el médico.
//
// Sale del entorno porque cambia por despliegue y no es código: la cuenta de
// Bolivia no es la de Brasil, y el día que cambie el banco no se toca un
// archivo fuente ni se vuelve a desplegar nada.
//
//   PAGO_QR_IMAGEN=/pago-qr.png          (archivo en public/, opcional)
//   PAGO_BANCO=Banco BCP
//   PAGO_CUENTA=201-5012345-3-45
//   PAGO_TITULAR=Luis Quiroga
//   PAGO_DOCUMENTO=1234567 SC
//   PAGO_WHATSAPP=59162741818            (a dónde manda el comprobante)
//
// Si no hay NADA configurado, la pantalla se lo dice al médico en vez de
// mostrarle una tarjeta vacía y dejarlo adivinando dónde pagar.
function datosDePago() {
  const qr = String(process.env.PAGO_QR_IMAGEN || "").trim();
  const banco = String(process.env.PAGO_BANCO || "").trim();
  const cuenta = String(process.env.PAGO_CUENTA || "").trim();
  const titular = String(process.env.PAGO_TITULAR || "").trim();
  const documento = String(process.env.PAGO_DOCUMENTO || "").trim();
  const whatsapp = String(process.env.PAGO_WHATSAPP || "").replace(/\D/g, "");

  return {
    qr, banco, cuenta, titular, documento, whatsapp,
    // Con esto la pantalla decide si mostrar la tarjeta o el aviso de que
    // todavía no hay dónde pagar.
    configurado: Boolean(qr || (banco && cuenta)),
  };
}

module.exports = { datosDePago };
