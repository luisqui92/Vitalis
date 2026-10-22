// Plan educativo: no concede permisos profesionales ni requiere invitaciones.
const { Medico } = require("../../db/models");
const monedas = require("../../services/monedas");
const { ErrorHttp } = require("../../services/httpHelpers");
const { registrar } = require("../../services/auditoria");
const { NIVELES } = require("./cuenta");
function oferta(m) {
  const nivel = m.estudiante.nivel, moneda = monedas.normalizar(m.moneda);
  const defecto = moneda === "BOB" ? (nivel === "residente" ? 15000 : 10000) : NIVELES[nivel].precio.BRL;
  const configurado = Number(process.env[`PLAN_EDUCATIVO_${nivel.toUpperCase()}_${moneda}`]);
  const mensual = Number.isSafeInteger(configurado) && configurado > 0 ? configurado : defecto;
  return { mensual, anual: mensual * 11, mensualTexto: monedas.conSimbolo(mensual, moneda),
    anualTexto: monedas.conSimbolo(mensual * 11, moneda), mesesGratis: 1 };
}
function estado({ medico, ahora = new Date() }) {
  if (!medico?.estudiante?.nivel) return {};
  const prueba = Boolean(medico.estudiante.prueba?.activa);
  const hasta = medico.estudiante.hasta, activa = !prueba && Boolean(hasta && new Date(hasta) > ahora);
  const diasRestantes = activa ? Math.ceil((new Date(hasta) - ahora) / 86400000) : 0;
  return { suscripcion: { tipo: "educativo", activa, prueba, origen: activa ? "propio" : "", plan: activa ? medico.suscripcion?.plan || "mensual" : "",
    hasta, diasRestantes, porVencer: activa && diasRestantes <= 7, precios: oferta(medico), horasMes: NIVELES[medico.estudiante.nivel].horasMes } };
}
async function activar(ctx) {
  const { medico, plan, referencia, quien, req } = ctx;
  if (!medico.estudiante?.nivel) return;
  if (!["mensual", "anual"].includes(plan) || !referencia) throw new ErrorHttp(400, "Indicá el plan y la referencia del pago verificado.");
  if (medico.activo === false) throw new ErrorHttp(409, "La cuenta está desactivada.");
  const renovacion = !medico.estudiante.prueba?.activa && new Date(medico.estudiante.hasta) > new Date();
  const desde = new Date(), hasta = renovacion ? new Date(medico.estudiante.hasta) : new Date(desde);
  hasta.setMonth(hasta.getMonth() + (plan === "anual" ? 12 : 1));
  const precioCentavos = oferta(medico)[plan], moneda = monedas.normalizar(medico.moneda);
  const r = await Medico.updateOne({ _id: medico._id, "estudiante.nivel": medico.estudiante.nivel,
    "estudiante.hasta": medico.estudiante.hasta, "estudiante.pagosReferencias": { $ne: referencia } }, {
    $set: { "estudiante.hasta": hasta, "estudiante.horasMes": NIVELES[medico.estudiante.nivel].horasMes,
      "estudiante.prueba.activa": false,
      suscripcion: { ambito: "educativo", plan, desde, hasta, precioCentavos, moneda, activadaPor: quien } },
    $push: { "estudiante.pagosReferencias": referencia },
  });
  if (!r.modifiedCount) throw new ErrorHttp(409, "Este pago ya se aplicó o cambió la cuenta. Actualizá el panel.");
  registrar({ req, medicoPhone: quien, accion: "plan_educativo_activado", recurso: `Medico:${medico.phone}`,
    detalle: `${plan} · ${precioCentavos} ${moneda} · ref ${referencia}` });
  ctx.respuesta = { ok: true, plan, renovacion, hasta, precioCentavos, precioTexto: monedas.conSimbolo(precioCentavos, moneda),
    medico: { phone: medico.phone, nombre: medico.nombre } };
}
function montar(extensiones) {
  extensiones.enganchar("suscripcion.estado", estado);
  extensiones.enganchar("suscripcion.activar", activar);
}
module.exports = { oferta, estado, activar, montar };
