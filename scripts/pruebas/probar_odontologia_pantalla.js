// Contratos de interacción con un DOM controlado; no prueba layout de navegador.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ROOT = path.join(__dirname, "../..");
let checks = 0;
const prueba = async (nombre, fn) => { await fn(); checks++; console.log(`✅ ${nombre}`); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function entorno(idioma = "es") {
  class Nodo {
    constructor() { this._html = ""; this.children = []; this.dataset = {}; this.textContent = ""; }
    set innerHTML(html) {
      this._html = html;
      this.children = [...html.matchAll(/<(button|select|input)\b([^>]*)>/g)].map(m => {
        const n = new Nodo();
        for (const a of m[2].matchAll(/data-([\w-]+)="([^"]*)"/g)) n.dataset[a[1]] = a[2];
        const value = m[2].match(/value="([^"]*)"/); n.value = value ? value[1] : "";
        return n;
      });
    }
    get innerHTML() { return this._html; }
    querySelectorAll(selector) {
      const m = selector.match(/^\[data-([\w-]+)\]$/);
      return m ? this.children.filter(n => Object.hasOwn(n.dataset, m[1])) : [];
    }
    scrollIntoView() { this.scrolled = true; }
  }
  const nodos = Object.fromEntries(["odoEstEditor", "odoEstGuardar", "odoEstEstado", "odoEst"].map(k => [k, new Nodo()]));
  const guardados = [];
  const ctx = vm.createContext({
    console, esc, I18N: { es: {}, pt: {} },
    document: { getElementById: id => nodos[id] || null },
    PV: null,
    api: async (url, pedido) => {
      const body = JSON.parse(pedido.body); guardados.push({ url, body });
      return { odontograma: { registro: body.registro, revision: body.revision + 1 } };
    },
    listaPV: xs => `<ul>${(xs || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`,
  });
  for (const lang of ["es", "pt"]) vm.runInContext(fs.readFileSync(path.join(ROOT, `public/i18n/${lang}/estudiantesOdontologia.js`), "utf8"), ctx);
  ctx.t = (k, vars = {}) => (ctx.I18N[idioma][k] || k).replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? "");
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/js/estudiantesOdontologia.js"), "utf8"), ctx);
  const montar = (denticion = "permanente", odontograma = { registro: [], revision: 0 }) => {
    const sim = { _id: "dental1", area: "odo_cariologia", denticionDental: denticion, odontograma };
    ctx.PV = { sim, enviando: false }; ctx.montarOdontogramaEstudiante(sim); return sim;
  };
  const nodo = (tipo, value) => nodos.odoEstEditor.querySelectorAll(`[data-${tipo}]`).find(n => n.dataset[tipo] === String(value));
  const elegirDiente = n => nodo("diente", n).onclick();
  const marcar = (superficie, estado) => { const select = nodo("superficie", superficie); select.value = estado; select.onchange(); };
  return { ctx, nodos, montar, nodo, elegirDiente, marcar, guardados };
}

(async () => {
  await prueba("El editor muestra 32/20/52 dientes según la dentición", () => {
    const e = entorno();
    for (const [d, n] of [["permanente", 32], ["temporal", 20], ["mixta", 52]]) {
      e.montar(d);
      assert.equal(e.nodos.odoEstEditor.querySelectorAll("[data-diente]").length, n);
    }
  });
  await prueba("Seleccionar un incisivo ofrece I y un molar ofrece O", () => {
    const e = entorno(); e.montar();
    e.elegirDiente(11); assert.ok(e.nodo("superficie", "I")); assert.equal(e.nodo("superficie", "O"), undefined);
    e.elegirDiente(16); assert.ok(e.nodo("superficie", "O")); assert.equal(e.nodo("superficie", "I"), undefined);
  });
  await prueba("Marcar, quitar y pasar a ausente mantiene un registro coherente", () => {
    const e = entorno(); e.montar(); e.elegirDiente(16);
    e.marcar("O", "caries"); e.marcar("M", "restauracion");
    assert.equal(e.ctx.PV.odontograma.registro.length, 2);
    e.marcar("pieza", "ausente");
    assert.equal(e.ctx.PV.odontograma.registro.length, 1);
    assert.equal(e.ctx.PV.odontograma.registro[0].estado, "ausente");
    e.marcar("O", "caries");
    assert.equal(e.ctx.PV.odontograma.registro.length, 1);
    assert.equal(e.ctx.PV.odontograma.registro[0].superficie, "O");
    e.marcar("O", ""); assert.equal(e.ctx.PV.odontograma.registro.length, 0);
  });
  await prueba("Los cambios sin guardar frenan entrega/salida; guardar conserva revisión y recarga", async () => {
    const e = entorno(); const sim = e.montar(); e.elegirDiente(16); e.marcar("O", "caries");
    assert.equal(e.ctx.odontogramaPendientePV(), true);
    assert.equal(e.nodos.odoEst.scrolled, true);
    await e.nodos.odoEstGuardar.onclick();
    assert.equal(e.guardados[0].url, "/medico/pacientes-virtuales/dental1/odontograma");
    assert.equal(e.guardados[0].body.revision, 0);
    assert.equal(e.ctx.odontogramaPendientePV(), false);
    e.montar("permanente", sim.odontograma);
    assert.equal(e.ctx.PV.odontograma.revision, 1);
    assert.equal(e.ctx.PV.odontograma.registro[0].estado, "caries");
  });
  await prueba("Un conflicto de otra sesión conserva el borrador y muestra el error", async () => {
    const e = entorno(); e.montar(); e.elegirDiente(16); e.marcar("O", "caries");
    e.ctx.api = async () => { throw { status: 409 }; };
    await e.nodos.odoEstGuardar.onclick();
    assert.equal(e.ctx.PV.odontograma.sucio, true);
    assert.equal(e.ctx.PV.odontograma.registro.length, 1);
    assert.match(e.nodos.odoEstEstado.textContent, /otra sesión/);
    assert.equal(e.nodos.odoEstGuardar.disabled, false);
  });
  await prueba("Las notas y el plan no pueden inyectar HTML", () => {
    const e = entorno(); e.montar("permanente", { revision: 0, registro: [{ diente: 16, superficie: "O", estado: "caries", nota: '"><img src=x onerror=alert(1)>' }] });
    e.elegirDiente(16);
    assert.ok(!e.nodos.odoEstEditor.innerHTML.includes("<img"));
    const html = e.ctx.evaluacionDentalHtml({ respuesta: { plan: "<script>bad()</script>" }, evaluacion: {}, guion: {} });
    assert.ok(!html.includes("<script>")); assert.ok(html.includes("&lt;script&gt;"));
  });
  await prueba("El editor y sus resultados usan portugués sin claves visibles", () => {
    const e = entorno("pt"); e.montar("temporal");
    assert.match(e.nodos.odoEstEditor.innerHTML, /Dentição decídua/);
    assert.ok(!e.nodos.odoEstEditor.innerHTML.includes("odoEst."));
    const html = e.ctx.evaluacionDentalHtml({ respuesta: { plan: "" }, evaluacion: {}, guion: {} });
    assert.ok(!html.includes("odoEst."));
  });
  console.log(`\n🏁 ${checks} pruebas de interacción aprobadas (DOM controlado).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
