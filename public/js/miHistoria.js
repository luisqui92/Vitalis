// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — La historia clínica vista por su dueño (/mi/<llave>)
// ═══════════════════════════════════════════════════════════════════════════
//
// Esta es la página donde «el kardex también es del paciente» deja de ser una
// frase. Acá alguien ve lo suyo y decide qué le muestra a quién.
//
// ═══ QUIÉN LA ABRE ════════════════════════════════════════════════════════
//
// Una persona cualquiera, en un celular, probablemente en una sala de espera,
// probablemente apurada porque la acaban de llamar. No es médica y no le
// interesa el producto. De ahí salen todas las decisiones de abajo:
//
//   · SE VE PRIMERO, SE COMPARTE DESPUÉS. La página abre mostrando su
//     historia, no un formulario. Nadie aprende a usar una pantalla que le
//     pide decisiones antes de mostrarle nada.
//
//   · UN BOTÓN GRANDE Y LAS OPCIONES ADENTRO. «Compartir con un médico» hace
//     lo correcto sin tocar nada más: resumen, con todo lo que va por
//     defecto. Quien quiera elegir, elige; quien no, ya terminó.
//
//   · SIN UNA SOLA PALABRA DE CONSULTORIO. Ni «alcance», ni «token», ni
//     «revocar». Se dice «cortar el enlace», que es lo que hace.
//
// ═══ LA LLAVE NO ES EL ENLACE QUE SE COMPARTE ═════════════════════════════
//
// Es lo único de esta página que puede salir caro si no se entiende, así que
// se dice dos veces y con palabras distintas: la llave abre Y deja generar;
// el enlace que se le pasa a un médico solo abre, y vence. Reenviar la llave
// es darle a otro la posibilidad de compartir la propia historia.
"use strict";

const RUTA = location.pathname.match(/^\/mi\/([A-Za-z0-9_-]{20,})$/);
const app = document.getElementById("app");
let DATOS = null;
let ALCANCE = "resumen";
let ELEGIDAS = [];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fechaCorta(f) {
  if (!f) return "";
  const d = new Date(f);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

async function api(ruta, opciones = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opciones.headers);
  const res = await fetch(ruta, { ...opciones, headers });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw datos.error ? datos : { error: "No se pudo." };
  return datos;
}

function pintarError(mensaje) {
  app.innerHTML = `
    <div class="error">
      <h1>${esc(mensaje)}</h1>
      <p>Pedile a tu consultorio que te mande el enlace de nuevo.</p>
    </div>`;
}

// ─── El cajón de compartir ─────────────────────────────────────────────────
//
// Empieza plegado. Es un <details> nativo y no un div con onclick: se abre con
// el teclado sin una línea de JavaScript, y no hay ningún estado que mantener.
function cajonCompartirHtml() {
  const secciones = DATOS.secciones || [];
  const casilla = (s) => {
    const marcada = ELEGIDAS.includes(s.clave);
    // Las fijas se muestran igual, pero deshabilitadas y diciendo por qué. Sin
    // ellas el que lee asume que no hay alergias, que es la lectura peligrosa;
    // esconder la casilla dejaría la sensación de que falta algo.
    return `
      <label class="casilla ${s.fija ? "fija" : ""}">
        <input type="checkbox" data-c="${esc(s.clave)}" ${marcada ? "checked" : ""} ${s.fija ? "disabled" : ""}>
        <span>${esc(s.titulo)}
          ${s.fija ? `<span class="porque">Siempre va: sin esto, el médico no sabe si tenés alergias o si nadie preguntó.</span>` : ""}
        </span>
      </label>`;
  };

  return `
    <details class="panel no-imprimir" id="cajon">
      <summary style="cursor:pointer;font-weight:600">Elegir qué le muestro</summary>
      <p class="ayuda" style="margin-top:12px">
        Por defecto se comparte un resumen de una hoja, que es lo que un médico alcanza a leer
        antes de atenderte.
      </p>
      <div class="opciones">
        <button class="opcion" type="button" data-a="resumen" aria-pressed="${ALCANCE === "resumen"}">
          <b>Resumen</b><span>Lo importante en una hoja. Las últimas consultas.</span>
        </button>
        <button class="opcion" type="button" data-a="completo" aria-pressed="${ALCANCE === "completo"}">
          <b>Todo</b><span>La historia entera. Para cuando cambiás de médico.</span>
        </button>
      </div>
      <div class="casillas">${secciones.map(casilla).join("")}</div>
    </details>`;
}

function compartidosHtml() {
  const lista = DATOS.compartidos || [];
  if (!lista.length) return "";
  const fila = (r) => {
    const vencido = new Date(r.vence) < new Date();
    const muerto = r.revocadoEn || vencido;
    const estado = r.revocadoEn ? "cortado"
      : vencido ? "venció"
      : r.vistas ? `lo abrieron ${r.vistas} ${r.vistas === 1 ? "vez" : "veces"}`
      : "todavía no lo abrieron";
    return `
      <li>
        <span class="${muerto ? "vencido" : ""}">
          ${r.alcance === "completo" ? "Todo" : "Resumen"} · ${esc(fechaCorta(r.creadoEn))}
          <span class="estado"> — ${esc(estado)}</span>
        </span>
        ${muerto ? "" : `<button class="btn" data-cortar="${esc(r.id)}">Cortar enlace</button>`}
      </li>`;
  };
  return `
    <section class="panel no-imprimir">
      <h2>Enlaces que compartiste</h2>
      <p class="ayuda">Podés cortar cualquiera cuando quieras. El médico deja de verlo al instante.</p>
      <ul class="compartidos">${lista.map(fila).join("")}</ul>
    </section>`;
}

function pintar() {
  app.innerHTML = `
    <div class="acciones no-imprimir">
      <button class="btn primario" id="btnCompartir">Compartir con un médico</button>
      <button class="btn" id="btnImprimir">Guardar o imprimir</button>
    </div>
    ${cajonCompartirHtml()}
    <div id="resultado"></div>
    ${compartidosHtml()}
    <section class="panel no-imprimir">
      <h2>Ojo con este enlace</h2>
      <p class="ayuda" style="margin:0">
        El que tenés abierto ahora es <b>tu llave</b>: abre tu historia y además deja generar
        enlaces nuevos. No se lo reenvíes a nadie. Para mostrarle tu historia a un médico usá
        el botón de arriba: eso genera un enlace aparte, que <b>solo se puede leer</b>, que vos
        podés cortar cuando quieras y que vence solo a los ${esc(DATOS.diasValidez)} días.
      </p>
    </section>
    ${resumenVistaHtml(DATOS.contenido, { firma: DATOS.firma })}`;

  document.getElementById("btnImprimir").onclick = () => window.print();
  document.getElementById("btnCompartir").onclick = compartir;

  [].slice.call(document.querySelectorAll(".opcion")).forEach(b => {
    b.onclick = () => {
      ALCANCE = b.getAttribute("data-a");
      // Cambiar de alcance vuelve a lo que corresponde por defecto en ese
      // alcance. Si se conservaran las casillas de antes, elegir «Todo»
      // después de haber destildado cosas compartiría menos que «Resumen»,
      // que es exactamente lo contrario de lo que dice el botón.
      ELEGIDAS = (DATOS.porDefecto || {})[ALCANCE] || [];
      const abierto = document.getElementById("cajon").open;
      pintar();
      document.getElementById("cajon").open = abierto;
    };
  });

  [].slice.call(document.querySelectorAll(".casillas input")).forEach(i => {
    i.onchange = () => {
      const c = i.getAttribute("data-c");
      ELEGIDAS = i.checked ? ELEGIDAS.concat([c]) : ELEGIDAS.filter(x => x !== c);
    };
  });

  [].slice.call(document.querySelectorAll("[data-cortar]")).forEach(b => {
    b.onclick = () => cortar(b.getAttribute("data-cortar"), b);
  });
}

function mostrarEnlaceNuevo(enlace) {
  const caja = document.getElementById("resultado");
  caja.innerHTML = `
    <div class="enlace-listo no-imprimir">
      <b>Listo. Este es el enlace para tu médico:</b>
      <code id="elEnlace">${esc(enlace)}</code>
      <div class="acciones" style="margin:0">
        <button class="btn primario" id="btnCopiar">Copiar</button>
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(enlace)}" target="_blank" rel="noopener">Mandar por WhatsApp</a>
      </div>
    </div>`;

  document.getElementById("btnCopiar").onclick = async () => {
    const boton = document.getElementById("btnCopiar");
    try {
      await navigator.clipboard.writeText(enlace);
      boton.textContent = "Copiado";
    } catch {
      // Copiar falla sin avisar en navegadores viejos, sin HTTPS o sin
      // permiso. Dejar el enlace seleccionado es la salida: el paciente lo
      // copia a mano. Un botón que parece no haber hecho nada, no.
      const rango = document.createRange();
      rango.selectNodeContents(document.getElementById("elEnlace"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rango);
      boton.textContent = "Copialo de acá";
    }
  };
  caja.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function compartir() {
  const b = document.getElementById("btnCompartir");
  const caja = document.getElementById("resultado");
  b.disabled = true;
  b.textContent = "Generando…";
  try {
    const r = await api(`/mi/${RUTA[1]}/compartir`, {
      method: "POST",
      body: JSON.stringify({ alcance: ALCANCE, secciones: ELEGIDAS }),
    });

    // Primero se repinta —el enlace nuevo tiene que aparecer en «enlaces que
    // compartiste», si no no hay forma de cortarlo sin recargar— y recién
    // después se dibuja el resultado. Al revés, pintar() lo borraría.
    DATOS.compartidos = [r.resumen].concat(DATOS.compartidos || []);
    pintar();
    mostrarEnlaceNuevo(r.enlace);
  } catch (e) {
    caja.innerHTML = `<div class="panel"><p class="ayuda" style="margin:0">${esc(e.error || "No se pudo generar el enlace.")}</p></div>`;
    b.disabled = false;
    b.textContent = "Compartir con un médico";
  }
}

async function cortar(id, boton) {
  boton.disabled = true;
  boton.textContent = "Cortando…";
  try {
    await api(`/mi/${RUTA[1]}/compartidos/${id}/revocar`, { method: "POST" });
    const r = (DATOS.compartidos || []).find(x => String(x.id) === String(id));
    if (r) r.revocadoEn = new Date().toISOString();
    pintar();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = e.error || "No se pudo cortar";
  }
}

async function renderMiHistoria() {
  if (!RUTA) return pintarError("Este enlace no es válido.");
  try {
    DATOS = await api(`/mi/${RUTA[1]}/datos`);
  } catch (e) {
    return pintarError(e.error || "No pudimos abrir tu historia.");
  }
  ELEGIDAS = (DATOS.porDefecto || {}).resumen || [];
  pintar();
}

renderMiHistoria();
