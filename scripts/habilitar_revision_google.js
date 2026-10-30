const mongoose = require("mongoose");
const os = require("node:os");
const { habilitar } = require("../services/googleRevision");
(async () => {
  if (!process.argv[2]) throw new Error("Uso: node scripts/habilitar_revision_google.js TELEFONO_CON_PAIS");
  await mongoose.connection.asPromise();
  const r = await habilitar(process.argv[2], "ssh:" + os.userInfo().username);
  console.log(JSON.stringify(r, null, 2));
  console.log("Revisión habilitada solo para esta cuenta durante 48 horas. El cliente solicita con Google y su teléfono; se aprueba en Cuentas y pagos → Vinculaciones con Google.");
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
