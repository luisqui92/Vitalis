// Symphomed Odonto — Vista 3D del odontograma (Three.js). Se carga solo
// cuando el odontólogo elige "Vista 3D" (import dinámico desde
// odontograma.js), así el resto de la app nunca paga el costo de estas
// librerías. Modelo: public/models/dentadura.glb — 32 piezas permanentes
// como objetos separados (con licencia de uso comercial, TurboSquid
// Royalty Free), ya posicionadas en arcada real.
import * as THREE from "/vendor/three/three.module.min.js";
import { GLTFLoader } from "/vendor/three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "/vendor/three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "/vendor/three/addons/controls/OrbitControls.js";

// Nombre del objeto 3D -> número FDI (ver services/... del lado servidor
// para la misma numeración en la vista 2D).
const NOMBRE_A_FDI = {
  Incisor_upper_right1: 11, Incisor_upper_right_2: 12, Canine_upper_right: 13,
  Premolar_Upper_right_1: 14, Premolar_upper_right_2: 15, Molar_upper_right_1: 16,
  Molar_upper_right_2: 17, Molar_upper_right_3: 18,
  Incisor_upper_left_1: 21, Incisor_upper_left2: 22, Canine_upper_left: 23,
  Premolar_upper_left_1: 24, Premolar_upper_left_2: 25, Molar_upper_left_1: 26,
  Molar_upper_left_2: 27, Molar_upper_left_3: 28,
  Incisor_lower_left_1: 31, Incisor_lower_left_2: 32, Canine_lower_left: 33,
  Premolar_lower_left_1: 34, Premolar_lower_left_2: 35, Molar_lower_left_1: 36,
  Molar_lower_left_2: 37, Molar_lower_left_3: 38,
  Incisor_lower_right1: 41, Incisor_lower_right_2: 42, Canine_lower_right: 43,
  Premolar_lower_right_1: 44, Premolar_lower_right_2: 45, Molar_lower_right_1: 46,
  Molar_lower_right_2: 47, Molar_lower_right_3: 48,
};

let dracoLoader = null;
function obtenerDracoLoader() {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/vendor/three/addons/libs/draco/");
  }
  return dracoLoader;
}

// Monta la vista 3D dentro de `contenedor`. `piezasPorNumero` = { [fdi]: {estado,...} }.
// `onClickPieza(numeroFdi)` se llama cuando el odontólogo toca un diente.
// Devuelve una función `destruir()` para liberar WebGL al salir de la pestaña.
export function montarOdontograma3D(contenedor, piezasPorNumero, coloresPorEstado, onClickPieza) {
  const ancho = contenedor.clientWidth || 360;
  const alto = Math.round(ancho * 0.7);

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(45, ancho / alto, 0.01, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(ancho, alto);
  contenedor.innerHTML = "";
  contenedor.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dl1 = new THREE.DirectionalLight(0xffffff, 1.1); dl1.position.set(5, 10, 7); scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.4); dl2.position.set(-5, -3, -5); scene.add(dl2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 30;

  const loader = new GLTFLoader();
  loader.setDRACOLoader(obtenerDracoLoader());

  const meshesPorFdi = {};
  let vivo = true;
  let raf = null;
  let meshSeleccionado = null;

  function pintarColores() {
    for (const [fdi, mesh] of Object.entries(meshesPorFdi)) {
      const pieza = piezasPorNumero[fdi];
      const color = coloresPorEstado[pieza?.estado] || coloresPorEstado.sano;
      mesh.material.color.set(color);
    }
  }

  // La pieza tocada "sobresale" (se agranda un poco) y brilla, para que se
  // note cuál es sin tener que buscarla por color en medio de las demás.
  function seleccionarPieza(fdi) {
    if (meshSeleccionado) {
      meshSeleccionado.scale.set(1, 1, 1);
      meshSeleccionado.material.emissive.set(0x000000);
    }
    const mesh = meshesPorFdi[fdi];
    if (mesh) {
      mesh.scale.set(1.18, 1.18, 1.18);
      mesh.material.emissive.set(0x3b82f6);
      mesh.material.emissiveIntensity = 0.5;
      meshSeleccionado = mesh;
    }
    if (onClickPieza) onClickPieza(fdi);
  }

  loader.load("/models/dentadura.glb", (gltf) => {
    if (!vivo) return;
    const modelo = gltf.scene;
    modelo.traverse(obj => {
      if (obj.isMesh) {
        const fdi = NOMBRE_A_FDI[obj.name];
        if (!fdi) return;
        obj.material = new THREE.MeshStandardMaterial({ roughness: 0.45 });
        obj.userData.fdi = fdi;
        meshesPorFdi[fdi] = obj;
      }
    });
    pintarColores();
    scene.add(modelo);

    const box = new THREE.Box3().setFromObject(modelo);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelo.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(0, maxDim * 0.7, maxDim * 1.3);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();

    animar();
  }, undefined, () => {
    contenedor.innerHTML = `<div class="error">No se pudo cargar el modelo 3D.</div>`;
  });

  const raycaster = new THREE.Raycaster();
  renderer.domElement.addEventListener("click", (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(Object.values(meshesPorFdi), false);
    if (hits.length) seleccionarPieza(hits[0].object.userData.fdi);
  });

  function animar() {
    if (!vivo) return;
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animar);
  }

  function actualizarPiezas(nuevasPiezasPorNumero) {
    Object.assign(piezasPorNumero, nuevasPiezasPorNumero);
    pintarColores();
  }

  function destruir() {
    vivo = false;
    if (raf) cancelAnimationFrame(raf);
    controls.dispose();
    renderer.dispose();
  }

  return { destruir, actualizarPiezas };
}
