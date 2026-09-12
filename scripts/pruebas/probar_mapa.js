// Symphomed — El mapa de servicios médicos.
//
// Lo que más fácil se rompe acá no es el mapa: es la CSP.
//
// Esta es la ÚNICA pantalla de Symphomed que trae algo de afuera —los
// mosaicos— y la única que carga un script de /vendor. Si la CSP no los
// permite, el navegador los bloquea SIN ERROR VISIBLE: queda un rectángulo
// oscuro donde tendría que estar el mapa, o la pantalla entera en blanco si
// lo que se bloqueó fue Leaflet. Ninguna de las dos cosas aparece en el log
// del servidor.
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

const vista = fs.readFileSync(path.join(RAIZ, "vistas", "mapa.html"), "utf8");
// El proveedor sale de la ruta, no se escribe acá: así la prueba sigue al
// código cuando se cambie de proveedor, en vez de quedar en rojo.
const MOSAICOS = (fs.readFileSync(path.join(RAIZ, "routes", "mapa.js"), "utf8")
  .match(/MAPA_MOSAICOS \|\|\s*\n?\s*"([^"]+)"/) || [])[1] || "";

console.log("── 1. Lo que necesita para dibujarse ──");
verificar("Leaflet está alojado acá, no en un CDN",
  fs.existsSync(path.join(RAIZ, "public", "vendor", "leaflet", "leaflet.js")) &&
  fs.existsSync(path.join(RAIZ, "public", "vendor", "leaflet", "leaflet.css")));
verificar("  ...y la página lo pide de /vendor", /src="\/vendor\/leaflet\/leaflet\.js"/.test(vista));
// Un <script src> del mismo origen TAMBIÉN queda bloqueado si el script-src
// es solo de nonce. Por eso lleva el marcador, igual que el script inline.
verificar("  ...con el nonce puesto, que también le hace falta",
  /src="\/vendor\/leaflet\/leaflet\.js" nonce="__NONCE__"/.test(vista));
verificar("no usa los iconos por defecto de Leaflet",
  !/L\.icon\(|marker-icon\.png/.test(vista));

console.log("\n── 2. Que se vea que es una demostración ──");
// Esto no es un detalle de estilo. Un mapa con consultorios inventados que se
// hicieran pasar por reales es una mentira que después hay que sostener, y el
// primer médico que reconozca una dirección falsa de su barrio deja de creer
// todo lo demás.
verificar("el aviso está arriba de todo, no en letra chica",
  vista.indexOf("Demostración") < vista.indexOf('id="q"'));
verificar("dice que los datos no son reales", /los datos no son reales/.test(vista));
// Se cuenta DENTRO del arreglo de datos y no en toda la página: "(ejemplo)"
// también aparece en el código que lo saca del título para mostrarlo aparte.
const bloqueDatos = vista.slice(vista.indexOf("var LUGARES"), vista.indexOf("var CATEGORIAS"));
const conEjemplo = (bloqueDatos.match(/\(ejemplo\)/g) || []).length;
const lugares = (bloqueDatos.match(/\{ n:"/g) || []).length;
verificar(`los ${lugares} lugares están marcados como ejemplo`, lugares > 0 && conEjemplo === lugares);
// Nombres de consultorios, no de personas: un médico inventado con dirección
// y reseña es indistinguible de uno real para quien lo lea.
verificar("ninguno lleva nombre de persona",
  !/n:"(Dr|Dra|Doctor|Doctora)\.?\s/.test(vista));

console.log("\n── 2b. Lo que decide si la tarjeta sirve ──");
// Un domingo a la noche el 90% de la lista está cerrada, y sin decirlo el
// visitante toca tarjetas al azar. Y sin orden por distancia, el primero de
// la lista es el que se cargó primero — con 13 ejemplos no se nota, con 200
// médicos de verdad la lista deja de servir.
const datos = new Function(
  vista.slice(vista.indexOf("var LUGARES"), vista.indexOf("var CATEGORIAS")) +
  "\nreturn { LUGARES };")().LUGARES;
verificar(`los ${datos.length} lugares tienen horario`, datos.every(l => Array.isArray(l.h) && l.h.length));
verificar("  ...y teléfono al que llamar", datos.every(l => /^\d{8,}$/.test(l.tel || "")));

// Se ejecutan las funciones DE LA PÁGINA, no una copia: una copia se
// desincroniza a la primera corrección y entonces la prueba miente.
const utiles = new Function(
  vista.slice(vista.indexOf("var DIAS ="), vista.indexOf("function chincheta")) +
  "\nreturn { estadoHorario, distanciaKm, formatearDistancia, ahoraEnBolivia, comoLlegar };")();

const consultorio = [[1, "08:00", "12:00"], [1, "14:30", "19:00"], [6, "09:00", "13:00"]];
verificar("lunes 10:00 → abierto",
  utiles.estadoHorario(consultorio, { dia: 1, minutos: 600 }).abierto === true);
// El corte del mediodía es lo que más se escapa: a las 13:00 está cerrado
// pero vuelve a abrir el mismo día, y decir "abre mañana" sería falso.
verificar("lunes 13:00 → cerrado, y abre HOY a las 14:30",
  /abre hoy 14:30/.test(utiles.estadoHorario(consultorio, { dia: 1, minutos: 780 }).texto));
verificar("domingo 20:00 → dice qué día abre, no solo «cerrado»",
  /abre mañana 08:00/.test(utiles.estadoHorario(consultorio, { dia: 0, minutos: 1200 }).texto));
verificar("una farmacia 24 h está abierta a las 3 de la mañana",
  utiles.estadoHorario([[0, "00:00", "23:59"]], { dia: 0, minutos: 180 }).abierto === true);
verificar("sin horario cargado no inventa nada", utiles.estadoHorario([], { dia: 1, minutos: 600 }) === null);

// ═══ LA HORA ES LA DE BOLIVIA, NO LA DEL DISPOSITIVO ══════════════════════
// new Date().getHours() anda perfecto mientras quien mira está en Bolivia, y
// miente para todos los demás: el médico que abre el mapa desde São Paulo
// vería "cerrado" a las 9 de la mañana porque allá son las 10.
// Se miran las líneas de CÓDIGO, sin los comentarios: el comentario que
// explica por qué NO usar getHours() lo nombra, y la prueba lo encontraba ahí
// y se ponía roja por el motivo exactamente opuesto al que la motivó.
const codigo = vista.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
verificar("la hora sale de America/La_Paz y no del reloj de quien mira",
  /timeZone: "America\/La_Paz"/.test(codigo) && !/new Date\(\)\.getHours\(\)/.test(codigo));

verificar("abajo del kilómetro se dice en metros",
  utiles.formatearDistancia(0.42) === "a 420 m" && utiles.formatearDistancia(1.5) === "a 1,5 km");
verificar("la lista se ordena por distancia cuando se sabe dónde está",
  /if \(estado\.aqui\) \{[\s\S]{0,200}visibles\.sort/.test(vista));
verificar("«cómo llegar» abre la aplicación de mapas con la ruta",
  /maps\/dir\/\?api=1&destination=/.test(vista));

console.log("\n── 2c. La tarjeta, que dejó de ser un botón ──");
// Un <a> o un <button> dentro de otro <button> es HTML inválido, y cada
// navegador lo resuelve a su manera: el enlace de llamar puede no funcionar,
// o funcionar Y ADEMÁS seleccionar la tarjeta y mover el mapa debajo del dedo.
const tarjeta = vista.slice(vista.indexOf('<article class="ficha"'), vista.indexOf("</article>"));
verificar("la tarjeta es un <article>, no un <button>", tarjeta.startsWith('<article class="ficha"'));
verificar("  ...y los enlaces de acción quedan FUERA del botón",
  tarjeta.indexOf('class="acciones"') > tarjeta.indexOf("</button>"));
verificar("el click va al cuerpo y no a la tarjeta entera",
  /querySelectorAll\("\.ficha-cuerpo"\)/.test(vista));
// .cuerpo ya era el contenedor del layout (grid de panel + mapa). Reusar ese
// nombre para la tarjeta le pisaba la grilla y el panel se achicaba a 46px,
// con el texto cortado letra por letra. No da ningún error: gana la última
// regla y la pantalla queda irreconocible.
verificar("y la tarjeta no le pisa el nombre al contenedor del layout",
  /\.cuerpo\{flex:1/.test(vista) && !/\n\.cuerpo\{\n\s*display:grid;grid-template-columns:46px/.test(vista));

console.log("\n── 2d. Cuando no se puede saber dónde está ──");
// Va a pasar seguido: mucha gente dice que no. Si el botón se queda en
// "Buscando…" para siempre, el visitante no sabe si anda o si se colgó.
verificar("se distingue «lo bloqueaste» de «no se pudo»",
  /err\.code === 1 \? "Permiso denegado" : "No se pudo ubicarte"/.test(vista));
verificar("  ...y el botón se vuelve a habilitar si fue un fallo pasajero",
  /b\.disabled = err\.code === 1;/.test(vista));
verificar("hay tiempo máximo de espera, no se cuelga", /timeout: 10000/.test(vista));
verificar("un navegador sin geolocalización lo dice en vez de no hacer nada",
  /!navigator\.geolocation/.test(vista));

console.log("\n── 3. La búsqueda por subespecialidad ──");
// El caso que motivó todo: un pediatra que además es neonatólogo tiene que
// aparecer buscando las dos cosas. Con un solo campo de especialidad no se
// puede, y por eso en la base van a hacer falta dos campos y no uno.
// Se ejecuta el trozo de la página que define los datos y la búsqueda, y se
// piden los símbolos por nombre. Así se prueba EL MISMO código que corre en
// el navegador, en vez de una copia que se desincroniza a la primera
// corrección. (Un reemplazo de "var" por otra cosa rompería el alcance de las
// variables locales de cada función — ya pasó.)
const guion = vista.slice(vista.indexOf("var LUGARES"), vista.indexOf("var $ ="));
const { LUGARES, coincide } = new Function(guion + "\nreturn { LUGARES, coincide };")();

function buscar(q) {
  return LUGARES.filter(l => coincide(l, q)).map(l => l.e);
}
verificar("«neonatólogo» encuentra al pediatra", buscar("neonatólogo").includes("Pediatría"));
verificar("  ...y «neonatologo» sin tilde también", buscar("neonatologo").includes("Pediatría"));
verificar("«pediatra» también lo encuentra", buscar("pediatra").includes("Pediatría"));
verificar("  ...y «pediatría» es la misma búsqueda", buscar("pediatria").includes("Pediatría"));
// El recorte de raíces se pasó una vez y dejaba "pedi", que encontraba una
// farmacia por la palabra "pedido" de su reseña.
verificar("  ...sin traer farmacias por la palabra «pedido»",
  !buscar("pediatra").includes("Farmacia"));
verificar("«ortodoncia» encuentra al odontólogo", buscar("ortodoncia").includes("Odontología"));
verificar("una búsqueda sin resultados no devuelve todo", buscar("zzzz").length === 0);
verificar("y el buscador vacío los muestra todos", buscar("").length === LUGARES.length);

(async () => {
  const express = require("express");
  const app = express();
  require(path.join(RAIZ, "routes", "mapa"))(app);
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const r = await new Promise(res => {
    http.get({ host: "127.0.0.1", port: servidor.address().port, path: "/mapa" }, resp => {
      let t = ""; resp.on("data", d => t += d);
      resp.on("end", () => res({ estado: resp.statusCode, texto: t, cab: resp.headers }));
    });
  });
  servidor.close();

  console.log("\n── 4. La CSP, que es lo que puede dejarlo en negro ──");
  verificar("la página responde", r.estado === 200);
  const csp = r.cab["content-security-policy"] || "";
  // No se comprueba que sea OpenStreetMap ni CARTO: se comprueba que la CSP
  // permita EL PROVEEDOR QUE ESTÁ CONFIGURADO. Esa es la invariante que de
  // verdad se rompe — alguien cambia MAPA_MOSAICOS por otro proveedor, se
  // olvida de MAPA_MOSAICOS_ORIGEN, y el navegador bloquea los mosaicos EN
  // SILENCIO: queda un rectángulo negro donde iba el mapa y ni un error.
  //
  // (Y el proveedor se cambió una vez de verdad: OpenStreetMap devolvió 403
  // en producción porque sus servidores son de voluntarios y su política no
  // admite que un producto los use de CDN.)
  // El {s} se SUSTITUYE por un subdominio de ejemplo, no se borra: la URL que
  // el navegador pide de verdad es "a.basemaps.cartocdn.com", y un comodín
  // "*.basemaps.cartocdn.com" cubre eso pero NO cubre el dominio pelado.
  // Borrándolo, la comprobación decía que faltaba permiso cuando estaba.
  const hostMosaicos = MOSAICOS.replace("{s}", "a").replace(/^https?:\/\//, "").split("/")[0];
  const permitido = (r.cab["content-security-policy"] || "")
    .match(/img-src ([^;]*)/)?.[1] || "";
  const cubierto = permitido.split(/\s+/).some(o => {
    const limpio = o.replace(/^https?:\/\//, "");
    return limpio === hostMosaicos ||
      (limpio.startsWith("*.") && hostMosaicos.endsWith(limpio.slice(1)));
  });
  verificar(`la CSP deja cargar los mosaicos de ${hostMosaicos}`, cubierto);
  verificar("deja cargar Leaflet desde /vendor", /script-src[^;]*'self'/.test(csp));
  verificar("  ...y el script propio por nonce", /script-src[^;]*'nonce-/.test(csp));
  verificar("no abre nada más que eso", /default-src 'none'/.test(csp));
  verificar("sigue sin poder ser embebida", /frame-ancestors 'none'/.test(csp));

  console.log("\n── 5. Los marcadores de la plantilla ──");
  verificar("el nonce quedó reemplazado", !r.texto.includes("__NONCE__"));
  // En el HTML la URL viaja con el {s} literal —lo sustituye Leaflet en el
  // navegador— así que acá se busca el dominio sin el subdominio de ejemplo.
  const dominioBase = hostMosaicos.replace(/^a\./, "");
  verificar("los mosaicos también",
    !r.texto.includes("__MOSAICOS__") && r.texto.includes(dominioBase));
  // La atribución es la CONDICIÓN DE USO de los mapas gratuitos, no un
  // adorno. Sacarla es lo que convierte un mapa gratis en un mapa bloqueado.
  // Si los mosaicos van sin clave, el proveedor les estampa "API KEY REQUIRED"
  // encima de las calles. El mapa funciona, pero se ve como algo pirateado —
  // y es de las cosas que uno deja de ver a la semana, mientras cada médico
  // que entra lo ve por primera vez. Por eso avisa al arrancar.
  const rutaMapa = fs.readFileSync(path.join(RAIZ, "routes", "mapa.js"), "utf8");
  verificar("avisa al arrancar si los mosaicos no llevan clave",
    /\[MAPA\] ⚠️  Los mosaicos van SIN CLAVE/.test(rutaMapa));
  verificar("  ...y recuerda restringirla por dominio, que es lo que se olvida",
    /restringirla por dominio/.test(rutaMapa));

  // La atribución se DEDUCE del proveedor, no se escribe fija: si estuviera
  // escrita, cambiar de proveedor por el .env dejaría el crédito del anterior
  // puesto —el mapa diciendo "CARTO" mientras las tejas las sirve MapTiler—
  // y eso incumple la licencia de los dos a la vez.
  verificar("  ...y la atribución nombra al proveedor configurado",
    /openstreetmap\.org\/copyright/.test(r.texto) &&
    (/cartocdn/.test(MOSAICOS) ? /carto\.com\/attributions/.test(r.texto) : true) &&
    (/maptiler/.test(MOSAICOS) ? /maptiler\.com\/copyright/.test(r.texto) : true));
  verificar("  ...sin marcadores sin reemplazar",
    !r.texto.includes("__CREDITO__") && !r.texto.includes("__TAM_TEJA__"));

  // ═══ QUE EL SCRIPT PARSEE, QUE ES LO QUE DE VERDAD SE ROMPE ═════════════
  //
  // Esta página se arma sustituyendo marcadores dentro de código JavaScript.
  // Si lo que se mete trae una comilla, CIERRA la cadena y el script entero
  // deja de parsear — y entonces no se cae "el mapa": se caen los filtros, la
  // lista de lugares y el buscador, todo junto, y queda un rectángulo vacío.
  //
  // Pasó de verdad con la atribución, que trae href="..." con comillas
  // dobles. En el servidor no hay ni un error: la página se sirve perfecta,
  // 200, y es el NAVEGADOR el que no puede leerla.
  //
  // Por eso no alcanza con comprobar que el marcador se reemplazó. Hay que
  // parsear lo que quedó, que es exactamente lo que hace el navegador.
  const guiones = [...r.texto.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  let parsea = true, porQue = "";
  try { new Function(guiones); } catch (e) { parsea = false; porQue = e.message; }
  verificar("el JavaScript de la página servida parsea", parsea);
  if (!parsea) console.log("   ", porQue);

  // Y que ningún marcador pueda cerrar la etiqueta <script> desde adentro.
  verificar("  ...y nada puede cerrar el <script> desde una sustitución",
    !/<\/script>/i.test(r.texto.slice(r.texto.indexOf("attribution:"),
                                      r.texto.indexOf("attribution:") + 400)));

  // Leaflet asume tejas de 256px; los proveedores modernos sirven de 512. Sin
  // decírselo, el mapa dibuja igual —sin error, sin hueco— pero con el zoom
  // corrido un nivel y borroso. Y las dos opciones van JUNTAS: poner una sin
  // la otra es peor que no poner ninguna.
  const tam = (r.texto.match(/var tam = Number\("(\d+)"\)/) || [])[1];
  verificar(`el tamaño de teja viaja del servidor (${tam}px)`, Boolean(tam));
  verificar("  ...y el zoom se compensa solo cuando son de 512",
    /zoomOffset: tam === 512 \? -1 : 0/.test(r.texto));
  verificar("y el centro del mapa", !r.texto.includes("__CENTRO__") && !r.texto.includes("__ZOOM__"));
  // Mientras sean ejemplos, que no lo levante un buscador: alguien podría
  // llegar buscando un laboratorio de verdad y encontrar uno inventado.
  verificar("pide noindex mientras sea demostración", /noindex/.test(r.texto));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
