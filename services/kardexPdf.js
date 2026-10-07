// Symphomed — El Kardex del paciente en PDF.
//
// ═══ QUÉ TRAE ══════════════════════════════════════════════════════════════
//
// Lo mismo que la «historia completa» del resumen compartido
// (services/resumenCompartido.js → armarContenido, alcance "completo"), más
// las recetas emitidas. NO es una decisión nueva de qué sale del consultorio:
// es la misma, con la misma lista de lo que nunca sale (la transcripción, el
// brief de la IA, los diagnósticos diferenciales) y solo las consultas que
// el médico confirmó. Un PDF descargado es un documento que sale: se manda
// por WhatsApp, se imprime, se archiva en otro consultorio.
//
// ═══ EN QUÉ ORDEN ══════════════════════════════════════════════════════════
//
// Primero quién es y sus ALERGIAS (siempre, aunque no haya: «no hay
// registradas» se dice), después qué toma hoy, y recién después la historia.
// Es el orden de quien lo va a leer con el paciente adelante.
//
// ═══ CON EL MEMBRETE ═══════════════════════════════════════════════════════
//
// Arriba va el membrete del consultorio (el mismo de los informes): nombre
// del centro, profesional, registro, dirección y logo. Sin membrete, el
// nombre y el registro del médico. Abajo, «Página X de Y» y el aviso de que
// es un documento con datos de salud.
const { generarPdf, aWinAnsi, anchoTexto, partirEnRenglones, COLORES } = require("./pdf");
const { perfil } = require("./idiomas");
const { valorMedicion } = require("./medicionesTipos");

// ─── Fechas ─────────────────────────────────────────────────────────────────
// Un día civil (nacimiento, vacuna, inicio de un medicamento) se escribe en
// UTC: el 5 de marzo es el 5 de marzo en cualquier huso. Un momento (la hora
// de una consulta) se escribe en la zona del médico.
function formateadores(locale, zona) {
  const dia = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
  const momento = new Intl.DateTimeFormat(locale, { timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const valida = (d) => d && !Number.isNaN(new Date(d).getTime());
  return {
    dia: (d) => (valida(d) ? dia.format(new Date(d)) : ""),
    momento: (d) => (valida(d) ? momento.format(new Date(d)) : ""),
  };
}

function edadEn(nacimiento, hoy) {
  if (!nacimiento) return null;
  const n = new Date(nacimiento);
  if (Number.isNaN(n.getTime())) return null;
  let anios = hoy.getUTCFullYear() - n.getUTCFullYear();
  const m = hoy.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < n.getUTCDate())) anios--;
  return anios >= 0 && anios < 150 ? anios : null;
}

// La zona que manda el navegador, si es una zona real; si no, la del país.
function zonaValida(zona, porDefecto) {
  try {
    if (zona && typeof zona === "string" && zona.length < 64) {
      new Intl.DateTimeFormat("es", { timeZone: zona });
      return zona;
    }
  } catch { /* zona inventada */ }
  return porDefecto;
}

// ─── El registro profesional ───────────────────────────────────────────────
function registroDe(medico, membrete) {
  if (membrete?.profesionalRegistro) return membrete.profesionalRegistro;
  const c = medico?.conselho || {};
  if (c.sigla && c.uf && c.numero) return `${c.sigla}-${c.uf} ${c.numero}`;
  return medico?.matricula || "";
}

// ─── Encabezado y pie ──────────────────────────────────────────────────────
function crearEncabezado({ medico, membrete, paciente, T, generado }) {
  const centro = membrete?.nombreCentro || "";
  const profesional = membrete?.profesionalNombre || medico?.nombre || "";
  const titulo = membrete?.profesionalTitulo || medico?.especialidad || "";
  const registro = registroDe(medico, membrete);
  const contacto = [membrete?.direccion, membrete?.ciudad, membrete?.telefono].filter(Boolean).join(" · ");

  // Línea a línea, de arriba abajo. Con centro: el centro grande y debajo el
  // profesional. Sin centro: el profesional grande y debajo su título.
  const linea = (texto, estilo, tamano, color = COLORES.texto) => ({ texto, estilo, tamano, color });
  const izquierda = [];
  if (centro) {
    izquierda.push(linea(centro, "negrita", 12));
    if (profesional || titulo) izquierda.push(linea([profesional, titulo].filter(Boolean).join(" · "), "normal", 9));
  } else {
    if (profesional) izquierda.push(linea(profesional, "negrita", 12));
    if (titulo) izquierda.push(linea(titulo, "normal", 9));
  }
  if (registro) izquierda.push(linea(registro, "normal", 8.5, COLORES.tenue));
  if (contacto) izquierda.push(linea(contacto, "normal", 8, COLORES.tenue));

  const derecha = [
    { texto: T.titulo.toUpperCase(), estilo: "negrita", tamano: 8.5, color: COLORES.primario },
    { texto: paciente.nombre || "", estilo: "negrita", tamano: 10.5, color: COLORES.texto },
    { texto: `${T.generado} ${generado}`, estilo: "normal", tamano: 7.5, color: COLORES.tenue },
  ];

  return ({ pagina, anchoUtil, margen, imagen }) => {
    const ops = [];
    const x0 = margen.izquierdo;
    let y = margen.superior;

    if (pagina > 1) {
      // De la segunda en adelante, una línea: de quién es y de qué paciente.
      const izq = aWinAnsi(centro || profesional);
      const der = aWinAnsi(`${T.titulo} · ${paciente.nombre || ""}`);
      ops.push({ op: "texto", x: x0, y: y + 8, texto: izq, estilo: "negrita", tamano: 8.5, color: COLORES.tenue });
      ops.push({ op: "texto", x: x0 + anchoUtil - anchoTexto(der, "normal", 8.5), y: y + 8, texto: der, estilo: "normal", tamano: 8.5, color: COLORES.tenue });
      ops.push({ op: "linea", x1: x0, y1: y + 14, x2: x0 + anchoUtil, y2: y + 14, grosor: 0.5, color: COLORES.linea });
      return { alto: 26, ops };
    }

    // El logo: hasta 46 pt de alto y 110 de ancho, sin deformarlo.
    let xTexto = x0;
    const logo = imagen("logo");
    let altoLogo = 0;
    if (logo) {
      const escala = Math.min(46 / logo.alto, 110 / logo.ancho);
      const w = logo.ancho * escala, h = logo.alto * escala;
      ops.push({ op: "imagen", id: "logo", x: x0, y, ancho: w, alto: h });
      xTexto = x0 + w + 10;
      altoLogo = h;
    }

    // Columna derecha primero: define cuánto lugar le queda a la izquierda.
    const anchoDerecha = Math.min(200, anchoUtil * 0.4);
    let yDer = y;
    for (const l of derecha) {
      const renglones = partirEnRenglones([{ ...l, texto: aWinAnsi(l.texto) }], anchoDerecha);
      for (const r of renglones) {
        const w = r.ancho;
        r.segmentos.forEach(s => ops.push({ op: "texto", x: x0 + anchoUtil - w + s.x, y: yDer + l.tamano * 0.95, texto: s.texto, estilo: s.estilo, tamano: s.tamano, color: s.color }));
        yDer += l.tamano * 1.3;
      }
    }

    const anchoIzquierda = x0 + anchoUtil - anchoDerecha - 14 - xTexto;
    let yIzq = y;
    for (const l of izquierda) {
      const renglones = partirEnRenglones([{ ...l, texto: aWinAnsi(l.texto) }], anchoIzquierda);
      for (const r of renglones) {
        r.segmentos.forEach(s => ops.push({ op: "texto", x: xTexto + s.x, y: yIzq + l.tamano * 0.95, texto: s.texto, estilo: s.estilo, tamano: s.tamano, color: s.color }));
        yIzq += l.tamano * 1.3;
      }
    }

    const fin = Math.max(yIzq, yDer, y + altoLogo) + 6;
    ops.push({ op: "linea", x1: x0, y1: fin, x2: x0 + anchoUtil, y2: fin, grosor: 1, color: COLORES.primario });
    return { alto: fin - y + 12, ops };
  };
}

function crearPie({ membrete, T }) {
  const confidencial = aWinAnsi(T.confidencial);
  const extra = aWinAnsi(membrete?.piePagina || "");
  return ({ pagina, total, anchoUtil, margen, hoja }) => {
    const x0 = margen.izquierdo;
    const y = hoja.alto - margen.inferior + 18;
    const numero = aWinAnsi(T.pagina(pagina, total));
    const ops = [
      { op: "linea", x1: x0, y1: y, x2: x0 + anchoUtil, y2: y, grosor: 0.4, color: COLORES.linea },
      { op: "texto", x: x0, y: y + 11, texto: confidencial, estilo: "normal", tamano: 7, color: COLORES.tenue },
      { op: "texto", x: x0 + anchoUtil - anchoTexto(numero, "negrita", 7.5), y: y + 11, texto: numero, estilo: "negrita", tamano: 7.5, color: COLORES.tenue },
    ];
    if (extra) {
      const r = partirEnRenglones([{ texto: extra, estilo: "normal", tamano: 7, color: COLORES.tenue }], anchoUtil - 80)[0];
      if (r) r.segmentos.forEach(s => ops.push({ op: "texto", x: x0 + s.x, y: y + 20, texto: s.texto, estilo: s.estilo, tamano: s.tamano, color: s.color }));
    }
    return ops;
  };
}

// ─── El cuerpo ─────────────────────────────────────────────────────────────
function bloquesDelKardex({ contenido: c, paciente, recetas, consultasSinConfirmar, T, f, locale, hoy, firma, deEstudiante = false }) {
  const B = [];
  const S = T.secciones;

  // 0. Si lo escribió un estudiante, lo primero que se lee
  // (services/estudiantes.js): sin la firma del médico responsable, esto no
  // es una historia clínica válida.
  if (deEstudiante) B.push({ tipo: "alerta", nivel: "peligro", titulo: T.estudiante.titulo, texto: T.estudiante.texto });

  // 1. Quién es.
  B.push({ tipo: "seccion", texto: S.paciente });
  const id = c.identidad || {};
  const edad = edadEn(id.fechaNacimiento, hoy);
  B.push({ tipo: "campo", etiqueta: T.campos.nombre, valor: id.nombre });
  B.push({ tipo: "campo", etiqueta: T.campos.nacimiento, valor: [f.dia(id.fechaNacimiento), edad != null ? T.campos.edad(edad) : ""].filter(Boolean).join(" · ") });
  B.push({ tipo: "campo", etiqueta: T.campos.sexo, valor: id.sexo });
  B.push({ tipo: "campo", etiqueta: T.campos.documento, valor: id.documento });
  B.push({ tipo: "campo", etiqueta: T.campos.especie, valor: [paciente.especie, paciente.raza].filter(Boolean).join(" · ") });
  B.push({ tipo: "campo", etiqueta: T.campos.dueno, valor: paciente.duenoNombre });
  B.push({ tipo: "campo", etiqueta: T.campos.tutor, valor: [paciente.tutorNombre, paciente.tutorParentesco].filter(Boolean).join(" · ") });
  B.push({ tipo: "campo", etiqueta: T.campos.codigo, valor: id.codigo });

  // 2. Alergias: SIEMPRE, y arriba de todo lo clínico.
  const alergias = c.alergias?.lista || [];
  B.push(alergias.length
    ? { tipo: "alerta", nivel: "peligro", titulo: T.alergias.titulo, texto: alergias.join(" · ") }
    : { tipo: "alerta", nivel: "aviso", titulo: T.alergias.titulo, texto: T.alergias.ninguna });

  // 3. Antecedentes.
  if (c.antecedentes?.length) {
    B.push({ tipo: "seccion", texto: S.antecedentes });
    B.push({ tipo: "lista", items: c.antecedentes });
  }
  if (c.familiares?.length) {
    B.push({ tipo: "seccion", texto: S.familiares });
    B.push({ tipo: "lista", items: c.familiares.map(x => [
      { texto: x.parentesco ? `${x.parentesco}: ` : "", estilo: "negrita" }, { texto: x.condicion },
    ]) });
  }

  // 4. Qué toma: lo que está en curso primero.
  if (c.medicacion?.length) {
    const orden = [...c.medicacion].sort((a, b) => Number(b.activo) - Number(a.activo));
    B.push({ tipo: "seccion", texto: S.medicacion });
    B.push({
      tipo: "tabla",
      columnas: T.medicacion.columnas.map((titulo, i) => ({ titulo, ancho: [0.32, 0.16, 0.22, 0.13, 0.17][i] })),
      filas: orden.map(m => [m.nombre, m.dosis, m.frecuencia, f.dia(m.desde), m.activo ? T.medicacion.activo : T.medicacion.hasta(f.dia(m.hasta))]),
    });
  }

  // 5. Las consultas, de la más reciente a la más vieja.
  if (c.consultas?.length || consultasSinConfirmar) {
    B.push({ tipo: "seccion", texto: S.consultas });
    (c.consultas || []).forEach((x, i) => {
      if (i > 0) B.push({ tipo: "separador" });
      const cuando = f.momento(x.fecha);
      const continuacion = T.continuacion(cuando);
      B.push({ tipo: "subtitulo", texto: cuando });
      B.push({ tipo: "campo", etiqueta: T.consulta.motivo, valor: x.motivo, continuacion });
      B.push({ tipo: "campo", etiqueta: T.consulta.sintomas, valor: (x.sintomas || []).join(", "), continuacion });
      B.push({ tipo: "campo", etiqueta: T.consulta.diagnostico, valor: x.diagnostico, continuacion });
      B.push({ tipo: "campo", etiqueta: T.consulta.plan, valor: x.plan, continuacion });
      if (x.recetado?.length) {
        B.push({ tipo: "parrafo", partes: [{ texto: `${T.consulta.recetado}:`, estilo: "negrita" }], continuacion });
        B.push({ tipo: "lista", items: x.recetado.map(r => [r.nombre, r.dosis, r.frecuencia].filter(Boolean).join(" — ")), continuacion });
      }
      B.push({ tipo: "campo", etiqueta: T.consulta.examenes, valor: (x.examenes || []).join(", "), continuacion });
      B.push({ tipo: "campo", etiqueta: T.consulta.proximoControl, valor: x.proximoControl, continuacion });
    });
    if (c.consultas?.length && c.consultasTotales > c.consultas.length) {
      B.push({ tipo: "nota", texto: T.consulta.sinNota(c.consultas.length, c.consultasTotales) });
    }
    if (consultasSinConfirmar) B.push({ tipo: "nota", texto: T.consulta.sinConfirmar(consultasSinConfirmar) });
  }

  // 6. Recetas emitidas.
  if (recetas?.length) {
    B.push({ tipo: "seccion", texto: S.recetas });
    recetas.forEach((r, i) => {
      if (i > 0) B.push({ tipo: "separador" });
      const dia = f.dia(r.fechaCivil ? `${r.fechaCivil}T12:00:00Z` : r.fecha);
      const continuacion = T.continuacion(dia);
      B.push({ tipo: "subtitulo", texto: dia, extra: r.origen === "memed" ? T.recetas.memed : "" });
      B.push({ tipo: "lista", items: (r.medicamentos || []).filter(m => m?.nombre).map(m => [m.nombre, m.dosis, m.frecuencia, m.duracion].filter(Boolean).join(" — ")), continuacion });
      B.push({ tipo: "campo", etiqueta: T.recetas.indicaciones, valor: r.indicaciones, continuacion });
    });
  }

  // 7. Estudios con informe firmado.
  if (c.informes?.length) {
    B.push({ tipo: "seccion", texto: S.informes });
    c.informes.forEach((x, i) => {
      if (i > 0) B.push({ tipo: "separador" });
      const titulo = [x.titulo || x.tipo, f.dia(x.fecha)].filter(Boolean).join(" · ");
      const continuacion = T.continuacion(titulo);
      B.push({ tipo: "subtitulo", texto: titulo });
      B.push({ tipo: "campo", etiqueta: T.informes.conclusion, valor: x.conclusion, continuacion });
      B.push({ tipo: "campo", etiqueta: T.informes.recomendaciones, valor: x.recomendaciones, continuacion });
    });
  }

  // 8. Vacunas.
  if (c.vacunas?.length) {
    B.push({ tipo: "seccion", texto: S.vacunas });
    B.push({
      tipo: "tabla",
      columnas: T.vacunas.columnas.map((titulo, i) => ({ titulo, ancho: [0.5, 0.28, 0.22][i] })),
      filas: c.vacunas.map(v => [v.nombre, v.dosis, f.dia(v.fecha)]),
    });
  }

  // 9. Controles y mediciones.
  if (c.mediciones?.length) {
    B.push({ tipo: "seccion", texto: S.mediciones });
    B.push({
      tipo: "tabla",
      columnas: T.mediciones.columnas.map((titulo, i) => ({ titulo, ancho: [0.22, 0.48, 0.30][i] })),
      filas: c.mediciones.map(m => [f.dia(m.fecha), T.mediciones.tipos[m.tipo] || m.tipo, valorMedicion(m, locale)]),
    });
  }

  // 10. Plan de tratamiento.
  if (c.tratamientos?.length) {
    B.push({ tipo: "seccion", texto: S.tratamientos });
    B.push({
      tipo: "tabla",
      columnas: T.tratamientos.columnas.map((titulo, i) => ({ titulo, ancho: [0.6, 0.15, 0.25][i] })),
      filas: c.tratamientos.map(t => [t.nombre, t.piezaFdi ? String(t.piezaFdi) : "", T.tratamientos.estados[t.estado] || t.estado]),
    });
  }

  B.push({ tipo: "espacio", alto: 6 });
  B.push({ tipo: "nota", texto: T.excluye });
  B.push({ tipo: "firma", lineas: [firma.nombre, firma.registro, T.firma] });
  return B;
}

// armarKardexPdf({ contenido, paciente, recetas, consultasSinConfirmar,
//                  medico, membrete, idioma, zonaHoraria, generadoEn }) → Buffer
function armarKardexPdf({ contenido, paciente, recetas = [], consultasSinConfirmar = 0, medico, membrete, idioma, zonaHoraria, generadoEn = new Date(), deEstudiante = false }) {
  const p = perfil(idioma);
  const T = p.kardex;
  const zona = zonaValida(zonaHoraria, p.zonaHoraria);
  const f = formateadores(p.locale, zona);
  const firma = {
    nombre: membrete?.profesionalNombre || medico?.nombre || "",
    registro: registroDe(medico, membrete),
  };
  return generarPdf({
    bloques: bloquesDelKardex({ contenido, paciente, recetas, consultasSinConfirmar, T, f, locale: p.locale, hoy: generadoEn, firma, deEstudiante }),
    encabezado: crearEncabezado({ medico, membrete, paciente, T, generado: f.momento(generadoEn) }),
    pie: crearPie({ membrete, T }),
    imagenes: membrete?.logo ? { logo: membrete.logo } : {},
    info: { titulo: `${T.titulo} — ${paciente.nombre || ""}`, autor: firma.nombre, creado: generadoEn },
  });
}

// Kardex_Natalia_Domingues_2026-10-01.pdf — sin tildes ni espacios: hay
// sistemas (y adjuntos de correo) que se atragantan con ellos.
function nombreArchivo({ idioma, paciente, generadoEn = new Date(), zonaHoraria }) {
  const p = perfil(idioma);
  const zona = zonaValida(zonaHoraria, p.zonaHoraria);
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(generadoEn);
  const nombre = String(paciente?.nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "paciente";
  return `${p.kardex.archivo}_${nombre}_${partes}.pdf`;
}

module.exports = { armarKardexPdf, nombreArchivo, edadEn, zonaValida };
