// Vitalis — arranque. Se carga último, después de que todos los módulos
// definieron sus funciones.
btnLogout.onclick = logout;
btnAsistente.onclick = abrirAsistente;
if (TOKEN) btnAsistente.style.display = "inline-flex";

// La página del informe del paciente (/informe/<token>) no es la app: no
// tiene login, no tiene menú, y hay que atenderla antes que nada.
if (typeof esPaginaInformePublico === "function" && esPaginaInformePublico()) {
  renderInformePublico();
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
