// Symphomed — El tutor clínico de las cuentas de estudiante (etapa 2).
//
// ═══ PARA QUÉ ══════════════════════════════════════════════════════════════
//
// Un estudiante no aprende si la máquina le da el diagnóstico hecho. Aprende
// si piensa primero y después compara. Por eso son dos momentos:
//
//   1. Mientras entrevista: «te falta preguntar…». Con lo que ya se habló,
//      qué preguntas importantes de la anamnesis todavía no hizo y qué
//      banderas rojas conviene descartar. Le enseña a hacer una buena
//      entrevista con el paciente adelante. Va junto a la nota en vivo.
//
//   2. Al terminar: «¿cuál es tu diagnóstico?». Él escribe su diagnóstico y
//      sus diferenciales ANTES de ver nada. Recién ahí se le muestra el
//      razonamiento: los diferenciales de este caso, qué datos de la consulta
//      apoyan o contradicen cada uno, qué estudio los distingue, las banderas
//      rojas, y la comparación con lo que él pensó.
//
// ═══ LO QUE NO SE NEGOCIA ══════════════════════════════════════════════════
//
// · Solo con lo que se dijo en la consulta (y lo registrado en la ficha). Si
//   falta un dato para decidir, se dice que falta: no se inventa un signo,
//   un resultado ni un antecedente. Un tutor que inventa enseña a inventar.
// · Sin porcentajes: el orden dice qué es más probable. Un «73 %» es un número
//   inventado con apariencia de medición (mismo criterio que el hilo clínico).
// · Es material de aprendizaje. El diagnóstico lo confirma su tutor, y la
//   pantalla lo dice siempre.
// · A la IA no le llega el nombre del paciente: edad, sexo, antecedentes y
//   alergias alcanzan para razonar.
const { log } = require("../config");
const { perfil } = require("./idiomas");
const ia = require("./ia");

const MAX_TEXTO = 80000;            // una consulta de 70 minutos entra con margen
const PALABRAS_MINIMAS = 15;

const texto = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lista = (v, maxItems, maxLargo = 200) => (Array.isArray(v) ? v : [])
  .map(x => texto(x, maxLargo)).filter(Boolean).slice(0, maxItems);

function reglaDeIdioma(idioma) {
  return `Escribí el CONTENIDO en ${perfil(idioma).nota.nombre}. Las CLAVES del JSON van exactamente como están, sin traducir.`;
}

const pedirJson = (sistema, usuario, maxTokens) => ia.pedirJson(sistema, usuario, { maxTokens });

// Lo que se sabe del paciente sin decir quién es.
function datosDeFicha(paciente, hoy = new Date()) {
  if (!paciente) return "";
  const partes = [];
  if (paciente.fechaNacimiento) {
    const edad = Math.floor((hoy - new Date(paciente.fechaNacimiento)) / (365.25 * 86400000));
    if (edad >= 0 && edad < 130) partes.push(`Edad: ${edad} años`);
  }
  if (paciente.sexo) partes.push(`Sexo: ${paciente.sexo}`);
  if (paciente.antecedentesPersonales?.length) partes.push(`Antecedentes personales registrados: ${paciente.antecedentesPersonales.join("; ")}`);
  if (paciente.antecedentesFamiliares?.length) {
    partes.push(`Antecedentes familiares registrados: ${paciente.antecedentesFamiliares.map(a => `${a.parentesco}: ${a.condicion}`).join("; ")}`);
  }
  if (paciente.alergias?.length) partes.push(`Alergias registradas: ${paciente.alergias.join("; ")}`);
  return partes.join("\n");
}

const palabras = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

// ─── 1. MIENTRAS ENTREVISTA: «te falta preguntar» ──────────────────────────

const PROMPT_FALTA = `Sos un tutor clínico que acompaña a un estudiante de medicina mientras entrevista a un paciente. Te paso lo que se habló HASTA AHORA (transcripción automática: puede tener errores, y no siempre queda claro quién habla).

Tu tarea: decir qué preguntas importantes de la anamnesis TODAVÍA NO se hicieron para este motivo de consulta, y qué banderas rojas conviene descartar.

REGLAS:
1. SOLO LO QUE FALTA. Si ya se preguntó, o el paciente ya lo contó, no lo pongas.
2. Máximo 5 preguntas, la más importante primero. Cortas, como se las diría al paciente.
3. "porQue": una frase corta de qué descarta o qué cambia esa respuesta.
4. Banderas rojas: máximo 3, solo las pertinentes a este cuadro.
5. NO DES DIAGNÓSTICOS: eso lo piensa el estudiante al final.
6. Si todavía no hay un motivo de consulta claro, devolvé las listas vacías.

Respondé SOLO JSON:
{"preguntas":[{"pregunta":"string","porQue":"string"}],"banderasRojas":["string"]}`;

async function preguntasFaltantes(transcripcion, idioma, paciente = null) {
  const vacio = { preguntas: [], banderasRojas: [] };
  if (palabras(transcripcion) < PALABRAS_MINIMAS) return vacio;
  try {
    const ficha = datosDeFicha(paciente);
    const r = await pedirJson(`${PROMPT_FALTA}\n\n${reglaDeIdioma(idioma)}`,
      `${ficha ? `DATOS DE LA FICHA:\n${ficha}\n\n` : ""}LO QUE SE HABLÓ HASTA AHORA:\n${String(transcripcion).slice(-MAX_TEXTO)}`, 700);
    return {
      preguntas: (Array.isArray(r?.preguntas) ? r.preguntas : [])
        .map(p => ({ pregunta: texto(p?.pregunta, 200), porQue: texto(p?.porQue, 200) }))
        .filter(p => p.pregunta).slice(0, 5),
      banderasRojas: lista(r?.banderasRojas, 3),
    };
  } catch (e) {
    // Es una ayuda: si falla, la nota en vivo sigue igual.
    log.warn("[TUTOR] te falta preguntar:", e.message);
    return vacio;
  }
}

// ─── 2. AL TERMINAR: el razonamiento, después de que él pensó ──────────────

const PROMPT_RAZONAMIENTO = `Sos un tutor clínico. Un estudiante de medicina atendió a un paciente. Te paso la transcripción de la consulta, los datos registrados en la ficha, y el diagnóstico que el estudiante propuso ANTES de ver tu análisis. Tu trabajo es enseñarle a razonar, no reemplazar a su tutor.

Hacé esto:
1. "diferenciales": los diagnósticos diferenciales razonables para ESTE caso, ordenados de MÁS a MENOS probable (máximo 5). Para cada uno:
   - "aFavor": datos DE ESTA CONSULTA o de la ficha que lo apoyan.
   - "enContra": datos de la consulta que lo contradicen, o lo que falta saber para sostenerlo.
   - "estudio": el examen o la maniobra que más ayuda a confirmarlo o descartarlo.
2. "banderasRojas": lo que no se puede pasar por alto en este cuadro (máximo 3).
3. "faltoPreguntar": preguntas que no se hicieron y que habrían cambiado el análisis (máximo 3).
4. "comparacion":
   - "acertoPrincipal": true si el diagnóstico principal del estudiante coincide en lo esencial con tu primer diferencial, aunque lo nombre distinto; si no, false.
   - "comentario": 2 o 3 frases en segunda persona, concretas: qué razonó bien y qué le faltó.
   - "noConsideraste": diferenciales importantes que el estudiante no nombró (máximo 3), cada uno con "porQue" basado en datos de la consulta.
5. "perla": la enseñanza clave de este caso, en una frase.

REGLAS QUE NO SE NEGOCIAN:
1. USÁ SOLO DATOS QUE ESTÉN EN LA TRANSCRIPCIÓN O EN LA FICHA. Si falta información para decidir, decilo ("no se preguntó…", "faltaría…"). NUNCA inventes signos, resultados de estudios ni antecedentes.
2. NADA DE PORCENTAJES NI PUNTAJES: el orden ya dice qué es más probable.
3. SÉ HONESTO: si el estudiante acertó, decíselo; si se equivocó, explicá por qué, sin vueltas y con respeto.
4. Es material de aprendizaje: el diagnóstico real lo confirma su tutor.

Respondé SOLO JSON:
{"diferenciales":[{"diagnostico":"string","aFavor":["string"],"enContra":["string"],"estudio":"string"}],"banderasRojas":["string"],"faltoPreguntar":["string"],"comparacion":{"acertoPrincipal":true,"comentario":"string","noConsideraste":[{"diagnostico":"string","porQue":"string"}]},"perla":"string"}`;

function sanearRazonamiento(r) {
  const comp = r?.comparacion || {};
  return {
    diferenciales: (Array.isArray(r?.diferenciales) ? r.diferenciales : [])
      .map(d => ({ diagnostico: texto(d?.diagnostico, 160), aFavor: lista(d?.aFavor, 5), enContra: lista(d?.enContra, 5), estudio: texto(d?.estudio, 200) }))
      .filter(d => d.diagnostico).slice(0, 5),
    banderasRojas: lista(r?.banderasRojas, 3),
    faltoPreguntar: lista(r?.faltoPreguntar, 3),
    acertoPrincipal: comp.acertoPrincipal === true,
    comentario: texto(comp.comentario, 600),
    noConsideraste: (Array.isArray(comp.noConsideraste) ? comp.noConsideraste : [])
      .map(x => ({ diagnostico: texto(x?.diagnostico, 160), porQue: texto(x?.porQue, 300) }))
      .filter(x => x.diagnostico).slice(0, 3),
    perla: texto(r?.perla, 300),
  };
}

// respuesta: { principal, diferenciales: [..] } — lo que pensó el estudiante.
async function razonamientoDiagnostico(transcripcion, respuesta, idioma, paciente = null) {
  const ficha = datosDeFicha(paciente);
  const delEstudiante = `Diagnóstico principal: ${respuesta.principal}\nDiferenciales: ${respuesta.diferenciales.length ? respuesta.diferenciales.join("; ") : "(no propuso)"}`;
  const r = await pedirJson(`${PROMPT_RAZONAMIENTO}\n\n${reglaDeIdioma(idioma)}`,
    `TRANSCRIPCIÓN DE LA CONSULTA:\n${String(transcripcion).slice(0, MAX_TEXTO)}\n\n${ficha ? `DATOS DE LA FICHA:\n${ficha}\n\n` : ""}LO QUE PROPUSO EL ESTUDIANTE:\n${delEstudiante}`, 2200);
  const saneado = sanearRazonamiento(r);
  if (!saneado.diferenciales.length) throw new Error("La IA no devolvió diferenciales");
  return saneado;
}

module.exports = { preguntasFaltantes, razonamientoDiagnostico, sanearRazonamiento, datosDeFicha, PALABRAS_MINIMAS };
