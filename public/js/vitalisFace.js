// ═══════════════════════════════════════════════════════════════════════════
// VITALIS FACE — Consola de análisis facial
// ═══════════════════════════════════════════════════════════════════════════
//
// Junta en una pantalla lo que hasta ahora estaba repartido: las cinco
// vistas, el mapa anatómico, la simetría, las proporciones, la evolución en
// el tiempo, el antes/después y los procedimientos hechos.
//
// ─── POR QUÉ NO DICE "3D" EN NINGÚN LADO ─────────────────────────────────
// Cinco fotos de una cara no son un modelo tridimensional. Se puede AJUSTAR
// un modelo genérico a esas fotos y mostrarlo girando, y se ve impresionante,
// pero lo que gira ahí es el modelo genérico: la cara del paciente solo le
// prestó la textura. Cuando el paciente pregunta "¿y mi nariz mide eso?", la
// respuesta honesta sería "no, mide eso el modelo".
//
// Acá el giro es 2.5D: cada ángulo es una FOTO del paciente. Menos
// espectacular en una demo y bastante más defendible en una consulta.
//
// ─── POR QUÉ LAS MEDIDAS NO SALEN EN MILÍMETROS SOLAS ────────────────────
// Una foto no trae escala. Dos fotos de la misma cara, una de cerca y otra
// de lejos, dan el mismo píxel para narices de tamaños distintos: sin un
// objeto de tamaño conocido en la imagen, "41,2 mm" es un número inventado
// con una cifra decimal para que parezca medido.
//
// Así que la consola muestra dos cosas distintas y las separa:
//
//   · PROPORCIONES Y ÁNGULOS — no necesitan escala y son correctos siempre.
//     El índice facial, el índice nasal, el ángulo nasofrontal y el
//     nasolabial son adimensionales: una razón entre dos medidas de la misma
//     foto. Y son, además, los números que un cirujano mira de verdad: nadie
//     planifica una rinoplastia por "la nariz mide 41 mm", se planifica por
//     el ángulo nasolabial y la relación con el mentón.
//
//   · MILÍMETROS — solo después de calibrar contra algo de tamaño conocido
//     en la foto. Hasta que eso pase, la columna de mm no existe. No aparece
//     en gris, ni con un asterisco: no aparece.
//
// Prefijo vf* en todo: no hay módulos en este proyecto y las funciones
// sueltas se pisan entre archivos en silencio.

let vf = null;

// ═══ GEOMETRÍA ═════════════════════════════════════════════════════════════
// Las coordenadas vienen normalizadas 0..1 en los DOS ejes, y la foto no es
// cuadrada. Para medir distancias y ángulos hay que volver a píxeles, si no
// una diagonal sale mal y un ángulo sale peor.
function vfPx(p, w, h) { return { x: p.x * w, y: p.y * h }; }
function vfDist(a, b, w, h) { return Math.hypot((b.x - a.x) * w, (b.y - a.y) * h); }

// Ángulo en B, entre A y C, en grados.
function vfAngulo(a, b, c, w, h) {
  const v1 = { x: (a.x - b.x) * w, y: (a.y - b.y) * h };
  const v2 = { x: (c.x - b.x) * w, y: (c.y - b.y) * h };
  const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
  if (!n1 || !n2) return null;
  const cos = (v1.x * v2.x + v1.y * v2.y) / (n1 * n2);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

// Ángulo entre dos rectas (no entre dos segmentos con vértice común).
function vfAnguloEntreRectas(a1, a2, b1, b2, w, h) {
  const v1 = { x: (a2.x - a1.x) * w, y: (a2.y - a1.y) * h };
  const v2 = { x: (b2.x - b1.x) * w, y: (b2.y - b1.y) * h };
  const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
  if (!n1 || !n2) return null;
  const cos = Math.abs(v1.x * v2.x + v1.y * v2.y) / (n1 * n2);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

// ═══ PROPORCIONES DE LA VISTA FRONTAL ══════════════════════════════════════
// Todo lo de acá es una razón entre dos medidas de la MISMA foto, así que la
// distancia a la que se sacó no cambia el resultado. Los rangos normales son
// de antropometría facial clásica (Farkas) y están puestos para leer el
// número, no para diagnosticar con él.
function vfProporciones(lm, base, marco, grupos, w, h) {
  const cent = (idxs) => ({
    x: idxs.reduce((a, i) => a + lm[i].x, 0) / idxs.length,
    y: idxs.reduce((a, i) => a + lm[i].y, 0) / idxs.length,
  });
  const extremo = (idxs, eje, dir) =>
    idxs.reduce((mejor, i) => (dir > 0 ? lm[i][eje] > lm[mejor][eje] : lm[i][eje] < lm[mejor][eje]) ? i : mejor, idxs[0]);

  // Anchura bicigomática: lo más ancho del óvalo facial.
  const izq = extremo(base.ovalo, "x", -1), der = extremo(base.ovalo, "x", 1);
  const anchuraFacial = vfDist(lm[izq], lm[der], w, h);

  // Nasion: el punto hundido entre los ojos. Se aproxima por el punto medio
  // entre los ángulos internos de los dos ojos, que es donde cae.
  const medioX = (lm[izq].x + lm[der].x) / 2;
  const internoDe = (idxs) => idxs.reduce((mejor, i) =>
    Math.abs(lm[i].x - medioX) < Math.abs(lm[mejor].x - medioX) ? i : mejor, idxs[0]);
  const nasion = cent([internoDe(base.ojo_izquierdo), internoDe(base.ojo_derecho)]);

  const menton = { x: marco.menton.x, y: marco.menton.y };
  const alturaFacial = vfDist(nasion, menton, w, h);

  // Nariz: ancho entre los extremos de las alas; alto de nasion al plano de
  // la base alar (subnasal aproximado por el borde inferior de las alas).
  const alas = grupos.alas.length ? grupos.alas : grupos.punta;
  const alaIzq = extremo(alas, "x", -1), alaDer = extremo(alas, "x", 1);
  const anchuraNasal = vfDist(lm[alaIzq], lm[alaDer], w, h);
  const baseAlar = { x: (lm[alaIzq].x + lm[alaDer].x) / 2, y: Math.max(lm[alaIzq].y, lm[alaDer].y) };
  const alturaNasal = vfDist(nasion, baseAlar, w, h);

  const pupIzq = cent(base.ojo_izquierdo), pupDer = cent(base.ojo_derecho);
  const interpupilar = vfDist(pupIzq, pupDer, w, h);

  // Ancho de un ojo, para la regla de los quintos: la cara "entra cinco
  // ojos" a lo ancho.
  const anchoOjo = (idxs) => vfDist(lm[extremo(idxs, "x", -1)], lm[extremo(idxs, "x", 1)], w, h);
  const ojoProm = (anchoOjo(base.ojo_izquierdo) + anchoOjo(base.ojo_derecho)) / 2;

  // Tercio medio (nasion→base alar) contra tercio inferior (base alar→
  // mentón). El tercio superior necesita el nacimiento del pelo, que la foto
  // muchas veces no muestra y el detector nunca da: no se inventa.
  const tercioInferior = vfDist(baseAlar, menton, w, h);

  // Boca y mandíbula, para los paneles de labios y mentón.
  const bocaIzq = extremo(base.labios, "x", -1), bocaDer = extremo(base.labios, "x", 1);
  const anchuraBucal = vfDist(lm[bocaIzq], lm[bocaDer], w, h);
  // Anchura mandibular: lo más ancho del óvalo POR DEBAJO de la boca. Sin ese
  // corte, "el óvalo más ancho" es el pómulo y la mandíbula sale igual que la
  // cara en toda persona.
  const vBoca = Math.max(...base.labios.map(i => lm[i].y));
  const mandi = base.ovalo.filter(i => lm[i].y > vBoca);
  const anchuraMandibular = mandi.length > 1
    ? vfDist(lm[extremo(mandi, "x", -1)], lm[extremo(mandi, "x", 1)], w, h) : null;

  const M = (id, zona, label, valor, opciones) => ({ id, zona, label, valor, ...opciones });

  return {
    puntos: { nasion, menton, baseAlar, pupIzq, pupDer, alaIzq: lm[alaIzq], alaDer: lm[alaDer], sienIzq: lm[izq], sienDer: lm[der] },
    px: { anchuraFacial, alturaFacial, anchuraNasal, alturaNasal, interpupilar,
          tercioMedio: alturaNasal, tercioInferior, anchuraBucal, anchuraMandibular },
    medidas: [
      M("facial", "cara", "Índice facial", alturaFacial / anchuraFacial * 100, {
        normal: [85, 95],
        ayuda: "Alto de la cara sobre su ancho. Menos de 85: cara ancha (euriprosopo); más de 95: cara alargada (leptoprosopo)." }),
      M("tercios", "cara", "Tercio medio / tercio inferior", alturaNasal / (tercioInferior || 1), {
        normal: [0.90, 1.10], decimales: 2,
        ayuda: "Nasion a base de la nariz, contra base de la nariz a mentón. El canon los quiere iguales. El tercio superior necesita el nacimiento del pelo y no se estima." }),
      M("quintos", "cara", "Regla de los quintos", anchuraFacial / (ojoProm || 1), {
        normal: [4.6, 5.4], decimales: 2, sufijo: " ojos",
        ayuda: "Cuántos ojos entran en el ancho de la cara. El canon clásico dice cinco." }),

      M("nasal", "nariz", "Índice nasal", anchuraNasal / alturaNasal * 100, {
        normal: [70, 85],
        ayuda: "Ancho de la nariz sobre su alto. Es la medida que más cambia una rinoplastia de base." }),
      M("narizCara", "nariz", "Ancho nasal / ancho facial", anchuraNasal / anchuraFacial, {
        normal: [0.25, 0.32], decimales: 3,
        ayuda: "La base de la nariz respecto de la cara entera. El canon la quiere del ancho de un ojo." }),

      M("interpupilar", "ojos", "Interpupilar / ancho facial", interpupilar / anchuraFacial, {
        normal: [0.42, 0.50], decimales: 3,
        ayuda: "Separación de los ojos respecto del ancho de la cara." }),
      M("ojoCara", "ojos", "Ancho del ojo / ancho facial", ojoProm / anchuraFacial, {
        normal: [0.18, 0.22], decimales: 3,
        ayuda: "El otro lado de la regla de los quintos, mirado desde el ojo." }),

      M("bocaCara", "labios", "Ancho de boca / ancho facial", anchuraBucal / anchuraFacial, {
        normal: [0.36, 0.45], decimales: 3,
        ayuda: "El canon pone las comisuras a la vertical de las pupilas." }),
      M("bocaNariz", "labios", "Ancho de boca / ancho nasal", anchuraBucal / (anchuraNasal || 1), {
        normal: [1.4, 1.7], decimales: 2,
        ayuda: "Relación boca-nariz, que es lo que se mira cuando se discute agrandar labios." }),

      ...(anchuraMandibular ? [
        M("mandibulaCara", "menton", "Ancho mandibular / bicigomático", anchuraMandibular / anchuraFacial, {
          normal: [0.70, 0.85], decimales: 3,
          ayuda: "Mandíbula contra pómulos. Baja: cara en triángulo; alta: cara cuadrada." }),
      ] : []),

      M("pomuloAltura", "pomulos", "Bicigomático / altura facial", anchuraFacial / (alturaFacial || 1), {
        normal: [1.05, 1.18], decimales: 3,
        ayuda: "Cuánto manda el ancho de los pómulos sobre el alto de la cara." }),
    ],
  };
}

// ═══ SIMETRÍA ══════════════════════════════════════════════════════════════
// Un número, no un semáforo: la diferencia media entre cada punto y su
// espejo respecto de la línea media, como porcentaje del ancho de la cara.
// Es relativo a propósito — en porcentaje del ancho vale igual de cerca que
// de lejos, y en milímetros haría falta calibrar.
function vfSimetria(lm, base, marco, w, h) {
  const cent = (idxs) => idxs.reduce((a, i) => a + lm[i].x, 0) / idxs.length;
  const ejeX = cent(base.ovalo);
  const pares = [];
  const empareja = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) pares.push([a[i], b[i]]);
  };
  empareja(base.ojo_izquierdo, base.ojo_derecho);
  empareja(base.ceja_izquierda, base.ceja_derecha);

  const izq = base.ovalo.filter(i => lm[i].x < ejeX), der = base.ovalo.filter(i => lm[i].x > ejeX);
  const anchura = vfDist(
    lm[base.ovalo.reduce((m, i) => lm[i].x < lm[m].x ? i : m, base.ovalo[0])],
    lm[base.ovalo.reduce((m, i) => lm[i].x > lm[m].x ? i : m, base.ovalo[0])], w, h) || 1;

  let suma = 0, peor = { dif: 0 };
  for (const [a, b] of pares) {
    const dA = Math.abs(lm[a].x - ejeX) * w, dB = Math.abs(lm[b].x - ejeX) * w;
    const dif = Math.abs(dA - dB);
    suma += dif;
    if (dif > peor.dif) peor = { dif, ladoIzquierdoMayor: dA > dB };
  }
  const media = pares.length ? suma / pares.length : 0;
  return {
    // 100 = espejo perfecto. Se acota abajo para que no salga negativo en
    // una foto muy girada.
    indice: Math.max(0, 100 - (media / anchura) * 100 * 4),
    difMediaPorcentaje: (media / anchura) * 100,
    difPeorPorcentaje: (peor.dif / anchura) * 100,
    ladoIzquierdoMayor: peor.ladoIzquierdoMayor,
    pares: pares.length,
  };
}

// ═══ ÁNGULOS DEL PERFIL ════════════════════════════════════════════════════
// Estos son los números que se miran de verdad en una rinoplastia, y ninguno
// necesita escala: son ángulos. Salen de los diez puntos que el cirujano
// marcó sobre la foto de perfil.
//
// Los índices salen por nombre de SF_IDX_PERFIL. Contarlos a mano fue
// exactamente lo que hizo que el nasolabial se calculara desde la punta en
// vez de la columela y diera 147° donde correspondían unos 100°.
function vfAngulosPerfil(p, w, h) {
  const i = typeof SF_IDX_PERFIL === "object" ? SF_IDX_PERFIL : null;
  if (!i || !Array.isArray(p) || p.length !== Object.keys(i).length) return null;
  const P = Object.fromEntries(Object.entries(i).map(([k, idx]) => [k, p[idx]]));
  return [
    { id: "nasofrontal", label: "Ángulo nasofrontal", valor: vfAngulo(P.glabela, P.nasion, P.punta, w, h),
      normal: [115, 130], ayuda: "En el nasion, entre la frente y el dorso. Un ángulo cerrado hace ver la nariz más grande de lo que es." },
    // Columela y labio, NO punta y labio: la punta está mucho más adelante
    // que la columela y el ángulo sale entre 30° y 50° más abierto.
    { id: "nasolabial", label: "Ángulo nasolabial", valor: vfAngulo(P.columela, P.subnasal, P.labioSup, w, h),
      normal: [90, 105], ayuda: "En el subnasal, entre la columela y el labio superior. Es LA medida de la rotación de la punta: 90-95° en varones, 95-105° en mujeres." },
    { id: "nasofacial", label: "Ángulo nasofacial", valor: vfAnguloEntreRectas(P.glabela, P.pogonion, P.nasion, P.punta, w, h),
      normal: [30, 40], ayuda: "Entre el plano facial (glabela a pogonion) y el dorso nasal. Mide cuánto sobresale la nariz respecto de la cara entera." },
    { id: "mentolabial", label: "Ángulo mentolabial", valor: vfAngulo(P.labioInf, P.surco, P.pogonion, w, h),
      normal: [110, 130], ayuda: "En el surco del mentón. Se cierra cuando el mentón está poco proyectado." },
  ].filter(a => Number.isFinite(a.valor));
}

// ═══ ZONAS ANATÓMICAS ══════════════════════════════════════════════════════
// Cada zona filtra qué medidas se muestran. Se discute una zona por vez con
// el paciente —"hablemos de la nariz"— y mostrar las diez a la vez es ruido.
const VF_ZONAS = [
  { id: "cara",    label: "Cara entera", icono: "🙂" },
  { id: "nariz",   label: "Nariz",       icono: "👃" },
  { id: "ojos",    label: "Ojos",        icono: "👁" },
  { id: "labios",  label: "Labios",      icono: "👄" },
  { id: "menton",  label: "Mentón",      icono: "🧏" },
  { id: "pomulos", label: "Pómulos",     icono: "✨" },
];

// Qué controles del simulador toca cada zona. Elegir "Nariz" muestra las
// proporciones de la nariz Y los controles de la nariz: es la misma
// conversación, y tenerla partida en dos pantallas era el problema.
const VF_CONTROLES_ZONA = {
  nariz:   ["dorso", "proyeccionPunta", "rotacionPunta", "anchoAlas"],
  menton:  ["mentonProyeccion", "mentonAltura", "mandibula"],
  pomulos: ["pomulos"],
  labios:  ["labios"],
  ojos:    ["parpadoSuperior"],
  cara:    [],
};

// ═══ LA CONSOLA ════════════════════════════════════════════════════════════
async function vfAbrirConsola(pacienteId) {
  const capa = document.createElement("div");
  capa.id = "vitalisFace";
  capa.className = "vf-capa";
  capa.innerHTML = `<div class="vf-cargando">
    <div class="spinner"></div>
    <div id="vfPaso">Cargando la ficha...</div>
  </div>`;
  document.body.appendChild(capa);
  document.body.style.overflow = "hidden";
  const paso = (t) => { const e = capa.querySelector("#vfPaso"); if (e) e.textContent = t; };

  let datos, tratamientos = [];
  try {
    datos = await api(`/medico/pacientes/${pacienteId}`);
    try { tratamientos = (await api(`/medico/pacientes/${pacienteId}/tratamientos`))?.tratamientos || []; }
    catch { tratamientos = []; }
  } catch (e) {
    capa.innerHTML = vfErrorHtml("No se pudo cargar la ficha: " + esc(e.error || e.message || "error"));
    vfEngancharCerrar(capa);
    return;
  }

  const estudios = (datos.estudios || []).filter(e => e.tipo === "foto");
  paso("Cargando las fotos...");
  const { vistas, ref } = await s25CargarVistas(estudios, paso);

  if (!vistas.length) {
    capa.innerHTML = vfErrorHtml(
      "Esta ficha todavía no tiene fotos con su ángulo. Subilas indicando frontal, "
      + "45° y perfil de cada lado, y la consola se arma sola.");
    vfEngancharCerrar(capa);
    return;
  }

  // El análisis de proporciones sale de la vista detectada más frontal: es la
  // única donde los 468 puntos tienen sentido.
  paso("Midiendo proporciones...");
  const auto = vistas.filter(v => v.modo === "auto").sort((a, b) => Math.abs(a.grados) - Math.abs(b.grados))[0];
  let analisis = null;
  if (auto) {
    const w = auto.img.naturalWidth, h = auto.img.naturalHeight;
    analisis = {
      vista: auto, w, h,
      prop: vfProporciones(auto.landmarks, auto.base, auto.marco, auto.grupos, w, h),
      sim: vfSimetria(auto.landmarks, auto.base, auto.marco, w, h),
    };
  }

  vf = {
    capa, pacienteId, paciente: datos.paciente || {}, estudios, vistas, ref, tratamientos,
    analisis,
    zona: "cara",
    grados: vistas.some(v => v.grados === 0) ? 0 : vistas[0].grados,
    valores: Object.fromEntries(SF_CONTROLES.map(c => [c.id, 0])),
    verOriginal: false,
    simulando: false,
    landmarks: false,
    herramienta: null,      // null | "medir" | "anotar"
    puntosMedida: [],
    medidas: [],            // las que tomó el médico, de esta sesión
    anotaciones: [],
    vistaActual: null,
    motor: null,
  };
  vfRecalcularAngulos();
  vfPintar();
}

// Los ángulos del perfil salen de la vista de perfil que esté marcada.
function vfRecalcularAngulos() {
  const perfil = vf.vistas.find(v => Math.abs(v.grados) === 90 && v.modo === "perfil" && v.marcados);
  vf.perfilAngulos = perfil || null;
  vf.angulos = perfil
    ? vfAngulosPerfil(perfil.marcados, perfil.img.naturalWidth, perfil.img.naturalHeight)
    : null;
}

function vfErrorHtml(msg) {
  return `<div class="vf-cargando" style="max-width:520px;text-align:center">
    <div style="font-size:38px;margin-bottom:12px">🙂</div>
    <div style="line-height:1.6;margin-bottom:20px">${msg}</div>
    <button class="vf-btn" data-cerrar-vf>Cerrar</button>
  </div>`;
}
function vfEngancharCerrar(capa) {
  capa.querySelectorAll("[data-cerrar-vf]").forEach(b => b.onclick = vfCerrarConsola);
}
function vfCerrarConsola() {
  if (vf) s25LiberarVistas(vf.vistas);
  const c = document.getElementById("vitalisFace");
  if (c) c.remove();
  document.body.style.overflow = "";
  vf = null;
}

// ═══ AVISOS ════════════════════════════════════════════════════════════════
function vfAviso(mensaje, tipo = "info") {
  let cont = document.getElementById("vfAvisos");
  if (!cont) {
    cont = document.createElement("div");
    cont.id = "vfAvisos";
    cont.className = "vf-avisos";
    (vf ? vf.capa : document.body).appendChild(cont);
  }
  const el = document.createElement("div");
  el.className = "vf-aviso vf-aviso-" + tipo;
  el.textContent = mensaje;
  cont.appendChild(el);
  requestAnimationFrame(() => el.classList.add("vf-aviso-visible"));
  setTimeout(() => {
    el.classList.remove("vf-aviso-visible");
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

// ═══ FORMATO DE UNA MEDIDA ═════════════════════════════════════════════════
// Fuera de rango se marca en ámbar y nada más. La primera versión escribía
// "fuera del canon" al lado de cada uno, y sobre la cara de una persona
// concreta eso se lee como una lista de defectos: seis de nueve renglones
// acusando a alguien de no ser el promedio. Los rangos son de antropometría
// descriptiva —de dónde cae la mayoría—, no de dónde habría que estar.
function vfFilaMedidaHtml(m) {
  const v = m.valor;
  const fuera = m.normal && (v < m.normal[0] || v > m.normal[1]);
  const esAngulo = m.grados;
  const dec = m.decimales !== undefined ? m.decimales : (esAngulo ? 1 : 1);
  const texto = (esAngulo ? v.toFixed(1) + "°" : v.toFixed(dec) + (m.sufijo || ""));
  const rango = m.normal
    ? `${m.normal[0]}–${m.normal[1]}${esAngulo ? "°" : ""}`
    : "";
  return `
    <div class="vf-medida${fuera ? " vf-medida-fuera" : ""}">
      <div class="vf-medida-fila">
        <span class="vf-medida-label">${esc(m.label)}</span>
        <span class="vf-medida-valor">${texto}</span>
      </div>
      ${rango ? `<div class="vf-medida-rango">referencia ${rango}</div>` : ""}
      ${m.ayuda ? `<div class="vf-medida-ayuda">${esc(m.ayuda)}</div>` : ""}
    </div>`;
}

// ═══ LA PANTALLA ═══════════════════════════════════════════════════════════
function vfPintar() {
  const { capa, paciente, vistas, analisis } = vf;
  const minG = Math.min(...vistas.map(v => v.grados));
  const maxG = Math.max(...vistas.map(v => v.grados));

  capa.innerHTML = `
    <div class="vf-shell">

      <aside class="vf-lateral">
        <div class="vf-marca">
          <div class="vf-marca-icono">V</div>
          <div>
            <div class="vf-marca-nombre">VITALIS FACE</div>
            <div class="vf-marca-sub">Análisis facial 2.5D</div>
          </div>
        </div>

        <div class="vf-paciente">
          <div class="vf-paciente-tit">Paciente</div>
          <div class="vf-paciente-nombre">${esc(paciente.nombre || "Paciente")}</div>
          <div class="vf-paciente-datos">
            ${paciente.codigo ? esc(paciente.codigo) : ""}${paciente.codigo && paciente.fechaNacimiento ? " · " : ""}${paciente.fechaNacimiento ? vfEdad(paciente.fechaNacimiento) : ""}
          </div>
        </div>

        <div class="vf-lateral-seccion">
          <div class="vf-lateral-tit">Vistas cargadas</div>
          <div class="vf-tira">
            ${vistas.map(v => `
              <button class="vf-tira-item${v.grados === vf.grados ? " vf-tira-activa" : ""}" data-ir="${v.grados}">
                <div class="vf-tira-foto">${v.url ? `<img src="${v.url}" alt="">` : ""}</div>
                <span>${esc(v.label)}</span>
                ${v.modo === "sinMarcar" ? `<i class="vf-tira-punto" title="sin marcar"></i>` : ""}
              </button>`).join("")}
          </div>
          <p class="vf-nota">
            ${vistas.length} de 5. El giro recorre estas fotos: no hay un modelo tridimensional
            atrás, y por eso cada ángulo es la cara del paciente y no una aproximación.
          </p>
        </div>

        <div class="vf-lateral-seccion">
          <div class="vf-lateral-tit">Procedimientos</div>
          ${vf.tratamientos.length ? `
            <div class="vf-proc-lista">
              ${vf.tratamientos.slice(0, 8).map(t => `
                <div class="vf-proc">
                  <div class="vf-proc-nombre">${esc(t.nombre)}</div>
                  <div class="vf-proc-meta">
                    ${new Date(t.createdAt).toLocaleDateString("es-BO")}${t.regionFacial ? " · " + esc(t.regionFacial) : ""}
                    · ${esc({ pendiente: "pendiente", en_proceso: "en proceso", realizado: "realizado" }[t.estado] || t.estado)}
                  </div>
                </div>`).join("")}
            </div>`
            : `<p class="vf-nota">Todavía no hay procedimientos cargados.</p>`}
        </div>

        <button class="vf-btn vf-btn-borde" data-cerrar-vf>← Volver a la ficha</button>
      </aside>

      <main class="vf-principal">
        <header class="vf-cabecera">
          <div>
            <h1>Vitalis Face 2.5D</h1>
            <p>Cada ángulo es una fotografía real del paciente</p>
          </div>
          <div class="vf-cabecera-acciones">
            <button class="vf-btn" id="vfSimulador">✨ Abrir simulador</button>
            <button class="vf-btn vf-btn-primario" id="vfGuardar">Guardar esta vista</button>
          </div>
        </header>

        <section class="vf-visor-caja">
          <div class="vf-barra">
            <div class="vf-barra-grupo">
              <button class="vf-chip" id="vfBtnLandmarks">◦ Puntos</button>
              <button class="vf-chip" id="vfBtnSimular">✨ Simular</button>
              <button class="vf-chip" id="vfBtnComparar">👁 Ver original</button>
              <button class="vf-chip" id="vfBtnMedir">📏 Medir recto</button>
              <button class="vf-chip" id="vfBtnContorno">〰️ Medir por el borde</button>
              <button class="vf-chip" id="vfBtnAnotar">✎ Anotar</button>
              <button class="vf-chip" id="vfBtnLimpiar">↺ Limpiar</button>
            </div>
            <span class="vf-vista-nombre" id="vfNombreVista"></span>
          </div>

          <div class="vf-visor" id="vfVisor">
            <canvas id="vfLienzo"></canvas>
            <canvas id="vfCapaDibujo"></canvas>
            <div class="vf-etiqueta" id="vfEtiqueta"></div>
            <div class="vf-sello">SIMULACIÓN — NO ES UNA PROMESA DE RESULTADO</div>
          </div>

          <div class="vf-aviso-marcar" id="vfAvisoMarcar" style="display:none">
            La vista <b></b> no está marcada: se ve la foto original, sin la simulación encima.
            <a href="#" id="vfMarcarActual">Marcarla ahora</a>
          </div>

          <div class="vf-giro">
            <div class="vf-giro-presets">
              ${vistas.map(v => `<button data-ir="${v.grados}" class="${v.grados === vf.grados ? "vf-preset-activo" : ""}">${esc(v.label)}</button>`).join("")}
            </div>
            <div class="vf-giro-barra">
              <button class="vf-btn-redondo" id="vfMenos">◀</button>
              <input type="range" id="vfGiro" min="${minG}" max="${maxG}" step="1" value="${vf.grados}">
              <button class="vf-btn-redondo" id="vfMas">▶</button>
            </div>
            <div class="vf-giro-pie">
              <span id="vfGiroVal">${vf.grados}°</span>
              <span>Arrastrá sobre la foto para girar</span>
            </div>
          </div>
        </section>
      </main>

      <aside class="vf-metricas">
        <div class="vf-zonas">
          ${VF_ZONAS.map(z => `
            <button class="vf-zona${z.id === vf.zona ? " vf-zona-activa" : ""}" data-zona="${z.id}">
              <span>${z.icono}</span>${esc(z.label)}
            </button>`).join("")}
        </div>

        ${analisis ? `
          <div class="vf-panel">
            <div class="vf-panel-tit">${esc(VF_ZONAS.find(z => z.id === vf.zona).label)}</div>
            ${vfMedidasDeZona().map(m => vfFilaMedidaHtml(m)).join("") ||
              `<p class="vf-nota">No hay proporciones propias de esta zona en una vista frontal.</p>`}
            ${vf.zona === "nariz" || vf.zona === "menton" ? vfBloqueAngulosHtml() : ""}
            ${vfBloqueControlesHtml()}
            <p class="vf-nota vf-nota-borde">
              Razones y ángulos: no dependen de a qué distancia se sacó la foto, así que son
              correctos sin calibrar. Los rangos de referencia dicen dónde cae la mayoría de
              las caras medidas, no dónde habría que estar.
            </p>
          </div>

          <div class="vf-panel">
            <div class="vf-panel-tit">Milímetros</div>
            ${vfBloqueMilimetrosHtml()}
          </div>

          <div class="vf-panel">
            <div class="vf-panel-tit">Simetría</div>
            <div class="vf-sim-numero">
              ${analisis.sim.indice.toFixed(1)}<span>/100</span>
            </div>
            <p class="vf-nota">
              Diferencia media entre cada punto y su espejo: ${analisis.sim.difMediaPorcentaje.toFixed(2)}%
              del ancho de la cara; la mayor, ${analisis.sim.difPeorPorcentaje.toFixed(2)}%, con el lado
              ${analisis.sim.ladoIzquierdoMayor ? "izquierdo" : "derecho"} más prominente.
              Va en porcentaje y no en milímetros a propósito: en porcentaje vale igual de cerca
              que de lejos.
            </p>
            <p class="vf-nota">
              Ninguna cara es simétrica. El número sirve para comparar esta cara consigo misma
              antes y después, no con otra persona.
            </p>
            <button class="vf-btn vf-btn-borde" id="vfVerSimetria">Ver mapa de simetría</button>
          </div>
        ` : `
          <div class="vf-panel">
            <p class="vf-nota">
              No se detectó una cara en ninguna vista, así que no hay proporciones.
              El detector necesita una frontal con los dos ojos visibles, sin lentes ni gorra.
            </p>
          </div>`}

        ${vf.medidas.length ? `
          <div class="vf-panel">
            <div class="vf-panel-tit">Medido a mano</div>
            ${vf.medidas.map((m, i) => `
              <div class="vf-medida">
                <div class="vf-medida-fila">
                  <span class="vf-medida-label">${esc(m.vista)} · ${m.porContorno ? "por el borde" : "recta"}</span>
                  <span class="vf-medida-valor">${esc(m.texto)}</span>
                </div>
              </div>`).join("")}
            <p class="vf-nota">De esta sesión: no quedan guardadas en la ficha.</p>
          </div>` : ""}
      </aside>
    </div>
    <div class="vf-avisos" id="vfAvisos"></div>`;

  vfEngancharCerrar(capa);
  vfMontarVisor();
  vfEnganchar();
}

function vfEdad(fecha) {
  const n = new Date(fecha);
  if (isNaN(n)) return "";
  const hoy = new Date();
  let a = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) a--;
  return a + " años";
}

function vfMedidasDeZona() {
  if (!vf.analisis) return [];
  return vf.analisis.prop.medidas.filter(m => m.zona === vf.zona);
}

function vfBloqueAngulosHtml() {
  const zona = vf.zona;
  const deZona = { nariz: ["nasofrontal", "nasolabial", "nasofacial"], menton: ["mentolabial"] }[zona] || [];
  if (vf.angulos) {
    const filas = vf.angulos.filter(a => deZona.includes(a.id));
    if (!filas.length) return "";
    return `<div class="vf-subtit">Ángulos del perfil</div>`
      + filas.map(a => vfFilaMedidaHtml({ ...a, grados: true })).join("");
  }
  const perfil = vfPerfilAMarcar();
  return `
    <div class="vf-callout">
      Los ángulos del perfil —nasofrontal, nasolabial, nasofacial— son los que de verdad
      se miran en una rinoplastia, y no necesitan calibración.
      Para calcularlos hay que marcar el perfil una vez.
      <a href="#" id="vfMarcarPerfil">Marcar ${esc(perfil ? perfil.label.toLowerCase() : "el perfil")} ahora</a>
    </div>`;
}

// Los controles del simulador de la zona que se está mirando. Aparecen solo
// con la simulación encendida: mientras se están leyendo proporciones, unos
// deslizadores al lado invitan a confundir lo medido con lo imaginado.
function vfBloqueControlesHtml() {
  const ids = VF_CONTROLES_ZONA[vf.zona] || [];
  if (!ids.length) {
    return vf.simulando
      ? `<p class="vf-nota vf-nota-borde">Elegí una zona —nariz, mentón, pómulos, labios u ojos— para ver sus controles.</p>`
      : "";
  }
  if (!vf.simulando) {
    return `<button class="vf-btn vf-btn-borde" id="vfActivarSim">✨ Simular sobre esta zona</button>`;
  }
  const ctrls = SF_CONTROLES.filter(c => ids.includes(c.id));
  return `
    <div class="vf-subtit">Simulación</div>
    ${ctrls.map(c => `
      <div class="vf-control">
        <div class="vf-control-fila">
          <span>${esc(c.label)}</span>
          <span id="vfval-${c.id}">${vf.valores[c.id]}</span>
        </div>
        <input type="range" data-ctrl-vf="${c.id}" min="-100" max="100" step="1" value="${vf.valores[c.id]}">
        <div class="vf-medida-ayuda">${esc(c.ayuda || "")}</div>
      </div>`).join("")}
    <div class="vf-callout">
      Los rangos están acotados a lo quirúrgicamente plausible. Una simulación es una
      herramienta para entenderse con el paciente, no un resultado garantizado.
    </div>`;
}

function vfBloqueMilimetrosHtml() {
  const a = vf.analisis;
  const cal = a.vista.estudio.calibracion;
  if (!cal || !cal.mmPorPixel) {
    return `
      <p class="vf-nota">
        Todavía no hay milímetros, y no los va a haber inventados. Una foto no trae escala:
        la misma nariz, de cerca y de lejos, ocupa distinta cantidad de píxeles.
      </p>
      <button class="vf-btn vf-btn-borde" id="vfCalibrar">📏 Calibrar con una referencia</button>
      <p class="vf-nota">
        Sirve una regla, una tarjeta apoyada en la mejilla, o cualquier objeto de tamaño
        conocido, siempre que esté a la misma distancia de la cámara que la cara.
      </p>`;
  }
  const mm = (px) => (px * cal.mmPorPixel).toFixed(1) + " mm";
  const filas = [
    ["Anchura facial (bicigomática)", a.prop.px.anchuraFacial],
    ["Altura facial (nasion–mentón)", a.prop.px.alturaFacial],
    ["Anchura nasal", a.prop.px.anchuraNasal],
    ["Altura nasal", a.prop.px.alturaNasal],
    ["Distancia interpupilar", a.prop.px.interpupilar],
    ["Ancho de boca", a.prop.px.anchuraBucal],
  ];
  return `
    ${filas.map(([l, px]) => `
      <div class="vf-medida">
        <div class="vf-medida-fila">
          <span class="vf-medida-label">${esc(l)}</span>
          <span class="vf-medida-valor vf-mm">${mm(px)}</span>
        </div>
      </div>`).join("")}
    <p class="vf-nota">Calibrado con: ${esc(cal.referencia || "referencia manual")}.
      <a href="#" id="vfCalibrar">Volver a calibrar</a></p>
    <div class="vf-callout">
      Válido solo para lo que esté en el mismo plano que la referencia. Una cara es curva:
      lo que está más cerca de la cámara sale más grande.
    </div>`;
}

// ═══ EL VISOR ══════════════════════════════════════════════════════════════
function vfMontarVisor() {
  const { capa, vistas, ref } = vf;
  const lienzo = capa.querySelector("#vfLienzo");
  const refImg = (vistas.find(v => v.esReferencia) || vistas[0]).img;

  let motor;
  try {
    motor = s25Motor(lienzo, vistas, ref);
  } catch (e) {
    capa.querySelector("#vfVisor").innerHTML =
      `<p class="vf-nota" style="padding:20px">Este navegador no puede mostrar el visor: ${esc(e.message)}</p>`;
    return;
  }
  vf.motor = motor;
  const r = motor.recorte;
  lienzo.width = Math.max(16, Math.round(refImg.naturalWidth * (r.x1 - r.x0)));
  lienzo.height = Math.max(16, Math.round(refImg.naturalHeight * (r.y1 - r.y0)));

  // La capa de anotaciones se dimensiona por lo que se VE, no por la
  // resolución de la foto. Antes copiaba el tamaño interno del lienzo (520 px
  // de ancho en un recorte típico) mientras la foto se mostraba al 40%: una
  // etiqueta de 13 px de lienzo salía de 5 px en pantalla, ilegible.
  const dibujo = capa.querySelector("#vfCapaDibujo");
  vfAjustarCapaDibujo();
  if (vf.observador) vf.observador.disconnect();
  vf.observador = new ResizeObserver(() => { vfAjustarCapaDibujo(); vfDibujarCapa(); });
  vf.observador.observe(lienzo);

  vfRender();
}

// Tamaño de la capa de dibujo = tamaño en pantalla del lienzo, por la
// densidad del display para que no salga borrosa.
function vfAjustarCapaDibujo() {
  const lienzo = vf.capa.querySelector("#vfLienzo");
  const dibujo = vf.capa.querySelector("#vfCapaDibujo");
  if (!lienzo || !dibujo) return;
  const r = lienzo.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  dibujo.width = Math.round(r.width * dpr);
  dibujo.height = Math.round(r.height * dpr);
  dibujo.style.width = r.width + "px";
  dibujo.style.height = r.height + "px";
}

function vfRender() {
  if (!vf.motor) return;
  const valores = vf.simulando ? vf.valores : Object.fromEntries(SF_CONTROLES.map(c => [c.id, 0]));
  vf.vistaActual = vf.motor.render(vf.grados, valores, vf.verOriginal);
  vfDibujarCapa();
  vfActualizarPie();
}

function vfActualizarPie() {
  const v = vf.vistaActual;
  const nom = vf.capa.querySelector("#vfNombreVista");
  if (nom) nom.textContent = v ? v.label : "";
  const et = vf.capa.querySelector("#vfEtiqueta");
  if (et) {
    et.textContent = vf.verOriginal ? "ORIGINAL" : (vf.simulando ? "SIMULADO" : "");
    et.style.display = et.textContent ? "" : "none";
  }
  const aviso = vf.capa.querySelector("#vfAvisoMarcar");
  if (aviso) {
    const sinMarcar = v && v.modo === "sinMarcar";
    aviso.style.display = sinMarcar ? "" : "none";
    if (sinMarcar) aviso.querySelector("b").textContent = v.label;
  }
  const sello = vf.capa.querySelector(".vf-sello");
  if (sello) sello.style.display = vf.simulando && !vf.verOriginal ? "" : "none";

  // Medir por el borde solo existe donde hay borde: al girar a una vista sin
  // marcar, el botón se apaga en vez de dejar hacer clics que no miden nada.
  const btnCont = vf.capa.querySelector("#vfBtnContorno");
  if (btnCont) {
    const hay = Boolean(v && vfContornoDe(v));
    btnCont.disabled = !hay;
    btnCont.title = hay ? "" : "Hace falta un perfil marcado en esta vista";
    if (!hay && vf.herramienta === "contorno") {
      vf.herramienta = null;
      btnCont.classList.remove("vf-chip-activo");
    }
  }
}

// Del lienzo a las coordenadas propias de la foto que se está viendo, que es
// donde las distancias significan algo: cada vista tiene su escala y su
// calibración, y medir en el lienzo compuesto mezclaría las dos.
function vfDelLienzoALaVista(u, v, vista) {
  const r = vf.motor.recorte;
  const { s, dx, dy } = s25Encuadre(vista, vf.ref);
  const xRef = r.x0 + u * (r.x1 - r.x0);
  const yRef = r.y0 + v * (r.y1 - r.y0);
  return { x: (xRef - dx) / s, y: (yRef - dy) / s };
}
function vfDeLaVistaAlLienzo(p, vista) {
  const r = vf.motor.recorte;
  const { s, dx, dy } = s25Encuadre(vista, vf.ref);
  return {
    u: (p.x * s + dx - r.x0) / (r.x1 - r.x0),
    v: (p.y * s + dy - r.y0) / (r.y1 - r.y0),
  };
}

// El contorno denso del perfil marcado: los mismos puntos que deforma la
// malla, densificados con la spline. Es lo que permite medir SIGUIENDO la
// silueta en vez de en línea recta.
function vfContornoDe(vista) {
  if (vista.modo !== "perfil" || !vista.marcados) return null;
  if (!vista.__contorno) vista.__contorno = sfSuavizar(vista.marcados, 14);
  return vista.__contorno;
}

// Índice del punto del contorno más cercano a p.
function vfIndiceEnContorno(contorno, p, w, h) {
  let mejor = 0, d2 = Infinity;
  for (let i = 0; i < contorno.length; i++) {
    const dx = (contorno[i].x - p.x) * w, dy = (contorno[i].y - p.y) * h;
    const d = dx * dx + dy * dy;
    if (d < d2) { d2 = d; mejor = i; }
  }
  return mejor;
}

// Largo del contorno entre dos índices, sumando tramo a tramo. Es la
// diferencia con la línea recta: en una nariz con giba, el dorso mide más de
// lo que mide la cuerda entre sus extremos, y es el dorso lo que se opera.
function vfLargoContorno(contorno, i, j, w, h) {
  const [a, b] = i <= j ? [i, j] : [j, i];
  let largo = 0;
  for (let k = a; k < b; k++) {
    largo += Math.hypot((contorno[k + 1].x - contorno[k].x) * w,
                        (contorno[k + 1].y - contorno[k].y) * h);
  }
  return largo;
}

function vfDibujarCapa() {
  const c = vf.capa.querySelector("#vfCapaDibujo");
  if (!c || c.width < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  // A partir de acá se dibuja en píxeles de PANTALLA: un texto de 14 mide 14.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = c.width / dpr, H = c.height / dpr;

  const vista = vf.vistaActual;
  if (!vista) return;
  const aPantalla = (p) => {
    const q = vfDeLaVistaAlLienzo(p, vista);
    return { x: q.u * W, y: q.v * H };
  };

  if (vf.landmarks) {
    ctx.fillStyle = "rgba(45,212,191,.9)";
    const puntos = vista.modo === "auto" ? vista.landmarks
      : vista.modo === "perfil" ? vista.marcados : [];
    const radio = Math.max(1, W * 0.005);
    for (const p of puntos) {
      const q = aPantalla(p);
      ctx.beginPath(); ctx.arc(q.x, q.y, radio, 0, Math.PI * 2); ctx.fill();
    }
    const contorno = vfContornoDe(vista);
    if (contorno) {
      ctx.beginPath();
      contorno.forEach((p, i) => {
        const q = aPantalla(p);
        i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = "rgba(45,212,191,.75)";
      ctx.lineWidth = Math.max(1.5, W * 0.006);
      ctx.stroke();
    }
  }

  const grosor = Math.max(2, W * 0.008);
  const tam = Math.max(13, Math.round(W * 0.05));
  const etiqueta = (texto, x, y, color) => {
    ctx.font = `600 ${tam}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const ancho = ctx.measureText(texto).width;
    ctx.fillStyle = "rgba(0,0,0,.72)";
    ctx.fillRect(x - ancho / 2 - 6, y - tam * 0.72, ancho + 12, tam * 1.44);
    ctx.fillStyle = color;
    ctx.fillText(texto, x, y);
  };

  for (const m of vf.medidas.filter(m => m.angulo === vista.grados)) {
    ctx.strokeStyle = "#2dd4bf"; ctx.lineWidth = grosor;
    ctx.beginPath();
    if (m.camino && m.camino.length > 1) {
      m.camino.forEach((p, i) => {
        const q = aPantalla(p);
        i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      });
    } else {
      const a = aPantalla(m.a), b = aPantalla(m.b);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = "#2dd4bf";
    for (const p of [m.a, m.b]) {
      const q = aPantalla(p);
      ctx.beginPath(); ctx.arc(q.x, q.y, grosor * 1.3, 0, Math.PI * 2); ctx.fill();
    }
    const medio = m.camino && m.camino.length > 1
      ? aPantalla(m.camino[Math.floor(m.camino.length / 2)])
      : { x: (aPantalla(m.a).x + aPantalla(m.b).x) / 2, y: (aPantalla(m.a).y + aPantalla(m.b).y) / 2 };
    etiqueta(m.texto, medio.x, medio.y - tam, "#7ff3dd");
  }

  for (const p of vf.puntosMedida) {
    const q = aPantalla(p);
    ctx.fillStyle = "#2dd4bf";
    ctx.beginPath(); ctx.arc(q.x, q.y, grosor * 1.3, 0, Math.PI * 2); ctx.fill();
  }

  for (const a of vf.anotaciones.filter(a => a.angulo === vista.grados)) {
    const q = aPantalla(a);
    ctx.strokeStyle = "#c084fc"; ctx.lineWidth = grosor;
    ctx.beginPath(); ctx.arc(q.x, q.y, grosor * 3.5, 0, Math.PI * 2); ctx.stroke();
    if (a.texto) etiqueta(a.texto, q.x, q.y - grosor * 6, "#e9d5ff");
  }
}

// ═══ INTERACCIÓN ═══════════════════════════════════════════════════════════
function vfEnganchar() {
  const { capa } = vf;

  const irA = (g) => {
    const sl = capa.querySelector("#vfGiro");
    vf.grados = Math.max(Number(sl.min), Math.min(Number(sl.max), Math.round(g)));
    sl.value = String(vf.grados);
    capa.querySelector("#vfGiroVal").textContent = vf.grados + "°";
    capa.querySelectorAll(".vf-giro-presets [data-ir]").forEach(b =>
      b.classList.toggle("vf-preset-activo", Number(b.dataset.ir) === vf.grados));
    capa.querySelectorAll(".vf-tira-item").forEach(b =>
      b.classList.toggle("vf-tira-activa", Number(b.dataset.ir) === vf.grados));
    vfRender();
  };
  capa.querySelector("#vfGiro").oninput = (e) => irA(Number(e.target.value));
  capa.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => irA(Number(b.dataset.ir)));
  capa.querySelector("#vfMenos").onclick = () => irA(vf.grados - 45);
  capa.querySelector("#vfMas").onclick = () => irA(vf.grados + 45);

  // Arrastrar sobre la foto para girar — pero solo cuando no hay una
  // herramienta activa, si no cada intento de medir movería la cabeza.
  const visor = capa.querySelector("#vfVisor");
  let arrastre = null;
  visor.onpointerdown = (ev) => {
    if (vf.herramienta) { vfClicHerramienta(ev); return; }
    arrastre = { x: ev.clientX, g: vf.grados };
    visor.setPointerCapture(ev.pointerId);
  };
  visor.onpointermove = (ev) => {
    if (!arrastre) return;
    const sl = capa.querySelector("#vfGiro");
    const rango = Number(sl.max) - Number(sl.min);
    irA(arrastre.g + (ev.clientX - arrastre.x) / visor.getBoundingClientRect().width * rango);
  };
  visor.onpointerup = () => { arrastre = null; };
  visor.onpointercancel = () => { arrastre = null; };

  capa.querySelectorAll("[data-zona]").forEach(b => b.onclick = () => {
    vf.zona = b.dataset.zona;
    vfPintar();
  });

  const btnL = capa.querySelector("#vfBtnLandmarks");
  btnL.onclick = () => {
    vf.landmarks = !vf.landmarks;
    btnL.classList.toggle("vf-chip-activo", vf.landmarks);
    vfDibujarCapa();
  };

  const btnS = capa.querySelector("#vfBtnSimular");
  const alternarSim = () => {
    vf.simulando = !vf.simulando;
    if (!vf.simulando) vf.verOriginal = false;
    vfPintar();
    vfAviso(vf.simulando
      ? "Simulación encendida: los cambios se ven en todos los ángulos."
      : "Simulación apagada. Volvés a ver las fotos como son.");
  };
  btnS.onclick = alternarSim;
  btnS.classList.toggle("vf-chip-activo", vf.simulando);
  const activar = capa.querySelector("#vfActivarSim");
  if (activar) activar.onclick = alternarSim;

  capa.querySelectorAll("[data-ctrl-vf]").forEach(sl => {
    sl.oninput = () => {
      vf.valores[sl.dataset.ctrlVf] = Number(sl.value);
      const et = capa.querySelector("#vfval-" + sl.dataset.ctrlVf);
      if (et) et.textContent = sl.value;
      vfRender();
    };
  });

  const btnC = capa.querySelector("#vfBtnComparar");
  btnC.disabled = !vf.simulando;
  btnC.textContent = vf.verOriginal ? "👁 Ver simulación" : "👁 Ver original";
  btnC.onclick = () => {
    vf.verOriginal = !vf.verOriginal;
    btnC.textContent = vf.verOriginal ? "👁 Ver simulación" : "👁 Ver original";
    vfRender();
  };

  const herramienta = (id, nombre, aviso) => {
    const b = capa.querySelector(id);
    b.onclick = () => {
      vf.herramienta = vf.herramienta === nombre ? null : nombre;
      vf.puntosMedida = [];
        capa.querySelectorAll("#vfBtnMedir,#vfBtnContorno,#vfBtnAnotar")
        .forEach(x => x.classList.remove("vf-chip-activo"));
      if (vf.herramienta === nombre) { b.classList.add("vf-chip-activo"); vfAviso(aviso); }
      visor.style.cursor = vf.herramienta ? "crosshair" : "grab";
      vfDibujarCapa();
    };
  };
  herramienta("#vfBtnMedir", "medir", "Marcá dos puntos: la medida va en línea recta.");
  herramienta("#vfBtnContorno", "contorno",
    "Marcá dos puntos del perfil: la medida sigue la silueta, no la cuerda.");
  herramienta("#vfBtnAnotar", "anotar", "Tocá donde quieras dejar una marca.");

  // Medir por el borde solo tiene sentido donde hay un borde marcado.
  const btnCont = capa.querySelector("#vfBtnContorno");
  const hayContorno = vf.vistaActual && vfContornoDe(vf.vistaActual);
  btnCont.disabled = !hayContorno;
  btnCont.title = hayContorno ? "" : "Hace falta un perfil marcado en esta vista";

  capa.querySelector("#vfBtnLimpiar").onclick = () => {
    const g = vf.vistaActual ? vf.vistaActual.grados : null;
    vf.medidas = vf.medidas.filter(m => m.angulo !== g);
    vf.anotaciones = vf.anotaciones.filter(a => a.angulo !== g);
    vf.puntosMedida = [];
    vfPintar();
  };

  capa.querySelector("#vfSimulador").onclick = () => abrirSimulador25D(vf.pacienteId, vf.estudios);
  capa.querySelector("#vfGuardar").onclick = vfGuardarVista;

  const marcarActual = capa.querySelector("#vfMarcarActual");
  if (marcarActual) marcarActual.onclick = (ev) => {
    ev.preventDefault();
    vfMarcarVista(vf.vistaActual);
  };
  const marcarPerfil = capa.querySelector("#vfMarcarPerfil");
  if (marcarPerfil) marcarPerfil.onclick = (ev) => {
    ev.preventDefault();
    vfMarcarVista(vfPerfilAMarcar());
  };

  const cal = capa.querySelector("#vfCalibrar");
  if (cal) cal.onclick = (ev) => { ev.preventDefault(); vfCalibrar(); };

  const sim = capa.querySelector("#vfVerSimetria");
  if (sim) sim.onclick = vfVerSimetria;
}

function vfClicHerramienta(ev) {
  const c = vf.capa.querySelector("#vfCapaDibujo");
  const rect = c.getBoundingClientRect();
  const u = (ev.clientX - rect.left) / rect.width;
  const v = (ev.clientY - rect.top) / rect.height;
  const vista = vf.vistaActual;
  if (!vista) return;
  const p = vfDelLienzoALaVista(u, v, vista);

  if (vf.herramienta === "anotar") {
    vf.anotaciones.push({ ...p, angulo: vista.grados, texto: "Zona de interés" });
    vfDibujarCapa();
    return;
  }

  const porContorno = vf.herramienta === "contorno";
  const contorno = porContorno ? vfContornoDe(vista) : null;
  if (porContorno && !contorno) {
    vfAviso("Esta vista no tiene el perfil marcado: no hay borde que seguir.", "ambar");
    return;
  }

  vf.puntosMedida.push(porContorno
    // Al medir por el borde, el punto se pega al contorno: si no, el largo
    // arrancaría a un centímetro de la piel y el número saldría corto.
    ? { ...contorno[vfIndiceEnContorno(contorno, p, vista.img.naturalWidth, vista.img.naturalHeight)] }
    : p);
  if (vf.puntosMedida.length < 2) { vfDibujarCapa(); return; }

  const [a, b] = vf.puntosMedida;
  vf.puntosMedida = [];
  const W = vista.img.naturalWidth, H = vista.img.naturalHeight;

  let px, camino = null;
  if (porContorno) {
    const i = vfIndiceEnContorno(contorno, a, W, H);
    const j = vfIndiceEnContorno(contorno, b, W, H);
    px = vfLargoContorno(contorno, i, j, W, H);
    camino = contorno.slice(Math.min(i, j), Math.max(i, j) + 1);
  } else {
    px = vfDist(a, b, W, H);
  }

  const cal = vista.estudio && vista.estudio.calibracion;
  // Con calibración, milímetros. Sin ella, porcentaje de la altura
  // nariz-mentón de ESTA vista, que es una referencia que la foto sí trae.
  // Lo que no va a pasar nunca es que salga un número en mm sin escala.
  let texto;
  if (cal && cal.mmPorPixel) {
    texto = (px * cal.mmPorPixel).toFixed(1) + " mm";
  } else if (vista.ancla) {
    const alto = vfDist(vista.ancla.punta, vista.ancla.menton, W, H);
    texto = (px / alto * 100).toFixed(0) + "% nariz–mentón";
  } else {
    texto = Math.round(px) + " px";
  }
  vf.medidas.push({ a, b, camino, angulo: vista.grados, vista: vista.label,
                    texto, porContorno });
  vfPintar();
  if (!(cal && cal.mmPorPixel)) {
    vfAviso("Sin calibrar: la medida va en % de la altura nariz–mentón, no en mm.", "ambar");
  }
}

// ═══ MARCAR UNA VISTA ══════════════════════════════════════════════════════
function vfPerfilAMarcar() {
  const perfiles = vf.vistas.filter(v => Math.abs(v.grados) === 90 && v.img);
  return perfiles.find(v => v.grados === vf.grados) || perfiles[0] || null;
}

function vfMarcarVista(vista) {
  if (!vista || !vista.img) {
    vfAviso("No hay una foto de perfil cargada.", "ambar");
    return;
  }
  const capa = document.createElement("div");
  capa.style.cssText = "position:fixed;inset:0;background:#16161c;z-index:9800;overflow-y:auto";
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();

  sfPantallaMarcado(capa, vista.img, async (marcados) => {
    cerrar();
    vista.marcados = marcados;
    vista.modo = "perfil";
    vista.malla = sfMallaPerfil(marcados, vista.img.naturalHeight / vista.img.naturalWidth);
    vista.ancla = s25Ancla(vista);
    vista.estudio.perfilMarcado = marcados.map(p => ({ x: p.x, y: p.y }));
    try {
      await api(`/medico/estudios/${vista.estudio._id}/visor`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfilMarcado: vista.estudio.perfilMarcado }),
      });
      vfAviso("Perfil marcado y guardado en la ficha.");
    } catch { vfAviso("Marcado, pero no se pudo guardar en la ficha.", "ambar"); }
    vfRecalcularAngulos();
    vf.grados = vista.grados;
    vfPintar();
  });
  capa.querySelectorAll("[data-cerrar-simu]").forEach(b => b.onclick = cerrar);
}

// ═══ MAPA DE SIMETRÍA ══════════════════════════════════════════════════════
function vfVerSimetria() {
  const a = vf.analisis;
  if (!a) return;
  const capa = document.createElement("div");
  capa.style.cssText = "position:fixed;inset:0;background:#0b0d12;z-index:9800;overflow-y:auto;padding:16px;color:#e8ebf0";
  capa.innerHTML = `
    <div style="max-width:760px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
        <div>
          <div style="font-weight:600">Mapa de simetría</div>
          <div style="font-size:12px;opacity:.6">Rojo: el lado izquierdo del paciente sobresale más · Azul: el derecho</div>
        </div>
        <button class="vf-btn" id="vfSimCerrar">✕</button>
      </div>
      <canvas id="vfSimLienzo" style="width:100%;border-radius:12px;display:block"></canvas>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <div style="background:#11141b;border:1px solid #1b1f29;border-radius:10px;padding:12px">
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.1em">Mapa anatómico</div>
          <canvas id="vfMapaLienzo" style="width:100%;border-radius:8px;display:block;margin-top:8px"></canvas>
        </div>
        <div style="background:#11141b;border:1px solid #1b1f29;border-radius:10px;padding:12px;font-size:12px;line-height:1.6;opacity:.75">
          Las regiones se derivan de los puntos detectados: sirven para ubicar rápido dónde fue
          cada procedimiento, no reemplazan el ojo clínico.
        </div>
      </div>
    </div>`;
  document.body.appendChild(capa);
  capa.querySelector("#vfSimCerrar").onclick = () => capa.remove();

  const cs = capa.querySelector("#vfSimLienzo");
  cs.width = a.w; cs.height = a.h;
  dibujarSimetria(cs.getContext("2d"), a.vista.img, a.vista.landmarks, a.vista.FaceLandmarker || null);
  const cm = capa.querySelector("#vfMapaLienzo");
  cm.width = a.w; cm.height = a.h;
  dibujarMapaAnatomico(cm.getContext("2d"), a.vista.img, a.vista.landmarks, a.vista.FaceLandmarker || null);
}

// ═══ GUARDAR LA VISTA ══════════════════════════════════════════════════════
async function vfGuardarVista() {
  const btn = vf.capa.querySelector("#vfGuardar");
  btn.disabled = true;
  const antes = btn.textContent;
  btn.textContent = "Guardando...";
  try {
    const lienzo = vf.capa.querySelector("#vfLienzo");
    const dibujo = vf.capa.querySelector("#vfCapaDibujo");
    const salida = document.createElement("canvas");
    salida.width = lienzo.width; salida.height = lienzo.height;
    const ctx = salida.getContext("2d");
    ctx.drawImage(lienzo, 0, 0);
    ctx.drawImage(dibujo, 0, 0);
    // El sello va solo si hay simulación encima. Una foto con una medida no
    // es una simulación, y sellarla como tal le quitaría valor a la marca
    // justo donde sí hace falta.
    if (vf.simulando && !vf.verOriginal) sfSelloEnLienzo(salida);
    const png = await new Promise(res => salida.toBlob(res, "image/png"));
    const params = new URLSearchParams({
      nombre: `Vitalis Face · ${vf.vistaActual ? vf.vistaActual.label : "vista"}`,
      fecha: new Date().toISOString().slice(0, 10),
      tipo: "foto",
    });
    await fetch(`${API}/medico/pacientes/${vf.pacienteId}/estudios?${params}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "image/png" },
      body: png,
    });
    vfAviso("Guardado en la ficha del paciente.");
  } catch (e) {
    vfAviso("No se pudo guardar.", "ambar");
  }
  btn.disabled = false;
  btn.textContent = antes;
}

// ═══ CALIBRACIÓN EN MILÍMETROS ═════════════════════════════════════════════
// Dos clics sobre algo de tamaño conocido y el tamaño real. Es la misma idea
// que la calibración del visor de estudios, y guarda con origen "manual"
// para que nunca se confunda con la escala que trae un DICOM.
function vfCalibrar() {
  const a = vf.analisis;
  if (!a) return;
  const capa = document.createElement("div");
  capa.style.cssText = "position:fixed;inset:0;background:#0b0d12;z-index:9800;overflow-y:auto;color:#e8ebf0";
  capa.innerHTML = `
    <div style="padding:12px 14px;background:#11141b;position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div style="font-weight:600">Calibrar en milímetros</div>
        <div id="vfCalPaso" style="font-size:12px;opacity:.65">Marcá los dos extremos de algo cuyo tamaño real conozcas.</div>
      </div>
      <button class="vf-btn" id="vfCalCerrar">✕</button>
    </div>
    <div style="text-align:center;background:#000">
      <canvas id="vfCalLienzo" style="display:block;max-width:100%;margin:0 auto;cursor:crosshair"></canvas>
    </div>
    <div style="padding:12px 14px 30px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="vf-btn" id="vfCalReiniciar">↺ Empezar de nuevo</button>
      <input id="vfCalMm" type="number" step="0.1" min="1" placeholder="mm reales" style="width:120px;font-size:13px" disabled>
      <button class="vf-btn vf-btn-primario" id="vfCalGuardar" disabled>Guardar escala</button>
      <div style="flex:1 1 100%;font-size:11.5px;opacity:.5;line-height:1.55;margin-top:4px">
        La referencia tiene que estar a la misma distancia de la cámara que la cara.
        Un objeto sostenido más adelante sale más grande y toda la escala queda corrida.
      </div>
    </div>`;
  document.body.appendChild(capa);

  const img = a.vista.img;
  const lienzo = capa.querySelector("#vfCalLienzo");
  const escala = Math.min(1, 900 / img.naturalWidth, 1000 / img.naturalHeight);
  lienzo.width = Math.round(img.naturalWidth * escala);
  lienzo.height = Math.round(img.naturalHeight * escala);
  const ctx = lienzo.getContext("2d");
  const puntos = [];

  const pintar = () => {
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    if (puntos.length === 2) {
      ctx.beginPath();
      ctx.moveTo(puntos[0].x * lienzo.width, puntos[0].y * lienzo.height);
      ctx.lineTo(puntos[1].x * lienzo.width, puntos[1].y * lienzo.height);
      ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2; ctx.stroke();
    }
    puntos.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x * lienzo.width, p.y * lienzo.height, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#4ade80"; ctx.fill();
      ctx.strokeStyle = "#062"; ctx.lineWidth = 2; ctx.stroke();
    });
    const listo = puntos.length === 2;
    capa.querySelector("#vfCalMm").disabled = !listo;
    capa.querySelector("#vfCalGuardar").disabled = !listo;
    capa.querySelector("#vfCalPaso").textContent = listo
      ? "Ahora escribí cuántos milímetros mide de verdad esa distancia."
      : `Marcá el punto ${puntos.length + 1} de 2.`;
  };

  lienzo.onclick = (ev) => {
    if (puntos.length >= 2) return;
    const r = lienzo.getBoundingClientRect();
    puntos.push({ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height });
    pintar();
  };
  capa.querySelector("#vfCalReiniciar").onclick = () => { puntos.length = 0; pintar(); };
  capa.querySelector("#vfCalCerrar").onclick = () => capa.remove();

  capa.querySelector("#vfCalGuardar").onclick = async () => {
    const mm = Number(capa.querySelector("#vfCalMm").value);
    const distPx = vfDist(puntos[0], puntos[1], img.naturalWidth, img.naturalHeight);
    if (!Number.isFinite(mm) || mm <= 0 || distPx < 5) {
      vfAviso("Revisá el valor en mm y que los dos puntos no estén encima.", "ambar");
      return;
    }
    const calibracion = {
      mmPorPixel: mm / distPx,
      referencia: `referencia de ${mm} mm marcada a mano sobre la foto`,
      origen: "manual",
    };
    try {
      await api(`/medico/estudios/${a.vista.estudio._id}/visor`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibracion }),
      });
    } catch { /* se muestra igual en esta sesión */ }
    a.vista.estudio.calibracion = calibracion;
    capa.remove();
    vfPintar();
    vfAviso("Escala guardada. Ahora las medidas salen en milímetros.");
  };

  pintar();
}
