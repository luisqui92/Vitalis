// Symphomed Gineco — Mapa ginecológico: esquema del aparato reproductor
// (útero, endometrio, cuello, ovarios y trompas) más las mamas, cada parte
// clickeable con su hallazgo y su historial. Mismo patrón que el odontograma
// y el mapa ocular: se toca, se carga qué se encontró, y queda la línea de
// tiempo de cómo fue cambiando.

// Ícono y color no cambian con el idioma; el nombre sí, y se resuelve al
// llamar porque este archivo se carga antes del login.
const HALLAZGOS_GINECO_ESTILO = {
  normal:        { icono: "🟢", color: "#15803d" },
  mioma:         { icono: "🔴", color: "#b91c1c" },
  quiste:        { icono: "🔵", color: "#2563eb" },
  polipo:        { icono: "🟣", color: "#7c3aed" },
  endometriosis: { icono: "🟤", color: "#9a3412" },
  inflamacion:   { icono: "🟠", color: "#ea580c" },
  engrosamiento: { icono: "🟡", color: "#ca8a04" },
  nodulo:        { icono: "🟥", color: "#be123c" },
  lesion:        { icono: "⚠️", color: "#a16207" },
  ausente:       { icono: "⚪", color: "#5b7480" },
};
function hallazgosGinecoInfo() {
  const salida = {};
  for (const k of Object.keys(HALLAZGOS_GINECO_ESTILO)) salida[k] = { ...HALLAZGOS_GINECO_ESTILO[k], label: t("hall." + k) };
  return salida;
}

const ORGANOS_GINECO_CLAVES = [
  "utero", "endometrio", "cuello_uterino", "ovario_derecho", "ovario_izquierdo",
  "trompa_derecha", "trompa_izquierda", "mama_derecha", "mama_izquierda",
];
function organosGineco() {
  const salida = {};
  for (const k of ORGANOS_GINECO_CLAVES) salida[k] = t("organo." + k);
  return salida;
}

async function renderTabMapaGineco(pacienteId) {
  const box = document.getElementById("mapaGinecoBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>${t("gin.cargando")}</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/examen-ginecologico`);
    pintarMapaGineco(pacienteId, data.examen);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || t("gin.errCargar"))}</div>`;
  }
}

// Esquema frontal del aparato reproductor: el útero como pera invertida al
// centro, el endometrio como su cavidad interna, el cuello colgando abajo,
// y las trompas saliendo de los cuernos hacia cada ovario.
function aparatoSvgHtml(porOrgano) {
  // Solo el color: para pintar el esquema no hace falta el nombre traducido.
  const color = (o) => HALLAZGOS_GINECO_ESTILO[porOrgano[o]?.hallazgo || "normal"]?.color || HALLAZGOS_GINECO_ESTILO.normal.color;
  const marcado = (o) => (porOrgano[o]?.hallazgo || "normal") !== "normal";
  const g = (o, contenido) => `<g class="organo-gineco" data-organo="${o}" style="cursor:pointer">${contenido}</g>`;
  // Un anillo alrededor de lo que no está normal, para que salte a la vista
  // sin depender solo del color (que en pantalla chica se pierde).
  const halo = (o, cx, cy, r) => marcado(o)
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color(o)}" stroke-width="2" stroke-dasharray="4 3" opacity="0.85"/>`
    : "";

  return `
    <svg viewBox="0 0 340 300" style="width:100%;max-width:360px;height:auto">
      <!-- trompas: curvan desde los cuernos del útero hacia cada ovario -->
      ${g("trompa_izquierda", `
        <path d="M 132 96 C 100 74, 74 74, 62 96" fill="none" stroke="${color("trompa_izquierda")}" stroke-width="9" stroke-linecap="round"/>
        ${halo("trompa_izquierda", 97, 82, 26)}`)}
      ${g("trompa_derecha", `
        <path d="M 208 96 C 240 74, 266 74, 278 96" fill="none" stroke="${color("trompa_derecha")}" stroke-width="9" stroke-linecap="round"/>
        ${halo("trompa_derecha", 243, 82, 26)}`)}

      <!-- ovarios -->
      ${g("ovario_izquierdo", `
        <ellipse cx="56" cy="112" rx="23" ry="17" fill="${color("ovario_izquierdo")}" fill-opacity="0.55" stroke="${color("ovario_izquierdo")}" stroke-width="2.5"/>
        ${halo("ovario_izquierdo", 56, 112, 28)}`)}
      ${g("ovario_derecho", `
        <ellipse cx="284" cy="112" rx="23" ry="17" fill="${color("ovario_derecho")}" fill-opacity="0.55" stroke="${color("ovario_derecho")}" stroke-width="2.5"/>
        ${halo("ovario_derecho", 284, 112, 28)}`)}

      <!-- cuerpo del útero -->
      ${g("utero", `
        <path d="M 132 92 C 118 130, 128 186, 170 200 C 212 186, 222 130, 208 92 C 190 104, 150 104, 132 92 Z"
              fill="${color("utero")}" fill-opacity="0.35" stroke="${color("utero")}" stroke-width="3" stroke-linejoin="round"/>`)}

      <!-- cavidad endometrial, adentro del útero -->
      ${g("endometrio", `
        <path d="M 146 106 C 140 136, 150 172, 170 182 C 190 172, 200 136, 194 106 C 180 114, 160 114, 146 106 Z"
              fill="${color("endometrio")}" fill-opacity="0.75" stroke="${color("endometrio")}" stroke-width="1.5"/>`)}

      <!-- cuello uterino -->
      ${g("cuello_uterino", `
        <path d="M 156 200 L 184 200 L 180 236 L 160 236 Z" fill="${color("cuello_uterino")}" fill-opacity="0.6" stroke="${color("cuello_uterino")}" stroke-width="2.5"/>
        ${halo("cuello_uterino", 170, 218, 26)}`)}

      <!-- etiquetas -->
      <text x="56" y="146" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.ovarioIzq")}</text>
      <text x="284" y="146" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.ovarioDer")}</text>
      <text x="170" y="152" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.utero")}</text>
      <text x="170" y="256" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.cuello")}</text>
      <text x="97" y="64" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.trompaIzq")}</text>
      <text x="243" y="64" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.trompaDer")}</text>
    </svg>`;
}

// Las mamas van aparte del esquema uterino: mezclarlas en el mismo dibujo no
// tendría sentido anatómico, pero el examen mamario sí es parte del control
// ginecológico, así que viven en el mismo mapa.
function mamasSvgHtml(porOrgano) {
  // Solo el color: para pintar el esquema no hace falta el nombre traducido.
  const color = (o) => HALLAZGOS_GINECO_ESTILO[porOrgano[o]?.hallazgo || "normal"]?.color || HALLAZGOS_GINECO_ESTILO.normal.color;
  const g = (o, contenido) => `<g class="organo-gineco" data-organo="${o}" style="cursor:pointer">${contenido}</g>`;
  return `
    <svg viewBox="0 0 220 130" style="width:100%;max-width:230px;height:auto">
      ${g("mama_izquierda", `
        <circle cx="62" cy="62" r="42" fill="${color("mama_izquierda")}" fill-opacity="0.35" stroke="${color("mama_izquierda")}" stroke-width="3"/>
        <circle cx="62" cy="62" r="7" fill="${color("mama_izquierda")}"/>
        <text x="62" y="120" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.mamaIzq")}</text>`)}
      ${g("mama_derecha", `
        <circle cx="158" cy="62" r="42" fill="${color("mama_derecha")}" fill-opacity="0.35" stroke="${color("mama_derecha")}" stroke-width="3"/>
        <circle cx="158" cy="62" r="7" fill="${color("mama_derecha")}"/>
        <text x="158" y="120" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">${t("gin.mamaDer")}</text>`)}
    </svg>`;
}

function pintarMapaGineco(pacienteId, examen) {
  const box = document.getElementById("mapaGinecoBox");
  if (!box) return;

  const porOrgano = {};
  examen.organos.forEach(o => { porOrgano[o.organo] = o; });

  const conHallazgo = examen.organos.filter(o => o.hallazgo !== "normal");
  // Solo se muestran en la leyenda los hallazgos que esta paciente tiene:
  // listar los diez siempre llenaba la pantalla de colores que no aplican.
  const usados = [...new Set(["normal", ...conHallazgo.map(o => o.hallazgo)])];

  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="seccion-titulo" style="margin-top:0;text-align:left">${t("gin.titulo")}</div>
      <div class="hint" style="text-align:left;margin-bottom:10px">
        Tocá cualquier órgano para cargar el hallazgo y ver su historial. Lo que aparece
        "🎙️ por voz" viene de una consulta grabada — revisalo y corregilo si hace falta.
      </div>
      ${aparatoSvgHtml(porOrgano)}
      <div class="seccion-titulo" style="text-align:left;margin-top:16px">${t("gin.mamas")}</div>
      ${mamasSvgHtml(porOrgano)}
      <div class="odonto-leyenda">
        ${usados.map(k => {
          const v = hallazgosGinecoInfo()[k];
          return `<span class="odonto-leyenda-item"><i style="background:${v.color};border:1px solid ${v.color}"></i>${esc(v.label)}</span>`;
        }).join("")}
      </div>
      ${conHallazgo.length ? `
        <div class="hint" style="text-align:left;margin-top:10px">
          <b>${t("gin.hallazgosTitulo")}</b> ${conHallazgo.map(o => esc(`${organosGineco()[o.organo]}: ${hallazgosGinecoInfo()[o.hallazgo].label}`)).join(" · ")}
        </div>` : `
        <div class="hint" style="text-align:left;margin-top:10px">${t("gin.sinHallazgos")}</div>`}
    </div>
    <div id="organoDetalleBox"></div>`;

  document.querySelectorAll(".organo-gineco").forEach(g => {
    g.onclick = () => pintarDetalleOrgano(pacienteId, porOrgano[g.dataset.organo]);
  });
}

function pintarDetalleOrgano(pacienteId, item) {
  const box = document.getElementById("organoDetalleBox");
  const nombre = organosGineco()[item.organo] || item.organo;

  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${esc(nombre)}</div>
      <label>${t("gin.hallazgo")}</label>
      <select id="ginHallazgo">
        ${Object.entries(hallazgosGinecoInfo()).map(([k, v]) => `<option value="${k}" ${k === item.hallazgo ? "selected" : ""}>${v.icono} ${esc(v.label)}</option>`).join("")}
      </select>
      <label>${t("gin.notas")}</label>
      <textarea id="ginNotas" rows="2" placeholder="${t("gin.notasPlaceholder")}">${esc(item.notas || "")}</textarea>
      <div id="ginErr"></div>
      <button class="primary" id="btnGuardarOrgano">${t("gin.guardar")}</button>

      ${item.historial?.length ? `
        <div class="seccion-titulo" style="margin-top:18px">${t("gin.historial")}</div>
        <div class="odonto-timeline">
          ${[...item.historial].reverse().map(h => {
            const hallazgos = hallazgosGinecoInfo();
            const info = hallazgos[h.hallazgo] || hallazgos.normal;
            return `
              <div class="odonto-timeline-item">
                <div class="odonto-timeline-icono" style="background:${info.color}">${info.icono}</div>
                <div class="odonto-timeline-contenido">
                  <div class="odonto-timeline-fecha">${new Date(h.fecha).toLocaleDateString(localeActual())}${h.fuente === "voz" ? t("porVoz") : ""}</div>
                  <div class="odonto-timeline-titulo">${esc(info.label)}</div>
                  ${h.notas ? `<div class="odonto-timeline-notas">${esc(h.notas)}</div>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>` : ""}
    </div>`;

  document.getElementById("btnGuardarOrgano").onclick = async () => {
    const errBox = document.getElementById("ginErr");
    errBox.innerHTML = "";
    const hallazgo = document.getElementById("ginHallazgo").value;
    const notas = document.getElementById("ginNotas").value.trim();
    const btn = document.getElementById("btnGuardarOrgano");
    // Mismo guard que el odontograma y el mapa ocular: sin esto un doble
    // clic manda dos PATCH que leen el mismo historial y se pisan.
    btn.disabled = true;
    try {
      await api(`/medico/pacientes/${pacienteId}/examen-ginecologico/${item.organo}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hallazgo, notas }),
      });
      renderTabMapaGineco(pacienteId);
    } catch (e) {
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("gin.errGuardar"))}</div>`;
    }
  };
}
