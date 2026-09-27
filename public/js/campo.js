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

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function apiCampo(ruta, opciones = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opciones.headers);
  const res = await fetch(`/campo/${LLAVE}${ruta}`, { ...opciones, headers });
  const datos = await res.json().catch(() => ({}));
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
      ${produccionHtml(lote)}
      ${costosHtml(lote)}
      ${eventosHtml(lote)}
    </div>`;
}

function pintarCampo() {
  const d = DATOS_CAMPO;
  document.getElementById("campoTitulo").textContent = d.finca.nombre;
  document.getElementById("campoSub").textContent = d.veterinario.nombre ? t("campo.veterinario", { nombre: d.veterinario.nombre }) : "";
  document.title = d.finca.nombre;
  appCampo.innerHTML = d.lotes.length
    ? d.lotes.map(loteHtml).join("")
    : `<div class="card"><div class="hint" style="margin-top:0">${t("campo.sinLotes")}</div></div>`;
  enganchar();
}

function lotePorId(id) {
  return DATOS_CAMPO.lotes.find(l => l._id === id);
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
  const guardar = document.getElementById("btnGuardarCampo");
  if (guardar) guardar.onclick = () => guardarForm(guardar);
  appCampo.querySelectorAll("[data-borrar-gasto]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("campo.costos.confirmarBorrar"))) return;
      const loteId = btn.closest(".card").id.replace("lote-", "");
      try {
        await apiCampo(`/gastos/${btn.dataset.borrarGasto}`, { method: "DELETE" });
        MENSAJE = { loteId, clase: "exito", texto: t("campo.costos.borrado") };
      } catch (e) {
        MENSAJE = { loteId, clase: "error", texto: esc(e.mensaje || t("campo.errGuardar")) };
      }
      await recargar();
    };
  });
}

const valor = (id) => (document.getElementById(id)?.value || "").trim();

async function guardarForm(boton) {
  const { loteId, tipo } = FORM_ABIERTO;
  const lote = lotePorId(loteId);
  boton.disabled = true;
  try {
    if (tipo === "produccion") {
      if (valor("fCantidad") === "") throw { mensaje: t("campo.errCantidad") };
      const r = await apiCampo(`/lotes/${loteId}/produccion`, {
        method: "PUT",
        body: JSON.stringify({ dia: valor("fDia"), cantidad: valor("fCantidad"), animales: valor("fAnimales") || null }),
      });
      MENSAJE = r.enRetiro
        ? { loteId, clase: "error", texto: `🚫 ${t("campo.ok.lecheEnRetiro", { producto: esc(r.productoRetiro) })}` }
        : { loteId, clase: "exito", texto: t("campo.ok.produccion") };
    } else if (tipo === "mortalidad") {
      if (valor("fMuertes") === "") throw { mensaje: t("campo.errCantidad") };
      await apiCampo(`/lotes/${loteId}/mortalidad`, {
        method: "POST",
        body: JSON.stringify({ dia: valor("fDia"), cantidadMuertes: valor("fMuertes"), causaPresunta: valor("fCausa") }),
      });
      MENSAJE = { loteId, clase: "exito", texto: t("campo.ok.muertes") };
      FORM_ABIERTO = null;
    } else {
      await apiCampo(`/lotes/${loteId}/gastos`, {
        method: "POST",
        body: JSON.stringify({
          dia: valor("fDia"), categoria: valor("fCategoria"), concepto: valor("fConcepto"),
          monto: valor("fMonto") || null, kg: valor("fKg") || null,
        }),
      });
      MENSAJE = { loteId, clase: "exito", texto: t("campo.ok.gasto") };
      FORM_ABIERTO = null;
    }
    await recargar();
  } catch (e) {
    boton.disabled = false;
    MENSAJE = { loteId: lote._id, clase: "error", texto: esc(e.mensaje || t("campo.errGuardar")) };
    // Sin repintar: el formulario conserva lo que escribió.
    const viejo = document.querySelector(`#lote-${loteId} .error.form-error`);
    if (viejo) viejo.remove();
    boton.insertAdjacentHTML("afterend", `<div class="error form-error">${MENSAJE.texto}</div>`);
    MENSAJE = null;
  }
}

async function recargar() {
  try {
    DATOS_CAMPO = await apiCampo("/datos");
    pintarCampo();
  } catch (e) {
    pintarErrorCampo(e.mensaje || t("campo.errCargar"));
  }
}

(async function iniciar() {
  if (!LLAVE) return pintarErrorCampo(t("campo.enlaceInvalido"));
  try {
    DATOS_CAMPO = await apiCampo("/datos");
  } catch (e) {
    // El idioma todavía no se sabe: el del teléfono es la mejor apuesta.
    return pintarErrorCampo(e.mensaje || t("campo.errCargar"));
  }
  // El idioma es el de la cuenta del veterinario —es él quien trabaja en
  // ese país—, no el que haya quedado guardado en este teléfono.
  MEDICO_IDIOMA = DATOS_CAMPO.idioma === "pt" ? "pt" : "es";
  document.documentElement.lang = MEDICO_IDIOMA === "pt" ? "pt-BR" : "es";
  pintarCampo();
})();
