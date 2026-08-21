// Vitalis — "Preguntale a Vitalis": el asistente que explica cómo funciona
// el sistema. Distinto de services/memoriaClinica.js, que responde sobre la
// historia de UN paciente; este responde sobre la app: dónde está cada
// cosa, cómo se hace tal tarea, qué significa tal función.
//
// La clave está en el manual de abajo: la IA responde SOLO con eso. Sin un
// manual escrito a mano, un modelo general inventa funciones que Vitalis no
// tiene ("andá a Configuración > Exportar a PDF") y el médico termina
// buscando botones que no existen — peor que no responder.
const axios = require("axios");
const { CONFIG } = require("../config");

const PROMPT_SISTEMA = `Sos el asistente de Vitalis, un sistema de historia clínica para
consultorios. Un médico o su secretaria te preguntan cómo usar el sistema y
vos respondés en español, con el "vos" rioplatense/boliviano.

Reglas, en orden de importancia:
- Respondé ÚNICAMENTE con lo que dice el manual que te paso abajo. Si algo
  no está ahí, decí que no lo sabés y sugerí escribirle a soporte. NUNCA
  inventes pantallas, botones ni funciones: si mandás al médico a buscar
  algo que no existe, es peor que no haber respondido.
- Sé breve y concreto. Si es un "cómo hago X", dá los pasos numerados y
  cortos, nombrando las pestañas y botones tal como se llaman en el manual.
- Si te preguntan por los datos del propio consultorio (cuántos pacientes
  tiene, qué tiene agendado), usá los números que te paso más abajo.
- Si la pregunta es sobre un paciente puntual ("¿qué tiene Juan Pérez?"),
  aclarale que para eso está la Memoria Clínica dentro de la ficha de ese
  paciente, que sí puede leer su historia.
- No dés consejos médicos ni interpretes resultados clínicos: sos el
  asistente del sistema, no un colega. Si te preguntan algo clínico,
  decilo con amabilidad y ofrecé ayuda con el sistema.`;

// ─── MANUAL ───────────────────────────────────────────────────────────────
// Lo que Vitalis REALMENTE hace hoy. Cuando se agrega una función al
// sistema, hay que sumarla acá o el asistente va a decir que no existe.
const MANUAL_GENERAL = `
QUÉ ES VITALIS
Un sistema de historia clínica pensado para consultorios: graba la consulta,
la transcribe, arma la nota clínica con IA y guarda todo en la ficha del
paciente (el SmartKardex). Se usa desde el navegador, en el celular o en la
computadora, sin instalar nada.

INGRESAR
Se entra con el número de teléfono y la contraseña. Si está activada la
verificación en dos pasos, además pide el código de la app autenticadora.

PANTALLA PRINCIPAL
Al entrar se ve la lista de pacientes y una fila de accesos rápidos:
- "Nuevo paciente": para registrar a alguien.
- "Agenda": las citas y el horario de atención.
- "Recordatorios": la lista de pendientes del consultorio. Cuando hay
  alguno, el ícono muestra un globito rojo con cuántos son.
- "Vincular celular": para usar el celular como micrófono cuando se graba
  desde una computadora sin micrófono.
- "Seguridad": verificación en dos pasos, avisos de reservas y el registro
  de actividad de la cuenta.
Arriba hay un buscador para filtrar pacientes por nombre.
En pantallas grandes (computadora) aparece además un menú lateral con
Inicio, Pacientes, Agenda, Vitalis Voice, Indicaciones, Estudios e
imágenes, Reportes, Finanzas y Configuración.

GRABAR UNA CONSULTA (Vitalis Voice)
1. Entrá al paciente y andá a la pestaña "Consultas".
2. Tocá "Nueva consulta" y después el botón de grabar.
3. Mientras grabás, el logo late con la voz y aparece una vista previa del
   texto en vivo (esa vista previa es solo para confirmar que el micrófono
   anda: lo que se guarda es la transcripción final, que es más precisa).
4. Al parar, tocá "Subir y transcribir".
La transcripción separa quién habló (médico y paciente) y usa modo médico,
así reconoce mejor nombres de medicamentos y términos clínicos. Una consulta
larga puede tardar varios minutos: la pantalla se actualiza sola, no hace
falta esperar mirando.
También se puede subir un archivo de audio ya grabado, en vez de grabar.

CONFIRMAR LA CONSULTA
Cuando termina, la IA arma la nota clínica: motivo, síntomas, antecedentes,
diagnóstico, diagnósticos diferenciales, plan, medicamentos, exámenes y
próximo control. Todos esos campos se pueden corregir antes de confirmar —
la IA se equivoca y el médico manda.
Abajo aparece "Qué aplicar al confirmar", con casillas marcadas para todo lo
que detectó: agendar la reconsulta y avisarle al paciente por WhatsApp,
agregar tratamientos al presupuesto, generar la receta, cargar la medicación
al Kardex, sumar antecedentes y vacunas. Se desmarca lo que no corresponda y
un solo botón "Confirmar consulta" aplica todo junto. Nada se carga hasta
confirmar. Una consulta ya confirmada queda de solo lectura.

LA FICHA DEL PACIENTE (SmartKardex)
Las pestañas cambian según la especialidad. Están siempre: Paciente (datos),
Consultas (las grabaciones y sus notas), Medicación, Antecedentes y Recetas.
Según la especialidad se suman Odontograma, Presupuesto, Mapa (ginecología),
Ojos, Embarazo, Controles, Estudios o Vacunas.

BRIEF CLÍNICO
Un resumen que la IA regenera sola cada vez que se completa una consulta:
estado actual, qué cambió desde la última visita, medicación activa,
exámenes pendientes, alertas y factores de riesgo.

MEMORIA CLÍNICA
Dentro de la ficha de cada paciente se le puede preguntar en lenguaje
natural sobre SU historia ("¿cuándo fue su última crisis?", "¿qué
antibióticos tomó?") y responde con lo que está registrado. Se puede
preguntar por voz.

CONTROLES (evolución clínica)
Se cargan mediciones —presión, glucosa, peso, IMC, saturación, colesterol,
temperatura, frecuencia cardíaca— y se ven como gráfico de tendencia.
Arriba se muestra la comparativa: cuánto era el primer valor, cuánto el
último y la diferencia. Tocando el gráfico se lee el valor y la fecha de
cada medición.

ESTUDIOS
Se suben laboratorios, radiografías, ecografías, tomografías, resonancias,
ECG y fotos clínicas (PDF o imagen), quedan ligados al paciente y se pueden
abrir desde la ficha.

RECETAS
Se generan desde los medicamentos de una consulta o cargando a mano, y
quedan listas para imprimir o guardar como PDF desde el navegador.

AGENDA Y RESERVAS
En Agenda se configura el horario de atención, cuánto dura cada consulta y,
si se quiere, el calendario de Google donde se reflejan las citas (nunca
ofrece un horario que ya esté ocupado ahí, aunque la cita no sea de
Vitalis). Las citas se pueden cargar a mano o llegar solas: el paciente
escribe al WhatsApp del consultorio y un asistente lo guía para reservar,
cancelar o responder preguntas sobre horarios. También existe un link de
reserva que el paciente abre y elige el horario que le queda mejor.

AVISOS DE RESERVAS
En Seguridad se activan las notificaciones del navegador: cuando entra una
reserva llega un aviso al dispositivo aunque Vitalis esté cerrado. Se activa
por dispositivo y hay un botón para mandarse una de prueba. En iPhone
primero hay que agregar Vitalis a la pantalla de inicio (Compartir →
Agregar a inicio) y abrirlo desde ahí.

RECORDATORIOS
Una lista de pendientes del consultorio (controles, vencimientos), con
paciente, tipo y fecha. Se marcan como hechos o se eliminan.

GRABAR DESDE EL CELULAR (micrófono remoto)
Si la computadora no tiene micrófono, en "Vincular celular" aparece un
código; se abre Vitalis en el celular, se ingresa ese código y desde ahí se
graba la consulta, que llega igual a la ficha del paciente.

TIEMPO REAL
Si se tiene Vitalis abierto en el celular y en la computadora a la vez, lo
que se carga en uno aparece solo en el otro, sin recargar.

SEGURIDAD
Verificación en dos pasos con app autenticadora (Google Authenticator,
Authy). Registro de actividad de la cuenta: se ve quién entró y qué se hizo,
con fecha e IP.
`;

const MANUAL_POR_ESPECIALIDAD = {
  odontologia: `
ODONTOLOGÍA (Vitalis Odonto)
- Odontograma: la arcada completa con las 32 piezas. Se toca cada una y se
  carga su estado: sano, caries, obturado, corona, endodoncia, implante,
  sellante, fractura, ausente. Y los tratamientos indicados pero todavía no
  hechos: obturación indicada, corona indicada, endodoncia indicada,
  implante indicado, extracción indicada — se dibujan con el borde punteado
  para distinguir lo planificado de lo hecho. Cada pieza guarda su historial.
  Hay vista 2D y vista 3D.
- El odontograma se actualiza solo con lo que se dicta en la consulta: "la
  36 tiene caries" la marca con caries, "hay que hacer endodoncia en la 11"
  la marca como endodoncia indicada. Se revisa y corrige desde la pestaña
  Odontograma.
- Presupuesto: el plan de tratamiento del paciente, con precio por ítem,
  pagos parciales y saldo. Se alimenta del catálogo de tratamientos del
  consultorio (nombre + precio), que se carga una vez y se reutiliza.
- Cuando en la consulta se menciona un tratamiento a hacer, aparece como
  sugerencia para agregar al presupuesto, con el precio del catálogo ya
  puesto — se revisa antes de confirmar.`,

  oftalmologia: `
OFTALMOLOGÍA (Vitalis Visión)
- Mapa ocular: un esquema de cada ojo (derecho e izquierdo) con sus
  estructuras —córnea, iris, pupila, cristalino, esclerótica, conjuntiva,
  cámara anterior, retina, mácula, nervio óptico, vasos y vítreo—. Se toca
  cada una y se marca si está normal o con alteración leve, moderada o
  importante, con su historial.
- El mapa se actualiza solo con lo que se dicta en la consulta ("cristalino
  con opacidad cortical leve en el izquierdo").
- Receta óptica: esfera, cilindro, eje y adición por ojo.
- Se puede registrar la presión intraocular de cada ojo en Controles, y el
  sistema avisa si el último valor pasa de 21 mmHg o si viene en alza.`,

  ginecologia: `
GINECOLOGÍA Y OBSTETRICIA (Vitalis Gineco)
- Embarazo: se carga la fecha de última menstruación y calcula solo la fecha
  probable de parto, las semanas y días de gestación y el trimestre. Muestra
  una silueta cuya panza crece con las semanas, el tamaño del bebé comparado
  con algo cotidiano y cuánto falta para el parto. Al terminar se cierra con
  el desenlace (parto vaginal, cesárea, aborto u otro) y queda en el
  historial de embarazos.
- Mapa ginecológico: un esquema del aparato reproductor (útero, endometrio,
  cuello uterino, ovarios y trompas) más las mamas. Se toca cada órgano y se
  carga el hallazgo: normal, mioma, quiste, pólipo, endometriosis,
  inflamación, engrosamiento, nódulo, lesión o ausente. Cada órgano guarda
  su historial.
- El mapa se actualiza solo con lo que se dicta en la consulta ("ovario
  izquierdo con quiste simple", "endometrio engrosado").
- Los estudios se muestran como "Ecografías" en la ficha.`,

  pediatria: `
PEDIATRÍA (Vitalis Pediatría)
- Curvas de crecimiento con los patrones oficiales de la OMS: peso para la
  edad (hasta los 10 años), talla para la edad (hasta los 19), perímetro
  cefálico (hasta los 5) e IMC para la edad (hasta los 19). Cada control se
  dibuja sobre las bandas de la OMS y se muestra el percentil y el z-score.
  Fuera de esos rangos Vitalis no calcula percentil: lo dice, no lo inventa.
- El IMC no se carga a mano: se calcula solo cuando se cargan peso y talla
  en el mismo control.
- Compara cada control con el anterior y avisa cuando el chico se movió de
  carril hacia abajo (media desviación estándar o más). Es un aviso para
  mirar, no un diagnóstico: Vitalis nunca dice "desnutrido".
- Edad corregida para prematuros: si se cargan las semanas de gestación al
  nacer, hasta los 2 años los percentiles se calculan descontando lo que le
  faltó para llegar a término. Sin eso, un prematuro se lee como un retraso
  de crecimiento que no existe.
- La edad se muestra en días, meses o años según corresponda, no siempre en
  años: "18 días", "7 meses", "3 a 4 m".
- Para calcular percentiles hacen falta la fecha de nacimiento y el sexo del
  paciente. Si falta alguno, la pantalla lo dice y no muestra ningún número.
- En la ficha del paciente se puede cargar la madre, el padre o el tutor y
  su parentesco — el teléfono de contacto es el de esa persona.`,

  estetica: `
ESTÉTICA (Vitalis Face)
- Las pestañas propias son "Procedimientos" (el plan de tratamiento) y
  "Fotos".
- Procedimientos: el plan con precio por ítem, pagos parciales y saldo (el
  saldo se calcula solo: precio menos lo pagado). Se alimenta del catálogo
  de tratamientos del consultorio, que se carga una vez y se reutiliza.
- Cuando en la consulta se menciona un procedimiento a hacer, aparece como
  sugerencia para agregar al plan, con el precio del catálogo ya puesto.
- Fotos: al sacar una foto clínica hay una guía en cámara para repetir
  siempre el mismo ángulo (frontal, perfil, 3/4), y un comparador de
  antes/después con un slider entre dos fechas del mismo ángulo.
- Sobre una foto frontal se puede abrir el mapa facial: marca las regiones
  (ojos, cejas, labios, frente, mejillas, mentón, mandíbula) y hace un
  análisis de simetría izquierda/derecha. Corre entero en el navegador, la
  foto no se manda a ningún lado. Es un análisis sobre una foto 2D, no una
  medición con hardware de profundidad.`,

  veterinaria: `
VETERINARIA (Vitalis Vet)
- La ficha es de la mascota: nombre, especie, raza y los datos del dueño.
- El resto funciona igual que en medicina general: consultas grabadas,
  medicación, vacunas, controles y estudios.`,

  medicina_general: `
MEDICINA GENERAL
- La ficha incluye Vacunas y Controles (evolución clínica) además de las
  pestañas comunes.`,
};

function construirManual(tipoEspecialidad) {
  const propio = MANUAL_POR_ESPECIALIDAD[tipoEspecialidad] || MANUAL_POR_ESPECIALIDAD.medicina_general;
  return MANUAL_GENERAL + "\n" + propio;
}

function construirDatosPropios(datos) {
  if (!datos) return "";
  const partes = [];
  if (datos.nombreMedico) partes.push(`El médico se llama ${datos.nombreMedico}.`);
  if (datos.especialidadLabel) partes.push(`Su especialidad configurada es ${datos.especialidadLabel}.`);
  if (datos.pacientes != null) partes.push(`Tiene ${datos.pacientes} paciente(s) registrado(s).`);
  if (datos.consultasMes != null) partes.push(`Grabó ${datos.consultasMes} consulta(s) en los últimos 30 días.`);
  if (datos.citasProximas != null) partes.push(`Tiene ${datos.citasProximas} cita(s) agendada(s) para los próximos 7 días.`);
  if (datos.citasHoy != null) partes.push(`Hoy tiene ${datos.citasHoy} cita(s).`);
  if (datos.recordatorios != null) partes.push(`Tiene ${datos.recordatorios} recordatorio(s) pendiente(s).`);
  return partes.length ? `\n\nDATOS ACTUALES DE ESTE CONSULTORIO:\n${partes.join("\n")}` : "";
}

async function preguntarAVitalis(pregunta, { tipoEspecialidad, datos, historial }) {
  const contexto = construirManual(tipoEspecialidad) + construirDatosPropios(datos);

  // Se manda el ida y vuelta anterior para que se pueda repreguntar ("¿y
  // eso dónde estaba?") sin repetir todo el contexto de nuevo.
  const mensajesPrevios = (historial || []).slice(-6).map(m => ({
    role: m.rol === "usuario" ? "user" : "assistant",
    content: String(m.texto || "").slice(0, 1500),
  }));

  const res = await axios.post(
    (process.env.OPENAI_BASE || "https://api.openai.com") + "/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PROMPT_SISTEMA + "\n\n=== MANUAL DE VITALIS ===\n" + contexto },
        ...mensajesPrevios,
        { role: "user", content: pregunta },
      ],
      max_tokens: 600,
      temperature: 0.2,
    },
    { headers: { Authorization: `Bearer ${CONFIG.OPENAI_KEY}` }, timeout: CONFIG.TIMEOUT_OPENAI }
  );
  return res.data.choices[0].message.content.trim();
}

module.exports = { preguntarAVitalis };
