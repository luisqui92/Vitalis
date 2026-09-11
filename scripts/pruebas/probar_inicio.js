// Symphomed — Que la página de venta no se coma la aplicación, y que los tres
// idiomas estén completos.
//
// El riesgo de esta pantalla no es que se vea fea: es que se quede con la
// raíz del dominio equivocado. Si "/" empieza a devolver marketing en
// salud.chatgo.ia.bo, todos los médicos que ya usan Symphomed pierden el
// login de un despliegue al otro, y el error se ve exactamente igual que la
// página funcionando bien.
//
// El segundo riesgo, desde que son tres idiomas: que una versión se quede a
// medio traducir. Eso tampoco da error —la página se ve perfecta, con tres
// frases en inglés en medio— y lo descubre el primer médico brasileño que
// entre, que es el único visitante que no se puede permitir perder.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

const {
  IDIOMAS, RUTAS, NOMBRES, CABEZA, FRASES, AGENDA, WA_TEXTO,
  MODULOS_TXT, TECNO_TXT, FILAS, CARRUSEL_TXT, ESPECIALIDADES_EXTRA,
} = require(path.join(RAIZ, "scripts", "diseno", "textos"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const VISTAS = {};
for (const i of IDIOMAS) {
  const archivo = path.join(RAIZ, "vistas", `inicio.${i}.html`);
  VISTAS[i] = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "";
}
const vista = VISTAS.es; // la de referencia para lo que no depende del idioma

console.log("── 1. Las tres versiones existen ──");
IDIOMAS.forEach(i => verificar(`vistas/inicio.${i}.html`, VISTAS[i].length > 10000));
// El archivo de un solo idioma tiene que haber desaparecido. Si queda,
// routes/inicio.js podría seguir sirviéndolo sin que nadie se entere y la
// versión en español se congelaría mientras las otras dos avanzan.
verificar("y el inicio.html de un solo idioma ya no está",
  !fs.existsSync(path.join(RAIZ, "vistas", "inicio.html")));

console.log("\n── 2. Ninguna depende de nada de afuera ──");
// La CSP de esta página es default-src 'none' con img-src 'self' data:. Cualquier
// cosa traída de afuera cae en SILENCIO: no hay error, no hay hueco visible,
// simplemente no está. El diseño original traía la foto de Unsplash y habría
// salido un recuadro vacío en producción sin que nadie se enterara.
for (const i of IDIOMAS) {
  const v = VISTAS[i];
  // Los hreflang SÍ son absolutos y tienen que serlo: la especificación pide
  // URL completas. Se sacan antes de buscar enlaces de afuera.
  const sinAlternativas = v.replace(/<link rel="(alternate|canonical)"[^>]*>/g, "")
    .replace(/<meta property="og:url"[^>]*>/g, "");
  verificar(`[${i}] no pide imágenes ni fuentes de afuera`,
    !/src="https?:|url\(["']?https?:/.test(sinAlternativas) &&
    !/fonts\.googleapis|fonts\.gstatic/.test(sinAlternativas));
  verificar(`[${i}]   ...la foto y la tipografía están alojadas acá`,
    /\/img\/medica\.jpg/.test(v) && /\/fonts\/inter-variable\.woff2/.test(v));
  // Si hay script, tiene que llevar el marcador del nonce. Sin él no da error:
  // el navegador lo bloquea en silencio por la CSP y la página queda inerte,
  // que es exactamente como se rompió el reporte financiero en su momento.
  const scripts = (v.match(/<script/g) || []).length;
  verificar(`[${i}]   ...y los ${scripts} scripts llevan el marcador del nonce`,
    scripts === (v.match(/<script nonce="__NONCE__"/g) || []).length);
}
verificar("la foto existe de verdad",
  fs.existsSync(path.join(RAIZ, "public", "img", "medica.jpg")));
verificar("viven en vistas/, no en public/",
  !fs.existsSync(path.join(RAIZ, "public", "inicio.es.html")));

console.log("\n── 3. Cada versión está en su idioma, entera ──");
for (const i of IDIOMAS) {
  const v = VISTAS[i];
  verificar(`[${i}] declara lang="${i}"`, v.includes(`<html lang="${i}">`));
  verificar(`[${i}] el título y la descripción son los suyos`,
    v.includes(`<title>${CABEZA[i].titulo}</title>`) &&
    v.includes(`content="${CABEZA[i].descripcion}"`));

  // Lo que de verdad se rompe sin avisar: una frase que no llegó. Se comprueba
  // CADA una contra el archivo de textos, en vez de mirar tres o cuatro a ojo.
  // Los botones de WhatsApp llevan un marcador que el guion reemplaza por la
  // URL con el saludo ya traducido. Se arma igual acá para comparar la frase
  // entera: así se comprueba de paso que el saludo salga en el idioma de quien
  // lo va a escribir —si a un médico brasileño se le abre el WhatsApp con un
  // mensaje en español, la primera impresión ya se perdió—.
  const wa = "https://wa.me/59164637067?text=" + encodeURIComponent(WA_TEXTO[i]);
  const perdidas = FRASES
    .map(([, versiones]) => versiones[i].split("__WA__").join(wa))
    .filter(t => !v.includes(t));
  verificar(`[${i}] las ${FRASES.length} frases del diseño llegaron`, perdidas.length === 0);
  if (perdidas.length) perdidas.slice(0, 5).forEach(p => console.log("     falta:", p.slice(0, 60)));

  // Los siete módulos del carrusel, con su titular y su texto.
  const modulosPerdidos = MODULOS_TXT[i].filter(([k, t, p]) =>
    !v.includes(k) || !v.includes(t) || !v.includes(p));
  verificar(`[${i}] los 7 módulos del carrusel`, modulosPerdidos.length === 0);
  if (modulosPerdidos.length) modulosPerdidos.forEach(m => console.log("     falta módulo:", m[0]));

  // Las etiquetas de adentro de las maquetas. Se me habían quedado en español:
  // la pantalla se veía traducida por fuera y decía "Altura uterina" en la
  // versión inglesa, que es peor que no traducir.
  const filasPerdidas = Object.entries(FILAS)
    .flatMap(([que, porIdioma]) => porIdioma[i].map(([r]) => [que, r]))
    .filter(([, r]) => !v.includes(`<label>${r}</label>`));
  verificar(`[${i}] las etiquetas de adentro de las maquetas`, filasPerdidas.length === 0);
  if (filasPerdidas.length) filasPerdidas.forEach(([q, r]) => console.log(`     falta ${q}: ${r}`));

  // Las seis fichas de tecnología, con su resumen completo.
  const tecnoPerdidas = TECNO_TXT[i].filter(([n, d]) => !v.includes(`<b>${n}</b><p>${d}</p>`));
  verificar(`[${i}] las 6 fichas de tecnología, con su resumen`, tecnoPerdidas.length === 0);
  if (tecnoPerdidas.length) tecnoPerdidas.forEach(t => console.log("     falta ficha:", t[0]));

  // La agenda, que el diseño no traía y se agrega desde el guion: es justo lo
  // que se pierde sin ruido en una reconstrucción.
  const a = AGENDA[i];
  verificar(`[${i}] la agenda: los 3 pasos y los 5 recordatorios`,
    v.includes(a.eyebrow) && a.pasos.every(([, t, p]) => v.includes(t) && v.includes(p)) &&
    a.recuerda.every(([q, c]) => v.includes(`<b>${q}</b><span>${c}</span>`)));

  // Psicología y psiquiatría no venían en el diseño. Se insertan buscando el
  // bloque de Veterinary EN INGLÉS, porque la regla corre antes de traducirlo:
  // buscarlo traducido no falla —no encuentra nada y las dos especialidades
  // desaparecen sin que nadie avise. Ya pasó una vez.
  verificar(`[${i}] psicología y psiquiatría están`,
    ESPECIALIDADES_EXTRA[i].every(([, n]) => v.includes(`</div>${n}</div>`)));

  // Y lo que se escucha, no lo que se lee: quien navega con lector de pantalla
  // oiría "Ir al módulo 3" en español en medio de una página en inglés.
  const c = CARRUSEL_TXT[i];
  verificar(`[${i}] las etiquetas del carrusel para el lector de pantalla`,
    v.includes(`aria-label="${c.region}"`) && v.includes(`aria-label="${c.anterior}"`) &&
    v.includes(`aria-label="${c.siguiente}"`) && v.includes(`data-ir="${c.irA}"`));
}

console.log("\n── 4. Que se pueda cambiar de idioma y que Google entienda ──");
for (const i of IDIOMAS) {
  const v = VISTAS[i];
  // Enlaces de verdad y no un desplegable con JavaScript: un médico brasileño
  // que caiga en la versión española tiene que poder cambiarla aunque el
  // script no haya corrido, y un buscador tiene que poder seguirlos.
  verificar(`[${i}] el selector lleva a los tres idiomas`,
    IDIOMAS.every(j => v.includes(`<a href="${RUTAS[j]}" hreflang="${j}" lang="${j}"`)));
  verificar(`[${i}]   ...y marca cuál se está viendo`,
    v.includes(`lang="${i}" aria-current="page">${NOMBRES[i]}</a>`));
  // Sin hreflang, Google ve tres páginas parecidas y adivina cuál mostrarle a
  // quién — o decide que dos son la misma y se queda con una sola. Las tres
  // se apuntan entre sí, incluida a sí misma: es lo que pide la especificación
  // y lo que más fácil se olvida.
  verificar(`[${i}] los tres hreflang, el x-default y el canonical`,
    IDIOMAS.every(j => v.includes(`<link rel="alternate" hreflang="${j}" href="https://symphomed.com${RUTAS[j]}">`)) &&
    v.includes('hreflang="x-default"') &&
    v.includes(`<link rel="canonical" href="https://symphomed.com${RUTAS[i]}">`));
}
// El selector NO se puede esconder en el celular: antes sí, cuando no hacía
// nada. Ahora es la única forma de cambiar de versión, y esconderlo justo
// donde entra la mitad del tráfico dejaría al visitante atrapado.
verificar("y el selector no se esconde en el celular",
  !/\.nav \.navright span\{display:none\}/.test(vista));
// Lo que sí se saca en el celular es el botón de la barra, y hace falta: con
// el selector puesto, a 390px la .navright medía 247px y terminaba 22px
// afuera de la pantalla. Ese desborde es el que pinta la franja blanca al
// costado de TODA la página, y ya se publicó así una vez.
// Se saca ese botón y no el selector porque es el único de los tres que se
// repite —la misma llamada está en la portada y otra vez al cierre—, y porque
// su ancho cambia con el idioma ("Escríbanos", "Fale conosco", "Talk to us"),
// así que apretarlo unos píxeles no dejaría margen.
verificar("  ...y el botón de la barra sí, que es lo que no entraba",
  /\.nav \.navright \.btn\{display:none\}/.test(vista));
verificar("  ...sin perder la llamada: está dos veces más abajo",
  (vista.match(/class="btn btn-primary"/g) || []).length >= 3);

console.log("\n── 5. El carrusel anda sin JavaScript ──");
// Las láminas se desplazan con overflow-x + scroll-snap, no con el script.
// Eso es lo que hace que, si el script no corriera, se pierdan las flechas y
// NO los siete módulos. Un carrusel hecho a fuerza de JavaScript dejaría la
// sección vacía sin ningún error visible.
verificar("las láminas se desplazan solas", /\.pistas\{[^}]*overflow-x:auto/.test(vista));
verificar("  ...y encajan de a una",
  /scroll-snap-type:x mandatory/.test(vista) && /scroll-snap-align:start/.test(vista));
IDIOMAS.forEach(i => verificar(`[${i}] ninguna lámina nace oculta y están las 7`,
  !/class="modulo"[^>]*\bhidden\b/.test(VISTAS[i]) &&
  (VISTAS[i].match(/class="modulo"/g) || []).length === 7));

console.log("\n── 6. Las fichas de tecnología, sin regalar el cómo ──");
// Cada ficha dice QUÉ LOGRA, nunca cómo está hecho. Nombrar un proveedor
// —el de transcripción, el del modelo, el de la receta digital— le entrega a
// un competidor el atajo entero y no le aporta nada al médico que está
// decidiendo si probar. Por eso se comprueba, y no se deja a la memoria.
const proveedores = ["assemblyai", "openai", "gpt-", "anthropic", "memed", "vapi", "daily.co", "twilio"];
for (const i of IDIOMAS) {
  const visible = VISTAS[i].replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const filtrados = proveedores.filter(p => visible.toLowerCase().includes(p));
  verificar(`[${i}] no se nombra a ningún proveedor`, filtrados.length === 0);
  if (filtrados.length) console.log("   aparecen:", filtrados.join(", "));
}
verificar("se llega con el teclado", /\.tecno:focus-visible\b/.test(vista));
// Sin el script el visitante tiene que poder leer los SEIS. Por eso el HTML
// llega con los seis visibles y es el script el que oculta cinco: al revés
// —cinco ocultos en el marcado— quien no ejecute JavaScript vería un solo
// resumen y cinco pestañas que no hacen nada.
verificar("y sin JavaScript se leen los seis",
  !/<div class="det" data-oculto/.test(vista) && /\[data-oculto\]\{display:none\}/.test(vista));

console.log("\n── 7. Las secciones y sus anclas ──");
// El menú de arriba es la única navegación que tiene la página. Un enlace a
// una sección renombrada no da error: no lleva a ningún lado, y eso solo se
// descubre tocándolo. Ya pasó al traducir los identificadores del diseño.
for (const i of IDIOMAS) {
  const v = VISTAS[i];
  const anclas = [...v.matchAll(/href="#([a-z0-9-]+)"/g)].map(m => m[1]);
  const ids = [...v.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]);
  const rotas = [...new Set(anclas)].filter(a => !ids.includes(a));
  verificar(`[${i}] todas las anclas llevan a una sección que existe`, rotas.length === 0);
  if (rotas.length) console.log("   rotas:", rotas.join(", "));
  // Los identificadores quedan en español en los tres idiomas: son anclas, no
  // texto que alguien lea. Traducirlos daría tres juegos de enlaces distintos.
  verificar(`[${i}]   ...y son las mismas secciones en los tres idiomas`,
    ["plataforma", "agenda", "especialidades", "soluciones", "tecnologia", "confianza", "demo"]
      .every(s => v.includes(`id="${s}"`)));
  verificar(`[${i}] hay enlace al mapa y a dónde escribir`,
    /href="\/mapa"/.test(v) && /wa\.me\/\d{8,}/.test(v));
}
// El panel de Symphomed Pet lleva .panel-light Y .pet: la segunda lo pinta
// oscuro sin cambiar el color del texto, así que quedaba tinta casi negra
// sobre fondo casi negro. Se ve perfecto en el inspector y no se lee nada.
verificar("el panel de Pet tiene color de texto propio", /\.pet\{[^}]*color:#fff/.test(vista));

console.log("\n── 8. Que no se desborde en el celular ──");
// Esto se publicó roto una vez. El diseño traía dos filas flex sin
// flex-wrap (.scale y .footerlinks) que a 402px pedían 511px y 458px.
//
// Lo grave no es que se vean apretadas: el documento entero se vuelve más
// ancho que la pantalla, y como los fondos de sección solo pintan hasta el
// ancho de la VENTANA, aparece una franja blanca al costado de TODA la
// página. Parece que el sitio está roto, y la causa está a cinco secciones
// de distancia de donde se nota.
//
// La comprobación de verdad es abrirla en un navegador angosto —esto solo
// verifica que las reglas que lo arreglan sigan puestas, porque la página se
// regenera desde scripts/diseno/ y es fácil perderlas en una reconstrucción.
verificar("las filas que no entraban ahora envuelven",
  /\.scale\{flex-wrap:wrap/.test(vista) && /\.footerlinks\{flex-wrap:wrap/.test(vista));
verificar("la maqueta del consultorio puede achicarse",
  /\.screen-body\{grid-template-columns:84px minmax\(0,1fr\)\}/.test(vista));
verificar("y hay cinturón de seguridad contra un desborde nuevo",
  /html\{overflow-x:hidden\}/.test(vista));

(async () => {
  const express = require("express");
  const app = express();
  process.env.DOMINIOS_LANDING = "symphomed.com,www.symphomed.com";
  require(path.join(RAIZ, "routes", "inicio"))(app);
  // Lo que haría index.js después: la aplicación de siempre en la raíz, y
  // ahora también en /app. Esto es un doble — que acá funcione no prueba que
  // index.js lo tenga, por eso se comprueba aparte más abajo.
  app.get(["/", "/app", "/pt", "/en", "/veterinaria"],
    (_q, res) => res.type("html").send("<!doctype html><title>LA APLICACION</title>"));

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const pedir = (ruta, host, cabeceras = {}) => new Promise(res => {
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: "GET",
      headers: Object.assign(host ? { Host: host } : {}, cabeceras),
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => res({ estado: r.statusCode, texto: t, cab: r.headers })); });
    req.on("error", () => res({ estado: 0, texto: "" }));
    req.end();
  });

  // Se reconoce por la estructura y no por una frase: el texto de la página se
  // reescribe seguido, y una prueba atada a la copia se pone roja cada vez que
  // se corrige una palabra. Lo que no cambia es que la página de venta tiene
  // portada y la aplicación no.
  const esLanding = (r) => /class="hero"/.test(r.texto);
  const esApp = (r) => /LA APLICACION/.test(r.texto);
  const idiomaDe = (r) => (r.texto.match(/<html lang="(\w\w)">/) || [])[1];

  console.log("\n── 9. La raíz, según el dominio ──");
  verificar("symphomed.com muestra la página de venta", esLanding(await pedir("/", "symphomed.com")));
  verificar("  ...con www también", esLanding(await pedir("/", "www.symphomed.com")));
  // La que importa: un despliegue que se equivoque acá deja sin login a todos
  // los médicos que ya están usando Symphomed.
  verificar("salud.chatgo.ia.bo SIGUE mostrando la aplicación", esApp(await pedir("/", "salud.chatgo.ia.bo")));
  verificar("  ...y cualquier otro dominio también", esApp(await pedir("/", "otracosa.com")));
  // Y las dos rutas nuevas no se pueden quedar con /pt y /en del dominio
  // viejo: ahí no son idiomas, son rutas que la aplicación podría querer.
  verificar("/pt y /en NO se quedan con el dominio viejo",
    esApp(await pedir("/pt", "salud.chatgo.ia.bo")) && esApp(await pedir("/en", "salud.chatgo.ia.bo")));

  console.log("\n── 10. El idioma, detectado por el navegador ──");
  // La preferencia que la persona configuró, no el país de su IP: en Brasil
  // hay médicos que prefieren el español, y un brasileño de vacaciones en
  // Miami no quiere de golpe la página en inglés.
  const es = await pedir("/", "symphomed.com", { "Accept-Language": "es-BO,es;q=0.9" });
  verificar("un navegador en español se queda en la raíz",
    es.estado === 200 && idiomaDe(es) === "es");

  const pt = await pedir("/", "symphomed.com", { "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
  verificar("uno en portugués de Brasil va a /pt",
    pt.estado === 302 && pt.cab.location === "/pt");
  // Un 301 quedaría guardado en el navegador para siempre: esa persona no
  // podría volver nunca más a la versión en español, y no habría forma de
  // deshacerlo desde el servidor.
  verificar("  ...con 302 y no 301, que sería para siempre", pt.estado === 302);
  verificar("  ...y avisando que la respuesta depende de quién pide",
    /Accept-Language/i.test(pt.cab.vary || ""));

  const en = await pedir("/", "symphomed.com", { "Accept-Language": "en-US,en;q=0.9" });
  verificar("uno en inglés va a /en", en.estado === 302 && en.cab.location === "/en");

  // Los robots de los buscadores no mandan Accept-Language. Sin cabecera no se
  // redirige a nadie: si se redirigiera, Google indexaría la página en el
  // idioma que le tocara al robot y el resto quedaría fuera.
  const robot = await pedir("/", "symphomed.com");
  verificar("sin Accept-Language no se redirige a nadie", robot.estado === 200);

  console.log("\n── 11. Que el selector de idioma sirva de algo ──");
  // Sin recordar la elección, un brasileño que toca "ES" vuelve a la raíz, la
  // raíz lo manda de nuevo a /pt por su Accept-Language, y queda en un rebote
  // del que no puede salir.
  const conGalleta = await pedir("/", "symphomed.com",
    { "Accept-Language": "pt-BR,pt;q=0.9", Cookie: "sym_idioma=es" });
  verificar("quien ya eligió español se queda en español",
    conGalleta.estado === 200 && idiomaDe(conGalleta) === "es");
  verificar("  ...y la elección se recuerda al servir cada versión",
    /sym_idioma=es/.test(String((await pedir("/", "symphomed.com")).cab["set-cookie"] || "")));
  // Una galleta que no reconocemos no puede decidir nada: se ignora y se
  // vuelve a detectar. Si no, bastaría con mandar cualquier cosa para que la
  // página dejara de funcionar.
  const basura = await pedir("/", "symphomed.com",
    { "Accept-Language": "pt-BR,pt;q=0.9", Cookie: "sym_idioma=zz" });
  verificar("una galleta con basura se ignora", basura.estado === 302 && basura.cab.location === "/pt");

  console.log("\n── 12. Las tres versiones se sirven ──");
  for (const i of IDIOMAS) {
    const r = await pedir(RUTAS[i], "symphomed.com", { Cookie: `sym_idioma=${i}` });
    verificar(`${RUTAS[i]} devuelve la versión en ${i}`, r.estado === 200 && idiomaDe(r) === i);
    verificar(`  ...sin marcadores sin reemplazar`,
      !r.texto.includes("__NONCE__") && !r.texto.includes("__PLATAFORMA__"));
    // El nonce del documento tiene que ser el de SU PROPIA cabecera: un script
    // con el nonce de otra respuesta no da error, no corre, y la página queda
    // inerte en silencio.
    const csp = r.cab["content-security-policy"] || "";
    const nonces = [...r.texto.matchAll(/<script nonce="([^"]+)"/g)].map(m => m[1]);
    verificar(`  ...y los ${nonces.length} nonces son los de su cabecera`,
      nonces.length > 0 && nonces.every(n => csp.includes("'nonce-" + n + "'")));
  }

  console.log("\n── 13. La vista previa, en cualquier dominio ──");
  // Para poder verlas antes de que el DNS apunte a este servidor, y sin que
  // una redirección se las lleve a otra URL en medio de la revisión.
  for (const [ruta, idioma] of [["/inicio", "es"], ["/inicio/pt", "pt"], ["/inicio/en", "en"]]) {
    const r = await pedir(ruta, "salud.chatgo.ia.bo", { "Accept-Language": "pt-BR,pt;q=0.9" });
    verificar(`${ruta} muestra la versión en ${idioma} sin redirigir`,
      r.estado === 200 && esLanding(r) && idiomaDe(r) === idioma);
  }

  console.log("\n── 14. La puerta del médico en el dominio nuevo ──");
  // En symphomed.com la raíz la ocupa la página de venta, así que sin /app un
  // médico NO tiene por dónde iniciar sesión: le sale marketing y nada más.
  verificar("/app muestra la aplicación en symphomed.com", esApp(await pedir("/app", "symphomed.com")));
  verificar("  ...y también en el dominio viejo", esApp(await pedir("/app", "salud.chatgo.ia.bo")));
  // El destino de "Ingresar" NO está escrito en el HTML: symphomed.com es la
  // cara pública y la plataforma va en su propio subdominio, así que el
  // enlace tiene que poder salir del dominio sin editar la plantilla.
  IDIOMAS.forEach(i => verificar(`[${i}] el destino de Ingresar es un marcador, no una ruta fija`,
    /href="__PLATAFORMA__"/.test(VISTAS[i]) && !/href="\/"[^>]*>\s*(Ingresar|Entrar|Log in)/.test(VISTAS[i])));
  const servida = await pedir("/inicio", "symphomed.com");
  verificar("  ...y sin URL_PLATAFORMA cae en /app, que anda en cualquier dominio",
    /href="\/app"[^>]*>\s*Ingresar/.test(servida.texto));

  console.log("\n── 15. Las cabeceras ──");
  const r = await pedir("/inicio", "symphomed.com");
  verificar("va con CSP propia y con nonce",
    /script-src 'nonce-/.test(r.cab["content-security-policy"] || ""));
  // Al revés que el reporte financiero: esta página existe para que la
  // encuentren. Un noindex acá la haría invisible en Google sin avisar.
  verificar("NO pide noindex — esta sí se quiere indexar",
    !/noindex/.test(r.cab["x-robots-tag"] || "") && !/noindex/.test(r.texto));
  verificar("y se deja cachear en el navegador", /max-age/.test(r.cab["cache-control"] || ""));
  // "private" y no "public": la respuesta trae la galleta del idioma, y un
  // caché compartido se la daría al visitante siguiente junto con la página.
  verificar("  ...pero no en un caché compartido, que trae galleta",
    /private/.test(r.cab["cache-control"] || ""));

  servidor.close();

  console.log("\n── 16. Con el subdominio ya configurado ──");
  // La mudanza de verdad: symphomed.com queda como info y contacto, y la
  // plataforma se va a su propio subdominio. Cuando eso pase, "Ingresar"
  // tiene que SALIR del dominio — un enlace relativo dejaría al médico
  // dando vueltas dentro de la página de venta.
  //
  // El módulo lee la variable una sola vez, al cargarse, así que hay que
  // sacarlo del caché para que la relea. Es lo mismo que pasa en producción:
  // cambiar URL_PLATAFORMA pide reiniciar, no alcanza con guardar el .env.
  process.env.URL_PLATAFORMA = "https://app.symphomed.com";
  delete require.cache[require.resolve(path.join(RAIZ, "routes", "inicio"))];
  const app2 = express();
  require(path.join(RAIZ, "routes", "inicio"))(app2);
  const servidor2 = http.createServer(app2);
  await new Promise(r2 => servidor2.listen(0, "127.0.0.1", r2));
  const conSubdominio = await new Promise(res => {
    http.get({ host: "127.0.0.1", port: servidor2.address().port, path: "/inicio" },
      r2 => { let t = ""; r2.on("data", d => t += d); r2.on("end", () => res(t)); });
  });
  servidor2.close();
  verificar("Ingresar apunta al subdominio",
    /href="https:\/\/app\.symphomed\.com"[^>]*>\s*Ingresar/.test(conSubdominio));
  verificar("  ...y ya no a una ruta de este dominio",
    !/href="\/app"[^>]*>\s*Ingresar/.test(conSubdominio));
  delete process.env.URL_PLATAFORMA;

  console.log("\n── 17. Y que index.js sirva /app de verdad ──");
  // El servidor de arriba es un doble armado en esta prueba. Sin esta
  // comprobación, /app podría andar en la prueba y no existir en producción:
  // el médico entra a symphomed.com/app y le sale el 404 de los estáticos.
  const indice = fs.readFileSync(path.join(RAIZ, "index.js"), "utf8");
  verificar("index.js registra /app junto a la raíz",
    /app\.get\(\[[^\]]*"\/app"[^\]]*\]/.test(indice));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
