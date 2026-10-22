// Identidad, formación y habilitación son datos distintos. Ninguno se toma del token de Google.
const crypto = require("crypto");
const { ErrorHttp } = require("./httpHelpers");
const AREAS = ["medicina_general", "odontologia", "estetica", "oftalmologia", "veterinaria", "ginecologia", "pediatria", "neurodesarrollo", "fisioterapia"];
const texto = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";

function datosProfesionales(body) {
  const pais = texto(body?.pais, 2).toUpperCase();
  const profesion = texto(body?.profesion, 100);
  const matricula = texto(body?.matricula, 60);
  const tipoEspecialidad = texto(body?.tipoEspecialidad, 40);
  if (!/^[A-Z]{2}$/.test(pais) || !profesion || !matricula || !AREAS.includes(tipoEspecialidad)) {
    throw new ErrorHttp(400, "Completá país (código de dos letras), profesión, área y matrícula profesional.");
  }
  const etapa = texto(body?.etapa, 30) || "profesional";
  if (!["profesional", "residente"].includes(etapa)) throw new ErrorHttp(400, "Elegí profesional o residente.");
  return { pais, profesion, matricula, tipoEspecialidad, etapa };
}

function nuevaSolicitud(datos, tipo = "alta") {
  return { ...datos, tipo, estado: "pendiente", revision: crypto.randomUUID(), pedidaEn: new Date(),
    correo: nuevoAvisoCuenta("recibida"), resueltaEn: null, resueltaPor: "", motivo: "", mensaje: texto(datos.mensaje, 600) };
}

// Se guarda en la misma escritura que la solicitud; no depende de un envío HTTP.
function nuevoAvisoCuenta(tipo) {
  return { id: crypto.randomUUID(), tipo, estado: "pendiente", intentos: 0, proximoIntento: new Date() };
}

function pendiente(m) {
  return m.estadoCuenta === "pendiente" || (m.solicitud?.tipo === "conversion" && m.solicitud.estado === "pendiente");
}

function filtroRevision(m) {
  // También soporta solicitudes anteriores a esta versión.
  return { _id: m._id, "solicitud.revision": m.solicitud?.revision || { $in: [null, ""] },
    ...(m.solicitud?.tipo === "conversion" ? { activo: true, "solicitud.estado": "pendiente", "estudiante.nivel": { $exists: true } } : { estadoCuenta: "pendiente" }) };
}

function revisionProfesional(m, body, quien) {
  if (String(body?.revision ?? "") !== (m.solicitud?.revision || "")) throw new ErrorHttp(409, "La solicitud cambió. Actualizá el panel antes de decidir.");
  if (m.phone === quien) throw new ErrorHttp(403, "No podés aprobar tu propia solicitud.");
  const datos = datosProfesionales({ ...body, ...Object.fromEntries(Object.entries({
    pais: m.solicitud?.pais, profesion: m.solicitud?.profesion, matricula: m.solicitud?.matricula || m.matricula,
    tipoEspecialidad: m.solicitud?.tipoEspecialidad || m.tipoEspecialidad, etapa: m.solicitud?.etapa,
  }).filter(([, v]) => v)) });
  if (body?.identidadComprobada !== true || body?.matriculaComprobada !== true) throw new ErrorHttp(400, "Confirmá la identidad y la matrícula antes de aprobar.");
  const metodo = texto(body.metodo, 30), referencia = texto(body.referencia, 500);
  if (!["registro_oficial", "revision_documental"].includes(metodo) || referencia.length < 10) {
    throw new ErrorHttp(400, "Registrá el método y la referencia de la verificación (al menos 10 caracteres).");
  }
  return { estado: "verificada", ...datos, metodo, referencia, verificadoPor: quien, verificadoEn: new Date() };
}

function accesoProfesionalValido(m) {
  // Las cuentas históricas no se reclasifican automáticamente ni se rotulan como verificadas.
  return m.perfilAcceso !== "profesional" || m.verificacionProfesional?.estado === "verificada";
}

module.exports = { nuevoAvisoCuenta, datosProfesionales, nuevaSolicitud, pendiente, filtroRevision, revisionProfesional, accesoProfesionalValido };
