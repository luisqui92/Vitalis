// ChatGo — Consultas médicas: transcripción de audio largo con diarización
// (AssemblyAI). Médicos suben el audio de la consulta (grabado en el celular
// o PC) y reciben la transcripción separada por hablante + nota clínica.
// Login/registro vive aparte en routes/medicoAuth.js.
const express = require("express");
const { CONFIG, log } = require("../config");
const { Medico, Paciente, ConsultaMedica, Medicamento, Vacuna, Receta, CatalogoTratamiento, TratamientoPlan, ExamenOcular, OJOS, ESTRUCTURAS_OCULARES, ESTADOS_ESTRUCTURA_OCULAR, Odontograma, ESTADOS_PIEZA_DENTAL, PIEZAS_FDI_PERMANENTE, ExamenGinecologico, ORGANOS_GINECO, HALLAZGOS_GINECO, Teleconsulta } = require("../db/models");
const { requireAuth, generarToken } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { transcribirConsultaMedica, crearTokenStreaming, keytermsPara, idiomaSoportado, IDIOMAS_CON_MEDICAL_MODE } = require("../services/assemblyai");
const { generarNotaClinica, notaVacia } = require("../services/notaClinica");
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
const { medicamentosDelMedico, correccionesDelMedico, olvidar: olvidarVocabulario } = require("../services/vocabularioMedico");
const { verificarMedicamento } = require("../services/medicamentosOficiales");

const requireMedico = requireAuth(["medico"]);

// Acepta el audio como body crudo (no JSON): el cliente manda
// Content-Type: audio/ogg (o wav/mp3/m4a/webm) y el archivo tal cual.
const audioRaw = express.raw({ type: "audio/*", limit: "80mb" });

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

module.exports = function (app) {

  // ─── TOKEN PARA VISTA PREVIA EN VIVO (el navegador se conecta directo
  // al WebSocket de AssemblyAI mientras graba; nunca se manda la API key) ──
  app.get("/medico/transcripcion-token", requireMedico, asyncRoute(async (req, res) => {
    try {
      const token = await crearTokenStreaming();
      // El vocabulario viaja junto al token para que la vista previa en vivo
      // reconozca exactamente los mismos términos que la transcripción final
      // (una sola fuente de verdad, en services/assemblyai.js).
      // El idioma y el vocabulario salen los dos de la cuenta del médico y
      // viajan juntos: si el navegador eligiera el idioma por su cuenta,
      // la vista previa en vivo y la transcripción final podrían terminar
      // en idiomas distintos para la misma consulta.
      const medico = await Medico.findOne({ phone: req.adminUser.usuario }).select("tipoEspecialidad idioma").lean();
      const idioma = idiomaSoportado(medico?.idioma);
      const delMedico = await medicamentosDelMedico(req.adminUser.usuario);
      res.json({
        token, idioma,
        // Si este idioma tiene Medical Mode lo decide el servidor: una copia
        // de la lista en el navegador es una segunda fuente de verdad que
        // algún día no va a coincidir con ésta.
        medicalMode: IDIOMAS_CON_MEDICAL_MODE.includes(idioma),
        keyterms: keytermsPara(medico?.tipoEspecialidad, idioma, delMedico),
      });
    } catch (e) {
      log.error("[TRANSCRIPCION_TOKEN]", e.response?.data || e.message);
      throw new ErrorHttp(502, "No se pudo generar el token de transcripción en vivo");
    }
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
  // en background y la web se fija después (polling) cuando termina.
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

    const consulta = await ConsultaMedica.create({
      medicoPhone, pacienteId: paciente._id, pacienteNombre: paciente.nombre, estado: "procesando",
    });

    if (teleconsulta) {
      teleconsulta.consultaId = consulta._id;
      await teleconsulta.save();
    }

    res.status(202).json({ ok: true, consulta });

    // La especialidad afina el vocabulario; el idioma decide en qué lengua
    // se transcribe y si hay Medical Mode (ver services/assemblyai.js).
    // Y lo que este médico receta seguido va primero (services/vocabularioMedico.js).
    const medicoParaVocabulario = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad idioma").lean();
    const delMedico = await medicamentosDelMedico(medicoPhone);

    transcribirConsultaMedica(audioBuffer, medicoParaVocabulario?.tipoEspecialidad, medicoParaVocabulario?.idioma, { multicanal, delMedico })
      .then(async ({ transcripcionCompleta, segmentos, duracionSegundos }) => {
        consulta.estado = "completado";
        consulta.transcripcionCompleta = transcripcionCompleta;
        consulta.segmentos = segmentos;
        consulta.duracionSegundos = duracionSegundos;
        await consulta.save();

        // El cobro va acá y no al subir el audio: recién ahora sabemos que la
        // consulta salió bien. Si AssemblyAI hubiera fallado, el médico no
        // paga nada — y con razón, porque no recibió nada.
        //
        // Va en su propio try: que falle el cobro no puede hacerle perder la
        // consulta al médico. Un cobro perdido lo detecta reconciliar(); una
        // consulta perdida no la recupera nadie.
        try {
          await cobrarConsulta({ medicoPhone, consultaId: consulta._id });
        } catch (e) {
          log.error(`[SALDO] no se pudo cobrar la consulta ${consulta._id} de ${medicoPhone}:`, e.message);
        }

        await producirNota(consulta, paciente, medicoPhone, medicoParaVocabulario?.idioma);

        // ═══ AVISARLE AL MÉDICO, QUE ES EL QUE ESTÁ ESPERANDO ═══════════════
        //
        // Esto tarda: transcribir una consulta de veinte minutos y escribir la
        // nota no es instantáneo. Hasta ahora el único que se enteraba era el
        // que dejaba la pantalla abierta —consulta cada ocho segundos— y el
        // médico normal NO la deja abierta: cierra y atiende al siguiente.
        //
        // Volvía cuando se acordaba. Si la nota había fallado, se enteraba
        // más tarde todavía, cuando ya no tenía fresco lo que se habló.
        //
        // Van los dos avisos y hacen cosas distintas:
        //   · avisarCambio  → las pantallas ABIERTAS se actualizan al toque,
        //                     sin esperar los ocho segundos del sondeo.
        //   · notificarMedico → el que se fue de la pantalla se entera igual.
        //
        // Ninguno de los dos puede tumbar la nota si falla: ya está guardada.
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

        if (consulta.notaClinicaEstado === "completado") {
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
      })
      .catch(async (e) => {
        log.error("[CONSULTA_MEDICA] Error transcribiendo:", e.response?.data || e.message);
        consulta.estado = "error";
        consulta.error = e.response?.data?.error || e.message;
        await consulta.save().catch(e2 => log.error("[CONSULTA_MEDICA] No se pudo guardar el estado de error:", e2.message));
        // El caso donde el silencio cuesta más caro: el médico está esperando
        // algo que no va a llegar nunca. Cuanto antes lo sepa, más fresco
        // tiene lo que se habló para escribirlo a mano.
        avisarCambio(medicoPhone);
        notificarMedico(medicoPhone, {
          titulo: "No se pudo transcribir la consulta",
          cuerpo: "Entrá a verla: el audio quedó guardado.",
          url: `/?consulta=${consulta._id}`,
        }).catch(e2 => log.error("[CONSULTA_MEDICA] no se pudo notificar:", e2.message));
      });
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
    }

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
  // médico ya miró, y volvería a aplicar sus hallazgos al odontograma o al
  // mapa ocular una segunda vez.
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

    const paciente = await obtenerOFallar(Paciente, { _id: consulta.pacienteId, medicoPhone }, "Paciente no encontrado");
    const aplicar = req.body?.aplicar || {};
    const aplicado = [];
    const fallado = [];

    // ── 1. Guardar la nota con las correcciones del médico ──
    const notaEditada = req.body?.nota;
    if (notaEditada && typeof notaEditada === "object") {
      const n = consulta.notaClinica;
      const textos = ["motivoConsulta", "antecedentesRelevantes", "diagnostico", "plan", "proximoControl"];
      const listas = ["sintomas", "diagnosticosDiferenciales", "examenesSolicitados"];
      let huboCambios = false;

      for (const campo of textos) {
        if (notaEditada[campo] === undefined) continue;
        const valor = String(notaEditada[campo]).trim();
        if (valor !== (n[campo] || "")) {
          // Lo que la IA propuso vs. lo que quedó: alimenta el panel de
          // correcciones, que es como medimos si la IA está mejorando.
          registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo, valorSugerido: n[campo], valorFinal: valor });
          n[campo] = valor;
          huboCambios = true;
        }
      }
      for (const campo of listas) {
        if (!Array.isArray(notaEditada[campo])) continue;
        const valor = notaEditada[campo].map(x => String(x).trim()).filter(Boolean);
        if (valor.join("|") !== (n[campo] || []).join("|")) {
          registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo, valorSugerido: (n[campo] || []).join(", "), valorFinal: valor.join(", ") });
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
          registrarCorreccion({ medicoPhone, tipo: "nota", consultaId: consulta._id, campo: "medicamentosRecetados", valorSugerido: antes, valorFinal: despues });
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

          sugerida.estado = "confirmada";
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

        await TratamientoPlan.create({
          pacienteId: consulta.pacienteId, medicoPhone, nombre, precio,
          piezaFdi: piezaFdi ?? null, estado: "pendiente",
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
        await Medicamento.create({
          pacienteId: consulta.pacienteId, medicoPhone,
          nombre: m.nombre, dosis: m.dosis || "", frecuencia: m.frecuencia || "",
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
      paciente.antecedentesFamiliares = [...(paciente.antecedentesFamiliares || []), { parentesco: a.parentesco || "", condicion: a.condicion }];
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
        await Vacuna.create({
          pacienteId: consulta.pacienteId, medicoPhone,
          nombre: v.nombre, dosis: v.dosis || "", fecha,
        });
        aplicado.push(`Vacuna: ${v.nombre}`);
      } catch (e) {
        fallado.push(`No se pudo cargar la vacuna "${v.nombre}": ${e.message}`);
      }
    }

    // ── 6. Receta con los medicamentos (ya corregidos arriba) ──
    let recetaId = null;
    if (aplicar.receta && (nota.medicamentosRecetados || []).length) {
      try {
        const receta = await Receta.create({
          pacienteId: consulta.pacienteId, medicoPhone, consultaId: consulta._id,
          fecha: new Date(),
          medicamentos: nota.medicamentosRecetados.map(m => ({
            nombre: m.nombre, dosis: m.dosis || "", frecuencia: m.frecuencia || "", duracion: "",
          })),
        });
        recetaId = receta._id;
        aplicado.push("Receta generada");
      } catch (e) {
        fallado.push("No se pudo generar la receta: " + e.message);
      }
    }

    consulta.confirmadaEn = new Date();
    await consulta.save();
    // Lo que acaba de confirmar (y lo que corrigió) ya cuenta para su
    // vocabulario desde la próxima consulta (services/vocabularioMedico.js).
    olvidarVocabulario(medicoPhone);
    registrar({ req, medicoPhone, accion: "consulta_confirmada", recurso: `ConsultaMedica:${consulta._id}` });

    res.json({ ok: true, aplicado, fallado, recetaId });
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
async function producirNota(consulta, paciente, medicoPhone, idioma) {
  try {
    const medicamentosActivos = await Medicamento.find({ pacienteId: paciente._id, medicoPhone, fechaFin: null })
      .select("nombre").lean();

    // Solo para odontología y estética (Symphomed Face): le pasamos el
    // catálogo de precios del consultorio para que la IA pueda
    // emparejar tratamientos mencionados ("hay que sellar esto",
    // "hay que hacer un relleno acá") con el ítem correcto.
    const medico = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad").lean();
    // Lo que este médico receta y lo que ya corrigió: la IA reconoce sus
    // marcas como medicamentos y no repite un error que él ya arregló.
    const [medicamentosHabituales, correccionesMedicamentos] = await Promise.all([
      medicamentosDelMedico(medicoPhone, 60),
      correccionesDelMedico(medicoPhone, 30),
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

    consulta.notaClinica = await generarNotaClinica(consulta.transcripcionCompleta, {
      antecedentesPersonales: paciente.antecedentesPersonales || [],
      antecedentesFamiliares: paciente.antecedentesFamiliares || [],
      medicamentosActivos: medicamentosActivos.map(m => m.nombre),
      medicamentosHabituales,
      correccionesMedicamentos,
      catalogoTratamientos,
      estructurasOculares: esOftalmologia ? ESTRUCTURAS_OCULARES : [],
      estadosPiezaDental: esOdontologia ? ESTADOS_PIEZA_DENTAL : [],
      organosGineco: esGinecologia ? ORGANOS_GINECO : [],
      hallazgosGineco: esGinecologia ? HALLAZGOS_GINECO : [],
      veterinaria: esVeterinaria,
      especie: esVeterinaria ? paciente.especie : "",
      raza: esVeterinaria ? paciente.raza : "",
    // El mismo idioma con el que se transcribió: una nota en español
    // sobre una consulta en portugués obliga al médico a traducir de
    // vuelta lo que él mismo dijo.
    }, idioma);
    consulta.notaClinicaEstado = "completado";
    consulta.notaClinicaError = undefined;

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

    // Symphomed Odonto: mismo patrón — el odontograma se actualiza solo
    // apenas termina la nota, con fuente:"voz" en el historial de la
    // pieza para que quede claro que vino de la consulta.
    const hallazgosOdonto = consulta.notaClinica?.odontogramaSugerido;
    if (esOdontologia && hallazgosOdonto?.length) {
      try {
        let odontograma = await Odontograma.findOne({ pacienteId: paciente._id, medicoPhone });
        if (!odontograma) {
          const piezas = PIEZAS_FDI_PERMANENTE.map(numero => ({ numero, estado: "sano", notas: "", historial: [] }));
          odontograma = await Odontograma.create({ pacienteId: paciente._id, medicoPhone, piezas });
        }
        for (const h of hallazgosOdonto) {
          if (!PIEZAS_FDI_PERMANENTE.includes(h.piezaFdi) || !ESTADOS_PIEZA_DENTAL.includes(h.estado)) continue;
          const pieza = odontograma.piezas.find(p => p.numero === h.piezaFdi);
          if (!pieza) continue;
          pieza.estado = h.estado;
          pieza.notas = h.hallazgo;
          pieza.historial.push({ fecha: new Date(), estado: h.estado, notas: h.hallazgo, fuente: "voz", consultaId: consulta._id });
        }
        await odontograma.save();
      } catch (e) {
        log.error("[ODONTOGRAMA]", e.message);
      }
    }

    // Symphomed Gineco: mismo patrón, por órgano.
    const hallazgosGineco = consulta.notaClinica?.ginecoSugerido;
    if (esGinecologia && hallazgosGineco?.length) {
      try {
        let mapa = await ExamenGinecologico.findOne({ pacienteId: paciente._id, medicoPhone });
        if (!mapa) {
          const organos = ORGANOS_GINECO.map(organo => ({ organo, hallazgo: "normal", notas: "", historial: [] }));
          mapa = await ExamenGinecologico.create({ pacienteId: paciente._id, medicoPhone, organos });
        }
        for (const h of hallazgosGineco) {
          if (!ORGANOS_GINECO.includes(h.organo) || !HALLAZGOS_GINECO.includes(h.hallazgo)) continue;
          const item = mapa.organos.find(o => o.organo === h.organo);
          if (!item) continue;
          item.hallazgo = h.hallazgo;
          item.notas = h.detalle;
          item.historial.push({ fecha: new Date(), hallazgo: h.hallazgo, notas: h.detalle, fuente: "voz", consultaId: consulta._id });
        }
        await mapa.save();
      } catch (e) {
        log.error("[MAPA_GINECO]", e.message);
      }
    }
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
