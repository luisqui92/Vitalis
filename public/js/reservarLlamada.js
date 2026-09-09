// Symphomed — Llamada de voz por navegador en la página pública de reserva:
// habla con el mismo asistente de Vapi que contesta llamadas telefónicas
// reales, pero por internet (micrófono del navegador), sin necesitar
// ningún número de teléfono. Es un módulo aparte, cargado como <script
// type="module"> porque el SDK de Vapi (vendorizado en /vendor/vapi/, sin
// depender de ningún CDN) usa imports de ES modules — reservarPublico.js
// sigue siendo un script plano de siempre, no hace falta tocarlo más que
// para el botón en sí (ver ahí el <button id="btnLlamarAhora">).
//
// El botón se vuelve a crear cada vez que reservarPublico.js repinta la
// tarjeta de arriba (por eso acá nunca se confía en su texto para saber el
// estado — todo el estado real vive en "llamadaActiva").
import Vapi from "/vendor/vapi/vapi-web.mjs";

let vapi = null;
let llamadaActiva = false;

function actualizarBoton() {
  const btn = document.getElementById("btnLlamarAhora");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = llamadaActiva ? "🔴 Colgar" : "📞 Hablar con el asistente";
}

async function iniciarLlamada() {
  const btn = document.getElementById("btnLlamarAhora");
  if (!btn || llamadaActiva) return;
  btn.disabled = true;
  btn.textContent = "📞 Conectando...";

  try {
    const res = await fetch("/reserva-publica/config");
    const cfg = await res.json();
    if (!cfg.configurado) {
      alert("La llamada por voz todavía no está disponible en este consultorio. Podés seguir reservando con el formulario de abajo.");
      btn.disabled = false;
      btn.textContent = "📞 Hablar con el asistente";
      return;
    }

    if (!vapi) {
      vapi = new Vapi(cfg.vapiPublicKey);
      vapi.on("call-start", () => { llamadaActiva = true; actualizarBoton(); });
      vapi.on("call-end", () => { llamadaActiva = false; actualizarBoton(); });
      vapi.on("error", (e) => {
        console.error("[VAPI WEB]", e);
        llamadaActiva = false;
        actualizarBoton();
      });
    }
    await vapi.start(cfg.vapiAssistantId);
  } catch (e) {
    console.error("[VAPI WEB] no se pudo iniciar la llamada:", e);
    llamadaActiva = false;
    alert("No se pudo iniciar la llamada — revisá que le diste permiso al micrófono e intentá de nuevo.");
    actualizarBoton();
  }
}

function colgar() {
  if (vapi) vapi.stop();
}

// Delegación en document (no en el botón directo): reservarPublico.js
// recrea el botón cada vez que repinta la tarjeta de arriba, así que un
// listener puesto directo sobre el elemento se perdería en el próximo
// repintado.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#btnLlamarAhora");
  if (!btn) return;
  if (llamadaActiva) colgar();
  else iniciarLlamada();
});
