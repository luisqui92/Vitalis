// ChatGo Salud — helpers compartidos para las rutas /medico/*, para no repetir
// el mismo try/catch + "buscar y verificar dueño" en cada endpoint nuevo.
const mongoose = require("mongoose");
const { log } = require("../config");

class ErrorHttp extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

// Envuelve un handler async: si tira ErrorHttp, responde con ese status/mensaje;
// si tira cualquier otra cosa, la loguea y responde 500 genérico.
function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      // Trabajo que siguió después de responder (un 202, por ejemplo): no se
      // puede contestar dos veces, solo dejarlo en el log.
      if (res.headersSent) {
        log.error(`[${req.method} ${req.path}] (ya respondido)`, e.message);
        return;
      }
      if (e instanceof ErrorHttp) {
        return res.status(e.status).json({ error: e.publicMessage });
      }
      // Un dato mal formado del pedido (un id que no es un ObjectId, una
      // fecha que no es fecha, texto donde va un número) es un error del
      // pedido, no del servidor: 400 con el campo, y no "Error interno" sin
      // ninguna pista de qué corregir.
      if (e?.name === "CastError" || e?.name === "ValidationError") {
        log.warn(`[${req.method} ${req.path}] dato inválido:`, e.message);
      }
      if (e?.name === "CastError") {
        // Un id que no puede existir es un registro que no existe: 404, como
        // ya contestan las rutas que lo revisan a mano (reproduccion.js,
        // costos.js, accesoDueno.js).
        if (e.path === "_id") return res.status(404).json({ error: "No encontrado" });
        return res.status(400).json({ error: `Valor inválido en "${e.path}"` });
      }
      if (e?.name === "ValidationError") {
        const campos = Object.keys(e.errors || {}).join(", ");
        return res.status(400).json({ error: `Datos inválidos${campos ? ` en: ${campos}` : ""}` });
      }
      if (e?.code === 11000) {
        return res.status(409).json({ error: "Ya existe un registro con esos datos." });
      }
      log.error(`[${req.method} ${req.path}]`, e.message);
      res.status(500).json({ error: "Error interno" });
    }
  };
}

// Busca un documento propio del médico (o lanza 404). El filtro SIEMPRE debe
// incluir medicoPhone — así ningún endpoint nuevo se olvida de aislar por dueño.
async function obtenerOFallar(Modelo, filtro, mensajeNoEncontrado = "No encontrado") {
  if (!filtro.medicoPhone) throw new Error("obtenerOFallar: el filtro debe incluir medicoPhone");
  // Un id mal escrito ("abc") no llega a la base: es un 404 con el mensaje
  // de esta ruta, no un CastError.
  if (filtro._id != null && !mongoose.isValidObjectId(filtro._id)) throw new ErrorHttp(404, mensajeNoEncontrado);
  const doc = await Modelo.findOne(filtro);
  if (!doc) throw new ErrorHttp(404, mensajeNoEncontrado);
  return doc;
}

// Un día civil "YYYY-MM-DD" (lo que manda un <input type="date">) que exista
// de verdad. new Date("2026-02-31") no falla: da el 3 de marzo, y así se
// guardaba. Devuelve el día anclado al mediodía UTC, como las recetas y la
// fecha de nacimiento: en cualquier zona de América sigue siendo ese día.
// "campo" va en el mensaje, así que puede ser un nombre para el médico.
function fechaCivilValida(valor, campo = "fecha") {
  const texto = String(valor ?? "").trim();
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) throw new ErrorHttp(400, `${campo} debe tener formato AAAA-MM-DD`);
  const [anio, mes, dia] = partes.slice(1).map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new ErrorHttp(400, `${campo} no es válida`);
  }
  return fecha;
}

// Un día civil "YYYY-MM-DD" que exista de verdad (no el 30 de febrero) y
// que ya haya pasado. Se deja un día de margen: a las once de la noche en
// Bolivia ya es mañana en UTC. Lo usan los registros por día de Ganadería
// (producción, gastos).
function diaPasadoValido(valor, campo = "dia") {
  const dia = String(valor || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new ErrorHttp(400, `${campo} debe tener formato AAAA-MM-DD`);
  const f = new Date(`${dia}T12:00:00Z`);
  if (Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== dia) throw new ErrorHttp(400, `${campo} no es una fecha válida`);
  const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dia > manana) throw new ErrorHttp(400, "No se puede cargar un día que todavía no pasó");
  return dia;
}

// Un número 0 o más, o null si no vino. Cero es un dato real (un día sin
// producción, un gasto sin costo) y no puede confundirse con "no se cargó".
function numeroNoNegativo(valor, campo, { requerido = false } = {}) {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) throw new ErrorHttp(400, `${campo} es requerido`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new ErrorHttp(400, `${campo} debe ser un número, 0 o más`);
  return n;
}

module.exports = { asyncRoute, ErrorHttp, obtenerOFallar, fechaCivilValida, diaPasadoValido, numeroNoNegativo };
