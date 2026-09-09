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
}));

app.use(express.json({ limit: "10mb" }));

// ─── TIEMPO REAL ──────────────────────────────────────────────────────────
// Avisa a las otras sesiones abiertas del mismo médico (celular + compu a
// la vez, por ejemplo) cuando algo cambió, para que se actualicen solas.
// Va ANTES de las rutas para que "res.on('finish')" quede enganchado en
// todas ellas — lee req.adminUser recién cuando la respuesta ya terminó,
// así que no importa que las rutas de abajo sean las que lo setean.
const { iniciarServidorTiempoReal, middlewareAvisarCambios } = require("./services/realtime");
app.use(middlewareAvisarCambios);

// ─── RUTAS ────────────────────────────────────────────────────────────────
require("./routes/medicoAuth")(app);
// La fila de entrada: quién pidió cuenta y quién la aprueba. Registrarse en
// Symphomed no da acceso — ver el encabezado de routes/solicitudesCuenta.js.
require("./routes/solicitudesCuenta")(app);
// Receta digital de Brasil. En Brasil una receta necesita firma ICP-Brasil,
// así que no se receta por Symphomed sino solo por Memed — ver services/memed.js.
require("./routes/memed")(app);
require("./routes/consultaMedica")(app);
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
require("./routes/instrumentos")(app);
require("./routes/informes")(app);
require("./routes/memoriaClinica")(app);
require("./routes/recetas")(app);
require("./routes/recordatorios")(app);
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
app.get(["/", "/veterinaria"], (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/informe/:token", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
// La sala del paciente: mismo frontend, el JS detecta la ruta (ver
// public/js/teleconsulta.js) y muestra el consentimiento en vez del login.
app.get("/teleconsulta/:token", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

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
