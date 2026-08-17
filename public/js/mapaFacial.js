// Vitalis Face — Mapa anatómico y análisis de simetría a partir de UNA foto
// frontal. Corre entero en el navegador (MediaPipe Face Landmarker,
// autohospedado en /vendor/mediapipe — nada de CDN externo, respeta la CSP
// igual que el visor 3D del odontograma). No hay hardware de profundidad
// atrás de esto, así que esto es lo que se puede hacer honestamente con una
// sola foto 2D:
//   - Regiones marcadas sobre la foto (ojos, cejas, labios de la propia
//     topología de MediaPipe; frente/mejillas/mentón/mandíbula derivadas
//     geométricamente a partir de esas mismas — no hay índices "mágicos"
//     inventados de memoria).
//   - Mapa de simetría izquierda/derecha (comparando puntos espejados
//     contra la línea media).
// Lo que NO hace (y no debería fingir que hace): reconstrucción 3D real,
// medidas en milímetros reales (sin algo de tamaño conocido en la foto para
// calibrar, cualquier "mm" sería inventado).

let _faceLandmarkerPromise = null;
function cargarFaceLandmarker() {
  if (!_faceLandmarkerPromise) {
    _faceLandmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("/vendor/mediapipe/vision_bundle.js");
      const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/vendor/mediapipe/face_landmarker.task", delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 1,
      });
      landmarker.__vitalisModo = "IMAGE";
      return { FaceLandmarker, landmarker };
    })();
  }
  return _faceLandmarkerPromise;
}

// El mismo modelo se usa para analizar una foto ya tomada (modo IMAGE, en
// abrirAnalisisFacial) y para la detección en vivo de la cámara guiada
// (modo VIDEO, en prepararDeteccionEnVivo) — nunca al mismo tiempo, así que
// alcanza con una sola instancia que cambia de modo según quién la pida.
async function landmarkerEnModo(modo) {
  const { FaceLandmarker, landmarker } = await cargarFaceLandmarker();
  if (landmarker.__vitalisModo !== modo) {
    await landmarker.setOptions({ runningMode: modo });
    landmarker.__vitalisModo = modo;
  }
  return { FaceLandmarker, landmarker };
}

// Los connectors de MediaPipe son pares {start,end} sin orden — para poder
// rellenar un polígono hay que caminarlos como un lazo cerrado primero.
function connectorsAPoligono(connectors) {
  const adj = new Map();
  for (const { start, end } of connectors) {
    (adj.get(start) || adj.set(start, []).get(start)).push(end);
    (adj.get(end) || adj.set(end, []).get(end)).push(start);
  }
  const inicio = connectors[0].start;
  const visitados = new Set([inicio]);
  const orden = [inicio];
  let actual = inicio;
  while (orden.length < adj.size) {
    const siguiente = (adj.get(actual) || []).find(n => !visitados.has(n));
    if (siguiente === undefined) break;
    visitados.add(siguiente);
    orden.push(siguiente);
    actual = siguiente;
  }
  return orden;
}

// Regiones "de fábrica" de MediaPipe (topología propia, no inventada).
function regionesBase(FaceLandmarker) {
  return {
    ojo_derecho: connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE),
    ojo_izquierdo: connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE),
    ceja_derecha: connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW),
    ceja_izquierda: connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW),
    labios: connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_LIPS),
    ovalo: connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
  };
}

const ETIQUETAS = {
  frente: "Frente", ceja_derecha: "Ceja derecha", ceja_izquierda: "Ceja izquierda",
  ojo_derecho: "Ojo derecho", ojo_izquierdo: "Ojo izquierdo",
  mejilla_derecha: "Mejilla derecha", mejilla_izquierda: "Mejilla izquierda",
  labios: "Labios", menton: "Mentón",
  mandibula_derecha: "Mandíbula derecha", mandibula_izquierda: "Mandíbula izquierda",
};
const COLOR_REGION = {
  frente: "99,102,241", ceja_derecha: "180,130,74", ceja_izquierda: "180,130,74",
  ojo_derecho: "59,130,168", ojo_izquierdo: "59,130,168",
  mejilla_derecha: "201,160,95", mejilla_izquierda: "201,160,95",
  labios: "161,62,62", menton: "61,122,82",
  mandibula_derecha: "125,90,60", mandibula_izquierda: "125,90,60",
};

// Puntos de referencia estables del propio óvalo/cejas/labios (ya
// calculados arriba, no índices sueltos) para armar frente/mejillas/mentón/
// mandíbula por geometría relativa — ninguno de estos cuatro existe como
// región propia en MediaPipe, así que se recortan a partir de las que sí.
function derivarRegionesGeometricas(lm, base) {
  const pt = (i) => lm[i];
  const centroide = (idxs) => {
    let x = 0, y = 0;
    for (const i of idxs) { x += pt(i).x; y += pt(i).y; }
    return { x: x / idxs.length, y: y / idxs.length };
  };
  const minY = (idxs) => Math.min(...idxs.map(i => pt(i).y));
  const maxY = (idxs) => Math.max(...idxs.map(i => pt(i).y));
  const minX = (idxs) => Math.min(...idxs.map(i => pt(i).x));
  const maxX = (idxs) => Math.max(...idxs.map(i => pt(i).x));

  const ovaloTopY = minY(base.ovalo);
  const ovaloBottomY = maxY(base.ovalo);
  const ovaloLeftX = minX(base.ovalo);
  const ovaloRightX = maxX(base.ovalo);
  const cejasTopY = Math.min(minY(base.ceja_derecha), minY(base.ceja_izquierda));
  const labiosBottomY = maxY(base.labios);
  const centroX = (ovaloLeftX + ovaloRightX) / 2;

  // Rectángulo de la frente: entre el borde de arriba del óvalo y las cejas.
  const frente = [
    { x: ovaloLeftX + (ovaloRightX - ovaloLeftX) * 0.12, y: ovaloTopY },
    { x: ovaloRightX - (ovaloRightX - ovaloLeftX) * 0.12, y: ovaloTopY },
    { x: ovaloRightX - (ovaloRightX - ovaloLeftX) * 0.08, y: cejasTopY },
    { x: ovaloLeftX + (ovaloRightX - ovaloLeftX) * 0.08, y: cejasTopY },
  ];
  // Mentón: debajo de los labios, hasta el borde inferior del óvalo.
  const menton = [
    { x: centroX - (ovaloRightX - ovaloLeftX) * 0.18, y: labiosBottomY },
    { x: centroX + (ovaloRightX - ovaloLeftX) * 0.18, y: labiosBottomY },
    { x: centroX + (ovaloRightX - ovaloLeftX) * 0.14, y: ovaloBottomY },
    { x: centroX - (ovaloRightX - ovaloLeftX) * 0.14, y: ovaloBottomY },
  ];
  // Mejillas: entre el nivel de los ojos y el de los labios, a los costados.
  const ojosY = (minY(base.ojo_derecho) + minY(base.ojo_izquierdo)) / 2;
  const mejillaIzquierda = [
    { x: centroX + (ovaloRightX - centroX) * 0.15, y: ojosY },
    { x: ovaloRightX - (ovaloRightX - ovaloLeftX) * 0.05, y: ojosY + (labiosBottomY - ojosY) * 0.15 },
    { x: ovaloRightX - (ovaloRightX - ovaloLeftX) * 0.1, y: labiosBottomY },
    { x: centroX + (ovaloRightX - centroX) * 0.15, y: labiosBottomY },
  ];
  const mejillaDerecha = mejillaIzquierda.map(p => ({ x: centroX - (p.x - centroX), y: p.y }));
  // Mandíbula: costados del óvalo, entre labios y mentón.
  const mandibulaIzquierda = [
    { x: ovaloRightX - (ovaloRightX - ovaloLeftX) * 0.1, y: labiosBottomY },
    { x: ovaloRightX, y: (labiosBottomY + ovaloBottomY) / 2 },
    { x: centroX + (ovaloRightX - ovaloLeftX) * 0.14, y: ovaloBottomY },
    { x: centroX + (ovaloRightX - centroX) * 0.15, y: labiosBottomY },
  ];
  const mandibulaDerecha = mandibulaIzquierda.map(p => ({ x: centroX - (p.x - centroX), y: p.y }));

  return { frente, menton, mejilla_izquierda: mejillaIzquierda, mejilla_derecha: mejillaDerecha, mandibula_izquierda: mandibulaIzquierda, mandibula_derecha: mandibulaDerecha };
}

async function detectarEnImagen(imgEl) {
  const { FaceLandmarker, landmarker } = await landmarkerEnModo("IMAGE");
  const resultado = landmarker.detect(imgEl);
  if (!resultado.faceLandmarks || !resultado.faceLandmarks.length) return null;
  return { FaceLandmarker, landmarks: resultado.faceLandmarks[0] };
}

// ─── DETECCIÓN EN VIVO (cámara guiada) ────────────────────────────────────
// Para que la cámara se dispare sola cuando la cara está bien encuadrada,
// no cuando el médico se acuerde de tocar el botón.
function cajaOvaloFacial(lm, FaceLandmarker) {
  const ovalo = connectorsAPoligono(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL);
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const i of ovalo) {
    const p = lm[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

// Rangos deliberadamente generosos (no es una calibración de cámara real,
// solo "¿la cara está más o menos centrada y a una distancia razonable?").
// Mejor de más tolerante — que capture un encuadre un poco imperfecto — a
// que nunca dispare y el médico termine igual tocando "Capturar" a mano,
// que sigue siempre disponible como respaldo.
// Proxy geométrico de cuánto giró la cabeza (para la sesión guiada de los 5
// ángulos de Vitalis Face), usando solo las regiones que ya calculamos con
// las constantes propias de MediaPipe (nada de índices "mágicos" sueltos):
// cuando la cara está de frente, el centro de los ojos cae más o menos en
// el medio del óvalo facial; al girar, ese centro se corre hacia uno de los
// dos bordes del óvalo. 0 = de frente, positivo/negativo = girada hacia un
// lado u otro de LA IMAGEN.
// OJO: a qué lado del PACIENTE corresponde cada signo (si "positivo" es su
// derecha o su izquierda) no se pudo verificar acá — este entorno no tiene
// cámara ni una cara real para probarlo girando de verdad. Si en un
// celular real "Girá a la derecha" resulta estar guiando para el lado
// que no es, se arregla dando vuelta el signo de ESTA función nada más
// (return -(...) en vez de return (...)) — los rangos de más abajo no
// habría que tocarlos.
function estimarYaw(lm, FaceLandmarker) {
  const base = regionesBase(FaceLandmarker);
  const centroX = (idxs) => idxs.reduce((s, i) => s + lm[i].x, 0) / idxs.length;
  const ojosCentroX = (centroX(base.ojo_derecho) + centroX(base.ojo_izquierdo)) / 2;
  const ovaloXs = base.ovalo.map(i => lm[i].x);
  const ovaloMinX = Math.min(...ovaloXs), ovaloMaxX = Math.max(...ovaloXs);
  const ovaloCentroX = (ovaloMinX + ovaloMaxX) / 2;
  const ovaloAncho = (ovaloMaxX - ovaloMinX) || 0.0001;
  return (ojosCentroX - ovaloCentroX) / (ovaloAncho / 2);
}

function evaluarCuadroVivo(lm, FaceLandmarker) {
  const caja = cajaOvaloFacial(lm, FaceLandmarker);
  const centrada = caja.cx > 0.28 && caja.cx < 0.72 && caja.cy > 0.15 && caja.cy < 0.85;
  const tamanoOk = caja.w > 0.18 && caja.w < 0.62;
  return { alineado: centrada && tamanoOk, tamanoOk, caja, yaw: estimarYaw(lm, FaceLandmarker) };
}

async function prepararDeteccionEnVivo() {
  const { FaceLandmarker, landmarker } = await landmarkerEnModo("VIDEO");
  return {
    FaceLandmarker,
    detectar(videoEl) {
      const resultado = landmarker.detectForVideo(videoEl, performance.now());
      if (!resultado.faceLandmarks || !resultado.faceLandmarks.length) return null;
      return evaluarCuadroVivo(resultado.faceLandmarks[0], FaceLandmarker);
    },
  };
}

// Rangos de "yaw" (ver estimarYaw) para cada paso de la sesión guiada.
// También pendientes de calibrar con una cara real — son generosos a
// propósito para no exigir un giro perfecto.
const YAW_RANGOS_SESION = {
  frontal: [-0.15, 0.15],
  angulo45_derecha: [0.2, 0.5],
  perfil_derecho: [0.5, 0.95],
  angulo45_izquierda: [-0.5, -0.2],
  perfil_izquierdo: [-0.95, -0.5],
};
function anguloPorYaw(yaw) {
  for (const [angulo, rango] of Object.entries(YAW_RANGOS_SESION)) {
    if (yaw >= rango[0] && yaw <= rango[1]) return angulo;
  }
  return null;
}

function dibujarMapaAnatomico(ctx, img, lm, FaceLandmarker) {
  const w = img.naturalWidth, h = img.naturalHeight;
  ctx.drawImage(img, 0, 0, w, h);
  const base = regionesBase(FaceLandmarker);
  const derivadas = derivarRegionesGeometricas(lm, base);

  function poligonoDesdeIndices(idxs) { return idxs.map(i => ({ x: lm[i].x * w, y: lm[i].y * h })); }
  function pintarPoligono(puntos, color) {
    if (puntos.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(puntos[0].x, puntos[0].y);
    for (const p of puntos.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = `rgba(${color},.32)`;
    ctx.strokeStyle = `rgba(${color},.85)`;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  const regionesAPintar = {
    ceja_derecha: poligonoDesdeIndices(base.ceja_derecha),
    ceja_izquierda: poligonoDesdeIndices(base.ceja_izquierda),
    ojo_derecho: poligonoDesdeIndices(base.ojo_derecho),
    ojo_izquierdo: poligonoDesdeIndices(base.ojo_izquierdo),
    labios: poligonoDesdeIndices(base.labios),
    frente: derivadas.frente.map(p => ({ x: p.x * w, y: p.y * h })),
    menton: derivadas.menton.map(p => ({ x: p.x * w, y: p.y * h })),
    mejilla_derecha: derivadas.mejilla_derecha.map(p => ({ x: p.x * w, y: p.y * h })),
    mejilla_izquierda: derivadas.mejilla_izquierda.map(p => ({ x: p.x * w, y: p.y * h })),
    mandibula_derecha: derivadas.mandibula_derecha.map(p => ({ x: p.x * w, y: p.y * h })),
    mandibula_izquierda: derivadas.mandibula_izquierda.map(p => ({ x: p.x * w, y: p.y * h })),
  };
  for (const [clave, puntos] of Object.entries(regionesAPintar)) {
    pintarPoligono(puntos, COLOR_REGION[clave]);
  }
  return regionesAPintar;
}

// Simetría: para cada par de puntos espejados (ceja/ojo izq-der, que
// MediaPipe ya entrega en el mismo orden en sus dos listas), se mide qué
// tan lejos está cada uno de la línea media real de la cara — no es una
// medida clínica en mm, es una comparación relativa punto a punto.
function dibujarSimetria(ctx, img, lm, FaceLandmarker) {
  const w = img.naturalWidth, h = img.naturalHeight;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalAlpha = 0.55;
  ctx.filter = "grayscale(70%)";
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = "none";
  ctx.globalAlpha = 1;

  const base = regionesBase(FaceLandmarker);
  const ovaloX = base.ovalo.map(i => lm[i].x);
  const centroXNorm = ovaloX.reduce((a, b) => a + b, 0) / ovaloX.length;

  const paresIzqDer = [];
  const izq = [...base.ceja_izquierda, ...base.ojo_izquierdo];
  const der = [...base.ceja_derecha, ...base.ojo_derecho];
  const n = Math.min(izq.length, der.length);
  for (let i = 0; i < n; i++) paresIzqDer.push([izq[i], der[i]]);

  let maxDif = 0.0001;
  const difs = paresIzqDer.map(([iIzq, iDer]) => {
    const distIzq = Math.abs(lm[iIzq].x - centroXNorm);
    const distDer = Math.abs(lm[iDer].x - centroXNorm);
    const dif = distIzq - distDer; // >0: el lado izquierdo sobresale más
    maxDif = Math.max(maxDif, Math.abs(dif));
    return { iIzq, iDer, dif };
  });

  function colorPara(t) {
    // t entre -1 (azul, lado derecho más prominente) y +1 (rojo, izquierdo)
    if (t < 0) { const a = -t; return `rgba(${Math.round(59 + a * 40)},${Math.round(130 - a * 30)},${Math.round(246 - a * 40)},.75)`; }
    return `rgba(${Math.round(220 + t * 20)},${Math.round(90 - t * 40)},${Math.round(90 - t * 40)},.75)`;
  }

  for (const { iIzq, iDer, dif } of difs) {
    const t = dif / maxDif;
    const color = colorPara(t);
    for (const i of [iIzq, iDer]) {
      const x = lm[i].x * w, y = lm[i].y * h;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, w * 0.035);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, w * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Línea media, de referencia visual.
  ctx.strokeStyle = "rgba(255,255,255,.6)";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centroXNorm * w, 0);
  ctx.lineTo(centroXNorm * w, h);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Vista completa (overlay), llamada desde estudios.js ─────────────────
async function abrirAnalisisFacial(fotoBlob) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:var(--bg);z-index:999;overflow-y:auto;padding:16px;";
  overlay.innerHTML = `
    <button class="back" id="mfVolver">← Volver</button>
    <div class="card">
      <div class="hint">Detectando puntos faciales...</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#mfVolver").onclick = () => overlay.remove();

  const img = new Image();
  const urlObjeto = URL.createObjectURL(fotoBlob);
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = urlObjeto; });

  let deteccion;
  try {
    deteccion = await detectarEnImagen(img);
  } catch (e) {
    overlay.querySelector(".card").innerHTML = `<div class="error">No se pudo cargar el análisis facial: ${esc(e.message)}</div>`;
    return;
  }
  if (!deteccion) {
    overlay.querySelector(".card").innerHTML = `<div class="error">No se detectó una cara clara en esta foto. Probá con una foto frontal, bien iluminada y sin lentes/gorra.</div>`;
    return;
  }

  const canvasMapa = document.createElement("canvas");
  const canvasSimetria = document.createElement("canvas");
  canvasMapa.width = canvasSimetria.width = img.naturalWidth;
  canvasMapa.height = canvasSimetria.height = img.naturalHeight;
  canvasMapa.style.cssText = canvasSimetria.style.cssText = "width:100%;border-radius:var(--radius);display:block;";

  dibujarMapaAnatomico(canvasMapa.getContext("2d"), img, deteccion.landmarks, deteccion.FaceLandmarker);
  dibujarSimetria(canvasSimetria.getContext("2d"), img, deteccion.landmarks, deteccion.FaceLandmarker);

  overlay.innerHTML = `<button class="back" id="mfVolver">← Volver</button>`;
  const cardMapa = document.createElement("div");
  cardMapa.className = "card";
  cardMapa.innerHTML = `
    <div class="nota-titulo">Mapa anatómico facial</div>
    <div class="hint" style="margin-bottom:10px">Regiones detectadas automáticamente a partir de la foto — para ubicar rápido dónde fue cada procedimiento, no reemplaza el ojo clínico.</div>`;
  cardMapa.appendChild(canvasMapa);
  const leyenda = document.createElement("div");
  leyenda.className = "odonto-leyenda";
  leyenda.style.marginTop = "12px";
  leyenda.innerHTML = Object.entries(ETIQUETAS).map(([k, l]) =>
    `<span class="odonto-leyenda-item"><i style="background:rgb(${COLOR_REGION[k]})"></i>${esc(l)}</span>`
  ).join("");
  cardMapa.appendChild(leyenda);

  const cardSimetria = document.createElement("div");
  cardSimetria.className = "card";
  cardSimetria.innerHTML = `
    <div class="nota-titulo">Análisis de simetría</div>
    <div class="hint" style="margin-bottom:10px">Compara cejas y ojos contra la línea media de la cara. <b>Rojo</b> = el lado izquierdo del paciente sobresale más · <b>Azul</b> = el derecho. Es una comparación relativa, no una medida clínica en milímetros (eso necesitaría una referencia de tamaño conocido en la foto).</div>`;
  cardSimetria.appendChild(canvasSimetria);

  overlay.appendChild(cardMapa);
  overlay.appendChild(cardSimetria);
  overlay.querySelector("#mfVolver").onclick = () => { URL.revokeObjectURL(urlObjeto); overlay.remove(); };
}
