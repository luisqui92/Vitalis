// Symphomed — El tutor clínico en la pantalla (cuentas de estudiante, etapa 2).
//
// Dos momentos (modulos/estudiantes/tutor.js):
//   · Mientras graba: «te falta preguntar» y las banderas rojas, dentro del
//     recuadro de la nota en vivo (el lugar «notaEnVivo» de consultas.js).
//   · Al abrir la consulta: «¿cuál es tu diagnóstico?», y recién después el
//     razonamiento (el lugar «consulta.despues»).
//
// consultas.js no sabe que esto existe: estudiantes.js lo engancha en esos
// dos lugares (public/js/extensiones.js).

// «Te falta preguntar» y las banderas rojas.
// conNota: si ya hay de qué hablar, «no te falta nada» también es una
// respuesta (y una buena noticia).
function tutorEnVivoHtml(tutor, conNota) {
  if (!tutor) return "";
  const preguntas = Array.isArray(tutor.preguntas) ? tutor.preguntas : [];
  const banderas = Array.isArray(tutor.banderasRojas) ? tutor.banderasRojas : [];
  if (!preguntas.length && !banderas.length) {
    return conNota ? `<div class="tutor-vivo"><div class="hint" style="margin:0">${t("tutor.nadaFalta")}</div></div>` : "";
  }
  return `<div class="tutor-vivo">
    ${preguntas.length ? `<div class="nota-titulo">${t("tutor.faltaPreguntar")}</div>
      <ul class="tutor-lista">${preguntas.map(p => `<li><b>${esc(p.pregunta)}</b>${p.porQue ? `<div class="hint" style="margin:2px 0 0">${esc(p.porQue)}</div>` : ""}</li>`).join("")}</ul>` : ""}
    ${banderas.length ? `<div class="nota-titulo">${t("tutor.banderasRojas")}</div>
      <ul class="tutor-lista">${banderas.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

// ─── EL RAZONAMIENTO DIAGNÓSTICO ──────────────────────────────────────────
//
// Primero piensa él: escribe su diagnóstico y sus diferenciales. Recién
// después ve el análisis. El aviso de que es una ayuda para aprender va
// siempre, arriba. El razonamiento ya hecho viaja con la consulta, en
// consulta.extras (el punto «consulta.detalle» del servidor).
function razonamientoTarjetaHtml(c) {
  const hecho = c?.extras?.razonamiento;
  if (hecho?.en) return razonamientoResultadoHtml(hecho);
  const texto = c?.transcripcionCompleta || c?.transcripcionEnVivo || "";
  if (!esCuentaEstudiante() || c?.notaClinicaEstado !== "completado" || texto.split(/\s+/).filter(Boolean).length < 15) return "";
  return `
    <div class="card tutor-card" id="razonamientoCard">
      <div class="nota-titulo" style="margin-top:0">${t("tutor.titulo")}</div>
      <div class="hint" style="margin-bottom:10px">${t("tutor.consigna")}</div>
      <label for="rzPrincipal">${t("tutor.principal")}</label>
      <input id="rzPrincipal" type="text" maxlength="160">
      <label for="rzDiferenciales">${t("tutor.diferenciales")} <span class="hint">${t("nota.separadosComa")}</span></label>
      <input id="rzDiferenciales" type="text" maxlength="400">
      <div id="rzErr"></div>
      <button class="primary" id="rzBtn">${t("tutor.ver")}</button>
      <div class="hint" style="margin-top:8px">${t("tutor.unaVez")}</div>
    </div>`;
}

// tarjetasNuevas: las de repaso que se armaron recién con este razonamiento
// (modulos/estudiantes/estudio.js). Al volver a abrir la consulta, solo el
// acceso.
function razonamientoResultadoHtml(rz, tarjetasNuevas = 0) {
  const r = rz.resultado || {};
  const lista = (xs) => (xs || []).map(x => `<li>${esc(x)}</li>`).join("");
  const estudiante = esCuentaEstudiante();
  return `
    <div class="card tutor-card" id="razonamientoCard">
      <div class="nota-titulo" style="margin-top:0">${t("tutor.titulo")}</div>
      <div class="tutor-aviso">🎓 ${t("tutor.aviso")}</div>
      <div class="nota-campo"><b>${t("tutor.tuRespuesta")}</b> ${esc(rz.principal)}${(rz.diferenciales || []).length ? ` · <span class="hint">${esc(rz.diferenciales.join(", "))}</span>` : ""}</div>
      <div class="${r.acertoPrincipal ? "tutor-bien" : "tutor-mal"}">${r.acertoPrincipal ? "✓ " + t("tutor.acertaste") : "✗ " + t("tutor.noAcertaste")}</div>
      ${r.comentario ? `<div class="nota-campo">${esc(r.comentario)}</div>` : ""}
      ${(r.noConsideraste || []).length ? `<div class="nota-titulo">${t("tutor.noConsideraste")}</div>
        <ul class="tutor-lista">${r.noConsideraste.map(x => `<li><b>${esc(x.diagnostico)}</b>${x.porQue ? ` — ${esc(x.porQue)}` : ""}</li>`).join("")}</ul>` : ""}
      ${(r.diferenciales || []).length ? `<div class="nota-titulo">${t("tutor.diferencialesTitulo")}</div>
        <ol class="tutor-lista">${r.diferenciales.map(d => `<li class="tutor-dx"><b>${esc(d.diagnostico)}</b>
          ${(d.aFavor || []).length ? `<div class="tutor-favor">${t("tutor.aFavor")} ${esc(d.aFavor.join("; "))}</div>` : ""}
          ${(d.enContra || []).length ? `<div class="tutor-contra">${t("tutor.enContra")} ${esc(d.enContra.join("; "))}</div>` : ""}
          ${d.estudio ? `<div class="hint" style="margin:2px 0 0">${t("tutor.estudio")} ${esc(d.estudio)}</div>` : ""}</li>`).join("")}</ol>` : ""}
      ${(r.banderasRojas || []).length ? `<div class="nota-titulo">${t("tutor.banderasRojas")}</div><ul class="tutor-lista">${lista(r.banderasRojas)}</ul>` : ""}
      ${(r.faltoPreguntar || []).length ? `<div class="nota-titulo">${t("tutor.faltoPreguntar")}</div><ul class="tutor-lista">${lista(r.faltoPreguntar)}</ul>` : ""}
      ${r.perla ? `<div class="tutor-perla">💡 ${esc(r.perla)}</div>` : ""}
      ${estudiante ? `<div class="tutor-estudiar">
        <span class="hint" style="margin:0">${tarjetasNuevas ? t(tarjetasNuevas === 1 ? "estudio.nuevas.una" : "estudio.nuevas.varias", { n: tarjetasNuevas }) : t("estudio.nuevas.repasar")}</span>
        <button type="button" class="secondary" id="rzIrEstudiar">${t("estudio.nuevas.ir")}</button>
      </div>` : ""}
    </div>`;
}

function engancharIrAEstudiar() {
  const ir = document.getElementById("rzIrEstudiar");
  if (ir) ir.onclick = () => renderEstudiar();
}

function engancharRazonamiento(id) {
  engancharIrAEstudiar();
  const btn = document.getElementById("rzBtn");
  if (!btn) return;
  btn.onclick = async () => {
    const principal = document.getElementById("rzPrincipal").value.trim();
    const diferenciales = document.getElementById("rzDiferenciales").value.split(",").map(x => x.trim()).filter(Boolean);
    const err = document.getElementById("rzErr");
    err.innerHTML = "";
    if (principal.length < 3) { err.innerHTML = `<div class="error">${t("tutor.errPrincipal")}</div>`; return; }
    btn.disabled = true;
    btn.textContent = t("tutor.pensando");
    try {
      const r = await api(`/medico/consultas/${id}/razonamiento`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principal, diferenciales }),
      });
      const card = document.getElementById("razonamientoCard");
      if (card) card.outerHTML = razonamientoResultadoHtml(r.razonamiento, r.tarjetas || 0);
      engancharIrAEstudiar();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = t("tutor.ver");
      err.innerHTML = `<div class="error">${esc((e.status && e.status < 500 && e.error) || t("tutor.errGeneral"))}</div>`;
    }
  };
}
