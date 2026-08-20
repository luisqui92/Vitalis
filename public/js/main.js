// Vitalis — arranque. Se carga último, después de que todos los módulos
// definieron sus funciones.
btnLogout.onclick = logout;
btnAsistente.onclick = abrirAsistente;
if (TOKEN) btnAsistente.style.display = "inline-flex";

aplicarTemaSegunEspecialidad();
aplicarLandingVeterinariaSiCorresponde();
if (TOKEN) {
  conectarTiempoReal();
  if (typeof activarEscritorioSiCorresponde === "function" && activarEscritorioSiCorresponde()) renderInicioEscritorio();
  else renderDashboard();
} else {
  renderLogin();
}
