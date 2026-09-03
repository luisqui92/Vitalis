// Vitalis — Recetar por Memed (Brasil).
//
// Dos rutas y nada más: una entrega el token con el que el navegador abre el
// módulo de Memed, y la otra guarda la referencia de lo que se recetó.
//
// Ver el encabezado de services/memed.js para por qué en Brasil no se receta
// por Vitalis sino solo por Memed.
const { Medico, Paciente, Receta } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const memed = require("../services/memed");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// ═══ QUIÉN RECETA POR MEMED ═══════════════════════════════════════════════
//
// La moneda de la cuenta, NO el idioma. Un médico brasileño que pone la
// interfaz en español sigue recetando en Brasil y sigue necesitando la firma
// digital; uno boliviano que la pone en portugués, no. Es la misma razón por
// la que services/monedas.js no deduce la moneda del idioma: una preferencia
// de pantalla no decide bajo qué ley se emite un documento.
function recetaPorMemed(medico) {
  return medico?.moneda === "BRL";
}

module.exports = function (app) {

  // ─── ¿ESTA CUENTA RECETA POR MEMED, Y PUEDE? ────────────────────────────
  // La pantalla pregunta esto para saber qué botón dibujar. Contesta siempre
  // 200: "no" es una respuesta, no un error.
  app.get("/medico/memed/estado", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario })
      .select("moneda conselho").lean();

    if (!recetaPorMemed(medico)) return res.json({ corresponde: false });

    res.json({
      corresponde: true,
      // Se distinguen los dos motivos por los que puede no andar, porque las
      // soluciones son distintas y ninguna la puede adivinar el médico:
      // faltarle SU consejo profesional lo arregla él; que Vitalis no tenga
      // las llaves de Memed no.
      listo: memed.configurado() && memed.consejoCompleto(medico),
      faltaConsejo: !memed.consejoCompleto(medico),
      faltaConfiguracion: !memed.configurado(),
      scriptUrl: memed.scriptUrl(),
    });
  }));

  // ─── EL TOKEN PARA ABRIR EL MÓDULO ──────────────────────────────────────
  //
  // Devuelve el token de ESTE médico y el paciente ya armado como lo espera
  // Memed. Las llaves de la integración no salen nunca del servidor: lo único
  // que viaja es este token, que además no es fijo — se pide cada vez.
  app.get("/medico/pacientes/:pacienteId/memed/sesion", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const medico = await Medico.findOne({ phone: medicoPhone }).lean();
    if (!recetaPorMemed(medico)) throw new ErrorHttp(404, "No encontrado");

    if (!memed.configurado()) {
      throw new ErrorHttp(503, "La receta digital no está configurada en este servidor todavía");
    }
    if (!memed.consejoCompleto(medico)) {
      throw new ErrorHttp(400, "Completá tu consejo profesional (CRM/CRO, estado y número) en Configuración antes de recetar");
    }

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    // Sin CPF, Memed no puede identificar al paciente. Se corta acá con un
    // mensaje claro en vez de dejar que el módulo abra y falle adentro, donde
    // el error ya no es nuestro y no lo podemos explicar.
    if (!paciente.cpf) {
      throw new ErrorHttp(400, "Falta el CPF del paciente. Agregalo en su ficha para poder recetar.");
    }

    const token = await memed.tokenDeMedico(medico);
    registrar({ req, medicoPhone, accion: "memed_sesion", recurso: `Paciente:${paciente._id}` });

    res.json({
      token,
      scriptUrl: memed.scriptUrl(),
      paciente: {
        idExterno: String(paciente._id),
        nome: paciente.nombre,
        cpf: String(paciente.cpf).replace(/\D/g, ""),
        // Memed espera estos dos con sus nombres, y tolera que falten.
        ...(paciente.sexo ? { sexo: paciente.sexo } : {}),
        ...(paciente.fechaNacimiento
          ? { data_nascimento: new Date(paciente.fechaNacimiento).toISOString().slice(0, 10) }
          : {}),
        ...(paciente.telefono ? { telefone: String(paciente.telefono).replace(/\D/g, "") } : {}),
      },
    });
  }));

  // ─── EL CONSEJO PROFESIONAL DEL MÉDICO ──────────────────────────────────
  //
  // Se guarda partido —sigla, estado, número— porque así lo pide Memed, y
  // porque un texto libre ("CRM 123456 SP") obliga a adivinar dónde termina
  // cada cosa justo en el dato que identifica a quien firma la receta.
  app.get("/medico/memed/consejo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario })
      .select("moneda conselho cpf email").lean();
    if (!recetaPorMemed(medico)) throw new ErrorHttp(404, "No encontrado");
    res.json({
      conselho: medico.conselho || { sigla: "", uf: "", numero: "" },
      cpf: medico.cpf || "",
      email: medico.email || "",
      siglas: memed.SIGLAS_CONSEJO,
      ufs: memed.UF_BRASIL,
    });
  }));

  app.patch("/medico/memed/consejo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const medico = await Medico.findOne({ phone: medicoPhone });
    if (!recetaPorMemed(medico)) throw new ErrorHttp(404, "No encontrado");

    const sigla = String(req.body?.sigla || "").trim().toUpperCase();
    const uf = String(req.body?.uf || "").trim().toUpperCase();
    const numero = String(req.body?.numero || "").trim().replace(/\s+/g, "");

    // Se valida contra las listas y no se acepta cualquier cosa: una UF mal
    // escrita no la rechaza Memed con un mensaje claro, la rechaza el alta
    // entera y el médico se queda sin poder recetar sin saber por qué.
    if (!memed.SIGLAS_CONSEJO.includes(sigla)) throw new ErrorHttp(400, "Consejo no reconocido");
    if (!memed.UF_BRASIL.includes(uf)) throw new ErrorHttp(400, "Estado (UF) no válido");
    if (!numero) throw new ErrorHttp(400, "Falta el número del consejo");

    medico.conselho = { sigla, uf, numero };
    if (req.body?.cpf !== undefined) medico.cpf = String(req.body.cpf).replace(/\D/g, "").slice(0, 11);
    if (req.body?.email !== undefined) medico.email = String(req.body.email).trim().slice(0, 200);
    await medico.save();

    registrar({ req, medicoPhone, accion: "memed_consejo", detalle: `${sigla}/${uf} ${numero}` });
    res.json({ ok: true, conselho: medico.conselho });
  }));

  // ─── GUARDAR LO QUE SE RECETÓ ───────────────────────────────────────────
  //
  // Lo manda el navegador con lo que Memed le entregó en el evento
  // prescricaoImpressa. Es contenido de afuera: se extrae solo lo que hace
  // falta y con la forma esperada (ver memed.extraerReceta).
  //
  // Que esto falle NO puede hacerle perder la receta al médico: la receta ya
  // está emitida y firmada en Memed, con el paciente. Lo que se pierde acá es
  // la copia en el Kardex, que es grave pero es otra cosa.
  app.post("/medico/pacientes/:pacienteId/memed/recetas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const medico = await Medico.findOne({ phone: medicoPhone }).select("moneda").lean();
    if (!recetaPorMemed(medico)) throw new ErrorHttp(404, "No encontrado");

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const datos = memed.extraerReceta(req.body);

    if (!datos.medicamentos.length) throw new ErrorHttp(400, "La receta llegó sin medicamentos");
    if (!datos.prescriptionUuid) throw new ErrorHttp(400, "La receta llegó sin identificador de Memed");

    // Una reimpresión vuelve a disparar el mismo evento con el mismo uuid.
    // El índice único es quien lo impide de verdad —un "if" se puede correr
    // dos veces a la vez, un índice no— y acá solo se traduce ese choque a
    // una respuesta tranquila: no pasó nada malo, ya estaba guardada.
    try {
      const receta = await Receta.create({
        pacienteId: paciente._id,
        medicoPhone,
        medicamentos: datos.medicamentos,
        fecha: datos.emitidaEn,
        origen: "memed",
        memed: { prescriptionUuid: datos.prescriptionUuid, reimpresion: datos.reimpresion },
      });
      registrar({ req, medicoPhone, accion: "receta_memed", recurso: `Receta:${receta._id}`,
        detalle: `${datos.medicamentos.length} medicamento(s) · uuid ${datos.prescriptionUuid}` });
      log.info(`[MEMED] receta ${datos.prescriptionUuid} guardada para ${paciente.nombre}`);
      res.json({ ok: true, receta });
    } catch (e) {
      if (e?.code === 11000) {
        const yaEstaba = await Receta.findOne({ "memed.prescriptionUuid": datos.prescriptionUuid }).lean();
        return res.json({ ok: true, yaEstaba: true, receta: yaEstaba });
      }
      throw e;
    }
  }));
};
