// Symphomed — El teléfono de una cuenta, escrito como sea.
//
// El teléfono es la identidad del médico en toda la base (ver
// scripts/cambiar_telefono.js), y hasta ahora se guardaba tal cual se
// escribió al registrarse. Caso real: una médica de Brasil se registró con
// «++5511956544830» y después no podía entrar escribiendo «+5511956544830».
// Los avisos por WhatsApp a ese número tampoco salían: Meta quiere dígitos.
//
// La regla, la misma que ya seguían los scripts: se GUARDA solo con dígitos.
// Y al BUSCAR se acepta como venga —con «+», con «++», con espacios o
// guiones—, porque las cuentas viejas quedaron guardadas de varias formas y
// el médico no tiene por qué saber de cuál es la suya.

// «+55 (11) 95654-4830» → «5511956544830».
function soloDigitos(texto) {
  return String(texto || "").replace(/\D/g, "");
}

// Cómo puede estar guardada una cuenta que alguien escribe así: tal cual
// (las de demostración tienen «-01», y alguna vieja puede tener «+»), solo
// dígitos, y dígitos con «+».
function formasDe(texto) {
  const tal = String(texto || "").trim();
  const d = soloDigitos(tal);
  return [...new Set([tal, d, d ? "+" + d : ""].filter(Boolean))];
}

// La cuenta de ese teléfono. Si por un registro viejo hubiera dos (una con
// «+» y otra sin), gana la que está escrita EXACTAMENTE igual, y si no, la
// de solo dígitos: nunca se elige al azar.
async function buscarPorTelefono(Modelo, texto, { select, lean } = {}) {
  const formas = formasDe(texto);
  if (!formas.length) return null;
  let q = Modelo.find({ phone: { $in: formas } }).limit(formas.length);
  if (select) q = q.select(select.includes("phone") ? select : select + " phone");
  if (lean) q = q.lean();
  const encontradas = await q;
  for (const forma of formas) {
    const c = encontradas.find(x => x.phone === forma);
    if (c) return c;
  }
  return null;
}

module.exports = { soloDigitos, formasDe, buscarPorTelefono };
