// Vitalis — Panel de clínica: varios consultorios vistos desde arriba.
//
// Lo que esta pantalla NO muestra es tan parte del diseño como lo que sí:
// no hay un solo nombre de paciente, ni una consulta, ni un diagnóstico.
// Un administrativo no es médico. El backend ya lo garantiza (ver el
// comentario de arriba de routes/admin.js); acá simplemente no hay dónde
// pedirlo.
//
// Quien administra puede ser una de dos cosas:
//   admin    — solo esto. Sus rutas de médico están cerradas.
//   director — atiende Y administra. Ve las dos, y cambia con un botón.

let MEDICO_ROL = localStorage.getItem("salud_rol") || "medico";

function esAdministrador() { return MEDICO_ROL === "admin" || MEDICO_ROL === "director"; }
function esSoloAdministrador() { return MEDICO_ROL === "admin"; }

// ─── PANEL ────────────────────────────────────────────────────────────────
async function renderClinica() {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("clin.cargando")}</div>`;
  try {
    const [datos, resumen, ocupacion, finanzas, equipos] = await Promise.all([
      api("/admin/clinica"),
      api("/admin/resumen"),
      api("/admin/ocupacion?dias=7"),
      api("/admin/finanzas"),
      api("/admin/equipos").catch(() => ({ equipos: [] })),
    ]);
    if (!seriePantallaVigente(serie)) return;
    pintarClinica(datos, resumen, ocupacion, finanzas, equipos);
  } catch (e) {
    if (e.status === 401) return logout();
    if (!seriePantallaVigente(serie)) return;
    app.innerHTML = `<div class="error">${esc(e.error || t("clin.error"))}</div>`;
  }
}

function pintarClinica(datos, resumen, ocupacion, finanzas, equipos) {
  const dias = [...new Set(ocupacion.salas.flatMap(s => Object.keys(s.porDia)))].sort();
  const proximosDias = [];
  for (let i = 0; i < ocupacion.dias; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    proximosDias.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  app.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">🏥 ${esc(datos.clinica.nombre)}</div>
      <div class="hint" style="margin:0">${t("clin.consultorios", { n: datos.medicos.length })}</div>
    </div>

    <div class="escr-stats">
      ${escrStatCardHtml(resumen.totales.consultasMes, t("clin.stat.consultasMes"))}
      ${escrStatCardHtml(resumen.totales.citasHoy, t("clin.stat.citasHoy"))}
      ${escrStatCardHtml(resumen.totales.pacientes, t("clin.stat.pacientes"))}
      ${escrStatCardHtml(datos.medicos.length, t("clin.stat.medicos"))}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("clin.porConsultorio")}</div>
      <div class="hint" style="margin:0 0 10px">${t("clin.porConsultorioAyuda")}</div>
      <div class="clin-tabla-caja">
        <table class="clin-tabla">
          <thead><tr>
            <th>${t("clin.col.medico")}</th><th>${t("clin.col.consultorio")}</th>
            <th>${t("clin.col.vinculo")}</th><th class="num">${t("clin.col.consultasMes")}</th>
            <th class="num">${t("clin.col.pacientes")}</th><th class="num">${t("clin.col.hoy")}</th>
          </tr></thead>
          <tbody>
            ${resumen.medicos.map(m => `
              <tr>
                <td>
                  <div style="font-weight:600">${esc(m.nombre)}</div>
                  <div class="hint" style="margin:0">${esc(m.especialidad || t("area." + m.tipoEspecialidad))}</div>
                </td>
                <td>${esc(m.consultorio || "—")}</td>
                <td><span class="clin-chip clin-chip-${m.vinculo}">${t("clin.vinculo." + m.vinculo)}</span></td>
                <td class="num">${m.consultasMes}</td>
                <td class="num">${m.pacientes}</td>
                <td class="num">${m.citasHoy}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("clin.ocupacion")}</div>
      <div class="hint" style="margin:0 0 10px">${t("clin.ocupacionAyuda")}</div>
      <div class="clin-tabla-caja">
        <table class="clin-tabla">
          <thead><tr>
            <th>${t("clin.col.consultorio")}</th>
            ${proximosDias.map(d => {
              const f = new Date(d + "T00:00:00Z");
              return `<th class="num">${t("dia.corto." + f.getUTCDay())}<br><span class="hint">${f.getUTCDate()}</span></th>`;
            }).join("")}
          </tr></thead>
          <tbody>
            ${ocupacion.salas.map(s => `
              <tr>
                <td>
                  <div style="font-weight:600">${esc(s.consultorio || s.nombre)}</div>
                  ${s.consultorio ? `<div class="hint" style="margin:0">${esc(s.nombre)}</div>` : ""}
                </td>
                ${proximosDias.map(d => {
                  const n = s.porDia[d] || 0;
                  return `<td class="num${n ? " clin-ocupado" : ""}">${n || "·"}</td>`;
                }).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    ${finanzasClinicaHtml(finanzas)}

    ${equipos.equipos.length ? `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">${t("clin.equipos")}</div>
        ${equipos.equipos.map(e => `
          <div class="item" style="cursor:default">
            <div class="top">
              <div class="nombre">${e.conectado ? "🟢" : "⚪"} ${esc(e.nombre)}</div>
            </div>
            <div class="fecha">${e.subidas ? t("rx.variasImagenes", { n: e.subidas }) : t("rx.sinImagenes")}</div>
          </div>`).join("")}
      </div>` : ""}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("clin.sumar")}</div>
      <div class="hint" style="margin:0 0 10px">${t("clin.sumarAyuda")}</div>
      <label>${t("clin.telefonoMedico")}</label>
      <input id="clinPhone" type="tel" placeholder="${t("auth.telefonoPlaceholder")}">
      <label>${t("clin.vinculoCampo")}</label>
      <select id="clinVinculo">
        <option value="empleado">${t("clin.vinculo.empleado")}</option>
        <option value="alquila">${t("clin.vinculo.alquila")}</option>
      </select>
      <div class="hint" style="margin:6px 0 0" id="clinVinculoAyuda">${t("clin.vinculoAyudaEmpleado")}</div>
      <label>${t("clin.consultorioCampo")}</label>
      <input id="clinConsultorio" type="text" placeholder="${t("clin.consultorioPlaceholder")}">
      <div id="clinErr"></div>
      <button class="secondary" id="btnVincularMedico">${t("clin.vincular")}</button>
    </div>`;

  const selVinculo = document.getElementById("clinVinculo");
  selVinculo.onchange = () => {
    document.getElementById("clinVinculoAyuda").textContent =
      t(selVinculo.value === "alquila" ? "clin.vinculoAyudaAlquila" : "clin.vinculoAyudaEmpleado");
  };

  document.getElementById("btnVincularMedico").onclick = async () => {
    const errBox = document.getElementById("clinErr");
    errBox.innerHTML = "";
    const phone = document.getElementById("clinPhone").value.trim();
    if (!phone) { errBox.innerHTML = `<div class="error">${t("clin.errFaltaTelefono")}</div>`; return; }
    const btn = document.getElementById("btnVincularMedico");
    btn.disabled = true;
    try {
      await api(`/admin/medicos/${encodeURIComponent(phone)}/vincular`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vinculo: selVinculo.value,
          consultorio: document.getElementById("clinConsultorio").value.trim(),
        }),
      });
      renderClinica();
    } catch (e) {
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("clin.errVincular"))}</div>`;
    }
  };
}

// La facturación solo existe para los médicos en relación de dependencia.
// El que alquila el consultorio factura por su cuenta y esa plata no es de
// la clínica — se dice explícitamente cuántos quedaron afuera, porque un
// total que no cierra sin explicación hace dudar del sistema entero.
function finanzasClinicaHtml(finanzas) {
  if (finanzas.porMedico.length === 0 && !finanzas.inquilinosExcluidos) return "";
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("clin.finanzas")}</div>
      ${finanzas.inquilinosExcluidos ? `
        <div class="hint" style="margin:0 0 10px">${t("clin.finanzasInquilinos", { n: finanzas.inquilinosExcluidos })}</div>` : ""}
      ${finanzas.porMedico.length === 0 ? `<div class="hint">${t("clin.finanzasVacio")}</div>` : `
        <div class="escr-stats" style="margin-bottom:12px">
          ${escrStatCardHtml(money(finanzas.totales.facturado), t("fin.facturado"))}
          ${escrStatCardHtml(money(finanzas.totales.cobrado), t("fin.cobrado"))}
          ${escrStatCardHtml(money(finanzas.totales.pendiente), t("fin.saldo"))}
        </div>
        <div class="clin-tabla-caja">
          <table class="clin-tabla">
            <thead><tr>
              <th>${t("clin.col.medico")}</th><th class="num">${t("fin.facturado")}</th>
              <th class="num">${t("fin.cobrado")}</th><th class="num">${t("fin.saldo")}</th>
            </tr></thead>
            <tbody>
              ${finanzas.porMedico.map(m => `
                <tr>
                  <td>${esc(m.nombre)}${m.consultorio ? ` <span class="hint">· ${esc(m.consultorio)}</span>` : ""}</td>
                  <td class="num">${money(m.facturado)}</td>
                  <td class="num">${money(m.cobrado)}</td>
                  <td class="num">${money(m.pendiente)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`}
    </div>`;
}
