// Symphomed — Pantalla de operador: acreditar recargas desde el celular.
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
  // ═══ DOS PEDIDOS, DOS try SEPARADOS — Y ES TODO EL ASUNTO ════════════════
  //
  // Estaban juntos en un solo try, y costó una tarde entera de diagnóstico.
  //
  // /estado contestaba perfecto: "sos operador, te falta el 2FA". Acto
  // seguido se pedía la cola, que SÍ pasa por requireOperador y sin 2FA
  // devuelve 403 — y ese 403 caía en el mismo catch, que pisaba la respuesta
  // buena y dejaba operador:false.
  //
  // O sea: la pantalla decía "esta cuenta no tiene permiso para aprobar
  // pagos" cuando el permiso estaba puesto y lo único que faltaba era el
  // segundo factor. Mandó a revisar el .env, el cwd de pm2, el orden de
  // carga de los módulos y la lista de operadores. Todo estaba bien.
  //
  // Un catch que abarca dos pedidos hace que el que falla borre lo que el
  // otro ya había averiguado.
  try {
    OPERADOR_ESTADO = await api("/medico/operador/estado");
  } catch (e) {
    // Se distingue "el servidor dijo que no sos operador" de "no pudimos
    // preguntarle": afirmar una causa sin comprobarla manda a la persona a
    // arreglar lo que no está roto.
    OPERADOR_ESTADO = { operador: false, fallo: e?.status || true, detalle: e?.error || "" };
    return OPERADOR_ESTADO;
  }

  // Las dos colas, solo si además hay 2FA: ambas rutas están protegidas
  // por el segundo factor. Se consultan por separado para que una caída en
  // pagos no esconda que hay una cuenta esperando aprobación, ni al revés.
  if (OPERADOR_ESTADO.operador && OPERADOR_ESTADO.dosFAActivo) {
    const [pagos, cuentas, reseteos, bajas] = await Promise.all([
      api("/medico/operador/solicitudes").catch(() => null),
      api("/medico/solicitudes-cuenta").catch(() => null),
      api("/medico/operador/reseteos").catch(() => null),
      api("/medico/operador/bajas").catch(() => null),
    ]);
    OPERADOR_ESTADO.pendientes = pagos?.pendientes || 0;
    OPERADOR_ESTADO.cuentasPendientes = cuentas?.pendientes?.length || 0;
    OPERADOR_ESTADO.reseteosPendientes = reseteos?.pedidos?.length || 0;
    OPERADOR_ESTADO.bajasPendientes = bajas?.pedidos?.length || 0;
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
  const pagos = e?.pendientes || 0;
  const cuentas = e?.cuentasPendientes || 0;
  const reseteos = e?.reseteosPendientes || 0;
  const bajas = e?.bajasPendientes || 0;
  if (!e?.operador || (!pagos && !cuentas && !reseteos && !bajas)) return "";
  return `
    <button type="button" class="card no-imprimir saldo-aviso-panel" id="avisoOperador" style="width:100%;text-align:left;border-color:var(--primary)">
      ${cuentas ? `<span style="display:block;font-weight:600">${t("cuentas.panelPendientes", { n: cuentas })}</span>` : ""}
      ${reseteos ? `<span style="display:block;font-weight:600">${t("op.reseteosPendientes", { n: reseteos })}</span>` : ""}
      ${bajas ? `<span style="display:block;font-weight:600">${t("op.bajasPendientes", { n: bajas })}</span>` : ""}
      ${pagos ? `<span style="display:block;font-weight:600">${t("op.panelPendientes", { n: pagos })}</span>` : ""}
      <span class="hint" style="display:block;margin:2px 0 0">${t("op.panelAyuda")}</span>
    </button>`;
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

  // Una cuenta de pagos que todavía no está en OPERADORES_SALDO no tiene a
  // dónde ir: no tiene pacientes y no tiene clínica. Mandarla al panel de
  // clínica —que es lo que hacía— la dejaba en un "Tu cuenta no está
  // asociada a ninguna clínica" que no explica nada y no se sale de ahí.
  //
  // Es exactamente el estado en que queda una cuenta recién creada, o sea
  // el primer día de la persona que va a manejar los pagos. Merece que le
  // digamos qué falta en vez de una pantalla en blanco.
  if (!e.operador && esSoloPagos()) {
    app.innerHTML = `
      <div class="card" style="border-color:var(--warning)">
        <div class="seccion-titulo" style="margin-top:0">${t("op.titulo")}</div>
        <div class="saldo-aviso">${e.fallo
          ? t("op.noPudimosVerificar", { detalle: esc(e.detalle || e.fallo) })
          : t("op.faltaPermiso")}</div>
        <button class="secondary" id="btnSalirPagos">${t("comun.salir")}</button>
      </div>`;
    document.getElementById("btnSalirPagos").onclick = logout;
    return;
  }

  // Para el resto, la pantalla simplemente no existe: se vuelve al panel en
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

    <div id="opCuentas"></div>
    <div id="opReseteos"></div>
    <div id="opBajas"></div>
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
  // Va primero y sin await, como los demás: una persona esperando que le
  // abran la cuenta es más urgente que un pago, pero si esta consulta tarda
  // no puede retrasar el resto del panel.
  pintarSolicitudesDeCuenta();
  pintarReseteos();
  pintarBajas();
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
      <div class="paciente-info" style="font-weight:600">${esc(m.simbolo || "Bs")} ${esc(m.saldoBs)}</div>
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
        ${esc(d.simbolo || "Bs")} ${esc(d.saldoBs)}
      </div>
      <div class="hint" style="margin:0 0 12px">${t("saldo.alcanzaPara", { n: d.consultasRestantes })}</div>

      <label>${t("op.monto")}</label>
      <input id="opMonto" type="number" inputmode="decimal" min="1" step="1" placeholder="200">
      <label>${t("op.referencia")}</label>
      <input id="opReferencia" type="text" placeholder="${t("op.referenciaPlaceholder")}" autocomplete="off">
      <div class="hint" style="margin:6px 0 0">${t("op.referenciaAyuda")}</div>

      <div id="opErr"></div>
      <button class="secondary" id="btnAcreditar">${t("op.acreditar")}</button>

      <div class="seccion-titulo">${t("op.planTitulo")}</div>
      <div class="hint" style="margin:0 0 8px">
        ${d.suscripcion && d.suscripcion.activa
          ? t("op.planVigente", { plan: t("plan." + d.suscripcion.plan), dias: d.suscripcion.diasRestantes })
          : t("op.planSinPlan")}
      </div>
      <div class="sol-acciones">
        <button class="secondary" data-plan="mensual" style="margin:0">
          ${t("plan.mensual")} · ${esc((d.suscripcion && d.suscripcion.precios || {}).mensualTexto || "")}
        </button>
        <button class="secondary" data-plan="anual" style="margin:0">
          ${t("plan.anual")} · ${esc((d.suscripcion && d.suscripcion.precios || {}).anualTexto || "")}
        </button>
      </div>

      <div class="seccion-titulo">${t("op.enlaceCobro")}</div>
      <div class="hint" style="margin:0 0 8px">${t("op.enlaceCobroAyuda")}</div>
      <input id="opEnlaceCobro" type="url" inputmode="url" autocomplete="off"
             placeholder="https://..." value="${esc((d.medico.cobro || {}).enlace || "")}">
      <input id="opEnlaceNota" type="text" autocomplete="off"
             placeholder="${t("op.enlaceCobroNota")}" value="${esc((d.medico.cobro || {}).nota || "")}">
      ${(d.medico.cobro || {}).actualizadoEn ? `
        <div class="hint" style="margin:6px 0 0">
          ${t("op.enlaceCobroPuesto", {
            quien: esc(d.medico.cobro.actualizadoPor || "—"),
            cuando: esc(fechaCorta(d.medico.cobro.actualizadoEn)),
          })}
        </div>` : ""}
      <div id="opEnlaceErr"></div>
      <div class="sol-acciones">
        <button class="secondary" id="btnGuardarEnlace" style="margin:0">${t("op.enlaceCobroGuardar")}</button>
        ${(d.medico.cobro || {}).enlace
          ? `<button class="secondary" id="btnQuitarEnlace" style="margin:0">${t("op.enlaceCobroQuitar")}</button>`
          : ""}
      </div>

      ${d.movimientos.length ? `
        <div class="seccion-titulo">${t("op.ultimos")}</div>
        ${movimientosHtml(d.movimientos)}` : ""}
    </div>`;

  document.getElementById("btnAcreditar").onclick = () => acreditar(false);
  caja.querySelectorAll("[data-plan]").forEach(b => {
    b.onclick = () => activarPlan(b.dataset.plan, d);
  });
  document.getElementById("btnGuardarEnlace").onclick = () => guardarEnlaceCobro(d.medico.phone, false);
  const btnQuitar = document.getElementById("btnQuitarEnlace");
  if (btnQuitar) btnQuitar.onclick = () => guardarEnlaceCobro(d.medico.phone, true);
}

// ─── PONER O QUITAR EL ENLACE DE COBRO ────────────────────────────────────
//
// Se confirma antes de guardar, mostrando el enlace y el NOMBRE del médico.
// No es exceso de ceremonia: esto define a dónde va la plata de esa persona.
// Un enlace pegado en la ficha equivocada manda a un médico a pagarle la
// cuenta de otro, y nadie se entera hasta que falta el dinero.
//
// El servidor exige https y lo audita entero, viejo y nuevo. Esto es el aviso
// de este lado.
async function guardarEnlaceCobro(phone, quitar) {
  const err = document.getElementById("opEnlaceErr");
  const enlace = quitar ? "" : document.getElementById("opEnlaceCobro").value.trim();
  const nota = quitar ? "" : document.getElementById("opEnlaceNota").value.trim();
  err.innerHTML = "";

  const nombre = (OPERADOR_ELEGIDO && OPERADOR_ELEGIDO.nombre) || phone;
  const aviso = quitar
    ? t("op.enlaceCobroConfirmarQuitar", { nombre })
    : t("op.enlaceCobroConfirmar", { nombre, enlace });
  if (!confirm(aviso)) return;

  const botones = [document.getElementById("btnGuardarEnlace"), document.getElementById("btnQuitarEnlace")].filter(Boolean);
  botones.forEach(b => { b.disabled = true; });
  try {
    await api(`/medico/operador/cuenta/${encodeURIComponent(phone)}/enlace-cobro`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enlace, nota }),
    });
    // Se vuelve a abrir la ficha para que lo que se ve sea lo que quedó
    // guardado, y no lo que se tipeó. Si el servidor normalizó o rechazó algo,
    // acá se nota.
    abrirFichaOperador(phone);
  } catch (e) {
    botones.forEach(b => { b.disabled = false; });
    err.innerHTML = `<div class="error">${esc(e.error || t("op.enlaceCobroError"))}</div>`;
  }
}

// ─── ACTIVAR UN PLAN ──────────────────────────────────────────────────────
//
// Es lo mismo que acreditar saldo —dar servicio contra un pago que alguien
// dice haber recibido— así que pide lo mismo: la referencia del comprobante,
// y una confirmación que dice el NOMBRE y hasta cuándo.
//
// El nombre y no el teléfono, por la misma razón de siempre: un número mal
// elegido no se nota releyéndolo, un nombre sí. Y acá el error es peor que
// acreditar de más, porque un plan mal dado son treinta días de servicio
// gratis que nadie va a revisar.
async function activarPlan(plan, d) {
  const err = document.getElementById("opErr");
  err.innerHTML = "";

  const referencia = document.getElementById("opReferencia").value.trim();
  if (!referencia) { err.innerHTML = `<div class="error">${t("op.errReferencia")}</div>`; return; }

  const precios = (d.suscripcion || {}).precios || {};
  const precio = plan === "anual" ? precios.anualTexto : precios.mensualTexto;
  const renueva = d.suscripcion && d.suscripcion.activa;

  if (!confirm(t(renueva ? "op.confirmarRenovar" : "op.confirmarPlan", {
    plan: t("plan." + plan), monto: precio, nombre: d.medico.nombre,
  }))) return;

  const botones = [...document.querySelectorAll("[data-plan]")];
  botones.forEach(b => { b.disabled = true; });
  try {
    const r = await api("/medico/operador/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: d.medico.phone, plan, referencia }),
    });
    err.innerHTML = `<div class="hint">${t("op.planListo", {
      plan: t("plan." + plan),
      hasta: new Date(r.hasta).toLocaleDateString(localeActual()),
    })}</div>`;
    // Se vuelve a traer la ficha para que el estado que se ve sea el guardado,
    // no el que suponemos.
    abrirFichaOperador(d.medico.phone);
  } catch (e) {
    botones.forEach(b => { b.disabled = false; });
    err.innerHTML = `<div class="error">${esc((e && e.error) || t("op.errPlan"))}</div>`;
  }
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
  const simbolo = OPERADOR_ELEGIDO.simbolo || "Bs";
  // La confirmación es la última pantalla antes de crear dinero: tiene que
  // decir el nombre Y la moneda. "¿Acreditar 200 a María?" no alcanza cuando
  // hay médicos que cobran en dos monedas distintas.
  if (!confirm(t("op.confirmar", { monto: `${simbolo} ${bolivianos.toFixed(2)}`, nombre: OPERADOR_ELEGIDO.nombre }))) return;

  btn.disabled = true;
  try {
    const r = await api("/medico/operador/acreditar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: OPERADOR_ELEGIDO.phone, bolivianos, referencia, igual }),
    });
    err.innerHTML = `<div class="hint" style="color:var(--success);font-weight:600">
      ${t("op.acreditado", { monto: `${simbolo} ${bolivianos.toFixed(2)}`, saldo: `${r.simbolo || simbolo} ${r.saldoBs}` })}</div>`;
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
      <div class="card card-secundaria op-solicitud" data-sol="${esc(s._id)}" data-simbolo="${esc(s.simbolo || "Bs")}">
        <div style="font-weight:600">${esc(s.medicoNombre || s.medicoPhone)}</div>
        <div class="hint" style="margin:2px 0 0">
          +${esc(s.medicoPhone)} · ${new Date(s.createdAt).toLocaleString(localeActual(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </div>
        <div class="saldo-monto" style="font-size:22px">${esc(s.simbolo || "Bs")} ${esc(s.montoBs)}</div>
        <div class="hint" style="margin:0">${t("recarga.referencia")}: <b>${esc(s.referencia)}</b></div>
        ${s.txid ? `
        <div class="hint" style="margin:4px 0 0">Pix: <b style="font-family:monospace;user-select:all">${esc(s.txid)}</b></div>` : ""}
        <div class="hint" style="margin:4px 0 0;${s.saldo.enNegativo ? "color:var(--danger);font-weight:600" : ""}">
          ${t("op.saldoActual", { monto: `${esc(s.saldo.simbolo || "Bs")} ${esc(s.saldo.saldoBs)}` })}${s.saldo.enNegativo ? ` — ${t("op.enNegativo")}` : ""}
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
      const simbolo = btn.closest(".op-solicitud").dataset.simbolo || "Bs";
      // La confirmación dice el monto QUE SE VA A ACREDITAR, que puede no ser
      // el que el médico declaró — es justo el número que hay que releer. Y
      // con su moneda: la cola mezcla médicos que cobran en Bs y en R$.
      if (!confirm(t("op.confirmarAprobar", { monto: `${simbolo} ${monto.toFixed(2)}`, nombre }))) return;
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
      ${(d.cargasHoy || []).map(c => escrStatCardHtml(`${c.simbolo} ${c.monto}`, t("op.res.hoy"))).join("") || escrStatCardHtml("—", t("op.res.hoy"))}
      ${(d.cargasMes || []).map(c => escrStatCardHtml(`${c.simbolo} ${c.monto}`, t("op.res.mes"))).join("") || escrStatCardHtml("—", t("op.res.mes"))}
      ${(d.consumoMes || []).map(c => escrStatCardHtml(`${c.simbolo} ${c.monto}`, t("op.res.consumo"))).join("") || escrStatCardHtml("—", t("op.res.consumo"))}
      ${escrStatCardHtml(d.cargasMes.n, t("op.res.recargas"))}
    </div>

    ${d.enNegativo.length ? `
      <div class="saldo-aviso saldo-aviso-grave" style="margin:0 0 12px">
        <div style="font-weight:600">${t("op.res.deuda", {
          monto: (d.deudaTotal || []).map(x => `${x.simbolo} ${x.monto}`).join(" + ") || "—",
          n: d.enNegativo.length,
        })}</div>
        <div class="hint" style="margin:6px 0 0">${t("op.res.deudaAyuda")}</div>
        ${d.enNegativo.map(m => `
          <div class="recarga-fila">
            <span>${esc(m.nombre)}</span><b>${esc(m.simbolo || "Bs")} ${esc(m.saldoBs)}</b>
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
                  <td class="num">${esc(c.simbolo || "Bs")} ${esc(c.montoBs)}</td>
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
// Cuál de las dos cuentas se está mirando. Vive afuera para que cambiar de
// país no cierre el formulario que se estaba editando.
let OPERADOR_PAIS_PAGO = "bo";

async function pintarDatosDePago() {
  const caja = document.getElementById("opDatosPago");
  if (!caja) return;
  let d;
  try {
    d = await api(`/medico/operador/datos-pago?pais=${encodeURIComponent(OPERADOR_PAIS_PAGO)}`);
  } catch { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  const resumen = [d.banco, d.cuenta].filter(Boolean).join(" · ") || t("op.dp.sinCargar");
  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("op.dp.titulo")}</div>

      <div class="tabs" style="grid-template-columns:repeat(2,1fr);margin:10px 0">
        <button class="tab${OPERADOR_PAIS_PAGO === "bo" ? " activo" : ""}" data-pais="bo">${t("op.dp.bolivia")}</button>
        <button class="tab${OPERADOR_PAIS_PAGO === "br" ? " activo" : ""}" data-pais="br">${t("op.dp.brasil")}</button>
      </div>

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

  caja.querySelectorAll("[data-pais]").forEach(b => {
    b.onclick = () => { OPERADOR_PAIS_PAGO = b.dataset.pais; pintarDatosDePago(); };
  });

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
          pais: OPERADOR_PAIS_PAGO,
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

// ─── SOLICITUDES DE CUENTA ────────────────────────────────────────────────
//
// Quién pidió entrar a Symphomed y todavía está esperando. Va en el mismo panel
// que los pagos porque es la misma clase de decisión —quién está adentro— y
// la toma la misma persona, con el mismo segundo factor.
//
// Se muestra ARRIBA de los pagos: alguien esperando que le abran la cuenta no
// puede trabajar; un pago sin acreditar es una demora.
async function pintarSolicitudesDeCuenta() {
  const caja = document.getElementById("opCuentas");
  if (!caja) return;

  let datos;
  try {
    datos = await api("/medico/solicitudes-cuenta");
  } catch {
    // Sin permiso o sin red: no se dibuja nada. Un cartel de error acá le
    // taparía los pagos a alguien que entró a acreditar un pago.
    caja.innerHTML = "";
    return;
  }
  if (!caja.isConnected) return;

  const pendientes = datos.pendientes || [];
  const recientes = (datos.recientes || []).map(r => `<div class="sol-item"><strong>${esc(r.nombre)}</strong> · ${t("perfil.solicitud." + (r.solicitud?.estado || r.estadoCuenta))}<br>
    ${t("perfil.revisor")}: ${esc(r.solicitud?.resueltaPor || "")} · ${esc(r.solicitud?.resueltaEn ? new Date(r.solicitud.resueltaEn).toLocaleString() : "")}
    ${r.verificacionProfesional?.referencia ? `<p>${esc(r.verificacionProfesional.metodo)} · ${esc(r.verificacionProfesional.referencia)}</p>` : ""}
    ${r.solicitud?.motivo ? `<p>${esc(r.solicitud.motivo)}</p>` : ""}</div>`).join("");
  caja.innerHTML = `<div class="card" style="border-color:var(--primary)">
    <div class="seccion-titulo">${t("cuentas.titulo", { n: pendientes.length })}</div>
    ${pendientes.length ? pendientes.map(s => solicitudCuentaHtml(s)).join("") : `<p>${t("cuentas.ninguna")}</p>`}
    ${recientes ? `<details><summary>${t("perfil.recientes")}</summary>${recientes}</details>` : ""}</div>`;

  pendientes.forEach(s => engancharSolicitudCuenta(s));
}

function solicitudCuentaHtml(s) {
  const dias = s.solicitud?.pedidaEn
    ? Math.floor((Date.now() - new Date(s.solicitud.pedidaEn)) / 86400000)
    : 0;
  return `
    <div class="sol-item" id="sol-${esc(s.phone)}">
      <div class="sol-nombre">${esc(s.nombre)}</div>
      <div class="sol-datos">
        ${t("cuentas.matricula")}: <span class="sol-matricula">${esc(s.solicitud?.matricula || s.matricula || t("cuentas.sinMatricula"))}</span><br>
        ${t("area." + (s.solicitud?.tipoEspecialidad || s.tipoEspecialidad || "medicina_general"))}${s.especialidad ? ` · ${esc(s.especialidad)}` : ""}<br>
        ${esc(s.phone)} · ${dias === 0 ? t("cuentas.hoy") : t("cuentas.hace", { dias })}
      </div>
      ${s.solicitud?.mensaje ? `<div class="sol-mensaje">${esc(s.solicitud.mensaje)}</div>` : ""}
      <p>${esc(s.googleEmail || "")} · ${t(s.telefonoVerificado ? "perfil.telefonoVerificado" : "perfil.sinTelefonoVerificado")}</p>
      ${s.solicitud?.tipo === "conversion" ? `<p><strong>${t("perfil.conversion")}</strong></p>` : ""}
      <p>${esc(s.solicitud?.profesion || "")} · ${esc(s.solicitud?.pais || "")} · ${esc(s.solicitud?.etapa || "")}</p>
      ${!s.solicitud?.pais ? `<label>${t("perfil.pais")}<input data-pais maxlength="2"></label>` : ""}
      ${!s.solicitud?.profesion ? `<label>${t("perfil.profesion")}<input data-profesion maxlength="100"></label>` : ""}
      <label>${t("perfil.metodo")}<select data-metodo><option value="">${t("perfil.seleccionar")}</option><option value="registro_oficial">${t("perfil.registroOficial")}</option><option value="revision_documental">${t("perfil.documental")}</option></select></label>
      <label>${t("perfil.referencia")}<textarea data-referencia maxlength="500" rows="3"></textarea></label>
      <label><input type="checkbox" data-identidad style="width:auto"> ${t("perfil.identidadComprobada")}</label>
      <label><input type="checkbox" data-matricula style="width:auto"> ${t("perfil.matriculaComprobada")}</label>
      <div class="sol-acciones">
        <button class="primary" data-aprobar="${esc(s.phone)}">${t("cuentas.aprobar")}</button>
        <button class="secondary" data-rechazar="${esc(s.phone)}">${t("cuentas.rechazar")}</button>
      </div>
      <div data-err="${esc(s.phone)}"></div>
    </div>`;
}

function engancharSolicitudCuenta(s) {
  const fila = document.getElementById(`sol-${s.phone}`);
  if (!fila) return;
  const errBox = fila.querySelector(`[data-err="${s.phone}"]`);
  const bloquear = (si) => fila.querySelectorAll("button").forEach(b => { b.disabled = si; });

  fila.querySelector(`[data-aprobar="${s.phone}"]`).onclick = async () => {
    // Aprobar le abre a alguien la puerta de un sistema de historias
    // clínicas. Un toque sin querer no puede hacer eso.
    if (!confirm(t("cuentas.confirmarAprobar", { nombre: s.nombre }))) return;
    bloquear(true);
    errBox.innerHTML = "";
    try {
      await api(`/medico/solicitudes-cuenta/${encodeURIComponent(s.phone)}/aprobar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: s.solicitud?.revision || "", metodo: fila.querySelector("[data-metodo]").value,
          referencia: fila.querySelector("[data-referencia]").value.trim(), identidadComprobada: fila.querySelector("[data-identidad]").checked,
          matriculaComprobada: fila.querySelector("[data-matricula]").checked, pais: fila.querySelector("[data-pais]")?.value.trim(), profesion: fila.querySelector("[data-profesion]")?.value.trim() }),
      });
      pintarSolicitudesDeCuenta();
    } catch (e) {
      bloquear(false);
      errBox.innerHTML = `<div class="error">${esc(e.error || t("cuentas.errAprobar"))}</div>`;
    }
  };

  fila.querySelector(`[data-rechazar="${s.phone}"]`).onclick = async () => {
    // El motivo es obligatorio del lado del servidor; se pide acá para no
    // hacerle descubrir el requisito con un error después de decidir.
    const motivo = prompt(t("cuentas.pedirMotivo", { nombre: s.nombre }));
    if (motivo === null) return;
    if (!motivo.trim()) { errBox.innerHTML = `<div class="error">${t("cuentas.errMotivo")}</div>`; return; }
    bloquear(true);
    errBox.innerHTML = "";
    try {
      await api(`/medico/solicitudes-cuenta/${encodeURIComponent(s.phone)}/rechazar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim(), revision: s.solicitud?.revision || "" }),
      });
      pintarSolicitudesDeCuenta();
    } catch (e) {
      bloquear(false);
      errBox.innerHTML = `<div class="error">${esc(e.error || t("cuentas.errRechazar"))}</div>`;
    }
  };
}

// ═══ RESTABLECER CONTRASEÑA ═════════════════════════════════════════════════
//
// Mismo patrón que las solicitudes de cuenta, justo arriba: una cola, dos
// botones, una confirmación que muestra el NOMBRE antes de actuar. La
// diferencia es lo que pasa DESPUÉS de aprobar — no alcanza con repintar la
// lista, porque aprobar puede fallar en mandar el WhatsApp sin que el pedido
// deje de ser válido (el enlace ya existe), y ahí el operador necesita poder
// copiarlo y mandarlo él. Mismo criterio que emitir la llave del paciente en
// public/js/compartirResumen.js.
async function pintarReseteos() {
  const caja = document.getElementById("opReseteos");
  if (!caja) return;

  let datos;
  try {
    datos = await api("/medico/operador/reseteos");
  } catch {
    caja.innerHTML = "";
    return;
  }
  if (!caja.isConnected) return;

  const pedidos = datos.pedidos || [];
  if (!pedidos.length) { caja.innerHTML = ""; return; }

  caja.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">${t("op.reseteos.titulo", { n: pedidos.length })}</div>
      ${pedidos.map(p => reseteoHtml(p)).join("")}
    </div>`;

  pedidos.forEach(p => engancharReseteo(p));
}

function reseteoHtml(p) {
  return `
    <div class="sol-item" id="rst-${esc(p._id)}">
      <div class="sol-nombre">${esc(p.nombre || p.telefono)}</div>
      <div class="sol-datos">
        ${t("op.reseteos.item", {
          tipo: t("op.reseteos.tipo." + p.tipo), telefono: esc(p.telefono),
          cuando: esc(fechaCorta(p.pedidaEn)),
        })}
      </div>
      <div class="sol-acciones">
        <button class="primary" data-aprobar="${esc(p._id)}">${t("op.reseteos.aprobar")}</button>
        <button class="secondary" data-rechazar="${esc(p._id)}">${t("op.reseteos.rechazar")}</button>
      </div>
      <div data-salida="${esc(p._id)}"></div>
    </div>`;
}

function engancharReseteo(p) {
  const fila = document.getElementById(`rst-${p._id}`);
  if (!fila) return;
  const salida = fila.querySelector(`[data-salida="${p._id}"]`);
  const bloquear = (si) => fila.querySelectorAll("button").forEach(b => { b.disabled = si; });

  fila.querySelector(`[data-aprobar="${p._id}"]`).onclick = async () => {
    // Aprobar acá manda un enlace que da acceso completo a la cuenta. La
    // misma clase de decisión que aprobar una cuenta nueva, mismo aviso.
    if (!confirm(t("op.reseteos.confirmarAprobar", { nombre: p.nombre || p.telefono }))) return;
    bloquear(true);
    salida.innerHTML = "";
    try {
      const r = await api(`/medico/operador/reseteos/${encodeURIComponent(p._id)}/aprobar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (r.enviadoA) {
        // Se saca la fila entera del panel en vez de dejarla con los botones
        // deshabilitados: ya está resuelta, y dejarla ahí invita a un
        // segundo clic que no hace nada.
        fila.remove();
        if (!document.querySelector("#opReseteos .sol-item")) pintarReseteos();
      } else {
        // El enlace existe igual, aunque WhatsApp haya fallado. Se le da al
        // operador para que lo mande él — no se pierde el pedido.
        salida.innerHTML = `
          <div class="hint" style="margin-top:6px">${esc(r.aviso || "")}</div>
          <code style="display:block;word-break:break-all;font-size:12px;margin:6px 0">${esc(r.enlace)}</code>
          <button class="secondary" data-copiar="${esc(p._id)}">${t("op.reseteos.copiar")}</button>`;
        fila.querySelector(`[data-copiar="${p._id}"]`).onclick = async (ev) => {
          try { await navigator.clipboard.writeText(r.enlace); ev.target.textContent = t("op.reseteos.copiado"); }
          catch { /* el enlace queda visible para copiarlo a mano */ }
        };
      }
    } catch (e) {
      bloquear(false);
      salida.innerHTML = `<div class="error">${esc(e.error || t("op.reseteos.errAprobar"))}</div>`;
    }
  };

  fila.querySelector(`[data-rechazar="${p._id}"]`).onclick = async () => {
    bloquear(true);
    salida.innerHTML = "";
    try {
      await api(`/medico/operador/reseteos/${encodeURIComponent(p._id)}/rechazar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      fila.remove();
      if (!document.querySelector("#opReseteos .sol-item")) pintarReseteos();
    } catch (e) {
      bloquear(false);
      salida.innerHTML = `<div class="error">${esc(e.error || t("op.reseteos.errRechazar"))}</div>`;
    }
  };
}

// ─── CIERRE DE CUENTA: la cola de pedidos ──────────────────────────────────
// Existe por 5.1.1(v) de Apple y la política de borrado de cuenta de Google
// Play — ver el comentario largo junto a SolicitudBaja en db/models.js.
// Aprobar acá apaga el acceso del médico EN EL ACTO, a diferencia de un
// reseteo: no queda un enlace pendiente que alguien más tenga que usar
// después.
async function pintarBajas() {
  const caja = document.getElementById("opBajas");
  if (!caja) return;

  let datos;
  try {
    datos = await api("/medico/operador/bajas");
  } catch {
    caja.innerHTML = "";
    return;
  }
  if (!caja.isConnected) return;

  const pedidos = datos.pedidos || [];
  if (!pedidos.length) { caja.innerHTML = ""; return; }

  caja.innerHTML = `
    <div class="card" style="border-color:var(--danger)">
      <div class="seccion-titulo" style="margin-top:0">${t("op.bajas.titulo", { n: pedidos.length })}</div>
      ${pedidos.map(p => bajaHtml(p)).join("")}
    </div>`;

  pedidos.forEach(p => engancharBaja(p));
}

function bajaHtml(p) {
  return `
    <div class="sol-item" id="baj-${esc(p._id)}">
      <div class="sol-nombre">${esc(p.nombre || p.telefono)}</div>
      <div class="sol-datos">
        ${t("op.bajas.item", { telefono: esc(p.telefono), cuando: esc(fechaCorta(p.pedidaEn)) })}
      </div>
      ${p.motivo ? `<div class="hint" style="margin:4px 0">${esc(p.motivo)}</div>` : ""}
      <div class="sol-acciones">
        <button class="primary" style="background:var(--danger);border-color:var(--danger)" data-aprobar="${esc(p._id)}">${t("op.bajas.aprobar")}</button>
        <button class="secondary" data-rechazar="${esc(p._id)}">${t("op.bajas.rechazar")}</button>
      </div>
      <div data-salida="${esc(p._id)}"></div>
    </div>`;
}

function engancharBaja(p) {
  const fila = document.getElementById(`baj-${p._id}`);
  if (!fila) return;
  const salida = fila.querySelector(`[data-salida="${p._id}"]`);
  const bloquear = (si) => fila.querySelectorAll("button").forEach(b => { b.disabled = si; });

  fila.querySelector(`[data-aprobar="${p._id}"]`).onclick = async () => {
    // Acá "aprobar" apaga la cuenta ya mismo — no hay vuelta atrás fácil
    // (habría que darla de alta de nuevo a mano), por eso el aviso es más
    // fuerte que el de un reseteo.
    if (!confirm(t("op.bajas.confirmarAprobar", { nombre: p.nombre || p.telefono }))) return;
    bloquear(true);
    salida.innerHTML = "";
    try {
      await api(`/medico/operador/bajas/${encodeURIComponent(p._id)}/aprobar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      fila.remove();
      if (!document.querySelector("#opBajas .sol-item")) pintarBajas();
    } catch (e) {
      bloquear(false);
      salida.innerHTML = `<div class="error">${esc(e.error || t("op.bajas.errAprobar"))}</div>`;
    }
  };

  fila.querySelector(`[data-rechazar="${p._id}"]`).onclick = async () => {
    bloquear(true);
    salida.innerHTML = "";
    try {
      await api(`/medico/operador/bajas/${encodeURIComponent(p._id)}/rechazar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      fila.remove();
      if (!document.querySelector("#opBajas .sol-item")) pintarBajas();
    } catch (e) {
      bloquear(false);
      salida.innerHTML = `<div class="error">${esc(e.error || t("op.bajas.errRechazar"))}</div>`;
    }
  };
}
