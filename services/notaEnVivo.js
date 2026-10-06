// Symphomed — La nota en vivo: escrita mientras se graba, verificada después.
//
// ═══ POR QUÉ ═══════════════════════════════════════════════════════════════
//
// Antes, al tocar «Terminar», pasaba todo esto uno detrás del otro: subir el
// audio, que AssemblyAI lo transcribiera de nuevo entero, y recién ahí
// escribir la nota. Medido en producción: hasta con un audio de menos de un
// minuto, el médico esperaba de uno a tres minutos y medio.
//
// Pero el texto ya existía: la vista previa en vivo lo va mostrando mientras
// se habla, y se tiraba. Ahora:
//
//   1. Mientras se graba, cada minuto, ese texto va a la IA y la nota se va
//      armando en la pantalla (POST /medico/consultas/nota-en-vivo). No se
//      guarda nada: es un borrador.
//   2. Al terminar, si el texto en vivo llegó ENTERO, la nota sale de ahí en
//      segundos. Si el último borrador ya era de ese mismo texto, ni siquiera
//      se le pide de nuevo a la IA: se reusa (la caché de abajo).
//   3. La transcripción completa sigue haciéndose, como siempre, y cuando
//      termina VERIFICA la nota: medicamentos, dosis y frecuencias.
//
// ═══ LA VERIFICACIÓN NO CAMBIA NADA SOLA ═══════════════════════════════════
//
// Misma regla que con los nombres de medicamentos: si el audio completo dice
// «500 mg» y la nota «50 mg», se le MUESTRA al médico, con un botón para
// usar lo del audio. Nunca se reemplaza solo, y menos mientras él lo está
// leyendo o corrigiendo.
//
// Y no se puede confirmar hasta que la verificación termina: confirmar
// manda la receta y la medicación al Kardex, y eso no puede salir de un
// texto que nadie comparó todavía con el audio.
//
// ═══ CUÁNDO NO SE USA ══════════════════════════════════════════════════════
//
// Si la vista previa se cortó (internet malo, el celular frenó el audio con
// la pantalla apagada), el texto en vivo tiene huecos y una nota hecha de ahí
// podría no tener justo lo importante. Lo decide el navegador, que es el que
// sabe cuánto audio llegó a mandar (public/js/audio.js); en ese caso no
// manda el texto y la nota sale de la transcripción completa, como antes.
const crypto = require("crypto");

// ─── La caché del último borrador ─────────────────────────────────────────
//
// Al terminar de grabar, el navegador pide un último borrador con TODO el
// texto (para mostrarlo ya) y, apenas sube el audio, manda ese mismo texto
// para la nota de verdad. Pedirle a la IA dos veces lo mismo es esperar dos
// veces. Se guarda el borrador generado ACÁ, en el servidor, por el texto
// exacto: lo que se reusa lo escribió la IA, no lo que mande el navegador.
const DURACION_CACHE_MS = 30 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map();

function claveDe(medicoPhone, pacienteId, texto) {
  const hash = crypto.createHash("sha256").update(String(texto || "")).digest("hex");
  return `${medicoPhone}|${pacienteId}|${hash}`;
}

function guardarBorrador(medicoPhone, pacienteId, texto, nota) {
  const ahora = Date.now();
  for (const [k, v] of cache) if (ahora - v.en > DURACION_CACHE_MS) cache.delete(k);
  while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(claveDe(medicoPhone, pacienteId, texto), { nota, en: ahora });
}

// Una copia: el que la recibe la guarda en Mongo y la puede modificar.
function borradorDe(medicoPhone, pacienteId, texto) {
  const v = cache.get(claveDe(medicoPhone, pacienteId, texto));
  if (!v || Date.now() - v.en > DURACION_CACHE_MS) return null;
  return JSON.parse(JSON.stringify(v.nota));
}

function olvidarCache() { cache.clear(); }

// ─── Comparar los medicamentos de dos notas ───────────────────────────────

// «Losartán potásico» → «losartan». Solo la primera palabra: la sal, la
// marca o la presentación cambian de una transcripción a la otra.
function base(nombre) {
  const plano = String(nombre || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (plano.match(/[a-z]+/g) || []).find(p => p.length >= 3) || "";
}

function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// El mismo medicamento aunque una transcripción lo haya escuchado un poco
// distinto («amoxicilina» / «amoxilina»).
function mismoMedicamento(a, b) {
  const x = base(a), y = base(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5)) return true;
  return x.length >= 6 && y.length >= 6 && distancia(x, y) <= 2;
}

// Los números de la dosis y la frecuencia: «500 mg cada 8 horas» → 500, 8.
// Es lo que no se puede escuchar mal sin consecuencias.
function numeros(m) {
  return (String(`${m?.dosis || ""} ${m?.frecuencia || ""}`).match(/\d+(?:[.,]\d+)?/g) || [])
    .map(n => n.replace(",", "."))
    .sort();
}

const texto = (m) => [m?.nombre, m?.dosis, m?.frecuencia].filter(x => String(x || "").trim()).join(" ");

// notaVivo es la que ve el médico; notaAudio, la que sale de la
// transcripción completa. Devuelve lo que hay que mostrarle:
//   · dosis        — el mismo medicamento con otros números;
//   · falta        — el audio completo lo menciona y la nota no;
//   · noMencionado — la nota lo tiene y el audio completo no.
// Si un lado no tiene números (la dosis no se dijo), no hay nada que
// comparar: no es una diferencia.
function compararMedicamentos(notaVivo, notaAudio) {
  const enAudio = (notaAudio?.medicamentosRecetados || []).filter(m => String(m?.nombre || "").trim());
  const usados = new Set();
  const diferencias = [];
  (notaVivo?.medicamentosRecetados || []).forEach((m, indice) => {
    if (!String(m?.nombre || "").trim()) return;
    const j = enAudio.findIndex((a, k) => !usados.has(k) && mismoMedicamento(m.nombre, a.nombre));
    if (j === -1) {
      diferencias.push({ tipo: "noMencionado", indice, enNota: texto(m), enAudio: "" });
      return;
    }
    usados.add(j);
    const a = enAudio[j];
    const nNota = numeros(m), nAudio = numeros(a);
    if (nNota.length && nAudio.length && nNota.join("|") !== nAudio.join("|")) {
      diferencias.push({ tipo: "dosis", indice, enNota: texto(m), enAudio: texto(a),
        medicamento: { nombre: a.nombre || "", dosis: a.dosis || "", frecuencia: a.frecuencia || "" } });
    }
  });
  enAudio.forEach((a, k) => {
    if (usados.has(k)) return;
    diferencias.push({ tipo: "falta", indice: null, enNota: "", enAudio: texto(a),
      medicamento: { nombre: a.nombre || "", dosis: a.dosis || "", frecuencia: a.frecuencia || "" } });
  });
  return diferencias;
}

// ═══ ¿SE DIJO ESTE MEDICAMENTO? ═════════════════════════════════════════════
//
// Caso real, en la primera prueba de la nota en vivo: el médico dijo
// «paracetamol» y la nota puso «ibuprofeno 400 mg cada 8 horas». La IA
// completó con lo que «suele» indicarse para una faringitis.
//
// La verificación con el audio completo compara contra OTRA nota escrita por
// la IA, que puede equivocarse igual. Esto no depende de ninguna IA: busca el
// nombre en el TEXTO de lo que se dijo. Si no está, se avisa (no se borra:
// la transcripción también puede haber escuchado mal, y el que decide es el
// médico).

// Palabras de un nombre que no dicen qué fármaco es: la sal, la forma.
const PALABRAS_DE_RELLENO = new Set(["acido", "sodico", "sodica", "potasico", "potasica", "potassico", "potassica",
  "clorhidrato", "cloridrato", "comprimido", "comprimidos", "tableta", "tabletas", "capsula", "capsulas",
  "jarabe", "xarope", "gotas", "solucion", "solucao", "crema", "creme", "inyectable", "injetavel", "con", "com"]);

function palabras(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]+/g) || [];
}

function parecidas(x, y) {
  if (x === y) return true;
  if (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5)) return true;
  return x.length >= 6 && y.length >= 6 && Math.abs(x.length - y.length) <= 2 && distancia(x, y) <= 2;
}

// correcciones: lo que este médico ya enseñó («Inibidor de ATE» →
// «Espironolactona»): si en el texto está lo que se escuchó mal, cuenta.
function nombradoEnTexto(nombre, texto, correcciones = []) {
  const dichas = new Set(palabras(texto));
  if (!dichas.size) return true;   // sin texto no hay con qué comparar: no se marca
  const esta = (n) => palabras(n).filter(p => p.length >= 4 && !PALABRAS_DE_RELLENO.has(p))
    .some(p => dichas.has(p) || [...dichas].some(d => parecidas(p, d)));
  if (esta(nombre)) return true;
  return correcciones.some(c => mismoMedicamento(c.correcto, nombre) && esta(c.dijo));
}

// Las posiciones de los medicamentos de la nota que no se nombraron.
function medicamentosNoNombrados(nota, texto, correcciones = []) {
  return (nota?.medicamentosRecetados || [])
    .map((m, i) => (String(m?.nombre || "").trim() && !nombradoEnTexto(m.nombre, texto, correcciones) ? i : -1))
    .filter(i => i >= 0);
}

module.exports = { guardarBorrador, borradorDe, olvidarCache, compararMedicamentos, mismoMedicamento, nombradoEnTexto, medicamentosNoNombrados };
