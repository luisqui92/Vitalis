// Symphomed — Códigos correlativos por consultorio
//
// Cortos y dictables por teléfono: P-0001 para un paciente, INF-0001 para un
// informe. No son adorno — el código del paciente es lo que el técnico tipea
// en el equipo de imagen para que el estudio se archive solo cuando llega
// (ver routes/cajaDicom.js), y lo que alguien dice cuando llama a preguntar
// por su informe.
//
// ═══ UN CONTADOR, NO UNA CUENTA ════════════════════════════════════════════
//
// Antes se contaba lo que ya había y se miraba que el siguiente no existiera.
// Eso no reserva nada: dos altas a la vez contaban lo mismo y salían las dos
// con P-0001 (revisión integral del 11 de octubre de 2026, S06). Y con dos
// pacientes con el mismo código, la caja DICOM le archivaba el estudio a uno
// cualquiera de los dos.
//
// Ahora cada consultorio tiene un contador por tipo de código (el modelo
// Contador) y sumarle uno es una sola operación atómica: dos pedidos a la vez
// reciben números distintos. Además, el paciente tiene un índice único por
// consultorio y código (db/models.js), que frena lo que se escape.
//
// La primera vez, el contador arranca donde terminan los códigos que ya hay.
// Si igual aparece un código que ya existe (uno puesto antes del contador),
// se saltea.
const { Contador } = require("../db/models");

// Los números de 1 a 5 cifras. El código de emergencia de antes
// (`${prefijo}-` + seis cifras de la hora) no cuenta como el último número: si
// contara, la numeración saltaría a seis cifras para siempre.
const NUMERO = (prefijo) => new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{1,5})$`);

async function ultimoNumero(Modelo, medicoPhone, prefijo) {
  const patron = NUMERO(prefijo);
  const codigos = await Modelo.find({ medicoPhone, codigo: patron }).select("codigo").lean();
  return codigos.reduce((max, d) => Math.max(max, Number(patron.exec(d.codigo)?.[1] || 0)), 0);
}

async function siguienteCodigo(Modelo, medicoPhone, prefijo) {
  const clave = `${Modelo.modelName}:${prefijo}`;
  if (!(await Contador.exists({ medicoPhone, clave }))) {
    const base = await ultimoNumero(Modelo, medicoPhone, prefijo);
    // $max: si otro pedido lo creó recién, no lo hace retroceder.
    await Contador.updateOne({ medicoPhone, clave }, { $max: { valor: base } }, { upsert: true })
      .catch((e) => { if (e?.code !== 11000) throw e; });
  }
  for (let intento = 0; intento < 50; intento++) {
    const { valor } = await Contador.findOneAndUpdate({ medicoPhone, clave }, { $inc: { valor: 1 } }, { new: true, upsert: true }).lean();
    const codigo = `${prefijo}-${String(valor).padStart(4, "0")}`;
    if (!(await Modelo.exists({ medicoPhone, codigo }))) return codigo;
  }
  // Cincuenta seguidos ya usados no pasa con datos sanos: mejor un error que
  // un código repetido.
  throw new Error(`No se pudo dar un código ${prefijo} nuevo: revisá los códigos de este consultorio`);
}

module.exports = { siguienteCodigo, ultimoNumero };
