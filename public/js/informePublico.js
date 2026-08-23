// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — El informe visto por el paciente
// ═══════════════════════════════════════════════════════════════════════════
// Lo que se abre al tocar el enlace de WhatsApp. Sin cuenta, sin contraseña,
// sin instalar nada: el paciente toca y ve su informe con el membrete del
// centro, y puede imprimirlo o guardarlo.
//
// Es la única pantalla de Vitalis que ve alguien que no es el médico, así
// que no muestra nada más que ESE informe: ni el resto de sus estudios, ni
// su teléfono, ni su historia. Tener el enlace no abre la ficha.

const RUTA_INFORME = location.pathname.match(/^\/informe\/([A-Za-z0-9_-]{20,})$/);

function esPaginaInformePublico() {
  return Boolean(RUTA_INFORME);
}

async function renderInformePublico() {
  const token = RUTA_INFORME[1];
  document.title = "Tu informe · Vitalis";
  // El encabezado, el pie y el armazón de escritorio no van: esta pantalla
  // es del paciente, no del médico. Se BORRAN del documento en vez de
  // esconderse — escondidos siguen estando ahí, y un lector de pantalla (o
  // el "ver código fuente" de cualquiera) le muestra al paciente botones de
  // una app que no es la suya.
  ["headerMobile", "escritorioShell"].forEach(id => document.getElementById(id)?.remove());
  document.querySelectorAll(".footer").forEach(f => f.remove());

  app.innerHTML = `<div class="loading"><div class="spinner"></div>Abriendo tu informe...</div>`;

  let d;
  try {
    d = await api(`/informe-publico/${token}`);
  } catch (e) {
    app.innerHTML = `
      <div class="card" style="text-align:center">
        <div style="font-size:38px;margin-bottom:8px">🔒</div>
        <div class="seccion-titulo" style="margin-top:0">${esc(e.error || "No pudimos abrir este informe")}</div>
        <div class="hint">Escribile al consultorio para que te manden un enlace nuevo.</div>
      </div>`;
    return;
  }

  // Las imágenes de esta página se sirven por el mismo token, así que van
  // como src directo: acá no hay sesión ni header de autorización.
  const urls = (d.estudios || []).map(e => ({
    url: `${API}/informe-publico/${token}/imagen/${e._id}`,
    nombre: e.nombre,
    ajustes: e.ajustesVisor,
  }));

  app.innerHTML = `
    <div class="inf-barra no-imprimir" style="position:sticky;top:0;justify-content:center">
      <button class="visor-btn" id="pubImprimir" style="background:var(--primary);color:#fff">🖨️ Imprimir / Guardar PDF</button>
    </div>
    ${hojaInformeHtml({ ...d, enlace: location.href }, urls)}
    <div class="hint no-imprimir" style="text-align:center;padding:16px 12px 40px">
      Este informe es un documento médico. Guardalo y llevalo a tu próxima consulta.
    </div>`;

  document.getElementById("pubImprimir").onclick = () => window.print();
}
