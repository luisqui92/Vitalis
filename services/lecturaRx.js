// Vitalis — Segunda lectura de una radiografía dental.
//
// ═══ ESTO NO DIAGNOSTICA, Y NO ES UNA FORMA DE HABLAR ══════════════════════
//
// Describe lo que se ve en la imagen. No concluye, no nombra enfermedades y
// no dice si algo está bien. La lectura que vale es la del odontólogo; esto
// es una segunda mirada que él pide, después de la suya.
//
// ═══ POR QUÉ NUNCA PUEDE DECIR "NORMAL" NI "SIN HALLAZGOS" ═════════════════
//
// El modo de falla que hace daño no es el falso positivo. Si marca algo que
// no está, el odontólogo lo mira, lo descarta, y perdió treinta segundos.
//
// El que hace daño es el ANCLAJE. Si esto dice "sin hallazgos" y hay una
// lesión, el que leyó eso primero la ve MENOS de lo que la habría visto
// solo. Ahí la herramienta no falló: empeoró al médico. Y es invisible,
// porque nadie audita las placas que salieron bien.
//
// Por eso el prompt prohíbe afirmar ausencias, y por eso la pantalla tiene
// que abrirse DESPUÉS de que el odontólogo escribió su lectura. Contra el
// anclaje no hay prompt que alcance: se resuelve con el orden.
//
// ═══ Y POR QUÉ NO HAY PORCENTAJES DE CERTEZA ═══════════════════════════════
//
// "Caries oclusal, 87% de confianza" es un número inventado con apariencia
// de medición. No sale de ninguna calibración: sale de que el modelo eligió
// un número. Un profesional lo lee como si significara algo, y no significa
// nada. Se describe en palabras cuán claro se ve, que es lo honesto.
//
// ═══ ESTADO: SIN VALIDAR ═══════════════════════════════════════════════════
//
// gpt-4o-mini —el modelo del resto de Vitalis— no es un modelo de
// radiología, y ninguno de los generalistas lo es. Mirando una placa no
// dicen "no sé": inventan hallazgos con lenguaje seguro.
//
// Por eso esto todavía no se le muestra a nadie desde una ficha. Primero la
// Fase 0: correrlo sobre placas que un odontólogo YA leyó y comparar,
// mirando sobre todo qué se le pasó. Ver scripts/probar_lectura_rx.js.
const fs = require("fs");
const axios = require("axios");
const { CONFIG } = require("../config");

// Configurable porque en Fase 0 hay que poder comparar modelos, y porque el
// del resto de Vitalis (mini) es el más flojo justo en visión.
const MODELO = process.env.MODELO_LECTURA_RX || "gpt-4o";

const PROMPT = `Sos un asistente que DESCRIBE radiografías dentales (periapicales y bitewing) para un odontólogo que ya hizo su propia lectura. Tu texto es una segunda mirada, no un informe.

REGLAS QUE NO SE NEGOCIAN:

1. DESCRIBÍ, NO CONCLUYAS. Decí lo que se observa ("zona radiolúcida en la cara distal de la pieza 36"), nunca lo que significa ("caries distal en 36"). No nombres enfermedades ni diagnósticos.

2. NUNCA AFIRMES UNA AUSENCIA. Está prohibido escribir "normal", "sin hallazgos", "sin caries", "todo en orden" o cualquier variante. Si no ves algo, no lo menciones. Decir que algo no está es una afirmación que no podés sostener, y es la que hace que se pase por alto una lesión real.

3. NADA DE PORCENTAJES NI PUNTAJES. Describí en palabras cuán claro se ve: "se ve con nitidez", "es apenas insinuado", "la imagen no permite definirlo".

4. SI LA IMAGEN NO ALCANZA, DECILO. Angulación, sobreexposición, elemento cortado por el borde, superposición. Es la observación más útil que podés hacer, y la que un modelo tiende a callar.

5. UBICÁ TODO. Usá numeración FDI cuando la pieza se identifique; si no, describí la zona ("sector posterior superior derecho"). Si no podés ubicarlo, decilo en vez de adivinar.

6. NO INVENTES. Si no distinguís algo, escribilo. "No logro distinguir el ápice de la pieza 46 en esta toma" es una respuesta correcta y valiosa.

Respondé SOLO con JSON:
{
  "calidadImagen": "qué limita la lectura de esta toma, o cadena vacía si no hay nada que señalar",
  "observaciones": [
    { "ubicacion": "pieza FDI o zona", "seObserva": "descripción de lo que se ve", "claridad": "nítido | insinuado | no permite definirlo" }
  ],
  "zonasARevisar": ["zonas donde el odontólogo debería mirar con atención, sin afirmar que haya algo"],
  "noPuedoEvaluar": ["partes de la imagen que no se pueden leer y por qué"]
}`;

function comoDataUrl(rutaArchivo) {
  const ext = rutaArchivo.toLowerCase().split(".").pop();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(rutaArchivo).toString("base64")}`;
}

// Devuelve la lectura, o lanza. NO escribe en la base: quien la use decide
// qué hacer con ella, y por ahora el único que la usa es el script de Fase 0.
async function leerRadiografia(rutaArchivo, { modelo = MODELO } = {}) {
  if (!CONFIG.OPENAI_KEY) throw new Error("Falta OPENAI_KEY");
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: modelo,
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Describí esta radiografía dental siguiendo las reglas." },
            { type: "image_url", image_url: { url: comoDataUrl(rutaArchivo), detail: "high" } },
          ],
        },
      ],
      max_tokens: 1200,
      temperature: 0.1,
    },
    {
      headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` },
      timeout: CONFIG.TIMEOUT_OPENAI,
    }
  );
  const crudo = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  return { ...sanear(JSON.parse(crudo)), modelo };
}

// Última barrera contra la regla 2. Un prompt es una instrucción, no una
// garantía: el modelo puede colar un "sin hallazgos" igual, y si eso llega a
// la pantalla el daño ya está hecho. Acá se corta.
const PROHIBIDAS = /\b(normal|sin hallazgos|sin alteraciones|no se observan?|no hay|todo en orden|sano|sana|ausencia de)\b/i;

function sanear(lectura) {
  const observaciones = (Array.isArray(lectura?.observaciones) ? lectura.observaciones : [])
    .filter(o => o?.seObserva && !PROHIBIDAS.test(String(o.seObserva)));
  return {
    calidadImagen: String(lectura?.calidadImagen || "").trim(),
    observaciones: observaciones.map(o => ({
      ubicacion: String(o.ubicacion || "").trim(),
      seObserva: String(o.seObserva).trim(),
      claridad: ["nítido", "insinuado", "no permite definirlo"].includes(o.claridad) ? o.claridad : "insinuado",
    })),
    zonasARevisar: (Array.isArray(lectura?.zonasARevisar) ? lectura.zonasARevisar : [])
      .map(z => String(z).trim()).filter(Boolean),
    noPuedoEvaluar: (Array.isArray(lectura?.noPuedoEvaluar) ? lectura.noPuedoEvaluar : [])
      .map(z => String(z).trim()).filter(Boolean),
    // Cuántas observaciones se descartaron por afirmar una ausencia. En Fase 0
    // este número importa: si es alto, el prompt no está alcanzando.
    descartadasPorAfirmarAusencia:
      (Array.isArray(lectura?.observaciones) ? lectura.observaciones.length : 0) - observaciones.length,
  };
}

// sanear se exporta para poder probarlo sin gastar una llamada a la API: es
// la última barrera contra la regla 2, y una barrera sin prueba es un deseo.
module.exports = { leerRadiografia, sanear, PROMPT, PROHIBIDAS, MODELO };
