// Vitalis — El saldo prepago, en pantalla.
//
// Dos cosas viven acá:
//
//   1. La tarjeta de Configuración: cuánto tiene, para cuántas consultas le
//      alcanza, y el historial de movimientos. El historial es lo que hace
//      que el médico pueda discutir un cobro en vez de tener que creernos.
//
//   2. El aviso de saldo bajo, arriba del panel. Va ANTES de grabar, que es
//      el único momento en que el médico todavía puede hacer algo — después
//      de grabar la consulta ya existe y hay que procesarla.
//
// Lo que NO hace: cortarle nada. Ver services/saldo.js sobre por qué una
// consulta empezada se termina siempre, aunque el saldo se acabe en el medio.

// Se guarda lo último que dijo el servidor para que el aviso del panel no
// tenga que volver a preguntar en cada pantalla.
let SALDO_ESTADO = null;

async function traerSaldo() {
  try {
    SALDO_ESTADO = await api("/medico/saldo?movimientos=30");
  } catch {
    // Que falle esto no puede romper ninguna pantalla: es información de
    // más, no la ficha de nadie.
    SALDO_ESTADO = null;
  }
  return SALDO_ESTADO;
}

// ─── TARJETA EN CONFIGURACIÓN ─────────────────────────────────────────────
async function pintarSaldo() {
  const caja = document.getElementById("saldoBox");
  if (!caja) return;
  const s = await traerSaldo();
  if (!caja.isConnected) return;
  if (!s) { caja.innerHTML = ""; return; }

  const color = s.enNegativo ? "var(--danger)" : s.bajo ? "var(--warning)" : "var(--primary)";
  caja.innerHTML = `
    <div class="card" style="border-color:${color}">
      <div class="seccion-titulo" style="margin-top:0">${t("saldo.titulo")}</div>
      <div class="saldo-monto" style="color:${color}">${t("saldo.monto", { monto: esc(s.saldoBs) })}</div>
      <div class="hint" style="margin:2px 0 0">
        ${s.enNegativo
          ? t("saldo.enNegativo")
          : t("saldo.alcanzaPara", { n: s.consultasRestantes })}
      </div>
      <div class="hint" style="margin:8px 0 0">${t("saldo.precio", { monto: (s.precioConsultaCentavos / 100).toFixed(2) })}</div>

      ${s.bajo || s.enNegativo ? `
        <div class="saldo-aviso ${s.enNegativo ? "saldo-aviso-grave" : ""}">
          ${s.enNegativo ? t("saldo.avisoNegativo") : t("saldo.avisoBajo", { n: s.consultasRestantes })}
        </div>` : ""}

      <div id="recargaBox"></div>

      ${(s.movimientos || []).length ? `
        <button class="link" id="btnVerMovimientos" style="width:auto;margin-top:10px">${t("saldo.verMovimientos")}</button>
        <div id="saldoMovimientos" style="display:none">${movimientosHtml(s.movimientos)}</div>`
        : `<div class="hint" style="margin:10px 0 0">${t("saldo.sinMovimientos")}</div>`}
    </div>`;

  pintarRecarga();

  const btn = document.getElementById("btnVerMovimientos");
  if (btn) {
    btn.onclick = () => {
      const lista = document.getElementById("saldoMovimientos");
      const abierto = lista.style.display !== "none";
      lista.style.display = abierto ? "none" : "";
      btn.textContent = abierto ? t("saldo.verMovimientos") : t("saldo.ocultarMovimientos");
    };
  }
}

// Cada fila dice qué pasó, cuánto y cómo quedó el saldo. Sin la columna del
// saldo resultante, el médico no puede seguir la cuenta y tiene que creernos.
function movimientosHtml(movs) {
  return `
    <div class="clin-tabla-caja" style="margin-top:10px">
      <table class="clin-tabla">
        <thead><tr>
          <th>${t("saldo.col.fecha")}</th><th>${t("saldo.col.concepto")}</th>
          <th class="num">${t("saldo.col.monto")}</th><th class="num">${t("saldo.col.saldo")}</th>
        </tr></thead>
        <tbody>
          ${movs.map(m => {
            const suma = m.montoCentavos >= 0;
            return `
              <tr>
                <td style="white-space:nowrap">${new Date(m.createdAt).toLocaleDateString(localeActual(), { day: "2-digit", month: "2-digit" })}</td>
                <td>
                  ${esc(m.concepto || t("saldo.tipo." + m.tipo))}
                  ${m.referencia ? `<div class="hint" style="margin:0">${esc(m.referencia)}</div>` : ""}
                </td>
                <td class="num" style="color:${suma ? "var(--success)" : "var(--text)"}">
                  ${suma ? "+" : "−"}${(Math.abs(m.montoCentavos) / 100).toFixed(2)}
                </td>
                <td class="num">${m.saldoDespuesCentavos == null ? "—" : (m.saldoDespuesCentavos / 100).toFixed(2)}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

// ─── AVISO ARRIBA DEL PANEL ───────────────────────────────────────────────
// Solo cuando hace falta. Una barra permanente diciendo "te quedan 40
// consultas" es ruido que se deja de ver justo antes de que importe.
function avisoSaldoHtml() {
  const s = SALDO_ESTADO;
  if (!s || (!s.bajo && !s.enNegativo)) return "";
  return `
    <div class="card no-imprimir saldo-aviso-panel ${s.enNegativo ? "saldo-aviso-grave" : ""}" id="avisoSaldo" style="cursor:pointer">
      <div style="font-weight:600">
        ${s.enNegativo
          ? t("saldo.panelNegativo", { monto: esc(s.saldoBs) })
          : t("saldo.panelBajo", { n: s.consultasRestantes })}
      </div>
      <div class="hint" style="margin:2px 0 0">${t("saldo.panelAyuda")}</div>
    </div>`;
}

function engancharAvisoSaldo() {
  const aviso = document.getElementById("avisoSaldo");
  if (aviso) aviso.onclick = renderSeguridad;
}
