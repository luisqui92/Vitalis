// Symphomed Ganadería — dictado de campo: de la transcripción de lo que el
// veterinario dijo durante o después de visitar un lote, a los eventos
// reales que hay que registrar (mortalidad, vacunación, tratamiento,
// pesaje). Mismo mecanismo de dos pasos que services/notaClinica.js
// (transcribir, después pedirle a un segundo modelo que estructure), pero
// con un prompt propio y más chico: acá no hay motivo de consulta ni
// diagnóstico — la salida son directamente los campos de un EventoLote.
const axios = require("axios");
const { CONFIG, log } = require("../config");
const { EventoLote } = require("../db/models");

const IDIOMAS_NOTA = { es: "español", pt: "portugués de Brasil" };
function idiomaNota(idioma) {
  return IDIOMAS_NOTA[idioma] ? idioma : "es";
}

const PROMPT_SISTEMA = `Sos un asistente para veterinarios de campo que atienden PRODUCCIÓN
ANIMAL —bovinos, porcinos o aves por LOTE/GALPÓN, no mascotas individuales—.
A partir de la transcripción de lo que el veterinario dictó durante o
después de visitar un lote (puede tener errores de transcripción), extraé
los eventos reales que hay que registrar.

RESPONDE SOLO JSON con esta estructura exacta:
{
  "eventos": [
    {
      "tipo": "mortalidad, vacunacion, tratamiento o pesaje",
      "cantidadMuertes": "number o null",
      "causaPresunta": "string o null",
      "producto": "string o null",
      "dosis": "string o null",
      "viaAplicacion": "string o null",
      "cantidadAplicada": "number o null",
      "diasRetiroCarne": "number o null",
      "diasRetiroLeche": "number o null",
      "tamanoMuestra": "number o null",
      "pesoPromedioKg": "number o null",
      "notas": "string o null"
    }
  ]
}

Reglas:
- Un solo audio puede describir VARIOS eventos distintos — ej: mortalidad Y
  un tratamiento en la misma visita. Reportá uno por cada evento real que
  se menciona, nunca los mezcles en un solo objeto.
- NUNCA inventes un número o un producto que no se dijo. Si algo no se
  menciona, usá null — es mejor un campo vacío que un dato inventado que
  el veterinario no dijo.
- "diasRetiroCarne"/"diasRetiroLeche": SOLO cuando el veterinario menciona
  explícitamente un período de resguardo/carencia antes de faenar o vender
  leche. Es un dato de seguridad alimentaria: mejor dejarlo en null que
  inventar un número que no se dijo.
- Si lo que se dictó no describe ningún evento real de estos cuatro tipos
  (comentarios generales, sin datos concretos de un evento), respondé
  "eventos": [] — un array vacío es mejor que un evento inventado.
- Los números van en las unidades que se mencionan (kg para peso, días
  para retiro) — no conviertas unidades vos.`;

function promptSistema(idioma) {
  const nombre = IDIOMAS_NOTA[idiomaNota(idioma)];
  return PROMPT_SISTEMA + `

IDIOMA: escribí "causaPresunta" y "notas" en ${nombre}. Las CLAVES del JSON y
el valor de "tipo" NO se traducen nunca: van exactamente como en la lista de
arriba (mortalidad, vacunacion, tratamiento, pesaje).`;
}

const TIPOS_VALIDOS = ["mortalidad", "vacunacion", "tratamiento", "pesaje"];

// Número o null — nunca NaN, nunca undefined. La IA a veces devuelve
// "10 días" en vez de 10, o deja el campo como string vacío en lugar de
// null: cualquiera de esas variantes tiene que volverse null, no un
// CastError cuando EventoLote.create() intente guardarlo.
function numeroONull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function textoOVacio(valor) {
  return valor == null ? "" : String(valor).trim();
}

// Limpia lo que devolvió el modelo antes de que llegue a crear un solo
// EventoLote. Un evento con un "tipo" que no es uno de los cuatro válidos
// se DESCARTA entero (no se adivina cuál quiso decir); el resto de los
// campos se sanean pero nunca hacen descartar el evento — un tratamiento
// sin dosis sigue siendo un tratamiento real.
function sanearEventosLote(respuesta) {
  const crudos = Array.isArray(respuesta?.eventos) ? respuesta.eventos : [];
  return crudos
    .filter(e => e && TIPOS_VALIDOS.includes(e.tipo))
    .map(e => ({
      tipo: e.tipo,
      cantidadMuertes: numeroONull(e.cantidadMuertes),
      causaPresunta: textoOVacio(e.causaPresunta),
      producto: textoOVacio(e.producto),
      dosis: textoOVacio(e.dosis),
      viaAplicacion: textoOVacio(e.viaAplicacion),
      cantidadAplicada: numeroONull(e.cantidadAplicada),
      diasRetiroCarne: numeroONull(e.diasRetiroCarne),
      diasRetiroLeche: numeroONull(e.diasRetiroLeche),
      tamanoMuestra: numeroONull(e.tamanoMuestra),
      pesoPromedioKg: numeroONull(e.pesoPromedioKg),
      notas: textoOVacio(e.notas),
    }));
}

async function generarEventosLote(transcripcion, idioma) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: promptSistema(idioma) },
        { role: "user", content: transcripcion },
      ],
      max_tokens: 800,
      temperature: 0.1,
    },
    {
      headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` },
      timeout: CONFIG.TIMEOUT_OPENAI,
    }
  );
  const content = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  return { eventos: sanearEventosLote(JSON.parse(content)) };
}

// ─── DE SUGERENCIA A EventoLote REAL ────────────────────────────────────────
//
// Distinto criterio que la ruta manual (routes/lotesGanado.js): ahí un dato
// faltante es un 400 al médico, que todavía puede corregir el formulario. Acá
// no hay nadie mirando en el momento —esto corre en segundo plano, minutos
// después de que el veterinario ya guardó el celular— así que un evento
// incompleto o con un número que no cierra se DESCARTA en silencio (y se
// loguea) en vez de perder TODOS los eventos buenos de la misma grabación
// por culpa de uno solo.
//
// cantidadActual se seguimiento EN MEMORIA a medida que se procesan los
// eventos de una misma nota de voz, para que dos mortalidades dictadas en la
// misma frase ("se murieron 20 el lunes y 15 más el martes") se resten una
// después de la otra y no las dos contra el mismo número inicial.
async function crearEventosDesdeSugerencias(lote, eventos, { registradoPor = "" } = {}) {
  const creados = [];
  let cantidadActual = lote.cantidadActual;
  let huboMortalidad = false;

  for (const ev of eventos || []) {
    const base = { medicoPhone: lote.medicoPhone, loteId: lote._id, tipo: ev.tipo, fecha: new Date(), registradoPor, notas: ev.notas || "" };

    if (ev.tipo === "mortalidad") {
      if (!Number.isFinite(ev.cantidadMuertes) || ev.cantidadMuertes < 1) {
        log.warn(`[NOTA_VOZ_LOTE] mortalidad sin cantidad válida, se descarta (lote ${lote._id})`);
        continue;
      }
      if (ev.cantidadMuertes > cantidadActual) {
        log.warn(`[NOTA_VOZ_LOTE] mortalidad de ${ev.cantidadMuertes} supera los ${cantidadActual} vivos, se descarta (lote ${lote._id})`);
        continue;
      }
      cantidadActual -= ev.cantidadMuertes;
      huboMortalidad = true;
      creados.push(await EventoLote.create({ ...base, cantidadMuertes: ev.cantidadMuertes, causaPresunta: ev.causaPresunta }));
    } else if (ev.tipo === "vacunacion" || ev.tipo === "tratamiento") {
      if (!ev.producto) {
        log.warn(`[NOTA_VOZ_LOTE] ${ev.tipo} sin producto, se descarta (lote ${lote._id})`);
        continue;
      }
      creados.push(await EventoLote.create({
        ...base, producto: ev.producto, dosis: ev.dosis, viaAplicacion: ev.viaAplicacion,
        cantidadAplicada: ev.cantidadAplicada != null ? ev.cantidadAplicada : cantidadActual,
        diasRetiroCarne: ev.diasRetiroCarne, diasRetiroLeche: ev.diasRetiroLeche,
      }));
    } else if (ev.tipo === "pesaje") {
      if (!Number.isFinite(ev.tamanoMuestra) || ev.tamanoMuestra < 1 || !Number.isFinite(ev.pesoPromedioKg) || ev.pesoPromedioKg <= 0) {
        log.warn(`[NOTA_VOZ_LOTE] pesaje sin muestra/peso válidos, se descarta (lote ${lote._id})`);
        continue;
      }
      creados.push(await EventoLote.create({ ...base, tamanoMuestra: ev.tamanoMuestra, pesoPromedioKg: ev.pesoPromedioKg }));
    }
  }

  if (huboMortalidad) {
    lote.cantidadActual = cantidadActual;
    await lote.save();
  }
  return creados;
}

module.exports = { generarEventosLote, sanearEventosLote, crearEventosDesdeSugerencias, promptSistema };
