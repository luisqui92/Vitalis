// Symphomed — La calculadora de medicación (cuentas de estudiante).
//
// Goteo, dosis por peso, volumen a administrar, dilución, infusión continua y
// unidades: para practicar los cálculos y verificar los propios. Cada
// resultado muestra la fórmula con los números puestos: se aprende el
// cálculo, no solo el número.
//
// Las fórmulas son las mismas que las del servidor
// (modulos/estudiantes/calculos.js), que las usa para comprobar las preguntas
// de cálculo de los simulacros; scripts/pruebas/probar_calculadora.js compara
// las dos. Ninguna dosis de ningún medicamento: la indica quien prescribe,
// sale del formulario oficial y la verifica el profesional a cargo.

const CALC_FORMULAS = {
  goteo: ({ volumenMl, minutos, factor }) => (volumenMl * factor) / minutos,
  mlHora: ({ volumenMl, minutos }) => (volumenMl * 60) / minutos,
  dosisPorPeso: ({ dosisPorKg, pesoKg, tomas }) => (dosisPorKg * pesoKg) / tomas,
  volumen: ({ dosis, cantidad, volumenMl }) => (dosis * volumenMl) / cantidad,
  dilucion: ({ c1, c2, v2 }) => (c2 * v2) / c1,
  infusion: ({ dosisMcgKgMin, pesoKg, mg, volumenMl }) => (dosisMcgKgMin * pesoKg * 60) / ((mg * 1000) / volumenMl),
};

// Gotas por mL de cada equipo: el macrogotero de 20 primero, que es el de
// todos los días; el microgotero, de 60.
const CALC_FACTORES = [20, 60, 15, 10];
const CALC_TOMAS = [1, 2, 3, 4, 6];
// Masa: cuántos mcg tiene cada unidad.
const CALC_MASA = { g: 1e6, mg: 1e3, mcg: 1 };

// Cada cálculo y sus campos: unidad, rango y un ejemplo (el que se ve al
// abrir, para que la pantalla muestre ya cómo funciona).
const CALCULADORAS = [
  { id: "goteo", campos: [
    { k: "volumenMl", unidad: "mL", min: 0.1, max: 5000, ejemplo: 1000 },
    { k: "tiempo", min: 1, max: 72 * 60, ejemplo: 8 },
  ] },
  { id: "dosisPorPeso", campos: [
    { k: "dosisPorKg", min: 0.0001, max: 1000, ejemplo: 15 },
    { k: "pesoKg", unidad: "kg", min: 0.3, max: 300, ejemplo: 20 },
  ] },
  { id: "volumen", campos: [
    { k: "dosis", min: 0.0001, max: 100000, ejemplo: 250 },
    { k: "cantidad", min: 0.0001, max: 100000, ejemplo: 500 },
    { k: "volumenMl", unidad: "mL", min: 0.1, max: 5000, ejemplo: 5 },
  ] },
  { id: "dilucion", campos: [
    { k: "c1", min: 0.0001, max: 100000, ejemplo: 10 },
    { k: "c2", min: 0.0001, max: 100000, ejemplo: 2 },
    { k: "v2", unidad: "mL", min: 0.1, max: 5000, ejemplo: 500 },
  ] },
  { id: "infusion", campos: [
    { k: "dosisMcgKgMin", unidad: "mcg/kg/min", min: 0.001, max: 100, ejemplo: 5 },
    { k: "pesoKg", unidad: "kg", min: 0.3, max: 300, ejemplo: 70 },
    { k: "mg", unidad: "mg", min: 0.001, max: 100000, ejemplo: 400 },
    { k: "volumenMl", unidad: "mL", min: 1, max: 5000, ejemplo: 250 },
  ] },
  { id: "unidades", campos: [
    { k: "valor", min: 0.000001, max: 1e9, ejemplo: 0.5 },
  ] },
];

// Lo que eligió en cada cálculo, además de los números: se conserva al
// cambiar de cálculo y volver.
let CALC = { id: "goteo", tiempo: "h", factor: 20, porDia: false, tomas: 3, unidadDosis: "mg", unidadConc: "%", de: "g", valores: {} };

// «1.000» y «1 000» son mil; «0,5» y «0.5», medio. Como aNumero() del servidor.
function calcNumero(texto) {
  let s = String(texto == null ? "" : texto).trim().replace(/(\d)\s(?=\d{3}(?!\d))/g, "$1");
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return NaN;
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (coma >= 0) s = s.replace(",", ".");
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return Number(s);
}

function calcFormato(n, decimales = 2) {
  return new Intl.NumberFormat(localeActual(), { maximumFractionDigits: decimales }).format(n);
}

// ─── LA PANTALLA ───────────────────────────────────────────────────────────

function renderCalculadora() {
  detenerPolling();
  app.innerHTML = `
    ${volverEstudioHtml()}
    ${pestanasEstudioHtml("calculadora")}
    <div class="card calc-card">
      <div class="nota-titulo" style="margin-top:0">${t("calc.titulo")}</div>
      <div class="hint" style="margin:0 0 10px">${t("calc.bajada")}</div>
      ${chipsHtml("calcCual", CALCULADORAS.map(c => c.id), CALC.id, id => "calc." + id + ".nombre")}
      <div id="calcForm"></div>
      <div class="calc-resultado" id="calcResultado" aria-live="polite"></div>
    </div>
    <div class="hint est-aviso-ia">💊 ${t("calc.aviso")}</div>`;
  engancharVolverEstudio();
  engancharPestanasEstudio();
  engancharChips("calcCual", v => { CALC.id = v; pintarFormCalc(); });
  pintarFormCalc();
}

// El valor de un campo: lo que escribió, o el ejemplo la primera vez.
function calcValor(id, campo) {
  const guardado = CALC.valores[id + "." + campo.k];
  // En español y en portugués, con coma decimal.
  return guardado !== undefined ? guardado : String(campo.ejemplo).replace(".", ",");
}

function calcUnidadDe(id, campo) {
  if (campo.unidad) return campo.unidad;
  if (id === "dosisPorPeso") return CALC.unidadDosis + "/kg";
  if (id === "volumen") return CALC.unidadDosis;
  if (id === "dilucion" && campo.k !== "v2") return CALC.unidadConc;
  if (id === "unidades") return CALC.de;
  return "";
}

function campoCalcHtml(id, campo) {
  const unidad = id === "goteo" && campo.k === "tiempo" ? "" : calcUnidadDe(id, campo);
  return `<div class="calc-campo">
      <label for="calc_${campo.k}">${t(`calc.${id}.${campo.k}`)}</label>
      <div class="calc-fila">
        <input id="calc_${campo.k}" class="calc-in" data-k="${campo.k}" type="text" inputmode="decimal" autocomplete="off" value="${esc(calcValor(id, campo))}">
        ${id === "goteo" && campo.k === "tiempo"
          ? `<select id="calcTiempo" class="calc-unidad" aria-label="${t("calc.unidad")}">
              ${["h", "min"].map(u => `<option value="${u}"${CALC.tiempo === u ? " selected" : ""}>${t("calc.u." + u)}</option>`).join("")}
            </select>`
          : unidad ? `<span class="calc-u">${esc(unidad)}</span>` : ""}
      </div>
      <div class="calc-err" id="calcErr_${campo.k}"></div>
    </div>`;
}

function pintarFormCalc() {
  const c = CALCULADORAS.find(x => x.id === CALC.id) || CALCULADORAS[0];
  const opciones = (id, valores, elegido, etiqueta) => chipsHtml(id, valores, elegido, etiqueta);
  let extra = "";
  if (c.id === "goteo") {
    extra = `<div class="est-rotulo">${t("calc.goteo.factor")}</div>${opciones("calcFactor", CALC_FACTORES, CALC.factor, f => "calc.factor." + f)}`;
  } else if (c.id === "dosisPorPeso" || c.id === "volumen") {
    extra = `<div class="est-rotulo">${t("calc.unidadDosis")}</div>${opciones("calcUnidadDosis", ["mg", "mcg", "g", "UI"], CALC.unidadDosis, u => "calc.u." + u)}`;
    if (c.id === "dosisPorPeso") {
      extra += `<div class="est-rotulo">${t("calc.dosisPorPeso.indicacion")}</div>${opciones("calcPorDia", ["dosis", "dia"], CALC.porDia ? "dia" : "dosis", x => "calc.dosisPorPeso." + x)}
        <div id="calcTomasCaja"${CALC.porDia ? "" : ` style="display:none"`}>
          <div class="est-rotulo">${t("calc.dosisPorPeso.tomas")}</div>${opciones("calcTomas", CALC_TOMAS.slice(1), CALC.tomas, n => "calc.tomas." + n)}
        </div>`;
    }
  } else if (c.id === "dilucion") {
    extra = `<div class="est-rotulo">${t("calc.dilucion.unidad")}</div>${opciones("calcUnidadConc", ["%", "mg/mL"], CALC.unidadConc, u => "calc.u." + u)}`;
  } else if (c.id === "unidades") {
    extra = `<div class="est-rotulo">${t("calc.unidades.de")}</div>${opciones("calcDe", ["g", "mg", "mcg", "%"], CALC.de, u => "calc.u." + u)}`;
  }
  document.getElementById("calcForm").innerHTML = `
    <div class="hint calc-ayuda">${t(`calc.${c.id}.ayuda`)}</div>
    ${extra}
    ${c.campos.map(campo => campoCalcHtml(c.id, campo)).join("")}`;

  const repintar = () => { guardarCalc(c); pintarFormCalc(); };
  engancharChips("calcFactor", v => { CALC.factor = Number(v); resultadoCalc(); });
  engancharChips("calcUnidadDosis", v => { CALC.unidadDosis = v; repintar(); });
  engancharChips("calcPorDia", v => {
    CALC.porDia = v === "dia";
    document.getElementById("calcTomasCaja").style.display = CALC.porDia ? "" : "none";
    resultadoCalc();
  });
  engancharChips("calcTomas", v => { CALC.tomas = Number(v); resultadoCalc(); });
  engancharChips("calcUnidadConc", v => { CALC.unidadConc = v; repintar(); });
  engancharChips("calcDe", v => { CALC.de = v; repintar(); });
  const tiempo = document.getElementById("calcTiempo");
  if (tiempo) tiempo.onchange = () => { CALC.tiempo = tiempo.value; resultadoCalc(); };
  document.querySelectorAll("#calcForm .calc-in").forEach(x => { x.oninput = resultadoCalc; });
  resultadoCalc();
}

function guardarCalc(c) {
  document.querySelectorAll("#calcForm .calc-in").forEach(x => { CALC.valores[c.id + "." + x.dataset.k] = x.value; });
}

// Lee los campos: { valores } si todos sirven; si no, marca cuál y por qué.
function leerCalc(c) {
  guardarCalc(c);
  const v = {};
  let bien = true;
  for (const campo of c.campos) {
    const caja = document.getElementById("calcErr_" + campo.k);
    const crudo = document.getElementById("calc_" + campo.k)?.value || "";
    const n = calcNumero(crudo);
    // El tiempo se escribe en horas o en minutos y se calcula en minutos.
    const real = c.id === "goteo" && campo.k === "tiempo" && CALC.tiempo === "h" ? n * 60 : n;
    let error = "";
    if (!String(crudo).trim()) error = t("calc.falta");
    else if (!Number.isFinite(n)) error = t("calc.noEsNumero");
    else if (real < campo.min || real > campo.max) {
      const enHoras = c.id === "goteo" && campo.k === "tiempo" && CALC.tiempo === "h";
      error = t("calc.rango", {
        min: calcFormato(enHoras ? campo.min / 60 : campo.min, 4), max: calcFormato(enHoras ? campo.max / 60 : campo.max, 4),
        unidad: c.id === "goteo" && campo.k === "tiempo" ? t("calc.u." + CALC.tiempo) : calcUnidadDe(c.id, campo),
      });
    }
    if (caja) caja.textContent = error;
    if (error) bien = false;
    v[campo.k === "tiempo" ? "minutos" : campo.k] = real;
  }
  return bien ? v : null;
}

// La fórmula con los números puestos: «1000 mL × 20 gotas/mL ÷ 480 min».
const calcPaso = (texto) => `<div class="calc-paso">${texto}</div>`;

function resultadoCalc() {
  const c = CALCULADORAS.find(x => x.id === CALC.id) || CALCULADORAS[0];
  const caja = document.getElementById("calcResultado");
  if (!caja) return;
  const v = leerCalc(c);
  if (!v) { caja.innerHTML = `<div class="hint" style="margin:0">${t("calc.completa")}</div>`; return; }
  const f = calcFormato;
  let html = "";
  if (c.id === "goteo") {
    const gotas = CALC_FORMULAS.goteo({ ...v, factor: CALC.factor });
    const mlh = CALC_FORMULAS.mlHora(v);
    const micro = CALC.factor === 60;
    html = `<div class="calc-grande">${f(Math.round(gotas), 0)} <span>${t(micro ? "calc.goteo.microgotasMin" : "calc.goteo.gotasMin")}</span></div>
      <div class="calc-sub">${t("calc.goteo.exactas", { n: f(gotas, 1) })} · ${f(mlh, 1)} ${t("calc.goteo.mlHora")}</div>
      ${calcPaso(`${f(v.volumenMl, 4)} mL × ${CALC.factor} ${t("calc.goteo.gotasPorMl")} ÷ ${f(v.minutos)} min = ${f(gotas, 1)}`)}
      ${calcPaso(`${f(v.volumenMl)} mL ÷ ${f(v.minutos / 60, 2)} h = ${f(mlh, 1)} mL/h`)}
      ${CALC.factor === 20 ? `<div class="hint calc-regla">${t("calc.goteo.regla20")}</div>` : ""}
      ${micro ? `<div class="hint calc-regla">${t("calc.goteo.regla60")}</div>` : ""}`;
  } else if (c.id === "dosisPorPeso") {
    const u = CALC.unidadDosis;
    const total = CALC_FORMULAS.dosisPorPeso({ ...v, tomas: 1 });
    if (CALC.porDia) {
      const porToma = CALC_FORMULAS.dosisPorPeso({ ...v, tomas: CALC.tomas });
      html = `<div class="calc-grande">${f(porToma)} ${esc(u)} <span>${t("calc.dosisPorPeso.cadaToma")}</span></div>
        <div class="calc-sub">${t("calc.dosisPorPeso.porDiaEn", { total: f(total) + " " + esc(u), n: CALC.tomas, horas: f(24 / CALC.tomas, 1) })}</div>
        ${calcPaso(`${f(v.dosisPorKg, 4)} ${esc(u)}/kg × ${f(v.pesoKg)} kg = ${f(total)} ${esc(u)}`)}
        ${calcPaso(`${f(total)} ${esc(u)} ÷ ${CALC.tomas} = ${f(porToma)} ${esc(u)}`)}`;
    } else {
      html = `<div class="calc-grande">${f(total)} ${esc(u)} <span>${t("calc.dosisPorPeso.porDosis")}</span></div>
        ${calcPaso(`${f(v.dosisPorKg, 4)} ${esc(u)}/kg × ${f(v.pesoKg)} kg = ${f(total)} ${esc(u)}`)}`;
    }
  } else if (c.id === "volumen") {
    const u = CALC.unidadDosis;
    const ml = CALC_FORMULAS.volumen(v);
    html = `<div class="calc-grande">${f(ml)} <span>mL</span></div>
      <div class="calc-sub">${t("calc.volumen.concentracion", { c: f(v.cantidad / v.volumenMl, 4) + " " + esc(u) + "/mL" })}</div>
      ${calcPaso(`${f(v.dosis, 4)} ${esc(u)} × ${f(v.volumenMl, 4)} mL ÷ ${f(v.cantidad, 4)} ${esc(u)} = ${f(ml)} mL`)}
      ${v.dosis > v.cantidad ? `<div class="hint calc-regla">${t("calc.volumen.masDeUna")}</div>` : ""}`;
  } else if (c.id === "dilucion") {
    const u = esc(CALC.unidadConc);
    if (!(v.c2 < v.c1)) {
      html = `<div class="calc-err" style="margin:0">${t("calc.dilucion.noConcentra")}</div>`;
    } else {
      const v1 = CALC_FORMULAS.dilucion(v);
      html = `<div class="calc-grande">${f(v1)} <span>${t("calc.dilucion.mlIniciales")}</span></div>
        <div class="calc-sub">${t("calc.dilucion.completar", { diluyente: f(v.v2 - v1), total: f(v.v2) })}</div>
        ${calcPaso(`C1 × V1 = C2 × V2 → V1 = ${f(v.c2, 4)} ${u} × ${f(v.v2)} mL ÷ ${f(v.c1, 4)} ${u} = ${f(v1)} mL`)}`;
    }
  } else if (c.id === "infusion") {
    const mlh = CALC_FORMULAS.infusion(v);
    const mcgMl = (v.mg * 1000) / v.volumenMl;
    html = `<div class="calc-grande">${f(mlh, 1)} <span>mL/h</span></div>
      <div class="calc-sub">${t("calc.infusion.concentracion", { c: f(mcgMl, 1) })}</div>
      ${calcPaso(`${f(v.mg)} mg × 1000 ÷ ${f(v.volumenMl)} mL = ${f(mcgMl, 1)} mcg/mL`)}
      ${calcPaso(`${f(v.dosisMcgKgMin, 4)} mcg/kg/min × ${f(v.pesoKg)} kg × 60 ÷ ${f(mcgMl, 1)} mcg/mL = ${f(mlh, 1)} mL/h`)}`;
  } else if (c.id === "unidades") {
    if (CALC.de === "%") {
      // 1 % es 1 g en 100 mL: 10 mg por mL.
      html = `<div class="calc-grande">${f(v.valor * 10, 4)} <span>mg/mL</span></div>
        <div class="calc-sub">${t("calc.unidades.porciento", { p: f(v.valor, 4), g: f(v.valor, 4) })}</div>
        ${calcPaso(`${f(v.valor, 4)} % × 10 = ${f(v.valor * 10, 4)} mg/mL`)}`;
    } else {
      const mcg = v.valor * CALC_MASA[CALC.de];
      html = `<div class="calc-equivalencias">${["g", "mg", "mcg"].map(u =>
        `<div${u === CALC.de ? ` class="calc-de"` : ""}><b>${f(mcg / CALC_MASA[u], 6)}</b> ${t("calc.u." + u)}</div>`).join("")}</div>
        <div class="hint calc-regla">${t("calc.unidades.regla")}</div>`;
    }
  }
  caja.innerHTML = html;
}
