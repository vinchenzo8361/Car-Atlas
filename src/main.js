import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Base setup
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();

// We will load an HDRI here later for realistic reflections
scene.background = new THREE.Color('#101012');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(4, 2, 6);

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  alpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

// Temporary placeholder box while no model is loaded
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x007acc, roughness: 0.2, metalness: 0.8 });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// Window resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// App State
let appState = {
  vehicles: [],
  currentVehicle: null
};

// UI Logic
async function init() {
  // Fetch realistic data
  const response = await fetch('/data/cars.json');
  const data = await response.json();
  appState.vehicles = data.vehicles;
  
  populateVehicleList();
  
  // Hide loading screen initially
  document.getElementById('loading-screen').classList.add('hidden');
}

function populateVehicleList() {
  const list = document.getElementById('vehicle-list');
  list.innerHTML = '';
  
  appState.vehicles.forEach(vehicle => {
    const li = document.createElement('li');
    li.textContent = vehicle.name;
    li.onclick = () => selectVehicle(vehicle);
    list.appendChild(li);
  });
}

function selectVehicle(vehicle) {
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
  
  // Show interactions
  document.getElementById('interactions').classList.remove('hidden');
  
  // Populate colors
  const colorPicker = document.getElementById('color-picker');
  colorPicker.innerHTML = '';
  if (vehicle.availableColors) {
    vehicle.availableColors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color.hex;
      swatch.title = color.name;
      swatch.onclick = () => {
        // Change color logic here later
        material.color.set(color.hex); // temporary mock behavior
      };
      colorPicker.appendChild(swatch);
    });
  }

  // Next steps: load actual .glb using GLTFLoader here!
  console.log(`Loading 3D model from ${vehicle.modelPath}... (Coming next)`);
}

// Animation loop
const clock = new THREE.Clock();
function animate() {
  const elapsedTime = clock.getElapsedTime();
  controls.update();
  renderer.render(scene, camera);
  window.requestAnimationFrame(animate);
}

animate();
init();
