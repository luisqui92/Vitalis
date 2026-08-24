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
    // Un callejón sin salida acá sería fatal: el perfil cerrado es la vista
    // donde se juzga una rinoplastia, y es justo la que el detector no puede.
    simu = { capa, img, estudioId, pacienteId, nombreFoto, modo: "perfil" };
    sfPantallaMarcado(capa, img, (marcados) => sfArrancarPerfil(marcados));
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

// Arranca el simulador con los puntos que marcó el cirujano.
function sfArrancarPerfil(marcados) {
  const { img } = simu;
  const aspecto = img.naturalHeight / img.naturalWidth;
  const malla = sfMallaPerfil(marcados, aspecto);
  simu.malla = malla;
  simu.marcados = marcados;
  simu.valores = Object.fromEntries(SF_CONTROLES_PERFIL.map(c => [c.id, 0]));
  simu.giro = 0;
  simu.verOriginal = false;
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
  const esPerfil = simu.modo === "perfil";
  const controles = esPerfil ? SF_CONTROLES_PERFIL : SF_CONTROLES;
  const porGrupo = {};
  for (const c of controles) (porGrupo[c.grupo] = porGrupo[c.grupo] || []).push(c);

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

      ${esPerfil ? `
        <div style="font-size:11.5px;opacity:.6;margin:0 0 16px;line-height:1.5">
          Perfil marcado a mano. Acá no hay giro: una foto de perfil no trae
          profundidad para rotar, y girarla sería inventar.
          <a href="#" id="sfVolverAMarcar" style="color:var(--primary)">Corregir los puntos</a>
        </div>` : `
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12px;margin-bottom:14px">
          <span style="opacity:.7;width:64px">Girar</span>
          <input type="range" id="simuGiro" min="-20" max="20" step="1" value="${simu.giro}">
          <span id="simuGiroVal" style="opacity:.7;width:44px;text-align:right">${simu.giro}°</span>
        </div>
        <div style="font-size:11.5px;opacity:.6;margin:-8px 0 16px;line-height:1.5">
          El giro llega hasta 20° porque más allá aparecería lo que la cámara nunca vio.
          Para ver el perfil hace falta una foto de perfil, y se simula aparte.
          Si esta foto está de costado, conviene
          <a href="#" id="sfMarcarAMano" style="color:var(--primary)">marcar el perfil a mano</a>:
          el detector automático mira de frente.
        </div>`}

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

  // Un perfil izquierdo a veces SÍ lo detecta, y entonces el simulador abre
  // con los controles frontales, que no son los que se miran en un perfil.
  // Que se pueda pasar a mano a propósito, no solo cuando el detector falla.
  const marcarAMano = capa.querySelector("#sfMarcarAMano");
  if (marcarAMano) marcarAMano.onclick = (ev) => {
    ev.preventDefault();
    simu.modo = "perfil";
    sfPantallaMarcado(capa, img, (m) => sfArrancarPerfil(m), simu.marcados);
  };

  const volverAMarcar = capa.querySelector("#sfVolverAMarcar");
  if (volverAMarcar) volverAMarcar.onclick = (ev) => {
    ev.preventDefault();
    sfPantallaMarcado(capa, img, (m) => sfArrancarPerfil(m), simu.marcados);
  };

  const giro = capa.querySelector("#simuGiro");
  if (giro) giro.oninput = () => {
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
    for (const c of controles) simu.valores[c.id] = 0;
    simu.giro = 0;
    pintarSimulador();
  };

  capa.querySelector("#simuGuardar").onclick = guardarSimulacion;

  renderSimulador();
}

function renderSimulador() {
  const { gl, malla, valores, giro, img } = simu;
  const esPerfil = simu.modo === "perfil";
  const n = malla.cantidadCara;

  const desp = simu.verOriginal
    ? new Array(n).fill(0).map(() => ({ x: 0, y: 0, z: 0 }))
    : esPerfil
      ? sfDesplazamientosPerfil(valores, malla)
      : sfDesplazamientos(valores, simu.landmarks, simu.base, simu.marco, simu.grupos);

  const verts = new Float32Array(malla.puntos.length * 3);
  for (let i = 0; i < malla.puntos.length; i++) {
    const p = malla.puntos[i];
    const d = i < n ? desp[i] : { x: 0, y: 0, z: 0 };
    verts[i * 3] = p.x + d.x;
    verts[i * 3 + 1] = p.y + d.y;
    verts[i * 3 + 2] = p.z + d.z;
  }

  const centro = esPerfil
    ? { x: malla.contorno[Math.floor(malla.contorno.length / 2)].x, y: malla.contorno[Math.floor(malla.contorno.length / 2)].y }
    : { x: simu.marco.centro.x, y: simu.marco.centro.y };
  const aspecto = img.naturalHeight / img.naturalWidth;
  sfDibujar(gl, verts, malla.uvs, malla.indices, simu.verOriginal || esPerfil ? 0 : giro, centro, aspecto);

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

// ═══════════════════════════════════════════════════════════════════════════
// MODO PERFIL — cuando el detector no puede, el cirujano marca
// ═══════════════════════════════════════════════════════════════════════════
// MediaPipe necesita ver los dos ojos. En un perfil cerrado —justo la vista
// donde se juzga una rinoplastia— se queda sin referencias y no devuelve
// nada. La salida no es pedirle a la clínica que saque el perfil "menos de
// perfil": es que lo marque quien sabe.
//
// Y para un perfil eso es MEJOR que un detector: el cirujano sabe dónde está
// el punto de definición de la punta y dónde el rinion; un modelo entrenado
// con caras de frente, no. Son seis o siete clics y se hace una vez.
//
// El motor de deformación es otro que el de los 468 puntos, y más simple:
// acá el contorno ES el control. Cada punto del perfil se mueve por su
// propia normal —hacia afuera o hacia adentro de la cara— y una línea
// interior fija hace que la deformación quede en una franja pegada al
// contorno en vez de arrastrar toda la cabeza.

const SF_PUNTOS_PERFIL = [
  { id: "glabela",  label: "Glabela",       ayuda: "Lo más saliente de la frente, entre las cejas" },
  { id: "nasion",   label: "Nasion",        ayuda: "El hundimiento entre la frente y la nariz" },
  { id: "rinion",   label: "Dorso",         ayuda: "La mitad del puente — sobre la giba, si la hay" },
  { id: "punta",    label: "Punta",         ayuda: "El punto más saliente de la punta" },
  { id: "subnasal", label: "Subnasal",      ayuda: "Donde la base de la nariz se junta con el labio" },
  { id: "labioSup", label: "Labio superior" },
  { id: "labioInf", label: "Labio inferior" },
  { id: "surco",    label: "Surco mentolabial", ayuda: "El hundimiento entre el labio y el mentón" },
  { id: "pogonion", label: "Pogonion",      ayuda: "Lo más saliente del mentón" },
  { id: "gnation",  label: "Gnation",       ayuda: "El punto más bajo del mentón" },
];

// Qué tramo del contorno mueve cada control. Los índices son de la lista de
// arriba: el tramo va del primero al segundo, con difuminado en los bordes
// para que no queden esquinas donde la cara no las tiene.
const SF_CONTROLES_PERFIL = [
  { id: "giba",        label: "Dorso nasal (giba)",     grupo: "Nariz",  desde: 1, hasta: 3, max: 0.030, invertido: true,
    ayuda: "Bajar el puente. Es LA maniobra del perfil." },
  { id: "puntaProy",   label: "Proyección de la punta", grupo: "Nariz",  desde: 3, hasta: 4, max: 0.035,
    ayuda: "Cuánto sobresale la punta." },
  { id: "puntaRot",    label: "Rotación de la punta",   grupo: "Nariz",  desde: 3, hasta: 5, max: 0.028, vertical: true, invertido: true,
    ayuda: "Levantar o bajar la punta — cambia el ángulo nasolabial." },
  { id: "labiosPerfil",label: "Proyección de labios",   grupo: "Boca",   desde: 5, hasta: 7, max: 0.022 },
  { id: "mentonPerfil",label: "Proyección del mentón",  grupo: "Mentón", desde: 7, hasta: 9, max: 0.045,
    ayuda: "Cambia el equilibrio del perfil más que casi cualquier otra cosa." },
];

// ─── SPLINE ───────────────────────────────────────────────────────────────
// Los puntos marcados son pocos; el contorno que se deforma tiene que ser
// suave. Catmull-Rom pasa exactamente por los puntos marcados, que es lo que
// se quiere: si el cirujano puso la punta ahí, la curva pasa por ahí.
function sfSuavizar(puntos, porTramo = 7) {
  const salida = [];
  const p = (i) => puntos[Math.max(0, Math.min(puntos.length - 1, i))];
  for (let i = 0; i < puntos.length - 1; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    for (let k = 0; k < porTramo; k++) {
      const t = k / porTramo, t2 = t * t, t3 = t2 * t;
      salida.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        // De qué tramo de los marcados viene, para saber qué control lo toca.
        marcado: i + t,
      });
    }
  }
  const ultimo = puntos[puntos.length - 1];
  salida.push({ x: ultimo.x, y: ultimo.y, marcado: puntos.length - 1 });
  return salida;
}

// ─── LA MALLA DEL PERFIL ──────────────────────────────────────────────────
function sfMallaPerfil(marcados, aspecto) {
  const contorno = sfSuavizar(marcados);

  // ¿Para qué lado mira? La punta es el punto más extremo en horizontal
  // respecto de la línea frente-mentón. Con eso se sabe cuál es "afuera",
  // que es lo único que hace falta para orientar todas las normales.
  const medioX = (marcados[0].x + marcados[8].x) / 2;
  const signo = marcados[3].x < medioX ? -1 : 1;

  // Normal de cada punto: perpendicular a la tangente, apuntando afuera.
  // Se corrige por la relación de aspecto porque las coordenadas están
  // normalizadas 0..1 en los dos ejes y la foto no es cuadrada — sin eso las
  // normales salen torcidas y el mentón se mueve en diagonal.
  const normales = contorno.map((p, i) => {
    const a = contorno[Math.max(0, i - 1)], b = contorno[Math.min(contorno.length - 1, i + 1)];
    let tx = b.x - a.x, ty = (b.y - a.y) * aspecto;
    const n = Math.hypot(tx, ty) || 1;
    tx /= n; ty /= n;
    let nx = ty, ny = -tx;
    if (Math.sign(nx) !== signo) { nx = -nx; ny = -ny; }
    return { x: nx, y: ny / aspecto };
  });

  // Alto del perfil, para escalar los desplazamientos igual que el ancho de
  // la cara escala los del modo frontal.
  const alto = Math.hypot(marcados[9].x - marcados[0].x, (marcados[9].y - marcados[0].y) * aspecto);

  // La línea interior: el mismo contorno empujado hacia adentro. Queda FIJA,
  // y es lo que confina la deformación a una franja pegada al perfil en vez
  // de arrastrar la oreja y el pelo con ella.
  const dentro = contorno.map((p, i) => ({
    x: p.x - normales[i].x * alto * 0.16,
    y: p.y - normales[i].y * alto * 0.16,
  }));

  // Y la de afuera, también fija. Sin ella la deformación llegaba hasta el
  // marco de la foto y arrastraba el fondo con el perfil: en una foto de
  // consultorio contra una pared blanca no se nota, pero en una foto de
  // calle el cartel de atrás se doblaba junto con la nariz. Con esta línea
  // el estirón se absorbe en una franja angosta pegada a la cara y el resto
  // del fondo no se entera. Va más lejos que la interior porque el contorno
  // se mueve HACIA ella cuando se proyecta el mentón, y si la alcanzara los
  // triángulos se darían vuelta.
  // Se recorta al borde de la foto: si la cara está pegada al margen, la
  // línea de afuera se saldría de la imagen y el triángulo traería el píxel
  // del borde estirado hacia adentro.
  const dentroDeLaFoto = (v) => Math.min(1, Math.max(0, v));
  const fuera = contorno.map((p, i) => ({
    x: dentroDeLaFoto(p.x + normales[i].x * alto * 0.13),
    y: dentroDeLaFoto(p.y + normales[i].y * alto * 0.13),
  }));

  const marco = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    marco.push({ x: t, y: 0 }, { x: t, y: 1 }, { x: 0, y: t }, { x: 1, y: t });
  }

  const puntos = contorno.concat(dentro, fuera, marco).map(p => ({ x: p.x, y: p.y, z: 0 }));
  const tris = sfTriangular(puntos);
  return {
    puntos, contorno, normales, alto, signo,
    cantidadContorno: contorno.length,
    indices: new Uint16Array(tris.flat()),
    uvs: new Float32Array(puntos.flatMap(p => [p.x, p.y])),
    cantidadCara: contorno.length,
  };
}

// ─── DESPLAZAMIENTO EN MODO PERFIL ────────────────────────────────────────
function sfDesplazamientosPerfil(valores, malla) {
  const desp = malla.contorno.map(() => ({ x: 0, y: 0, z: 0 }));
  for (const ctrl of SF_CONTROLES_PERFIL) {
    const v = (valores[ctrl.id] || 0) / 100;
    if (!v) continue;
    const magnitud = v * ctrl.max * malla.alto * (ctrl.invertido ? -1 : 1);
    const centro = (ctrl.desde + ctrl.hasta) / 2;
    const radio = (ctrl.hasta - ctrl.desde) / 2;

    for (let i = 0; i < malla.contorno.length; i++) {
      const d = Math.abs(malla.contorno[i].marcado - centro);
      // Ventana con caída suave: 1 en el centro del tramo, 0 a un tramo de
      // distancia del borde. Un corte seco dejaría un escalón en el perfil.
      const peso = d <= radio ? 1 : Math.max(0, 1 - (d - radio) / 1.2);
      if (peso <= 0) continue;
      const suave = peso * peso * (3 - 2 * peso); // suavizado
      // La rotación de la punta es vertical (levanta o baja); el resto va
      // por la normal, que es como se proyecta o se retrae un relieve.
      const dir = ctrl.vertical ? { x: 0, y: 1 } : malla.normales[i];
      desp[i].x += dir.x * magnitud * suave;
      desp[i].y += dir.y * magnitud * suave;
    }
  }
  return desp;
}

// ─── LA PANTALLA DE MARCADO ───────────────────────────────────────────────
function sfPantallaMarcado(capa, img, alTerminar, previos = []) {
  // Se entra acá dos veces: la primera con la hoja en blanco, y después cada
  // vez que el cirujano toca "corregir los puntos". La segunda vez tiene que
  // encontrar sus diez puntos donde los dejó — hacerle marcar los diez de
  // nuevo para mover la punta dos milímetros es lo que hace que una
  // herramienta se deje de usar.
  const marcados = previos.map(p => ({ x: p.x, y: p.y }));
  capa.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#0f0f14;color:#eee;gap:10px;position:sticky;top:0;z-index:2">
      <div>
        <div style="font-weight:600">Marcá el perfil</div>
        <div id="sfPaso" style="font-size:12px;opacity:.7"></div>
      </div>
      <button class="visor-btn" data-cerrar-simu>✕</button>
    </div>
    <div class="hint" style="color:#bbb;background:#0f0f14;padding:0 14px 10px;margin:0;font-size:12.5px">
      El detector automático necesita ver los dos ojos, y en un perfil cerrado no puede.
      Marcalo vos: son 10 clics y para el perfil sale mejor, porque vos sabés dónde está
      cada punto y el modelo no.
    </div>
    <div style="position:relative;background:#0b0b0f;text-align:center">
      <canvas id="sfLienzoMarcado" style="display:block;max-width:100%;margin:0 auto;cursor:crosshair"></canvas>
    </div>
    <div style="background:#0f0f14;color:#eee;padding:12px 14px 30px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="visor-btn" id="sfDeshacer">↶ Deshacer</button>
      <button class="visor-btn" id="sfReiniciarMarcas">↺ Empezar de nuevo</button>
      <button class="visor-btn" id="sfListo" style="background:var(--primary);color:#fff;display:none">Listo, simular</button>
    </div>`;
  sfEngancharCerrar(capa);

  const lienzo = capa.querySelector("#sfLienzoMarcado");
  // Se dibuja a un tamaño manejable en pantalla; los puntos se guardan
  // normalizados 0..1, así que la resolución de trabajo no importa.
  const escala = Math.min(1, 900 / img.naturalWidth, 1100 / img.naturalHeight);
  lienzo.width = Math.round(img.naturalWidth * escala);
  lienzo.height = Math.round(img.naturalHeight * escala);
  const ctx = lienzo.getContext("2d");

  function pintar() {
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    // La línea que se va formando, para que se vea el perfil tomando forma.
    if (marcados.length > 1) {
      ctx.beginPath();
      marcados.forEach((p, i) => {
        const x = p.x * lienzo.width, y = p.y * lienzo.height;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    marcados.forEach((p, i) => {
      const x = p.x * lienzo.width, y = p.y * lienzo.height;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#111"; ctx.stroke();
      ctx.fillStyle = "#111"; ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x, y);
    });

    const paso = capa.querySelector("#sfPaso");
    const listo = capa.querySelector("#sfListo");
    if (marcados.length < SF_PUNTOS_PERFIL.length) {
      const p = SF_PUNTOS_PERFIL[marcados.length];
      paso.innerHTML = `<b>${marcados.length + 1}/${SF_PUNTOS_PERFIL.length} · ${esc(p.label)}</b>${p.ayuda ? " — " + esc(p.ayuda) : ""}`;
      listo.style.display = "none";
    } else {
      paso.innerHTML = "Los 10 puntos están. Podés corregir cualquiera arrastrándolo.";
      listo.style.display = "";
    }
  }

  // Arrastrar un punto ya puesto para corregirlo: en un perfil, dos o tres
  // milímetros en la punta cambian el resultado, y nadie acierta al primer
  // clic en una pantalla de celular.
  let arrastrando = -1;
  const posicion = (ev) => {
    const r = lienzo.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  };
  // La cercanía se mide en PÍXELES de pantalla, no en las coordenadas
  // normalizadas: como la foto es más alta que ancha, mezclar los dos ejes
  // estiraba la zona de agarre hacia arriba y hacia abajo, justo donde el
  // labio de arriba y el de abajo caen a pocos milímetros uno del otro —
  // el clic del labio inferior terminaba arrastrando el superior.
  const cercano = (p) => {
    let mejor = -1, d2 = 11 ** 2;
    marcados.forEach((m, i) => {
      const dd = ((m.x - p.x) * lienzo.width) ** 2 + ((m.y - p.y) * lienzo.height) ** 2;
      if (dd < d2) { d2 = dd; mejor = i; }
    });
    return mejor;
  };

  lienzo.onpointerdown = (ev) => {
    const p = posicion(ev);
    const i = cercano(p);
    if (i >= 0) { arrastrando = i; lienzo.setPointerCapture(ev.pointerId); return; }
    if (marcados.length < SF_PUNTOS_PERFIL.length) { marcados.push(p); pintar(); }
  };
  lienzo.onpointermove = (ev) => {
    if (arrastrando < 0) return;
    marcados[arrastrando] = posicion(ev);
    pintar();
  };
  lienzo.onpointerup = () => { arrastrando = -1; };

  capa.querySelector("#sfDeshacer").onclick = () => { marcados.pop(); pintar(); };
  capa.querySelector("#sfReiniciarMarcas").onclick = () => { marcados.length = 0; pintar(); };
  capa.querySelector("#sfListo").onclick = () => alTerminar(marcados.slice());

  pintar();
}
