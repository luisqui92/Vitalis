// Symphomed — Los textos de la página de inicio, en los tres idiomas.
//
// ═══ POR QUÉ ESTÁN ACÁ Y NO EN EL GUION DE CONSTRUCCIÓN ════════════════════
//
// Con un idioma, las traducciones cabían al lado del código. Con tres, el
// guion se volvía ilegible: por cada frase habría tres renglones mezclados
// con la lógica de reemplazo.
//
// Separarlos tiene una ventaja más: este archivo se le puede pasar a alguien
// que hable portugués o inglés de verdad para que lo revise, sin que tenga
// que entender nada de JavaScript.
//
// ═══ CÓMO SE LEE ══════════════════════════════════════════════════════════
//
// La clave de cada entrada es el texto EN INGLÉS del diseño original, que es
// lo que se busca y se reemplaza. El inglés de salida muchas veces es ese
// mismo texto —el diseño vino en inglés— salvo donde se reescribió la idea.

const ES = "es", PT = "pt", EN = "en";
const IDIOMAS = [ES, PT, EN];

// Nombre del idioma como lo ve el visitante, en su propio idioma.
const NOMBRES = { es: "ES", pt: "PT", en: "EN" };

// El mensaje de WhatsApp sale en el idioma de quien escribe: si un médico
// brasileño toca el botón y el mensaje aparece en español, la primera
// impresión ya se perdió.
const WA_TEXTO = {
  es: "Hola, quiero ver una demostración de Symphomed",
  pt: "Olá, quero ver uma demonstração do Symphomed",
  en: "Hi, I'd like to see a Symphomed demo",
};

// ─── Cabecera de cada versión ──────────────────────────────────────────────
const CABEZA = {
  es: {
    titulo: "Symphomed — la capa de inteligencia para la salud",
    descripcion: "Symphomed convierte la conversación de la consulta en información clínica estructurada: la nota, la receta y el control quedan listos sin que el médico escriba nada.",
    ogTitulo: "Symphomed — la capa de inteligencia para la salud",
    ogDescripcion: "La nota clínica, la receta y el kardex salen de la consulta sin tipear. Las primeras 4 consultas no se cobran.",
  },
  pt: {
    titulo: "Symphomed — a camada de inteligência para a saúde",
    descripcion: "O Symphomed transforma a conversa da consulta em informação clínica estruturada: a evolução, a receita e o retorno ficam prontos sem que o médico digite nada.",
    ogTitulo: "Symphomed — a camada de inteligência para a saúde",
    ogDescripcion: "A evolução, a receita e o histórico saem da consulta sem digitar. As primeiras 4 consultas não são cobradas.",
  },
  en: {
    titulo: "Symphomed — the intelligence layer for healthcare",
    descripcion: "Symphomed turns the consultation into structured clinical information: the note, the prescription and the follow-up are ready without the clinician typing a word.",
    ogTitulo: "Symphomed — the intelligence layer for healthcare",
    ogDescripcion: "The clinical note, the prescription and the chart come out of the consultation without typing. The first 4 consultations are free.",
  },
};

// ─── Las frases del diseño original ────────────────────────────────────────
// [ texto a buscar, { es, pt, en } ]
const FRASES = [
  // — Navegación —
  ['<a href="#platform">Platform</a>', {
    es: '<a href="#plataforma">Plataforma</a><a href="#agenda">Agenda</a><a href="/mapa">Mapa</a>',
    pt: '<a href="#plataforma">Plataforma</a><a href="#agenda">Agenda</a><a href="/mapa">Mapa</a>',
    en: '<a href="#plataforma">Platform</a><a href="#agenda">Scheduling</a><a href="/mapa">Map</a>',
  }],
  ['<a href="#specialties">Specialties</a>', {
    es: '<a href="#especialidades">Especialidades</a>',
    pt: '<a href="#especialidades">Especialidades</a>',
    en: '<a href="#especialidades">Specialties</a>',
  }],
  ['<a href="#solutions">Solutions</a>', {
    es: '<a href="#soluciones">Soluciones</a>',
    pt: '<a href="#soluciones">Soluções</a>',
    en: '<a href="#soluciones">Modules</a>',
  }],
  ['<a href="#technology">Technology</a>', {
    es: '<a href="#tecnologia">Tecnología</a>',
    pt: '<a href="#tecnologia">Tecnologia</a>',
    en: '<a href="#tecnologia">Technology</a>',
  }],
  ['<a href="#security">Security</a>', {
    es: '<a href="#confianza">Confianza</a>',
    pt: '<a href="#confianza">Confiança</a>',
    en: '<a href="#confianza">Trust</a>',
  }],
  ['<a href="#">Log in</a>', {
    es: '<a href="__PLATAFORMA__">Ingresar</a>',
    pt: '<a href="__PLATAFORMA__">Entrar</a>',
    en: '<a href="__PLATAFORMA__">Log in</a>',
  }],

  // — Portada —
  ["THE INTELLIGENCE LAYER FOR HEALTHCARE", {
    es: "LA CAPA DE INTELIGENCIA PARA LA SALUD",
    pt: "A CAMADA DE INTELIGÊNCIA PARA A SAÚDE",
    en: "THE INTELLIGENCE LAYER FOR HEALTHCARE",
  }],
  // El largo es parte del diseño: el titular vive en una columna del 43% a
  // 68px con letter-spacing negativo. Las tres versiones tienen que medir
  // parecido o se montan sobre la foto.
  ["Clinical conversations.<br><span>Intelligent care.</span>", {
    es: "Conversación clínica.<br><span>Historia inteligente.</span>",
    pt: "Conversa clínica.<br><span>Prontuário inteligente.</span>",
    en: "Clinical conversations.<br><span>Intelligent care.</span>",
  }],
  ["Symphomed transforms healthcare conversations into structured clinical intelligence — helping professionals capture, understand and connect information throughout the patient journey.", {
    es: "Symphomed convierte la conversación de la consulta en información clínica estructurada: la nota, la receta y el control siguiente quedan listos sin que el médico escriba nada.",
    pt: "O Symphomed transforma a conversa da consulta em informação clínica estruturada: a evolução, a receita e o retorno ficam prontos sem que o médico digite nada.",
    en: "Symphomed turns the consultation into structured clinical information: the note, the prescription and the next follow-up are ready without the clinician typing a word.",
  }],
  ["Explore the platform", { es: "Conocer la plataforma", pt: "Conhecer a plataforma", en: "Explore the platform" }],
  ["More time with patients", { es: "Más tiempo con el paciente", pt: "Mais tempo com o paciente", en: "More time with patients" }],
  ["Better clinical information", { es: "Mejor información clínica", pt: "Melhor informação clínica", en: "Better clinical information" }],
  ["Continuity of care", { es: "Continuidad del cuidado", pt: "Continuidade do cuidado", en: "Continuity of care" }],

  // — Tarjetas de la portada —
  ["<b>Patient</b>“I've had this pain for about three weeks, especially in the morning...”", {
    es: "<b>Paciente</b>“Me duele hace unas tres semanas, sobre todo en las mañanas…”",
    pt: "<b>Paciente</b>“Dói há umas três semanas, principalmente de manhã…”",
    en: "<b>Patient</b>“I've had this pain for about three weeks, especially in the morning…”",
  }],
  ["<label>Chief complaint</label><div>Back pain</div>", {
    es: "<label>Motivo</label><div>Dolor lumbar</div>",
    pt: "<label>Queixa</label><div>Dor lombar</div>",
    en: "<label>Chief complaint</label><div>Low back pain</div>",
  }],
  ["<label>Duration</label><div>3 weeks</div>", {
    es: "<label>Tiempo</label><div>3 semanas</div>",
    pt: "<label>Tempo</label><div>3 semanas</div>",
    en: "<label>Duration</label><div>3 weeks</div>",
  }],
  ["<label>Medication</label><div>Ibuprofen 400 mg</div>", {
    es: "<label>Medicación</label><div>Ibuprofeno 400 mg</div>",
    pt: "<label>Medicação</label><div>Ibuprofeno 400 mg</div>",
    en: "<label>Medication</label><div>Ibuprofen 400 mg</div>",
  }],
  ["<label>Relevant history</label><div>Previous episode</div>", {
    es: "<label>Antecedentes</label><div>Episodio previo</div>",
    pt: "<label>Antecedentes</label><div>Episódio prévio</div>",
    en: "<label>Relevant history</label><div>Previous episode</div>",
  }],
  ["<h4>Clinical record</h4>", {
    es: "<h4>Ficha del paciente</h4>", pt: "<h4>Prontuário</h4>", en: "<h4>Patient record</h4>",
  }],
  ["<b>Clinical note</b><br>Patient reports lumbar pain of 3 weeks duration, worse in the morning. No radiation. Prescribed follow-up and clinical review.", {
    es: "<b>Nota clínica</b><br>Refiere dolor lumbar de 3 semanas, de predominio matinal. Sin irradiación. Se indica control y revisión clínica.",
    pt: "<b>Evolução</b><br>Refere dor lombar há 3 semanas, de predomínio matinal. Sem irradiação. Indicado retorno e revisão clínica.",
    en: "<b>Clinical note</b><br>Reports low back pain for 3 weeks, worse in the morning. No radiation. Follow-up and clinical review indicated.",
  }],
  ["✓ Save to patient record", {
    es: "✓ Guardar en la ficha", pt: "✓ Salvar no prontuário", en: "✓ Save to patient record",
  }],

  // — Cómo funciona —
  ["HOW IT WORKS", { es: "CÓMO FUNCIONA", pt: "COMO FUNCIONA", en: "HOW IT WORKS" }],
  ["From conversation<br>to clinical intelligence.", {
    es: "De la conversación<br>a la historia clínica.",
    pt: "Da conversa<br>ao prontuário.",
    en: "From conversation<br>to clinical record.",
  }],
  ["Symphomed listens, understands and structures each consultation automatically, turning unstructured conversations into actionable clinical data.", {
    es: "Symphomed escucha, entiende y ordena cada consulta de forma automática, y convierte lo que se habló en datos clínicos que sirven.",
    pt: "O Symphomed escuta, entende e organiza cada consulta automaticamente, e transforma o que foi falado em dados clínicos que servem.",
    en: "Symphomed listens, understands and structures each consultation automatically, turning what was said into clinical data you can use.",
  }],
  ["<h3>1. Listen</h3><p>Captures the clinical conversation.</p>", {
    es: "<h3>1. Escucha</h3><p>Capta la conversación de la consulta.</p>",
    pt: "<h3>1. Escuta</h3><p>Capta a conversa da consulta.</p>",
    en: "<h3>1. Listen</h3><p>Captures the clinical conversation.</p>",
  }],
  ["<h3>2. Understand</h3><p>Identifies relevant clinical information.</p>", {
    es: "<h3>2. Entiende</h3><p>Identifica la información clínica relevante.</p>",
    pt: "<h3>2. Entende</h3><p>Identifica a informação clínica relevante.</p>",
    en: "<h3>2. Understand</h3><p>Identifies the relevant clinical information.</p>",
  }],
  ["<h3>3. Structure</h3><p>Generates organized clinical data.</p>", {
    es: "<h3>3. Ordena</h3><p>Genera la nota clínica estructurada.</p>",
    pt: "<h3>3. Organiza</h3><p>Gera a evolução estruturada.</p>",
    en: "<h3>3. Structure</h3><p>Generates the structured clinical note.</p>",
  }],
  ["<h3>4. Connect</h3><p>Updates the patient's history for continuity.</p>", {
    es: "<h3>4. Conecta</h3><p>Actualiza la historia del paciente para el próximo control.</p>",
    pt: "<h3>4. Conecta</h3><p>Atualiza o histórico do paciente para o próximo retorno.</p>",
    en: "<h3>4. Connect</h3><p>Updates the patient's history for the next visit.</p>",
  }],

  // — Plataforma —
  ["<span>Clinical workspace</span>", {
    es: "<span>Consultorio</span>", pt: "<span>Consultório</span>", en: "<span>Clinical workspace</span>",
  }],
  ["<div>Patient</div><div>Consultation</div><div>Clinical data</div><div>History</div><div>Kardex</div><div>Prescriptions</div>", {
    es: "<div>Paciente</div><div>Consulta</div><div>Datos clínicos</div><div>Historia</div><div>Kardex</div><div>Recetas</div>",
    pt: "<div>Paciente</div><div>Consulta</div><div>Dados clínicos</div><div>Histórico</div><div>Kardex</div><div>Receitas</div>",
    en: "<div>Patient</div><div>Consultation</div><div>Clinical data</div><div>History</div><div>Chart</div><div>Prescriptions</div>",
  }],
  ["<h4>Clinical data</h4>", { es: "<h4>Datos clínicos</h4>", pt: "<h4>Dados clínicos</h4>", en: "<h4>Clinical data</h4>" }],
  ["<b>Chief complaint</b><span>Headache</span>", {
    es: "<b>Motivo</b><span>Cefalea</span>", pt: "<b>Queixa</b><span>Cefaleia</span>", en: "<b>Chief complaint</b><span>Headache</span>",
  }],
  ["<b>Duration</b><span>3 weeks</span>", {
    es: "<b>Tiempo</b><span>3 semanas</span>", pt: "<b>Tempo</b><span>3 semanas</span>", en: "<b>Duration</b><span>3 weeks</span>",
  }],
  ["<b>Medication</b><span>Ibuprofen 400 mg</span>", {
    es: "<b>Medicación</b><span>Ibuprofeno 400 mg</span>", pt: "<b>Medicação</b><span>Ibuprofeno 400 mg</span>", en: "<b>Medication</b><span>Ibuprofen 400 mg</span>",
  }],
  ["<b>Assessment</b><span>Tension headache</span>", {
    es: "<b>Impresión</b><span>Cefalea tensional</span>", pt: "<b>Impressão</b><span>Cefaleia tensional</span>", en: "<b>Assessment</b><span>Tension headache</span>",
  }],
  ["<b>History</b><span>No relevant history</span>", {
    es: "<b>Antecedentes</b><span>Sin antecedentes</span>", pt: "<b>Antecedentes</b><span>Sem antecedentes</span>", en: "<b>History</b><span>No relevant history</span>",
  }],
  ["<b>Plan</b><span>Follow-up</span>", {
    es: "<b>Plan</b><span>Control</span>", pt: "<b>Conduta</b><span>Retorno</span>", en: "<b>Plan</b><span>Follow-up</span>",
  }],
  ["A COMPLETE CLINICAL PICTURE", {
    es: "LA FICHA COMPLETA", pt: "O PRONTUÁRIO COMPLETO", en: "A COMPLETE CLINICAL PICTURE",
  }],
  ["One conversation.<br>A complete clinical picture.", {
    es: "Una consulta.<br>La ficha completa.",
    pt: "Uma consulta.<br>O prontuário completo.",
    en: "One conversation.<br>A complete clinical picture.",
  }],
  ["Symphomed captures the conversation, identifies key information and generates structured clinical data — ready for review and integration with the patient's record.", {
    es: "Symphomed capta la conversación, reconoce lo importante y arma la nota clínica estructurada, lista para que el médico la revise y la guarde en la ficha.",
    pt: "O Symphomed capta a conversa, reconhece o que importa e monta a evolução estruturada, pronta para o médico revisar e salvar no prontuário.",
    en: "Symphomed captures the conversation, identifies what matters and builds the structured clinical note, ready for the clinician to review and save.",
  }],
  ["▶ See it in action", { es: "▶ Ver una demostración", pt: "▶ Ver uma demonstração", en: "▶ See it in action" }],

  // — Especialidades —
  ["ONE PLATFORM. MULTIPLE HEALTHCARE EXPERIENCES.", {
    es: "UNA PLATAFORMA. TODAS LAS ESPECIALIDADES.",
    pt: "UMA PLATAFORMA. TODAS AS ESPECIALIDADES.",
    en: "ONE PLATFORM. EVERY SPECIALTY.",
  }],
  ["Built for the entire healthcare ecosystem.", {
    es: "Pensado para todo el consultorio.",
    pt: "Pensado para todo o consultório.",
    en: "Built for the whole practice.",
  }],
  ["From general practice to specialized care, Symphomed adapts to every professional, every specialty and every setting.", {
    es: "De la medicina general a la especialidad, Symphomed se adapta a cada profesional, cada especialidad y cada consultorio.",
    pt: "Da clínica geral à especialidade, o Symphomed se adapta a cada profissional, cada especialidade e cada consultório.",
    en: "From general practice to specialty care, Symphomed adapts to every professional, every specialty and every setting.",
  }],
  [">Medicine<", { es: ">Medicina general<", pt: ">Clínica geral<", en: ">General practice<" }],
  [">Dental<", { es: ">Odontología<", pt: ">Odontologia<", en: ">Dental<" }],
  [">Dermatology<", { es: ">Dermatología<", pt: ">Dermatologia<", en: ">Dermatology<" }],
  [">Ophthalmology<", { es: ">Oftalmología<", pt: ">Oftalmologia<", en: ">Ophthalmology<" }],
  [">Aesthetics<", { es: ">Estética<", pt: ">Estética<", en: ">Aesthetics<" }],
  [">Surgery<", { es: ">Cirugía<", pt: ">Cirurgia<", en: ">Surgery<" }],
  [">Gynecology<", { es: ">Ginecología<", pt: ">Ginecologia<", en: ">Gynecology<" }],
  [">Pediatrics<", { es: ">Pediatría<", pt: ">Pediatria<", en: ">Pediatrics<" }],
  [">Physiotherapy<", { es: ">Fisioterapia<", pt: ">Fisioterapia<", en: ">Physiotherapy<" }],
  [">Veterinary<", { es: ">Veterinaria<", pt: ">Veterinária<", en: ">Veterinary<" }],
  [">Telehealth<", { es: ">Teleconsulta<", pt: ">Teleconsulta<", en: ">Telehealth<" }],
  [">All specialties<", { es: ">Todas<", pt: ">Todas<", en: ">All<" }],

  // — Confianza y escala —
  ["TRUST & SCALE", { es: "CONFIANZA Y ESCALA", pt: "CONFIANÇA E ESCALA", en: "TRUST & SCALE" }],
  ["Intelligence that scales with your organization.", {
    es: "Crece con el consultorio.", pt: "Cresce com o consultório.", en: "It grows with your practice.",
  }],
  ["From a single professional to large healthcare networks, Symphomed is designed to grow with your operation.", {
    es: "De un solo profesional a una red de centros de salud, Symphomed está pensado para acompañar el crecimiento.",
    pt: "De um único profissional a uma rede de centros de saúde, o Symphomed acompanha o crescimento.",
    en: "From a single professional to a network of clinics, Symphomed is built to grow with you.",
  }],
  ["<small>Professional</small>", { es: "<small>Profesional</small>", pt: "<small>Profissional</small>", en: "<small>Professional</small>" }],
  ["<small>Professionals</small>", { es: "<small>Profesionales</small>", pt: "<small>Profissionais</small>", en: "<small>Professionals</small>" }],
  ["<small>Healthcare network</small>", { es: "<small>Red de salud</small>", pt: "<small>Rede de saúde</small>", en: "<small>Healthcare network</small>" }],

  // — Tecnología —
  [">TECHNOLOGY<", { es: ">TECNOLOGÍA<", pt: ">TECNOLOGIA<", en: ">TECHNOLOGY<" }],
  ["Built for intelligent healthcare.", {
    es: "Construido para la salud.", pt: "Construído para a saúde.", en: "Built for healthcare.",
  }],
  ["AI, voice, structured clinical data and integrations brought together in one healthcare intelligence platform.", {
    es: "Inteligencia artificial, voz, datos clínicos estructurados e integraciones, en una sola plataforma.",
    pt: "Inteligência artificial, voz, dados clínicos estruturados e integrações, em uma só plataforma.",
    en: "AI, voice, structured clinical data and integrations, in a single platform.",
  }],

  // — Cierre —
  ["GLOBAL HEALTHCARE INTELLIGENCE", { es: "EMPEZAR", pt: "COMEÇAR", en: "GET STARTED" }],
  ["Healthcare has conversations every day.<br>", {
    es: "En la salud se conversa todos los días.<br>",
    pt: "Na saúde se conversa todos os dias.<br>",
    en: "Healthcare has conversations every day.<br>",
  }],
  ["Symphomed turns them into intelligence.", {
    es: "Symphomed lo convierte en historia clínica.",
    pt: "O Symphomed transforma isso em prontuário.",
    en: "Symphomed turns them into clinical records.",
  }],
  ["Discover how Symphomed can become the intelligence layer behind your healthcare organization.", {
    es: "Escríbanos por WhatsApp y le mostramos cómo funciona con un caso real, en quince minutos. Las primeras 4 consultas no se cobran.",
    pt: "Fale com a gente pelo WhatsApp e mostramos como funciona com um caso real, em quinze minutos. As primeiras 4 consultas não são cobradas.",
    en: "Message us on WhatsApp and we'll show you how it works with a real case, in fifteen minutes. The first 4 consultations are free.",
  }],

  // — Pie —
  ['<a href="#demo">Contact</a>', {
    es: '<a href="#demo">Contacto</a>', pt: '<a href="#demo">Contato</a>', en: '<a href="#demo">Contact</a>',
  }],
  ["© 2026 Symphomed", {
    es: "© 2026 Symphomed · Bolivia y Brasil",
    pt: "© 2026 Symphomed · Bolívia e Brasil",
    en: "© 2026 Symphomed · Bolivia & Brazil",
  }],

  // — Botones que llevan a WhatsApp —
  ['<a class="btn btn-primary" href="#demo">Book a demo</a>', {
    es: '<a class="btn btn-primary" href="__WA__">Escríbanos</a>',
    pt: '<a class="btn btn-primary" href="__WA__">Fale conosco</a>',
    en: '<a class="btn btn-primary" href="__WA__">Talk to us</a>',
  }],
  ['<a class="btn btn-primary" href="#demo">Book a demo →</a>', {
    es: '<a class="btn btn-primary" href="__WA__">Escríbanos por WhatsApp →</a>',
    pt: '<a class="btn btn-primary" href="__WA__">Fale conosco pelo WhatsApp →</a>',
    en: '<a class="btn btn-primary" href="__WA__">Message us on WhatsApp →</a>',
  }],
  ['<a class="btn btn-primary" href="mailto:demo@symphomed.com">Book a demo →</a>', {
    es: '<a class="btn btn-primary" href="__WA__">Escríbanos por WhatsApp →</a>',
    pt: '<a class="btn btn-primary" href="__WA__">Fale conosco pelo WhatsApp →</a>',
    en: '<a class="btn btn-primary" href="__WA__">Message us on WhatsApp →</a>',
  }],
];

// ─── La sección de la agenda ───────────────────────────────────────────────
const AGENDA = {
  es: {
    eyebrow: "LA AGENDA", h2: "Antes y después<br>de la consulta.",
    p: "Symphomed no empieza cuando el paciente entra ni termina cuando se va: la reserva y el control siguiente también se resuelven solos, por WhatsApp.",
    pasos: [
      ["✆", "El paciente reserva solo", "Escribe al WhatsApp del consultorio, ve los horarios que están libres de verdad y elige. La cita aparece en la agenda sin que nadie atienda el teléfono."],
      ["✓", "Queda confirmada al instante", "Recibe la confirmación en el momento. Si necesita cancelar, escribe «cancelar» ahí mismo y el horario se libera para otro paciente."],
      ["↻", "El seguimiento sigue solo", "Al cerrar la consulta, Symphomed propone la fecha del próximo control y le manda al paciente un enlace para que elija su horario."],
    ],
    recuerda: [
      ["Reconsultas", "El control que se acordó en la consulta, con la fecha que corresponde."],
      ["Laboratorios", "Los estudios que se pidieron y todavía no volvieron a la ficha."],
      ["Medicación", "Cuándo empieza y cuándo termina cada tratamiento, con su dosis y frecuencia."],
      ["Vacunas", "La dosis siguiente y las que quedaron pendientes del esquema."],
      ["Controles por edad", "Lo que toca revisar según la edad del paciente, sin depender de la memoria."],
    ],
  },
  pt: {
    eyebrow: "A AGENDA", h2: "Antes e depois<br>da consulta.",
    p: "O Symphomed não começa quando o paciente entra nem termina quando ele sai: o agendamento e o retorno também se resolvem sozinhos, pelo WhatsApp.",
    pasos: [
      ["✆", "O paciente agenda sozinho", "Manda mensagem no WhatsApp do consultório, vê os horários realmente livres e escolhe. A consulta entra na agenda sem ninguém atender o telefone."],
      ["✓", "Confirmado na hora", "Recebe a confirmação na mesma hora. Se precisar cancelar, escreve «cancelar» ali mesmo e o horário volta a ficar livre."],
      ["↻", "O acompanhamento continua sozinho", "Ao encerrar a consulta, o Symphomed propõe a data do próximo retorno e manda ao paciente um link para escolher o horário."],
    ],
    recuerda: [
      ["Retornos", "O retorno combinado na consulta, na data que corresponde."],
      ["Exames", "Os exames pedidos que ainda não voltaram ao prontuário."],
      ["Medicação", "Quando começa e quando termina cada tratamento, com dose e frequência."],
      ["Vacinas", "A próxima dose e as que ficaram pendentes no esquema."],
      ["Controles por idade", "O que precisa ser revisto conforme a idade do paciente, sem depender da memória."],
    ],
  },
  en: {
    eyebrow: "SCHEDULING", h2: "Before and after<br>the consultation.",
    p: "Symphomed doesn't start when the patient walks in or end when they leave: booking and the next follow-up also take care of themselves, over WhatsApp.",
    pasos: [
      ["✆", "Patients book themselves", "They message the practice on WhatsApp, see the slots that are actually free and pick one. The appointment lands in the calendar without anyone answering the phone."],
      ["✓", "Confirmed instantly", "They get the confirmation right away. If they need to cancel, they write “cancel” in the same chat and the slot opens up again."],
      ["↻", "Follow-up runs itself", "When the consultation closes, Symphomed proposes the next follow-up date and sends the patient a link to pick their time."],
    ],
    recuerda: [
      ["Follow-ups", "The review agreed during the consultation, on the right date."],
      ["Lab work", "Tests that were ordered and haven't come back to the chart yet."],
      ["Medication", "When each treatment starts and ends, with its dose and frequency."],
      ["Vaccines", "The next dose and the ones still missing from the schedule."],
      ["Age-based checks", "What's due according to the patient's age, without relying on memory."],
    ],
  },
};

module.exports = { IDIOMAS, ES, PT, EN, NOMBRES, WA_TEXTO, CABEZA, FRASES, AGENDA };

// ─── Los siete módulos del carrusel ────────────────────────────────────────
// Los datos de ejemplo (PA 150/95, 12,4 kg, CI total 94) NO se traducen: son
// mediciones, y una medición se escribe igual en los tres idiomas. Lo que se
// traduce son las etiquetas.
const MODULOS_TXT = {
  es: [
    ["ODONTOLOGÍA", "El odontograma, pieza por pieza.", "Cada diente con su historia, sus tratamientos y su evolución. La ficha dental deja de ser un dibujo a mano en una hoja.", "Pieza 36", "Caries oclusal · Tratamiento de conducto · En control"],
    ["PEDIATRÍA", "Las curvas, calculadas solas.", "Peso, talla y perímetro cefálico se grafican sobre los percentiles de la OMS a medida que se cargan. El percentil no se busca en una tabla: ya está.", "Peso · percentil 62", "12,4 kg a los 24 meses · dentro de lo esperado"],
    ["NEURODESARROLLO", "Los instrumentos, con su puntaje.", "ADOS-2, WISC-V, Vineland-3, Conners-4 y M-CHAT-R/F, cada uno con sus módulos y sus puntajes. Quedan en la ficha y se comparan entre aplicaciones.", "", "Aplicado el 14/03 · comparado con la evaluación anterior"],
    ["GINECOLOGÍA Y OBSTETRICIA", "El control prenatal, semana a semana.", "Altura uterina, frecuencia cardíaca fetal y presión en cada control, sobre la misma línea de tiempo. Y el examen ginecológico con su mapa propio.", "", "Próximo control en 3 semanas · curva de tolerancia pendiente"],
    ["OFTALMOLOGÍA", "La agudeza y la refracción, en su ficha.", "Cada ojo con su agudeza, su refracción y su presión intraocular, comparables contra el control anterior sin volver a leer la historia entera.", "", "El OI bajó de 20/25 a 20/40 desde el control de marzo"],
    ["IMÁGENES Y LABORATORIO", "Los estudios, dentro de la ficha.", "Las radiografías se abren en un visor que permite medir, y los laboratorios quedan marcados como pendientes hasta que vuelven. El equipo de rayos sube directo.", "", "Lo pendiente aparece en el panel hasta que llega"],
    ["SYMPHOMED PET", "La misma inteligencia. Otro paciente.", "Historia clínica completa para perros y gatos, con anatomía visual, esquema de vacunas propio y las particularidades de cada especie.", "", "Ficha por especie, no una ficha humana adaptada"],
  ],
  pt: [
    ["ODONTOLOGIA", "O odontograma, dente por dente.", "Cada dente com seu histórico, seus tratamentos e sua evolução. A ficha odontológica deixa de ser um desenho à mão numa folha.", "Dente 36", "Cárie oclusal · Tratamento de canal · Em controle"],
    ["PEDIATRIA", "As curvas, calculadas sozinhas.", "Peso, altura e perímetro cefálico são plotados sobre os percentis da OMS conforme são lançados. O percentil não se procura numa tabela: já está lá.", "Peso · percentil 62", "12,4 kg aos 24 meses · dentro do esperado"],
    ["NEURODESENVOLVIMENTO", "Os instrumentos, com sua pontuação.", "ADOS-2, WISC-V, Vineland-3, Conners-4 e M-CHAT-R/F, cada um com seus módulos e suas pontuações. Ficam no prontuário e se comparam entre aplicações.", "", "Aplicado em 14/03 · comparado com a avaliação anterior"],
    ["GINECOLOGIA E OBSTETRÍCIA", "O pré-natal, semana a semana.", "Altura uterina, frequência cardíaca fetal e pressão em cada consulta, na mesma linha do tempo. E o exame ginecológico com seu mapa próprio.", "", "Próximo retorno em 3 semanas · curva glicêmica pendente"],
    ["OFTALMOLOGIA", "A acuidade e a refração, no prontuário.", "Cada olho com sua acuidade, sua refração e sua pressão intraocular, comparáveis com a consulta anterior sem reler o histórico inteiro.", "", "O OE caiu de 20/25 para 20/40 desde o retorno de março"],
    ["IMAGEM E LABORATÓRIO", "Os exames, dentro do prontuário.", "As radiografias abrem num visualizador que permite medir, e os laboratoriais ficam marcados como pendentes até voltarem. O aparelho de raios-X envia direto.", "", "O que está pendente aparece no painel até chegar"],
    ["SYMPHOMED PET", "A mesma inteligência. Outro paciente.", "Prontuário completo para cães e gatos, com anatomia visual, esquema de vacinas próprio e as particularidades de cada espécie.", "", "Ficha por espécie, não uma ficha humana adaptada"],
  ],
  en: [
    ["DENTAL", "The odontogram, tooth by tooth.", "Every tooth with its history, its treatments and its progress. The dental chart stops being a drawing on a sheet of paper.", "Tooth 36", "Occlusal caries · Root canal · Under review"],
    ["PEDIATRICS", "Growth curves, plotted for you.", "Weight, height and head circumference are plotted against WHO percentiles as they're entered. You don't look the percentile up in a table: it's already there.", "Weight · 62nd percentile", "12.4 kg at 24 months · within the expected range"],
    ["NEURODEVELOPMENT", "Instruments, with their scores.", "ADOS-2, WISC-V, Vineland-3, Conners-4 and M-CHAT-R/F, each with its modules and scores. They stay in the chart and compare across administrations.", "", "Administered 14/03 · compared with the previous assessment"],
    ["OBSTETRICS & GYNECOLOGY", "Prenatal care, week by week.", "Fundal height, fetal heart rate and blood pressure at every visit, on one timeline. Plus the gynecological exam with its own map.", "", "Next visit in 3 weeks · glucose tolerance test pending"],
    ["OPHTHALMOLOGY", "Acuity and refraction, in the chart.", "Each eye with its acuity, refraction and intraocular pressure, comparable against the previous visit without rereading the whole history.", "", "Left eye dropped from 20/25 to 20/40 since the March visit"],
    ["IMAGING & LAB", "Studies, inside the chart.", "X-rays open in a viewer that lets you measure, and lab work stays flagged as pending until it comes back. The X-ray unit uploads directly.", "", "What's pending shows on the dashboard until it arrives"],
    ["SYMPHOMED PET", "Same intelligence. A different patient.", "Complete clinical records for dogs and cats, with visual anatomy, its own vaccine schedule and the particulars of each species.", "", "A chart per species, not a human chart adapted"],
  ],
};

// ─── Las seis fichas de tecnología ─────────────────────────────────────────
// Cada una dice QUÉ LOGRA y nunca cómo está hecho. Ningún proveedor nombrado:
// eso es lo que un competidor necesitaría para copiar, y no le aporta nada al
// médico que está decidiendo si probar.
const TECNO_TXT = {
  es: [
    ["Inteligencia artificial", "Reconoce lo que importa de una conversación y lo ordena como nota clínica: motivo, antecedentes, examen y plan. Y aprende de las correcciones de cada médico, así que la nota se parece cada vez más a la suya y menos a una plantilla."],
    ["Voz", "Transcribe la consulta mientras ocurre, con el vocabulario que una transcripción común no reconoce: nombres de fármacos, dosis, unidades y términos clínicos. Sin dictar y sin hablarle a la computadora: es la consulta normal."],
    ["Lenguaje clínico", "Distingue lo que dijo el paciente de lo que observó el médico, separa los antecedentes de los hallazgos de hoy y entiende las negaciones —«sin fiebre» no es lo mismo que «fiebre»—. Ahí es donde una transcripción se vuelve una historia clínica."],
    ["Datos estructurados", "Cada dato queda en su campo y no suelto en un párrafo. Por eso la presión de hoy se grafica junto a las de los controles anteriores, un estudio pedido puede figurar como pendiente, y una dosis se puede comparar con la anterior."],
    ["Integraciones", "El consultorio no queda aislado: la agenda se sincroniza con el calendario, el equipo de rayos sube los estudios directo a la ficha del paciente, y en Brasil la receta sale por el sistema de firma digital que exige la norma."],
    ["Seguridad", "Cada médico ve solo a sus pacientes, y eso no depende de que alguien se acuerde de filtrar: está sostenido por el código, en todas las pantallas a la vez. Y las historias se exportan completas el día que se quiera dejar de usar Symphomed."],
  ],
  pt: [
    ["Inteligência artificial", "Reconhece o que importa numa conversa e organiza como evolução: queixa, antecedentes, exame e conduta. E aprende com as correções de cada médico, então a evolução fica cada vez mais parecida com a dele e menos com um modelo pronto."],
    ["Voz", "Transcreve a consulta enquanto ela acontece, com o vocabulário que uma transcrição comum não reconhece: nomes de medicamentos, doses, unidades e termos clínicos. Sem ditar e sem falar com o computador: é a consulta normal."],
    ["Linguagem clínica", "Distingue o que o paciente disse do que o médico observou, separa os antecedentes dos achados de hoje e entende as negações — «sem febre» não é a mesma coisa que «febre». É aí que uma transcrição vira um prontuário."],
    ["Dados estruturados", "Cada dado fica no seu campo, não solto num parágrafo. Por isso a pressão de hoje é plotada junto com as das consultas anteriores, um exame pedido pode constar como pendente, e uma dose pode ser comparada com a anterior."],
    ["Integrações", "O consultório não fica isolado: a agenda sincroniza com o calendário, o aparelho de raios-X envia os exames direto ao prontuário, e no Brasil a receita sai pelo sistema de assinatura digital que a norma exige."],
    ["Segurança", "Cada médico vê apenas os seus pacientes, e isso não depende de alguém lembrar de filtrar: está garantido pelo código, em todas as telas ao mesmo tempo. E os prontuários se exportam completos no dia em que se quiser parar de usar o Symphomed."],
  ],
  en: [
    ["Artificial intelligence", "It recognizes what matters in a conversation and lays it out as a clinical note: complaint, history, examination and plan. And it learns from each clinician's corrections, so the note reads more like theirs and less like a template."],
    ["Voice", "It transcribes the consultation as it happens, with the vocabulary ordinary transcription misses: drug names, doses, units and clinical terms. No dictating, no talking to the computer: it's the normal consultation."],
    ["Clinical language", "It tells what the patient said from what the clinician observed, separates history from today's findings, and understands negation — “no fever” is not “fever”. That's where a transcript becomes a clinical record."],
    ["Structured data", "Every value lands in its own field instead of loose in a paragraph. That's why today's blood pressure plots alongside previous visits, an ordered test can show as pending, and a dose can be compared with the last one."],
    ["Integrations", "The practice isn't an island: the calendar syncs, the X-ray unit uploads studies straight into the patient's chart, and in Brazil prescriptions go out through the digital signature system the law requires."],
    ["Security", "Each clinician sees only their own patients, and that doesn't depend on someone remembering to filter: it's enforced in the code, across every screen at once. And records export in full the day you decide to stop using Symphomed."],
  ],
};

module.exports.MODULOS_TXT = MODULOS_TXT;
module.exports.TECNO_TXT = TECNO_TXT;

// ─── Las filas dentro de las pantallas del carrusel ────────────────────────
// Son las etiquetas de cada dato de ejemplo. Se me habían quedado en español
// dentro del HTML de cada módulo: la pantalla se veía traducida por fuera y
// decía "Altura uterina" en la versión inglesa, que es peor que no traducir.
//
// Los VALORES no se traducen —27 cm, 142 lpm, 20/25 son mediciones— salvo
// donde llevan una palabra ("Pendiente", "Recibida").
const FILAS = {
  neuro: {
    es: [["ADOS-2 · Módulo 2","Comparación 7/10"],["WISC-V","CI total 94"],["Vineland-3","Compuesto 88"],["Conners-4 · Padres","Inatención T 68"]],
    pt: [["ADOS-2 · Módulo 2","Comparação 7/10"],["WISC-V","QI total 94"],["Vineland-3","Composto 88"],["Conners-4 · Pais","Desatenção T 68"]],
    en: [["ADOS-2 · Module 2","Comparison 7/10"],["WISC-V","Full-scale IQ 94"],["Vineland-3","Composite 88"],["Conners-4 · Parent","Inattention T 68"]],
  },
  gineco: {
    es: [["Semana","28 · gesta 2, para 1"],["Altura uterina","27 cm"],["FCF","142 lpm"],["Presión","118/74 mmHg"]],
    pt: [["Semana","28 · gesta 2, para 1"],["Altura uterina","27 cm"],["BCF","142 bpm"],["Pressão","118/74 mmHg"]],
    en: [["Week","28 · G2 P1"],["Fundal height","27 cm"],["FHR","142 bpm"],["Blood pressure","118/74 mmHg"]],
  },
  oftalmo: {
    es: [["Agudeza OD","20/25"],["Agudeza OI","20/40"],["Refracción OI","−1,25 −0,50 × 180°"],["PIO","14 / 15 mmHg"]],
    pt: [["Acuidade OD","20/25"],["Acuidade OE","20/40"],["Refração OE","−1,25 −0,50 × 180°"],["PIO","14 / 15 mmHg"]],
    en: [["Acuity OD","20/25"],["Acuity OS","20/40"],["Refraction OS","−1.25 −0.50 × 180°"],["IOP","14 / 15 mmHg"]],
  },
  imagenes: {
    es: [["Rx tórax","Recibida · 14/03"],["Creatinina","Pendiente"]],
    pt: [["Rx tórax","Recebida · 14/03"],["Creatinina","Pendente"]],
    en: [["Chest X-ray","Received · 14/03"],["Creatinine","Pending"]],
  },
  pet: {
    es: [["Paciente","Mora · mestiza, 6 años"],["Peso","18,4 kg"],["Vacunas","Quíntuple al día · antirrábica en 2 meses"]],
    pt: [["Paciente","Mora · SRD, 6 anos"],["Peso","18,4 kg"],["Vacinas","Quíntupla em dia · antirrábica em 2 meses"]],
    en: [["Patient","Mora · mixed breed, 6 years"],["Weight","18.4 kg"],["Vaccines","DHPP up to date · rabies in 2 months"]],
  },
};
module.exports.FILAS = FILAS;

// ─── La cabecera del carrusel y lo que lee un lector de pantalla ───────────
// Las etiquetas de accesibilidad son texto que alguien va a ESCUCHAR. Dejarlas
// en español en la versión inglesa es peor que no traducir nada: quien navega
// con lector de pantalla escucha "Ir al módulo 3" en medio de una página en
// inglés y deja de entender dónde está.
const CARRUSEL_TXT = {
  es: {
    eyebrow: "MÓDULOS POR ESPECIALIDAD",
    h2: "Cada especialidad,<br>con su propia ficha.",
    p: "Una nota de pediatría no se parece a una de odontología, y las fichas tampoco. Estos son los módulos que ya están funcionando.",
    region: "Módulos por especialidad",
    de: "de", anterior: "Módulo anterior", siguiente: "Módulo siguiente", irA: "Ir al módulo",
    eje: ["0 m", "24 m"], curva: "Curva de peso sobre percentiles",
  },
  pt: {
    eyebrow: "MÓDULOS POR ESPECIALIDADE",
    h2: "Cada especialidade,<br>com o seu próprio prontuário.",
    p: "Uma evolução de pediatria não se parece com uma de odontologia, e os prontuários também não. Estes são os módulos que já estão funcionando.",
    region: "Módulos por especialidade",
    de: "de", anterior: "Módulo anterior", siguiente: "Próximo módulo", irA: "Ir ao módulo",
    eje: ["0 m", "24 m"], curva: "Curva de peso sobre percentis",
  },
  en: {
    eyebrow: "MODULES BY SPECIALTY",
    h2: "Every specialty,<br>with its own chart.",
    p: "A pediatrics note looks nothing like a dental one, and neither do the charts. These are the modules already running.",
    region: "Modules by specialty",
    de: "of", anterior: "Previous module", siguiente: "Next module", irA: "Go to module",
    eje: ["0 mo", "24 mo"], curva: "Weight curve against percentiles",
  },
};

// ─── Las dos especialidades que el diseño no traía ─────────────────────────
// Psicología y psiquiatría no estaban en el HTML original y sí en el producto:
// el catálogo de instrumentos ya trae WISC-V, WPPSI-IV, Vineland-3, Conners-4
// y ADOS-2, que son herramientas de psicología clínica.
const ESPECIALIDADES_EXTRA = {
  es: [["◈", "Psicología"], ["❋", "Psiquiatría"]],
  pt: [["◈", "Psicologia"], ["❋", "Psiquiatria"]],
  en: [["◈", "Psychology"], ["❋", "Psychiatry"]],
};

// ─── El selector de idioma ─────────────────────────────────────────────────
const SELECTOR = {
  es: "Idioma", pt: "Idioma", en: "Language",
};

module.exports.CARRUSEL_TXT = CARRUSEL_TXT;
module.exports.ESPECIALIDADES_EXTRA = ESPECIALIDADES_EXTRA;
module.exports.SELECTOR = SELECTOR;

// ─── Las rutas de cada versión ─────────────────────────────────────────────
// El español vive en la raíz porque es el idioma del mercado donde Symphomed
// ya está vendiendo. Las otras dos cuelgan de su propio camino, y NO de un
// parámetro ni de negociación de contenido en la misma URL: una URL que
// devuelve cosas distintas según quién la pida no se puede compartir, no se
// puede indexar bien y no se puede cachear.
const RUTAS = { es: "/", pt: "/pt", en: "/en" };
module.exports.RUTAS = RUTAS;
