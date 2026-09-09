// Symphomed — Português · gravar uma consulta e ver seu detalhe.
//
// Los rótulos de la nota clínica de acá abajo son los que un médico
// brasileño lee en cada consulta. Están en portugués correcto, pero la
// ESTRUCTURA de la nota sigue siendo la boliviana: un prontuário brasileño
// no se organiza igual. Eso no se arregla traduciendo estas etiquetas — se
// arregla reescribiendo services/notaClinica.js con un médico que ejerza
// en Brasil, y hasta que eso pase esta pantalla va a estar en portugués
// pero pensada en español.
Object.assign(I18N.pt, {
  // ─── Gravar ───────────────────────────────────────────────────────────
  "consulta.volver": "← Voltar",
  "consulta.paciente": "Paciente:",
  "consulta.escuchando": "🎙️ Ouvindo a consulta...",
  "consulta.tocarGrabar": "Toque para gravar",
  "consulta.grabando": "Gravando... toque para parar",
  "consulta.grabacionLista": "Gravação pronta ({tiempo})",
  "consulta.subirArchivo": "📁 Ou envie um arquivo de áudio já gravado",
  "consulta.archivoListo": "Arquivo pronto: {nombre}",
  "consulta.subirTranscribir": "Enviar e transcrever",
  "consulta.subiendo": "Enviando áudio...",
  "consulta.reintentar": "Tentar enviar de novo",
  "consulta.errMicrofono": "Não foi possível acessar o microfone: {mensaje}",
  "consulta.errSubir": "Não foi possível enviar. Verifique sua conexão e tente de novo.",
  "consulta.linkRemota": "💻📱 Este computador não tem microfone? Grave com o celular vinculado",

  // ─── Gravar pelo celular vinculado ────────────────────────────────────
  "consulta.cargando": "Carregando...",
  "consulta.errVinculacion": "Erro ao carregar o vínculo",
  "consulta.remota.sinVincular": "Você ainda não vinculou seu celular hoje. Abra o Symphomed no celular, toque em \"Vincular como microfone\" e digite este código:",
  "consulta.remota.esperando": "Esta tela se atualiza sozinha assim que você vincular.",
  "consulta.remota.listo": "📱 Celular vinculado e pronto, apoiado com a tela ligada.",
  "consulta.remota.iniciar": "🎙️ Iniciar gravação remota",
  "consulta.remota.grabando": "⏺ Gravando no celular vinculado...",
  "consulta.remota.detener": "⏹️ Parar gravação",
  "consulta.remota.errOrden": "Não foi possível enviar o comando",

  // ─── Nota clínica (confirmada) ────────────────────────────────────────
  "nota.generando": "🧠 Gerando nota clínica...",
  "nota.error": "⚠️ Não foi possível gerar a nota clínica automática. A transcrição completa fica logo abaixo.",
  "nota.titulo": "🧠 Nota clínica",
  "nota.corregida": " (corrigida por você)",
  "nota.confirmada": "✅ Consulta confirmada em {fecha}",
  "nota.motivo": "Motivo:",
  "nota.sintomas": "Sintomas:",
  "nota.antecedentes": "Antecedentes:",
  "nota.diagnostico": "Diagnóstico:",
  "nota.diferenciales": "Diferenciais:",
  "nota.plan": "Conduta:",
  "nota.medicamentos": "Medicamentos:",
  "nota.examenes": "Exames:",
  "nota.proximoControl": "Próximo retorno:",

  // ─── Nota clínica (editável, antes de confirmar) ──────────────────────
  "nota.tituloIA": "🧠 Nota clínica gerada por IA",
  "nota.revisar": "Revise e corrija o que for preciso. É salvo quando você confirmar.",
  "nota.separadosComa": "(separados por vírgula)",
  "nota.campo.motivo": "Motivo da consulta",
  "nota.campo.sintomas": "Sintomas",
  "nota.campo.antecedentes": "Antecedentes relevantes",
  "nota.campo.diagnostico": "Diagnóstico",
  "nota.campo.diferenciales": "Diagnósticos diferenciais",
  "nota.campo.plan": "Conduta",
  "nota.campo.medicamentos": "Medicamentos",
  "nota.campo.examenes": "Exames solicitados",
  "nota.campo.proximoControl": "Próximo retorno",
  "nota.med.nombre": "Medicamento",
  "nota.med.dosis": "Dose",
  "nota.med.frecuencia": "Frequência",
  "nota.med.quitar": "Remover",
  "nota.med.agregar": "➕ Adicionar medicamento",

  // ─── O que aplicar ao confirmar ───────────────────────────────────────
  "confirmar.titulo": "✅ O que aplicar ao confirmar",
  "confirmar.ayuda": "Desmarque o que não corresponder. Nada é salvo até você confirmar.",
  "confirmar.nada": "Não identifiquei nada para lançar no Kardex nesta consulta.",
  "confirmar.boton": "Confirmar consulta",
  "confirmar.confirmando": "Confirmando...",
  "confirmar.reconsulta": "<b>Agendar retorno</b> e avisar o paciente pelo WhatsApp",
  "confirmar.dijiste": "Você disse: \"{texto}\"",
  "confirmar.presupuesto": "<b>Adicionar ao orçamento</b>",
  "confirmar.pieza": "Dente (FDI)",
  "confirmar.precio": "Preço (R$)",
  "confirmar.receta": "<b>Gerar receita</b> com os medicamentos da nota",
  "confirmar.medicacion": "Lançar em <b>Medicação</b>: {item}",
  "confirmar.antecedente": "Adicionar <b>antecedente</b>: {item}",
  "confirmar.antecedenteFamiliar": "Adicionar <b>antecedente familiar</b>: {item}",
  "confirmar.vacuna": "Adicionar <b>vacina</b>: {item}",
  "confirmar.parcial": "A consulta foi confirmada, mas isto não pôde ser aplicado:",
  "confirmar.errConfirmar": "Não foi possível confirmar",

  // ─── Transcrição ──────────────────────────────────────────────────────
  "consulta.procesando": "⏳ Transcrevendo sua consulta... para áudios longos pode levar vários minutos. Esta tela se atualiza sozinha, você não precisa fazer nada.",
  "consulta.errTranscribir": "Ocorreu um erro ao transcrever",
  "consulta.transcripcion": "Transcrição",
  "consulta.hablante": "Interlocutor {n}",
  "consulta.quienMedico": "Médico",
  "consulta.quienPaciente": "Paciente",
  "consulta.sinTranscripcion": "Sem transcrição",
  "consulta.sinNombre": "Sem nome de paciente",
  "consulta.min": " min",
  "consulta.errCargar": "Erro ao carregar a consulta",
});
