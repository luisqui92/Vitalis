// Vitalis — Simulación 2.5D con las cinco vistas
// ═══════════════════════════════════════════════════════════════════════════
//
// La idea equivocada era hacer girar UNA foto. Una foto no trae profundidad:
// para girarla hay que inventar el relieve, y cuando la foto ya está de
// costado —una de 45°, que es la mitad del protocolo— la malla se cruza
// consigo misma y la cara se hace tiras. Eso no era un ajuste pendiente: era
// pedirle a la geometría algo que no tiene.
//
// Lo que sí hay son cinco fotos de la misma cara desde cinco ángulos. El
// giro entonces no se inventa: se recorre. Se arrastra y aparece la foto de
// ese ángulo, con un fundido en el medio para que el paso no sea un corte.
// Cada cuadro que se ve es una fotografía real del paciente, no un modelo
// genérico ajustado a su cara.
//
// Y la simulación viaja con el giro: el mismo valor de "bajar la giba" se
// aplica a la malla propia de cada vista, así que se gira y se ve la misma
// cirugía desde el otro ángulo. Eso es lo que se mira en una consulta —una
// rinoplastia se juzga de perfil y se controla de frente— y es lo que una
// sola foto nunca pudo mostrar.
//
// Prefijo s25* en todo lo de acá: en este proyecto no hay módulos y las
// funciones sueltas se pisan entre archivos en silencio.

const S25_VISTAS = [
  { angulo: "perfil_izquierdo",   grados: -90, label: "Perfil izquierdo" },
  { angulo: "angulo45_izquierda", grados: -45, label: "45° izquierda" },
  { angulo: "frontal",            grados: 0,   label: "Frontal" },
  { angulo: "angulo45_derecha",   grados: 45,  label: "45° derecha" },
  { angulo: "perfil_derecho",     grados: 90,  label: "Perfil derecho" },
];

// Los controles son los mismos de la vista frontal; en las vistas marcadas a
// mano se traducen a los del perfil. Los que no están en esta tabla —ancho
// de alas, pómulos, párpado— simplemente no mueven nada en un perfil, que es
// lo correcto: en un perfil cerrado no se ve el ancho de la base nasal.
const S25_MAPA_PERFIL = {
  dorso: "giba",
  proyeccionPunta: "puntaProy",
  rotacionPunta: "puntaRot",
  labios: "labiosPerfil",
  mentonProyeccion: "mentonPerfil",
};

let s25 = null;

// ═══ WEBGL CON VARIAS TEXTURAS Y FUNDIDO ═══════════════════════════════════
// El simulador de una sola foto arma un contexto por imagen. Acá hacen falta
// las cinco a la vez sobre el mismo lienzo, y con alfa para el fundido.
const S25_VERT = `
attribute vec2 pos;
attribute vec2 uv;
varying vec2 vuv;
void main() {
  gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);
  vuv = uv;
}`;

const S25_FRAG = `
precision mediump float;
uniform sampler2D foto;
uniform float alfa;
varying vec2 vuv;
void main() {
  vec4 c = texture2D(foto, vuv);
  gl_FragColor = vec4(c.rgb, c.a * alfa);
}`;

function s25IniciarGL(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL no disponible");
  const prog = gl.createProgram();
  gl.attachShader(prog, sfCompilarShader(gl, gl.VERTEX_SHADER, S25_VERT));
  gl.attachShader(prog, sfCompilarShader(gl, gl.FRAGMENT_SHADER, S25_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return {
    gl, prog,
    bufPos: gl.createBuffer(), bufUv: gl.createBuffer(), bufIdx: gl.createBuffer(),
    loc: {
      pos: gl.getAttribLocation(prog, "pos"),
      uv: gl.getAttribLocation(prog, "uv"),
      foto: gl.getUniformLocation(prog, "foto"),
      alfa: gl.getUniformLocation(prog, "alfa"),
    },
  };
}

function s25Textura(ctx, imagen) {
  const { gl } = ctx;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imagen);
  return tex;
}

function s25Dibujar(ctx, tex, verts, uvs, indices, alfa) {
  const { gl, loc } = ctx;
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.bufPos);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.bufUv);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(loc.uv);
  gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ctx.bufIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc.foto, 0);
  gl.uniform1f(loc.alfa, alfa);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
}

// ═══ ANCLAJE ENTRE VISTAS ══════════════════════════════════════════════════
// Si cada foto tiene la cara en otro lugar y a otro tamaño, girar se ve como
// un corte de montaje y no como una cabeza que gira. Se alinean por dos
// puntos que existen en las dos clases de vista y que el giro de la cabeza
// casi no cambia en vertical: la punta de la nariz y el borde del mentón.
function s25Ancla(vista) {
  if (vista.modo === "auto") {
    const lm = vista.landmarks, g = vista.grupos;
    const prom = (idxs) => ({
      x: idxs.reduce((a, i) => a + lm[i].x, 0) / idxs.length,
      y: idxs.reduce((a, i) => a + lm[i].y, 0) / idxs.length,
    });
    return { punta: prom(g.punta), menton: { x: vista.marco.menton.x, y: vista.marco.menton.y } };
  }
  if (vista.marcados) {
    return { punta: { ...vista.marcados[SF_IDX_PERFIL.punta] },
             menton: { ...vista.marcados[SF_IDX_PERFIL.gnation] } };
  }
  return null;
}

// Lleva las coordenadas de una vista al encuadre de referencia. Solo escala
// y traslada: rotar o deformar para calzarlas sería volver a inventar.
// En horizontal el ancla es la PUNTA DE LA NARIZ y no el mentón. Con el
// mentón, al girar a perfil la cabeza queda toda de un lado y la nariz se iba
// del cuadro. Con la punta, la cabeza pivota alrededor de la nariz: se queda
// centrada en todas las vistas, que además es lo que se está mirando cuando
// se evalúa una rinoplastia. En vertical sigue mandando el mentón, que es el
// borde duro de la cara y el que el giro de la cabeza casi no mueve.
function s25Encuadre(vista, ref) {
  const a = vista.ancla;
  if (!a || !ref) return { s: 1, dx: 0, dy: 0 };
  const propio = Math.abs(a.menton.y - a.punta.y) || 1;
  const s = ref.alto / propio;
  return { s, dx: ref.punta.x - a.punta.x * s, dy: ref.menton.y - a.menton.y * s };
}

// Al alinear las narices, los encuadres se separan casi medio ancho: la
// nariz de un perfil izquierdo y la de un 45° derecho están en extremos
// opuestos de sus fotos. Recortar a lo que TODAS cubren dejaba una tira
// vertical angosta; dejarlo sin recortar dejaba bandas negras entrando y
// saliendo al girar.
//
// Se probó estirar el borde de cada foto para tapar el cuadro, y fue peor:
// en un perfil la nariz es lo más cerca del borde que hay, el estirón la
// agarra y sale un pico. Así que se recorta: se muestra el rectángulo que
// TODAS las vistas cubren. Queda un encuadre vertical y angosto —un retrato
// de cara, que para esto es lo que corresponde— y no se pierde nada de cara.
//
// Que quede angosto no es un defecto a corregir con más código: alinear la
// nariz de un perfil izquierdo con la de un 45° derecho separa los encuadres
// casi medio ancho, y eso es lo que hay. Se arregla del lado de la cámara,
// sacando las cinco fotos con la cabeza en el mismo lugar del cuadro.
function s25RectoComun(vistas, ref) {
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
  for (const v of vistas) {
    const { s, dx, dy } = s25Encuadre(v, ref);
    x0 = Math.max(x0, dx);       y0 = Math.max(y0, dy);
    x1 = Math.min(x1, s + dx);   y1 = Math.min(y1, s + dy);
  }
  if (x1 - x0 < 0.15 || y1 - y0 < 0.15) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

// ═══ CARGA DE LAS VISTAS ═══════════════════════════════════════════════════
async function s25CargarVista(entrada) {
  const img = new Image();
  const url = URL.createObjectURL(entrada.blob);
  await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = url; });

  const vista = {
    // La url se guarda además de la imagen: la consola pone miniaturas con
    // <img src>, y sin esto salían todas negras.
    ...entrada, img, url,
    modo: "sinMarcar",
    malla: s25MallaPlana(),
  };

  // Si esta vista ya se marcó alguna vez —acá o en la consola— se usa lo
  // guardado y no se le vuelven a pedir los clics.
  const guardado = entrada.estudio && entrada.estudio.perfilMarcado;
  const hayMarcado = Array.isArray(guardado) && guardado.length === SF_PUNTOS_PERFIL.length;
  const usarMarcado = () => {
    vista.marcados = guardado.map(p => ({ x: p.x, y: p.y }));
    vista.malla = sfMallaPerfil(vista.marcados, img.naturalHeight / img.naturalWidth);
    vista.modo = "perfil";
    vista.ancla = s25Ancla(vista);
    return vista;
  };
  // En un perfil, lo que marcó el cirujano gana sobre el detector y ni
  // siquiera se lo consulta: el detector necesita ver los dos ojos, y lo que
  // devuelve en un perfil cerrado —cuando devuelve algo— es peor que diez
  // clics de alguien que sabe dónde está el rinion.
  if (hayMarcado && Math.abs(entrada.grados) === 90) return usarMarcado();

  let deteccion = null;
  try { deteccion = await detectarEnImagen(img); } catch { deteccion = null; }
  if (!deteccion && hayMarcado) return usarMarcado();
  if (deteccion) {
    const { FaceLandmarker, landmarks } = deteccion;
    const base = regionesBase(FaceLandmarker);
    vista.modo = "auto";
    vista.landmarks = landmarks;
    vista.base = base;
    // Se guarda el propio FaceLandmarker porque el mapa anatómico y el de
    // simetría lo piden para volver a derivar sus regiones.
    vista.FaceLandmarker = FaceLandmarker;
    vista.marco = sfMarcoDeLaCara(landmarks, base);
    vista.grupos = sfGruposAnatomicos(landmarks, base, vista.marco);
    vista.malla = sfArmarMalla(landmarks);
  }
  vista.ancla = s25Ancla(vista);
  return vista;
}

// Una vista sin marcar igual se muestra: es la foto del paciente desde ese
// ángulo, que es la mitad del valor. Lo que no tiene es simulación encima.
function s25MallaPlana() {
  const puntos = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  return {
    puntos, cantidadCara: 0, cantidadMarco: 4,
    indices: new Uint16Array([0, 1, 2, 1, 3, 2]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
  };
}

// ═══ LOS VÉRTICES DE UNA VISTA, YA DEFORMADOS Y ENCUADRADOS ════════════════
function s25Vertices(vista, valores, ref, recorte, verOriginal) {
  const malla = vista.malla;
  const n = malla.cantidadCara;
  let desp = null;

  if (!verOriginal && n > 0) {
    if (vista.modo === "auto") {
      desp = sfDesplazamientos(valores, vista.landmarks, vista.base, vista.marco, vista.grupos);
    } else if (vista.modo === "perfil") {
      const vp = {};
      for (const [comun, propio] of Object.entries(S25_MAPA_PERFIL)) vp[propio] = valores[comun] || 0;
      desp = sfDesplazamientosPerfil(vp, malla);
    }
  }

  const { s, dx, dy } = s25Encuadre(vista, ref);
  const r = recorte;
  const anchoR = r.x1 - r.x0, altoR = r.y1 - r.y0;
  const verts = new Float32Array(malla.puntos.length * 2);
  for (let i = 0; i < malla.puntos.length; i++) {
    const p = malla.puntos[i];
    const d = desp && i < n ? desp[i] : null;
    verts[i * 2]     = ((p.x + (d ? d.x : 0)) * s + dx - r.x0) / anchoR;
    verts[i * 2 + 1] = ((p.y + (d ? d.y : 0)) * s + dy - r.y0) / altoR;
  }
  return verts;
}

// ═══ EL MOTOR DEL GIRO ═════════════════════════════════════════════════════
// Vive aparte de la pantalla que lo usa: lo dibuja igual el simulador a
// pantalla completa que el visor embebido de la consola. Tener dos copias de
// esto era garantía de que una de las dos se quedara vieja.
function s25Motor(canvas, vistas, ref) {
  const ctx = s25IniciarGL(canvas);
  for (const v of vistas) v.tex = s25Textura(ctx, v.img);
  return {
    ctx, vistas, ref,
    recorte: s25RectoComun(vistas, ref),
    // Devuelve cuál vista quedó al frente, que es lo que la interfaz necesita
    // saber para poder nombrarla y avisar si no está marcada.
    render(grados, valores, verOriginal) {
      return s25RenderEn(this, grados, valores, verOriginal);
    },
  };
}

// Entre dos vistas reales se funde de una a la otra. No se interpola la
// geometría: no hay información para saber cómo se ve la cara a 22°, y
// fabricarla sería exactamente el error del que venimos.
function s25RenderEn(motor, g, valores, verOriginal) {
  const { ctx, vistas, ref, recorte } = motor;
  const gl = ctx.gl;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.043, 0.043, 0.059, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  let antes = vistas[0], despues = vistas[vistas.length - 1];
  for (const v of vistas) {
    if (v.grados <= g && v.grados >= antes.grados) antes = v;
  }
  for (let i = vistas.length - 1; i >= 0; i--) {
    if (vistas[i].grados >= g && vistas[i].grados <= despues.grados) despues = vistas[i];
  }

  // El fundido es CORTO y va pegado al punto medio entre las dos vistas.
  // Repartido a lo largo de los 45° que las separan, la mitad del recorrido
  // mostraba las dos caras superpuestas: no se lee como una cabeza que gira,
  // se lee como una doble exposición. Con una ventana angosta, casi todo el
  // giro muestra una foto sola y limpia, y el cambio no es un corte seco.
  let t = 0;
  if (antes !== despues) {
    const salto = despues.grados - antes.grados;
    const medio = antes.grados + salto / 2;
    const ventana = Math.max(4, Math.min(9, salto * 0.2));
    const u = Math.max(0, Math.min(1, (g - (medio - ventana / 2)) / ventana));
    t = u * u * (3 - 2 * u);
  }

  s25Dibujar(ctx, antes.tex, s25Vertices(antes, valores, ref, recorte, verOriginal),
             antes.malla.uvs, antes.malla.indices, 1);
  if (t > 0.001) {
    s25Dibujar(ctx, despues.tex, s25Vertices(despues, valores, ref, recorte, verOriginal),
               despues.malla.uvs, despues.malla.indices, t);
  }
  return t < 0.5 ? antes : despues;
}

// La pantalla completa: dibuja con el motor y después acomoda su propio pie.
function s25RenderGiro() {
  s25.vistaActual = s25.motor.render(s25.grados, s25.valores, s25.verOriginal);
  s25ActualizarPie();
}

function s25ActualizarPie() {
  const v = s25.vistaActual;
  const et = s25.capa.querySelector("#s25Etiqueta");
  if (et) et.textContent = s25.verOriginal ? "ORIGINAL" : "SIMULADO";
  const nom = s25.capa.querySelector("#s25Vista");
  if (nom) nom.textContent = v ? v.label : "";
  const aviso = s25.capa.querySelector("#s25Aviso");
  if (aviso) {
    const sinMarcar = v && v.modo === "sinMarcar";
    aviso.style.display = sinMarcar ? "" : "none";
    if (sinMarcar) aviso.querySelector("b").textContent = v.label;
  }
}

// ═══ CARGA DEL JUEGO DE VISTAS ═════════════════════════════════════════════
// Aparte de la pantalla, porque la consola de Vitalis Face carga exactamente
// lo mismo y no tiene por qué repetirlo.
async function s25CargarVistas(estudios, avisar) {
  // Una foto por ángulo: si hay varias del mismo ángulo se toma la más
  // reciente, que en una ficha de estética es la del control más nuevo.
  const porAngulo = new Map();
  for (const e of estudios) {
    if (e.tipo !== "foto" || !e.anguloFoto) continue;
    if (!S25_VISTAS.some(v => v.angulo === e.anguloFoto)) continue;
    const previo = porAngulo.get(e.anguloFoto);
    if (!previo || new Date(e.fecha) > new Date(previo.fecha)) porAngulo.set(e.anguloFoto, e);
  }
  const entradas = S25_VISTAS
    .filter(v => porAngulo.has(v.angulo))
    .map(v => ({ ...v, estudio: porAngulo.get(v.angulo) }));

  const vistas = [];
  for (const e of entradas) {
    if (avisar) avisar(`Cargando ${e.label.toLowerCase()}...`);
    const blob = await traerBlobEstudio(e.estudio._id);
    if (!blob) continue;
    vistas.push(await s25CargarVista({ ...e, blob, estudioId: e.estudio._id }));
  }

  // El encuadre de referencia sale de la vista de más al centro que se haya
  // podido detectar: es la que tiene la cara más completa.
  const conAncla = vistas.filter(v => v.ancla);
  const base = conAncla.sort((a, b) => Math.abs(a.grados) - Math.abs(b.grados))[0] || null;
  if (base) base.esReferencia = true;
  const ref = base ? {
    menton: { ...base.ancla.menton },
    punta: { ...base.ancla.punta },
    alto: Math.abs(base.ancla.menton.y - base.ancla.punta.y),
  } : null;

  return { vistas, ref };
}

function s25LiberarVistas(vistas) {
  for (const v of vistas || []) if (v.url) URL.revokeObjectURL(v.url);
}

// ═══ LA PANTALLA ═══════════════════════════════════════════════════════════
async function abrirSimulador25D(pacienteId, estudios) {
  const capa = document.createElement("div");
  capa.id = "simulador25d";
  capa.style.cssText = "position:fixed;inset:0;background:#16161c;z-index:9600;overflow-y:auto";
  capa.innerHTML = `<div class="loading" style="margin:80px auto;color:#eee"><div class="spinner"></div>Cargando las vistas...</div>`;
  document.body.appendChild(capa);
  document.body.style.overflow = "hidden";

  const { vistas, ref } = await s25CargarVistas(estudios);
  if (vistas.length < 2) {
    capa.innerHTML = s25ErrorHtml(
      "Para girar hacen falta al menos dos vistas. Subí las fotos con su ángulo "
      + "(frontal, 45° y perfil de cada lado) y volvé a entrar.");
    s25EngancharCerrar(capa);
    return;
  }

  s25 = {
    capa, pacienteId, vistas, ref,
    grados: vistas.some(v => v.grados === 0) ? 0 : vistas[0].grados,
    valores: Object.fromEntries(SF_CONTROLES.map(c => [c.id, 0])),
    verOriginal: false,
    vistaActual: null,
  };

  s25Pintar();
}

function s25ErrorHtml(msg) {
  return `<div style="max-width:520px;margin:80px auto;padding:0 20px;color:#eee;text-align:center">
    <div style="font-size:38px;margin-bottom:10px">🙂</div>
    <div style="margin-bottom:18px">${esc(msg)}</div>
    <button class="visor-btn" data-cerrar-25d>Cerrar</button>
  </div>`;
}
function s25EngancharCerrar(capa) {
  capa.querySelectorAll("[data-cerrar-25d]").forEach(b => b.onclick = cerrarSimulador25D);
}
function cerrarSimulador25D() {
  const c = document.getElementById("simulador25d");
  if (c) c.remove();
  document.body.style.overflow = "";
  s25 = null;
}

function s25Pintar() {
  const { capa, vistas } = s25;
  const primera = vistas[0].img;
  // El lienzo toma el tamaño del recorte común sobre la vista de referencia,
  // para que los píxeles no queden estirados en ningún eje.
  const refImg = (vistas.find(v => v.esReferencia) || vistas[0]).img;
  const rec = s25.motor ? s25.motor.recorte : s25RectoComun(vistas, s25.ref);
  const lienzoW = Math.max(16, Math.round(refImg.naturalWidth * (rec.x1 - rec.x0)));
  const lienzoH = Math.max(16, Math.round(refImg.naturalHeight * (rec.y1 - rec.y0)));
  const porGrupo = {};
  for (const c of SF_CONTROLES) (porGrupo[c.grupo] = porGrupo[c.grupo] || []).push(c);

  const minG = Math.min(...vistas.map(v => v.grados));
  const maxG = Math.max(...vistas.map(v => v.grados));

  capa.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#0f0f14;color:#eee;gap:10px;position:sticky;top:0;z-index:2">
      <div>
        <div style="font-weight:600">Simulación 2.5D</div>
        <div style="font-size:12px;opacity:.65">${vistas.length} vistas reales · <span id="s25Vista"></span></div>
      </div>
      <button class="visor-btn" data-cerrar-25d>✕</button>
    </div>

    <div style="position:relative;background:#0b0b0f">
      <canvas id="s25Canvas" style="display:block;width:100%;max-width:${lienzoW}px;margin:0 auto;touch-action:none;cursor:ew-resize"></canvas>
      <div id="s25Sello" style="position:absolute;left:0;right:0;bottom:8px;text-align:center;color:#fff;font-size:12px;letter-spacing:.14em;text-shadow:0 1px 4px #000;pointer-events:none;opacity:.9">
        SIMULACIÓN — NO ES UNA PROMESA DE RESULTADO
      </div>
      <div id="s25Etiqueta" style="position:absolute;left:10px;top:10px;color:#fff;font-size:12px;background:rgba(0,0,0,.55);padding:3px 9px;border-radius:20px;pointer-events:none"></div>
    </div>

    <div style="background:#0f0f14;color:#eee;padding:12px 14px 30px">
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12px;margin-bottom:6px">
        <span style="opacity:.7;width:52px">Girar</span>
        <input type="range" id="s25Giro" min="${minG}" max="${maxG}" step="1" value="${s25.grados}">
        <span id="s25GiroVal" style="opacity:.7;width:44px;text-align:right">${s25.grados}°</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${vistas.map(v => `<button class="visor-btn" data-ir="${v.grados}" style="font-size:11.5px;padding:4px 9px">${esc(v.label)}</button>`).join("")}
      </div>
      <div style="font-size:11.5px;opacity:.6;margin:0 0 14px;line-height:1.5">
        Cada posición es una foto real del paciente, no un modelo. Entre una y otra
        se funde: no se inventa cómo se vería la cara en un ángulo del que no hay foto.
        Arrastrá sobre la imagen para girar.
      </div>

      <div id="s25Aviso" style="display:none;font-size:11.5px;background:#2a2410;border:1px solid #574a19;color:#e8d9a8;padding:8px 10px;border-radius:8px;margin-bottom:14px;line-height:1.5">
        La vista <b></b> todavía no está marcada: se ve la foto original, sin la simulación encima.
        <a href="#" id="s25Marcar" style="color:#ffd76e">Marcarla ahora</a> — son ${SF_PUNTOS_PERFIL.length} clics sobre el contorno.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <button class="visor-btn" id="s25Comparar">👁️ Ver original</button>
        <button class="visor-btn" id="s25Reset">↺ Reiniciar</button>
        <button class="visor-btn" id="s25Guardar" style="background:var(--primary);color:#fff">Guardar esta vista</button>
      </div>

      ${Object.entries(porGrupo).map(([grupo, ctrls]) => `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;margin-bottom:8px">${esc(grupo)}</div>
          ${ctrls.map(c => `
            <div style="margin-bottom:10px">
              <div style="display:grid;grid-template-columns:1fr auto;gap:8px;font-size:13px;margin-bottom:2px">
                <span>${esc(c.label)}${S25_MAPA_PERFIL[c.id] ? "" : ` <span style="opacity:.45;font-size:11px">· no se ve de perfil</span>`}</span>
                <span id="s25val-${c.id}" style="opacity:.6;font-variant-numeric:tabular-nums">${s25.valores[c.id]}</span>
              </div>
              <input type="range" data-ctrl25="${c.id}" min="-100" max="100" step="1" value="${s25.valores[c.id]}" style="width:100%">
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

  s25EngancharCerrar(capa);

  const canvas = capa.querySelector("#s25Canvas");
  canvas.width = lienzoW;
  canvas.height = lienzoH;
  try {
    s25.motor = s25Motor(canvas, s25.vistas, s25.ref);
    s25.ctx = s25.motor.ctx; // lo usa el exportador del PNG
  } catch (e) {
    capa.innerHTML = s25ErrorHtml("Este navegador no puede mostrar la simulación: " + e.message);
    s25EngancharCerrar(capa);
    return;
  }

  const giro = capa.querySelector("#s25Giro");
  const aplicarGiro = (g) => {
    s25.grados = Math.max(Number(giro.min), Math.min(Number(giro.max), Math.round(g)));
    giro.value = String(s25.grados);
    capa.querySelector("#s25GiroVal").textContent = s25.grados + "°";
    s25RenderGiro();
  };
  giro.oninput = () => aplicarGiro(Number(giro.value));
  capa.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => aplicarGiro(Number(b.dataset.ir)));

  // Arrastrar sobre la foto para girar: es el gesto que la gente prueba sola
  // cuando ve algo que gira, antes de buscar el control.
  let arrastre = null;
  canvas.onpointerdown = (ev) => {
    arrastre = { x: ev.clientX, g: s25.grados };
    canvas.setPointerCapture(ev.pointerId);
  };
  canvas.onpointermove = (ev) => {
    if (!arrastre) return;
    const rango = Number(giro.max) - Number(giro.min);
    aplicarGiro(arrastre.g + (ev.clientX - arrastre.x) / canvas.getBoundingClientRect().width * rango);
  };
  canvas.onpointerup = () => { arrastre = null; };
  canvas.onpointercancel = () => { arrastre = null; };

  capa.querySelectorAll("[data-ctrl25]").forEach(sl => {
    sl.oninput = () => {
      s25.valores[sl.dataset.ctrl25] = Number(sl.value);
      capa.querySelector("#s25val-" + sl.dataset.ctrl25).textContent = sl.value;
      s25RenderGiro();
    };
  });

  const btnComparar = capa.querySelector("#s25Comparar");
  const mostrar = (orig) => {
    s25.verOriginal = orig;
    btnComparar.textContent = orig ? "👁️ Ver simulación" : "👁️ Ver original";
    s25RenderGiro();
  };
  btnComparar.onclick = () => mostrar(!s25.verOriginal);
  btnComparar.onpointerdown = () => { if (!s25.verOriginal) { mostrar(true); btnComparar.__temp = true; } };
  const soltar = () => { if (btnComparar.__temp) { btnComparar.__temp = false; mostrar(false); } };
  btnComparar.onpointerup = soltar;
  btnComparar.onpointerleave = soltar;

  capa.querySelector("#s25Reset").onclick = () => {
    for (const c of SF_CONTROLES) s25.valores[c.id] = 0;
    s25Pintar();
  };
  capa.querySelector("#s25Guardar").onclick = s25Guardar;
  capa.querySelector("#s25Marcar").onclick = (ev) => { ev.preventDefault(); s25MarcarVistaActual(); };

  s25RenderGiro();
}

// Marcar a mano la vista que se está mirando, con el mismo marcado del
// simulador de una foto: diez puntos del contorno.
function s25MarcarVistaActual() {
  const vista = s25.vistaActual;
  if (!vista) return;
  const capa = s25.capa;
  const guardado = { grados: s25.grados, valores: { ...s25.valores } };
  sfPantallaMarcado(capa, vista.img, (marcados) => {
    const aspecto = vista.img.naturalHeight / vista.img.naturalWidth;
    vista.malla = sfMallaPerfil(marcados, aspecto);
    vista.marcados = marcados;
    vista.modo = "perfil";
    s25GuardarMarcado(vista);
    vista.ancla = s25Ancla(vista);
    // Marcar una vista le da un ancla que antes no tenía: el rectángulo que
    // todas cubren cambia. s25Pintar rearma el motor entero, que lo recalcula.
    s25.motor = null;
    s25.grados = guardado.grados;
    s25.valores = guardado.valores;
    s25Pintar();
  }, vista.marcados);
}

// Marcar el perfil cuesta una decena de clics; se guardan para no volver a pedirlos
// —y porque de esos puntos salen los ángulos del perfil que muestra la
// consola. Si falla, no se interrumpe nada: la simulación en curso sigue.
async function s25GuardarMarcado(vista) {
  if (!vista.estudioId || !Array.isArray(vista.marcados)) return;
  try {
    await fetch(`${API}/medico/estudios/${vista.estudioId}/visor`, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ perfilMarcado: vista.marcados.map(p => ({ x: p.x, y: p.y })) }),
    });
  } catch { /* que no se pierda la sesión de trabajo por esto */ }
}

// ═══ EXPORTAR Y GUARDAR ════════════════════════════════════════════════════
function s25ExportarPng() {
  const { ctx, vistas } = s25;
  const salida = document.createElement("canvas");
  salida.width = ctx.gl.canvas.width;
  salida.height = ctx.gl.canvas.height;
  const c2 = salida.getContext("2d");
  c2.drawImage(ctx.gl.canvas, 0, 0);
  sfSelloEnLienzo(salida);
  return new Promise(res => salida.toBlob(res, "image/png"));
}

async function s25Guardar() {
  const btn = s25.capa.querySelector("#s25Guardar");
  btn.disabled = true;
  btn.textContent = "Guardando...";
  try {
    const png = await s25ExportarPng();
    const params = new URLSearchParams({
      nombre: `Simulación 2.5D · ${s25.vistaActual ? s25.vistaActual.label : "vista"}`,
      fecha: new Date().toISOString().slice(0, 10),
      tipo: "foto",
    });
    await fetch(`${API}/medico/pacientes/${s25.pacienteId}/estudios?${params}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "image/png" },
      body: png,
    });
    btn.textContent = "✅ Guardada en la ficha";
    setTimeout(() => { if (btn.isConnected) { btn.disabled = false; btn.textContent = "Guardar esta vista"; } }, 2200);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Guardar esta vista";
    alert(e.error || "No se pudo guardar");
  }
}
