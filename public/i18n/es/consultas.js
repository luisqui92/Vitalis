// Symphomed — Español · grabar una consulta y ver su detalle (public/js/consultas.js).
Object.assign(I18N.es, {
  // ─── Grabar ───────────────────────────────────────────────────────────
  "consulta.volver": "← Volver",
  "consulta.paciente": "Paciente:",
  "consulta.escuchando": "🎙️ Escuchando la consulta...",
  "consulta.tocarGrabar": "Tocá para grabar",
  "consulta.grabando": "Grabando... tocá para detener",
  "consulta.grabacionLista": "Grabación lista ({tiempo})",
  "consulta.subirArchivo": "📁 O subí un archivo de audio ya grabado",
  "consulta.archivoListo": "Archivo listo: {nombre}",
  "consulta.subirTranscribir": "Subir y transcribir",
  "consulta.subiendo": "Subiendo audio...",
  "consulta.reintentar": "Reintentar subir",
  "consulta.errMicrofono": "No se pudo acceder al micrófono: {mensaje}",
  "consulta.errSubir": "No se pudo subir. Revisá tu conexión y volvé a intentar.",
  "consulta.linkRemota": "💻📱 ¿Esta compu no tiene micrófono? Grabar con el celular vinculado",

  // ─── Grabar desde el celular vinculado ────────────────────────────────
  "consulta.cargando": "Cargando...",
  "consulta.errVinculacion": "Error cargando la vinculación",
  "consulta.remota.sinVincular": "Todavía no vinculaste tu celular hoy. Abrí Symphomed en el celular, tocá \"Vincular como micrófono\" e ingresá este código:",
  "consulta.remota.esperando": "Esta pantalla se actualiza sola apenas lo vincules.",
  "consulta.remota.listo": "📱 Celular vinculado y listo, apoyado con la pantalla prendida.",
  "consulta.remota.iniciar": "🎙️ Iniciar grabación remota",
  "consulta.remota.grabando": "⏺ Grabando en el celular vinculado...",
  "consulta.remota.detener": "⏹️ Detener grabación",
  "consulta.remota.errOrden": "No se pudo mandar la orden",

  // ─── Nota clínica (confirmada) ────────────────────────────────────────
  "nota.generando": "🧠 Generando nota clínica...",
  "nota.error": "⚠️ No se pudo generar la nota clínica automática. La transcripción completa queda más abajo.",
  "nota.titulo": "🧠 Nota clínica",
  "nota.corregida": " (corregida por vos)",
  "nota.confirmada": "✅ Consulta confirmada el {fecha}",
  "nota.motivo": "Motivo:",
  "nota.sintomas": "Síntomas:",
  "nota.antecedentes": "Antecedentes:",
  "nota.diagnostico": "Diagnóstico:",
  "nota.diferenciales": "Diferenciales:",
  "nota.plan": "Plan:",
  "nota.medicamentos": "Medicamentos:",
  "nota.examenes": "Exámenes:",
  "nota.proximoControl": "Próximo control:",

  // ─── Nota clínica (editable, antes de confirmar) ──────────────────────
  "nota.tituloIA": "🧠 Nota clínica generada por IA",
  "nota.revisar": "Revisá y corregí lo que haga falta. Se guarda cuando confirmás.",
  "nota.separadosComa": "(separados por coma)",
  "nota.campo.motivo": "Motivo de consulta",
  "nota.campo.sintomas": "Síntomas",
  "nota.campo.antecedentes": "Antecedentes relevantes",
  "nota.campo.diagnostico": "Diagnóstico",
  "nota.campo.diferenciales": "Diagnósticos diferenciales",
  "nota.campo.plan": "Plan",
  "nota.campo.medicamentos": "Medicamentos",
  "nota.campo.examenes": "Exámenes solicitados",
  "nota.campo.proximoControl": "Próximo control",
  "nota.med.nombre": "Medicamento",
  "nota.med.dosis": "Dosis",
  "nota.med.frecuencia": "Frecuencia",
  "nota.med.quitar": "Quitar",
  "nota.med.agregar": "➕ Agregar medicamento",
  // Revisión contra la lista oficial (services/medicamentosOficiales.js).
  // Nunca se cambia solo: el médico toca la sugerencia o corrige a mano.
  "nota.med.quisisteDecir": "⚠️ ¿Quisiste decir <b>{nombre}</b>? Tocá para cambiarlo.",
  "nota.med.desconocido": "⚠️ No está en la lista oficial. Si es una marca comercial, está bien; si no, verificá el nombre.",

  // ─── Qué aplicar al confirmar ─────────────────────────────────────────
  // Estas llevan el <b> adentro a propósito: son frases enteras, y en otro
  // idioma la palabra en negrita puede caer en otro lugar de la oración.
  // Partirlas en "Agregar" + "vacuna" obligaría al portugués a usar el orden
  // del español.
  "confirmar.titulo": "✅ Qué aplicar al confirmar",
  "confirmar.ayuda": "Desmarcá lo que no corresponda. Nada se carga hasta que confirmes.",
  "confirmar.nada": "No detecté nada para cargar al Kardex en esta consulta.",
  "confirmar.boton": "Confirmar consulta",
  "confirmar.confirmando": "Confirmando...",
  "confirmar.reconsulta": "<b>Agendar reconsulta</b> y avisarle al paciente por WhatsApp",
  "confirmar.dijiste": "Dijiste: \"{texto}\"",
  "confirmar.presupuesto": "<b>Agregar al presupuesto</b>",
  "confirmar.pieza": "Pieza (FDI)",
  "confirmar.precio": "Precio (Bs.)",
  "confirmar.receta": "<b>Generar receta</b> con los medicamentos de la nota",
  "confirmar.medicacion": "Cargar a <b>Medicación</b>: {item}",
  "confirmar.antecedente": "Agregar <b>antecedente</b>: {item}",
  "confirmar.antecedenteFamiliar": "Agregar <b>antecedente familiar</b>: {item}",
  "confirmar.vacuna": "Agregar <b>vacuna</b>: {item}",
  "confirmar.parcial": "Se confirmó la consulta, pero esto no se pudo aplicar:",
  "confirmar.errConfirmar": "No se pudo confirmar",

  // ─── Transcripción ────────────────────────────────────────────────────
  "consulta.procesando": "⏳ Transcribiendo tu consulta... para audios largos puede tardar varios minutos. Esta pantalla se actualiza sola, no hace falta que hagas nada.",
  "consulta.errTranscribir": "Ocurrió un error al transcribir",
  "consulta.transcripcion": "Transcripción",
  "consulta.hablante": "Hablante {n}",
  // En la teleconsulta se sabe quién es quién (canales separados), no se adivina.
  "consulta.quienMedico": "Médico",
  "consulta.quienPaciente": "Paciente",
  "consulta.sinTranscripcion": "Sin transcripción",
  "consulta.sinNombre": "Sin nombre de paciente",
  "consulta.min": " min",
  "consulta.errCargar": "Error cargando la consulta",

  // Volver a generar la nota (routes/consultaMedica.js)
  "nota.vacia": "⚠️ La nota salió vacía aunque la consulta se transcribió bien. Podés generarla de nuevo.",
  "nota.regenerar": "Volver a generar la nota",
  "nota.regenerando": "Generando…",
  "nota.regenerarAyuda": "Usa la misma transcripción y no se cobra de nuevo.",
  "nota.errRegenerar": "No se pudo volver a generar la nota.",

  // El cuidador de la grabación (crearGuardianGrabacion en audio.js)
  "consulta.pantallaEncendida": "Dejá la pantalla encendida y Symphomed abierto mientras grabás: si el celular se bloquea o cambiás de app, el micrófono puede dejar de grabar.",
  "consulta.avisoOculto": "Saliste de Symphomed o se apagó la pantalla durante unos {min} min. En ese tiempo el micrófono pudo no grabar.",
  "consulta.avisoSilencio": "No se escucha nada hace más de un minuto. ¿Está tapado el micrófono o lejos de la conversación?",
  "consulta.avisoCortado": "El micrófono se desconectó. Detené la grabación y empezá una nueva para no perder el resto.",
  "consulta.resumenSinMicrofono": "Ojo: de {total} de grabación, unos {min} min fueron con la pantalla apagada o fuera de Symphomed, y ese tramo puede no tener sonido. Podés subirla igual.",
  "consulta.resumenSilencio": "Ojo: de {total} de grabación, unos {min} min no tienen sonido. Revisá que el micrófono no haya estado tapado. Podés subirla igual.",

  // Salir con una grabación en curso, y el respaldo en el teléfono (audio.js)
  "consulta.confirmarSalir": "Hay una grabación en curso. Si salís de esta pantalla, se detiene: lo grabado hasta ahora queda guardado en este teléfono y lo vas a poder subir desde la consulta del paciente. ¿Salir igual?",
  "consulta.notifTitulo": "⚠️ Symphomed: la grabación está en pausa",
  "consulta.notifCuerpo": "Saliste de Symphomed y el celular dejó de grabar. Tocá acá para volver y seguir grabando la consulta.",
  "consulta.pendienteTexto": "Hay una grabación de {paciente} que no se llegó a subir ({min} min, {fecha}).",
  "consulta.pendienteSubir": "Subir y transcribir",
  "consulta.pendienteDescartar": "Descartar",
  "consulta.pendienteConfirmarDescartar": "¿Descartar esta grabación? No se puede recuperar.",
});
