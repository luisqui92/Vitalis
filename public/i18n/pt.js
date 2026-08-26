// Vitalis — Textos en portugués (pt-BR).
//
// A propósito está casi vacío. La traducción de verdad no la hace este
// archivo solo: la interfaz sí se puede traducir de forma mecánica, pero
// los textos que un médico brasileño juzga —la nota clínica, lo que su
// paciente recibe por WhatsApp, el vocabulario del dictado— son una
// reescritura, no una traducción, y necesitan a un médico que ejerza en
// Brasil. Hasta que eso pase, este archivo se llena de a poco y a
// conciencia, no de una corrida.
//
// Mientras tanto el sistema funciona igual: t() cae al español para
// cualquier clave que todavía no esté acá (ver public/js/i18n.js). Una
// pantalla a medio traducir se ve mezclada, pero nunca rota.
//
// Lo único que ya está son los días de la semana: son mecánicos, no tienen
// matiz clínico, y sirven para comprobar que el mecanismo funciona de
// punta a punta.
Object.assign(I18N.pt, {
  // ─── Login y registro ─────────────────────────────────────────────────
  // Estas SÍ están traducidas, y a propósito: es la primera pantalla que ve
  // un médico brasileño, y verla en español es exactamente la impresión que
  // no queremos dar. Son etiquetas de interfaz, sin matiz clínico —
  // "Senha", "Entrar"— así que traducirlas no tiene el riesgo que sí tiene
  // una nota clínica. Igual las tiene que leer un nativo antes del piloto:
  // hasta entonces esto es español bien intencionado con palabras en
  // portugués.
  "auth.telefono": "Telefone",
  "auth.telefonoPlaceholder": "55XXXXXXXXXXX",
  "auth.password": "Senha",
  "auth.ingresar": "Entrar",
  "auth.irRegistro": "Não tem conta? Cadastre-se",
  "auth.errFaltanDatos": "Preencha telefone e senha",
  "auth.errIngresar": "Não foi possível entrar",
  "auth.idioma": "Idioma",

  "auth.2fa.ayuda": "🔐 Digite o código de 6 dígitos do seu aplicativo autenticador (Google Authenticator, Authy...).",
  "auth.2fa.confirmar": "Confirmar",
  "auth.2fa.volver": "← Voltar",
  "auth.2fa.errCodigo": "Código incorreto",

  "auth.reg.nombre": "Nome completo",
  "auth.reg.nombrePlaceholder": "Dra. Fulana Silva",
  "auth.reg.nombrePlaceholderVet": "Dra. Fulana Silva (veterinária)",
  "auth.reg.area": "Área",
  "auth.reg.especialidad": "Especialidade (opcional)",
  "auth.reg.especialidadPlaceholder": "Clínica geral",
  "auth.reg.especialidadPlaceholderVet": "Medicina veterinária geral",
  "auth.reg.password": "Senha (mínimo 8 caracteres)",
  "auth.reg.boton": "Criar conta",
  "auth.reg.irLogin": "Já tenho conta, entrar",
  "auth.reg.errFaltanDatos": "Preencha telefone, nome e senha",
  "auth.reg.errRegistrar": "Não foi possível criar a conta",
  "auth.reg.creada": "✅ Conta criada. Agora entre com seu telefone e senha.",

  "area.medicina_general": "🩺 Clínica geral",
  "area.odontologia": "🦷 Odontologia",
  "area.estetica": "💉 Estética / Plástica / Dermatologia",
  "area.oftalmologia": "👁️ Oftalmologia",
  "area.ginecologia": "🤰 Ginecologia e Obstetrícia",
  "area.pediatria": "🧸 Pediatria",
  "area.neurodesarrollo": "🧩 Neurodesenvolvimento (autismo, síndrome de Down)",
  "area.veterinaria": "🐾 Veterinária",

  // ─── Idioma de la cuenta (Configuración) ──────────────────────────────
  "config.idioma.titulo": "🌐 Idioma",
  "config.idioma.ayuda": "Em qual idioma você trabalha: a tela, suas notas clínicas e o que seus pacientes recebem pelo WhatsApp. O que você já escreveu não é traduzido — um prontuário se lê como foi escrito.",
  "config.idioma.guardar": "Salvar idioma",
  "config.idioma.guardado": "✅ Idioma atualizado.",
  "config.idioma.errGuardar": "Não foi possível alterar o idioma",

  "dia.corto.0": "Dom",
  "dia.corto.1": "Seg",
  "dia.corto.2": "Ter",
  "dia.corto.3": "Qua",
  "dia.corto.4": "Qui",
  "dia.corto.5": "Sex",
  "dia.corto.6": "Sáb",
});
