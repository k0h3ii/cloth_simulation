import './style.css'
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import * as dat from 'dat.gui';
import * as CANNON from 'cannon-es';

// Physics world setup
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.81, 0)
});
world.solver.iterations = 20;
world.defaultContactMaterial.contactEquationStiffness = 1e6;
world.defaultContactMaterial.contactEquationRelaxation = 3;

// Materials
const particleMaterial = new CANNON.Material('particle');
const cylinderMaterial = new CANNON.Material('cylinder');

const contactMaterial = new CANNON.ContactMaterial(particleMaterial, cylinderMaterial, {
    friction: 0.5,
    restitution: 0.0,
    contactEquationStiffness: 1e6,
    contactEquationRelaxation: 3
});
world.addContactMaterial(contactMaterial);

// Ground setup
const groundBody = new CANNON.Body({
    shape: new CANNON.Plane(),
    type: CANNON.Body.STATIC,
    position: new CANNON.Vec3(0, 0, 0)
});
world.addBody(groundBody);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);

// Cylinder dimensions
const outerRadius = 5;
let innerRadius = 1.5;
let cylinderHeight = 40;

// Function to update inner cylinder
function updateInnerCylinder(radius, height) {
  // Remove old cylinder body
  world.removeBody(cylinderBody);
  
  // Create new cylinder shape and body
  const newCylinderShape = new CANNON.Cylinder(radius, radius, height, 16);
  cylinderBody.shapes = [newCylinderShape];
  cylinderBody.position.y = height/2;
  
  // Add body back to world
  world.addBody(cylinderBody);
  
  // Update visual mesh
  scene.remove(innerCylinderMesh);
  const newCylinderGeo = new THREE.CylinderGeometry(radius, radius, height, 32);
  innerCylinderMesh.geometry.dispose();
  innerCylinderMesh.geometry = newCylinderGeo;
  innerCylinderMesh.position.y = height/2;
  scene.add(innerCylinderMesh);
}

// Modified cylinder body setup
const cylinderShape = new CANNON.Cylinder(innerRadius, innerRadius, cylinderHeight, 16);
const cylinderBody = new CANNON.Body({
  mass: 0,
  material: cylinderMaterial,
  shape: cylinderShape,
  position: new CANNON.Vec3(0, cylinderHeight/2, 0)
});
world.addBody(cylinderBody);

// Cloth parameters
let Nx = 30;
let Ny = 30;
const mass = 0.1;
let dist = (2 * Math.PI * outerRadius) / Nx;

let constraints = [];
const particleRadius = 0.2;
const particleShape = new CANNON.Sphere(particleRadius);
const particles = [];
let topParticles = []; // Array to store top boundary particles

// Create a cylindrical grid of particles
function createCylindricalGrid() {
  for (let i = 0; i < Nx; i++) {
      particles.push([]);
      for (let j = 0; j < Ny + 1; j++) {
          const angle = (i / Nx) * Math.PI * 2;
          const height = (j / Ny) * cylinderHeight;

          const particle = new CANNON.Body({
              mass: j === Ny ? 0 : mass, // Make top row particles static
              material: particleMaterial,
              shape: particleShape,
              position: new CANNON.Vec3(
                  outerRadius * Math.cos(angle),
                  height,
                  outerRadius * Math.sin(angle)
              )
          });
          
          particle.linearDamping = 0.5;
          particle.allowSleep = false;
          particles[i].push(particle);
          world.addBody(particle);

          // Store top boundary particles
          if (j === Ny) {
              topParticles.push(particle);
          }
      }
  }

  particles.push(particles[0]);
}

// Function to update top boundary height
function updateTopBoundaryHeight(height) {
  topParticles.forEach(particle => {
      const currentPos = particle.position;
      particle.position.set(currentPos.x, height, currentPos.z);
      particle.velocity.set(0, 0, 0); // Reset velocity
  });
}
function removeExistingCloth() {
  // Remove all particles from the world
  particles.forEach(row => {
      row.forEach(particle => {
          world.removeBody(particle);
      });
  });
  
  // Remove all constraints
  constraints.forEach(constraint => {
      world.removeConstraint(constraint);
  });
  
  // Clear arrays
  particles.length = 0;
  constraints.length = 0;
  topParticles.length = 0;
}

function resetClothSimulation(newNx, newNy) {
  // Remove existing cloth
  removeExistingCloth();
  
  // Update global variables
  Nx = newNx;
  Ny = newNy;
  
  // Recalculate distance between particles
  dist = (2 * Math.PI * outerRadius) / Nx;
  
  // Create new geometry
  const positions = new Float32Array(Nx * (Ny + 1) * 3);
  const indices = [];
  const uvs = new Float32Array(Nx * (Ny + 1) * 2);

  // Initialize vertex positions
  for (let i = 0; i < Nx; i++) {
      for (let j = 0; j < Ny + 1; j++) {
          const index = (j * Nx + i) * 3;
          const angle = (i / Nx) * Math.PI * 2;
          
          positions[index] = outerRadius * Math.cos(angle);
          positions[index + 1] = (j / Ny) * cylinderHeight;
          positions[index + 2] = outerRadius * Math.sin(angle);

          const uvIndex = (j * Nx + i) * 2;
          uvs[uvIndex] = i / Nx;
          uvs[uvIndex + 1] = j / Ny;
      }
  }

  // Create triangles with proper wrapping
  for (let i = 0; i < Nx; i++) {
      for (let j = 0; j < Ny; j++) {
          const current = j * Nx + i;
          const next = j * Nx + ((i + 1) % Nx);
          const bottom = ((j + 1) * Nx + i);
          const bottomNext = ((j + 1) * Nx + ((i + 1) % Nx));

          indices.push(current, bottomNext, bottom);
          indices.push(current, next, bottomNext);
      }
  }

  // Update geometry
  clothGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  clothGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  clothGeo.setIndex(indices);
  clothGeo.computeVertexNormals();

  // Create new cloth physics
  createCylindricalGrid();
  createConstraints();
}


// Create constraints between particles
function createConstraints() {
  const constraintOptions = {
      collideConnected: true
  };
  
  for (let i = 0; i < Nx; i++) {
      for (let j = 0; j < Ny + 1; j++) {
          // Horizontal constraints (including wrap-around)
          const nextI = (i + 1) % Nx;
          const constraint = new CANNON.DistanceConstraint(
              particles[i][j],
              particles[nextI][j],
              dist,
              constraintOptions
          );
          constraints.push(constraint);
          world.addConstraint(constraint);

          // Vertical constraints
          if (j < Ny) {
              const verticalConstraint = new CANNON.DistanceConstraint(
                  particles[i][j],
                  particles[i][j + 1],
                  dist,
                  constraintOptions
              );
              constraints.push(verticalConstraint);
              world.addConstraint(verticalConstraint);
          }
          
          // Diagonal constraints 
          if (j < Ny) {  
              const diagonalDist = dist * Math.sqrt(2);
              const shearConstraint = new CANNON.DistanceConstraint(
                  particles[i][j],
                  particles[nextI][j + 1],
                  diagonalDist,
                  constraintOptions
              );
              constraints.push(shearConstraint);
              world.addConstraint(shearConstraint);
          }
      }
  }
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 50, 100);

const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('#bg'),
    antialias: true
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// Lighting 
const pointLight = new THREE.PointLight(0xffffff, 10);
pointLight.position.set(10, 10, 10);
const ambientLight = new THREE.AmbientLight(0xffffff, 5);
const dirLight = new THREE.DirectionalLight(0xffffff, 5);
dirLight.position.set(0, 20, 10);
const dirLightHelper = new THREE.DirectionalLightHelper(dirLight);
scene.add(ambientLight, pointLight, dirLight, dirLightHelper);

const lightSphereGeo = new THREE.SphereGeometry(1, 16, 16);
const lightSphereMat = new THREE.MeshBasicMaterial({ 
    color: 0xffff00,
    transparent: true,
    opacity: 0.5
});
const lightSphere = new THREE.Mesh(lightSphereGeo, lightSphereMat);
lightSphere.position.copy(dirLight.position);
scene.add(lightSphere);

// Raycaster for mouse interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isDragging = false;
let selectedObject = null;
const dragPlane = new THREE.Plane();
const intersection = new THREE.Vector3();

// Mouse event handlers
window.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);

function onMouseDown(event) {
    // Calculate mouse position
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Check for intersection with light sphere
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(lightSphere);

    if (intersects.length > 0) {
        controls.enabled = false; // Disable orbit controls while dragging
        isDragging = true;
        selectedObject = lightSphere;

        // Create drag plane perpendicular to camera
        const normal = camera.getWorldDirection(new THREE.Vector3());
        dragPlane.setFromNormalAndCoplanarPoint(
            normal,
            selectedObject.position
        );
    }
}

function onMouseMove(event) {
    if (!isDragging || !selectedObject) return;

    // Update mouse position
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mouse, camera);

    // Find intersection with drag plane
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        // Move light sphere to intersection point
        selectedObject.position.copy(intersection);
        
        // Update directional light position
        dirLight.position.copy(intersection);
        dirLightHelper.update();

        // Update GUI values
        for (let controller of dirLightFolder.__controllers) {
            if (controller.property === 'x') {
                controller.setValue(intersection.x);
            } else if (controller.property === 'y') {
                controller.setValue(intersection.y);
            } else if (controller.property === 'z') {
                controller.setValue(intersection.z);
            }
        }
    }
}

function onMouseUp() {
    isDragging = false;
    selectedObject = null;
    controls.enabled = true; // Re-enable orbit controls
}


// Ground
const groundGeo = new THREE.PlaneGeometry(30, 30);
const groundMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    side: THREE.DoubleSide
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
scene.add(groundMesh);

// Inner rigid cylinder visual mesh
const innerCylinderGeo = new THREE.CylinderGeometry(innerRadius, innerRadius, cylinderHeight, 32);
const innerCylinderMat = new THREE.MeshStandardMaterial({
    color: 0x444444,
    side: THREE.DoubleSide,
    transparent: true
});
const innerCylinderMesh = new THREE.Mesh(innerCylinderGeo, innerCylinderMat);
innerCylinderMesh.position.y = cylinderHeight/2;
scene.add(innerCylinderMesh);

// Create cloth geometry
const clothGeo = new THREE.BufferGeometry();

// Create vertices
const positions = new Float32Array(Nx * (Ny + 1) * 3);
const indices = [];
const uvs = new Float32Array(Nx * (Ny + 1) * 2);

// Initialize vertex positions
for (let i = 0; i < Nx; i++) {
    for (let j = 0; j < Ny + 1; j++) {
        const index = (j * Nx + i) * 3;
        const angle = (i / Nx) * Math.PI * 2;
        
        positions[index] = outerRadius * Math.cos(angle);
        positions[index + 1] = (j / Ny) * cylinderHeight;
        positions[index + 2] = outerRadius * Math.sin(angle);

        const uvIndex = (j * Nx + i) * 2;
        uvs[uvIndex] = i / Nx;
        uvs[uvIndex + 1] = j / Ny;
    }
}

// Create triangles with proper wrapping
for (let i = 0; i < Nx; i++) {
    for (let j = 0; j < Ny; j++) {
        const current = j * Nx + i;
        const next = j * Nx + ((i + 1) % Nx);
        const bottom = ((j + 1) * Nx + i);
        const bottomNext = ((j + 1) * Nx + ((i + 1) % Nx));

        // First triangle
        indices.push(current);
        indices.push(bottomNext);
        indices.push(bottom);

        // Second triangle
        indices.push(current);
        indices.push(next);
        indices.push(bottomNext);
    }
}

clothGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
clothGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
clothGeo.setIndex(indices);
clothGeo.computeVertexNormals();

const clothMat = new THREE.MeshStandardMaterial({
    color: 0xFF6347, 
    side: THREE.DoubleSide,
    wireframe: false,
    transparent: true,
    opacity: 0.8
});

const clothMesh = new THREE.Mesh(clothGeo, clothMat);
scene.add(clothMesh);

// Wireframe
const wireGeo = new THREE.WireframeGeometry(clothGeo);
const wireMat = new THREE.LineBasicMaterial({color: 0xffffff});
const wireframe = new THREE.LineSegments(wireGeo, wireMat);
scene.add(wireframe);

// Create cloth grid and constraints
createCylindricalGrid();
createConstraints();

// Update geometry with particle positions
function updateParticles() {
    const positionAttribute = clothGeo.attributes.position;
    const positions = positionAttribute.array;
    
    for (let i = 0; i < Nx; i++) {
        for (let j = 0; j < Ny + 1; j++) {
            const index = (j * Nx + i) * 3;
            const particle = particles[i][j];
            
            positions[index] = particle.position.x;
            positions[index + 1] = particle.position.y;
            positions[index + 2] = particle.position.z;
        }
    }
    
    positionAttribute.needsUpdate = true;
    clothGeo.computeVertexNormals();
}

// Controls
const controls = new OrbitControls(camera, renderer.domElement);

// GUI
const gui = new dat.GUI();
const options = {
    // Appearance
    clothColor: '#ff6347',
    innerColor: '#444444',
    wireframe: true,
    clothOpacity: 0.8,
    innerOpacity: 1.0,
    
    // Physics
    gravity: -9.81,
    damping: 0.5,
    stiffness: 1e6,
    relaxation: 3,
    friction: 0.5,
    restitution: 0.0,
    preset: 'normal',
    
    // Geometry
    tubeHeight: cylinderHeight,
    innerRadius: innerRadius,
    innerHeight: cylinderHeight,
    heightSegments: Ny,
    radiusSegments: Nx,
    
    // Lighting
    dirLight: {
        visible: true,
        intensity: 5,
        position: {
            x: 0,
            y: 20,
            z: 10
        }
    },
    
    // Actions
    reset: function() {
        resetClothSimulation(options.radiusSegments, options.heightSegments);
    }
};


// Appearance folder
const appearanceFolder = gui.addFolder('Appearance');
appearanceFolder.addColor(options, 'clothColor').onChange(function(e) {
    clothMesh.material.color.set(e);
});
appearanceFolder.addColor(options, 'innerColor').onChange(function(e) {
    innerCylinderMesh.material.color.set(e);
});
appearanceFolder.add(options, 'wireframe').onChange(function(e) {
    wireframe.visible = e;
});
appearanceFolder.add(options, 'clothOpacity', 0, 1).onChange(function(e) {
    clothMesh.material.opacity = e;
});
appearanceFolder.add(options, 'innerOpacity', 0, 1).onChange(function(e) {
  innerCylinderMesh.material.opacity = e;
});
appearanceFolder.open();

// Physics folder
const physicsFolder = gui.addFolder('Physics');
physicsFolder.add(options, 'gravity', -20, 0).onChange(function(e) {
    world.gravity.y = e;
});
physicsFolder.add(options, 'damping', 0, 1).onChange(function(e) {
    particles.forEach(row => {
        row.forEach(particle => {
            particle.linearDamping = e;
        });
    });
});
physicsFolder.add(options, 'stiffness', 1e4, 1e7).onChange(function(e) {
    contactMaterial.contactEquationStiffness = e;
    world.defaultContactMaterial.contactEquationStiffness = e;
});
physicsFolder.add(options, 'relaxation', 1, 10).onChange(function(e) {
    contactMaterial.contactEquationRelaxation = e;
    world.defaultContactMaterial.contactEquationRelaxation = e;
});
physicsFolder.add(options, 'friction', 0, 1).onChange(function(e) {
    contactMaterial.friction = e;
});
physicsFolder.add(options, 'restitution', 0, 1).onChange(function(e) {
    contactMaterial.restitution = e;
});
physicsFolder.add(options, 'preset', ['soft', 'normal', 'rigid']).onChange(function(e) {
    switch(e) {
        case 'soft':
            options.stiffness = 1e4;
            options.relaxation = 3;
            break;
        case 'normal':
            options.stiffness = 1e6;
            options.relaxation = 3;
            break;
        case 'rigid':
            options.stiffness = 1e7;
            options.relaxation = 2;
            break;
    }
    
    contactMaterial.contactEquationStiffness = options.stiffness;
    world.defaultContactMaterial.contactEquationStiffness = options.stiffness;
    contactMaterial.contactEquationRelaxation = options.relaxation;
    world.defaultContactMaterial.contactEquationRelaxation = options.relaxation;
    
    // Update GUI display
    for (let controller of gui.__controllers) {
        controller.updateDisplay();
    }
});
physicsFolder.open();

// Geometry folder
const geometryFolder = gui.addFolder('Geometry');
geometryFolder.add(options, 'tubeHeight', 10, cylinderHeight * 1.2).onChange(function(e) {
    updateTopBoundaryHeight(e);
});
geometryFolder.add(options, 'innerRadius', 0.5, outerRadius - 1).onChange(function(e) {
    innerRadius = e;
    updateInnerCylinder(innerRadius, options.innerHeight);
});
geometryFolder.add(options, 'innerHeight', 10, cylinderHeight * 1.5).onChange(function(e) {
    cylinderHeight = e;
    updateInnerCylinder(options.innerRadius, cylinderHeight);
});
geometryFolder.add(options, 'radiusSegments', 10, 50).step(1).onChange(function(e) {
    resetClothSimulation(Math.floor(e), options.heightSegments);
});
geometryFolder.add(options, 'heightSegments', 10, 50).step(1).onChange(function(e) {
    resetClothSimulation(options.radiusSegments, Math.floor(e));
});
geometryFolder.open();

// Lighting folder
const lightingFolder = gui.addFolder('Lighting');
lightingFolder.add(options.dirLight, 'visible').onChange(function(e) {
    dirLight.visible = e;
    dirLightHelper.visible = e;
});
lightingFolder.add(options.dirLight, 'intensity', 0, 10).onChange(function(e) {
    dirLight.intensity = e;
});

const lightPositionFolder = lightingFolder.addFolder('Light Position');
lightPositionFolder.add(options.dirLight.position, 'x', -50, 50).onChange(function(e) {
    dirLight.position.x = e;
    dirLightHelper.update();
});
lightPositionFolder.add(options.dirLight.position, 'y', -50, 50).onChange(function(e) {
    dirLight.position.y = e;
    dirLightHelper.update();
});
lightPositionFolder.add(options.dirLight.position, 'z', -50, 50).onChange(function(e) {
    dirLight.position.z = e;
    dirLightHelper.update();
});
lightingFolder.add({ showLightSphere: true }, 'showLightSphere')
    .name('Show Light Control')
    .onChange(function(value) {
        lightSphere.visible = value && dirLight.visible;
    });
lightingFolder.open();

// Actions
gui.add(options, 'reset').name('Reset Simulation');

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  const timeStep = 1/120;
  world.step(timeStep);
  
  updateParticles();
  
  clothMesh.geometry.attributes.position.needsUpdate = true;
  wireframe.geometry = new THREE.WireframeGeometry(clothMesh.geometry);
  
  groundMesh.position.copy(groundBody.position);
  groundMesh.quaternion.copy(groundBody.quaternion);
  
  innerCylinderMesh.position.copy(cylinderBody.position);
  innerCylinderMesh.quaternion.copy(cylinderBody.quaternion);

  lightSphere.visible = dirLight.visible;
  
  renderer.render(scene, camera);
  controls.update();
}

animate();