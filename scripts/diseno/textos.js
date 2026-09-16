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
// ═══ POR QUÉ ESTOS PÁRRAFOS SON CORTOS ═════════════════════════════════════
//
// Lo eran de 28 palabras cada uno. Alguien que miró la página de afuera dijo
// lo que ya se veía en los números: de la mitad para abajo son tres mil
// palabras, y el que entra se pierde antes de llegar al botón.
//
// El médico que mira esto no está estudiando el producto, está decidiendo en
// veinte segundos si escribe o si cierra. El título de cada módulo y el dato
// de ejemplo (las dos últimas entradas de cada fila) hacen casi todo el
// trabajo: son concretos y se leen de un vistazo. El párrafo del medio solo
// tiene que empujar hacia ellos, no explicar el módulo entero.
//
// Regla para el que venga a editar esto: si el párrafo no entra en dos
// renglones de celular, sobra. Lo que falte se cuenta en la demo, que es de
// lo que se trata el botón.
const MODULOS_TXT = {
  es: [
    ["ODONTOLOGÍA", "El odontograma, pieza por pieza.", "Cada diente con su historia. Se acabó el dibujo a mano en una hoja.", "Pieza 36", "Caries oclusal · Tratamiento de conducto · En control"],
    ["PEDIATRÍA", "Las curvas, calculadas solas.", "El percentil no se busca en la tabla: ya está calculado.", "Peso · percentil 62", "12,4 kg a los 24 meses · dentro de lo esperado"],
    // Este es el único que no se puede recortar más: la frase sobre qué NO
    // hace Symphomed es lo que evita que alguien crea que la plataforma
    // administra el instrumento.
    ["NEURODESARROLLO", "Quién lo aplicó, y con qué módulo.", "Symphomed no administra ni puntúa: guarda el resultado, fechado y firmado.", "", "ADOS-2 · módulo 2 · Lic. Torres, Reg. 4821"],
    ["GINECOLOGÍA Y OBSTETRICIA", "El control prenatal, semana a semana.", "Todos los controles sobre una sola línea de tiempo.", "", "Próximo control en 3 semanas · curva de tolerancia pendiente"],
    ["OFTALMOLOGÍA", "La agudeza y la refracción, en su ficha.", "Cada ojo contra el control anterior, sin releer la historia.", "", "El OI bajó de 20/25 a 20/40 desde el control de marzo"],
    ["IMÁGENES Y LABORATORIO", "Los estudios, dentro de la ficha.", "Radiografías con visor para medir. El equipo de rayos sube directo.", "", "Lo pendiente aparece en el panel hasta que llega"],
    ["SYMPHOMED PET", "La misma inteligencia. Otro paciente.", "Perros y gatos, con anatomía visual y su propio esquema de vacunas.", "", "Ficha por especie, no una ficha humana adaptada"],
  ],
  pt: [
    ["ODONTOLOGIA", "O odontograma, dente por dente.", "Cada dente com seu histórico. Acabou o desenho à mão numa folha.", "Dente 36", "Cárie oclusal · Tratamento de canal · Em controle"],
    ["PEDIATRIA", "As curvas, calculadas sozinhas.", "O percentil não se procura na tabela: já está calculado.", "Peso · percentil 62", "12,4 kg aos 24 meses · dentro do esperado"],
    ["NEURODESENVOLVIMENTO", "Quem aplicou, e com qual módulo.", "A Symphomed não administra nem pontua: guarda o resultado, datado e assinado.", "", "ADOS-2 · módulo 2 · Lic. Torres, Reg. 4821"],
    ["GINECOLOGIA E OBSTETRÍCIA", "O pré-natal, semana a semana.", "Todas as consultas numa única linha do tempo.", "", "Próximo retorno em 3 semanas · curva glicêmica pendente"],
    ["OFTALMOLOGIA", "A acuidade e a refração, no prontuário.", "Cada olho contra a consulta anterior, sem reler o histórico.", "", "O OE caiu de 20/25 para 20/40 desde o retorno de março"],
    ["IMAGEM E LABORATÓRIO", "Os exames, dentro do prontuário.", "Radiografias com visualizador para medir. O raio-X envia direto.", "", "O que está pendente aparece no painel até chegar"],
    ["SYMPHOMED PET", "A mesma inteligência. Outro paciente.", "Cães e gatos, com anatomia visual e esquema de vacinas próprio.", "", "Ficha por espécie, não uma ficha humana adaptada"],
  ],
  en: [
    ["DENTAL", "The odontogram, tooth by tooth.", "Every tooth with its history. No more drawing on a sheet of paper.", "Tooth 36", "Occlusal caries · Root canal · Under review"],
    ["PEDIATRICS", "Growth curves, plotted for you.", "You don't look the percentile up in a table: it's already there.", "Weight · 62nd percentile", "12.4 kg at 24 months · within the expected range"],
    ["NEURODEVELOPMENT", "Who administered it, and with which module.", "Symphomed neither administers nor scores: it keeps the result, dated and signed.", "", "ADOS-2 · module 2 · L. Torres, Reg. 4821"],
    ["OBSTETRICS & GYNECOLOGY", "Prenatal care, week by week.", "Every visit on a single timeline.", "", "Next visit in 3 weeks · glucose tolerance test pending"],
    ["OPHTHALMOLOGY", "Acuity and refraction, in the chart.", "Each eye against the previous visit, without rereading the history.", "", "Left eye dropped from 20/25 to 20/40 since the March visit"],
    ["IMAGING & LAB", "Studies, inside the chart.", "X-rays in a viewer you can measure in. The X-ray unit uploads directly.", "", "What's pending shows on the dashboard until it arrives"],
    ["SYMPHOMED PET", "Same intelligence. A different patient.", "Dogs and cats, with visual anatomy and their own vaccine schedule.", "", "A chart per species, not a human chart adapted"],
  ],
};

// ─── Las seis fichas de tecnología ─────────────────────────────────────────
// Cada una dice QUÉ LOGRA y nunca cómo está hecho. Ningún proveedor nombrado:
// eso es lo que un competidor necesitaría para copiar, y no le aporta nada al
// médico que está decidiendo si probar.
//
// ═══ LO QUE SE SACÓ DE ACÁ, Y POR QUÉ ══════════════════════════════════════
//
// La ficha de inteligencia artificial decía, en los tres idiomas, que
// Symphomed «aprende de las correcciones de cada médico, así que la nota se
// parece cada vez más a la suya». ERA FALSO. Las correcciones se guardan —hay
// una colección CorreccionIA y todo— pero NADA las lee: no alimentan ningún
// ajuste, ningún ejemplo, ninguna instrucción. La nota de hoy sale igual que
// la del primer día.
//
// Una promesa de producto que el producto no cumple no es una exageración de
// marketing, es algo que el primer médico atento va a notar a las dos semanas
// —y justamente el que más corrige es el que más rápido se da cuenta—. Se
// saca hasta que exista. Si algún día se construye, se vuelve a poner.
const TECNO_TXT = {
  es: [
    ["Inteligencia artificial", "Convierte la conversación en nota clínica: motivo, antecedentes, examen y plan."],
    ["Voz", "Transcribe con vocabulario clínico: fármacos, dosis y unidades. Sin dictar."],
    ["Lenguaje clínico", "Entiende que «sin fiebre» no es «fiebre». Ahí una transcripción se vuelve historia."],
    ["Datos estructurados", "Cada dato en su campo. Por eso se grafica, se compara y queda pendiente."],
    ["Integraciones", "Agenda sincronizada, rayos que suben solos y receta digital en Brasil."],
    ["Seguridad", "Cada médico ve solo a sus pacientes. Y sus historias se exportan completas."],
  ],
  pt: [
    ["Inteligência artificial", "Transforma a conversa em evolução: queixa, antecedentes, exame e conduta."],
    ["Voz", "Transcreve com vocabulário clínico: medicamentos, doses e unidades. Sem ditar."],
    ["Linguagem clínica", "Entende que «sem febre» não é «febre». Aí uma transcrição vira prontuário."],
    ["Dados estruturados", "Cada dado no seu campo. Por isso se plota, se compara e fica pendente."],
    ["Integrações", "Agenda sincronizada, raio-X que envia sozinho e receita digital no Brasil."],
    ["Segurança", "Cada médico vê só os seus pacientes. E os prontuários se exportam completos."],
  ],
  en: [
    ["Artificial intelligence", "Turns the conversation into a clinical note: complaint, history, exam and plan."],
    ["Voice", "Transcribes with clinical vocabulary: drugs, doses and units. No dictating."],
    ["Clinical language", "It knows “no fever” isn't “fever”. That's where a transcript becomes a record."],
    ["Structured data", "Every value in its own field. That's why it plots, compares and flags as pending."],
    ["Integrations", "Calendar in sync, X-rays that upload themselves, digital prescriptions in Brazil."],
    ["Security", "Each clinician sees only their patients. And records export in full."],
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

// ═══ LAS BANDAS DE WHATSAPP ════════════════════════════════════════════════
//
// Antes había TRES botones de WhatsApp en toda la página: uno arriba, uno en
// el medio y el de abajo de todo. Alguien que mira el carrusel de módulos y
// se convence en ese momento tenía que seguir bajando por la sección de
// confianza y la de tecnología para encontrar dónde escribir. La mayoría no
// baja: cierra.
//
// Estas bandas van DESPUÉS de cada bloque que convence, para que el botón
// esté siempre a un pulgar de distancia del momento en que se decidió.
//
// Cada una dice algo distinto a propósito. Tres veces "Escribinos por
// WhatsApp" se lee como un banner y se ignora; lo que se mira es el texto de
// al lado, y por eso cada banda levanta una objeción diferente: cuánto
// cuesta empezar, cuánto tiempo lleva, y qué pasa si no me gusta.
const BANDAS = {
  es: [
    { texto: "La agenda sola ya le devuelve el día. ¿Se la mostramos?",
      boton: "Escribinos por WhatsApp →" },
    { texto: "¿Quiere ver el módulo de su especialidad con un caso suyo?",
      boton: "Escribinos por WhatsApp →" },
    { texto: "Se lo mostramos en quince minutos. Las primeras 4 consultas no se cobran.",
      boton: "Quiero una demostración →" },
  ],
  pt: [
    { texto: "Só a agenda já devolve o seu dia. Quer ver?",
      boton: "Fale conosco no WhatsApp →" },
    { texto: "Quer ver o módulo da sua especialidade com um caso seu?",
      boton: "Fale conosco no WhatsApp →" },
    { texto: "Mostramos em quinze minutos. As primeiras 4 consultas não são cobradas.",
      boton: "Quero uma demonstração →" },
  ],
  en: [
    { texto: "The scheduling alone gives you your day back. Want to see it?",
      boton: "Message us on WhatsApp →" },
    { texto: "Want to see your specialty's module with one of your own cases?",
      boton: "Message us on WhatsApp →" },
    { texto: "We'll show you in fifteen minutes. The first 4 consultations are free.",
      boton: "Book a demo →" },
  ],
};
module.exports.BANDAS = BANDAS;

// ═══ EL BOTÓN QUE SIGUE AL PULGAR ══════════════════════════════════════════
//
// El dato que lo justifica: la página son ONCE PANTALLAS de celular, y los
// botones estaban en la 0, la 0,5 y la 10. Entre medio, siete pantallas y
// media de scroll sin una sola forma de escribir. Alguien que se convence
// mirando el odontograma —pantalla 5, más o menos— tiene que seguir bajando
// medio minuto hasta encontrar dónde tocar. La mayoría no baja: cierra.
//
// Las bandas achican el hueco. Este botón lo elimina: a partir de la primera
// pantalla queda fijo abajo y ya no se va. Se esconde solo cuando el bloque
// final entra en cuadro, para no taparle su propio botón.
//
// Solo en celular. En una computadora hay una barra arriba con el botón
// siempre visible y el ancho sobra; ahí un botón flotante sería estorbo.
const FLOTANTE = {
  es: "Escribinos por WhatsApp",
  pt: "Fale conosco no WhatsApp",
  en: "Message us on WhatsApp",
};
module.exports.FLOTANTE = FLOTANTE;

// ─── Las rutas de cada versión ─────────────────────────────────────────────
// El español vive en la raíz porque es el idioma del mercado donde Symphomed
// ya está vendiendo. Las otras dos cuelgan de su propio camino, y NO de un
// parámetro ni de negociación de contenido en la misma URL: una URL que
// devuelve cosas distintas según quién la pida no se puede compartir, no se
// puede indexar bien y no se puede cachear.
const RUTAS = { es: "/", pt: "/pt", en: "/en" };
module.exports.RUTAS = RUTAS;
