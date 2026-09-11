// Symphomed — Un solo bloque de marca, y sin fondo blanco.
//
// ═══ EL ERROR QUE ESTO ATAJA ══════════════════════════════════════════════
//
// public/logo.png nunca fue transparente: era un dibujo sobre blanco OPACO.
// Mientras la plataforma tuvo fondo claro no se notaba. El día que se unificó
// la paleta en oscuro, ese archivo pasó a ser un CUADRADO BLANCO en la
// cabecera de las 126 pantallas — y no hubo ni un error en ningún log, ni una
// prueba en rojo, ni nada raro en el inspector. Se veía, nada más.
//
// Esa es exactamente la clase de error que hay que comprobar con código: el
// que no avisa. Por eso acá se DECODIFICA el PNG y se miran sus píxeles, en
// vez de confiar en que el archivo esté bien porque se generó una vez.
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// ─── Un decodificador de PNG mínimo ────────────────────────────────────────
// Solo lo necesario para mirar píxeles: 8 bits, RGBA, sin entrelazado, que es
// lo que genera construir_marca.js. Si alguna vez el archivo viniera en otro
// formato, esto avisa en vez de dar por buena una lectura equivocada.
function leerPNG(archivo) {
  const b = fs.readFileSync(archivo);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("no es un PNG");
  const ancho = b.readUInt32BE(16), alto = b.readUInt32BE(20);
  const profundidad = b[24], tipo = b[25], entrelazado = b[28];
  if (profundidad !== 8 || tipo !== 6 || entrelazado !== 0) {
    throw new Error(`formato inesperado: ${profundidad} bits, tipo ${tipo}, entrelazado ${entrelazado}`);
  }

  // Juntar los IDAT, que pueden venir partidos en varios trozos.
  const trozos = [];
  let i = 8;
  while (i < b.length) {
    const largo = b.readUInt32BE(i);
    const nombre = b.toString("ascii", i + 4, i + 8);
    if (nombre === "IDAT") trozos.push(b.subarray(i + 8, i + 8 + largo));
    if (nombre === "IEND") break;
    i += largo + 12;
  }
  const crudo = zlib.inflateSync(Buffer.concat(trozos));

  // Deshacer el filtro de cada renglón. El PNG guarda cada línea como una
  // diferencia contra la de arriba o contra el píxel de la izquierda, así que
  // sin esto los valores que se leen no son los colores.
  const px = Buffer.alloc(ancho * alto * 4);
  const paso = ancho * 4;
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (paso + 1)];
    const linea = crudo.subarray(y * (paso + 1) + 1, y * (paso + 1) + 1 + paso);
    for (let x = 0; x < paso; x++) {
      const izq = x >= 4 ? px[y * paso + x - 4] : 0;
      const arr = y > 0 ? px[(y - 1) * paso + x] : 0;
      const diag = (x >= 4 && y > 0) ? px[(y - 1) * paso + x - 4] : 0;
      let v = linea[x];
      if (filtro === 1) v += izq;
      else if (filtro === 2) v += arr;
      else if (filtro === 3) v += (izq + arr) >> 1;
      else if (filtro === 4) {
        const p = izq + arr - diag;
        const pa = Math.abs(p - izq), pb = Math.abs(p - arr), pc = Math.abs(p - diag);
        v += (pa <= pb && pa <= pc) ? izq : (pb <= pc ? arr : diag);
      }
      px[y * paso + x] = v & 0xff;
    }
  }
  const en = (x, y) => { const i = (y * ancho + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  return { ancho, alto, px, en };
}

console.log("── 1. El símbolo existe y no trae fondo ──");
const SIMBOLOS = ["simbolo.webp", "simbolo-192.png", "simbolo-512.png"];
SIMBOLOS.forEach(s => verificar(`public/img/${s}`,
  fs.existsSync(path.join(RAIZ, "public", "img", s))));
// El original se queda: es de donde sale todo lo demás, y sin él
// construir_marca.js no se puede volver a correr.
verificar("y public/logo.png sigue ahí, que es el original",
  fs.existsSync(path.join(RAIZ, "public", "logo.png")));

const png = leerPNG(path.join(RAIZ, "public", "img", "simbolo-192.png"));
verificar(`el PNG es de ${png.ancho}×${png.alto} y cuadrado`, png.ancho === png.alto);

// Las cuatro esquinas: si alguna es opaca, el símbolo tiene fondo y sobre la
// paleta oscura se va a ver un rectángulo.
const esquinas = [[0, 0], [png.ancho - 1, 0], [0, png.alto - 1], [png.ancho - 1, png.alto - 1]];
const opacas = esquinas.filter(([x, y]) => png.en(x, y)[3] > 8);
verificar("las cuatro esquinas son transparentes", opacas.length === 0);
if (opacas.length) opacas.forEach(([x, y]) => console.log(`   ${x},${y} → alfa ${png.en(x, y)[3]}`));

// Y el centro, que es lo que delataba al archivo viejo: adentro del círculo
// del dibujo había blanco OPACO, no transparencia.
const c = png.en(Math.floor(png.ancho / 2), Math.floor(png.alto / 2));
const blancoOpaco = c[3] > 200 && c[0] > 235 && c[1] > 235 && c[2] > 235;
verificar("y el centro no es blanco opaco", !blancoOpaco);
if (blancoOpaco) console.log(`   el centro es rgba(${c.join(",")}) — es el error que ya se publicó`);

// Cuánto del archivo es transparente. Un logo recortado a su dibujo tiene
// bastante aire alrededor; si esto diera casi cero, es que volvió a traer
// fondo aunque las esquinas zafaran.
let transparentes = 0;
for (let i = 3; i < png.px.length; i += 4) if (png.px[i] < 8) transparentes++;
const pct = Math.round(100 * transparentes / (png.ancho * png.alto));
verificar(`${pct}% del ícono es transparente, como corresponde a un logo recortado`, pct > 15);

console.log("\n── 2. Nadie quedó apuntando al archivo con fondo ──");
// Un solo archivo que se olvide deja un cuadrado blanco en esa pantalla y en
// ninguna otra, que es más difícil de encontrar que si estuvieran todas mal.
//
// Se mira SOLO lo que se sirve —public/, vistas/, routes/ e index.html— y no
// scripts/. Los guiones de construcción y las pruebas nombran /logo.png a
// propósito: uno porque es su archivo de entrada, las otras porque explican
// de dónde viene el cambio. Buscarlo en todo el repositorio pondría esta
// prueba en rojo por sus propios comentarios.
const aRevisar = [];
(function recorrer(dir) {
  if (!fs.existsSync(dir)) return;
  if (fs.statSync(dir).isFile()) { aRevisar.push(dir); return; }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p);
    else if (/\.(js|html|webmanifest|css)$/.test(e.name)) aRevisar.push(p);
  }
})(RAIZ);
const servidos = aRevisar.filter(p => {
  const r = path.relative(RAIZ, p);
  return r === "index.html" || r.startsWith("public" + path.sep) ||
         r.startsWith("vistas" + path.sep) || r.startsWith("routes" + path.sep);
});
const rezagados = servidos.filter(p => /["'(\s]\/logo\.png/.test(fs.readFileSync(p, "utf8")));
verificar("ningún archivo sigue pidiendo /logo.png", rezagados.length === 0);
rezagados.forEach(p => console.log("   ", path.relative(RAIZ, p)));

console.log("\n── 3. El ícono de la aplicación instalada ──");
const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, "public", "manifest.webmanifest"), "utf8"));
// El nombre de este archivo es el que le queda al médico en la pantalla de
// inicio del celular. Decía "Vitalis" — el nombre anterior del producto.
verificar("dice Symphomed y no el nombre viejo",
  /Symphomed/.test(manifiesto.name) && manifiesto.short_name === "Symphomed" &&
  !/Vitalis/i.test(JSON.stringify(manifiesto)));
// Los dos íconos apuntaban al MISMO archivo de 447×425 declarando 192 y 512.
// Android lo acepta y lo escala, pero se ve blando en la pantalla de inicio.
verificar("cada tamaño declarado es un archivo de ese tamaño de verdad",
  manifiesto.icons.length === 2 &&
  manifiesto.icons.every(ic => ic.src === `/img/simbolo-${ic.sizes.split("x")[0]}.png`));
manifiesto.icons.forEach(ic => {
  const real = leerPNG(path.join(RAIZ, "public", ic.src));
  verificar(`  ${ic.src} mide ${real.ancho}px, declarado ${ic.sizes}`,
    String(real.ancho) === ic.sizes.split("x")[0]);
});
// El color de la barra del sistema cuando se abre la aplicación instalada.
// Si no acompaña a la paleta, el celular pinta una franja de otro color
// arriba de la pantalla.
verificar("el color de la barra es el de la paleta",
  manifiesto.theme_color === "#03101a" && manifiesto.background_color === "#03101a");

console.log("\n── 4. El mismo bloque de marca en los dos lados ──");
const indice = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const estilos = fs.readFileSync(path.join(RAIZ, "public", "estilos.css"), "utf8");
verificar("la plataforma usa el símbolo en la cabecera y en la barra lateral",
  /<img src="\/img\/simbolo\.webp"[^>]*class="logo"/.test(indice) &&
  /<img src="\/img\/simbolo\.webp"[^>]*class="escr-logo"/.test(indice));
// La tipografía de la marca: la de la web —Inter, caja alta, con las letras
// separadas— y no la serif que usaba antes la plataforma. Eran dos marcas
// distintas y quien venía de la página tenía que reconocerla de nuevo.
verificar("  ...y el nombre va en la tipografía de la web",
  /\.header h1\{[^}]*text-transform:uppercase[^}]*letter-spacing:2px/.test(estilos) &&
  /\.escr-marca span\{[^}]*text-transform:uppercase/.test(estilos));
// Sin esto el nombre largo —"Symphomed Neurodesarrollo"— en caja alta y
// separado no entra en un celular y empuja la página a lo ancho.
verificar("  ...y puede bajar a dos renglones, que es lo que lo salva",
  !/\.header h1\{[^}]*white-space:nowrap/.test(estilos));

for (const idioma of ["es", "pt", "en"]) {
  const v = fs.readFileSync(path.join(RAIZ, "vistas", `inicio.${idioma}.html`), "utf8");
  verificar(`[${idioma}] la página usa el mismo símbolo`,
    /<img class="logo-mark" src="\/img\/simbolo\.webp"/.test(v));
  // El diseño traía cinco puntos cian dibujados con CSS. Si quedara alguno,
  // se dibujaría ENCIMA de la imagen.
  verificar(`[${idioma}]   ...y no quedó ningún punto del diseño`,
    !/<span class="logo-mark">/.test(v));
  // Sin width y height el navegador no sabe cuánto espacio reservar hasta que
  // la imagen llega, y la barra entera salta cuando aparece. Es lo primero
  // que se ve al abrir la página, así que el salto se nota siempre.
  verificar(`[${idioma}]   ...con el tamaño puesto, para que la barra no salte`,
    /class="logo-mark"[^>]*width="34" height="34"/.test(v));
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
