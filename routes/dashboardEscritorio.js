// Symphomed — Endpoints propios de la vista de escritorio: listados cruzados
// entre pacientes (recetas, estudios) que la app móvil nunca necesitó
// (ahí todo se navega paciente por paciente), más los resúmenes de
// Finanzas y Reportes.
const { Receta, Estudio, TratamientoPlan, Cita, Paciente, ConsultaMedica } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { asyncRoute } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── INDICACIONES (recetas, cruzado entre pacientes) ────────────────────
  app.get("/medico/recetas", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const recetas = await Receta.find({ medicoPhone })
      .select("indicaciones medicamentos fecha pacienteId anuladaEn")
      .populate("pacienteId", "nombre")
      .sort({ fecha: -1 })
      .limit(50)
      .lean();
    res.json({ recetas });
  }));

  // ─── ESTUDIOS E IMÁGENES (cruzado entre pacientes) ───────────────────────
  app.get("/medico/estudios", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const estudios = await Estudio.find({ medicoPhone })
      .select("tipo nombre fecha anguloFoto archivoMime pacienteId")
      .populate("pacienteId", "nombre")
      .sort({ fecha: -1 })
      .limit(50)
      .lean();
    res.json({ estudios });
  }));

  // ─── FINANZAS (solo tiene datos reales en las especialidades que usan
  // Plan de tratamiento: odontología, estética, oftalmología — en las
  // demás simplemente da todo en cero, no es un error). ───────────────────
  app.get("/medico/finanzas/resumen", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const planes = await TratamientoPlan.find({ medicoPhone })
      .select("nombre precio pagos pacienteId createdAt")
      .populate("pacienteId", "nombre")
      .sort({ createdAt: -1 })
      .lean();

    let totalFacturado = 0, totalCobrado = 0;
    const pagosRecientes = [];
    for (const plan of planes) {
      totalFacturado += plan.precio || 0;
      for (const pago of plan.pagos || []) {
        totalCobrado += pago.monto || 0;
        pagosRecientes.push({
          monto: pago.monto, fecha: pago.fecha,
          pacienteNombre: plan.pacienteId?.nombre || "", tratamiento: plan.nombre,
        });
      }
    }
    pagosRecientes.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    res.json({
      totalFacturado, totalCobrado, saldoPendiente: totalFacturado - totalCobrado,
      pagosRecientes: pagosRecientes.slice(0, 20),
      cantidadPlanes: planes.length,
    });
  }));

  // ─── REPORTES (resumen simple, últimos 6 meses) ──────────────────────────
  app.get("/medico/reportes/resumen", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const desde = new Date();
    desde.setMonth(desde.getMonth() - 5);
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);

    const [consultas, pacientesNuevos, citas] = await Promise.all([
      ConsultaMedica.find({ medicoPhone, createdAt: { $gte: desde } }).select("estado createdAt").lean(),
      Paciente.find({ medicoPhone, createdAt: { $gte: desde } }).select("createdAt").lean(),
      Cita.find({ medicoPhone, createdAt: { $gte: desde } }).select("estado createdAt").lean(),
    ]);

    function porMes(docs) {
      const porMesMap = {};
      for (const d of docs) {
        const f = new Date(d.createdAt);
        const clave = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
        porMesMap[clave] = (porMesMap[clave] || 0) + 1;
      }
      return porMesMap;
    }

    const consultasCompletadas = consultas.filter(c => c.estado === "completado").length;
    const citasCanceladas = citas.filter(c => c.estado === "cancelada").length;

    res.json({
      consultasPorMes: porMes(consultas),
      pacientesNuevosPorMes: porMes(pacientesNuevos),
      citasPorMes: porMes(citas),
      totalConsultas: consultas.length,
      porcentajeConsultasCompletadas: consultas.length ? Math.round((consultasCompletadas / consultas.length) * 100) : 0,
      totalCitas: citas.length,
      citasCanceladas,
    });
  }));
};
