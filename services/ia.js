// Symphomed — Los pedidos a la IA de texto, en un solo lugar.
//
// Lo usan los módulos que le piden texto a la IA (hoy, modulos/estudiantes:
// el tutor, el paciente virtual y los simulacros). La dirección sale de CONFIG.OPENAI_URL (ver
// config/index.js): así las pruebas de pantalla la pueden apuntar a una IA de
// mentira y probar todo el camino, del navegador a la base.
const axios = require("axios");
const { CONFIG } = require("../config");

const MODELO = "gpt-4o-mini";

// mensajes: [{ role: "user" | "assistant", content }], sin el de sistema.
async function pedir(sistema, mensajes, { maxTokens = 800, temperatura = 0.2, json = true, timeout = CONFIG.TIMEOUT_OPENAI } = {}) {
  const res = await axios.post(
    CONFIG.OPENAI_URL,
    {
      model: MODELO,
      messages: [{ role: "system", content: sistema }, ...mensajes],
      max_tokens: maxTokens,
      temperature: temperatura,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    },
    { headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` }, timeout }
  );
  return String(res.data?.choices?.[0]?.message?.content || "");
}

// usuario: el texto del pedido, o la conversación entera (mensajes).
async function pedirJson(sistema, usuario, opciones = {}) {
  const mensajes = Array.isArray(usuario) ? usuario : [{ role: "user", content: usuario }];
  const texto = await pedir(sistema, mensajes, { ...opciones, json: true });
  return JSON.parse(texto.replace(/```json|```/g, "").trim());
}

async function pedirTexto(sistema, mensajes, opciones = {}) {
  return (await pedir(sistema, mensajes, { ...opciones, json: false })).trim();
}

module.exports = { pedirJson, pedirTexto, MODELO };
