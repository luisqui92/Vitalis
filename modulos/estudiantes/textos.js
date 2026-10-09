// Symphomed — Los textos del módulo de estudiantes que arma el servidor
// (los de la pantalla están en public/i18n/<idioma>/estudiantes*.js).
const TEXTOS = {
  es: {
    kardexAlerta: {
      titulo: "REGISTRO DE ESTUDIANTE",
      texto: "Escrito desde una cuenta de estudiante. Sin la firma del médico responsable no tiene validez como historia clínica.",
    },
  },
  pt: {
    kardexAlerta: {
      titulo: "REGISTRO DE ESTUDANTE",
      texto: "Escrito a partir de uma conta de estudante. Sem a assinatura do médico responsável, não tem validade como prontuário.",
    },
  },
};

const textosDe = (idioma) => TEXTOS[idioma] || TEXTOS.es;

module.exports = { textosDe };
