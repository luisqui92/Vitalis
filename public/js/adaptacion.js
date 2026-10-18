// Symphomed — «Así escribo yo», en Configuración (public/js/seguridad.js).
//
// Lo que la IA aprendió de las correcciones de esta cuenta, para verlo, sacar
// lo que no va, agregar lo propio o volver a empezar (routes/adaptacion.js,
// services/adaptacion.js). Todo es de la propia cuenta: no le cambia nada a
// nadie más.

async function pintarAdaptacion() {
  const caja = document.getElementById("adaptacionBox");
  if (!caja) return;
  let d;
  try {
    d = await api("/medico/adaptacion");
  } catch { return; }
  caja.innerHTML = adaptacionHtml(d);
  conectarAdaptacion(caja);
}

function adaptacionHtml(d) {
  const opcion = (valor, texto, elegido) => `<option value="${valor}" ${elegido === valor ? "selected" : ""}>${esc(texto)}</option>`;
  const auto = (aprendido, nombre) => (aprendido ? t("adapt.auto", { cual: nombre(aprendido) }) : t("adapt.autoAprendiendo"));
  const nombreLargo = (v) => t("adapt.largo." + v);
  const nombreVinetas = (v) => t("adapt.vinetas." + v);
  const quitar = (clave) => `<button class="adapt-quitar" data-clave="${esc(clave)}" title="${esc(t("adapt.quitar"))}" aria-label="${esc(t("adapt.quitar"))}">×</button>`;
  const chips = (items, texto) => (items.length
    ? `<div class="adapt-chips">${items.map(x => `<span class="adapt-chip"><span class="adapt-chip-texto">${texto(x)}</span>${quitar(x.clave)}</span>`).join("")}</div>`
    : `<div class="hint adapt-vacio">${t("adapt.vacio")}</div>`);
  const abreviatura = (a) => (a.usa === "largo"
    ? t("adapt.abrev.desarma", { largo: esc(a.largo), corto: esc(a.corto) })
    : `<b>${esc(a.corto)}</b> = ${esc(a.largo)}`);
  const veces = (n) => (n === 1 ? t("adapt.corr.vez") : t("adapt.corr.veces", { n }));

  return `
    <div class="card adapt">
      <div class="seccion-titulo" style="margin-top:0">${t("adapt.titulo")}</div>
      <div class="hint" style="margin-top:0">${t("adapt.ayuda")}</div>
      <div class="hint adapt-cuenta">${d.notas ? t("adapt.notas", { n: d.notas }) : t("adapt.nada")}</div>

      <label for="adaptLargo">${t("adapt.largo")}</label>
      <select id="adaptLargo">
        ${opcion("", auto(d.largo.aprendido, nombreLargo), d.largo.elegido)}
        ${["breve", "normal", "detallado"].map(v => opcion(v, nombreLargo(v), d.largo.elegido)).join("")}
      </select>

      <label for="adaptVinetas">${t("adapt.vinetas")}</label>
      <select id="adaptVinetas">
        ${opcion("", auto(d.vinetas.aprendido, nombreVinetas), d.vinetas.elegido)}
        ${["si", "no"].map(v => opcion(v, nombreVinetas(v), d.vinetas.elegido)).join("")}
      </select>

      <label>${t("adapt.abrev.titulo")}</label>
      ${chips(d.abreviaturas, abreviatura)}
      <div class="adapt-agregar">
        <input id="adaptAbrevCorto" type="text" maxlength="12" placeholder="${esc(t("adapt.abrev.corto"))}" aria-label="${esc(t("adapt.abrev.corto"))}">
        <input id="adaptAbrevLargo" type="text" maxlength="60" placeholder="${esc(t("adapt.abrev.largo"))}" aria-label="${esc(t("adapt.abrev.largo"))}">
        <button class="secondary" id="adaptAbrevAgregar">${t("adapt.agregar")}</button>
      </div>

      <label>${t("adapt.frases.titulo")}</label>
      <div class="hint" style="margin-top:0">${t("adapt.frases.ayuda")}</div>
      ${chips(d.frases, f => `«${esc(f.frase)}»`)}
      <div class="adapt-agregar">
        <input id="adaptFrase" type="text" maxlength="60" placeholder="${esc(t("adapt.frases.placeholder"))}" aria-label="${esc(t("adapt.frases.titulo"))}">
        <button class="secondary" id="adaptFraseAgregar">${t("adapt.agregar")}</button>
      </div>

      <label>${t("adapt.vocab.titulo")}</label>
      <div class="hint" style="margin-top:0">${t("adapt.vocab.ayuda")}</div>
      ${chips(d.terminos, x => esc(x.termino))}
      <div class="adapt-agregar">
        <input id="adaptTermino" type="text" maxlength="60" placeholder="${esc(t("adapt.vocab.placeholder"))}" aria-label="${esc(t("adapt.vocab.titulo"))}">
        <button class="secondary" id="adaptTerminoAgregar">${t("adapt.agregar")}</button>
      </div>

      <label>${t("adapt.corr.titulo")}</label>
      <div class="hint" style="margin-top:0">${t("adapt.corr.ayuda")}</div>
      ${d.correcciones.length ? `<div class="adapt-correcciones">${d.correcciones.map(c => `
        <div class="adapt-corr">
          <span class="adapt-corr-texto">${c.medicamento ? "💊 " : ""}${esc(c.dijo)} → <b>${esc(c.correcto)}</b></span>
          ${c.medicamento ? "" : `<span class="hint adapt-corr-veces">${veces(c.veces)}</span>`}
          ${quitar(c.clave)}
        </div>`).join("")}</div>` : `<div class="hint adapt-vacio">${t("adapt.vacio")}</div>`}

      <div id="adaptMsg"></div>
      <button class="secondary adapt-reiniciar" id="adaptReiniciar">${t("adapt.reiniciar")}</button>
    </div>`;
}

function conectarAdaptacion(caja) {
  const msg = document.getElementById("adaptMsg");
  const mostrar = (html) => { msg.innerHTML = html; };
  const fallo = (e) => mostrar(`<div class="error">${esc(e?.error || t("adapt.err"))}</div>`);
  const enviar = async (ruta, metodo, cuerpo, repintar = true) => {
    mostrar("");
    try {
      await api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
    } catch (e) { fallo(e); return false; }
    if (repintar) await pintarAdaptacion();
    return true;
  };

  // El largo y las viñetas se guardan al elegir: no hay un «Guardar» aparte
  // que alguien se olvide de tocar.
  for (const [id, campo] of [["adaptLargo", "largo"], ["adaptVinetas", "vinetas"]]) {
    document.getElementById(id).onchange = async (ev) => {
      if (await enviar("/medico/adaptacion", "PATCH", { [campo]: ev.target.value }, false)) mostrar(`<div class="hint" style="color:var(--success)">${t("adapt.guardado")}</div>`);
    };
  }

  const alAgregar = (boton, entradas, cuerpo) => {
    const accion = () => enviar("/medico/adaptacion/agregar", "POST", cuerpo(...entradas.map(id => document.getElementById(id).value.trim())));
    document.getElementById(boton).onclick = accion;
    for (const id of entradas) document.getElementById(id).onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); accion(); } };
  };
  alAgregar("adaptAbrevAgregar", ["adaptAbrevCorto", "adaptAbrevLargo"], (corto, largo) => ({ tipo: "abreviatura", corto, largo }));
  alAgregar("adaptFraseAgregar", ["adaptFrase"], (texto) => ({ tipo: "frase", texto }));
  alAgregar("adaptTerminoAgregar", ["adaptTermino"], (texto) => ({ tipo: "termino", texto }));

  caja.querySelectorAll(".adapt-quitar").forEach(b => {
    b.onclick = () => enviar("/medico/adaptacion/quitar", "POST", { clave: b.dataset.clave });
  });

  document.getElementById("adaptReiniciar").onclick = () => {
    if (!confirm(t("adapt.reiniciarConfirmar"))) return;
    enviar("/medico/adaptacion/reiniciar", "POST");
  };
}
