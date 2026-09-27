// Symphomed Ganadería — lotes de producción animal (bovino, porcino,
// avícola). La unidad de trabajo es el grupo, no el animal individual: ver
// el comentario sobre LoteGanado en db/models.js para por qué esto es un
// modelo aparte de Paciente, y no una extensión de la veterinaria de
// mascotas que ya existía.
const express = require("express");
const { LoteGanado, EventoLote, NotaVozLote, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { siguienteCodigo } = require("../services/codigos");
const { mortalidadAcumulada, retirosVigentes, curvaPeso } = require("../services/lotesGanado");
const { notificarRetiroRegistrado } = require("../services/alertaRetiroGanado");
const { transcribirNotaDeVoz } = require("../services/assemblyai");
const { generarEventosLote, crearEventosDesdeSugerencias } = require("../services/notaVozLote");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);
const audioRaw = express.raw({ type: "audio/*", limit: "80mb" });
const ESPECIES = ["bovino", "porcino", "avicola"];
const TIPOS_EVENTO = ["mortalidad", "vacunacion", "tratamiento", "pesaje"];

function fechaRequerida(valor, campo) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) throw new ErrorHttp(400, `${campo} no es una fecha válida`);
  return fecha;
}

// Un número entero opcional: si no viene, o viene vacío, queda en null (no
// en 0) — 0 días de retiro es un dato real (algo sin período de resguardo),
// y confundirlo con "no se cargó" escondería justo el caso que hay que decir.
function enteroOpcional(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

module.exports = function (app) {
  // ─── CREAR LOTE ─────────────────────────────────────────────────────────
  app.post("/medico/lotes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const especie = String(req.body?.especie || "").trim();
    if (!ESPECIES.includes(especie)) throw new ErrorHttp(400, `especie debe ser una de: ${ESPECIES.join(", ")}`);
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");
    const cantidadInicial = Number(req.body?.cantidadInicial);
    if (!Number.isFinite(cantidadInicial) || cantidadInicial < 1) {
      throw new ErrorHttp(400, "cantidadInicial debe ser un número mayor a 0");
    }
    const fechaIngreso = fechaRequerida(req.body?.fechaIngreso, "fechaIngreso");
    const proposito = String(req.body?.proposito || "").trim();
    const ubicacion = String(req.body?.ubicacion || "").trim();
    const notas = String(req.body?.notas || "").trim();

    const codigo = await siguienteCodigo(LoteGanado, medicoPhone, "L");
    const lote = await LoteGanado.create({
      medicoPhone, codigo, especie, nombre, proposito, ubicacion, notas,
      cantidadInicial, cantidadActual: cantidadInicial, fechaIngreso,
    });
    res.status(201).json({ ok: true, lote });
  }));

  // ─── LISTAR LOTES PROPIOS ───────────────────────────────────────────────
  app.get("/medico/lotes", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const filtro = { medicoPhone };
    if (req.query.estado === "activo" || req.query.estado === "cerrado") filtro.estado = req.query.estado;
    const lotes = await LoteGanado.find(filtro).sort({ createdAt: -1 }).lean();
    res.json({ lotes });
  }));

  // ─── DETALLE: eventos, mortalidad acumulada, retiros vigentes y curva ──
  // Se trae todo junto, mismo criterio que /medico/pacientes/:id: que abrir
  // un lote no dispare cuatro pedidos al servidor.
  app.get("/medico/lotes/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const eventos = await EventoLote.find({ loteId: lote._id, medicoPhone }).sort({ fecha: -1 }).lean();

    res.json({
      lote,
      eventos,
      mortalidad: mortalidadAcumulada(lote, eventos),
      retirosVigentes: retirosVigentes(eventos),
      curvaPeso: curvaPeso(eventos),
    });
  }));

  // ─── CERRAR LOTE (vendido, faenado, trasladado) ─────────────────────────
  app.patch("/medico/lotes/:id/cerrar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    if (lote.estado === "cerrado") throw new ErrorHttp(400, "El lote ya está cerrado");
    lote.estado = "cerrado";
    lote.fechaCierre = new Date();
    lote.motivoCierre = String(req.body?.motivoCierre || "").trim();
    await lote.save();
    res.json({ ok: true, lote });
  }));

  // ─── REGISTRAR EVENTO (mortalidad, vacunación, tratamiento, pesaje) ─────
  // Un evento por carga, para TODO el lote — no uno por animal. Es como se
  // trabaja en campo: nadie anota 8.000 líneas para vacunar un galpón.
  app.post("/medico/lotes/:id/eventos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    if (lote.estado === "cerrado") throw new ErrorHttp(400, "No se pueden cargar eventos en un lote cerrado");

    const tipo = String(req.body?.tipo || "").trim();
    if (!TIPOS_EVENTO.includes(tipo)) throw new ErrorHttp(400, `tipo debe ser uno de: ${TIPOS_EVENTO.join(", ")}`);
    const fecha = fechaRequerida(req.body?.fecha, "fecha");
    const notas = String(req.body?.notas || "").trim();
    const registradoPor = String(req.body?.registradoPor || "").trim();

    const datos = { medicoPhone, loteId: lote._id, tipo, fecha, notas, registradoPor };
    let debeGuardarLote = false;

    if (tipo === "mortalidad") {
      const cantidadMuertes = Number(req.body?.cantidadMuertes);
      if (!Number.isFinite(cantidadMuertes) || cantidadMuertes < 1) {
        throw new ErrorHttp(400, "cantidadMuertes debe ser un número mayor a 0");
      }
      // No se puede reportar más muertes que animales vivos en el lote —
      // eso sería un error de carga, no un dato real.
      if (cantidadMuertes > lote.cantidadActual) {
        throw new ErrorHttp(400, `El lote solo tiene ${lote.cantidadActual} animales activos`);
      }
      datos.cantidadMuertes = cantidadMuertes;
      datos.causaPresunta = String(req.body?.causaPresunta || "").trim();
      lote.cantidadActual -= cantidadMuertes;
      debeGuardarLote = true;
    } else if (tipo === "vacunacion" || tipo === "tratamiento") {
      datos.producto = String(req.body?.producto || "").trim();
      if (!datos.producto) throw new ErrorHttp(400, "producto es requerido");
      datos.dosis = String(req.body?.dosis || "").trim();
      datos.viaAplicacion = String(req.body?.viaAplicacion || "").trim();
      const cantidadAplicada = Number(req.body?.cantidadAplicada);
      // Por defecto se asume que se llegó a todo el lote vivo — es lo que
      // pasa la mayoría de las veces, y el veterinario corrige el número
      // solo cuando de verdad no alcanzó a todos.
      datos.cantidadAplicada = Number.isFinite(cantidadAplicada) && cantidadAplicada >= 0
        ? cantidadAplicada : lote.cantidadActual;
      datos.diasRetiroCarne = enteroOpcional(req.body?.diasRetiroCarne);
      datos.diasRetiroLeche = enteroOpcional(req.body?.diasRetiroLeche);
    } else if (tipo === "pesaje") {
      const tamanoMuestra = Number(req.body?.tamanoMuestra);
      const pesoPromedioKg = Number(req.body?.pesoPromedioKg);
      if (!Number.isFinite(tamanoMuestra) || tamanoMuestra < 1) {
        throw new ErrorHttp(400, "tamanoMuestra debe ser un número mayor a 0");
      }
      if (!Number.isFinite(pesoPromedioKg) || pesoPromedioKg <= 0) {
        throw new ErrorHttp(400, "pesoPromedioKg debe ser un número mayor a 0");
      }
      datos.tamanoMuestra = tamanoMuestra;
      datos.pesoPromedioKg = pesoPromedioKg;
    }

    const evento = await EventoLote.create(datos);
    if (debeGuardarLote) await lote.save();

    // Fuera del camino de la respuesta: si WhatsApp falla, el evento ya
    // quedó guardado igual — mismo criterio que la confirmación de cita en
    // routes/citas.js. El médico ve la fecha de retiro en la ficha aunque
    // este mensaje no llegue.
    if (evento.diasRetiroCarne != null || evento.diasRetiroLeche != null) {
      Medico.findOne({ phone: medicoPhone }).select("phone nombre idioma moneda").lean()
        .then(medico => medico && notificarRetiroRegistrado(evento, lote, medico))
        .catch(e => log.error(`[LOTES_GANADO] no se pudo avisar el retiro registrado (evento ${evento._id}):`, e.message));
    }

    res.status(201).json({ ok: true, evento, lote });
  }));

  // ─── DICTADO DE CAMPO: audio → transcripción → eventos reales ──────────
  // Mismo patrón que POST /medico/consultas (routes/consultaMedica.js): se
  // responde al toque con la nota en "procesando" y todo lo que tarda —
  // transcribir, pedirle a la IA que separe los eventos, crearlos— sigue
  // en segundo plano. El médico ya guardó el celular para cuando esto
  // termina; por eso el resultado se consulta con el GET de abajo, no en
  // esta misma respuesta.
  app.post("/medico/lotes/:id/notas-voz", limitMedico, requireMedico, audioRaw, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const audioBuffer = req.body;
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new ErrorHttp(400, "Falta el audio (Content-Type debe ser audio/*)");
    }
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    if (lote.estado === "cerrado") throw new ErrorHttp(400, "No se pueden cargar eventos en un lote cerrado");

    const nota = await NotaVozLote.create({ medicoPhone, loteId: lote._id, estado: "procesando" });
    res.status(202).json({ ok: true, nota });

    const medico = await Medico.findOne({ phone: medicoPhone }).select("phone nombre idioma tipoEspecialidad moneda").lean();

    transcribirNotaDeVoz(audioBuffer, medico?.tipoEspecialidad, medico?.idioma)
      .then(async ({ texto, duracionSegundos }) => {
        nota.transcripcionCompleta = texto;
        nota.duracionSegundos = duracionSegundos;

        const { eventos } = await generarEventosLote(texto, medico?.idioma);
        // El propio lote pudo cerrarse mientras esto corría en segundo
        // plano (el médico lo cerró desde otra pestaña) — no se le agregan
        // eventos a algo que ya se dio por terminado.
        const loteFresco = await LoteGanado.findById(lote._id);
        const creados = (loteFresco && loteFresco.estado !== "cerrado")
          ? await crearEventosDesdeSugerencias(loteFresco, eventos, { registradoPor: medico?.nombre || "" })
          : [];

        nota.eventosCreados = creados.map(e => e._id);
        nota.estado = "completado";
        await nota.save();

        for (const evento of creados) {
          if ((evento.diasRetiroCarne != null || evento.diasRetiroLeche != null) && medico) {
            notificarRetiroRegistrado(evento, loteFresco, medico)
              .catch(e => log.error(`[NOTA_VOZ_LOTE] no se pudo avisar el retiro registrado (evento ${evento._id}):`, e.message));
          }
        }
      })
      .catch(async (e) => {
        log.error(`[NOTA_VOZ_LOTE] no se pudo procesar la nota ${nota._id}:`, e.message);
        await NotaVozLote.updateOne({ _id: nota._id }, { $set: { estado: "error", errorMensaje: e.message } });
      });
  }));

  // ─── CONSULTAR EL ESTADO DE UNA NOTA DE VOZ (polling) ──────────────────
  app.get("/medico/notas-voz/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const nota = await obtenerOFallar(NotaVozLote, { _id: req.params.id, medicoPhone }, "Nota no encontrada");
    const eventosCreados = nota.eventosCreados.length
      ? await EventoLote.find({ _id: { $in: nota.eventosCreados } }).lean()
      : [];
    res.json({ nota, eventosCreados });
  }));
};
