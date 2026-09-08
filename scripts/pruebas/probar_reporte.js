// Vitalis — Que el reporte financiero no se le escape a nadie.
//
// Acá adentro están los números del negocio: lo que factura cada país, los
// márgenes, cuánta plata hace falta. No es información clínica, así que no
// hay una ley que lo proteja — hay que protegerlo igual, porque se comparte
// con inversores y eso significa que el enlace va a circular.
//
// Lo que se prueba es el portero, no el contenido:
//
//   · que la vista NO esté en public/ —si estuviera, express.static la
//     serviría sin preguntar nada y todo lo demás sería teatro—;
//   · que un enlace de invitación se pueda APAGAR, que es lo único que un
//     token firmado no permite y el motivo de que esto viva en la base;
//   · que un enlace vencido, apagado o inventado se vean iguales desde
//     afuera: si se distinguieran, un enlace viejo confirmaría que existió.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

console.log("── 1. La vista no se puede servir sola ──");
// La prueba más importante del archivo, y la que no necesita servidor: si
// alguien mueve reporte.html a public/ "para simplificar", el permiso deja
// de existir sin que falle nada más.
verificar("reporte.html vive en vistas/, no en public/",
  fs.existsSync(path.join(RAIZ, "vistas", "reporte.html")) &&
  !fs.existsSync(path.join(RAIZ, "public", "reporte.html")));
verificar("  ...y tampoco hay una copia suelta en public/",
  !fs.readdirSync(path.join(RAIZ, "public")).some(f => /report/i.test(f)));

const vista = fs.readFileSync(path.join(RAIZ, "vistas", "reporte.html"), "utf8");
console.log("\n── 2. La página no depende de nada de afuera ──");
// La CSP de Vitalis solo admite 'self'. Una fuente de Google no rompe nada
// visible: cae en silencio y la página queda con la tipografía del sistema.
verificar("no pide fuentes a Google", !/fonts\.googleapis|fonts\.gstatic/.test(vista));
verificar("usa las fuentes ya alojadas", /\/fonts\/(fraunces|inter)-variable\.woff2/.test(vista));
verificar("el script lleva el marcador del nonce", vista.includes('<script nonce="__NONCE__"'));

(async () => {
  const http = require("http");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("vitalis_prueba");
  process.env.OPERADORES_SALDO = "62741818";

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "reporte"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, InvitacionReporte } = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await InvitacionReporte.syncIndexes();

  await Medico.create({ phone: "62741818", nombre: "El Dueño", passwordHash: "x", activo: true });
  await Medico.create({ phone: "70000001", nombre: "Dr. Cualquiera", passwordHash: "x", activo: true });
  const tkDueño = generarToken("62741818", "medico", 3600 * 1000);
  const tkAjeno = generarToken("70000001", "medico", 3600 * 1000);

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const pedir = (ruta, { metodo = "GET", token, cuerpo } = {}) => new Promise(res => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const cab = { "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}` };
    if (token) cab.Authorization = `Bearer ${token}`;
    if (datos) { cab["Content-Type"] = "application/json"; cab["Content-Length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo, headers: cab },
      r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j, texto: t, cab: r.headers }); }); });
    req.on("error", () => res({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });

  console.log("\n── 3. Sin sesión no se ve nada ──");
  const sinNada = await pedir("/report/vista");
  verificar("pedir la vista sin token da 401", sinNada.estado === 401);
  verificar("  ...y no se filtró ni un número del reporte", !/Modelo financiero|US\$/.test(sinNada.texto));

  console.log("\n── 4. Un médico común no es operador ──");
  const ajeno = await pedir("/report/vista", { token: tkAjeno });
  verificar("recibe 404, no un cartel de permisos", ajeno.estado === 404);
  const ajenoCrea = await pedir("/report/invitaciones", { metodo: "POST", token: tkAjeno, cuerpo: { etiqueta: "yo" } });
  verificar("tampoco puede emitir enlaces", ajenoCrea.estado === 404);

  console.log("\n── 5. El operador entra ──");
  const dueño = await pedir("/report/vista", { token: tkDueño });
  verificar("recibe el reporte", dueño.estado === 200 && /Modelo financiero/.test(dueño.texto));
  verificar("  ...con el modo operador puesto", /"operador"/.test(dueño.texto));
  verificar("  ...y sin el marcador sin reemplazar", !dueño.texto.includes("__NONCE__"));

  console.log("\n── 6. Las cabeceras que protegen la página ──");
  const csp = dueño.cab["content-security-policy"] || "";
  verificar("va con CSP propia y con nonce", /script-src 'nonce-/.test(csp));
  verificar("  ...que no permite scripts de 'self'", !/script-src[^;]*'self'/.test(csp));
  verificar("  ...ni que la metan en un iframe", /frame-ancestors 'none'/.test(csp));
  // Un reporte financiero no puede quedar en el disco de una notebook
  // prestada, ni aparecer en un buscador si el enlace se filtra.
  verificar("pide no guardar copia", /no-store/.test(dueño.cab["cache-control"] || ""));
  verificar("pide no indexar", /noindex/.test(dueño.cab["x-robots-tag"] || ""));

  console.log("\n── 7. El pase: el reporte se abre NAVEGANDO ──");
  // El error que costó un despliegue: traer el reporte con fetch y escribirlo
  // con document.write. La CSP se aplica al documento, no a la respuesta, así
  // que el <script> quedaba firmado con un nonce que ese documento nunca
  // autorizó y el navegador lo bloqueaba en silencio — la página se veía
  // entera y no hacía nada.
  const entrada = fs.readFileSync(path.join(RAIZ, "vistas", "reporteEntrada.html"), "utf8");
  const sinComentarios = entrada.replace(/\/\/.*$/gm, "");
  verificar("la entrada NO escribe el documento a mano", !/document\s*\.\s*write/.test(sinComentarios));
  verificar("  ...navega al reporte", /location\.replace\("\/report\/v\//.test(sinComentarios));

  const pase = await pedir("/report/pase", { metodo: "POST", token: tkDueño });
  verificar("el operador se emite un pase", pase.estado === 200 && Boolean(pase.cuerpo.codigo));
  const conPase = await pedir(`/report/v/${pase.cuerpo.codigo}`);
  verificar("  ...y con él abre el reporte", conPase.estado === 200 && /Modelo financiero/.test(conPase.texto));
  verificar("  ...con el nonce ya reemplazado", !conPase.texto.includes("__NONCE__") && /script nonce="/.test(conPase.texto));
  verificar("  ...y el nonce de la página es el de SU cabecera",
    (conPase.cab["content-security-policy"] || "").includes(
      "'nonce-" + (conPase.texto.match(/<script nonce="([^"]+)"/) || [])[1] + "'"));

  // De un solo uso: cuando el código llegue al historial del navegador ya no
  // sirve para nada, que es lo que permite que viaje en la URL.
  const repetido = await pedir(`/report/v/${pase.cuerpo.codigo}`);
  verificar("un pase gastado no sirve dos veces", repetido.estado === 302);
  verificar("  ...y devuelve a la puerta, que emite uno nuevo", repetido.cab.location === "/report");

  const pase2 = await pedir("/report/pase", { metodo: "POST", token: tkDueño });
  const ajenoPase = await pedir("/report/pase", { metodo: "POST", token: tkAjeno });
  verificar("un médico común no puede emitirse un pase", ajenoPase.estado === 404);
  // Un pase no es una invitación: no puede abrir la puerta del invitado ni
  // aparecer en la lista de enlaces compartidos.
  const paseComoInvitacion = await pedir(`/report/i/${pase2.cuerpo.codigo}`);
  verificar("un pase no sirve como enlace de invitado", paseComoInvitacion.estado === 404);

  console.log("\n── 8. La puerta del invitado ──");
  const creada = await pedir("/report/invitaciones", {
    metodo: "POST", token: tkDueño, cuerpo: { etiqueta: "Fondo Ejemplo", dias: 15 },
  });
  verificar("el operador emite un enlace", creada.estado === 200 && Boolean(creada.cuerpo.codigo));
  // 24 bytes en base64url son 32 caracteres: 192 bits de entropía. Es lo que
  // permite que el enlace sea la única credencial sin que sea imprudente.
  verificar("  ...con un código que no se adivina", (creada.cuerpo.codigo || "").length >= 30);
  verificar("  ...y con vencimiento", new Date(creada.cuerpo.expiraEn) > new Date());

  const invitado = await pedir(`/report/i/${creada.cuerpo.codigo}`);
  verificar("el invitado ve el reporte sin cuenta", invitado.estado === 200 && /Modelo financiero/.test(invitado.texto));
  verificar("  ...pero NO el panel para compartir", /"invitado"/.test(invitado.texto));
  verificar("  ...y con las mismas cabeceras que protegen", /noindex/.test(invitado.cab["x-robots-tag"] || ""));

  const trasVisita = await InvitacionReporte.findOne({ codigo: creada.cuerpo.codigo }).lean();
  verificar("queda anotado que se abrió", trasVisita.visitas === 1);

  console.log("\n── 9. Se puede apagar, que es todo el punto ──");
  // Un token firmado con el vencimiento adentro no se puede revocar: vale
  // hasta que expire. Por eso la invitación es una fila y no una firma.
  const apagada = await pedir(`/report/invitaciones/${creada.cuerpo.codigo}`, { metodo: "DELETE", token: tkDueño });
  verificar("el operador la apaga", apagada.estado === 200);
  const despues = await pedir(`/report/i/${creada.cuerpo.codigo}`);
  verificar("  ...y el mismo enlace deja de servir", despues.estado === 404);
  // Lo que importa no es qué palabras usa el mensaje —es genérico a propósito—
  // sino que la respuesta sea IDÉNTICA a la de un código que nunca existió. Si
  // se distinguieran, un enlace viejo confirmaría que alguna vez fue válido.
  const nuncaExistio = await pedir("/report/i/" + "q".repeat(32));
  verificar("  ...con la misma respuesta que un código inventado",
    despues.estado === nuncaExistio.estado && despues.texto === nuncaExistio.texto);

  console.log("\n── 10. Un enlace vencido tampoco ──");
  const vieja = await InvitacionReporte.create({
    codigo: "c".repeat(32), etiqueta: "Vencida",
    expiraEn: new Date(Date.now() - 86400000), creadaPor: "62741818",
  });
  const vencida = await pedir(`/report/i/${vieja.codigo}`);
  verificar("da 404 igual que uno inventado", vencida.estado === 404);
  const inventado = await pedir("/report/i/" + "z".repeat(32));
  verificar("  ...y los dos se ven idénticos desde afuera",
    inventado.estado === vencida.estado && inventado.texto === vencida.texto);

  console.log("\n── 11. Los límites del emisor ──");
  const sinEtiqueta = await pedir("/report/invitaciones", { metodo: "POST", token: tkDueño, cuerpo: {} });
  verificar("sin decir para quién es, no se emite", sinEtiqueta.estado === 400);
  const larga = await pedir("/report/invitaciones", {
    metodo: "POST", token: tkDueño, cuerpo: { etiqueta: "Eterno", dias: 9999 },
  });
  // Un enlace a diez años es un enlace que nadie se va a acordar de apagar.
  const dura = (new Date(larga.cuerpo.expiraEn) - Date.now()) / 86400000;
  verificar("un vencimiento absurdo se recorta a 180 días", dura <= 181);

  console.log("\n── 12. La lista no muestra las apagadas ──");
  const lista = await pedir("/report/invitaciones", { token: tkDueño });
  const codigos = (lista.cuerpo.invitaciones || []).map(i => i.codigo);
  verificar("la apagada no aparece", !codigos.includes(creada.cuerpo.codigo));
  verificar("  ...y las vigentes sí", codigos.includes(larga.cuerpo.codigo));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
