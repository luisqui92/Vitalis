// Symphomed — Que la página de venta no se coma la aplicación.
//
// El riesgo de esta pantalla no es que se vea fea: es que se quede con la
// raíz del dominio equivocado. Si "/" empieza a devolver marketing en
// salud.chatgo.ia.bo, todos los médicos que ya usan Symphomed pierden el
// login de un despliegue al otro, y el error se ve exactamente igual que la
// página funcionando bien.
//
// Por eso lo que se prueba es el ruteo por dominio, no el contenido.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

console.log("── 1. La página no depende de nada de afuera ──");
const vista = fs.readFileSync(path.join(RAIZ, "vistas", "inicio.html"), "utf8");
// La CSP de esta página es default-src 'none' con img-src 'self' data:. Cualquier
// cosa traída de afuera cae en SILENCIO: no hay error, no hay hueco visible,
// simplemente no está. El diseño original traía la foto de Unsplash y habría
// salido un recuadro vacío en producción sin que nadie se enterara.
verificar("no pide imágenes de afuera", !/src="https?:|url\(["']?https?:/.test(vista));
verificar("no pide fuentes a Google", !/fonts\.googleapis|fonts\.gstatic/.test(vista));
verificar("la foto está alojada acá", /\/img\/medica\.jpg/.test(vista));
verificar("  ...y el archivo existe de verdad",
  fs.existsSync(path.join(RAIZ, "public", "img", "medica.jpg")));
verificar("la tipografía también", /\/fonts\/inter-variable\.woff2/.test(vista) && /InterVar/.test(vista));
verificar("vive en vistas/, no en public/",
  !fs.existsSync(path.join(RAIZ, "public", "inicio.html")));

// Si hay script, tiene que llevar el marcador del nonce. Sin él no da error:
// el navegador lo bloquea en silencio por la CSP y la página queda inerte,
// que es exactamente como se rompió el reporte financiero en su momento.
verificar("el script lleva el marcador del nonce",
  !/<script/i.test(vista) || vista.includes('<script nonce="__NONCE__"'));

console.log("\n── 1b. El carrusel anda sin JavaScript ──");
// Las láminas se desplazan con overflow-x + scroll-snap, no con el script.
// Eso es lo que hace que, si el script no corriera, se pierdan las flechas y
// NO los siete módulos. Un carrusel hecho a fuerza de JavaScript dejaría la
// sección vacía sin ningún error visible.
verificar("las láminas se desplazan solas", /\.pistas\{[^}]*overflow-x:auto/.test(vista));
verificar("  ...y encajan de a una", /scroll-snap-type:x mandatory/.test(vista) && /scroll-snap-align:start/.test(vista));
verificar("ninguna lámina nace oculta", !/class="modulo"[^>]*\bhidden\b/.test(vista));
const laminas = (vista.match(/class="modulo"/g) || []).length;
verificar(`están los ${laminas} módulos`, laminas === 7);
["ODONTOLOGÍA", "PEDIATRÍA", "NEURODESARROLLO", "GINECOLOGÍA Y OBSTETRICIA",
 "OFTALMOLOGÍA", "IMÁGENES Y LABORATORIO", "SYMPHOMED PET"]
  .forEach(m => verificar(`  módulo «${m}»`, vista.includes(m)));

console.log("\n── 2. Dice lo que hay que decir ──");
verificar("tiene a dónde escribir", /wa\.me\/\d{8,}/.test(vista));
verificar("está en español", /lang="es"/.test(vista) && /Historia clínica|historia clínica/.test(vista));
verificar("dice para qué sirve", /convierte la conversación de la consulta/.test(vista));

console.log("\n── 2b. Las secciones y sus anclas ──");
// El menú de arriba es la única navegación que tiene la página. Un enlace a
// una sección renombrada no da error: no lleva a ningún lado, y eso solo se
// descubre tocándolo. Ya pasó al traducir los identificadores del diseño.
const anclas = [...vista.matchAll(/href="#([a-z0-9-]+)"/g)].map(m => m[1]);
const ids = [...vista.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]);
const rotas = [...new Set(anclas)].filter(a => !ids.includes(a));
verificar("todas las anclas del menú llevan a una sección que existe",
  rotas.length === 0);
if (rotas.length) console.log("   rotas:", rotas.join(", "));

["plataforma", "agenda", "especialidades", "soluciones", "tecnologia", "confianza", "demo"]
  .forEach(s => verificar(`sección «${s}»`, vista.includes(`id="${s}"`)));

// La agenda es de lo más vendible que tiene el producto y no venía en el
// diseño: se agrega desde el guion de construcción, así que es justo lo que
// se pierde sin ruido en una reconstrucción.
verificar("la reserva por WhatsApp está contada",
  /reserva solo/.test(vista) && /WhatsApp del consultorio/.test(vista));
verificar("y el seguimiento después de la consulta también",
  /El seguimiento sigue solo/.test(vista));
["Reconsultas", "Laboratorios", "Medicación", "Vacunas", "Controles por edad"].forEach(r =>
  verificar(`  recuerda «${r}»`, vista.includes(`<b>${r}</b>`)));

// Estas dos se insertan buscando el bloque de Veterinary EN INGLÉS, porque la
// regla corre antes de que se traduzca. Buscarlo en español no falla: no
// encuentra nada y las especialidades desaparecen sin que nadie avise. Ya
// pasó una vez.
["Psicología", "Psiquiatría", "Veterinaria"].forEach(e =>
  verificar(`especialidad «${e}»`, vista.includes(`</div>${e}</div>`)));

// El panel de Symphomed Pet lleva .panel-light Y .pet: la segunda lo pinta
// oscuro sin cambiar el color del texto, así que quedaba tinta casi negra
// sobre fondo casi negro. Se ve perfecto en el inspector y no se lee nada.
verificar("el panel de Pet tiene color de texto propio",
  /\.pet\{[^}]*color:#fff/.test(vista));

console.log("\n── 2c. Que no se desborde en el celular ──");
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
  app.get(["/", "/app", "/veterinaria"], (_q, res) => res.type("html").send("<!doctype html><title>LA APLICACION</title>"));

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const pedir = (ruta, host) => new Promise(res => {
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: "GET",
      headers: host ? { Host: host } : {},
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

  console.log("\n── 3. La raíz, según el dominio ──");
  verificar("symphomed.com muestra la página de venta", esLanding(await pedir("/", "symphomed.com")));
  verificar("  ...con www también", esLanding(await pedir("/", "www.symphomed.com")));
  // La que importa: un despliegue que se equivoque acá deja sin login a todos
  // los médicos que ya están usando Symphomed.
  verificar("salud.chatgo.ia.bo SIGUE mostrando la aplicación", esApp(await pedir("/", "salud.chatgo.ia.bo")));
  verificar("  ...y cualquier otro dominio también", esApp(await pedir("/", "otracosa.com")));

  console.log("\n── 3b. La puerta del médico en el dominio nuevo ──");
  // En symphomed.com la raíz la ocupa la página de venta, así que sin /app un
  // médico NO tiene por dónde iniciar sesión: le sale marketing y nada más.
  // Sin esto, un médico que entra a symphomed.com toca "Ingresar" y —cuando
  // ese enlace apuntaba a "/"— recargaba la misma página de venta, en un
  // bucle que solo se ve en el dominio nuevo.
  verificar("/app muestra la aplicación en symphomed.com", esApp(await pedir("/app", "symphomed.com")));
  verificar("  ...y también en el dominio viejo", esApp(await pedir("/app", "salud.chatgo.ia.bo")));

  // El destino de "Ingresar" NO está escrito en el HTML: symphomed.com es la
  // cara pública y la plataforma va en su propio subdominio, así que el
  // enlace tiene que poder salir del dominio sin editar la plantilla.
  verificar("el destino de Ingresar es un marcador, no una ruta fija",
    /href="__PLATAFORMA__"[^>]*>\s*Ingresar/.test(vista));
  verificar("  ...y nunca la raíz, que en symphomed.com es esta misma página",
    !/href="\/"[^>]*>\s*Ingresar/.test(vista));

  const servida = await pedir("/inicio", "symphomed.com");
  verificar("  ...sin el marcador sin reemplazar", !servida.texto.includes("__PLATAFORMA__"));
  verificar("  ...y sin URL_PLATAFORMA cae en /app, que anda en cualquier dominio",
    /href="\/app"[^>]*>\s*Ingresar/.test(servida.texto));

  console.log("\n── 4. /inicio anda en cualquier dominio ──");
  // Para poder verla antes de que el DNS apunte a este servidor.
  verificar("desde el dominio viejo", esLanding(await pedir("/inicio", "salud.chatgo.ia.bo")));
  verificar("  ...y desde el nuevo", esLanding(await pedir("/inicio", "symphomed.com")));

  console.log("\n── 5. Las cabeceras ──");
  const r = await pedir("/inicio", "symphomed.com");
  const csp = r.cab["content-security-policy"] || "";
  verificar("va con CSP propia y con nonce", /script-src 'nonce-/.test(csp));
  // Hoy la página no trae scripts, así que esto no se está ejerciendo. Se
  // comprueba igual porque el día que se agregue uno, el nonce del documento
  // tiene que ser el de SU PROPIA cabecera — un script con el nonce de otra
  // respuesta no da error: no corre, y la página queda inerte en silencio.
  const scriptServido = r.texto.match(/<script nonce="([^"]+)"/);
  verificar(scriptServido
    ? "  ...y el nonce del script es el de SU cabecera"
    : "  ...(sin scripts todavía: nada que quede inerte)",
    !scriptServido || csp.includes("'nonce-" + scriptServido[1] + "'"));
  verificar("  ...sin el marcador sin reemplazar", !r.texto.includes("__NONCE__"));
  // Al revés que el reporte financiero: esta página existe para que la
  // encuentren. Un noindex acá la haría invisible en Google sin avisar.
  verificar("NO pide noindex — esta sí se quiere indexar",
    !/noindex/.test(r.cab["x-robots-tag"] || ""));
  verificar("y se deja cachear", /max-age/.test(r.cab["cache-control"] || ""));

  servidor.close();

  console.log("\n── 5b. Con el subdominio ya configurado ──");
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
  await new Promise(r => servidor2.listen(0, "127.0.0.1", r));
  const conSubdominio = await new Promise(res => {
    http.get({ host: "127.0.0.1", port: servidor2.address().port, path: "/inicio" },
      r => { let t = ""; r.on("data", d => t += d); r.on("end", () => res(t)); });
  });
  servidor2.close();
  verificar("Ingresar apunta al subdominio",
    /href="https:\/\/app\.symphomed\.com"[^>]*>\s*Ingresar/.test(conSubdominio));
  verificar("  ...y ya no a una ruta de este dominio",
    !/href="\/app"[^>]*>\s*Ingresar/.test(conSubdominio));
  delete process.env.URL_PLATAFORMA;

  console.log("\n── 6. Y que index.js sirva /app de verdad ──");
  // El servidor de arriba es un doble armado en esta prueba. Sin esta
  // comprobación, /app podría andar en la prueba y no existir en producción:
  // el médico entra a symphomed.com/app y le sale el 404 de los estáticos.
  const indice = fs.readFileSync(path.join(RAIZ, "index.js"), "utf8");
  verificar("index.js registra /app junto a la raíz",
    /app\.get\(\[[^\]]*"\/app"[^\]]*\]/.test(indice));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
