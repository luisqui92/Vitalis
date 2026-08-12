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
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // la UI usa mucho style="" inline
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://streaming.assemblyai.com", "wss://streaming.assemblyai.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
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
require("./routes/mediciones")(app);
require("./routes/estudios")(app);
require("./routes/memoriaClinica")(app);
require("./routes/recetas")(app);
require("./routes/recordatorios")(app);
require("./routes/citas")(app);
require("./routes/whatsappSalud")(app);
require("./routes/vinculacion")(app);

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
