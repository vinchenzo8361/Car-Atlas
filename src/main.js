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

// AEROLAB STREAMLINES
// =======================
let windInstanced = null;
let isAeroLab = false;
let isThermal = false;
const windCount = 3000; 

function createAeroLab() {
  const geometry = new THREE.BoxGeometry(0.015, 0.015, 15.0);
  const material = new THREE.MeshBasicMaterial({ color: 0xf0f5ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
  windInstanced = new THREE.InstancedMesh(geometry, material, windCount);
  const dummy = new THREE.Object3D();
  const vels = new Float32Array(windCount);
  for (let i = 0; i < windCount; i++) {
    dummy.position.set((Math.random() - 0.5) * 8, Math.random() * 4.0 + 0.1, 10 + Math.random() * 20);
    dummy.updateMatrix();
    windInstanced.setMatrixAt(i, dummy.matrix);
    vels[i] = Math.random() * 0.4 + 0.8;
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
  intent: 'home' 
};

// Extremely robust hardcoded logo map
const logoMap = {
  "Porsche": "https://cdn.worldvectorlogo.com/logos/porsche-6.svg",
  "McLaren": "https://upload.wikimedia.org/wikipedia/en/thumb/6/66/McLaren_Racing_logo.svg/512px-McLaren_Racing_logo.svg.png",
  "Ferrari": "https://cdn.worldvectorlogo.com/logos/ferrari-ges.svg",
  "Lamborghini": "https://cdn.worldvectorlogo.com/logos/lamborghini-1.svg",
  "Audi": "https://cdn.worldvectorlogo.com/logos/audi-11.svg",
  "Bugatti": "https://cdn.worldvectorlogo.com/logos/bugatti-logo.svg",
  "Nissan": "https://cdn.worldvectorlogo.com/logos/nissan-6.svg",
  "BMW": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/BMW.svg/512px-BMW.svg.png",
  "Mercedes": "https://cdn.worldvectorlogo.com/logos/mercedes-benz-9.svg",
  "Koenigsegg": "https://cdn.worldvectorlogo.com/logos/koenigsegg.svg",
  "Aston Martin": "https://cdn.worldvectorlogo.com/logos/aston-martin-1.svg",
  "Chevrolet": "https://cdn.worldvectorlogo.com/logos/chevrolet-1.svg",
  "Toyota": "https://www.google.com/s2/favicons?sz=256&domain=toyota.com",
  "Dodge": "https://www.google.com/s2/favicons?sz=256&domain=dodge.com",
  "Formula 1": "https://www.google.com/s2/favicons?sz=256&domain=formula1.com"
};

const LOCAL_FALLBACK_IMG = "/images/fallback.jpg"; 

function loadFallbackImage(imgElement, urls, vehicleName) {
  // Generate 10 dynamic fallback query URLs for safety
  const dynamicUrls = Array.from({length: 10}, (_, i) => `https://source.unsplash.com/600x400/?${encodeURIComponent(vehicleName)},supercar&sig=${i}`);
  const safeUrls = urls ? [...urls, ...dynamicUrls, LOCAL_FALLBACK_IMG] : [...dynamicUrls, LOCAL_FALLBACK_IMG];
  
  let index = 0;
  imgElement.onerror = function() {
    index++;
    if (index < safeUrls.length) {
      imgElement.src = safeUrls[index];
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'fallback-img';
      fallback.textContent = 'IMAGE UNAVAILABLE';
      if(imgElement.parentNode) imgElement.parentNode.replaceChild(fallback, imgElement);
    }
  };
  imgElement.src = safeUrls[0];
}

const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (u, i, t) => document.getElementById('progress-bar').style.width = (i / t * 100) + '%';
loadingManager.onLoad = () => setTimeout(() => document.getElementById('loading-screen').classList.add('hidden'), 500);
loadingManager.onError = () => { 
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('model-error-modal').classList.remove('hidden');
  removeCurrentCar();
};

const gltfLoader = new GLTFLoader(loadingManager).setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'));

async function init() {
  const saved = localStorage.getItem('carAtlasGarage');
  if (saved) { appState.garage = JSON.parse(saved); document.getElementById('garage-count').textContent = `(${appState.garage.length})`; }
  
  const response = await fetch('/data/cars.json');
  const data = await response.json();
  appState.vehicles = data.vehicles;
  
  // Create brand list. Ensure 'Test' is at the end, and 'Formula 1' is present.
  let b = [...new Set(appState.vehicles.map(v => v.brand))];
  appState.brands = b.filter(brand => brand !== 'Test');
  appState.brands.push('Test');
  
  setupNav();
}

window.selectIntent = function(intent) {
  appState.intent = intent;
  hideAllOverlays();
  
  // Theme Button Logic
  if (intent === 'home') {
    document.getElementById('global-theme-toggle').style.display = 'block';
  } else {
    document.getElementById('global-theme-toggle').style.display = 'none';
  }

  if (intent === 'garage') {
    showGarage();
  } else if (intent !== 'home') {
    document.getElementById('top-bar').classList.remove('hidden');
    populateBrandGrid();
    document.getElementById('brand-overlay').classList.remove('hidden');
  }
};

function populateBrandGrid() {
  const grid = document.getElementById('brand-grid');
  grid.innerHTML = '';
  
  // If library, hide 'Test'
  const displayBrands = appState.intent === 'library' 
    ? appState.brands.filter(b => b !== 'Test')
    : appState.brands;

  // For Library, let's inject a special "What is Aero Lab?" card
  if (appState.intent === 'library') {
    const aeroInfoCard = document.createElement('div');
    aeroInfoCard.className = 'brand-card';
    aeroInfoCard.innerHTML = `<h3 style="color:#00d2ff">What is an<br>Aero Lab?</h3>`;
    aeroInfoCard.onclick = () => {
      document.getElementById('brand-overlay').classList.add('hidden');
      document.getElementById('library-overlay').classList.remove('hidden');
      document.getElementById('lib-car-name').innerHTML = `Wind Tunnels Explained`;
      document.getElementById('lib-content').innerHTML = `
        <div class="library-section" style="grid-column: 1 / -1;">
          <h3>Aerodynamics & The Aero Lab</h3>
          <p>An <strong>Aero Lab</strong> (Wind Tunnel) is an engineering facility used to study the effects of air moving past solid objects. In automotive design, wind tunnels are crucial for minimizing <strong>drag</strong> (which improves top speed and fuel efficiency) and maximizing <strong>downforce</strong> (which presses the tires into the track for higher cornering speeds).</p>
          <p>By simulating wind passing over the vehicle, engineers can use smoke streams or thermal-mapped sensors to detect wake turbulence, high-pressure stagnation points (red zones), and smooth laminar flow (green zones).</p>
        </div>
      `;
    };
    grid.appendChild(aeroInfoCard);
  }

  displayBrands.forEach(brand => {
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
    let driverInfo = vehicle.type === 'f1' && appState.intent === 'showroom' ? `<p style="color:#aaa; font-size:0.8rem">Driven by: ${vehicle.specs.driven_by}</p>` : '';
    card.innerHTML = `<img src="" id="img-${vehicle.id}" alt="${vehicle.name}"><div class="card-info"><h3>${vehicle.name}</h3><p>${vehicle.specs.power || ''}</p>${driverInfo}</div>`;
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
  document.getElementById('top-bar').classList.remove('hidden');
  document.getElementById('library-overlay').classList.remove('hidden');
  
  let logoHTML = logoMap[vehicle.brand] ? `<img src="${logoMap[vehicle.brand]}" style="height: 40px; margin-right: 1rem; filter:drop-shadow(0 0 5px rgba(255,255,255,0.5))">` : '';
  document.getElementById('lib-car-name').innerHTML = `${logoHTML} ${vehicle.name}`;
  
  let html = '';
  
  if(vehicle.library) {
    if (vehicle.library.engineering) {
       html += `<div class="library-section" style="grid-column: 1 / -1;"><h3>Engineering & Performance</h3><div class="library-spec-grid">`;
       for (const [key, value] of Object.entries(vehicle.library.engineering)) {
         html += `<div class="library-spec-item"><strong>${key}</strong><br>${value}</div>`;
       }
       html += `</div></div>`;
    }
    
    if (vehicle.library.production) {
       html += `<div class="library-section" style="grid-column: 1 / -1;"><h3>Production Data</h3><div class="library-spec-grid">`;
       for (const [key, value] of Object.entries(vehicle.library.production)) {
         html += `<div class="library-spec-item"><strong>${key}</strong><br>${value}</div>`;
       }
       html += `</div></div>`;
    }

    if (vehicle.library.history) {
       html += `<div class="library-section" style="grid-column: 1 / -1;"><h3>Historical Overview</h3><p>${vehicle.library.history}</p></div>`;
    }
  } else {
    html += `<div class="library-section" style="grid-column: 1 / -1;"><h3>Encyclopedia Data</h3><p>Detailed historical and engineering records are currently being compiled for this vehicle.</p></div>`;
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
    card.onclick = () => { appState.intent = 'showroom'; loadVehicle(vehicle); }; 
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
  document.getElementById('model-error-modal').classList.add('hidden');
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
      else if (partType === 'caliper' && (name.includes('caliper') || name.includes('brake'))) {
        gsap.to(c.material.color, { r: new THREE.Color(hexColor).r, g: new THREE.Color(hexColor).g, b: new THREE.Color(hexColor).b, duration: 0.5 });
      }
      else if (partType === 'rim' && (name.includes('rim') || name.includes('wheel'))) {
        gsap.to(c.material.color, { r: new THREE.Color(hexColor).r, g: new THREE.Color(hexColor).g, b: new THREE.Color(hexColor).b, duration: 0.5 });
      }
      else if (partType === 'glass' && (name.includes('glass') || name.includes('window'))) {
        gsap.to(c.material.color, { r: new THREE.Color(hexColor).r, g: new THREE.Color(hexColor).g, b: new THREE.Color(hexColor).b, duration: 0.5 });
        if(c.material.transparent) c.material.opacity = 0.8;
      }
    }
  });
};

let windProParticles = null;
let isWindPro = false;
const windProCount = 20000;

function createWindPro() {
  const geometry = new THREE.BoxGeometry(0.015, 0.015, 0.6);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
  windProParticles = new THREE.InstancedMesh(geometry, material, windProCount);
  
  const dummy = new THREE.Object3D();
  const vels = new Float32Array(windProCount);
  
  for (let i = 0; i < windProCount; i++) {
    dummy.position.set((Math.random() - 0.5) * 3, Math.random() * 2.0 + 0.1, 5 + Math.random() * 15);
    dummy.updateMatrix();
    windProParticles.setMatrixAt(i, dummy.matrix);
    windProParticles.setColorAt(i, new THREE.Color(0x0044ff));
    vels[i] = Math.random() * 0.2 + 1.0;
  }
  windProParticles.userData.velocities = vels;
  windProParticles.visible = false;
  scene.add(windProParticles);
}
createWindPro();

function activateAeroModeLogic() {
  controls.enabled = true; 
  document.getElementById('aero-tv-overlay').classList.remove('hidden');
  
  if (appState.intent === 'wind') {
    isAeroLab = false; isWindPro = true;
    if(windInstanced) windInstanced.visible = false;
    windProParticles.visible = true;
    scene.background = new THREE.Color('#000000');
  } else {
    isWindPro = false; isAeroLab = true; 
    windInstanced.visible = true; 
    if(windProParticles) windProParticles.visible = false;
    scene.background = new THREE.Color('#00030a');
  }
  
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
    if (appState.intent === 'aero' || appState.intent === 'wind') activateAeroModeLogic();
    else gsap.from(camera.position, { duration: 2, x: 8, y: 3, z: 8, ease: 'power3.out' });
  };

  if (vehicle.modelUrl) {
    if (vehicle.modelUrl.startsWith('primitive:')) {
      const type = vehicle.modelUrl.split(':')[1];
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x999999, metalness: 0.5, roughness: 0.5 });
      const group = new THREE.Group();
      
      if (type === 'box') {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4), mat);
        mesh.position.y = 1.0; mesh.userData.isCarPaint = true; mesh.userData.originalMat = mat; group.add(mesh);
      } else if (type === 'sphere') {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.5, 64, 64), mat);
        mesh.position.y = 1.5; mesh.userData.isCarPaint = true; mesh.userData.originalMat = mat; group.add(mesh);
      } else if (type === 'cone') {
        const geo = new THREE.ConeGeometry(1.5, 4, 64); geo.rotateX(Math.PI/2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 1.0; mesh.userData.isCarPaint = true; mesh.userData.originalMat = mat; group.add(mesh);
      } else if (type === 'blockycar') {
        const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xcc0000, metalness: 0.5, roughness: 0.5 });
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.5), bodyMat);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2.5), bodyMat);
        bottom.position.y = 0.4; top.position.y = 1.15; top.position.z = -0.2;
        bottom.userData.isCarPaint = true; bottom.userData.originalMat = bodyMat;
        top.userData.isCarPaint = true; top.userData.originalMat = bodyMat;
        group.add(bottom); group.add(top);
      } else if (type === 'smoothcar') {
        const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x0055ff, metalness: 0.8, roughness: 0.2, clearcoat: 1.0 });
        const geo = new THREE.CapsuleGeometry(1.0, 3, 32, 32); geo.rotateX(Math.PI/2);
        const mesh = new THREE.Mesh(geo, bodyMat);
        mesh.position.y = 1.0; mesh.userData.isCarPaint = true; mesh.userData.originalMat = bodyMat;
        
        // Add a vertical spoiler to create extreme drag in the thermal view
        const spoilerGeo = new THREE.BoxGeometry(1.2, 0.8, 0.1);
        const spoiler = new THREE.Mesh(spoilerGeo, bodyMat);
        spoiler.position.set(0, 2.0, -1.8);
        spoiler.userData.isCarPaint = true; spoiler.userData.originalMat = bodyMat;
        
        group.add(mesh); group.add(spoiler);
      }
      
      finalizeLoad(group);
      return;
    }

    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('loading-text').textContent = `Loading ${vehicle.name}...`;
    document.getElementById('progress-bar').style.width = '0%';
    
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

// TV Camera controls for Aero
window.setAeroCamera = function(pos) {
  if (pos === 'top') gsap.to(camera.position, { x: 0, y: 12, z: 0.1, duration: 1.5 });
  if (pos === 'bottom') gsap.to(camera.position, { x: 0, y: -2, z: 0.1, duration: 1.5 });
  if (pos === 'left') gsap.to(camera.position, { x: -10, y: 1, z: 0, duration: 1.5 });
  if (pos === 'right') gsap.to(camera.position, { x: 10, y: 1, z: 0, duration: 1.5 });
  if (pos === 'front') gsap.to(camera.position, { x: 0, y: 1.5, z: 12, duration: 1.5 });
  if (pos === 'back') gsap.to(camera.position, { x: 0, y: 1.5, z: -12, duration: 1.5 });
  if (pos === 'isometric') gsap.to(camera.position, { x: 8, y: 4, z: 8, duration: 1.5 });
  if (pos === 'isometric-rear') gsap.to(camera.position, { x: -8, y: 4, z: -8, duration: 1.5 });
};

function resetSceneDefaults() {
  isAeroLab = false; isThermal = false; isWindPro = false;
  windInstanced.visible = false;
  if(windProParticles) windProParticles.visible = false;
  controls.enabled = true;
  scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#111216');
  if (appState.currentModel) appState.currentModel.traverse((c) => { if (c.isMesh && c.userData.originalMat) c.material = c.userData.originalMat; });
}

function setupNav() {
  // Bind globally so HTML onClick works perfectly
  window.goHome = goHome;
  document.querySelectorAll('.btn-go-home').forEach(btn => btn.onclick = goHome);
  document.getElementById('btn-home').onclick = goHome;
  
  document.getElementById('btn-back-brands').onclick = () => selectIntent(appState.intent);
  document.getElementById('btn-library-back').onclick = () => selectIntent('library');
  
  document.getElementById('btn-thermal').onclick = () => {
    isThermal = !isThermal;
    if (appState.currentModel) appState.currentModel.traverse((c) => { if (c.isMesh && c.userData.originalMat) c.material = isThermal ? thermalMaterial : c.userData.originalMat; });
  };
  
  const toggleTheme = () => {
    isLightMode = !isLightMode; document.body.classList.toggle('light-mode');
    if (!isAeroLab) scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#111216');
  };
  
  document.getElementById('global-theme-toggle').onclick = toggleTheme;
  document.getElementById('nav-theme-toggle').onclick = toggleTheme;
}

const dummy = new THREE.Object3D();
const carBox = new THREE.Box3();
const carCenter = new THREE.Vector3();
const carSize = new THREE.Vector3();

function animate() {
  if (isAeroLab && windInstanced) {
    const spd = document.getElementById('wind-speed').value / 50;
    const vels = windInstanced.userData.velocities;
    
    // Compute bounding box of current car if it exists
    if (appState.currentModel) {
      carBox.setFromObject(appState.currentModel);
      carBox.getCenter(carCenter);
      carBox.getSize(carSize);
    }

    for (let i = 0; i < windCount; i++) {
      windInstanced.getMatrixAt(i, dummy.matrix); dummy.position.setFromMatrixPosition(dummy.matrix);
      
      // Move forward
      dummy.position.z -= vels[i] * spd;
      
      // Fake CFD / Aero Deflection
      if (appState.currentModel) {
        if (dummy.position.z > carBox.min.z - 4 && dummy.position.z < carBox.max.z + 2) {
          const distX = dummy.position.x - carCenter.x;
          const distY = dummy.position.y - carCenter.y;
          const effectiveWidth = carSize.x/2 + 0.3;
          const effectiveHeight = carSize.y/2 + 0.3;
          
          if (Math.abs(distX) < effectiveWidth && Math.abs(distY) < effectiveHeight && dummy.position.y > 0.05) {
            // Very smooth contouring formula: the closer to the center, the harder the push
            const intensity = Math.pow(1.0 - (Math.abs(distX) / effectiveWidth), 2.0);
            
            // Push gently sideways
            dummy.position.x += (distX > 0 ? 1 : -1) * (0.05 * spd * intensity);
            
            // Push UP over the windshield/roof, mimicking laminar flow
            if (distY > -0.2) {
                // If it's hitting the front windshield (Z is high), push UP
                if (dummy.position.z > carCenter.z) {
                    dummy.position.y += 0.15 * spd * intensity;
                } else {
                    // It's over the roof, maintain height or drop slightly
                    dummy.position.y -= 0.01 * spd;
                }
            } else if (dummy.position.y > 0.1) {
                // Going under the car
                dummy.position.y -= 0.05 * spd;
            }
          }
        }
      } else {
        if (dummy.position.z > -3 && dummy.position.z < 3 && dummy.position.y < 1.8) dummy.position.y += 0.05 * spd;
        else if (dummy.position.z < -3 && dummy.position.y > 0.1) dummy.position.y -= 0.03 * spd;
      }

      if (dummy.position.z < -15) dummy.position.set((Math.random() - 0.5) * 8, Math.random() * 4.0 + 0.1, 10 + Math.random() * 20);
      dummy.updateMatrix(); windInstanced.setMatrixAt(i, dummy.matrix);
    }
    windInstanced.instanceMatrix.needsUpdate = true;
  }
  
  if (isWindPro && windProParticles) {
    const spd = document.getElementById('wind-speed').value / 50;
    const vels = windProParticles.userData.velocities;
    
    if (appState.currentModel) {
      carBox.setFromObject(appState.currentModel);
      carBox.getCenter(carCenter);
      carBox.getSize(carSize);
    }
    
    for (let i = 0; i < windProCount; i++) {
      windProParticles.getMatrixAt(i, dummy.matrix); dummy.position.setFromMatrixPosition(dummy.matrix);
      dummy.position.z -= vels[i] * spd * 1.5;
      
      let speedFactor = 0; // for coloring
      if (appState.currentModel) {
        if (dummy.position.z > carBox.min.z - 2 && dummy.position.z < carBox.max.z + 1.5) {
          const distX = dummy.position.x - carCenter.x;
          const distY = dummy.position.y - carCenter.y;
          const effectiveWidth = carSize.x/2 + 0.2;
          const effectiveHeight = carSize.y/2 + 0.2;
          
          if (Math.abs(distX) < effectiveWidth && Math.abs(distY) < effectiveHeight && dummy.position.y > 0.02) {
            const intensity = Math.pow(1.0 - (Math.abs(distX) / effectiveWidth), 2.0);
            speedFactor = intensity;
            
            dummy.position.x += (distX > 0 ? 1 : -1) * (0.08 * spd * intensity);
            
            if (distY > -0.2) {
                if (dummy.position.z > carCenter.z) dummy.position.y += 0.2 * spd * intensity;
                else dummy.position.y -= 0.01 * spd;
            } else if (dummy.position.y > 0.05) {
                dummy.position.y -= 0.08 * spd;
            }
          }
        }
      }
      
      // Color from blue (slow/laminar) to red (fast/turbulent deflection)
      const color = new THREE.Color();
      color.setHSL((1.0 - speedFactor) * 0.6, 1.0, 0.5); // 0.6 = blue, 0.0 = red
      windProParticles.setColorAt(i, color);

      if (dummy.position.z < -10) dummy.position.set((Math.random() - 0.5) * 4, Math.random() * 2.0 + 0.1, 5 + Math.random() * 15);
      dummy.updateMatrix(); windProParticles.setMatrixAt(i, dummy.matrix);
    }
    windProParticles.instanceMatrix.needsUpdate = true;
    if(windProParticles.instanceColor) windProParticles.instanceColor.needsUpdate = true;
  }
  
  if (appState.intent === 'showroom' && appState.currentModel) {
    appState.currentModel.rotation.y += 0.003;
  }

  controls.update(); renderer.render(scene, camera); window.requestAnimationFrame(animate);
}
animate(); init();
