// Symphomed — Español · Fisioterapia: mapa de dolor sobre la silueta,
// goniometría contra rango de referencia y objetivos funcionales.
//
// Las UNIDADES no se traducen: los grados son grados y la escala de dolor va
// de 0 a 10 en todos lados. Lo único que cambia con el idioma son los
// nombres de las regiones, los movimientos y los textos de pantalla.
Object.assign(I18N.es, {
  // ─── Pestañas ──────────────────────────────────────────────────────────
  "tab.evaluacion": "Evaluación",
  "tab.movilidad": "Movilidad",

  // ─── Generales del módulo ──────────────────────────────────────────────
  "fisio.cargando": "Cargando...",
  "fisio.errCargar": "No se pudo cargar",
  "fisio.errGuardar": "No se pudo guardar",
  "fisio.guardar": "Guardar",
  "fisio.guardado": "Guardado",
  "fisio.cancelar": "Cancelar",
  "fisio.opcional": "Opcional",

  // ─── Mapa de dolor ─────────────────────────────────────────────────────
  "fisio.mapa.titulo": "Dónde le duele",
  "fisio.mapa.ayuda": "Tocá la silueta donde el paciente refiere dolor.",
  "fisio.mapa.vacio": "Todavía no hay nada marcado en esta vista.",
  "fisio.vista.frente": "De frente",
  "fisio.vista.espalda": "De espaldas",

  "fisio.puntos.titulo": "Puntos marcados",
  "fisio.puntos.confirmarBorrar": "¿Sacar este punto del mapa? Las mediciones anteriores se conservan.",

  "fisio.dolor.titulo": "Marcar dolor",
  // Es el aviso que evita el error de anotar el lado al revés.
  "fisio.dolor.ladoAviso": "de frente, la izquierda de la pantalla es el lado derecho del paciente",
  "fisio.dolor.region": "Región",
  "fisio.dolor.lado": "Lado",
  "fisio.dolor.intensidad": "Intensidad",
  "fisio.dolor.tipo": "Tipo de dolor",
  "fisio.dolor.notas": "Observaciones",
  "fisio.dolor.marcar": "Marcar",

  // ─── Evaluación ────────────────────────────────────────────────────────
  "fisio.ev.titulo": "Evaluación inicial",
  "fisio.ev.motivo": "Motivo de consulta",
  "fisio.ev.motivoPh": "Ej: dolor lumbar al levantarse",
  "fisio.ev.mecanismo": "Cómo se produjo",
  "fisio.ev.mecanismoPh": "Ej: levantó una caja girando el tronco",
  "fisio.ev.desde": "Desde cuándo",
  "fisio.ev.notas": "Notas",
  "fisio.ev.notasPh": "Opcional",

  // ─── Banderas rojas ────────────────────────────────────────────────────
  "fisio.banderas.titulo": "Banderas rojas",
  "fisio.banderas.ayuda": "Signos que obligan a derivar antes de tratar. Marcá los que estén presentes.",
  "fisio.banderas.hay": "Hay banderas rojas marcadas",
  "fisio.banderas.aviso": "Es una lista de alerta, no un diagnóstico: la conducta la decidís vos.",
  "fisio.bandera.dolor_nocturno_no_cede": "Dolor nocturno que no cede con el reposo",
  "fisio.bandera.perdida_peso_inexplicada": "Pérdida de peso sin explicación",
  "fisio.bandera.fiebre": "Fiebre",
  "fisio.bandera.antecedente_oncologico": "Antecedente oncológico",
  "fisio.bandera.trauma_significativo": "Traumatismo importante",
  "fisio.bandera.deficit_neurologico_progresivo": "Déficit neurológico que avanza",
  "fisio.bandera.alteracion_esfinteres": "Alteración de esfínteres",
  "fisio.bandera.anestesia_silla_montar": "Anestesia en silla de montar",
  "fisio.bandera.dolor_toracico_esfuerzo": "Dolor torácico con el esfuerzo",
  "fisio.bandera.corticoides_prolongados": "Corticoides por tiempo prolongado",

  // ─── Regiones del cuerpo ───────────────────────────────────────────────
  "reg.cervical": "Cervical",
  "reg.hombro": "Hombro",
  "reg.codo": "Codo",
  "reg.muneca": "Muñeca",
  "reg.mano": "Mano",
  "reg.torax": "Tórax",
  "reg.abdomen": "Abdomen",
  "reg.dorsal": "Dorsal",
  "reg.lumbar": "Lumbar",
  "reg.sacroiliaca": "Sacroilíaca",
  "reg.cadera": "Cadera",
  "reg.muslo": "Muslo",
  "reg.rodilla": "Rodilla",
  "reg.pierna": "Pierna",
  "reg.tobillo": "Tobillo",
  "reg.pie": "Pie",
  "reg.otra": "Otra",

  // ─── Lados ─────────────────────────────────────────────────────────────
  "lado.izquierdo": "Izquierdo",
  "lado.derecho": "Derecho",
  "lado.central": "Central",
  "lado.bilateral": "Bilateral",

  // ─── Tipos de dolor ────────────────────────────────────────────────────
  "dolor.mecanico": "Mecánico",
  "dolor.inflamatorio": "Inflamatorio",
  "dolor.neuropatico": "Neuropático",
  "dolor.referido": "Referido",
  "dolor.sin_clasificar": "Sin clasificar",

  // ─── Movilidad / goniometría ───────────────────────────────────────────
  "fisio.rom.nueva": "Tomar una medida",
  "fisio.rom.actual": "Última medida de cada movimiento",
  "fisio.rom.historial": "Historial",
  "fisio.rom.vacio": "Todavía no hay medidas cargadas.",
  "fisio.rom.articulacion": "Articulación",
  "fisio.rom.movimiento": "Movimiento",
  "fisio.rom.lado": "Lado",
  "fisio.rom.grados": "Grados",
  "fisio.rom.gradosPh": "Ej: 95",
  "fisio.rom.fecha": "Fecha",
  "fisio.rom.referencia": "Rango de referencia: {n}°",
  "fisio.rom.contra": "de {n}° de referencia — {p}%",
  "fisio.rom.extensionCompleta": "Extensión completa",
  "fisio.rom.faltaExtension": "Le faltan {g}° para la extensión completa",
  "fisio.rom.confirmarBorrar": "¿Borrar esta medida?",

  // ─── Articulaciones ────────────────────────────────────────────────────
  "art.hombro": "Hombro",
  "art.codo": "Codo",
  "art.muneca": "Muñeca",
  "art.cervical": "Cervical",
  "art.lumbar": "Lumbar",
  "art.cadera": "Cadera",
  "art.rodilla": "Rodilla",
  "art.tobillo": "Tobillo",

  // ─── Movimientos ───────────────────────────────────────────────────────
  "mov.flexion": "Flexión",
  "mov.extension": "Extensión",
  "mov.abduccion": "Abducción",
  "mov.aduccion": "Aducción",
  "mov.rotacion": "Rotación",
  "mov.rotacion_interna": "Rotación interna",
  "mov.rotacion_externa": "Rotación externa",
  "mov.pronacion": "Pronación",
  "mov.supinacion": "Supinación",
  "mov.inclinacion": "Inclinación",
  "mov.desviacion_radial": "Desviación radial",
  "mov.desviacion_cubital": "Desviación cubital",
  "mov.flexion_dorsal": "Flexión dorsal",
  "mov.flexion_plantar": "Flexión plantar",
  "mov.inversion": "Inversión",
  "mov.eversion": "Eversión",

  // ─── Objetivos funcionales ─────────────────────────────────────────────
  "fisio.obj.nuevo": "Nuevo objetivo",
  "fisio.obj.titulo": "Objetivo",
  "fisio.obj.tituloPh": "Ej: subir un piso de escalera sin baranda",
  "fisio.obj.area": "Área",
  "fisio.obj.criterio": "Cuándo se considera logrado",
  "fisio.obj.criterioPh": "Ej: 10 escalones alternando pies, sin apoyo",
  "fisio.obj.criterioAyuda": "Escribilo de modo que se pueda contar: cuántas repeticiones, en qué condiciones.",
  "fisio.obj.crear": "Crear objetivo",
  "fisio.obj.vacio": "Todavía no hay objetivos cargados.",
  "fisio.obj.sinSesiones": "Todavía no se registró ninguna sesión.",
  "fisio.obj.registrar": "Registrar sesión",
  "fisio.obj.marcarLogrado": "Marcar logrado",
  "fisio.obj.reabrir": "Reabrir",
  "fisio.obj.borrar": "Borrar",
  "fisio.obj.confirmarBorrar": "¿Borrar este objetivo y todas sus sesiones?",
  "fisio.obj.sesiones": "{n} sesiones",
  "fisio.obj.ultima": "{a} de {b} la última vez",
  "fisio.obj.dolorTit": "dolor",
  "fisio.obj.graficoAlt": "Nivel de ayuda a lo largo de {n} sesiones, con el dolor de cada una en el color del punto.",
  "fisio.obj.leyenda": "La línea que sube es el avance: cuanto más arriba, menos ayuda necesita. El color del punto es el dolor de esa sesión.",
  "fisio.obj.mejora": "Necesita <b>menos ayuda</b> que al empezar: de «{a}» a «{b}». Eso es el avance, aunque el porcentaje suba o baje.",
  // El caso que justifica que el dolor y la ayuda estén en el mismo gráfico.
  "fisio.obj.ojoDolor": "Necesita menos ayuda, pero <b>con más dolor que al principio</b>. Vale la pena revisar si está compensando antes de darlo por logrado.",

  // ─── Áreas del objetivo ────────────────────────────────────────────────
  "areaFisio.movilidad": "Movilidad",
  "areaFisio.fuerza": "Fuerza",
  "areaFisio.equilibrio": "Equilibrio",
  "areaFisio.marcha": "Marcha",
  "areaFisio.dolor": "Dolor",
  "areaFisio.funcional": "Funcional",
  "areaFisio.respiratorio": "Respiratorio",
  "areaFisio.postural": "Postural",

  // ─── Estado del objetivo ───────────────────────────────────────────────
  "estadoObj.activo": "Activo",
  "estadoObj.logrado": "Logrado",
  "estadoObj.suspendido": "Suspendido",

  // ─── Niveles de ayuda ──────────────────────────────────────────────────
  "ayuda.independiente": "Solo, sin ayuda",
  "ayuda.verbal": "Con que se lo recuerden",
  "ayuda.gestual": "Con que se lo señalen",
  "ayuda.fisica_parcial": "Con un poco de ayuda física",
  "ayuda.fisica_total": "Tomándole la mano",
  // Versión corta para el eje del gráfico, donde no entra la larga.
  "ayudaCorta.independiente": "Solo",
  "ayudaCorta.verbal": "Recordándole",
  "ayudaCorta.gestual": "Señalándole",
  "ayudaCorta.fisica_parcial": "Ayuda parcial",
  "ayudaCorta.fisica_total": "De la mano",

  // ─── Registrar una sesión ──────────────────────────────────────────────
  "fisio.sesion.titulo": "Registrar sesión",
  "fisio.sesion.fecha": "Fecha",
  "fisio.sesion.intentos": "Cuántas repeticiones se intentaron",
  "fisio.sesion.intentosPh": "Ej: 10",
  "fisio.sesion.logros": "Cuántas salieron",
  "fisio.sesion.logrosPh": "Ej: 6",
  "fisio.sesion.ayuda": "Cuánta ayuda necesitó",
  "fisio.sesion.dolor": "Dolor durante el ejercicio",
  "fisio.sesion.dolorAyuda": "Si salieron todas pero con dolor alto, el objetivo todavía no está logrado.",
  "fisio.sesion.notas": "Observaciones",
});
