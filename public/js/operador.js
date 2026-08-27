// Vitalis — Pantalla de operador: acreditar recargas desde el celular.
//
// Solo la ve quien está en OPERADORES_SALDO (ver routes/operadorSaldo.js).
// Para todos los demás esta sección no existe: no aparece atenuada ni con un
// candado, simplemente no está.
//
// El diseño de acá tiene un solo objetivo: que sea difícil acreditarle plata
// a la cuenta equivocada. Por eso no hay un campo de teléfono libre — se
// busca, se elige de una lista con nombre y saldo, y se confirma leyendo el
// nombre otra vez. Un teléfono mal tipeado no se nota; un nombre sí.

// Si esta cuenta acredita pagos. Viene del login y se guarda como el rol,
// porque el menú de escritorio se arma al CARGAR la página —antes de que
// haya podido preguntarle nada al servidor— y si no estuviera acá la sección
// de pagos no aparecería nunca en esa vista.
//
// Es solo para dibujar. El permiso lo revisa el servidor en cada pedido.
let ES_OPERADOR = Boolean(localStorage.getItem("salud_operador"));

let OPERADOR_ESTADO = null;
let OPERADOR_ELEGIDO = null;

async function traerEstadoOperador() {
  try {
    OPERADOR_ESTADO = await api("/medico/operador/estado");
    // Cuántos avisos hay esperando, para el cartel del panel. Solo se pide si
    // esta cuenta es operadora: para un médico común es una ruta que le
    // devuelve 404, y no tiene sentido gastarle un pedido.
    if (OPERADOR_ESTADO.operador) {
      const cola = await api("/medico/operador/solicitudes");
      OPERADOR_ESTADO.pendientes = cola.pendientes || 0;
    }
  } catch {
    OPERADOR_ESTADO = { operador: false };
  }
  return OPERADOR_ESTADO;
}

// ─── CARTEL EN EL PANEL PRINCIPAL ─────────────────────────────────────────
//
// Sin esto, la cola solo se ve entrando a Configuración — o sea que había que
// ACORDARSE de mirar. Y del otro lado hay un médico que ya pagó y no puede
// trabajar hasta que alguien apruebe.
//
// Aparece únicamente cuando hay algo que hacer. Un cartel permanente diciendo
// "0 avisos" se deja de ver justo el día que dice 3.
function avisoOperadorHtml() {
  const e = OPERADOR_ESTADO;
  if (!e?.operador || !e.pendientes) return "";
  return `
    <div class="card no-imprimir saldo-aviso-panel" id="avisoOperador" style="cursor:pointer;border-color:var(--primary)">
      <div style="font-weight:600">${t("op.panelPendientes", { n: e.pendientes })}</div>
      <div class="hint" style="margin:2px 0 0">${t("op.panelAyuda")}</div>
    </div>`;
}

function engancharAvisoOperador() {
  const aviso = document.getElementById("avisoOperador");
  if (aviso) aviso.onclick = renderPagos;
}

// ─── ENCABEZADO ───────────────────────────────────────────────────────────
//
// Cambia según de quién sea la pantalla. Para un médico o un director, Pagos
// es una sección más y arriba va "← volver". Para la cuenta que existe SOLO
// para aprobar pagos, esta ES su casa: no hay a dónde volver, y un botón que
// la trajera de vuelta acá sería un botón que no hace nada. Lo que sí
// necesita a mano es Configuración, porque ahí activa el segundo factor, y
// sin segundo factor no puede acreditar un centavo.
function encabezadoPagosHtml() {
  return esSoloPagos()
    ? `<button class="secondary" id="btnPagosConfig">${t("escr.nav.configuracion")}</button>`
    : `<button class="back" id="btnBack">← ${t("comun.volver")}</button>`;
}

function engancharEncabezadoPagos() {
  const config = document.getElementById("btnPagosConfig");
  if (config) config.onclick = renderSeguridad;
  const volver = document.getElementById("btnBack");
  if (volver) volver.onclick = volverAlPanel;
}

// ─── PANTALLA PROPIA ──────────────────────────────────────────────────────
//
// Los pagos tienen su lugar y no están escondidos adentro de Configuración,
// entre el 2FA, los respaldos y el idioma. Para quien administra pagos eso es
// su trabajo diario, no un ajuste que se toca una vez.
//
// Tres bloques, en el orden en que se usan: cómo va el mes, qué hay que
// aprobar hoy, y buscar a alguien puntual.
async function renderPagos() {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const e = await traerEstadoOperador();
  if (!seriePantallaVigente(serie)) return;

  // Si esta cuenta no acredita, la pantalla no existe — se vuelve al panel en
  // vez de mostrar un cartel de "no tenés permiso" para algo que no debería
  // ni haber sido visible.
  //
  // Acá no se usa volverAlPanel(): para una cuenta de pagos ESTA es su
  // pantalla, así que volverAlPanel() la traería de vuelta y quedaría dando
  // vueltas. Si perdió el permiso, el destino es el otro.
  if (!e.operador) return esSoloAdministrador() ? renderClinica() : renderDashboard();

  if (!e.dosFAActivo) {
    app.innerHTML = `
      ${encabezadoPagosHtml()}
      <div class="card" style="border-color:var(--danger)">
        <div class="seccion-titulo" style="margin-top:0">${t("op.titulo")}</div>
        <div class="saldo-aviso saldo-aviso-grave">${t("op.falta2fa")}</div>
        <button class="secondary" id="btnIrConfig">${t("op.irAConfig")}</button>
      </div>`;
    engancharEncabezadoPagos();
    document.getElementById("btnIrConfig").onclick = renderSeguridad;
    return;
  }

  app.innerHTML = `
    ${encabezadoPagosHtml()}
    <div class="seccion-titulo" style="margin-top:0">${t("op.titulo")}</div>
    <div class="hint" style="margin:0 0 12px">${t("op.ayuda", { minimo: (e.recargaMinimaCentavos / 100).toFixed(2) })}</div>

    <div id="opResumen"></div>
    <div id="opCola"></div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("op.buscar")}</div>
      <div class="hint" style="margin:0 0 10px">${t("op.buscarAyuda")}</div>
      <input id="opBuscar" type="text" placeholder="${t("op.buscarPlaceholder")}" autocomplete="off">
      <div id="opResultados"></div>
      <div id="opFicha"></div>
    </div>

    <div id="opDatosPago"></div>`;

  engancharEncabezadoPagos();
  pintarResumenPagos();
  pintarColaSolicitudes();
  pintarDatosDePago();

  const campo = document.getElementById("opBuscar");
  let temporizador = null;
  campo.oninput = () => {
    clearTimeout(temporizador);
    OPERADOR_ELEGIDO = null;
    document.getElementById("opFicha").innerHTML = "";
    const q = campo.value.trim();
    if (q.length < 3) { document.getElementById("opResultados").innerHTML = ""; return; }
    temporizador = setTimeout(() => buscarParaAcreditar(q), 350);
  };
}

async function buscarParaAcreditar(q) {
  const destino = document.getElementById("opResultados");
  if (!destino) return;
  destino.innerHTML = `<div class="hint">${t("op.buscando")}</div>`;
  let datos;
  try {
    datos = await api(`/medico/operador/buscar?q=${encodeURIComponent(q)}`);
  } catch (e) {
    destino.innerHTML = `<div class="error">${esc(e.error || t("op.errBuscar"))}</div>`;
    return;
  }
  if (!destino.isConnected) return;
  if (!datos.medicos.length) { destino.innerHTML = `<div class="hint">${t("op.sinResultados")}</div>`; return; }

  destino.innerHTML = datos.medicos.map(m => `
    <div class="item" data-op="${esc(m.phone)}">
      <div class="top"><div class="nombre">${esc(m.nombre)}</div></div>
      <div class="paciente-info">
        +${esc(m.phone)}${m.tipoEspecialidad ? ` · ${esc(m.tipoEspecialidad)}` : ""}
        ${m.activo ? "" : ` · ${t("op.inactiva")}`}
      </div>
      <div class="paciente-info" style="font-weight:600">${t("saldo.monto", { monto: esc(m.saldoBs) })}</div>
    </div>`).join("");

  destino.querySelectorAll("[data-op]").forEach(el => {
    el.onclick = () => abrirFichaOperador(el.dataset.op);
  });
}

async function abrirFichaOperador(phone) {
  const caja = document.getElementById("opFicha");
  if (!caja) return;
  document.getElementById("opResultados").innerHTML = "";
  caja.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  let d;
  try {
    d = await api(`/medico/operador/cuenta/${encodeURIComponent(phone)}`);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || t("op.errCuenta"))}</div>`;
    return;
  }
  if (!caja.isConnected) return;
  OPERADOR_ELEGIDO = d.medico;

  caja.innerHTML = `
    <div class="card card-secundaria" style="margin-top:12px">
      <div style="font-weight:600;font-size:15px">${esc(d.medico.nombre)}</div>
      <div class="hint" style="margin:2px 0 0">+${esc(d.medico.phone)}</div>
      <div class="saldo-monto" style="color:${d.enNegativo ? "var(--danger)" : "var(--primary)"};font-size:24px">
        ${t("saldo.monto", { monto: esc(d.saldoBs) })}
      </div>
      <div class="hint" style="margin:0 0 12px">${t("saldo.alcanzaPara", { n: d.consultasRestantes })}</div>

      <label>${t("op.monto")}</label>
      <input id="opMonto" type="number" inputmode="decimal" min="1" step="1" placeholder="200">
      <label>${t("op.referencia")}</label>
      <input id="opReferencia" type="text" placeholder="${t("op.referenciaPlaceholder")}" autocomplete="off">
      <div class="hint" style="margin:6px 0 0">${t("op.referenciaAyuda")}</div>

      <div id="opErr"></div>
      <button class="secondary" id="btnAcreditar">${t("op.acreditar")}</button>

      ${d.movimientos.length ? `
        <div class="seccion-titulo">${t("op.ultimos")}</div>
        ${movimientosHtml(d.movimientos)}` : ""}
    </div>`;

  document.getElementById("btnAcreditar").onclick = () => acreditar(false);
}

async function acreditar(igual) {
  const err = document.getElementById("opErr");
  const btn = document.getElementById("btnAcreditar");
  err.innerHTML = "";

  const bolivianos = Number(document.getElementById("opMonto").value);
  const referencia = document.getElementById("opReferencia").value.trim();
  if (!Number.isFinite(bolivianos) || bolivianos <= 0) {
    err.innerHTML = `<div class="error">${t("op.errMonto")}</div>`; return;
  }
  if (!referencia) { err.innerHTML = `<div class="error">${t("op.errReferencia")}</div>`; return; }

  // La confirmación dice el NOMBRE, no el teléfono. Acreditarle a la cuenta
  // equivocada es el error caro de esta pantalla, y un número mal elegido no
  // se nota releyéndolo — un nombre sí.
  if (!confirm(t("op.confirmar", { monto: bolivianos.toFixed(2), nombre: OPERADOR_ELEGIDO.nombre }))) return;

  btn.disabled = true;
  try {
    const r = await api("/medico/operador/acreditar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: OPERADOR_ELEGIDO.phone, bolivianos, referencia, igual }),
    });
    err.innerHTML = `<div class="hint" style="color:var(--success);font-weight:600">
      ${t("op.acreditado", { monto: bolivianos.toFixed(2), saldo: r.saldoBs })}</div>`;
    setTimeout(() => abrirFichaOperador(OPERADOR_ELEGIDO.phone), 1200);
  } catch (e) {
    btn.disabled = false;
    // Bajo el mínimo: se ofrece hacerlo igual, porque si la plata ya entró al
    // banco, no acreditarla es quedársela (ver services/saldo.js).
    if (e.status === 422 && !igual) {
      err.innerHTML = `
        <div class="saldo-aviso">
          ${esc(e.error || "")}
          <div style="margin-top:8px">${t("op.bajoMinimoAyuda")}</div>
        </div>
        <button class="link" id="btnAcreditarIgual" style="width:auto;color:var(--warning)">${t("op.acreditarIgual")}</button>`;
      document.getElementById("btnAcreditarIgual").onclick = () => acreditar(true);
      return;
    }
    err.innerHTML = `<div class="error">${esc(e.error || t("op.errAcreditar"))}</div>`;
  }
}

// ─── LA COLA DE AVISOS DE PAGO ────────────────────────────────────────────
//
// Es lo primero de la pantalla porque es lo que hay que hacer HOY: cada fila
// es un médico que ya pagó y todavía no puede trabajar. Los más viejos
// arriba — el que avisó ayer viene esperando más que el de recién.
//
// Cada fila muestra el saldo actual del médico, no solo lo que pidió: uno en
// negativo no está pidiendo una recarga, está pidiendo poder seguir
// atendiendo, y eso cambia con qué apuro se mira.
async function pintarColaSolicitudes() {
  const caja = document.getElementById("opCola");
  if (!caja) return;
  let d;
  try { d = await api("/medico/operador/solicitudes"); } catch { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  if (!d.solicitudes.length) {
    caja.innerHTML = `<div class="hint" style="margin:0 0 12px">${t("op.colaVacia")}</div>`;
    return;
  }

  caja.innerHTML = `
    <div class="saldo-aviso" style="margin:0 0 12px">
      <div style="font-weight:600">${t("op.colaTitulo", { n: d.pendientes })}</div>
    </div>
    ${d.solicitudes.map(s => `
      <div class="card card-secundaria op-solicitud" data-sol="${esc(s._id)}">
        <div style="font-weight:600">${esc(s.medicoNombre || s.medicoPhone)}</div>
        <div class="hint" style="margin:2px 0 0">
          +${esc(s.medicoPhone)} · ${new Date(s.createdAt).toLocaleString(localeActual(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </div>
        <div class="saldo-monto" style="font-size:22px">${t("saldo.monto", { monto: esc(s.montoBs) })}</div>
        <div class="hint" style="margin:0">${t("recarga.referencia")}: <b>${esc(s.referencia)}</b></div>
        <div class="hint" style="margin:4px 0 0;${s.saldo.enNegativo ? "color:var(--danger);font-weight:600" : ""}">
          ${t("op.saldoActual", { monto: esc(s.saldo.saldoBs) })}${s.saldo.enNegativo ? ` — ${t("op.enNegativo")}` : ""}
        </div>

        <label>${t("op.montoReal")}</label>
        <input type="number" inputmode="decimal" min="1" step="1" data-monto="${esc(s._id)}" value="${(s.montoCentavos / 100).toFixed(0)}">
        <div class="hint" style="margin:4px 0 0">${t("op.montoRealAyuda")}</div>

        <div data-err="${esc(s._id)}"></div>
        <button class="secondary" data-aprobar="${esc(s._id)}">${t("op.aprobar")}</button>
        <button class="link" data-rechazar="${esc(s._id)}" style="width:auto;color:var(--danger)">${t("op.rechazar")}</button>
      </div>`).join("")}`;

  const errDe = (id) => document.querySelector(`[data-err="${id}"]`);

  caja.querySelectorAll("[data-aprobar]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.aprobar;
      const monto = Number(document.querySelector(`[data-monto="${id}"]`).value);
      const nombre = btn.closest(".op-solicitud").querySelector("div").textContent.trim();
      // La confirmación dice el monto QUE SE VA A ACREDITAR, que puede no ser
      // el que el médico declaró — es justo el número que hay que releer.
      if (!confirm(t("op.confirmarAprobar", { monto: monto.toFixed(2), nombre }))) return;
      btn.disabled = true;
      try {
        await api(`/medico/operador/solicitudes/${id}/aprobar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bolivianos: monto }),
        });
        pintarColaSolicitudes();
      } catch (e) {
        btn.disabled = false;
        errDe(id).innerHTML = `<div class="error">${esc(e.error || t("op.errAcreditar"))}</div>`;
      }
    };
  });

  caja.querySelectorAll("[data-rechazar]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.rechazar;
      const motivo = prompt(t("op.motivoRechazo"));
      if (!motivo || !motivo.trim()) return;
      btn.disabled = true;
      try {
        await api(`/medico/operador/solicitudes/${id}/rechazar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: motivo.trim() }),
        });
        pintarColaSolicitudes();
      } catch (e) {
        btn.disabled = false;
        errDe(id).innerHTML = `<div class="error">${esc(e.error || t("op.errRechazar"))}</div>`;
      }
    };
  });
}

// ─── EL PANEL DE PAGOS ────────────────────────────────────────────────────
//
// Lo que la cola no dice: cuánto entró, cuánto se consumió y quiénes están
// trabajando en negativo. La cola es el trabajo de hoy; esto es cómo va el
// negocio.
//
// La deuda es el número que hay que mirar con atención: si crece mes a mes,
// el modelo prepago se está convirtiendo en fiado sin que nadie lo haya
// decidido.
async function pintarResumenPagos() {
  const caja = document.getElementById("opResumen");
  if (!caja) return;
  let d;
  try { d = await api("/medico/operador/resumen"); } catch { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  caja.innerHTML = `
    <div class="escr-stats" style="margin-bottom:12px">
      ${escrStatCardHtml(`Bs ${d.cargasHoy.bs}`, t("op.res.hoy"))}
      ${escrStatCardHtml(`Bs ${d.cargasMes.bs}`, t("op.res.mes"))}
      ${escrStatCardHtml(`Bs ${d.consumoMes.bs}`, t("op.res.consumo"))}
      ${escrStatCardHtml(d.cargasMes.n, t("op.res.recargas"))}
    </div>

    ${d.enNegativo.length ? `
      <div class="saldo-aviso saldo-aviso-grave" style="margin:0 0 12px">
        <div style="font-weight:600">${t("op.res.deuda", { monto: esc(d.deudaTotalBs), n: d.enNegativo.length })}</div>
        <div class="hint" style="margin:6px 0 0">${t("op.res.deudaAyuda")}</div>
        ${d.enNegativo.map(m => `
          <div class="recarga-fila">
            <span>${esc(m.nombre)}</span><b>Bs ${esc(m.saldoBs)}</b>
          </div>`).join("")}
      </div>` : ""}

    ${d.ultimasCargas.length ? `
      <button class="link" id="btnUltimasCargas" style="width:auto">${t("op.res.verCargas")}</button>
      <div id="opUltimasCargas" style="display:none">
        <div class="clin-tabla-caja" style="margin:10px 0 12px">
          <table class="clin-tabla">
            <thead><tr>
              <th>${t("saldo.col.fecha")}</th><th>${t("clin.col.medico")}</th>
              <th class="num">${t("saldo.col.monto")}</th><th>${t("recarga.referencia")}</th>
            </tr></thead>
            <tbody>
              ${d.ultimasCargas.map(c => `
                <tr>
                  <td style="white-space:nowrap">${new Date(c.createdAt).toLocaleDateString(localeActual(), { day: "2-digit", month: "2-digit" })}</td>
                  <td>${esc(c.nombre)}</td>
                  <td class="num">${esc(c.montoBs)}</td>
                  <td>
                    ${esc(c.referencia || "—")}
                    <div class="hint" style="margin:0">${t("op.res.por", { quien: esc(c.acreditadoPor || "—") })}</div>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>` : ""}`;

  const btn = document.getElementById("btnUltimasCargas");
  if (btn) {
    btn.onclick = () => {
      const t2 = document.getElementById("opUltimasCargas");
      t2.style.display = t2.style.display === "none" ? "" : "none";
    };
  }
}

// ─── DÓNDE NOS PAGAN ──────────────────────────────────────────────────────
//
// Se edita acá y no por SSH. Un número de cuenta cambia —se abre otra, cambia
// el titular— y lo que hay que cambiar entrando al servidor y reiniciando es
// lo que se queda viejo. Un número viejo son pagos que se pierden.
//
// Va al final de la pantalla, plegado: se toca una vez cada mucho tiempo, no
// tiene por qué ocupar el lugar de lo que se usa todos los días.
async function pintarDatosDePago() {
  const caja = document.getElementById("opDatosPago");
  if (!caja) return;
  let d;
  try { d = await api("/medico/operador/datos-pago"); } catch { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  const resumen = [d.banco, d.cuenta].filter(Boolean).join(" · ") || t("op.dp.sinCargar");
  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("op.dp.titulo")}</div>
      <div class="hint" style="margin:0">${t("op.dp.actual", { datos: esc(resumen) })}</div>
      <button class="link" id="btnEditarDatosPago" style="width:auto;margin-top:6px">${t("op.dp.editar")}</button>

      <div id="opDatosPagoForm" style="display:none">
        <div class="hint" style="margin:10px 0">${t("op.dp.ayuda")}</div>
        <label>${t("recarga.banco")}</label>
        <input id="dpBanco" type="text" value="${esc(d.banco || "")}">
        <label>${t("recarga.cuenta")}</label>
        <input id="dpCuenta" type="text" value="${esc(d.cuenta || "")}">
        <label>${t("recarga.titular")}</label>
        <input id="dpTitular" type="text" value="${esc(d.titular || "")}">
        <label>${t("recarga.documento")}</label>
        <input id="dpDocumento" type="text" value="${esc(d.documento || "")}">
        <label>${t("op.dp.whatsapp")}</label>
        <input id="dpWhatsapp" type="tel" value="${esc(d.whatsapp || "")}" placeholder="59162741818">
        <div class="hint" style="margin:6px 0 0">${t("op.dp.whatsappAyuda")}</div>
        <div id="dpErr"></div>
        <button class="secondary" id="btnGuardarDatosPago">${t("op.dp.guardar")}</button>
      </div>

      ${d.qr ? `
        <div class="hint" style="margin:12px 0 0">${t("op.dp.qrOk")}</div>`
        : `<div class="saldo-aviso" style="margin-top:12px">${t("op.dp.sinQr")}</div>`}
    </div>`;

  document.getElementById("btnEditarDatosPago").onclick = () => {
    const f = document.getElementById("opDatosPagoForm");
    f.style.display = f.style.display === "none" ? "" : "none";
  };

  document.getElementById("btnGuardarDatosPago").onclick = async () => {
    const btn = document.getElementById("btnGuardarDatosPago");
    const err = document.getElementById("dpErr");
    err.innerHTML = "";
    btn.disabled = true;
    try {
      await api("/medico/operador/datos-pago", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banco: document.getElementById("dpBanco").value,
          cuenta: document.getElementById("dpCuenta").value,
          titular: document.getElementById("dpTitular").value,
          documento: document.getElementById("dpDocumento").value,
          whatsapp: document.getElementById("dpWhatsapp").value,
        }),
      });
      pintarDatosDePago();
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || t("op.dp.errGuardar"))}</div>`;
    }
  };
}
