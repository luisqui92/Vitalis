// Vitalis — Propone qué fichas de una clínica son la misma persona.
//
// ═══ POR QUÉ ESTO SOLO PROPONE ═════════════════════════════════════════════
//
// Vincular dos fichas que son de dos personas distintas fusiona dos
// historias clínicas: el segundo Juan Pérez hereda las alergias del primero.
// Un script que "resuelve" eso solo, de noche, sobre datos reales, es la
// forma más rápida de meter un error clínico que nadie va a notar hasta que
// alguien recete mal.
//
// Así que este script mira, ordena y explica. Vincular es siempre una
// decisión de una persona, con --aplicar y sabiendo lo que hace.
//
// Uso:
//   node scripts/proponer_personas.js <telefonoAdmin>              (solo mira)
//   node scripts/proponer_personas.js <telefonoAdmin> --aplicar    (vincula los SEGUROS)
//
// "Seguro" es una definición estrecha a propósito — ver mismaPersona().
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Clinica, PersonaClinica, Medico, Paciente } = require("../db/models");

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function soloDigitos(s) { return String(s || "").replace(/\D/g, ""); }

// Dos fichas son la MISMA persona solo si coinciden en el nombre Y en algo
// que no se repite por casualidad: la fecha de nacimiento o el teléfono.
//
// El nombre solo NO alcanza y por eso no está: en una clínica hay dos
// "María Fernández", y unirlas sería exactamente el accidente que este
// script existe para no cometer.
function mismaPersona(a, b) {
  if (normalizar(a.nombre) !== normalizar(b.nombre)) return null;

  const fechaA = a.fechaNacimiento && new Date(a.fechaNacimiento).toISOString().slice(0, 10);
  const fechaB = b.fechaNacimiento && new Date(b.fechaNacimiento).toISOString().slice(0, 10);
  if (fechaA && fechaB && fechaA === fechaB) return "nombre + fecha de nacimiento";

  const telA = soloDigitos(a.telefono), telB = soloDigitos(b.telefono);
  if (telA && telB && telA.length >= 7 && telA === telB) return "nombre + teléfono";

  return null;
}

async function main() {
  const phoneAdmin = String(process.argv[2] || "").trim();
  const aplicar = process.argv.includes("--aplicar");
  if (!phoneAdmin) {
    console.error("Uso: node scripts/proponer_personas.js <telefonoAdmin> [--aplicar]");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  const admin = await Medico.findOne({ phone: phoneAdmin }).lean();
  if (!admin?.clinicaId) {
    console.error(`❌ +${phoneAdmin} no administra ninguna clínica.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const clinica = await Clinica.findById(admin.clinicaId).lean();
  const medicos = await Medico.find({ clinicaId: admin.clinicaId, activo: true }).select("phone nombre").lean();
  const nombrePorTel = Object.fromEntries(medicos.map(m => [m.phone, m.nombre]));

  const fichas = await Paciente.find({ medicoPhone: { $in: medicos.map(m => m.phone) } })
    .select("_id medicoPhone nombre fechaNacimiento telefono personaId")
    .lean();

  console.log(`🏥 ${clinica.nombre} — ${medicos.length} consultorios, ${fichas.length} fichas\n`);

  // Se agrupan por nombre normalizado; dentro de cada grupo se compara de a
  // pares. Los grupos de una sola ficha no interesan: esa persona va a un
  // solo consultorio y no hay nada que unir.
  const porNombre = {};
  for (const f of fichas) (porNombre[normalizar(f.nombre)] ||= []).push(f);

  const seguros = [];   // se pueden vincular
  const dudosos = [];   // mismo nombre, sin nada más que lo confirme

  for (const grupo of Object.values(porNombre)) {
    if (grupo.length < 2) continue;
    // Solo entre médicos distintos: dos fichas del mismo médico con el mismo
    // nombre son cosa de él, no de la clínica.
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        if (grupo[i].medicoPhone === grupo[j].medicoPhone) continue;
        const razon = mismaPersona(grupo[i], grupo[j]);
        (razon ? seguros : dudosos).push({ a: grupo[i], b: grupo[j], razon });
      }
    }
  }

  const describir = (f) => `${f.nombre} (${nombrePorTel[f.medicoPhone] || f.medicoPhone})`;

  if (seguros.length) {
    console.log(`━━━ ${seguros.length} par(es) que coinciden en más que el nombre ━━━`);
    for (const { a, b, razon } of seguros) {
      console.log(`  ${describir(a)}\n  ${describir(b)}\n    → ${razon}\n`);
    }
  } else {
    console.log("No hay pares que coincidan en nombre y además en fecha o teléfono.\n");
  }

  if (dudosos.length) {
    console.log(`━━━ ${dudosos.length} par(es) con el mismo nombre y NADA más ━━━`);
    console.log("Estos NO se vinculan ni con --aplicar. Puede ser la misma persona");
    console.log("o pueden ser dos personas que se llaman igual, y desde acá no");
    console.log("hay forma de saberlo. Lo resuelve el médico en la ficha.\n");
    for (const { a, b } of dudosos) {
      console.log(`  ${describir(a)}  ·  ${describir(b)}`);
    }
    console.log("");
  }

  if (!aplicar) {
    console.log(seguros.length
      ? `Para vincular los ${seguros.length} seguros: node scripts/proponer_personas.js ${phoneAdmin} --aplicar`
      : "Nada que aplicar.");
    await mongoose.disconnect();
    return;
  }

  // ─── Aplicar ────────────────────────────────────────────────────────────
  // Se crea UNA persona por grupo conectado, no una por par: si A=B y B=C,
  // los tres son la misma persona y tienen que terminar apuntando al mismo
  // lugar. Vincularlos de a pares dejaría a C con una persona distinta.
  const padre = new Map();
  const raiz = (x) => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
  for (const { a, b } of seguros) {
    for (const f of [a, b]) if (!padre.has(String(f._id))) padre.set(String(f._id), String(f._id));
    const ra = raiz(String(a._id)), rb = raiz(String(b._id));
    if (ra !== rb) padre.set(ra, rb);
  }

  const grupos = {};
  for (const id of padre.keys()) (grupos[raiz(id)] ||= []).push(id);

  const porId = Object.fromEntries(fichas.map(f => [String(f._id), f]));
  let creadas = 0, vinculadas = 0;

  for (const ids of Object.values(grupos)) {
    // Si alguna ficha del grupo ya tenía persona, se reusa esa en vez de
    // crear otra: correr el script dos veces no puede duplicar personas.
    const yaConPersona = ids.map(id => porId[id]).find(f => f.personaId);
    let personaId = yaConPersona?.personaId;

    if (!personaId) {
      const base = ids.map(id => porId[id]).find(f => f.fechaNacimiento) || porId[ids[0]];
      const persona = await PersonaClinica.create({
        clinicaId: admin.clinicaId,
        nombre: base.nombre,
        fechaNacimiento: base.fechaNacimiento || null,
        telefono: base.telefono || "",
      });
      personaId = persona._id;
      creadas++;
    }

    for (const id of ids) {
      if (String(porId[id].personaId || "") === String(personaId)) continue;
      await Paciente.updateOne({ _id: id }, { personaId });
      vinculadas++;
    }
  }

  console.log(`✅ ${creadas} persona(s) creada(s), ${vinculadas} ficha(s) vinculada(s).`);
  console.log("   Las alergias siguen vacías: nadie las cargó todavía. Se llenan");
  console.log("   desde la ficha del paciente, y ahí sí las ve toda la clínica.");
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
