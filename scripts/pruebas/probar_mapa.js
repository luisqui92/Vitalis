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
  verificar("  ...y la atribución del proveedor está puesta",
    /attribution:/.test(r.texto) && /openstreetmap\.org\/copyright/.test(r.texto));
  verificar("y el centro del mapa", !r.texto.includes("__CENTRO__") && !r.texto.includes("__ZOOM__"));
  // Mientras sean ejemplos, que no lo levante un buscador: alguien podría
  // llegar buscando un laboratorio de verdad y encontrar uno inventado.
  verificar("pide noindex mientras sea demostración", /noindex/.test(r.texto));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
