// The landing tour: one three.js scene, four camera stops, from Mars down to one node.
//   0  Mars relays (DTN)            IPN-V dsn-network orbiters and rovers, real Earth-Mars direction
//   1  sparse IoT constellation     25 satellites, footprints, 520 sensors on land
//   2  mega-constellation mesh      72 x 22 shell with +grid laser links, live Lyon-Cordoba route
//   3  one compute node             five dawn-dusk shells of an orbital data-centre sample
// Units: one Earth radius. Distances between bodies are schematic; orbits are to scale.
// The clock starts at the real current time and runs TIME_SCALE times faster.

import * as THREE from 'three';
import { gmst, sunDirectionEci, marsDirectionEci, C_KMS } from '../astro.js';
import {
  RE_KM, RM_KM, MU_MARS, toScene, latLon, spinY, ssoInclination,
  circular, place, walker, keplerPosition, coverageAngle, greatCircleKm,
} from './orbits.js';
import { buildNode, skyEnvironment } from './node-model.js';

const TIME_SCALE = 60;
const MARS_DIST = 60;                 // schematic; the real distance is 10,000 to 60,000 Earth radii
const MARS_R = RM_KM / RE_KM;
const MARS_DAY = 88642.66;            // sidereal rotation [s]
const LYON = [45.76, 4.84], CORDOBA = [-31.42, -64.18];
const FIBRE_KMS = C_KMS / 1.468;      // light in glass
const COLORS = { dtn: 0xe8a541, iot: 0x5cc9a7, mega: 0x82e0d4, odc: 0xf2b84b, route: 0xffffff };
const Y = new THREE.Vector3(0, 1, 0);

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function createScene(canvas, { onLive = () => {}, onSlow = () => {} } = {}) {
  const small = matchMedia('(max-width: 760px)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x070b16, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 4000);
  const DOT = dotTexture();
  const pointsMat = (color, size, opacity = 1, extra = {}) => new THREE.PointsMaterial({
    color, size, sizeAttenuation: false, map: DOT, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, ...extra,
  });
  const lineMat = (color, opacity) => new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  const loader = new THREE.TextureLoader();
  const [dayTex, nightTex, marsTex, dsn, odc, sensorsLL] = await Promise.all([
    loader.loadAsync('/assets/img/tex/earth-day.jpg'),
    loader.loadAsync('/assets/img/tex/earth-night.jpg'),
    loader.loadAsync('/assets/img/tex/mars.jpg'),
    fetch('/data/dsn.json').then((r) => r.json()),
    fetch('/data/odc.json').then((r) => r.json()),
    fetch('/data/sensors.json').then((r) => r.json()),
  ]);
  for (const t of [dayTex, nightTex, marsTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  }

  // ---------------------------------------------------------------- clock and sun
  const start = Date.now();
  let simSeconds = 0;                                  // seconds since start, simulated
  const simDate = () => new Date(start + simSeconds * 1000);
  const sunDir = new THREE.Vector3();
  const updateSun = () => { const s = sunDirectionEci(simDate()); sunDir.set(s[0], s[2], -s[1]).normalize(); };
  updateSun();
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
  scene.add(sunLight, new THREE.AmbientLight(0x6f86b8, 0.22));

  // ---------------------------------------------------------------- stars
  {
    const make = (n, size, opacity) => {
      const p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 1500;
        p.set([r * Math.sqrt(1 - u * u) * Math.cos(th), r * u, r * Math.sqrt(1 - u * u) * Math.sin(th)], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      return new THREE.Points(g, pointsMat(0xc9d6ff, size, opacity));
    };
    scene.add(make(2600, 1.6, 0.55), make(500, 2.6, 0.8));
  }

  // ---------------------------------------------------------------- Earth
  const earth = new THREE.Group();
  scene.add(earth);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { dayMap: { value: dayTex }, nightMap: { value: nightTex }, sunDir: { value: sunDir } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        float d = dot(n, sunDir);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;
        vec3 lit = day * clamp(d * 1.15 + 0.08, 0.0, 1.0);
        vec3 lights = pow(night, vec3(1.6)) * vec3(1.0, 0.72, 0.42) * 2.2 * (1.0 - smoothstep(-0.12, 0.10, d));
        vec3 v = normalize(cameraPosition - vP);
        float rim = pow(1.0 - max(dot(v, n), 0.0), 3.0) * smoothstep(1.2, 2.2, length(cameraPosition));
        vec3 col = lit + lights + day * 0.018 + vec3(0.30, 0.55, 1.0) * rim * (0.15 + 0.6 * clamp(d + 0.35, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, small ? 128 : 192, small ? 96 : 128), earthMat);
  earth.add(earthMesh);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.025, 96, 64), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 v = normalize(cameraPosition - vP);
        float g = smoothstep(0.0, 0.22, -dot(v, normalize(vN)));
        float lit = 0.2 + 0.8 * smoothstep(-0.35, 0.45, dot(normalize(vN), sunDir));
        gl_FragColor = vec4(vec3(0.33, 0.58, 1.0) * g * lit * 0.9, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(atmosphere);
  const earthSpin = () => gmst(simDate());

  // Layers fade in and out with the active stop.
  const layers = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];
  layers.forEach((g) => scene.add(g));
  const fades = [1, 1, 1, 1];
  const setFade = (i, f) => {
    fades[i] = f;
    layers[i].visible = f > 0.01;
    layers[i].traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (m.userData.base === undefined) m.userData.base = m.opacity;
        m.opacity = m.userData.base * f;
      }
    });
  };

  // ---------------------------------------------------------------- 0: Mars relays
  const marsPos = v3((() => { const d = marsDirectionEci(simDate()); return [d[0], d[2], -d[1]]; })()).multiplyScalar(MARS_DIST);
  const mars = new THREE.Group();
  mars.position.copy(marsPos);
  scene.add(mars);
  const marsBody = new THREE.Mesh(new THREE.SphereGeometry(MARS_R, 96, 64), new THREE.MeshLambertMaterial({ map: marsTex }));
  mars.add(marsBody);
  const marsLayer = new THREE.Group();
  marsLayer.position.copy(marsPos);
  layers[0].add(marsLayer);

  const orbiters = dsn.nodes.filter((n) => n.body === 'Mars' && n.type === 'orbiter').map((n) => ({ ...n, a: RM_KM + n.alt }));
  const rovers = dsn.nodes.filter((n) => n.body === 'Mars' && n.type === 'lander').map((n) => latLon(n.lat, n.lon).map((c) => c * MARS_R * 1.004));
  for (const o of orbiters) {
    const period = 2 * Math.PI * Math.sqrt(o.a ** 3 / MU_MARS), pts = [];
    for (let k = 0; k < 240; k++) pts.push(v3(keplerPosition(o, (period * k) / 240, MU_MARS)).multiplyScalar(1 / RE_KM));
    marsLayer.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0x9aa7c7, 0.32)));
  }
  const orbiterPos = new Float32Array(orbiters.length * 3);
  const orbiterGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(orbiterPos, 3));
  marsLayer.add(new THREE.Points(orbiterGeo, pointsMat(COLORS.dtn, small ? 8 : 10)));
  const roverPos = new Float32Array(rovers.length * 3);
  const roverGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(roverPos, 3));
  marsLayer.add(new THREE.Points(roverGeo, pointsMat(0xffffff, small ? 5 : 6, 0.95)));
  const relayPos = new Float32Array(rovers.length * orbiters.length * 6);
  const relayGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(relayPos, 3));
  marsLayer.add(new THREE.LineSegments(relayGeo, lineMat(COLORS.dtn, 0.85)));
  // The long haul to Earth, drawn dashed, with a bundle travelling along it.
  const toEarth = marsPos.clone().negate().normalize();
  const haulA = toEarth.clone().multiplyScalar(MARS_R * 1.2), haulB = marsPos.clone().negate().addScaledVector(toEarth, -1.1);
  const haul = new THREE.Line(new THREE.BufferGeometry().setFromPoints([haulA, haulB]),
    new THREE.LineDashedMaterial({ color: COLORS.dtn, dashSize: 0.6, gapSize: 0.45, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  haul.computeLineDistances();
  marsLayer.add(haul);
  const bundle = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
    pointsMat(0xffe3a6, small ? 9 : 11));
  marsLayer.add(bundle);

  function updateMars(t) {
    marsBody.rotation.y = (2 * Math.PI * t) / MARS_DAY;
    const tmp = [0, 0, 0];
    orbiters.forEach((o, i) => {
      keplerPosition(o, t, MU_MARS, tmp);
      orbiterPos.set([tmp[0] / RE_KM, tmp[1] / RE_KM, tmp[2] / RE_KM], i * 3);
    });
    orbiterGeo.attributes.position.needsUpdate = true;
    let segs = 0;
    rovers.forEach((r, i) => {
      const rp = spinY(r, marsBody.rotation.y);
      roverPos.set(rp, i * 3);
      const rn = Math.hypot(...rp);
      orbiters.forEach((_, j) => {
        const ox = orbiterPos[j * 3] - rp[0], oy = orbiterPos[j * 3 + 1] - rp[1], oz = orbiterPos[j * 3 + 2] - rp[2];
        const sinEl = (ox * rp[0] + oy * rp[1] + oz * rp[2]) / (rn * Math.hypot(ox, oy, oz));
        if (sinEl > Math.sin((10 * Math.PI) / 180)) {
          relayPos.set([rp[0], rp[1], rp[2], orbiterPos[j * 3], orbiterPos[j * 3 + 1], orbiterPos[j * 3 + 2]], segs * 6);
          segs++;
        }
      });
    });
    roverGeo.attributes.position.needsUpdate = true;
    relayGeo.setDrawRange(0, segs * 2);
    relayGeo.attributes.position.needsUpdate = true;
    // one bundle crossing every 7 s, Mars to Earth (the 13-minute trip, compressed)
    const p = ((performance.now() / 7000) % 1);
    bundle.geometry.attributes.position.array.set(haulA.clone().lerp(haulB, p).toArray());
    bundle.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 1: sparse IoT constellation
  const IOT_ALT = 650, IOT_ELEV = 10;
  const iot = circular(walker({ planes: 3, perPlane: 4, f: 1, altKm: IOT_ALT, inc: 98 }));
  const iotPos = new Float32Array(iot.n * 3);
  const iotGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(iotPos, 3));
  layers[1].add(new THREE.Points(iotGeo, pointsMat(COLORS.iot, small ? 8 : 10)));
  const RING = 72, lam = coverageAngle(IOT_ALT, IOT_ELEV);
  const ringPos = new Float32Array(iot.n * RING * 6);
  const ringGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  layers[1].add(new THREE.LineSegments(ringGeo, lineMat(COLORS.iot, 0.55)));
  const sensorsFixed = sensorsLL.map(([la, lo]) => latLon(la, lo));
  const sensorPos = new Float32Array(sensorsFixed.length * 3);
  const sensorCol = new Float32Array(sensorsFixed.length * 3);
  const sensorGeo = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(sensorPos, 3))
    .setAttribute('color', new THREE.BufferAttribute(sensorCol, 3));
  layers[1].add(new THREE.Points(sensorGeo, pointsMat(0xffffff, small ? 3.5 : 4, 1, { vertexColors: true })));
  const upPos = new Float32Array(sensorsFixed.length * 6);
  const upGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(upPos, 3));
  layers[1].add(new THREE.LineSegments(upGeo, lineMat(COLORS.iot, 0.5)));
  const idle = new THREE.Color(0x46607a), heard = new THREE.Color(0xd8fff2);
  let iotCovered = 0;

  function updateIot(t, spin) {
    place(iot, t, iotPos);
    iotGeo.attributes.position.needsUpdate = true;
    const cl = Math.cos(lam), sl = Math.sin(lam), s = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < iot.n; i++) {
      s.set(iotPos[i * 3], iotPos[i * 3 + 1], iotPos[i * 3 + 2]).normalize();
      a.crossVectors(s, Math.abs(s.y) < 0.9 ? Y : new THREE.Vector3(1, 0, 0)).normalize();
      b.crossVectors(s, a);
      for (let j = 0; j < RING; j++) {
        for (const jj of [j, (j + 1) % RING]) {
          const th = (2 * Math.PI * jj) / RING, r = 1.003;
          ringPos[k++] = r * (s.x * cl + (a.x * Math.cos(th) + b.x * Math.sin(th)) * sl);
          ringPos[k++] = r * (s.y * cl + (a.y * Math.cos(th) + b.y * Math.sin(th)) * sl);
          ringPos[k++] = r * (s.z * cl + (a.z * Math.cos(th) + b.z * Math.sin(th)) * sl);
        }
      }
    }
    ringGeo.attributes.position.needsUpdate = true;
    let ups = 0;
    iotCovered = 0;
    const p = [0, 0, 0];
    sensorsFixed.forEach((f, i) => {
      spinY(f, spin, p);
      sensorPos.set([p[0] * 1.004, p[1] * 1.004, p[2] * 1.004], i * 3);
      let best = -1, bestDot = cl;
      for (let j = 0; j < iot.n; j++) {
        const x = iotPos[j * 3], y = iotPos[j * 3 + 1], z = iotPos[j * 3 + 2];
        const d = (p[0] * x + p[1] * y + p[2] * z) / Math.hypot(x, y, z);
        if (d > bestDot) { bestDot = d; best = j; }
      }
      (best >= 0 ? heard : idle).toArray(sensorCol, i * 3);
      if (best >= 0) {
        iotCovered++;
        upPos.set([p[0], p[1], p[2], iotPos[best * 3], iotPos[best * 3 + 1], iotPos[best * 3 + 2]], ups * 6);
        ups++;
      }
    });
    sensorGeo.attributes.position.needsUpdate = true;
    sensorGeo.attributes.color.needsUpdate = true;
    upGeo.setDrawRange(0, ups * 2);
    upGeo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 2: mega-constellation mesh
  const MP = 72, MS = 22;
  const megaList = walker({ planes: MP, perPlane: MS, f: 17, altKm: 550, inc: 53 });
  const mega = circular(megaList);
  const megaPos = new Float32Array(mega.n * 3);
  const megaAttr = new THREE.BufferAttribute(megaPos, 3);
  const megaPts = new THREE.BufferGeometry().setAttribute('position', megaAttr);
  layers[2].add(new THREE.Points(megaPts, pointsMat(COLORS.mega, small ? 2.6 : 3)));
  const links = [];
  for (let p = 0; p < MP; p++) {
    for (let j = 0; j < MS; j++) {
      const i = p * MS + j;
      links.push(i, p * MS + ((j + 1) % MS));         // same plane, next satellite
      if (p + 1 < MP) links.push(i, (p + 1) * MS + j); // next plane (no seam link)
    }
  }
  const islGeo = new THREE.BufferGeometry().setAttribute('position', megaAttr);
  islGeo.setIndex(links);
  layers[2].add(new THREE.LineSegments(islGeo, lineMat(COLORS.mega, 0.2)));
  const adj = Array.from({ length: mega.n }, () => []);
  for (let k = 0; k < links.length; k += 2) { adj[links[k]].push(links[k + 1]); adj[links[k + 1]].push(links[k]); }
  const cityFixed = [latLon(...LYON), latLon(...CORDOBA)];
  const cityGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(cityFixed.flat().map((c) => c * 1.004)), 3));
  const cityDots = new THREE.Points(cityGeo, pointsMat(0xffffff, small ? 8 : 9));
  earth.add(cityDots);
  const routePos = new Float32Array(64 * 3);
  const routeGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(routePos, 3));
  layers[2].add(new THREE.Line(routeGeo, lineMat(COLORS.route, 0.95)));
  layers[2].add(new THREE.Points(routeGeo, pointsMat(COLORS.route, small ? 6 : 7)));
  const fibreMs = (greatCircleKm(LYON, CORDOBA) / FIBRE_KMS) * 1000;
  let lastRoute = 0, routeText = '';

  function shortestRoute(spin) {
    // Dijkstra over satellites; the two cities attach to satellites above 25 degrees elevation.
    const g = cityFixed.map((f) => spinY(f, spin));
    const n = mega.n, dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
    const SRC = n, DST = n + 1, minSin = Math.sin((25 * Math.PI) / 180);
    const visible = (c, i) => {
      const x = megaPos[i * 3] - c[0], y = megaPos[i * 3 + 1] - c[1], z = megaPos[i * 3 + 2] - c[2];
      const r = Math.hypot(x, y, z);
      return (x * c[0] + y * c[1] + z * c[2]) / r > minSin ? r : 0;
    };
    const heap = [];
    const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const q = (k - 1) >> 1; if (heap[q][0] <= heap[k][0]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    dist[SRC] = 0;
    for (let i = 0; i < n; i++) { const r = visible(g[0], i); if (r) { dist[i] = r; prev[i] = SRC; push(r, i); } }
    while (heap.length) {
      const [d, u] = pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === DST) break;
      const r = visible(g[1], u);
      if (r && d + r < dist[DST]) { dist[DST] = d + r; prev[DST] = u; push(dist[DST], DST); }
      for (const w of adj[u]) {
        const len = Math.hypot(megaPos[u * 3] - megaPos[w * 3], megaPos[u * 3 + 1] - megaPos[w * 3 + 1], megaPos[u * 3 + 2] - megaPos[w * 3 + 2]);
        if (d + len < dist[w]) { dist[w] = d + len; prev[w] = u; push(dist[w], w); }
      }
    }
    if (!isFinite(dist[DST])) { routeGeo.setDrawRange(0, 0); return; }
    const path = [];
    for (let u = DST; u !== -1; u = prev[u]) path.push(u);
    path.reverse().slice(0, 64).forEach((u, k) => {
      const p = u === SRC ? g[0] : u === DST ? g[1] : [megaPos[u * 3], megaPos[u * 3 + 1], megaPos[u * 3 + 2]];
      routePos.set(p, k * 3);
    });
    routeGeo.setDrawRange(0, Math.min(path.length, 64));
    routeGeo.attributes.position.needsUpdate = true;
    const ms = ((dist[DST] * RE_KM) / C_KMS) * 1000;
    const text = `Lyon to Córdoba over a ${(mega.n).toLocaleString('en')}-satellite laser mesh, via ${path.length - 2} satellites: <b>${ms.toFixed(0)} ms</b>. A perfectly straight fibre would need <b>${fibreMs.toFixed(0)} ms</b>.`;
    if (text !== routeText) { routeText = text; onLive('mega', text); }
  }

  function updateMega(t, spin) {
    place(mega, t, megaPos);
    megaAttr.needsUpdate = true;
    if (performance.now() - lastRoute > 500) { lastRoute = performance.now(); shortestRoute(spin); }
  }

  // ---------------------------------------------------------------- 3: one compute node in an ODC shell
  const sunRaan = () => Math.atan2(-sunDir.z, sunDir.x) * (180 / Math.PI);   // right ascension of the Sun
  const odcList = [], odcCol = [];
  const raanSun = sunRaan();
  odc.shells.forEach((s) => {
    const inc = ssoInclination(s.altitude_km);
    const raan0 = raanSun + (s.ltan_hours - 12) * 15 + s.raan_center_offset_deg;
    const col = new THREE.Color(s.color_hex).lerp(new THREE.Color(0xffffff), 0.35);
    walker({ planes: s.n_planes, perPlane: s.sats_per_plane, f: s.walker_phase_f, altKm: s.altitude_km, inc, raan0, raanSpan: s.raan_band_deg })
      .forEach((sat, k) => { if (!small || k % 2 === 0) { odcList.push(sat); odcCol.push(col.r, col.g, col.b); } });
  });
  const odcSats = circular(odcList);
  const odcPos = new Float32Array(odcSats.n * 3);
  const odcGeo = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(odcPos, 3))
    .setAttribute('color', new THREE.BufferAttribute(new Float32Array(odcCol), 3));
  layers[3].add(new THREE.Points(odcGeo, pointsMat(0xffffff, small ? 1.8 : 2.2, 0.9, { vertexColors: true })));
  // The tracked node: any satellite of plane 14 in the lowest shell that survived thinning on phones.
  const nodeIndex = Math.max(0, odcList.findIndex((s) => s.altKm === 550 && s.plane === 14));
  const node = buildNode(skyEnvironment(renderer, sunDir));
  node.scale.setScalar(1.25e-4);                       // model in metres, drawn ~10x too large to read
  layers[3].add(node);
  const nodeFrame = { p: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };

  function updateOdc(t) {
    place(odcSats, t, odcPos);
    odcGeo.attributes.position.needsUpdate = true;
    const a = new Float32Array(3), b = new Float32Array(3);
    place({ n: 1, data: odcSats.data.subarray(nodeIndex * 5, nodeIndex * 5 + 5) }, t, a);
    place({ n: 1, data: odcSats.data.subarray(nodeIndex * 5, nodeIndex * 5 + 5) }, t + 1, b);
    nodeFrame.p.set(a[0], a[1], a[2]);
    nodeFrame.y.copy(nodeFrame.p).normalize();                         // up, away from Earth
    // The wings turn about the radial axis to face the Sun; the radiators stay edge-on to it.
    nodeFrame.z.copy(sunDir).addScaledVector(nodeFrame.y, -sunDir.dot(nodeFrame.y));
    if (nodeFrame.z.lengthSq() < 1e-6) nodeFrame.z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    nodeFrame.z.normalize();
    nodeFrame.x.crossVectors(nodeFrame.y, nodeFrame.z).normalize();
    node.position.copy(nodeFrame.p);
    node.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(nodeFrame.x, nodeFrame.y, nodeFrame.z));
    node.userData.animate(performance.now());
  }

  // ---------------------------------------------------------------- camera stops
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const midFixed = v3(latLon(7.5, -31)).normalize();
  const fit = () => Math.max(1, 0.72 / camera.aspect);   // back off on portrait screens
  const stops = [
    () => {
      const u = marsPos.clone().negate().normalize(), k = fit();
      const side = tmpA.crossVectors(u, Y).normalize();
      return { pos: marsPos.clone().addScaledVector(u, -9 * k).addScaledVector(side, 2.3 * k).addScaledVector(Y, 2.6 * k),
        target: marsPos.clone().addScaledVector(u, 2.0), up: Y };
    },
    () => {
      const d = sunDir.clone().applyAxisAngle(Y, 0.75).normalize();
      d.y += 0.32;
      return { pos: d.normalize().multiplyScalar(4.3 * fit()), target: new THREE.Vector3(), up: Y };
    },
    () => {
      const m = v3(spinY(midFixed.toArray(), earthSpin()));
      return { pos: m.multiplyScalar(3.7 * fit()).addScaledVector(Y, 0.25), target: new THREE.Vector3(0, 0.05, 0), up: Y };
    },
    () => {
      const { p, x, y, z } = nodeFrame, k = fit();
      return { pos: p.clone().addScaledVector(z, 0.024 * k).addScaledVector(x, 0.006 * k).addScaledVector(y, 0.0048 * k),
        target: p.clone().addScaledVector(y, -0.0034).addScaledVector(x, 0.0006), up: y.clone() };
    },
  ];

  let current = 0, from = null, tweenStart = 0, tweenDur = 1;
  const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: Y.clone() };
  function goTo(i, instant = false) {
    if (i < 0 || i > 3) return;
    from = instant ? null : { pos: cam.pos.clone(), target: cam.target.clone(), up: cam.up.clone(), fades: [...fades] };
    tweenStart = performance.now();
    tweenDur = instant ? 0 : 1400 + Math.min(1700, cam.pos.distanceTo(stops[i]().pos) * 28);
    current = i;
    if (instant) updateAll(0);
  }

  // ---------------------------------------------------------------- frame loop
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onPointer = (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; };
  if (!small) addEventListener('pointermove', onPointer, { passive: true });

  function updateAll(dt) {
    simSeconds += dt * TIME_SCALE;
    const t = simSeconds, spin = earthSpin();
    updateSun();
    sunLight.position.copy(sunDir).multiplyScalar(100);
    earth.rotation.y = spin;
    if (layers[0].visible || current === 0) updateMars(t);
    if (layers[1].visible || current === 1) updateIot(t, spin);
    if (layers[2].visible || current === 2) updateMega(t, spin);
    if (layers[3].visible || current === 3) updateOdc(t);

    const now = performance.now(), goal = stops[current]();
    const p = tweenDur ? Math.min(1, (now - tweenStart) / tweenDur) : 1, e = ease(p);
    if (from && p < 1) {
      cam.pos.lerpVectors(from.pos, goal.pos, e);
      const span = from.pos.distanceTo(goal.pos);
      tmpB.subVectors(goal.pos, from.pos).cross(Y).normalize();          // arc sideways on long flights
      if (isFinite(tmpB.x)) cam.pos.addScaledVector(tmpB, Math.sin(Math.PI * e) * span * 0.12);
      cam.target.lerpVectors(from.target, goal.target, e);
      cam.up.lerpVectors(from.up, goal.up, e).normalize();
      for (let i = 0; i < 4; i++) {
        setFade(i, i === current ? Math.max(from.fades[i], ease(Math.min(1, Math.max(0, p * 2 - 0.6))))
          : from.fades[i] * (1 - Math.min(1, p * 2)));
      }
    } else {
      cam.pos.copy(goal.pos); cam.target.copy(goal.target); cam.up.copy(goal.up);
      for (let i = 0; i < 4; i++) if (fades[i] !== (i === current ? 1 : 0)) setFade(i, i === current ? 1 : 0);
    }
    cityDots.visible = fades[2] > 0.01;
    cityDots.material.opacity = fades[2];

    pointer.sx += (pointer.x - pointer.sx) * 0.04;
    pointer.sy += (pointer.y - pointer.sy) * 0.04;
    const dist = cam.pos.distanceTo(cam.target);
    camera.up.copy(cam.up);
    camera.position.copy(cam.pos);
    camera.lookAt(cam.target);
    camera.position.addScaledVector(tmpA.set(1, 0, 0).applyQuaternion(camera.quaternion), pointer.sx * dist * 0.035)
      .addScaledVector(tmpB.set(0, 1, 0).applyQuaternion(camera.quaternion), -pointer.sy * dist * 0.025);
    camera.lookAt(cam.target);
    camera.near = Math.min(0.05, Math.max(0.0001, dist * 0.02));
    camera.updateProjectionMatrix();
  }

  // Frame the subject beside the text card: right of centre on wide screens, above it on phones.
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (w > 760) camera.setViewOffset(w, h, -0.1 * w, 0, w, h);
    else camera.setViewOffset(w, h, 0, 0.21 * h, w, h);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf = 0, last = performance.now(), running = false, inView = true;
  const frameTimes = [];
  let checked = 0, lastReport = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    updateAll(dt);
    renderer.render(scene, camera);
    if (checked < 2) {
      frameTimes.push(dt);
      if (frameTimes.length === 90) {
        const med = [...frameTimes].sort((a, b) => a - b)[45];
        frameTimes.length = 0;
        if (med > 0.045) {
          if (checked === 0 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); checked = 1; }
          else { checked = 2; onSlow(); }
        } else checked = 2;
      }
    }
    if (now - lastReport > 1000 && fades[1] > 0.5) {
      lastReport = now;
      onLive('iot', `Right now <b>${iotCovered} of ${sensorsFixed.length}</b> sensors can reach a satellite. The others wait for the next pass.`);
    }
  }
  const play = () => { if (!running && inView && !document.hidden) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
  const pause = () => { running = false; cancelAnimationFrame(raf); };
  const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; inView ? play() : pause(); });
  io.observe(canvas);
  const onVis = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVis);

  updateOdc(0);
  for (let i = 0; i < 4; i++) setFade(i, i === 0 ? 1 : 0);
  goTo(0, true);
  renderer.render(scene, camera);
  play();

  return {
    goTo,
    dispose() {
      pause(); io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointermove', onPointer);
      renderer.dispose();
    },
  };
}
