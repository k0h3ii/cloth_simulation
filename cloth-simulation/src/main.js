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
const Nx = 30;
const Ny = 30;
const mass = 0.1;
const dist = (2 * Math.PI * outerRadius) / Nx;

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

// Create constraints between particles
function createConstraints() {
    for (let i = 0; i < Nx; i++) {
        for (let j = 0; j < Ny + 1; j++) {
            // Horizontal constraints (including wrap-around)
            const nextI = (i + 1) % Nx;
            const constraint = new CANNON.DistanceConstraint(
                particles[i][j],
                particles[nextI][j],
                dist
            );
            constraint.collideConnected = true;
            constraints.push(constraint);
            world.addConstraint(constraint);

            // Vertical constraints
            if (j < Ny) {
                const constraint = new CANNON.DistanceConstraint(
                    particles[i][j],
                    particles[i][j + 1],
                    dist
                );
                constraint.collideConnected = true;
                constraints.push(constraint);
                world.addConstraint(constraint);
            }
            
            // Diagonal constraints
            if (j < Ny) {
                const diagonalDist = dist * Math.sqrt(2);
                
                // Forward diagonal
                const shearConstraint1 = new CANNON.DistanceConstraint(
                    particles[i][j],
                    particles[nextI][j + 1],
                    diagonalDist
                );
                shearConstraint1.collideConnected = true;
                constraints.push(shearConstraint1);
                world.addConstraint(shearConstraint1);
                
                // Backward diagonal
                const prevI = (i - 1 + Nx) % Nx;
                const shearConstraint2 = new CANNON.DistanceConstraint(
                    particles[i][j],
                    particles[prevI][j + 1],
                    diagonalDist
                );
                shearConstraint2.collideConnected = true;
                constraints.push(shearConstraint2);
                world.addConstraint(shearConstraint2);
            }
        }
    }
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 50);

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
scene.add(ambientLight, pointLight);

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
    side: THREE.DoubleSide
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
    clothColor: '#ff6347',
    innerColor: '#444444',
    wireframe: true,
    gravity: -9.81,
    damping: 0.5,
    stiffness: 1000,
    relaxation: 3,
    clothOpacity: 0.8,
    friction: 0.5,
    restitution: 0.0,
    preset: 'normal',
    tubeHeight: cylinderHeight,
    innerRadius: innerRadius,
    innerHeight: cylinderHeight
};

gui.addColor(options, 'clothColor').onChange(function(e) {
    clothMesh.material.color.set(e);
});

gui.addColor(options, 'innerColor').onChange(function(e) {
    innerCylinderMesh.material.color.set(e);
});

gui.add(options, 'wireframe').onChange(function(e) {
    wireframe.visible = e;
});

gui.add(options, 'gravity', -20, 0).onChange(function(e) {
    world.gravity.y = e;
});

gui.add(options, 'damping', 0, 1).onChange(function(e) {
    particles.forEach(row => {
        row.forEach(particle => {
            particle.linearDamping = e;
        });
    });
});

gui.add(options, 'stiffness', 0, 50000).onChange(function(e) {
    constraints.forEach(constraint => {
        constraint.stiffness = e;
    });
});

gui.add(options, 'relaxation', 0, 10).onChange(function(e) {
    constraints.forEach(constraint => {
        constraint.relaxation = e;
    });
});

gui.add(options, 'clothOpacity', 0, 1).onChange(function(e) {
    clothMesh.material.opacity = e;
});

gui.add(options, 'friction', 0, 1).onChange(function(e) {
    contactMaterial.friction = e;
});

gui.add(options, 'restitution', 0, 1).onChange(function(e) {
    contactMaterial.restitution = e;
});

gui.add(options, 'preset', ['soft', 'normal', 'rigid']).onChange(function(e) {
    switch(e) {
        case 'soft':
            options.stiffness = 100;
            options.relaxation = 2;
            break;
        case 'normal':
            options.stiffness = 1000;
            options.relaxation = 4;
            break;
        case 'rigid':
            options.stiffness = 3000;
            options.relaxation = 8;
            break;
    }
    
    constraints.forEach(constraint => {
        constraint.stiffness = options.stiffness;
        constraint.relaxation = options.relaxation;
    });
    
    for (let controller of gui.__controllers) {
        controller.updateDisplay();
    }
});

gui.add(options, 'tubeHeight', 10, cylinderHeight * 1.2).onChange(function(e) {
  updateTopBoundaryHeight(e);
});

gui.add(options, 'innerRadius', 0.5, outerRadius - 1).onChange(function(e) {
  innerRadius = e;
  updateInnerCylinder(innerRadius, options.innerHeight);
});

gui.add(options, 'innerHeight', 10, cylinderHeight * 1.5).onChange(function(e) {
  cylinderHeight = e;
  updateInnerCylinder(options.innerRadius, cylinderHeight);
});


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
  
  renderer.render(scene, camera);
  controls.update();
}

animate();