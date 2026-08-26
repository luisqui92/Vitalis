// Vitalis — Textos en español.
//
// Estas cadenas NO se escribieron acá: se sacaron una por una de los
// literales que ya estaban en el código, sin tocarles ni una coma. Por eso
// la pantalla en español sale idéntica a como salía antes de que existiera
// i18n — el cambio es de dónde viene el texto, no cuál es.
//
// Cuando agregues una clave nueva, agregala también en pt.js. Si te olvidás
// no se rompe nada (t() cae al español), pero queda un texto sin traducir
// que nadie va a notar hasta que un médico lo vea.
Object.assign(I18N.es, {
  // ─── Días de la semana (abreviados) ──────────────────────────────────
  // Por índice de getDay(): 0 = domingo.
  "dia.corto.0": "Dom",
  "dia.corto.1": "Lun",
  "dia.corto.2": "Mar",
  "dia.corto.3": "Mié",
  "dia.corto.4": "Jue",
  "dia.corto.5": "Vie",
  "dia.corto.6": "Sáb",

  // ─── Login y registro ─────────────────────────────────────────────────
  // Es la primera pantalla que ve un médico, y hasta que no ingresa el
  // sistema todavía no sabe quién es: por eso acá —y solo acá— el idioma
  // sale del selector de abajo y no de la cuenta.
  "auth.telefono": "Teléfono",
  "auth.telefonoPlaceholder": "591XXXXXXXX",
  "auth.password": "Contraseña",
  "auth.ingresar": "Ingresar",
  "auth.irRegistro": "¿No tenés cuenta? Registrate",
  "auth.errFaltanDatos": "Completá teléfono y contraseña",
  "auth.errIngresar": "No se pudo iniciar sesión",
  "auth.idioma": "Idioma",

  "auth.2fa.ayuda": "🔐 Ingresá el código de 6 dígitos de tu app autenticadora (Google Authenticator, Authy...).",
  "auth.2fa.confirmar": "Confirmar",
  "auth.2fa.volver": "← Volver",
  "auth.2fa.errCodigo": "Código incorrecto",

  "auth.reg.nombre": "Nombre completo",
  "auth.reg.nombrePlaceholder": "Dra. Fulana Pérez",
  "auth.reg.nombrePlaceholderVet": "Dra. Fulana Pérez (veterinaria)",
  "auth.reg.area": "Área",
  "auth.reg.especialidad": "Especialidad (opcional)",
  "auth.reg.especialidadPlaceholder": "Medicina general",
  "auth.reg.especialidadPlaceholderVet": "Medicina veterinaria general",
  "auth.reg.password": "Contraseña (mínimo 8 caracteres)",
  "auth.reg.boton": "Registrarme",
  "auth.reg.irLogin": "Ya tengo cuenta, ingresar",
  "auth.reg.errFaltanDatos": "Completá teléfono, nombre y contraseña",
  "auth.reg.errRegistrar": "No se pudo registrar",
  "auth.reg.creada": "✅ Cuenta creada. Ahora ingresá con tu teléfono y contraseña.",

  "area.medicina_general": "🩺 Medicina general",
  "area.odontologia": "🦷 Odontología",
  "area.estetica": "💉 Estética / Plástica / Dermatología",
  "area.oftalmologia": "👁️ Oftalmología",
  "area.ginecologia": "🤰 Ginecología y Obstetricia",
  "area.pediatria": "🧸 Pediatría",
  "area.neurodesarrollo": "🧩 Neurodesarrollo (autismo, síndrome de Down)",
  "area.veterinaria": "🐾 Veterinaria",

  // ─── Idioma de la cuenta (Configuración) ──────────────────────────────
  "config.idioma.titulo": "🌐 Idioma",
  "config.idioma.ayuda": "En qué idioma trabajás: la pantalla, tus notas clínicas y lo que tus pacientes reciben por WhatsApp. Lo que ya escribiste no se traduce — una historia clínica se lee como se escribió.",
  "config.idioma.guardar": "Guardar idioma",
  "config.idioma.guardado": "✅ Idioma actualizado.",
  "config.idioma.errGuardar": "No se pudo cambiar el idioma",

  // ─── Agenda ───────────────────────────────────────────────────────────
  "agenda.cargando": "Cargando agenda...",
  "agenda.error": "Error cargando la agenda",
  "agenda.volver": "← Panel",
  "agenda.wa.titulo": "WhatsApp de reservas",
  "agenda.wa.sinConfigurar": "Todavía no está configurado. Podés seguir usando la Agenda a mano mientras tanto.",
  "agenda.wa.conectado": "Conectado — los pacientes ya pueden reservar por WhatsApp.",
  "agenda.nuevaCita": "Nueva cita",
  "agenda.configurarHorario": "Configurar horario de atención",
  "agenda.calendario": "Calendario",
  "agenda.sinCitas": "No hay citas este día.",
  "agenda.cancelar": "Cancelar",
  "agenda.confirmarCancelar": "¿Cancelar esta cita?",

  "agenda.form.pacienteRegistrado": "Paciente registrado (opcional)",
  "agenda.form.pacienteSinRegistrar": "— Paciente nuevo / sin registrar —",
  "agenda.form.nombreLibre": "Nombre (si no es un paciente registrado)",
  "agenda.form.nombrePlaceholder": "Nombre completo",
  "agenda.form.telefono": "Teléfono (opcional)",
  // Prefijo de Bolivia. En pt-BR es el de Brasil: se traduce como cualquier
  // otro texto porque para el médico es un ejemplo de cómo escribir, no un
  // dato del sistema.
  "agenda.form.telefonoPlaceholder": "591XXXXXXXX",
  "agenda.form.fechaHora": "Fecha y hora",
  "agenda.form.motivo": "Motivo (opcional)",
  "agenda.form.motivoPlaceholder": "Ej: Control",
  "agenda.form.guardar": "Guardar cita",
  "agenda.form.errFaltanDatos": "Elegí un paciente o escribí un nombre, y una fecha",
  "agenda.form.errGuardar": "No se pudo guardar la cita",

  "agenda.ficha.crear": "Crear ficha de paciente",
  "agenda.ficha.aviso": "Reservó por WhatsApp y todavía no tiene ficha en el Kardex. Revisá los datos antes de crearla:",
  "agenda.ficha.nombre": "Nombre",
  "agenda.ficha.telefono": "Teléfono",
  "agenda.ficha.boton": "Crear ficha",
  "agenda.ficha.creando": "Creando...",
  "agenda.ficha.errFaltaNombre": "Falta el nombre",
  "agenda.ficha.errCrear": "No se pudo crear la ficha",

  // ─── Horario de atención ──────────────────────────────────────────────
  "horario.cargando": "Cargando...",
  "horario.error": "Error cargando el horario",
  "horario.volver": "← Agenda",
  "horario.titulo": "Días y horarios de atención",
  "horario.ayuda": "Tildá los días en los que atendés, con su horario. Los días sin tilde no ofrecen turnos.",
  "horario.duracion": "Duración de cada consulta (minutos)",
  "horario.googleCalendar": "Calendario de Google (opcional)",
  "horario.googleCalendarPlaceholder": "tu-email@gmail.com",
  "horario.googleCalendarAyuda": "Compartí ese calendario con la cuenta de servicio de Vitalis (\"hacer cambios en eventos\"). Con esto conectado, Vitalis hace las dos cosas: refleja ahí las citas que se agendan, y antes de ofrecer un horario por WhatsApp revisa que no tengas algo ya puesto directo en tu calendario. Si lo dejás vacío, las citas quedan solo dentro de Vitalis.",
  "horario.infoConsultorio": "Información del consultorio (para el asistente de WhatsApp)",
  "horario.infoConsultorioPlaceholder": "Ej: Atendemos de lunes a viernes de 8 a 17hs. Consulta general: 150 Bs. Estamos en Av. América #123, Cochabamba. Aceptamos efectivo y QR. Si no podés venir, avisá con 24hs de anticipación.",
  "horario.infoConsultorioAyuda": "El número de WhatsApp usa esto para responder preguntas de los pacientes (horarios, precios, ubicación, políticas...) — solo contesta con lo que escribas acá, nunca inventa.",
  "horario.guardar": "Guardar",
  "horario.errGuardar": "No se pudo guardar",
});
