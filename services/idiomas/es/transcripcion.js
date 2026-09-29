// Symphomed — Español (Bolivia) · vocabulario para el transcriptor.
//
// Se le anuncia a AssemblyAI (keyterms_prompt) para que reconozca estas
// palabras. En español además existe el Medical Mode de AssemblyAI; esto lo
// afina. Cómo se arma la lista final (y el tope de 100):
// services/assemblyai.js → keytermsPara.

const generales = [
  "paracetamol", "ibuprofeno", "amoxicilina", "diclofenaco", "omeprazol",
  "loratadina", "metformina", "losartán", "atorvastatina", "azitromicina",
  "ciprofloxacino", "prednisona", "salbutamol", "insulina", "warfarina",
  "hipertensión", "diabetes", "gastritis", "faringitis", "bronquitis",
  "presión arterial", "glucosa", "colesterol", "electrocardiograma",
  "radiografía", "resonancia magnética", "tomografía", "biopsia",
];

// Vocabulario propio de cada rama, que se suma al general. Sin esto, un
// odontólogo dictando "pieza 36 con caries oclusal" pelea contra un modelo
// afinado para medicina general — y justamente esos términos son los que
// después alimentan el odontograma automático.
const porEspecialidad = {
  odontologia: [
    "odontograma", "pieza dental", "caries", "caries oclusal", "caries interproximal",
    "endodoncia", "obturación", "resina", "amalgama", "corona", "sellante",
    "extracción", "exodoncia", "implante", "periodontitis", "gingivitis",
    "sarro", "placa bacteriana", "profilaxis", "pulpitis", "absceso",
    "maxilar", "mandíbula", "molar", "premolar", "canino", "incisivo",
    "oclusión", "bruxismo", "ortodoncia", "brackets", "prótesis",
  ],
  oftalmologia: [
    "agudeza visual", "miopía", "astigmatismo", "hipermetropía", "presbicia",
    "catarata", "glaucoma", "retina", "córnea", "cristalino", "conjuntivitis",
    "presión intraocular", "fondo de ojo", "mácula", "nervio óptico",
    "queratitis", "uveítis", "estrabismo", "dioptrías",
  ],
  ginecologia: [
    "embarazo", "gestación", "semanas de gestación", "ecografía obstétrica",
    "papanicolau", "colposcopía", "menstruación", "amenorrea", "endometrio",
    "ovario", "útero", "cesárea", "parto", "anticonceptivo", "menopausia",
    "preeclampsia", "trimestre",
  ],
  neurodesarrollo: [
    "autismo", "trastorno del espectro autista", "TEA", "síndrome de Down",
    "trisomía 21", "neurodesarrollo", "perfil sensorial", "hiperreactividad",
    "hiporreactividad", "estereotipias", "ecolalia", "desregulación",
    "comunicación aumentativa", "PECS", "integración sensorial",
    "terapia ocupacional", "fonoaudiología", "psicomotricidad",
    "nivel de apoyo", "conductas restringidas", "interés restringido",
    "anticipación", "agenda visual", "TDAH", "hipotonía", "atlantoaxial",
    "hipotiroidismo", "estimulación temprana", "inclusión escolar",
  ],
  pediatria: [
    "percentil", "curva de crecimiento", "perímetro cefálico", "edad corregida",
    "prematuro", "recién nacido", "lactante", "pretérmino", "a término",
    "lactancia materna", "ablactación", "fontanela", "reflejo de Moro",
    "desarrollo psicomotor", "control de niño sano", "pentavalente",
    "bronquiolitis", "otitis media", "faringoamigdalitis", "exantema",
    "convulsión febril", "deshidratación", "diarrea aguda", "peso al nacer",
    "talla", "milígramos por kilo", "gotas", "jarabe", "suspensión",
  ],
  veterinaria: [
    "canino", "felino", "desparasitación", "vacuna antirrábica", "moquillo",
    "parvovirus", "castración", "esterilización", "garrapata", "pulgas",
    "dermatitis", "otitis", "peso corporal", "raza", "mestizo",
  ],
  estetica: [
    "toxina botulínica", "bótox", "ácido hialurónico", "relleno dérmico",
    "peeling", "mesoterapia", "lipopapada", "hilos tensores", "colágeno",
    "arrugas", "surco nasogeniano", "flacidez", "melasma", "láser",
  ],
};

// ─── Los fármacos más recetados ───
// Rellenan el lugar que sobra hasta 100 (una especialidad con lista larga
// deja menos). Escritos como en la lista oficial del país; lo comprueba
// scripts/pruebas/probar_medicamentos.js: un término mal escrito acá le
// enseñaría al transcriptor a escribirlo mal.
const farmacos = [
  "metamizol", "enalapril", "amlodipino", "hidroclorotiazida", "furosemida", "espironolactona",
  "atenolol", "metoprolol", "carvedilol", "simvastatina", "glibenclamida", "gliclazida",
  "levotiroxina", "dexametasona", "hidrocortisona", "budesonida", "cetirizina", "clorfenamina",
  "ácido acetilsalicílico", "clopidogrel", "enoxaparina", "sertralina", "fluoxetina",
  "escitalopram", "amitriptilina", "clonazepam", "diazepam", "ondansetrón", "metoclopramida",
  "hioscina", "cefalexina", "ceftriaxona", "cotrimoxazol", "nitrofurantoína", "metronidazol",
  "fluconazol", "ketorolaco", "naproxeno", "tramadol", "pantoprazol", "levonorgestrel",
  "medroxiprogesterona", "ácido fólico", "sulfato ferroso", "ácido valproico", "carbamazepina",
  "albendazol", "nitazoxanida", "ivermectina", "gabapentina", "pregabalina", "quetiapina",
];

module.exports = { generales, porEspecialidad, farmacos };
