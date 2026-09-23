import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';

const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();
let isLightMode = false;
scene.background = new THREE.Color('#050505');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(6, 2, 8);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 15;
controls.minDistance = 2;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientLight);

// =======================
// AEROLAB TUBE STREAMLINES
// =======================
let windInstanced = null;
let isAeroLab = false;
let isThermal = false;
const windCount = 400; 

function createAeroLab() {
  const geometry = new THREE.BoxGeometry(0.02, 0.02, 1.5);
  const material = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
  
  windInstanced = new THREE.InstancedMesh(geometry, material, windCount);
  const dummy = new THREE.Object3D();
  const vels = new Float32Array(windCount);
  
  for (let i = 0; i < windCount; i++) {
    dummy.position.set((Math.random() - 0.5) * 4, Math.random() * 2.0 + 0.1, 10 + Math.random() * 10);
    dummy.updateMatrix();
    windInstanced.setMatrixAt(i, dummy.matrix);
    vels[i] = Math.random() * 0.2 + 0.8;
  }
  windInstanced.userData.velocities = vels;
  windInstanced.visible = false;
  scene.add(windInstanced);
}
createAeroLab();

// =======================
// THERMAL DRAG SHADER
// =======================
const thermalMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    void main() {
      float z = vNormal.z; 
      vec3 color = vec3(0.0, 1.0, 0.0);
      if (z > 0.0) {
        color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), z);
      } else {
        color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), -z);
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `
});

// =======================
// APP LOGIC
// =======================
let appState = {
  vehicles: [], brands: [], currentVehicle: null, currentModel: null, garage: [], mode: 'showroom'
};

const logoMap = {
  "Porsche": "https://cdn.simpleicons.org/porsche/white",
  "McLaren": "https://cdn.simpleicons.org/mclaren/white",
  "Ferrari": "https://cdn.simpleicons.org/ferrari/white",
  "Lamborghini": "https://cdn.simpleicons.org/lamborghini/white",
  "Audi": "https://cdn.simpleicons.org/audi/white",
  "Bugatti": "https://cdn.simpleicons.org/bugatti/white",
  "Nissan": "https://cdn.simpleicons.org/nissan/white",
  "BMW": "https://cdn.simpleicons.org/bmw/white",
  "Mercedes": "https://cdn.simpleicons.org/mercedes/white",
  "Aston Martin": "https://cdn.simpleicons.org/astonmartin/white",
  "Chevrolet": "https://cdn.simpleicons.org/chevrolet/white",
  "Toyota": "https://cdn.simpleicons.org/toyota/white"
};

// Fallback Image Loader (Replaces image with CSS box if all fail)
function loadFallbackImage(imgElement, urls, fallbackText) {
  if (!urls || urls.length === 0) return createFallbackDiv(imgElement, fallbackText);
  let index = 0;
  imgElement.onerror = function() {
    index++;
    if (index < urls.length) {
      imgElement.src = urls[index];
    } else {
      createFallbackDiv(imgElement, fallbackText);
    }
  };
  imgElement.src = urls[0];
}

function createFallbackDiv(imgElement, text) {
  const fallback = document.createElement('div');
  fallback.className = 'fallback-img';
  fallback.textContent = text + ' Image Unavailable';
  if(imgElement.parentNode) imgElement.parentNode.replaceChild(fallback, imgElement);
}

const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (u, i, t) => document.getElementById('progress-bar').style.width = (i / t * 100) + '%';
loadingManager.onLoad = () => setTimeout(() => document.getElementById('loading-screen').classList.add('hidden'), 500);
loadingManager.onError = () => { document.getElementById('loading-text').textContent = "Model Missing"; setTimeout(() => document.getElementById('loading-screen').classList.add('hidden'), 3000); };

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const gltfLoader = new GLTFLoader(loadingManager).setDRACOLoader(dracoLoader);

async function init() {
  const saved = localStorage.getItem('carAtlasGarage');
  if (saved) {
    appState.garage = JSON.parse(saved);
    document.getElementById('garage-count').textContent = `(${appState.garage.length})`;
  }
  const response = await fetch('/data/cars.json');
  const data = await response.json();
  appState.vehicles = data.vehicles;
  appState.brands = [...new Set(appState.vehicles.map(v => v.brand))];
  populateBrandGrid();
  setupNav();
}

function populateBrandGrid() {
  const grid = document.getElementById('brand-grid');
  grid.innerHTML = '';
  appState.brands.forEach(brand => {
    const card = document.createElement('div'); card.className = 'brand-card';
    let logoHTML = '';
    if (logoMap[brand]) {
      logoHTML = `<img src="${logoMap[brand]}" alt="${brand}" class="brand-logo" onerror="this.style.display='none'">`;
    }
    card.innerHTML = `${logoHTML} <h3>${brand}</h3>`;
    card.onclick = () => showVehicles(appState.vehicles.filter(v => v.brand === brand), `${brand} Models`);
    grid.appendChild(card);
  });
}

function showVehicles(vehicles, title) {
  removeCurrentCar(); // Ensure no car is hanging in the background
  document.getElementById('brand-overlay').classList.add('hidden');
  document.getElementById('garage-overlay').classList.add('hidden');
  document.getElementById('selection-overlay').classList.remove('hidden');
  document.getElementById('brand-title').textContent = title;
  
  const grid = document.getElementById('vehicle-grid');
  grid.innerHTML = '';
  if (vehicles.length === 0) {
    grid.innerHTML = '<p style="text-align:center; width:100%;">No cars found.</p>'; return;
  }
  vehicles.forEach(vehicle => {
    const card = document.createElement('div'); card.className = 'car-card';
    card.innerHTML = `
      <img src="" id="img-${vehicle.id}" alt="${vehicle.name}">
      <div class="card-info"><h3>${vehicle.name}</h3><p>${vehicle.specs.power}</p></div>
    `;
    card.onclick = () => loadVehicle(vehicle);
    grid.appendChild(card);
    setTimeout(() => loadFallbackImage(document.getElementById(`img-${vehicle.id}`), vehicle.thumbnails, vehicle.name), 0);
  });
}

function showGarage() {
  resetShowroom();
  removeCurrentCar();
  document.getElementById('brand-overlay').classList.add('hidden');
  document.getElementById('specs-sidebar').classList.add('hidden');
  document.getElementById('selection-overlay').classList.add('hidden');
  
  const savedCars = appState.vehicles.filter(v => appState.garage.includes(v.id));
  
  document.getElementById('garage-overlay').classList.remove('hidden');
  const grid = document.getElementById('garage-grid');
  grid.innerHTML = '';
  if (savedCars.length === 0) {
    grid.innerHTML = '<p style="text-align:center; width:100%;">Your garage is empty. Heart some cars to save them here!</p>';
    return;
  }
  savedCars.forEach(vehicle => {
    const card = document.createElement('div'); card.className = 'car-card';
    card.innerHTML = `
      <img src="" id="garage-img-${vehicle.id}" alt="${vehicle.name}">
      <div class="card-info"><h3>${vehicle.name}</h3><p>${vehicle.specs.power}</p></div>
    `;
    card.onclick = () => loadVehicle(vehicle);
    grid.appendChild(card);
    setTimeout(() => loadFallbackImage(document.getElementById(`garage-img-${vehicle.id}`), vehicle.thumbnails, vehicle.name), 0);
  });
}

function removeCurrentCar() {
  if (appState.currentModel) {
    scene.remove(appState.currentModel);
    appState.currentModel = null;
  }
  appState.currentVehicle = null;
}

function toggleHeart() {
  const v = appState.currentVehicle;
  if (!v) return;
  const idx = appState.garage.indexOf(v.id);
  if (idx > -1) {
    appState.garage.splice(idx, 1);
    document.getElementById('btn-heart').classList.remove('saved');
    document.getElementById('btn-heart').textContent = '🤍';
  } else {
    appState.garage.push(v.id);
    document.getElementById('btn-heart').classList.add('saved');
    document.getElementById('btn-heart').textContent = '❤️';
  }
  localStorage.setItem('carAtlasGarage', JSON.stringify(appState.garage));
  document.getElementById('garage-count').textContent = `(${appState.garage.length})`;
}

window.changeCarColor = function(hexColor) {
  if (!appState.currentModel || isThermal) return;
  appState.currentModel.traverse((c) => {
    if (c.userData.isCarPaint) gsap.to(c.material.color, { r: new THREE.Color(hexColor).r, g: new THREE.Color(hexColor).g, b: new THREE.Color(hexColor).b, duration: 0.5 });
  });
};

function activateAeroModeLogic() {
  isAeroLab = true; windInstanced.visible = true; controls.enabled = false; 
  document.getElementById('aero-tv-overlay').classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active')); 
  document.getElementById('btn-aero').classList.add('active');
  scene.background = new THREE.Color('#00030a');
  setAeroCamera('isometric');
}

function loadVehicle(vehicle) {
  resetShowroom();
  removeCurrentCar();
  document.getElementById('selection-overlay').classList.add('hidden');
  document.getElementById('garage-overlay').classList.add('hidden');
  document.getElementById('brand-overlay').classList.add('hidden');
  
  // Show sidebar only if not in Aero Mode intent
  if (appState.mode !== 'aero') {
    document.getElementById('specs-sidebar').classList.remove('hidden');
  }

  document.getElementById('current-car-name').textContent = vehicle.name;
  
  const heartBtn = document.getElementById('btn-heart');
  if (appState.garage.includes(vehicle.id)) { heartBtn.classList.add('saved'); heartBtn.textContent = '❤️'; }
  else { heartBtn.classList.remove('saved'); heartBtn.textContent = '🤍'; }
  heartBtn.onclick = toggleHeart;

  appState.currentVehicle = vehicle;
  
  let specsHTML = '';
  for (const [key, value] of Object.entries(vehicle.specs)) {
    specsHTML += `<div class="spec-row"><span class="spec-label">${key.replace('_', ' ').toUpperCase()}</span><span class="spec-value">${value}</span></div>`;
  }
  document.getElementById('specs-content').innerHTML = specsHTML;
  document.getElementById('interactions').classList.remove('hidden');

  const finalizeLoad = (model) => {
    appState.currentModel = model;
    scene.add(model);
    
    // If the user's intent was to load into Aero Lab, trigger it immediately
    if (appState.mode === 'aero') {
      activateAeroModeLogic();
    } else {
      gsap.from(camera.position, { duration: 2, x: 8, y: 3, z: 8, ease: 'power3.out' });
    }
  };

  if (vehicle.modelUrl) {
    if (vehicle.modelUrl.startsWith('primitive:')) {
      const type = vehicle.modelUrl.split(':')[1];
      let geo;
      if (type === 'box') geo = new THREE.BoxGeometry(2, 1.5, 4);
      else if (type === 'sphere') geo = new THREE.SphereGeometry(1.5, 64, 64);
      else if (type === 'cone') { geo = new THREE.ConeGeometry(1.5, 4, 64); geo.rotateX(Math.PI/2); }
      
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x999999, metalness: 0.5, roughness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 1.0;
      mesh.userData.isCarPaint = true;
      mesh.userData.originalMat = mat;
      
      const group = new THREE.Group();
      group.add(mesh);
      finalizeLoad(group);
      return;
    }

    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('loading-text').textContent = `Loading ${vehicle.name}...`;
    document.getElementById('progress-bar').style.width = '0%';
    
    gltfLoader.load(vehicle.modelUrl, (gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      gltf.scene.position.sub(center);
      gltf.scene.position.y += Math.abs(box.min.y); 
      gltf.scene.traverse((c) => {
        if (c.isMesh && c.material) {
          c.material.needsUpdate = true;
          if (c.name.toLowerCase().includes('body') || c.name.toLowerCase().includes('paint')) {
             c.userData.isCarPaint = true;
             c.userData.originalMat = new THREE.MeshPhysicalMaterial({ color: c.material.color, metalness: 0.8, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.05 });
             c.material = c.userData.originalMat;
          } else {
             c.userData.originalMat = c.material;
          }
        }
      });
      finalizeLoad(gltf.scene);
    });
  }
}

// TV Camera controls for Aero
window.setAeroCamera = function(pos) {
  if (pos === 'top') gsap.to(camera.position, { x: 0, y: 12, z: 0.1, duration: 1.5 });
  if (pos === 'bottom') gsap.to(camera.position, { x: 0, y: -2, z: 0.1, duration: 1.5 });
  if (pos === 'left') gsap.to(camera.position, { x: -10, y: 1, z: 0, duration: 1.5 });
  if (pos === 'right') gsap.to(camera.position, { x: 10, y: 1, z: 0, duration: 1.5 });
  if (pos === 'front') gsap.to(camera.position, { x: 0, y: 1.5, z: 12, duration: 1.5 });
  if (pos === 'back') gsap.to(camera.position, { x: 0, y: 1.5, z: -12, duration: 1.5 });
  if (pos === 'isometric') gsap.to(camera.position, { x: 8, y: 4, z: 8, duration: 1.5 });
};

function resetShowroom() {
  isAeroLab = false; isThermal = false;
  windInstanced.visible = false;
  controls.enabled = true; // Re-enable rotation
  document.getElementById('aero-tv-overlay').classList.add('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
  
  if (appState.currentModel) {
    appState.currentModel.traverse((c) => { if (c.isMesh && c.userData.originalMat) c.material = c.userData.originalMat; });
  }
}

function showBrandOverlayClean() {
  resetShowroom();
  removeCurrentCar(); // Fix: Clear 3D scene when on brand page
  document.getElementById('specs-sidebar').classList.add('hidden');
  document.getElementById('selection-overlay').classList.add('hidden');
  document.getElementById('garage-overlay').classList.add('hidden');
  document.getElementById('brand-overlay').classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(appState.mode === 'showroom' ? 'btn-showroom' : 'btn-aero').classList.add('active');
}

function setupNav() {
  document.getElementById('btn-change-car').onclick = showBrandOverlayClean;
  document.getElementById('btn-back-brands').onclick = showBrandOverlayClean;
  document.getElementById('btn-garage-back').onclick = showBrandOverlayClean;
  
  document.getElementById('btn-garage').onclick = (e) => {
    appState.mode = 'showroom';
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active')); 
    e.target.classList.add('active');
    showGarage();
  };
  
  document.getElementById('btn-showroom').onclick = (e) => { 
    appState.mode = 'showroom';
    if (appState.currentVehicle) {
      resetShowroom(); e.target.classList.add('active'); 
      document.getElementById('specs-sidebar').classList.remove('hidden');
      gsap.to(camera.position, { x: 6, y: 2, z: 8, duration: 1.5 }); 
    } else {
      showBrandOverlayClean();
    }
  };
  
  document.getElementById('btn-aero').onclick = (e) => {
    appState.mode = 'aero';
    if (appState.currentModel) {
       // If car is already loaded, jump straight into Aero
       activateAeroModeLogic();
       document.getElementById('specs-sidebar').classList.add('hidden');
    } else {
       // Show selection screen so user can pick a car for Aero
       showBrandOverlayClean();
    }
  };
  
  document.getElementById('btn-exit-aero').onclick = (e) => {
    appState.mode = 'showroom';
    resetShowroom();
    document.getElementById('btn-showroom').classList.add('active');
    document.getElementById('specs-sidebar').classList.remove('hidden');
    gsap.to(camera.position, { x: 6, y: 2, z: 8, duration: 1.5 });
  };
  
  document.getElementById('btn-thermal').onclick = (e) => {
    isThermal = !isThermal;
    if (appState.currentModel) {
      appState.currentModel.traverse((c) => {
        if (c.isMesh && c.userData.originalMat) {
           c.material = isThermal ? thermalMaterial : c.userData.originalMat;
        }
      });
    }
  };

  document.getElementById('btn-theme-toggle').onclick = () => {
    isLightMode = !isLightMode; document.body.classList.toggle('light-mode');
    if (!isAeroLab) scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
  };
}

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

const clock = new THREE.Clock();
const dummy = new THREE.Object3D();
function animate() {
  if (isAeroLab && windInstanced) {
    const spd = document.getElementById('wind-speed').value / 50;
    const vels = windInstanced.userData.velocities;
    for (let i = 0; i < windCount; i++) {
      windInstanced.getMatrixAt(i, dummy.matrix);
      dummy.position.setFromMatrixPosition(dummy.matrix);
      
      dummy.position.z -= vels[i] * spd;
      if (dummy.position.z > -3 && dummy.position.z < 3 && dummy.position.y < 1.8) dummy.position.y += 0.05 * spd;
      else if (dummy.position.z < -3 && dummy.position.y > 0.1) dummy.position.y -= 0.03 * spd;

      if (dummy.position.z < -10) { dummy.position.set((Math.random() - 0.5) * 4, Math.random() * 2.0 + 0.1, 10 + Math.random() * 5); }
      dummy.updateMatrix();
      windInstanced.setMatrixAt(i, dummy.matrix);
    }
    windInstanced.instanceMatrix.needsUpdate = true;
  }
  controls.update(); renderer.render(scene, camera); window.requestAnimationFrame(animate);
}
animate(); init();
