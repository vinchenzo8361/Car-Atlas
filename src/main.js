import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';

// =======================
// THREE.JS SETUP
// =======================
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
const spotLight = new THREE.SpotLight(0xffffff, 200);
spotLight.position.set(0, 10, 0);
spotLight.angle = Math.PI / 4;
spotLight.penumbra = 0.5;
scene.add(spotLight);

// =======================
// AEROLAB STREAMLINES
// =======================
let windLines = null;
let isAeroLab = false;
const lineCount = 150; // MORE LINES!
const segments = 100;  // LONGER LINES!

function createAeroLab() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(lineCount * segments * 3);
  
  // Initialize lines far ahead of the car
  for (let i = 0; i < lineCount; i++) {
    const startX = (Math.random() - 0.5) * 4;
    const startY = Math.random() * 2.0 + 0.1;
    for (let j = 0; j < segments; j++) {
      const idx = (i * segments + j) * 3;
      positions[idx] = startX;
      positions[idx + 1] = startY;
      positions[idx + 2] = 20 + (j * 0.4); // Very long spacing
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending
  });

  windLines = new THREE.LineSegments(geometry, material);
  windLines.visible = false;
  scene.add(windLines);
}
createAeroLab();

// =======================
// STATE & APP LOGIC
// =======================
let appState = {
  vehicles: [],
  brands: [],
  currentVehicle: null,
  currentModel: null
};

const loadingManager = new THREE.LoadingManager();
const progressBar = document.getElementById('progress-bar');
const loadingScreen = document.getElementById('loading-screen');

loadingManager.onProgress = function(url, itemsLoaded, itemsTotal) {
  progressBar.style.width = (itemsLoaded / itemsTotal * 100) + '%';
};
loadingManager.onLoad = function() {
  setTimeout(() => loadingScreen.classList.add('hidden'), 500);
};
loadingManager.onError = function(url) {
  console.warn("Failed to load model:", url);
  document.getElementById('loading-text').textContent = "Model File Not Found! Please download it.";
  setTimeout(() => loadingScreen.classList.add('hidden'), 3000);
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);

async function init() {
  const response = await fetch('/data/cars.json');
  const data = await response.json();
  appState.vehicles = data.vehicles;
  
  // Extract unique brands
  appState.brands = [...new Set(appState.vehicles.map(v => v.brand))];
  
  populateBrandGrid();
  setupNav();
}

function populateBrandGrid() {
  const grid = document.getElementById('brand-grid');
  grid.innerHTML = '';
  appState.brands.forEach(brand => {
    const card = document.createElement('div');
    card.className = 'brand-card';
    card.innerHTML = `<h3>${brand}</h3>`;
    card.onclick = () => showVehiclesForBrand(brand);
    grid.appendChild(card);
  });
}

function showVehiclesForBrand(brand) {
  document.getElementById('brand-overlay').classList.add('hidden');
  const selectionOverlay = document.getElementById('selection-overlay');
  selectionOverlay.classList.remove('hidden');
  document.getElementById('brand-title').textContent = `${brand} Models`;
  
  const grid = document.getElementById('vehicle-grid');
  grid.innerHTML = '';
  
  const filteredVehicles = appState.vehicles.filter(v => v.brand === brand);
  
  filteredVehicles.forEach(vehicle => {
    const card = document.createElement('div');
    card.className = 'car-card';
    card.innerHTML = `
      <img src="${vehicle.thumbnail}" alt="${vehicle.name}">
      <div class="card-info">
        <h3>${vehicle.name}</h3>
        <p>${vehicle.specs.power} | ${vehicle.specs.top_speed}</p>
      </div>
    `;
    card.onclick = () => loadVehicle(vehicle);
    grid.appendChild(card);
  });
}

window.changeCarColor = function(hexColor) {
  if (!appState.currentModel) return;
  appState.currentModel.traverse((child) => {
    if (child.userData.isCarPaint) {
      gsap.to(child.material.color, {
        r: new THREE.Color(hexColor).r,
        g: new THREE.Color(hexColor).g,
        b: new THREE.Color(hexColor).b,
        duration: 0.5
      });
    }
  });
};

function loadVehicle(vehicle) {
  // Fix the Aero bug: always disable aero when loading a car
  resetShowroom();

  document.getElementById('selection-overlay').classList.add('hidden');
  document.getElementById('specs-sidebar').classList.remove('hidden');
  document.getElementById('current-car-name').textContent = vehicle.name;
  
  if (appState.currentModel) {
    scene.remove(appState.currentModel);
    appState.currentModel = null;
  }
  appState.currentVehicle = vehicle;
  
  const specsContent = document.getElementById('specs-content');
  let specsHTML = '';
  for (const [key, value] of Object.entries(vehicle.specs)) {
    specsHTML += `
      <div class="spec-row">
        <span class="spec-label">${key.replace('_', ' ').toUpperCase()}</span>
        <span class="spec-value">${value}</span>
      </div>
    `;
  }
  specsContent.innerHTML = specsHTML;
  document.getElementById('interactions').classList.remove('hidden');

  if (vehicle.modelUrl) {
    loadingScreen.classList.remove('hidden');
    document.getElementById('loading-text').textContent = `Loading ${vehicle.name}...`;
    progressBar.style.width = '0%';
    
    gltfLoader.load(
      vehicle.modelUrl,
      (gltf) => {
        appState.currentModel = gltf.scene;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(center);
        gltf.scene.position.y += Math.abs(box.min.y); 
        
        gltf.scene.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.needsUpdate = true;
            if (child.name.toLowerCase().includes('body') || child.name.toLowerCase().includes('paint')) {
               child.userData.isCarPaint = true;
               child.material = new THREE.MeshPhysicalMaterial({
                  color: child.material.color,
                  metalness: 0.8,
                  roughness: 0.2,
                  clearcoat: 1.0,
                  clearcoatRoughness: 0.05
               });
            }
          }
        });
        scene.add(gltf.scene);
        gsap.from(camera.position, { duration: 2, x: 8, y: 3, z: 8, ease: 'power3.out' });
      },
      undefined,
      (error) => {
        console.error(error);
      }
    );
  }
}

function resetShowroom() {
  isAeroLab = false;
  windLines.visible = false;
  document.getElementById('aero-controls').classList.add('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-showroom').classList.add('active');
  scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
}

function setupNav() {
  document.getElementById('btn-change-car').onclick = () => {
    resetShowroom();
    document.getElementById('specs-sidebar').classList.add('hidden');
    document.getElementById('brand-overlay').classList.remove('hidden'); // Return to brand select
  };

  document.getElementById('btn-back-brands').onclick = () => {
    document.getElementById('selection-overlay').classList.add('hidden');
    document.getElementById('brand-overlay').classList.remove('hidden');
  };

  document.getElementById('btn-showroom').onclick = (e) => {
    resetShowroom();
    e.target.classList.add('active');
    gsap.to(camera.position, { x: 6, y: 2, z: 8, duration: 1.5 });
  };

  document.getElementById('btn-aero').onclick = (e) => {
    isAeroLab = true;
    windLines.visible = true;
    document.getElementById('aero-controls').classList.remove('hidden');
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    scene.background = new THREE.Color('#000510');
    gsap.to(camera.position, { x: 10, y: 3, z: 12, duration: 1.5 });
  };

  document.getElementById('btn-theme-toggle').onclick = () => {
    isLightMode = !isLightMode;
    document.body.classList.toggle('light-mode');
    if (!isAeroLab) {
      scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
    }
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  // Update Aero lines (Continuous Streamlines)
  if (isAeroLab && windLines) {
    const windSpeedSlider = document.getElementById('wind-speed').value;
    const speedMult = windSpeedSlider / 50;
    const positions = windLines.geometry.attributes.position.array;
    
    for (let i = 0; i < lineCount; i++) {
      for (let j = 0; j < segments; j++) {
        const idx = (i * segments + j) * 3;
        positions[idx + 2] -= 1.0 * speedMult; // Faster movement
        
        // Arch over the car's bounding box
        if (positions[idx + 2] > -3 && positions[idx + 2] < 3) {
          if (positions[idx + 1] < 1.8) {
            positions[idx + 1] += 0.03 * speedMult; // Lift up
          }
        } else if (positions[idx + 2] < -3 && positions[idx + 1] > 0.1) {
          positions[idx + 1] -= 0.02 * speedMult; // Settle back down
        }
      }
      
      // If the tail passes, reset line far ahead
      const headIdx = (i * segments) * 3;
      if (positions[headIdx + 2] < -15) {
        const startX = (Math.random() - 0.5) * 4;
        const startY = Math.random() * 2.0 + 0.1;
        for (let j = 0; j < segments; j++) {
          const idx = (i * segments + j) * 3;
          positions[idx] = startX;
          positions[idx + 1] = startY;
          positions[idx + 2] = 20 + (j * 0.4);
        }
      }
    }
    windLines.geometry.attributes.position.needsUpdate = true;
  }
  
  controls.update();
  renderer.render(scene, camera);
  window.requestAnimationFrame(animate);
}

animate();
init();
