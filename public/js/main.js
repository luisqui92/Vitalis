// Symphomed — arranque. Se carga último, después de que todos los módulos
// definieron sus funciones.
btnLogout.onclick = logout;
btnAsistente.onclick = abrirAsistente;
if (TOKEN) btnAsistente.style.display = "inline-flex";

// La página del informe del paciente (/informe/<token>) no es la app: no
// tiene login, no tiene menú, y hay que atenderla antes que nada.
if (typeof esPaginaInformePublico === "function" && esPaginaInformePublico()) {
  renderInformePublico();
} else if (typeof esPaginaTeleconsulta === "function" && esPaginaTeleconsulta()) {
  // La sala del paciente (/teleconsulta/<token>): tampoco es la app. Va
  // antes del login, porque quien la abre no tiene cuenta.
  renderTeleconsulta();
} else {

aplicarTemaSegunEspecialidad();
aplicarLandingVeterinariaSiCorresponde();
if (TOKEN) {
  conectarTiempoReal();
  irAPantallaInicial();
} else {
  renderLogin();
}
}
