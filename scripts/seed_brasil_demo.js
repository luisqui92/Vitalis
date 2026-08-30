// Vitalis — Uma conta brasileira de demonstração, com Pix e pacientes.
//
// Sirve para mostrar Vitalis como lo ve un médico en Brasil: la interfaz en
// portugués, el saldo en reales, y la pantalla de recarga apuntando a la
// cuenta Pix — no a la boliviana.
//
// ═══ POR QUÉ EL IDIOMA NO ES UN DETALLE DE PRESENTACIÓN ════════════════════
//
// El idioma de la cuenta es lo que decide el PAÍS, y el país decide a qué
// cuenta le paga este médico (ver services/datosPago.js). Poner idioma "pt"
// no es traducir botones: es mandar sus recargas a la cuenta brasileña. Si
// esta cuenta se creara en español, la pantalla de recarga le mostraría un
// banco boliviano a alguien con reales.
//
// ═══ LO QUE ESTE SCRIPT NO INVENTA ═════════════════════════════════════════
//
// Los datos de cobro de Brasil se cargan con lo que se puede leer del propio
// QR que está en public/pago-qr-br.jpg: la chave Pix y el titular salen de
// ahí. El CNPJ no está en el QR y NO se completa con algo verosímil — un
// documento inventado en la pantalla de pagos es peor que un campo vacío,
// porque el vacío se nota y el inventado no.
//
// Uso: node scripts/seed_brasil_demo.js [telefono] ["Nome completo"] [password]
// Ej:  node scripts/seed_brasil_demo.js 11987650001
//
// Es idempotente: no duplica pacientes ni le pisa la contraseña a una cuenta
// que ya exista.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico, Paciente, ConsultaMedica, Cita, ConfigPago } = require("../db/models");
const { hashPassword } = require("../services/auth");
const saldos = require("../services/saldo");

// Leídos del QR de public/pago-qr-br.jpg (payload EMV do Pix). Se dejan acá
// como texto para no depender de una librería de QR en el servidor.
const PIX = {
  chave: "ff439919-4119-405d-838a-6c3e3efd8b55",
  titular: "BRLA DIGITAL LTDA",
};

const PACIENTES = [
  {
    nombre: "João Carlos Ribeiro", sexo: "M", nac: "1974-03-19", tel: "11987651001",
    motivos: ["Controle de pressão arterial", "Dor lombar há uma semana"],
  },
  {
    nombre: "Maria Aparecida Souza", sexo: "F", nac: "1961-11-07", tel: "11987651002",
    motivos: ["Retorno de exames", "Controle de diabetes tipo 2"],
  },
  {
    nombre: "Rafael Oliveira Lima", sexo: "M", nac: "1989-06-25", tel: "11987651003",
    motivos: ["Quadro gripal", "Check-up anual"],
  },
  {
    nombre: "Beatriz Nascimento", sexo: "F", nac: "1996-01-30", tel: "11987651004",
    motivos: ["Enxaqueca recorrente", "Consulta de rotina"],
  },
  {
    nombre: "Antônio Ferreira da Silva", sexo: "M", nac: "1955-09-12", tel: "11987651005",
    motivos: ["Controle de anticoagulação", "Dor no joelho direito"],
  },
];

function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

function hoyALas(hora, minuto = 0) {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  return d;
}

async function main() {
  const phone = String(process.argv[2] || "11987650001").trim();
  const nombre = String(process.argv[3] || "Dra. Fernanda Machado").trim();
  const passwordDada = String(process.argv[4] || "").trim();
  const password = passwordDada || crypto.randomBytes(9).toString("base64url");

  if (!/^[0-9]{6,15}$/.test(phone)) {
    console.error(`❌ "${phone}" no parece un teléfono.`);
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  let contrasenaNueva = false;

  // ─── LA CUENTA ──────────────────────────────────────────────────────────
  let medico = await Medico.findOne({ phone });
  if (!medico) {
    medico = await Medico.create({
      phone, nombre, passwordHash: await hashPassword(password), activo: true,
      especialidad: "Clínica Médica",
      tipoEspecialidad: "medicina_general",
      // Esto es lo que la manda a cobrar por Pix. Ver el encabezado.
      idioma: "pt",
    });
    contrasenaNueva = true;
    console.log(`✅ Conta criada: +${phone} — ${nombre} (português)`);
  } else {
    medico.idioma = "pt";
    await medico.save();
    console.log(`ℹ️  +${phone} já existia — agora em português (senha sem alterações).`);
  }

  // ─── OS DADOS DE COBRANÇA DO BRASIL ─────────────────────────────────────
  // Solo si todavía no hay nada cargado: si un operador ya los editó desde la
  // pantalla, un script de demo no tiene por qué pisarle el número al que
  // están entrando los pagos.
  const yaHayBr = await ConfigPago.findOne({ clave: "br" }).lean();
  if (!yaHayBr) {
    await ConfigPago.create({
      clave: "br", banco: "Pix", cuenta: PIX.chave, titular: PIX.titular,
      documento: "", actualizadoPor: "seed_brasil_demo",
    });
    console.log(`✅ Dados de cobrança do Brasil carregados (chave Pix ${PIX.chave.slice(0, 8)}…)`);
    console.log("   O CNPJ ficou vazio a propósito: não está no QR e não se inventa.");
  } else {
    console.log("ℹ️  Os dados de cobrança do Brasil já estavam carregados, não se tocaram.");
  }

  // ─── PACIENTES, CONSULTAS E AGENDA ──────────────────────────────────────
  const yaTiene = await Paciente.countDocuments({ medicoPhone: phone });
  if (yaTiene) {
    console.log(`ℹ️  Já tinha ${yaTiene} paciente(s), não se duplicam.`);
  } else {
    let nConsultas = 0;
    for (let i = 0; i < PACIENTES.length; i++) {
      const p = PACIENTES[i];
      const paciente = await Paciente.create({
        medicoPhone: phone, nombre: p.nombre, sexo: p.sexo,
        fechaNacimiento: new Date(p.nac), telefono: p.tel,
      });

      for (let k = 0; k < p.motivos.length; k++) {
        const fecha = hace(4 + i * 3 + k * 21);
        const consulta = await ConsultaMedica.create({
          medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: p.nombre,
          estado: "completado", duracionSegundos: 420 + i * 45,
          transcripcionCompleta: `${p.motivos[k]}. Consulta de demonstração.`,
          notaClinicaEstado: "completado",
        });
        // Mongoose pisa createdAt en cada save (timestamps:true), así que la
        // fecha real se fija por debajo del ODM.
        await ConsultaMedica.collection.updateOne(
          { _id: consulta._id }, { $set: { createdAt: fecha, updatedAt: fecha } });
        nConsultas++;
      }

      await Cita.create({
        medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: p.nombre,
        pacienteTelefono: p.tel, fecha: hoyALas(9 + i, (i * 20) % 60),
        duracionMinutos: 30, motivo: p.motivos[0], estado: "confirmada", origen: "manual",
      });
    }
    console.log(`✅ ${PACIENTES.length} pacientes, ${nConsultas} consultas e ${PACIENTES.length} consultas agendadas para hoje.`);
  }

  // ─── SALDO ──────────────────────────────────────────────────────────────
  // Por el servicio de siempre, no escribiendo el número a mano: así queda un
  // movimiento en el libro mayor y el saldo se puede reconstruir. Un saldo
  // puesto a mano es justo lo que services/saldo.js existe para impedir.
  const estado = await saldos.estadoDe(phone);
  if (!estado.saldoCentavos) {
    await saldos.cargar({
      medicoPhone: phone, montoCentavos: 30000, acreditadoPor: "seed_brasil_demo",
      referencia: `DEMO-BR-${phone}`, concepto: "Saldo inicial de demonstração",
    });
    console.log("✅ Saldo inicial: R$ 300,00 (com movimento no livro, não escrito à mão).");
  }

  // ─── COMO ENTRAR ────────────────────────────────────────────────────────
  console.log(`\n🇧🇷 ${nombre}`);
  console.log(`   Usuário: +${phone}`);
  if (contrasenaNueva) {
    console.log(`   Senha${passwordDada ? "" : " gerada"}: ${password}`);
    console.log("   Mostra-se uma única vez. Anote agora.");
  }
  console.log("\nQué mirar al entrar con esta cuenta:");
  console.log("  · Toda la interfaz en portugués, sin tocar ninguna configuración.");
  console.log("  · El saldo en R$ y no en Bs.");
  console.log("  · Configuración → recargar: muestra la chave Pix y el QR brasileño.");
  console.log("    La cuenta boliviana NO aparece por ningún lado, y es el punto.");
  console.log("\n⚠️  Los montos todavía NO se convierten: se ve R$ 12 por consulta donde");
  console.log("    Bolivia ve Bs 12. Es el mismo número reetiquetado (ver PAGOS.md).");

  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
