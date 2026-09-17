// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Compartir el resumen, desde el kardex (lado médico)
// ═══════════════════════════════════════════════════════════════════════════
//
// Va adentro de «Más acciones», junto a vincular persona y armar la
// videoconsulta. No es una pestaña: compartir un resumen es algo que se hace
// cuando el paciente lo pide, no cada vez que se abre una ficha, y una pestaña
// más empuja las doce que ya hay.
//
// ═══ LA PREVISUALIZACIÓN NO ES UN LUJO ════════════════════════════════════
//
// El médico ve EXACTAMENTE lo que va a ver el colega, con la misma función que
// dibuja la página pública (resumenVista.js) y con el contenido que arma el
// mismo código del servidor que después lo guarda.
//
// Sin eso, «compartir» es apretar un botón y confiar. Y lo que se manda es la
// historia clínica de una persona: confiar no alcanza, y la primera vez que
// algo salga distinto de lo esperado el médico no vuelve a usar la función.
"use strict";

let crSecciones = [];
let crPorDefecto = {};
let crAlcance = "resumen";
let crElegidas = [];
let crPacienteId = null;
let crDiasValidez = 90;

function compartirResumenCajaHtml() {
  return `<div id="crBox"></div>`;
}

// Se pide una vez por sesión: es una lista fija, no cambia entre pacientes.
async function crCargarSecciones() {
  if (crSecciones.length) return true;
  try {
    const r = await api("/medico/resumenes/secciones");
    crSecciones = r.secciones || [];
    crPorDefecto = r.porDefecto || {};
    crDiasValidez = r.diasValidez || 90;
    return true;
  } catch { return false; }
}

async function compartirResumenPintar(pacienteId) {
  const caja = document.getElementById("crBox");
  if (!caja) return;
  crPacienteId = pacienteId;
  if (!await crCargarSecciones()) { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  crAlcance = "resumen";
  crElegidas = (crPorDefecto.resumen || []).slice();

  let previos = [];
  try {
    const r = await api(`/medico/pacientes/${pacienteId}/resumenes`);
    previos = r.resumenes || [];
  } catch { /* sin la lista se puede compartir igual */ }
  if (!caja.isConnected) return;

  caja.innerHTML = `
    <div class="card card-secundaria">
      <div style="font-weight:600">Resumen para otro médico</div>
      <div class="hint" style="margin:2px 0 10px">
        Una hoja que el paciente le puede mostrar a otro profesional. El enlace vence a los
        ${crDiasValidez} días y se puede cortar cuando quieras.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="secondary" id="crAbrir">Preparar resumen</button>
        <button class="secondary" id="crLlave">Darle acceso a su historia</button>
      </div>
      <div id="crPanel"></div>
      <div id="crPrevios">${crPreviosHtml(previos)}</div>
    </div>`;

  document.getElementById("crAbrir").onclick = crAbrirPanel;
  document.getElementById("crLlave").onclick = crEmitirLlave;
  crCablearPrevios();
}

function crPreviosHtml(previos) {
  if (!previos || !previos.length) return "";
  const fila = (r) => {
    const vencido = new Date(r.vence) < new Date();
    const muerto = r.revocadoEn || vencido;
    const quien = r.generadoPor === "paciente" ? "lo generó el paciente" : "";
    const estado = r.revocadoEn ? "cortado" : vencido ? "venció"
      : r.vistas ? `abierto ${r.vistas} ${r.vistas === 1 ? "vez" : "veces"}` : "sin abrir";
    return `
      <li style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;
                 padding:7px 0;border-bottom:1px dotted var(--linea)">
        <span class="${muerto ? "hint" : ""}">
          ${r.alcance === "completo" ? "Historia completa" : "Resumen"} ·
          ${esc(fechaCorta(r.creadoEn))} · ${esc(estado)}${quien ? " · " + quien : ""}
        </span>
        ${muerto ? "" : `<span style="display:flex;gap:6px">
          <button class="secondary" data-cr-copiar="${esc(r.enlace || "")}">Copiar enlace</button>
          <button class="secondary" data-cr-cortar="${esc(r.id)}">Cortar</button>
        </span>`}
      </li>`;
  };
  return `
    <div style="margin-top:12px">
      <div class="hint" style="margin-bottom:4px">Ya compartidos</div>
      <ul style="list-style:none;margin:0;padding:0">${previos.map(fila).join("")}</ul>
    </div>`;
}

function crCablearPrevios() {
  [].slice.call(document.querySelectorAll("[data-cr-copiar]")).forEach(b => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.getAttribute("data-cr-copiar")); b.textContent = "Copiado"; }
      catch { b.textContent = "No se pudo copiar"; }
    };
  });
  [].slice.call(document.querySelectorAll("[data-cr-cortar]")).forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/medico/resumenes/${b.getAttribute("data-cr-cortar")}/revocar`, { method: "POST" });
        await compartirResumenPintar(crPacienteId);
      } catch (e) { b.disabled = false; b.textContent = (e && e.error) || "No se pudo"; }
    };
  });
}

function crAbrirPanel() {
  const panel = document.getElementById("crPanel");
  if (panel.innerHTML) { panel.innerHTML = ""; return; }   // vuelve a cerrarse
  crPintarPanel();
}

function crPintarPanel() {
  const panel = document.getElementById("crPanel");
  const casilla = (s) => `
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px;
                  ${s.fija ? "opacity:.65" : "cursor:pointer"}">
      <input type="checkbox" data-cr-s="${esc(s.clave)}"
        ${crElegidas.includes(s.clave) ? "checked" : ""} ${s.fija ? "disabled" : ""}>
      <span>${esc(s.titulo)}${s.fija ? ` <span class="hint">— siempre va</span>` : ""}</span>
    </label>`;

  panel.innerHTML = `
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--linea)">
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="secondary" data-cr-a="resumen" aria-pressed="${crAlcance === "resumen"}">Resumen (1 hoja)</button>
        <button class="secondary" data-cr-a="completo" aria-pressed="${crAlcance === "completo"}">Historia completa</button>
      </div>
      <div style="display:grid;gap:5px;margin-bottom:12px">${crSecciones.map(casilla).join("")}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="secondary" id="crPrevia">Ver cómo queda</button>
        <button class="primary" id="crGenerar">Generar enlace</button>
      </div>
      <div id="crSalida"></div>
    </div>`;

  [].slice.call(panel.querySelectorAll("[data-cr-a]")).forEach(b => {
    b.onclick = () => {
      crAlcance = b.getAttribute("data-cr-a");
      // Al cambiar de alcance se vuelve a lo que corresponde por defecto: si
      // se conservaran las casillas destildadas, «historia completa» podría
      // terminar mandando menos que «resumen».
      crElegidas = (crPorDefecto[crAlcance] || []).slice();
      crPintarPanel();
    };
  });
  [].slice.call(panel.querySelectorAll("[data-cr-s]")).forEach(i => {
    i.onchange = () => {
      const c = i.getAttribute("data-cr-s");
      crElegidas = i.checked ? crElegidas.concat([c]) : crElegidas.filter(x => x !== c);
    };
  });
  document.getElementById("crPrevia").onclick = crVerPrevia;
  document.getElementById("crGenerar").onclick = crGenerar;
}

// La previsualización se abre en una ventana aparte y con la hoja de estilos
// de la página pública: verla adentro del tema oscuro de la app daría una idea
// equivocada de lo que va a recibir el colega, que la ve en blanco.
async function crVerPrevia() {
  const b = document.getElementById("crPrevia");
  b.disabled = true;
  try {
    const r = await api(`/medico/pacientes/${crPacienteId}/resumenes/previa`, {
      method: "POST",
      body: JSON.stringify({ alcance: crAlcance, secciones: crElegidas }),
    });
    const w = window.open("", "_blank");
    if (!w) { document.getElementById("crSalida").innerHTML = `<p class="hint">Permití las ventanas emergentes para ver la previa.</p>`; return; }
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Así lo va a ver</title><link rel="stylesheet" href="/resumen.css"></head>
      <body><div class="barra"><span class="marca"><i></i>PREVISUALIZACIÓN</span>
      <span class="barra-nota">Así lo ve el otro médico. Todavía no se compartió nada.</span></div>
      <div class="envoltorio">${resumenVistaHtml(r.contenido, { firma: r.firma })}</div></body></html>`);
    w.document.close();
  } catch (e) {
    document.getElementById("crSalida").innerHTML = `<p class="hint">${esc((e && e.error) || "No se pudo armar la previa.")}</p>`;
  } finally { b.disabled = false; }
}

async function crGenerar() {
  const b = document.getElementById("crGenerar");
  const salida = document.getElementById("crSalida");
  b.disabled = true;
  b.textContent = "Generando…";
  try {
    const r = await api(`/medico/pacientes/${crPacienteId}/resumenes`, {
      method: "POST",
      body: JSON.stringify({ alcance: crAlcance, secciones: crElegidas }),
    });
    salida.innerHTML = `
      <div style="margin-top:12px;padding:11px 13px;border:1px solid var(--linea);border-radius:10px">
        <div style="font-weight:600;margin-bottom:6px">Enlace listo</div>
        <code style="display:block;word-break:break-all;font-size:12.5px;margin-bottom:9px">${esc(r.enlace)}</code>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="secondary" id="crCopiar">Copiar</button>
          <a class="secondary" style="text-decoration:none;display:inline-flex;align-items:center"
             href="https://wa.me/?text=${encodeURIComponent(r.enlace)}" target="_blank" rel="noopener">Mandar por WhatsApp</a>
        </div>
      </div>`;
    document.getElementById("crCopiar").onclick = async () => {
      try { await navigator.clipboard.writeText(r.enlace); document.getElementById("crCopiar").textContent = "Copiado"; }
      catch { document.getElementById("crCopiar").textContent = "Copialo de arriba"; }
    };
    // La lista de «ya compartidos» tiene que incluirlo, si no el médico no
    // puede cortarlo sin recargar la ficha.
    try {
      const l = await api(`/medico/pacientes/${crPacienteId}/resumenes`);
      document.getElementById("crPrevios").innerHTML = crPreviosHtml(l.resumenes || []);
      crCablearPrevios();
    } catch { /* el enlace ya está generado y visible: no es motivo de error */ }
  } catch (e) {
    salida.innerHTML = `<p class="hint">${esc((e && e.error) || "No se pudo generar el enlace.")}</p>`;
  } finally {
    b.disabled = false;
    b.textContent = "Generar enlace";
  }
}

// ─── La llave ──────────────────────────────────────────────────────────────
//
// Se confirma antes de mandarla, y el texto dice lo que hace en vez de
// preguntar «¿estás seguro?»: le da a esta persona acceso permanente a su
// historia y la posibilidad de compartirla sin pedir permiso. Eso es correcto
// —es suya— pero es una decisión, no un clic más.
async function crEmitirLlave() {
  const b = document.getElementById("crLlave");
  const ok = confirm(
    "Se le manda por WhatsApp un enlace a su propia historia clínica.\n\n" +
    "Desde ahí va a poder verla y generar enlaces para mostrársela a otros médicos, " +
    "sin pedir permiso. Si ya le habías mandado uno, ese deja de funcionar.\n\n" +
    "¿Se la mando?");
  if (!ok) return;
  b.disabled = true;
  b.textContent = "Mandando…";
  try {
    const r = await api(`/medico/pacientes/${crPacienteId}/llave`, { method: "POST", body: JSON.stringify({}) });
    const panel = document.getElementById("crPanel");
    panel.innerHTML = r.enviadaA
      ? `<p class="hint" style="margin-top:10px">Se la mandamos al ${esc(r.enviadaA)}.</p>`
      : `<div style="margin-top:10px">
           <p class="hint">${esc(r.aviso || "No se pudo mandar por WhatsApp.")}</p>
           <code style="display:block;word-break:break-all;font-size:12.5px">${esc(r.enlace)}</code>
         </div>`;
  } catch (e) {
    document.getElementById("crPanel").innerHTML =
      `<p class="hint" style="margin-top:10px">${esc((e && e.error) || "No se pudo.")}</p>`;
  } finally {
    b.disabled = false;
    b.textContent = "Darle acceso a su historia";
  }
}
