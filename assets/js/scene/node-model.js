// An orbital data-centre spacecraft for stop 04, loosely inspired by renders of SpaceX's
// "AI1" (about 75 m end to end): two tall solar wings on diamond trusses, a long pair of
// deployable radiators across the bus, compute racks, and laser terminals. Built in metres;
// the scene scales it down. Model axes: +Y along the wings (radial in orbit), +Z the wing
// normal (turned toward the Sun), +X along the radiators (edge-on to the Sun).

import * as THREE from 'three';

const canvasTexture = (w, h, draw) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** A soft sky with the Sun where three.js looks it up, so the mirror-like wings pick up its glow. */
export function skyEnvironment(renderer, sunDir) {
  const tex = canvasTexture(1024, 512, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#03050a');
    sky.addColorStop(0.48, '#0d1528');
    sky.addColorStop(0.6, '#1b3863');
    sky.addColorStop(1, '#0b1a33');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const u = Math.atan2(sunDir.z, sunDir.x) / (2 * Math.PI) + 0.5;
    const v = Math.asin(Math.max(-1, Math.min(1, sunDir.y))) / Math.PI + 0.5;
    const sx = u * W, sy = (1 - v) * H;
    for (const dx of [-W, 0, W]) {           // wrap around the seam
      const glow = g.createRadialGradient(sx + dx, sy, 0, sx + dx, sy, H * 0.5);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.12, 'rgba(255,252,246,1)');
      glow.addColorStop(0.32, 'rgba(226,234,246,0.7)');
      glow.addColorStop(0.6, 'rgba(120,140,175,0.25)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
    }
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}

export function buildNode(envMap) {
  const g = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const rod = (a, b, r, mat) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    return m;
  };

  // ---- materials
  const strut = new THREE.MeshStandardMaterial({ color: 0xc7ccd4, metalness: 0.9, roughness: 0.3, envMap });
  const hull = new THREE.MeshStandardMaterial({ color: 0x4a515c, metalness: 0.55, roughness: 0.45, envMap });
  const mli = new THREE.MeshStandardMaterial({ color: 0x9c7a36, metalness: 0.9, roughness: 0.42, envMap, envMapIntensity: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1424, metalness: 1, roughness: 0.08, envMap, envMapIntensity: 1.5 });
  // Wing face: a diagonal sheen like the AI1 renders, baked in, plus a light reflection on top.
  const wingFront = new THREE.MeshStandardMaterial({
    map: canvasTexture(330, 900, (c, W, H) => {
      const sheen = c.createLinearGradient(0, 0, W * 1.1, H * 0.62);
      sheen.addColorStop(0, '#f4f6fa');
      sheen.addColorStop(0.42, '#e3e8ef');
      sheen.addColorStop(0.56, '#7f8ca0');
      sheen.addColorStop(0.7, '#1c2738');
      sheen.addColorStop(1, '#0a1220');
      c.fillStyle = sheen; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(30,42,62,0.18)'; c.lineWidth = 1;
      for (let y = 0; y < H; y += 15) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      for (let x = 0; x < W; x += 15) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      c.fillStyle = 'rgba(18,26,40,0.85)';
      for (const x of [W / 3, (2 * W) / 3]) c.fillRect(x - 2, 0, 4, H);   // three panels per wing
      c.fillRect(0, 0, W, 3); c.fillRect(0, H - 3, W, 3); c.fillRect(0, 0, 3, H); c.fillRect(W - 3, 0, 3, H);
    }),
    metalness: 0.45, roughness: 0.3, envMap, envMapIntensity: 0.7,
  });
  const wingBack = new THREE.MeshStandardMaterial({ color: 0xd3d8df, metalness: 0.1, roughness: 0.75 });
  const wingEdge = new THREE.MeshStandardMaterial({ color: 0x59606b, metalness: 0.6, roughness: 0.4 });
  const radiator = new THREE.MeshStandardMaterial({
    map: canvasTexture(512, 64, (c, W, H) => {
      c.fillStyle = '#e4e8ee'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#aeb7c4'; c.lineWidth = 2;
      for (let y = 8; y < H; y += 11) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }  // fluid loops
    }),
    metalness: 0.2, roughness: 0.5, emissive: 0xffd2b0, emissiveIntensity: 0.32,
  });
  const rack = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  const rackDim = new THREE.MeshBasicMaterial({ color: 0x6fd6ff });

  // ---- bus: a compute module wrapped in gold blanket, racks visible on the Sun face
  const bus = new THREE.Group();
  bus.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.8, 2.4), hull));
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(3.46, 1.6, 2.46), mli);
  blanket.position.y = -0.95;
  bus.add(blanket);
  const lights = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.22), (i + j) % 3 ? rackDim : rack);
      m.position.set(-1.05 + i * 0.7, 0.25 + j * 0.42, 1.215);
      bus.add(m);
      lights.push(m);
    }
  }
  // four laser terminals: short barrels with a glass dome
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.4, 20), hull);
      base.rotation.z = Math.PI / 2;
      base.position.set(sx * 1.9, sy * 1.25, 0);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
      dome.rotation.z = -sx * Math.PI / 2;
      dome.position.set(sx * 2.1, sy * 1.25, 0);
      bus.add(base, dome);
    }
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 8, 32), strut);   // launch adapter
  ring.position.z = -1.25;
  bus.add(ring);
  bus.scale.setScalar(1.5);
  g.add(bus);

  // ---- two wings, each three panels, on a diamond truss from a rotary drive
  const WING_W = 11.5, WING_H = 30, ROOT = 8.6;
  for (const s of [1, -1]) {
    const drive = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 16), strut);
    drive.position.y = s * 3.25;
    g.add(drive);
    const A = new THREE.Vector3(0, s * 3.6, 0), B = new THREE.Vector3(0, s * ROOT, 0);
    const L = new THREE.Vector3(-1.1, s * (ROOT + 3.6) / 2, 0), R = new THREE.Vector3(1.1, s * (ROOT + 3.6) / 2, 0);
    for (const [a, b] of [[A, L], [L, B], [A, R], [R, B], [L, R], [A, B]]) g.add(rod(a, b, 0.06, strut));
    g.add(rod(new THREE.Vector3(-WING_W / 2, s * ROOT, 0), new THREE.Vector3(WING_W / 2, s * ROOT, 0), 0.09, strut));
    const wing = new THREE.Mesh(new THREE.BoxGeometry(WING_W, WING_H, 0.12),
      [wingEdge, wingEdge, wingEdge, wingEdge, wingFront, wingBack]);
    wing.position.y = s * (ROOT + 0.15 + WING_H / 2);
    g.add(wing);
    // navigation light at the outer corner
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: s > 0 ? 0x5dff8a : 0xff4a4a }));
    nav.position.set(s * WING_W / 2, s * (ROOT + WING_H), 0.2);
    g.add(nav);
    lights.push(nav);
  }

  // ---- deployable radiators: long, thin, segmented, across the bus and edge-on to the Sun
  const SEG = 4.1, GAP = 0.25, N = 4;
  for (const s of [1, -1]) {
    g.add(rod(new THREE.Vector3(s * 2.5, 0.4, 0), new THREE.Vector3(s * (2.8 + N * (SEG + GAP)), 0.4, 0), 0.07, strut));
    for (let i = 0; i < N; i++) {
      for (const dz of [-1.12, 1.12]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(SEG, 0.08, 2.1), radiator);
        panel.position.set(s * (2.9 + SEG / 2 + i * (SEG + GAP)), 0.4, dz);
        g.add(panel);
      }
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.8, 8), strut);
      hinge.rotation.x = Math.PI / 2;
      hinge.position.set(s * (2.9 + i * (SEG + GAP) - GAP / 2), 0.4, 0);
      g.add(hinge);
    }
  }

  g.userData.animate = (now) => {
    radiator.emissiveIntensity = 0.3 + 0.08 * Math.sin(now / 900);
    const blink = Math.floor(now / 1100) % 2 === 0;
    lights.forEach((m, i) => {
      if (m.geometry.type === 'SphereGeometry') m.visible = blink;
      else m.visible = Math.sin(now / 260 + i * 1.7) > -0.6;   // racks flicker with load
    });
  };
  return g;
}
