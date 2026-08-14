// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — SmartKardex (antes vivía dentro de ChatGo, ahora es su propia app)
// ═══════════════════════════════════════════════════════════════════════════
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const app = express();

const { CONFIG, log, validateConfig } = require("./config");
validateConfig();

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
      // (WebAssembly) que descomprime el modelo 3D del odontograma.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", "'sha256-8sMMHwouVxJ/QLFj2bu21VB6DWxnVGvSofgMpKoFF6A='"],
      styleSrc: ["'self'", "'unsafe-inline'"], // la UI usa mucho style="" inline
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://streaming.assemblyai.com", "wss://streaming.assemblyai.com"],
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

// ─── RUTAS ────────────────────────────────────────────────────────────────
require("./routes/medicoAuth")(app);
require("./routes/consultaMedica")(app);
require("./routes/pacientes")(app);
require("./routes/medicamentos")(app);
require("./routes/vacunas")(app);
require("./routes/odontograma")(app);
require("./routes/examenOcular")(app);
require("./routes/tratamientos")(app);
require("./routes/mediciones")(app);
require("./routes/estudios")(app);
require("./routes/memoriaClinica")(app);
require("./routes/recetas")(app);
require("./routes/recordatorios")(app);
require("./routes/citas")(app);
require("./routes/whatsappSalud")(app);
require("./routes/vinculacion")(app);
require("./routes/reservaPublica")(app);

// WhatsApp de reservas (Baileys) — corre en este mismo proceso. No hace
// nada si no está configurado SALUD_WHATSAPP_MEDICO_PHONE.
require("./services/baileysWhatsapp").iniciarWhatsapp().catch(e => log.error("[VITALIS_WHATSAPP]", e.message));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, servicio: "Vitalis" }));

// ─── ESTÁTICOS + LA APP ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ─── SERVER ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log.info(`🚀 Vitalis corriendo en puerto ${PORT}`));
