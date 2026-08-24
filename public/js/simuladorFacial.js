// ═══════════════════════════════════════════════════════════════════════════
// Vitalis Face — Simulador quirúrgico sobre la foto real
// ═══════════════════════════════════════════════════════════════════════════
// Lo que ve el paciente NO es un modelo 3D de una cara genérica parecida a
// la suya: es SU foto, deformada. Por eso se ve real — la piel, la luz, el
// pelo y el fondo son los suyos, porque nunca dejaron de serlo.
//
// Cómo funciona: los 468 puntos de MediaPipe (ya vendorizados en
// /vendor/mediapipe, los mismos que usa el mapa anatómico) se triangulan
// junto con un marco de puntos fijos en el borde de la imagen. La textura
// de cada triángulo se toma de la posición ORIGINAL del sfDot y se dibuja
// en la posición DESPLAZADA. Mover un sfDot estira la foto; el marco fijo
// hace que el fondo no se mueva.
//
// ─── LOS DOS LÍMITES QUE HAY QUE SABER ───────────────────────────────────
//
// 1. LA ROTACIÓN LLEGA HASTA ±20°, y no es un defecto de implementación.
//    MediaPipe da una profundidad aproximada por sfDot, suficiente para
//    inclinar la foto un poco. Más allá de eso aparece lo que la cámara
//    nunca vio: no hay píxeles de lo que estaba detrás de la nariz. Para
//    ver el perfil hace falta una FOTO de perfil. Por eso el simulador
//    trabaja sobre el juego estándar de fotos (frente, tres cuartos y
//    perfil) y cada una se simula por separado — que además es como se
//    hace una consulta de verdad.
//
// 2. LOS SF_CONTROLES TIENEN TOPE, a propósito. Una herramienta que te deja
//    arrastrar la nariz a cualquier lado produce imágenes que ningún
//    cirujano puede entregar, y eso no es una demo: es un juicio. Los
//    rangos están acotados a lo quirúrgicamente plausible.
//
// Y por eso mismo: TODA imagen que sale de acá lleva la marca de
// simulación, en pantalla y al exportar. No es decoración legal — es lo que
// hace que esta herramienta se pueda usar sin prometer un resultado.

// ─── UNA NOTA SOBRE LOS NOMBRES ──────────────────────────────────────────
// Acá no hay build step ni módulos: TODA función de nivel superior es
// global y la última que carga le gana a las anteriores, en silencio. Por
// eso el resto del proyecto usa nombres prefijados (dibujarVisor,
// dibujarMapaAnatomico) y este archivo usa sf* para todo lo suyo. Un
// `function punto(...)` acá le pisaba el suyo a visorImagen.js — o al revés,
// según el orden de los <script> — y el síntoma era un error absurdo en un
// archivo que nadie había tocado.

// ─── ESTADO ───────────────────────────────────────────────────────────────
let simu = null;

// Cuánto se puede mover cada control, como fracción del ANCHO de la cara
// (así vale igual para una foto de 800 px que para una de 4000). Los topes
// son deliberadamente conservadores.
const SF_CONTROLES = [
  { id: "dorso",        label: "Dorso nasal (giba)",     grupo: "Nariz",   eje: "adelante", max: 0.030, invertido: true,
    ayuda: "Bajar la giba. Se ve sobre todo en el perfil." },
  { id: "proyeccionPunta", label: "Proyección de la punta", grupo: "Nariz", eje: "adelante", max: 0.035,
    ayuda: "Cuánto sobresale la punta." },
  { id: "rotacionPunta",   label: "Rotación de la punta",   grupo: "Nariz", eje: "arriba",   max: 0.030, invertido: true,
    ayuda: "Levantar o bajar la punta." },
  { id: "anchoAlas",       label: "Ancho de las alas",      grupo: "Nariz", eje: "ancho",    max: 0.035, invertido: true,
    ayuda: "Estrechar la base de la nariz." },
  { id: "mentonProyeccion", label: "Proyección del mentón", grupo: "Perfil", eje: "adelante", max: 0.045,
    ayuda: "Mentón hacia adelante — cambia mucho el equilibrio del perfil." },
  { id: "mentonAltura",     label: "Altura del mentón",     grupo: "Perfil", eje: "arriba",  max: 0.030,
    ayuda: "Alargar o acortar el tercio inferior." },
  { id: "mandibula",        label: "Línea mandibular",      grupo: "Perfil", eje: "adelante", max: 0.030,
    ayuda: "Definir el ángulo de la mandíbula y el submentón." },
  { id: "pomulos",          label: "Pómulos",               grupo: "Volumen", eje: "adelante", max: 0.035,
    ayuda: "Proyección malar." },
  { id: "labios",           label: "Volumen de labios",     grupo: "Volumen", eje: "expandir", max: 0.025,
    ayuda: "Aumento del rojo labial." },
  { id: "parpadoSuperior",  label: "Párpado superior",      grupo: "Ojos",   eje: "arriba",   max: 0.018, invertido: true,
    ayuda: "Elevar el pliegue. Rango corto a propósito." },
];

// ─── GEOMETRÍA DE LA CARA ─────────────────────────────────────────────────
// Un marco de referencia propio de la cara (arriba / derecha / adelante),
// derivado de los puntos y no de la pantalla. Con esto, "bajar la giba"
// significa lo mismo en una foto de frente que en una de perfil: mover esos
// puntos hacia atrás en el eje de la cara. Sin este marco habría que
// escribir un comportamiento distinto por vista, y las de tres cuartos —que
// son la mitad de las fotos— quedarían siempre a mitad de camino.
function sfNormalizar(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
function sfRestar(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function sfCruz(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function sfDot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sfEscalar(v, k) { return { x: v.x * k, y: v.y * k, z: v.z * k }; }

function sfMarcoDeLaCara(lm, base) {
  const cent = (idxs) => {
    let x = 0, y = 0, z = 0;
    for (const i of idxs) { x += lm[i].x; y += lm[i].y; z += lm[i].z; }
    return { x: x / idxs.length, y: y / idxs.length, z: z / idxs.length };
  };
  const ovalo = base.ovalo.map(i => lm[i]);
  // Arriba y abajo del óvalo por su posición vertical en pantalla: aunque la
  // cabeza esté algo girada, el óvalo sigue yendo de la frente al mentón.
  const ordenY = base.ovalo.slice().sort((a, b) => lm[a].y - lm[b].y);
  const frente = cent(ordenY.slice(0, 5));
  const menton = cent(ordenY.slice(-5));
  const ordenX = base.ovalo.slice().sort((a, b) => lm[a].x - lm[b].x);
  const sienIzq = cent(ordenX.slice(0, 5));
  const sienDer = cent(ordenX.slice(-5));

  const arriba = sfNormalizar(sfRestar(frente, menton));
  let derecha = sfNormalizar(sfRestar(sienDer, sienIzq));
  // Ortogonalizar: el eje oreja-a-oreja casi nunca es perpendicular exacto
  // al frente-mentón, y si no se corrige, los desplazamientos "hacia
  // adelante" se contaminan con un poco de "hacia arriba".
  derecha = sfNormalizar(sfRestar(derecha, sfEscalar(arriba, sfDot(derecha, arriba))));
  const adelante = sfNormalizar(sfCruz(derecha, arriba));

  const centro = cent(base.ovalo);
  const anchoCara = Math.hypot(sienDer.x - sienIzq.x, sienDer.y - sienIzq.y, sienDer.z - sienIzq.z);
  return { arriba, derecha, adelante, centro, anchoCara, frente, menton, sienIzq, sienDer };
}

// Coordenadas de un sfDot EN el marco de la cara.
function sfEnMarco(p, m) {
  const d = sfRestar(p, m.centro);
  return { u: sfDot(d, m.derecha), v: sfDot(d, m.arriba), w: sfDot(d, m.adelante) };
}

// ─── QUÉ PUNTOS TOCA CADA CONTROL ─────────────────────────────────────────
// Se derivan geométricamente, igual que las regiones del mapa anatómico: no
// hay índices "mágicos" recordados de memoria, que es lo que se rompe en
// silencio cuando cambia la versión del modelo.
function sfGruposAnatomicos(lm, base, m) {
  const coords = lm.map(p => sfEnMarco(p, m));
  const A = m.anchoCara;

  const yDe = (idxs) => idxs.map(i => coords[i].v);
  const prom = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const vCejas = prom(yDe(base.ceja_derecha).concat(yDe(base.ceja_izquierda)));
  const vOjos = prom(yDe(base.ojo_derecho).concat(yDe(base.ojo_izquierdo)));
  const vLabiosTop = Math.max(...yDe(base.labios));
  const vLabiosBot = Math.min(...yDe(base.labios));
  const vMenton = sfEnMarco(m.menton, m).v;

  const todos = lm.map((_, i) => i);
  const enBandaCentral = (i, ancho) => Math.abs(coords[i].u) < A * ancho;
  const entre = (i, vBajo, vAlto) => coords[i].v > vBajo && coords[i].v < vAlto;

  // La nariz: banda central, entre las cejas y el labio superior.
  const zonaNasal = todos.filter(i => enBandaCentral(i, 0.13) && entre(i, vLabiosTop, vCejas));
  // La punta es el sfDot más ADELANTE de esa zona — vale en cualquier vista,
  // porque "adelante" es del marco de la cara y no de la pantalla.
  const punta = zonaNasal.slice().sort((a, b) => coords[b].w - coords[a].w).slice(0, 6);
  const vPunta = prom(punta.map(i => coords[i].v));
  // El dorso: la cresta entre el entrecejo y la punta.
  const dorso = zonaNasal.filter(i => coords[i].v > vPunta && coords[i].v < vCejas && Math.abs(coords[i].u) < A * 0.07);
  // Las alas: lo más ancho de la zona nasal, por debajo del nivel de la punta.
  const alas = zonaNasal.filter(i => coords[i].v < vPunta + A * 0.03 && Math.abs(coords[i].u) > A * 0.055);

  // El mentón: banda central por debajo del labio inferior.
  const menton = todos.filter(i => enBandaCentral(i, 0.16) && coords[i].v < vLabiosBot && coords[i].v > vMenton - A * 0.05);
  // La mandíbula: el contorno del óvalo por debajo de la comisura.
  const mandibula = base.ovalo.filter(i => coords[i].v < vLabiosBot + A * 0.05);
  // Los pómulos: la prominencia malar, no "todo el costado de la cara".
  // Acotado por arriba Y por abajo en los dos ejes: sin el tope exterior
  // entraban el contorno del óvalo y la oreja, y el control terminaba
  // moviendo un tercio de la cara de una sola vez.
  const pomulos = todos.filter(i =>
    Math.abs(coords[i].u) > A * 0.18 && Math.abs(coords[i].u) < A * 0.36 &&
    coords[i].v > vLabiosTop + A * 0.04 && coords[i].v < vOjos - A * 0.01);
  // Párpado superior: los puntos del ojo por encima de su propio centro.
  const parpado = [...base.ojo_derecho, ...base.ojo_izquierdo].filter(i => coords[i].v > vOjos);

  return { dorso, punta, alas, menton, mandibula, pomulos, labios: base.labios.slice(), parpado };
}

// ─── EL DESPLAZAMIENTO ────────────────────────────────────────────────────
// Cada control mueve un grupo de puntos, y el movimiento se DIFUMINA hacia
// los vecinos: sin eso la malla se rompe justo en el borde del grupo y se
// ve un escalón donde no hay ninguno en una cara.
function sfDesplazamientos(valores, lm, base, m, grupos) {
  const coords = lm.map(p => sfEnMarco(p, m));
  const A = m.anchoCara;
  const desp = lm.map(() => ({ x: 0, y: 0, z: 0 }));

  for (const ctrl of SF_CONTROLES) {
    const v = (valores[ctrl.id] || 0) / 100;
    if (!v) continue;
    const grupo = grupos[ctrl.id === "proyeccionPunta" || ctrl.id === "rotacionPunta" ? "punta"
      : ctrl.id === "anchoAlas" ? "alas"
      : ctrl.id === "mentonProyeccion" || ctrl.id === "mentonAltura" ? "menton"
      : ctrl.id === "parpadoSuperior" ? "parpado"
      : ctrl.id];
    if (!grupo || !grupo.length) continue;

    const magnitud = v * ctrl.max * A * (ctrl.invertido ? -1 : 1);
    // Radio de difuminado proporcional a la cara: en una foto de cerca y en
    // una de lejos el efecto tiene que verse igual.
    const sigma = A * 0.10;

    for (let i = 0; i < lm.length; i++) {
      // Peso: 1 en el grupo, cayendo con la distancia al sfDot más cercano
      // del grupo.
      let d2min = Infinity;
      for (const g of grupo) {
        const dx = coords[i].u - coords[g].u, dy = coords[i].v - coords[g].v, dz = coords[i].w - coords[g].w;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < d2min) d2min = d2;
      }
      const peso = Math.exp(-d2min / (sigma * sigma));
      if (peso < 0.01) continue;

      let dir;
      if (ctrl.eje === "adelante") dir = m.adelante;
      else if (ctrl.eje === "arriba") dir = m.arriba;
      else if (ctrl.eje === "ancho") {
        // Simétrico: cada lado se mueve hacia (o desde) la línea media.
        dir = sfEscalar(m.derecha, Math.sign(coords[i].u) || 1);
      } else if (ctrl.eje === "expandir") {
        // Los labios crecen hacia afuera desde su propio centro.
        const cu = prom(grupo.map(g => coords[g].u)), cv = prom(grupo.map(g => coords[g].v));
        const du = coords[i].u - cu, dv = coords[i].v - cv;
        const n = Math.hypot(du, dv) || 1;
        dir = sfNormalizar({
          x: m.derecha.x * (du / n) + m.arriba.x * (dv / n),
          y: m.derecha.y * (du / n) + m.arriba.y * (dv / n),
          z: m.derecha.z * (du / n) + m.arriba.z * (dv / n),
        });
      } else continue;

      desp[i].x += dir.x * magnitud * peso;
      desp[i].y += dir.y * magnitud * peso;
      desp[i].z += dir.z * magnitud * peso;
    }
  }
  return desp;

  function prom(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
}

// ─── TRIANGULACIÓN ────────────────────────────────────────────────────────
// Delaunay (Bowyer-Watson) sobre las posiciones ORIGINALES en pantalla. Se
// calcula una sola vez: los triángulos no cambian cuando se mueven los
// puntos, solo cambia dónde se dibuja cada uno.
function sfTriangular(puntos) {
  const n = puntos.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of puntos) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const dx = (maxX - minX) || 1, dy = (maxY - minY) || 1;
  const dmax = Math.max(dx, dy) * 20;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Súper-triángulo que contiene todo; sus vértices se descartan al final.
  const pts = puntos.concat([
    { x: cx - dmax, y: cy - dmax }, { x: cx + dmax, y: cy - dmax }, { x: cx, y: cy + dmax },
  ]);
  let tris = [[n, n + 1, n + 2]];

  const sfEnCircunscrita = (t, p) => {
    const [a, b, c] = t.map(i => pts[i]);
    const ax = a.x - p.x, ay = a.y - p.y;
    const bx = b.x - p.x, by = b.y - p.y;
    const cxx = c.x - p.x, cyy = c.y - p.y;
    const det =
      (ax * ax + ay * ay) * (bx * cyy - cxx * by) -
      (bx * bx + by * by) * (ax * cyy - cxx * ay) +
      (cxx * cxx + cyy * cyy) * (ax * by - bx * ay);
    // Orientación: el signo del determinante depende de cómo esté girado el
    // triángulo, así que se normaliza.
    const orient = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    return orient > 0 ? det > 0 : det < 0;
  };

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const malos = [], buenos = [];
    for (const t of tris) (sfEnCircunscrita(t, p) ? malos : buenos).push(t);
    // El borde del agujero: las aristas que aparecen una sola vez.
    const aristas = new Map();
    for (const t of malos) {
      for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        aristas.set(k, (aristas.get(k) || 0) + 1);
      }
    }
    tris = buenos;
    for (const [k, veces] of aristas) {
      if (veces !== 1) continue;
      const [a, b] = k.split(",").map(Number);
      tris.push([a, b, i]);
    }
  }
  return tris.filter(t => t.every(i => i < n));
}

// ─── RENDER ───────────────────────────────────────────────────────────────
// WebGL: la textura es la foto, cada vértice lleva su coordenada de textura
// en la posición ORIGINAL y se dibuja en la POSICIÓN DESPLAZADA. Eso es
// literalmente todo el truco.
const SF_VERT = `
attribute vec3 pos;
attribute vec2 uv;
uniform mat3 rot;
uniform vec2 centro;
uniform float aspecto;
varying vec2 vuv;
void main() {
  vec3 p = vec3(pos.x - centro.x, pos.y - centro.y, pos.z);
  p.y *= aspecto;          // a espacio cuadrado, para que rotar no deforme
  p = rot * p;
  p.y /= aspecto;
  vec2 f = vec2(p.x + centro.x, p.y + centro.y);
  gl_Position = vec4(f.x * 2.0 - 1.0, 1.0 - f.y * 2.0, 0.0, 1.0);
  vuv = uv;
}`;

const SF_FRAG = `
precision mediump float;
uniform sampler2D foto;
varying vec2 vuv;
void main() { gl_FragColor = texture2D(foto, vuv); }`;

function sfCompilarShader(gl, tipo, fuente) {
  const s = gl.createShader(tipo);
  gl.shaderSource(s, fuente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function sfIniciarGL(canvas, imagen) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: true });
  if (!gl) throw new Error("Este navegador no tiene WebGL");
  const prog = gl.createProgram();
  gl.attachShader(prog, sfCompilarShader(gl, gl.VERTEX_SHADER, SF_VERT));
  gl.attachShader(prog, sfCompilarShader(gl, gl.FRAGMENT_SHADER, SF_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imagen);

  return {
    gl, prog, tex,
    bufPos: gl.createBuffer(), bufUv: gl.createBuffer(), bufIdx: gl.createBuffer(),
    loc: {
      pos: gl.getAttribLocation(prog, "pos"),
      uv: gl.getAttribLocation(prog, "uv"),
      rot: gl.getUniformLocation(prog, "rot"),
      centro: gl.getUniformLocation(prog, "centro"),
      aspecto: gl.getUniformLocation(prog, "aspecto"),
      foto: gl.getUniformLocation(prog, "foto"),
    },
  };
}

function sfMatrizY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  // column-major para WebGL
  return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
}

function sfDibujar(ctx, vertices, uvs, indices, grados, centro, aspecto) {
  const { gl, loc, bufPos, bufUv, bufIdx, tex } = ctx;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufUv);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc.uv);
  gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.uniformMatrix3fv(loc.rot, false, sfMatrizY(grados * Math.PI / 180));
  gl.uniform2f(loc.centro, centro.x, centro.y);
  gl.uniform1f(loc.aspecto, aspecto);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc.foto, 0);

  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
}

// ─── ARMADO DE LA MALLA ───────────────────────────────────────────────────
// Además de los 468 puntos de la cara va un marco de puntos FIJOS por el
// borde de la imagen. Sin ellos, deformar la cara arrastraría el fondo, el
// pelo y las orejas con ella y se vería como un espejo de feria.
function sfArmarMalla(lm) {
  const base = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
  const marco = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    marco.push({ x: t, y: 0, z: 0 }, { x: t, y: 1, z: 0 }, { x: 0, y: t, z: 0 }, { x: 1, y: t, z: 0 });
  }
  const puntos = base.concat(marco);
  const tris = sfTriangular(puntos);
  const indices = new Uint16Array(tris.flat());
  const uvs = new Float32Array(puntos.flatMap(p => [p.x, p.y]));
  return { puntos, indices, uvs, cantidadCara: base.length };
}

// ═══ LA PANTALLA ══════════════════════════════════════════════════════════
async function abrirSimuladorFacial(fotoBlob, { estudioId = null, pacienteId = null, nombreFoto = "" } = {}) {
  const capa = document.createElement("div");
  capa.id = "simuladorFacial";
  capa.style.cssText = "position:fixed;inset:0;background:#16161c;z-index:9600;overflow-y:auto";
  capa.innerHTML = `<div class="loading" style="margin:80px auto;color:#eee"><div class="spinner"></div>Detectando la cara...</div>`;
  document.body.appendChild(capa);
  document.body.style.overflow = "hidden";

  const img = new Image();
  const url = URL.createObjectURL(fotoBlob);
  try {
    await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = url; });
  } catch {
    capa.innerHTML = sfErrorHtml("No se pudo abrir la foto.");
    sfEngancharCerrar(capa);
    return;
  }

  let deteccion;
  try {
    deteccion = await detectarEnImagen(img);
  } catch (e) {
    capa.innerHTML = sfErrorHtml("No se pudo cargar el detector facial: " + esc(e.message));
    sfEngancharCerrar(capa);
    return;
  }
  if (!deteccion) {
    capa.innerHTML = sfErrorHtml("No se detectó una cara clara. Para simular hace falta una foto nítida, de frente o de perfil, sin lentes ni gorra y con el pelo despejado.");
    sfEngancharCerrar(capa);
    return;
  }

  const { FaceLandmarker, landmarks } = deteccion;
  const base = regionesBase(FaceLandmarker);
  const marco = sfMarcoDeLaCara(landmarks, base);
  const grupos = sfGruposAnatomicos(landmarks, base, marco);
  const malla = sfArmarMalla(landmarks);

  simu = {
    capa, img, landmarks, base, marco, grupos, malla,
    valores: Object.fromEntries(SF_CONTROLES.map(c => [c.id, 0])),
    giro: 0,
    verOriginal: false,
    estudioId, pacienteId, nombreFoto,
  };

  pintarSimulador();
}

function sfErrorHtml(msg) {
  return `<div style="max-width:520px;margin:80px auto;padding:0 20px;color:#eee;text-align:center">
    <div style="font-size:38px;margin-bottom:10px">🙂</div>
    <div style="margin-bottom:18px">${msg}</div>
    <button class="visor-btn" data-cerrar-simu>Cerrar</button>
  </div>`;
}
function sfEngancharCerrar(capa) {
  capa.querySelectorAll("[data-cerrar-simu]").forEach(b => b.onclick = cerrarSimuladorFacial);
}

function cerrarSimuladorFacial() {
  const c = document.getElementById("simuladorFacial");
  if (c) c.remove();
  document.body.style.overflow = "";
  simu = null;
}

function pintarSimulador() {
  const { capa, img } = simu;
  const porGrupo = {};
  for (const c of SF_CONTROLES) (porGrupo[c.grupo] = porGrupo[c.grupo] || []).push(c);

  capa.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#0f0f14;color:#eee;gap:10px;position:sticky;top:0;z-index:2">
      <div>
        <div style="font-weight:600">Simulación quirúrgica</div>
        <div style="font-size:12px;opacity:.65">${esc(simu.nombreFoto || "Foto del paciente")} · ${img.naturalWidth}×${img.naturalHeight}</div>
      </div>
      <button class="visor-btn" data-cerrar-simu>✕</button>
    </div>

    <div style="position:relative;background:#0b0b0f">
      <canvas id="simuCanvas" style="display:block;width:100%;max-width:${img.naturalWidth}px;margin:0 auto"></canvas>
      <div id="simuSello" style="position:absolute;left:0;right:0;bottom:8px;text-align:center;color:#fff;font-size:12px;letter-spacing:.14em;text-shadow:0 1px 4px #000;pointer-events:none;opacity:.9">
        SIMULACIÓN — NO ES UNA PROMESA DE RESULTADO
      </div>
      <div id="simuEtiqueta" style="position:absolute;left:10px;top:10px;color:#fff;font-size:12px;background:rgba(0,0,0,.55);padding:3px 9px;border-radius:20px;pointer-events:none"></div>
    </div>

    <div style="background:#0f0f14;color:#eee;padding:12px 14px 30px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="visor-btn" id="simuComparar">👁️ Ver original</button>
        <button class="visor-btn" id="simuReset">↺ Reiniciar</button>
        <button class="visor-btn" id="simuGuardar" style="background:var(--primary);color:#fff">Guardar simulación</button>
      </div>

      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12px;margin-bottom:14px">
        <span style="opacity:.7;width:64px">Girar</span>
        <input type="range" id="simuGiro" min="-20" max="20" step="1" value="${simu.giro}">
        <span id="simuGiroVal" style="opacity:.7;width:44px;text-align:right">${simu.giro}°</span>
      </div>
      <div style="font-size:11.5px;opacity:.6;margin:-8px 0 16px;line-height:1.5">
        El giro llega hasta 20° porque más allá aparecería lo que la cámara nunca vio.
        Para ver el perfil hace falta una foto de perfil, y se simula aparte.
      </div>

      ${Object.entries(porGrupo).map(([grupo, ctrls]) => `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;margin-bottom:8px">${esc(grupo)}</div>
          ${ctrls.map(c => `
            <div style="margin-bottom:10px">
              <div style="display:grid;grid-template-columns:1fr auto;gap:8px;font-size:13px;margin-bottom:2px">
                <span>${esc(c.label)}</span>
                <span id="val-${c.id}" style="opacity:.6;font-variant-numeric:tabular-nums">${simu.valores[c.id]}</span>
              </div>
              <input type="range" data-ctrl="${c.id}" min="-100" max="100" step="1" value="${simu.valores[c.id]}" style="width:100%">
              <div style="font-size:11px;opacity:.5;margin-top:1px">${esc(c.ayuda)}</div>
            </div>`).join("")}
        </div>`).join("")}

      <div style="font-size:11.5px;opacity:.6;border-top:1px solid #26262f;padding-top:12px;line-height:1.6">
        Los rangos están acotados a lo quirúrgicamente plausible. Una simulación
        es una herramienta para entenderse con el paciente, no un resultado
        garantizado: el tejido, la cicatrización y la anatomía de cada persona
        mandan por encima de esto.
      </div>
    </div>`;

  sfEngancharCerrar(capa);

  const canvas = capa.querySelector("#simuCanvas");
  // Se renderiza a la resolución real de la foto: la simulación se puede
  // imprimir y mirar de cerca, no es una miniatura.
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  try {
    simu.gl = sfIniciarGL(canvas, img);
  } catch (e) {
    capa.innerHTML = sfErrorHtml("Este navegador no puede mostrar la simulación: " + esc(e.message));
    sfEngancharCerrar(capa);
    return;
  }

  capa.querySelectorAll("[data-ctrl]").forEach(sl => {
    const actualizar = () => {
      simu.valores[sl.dataset.ctrl] = Number(sl.value);
      capa.querySelector("#val-" + sl.dataset.ctrl).textContent = sl.value;
      renderSimulador();
    };
    sl.oninput = actualizar;
  });

  const giro = capa.querySelector("#simuGiro");
  giro.oninput = () => {
    simu.giro = Number(giro.value);
    capa.querySelector("#simuGiroVal").textContent = simu.giro + "°";
    renderSimulador();
  };

  const btnComparar = capa.querySelector("#simuComparar");
  const mostrar = (orig) => {
    simu.verOriginal = orig;
    btnComparar.textContent = orig ? "👁️ Ver simulación" : "👁️ Ver original";
    renderSimulador();
  };
  btnComparar.onclick = () => mostrar(!simu.verOriginal);
  // En celular, mantener apretado compara — es el gesto que todo el mundo
  // hace sin que se lo expliquen.
  btnComparar.onpointerdown = () => { if (!simu.verOriginal) { mostrar(true); btnComparar.__temp = true; } };
  const soltar = () => { if (btnComparar.__temp) { btnComparar.__temp = false; mostrar(false); } };
  btnComparar.onpointerup = soltar;
  btnComparar.onpointerleave = soltar;

  capa.querySelector("#simuReset").onclick = () => {
    for (const c of SF_CONTROLES) simu.valores[c.id] = 0;
    simu.giro = 0;
    pintarSimulador();
  };

  capa.querySelector("#simuGuardar").onclick = guardarSimulacion;

  renderSimulador();
}

function renderSimulador() {
  const { gl, malla, landmarks, base, marco, grupos, valores, giro, img } = simu;
  const n = malla.cantidadCara;

  const desp = simu.verOriginal
    ? landmarks.map(() => ({ x: 0, y: 0, z: 0 }))
    : sfDesplazamientos(valores, landmarks, base, marco, grupos);

  const verts = new Float32Array(malla.puntos.length * 3);
  for (let i = 0; i < malla.puntos.length; i++) {
    const p = malla.puntos[i];
    const d = i < n ? desp[i] : { x: 0, y: 0, z: 0 };
    verts[i * 3] = p.x + d.x;
    verts[i * 3 + 1] = p.y + d.y;
    verts[i * 3 + 2] = p.z + d.z;
  }

  const centro = { x: marco.centro.x, y: marco.centro.y };
  const aspecto = img.naturalHeight / img.naturalWidth;
  sfDibujar(gl, verts, malla.uvs, malla.indices, simu.verOriginal ? 0 : giro, centro, aspecto);

  const et = simu.capa.querySelector("#simuEtiqueta");
  if (et) et.textContent = simu.verOriginal ? "ORIGINAL" : "SIMULADO";
}

// Exporta la simulación como PNG con la marca quemada. Se quema y no se
// superpone por CSS a propósito: una captura de pantalla, un reenvío por
// WhatsApp o un recorte tienen que seguir diciendo que es una simulación.
function exportarSimulacionPng() {
  const { gl, img } = simu;
  const salida = document.createElement("canvas");
  salida.width = img.naturalWidth;
  salida.height = img.naturalHeight;
  const ctx = salida.getContext("2d");
  ctx.drawImage(gl.gl.canvas, 0, 0);

  const texto = "SIMULACIÓN — NO ES UNA PROMESA DE RESULTADO";
  const tipografia = (px) => `600 ${px}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  // El tamaño sale de la ALTURA, pero después tiene que entrar a lo ANCHO:
  // en una foto vertical —que es como se saca un retrato— el texto calculado
  // por la altura se salía por los dos costados y quedaba "MULACIÓN — NO ES
  // UNA PROMESA DE RESULTAD". Un sello cortado no sirve de sello.
  let alto = Math.max(12, Math.round(salida.height * 0.028));
  ctx.font = tipografia(alto);
  const anchoMaximo = salida.width * 0.92;
  let ancho = ctx.measureText(texto).width;
  if (ancho > anchoMaximo) {
    alto = Math.max(10, Math.floor(alto * anchoMaximo / ancho));
    ctx.font = tipografia(alto);
    ancho = ctx.measureText(texto).width;
  }
  const y = salida.height - alto * 0.6;
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect((salida.width - ancho) / 2 - alto * 0.5, y - alto * 1.15, ancho + alto, alto * 1.5);
  ctx.fillStyle = "#fff";
  ctx.fillText(texto, salida.width / 2, y);

  return new Promise(res => salida.toBlob(res, "image/png"));
}

async function guardarSimulacion() {
  const btn = simu.capa.querySelector("#simuGuardar");
  btn.disabled = true;
  btn.textContent = "Guardando...";
  try {
    const png = await exportarSimulacionPng();
    const params = new URLSearchParams({
      nombre: `Simulación · ${simu.nombreFoto || "cara"}`,
      fecha: new Date().toISOString().slice(0, 10),
      tipo: "foto",
    });
    await fetch(`${API}/medico/pacientes/${simu.pacienteId}/estudios?${params}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "image/png" },
      body: png,
    });
    btn.textContent = "✅ Guardada en la ficha";
    setTimeout(() => { if (btn.isConnected) { btn.disabled = false; btn.textContent = "Guardar simulación"; } }, 2200);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Guardar simulación";
    alert(e.error || "No se pudo guardar");
  }
}
