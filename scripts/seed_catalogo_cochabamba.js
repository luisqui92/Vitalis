// Symphomed Odonto — Carga el catálogo de tratamientos de un odontólogo con el
// arancel de referencia del Colegio de Odontólogos de Cochabamba (folleto
// físico, agosto 2018), para no tener que tipear cada tratamiento a mano.
//
// Uso: node scripts/seed_catalogo_cochabamba.js <telefono>
// Ej:  node scripts/seed_catalogo_cochabamba.js 78804988
//
// Es idempotente: si un ítem con ese nombre ya existe para ese médico, se
// saltea (no pisa un precio que el médico ya haya editado a mano).
//
// OJO: los ítems marcados "Convencional" en el folleto (sin precio fijo,
// se cotizan caso por caso) NO se cargan acá — no tiene sentido ponerles
// un número inventado. Además, algunas fotos venían rotadas y con el precio
// separado del nombre por varias líneas; se reconstruyó la pareja
// nombre-precio por posición (mismo orden en el que aparecen), verificando
// que la cantidad de nombres y de precios coincida en cada bloque antes de
// darla por buena — aun así, conviene que el médico revise una vez los
// precios de la sección de traumatología/cirugía maxilofacial (páginas 17-18
// del folleto), que es la que se armó cruzando dos fotos.
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { CatalogoTratamiento } = require("../db/models");

const ITEMS = [
  // Procedimientos básicos
  ["Procedimientos básicos", "Consulta", 60],
  ["Procedimientos básicos", "Certificado Odontológico", 80],
  ["Procedimientos básicos", "Curaciones de emergencia", 100],
  ["Procedimientos básicos", "Curaciones de emergencia nocturna", 150],
  ["Procedimientos básicos", "Urgencia", 200],
  ["Procedimientos básicos", "Extensión de certificado odontológico", 120],

  // Operatoria dental
  ["Operatoria dental", "Restauración con amalgama simple", 100],
  ["Operatoria dental", "Restauración con amalgama compuesta", 120],
  ["Operatoria dental", "Restauración con amalgama compleja", 150],
  ["Operatoria dental", "Restauración con resina simple", 120],
  ["Operatoria dental", "Restauración con resina compuesta", 180],
  ["Operatoria dental", "Restauración con resina compuesta reforzada", 250],

  // Cirugía periodontal / alargamiento
  ["Cirugía periodontal", "Alargamiento de corona clínica por pieza", 350],
  ["Cirugía periodontal", "Cirugía a colgajo abierto por cuadrante", 600],

  // Prótesis removible
  ["Prótesis removible", "Consulta", 100],
  ["Prótesis removible", "Prótesis parcial de acrílico con ganchos", 1200],
  ["Prótesis removible", "Prótesis parcial de acrílico sin ganchos", 1000],
  ["Prótesis removible", "Prótesis parcial de cromo cobalto", 1800],
  ["Prótesis removible", "Prótesis total superior", 1500],
  ["Prótesis removible", "Prótesis total inferior", 1500],
  ["Prótesis removible", "Prótesis parcial flexible", 2000],
  ["Prótesis removible", "Prótesis parcial flexible combinada con cromo cobalto", 2500],
  ["Prótesis removible", "Reparación con acrílico auto curado", 200],
  ["Prótesis removible", "Rebase con acrílico termo curado", 400],
  ["Prótesis removible", "Rebase con siliconas (Resi, Ufi Gel)", 500],

  // Prótesis fija
  ["Prótesis fija", "Corona Jacket", 700],
  ["Prótesis fija", "Corona Jacket en ceromeros", 1000],
  ["Prótesis fija", "Carilla en cerámica Empress II", 1600],
  ["Prótesis fija", "Carilla en cerámica Inceram", 1800],
  ["Prótesis fija", "Corona metálica (otros materiales)", 800],
  ["Prótesis fija", "Corona metalocerámica", 1200],
  ["Prótesis fija", "Corona provisional", 200],
  ["Prótesis fija", "Perno de fibra de vidrio", 500],
  ["Prótesis fija", "Perno de fibra de carbono", 700],
  ["Prótesis fija", "Blanqueamiento", 800],
  ["Prótesis fija", "Carilla directa", 400],
  ["Prótesis fija", "Incrustación en ceromeros", 700],
  ["Prótesis fija", "Incrustación en cerámica Empress II", 1600],
  ["Prótesis fija", "Incrustación en cerámica Inceram", 1800],

  // Endodoncia
  ["Endodoncia", "Consulta", 150],
  ["Endodoncia", "Tratamiento de conducto uni-radicular", 600],
  ["Endodoncia", "Tratamiento de conducto bi-radicular", 750],
  ["Endodoncia", "Tratamiento de conducto multi-radicular", 950],
  ["Endodoncia", "Desobturación de conducto", 240],
  ["Endodoncia", "Retiro de perno", 240],
  ["Endodoncia", "Preparación de conducto para recibir perno", 240],
  ["Endodoncia", "Retratamiento uni-radicular", 850],
  ["Endodoncia", "Retratamiento bi-radicular", 1050],
  ["Endodoncia", "Retratamiento multi-radicular", 1300],
  ["Endodoncia", "Tratamiento de sensibilidad en cuellos (por diente)", 160],
  ["Endodoncia", "Apicoformación uni-radicular", 400],
  ["Endodoncia", "Apicoformación multi-radicular", 650],

  // Radiología
  ["Radiología", "Radiografía con aleta de mordida", 50],
  ["Radiología", "Radiografía oclusal convencional", 40],
  ["Radiología", "Radiografía oclusal digital", 60],
  ["Radiología", "Radiografía carpal convencional", 50],
  ["Radiología", "Radiografía carpal digital", 70],
  ["Radiología", "Radiografía periapical convencional", 20],
  ["Radiología", "Radiografía periapical digital", 40],
  ["Radiología", "Radiografía panorámica convencional", 50],
  ["Radiología", "Radiografía panorámica digital", 100],
  ["Radiología", "Radiografía PA de cráneo convencional", 50],
  ["Radiología", "Radiografía PA de cráneo digital", 100],
  ["Radiología", "Radiografía lateral de cráneo convencional", 50],
  ["Radiología", "Radiografía lateral de cráneo digital", 100],
  ["Radiología", "Radiografía de ATM convencional", 50],
  ["Radiología", "Radiografía de ATM digital", 150],

  // Odontopediatría
  ["Odontopediatría", "Consulta", 150],
  ["Odontopediatría", "Reconsulta (después de un mes)", 120],
  ["Odontopediatría", "Motivación (por sesión)", 100],
  ["Odontopediatría", "Profilaxis", 150],
  ["Odontopediatría", "Educación en salud oral y control de placa bacteriana", 120],
  ["Odontopediatría", "Aplicación de flúor", 150],
  ["Odontopediatría", "Sellantes de fosas y fisuras", 150],
  ["Odontopediatría", "Restauración con resina simple", 200],
  ["Odontopediatría", "Restauración con resina compuesta", 250],
  ["Odontopediatría", "Restauración con resina fluida", 180],
  ["Odontopediatría", "Restauración con resina indirecta", 350],
  ["Odontopediatría", "Restauración con ionómero de vidrio", 180],
  ["Odontopediatría", "Restauración con amalgama", 200],
  ["Odontopediatría", "Corona prefabricada", 350],
  ["Odontopediatría", "Corona confeccionada en laboratorio", 400],
  ["Odontopediatría", "Pulpotomía", 300],
  ["Odontopediatría", "Pulpectomía", 350],
  ["Odontopediatría", "Apicogénesis o apicoformación", 350],
  ["Odontopediatría", "Frenectomía", 200],
  ["Odontopediatría", "Fenestración", 200],
  ["Odontopediatría", "Exodoncia de diente temporal", 100],
  ["Odontopediatría", "Remineralización (3 sesiones)", 700],

  // Ortodoncia
  ["Ortodoncia", "Consulta", 150],
  ["Ortodoncia", "Diagnóstico, pronóstico y plan de tratamiento", 300],
  ["Ortodoncia", "Ortodoncia preventiva", 4000],
  ["Ortodoncia", "Ortodoncia interceptiva", 5000],
  ["Ortodoncia", "Ortodoncia correctiva", 8000],

  // Periodoncia
  ["Periodoncia", "Consulta", 150],
  ["Periodoncia", "Control de placa bacteriana (detección, educación, profilaxis y flúor)", 300],
  ["Periodoncia", "Detartraje convencional", 350],
  ["Periodoncia", "Ultrasonido", 350],
  ["Periodoncia", "Tratamiento de emergencia (lesión endoperiodontal / absceso)", 200],
  ["Periodoncia", "Ferulización por pieza", 200],
  ["Periodoncia", "Terapia de mantenimiento", 350],
  ["Periodoncia", "Curetaje por pieza", 150],

  // Implantología oral
  ["Implantología oral", "Cirugía de implante", 6300],
  ["Implantología oral", "Pilar sobre implante", 3500],
  ["Implantología oral", "Corona metal-cerámica sobre implante", 3500],
  ["Implantología oral", "Corona metal-free sobre implante", 4200],
  ["Implantología oral", "Corona provisoria sobre implante", 500],
  ["Implantología oral", "Implante unitario con carga inmediata", 17000],
  ["Implantología oral", "Levante de seno traumático", 7000],
  ["Implantología oral", "Levante de seno atraumático", 3500],
  ["Implantología oral", "Injerto en bloque de mentón o rama", 7000],
  ["Implantología oral", "Injerto de hueso particulado", 3500],

  // Patología bucal
  ["Patología bucal", "Biopsia excisional", 250],
  ["Patología bucal", "Biopsia incisional", 300],
  ["Patología bucal", "Biopsia esfoliativa", 200],
  ["Patología bucal", "Citología de tejido blando", 350],
  ["Patología bucal", "Citología de tejido duro", 500],

  // Cirugía bucal
  ["Cirugía bucal", "Consulta", 150],
  ["Cirugía bucal", "Exodoncia simple", 200],
  ["Cirugía bucal", "Exodoncia quirúrgica", 350],
  ["Cirugía bucal", "Extracción de molar retenido", 800],
  ["Cirugía bucal", "Extracción de canino retenido", 1000],
  ["Cirugía bucal", "Germectomía de molares", 1000],
  ["Cirugía bucal", "Fenestración de caninos", 1200],
  ["Cirugía bucal", "Extracción de supernumerario / mesiodens", 1000],
  ["Cirugía bucal", "Apicectomía", 600],

  // Cirugía menor — dento maxilar
  ["Cirugía menor", "Extracción dentaria simple", 200],
  ["Cirugía menor", "Extracción dentaria compleja", 400],
  ["Cirugía menor", "Tratamiento de comunicación buco-sinusal aguda", 1400],
  ["Cirugía menor", "Tratamiento de hemorragia post extracción", 350],
  ["Cirugía menor", "Tratamiento de alveolitis", 350],
  ["Cirugía menor", "Biopsia por punción-aspiración", 350],
  ["Cirugía menor", "Trasplante de germen dentario autólogo", 1500],

  // Cirugía menor — tejidos blandos
  ["Cirugía menor", "Amputación radicular", 600],
  ["Cirugía menor", "Curetaje apical", 600],
  ["Cirugía menor", "Frenectomía labial (superior o inferior)", 400],
  ["Cirugía menor", "Frenectomía lingual", 800],
  ["Cirugía menor", "Profundización de vestíbulo por arcada", 500],
  ["Cirugía menor", "Profundización de vestíbulo por hemiarcada", 400],
  ["Cirugía menor", "Enucleación de quiste", 600],
  ["Cirugía menor", "Exéresis de mucocele", 600],
  ["Cirugía menor", "Control de hemorragia post-exodoncia", 400],
  ["Cirugía menor", "Mucoplastía por oclusión de comunicación bucosinusal o bucoantral", 800],
  ["Cirugía menor", "Corticotomía por diente", 600],
  ["Cirugía menor", "Biopsia incisional", 300],
  ["Cirugía menor", "Biopsia excisional", 700],
  ["Cirugía menor", "Hemangioma", 2000],

  // Cirugía mediana — dento maxilar
  ["Cirugía mediana", "Extracción de tercer molar retenido submucoso", 800],
  ["Cirugía mediana", "Extracción de tercer molar retenido e impactado", 1000],
  ["Cirugía mediana", "Exodoncia de tercer molar de alta complejidad", 2000],
  ["Cirugía mediana", "Exodoncia de canino retenido", 1500],
  ["Cirugía mediana", "Exodoncia de supernumerario retenido", 1500],
  ["Cirugía mediana", "Exodoncia de restos radiculares fracturados", 700],
  ["Cirugía mediana", "Complicaciones de exodoncia (dientes retenidos)", 1000],
  ["Cirugía mediana", "Gemenectomía", 800],
  ["Cirugía mediana", "Fenestración de dientes retenidos", 700],
  ["Cirugía mediana", "Apicectomía en diente uniradicular", 700],
  ["Cirugía mediana", "Apicectomía en diente multirradicular", 1000],
  ["Cirugía mediana", "Sellado quirúrgico radicular", 500],
  ["Cirugía mediana", "Radicectomía", 700],
  ["Cirugía mediana", "Exéresis de torus palatino", 1400],
  ["Cirugía mediana", "Exéresis de torus lingual mandibular", 1500],
  ["Cirugía mediana", "Exéresis de hipertrofia de tuberosidad", 700],
  ["Cirugía mediana", "Exéresis de apófisis geni", 700],

  // Cirugía de tumores benignos
  ["Cirugía de tumores benignos", "Resección segmentaria de apófisis alveolar por cuadrante (mandíbula)", 2800],
  ["Cirugía de tumores benignos", "Resección parcial de mandíbula con conservación de la BAS", 7000],
  ["Cirugía de tumores benignos", "Hemimandibulectomía", 10000],
  ["Cirugía de tumores benignos", "Resección segmentaria de apófisis alveolar (maxilar superior)", 2800],
  ["Cirugía de tumores benignos", "Hemimaxilectomía", 10000],

  // Quistes maxilares
  ["Quistes maxilares", "Quistomía (descompresión)", 150],
  ["Quistes maxilares", "Quistomía simple (escisión)", 1500],
  ["Quistes maxilares", "Quistomía compleja (escisión)", 3000],

  // Injertos óseos
  ["Injertos óseos", "Autoinjerto intraoral (toma y aplicación)", 3500],
  ["Injertos óseos", "Autoinjerto extraoral (aplicación)", 7000],
  ["Injertos óseos", "Xenoinjerto simple", 1500],
  ["Injertos óseos", "Xenoinjerto complejo", 2500],

  // Cirugía pre-protética
  ["Cirugía pre-protética", "Profundización de surcos por cuadrante", 1000],
  ["Cirugía pre-protética", "Alveoloplastia por arcada", 1000],
  ["Cirugía pre-protética", "Distracción alveolar osteogénica", 8500],
  ["Cirugía pre-protética", "Implante osteointegrado (implante incluido)", 4000],
  ["Cirugía pre-protética", "Implante zigomático", 10500],

  // Cirugía de tejidos blandos (maxilofacial)
  ["Cirugía maxilofacial de tejidos blandos", "Corrección de labio doble (por labio)", 2800],
  ["Cirugía maxilofacial de tejidos blandos", "Fistulectomía cutánea", 2000],
  ["Cirugía maxilofacial de tejidos blandos", "Frenectomía labial", 1000],
  ["Cirugía maxilofacial de tejidos blandos", "Frenectomía lingual", 1500],
  ["Cirugía maxilofacial de tejidos blandos", "Resección de bridas", 1000],
  ["Cirugía maxilofacial de tejidos blandos", "Plastia de comunicación bucosinusal o buconasal", 3500],
  ["Cirugía maxilofacial de tejidos blandos", "Eliminación de hiperplasia para protética por cuadrante", 700],

  // Cirugía de glándulas salivales
  ["Cirugía de glándulas salivales", "Mucocele", 1000],
  ["Cirugía de glándulas salivales", "Ránula (marsupialización)", 1500],
  ["Cirugía de glándulas salivales", "Excisión de tumor en glándula salival menor", 3000],
  ["Cirugía de glándulas salivales", "Sublingualectomía", 3000],
  ["Cirugía de glándulas salivales", "Submaxilectomía", 7000],
  ["Cirugía de glándulas salivales", "Parotidectomía parcial", 7000],
  ["Cirugía de glándulas salivales", "Parotidectomía total", 14000],
  ["Cirugía de glándulas salivales", "Eliminación quirúrgica de cálculo salival", 1400],

  // Articulación temporomandibular
  ["Articulación temporomandibular", "Tratamiento de trastornos temporomandibulares", 5000],
  ["Articulación temporomandibular", "Reducción de luxación articular ambulatoria", 1000],
  ["Articulación temporomandibular", "Reducción de luxación articular hospitalaria", 1500],
  ["Articulación temporomandibular", "Artroscopia", 10500],
  ["Articulación temporomandibular", "Artroplastia", 10500],
  ["Articulación temporomandibular", "Condilectomía", 10500],
  ["Articulación temporomandibular", "Eminectomía", 10500],
  ["Articulación temporomandibular", "Cirugía de anquilosis", 10500],
  ["Articulación temporomandibular", "Reconstrucción articular", 14000],
  ["Articulación temporomandibular", "Artrocentesis", 2000],
  ["Articulación temporomandibular", "Reemplazo articular", 20000],

  // Traumatología — fracturas dentoalveolares
  ["Traumatología bucomaxilofacial", "Luxación/extrusión/intrusión de pieza dentaria (por diente)", 2000],
  ["Traumatología bucomaxilofacial", "Reimplante de pieza dentaria sin tratamiento endodóntico (por diente)", 1050],
  ["Traumatología bucomaxilofacial", "Fractura dentoalveolar", 1750],

  // Traumatología — fracturas mandibulares
  ["Traumatología bucomaxilofacial", "Fractura mandibular simple con bloqueo intermaxilar (BIM)", 5600],
  ["Traumatología bucomaxilofacial", "Fractura mandibular simple con reducción abierta y fijación rígida (RAFRI)", 10500],
  ["Traumatología bucomaxilofacial", "Fractura mandibular con minuta con RAFRI convencional", 4200],
  ["Traumatología bucomaxilofacial", "Fractura mandibular compleja (RAFRI)", 10000],

  // Traumatología — cóndilo
  ["Traumatología bucomaxilofacial", "Reducción cerrada de cóndilo", 5500],
  ["Traumatología bucomaxilofacial", "Reducción abierta y fijación rígida de cóndilo (cada abordaje)", 7000],

  // Traumatología — Lefort (maxilar superior)
  ["Traumatología bucomaxilofacial", "Lefort I con suspensión y BIM", 9000],
  ["Traumatología bucomaxilofacial", "Lefort II con suspensión y BIM", 7000],
  ["Traumatología bucomaxilofacial", "Lefort III con suspensión y BIM", 10500],
  ["Traumatología bucomaxilofacial", "Lefort I con reducción abierta y fijación rígida (RAFRI)", 14000],
  ["Traumatología bucomaxilofacial", "Lefort II con RAFRI", 17500],
  ["Traumatología bucomaxilofacial", "Lefort III con RAFRI", 14000],
  ["Traumatología bucomaxilofacial", "Panfacial con RAFRI", 17500],
  ["Traumatología bucomaxilofacial", "Retiro de osteosíntesis", 2100],

  // Traumatología — malar / arco cigomático
  ["Traumatología bucomaxilofacial", "Reducción cerrada de fractura malar/arco cigomático", 3500],
  ["Traumatología bucomaxilofacial", "Reducción abierta y fijación rígida de fractura malar/arco cigomático", 10000],

  // Traumatología — órbita, nariz, nasoetmorbitarias
  ["Traumatología bucomaxilofacial", "Reducción de fractura de órbita con injerto o implante", 10000],
  ["Traumatología bucomaxilofacial", "Reducción cerrada de fractura nasal", 2100],
  ["Traumatología bucomaxilofacial", "Fractura nasoetmorbitaria (NEO) unilateral", 10500],
  ["Traumatología bucomaxilofacial", "Fractura nasoetmorbitaria (NEO) bilateral", 14000],
  ["Traumatología bucomaxilofacial", "Cantopexia", 5600],

  // Cirugía reconstructiva y reparadora
  ["Cirugía reconstructiva", "Reparación de tejidos blandos por colgajo de vecindad", 2500],
  ["Cirugía reconstructiva", "Tratamiento de heridas traumáticas", 2100],
  ["Cirugía reconstructiva", "Transporte óseo", 8500],

  // Odontología forense
  ["Odontología forense", "Consulta forense", 500],
  ["Odontología forense", "Valoración de daño", 3400],
  ["Odontología forense", "Peritaje", 3400],

  // Cirugía buco maxilofacial — consultas y trámites
  ["Cirugía buco maxilofacial", "Consulta", 150],
  ["Cirugía buco maxilofacial", "Consulta domiciliaria", 250],
  ["Cirugía buco maxilofacial", "Consulta hospitalaria", 250],
  ["Cirugía buco maxilofacial", "Consulta en UTI", 250],
  ["Cirugía buco maxilofacial", "Consulta nocturna o feriados", 300],
  ["Cirugía buco maxilofacial", "Peritaje de la especialidad", 2500],
  ["Cirugía buco maxilofacial", "Asistencia a junta médica", 350],
  ["Cirugía buco maxilofacial", "Extensión de certificado", 200],
  ["Cirugía buco maxilofacial", "Extensión de informe de especialidad", 250],

  // Sin categoría clara en la foto (no se veía el título de la sección)
  ["Otros", "Glosectomía parcial", 7000],
  ["Otros", "Cirugía de camuflaje (implantes)", 3500],
];

async function main() {
  const phone = String(process.argv[2] || "").trim();
  if (!phone) {
    console.error("Uso: node scripts/seed_catalogo_cochabamba.js <telefono>");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("✅ Conectado a MongoDB\n");

  let creados = 0, saltados = 0;
  for (const [categoria, item, precio] of ITEMS) {
    const nombre = `${categoria} — ${item}`;
    const yaExiste = await CatalogoTratamiento.findOne({ medicoPhone: phone, nombre });
    if (yaExiste) {
      saltados++;
      continue;
    }
    await CatalogoTratamiento.create({ medicoPhone: phone, nombre, precio });
    creados++;
  }

  console.log(`🏁 Listo. Ítems creados: ${creados} · ya existían (salteados): ${saltados}`);
  console.log(`Total del arancel cargado: ${ITEMS.length} ítems (no incluye los que en el folleto dicen "Convencional", sin precio fijo).`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
