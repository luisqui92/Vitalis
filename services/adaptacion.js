// Symphomed — La IA que se amolda a cada profesional: sus palabras y su forma
// de escribir.
//
// ═══ DE DÓNDE APRENDE ══════════════════════════════════════════════════════
//
// De lo que ya se guarda, sin pedirle nada de más a la IA:
//   · lo que corrigió en la nota antes de confirmar: CorreccionIA tipo "nota",
//     con lo que escribió la IA y lo que él dejó, campo por campo
//     (routes/consultaMedica.js, confirmar);
//   · sus notas confirmadas.
// Lo que escribió la IA y lo que quedó se comparan palabra por palabra.
//
// Todo es POR PROFESIONAL: lo que corrige uno no le cambia nada a otro.
//
// ═══ SUS PALABRAS ══════════════════════════════════════════════════════════
//
// Una palabra cambiada por otra que se le parece («jolter» → «Holter»,
// «eco grafía» → «ecografía») es algo que el transcriptor oyó mal o que él
// escribe distinto: eso se aprende. Una palabra cambiada por otra distinta es
// un cambio de idea, y no. Tampoco lo que se parece pero cambia el sentido:
//   · los números (dosis, días, valores): son datos de ese paciente;
//   · negación, lado, intensidad, resultado («sin», «derecho», «leve»,
//     «negativo»…);
//   · los prefijos opuestos: «hipertiroidismo» y «hipotiroidismo» se parecen
//     en todo menos en lo que importa;
//   · el género y el número («derecho» → «derecha»): es la concordancia de
//     esa frase, no vocabulario;
//   · los medicamentos: tienen su propio camino, con la lista oficial
//     (services/vocabularioMedico.js), y nunca se cambian solos;
//   · una palabra que él dejó escrita en otra nota confirmada, o que es un
//     término clínico de la lista general: es una palabra de verdad, no un
//     error del transcriptor;
//   · el nombre del paciente: nunca sale de su consulta.
//
// A la primera corrección, la palabra correcta va al vocabulario del
// transcriptor, que la escucha mejor. Si la corrige en una segunda consulta,
// la IA de la nota ya la escribe bien aunque el transcriptor se equivoque.
//
// Y sus términos de siempre: los diagnósticos y estudios que confirmó en
// consultas de al menos dos pacientes (de uno solo, podría ser un dato de ese
// paciente).
//
// ═══ SU FORMA DE ESCRIBIR («así escribo yo») ═══════════════════════════════
//
//   · el largo: si deja las notas más cortas o más largas que la IA;
//   · el plan en viñetas o en texto corrido;
//   · sus abreviaturas («hipertensión arterial» → «HTA»), o las que desarma;
//   · cómo no empieza las frases: el «Paciente refiere» que siempre borra.
// Es solo forma: cambia cómo se escribe lo que se dijo, nunca qué se escribe.
// Una abreviatura o una frase se aprende recién en la segunda consulta: una
// sola vez puede ser casualidad.
//
// ═══ LO QUE ÉL DECIDE ══════════════════════════════════════════════════════
//
// En Configuración ve todo lo aprendido y lo cambia (routes/adaptacion.js):
// saca lo que no quiere, agrega palabras, abreviaturas o frases, elige el
// largo y las viñetas, o vuelve a empezar: lo aprendido antes de esa fecha no
// cuenta más.
//
// Lo aprendido no se guarda: se rehace de lo guardado (con 10 minutos de
// memoria), así nunca queda viejo. Lo que se guarda es solo lo que él decidió
// (Adaptacion, en db/models.js).
const { Adaptacion, CorreccionIA, ConsultaMedica, Medico } = require("../db/models");
const { verificarMedicamento } = require("./medicamentosOficiales");
const { correccionesDelMedico, olvidar: olvidarVocabulario, claveDe } = require("./vocabularioMedico");
const { perfil: perfilIdioma, idiomaSoportado } = require("./idiomas");
const { log } = require("../config");

// Hasta dónde se mira para atrás: suficiente para conocer sus costumbres sin
// recorrer años de historia.
const ULTIMAS_CORRECCIONES = 400;
const ULTIMAS_CONSULTAS = 300;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // medicoPhone → { hasta, perfil }

// Lo que él puede agregar a mano, y hasta cuánto.
const TOPES = { terminos: 50, abreviaturas: 30, frases: 20, quitados: 500, texto: 60, corto: 12 };

// Lo que llega a la IA de la nota y al transcriptor.
const MAX_VOCABULARIO = 40;
const MAX_CORRECCIONES_NOTA = 30;

// Los campos de la nota que se comparan. Los medicamentos no: tienen su propio
// camino. La reconsulta y los mapas tampoco: no son texto que él escriba.
const CAMPOS = ["motivoConsulta", "sintomas", "antecedentesRelevantes", "diagnostico", "diagnosticosDiferenciales", "plan",
  "examenesSolicitados", "proximoControl",
  "valoracion", "diagnosticosEnfermeria", "objetivos", "intervenciones", "evaluacion", "educacion"];

// Sin tildes y en minúsculas: «Glucemia» y «glucemia» son la misma palabra.
// (claveDe, además, sin signos: viene de services/vocabularioMedico.js.)
const plana = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const contarPalabras = (t) => (String(t || "").match(/[\p{L}\p{N}]+/gu) || []).length;

// Lo que se compara de cada campo, como texto. La nota de enfermería guarda
// listas y objetos (en CorreccionIA, como JSON): de ahí, solo los textos.
function textoDe(v) {
  if (v == null) return "";
  if (typeof v === "string") {
    const s = v.trim();
    if (/^[[{]/.test(s)) { try { return textoDe(JSON.parse(s)); } catch { /* era texto */ } }
    return s;
  }
  if (Array.isArray(v)) return v.map(textoDe).filter(Boolean).join(". ");
  if (typeof v === "object") return Object.values(v).map(textoDe).filter(Boolean).join(". ");
  return typeof v === "number" ? String(v) : "";
}

// ═══ PALABRA POR PALABRA ═══════════════════════════════════════════════════

// Palabras (con lo que las une por dentro: «c/8», «p.ej», «DM-2») y signos
// sueltos. El salto de línea cuenta como signo: ahí empieza otra frase.
const RE_TOKEN = /\n|[\p{L}\p{N}]+(?:[/.\-'’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
const FIN_DE_FRASE = new Set([".", ";", ":", "!", "?", "\n"]);
const VINETA = new Set(["-", "•", "*", "·"]);

function tokens(texto) {
  return (String(texto || "").slice(0, 8000).match(RE_TOKEN) || [])
    .map(t => ({ t, n: plana(t), palabra: /[\p{L}\p{N}]/u.test(t) }));
}

function inicioDeFrase(a, i) {
  if (i === 0) return true;
  const antes = a[i - 1].t;
  if (FIN_DE_FRASE.has(antes)) return true;
  return VINETA.has(antes) && (i === 1 || a[i - 2].t === "\n");
}

// Lo que cambió entre lo que escribió la IA (a) y lo que quedó (b): la
// subsecuencia común más larga, y entre medio los tramos con lo que se borró
// y lo que se escribió en su lugar. Un texto muy largo no se compara: si lo
// reescribió entero, de ahí no sale una palabra suya.
const MAX_TOKENS = 400;
function tramosCambiados(a, b) {
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return [];
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].n === b[j].n ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const tramos = [];
  let i = 0, j = 0, actual = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].n === b[j].n) {
      if (actual) { actual.sigueIgual = true; tramos.push(actual); actual = null; }
      i++; j++;
      continue;
    }
    if (!actual) actual = { antes: [], despues: [], inicioFrase: inicioDeFrase(a, i), sigueIgual: false };
    if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) actual.despues.push(b[j++]);
    else actual.antes.push(a[i++]);
  }
  if (actual) tramos.push(actual);
  return tramos;
}

// ═══ LO QUE CAMBIA EL SENTIDO ══════════════════════════════════════════════

const CAMBIAN_EL_SENTIDO = new Set([
  // negación y presencia
  "no", "sin", "niega", "nego", "nega", "nao", "sem", "ni", "nem", "nunca", "nada", "ningun", "ninguno", "ninguna",
  "nenhum", "nenhuma", "con", "com", "si", "sim", "presente", "presentes", "ausente", "ausentes",
  // lado y lugar
  "derecho", "derecha", "derechos", "derechas", "izquierdo", "izquierda", "izquierdos", "izquierdas", "direito", "direita",
  "direitos", "direitas", "esquerdo", "esquerda", "esquerdos", "esquerdas", "bilateral", "unilateral", "ambos", "ambas",
  "anterior", "posterior", "superior", "inferior", "interno", "interna", "externo", "externa", "proximal", "distal",
  "medial", "lateral",
  // intensidad, resultado y tiempo
  "leve", "leves", "moderado", "moderada", "severo", "severa", "grave", "graves", "intenso", "intensa", "discreto",
  "discreta", "marcado", "marcada", "positivo", "positiva", "negativo", "negativa", "normal", "normales", "normais",
  "anormal", "alterado", "alterada", "conservado", "conservada", "preservado", "preservada", "aumentado", "aumentada",
  "disminuido", "disminuida", "diminuido", "diminuida", "elevado", "elevada", "bajo", "baja", "alto", "alta", "baixo",
  "baixa", "mayor", "menor", "maior", "mas", "menos", "mais", "poco", "poca", "mucho", "mucha", "muito", "muita", "pouco",
  "pouca", "agudo", "aguda", "cronico", "cronica", "reciente", "antiguo", "antigua", "previo", "previa", "actual",
]);

// Prefijos que dicen lo contrario: cambiar uno por otro no es corregir una
// palabra, es cambiar el diagnóstico.
const OPUESTOS = [["hiper", "hipo"], ["hiper", "normo"], ["hipo", "normo"], ["taqui", "bradi"], ["taqui", "normo"],
  ["bradi", "normo"], ["pre", "post"], ["pre", "pos"], ["ante", "post"], ["intra", "extra"], ["sub", "supra"],
  ["endo", "exo"], ["macro", "micro"], ["poli", "oligo"], ["inspir", "espir"], ["in", "ex"]];
// Y los que niegan: típico/atípico, estable/inestable, hidratado/deshidratado.
const NIEGAN = ["a", "an", "in", "im", "i", "des", "dis", "anti", "contra"];
const PREFIJOS_DE_SENTIDO = [...new Set(OPUESTOS.flat())].filter(p => p.length >= 3);

function cambiaElSentido(x, y) {
  for (const [p, q] of OPUESTOS) {
    for (const [de, a] of [[p, q], [q, p]]) {
      for (let k = x.indexOf(de); k >= 0; k = x.indexOf(de, k + 1)) {
        if (x.slice(0, k) + a + x.slice(k + de.length) === y) return true;
      }
    }
  }
  return NIEGAN.some(pre => x === pre + y || y === pre + x);
}

// «derecho» → «derecha», «dolores» → «dolor»: concordancia, no vocabulario.
const raiz = (p) => p.replace(/(es|os|as|s|o|a|e)$/, "");

function distancia(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Se parece lo bastante como para ser la misma palabra mal oída o mal escrita.
function parecidas(x, y) {
  const largo = Math.max(x.length, y.length);
  return largo >= 4 && 1 - distancia(x, y) / largo >= 0.6;
}

// Lo que escribió él es un medicamento, o se le parece. De lo que escribió la
// IA basta con que no sea uno de verdad: «glicemia» se parece a «glicerina»
// sin ser un fármaco.
//
// Revisar contra la lista oficial es lo caro de todo esto (compara con miles
// de nombres), y las mismas palabras se repiten en cientos de notas. La lista
// no cambia mientras el servidor corre: lo revisado se recuerda.
const revisados = new Map(); // "idioma|texto" → estado
function estadoMedicamento(texto, idioma) {
  const k = `${idioma}|${plana(texto)}`;
  let estado = revisados.get(k);
  if (estado === undefined) {
    if (revisados.size >= 20000) revisados.clear();
    estado = verificarMedicamento(texto, { idioma }).estado;
    revisados.set(k, estado);
  }
  return estado;
}
const esMedicamento = (texto, idioma) => ["ok", "parecido"].includes(estadoMedicamento(texto, idioma));
const esMedicamentoDeVerdad = (texto, idioma) => estadoMedicamento(texto, idioma) === "ok";

// Los términos clínicos de la lista general de su idioma: si la IA escribió
// uno de estos, escribió una palabra de verdad.
const conocidos = new Map();
function terminosConocidos(idioma) {
  if (!conocidos.has(idioma)) {
    const v = perfilIdioma(idioma).transcripcion;
    const todos = [...v.generales, ...v.farmacos, ...Object.values(v.porEspecialidad).flat()];
    conocidos.set(idioma, new Set(todos.map(claveDe)));
  }
  return conocidos.get(idioma);
}

// ═══ LAS ABREVIATURAS ══════════════════════════════════════════════════════
//
// Las comunes, con lo que quieren decir. Una de estas se aprende solo si el
// texto que reemplaza dice eso: «HTA» en lugar de «hipotensión arterial» no
// es una abreviatura, es otro diagnóstico. «N» es un número (el mismo en los
// dos lados).
const ABREVIATURAS_CONOCIDAS = {
  hta: ["hipertension arterial", "hipertension", "hipertensao arterial", "hipertensao"],
  has: ["hipertensao arterial sistemica", "hipertension arterial sistemica"],
  dm: ["diabetes mellitus", "diabetes"],
  dmn: ["diabetes mellitus tipo n", "diabetes tipo n", "diabetes mellitus n"],
  ivu: ["infeccion de vias urinarias", "infeccion de las vias urinarias"],
  itu: ["infeccion del tracto urinario", "infeccion urinaria", "infeccao do trato urinario", "infeccao urinaria"],
  ira: ["infeccion respiratoria aguda", "insuficiencia renal aguda"],
  eda: ["enfermedad diarreica aguda"],
  irc: ["insuficiencia renal cronica"],
  erc: ["enfermedad renal cronica"],
  icc: ["insuficiencia cardiaca congestiva"],
  ic: ["insuficiencia cardiaca", "insuficiencia cardiaca congestiva"],
  epoc: ["enfermedad pulmonar obstructiva cronica"],
  dpoc: ["doenca pulmonar obstrutiva cronica"],
  acv: ["accidente cerebrovascular", "accidente cerebro vascular"],
  avc: ["acidente vascular cerebral"],
  iam: ["infarto agudo de miocardio", "infarto agudo del miocardio", "infarto agudo do miocardio"],
  tep: ["tromboembolismo pulmonar"],
  tvp: ["trombosis venosa profunda", "trombose venosa profunda"],
  fa: ["fibrilacion auricular", "fibrilacao atrial"],
  erge: ["enfermedad por reflujo gastroesofagico"],
  drge: ["doenca do refluxo gastroesofagico"],
  vo: ["via oral"],
  ev: ["endovenoso", "endovenosa", "via endovenosa"],
  iv: ["intravenoso", "intravenosa", "via intravenosa"],
  im: ["intramuscular", "via intramuscular"],
  sc: ["subcutaneo", "subcutanea", "via subcutanea"],
  sl: ["sublingual", "via sublingual"],
  mid: ["miembro inferior derecho", "membro inferior direito"],
  mii: ["miembro inferior izquierdo"],
  msd: ["miembro superior derecho", "membro superior direito"],
  msi: ["miembro superior izquierdo"],
  mie: ["membro inferior esquerdo"],
  mse: ["membro superior esquerdo"],
  od: ["ojo derecho", "olho direito"],
  oi: ["ojo izquierdo"],
  oe: ["olho esquerdo"],
  ecg: ["electrocardiograma", "eletrocardiograma"],
  eeg: ["electroencefalograma", "eletroencefalograma"],
  rx: ["radiografia", "rayos x", "raio x"],
  tac: ["tomografia axial computarizada", "tomografia"],
  tc: ["tomografia computada", "tomografia computadorizada", "tomografia"],
  rm: ["resonancia magnetica", "ressonancia magnetica"],
  rmn: ["resonancia magnetica nuclear", "resonancia magnetica"],
  pa: ["presion arterial", "pressao arterial"],
  fc: ["frecuencia cardiaca", "frequencia cardiaca"],
  fr: ["frecuencia respiratoria", "frequencia respiratoria"],
  hb: ["hemoglobina"], hto: ["hematocrito"], ht: ["hematocrito"], gb: ["globulos blancos"], plt: ["plaquetas"],
  pcr: ["proteina c reactiva"], vsg: ["velocidad de sedimentacion globular"], vhs: ["velocidade de hemossedimentacao"],
  ego: ["examen general de orina"], eas: ["elementos anormais do sedimento"], eco: ["ecografia"], usg: ["ultrassonografia"],
  electro: ["electrocardiograma", "eletrocardiograma"],
  "c/n h": ["cada n horas"], "c/nh": ["cada n horas"], "c/n hs": ["cada n horas"], "c/nhs": ["cada n horas"],
};
// Lo que no cuenta para las iniciales: «HTA» no lleva la «d» de «de».
const SIN_INICIAL = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "por", "con", "a", "al", "do", "da", "dos", "das", "o", "tipo"]);

// ¿«corto» abrevia a «largo»? Sus letras van en orden dentro de «largo», y
// están las iniciales de cada palabra («IVU» = Infección de Vías Urinarias;
// «MII» no abrevia «miembro inferior derecho»: le falta la d). Si «corto» es
// una de las conocidas, tiene que decir lo que dice.
function esAbreviatura(corto, largo) {
  // «sin» no abrevia «sintomático»: es otra palabra, y dice lo contrario.
  if (claveDe(corto).split(" ").some(p => CAMBIAN_EL_SENTIDO.has(p))) return false;
  const c = plana(corto).replace(/[^\p{L}\p{N}]/gu, "");
  const palabras = claveDe(largo).split(" ").filter(Boolean);
  const l = palabras.join("");
  if (c.length < 2 || c.length > 8 || l.length < 4 || c.length > l.length * 0.6 || c[0] !== l[0]) return false;
  const enOrden = (sub, s) => { let k = 0; for (const ch of s) if (ch === sub[k]) k++; return k >= sub.length; };
  if (!enOrden(c, l)) return false;
  const iniciales = palabras.filter(p => !SIN_INICIAL.has(p)).map(p => p[0]).join("");
  if (!enOrden(iniciales, c)) return false;
  const conocida = ABREVIATURAS_CONOCIDAS[claveDe(corto)] || ABREVIATURAS_CONOCIDAS[c];
  if (conocida) return conocida.includes(palabras.join(" "));
  // Una que no conocemos, sobre algo que lleva lado, intensidad o un prefijo
  // opuesto: no hay cómo saber si dice lo mismo.
  if (palabras.some(p => CAMBIAN_EL_SENTIDO.has(p) || PREFIJOS_DE_SENTIDO.some(pre => p.startsWith(pre) && p.length > pre.length + 2))) return false;
  const mayusculas = (String(corto).match(/\p{Lu}/gu) || []).length;
  // Una sigla (HTA) o algo con barra o punto (c/8 h, abd.). Una palabra
  // cortada sin punto («con» de «control») puede ser otra palabra: solo las
  // conocidas (eco, electro).
  return mayusculas >= 2 || /[/.]/.test(corto);
}

// Los números de un texto: «cada 8 horas» → forma «cada N horas», números «8».
const NUMEROS = /\d+(?:[.,]\d+)?/g;
const plantilla = (texto) => ({ forma: texto.replace(NUMEROS, "N"), numeros: (texto.match(NUMEROS) || []).join("|") });

function abreviaturaEntre(antes, despues) {
  if (esAbreviatura(despues, antes)) return { tipo: "abreviatura", corto: despues, largo: antes, usa: "corto" };
  if (esAbreviatura(antes, despues)) return { tipo: "abreviatura", corto: antes, largo: despues, usa: "largo" };
  return null;
}

// ═══ UN TRAMO CAMBIADO → LO QUE SE APRENDE ═════════════════════════════════

const unir = (ts) => ts.map(t => t.t).join(" ").replace(/\s+([,.;:])/g, "$1").trim();

// Lo que se aprende de un tramo: [{ tipo: "par" | "abreviatura" | "frase", … }].
// contexto: { nombre: Set con las palabras del nombre del paciente, idioma }.
function queSeAprende(tramo, contexto) {
  const directo = aprenderDe(tramo, contexto);
  if (directo) return [directo];
  // «Paciente refiere hipertensión arterial» → «HTA»: borró el principio de la
  // frase y abrevió el resto. Se prueba cortando el principio.
  const X = tramo.antes.filter(t => t.palabra);
  if (!tramo.inicioFrase || !tramo.despues.some(t => t.palabra)) return [];
  for (let k = 1; k <= Math.min(5, X.length - 1); k++) {
    const frase = aprenderDe({ antes: X.slice(0, k), despues: [], inicioFrase: true, sigueIgual: true }, contexto);
    const resto = aprenderDe({ ...tramo, antes: X.slice(k), inicioFrase: false }, contexto);
    if (frase && resto) return [frase, resto];
  }
  return [];
}

function aprenderDe(tramo, contexto) {
  const X = tramo.antes.filter(t => t.palabra);
  const Y = tramo.despues.filter(t => t.palabra);
  if (!X.length) return null;
  // El nombre del paciente no sale de su consulta: ni al transcriptor ni a la IA.
  if ([...X, ...Y].some(w => contexto.nombre.has(w.n))) return null;
  const antes = unir(X);

  // Lo que borró al principio de una frase y dejó el resto: «Paciente refiere
  // dolor…» → «Dolor…».
  if (!Y.length) {
    if (!tramo.inicioFrase || !tramo.sigueIgual || X.length > 5) return null;
    if (/\d/.test(antes) || X.some(w => CAMBIAN_EL_SENTIDO.has(w.n))) return null;
    return { tipo: "frase", frase: antes };
  }
  const despues = unir(Y);

  // Con números: solo una abreviatura con los mismos números («cada 8 horas»
  // → «c/8 h»). Un número cambiado es un dato cambiado.
  const pa = plantilla(antes), pd = plantilla(despues);
  if (pa.numeros || pd.numeros) {
    if (pa.numeros !== pd.numeros || X.length > 4 || Y.length > 3) return null;
    return abreviaturaEntre(pa.forma, pd.forma);
  }
  if (X.length > 4 || Y.length > 4) return null;
  const abreviatura = abreviaturaEntre(antes, despues);
  if (abreviatura) return abreviatura;

  if (X.length > 3) return null;
  const x = X.map(w => w.n).join(""), y = Y.map(w => w.n).join("");
  if ([...X, ...Y].some(w => CAMBIAN_EL_SENTIDO.has(w.n))) return null;
  if (cambiaElSentido(x, y)) return null;
  if (X.length === Y.length && X.every((w, i) => raiz(w.n) === raiz(Y[i].n))) return null;
  if (!parecidas(x, y)) return null;
  if (esMedicamentoDeVerdad(antes, contexto.idioma) || esMedicamento(despues, contexto.idioma)) return null;
  if (terminosConocidos(contexto.idioma).has(claveDe(antes))) return null;
  // «Karla» → «Carla»: puede ser el nombre de alguien de la familia. Se
  // aprende recién si lo corrigió con dos pacientes distintos.
  const nombrePropio = [X, Y].every(ws => ws.every(w => /^\p{Lu}\p{Ll}+$/u.test(w.t)));
  return { tipo: "par", dijo: antes, correcto: despues, nombrePropio };
}

const palabrasDelNombre = (nombre) => new Set(claveDe(nombre).split(" ").filter(p => p.length >= 3));

// Un término de su lista: un diagnóstico o un estudio, corto y sin números.
function termino(item) {
  const t = String(item || "").replace(/^[\s\-•*·]+/, "").replace(/[\s.;:,]+$/, "").replace(/\s+/g, " ").trim();
  const n = contarPalabras(t);
  if (!t || /\d/.test(t) || n < 1 || n > 5 || t.length < 4 || t.length > TOPES.texto) return null;
  return t;
}

const esLista = (t) => String(t || "").split("\n").filter(l => /^\s*([-•*·]|\d+[.)])\s+\S/.test(l)).length >= 2;
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

// ═══ TODO LO APRENDIDO ═════════════════════════════════════════════════════
//
// Puro (sin base): de las correcciones y las notas confirmadas, lo que se
// aprendió. Las pruebas lo llaman directo.
//   correcciones: CorreccionIA tipo "nota" desde «desde», de la más nueva a la
//     más vieja;
//   confirmadas: sus consultas confirmadas (las más nuevas primero), con
//     notaClinica, pacienteId y pacienteNombre;
//   desde: «volver a empezar» (o null).
function analizar({ correcciones = [], confirmadas = [], desde = null, idioma = "es" }) {
  const lang = idiomaSoportado(idioma);
  const nuevas = confirmadas.filter(c => !desde || new Date(c.confirmadaEn) >= new Date(desde));
  const porId = new Map(confirmadas.map(c => [String(c._id), c]));

  // Lo que él dejó escrito en cualquiera de sus notas: sus palabras.
  const suyo = " " + confirmadas.map(c => CAMPOS.map(campo => claveDe(textoDe(c.notaClinica?.[campo]))).join(" ")).join(" ") + " ";
  const esSuya = (t) => suyo.includes(" " + claveDe(t) + " ");

  const pares = new Map(), abreviaturas = new Map(), frases = new Map();
  // De la más nueva a la más vieja: si corrigió lo mismo dos veces distinto,
  // vale la última.
  const anotar = (mapa, clave, valor, consulta, igual) => {
    let ya = mapa.get(clave);
    if (!ya) mapa.set(clave, ya = { ...valor, consultas: new Set(), pacientes: new Set() });
    else if (!igual(ya)) return;
    ya.consultas.add(String(consulta._id));
    ya.pacientes.add(String(consulta.pacienteId));
  };
  for (const c of correcciones) {
    if (!CAMPOS.includes(c.campo)) continue;
    const consulta = porId.get(String(c.consultaId));
    if (!consulta) continue;
    const contexto = { nombre: palabrasDelNombre(consulta.pacienteNombre), idioma: lang };
    for (const tramo of tramosCambiados(tokens(textoDe(c.valorSugerido)), tokens(textoDe(c.valorFinal)))) for (const a of queSeAprende(tramo, contexto)) {
      if (a.tipo === "par") anotar(pares, claveDe(a.dijo), a, consulta, ya => claveDe(ya.correcto) === claveDe(a.correcto));
      else if (a.tipo === "abreviatura") anotar(abreviaturas, claveDe(a.largo), a, consulta, ya => ya.usa === a.usa && claveDe(ya.corto) === claveDe(a.corto));
      else anotar(frases, claveDe(a.frase), a, consulta, () => true);
    }
  }
  const veces = ({ consultas, pacientes, ...x }) => ({ ...x, veces: consultas.size, pacientes: pacientes.size });
  // Un nombre propio, recién con dos pacientes (queSeAprende).
  const listaPares = [...pares.values()].filter(p => !esSuya(p.dijo)).map(veces).filter(p => !p.nombrePropio || p.pacientes >= 2);

  // Sus términos de siempre: en notas de al menos dos pacientes.
  const terminos = new Map();
  for (const c of nuevas) {
    const n = c.notaClinica || {};
    const nombre = palabrasDelNombre(c.pacienteNombre);
    const items = [
      ...(Array.isArray(n.examenesSolicitados) ? n.examenesSolicitados : []),
      ...(Array.isArray(n.diagnosticosDiferenciales) ? n.diagnosticosDiferenciales : []),
      ...String(n.diagnostico || "").split(/[;\n]|,(?![^()]*\))/),
      ...(Array.isArray(n.diagnosticosEnfermeria) ? n.diagnosticosEnfermeria.map(d => d?.problema) : []),
    ];
    for (const item of items) {
      const t = termino(item);
      if (!t || claveDe(t).split(" ").some(p => nombre.has(p))) continue;
      const k = claveDe(t);
      const g = terminos.get(k) || { formas: new Map(), pacientes: new Set() };
      g.formas.set(t, (g.formas.get(t) || 0) + 1);
      g.pacientes.add(String(c.pacienteId));
      terminos.set(k, g);
    }
  }
  // Un medicamento no: va por su camino. Se revisa al final, solo lo que quedó
  // y solo los más usados (al transcriptor y a la IA llegan bastantes menos).
  const listaTerminos = [...terminos.values()].filter(g => g.pacientes.size >= 2)
    .sort((a, b) => b.pacientes.size - a.pacientes.size).slice(0, 80)
    .map(g => ({ termino: [...g.formas].sort((a, b) => b[1] - a[1])[0][0], pacientes: g.pacientes.size }))
    .filter(x => !esMedicamento(x.termino, lang));

  // El largo: por nota confirmada, cuántas palabras dejó él contra cuántas
  // había escrito la IA. Lo que no corrigió quedó como lo escribió la IA.
  const sugerido = new Map();
  for (const c of correcciones) {
    const k = `${c.consultaId}|${c.campo}`;
    if (!sugerido.has(k)) sugerido.set(k, c.valorSugerido);
  }
  const proporciones = [];
  for (const c of nuevas.slice(0, 60)) {
    let ia = 0, el = 0;
    for (const campo of CAMPOS) {
      const final = textoDe(c.notaClinica?.[campo]);
      const k = `${c._id}|${campo}`;
      ia += contarPalabras(sugerido.has(k) ? textoDe(sugerido.get(k)) : final);
      el += contarPalabras(final);
    }
    if (ia >= 20) proporciones.push(el / ia);
  }
  let largo = "";
  if (proporciones.length >= 5) {
    const m = mediana(proporciones);
    largo = m < 0.75 ? "breve" : m > 1.35 ? "detallado" : "normal";
  }

  // El plan: en viñetas si así deja la mayoría; en texto corrido si desarmó
  // en dos consultas las viñetas que había puesto la IA.
  const planes = nuevas.map(c => c.notaClinica?.plan).filter(p => typeof p === "string" && p.trim().length >= 20).slice(0, 20);
  const enLista = planes.filter(esLista).length;
  let vinetas = "";
  if (enLista >= 3 && enLista / planes.length >= 0.6) vinetas = "si";
  else if (new Set(correcciones.filter(c => c.campo === "plan" && esLista(c.valorSugerido) && !esLista(c.valorFinal))
    .map(c => String(c.consultaId))).size >= 2) vinetas = "no";

  return {
    notas: nuevas.length,
    pares: listaPares,
    terminos: listaTerminos,
    abreviaturas: [...abreviaturas.values()].map(veces).filter(a => a.veces >= 2),
    // Una frase borrada podría ser de ese paciente: con dos pacientes, es suya.
    frases: [...frases.values()].map(veces).filter(f => f.pacientes >= 2),
    largo, vinetas,
  };
}

// ═══ LO APRENDIDO + LO QUE DECIDIÓ ÉL ══════════════════════════════════════

async function calcular(medicoPhone) {
  const [ajustes, medico] = await Promise.all([
    Adaptacion.findOne({ medicoPhone }).lean(),
    Medico.findOne({ phone: medicoPhone }).select("idioma").lean(),
  ]);
  const desde = ajustes?.desde || null;
  const campos = ["pacienteId", "pacienteNombre", "confirmadaEn", ...CAMPOS.map(c => `notaClinica.${c}`)].join(" ");
  const [correcciones, confirmadas] = await Promise.all([
    CorreccionIA.find({ medicoPhone, tipo: "nota", ...(desde ? { createdAt: { $gte: desde } } : {}) })
      .sort({ createdAt: -1 }).limit(ULTIMAS_CORRECCIONES).select("consultaId campo valorSugerido valorFinal").lean(),
    ConsultaMedica.find({ medicoPhone, confirmadaEn: { $ne: null } }).sort({ confirmadaEn: -1 }).limit(ULTIMAS_CONSULTAS)
      .select(campos).lean(),
  ]);
  return { ajustes: ajustes || {}, aprendido: analizar({ correcciones, confirmadas, desde, idioma: medico?.idioma }) };
}

// Nunca tira: si la base falla, la nota y la transcripción salen como antes,
// sin lo aprendido. Perder una consulta por esto sería absurdo.
const VACIO = { ajustes: {}, aprendido: analizar({}) };
async function perfilDe(medicoPhone) {
  if (!medicoPhone) return VACIO;
  const c = cache.get(medicoPhone);
  if (c && c.hasta > Date.now()) return c.perfil;
  try {
    const perfil = await calcular(medicoPhone);
    cache.set(medicoPhone, { hasta: Date.now() + CACHE_MS, perfil });
    return perfil;
  } catch (e) {
    log.warn("[ADAPTACION] no se pudo leer lo aprendido:", e.message);
    return VACIO;
  }
}

function olvidar(medicoPhone) {
  cache.delete(medicoPhone);
  olvidarVocabulario(medicoPhone);
}

const quitado = (ajustes, clave) => (ajustes.quitados || []).includes(clave);
const sinRepetir = (xs) => { const vistos = new Set(); return xs.filter(x => { const k = claveDe(x); if (!k || vistos.has(k)) return false; vistos.add(k); return true; }); };

// Sus palabras: lo que agregó él, lo que corrigió y sus términos de siempre.
function vocabularioDe({ ajustes, aprendido }) {
  return sinRepetir([
    ...(ajustes.terminos || []),
    ...aprendido.pares.filter(p => !quitado(ajustes, `par:${claveDe(p.dijo)}`)).map(p => p.correcto),
    ...aprendido.terminos.map(t => t.termino),
  ]).filter(t => !quitado(ajustes, `termino:${claveDe(t)}`));
}

function estiloDe({ ajustes, aprendido }) {
  const abreviaturas = new Map();
  for (const a of ajustes.abreviaturas || []) abreviaturas.set(claveDe(a.largo), { ...a, usa: "corto", propia: true });
  for (const a of aprendido.abreviaturas) {
    const k = claveDe(a.largo);
    if (!abreviaturas.has(k) && !quitado(ajustes, `abrev:${k}`)) abreviaturas.set(k, a);
  }
  const frases = sinRepetir([...(ajustes.frases || []), ...aprendido.frases.map(f => f.frase)])
    .filter(f => !quitado(ajustes, `frase:${claveDe(f)}`));
  return { largo: ajustes.largo || aprendido.largo, vinetas: ajustes.vinetas || aprendido.vinetas, abreviaturas: [...abreviaturas.values()], frases };
}

// Cómo se le cuenta a la IA de la nota. Solo forma.
function instruccionesDeEstilo(estilo) {
  const r = [];
  if (estilo.largo === "breve") r.push("Escribe corto y directo: frases breves, sin relleno.");
  if (estilo.largo === "detallado") r.push("Escribe detallado: con todo lo que se dijo, en frases completas.");
  if (estilo.vinetas === "si") r.push("El plan lo escribe en viñetas: una indicación por renglón, cada una empezando con «- ».");
  if (estilo.vinetas === "no") r.push("El plan lo escribe en texto corrido, sin viñetas.");
  const usa = estilo.abreviaturas.filter(a => a.usa === "corto");
  const desarma = estilo.abreviaturas.filter(a => a.usa === "largo");
  const conN = (a) => /\bN\b/.test(a.corto) ? " (N es el número que se dijo)" : "";
  if (usa.length) r.push(`Usa estas abreviaturas: ${usa.map(a => `«${a.corto}» por «${a.largo}»${conN(a)}`).join("; ")}.`);
  if (desarma.length) r.push(`No abrevia: escribe ${desarma.map(a => `«${a.largo}» y no «${a.corto}»`).join("; ")}.`);
  if (estilo.frases.length) r.push(`No empieza las frases con ${estilo.frases.map(f => `«${f}»`).join(", ")}: va directo al dato.`);
  return r;
}

// Para el transcriptor (services/assemblyai.js → keytermsPara): sus palabras.
async function vocabularioParaTranscribir(medicoPhone) {
  return vocabularioDe(await perfilDe(medicoPhone)).slice(0, MAX_VOCABULARIO);
}

// Para la IA de la nota (services/notaClinica.js → construirContexto).
async function paraLaNota(medicoPhone) {
  const p = await perfilDe(medicoPhone);
  return {
    vocabulario: vocabularioDe(p).slice(0, MAX_VOCABULARIO),
    correcciones: p.aprendido.pares.filter(x => x.veces >= 2 && !quitado(p.ajustes, `par:${claveDe(x.dijo)}`))
      .slice(0, MAX_CORRECCIONES_NOTA).map(({ dijo, correcto }) => ({ dijo, correcto })),
    estilo: instruccionesDeEstilo(estiloDe(p)),
  };
}

// ═══ CONFIGURACIÓN (routes/adaptacion.js) ═════════════════════════════════

// Todo lo que ve en «Así escribo yo». «clave» es lo que la pantalla manda
// para sacar algo.
async function vista(medicoPhone) {
  olvidar(medicoPhone);
  const p = await perfilDe(medicoPhone);
  const { ajustes, aprendido } = p;
  const estilo = estiloDe(p);
  const propios = new Set((ajustes.terminos || []).map(claveDe));
  const corregidos = new Set(aprendido.pares.map(x => claveDe(x.correcto)));
  const medicamentos = await correccionesDelMedico(medicoPhone, 50).catch(() => []);
  return {
    notas: aprendido.notas,
    desde: ajustes.desde || null,
    largo: { elegido: ajustes.largo || "", aprendido: aprendido.largo },
    vinetas: { elegido: ajustes.vinetas || "", aprendido: aprendido.vinetas },
    abreviaturas: estilo.abreviaturas.map(a => ({ clave: `abrev:${claveDe(a.largo)}`, corto: a.corto, largo: a.largo, usa: a.usa,
      veces: a.veces || 0, propia: Boolean(a.propia) })),
    frases: estilo.frases.map(f => ({ clave: `frase:${claveDe(f)}`, frase: f,
      propia: (ajustes.frases || []).some(x => claveDe(x) === claveDe(f)) })),
    terminos: vocabularioDe(p).map(t => ({ clave: `termino:${claveDe(t)}`, termino: t,
      origen: propios.has(claveDe(t)) ? "propio" : corregidos.has(claveDe(t)) ? "corregido" : "frecuente" })),
    correcciones: [
      ...aprendido.pares.filter(x => !quitado(ajustes, `par:${claveDe(x.dijo)}`))
        .map(x => ({ clave: `par:${claveDe(x.dijo)}`, dijo: x.dijo, correcto: x.correcto, veces: x.veces, medicamento: false })),
      ...medicamentos.map(m => ({ clave: `med:${claveDe(m.dijo)}`, dijo: m.dijo, correcto: m.correcto, veces: 1, medicamento: true })),
    ],
  };
}

const errorDeDato = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
const textoValido = (t, max = TOPES.texto) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > max || !/[\p{L}\p{N}]/u.test(s)) return null;
  return s;
};

async function cambiar(medicoPhone, { largo, vinetas } = {}) {
  const set = {};
  if (largo !== undefined) {
    if (!["", "breve", "normal", "detallado"].includes(largo)) throw errorDeDato("El largo tiene que ser breve, normal o detallado");
    set.largo = largo;
  }
  if (vinetas !== undefined) {
    if (!["", "si", "no"].includes(vinetas)) throw errorDeDato("Las viñetas son sí o no");
    set.vinetas = vinetas;
  }
  if (!Object.keys(set).length) throw errorDeDato("No hay nada que cambiar");
  await Adaptacion.updateOne({ medicoPhone }, { $set: set }, { upsert: true });
  olvidar(medicoPhone);
}

async function agregar(medicoPhone, { tipo, texto, corto, largo } = {}) {
  const ajustes = (await Adaptacion.findOne({ medicoPhone }).lean()) || {};
  const set = {};
  let clave;
  if (tipo === "termino") {
    const t = textoValido(texto);
    if (!t || t.split(" ").length > 6) throw errorDeDato("Escribí una palabra o un término de hasta 6 palabras");
    if ((ajustes.terminos || []).length >= TOPES.terminos) throw errorDeDato(`Ya agregaste ${TOPES.terminos} palabras: sacá alguna primero`);
    set.terminos = sinRepetir([...(ajustes.terminos || []), t]);
    clave = `termino:${claveDe(t)}`;
  } else if (tipo === "abreviatura") {
    const c = textoValido(corto, TOPES.corto), l = textoValido(largo);
    if (!c || !l || claveDe(c) === claveDe(l)) throw errorDeDato("Escribí la abreviatura y lo que significa");
    if ((ajustes.abreviaturas || []).length >= TOPES.abreviaturas) throw errorDeDato(`Ya agregaste ${TOPES.abreviaturas} abreviaturas: sacá alguna primero`);
    set.abreviaturas = [...(ajustes.abreviaturas || []).filter(a => claveDe(a.largo) !== claveDe(l)), { corto: c, largo: l }];
    clave = `abrev:${claveDe(l)}`;
  } else if (tipo === "frase") {
    const f = textoValido(texto);
    if (!f) throw errorDeDato("Escribí la frase");
    if ((ajustes.frases || []).length >= TOPES.frases) throw errorDeDato(`Ya agregaste ${TOPES.frases} frases: sacá alguna primero`);
    set.frases = sinRepetir([...(ajustes.frases || []), f]);
    clave = `frase:${claveDe(f)}`;
  } else {
    throw errorDeDato("No sé qué agregar");
  }
  // Si lo había sacado, agregarlo de nuevo lo vuelve a poner.
  set.quitados = (ajustes.quitados || []).filter(q => q !== clave);
  await Adaptacion.updateOne({ medicoPhone }, { $set: set }, { upsert: true });
  olvidar(medicoPhone);
}

// Lo que agregó él se borra; lo aprendido queda anotado como sacado, para no
// volver a aprenderlo.
async function quitar(medicoPhone, clave) {
  const k = String(clave || "");
  const [tipo, ...resto] = k.split(":");
  const valor = resto.join(":");
  if (!["par", "termino", "abrev", "frase", "med"].includes(tipo) || !valor || k.length > 120) throw errorDeDato("No sé qué sacar");
  const ajustes = (await Adaptacion.findOne({ medicoPhone }).lean()) || {};
  const set = {
    terminos: (ajustes.terminos || []).filter(t => !(tipo === "termino" && claveDe(t) === valor)),
    abreviaturas: (ajustes.abreviaturas || []).filter(a => !(tipo === "abrev" && claveDe(a.largo) === valor)),
    frases: (ajustes.frases || []).filter(f => !(tipo === "frase" && claveDe(f) === valor)),
    quitados: [...new Set([...(ajustes.quitados || []), k])].slice(-TOPES.quitados),
  };
  await Adaptacion.updateOne({ medicoPhone }, { $set: set }, { upsert: true });
  olvidar(medicoPhone);
}

// Volver a empezar: lo de antes no cuenta más, y lo que eligió él tampoco.
async function reiniciar(medicoPhone) {
  await Adaptacion.updateOne({ medicoPhone }, { $set: {
    desde: new Date(), largo: "", vinetas: "", terminos: [], abreviaturas: [], frases: [], quitados: [],
  } }, { upsert: true });
  olvidar(medicoPhone);
}

module.exports = {
  vocabularioParaTranscribir, paraLaNota, vista, cambiar, agregar, quitar, reiniciar, olvidar,
  // Para las pruebas.
  analizar, instruccionesDeEstilo, estiloDe, esAbreviatura, tramosCambiados, tokens, claveDe, TOPES,
};
