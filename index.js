// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — SmartKardex (antes vivía dentro de ChatGo, ahora es su propia app)
// ═══════════════════════════════════════════════════════════════════════════
const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const { servirComprimidos, prepararEnSegundoPlano } = require("./services/estaticosComprimidos");
const app = express();

const { CONFIG, log, validateConfig } = require("./config");
validateConfig();

// Última red de contención: los trabajos en segundo plano (transcripción,
// nota clínica por IA, WhatsApp) ya deberían atajar sus propios errores,
// pero si algún caso se escapa, Node por defecto tumba TODO el proceso ante
// una promesa rechazada sin catch — eso apaga Vitalis para todos los
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
// lo que Vitalis realmente usa (el WebSocket de AssemblyAI para la
// transcripción en vivo, y las imágenes data: de los códigos QR).
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
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", "blob:", "'sha256-8sMMHwouVxJ/QLFj2bu21VB6DWxnVGvSofgMpKoFF6A='"],
      styleSrc: ["'self'", "'unsafe-inline'"], // la UI usa mucho style="" inline
      // 'blob:' es para las fotos clínicas que se traen con Authorization
      // por header (no por URL) y se abren como blob local — el comparador
      // antes/después y el mapa anatómico de Vitalis Face las muestran
      // como <img> directo en la página, no en una pestaña aparte.
      imgSrc: ["'self'", "data:", "blob:"],
      // Las de Daily/Vapi son para la llamada de voz por navegador de la
      // página pública de reserva (public/js/reservarLlamada.js) — Vapi
      // usa la infraestructura de Daily para el audio en tiempo real, y
      // reparte las salas entre varios subdominios que no se pueden listar
      // uno por uno (por eso el wss: general, como recomienda la propia
      // guía de CSP de Daily).
      connectSrc: ["'self'", "https://streaming.assemblyai.com", "wss://streaming.assemblyai.com", "https://api.vapi.ai", "https://*.daily.co", "https://*.pluot.blue", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      // El decoder Draco (vista 3D del odontograma) corre en un Web Worker
      // que Three.js crea a partir de un blob: en vez de un archivo propio.
      workerSrc: ["'self'", "blob:"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"], // nadie puede embeber Vitalis en un iframe (clickjacking)
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
require("./routes/asistenteVitalis")(app);
require("./routes/backup")(app);

// Los .br se generan una vez, en segundo plano, para no demorar el arranque.
// Mientras no estén se sirven los originales: nada se rompe.
prepararEnSegundoPlano([path.join(__dirname, "public", "vendor")]);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, servicio: "Vitalis" }));

// ─── ESTÁTICOS + LA APP ───────────────────────────────────────────────────
// Antes de express.static: si el navegador acepta brotli y existe el .br
// precomprimido, se manda ese. El detector facial de Vitalis Face son 13 MB
// —9 de WebAssembly— y sin esto son 45 segundos de spinner en la primera
// carga; comprimido son 5,4 MB. Ver services/estaticosComprimidos.js.
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
// Vitalis Veterinaria vive en /veterinaria como landing propia (mismo
// frontend/SPA de siempre — el JS detecta la ruta y ajusta marca/tema/
// registro antes incluso de loguearse; ver public/js/auth.js y estado.js).
// /informe/<token> es la página que abre el PACIENTE desde el enlace de
// WhatsApp: mismo frontend, pero el JS detecta la ruta y muestra el informe
// con membrete en vez de la pantalla de login (ver public/js/informePublico.js).
app.get(["/", "/veterinaria"], (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/informe/:token", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ─── SERVER ───────────────────────────────────────────────────────────────
// http.createServer (en vez del app.listen de siempre) porque el
// WebSocket del tiempo real necesita colgarse del mismo servidor, no de
// uno aparte — comparten el mismo puerto/dominio.
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
iniciarServidorTiempoReal(server);
server.listen(PORT, () => log.info(`🚀 Vitalis corriendo en puerto ${PORT}`));

// Copias de seguridad automáticas. Va acá, después de levantar el servidor,
// para que un problema con los respaldos nunca impida que Vitalis atienda.
require("./services/backup").programar();
