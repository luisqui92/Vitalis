// ChatGo Salud — helpers compartidos para las rutas /medico/*, para no repetir
// el mismo try/catch + "buscar y verificar dueño" en cada endpoint nuevo.
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
      if (e instanceof ErrorHttp) {
        return res.status(e.status).json({ error: e.publicMessage });
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
  const doc = await Modelo.findOne(filtro);
  if (!doc) throw new ErrorHttp(404, mensajeNoEncontrado);
  return doc;
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

module.exports = { asyncRoute, ErrorHttp, obtenerOFallar, diaPasadoValido, numeroNoNegativo };
