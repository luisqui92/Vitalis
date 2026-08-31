// Vitalis — La sala de video de una teleconsulta.
//
// El proveedor es Daily (api.daily.co), que ya está permitido en la CSP
// porque Vapi lo usa por debajo para sus llamadas.
//
// ═══ APAGADO POR DEFECTO ═══════════════════════════════════════════════════
//
// Sin DAILY_API_KEY no hay teleconsulta, y se dice claramente en vez de
// fallar raro a mitad de una llamada. Es la misma idea que OPERADORES_SALDO
// vacía: una instalación que no configuró esto no tiene la función, en vez
// de tenerla a medias.
//
// ═══ POR QUÉ LA SALA SE CREA TARDE Y DURA POCO ═════════════════════════════
//
// La sala NO se crea cuando el médico genera el enlace, sino cuando alguien
// está por entrar. Si se creara antes, cada enlace generado y nunca usado
// dejaría una sala abierta en el proveedor — y una sala abierta es una sala
// a la que alguien puede entrar.
//
// Y expira sola. Una consulta que empezó a las 10 no tiene por qué seguir
// teniendo una sala viva a las 6 de la tarde.
const axios = require("axios");
const crypto = require("crypto");
const { log } = require("../config");

const API = "https://api.daily.co/v1";
const CLAVE = process.env.DAILY_API_KEY || "";
const HORAS_DE_VIDA = Number(process.env.TELECONSULTA_HORAS_SALA || 4);

function configurado() {
  return Boolean(CLAVE);
}

function cabeceras() {
  return { Authorization: `Bearer ${CLAVE}`, "Content-Type": "application/json" };
}

// Crea la sala si no existe. Idempotente por el nombre: si dos personas
// entran al mismo tiempo —el médico y el paciente, que es el caso normal—
// la segunda llamada se encuentra con que ya existe y sigue de largo.
async function crearSala(nombre) {
  if (!configurado()) throw new Error("La teleconsulta no está configurada en este servidor");
  const expira = Math.floor(Date.now() / 1000) + HORAS_DE_VIDA * 3600;
  try {
    const res = await axios.post(`${API}/rooms`, {
      name: nombre,
      privacy: "private", // sin token no se entra, ni sabiendo el nombre
      properties: {
        exp: expira,
        eject_at_room_exp: true,
        enable_chat: false,
        // No se graba del lado del proveedor: el audio lo captura Vitalis
        // en el navegador del médico, que es donde ya vive todo el circuito
        // de transcripción. Una grabación en la nube de un tercero es otra
        // copia de datos clínicos en un lugar más que auditar.
        enable_recording: false,
      },
    }, { headers: cabeceras(), timeout: 15000 });
    return res.data;
  } catch (e) {
    // 400 con "already exists" es el caso normal de dos personas entrando a
    // la vez, no un error.
    const msg = e.response?.data?.info || "";
    if (e.response?.status === 400 && /already exists/i.test(msg)) {
      const res = await axios.get(`${API}/rooms/${nombre}`, { headers: cabeceras(), timeout: 15000 });
      return res.data;
    }
    log.error("[TELECONSULTA] no se pudo crear la sala:", msg || e.message);
    throw new Error("No pudimos abrir la sala de video");
  }
}

// El token de entrada. Es por PERSONA y por sala: el del médico lo hace
// dueño de la reunión (puede expulsar, y la sala no arranca sin él); el del
// paciente entra como invitado.
async function tokenDeEntrada(sala, { esMedico, nombre }) {
  if (!configurado()) throw new Error("La teleconsulta no está configurada en este servidor");
  const res = await axios.post(`${API}/meeting-tokens`, {
    properties: {
      room_name: sala,
      is_owner: Boolean(esMedico),
      user_name: String(nombre || "").slice(0, 60),
      exp: Math.floor(Date.now() / 1000) + HORAS_DE_VIDA * 3600,
    },
  }, { headers: cabeceras(), timeout: 15000 });
  return res.data.token;
}

async function borrarSala(nombre) {
  if (!configurado() || !nombre) return;
  try {
    await axios.delete(`${API}/rooms/${nombre}`, { headers: cabeceras(), timeout: 15000 });
  } catch {
    // Que no se pueda borrar no puede tumbar el cierre de una consulta: la
    // sala expira sola igual (exp), así que esto es prolijidad, no seguridad.
  }
}

// Nombre irrepetible y que no dice nada de nadie. Un nombre de sala
// adivinable —"consulta-juan-perez"— es un nombre por el que alguien entra.
function nombreDeSala() {
  return `vit-${crypto.randomBytes(12).toString("hex")}`;
}

module.exports = { configurado, crearSala, tokenDeEntrada, borrarSala, nombreDeSala, HORAS_DE_VIDA };
