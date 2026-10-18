// The planet and its sky, shared by the landing tour (scene.js) and the private timeline
// (/timeline/globe.js), so both pages draw the same Earth: the day and night maps lit by one sun,
// a blue rim and atmosphere, a navy glow behind it, a faint nebula and the stars.
// Unit: one Earth radius. Texture longitude 0 lies on +X, north on +Y (see orbits.js latLon).

import * as THREE from 'three';

/** A soft round dot, for stars and other glowing points. */
export function dotTexture() {
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

/** Earth's surface: day map where the sun shines, city lights past the terminator, a blue rim. */
export function earthMaterial(dayTex, nightTex, sunDir) {
  return new THREE.ShaderMaterial({
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
}

/** The thin glow just outside the limb, brighter on the day side. */
export function atmosphere(sunDir) {
  return new THREE.Mesh(new THREE.SphereGeometry(1.025, 96, 64), new THREE.ShaderMaterial({
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
}

/** Two layers of stars on a sphere of radius 1500, faint and many, then brighter and few. */
export function stars(map) {
  const make = (n, size, opacity) => {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 1500;
      p.set([r * Math.sqrt(1 - u * u) * Math.cos(th), r * u, r * Math.sqrt(1 - u * u) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xc9d6ff, size, sizeAttenuation: false, map, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  };
  return [make(2600, 1.6, 0.55), make(500, 2.6, 0.8)];
}

/**
 * The backdrop: a navy glow centred on `at` (fractions of the screen, from the top left), the
 * same gradient as the landing stage's CSS background, and a faint nebula fixed to the sky like
 * the stars. With edge = 1 both fade to the page colour along the bottom edge.
 * `res` must hold the drawing-buffer size. Returns [glow, sky]; draw them before anything else.
 */
export function backdrop({ res, edge, at, skyTex, strength = 0.11 }) {
  const SCREEN = /* glsl */`
    uniform vec2 res; uniform float edge;
    float dither() { return (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; }
    float bottom() { return edge * clamp((0.2 - gl_FragCoord.y / res.y) / 0.2, 0.0, 1.0); }`;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { res: { value: res }, edge, at: { value: at } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: SCREEN + /* glsl */`
      uniform vec2 at;
      void main() {
        vec2 uv = vec2(gl_FragCoord.x / res.x, 1.0 - gl_FragCoord.y / res.y);
        float t = clamp(length((uv - at) / vec2(0.75, 0.85)), 0.0, 1.0);
        vec3 col = mix(vec3(9.0, 15.0, 30.0), vec3(28.0, 43.0, 88.0), 0.5 * (1.0 - t)) / 255.0;
        col = mix(col, vec3(7.0, 11.0, 22.0) / 255.0, bottom());
        gl_FragColor = vec4(col + dither(), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  }));
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 64, 32), new THREE.ShaderMaterial({
    uniforms: { res: { value: res }, edge, map: { value: skyTex }, strength: { value: skyTex ? strength : 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SCREEN + /* glsl */`
      uniform sampler2D map; uniform float strength; varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb * strength * (1.0 - bottom()) + dither(), 1.0); }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.renderOrder = -2;                               // drawn first, under everything else
  sky.renderOrder = -1;
  glow.frustumCulled = sky.frustumCulled = false;
  return [glow, sky];
}
