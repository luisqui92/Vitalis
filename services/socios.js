// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Socios: quién ve qué, y cuántos cupos le quedan
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══ LA REGLA, EN UN SOLO LUGAR ════════════════════════════════════════════
//
// UN SOCIO VE SOLO LO QUE ÉL VENDIÓ. Ni las cuentas de otro socio, ni las
// que Symphomed vendió directo.
//
// Está acá y no repartida por las rutas por la misma razón que la del equipo
// de neurodesarrollo: una regla de acceso copiada en once rutas se afloja en
// la número doce, y esa doce es la que filtra la cartera de clientes de un
// socio a su competencia. Si alguna ruta necesita saber qué puede tocar un
// socio, pregunta acá.
//
// ═══ 404 Y NO 403 ══════════════════════════════════════════════════════════
//
// Mismo criterio que equipoNeuro.js: cuando un socio pide una cuenta que no
// es suya, la respuesta es "no existe" y no "no tenés permiso". Un 403
// confirma que la cuenta existe, y para un competidor eso ya es información
// de negocio: le dice que ese cliente está en Symphomed y con quién.
const { Socio, Clinica, Medico, LoteCupos } = require("../db/models");
const { ErrorHttp } = require("./httpHelpers");

// ─── QUÉ CUENTAS SON DE ESTE SOCIO ────────────────────────────────────────
// El filtro de Mongo, para que ninguna ruta lo arme a mano.
function filtroDelSocio(socioId) {
  return { socioId };
}

// Una clínica que tiene que ser de este socio, o no existe.
async function clinicaDelSocio(socioId, clinicaId) {
  const clinica = await Clinica.findOne({ _id: clinicaId, socioId });
  if (!clinica) throw new ErrorHttp(404, "Esa cuenta no existe");
  return clinica;
}

// Un profesional que tiene que ser de este socio, o no existe.
async function medicoDelSocio(socioId, phone) {
  const medico = await Medico.findOne({ phone, socioId });
  if (!medico) throw new ErrorHttp(404, "Esa cuenta no existe");
  return medico;
}

// ═══ LOS CUPOS ═════════════════════════════════════════════════════════════
//
// Un cupo es el derecho a tener UNA cuenta activa. El socio compra lotes y
// los gasta dando de alta clientes.
//
// ═══ QUÉ CUENTA COMO CUPO USADO, Y QUÉ NO ══════════════════════════════════
//
// Solo lo ACTIVO. Una clínica dada de baja o un profesional desactivado
// devuelven su cupo, y es lo correcto: el socio dejó de cobrarle a ese
// cliente, no tiene por qué seguir pagándolo.
//
// Pero ojo con la trampa que eso abre: si el cupo se liberara al instante,
// un socio podría desactivar a fin de mes, no pagar, y reactivar al día
// siguiente. Por eso la baja la registra Symphomed (el operador) y no el
// socio: él pide la baja, no la ejecuta. Ver routes/socio.js.
async function cuposDe(socioId) {
  const [lotes, clinicas, medicos] = await Promise.all([
    LoteCupos.find({ socioId }).sort({ fecha: -1 }).limit(500).lean(),
    Clinica.countDocuments({ socioId, activa: true }),
    // Un médico que pertenece a una clínica NO gasta un cupo propio: el cupo
    // lo gastó la clínica. Si no, un centro de seis profesionales consumiría
    // siete cupos y el socio estaría pagando de más por el mismo cliente.
    Medico.countDocuments({ socioId, activo: true, clinicaId: null }),
  ]);

  const comprados = lotes.reduce((a, l) => a + (l.cantidad || 0), 0);
  const usados = clinicas + medicos;
  const invertidoCentavos = lotes.reduce((a, l) => a + (l.cantidad || 0) * (l.precioUnitarioCentavos || 0), 0);

  return {
    comprados,
    usados,
    // Puede dar negativo si alguien dio de alta más cuentas de las que
    // compró. No se fuerza a cero a propósito: un disponible en −3 es
    // exactamente lo que hay que ver en pantalla, y taparlo con un cero
    // esconde el problema justo cuando hay que cobrarlo.
    disponibles: comprados - usados,
    porClinicas: clinicas,
    porProfesionales: medicos,
    invertidoCentavos,
    lotes: lotes.slice(0, 50),
  };
}

// Antes de dar de alta: ¿le queda cupo? Se pregunta siempre, incluso cuando
// la pantalla ya lo mostró — la pantalla puede tener el número viejo, y dos
// altas simultáneas con un solo cupo disponible pasarían las dos.
async function exigirCupoLibre(socioId) {
  const { disponibles } = await cuposDe(socioId);
  if (disponibles <= 0) {
    throw new ErrorHttp(402, "No te quedan cupos disponibles. Comprá más para dar de alta otra cuenta.");
  }
}

// ─── EL SOCIO DEL PEDIDO ──────────────────────────────────────────────────
// Sale del token y NUNCA del cuerpo del pedido. Un socioId que venga del
// cliente es, literalmente, elegir de quién ver la cartera.
async function socioDeLaSesion(req) {
  const socio = await Socio.findById(req.socioId);
  if (!socio || !socio.activo) throw new ErrorHttp(403, "Tu cuenta de socio no está activa");
  return socio;
}

module.exports = {
  filtroDelSocio, clinicaDelSocio, medicoDelSocio,
  cuposDe, exigirCupoLibre, socioDeLaSesion,
};
