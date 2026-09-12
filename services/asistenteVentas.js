// Symphomed — El asistente que atiende a los MÉDICOS que preguntan por
// Symphomed, en el mismo WhatsApp por el que los pacientes reservan.
//
// ═══ POR QUÉ COMPARTE NÚMERO CON LAS RESERVAS ═════════════════════════════
//
// Porque el botón de symphomed.com ya manda a ese número, y porque mantener
// dos configuraciones de Meta para un negocio que todavía tiene cero médicos
// es trabajo sin cliente.
//
// La condición para que compartirlo sea seguro: este flujo SOLO responde a
// quien escribió primero. Nunca sale a buscar a nadie. Meta le pone una
// calificación de calidad al número, es UNA sola para todo, y si un médico
// que no pidió nada bloquea o reporta, el que deja de recibir mensajes es el
// PACIENTE que quería reservar. El día que haya campañas a médicos, van por
// un segundo número.
//
// ═══ LOS PRECIOS NO SE ESCRIBEN ACÁ ═══════════════════════════════════════
//
// Se leen de las mismas funciones que cobran (saldo.js, suscripciones.js,
// monedas.js), que a su vez los leen del entorno para poder cambiarlos sin
// desplegar.
//
// Si estuvieran escritos en el prompt, el día que se cambie PRECIO_CONSULTA_
// CENTAVOS la IA seguiría diciendo el precio viejo — a médicos que están
// decidiendo si contratar, con un número que después no le van a cobrar. Es
// el mismo problema que ya está anotado en suscripciones.js sobre la página:
// si se cambia un precio sin el otro, algo pasa a mentir. Acá no puede.
const axios = require("axios");
const { CONFIG, log } = require("../config");
const monedas = require("./monedas");
const saldo = require("./saldo");
const suscripciones = require("./suscripciones");

// ═══ QUÉ SE PUEDE CONTAR Y QUÉ NO ═════════════════════════════════════════
//
// Lo mismo que rige las fichas de tecnología de la página: se dice QUÉ LOGRA
// y nunca CÓMO ESTÁ HECHO. Ningún proveedor nombrado —ni el de transcripción,
// ni el del modelo, ni el de la receta digital— ni una pista de arquitectura.
// Eso es exactamente lo que un competidor necesita para copiar, y no le
// aporta nada al médico que está decidiendo si probar.
//
// La regla no se le pide "por favor" a la IA: se comprueba después, en
// limpiar(), porque un prompt es una sugerencia y un filtro es un filtro.
const PROHIBIDAS = [
  "openai", "gpt", "chatgpt", "anthropic", "claude", "assemblyai", "whisper",
  "deepgram", "memed", "vapi", "twilio", "mongodb", "mongo", "express",
  "node.js", "nodejs", "aws", "azure", "google cloud",
];

function precios(moneda) {
  const cfg = monedas.config(moneda);
  const mensual = suscripciones.precioMensual(moneda);
  const anual = suscripciones.precioDelPlan("anual", moneda);
  const porConsulta = cfg.precioConsulta;
  return {
    simbolo: cfg.simbolo,
    consulta: monedas.conSimbolo(porConsulta, moneda),
    mensual: monedas.conSimbolo(mensual, moneda),
    anual: monedas.conSimbolo(anual, moneda),
    // Este número es el argumento de venta, no un dato de color: es el punto
    // exacto desde el que conviene el plan. Se calcula, no se escribe.
    consultasDelPlan: Math.round(mensual / porConsulta),
    gratis: saldo.CONSULTAS_GRATIS,
  };
}

const PROMPT_SISTEMA = `Atendés el WhatsApp de Symphomed y hablás con MÉDICOS que están
averiguando si les sirve. No hablás con pacientes.

Symphomed es una plataforma para consultorios: escucha la consulta y de ahí
sale la nota clínica estructurada, la receta y el control siguiente, sin que
el médico escriba nada. Tiene módulos por especialidad (odontología con
odontograma, pediatría con curvas de crecimiento sobre percentiles OMS,
neurodesarrollo con los instrumentos y sus puntajes, ginecología con control
prenatal, oftalmología con agudeza y refracción, imágenes con visor que mide,
y Symphomed Pet para veterinaria). Los pacientes reservan por WhatsApp solos
y el seguimiento posterior —reconsultas, laboratorios pendientes, vacunas—
lo recuerda la plataforma.

QUÉ NO PODÉS DECIR NUNCA:
- Cómo está hecho por dentro. Ni un proveedor, ni un modelo, ni una
  tecnología, ni arquitectura. Si preguntan "¿qué IA usan?", "¿con qué está
  programado?", respondé qué LOGRA y ofrecé mostrarlo en una demostración.
  Esto no es coquetería: es lo único que impide que nos copien.
- Un precio, un descuento o una condición que no esté en los DATOS REALES de
  abajo. Ni redondear, ni "más o menos", ni "creo que". Si preguntan algo de
  plata que no está ahí, decí que se lo confirman en la demostración.
- Promesas sobre lo que la plataforma todavía no hace. Si preguntan por algo
  que no está en la descripción de arriba, decí que no lo sabés con certeza y
  que lo ven en la demostración. Es mejor perder una respuesta que prometer
  algo que el médico descubre que falta en su primera semana.
- Nada clínico: ni opiniones, ni diagnósticos, ni tratamientos.

CÓMO HABLAR:
- De usted. Breve y concreto: es WhatsApp, no un correo.
- Como colega que conoce el producto, no como folleto. Nada de "revolucionario",
  "innovador", "líder del mercado".
- Si la persona dice de qué especialidad es, hablale de SU módulo.

INTENCIONES:
- "pregunta": está averiguando. Respondé y, si viene al caso, ofrecé la
  demostración de quince minutos con un caso real.
- "interesado": pidió la demostración, pidió que lo llamen, preguntó cómo
  empezar, o dio sus datos. Respondé confirmando que le escriben en breve.
- "paciente": se equivocó de flujo — quiere reservar una cita médica, no
  conocer Symphomed. Respondé null: lo maneja el otro asistente.

DATOS que hayas podido sacar de la conversación (null lo que no sepas):
nombre, especialidad, ciudad.

RESPONDÉ SOLO JSON:
{"intencion":"pregunta"|"interesado"|"paciente","respuesta":"string o null",
 "datos":{"nombre":null,"especialidad":null,"ciudad":null}}`;

// El filtro que no depende de que la IA obedezca. Un prompt es una
// sugerencia; esto es una red. Si se filtra el nombre de un proveedor, se
// corta la respuesta y se manda la genérica: perder una respuesta cuesta
// mucho menos que regalarle a un competidor por dónde vamos.
function limpiar(respuesta) {
  if (!respuesta) return null;
  const bajo = respuesta.toLowerCase();
  const filtrada = PROHIBIDAS.find(p => bajo.includes(p));
  if (filtrada) {
    log.warn(`[VENTAS] La respuesta nombraba «${filtrada}» — descartada`);
    return null;
  }
  return respuesta;
}

const RESPALDO = {
  es: "Con gusto le cuento. ¿Le viene bien que le mostremos cómo funciona con un caso real? Son quince minutos y las primeras consultas no se cobran.",
  pt: "Com prazer. Podemos mostrar como funciona com um caso real? São quinze minutos e as primeiras consultas não são cobradas.",
};

// idioma: "es" o "pt" — define en qué habla y en qué moneda cotiza. Se saca
// del idioma del WhatsApp de quien escribe, no del país: un médico brasileño
// que prefiere el español existe (ver routes/inicio.js).
async function atenderMedico(mensaje, historial = [], idioma = "es") {
  const moneda = monedas.monedaSegunIdioma(idioma);
  const p = precios(moneda);

  const datosReales = `DATOS REALES DE PRECIO (${moneda}) — son los únicos que podés decir:
- Consulta suelta: ${p.consulta}
- Plan mensual: ${p.mensual}, que equivale a ${p.consultasDelPlan} consultas — desde ahí conviene el plan
- Plan anual: ${p.anual} (doce meses al precio de once)
- Las primeras ${p.gratis} consultas de una cuenta nueva no se cobran
- No hay costo de instalación ni permanencia; las historias se exportan completas el día que quiera irse
Idioma de la conversación: ${idioma === "pt" ? "portugués de Brasil" : "español"}.`;

  const conversacion = historial
    .slice(-6)
    .map(m => ({ role: m.de === "medico" ? "user" : "assistant", content: m.texto }));

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: PROMPT_SISTEMA },
          { role: "system", content: datosReales },
          ...conversacion,
          { role: "user", content: mensaje },
        ],
        max_tokens: 400,
        temperature: 0.3,
      },
      { headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` }, timeout: CONFIG.TIMEOUT_OPENAI }
    );
    const crudo = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
    const r = JSON.parse(crudo);
    return {
      intencion: ["pregunta", "interesado", "paciente"].includes(r.intencion) ? r.intencion : "pregunta",
      respuesta: limpiar(r.respuesta) || (r.intencion === "paciente" ? null : RESPALDO[idioma] || RESPALDO.es),
      datos: {
        nombre: r.datos?.nombre || null,
        especialidad: r.datos?.especialidad || null,
        ciudad: r.datos?.ciudad || null,
      },
    };
  } catch (e) {
    // Que la IA falle no puede dejar a un médico interesado hablando solo:
    // se contesta algo verdadero y se sigue. Perder el matiz de la respuesta
    // cuesta mucho menos que perder el contacto.
    log.error("[VENTAS] atenderMedico falló:", e.message);
    return {
      intencion: "pregunta",
      respuesta: RESPALDO[idioma] || RESPALDO.es,
      datos: { nombre: null, especialidad: null, ciudad: null },
    };
  }
}

module.exports = { atenderMedico, precios, limpiar, PROHIBIDAS };
