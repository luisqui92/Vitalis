// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Ganadería — La finca vista por su dueño (/campo/<llave>)
// ═══════════════════════════════════════════════════════════════════════════
//
// Quién la abre: un productor, en el corral o en el galpón, con el celular
// en una mano y poca señal. No es veterinario y no le interesa el producto.
// De ahí sale el orden de cada tarjeta:
//
//   1. ¿PUEDO VENDER? Lo primero que ve de cada lote es si hay leche o carne
//      en retiro, y hasta cuándo. Es la pregunta que le cuesta plata.
//   2. QUÉ HAY QUE HACER: las vacunas que tocan ahora o ya se pasaron.
//   3. ANOTAR: tres botones grandes —producción, muertes, gasto— para lo
//      que se carga todos los días.
//   4. Recién después, los números: producción de la semana y costos.
//
// Página propia y no index.html, igual que /mi: no baja el código clínico.
// Usa i18n.js y los diccionarios para hablar el idioma de la cuenta del
// veterinario, que viene en la respuesta de /datos.
"use strict";

const RUTA_CAMPO = location.pathname.match(/^\/campo\/([A-Za-z0-9_-]{20,})$/);
const LLAVE = RUTA_CAMPO ? RUTA_CAMPO[1] : null;
const appCampo = document.getElementById("app");
let DATOS_CAMPO = null;
// Qué formulario está abierto en qué lote: sobrevive al repintado que sigue
// a cada carga, para que anotar la leche de tres días seguidos no obligue a
// abrir el formulario tres veces.
let FORM_ABIERTO = null; // { loteId, tipo: "produccion" | "mortalidad" | "gasto" }
let MENSAJE = null;       // { loteId, clase: "exito" | "error", texto }
// Cuándo se trajeron los datos que se están mostrando, si NO son de recién
// (sin señal, se muestra lo último guardado en el teléfono). null = frescos.
let DATOS_DE_CUANDO = null;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Con señal floja un pedido puede quedar colgado minutos sin fallar. Pasado
// este tiempo se trata como «sin señal»: lo anotado se guarda en el teléfono
// y se reintenta, en vez de dejar al dueño mirando un botón trabado.
const ESPERA_MAXIMA_MS = 15000;

// Tres resultados posibles, y la diferencia importa:
//   · ok                       → llegó y se guardó.
//   · e.sinSenal               → no se sabe si llegó: se reintenta después.
//                                (Por eso las cargas llevan idCliente.)
//   · e.estado 4xx             → llegó y el servidor dijo que no: reintentar
//                                daría lo mismo, hay que mostrárselo al dueño.
// Un 429 (demasiados pedidos) y un 5xx son «probá más tarde», no un «no».
async function apiCampo(ruta, opciones = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opciones.headers);
  const control = typeof AbortController === "function" ? new AbortController() : null;
  const reloj = control ? setTimeout(() => control.abort(), ESPERA_MAXIMA_MS) : null;
  let res;
  try {
    res = await fetch(`/campo/${LLAVE}${ruta}`, { ...opciones, headers, signal: control?.signal });
  } catch {
    throw Object.assign(new Error("sin señal"), { sinSenal: true });
  } finally {
    if (reloj) clearTimeout(reloj);
  }
  const datos = await res.json().catch(() => ({}));
  if (res.status === 429 || res.status >= 500) throw Object.assign(new Error("reintentar"), { sinSenal: true, estado: res.status });
  if (!res.ok) throw Object.assign(new Error(datos.error || "error"), { estado: res.status, mensaje: datos.error });
  return datos;
}

function numeroCampo(n, decimales = 0) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(localeActual(), { maximumFractionDigits: decimales });
}

function plataCampo(centavos) {
  if (centavos == null) return "—";
  const simbolo = DATOS_CAMPO?.moneda === "BRL" ? "R$" : "Bs";
  return `${simbolo} ${(centavos / 100).toLocaleString(localeActual(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ICONO_ESPECIE = { bovino: "🐄", porcino: "🐖", avicola: "🐔" };

function pintarErrorCampo(texto) {
  appCampo.innerHTML = `<div class="card"><div class="error" style="margin-top:0">${esc(texto)}</div></div>`;
}

// ─── 1. ¿Puedo vender? ─────────────────────────────────────────────────────
function retirosHtml(lote) {
  const ahora = new Date();
  const lineas = [];
  for (const r of lote.retirosVigentes || []) {
    if (r.fechaLibreLeche && new Date(r.fechaLibreLeche) > ahora) {
      lineas.push(t("campo.retiro.leche", { fecha: fechaCorta(r.fechaLibreLeche), producto: esc(r.producto) }));
    }
    if (r.fechaLibreCarne && new Date(r.fechaLibreCarne) > ahora) {
      lineas.push(t("campo.retiro.carne", { fecha: fechaCorta(r.fechaLibreCarne), producto: esc(r.producto) }));
    }
  }
  if (!lineas.length) return `<div class="exito" style="margin-top:12px">✅ ${t("campo.retiro.libre")}</div>`;
  return `<div class="error" style="margin-top:12px;font-weight:600">${lineas.map(l => `🚫 ${l}`).join("<br>")}</div>`;
}

// ─── 2. Qué hay que hacer ─────────────────────────────────────────────────
function vacunasHtml(lote) {
  const lista = lote.vacunasPorHacer || [];
  if (!lista.length) return "";
  return `
    <div class="seccion-titulo" style="margin-top:16px">💉 ${t("campo.vacunas.titulo")}</div>
    ${lista.map(v => `
      <div class="hint" style="margin-top:6px;color:var(--text)">
        <strong style="color:${v.estado === "vencida" ? "var(--danger)" : "var(--warning)"}">${t("ganaderia.cal.estado." + v.estado)}</strong>
        · ${t("ganaderia.cal.item." + v.id)}${v.hastaFecha ? ` · ${t("campo.vacunas.hasta", { fecha: fechaCorta(v.hastaFecha) })}` : ""}
      </div>`).join("")}
    <div class="hint">${t("campo.vacunas.ayuda")}</div>`;
}

// ─── 3. Anotar ────────────────────────────────────────────────────────────
function botonesHtml(lote) {
  const botones = [];
  if (lote.produccion) botones.push(["produccion", lote.produccion.tipo === "leche" ? t("campo.anotar.leche") : t("campo.anotar.huevos")]);
  botones.push(["mortalidad", t("campo.anotar.muertes")], ["gasto", t("campo.anotar.gasto")]);
  return `
    <div style="display:grid;grid-template-columns:repeat(${botones.length},1fr);gap:8px;margin-top:14px">
      ${botones.map(([tipo, texto]) => `
        <button type="button" class="chip${FORM_ABIERTO?.loteId === lote._id && FORM_ABIERTO?.tipo === tipo ? " activo" : ""}"
          style="white-space:normal;padding:10px 6px" data-abrir="${tipo}" data-lote="${lote._id}">${texto}</button>`).join("")}
    </div>`;
}

function formHtml(lote) {
  if (FORM_ABIERTO?.loteId !== lote._id) return "";
  const hoy = fechaCalendarioLocal();
  const campoDia = `<label for="fDia">${t("campo.form.dia")}</label><input id="fDia" type="date" value="${hoy}" max="${hoy}">`;
  let cuerpo = "";
  if (FORM_ABIERTO.tipo === "produccion") {
    const leche = lote.produccion?.tipo === "leche";
    cuerpo = `
      ${campoDia}
      <label for="fCantidad">${leche ? t("campo.form.litros") : t("campo.form.huevos")}</label>
      <input id="fCantidad" type="number" min="0" step="${leche ? "0.1" : "1"}" inputmode="decimal">
      <label for="fAnimales">${leche ? t("campo.form.vacasOrdene") : t("campo.form.gallinas")}</label>
      <input id="fAnimales" type="number" min="0" step="1" inputmode="numeric" placeholder="${leche ? "" : t("campo.form.gallinasPlaceholder", { n: lote.cantidadActual })}">
      <div class="hint">${t("campo.form.corregir")}</div>`;
  } else if (FORM_ABIERTO.tipo === "mortalidad") {
    cuerpo = `
      ${campoDia}
      <label for="fMuertes">${t("campo.form.muertes")}</label>
      <input id="fMuertes" type="number" min="1" max="${lote.cantidadActual}" step="1" inputmode="numeric">
      <label for="fCausa">${t("campo.form.causa")}</label>
      <input id="fCausa" type="text" maxlength="200" placeholder="${t("campo.form.causaPlaceholder")}">
      <div class="hint">${t("campo.form.muertesAyuda")}</div>`;
  } else {
    cuerpo = `
      ${campoDia}
      <label for="fCategoria">${t("campo.form.categoria")}</label>
      <select id="fCategoria">
        ${(DATOS_CAMPO.categoriasGasto || []).map(c => `<option value="${c}">${t("ganaderia.costos.categoria." + c)}</option>`).join("")}
      </select>
      <label for="fConcepto">${t("campo.form.concepto")}</label>
      <input id="fConcepto" type="text" maxlength="200">
      <label for="fMonto">${t("campo.form.monto", { moneda: DATOS_CAMPO.moneda === "BRL" ? "R$" : "Bs" })}</label>
      <input id="fMonto" type="number" min="0" step="0.01" inputmode="decimal">
      <div id="fKgBox">
        <label for="fKg">${t("campo.form.kg")}</label>
        <input id="fKg" type="number" min="0" step="0.1" inputmode="decimal">
      </div>`;
  }
  return `<div style="margin-top:6px">${cuerpo}<button class="primary" id="btnGuardarCampo">${t("campo.form.guardar")}</button></div>`;
}

function mensajeHtml(lote) {
  if (MENSAJE?.loteId !== lote._id) return "";
  return `<div class="${MENSAJE.clase}">${MENSAJE.texto}</div>`;
}

// ─── 4. Los números ───────────────────────────────────────────────────────
function produccionHtml(lote) {
  const p = lote.produccion;
  if (!p) return "";
  const leche = p.tipo === "leche";
  const unidad = leche ? t("campo.prod.litros") : t("campo.prod.huevos");
  const alertas = (p.alertas || []).map(a => a.tipo === "caida"
    ? `<div class="error">📉 ${t("campo.prod.caida", { pct: a.pct })}</div>`
    : `<div class="error">🚫 ${t("campo.prod.enRetiro", { litros: numeroCampo(a.litros, 1) })}</div>`).join("");
  const dias = (p.serie || []).slice(-7).reverse();
  return `
    <div class="seccion-titulo" style="margin-top:16px">${leche ? "🥛" : "🥚"} ${t("campo.prod.titulo")}</div>
    ${p.promedio7 != null ? `<div class="hint" style="color:var(--text)">
      ${t("campo.prod.promedio7", { n: numeroCampo(p.promedio7, 1), unidad })}
      ${leche && p.vendible7 != null ? `<br>${t("campo.prod.vendible7", { n: numeroCampo(p.vendible7, 1) })}` : ""}
    </div>` : ""}
    ${alertas}
    ${dias.length ? `<div style="margin-top:8px">${dias.map(r => `
      <div class="hint" style="display:flex;justify-content:space-between;margin-top:4px;font-variant-numeric:tabular-nums">
        <span>${fechaCorta(r.dia)}</span>
        <span>${numeroCampo(r.cantidad, 1)} ${unidad}${r.enRetiro ? ` · <span style="color:var(--danger)">${t("campo.prod.retiro")}</span>` : ""}</span>
      </div>`).join("")}</div>` : `<div class="hint">${t("campo.prod.vacio")}</div>`}`;
}

function costosHtml(lote) {
  const c = lote.costos;
  if (!c) return "";
  if (!(lote.gastos || []).length) {
    return `<div class="seccion-titulo" style="margin-top:16px">💰 ${t("campo.costos.titulo")}</div><div class="hint">${t("campo.costos.vacio")}</div>`;
  }
  const pu = c.porUnidad;
  let unidad = "";
  if (pu?.tipo === "leche" && pu.costoPorLitroVendible != null) unidad = t("campo.costos.porLitro", { monto: plataCampo(pu.costoPorLitroVendible) });
  else if (pu?.tipo === "huevos" && pu.costoPorDocena != null) unidad = t("campo.costos.porDocena", { monto: plataCampo(pu.costoPorDocena) });
  else if (c.costoPorAnimal != null) unidad = t("campo.costos.porAnimal", { monto: plataCampo(c.costoPorAnimal) });
  return `
    <div class="seccion-titulo" style="margin-top:16px">💰 ${t("campo.costos.titulo")}</div>
    <div class="hint" style="color:var(--text)">${t("campo.costos.total", { monto: plataCampo(c.total) })}${unidad ? `<br>${unidad}` : ""}</div>
    ${(lote.gastos || []).map(g => `
      <div class="hint" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px">
        <span>${fechaCorta(g.dia)} · ${t("ganaderia.costos.categoria." + g.categoria)}${g.concepto ? ` — ${esc(g.concepto)}` : ""}${g.kg ? ` · ${numeroCampo(g.kg, 1)} kg` : ""}</span>
        <span style="white-space:nowrap">${g.montoCentavos != null ? plataCampo(g.montoCentavos) : ""}
          ${g.origen === "dueno" ? `<button type="button" class="link" style="margin:0 0 0 6px;width:auto;display:inline" data-borrar-gasto="${g._id}" aria-label="${t("campo.costos.borrar")}">✕</button>` : ""}
        </span>
      </div>`).join("")}`;
}

function eventosHtml(lote) {
  const lista = lote.eventos || [];
  if (!lista.length) return "";
  const linea = (e) => {
    if (e.tipo === "mortalidad") return `💀 ${t("campo.evento.muertes", { n: e.cantidadMuertes })}${e.causaPresunta ? ` — ${esc(e.causaPresunta)}` : ""}`;
    if (e.tipo === "pesaje") return `⚖️ ${t("campo.evento.pesaje", { kg: numeroCampo(e.pesoPromedioKg, 2) })}`;
    return `${e.tipo === "vacunacion" ? "💉" : "💊"} ${esc(e.producto)}`;
  };
  return `
    <details style="margin-top:14px">
      <summary class="hint" style="cursor:pointer;margin:0">${t("campo.evento.titulo")}</summary>
      ${lista.map(e => `<div class="hint" style="margin-top:6px;color:var(--text)">${fechaCorta(e.fecha)} · ${linea(e)}${e.origen === "dueno" ? ` <span class="hint">(${t("campo.evento.tuyo")})</span>` : ""}</div>`).join("")}
    </details>`;
}

function loteHtml(lote) {
  const mort = lote.mortalidad || {};
  return `
    <div class="card" id="lote-${lote._id}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <div style="font-size:16px;font-weight:700">${ICONO_ESPECIE[lote.especie] || ""} ${esc(lote.nombre)}</div>
        <div class="hint" style="margin:0">${esc(lote.codigo)}</div>
      </div>
      <div class="hint" style="margin-top:4px">
        ${t("ganaderia.especie." + lote.especie)} · ${t("campo.lote.animales", { n: numeroCampo(lote.cantidadActual) })}
        ${mort.porcentaje != null ? ` · ${t("campo.lote.mortalidad", { pct: numeroCampo(mort.porcentaje, 1) })}` : ""}
      </div>
      ${retirosHtml(lote)}
      ${vacunasHtml(lote)}
      ${botonesHtml(lote)}
      ${formHtml(lote)}
      ${mensajeHtml(lote)}
      ${pendientesHtml(lote)}
      ${produccionHtml(lote)}
      ${costosHtml(lote)}
      ${eventosHtml(lote)}
    </div>`;
}

// ═══ SIN SEÑAL ═════════════════════════════════════════════════════════════
//
// En el corral o en el galpón la señal va y viene, y es justo ahí donde se
// anota. Tres piezas:
//
//   · LA PÁGINA abre sin señal: la guarda public/campo-sw.js, un service
//     worker que controla solo /campo/ (el de la app médica no cachea nada
//     a propósito — ver public/sw.js).
//   · LOS DATOS de la última vez que hubo señal quedan en el teléfono, y se
//     muestran con la hora en que se trajeron: nunca como si fueran de ahora.
//   · LO QUE SE ANOTA sin señal va a una cola en el teléfono y se manda solo
//     cuando vuelve. Cada carga lleva un idCliente, así un reintento de algo
//     que ya había llegado no se cuenta dos veces (services/cargasGanado.js).
//
// Todo va en localStorage con try/catch: un navegador en modo privado o sin
// espacio no puede romper la página; en el peor caso se comporta como antes,
// pidiendo señal.
const CLAVE_DATOS = `campo:datos:${LLAVE}`;
const CLAVE_COLA = `campo:cola:${LLAVE}`;
const CLAVE_RECHAZOS = `campo:rechazos:${LLAVE}`;

function leerGuardado(clave, siNo) {
  try {
    const v = localStorage.getItem(clave);
    return v ? JSON.parse(v) : siNo;
  } catch { return siNo; }
}

function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); return true; } catch { return false; }
}

function borrarGuardado(clave) {
  try { localStorage.removeItem(clave); } catch { /* nada que hacer */ }
}

function nuevoIdCliente() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

const leerCola = () => leerGuardado(CLAVE_COLA, []);
const leerRechazos = () => leerGuardado(CLAVE_RECHAZOS, []);

// Una carga: { idCliente, tipo, loteId, cuerpo, creado }. El idCliente va
// también adentro del cuerpo, que es lo que ve el servidor.
function rutaDe(carga) {
  if (carga.tipo === "produccion") return { ruta: `/lotes/${carga.loteId}/produccion`, method: "PUT" };
  if (carga.tipo === "mortalidad") return { ruta: `/lotes/${carga.loteId}/mortalidad`, method: "POST" };
  return { ruta: `/lotes/${carga.loteId}/gastos`, method: "POST" };
}

function enviarCarga(carga) {
  const { ruta, method } = rutaDe(carga);
  return apiCampo(ruta, { method, body: JSON.stringify(carga.cuerpo) });
}

// Manda la cola en orden, de a una. El orden importa: si el dueño corrigió
// dos veces la leche del mismo día, la última corrección tiene que llegar
// última. Ante la primera falta de señal se corta: el resto espera.
let SINCRONIZANDO = false;
async function sincronizar() {
  if (SINCRONIZANDO || !LLAVE) return;
  if (!leerCola().length) return;
  SINCRONIZANDO = true;
  let alguna = false;
  try {
    for (;;) {
      const cola = leerCola();
      if (!cola.length) break;
      const carga = cola[0];
      try {
        await enviarCarga(carga);
        alguna = true;
      } catch (e) {
        if (e.sinSenal) break;
        // El servidor la rechazó (el lote se cerró mientras tanto, el
        // veterinario cortó el acceso, más muertes que animales…). No se
        // tira en silencio: queda a la vista para que el dueño lo sepa.
        guardar(CLAVE_RECHAZOS, [...leerRechazos(), { ...carga, motivo: e.mensaje || "" }]);
      }
      guardar(CLAVE_COLA, leerCola().filter(c => c.idCliente !== carga.idCliente));
    }
  } finally {
    SINCRONIZANDO = false;
  }
  if (alguna || leerRechazos().length) await recargar();
}

// ─── Lo que se ve del estado sin señal ────────────────────────────────────
function describirCarga(carga, lote) {
  const c = carga.cuerpo;
  const fecha = fechaCorta(c.dia);
  if (carga.tipo === "produccion") {
    const leche = lote?.produccion?.tipo === "leche";
    return `${numeroCampo(c.cantidad, 1)} ${leche ? t("campo.prod.litros") : t("campo.prod.huevos")} · ${fecha}`;
  }
  if (carga.tipo === "mortalidad") return `💀 ${t("campo.evento.muertes", { n: c.cantidadMuertes })} · ${fecha}`;
  const monto = c.monto != null && c.monto !== "" ? ` · ${plataCampo(Math.round(Number(c.monto) * 100))}` : "";
  return `💰 ${t("ganaderia.costos.categoria." + c.categoria)}${monto} · ${fecha}`;
}

function pendientesHtml(lote) {
  const suyas = leerCola().filter(c => c.loteId === lote._id);
  if (!suyas.length) return "";
  return `
    <div class="hint" style="margin-top:12px;padding:10px 12px;border:1px dashed var(--border);border-radius:var(--radius-sm)">
      <strong>🕓 ${t("campo.offline.esperando")}</strong>
      ${suyas.map(c => `<div style="margin-top:4px">${describirCarga(c, lote)}</div>`).join("")}
    </div>`;
}

function avisoConexionHtml() {
  const partes = [];
  if (DATOS_DE_CUANDO) {
    partes.push(`<div class="error" style="margin-top:0">📴 ${t("campo.offline.sinSenal", { fecha: fechaHora(DATOS_DE_CUANDO) })}</div>`);
  }
  const rechazos = leerRechazos();
  if (rechazos.length) {
    partes.push(`
      <div class="error"${partes.length ? "" : ' style="margin-top:0"'}>
        <strong>${t("campo.offline.rechazos")}</strong>
        ${rechazos.map(c => `<div style="margin-top:4px">${describirCarga(c, lotePorId(c.loteId))}${c.motivo ? ` — ${esc(c.motivo)}` : ""}</div>`).join("")}
        <button type="button" class="link" id="btnRechazosVistos" style="margin:8px 0 0;width:auto">${t("campo.offline.entendido")}</button>
      </div>`);
  }
  return partes.length ? `<div class="card">${partes.join("")}</div>` : "";
}

// La planilla de su finca (routes/accesoDueno.js). Un enlace común: acá
// no hay sesión en un encabezado, la llave ya va en la dirección. Sin señal
// no se ofrece: la arma el servidor, y tocarla sería un error seguro.
function excelHtml() {
  return `
    <div class="card">
      ${DATOS_DE_CUANDO
        ? `<div class="hint" style="margin-top:0">📊 ${t("campo.excel.sinSenal")}</div>`
        : `<a id="lnkExcelCampo" href="/campo/${LLAVE}/excel" download
             style="display:block;text-align:center;text-decoration:none;background:rgba(var(--primary-rgb),.08);color:var(--primary);border-radius:var(--radius-sm);padding:12px;font-size:13.5px;font-weight:600">📊 ${t("campo.excel.descargar")}</a>
           <div class="hint">${t("campo.excel.ayuda")}</div>`}
    </div>`;
}

function pintarCampo() {
  const d = DATOS_CAMPO;
  document.getElementById("campoTitulo").textContent = d.finca.nombre;
  document.getElementById("campoSub").textContent = d.veterinario.nombre ? t("campo.veterinario", { nombre: d.veterinario.nombre }) : "";
  document.title = d.finca.nombre;
  appCampo.innerHTML = avisoConexionHtml() + (d.lotes.length
    ? d.lotes.map(loteHtml).join("") + excelHtml()
    : `<div class="card"><div class="hint" style="margin-top:0">${t("campo.sinLotes")}</div></div>`);
  enganchar();
}

function lotePorId(id) {
  return DATOS_CAMPO?.lotes.find(l => l._id === id) || null;
}

function enganchar() {
  appCampo.querySelectorAll("[data-abrir]").forEach(btn => {
    btn.onclick = () => {
      const mismo = FORM_ABIERTO?.loteId === btn.dataset.lote && FORM_ABIERTO?.tipo === btn.dataset.abrir;
      FORM_ABIERTO = mismo ? null : { loteId: btn.dataset.lote, tipo: btn.dataset.abrir };
      MENSAJE = null;
      pintarCampo();
      // El foco en el primer número: el día ya viene en hoy.
      if (FORM_ABIERTO) (document.getElementById("fCantidad") || document.getElementById("fMuertes") || document.getElementById("fMonto"))?.focus();
    };
  });
  const categoria = document.getElementById("fCategoria");
  if (categoria) {
    const kg = () => { document.getElementById("fKgBox").style.display = categoria.value === "alimento" ? "block" : "none"; };
    categoria.onchange = kg;
    kg();
  }
  const guardarBtn = document.getElementById("btnGuardarCampo");
  if (guardarBtn) guardarBtn.onclick = () => guardarForm(guardarBtn);
  const vistos = document.getElementById("btnRechazosVistos");
  if (vistos) vistos.onclick = () => { borrarGuardado(CLAVE_RECHAZOS); pintarCampo(); };
  appCampo.querySelectorAll("[data-borrar-gasto]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("campo.costos.confirmarBorrar"))) return;
      const loteId = btn.closest(".card").id.replace("lote-", "");
      try {
        await apiCampo(`/gastos/${btn.dataset.borrarGasto}`, { method: "DELETE" });
        MENSAJE = { loteId, clase: "exito", texto: t("campo.costos.borrado") };
      } catch (e) {
        // Borrar no se encola: es corregir algo que ya está en el servidor,
        // y hacerlo a ciegas más tarde podría borrar algo que el dueño ya
        // no recuerda haber pedido borrar.
        MENSAJE = { loteId, clase: "error", texto: e.sinSenal ? t("campo.offline.borrarSinSenal") : esc(e.mensaje || t("campo.errGuardar")) };
      }
      await recargar();
    };
  });
}

const valor = (id) => (document.getElementById(id)?.value || "").trim();

// Lo que el formulario abierto quiere guardar, ya armado como carga. Las
// validaciones de acá son solo para no encolar algo obviamente vacío: las
// de verdad son las del servidor, que se aplican igual cuando la cola llega.
function cargaDelFormulario() {
  const { loteId, tipo } = FORM_ABIERTO;
  const idCliente = nuevoIdCliente();
  let cuerpo;
  if (tipo === "produccion") {
    if (valor("fCantidad") === "") throw { mensaje: t("campo.errCantidad") };
    cuerpo = { dia: valor("fDia"), cantidad: valor("fCantidad"), animales: valor("fAnimales") || null };
  } else if (tipo === "mortalidad") {
    if (valor("fMuertes") === "") throw { mensaje: t("campo.errCantidad") };
    // Contra lo que el teléfono sabe: los animales de la última vez, menos
    // las muertes que todavía esperan señal.
    const lote = lotePorId(loteId);
    const enCola = leerCola().filter(c => c.loteId === loteId && c.tipo === "mortalidad")
      .reduce((a, c) => a + Number(c.cuerpo.cantidadMuertes || 0), 0);
    const quedan = (lote?.cantidadActual || 0) - enCola;
    if (Number(valor("fMuertes")) > quedan) throw { mensaje: t("campo.errMasMuertes", { n: numeroCampo(quedan) }) };
    cuerpo = { dia: valor("fDia"), cantidadMuertes: valor("fMuertes"), causaPresunta: valor("fCausa") };
  } else {
    if (valor("fMonto") === "" && valor("fKg") === "") throw { mensaje: t("campo.errCantidad") };
    cuerpo = {
      dia: valor("fDia"), categoria: valor("fCategoria"), concepto: valor("fConcepto"),
      monto: valor("fMonto") || null, kg: valor("fKg") || null,
    };
  }
  cuerpo.idCliente = idCliente;
  return { idCliente, tipo, loteId, cuerpo, creado: new Date().toISOString() };
}

function mostrarErrorForm(boton, loteId, texto) {
  const viejo = document.querySelector(`#lote-${loteId} .error.form-error`);
  if (viejo) viejo.remove();
  boton.insertAdjacentHTML("afterend", `<div class="error form-error">${texto}</div>`);
}

async function guardarForm(boton) {
  const { loteId, tipo } = FORM_ABIERTO;
  let carga;
  try {
    carga = cargaDelFormulario();
  } catch (e) {
    return mostrarErrorForm(boton, loteId, esc(e.mensaje || t("campo.errGuardar")));
  }
  boton.disabled = true;

  // Si ya hay cosas esperando, esta va detrás: mandarla ahora la haría
  // llegar antes que una anterior (y una corrección vieja pisaría la nueva).
  const hayCola = leerCola().length > 0;
  let respuesta = null;
  if (!hayCola) {
    try {
      respuesta = await enviarCarga(carga);
    } catch (e) {
      if (!e.sinSenal) {
        // Rechazo del servidor con el dueño mirando: se le muestra en el
        // formulario, que conserva lo que escribió.
        boton.disabled = false;
        return mostrarErrorForm(boton, loteId, esc(e.mensaje || t("campo.errGuardar")));
      }
    }
  }

  if (!respuesta) {
    if (!guardar(CLAVE_COLA, [...leerCola(), carga])) {
      boton.disabled = false;
      return mostrarErrorForm(boton, loteId, t("campo.offline.sinEspacio"));
    }
    MENSAJE = { loteId, clase: "exito", texto: `📴 ${t("campo.offline.guardadoEnTelefono")}` };
    if (tipo !== "produccion") FORM_ABIERTO = null;
    pintarCampo();
    sincronizar();
    return;
  }

  if (tipo === "produccion") {
    MENSAJE = respuesta.enRetiro
      ? { loteId, clase: "error", texto: `🚫 ${t("campo.ok.lecheEnRetiro", { producto: esc(respuesta.productoRetiro) })}` }
      : { loteId, clase: "exito", texto: t("campo.ok.produccion") };
  } else {
    MENSAJE = { loteId, clase: "exito", texto: tipo === "mortalidad" ? t("campo.ok.muertes") : t("campo.ok.gasto") };
    FORM_ABIERTO = null;
  }
  await recargar();
}

// Trae los datos. Sin señal, usa los últimos guardados en el teléfono y lo
// dice. Si el servidor dice que el enlace ya no vale (404), se borra lo
// guardado: un acceso cortado no puede seguir mostrando la finca sin señal.
async function traerDatos() {
  try {
    const datos = await apiCampo("/datos");
    guardar(CLAVE_DATOS, { cuando: new Date().toISOString(), datos });
    DATOS_DE_CUANDO = null;
    return datos;
  } catch (e) {
    if (e.sinSenal) {
      const guardados = leerGuardado(CLAVE_DATOS, null);
      if (guardados?.datos) {
        DATOS_DE_CUANDO = guardados.cuando;
        return guardados.datos;
      }
      throw Object.assign(e, { mensaje: t("campo.offline.primeraVez") });
    }
    if (e.estado === 404) borrarGuardado(CLAVE_DATOS);
    throw e;
  }
}

async function recargar() {
  try {
    DATOS_CAMPO = await traerDatos();
    pintarCampo();
  } catch (e) {
    pintarErrorCampo(e.mensaje || t("campo.errCargar"));
  }
}

function fijarIdiomaCampo() {
  // El idioma es el de la cuenta del veterinario —es él quien trabaja en
  // ese país—, no el que haya quedado guardado en este teléfono.
  MEDICO_IDIOMA = DATOS_CAMPO.idioma === "pt" ? "pt" : "es";
  document.documentElement.lang = MEDICO_IDIOMA === "pt" ? "pt-BR" : "es";
}

(async function iniciar() {
  if (!LLAVE) return pintarErrorCampo(t("campo.enlaceInvalido"));

  // El manifiesto es por enlace (ver routes/accesoDueno.js): el ícono en la
  // pantalla del teléfono abre ESTA finca.
  const manifiesto = document.createElement("link");
  manifiesto.rel = "manifest";
  manifiesto.href = `/campo/${LLAVE}/manifest.webmanifest`;
  document.head.appendChild(manifiesto);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/campo-sw.js", { scope: "/campo/" }).catch(() => {
      // Sin service worker la página anda igual; solo no abre sin señal.
    });
  }

  try {
    DATOS_CAMPO = await traerDatos();
  } catch (e) {
    // El idioma todavía no se sabe: el del teléfono es la mejor apuesta.
    return pintarErrorCampo(e.mensaje || t("campo.errCargar"));
  }
  fijarIdiomaCampo();
  pintarCampo();

  window.addEventListener("online", sincronizar);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sincronizar(); });
  // El evento "online" no es confiable en el campo (el teléfono cree que hay
  // red cuando la antena apenas llega): además, se reintenta cada tanto
  // mientras haya algo esperando.
  setInterval(() => { if (leerCola().length) sincronizar(); }, 30000);
  sincronizar();
})();
