// Odontograma de una práctica: ningún pedido usa las rutas de pacientes reales.
const ODO_EST_PERMANENTES = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
const ODO_EST_TEMPORALES = [55,54,53,52,51,61,62,63,64,65,85,84,83,82,81,71,72,73,74,75];
const ODO_EST_ESTADOS = ["sano", "caries", "restauracion", "fractura", "sellante"];
const ODO_EST_GLOBALES = ["ausente", "corona", "endodoncia", "implante"];
const ODO_EST_COLORES = { sano: "#eef5f5", caries: "#e94f58", restauracion: "#4f9bff", fractura: "#f7a44b", sellante: "#53caa6" };
const pvEsOdontologia = area => /^odo_/.test(area || "");
const odoEstSuperficies = d => ["M", "D", "V", "L", d % 10 <= 3 ? "I" : "O"];

function odontogramaDienteSvg(diente, registro) {
  const cuadrante = Math.floor(diente / 10);
  const mesialDerecha = [1, 4, 5, 8].includes(cuadrante);
  const superior = [1, 2, 5, 6].includes(cuadrante);
  const superficies = [
    [superior ? "V" : "L", "2,2 42,2 31,13 13,13"],
    [superior ? "L" : "V", "2,42 42,42 31,31 13,31"],
    [mesialDerecha ? "D" : "M", "2,2 13,13 13,31 2,42"],
    [mesialDerecha ? "M" : "D", "42,2 31,13 31,31 42,42"],
    [diente % 10 <= 3 ? "I" : "O", "13,13 31,13 31,31 13,31"],
  ];
  const anotaciones = registro.filter(r => r.diente === diente);
  const global = anotaciones.find(r => r.superficie === "pieza");
  const simbolo = { corona: "C", endodoncia: "E", implante: "P" }[global?.estado];
  return `<svg viewBox="0 0 44 44" aria-hidden="true" focusable="false">
    ${superficies.map(([s, puntos]) => `<polygon points="${puntos}" fill="${ODO_EST_COLORES[anotaciones.find(r => r.superficie === s)?.estado] || "#243d4b"}" stroke="#9cb6c2" stroke-width="1"/>`).join("")}
    ${global?.estado === "ausente" ? '<path d="M5 5L39 39M39 5L5 39" stroke="#f3c866" stroke-width="4"/>' : ""}
    ${simbolo ? `<circle cx="22" cy="22" r="12" fill="#122431"/><text x="22" y="27" text-anchor="middle" fill="#fff" font-size="15">${simbolo}</text>` : ""}
  </svg>`;
}

function odontogramaEstudianteHtml() {
  return `<details class="odo-est card-secundaria" id="odoEst" open>
    <summary>${t("odoEst.titulo")}</summary>
    <p class="hint">${t("odoEst.ayuda")}</p>
    <div id="odoEstEditor"></div>
    <button type="button" class="primary" id="odoEstGuardar">${t("odoEst.guardar")}</button>
    <p id="odoEstEstado" role="status" aria-live="polite"></p>
  </details>`;
}

function montarOdontogramaEstudiante(sim) {
  const box = document.getElementById("odoEstEditor");
  if (!box) return;
  const denticion = sim.denticionDental || "permanente";
  const estado = {
    diente: denticion === "temporal" ? 55 : 18,
    registro: (sim.odontograma?.registro || []).map(r => ({ ...r })),
    revision: sim.odontograma?.revision || 0, sucio: false, guardando: false,
  };
  PV.odontograma = estado;
  const aviso = document.getElementById("odoEstEstado");
  const marcar = () => { estado.sucio = true; aviso.textContent = t("odoEst.sinGuardar"); pintar(); };
  const pintar = () => {
    const filas = denticion === "mixta" ? [ODO_EST_PERMANENTES, ODO_EST_TEMPORALES]
      : [denticion === "temporal" ? ODO_EST_TEMPORALES : ODO_EST_PERMANENTES];
    const opciones = estados => `<option value="">${t("odoEst.sinRegistrar")}</option>${estados.map(e => `<option value="${e}">${t("odoEst.estado." + e)}</option>`).join("")}`;
    const registrado = superficie => estado.registro.find(r => r.diente === estado.diente && r.superficie === superficie);
    box.innerHTML = `<fieldset ${estado.guardando ? "disabled" : ""}>
      <legend class="sr-only">${t("odoEst.titulo")}</legend>
      <p class="hint">${t("odoEst.orientacion")}</p>
      ${filas.map(fila => `<div class="odo-est-arcada${fila.length === 20 ? " odo-est-temporal" : ""}" role="group" aria-label="${t(fila.length === 20 ? "odoEst.temporal" : "odoEst.permanente")}">
        <div class="est-rotulo">${t(fila.length === 20 ? "odoEst.temporal" : "odoEst.permanente")}</div>
        <div class="odo-est-dientes">${fila.map(d => {
          const regs = estado.registro.filter(r => r.diente === d);
          return `<button type="button" class="odo-est-diente${d === estado.diente ? " activo" : ""}" data-diente="${d}" aria-pressed="${d === estado.diente}" aria-label="${esc(t("odoEst.diente", { n: d }) + (regs.length ? " · " + regs.map(r => t("odoEst.superficie." + r.superficie) + ": " + t("odoEst.estado." + r.estado)).join("; ") : " · " + t("odoEst.sinRegistrar")))}">${d}${odontogramaDienteSvg(d, estado.registro)}</button>`;
        }).join("")}</div></div>`).join("")}
      <h3>${t("odoEst.diente", { n: estado.diente })}</h3>
      <div class="odo-est-leyenda">${ODO_EST_ESTADOS.map(e => `<span><i style="background:${ODO_EST_COLORES[e]}" aria-hidden="true"></i>${t("odoEst.estado." + e)}</span>`).join("")}</div>
      <div class="odo-est-superficies">
        ${[...odoEstSuperficies(estado.diente), "pieza"].map(s => `<label>${t("odoEst.superficie." + s)}
          <select data-superficie="${s}" aria-label="${esc(t("odoEst.diente", { n: estado.diente }) + " · " + t("odoEst.superficie." + s))}">${opciones(s === "pieza" ? ODO_EST_GLOBALES : ODO_EST_ESTADOS)}</select>
        </label>`).join("")}
      </div>
      <p class="hint">${t("odoEst.ausenteAyuda")}</p>
      <div class="odo-est-registro">${estado.registro.filter(r => r.diente === estado.diente).map(r => `<label>${t("odoEst.nota", { superficie: esc(t("odoEst.superficie." + r.superficie)) })}
        <input type="text" maxlength="200" data-nota="${r.superficie}" value="${esc(r.nota || "")}">
      </label>`).join("")}</div>
    </fieldset>`;
    box.querySelectorAll("[data-diente]").forEach(b => { b.onclick = () => { estado.diente = Number(b.dataset.diente); pintar(); }; });
    box.querySelectorAll("[data-superficie]").forEach(select => {
      select.value = registrado(select.dataset.superficie)?.estado || "";
      select.onchange = () => {
        const superficie = select.dataset.superficie, valor = select.value;
        const previo = registrado(superficie);
        estado.registro = estado.registro.filter(r => !(r.diente === estado.diente && r.superficie === superficie));
        if (valor) {
          // Cambiar una ausencia a un hallazgo elimina la ausencia, y viceversa.
          estado.registro = estado.registro.filter(r => r.diente !== estado.diente || (valor !== "ausente" && r.estado !== "ausente"));
          estado.registro.push({ diente: estado.diente, superficie, estado: valor, nota: previo?.nota || "" });
        }
        marcar();
      };
    });
    box.querySelectorAll("[data-nota]").forEach(input => { input.oninput = () => {
      const r = registrado(input.dataset.nota);
      if (r) { r.nota = input.value; estado.sucio = true; aviso.textContent = t("odoEst.sinGuardar"); }
    }; });
  };
  pintar();
  document.getElementById("odoEstGuardar").onclick = async () => {
    if (estado.guardando || PV?.enviando || PV?.sim?._id !== sim._id) return;
    estado.guardando = true; pintar();
    const boton = document.getElementById("odoEstGuardar");
    boton.disabled = true; aviso.textContent = t("odoEst.guardando");
    try {
      const r = await api(`/medico/pacientes-virtuales/${sim._id}/odontograma`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registro: estado.registro, revision: estado.revision }),
      });
      estado.revision = r.odontograma.revision;
      estado.registro = r.odontograma.registro;
      estado.sucio = false; sim.odontograma = r.odontograma;
      aviso.textContent = t("odoEst.guardado");
    } catch (e) {
      aviso.textContent = e.status === 409 ? t("odoEst.conflicto") : e.error || t("pv.error");
    } finally {
      estado.guardando = false;
      if (PV?.sim?._id === sim._id && document.getElementById("odoEstEditor") === box) { boton.disabled = false; pintar(); }
    }
  };
}

function odontogramaPendientePV() {
  if (!PV?.odontograma?.sucio && !PV?.odontograma?.guardando) return false;
  const box = document.getElementById("odoEst");
  if (box) { box.open = true; box.scrollIntoView({ block: "center" }); }
  const estado = document.getElementById("odoEstEstado");
  if (estado) estado.textContent = t("odoEst.guardarAntes");
  return true;
}

function registroDentalHtml(registro) {
  return `<ul class="tutor-lista">${(registro || []).map(r => `<li>${t("odoEst.diente", { n: Number(r.diente) })} · ${t("odoEst.superficie." + r.superficie)}:
    <b>${t("odoEst.estado." + r.estado)}</b>${r.elegido ? ` (${t("odoEst.elegiste")}: ${t("odoEst.estado." + r.elegido)})` : ""}${r.nota ? ` — ${esc(r.nota)}` : ""}</li>`).join("")}</ul>`;
}

function evaluacionDentalHtml(sim) {
  const ev = sim.evaluacion || {}, odo = ev.odontograma || {}, plan = ev.planTratamiento || {};
  return `<section class="odo-est-evaluacion">
    <h3>${t("odoEst.plan")}</h3>
    <p>${esc(sim.respuesta?.plan || "")}</p>
    ${listaPV(plan.adecuadas, "si", "✓")}${listaPV(plan.faltaron, "no", "✗")}${listaPV(plan.inadecuadas, "ojo", "⚠")}
    <h3>${t("odoEst.comparacion")}</h3>
    <p class="hint">${t("odoEst.comparacionAyuda")}</p>
    ${["correctos", "faltaron", "diferentes", "adicionales"].map(k => `<details ${k === "faltaron" || k === "diferentes" ? "open" : ""}>
      <summary>${t("odoEst." + k)} (${(odo[k] || []).length})</summary>${registroDentalHtml(odo[k])}</details>`).join("")}
    <details><summary>${t("odoEst.esperado")}</summary>${registroDentalHtml(sim.guion?.odontologia?.odontograma)}
      <h4>${t("odoEst.planEsperado")}</h4>${listaPV(sim.guion?.odontologia?.planClave, "", "·")}</details>
    <button type="button" class="secondary" id="odoEstRepasar">${t("odoEst.repasar")}</button>
  </section>`;
}
