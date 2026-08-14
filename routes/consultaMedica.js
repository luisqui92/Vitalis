// ChatGo — Consultas médicas: transcripción de audio largo con diarización
// (AssemblyAI). Médicos suben el audio de la consulta (grabado en el celular
// o PC) y reciben la transcripción separada por hablante + nota clínica.
// Login/registro vive aparte en routes/medicoAuth.js.
const express = require("express");
const { CONFIG, log } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, CatalogoTratamiento, TratamientoPlan, ExamenOcular, OJOS, ESTRUCTURAS_OCULARES, ESTADOS_ESTRUCTURA_OCULAR } = require("../db/models");
const { requireAuth, generarToken } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { transcribirConsultaMedica, crearTokenStreaming } = require("../services/assemblyai");
const { generarNotaClinica } = require("../services/notaClinica");
const { regenerarBriefClinico } = require("../services/briefClinico");
const { enviarTexto } = require("../services/baileysWhatsapp");
const { formatearFechaCompleta } = require("../services/reservaCitas");
const { registrar } = require("../services/auditoria");
const { registrarCorreccion } = require("../services/correccionesIA");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

// Acepta el audio como body crudo (no JSON): el cliente manda
// Content-Type: audio/ogg (o wav/mp3/m4a/webm) y el archivo tal cual.
const audioRaw = express.raw({ type: "audio/*", limit: "80mb" });

module.exports = function (app) {

  // ─── TOKEN PARA VISTA PREVIA EN VIVO (el navegador se conecta directo
  // al WebSocket de AssemblyAI mientras graba; nunca se manda la API key) ──
  app.get("/medico/transcripcion-token", requireMedico, asyncRoute(async (req, res) => {
    try {
      const token = await crearTokenStreaming();
      res.json({ token });
    } catch (e) {
      log.error("[TRANSCRIPCION_TOKEN]", e.response?.data || e.message);
      throw new ErrorHttp(502, "No se pudo generar el token de transcripción en vivo");
    }
  }));

  // ─── SUBIR AUDIO DE CONSULTA → TRANSCRIBIR (en segundo plano) ──────────
  // Con consultas de 30-45 min, esperar la transcripción entera en el mismo
  // pedido HTTP no funciona (nginx corta conexiones largas). Por eso acá solo
  // se guarda el audio y se responde al toque; la transcripción sigue sola
  // en background y la web se fija después (polling) cuando termina.
  app.post("/medico/consultas", limitMedico, requireMedico, audioRaw, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const audioBuffer = req.body;
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new ErrorHttp(400, "Falta el audio (Content-Type debe ser audio/*)");
    }

    const pacienteId = String(req.query.pacienteId || "").trim();
    if (!pacienteId) throw new ErrorHttp(400, "Falta pacienteId — elegí o creá un paciente antes de grabar");
    const paciente = await obtenerOFallar(Paciente, { _id: pacienteId, medicoPhone }, "Paciente no encontrado");

    const consulta = await ConsultaMedica.create({
      medicoPhone, pacienteId: paciente._id, pacienteNombre: paciente.nombre, estado: "procesando",
    });

    res.status(202).json({ ok: true, consulta });

    transcribirConsultaMedica(audioBuffer)
      .then(async ({ transcripcionCompleta, segmentos, duracionSegundos }) => {
        consulta.estado = "completado";
        consulta.transcripcionCompleta = transcripcionCompleta;
        consulta.segmentos = segmentos;
        consulta.duracionSegundos = duracionSegundos;
        await consulta.save();

        try {
          const medicamentosActivos = await Medicamento.find({ pacienteId: paciente._id, medicoPhone, fechaFin: null })
            .select("nombre").lean();

          // Solo para odontología y estética (Vitalis Face): le pasamos el
          // catálogo de precios del consultorio para que la IA pueda
          // emparejar tratamientos mencionados ("hay que sellar esto",
          // "hay que hacer un relleno acá") con el ítem correcto.
          const medico = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad").lean();
          let catalogoTratamientos = [];
          if (["odontologia", "estetica"].includes(medico?.tipoEspecialidad)) {
            const catalogo = await CatalogoTratamiento.find({ medicoPhone }).select("nombre").lean();
            catalogoTratamientos = catalogo.map(c => c.nombre);
          }
          // Solo para oftalmología (Vitalis Visión): la lista de estructuras
          // oculares válidas, para que la IA narre el examen por ojo.
          const esOftalmologia = medico?.tipoEspecialidad === "oftalmologia";

          consulta.notaClinica = await generarNotaClinica(transcripcionCompleta, {
            antecedentesPersonales: paciente.antecedentesPersonales || [],
            antecedentesFamiliares: paciente.antecedentesFamiliares || [],
            medicamentosActivos: medicamentosActivos.map(m => m.nombre),
            catalogoTratamientos,
            estructurasOculares: esOftalmologia ? ESTRUCTURAS_OCULARES : [],
          });
          consulta.notaClinicaEstado = "completado";

          // El mapa ocular se actualiza solo apenas termina la nota (el
          // médico lo revisa/corrige después desde la pestaña Ojos) — cada
          // cambio queda en el historial con fuente:"voz" y el id de esta
          // consulta, nunca se pierde el origen del dato.
          const hallazgos = consulta.notaClinica?.examenOcularSugerido;
          if (esOftalmologia && hallazgos?.length) {
            try {
              let examen = await ExamenOcular.findOne({ pacienteId: paciente._id, medicoPhone });
              if (!examen) {
                const estructuras = [];
                for (const ojo of OJOS) for (const estructura of ESTRUCTURAS_OCULARES) {
                  estructuras.push({ ojo, estructura, estado: "normal", notas: "", historial: [] });
                }
                examen = await ExamenOcular.create({ pacienteId: paciente._id, medicoPhone, estructuras });
              }
              for (const h of hallazgos) {
                if (!OJOS.includes(h.ojo) || !ESTRUCTURAS_OCULARES.includes(h.estructura) || !ESTADOS_ESTRUCTURA_OCULAR.includes(h.estado)) continue;
                const item = examen.estructuras.find(e => e.ojo === h.ojo && e.estructura === h.estructura);
                if (!item) continue;
                item.estado = h.estado;
                item.notas = h.hallazgo;
                item.historial.push({ fecha: new Date(), estado: h.estado, notas: h.hallazgo, fuente: "voz", consultaId: consulta._id });
              }
              await examen.save();
            } catch (e) {
              log.error("[EXAMEN_OCULAR]", e.message);
            }
          }
        } catch (e) {
          log.error("[NOTA_CLINICA]", e.response?.data || e.message);
          consulta.notaClinicaEstado = "error";
          consulta.notaClinicaError = e.message;
        }
        await consulta.save();

        if (consulta.notaClinicaEstado === "completado") {
          regenerarBriefClinico(consulta.pacienteId).catch(e => log.error("[BRIEF_CLINICO]", e.message));
        }
      })
      .catch(async (e) => {
        log.error("[CONSULTA_MEDICA] Error transcribiendo:", e.response?.data || e.message);
        consulta.estado = "error";
        consulta.error = e.response?.data?.error || e.message;
        await consulta.save();
      });
  }));

  // ─── LISTAR CONSULTAS PROPIAS ───────────────────────────────────────────
  app.get("/medico/consultas", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const consultas = await ConsultaMedica.find({ medicoPhone })
      .select("pacienteNombre estado duracionSegundos createdAt")
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

    res.json({ consulta: consultaObj });
  }));

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

    const texto = `Hola ${primerNombre} 👋 ${medico?.nombre || "Tu médico"} te sugiere tu próxima consulta para el ${formatearFechaCompleta(sugerida.fechaHora)}.\n\nElegí el horario que te quede mejor acá (vas a ver la disponibilidad real):\n${link}\n\n(el link es válido por 45 minutos)`;
    await enviarTexto(paciente.telefono, texto).catch(e => {
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

  // ─── TRATAMIENTOS SUGERIDOS (Vitalis Odonto): agregar al presupuesto o
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
