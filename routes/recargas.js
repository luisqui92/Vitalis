// Vitalis — El circuito de recarga, de punta a punta.
//
// Antes de esto el médico leía "mandanos el comprobante" y no se le decía a
// dónde, y el operador no tenía forma de enterarse de que alguien había
// pagado. Faltaba el circuito entero:
//
//   1. El médico ve DÓNDE pagar (QR, banco, cuenta, titular).
//   2. Paga por fuera de Vitalis y avisa acá: "pagué Bs 200, referencia X".
//   3. Eso crea una SOLICITUD PENDIENTE. No mueve un centavo.
//   4. El operador ve la cola, lo verifica EN EL BANCO, y aprueba o rechaza.
//   5. Recién al aprobar se acredita, por services/saldo.js como siempre.
//   6. El médico ve en qué estado quedó su solicitud.
//
// ═══ POR QUÉ AVISAR NO ES PAGAR ════════════════════════════════════════════
//
// Una solicitud es la PALABRA del médico, nada más. Si pudiera acreditarse
// sola —o "automáticamente si pasan 24 horas", o cualquier atajo parecido—
// cualquiera se cargaría saldo escribiendo un número en un formulario.
//
// Por eso este archivo no llama nunca a saldos.cargar() desde una ruta del
// médico. La única que acredita es la del operador, y está más abajo con sus
// propios candados.
//
// ═══ Y POR QUÉ NO SE SUBE LA FOTO DEL COMPROBANTE ══════════════════════════
//
// Porque no prueba nada: una captura se falsifica en dos minutos y el
// operador que la mira no tiene cómo notarlo. Lo único que prueba que el
// dinero entró es verlo en el extracto del banco. Guardar la imagen daría una
// sensación de control que no existe, y encima nos haría almacenar archivos
// que alguien podría creer que son un respaldo legal. El comprobante va por
// WhatsApp, que es donde ya conversan.
const { Medico, SolicitudRecarga } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { datosDePago } = require("../services/datosPago");
const { todosLosOperadores } = require("../services/operadores");
const { notificarMedico } = require("../services/push");
const saldos = require("../services/saldo");

const requireMedico = requireAuth(["medico"]);

function paraElMedico(s) {
  return {
    _id: s._id,
    montoCentavos: s.montoCentavos,
    montoBs: saldos.bolivianos(s.montoCentavos),
    montoAcreditadoCentavos: s.montoAcreditadoCentavos,
    referencia: s.referencia,
    metodo: s.metodo,
    estado: s.estado,
    motivoRechazo: s.motivoRechazo,
    createdAt: s.createdAt,
    revisadaEn: s.revisadaEn,
    // Quién la revisó NO viaja al médico: es un dato interno nuestro y no
    // le aporta nada saber el teléfono de quien la aprobó.
  };
}

module.exports = function (app) {
  // ─── DÓNDE PAGO ─────────────────────────────────────────────────────────
  app.get("/medico/recargas/datos-pago", limitMedico, requireMedico, asyncRoute(async (_req, res) => {
    res.json({ ...(await datosDePago()), recargaMinimaCentavos: saldos.RECARGA_MINIMA });
  }));

  // ─── AVISAR QUE PAGUÉ ───────────────────────────────────────────────────
  app.post("/medico/recargas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const bolivianos = Number(req.body?.bolivianos);
    const referencia = String(req.body?.referencia || "").trim().slice(0, 120);
    const metodo = ["qr", "transferencia", "efectivo", "otro"].includes(req.body?.metodo) ? req.body.metodo : "qr";
    const nota = String(req.body?.nota || "").trim().slice(0, 300);

    if (!Number.isFinite(bolivianos) || bolivianos <= 0) throw new ErrorHttp(400, "Poné cuánto pagaste");
    if (bolivianos > 5000) throw new ErrorHttp(400, "Para montos mayores a Bs 5.000, escribinos antes de avisar por acá.");
    if (!referencia) throw new ErrorHttp(400, "Poné la referencia del comprobante, para que podamos encontrar tu pago en el banco");

    // Una sola solicitud pendiente por médico. Si manda cinco porque no le
    // llegó respuesta, el operador termina con una cola llena de duplicados y
    // el riesgo real de acreditar el mismo pago dos veces.
    const yaPendiente = await SolicitudRecarga.findOne({ medicoPhone, estado: "pendiente" }).lean();
    if (yaPendiente) {
      throw new ErrorHttp(409, `Ya tenés un aviso de pago pendiente por Bs ${saldos.bolivianos(yaPendiente.montoCentavos)}. Lo estamos revisando.`);
    }

    const medico = await Medico.findOne({ phone: medicoPhone }).select("nombre").lean();
    const solicitud = await SolicitudRecarga.create({
      medicoPhone, medicoNombre: medico?.nombre || "",
      montoCentavos: Math.round(bolivianos * 100),
      referencia, metodo, nota,
    });
    registrar({ req, medicoPhone, accion: "aviso_pago", recurso: `Bs${bolivianos} ref:${referencia}` });
    res.status(201).json({ ok: true, solicitud: paraElMedico(solicitud) });

    // Avisarle al operador. Va DESPUÉS de responder y sin await: el médico no
    // tiene por qué esperar a que salga una notificación, y si el push falla
    // —permiso revocado, navegador cerrado— su aviso ya quedó registrado
    // igual. La cola es la fuente de verdad; esto es solo para que nadie
    // tenga que acordarse de mirarla.
    for (const operador of todosLosOperadores()) {
      notificarMedico(operador, {
        titulo: `Pago de ${medico?.nombre || medicoPhone}`,
        cuerpo: `Bs ${saldos.bolivianos(solicitud.montoCentavos)} · ref ${referencia}`,
        url: "/",
      }).catch(() => { /* que no llegue el aviso no puede tumbar nada */ });
    }
  }));

  // ─── MIS AVISOS ─────────────────────────────────────────────────────────
  app.get("/medico/recargas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const solicitudes = await SolicitudRecarga.find({ medicoPhone: req.adminUser.usuario })
      .sort({ createdAt: -1 }).limit(20).lean();
    res.json({ solicitudes: solicitudes.map(paraElMedico) });
  }));

  // ─── CANCELAR EL MÍO ────────────────────────────────────────────────────
  // Para cuando se equivocó de monto y quiere volver a avisar bien.
  app.delete("/medico/recargas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const borrada = await SolicitudRecarga.findOneAndDelete({
      _id: req.params.id, medicoPhone: req.adminUser.usuario, estado: "pendiente",
    });
    if (!borrada) throw new ErrorHttp(404, "No encontramos ese aviso, o ya fue revisado");
    res.json({ ok: true });
  }));
};
