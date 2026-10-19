// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — El panel del socio
// ═══════════════════════════════════════════════════════════════════════════
//
// Tres pantallas: entrar, ver cómo va el negocio, dar de alta un cliente.
//
// ═══ LO QUE ESTE PANEL NO MUESTRA, Y NO VA A MOSTRAR ═══════════════════════
//
// Un paciente. Ni el nombre, ni cuántos tiene cada cliente, ni una línea de
// historia clínica. Un socio vende Symphomed; el secreto médico no se reparte
// por la cadena comercial.
//
// Eso no depende de este archivo: el servidor no le abre ninguna ruta clínica
// al rol "socio" (ver services/auth.js). Esto es la otra mitad de la misma
// decisión — acá no está cargado el código que sabría pedir una ficha.
//
// Sin traducciones por ahora, a propósito: el socio es una figura nueva y
// todavía no hay ninguno en Brasil. El día que haya, esto se pasa a i18n
// igual que el resto. Dejarlo anotado es mejor que un i18n a medias.

const API = "";
let TOKEN = localStorage.getItem("socio_token") || "";
let NOMBRE = localStorage.getItem("socio_nombre") || "";
const app = document.getElementById("app");
const btnSalir = document.getElementById("btnSalir");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// El dinero se guarda en centavos en toda la plataforma. Acá solo se muestra.
function plata(centavos, moneda) {
  const simbolo = moneda === "BRL" ? "R$" : "Bs";
  return `${simbolo} ${((centavos || 0) / 100).toLocaleString("es-BO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fecha(f) {
  if (!f) return "—";
  const d = new Date(f);
  return isNaN(d) ? "—" : d.toLocaleDateString("es-BO");
}

async function api(ruta, opciones = {}) {
  const headers = opciones.headers || {};
  if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
  const res = await fetch(API + ruta, { ...opciones, headers });
  let datos = null;
  try { datos = await res.json(); } catch {}
  if (!res.ok) throw { status: res.status, error: (datos && datos.error) || "Error de conexión" };
  return datos;
}

function salir() {
  TOKEN = ""; NOMBRE = "";
  localStorage.removeItem("socio_token");
  localStorage.removeItem("socio_nombre");
  btnSalir.style.display = "none";
  pantallaLogin();
}
btnSalir.onclick = salir;

// ═══════════════════════════════════════════════════════════════════════════
// ENTRAR
// ═══════════════════════════════════════════════════════════════════════════
function pantallaLogin() {
  app.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Entrar como socio</div>
      <label for="loginPhone">Teléfono</label>
      <input id="loginPhone" type="tel" inputmode="tel" autocomplete="username" placeholder="Ej: 70012345">
      <label for="loginPass">Contraseña</label>
      <input id="loginPass" type="password" autocomplete="current-password">
      <div id="loginErr"></div>
      <button class="primary" id="btnEntrar">Entrar</button>
      <button class="link" id="btnOlvide" style="font-size:13px">¿Olvidaste tu contraseña?</button>
      <div class="hint">¿Sos profesional de la salud? Tu acceso es <a href="/app">app.symphomed.com</a>.</div>
    </div>`;

  const entrar = async () => {
    const btn = document.getElementById("btnEntrar");
    const err = document.getElementById("loginErr");
    err.innerHTML = "";
    btn.disabled = true;
    try {
      const r = await api("/socio/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: document.getElementById("loginPhone").value.trim(),
          password: document.getElementById("loginPass").value,
        }),
      });
      TOKEN = r.token; NOMBRE = r.nombre;
      localStorage.setItem("socio_token", TOKEN);
      localStorage.setItem("socio_nombre", NOMBRE);
      pantallaPanel();
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || "No se pudo entrar")}</div>`;
    }
  };
  document.getElementById("btnEntrar").onclick = entrar;
  document.getElementById("btnOlvide").onclick = () => pantallaOlvideClave(document.getElementById("loginPhone").value.trim());
  // Enter en cualquiera de los dos campos entra: es lo que hace todo el
  // mundo, y obligar a bajar al botón es fricción gratis.
  for (const id of ["loginPhone", "loginPass"]) {
    document.getElementById(id).onkeydown = (e) => { if (e.key === "Enter") entrar(); };
  }
}

// ═══ OLVIDÉ MI CONTRASEÑA ═══════════════════════════════════════════════════
//
// Misma ruta pública que usa el login de médico (/reseteo-clave/solicitar):
// no declara si es socio o médico, prueba las dos colecciones del lado del
// servidor. Acá tampoco se distingue "cuenta no encontrada" de "cuenta
// encontrada" — la respuesta es siempre la misma, a propósito. Ver el
// porqué junto al modelo SolicitudReseteo en db/models.js.
function pantallaOlvideClave(telefonoDeArranque) {
  app.innerHTML = `
    <div class="card">
      <div class="hint" style="margin-bottom:14px">
        Poné tu teléfono. Si la cuenta existe, un administrador va a revisar el pedido y te va a escribir por WhatsApp.
      </div>
      <label for="ocPhone">Teléfono</label>
      <input id="ocPhone" type="tel" inputmode="tel" autocomplete="username" placeholder="Ej: 70012345" value="${esc(telefonoDeArranque || "")}">
      <div id="ocErr"></div>
      <button class="primary" id="ocBtn">Pedir ayuda para entrar</button>
      <button class="link" id="ocVolver">← Volver</button>
    </div>`;
  document.getElementById("ocVolver").onclick = pantallaLogin;
  document.getElementById("ocBtn").onclick = async () => {
    const phone = document.getElementById("ocPhone").value.trim();
    const err = document.getElementById("ocErr");
    err.innerHTML = "";
    if (!phone) { err.innerHTML = `<div class="error">Poné tu teléfono</div>`; return; }
    const btn = document.getElementById("ocBtn");
    btn.disabled = true;
    try {
      await api("/reseteo-clave/solicitar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: phone }),
      });
      app.innerHTML = `
        <div class="card">
          <div class="hint">Listo. Si ese número está registrado, en un rato te escribimos por WhatsApp.</div>
          <button class="primary" id="ocVolver2" style="margin-top:14px">← Volver</button>
        </div>`;
      document.getElementById("ocVolver2").onclick = pantallaLogin;
    } catch (e) {
      // Esto SÍ puede diferir del mensaje de éxito: no dice si la cuenta
      // existe, dice que el pedido no llegó — demasiados intentos, o la red.
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || "No se pudo enviar el pedido. Probá de nuevo en un momento.")}</div>`;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL PANEL
// ═══════════════════════════════════════════════════════════════════════════
async function pantallaPanel() {
  btnSalir.style.display = "inline-flex";
  document.getElementById("headerSub").textContent = NOMBRE || "Panel de socio";
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const [resumen, cartera] = await Promise.all([
      api("/socio/resumen"),
      api("/socio/cuentas"),
    ]);
    pintarPanel(resumen, cartera.cuentas || []);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return salir();
    app.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar")}</div>`;
  }
}

function pintarPanel(r, cuentas) {
  const moneda = r.socio?.moneda || "BOB";
  const c = r.cupos || {};

  // ═══ EL NÚMERO QUE IMPORTA VA PRIMERO ════════════════════════════════════
  //
  // De todo lo que hay en esta pantalla, lo único que el socio necesita
  // saber sin buscarlo es cuántos cupos le quedan: es lo que decide si puede
  // cerrar la venta que tiene enfrente. Va arriba, grande, y cambia de color
  // cuando se está por acabar.
  const quedan = c.disponibles ?? 0;
  const color = quedan <= 0 ? "var(--danger)" : quedan <= 2 ? "var(--warning)" : "var(--success)";

  app.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="hint" style="margin:0">Cupos disponibles</div>
      <div style="font-size:52px;font-weight:700;line-height:1.1;color:${color}">${quedan}</div>
      <div class="hint" style="margin:0">
        ${c.comprados ?? 0} comprados · ${c.usados ?? 0} colocados
      </div>
      ${quedan <= 0 ? `
        <div class="error" style="margin-top:12px">
          No te quedan cupos. Escribinos para comprar más y poder seguir dando de alta clientes.
        </div>` : ""}
      ${quedan > 0 && quedan <= 2 ? `
        <div class="hint" style="color:var(--warning);margin-top:8px">
          Te quedan pocos. Conviene pedir más antes de cerrar la próxima venta.
        </div>` : ""}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Tu negocio este mes</div>
      <div class="dato-row" style="display:flex;justify-content:space-between">
        <span>Le pagás a Symphomed</span>
        <b>${plata(r.costoMensualCentavos, moneda)}</b>
      </div>
      <div class="dato-row" style="display:flex;justify-content:space-between">
        <span>Precio por cupo</span>
        <span>${plata(r.socio?.precioMayoristaCentavos, moneda)}</span>
      </div>
      <div class="dato-row" style="display:flex;justify-content:space-between">
        <span>Invertido en cupos</span>
        <span>${plata(r.invertidoCentavos, moneda)}</span>
      </div>
      <div class="hint" style="margin-bottom:0">
        Lo que vos le cobrás a cada cliente es tu precio y no lo administramos:
        acá solo está lo que le pagás a Symphomed.
      </div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Dar de alta un cliente</div>
      ${quedan <= 0
        ? `<div class="hint" style="margin-bottom:0">Necesitás cupos disponibles para dar de alta.</div>`
        : `<div style="display:flex;gap:8px;flex-wrap:wrap">
             <button class="secondary" id="btnAltaCentro" style="flex:1;min-width:140px">Un centro</button>
             <button class="secondary" id="btnAltaProfesional" style="flex:1;min-width:140px">Un profesional solo</button>
           </div>`}
      <div id="altaBox"></div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Tus clientes (${cuentas.length})</div>
      ${cuentas.length === 0
        ? `<div class="hint" style="margin-bottom:0">Todavía no diste de alta ninguno.</div>`
        : cuentas.map(cu => `
          <div class="item" style="cursor:default">
            <div class="top" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div class="nombre">${esc(cu.nombre)}</div>
              <span class="hint" style="margin:0;white-space:nowrap">
                ${cu.tipo === "clinica" ? "Centro" : "Profesional"}
              </span>
            </div>
            <div class="fecha">
              ${cu.activa ? "Activo" : "Dado de baja"}
              ${cu.ciudad ? " · " + esc(cu.ciudad) : ""}
              ${cu.contacto ? " · " + esc(cu.contacto) : ""}
              · desde ${fecha(cu.desde)}
            </div>
            ${cu.tipo === "profesional" && cu.saldoCentavos !== null ? `
              <div class="hint" style="margin:4px 0 0">
                Saldo: ${plata(cu.saldoCentavos, moneda)}
                ${cu.saldoCentavos <= 0 ? " — conviene llamarlo para que recargue" : ""}
              </div>` : ""}
            ${cu.activa ? `
              <button class="link" data-baja="${cu.tipo}:${cu.id}" style="width:auto;margin:6px 0 0;color:var(--danger)">
                Pedir la baja
              </button>` : ""}
          </div>`).join("")}
    </div>`;

  const btnCentro = document.getElementById("btnAltaCentro");
  if (btnCentro) btnCentro.onclick = () => formularioAlta("clinica");
  const btnProf = document.getElementById("btnAltaProfesional");
  if (btnProf) btnProf.onclick = () => formularioAlta("profesional");

  document.querySelectorAll("[data-baja]").forEach(b => {
    b.onclick = () => pedirBaja(b.dataset.baja);
  });
}

// ─── ALTA ─────────────────────────────────────────────────────────────────
function formularioAlta(tipo) {
  const box = document.getElementById("altaBox");
  const esCentro = tipo === "clinica";
  box.innerHTML = `
    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
      <label for="altaNombre">${esCentro ? "Nombre del centro" : "Nombre del profesional"}</label>
      <input id="altaNombre" type="text" placeholder="${esCentro ? "Ej: Centro Kinésico Movimiento" : "Ej: Dra. Ana Rojas"}">
      ${esCentro ? `
        <label for="altaCiudad">Ciudad</label>
        <input id="altaCiudad" type="text">
        <label for="altaTelefono">Teléfono</label>
        <input id="altaTelefono" type="tel" inputmode="tel">
      ` : `
        <label for="altaPhone">Teléfono (con el que va a entrar)</label>
        <input id="altaPhone" type="tel" inputmode="tel" placeholder="Ej: 70012345">
        <label for="altaPass">Contraseña inicial</label>
        <input id="altaPass" type="text" placeholder="Al menos 8 caracteres">
        <div class="hint">Se la pasás vos. Él la cambia desde Configuración cuando entre.</div>
        <label for="altaEspecialidad">Especialidad</label>
        <input id="altaEspecialidad" type="text" placeholder="Ej: Kinesiología">
      `}
      <div id="altaErr"></div>
      <button class="primary" id="btnGuardarAlta">Dar de alta</button>
      <button class="secondary" id="btnCancelarAlta">Cancelar</button>
    </div>`;
  document.getElementById("altaNombre").focus();

  document.getElementById("btnCancelarAlta").onclick = () => { box.innerHTML = ""; };
  document.getElementById("btnGuardarAlta").onclick = async () => {
    const btn = document.getElementById("btnGuardarAlta");
    const err = document.getElementById("altaErr");
    err.innerHTML = "";
    btn.disabled = true;
    const cuerpo = esCentro
      ? {
          nombre: document.getElementById("altaNombre").value,
          ciudad: document.getElementById("altaCiudad").value,
          telefono: document.getElementById("altaTelefono").value,
        }
      : {
          nombre: document.getElementById("altaNombre").value,
          phone: document.getElementById("altaPhone").value,
          password: document.getElementById("altaPass").value,
          especialidad: document.getElementById("altaEspecialidad").value,
        };
    try {
      await api(esCentro ? "/socio/clinicas" : "/socio/profesionales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      // Se recarga el panel entero: el alta gastó un cupo, y dejar el número
      // grande de arriba desactualizado es justo el dato que no puede estar
      // viejo — es el que decide si se puede cerrar la próxima venta.
      pantallaPanel();
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || "No se pudo dar de alta")}</div>`;
    }
  };
}

// ─── PEDIR LA BAJA ────────────────────────────────────────────────────────
//
// El socio PIDE, Symphomed ejecuta. No es desconfianza: adentro de esa cuenta
// hay historias clínicas de pacientes reales, y apagarla la decide quien
// responde por esos datos. Ver el comentario de routes/socio.js.
async function pedirBaja(clave) {
  const [tipo, id] = clave.split(":");
  const motivo = prompt("¿Por qué se da de baja? (opcional)") ?? null;
  if (motivo === null) return;   // canceló el diálogo
  try {
    const r = await api(`/socio/cuentas/${tipo}/${id}/baja`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    alert(r.aviso || "La baja quedó pedida.");
  } catch (e) {
    alert(e.error || "No se pudo pedir la baja");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
if (TOKEN) pantallaPanel();
else pantallaLogin();
