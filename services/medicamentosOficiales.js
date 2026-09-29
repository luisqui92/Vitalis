// Symphomed — Revisar los medicamentos de la nota contra las listas oficiales.
//
// ═══ POR QUÉ ═══════════════════════════════════════════════════════════════
//
// El transcriptor en portugués no tiene modo médico: cuando escucha un
// fármaco que no conoce, escribe la palabra más parecida que sí conoce. Pasó
// en una consulta real («inibidor de ATE»). Si eso llega a la lista de
// medicamentos de la nota y el médico confirma sin mirar, queda en el Kardex
// un medicamento que no existe — o peor, uno que existe y no es el que dijo.
//
// Acá cada nombre se compara con la lista oficial:
//   · Brasil: DCB de ANVISA (datos/medicamentos/dcb.json, 12 mil nombres).
//   · Bolivia: LINAME 2022-2024 (datos/medicamentos/liname.json).
// y con lo que ESE médico ya recetó y confirmó antes.
//
// Resultado por medicamento:
//   · "ok"          → está en la lista o en su historial.
//   · "parecido"    → no está, pero se parece mucho a uno que sí:
//                     «¿Quisiste decir espironolactona?».
//   · "desconocido" → no se parece a nada. Puede ser una marca comercial
//                     (las listas son de principios activos): se pide
//                     verificar, sin alarma.
//
// ═══ NUNCA SE CORRIGE SOLO ═════════════════════════════════════════════════
//
// Cambiar un nombre de medicamento sin que el médico lo vea es peligroso:
// dos fármacos pueden diferir en una letra. Esto solo MARCA y SUGIERE. El que
// decide es el médico, tocando la sugerencia o escribiendo el nombre.
const path = require("path");
const fs = require("fs");

const DIR = path.join(__dirname, "..", "datos", "medicamentos");

// Sin tildes, minúsculas, sin signos.
function plano(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9+ -]/g, " ").replace(/\s+/g, " ").trim();
}

// Lo que acompaña al nombre y no es el nombre: dosis, forma, sales.
const RUIDO = new Set([
  // formas y vías
  "comprimido", "comprimidos", "capsula", "capsulas", "inyectable", "injetavel", "suspension", "suspensao",
  "solucion", "solucao", "jarabe", "xarope", "gotas", "crema", "creme", "pomada", "gel", "ampolla", "ampola",
  "sobre", "sachê", "sache", "tableta", "tabletas", "ranurado", "oral", "topico", "topica", "sublingual",
  "parenteral", "via", "ev", "iv", "im", "vo", "sc", "retard", "xr", "sr", "lp",
  // unidades
  "mg", "g", "mcg", "ug", "ml", "ui", "unidades", "gotas", "dia", "dias", "vez", "vezes", "veces",
  // sales y conectores
  "de", "do", "da", "del", "acetato", "maleato", "clorhidrato", "cloridrato", "sulfato", "sodico", "sodica",
  "potasico", "potasica", "potassico", "potassica", "potassio", "sodio", "succinato", "tartarato", "tartrato", "fosfato", "besilato",
  "citrato", "valerato", "fumarato", "mesilato", "bromidrato", "bromhidrato", "hemi-hidratado", "hidratado",
  "monoidratado", "di-hidratado", "calcico", "calcio", "magnesico", "dipropionato", "propionato", "furoato",
  "cipionato", "enantato", "undecilato", "decanoato", "hiclato", "monoidrato",
  // cómo se toma: «losartán 50 mg cada 12 horas», «c/8h», «1 comp. em jejum»
  "cada", "c", "h", "hs", "hora", "horas", "por", "al", "a", "en", "em", "ao", "as", "os", "la", "las", "los",
  "noche", "noite", "manana", "manha", "tarde", "semana", "semanal", "semanas", "mes", "meses", "diario",
  "diaria", "diarios", "ayunas", "jejum", "antes", "despues", "depois", "comida", "comidas", "refeicao",
  "refeicoes", "tomar", "comp", "cp", "cps", "tab", "caps", "dosis", "dose", "se", "necesario", "necessario",
  "sos", "prn", "durante", "si", "caso", "dor", "dolor", "fiebre", "febre",
]);

// "Losartana potássica 50 mg" → "losartana" · "Acetato de ciproterona" → "ciproterona"
function nombreBase(nombre) {
  return plano(nombre).split(/\s+/)
    .filter(p => p && !RUIDO.has(p) && !/^\d/.test(p) && !/^\d+(mg|g|ml|mcg|ui)$/.test(p))
    .join(" ").trim();
}

// Las combinaciones se revisan por componente: «losartana + hidroclorotiazida».
const SEPARA_COMPONENTES = /\s*\+\s*|\s+y\s+|\s+con\s+|\s+com\s+|\s+e\s+(?=[a-záéíóú])/i;
function componentes(nombre) {
  return String(nombre || "").split(SEPARA_COMPONENTES).map(nombreBase).filter(Boolean);
}

// Lo mismo que nombreBase pero conservando tildes, para mostrarle al médico:
// "Cloridrato de sertralina" → "sertralina". De una combinación se sugiere
// solo el componente parecido, nunca la combinación entera.
function legible(texto) {
  return String(texto || "").split(/\s+/)
    .filter(p => { const q = plano(p); return q && !RUIDO.has(q) && !/^\d/.test(q); })
    .join(" ").toLowerCase().trim();
}

// ═══ ESPAÑOL Y PORTUGUÉS ESCRIBEN DISTINTO EL MISMO FÁRMACO ═══════════════
// valsartán / valsartana · sildenafil / sildenafila · ketoconazol /
// cetoconazol · tamsulosina / tansulosina · deflazacort / deflazacorte. Sin
// esto, un médico boliviano que escribe bien «valsartán» veía «¿quisiste
// decir valsartana?». La forma canónica borra esas diferencias: k→c, ph→f,
// th→t, y→i, ms→ns, mv→nv (simvastatina / sinvastatina), h muda fuera de
// «ch» (bromhexina / bromexina), sin la vocal final de cada palabra.
function canonica(base) {
  return String(base || "").split(" ").map(p => p
    .replace(/ph/g, "f").replace(/th/g, "t").replace(/(?<!c)h/g, "").replace(/k/g, "c").replace(/y/g, "i")
    .replace(/ms/g, "ns").replace(/mv/g, "nv")
    .replace(/(?<=.{4})[aeo]$/, "")).join(" ");
}

// Una entrada de la lista con números o paréntesis («insulina (125 i)»,
// «calcio + vitamina d 400 ui») sirve para reconocer, pero no para SUGERIR:
// sugerirla sería proponerle al médico un texto que no es un nombre.
const sugerible = (original) => !!original && !/[\d()+]/.test(original);

let indice = null;
function cargar() {
  if (indice) return indice;
  indice = { porIdioma: {}, todos: new Map(), canonicas: new Set() };
  for (const [archivo, idioma] of [["dcb.json", "pt"], ["liname.json", "es"], ["comunes.json", "comunes"]]) {
    let nombres = [];
    try { nombres = JSON.parse(fs.readFileSync(path.join(DIR, archivo), "utf8")).nombres || []; } catch { /* sin lista */ }
    const mapa = new Map(); // base → nombre para mostrar (con tildes, sin sal ni dosis)
    for (const n of nombres) {
      const base = nombreBase(n);
      if (base && base.length >= 3 && !mapa.has(base)) mapa.set(base, legible(n));
      for (const trozo of String(n).split(SEPARA_COMPONENTES)) {
        const b = nombreBase(trozo);
        if (b && b.length >= 3 && !mapa.has(b)) mapa.set(b, legible(trozo));
      }
    }
    indice.porIdioma[idioma] = mapa;
    for (const [b, n] of mapa) {
      if (!indice.todos.has(b)) indice.todos.set(b, n);
      indice.canonicas.add(canonica(b));
    }
  }
  return indice;
}

// Distancia de edición (con transposición), cortando temprano.
function distancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < minFila) minFila = v;
    }
    if (minFila > tope) return tope + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

// Cuánto se permite equivocar según el largo: una letra en nombres cortos,
// hasta un cuarto del nombre en los largos. Más es otra palabra.
const topeDe = (largo) => Math.max(1, Math.min(4, Math.floor(largo / 4)));

function masParecido(base, candidatos) {
  const tope = topeDe(base.length);
  let mejor = null;
  // Una palabra cortada al final («espironolac») es típica de la
  // transcripción. Desde 6 letras, si es el principio de un nombre conocido,
  // ese es el candidato (el más corto, que es el más probable).
  const cBase = canonica(base);
  if (base.length >= 6) {
    let prefijo = null;
    for (const [b, original] of candidatos) {
      if (!sugerible(original)) continue;
      if (b !== base && b.startsWith(base) && (!prefijo || b.length < prefijo.b.length)) prefijo = { b, original };
    }
    if (prefijo) return { d: 1, original: prefijo.original };
  }
  for (const [b, original] of candidatos) {
    if (!sugerible(original) || Math.abs(b.length - base.length) > tope) continue;
    // El transcriptor se equivoca en el medio o al final, casi nunca en el
    // arranque. Sin esto, «Rivotril» (una marca de clonazepam) sugería
    // «pivopril», que es otro fármaco.
    if (canonica(b).slice(0, 2) !== cBase.slice(0, 2)) continue;
    const d = distancia(cBase, canonica(b), tope);
    if (d <= tope && (!mejor || d < mejor.d || (d === mejor.d && b.length === base.length))) mejor = { d, original };
    if (mejor && mejor.d === 1 && b.length === base.length) break;
  }
  return mejor;
}

// propios: nombres que este médico ya recetó y confirmó (su historial).
// Cuentan como conocidos, y se prefieren al sugerir: lo más probable es que
// haya dicho algo que receta seguido.
function verificarMedicamento(nombre, { idioma = "es", propios = [] } = {}) {
  const { porIdioma, todos } = cargar();
  const partes = componentes(nombre);
  if (!partes.length) return { estado: "desconocido", sugerencia: null };
  // Del historial se sugiere el nombre sin la dosis: «Espironolactona», no
  // «Espironolactona 100 mg» (la dosis de hoy puede ser otra).
  const sinDosis = (n) => String(n).replace(/\s*\d.*$/, "").trim() || String(n).trim();
  const mapaPropios = new Map(propios.map(p => [nombreBase(p), sinDosis(p)]).filter(([b]) => b));
  const suyo = porIdioma[idioma] || porIdioma.es || new Map();

  let peor = { estado: "ok", sugerencia: null };
  for (const base of partes) {
    if (/^(insulina|vitamina|complejo|complexo)\b/.test(base)) continue;
    if (mapaPropios.has(base) || todos.has(base) || cargar().canonicas.has(canonica(base))) continue;
    if ([...mapaPropios.keys()].some(p => canonica(p) === canonica(base))) continue;
    // Primero su historial, después la lista de su país, y la del otro país
    // solo si el parecido es de una letra (evita sugerir rarezas).
    const candidato = masParecido(base, mapaPropios) || masParecido(base, suyo)
      || (() => { const m = masParecido(base, todos); return m && m.d === 1 ? m : null; })();
    if (candidato) {
      peor = { estado: "parecido", sugerencia: candidato.original, dijo: base };
    } else if (peor.estado === "ok") {
      peor = { estado: "desconocido", sugerencia: null, dijo: base };
    }
  }
  return peor;
}

module.exports = { verificarMedicamento, nombreBase, componentes, legible, plano, canonica, cargar };
