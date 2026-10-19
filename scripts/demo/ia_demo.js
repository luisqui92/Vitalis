// Symphomed — La IA de mentira de los videos para estudiantes
// (scripts/demo/videos_estudiantes.js).
//
// Se carga antes que el servidor (NODE_OPTIONS=--require) y hace algo SOLO con
// SYMPHOMED_DEMO=1. Contesta lo que contestarían OpenAI y AssemblyAI con lo
// que está escrito en contenido.js, y no deja salir ningún pedido a internet:
// en la demo no hay claves de verdad ni pacientes reales.
//
// Qué consulta «se grabó» (la de medicina o la de enfermería) lo dice el
// archivo de SYMPHOMED_DEMO_DIALOGO: «med» o «enf». Lo escribe la demo antes
// de cada grabación.
if (process.env.SYMPHOMED_DEMO === "1") {
  const fs = require("fs");
  const C = require("./contenido");
  const axios = require(require.resolve("axios", { paths: [process.cwd()] }));
  const original = { post: axios.post.bind(axios), get: axios.get.bind(axios) };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  const dialogoActivo = () => {
    try { return fs.readFileSync(process.env.SYMPHOMED_DEMO_DIALOGO, "utf8").trim() === "enf" ? C.DIALOGO_ENF : C.DIALOGO_MED; }
    catch { return C.DIALOGO_MED; }
  };
  const respuesta = (data) => ({ status: 200, statusText: "OK", headers: {}, config: {}, data });
  const json = (obj) => respuesta({ choices: [{ message: { role: "assistant", content: JSON.stringify(obj) } }] });
  const texto = (t) => respuesta({ choices: [{ message: { role: "assistant", content: t } }] });

  // Lo que viene después de un rótulo del pedido («LO QUE SE HABLÓ…:»).
  const despuesDe = (s, rotulo) => { const i = s.indexOf(rotulo); return i < 0 ? s : s.slice(i + rotulo.length); };
  const guionDe = (sistema) => {
    try { return JSON.parse(despuesDe(sistema, "GUION (secreto):\n").trim()); } catch { return {}; }
  };
  const signos = (sv = {}) => Object.entries(sv).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ");
  const contestar = (pares, pregunta, porDefecto) => (pares.find(([re]) => re.test(pregunta)) || [null, porDefecto])[1];

  // ─── OpenAI ────────────────────────────────────────────────────────────
  function openai(cuerpo) {
    const mensajes = cuerpo?.messages || [];
    const sistema = String(mensajes.find((m) => m.role === "system")?.content || "");
    const ultimo = String([...mensajes].reverse().find((m) => m.role === "user")?.content || "");

    // La nota (el borrador en vivo, la de la grabación y la de la verificación).
    if (/asistente de enfermería\. A partir de la transcripción/.test(sistema)) return json(C.notaEnf(ultimo));
    if (/asistente clínico\. A partir de la transcripción/.test(sistema)) return json(C.notaMed(ultimo));

    // El tutor: lo que falta preguntar, y el razonamiento al terminar.
    const loHablado = despuesDe(ultimo, "LO QUE SE HABLÓ HASTA AHORA:");
    if (/tutor de enfermería que acompaña/.test(sistema)) return json(C.tutorEnf(loHablado));
    if (/tutor clínico que acompaña/.test(sistema)) return json(C.tutorMed(loHablado));
    if (/Sos un tutor de enfermería\. Un estudiante/.test(sistema)) {
      return json(C.razonamientoEnf((ultimo.match(/Diagnóstico de enfermería prioritario: (.*)/) || [])[1]));
    }
    if (/Sos un tutor clínico\. Un estudiante/.test(sistema)) return json(C.razonamientoMed((ultimo.match(/Diagnóstico principal: (.*)/) || [])[1]));

    // El paciente virtual: lo que contesta, lo que se encuentra y la evaluación.
    if (/práctica de valoración de enfermería/.test(sistema)) {
      return texto(contestar(C.RESPUESTAS_ENF, ultimo, "Eso no lo sé, señorita. Lo que más me molesta es que me cuesta respirar."));
    }
    if (/práctica de entrevista clínica/.test(sistema)) {
      return texto(contestar(C.RESPUESTAS_MED, ultimo, "Eso no lo noté, doctora. Lo que más me molesta es el dolor."));
    }
    if (/Vos sos la práctica, no el paciente/.test(sistema)) {
      const g = guionDe(sistema);
      const examina = /^El estudiante examina:/.test(ultimo);
      const pedido = ultimo.replace(/^El estudiante (examina|pide):\s*/, "");
      const hallado = /signos vitales/i.test(pedido) ? signos(g.signosVitales)
        : examina ? C.delGuion(g.examenFisico || [], pedido, "Sin particularidades.")
          : C.delGuion(g.estudios || [], pedido, "Dentro de los valores normales.");
      return json({ hallazgo: hallado, resultado: hallado });
    }
    if (/docente de enfermería que evalúa/.test(sistema)) return json(C.EVALUACION_ENF);
    if (/docente que evalúa la práctica/.test(sistema)) return json(C.EVALUACION_MED);

    // Armar un caso o resolverlo a ciegas: en la demo el banco ya tiene los
    // suyos, pero si se pidiera uno, sale el mismo.
    if (/arma casos para que estudiantes/.test(sistema)) return json(/enfermería/.test(sistema) ? C.CASO_ENF : C.CASO_MED);
    if (/Elegí el diagnóstico/.test(sistema)) {
      const opciones = despuesDe(ultimo, "OPCIONES:\n").split("\n").map((l) => l.replace(/^\d+\.\s*/, "").trim());
      return json({ opcion: Math.max(0, opciones.findIndex((o) => o === C.CASO_MED.diagnostico || o === C.CASO_ENF.diagnostico)) });
    }
    // Lo demás (no debería llegar nada): una respuesta vacía, que no rompe.
    return cuerpo?.response_format ? json({}) : texto("");
  }

  // ─── AssemblyAI: subir, pedir y traer la transcripción ─────────────────
  function assemblyai(metodo, url) {
    if (metodo === "post" && /\/v2\/upload$/.test(url)) return respuesta({ upload_url: "https://cdn.assemblyai.invalid/demo" });
    if (metodo === "post" && /\/v2\/transcript$/.test(url)) return respuesta({ id: `demo-${Date.now()}`, status: "queued" });
    if (metodo === "get" && /\/v2\/transcript\//.test(url)) {
      const turnos = dialogoActivo();
      let ms = 0;
      const utterances = turnos.map((t, i) => {
        const inicio = ms; ms += 1000 + t.split(/\s+/).length * 350;
        return { speaker: i % 2 ? "B" : "A", text: t, start: inicio, end: ms };
      });
      return respuesta({ status: "completed", text: turnos.join(" "), utterances, audio_duration: Math.round(ms / 1000) });
    }
    return null;
  }

  const sinRed = (url) => Promise.reject(Object.assign(new Error(`demo: sin salida a internet (${url})`), { code: "DEMO_SIN_RED" }));
  const local = (url) => /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(String(url));

  axios.post = async (url, cuerpo, opciones) => {
    if (/api\.openai\.com/.test(url)) { await esperar(700); return openai(cuerpo); }
    if (/api\.assemblyai\.com/.test(url)) { await esperar(400); const r = assemblyai("post", url); if (r) return r; }
    return local(url) ? original.post(url, cuerpo, opciones) : sinRed(url);
  };
  axios.get = async (url, opciones) => {
    if (/api\.assemblyai\.com/.test(url)) { await esperar(1500); const r = assemblyai("get", url); if (r) return r; }
    return local(url) ? original.get(url, opciones) : sinRed(url);
  };
  console.log("[DEMO] IA de mentira prendida: OpenAI y AssemblyAI contestan desde scripts/demo/contenido.js");
}
