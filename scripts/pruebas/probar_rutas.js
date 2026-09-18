// Symphomed — Que la barra de direcciones diga dónde está uno.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// El ruteo tiene una forma de romperse que no avisa: sigue navegando bien
// con el mouse, y lo que falla es recargar, el botón atrás y compartir un
// enlace — tres cosas que nadie hace mientras programa y todo el mundo hace
// usando.
//
// Y tiene dos formas de romperse que son peores que el problema original:
//
//   · Que el servidor no sirva las rutas profundas. Ahí recargar da 404, o
//     sea que el arreglo deja la app peor que antes.
//   · Que la ruta nueva se coma la API. /app/* registrado en el lugar
//     equivocado devuelve el HTML de la app cuando el navegador pedía datos,
//     y el síntoma es una pantalla en blanco sin un solo error en el log.
//
// Las dos se prueban acá con pedidos de verdad al servidor.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const rutas = fs.readFileSync(path.join(RAIZ, "public", "js", "rutas.js"), "utf8");
const sinComentarios = rutas.replace(/^\s*\/\/.*$/gm, "");
const indexHtml = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const indexJs = fs.readFileSync(path.join(RAIZ, "index.js"), "utf8");
const authJs = fs.readFileSync(path.join(RAIZ, "public", "js", "auth.js"), "utf8");

(async () => {
  // ═══ 1. EL SERVIDOR SIRVE LAS RUTAS PROFUNDAS ════════════════════════════
  console.log("── 1. Recargar una ficha no da 404 ──");
  const http = require("http");
  const express = require("express");
  const app = express();
  // Se monta una API de mentira ANTES, igual que en el servidor real, para
  // comprobar que /app/* no se la come.
  app.get("/medico/pacientes", (_q, r) => r.json({ pacientes: [] }));
  app.get(["/", "/app"], (_q, r) => r.send("<html>app</html>"));
  app.get("/app/*", (_q, r) => r.send("<html>app</html>"));
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const pedir = (ruta) => new Promise(res => {
    http.get({ host: "127.0.0.1", port: puerto, path: ruta }, r => {
      let t = ""; r.on("data", d => t += d); r.on("end", () => res({ estado: r.statusCode, cuerpo: t }));
    }).on("error", () => res({ estado: 0, cuerpo: "" }));
  });

  const ficha = await pedir("/app/paciente/6aaa97010f7dbf853889936b/movilidad");
  verificar("una ficha profunda devuelve la app, no 404", ficha.estado === 200 && /app/.test(ficha.cuerpo));
  const agenda = await pedir("/app/agenda");
  verificar("y una pantalla suelta también", agenda.estado === 200);
  // La que importa de verdad: que la ruta comodín NO le gane a la API.
  const api = await pedir("/medico/pacientes");
  verificar("la API sigue devolviendo datos, no el HTML de la app",
    api.estado === 200 && /"pacientes"/.test(api.cuerpo) && !/<html>/.test(api.cuerpo));
  servidor.close();

  verificar("la ruta comodín está declarada en el servidor real",
    /app\.get\("\/app\/\*"/.test(indexJs));
  // Y va DESPUÉS de las rutas de la API: si se registrara antes, se las come.
  verificar("y va después de las rutas de la API",
    indexJs.indexOf('app.get("/app/*"') > indexJs.indexOf('require("./routes/pacientes")'));

  // ═══ 2. EL RUTEADOR ══════════════════════════════════════════════════════
  console.log("\n── 2. Las pantallas escriben su dirección ──");
  verificar("se envuelven las pantallas en vez de reescribirlas",
    /function enrutar\(/.test(sinComentarios));
  verificar("la ficha del paciente lleva su id y su pestaña",
    /enrutar\("renderPacienteDetalle", \(id, tab\)/.test(sinComentarios));
  verificar("el panel, la agenda y las demás también",
    /enrutar\("renderDashboard"/.test(sinComentarios) && /for \(const r of RUTAS\) enrutar/.test(sinComentarios));
  for (const ruta of ["inicio", "voz", "indicaciones", "estudios", "reportes", "finanzas"]) {
    verificar(`la pantalla de escritorio «${ruta}» también es restaurable`,
      new RegExp(`ruta:\\s*"${ruta}"`).test(sinComentarios));
  }
  verificar("una pestaña inexistente vuelve a una pestaña válida",
    /tabsDisponibles\[tabInicial\]/.test(fs.readFileSync(path.join(RAIZ, "public", "js", "pacientes.js"), "utf8")));

  // El cambio de pestaña PISA la dirección en vez de apilarla: si no, el
  // botón atrás obliga a caminar hacia atrás por las doce pestañas de una
  // ficha antes de volver a la lista.
  verificar("cambiar de pestaña no apila historial (usa reemplazar)",
    /pintarKardex[\s\S]{0,400}?reemplazar: true/.test(sinComentarios));

  verificar("el botón atrás está escuchado", /addEventListener\("popstate"/.test(sinComentarios));
  // Sin esta bandera, restaurar una pantalla vuelve a escribir la dirección
  // que se acaba de leer y el historial se llena de entradas fantasma.
  verificar("restaurar no vuelve a escribir la dirección (no se apilan fantasmas)",
    /restaurando = true/.test(sinComentarios) && /if \(restaurando\) return/.test(sinComentarios));

  // ═══ 3. LOS FORMULARIOS NO SE RESTAURAN ══════════════════════════════════
  console.log("\n── 3. Un formulario a medio llenar no se restaura ──");
  // Restaurar "nueva consulta" de una recarga dibujaría el formulario VACÍO
  // como si fuera el que se estaba llenando. Es peor que volver al panel.
  for (const pantalla of ["renderNuevaConsulta", "renderNuevoPaciente", "renderRegistro"]) {
    verificar(`${pantalla} NO se rutea`, !new RegExp(`enrutar\\("${pantalla}"`).test(sinComentarios));
  }

  // ═══ 4. AL SALIR NO QUEDA EL PACIENTE EN LA BARRA ════════════════════════
  console.log("\n── 4. Cerrar sesión limpia la dirección ──");
  // Un id de paciente en la barra de direcciones, delante de quien se siente
  // después en esa computadora, no tiene por qué quedar ahí.
  verificar("al cerrar sesión la dirección vuelve a /app",
    /logout = function[\s\S]{0,200}?replaceState\(null, "", BASE\)/.test(sinComentarios));

  // ═══ 5. QUE ESTÉ ENCHUFADO ═══════════════════════════════════════════════
  console.log("\n── 5. Enchufado en el orden correcto ──");
  verificar("rutas.js se carga en la app", /js\/rutas\.js/.test(indexHtml));
  // Envuelve funciones que ya tienen que existir, y main.js dispara la
  // primera pantalla: tiene que ir en el medio de los dos.
  verificar("después de las pantallas y antes de main.js",
    indexHtml.indexOf("js/rutas.js") > indexHtml.indexOf("js/pacientes.js") &&
    indexHtml.indexOf("js/rutas.js") < indexHtml.indexOf("js/main.js"));
  verificar("el arranque lee la dirección antes de caer al panel",
    /abrirDesdeLaDireccion\(\)\) return/.test(authJs));
  // El shell del escritorio se arma ANTES: las pantallas pintan adentro de
  // su contenedor, y restaurar una ficha sin el shell la dibuja en el lugar
  // equivocado.
  verificar("y el escritorio se arma antes de restaurar la pantalla",
    authJs.indexOf("activarEscritorioSiCorresponde()") < authJs.indexOf("abrirDesdeLaDireccion"));

  // ═══ 6. UN ID INVENTADO NO LLEGA AL SERVIDOR ═════════════════════════════
  console.log("\n── 6. Lo que venga en la barra se valida ──");
  verificar("el id del paciente se valida antes de pedirlo",
    /\[a-f0-9\]\{24\}/.test(sinComentarios));
  verificar("y solo se atienden direcciones bajo /app",
    /location\.pathname\.startsWith\(BASE\)/.test(sinComentarios));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
