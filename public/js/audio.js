// Symphomed — grabación de audio: onda de voz en vivo, subida de consultas, y
// vista previa de transcripción en vivo (WebSocket a AssemblyAI). Lo usan
// tanto la grabación local (consultas.js) como el celular vinculado
// (vinculacion.js).

// Hace "latir" el logo de Symphomed (círculo con anillos alrededor) en
// tiempo real según el volumen que capta el micrófono — reemplaza el
// barrido de barras genérico por algo que se sienta parte de la marca:
// cada vez que detecta voz, el logo pulsa más fuerte y los anillos se
// expanden, como un pulso cardíaco. Se usa tanto grabando local (compu con
// micrófono) como en el celular vinculado como micrófono remoto.
function crearIndicadorAudio(orbEl) {
  let audioCtx = null, analyser = null, dataArray = null, animId = null, nivelSuavizado = 0;

  function dibujar() {
    animId = requestAnimationFrame(dibujar);
    analyser.getByteTimeDomainData(dataArray);
    let sumaCuadrados = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128;
      sumaCuadrados += v * v;
    }
    const rms = Math.sqrt(sumaCuadrados / dataArray.length);
    // El ruido de fondo también tiene algo de RMS; restamos un piso para
    // que un ambiente en silencio no haga "latir" el logo todo el tiempo.
    const nivelCrudo = Math.min(1, Math.max(0, (rms - 0.02) * 6));
    nivelSuavizado += (nivelCrudo - nivelSuavizado) * 0.25;
    orbEl.style.setProperty("--nivel", nivelSuavizado.toFixed(3));
  }

  return {
    iniciar(stream) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.fftSize);
      dibujar();
    },
    detener() {
      if (animId) cancelAnimationFrame(animId);
      if (audioCtx) audioCtx.close();
      audioCtx = null; analyser = null;
      orbEl.style.setProperty("--nivel", 0);
    },
  };
}

// ═══ EL CUIDADOR DE LA GRABACIÓN ═══════════════════════════════════════════
//
// Caso real: una consulta de 32 minutos que llegó con el audio de los
// primeros minutos y el resto en silencio. El archivo duraba 32 minutos —el
// grabador del navegador sigue contando— pero el micrófono había dejado de
// captar: en el celular, cuando la pantalla se apaga o el médico cambia de
// app, el sistema le corta el micrófono a la página. Nadie se enteró hasta
// ver la transcripción, cuando la consulta ya no se podía repetir.
//
// Esto hace tres cosas mientras se graba:
//   · pide que la pantalla NO se apague (Screen Wake Lock), y lo vuelve a
//     pedir cuando la página vuelve a estar a la vista;
//   · si igual la página se ocultó o el sistema silenció el micrófono, lo
//     cuenta y avisa AL VOLVER cuánto tiempo pudo no grabarse;
//   · si no entra sonido por un rato largo, avisa en ese momento (y vibra):
//     un micrófono tapado o un celular en el bolsillo se arreglan en el
//     momento, no después.
//
// onAviso(tipo, datos): "oculto" {segundos} · "silencio" {segundos} ·
// "cortado" {} · "bateria" {nivel} · "normal" {} (volvió el sonido).
const SILENCIO_AVISO_SEGUNDOS = 90;

// ═══ LA BATERÍA EN UNA CONSULTA LARGA ═══════════════════════════════════════
// Una hora con la pantalla prendida, el micrófono y la vista previa en vivo
// se come una buena parte de la batería. Si el celular se apaga por batería
// a los 50 minutos, la grabación se corta ahí. Se avisa al empezar si está
// baja y sin cargar, y otra vez si baja mucho durante la consulta.
// (navigator.getBattery existe en Android; en iPhone no, y no se avisa.)
const BATERIA_AVISO_AL_EMPEZAR = 0.35;
const BATERIA_AVISO_DURANTE = 0.15;

// ═══ CALIDAD DE LA GRABACIÓN ════════════════════════════════════════════════
// Es voz, no música. Sin decirle nada, el navegador graba a 128 kbps o más:
// una consulta de 70 minutos pasaba de 67 MB, al borde del máximo que
// acepta el servidor, y tardaba mucho en subir por datos móviles. A 48 kbps
// la voz se entiende igual (el transcriptor trabaja a 16 kHz) y 70 minutos
// son unos 25 MB. Un navegador que no acepta el pedido graba como antes.
const BITS_POR_SEGUNDO_VOZ = 48000;
function crearGrabadora(stream, mimeType, bits = BITS_POR_SEGUNDO_VOZ) {
  const opciones = { audioBitsPerSecond: bits };
  if (mimeType) opciones.mimeType = mimeType;
  try {
    return new MediaRecorder(stream, opciones);
  } catch {
    return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  }
}

// El texto de cada aviso del cuidador, igual en las dos pantallas que graban
// (la consulta y el celular vinculado).
function textoAvisoGrabacion(tipo, datos) {
  if (tipo === "oculto") return t("consulta.avisoOculto", { min: Math.max(1, Math.round((datos?.segundos || 0) / 60)) });
  if (tipo === "silencio") return t("consulta.avisoSilencio");
  if (tipo === "bateria") return t("consulta.avisoBateria", { nivel: datos?.nivel ?? "" });
  return t("consulta.avisoCortado");
}

function crearGuardianGrabacion(stream, { onAviso = () => {} } = {}) {
  let wakeLock = null, activo = true;
  let ocultoDesde = null, ocultoMs = 0;
  let muteDesde = null, muteMs = 0;
  let silencioSeg = 0, silencioTotalSeg = 0, avisoSilencioDado = false;
  let audioCtx = null, analyser = null, datos = null, reloj = null;
  const pista = stream.getAudioTracks()[0];

  async function pedirPantalla() {
    if (!activo || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      // El sistema puede soltarlo solo aunque la página siga a la vista
      // (ahorro de batería, en algunos Android). Se vuelve a pedir: en una
      // consulta de una hora, que la pantalla se apague a la mitad es
      // justo lo que corta el micrófono.
      wakeLock.addEventListener("release", () => {
        if (activo && document.visibilityState === "visible") setTimeout(pedirPantalla, 3000);
      });
    } catch { /* el navegador no lo permite: quedan los avisos */ }
  }

  let bateria = null, avisoBateriaDado = false;
  function revisarBateria(alEmpezar) {
    if (!activo || !bateria || bateria.charging) { if (bateria?.charging) avisoBateriaDado = false; return; }
    const limite = alEmpezar ? BATERIA_AVISO_AL_EMPEZAR : BATERIA_AVISO_DURANTE;
    if (bateria.level <= limite && !avisoBateriaDado) {
      avisoBateriaDado = true;
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ }
      onAviso("bateria", { nivel: Math.round(bateria.level * 100) });
    }
  }
  const alCambiarBateria = () => revisarBateria(false);
  try {
    navigator.getBattery?.().then((b) => {
      if (!activo) return;
      bateria = b;
      revisarBateria(true);
      b.addEventListener("levelchange", alCambiarBateria);
      b.addEventListener("chargingchange", alCambiarBateria);
    }).catch(() => {});
  } catch { /* sin información de batería */ }

  function alCambiarVisibilidad() {
    if (!activo) return;
    if (document.visibilityState === "hidden") {
      ocultoDesde = Date.now();
    } else {
      if (ocultoDesde) {
        const seg = Math.round((Date.now() - ocultoDesde) / 1000);
        ocultoMs += Date.now() - ocultoDesde;
        ocultoDesde = null;
        // Unos segundos (mirar una notificación) no cortan nada que importe.
        if (seg >= 10) onAviso("oculto", { segundos: seg });
      }
      pedirPantalla();
    }
  }

  function alSilenciar() { if (activo && !muteDesde) muteDesde = Date.now(); }
  function alReactivar() {
    if (!muteDesde) return;
    muteMs += Date.now() - muteDesde;
    const seg = Math.round((Date.now() - muteDesde) / 1000);
    muteDesde = null;
    if (seg >= 10) onAviso("oculto", { segundos: seg });
  }
  function alTerminarPista() { if (activo) onAviso("cortado", {}); }

  // El nivel se mide cada segundo con su propio analizador (el del logo
  // anima con requestAnimationFrame, que el navegador frena en segundo plano).
  function medir() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(datos);
    let suma = 0;
    for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; suma += v * v; }
    const rms = Math.sqrt(suma / datos.length);
    if (rms < 0.01) {
      silencioSeg++;
      silencioTotalSeg++;
      if (silencioSeg >= SILENCIO_AVISO_SEGUNDOS && !avisoSilencioDado) {
        avisoSilencioDado = true;
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ }
        onAviso("silencio", { segundos: silencioSeg });
      }
    } else {
      if (avisoSilencioDado) onAviso("normal", {});
      silencioSeg = 0;
      avisoSilencioDado = false;
    }
  }

  document.addEventListener("visibilitychange", alCambiarVisibilidad);
  if (pista) {
    pista.addEventListener("mute", alSilenciar);
    pista.addEventListener("unmute", alReactivar);
    pista.addEventListener("ended", alTerminarPista);
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    datos = new Uint8Array(analyser.fftSize);
    reloj = setInterval(medir, 1000);
  } catch { /* sin medición de nivel: quedan los otros avisos */ }
  pedirPantalla();

  return {
    // Lo que pasó durante la grabación, para decirlo ANTES de subirla.
    resumen() {
      const ahora = Date.now();
      const oculto = ocultoMs + (ocultoDesde ? ahora - ocultoDesde : 0);
      const mute = muteMs + (muteDesde ? ahora - muteDesde : 0);
      return {
        segundosSinMicrofono: Math.round(Math.max(oculto, mute) / 1000),
        segundosEnSilencio: silencioTotalSeg,
      };
    },
    detener() {
      activo = false;
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      if (pista) {
        pista.removeEventListener("mute", alSilenciar);
        pista.removeEventListener("unmute", alReactivar);
        pista.removeEventListener("ended", alTerminarPista);
      }
      if (reloj) clearInterval(reloj);
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = null; analyser = null;
      if (bateria) {
        bateria.removeEventListener("levelchange", alCambiarBateria);
        bateria.removeEventListener("chargingchange", alCambiarBateria);
      }
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
    },
  };
}

// ═══ UNA GRABACIÓN NO SE PIERDE POR SALIR DE LA PANTALLA ════════════════════
//
// Mientras hay una grabación en curso —o una ya terminada que todavía no se
// subió— salir de la pantalla la tira: vive solo en la memoria de esta
// página. Pasaba sin aviso por cuatro caminos: el botón «atrás» del celular,
// tocar otra sección de Symphomed, cerrar la pestaña, y el repintado
// automático cuando entra algo nuevo (un turno por WhatsApp) — ese último sin
// que el médico tocara nada.
//
// Lo que NO se puede frenar es el botón de cambiar de app o el de inicio: eso
// es del sistema, y ninguna página se entera ANTES. Para eso están la
// notificación (avisarSiSeOculta) y el respaldo en el teléfono (abajo).
//
// GRABACION_EN_CURSO: null, o { descartar() } — lo que hay que hacer si el
// médico confirma que quiere salir igual.
let GRABACION_EN_CURSO = null;

function hayGrabacionEnCurso() {
  return Boolean(GRABACION_EN_CURSO);
}

function marcarGrabacionEnCurso(descartar) {
  // La dirección de ese momento: si el médico toca «atrás» y se arrepiente,
  // se la vuelve a poner para que la barra no quede mintiendo.
  GRABACION_EN_CURSO = { descartar: descartar || (() => {}), url: location.pathname };
}

function direccionDeLaGrabacion() {
  return GRABACION_EN_CURSO ? GRABACION_EN_CURSO.url : null;
}

function liberarGrabacion() {
  GRABACION_EN_CURSO = null;
}

// true = se puede salir. Si hay grabación, pregunta; si confirma, la descarta
// (para no dejar el micrófono prendido sin pantalla que lo controle).
function confirmarSalidaDeGrabacion() {
  if (!GRABACION_EN_CURSO) return true;
  if (!confirm(t("consulta.confirmarSalir"))) return false;
  try { GRABACION_EN_CURSO.descartar(); } catch { /* ya estaba detenida */ }
  GRABACION_EN_CURSO = null;
  return true;
}

// Cerrar la pestaña o recargar: el navegador muestra su propio "¿Salir del
// sitio?" (no deja personalizar el texto, por seguridad).
window.addEventListener("beforeunload", (e) => {
  if (!GRABACION_EN_CURSO) return;
  e.preventDefault();
  e.returnValue = "";
});

// Si cambia de app en medio de la grabación, el celular le corta el micrófono
// a la página. No se puede impedir, pero sí avisar EN EL MOMENTO, con una
// notificación del sistema que lo trae de vuelta. Necesita el permiso de
// notificaciones: se pide al empezar a grabar si todavía no se decidió.
async function pedirPermisoAvisoGrabacion() {
  try {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  } catch { /* sin notificaciones: quedan los avisos en pantalla */ }
}

async function avisarSiSeOculta() {
  if (!GRABACION_EN_CURSO || document.visibilityState !== "hidden") return;
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.showNotification(t("consulta.notifTitulo"), {
      body: t("consulta.notifCuerpo"),
      icon: "/img/simbolo-192.png",
      tag: "grabacion-en-curso",
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 150, 300],
      data: { url: location.pathname },
    });
  } catch { /* si no se puede notificar, queda el aviso al volver */ }
}
document.addEventListener("visibilitychange", avisarSiSeOculta);

// ═══ EL RESPALDO EN EL TELÉFONO ═════════════════════════════════════════════
//
// Al cambiar de app, Android muchas veces no solo le corta el micrófono a la
// página: la CIERRA para liberar memoria. Con la grabación entera en memoria,
// se perdía todo, también lo que ya estaba bien grabado.
//
// Ahora la grabación se entrega de a pedazos (cada 5 s) y cada pedazo se
// guarda en el teléfono (IndexedDB). Si la página se cierra, al volver a
// abrir la consulta de ese paciente aparece «Hay una grabación sin subir» con
// Subir y Descartar. Se borra sola al subirse. Todo con try/catch: sin
// espacio o en modo privado, la grabación sigue igual que antes, solo sin
// respaldo.
const RESPALDO_DB = "symphomed_grabaciones";
const RESPALDO_DIAS = 7;

function abrirRespaldo() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("sin IndexedDB"));
    const pedido = indexedDB.open(RESPALDO_DB, 1);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains("grabaciones")) db.createObjectStore("grabaciones", { keyPath: "id" });
      if (!db.objectStoreNames.contains("trozos")) {
        db.createObjectStore("trozos", { autoIncrement: true }).createIndex("grabacion", "grabacionId");
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

function enTransaccion(db, tiendas, modo, trabajo) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tiendas, modo);
    let resultado;
    Promise.resolve(trabajo(tx)).then(r => { resultado = r; });
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const respaldoGrabacion = {
  async iniciar(meta) {
    try {
      const db = await abrirRespaldo();
      const id = `g${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      await enTransaccion(db, ["grabaciones"], "readwrite", tx =>
        tx.objectStore("grabaciones").put({ id, ...meta, inicio: Date.now(), actualizada: Date.now(), bytes: 0 }));
      db.close();
      return id;
    } catch { return null; }
  },
  async agregar(id, trozo) {
    if (!id || !trozo || !trozo.size) return;
    try {
      const db = await abrirRespaldo();
      await enTransaccion(db, ["grabaciones", "trozos"], "readwrite", tx => {
        tx.objectStore("trozos").add({ grabacionId: id, trozo });
        const g = tx.objectStore("grabaciones");
        const pedido = g.get(id);
        pedido.onsuccess = () => {
          if (pedido.result) g.put({ ...pedido.result, actualizada: Date.now(), bytes: (pedido.result.bytes || 0) + trozo.size });
        };
      });
      db.close();
    } catch { /* sin espacio: la grabación sigue en memoria igual */ }
  },
  async pendientes(filtro = {}) {
    try {
      const db = await abrirRespaldo();
      const todas = await enTransaccion(db, ["grabaciones"], "readonly", tx => new Promise(res => {
        const pedido = tx.objectStore("grabaciones").getAll();
        pedido.onsuccess = () => res(pedido.result || []);
      }));
      db.close();
      const limite = Date.now() - RESPALDO_DIAS * 86400000;
      for (const g of todas.filter(g => g.actualizada < limite)) await this.borrar(g.id);
      return todas.filter(g => g.actualizada >= limite && g.bytes > 0 &&
        (!filtro.pacienteId || g.pacienteId === filtro.pacienteId) && g.id !== filtro.excepto)
        .sort((a, b) => b.inicio - a.inicio);
    } catch { return []; }
  },
  async armar(id) {
    const db = await abrirRespaldo();
    const trozos = await enTransaccion(db, ["trozos"], "readonly", tx => new Promise(res => {
      const pedido = tx.objectStore("trozos").index("grabacion").getAll(id);
      pedido.onsuccess = () => res((pedido.result || []).map(r => r.trozo));
    }));
    db.close();
    return trozos;
  },
  async borrar(id) {
    if (!id) return;
    try {
      const db = await abrirRespaldo();
      await enTransaccion(db, ["grabaciones", "trozos"], "readwrite", tx => {
        tx.objectStore("grabaciones").delete(id);
        const indice = tx.objectStore("trozos").index("grabacion");
        const cursor = indice.openKeyCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) { tx.objectStore("trozos").delete(c.primaryKey); c.continue(); }
        };
      });
      db.close();
    } catch { /* se borra sola a los 7 días */ }
  },
};

// La tarjeta «Hay una grabación sin subir»: la usan la pantalla de nueva
// consulta y la del celular vinculado. onSubir(blob, mimeType, grabacion)
// hace la subida; si sale bien, se borra el respaldo.
async function ofrecerGrabacionesPendientes(contenedor, { pacienteId, excepto, onSubir }) {
  if (!contenedor) return;
  const lista = await respaldoGrabacion.pendientes({ pacienteId, excepto });
  if (!lista.length) { contenedor.innerHTML = ""; return; }
  const minutos = (g) => Math.max(1, Math.round((g.actualizada - g.inicio) / 60000));
  contenedor.innerHTML = lista.map(g => `
    <div class="error" style="margin-top:10px" data-grab="${g.id}">
      ⚠️ ${t("consulta.pendienteTexto", { paciente: esc(g.pacienteNombre || ""), min: minutos(g), fecha: fechaHora(g.inicio) })}
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">
        <button class="link" data-grab-subir="${g.id}" style="margin:0;width:auto">⬆️ ${t("consulta.pendienteSubir")}</button>
        <button class="link" data-grab-descartar="${g.id}" style="margin:0;width:auto;color:var(--danger)">${t("consulta.pendienteDescartar")}</button>
      </div>
    </div>`).join("");
  contenedor.querySelectorAll("[data-grab-subir]").forEach(btn => {
    btn.onclick = async () => {
      const g = lista.find(x => x.id === btn.dataset.grabSubir);
      btn.disabled = true;
      btn.textContent = t("consulta.subiendo");
      try {
        const trozos = await respaldoGrabacion.armar(g.id);
        const blob = new Blob(trozos, { type: g.mimeType || "audio/webm" });
        await onSubir(blob, g.mimeType || "audio/webm", g);
        await respaldoGrabacion.borrar(g.id);
        // Si quien la subió se quedó en la misma pantalla, se actualiza la lista.
        ofrecerGrabacionesPendientes(contenedor, { pacienteId, excepto, onSubir });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = `⬆️ ${t("consulta.pendienteSubir")}`;
        alert(e.error || t("consulta.errSubir"));
      }
    };
  });
  contenedor.querySelectorAll("[data-grab-descartar]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("consulta.pendienteConfirmarDescartar"))) return;
      await respaldoGrabacion.borrar(btn.dataset.grabDescartar);
      btn.closest("[data-grab]").remove();
    };
  });
}

// Sube el audio grabado/subido y crea la consulta. Se usa tanto grabando
// local como desde el celular vinculado como micrófono remoto.
// teleconsultaId, cuando viene, dice dos cosas: que esta consulta salió de
// una videollamada (y por lo tanto el audio tiene al médico y al paciente en
// canales separados), y a cuál engancharla.
async function subirConsulta(pacienteId, blob, mimeType, { teleconsultaId } = {}) {
  let url = "/medico/consultas?pacienteId=" + encodeURIComponent(pacienteId);
  if (teleconsultaId) url += "&teleconsultaId=" + encodeURIComponent(teleconsultaId);
  return api(url, {
    method: "POST",
    headers: { "Content-Type": mimeType || "audio/webm" },
    body: blob,
  });
}

// Vista previa en vivo: mientras se graba (para el archivo real, que es lo
// que se guarda), en paralelo se manda el audio en crudo (PCM 16kHz) al
// WebSocket de AssemblyAI para mostrar el texto apareciendo mientras se
// habla. Si esto falla por lo que sea, no afecta la grabación real — es
// solo decorativo, la transcripción de verdad sigue viniendo del archivo
// subido al terminar.
function crearTranscriptorEnVivo(onTexto) {
  let ws = null, audioCtx = null, workletNode = null, source = null, detenidoManualmente = false;

  const CODIGO_WORKLET = `
    class PCMWorklet extends AudioWorkletProcessor {
      constructor() {
        super();
        this.ratio = sampleRate / 16000;
        // process() se llama cada ~128 muestras (unos 2-3ms) — mandar un
        // mensaje por cada llamada da chunks de milisegundos, y AssemblyAI
        // rechaza (cierra con código 3007) cualquier chunk de menos de
        // 50ms. Por eso se acumula hasta juntar ~100ms (1600 muestras a
        // 16kHz) antes de mandar cada mensaje.
        this.pendientes = [];
        this.tamanoChunk = 1600;
      }
      process(inputs) {
        const input = inputs[0][0];
        if (input && input.length) {
          const outLen = Math.max(1, Math.floor(input.length / this.ratio));
          for (let i = 0; i < outLen; i++) {
            const srcIdx = i * this.ratio;
            const i0 = Math.floor(srcIdx);
            const i1 = Math.min(i0 + 1, input.length - 1);
            const frac = srcIdx - i0;
            const sample = input[i0] * (1 - frac) + input[i1] * frac;
            const s = Math.max(-1, Math.min(1, sample));
            this.pendientes.push(s < 0 ? s * 32768 : s * 32767);
          }
          while (this.pendientes.length >= this.tamanoChunk) {
            const listo = this.pendientes.splice(0, this.tamanoChunk);
            const buf = new Int16Array(listo);
            this.port.postMessage(buf.buffer, [buf.buffer]);
          }
        }
        return true;
      }
    }
    registerProcessor("pcm-worklet", PCMWorklet);
  `;

  async function iniciar(stream) {
    detenidoManualmente = false;
    try {
      const { token, keyterms, idioma, medicalMode } = await api("/medico/transcripcion-token");
      // Mismo criterio que la transcripción final (services/assemblyai.js):
      // Medical Mode + vocabulario de la especialidad, para que lo que se ve
      // mientras se habla se parezca a lo que después queda guardado.
      // Los parámetros de lista (language_codes, keyterms_prompt) van como
      // array JSON codificado en la URL — probado contra la API: mandarlos
      // como parámetros repetidos devuelve "Invalid JSON array".
      //
      // El idioma lo manda el servidor, sacado de la cuenta del médico, y no
      // se toma de MEDICO_IDIOMA: si el navegador lo eligiera por su cuenta,
      // la vista previa y la transcripción final podrían quedar en idiomas
      // distintos para la misma consulta. Si el servidor no lo mandara —una
      // versión vieja—, español, que es como estaba antes.
      const lang = idioma || "es";
      const params = new URLSearchParams({
        sample_rate: "16000",
        encoding: "pcm_s16le",
        speech_model: "universal-3-5-pro",
        mode: "balanced",
        language_codes: JSON.stringify([lang]),
        token,
      });
      // Medical Mode no existe para portugués: la API ignora el parámetro.
      // Quién lo tiene y quién no lo decide el servidor y viaja en la
      // respuesta — tener acá una copia de la lista de idiomas es tener dos
      // fuentes de verdad que algún día no van a coincidir.
      if (medicalMode) params.set("domain", "medical-v1");
      if (Array.isArray(keyterms) && keyterms.length) {
        params.set("keyterms_prompt", JSON.stringify(keyterms));
      }
      ws = new WebSocket("wss://streaming.assemblyai.com/v3/ws?" + params.toString());

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const blobUrl = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: "application/javascript" }));
      await audioCtx.audioWorklet.addModule(blobUrl);
      source = audioCtx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioCtx, "pcm-worklet");
      source.connect(workletNode);

      let textoAcumulado = "";
      workletNode.port.onmessage = (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Antes de cerrar el socket, AssemblyAI manda el motivo real en un
          // mensaje aparte (type:"Error") — se ignoraba porque no tiene
          // "transcript", y por eso el cierre (código 3007 y similares)
          // quedaba sin explicación visible.
          if (msg.error || msg.type === "Error") {
            onTexto("⚠️ Vista previa en vivo: " + (msg.error || msg.message || JSON.stringify(msg)));
            return;
          }
          if (!msg.transcript) return;
          if (msg.end_of_turn) {
            textoAcumulado += msg.transcript + " ";
            onTexto(textoAcumulado);
          } else {
            onTexto(textoAcumulado + msg.transcript);
          }
        } catch {}
      };
      // No afecta la grabación real, pero antes fallaba en silencio total —
      // ahora se avisa en el propio texto en vivo para poder diagnosticar
      // sin herramientas de desarrollador (el médico graba desde el celular).
      ws.onerror = () => {
        onTexto("⚠️ Vista previa en vivo no disponible (error de conexión). La grabación real no se ve afectada.");
      };
      ws.onclose = (ev) => {
        if (detenidoManualmente) return;
        if (ev.code !== 1000) {
          onTexto(`⚠️ Vista previa en vivo se cortó (código ${ev.code}${ev.reason ? ": " + ev.reason : ""}). La grabación real no se ve afectada.`);
        }
      };
    } catch (e) {
      onTexto("⚠️ Vista previa en vivo no disponible: " + e.message);
      console.warn("Transcripción en vivo no disponible:", e.message);
    }
  }

  function detener() {
    detenidoManualmente = true;
    if (workletNode) { try { workletNode.disconnect(); } catch {} }
    if (source) { try { source.disconnect(); } catch {} }
    if (audioCtx) { try { audioCtx.close(); } catch {} }
    // AssemblyAI factura la sesión hasta que se cierra: si solo se corta el
    // socket sin avisar, la da por viva y cobra hasta el tope de 3 horas.
    // Por eso primero se manda Terminate y recién después se cierra.
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {}
      try { ws.close(); } catch {}
    }
    ws = null; audioCtx = null; workletNode = null; source = null;
  }

  return { iniciar, detener };
}
