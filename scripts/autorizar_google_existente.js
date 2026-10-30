// Se ejecuta por SSH para una cuenta específica; nunca cambia el teléfono.
const mongoose = require("mongoose");
const os = require("node:os");
const { autorizar } = require("../services/googleAltaUnica");

(async () => {
  const telefono = process.argv[2];
  if (!telefono) throw new Error("Uso: node scripts/autorizar_google_existente.js TELEFONO_CON_PAIS");
  await mongoose.connection.asPromise();
  const r = await autorizar(telefono, "ssh:" + os.userInfo().username);
  console.log(JSON.stringify({ cuenta: r.nombre, telefonoGuardado: r.telefono,
    googleAutorizado: r.email, vence: r.vence, usos: 1 }, null, 2));
  console.log("Autorizado: Google → completar perfil profesional con ese teléfono → Crear mi cuenta. Se vinculará la cuenta existente.");
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
