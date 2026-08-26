// Vitalis — Português · visualizador de imagens com medições e calibração.
//
// A regra do visualizador: sem calibração, pixels. Nunca milímetros
// inventados. Os avisos abaixo fazem parte dessa honestidade — distinguem um
// número medido pelo equipamento de um marcado a olho.
Object.assign(I18N.pt, {
  "visor.abriendo": "Abrindo imagem...",
  "visor.errAbrir": "Não foi possível abrir a imagem.",
  "visor.cerrar": "Fechar",
  "visor.imagen": "Imagem",
  "visor.calibrada": " · calibrada",
  "visor.modo.mover": "Mover",
  "visor.modo.distancia": "Medir",
  "visor.modo.angulo": "Ângulo",
  "visor.modo.calibrar": "Calibrar",
  "visor.modo.recalibrar": "Recalibrar",
  "visor.brillo": "Brilho",
  "visor.contraste": "Contraste",
  "visor.restablecer": "Restaurar",
  "visor.borrarMediciones": "Apagar medições",
  "visor.guardar": "Salvar",
  "visor.guardado": "✅ Salvo",
  "visor.errGuardar": "Não foi possível salvar",
  "visor.pista.mover": "Arraste para mover · pince ou use a roda para aproximar",
  "visor.pista.distancia": "Toque em dois pontos para medir",
  "visor.pista.angulo": "Toque em três pontos: extremidade, vértice, extremidade",
  "visor.pista.calibrar": "Marque dois pontos de uma distância que você conheça",
  "visor.avisoPixeles": "As distâncias estão em pixels. Uma imagem JPEG ou PNG não traz o tamanho real do pixel, então para ter milímetros é preciso calibrar com 🎯.",
  "visor.avisoDicom": "Escala do equipamento (DICOM) — não precisa calibrar.",
  "visor.avisoDetector": "É a medida no detector: em radiografia o objeto sai um pouco ampliado. Para o milímetro real, coloque uma referência conhecida no mesmo plano.",
  "visor.confirmarRecalibrar": "Esta imagem já traz a escala do equipamento (DICOM), que é mais exata do que marcar à mão.\n\nRecalibrar só vale a pena se você estiver usando uma referência de tamanho conhecido apoiada no mesmo plano do que vai medir.\n\nSeguir mesmo assim?",
  "visor.pedirMm": "Quantos milímetros mede na realidade a distância que você acabou de marcar?\n\nVocê marcou {px} pixels.\n\nReferências que costumam servir: o comprimento do sensor intraoral (39 mm no tamanho 2), uma régua radiopaca, ou um objeto de medida conhecida na placa.",
  "visor.errMm": "Digite um número de milímetros maior que zero.",
  "visor.confirmarBorrarMediciones": "Apagar todas as medições desta imagem?",
  "visor.confirmarSalir": "Você tem alterações não salvas (medições ou ajustes). Sair mesmo assim?",
  "visor.referencia": "{mm} mm sobre {px} px",
});
