// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Qué entra en el resumen que el paciente se lleva
// ═══════════════════════════════════════════════════════════════════════════
//
// Este archivo es una sola decisión repetida quince veces: de todo lo que hay
// en un kardex, qué puede salir del consultorio.
//
// El porqué del modelo está en db/models.js. Acá va lo que hace falta para
// leer el código de abajo:
//
//   · Hay DOS alcances. "resumen" es una página —lo que el colega va a leer
//     de verdad antes de que entre el paciente— y "completo" es la historia
//     entera, para cuando el paciente se muda de ciudad o cambia de médico.
//
//   · Hay cosas que NO SALEN EN NINGUNO DE LOS DOS. Es lo más importante del
//     archivo y está en SIEMPRE_FUERA, con el motivo de cada una.
//
//   · Lo que sale se CONGELA. Esta función se corre una vez, al compartir, y
//     lo que devuelve se guarda tal cual.

// ═══ LO QUE NUNCA SALE ═════════════════════════════════════════════════════
//
// No es una lista de configuración: es la regla, escrita para que se pueda
// discutir. Si alguien quiere sacar algo de acá, que sea a propósito.
//
//   · LA TRANSCRIPCIÓN DE LA CONSULTA (`transcripcionCompleta`, `segmentos`).
//     Es la grabación de lo que se dijo en el consultorio, entero: incluye lo
//     que el paciente contó de su matrimonio, de su trabajo y de su vecina
//     camino a decir dónde le duele. Eso no es la historia clínica, es la
//     materia prima con la que se escribió. La nota clínica es la historia.
//
//   · EL BRIEF CLÍNICO (`briefClinico`). Lo escribe un modelo, no el médico.
//     Es una ayuda para que el médico llegue leído a la consulta, y está
//     pensado para que él lo lea sabiendo que puede estar mal. Mandarlo a un
//     tercero convierte un borrador de máquina en un documento.
//
//   · LOS DIAGNÓSTICOS DIFERENCIALES (`diagnosticosDiferenciales`) y EL HILO
//     CLÍNICO (`hiloClinico`). Son hipótesis sin confirmar —y las del hilo,
//     además, generadas por un modelo—. «Descartar linfoma» es una lista de
//     tareas del médico, no un dato del paciente; en manos de otro se lee
//     como una sospecha, y una sospecha equivocada sigue a alguien años.
//     Si el médico quiere que el colega sepa lo que sospecha, lo escribe en
//     el plan, que sí sale.
//
// Nada de esto depende de quién generó el resumen: vale igual para el médico
// y para el paciente. Un paciente tiene derecho a TODA su historia clínica,
// y estas cuatro cosas no lo son — son el cuaderno de trabajo de quien la
// escribió y el borrador de una máquina.
const { unidadDe } = require("./medicionesTipos");

const SIEMPRE_FUERA = [
  "transcripcionCompleta", "segmentos",
  "briefClinico", "diagnosticosDiferenciales", "hiloClinico",
];

// ═══ LAS SECCIONES ═════════════════════════════════════════════════════════
//
// `resumen` dice si la sección entra en el alcance corto. `fija` marca las que
// no se pueden destildar: la identidad, porque sin ella el documento no sirve
// para nada, y las alergias, porque son lo único que puede matar a alguien si
// falta. Un resumen sin alergias es peor que no mandar resumen — el que lo
// recibe asume que si no dice nada, no hay.
const SECCIONES = [
  { clave: "identidad",   titulo: "Datos de la persona",       resumen: true,  fija: true },
  { clave: "alergias",    titulo: "Alergias",                  resumen: true,  fija: true },
  { clave: "antecedentes", titulo: "Antecedentes personales",  resumen: true,  fija: false },
  { clave: "familiares",  titulo: "Antecedentes familiares",   resumen: false, fija: false },
  { clave: "medicacion",  titulo: "Medicación",                resumen: true,  fija: false },
  { clave: "consultas",   titulo: "Consultas",                 resumen: true,  fija: false },
  { clave: "informes",    titulo: "Estudios con informe firmado", resumen: true, fija: false },
  { clave: "vacunas",     titulo: "Vacunas",                   resumen: false, fija: false },
  { clave: "mediciones",  titulo: "Controles y mediciones",    resumen: false, fija: false },
  { clave: "tratamientos", titulo: "Plan de tratamiento",      resumen: false, fija: false },
];

const CLAVES_FIJAS = SECCIONES.filter(s => s.fija).map(s => s.clave);
const CLAVES_VALIDAS = SECCIONES.map(s => s.clave);

// Cuántas consultas entran en el alcance corto. Cinco no es un número mágico:
// es lo que entra en una hoja sin que el que la recibe tenga que decidir
// dónde dejar de leer. En "completo" no hay tope.
const CONSULTAS_EN_RESUMEN = 5;

// Qué secciones corresponden por defecto a un alcance. El médico después
// destilda lo que no quiera, pero nunca las fijas.
function seccionesPorDefecto(alcance) {
  return SECCIONES.filter(s => alcance === "completo" || s.resumen).map(s => s.clave);
}

// Normaliza lo que pidió quien comparte: se queda solo con claves conocidas,
// agrega siempre las fijas y respeta el orden de SECCIONES.
//
// El orden importa y por eso no se usa el que vino: si llegaran las claves
// desordenadas, el documento saldría con las alergias después de las
// consultas, que es exactamente donde nadie las mira.
function normalizarSecciones(pedidas, alcance) {
  const base = Array.isArray(pedidas) && pedidas.length
    ? pedidas.filter(c => CLAVES_VALIDAS.includes(c))
    : seccionesPorDefecto(alcance);
  const conFijas = new Set(base.concat(CLAVES_FIJAS));
  return CLAVES_VALIDAS.filter(c => conFijas.has(c));
}

// ─── Limpieza ──────────────────────────────────────────────────────────────
// Un campo vacío no se omite por prolijidad: una sección que dice «Medicación»
// y abajo no tiene nada le hace creer al que lee que el paciente no toma nada,
// cuando puede ser que nadie lo haya cargado. Mejor que la sección no exista.
const texto = (v) => String(v == null ? "" : v).trim();
const lista = (v) => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);
const vacio = (o) => !o || Object.keys(o).every(k => {
  const v = o[k];
  return v == null || v === "" || (Array.isArray(v) && !v.length);
});

function fecha(d) {
  return d ? new Date(d).toISOString() : null;
}

// ═══ ARMAR EL CONTENIDO ════════════════════════════════════════════════════
//
// Devuelve el objeto que se congela en `ResumenCompartido.contenido`. Recibe
// los documentos ya leídos y no los busca: así la misma función sirve para la
// previsualización que el médico mira antes de compartir y para lo que se
// guarda, sin riesgo de que una traiga algo distinto de la otra.
//
// Esa es la razón de que sea pura y no toque la base. Una previsualización
// que no es idéntica a lo que se manda es peor que no tener previsualización:
// el médico aprueba una cosa y sale otra.
function armarContenido({ paciente, persona, consultas, medicamentos, informes, vacunas, mediciones, tratamientos }, { alcance, secciones }) {
  const usa = (c) => secciones.includes(c);
  const c = {};

  if (usa("identidad")) {
    c.identidad = {
      nombre: texto(paciente.nombre),
      fechaNacimiento: fecha(paciente.fechaNacimiento),
      sexo: texto(paciente.sexo),
      // El de la persona de la clínica; si no está vinculada, el CPF de la
      // ficha (Brasil).
      documento: texto(persona?.documento) || texto(paciente.cpf),
      codigo: texto(paciente.codigo),
    };
  }

  // Las alergias viven en DOS lugares: en la persona de la clínica, si la
  // ficha está vinculada, y en la ficha misma, que es donde las carga el
  // médico de un paciente sin vincular (public/js/personas.js →
  // pintarSinPersona). Antes se leía solo la persona: el paciente de un
  // consultorio sin clínica salía con «sin alergias registradas» aunque las
  // tuviera cargadas. Se juntan las dos, sin repetir.
  //
  // Se manda la lista y, aparte, el aviso de si no hay: «sin alergias
  // registradas» y «no se preguntó» son cosas muy distintas para el que va a
  // recetar, y el documento no puede confundirlas.
  if (usa("alergias")) {
    const unicas = new Map();
    for (const a of [...lista(persona?.alergias), ...lista(paciente.alergias)]) {
      if (!unicas.has(a.toLocaleLowerCase())) unicas.set(a.toLocaleLowerCase(), a);
    }
    const todas = [...unicas.values()];
    c.alergias = {
      lista: todas,
      // Se dice explícitamente, porque un hueco se lee como un "no".
      registradas: todas.length > 0,
      actualizadasEn: fecha(persona?.alergiasActualizadasEn),
    };
  }

  if (usa("antecedentes")) {
    const a = lista(paciente.antecedentesPersonales);
    if (a.length) c.antecedentes = a;
  }

  if (usa("familiares")) {
    const f = (paciente.antecedentesFamiliares || [])
      .map(x => ({ parentesco: texto(x.parentesco), condicion: texto(x.condicion) }))
      .filter(x => x.condicion);
    if (f.length) c.familiares = f;
  }

  if (usa("medicacion")) {
    // En el resumen corto va solo lo que el paciente TOMA HOY: es lo que
    // necesita saber quien va a recetar. La medicación que terminó es
    // historia, y va en el completo.
    const activos = (medicamentos || []).filter(m => !m.fechaFin);
    const cuales = alcance === "completo" ? (medicamentos || []) : activos;
    const m = cuales.map(x => ({
      nombre: texto(x.nombre), dosis: texto(x.dosis), frecuencia: texto(x.frecuencia),
      desde: fecha(x.fechaInicio), hasta: fecha(x.fechaFin),
      activo: !x.fechaFin,
    })).filter(x => x.nombre);
    if (m.length) c.medicacion = m;
  }

  if (usa("consultas")) {
    const cuales = alcance === "completo"
      ? (consultas || [])
      : (consultas || []).slice(0, CONSULTAS_EN_RESUMEN);
    const items = cuales.map(x => {
      const n = x.notaClinica || {};
      // Solo lo que el médico escribió o revisó. Ver SIEMPRE_FUERA.
      const fila = {
        fecha: fecha(x.createdAt),
        motivo: texto(n.motivoConsulta),
        diagnostico: texto(n.diagnostico),
        plan: texto(n.plan),
        sintomas: lista(n.sintomas),
        examenes: lista(n.examenesSolicitados),
        recetado: (n.medicamentosRecetados || [])
          .map(r => ({ nombre: texto(r.nombre), dosis: texto(r.dosis), frecuencia: texto(r.frecuencia) }))
          .filter(r => r.nombre),
        proximoControl: texto(n.proximoControl),
      };
      return vacio({ motivo: fila.motivo, diagnostico: fila.diagnostico, plan: fila.plan,
                     sintomas: fila.sintomas, examenes: fila.examenes, recetado: fila.recetado })
        ? null : fila;
    }).filter(Boolean);
    if (items.length) {
      c.consultas = items;
      // Cuántas quedaron afuera. Sin esto, un resumen de 5 de 40 consultas se
      // lee como una historia de 5 consultas, y el que lo recibe saca
      // conclusiones sobre un paciente que no es.
      c.consultasTotales = (consultas || []).length;
    }
  }

  // Los INFORMES firmados, no los estudios sueltos. Un Estudio es el archivo
  // —la placa, el PDF del laboratorio— y no tiene conclusión; la conclusión
  // vive en el Informe que alguien firmó sobre él.
  //
  // Mandar estudios sin informe sería pedirle a un colega que interprete una
  // imagen de pasada, sin contexto y sin que nadie se haga cargo de la
  // lectura. Lo que viaja es lo que un profesional ya firmó.
  if (usa("informes")) {
    const e = (informes || [])
      .filter(x => x.estado === "firmado")
      .map(x => ({
        tipo: texto(x.tipoEstudio), fecha: fecha(x.fechaEstudio),
        titulo: texto(x.titulo), conclusion: texto(x.conclusion),
        // Las recomendaciones del informante son para el médico que sigue
        // al paciente, o sea justo para quien está leyendo esto.
        recomendaciones: texto(x.recomendaciones),
      }))
      .filter(x => x.titulo || x.conclusion);
    if (e.length) c.informes = e;
  }

  if (usa("vacunas")) {
    const v = (vacunas || [])
      .map(x => ({ nombre: texto(x.nombre), dosis: texto(x.dosis), fecha: fecha(x.fecha) }))
      .filter(x => x.nombre);
    if (v.length) c.vacunas = v;
  }

  if (usa("mediciones")) {
    // La presión son DOS números (sistólica en valor, diastólica en
    // valorSecundario): antes salía «120» sola. Y la unidad no se guarda con
    // la medición: sale del tipo (services/medicionesTipos.js).
    const m = (mediciones || [])
      .map(x => ({
        tipo: texto(x.tipo), valor: x.valor,
        valorSecundario: x.valorSecundario ?? null,
        unidad: unidadDe(x.tipo),
        fecha: fecha(x.fecha || x.createdAt),
      }))
      .filter(x => x.tipo);
    if (m.length) c.mediciones = m;
  }

  if (usa("tratamientos")) {
    // El plan, sin la plata. Lo que tiene que saber el colega es qué está
    // hecho y qué falta; cuánto pagó y cuánto debe es de la relación del
    // paciente con SU consultorio y no tiene nada que hacer en otro.
    const t = (tratamientos || [])
      .map(x => ({ nombre: texto(x.nombre), estado: texto(x.estado), piezaFdi: x.piezaFdi || null }))
      .filter(x => x.nombre);
    if (t.length) c.tratamientos = t;
  }

  return c;
}

module.exports = {
  SECCIONES, SIEMPRE_FUERA, CLAVES_VALIDAS, CLAVES_FIJAS, CONSULTAS_EN_RESUMEN,
  seccionesPorDefecto, normalizarSecciones, armarContenido,
};
