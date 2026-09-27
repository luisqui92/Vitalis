// Symphomed Ganadería — lotes de producción animal (bovino, porcino,
// avícola). La unidad de trabajo es el grupo, no el animal individual: ver
// el comentario sobre LoteGanado en db/models.js para por qué esto es un
// modelo aparte de Paciente, y no una extensión de la veterinaria de
// mascotas que ya existía.
const express = require("express");
const mongoose = require("mongoose");
const { Finca, LlaveFinca, LoteGanado, EventoLote, NotaVozLote, Medico } = require("../db/models");
const { revocarLlaves, estadoAcceso } = require("../services/accesoFinca");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { siguienteCodigo } = require("../services/codigos");
const { mortalidadAcumulada, retirosVigentes, curvaPeso } = require("../services/lotesGanado");
const { calendarioLote } = require("../services/esquemaGanado");
const { validarMuertes } = require("../services/cargasGanado");
const { notificarRetiroRegistrado } = require("../services/alertaRetiroGanado");
const { transcribirNotaDeVoz } = require("../services/assemblyai");
const { generarEventosLote, crearEventosDesdeSugerencias } = require("../services/notaVozLote");
const { estadoDe, cobrarConsulta } = require("../services/saldo");
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

// La finca que viene en el pedido, verificada contra el dueño de la cuenta.
// Vacío = sin finca (null), que es un valor válido. Un id de otro médico da
// 404 igual que uno que no existe: no se delata que existe.
async function fincaDelMedico(fincaId, medicoPhone) {
  if (fincaId === undefined || fincaId === null || fincaId === "") return null;
  if (!mongoose.isValidObjectId(fincaId)) throw new ErrorHttp(400, "fincaId no es válido");
  return obtenerOFallar(Finca, { _id: fincaId, medicoPhone }, "Finca no encontrada");
}

// Días de vida al entrar al lote: entero, de 0 a 30 años. Vacío = no se
// sabe (null), que es válido — el calendario lo pide aparte.
function edadIngresoOpcional(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 30 * 365) throw new ErrorHttp(400, "edadIngresoDias debe ser un número entero de días, 0 o más");
  return n;
}

function datosDeFinca(body) {
  return {
    ubicacion: String(body?.ubicacion || "").trim(),
    duenoNombre: String(body?.duenoNombre || "").trim(),
    duenoTelefono: String(body?.duenoTelefono || "").replace(/[^\d+]/g, ""),
    notas: String(body?.notas || "").trim(),
  };
}

module.exports = function (app) {
  // ─── FINCAS ─────────────────────────────────────────────────────────────
  app.post("/medico/fincas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");
    const codigo = await siguienteCodigo(Finca, medicoPhone, "F");
    const finca = await Finca.create({ medicoPhone, codigo, nombre, ...datosDeFinca(req.body) });
    res.status(201).json({ ok: true, finca });
  }));

  // Con cuántos lotes activos tiene cada una: es lo que el veterinario mira
  // para saber a cuál le toca visita.
  app.get("/medico/fincas", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const [fincas, conteos, llaves] = await Promise.all([
      Finca.find({ medicoPhone }).sort({ nombre: 1 }).lean(),
      LoteGanado.aggregate([
        { $match: { medicoPhone, estado: "activo", fincaId: { $ne: null } } },
        { $group: { _id: "$fincaId", n: { $sum: 1 } } },
      ]),
      // Si el dueño tiene acceso propio (routes/accesoDueno.js) y cuándo lo
      // usó por última vez: es cómo el veterinario sabe si de verdad carga.
      LlaveFinca.find({ medicoPhone, revocadaEn: null }).lean(),
    ]);
    const porFinca = new Map(conteos.map(c => [String(c._id), c.n]));
    const accesoPorFinca = new Map(llaves.map(l => [String(l.fincaId), estadoAcceso(l)]));
    res.json({ fincas: fincas.map(f => ({
      ...f,
      lotesActivos: porFinca.get(String(f._id)) || 0,
      accesoDueno: accesoPorFinca.get(String(f._id)) || null,
    })) });
  }));

  app.patch("/medico/fincas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const finca = await fincaDelMedico(req.params.id, medicoPhone);
    const nombre = String(req.body?.nombre ?? finca.nombre).trim();
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");
    // Solo se tocan los campos que vinieron: editar el teléfono del dueño
    // no puede borrarle la ubicación a la finca.
    const nuevos = datosDeFinca(req.body);
    const telefonoAntes = finca.duenoTelefono || "";
    finca.nombre = nombre;
    for (const campo of Object.keys(nuevos)) {
      if (req.body?.[campo] !== undefined) finca[campo] = nuevos[campo];
    }
    await finca.save();
    // Otro WhatsApp es, casi siempre, otro dueño (la finca se vendió, cambió
    // el encargado). El enlace que tiene el anterior deja de andar en el
    // mismo acto: que siga cargando datos en una finca que ya no es suya no
    // puede depender de que el veterinario se acuerde de cortarlo.
    let accesoRevocado = false;
    if ((finca.duenoTelefono || "") !== telefonoAntes) accesoRevocado = (await revocarLlaves(finca._id)) > 0;
    res.json({ ok: true, finca, accesoRevocado });
  }));

  // ─── CREAR LOTE ─────────────────────────────────────────────────────────
  app.post("/medico/lotes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const finca = await fincaDelMedico(req.body?.fincaId, medicoPhone);
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
    const edadIngresoDias = edadIngresoOpcional(req.body?.edadIngresoDias);

    const codigo = await siguienteCodigo(LoteGanado, medicoPhone, "L");
    const lote = await LoteGanado.create({
      medicoPhone, codigo, especie, nombre, proposito, ubicacion, notas,
      fincaId: finca ? finca._id : null, edadIngresoDias,
      cantidadInicial, cantidadActual: cantidadInicial, fechaIngreso,
    });
    res.status(201).json({ ok: true, lote });
  }));

  // ─── LISTAR LOTES PROPIOS ───────────────────────────────────────────────
  // Cada lote viene con el nombre de su finca ya puesto, para que la lista
  // no tenga que pedir las fincas aparte solo para mostrar un rótulo.
  app.get("/medico/lotes", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const filtro = { medicoPhone };
    if (req.query.estado === "activo" || req.query.estado === "cerrado") filtro.estado = req.query.estado;
    if (req.query.fincaId) {
      if (!mongoose.isValidObjectId(req.query.fincaId)) throw new ErrorHttp(400, "fincaId no es válido");
      filtro.fincaId = req.query.fincaId;
    }
    const lotes = await LoteGanado.find(filtro).sort({ createdAt: -1 }).lean();
    const ids = [...new Set(lotes.map(l => l.fincaId).filter(Boolean).map(String))];
    const fincas = ids.length ? await Finca.find({ _id: { $in: ids }, medicoPhone }).select("nombre").lean() : [];
    const nombreDe = new Map(fincas.map(f => [String(f._id), f.nombre]));
    res.json({ lotes: lotes.map(l => ({ ...l, fincaNombre: l.fincaId ? nombreDe.get(String(l.fincaId)) || "" : "" })) });
  }));

  // ─── CAMBIAR UN LOTE DE FINCA ───────────────────────────────────────────
  // Sobre todo para los lotes cargados antes de que existieran las fincas.
  app.patch("/medico/lotes/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    if (req.body?.fincaId !== undefined) {
      const finca = await fincaDelMedico(req.body.fincaId, medicoPhone);
      lote.fincaId = finca ? finca._id : null;
    }
    if (req.body?.edadIngresoDias !== undefined) lote.edadIngresoDias = edadIngresoOpcional(req.body.edadIngresoDias);
    await lote.save();
    res.json({ ok: true, lote });
  }));

  // ─── DETALLE: eventos, mortalidad acumulada, retiros vigentes y curva ──
  // Se trae todo junto, mismo criterio que /medico/pacientes/:id: que abrir
  // un lote no dispare cuatro pedidos al servidor.
  app.get("/medico/lotes/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const [eventos, finca] = await Promise.all([
      EventoLote.find({ loteId: lote._id, medicoPhone }).sort({ fecha: -1 }).lean(),
      lote.fincaId ? Finca.findOne({ _id: lote.fincaId, medicoPhone }).lean() : null,
    ]);

    res.json({
      lote,
      finca,
      eventos,
      mortalidad: mortalidadAcumulada(lote, eventos),
      retirosVigentes: retirosVigentes(eventos),
      curvaPeso: curvaPeso(eventos),
      // Un lote cerrado ya no se vacuna: mostrarle "pendientes" sería ruido.
      calendario: lote.estado === "cerrado" ? null : calendarioLote(lote, eventos),
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
      const cantidadMuertes = validarMuertes(lote, req.body?.cantidadMuertes);
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

    // Mismo candado que /medico/consultas: el saldo se mira acá, con la
    // mano liviana (recién pasado el piso de negativo), porque para cuando
    // este pedido llega el veterinario YA grabó en el campo. Rechazarlo le
    // tira a la basura una grabación que no puede repetir en el momento.
    const saldo = await estadoDe(medicoPhone);
    if (saldo.bloqueado) {
      throw new ErrorHttp(402, `Tu saldo llegó al límite (Bs ${saldo.saldoBs}). Cargá saldo para seguir usando el dictado de campo.`);
    }

    const nota = await NotaVozLote.create({ medicoPhone, loteId: lote._id, estado: "procesando" });
    res.status(202).json({ ok: true, nota });

    const medico = await Medico.findOne({ phone: medicoPhone }).select("phone nombre idioma tipoEspecialidad moneda").lean();

    transcribirNotaDeVoz(audioBuffer, medico?.tipoEspecialidad, medico?.idioma)
      .then(async ({ texto, duracionSegundos }) => {
        nota.transcripcionCompleta = texto;
        nota.duracionSegundos = duracionSegundos;

        // Se cobra apenas la transcripción salió bien — mismo criterio que
        // una consulta humana (services/saldo.js): si de acá para
        // adelante la separación en eventos fallara, el veterinario ya
        // recibió lo que pagó (la transcripción) y no tiene sentido
        // devolvérsela por un paso posterior.
        try {
          await cobrarConsulta({ medicoPhone, consultaId: nota._id, concepto: "Dictado de campo transcrito" });
        } catch (e) {
          log.error(`[NOTA_VOZ_LOTE] no se pudo cobrar la nota ${nota._id} de ${medicoPhone}:`, e.message);
        }

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
