// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Ganadería — El dueño entra a su finca
// ═══════════════════════════════════════════════════════════════════════════
//
// El veterinario le emite al dueño un enlace a SU finca (LlaveFinca en
// db/models.js, ahí está el porqué de que sea un enlace y no una contraseña).
// Con ese enlace el dueño:
//
//   · VE los lotes activos de esa finca: cuántos animales tiene, la
//     mortalidad, qué está en retiro HOY (¿puedo vender esta leche?), qué
//     vacunas tocan, la producción y los gastos.
//   · CARGA lo de todos los días: la leche o los huevos del día, las muertes
//     y los gastos. Es lo que el veterinario no ve porque no está en el campo
//     todos los días, y lo que la competencia le pide cargar a él.
//
// Lo que NO puede: vacunar, tratar, pesar, tocar la reproducción ni cerrar
// lotes. Eso es acto veterinario —un período de retiro mal cargado es leche
// con antibiótico en el tanque— y queda del lado de la sesión del médico.
//
// ═══ DOS PUERTAS, DOS CANDADOS ════════════════════════════════════════════
//
//   /medico/fincas/:id/acceso-dueno   sesión del veterinario: emite y corta
//   /campo/:llave/...                 posesión del enlace: solo ESA finca
//
// Todo lo del lado del dueño se filtra por la finca de la llave Y por el
// médico de la llave. Un loteId de otra finca —aunque sea del mismo
// veterinario— da 404, igual que uno que no existe.
const mongoose = require("mongoose");
const { Finca, LlaveFinca, LoteGanado, EventoLote, RegistroProduccion, GastoLote, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { enviarTextoOPlantilla, normalizarDestino, PLANTILLAS } = require("../services/metaWhatsapp");
const { avisarCambio } = require("../services/realtime");
const { mortalidadAcumulada, retirosVigentes } = require("../services/lotesGanado");
const { calendarioLote } = require("../services/esquemaGanado");
const { diaDe, sumarDias, resumenProduccion } = require("../services/produccion");
const { CATEGORIAS_GASTO, resumenCostos } = require("../services/costos");
const {
  TIPO_PRODUCCION, eventosConRetiroLeche, registrarMortalidad, guardarProduccion, registrarGasto,
} = require("../services/cargasGanado");
const { nuevoToken, hashDe, revocarLlaves, estadoAcceso } = require("../services/accesoFinca");
const { CONFIG, log } = require("../config");

const requireMedico = requireAuth(["medico"]);
// Más holgado que el de la llave del paciente: el dueño CARGA, y un lunes
// puede estar pasando la semana entera de leche de tres lotes.
const limitCampo = rateLimit("campoDueno", 60, 60 * 1000, "Demasiadas peticiones. Esperá un momento.");

const DIAS_PRODUCCION = 30;

function base(req) {
  return (CONFIG.APP_URL || "").replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
}

const paisDe = (medico) => (medico?.moneda === "BRL" ? "BR" : "BO");

// ─── Lo que se le muestra al dueño de cada registro ────────────────────────
// Lista explícita, como el proyector del panel del socio: un campo nuevo en
// el modelo no sale por esta puerta sin que alguien lo decida.
function eventoParaDueno(e) {
  return {
    _id: e._id, tipo: e.tipo, fecha: e.fecha,
    cantidadMuertes: e.cantidadMuertes, causaPresunta: e.causaPresunta || "",
    producto: e.producto || "", dosis: e.dosis || "",
    diasRetiroCarne: e.diasRetiroCarne, diasRetiroLeche: e.diasRetiroLeche,
    pesoPromedioKg: e.pesoPromedioKg, tamanoMuestra: e.tamanoMuestra,
    origen: e.origen || "",
  };
}

function gastoParaDueno(g) {
  return {
    _id: g._id, dia: g.dia, categoria: g.categoria, concepto: g.concepto || "",
    montoCentavos: g.montoCentavos, moneda: g.moneda, kg: g.kg, origen: g.origen || "",
  };
}

async function resumenLoteParaDueno(lote, moneda) {
  const medicoPhone = lote.medicoPhone;
  const tipo = TIPO_PRODUCCION[lote.especie] || null;
  const hoy = diaDe(new Date());
  const [eventos, gastos, registros, eventosRetiroLeche] = await Promise.all([
    EventoLote.find({ loteId: lote._id, medicoPhone }).sort({ fecha: -1, createdAt: -1 }).lean(),
    GastoLote.find({ loteId: lote._id, medicoPhone }).sort({ dia: -1, createdAt: -1 }).lean(),
    tipo ? RegistroProduccion.find({ loteId: lote._id, medicoPhone, tipo, dia: { $gte: sumarDias(hoy, -DIAS_PRODUCCION) } }).lean() : [],
    tipo === "leche" ? eventosConRetiroLeche(lote._id, medicoPhone) : [],
  ]);

  const produccion = tipo ? resumenProduccion(tipo, registros, { eventosLote: eventosRetiroLeche }) : null;
  const enMoneda = gastos.filter(g => (g.moneda || "BOB") === moneda);
  const pesajes = eventos.filter(e => e.tipo === "pesaje");
  const calendario = calendarioLote(lote, eventos);

  return {
    _id: lote._id, codigo: lote.codigo, nombre: lote.nombre, especie: lote.especie,
    proposito: lote.proposito || "", cantidadActual: lote.cantidadActual,
    cantidadInicial: lote.cantidadInicial, fechaIngreso: lote.fechaIngreso,
    mortalidad: mortalidadAcumulada(lote, eventos),
    retirosVigentes: retirosVigentes(eventos),
    // Al dueño solo lo que hay que hacer: lo pendiente y lo vencido. El
    // calendario entero es herramienta del veterinario.
    vacunasPorHacer: calendario.items
      .filter(i => i.estado === "pendiente" || i.estado === "vencida")
      .map(i => ({ id: i.id, estado: i.estado, hastaFecha: i.hastaFecha, proxima: i.proxima })),
    produccion: produccion && {
      tipo, ultimo: produccion.ultimo, promedio7: produccion.promedio7,
      variacionPct: produccion.variacionPct, vendible7: produccion.vendible7,
      alertas: produccion.alertas,
      serie: produccion.serie.slice(-14),
    },
    costos: resumenCostos(lote, enMoneda, { pesajes, tipoProduccion: tipo, serieProduccion: produccion ? produccion.serie : [] }),
    eventos: eventos.slice(0, 10).map(eventoParaDueno),
    gastos: gastos.slice(0, 10).map(gastoParaDueno),
  };
}

module.exports = function (app) {
  // ═══ LADO VETERINARIO ════════════════════════════════════════════════════

  // Emitir el acceso. Emitir de nuevo revoca el anterior —es lo que arregla
  // «se lo mandé al número equivocado»— y por eso se revoca ANTES de crear:
  // el índice único parcial no deja dos vivas.
  app.post("/medico/fincas/:id/acceso-dueno", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErrorHttp(404, "Finca no encontrada");
    const finca = await obtenerOFallar(Finca, { _id: req.params.id, medicoPhone }, "Finca no encontrada");
    const medico = await Medico.findOne({ phone: medicoPhone }).select("phone nombre idioma moneda").lean();

    const destino = normalizarDestino(finca.duenoTelefono, paisDe(medico));
    if (!destino) throw new ErrorHttp(400, "Cargá primero el WhatsApp del dueño en la finca.");

    await revocarLlaves(finca._id);
    const token = nuevoToken();
    const llave = await LlaveFinca.create({ fincaId: finca._id, medicoPhone, tokenHash: hashDe(token), enviadaA: destino });
    const enlace = `${base(req)}/campo/${token}`;

    const esBrasil = paisDe(medico) === "BR";
    const nombreDueno = String(finca.duenoNombre || "").split(" ")[0] || (esBrasil ? "produtor" : "productor");
    const texto = esBrasil
      ? `Olá ${nombreDueno}. Este é o acesso à fazenda ${finca.nombre} no Symphomed.\n\n` +
        `Por ele você vê seus lotes, o que está em carência e as vacinas pendentes, e registra a produção, as mortes e os gastos. Não precisa de senha.\n\n${enlace}\n\n` +
        `Guarde esta mensagem e não a encaminhe: quem tiver o link pode registrar dados na sua fazenda.`
      : `Hola ${nombreDueno}. Este es el acceso a la finca ${finca.nombre} en Symphomed.\n\n` +
        `Desde ahí ves tus lotes, qué está en retiro y qué vacunas tocan, y cargás la producción, las muertes y los gastos. No hace falta contraseña.\n\n${enlace}\n\n` +
        `Guardá este mensaje y no lo reenvíes: quien lo tenga puede cargar datos en tu finca.`;

    try {
      const r = await enviarTextoOPlantilla(destino, texto,
        { plantilla: PLANTILLAS.accesoFinca, parametros: [nombreDueno, finca.nombre, enlace], idioma: medico?.idioma });
      // Sin WhatsApp configurado, el envío devuelve null en vez de fallar
      // (services/metaWhatsapp.js). Para el veterinario es lo mismo que un
      // fallo: el dueño no recibió nada, y decirle «enviado» sería mentirle.
      if (!r) throw new Error("WhatsApp no configurado");
    } catch (e) {
      log.error("[ACCESO_DUENO] falló el envío del acceso:", e.response?.data?.error?.message || e.message);
      // El acceso YA existe y sirve: que WhatsApp falle no es motivo para
      // perderlo. Se le devuelve el enlace al veterinario para que lo mande él.
      registrar({ req, medicoPhone, accion: "emitir_acceso_finca", recurso: `Finca:${finca._id}`, detalle: "envío falló" });
      return res.json({ ok: true, enlace, enviado: false, acceso: estadoAcceso(llave) });
    }

    registrar({ req, medicoPhone, accion: "emitir_acceso_finca", recurso: `Finca:${finca._id}` });
    // El enlace vuelve también cuando se mandó bien: el veterinario puede
    // estar parado al lado del dueño y querer abrírselo ahí mismo.
    res.json({ ok: true, enlace, enviado: true, acceso: estadoAcceso(llave) });
  }));

  app.post("/medico/fincas/:id/acceso-dueno/revocar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErrorHttp(404, "Finca no encontrada");
    const finca = await obtenerOFallar(Finca, { _id: req.params.id, medicoPhone }, "Finca no encontrada");
    const revocadas = await revocarLlaves(finca._id);
    registrar({ req, medicoPhone, accion: "revocar_acceso_finca", recurso: `Finca:${finca._id}` });
    res.json({ ok: true, revocadas });
  }));

  // ═══ LADO DUEÑO (por el enlace, sin cuenta) ═════════════════════════════

  async function sesionDeCampo(token) {
    if (!token || token.length < 20) throw new ErrorHttp(404, "Este enlace no es válido.");
    const llave = await LlaveFinca.findOne({ tokenHash: hashDe(token), revocadaEn: null });
    if (!llave) throw new ErrorHttp(404, "Este enlace ya no es válido. Pedile uno nuevo a tu veterinario.");
    const finca = await Finca.findOne({ _id: llave.fincaId, medicoPhone: llave.medicoPhone });
    if (!finca) throw new ErrorHttp(404, "Esta finca ya no existe.");
    const medico = await Medico.findOne({ phone: llave.medicoPhone }).select("phone nombre idioma moneda activo").lean();
    if (!medico || medico.activo === false) throw new ErrorHttp(404, "Este enlace ya no es válido.");
    return { llave, finca, medico, moneda: medico.moneda === "BRL" ? "BRL" : "BOB" };
  }

  // El lote tiene que ser de ESTA finca y de ESTE veterinario, y estar
  // activo: a un lote cerrado no se le carga nada, y uno que el veterinario
  // movió a otra finca deja de verse desde acá en ese mismo momento.
  async function loteDeLaFinca(sesion, loteId) {
    if (!mongoose.isValidObjectId(loteId)) throw new ErrorHttp(404, "Lote no encontrado");
    return obtenerOFallar(LoteGanado, {
      _id: loteId, medicoPhone: sesion.llave.medicoPhone, fincaId: sesion.finca._id, estado: "activo",
    }, "Lote no encontrado");
  }

  const firmaDueno = (sesion) => sesion.finca.duenoNombre || "Dueño";

  // Después de cada carga: la pantalla del veterinario, si la tiene abierta,
  // se actualiza sola (services/realtime.js), y queda en la auditoría bajo
  // su cuenta diciendo que el acto fue del dueño.
  function despuesDeCargar(req, sesion, accion, recurso) {
    avisarCambio(sesion.llave.medicoPhone);
    registrar({ req, medicoPhone: sesion.llave.medicoPhone, accion, recurso, detalle: "por el dueño" });
  }

  app.get("/campo/:llave/datos", limitCampo, asyncRoute(async (req, res) => {
    const sesion = await sesionDeCampo(req.params.llave);
    const { llave, finca, medico, moneda } = sesion;
    llave.usos = (llave.usos || 0) + 1;
    llave.ultimoUso = new Date();
    await llave.save();

    const lotes = await LoteGanado.find({ medicoPhone: llave.medicoPhone, fincaId: finca._id, estado: "activo" })
      .sort({ nombre: 1 }).limit(100);
    res.json({
      finca: { nombre: finca.nombre, ubicacion: finca.ubicacion || "", duenoNombre: finca.duenoNombre || "" },
      veterinario: { nombre: medico.nombre || "" },
      idioma: medico.idioma === "pt" ? "pt" : "es",
      moneda,
      categoriasGasto: CATEGORIAS_GASTO,
      lotes: await Promise.all(lotes.map(l => resumenLoteParaDueno(l, moneda))),
    });
  }));

  app.post("/campo/:llave/lotes/:loteId/mortalidad", limitCampo, asyncRoute(async (req, res) => {
    const sesion = await sesionDeCampo(req.params.llave);
    const lote = await loteDeLaFinca(sesion, req.params.loteId);
    const { evento } = await registrarMortalidad(lote, {
      dia: req.body?.dia, cantidadMuertes: req.body?.cantidadMuertes,
      causaPresunta: req.body?.causaPresunta, notas: req.body?.notas,
      registradoPor: firmaDueno(sesion), origen: "dueno",
    });
    despuesDeCargar(req, sesion, "campo_mortalidad", `LoteGanado:${lote._id}`);
    res.status(201).json({ ok: true, evento: eventoParaDueno(evento) });
  }));

  app.put("/campo/:llave/lotes/:loteId/produccion", limitCampo, asyncRoute(async (req, res) => {
    const sesion = await sesionDeCampo(req.params.llave);
    const lote = await loteDeLaFinca(sesion, req.params.loteId);
    const r = await guardarProduccion(lote, req.body, { registradoPor: firmaDueno(sesion), origen: "dueno" });
    despuesDeCargar(req, sesion, "campo_produccion", `LoteGanado:${lote._id}`);
    res.json({ ok: true, enRetiro: r.enRetiro, productoRetiro: r.productoRetiro });
  }));

  app.post("/campo/:llave/lotes/:loteId/gastos", limitCampo, asyncRoute(async (req, res) => {
    const sesion = await sesionDeCampo(req.params.llave);
    const lote = await loteDeLaFinca(sesion, req.params.loteId);
    const gasto = await registrarGasto(lote, req.body,
      { moneda: sesion.moneda, registradoPor: firmaDueno(sesion), origen: "dueno" });
    despuesDeCargar(req, sesion, "campo_gasto", `LoteGanado:${lote._id}`);
    res.status(201).json({ ok: true, gasto: gastoParaDueno(gasto) });
  }));

  // El dueño borra lo que cargó el dueño; lo del veterinario lo borra el
  // veterinario. Mismo criterio que los enlaces del resumen compartido.
  app.delete("/campo/:llave/gastos/:id", limitCampo, asyncRoute(async (req, res) => {
    const sesion = await sesionDeCampo(req.params.llave);
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErrorHttp(404, "Gasto no encontrado");
    const gasto = await obtenerOFallar(GastoLote,
      { _id: req.params.id, medicoPhone: sesion.llave.medicoPhone, origen: "dueno" }, "Gasto no encontrado");
    // Y de un lote de esta finca: un gasto del mismo veterinario en la finca
    // de otro productor no se toca desde acá.
    await loteDeLaFinca(sesion, gasto.loteId);
    await gasto.deleteOne();
    despuesDeCargar(req, sesion, "campo_borrar_gasto", `GastoLote:${gasto._id}`);
    res.json({ ok: true });
  }));
};

