// Symphomed — Lo que se ve encima de la app en los videos para estudiantes
// (scripts/demo/videos_estudiantes.js): el subtítulo, la portada de cada video
// y los toques. Corre adentro de la página (addInitScript), afuera de #app:
// la app repinta #app entero y esto no se toca.
//
// window.__demoPortada (si la demo la fijó antes de cargar) se muestra apenas
// hay página, así el video empieza con la portada y no con la app cargando.
(() => {
  if (window.__demo) return;
  const CSS = `
    html{scrollbar-width:none}
    ::-webkit-scrollbar{width:0;height:0}
    #demo-capa{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    #demo-sub{position:absolute;left:14px;right:14px;top:12px;padding:12px 16px 13px;border-radius:16px;
      background:rgba(9,27,38,.92);color:#fff;font-size:16.5px;line-height:1.36;font-weight:600;letter-spacing:.05px;
      box-shadow:0 10px 28px rgba(0,0,0,.28);opacity:0;transform:translateY(-10px);transition:opacity .28s ease,transform .28s ease;text-wrap:balance}
    #demo-sub.abajo{top:auto;bottom:16px;transform:translateY(10px)}
    #demo-sub.ver{opacity:1;transform:none}
    #demo-sub em{font-style:normal;color:#7fdcff}
    .demo-onda{position:absolute;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;
      border:3px solid rgba(25,185,239,.95);background:rgba(25,185,239,.24);animation:demoOnda .62s ease-out forwards}
    @keyframes demoOnda{from{transform:scale(.3);opacity:1}to{transform:scale(1.55);opacity:0}}
    #demo-dedo{position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;
      background:rgba(9,27,38,.26);border:2px solid rgba(255,255,255,.95);box-shadow:0 3px 10px rgba(0,0,0,.28);
      opacity:0;transition:opacity .3s}
    #demo-portada{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:0 34px;
      background:radial-gradient(120% 70% at 85% 0%,#123d52 0%,#0a2230 55%,#071a25 100%);color:#fff;opacity:0;transition:opacity .45s ease}
    #demo-portada.ver{opacity:1}
    #demo-portada .marca{position:absolute;top:44px;left:34px;display:flex;align-items:center;gap:10px;font-weight:700;
      font-size:13px;letter-spacing:2.4px;text-transform:uppercase;color:rgba(255,255,255,.82)}
    #demo-portada .marca img{width:30px;height:30px;border-radius:8px}
    #demo-portada .num{font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#19b9ef}
    #demo-portada .tit{font-family:Fraunces,Georgia,serif;font-size:38px;line-height:1.08;font-weight:600;text-wrap:balance}
    #demo-portada .baj{font-size:17px;line-height:1.45;color:rgba(255,255,255,.78);max-width:30ch;text-wrap:pretty}
    #demo-portada .raya{width:44px;height:4px;border-radius:2px;background:#19b9ef}
    #demo-portada .pie{position:absolute;bottom:40px;left:34px;right:34px;font-size:13px;color:rgba(255,255,255,.55)}
    @media (prefers-reduced-motion:reduce){#demo-sub,#demo-portada,#demo-dedo{transition:none}.demo-onda{animation-duration:.01s}}`;

  let capa, sub, dedo, portada, quietoHasta = 0;
  function armar() {
    if (capa || !document.documentElement) return;
    const estilo = document.createElement("style");
    estilo.textContent = CSS;
    capa = document.createElement("div");
    capa.id = "demo-capa";
    capa.innerHTML = `<div id="demo-portada"></div><div id="demo-sub"></div><div id="demo-dedo"></div>`;
    document.documentElement.append(estilo, capa);
    sub = capa.querySelector("#demo-sub");
    dedo = capa.querySelector("#demo-dedo");
    portada = capa.querySelector("#demo-portada");
    if (window.__demoPortada) mostrarPortada(window.__demoPortada, true);
  }

  function mostrarPortada({ numero, total, titulo, bajada, carrera }, sinTransicion) {
    armar();
    portada.innerHTML = `
      <div class="marca"><img src="/logo.png" alt="">Symphomed</div>
      <div class="num">Video ${numero} de ${total} · ${carrera}</div>
      <div class="tit">${titulo}</div>
      <div class="raya"></div>
      <div class="baj">${bajada}</div>
      <div class="pie">Tutorial para estudiantes · pacientes y datos inventados</div>`;
    if (sinTransicion) { portada.style.transition = "none"; portada.classList.add("ver"); portada.offsetHeight; portada.style.transition = ""; }
    else portada.classList.add("ver");
  }

  window.__demo = {
    sub(html, abajo) {
      armar();
      sub.classList.remove("ver");
      setTimeout(() => {
        sub.innerHTML = html;
        sub.classList.toggle("abajo", Boolean(abajo));
        sub.classList.add("ver");
      }, sub.innerHTML ? 180 : 0);
    },
    sinSub() { armar(); sub.classList.remove("ver"); },
    portada(datos) { mostrarPortada(datos, false); },
    sinPortada() { armar(); portada.classList.remove("ver"); },
  };

  // Los toques: una onda donde se tocó y un dedo que sigue al puntero.
  addEventListener("pointerdown", (e) => {
    armar();
    const onda = document.createElement("div");
    onda.className = "demo-onda";
    onda.style.left = e.clientX + "px";
    onda.style.top = e.clientY + "px";
    capa.append(onda);
    setTimeout(() => onda.remove(), 700);
  }, true);
  addEventListener("pointermove", (e) => {
    armar();
    dedo.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    dedo.style.opacity = "1";
    quietoHasta = Date.now() + 1100;
    setTimeout(() => { if (Date.now() >= quietoHasta) dedo.style.opacity = "0"; }, 1150);
  }, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", armar);
  else armar();
})();
