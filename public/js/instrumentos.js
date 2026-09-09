// ═══════════════════════════════════════════════════════════════════════════
// Instrumentos aplicados — ADOS-2, ADI-R, Vineland, WISC y compañía
// ═══════════════════════════════════════════════════════════════════════════
// Symphomed NO administra ni puntúa estos instrumentos, y la pantalla lo dice
// con todas las letras. El ADOS-2 y la mayoría de los demás son propiedad de
// sus editoriales y exigen entrenamiento formal: acá se registra el
// resultado que el profesional obtuvo con sus propios materiales.
//
// Es la misma idea que el resto de Symphomed: no reemplazar el criterio de
// quien sabe, sino que lo que decidió quede escrito, fechado, firmado y
// encontrable dentro de dos años cuando haya que reaplicar.

let instrumentosCatalogo = null;

async function renderTabInstrumentos(pacienteId) {
  const caja = document.getElementById("instrumentosBox");
  if (!caja) return;
  caja.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;

  let aplicados = [];
  try {
    const [d, cat] = await Promise.all([
      api(`/medico/pacientes/${pacienteId}/instrumentos`),
      instrumentosCatalogo ? Promise.resolve({ instrumentos: instrumentosCatalogo }) : api("/medico/instrumentos/catalogo"),
    ]);
    aplicados = d.aplicados || [];
    instrumentosCatalogo = cat.instrumentos || [];
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || "No se pudieron cargar")}</div>`;
    return;
  }

  pintarInstrumentos(pacienteId, aplicados);
}

function pintarInstrumentos(pacienteId, aplicados) {
  const caja = document.getElementById("instrumentosBox");
  const fecha = (f) => new Date(f).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });

  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Registrar un instrumento</div>
      <div class="hint" style="margin-bottom:10px">
        Symphomed <b>no aplica ni puntúa</b> el instrumento — eso lo hacés vos con tus
        materiales y tu entrenamiento. Acá queda el resultado, fechado y firmado,
        para el informe y para cuando haya que reaplicar.
      </div>

      <label>Instrumento</label>
      <select id="inInstrumento">
        <option value="">Elegí…</option>
        ${(instrumentosCatalogo || []).map(i => `<option value="${esc(i.nombre)}">${esc(i.nombre)}</option>`).join("")}
      </select>
      <div id="inNota"></div>

      <div id="inModuloCaja" style="display:none">
        <label>Módulo / forma</label>
        <select id="inModulo"></select>
      </div>

      <label>Fecha de aplicación</label>
      <input id="inFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">

      <label>Quién lo aplicó</label>
      <input id="inQuien" type="text" value="${esc(MEDICO_NOMBRE || "")}" placeholder="Nombre del profesional">
      <input id="inMatricula" type="text" placeholder="Matrícula / registro">

      <label>Puntajes</label>
      <div id="inPuntajes"></div>
      <button class="link" id="btnMasPuntaje" style="width:auto;margin:0 0 10px">+ Agregar otro puntaje</button>

      <label>Clasificación que arroja el instrumento</label>
      <input id="inClasificacion" type="text" placeholder="Tal cual la da el manual">

      <label>Tu interpretación</label>
      <textarea id="inInterpretacion" rows="3" placeholder="Un instrumento no es un diagnóstico. Acá va tu lectura, junto con la historia del desarrollo."></textarea>

      <div id="inErr"></div>
      <button class="secondary" id="btnGuardarInstrumento">Guardar</button>
    </div>

    ${aplicados.length === 0 ? `<div class="empty">Todavía no hay instrumentos registrados.</div>` : aplicados.map(a => `
      <div class="card">
        <div class="top" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div style="font-weight:600">${esc(a.instrumento)}${a.modulo ? ` · módulo ${esc(a.modulo)}` : ""}</div>
            <div class="fecha">${fecha(a.fecha)}${a.aplicadoPor ? ` · ${esc(a.aplicadoPor)}` : ""}${a.matricula ? ` (Reg. ${esc(a.matricula)})` : ""}</div>
          </div>
          <button class="link" data-borrar-instrumento="${a._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>

        ${(a.puntajes || []).length ? `
          <div style="margin-top:8px">
            ${a.puntajes.map(p => `
              <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line-soft, rgba(128,128,128,.15))">
                <span class="hint" style="margin:0">${esc(p.nombre)}</span>
                <b style="font-variant-numeric:tabular-nums">${esc(p.valor)}</b>
              </div>`).join("")}
          </div>` : ""}

        ${a.clasificacion ? `<div class="paciente-info" style="margin-top:8px"><b>${esc(a.clasificacion)}</b></div>` : ""}
        ${a.interpretacion ? `<div class="hint" style="margin-top:6px">${esc(a.interpretacion)}</div>` : ""}
      </div>`).join("")}`;

  // ─── Puntajes: se arman según el instrumento elegido ────────────────────
  // Los nombres salen del catálogo como sugerencia, pero son editables: cada
  // versión y cada traducción los etiqueta un poco distinto, y forzar los
  // nuestros haría que el registro no coincida con el informe original.
  function filaPuntaje(nombre = "", valor = "") {
    const div = document.createElement("div");
    div.style.cssText = "display:flex;gap:6px;margin-bottom:6px";
    div.innerHTML = `
      <input type="text" class="pun-nombre" value="${esc(nombre)}" placeholder="Nombre del puntaje" style="flex:2;margin:0">
      <input type="text" class="pun-valor" value="${esc(valor)}" placeholder="Valor" style="flex:1;margin:0">`;
    return div;
  }
  const cajaPuntajes = caja.querySelector("#inPuntajes");
  const reiniciarPuntajes = (nombres) => {
    cajaPuntajes.innerHTML = "";
    (nombres && nombres.length ? nombres : [""]).forEach(n => cajaPuntajes.appendChild(filaPuntaje(n)));
  };
  reiniciarPuntajes([]);
  caja.querySelector("#btnMasPuntaje").onclick = (e) => { e.preventDefault(); cajaPuntajes.appendChild(filaPuntaje()); };

  caja.querySelector("#inInstrumento").onchange = (ev) => {
    const elegido = (instrumentosCatalogo || []).find(i => i.nombre === ev.target.value);
    const cajaMod = caja.querySelector("#inModuloCaja");
    const selMod = caja.querySelector("#inModulo");
    if (elegido && elegido.modulos.length) {
      selMod.innerHTML = `<option value="">— Sin especificar —</option>` +
        elegido.modulos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      cajaMod.style.display = "";
    } else {
      cajaMod.style.display = "none";
      selMod.innerHTML = "";
    }
    caja.querySelector("#inNota").innerHTML = elegido?.nota
      ? `<div class="hint" style="color:var(--warning);margin:-4px 0 8px">${esc(elegido.nota)}</div>` : "";
    reiniciarPuntajes(elegido?.puntajes || []);
  };

  caja.querySelector("#btnGuardarInstrumento").onclick = async () => {
    const btn = caja.querySelector("#btnGuardarInstrumento");
    const err = caja.querySelector("#inErr");
    const instrumento = caja.querySelector("#inInstrumento").value;
    if (!instrumento) {
      err.innerHTML = `<div class="error">Elegí qué instrumento se aplicó.</div>`;
      return;
    }
    const puntajes = [...cajaPuntajes.querySelectorAll("div")].map(f => ({
      nombre: f.querySelector(".pun-nombre").value.trim(),
      valor: f.querySelector(".pun-valor").value.trim(),
    })).filter(p => p.nombre && p.valor);

    btn.disabled = true;
    try {
      await api(`/medico/pacientes/${pacienteId}/instrumentos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrumento,
          modulo: caja.querySelector("#inModulo")?.value || "",
          fecha: caja.querySelector("#inFecha").value,
          aplicadoPor: caja.querySelector("#inQuien").value.trim(),
          matricula: caja.querySelector("#inMatricula").value.trim(),
          puntajes,
          clasificacion: caja.querySelector("#inClasificacion").value.trim(),
          interpretacion: caja.querySelector("#inInterpretacion").value.trim(),
        }),
      });
      renderTabInstrumentos(pacienteId);
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };

  caja.querySelectorAll("[data-borrar-instrumento]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("¿Borrar este registro?")) return;
      try {
        await api(`/medico/instrumentos/${b.dataset.borrarInstrumento}`, { method: "DELETE" });
        renderTabInstrumentos(pacienteId);
      } catch (e) { alert(e.error || "No se pudo borrar"); }
    };
  });
}
