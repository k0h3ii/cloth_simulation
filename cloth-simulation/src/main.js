import './style.css'
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import * as dat from 'dat.gui';
import * as CANNON from 'cannon-es';

const outerRadius = 5;
let innerRadius = 3.5;
let Nx = 20;
let Ny = 20;
let cylinderHeight = 40;

const options = {
  // Appearance
  clothColor: '#ff6347',
  innerColor: '#444444',
  wireframe: true,
  clothOpacity: 0.8,
  innerOpacity: 1.0,
  
  // Physics
  mass: 1.0,
  gravity: -35,
  damping: 0.5,
  relaxation: 3,
  friction: 0.5,
  restitution: 0.0,
  
  // Geometry
  crushTube: cylinderHeight,
  innerRadius: innerRadius,
  innerHeight: cylinderHeight,
  heightSegments: Ny,
  radiusSegments: Nx,
  
  // Lighting
  dirLight: {
      on: true,
      intensity: 5,
      position: {
          x: 0,
          y: 20,
          z: 10
      }
  },
  
  heatmap: {
    enabled: false,
    minColor: '#0000ff',  // Blue for minimum bending
    maxColor: '#ff0000',  // Red for maximum bending
    scale: 1.0
},

  // Actions
  reset: function() {
      resetClothSimulation(options.radiusSegments, options.heightSegments);
  }
};

// Physics world setup
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.81, 0)
});
world.solver.iterations = 20;
world.defaultContactMaterial.contactEquationRelaxation = 3;

// Materials
const particleMaterial = new CANNON.Material('particle');
const cylinderMaterial = new CANNON.Material('cylinder');

const contactMaterial = new CANNON.ContactMaterial(particleMaterial, cylinderMaterial, {
    friction: 0.5,
    restitution: 0.0,
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


// Function to update inner cylinder
function updateInnerCylinder(radius, height) {
  world.removeBody(cylinderBody);
  
  // Create new cylinder shape and body
  const newCylinderShape = new CANNON.Cylinder(radius, radius, height, 16);
  cylinderBody.shapes = [newCylinderShape];
  cylinderBody.position.y = height/2;
  
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
const cylinderShape = new CANNON.Cylinder(innerRadius + 0.1, innerRadius + 0.1, cylinderHeight, 32);
const cylinderBody = new CANNON.Body({
  mass: 0,
  material: cylinderMaterial,
  shape: cylinderShape,
  position: new CANNON.Vec3(0, cylinderHeight/2, 0)
});
world.addBody(cylinderBody);

// Cloth parameters
let dist = (2 * Math.PI * outerRadius) / Nx;

let constraints = [];
const particleRadius = 0.2;
const particleShape = new CANNON.Sphere(particleRadius);
const particles = [];
let topParticles = []; // top boundary

// Create a cylindrical grid of particles
function createCylindricalGrid() {
  for (let i = 0; i < Nx; i++) {
      particles.push([]);
      for (let j = 0; j < Ny + 1; j++) {
          const angle = (i / Nx) * Math.PI * 2;
          const height = (j / Ny) * cylinderHeight;

          const particle = new CANNON.Body({
              mass: j === Ny ? 0 : options.mass, // make top row particles static
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

          // top boundary particles
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
      particle.velocity.set(0, 0, 0); 
  });
}

function removeExistingCloth() {
  particles.forEach(row => {
      row.forEach(particle => {
          world.removeBody(particle);
      });
  });
  
  constraints.forEach(constraint => {
      world.removeConstraint(constraint);
  });
  
if (heatmapQuad) {
  orthoScene.remove(heatmapQuad);
  heatmapQuad.geometry.dispose();
  heatmapQuad.material.dispose();
}

  if (heatmapTexture) {
      heatmapTexture.dispose();
  }

  if (clothGeo.attributes.bending) {
      clothGeo.deleteAttribute('bending');
  }
  
  particles.length = 0;
  constraints.length = 0;
  topParticles.length = 0;
}

function resetClothSimulation(newNx, newNy) {
  // Remove existing cloth
  removeExistingCloth();
  
  Nx = newNx;
  Ny = newNy;
  
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

  if (options.heatmap.enabled) {
    if (heatmapQuad) {
        orthoScene.remove(heatmapQuad);
    }
    
    // Create new heatmap setup
    const heatmapSetup = setupHeatmap(Nx, Ny);
    heatmapTexture = heatmapSetup.texture;
    heatmapQuad = heatmapSetup.quad;
    
    // Add new heatmap quad to scene
    orthoScene.add(heatmapQuad);
    heatmapQuad.visible = true;
    
    // Switch to heatmap material
    heatmapClothMat = createHeatmapMaterial(options);
    clothMesh.material = heatmapClothMat;
    
    // Initialize bending values
    const bendingAttr = new Float32Array(Nx * (Ny + 1));
    clothGeo.setAttribute('bending', new THREE.BufferAttribute(bendingAttr, 1));
    
    // Calculate initial bending values
    calculateBending(clothGeo, outerRadius, Nx, Ny);
} else {
    clothMesh.material = standardClothMat;
}
gui.updateDisplay();
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
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(lightSphere);

    if (intersects.length > 0) {
        controls.enabled = false; 
        isDragging = true;
        selectedObject = lightSphere;

        const normal = camera.getWorldDirection(new THREE.Vector3());
        dragPlane.setFromNormalAndCoplanarPoint(
            normal,
            selectedObject.position
        );
    }
}

function onMouseMove(event) {
    if (!isDragging || !selectedObject) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        selectedObject.position.copy(intersection);
        
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
    controls.enabled = true; 
}


// Ground
const groundGeo = new THREE.PlaneGeometry(30, 30);
const groundMat = new THREE.MeshStandardMaterial({
    color: 0x393939,
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

const orthoScene = new THREE.Scene();
const orthoCamera = new THREE.OrthographicCamera(
    -window.innerWidth/2, window.innerWidth/2,
    window.innerHeight/2, -window.innerHeight/2,
    0.1, 10
);
orthoCamera.position.z = 1;

function setupHeatmap(Nx, Ny) {
  const heatmapWidth = Nx;
  const heatmapHeight = Ny + 1;
  const heatmapSize = heatmapWidth * heatmapHeight;
  const heatmapData = new Float32Array(heatmapSize);
  
  // Create heatmap texture with filtering
  const heatmapTexture = new THREE.DataTexture(
      heatmapData,
      heatmapWidth,
      heatmapHeight,
      THREE.RedFormat,
      THREE.FloatType
  );
  // Enable texture interpolation
  heatmapTexture.minFilter = THREE.LinearFilter;
  heatmapTexture.magFilter = THREE.LinearFilter;
  heatmapTexture.needsUpdate = true;

  // Create 2D heatmap visualization
  const heatmapDisplaySize = 300;
  const heatmapQuadGeo = new THREE.PlaneGeometry(heatmapDisplaySize, heatmapDisplaySize);
  const heatmapQuadMat = new THREE.ShaderMaterial({
      uniforms: {
          heatmapTexture: { value: heatmapTexture },
          opacity: { value: options.clothOpacity },
          textureSize: { value: new THREE.Vector2(heatmapWidth, heatmapHeight) }
      },
      vertexShader: `
          varying vec2 vUv;
          void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
      `,
      fragmentShader: `
          uniform sampler2D heatmapTexture;
          uniform float opacity;
          uniform vec2 textureSize;
          varying vec2 vUv;

          vec3 hsv2rgb(vec3 c) {
              vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
              vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
              return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          // Cubic interpolation function
          float cubicInterpolation(float v0, float v1, float v2, float v3, float t) {
              float a0 = v3 - v2 - v0 + v1;
              float a1 = v0 - v1 - a0;
              float a2 = v2 - v0;
              float a3 = v1;
              return a0 * t * t * t + a1 * t * t + a2 * t + a3;
          }

          // Sample texture with bicubic interpolation
          float sampleBicubic(sampler2D tex, vec2 uv) {
              vec2 texSize = textureSize;
              vec2 texelSize = 1.0 / texSize;
              
              // Get texture coordinates
              vec2 texCoord = uv * texSize - 0.5;
              vec2 fxy = fract(texCoord);
              texCoord = floor(texCoord) * texelSize;

              // Sample 16 nearest texels
              float p[16];
              for(int y = -1; y <= 2; y++) {
                  for(int x = -1; x <= 2; x++) {
                      vec2 offset = vec2(float(x), float(y)) * texelSize;
                      vec2 sampleCoord = texCoord + offset;
                      // Apply wrapping for cylindrical texture
                      sampleCoord.x = fract(sampleCoord.x);
                      sampleCoord.y = clamp(sampleCoord.y, 0.0, 1.0);
                      p[(y+1)*4 + (x+1)] = texture2D(tex, sampleCoord).r;
                  }
              }

              // Interpolate
              float y0 = cubicInterpolation(p[0], p[1], p[2], p[3], fxy.x);
              float y1 = cubicInterpolation(p[4], p[5], p[6], p[7], fxy.x);
              float y2 = cubicInterpolation(p[8], p[9], p[10], p[11], fxy.x);
              float y3 = cubicInterpolation(p[12], p[13], p[14], p[15], fxy.x);

              return cubicInterpolation(y0, y1, y2, y3, fxy.y);
          }

          void main() {
              // Use bicubic sampling instead of direct texture lookup
              float value = sampleBicubic(heatmapTexture, vUv);
              
              vec3 hsvColor = vec3(
                  (1.0 - value) * 0.6,
                  0.8,
                  mix(0.7, 1.0, value)
              );
              vec3 color = hsv2rgb(hsvColor);
              gl_FragColor = vec4(color, opacity);
          }
      `,
      transparent: true
  });

  const heatmapQuad = new THREE.Mesh(heatmapQuadGeo, heatmapQuadMat);
  heatmapQuad.position.set(
      -window.innerWidth/2 + heatmapDisplaySize/2 + 20, 
      window.innerHeight/2 - heatmapDisplaySize/2 - 20, 
      -1
  );
  heatmapQuad.visible = false;

  return {
      texture: heatmapTexture,
      quad: heatmapQuad
  };
}

// Create heatmap material
function createHeatmapMaterial(options) {
  return new THREE.ShaderMaterial({
      uniforms: {
          minColor: { value: new THREE.Color(options.heatmap.minColor) },
          maxColor: { value: new THREE.Color(options.heatmap.maxColor) },
          useHeatmap: { value: true },
          opacity: { value: options.clothOpacity },
          scale: { value: options.heatmap.scale }
      },
      vertexShader: `
          attribute float bending;
          varying float vBending;
          uniform float scale;
          void main() {
              vBending = bending * scale;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
      `,
      fragmentShader: `
          uniform vec3 minColor;
          uniform vec3 maxColor;
          uniform float opacity;
          varying float vBending;

          vec3 hsv2rgb(vec3 c) {
              vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
              vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
              return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          void main() {
              float value = clamp(vBending, 0.0, 1.0);
              vec3 hsvColor = vec3(
                  (1.0 - value) * 0.6,
                  0.8,
                  mix(0.7, 1.0, value)
              );
              vec3 color = hsv2rgb(hsvColor);
              gl_FragColor = vec4(color, opacity);
          }
      `,
      side: THREE.DoubleSide,
      transparent: true
  });
}

let heatmapTexture;
let heatmapQuad;
let heatmapClothMat;

const standardClothMat = new THREE.MeshStandardMaterial({
  color: options.clothColor,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: options.clothOpacity,
  wireframe: false
});

// Add bending attribute to geometry
const bendingAttr = new Float32Array(Nx * (Ny + 1));
clothGeo.setAttribute('bending', new THREE.BufferAttribute(bendingAttr, 1));

// Function to calculate bending values
function calculateBending(clothGeo, outerRadius, Nx, Ny, heatmapTexture) {
  if (!options.heatmap.enabled) return;

  const positions = clothGeo.attributes.position.array;
  const bendingValues = new Float32Array(Nx * (Ny + 1));
  
  // Calculate local curvature for each vertex
  for (let i = 0; i < Nx; i++) {
      for (let j = 0; j < Ny + 1; j++) {
          const idx = j * Nx + i;
          const pos = new THREE.Vector3().fromArray(positions, idx * 3);
          
          // Get neighboring vertices with wrap-around for cylinder
          const prevI = (i - 1 + Nx) % Nx;
          const nextI = (i + 1) % Nx;
          const prevJ = Math.max(0, j - 1);
          const nextJ = Math.min(Ny, j + 1);
          
          const neighbors = [
              new THREE.Vector3().fromArray(positions, (j * Nx + prevI) * 3),
              new THREE.Vector3().fromArray(positions, (j * Nx + nextI) * 3),
              new THREE.Vector3().fromArray(positions, (prevJ * Nx + i) * 3),
              new THREE.Vector3().fromArray(positions, (nextJ * Nx + i) * 3)
          ];

          // Calculate curvature
          let curvature = calculateVertexCurvature(pos, neighbors, outerRadius);
          bendingValues[idx] = Math.min(1, Math.max(0, curvature));
      }
  }
  
  // Update geometry attribute and heatmap texture
  clothGeo.attributes.bending.array = bendingValues;
  clothGeo.attributes.bending.needsUpdate = true;
  heatmapTexture.image.data.set(bendingValues);
  heatmapTexture.needsUpdate = true;
}

// Helper function to calculate curvature for a single vertex
function calculateVertexCurvature(pos, neighbors, originalRadius) {
  const normal = new THREE.Vector3();
  
  // Calculate approximate normal
  for (let k = 0; k < neighbors.length; k++) {
      const v1 = neighbors[k].clone().sub(pos);
      const v2 = neighbors[(k + 1) % neighbors.length].clone().sub(pos);
  }

  // Calculate radial difference
  const currentRadius = new THREE.Vector3(pos.x, 0, pos.z).length();
  const radialDiff = Math.abs(currentRadius - originalRadius);
  
  // Calculate angle changes
  let angleChange = 0;
  for (let k = 0; k < neighbors.length; k++) {
      const v1 = neighbors[k].clone().sub(pos);
      const v2 = neighbors[(k + 1) % neighbors.length].clone().sub(pos);
      angleChange += v1.angleTo(v2);
  }

  // Combine radial difference and angle change
  return (radialDiff / originalRadius + (angleChange / (2 * Math.PI) - 1)) * 2;
}
  

const clothMesh = new THREE.Mesh(clothGeo, standardClothMat);
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

gui.add(options, 'crushTube', 10, cylinderHeight * 1.2).onChange(function(e) {
  updateTopBoundaryHeight(e);
});

// Appearance folder
const appearanceFolder = gui.addFolder('Appearance');
appearanceFolder.addColor(options, 'clothColor').onChange(function(e) {
    standardClothMat.color.set(e);
});
appearanceFolder.addColor(options, 'innerColor').onChange(function(e) {
    innerCylinderMesh.material.color.set(e);
});
appearanceFolder.add(options, 'wireframe').onChange(function(e) {
    wireframe.visible = e;
});
appearanceFolder.add(options, 'clothOpacity', 0, 1).onChange(function(e) {
  standardClothMat.opacity = e;
  heatmapClothMat.uniforms.opacity.value = e;
  requestAnimationFrame(() => radiusController.updateDisplay());
});
appearanceFolder.add(options, 'innerOpacity', 0, 1).onChange(function(e) {
  innerCylinderMesh.material.opacity = e;
});

// Physics folder
const physicsFolder = gui.addFolder('Physics');
physicsFolder.add(options, 'mass', 0.01, 1).onChange(function(e) {
  resetClothSimulation(options.radiusSegments, options.heightSegments);
});
physicsFolder.add(options, 'gravity', -100, 0).onChange(function(e) {
    world.gravity.y = e;
});
physicsFolder.add(options, 'damping', 0, 1).onChange(function(e) {
    particles.forEach(row => {
        row.forEach(particle => {
            particle.linearDamping = e;
        });
    });
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

// Geometry folder
const geometryFolder = gui.addFolder('Geometry');

geometryFolder.add(options, 'innerRadius', 0.5, outerRadius - 1).onChange(function(e) {
    innerRadius = e;
    updateInnerCylinder(innerRadius, options.innerHeight);
});
geometryFolder.add(options, 'innerHeight', 10, cylinderHeight * 1.5).onChange(function(e) {
    cylinderHeight = e;
    updateInnerCylinder(options.innerRadius, cylinderHeight);
});
const radiusController = geometryFolder.add(options, 'radiusSegments', 10, 30).step(1);
radiusController.domElement.addEventListener('mousedown', function() {
    radiusController.updateDisplay();
});
radiusController.onChange(function(value) {
    const intValue = Math.floor(value);
    resetClothSimulation(intValue, options.heightSegments);
    requestAnimationFrame(() => radiusController.updateDisplay());
});

const heightController = geometryFolder.add(options, 'heightSegments', 10, 30).step(1);
heightController.domElement.addEventListener('mousedown', function() {
    heightController.updateDisplay();
});
heightController.onChange(function(value) {
    const intValue = Math.floor(value);
    resetClothSimulation(options.radiusSegments, intValue);
    requestAnimationFrame(() => heightController.updateDisplay());
});

// Lighting folder
const lightingFolder = gui.addFolder('Lighting');
lightingFolder.add(options.dirLight, 'on').onChange(function(e) {
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

const heatmapFolder = gui.addFolder('Heat Map');
heatmapFolder.add(options.heatmap, 'enabled')
    .name('Show Heat Map')
    .onChange(function(value) {
        if (value) {
            // Switch to heatmap material
            if (!heatmapClothMat) {
                heatmapClothMat = createHeatmapMaterial(options);
            }
            clothMesh.material = heatmapClothMat;
            
            // Setup heatmap
                const heatmapSetup = setupHeatmap(Nx, Ny);
                heatmapTexture = heatmapSetup.texture;
                heatmapQuad = heatmapSetup.quad;
                orthoScene.add(heatmapQuad);

            if (heatmapQuad) {
                heatmapQuad.visible = true;
            }
            if (!clothGeo.attributes.bending) {
                const bendingAttr = new Float32Array(Nx * (Ny + 1));
                clothGeo.setAttribute('bending', new THREE.BufferAttribute(bendingAttr, 1));
            }
        } else {
            clothMesh.material = standardClothMat;
            if (heatmapQuad) {
                heatmapQuad.visible = false;
            }
        }
    });

heatmapFolder.add(options.heatmap, 'scale', 0.1, 5)
    .name('Sensitivity')
    .onChange(function(value) {
        heatmapClothMat.uniforms.scale.value = value;
    });


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

  if (options.heatmap.enabled) {
    calculateBending(clothGeo, outerRadius, Nx, Ny, heatmapTexture);
    renderer.autoClear = false;
    renderer.render(orthoScene, orthoCamera);
    renderer.autoClear = true;
}
  controls.update();
}

animate();