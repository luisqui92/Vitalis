// Symphomed — "Quiero recargar": dónde pago y cómo aviso que pagué.
//
// Vive adentro de la tarjeta de saldo. Antes ahí decía "mandanos el
// comprobante" y no decía a dónde — el médico quedaba sin saber qué hacer
// con esa frase.
//
// El flujo tiene tres estados y la pantalla muestra UNO SOLO por vez:
//
//   · sin aviso pendiente  → dónde pagar + el formulario para avisar
//   · con aviso pendiente  → "lo estamos revisando", y nada más que hacer
//   · último rechazado     → el motivo, y volver a intentar
//
// Mostrar el formulario cuando ya hay un aviso pendiente invita a avisar dos
// veces, y dos avisos del mismo pago es exactamente cómo se acredita dos
// veces la misma transferencia.

let ultimoTxid = "";

let RECARGA_DATOS = null;

async function pintarRecarga() {
  const caja = document.getElementById("recargaBox");
  if (!caja) return;
  let datos, mias;
  try {
    [datos, mias] = await Promise.all([
      api("/medico/recargas/datos-pago"),
      api("/medico/recargas"),
    ]);
  } catch {
    caja.innerHTML = "";
    return;
  }
  if (!caja.isConnected) return;
  RECARGA_DATOS = datos;

  const solicitudes = mias.solicitudes || [];
  const pendiente = solicitudes.find(s => s.estado === "pendiente");
  const ultima = solicitudes[0];

  caja.innerHTML = `
    <div class="hint" style="margin:12px 0 0">
      ${t("recarga.precioMinimo", { minimo: (datos.recargaMinimaCentavos / 100).toFixed(2) })}
    </div>
    ${pendiente ? pendienteHtml(pendiente) : ""}
    ${!pendiente && ultima && ultima.estado === "rechazada" ? rechazadaHtml(ultima) : ""}
    ${pendiente ? "" : `
      <button class="secondary" id="btnQuieroRecargar" style="margin-top:10px">${t("recarga.quiero")}</button>
      <div id="recargaDetalle" style="display:none">${dondePagarHtml(datos)}</div>`}
    ${solicitudes.length ? `
      <button class="link" id="btnMisAvisos" style="width:auto;margin-top:6px">${t("recarga.misAvisos")}</button>
      <div id="recargaHistorial" style="display:none">${historialHtml(solicitudes)}</div>` : ""}`;

  const btn = document.getElementById("btnQuieroRecargar");
  if (btn) {
    btn.onclick = () => {
      const d = document.getElementById("recargaDetalle");
      const abierto = d.style.display !== "none";
      d.style.display = abierto ? "none" : "";
      btn.textContent = abierto ? t("recarga.quiero") : t("recarga.cerrar");
      if (!abierto) { engancharFormularioRecarga(); engancharPix(); }
    };
  }
  const btnHist = document.getElementById("btnMisAvisos");
  if (btnHist) {
    btnHist.onclick = () => {
      const h = document.getElementById("recargaHistorial");
      h.style.display = h.style.display === "none" ? "" : "none";
    };
  }
  const btnCancelar = document.getElementById("btnCancelarAviso");
  if (btnCancelar) {
    btnCancelar.onclick = async () => {
      if (!confirm(t("recarga.confirmarCancelar"))) return;
      try { await api(`/medico/recargas/${pendiente._id}`, { method: "DELETE" }); } catch { /* ya revisado */ }
      pintarRecarga();
    };
  }
}

function pendienteHtml(s) {
  return `
    <div class="saldo-aviso" style="margin-top:12px">
      <div style="font-weight:600">${t("recarga.pendiente", { monto: esc(s.montoBs) })}</div>
      <div style="margin-top:4px">${t("recarga.pendienteAyuda")}</div>
      <div class="hint" style="margin:6px 0 0">${t("recarga.referencia")}: ${esc(s.referencia)}</div>
      <button class="link" id="btnCancelarAviso" style="width:auto;margin-top:8px">${t("recarga.cancelar")}</button>
    </div>`;
}

// Un rechazo sin motivo deja al médico sin saber si tiene que pagar otra vez,
// mandar otro comprobante o llamar. El servidor lo exige; acá se muestra.
function rechazadaHtml(s) {
  return `
    <div class="saldo-aviso saldo-aviso-grave" style="margin-top:12px">
      <div style="font-weight:600">${t("recarga.rechazada", { monto: esc(s.montoBs) })}</div>
      <div style="margin-top:4px">${esc(s.motivoRechazo)}</div>
    </div>`;
}

function dondePagarHtml(d) {
  if (!d.configurado) {
    return `<div class="saldo-aviso" style="margin-top:10px">${t("recarga.sinDatosPago")}</div>`;
  }
  const filas = [
    [t("recarga.banco"), d.banco],
    [t("recarga.cuenta"), d.cuenta],
    [t("recarga.titular"), d.titular],
    [t("recarga.documento"), d.documento],
  ].filter(([, v]) => v);

  return `
    <div class="card card-secundaria" style="margin-top:10px">
      <div class="seccion-titulo" style="margin-top:0">${t("recarga.paso1")}</div>
      <!-- Brasil arma su código con el monto adentro (ver services/pix.js).
           El QR fijo servía solo para R$ 100 y obligaba a pedir uno nuevo por
           cada monto distinto. En Bolivia sigue el QR del banco de siempre. -->
      ${d.pais === "br" ? `<div id="pixBox"></div>` : (d.qr ? `<img src="${esc(d.qr)}" alt="${t("recarga.qr")}" class="recarga-qr">` : "")}
      ${filas.length ? `
        <div class="recarga-datos">
          ${filas.map(([k, v]) => `
            <div class="recarga-fila"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}
        </div>` : ""}

      <div class="seccion-titulo">${t("recarga.paso2")}</div>
      <div class="hint" style="margin:0 0 10px">${t("recarga.paso2Ayuda")}</div>
      <label>${d.pais === "br" ? t("recarga.cuantoVasAPagar") : t("recarga.cuantoPagaste")}</label>
      <input id="recMonto" type="number" inputmode="decimal" min="1" step="1" placeholder="200">
      ${d.pais === "br" ? `<button class="secondary" id="btnGenerarPix" style="margin-top:8px">${t("recarga.generarPix")}</button>` : ""}
      <label>${t("recarga.referencia")}</label>
      <input id="recReferencia" type="text" placeholder="${t("recarga.referenciaPlaceholder")}" autocomplete="off">
      <div class="hint" style="margin:6px 0 0">${t("recarga.referenciaAyuda")}</div>
      <div id="recErr"></div>
      <button class="secondary" id="btnAvisarPago">${t("recarga.avisar")}</button>

      ${d.whatsapp ? `
        <div class="hint" style="margin:10px 0 0">${t("recarga.paso3")}</div>
        <a class="link" id="recWhatsapp" href="https://wa.me/${esc(d.whatsapp)}" target="_blank" rel="noopener">
          ${t("recarga.mandarComprobante")}
        </a>` : ""}
    </div>`;
}

function engancharFormularioRecarga() {
  const btn = document.getElementById("btnAvisarPago");
  if (!btn) return;
  btn.onclick = async () => {
    const err = document.getElementById("recErr");
    err.innerHTML = "";
    const bolivianos = Number(document.getElementById("recMonto").value);
    const referencia = document.getElementById("recReferencia").value.trim();
    if (!Number.isFinite(bolivianos) || bolivianos <= 0) {
      err.innerHTML = `<div class="error">${t("recarga.errMonto")}</div>`; return;
    }
    if (!referencia) { err.innerHTML = `<div class="error">${t("recarga.errReferencia")}</div>`; return; }

    btn.disabled = true;
    try {
      await api("/medico/recargas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bolivianos, referencia, txid: ultimoTxid }),
      });
      pintarRecarga();
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || t("recarga.errAvisar"))}</div>`;
    }
  };
}

function historialHtml(solicitudes) {
  return `
    <div class="clin-tabla-caja" style="margin-top:10px">
      <table class="clin-tabla">
        <thead><tr>
          <th>${t("saldo.col.fecha")}</th><th class="num">${t("saldo.col.monto")}</th><th>${t("recarga.estado")}</th>
        </tr></thead>
        <tbody>
          ${solicitudes.map(s => `
            <tr>
              <td style="white-space:nowrap">${new Date(s.createdAt).toLocaleDateString(localeActual(), { day: "2-digit", month: "2-digit" })}</td>
              <td class="num">${esc(s.montoBs)}</td>
              <td>
                ${t("recarga.estado." + s.estado)}
                ${s.estado === "rechazada" && s.motivoRechazo ? `<div class="hint" style="margin:0">${esc(s.motivoRechazo)}</div>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// ─── EL CÓDIGO PIX, CON EL MONTO QUE PUSO ─────────────────────────────────
//
// El médico escribe cuánto va a recargar y le sale el código por ESE monto.
// Antes había un QR fijo de R$ 100 y para cualquier otro monto había que
// pedirle uno nuevo al proveedor a mano — ver services/pix.js.
//
// Se muestran las dos formas porque el médico casi siempre está en el
// celular: el QR sirve si paga desde otro aparato, y "Copia e Cola" es la
// única que sirve si el banco está en el MISMO teléfono donde ve el código.
function engancharPix() {
  const btn = document.getElementById("btnGenerarPix");
  if (!btn) return;

  btn.onclick = async () => {
    const caja = document.getElementById("pixBox");
    const monto = Number(document.getElementById("recMonto").value);
    if (!Number.isFinite(monto) || monto <= 0) {
      caja.innerHTML = `<div class="error">${t("recarga.pixFaltaMonto")}</div>`;
      return;
    }
    btn.disabled = true;
    caja.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    try {
      const r = await api(`/medico/recargas/pix?centavos=${Math.round(monto * 100)}`);
      // Se guarda para mandarlo al avisar el pago. Es el identificador que va
      // DENTRO del código Pix y que después aparece en el extracto del banco:
      // sin él, el operador tiene que casar el pago por monto y nombre.
      ultimoTxid = r.txid || "";
      caja.innerHTML = `
        <div class="hint" style="margin:0 0 8px">${t("recarga.pixListo", { monto: esc(r.monto) })}</div>
        <img src="${esc(r.qr)}" alt="Pix" class="recarga-qr">
        <div class="hint" style="margin:8px 0 4px">${t("recarga.pixCopiaCola")}</div>
        <textarea id="pixCodigo" readonly rows="3"
          style="width:100%;box-sizing:border-box;font-family:monospace;font-size:11px">${esc(r.codigo)}</textarea>
        <button class="secondary" id="btnCopiarPix" style="margin-top:6px">${t("recarga.pixCopiar")}</button>`;

      document.getElementById("btnCopiarPix").onclick = async () => {
        const b = document.getElementById("btnCopiarPix");
        try {
          await navigator.clipboard.writeText(r.codigo);
          b.textContent = t("recarga.pixCopiado");
        } catch {
          // Sin permiso de portapapeles —pasa en varios navegadores del
          // celular— se selecciona para que se pueda copiar a mano, en vez
          // de no hacer nada y parecer roto.
          document.getElementById("pixCodigo").select();
        }
      };
    } catch (e) {
      caja.innerHTML = `<div class="error">${esc((e && e.error) || t("recarga.pixError"))}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
}
