import './style.css'
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import * as dat from 'dat.gui';
import * as CANNON from 'cannon-es';

// Physics world
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.81, 0)
});

const groundBody = new CANNON.Body({
    shape: new CANNON.Plane(),
    type: CANNON.Body.STATIC
});
world.addBody(groundBody);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // Set a black background for visibility

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 50); // Adjusted camera position

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
    color: 0x888888, // Gray color for visibility
    side: THREE.DoubleSide
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
scene.add(groundMesh);

// Cylinder
const geometry = new THREE.CylinderGeometry(5, 5, 20, 32, 1, true);
const material = new THREE.MeshStandardMaterial({color: 0xFF6347});
const cylinder = new THREE.Mesh(geometry, material);
cylinder.position.y = 10; // Lift cylinder above ground
scene.add(cylinder);

// Helpers
const gridHelper = new THREE.GridHelper(200, 50);
scene.add(gridHelper);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Update physics
    world.step(1/60);
    
    groundMesh.position.copy(groundBody.position);
    groundMesh.quaternion.copy(groundBody.quaternion);
    
    renderer.render(scene, camera);
    controls.update();
}

animate();