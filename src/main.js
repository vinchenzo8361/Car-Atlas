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
  intent: 'home' 
};

// Extremely robust hardcoded logo map (WorldVectorLogo CDNs)
const logoMap = {
  "Porsche": "https://cdn.worldvectorlogo.com/logos/porsche-6.svg",
  "McLaren": "https://cdn.worldvectorlogo.com/logos/mclaren-4.svg",
  "Ferrari": "https://cdn.worldvectorlogo.com/logos/ferrari-ges.svg",
  "Lamborghini": "https://cdn.worldvectorlogo.com/logos/lamborghini-1.svg",
  "Audi": "https://cdn.worldvectorlogo.com/logos/audi-11.svg",
  "Bugatti": "https://cdn.worldvectorlogo.com/logos/bugatti-logo.svg",
  "Nissan": "https://cdn.worldvectorlogo.com/logos/nissan-6.svg",
  "BMW": "https://cdn.worldvectorlogo.com/logos/bmw.svg",
  "Mercedes": "https://cdn.worldvectorlogo.com/logos/mercedes-benz-9.svg",
  "Koenigsegg": "https://cdn.worldvectorlogo.com/logos/koenigsegg.svg",
  "Aston Martin": "https://cdn.worldvectorlogo.com/logos/aston-martin-1.svg",
  "Chevrolet": "https://cdn.worldvectorlogo.com/logos/chevrolet-1.svg",
  "Toyota": "https://cdn.worldvectorlogo.com/logos/toyota-4.svg",
  "Dodge": "https://cdn.worldvectorlogo.com/logos/dodge-2.svg",
  "Formula 1": "https://cdn.worldvectorlogo.com/logos/f1-2.svg"
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

function activateAeroModeLogic() {
  isAeroLab = true; windInstanced.visible = true; 
  // FIX: Explicitly keep controls enabled in Aero Mode so user can move mouse!
  controls.enabled = true; 
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
  isAeroLab = false; isThermal = false;
  windInstanced.visible = false;
  controls.enabled = true;
  scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
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
  document.getElementById('btn-theme-toggle').onclick = () => {
    isLightMode = !isLightMode; document.body.classList.toggle('light-mode');
    if (!isAeroLab) scene.background = isLightMode ? new THREE.Color('#e0e5ec') : new THREE.Color('#050505');
  };
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
        // Only deflect if particle is near the car on the Z axis
        if (dummy.position.z > carBox.min.z - 2 && dummy.position.z < carBox.max.z + 1) {
          const distX = dummy.position.x - carCenter.x;
          const distY = dummy.position.y - carCenter.y;
          
          // If inside the cross-section width/height
          if (Math.abs(distX) < carSize.x/2 + 0.5 && Math.abs(distY) < carSize.y/2 + 0.5 && dummy.position.y > 0.1) {
            // Push outwards depending on which quadrant they are in
            const pushFactor = 0.08 * spd;
            dummy.position.x += (distX > 0 ? 1 : -1) * pushFactor * (1.0 - Math.abs(distX)/carSize.x);
            // Push up over the roof or down under the chassis
            if (distY > 0) dummy.position.y += pushFactor;
            else if (dummy.position.y > 0.1) dummy.position.y -= pushFactor * 0.5;
          }
        }
      } else {
        // Default wavy motion if no car
        if (dummy.position.z > -3 && dummy.position.z < 3 && dummy.position.y < 1.8) dummy.position.y += 0.05 * spd;
        else if (dummy.position.z < -3 && dummy.position.y > 0.1) dummy.position.y -= 0.03 * spd;
      }

      // Reset particles when they go too far back
      if (dummy.position.z < -10) dummy.position.set((Math.random() - 0.5) * 4, Math.random() * 2.0 + 0.1, 10 + Math.random() * 5);
      
      dummy.updateMatrix(); windInstanced.setMatrixAt(i, dummy.matrix);
    }
    windInstanced.instanceMatrix.needsUpdate = true;
  }
  controls.update(); renderer.render(scene, camera); window.requestAnimationFrame(animate);
}
animate(); init();
