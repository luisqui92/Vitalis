// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — El informe de avance, visto por la familia
// ═══════════════════════════════════════════════════════════════════════════
// Esta pantalla la diseñó, sin saberlo, una madre de un chico con autismo
// leve. Dijo dos cosas, y las dos son restricciones de diseño, no deseos:
//
//   1. «el tema monetario» → no paga nada, no hay cuenta, no hay app.
//   2. «no saben utilizar muy bien el celular» → esto.
//
// Lo segundo es lo que decide TODO lo de acá abajo. "No sabe usar bien el
// celular" en la práctica significa: no encuentra un menú, no entiende un
// ícono sin texto, no sabe qué es una pestaña, no distingue lo que se toca
// de lo que no, y si algo se mueve o cambia solo, cree que lo rompió.
//
// Entonces:
//
// · UNA SOLA COLUMNA, DE ARRIBA A ABAJO. Se lee scrolleando y nada más.
//   Cero pestañas, cero acordeones, cero "ver más", cero menús.
//
// · UN SOLO BOTÓN EN TODA LA PÁGINA, y es opcional (guardar/imprimir).
//   Ningún elemento que parezca tocable sin serlo.
//
// · LETRA GRANDE DE VERDAD (18 px de base, títulos de 22-26). Esto lo lee
//   gente de 60 años en un teléfono barato, con la pantalla rayada, de
//   noche. No es "accesibilidad": es si se lee o no se lee.
//
// · HOJA CLARA SIEMPRE, aunque Symphomed esté en oscuro. Mismo criterio que
//   el informe con membrete: es un documento, y además se imprime — esto la
//   madre lo va a llevar a la escuela.
//
// · CERO PALABRAS DE CONSULTORIO. Ni "objetivo", ni "sesión terapéutica",
//   ni "nivel de apoyo", ni el nombre de ninguna condición. Si una frase
//   necesita que alguien la traduzca, no va.
//
// · NADA DE PORCENTAJES. "Antes había que tomarle la mano, ahora le alcanza
//   con que le señalen" se entiende, se recuerda y se cuenta. "Pasó del 60%
//   al 80%" no significa nada fuera del consultorio.

const RUTA_AVANCE = location.pathname.match(/^\/avance\/([A-Za-z0-9_-]{20,})$/);

function esPaginaInformeFamilia() {
  return Boolean(RUTA_AVANCE);
}

// "15 de julio" — sin el año, que en un período de dos meses solo estorba,
// y sin día de la semana.
function diaYMes(f) {
  try {
    return new Date(f).toLocaleDateString(localeActual(), { day: "numeric", month: "long" });
  } catch (_) { return ""; }
}

// Cómo le fue con una cosa, dicho en una o dos frases.
//
// El orden importa: primero lo que cambió (que es la noticia), después el
// detalle. Si la ayuda bajó, esa es LA frase del informe y va sola.
function fraseDeAvance(a) {
  const partes = [];
  if (a.bajoLaAyuda && a.ayudaAntes && a.ayudaAhora) {
    partes.push(`Antes lo hacía <b>${esc(a.ayudaAntes)}</b>. Ahora, <b>${esc(a.ayudaAhora)}</b>.`);
  } else if (a.ayudaSola) {
    // Frase suelta y no la otra con un prefijo pegado adelante: "Lo hace con
    // que se lo recuerden" no es castellano. Ver AYUDA_SOLA en el servicio.
    partes.push(`<b>${esc(a.ayudaSola)}</b>`);
  }
  // Las veces van en segundo lugar y en números enteros: "8 de 10" se
  // entiende sin traducir y deja ver si fueron diez intentos o dos.
  if (a.veces) partes.push(`Le salió ${esc(a.veces)} veces.`);
  if (a.sesiones) {
    partes.push(a.sesiones === 1
      ? "Lo trabajamos en un encuentro."
      : `Lo trabajamos en ${a.sesiones} encuentros.`);
  }
  return partes.join(" ");
}

function bloqueLista(titulo, items, clase) {
  if (!items || !items.length) return "";
  return `
    <section class="av-bloque ${clase || ""}">
      <h2>${esc(titulo)}</h2>
      <ul class="av-lista">${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    </section>`;
}

async function renderInformeFamilia() {
  const token = RUTA_AVANCE[1];
  // El título de la pestaña tampoco nombra nada: se ve en el historial del
  // navegador de un teléfono que en muchas casas es compartido.
  document.title = "Informe de avance";

  // El encabezado, el pie y el armazón de escritorio se BORRAN, no se
  // esconden. Escondidos siguen en el documento, y un lector de pantalla le
  // lee a la familia los botones de una app que no es la suya.
  ["headerMobile", "escritorioShell"].forEach(id => document.getElementById(id)?.remove());
  document.querySelectorAll(".footer").forEach(f => f.remove());

  app.innerHTML = `<div class="loading"><div class="spinner"></div>Abriendo el informe...</div>`;

  let d;
  try {
    d = await api(`/informe-familia/${token}`);
  } catch (e) {
    app.innerHTML = `
      <div class="av-hoja">
        <div class="av-aviso">
          <div class="av-aviso-icono">🔒</div>
          <h1>${esc(e.error || "No pudimos abrir este informe")}</h1>
          <p>Escribile al equipo que atiende a tu hijo o hija y pedile el enlace de nuevo.</p>
        </div>
      </div>`;
    return;
  }

  const i = d.informe || {};
  const periodo = (i.desde && i.hasta) ? `Del ${diaYMes(i.desde)} al ${diaYMes(i.hasta)}` : "";
  const deQuien = i.centro || i.profesional || "";

  // El orden de la página es una decisión, no un acomodo:
  //
  //   1. lo que hace bien      ← lo único que la madre mencionó del informe
  //                               que le gustó, y lo contrario de lo que le
  //                               llega siempre, que está escrito en déficit
  //   2. lo que le gusta
  //   3. en qué avanzó
  //   4. qué pueden hacer en casa
  //   5. en qué sigue trabajando el equipo
  //   6. el párrafo escrito a mano
  //
  // Lo que cuesta va después de lo que sale bien. Siempre.
  app.innerHTML = `
    <div class="av-barra no-imprimir">
      <button class="av-btn" id="avGuardar">Guardar o imprimir</button>
    </div>

    <article class="av-hoja">
      <header class="av-cabecera">
        <p class="av-eyebrow">Informe de avance</p>
        <h1>${esc(i.nombre || "")}</h1>
        ${periodo ? `<p class="av-periodo">${esc(periodo)}</p>` : ""}
      </header>

      ${bloqueLista("Lo que hace bien", i.fortalezas, "av-destacado")}
      ${bloqueLista("Lo que le gusta", i.intereses)}

      ${(i.avances || []).length ? `
        <section class="av-bloque">
          <h2>En qué avanzó</h2>
          ${i.avances.map(a => `
            <div class="av-avance">
              <h3>${esc(a.titulo || "")}${a.logrado ? ` <span class="av-logrado">¡Lo logró!</span>` : ""}</h3>
              <p>${fraseDeAvance(a)}</p>
            </div>`).join("")}
        </section>` : ""}

      ${(i.enCasa || []).length ? `
        <section class="av-bloque av-casa">
          <h2>Lo que pueden hacer en casa</h2>
          <p class="av-casa-intro">Estas son las cosas que a ${esc(String(i.nombre || "").split(" ")[0])} le funcionan acá. En casa funcionan igual.</p>
          <ul class="av-lista">${i.enCasa.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        </section>` : ""}

      ${(i.siguiendo || []).length ? `
        <section class="av-bloque">
          <h2>En qué seguimos trabajando</h2>
          <ul class="av-lista">${i.siguiendo.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        </section>` : ""}

      ${String(i.nota || "").trim() ? `
        <section class="av-bloque av-nota">
          <h2>Unas palabras del equipo</h2>
          <p>${esc(i.nota).replace(/\n+/g, "</p><p>")}</p>
        </section>` : ""}

      <footer class="av-pie">
        ${deQuien ? `<p class="av-firma">${esc(deQuien)}</p>` : ""}
        ${i.profesional && i.centro ? `<p>${esc(i.profesional)}</p>` : ""}
        <p class="av-pie-nota">
          Este informe está escrito para que se entienda sin ayuda de nadie.
          Si algo no se entiende, es nuestro error: preguntanos y te lo explicamos.
        </p>
      </footer>
    </article>

    <p class="av-guardalo no-imprimir">
      Este enlace se puede volver a abrir cuando quieras. Podés mostrárselo en la escuela o al pediatra.
    </p>`;

  document.getElementById("avGuardar").onclick = () => window.print();
}
