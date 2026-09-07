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

  // ═══ QUÉ MUESTRA ESTA TARJETA ═══════════════════════════════════════════
  //
  // Tres situaciones distintas, y mostrar la equivocada confunde:
  //
  //   · con plan vigente  → cuándo vence. El saldo no importa: las consultas
  //                          no descuentan.
  //   · en cortesía       → cuántas gratis le quedan. Hablarle de saldo a
  //                          alguien que todavía no pagó nada no significa
  //                          nada para él.
  //   · prepago           → el saldo de siempre.
  const plan = s.suscripcion || {};
  const gratis = s.gratis || {};
  const color = plan.activa ? "var(--success)"
    : gratis.enCortesia ? "var(--primary)"
    : s.enNegativo ? "var(--danger)" : s.bajo ? "var(--warning)" : "var(--primary)";

  const cabecera = plan.activa
    ? `<div class="saldo-monto" style="color:${color}">${t("plan.activoTitulo", { plan: t("plan." + plan.plan) })}</div>
       <div class="hint" style="margin:2px 0 0">${t("plan.venceEn", { dias: plan.diasRestantes })}</div>`
    : gratis.enCortesia
    ? `<div class="saldo-monto" style="color:${color}">${t("plan.gratisRestantes", { n: gratis.restantes })}</div>
       <div class="hint" style="margin:2px 0 0">${t("plan.gratisAyuda", { total: gratis.total })}</div>`
    : `<div class="saldo-monto" style="color:${color}">${t("saldo.monto", { monto: esc(s.saldoBs) })}</div>
       <div class="hint" style="margin:2px 0 0">
         ${s.enNegativo ? t("saldo.enNegativo") : t("saldo.alcanzaPara", { n: s.consultasRestantes })}
       </div>`;

  caja.innerHTML = `
    <div class="card" style="border-color:${color}">
      <div class="seccion-titulo" style="margin-top:0">${plan.activa ? t("plan.titulo") : t("saldo.titulo")}</div>
      ${cabecera}
      ${plan.activa ? "" : `<div class="hint" style="margin:8px 0 0">${t("saldo.precio", { monto: (s.precioConsultaCentavos / 100).toFixed(2) })}</div>`}

      ${plan.porVencer ? `<div class="saldo-aviso">${t("plan.porVencer", { dias: plan.diasRestantes })}</div>` : ""}
      ${!plan.activa && gratis.porAcabarse ? `
        <div class="saldo-aviso">${gratis.restantes === 1 ? t("plan.ultimaGratis") : t("plan.quedanPocas", { n: gratis.restantes })}</div>` : ""}
      ${!plan.activa && !gratis.enCortesia && (s.bajo || s.enNegativo) ? `
        <div class="saldo-aviso ${s.enNegativo ? "saldo-aviso-grave" : ""}">
          ${s.enNegativo ? t("saldo.avisoNegativo") : t("saldo.avisoBajo", { n: s.consultasRestantes })}
        </div>` : ""}

      <div id="planesBox"></div>
      <div id="recargaBox"></div>

      ${(s.movimientos || []).length ? `
        <button class="link" id="btnVerMovimientos" style="width:auto;margin-top:10px">${t("saldo.verMovimientos")}</button>
        <div id="saldoMovimientos" style="display:none">${movimientosHtml(s.movimientos)}</div>`
        : `<div class="hint" style="margin:10px 0 0">${t("saldo.sinMovimientos")}</div>`}
    </div>`;

  // Los planes ANTES de la recarga: si el médico está por quedarse sin
  // cortesías, la decisión que le interesa es qué modelo elige, no cuánto
  // saldo carga. Cargar saldo es una de las dos respuestas, no la pregunta.
  pintarPlanes(s);
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

// ─── ELEGIR CÓMO PAGAR ────────────────────────────────────────────────────
//
// ═══ POR QUÉ NO SE ELIGE AL INSCRIBIRSE ══════════════════════════════════
//
// Sería el peor momento: el médico todavía no vio el producto, así que no
// puede saber si le conviene pagar por consulta o por mes. Y además su
// cuenta está pendiente de aprobación — le estaríamos pidiendo que decida
// cómo pagar algo a lo que ni siquiera sabe si va a entrar.
//
// Las consultas de cortesía existen justamente para que esa decisión llegue
// informada. Para la cuarta ya sabe si esto le ahorra tiempo.
//
// Por eso esta caja NO aparece siempre:
//
//   · con cortesías de sobra  → no se muestra. Que trabaje tranquilo.
//   · quedando 1 o 2          → aparece, sin bloquear nada.
//   · agotadas, o saldo bajo  → aparece abierta, porque ya hay que decidir.
//   · con plan vigente        → solo la opción de renovar.
let PLANES_ABIERTO = false;

function pintarPlanes(s) {
  const caja = document.getElementById("planesBox");
  if (!caja) return;

  const plan = s.suscripcion || {};
  const gratis = s.gratis || {};
  const precios = plan.precios || {};

  // Con plan vigente y lejos de vencer no hay nada que ofrecerle.
  if (plan.activa && !plan.porVencer) { caja.innerHTML = ""; return; }
  // Recién empieza y le sobran cortesías: no se le vende nada todavía.
  if (!plan.activa && gratis.enCortesia && !gratis.porAcabarse) { caja.innerHTML = ""; return; }

  // Se abre sola cuando ya no le quedan gratis y no tiene con qué seguir.
  const urgente = !plan.activa && !gratis.enCortesia && (s.bajo || s.enNegativo);
  const abierto = PLANES_ABIERTO || urgente;

  caja.innerHTML = `
    <button class="secondary" id="btnVerPlanes" style="margin-top:12px">
      ${plan.activa ? t("plan.renovar") : t("plan.verPlanes")}
    </button>
    <div id="planesDetalle" style="display:${abierto ? "" : "none"}">
      <div class="hint" style="margin:10px 0">${plan.activa ? t("plan.renovarAyuda") : t("plan.elegirAyuda")}</div>

      ${["mensual", "anual"].map(p => `
        <div class="plan-opcion" data-plan="${p}">
          <div class="plan-nombre">${t("plan." + p)}</div>
          <div class="plan-precio">${esc(p === "anual" ? precios.anualTexto : precios.mensualTexto)}</div>
          <div class="hint" style="margin:4px 0 0">
            ${p === "anual" ? t("plan.anualAyuda", { meses: precios.mesesGratis }) : t("plan.mensualAyuda", { n: s.precioConsultaCentavos ? Math.round(precios.mensual / s.precioConsultaCentavos) : 0 })}
          </div>
        </div>`).join("")}

      <!-- El prepago no se esconde: para un médico que atiende poco es la
           opción correcta, y ofrecer solo el plan sería empujarlo a pagar de
           más. Va abajo porque el plan es lo que conviene a la mayoría. -->
      ${plan.activa ? "" : `
        <div class="hint" style="margin:14px 0 0">${t("plan.oPrepago", { monto: (s.precioConsultaCentavos / 100).toFixed(2) })}</div>`}
      <div id="planPago"></div>
    </div>`;

  const btn = document.getElementById("btnVerPlanes");
  btn.onclick = () => {
    const d = document.getElementById("planesDetalle");
    PLANES_ABIERTO = d.style.display === "none";
    d.style.display = PLANES_ABIERTO ? "" : "none";
  };

  caja.querySelectorAll(".plan-opcion").forEach(el => {
    el.onclick = () => elegirPlan(el.dataset.plan, s);
  });
}

// Contratar un plan es pagar un monto fijo. En Brasil eso ya está resuelto:
// se genera el mismo código Pix que para una recarga, con el precio del plan
// adentro. No hace falta un flujo de pago nuevo — hace falta el monto.
async function elegirPlan(plan, s) {
  const destino = document.getElementById("planPago");
  const precios = (s.suscripcion || {}).precios || {};
  const centavos = plan === "anual" ? precios.anual : precios.mensual;
  const texto = plan === "anual" ? precios.anualTexto : precios.mensualTexto;

  destino.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  // Fuera de Brasil todavía no hay código con monto: se le dice qué pagar y
  // con qué datos, que es lo mismo que hace hoy la recarga.
  if (MEDICO_MONEDA !== "BRL") {
    destino.innerHTML = `
      <div class="saldo-aviso" style="margin-top:12px">
        ${t("plan.pagarManual", { plan: t("plan." + plan), monto: esc(texto) })}
      </div>`;
    return;
  }

  try {
    const r = await api(`/medico/recargas/pix?centavos=${centavos}`);
    destino.innerHTML = `
      <div class="card card-secundaria" style="margin-top:12px">
        <div style="font-weight:600">${t("plan.pagarTitulo", { plan: t("plan." + plan), monto: esc(texto) })}</div>
        <img src="${esc(r.qr)}" alt="Pix" class="recarga-qr">
        <div class="hint" style="margin:8px 0 4px">${t("recarga.pixCopiaCola")}</div>
        <textarea id="planCodigo" readonly rows="3"
          style="width:100%;box-sizing:border-box;font-family:monospace;font-size:11px">${esc(r.codigo)}</textarea>
        <button class="secondary" id="btnCopiarPlan" style="margin-top:6px">${t("recarga.pixCopiar")}</button>
        <!-- Después de pagar tiene que avisarnos igual que en una recarga: el
             saldo y el plan todavía los activa una persona. Cuando el banco
             avise solo, este texto se cae. -->
        <div class="hint" style="margin:10px 0 0">${t("plan.despuesDePagar")}</div>
      </div>`;

    document.getElementById("btnCopiarPlan").onclick = async () => {
      const b = document.getElementById("btnCopiarPlan");
      try {
        await navigator.clipboard.writeText(r.codigo);
        b.textContent = t("recarga.pixCopiado");
      } catch {
        document.getElementById("planCodigo").select();
      }
    };
  } catch (e) {
    destino.innerHTML = `<div class="error">${esc((e && e.error) || t("recarga.pixError"))}</div>`;
  }
}
