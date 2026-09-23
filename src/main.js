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
// AEROLAB STREAMLINES
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

const thermalMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    varying vec3 vNormal;
    void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    void main() {
      float z = vNormal.z; 
      vec3 color = vec3(0.0, 1.0, 0.0);
      if (z > 0.0) color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), z);
      else color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), -z);
      gl_FragColor = vec4(color, 1.0);
    }
  `
});

// =======================
// APP LOGIC & STATE
// =======================
let appState = {
  vehicles: [], brands: [], currentVehicle: null, currentModel: null, garage: [], 
  intent: 'home' // 'home', 'showroom', 'aero', 'library', 'garage'
};

const logoMap = {
  "Porsche": "https://cdn.simpleicons.org/porsche/D5001C",
  "McLaren": "https://cdn.simpleicons.org/mclaren/FF7B00",
  "Ferrari": "https://cdn.simpleicons.org/ferrari/E32119",
  "Lamborghini": "https://cdn.simpleicons.org/lamborghini/DCB514",
  "Audi": "https://cdn.simpleicons.org/audi/F50537",
  "Bugatti": "https://cdn.simpleicons.org/bugatti/C8102E",
  "Nissan": "https://cdn.simpleicons.org/nissan/C3002F",
  "BMW": "https://cdn.simpleicons.org/bmw/0066B1",
  "Mercedes": "https://cdn.simpleicons.org/mercedes/FFFFFF",
  "Koenigsegg": "https://upload.wikimedia.org/wikipedia/commons/4/4b/Koenigsegg_logo.svg", // Replaced text with SVG!
  "Aston Martin": "https://cdn.simpleicons.org/astonmartin/00665E",
  "Chevrolet": "https://cdn.simpleicons.org/chevrolet/CD9834",
  "Toyota": "https://cdn.simpleicons.org/toyota/EB0A1E",
  "Dodge": "https://cdn.simpleicons.org/dodge/CC0000"
};

// Rock-solid fallback loader
const ULTIMATE_FALLBACK_IMG = "https://images.unsplash.com/photo-1542282088-fe8426682b8f?w=600"; 
function loadFallbackImage(imgElement, urls, vehicleName) {
  const safeUrls = urls ? [...urls, ULTIMATE_FALLBACK_IMG] : [ULTIMATE_FALLBACK_IMG];
  let index = 0;
  imgElement.onerror = function() {
    index++;
    if (index < safeUrls.length) {
      imgElement.src = safeUrls[index];
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'fallback-img';
      fallback.textContent = vehicleName + ' IMAGE UNAVAILABLE';
      if(imgElement.parentNode) imgElement.parentNode.replaceChild(fallback, imgElement);
    }
  };
  imgElement.src = safeUrls[0];
}

const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (u, i, t) => document.getElementById('progress-bar').style.width = (i / t * 100) + '%';
loadingManager.onLoad = () => setTimeout(() => document.getElementById('loading-screen').classList.add('hidden'), 500);

const gltfLoader = new GLTFLoader(loadingManager).setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'));

async function init() {
  const saved = localStorage.getItem('carAtlasGarage');
  if (saved) { appState.garage = JSON.parse(saved); document.getElementById('garage-count').textContent = `(${appState.garage.length})`; }
  
  const response = await fetch('/data/cars.json');
  const data = await response.json();
  appState.vehicles = data.vehicles;
  appState.brands = [...new Set(appState.vehicles.filter(v => v.brand !== 'Test').map(v => v.brand)), 'Test'];
  
  setupNav();
}

window.selectIntent = function(intent) {
  appState.intent = intent;
  hideAllOverlays();
  
  if (intent === 'garage') {
    showGarage();
  } else {
    document.getElementById('top-bar').classList.remove('hidden');
    populateBrandGrid();
    document.getElementById('brand-overlay').classList.remove('hidden');
  }
};

function populateBrandGrid() {
  const grid = document.getElementById('brand-grid');
  grid.innerHTML = '';
  appState.brands.forEach(brand => {
    const card = document.createElement('div'); card.className = 'brand-card';
    let logoHTML = '';
    if (logoMap[brand]) logoHTML = `<img src="${logoMap[brand]}" alt="${brand}" class="brand-logo" onerror="this.style.display='none'">`;
    card.innerHTML = `${logoHTML} <h3>${brand}</h3>`;
    card.onclick = () => showVehicles(appState.vehicles.filter(v => v.brand === brand), `${brand} Models`);
    grid.appendChild(card);
  });
}

function showVehicles(vehicles, title) {
  hideAllOverlays();
  document.getElementById('top-bar').classList.remove('hidden');
  document.getElementById('selection-overlay').classList.remove('hidden');
  document.getElementById('brand-title').textContent = title;
  
  const grid = document.getElementById('vehicle-grid');
  grid.innerHTML = '';
  vehicles.forEach(vehicle => {
    const card = document.createElement('div'); card.className = 'car-card';
    card.innerHTML = `<img src="" id="img-${vehicle.id}" alt="${vehicle.name}"><div class="card-info"><h3>${vehicle.name}</h3><p>${vehicle.specs.power || ''}</p></div>`;
    card.onclick = () => {
      if (appState.intent === 'library') showLibraryInfo(vehicle);
      else loadVehicle(vehicle);
    };
    grid.appendChild(card);
    setTimeout(() => loadFallbackImage(document.getElementById(`img-${vehicle.id}`), vehicle.thumbnails, vehicle.name), 0);
  });
}

function showLibraryInfo(vehicle) {
  hideAllOverlays();
  document.getElementById('library-overlay').classList.remove('hidden');
  document.getElementById('lib-car-name').textContent = vehicle.name;
  
  let html = `<p><strong>Brand:</strong> ${vehicle.brand}</p>`;
  if(vehicle.library) {
    for (const [key, value] of Object.entries(vehicle.library)) {
      html += `<p><strong>${key.replace(/_/g, ' ').toUpperCase()}:</strong> ${value}</p>`;
    }
  } else {
    html += `<p>Detailed encyclopedia information is being compiled for this vehicle...</p>`;
  }
  document.getElementById('lib-content').innerHTML = html;
}

function showGarage() {
  hideAllOverlays();
  document.getElementById('top-bar').classList.remove('hidden');
  document.getElementById('garage-overlay').classList.remove('hidden');
  const savedCars = appState.vehicles.filter(v => appState.garage.includes(v.id));
  const grid = document.getElementById('garage-grid');
  grid.innerHTML = '';
  if (savedCars.length === 0) { grid.innerHTML = '<p style="text-align:center; width:100%;">Your garage is empty. Heart some cars!</p>'; return; }
  savedCars.forEach(vehicle => {
    const card = document.createElement('div'); card.className = 'car-card';
    card.innerHTML = `<img src="" id="garage-img-${vehicle.id}" alt="${vehicle.name}"><div class="card-info"><h3>${vehicle.name}</h3></div>`;
    card.onclick = () => { appState.intent = 'showroom'; loadVehicle(vehicle); }; // Always go to showroom from garage
    grid.appendChild(card);
    setTimeout(() => loadFallbackImage(document.getElementById(`garage-img-${vehicle.id}`), vehicle.thumbnails, vehicle.name), 0);
  });
}

function removeCurrentCar() {
  if (appState.currentModel) { scene.remove(appState.currentModel); appState.currentModel = null; }
  appState.currentVehicle = null;
}

function hideAllOverlays() {
  resetSceneDefaults();
  removeCurrentCar();
  document.getElementById('home-menu').classList.add('hidden');
  document.getElementById('brand-overlay').classList.add('hidden');
  document.getElementById('selection-overlay').classList.add('hidden');
  document.getElementById('garage-overlay').classList.add('hidden');
  document.getElementById('library-overlay').classList.add('hidden');
  document.getElementById('specs-sidebar').classList.add('hidden');
  document.getElementById('aero-tv-overlay').classList.add('hidden');
  document.getElementById('top-bar').classList.add('hidden');
}

window.goHome = function() {
  hideAllOverlays();
  appState.intent = 'home';
  document.getElementById('home-menu').classList.remove('hidden');
};

function toggleHeart() {
  const v = appState.currentVehicle;
  if (!v) return;
  const idx = appState.garage.indexOf(v.id);
  if (idx > -1) { appState.garage.splice(idx, 1); document.getElementById('btn-heart').classList.remove('saved'); document.getElementById('btn-heart').textContent = '🤍'; } 
  else { appState.garage.push(v.id); document.getElementById('btn-heart').classList.add('saved'); document.getElementById('btn-heart').textContent = '❤️'; }
  localStorage.setItem('carAtlasGarage', JSON.stringify(appState.garage));
  document.getElementById('garage-count').textContent = `(${appState.garage.length})`;
}

// Lamborghini style configurator
window.changeMaterialColor = function(partType, hexColor) {
  if (!appState.currentModel || isThermal) return;
  appState.currentModel.traverse((c) => {
    if (c.isMesh && c.material) {
      const name = c.name.toLowerCase();
      if (partType === 'paint' && (name.includes('body') || name.includes('paint') || c.userData.isCarPaint)) {
        gsap.to(c.material.color, { r: new THREE.Color(hexColor).r, g: new THREE.Color(hexColor).g, b: new THREE.Color(hexColor).b, duration: 0.5 });
      }
      if (partType === 'caliper' && (name.includes('caliper') || name.includes('brake'))) {
        gsap.to(c.material.color, { r: new THREE.Color(hexColor).r, g: new THREE.Color(hexColor).g, b: new THREE.Color(hexColor).b, duration: 0.5 });
      }
    }
  });
};

function activateAeroModeLogic() {
  isAeroLab = true; windInstanced.visible = true; controls.enabled = false; 
  document.getElementById('aero-tv-overlay').classList.remove('hidden');
  scene.background = new THREE.Color('#00030a');
  setAeroCamera('isometric');
}

function loadVehicle(vehicle) {
  hideAllOverlays();
  document.getElementById('top-bar').classList.remove('hidden');
  
  if (appState.intent === 'showroom') document.getElementById('specs-sidebar').classList.remove('hidden');

  document.getElementById('current-car-name').textContent = vehicle.name;
  const heartBtn = document.getElementById('btn-heart');
  if (appState.garage.includes(vehicle.id)) { heartBtn.classList.add('saved'); heartBtn.textContent = '❤️'; }
  else { heartBtn.classList.remove('saved'); heartBtn.textContent = '🤍'; }
  heartBtn.onclick = toggleHeart;

  appState.currentVehicle = vehicle;
  
  let specsHTML = '';
  for (const [key, value] of Object.entries(vehicle.specs || {})) {
    specsHTML += `<div class="spec-row"><span class="spec-label">${key.replace('_', ' ').toUpperCase()}</span><span class="spec-value">${value}</span></div>`;
  }
  document.getElementById('specs-content').innerHTML = specsHTML;

  const finalizeLoad = (model) => {
    appState.currentModel = model;
    scene.add(model);
    if (appState.intent === 'aero') activateAeroModeLogic();
    else gsap.from(camera.position, { duration: 2, x: 8, y: 3, z: 8, ease: 'power3.out' });
  };

  if (vehicle.modelUrl) {
    if (vehicle.modelUrl.startsWith('primitive:')) {
      const type = vehicle.modelUrl.split(':')[1];
      let geo = type === 'box' ? new THREE.BoxGeometry(2, 1.5, 4) : type === 'sphere' ? new THREE.SphereGeometry(1.5, 64, 64) : new THREE.ConeGeometry(1.5, 4, 64);
      if(type==='cone') geo.rotateX(Math.PI/2);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x999999, metalness: 0.5, roughness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 1.0; mesh.userData.isCarPaint = true; mesh.userData.originalMat = mat;
      const group = new THREE.Group(); group.add(mesh);
      finalizeLoad(group);
      return;
    }

    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('loading-text').textContent = `Loading ${vehicle.name}...`;
    gltfLoader.load(vehicle.modelUrl, (gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      gltf.scene.position.sub(box.getCenter(new THREE.Vector3()));
      gltf.scene.position.y += Math.abs(box.min.y); 
      gltf.scene.traverse((c) => {
        if (c.isMesh && c.material) {
          c.material.needsUpdate = true;
          if (c.name.toLowerCase().includes('body') || c.name.toLowerCase().includes('paint')) {
             c.userData.isCarPaint = true;
             c.userData.originalMat = new THREE.MeshPhysicalMaterial({ color: c.material.color, metalness: 0.8, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.05 });
             c.material = c.userData.originalMat;
          } else { c.userData.originalMat = c.material; }
        }
      });
      finalizeLoad(gltf.scene);
    });
  }
}

window.setAeroCamera = function(pos) {
  if (pos === 'top') gsap.to(camera.position, { x: 0, y: 12, z: 0.1, duration: 1.5 });
  if (pos === 'bottom') gsap.to(camera.position, { x: 0, y: -2, z: 0.1, duration: 1.5 });
  if (pos === 'left') gsap.to(camera.position, { x: -10, y: 1, z: 0, duration: 1.5 });
  if (pos === 'right') gsap.to(camera.position, { x: 10, y: 1, z: 0, duration: 1.5 });
  if (pos === 'front') gsap.to(camera.position, { x: 0, y: 1.5, z: 12, duration: 1.5 });
  if (pos === 'back') gsap.to(camera.position, { x: 0, y: 1.5, z: -12, duration: 1.5 });
  if (pos === 'isometric') gsap.to(camera.position, { x: 8, y: 4, z: 8, duration: 1.5 });
};

function resetSceneDefaults() {
  isAeroLab = false; isThermal = false;
  windInstanced.visible = false;
  controls.enabled = true;
  scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
  if (appState.currentModel) appState.currentModel.traverse((c) => { if (c.isMesh && c.userData.originalMat) c.material = c.userData.originalMat; });
}

function setupNav() {
  document.querySelectorAll('.btn-go-home').forEach(btn => btn.onclick = goHome);
  document.getElementById('btn-home').onclick = goHome;
  document.getElementById('btn-back-brands').onclick = () => selectIntent(appState.intent);
  document.getElementById('btn-library-back').onclick = () => selectIntent('library');
  
  document.getElementById('btn-thermal').onclick = () => {
    isThermal = !isThermal;
    if (appState.currentModel) appState.currentModel.traverse((c) => { if (c.isMesh && c.userData.originalMat) c.material = isThermal ? thermalMaterial : c.userData.originalMat; });
  };
  document.getElementById('btn-theme-toggle').onclick = () => {
    isLightMode = !isLightMode; document.body.classList.toggle('light-mode');
    if (!isAeroLab) scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
  };
}

const dummy = new THREE.Object3D();
function animate() {
  if (isAeroLab && windInstanced) {
    const spd = document.getElementById('wind-speed').value / 50;
    const vels = windInstanced.userData.velocities;
    for (let i = 0; i < windCount; i++) {
      windInstanced.getMatrixAt(i, dummy.matrix); dummy.position.setFromMatrixPosition(dummy.matrix);
      dummy.position.z -= vels[i] * spd;
      if (dummy.position.z > -3 && dummy.position.z < 3 && dummy.position.y < 1.8) dummy.position.y += 0.05 * spd;
      else if (dummy.position.z < -3 && dummy.position.y > 0.1) dummy.position.y -= 0.03 * spd;
      if (dummy.position.z < -10) dummy.position.set((Math.random() - 0.5) * 4, Math.random() * 2.0 + 0.1, 10 + Math.random() * 5);
      dummy.updateMatrix(); windInstanced.setMatrixAt(i, dummy.matrix);
    }
    windInstanced.instanceMatrix.needsUpdate = true;
  }
  controls.update(); renderer.render(scene, camera); window.requestAnimationFrame(animate);
}
animate(); init();
