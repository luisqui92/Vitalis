// Vitalis — Español · visor de imágenes con mediciones y calibración.
//
// La regla del visor: sin calibración, píxeles. Nunca milímetros inventados.
// Los avisos de abajo son parte de esa honestidad y no son decorativos —
// distinguen un número medido por el equipo de uno marcado a ojo.
Object.assign(I18N.es, {
  "visor.abriendo": "Abriendo imagen...",
  "visor.errAbrir": "No se pudo abrir la imagen.",
  "visor.cerrar": "Cerrar",
  "visor.imagen": "Imagen",
  "visor.calibrada": " · calibrada",
  "visor.modo.mover": "Mover",
  "visor.modo.distancia": "Medir",
  "visor.modo.angulo": "Ángulo",
  "visor.modo.calibrar": "Calibrar",
  "visor.modo.recalibrar": "Recalibrar",
  "visor.brillo": "Brillo",
  "visor.contraste": "Contraste",
  "visor.restablecer": "Restablecer",
  "visor.borrarMediciones": "Borrar mediciones",
  "visor.guardar": "Guardar",
  "visor.guardado": "✅ Guardado",
  "visor.errGuardar": "No se pudo guardar",
  "visor.pista.mover": "Arrastrá para mover · pellizcá o rueda para acercar",
  "visor.pista.distancia": "Tocá dos puntos para medir",
  "visor.pista.angulo": "Tocá tres puntos: extremo, vértice, extremo",
  "visor.pista.calibrar": "Marcá dos puntos de una distancia que conozcas",
  "visor.avisoPixeles": "Las distancias están en píxeles. Una imagen JPEG o PNG no trae el tamaño real\n         del píxel, así que para tener milímetros hay que calibrar con 🎯.",
  "visor.avisoDicom": "Escala del equipo (DICOM) — no hace falta calibrar.",
  "visor.avisoDetector": "Es la medida en el detector: en radiografía el objeto sale algo agrandado.\n           Para el milímetro real, poné una referencia conocida en el mismo plano.",
  "visor.confirmarRecalibrar": "Esta imagen ya trae la escala del equipo (DICOM), que es más exacta que marcarla a mano.\n\nRecalibrar solo conviene si estás usando una referencia de tamaño conocido apoyada en el mismo plano que lo que vas a medir.\n\n¿Seguir igual?",
  "visor.pedirMm": "¿Cuántos milímetros mide en la realidad la distancia que acabás de marcar?\n\nMarcaste {px} píxeles.\n\nReferencias que suelen servir: el largo del sensor intraoral (39 mm en el\ntamaño 2), una regla radiopaca, o un objeto de medida conocida en la placa.",
  "visor.errMm": "Poné un número de milímetros mayor a cero.",
  "visor.confirmarBorrarMediciones": "¿Borrar todas las mediciones de esta imagen?",
  "visor.confirmarSalir": "Tenés cambios sin guardar (mediciones o ajustes). ¿Salir igual?",
  "visor.referencia": "{mm} mm sobre {px} px",
});
