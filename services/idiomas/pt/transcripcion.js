// Symphomed — Português (Brasil) · vocabulário para o transcritor.
//
// ═══ POR QUÉ EL PORTUGUÉS NO ES SOLO CAMBIAR "es" POR "pt" ═════════════════
//
// El Medical Mode de AssemblyAI (domain: "medical-v1") solo existe para
// inglés, español, alemán y francés. Para portugués la API IGNORA el
// parámetro y devuelve un aviso: la transcripción sale igual, pero sin el
// modelo que entiende medicamentos, dosis y procedimientos.
//   https://www.assemblyai.com/docs/pre-recorded-audio/medical-mode
//
// O sea que en portugués perdemos justamente lo que Symphomed vende. Lo único
// que queda para compensar es keyterms_prompt, que sí funciona en cualquier
// idioma. Por eso el vocabulario de abajo no es un extra en portugués: es lo
// principal.
//
// Y no es la lista en español traducida. En Brasil se dice losartana y no
// losartán, varfarina y no warfarina, dipirona por metamizol, cinomose por
// moquillo, puericultura por control de niño sano. Un término mal escrito no
// solo no ayuda: le enseña al modelo una palabra que nadie va a decir.
//
// ⚠️ ESTA LISTA NO LA REVISÓ TODAVÍA UN MÉDICO BRASILEÑO. Está armada con la
// nomenclatura DCB (Denominação Comum Brasileira, la oficial de ANVISA)
// donde corresponde, pero hasta que alguien que atiende en Brasil la lea,
// tratala como un borrador informado y no como algo verificado.

// Ver el aviso de arriba: acá el vocabulario no acompaña al Medical Mode,
// lo reemplaza.
const generales = [
  // Nombres DCB. Los que difieren del español están marcados porque son los
  // que más fácil se cuelan mal traducidos.
  "paracetamol", "ibuprofeno", "amoxicilina", "diclofenaco", "omeprazol",
  "dipirona",              // en español sería metamizol; en Brasil es lo más recetado que hay
  "loratadina", "metformina",
  "losartana",             // NO "losartán"
  "atorvastatina", "azitromicina", "ciprofloxacino", "prednisona",
  "salbutamol", "insulina",
  "varfarina",             // NO "warfarina"
  "hipertensão", "diabetes", "gastrite", "faringite", "bronquite",
  "pressão arterial",
  "glicemia",              // en Brasil se dice glicemia, no glucosa
  "colesterol", "eletrocardiograma", "hemograma",
  "radiografia", "ressonância magnética", "tomografia", "biópsia",
  // Cómo se dictan las indicaciones en Brasil. Sin esto, la posología —que
  // es lo que no se puede equivocar— sale hecha pedazos.
  "posologia", "comprimido", "via oral", "de 8 em 8 horas", "em jejum",
];

const porEspecialidad = {
  odontologia: [
    "odontograma", "dente", "cárie", "cárie oclusal", "cárie interproximal",
    "endodontia", "tratamento de canal",   // lo segundo es como lo dice todo el mundo
    "restauração", "resina", "amálgama", "coroa", "selante",
    "extração", "exodontia", "implante", "periodontite", "gengivite",
    "tártaro", "placa bacteriana", "profilaxia", "pulpite", "abscesso",
    "maxila", "mandíbula", "molar", "pré-molar", "canino", "incisivo",
    "oclusão", "bruxismo", "ortodontia", "aparelho", "prótese",
  ],
  oftalmologia: [
    "acuidade visual", "miopia", "astigmatismo", "hipermetropia", "presbiopia",
    "catarata", "glaucoma", "retina", "córnea", "cristalino", "conjuntivite",
    "pressão intraocular", "fundo de olho", "mácula", "nervo óptico",
    "ceratite", "uveíte", "estrabismo", "dioptrias", "grau",
  ],
  ginecologia: [
    "gravidez", "gestação", "semanas de gestação",
    "ultrassom obstétrico",   // en Brasil "ultrassom", no "ecografía"
    "exame preventivo", "papanicolau", "colposcopia",
    "menstruação", "amenorreia", "endométrio", "ovário", "útero",
    "cesariana",              // NO "cesárea"
    "parto", "anticoncepcional", "menopausa", "pré-eclâmpsia", "trimestre",
  ],
  neurodesarrollo: [
    "autismo", "transtorno do espectro autista", "TEA", "síndrome de Down",
    "trissomia 21", "neurodesenvolvimento", "perfil sensorial",
    "hiper-reatividade", "hiporreatividade", "estereotipias", "ecolalia",
    "desregulação", "comunicação aumentativa", "PECS", "integração sensorial",
    "terapia ocupacional", "fonoaudiologia", "psicomotricidade",
    "nível de suporte", "comportamentos restritos", "interesse restrito",
    "antecipação", "agenda visual", "TDAH", "hipotonia", "atlantoaxial",
    "hipotireoidismo",
    "estimulação precoce",    // en español "estimulación temprana"
    "inclusão escolar",
  ],
  pediatria: [
    "percentil", "curva de crescimento", "perímetro cefálico", "idade corrigida",
    "prematuro", "recém-nascido", "lactente", "pré-termo", "a termo",
    "aleitamento materno", "introdução alimentar", "fontanela", "reflexo de Moro",
    "desenvolvimento neuropsicomotor",
    "puericultura",           // el "control de niño sano" brasileño
    "pentavalente", "bronquiolite", "otite média", "faringoamigdalite",
    "exantema", "convulsão febril", "desidratação", "diarreia aguda",
    "peso ao nascer", "estatura", "miligramas por quilo", "gotas", "xarope",
    "suspensão",
  ],
  veterinaria: [
    "canino", "felino",
    "vermifugação",           // desparasitación
    "vacina antirrábica",
    "cinomose",               // moquillo
    "parvovirose", "castração", "esterilização", "carrapato", "pulgas",
    "dermatite", "otite", "peso corporal", "raça",
    "sem raça definida", "SRD",
  ],
  estetica: [
    "toxina botulínica", "botox", "ácido hialurônico",
    "preenchimento",          // el "relleno dérmico"
    "peeling", "mesoterapia", "papada",
    "fios de sustentação",    // hilos tensores
    "colágeno", "rugas", "sulco nasogeniano", "flacidez", "melasma", "laser",
  ],
};

// ─── Los fármacos más recetados ───
// Rellenan el lugar que sobra hasta 100 (una especialidad con lista larga
// deja menos). Escritos como en la lista oficial del país; lo comprueba
// scripts/pruebas/probar_medicamentos.js: un término mal escrito acá le
// enseñaría al transcriptor a escribirlo mal.
const farmacos = [
  "enalapril", "captopril", "anlodipino", "hidroclorotiazida", "furosemida", "espironolactona",
  "atenolol", "propranolol", "sinvastatina", "rosuvastatina", "glibenclamida", "gliclazida",
  "levotiroxina", "dexametasona", "prednisolona", "budesonida", "cetirizina", "desloratadina",
  "dexclorfeniramina", "ácido acetilsalicílico", "clopidogrel", "rivaroxabana", "sertralina",
  "fluoxetina", "escitalopram", "amitriptilina", "clonazepam", "ondansetrona", "metoclopramida",
  "bromoprida", "escopolamina", "cefalexina", "ceftriaxona", "sulfametoxazol", "trimetoprima",
  "nitrofurantoína", "metronidazol", "fluconazol", "pantoprazol", "tramadol", "nimesulida",
  "cetoprofeno", "estradiol", "progesterona", "ciproterona", "finasterida", "testosterona",
  "ácido fólico", "sulfato ferroso", "colecalciferol", "ivermectina", "albendazol",
  "gabapentina", "pregabalina", "quetiapina",
];

module.exports = { generales, porEspecialidad, farmacos };
