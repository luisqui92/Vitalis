// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — SmartKardex (antes vivía dentro de ChatGo, ahora es su propia app)
// ═══════════════════════════════════════════════════════════════════════════
const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const { servirComprimidos, prepararEnSegundoPlano } = require("./services/estaticosComprimidos");
const { prepararIdiomas } = require("./services/i18nBundle");
const app = express();

const { CONFIG, log, validateConfig } = require("./config");
validateConfig();

// Última red de contención: los trabajos en segundo plano (transcripción,
// nota clínica por IA, WhatsApp) ya deberían atajar sus propios errores,
// pero si algún caso se escapa, Node por defecto tumba TODO el proceso ante
// una promesa rechazada sin catch — eso apaga Symphomed para todos los
// médicos por un solo trabajo de fondo que falló. Mejor perder ese trabajo
// puntual (y que quede en el log para revisar) que el servidor entero.
process.on("unhandledRejection", (err) => {
  log.error("[UNHANDLED_REJECTION]", err?.stack || err?.message || err);
});

// Detrás de nginx (reverse proxy) — sin esto, Express ve todo como si
// viniera de 127.0.0.1 y cosas como el rate limiting por IP real (X-Forwarded-For) no funcionan.
app.set("trust proxy", 1);

// ─── HEADERS DE SEGURIDAD ────────────────────────────────────────────────
// Todo el front es propio (sin CDN ni scripts de terceros), así que la CSP
// puede ser estricta: nada de scripts/estilos/imágenes de otro origen salvo
// lo que Symphomed realmente usa (el WebSocket de AssemblyAI para la
// transcripción en vivo, y las imágenes data: de los códigos QR).
// Los dominios de Memed salen del servicio y no de una lista escrita acá
// para que se puedan ampliar con una variable de entorno: si su módulo pide
// un dominio más que no está en la documentación, el síntoma es una pantalla
// en blanco sin error, y no hace falta desplegar a ciegas para probarlo.
const DOMINIOS_MEMED = require("./services/memed").dominiosCsp();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // El hash es del <script type="importmap"> de index.html (necesario
      // para que los addons de Three.js resuelvan `import ... from "three"`)
      // — 'wasm-unsafe-eval' es para poder instanciar el decoder Draco
      // (WebAssembly) que descomprime el modelo 3D del odontograma —
      // 'blob:' es para el AudioWorklet de la vista previa en vivo de la
      // consulta (audio.js arma el procesador de audio como blob: en vez
      // de un archivo propio, y Chrome exige blob: en script-src —no en
      // worker-src— para eso).
      // Los de Memed son la receta digital de Brasil: su módulo se carga
      // como script de ellos y se dibuja adentro de Symphomed. Sin esto la
      // pantalla de recetar queda en blanco SIN NINGÚN ERROR VISIBLE, que es
      // la peor forma de fallar — ver services/memed.js.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", "blob:", "'sha256-8sMMHwouVxJ/QLFj2bu21VB6DWxnVGvSofgMpKoFF6A='", ...DOMINIOS_MEMED],
      styleSrc: ["'self'", "'unsafe-inline'"], // la UI usa mucho style="" inline
      // 'blob:' es para las fotos clínicas que se traen con Authorization
      // por header (no por URL) y se abren como blob local — el comparador
      // antes/después y el mapa anatómico de Symphomed Face las muestran
      // como <img> directo en la página, no en una pestaña aparte.
      imgSrc: ["'self'", "data:", "blob:", ...DOMINIOS_MEMED],
      // Las de Daily/Vapi son para la llamada de voz por navegador de la
      // página pública de reserva (public/js/reservarLlamada.js) — Vapi
      // usa la infraestructura de Daily para el audio en tiempo real, y
      // reparte las salas entre varios subdominios que no se pueden listar
      // uno por uno (por eso el wss: general, como recomienda la propia
      // guía de CSP de Daily).
      connectSrc: ["'self'", "https://streaming.assemblyai.com", "wss://streaming.assemblyai.com", "https://api.vapi.ai", "https://*.daily.co", "https://*.pluot.blue", "wss:", ...DOMINIOS_MEMED],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      // El decoder Draco (vista 3D del odontograma) corre en un Web Worker
      // que Three.js crea a partir de un blob: en vez de un archivo propio.
      workerSrc: ["'self'", "blob:"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"], // nadie puede embeber Symphomed en un iframe (clickjacking)
      // ═══ frameSrc: UNA SOLA EXCEPCIÓN, Y ANOTADA ═══════════════════════
      //
      // Acá decía "sin frameSrc a propósito: la teleconsulta NO embebe a
      // nadie", y esa sigue siendo la regla: el video va directo entre los
      // dos navegadores y no hay ningún proveedor que permitir.
      //
      // Memed es la excepción, y es deliberada, no un descuido: en Brasil una
      // receta necesita firma digital ICP-Brasil, y esa firma la emite su
      // módulo dentro de una pantalla suya. Sin embeberlos no hay forma de
      // recetar legalmente en Brasil.
      //
      // Es UNA excepción, para UN proveedor, con un motivo escrito. El día
      // que Brasil deje de recetarse por Memed, esta línea se va con él —
      // una excepción de CSP que ya no se usa es de las que se quedan para
      // siempre y nadie recuerda por qué.
      frameSrc: ["'self'", ...DOMINIOS_MEMED],
    },
  },
  // ═══ LA RECETA DE MEMED SE QUEDABA "CARGANDO" ═══════════════════════════
  //
  // helmet manda por defecto Cross-Origin-Opener-Policy: same-origin. Con
  // eso, una pestaña que abre un iframe de OTRO dominio (el de Memed) le
  // vuelve como null: Memed abre la pestaña al tocar «baixar», genera el
  // PDF, y cuando quiere mandarlo ahí no tiene pestaña. No muestra error:
  // se queda cargando para siempre. Pasó con un médico real desde la PC.
  //
  // "same-origin-allow-popups" deja que las ventanas que se abren desde
  // Symphomed sigan conectadas; lo que protege (que otra página que abra a
  // Symphomed no pueda manejarla) sigue igual. Es el valor que se usa con
  // proveedores de pago o de firma que trabajan con ventanas emergentes.
  // Reproducido en scripts/pruebas/probar_ventanas_emergentes.js.
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

// El cuerpo CRUDO hace falta para verificar la firma de Meta: el HMAC se
// calcula sobre los bytes exactos que mandaron, y JSON.parse + JSON.stringify
// no los devuelve iguales (cambia el orden de las claves, los espacios y el
// escapado de los acentos). Una vez parseado, la firma ya no se puede
// comprobar nunca más — por eso se captura acá y no en la ruta.
//
// Se guarda SOLO para el webhook: quedarse con una copia de cada cuerpo de
// hasta 10 MB en todos los pedidos —las subidas de estudios entre ellos— es
// duplicar la memoria por una ruta que recibe kilobytes.
app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buf) => {
    if (String(req.originalUrl || "").startsWith("/webhook/meta-whatsapp")) {
      req.cuerpoCrudo = buf;
    }
  },
}));

// ─── TIEMPO REAL ──────────────────────────────────────────────────────────
// Avisa a las otras sesiones abiertas del mismo médico (celular + compu a
// la vez, por ejemplo) cuando algo cambió, para que se actualicen solas.
// Va ANTES de las rutas para que "res.on('finish')" quede enganchado en
// todas ellas — lee req.adminUser recién cuando la respuesta ya terminó,
// así que no importa que las rutas de abajo sean las que lo setean.
const { iniciarServidorTiempoReal, middlewareAvisarCambios } = require("./services/realtime");
app.use(middlewareAvisarCambios);

// ─── CUENTAS DE ESTUDIANTE ───────────────────────────────────────────────
// Lo que un estudiante no puede hacer (recetar, escribirle a pacientes,
// cobrar) se corta acá, antes de cualquier ruta. Ver services/estudiantes.js.
app.use(require("./services/estudiantes").middlewareEstudiantes);

// ─── RUTAS ────────────────────────────────────────────────────────────────
require("./routes/medicoAuth")(app);
// Los errores de la pantalla llegan acá (public/js/errores.js).
require("./routes/erroresCliente")(app);
// La fila de entrada: quién pidió cuenta y quién la aprueba. Registrarse en
// Symphomed no da acceso — ver el encabezado de routes/solicitudesCuenta.js.
require("./routes/solicitudesCuenta")(app);
// Olvidé mi contraseña, con un admin en el medio — ver el encabezado de
// routes/reseteoClave.js y el del modelo en db/models.js.
require("./routes/reseteoClave")(app);
require("./routes/solicitudBaja")(app);
require("./routes/perfilFoto")(app);
// Receta digital de Brasil. En Brasil una receta necesita firma ICP-Brasil,
// así que no se receta por Symphomed sino solo por Memed — ver services/memed.js.
require("./routes/memed")(app);
require("./routes/consultaMedica")(app);
// Cuentas de estudiante: repasar sus propios casos (services/estudio.js),
// practicar con un paciente virtual y rendir simulacros.
require("./routes/estudio")(app);
require("./routes/pacienteVirtual")(app);
require("./routes/simulacros")(app);
require("./routes/pacientes")(app);
require("./routes/medicamentos")(app);
require("./routes/vacunas")(app);
require("./routes/odontograma")(app);
require("./routes/examenOcular")(app);
require("./routes/examenGinecologico")(app);
require("./routes/mapaCorporal")(app);
require("./routes/embarazo")(app);
require("./routes/tratamientos")(app);
require("./routes/mediciones")(app);
require("./routes/estudios")(app);
require("./routes/rayos")(app);
require("./routes/cajaDicom")(app);
require("./routes/neurodesarrollo")(app);
require("./routes/equipoNeuro")(app);
require("./routes/informeFamilia")(app);
// El resumen que el paciente se lleva a otro consultorio. Va acá arriba, con
// el resto de lo clínico, aunque además abra dos puertas públicas (/mi y /r):
// son rutas exactas, no comodines, así que no compiten con nada de abajo.
require("./routes/resumenCompartido")(app);
require("./routes/vacunasPet")(app);
require("./routes/lotesGanado")(app);
require("./routes/reproduccion")(app);
require("./routes/produccion")(app);
require("./routes/costos")(app);
// El dueño de la finca, por su enlace (/campo/<llave>). Rutas exactas, como
// /mi y /r: no compiten con nada de abajo.
require("./routes/accesoDueno")(app);
require("./routes/exportarGanado")(app);
require("./routes/fisioterapia")(app);
require("./routes/socio")(app);
require("./routes/insumos")(app);
require("./routes/instrumentos")(app);
require("./routes/informes")(app);
require("./routes/memoriaClinica")(app);
require("./routes/recetas")(app);
require("./routes/kardexPdf")(app);
require("./routes/recordatorios")(app);
// El panel de lo que se pasó. Sirve para las ocho ramas con un solo
// desarrollo — ver el encabezado de services/vencidos.js.
require("./routes/vencidos")(app);
require("./routes/citas")(app);
require("./routes/whatsappSalud")(app);
require("./routes/vapi")(app);
require("./routes/vinculacion")(app);
require("./routes/dashboardEscritorio")(app);
require("./routes/reservaPublica")(app);
require("./routes/push")(app);
require("./routes/asistenteSymphomed")(app);
require("./routes/backup")(app);
// Panel de clínica: varios consultorios vistos desde arriba. Solo agrega
// números — ver el comentario de arriba de routes/admin.js.
require("./routes/admin")(app);
// Persona compartida entre consultorios: identidad y alergias, nada más.
require("./routes/personas")(app);
// Acreditar recargas desde la pantalla. Es el endpoint que FABRICA DINERO:
// leer el encabezado del archivo antes de tocarlo.
require("./routes/operadorSaldo")(app);
// El circuito de recarga visto por el médico: dónde pagar y avisar que pagó.
// Avisar NO acredita — ver el encabezado del archivo.
require("./routes/recargas")(app);
// Telemedicina: la consulta por video. El paciente entra por un enlace que
// vence, sin cuenta — ver el encabezado de routes/teleconsulta.js.
require("./routes/teleconsulta")(app);

// El reporte financiero para inversores. La vista NO vive en public/ —si
// viviera, express.static la serviría sin preguntar nada y el permiso de
// abajo sería decoración. Ver el encabezado de routes/reporte.js.
require("./routes/reporte")(app);

// Los .br se generan una vez, en segundo plano, para no demorar el arranque.
// Mientras no estén se sirven los originales: nada se rompe.
prepararEnSegundoPlano([path.join(__dirname, "public", "vendor")]);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, servicio: "Symphomed" }));

// ─── ESTÁTICOS + LA APP ───────────────────────────────────────────────────
// Antes de express.static: si el navegador acepta brotli y existe el .br
// precomprimido, se manda ese. El detector facial de Symphomed Face son 13 MB
// —9 de WebAssembly— y sin esto son 45 segundos de spinner en la primera
// carga; comprimido son 5,4 MB. Ver services/estaticosComprimidos.js.
// Los textos de cada idioma viven partidos por módulo (public/i18n/es/…);
// acá se arma un archivo por idioma para no mandarle 39 <script> al
// navegador. Va antes de los estáticos porque genera archivos que se sirven.
prepararIdiomas();

const PUBLICO = path.join(__dirname, "public");
app.use(servirComprimidos(PUBLICO, { inmutables: ["/vendor/", "/fonts/"] }));
app.use(express.static(PUBLICO, {
  maxAge: "5m",
  setHeaders(res, ruta) {
    // El modelo, el wasm y las tipografías no cambian nunca: se guardan un
    // año en vez de revalidarse cada cinco minutos.
    if (/[\\/](vendor|fonts)[\\/]/.test(ruta)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));
// Symphomed Veterinaria vive en /veterinaria como landing propia (mismo
// frontend/SPA de siempre — el JS detecta la ruta y ajusta marca/tema/
// registro antes incluso de loguearse; ver public/js/auth.js y estado.js).
// /informe/<token> es la página que abre el PACIENTE desde el enlace de
// WhatsApp: mismo frontend, pero el JS detecta la ruta y muestra el informe
// con membrete en vez de la pantalla de login (ver public/js/informePublico.js).
// La página de venta. Va ANTES que la raíz de la aplicación a propósito: se
// queda con "/" solo si el pedido llegó por symphomed.com, y en cualquier otro
// dominio llama a next() y sigue de largo. Ver routes/inicio.js.
require("./routes/inicio")(app);

// El mapa de servicios médicos. Va con su propia CSP —es la única pantalla
// que trae algo de afuera, los mosaicos— y por eso no se cuelga de la de
// inicio. Ver el encabezado de routes/mapa.js.
require("./routes/mapa")(app);

// "/app" es la puerta del médico en symphomed.com, donde la raíz la ocupa la
// página de venta. Sin esto, un médico que entra a symphomed.com no tiene por
// dónde iniciar sesión: la raíz le muestra marketing y no hay otra pantalla.
//
// Anda en los dos dominios a propósito. En salud.chatgo.ia.bo es un alias que
// no le saca nada a nadie, y permite probar la puerta nueva antes de que el
// DNS apunte.
//
// El JS no necesita saber nada de esta ruta: estado.js solo mira si el camino
// es "/veterinaria", e informePublico.js y teleconsulta.js buscan sus propios
// patrones con token. "/app" no matchea ninguno, así que cae en la pantalla
// de login de siempre — que es exactamente lo que se quiere.
app.get(["/", "/app", "/veterinaria"], (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ═══ LAS PANTALLAS DE ADENTRO TAMBIÉN SON DIRECCIONES ══════════════════════
//
// /app/paciente/<id>, /app/agenda, /app/consulta/<id>... El ruteo lo hace el
// navegador (ver public/js/rutas.js), pero el servidor tiene que devolver la
// misma página en cualquiera de esas direcciones. Sin esto, recargar con la
// ficha abierta da 404 — peor que el problema que se vino a arreglar.
//
// Va DESPUÉS de todas las rutas de la API y de los estáticos, así que no
// puede taparle el camino a ninguna: para cuando un pedido llega acá, ya se
// descartó que sea /medico/..., /admin/... o un archivo.
//
// Y no devuelve nada sensible: es el mismo index.html que ya se sirve sin
// sesión. Quien entre a /app/paciente/<id> sin token ve el login, igual que
// entrando a /app.
app.get("/app/*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// El panel del socio: página aparte de la app del médico, a propósito. Ver el
// comentario del encabezado de public/socio.html — un vendedor no tiene por
// qué cargar el código clínico, y la separación física refuerza la de
// permisos.
app.get("/socio", (_req, res) => res.sendFile(path.join(PUBLICO, "socio.html")));

app.get("/informe/:token", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
// /avance/<token> es el informe de avance que abre la FAMILIA de un chico en
// seguimiento de neurodesarrollo. La ruta se llama "avance" y no "informe"
// por una razón que no es cosmética: es lo que se ve en la barra del
// navegador y en la vista previa de WhatsApp, y ahí no va a decir nada que
// insinúe un diagnóstico. Ver public/js/informeFamilia.js.
app.get("/avance/:token", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
// La sala del paciente: mismo frontend, el JS detecta la ruta (ver
// public/js/teleconsulta.js) y muestra el consentimiento en vez del login.
app.get("/teleconsulta/:token", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ─── EL RESUMEN QUE VIAJA CON EL PACIENTE ─────────────────────────────────
//
// Estas dos NO sirven index.html: son páginas propias, como /socio. Quien abre
// /r es un médico que todavía no es cliente, con un paciente enfrente, y esa
// es la primera vez que ve Symphomed en su vida — bajarle el megabyte de
// JavaScript clínico para leer una hoja arruina esa primera impresión antes
// de que empiece. Quien abre /mi es un paciente, que ni siquiera tiene por qué
// tener el código clínico en su teléfono. El porqué largo está arriba de cada
// archivo.
//
// Rutas cortas a propósito: son enlaces que se mandan por WhatsApp y que a
// veces alguien dicta por teléfono.
app.get("/r/:token", (_req, res) => res.sendFile(path.join(__dirname, "public", "resumen.html")));
app.get("/mi/:llave", (_req, res) => res.sendFile(path.join(__dirname, "public", "mi.html")));
// El dueño de una finca (Symphomed Ganadería). Página propia por lo mismo
// que /mi: es un productor en el campo, con señal floja, que no necesita el
// código clínico para anotar los litros del día.
app.get("/campo/:llave", (_req, res) => res.sendFile(path.join(__dirname, "public", "campo.html")));

// ─── OLVIDÉ MI CONTRASEÑA ──────────────────────────────────────────────────
// Misma razón que /r y /mi: página propia, no index.html. Quien la abre
// todavía no puede entrar a nada — no tiene sentido bajarle el resto de la
// app para mostrarle un formulario de dos campos.
app.get("/restablecer/:token", (_req, res) => res.sendFile(path.join(__dirname, "public", "restablecer.html")));

// ─── POLÍTICA DE PRIVACIDAD ─────────────────────────────────────────────────
// Página propia y pública, sin sesión: es la URL que se declara en App Store
// Connect y en Google Play Console, y las revisiones automáticas de ambas
// tiendas la abren sin ningún token ni cookie. Ruta sin parámetro a
// propósito —no es un enlace de un solo uso como /r o /restablecer— para que
// se pueda pegar tal cual en los dos formularios.
app.get("/privacidad", (_req, res) => res.sendFile(path.join(__dirname, "public", "privacidad.html")));
app.get("/privacidad/pt", (_req, res) => res.sendFile(path.join(__dirname, "public", "privacidad.pt.html")));

// ─── SERVER ───────────────────────────────────────────────────────────────
// http.createServer (en vez del app.listen de siempre) porque el
// WebSocket del tiempo real necesita colgarse del mismo servidor, no de
// uno aparte — comparten el mismo puerto/dominio.
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
iniciarServidorTiempoReal(server);
// Señalización de la teleconsulta: solo el arranque de la negociación entre
// los dos navegadores. El audio y el video NO pasan por acá — ver el
// encabezado de services/senalizacion.js.
require("./services/senalizacion").iniciarSenalizacion(server);
require("./services/video").avisarEstadoAlArrancar();
server.listen(PORT, () => log.info(`🚀 Symphomed corriendo en puerto ${PORT}`));

// Copias de seguridad automáticas. Va acá, después de levantar el servidor,
// para que un problema con los respaldos nunca impida que Symphomed atienda.
require("./services/backup").programar();
require("./services/recordatorioMedicamento").programar();
require("./services/alertaRetiroGanado").programar();
