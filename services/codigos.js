// Symphomed — Códigos correlativos por consultorio
//
// Cortos y dictables por teléfono: P-0001 para un paciente, INF-0001 para un
// informe. No son adorno — el código del paciente es lo que el técnico tipea
// en el equipo de imagen para que el estudio se archive solo cuando llega
// (ver routes/cajaDicom.js), y lo que alguien dice cuando llama a preguntar
// por su informe.
//
// Se cuenta lo que ya hay en vez de guardar un contador aparte: con los
// volúmenes de un consultorio es instantáneo, y no hay un número que se
// pueda desincronizar de la realidad.
//
// Se cuentan los que YA TIENEN código, no todos los documentos: al paciente
// el código se le puede poner cuando ya está guardado en la base, y contarlo
// a él también haría que el primero fuera P-0002.
async function siguienteCodigo(Modelo, medicoPhone, prefijo) {
  const cuantos = await Modelo.countDocuments({ medicoPhone, codigo: { $nin: [null, ""] } });
  for (let intento = 0; intento < 50; intento++) {
    const codigo = `${prefijo}-${String(cuantos + 1 + intento).padStart(4, "0")}`;
    const existe = await Modelo.findOne({ medicoPhone, codigo }).lean();
    if (!existe) return codigo;
  }
  // Si después de 50 intentos sigue chocando, algo raro pasa: mejor un
  // código feo pero único que un error en la cara del médico.
  return `${prefijo}-${Date.now().toString().slice(-6)}`;
}

module.exports = { siguienteCodigo };
