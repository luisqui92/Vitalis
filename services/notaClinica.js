// ChatGo Salud — genera la nota clínica estructurada a partir de la
// transcripción de una consulta (motivo, síntomas, diagnóstico, plan...),
// y detecta sugerencias nuevas para el Kardex (antecedentes, vacunas) que
// el médico puede aprobar con un toque. Es un segundo paso de IA, separado
// de la transcripción en sí.
const axios = require("axios");
const { CONFIG, log } = require("../config");
const { fechaStrBolivia } = require("./utils");

// El idioma sale de la cuenta del médico, igual que en la transcripción.
// Acá no alcanza con traducir el prompt: hay que decirle explícitamente que
// las CLAVES del JSON no se tocan. Si el modelo tradujera "diagnostico" a
// "diagnóstico" o a "diagnóstico" en portugués, la nota no se guarda y el
// médico pierde la consulta entera.
//
// Lo propio de cada idioma (cómo se llama, los días de la semana, reglas
// extra como la DCB en Brasil) vive en services/idiomas/<idioma>/nota.js.
const { perfil } = require("./idiomas");
const notaDe = (idioma) => perfil(idioma).nota;

const PROMPT_SISTEMA = `Eres un asistente clínico. A partir de la transcripción de una consulta
médica en {IDIOMA} (puede tener errores de transcripción, y a veces no queda
100% claro quién es el médico y quién el paciente), generá una nota clínica
estructurada.

RESPONDE SOLO JSON con esta estructura exacta:
{
  "motivoConsulta": "string breve o null",
  "sintomas": ["string", ...],
  "antecedentesRelevantes": "string o null",
  "diagnostico": "string o null",
  "diagnosticosDiferenciales": ["string", ...],
  "plan": "string o null",
  "medicamentosRecetados": [{"nombre":"string","dosis":"string o null","frecuencia":"string o null"}],
  "examenesSolicitados": ["string", ...],
  "proximoControl": "string o null",
  "reconsultaSugerida": {"fechaHora":"YYYY-MM-DDTHH:mm o null","textoOriginal":"string o null"},
  "tratamientosSugeridos": [{"itemMencionado":"string","piezaFdi":"number o null","catalogoNombreSugerido":"string o null"}],
  "examenOcularSugerido": [{"ojo":"OD u OI","estructura":"string exacto de la lista dada","hallazgo":"string","estado":"normal|leve|moderado|importante"}],
  "odontogramaSugerido": [{"piezaFdi":"number 11-48","estado":"uno exacto de la lista dada","hallazgo":"string"}],
  "ginecoSugerido": [{"organo":"string exacto de la lista dada","hallazgo":"uno exacto de la lista dada","detalle":"string"}],
  "antecedentesPersonalesNuevos": ["string", ...],
  "antecedentesFamiliaresNuevos": [{"parentesco":"string","condicion":"string"}],
  "vacunasMencionadas": [{"nombre":"string","dosis":"string o null","fecha":"YYYY-MM-DD o null"}]
}

Reglas:
- Si algo no se menciona en la transcripción, usá null o un array vacío.
- NUNCA inventes información clínica que no esté en el texto. Esto es un
  apoyo para el médico, no reemplaza su criterio profesional.
- "medicamentosRecetados": SOLO los medicamentos que se NOMBRAN en la
  transcripción, con el nombre que se dijo. No completes con lo que "suele"
  indicarse para ese cuadro: si el médico dijo paracetamol, es paracetamol y
  no ibuprofeno; si nombró un antibiótico y nada más, va solo el antibiótico.
  Una dosis o una frecuencia que no se dijo va en null, no se deduce.
- "antecedentesPersonalesNuevos"/"antecedentesFamiliaresNuevos"/"vacunasMencionadas":
  te paso lo que el paciente YA tiene registrado (más abajo, si hay). Reportá
  SOLO lo que se menciona en esta transcripción y que NO esté ya en esa lista
  — no repitas algo que el paciente ya tenía anotado.
- "reconsultaSugerida": SOLO cuando el médico menciona una fecha u hora
  concreta para volver a VER AL PACIENTE en una nueva consulta (ej: "te veo
  el sábado a las siete", "la próxima semana el martes", "en 15 días", "el
  20 a las 10", "nos vemos el viernes", "vení para control el lunes"). Te
  doy la fecha de HOY abajo — resolvé la fecha/hora real a partir de eso
  (si dice "el sábado" y hoy es miércoles, es el sábado que viene, no uno
  pasado). Si no se especifica si es de mañana o de tarde, elegí el
  horario más razonable para un consultorio (el médico lo revisa después,
  no hace falta que sea perfecto).
  OJO — hay fechas que se mencionan en la consulta y NO son una reconsulta,
  aunque suenen parecido. En esos casos dejá reconsultaSugerida en null:
    · Duración de un medicamento: "tomalo hasta el viernes", "por 5 días",
      "hasta que se termine el frasco" → es dosis/frecuencia, va en
      "medicamentosRecetados", no acá.
    · Inicio de los síntomas: "estoy así desde hace tres días", "me
      empezó el lunes" → es parte de la historia de la enfermedad actual,
      no una cita futura.
    · Fecha de un examen o resultado: "el jueves te llega el resultado
      del laboratorio" → no es una consulta con el médico.
  Ante la duda de si una fecha es realmente para volver a verse (y no otra
  cosa), dejá reconsultaSugerida en null — mejor que el médico lo agregue
  a mano a que le llegue un mensaje equivocado al paciente. Si el médico
  solo dice algo vago sin fecha concreta ("en un mes", "cuando tenga los
  resultados", "más adelante"), también dejalo en null — eso ya lo cubre
  "proximoControl".
- "tratamientosSugeridos": SOLO si más abajo te doy un catálogo de
  tratamientos de este consultorio (si no te lo doy, dejá esta lista
  vacía — es una función solo para odontología y estética). Reportá cada tratamiento
  que el profesional dice que HAY QUE HACER de acá en adelante (no algo
  que ya se hizo, no un antecedente) — ej: "hay que poner un implante
  acá", "esto hay que sellarlo", "necesita una corona en esa pieza". Para
  cada uno:
  · "itemMencionado": la frase tal cual la dijo, para que la revise después.
  · "piezaFdi": el número de pieza (11-48) si lo mencionó junto, si no null.
  · "catalogoNombreSugerido": el profesional NO va a decir el nombre exacto
    del catálogo, así que buscá en la lista que te paso el ítem que MEJOR
    corresponda por significado (ej: "sellar" → el ítem de sellantes;
    "implante" → el ítem de implante unitario). Copiá el nombre EXACTO tal
    como aparece en la lista dada. Si ningún ítem del catálogo corresponde
    con confianza, dejalo en null — mejor no sugerir nada que sugerir el
    ítem equivocado (el profesional lo puede elegir a mano después).
- "examenOcularSugerido": SOLO si más abajo te doy una lista de estructuras
  oculares (si no te la doy, dejá esta lista vacía — es una función solo
  para oftalmología). El oftalmólogo va a ir narrando el examen en voz alta
  por cada ojo — reportá un ítem por cada hallazgo CONCRETO que mencione
  sobre una estructura puntual, ej: "ojo derecho, córnea transparente",
  "cristalino con opacidad cortical leve en el izquierdo", "retina sin
  desprendimiento". Para cada uno:
  · "ojo": "OD" (derecho) u "OI" (izquierdo) — tiene que quedar claro de
    cuál ojo habla; si no lo aclaró y no se puede inferir del contexto
    inmediato, no reportes ese hallazgo.
  · "estructura": copiá EXACTO uno de los valores de la lista de
    estructuras oculares válidas que te paso más abajo (son identificadores
    en inglés/sin tildes, ej. "camara_anterior", "nervio_optico" — usalos
    tal cual, no los traduzcas ni les pongas tildes) — el que mejor
    corresponda a lo que describió. Si no corresponde a ninguno, no lo
    reportes.
  · "hallazgo": lo que dijo, tal cual (para que quede en el registro).
  · "estado": clasificá la gravedad en "normal", "leve", "moderado" o
    "importante", según lo que el médico haya dicho (no según tu propio
    juicio clínico):
      - "normal": dijo que está bien/transparente/sin alteraciones/formada.
      - "leve": mencionó una alteración pero la calificó como leve, mínima,
        incipiente o similar.
      - "moderado": alteración que mencionó sin calificarla como leve ni
        grave, o que describió como "moderada".
      - "importante": palabras que indican urgencia o hallazgo serio —
        desprendimiento, hemorragia, pérdida de visión, sospecha de tumor,
        "grave", "severo".
    Si la gravedad no queda clara por lo que dijo, usá "leve" en vez de
    "normal" (para no esconder un hallazgo real) y en vez de "importante"
    (para no generar una alarma que el médico no dijo). Esto se aplica
    directo a la ficha del paciente sin que el médico lo confirme antes,
    así que ante cualquier duda real de a qué estructura/ojo se refiere,
    mejor no reportar ese ítem.
- "odontogramaSugerido": SOLO si más abajo te doy la lista de estados
  válidos de pieza dental (si no te la doy, dejá esta lista vacía — es una
  función solo para odontología). El odontólogo va mencionando el estado
  de piezas puntuales mientras revisa la boca — reportá un ítem por cada
  pieza con un número FDI claro (11-48) y un estado clínico concreto, ej:
  "la 36 tiene caries", "la 18 hay que extraerla", "24 con endodoncia ya
  hecha", "la 46 sana". Para cada uno:
  · "piezaFdi": el número FDI tal cual (11-48). Si no queda claro de qué
    pieza habla, no reportes ese ítem — nunca adivines el número.
  · "estado": copiá EXACTO uno de los estados válidos que te paso más
    abajo, el que mejor corresponda a lo que dijo. Si lo que describe no
    corresponde con confianza a ninguno de los estados de la lista, no
    reportes ese ítem.
    La lista tiene dos familias, y elegir bien entre ellas es lo más
    importante de este campo:
    — Lo que la pieza YA TIENE: "tiene caries" → "caries"; "está
      fracturada" → "fractura"; "ya tiene endodoncia hecha" →
      "endodoncia"; "tiene una corona" → "corona"; "está obturada" →
      "obturado"; "no está"/"ya se extrajo" → "ausente"; "está sana"/
      "bien" → "sano".
    — Lo que HAY QUE HACERLE y todavía no se hizo (terminan en
      "_indicada"/"_indicado"): "hay que hacer una endodoncia" →
      "endodoncia_indicada"; "va a necesitar corona" → "corona_indicada";
      "hay que obturarla"/"hay que taparla" → "obturacion_indicada";
      "hay que ponerle un implante" → "implante_indicado"; "hay que
      sacarla"/"hay que extraerla" → "extraccion_indicada".
    Nunca uses el estado hecho para algo que recién se planifica: si el
    odontólogo dice que HAY QUE hacer una endodoncia, es
    "endodoncia_indicada", no "endodoncia" — marcarla como hecha sería
    anotar en la ficha un tratamiento que no se hizo.
  · "hallazgo": lo que dijo, tal cual (para que quede en el registro).
  UNA SOLA entrada por pieza — cada diente guarda un único estado, así que
  dos entradas del mismo número se pisan. Si de una misma pieza dice el
  hallazgo Y el tratamiento, gana el hallazgo, que es lo que la pieza
  tiene: "la 36 tiene caries, hay que obturarla" → una sola entrada, con
  "caries" (marcarla "obturacion_indicada" escondería la caries). Usá los
  estados "_indicada" cuando el tratamiento es lo único que dijo de esa
  pieza: "hay que hacer una endodoncia en la 11" → "endodoncia_indicada".
  Esto se aplica directo al odontograma del paciente sin que el médico lo
  confirme antes (lo revisa/corrige después desde la pestaña Odontograma),
  así que ante cualquier duda real de la pieza o el estado, mejor no
  reportar ese ítem. Es un campo DISTINTO de "tratamientosSugeridos": acá
  va cómo queda la pieza en la ficha, allá va el ítem que se le va a
  cobrar al paciente — el mismo tratamiento dictado suele ir a los dos
  lados (ej: "hay que obturar la 36" → acá "obturacion_indicada" si no
  dijo qué tiene, y allá el ítem de obturación con su precio).
- "ginecoSugerido": SOLO si más abajo te doy la lista de órganos
  ginecológicos (si no te la doy, dejá esta lista vacía — es una función
  solo para ginecología). La ginecóloga va narrando lo que encuentra al
  examinar o al leer una ecografía — reportá un ítem por cada hallazgo
  CONCRETO sobre un órgano puntual, ej: "útero con un mioma de cuatro
  centímetros", "ovario izquierdo con quiste simple", "endometrio
  engrosado", "mama derecha con un nódulo palpable", "cuello sin lesiones".
  Para cada uno:
  · "organo": copiá EXACTO uno de los valores de la lista que te paso más
    abajo (son identificadores sin tildes, ej. "cuello_uterino",
    "ovario_izquierdo" — usalos tal cual, no los traduzcas ni les pongas
    tildes). Cuidado con el lado: si dice "ovario izquierdo" es
    "ovario_izquierdo". Si habla de un órgano par (ovario, trompa, mama)
    sin aclarar de qué lado, y no se puede inferir del contexto inmediato,
    NO reportes ese ítem.
  · "hallazgo": copiá EXACTO uno de los hallazgos válidos que te paso más
    abajo, el que mejor corresponda (ej: "tiene un mioma" → "mioma";
    "quiste simple" → "quiste"; "endometrio engrosado" → "engrosamiento";
    "se le extirpó" / "no se visualiza" → "ausente"; "sin alteraciones" /
    "normal" → "normal"). Si lo que describe no corresponde con confianza a
    ninguno, no reportes ese ítem.
  · "detalle": lo que dijo tal cual, con las medidas si las mencionó (para
    que quede en el registro).
  UNA SOLA entrada por órgano — cada uno guarda un único hallazgo, así que
  dos entradas del mismo órgano se pisan. Esto se aplica directo a la ficha
  sin que la médica lo confirme antes (lo corrige después desde el Mapa),
  así que ante cualquier duda real del órgano, del lado o del hallazgo,
  mejor no reportar ese ítem.`;

// El prompt completo para un idioma: la plantilla de arriba con el idioma
// puesto, más la regla de en qué lengua sale el contenido. Las claves del
// JSON quedan afuera de esa regla a propósito y se dice explícitamente.
function promptSistema(idioma) {
  const cfg = notaDe(idioma);
  return PROMPT_SISTEMA.replace("{IDIOMA}", cfg.nombre) + `

IDIOMA DE LA NOTA: escribí el CONTENIDO —todos los valores del JSON— en ${cfg.nombre}.
Las CLAVES del JSON NO se traducen nunca: van exactamente como están arriba,
en el mismo idioma y con la misma ortografía. Tampoco se traducen los valores
que el enunciado pide tomar de una lista dada (ojo, estructura, estado, órgano,
hallazgo): esos van tal cual figuran en la lista.${cfg.reglasExtra}`;
}

function construirContexto(contexto, idioma) {
  const partes = [];
  const hoy = new Date();
  const dias = notaDe(idioma).dias;
  partes.push(`Hoy es ${dias[hoy.getDay()]} ${fechaStrBolivia(hoy)}.`);
  if (contexto?.veterinaria) {
    partes.push(`Esta consulta es de medicina VETERINARIA — el paciente es un animal, no una persona${contexto.especie ? ` (${contexto.especie}${contexto.raza ? ", raza " + contexto.raza : ""})` : ""}. Interpretá "el paciente"/"el/la ${contexto.especie || "animal"}" en ese sentido, y las dosis de medicamentos en relación al peso del animal si se menciona.`);
  }
  if (contexto?.antecedentesPersonales?.length) {
    partes.push(`Antecedentes personales ya registrados: ${contexto.antecedentesPersonales.join("; ")}`);
  }
  if (contexto?.antecedentesFamiliares?.length) {
    partes.push(`Antecedentes familiares ya registrados: ${contexto.antecedentesFamiliares.map(a => `${a.parentesco}: ${a.condicion}`).join("; ")}`);
  }
  if (contexto?.medicamentosActivos?.length) {
    partes.push(`Medicamentos ya activos: ${contexto.medicamentosActivos.join(", ")}`);
  }
  // Lo que ESTE médico receta (services/vocabularioMedico.js). Sirve para
  // reconocer y escribir bien un nombre que sí se dijo, nunca para agregarlo.
  if (contexto?.medicamentosHabituales?.length) {
    partes.push(`Medicamentos que este médico receta habitualmente (incluye marcas comerciales): ${contexto.medicamentosHabituales.join(", ")}. ` +
      `Si en la transcripción aparece uno de estos, o algo que suena muy parecido, es un medicamento: escribilo como figura acá. ` +
      `NUNCA agregues a la nota un medicamento de esta lista que no se haya mencionado en la consulta.`);
  }
  if (contexto?.correccionesMedicamentos?.length) {
    partes.push(`Errores de transcripción que este médico ya corrigió antes (lo que salió escrito → lo que él quiso decir): ` +
      contexto.correccionesMedicamentos.map(c => `"${c.dijo}" → "${c.correcto}"`).join("; ") +
      `. Si en la transcripción aparece lo de la izquierda como medicamento, en la nota va lo de la derecha.`);
  }
  if (contexto?.catalogoTratamientos?.length) {
    partes.push(`Catálogo de tratamientos de este consultorio (para "tratamientosSugeridos"): ${contexto.catalogoTratamientos.join("; ")}`);
  }
  if (contexto?.estructurasOculares?.length) {
    partes.push(`Estructuras oculares válidas (para "examenOcularSugerido"): ${contexto.estructurasOculares.join(", ")}`);
  }
  if (contexto?.estadosPiezaDental?.length) {
    partes.push(`Estados de pieza dental válidos (para "odontogramaSugerido"): ${contexto.estadosPiezaDental.join(", ")}`);
  }
  if (contexto?.organosGineco?.length) {
    partes.push(`Órganos ginecológicos válidos (para "ginecoSugerido"): ${contexto.organosGineco.join(", ")}`);
    partes.push(`Hallazgos ginecológicos válidos: ${contexto.hallazgosGineco.join(", ")}`);
  }
  return `\n\n(${partes.join(" ")})`;
}

// ═══ LA NOTA QUE LLEGA VACÍA ═══════════════════════════════════════════════
//
// Pasó en una consulta real en portugués: 32 minutos bien transcritos y una
// nota con TODOS los campos en blanco, mostrada como si estuviera lista.
//
// El modelo había contestado, pero no con las claves pedidas. Con una
// consulta en portugués tiende a «traducir» las claves (motivoDaConsulta,
// plano, medicamentosPrescritos) o a envolver todo en otro objeto
// ({"notaClinica": {...}}). Mongo guarda solo las claves que conoce del
// esquema y descarta el resto EN SILENCIO: la nota queda vacía y marcada
// como completa, y el médico ve un formulario en blanco sin ninguna alarma.
//
// Tres redes, de la más barata a la más cara:
//   1. response_format json_object: el modelo no puede devolver algo que no
//      sea un JSON válido (ni cortado, ni con texto alrededor).
//   2. normalizarNota(): acepta las claves traducidas o envueltas y las
//      lleva a las del esquema.
//   3. Si con todo eso la nota de una transcripción con contenido sale
//      vacía, se pide de nuevo UNA vez recordándole el formato; y si vuelve
//      vacía, se falla con error —se ve como error y se puede regenerar—
//      en vez de mostrar un formulario en blanco que parece bueno.

const CLAVES_NOTA = [
  "motivoConsulta", "sintomas", "antecedentesRelevantes", "diagnostico", "diagnosticosDiferenciales",
  "plan", "medicamentosRecetados", "examenesSolicitados", "proximoControl", "reconsultaSugerida",
  "tratamientosSugeridos", "examenOcularSugerido", "odontogramaSugerido", "ginecoSugerido",
  "antecedentesPersonalesNuevos", "antecedentesFamiliaresNuevos", "vacunasMencionadas",
];

// Sin tildes, en minúsculas y sin separadores: "Motivo_da_Consulta" y
// "motivoDaConsulta" son la misma clave.
const plana = (k) => String(k).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Cómo aparecen las claves cuando el modelo las traduce (portugués e inglés).
const SINONIMOS = {
  motivoConsulta: ["motivodaconsulta", "motivodeconsulta", "motivo", "queixaprincipal", "queixa", "chiefcomplaint", "reasonforvisit"],
  sintomas: ["symptoms"],
  antecedentesRelevantes: ["antecedentes", "historicorelevante", "historicoclinico", "historiaclinica", "history"],
  diagnostico: ["diagnosis", "hipotesediagnostica", "impressaodiagnostica"],
  diagnosticosDiferenciales: ["diagnosticosdiferenciais", "diferenciais", "diferenciales", "differentialdiagnoses", "differentials"],
  plan: ["plano", "planoterapeutico", "conduta", "conducta", "plandetratamiento", "tratamento", "treatmentplan"],
  medicamentosRecetados: ["medicamentosprescritos", "medicacoesprescritas", "medicamentos", "prescricao", "prescricoes", "medications", "prescriptions"],
  examenesSolicitados: ["examessolicitados", "exames", "examenes", "examspedidos", "labs", "testsordered"],
  proximoControl: ["proximocontrole", "proximoretorno", "retorno", "seguimento", "followup"],
  reconsultaSugerida: ["retornosugerido", "reconsulta"],
  antecedentesPersonalesNuevos: ["antecedentespessoaisnovos"],
  antecedentesFamiliaresNuevos: ["antecedentesfamiliaresnovos"],
  vacunasMencionadas: ["vacinasmencionadas", "vacinas", "vaccines"],
};
const CLAVE_POR_PLANA = new Map();
for (const clave of CLAVES_NOTA) CLAVE_POR_PLANA.set(plana(clave), clave);
for (const [clave, alias] of Object.entries(SINONIMOS)) for (const a of alias) CLAVE_POR_PLANA.set(a, clave);

// Adentro de cada medicamento / antecedente familiar, lo mismo.
const SUBCLAVES = {
  nombre: ["nome", "name", "medicamento"], dosis: ["dose", "dosagem"], frecuencia: ["frequencia", "frequency", "posologia"],
  parentesco: ["relationship", "relacao"], condicion: ["condicao", "condition", "doenca"],
};
const SUBCLAVE_POR_PLANA = new Map();
for (const [clave, alias] of Object.entries(SUBCLAVES)) {
  SUBCLAVE_POR_PLANA.set(plana(clave), clave);
  for (const a of alias) SUBCLAVE_POR_PLANA.set(a, clave);
}
function normalizarSubobjeto(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const salida = {};
  for (const [k, v] of Object.entries(o)) salida[SUBCLAVE_POR_PLANA.get(plana(k)) || k] = v;
  return salida;
}

const CAMPOS_TEXTO = ["motivoConsulta", "antecedentesRelevantes", "diagnostico", "plan", "proximoControl"];
const CAMPOS_LISTA_TEXTO = ["sintomas", "diagnosticosDiferenciales", "examenesSolicitados", "antecedentesPersonalesNuevos"];

// → { nota, clavesAjustadas } — clavesAjustadas dice si hubo que arreglar algo
// (se loguea: es la señal de que el modelo se está yendo del formato).
function normalizarNota(crudo) {
  let obj = crudo && typeof crudo === "object" ? crudo : {};
  let clavesAjustadas = false;
  // Envuelto: {"notaClinica": {...}} o {"nota": {...}} — se desenvuelve si
  // lo de adentro tiene claves de nota y lo de afuera no.
  const conocidas = (o) => Object.keys(o || {}).filter(k => CLAVE_POR_PLANA.has(plana(k))).length;
  if (conocidas(obj) === 0) {
    const adentro = Object.values(obj).find(v => v && typeof v === "object" && !Array.isArray(v) && conocidas(v) >= 2);
    if (adentro) { obj = adentro; clavesAjustadas = true; }
  }
  const nota = {};
  for (const [k, v] of Object.entries(obj)) {
    const clave = CLAVE_POR_PLANA.get(plana(k));
    if (!clave) continue;
    if (clave !== k) clavesAjustadas = true;
    if (nota[clave] === undefined || nota[clave] === null) nota[clave] = v;
  }
  // Tipos: una lista que vino como texto se parte por comas; un texto que
  // vino como lista se une. Si no, Mongo lo descarta o lo guarda mal.
  for (const c of CAMPOS_TEXTO) {
    if (Array.isArray(nota[c])) nota[c] = nota[c].filter(Boolean).join("; ");
    else if (nota[c] != null && typeof nota[c] !== "string") nota[c] = String(nota[c]);
  }
  for (const c of CAMPOS_LISTA_TEXTO) {
    if (typeof nota[c] === "string") nota[c] = nota[c].split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  }
  for (const c of ["medicamentosRecetados", "antecedentesFamiliaresNuevos", "vacunasMencionadas"]) {
    if (Array.isArray(nota[c])) nota[c] = nota[c].map(normalizarSubobjeto);
  }
  return { nota, clavesAjustadas };
}

// "Vacía" = nada de lo que el médico lee primero. Las sugerencias por
// especialidad no cuentan: una consulta sin odontograma es lo normal.
function notaVacia(nota) {
  const lleno = (v) => (Array.isArray(v) ? v.some(x => x && (typeof x !== "string" || x.trim())) : typeof v === "string" && v.trim().length > 0);
  return !["motivoConsulta", "sintomas", "antecedentesRelevantes", "diagnostico", "plan", "medicamentosRecetados", "examenesSolicitados"]
    .some(c => lleno(nota?.[c]));
}

// Por debajo de esto una nota vacía puede ser legítima (se grabó un saludo y
// se cortó). Por encima, hubo una consulta y la nota vacía es un error.
const PALABRAS_MINIMAS_PARA_NOTA = 80;

async function pedirNota(mensajes) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: mensajes,
      // 1600 se quedaba corto para una consulta larga: la respuesta salía
      // cortada y el JSON, inválido. Con consultas de 60-70 minutos, 3000
      // también puede quedar corto; gpt-4o-mini acepta hasta 16.384.
      max_tokens: 6000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    },
    {
      headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` },
      timeout: CONFIG.TIMEOUT_NOTA_CLINICA,
    }
  );
  const content = res.data.choices[0].message.content.replace(/```json|```/g, "").trim();
  const crudo = JSON.parse(content);
  return { ...normalizarNota(crudo), clavesRecibidas: Object.keys(crudo || {}) };
}

async function generarNotaClinica(transcripcion, contexto, idioma) {
  const mensajes = [
    { role: "system", content: promptSistema(idioma) },
    { role: "user", content: transcripcion + construirContexto(contexto, idioma) },
  ];
  let r = await pedirNota(mensajes);
  const palabras = String(transcripcion || "").split(/\s+/).filter(Boolean).length;

  // Se loguean los NOMBRES de las claves, nunca los valores: los valores son
  // la historia clínica del paciente y no tienen por qué quedar en un log.
  if (r.clavesAjustadas) log.warn(`[NOTA_CLINICA] claves ajustadas (idioma ${idioma || "es"}): ${r.clavesRecibidas.join(", ")}`);

  if (notaVacia(r.nota) && palabras >= PALABRAS_MINIMAS_PARA_NOTA) {
    log.warn(`[NOTA_CLINICA] nota vacía de una transcripción de ${palabras} palabras (claves: ${r.clavesRecibidas.join(", ") || "ninguna"}) — se pide de nuevo`);
    r = await pedirNota([
      ...mensajes,
      { role: "system", content:
        "Tu respuesta anterior vino sin contenido, pero la transcripción SÍ tiene una consulta. " +
        "Volvé a generarla completando cada campo con lo que se dijo. Usá EXACTAMENTE las claves del " +
        "formato pedido (motivoConsulta, sintomas, antecedentesRelevantes, diagnostico, " +
        "diagnosticosDiferenciales, plan, medicamentosRecetados, examenesSolicitados, proximoControl…), " +
        "sin traducirlas y sin envolverlas en otro objeto." },
    ]);
    if (notaVacia(r.nota)) {
      log.error(`[NOTA_CLINICA] nota vacía otra vez (claves: ${r.clavesRecibidas.join(", ") || "ninguna"})`);
      throw new Error("La IA devolvió una nota vacía. Probá generarla de nuevo.");
    }
  }
  return sanearNota(r.nota);
}

// La IA a veces no respeta el formato pedido en el prompt para los dos
// campos que después se guardan en tipos estrictos de Mongo (fechaHora es
// Date, piezaFdi es Number) — ej. deja la fecha en texto libre en vez de
// resolverla, o repite "primera muela" en vez de un número. Si eso se
// guarda tal cual, el .save() de la consulta revienta con un CastError que
// ni el propio manejo de errores puede recuperar (el documento queda con
// el valor inválido pegado). Mejor limpiarlo acá, con la IA todavía fresca
// en el flujo, que descubrirlo como un 500 en producción.
function sanearNota(nota) {
  if (nota?.reconsultaSugerida?.fechaHora) {
    const d = new Date(nota.reconsultaSugerida.fechaHora);
    if (isNaN(d.getTime())) nota.reconsultaSugerida.fechaHora = null;
  }
  if (Array.isArray(nota?.tratamientosSugeridos)) {
    for (const t of nota.tratamientosSugeridos) {
      if (t && t.piezaFdi !== null && t.piezaFdi !== undefined) {
        const n = Number(t.piezaFdi);
        t.piezaFdi = Number.isFinite(n) ? n : null;
      }
    }
  }
  if (Array.isArray(nota?.odontogramaSugerido)) {
    for (const o of nota.odontogramaSugerido) {
      if (o && o.piezaFdi !== null && o.piezaFdi !== undefined) {
        const n = Number(o.piezaFdi);
        o.piezaFdi = Number.isFinite(n) ? n : null;
      }
    }
  }
  return nota;
}

// promptSistema se exporta solo para poder verificar el prompt ARMADO en las
// pruebas, y no que el archivo contenga ciertas palabras sueltas.
module.exports = { generarNotaClinica, promptSistema, normalizarNota, notaVacia };
