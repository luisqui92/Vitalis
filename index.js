// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — SmartKardex (antes vivía dentro de ChatGo, ahora es su propia app)
// ═══════════════════════════════════════════════════════════════════════════
const path = require("path");
const express = require("express");
const app = express();

const { CONFIG, log, validateConfig } = require("./config");
validateConfig();

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
// Se sirve bajo /salud a propósito: nginx en el servidor de ChatGo redirige
// api.chatgo.ia.bo/salud (y /medico) hacia esta VM sin sacarle el prefijo,
// así que Vitalis tiene que entender esos mismos paths de este lado.
app.use("/salud", express.static(path.join(__dirname, "public", "salud"), { maxAge: "5m" }));
app.get("/salud", (_req, res) => res.sendFile(path.join(__dirname, "salud.html")));

// ─── SERVER ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log.info(`🚀 Vitalis corriendo en puerto ${PORT}`));
