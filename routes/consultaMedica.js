// ChatGo — Consultas médicas: transcripción de audio largo con diarización
// (AssemblyAI). Médicos suben el audio de la consulta (grabado en el celular
// o PC) y reciben la transcripción separada por hablante + nota clínica.
// Login/registro vive aparte en routes/medicoAuth.js.
const express = require("express");
const mongoose = require("mongoose");
const { CONFIG, log } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, Vacuna, Receta, CatalogoTratamiento, TratamientoPlan, ExamenOcular, OJOS, ESTRUCTURAS_OCULARES, ESTADOS_ESTRUCTURA_OCULAR, Odontograma, ESTADOS_PIEZA_DENTAL, PIEZAS_FDI_PERMANENTE, ExamenGinecologico, ORGANOS_GINECO, HALLAZGOS_GINECO, Teleconsulta } = require("../db/models");
const { requireAuth, generarToken } = require("../services/auth");
const { limitMedico, limitVistaPrevia } = require("../services/ratelimit");
const { transcribirConsultaMedica, idiomaSoportado } = require("../services/assemblyai");
const { generarNotaClinica, notaVacia, sanearNotaEnfermeria } = require("../services/notaClinica");
const { regenerarBriefClinico } = require("../services/briefClinico");
const { generarHilo } = require("../services/hiloClinico");
const { enviarTextoOPlantilla, PLANTILLAS } = require("../services/metaWhatsapp");
const { formatearFechaCompleta } = require("../services/reservaCitas");
const { registrar } = require("../services/auditoria");
const { notificarMedico } = require("../services/push");
const { avisarCambio } = require("../services/realtime");
const { registrarCorreccion } = require("../services/correccionesIA");
const { estadoDe, movimientosDe, cobrarConsulta } = require("../services/saldo");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { medicamentosDelMedico, correccionesDelMedico } = require("../services/vocabularioMedico");
const adaptacion = require("../services/adaptacion");
const { verificarMedicamento } = require("../services/medicamentosOficiales");
const { guardarBorrador, borradorDe, extrasDe, compararMedicamentos, medicamentosNoNombrados } = require("../services/notaEnVivo");
const audioPendiente = require("../services/audioPendiente");
const vistaPrevia = require("../services/vistaPrevia");
// Donde los módulos (modulos/*) suman lo suyo a una consulta: ver la lista
// de puntos en services/extensiones.js.
const extensiones = require("../services/extensiones");

// Lo más largo que se acepta como texto en vivo: una consulta de 70 minutos
// son unas 10.000 palabras, unos 70.000 caracteres. El doble, de margen.
const MAX_TEXTO_EN_VIVO = 150000;
// Con menos que esto no hubo consulta todavía: no vale la pena pedir nota.
const PALABRAS_MINIMAS_BORRADOR = 15;

const requireMedico = requireAuth(["medico"]);

// Acepta el audio como body crudo (no JSON): el cliente manda
// Content-Type: audio/ogg (o wav/mp3/m4a/webm) y el archivo tal cual.
// La app graba a 48 kbps (public/js/audio.js → crearGrabadora): 70 minutos
// son unos 25 MB. El margen es para un navegador que ignora ese pedido o
// para un archivo subido a mano, grabado con otra app a más calidad.
const audioRaw = express.raw({ type: "audio/*", limit: "250mb" });

// Revisa una lista de nombres con el idioma del médico y su historial.
// Nunca tira: si la revisión falla, la nota se muestra igual, sin avisos.
async function verificarLista(medicoPhone, nombres) {
  try {
    const [medico, propios, correcciones] = await Promise.all([
      Medico.findOne({ phone: medicoPhone }).select("idioma").lean(),
      medicamentosDelMedico(medicoPhone, 500),
      correccionesDelMedico(medicoPhone, 300),
    ]);
    const idioma = idiomaSoportado(medico?.idioma);
    return nombres.map(n => (String(n || "").trim()
      ? verificarMedicamento(n, { idioma, propios, correcciones })
      : { estado: "ok", sugerencia: null }));
  } catch (e) {
    log.warn("[MEDICAMENTOS] no se pudo revisar la lista:", e.message);
    return nombres.map(() => ({ estado: "ok", sugerencia: null }));
  }
}

// Lo que crea confirmar una consulta, una sola vez: con la clave de la
// consulta y de qué es, el índice único frena el segundo (11000), y eso
// cuenta como hecho. Devuelve el documento nuevo, o null si ya estaba.
async function crearUnaVez(Modelo, datos) {
  try {
    return await Modelo.create(datos);
  } catch (e) {
    if (e?.code === 11000) return null;
    throw e;
  }
}
const claveDe = (...partes) => partes.map(p => String(p ?? "").trim().toLowerCase()).join("|");

// Los hallazgos para el mapa de la especialidad que el médico dejó marcados
// al confirmar. Cada cambio queda en el historial de la pieza, estructura u
// órgano con fuente "voz" y el id de la consulta. Si ya está (una
// confirmación que se reintenta), no se repite. Si el paciente todavía no
// tenía mapa, se crea igual que cuando el médico lo abre a mano.
async function aplicarHallazgosAlMapa(consulta, paciente, medicoPhone, { ocular = [], odonto = [], gineco = [] }) {
  const cargados = [];
  if (!ocular.length && !odonto.length && !gineco.length) return cargados;
  const medico = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad").lean();
  const ya = (historial, cambio) => (historial || []).some(h => String(h.consultaId) === String(consulta._id)
    && Object.entries(cambio).every(([k, v]) => (h[k] || "") === (v || "")));
  const ahora = new Date();

  if (medico?.tipoEspecialidad === "oftalmologia" && ocular.length) {
    let examen = await ExamenOcular.findOne({ pacienteId: paciente._id, medicoPhone });
    if (!examen) {
      const estructuras = [];
      for (const ojo of OJOS) for (const estructura of ESTRUCTURAS_OCULARES) estructuras.push({ ojo, estructura, estado: "normal", notas: "", historial: [] });
      examen = await ExamenOcular.create({ pacienteId: paciente._id, medicoPhone, estructuras });
    }
    for (const h of ocular) {
      if (!OJOS.includes(h.ojo) || !ESTRUCTURAS_OCULARES.includes(h.estructura) || !ESTADOS_ESTRUCTURA_OCULAR.includes(h.estado)) continue;
      const item = examen.estructuras.find(e => e.ojo === h.ojo && e.estructura === h.estructura);
      if (!item || ya(item.historial, { estado: h.estado, notas: h.hallazgo })) continue;
      item.estado = h.estado;
      item.notas = h.hallazgo;
      item.historial.push({ fecha: ahora, estado: h.estado, notas: h.hallazgo, fuente: "voz", consultaId: consulta._id });
      cargados.push(`Mapa ocular: ${h.ojo} ${h.estructura}`);
    }
    await examen.save();
  }

  if (medico?.tipoEspecialidad === "odontologia" && odonto.length) {
    let odontograma = await Odontograma.findOne({ pacienteId: paciente._id, medicoPhone });
    if (!odontograma) {
      const piezas = PIEZAS_FDI_PERMANENTE.map(numero => ({ numero, estado: "sano", notas: "", historial: [] }));
      odontograma = await Odontograma.create({ pacienteId: paciente._id, medicoPhone, piezas });
    }
    for (const h of odonto) {
      if (!PIEZAS_FDI_PERMANENTE.includes(h.piezaFdi) || !ESTADOS_PIEZA_DENTAL.includes(h.estado)) continue;
      const pieza = odontograma.piezas.find(x => x.numero === h.piezaFdi);
      if (!pieza || ya(pieza.historial, { estado: h.estado, notas: h.hallazgo })) continue;
      pieza.estado = h.estado;
      pieza.notas = h.hallazgo;
      pieza.historial.push({ fecha: ahora, estado: h.estado, notas: h.hallazgo, fuente: "voz", consultaId: consulta._id });
      cargados.push(`Odontograma: pieza ${h.piezaFdi}`);
    }
    await odontograma.save();
  }

  if (medico?.tipoEspecialidad === "ginecologia" && gineco.length) {
    let mapa = await ExamenGinecologico.findOne({ pacienteId: paciente._id, medicoPhone });
    if (!mapa) {
      const organos = ORGANOS_GINECO.map(organo => ({ organo, hallazgo: "normal", notas: "", historial: [] }));
      mapa = await ExamenGinecologico.create({ pacienteId: paciente._id, medicoPhone, organos });
    }
    for (const h of gineco) {
      if (!ORGANOS_GINECO.includes(h.organo) || !HALLAZGOS_GINECO.includes(h.hallazgo)) continue;
      const item = mapa.organos.find(o => o.organo === h.organo);
      if (!item || ya(item.historial, { hallazgo: h.hallazgo, notas: h.detalle })) continue;
      item.hallazgo = h.hallazgo;
      item.notas = h.detalle;
      item.historial.push({ fecha: ahora, hallazgo: h.hallazgo, notas: h.detalle, fuente: "voz", consultaId: consulta._id });
      cargados.push(`Mapa ginecológico: ${h.organo}`);
    }
    await mapa.save();
  }
  return cargados;
}

module.exports = function (app) {

  // ─── PASE PARA LA VISTA PREVIA EN VIVO ─────────────────────────────────
  // El navegador se conecta a Symphomed y Symphomed a AssemblyAI: así se
  // mide y se corta el tiempo que se paga (services/vistaPrevia.js). El
  // pase vale para una sola conexión; el idioma y el vocabulario los pone
  // el servidor, sacados de la cuenta, igual que en la transcripción final.
  app.get("/medico/transcripcion-token", limitVistaPrevia, requireMedico, asyncRoute(async (req, res) => {
    // Pedir el pase es empezar a grabar: lo último que se puede frenar
    // antes de que la consulta exista.
    await extensiones.revisar("consulta.antesDeGrabar", req);
    // Una cuenta que ya no puede subir consultas tampoco abre la vista previa.
    const saldo = await estadoDe(req.adminUser.usuario);
    if (saldo.bloqueado) {
      throw new ErrorHttp(402, `Tu saldo llegó al límite (Bs ${saldo.saldoBs}). Cargá saldo para seguir transcribiendo consultas.`);
    }
    const opciones = { req };
    await extensiones.revisar("vistaPrevia.configurar", opciones);
    if (opciones.sinVistaPrevia) return res.json({ sinVistaPrevia: true });
    res.json({ pase: await vistaPrevia.emitirPase(req.adminUser), ruta: vistaPrevia.RUTA });
  }));

  // ─── SALDO PREPAGO ─────────────────────────────────────────────────────
  // Lo mira la pantalla ANTES de grabar, que es el único momento en que el
  // médico todavía puede hacer algo al respecto. Después de grabar ya es
  // tarde: la consulta existe y hay que procesarla.
  app.get("/medico/saldo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const [estado, movimientos] = await Promise.all([
      estadoDe(medicoPhone),
      movimientosDe(medicoPhone, Number(req.query.movimientos) || 30),
    ]);
    res.json({ ...estado, movimientos });
  }));

  // ─── SUBIR AUDIO DE CONSULTA → TRANSCRIBIR (en segundo plano) ──────────
  // Con consultas de 30-45 min, esperar la transcripción entera en el mismo
  // pedido HTTP no funciona (nginx corta conexiones largas). Por eso acá solo
  // se guarda el audio y se responde al toque; la transcripción sigue sola
  // en background (transcribirEnSegundoPlano, abajo) y la web se fija
  // después (polling) cuando termina.
  app.post("/medico/consultas", limitMedico, requireMedico, audioRaw, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const audioBuffer = req.body;
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new ErrorHttp(400, "Falta el audio (Content-Type debe ser audio/*)");
    }

    // El saldo se mira acá, pero con la mano muy liviana: para cuando este
    // pedido llega, el médico YA grabó la consulta con el paciente adelante.
    // Rechazarlo le tira a la basura una grabación que no puede repetir.
    //
    // Por eso solo se corta pasado el piso de negativo —cinco consultas de
    // margen— y no en cero. El aviso de "te queda poco" va en la pantalla,
    // ANTES de grabar, que es donde todavía se puede hacer algo.
    // Lo mismo que al pedir el token: una cuenta que no puede grabar no
    // llega hasta acá desde la app, porque la pantalla ya le avisó antes de
    // empezar. Si igual llega (una grabación vieja del respaldo del
    // teléfono), queda guardada en el celular y se sube cuando pueda.
    //
    // La vista previa de esta misma grabación, si tuvo, va en req.vistaPrevia:
    // la grabación y su vista previa son la misma hora de consulta, y el
    // tiempo de la vista previa ya se contó mientras se grababa
    // (services/vistaPrevia.js).
    req.vistaPrevia = await vistaPrevia.deEstaGrabacion(medicoPhone);
    await extensiones.revisar("consulta.antesDeGrabar", req);
    const saldo = await estadoDe(medicoPhone);
    if (saldo.bloqueado) {
      throw new ErrorHttp(402, `Tu saldo llegó al límite (Bs ${saldo.saldoBs}). Cargá saldo para seguir transcribiendo consultas.`);
    }

    const pacienteId = String(req.query.pacienteId || "").trim();
    if (!pacienteId) throw new ErrorHttp(400, "Falta pacienteId — elegí o creá un paciente antes de grabar");
    const paciente = await obtenerOFallar(Paciente, { _id: pacienteId, medicoPhone }, "Paciente no encontrado");

    // Si el audio salió de una videollamada, viene con el médico en un canal
    // y el paciente en el otro (public/js/grabacionTele.js). Eso cambia cómo
    // se pide la transcripción: no hace falta diarizar lo que ya viene
    // separado.
    //
    // Se verifica que la teleconsulta sea de ESTE médico y de ESTE paciente
    // antes de creerle al parámetro: si no, cualquiera podría enganchar una
    // consulta a la videollamada de otro. Un id que no pasa el control se
    // ignora y la consulta se guarda igual —el audio ya existe y perderlo
    // sería peor—, pero sin enganchar nada.
    const teleconsultaId = String(req.query.teleconsultaId || "").trim();
    let teleconsulta = null;
    if (teleconsultaId) {
      teleconsulta = await Teleconsulta.findOne({ _id: teleconsultaId, medicoPhone, pacienteId: paciente._id });
      if (!teleconsulta) {
        log.warn(`[TELECONSULTA] ${medicoPhone} mandó audio con teleconsultaId ${teleconsultaId} que no es suya o no es de ese paciente — se guarda como consulta suelta`);
      }
    }
    const multicanal = Boolean(teleconsulta);

    // El audio va al disco ANTES de contestar: apenas recibe el 202, el
    // teléfono borra su copia y la única que queda es esta. Si no se puede
    // guardar, se contesta que no, y el teléfono la conserva para reintentar
    // (services/audioPendiente.js). El id se elige antes para que el audio
    // exista antes que la consulta: nunca hay una «procesando» sin su audio.
    const consultaId = new mongoose.Types.ObjectId();
    const contextoAudio = { req, consultaId };
    await extensiones.revisar("audio.reservar", contextoAudio);
    try {
      await audioPendiente.guardar(consultaId, audioBuffer);
    } catch (e) {
      await extensiones.revisar("audio.descartar", contextoAudio);
      log.error("[CONSULTA_MEDICA] no se pudo guardar el audio en disco:", e.message);
      throw new ErrorHttp(503, "No se pudo guardar el audio. Probá de nuevo en un rato: la grabación sigue en el teléfono.");
    }
    let consulta;
    try {
      consulta = await ConsultaMedica.create({
        _id: consultaId, medicoPhone, pacienteId: paciente._id, pacienteNombre: paciente.nombre, estado: "procesando",
        ...extensiones.sumar("consulta.alCrear", req),
        limitesAudio: contextoAudio.limitesAudio,
      });
    } catch (e) {
      await audioPendiente.borrar(consultaId).catch(() => {});
      await extensiones.revisar("audio.descartar", contextoAudio);
      throw e;
    }
    await vistaPrevia.vincular(req.vistaPrevia, consulta._id)
      .catch((e) => log.warn(`[VISTA_PREVIA] no se pudo enganchar a la consulta ${consulta._id}:`, e.message));

    if (teleconsulta) {
      teleconsulta.consultaId = consulta._id;
      await teleconsulta.save();
    }

    res.status(202).json({ ok: true, consulta });
    transcribirEnSegundoPlano(consulta, paciente, audioBuffer, { multicanal })
      .catch(e => log.error(`[CONSULTA_MEDICA] consulta ${consulta._id} en segundo plano:`, e.message));
  }));

  // ─── REINTENTAR LA TRANSCRIPCIÓN ───────────────────────────────────────
  // Cuando falló varias veces por algo pasajero, el audio queda guardado
  // unos días (ver «CUANDO LA TRANSCRIPCIÓN FALLA», abajo). Es la misma
  // consulta que ya se subió: no se mira de nuevo el saldo ni las horas.
  app.post("/medico/consultas/:id/transcripcion/reintentar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    if (consulta.estado !== "error" || !consulta.audioRetenidoHasta || new Date(consulta.audioRetenidoHasta) <= new Date()) {
      throw new ErrorHttp(409, "Esta consulta no tiene un audio guardado para volver a transcribir.");
    }
    const audio = await audioPendiente.leer(consulta._id);
    if (!audio) {
      await ConsultaMedica.updateOne({ _id: consulta._id }, { $set: { audioRetenidoHasta: null } });
      throw new ErrorHttp(409, "El audio de esta consulta ya no está guardado.");
    }
    const paciente = await obtenerOFallar(Paciente, { _id: consulta.pacienteId, medicoPhone }, "Paciente no encontrado");
    // Atómico: dos toques seguidos no la transcriben dos veces.
    const reclamo = await ConsultaMedica.updateOne({ _id: consulta._id, estado: "error" },
      { $set: { estado: "procesando", error: "", intentosTranscripcion: 0 } });
    if (!reclamo.modifiedCount) throw new ErrorHttp(409, "Ya se está volviendo a transcribir.");
    res.status(202).json({ ok: true });
    const multicanal = Boolean(await Teleconsulta.exists({ consultaId: consulta._id }));
    consulta.estado = "procesando";
    transcribirEnSegundoPlano(consulta, paciente, audio, { multicanal })
      .catch(e => log.error(`[CONSULTA_MEDICA] consulta ${consulta._id}, al reintentar:`, e.message));
  }));

  // ─── LA NOTA EN VIVO (ver services/notaEnVivo.js) ─────────────────────
  //
  // El borrador, mientras se graba: el texto de la vista previa entra, la
  // nota sale. No se guarda nada en la base: todavía no hay consulta, solo
  // una grabación en curso.
  app.post("/medico/consultas/nota-en-vivo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const texto = String(req.body?.texto || "").slice(0, MAX_TEXTO_EN_VIVO);
    const pacienteId = String(req.body?.pacienteId || "").trim();
    if (!pacienteId) throw new ErrorHttp(400, "Falta pacienteId");
    await extensiones.revisar("consulta.antesDeGrabar", req);
    const paciente = await obtenerOFallar(Paciente, { _id: pacienteId, medicoPhone }, "Paciente no encontrado");
    if (texto.split(/\s+/).filter(Boolean).length < PALABRAS_MINIMAS_BORRADOR) return res.json({ nota: null });

    // Lo que los módulos suman al borrador viaja aparte, en «extras»: la
    // nota es del núcleo y no cambia de forma según quién esté grabando.
    const guardado = borradorDe(medicoPhone, pacienteId, texto);
    if (guardado) {
      return res.json({ nota: guardado, noNombrados: medicamentosNoNombrados(guardado, texto, await correccionesDelMedico(medicoPhone, 300).catch(() => [])),
        extras: extrasDe(medicoPhone, pacienteId, texto) });
    }
    const medico = await Medico.findOne({ phone: medicoPhone }).select("idioma").lean();
    const { contexto } = await contextoDeNota(paciente, medicoPhone);
    // A la par de la nota, no después: nadie espera el doble.
    const extrasPromesa = extensiones.extras("notaEnVivo.extras", { req, texto, idioma: medico?.idioma, paciente });
    let nota;
    try {
      nota = await generarNotaClinica(texto, contexto, medico?.idioma);
    } catch (e) {
      // Un borrador que no salió no es un error para el médico: sigue
      // grabando, y el próximo minuto se intenta de nuevo.
      log.warn("[NOTA_EN_VIVO] borrador:", e.message);
      return res.json({ nota: null, extras: await extrasPromesa });
    }
    const extras = await extrasPromesa;
    guardarBorrador(medicoPhone, pacienteId, texto, nota, extras);
    res.json({ nota, noNombrados: medicamentosNoNombrados(nota, texto, await correccionesDelMedico(medicoPhone, 300).catch(() => [])),
      extras });
  }));

  // El texto en vivo de una consulta ya subida: si llegó entero (lo decide
  // el navegador, que sabe cuánto audio mandó), la nota sale de acá en vez
  // de esperar a la transcripción completa.
  app.post("/medico/consultas/:id/texto-en-vivo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const texto = String(req.body?.texto || "").slice(0, MAX_TEXTO_EN_VIVO);
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    if (texto.split(/\s+/).filter(Boolean).length < PALABRAS_MINIMAS_BORRADOR) return res.json({ ok: true, usada: false });

    // Solo si la transcripción completa todavía no escribió la nota. El
    // reclamo es atómico: si las dos llegan a la vez, una sola escribe.
    const reclamo = await ConsultaMedica.updateOne(
      { _id: consulta._id, medicoPhone, estado: "procesando", notaFuente: { $in: ["", null] }, confirmadaEn: null },
      { $set: { notaFuente: "vivo", transcripcionEnVivo: texto, notaClinicaEstado: "pendiente", "verificacion.estado": "pendiente" } });
    if (!reclamo.modifiedCount) return res.json({ ok: true, usada: false });
    res.status(202).json({ ok: true, usada: true });

    const paciente = await Paciente.findOne({ _id: consulta.pacienteId, medicoPhone });
    const medico = await Medico.findOne({ phone: medicoPhone }).select("idioma").lean();
    const actual = await ConsultaMedica.findById(consulta._id);
    const inicio = Date.now();
    await producirNota(actual, paciente, medicoPhone, medico?.idioma, {
      texto, notaHecha: borradorDe(medicoPhone, String(consulta.pacienteId), texto),
    });
    const notaVivoMs = Date.now() - inicio;
    await ConsultaMedica.updateOne({ _id: consulta._id }, { $set: { "tiempos.notaVivoMs": notaVivoMs } }).catch(() => {});
    log.info(`[TIEMPOS] consulta ${consulta._id}: nota en vivo ${Math.round(notaVivoMs / 1000)} s`);
    if (actual.notaClinicaEstado === "completado") avisarNotaLista(actual, paciente, medicoPhone);
    else avisarCambio(medicoPhone);
    // Si la transcripción completa ya terminó, se verifica ahora; si no, lo
    // hace ella al terminar.
    await intentarVerificar(consulta._id);
  }));

  // ─── LISTAR CONSULTAS PROPIAS ───────────────────────────────────────────
  app.get("/medico/consultas", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consultas = await ConsultaMedica.find({ medicoPhone })
      .select("pacienteId pacienteNombre estado notaClinicaEstado duracionSegundos createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ consultas });
  }));

  // ─── DETALLE DE UNA CONSULTA (transcripción completa) ──────────────────
  app.get("/medico/consultas/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    registrar({ req, medicoPhone, accion: "ver_consulta", recurso: `ConsultaMedica:${consulta._id}` });

    // Le sumamos el precio del catálogo a cada tratamiento sugerido que la
    // IA logró emparejar, para no obligar al médico a ir a buscarlo.
    const consultaObj = consulta.toObject();
    const sugeridos = consultaObj.notaClinica?.tratamientosSugeridos;
    if (sugeridos?.length) {
      const nombres = [...new Set(sugeridos.filter(t => t.catalogoNombreSugerido).map(t => t.catalogoNombreSugerido))];
      if (nombres.length) {
        const catalogo = await CatalogoTratamiento.find({ medicoPhone, nombre: { $in: nombres } }).select("nombre precio").lean();
        const precioPorNombre = Object.fromEntries(catalogo.map(c => [c.nombre, c.precio]));
        consultaObj.notaClinica.tratamientosSugeridos = sugeridos.map(t => ({
          ...t,
          precioCatalogo: t.catalogoNombreSugerido ? (precioPorNombre[t.catalogoNombreSugerido] ?? null) : null,
        }));
      }
    }

    // Cada medicamento de la nota, contra la lista oficial y contra lo que
    // este médico ya recetó (services/medicamentosOficiales.js). Solo
    // mientras se revisa: una vez confirmada, lo que quedó es lo que él
    // decidió. Va en la misma posición que medicamentosRecetados.
    if (!consultaObj.confirmadaEn && consultaObj.notaClinica?.medicamentosRecetados?.length) {
      consultaObj.verificacionMedicamentos = await verificarLista(
        medicoPhone, consultaObj.notaClinica.medicamentosRecetados.map(m => m?.nombre));
      // Y cada uno contra lo que se DIJO (services/notaEnVivo.js →
      // nombradoEnTexto): la IA puede completar con un medicamento que nadie
      // nombró. Se avisa en la fila; la nota no se toca.
      const texto = consultaObj.transcripcionCompleta || consultaObj.transcripcionEnVivo || "";
      if (texto.trim()) {
        const correcciones = await correccionesDelMedico(medicoPhone, 300).catch(() => []);
        for (const i of medicamentosNoNombrados(consultaObj.notaClinica, texto, correcciones)) {
          consultaObj.verificacionMedicamentos[i] = { ...(consultaObj.verificacionMedicamentos[i] || { estado: "ok" }), noNombrado: true };
        }
      }
    }

    // Lo que los módulos suman a esta consulta para esta cuenta (por ejemplo,
    // un ejercicio hecho sobre ella). Si uno falla, la consulta se abre igual.
    consultaObj.extras = await extensiones.extras("consulta.detalle", { req, consulta: consultaObj });

    res.json({ consulta: consultaObj });
  }));

  // ─── REVISAR UN NOMBRE MIENTRAS EL MÉDICO LO EDITA ─────────────────────
  // La misma revisión, para cuando cambia o agrega un medicamento a mano en
  // la nota. Solo informa: nunca se cambia nada solo.
  app.get("/medico/medicamentos/verificar", requireMedico, asyncRoute(async (req, res) => {
    const nombre = String(req.query.nombre || "").slice(0, 120);
    const [r] = await verificarLista(req.adminUser.usuario, [nombre]);
    res.json(r);
  }));

  // ─── VOLVER A GENERAR LA NOTA ──────────────────────────────────────────
  // Para cuando la nota falló o salió vacía: la transcripción está bien y es
  // lo caro, así que se reusa. No se cobra de nuevo: la consulta ya se cobró
  // una vez y el médico no recibió lo que pagó.
  //
  // Solo si la nota está en error o vacía, y nunca después de confirmar. Una
  // nota con contenido se corrige a mano: regenerarla pisaría lo que el
  // médico ya miró.
  app.post("/medico/consultas/:id/nota/regenerar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    if (consulta.confirmadaEn) throw new ErrorHttp(409, "Esta consulta ya fue confirmada");
    if (consulta.estado !== "completado" || !String(consulta.transcripcionCompleta || "").trim()) {
      throw new ErrorHttp(400, "Esta consulta todavía no tiene transcripción");
    }
    if (consulta.notaClinicaEstado === "pendiente") throw new ErrorHttp(409, "La nota ya se está generando");
    if (consulta.notaClinicaEstado === "completado" && !notaVacia(consulta.notaClinica)) {
      throw new ErrorHttp(409, "La nota ya tiene contenido: corregila a mano antes de confirmar");
    }
    const paciente = await obtenerOFallar(Paciente, { _id: consulta.pacienteId, medicoPhone }, "Paciente no encontrado");
    const medico = await Medico.findOne({ phone: medicoPhone }).select("idioma").lean();

    consulta.notaClinicaEstado = "pendiente";
    consulta.notaClinicaError = undefined;
    // Se escribe de la transcripción completa: ya no hay nada que verificar.
    consulta.notaFuente = "audio";
    consulta.verificacion = { estado: "" };
    await consulta.save();
    registrar({ req, medicoPhone, accion: "regenerar_nota_clinica", recurso: `ConsultaMedica:${consulta._id}` });
    res.status(202).json({ ok: true });

    producirNota(consulta, paciente, medicoPhone, medico?.idioma)
      .then(() => {
        avisarCambio(medicoPhone);
        if (consulta.notaClinicaEstado === "completado") {
          regenerarBriefClinico(consulta.pacienteId).catch(e => log.error("[BRIEF_CLINICO]", e.message));
          generarHilo(consulta._id).catch(e => log.error("[HILO_CLINICO]", e.message));
        }
      })
      .catch(e => log.error("[NOTA_CLINICA] regenerar:", e.message));
  }));

  // ─── CONFIRMAR LA CONSULTA (un solo paso) ──────────────────────────────
  // El médico revisa la nota que escribió la IA, corrige lo que haga falta
  // y marca qué aplicar. Todo eso llega junto acá: se guarda la nota
  // editada y se aplica lo marcado de una sola vez.
  //
  // Nada de esto es "todo o nada": si algo puntual falla (típico: el
  // WhatsApp de la reconsulta cuando el paciente no tiene teléfono), el
  // resto igual se aplica y se devuelve la lista de lo que no salió, para
  // que el médico lo vea y decida. Fallar entero por un WhatsApp sería
  // peor: le borraría también las correcciones que acaba de escribir.
  app.post("/medico/consultas/:id/confirmar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    if (consulta.confirmadaEn) throw new ErrorHttp(409, "Esta consulta ya fue confirmada");
    if (!consulta.notaClinica) throw new ErrorHttp(400, "Esta consulta todavía no tiene nota clínica");
    // La nota en vivo se confirma recién cuando la transcripción completa
    // la verificó: confirmar manda la receta y la medicación al Kardex, y
    // eso no puede salir de un texto que nadie comparó con el audio.
    // Si la transcripción completa falló, se puede: el médico ya vio el aviso.
    if (consulta.notaFuente === "vivo" && ["pendiente", "verificando"].includes(consulta.verificacion?.estado)) {
      throw new ErrorHttp(409, "Esperá unos segundos: se está verificando la nota con el audio completo.");
    }

    const paciente = await obtenerOFallar(Paciente, { _id: consulta.pacienteId, medicoPhone }, "Paciente no encontrado");
    // Lo que esta cuenta no puede aplicar lo fuerza un módulo, sin importar
    // lo que haya mandado la pantalla (el punto «consulta.alConfirmar»).
    // Una confirmación por vez (revisión integral del 11 de octubre de 2026,
    // S02). Lo que sigue crea medicación, vacunas, receta y tratamientos: dos
    // toques seguidos los creaban dos veces. El reclamo vence a los dos
    // minutos por si el proceso se cayó en el medio, y si algo falla se suelta
    // en el momento para poder reintentar. Reintentar no duplica: cada cosa
    // lleva la clave de esta consulta (crearUnaVez).
    const reclamada = new Date();
    const reclamo = await ConsultaMedica.updateOne(
      { _id: consulta._id, medicoPhone, confirmadaEn: null,
        $or: [{ confirmandoDesde: null }, { confirmandoDesde: { $lt: new Date(reclamada.getTime() - 120000) } }] },
      { $set: { confirmandoDesde: reclamada } });
    if (!reclamo.modifiedCount) {
      const ahora = await ConsultaMedica.findById(consulta._id).select("confirmadaEn").lean();
      throw new ErrorHttp(409, ahora?.confirmadaEn ? "Esta consulta ya fue confirmada" : "Esta consulta se está confirmando: esperá unos segundos.");
    }
    try {
      await aplicarConfirmacion(req, res, consulta, paciente);
    } catch (e) {
      await ConsultaMedica.updateOne({ _id: consulta._id, confirmandoDesde: reclamada }, { $set: { confirmandoDesde: null } }).catch(() => {});
      throw e;
    }
  }));

  // Lo que aplica confirmar, con la consulta ya reclamada (arriba).
  async function aplicarConfirmacion(req, res, consulta, paciente) {
    const medicoPhone = req.adminUser.usuario;
    const aplicar = { ...(req.body?.aplicar || {}), ...extensiones.sumar("consulta.alConfirmar", req) };
    const aplicado = [];
    const fallado = [];

    // ── 1. Guardar la nota con las correcciones del médico ──
    const notaEditada = req.body?.nota;
    if (notaEditada && typeof notaEditada === "object") {
      const n = consulta.notaClinica;
      const textos = ["motivoConsulta", "antecedentesRelevantes", "diagnostico", "plan", "proximoControl"];
      const listas = ["sintomas", "diagnosticosDiferenciales", "examenesSolicitados"];
      let huboCambios = false;
      // Se esperan (registrarCorreccion nunca tira): de estas aprende la IA de
      // este profesional (services/adaptacion.js), y tienen que estar
      // guardadas antes de que se recalcule lo aprendido, más abajo.
      const correcciones = [];

      for (const campo of textos) {
        if (notaEditada[campo] === undefined) continue;
        const valor = String(notaEditada[campo]).trim();
        if (valor !== (n[campo] || "")) {
          // Lo que la IA propuso vs. lo que quedó: alimenta el panel de
          // correcciones, que es como medimos si la IA está mejorando.
          correcciones.push(registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo, valorSugerido: n[campo], valorFinal: valor }));
          n[campo] = valor;
          huboCambios = true;
        }
      }
      for (const campo of listas) {
        if (!Array.isArray(notaEditada[campo])) continue;
        const valor = notaEditada[campo].map(x => String(x).trim()).filter(Boolean);
        if (valor.join("|") !== (n[campo] || []).join("|")) {
          correcciones.push(registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo, valorSugerido: (n[campo] || []).join(", "), valorFinal: valor.join(", ") }));
          n[campo] = valor;
          huboCambios = true;
        }
      }
      if (Array.isArray(notaEditada.medicamentosRecetados)) {
        const valor = notaEditada.medicamentosRecetados
          .map(m => ({ nombre: String(m?.nombre || "").trim(), dosis: String(m?.dosis || "").trim(), frecuencia: String(m?.frecuencia || "").trim() }))
          .filter(m => m.nombre);
        const antes = (n.medicamentosRecetados || []).map(m => `${m.nombre}|${m.dosis}|${m.frecuencia}`).join("¬");
        const despues = valor.map(m => `${m.nombre}|${m.dosis}|${m.frecuencia}`).join("¬");
        if (antes !== despues) {
          correcciones.push(registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo: "medicamentosRecetados", valorSugerido: antes, valorFinal: despues }));
          // Cada nombre que el médico cambió queda como par «la IA escribió
          // X → él escribió Y». Con eso Symphomed aprende sus correcciones
          // (services/vocabularioMedico.js): la próxima vez que aparezca X,
          // la nota ya propone Y. "origen" es la fila de la nota original
          // de la que salió cada medicamento (las filas nuevas no traen).
          const originales = n.medicamentosRecetados || [];
          // Se esperan (registrarCorreccion nunca tira): tienen que estar
          // guardadas antes de que se recalcule su vocabulario, más abajo.
          const pendientes = [];
          notaEditada.medicamentosRecetados.forEach((m) => {
            const i = Number.isInteger(m?.origen) ? m.origen : -1;
            const antesNombre = String(originales[i]?.nombre || "").trim();
            const ahora = String(m?.nombre || "").trim();
            if (antesNombre && ahora && antesNombre !== ahora) {
              pendientes.push(registrarCorreccion({ medicoPhone, tipo: "medicamento", consultaId: consulta._id, campo: "nombre", valorSugerido: antesNombre, valorFinal: ahora }));
            }
          });
          await Promise.all(pendientes);
          n.medicamentosRecetados = valor;
          huboCambios = true;
        }
      }
      // La nota de enfermería (services/notaClinica.js): lo corregido pasa
      // por la misma limpieza que lo que escribió la IA. El motivo ya se
      // guardó arriba, con los textos de siempre.
      if (n.formato === "enfermeria") {
        const actual = typeof n.toObject === "function" ? n.toObject() : n;
        const CAMPOS_ENF = ["valoracion", "signosVitales", "diagnosticosEnfermeria", "objetivos", "intervenciones", "evaluacion", "educacion"];
        const editados = Object.fromEntries(CAMPOS_ENF.filter(c => notaEditada[c] !== undefined).map(c => [c, notaEditada[c]]));
        const candidata = sanearNotaEnfermeria({ ...actual, ...editados });
        for (const campo of Object.keys(editados)) {
          const antes = JSON.stringify(actual[campo] ?? null);
          const despues = JSON.stringify(candidata[campo] ?? null);
          if (antes === despues) continue;
          correcciones.push(registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo, valorSugerido: antes, valorFinal: despues }));
          n[campo] = candidata[campo];
          huboCambios = true;
        }
      }
      await Promise.all(correcciones);
      if (huboCambios) {
        consulta.notaEditadaPorMedico = true;
        aplicado.push("Nota clínica corregida");
      }
    }

    const nota = consulta.notaClinica;

    // ── 2. Reconsulta: agendar y avisar por WhatsApp ──
    const pedidoReconsulta = aplicar.reconsulta;
    const sugerida = nota.reconsultaSugerida;
    if (sugerida?.fechaHora && sugerida.estado === "pendiente") {
      if (pedidoReconsulta?.activo) {
        try {
          if (pedidoReconsulta.fechaHora) {
            const f = new Date(pedidoReconsulta.fechaHora);
            if (isNaN(f.getTime())) throw new Error("La fecha de la reconsulta no es válida");
            registrarCorreccion({
              medicoPhone, tipo: "reconsulta", consultaId: consulta._id, campo: "fechaHora",
              valorSugerido: sugerida.fechaHora?.toISOString(), valorFinal: f.toISOString(),
            });
            sugerida.fechaHora = f;
          }
          if (!paciente.telefono) throw new Error("El paciente no tiene teléfono cargado");

          const medico = await Medico.findOne({ phone: medicoPhone }).lean();
          const token = generarToken(paciente.telefono, "reserva_publica", 45 * 60 * 1000);
          const link = `${CONFIG.APP_URL}/reservar.html?token=${token}`;
          const primerNombre = String(paciente.nombre || "").split(" ")[0];
          // Pasan días entre que se cierra la consulta y el paciente escribió
          // por última vez, así que esto cae fuera de la ventana casi siempre.
          const cuando = formatearFechaCompleta(sugerida.fechaHora);
          const quien = medico?.nombre || "Su médico";
          const texto = `Hola ${primerNombre} 👋 ${quien} le sugiere su próxima consulta para el ${cuando}.\n\nElija el horario que le quede mejor acá (va a ver la disponibilidad real):\n${link}\n\n(el enlace es válido por 45 minutos)`;
          await enviarTextoOPlantilla(paciente.telefono, texto,
            { plantilla: PLANTILLAS.reconsulta, parametros: [primerNombre, quien, cuando, link], idioma: medico?.idioma });

          // Anotada apenas sale: si después algo falla y se confirma de
          // nuevo, el paciente no recibe el mensaje dos veces.
          sugerida.estado = "confirmada";
          await ConsultaMedica.updateOne({ _id: consulta._id }, { $set: {
            "notaClinica.reconsultaSugerida.estado": "confirmada", "notaClinica.reconsultaSugerida.fechaHora": sugerida.fechaHora,
          } });
          aplicado.push("Reconsulta avisada por WhatsApp");
          registrar({ req, medicoPhone, accion: "reconsulta_confirmada", recurso: `ConsultaMedica:${consulta._id}` });
        } catch (e) {
          log.error("[CONFIRMAR/reconsulta]", e.message);
          fallado.push("No se pudo avisar la reconsulta por WhatsApp: " + e.message);
        }
      } else {
        sugerida.estado = "descartada";
      }
    }

    // ── 3. Tratamientos sugeridos → presupuesto ──
    const tratamientosPedidos = Array.isArray(aplicar.tratamientos) ? aplicar.tratamientos : [];
    for (const item of (nota.tratamientosSugeridos || [])) {
      if (item.estado !== "pendiente") continue;
      const pedido = tratamientosPedidos.find(t => String(t?.itemId) === String(item._id));
      if (!pedido) { item.estado = "descartado"; continue; }
      try {
        const nombre = String(pedido.nombre || item.catalogoNombreSugerido || item.itemMencionado || "").trim();
        if (!nombre) throw new Error("falta el nombre");
        const precio = Number(pedido.precio);
        if (!Number.isFinite(precio) || precio < 0) throw new Error("precio inválido");
        let piezaFdi = pedido.piezaFdi !== undefined && pedido.piezaFdi !== "" ? Number(pedido.piezaFdi) : item.piezaFdi;
        if (piezaFdi !== null && piezaFdi !== undefined && !Number.isFinite(piezaFdi)) throw new Error("pieza inválida");

        registrarCorreccion({ medicoPhone, tipo: "tratamiento", consultaId: consulta._id, campo: "nombre", valorSugerido: item.catalogoNombreSugerido, valorFinal: nombre });
        registrarCorreccion({ medicoPhone, tipo: "tratamiento", consultaId: consulta._id, campo: "piezaFdi", valorSugerido: item.piezaFdi, valorFinal: piezaFdi });

        await crearUnaVez(TratamientoPlan, {
          pacienteId: consulta.pacienteId, medicoPhone, nombre, precio,
          piezaFdi: piezaFdi ?? null, estado: "pendiente",
          consultaId: consulta._id, claveConfirmacion: claveDe("trat", item._id),
        });
        item.estado = "agregado";
        aplicado.push(`Tratamiento al presupuesto: ${nombre}`);
      } catch (e) {
        fallado.push(`No se pudo agregar el tratamiento "${item.itemMencionado}": ${e.message}`);
      }
    }

    // ── 4. Medicación al Kardex ──
    const medsPedidos = Array.isArray(aplicar.medicamentos) ? aplicar.medicamentos : [];
    for (const i of medsPedidos) {
      const m = (nota.medicamentosRecetados || [])[Number(i)];
      if (!m?.nombre) continue;
      try {
        await crearUnaVez(Medicamento, {
          pacienteId: consulta.pacienteId, medicoPhone,
          nombre: m.nombre, dosis: m.dosis || "", frecuencia: m.frecuencia || "",
          consultaId: consulta._id, claveConfirmacion: claveDe("med", m.nombre, m.dosis, m.frecuencia),
        });
        aplicado.push(`Medicación: ${m.nombre}`);
      } catch (e) {
        fallado.push(`No se pudo cargar el medicamento "${m.nombre}": ${e.message}`);
      }
    }

    // ── 5. Antecedentes y vacunas ──
    for (const i of (Array.isArray(aplicar.antecedentesPersonales) ? aplicar.antecedentesPersonales : [])) {
      const texto = (nota.antecedentesPersonalesNuevos || [])[Number(i)];
      if (!texto) continue;
      if (!paciente.antecedentesPersonales?.includes(texto)) {
        paciente.antecedentesPersonales = [...(paciente.antecedentesPersonales || []), texto];
        aplicado.push(`Antecedente: ${texto}`);
      }
    }
    for (const i of (Array.isArray(aplicar.antecedentesFamiliares) ? aplicar.antecedentesFamiliares : [])) {
      const a = (nota.antecedentesFamiliaresNuevos || [])[Number(i)];
      if (!a?.condicion) continue;
      const yaEsta = (paciente.antecedentesFamiliares || []).some(x => x.parentesco === (a.parentesco || "") && x.condicion === a.condicion);
      if (!yaEsta) paciente.antecedentesFamiliares = [...(paciente.antecedentesFamiliares || []), { parentesco: a.parentesco || "", condicion: a.condicion }];
      aplicado.push(`Antecedente familiar: ${a.parentesco} — ${a.condicion}`);
    }
    await paciente.save();

    for (const i of (Array.isArray(aplicar.vacunas) ? aplicar.vacunas : [])) {
      const v = (nota.vacunasMencionadas || [])[Number(i)];
      if (!v?.nombre) continue;
      try {
        // La fecha se guarda como YYYY-MM-DD en hora local: usar toISOString()
        // directo adelantaría un día las consultas cargadas de noche en
        // Bolivia (UTC-4).
        const base = new Date(consulta.createdAt);
        const fecha = v.fecha || new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        await crearUnaVez(Vacuna, {
          pacienteId: consulta.pacienteId, medicoPhone,
          nombre: v.nombre, dosis: v.dosis || "", fecha,
          consultaId: consulta._id, claveConfirmacion: claveDe("vac", v.nombre, v.dosis, fecha),
        });
        aplicado.push(`Vacuna: ${v.nombre}`);
      } catch (e) {
        fallado.push(`No se pudo cargar la vacuna "${v.nombre}": ${e.message}`);
      }
    }

    // ── 5b. Lo que la IA entendió para el mapa, lo que el médico dejó marcado ──
    // Solo números enteros: Number(null) es 0, y un índice vacío cargaba el primero.
    const elegidos = (lista, indices) => [...new Set(Array.isArray(indices) ? indices : [])]
      .filter(Number.isInteger).map(i => (lista || [])[i]).filter(Boolean);
    try {
      aplicado.push(...await aplicarHallazgosAlMapa(consulta, paciente, medicoPhone, {
        ocular: elegidos(nota.examenOcularSugerido, aplicar.examenOcular),
        odonto: elegidos(nota.odontogramaSugerido, aplicar.odontograma),
        gineco: elegidos(nota.ginecoSugerido, aplicar.gineco),
      }));
    } catch (e) {
      log.error("[CONFIRMAR/mapa]", e.message);
      fallado.push("No se pudieron cargar los hallazgos al mapa: " + e.message);
    }

    // ── 6. Receta con los medicamentos (ya corregidos arriba) ──
    let recetaId = null;
    if (aplicar.receta && (nota.medicamentosRecetados || []).length) {
      try {
        const datosReceta = {
          pacienteId: consulta.pacienteId, medicoPhone, consultaId: consulta._id, claveConfirmacion: "receta",
          fecha: new Date(),
          medicamentos: nota.medicamentosRecetados.map(m => ({
            nombre: m.nombre, dosis: m.dosis || "", frecuencia: m.frecuencia || "", duracion: "",
          })),
        };
        // Una sola por consulta: si ya salió en una confirmación que se cortó, es esa.
        recetaId = (await crearUnaVez(Receta, datosReceta))?._id
          || (await Receta.findOne({ consultaId: consulta._id, claveConfirmacion: "receta" }).select("_id").lean())?._id || null;
        aplicado.push("Receta generada");
      } catch (e) {
        fallado.push("No se pudo generar la receta: " + e.message);
      }
    }

    consulta.confirmadaEn = new Date();
    await consulta.save();
    await ConsultaMedica.updateOne({ _id: consulta._id }, { $set: { confirmandoDesde: null } }).catch(() => {});
    // Lo que acaba de confirmar (y lo que corrigió) ya cuenta desde la
    // próxima consulta: su vocabulario y su forma de escribir
    // (services/vocabularioMedico.js, services/adaptacion.js).
    adaptacion.olvidar(medicoPhone);
    // El resumen previo del paciente salió de esta nota como borrador: se
    // rehace con la confirmada. Y el hilo, si el médico la corrigió
    // (revisión integral del 11 de octubre de 2026, S03).
    regenerarBriefClinico(consulta.pacienteId).catch(e => log.error("[BRIEF_CLINICO]", e.message));
    if (consulta.notaEditadaPorMedico) generarHilo(consulta._id, { alConfirmar: true }).catch(e => log.error("[HILO_CLINICO]", e.message));
    registrar({ req, medicoPhone, accion: "consulta_confirmada", recurso: `ConsultaMedica:${consulta._id}` });

    res.json({ ok: true, aplicado, fallado, recetaId });
  }

  // ─── RECONSULTA POR VOZ: confirmar o descartar lo que detectó la IA ─────
  // El médico siempre revisa antes de que le llegue algo al paciente — acá
  // solo se llega después de que él tocó "Confirmar" en la nota clínica.
  app.post("/medico/consultas/:id/reconsulta/confirmar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    const sugerida = consulta.notaClinica?.reconsultaSugerida;
    if (!sugerida?.fechaHora) throw new ErrorHttp(400, "Esta consulta no tiene una reconsulta sugerida");
    if (sugerida.estado !== "pendiente") throw new ErrorHttp(409, "Esta sugerencia ya fue confirmada o descartada");

    // El médico pudo haber ajustado la fecha/hora antes de confirmar —
    // guardamos la que propuso la IA para poder comparar después.
    const fechaOriginal = sugerida.fechaHora;
    if (req.body?.fechaHora) {
      const f = new Date(req.body.fechaHora);
      if (isNaN(f.getTime())) throw new ErrorHttp(400, "Fecha inválida");
      sugerida.fechaHora = f;
    }
    registrarCorreccion({
      medicoPhone, tipo: "reconsulta", consultaId: consulta._id, campo: "fechaHora",
      valorSugerido: fechaOriginal?.toISOString(), valorFinal: sugerida.fechaHora?.toISOString(),
    });

    const paciente = await obtenerOFallar(Paciente, { _id: consulta.pacienteId, medicoPhone }, "Paciente no encontrado");
    if (!paciente.telefono) throw new ErrorHttp(400, "Este paciente no tiene teléfono cargado — no se le puede escribir por WhatsApp.");

    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    const token = generarToken(paciente.telefono, "reserva_publica", 45 * 60 * 1000);
    const link = `${CONFIG.APP_URL}/reservar.html?token=${token}`;
    const primerNombre = String(paciente.nombre || "").split(" ")[0];

    const cuando = formatearFechaCompleta(sugerida.fechaHora);
    const quien = medico?.nombre || "Su médico";
    const texto = `Hola ${primerNombre} 👋 ${quien} le sugiere su próxima consulta para el ${cuando}.\n\nElija el horario que le quede mejor acá (va a ver la disponibilidad real):\n${link}\n\n(el enlace es válido por 45 minutos)`;
    await enviarTextoOPlantilla(paciente.telefono, texto,
      { plantilla: PLANTILLAS.reconsulta, parametros: [primerNombre, quien, cuando, link], idioma: medico?.idioma }).catch(e => {
      log.error(`[RECONSULTA] no se pudo mandar el WhatsApp a ${paciente.telefono}:`, e.message);
      throw new ErrorHttp(502, "No se pudo mandar el WhatsApp — revisá que esté conectado en Agenda.");
    });

    sugerida.estado = "confirmada";
    await consulta.save();
    registrar({ req, medicoPhone, accion: "reconsulta_confirmada", recurso: `ConsultaMedica:${consulta._id}` });
    res.json({ ok: true });
  }));

  app.post("/medico/consultas/:id/reconsulta/descartar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    const sugerida = consulta.notaClinica?.reconsultaSugerida;
    if (!sugerida?.fechaHora) throw new ErrorHttp(400, "Esta consulta no tiene una reconsulta sugerida");
    sugerida.estado = "descartada";
    await consulta.save();
    res.json({ ok: true });
  }));

  // ─── TRATAMIENTOS SUGERIDOS (Symphomed Odonto): agregar al presupuesto o
  // descartar. Igual que la reconsulta, el odontólogo siempre revisa y
  // puede corregir nombre/precio/pieza antes de que se cree el ítem real —
  // la IA solo emparejó con el catálogo, nunca facturó sola. ─────────────
  app.post("/medico/consultas/:id/tratamientos-sugeridos/:itemId/agregar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    const item = consulta.notaClinica?.tratamientosSugeridos?.id(req.params.itemId);
    if (!item) throw new ErrorHttp(404, "Ese tratamiento sugerido no existe");
    if (item.estado !== "pendiente") throw new ErrorHttp(409, "Este tratamiento ya fue agregado o descartado");

    const nombre = String(req.body?.nombre || item.catalogoNombreSugerido || item.itemMencionado || "").trim();
    if (!nombre) throw new ErrorHttp(400, "Falta el nombre del tratamiento");
    const precio = Number(req.body?.precio);
    if (!Number.isFinite(precio) || precio < 0) throw new ErrorHttp(400, "Precio inválido");
    let piezaFdi = req.body?.piezaFdi !== undefined && req.body?.piezaFdi !== "" ? Number(req.body.piezaFdi) : item.piezaFdi;
    if (piezaFdi !== null && piezaFdi !== undefined && !Number.isFinite(piezaFdi)) throw new ErrorHttp(400, "Pieza inválida");

    registrarCorreccion({ medicoPhone, tipo: "tratamiento", consultaId: consulta._id, campo: "nombre", valorSugerido: item.catalogoNombreSugerido, valorFinal: nombre });
    registrarCorreccion({ medicoPhone, tipo: "tratamiento", consultaId: consulta._id, campo: "piezaFdi", valorSugerido: item.piezaFdi, valorFinal: piezaFdi });

    const tratamiento = await TratamientoPlan.create({
      pacienteId: consulta.pacienteId, medicoPhone, nombre, precio,
      piezaFdi: piezaFdi ?? null, estado: "pendiente",
    });

    item.estado = "agregado";
    await consulta.save();
    registrar({ req, medicoPhone, accion: "tratamiento_agregado_por_voz", recurso: `ConsultaMedica:${consulta._id}` });
    res.json({ ok: true, tratamiento });
  }));

  app.post("/medico/consultas/:id/tratamientos-sugeridos/:itemId/descartar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    const item = consulta.notaClinica?.tratamientosSugeridos?.id(req.params.itemId);
    if (!item) throw new ErrorHttp(404, "Ese tratamiento sugerido no existe");
    if (item.estado !== "pendiente") throw new ErrorHttp(409, "Este tratamiento ya fue agregado o descartado");
    item.estado = "descartado";
    await consulta.save();
    res.json({ ok: true });
  }));
};

// ═══ LA NOTA CLÍNICA, A PARTIR DE LA TRANSCRIPCIÓN ═════════════════════════
//
// La usan dos caminos: el de siempre (termina de transcribirse la consulta)
// y «Volver a generar la nota», que el médico usa cuando la nota salió con
// error o vacía. Por eso vive aparte: el segundo tiene que hacer exactamente
// lo mismo que el primero, con el mismo contexto de especialidad y el mismo
// guardado defensivo, no una versión parecida.
// El contexto con que la IA escribe la nota: el mismo para la nota de
// siempre, para el borrador en vivo y para la verificación. Si fueran
// distintos, el borrador diría una cosa y la nota guardada otra.
async function contextoDeNota(paciente, medicoPhone) {
  const medicamentosActivos = await Medicamento.find({ pacienteId: paciente._id, medicoPhone, fechaFin: null })
    .select("nombre").lean();

  // Solo para odontología y estética (Symphomed Face): le pasamos el
  // catálogo de precios del consultorio para que la IA pueda
  // emparejar tratamientos mencionados ("hay que sellar esto",
  // "hay que hacer un relleno acá") con el ítem correcto.
  const medico = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad").lean();
  // Lo que este médico receta y lo que ya corrigió: la IA reconoce sus
  // marcas como medicamentos y no repite un error que él ya arregló. Y lo que
  // aprendió de él: sus palabras y cómo escribe (services/adaptacion.js).
  const [medicamentosHabituales, correccionesMedicamentos, deEl] = await Promise.all([
    medicamentosDelMedico(medicoPhone, 60),
    correccionesDelMedico(medicoPhone, 30),
    adaptacion.paraLaNota(medicoPhone),
  ]);
  let catalogoTratamientos = [];
  if (["odontologia", "estetica"].includes(medico?.tipoEspecialidad)) {
    const catalogo = await CatalogoTratamiento.find({ medicoPhone }).select("nombre").lean();
    catalogoTratamientos = catalogo.map(c => c.nombre);
  }
  // Solo para oftalmología (Symphomed Visión): la lista de estructuras
  // oculares válidas, para que la IA narre el examen por ojo.
  const esOftalmologia = medico?.tipoEspecialidad === "oftalmologia";
  const esOdontologia = medico?.tipoEspecialidad === "odontologia";
  const esVeterinaria = medico?.tipoEspecialidad === "veterinaria";
  const esGinecologia = medico?.tipoEspecialidad === "ginecologia";

  return {
    esOftalmologia, esOdontologia, esGinecologia,
    contexto: {
      // La nota de enfermería en vez de la médica (services/notaClinica.js).
      enfermeria: medico?.tipoEspecialidad === "enfermeria",
      antecedentesPersonales: paciente.antecedentesPersonales || [],
      antecedentesFamiliares: paciente.antecedentesFamiliares || [],
      medicamentosActivos: medicamentosActivos.map(m => m.nombre),
      medicamentosHabituales,
      correccionesMedicamentos,
      adaptacion: deEl,
      catalogoTratamientos,
      estructurasOculares: esOftalmologia ? ESTRUCTURAS_OCULARES : [],
      estadosPiezaDental: esOdontologia ? ESTADOS_PIEZA_DENTAL : [],
      organosGineco: esGinecologia ? ORGANOS_GINECO : [],
      hallazgosGineco: esGinecologia ? HALLAZGOS_GINECO : [],
      veterinaria: esVeterinaria,
      especie: esVeterinaria ? paciente.especie : "",
      raza: esVeterinaria ? paciente.raza : "",
    },
  };
}

// Lo que se le muestra al médico como nota: de la transcripción completa (lo
// de siempre) o, si se le pasa, de otro texto —el de la vista previa en vivo—
// o de un borrador que la IA ya escribió para ese mismo texto
// (services/notaEnVivo.js).
async function producirNota(consulta, paciente, medicoPhone, idioma, { texto, notaHecha } = {}) {
  try {
    const { contexto } = await contextoDeNota(paciente, medicoPhone);
    // El mismo idioma con el que se transcribió: una nota en español
    // sobre una consulta en portugués obliga al médico a traducir de
    // vuelta lo que él mismo dijo.
    consulta.notaClinica = notaHecha
      || await generarNotaClinica(texto ?? consulta.transcripcionCompleta, contexto, idioma);
    consulta.notaClinicaEstado = "completado";
    consulta.notaClinicaError = undefined;
    // La de enfermería escrita en vivo no espera la verificación: lo que se
    // verifica son los medicamentos recetados, y esa nota no receta. Decir
    // «verificada con el audio completo» sobre algo que nadie comparó sería
    // inventar una certeza (ver intentarVerificar).
    if (consulta.notaClinica?.formato === "enfermeria" && consulta.notaFuente === "vivo") {
      consulta.verificacion = { estado: "" };
    }

    // Lo que la IA entendió para el mapa de la especialidad (odontograma,
    // mapa ocular, mapa ginecológico) queda en la nota como sugerencia: se
    // carga recién al confirmar, lo que el médico deja marcado
    // (aplicarHallazgosAlMapa). Antes se cargaba solo acá, sin que nadie lo
    // revisara (revisión integral del 11 de octubre de 2026, S05).
  } catch (e) {
    log.error("[NOTA_CLINICA]", e.response?.data || e.message);
    consulta.notaClinicaEstado = "error";
    consulta.notaClinicaError = e.message;
  }
  // Guardado defensivo: aparte de sanearNota() en notaClinica.js, si
  // por lo que sea el documento igual queda con algo que Mongo no
  // puede castear, que se pierda SOLO la nota clínica de esta
  // consulta (nunca el resto del servidor). Antes esto podía tirar
  // el mismo CastError de nuevo en el .catch de abajo — como esa
  // segunda falla no la agarraba nadie, tumbaba el proceso entero
  // para todos los médicos, no solo a esta consulta.
  try {
    await consulta.save();
  } catch (e) {
    log.error("[NOTA_CLINICA] No se pudo guardar la nota clínica generada (dato inesperado de la IA):", e.message);
    // OJO: reasignar consulta.notaClinica = undefined y volver a
    // guardar ESTE MISMO documento en memoria NO alcanza — Mongoose
    // deja la ruta inválida marcada adentro del subdocumento y el
    // segundo consulta.save() revienta con el mismo CastError
    // (comprobado). Un update directo a la base, en cambio, no
    // arrastra ese estado inválido en memoria.
    await ConsultaMedica.updateOne(
      { _id: consulta._id },
      { $unset: { notaClinica: 1 }, $set: { notaClinicaEstado: "error", notaClinicaError: "No se pudo guardar la nota clínica (formato inesperado)." } }
    ).catch(e2 => log.error("[NOTA_CLINICA] Tampoco se pudo guardar el estado de error:", e2.message));
    consulta.notaClinicaEstado = "error"; // para que el chequeo de brief clínico de abajo no dispare con datos corruptos
  }
}

// ═══ AVISARLE AL MÉDICO, QUE ES EL QUE ESTÁ ESPERANDO ══════════════════════
//
// Esto tarda: transcribir una consulta de veinte minutos y escribir la nota
// no es instantáneo. Hasta ahora el único que se enteraba era el que dejaba
// la pantalla abierta —consulta cada ocho segundos— y el médico normal NO la
// deja abierta: cierra y atiende al siguiente.
//
// Van los dos avisos y hacen cosas distintas:
//   · avisarCambio  → las pantallas ABIERTAS se actualizan al toque,
//                     sin esperar los ocho segundos del sondeo.
//   · notificarMedico → el que se fue de la pantalla se entera igual.
//
// Ninguno de los dos puede tumbar la nota si falla: ya está guardada.
function avisarNotaLista(consulta, paciente, medicoPhone) {
  avisarCambio(medicoPhone);
  const listo = consulta.notaClinicaEstado === "completado";
  notificarMedico(medicoPhone, {
    titulo: listo ? "Nota clínica lista" : "La nota clínica falló",
    cuerpo: listo
      ? `${paciente.nombre} — ya la podés revisar y firmar.`
      : `${paciente.nombre} — no se pudo generar. Entrá para ver qué pasó.`,
    // Abre DERECHO en esa consulta. Una notificación que deja al médico
    // en el panel buscando cuál era no le ahorra nada.
    url: `/?consulta=${consulta._id}`,
  }).catch(e => log.error("[CONSULTA_MEDICA] no se pudo notificar:", e.message));

  if (listo) {
    regenerarBriefClinico(consulta.pacienteId).catch(e => log.error("[BRIEF_CLINICO]", e.message));
    // El hilo con las consultas anteriores. Va acá y no antes porque
    // necesita la nota de HOY ya escrita: la pregunta es "dado este
    // motivo, ¿qué del historial se relaciona?", y sin motivo no hay
    // pregunta.
    //
    // Sin await y con catch: es un extra. Si falla, la consulta y su
    // nota clínica quedan intactas, que es lo que importa.
    generarHilo(consulta._id).catch(e => log.error("[HILO_CLINICO]", e.message));
  }
}

// ═══ VERIFICAR LA NOTA EN VIVO CON LA TRANSCRIPCIÓN COMPLETA ════════════════
//
// La llaman los dos caminos que terminan por separado —la nota en vivo y la
// transcripción completa— y hace algo solo cuando los dos terminaron. Así no
// importa cuál llega primero.
//
// Lo que compara es lo que no se puede escuchar mal sin consecuencias: qué
// medicamentos, en qué dosis y cada cuánto (services/notaEnVivo.js). Las
// diferencias se guardan y se MUESTRAN; la nota no se toca.
async function intentarVerificar(consultaId) {
  const c = await ConsultaMedica.findById(consultaId);
  if (!c || c.notaFuente !== "vivo" || c.confirmadaEn) return;
  if (c.estado === "procesando" || c.notaClinicaEstado === "pendiente") return;   // falta uno de los dos
  // La nota de enfermería no receta: no hay nada que comparar (producirNota).
  if (c.notaClinicaEstado === "completado" && c.notaClinica?.formato === "enfermeria") return;

  // La transcripción completa falló: la nota en vivo está, pero nadie la
  // comparó con el audio. Se le dice al médico, y puede confirmar igual.
  if (c.estado === "error") {
    await ConsultaMedica.updateOne({ _id: c._id, "verificacion.estado": { $in: ["pendiente", ""] } },
      { $set: { "verificacion.estado": "error" } });
    avisarCambio(c.medicoPhone);
    return;
  }

  const paciente = await Paciente.findOne({ _id: c.pacienteId, medicoPhone: c.medicoPhone });
  if (!paciente) return;
  const medico = await Medico.findOne({ phone: c.medicoPhone }).select("idioma").lean();

  // La nota en vivo falló (la IA no contestó): la escribe la transcripción
  // completa, como antes. El médico esperó más, pero no se quedó sin nota.
  if (c.notaClinicaEstado === "error") {
    const r = await ConsultaMedica.updateOne(
      { _id: c._id, notaFuente: "vivo", notaClinicaEstado: "error" },
      { $set: { notaFuente: "audio", notaClinicaEstado: "pendiente", "verificacion.estado": "" } });
    if (!r.modifiedCount) return;
    const actual = await ConsultaMedica.findById(c._id);
    await producirNota(actual, paciente, c.medicoPhone, medico?.idioma);
    avisarNotaLista(actual, paciente, c.medicoPhone);
    return;
  }

  // Solo uno verifica, aunque los dos caminos lleguen a la vez.
  const reclamo = await ConsultaMedica.updateOne(
    { _id: c._id, "verificacion.estado": "pendiente" }, { $set: { "verificacion.estado": "verificando" } });
  if (!reclamo.modifiedCount) return;

  const inicio = Date.now();
  let set;
  try {
    const { contexto } = await contextoDeNota(paciente, c.medicoPhone);
    const notaAudio = await generarNotaClinica(c.transcripcionCompleta || "", contexto, medico?.idioma);
    const diferencias = compararMedicamentos(c.notaClinica, notaAudio);
    // La otra nota también la escribió una IA y puede equivocarse igual: lo
    // que no aparece en el TEXTO de la transcripción completa se marca aunque
    // las dos notas coincidan.
    const correcciones = await correccionesDelMedico(c.medicoPhone, 300).catch(() => []);
    for (const indice of medicamentosNoNombrados(c.notaClinica, c.transcripcionCompleta || "", correcciones)) {
      if (diferencias.some(d => d.indice === indice)) continue;
      const m = c.notaClinica.medicamentosRecetados[indice];
      diferencias.push({ tipo: "noMencionado", indice, enNota: [m.nombre, m.dosis, m.frecuencia].filter(Boolean).join(" "), enAudio: "" });
    }
    set = { "verificacion.estado": diferencias.length ? "diferencias" : "ok", "verificacion.diferencias": diferencias };
  } catch (e) {
    // Una transcripción de un audio en silencio no tiene nota que comparar:
    // tampoco es motivo para trabar la consulta.
    log.warn(`[NOTA_EN_VIVO] no se pudo verificar la consulta ${c._id}:`, e.message);
    set = { "verificacion.estado": "error" };
  }
  const verificacionMs = Date.now() - inicio;
  await ConsultaMedica.updateOne({ _id: c._id }, { $set: { ...set, "tiempos.verificacionMs": verificacionMs } });
  log.info(`[TIEMPOS] consulta ${c._id}: verificación ${Math.round(verificacionMs / 1000)} s → ${set["verificacion.estado"]}${set["verificacion.diferencias"]?.length ? ` (${set["verificacion.diferencias"].length} diferencia(s))` : ""}`);
  avisarCambio(c.medicoPhone);
  if (set["verificacion.estado"] === "diferencias") {
    notificarMedico(c.medicoPhone, {
      titulo: "Revisá los medicamentos de la nota",
      cuerpo: `${paciente.nombre} — el audio completo no coincide en ${set["verificacion.diferencias"].length} punto(s).`,
      url: `/?consulta=${c._id}`,
    }).catch(e => log.error("[CONSULTA_MEDICA] no se pudo notificar:", e.message));
  }
}


// ═══ TRANSCRIBIR, Y DESPUÉS LA NOTA (en segundo plano) ══════════════════════
//
// Lo que pasa después del 202. Lo usan la subida y el arranque, que retoma lo
// que un reinicio dejó a medias (retomarConsultas, abajo). Nunca tira: lo que
// falla queda anotado en la consulta y se le avisa al médico.
// ═══ CUANDO LA TRANSCRIPCIÓN FALLA ═════════════════════════════════════════
//
// Antes, cualquier falla borraba el audio y la consulta quedaba perdida: un
// corte de red de un segundo con AssemblyAI, una demora, o la base que no
// contestó justo al guardar una transcripción que ya estaba hecha. El
// teléfono ya había borrado su copia al recibir el 202, así que no quedaba
// nada (revisión integral del 11 de octubre de 2026, S04).
//
// Ahora el audio se borra solo cuando la transcripción quedó guardada, o
// cuando el problema es el audio mismo (AssemblyAI lo recibió y no pudo con
// él: services/assemblyai.js, «definitiva»). Lo demás es pasajero:
//   · guardar el resultado se reintenta en el momento, unos segundos;
//   · la transcripción se reintenta con el audio del disco, esperando cada
//     vez más (AJUSTES_AUDIO.ESPERAS_MS);
//   · agotados los intentos, la consulta queda con error y el audio guardado
//     RETENER_MS, para reintentar a mano desde la consulta.
// Un reinicio en el medio no corta la cuenta: el intento queda en la base y
// retomarConsultas sigue desde ahí.
const AJUSTES_AUDIO = {
  ESPERAS_MS: [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000],
  GUARDAR_ESPERAS_MS: [1000, 3000, 9000],
  RETENER_MS: 7 * 86400 * 1000,
};

async function conReintentos(fn, esperas) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= esperas.length) throw e;
      await new Promise(r => setTimeout(r, esperas[i]));
    }
  }
}

async function fallaDeTranscripcion(consulta, { intento = 0 }, e) {
  const medicoPhone = consulta.medicoPhone;
  const motivo = e.response?.data?.error || e.message;
  if (e.definitiva) {
    log.error(`[CONSULTA_MEDICA] consulta ${consulta._id}: AssemblyAI no pudo con el audio:`, motivo);
    await audioPendiente.borrar(consulta._id).catch(e2 => log.error("[CONSULTA_MEDICA] no se pudo borrar el audio:", e2.message));
    return marcarTranscripcionFallida(consulta._id, medicoPhone, motivo);
  }
  const siguiente = intento + 1;
  const espera = AJUSTES_AUDIO.ESPERAS_MS[intento];
  log.error(`[CONSULTA_MEDICA] consulta ${consulta._id}: falla pasajera transcribiendo (intento ${siguiente}):`, motivo);
  // Si la base tampoco contesta, el intento igual se cuenta acá, en la cadena.
  await ConsultaMedica.updateOne({ _id: consulta._id, estado: "procesando" }, { $set: { intentosTranscripcion: siguiente } }).catch(() => {});
  if (espera !== undefined) {
    const t = setTimeout(() => reintentarTranscripcion(consulta._id, siguiente)
      .catch(e2 => log.error(`[CONSULTA_MEDICA] no se pudo reintentar ${consulta._id}:`, e2.message)), espera);
    t.unref?.();
    return;
  }
  const hasta = new Date(Date.now() + AJUSTES_AUDIO.RETENER_MS);
  await ConsultaMedica.updateOne({ _id: consulta._id, estado: "procesando" }, { $set: { audioRetenidoHasta: hasta } }).catch(() => {});
  return marcarTranscripcionFallida(consulta._id, medicoPhone, `No se pudo transcribir después de varios intentos: ${motivo}`);
}

// El intento que sigue, con el audio del disco: no se tiene en memoria
// durante la espera (una consulta de una hora pesa decenas de MB).
async function reintentarTranscripcion(consultaId, intento) {
  let consulta, paciente, audio;
  try {
    consulta = await ConsultaMedica.findOne({ _id: consultaId, estado: "procesando" });
    if (!consulta) return;   // ya terminó por otro lado
    paciente = await Paciente.findOne({ _id: consulta.pacienteId, medicoPhone: consulta.medicoPhone });
    audio = await audioPendiente.leer(consultaId);
  } catch (e) {
    // La base sigue sin contestar: cuenta como otro intento pasajero.
    if (consulta) return fallaDeTranscripcion(consulta, { intento }, e);
    const t = setTimeout(() => reintentarTranscripcion(consultaId, intento).catch(() => {}),
      AJUSTES_AUDIO.ESPERAS_MS[Math.min(intento, AJUSTES_AUDIO.ESPERAS_MS.length - 1)]);
    t.unref?.();
    return;
  }
  if (!paciente || !audio) {
    await audioPendiente.borrar(consultaId).catch(() => {});
    return marcarTranscripcionFallida(consultaId, consulta.medicoPhone,
      !audio ? "No se pudo leer el audio guardado." : "El paciente de esta consulta ya no está.");
  }
  const multicanal = Boolean(await Teleconsulta.exists({ consultaId }).catch(() => false));
  return transcribirEnSegundoPlano(consulta, paciente, audio, { multicanal, intento });
}

async function transcribirEnSegundoPlano(consulta, paciente, audioBuffer, { multicanal, intento = 0 }) {
  const medicoPhone = consulta.medicoPhone;
  let medicoParaVocabulario, duracionSegundos, transcripcionMs, t;
  try {
    // La especialidad afina el vocabulario; el idioma decide en qué lengua
    // se transcribe y si hay Medical Mode (ver services/assemblyai.js).
    // Y lo que este médico receta seguido va primero (services/vocabularioMedico.js),
    // con sus palabras: lo que corrigió y sus términos (services/adaptacion.js).
    medicoParaVocabulario = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad idioma").lean();
    const [delMedico, propios] = await Promise.all([
      medicamentosDelMedico(medicoPhone), adaptacion.vocabularioParaTranscribir(medicoPhone),
    ]);
    const inicioTranscripcion = Date.now();
    t = await transcribirConsultaMedica(audioBuffer, medicoParaVocabulario?.tipoEspecialidad, medicoParaVocabulario?.idioma, { multicanal, delMedico, propios, maxSegundos: consulta.limitesAudio?.segundos });
    transcripcionMs = Date.now() - inicioTranscripcion;
    duracionSegundos = t.duracionSegundos;
  } catch (e) {
    return fallaDeTranscripcion(consulta, { intento }, e);
  }
  try {
    // Un update y no consulta.save(): mientras AssemblyAI trabajaba, la
    // nota en vivo pudo haberse guardado en este mismo documento, y el
    // objeto en memoria no la tiene. Si la base no contesta, se insiste
    // unos segundos antes de tirar una transcripción que ya se pagó.
    await conReintentos(() => ConsultaMedica.updateOne({ _id: consulta._id }, { $set: {
      estado: "completado", transcripcionCompleta: t.transcripcionCompleta, segmentos: t.segmentos, duracionSegundos,
      "tiempos.transcripcionMs": transcripcionMs, audioRetenidoHasta: null,
    } }), AJUSTES_AUDIO.GUARDAR_ESPERAS_MS);
  } catch (e) {
    return fallaDeTranscripcion(consulta, { intento }, e);
  }
  await extensiones.revisar("audio.completar", { consulta, duracionSegundos })
    .catch(() => log.warn("[CONSULTA_MEDICA] Cupo pendiente de conciliación; la transcripción ya está guardada."));
  // La transcripción ya está guardada: el audio no hace falta más.
  await audioPendiente.borrar(consulta._id).catch(e => log.error("[CONSULTA_MEDICA] no se pudo borrar el audio:", e.message));

  // El cobro va acá y no al subir el audio: recién ahora sabemos que la
  // consulta salió bien. Si AssemblyAI hubiera fallado, el médico no
  // paga nada — y con razón, porque no recibió nada.
  //
  // Va en su propio try: que falle el cobro no puede hacerle perder la
  // consulta al médico. Un cobro perdido lo detecta reconciliar(); una
  // consulta perdida no la recupera nadie. Retomada después de un reinicio,
  // tampoco se cobra dos veces: el cobro es uno por consulta.
  try {
    await cobrarConsulta({ medicoPhone, consultaId: consulta._id });
  } catch (e) {
    log.error(`[SALDO] no se pudo cobrar la consulta ${consulta._id} de ${medicoPhone}:`, e.message);
  }

  try {
    // ¿Quién escribe la nota? Si la nota en vivo ya la reclamó, a esta
    // transcripción le toca verificarla; si no, la escribe ella, como
    // siempre. El reclamo es atómico: nunca la escriben las dos.
    const reclamo = await ConsultaMedica.updateOne(
      { _id: consulta._id, notaFuente: { $in: ["", null] } }, { $set: { notaFuente: "audio" } });
    if (!reclamo.modifiedCount) {
      log.info(`[TIEMPOS] consulta ${consulta._id}: audio ${Math.round(duracionSegundos || 0)} s, transcripción completa ${Math.round(transcripcionMs / 1000)} s (la nota salió en vivo)`);
      await intentarVerificar(consulta._id);
      return;
    }

    const actual = await ConsultaMedica.findById(consulta._id);
    const inicioNota = Date.now();
    await producirNota(actual, paciente, medicoPhone, medicoParaVocabulario?.idioma);
    const notaMs = Date.now() - inicioNota;
    await ConsultaMedica.updateOne({ _id: consulta._id }, { $set: { "tiempos.notaMs": notaMs } }).catch(() => {});
    log.info(`[TIEMPOS] consulta ${consulta._id}: audio ${Math.round(duracionSegundos || 0)} s, transcripción ${Math.round(transcripcionMs / 1000)} s, nota ${Math.round(notaMs / 1000)} s`);
    avisarNotaLista(actual, paciente, medicoPhone);
  } catch (e) {
    // La transcripción está; lo que falló es lo de después. Que la nota no
    // quede «pendiente» para siempre: con error, el médico la vuelve a
    // generar desde la consulta.
    log.error(`[CONSULTA_MEDICA] consulta ${consulta._id}, después de transcribir:`, e.message);
    await ConsultaMedica.updateOne({ _id: consulta._id, notaClinicaEstado: "pendiente", notaFuente: { $ne: "vivo" } },
      { $set: { notaClinicaEstado: "error", notaClinicaError: e.message } }).catch(() => {});
    avisarCambio(medicoPhone);
  }
}

// La transcripción no salió. Si la nota salió en vivo, el médico la tiene: lo
// que falló es la verificación, y eso se le dice en la nota
// (intentarVerificar). Si no, se le avisa: es el caso donde el silencio cuesta
// más caro, el médico esperando algo que no va a llegar nunca. Cuanto antes
// lo sepa, más fresco tiene lo que se habló para escribirlo a mano.
async function marcarTranscripcionFallida(consultaId, medicoPhone, motivo, { avisar = true } = {}) {
  await ConsultaMedica.updateOne({ _id: consultaId, estado: "procesando" }, { $set: { estado: "error", error: motivo } })
    .catch(e => log.error("[CONSULTA_MEDICA] No se pudo guardar el estado de error:", e.message));
  avisarCambio(medicoPhone);
  const ahora = await ConsultaMedica.findById(consultaId).select("notaFuente").lean().catch(() => null);
  if (ahora?.notaFuente === "vivo") return intentarVerificar(consultaId);
  if (!avisar) return;
  notificarMedico(medicoPhone, {
    titulo: "No se pudo transcribir la consulta",
    cuerpo: "Entrá a verla para ver qué pasó.",
    url: `/?consulta=${consultaId}`,
  }).catch(e => log.error("[CONSULTA_MEDICA] no se pudo notificar:", e.message));
}

// ═══ AL ARRANCAR: LO QUE UN REINICIO DEJÓ A MEDIAS ══════════════════════════
//
// Symphomed corre en un solo proceso (pm2, «vitalis»): al arrancar, lo que
// figura en curso desde ANTES de este arranque es de un proceso que ya no
// existe. Lo que empezó después es de este proceso y no se toca. Lo llama
// index.js al arrancar.
//   · Una consulta «procesando» con su audio en disco: se transcribe de nuevo.
//     AssemblyAI cobra esa transcripción otra vez: es lo que cuesta no
//     perderla. Si el mismo audio se corta una y otra vez (un audio que tira
//     el servidor), a la tercera queda en error en vez de intentarlo siempre.
//   · Una «procesando» sin audio (se subió antes de que el audio se guardara
//     en disco): no hay con qué seguir. Queda en error, con el motivo, en vez
//     de «procesando» para siempre.
//   · Una nota que se estaba escribiendo: se escribe de nuevo, de la
//     transcripción o del texto en vivo, que sí están guardados.
//   · Un audio en disco sin consulta en curso: sobró. Se borra. Salvo el de
//     una consulta que falló varias veces por algo pasajero: ese se guarda
//     a propósito hasta «audioRetenidoHasta», para reintentar a mano.
// Lo de más de un día no se retoma solo, porque nadie lo está esperando:
// queda en error sin avisar, y la nota se puede volver a generar.
const ARRANQUE = new Date();
const RETOMAR_HASTA_MS = 24 * 60 * 60 * 1000;
const MAX_REINTENTOS_AUDIO = 2;
const NOTA_INTERRUMPIDA = "Se interrumpió mientras se escribía (el servidor se reinició). Volvé a generarla.";

async function retomarConsultas(arranque = ARRANQUE) {
  const reciente = (c) => arranque - new Date(c.createdAt) < RETOMAR_HASTA_MS;
  const resumen = { transcripciones: 0, sinAudio: 0, notas: 0, sobras: 0 };
  const enDisco = new Set(await audioPendiente.guardados(arranque));
  // Las dos listas antes de tocar nada: marcar una consulta le cambia la
  // fecha de modificación, y la sacaría de la segunda.
  const enCurso = await ConsultaMedica.find({ estado: "procesando", createdAt: { $lt: arranque } }).select("_id medicoPhone pacienteId createdAt").lean();
  const notas = await ConsultaMedica.find({
    notaClinicaEstado: "pendiente", confirmadaEn: null, updatedAt: { $lt: arranque },
    $or: [{ estado: "completado", notaFuente: { $in: ["", null, "audio"] } }, { notaFuente: "vivo" }],
  });

  const aTranscribir = [];
  for (const c of enCurso) {
    const id = String(c._id);
    const conAudio = enDisco.delete(id);
    if (!conAudio) {
      resumen.sinAudio++;
      await marcarTranscripcionFallida(c._id, c.medicoPhone,
        "El servidor se reinició mientras se transcribía esta consulta, y el audio no había quedado guardado.", { avisar: reciente(c) });
      continue;
    }
    const intento = await ConsultaMedica.findOneAndUpdate({ _id: c._id, estado: "procesando" }, { $inc: { reintentosAudio: 1 } }, { new: true });
    const paciente = intento && await Paciente.findOne({ _id: c.pacienteId, medicoPhone: c.medicoPhone });
    if (!intento || !paciente || intento.reintentosAudio > MAX_REINTENTOS_AUDIO) {
      await audioPendiente.borrar(id).catch(() => {});
      if (intento) {
        await marcarTranscripcionFallida(c._id, c.medicoPhone,
          "No se pudo transcribir: el servidor se reinició varias veces mientras lo intentaba.", { avisar: reciente(c) });
      }
      continue;
    }
    aTranscribir.push({ consulta: intento, paciente });
  }
  const retenidos = await ConsultaMedica.find({ _id: { $in: [...enDisco] }, estado: "error", audioRetenidoHasta: { $gt: new Date() } })
    .select("_id").lean();
  for (const c of retenidos) enDisco.delete(String(c._id));
  for (const id of enDisco) {
    await audioPendiente.borrar(id).catch(() => {});
    resumen.sobras++;
  }
  if (enDisco.size) {
    await ConsultaMedica.updateMany({ _id: { $in: [...enDisco] }, audioRetenidoHasta: { $ne: null } }, { $set: { audioRetenidoHasta: null } });
  }

  const aEscribir = [];
  for (const c of notas) {
    const vivo = c.notaFuente === "vivo";
    const texto = vivo ? c.transcripcionEnVivo : c.transcripcionCompleta;
    const paciente = await Paciente.findOne({ _id: c.pacienteId, medicoPhone: c.medicoPhone });
    if (!paciente || !String(texto || "").trim() || !reciente(c)) {
      await ConsultaMedica.updateOne({ _id: c._id, notaClinicaEstado: "pendiente" },
        { $set: { notaClinicaEstado: "error", notaClinicaError: NOTA_INTERRUMPIDA } });
      continue;
    }
    aEscribir.push({ consulta: c, paciente, vivo, texto });
  }

  // De a una por vez, en dos filas: un audio de una hora pesa en memoria, y
  // las notas no tienen por qué esperar a las transcripciones.
  await Promise.all([
    (async () => {
      for (const { consulta, paciente } of aTranscribir) {
        const audio = await audioPendiente.leer(consulta._id).catch(() => null);
        if (!audio) {
          await marcarTranscripcionFallida(consulta._id, consulta.medicoPhone, "No se pudo leer el audio guardado.", { avisar: reciente(consulta) });
          continue;
        }
        resumen.transcripciones++;
        log.info(`[CONSULTA_MEDICA] retomando la transcripción de ${consulta._id} (se cortó al reiniciar)`);
        const multicanal = Boolean(await Teleconsulta.exists({ consultaId: consulta._id }));
        await transcribirEnSegundoPlano(consulta, paciente, audio, { multicanal, intento: consulta.intentosTranscripcion || 0 })
          .catch(e => log.error(`[CONSULTA_MEDICA] no se pudo retomar la transcripción de ${consulta._id}:`, e.message));
      }
    })(),
    (async () => {
      for (const { consulta, paciente, vivo, texto } of aEscribir) {
        resumen.notas++;
        log.info(`[CONSULTA_MEDICA] retomando la nota de ${consulta._id} (se cortó al reiniciar)`);
        try {
          if (!vivo) consulta.notaFuente = "audio";
          const medico = await Medico.findOne({ phone: consulta.medicoPhone }).select("idioma").lean();
          await producirNota(consulta, paciente, consulta.medicoPhone, medico?.idioma, vivo ? { texto } : {});
          if (consulta.notaClinicaEstado === "completado") avisarNotaLista(consulta, paciente, consulta.medicoPhone);
          else avisarCambio(consulta.medicoPhone);
          if (vivo) await intentarVerificar(consulta._id);
        } catch (e) {
          log.error(`[CONSULTA_MEDICA] no se pudo retomar la nota de ${consulta._id}:`, e.message);
        }
      }
    })(),
  ]);
  return resumen;
}

// Los audios guardados para reintentar a mano, cuando vencen: es la voz de
// un paciente y se guarda solo lo necesario. Lo llama index.js cada doce
// horas (y al arrancar ya los borró retomarConsultas).
async function limpiarAudiosRetenidos(ahora = new Date()) {
  const vencidas = await ConsultaMedica.find({ audioRetenidoHasta: { $ne: null, $lte: ahora } }).select("_id").lean();
  for (const c of vencidas) {
    await audioPendiente.borrar(c._id).catch(() => {});
    await ConsultaMedica.updateOne({ _id: c._id }, { $set: { audioRetenidoHasta: null } }).catch(() => {});
  }
  return vencidas.length;
}

module.exports.retomarConsultas = retomarConsultas;
module.exports.limpiarAudiosRetenidos = limpiarAudiosRetenidos;
module.exports.AJUSTES_AUDIO = AJUSTES_AUDIO;
