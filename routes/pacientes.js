// ChatGo Salud — Pacientes: la entidad central del Kardex. Cada consulta
// (con su transcripción y nota clínica), medicamento y vacuna cuelga de un
// paciente real.
const { Paciente, ConsultaMedica, Medicamento, Vacuna, Medicion, Estudio, Receta } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { siguienteCodigo } = require("../services/codigos");

const requireMedico = requireAuth(["medico"]);

function fechaCivilOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === "") return null;
  const texto = String(valor).trim();
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) throw new ErrorHttp(400, `${campo} debe tener formato AAAA-MM-DD`);
  const [anio, mes, dia] = partes.slice(1).map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new ErrorHttp(400, `${campo} no es válida`);
  }
  return fecha;
}

module.exports = function (app) {
  // ─── CREAR PACIENTE ─────────────────────────────────────────────────────
  app.post("/medico/pacientes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");

    const fechaNacimiento = fechaCivilOpcional(req.body?.fechaNacimiento, "fechaNacimiento");
    const sexo = String(req.body?.sexo || "").trim();
    const telefono = String(req.body?.telefono || "").trim();
    const notas = String(req.body?.notas || "").trim();
    const alergias = Array.isArray(req.body?.alergias)
      ? req.body.alergias.map(a => String(a || "").trim().slice(0, 120)).filter(Boolean).slice(0, 30)
      : [];
    const especie = String(req.body?.especie || "").trim();
    const raza = String(req.body?.raza || "").trim();
    const duenoNombre = String(req.body?.duenoNombre || "").trim();
    const tutorNombre = String(req.body?.tutorNombre || "").trim();
    const tutorParentesco = String(req.body?.tutorParentesco || "").trim();
    // 20 a 44 semanas es el rango biológicamente posible; fuera de ahí es un
    // error de tipeo, y guardarlo haría que la edad corregida mienta.
    const semanas = Number(req.body?.semanasGestacionAlNacer);
    const semanasGestacionAlNacer = Number.isFinite(semanas) && semanas >= 20 && semanas <= 44 ? semanas : null;

    // El código sale de una, no cuando haga falta: es lo que el técnico
    // tipea en el equipo de imagen para que el estudio se archive solo al
    // llegar (ver routes/cajaDicom.js), y lo que el paciente dicta por
    // teléfono. Un paciente sin código no puede usar ninguna de las dos.
    const codigo = await siguienteCodigo(Paciente, medicoPhone, "P");
    const paciente = await Paciente.create({ medicoPhone, codigo, nombre, fechaNacimiento, sexo, telefono, notas, alergias, especie, raza, duenoNombre, tutorNombre, tutorParentesco, semanasGestacionAlNacer });
    res.status(201).json({ ok: true, paciente });
  }));

  // ─── LISTAR PACIENTES PROPIOS ───────────────────────────────────────────
  app.get("/medico/pacientes", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const pacientes = await Paciente.find({ medicoPhone }).sort({ nombre: 1 }).lean();
    res.json({ pacientes });
  }));

  // ─── DETALLE DE PACIENTE: consultas, medicamentos y vacunas de una ──────
  // Se trae todo junto para que las pestañas del Kardex sean instantáneas
  // (sin pedir de nuevo al servidor cada vez que el médico cambia de pestaña).
  app.get("/medico/pacientes/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.id, medicoPhone }, "Paciente no encontrado");
    registrar({ req, medicoPhone, accion: "ver_paciente", recurso: `Paciente:${paciente._id}` });

    const [consultas, medicamentos, vacunas, mediciones, estudios, recetas] = await Promise.all([
      ConsultaMedica.find({ pacienteId: paciente._id, medicoPhone })
        .select("estado notaClinicaEstado notaClinica.motivoConsulta notaClinica.diagnostico notaClinica.diagnosticosEnfermeria.problema duracionSegundos createdAt")
        .sort({ createdAt: -1 })
        .lean(),
      Medicamento.find({ pacienteId: paciente._id, medicoPhone }).sort({ fechaFin: 1, createdAt: -1 }).lean(),
      Vacuna.find({ pacienteId: paciente._id, medicoPhone }).sort({ fecha: -1 }).lean(),
      Medicion.find({ pacienteId: paciente._id, medicoPhone }).sort({ fecha: 1 }).lean(),
      Estudio.find({ pacienteId: paciente._id, medicoPhone }).select("-archivoNombre").sort({ fecha: -1 }).lean(),
      Receta.find({ pacienteId: paciente._id, medicoPhone }).sort({ fecha: -1 }).lean(),
    ]);

    res.json({ paciente, consultas, medicamentos, vacunas, mediciones, estudios, recetas });
  }));

  // ─── EDITAR PACIENTE (datos básicos + antecedentes) ────────────────────
  app.patch("/medico/pacientes/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.id, medicoPhone }, "Paciente no encontrado");

    // "cpf" solo lo usa Brasil, para recetar por Memed. Va en la misma lista
    // porque el campo existe para todos y queda vacío donde no aplica —
    // ramificar la ruta por país sería dos caminos para guardar un texto.
    const campos = ["nombre", "sexo", "telefono", "notas", "especie", "raza", "duenoNombre", "tutorNombre", "tutorParentesco", "cpf"];
    for (const campo of campos) {
      if (req.body?.[campo] !== undefined) paciente[campo] = String(req.body[campo]).trim();
    }
    if (req.body?.fechaNacimiento !== undefined) {
      paciente.fechaNacimiento = fechaCivilOpcional(req.body.fechaNacimiento, "fechaNacimiento");
    }
    if (Array.isArray(req.body?.antecedentesPersonales)) {
      paciente.antecedentesPersonales = req.body.antecedentesPersonales.map(s => String(s).trim()).filter(Boolean);
    }
    if (req.body?.alergias !== undefined) {
      if (!Array.isArray(req.body.alergias)) throw new ErrorHttp(400, "alergias tiene que ser una lista");
      paciente.alergias = req.body.alergias
        .map(a => String(a || "").trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 30);
    }
    if (Array.isArray(req.body?.antecedentesFamiliares)) {
      paciente.antecedentesFamiliares = req.body.antecedentesFamiliares
        .map(a => ({ parentesco: String(a?.parentesco || "").trim(), condicion: String(a?.condicion || "").trim() }))
        .filter(a => a.parentesco || a.condicion);
    }

    await paciente.save();
    res.json({ ok: true, paciente });
  }));

  // ─── AGREGAR UN ANTECEDENTE PERSONAL ────────────────────────────────────
  // Endpoint chico aparte del PATCH de arriba porque esto se usa desde la
  // pantalla de "Sugerencias del Kardex" (detalle de consulta), que no tiene
  // cargado el array completo del paciente para reenviarlo.
  app.post("/medico/pacientes/:id/antecedentes-personales", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const texto = String(req.body?.texto || "").trim();
    if (!texto) throw new ErrorHttp(400, "texto es requerido");

    const paciente = await Paciente.findOneAndUpdate(
      { _id: req.params.id, medicoPhone },
      { $addToSet: { antecedentesPersonales: texto } },
      { new: true }
    );
    if (!paciente) throw new ErrorHttp(404, "Paciente no encontrado");
    res.status(201).json({ ok: true, paciente });
  }));

  // ─── AGREGAR UN ANTECEDENTE FAMILIAR ────────────────────────────────────
  app.post("/medico/pacientes/:id/antecedentes-familiares", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const parentesco = String(req.body?.parentesco || "").trim();
    const condicion = String(req.body?.condicion || "").trim();
    if (!parentesco && !condicion) throw new ErrorHttp(400, "parentesco o condicion son requeridos");

    const paciente = await Paciente.findOneAndUpdate(
      { _id: req.params.id, medicoPhone },
      { $push: { antecedentesFamiliares: { parentesco, condicion } } },
      { new: true }
    );
    if (!paciente) throw new ErrorHttp(404, "Paciente no encontrado");
    res.status(201).json({ ok: true, paciente });
  }));
};
