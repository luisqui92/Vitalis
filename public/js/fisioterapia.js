// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Fisioterapia — mapa de dolor, movilidad y objetivos funcionales
// ═══════════════════════════════════════════════════════════════════════════
//
// Tres pantallas que son tres preguntas del kinesiólogo:
//   ¿Dónde le duele?      → el mapa sobre la silueta
//   ¿Cuánto se mueve?     → goniometría contra el rango de referencia
//   ¿Está mejorando?      → objetivos sesión a sesión
//
// ═══ IZQUIERDA Y DERECHA NO SON LAS DE LA PANTALLA ═════════════════════════
//
// Mirando a una persona DE FRENTE, su lado derecho queda a la izquierda de
// quien mira. De ESPALDAS, coinciden. Anotar "hombro izquierdo" cuando era el
// derecho no es un detalle de interfaz: es una ficha clínica equivocada, y el
// error se arrastra a la goniometría, al objetivo y al informe.
//
// Por eso el lado no se elige a mano: lo deduce ladoSegunVista() a partir de
// dónde cayó el clic y de qué silueta se está mirando, y la pantalla lo
// muestra escrito para que se pueda corregir si hiciera falta.

// ─── ESCALA DE DOLOR ───────────────────────────────────────────────────────
// 0 a 10, la escala visual analógica de uso corriente. El color va de verde a
// rojo porque acá el rojo SÍ corresponde: a diferencia del perfil sensorial
// de neurodesarrollo —donde "hiperreactivo" no es un déficit— un dolor de 9
// es efectivamente algo malo.
function colorDolor(intensidad) {
  const n = Math.max(0, Math.min(10, Number(intensidad) || 0));
  if (n === 0) return "var(--text-muted)";
  if (n <= 3) return "var(--success)";
  if (n <= 6) return "var(--warning)";
  return "var(--danger)";
}

const AYUDAS_FISIO = ["fisica_total", "fisica_parcial", "gestual", "verbal", "independiente"];

// ═══ LA SILUETA ════════════════════════════════════════════════════════════
//
// De frente y de espaldas. El contorno es casi el mismo —un cuerpo humano
// visto de atrás tiene la misma forma que visto de adelante— así que lo que
// distingue las dos vistas es la línea de la columna, que solo aparece atrás.
// Sin esa marca las dos siluetas son idénticas y nadie sabe cuál está
// mirando.
//
// Se pinta con --text y no con el color de marca, por lo mismo que la silueta
// de veterinaria: --text siempre contrasta contra el fondo del tema, y un
// celeste sobre fondo oscuro deja el cuerpo casi invisible.
function siluetaHumanaSvg(vista) {
  const cuerpo = `
    <ellipse cx="100" cy="38" rx="20" ry="25"/>
    <path d="M91 59 L109 59 L110 77 L90 77 Z"/>
    <path d="M100 74 C86 74 72 78 65 85 C58 92 56 106 57 122
             L59 152 C61 170 63 182 65 194 C63 208 65 218 69 227
             L131 227 C135 218 137 208 135 194 C137 182 139 170 141 152
             L143 122 C144 106 142 92 135 85 C128 78 114 74 100 74 Z"/>
    <path d="M60 90 C52 98 48 120 46 142 C44 164 42 188 41 208
             C40 218 44 224 49 223 C54 222 55 216 56 207
             C58 186 61 162 64 140 C66 122 67 104 68 94 Z"/>
    <path d="M140 90 C148 98 152 120 154 142 C156 164 158 188 159 208
             C160 218 156 224 151 223 C146 222 145 216 144 207
             C142 186 139 162 136 140 C134 122 133 104 132 94 Z"/>
    <path d="M71 229 C69 252 70 276 72 298 C74 320 76 342 77 362
             C78 382 79 400 79 414 C79 422 81 426 86 426 C91 426 93 422 93 414
             C93 398 94 380 95 360 C96 338 97 316 98 296 L99 229 Z"/>
    <path d="M129 229 C131 252 130 276 128 298 C126 320 124 342 123 362
             C122 382 121 400 121 414 C121 422 119 426 114 426 C109 426 107 422 107 414
             C107 398 106 380 105 360 C104 338 103 316 102 296 L101 229 Z"/>
    <path d="M79 428 C74 430 68 434 68 439 C68 443 72 444 78 444 L93 444 L93 428 Z"/>
    <path d="M121 428 C126 430 132 434 132 439 C132 443 128 444 122 444 L107 444 L107 428 Z"/>`;

  const columna = vista === "espalda" ? `
    <g opacity="0.30" stroke="var(--text)" stroke-width="2.2" fill="none" stroke-linecap="round">
      <line x1="100" y1="80" x2="100" y2="222"/>
      ${[92, 104, 116, 128, 140, 152, 164, 176, 188, 200, 212].map(y =>
        `<line x1="94" y1="${y}" x2="106" y2="${y}" stroke-width="1.4"/>`).join("")}
    </g>` : "";

  return `<g fill="var(--text)" opacity="0.20">${cuerpo}</g>${columna}`;
}

// ─── QUÉ REGIÓN HAY EN CADA PARTE DE LA SILUETA ───────────────────────────
//
// En porcentaje del ancho y del alto, no en píxeles: el SVG escala con la
// pantalla y las cajas tienen que escalar con él.
//
// Las regiones del tronco cambian según la vista, y es lo correcto: el tórax
// y el abdomen se marcan de frente, y la columna dorsal, lumbar y la
// sacroilíaca de espaldas. Un "dolor lumbar" marcado sobre el ombligo sería
// un dato mal cargado.
const ZONAS_FRENTE = [
  { id: "cervical", x: 42, y: 12, w: 16, h: 5 },
  { id: "hombro",   x: 24, y: 16, w: 17, h: 7 },
  { id: "hombro",   x: 59, y: 16, w: 17, h: 7 },
  { id: "torax",    x: 30, y: 17, w: 40, h: 14 },
  { id: "abdomen",  x: 31, y: 31, w: 38, h: 12 },
  { id: "codo",     x: 17, y: 29, w: 12, h: 7 },
  { id: "codo",     x: 71, y: 29, w: 12, h: 7 },
  { id: "muneca",   x: 15, y: 41, w: 11, h: 5 },
  { id: "muneca",   x: 74, y: 41, w: 11, h: 5 },
  { id: "mano",     x: 14, y: 46, w: 12, h: 7 },
  { id: "mano",     x: 74, y: 46, w: 12, h: 7 },
  { id: "cadera",   x: 32, y: 43, w: 36, h: 8 },
  { id: "muslo",    x: 34, y: 51, w: 15, h: 13 },
  { id: "muslo",    x: 51, y: 51, w: 15, h: 13 },
  { id: "rodilla",  x: 35, y: 64, w: 14, h: 6 },
  { id: "rodilla",  x: 51, y: 64, w: 14, h: 6 },
  { id: "pierna",   x: 35, y: 70, w: 14, h: 15 },
  { id: "pierna",   x: 51, y: 70, w: 14, h: 15 },
  { id: "tobillo",  x: 36, y: 85, w: 12, h: 5 },
  { id: "tobillo",  x: 52, y: 85, w: 12, h: 5 },
  { id: "pie",      x: 32, y: 90, w: 16, h: 6 },
  { id: "pie",      x: 52, y: 90, w: 16, h: 6 },
];

const ZONAS_ESPALDA = ZONAS_FRENTE.map(z =>
  z.id === "torax" ? { ...z, id: "dorsal" } :
  z.id === "abdomen" ? { ...z, id: "lumbar" } :
  z.id === "cadera" ? { ...z, id: "sacroiliaca" } : z
);

function regionDeClic(vista, x, y) {
  const zonas = vista === "espalda" ? ZONAS_ESPALDA : ZONAS_FRENTE;
  // De atrás para adelante: las cajas de los miembros están declaradas
  // después que las del tronco y tienen que ganar donde se superponen.
  for (let i = zonas.length - 1; i >= 0; i--) {
    const z = zonas[i];
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.id;
  }
  return "otra";
}

// ═══ EL LADO, DEDUCIDO ═════════════════════════════════════════════════════
//
// Ver el comentario del encabezado. De frente está cruzado, de espaldas no.
// Las regiones de la línea media no tienen lado y devuelven "central".
const REGIONES_SIN_LADO = new Set(["cervical", "torax", "abdomen", "dorsal", "lumbar"]);

function ladoSegunVista(vista, region, x) {
  if (REGIONES_SIN_LADO.has(region)) return "central";
  if (x >= 47 && x <= 53) return "central";
  const esMitadIzquierdaDeLaPantalla = x < 50;
  // De frente, la mitad izquierda de la pantalla es el lado DERECHO del
  // paciente. De espaldas, coinciden.
  if (vista === "espalda") return esMitadIzquierdaDeLaPantalla ? "izquierdo" : "derecho";
  return esMitadIzquierdaDeLaPantalla ? "derecho" : "izquierdo";
}

// ─── Estado de la pantalla ────────────────────────────────────────────────
let fisioVista = "frente";
let fisioEvaluacion = null;
let fisioOpciones = null;

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA 1 — EVALUACIÓN Y MAPA DE DOLOR
// ═══════════════════════════════════════════════════════════════════════════
async function renderTabFisioEvaluacion(pacienteId) {
  const box = document.getElementById("fisioEvaluacionBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>${t("fisio.cargando")}</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/fisio`);
    fisioEvaluacion = data.evaluacion;
    fisioOpciones = data.opciones;
    pintarFisioEvaluacion(pacienteId);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || t("fisio.errCargar"))}</div>`;
  }
}

function pintarFisioEvaluacion(pacienteId) {
  const box = document.getElementById("fisioEvaluacionBox");
  if (!box) return;
  const ev = fisioEvaluacion;
  const puntosVista = (ev.puntosDolor || [])
    .map((p, i) => ({ ...p, i }))
    .filter(p => (p.vista || "frente") === fisioVista);

  const banderas = ev.banderasRojas || [];

  box.innerHTML = `
    ${banderas.length ? `
      <div class="card" style="border-color:var(--danger);background:var(--danger-bg)">
        <div class="seccion-titulo" style="margin-top:0;color:var(--danger)">${t("fisio.banderas.hay")}</div>
        <div>${banderas.map(b => esc(t("fisio.bandera." + b))).join(" · ")}</div>
        <div class="hint" style="margin-bottom:0">${t("fisio.banderas.aviso")}</div>
      </div>` : ""}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("fisio.mapa.titulo")}</div>
      <div class="fisio-vistas">
        <button class="secondary ${fisioVista === "frente" ? "activo" : ""}" id="btnVistaFrente">${t("fisio.vista.frente")}</button>
        <button class="secondary ${fisioVista === "espalda" ? "activo" : ""}" id="btnVistaEspalda">${t("fisio.vista.espalda")}</button>
      </div>
      <div class="hint">${t("fisio.mapa.ayuda")}</div>
      <div class="fisio-silueta-caja">
        <svg id="fisioSilueta" class="fisio-silueta" viewBox="0 0 200 470"
             role="img" aria-label="${esc(t("fisio.mapa.titulo"))}">
          ${siluetaHumanaSvg(fisioVista)}
          ${puntosVista.map(p => `
            <g class="fisio-punto" data-punto="${p.i}">
              <circle cx="${(p.x * 2).toFixed(1)}" cy="${(p.y * 4.7).toFixed(1)}"
                      r="${(7 + p.intensidad * 0.9).toFixed(1)}"
                      fill="${colorDolor(p.intensidad)}" opacity="0.30"/>
              <circle cx="${(p.x * 2).toFixed(1)}" cy="${(p.y * 4.7).toFixed(1)}" r="7"
                      fill="${colorDolor(p.intensidad)}"/>
              <text x="${(p.x * 2).toFixed(1)}" y="${(p.y * 4.7 + 3.6).toFixed(1)}"
                    class="fisio-punto-num">${p.intensidad}</text>
              <title>${esc(t("reg." + p.region))} · ${esc(t("lado." + p.lado))} · ${p.intensidad}/10</title>
            </g>`).join("")}
        </svg>
      </div>
      ${puntosVista.length === 0 ? `<div class="hint">${t("fisio.mapa.vacio")}</div>` : ""}
    </div>

    <!-- El formulario de marcar dolor se dibuja ACÁ, pegado abajo de la
         silueta. Antes se insertaba al principio de la pestaña y en una
         pantalla de computadora aparecía tres tarjetas más arriba: se tocaba
         el hombro y no pasaba nada visible. Mismo patrón que el mapa
         corporal de veterinaria, que usa su propio contenedor. -->
    <div id="fisioFormDolorBox"></div>

    ${(ev.puntosDolor || []).length ? `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("fisio.puntos.titulo")}</div>
        ${(ev.puntosDolor || []).map((p, i) => `
          <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>
              <b style="color:${colorDolor(p.intensidad)}">${p.intensidad}/10</b>
              ${esc(t("reg." + p.region))}
              ${p.lado !== "central" ? `<span class="hint" style="display:inline;margin:0"> · ${esc(t("lado." + p.lado))}</span>` : ""}
              ${p.tipo !== "sin_clasificar" ? `<span class="hint" style="display:inline;margin:0"> · ${esc(t("dolor." + p.tipo))}</span>` : ""}
            </span>
            <button class="link" data-borrar-punto="${i}" style="margin:0;width:auto;color:var(--danger)">✕</button>
          </div>`).join("")}
      </div>` : ""}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("fisio.ev.titulo")}</div>
      <label>${t("fisio.ev.motivo")}</label>
      <input id="fisioMotivo" type="text" value="${esc(ev.motivo || "")}" placeholder="${t("fisio.ev.motivoPh")}">
      <label>${t("fisio.ev.mecanismo")}</label>
      <input id="fisioMecanismo" type="text" value="${esc(ev.mecanismo || "")}" placeholder="${t("fisio.ev.mecanismoPh")}">
      <label>${t("fisio.ev.desde")}</label>
      <input id="fisioDesde" type="date" value="${ev.desde ? new Date(ev.desde).toISOString().slice(0, 10) : ""}">
      <label>${t("fisio.ev.notas")}</label>
      <input id="fisioNotas" type="text" value="${esc(ev.notas || "")}" placeholder="${t("fisio.ev.notasPh")}">
      <button class="secondary" id="btnGuardarEv">${t("fisio.guardar")}</button>
      <div id="fisioEvErr"></div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("fisio.banderas.titulo")}</div>
      <div class="hint">${t("fisio.banderas.ayuda")}</div>
      ${(fisioOpciones.BANDERAS_ROJAS || []).map(b => `
        <label class="fisio-check">
          <input type="checkbox" data-bandera="${b}" ${banderas.includes(b) ? "checked" : ""}>
          <span>${esc(t("fisio.bandera." + b))}</span>
        </label>`).join("")}
    </div>`;

  document.getElementById("btnVistaFrente").onclick = () => { fisioVista = "frente"; pintarFisioEvaluacion(pacienteId); };
  document.getElementById("btnVistaEspalda").onclick = () => { fisioVista = "espalda"; pintarFisioEvaluacion(pacienteId); };

  const svg = document.getElementById("fisioSilueta");
  svg.onclick = (e) => {
    // Si el clic fue sobre un punto ya marcado, no se agrega otro encima.
    if (e.target.closest(".fisio-punto")) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    abrirFormularioDolor(pacienteId, x, y);
  };

  document.querySelectorAll("[data-borrar-punto]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("fisio.puntos.confirmarBorrar"))) return;
      try {
        const r = await api(`/medico/pacientes/${pacienteId}/fisio/dolor/${btn.dataset.borrarPunto}`, { method: "DELETE" });
        fisioEvaluacion = r.evaluacion;
        pintarFisioEvaluacion(pacienteId);
      } catch (e) { alert(e.error || t("fisio.errGuardar")); }
    };
  });

  document.getElementById("btnGuardarEv").onclick = async () => {
    const err = document.getElementById("fisioEvErr");
    err.innerHTML = "";
    try {
      const r = await api(`/medico/pacientes/${pacienteId}/fisio`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motivo: document.getElementById("fisioMotivo").value,
          mecanismo: document.getElementById("fisioMecanismo").value,
          desde: document.getElementById("fisioDesde").value || null,
          notas: document.getElementById("fisioNotas").value,
        }),
      });
      fisioEvaluacion = r.evaluacion;
      err.innerHTML = `<div class="hint" style="color:var(--success)">${t("fisio.guardado")}</div>`;
    } catch (e) { err.innerHTML = `<div class="error">${esc(e.error || t("fisio.errGuardar"))}</div>`; }
  };

  document.querySelectorAll("[data-bandera]").forEach(chk => {
    chk.onchange = async () => {
      const marcadas = [...document.querySelectorAll("[data-bandera]:checked")].map(c => c.dataset.bandera);
      try {
        const r = await api(`/medico/pacientes/${pacienteId}/fisio`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ banderasRojas: marcadas }),
        });
        fisioEvaluacion = r.evaluacion;
        pintarFisioEvaluacion(pacienteId);
      } catch (e) { alert(e.error || t("fisio.errGuardar")); }
    };
  });
}

// ─── Marcar un punto: el formulario ya viene con la región y el lado ──────
function abrirFormularioDolor(pacienteId, x, y) {
  const region = regionDeClic(fisioVista, x, y);
  const lado = ladoSegunVista(fisioVista, region, x);
  // Su propio contenedor, justo abajo de la silueta. Ver el comentario en
  // pintarFisioEvaluacion().
  const box = document.getElementById("fisioFormDolorBox");
  if (!box) return;
  box.innerHTML = "";

  const form = document.createElement("div");
  form.className = "card";
  form.id = "fisioFormDolor";
  form.style.borderColor = "var(--primary)";
  form.innerHTML = `
    <div class="seccion-titulo" style="margin-top:0">${t("fisio.dolor.titulo")}</div>
    <div class="hint">
      ${esc(t("reg." + region))}${lado !== "central" ? " · " + esc(t("lado." + lado)) : ""}
      — ${t("fisio.dolor.ladoAviso")}
    </div>
    <label>${t("fisio.dolor.region")}</label>
    <select id="dolorRegion">
      ${(fisioOpciones.REGIONES_CUERPO || []).map(r =>
        `<option value="${r}" ${r === region ? "selected" : ""}>${esc(t("reg." + r))}</option>`).join("")}
    </select>
    <label>${t("fisio.dolor.lado")}</label>
    <select id="dolorLado">
      ${(fisioOpciones.LADOS_FISIO || []).map(l =>
        `<option value="${l}" ${l === lado ? "selected" : ""}>${esc(t("lado." + l))}</option>`).join("")}
    </select>
    <label>${t("fisio.dolor.intensidad")} <b id="dolorValorTxt">5</b>/10</label>
    <input id="dolorIntensidad" type="range" min="0" max="10" value="5" step="1">
    <label>${t("fisio.dolor.tipo")}</label>
    <select id="dolorTipo">
      ${(fisioOpciones.TIPOS_DOLOR || []).map(tp =>
        `<option value="${tp}">${esc(t("dolor." + tp))}</option>`).join("")}
    </select>
    <label>${t("fisio.dolor.notas")}</label>
    <input id="dolorNotas" type="text" placeholder="${t("fisio.opcional")}">
    <div id="dolorErr"></div>
    <button class="primary" id="btnGuardarDolor">${t("fisio.dolor.marcar")}</button>
    <button class="secondary" id="btnCancelarDolor">${t("fisio.cancelar")}</button>`;
  box.appendChild(form);
  // "start" y no "nearest": con "nearest" el navegador decide que ya está
  // bastante cerca y no mueve nada, que es justo el síntoma —se toca la
  // silueta y aparentemente no pasa nada—. Con "start" el formulario queda
  // arriba de la pantalla, visible sí o sí.
  form.scrollIntoView({ behavior: "smooth", block: "start" });

  const rango = document.getElementById("dolorIntensidad");
  const txt = document.getElementById("dolorValorTxt");
  rango.oninput = () => { txt.textContent = rango.value; txt.style.color = colorDolor(rango.value); };
  rango.oninput();

  document.getElementById("btnCancelarDolor").onclick = () => form.remove();
  document.getElementById("btnGuardarDolor").onclick = async () => {
    const err = document.getElementById("dolorErr");
    err.innerHTML = "";
    try {
      const r = await api(`/medico/pacientes/${pacienteId}/fisio/dolor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: document.getElementById("dolorRegion").value,
          lado: document.getElementById("dolorLado").value,
          vista: fisioVista,
          x, y,
          intensidad: Number(rango.value),
          tipo: document.getElementById("dolorTipo").value,
          notas: document.getElementById("dolorNotas").value,
        }),
      });
      fisioEvaluacion = r.evaluacion;
      pintarFisioEvaluacion(pacienteId);
    } catch (e) { err.innerHTML = `<div class="error">${esc(e.error || t("fisio.errGuardar"))}</div>`; }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA 2 — MOVILIDAD (goniometría contra el rango de referencia)
// ═══════════════════════════════════════════════════════════════════════════
async function renderTabFisioMovilidad(pacienteId) {
  const box = document.getElementById("fisioMovilidadBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>${t("fisio.cargando")}</div>`;
  try {
    const [conf, med] = await Promise.all([
      fisioOpciones ? Promise.resolve({ opciones: fisioOpciones }) : api(`/medico/pacientes/${pacienteId}/fisio`),
      api(`/medico/pacientes/${pacienteId}/fisio/mediciones?clase=goniometria`),
    ]);
    fisioOpciones = conf.opciones || fisioOpciones;
    pintarFisioMovilidad(pacienteId, med.mediciones || []);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || t("fisio.errCargar"))}</div>`;
  }
}

// El rango de referencia de un movimiento, o null si no está en la tabla.
function normalDe(articulacion, movimiento) {
  const a = (fisioOpciones?.ARTICULACIONES_ROM || []).find(x => x.articulacion === articulacion);
  const m = a?.movimientos.find(x => x.clave === movimiento);
  return m ? m.normal : null;
}

// ═══ LA BARRA CONTRA LA REFERENCIA ═════════════════════════════════════════
//
// Lo que hace útil al número. 95° de flexión de hombro no dice nada solo;
// contra los 180° de referencia dice que está en la mitad.
//
// La extensión de codo y de rodilla tienen referencia 0: ahí el "100%" es
// llegar a cero, y cualquier grado de más es un déficit de extensión. Una
// división por cero pintaría la barra vacía y diría 0%, que es exactamente
// lo contrario de lo que pasa.
function barraMovilidad(valor, normal) {
  if (normal === null) return "";
  if (normal === 0) {
    const ok = valor <= 0;
    return `
      <div class="fisio-barra">
        <div class="fisio-barra-relleno" style="width:${ok ? 100 : 40}%;background:${ok ? "var(--success)" : "var(--warning)"}"></div>
      </div>
      <div class="hint" style="margin:2px 0 0">
        ${ok ? t("fisio.rom.extensionCompleta") : t("fisio.rom.faltaExtension").replace("{g}", valor)}
      </div>`;
  }
  const pct = Math.max(0, Math.min(100, Math.round((valor / normal) * 100)));
  const color = pct >= 90 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--danger)";
  return `
    <div class="fisio-barra">
      <div class="fisio-barra-relleno" style="width:${pct}%;background:${color}"></div>
    </div>
    <div class="hint" style="margin:2px 0 0">
      ${t("fisio.rom.contra").replace("{n}", normal).replace("{p}", pct)}
    </div>`;
}

function pintarFisioMovilidad(pacienteId, mediciones) {
  const box = document.getElementById("fisioMovilidadBox");
  if (!box) return;

  // La más reciente de cada combinación articulación+movimiento+lado. Vienen
  // ordenadas por fecha descendente, así que la primera de cada clave es la
  // última tomada.
  const ultimas = new Map();
  for (const m of mediciones) {
    const clave = `${m.zona}|${m.movimiento}|${m.lado}`;
    if (!ultimas.has(clave)) ultimas.set(clave, m);
  }

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("fisio.rom.nueva")}</div>
      <label>${t("fisio.rom.articulacion")}</label>
      <select id="romArticulacion">
        ${(fisioOpciones?.ARTICULACIONES_ROM || []).map(a =>
          `<option value="${a.articulacion}">${esc(t("art." + a.articulacion))}</option>`).join("")}
      </select>
      <label>${t("fisio.rom.movimiento")}</label>
      <select id="romMovimiento"></select>
      <label>${t("fisio.rom.lado")}</label>
      <select id="romLado">
        ${(fisioOpciones?.LADOS_FISIO || []).map(l =>
          `<option value="${l}">${esc(t("lado." + l))}</option>`).join("")}
      </select>
      <label>${t("fisio.rom.grados")}</label>
      <input id="romGrados" type="number" min="0" max="180" inputmode="numeric" placeholder="${t("fisio.rom.gradosPh")}">
      <div class="hint" id="romReferencia"></div>
      <label>${t("fisio.rom.fecha")}</label>
      <input id="romFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <div id="romErr"></div>
      <button class="secondary" id="btnGuardarRom">${t("fisio.guardar")}</button>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("fisio.rom.actual")}</div>
      ${ultimas.size === 0 ? `<div class="hint">${t("fisio.rom.vacio")}</div>` : ""}
      ${[...ultimas.values()].map(m => {
        const normal = normalDe(m.zona, m.movimiento);
        return `
          <div class="fisio-rom-fila">
            <div class="fisio-rom-encabezado">
              <span>
                <b>${esc(t("art." + m.zona))}</b> · ${esc(t("mov." + m.movimiento))}
                ${m.lado !== "central" ? `<span class="hint" style="display:inline;margin:0"> · ${esc(t("lado." + m.lado))}</span>` : ""}
              </span>
              <span class="fisio-rom-grados">${m.valor}°</span>
            </div>
            ${barraMovilidad(m.valor, normal)}
            <div class="fecha">${new Date(m.fecha).toLocaleDateString(localeActual())}</div>
          </div>`;
      }).join("")}
    </div>

    ${mediciones.length > 1 ? `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("fisio.rom.historial")}</div>
        ${mediciones.slice(0, 30).map(m => `
          <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>
              ${esc(t("art." + m.zona))} · ${esc(t("mov." + m.movimiento))}
              ${m.lado !== "central" ? ` · ${esc(t("lado." + m.lado))}` : ""}
              — <b>${m.valor}°</b>
              <span class="hint" style="display:inline;margin:0"> ${new Date(m.fecha).toLocaleDateString(localeActual())}</span>
            </span>
            <button class="link" data-borrar-med="${m._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
          </div>`).join("")}
      </div>` : ""}`;

  const selArt = document.getElementById("romArticulacion");
  const selMov = document.getElementById("romMovimiento");
  const inpGrados = document.getElementById("romGrados");
  const refTxt = document.getElementById("romReferencia");

  function llenarMovimientos() {
    const a = (fisioOpciones?.ARTICULACIONES_ROM || []).find(x => x.articulacion === selArt.value);
    selMov.innerHTML = (a?.movimientos || []).map(m =>
      `<option value="${m.clave}">${esc(t("mov." + m.clave))}</option>`).join("");
    mostrarReferencia();
  }
  function mostrarReferencia() {
    const n = normalDe(selArt.value, selMov.value);
    refTxt.textContent = n === null ? "" : t("fisio.rom.referencia").replace("{n}", n);
  }
  selArt.onchange = llenarMovimientos;
  selMov.onchange = mostrarReferencia;
  llenarMovimientos();

  document.getElementById("btnGuardarRom").onclick = async () => {
    const err = document.getElementById("romErr");
    err.innerHTML = "";
    try {
      await api(`/medico/pacientes/${pacienteId}/fisio/mediciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clase: "goniometria",
          zona: selArt.value,
          movimiento: selMov.value,
          lado: document.getElementById("romLado").value,
          valor: Number(inpGrados.value),
          fecha: document.getElementById("romFecha").value || undefined,
        }),
      });
      renderTabFisioMovilidad(pacienteId);
    } catch (e) { err.innerHTML = `<div class="error">${esc(e.error || t("fisio.errGuardar"))}</div>`; }
  };

  document.querySelectorAll("[data-borrar-med]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("fisio.rom.confirmarBorrar"))) return;
      try {
        await api(`/medico/fisio/mediciones/${btn.dataset.borrarMed}`, { method: "DELETE" });
        renderTabFisioMovilidad(pacienteId);
      } catch (e) { alert(e.error || t("fisio.errGuardar")); }
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA 3 — OBJETIVOS FUNCIONALES
// ═══════════════════════════════════════════════════════════════════════════
async function renderTabObjetivosFisio(pacienteId) {
  const box = document.getElementById("objetivosFisioBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>${t("fisio.cargando")}</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/fisio/objetivos`);
    pintarObjetivosFisio(pacienteId, data.objetivos || [], data.opciones);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || t("fisio.errCargar"))}</div>`;
  }
}

function porcentajeFisio(p) {
  return p.intentos ? Math.round((p.logros / p.intentos) * 100) : 0;
}

// ═══ EL GRÁFICO: dos cosas a la vez ════════════════════════════════════════
//
// La línea es el nivel de ayuda —cuanto más arriba, menos ayuda necesita— y
// es lo que de verdad mide el avance en rehabilitación. El color de cada
// punto es el dolor de esa sesión.
//
// Están juntos a propósito: un paciente que pasó de "ayuda física total" a
// "independiente" pero con los puntos cada vez más rojos NO está mejorando,
// está compensando. En dos gráficos separados eso no se ve.
function graficoObjetivoFisio(prog) {
  const ultimos = prog.slice(-12);
  if (!ultimos.length) return "";

  const W = 320, H = 156, IZQ = 88, DER = 14, ARR = 12, ABA = 26;
  const anchoUtil = W - IZQ - DER, altoUtil = H - ARR - ABA;
  const filas = AYUDAS_FISIO.length;
  const y = (ayuda) => {
    const i = AYUDAS_FISIO.indexOf(ayuda);
    return ARR + altoUtil - ((i < 0 ? 0 : i) / (filas - 1)) * altoUtil;
  };
  const x = (i) => ultimos.length === 1
    ? IZQ + anchoUtil / 2
    : IZQ + (i / (ultimos.length - 1)) * anchoUtil;

  const puntos = ultimos.map((p, i) => ({ ...p, cx: x(i), cy: y(p.ayuda) }));
  const linea = puntos.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  const primero = puntos[0], ultimo = puntos[puntos.length - 1];
  const bajoLaAyuda = AYUDAS_FISIO.indexOf(ultimo.ayuda) > AYUDAS_FISIO.indexOf(primero.ayuda);
  const subioElDolor = (ultimo.dolor || 0) > (primero.dolor || 0);

  return `
    <svg class="ayuda-grafico" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="${esc(t("fisio.obj.graficoAlt").replace("{n}", ultimos.length))}">
      ${AYUDAS_FISIO.map(a => `
        <line x1="${IZQ}" y1="${y(a)}" x2="${W - DER}" y2="${y(a)}" class="ayuda-guia" />
        <text x="${IZQ - 8}" y="${y(a) + 3.5}" class="ayuda-eje">${esc(t("ayudaCorta." + a))}</text>`).join("")}
      ${puntos.length > 1 ? `<polyline points="${linea}" class="ayuda-linea" />` : ""}
      ${puntos.map((p, i) => `
        <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${i === puntos.length - 1 ? 5.5 : 4}"
                fill="${colorDolor(p.dolor)}" stroke="var(--card)" stroke-width="1.2">
          <title>${p.logros}/${p.intentos} · ${esc(t("ayuda." + p.ayuda))} · ${t("fisio.obj.dolorTit")} ${p.dolor || 0}/10</title>
        </circle>`).join("")}
      <text x="${IZQ}" y="${H - 8}" class="ayuda-pie">${t("fisio.obj.sesiones").replace("{n}", ultimos.length)}</text>
      <text x="${W - DER}" y="${H - 8}" class="ayuda-pie" text-anchor="end">
        ${ultimo.intentos ? t("fisio.obj.ultima").replace("{a}", ultimo.logros).replace("{b}", ultimo.intentos) : ""}
      </text>
    </svg>
    <div class="hint" style="margin:0;font-size:11.5px">
      ${bajoLaAyuda && subioElDolor ? t("fisio.obj.ojoDolor")
        : bajoLaAyuda ? t("fisio.obj.mejora")
          .replace("{a}", esc(t("ayuda." + primero.ayuda)))
          .replace("{b}", esc(t("ayuda." + ultimo.ayuda)))
        : t("fisio.obj.leyenda")}
    </div>`;
}

function pintarObjetivosFisio(pacienteId, objetivos, opciones) {
  const box = document.getElementById("objetivosFisioBox");
  if (!box) return;
  const areas = opciones?.AREAS_OBJETIVO_FISIO || [];

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("fisio.obj.nuevo")}</div>
      <label>${t("fisio.obj.titulo")}</label>
      <input id="objFisioTitulo" type="text" placeholder="${t("fisio.obj.tituloPh")}">
      <label>${t("fisio.obj.area")}</label>
      <select id="objFisioArea">
        ${areas.map(a => `<option value="${a}">${esc(t("areaFisio." + a))}</option>`).join("")}
      </select>
      <label>${t("fisio.obj.criterio")}</label>
      <input id="objFisioCriterio" type="text" placeholder="${t("fisio.obj.criterioPh")}">
      <div class="hint">${t("fisio.obj.criterioAyuda")}</div>
      <div id="objFisioErr"></div>
      <button class="secondary" id="btnNuevoObjFisio">${t("fisio.obj.crear")}</button>
    </div>

    ${objetivos.length === 0 ? `<div class="empty">${t("fisio.obj.vacio")}</div>` : ""}
    ${objetivos.map(o => `
      <div class="card" data-obj="${o._id}">
        <div class="top" style="display:flex;justify-content:space-between;gap:8px">
          <div class="nombre">${esc(o.titulo)}</div>
          <span class="hint" style="margin:0;white-space:nowrap">${esc(t("areaFisio." + o.area))}</span>
        </div>
        ${o.criterio ? `<div class="hint">${esc(o.criterio)}</div>` : ""}
        ${o.estado !== "activo" ? `<div class="hint"><b>${esc(t("estadoObj." + o.estado))}</b></div>` : ""}
        ${graficoObjetivoFisio(o.progreso || [])}
        ${(o.progreso || []).length === 0 ? `<div class="hint">${t("fisio.obj.sinSesiones")}</div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="secondary" data-sesion="${o._id}" style="width:auto">${t("fisio.obj.registrar")}</button>
          ${o.estado === "activo"
            ? `<button class="link" data-logrado="${o._id}" style="width:auto;margin:0">${t("fisio.obj.marcarLogrado")}</button>`
            : `<button class="link" data-reabrir="${o._id}" style="width:auto;margin:0">${t("fisio.obj.reabrir")}</button>`}
          <button class="link" data-borrar-obj="${o._id}" style="width:auto;margin:0;color:var(--danger)">${t("fisio.obj.borrar")}</button>
        </div>
      </div>`).join("")}`;

  document.getElementById("btnNuevoObjFisio").onclick = async () => {
    const err = document.getElementById("objFisioErr");
    err.innerHTML = "";
    try {
      await api(`/medico/pacientes/${pacienteId}/fisio/objetivos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: document.getElementById("objFisioTitulo").value,
          area: document.getElementById("objFisioArea").value,
          criterio: document.getElementById("objFisioCriterio").value,
        }),
      });
      renderTabObjetivosFisio(pacienteId);
    } catch (e) { err.innerHTML = `<div class="error">${esc(e.error || t("fisio.errGuardar"))}</div>`; }
  };

  document.querySelectorAll("[data-sesion]").forEach(btn => {
    btn.onclick = () => abrirSesionFisio(pacienteId, objetivos.find(o => o._id === btn.dataset.sesion));
  });

  const cambiarEstado = async (id, estado) => {
    try {
      await api(`/medico/fisio/objetivos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      renderTabObjetivosFisio(pacienteId);
    } catch (e) { alert(e.error || t("fisio.errGuardar")); }
  };
  document.querySelectorAll("[data-logrado]").forEach(b => b.onclick = () => cambiarEstado(b.dataset.logrado, "logrado"));
  document.querySelectorAll("[data-reabrir]").forEach(b => b.onclick = () => cambiarEstado(b.dataset.reabrir, "activo"));

  document.querySelectorAll("[data-borrar-obj]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("fisio.obj.confirmarBorrar"))) return;
      try {
        await api(`/medico/fisio/objetivos/${btn.dataset.borrarObj}`, { method: "DELETE" });
        renderTabObjetivosFisio(pacienteId);
      } catch (e) { alert(e.error || t("fisio.errGuardar")); }
    };
  });
}

function abrirSesionFisio(pacienteId, objetivo) {
  if (!objetivo) return;
  const box = document.getElementById("objetivosFisioBox");
  const previo = document.getElementById("fisioFormSesion");
  if (previo) previo.remove();

  // El formulario va PEGADO al objetivo que se tocó, no al principio de la
  // pestaña. Con varios objetivos cargados, abrirlo arriba de todo deja al
  // profesional cargando una sesión sin ver de cuál objetivo era.
  const tarjeta = box.querySelector(`[data-obj="${objetivo._id}"]`);

  const form = document.createElement("div");
  form.className = "card";
  form.id = "fisioFormSesion";
  form.style.borderColor = "var(--primary)";
  form.innerHTML = `
    <div class="seccion-titulo" style="margin-top:0">${t("fisio.sesion.titulo")}</div>
    <div class="hint">${esc(objetivo.titulo)}</div>
    <label>${t("fisio.sesion.fecha")}</label>
    <input id="sesFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
    <label>${t("fisio.sesion.intentos")}</label>
    <input id="sesIntentos" type="number" min="1" inputmode="numeric" placeholder="${t("fisio.sesion.intentosPh")}">
    <label>${t("fisio.sesion.logros")}</label>
    <input id="sesLogros" type="number" min="0" inputmode="numeric" placeholder="${t("fisio.sesion.logrosPh")}">
    <label>${t("fisio.sesion.ayuda")}</label>
    <select id="sesAyuda">
      ${[...AYUDAS_FISIO].reverse().map(a => `<option value="${a}">${esc(t("ayuda." + a))}</option>`).join("")}
    </select>
    <label>${t("fisio.sesion.dolor")} <b id="sesDolorTxt">0</b>/10</label>
    <input id="sesDolor" type="range" min="0" max="10" value="0" step="1">
    <div class="hint">${t("fisio.sesion.dolorAyuda")}</div>
    <label>${t("fisio.sesion.notas")}</label>
    <input id="sesNotas" type="text" placeholder="${t("fisio.opcional")}">
    <div id="sesErr"></div>
    <button class="primary" id="btnGuardarSesion">${t("fisio.guardar")}</button>
    <button class="secondary" id="btnCancelarSesion">${t("fisio.cancelar")}</button>`;
  if (tarjeta) tarjeta.insertAdjacentElement("afterend", form);
  else box.prepend(form);
  form.scrollIntoView({ behavior: "smooth", block: "start" });

  const rango = document.getElementById("sesDolor");
  const txt = document.getElementById("sesDolorTxt");
  rango.oninput = () => { txt.textContent = rango.value; txt.style.color = colorDolor(rango.value); };
  rango.oninput();

  document.getElementById("btnCancelarSesion").onclick = () => form.remove();
  document.getElementById("btnGuardarSesion").onclick = async () => {
    const err = document.getElementById("sesErr");
    err.innerHTML = "";
    try {
      await api(`/medico/fisio/objetivos/${objetivo._id}/progreso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: document.getElementById("sesFecha").value || undefined,
          intentos: Number(document.getElementById("sesIntentos").value),
          logros: Number(document.getElementById("sesLogros").value),
          ayuda: document.getElementById("sesAyuda").value,
          dolor: Number(rango.value),
          notas: document.getElementById("sesNotas").value,
        }),
      });
      renderTabObjetivosFisio(pacienteId);
    } catch (e) { err.innerHTML = `<div class="error">${esc(e.error || t("fisio.errGuardar"))}</div>`; }
  };
}
