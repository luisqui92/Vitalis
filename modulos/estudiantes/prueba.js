// Registro abierto exclusivamente con identidad Google validada por el servidor.
const { Medico, ConsultaMedica } = require("../../db/models");
const { PruebaEstudiante } = require("./modelos");
const { CARRERAS, tituloDe, configDe } = require("./carreras");
const { zonaPorMoneda } = require("../../services/zonaHoraria");
const { ErrorHttp } = require("../../services/httpHelpers");
const { configuracion: googleConfigurado } = require("../../services/googleAcceso");
const DIAS = 3, SEGUNDOS = 15 * 60;
const activa = m => Boolean(m?.estudiante?.prueba?.activa);
function configuracion() {
  return { disponible: Boolean(googleConfigurado()) && process.env.REGISTRO_ESTUDIANTE_ABIERTO !== "apagado", dias: DIAS, minutos: SEGUNDOS / 60 };
}
async function registrar({ google, phone, nombre, universidad, periodo, idioma, carrera, nivel }) {
  if (!configuracion().disponible) throw new ErrorHttp(503, "El registro abierto no está disponible en este momento.");
  if (!google?.googleSub || !google.googleEmail) throw new ErrorHttp(400, "Entrá con Google para iniciar la prueba.");
  if (!Object.hasOwn(CARRERAS, carrera) || !CARRERAS[carrera].niveles.includes(nivel)) throw new ErrorHttp(400, "Elegí una carrera y un nivel válidos.");
  const desde = new Date(), hasta = new Date(desde.getTime() + DIAS * 86400000), moneda = idioma === "pt" ? "BRL" : "BOB";
  // Asegura el índice único antes de aceptar altas concurrentes en una instalación nueva.
  await PruebaEstudiante.init();
  try { await PruebaEstudiante.create({ _id: google.googleSub, phone, desde, hasta, segundos: SEGUNDOS, usados: 0, reservaConsulta: "" }); }
  catch (e) { if (e.code === 11000) throw new ErrorHttp(409, "Esta cuenta Google o este teléfono ya recibió una prueba. Ingresá a tu cuenta."); throw e; }
  try {
    return await Medico.create({ ...google, phone, nombre, idioma, moneda, zonaHoraria: zonaPorMoneda(moneda),
      especialidad: tituloDe(carrera, nivel, idioma), tipoEspecialidad: configDe(carrera).tipoEspecialidad,
      activo: true, estadoCuenta: "aprobada", perfilAcceso: "educativo", telefonoVerificado: false,
      formacion: { carrera, nivel, universidad, periodo, acreditacion: "declarada" },
      estudiante: { carrera, nivel, universidad, hasta, horasMes: SEGUNDOS / 3600,
        prueba: { id: google.googleSub, activa: true, desde, segundos: SEGUNDOS } },
      suscripcion: { ambito: "educativo", plan: "mensual", desde, hasta, precioCentavos: 0, moneda, activadaPor: "prueba_google" },
    });
  } catch (e) {
    await PruebaEstudiante.deleteOne({ _id: google.googleSub, phone });
    throw e;
  }
}
async function completar({ consulta, duracionSegundos }) {
  const l = consulta?.limitesAudio;
  if (!l?.id) return;
  const usados = Number.isFinite(duracionSegundos) && duracionSegundos > 0 ? Math.min(l.segundos, Math.ceil(duracionSegundos)) : l.segundos;
  await PruebaEstudiante.updateOne({ _id: l.id, reservaConsulta: String(consulta._id) }, {
    $inc: { usados: -(l.segundos - usados) }, $set: { reservaConsulta: "", reservaSegundos: 0 },
  });
}
async function estado(m) {
  let p = await PruebaEstudiante.findById(m.estudiante.prueba.id).lean();
  if (p?.reservaConsulta) {
    const c = await ConsultaMedica.findById(p.reservaConsulta).select("estado duracionSegundos limitesAudio").lean();
    if (c?.estado === "completado") {
      await completar({ consulta: c, duracionSegundos: c.duracionSegundos });
      p = await PruebaEstudiante.findById(p._id).lean();
    }
  }
  return { usados: p ? p.usados : m.estudiante.prueba.segundos, segundos: p?.segundos || m.estudiante.prueba.segundos,
    procesando: Boolean(p?.reservaConsulta) };
}
async function reservar(ctx) {
  if (!ctx.req.adminUser?.estudiante) return;
  const m = await Medico.findOne({ phone: ctx.req.adminUser.usuario }).select("phone estudiante").lean();
  if (!activa(m)) return;
  await estado(m); // Recupera una finalización guardada antes de un reinicio.
  const p = await PruebaEstudiante.findById(m.estudiante.prueba.id).lean();
  const quedan = p ? p.segundos - p.usados : 0;
  if (!p || p.hasta <= new Date() || quedan <= 0 || p.reservaConsulta) throw new ErrorHttp(402, "La prueba terminó o hay un audio en proceso. Consultá tu acceso.");
  const r = await PruebaEstudiante.updateOne({ _id: p._id, usados: p.usados, reservaConsulta: "" }, {
    $inc: { usados: quedan }, $set: { reservaConsulta: String(ctx.consultaId), reservaSegundos: quedan, reservaEn: new Date() },
  });
  if (!r.modifiedCount) throw new ErrorHttp(409, "Ya hay un audio en proceso. Esperá a que termine.");
  ctx.limitesAudio = { id: p._id, segundos: quedan };
}
async function descartar(ctx) {
  if (!ctx.limitesAudio?.id) return;
  await PruebaEstudiante.updateOne({ _id: ctx.limitesAudio.id, reservaConsulta: String(ctx.consultaId) }, {
    $inc: { usados: -ctx.limitesAudio.segundos }, $set: { reservaConsulta: "", reservaSegundos: 0 },
  });
}
async function vistaPrevia(ctx) {
  if (!ctx.req.adminUser?.estudiante) return;
  const m = await Medico.findOne({ phone: ctx.req.adminUser.usuario }).select("estudiante").lean();
  if (activa(m)) ctx.sinVistaPrevia = true;
}
function montar(extensiones) {
  extensiones.enganchar("audio.reservar", reservar);
  extensiones.enganchar("audio.descartar", descartar);
  extensiones.enganchar("audio.completar", completar);
  extensiones.enganchar("vistaPrevia.configurar", vistaPrevia);
}
module.exports = { DIAS, SEGUNDOS, activa, configuracion, registrar, estado, reservar, completar, descartar, vistaPrevia, montar };
