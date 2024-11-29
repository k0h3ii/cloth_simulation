import './style.css'
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';

// scene, camera, renderer
const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight, 0.1,1000);

const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(30);

renderer.render(scene,camera);

// shapes
const geometry = new THREE.CylinderGeometry(5,5,20,32,32,true)
const material = new THREE.MeshStandardMaterial ({color:0xFF6347});
const cylinder = new THREE.Mesh(geometry,material);

scene.add(cylinder)

// lighting
const ambientLight = new THREE.AmbientLight(0xffffff);
scene.add(ambientLight)

// helper functions
const gridHelper = new THREE.GridHelper(200,50);
scene.add(gridHelper)

// controls
const controls = new OrbitControls(camera, renderer.domElement);

// animation loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
  controls.update();
}

animate()
