// Symphomed — Português · agenda e horário de atendimento.
//
// Esta es la agenda del MÉDICO (su calendario), no el bot de reservas por
// WhatsApp, que quedó fuera del alcance de Brasil. El único texto que
// menciona WhatsApp acá es el estado de la conexión, que el médico ve en su
// propia pantalla.
Object.assign(I18N.pt, {
  "agenda.cargando": "Carregando agenda...",
  "agenda.error": "Erro ao carregar a agenda",
  "agenda.volver": "← Painel",
  "agenda.wa.titulo": "WhatsApp de agendamentos",
  "agenda.wa.sinConfigurar": "Ainda não está configurado. Você pode seguir usando a Agenda manualmente enquanto isso.",
  "agenda.wa.conectado": "Conectado — seus pacientes já podem agendar pelo WhatsApp.",
  "agenda.nuevaCita": "Nova consulta",
  "agenda.configurarHorario": "Configurar horário de atendimento",
  "agenda.calendario": "Calendário",
  "agenda.sinCitas": "Não há consultas neste dia.",
  "agenda.cancelar": "Cancelar",
  "agenda.confirmarCancelar": "Cancelar esta consulta?",

  "agenda.form.pacienteRegistrado": "Paciente cadastrado (opcional)",
  "agenda.form.pacienteSinRegistrar": "— Paciente novo / sem cadastro —",
  "agenda.form.nombreLibre": "Nome (se não for um paciente cadastrado)",
  "agenda.form.nombrePlaceholder": "Nome completo",
  "agenda.form.telefono": "Telefone (opcional)",
  "agenda.form.telefonoPlaceholder": "55XXXXXXXXXXX",
  "agenda.form.fechaHora": "Data e hora",
  "agenda.form.motivo": "Motivo (opcional)",
  "agenda.form.motivoPlaceholder": "Ex: Retorno",
  "agenda.form.guardar": "Salvar consulta",
  "agenda.form.errFaltanDatos": "Escolha um paciente ou escreva um nome, e uma data",
  "agenda.form.errGuardar": "Não foi possível salvar a consulta",

  "agenda.ficha.crear": "Criar ficha do paciente",
  "agenda.ficha.aviso": "Agendou pelo WhatsApp e ainda não tem ficha no Kardex. Confira os dados antes de criá-la:",
  "agenda.ficha.nombre": "Nome",
  "agenda.ficha.telefono": "Telefone",
  "agenda.ficha.boton": "Criar ficha",
  "agenda.ficha.creando": "Criando...",
  "agenda.ficha.errFaltaNombre": "Falta o nome",
  "agenda.ficha.errCrear": "Não foi possível criar a ficha",

  "horario.cargando": "Carregando...",
  "horario.error": "Erro ao carregar o horário",
  "horario.volver": "← Agenda",
  "horario.titulo": "Dias e horários de atendimento",
  "horario.ayuda": "Marque os dias em que você atende, com o horário. Os dias sem marcação não oferecem vagas.",
  "horario.duracion": "Duração de cada consulta (minutos)",
  "horario.googleCalendar": "Google Agenda (opcional)",
  "horario.googleCalendarPlaceholder": "seu-email@gmail.com",
  "horario.googleCalendarAyuda": "Compartilhe essa agenda com a conta de serviço do Symphomed (\"fazer alterações em eventos\"). Com isso conectado, o Symphomed faz as duas coisas: reflete ali as consultas agendadas e, antes de oferecer um horário, verifica que você não tenha algo já marcado direto na sua agenda. Se deixar vazio, as consultas ficam só dentro do Symphomed.",
  "horario.infoConsultorio": "Informações do consultório (para o assistente)",
  "horario.infoConsultorioPlaceholder": "Ex: Atendemos de segunda a sexta, das 8h às 17h. Consulta geral: R$ 150. Estamos na Av. Paulista, 123, São Paulo. Aceitamos dinheiro e Pix. Se não puder vir, avise com 24h de antecedência.",
  "horario.infoConsultorioAyuda": "O assistente usa isto para responder perguntas dos pacientes (horários, preços, endereço, políticas...) — só responde com o que você escrever aqui, nunca inventa.",
  "horario.guardar": "Salvar",
  "horario.errGuardar": "Não foi possível salvar",
});
