// The timeline's planet: the landing tour's Earth and sky (/assets/js/scene/planet.js), seen through
// an orthographic camera fitted to app.js's d3 projection, so everything app.js draws on the canvas
// above it (countries, flights, places) lands on the right pixel of the right coast.
//
// index.html loads this module at once: the planet turns slowly behind the password form, and
// app.js takes over the view when the data are open (its import('./globe.js') returns the same
// module, so the same planet). `planet` resolves to null without WebGL2; app.js then draws a flat
// globe of its own.

import * as THREE from 'three';
import { dotTexture, earthMaterial, atmosphere, stars, backdrop } from '/assets/js/scene/planet.js';

const DEG = Math.PI / 180;
// Light from the upper left, about 40 degrees off the line of sight, in camera axes: the face
// turned to the viewer is in daylight, and city lights show along the lower right limb.
const SUN_VIEW = new THREE.Vector3(-0.5, 0.38, 0.78).normalize();

const latLon = (lat, lon, out) => out.set(Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.sin(lat * DEG),
  -Math.cos(lat * DEG) * Math.sin(lon * DEG));

export const planet = create(document.getElementById('planet')).catch((err) => {
  console.info('[timeline] flat globe:', err.message || err);
  return null;
});

async function create(canvas) {
  if (!canvas || !document.createElement('canvas').getContext('webgl2')) throw new Error('no WebGL2');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x070b16, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  const big = renderer.capabilities.maxTextureSize >= 4096;
  const loader = new THREE.TextureLoader();
  const [dayTex, nightTex, skyTex] = await Promise.all([
    loader.loadAsync(`/assets/img/tex/${big ? 'earth-day-4k' : 'earth-day'}.jpg`),
    loader.loadAsync('/assets/img/tex/earth-night.jpg'),
    loader.loadAsync('/assets/img/tex/sky.webp').catch(() => null),
  ]);
  for (const t of [dayTex, nightTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  // The sky, through a perspective camera at the centre that turns with the view, so the stars
  // wheel past as the globe turns, as they do on the landing page.
  const res = new THREE.Vector2(1, 1), at = new THREE.Vector2(0.5, 0.5);
  const skyScene = new THREE.Scene();
  const skyCam = new THREE.PerspectiveCamera(45, 1, 1, 4000);
  skyScene.add(...backdrop({ res, edge: { value: 0 }, at, skyTex }), ...stars(dotTexture()));

  // The Earth, through an orthographic camera: one Earth radius is R pixels, the centre at (cx, cy).
  const sunDir = new THREE.Vector3();
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), earthMaterial(dayTex, nightTex, sunDir)), atmosphere(sunDir));

  let W = 0, H = 0;
  function resize(w, h, dpr) {
    if (w === W && h === H && dpr === renderer.getPixelRatio()) return;
    W = w; H = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(res);
    skyCam.aspect = w / h;
    skyCam.updateProjectionMatrix();
  }

  /** Draw the planet as d3.geoOrthographic().rotate([-lon, -lat]).scale(R).translate([cx, cy]) sees it. */
  function draw(center, R, cx, cy) {
    latLon(center[1], center[0], cam.position).multiplyScalar(100);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.left = -cx / R; cam.right = (W - cx) / R;
    cam.top = cy / R; cam.bottom = -(H - cy) / R;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    sunDir.copy(SUN_VIEW).applyQuaternion(cam.quaternion);
    skyCam.quaternion.copy(cam.quaternion);
    skyCam.updateMatrixWorld();
    at.set(cx / W, cy / H);
    renderer.clear();
    renderer.render(skyScene, skyCam);
    renderer.render(scene, cam);
    canvas.classList.add('ready');
  }

  // Until app.js takes over (behind the password form): the whole Earth, turning slowly.
  let idle = 0;
  const spin = (now) => {
    idle = requestAnimationFrame(spin);
    resize(innerWidth, innerHeight, Math.min(1.75, devicePixelRatio || 1));
    draw([-20 + now * 0.002, 12], Math.min(W, H) * 0.34, W / 2, H / 2);
  };
  idle = requestAnimationFrame(spin);

  return {
    resize,
    draw,
    /** Stop the idle spin; from now on the caller draws every frame. */
    take() { cancelAnimationFrame(idle); },
  };
}
