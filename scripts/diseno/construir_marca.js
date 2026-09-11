// Symphomed — El símbolo de la marca, sacado del fondo blanco.
//
// ═══ QUÉ PROBLEMA RESUELVE ════════════════════════════════════════════════
//
// public/logo.png NO es transparente. Es un dibujo sobre fondo BLANCO OPACO:
// el 60% de sus píxeles son blancos y el del centro es blanco puro. Mientras
// la aplicación tuvo fondo claro no se notaba. Desde que toda la plataforma
// usa la paleta oscura (--card:#071a25), ese logo es un CUADRADO BLANCO en la
// cabecera de las 126 pantallas, y no hay ningún error en ningún lado: se ve,
// nada más.
//
// Este guion lo levanta del blanco, lo recorta a su dibujo y deja los tamaños
// que hacen falta. Es un paso de construcción, como construir_inicio.js: se
// corre cuando cambia el logo, no en cada arranque.
//
//   node scripts/diseno/construir_marca.js
//
// ═══ POR QUÉ NO ALCANZA CON "SI ES BLANCO, BORRALO" ═══════════════════════
//
// Porque el dibujo está suavizado: sus bordes no son tinta ni blanco, son
// mezclas de los dos. Borrar solo el blanco puro deja un halo blanco de un
// píxel alrededor de todo, que sobre fondo oscuro se ve como si el logo
// estuviera recortado con tijera.
//
// Lo que se hace es DESHACER la mezcla: de cada píxel se deduce cuánta tinta
// tenía y se recupera el color que tenía antes de mezclarse con el blanco.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const ENTRADA = path.join(RAIZ, "public", "logo.png");
const DESTINO = path.join(RAIZ, "public", "img");

// Los tamaños, y para qué es cada uno:
//
//   256 webp → todo lo que se ve dentro de una página (cabecera, barra
//              lateral, portada). Es el que se pide en cada visita, así que
//              es el que tiene que pesar poco.
//   192 png  → el ícono de la aplicación instalada en el celular.
//   512 png  → el mismo, en la pantalla de inicio de Android y en el favicon.
//              PNG y no webp a propósito: el manifiesto de una PWA lo lee el
//              sistema operativo, no el navegador, y ahí webp no está
//              garantizado. Se baja una sola vez al instalar.
const TAMANOS = [
  { lado: 256, formato: "webp", nombre: "simbolo.webp" },
  { lado: 192, formato: "png", nombre: "simbolo-192.png" },
  { lado: 512, formato: "png", nombre: "simbolo-512.png" },
];

(async () => {
  if (!fs.existsSync(ENTRADA)) throw new Error("no está public/logo.png");
  fs.mkdirSync(DESTINO, { recursive: true });

  const b64 = fs.readFileSync(ENTRADA).toString("base64");
  const taller = path.join(require("os").tmpdir(), "marca-symphomed.html");
  fs.writeFileSync(taller, `<img id="i" src="data:image/png;base64,${b64}">`);

  const navegador = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  const pagina = await navegador.newPage();
  await pagina.goto("file://" + taller);
  await pagina.waitForFunction(() => document.getElementById("i").complete);

  const salida = await pagina.evaluate((TAMANOS) => {
    const img = document.getElementById("i");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const im = x.getImageData(0, 0, c.width, c.height);
    const d = im.data;

    // El píxel más oscuro del dibujo marca cuánto puede llegar a alejarse del
    // blanco una tinta llena. Se MIDE en vez de suponerlo: con un valor fijo,
    // un logo más claro quedaría entero medio transparente.
    let masOscuro = 255;
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.min(d[i], d[i + 1], d[i + 2]);
      if (m < masOscuro) masOscuro = m;
    }
    const rango = 255 - masOscuro;

    // ═══ EL PISO DE LA DIVISIÓN, QUE NO ES UN DETALLE ═══════════════════════
    //
    // Recuperar el color es dividir por la cantidad de tinta. En un píxel casi
    // transparente esa cantidad es casi cero, así que la división multiplica
    // por doscientos el redondeo que ya traía el archivo original: donde
    // tendría que haber un borde suave aparecen píxeles de colores al azar.
    //
    // No se VEN —están al 2% de opacidad— pero destruyen la compresión, que
    // es justamente encontrar lo que se repite: el PNG de 512 salía en 358 KB,
    // más que el original entero. Con el piso, el color de los bordes queda
    // apenas menos exacto y el archivo baja a una fracción.
    const PISO = 0.25;
    const NADA = 0.02;  // menos que esto es fondo, no borde

    for (let i = 0; i < d.length; i += 4) {
      const m = Math.min(d[i], d[i + 1], d[i + 2]);
      let a = (255 - m) / rango;
      if (a < NADA) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
      if (a > 1) a = 1;
      const div = Math.max(a, PISO);
      for (let k = 0; k < 3; k++) {
        const v = (d[i + k] - 255 * (1 - div)) / div;
        d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      // El original trae ruido de compresión repartido por todo el degradado
      // —se generó como imagen, no como vector—. Redondear cada canal a
      // múltiplos de 4 no se distingue a simple vista sobre un degradado y le
      // devuelve al compresor algo que sí se repite.
      d[i] = d[i] & 0xfc; d[i + 1] = d[i + 1] & 0xfc; d[i + 2] = d[i + 2] & 0xfc;
      d[i + 3] = Math.round(a * 255);
    }
    x.putImageData(im, 0, 0);

    // Recorte a la tinta. El original venía en 447x425 con márgenes
    // desparejos, y un símbolo con más aire de un lado que del otro no se
    // puede alinear con el texto de al lado: queda visiblemente corrido sin
    // que se entienda por qué. Se deja CUADRADO y centrado, que además es lo
    // que pide el ícono de la aplicación instalada.
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
      if (d[(y * c.width + xx) * 4 + 3] > 10) {
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const an = x1 - x0 + 1, al = y1 - y0 + 1;
    const lado = Math.max(an, al);
    const cuadrado = document.createElement("canvas");
    cuadrado.width = cuadrado.height = lado;
    cuadrado.getContext("2d").drawImage(c, x0, y0, an, al, (lado - an) / 2, (lado - al) / 2, an, al);

    const archivos = {};
    for (const t of TAMANOS) {
      const c2 = document.createElement("canvas");
      c2.width = c2.height = t.lado;
      const x2 = c2.getContext("2d");
      x2.imageSmoothingQuality = "high";
      x2.drawImage(cuadrado, 0, 0, t.lado, t.lado);
      archivos[t.nombre] = t.formato === "webp"
        ? c2.toDataURL("image/webp", 0.93)
        : c2.toDataURL("image/png");
    }
    return { archivos, recorte: [x0, y0, an, al], masOscuro, original: [c.width, c.height] };
  }, TAMANOS);

  console.log(`origen ${salida.original.join("×")} · dibujo en ${salida.recorte.slice(2).join("×")} · tinta más oscura ${salida.masOscuro}`);
  for (const [nombre, url] of Object.entries(salida.archivos)) {
    const buf = Buffer.from(url.split(",")[1], "base64");
    fs.writeFileSync(path.join(DESTINO, nombre), buf);
    console.log(`  public/img/${nombre.padEnd(18)} ${(buf.length / 1024).toFixed(1)} KB`);
  }

  await navegador.close();
  fs.unlinkSync(taller);
  console.log("\n🏁 el símbolo, sin el fondo blanco");
})();
