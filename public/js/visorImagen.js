// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — Visor de imágenes clínicas
// ═══════════════════════════════════════════════════════════════════════════
// Zoom, giro, espejo, brillo, contraste, negativo y mediciones sobre la
// radiografía, sin salir de Vitalis y sin bajar el archivo a ninguna parte.
//
// Dos reglas que atraviesan todo el módulo:
//
// 1. EL ARCHIVO ORIGINAL NUNCA SE TOCA. Todo lo que se ve son ajustes de
//    visualización que se guardan aparte. Una radiografía es un documento
//    clínico y legal: si alguien "mejora" el contraste y eso pisa el
//    archivo, se perdió la prueba de lo que realmente se capturó.
//
// 2. NO SE MUESTRAN MILÍMETROS SIN CALIBRAR. Un JPEG o un PNG no traen el
//    tamaño real del píxel — eso solo viene en DICOM. Mostrar "4,2 mm"
//    sobre una imagen sin calibrar es inventar un número con apariencia
//    clínica, y alguien puede decidir una extracción con eso. Hasta que se
//    calibre, las distancias se muestran en píxeles y la pantalla dice por
//    qué.
//
// Los ángulos son la excepción: no dependen de la escala, así que se
// muestran en grados siempre.

let visorEstado = null;

const ZOOM_MIN = 0.2, ZOOM_MAX = 12;

function visorAbierto() { return Boolean(document.getElementById("visorImagen")); }

// ─── ABRIR ────────────────────────────────────────────────────────────────
async function abrirVisorImagen(estudioId, estudio) {
  if (visorAbierto()) cerrarVisorImagen();

  const capa = document.createElement("div");
  capa.id = "visorImagen";
  capa.className = "no-imprimir";
  capa.style.cssText = "position:fixed;inset:0;z-index:9000;background:#0a0a0c;display:flex;flex-direction:column";
  capa.innerHTML = `<div class="loading" style="margin:auto;color:#eee"><div class="spinner"></div>${t("visor.abriendo")}</div>`;
  document.body.appendChild(capa);
  document.body.style.overflow = "hidden";

  let blob;
  try {
    blob = await traerBlobEstudio(estudioId);
  } catch { blob = null; }

  if (!blob) {
    capa.innerHTML = `<div style="margin:auto;color:#eee;text-align:center">
      <p>${t("visor.errAbrir")}</p>
      <button class="secondary" onclick="cerrarVisorImagen()">${t("visor.cerrar")}</button></div>`;
    return;
  }

  // Los PDF no son imágenes: no hay nada que rotar ni medir. Se abren como
  // siempre en vez de mostrar un visor roto.
  if (blob.type === "application/pdf") {
    cerrarVisorImagen();
    window.open(URL.createObjectURL(blob), "_blank");
    return;
  }

  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

  const guardados = estudio?.ajustesVisor || {};
  visorEstado = {
    estudioId,
    estudio: estudio || {},
    img, url, capa,
    zoom: 1, x: 0, y: 0,
    brillo: guardados.brillo ?? 100,
    contraste: guardados.contraste ?? 100,
    invertido: guardados.invertido ?? false,
    rotacion: guardados.rotacion ?? 0,
    espejo: guardados.espejo ?? false,
    mmPorPixel: estudio?.calibracion?.mmPorPixel ?? null,
    // El DICOM trae los dos ejes por separado, y en ecografía y en algunas
    // panorámicas NO son iguales. Vacío = píxel cuadrado.
    mmPorPixelY: estudio?.calibracion?.mmPorPixelY ?? null,
    // De dónde salió la escala ("dicom" = la trajo el archivo) y si es la del
    // detector. Las dos cosas se muestran en pantalla: no es lo mismo un
    // milímetro leído del equipo que uno calibrado a ojo, ni una medida sobre
    // una reconstrucción que sobre una sombra proyectada.
    origenEscala: estudio?.calibracion?.origen || "",
    planoDetector: Boolean(estudio?.calibracion?.planoDetector),
    mediciones: (estudio?.mediciones || []).map(m => ({ ...m })),
    modo: "mover",       // mover | distancia | angulo | calibrar
    puntosEnCurso: [],
    sucio: false,
  };

  pintarVisor();
}

function cerrarVisorImagen() {
  const capa = document.getElementById("visorImagen");
  if (capa) capa.remove();
  if (visorEstado?.url) URL.revokeObjectURL(visorEstado.url);
  visorEstado = null;
  document.body.style.overflow = "";
}

// ─── LA PANTALLA ──────────────────────────────────────────────────────────
function pintarVisor() {
  const v = visorEstado;
  const hayMedicion = v.mediciones.length > 0;

  v.capa.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#15151a;color:#eee;gap:10px">
      <div style="min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.estudio.nombre || t("visor.imagen"))}</div>
        <div style="font-size:12px;opacity:.65">${v.img.naturalWidth} × ${v.img.naturalHeight} px${v.mmPorPixel ? t("visor.calibrada") : ""}</div>
      </div>
      <button id="visorCerrar" style="background:#2a2a33;color:#eee;border:0;border-radius:8px;padding:8px 14px;font-weight:600">✕</button>
    </div>

    <div id="visorLienzo" style="flex:1;position:relative;overflow:hidden;touch-action:none;cursor:grab">
      <canvas id="visorCanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
      <div id="visorPista" style="position:absolute;left:0;right:0;bottom:8px;text-align:center;color:#eee;font-size:12px;pointer-events:none;text-shadow:0 1px 3px #000"></div>
    </div>

    <div style="background:#15151a;color:#eee;padding:10px 12px 14px">
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px">
        ${botonVisor("mover", "✋", t("visor.modo.mover"))}
        ${botonVisor("distancia", "📏", t("visor.modo.distancia"))}
        ${botonVisor("angulo", "📐", t("visor.modo.angulo"))}
        ${botonVisor("calibrar", "🎯", t(v.mmPorPixel ? "visor.modo.recalibrar" : "visor.modo.calibrar"))}
        <div style="width:1px;background:#333;margin:0 4px"></div>
        <button class="visor-btn" data-accion="zoom-mas">🔍+</button>
        <button class="visor-btn" data-accion="zoom-menos">🔍−</button>
        <button class="visor-btn" data-accion="girar">↻</button>
        <button class="visor-btn" data-accion="espejo">⇄</button>
        <button class="visor-btn" data-accion="invertir"${v.invertido ? ' style="background:var(--primary)"' : ""}>◐</button>
        <button class="visor-btn" data-accion="ajustar">⤢</button>
      </div>

      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12px">
        <span style="opacity:.7;width:62px">${t("visor.brillo")}</span>
        <input type="range" id="visorBrillo" min="20" max="250" value="${v.brillo}" style="width:100%">
        <span id="visorBrilloVal" style="opacity:.7;width:38px;text-align:right">${v.brillo}%</span>

        <span style="opacity:.7;width:62px">${t("visor.contraste")}</span>
        <input type="range" id="visorContraste" min="20" max="350" value="${v.contraste}" style="width:100%">
        <span id="visorContrasteVal" style="opacity:.7;width:38px;text-align:right">${v.contraste}%</span>
      </div>

      <div id="visorMediciones" style="margin-top:8px;font-size:12px"></div>

      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="visor-btn" data-accion="reset" style="flex:1">${t("visor.restablecer")}</button>
        ${hayMedicion ? `<button class="visor-btn" data-accion="borrar-mediciones" style="flex:1">${t("visor.borrarMediciones")}</button>` : ""}
        <button class="visor-btn" data-accion="guardar" style="flex:1;background:var(--primary);color:#fff">${t("visor.guardar")}</button>
      </div>
    </div>

    <style>
      .visor-btn{background:#2a2a33;color:#eee;border:0;border-radius:8px;padding:9px 12px;font-size:14px;white-space:nowrap;cursor:pointer}
      .visor-btn.activo{background:var(--primary);color:#fff}
      #visorImagen input[type=range]{accent-color:var(--primary)}
    </style>`;

  v.capa.querySelector("#visorCerrar").onclick = () => confirmarSalida();
  v.canvas = v.capa.querySelector("#visorCanvas");
  v.lienzo = v.capa.querySelector("#visorLienzo");

  v.capa.querySelectorAll("[data-modo]").forEach(b => {
    b.onclick = () => {
      v.modo = b.dataset.modo;
      v.puntosEnCurso = [];
      pintarVisor();
    };
  });
  v.capa.querySelectorAll("[data-accion]").forEach(b => { b.onclick = () => accionVisor(b.dataset.accion); });

  const brillo = v.capa.querySelector("#visorBrillo");
  const contraste = v.capa.querySelector("#visorContraste");
  brillo.oninput = () => { v.brillo = Number(brillo.value); v.sucio = true; v.capa.querySelector("#visorBrilloVal").textContent = v.brillo + "%"; dibujarVisor(); };
  contraste.oninput = () => { v.contraste = Number(contraste.value); v.sucio = true; v.capa.querySelector("#visorContrasteVal").textContent = v.contraste + "%"; dibujarVisor(); };

  engancharGestos();
  ajustarAPantalla();
  pintarListaMediciones();
}

function botonVisor(modo, icono, texto) {
  const activo = visorEstado.modo === modo ? " activo" : "";
  return `<button class="visor-btn${activo}" data-modo="${modo}">${icono} ${texto}</button>`;
}

// Se resuelven al llamar y no en una constante: este archivo se carga antes
// del login, cuando todavía no se sabe el idioma del médico.
function pistaDelModo(modo) { return t("visor.pista." + modo); }

// ─── DIBUJO ───────────────────────────────────────────────────────────────
function dibujarVisor() {
  const v = visorEstado;
  if (!v?.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const r = v.lienzo.getBoundingClientRect();
  v.canvas.width = r.width * dpr;
  v.canvas.height = r.height * dpr;
  const ctx = v.canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);

  // El brillo/contraste/negativo se aplican con el filtro del canvas y no
  // tocando píxel por píxel: hace lo mismo, va suave en un celular, y sobre
  // todo deja el archivo original intacto.
  ctx.filter = `brightness(${v.brillo}%) contrast(${v.contraste}%)${v.invertido ? " invert(1)" : ""}`;

  ctx.save();
  ctx.translate(r.width / 2 + v.x, r.height / 2 + v.y);
  ctx.rotate((v.rotacion * Math.PI) / 180);
  ctx.scale(v.espejo ? -v.zoom : v.zoom, v.zoom);
  ctx.drawImage(v.img, -v.img.naturalWidth / 2, -v.img.naturalHeight / 2);
  ctx.restore();
  ctx.filter = "none";

  // Las mediciones van SIN filtro y por encima: si el médico deja la imagen
  // en negativo, la línea de medición tiene que seguir viéndose.
  dibujarMediciones(ctx);
  v.capa.querySelector("#visorPista").textContent = pistaDelModo(v.modo) || "";
}

// Pasa un punto de la imagen a coordenadas de pantalla, aplicando el mismo
// giro, espejo y zoom que se le aplicó al dibujo. Sin esto, una medición
// hecha con la imagen girada aparecería en otro lado.
function imagenAPantalla(p) {
  const v = visorEstado;
  const r = v.lienzo.getBoundingClientRect();
  let x = (p.x - v.img.naturalWidth / 2) * (v.espejo ? -v.zoom : v.zoom);
  let y = (p.y - v.img.naturalHeight / 2) * v.zoom;
  const a = (v.rotacion * Math.PI) / 180;
  return {
    x: r.width / 2 + v.x + (x * Math.cos(a) - y * Math.sin(a)),
    y: r.height / 2 + v.y + (x * Math.sin(a) + y * Math.cos(a)),
  };
}

function pantallaAImagen(px, py) {
  const v = visorEstado;
  const r = v.lienzo.getBoundingClientRect();
  const a = (-v.rotacion * Math.PI) / 180;
  const dx = px - (r.width / 2 + v.x);
  const dy = py - (r.height / 2 + v.y);
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return {
    x: rx / (v.espejo ? -v.zoom : v.zoom) + v.img.naturalWidth / 2,
    y: ry / v.zoom + v.img.naturalHeight / 2,
  };
}

function dibujarMediciones(ctx) {
  const v = visorEstado;
  // Dos mediciones cercanas dibujaban sus etiquetas una encima de la otra y
  // quedaban las dos ilegibles — justo cuando más importa leerlas, que es
  // cuando se está comparando dos distancias parecidas.
  const ocupados = [];
  const todas = [...v.mediciones];
  if (v.puntosEnCurso.length) {
    todas.push({ tipo: v.modo === "angulo" ? "angulo" : "distancia", puntos: v.puntosEnCurso, enCurso: true });
  }

  for (const m of todas) {
    const pts = m.puntos.map(imagenAPantalla);
    if (pts.length < 2) {
      if (pts.length === 1) punto(ctx, pts[0], "#4dd6ff");
      continue;
    }
    const color = m.enCurso ? "#4dd6ff" : "#ffd166";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    pts.forEach(p => punto(ctx, p, color));

    const texto = textoMedicion(m);
    if (texto) {
      const centro = m.tipo === "angulo" ? pts[1] : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      etiqueta(ctx, texto, centro.x, centro.y - 12, color, ocupados);
    }
  }
}

function punto(ctx, p, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function etiqueta(ctx, texto, x, y, color, ocupados = []) {
  ctx.font = "600 13px system-ui, sans-serif";
  const ancho = ctx.measureText(texto).width + 10;
  const alto = 20;

  // Si el lugar está tomado, la etiqueta sube hasta encontrar hueco. Se
  // prueba un número acotado de veces: con muchas mediciones apiladas es
  // preferible que dos queden juntas a subir una hasta fuera de la pantalla.
  const choca = (yy) => ocupados.some(o =>
    Math.abs(o.x - x) < (o.ancho + ancho) / 2 && Math.abs(o.y - yy) < alto + 2);
  let intentos = 0;
  while (choca(y) && intentos < 6) { y -= alto + 3; intentos++; }
  ocupados.push({ x, y, ancho });

  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(x - ancho / 2, y - 15, ancho, alto);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(texto, x, y);
}

// ─── LOS NÚMEROS ──────────────────────────────────────────────────────────
function distanciaPx(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// La distancia en milímetros NO es la distancia en píxeles por un número:
// cada eje puede tener su propia escala. Si el píxel no es cuadrado —pasa en
// ecografía y en algunas panorámicas— convertir primero cada eje y recién
// después medir es la diferencia entre una diagonal correcta y una que
// miente sin avisar. Con píxel cuadrado da exactamente lo mismo de antes.
function distanciaMm(a, b) {
  const v = visorEstado;
  const ex = v.mmPorPixel;
  const ey = v.mmPorPixelY || v.mmPorPixel;
  return Math.hypot((b.x - a.x) * ex, (b.y - a.y) * ey);
}

function anguloEntre(a, vertice, b) {
  const u = { x: a.x - vertice.x, y: a.y - vertice.y };
  const w = { x: b.x - vertice.x, y: b.y - vertice.y };
  const cos = (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function textoMedicion(m) {
  const v = visorEstado;
  if (m.tipo === "angulo") {
    if (m.puntos.length < 3) return "";
    return anguloEntre(m.puntos[0], m.puntos[1], m.puntos[2]).toFixed(1).replace(".", ",") + "°";
  }
  if (m.puntos.length < 2) return "";
  const px = distanciaPx(m.puntos[0], m.puntos[1]);
  // Acá está la regla: sin calibración, píxeles. Nunca milímetros inventados.
  return v.mmPorPixel
    ? distanciaMm(m.puntos[0], m.puntos[1]).toFixed(2).replace(".", ",") + " mm"
    : Math.round(px) + " px";
}

function pintarListaMediciones() {
  const v = visorEstado;
  const caja = v.capa.querySelector("#visorMediciones");
  if (!caja) return;

  const hayDistancias = v.mediciones.some(m => m.tipo === "distancia");
  let aviso = "";
  if (!v.mmPorPixel && hayDistancias) {
    aviso = `<div style="color:#ffb84d;margin-bottom:6px">
         ${t("visor.avisoPixeles")}
       </div>`;
  } else if (hayDistancias && v.origenEscala === "dicom") {
    // Cuando la escala la trajo el archivo, decirlo vale: es la diferencia
    // entre un número medido y uno calibrado a ojo. Y si además es una
    // proyección, el milímetro es el de la SOMBRA — el objeto está delante
    // del detector y sale agrandado. Callarlo sería dejar que alguien decida
    // sobre un número que parece más exacto de lo que es.
    aviso = `<div style="color:#8fd6a8;margin-bottom:6px">
         ${t("visor.avisoDicom")}
         ${v.planoDetector ? `<span style="color:#ffb84d;display:block;margin-top:3px">
           ${t("visor.avisoDetector")}
         </span>` : ""}
       </div>`;
  }

  caja.innerHTML = aviso + (v.mediciones.length
    ? v.mediciones.map((m, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;opacity:.85">
          <span>${m.tipo === "angulo" ? "📐" : "📏"} ${esc(textoMedicion(m))}${m.etiqueta ? " — " + esc(m.etiqueta) : ""}</span>
          <button class="visor-btn" data-quitar-medicion="${i}" style="padding:2px 8px;font-size:12px">✕</button>
        </div>`).join("")
    : "");

  caja.querySelectorAll("[data-quitar-medicion]").forEach(b => {
    b.onclick = () => {
      v.mediciones.splice(Number(b.dataset.quitarMedicion), 1);
      v.sucio = true;
      pintarListaMediciones();
      dibujarVisor();
    };
  });
}

// ─── GESTOS ───────────────────────────────────────────────────────────────
// Un dedo mueve, dos dedos acercan. En la compu: arrastrar mueve, la rueda
// acerca. Es el mismo gesto que la gente ya usa en cualquier app de fotos —
// nadie tiene que aprender nada.
function engancharGestos() {
  const v = visorEstado;
  const el = v.lienzo;
  let arrastrando = false, ultimo = null, distanciaInicial = null, zoomInicial = 1, movio = false;

  const puntos = (e) => Array.from(e.touches || []).map(t => ({ x: t.clientX, y: t.clientY }));

  function empezar(e) {
    const ts = puntos(e);
    if (ts.length === 2) {
      distanciaInicial = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
      zoomInicial = v.zoom;
      arrastrando = false;
      return;
    }
    arrastrando = true;
    movio = false;
    const p = ts[0] || { x: e.clientX, y: e.clientY };
    ultimo = p;
    el.style.cursor = "grabbing";
  }

  function mover(e) {
    const ts = puntos(e);
    if (ts.length === 2 && distanciaInicial) {
      e.preventDefault();
      const d = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
      v.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (zoomInicial * d) / distanciaInicial));
      dibujarVisor();
      return;
    }
    if (!arrastrando) return;
    const p = ts[0] || { x: e.clientX, y: e.clientY };
    const dx = p.x - ultimo.x, dy = p.y - ultimo.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movio = true;
    // En modo medición NO se arrastra la imagen: si no, es imposible marcar
    // un punto sin correr la placa sin querer.
    if (v.modo === "mover") {
      v.x += dx; v.y += dy;
      dibujarVisor();
    }
    ultimo = p;
    if (e.cancelable) e.preventDefault();
  }

  function soltar(e) {
    const eraArrastre = arrastrando;
    arrastrando = false;
    distanciaInicial = null;
    el.style.cursor = "grab";
    // Un toque limpio (sin arrastrar) en modo medición marca un punto.
    if (eraArrastre && !movio && v.modo !== "mover") {
      const r = el.getBoundingClientRect();
      const p = (e.changedTouches && e.changedTouches[0]) || e;
      marcarPunto(p.clientX - r.left, p.clientY - r.top);
    }
  }

  el.addEventListener("mousedown", empezar);
  el.addEventListener("mousemove", mover);
  window.addEventListener("mouseup", soltar);
  el.addEventListener("touchstart", empezar, { passive: false });
  el.addEventListener("touchmove", mover, { passive: false });
  el.addEventListener("touchend", soltar);

  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    v.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    dibujarVisor();
  }, { passive: false });

  // Escape cierra, que es lo que la mano hace sola.
  v.escuchaTeclado = (e) => { if (e.key === "Escape") confirmarSalida(); };
  window.addEventListener("keydown", v.escuchaTeclado);
}

function marcarPunto(px, py) {
  const v = visorEstado;
  v.puntosEnCurso.push(pantallaAImagen(px, py));
  const necesarios = v.modo === "angulo" ? 3 : 2;

  if (v.puntosEnCurso.length < necesarios) { dibujarVisor(); return; }

  const puntos = v.puntosEnCurso;
  v.puntosEnCurso = [];

  if (v.modo === "calibrar") return pedirCalibracion(puntos);

  const m = {
    tipo: v.modo === "angulo" ? "angulo" : "distancia",
    puntos,
    etiqueta: "",
    fecha: new Date().toISOString(),
  };
  // Se guarda también el valor del momento: si mañana se recalibra la
  // imagen, queda registro de con qué número decidió el médico ese día.
  if (m.tipo === "angulo") {
    m.valor = anguloEntre(puntos[0], puntos[1], puntos[2]);
    m.unidad = "grados";
  } else {
    m.valor = v.mmPorPixel ? distanciaMm(puntos[0], puntos[1]) : distanciaPx(puntos[0], puntos[1]);
    m.unidad = v.mmPorPixel ? "mm" : "px";
  }
  v.mediciones.push(m);
  v.sucio = true;
  pintarListaMediciones();
  dibujarVisor();
}

// ─── CALIBRACIÓN ──────────────────────────────────────────────────────────
// El médico marca dos puntos sobre algo cuyo tamaño real conoce y escribe
// cuánto mide. A partir de ahí, todas las distancias de ESA imagen se
// muestran en milímetros.
function pedirCalibracion(puntos) {
  const v = visorEstado;
  const px = distanciaPx(puntos[0], puntos[1]);

  // Pisar la escala que trajo el DICOM con una marcada a mano casi siempre
  // es un retroceso: el equipo sabe el tamaño de su píxel mejor que nadie
  // marcando dos puntos con el dedo. Tiene sentido en un caso —calibrar
  // contra una referencia que esté en el mismo plano del objeto, para
  // corregir la magnificación— así que no se prohíbe, se pregunta.
  if (v.origenEscala === "dicom" &&
      !confirm(t("visor.confirmarRecalibrar"))) {
    v.modo = "mover";
    dibujarVisor();
    return;
  }

  const respuesta = prompt(t("visor.pedirMm", { px: Math.round(px) }), "");
  if (respuesta === null) { dibujarVisor(); return; }

  const mm = Number(String(respuesta).replace(",", "."));
  if (!Number.isFinite(mm) || mm <= 0) {
    alert(t("visor.errMm"));
    dibujarVisor();
    return;
  }

  v.mmPorPixel = mm / px;
  // Una calibración a mano se marca sobre la pantalla, así que vale igual
  // para los dos ejes: se borra el eje Y del DICOM en vez de dejar mezclada
  // una escala X nueva con una Y vieja, que daría diagonales absurdas.
  v.mmPorPixelY = null;
  v.origenEscala = "manual";
  v.planoDetector = false;
  v.referenciaCalibracion = t("visor.referencia", { mm, px: Math.round(px) });
  v.sucio = true;
  v.modo = "mover";
  // Las mediciones ya tomadas se recalculan solas al dibujar, porque el
  // valor sale de los puntos y no de un número congelado.
  pintarVisor();
  alert(`Listo. Esta imagen quedó calibrada: 1 píxel = ${(v.mmPorPixel).toFixed(4).replace(".", ",")} mm.\n\nLas distancias ahora se muestran en milímetros.`);
}

// ─── ACCIONES ─────────────────────────────────────────────────────────────
function ajustarAPantalla() {
  const v = visorEstado;
  const r = v.lienzo.getBoundingClientRect();
  // Con la imagen girada 90°, lo que hay que encajar es el alto contra el
  // ancho: si no, la placa se sale de la pantalla justo al rotarla.
  const vertical = v.rotacion % 180 !== 0;
  const ancho = vertical ? v.img.naturalHeight : v.img.naturalWidth;
  const alto = vertical ? v.img.naturalWidth : v.img.naturalHeight;
  v.zoom = Math.min(r.width / ancho, r.height / alto) * 0.94;
  v.x = 0; v.y = 0;
  dibujarVisor();
}

async function accionVisor(accion) {
  const v = visorEstado;
  switch (accion) {
    case "zoom-mas": v.zoom = Math.min(ZOOM_MAX, v.zoom * 1.25); dibujarVisor(); break;
    case "zoom-menos": v.zoom = Math.max(ZOOM_MIN, v.zoom / 1.25); dibujarVisor(); break;
    case "girar": v.rotacion = (v.rotacion + 90) % 360; v.sucio = true; ajustarAPantalla(); break;
    case "espejo": v.espejo = !v.espejo; v.sucio = true; dibujarVisor(); break;
    case "invertir": v.invertido = !v.invertido; v.sucio = true; pintarVisor(); break;
    case "ajustar": ajustarAPantalla(); break;
    case "reset":
      v.brillo = 100; v.contraste = 100; v.invertido = false; v.rotacion = 0; v.espejo = false;
      v.sucio = true;
      pintarVisor();
      break;
    case "borrar-mediciones":
      if (!confirm(t("visor.confirmarBorrarMediciones"))) return;
      v.mediciones = [];
      v.puntosEnCurso = [];
      v.sucio = true;
      pintarVisor();
      break;
    case "guardar": await guardarVisor(); break;
  }
}

async function guardarVisor() {
  const v = visorEstado;
  try {
    await api(`/medico/estudios/${v.estudioId}/visor`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ajustesVisor: { brillo: v.brillo, contraste: v.contraste, invertido: v.invertido, rotacion: v.rotacion, espejo: v.espejo },
        mediciones: v.mediciones,
        // Va la calibración COMPLETA, no solo el mmPorPixel: el servidor
        // reemplaza el objeto entero, así que mandar de menos le borraría al
        // estudio el eje Y y el origen de la escala nada más que por haber
        // tocado el brillo.
        calibracion: v.mmPorPixel ? {
          mmPorPixel: v.mmPorPixel,
          mmPorPixelY: v.mmPorPixelY,
          origen: v.origenEscala || "manual",
          planoDetector: v.planoDetector,
          referencia: v.referenciaCalibracion || v.estudio?.calibracion?.referencia || "",
        } : null,
      }),
    });
    v.sucio = false;
    const btn = v.capa.querySelector('[data-accion="guardar"]');
    if (btn) { btn.textContent = t("visor.guardado"); setTimeout(() => { if (btn.isConnected) btn.textContent = t("visor.guardar"); }, 2000); }
  } catch (e) {
    alert(e.error || t("visor.errGuardar"));
  }
}

// Salir con mediciones sin guardar es la forma más fácil de perder trabajo
// clínico. Se pregunta.
function confirmarSalida() {
  const v = visorEstado;
  if (v?.sucio && !confirm(t("visor.confirmarSalir"))) return;
  if (v?.escuchaTeclado) window.removeEventListener("keydown", v.escuchaTeclado);
  cerrarVisorImagen();
}

// Que el visor se reacomode al girar el celular.
window.addEventListener("resize", () => { if (visorAbierto()) dibujarVisor(); });
