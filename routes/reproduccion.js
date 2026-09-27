// Symphomed Ganadería — reproducción: las hembras de un lote (vacas,
// cerdas) y su historia reproductiva. Los cálculos —estado, fecha de parto,
// alertas— viven en services/reproduccion.js; acá solo se guarda lo que
// pasó y se valida que tenga sentido.
const mongoose = require("mongoose");
const { LoteGanado, AnimalGanado, EventoReproductivo, TIPOS_EVENTO_REPRODUCTIVO, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { resumenHembra, resumenLote } = require("../services/reproduccion");

const requireMedico = requireAuth(["medico"]);
const ESPECIES_CON_REPRODUCCION = ["bovino", "porcino"];

function idValido(id, que) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(404, `${que} no encontrado`);
}

// Un evento reproductivo con fecha futura es un error de tipeo — un parto
// "del mes que viene" correría la fecha probable del próximo y todas las
// alertas detrás. Se deja un día de margen por la diferencia de huso
// horario entre el celular y el servidor.
function fechaDelEvento(valor) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) throw new ErrorHttp(400, "fecha no es una fecha válida");
  if (fecha.getTime() > Date.now() + 86400000) throw new ErrorHttp(400, "La fecha no puede ser futura");
  return fecha;
}

function fechaOpcional(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new ErrorHttp(400, "fechaNacimiento no es una fecha válida");
  return fecha;
}

// Entero ≥ 0 o null. Cero crías vivas es un dato real (un parto con todas
// muertas), y no puede confundirse con "no se anotó".
function conteoOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) throw new ErrorHttp(400, `${campo} debe ser un número entero, 0 o más`);
  return n;
}

module.exports = function (app) {
  // ─── HEMBRAS DE UN LOTE, con su estado y el resumen del lote ───────────
  app.get("/medico/lotes/:id/animales", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const [animales, eventos] = await Promise.all([
      AnimalGanado.find({ loteId: lote._id, medicoPhone }).sort({ activa: -1, identificador: 1 }).lean(),
      EventoReproductivo.find({ loteId: lote._id, medicoPhone }).lean(),
    ]);
    // Una sola consulta para todos los eventos del lote, repartidos acá:
    // con 200 vacas, pedirlos animal por animal serían 200 idas a la base.
    const porAnimal = new Map();
    for (const e of eventos) {
      const k = String(e.animalId);
      if (!porAnimal.has(k)) porAnimal.set(k, []);
      porAnimal.get(k).push(e);
    }
    const ahora = new Date();
    const lista = animales.map(a => ({
      ...a,
      reproduccion: resumenHembra(a, porAnimal.get(String(a._id)) || [], ahora),
    }));
    const resumen = resumenLote(lista.map(a => ({
      ...a.reproduccion, animalId: a._id, identificador: a.identificador, activa: a.activa,
    })), ahora);
    res.json({ animales: lista, resumen });
  }));

  // ─── AGREGAR UNA HEMBRA AL LOTE ─────────────────────────────────────────
  app.post("/medico/lotes/:id/animales", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    if (!ESPECIES_CON_REPRODUCCION.includes(lote.especie)) {
      throw new ErrorHttp(400, "El seguimiento reproductivo es para bovinos y porcinos");
    }
    if (lote.estado === "cerrado") throw new ErrorHttp(400, "El lote está cerrado");
    const identificador = String(req.body?.identificador || "").trim();
    if (!identificador) throw new ErrorHttp(400, "identificador es requerido (arete, caravana o número)");

    try {
      const animal = await AnimalGanado.create({
        medicoPhone, loteId: lote._id, especie: lote.especie, identificador,
        nombre: String(req.body?.nombre || "").trim(),
        raza: String(req.body?.raza || "").trim(),
        fechaNacimiento: fechaOpcional(req.body?.fechaNacimiento),
        notas: String(req.body?.notas || "").trim(),
      });
      res.status(201).json({ ok: true, animal });
    } catch (e) {
      if (e.code === 11000) throw new ErrorHttp(409, `Ya hay un animal con el identificador «${identificador}» en este lote`);
      throw e;
    }
  }));

  // ─── FICHA DE UNA HEMBRA ────────────────────────────────────────────────
  app.get("/medico/animales/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Animal");
    const animal = await obtenerOFallar(AnimalGanado, { _id: req.params.id, medicoPhone }, "Animal no encontrado");
    const [eventos, lote] = await Promise.all([
      EventoReproductivo.find({ animalId: animal._id, medicoPhone }).sort({ fecha: -1 }).lean(),
      LoteGanado.findOne({ _id: animal.loteId, medicoPhone }).select("codigo nombre estado").lean(),
    ]);
    res.json({ animal, lote, eventos, reproduccion: resumenHembra(animal, eventos) });
  }));

  // ─── DAR DE BAJA (vendida, muerta, descartada) ──────────────────────────
  app.patch("/medico/animales/:id/baja", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Animal");
    const animal = await obtenerOFallar(AnimalGanado, { _id: req.params.id, medicoPhone }, "Animal no encontrado");
    if (!animal.activa) throw new ErrorHttp(400, "El animal ya estaba dado de baja");
    animal.activa = false;
    animal.fechaBaja = new Date();
    animal.motivoBaja = String(req.body?.motivo || "").trim();
    await animal.save();
    res.json({ ok: true, animal });
  }));

  // ─── REGISTRAR UN EVENTO REPRODUCTIVO ───────────────────────────────────
  app.post("/medico/animales/:id/eventos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Animal");
    const animal = await obtenerOFallar(AnimalGanado, { _id: req.params.id, medicoPhone }, "Animal no encontrado");
    if (!animal.activa) throw new ErrorHttp(400, "No se pueden cargar eventos en un animal dado de baja");

    const tipo = String(req.body?.tipo || "").trim();
    if (!TIPOS_EVENTO_REPRODUCTIVO.includes(tipo)) {
      throw new ErrorHttp(400, `tipo debe ser uno de: ${TIPOS_EVENTO_REPRODUCTIVO.join(", ")}`);
    }
    const datos = {
      medicoPhone, animalId: animal._id, loteId: animal.loteId, tipo,
      fecha: fechaDelEvento(req.body?.fecha),
      notas: String(req.body?.notas || "").trim(),
    };

    if (tipo === "servicio") {
      const metodo = String(req.body?.metodo || "").trim();
      if (metodo && !["monta", "inseminacion"].includes(metodo)) throw new ErrorHttp(400, "metodo debe ser monta o inseminacion");
      datos.metodo = metodo;
      datos.reproductor = String(req.body?.reproductor || "").trim();
    } else if (tipo === "diagnostico") {
      const resultado = String(req.body?.resultado || "").trim();
      if (!["prenada", "vacia"].includes(resultado)) throw new ErrorHttp(400, "resultado debe ser prenada o vacia");
      datos.resultado = resultado;
    } else if (tipo === "parto") {
      datos.criasVivas = conteoOpcional(req.body?.criasVivas, "criasVivas");
      datos.criasMuertas = conteoOpcional(req.body?.criasMuertas, "criasMuertas");
    } else if (tipo === "destete") {
      datos.criasDestetadas = conteoOpcional(req.body?.criasDestetadas, "criasDestetadas");
    }

    const medico = await Medico.findOne({ phone: medicoPhone }).select("nombre").lean();
    datos.registradoPor = medico?.nombre || "";
    const evento = await EventoReproductivo.create(datos);

    const eventos = await EventoReproductivo.find({ animalId: animal._id, medicoPhone }).lean();
    res.status(201).json({ ok: true, evento, reproduccion: resumenHembra(animal, eventos) });
  }));
};
