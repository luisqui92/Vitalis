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
  if (aviso) aviso.onclick = renderSeguridad;
}

async function pintarOperador() {
  const caja = document.getElementById("operadorBox");
  if (!caja) return;
  const e = await traerEstadoOperador();
  if (!caja.isConnected || !e.operador) { if (caja) caja.innerHTML = ""; return; }

  // Sin segundo factor no se acredita nada, y conviene decirlo acá y no
  // cuando ya escribió el monto y le rebota.
  if (!e.dosFAActivo) {
    caja.innerHTML = `
      <div class="card" style="border-color:var(--danger)">
        <div class="seccion-titulo" style="margin-top:0">${t("op.titulo")}</div>
        <div class="saldo-aviso saldo-aviso-grave">${t("op.falta2fa")}</div>
      </div>`;
    return;
  }

  caja.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">${t("op.titulo")}</div>
      <div class="hint" style="margin:0 0 10px">${t("op.ayuda", { minimo: (e.recargaMinimaCentavos / 100).toFixed(2) })}</div>
      <div id="opCola"></div>

      <div class="seccion-titulo">${t("op.buscar")}</div>
      <input id="opBuscar" type="text" placeholder="${t("op.buscarPlaceholder")}" autocomplete="off">
      <div id="opResultados"></div>
      <div id="opFicha"></div>
    </div>`;

  pintarColaSolicitudes();

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
