// ═══════════════════════════════════════════════════════════════════════════
// Caja Vitalis — los estudios DICOM entran solos, y las imágenes se quedan
// ═══════════════════════════════════════════════════════════════════════════
// El ecógrafo, el tomógrafo y el panorámico sí hablan un protocolo: DICOM.
// La Caja Vitalis es una máquina en la clínica que los escucha (Orthanc
// recibiendo C-STORE), guarda el .dcm original en su propio disco y le
// manda a Vitalis nada más que dos cosas: la metadata y una vista previa.
//
// Tres decisiones que valen la pena mirar antes del código:
//
// · EL ORIGINAL NO VIAJA. Una tomografía son cientos de MB y subirla por el
//   enlace de una clínica es hacer esperar a todo el mundo. El .dcm de 16
//   bits se queda en la caja; lo que sube son unos KB de metadata y la
//   previa. Nadie mira una barra de progreso.
//
// · LA ESCALA VIENE DEL ARCHIVO. El DICOM dice cuánto mide un píxel, así
//   que las mediciones salen en milímetros SIN que nadie calibre nada. Y se
//   anota de dónde salió esa escala: un milímetro leído del archivo y uno
//   calibrado a ojo sobre un JPEG no valen lo mismo.
//
// · DUPLICAR ES IMPOSIBLE. Cada imagen del mundo tiene su SOPInstanceUID.
//   Si la misma placa llega dos veces —porque el equipo reintentó, porque
//   alguien reenvió el estudio— la segunda se descarta sola.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Paciente, Estudio, EquipoRayos, CapturaPendiente, EstudioEntrante } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { DIR_ESTUDIOS, guardarArchivoEstudio } = require("../services/archivosEstudio");
const { equipoDesdeRequest, capturaVigente } = require("../services/equipoAuth");
const { avisarCambio } = require("../services/realtime");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// Una caja puede estar volcando un estudio de tomografía entero, que son
// cientos de cortes. El límite es alto a propósito, pero existe.
const limitCaja = rateLimit("cajaDicom", 600, 60 * 1000, "Demasiadas subidas seguidas de la caja.");

// Solo la vista previa, y solo imagen. El original nunca pasa por acá.
const previaRaw = express.raw({ type: ["image/png", "image/jpeg"], limit: "25mb" });

// En estas modalidades la imagen es una SOMBRA proyectada: el objeto está
// delante del detector, así que sale agrandado y el milímetro del archivo es
// el del detector, no el del hueso. En tomografía y resonancia no pasa,
// porque hay reconstrucción. El visor lo avisa en vez de que se olvide.
const MODALIDADES_PROYECCIONALES = new Set(["DX", "CR", "RF", "MG", "PX", "XA", "IO"]);

// Qué tipo de estudio de Vitalis le corresponde a cada modalidad DICOM.
const TIPO_POR_MODALIDAD = {
  DX: "radiografia", CR: "radiografia", PX: "radiografia", IO: "radiografia",
  MG: "radiografia", RF: "radiografia", XA: "radiografia",
  CT: "tomografia", MR: "resonancia", US: "ecografia", ECG: "ecg",
};

// ─── LECTURA DE LA METADATA ───────────────────────────────────────────────
// Llega en una cabecera como JSON en base64 (el cuerpo es la imagen). Es
// entrada de red: nada se guarda sin pasar por acá.
function leerMeta(req) {
  const crudo = String(req.headers["x-dicom-meta"] || "");
  if (!crudo) throw new ErrorHttp(400, "Falta la cabecera X-Dicom-Meta");
  let m;
  try {
    m = JSON.parse(Buffer.from(crudo, "base64").toString("utf8"));
  } catch {
    throw new ErrorHttp(400, "X-Dicom-Meta no es JSON válido en base64");
  }
  if (!m || typeof m !== "object") throw new ErrorHttp(400, "X-Dicom-Meta vacío");

  const texto = (v, max = 160) => String(v == null ? "" : v).trim().slice(0, max);
  const entero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 1e6 ? Math.round(n) : null;
  };

  const sop = texto(m.sopInstanceUID, 128);
  // Un UID DICOM son dígitos y puntos. Si no lo es, no es un DICOM y no hay
  // forma de garantizar que no entre dos veces — que es todo el punto.
  if (!/^[0-9.]{8,128}$/.test(sop)) throw new ErrorHttp(400, "sopInstanceUID inválido o ausente");

  // El espaciado llega TAL CUAL viene del DICOM (mm por píxel del original).
  // La división por la escala de la previa se hace más abajo, en un solo
  // lugar, para que el número sea auditable.
  const espaciado = (v) => {
    const n = Number(v);
    // Más de 100 mm por píxel no es una imagen médica, es un error de
    // unidades. Y 0 o negativo haría que toda medición diera 0 o al revés.
    return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
  };
  const escalaPreview = (() => {
    const n = Number(m.escalaPreview);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1;
  })();

  return {
    sopInstanceUID: sop,
    seriesInstanceUID: texto(m.seriesInstanceUID, 128),
    studyInstanceUID: texto(m.studyInstanceUID, 128),
    modalidad: texto(m.modalidad, 16).toUpperCase(),
    filas: entero(m.filas),
    columnas: entero(m.columnas),
    escalaPreview,
    bitsAlmacenados: entero(m.bitsAlmacenados),
    ventanaCentro: Number.isFinite(Number(m.ventanaCentro)) ? Number(m.ventanaCentro) : null,
    ventanaAncho: Number.isFinite(Number(m.ventanaAncho)) ? Number(m.ventanaAncho) : null,
    fabricante: texto(m.fabricante, 80),
    modelo: texto(m.modelo, 80),
    pacienteNombreDicom: texto(m.pacienteNombre, 120),
    pacienteIdDicom: texto(m.pacienteId, 64),
    descripcionEstudio: texto(m.descripcionEstudio, 120),
    descripcionSerie: texto(m.descripcionSerie, 120),
    fechaEstudio: m.fechaEstudio ? new Date(m.fechaEstudio) : null,
    espaciadoX: espaciado(m.espaciadoX),
    espaciadoY: espaciado(m.espaciadoY),
    fuenteEspaciado: texto(m.fuenteEspaciado, 40),
  };
}

// La escala que se guarda es la de la imagen que Vitalis TIENE (la previa),
// no la del original que se quedó en la caja. Si la previa se achicó, cada
// píxel de la previa cubre más milímetros — y si esto no se dividiera, toda
// medición sobre una panorámica achicada saldría corta, en silencio.
function calibracionDesde(meta) {
  if (!meta.espaciadoX) return { origen: "", mmPorPixel: null, mmPorPixelY: null, referencia: "", planoDetector: false };
  const escala = meta.escalaPreview || 1;
  const detector = meta.fuenteEspaciado === "ImagerPixelSpacing" || MODALIDADES_PROYECCIONALES.has(meta.modalidad);
  return {
    mmPorPixel: meta.espaciadoX / escala,
    mmPorPixelY: (meta.espaciadoY || meta.espaciadoX) / escala,
    origen: "dicom",
    referencia: `${meta.fuenteEspaciado || "DICOM"} ${meta.espaciadoX} mm/px` +
      (escala !== 1 ? ` · vista previa al ${Math.round(escala * 100)}%` : ""),
    fecha: new Date(),
    planoDetector: detector,
  };
}

function nombreEstudio(meta) {
  return [meta.descripcionEstudio, meta.descripcionSerie].filter(Boolean).join(" · ")
    || meta.modalidad || "Estudio";
}

module.exports = function (app) {
  // ═══ LA CAJA SUBE UN ESTUDIO ═════════════════════════════════════════════
  app.post("/equipo/dicom/estudio", limitCaja, previaRaw, asyncRoute(async (req, res) => {
    const equipo = await equipoDesdeRequest(req, res);
    if (!equipo) return;
    const medicoPhone = equipo.medicoPhone;

    const previa = req.body;
    if (!Buffer.isBuffer(previa) || previa.length === 0) {
      throw new ErrorHttp(400, "Falta la vista previa (el cuerpo tiene que ser un PNG o JPEG)");
    }
    const meta = leerMeta(req);

    // ─── ¿Ya la teníamos? ───────────────────────────────────────────────
    // Se pregunta a las dos colecciones: una imagen ya asignada a un
    // paciente tampoco tiene que volver a caer en la bandeja.
    const [yaAsignado, yaEnBandeja] = await Promise.all([
      Estudio.findOne({ medicoPhone, "dicom.sopInstanceUID": meta.sopInstanceUID }).select("_id pacienteId").lean(),
      EstudioEntrante.findOne({ medicoPhone, "dicom.sopInstanceUID": meta.sopInstanceUID }).select("_id").lean(),
    ]);
    if (yaAsignado || yaEnBandeja) {
      // 200 y no error: el agente hizo bien su trabajo, esta imagen ya está.
      // Que la marque como subida y siga con la próxima.
      return res.json({ ok: true, duplicado: true, destino: yaAsignado ? "paciente" : "bandeja" });
    }

    // ─── ¿De quién es? ──────────────────────────────────────────────────
    // Tres caminos, en orden de confianza.
    let paciente = null;
    let via = "";

    // 1. El técnico tipeó el código de paciente de Vitalis en el equipo.
    //    Es el mejor caso: el estudio se archiva solo, sin que nadie toque
    //    nada, y es exactamente para lo que existe ese código.
    if (meta.pacienteIdDicom) {
      paciente = await Paciente.findOne({
        medicoPhone,
        codigo: new RegExp(`^${meta.pacienteIdDicom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      }).lean();
      if (paciente) via = "codigo";
    }

    // 2. Hay una ventana de captura abierta (el flujo del consultorio: el
    //    médico abrió la ficha y tocó "Capturar").
    let captura = null;
    if (!paciente) {
      captura = await CapturaPendiente.findOne({ medicoPhone });
      if (capturaVigente(captura)) {
        paciente = await Paciente.findOne({ _id: captura.pacienteId, medicoPhone }).lean();
        if (paciente) via = "ventana";
        else await CapturaPendiente.deleteOne({ _id: captura._id }); // se borró el paciente mientras tanto
      }
    }

    // 3. Nadie sabe. Va a la bandeja con el nombre que vino del equipo, y el
    //    médico la asigna. En un centro de imagen este es el caso normal, no
    //    la excepción: los estudios llegan todo el día y nadie está apretando
    //    un botón por cada uno.
    const archivoNombre = guardarArchivoEstudio(previa, req.headers["content-type"]?.includes("jpeg") ? "image/jpeg" : "image/png");
    const archivoMime = req.headers["content-type"]?.includes("jpeg") ? "image/jpeg" : "image/png";
    const dicom = { ...meta, equipoId: equipo._id };
    delete dicom.espaciadoX; delete dicom.espaciadoY; delete dicom.fuenteEspaciado; delete dicom.fechaEstudio;
    const comun = {
      medicoPhone,
      archivoNombre, archivoMime, archivoTamano: previa.length,
      fecha: meta.fechaEstudio && !isNaN(meta.fechaEstudio) ? meta.fechaEstudio : new Date(),
      tipo: TIPO_POR_MODALIDAD[meta.modalidad] || "otro",
      nombre: nombreEstudio(meta),
      calibracion: calibracionDesde(meta),
      dicom,
    };

    let creado, destino;
    try {
      if (paciente) {
        creado = await Estudio.create({ ...comun, pacienteId: paciente._id });
        destino = "paciente";
        if (via === "ventana" && captura) {
          captura.recibidas = (captura.recibidas || 0) + 1;
          await captura.save();
        }
      } else {
        creado = await EstudioEntrante.create(comun);
        destino = "bandeja";
      }
    } catch (e) {
      // El índice único es la última palabra: si dos subidas de la misma
      // imagen entraron a la vez, la que pierde borra su copia del archivo
      // en vez de dejarla huérfana ocupando disco para siempre.
      if (e?.code === 11000) {
        fs.promises.unlink(path.join(DIR_ESTUDIOS, archivoNombre)).catch(() => {});
        return res.json({ ok: true, duplicado: true, destino: "desconocido" });
      }
      throw e;
    }

    await EquipoRayos.updateOne({ _id: equipo._id },
      { ultimaSubida: new Date(), ultimoContacto: new Date(), $inc: { subidas: 1 } });
    registrar({ req, medicoPhone, accion: "subir_dicom_caja", recurso: `${destino === "paciente" ? "Estudio" : "EstudioEntrante"}:${creado._id}` });
    log.info(`[CAJA] ${equipo.nombre} → ${destino}${paciente ? " (" + paciente.nombre + ", por " + via + ")" : ""}: ${meta.modalidad} ${meta.columnas}×${meta.filas}`);

    avisarCambio(medicoPhone);
    res.status(201).json({
      ok: true, destino, via,
      estudioId: creado._id,
      // Para que el agente pueda mostrarlo en el log de la caja.
      paciente: paciente ? paciente.nombre : null,
      milimetros: comun.calibracion.origen === "dicom",
    });
  }));

  // ═══ LA BANDEJA, DEL LADO DEL MÉDICO ═════════════════════════════════════
  app.get("/medico/dicom/bandeja", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const entrantes = await EstudioEntrante.find({ medicoPhone }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      entrantes: entrantes.map(e => ({
        _id: e._id, nombre: e.nombre, tipo: e.tipo, fecha: e.fecha,
        creadoEn: e.createdAt,
        // Lo que el técnico tipeó en el aparato. Es todo lo que hay para
        // reconocer de quién es, así que se muestra tal cual vino.
        pacienteDicom: e.dicom?.pacienteNombreDicom || "",
        codigoDicom: e.dicom?.pacienteIdDicom || "",
        modalidad: e.dicom?.modalidad || "",
        equipo: [e.dicom?.fabricante, e.dicom?.modelo].filter(Boolean).join(" "),
        tamano: e.dicom?.columnas && e.dicom?.filas ? `${e.dicom.columnas}×${e.dicom.filas}` : "",
        conMilimetros: e.calibracion?.origen === "dicom",
      })),
    });
  }));

  app.get("/medico/dicom/bandeja/:id/imagen", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const e = await obtenerOFallar(EstudioEntrante, { _id: req.params.id, medicoPhone }, "No está en la bandeja");
    const ruta = path.join(DIR_ESTUDIOS, e.archivoNombre);
    if (!fs.existsSync(ruta)) throw new ErrorHttp(404, "La vista previa no está en el disco");
    res.setHeader("Content-Type", e.archivoMime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(ruta);
  }));

  // Asignar: el estudio pasa de la bandeja a la ficha del paciente. Se mueve
  // el registro entero —incluida la escala del DICOM— así que las mediciones
  // salen en milímetros desde el primer momento.
  app.post("/medico/dicom/bandeja/:id/asignar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const entrante = await obtenerOFallar(EstudioEntrante, { _id: req.params.id, medicoPhone }, "No está en la bandeja");
    const paciente = await obtenerOFallar(Paciente, { _id: req.body?.pacienteId, medicoPhone }, "Paciente no encontrado");

    const nombre = String(req.body?.nombre || "").trim().slice(0, 160) || entrante.nombre;
    let estudio;
    try {
      estudio = await Estudio.create({
        pacienteId: paciente._id, medicoPhone,
        tipo: String(req.body?.tipo || entrante.tipo).slice(0, 40),
        nombre,
        archivoNombre: entrante.archivoNombre,
        archivoMime: entrante.archivoMime,
        archivoTamano: entrante.archivoTamano,
        fecha: entrante.fecha,
        calibracion: entrante.calibracion,
        dicom: entrante.dicom,
        notas: entrante.dicom?.pacienteNombreDicom
          ? `Llegó del equipo como "${entrante.dicom.pacienteNombreDicom}"`
          : "",
      });
    } catch (e) {
      if (e?.code === 11000) throw new ErrorHttp(409, "Ese estudio ya está asignado a un paciente.");
      throw e;
    }

    // Recién después de crear el Estudio se saca de la bandeja: si algo
    // falla en el medio, prefiero que quede duplicado en la bandeja (visible
    // y borrable) antes que desaparecido de los dos lados. El archivo NO se
    // borra — es el mismo, ahora colgado del Estudio.
    await EstudioEntrante.deleteOne({ _id: entrante._id });

    registrar({ req, medicoPhone, accion: "asignar_estudio_bandeja", recurso: `Estudio:${estudio._id}` });
    avisarCambio(medicoPhone);
    res.json({ ok: true, estudio, paciente: { _id: paciente._id, nombre: paciente.nombre } });
  }));

  app.delete("/medico/dicom/bandeja/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const entrante = await obtenerOFallar(EstudioEntrante, { _id: req.params.id, medicoPhone }, "No está en la bandeja");
    await EstudioEntrante.deleteOne({ _id: entrante._id });
    // Acá sí se borra el archivo: la vista previa no la quiere nadie más, y
    // el DICOM original sigue en la caja de la clínica de todos modos.
    fs.promises.unlink(path.join(DIR_ESTUDIOS, entrante.archivoNombre)).catch(() => {});
    registrar({ req, medicoPhone, accion: "descartar_estudio_bandeja", recurso: `EstudioEntrante:${req.params.id}` });
    avisarCambio(medicoPhone);
    res.json({ ok: true });
  }));
};
