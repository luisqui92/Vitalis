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
// La CSP de Symphomed solo admite 'self': una fuente de Google cae en silencio
// y la página queda con la tipografía del sistema, sin que nadie se entere.
verificar("no pide fuentes a Google", !/fonts\.googleapis|fonts\.gstatic/.test(vista));
verificar("usa la que ya está alojada", /\/fonts\/inter-variable\.woff2/.test(vista));
verificar("el script lleva el marcador del nonce", vista.includes('<script nonce="__NONCE__"'));
verificar("vive en vistas/, no en public/",
  !fs.existsSync(path.join(RAIZ, "public", "inicio.html")));

console.log("\n── 2. Dice lo que hay que decir ──");
// No es corrección de estilo: son las cuatro cosas sin las cuales la página no
// hace su trabajo, y las cuatro se borran fácil en una edición apurada.
verificar("tiene a dónde escribir", /wa\.me\/\d{8,}/.test(vista));
verificar("dice los precios", /Bs\s*12/.test(vista) && /Bs\s*900/.test(vista));
verificar("y las 4 consultas de cortesía", /4 consultas/.test(vista));
verificar("tiene el apartado de prueba", /Empezar la prueba/.test(vista));

console.log("\n── 2b. Las tres preguntas y el resultado ──");
// La página ya no es un texto que se lee: es un cuestionario de tres pasos. Si
// falta una pantalla, el script revienta al pedirla por id y no se ve NADA.
[1, 2, 3, 4].forEach(p => verificar(`existe la pantalla ${p}`, vista.includes(`id="e${p}"`)));
verificar("la primera NO nace oculta", /id="e1"(?![^>]*\bhidden\b)/.test(vista));
verificar("las otras tres sí", ["e2", "e3", "e4"].every(
  id => new RegExp(`id="${id}"[^>]*\\bhidden\\b`).test(vista)));

// Las opciones las escribe el script desde sus listas. Si se borran las listas
// la página se ve entera pero sin nada que elegir, y el botón queda apagado
// para siempre — un fallo que no rompe nada visible y no se nota hasta que
// pasan las semanas y nadie escribió por WhatsApp.
verificar("las especialidades salen de una lista", /ESPECIALIDADES\s*=\s*\[/.test(vista));
verificar("los minutos también", /MINUTOS\s*=\s*\[/.test(vista));
verificar("y hay dónde ponerlas", /id="ops-esp"/.test(vista) && /id="ops-min"/.test(vista));

// Esta ya se rompió una vez: .progreso es flex, y sin esta regla el atributo
// hidden no le hace nada. La barra de progreso se quedaba encima del resultado.
verificar("hidden le gana a display:flex", /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(vista));

(async () => {
  const express = require("express");
  const app = express();
  process.env.DOMINIOS_LANDING = "symphomed.com,www.symphomed.com";
  require(path.join(RAIZ, "routes", "inicio"))(app);
  // Lo que haría index.js después: la aplicación de siempre en la raíz.
  app.get("/", (_q, res) => res.type("html").send("<!doctype html><title>LA APLICACION</title>"));

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

  const esLanding = (r) => /¿En qué atendés\?/.test(r.texto);
  const esApp = (r) => /LA APLICACION/.test(r.texto);

  console.log("\n── 3. La raíz, según el dominio ──");
  verificar("symphomed.com muestra la página de venta", esLanding(await pedir("/", "symphomed.com")));
  verificar("  ...con www también", esLanding(await pedir("/", "www.symphomed.com")));
  // La que importa: un despliegue que se equivoque acá deja sin login a todos
  // los médicos que ya están usando Symphomed.
  verificar("salud.chatgo.ia.bo SIGUE mostrando la aplicación", esApp(await pedir("/", "salud.chatgo.ia.bo")));
  verificar("  ...y cualquier otro dominio también", esApp(await pedir("/", "otracosa.com")));

  console.log("\n── 4. /inicio anda en cualquier dominio ──");
  // Para poder verla antes de que el DNS apunte a este servidor.
  verificar("desde el dominio viejo", esLanding(await pedir("/inicio", "salud.chatgo.ia.bo")));
  verificar("  ...y desde el nuevo", esLanding(await pedir("/inicio", "symphomed.com")));

  console.log("\n── 5. Las cabeceras ──");
  const r = await pedir("/inicio", "symphomed.com");
  const csp = r.cab["content-security-policy"] || "";
  verificar("va con CSP propia y con nonce", /script-src 'nonce-/.test(csp));
  verificar("  ...y el nonce del script es el de SU cabecera",
    csp.includes("'nonce-" + (r.texto.match(/<script nonce="([^"]+)"/) || [])[1] + "'"));
  verificar("  ...sin el marcador sin reemplazar", !r.texto.includes("__NONCE__"));
  // Al revés que el reporte financiero: esta página existe para que la
  // encuentren. Un noindex acá la haría invisible en Google sin avisar.
  verificar("NO pide noindex — esta sí se quiere indexar",
    !/noindex/.test(r.cab["x-robots-tag"] || ""));
  verificar("y se deja cachear", /max-age/.test(r.cab["cache-control"] || ""));

  servidor.close();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
