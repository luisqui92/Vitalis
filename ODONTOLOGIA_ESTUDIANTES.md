# Odontología en Symphomed Estudiantes

Esta implementación añade la carrera `odontologia` al módulo existente. Comparte
cuentas, invitaciones, cupos, banco de preguntas, prácticas, rachas y repaso.
No modifica los odontogramas del consultorio cuando se registra un caso simulado.

## Recorrido implementado

1. Entrar con un código de estudiante o interno de Odontología.
2. Elegir un paciente virtual de cariología/restauradora, endodoncia/dolor,
   periodoncia, cirugía/urgencias, odontopediatría o prevención.
3. Entrevistar al paciente y solicitar las exploraciones preparadas.
4. Registrar hallazgos en un odontograma gráfico con nomenclatura FDI:
   dentición permanente, temporal o mixta, superficies y anotaciones.
5. Guardar el registro y entregar diagnóstico, diferenciales y plan razonado.
6. Revisar entrevista, estudios, comunicación, plan y comparación del odontograma.
7. Repasar los errores en las tarjetas existentes, con enlace al caso original.

Los simulacros también incluyen anatomía dental. Las pantallas y áreas están
traducidas al español y portugués. No se agregan nuevos niveles ni precios.

## Reglas del odontograma

- Las superficies incisales y oclusales dependen del diente. La representación
  orienta mesial/distal según el cuadrante.
- Se distingue **sin registrar** de **sano**. No se infiere normalidad de datos
  ausentes.
- `caries`, `restauracion`, `fractura`, `sellante` y `sano` son estados por
  superficie. `ausente`, `corona`, `endodoncia` e `implante` se registran por pieza.
- Una pieza ausente no puede tener otros hallazgos. En esta primera versión hay
  un estado global por pieza; no es una historia de tratamientos.
- El servidor valida los registros, su tamaño y la revisión del documento.
  Una edición de otra sesión produce conflicto en lugar de sobreescribirse.
- Se usa el mismo candado de la conversación al guardar y al entregar.
  Las prácticas evaluando, terminadas o abandonadas no admiten cambios.
- La comparación por superficie es determinista. Un registro que el caso no
  describe se muestra como adicional para revisar, no como error automático.

## Casos y evaluación

El generador existente se especializa para Odontología y exige un odontograma
estructurado y criterios de planificación. El segundo modelo comprueba el
diagnóstico y que el odontograma esté respaldado por el examen.

Los resultados de exploración dental se leen literalmente del caso; un pedido
no preparado informa que no está disponible. No se generan nuevos hallazgos
durante la consulta. El paciente conversacional no recibe el diagnóstico, el
odontograma esperado ni el plan. Los resultados completos se muestran al entregar.

La evaluación del plan sigue siendo de IA. No equivale a revisión de un docente
ni a validación de destrezas manuales.

## Habilitar y preparar contenido

En un entorno con las dependencias, MongoDB y las credenciales habituales
configuradas:

```bash
node scripts/codigos_estudiante.js crear --carrera odontologia --nivel estudiante --meses 1
```

El registro toma la carrera del código; no permite cambiarla mediante el cuerpo
del pedido del navegador. No se requiere migrar las cuentas de Medicina o
Enfermería.

Para preparar hasta **18 casos** (6 áreas × 3 dificultades, 1 por combinación):

```bash
node scripts/banco_estudio.js casos --carrera odontologia --todas --n 1 --idioma es
```

Este comando llama a la IA y consume el presupuesto configurado. **No se ejecutó
contra la base de producción ni se incluye un banco de casos aprobado.**

Para revisar el contenido de un área:

```bash
node scripts/banco_estudio.js muestra --casos --area odo_cariologia --n 10 --idioma es
node scripts/banco_estudio.js ocultar ID_DEL_CASO
```

La muestra dental imprime historia, examen, estudios, registro FDI y criterios
del plan. Revisar todas las áreas con un odontólogo docente antes del piloto
comercial. La doble comprobación de IA no sustituye esa revisión.

## Datos e integración

- `SimulacionPaciente.odontograma`: registro del alumno y revisión.
- `guion.odontologia`: dentición, registro esperado y criterios del plan.
- `evaluacion.odontograma`: coincidencias, omisiones, diferencias y adicionales.
- `evaluacion.planTratamiento`: aspectos adecuados, faltantes e inadecuados.
- Las tarjetas provenientes de simulaciones usan `simulacionId`, con índice
  único por estudiante, práctica y tipo. Los tipos nuevos son `planDental` y
  `odontograma`; el diagnóstico, las alarmas y las preguntas omitidas reutilizan
  tipos existentes.
- `PUT /medico/pacientes-virtuales/:id/odontograma` guarda el registro.
- `POST /medico/pacientes-virtuales/:id/repaso` recupera la creación de tarjetas
  si falló al terminar; repetirlo no duplica las tarjetas.

En el despliegue, comprobar que MongoDB haya creado el nuevo índice único de
tarjetas. Si el entorno desactiva la creación automática de índices, gestionarlo
mediante su proceso habitual de migraciones.

## Verificación

Ejecutado localmente:

```bash
node scripts/pruebas/probar_odontologia.js
node scripts/pruebas/probar_odontologia_pantalla.js
node scripts/pruebas/probar_globales_unicos.js
```

Las dos pruebas nuevas cubren reglas, privacidad del guion, planes incompletos,
permisos, revisiones, reintentos, inmutabilidad, repaso, traducciones, interacción
del editor y escape de contenido. Usan dobles explícitos de IA/base/DOM:
**no son pruebas de integración con MongoDB ni de diseño en navegador**.

También se comprobó sintaxis de JavaScript y espacios del diff. En este entorno
faltan las dependencias del servidor (por ejemplo, `mongoose` y `axios`) y el
sandbox impide iniciar Chromium. Por eso no se da por aprobada la suite completa.

Antes de integrar/desplegar, ejecutar `npm ci` y `npm test` en el entorno de CI,
además de probar el recorrido real con MongoDB y navegador, en celular y
escritorio: código de invitación → caso → guardado → recarga → entrega → repaso.
Comprobar también los recorridos existentes de Medicina y Enfermería.

## Alcance pendiente de contenido y fases posteriores

Esta entrega utiliza **informes de estudios simulados en texto**. No incluye
fotografías clínicas, radiografías reales ni un banco de 15–20 casos revisado por
una persona. Para incorporar imágenes hacen falta archivos autorizados,
anonimizados, con procedencia y revisión docente; no se presentan imágenes
inventadas como estudios diagnósticos.

El periodontograma avanzado, interpretación radiográfica con imágenes,
historia de tratamientos por pieza y más especialidades quedan fuera de esta
primera versión. La arquitectura permite ampliarlos sin duplicar las carreras.
