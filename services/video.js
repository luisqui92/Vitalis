// Vitalis — La videollamada, sin proveedor en el medio.
//
// ═══ POR QUÉ NO HAY UN SERVICIO DE VIDEO ACÁ ═══════════════════════════════
//
// Una teleconsulta son EXACTAMENTE DOS personas: el médico y el paciente. Y
// para dos personas, WebRTC conecta los navegadores directo — el audio y el
// video van de uno al otro sin pasar por ningún servidor.
//
// Eso no es una optimización de costos (aunque lo sea: no hay minutos que
// pagar, nunca). Es que el video de un paciente contándole a su médico qué
// le duele NO PASA POR NADIE MÁS. Un proveedor de video en el medio es una
// copia de datos clínicos en una empresa que hay que auditar, en un país que
// hay que mirar, con un contrato que hay que leer.
//
// Lo que sí hace falta:
//
//   · STUN, para que cada navegador descubra su IP pública. Es un servicio
//     mínimo y hay públicos gratis. No ve ni un byte del audio.
//   · TURN, para el 10-20% de casos donde los dos extremos están detrás de
//     NAT simétrico y no logran verse — típico de redes móviles, o sea de
//     media Bolivia. Ahí el tráfico SÍ pasa por un relay, así que ese relay
//     conviene que sea NUESTRO (coturn en la misma VM) y no de un tercero.
//
// Sin TURN la función igual anda, pero falla en esa fracción y falla feo:
// la llamada "conecta" y no se escucha nada. Por eso se avisa al arrancar.
const crypto = require("crypto");
const { generarToken, verificarToken } = require("./auth");
const { log } = require("../config");

// Público de Google por defecto: solo sirve para descubrir la IP propia, no
// ve tráfico. Se puede reemplazar por el propio con la variable de entorno.
const STUN = (process.env.STUN_URLS || "stun:stun.l.google.com:19302")
  .split(",").map(s => s.trim()).filter(Boolean);

const TURN_URL = String(process.env.TURN_URL || "").trim();
const TURN_SECRET = String(process.env.TURN_SECRET || "").trim();
const TURN_USUARIO = String(process.env.TURN_USUARIO || "").trim();
const TURN_CLAVE = String(process.env.TURN_CLAVE || "").trim();

// Vitalis no necesita un proveedor para funcionar, así que esto es siempre
// true. Queda como función porque las rutas ya preguntan, y porque el día
// que haga falta un requisito nuevo se pone acá y no en cinco lugares.
function configurado() {
  return true;
}

function hayTurn() {
  return Boolean(TURN_URL && (TURN_SECRET || (TURN_USUARIO && TURN_CLAVE)));
}

// ═══ CREDENCIALES DE TURN, TEMPORALES ══════════════════════════════════════
//
// coturn admite credenciales derivadas de un secreto compartido y con
// vencimiento (REST API / "long-term credentials"). Es lo que corresponde:
// un usuario y contraseña fijos de TURN, puestos en el navegador de
// cualquiera que abra una teleconsulta, es un relay abierto para el mundo —
// y el ancho de banda lo pagás vos.
function credencialTurn() {
  if (!TURN_URL) return null;
  if (!TURN_SECRET) {
    // Usuario fijo: se acepta porque hay instalaciones que ya lo tienen así,
    // pero es el modo flojo. Con TURN_SECRET, cada llamada recibe una
    // credencial propia que vence en unas horas.
    return { urls: TURN_URL, username: TURN_USUARIO, credential: TURN_CLAVE };
  }
  const vence = Math.floor(Date.now() / 1000) + 4 * 3600;
  const username = `${vence}:vitalis`;
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
  return { urls: TURN_URL, username, credential };
}

// Lo que el navegador necesita para armar la conexión.
function iceServers() {
  const lista = [{ urls: STUN }];
  const turn = credencialTurn();
  if (turn) lista.push(turn);
  return lista;
}

// ═══ EL TOKEN DE SEÑALIZACIÓN ══════════════════════════════════════════════
//
// No da acceso a datos: da derecho a entrar a UNA sala de señalización y
// hablar con el otro extremo. Se firma con el mismo mecanismo que el resto
// de Vitalis (HMAC con JWT_SECRET) para no inventar un segundo esquema de
// firma que después nadie audita.
//
// Vive poco: es para entrar ahora, no para guardar.
function tokenDeSenal(sala, rol) {
  return generarToken(`sala:${sala}`, "senal", 4 * 3600 * 1000, { sala, papel: rol });
}

function verificarTokenDeSenal(token) {
  const p = verificarToken(token);
  if (!p || p.rol !== "senal" || !p.sala) return null;
  return { sala: p.sala, papel: p.papel === "medico" ? "medico" : "paciente" };
}

// Nombre irrepetible y que no dice nada de nadie: un nombre adivinable
// —"consulta-juan-perez"— es un nombre por el que alguien entra.
function nombreDeSala() {
  return `vit-${crypto.randomBytes(12).toString("hex")}`;
}

function avisarEstadoAlArrancar() {
  if (hayTurn()) {
    log.info(`[TELECONSULTA] WebRTC directo, con TURN propio (${TURN_SECRET ? "credenciales temporales" : "usuario fijo"})`);
  } else {
    log.warn("[TELECONSULTA] WebRTC directo SIN TURN — las llamadas entre dos redes móviles pueden conectar y no escucharse. Configurá TURN_URL/TURN_SECRET.");
  }
}

module.exports = {
  configurado, hayTurn, iceServers, tokenDeSenal, verificarTokenDeSenal,
  nombreDeSala, avisarEstadoAlArrancar,
};
