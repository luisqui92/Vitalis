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

  return {
    puntos: { nasion, menton, baseAlar, pupIzq, pupDer, alaIzq: lm[alaIzq], alaDer: lm[alaDer], sienIzq: lm[izq], sienDer: lm[der] },
    px: { anchuraFacial, alturaFacial, anchuraNasal, alturaNasal, interpupilar, tercioMedio: alturaNasal, tercioInferior },
    indices: [
      { id: "facial", label: "Índice facial", valor: alturaFacial / anchuraFacial * 100, unidad: "",
        normal: [85, 95], ayuda: "Alto de la cara sobre su ancho. Menos de 85: cara ancha (euriprosopo); más de 95: cara alargada (leptoprosopo).",
        categoria: (v) => v < 85 ? "Euriprosopo (cara ancha)" : v > 95 ? "Leptoprosopo (cara alargada)" : "Mesoprosopo (proporción media)" },
      { id: "nasal", label: "Índice nasal", valor: anchuraNasal / alturaNasal * 100, unidad: "",
        normal: [70, 85], ayuda: "Ancho de la nariz sobre su alto. Es la medida que más cambia una rinoplastia de base.",
        categoria: (v) => v < 70 ? "Leptorrino (nariz angosta)" : v > 85 ? "Platirrino (nariz ancha)" : "Mesorrino (proporción media)" },
      { id: "quintos", label: "Regla de los quintos", valor: anchuraFacial / (ojoProm || 1), unidad: " ojos",
        normal: [4.6, 5.4], ayuda: "Cuántos ojos entran en el ancho de la cara. El canon clásico dice cinco." },
      { id: "interpupilar", label: "Interpupilar / ancho facial", valor: interpupilar / anchuraFacial, unidad: "",
        normal: [0.42, 0.50], ayuda: "Separación de los ojos respecto del ancho de la cara." },
      { id: "tercios", label: "Tercio medio / tercio inferior", valor: alturaNasal / (tercioInferior || 1), unidad: "",
        normal: [0.90, 1.10], ayuda: "Nasion a base de la nariz, contra base de la nariz a mentón. El canon los quiere iguales. El tercio superior necesita el nacimiento del pelo y no se estima." },
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

// ═══ LA CONSOLA ════════════════════════════════════════════════════════════
async function vfAbrirConsola(pacienteId) {
  const capa = document.createElement("div");
  capa.id = "vitalisFace";
  capa.style.cssText = "position:fixed;inset:0;background:#0b0d12;z-index:9500;overflow-y:auto;color:#e8ebf0";
  capa.innerHTML = `<div style="max-width:520px;margin:90px auto;text-align:center">
    <div class="spinner" style="margin:0 auto 14px"></div>
    <div id="vfPaso" style="opacity:.7;font-size:13.5px">Cargando la ficha...</div>
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
  const porAngulo = new Map();
  for (const e of estudios) {
    if (!S25_VISTAS.some(v => v.angulo === e.anguloFoto)) continue;
    const previo = porAngulo.get(e.anguloFoto);
    if (!previo || new Date(e.fecha) > new Date(previo.fecha)) porAngulo.set(e.anguloFoto, e);
  }
  const vistas = S25_VISTAS.filter(v => porAngulo.has(v.angulo)).map(v => ({ ...v, estudio: porAngulo.get(v.angulo) }));

  if (!vistas.length) {
    capa.innerHTML = vfErrorHtml(
      "Esta ficha todavía no tiene fotos con su ángulo. Subilas indicando frontal, "
      + "45° y perfil de cada lado, y la consola se arma sola.");
    vfEngancharCerrar(capa);
    return;
  }

  paso("Cargando las fotos...");
  for (const v of vistas) {
    const blob = await traerBlobEstudio(v.estudio._id);
    if (!blob) continue;
    v.img = new Image();
    v.url = URL.createObjectURL(blob);
    await new Promise(ok => { v.img.onload = ok; v.img.onerror = ok; v.img.src = v.url; });
  }

  // El análisis frontal manda: es la única vista donde el detector da los 468
  // puntos con sentido. Si no hay frontal, se usa la más cercana al frente.
  paso("Analizando la vista frontal...");
  const candidatas = vistas.filter(v => v.img).sort((a, b) => Math.abs(a.grados) - Math.abs(b.grados));
  let analisis = null;
  for (const v of candidatas) {
    let d = null;
    try { d = await detectarEnImagen(v.img); } catch { d = null; }
    if (!d) continue;
    const base = regionesBase(d.FaceLandmarker);
    const marco = sfMarcoDeLaCara(d.landmarks, base);
    const grupos = sfGruposAnatomicos(d.landmarks, base, marco);
    const w = v.img.naturalWidth, h = v.img.naturalHeight;
    analisis = {
      vista: v, deteccion: d, base, marco, grupos, w, h,
      prop: vfProporciones(d.landmarks, base, marco, grupos, w, h),
      sim: vfSimetria(d.landmarks, base, marco, w, h),
    };
    break;
  }

  const perfiles = vistas.filter(v => Math.abs(v.grados) === 90);
  const completos = SF_PUNTOS_PERFIL.length;
  const conPerfil = perfiles.find(v => Array.isArray(v.estudio.perfilMarcado) && v.estudio.perfilMarcado.length === completos);
  const angulos = conPerfil
    ? vfAngulosPerfil(conPerfil.estudio.perfilMarcado, conPerfil.img.naturalWidth, conPerfil.img.naturalHeight)
    : null;

  vf = {
    capa, pacienteId, paciente: datos.paciente || {}, estudios, vistas, tratamientos,
    analisis, angulos, perfilAngulos: conPerfil || null,
    seleccion: (candidatas[0] || vistas[0]).angulo,
    calibracion: analisis ? (analisis.vista.estudio.calibracion || null) : null,
  };
  vfPintar();
}

function vfErrorHtml(msg) {
  return `<div style="max-width:520px;margin:90px auto;padding:0 20px;text-align:center;color:#e8ebf0">
    <div style="font-size:38px;margin-bottom:12px">🙂</div>
    <div style="line-height:1.6;margin-bottom:20px">${msg}</div>
    <button class="visor-btn" data-cerrar-vf>Cerrar</button>
  </div>`;
}
function vfEngancharCerrar(capa) {
  capa.querySelectorAll("[data-cerrar-vf]").forEach(b => b.onclick = vfCerrarConsola);
}
function vfCerrarConsola() {
  if (vf) for (const v of vf.vistas) if (v.url) URL.revokeObjectURL(v.url);
  const c = document.getElementById("vitalisFace");
  if (c) c.remove();
  document.body.style.overflow = "";
  vf = null;
}

// Un número con su rango de referencia al lado.
//
// Fuera de rango se marca en ámbar y nada más. La primera versión escribía
// "fuera del canon" al lado de cada uno, y sobre la cara de una persona
// concreta eso se lee como una lista de defectos: seis de nueve renglones
// acusando a alguien de no ser el promedio. Los rangos son de antropometría
// descriptiva —de dónde cae la mayoría—, no de dónde habría que estar.
function vfFilaMedidaHtml(m, mm) {
  const v = m.valor;
  const fuera = m.normal && (v < m.normal[0] || v > m.normal[1]);
  const texto = m.unidad === " ojos" ? v.toFixed(2) + m.unidad
    : m.normal && m.normal[1] > 10 ? v.toFixed(1) + "°"
    : v.toFixed(2);
  return `
    <div style="display:grid;grid-template-columns:1fr auto;gap:10px;padding:7px 0;border-bottom:1px solid #1b1f29">
      <div>
        <div style="font-size:13px">${esc(m.label)}</div>
        <div style="font-size:11px;opacity:.45;line-height:1.45;margin-top:1px">${esc(m.ayuda || "")}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-variant-numeric:tabular-nums;font-size:14px${fuera ? ";color:#e0a95c" : ""}">${texto}</div>
        ${m.normal ? `<div style="font-size:10.5px;opacity:.4">referencia ${m.normal[0]}–${m.normal[1]}${m.normal[1] > 10 && m.unidad !== " ojos" ? "°" : ""}</div>` : ""}

        ${mm ? `<div style="font-size:11px;color:#7fd1a8;font-variant-numeric:tabular-nums">${mm}</div>` : ""}
      </div>
    </div>`;
}

function vfPintar() {
  const { capa, paciente, vistas, analisis, angulos, tratamientos } = vf;
  const sel = vistas.find(v => v.angulo === vf.seleccion) || vistas[0];
  const cal = vf.calibracion && vf.calibracion.mmPorPixel ? vf.calibracion : null;
  const enMm = (px) => cal ? (px * cal.mmPorPixel).toFixed(1) + " mm" : null;

  const panel = (titulo, cuerpo, extra = "") => `
    <section style="background:#11141b;border:1px solid #1b1f29;border-radius:12px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px">
        <h2 style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.55;margin:0;font-weight:600">${titulo}</h2>
        ${extra}
      </div>
      ${cuerpo}
    </section>`;

  capa.innerHTML = `
    <div style="padding:14px 14px 40px;max-width:1500px;margin:0 auto">
      <header style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-size:19px;font-weight:700;letter-spacing:.02em">
            VITALIS FACE <span style="font-weight:400;opacity:.5;font-size:13px;letter-spacing:.08em">ANÁLISIS FACIAL 2.5D</span>
          </div>
          <div style="font-size:13px;opacity:.65;margin-top:2px">${esc(paciente.nombre || "Paciente")}${paciente.codigo ? " · " + esc(paciente.codigo) : ""}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="visor-btn" id="vfGirar" style="background:var(--primary);color:#fff">🔄 Girar y simular</button>
          <button class="visor-btn" data-cerrar-vf>✕ Cerrar</button>
        </div>
      </header>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px;align-items:start">

        ${panel("Las vistas del protocolo", `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px">
            ${vistas.map(v => `
              <button data-vista="${v.angulo}" style="all:unset;cursor:pointer;text-align:center">
                <div style="border-radius:8px;overflow:hidden;border:2px solid ${v.angulo === sel.angulo ? "var(--primary)" : "transparent"};aspect-ratio:3/4;background:#000">
                  ${v.url ? `<img src="${v.url}" style="width:100%;height:100%;object-fit:cover;display:block">` : ""}
                </div>
                <div style="font-size:10.5px;opacity:.6;margin-top:4px">${esc(v.label)}</div>
              </button>`).join("")}
          </div>
          <div style="font-size:11px;opacity:.45;margin-top:10px;line-height:1.5">
            ${vistas.length} de 5 vistas cargadas. El giro recorre estas fotos: no hay un modelo
            tridimensional atrás, y por eso lo que se ve en cada ángulo es la cara del paciente
            y no una aproximación.
          </div>`)}

        ${panel("Vista seleccionada", `
          <div style="background:#000;border-radius:10px;overflow:hidden;aspect-ratio:3/4">
            ${sel.url ? `<img src="${sel.url}" style="width:100%;height:100%;object-fit:contain;display:block">` : ""}
          </div>
          <div style="font-size:12px;opacity:.6;margin-top:8px">${esc(sel.label)} · ${esc(sel.estudio.nombre || "")}</div>`,
          `<span style="font-size:11px;opacity:.4">${sel.img ? sel.img.naturalWidth + "×" + sel.img.naturalHeight : ""}</span>`)}

        ${panel("Mapa anatómico", analisis
          ? `<canvas id="vfMapa" style="width:100%;border-radius:10px;display:block"></canvas>
             <div id="vfLeyenda" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:10.5px"></div>`
          : `<div style="font-size:12.5px;opacity:.6;line-height:1.6">
               No se detectó una cara en ninguna vista. El mapa necesita una frontal
               con los dos ojos visibles, sin lentes ni gorra.
             </div>`)}

        ${panel("Proporciones y ángulos", analisis ? `
          ${analisis.prop.indices.map(m => vfFilaMedidaHtml(m, null)).join("")}
          ${angulos && angulos.length ? `
            <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.45;margin:14px 0 4px">Ángulos del perfil</div>
            ${angulos.map(m => vfFilaMedidaHtml(m, null)).join("")}
          ` : `
            <div style="margin-top:14px;font-size:11.5px;background:#1a1710;border:1px solid #3d3418;color:#e0cf9c;padding:9px 11px;border-radius:8px;line-height:1.55">
              Los ángulos del perfil —nasofrontal, nasolabial, nasofacial— son los que de
              verdad se miran en una rinoplastia, y no necesitan ninguna calibración.
              Para calcularlos hace falta marcar el perfil una vez.
              <a href="#" id="vfMarcarPerfil" style="color:#ffd76e">Marcar ${esc(vfPerfilAMarcar() ? vfPerfilAMarcar().label.toLowerCase() : "el perfil")} ahora</a>${vf.vistas.filter(v => Math.abs(v.grados) === 90).length > 1 ? " (elegí el otro en la tira de arriba para marcar ese)" : ""}
            </div>`}
          <div style="margin-top:14px;font-size:11.5px;opacity:.55;line-height:1.6;border-top:1px solid #1b1f29;padding-top:10px">
            Todo lo de arriba son razones y ángulos: no dependen de a qué distancia se sacó
            la foto, así que son correctos sin calibrar.
            <div style="margin-top:6px">
              Los rangos de referencia dicen dónde cae la mayoría de las caras medidas, no
              dónde habría que estar. Casi toda cara queda fuera de alguno, y en ámbar no
              significa que haya nada que corregir: significa que ahí es donde esta cara se
              distingue del promedio.
            </div>
          </div>` : `<div style="font-size:12.5px;opacity:.6">Hace falta una vista frontal detectable.</div>`)}

        ${panel("Medidas en milímetros", analisis ? (cal ? `
          ${[
            { label: "Anchura facial (bicigomática)", px: analisis.prop.px.anchuraFacial },
            { label: "Altura facial (nasion–mentón)", px: analisis.prop.px.alturaFacial },
            { label: "Anchura nasal", px: analisis.prop.px.anchuraNasal },
            { label: "Altura nasal", px: analisis.prop.px.alturaNasal },
            { label: "Distancia interpupilar", px: analisis.prop.px.interpupilar },
          ].map(m => `
            <div style="display:grid;grid-template-columns:1fr auto;gap:10px;padding:7px 0;border-bottom:1px solid #1b1f29;font-size:13px">
              <span>${esc(m.label)}</span>
              <span style="font-variant-numeric:tabular-nums;color:#7fd1a8">${enMm(m.px)}</span>
            </div>`).join("")}
          <div style="margin-top:12px;font-size:11.5px;opacity:.55;line-height:1.6">
            Calibrado con: ${esc(cal.referencia || "referencia manual")}.
            <a href="#" id="vfRecalibrar" style="color:var(--primary)">Volver a calibrar</a>
          </div>
          <div style="margin-top:8px;font-size:11px;background:#1a1710;border:1px solid #3d3418;color:#e0cf9c;padding:8px 10px;border-radius:8px;line-height:1.55">
            Válido solo para lo que esté en el mismo plano que la referencia. Una cara es
            curva: lo que está más cerca de la cámara sale más grande.
          </div>` : `
          <div style="font-size:12.5px;opacity:.7;line-height:1.65">
            Todavía no hay milímetros, y no los va a haber inventados.
            Una foto no trae escala: la misma nariz, de cerca y de lejos, ocupa distinta
            cantidad de píxeles. Para dar milímetros hace falta algo de tamaño conocido
            en la foto.
          </div>
          <button class="visor-btn" id="vfCalibrar" style="margin-top:12px">📏 Calibrar con una referencia</button>
          <div style="font-size:11px;opacity:.45;margin-top:8px;line-height:1.55">
            Sirve una regla, una tarjeta apoyada en la mejilla, o cualquier objeto cuyo
            tamaño real conozcas, siempre que esté a la misma distancia de la cámara que
            la cara.
          </div>`) : `<div style="font-size:12.5px;opacity:.6">Hace falta una vista frontal detectable.</div>`)}

        ${panel("Simetría", analisis ? `
          <canvas id="vfSimetria" style="width:100%;border-radius:10px;display:block"></canvas>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:10px">
            <span style="font-size:12.5px;opacity:.7">Índice de simetría</span>
            <span style="font-size:20px;font-variant-numeric:tabular-nums">${analisis.sim.indice.toFixed(1)}<span style="font-size:12px;opacity:.5">/100</span></span>
          </div>
          <div style="font-size:11.5px;opacity:.55;line-height:1.6;margin-top:8px">
            Diferencia media entre cada punto y su espejo: ${analisis.sim.difMediaPorcentaje.toFixed(2)}% del ancho de la cara.
            La mayor: ${analisis.sim.difPeorPorcentaje.toFixed(2)}%, con el lado
            ${analisis.sim.ladoIzquierdoMayor ? "izquierdo" : "derecho"} más prominente.
            Se expresa en porcentaje y no en milímetros a propósito: en porcentaje vale igual
            de cerca que de lejos.
          </div>
          <div style="font-size:11px;opacity:.4;margin-top:6px;line-height:1.5">
            Ninguna cara es simétrica. El número sirve para comparar la misma cara antes y
            después, no para compararla con otra persona.
          </div>` : `<div style="font-size:12.5px;opacity:.6">Hace falta una vista frontal detectable.</div>`)}

        ${panel("Evolución en el tiempo", vfEvolucionHtml())}

        ${panel("Antes y después", vfAntesDespuesHtml())}

        ${panel("Procedimientos", tratamientos.length ? `
          <div style="font-size:12.5px">
            ${tratamientos.slice(0, 12).map(t => `
              <div style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;padding:7px 0;border-bottom:1px solid #1b1f29;align-items:baseline">
                <span style="opacity:.5;font-size:11px;white-space:nowrap">${new Date(t.createdAt).toLocaleDateString("es-BO")}</span>
                <span>${esc(t.nombre)}${t.regionFacial ? `<span style="opacity:.5"> · ${esc(t.regionFacial)}</span>` : ""}</span>
                <span style="font-size:11px;opacity:.6;white-space:nowrap">${esc({ pendiente: "pendiente", en_proceso: "en proceso", realizado: "realizado" }[t.estado] || t.estado)}</span>
              </div>`).join("")}
          </div>
          ${tratamientos.length > 12 ? `<div style="font-size:11px;opacity:.45;margin-top:8px">y ${tratamientos.length - 12} más en la pestaña de tratamientos</div>` : ""}`
          : `<div style="font-size:12.5px;opacity:.6;line-height:1.6">
               Todavía no hay procedimientos cargados. Se cargan en la pestaña de
               tratamientos y aparecen acá con su región facial.
             </div>`)}
      </div>
    </div>`;

  vfEngancharCerrar(capa);
  vfEnganchar();
}

function vfEvolucionHtml() {
  const fotos = vf.estudios
    .filter(e => e.anguloFoto === "frontal")
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  if (fotos.length < 2) {
    return `<div style="font-size:12.5px;opacity:.6;line-height:1.6">
      Con una sola frontal no hay evolución que mostrar. A medida que se carguen
      controles frontales en distintas fechas, aparecen acá en orden.
    </div>`;
  }
  return `
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">
      ${fotos.map((e, i) => `
        <div style="flex:0 0 84px;text-align:center">
          <div style="aspect-ratio:3/4;border-radius:8px;background:#000;display:flex;align-items:center;justify-content:center;font-size:11px;opacity:.5;border:1px solid #1b1f29">
            ${i === 0 ? "inicial" : "control " + i}
          </div>
          <div style="font-size:10.5px;opacity:.55;margin-top:4px">${new Date(e.fecha).toLocaleDateString("es-BO")}</div>
        </div>`).join("")}
    </div>
    <div style="font-size:11px;opacity:.45;margin-top:10px;line-height:1.5">
      ${fotos.length} controles frontales. Para comparar dos, usá el panel de al lado.
    </div>`;
}

function vfAntesDespuesHtml() {
  const fotos = vf.estudios
    .filter(e => e.anguloFoto)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  if (fotos.length < 2) {
    return `<div style="font-size:12.5px;opacity:.6;line-height:1.6">
      Hace falta más de una foto para comparar.
    </div>`;
  }
  const opciones = (sel) => fotos.map(e =>
    `<option value="${e._id}" ${e._id === sel ? "selected" : ""}>${esc(e.nombre || e.anguloFoto)} · ${new Date(e.fecha).toLocaleDateString("es-BO")}</option>`).join("");
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <select id="vfAntes" style="font-size:12px">${opciones(fotos[0]._id)}</select>
      <select id="vfDespues" style="font-size:12px">${opciones(fotos[fotos.length - 1]._id)}</select>
      <div style="background:#000;border-radius:8px;aspect-ratio:3/4;overflow:hidden"><img id="vfImgAntes" style="width:100%;height:100%;object-fit:contain;display:block"></div>
      <div style="background:#000;border-radius:8px;aspect-ratio:3/4;overflow:hidden"><img id="vfImgDespues" style="width:100%;height:100%;object-fit:contain;display:block"></div>
    </div>
    <div style="font-size:11px;opacity:.45;margin-top:8px;line-height:1.5">
      Comparar sirve si las dos fotos están sacadas parecido. Distinta luz o distinta
      distancia cambian la cara más que muchos tratamientos.
    </div>`;
}

function vfEnganchar() {
  const { capa, analisis } = vf;

  capa.querySelectorAll("[data-vista]").forEach(b => b.onclick = () => {
    vf.seleccion = b.dataset.vista;
    vfPintar();
  });

  const girar = capa.querySelector("#vfGirar");
  if (girar) girar.onclick = () => abrirSimulador25D(vf.pacienteId, vf.estudios);

  if (analisis) {
    const cMapa = capa.querySelector("#vfMapa");
    if (cMapa) {
      cMapa.width = analisis.w; cMapa.height = analisis.h;
      dibujarMapaAnatomico(cMapa.getContext("2d"), analisis.vista.img, analisis.deteccion.landmarks, analisis.deteccion.FaceLandmarker);
      const ley = capa.querySelector("#vfLeyenda");
      if (ley) ley.innerHTML = Object.entries(ETIQUETAS).map(([k, l]) =>
        `<span style="display:inline-flex;align-items:center;gap:4px;opacity:.7"><i style="width:9px;height:9px;border-radius:2px;background:rgb(${COLOR_REGION[k]});display:inline-block"></i>${esc(l)}</span>`).join("");
    }
    const cSim = capa.querySelector("#vfSimetria");
    if (cSim) {
      cSim.width = analisis.w; cSim.height = analisis.h;
      dibujarSimetria(cSim.getContext("2d"), analisis.vista.img, analisis.deteccion.landmarks, analisis.deteccion.FaceLandmarker);
    }
  }

  const marcar = capa.querySelector("#vfMarcarPerfil");
  if (marcar) marcar.onclick = (ev) => { ev.preventDefault(); vfMarcarPerfil(); };

  for (const id of ["#vfCalibrar", "#vfRecalibrar"]) {
    const b = capa.querySelector(id);
    if (b) b.onclick = (ev) => { ev.preventDefault(); vfCalibrar(); };
  }

  const antes = capa.querySelector("#vfAntes"), despues = capa.querySelector("#vfDespues");
  if (antes && despues) {
    const cargar = async (sel, img) => {
      const blob = await traerBlobEstudio(sel.value);
      if (blob) img.src = URL.createObjectURL(blob);
    };
    const iA = capa.querySelector("#vfImgAntes"), iD = capa.querySelector("#vfImgDespues");
    antes.onchange = () => cargar(antes, iA);
    despues.onchange = () => cargar(despues, iD);
    cargar(antes, iA); cargar(despues, iD);
  }
}

// ═══ MARCAR EL PERFIL DESDE LA CONSOLA ═════════════════════════════════════
// Cuál perfil se marca: el que está seleccionado en la tira, si es un
// perfil. Elegir siempre "el primero" hace que el cirujano marque el
// izquierdo creyendo que marcaba el que está mirando.
function vfPerfilAMarcar() {
  const perfiles = vf.vistas.filter(v => Math.abs(v.grados) === 90 && v.img);
  return perfiles.find(v => v.angulo === vf.seleccion) || perfiles[0] || null;
}

function vfMarcarPerfil() {
  const perfil = vfPerfilAMarcar();
  if (!perfil) {
    alert("No hay una foto de perfil cargada. Subila con su ángulo (perfil derecho o izquierdo).");
    return;
  }
  const capa = document.createElement("div");
  capa.style.cssText = "position:fixed;inset:0;background:#16161c;z-index:9700;overflow-y:auto";
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.querySelectorAll("[data-cerrar-simu]").forEach(b => b.onclick = cerrar);

  sfPantallaMarcado(capa, perfil.img, async (marcados) => {
    cerrar();
    try {
      await api(`/medico/estudios/${perfil.estudio._id}/visor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfilMarcado: marcados.map(p => ({ x: p.x, y: p.y })) }),
      });
    } catch { /* si no guarda, igual se muestran los ángulos de esta sesión */ }
    perfil.estudio.perfilMarcado = marcados;
    vf.perfilAngulos = perfil;
    vf.angulos = vfAngulosPerfil(marcados, perfil.img.naturalWidth, perfil.img.naturalHeight);
    vfPintar();
  });
  // sfPantallaMarcado pone su propio botón de cerrar con data-cerrar-simu.
  capa.querySelectorAll("[data-cerrar-simu]").forEach(b => b.onclick = cerrar);
}

// ═══ CALIBRACIÓN EN MILÍMETROS ═════════════════════════════════════════════
// Dos clics sobre algo de tamaño conocido y el tamaño real. Es la misma idea
// que la calibración del visor de estudios, y guarda con origen "manual"
// para que nunca se confunda con la escala que trae un DICOM.
function vfCalibrar() {
  const a = vf.analisis;
  if (!a) return;
  const capa = document.createElement("div");
  capa.style.cssText = "position:fixed;inset:0;background:#0b0d12;z-index:9700;overflow-y:auto;color:#e8ebf0";
  capa.innerHTML = `
    <div style="padding:12px 14px;background:#11141b;position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div style="font-weight:600">Calibrar en milímetros</div>
        <div id="vfCalPaso" style="font-size:12px;opacity:.65">Marcá los dos extremos de algo cuyo tamaño real conozcas.</div>
      </div>
      <button class="visor-btn" id="vfCalCerrar">✕</button>
    </div>
    <div style="text-align:center;background:#000">
      <canvas id="vfCalLienzo" style="display:block;max-width:100%;margin:0 auto;cursor:crosshair"></canvas>
    </div>
    <div style="padding:12px 14px 30px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="visor-btn" id="vfCalReiniciar">↺ Empezar de nuevo</button>
      <input id="vfCalMm" type="number" step="0.1" min="1" placeholder="mm reales" style="width:120px;font-size:13px" disabled>
      <button class="visor-btn" id="vfCalGuardar" style="background:var(--primary);color:#fff" disabled>Guardar escala</button>
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
      alert("Revisá el valor en milímetros y que los dos puntos no estén encima.");
      return;
    }
    const calibracion = {
      mmPorPixel: mm / distPx,
      referencia: `referencia de ${mm} mm marcada a mano sobre la foto`,
      origen: "manual",
    };
    try {
      await api(`/medico/estudios/${a.vista.estudio._id}/visor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibracion }),
      });
    } catch { /* se muestra igual en esta sesión */ }
    a.vista.estudio.calibracion = calibracion;
    vf.calibracion = calibracion;
    capa.remove();
    vfPintar();
  };

  pintar();
}
