// "Across the mesh" on the mega-constellations page: a route between two cities through one shell
// of satellites linked by lasers in a +grid, and its delay next to light in a straight fibre.
//
// Shell size, altitude and inclination: Stock, Fraire and Hermanns, "Distributed On-Demand Routing
// for LEO Mega-Constellations: A Starlink Case Study", ASMS/SPSC 2022, doi:10.1109/asms/spsc55670.2022.9914716,
// §VI-A (Starlink's first shell, Walker Delta 53.0°: 1584/72/39 at 550 km). Four laser links per
// satellite, to the satellites ahead and behind in its plane and to one in each neighbouring plane:
// §II-C a). Shortest route by length, Dijkstra with a binary heap: §IV-A. The processing time per
// hop quoted under the tool (comparable to 1,000 km of light travel, 3.3 ms), and the street grid
// the summary compares the mesh to (a Manhattan Street Network): §IV-B.
//
// Everything else follows stop 2 of the home tour (assets/js/scene/scene.js), so that both draw the
// same route for the same moment: phasing factor 17 (the paper estimates 39); no links between the
// last plane and the first (the paper links them, shifted by the phasing factor); Earth radius
// 6,371 km (the paper uses 6,378.137); the shell's clock starts when the page opens and the Earth
// turns with the real sidereal time; each city reaches any satellite at least 25° above its horizon;
// light at C_KMS in vacuum and C_KMS / 1.468 in glass. Without JavaScript the page describes the tool.

import { C_KMS, gmst } from './astro.js';
import { RE_KM, MU_EARTH, latLon, spinY, circular, place, walker, coverageAngle, greatCircleKm } from './scene/orbits.js';

const PLANES = 72, PER_PLANE = 22, PHASING = 17, ALT_KM = 550, INC = 53;
const MIN_ELEV = 25;                         // degrees above the horizon to reach a satellite
const FIBRE_KMS = C_KMS / 1.468;             // light in glass
const TIME_SCALE = 60;                       // "Play" runs one simulated minute per second, as the tour
const DEG = Math.PI / 180;
const MIN_SIN = Math.sin(MIN_ELEV * DEG);
export const PERIOD_S = 2 * Math.PI * Math.sqrt((RE_KM + ALT_KM) ** 3 / MU_EARTH);
// Furthest latitude from which a satellite of the shell can ever be 25° up.
const REACH_DEG = INC + coverageAngle(ALT_KM, MIN_ELEV) / DEG;

/** The shell, its +grid links (in the tour's order) and a position buffer. */
export function makeShell() {
  const sats = circular(walker({ planes: PLANES, perPlane: PER_PLANE, f: PHASING, altKm: ALT_KM, inc: INC }));
  const adj = Array.from({ length: sats.n }, () => []);
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  for (let p = 0; p < PLANES; p++) {
    for (let j = 0; j < PER_PLANE; j++) {
      const i = p * PER_PLANE + j;
      link(i, p * PER_PLANE + ((j + 1) % PER_PLANE));                // same plane, next satellite
      if (p + 1 < PLANES) link(i, (p + 1) * PER_PLANE + j);          // next plane (none across the seam)
    }
  }
  return { sats, adj, pos: new Float32Array(sats.n * 3) };        // Float32, as the tour's buffer
}

/**
 * Shortest route between two [lat, lon] points at t seconds after `start` (ms since 1970).
 * Path: node ids, n = first city, n + 1 = second city. Lengths in Earth radii, as in the tour.
 */
export function route(shell, a, b, start, t) {
  const { sats, adj, pos } = shell, n = sats.n, SRC = n, DST = n + 1;
  place(sats, t, pos);
  const spin = gmst(new Date(start + t * 1000));
  const g = [spinY(latLon(a[0], a[1]), spin), spinY(latLon(b[0], b[1]), spin)];
  const dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
  const visible = (c, i) => {
    const x = pos[i * 3] - c[0], y = pos[i * 3 + 1] - c[1], z = pos[i * 3 + 2] - c[2];
    const r = Math.hypot(x, y, z);
    return (x * c[0] + y * c[1] + z * c[2]) / r > MIN_SIN ? r : 0;
  };
  // Binary heap on two parallel arrays, with the same order of comparisons and swaps as the tour's.
  const hd = [], hi = [];
  const swap = (p, q) => { let s = hd[p]; hd[p] = hd[q]; hd[q] = s; s = hi[p]; hi[p] = hi[q]; hi[q] = s; };
  const push = (d, i) => {
    hd.push(d); hi.push(i);
    let k = hd.length - 1;
    while (k > 0) { const q = (k - 1) >> 1; if (hd[q] <= hd[k]) break; swap(q, k); k = q; }
  };
  const pop = () => {
    const d = hd[0], i = hi[0], ld = hd.pop(), li = hi.pop();
    if (hd.length) {
      hd[0] = ld; hi[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === k) break;
        swap(m, k); k = m;
      }
    }
    return [d, i];
  };
  dist[SRC] = 0;
  let seenA = false;
  for (let i = 0; i < n; i++) { const r = visible(g[0], i); if (r) { seenA = true; dist[i] = r; prev[i] = SRC; push(r, i); } }
  while (hd.length) {
    const [d, u] = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === DST) break;
    const r = visible(g[1], u);
    if (r && d + r < dist[DST]) { dist[DST] = d + r; prev[DST] = u; push(dist[DST], DST); }
    for (const w of adj[u]) {
      const len = Math.hypot(pos[u * 3] - pos[w * 3], pos[u * 3 + 1] - pos[w * 3 + 1], pos[u * 3 + 2] - pos[w * 3 + 2]);
      if (d + len < dist[w]) { dist[w] = d + len; prev[w] = u; push(dist[w], w); }
    }
  }
  const gcKm = greatCircleKm(a, b);
  const out = { spin, seen: [seenA, true], path: [], km: NaN, ms: NaN, gcKm, fibreMs: (gcKm / FIBRE_KMS) * 1000 };
  if (!isFinite(dist[DST])) {
    out.seen[1] = false;
    for (let i = 0; i < n; i++) if (visible(g[1], i)) { out.seen[1] = true; break; }
    return out;
  }
  for (let u = DST; u !== -1; u = prev[u]) out.path.push(u);
  out.path.reverse();
  out.km = dist[DST] * RE_KM;
  out.ms = (out.km / C_KMS) * 1000;
  return out;
}

// ---------------------------------------------------------------- the tool on the page
const box = globalThis.document?.getElementById('mesh');
if (box) {
  box.hidden = false;
  const $ = (id) => document.getElementById(id);
  const from = $('mesh-from'), to = $('mesh-to'), time = $('mesh-time'), play = $('mesh-play');
  const canvas = $('mesh-map'), ctx = canvas.getContext('2d');
  const verdict = $('mesh-verdict');
  const shell = makeShell();
  const start = Date.now();
  const city = (sel) => {
    const o = sel.selectedOptions[0];
    const [lat, lon] = o.dataset.ll.split(',').map(Number);
    return { name: o.textContent.trim(), lat, lon };
  };
  time.max = String(Math.floor(PERIOD_S / 30) * 30);

  const fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const whenShort = (t) => {
    const T = Math.round(t), m = Math.floor(T / 60), s = T % 60;
    if (T < 1) return 'now';
    return `in ${m ? `${m} min` : ''}${m && s ? ' ' : ''}${s ? `${s} s` : ''}`;
  };
  const whenLong = (t) => {
    const T = Math.round(t), m = Math.floor(T / 60), s = T % 60;
    if (T < 1) return 'now';
    const parts = [];
    if (m) parts.push(m === 1 ? '1 minute' : `${m} minutes`);
    if (s) parts.push(`${s} seconds`);
    return `${parts.join(' ')} from now`;
  };

  // ------------------------------------------------ map: equirectangular, cropped to the inhabited latitudes
  const LAT_N = 80, LAT_S = -60;
  const tex = new Image();
  let texReady = false, base = null, W = 0, H = 0, px = 1, lon0 = 0, last = null;
  const toXY = (lat, lon) => [(((lon - lon0 + 540) % 360) / 360) * W, ((LAT_N - lat) / (LAT_N - LAT_S)) * H];
  const unitXY = (v) => {
    const r = Math.hypot(v[0], v[1], v[2]);
    return toXY(Math.asin(v[1] / r) / DEG, Math.atan2(-v[2], v[0]) / DEG);
  };

  function buildBase() {
    base = document.createElement('canvas');
    base.width = W; base.height = H;
    const b = base.getContext('2d');
    b.fillStyle = '#0c1324';
    b.fillRect(0, 0, W, H);
    if (texReady) {
      const sy = ((90 - LAT_N) / 180) * tex.naturalHeight, sh = ((LAT_N - LAT_S) / 180) * tex.naturalHeight;
      const x0 = toXY(0, -180)[0];
      for (const x of [x0, x0 - W]) b.drawImage(tex, 0, sy, tex.naturalWidth, sh, x, 0, W, H);
      b.fillStyle = 'rgba(7, 11, 22, 0.58)';
      b.fillRect(0, 0, W, H);
    }
    b.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    b.lineWidth = px;
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = toXY(lat, 0)[1];
      b.beginPath(); b.moveTo(0, y); b.lineTo(W, y); b.stroke();
    }
  }

  function resize() {
    const css = canvas.getBoundingClientRect().width;
    if (!css) return;
    px = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(css * px), h = Math.round(((css * (LAT_N - LAT_S)) / 360) * px);   // one degree, one size both ways
    if (w === W && h === H && base) return;
    W = canvas.width = w; H = canvas.height = h;
    px = W / css;
    buildBase();
    if (last) draw(last);
  }

  // Points along the shorter arc between two unit vectors.
  function arc(u, v, steps, outPts) {
    const d = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      if (d < 1e-9) { outPts.push(u); continue; }
      const a = Math.sin((1 - f) * d) / Math.sin(d), c = Math.sin(f * d) / Math.sin(d);
      outPts.push([a * u[0] + c * v[0], a * u[1] + c * v[1], a * u[2] + c * v[2]]);
    }
    return outPts;
  }
  function polyline(pts) {
    ctx.beginPath();
    let prevX = null;
    for (const p of pts) {
      const [x, y] = unitXY(p);
      if (prevX === null || Math.abs(x - prevX) > W / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      prevX = x;
    }
    ctx.stroke();
  }
  // Centre the map on the Pacific when the great circle would cross the map's edge.
  function pickCentre(a, b) {
    const pts = arc(latLon(a.lat, a.lon), latLon(b.lat, b.lon), 48, []);
    let prevLon = null;
    for (const p of pts) {
      const lon = Math.atan2(-p[2], p[0]) / DEG;
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) return 180;
      prevLon = lon;
    }
    return 0;
  }

  function draw(s) {
    if (!base) return;
    const { r, a, b } = s;
    ctx.drawImage(base, 0, 0);
    // every satellite of the shell, body-fixed
    const c = Math.cos(-r.spin), sn = Math.sin(-r.spin), pos = shell.pos, fixed = new Array(shell.sats.n);
    const small = W / px < 640;                     // phone-sized map: finer, fainter dots
    ctx.fillStyle = small ? 'rgba(130, 224, 212, 0.5)' : 'rgba(130, 224, 212, 0.6)';
    const d = (small ? 0.55 : 0.9) * px;
    ctx.beginPath();
    for (let i = 0; i < shell.sats.n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const v = [x * c + z * sn, y, -x * sn + z * c];
      fixed[i] = v;
      const [X, Y] = unitXY(v);
      ctx.rect(X - d, Y - d, 2 * d, 2 * d);
    }
    ctx.fill();
    const ua = latLon(a.lat, a.lon), ub = latLon(b.lat, b.lon);
    // great circle, where a perfectly straight fibre would run
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.strokeStyle = 'rgba(233, 237, 245, 0.9)';
    ctx.lineWidth = 1.6 * px;
    polyline(arc(ua, ub, 96, []));
    ctx.setLineDash([]);
    // the route: up, across the mesh, down
    if (r.path.length) {
      const n = shell.sats.n, nodes = r.path.map((u) => (u === n ? ua : u === n + 1 ? ub : fixed[u]));
      const pts = [];
      for (let k = 0; k + 1 < nodes.length; k++) arc(nodes[k], nodes[k + 1], 8, pts);
      ctx.strokeStyle = 'rgba(7, 11, 22, 0.75)'; ctx.lineWidth = 4.5 * px; polyline(pts);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2 * px; polyline(pts);
      ctx.fillStyle = '#ffffff';
      for (const v of nodes.slice(1, -1)) {
        const [X, Y] = unitXY(v);
        ctx.beginPath(); ctx.arc(X, Y, 2.4 * px, 0, 2 * Math.PI); ctx.fill();
      }
    }
    // the two cities, labelled
    ctx.font = `700 ${12.5 * px}px "Inria Sans", sans-serif`;
    ctx.textBaseline = 'middle';
    for (const [v, place] of [[ua, a], [ub, b]]) {
      const [X, Y] = unitXY(v);
      ctx.beginPath(); ctx.arc(X, Y, 4.6 * px, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 2 * px; ctx.strokeStyle = '#070b16'; ctx.stroke();
      const w = ctx.measureText(place.name).width, right = X + 9 * px + w < W - 4 * px;
      const tx = right ? X + 9 * px : X - 9 * px - w, ty = Math.min(H - 9 * px, Math.max(9 * px, Y));
      ctx.lineWidth = 3.5 * px; ctx.strokeStyle = 'rgba(7, 11, 22, 0.9)';
      ctx.strokeText(place.name, tx, ty);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(place.name, tx, ty);
    }
  }

  // ------------------------------------------------ readouts and summary
  let t = 0, playing = false, lastT = 0, raf = 0, said = '';
  const reach = (p) => Math.abs(p.lat) > REACH_DEG;

  function sentence(s) {
    const { r, a, b } = s, when = whenShort(t);
    if (a.name === b.name) return 'Choose two different cities.';
    const far = [a, b].find(reach);
    if (far) {
      return `${far.name} lies at ${Math.round(Math.abs(far.lat))}° ${far.lat > 0 ? 'north' : 'south'}, out of this shell's reach: its satellites never fly more than ${INC}° from the equator, so none ever rises ${MIN_ELEV}° above ${far.name}'s horizon.`;
    }
    if (!r.path.length) {
      const gap = r.seen[0] ? b : a;
      return `${when === 'now' ? 'Right now' : `${when[0].toUpperCase()}${when.slice(1)}`}, no satellite is ${MIN_ELEV}° above ${gap.name}'s horizon. Move the time on a little.`;
    }
    const hops = r.path.length - 3;
    const via = hops === 0 ? 'up to one satellite that both cities see and straight down again'
      : `up to a satellite, ${hops} laser hop${hops === 1 ? '' : 's'} across the mesh and down again`;
    let text = `${a.name} to ${b.name}, ${when}: ${via}, ${fmt.format(r.km)} km in all. Light needs ${r.ms.toFixed(0)} ms along that path, and would need ${r.fibreMs.toFixed(0)} ms in a perfectly straight fibre.`;
    if (Math.round(r.ms) > Math.round(r.fibreMs)) {
      if (r.gcKm < 3000) text += ' Over so short a distance, the climb to orbit and back costs more than the speed of light in vacuum saves.';
      else text += ' The mesh links each satellite only along its orbit and across to the next ones, so the route turns corners like a taxi in a street grid, and here the straight fibre would arrive first.';
    }
    return text;
  }

  function show(s, announce) {
    const { r } = s, ok = r.path.length > 0 && s.a.name !== s.b.name;
    $('mesh-hops').textContent = ok ? String(r.path.length - 3) : '–';
    $('mesh-km').innerHTML = ok ? `${fmt.format(r.km)} <small>km</small>` : '–';
    $('mesh-ms').textContent = ok ? `${r.ms.toFixed(0)} ms` : '–';
    $('mesh-fibre').textContent = s.a.name !== s.b.name ? `${r.fibreMs.toFixed(0)} ms` : '–';
    const top = Math.max(ok ? r.ms : 0, r.fibreMs) || 1;
    $('mesh-fill-space').style.width = ok ? `${(100 * r.ms) / top}%` : '0';
    $('mesh-fill-fibre').style.width = s.a.name !== s.b.name ? `${(100 * r.fibreMs) / top}%` : '0';
    const text = sentence(s);
    if (text !== said) { said = text; verdict.textContent = text; }
    if (announce) {
      canvas.setAttribute('aria-label', ok
        ? `World map: the route from ${s.a.name} to ${s.b.name} through ${r.path.length - 2} satellites, beside the dashed great circle between them`
        : `World map of the shell's satellites, with ${s.a.name} and ${s.b.name} marked`);
    }
  }

  function update(announce = true) {
    const a = city(from), b = city(to);
    lon0 = pickCentre(a, b);
    if (base && lon0 !== update.lon0) buildBase();
    update.lon0 = lon0;
    const r = route(shell, [a.lat, a.lon], [b.lat, b.lon], start, t);
    last = { r, a, b };
    $('mesh-time-out').textContent = whenShort(t);
    time.setAttribute('aria-valuetext', whenLong(t));
    show(last, announce);
    draw(last);
  }

  // ------------------------------------------------ time: the slider, and Play at 60 times real speed
  // While playing, the summary keeps changing but is not announced (aria-live off, as in the APG
  // auto-rotating carousel); pausing announces the moment it stopped at.
  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    play.textContent = 'Play';
    verdict.setAttribute('aria-live', 'polite');
  }
  function setPlaying(on) {
    if (!on) {
      stop();
      t = Math.round(t / 30) * 30;
      time.value = String(t);
      update();
      const text = verdict.textContent;              // re-set it a moment later, so it is read out
      verdict.textContent = '';
      setTimeout(() => { if (!verdict.textContent) verdict.textContent = text; }, 80);
      return;
    }
    playing = true;
    play.textContent = 'Pause';
    verdict.setAttribute('aria-live', 'off');
    if (t >= Number(time.max)) t = 0;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
  // About 30 frames a second is plenty at this pace; with reduced motion, one step a second.
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lastDraw = 0;
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    t = Math.min(Number(time.max), t + dt * TIME_SCALE);
    if (t >= Number(time.max)) return setPlaying(false);
    if (now - lastDraw > (calm.matches ? 990 : 30)) {
      lastDraw = now;
      time.value = String(t);
      update(false);
    }
    raf = requestAnimationFrame(tick);
  }

  from.addEventListener('change', () => update());
  to.addEventListener('change', () => update());
  time.addEventListener('input', () => {
    if (playing) stop();
    t = Number(time.value);
    update();
  });
  play.addEventListener('click', () => setPlaying(!playing));

  // Stop playing once the tool is scrolled away; fetch the Earth map only when it comes near.
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !tex.src) tex.src = '/assets/img/tex/earth-day.jpg';
      if (!e.isIntersecting && playing) setPlaying(false);
    }
  }, { rootMargin: '400px 0px' }).observe(box);
  tex.addEventListener('load', () => { texReady = true; buildBase(); if (last) draw(last); });
  new ResizeObserver(resize).observe(canvas);
  document.fonts?.ready.then(() => last && draw(last));
  resize();
  update();
}
