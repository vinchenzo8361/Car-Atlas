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

// Environment (Realistic Reflections without HDRI)
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientLight);
const spotLight = new THREE.SpotLight(0xffffff, 200);
spotLight.position.set(0, 10, 0);
spotLight.angle = Math.PI / 4;
spotLight.penumbra = 0.5;
scene.add(spotLight);

// =======================
// AEROLAB PARTICLES
// =======================
let windParticles = null;
let isAeroLab = false;
function createAeroLab() {
  const particleCount = 2000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = [];

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 4;     // x
    positions[i * 3 + 1] = Math.random() * 2 + 0.1;   // y
    positions[i * 3 + 2] = Math.random() * 10 + 5;    // z
    velocities.push(Math.random() * 0.1 + 0.1);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x00d2ff,
    size: 0.05,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });

  windParticles = new THREE.Points(geometry, material);
  windParticles.userData.velocities = velocities;
  windParticles.visible = false;
  scene.add(windParticles);
}
createAeroLab();

// =======================
// STATE & APP LOGIC
// =======================
let appState = {
  vehicles: [],
  currentVehicle: null,
  currentModel: null
};

// Loading Manager
const loadingManager = new THREE.LoadingManager();
const progressBar = document.getElementById('progress-bar');
const loadingScreen = document.getElementById('loading-screen');

loadingManager.onProgress = function(url, itemsLoaded, itemsTotal) {
  progressBar.style.width = (itemsLoaded / itemsTotal * 100) + '%';
};
loadingManager.onLoad = function() {
  loadingScreen.classList.add('hidden');
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);

async function init() {
  const response = await fetch('/data/cars.json');
  const data = await response.json();
  appState.vehicles = data.vehicles;
  
  populateVehicleGrid();
  setupNav();
}

function populateVehicleGrid() {
  const grid = document.getElementById('vehicle-grid');
  grid.innerHTML = '';
  
  appState.vehicles.forEach(vehicle => {
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

function loadVehicle(vehicle) {
  document.getElementById('selection-overlay').classList.add('hidden');
  document.getElementById('specs-sidebar').classList.remove('hidden');
  document.getElementById('current-car-name').textContent = vehicle.name;
  
  // Clear old model
  if (appState.currentModel) {
    scene.remove(appState.currentModel);
    appState.currentModel = null;
  }
  
  appState.currentVehicle = vehicle;
  
  // Update Specs UI
  const specsContent = document.getElementById('specs-content');
  let specsHTML = '';
  for (const [key, value] of Object.entries(vehicle.specs)) {
    const formattedKey = key.replace('_', ' ').toUpperCase();
    specsHTML += `
      <div class="spec-row">
        <span class="spec-label">${formattedKey}</span>
        <span class="spec-value">${value}</span>
      </div>
    `;
  }
  specsContent.innerHTML = specsHTML;
  
  // Colors
  const colorPicker = document.getElementById('color-picker');
  colorPicker.innerHTML = '';
  if (vehicle.availableColors) {
    document.getElementById('interactions').classList.remove('hidden');
    vehicle.availableColors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color.hex;
      swatch.title = color.name;
      swatch.onclick = () => changeCarColor(color.hex);
      colorPicker.appendChild(swatch);
    });
  }

  // Load Model
  if (vehicle.modelUrl) {
    loadingScreen.classList.remove('hidden');
    progressBar.style.width = '0%';
    gltfLoader.load(vehicle.modelUrl, (gltf) => {
      appState.currentModel = gltf.scene;
      
      // Center & Scale
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      gltf.scene.position.sub(center); // Center it
      gltf.scene.position.y += 0.5; // Lift it slightly
      
      // Traverse to enhance paint
      gltf.scene.traverse((child) => {
        if (child.isMesh && child.material) {
          // If it looks like car body paint
          if (child.name.toLowerCase().includes('body') || child.name.toLowerCase().includes('paint')) {
            const oldMat = child.material;
            child.material = new THREE.MeshPhysicalMaterial({
              color: oldMat.color,
              metalness: 0.8,
              roughness: 0.2,
              clearcoat: 1.0,
              clearcoatRoughness: 0.05
            });
            child.userData.isCarPaint = true;
          }
        }
      });
      
      scene.add(gltf.scene);
      
      gsap.from(camera.position, {
        duration: 2,
        x: 10,
        y: 5,
        z: 10,
        ease: 'power3.out'
      });
    });
  } else {
    // Generate beautiful placeholder for cars without models
    const geometry = new THREE.CapsuleGeometry(1, 2.5, 32, 32);
    geometry.rotateZ(Math.PI / 2);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xff0000,
      metalness: 0.9,
      roughness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.5;
    mesh.userData.isCarPaint = true;
    appState.currentModel = mesh;
    scene.add(mesh);
  }
}

function changeCarColor(hexColor) {
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
}

// Nav Logic
function setupNav() {
  document.getElementById('btn-change-car').onclick = () => {
    document.getElementById('specs-sidebar').classList.add('hidden');
    document.getElementById('selection-overlay').classList.remove('hidden');
  };

  document.getElementById('btn-showroom').onclick = (e) => {
    isAeroLab = false;
    windParticles.visible = false;
    document.getElementById('aero-controls').classList.add('hidden');
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    scene.background = new THREE.Color('#050505');
  };

  document.getElementById('btn-aero').onclick = (e) => {
    isAeroLab = true;
    windParticles.visible = true;
    document.getElementById('aero-controls').classList.remove('hidden');
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    scene.background = new THREE.Color('#001122');
    
    // Zoom out for wind tunnel view
    gsap.to(camera.position, { x: 8, y: 3, z: 8, duration: 1.5 });
  };
}

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation Loop
const clock = new THREE.Clock();
function animate() {
  const delta = clock.getDelta();
  
  // Update Aero particles
  if (isAeroLab && windParticles) {
    const windSpeedSlider = document.getElementById('wind-speed').value;
    const speedMult = windSpeedSlider / 50;
    
    const positions = windParticles.geometry.attributes.position.array;
    const vels = windParticles.userData.velocities;
    
    for (let i = 0; i < positions.length / 3; i++) {
      positions[i * 3 + 2] -= vels[i] * speedMult; // move along Z
      
      // Deflect over car shape (basic mock physics)
      if (positions[i*3 + 2] > -2 && positions[i*3 + 2] < 2) {
         if (positions[i*3 + 1] < 1.5) {
             positions[i*3 + 1] += 0.05 * speedMult; 
         }
      }
      
      // Reset if too far
      if (positions[i * 3 + 2] < -5) {
        positions[i * 3 + 2] = 5 + Math.random() * 5;
        positions[i * 3 + 1] = Math.random() * 2 + 0.1;
      }
    }
    windParticles.geometry.attributes.position.needsUpdate = true;
  }
  
  controls.update();
  renderer.render(scene, camera);
  window.requestAnimationFrame(animate);
}

animate();
init();
