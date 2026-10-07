// The landing tour: one three.js scene, four camera stops, from Mars down to one node.
//   0  Mars relays (DTN)            IPN-V dsn-network orbiters and rovers, real Earth-Mars direction
//   1  sparse IoT constellation     12 small satellites, footprints, 520 sensors on land, one followed
//   2  mega-constellation mesh      72 x 22 shell with +grid laser links, live Lyon-Cordoba route
//   3  one compute node             five dawn-dusk shells of an orbital data-centre sample, with
//                                   range-limited laser links; scrolling on pulls the camera back
// Units: one Earth radius. Distances between bodies are schematic; orbits are to scale.
// The clock starts at the real current time and runs TIME_SCALE times faster.

import * as THREE from 'three';
import { gmst, sunDirectionEci, marsDirectionEci, marsLightMinutes, C_KMS } from '../astro.js';
import {
  RE_KM, RM_KM, MU_EARTH, MU_MARS, latLon, spinY, ssoInclination,
  circular, place, walker, keplerPosition, coverageAngle, greatCircleKm,
} from './orbits.js';
import { buildNode, skyEnvironment } from './node-model.js';

const TIME_SCALE = 60;
const MARS_DIST = 60;                 // schematic; the real distance is 10,000 to 60,000 Earth radii
const MARS_R = RM_KM / RE_KM;
const MARS_DAY = 88642.66;            // sidereal rotation [s]
const LYON = [45.76, 4.84], CORDOBA = [-31.42, -64.18];
const FIBRE_KMS = C_KMS / 1.468;      // light in glass
const COLORS = { dtn: 0xe8a541, iot: 0xa9dc63, mega: 0x82e0d4, odc: 0xf2b84b, route: 0xffffff };
const IOT_CSS = '#a9dc63';
const READING_S = 900;                // the followed sensor takes a reading every 15 minutes
const ISL_KM = 150, TERMINALS = 4;    // a laser link opens when two spacecraft pass this close
const ODC_TINTS = ['#fff0c8', '#ffdc93', '#f9c766', '#f0b14d', '#e49b3e'];   // lowest shell first
const Y = new THREE.Vector3(0, 1, 0);

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

function canvasTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const dotTexture = () => canvasTexture((g) => {
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
});

// A small satellite seen face-on: a cube body between two solar panels.
const cubesatTexture = (panel) => canvasTexture((g) => {
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  glow.addColorStop(0, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#dfe6f0';
  g.fillRect(22, 30, 20, 4);
  g.fillStyle = panel;
  g.fillRect(3, 23, 20, 18);
  g.fillRect(41, 23, 20, 18);
  g.strokeStyle = 'rgba(7, 11, 22, 0.75)';
  g.lineWidth = 2;
  for (const x of [9.7, 16.3, 47.7, 54.3]) { g.beginPath(); g.moveTo(x, 23); g.lineTo(x, 41); g.stroke(); }
  g.fillStyle = '#f4f7fb';
  g.fillRect(25, 24, 14, 16);
  g.strokeStyle = '#6f7b8c';
  g.strokeRect(25.5, 24.5, 13, 15);
});

// A thin ring, for markers that pulse around a point.
const ringTexture = () => canvasTexture((g) => {
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 3.5;
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
});

// One small icon per callout, drawn in its topic's colour.
const ICONS = {
  dtn: '<svg class="ico" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h8M3 12.5h8M4 1.5c0 3.2 3 3.6 3 5.5s-3 2.3-3 5.5M10 1.5c0 3.2-3 3.6-3 5.5s3 2.3 3 5.5"/></svg>',
  iot: '<svg class="batt" viewBox="0 0 22 12" aria-hidden="true"><rect x="0.75" y="0.75" width="18" height="10.5" rx="2"/><rect class="lvl" x="3" y="3" width="11" height="6" rx="0.8"/><rect x="19.5" y="3.8" width="2" height="4.4" rx="0.8"/></svg>',
  mega: '<svg class="ico" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 4 11.5 2.5 12 10 5 11.5ZM2.5 4 12 10M11.5 2.5 5 11.5"/><circle cx="2.5" cy="4" r="1.5"/><circle cx="11.5" cy="2.5" r="1.5"/><circle cx="12" cy="10" r="1.5"/><circle cx="5" cy="11.5" r="1.5"/></svg>',
  odc: '<svg class="ico" viewBox="0 0 14 14" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><path d="M5.5 1v2.5M8.5 1v2.5M5.5 10.5V13M8.5 10.5V13M1 5.5h2.5M1 8.5h2.5M10.5 5.5H13M10.5 8.5H13"/></svg>',
};
const duration = (s) => { const m = Math.max(1, Math.ceil(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const degrees = (lat, lon) => `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(1)}° ${lon < 0 ? 'W' : 'E'}`;

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
  const RING = ringTexture();

  // ---------------------------------------------------------------- callouts drawn over the canvas
  const SVG = 'http://www.w3.org/2000/svg';
  const overlay = document.createElement('div');
  overlay.className = 'callouts';
  overlay.setAttribute('aria-hidden', 'true');
  const leaders = document.createElementNS(SVG, 'svg');
  leaders.classList.add('leaders');
  overlay.append(leaders);
  canvas.after(overlay);
  const view = { w: 1, h: 1, top: 16, avoid: [] };  // top: below the page header; avoid: card and rail boxes
  const siteHead = document.querySelector('.site-head');
  const journey = document.querySelector('.journey'), rail = document.querySelector('.rail');
  const activeCard = () => document.querySelector('.stop.is-active .card');
  const projected = new THREE.Vector3();

  function callout(kind) {
    const box = document.createElement('div');
    box.className = `callout ${kind}`;
    const line = document.createElementNS(SVG, 'line');
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('r', '2.5');
    line.classList.add(kind); dot.classList.add(kind);
    leaders.append(line, dot);
    overlay.append(box);
    let html = '', bw = 0, bh = 0, shown = true, side = 0;
    const hide = () => { if (shown) { shown = false; box.style.opacity = line.style.opacity = dot.style.opacity = '0'; } };
    hide();
    // Area of a box at (bx, by) that would cover the text card or the topic rail.
    const clash = (bx, by) => view.avoid.reduce((s, o) => s
      + Math.max(0, Math.min(bx + bw, o.r) - Math.max(bx, o.x)) * Math.max(0, Math.min(by + bh, o.b) - Math.max(by, o.y)), 0);
    return {
      set(h) { if (h !== html) { html = h; box.innerHTML = h; bw = box.offsetWidth; bh = box.offsetHeight; } },
      // Pin the box beside a world point: above right if it fits, else the side that covers least of
      // the card and the rail. The last side is kept unless another is clearly better, so the box
      // does not hop between sides.
      place(world, opacity) {
        projected.copy(world).project(camera);
        if (opacity < 0.02 || projected.z > 1) return hide();
        const x = (projected.x + 1) / 2 * view.w, y = (1 - projected.y) / 2 * view.h;
        const gap = small ? 26 : 40, rise = small ? 46 : 70, edge = 12;
        // Each spot is kept on screen sideways, as before; how far it had to move breaks ties.
        const spots = [[x + gap, y - rise - bh], [x - gap - bw, y - rise - bh], [x + gap, y + rise], [x - gap - bw, y + rise]]
          .map(([sx, sy]) => { const cx = Math.max(edge, Math.min(sx, view.w - bw - edge)); return [cx, sy, Math.abs(cx - sx)]; });
        const costs = spots.map(([sx, sy, moved]) => (sy >= view.top && sy + bh <= view.h - edge ? clash(sx, sy) + moved : Infinity));
        const best = costs.indexOf(Math.min(...costs));
        if (!(costs[side] <= costs[best] * 1.2)) side = best;
        let bx, by;
        if (isFinite(costs[side])) [bx, by] = spots[side];
        else {                                          // no side fits on screen: the original rule
          bx = x + gap; by = y - rise - bh;
          if (bx + bw > view.w - (small ? edge : 270)) bx = x - gap - bw;
          if (by < view.top) by = y + rise;
          bx = Math.max(edge, Math.min(bx, view.w - bw - edge));
        }
        const ax = bx > x ? bx : bx + bw, ay = by > y ? by : by + bh;
        box.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;
        line.setAttribute('x1', x.toFixed(1)); line.setAttribute('y1', y.toFixed(1));
        line.setAttribute('x2', ax.toFixed(1)); line.setAttribute('y2', ay.toFixed(1));
        dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
        box.style.opacity = line.style.opacity = dot.style.opacity = opacity.toFixed(3);
        shown = true;
      },
      hide,
    };
  }

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

  // The followed rover: its data waits on board for the next relay orbiter, then crosses the
  // light time to Earth. Only rovers still working are followed.
  const plain = (name) => name.replace(/\s*\(.*\)$/, '');
  const roverInfo = dsn.nodes.filter((n) => n.body === 'Mars' && n.type === 'lander')
    .map((n) => ({ name: plain(n.name), lat: n.lat, lon: n.lon > 180 ? n.lon - 360 : n.lon }));
  const working = roverInfo.map((r, i) => (['Perseverance', 'Curiosity'].includes(r.name) ? i : -1)).filter((i) => i >= 0);
  const relayOf = new Int8Array(rovers.length).fill(-1);
  const followed = { i: -1, covered: false, until: 0, pick: true };
  const roverCallout = callout('dtn');
  const roverWorld = new THREE.Vector3(), marsEye = new THREE.Vector3(), roverDir = new THREE.Vector3();
  const MIN_EL = Math.sin((10 * Math.PI) / 180);
  const rp2 = [0, 0, 0], op2 = [0, 0, 0];
  function relayAt(r, tt) {                      // the orbiter that hears rover r at time tt, or -1
    spinY(rovers[r], (2 * Math.PI * tt) / MARS_DAY, rp2);
    const rn = Math.hypot(rp2[0], rp2[1], rp2[2]);
    let best = -1, bestEl = MIN_EL;
    orbiters.forEach((o, j) => {
      keplerPosition(o, tt, MU_MARS, op2);
      const ox = op2[0] / RE_KM - rp2[0], oy = op2[1] / RE_KM - rp2[1], oz = op2[2] / RE_KM - rp2[2];
      const sinEl = (ox * rp2[0] + oy * rp2[1] + oz * rp2[2]) / (rn * Math.hypot(ox, oy, oz));
      if (sinEl > bestEl) { bestEl = sinEl; best = j; }
    });
    return best;
  }
  function relayChange(r, t0, wantRelay) {      // in one-minute steps, up to two days ahead
    for (let k = 1; k <= 2880; k++) {
      const tt = t0 + k * 60;
      if ((relayAt(r, tt) >= 0) === wantRelay) return tt;
    }
    return t0 + 2880 * 60;
  }
  function pickRover() {
    marsEye.copy(stops[0]().pos).sub(marsPos).normalize();
    let best = -1, bestFacing = -Infinity;
    for (const i of working) {
      const facing = roverDir.fromArray(roverPos, i * 3).normalize().dot(marsEye);
      if (facing > bestFacing) { bestFacing = facing; best = i; }
    }
    followed.i = best;
    followed.pick = false;
    followed.covered = !(best >= 0 && relayOf[best] >= 0);   // forces the state to be worked out again
  }

  function updateFollowedRover(t) {
    if (followed.pick || followed.i < 0) pickRover();
    const i = followed.i;
    if (i < 0) return;
    const relay = relayOf[i], covered = relay >= 0;
    if (covered !== followed.covered) {
      followed.covered = covered;
      followed.until = relayChange(i, t, !covered);
    }
  }

  // Applied once the camera has moved. A rover on the far side is pinned to the nearest point of
  // the visible limb, so the callout slides round with it instead of vanishing.
  function dtnOverlays() {
    const i = followed.i, f = fades[0];
    if (i < 0 || f < 0.01) return roverCallout.hide();
    marsEye.copy(camera.position).sub(marsPos).normalize();
    roverDir.fromArray(roverPos, i * 3).normalize();
    const facing = roverDir.dot(marsEye);
    if (facing < -0.2 && working.some((j) => j !== i && tmpA.fromArray(roverPos, j * 3).normalize().dot(marsEye) > 0.3)) followed.pick = true;
    if (facing < 0.06) roverDir.addScaledVector(marsEye, 0.06 - facing).normalize();
    roverWorld.copy(marsPos).addScaledVector(roverDir, MARS_R * 1.004);
    const r = roverInfo[i], light = marsLightMinutes(simDate()).toFixed(1), t = simSeconds;
    roverCallout.set(`<p class="c-head">${ICONS.dtn}${r.name} rover</p>`
      + `<p class="c-sub">${facing < 0 ? 'On the far side of Mars right now' : `${degrees(r.lat, r.lon)} on Mars`}</p>`
      + (followed.covered
        ? `<p class="c-state"><b>Relaying</b> through ${plain(orbiters[relayOf[i]].name)}</p><p class="c-next">Reaches Earth in <b>${light} min</b> at the earliest</p>`
        : `<p class="c-state"><b>Waiting</b>, data held on board</p><p class="c-next">Relay in <b>${duration(followed.until - t)}</b>, then <b>${light} min</b> to Earth</p>`));
    roverCallout.place(roverWorld, smooth(0.5, 1, f));
  }

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
      let bestEl = MIN_EL;
      relayOf[i] = -1;
      orbiters.forEach((_, j) => {
        const ox = orbiterPos[j * 3] - rp[0], oy = orbiterPos[j * 3 + 1] - rp[1], oz = orbiterPos[j * 3 + 2] - rp[2];
        const sinEl = (ox * rp[0] + oy * rp[1] + oz * rp[2]) / (rn * Math.hypot(ox, oy, oz));
        if (sinEl > MIN_EL) {
          relayPos.set([rp[0], rp[1], rp[2], orbiterPos[j * 3], orbiterPos[j * 3 + 1], orbiterPos[j * 3 + 2]], segs * 6);
          segs++;
          if (sinEl > bestEl) { bestEl = sinEl; relayOf[i] = j; }
        }
      });
    });
    roverGeo.attributes.position.needsUpdate = true;
    relayGeo.setDrawRange(0, segs * 2);
    relayGeo.attributes.position.needsUpdate = true;
    updateFollowedRover(t);
    // one bundle crossing every 7 s, Mars to Earth (the 13-minute trip, compressed)
    const p = ((performance.now() / 7000) % 1);
    bundle.geometry.attributes.position.array.set(haulA.clone().lerp(haulB, p).toArray());
    bundle.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 1: sparse IoT constellation
  // Small satellites drawn as icons, battery-powered sensors on the ground, and one sensor
  // followed in a callout: asleep with its readings stored, then awake while a satellite passes.
  const IOT_ALT = 650, IOT_ELEV = 10;
  const iot = circular(walker({ planes: 3, perPlane: 4, f: 1, altKm: IOT_ALT, inc: 98 }));
  const iotPos = new Float32Array(iot.n * 3);
  const iotGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(iotPos, 3));
  layers[1].add(new THREE.Points(iotGeo, pointsMat(0xffffff, small ? 20 : 26, 1,
    { map: cubesatTexture(IOT_CSS), blending: THREE.NormalBlending })));
  const RIM = 72, lam = coverageAngle(IOT_ALT, IOT_ELEV), cl = Math.cos(lam), sl = Math.sin(lam);
  const ringPos = new Float32Array(iot.n * RIM * 6);
  const ringGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  layers[1].add(new THREE.LineSegments(ringGeo, lineMat(COLORS.iot, 0.5)));
  const sensorsFixed = sensorsLL.map(([la, lo]) => latLon(la, lo));
  const sensorPos = new Float32Array(sensorsFixed.length * 3);
  const sensorCol = new Float32Array(sensorsFixed.length * 3);
  const sensorGeo = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(sensorPos, 3))
    .setAttribute('color', new THREE.BufferAttribute(sensorCol, 3));
  layers[1].add(new THREE.Points(sensorGeo, pointsMat(0xffffff, small ? 3.5 : 4.5, 1, { vertexColors: true })));
  const upPos = new Float32Array(sensorsFixed.length * 6);
  const upGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(upPos, 3));
  layers[1].add(new THREE.LineSegments(upGeo, lineMat(COLORS.iot, 0.45)));
  const idle = new THREE.Color(0x4b5a6e), heard = new THREE.Color(0xeaffcf);
  const heardBy = new Int16Array(sensorsFixed.length).fill(-1);
  let iotCovered = 0;

  // The followed sensor: a pulsing ring, a bright uplink while a satellite hears it, and a callout.
  const tracked = { i: -1, covered: false, until: 0, lastEnd: 0, pick: true };
  const trackRing = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
    pointsMat(COLORS.iot, 18, 1, { map: RING }));
  const trackLink = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    lineMat(0xf4ffe6, 0.95));
  layers[1].add(trackRing, trackLink);
  const sensorCallout = callout('iot');
  const trackWorld = new THREE.Vector3();

  const probe = new Float32Array(iot.n * 3), probeP = [0, 0, 0];
  function hearing(i, tt) {                      // the satellite that hears sensor i at time tt, or -1
    spinY(sensorsFixed[i], gmst(new Date(start + tt * 1000)), probeP);
    place(iot, tt, probe);
    let best = -1, bestDot = cl;
    for (let j = 0; j < iot.n; j++) {
      const x = probe[j * 3], y = probe[j * 3 + 1], z = probe[j * 3 + 2];
      const d = (probeP[0] * x + probeP[1] * y + probeP[2] * z) / Math.hypot(x, y, z);
      if (d > bestDot) { bestDot = d; best = j; }
    }
    return best;
  }
  // First time, in 30 s steps forward (or backward), when the sensor is heard (or not).
  function nextChange(i, t0, wantHeard, dir = 1, steps = 1440) {
    for (let k = 1; k <= steps; k++) {
      const tt = t0 + dir * k * 30;
      if ((hearing(i, tt) >= 0) === wantHeard) return tt;
    }
    return t0 + dir * steps * 30;
  }
  // Follow a sensor near the middle of the visible disc, ideally one a satellite reaches soon,
  // so a visitor sees it wait and then wake up.
  function pickSensor(t, spin) {
    const eye = stops[1]().pos.normalize(), p = [0, 0, 0];
    const near = [];
    sensorsFixed.forEach((f, i) => {
      spinY(f, spin, p);
      const facing = p[0] * eye.x + p[1] * eye.y + p[2] * eye.z;
      if (facing > 0.8) near.push([facing, i]);
    });
    near.sort((a, b) => b[0] - a[0]);
    let best = -1, bestScore = -Infinity;
    for (const [facing, i] of near.slice(0, 24)) {
      const wait = heardBy[i] >= 0 ? -1 : (nextChange(i, t, true, 1, 140) - t) / 60;
      const score = facing + (wait >= 4 && wait <= 25 ? 2 : wait > 25 && wait < 70 ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    tracked.i = best;
    tracked.pick = false;
    tracked.covered = !(best >= 0 && heardBy[best] >= 0);   // forces the state to be worked out again
  }

  function updateIot(t, spin) {
    place(iot, t, iotPos);
    iotGeo.attributes.position.needsUpdate = true;
    const s = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < iot.n; i++) {
      s.set(iotPos[i * 3], iotPos[i * 3 + 1], iotPos[i * 3 + 2]).normalize();
      a.crossVectors(s, Math.abs(s.y) < 0.9 ? Y : new THREE.Vector3(1, 0, 0)).normalize();
      b.crossVectors(s, a);
      for (let j = 0; j < RIM; j++) {
        for (const jj of [j, (j + 1) % RIM]) {
          const th = (2 * Math.PI * jj) / RIM, r = 1.003;
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
      heardBy[i] = best;
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
    updateTracked(t, spin);
  }

  function updateTracked(t, spin) {
    if (tracked.pick || tracked.i < 0) pickSensor(t, spin);
    const i = tracked.i;
    if (i < 0) return sensorCallout.hide();
    trackWorld.fromArray(sensorPos, i * 3);
    if (trackWorld.dot(stops[1]().pos.normalize()) < 0.3) tracked.pick = true;   // rotated towards the limb
    const sat = heardBy[i], covered = sat >= 0;
    if (covered !== tracked.covered) {
      tracked.covered = covered;
      tracked.until = nextChange(i, t, !covered);
      if (!covered) tracked.lastEnd = nextChange(i, t, true, -1);
    }
    trackRing.geometry.attributes.position.array.set(trackWorld.toArray());
    trackRing.geometry.attributes.position.needsUpdate = true;
    trackLink.visible = covered;
    if (covered) {
      trackLink.geometry.attributes.position.array.set([...trackWorld.toArray(), iotPos[sat * 3], iotPos[sat * 3 + 1], iotPos[sat * 3 + 2]]);
      trackLink.geometry.attributes.position.needsUpdate = true;
    }
    const [la, lo] = sensorsLL[i];
    const stored = Math.max(1, Math.floor((t - tracked.lastEnd) / READING_S));
    sensorCallout.set(
      `<p class="c-head">${ICONS.iot}Battery-powered sensor</p><p class="c-sub">${degrees(la, lo)}</p>`
      + (covered
        ? `<p class="c-state"><b>Radio on</b>, sending its readings</p><p class="c-next">Pass ends in <b>${duration(tracked.until - t)}</b></p>`
        : `<p class="c-state"><b>Asleep</b>, ${stored} reading${stored > 1 ? 's' : ''} stored</p><p class="c-next">Next satellite in <b>${duration(tracked.until - t)}</b></p>`));
  }

  // Applied after the layer fades, once the camera has moved.
  function iotOverlays() {
    const f = fades[1];
    if (tracked.i < 0 || f < 0.01) { trackRing.material.opacity = 0; return sensorCallout.hide(); }
    const pulse = (performance.now() / (tracked.covered ? 700 : 1600)) % 1;
    trackRing.material.size = (small ? 12 : 15) + pulse * (small ? 12 : 16);
    trackRing.material.opacity = f * (1 - pulse) * (tracked.covered ? 1 : 0.8);
    const facing = tmpB.subVectors(camera.position, trackWorld).dot(trackWorld) > 0;
    sensorCallout.place(trackWorld, facing ? smooth(0.5, 1, f) : 0);
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
  const MEGA_KMS = Math.sqrt(MU_EARTH / (RE_KM + 550)), minSin = Math.sin((25 * Math.PI) / 180);
  let lastRoute = 0, routeText = '';

  // The satellite that carries Lyon's end of the route, and when it sinks out of Lyon's sky.
  const hop = { sat: -1, until: 0, count: 0 };
  const megaCallout = callout('mega');
  const hopWorld = new THREE.Vector3();
  const hopP = new Float32Array(3), lyonP = [0, 0, 0];
  function leavesSky(u, t0) {                    // in 10 s steps, up to an hour ahead
    const data = mega.data.subarray(u * 5, u * 5 + 5);
    for (let k = 1; k <= 360; k++) {
      const tt = t0 + k * 10;
      place({ n: 1, data }, tt, hopP);
      spinY(cityFixed[0], gmst(new Date(start + tt * 1000)), lyonP);
      const x = hopP[0] - lyonP[0], y = hopP[1] - lyonP[1], z = hopP[2] - lyonP[2];
      if ((x * lyonP[0] + y * lyonP[1] + z * lyonP[2]) / Math.hypot(x, y, z) < minSin) return tt;
    }
    return t0 + 3600;
  }

  function shortestRoute(spin, t) {
    // Dijkstra over satellites; the two cities attach to satellites above 25 degrees elevation.
    const g = cityFixed.map((f) => spinY(f, spin));
    const n = mega.n, dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
    const SRC = n, DST = n + 1;
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
    if (!isFinite(dist[DST])) { routeGeo.setDrawRange(0, 0); hop.sat = -1; return; }
    const path = [];
    for (let u = DST; u !== -1; u = prev[u]) path.push(u);
    path.reverse();
    if (path[1] !== hop.sat) { hop.sat = path[1]; hop.until = leavesSky(hop.sat, t); }
    hop.count = path.length - 2;
    path.slice(0, 64).forEach((u, k) => {
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
    if (performance.now() - lastRoute > 500) { lastRoute = performance.now(); shortestRoute(spin, t); }
  }

  function megaOverlays() {
    const f = fades[2];
    if (hop.sat < 0 || f < 0.01) return megaCallout.hide();
    hopWorld.fromArray(megaPos, hop.sat * 3);
    megaCallout.set(`<p class="c-head">${ICONS.mega}Satellite above Lyon</p><p class="c-sub">550 km up, ${MEGA_KMS.toFixed(1)} km/s</p>`
      + `<p class="c-state"><b>${adj[hop.sat].length}</b> laser links, satellite 1 of ${hop.count} to Córdoba</p>`
      + `<p class="c-next">Leaves Lyon's sky in <b>${duration(hop.until - simSeconds)}</b></p>`);
    megaCallout.place(hopWorld, smooth(0.5, 1, f));
  }

  // ---------------------------------------------------------------- 3: one compute node in an ODC shell
  // Five dawn-dusk sun-synchronous shells. Neighbours are drawn larger the closer they are. A laser
  // link opens between two spacecraft of a shell whenever they pass within ISL_KM, with at most
  // TERMINALS links each: links appear as the planes converge towards the poles and break again
  // towards the equator.
  const sunRaan = () => Math.atan2(-sunDir.z, sunDir.x) * (180 / Math.PI);   // right ascension of the Sun
  const odcList = [], odcTint = [], slotOf = new Map();
  const raanSun = sunRaan();
  odc.shells.forEach((s, shell) => {
    const inc = ssoInclination(s.altitude_km);
    const raan0 = raanSun + (s.ltan_hours - 12) * 15 + s.raan_center_offset_deg;
    const col = new THREE.Color(ODC_TINTS[shell % ODC_TINTS.length]);
    walker({ planes: s.n_planes, perPlane: s.sats_per_plane, f: s.walker_phase_f, altKm: s.altitude_km, inc, raan0, raanSpan: s.raan_band_deg })
      .forEach((sat, k) => {
        if (small && k % 2) return;                    // phones draw every other satellite
        slotOf.set(`${shell}/${sat.plane}/${sat.slot}`, odcList.length);
        odcList.push({ ...sat, shell, perPlane: s.sats_per_plane });
        odcTint.push(col.r, col.g, col.b);
      });
  });
  const odcSats = circular(odcList);
  const odcPos = new Float32Array(odcSats.n * 3);
  const odcAttr = new THREE.BufferAttribute(odcPos, 3);
  // The followed node: any satellite of plane 14 in the lowest shell that survived thinning on phones.
  const nodeIndex = Math.max(0, odcList.findIndex((s) => s.shell === 0 && s.plane === 14));
  odcTint.fill(0, nodeIndex * 3, nodeIndex * 3 + 3);   // drawn as a model, not as a dot
  const odcGeo = new THREE.BufferGeometry()
    .setAttribute('position', odcAttr)
    .setAttribute('tint', new THREE.BufferAttribute(new Float32Array(odcTint), 3));
  const odcMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: DOT }, opacity: { value: 1 }, pr: { value: pixelRatio }, minPx: { value: small ? 2.3 : 2.8 } },
    vertexShader: /* glsl */`
      attribute vec3 tint; varying vec3 vTint;
      uniform float pr, minPx;
      void main() {
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(minPx + 0.11 / max(-mv.z, 1e-4), 10.0) * pr;   // nearer neighbours glint larger
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform float opacity; varying vec3 vTint;
      void main() {
        gl_FragColor = vec4(vTint, texture2D(map, gl_PointCoord).a * opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const odcPoints = new THREE.Points(odcGeo, odcMat);
  odcPoints.onBeforeRender = () => { odcMat.uniforms.opacity.value = odcMat.opacity; };
  odcPoints.frustumCulled = false;
  layers[3].add(odcPoints);

  // Link candidates: the nearest slots in the two planes on either side, within the same shell.
  const CAND = 12, step = small ? 2 : 1;
  const cand = new Int32Array(odcSats.n * CAND).fill(-1);
  odcList.forEach((s, i) => {
    let c = i * CAND;
    for (const dp of [-2, -1, 1, 2]) {
      for (const ds of [-step, 0, step]) {
        const j = slotOf.get(`${s.shell}/${s.plane + dp}/${(s.slot + ds + s.perPlane) % s.perPlane}`);
        cand[c++] = j === undefined ? -1 : j;
      }
    }
  });
  const odcLinkIndex = new THREE.BufferAttribute(new Uint16Array(odcSats.n * TERMINALS), 1).setUsage(THREE.DynamicDrawUsage);
  const odcLinkGeo = new THREE.BufferGeometry().setAttribute('position', odcAttr);
  odcLinkGeo.setIndex(odcLinkIndex);
  const odcLinkLines = new THREE.LineSegments(odcLinkGeo, lineMat(0xffcf7a, 0.42));
  odcLinkLines.frustumCulled = false;
  layers[3].add(odcLinkLines);
  const nearest = new Int32Array(odcSats.n * TERMINALS), nearD = new Float64Array(TERMINALS);
  const nodeLinks = [];
  let lastLinks = -1e9;

  function updateLinks() {
    const R2 = (ISL_KM / RE_KM) ** 2, n = odcSats.n;
    nearest.fill(-1);
    for (let i = 0; i < n; i++) {                      // each spacecraft's closest candidates in range
      const x = odcPos[i * 3], y = odcPos[i * 3 + 1], z = odcPos[i * 3 + 2], o = i * TERMINALS;
      let m = 0;
      for (let c = i * CAND; c < (i + 1) * CAND; c++) {
        const j = cand[c];
        if (j < 0) continue;
        const dx = odcPos[j * 3] - x, dy = odcPos[j * 3 + 1] - y, dz = odcPos[j * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
        if (d > R2 || (m === TERMINALS && d >= nearD[TERMINALS - 1])) continue;
        let k = Math.min(m, TERMINALS - 1);
        while (k > 0 && nearD[k - 1] > d) { nearD[k] = nearD[k - 1]; nearest[o + k] = nearest[o + k - 1]; k--; }
        nearD[k] = d; nearest[o + k] = j;
        if (m < TERMINALS) m++;
      }
    }
    // A link needs a free terminal at both ends: keep the pairs that chose each other.
    const idx = odcLinkIndex.array;
    let e = 0;
    nodeLinks.length = 0;
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < TERMINALS; a++) {
        const j = nearest[i * TERMINALS + a];
        if (j <= i) continue;
        let mutual = false;
        for (let b = 0; b < TERMINALS; b++) if (nearest[j * TERMINALS + b] === i) mutual = true;
        if (!mutual) continue;
        idx[e++] = i; idx[e++] = j;
        if (i === nodeIndex) nodeLinks.push(j); else if (j === nodeIndex) nodeLinks.push(i);
      }
    }
    odcLinkGeo.setDrawRange(0, e);
    odcLinkIndex.needsUpdate = true;
  }

  const node = buildNode(skyEnvironment(renderer, sunDir));
  node.scale.setScalar(1.25e-4);                       // model in metres, drawn ~10x too large to read
  layers[3].add(node);
  const nodeFrame = {
    p: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(),
    v: new THREE.Vector3(), h: new THREE.Vector3(),   // along track, and the orbit normal on the Sun's side
  };
  // The node's own links leave from its laser terminals, with a pulse running along each.
  const nodeLinkPos = new Float32Array(TERMINALS * 6), pulsePos = new Float32Array(TERMINALS * 3);
  const nodeLinkGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(nodeLinkPos, 3));
  const pulseGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
  const nodeLinkLines = new THREE.LineSegments(nodeLinkGeo, lineMat(0xfff1cc, 0.9));
  const pulses = new THREE.Points(pulseGeo, pointsMat(0xfff6dc, small ? 4 : 5));
  nodeLinkLines.frustumCulled = pulses.frustumCulled = false;
  layers[3].add(nodeLinkLines, pulses);
  const terminals = node.userData.terminals.map((v) => v.clone());
  const termWorld = new THREE.Vector3(), linkDir = new THREE.Vector3(), termDir = new THREE.Vector3();

  // Seen from afar: the node's orbit, a marker, a callout and a caption.
  const nodeData = odcSats.data.subarray(nodeIndex * 5, nodeIndex * 5 + 5);
  const nodePeriodMin = Math.round((2 * Math.PI) / nodeData[4] / 60);
  const orbitPts = new Float32Array(256 * 3), one = new Float32Array(3);
  for (let k = 0; k < 256; k++) { place({ n: 1, data: nodeData }, ((2 * Math.PI) / nodeData[4]) * (k / 256), one); orbitPts.set(one, k * 3); }
  const orbitLine = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(orbitPts, 3)), lineMat(0xffd27a, 0.5));
  const marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
    pointsMat(0xffd27a, 18, 1, { map: RING }));
  marker.frustumCulled = false;
  layers[3].add(orbitLine, marker);
  const nodeCallout = callout('odc');
  const caption = document.createElement('p');
  caption.className = 'stage-caption';
  caption.innerHTML = `A sample of five dawn-dusk shells, ${odcSats.n.toLocaleString('en')} satellites, after a public FCC filing. They ride the line between day and night, and a laser link opens whenever two pass close enough.`;
  caption.style.opacity = '0';
  overlay.append(caption);
  let odcPull = 0, odcPullGoal = 0;

  function updateOdc(t) {
    place(odcSats, t, odcPos);
    odcAttr.needsUpdate = true;
    const now = performance.now();
    if (now - lastLinks > 200) { lastLinks = now; updateLinks(); }
    const a = new Float32Array(3), b = new Float32Array(3);
    place({ n: 1, data: nodeData }, t, a);
    place({ n: 1, data: nodeData }, t + 1, b);
    nodeFrame.p.set(a[0], a[1], a[2]);
    nodeFrame.y.copy(nodeFrame.p).normalize();                         // up, away from Earth
    nodeFrame.v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    nodeFrame.h.crossVectors(nodeFrame.y, nodeFrame.v).normalize();
    if (nodeFrame.h.dot(sunDir) < 0) nodeFrame.h.negate();
    // The wings turn about the radial axis to face the Sun; the radiators stay edge-on to it.
    nodeFrame.z.copy(sunDir).addScaledVector(nodeFrame.y, -sunDir.dot(nodeFrame.y));
    if (nodeFrame.z.lengthSq() < 1e-6) nodeFrame.z.copy(nodeFrame.v);
    nodeFrame.z.normalize();
    nodeFrame.x.crossVectors(nodeFrame.y, nodeFrame.z).normalize();
    node.position.copy(nodeFrame.p);
    node.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(nodeFrame.x, nodeFrame.y, nodeFrame.z));
    node.updateMatrixWorld(true);
    node.userData.animate(now);

    nodeLinks.slice(0, TERMINALS).forEach((j, k) => {
      linkDir.set(odcPos[j * 3], odcPos[j * 3 + 1], odcPos[j * 3 + 2]).sub(nodeFrame.p).normalize();
      let best = 0, bestDot = -Infinity;
      terminals.forEach((v, q) => {                     // the terminal that faces the neighbour best
        termDir.copy(v).applyQuaternion(node.quaternion).normalize();
        if (termDir.dot(linkDir) > bestDot) { bestDot = termDir.dot(linkDir); best = q; }
      });
      termWorld.copy(terminals[best]).applyMatrix4(node.matrixWorld);
      nodeLinkPos.set([termWorld.x, termWorld.y, termWorld.z, odcPos[j * 3], odcPos[j * 3 + 1], odcPos[j * 3 + 2]], k * 6);
      const f = (now / 1500 + k * 0.37) % 1;
      pulsePos.set([termWorld.x + (odcPos[j * 3] - termWorld.x) * f, termWorld.y + (odcPos[j * 3 + 1] - termWorld.y) * f,
        termWorld.z + (odcPos[j * 3 + 2] - termWorld.z) * f], k * 3);
    });
    const links = Math.min(TERMINALS, nodeLinks.length);
    nodeLinkGeo.setDrawRange(0, links * 2);
    nodeLinkGeo.attributes.position.needsUpdate = true;
    pulseGeo.setDrawRange(0, links);
    pulseGeo.attributes.position.needsUpdate = true;
    marker.geometry.attributes.position.array.set(a);
    marker.geometry.attributes.position.needsUpdate = true;
    nodeCallout.set(`<p class="c-head">${ICONS.odc}One compute node</p><p class="c-sub">Dawn-dusk orbit, ${odc.shells[0].altitude_km} km</p>`
      + (links ? `<p class="c-state"><b>${links}</b> laser link${links === 1 ? '' : 's'} open right now</p>`
        : '<p class="c-state"><b>No laser link</b> right now: neighbours out of range</p>')
      + `<p class="c-next">Once around Earth every <b>${nodePeriodMin} min</b></p>`);
  }

  // Opacities that depend on how far the camera has pulled back; applied after the layer fades.
  let captionShown = -1;
  function odcOverlays() {
    const f = fades[3], s = smooth(0.06, 0.82, odcPull), near = smooth(0.2, 0.55, odcPull), far = smooth(0.45, 0.9, odcPull);
    odcLinkLines.material.opacity = odcLinkLines.material.userData.base * f * (0.45 + 0.55 * s);
    orbitLine.material.opacity = orbitLine.material.userData.base * f * s;
    const pulse = (performance.now() / 1600) % 1;
    marker.material.size = (small ? 12 : 16) + pulse * (small ? 12 : 18);
    marker.material.opacity = f * far * (1 - pulse);
    nodeCallout.place(nodeFrame.p, f * near);
    const c = small ? 0 : Math.round(f * far * 100) / 100;
    if (c !== captionShown) { captionShown = c; caption.style.opacity = String(c); }
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
    // Close to the node at first; scrolling on pulls back to the whole dawn-dusk ring, in a frame
    // that rides along with the node, so the node and its orbit hold still while Earth turns below.
    () => {
      const { p, x, y, z, v, h } = nodeFrame, k = fit();
      const pos = p.clone().addScaledVector(z, 0.024 * k).addScaledVector(x, 0.006 * k).addScaledVector(y, 0.0048 * k);
      const target = p.clone().addScaledVector(y, -0.0034).addScaledVector(x, 0.0006);
      const s = smooth(0.06, 0.82, odcPull);
      if (s <= 0) return { pos, target, up: y.clone() };
      const away = tmpA.copy(y).multiplyScalar(0.55).addScaledVector(h, 0.12).addScaledVector(v, -0.76).normalize();   // nearly side-on to the Sun
      const w = (Math.exp(5 * s) - 1) / (Math.exp(5) - 1);   // distance grows about geometrically
      return { pos: pos.lerp(away.multiplyScalar(4.6 * k), w), target: target.lerp(y.clone().multiplyScalar(0.12), smooth(0, 1, w)), up: y.clone() };
    },
  ];

  let current = 0, from = null, tweenStart = 0, tweenDur = 1;
  const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: Y.clone() };
  function goTo(i, instant = false) {
    if (i < 0 || i > 3) return;
    from = instant ? null : { pos: cam.pos.clone(), target: cam.target.clone(), up: cam.up.clone(), fades: [...fades] };
    tweenStart = performance.now();
    tweenDur = instant ? 0 : 1400 + Math.min(1700, cam.pos.distanceTo(stops[i]().pos) * 28);
    if (i === 1 && current !== 1) tracked.pick = true;     // follow a fresh sensor on each visit
    if (i === 0 && current !== 0) followed.pick = true;    // and the rover that faces the camera
    current = i;
    if (instant) updateAll(0);
  }

  // ---------------------------------------------------------------- frame loop
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onPointer = (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; };
  if (!small) addEventListener('pointermove', onPointer, { passive: true });

  function updateAll(dt) {
    simSeconds += dt * TIME_SCALE;
    odcPull += (odcPullGoal - odcPull) * (dt ? Math.min(1, dt * 5) : 1);
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
    camera.updateMatrixWorld();
    const stage = canvas.getBoundingClientRect();
    view.top = Math.max(16, (siteHead ? siteHead.getBoundingClientRect().bottom : 0) - stage.top + 8);
    view.avoid.length = 0;
    for (const el of [activeCard(), journey.classList.contains('in-view') ? rail : null]) {
      if (!el) continue;
      const r = el.getBoundingClientRect(), pad = 10;
      if (r.width) view.avoid.push({ x: r.left - stage.left - pad, y: r.top - stage.top - pad, r: r.right - stage.left + pad, b: r.bottom - stage.top + pad });
    }
    dtnOverlays();
    iotOverlays();
    megaOverlays();
    odcOverlays();
  }

  // Frame the subject beside the text card: right of centre on wide screens, above it on phones.
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    view.w = w; view.h = h;
    odcMat.uniforms.pr.value = renderer.getPixelRatio();
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
    /** How far the visitor has scrolled through the last stop, 0 to 1: pulls the camera back. */
    setProgress(q) { odcPullGoal = Math.min(1, Math.max(0, q)); },
    dispose() {
      pause(); io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointermove', onPointer);
      overlay.remove();
      renderer.dispose();
    },
  };
}
