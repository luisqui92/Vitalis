// Vitalis Neurodesarrollo — Crea (o actualiza) una cuenta de psicología
// infantil de demo con 6 pacientes: autismo en distintos perfiles, síndrome
// de Down, un diagnóstico dual y un TDAH con trastorno del lenguaje.
//
// La demo está armada para que se vean las cosas que Vitalis hace y los
// cuadernos no:
//
//  · Los DOS EJES del DSM-5 por separado. Sofía necesita nivel 1 de apoyo en
//    comunicación social y nivel 2 en conductas restringidas — no es "TEA
//    leve", y una nota promedio borraría justo eso.
//  · El PERFIL SENSORIAL con qué desregula y qué calma, que es lo que se
//    copia al informe para la escuela.
//  · Los OBJETIVOS con el nivel de ayuda bajando. El porcentaje sube, sí,
//    pero lo que de verdad se está midiendo es que pasó de ayuda física
//    total a independiente. Eso es lo que no se ve en un cuaderno.
//  · El CALENDARIO DE VIGILANCIA del síndrome de Down, con cosas atrasadas.
//    Son condiciones que hay que ir a buscar; si nadie lleva el calendario,
//    se pasan años.
//
// Uso: node scripts/seed_neurodesarrollo_demo.js <telefono> ["Nombre"] [password]
// Ej:  node scripts/seed_neurodesarrollo_demo.js 78811005
//
// Es idempotente: si la profesional ya existe no le toca la contraseña, y si
// un paciente ya tiene perfil cargado, lo saltea.
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const {
  Medico, Paciente, ConsultaMedica, Medicion,
  PerfilNeuro, ObjetivoNeuro, VigilanciaSalud,
} = require("../db/models");
const { hashPassword } = require("../services/auth");
const { PLANTILLAS_VIGILANCIA } = require("../services/vigilancia");
const { siguienteCodigo } = require("../services/codigos");

// ─── FECHAS ───────────────────────────────────────────────────────────────
const DIA = 24 * 60 * 60 * 1000;
const haceDias = (d) => new Date(Date.now() - d * DIA);
function nacimientoHace(años, meses = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - años);
  d.setMonth(d.getMonth() - meses);
  return d;
}

// ─── LOS PACIENTES ────────────────────────────────────────────────────────
// Seis perfiles distintos a propósito: si todos fueran "autismo nivel 2" la
// demo no mostraría nada de lo que el módulo sabe hacer.
const PACIENTES = [
  {
    nombre: "Mateo Ribera Quispe",
    edad: [4, 2], sexo: "Masculino",
    tutorNombre: "Carla Quispe", tutorParentesco: "Madre",
    telefono: "59178945612",
    notas: "Derivado por el pediatra a los 2 años y 8 meses. Diagnóstico de TEA a los 3.",
    perfil: {
      condiciones: ["tea"],
      detalleCondicion: "Diagnóstico por ADOS-2 en marzo. Sin discapacidad intelectual asociada evaluada aún.",
      apoyoComunicacionSocial: 2,
      apoyoConductasRestringidas: 2,
      comunicacion: "palabras_sueltas",
      sistemaAumentativo: "Pictogramas (PECS fase 2) en casa y en el jardín",
      fortalezas: ["Memoria visual excelente", "Arma rompecabezas de 24 piezas solo", "Clasifica por color sin que nadie se lo enseñe"],
      intereses: ["Trenes", "Ruedas que giran", "Ventiladores"],
    },
    sensorial: [
      { modalidad: "auditivo", respuesta: "hiper",
        desencadenantes: ["Secador de manos del baño", "Licuadora", "Timbre del jardín"],
        estrategias: ["Auriculares de protección antes de entrar al baño", "Avisarle 5 minutos antes de la licuadora"] },
      { modalidad: "tactil", respuesta: "hiper",
        desencadenantes: ["Etiquetas de la ropa", "Cortarse el pelo", "Arena mojada"],
        estrategias: ["Ropa sin etiqueta y sin costura", "Corte de pelo con máquina, en casa, con el video de trenes"] },
      { modalidad: "vestibular", respuesta: "busca",
        desencadenantes: [],
        estrategias: ["Hamaca 10 minutos antes de sentarse a la mesa", "Girar en la silla de escritorio entre actividades"] },
      { modalidad: "oral", respuesta: "hipo",
        desencadenantes: [],
        estrategias: ["Mordillo de silicona durante las tareas de mesa"] },
    ],
    objetivos: [
      {
        titulo: "Pedir agua señalando el pictograma",
        area: "comunicacion",
        criterio: "Señala el pictograma de agua sin ayuda física, 8 de 10 oportunidades, en 3 sesiones seguidas",
        // Lo que importa acá no es que el porcentaje suba, es que la AYUDA
        // baje: empezó necesitando mano sobre mano y terminó solo.
        progreso: [
          { dias: 84, logros: 2, intentos: 10, ayuda: "fisica_total", notas: "Mano sobre mano en todas." },
          { dias: 70, logros: 4, intentos: 10, ayuda: "fisica_parcial", notas: "Alcanza con tocarle el codo." },
          { dias: 56, logros: 6, intentos: 10, ayuda: "fisica_parcial" },
          { dias: 42, logros: 6, intentos: 10, ayuda: "gestual", notas: "Basta con señalar el tablero." },
          { dias: 28, logros: 8, intentos: 10, ayuda: "gestual" },
          { dias: 14, logros: 8, intentos: 10, ayuda: "verbal", notas: '"¿Qué querés?" y va solo.' },
          { dias: 3, logros: 9, intentos: 10, ayuda: "independiente", notas: "Pidió solo dos veces en casa, según la mamá." },
        ],
      },
      {
        titulo: "Tolerar el corte de pelo sentado",
        area: "sensorial",
        criterio: "Permanece sentado 5 minutos con la máquina encendida, sin llanto, 3 veces seguidas",
        progreso: [
          { dias: 60, logros: 0, intentos: 3, ayuda: "fisica_total", notas: "Llanto desde que ve la máquina." },
          { dias: 40, logros: 1, intentos: 3, ayuda: "fisica_parcial", notas: "Máquina apagada apoyada en la nuca, tolera 30 s." },
          { dias: 20, logros: 2, intentos: 3, ayuda: "verbal", notas: "Con el video de trenes tolera 2 minutos." },
          { dias: 5, logros: 2, intentos: 3, ayuda: "verbal" },
        ],
      },
    ],
    vigilancia: "tea",
    sesiones: [
      { dias: 7, duracion: 2700, motivo: "Sesión individual — comunicación funcional",
        texto: "Hoy trabajamos el tablero de pedidos. Mateo señaló agua nueve de diez veces sin que le tocara la mano, que es la primera vez que pasa. La mamá cuenta que en casa lo pidió solo dos veces esta semana, una de ellas sin que nadie estuviera mirando. Seguimos con el mismo criterio dos semanas más antes de agregar un segundo pictograma. Le dije a Carla que no le adelante el vaso cuando lo ve mirar la heladera: si se lo damos antes de que pida, le sacamos la oportunidad.",
        diagnostico: "TEA — nivel 2 de apoyo en comunicación social. Buena respuesta al sistema aumentativo.",
        plan: "Sostener PECS fase 2 dos semanas más. Sumar pictograma de 'galleta' en la próxima. Pauta a la familia: esperar el pedido antes de anticipar." },
      { dias: 21, duracion: 2400, motivo: "Sesión individual + pauta sensorial",
        texto: "Volvió el tema del secador de manos del baño del jardín. La maestra dice que no quiere entrar al baño y que tuvieron dos episodios de llanto. Le expliqué que no es capricho, que el ruido del secador le duele físicamente. Acordamos que use los auriculares antes de entrar y que desenchufen el secador en el horario de su sala. También hablamos del corte de pelo, que sigue siendo difícil.",
        diagnostico: "Hipersensibilidad auditiva con impacto en la rutina escolar.",
        plan: "Auriculares de protección disponibles en la mochila. Nota a la escuela pidiendo desenchufar el secador en horario de sala amarilla." },
    ],
    medidas: [
      { tipo: "peso", valores: [[300, 14.2], [180, 15.1], [60, 15.9], [5, 16.4]] },
      { tipo: "talla", valores: [[300, 96], [180, 99], [60, 102], [5, 103.5]] },
    ],
  },

  {
    nombre: "Sofía Mamani Choque",
    edad: [7, 5], sexo: "Femenino",
    tutorNombre: "Rosario Choque", tutorParentesco: "Madre",
    telefono: "59176112233",
    notas: "Escolarizada en escuela común con apoyo. Diagnóstico a los 6, después de años de 'es tímida'.",
    perfil: {
      condiciones: ["tea"],
      // Este es EL caso que muestra por qué los dos ejes van separados.
      detalleCondicion: "Perfil frecuentemente pasado por alto en niñas: lenguaje fluido y buen desempeño académico enmascaran la dificultad social y la rigidez.",
      apoyoComunicacionSocial: 1,
      apoyoConductasRestringidas: 2,
      comunicacion: "verbal_fluida",
      sistemaAumentativo: "",
      fortalezas: ["Lee de corrido desde los 4 años", "Vocabulario muy por encima de su edad", "Honestidad absoluta", "Memoria para fechas"],
      intereses: ["Dinosaurios", "Mapas", "Banderas de países"],
    },
    sensorial: [
      { modalidad: "auditivo", respuesta: "hiper",
        desencadenantes: ["Timbre del recreo", "Comedor escolar lleno", "Sillas arrastrándose"],
        estrategias: ["Salir 2 minutos antes del timbre", "Almorzar en la biblioteca los días difíciles"] },
      { modalidad: "interoceptivo", respuesta: "hipo",
        desencadenantes: [],
        estrategias: ["Recordatorio de ir al baño en los recreos, aunque diga que no tiene ganas", "Botella de agua a la vista con marcas de horario"] },
      { modalidad: "visual", respuesta: "hiper",
        desencadenantes: ["Luz fluorescente que parpadea", "Aulas con mucha cartelera"],
        estrategias: ["Ubicarla lejos del tubo que titila", "Escritorio contra pared despejada"] },
      { modalidad: "tactil", respuesta: "tipico", desencadenantes: [], estrategias: [] },
    ],
    objetivos: [
      {
        titulo: "Pedir un descanso con la tarjeta en vez de salir del aula",
        area: "conducta",
        criterio: "Usa la tarjeta de descanso antes de salir, 4 de 5 veces, durante 3 semanas",
        progreso: [
          { dias: 75, logros: 1, intentos: 5, ayuda: "verbal", notas: "Se va sin avisar; la maestra la busca en el patio." },
          { dias: 60, logros: 2, intentos: 5, ayuda: "verbal" },
          { dias: 45, logros: 3, intentos: 5, ayuda: "gestual", notas: "Alcanza con que la maestra mire la tarjeta." },
          { dias: 30, logros: 4, intentos: 5, ayuda: "gestual" },
          { dias: 15, logros: 4, intentos: 5, ayuda: "independiente" },
          { dias: 4, logros: 5, intentos: 5, ayuda: "independiente", notas: "Tres semanas seguidas. Se puede cerrar." },
        ],
        estado: "logrado",
      },
      {
        titulo: "Tolerar un cambio de rutina avisado con anticipación",
        area: "social",
        criterio: "Acepta el cambio sin crisis cuando se le avisa 24 h antes, 3 de 4 veces",
        progreso: [
          { dias: 50, logros: 1, intentos: 4, ayuda: "verbal", notas: "El cambio de profesora de música terminó en crisis." },
          { dias: 35, logros: 2, intentos: 4, ayuda: "verbal", notas: "Con agenda visual el viernes anterior, mejor." },
          { dias: 20, logros: 2, intentos: 4, ayuda: "verbal" },
          { dias: 6, logros: 3, intentos: 4, ayuda: "verbal", notas: "Preguntó ella misma qué iba a pasar el jueves." },
        ],
      },
    ],
    vigilancia: "tea",
    sesiones: [
      { dias: 10, duracion: 3000, motivo: "Sesión individual + reunión con la escuela",
        texto: "Reunión con la maestra y la directora. Tuve que explicar de nuevo que el hecho de que Sofía saque las mejores notas no significa que no necesite apoyo: lo que le cuesta no es la matemática, es el recreo. La directora preguntó si no estaba exagerando el diagnóstico porque la nena habla perfecto. Le mostré la diferencia entre los dos ejes. Quedamos en que la tarjeta de descanso se respeta sin pedir explicaciones, y que la avisen de los cambios de horario el día anterior.",
        diagnostico: "TEA — nivel 1 en comunicación social, nivel 2 en conductas restringidas e inflexibilidad.",
        plan: "Acta de acuerdos con la escuela. Tarjeta de descanso sin justificación. Aviso anticipado de cambios de rutina. Revisión en 6 semanas." },
      { dias: 38, duracion: 2700, motivo: "Sesión individual",
        texto: "Sofía llegó angustiada por un cumpleaños al que la invitaron. Dice que quiere ir pero que no sabe qué decir cuando le hablan. Trabajamos con un guion de tres frases para arrancar una conversación y una salida para cuando se cansa. Le insistí en que irse a un rincón un rato no es de maleducada. Se puso a llorar cuando contó que una compañera le dijo que era rara.",
        diagnostico: "Ansiedad social secundaria. Impacto en autoestima.",
        plan: "Guion de inicio de conversación practicado en sesión. Trabajar con la familia el mensaje de que retirarse a regular no es portarse mal." },
    ],
    medidas: [
      { tipo: "peso", valores: [[330, 21.5], [200, 22.8], [70, 23.9], [8, 24.4]] },
      { tipo: "talla", valores: [[330, 119], [200, 122], [70, 124.5], [8, 125.5]] },
    ],
  },

  {
    nombre: "Emilia Vargas Roca",
    edad: [2, 3], sexo: "Femenino",
    tutorNombre: "Daniela Roca", tutorParentesco: "Madre",
    telefono: "59177001122",
    notas: "Trisomía 21 confirmada por cariotipo. Cardiopatía congénita corregida a los 5 meses.",
    perfil: {
      condiciones: ["sindrome_down"],
      detalleCondicion: "Trisomía 21 libre. CIV corregida quirúrgicamente a los 5 meses, con control cardiológico anual.",
      apoyoComunicacionSocial: null,
      apoyoConductasRestringidas: null,
      comunicacion: "aumentativa",
      sistemaAumentativo: "Lengua de señas adaptada (unas 20 señas) + primeras palabras",
      fortalezas: ["Muy sociable, busca el contacto", "Imita gestos con facilidad", "Entiende mucho más de lo que expresa"],
      intereses: ["Música", "Libros con texturas", "Bailar"],
    },
    sensorial: [
      { modalidad: "propioceptivo", respuesta: "hipo",
        desencadenantes: [],
        estrategias: ["Juego de empujar y arrastrar antes de las actividades de mesa", "Chaleco con peso 15 minutos"] },
      { modalidad: "oral", respuesta: "hipo",
        desencadenantes: [],
        estrategias: ["Trabajo de praxias orofaciales antes de la comida", "Alimentos de distintas texturas"] },
      { modalidad: "auditivo", respuesta: "sin_datos",
        desencadenantes: [],
        estrategias: ["Pendiente: la audiometría está atrasada y sin eso no se puede leer este eje"] },
      { modalidad: "vestibular", respuesta: "busca", desencadenantes: [], estrategias: ["Hamaca y colchoneta antes de la sesión"] },
    ],
    objetivos: [
      {
        titulo: "Caminar 10 pasos sin apoyo",
        area: "motor",
        criterio: "Recorre 10 pasos sin tomarse de nada, 3 veces en la misma sesión",
        progreso: [
          { dias: 90, logros: 0, intentos: 5, ayuda: "fisica_total", notas: "Camina de las dos manos." },
          { dias: 70, logros: 1, intentos: 5, ayuda: "fisica_parcial", notas: "De una mano, 3 pasos." },
          { dias: 50, logros: 2, intentos: 5, ayuda: "fisica_parcial" },
          { dias: 30, logros: 3, intentos: 5, ayuda: "gestual", notas: "5 pasos hacia la mamá." },
          { dias: 12, logros: 3, intentos: 5, ayuda: "independiente", notas: "8 pasos sola, se sentó de golpe pero sin llorar." },
        ],
      },
      {
        titulo: "Usar la cuchara para llevarse la comida a la boca",
        area: "autonomia",
        criterio: "Se lleva 5 cucharadas a la boca sin ayuda en la misma comida",
        progreso: [
          { dias: 60, logros: 1, intentos: 5, ayuda: "fisica_total" },
          { dias: 40, logros: 2, intentos: 5, ayuda: "fisica_parcial", notas: "Sostiene sola, se le cae a mitad de camino." },
          { dias: 20, logros: 3, intentos: 5, ayuda: "gestual" },
          { dias: 6, logros: 4, intentos: 5, ayuda: "gestual", notas: "Con cuchara de mango engrosado va mucho mejor." },
        ],
      },
    ],
    vigilancia: "sindrome_down",
    // Algunos ya hechos, otros atrasados a propósito: la pantalla tiene que
    // mostrar el calendario haciendo su trabajo, no todo en verde.
    vigilanciaHechos: [
      { nombre: /ecocardiograma/i, dias: 640, resultado: "CIV. Derivada a cirugía." },
      { nombre: /cardiol/i, dias: 120, resultado: "Post-quirúrgico sin secuelas. Control anual." },
      { nombre: /tiroide/i, dias: 400, resultado: "TSH y T4 normales." },
    ],
    sesiones: [
      { dias: 14, duracion: 2400, motivo: "Sesión de estimulación + revisión del calendario de salud",
        texto: "Emilia caminó ocho pasos sola hacia la mamá y las dos nos pusimos a aplaudir. Repasamos el calendario de controles: el ecocardiograma está al día y la tiroides también, pero la audiometría está vencida hace casi un año y la evaluación oftalmológica nunca se hizo. Le expliqué a Daniela que en síndrome de Down la hipoacusia es muy frecuente y que si Emilia no escucha bien vamos a estar trabajando lenguaje contra una pared. Sale con las dos órdenes.",
        diagnostico: "Síndrome de Down. Retraso motor grueso en mejoría. Audición y visión sin evaluar — pendiente prioritario.",
        plan: "Audiometría y evaluación oftalmológica antes del próximo control. Sostener trabajo de marcha y cuchara." },
    ],
    medidas: [
      { tipo: "peso", valores: [[400, 8.9], [280, 9.8], [150, 10.6], [20, 11.2]] },
      { tipo: "talla", valores: [[400, 72], [280, 76], [150, 80], [20, 82.5]] },
      { tipo: "perimetroCefalico", valores: [[400, 44.5], [150, 45.8], [20, 46.3]] },
    ],
  },

  {
    nombre: "Luana Ortiz Camacho",
    edad: [5, 8], sexo: "Femenino",
    tutorNombre: "Marcelo Ortiz", tutorParentesco: "Padre",
    telefono: "59175443322",
    notas: "Diagnóstico dual. El TEA se reconoció recién a los 5, tres años después del síndrome de Down.",
    perfil: {
      // El diagnóstico dual existe y se pasa por alto seguido: todo lo que
      // llama la atención se le atribuye al síndrome de Down y nadie busca
      // lo otro. Por eso las condiciones son una lista, no una etiqueta.
      condiciones: ["sindrome_down", "tea"],
      detalleCondicion: "Trisomía 21 + TEA. La rigidez y las conductas repetitivas se habían atribuido al síndrome de Down durante tres años.",
      apoyoComunicacionSocial: 3,
      apoyoConductasRestringidas: 2,
      comunicacion: "no_verbal",
      sistemaAumentativo: "Tablero de comunicación con 12 pictogramas + 6 señas",
      fortalezas: ["Reconoce a todo el equipo y se alegra al verlos", "Rutinas muy bien aprendidas", "Buena coordinación fina para encastres"],
      intereses: ["Agua", "Luces", "Papel que se arruga"],
    },
    sensorial: [
      { modalidad: "tactil", respuesta: "busca",
        desencadenantes: [],
        estrategias: ["Cesta de texturas disponible", "Juego con agua al final de la sesión, como cierre previsible"] },
      { modalidad: "auditivo", respuesta: "hiper",
        desencadenantes: ["Varias voces a la vez", "Lugares con eco"],
        estrategias: ["Sesión en la sala chica, nunca en el salón grande", "Una sola persona hablando por vez"] },
      { modalidad: "visual", respuesta: "busca",
        desencadenantes: [],
        estrategias: ["Luces de fibra óptica como reforzador", "Cuidar que no se quede enganchada mirando: acordar tiempo"] },
      { modalidad: "propioceptivo", respuesta: "hipo",
        desencadenantes: [],
        estrategias: ["Trabajo de presión profunda antes de la mesa"] },
    ],
    objetivos: [
      {
        titulo: "Entregar el pictograma para pedir agua",
        area: "comunicacion",
        criterio: "Entrega el pictograma en la mano del adulto, 7 de 10 veces, sin ayuda física",
        progreso: [
          { dias: 100, logros: 0, intentos: 10, ayuda: "fisica_total" },
          { dias: 80, logros: 2, intentos: 10, ayuda: "fisica_total" },
          { dias: 60, logros: 3, intentos: 10, ayuda: "fisica_parcial" },
          { dias: 40, logros: 5, intentos: 10, ayuda: "fisica_parcial", notas: "Ya lo levanta sola, hay que acercarle la mano." },
          { dias: 20, logros: 6, intentos: 10, ayuda: "gestual" },
          { dias: 5, logros: 7, intentos: 10, ayuda: "gestual", notas: "Primera vez que llega al criterio." },
        ],
      },
    ],
    vigilancia: "sindrome_down",
    vigilanciaHechos: [
      { nombre: /ecocardiograma/i, dias: 1900, resultado: "Sin cardiopatía." },
      { nombre: /audiometr|audi/i, dias: 200, resultado: "Hipoacusia conductiva leve bilateral. Control en 6 meses." },
      { nombre: /oftalm|visi/i, dias: 300, resultado: "Astigmatismo. Usa anteojos." },
    ],
    sesiones: [
      { dias: 12, duracion: 2700, motivo: "Sesión individual — comunicación aumentativa",
        texto: "Luana entregó el pictograma de agua siete veces de diez, que es la primera vez que llega al criterio. Le comenté al papá que esto no es poco: hasta hace tres meses había que ponerle la mano encima cada vez. Marcelo preguntó cuándo va a hablar. Le dije la verdad, que no lo sé, y que mientras tanto el tablero no le va a quitar el habla — al revés, todo lo que sabemos dice que la comunicación aumentativa favorece el lenguaje oral, no lo frena. Se quedó más tranquilo.",
        diagnostico: "Diagnóstico dual TEA + síndrome de Down. Comunicación no verbal con sistema aumentativo en progreso.",
        plan: "Sostener el tablero. Sumar el pictograma de 'más' la próxima. Psicoeducación a la familia sobre CAA y lenguaje oral." },
    ],
    medidas: [
      { tipo: "peso", valores: [[365, 17.2], [180, 18.4], [30, 19.1]] },
      { tipo: "talla", valores: [[365, 100], [180, 103], [30, 105]] },
    ],
  },

  {
    nombre: "Thiago Núñez Salvatierra",
    edad: [9, 1], sexo: "Masculino",
    tutorNombre: "Vanessa Salvatierra", tutorParentesco: "Madre",
    telefono: "59179887766",
    notas: "Derivado por la escuela por 'mala conducta'. Evaluación posterior: TDAH y trastorno del lenguaje.",
    perfil: {
      // El módulo no es solo autismo, y este caso lo muestra.
      condiciones: ["tdah", "trastorno_lenguaje"],
      detalleCondicion: "TDAH presentación combinada. Trastorno del lenguaje expresivo, que explica buena parte de la frustración en el aula.",
      apoyoComunicacionSocial: null,
      apoyoConductasRestringidas: null,
      comunicacion: "frases",
      sistemaAumentativo: "",
      fortalezas: ["Muy hábil con las manos, arma y desarma todo", "Generoso con los compañeros", "Se engancha muchísimo cuando el tema le interesa"],
      intereses: ["Bicicletas", "Mecánica", "Fútbol"],
    },
    sensorial: [
      { modalidad: "vestibular", respuesta: "busca",
        desencadenantes: [],
        estrategias: ["Mandados a mitad de clase (llevar algo a dirección)", "Banda elástica en las patas de la silla"] },
      { modalidad: "auditivo", respuesta: "mixto",
        desencadenantes: ["Aula con ruido de fondo constante"],
        estrategias: ["Sentarlo adelante", "Consignas de a una por vez, no tres seguidas"] },
      { modalidad: "propioceptivo", respuesta: "busca", desencadenantes: [], estrategias: ["Pausas de movimiento cada 20 minutos"] },
    ],
    objetivos: [
      {
        titulo: "Terminar la tarea con un solo recordatorio",
        area: "academico",
        criterio: "Completa la consigna con máximo 1 recordatorio, 4 de 5 días de la semana",
        progreso: [
          { dias: 70, logros: 1, intentos: 5, ayuda: "verbal", notas: "Hacen falta 4 o 5 recordatorios." },
          { dias: 55, logros: 2, intentos: 5, ayuda: "verbal" },
          { dias: 40, logros: 2, intentos: 5, ayuda: "verbal", notas: "Semana difícil, cambió la medicación." },
          { dias: 25, logros: 3, intentos: 5, ayuda: "verbal" },
          { dias: 10, logros: 4, intentos: 5, ayuda: "gestual", notas: "Con el temporizador visual anda mucho mejor." },
        ],
      },
      {
        titulo: "Pedir la palabra en vez de interrumpir",
        area: "social",
        criterio: "Levanta la mano y espera, 7 de 10 oportunidades",
        progreso: [
          { dias: 60, logros: 2, intentos: 10, ayuda: "gestual" },
          { dias: 40, logros: 4, intentos: 10, ayuda: "gestual" },
          { dias: 20, logros: 5, intentos: 10, ayuda: "gestual" },
          { dias: 7, logros: 6, intentos: 10, ayuda: "verbal", notas: "Se frena solo y se ríe cuando se da cuenta." },
        ],
      },
    ],
    vigilancia: null,
    sesiones: [
      { dias: 9, duracion: 2700, motivo: "Sesión individual + orientación a la familia",
        texto: "Thiago llegó contando que lo sacaron del aula otra vez. Cuando le pregunté qué había pasado no pudo armar la explicación, se enredó y terminó diciendo que no importaba. Eso es exactamente el problema del lenguaje expresivo, no falta de ganas: no puede contar su versión y entonces siempre queda como el culpable. Trabajamos un guion corto para explicar lo que pasó. A Vanessa le pedí que en casa no le pregunte '¿por qué hiciste eso?', que es una pregunta que él no puede contestar, y que use '¿qué pasó primero?'.",
        diagnostico: "TDAH combinado + trastorno del lenguaje expresivo. Impacto en la convivencia escolar.",
        plan: "Guion de secuencia para relatar hechos. Pauta a la familia sobre cómo preguntar. Nota a la escuela: el problema es expresivo, no actitudinal." },
    ],
    medidas: [
      { tipo: "peso", valores: [[300, 27.5], [150, 28.9], [15, 29.8]] },
      { tipo: "talla", valores: [[300, 129], [150, 132], [15, 134]] },
    ],
  },

  {
    nombre: "Benjamín Suárez Antelo",
    edad: [13, 4], sexo: "Masculino",
    tutorNombre: "Patricia Antelo", tutorParentesco: "Madre",
    telefono: "59171223344",
    notas: "Diagnosticado a los 11. En secundaria. El foco ahora es autonomía y autodefensa.",
    perfil: {
      // La mayoría del material sobre autismo se termina en la infancia. Los
      // adolescentes existen y necesitan otra cosa.
      condiciones: ["tea"],
      detalleCondicion: "TEA nivel 1. El trabajo actual es autoconocimiento y pedir sus propios apoyos, no 'corregir' conductas.",
      apoyoComunicacionSocial: 1,
      apoyoConductasRestringidas: 1,
      comunicacion: "verbal_fluida",
      sistemaAumentativo: "",
      fortalezas: ["Programa en Python solo, con tutoriales", "Ético hasta la incomodidad", "Capacidad de concentración enorme"],
      intereses: ["Programación", "Astronomía", "Rubik"],
    },
    sensorial: [
      { modalidad: "auditivo", respuesta: "hiper",
        desencadenantes: ["Recreo en el patio techado", "Bocinas"],
        estrategias: ["Auriculares con música en el recreo — acordado con preceptoría"] },
      { modalidad: "interoceptivo", respuesta: "hipo",
        desencadenantes: [],
        estrategias: ["Alarma para comer: se olvida y llega a la tarde sin haber almorzado"] },
      { modalidad: "olfativo", respuesta: "hiper",
        desencadenantes: ["Perfumes fuertes", "Comedor"],
        estrategias: ["Almuerza en el aula vacía cuando el olor es mucho"] },
      { modalidad: "visual", respuesta: "tipico", desencadenantes: [], estrategias: [] },
    ],
    objetivos: [
      {
        titulo: "Pedir sus adaptaciones por sí mismo a los profesores",
        area: "familiar",
        criterio: "Le pide la adaptación al profesor sin que la madre intervenga, 3 de 4 situaciones",
        progreso: [
          { dias: 80, logros: 0, intentos: 4, ayuda: "fisica_total", notas: "Lo pide la mamá por WhatsApp." },
          { dias: 60, logros: 1, intentos: 4, ayuda: "verbal", notas: "Con la nota escrita en la mano." },
          { dias: 40, logros: 2, intentos: 4, ayuda: "verbal" },
          { dias: 20, logros: 2, intentos: 4, ayuda: "gestual" },
          { dias: 5, logros: 3, intentos: 4, ayuda: "independiente", notas: "Le pidió al profe de química rendir por escrito. Solo." },
        ],
      },
      {
        titulo: "Iniciar una conversación con un compañero",
        area: "social",
        criterio: "Inicia y sostiene 3 turnos de conversación, 2 veces por semana",
        progreso: [
          { dias: 50, logros: 0, intentos: 2, ayuda: "verbal" },
          { dias: 35, logros: 1, intentos: 2, ayuda: "verbal", notas: "Habló con un chico del club de robótica." },
          { dias: 18, logros: 1, intentos: 2, ayuda: "independiente" },
          { dias: 4, logros: 2, intentos: 2, ayuda: "independiente", notas: "El club de robótica está siendo el mejor tratamiento." },
        ],
      },
    ],
    vigilancia: "tea",
    sesiones: [
      { dias: 6, duracion: 3000, motivo: "Sesión individual — autodefensa y adaptaciones",
        texto: "Benjamín le pidió solo al profesor de química rendir por escrito en vez de oral. Es la primera vez que gestiona una adaptación sin que la madre escriba por él. Le pregunté cómo se sintió y dijo que le costó pero que fue más rápido que explicárselo a la mamá para que ella lo explicara. Hablamos de a quién le cuenta que es autista y a quién no, y le insistí en que eso es decisión suya y de nadie más. Está yendo al club de robótica y ahí habla con dos chicos.",
        diagnostico: "TEA nivel 1. Buen desarrollo de autodefensa. Sin indicadores de ansiedad o ánimo bajo en este momento.",
        plan: "Sostener el club de robótica como espacio social genuino. Seguir trabajando el guion de pedido de adaptaciones. Revisión mensual." },
      { dias: 34, duracion: 2700, motivo: "Sesión individual",
        texto: "Vino preocupado porque un grupo de compañeros lo invitó a una fiesta y no sabe si es una invitación real o una burla. Ya le pasó en primaria. Repasamos señales concretas para distinguir una cosa de otra y armamos un plan de salida por si se siente mal. Le dije que si no quiere ir, no ir también es una opción válida y que no tiene que forzarse a socializar para demostrar nada.",
        diagnostico: "Ansiedad anticipatoria ante situación social ambigua. Antecedente de acoso escolar en primaria.",
        plan: "Criterios concretos para leer intenciones. Plan de salida acordado. No forzar exposición social." },
    ],
    medidas: [
      { tipo: "peso", valores: [[300, 42], [150, 45], [12, 47.5]] },
      { tipo: "talla", valores: [[300, 152], [150, 157], [12, 161]] },
    ],
  },
];

// ─── ARMADO ───────────────────────────────────────────────────────────────
function segmentos(texto, duracion) {
  const partes = texto.split(". ").filter(Boolean);
  const paso = duracion / partes.length;
  return partes.map((t, i) => ({
    hablante: i % 2 === 0 ? "A" : "B",
    texto: t.trim().endsWith(".") ? t.trim() : t.trim() + ".",
    inicioSeg: Math.round(i * paso),
    finSeg: Math.round((i + 1) * paso),
  }));
}

async function crearPaciente(medicoPhone, d) {
  const yaEsta = await Paciente.findOne({ medicoPhone, nombre: d.nombre });
  if (yaEsta) {
    const tienePerfil = await PerfilNeuro.findOne({ pacienteId: yaEsta._id });
    if (tienePerfil) {
      console.log(`   · ${d.nombre} — ya estaba, se saltea`);
      return null;
    }
    await Paciente.deleteOne({ _id: yaEsta._id });
  }

  const paciente = await Paciente.create({
    medicoPhone,
    codigo: await siguienteCodigo(Paciente, medicoPhone, "P"),
    nombre: d.nombre,
    fechaNacimiento: nacimientoHace(d.edad[0], d.edad[1]),
    sexo: d.sexo,
    telefono: d.telefono,
    notas: d.notas,
    tutorNombre: d.tutorNombre,
    tutorParentesco: d.tutorParentesco,
  });

  // ─── Perfil + mapa sensorial ────────────────────────────────────────────
  // El perfil sensorial arranca con las 8 modalidades en "sin_datos" (así lo
  // crea perfilDe()); acá se completan solo las que el equipo evaluó. Dejar
  // las otras sin datos es más honesto que ponerles "típico" por defecto.
  const MODALIDADES = ["auditivo", "tactil", "visual", "vestibular", "propioceptivo", "oral", "olfativo", "interoceptivo"];
  const sensorial = MODALIDADES.map(m => {
    const cargada = (d.sensorial || []).find(s => s.modalidad === m);
    if (!cargada) return { modalidad: m, respuesta: "sin_datos", desencadenantes: [], estrategias: [], historial: [] };
    return {
      modalidad: m,
      respuesta: cargada.respuesta,
      desencadenantes: cargada.desencadenantes || [],
      estrategias: cargada.estrategias || [],
      historial: [{ fecha: haceDias(30), respuesta: cargada.respuesta, notas: "", fuente: "manual", consultaId: null }],
    };
  });

  await PerfilNeuro.create({
    pacienteId: paciente._id, medicoPhone,
    ...d.perfil,
    perfilSensorial: sensorial,
  });

  // ─── Objetivos con su curva de progreso ────────────────────────────────
  for (const o of d.objetivos || []) {
    await ObjetivoNeuro.create({
      pacienteId: paciente._id, medicoPhone,
      titulo: o.titulo, area: o.area, criterio: o.criterio,
      estado: o.estado || "activo",
      fechaInicio: haceDias((o.progreso[0]?.dias || 90) + 7),
      fechaCierre: o.estado === "logrado" ? haceDias(2) : null,
      progreso: o.progreso.map(p => ({
        fecha: haceDias(p.dias),
        logros: p.logros, intentos: p.intentos, ayuda: p.ayuda,
        notas: p.notas || "",
        profesional: "Lic. Fernanda Suárez",
      })),
    });
  }

  // ─── Calendario de vigilancia ──────────────────────────────────────────
  if (d.vigilancia) {
    const plantilla = PLANTILLAS_VIGILANCIA[d.vigilancia];
    const items = plantilla.items.map(i => ({ ...i, pacienteId: paciente._id, medicoPhone }));
    // Los que ya se hicieron: sin esto la pantalla saldría toda en rojo, que
    // no es lo que se quiere mostrar — se quiere mostrar el calendario
    // trabajando, con algo al día y algo atrasado.
    for (const hecho of d.vigilanciaHechos || []) {
      const item = items.find(i => hecho.nombre.test(i.nombre));
      if (item) item.realizados = [{ fecha: haceDias(hecho.dias), resultado: hecho.resultado, estudioId: null }];
    }
    await VigilanciaSalud.insertMany(items);
  }

  // ─── Sesiones ya transcriptas y con nota ───────────────────────────────
  // Vienen hechas a propósito: en una demo no se puede depender de que la
  // transcripción y la nota por IA terminen a tiempo.
  for (const s of d.sesiones || []) {
    await ConsultaMedica.create({
      medicoPhone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
      estado: "completado",
      duracionSegundos: s.duracion,
      transcripcionCompleta: s.texto,
      segmentos: segmentos(s.texto, s.duracion),
      notaClinicaEstado: "completado",
      confirmadaEn: haceDias(s.dias),
      notaClinica: {
        motivoConsulta: s.motivo,
        sintomas: [],
        diagnostico: s.diagnostico,
        diagnosticosDiferenciales: [],
        plan: s.plan,
        medicamentosRecetados: [],
        examenesSolicitados: [],
        proximoControl: "",
      },
      createdAt: haceDias(s.dias),
      updatedAt: haceDias(s.dias),
    });
  }

  // ─── Medidas, para que las curvas de crecimiento muestren algo ─────────
  for (const m of d.medidas || []) {
    for (const [dias, valor] of m.valores) {
      await Medicion.create({
        pacienteId: paciente._id, medicoPhone,
        tipo: m.tipo, valor, fecha: haceDias(dias),
      });
    }
  }

  const cuantos = (d.objetivos || []).length;
  console.log(`   ✓ ${d.nombre} (${paciente.codigo}) — ${d.perfil.condiciones.join(" + ")} · ${cuantos} objetivo${cuantos === 1 ? "" : "s"}${d.vigilancia ? " · calendario de salud" : ""}`);
  return paciente;
}

// ─── PRINCIPAL ────────────────────────────────────────────────────────────
(async () => {
  const phone = String(process.argv[2] || "").trim();
  if (!phone) {
    console.error("\n  Uso: node scripts/seed_neurodesarrollo_demo.js <telefono> [\"Nombre\"] [password]\n");
    process.exit(1);
  }
  const nombre = process.argv[3] || "Lic. Fernanda Suárez";
  const password = process.argv[4] || "demo12345";

  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log("\n  Vitalis Neurodesarrollo — demo de psicología infantil\n");

  let medico = await Medico.findOne({ phone });
  if (medico) {
    // No se le pisa la contraseña a una cuenta que ya existe: puede ser la
    // de alguien que la está usando de verdad.
    medico.tipoEspecialidad = "neurodesarrollo";
    medico.especialidad = "Psicología infantil y del neurodesarrollo";
    await medico.save();
    console.log(`  Cuenta ${phone} ya existía — se ajustó la especialidad, la contraseña quedó como estaba.`);
  } else {
    medico = await Medico.create({
      phone, nombre,
      especialidad: "Psicología infantil y del neurodesarrollo",
      tipoEspecialidad: "neurodesarrollo",
      passwordHash: await hashPassword(password),
      activo: true,
    });
    console.log(`  Cuenta creada: ${phone} / ${password}`);
  }

  console.log("\n  Pacientes:");
  let creados = 0;
  for (const d of PACIENTES) {
    if (await crearPaciente(phone, d)) creados++;
  }

  console.log(`\n  Listo — ${creados} paciente${creados === 1 ? "" : "s"} nuevo${creados === 1 ? "" : "s"}.`);
  console.log(`  Entrá con ${phone}${creados ? ` / ${password}` : ""} y abrí la pestaña Perfil de cualquiera.\n`);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("\n  ✖", e.message, "\n");
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
