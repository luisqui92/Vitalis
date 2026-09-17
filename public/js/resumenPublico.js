// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — El resumen visto por el médico que lo recibe (/r/<token>)
// ═══════════════════════════════════════════════════════════════════════════
//
// El paciente le pasó un enlace y este médico lo abrió con el paciente
// enfrente. Tiene dos minutos. Todo lo de acá está subordinado a eso:
//
//   · SE ABRE Y YA ESTÁ. Sin login, sin instalar, sin aceptar nada. Un paso
//     más entre el enlace y el contenido es un médico que cierra la pestaña y
//     le pregunta al paciente de memoria, que es lo que hacía antes.
//
//   · EL DOCUMENTO PRIMERO, SYMPHOMED DESPUÉS. La banda de producto va al
//     final de la página, nunca arriba. Un cartel antes de una historia
//     clínica convierte el documento en el envoltorio de un anuncio.
//
// ═══ QUÉ ES ESTA PÁGINA PARA SYMPHOMED ════════════════════════════════════
//
// Es la única puerta por la que entra un médico que nadie fue a buscar. Vino
// solo, traído por su propio paciente, y ya vio el producto funcionando sobre
// un caso que le importa. No hay demostración que consiga eso.
//
// Por eso la banda de abajo no vende: ofrece lo único que este médico quiere
// en este momento exacto, que es no tipear a este paciente de nuevo.
"use strict";

const RUTA = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{20,})$/);
const app = document.getElementById("app");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// La sesión del médico, si la hay. Es el mismo localStorage que usa la app
// —mismo origen— así que un médico que ya entró alguna vez desde este teléfono
// o esta computadora no tiene que volver a entrar para importar.
const TOKEN_MEDICO = (() => {
  try { return localStorage.getItem("salud_token") || null; } catch { return null; }
})();

async function api(ruta, opciones = {}) {
  const headers = Object.assign({}, opciones.headers);
  if (TOKEN_MEDICO) headers["Authorization"] = "Bearer " + TOKEN_MEDICO;
  const res = await fetch(ruta, { ...opciones, headers });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw datos.error ? datos : { error: "No se pudo abrir el resumen." };
  return datos;
}

function pintarError(mensaje) {
  app.innerHTML = `
    <div class="error">
      <h1>${esc(mensaje)}</h1>
      <p>Pedile un enlace nuevo a quien te lo mandó. Se genera en un toque.</p>
    </div>`;
}

// ═══ LA BANDA ══════════════════════════════════════════════════════════════
//
// Dos botones y una frase. El orden importa: el primero es lo que le sirve a
// ÉL —importar al paciente— y el segundo es enterarse de qué es esto. Al
// revés sería un anuncio con una función al lado.
//
// Y dice la verdad sobre la fila de aprobación. Prometer "empezá ahora" y que
// después haya que esperar a que alguien apruebe la cuenta es la forma más
// barata de quemar al único médico que vino solo.
function bandaHtml() {
  // Con sesión, el botón hace lo que dice. Sin sesión, la banda no finge:
  // ofrece pedir cuenta y avisa que hay una revisión en el medio. Prometer
  // «empezá ahora» y que después haya que esperar a que alguien apruebe es la
  // forma más barata de quemar al único médico que vino solo.
  return TOKEN_MEDICO ? `
    <section class="banda no-imprimir">
      <h2>Traételo a tu kardex</h2>
      <p>
        Tenés sesión de Symphomed en este aparato. Se crea la ficha con el nombre, la fecha
        de nacimiento y las alergias, y queda el enlace a este resumen adjunto. Las consultas
        de este consultorio NO se copian a la tuya: son de quien las escribió.
      </p>
      <div class="acciones" style="margin:0">
        <button class="btn primario" id="btnImportar">Importar a mi kardex</button>
      </div>
      <p class="no-imprimir" id="importeAviso" style="margin:11px 0 0"></p>
    </section>` : `
    <section class="banda no-imprimir">
      <h2>Este resumen lo generó Symphomed</h2>
      <p>
        Es la historia clínica que el consultorio lleva todos los días, que el paciente
        comparte en un toque. Si trabajás con Symphomed, una ficha como esta se trae a tu
        kardex sin volver a tipear nada.
      </p>
      <div class="acciones" style="margin:0">
        <button class="btn primario" id="btnCuenta">Quiero una cuenta</button>
        <a class="btn" href="/" target="_blank" rel="noopener">Ver qué es Symphomed</a>
      </div>
      <p style="margin:11px 0 0;font-size:13px">
        Las cuentas se revisan una por una antes de habilitarse: acá adentro hay historias
        clínicas de verdad.
      </p>
    </section>`;
}

async function renderResumen() {
  if (!RUTA) return pintarError("Este enlace no es válido.");
  document.title = "Resumen clínico";

  let d;
  try {
    d = await api(`/r/${RUTA[1]}/datos`);
  } catch (e) {
    return pintarError(e.error || "No pudimos abrir este resumen.");
  }

  const r = d.resumen || {};
  app.innerHTML = `
    <div class="acciones no-imprimir">
      <button class="btn" id="btnImprimir">Guardar o imprimir</button>
    </div>
    ${resumenVistaHtml(r.contenido, {
      firma: r.firma, compartidoEn: r.compartidoEn, generadoPor: r.generadoPor,
    })}
    ${bandaHtml()}`;

  // Guardar como PDF es imprimir a archivo, que es lo que el navegador ya
  // sabe hacer en los tres sistemas. Generarlo en el servidor sería una
  // dependencia más para llegar al mismo lugar.
  document.getElementById("btnImprimir").onclick = () => window.print();

  const btnImportar = document.getElementById("btnImportar");
  if (btnImportar) {
    btnImportar.onclick = async () => {
      const aviso = document.getElementById("importeAviso");
      btnImportar.disabled = true;
      btnImportar.textContent = "Importando…";
      try {
        const r2 = await api(`/r/${RUTA[1]}/importar`, { method: "POST" });
        btnImportar.textContent = r2.yaExistia ? "Ya estaba en tu kardex" : "Listo, está en tu kardex";
        // El enlace directo a la ficha nueva: el médico está con el paciente
        // enfrente y lo que quiere es abrirla, no buscarla en una lista.
        aviso.innerHTML = `<a class="btn" href="/app/paciente/${esc(r2.pacienteId)}">Abrir la ficha</a>`;
      } catch (e) {
        btnImportar.disabled = false;
        btnImportar.textContent = "Importar a mi kardex";
        aviso.textContent = e.error || "No se pudo importar.";
      }
    };
  }

  const btnCuenta = document.getElementById("btnCuenta");
  if (btnCuenta) {
    btnCuenta.onclick = () => {
      // Se anota el interés ANTES de irse: es el número que dice cuántos
      // médicos llegaron hasta acá, que no se ve en ningún otro lado. Sin
      // await para no demorarle la navegación por una métrica.
      fetch(`/r/${RUTA[1]}/interes`, { method: "POST" }).catch(() => {});
      // `origen` viaja para que la solicitud llegue diciendo de dónde salió.
      location.href = `/?origen=resumen&ref=${encodeURIComponent(RUTA[1])}#solicitar`;
    };
  }
}

renderResumen();
