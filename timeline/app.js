'use strict';
/* World timeline: an orthographic globe that replays every stay and trip.
 *
 * Playback runs on "tau" (seconds at 1x), not on calendar time. The script is a list of
 * segments: a stay (calendar time advances, slowly on trips, fast at home) or a move
 * (an arc flies from one place to the next while calendar time crosses the gap).
 * Everything drawn is a pure function of tau, so frames can be rendered for video.
 */
(() => {
  const T = window.TIMELINE;
  const P = T.places;
  const DAY_MS = 864e5;

  // ------------------------------------------------------------------ formatting
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtMonth = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtDay = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtShort = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtShortY = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fmtNum = new Intl.NumberFormat('en');
  const regions = new Intl.DisplayNames(['en'], { type: 'region' });
  const date = d => new Date(Math.floor(d) * DAY_MS);
  const yearOf = d => date(d).getUTCFullYear();
  const country = cc => { try { return cc ? regions.of(cc) : ''; } catch { return cc; } };
  const flag = cc => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0))) : '');
  const placeName = p => (p.coarse ? country(p.cc) : p.name);
  const fullName = p => (p.coarse ? `${flag(p.cc)} ${country(p.cc)}` : `${flag(p.cc)} ${p.name}, ${country(p.cc)}`);
  const ll = id => [P[id].lon, P[id].lat];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = d3.easeCubicInOut;
  const fmtRange = (s, e) => {
    if (s === e) return fmtShort.format(date(s));
    const f = yearOf(s) === yearOf(e) ? fmtShort : fmtShortY;
    return f.formatRange(date(s), date(e));
  };
  const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ colors
  // Residences: categorical slots 1-4 (validated on the dark surface), in order of first appearance.
  const RES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
  const resPlaces = [...new Set(T.residences.map(r => r.p))];
  const resColor = new Map(resPlaces.map((p, i) => [p, RES_COLORS[i] || '#898781']));
  // Days spent in a country: one-hue sequential ramp (violet, a hue the residences do not use).
  const countryRamp = d3.scaleSequentialLog(d3.interpolateLab('#302c58', '#7d74c9')).domain([1, 2000]).clamp(true);

  // ------------------------------------------------------------------ the script
  const K_HOME = 2.6, K_AWAY = 4.2;
  const W_HOME = 0.008, MIN_HOME = 0.4;      // seconds per day / minimum per stay
  const W_AWAY = 0.14, MIN_AWAY = 0.6;
  const W_GAP = 0.006;
  const TARGET = 720;
  const INTRO = 3, OUTRO = 7;
  const flyDur = d => 0.25 + 1.9 * (d / Math.PI) ** 0.8;   // never compressed: 0.3 s hop, 1.4 s ocean
  const stayK = s => (s.home ? K_HOME : K_AWAY);

  // Short regional trips (hidden from the list by default) stay out of the playback:
  // their days fold into the surrounding home stay.
  const stays = [];
  for (const s0 of T.stays) {
    const s = s0.trip >= 0 && T.trips[s0.trip].minor
      ? { ...s0, p: stays.length ? stays[stays.length - 1].p : s0.p, home: 1, trip: -1 } : s0;
    const prev = stays[stays.length - 1];
    if (prev && prev.home && s.home && prev.p === s.p) stays[stays.length - 1] = { ...prev, e: s.e, n: prev.n + s.n };
    else stays.push(s);
  }

  // A merged stay can start before its place's first photo; show the place from the stay on.
  for (const s of T.stays) if (s.s < P[s.p].first) P[s.p].first = s.s;

  const segs = [];
  function addMove(m) {
    m.type = 'move';
    m.d = d3.geoDistance(m.a, m.b);
    m.interp = d3.geoInterpolate(m.a, m.b);
    const kMid = Math.max(0.92, 1.05 / Math.sin(Math.min(m.d / 2 + 0.12, Math.PI / 2)));
    m.bump = Math.max(0, (Math.log(m.k0) + Math.log(m.k1)) / 2 - Math.log(kMid));
    m.H = Math.min(0.3, 0.5 * m.d);
    m.n = clamp(Math.ceil(m.d * 60), 12, 96);
    segs.push(m);
  }

  const first = stays[0];
  addMove({ a: [ll(first.p)[0] + 100, 15], b: ll(first.p), k0: 0.9, k1: stayK(first),
            t0: first.s, t1: first.s, dur: INTRO, arc: false, intro: true, fixed: true });
  stays.forEach((s, i) => {
    const prev = stays[i - 1];
    if (prev && prev.p !== s.p) {
      const gap = Math.max(0, s.s - (prev.e + 1));
      const a = ll(prev.p), b = ll(s.p);
      addMove({ from: prev.p, to: s.p, a, b, k0: stayK(prev), k1: stayK(s), t0: prev.e + 1, t1: s.s,
                fly: flyDur(d3.geoDistance(a, b)), dur: gap * W_GAP, arc: true, toStay: i });
    }
    const days = s.e - s.s + 1;
    const dur = s.home ? Math.max(MIN_HOME, days * W_HOME)
      : Math.max(MIN_AWAY, W_AWAY * (Math.min(days, 10) + 0.4 * Math.max(0, days - 10)));
    const t0 = prev && prev.p === s.p ? prev.e + 1 : s.s;
    segs.push({ type: 'stay', stay: s, idx: i, place: s.p, k: stayK(s), t0, t1: s.e + 1, dur });
  });
  const lastStay = stays[stays.length - 1];
  segs.push({ type: 'outro', a: ll(lastStay.p), b: [-38, 8], k0: stayK(lastStay), k1: 0.95,
              t0: lastStay.e + 1, t1: lastStay.e + 1, dur: OUTRO, fixed: true,
              interp: d3.geoInterpolate(ll(lastStay.p), [-38, 8]) });

  // Fit the story into TARGET seconds at 1x by compressing stays and gaps; flights,
  // intro and outro keep their length.
  const kept = d3.sum(segs, g => (g.fixed ? g.dur : g.fly || 0));
  const raw = d3.sum(segs, g => (g.fixed ? 0 : g.dur));
  const scale = Math.min(1, Math.max(0.05, TARGET - kept) / raw);
  let tauAcc = 0, kmAcc = 0;
  for (const g of segs) {
    if (g.type === 'move' && !g.fixed) g.dur = g.fly + g.dur * scale;
    else if (!g.fixed) g.dur = Math.max(0.25, g.dur * scale);
    g.tau0 = tauAcc;
    g.km0 = kmAcc;
    tauAcc += g.dur;
    if (g.type === 'move' && g.arc) kmAcc += g.d * 6371;
  }
  const TOTAL = tauAcc;
  const KM_TOTAL = kmAcc;
  const segTau = segs.map(g => g.tau0);
  const moves = segs.filter(g => g.type === 'move' && g.arc);
  const moveEnd = moves.map(g => g.tau0 + g.dur);
  const D0 = stays[0].s, D1 = lastStay.e + 1;

  function segAt(tau) { return clamp(d3.bisectRight(segTau, tau) - 1, 0, segs.length - 1); }

  function stateAt(tau) {
    const i = segAt(tau), g = segs[i];
    const f = g.dur > 0 ? clamp((tau - g.tau0) / g.dur, 0, 1) : 1;
    const t = g.t0 + (g.t1 - g.t0) * f;
    let center, k, e = f;
    if (g.type === 'stay') {
      center = ll(g.place);
      k = g.k;
    } else if (g.type === 'move') {
      e = ease(f);
      // On long flights the camera trails toward the arc's midpoint so its height shows.
      const lag = g.arc ? clamp(g.d / 1.2, 0, 0.65) * Math.sin(Math.PI * f) : 0;
      center = g.interp(e + (0.5 - e) * lag);
      k = Math.exp(Math.log(g.k0) + (Math.log(g.k1) - Math.log(g.k0)) * e - g.bump * Math.sin(Math.PI * f));
    } else {
      const u = ease(Math.min(1, f / 0.6));
      const c = g.interp(u);
      center = [c[0] - 30 * Math.max(0, (f - 0.6) / 0.4), c[1]];
      k = Math.exp(Math.log(g.k0) + (Math.log(g.k1) - Math.log(g.k0)) * u);
    }
    const km = g.km0 + (g.type === 'move' && g.arc ? g.d * 6371 * e : 0);
    return { i, g, f, e, t, center, k, km };
  }

  function tauOfDay(day) {
    let lo = 0, hi = segs.length - 1, ans = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (segs[m].t0 <= day) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    for (let j = ans; j >= 0; j--) {
      const g = segs[j];
      if (g.t1 > g.t0 && g.t0 <= day) return g.tau0 + clamp((day - g.t0) / (g.t1 - g.t0), 0, 1) * g.dur;
    }
    return 0;
  }

  // Where to land when jumping to a trip: the flight into its first stay.
  const tripTau = new Map();
  segs.forEach((g, i) => {
    if (g.type !== 'stay' || g.stay.trip < 0 || tripTau.has(g.stay.trip)) return;
    const prev = segs[i - 1];
    tripTau.set(g.stay.trip, prev && prev.type === 'move' ? prev.tau0 : g.tau0);
  });
  const placeTau = P.map(p => tauOfDay(p.first));

  // ------------------------------------------------------------------ cumulative facts
  const ccInfo = new Map();
  for (const p of P) {
    if (!p.cc) continue;
    const c = ccInfo.get(p.cc) || { cc: p.cc, num: T.iso[p.cc], first: Infinity, iv: [] };
    c.first = Math.min(c.first, p.first);
    ccInfo.set(p.cc, c);
  }
  for (const s of T.stays) {
    const c = ccInfo.get(P[s.p].cc);
    if (c) c.iv.push([s.s, s.e + 1]);
  }
  for (const c of ccInfo.values()) c.tauFirst = tauOfDay(c.first);
  const daysIn = (c, t) => {
    let n = 0;
    for (const [a, b] of c.iv) { if (a >= t) break; n += Math.min(b, t) - a; }
    return Math.max(n, 1);
  };
  const sorted = a => a.sort((x, y) => x - y);
  const ccFirst = sorted([...ccInfo.values()].map(c => c.first));
  const placeFirst = sorted(P.filter(p => !p.coarse).map(p => p.first));
  const tripFirst = sorted(T.trips.filter(t => !t.minor).map(t => t.s));
  const countLE = (arr, t) => d3.bisectRight(arr, t);
  const dots = T.dots;                       // [lat, lon, firstDay, n], sorted by day
  const dotDays = dots.map(d => d[2]);
  const vec = (lon, lat) => {
    const l = lon * Math.PI / 180, f = lat * Math.PI / 180;
    return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)];
  };
  const dotVec = dots.map(d => vec(d[1], d[0]));
  const placeVec = P.map(p => vec(p.lon, p.lat));
  const drawOrder = [...P].sort((a, b) => resColor.has(a.id) - resColor.has(b.id) || a.days - b.days);
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const residenceAt = t => {
    let r = T.residences[0];
    for (const x of T.residences) if (x.s <= t) r = x;
    return r;
  };

  // ------------------------------------------------------------------ world geometry
  function prepWorld(topo) {
    const feats = topojson.feature(topo, topo.objects.countries).features;
    return {
      land: topojson.feature(topo, topo.objects.land),
      borders: topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b),
      byNum: new Map(feats.map(f => [String(f.id).padStart(3, '0'), f])),
    };
  }
  const W110 = prepWorld(window.WORLD['110m']);
  const W50 = prepWorld(window.WORLD['50m']);
  const graticule = d3.geoGraticule10();

  // ------------------------------------------------------------------ DOM
  const $ = id => document.getElementById(id);
  const app = $('app'), canvas = $('globe'), stars = $('stars'), tooltip = $('tooltip');
  const ctx = canvas.getContext('2d');
  const proj = d3.geoOrthographic().clipAngle(90).precision(0.4);
  const path = d3.geoPath(proj, ctx);
  const params = new URLSearchParams(location.search);
  const exportMode = params.has('export');
  if (exportMode) app.classList.add('export');

  let W = 0, H = 0, R0 = 1, dpr = 1;
  let tau = TOTAL, playing = false, speed = 1, lastNow = null;
  let manual = null;                // {center, k} while the viewer drags or zooms
  let showMinor = false;
  let screenPlaces = [];
  let lastUI = {};

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = app.clientWidth;
    H = app.clientHeight;
    for (const c of [canvas, stars]) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wide = W > 900;
    const barH = exportMode ? 0 : $('bar').offsetHeight;
    const panel = wide && !exportMode && !app.classList.contains('no-trips') ? 300 + 40 : 0;
    const top = wide && !exportMode ? 40 : 150;
    const availW = W - panel, availH = H - barH - top;
    R0 = Math.min(availW, availH) * 0.42;
    proj.translate([availW / 2, top + availH / 2]);
    drawStars();
    buildScrub();
    lastUI = {};
  }

  function drawStars() {
    const c = stars.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0b0d10';
    c.fillRect(0, 0, W, H);
    const rnd = d3.randomLcg(7);
    for (let i = 0; i < 420; i++) {
      const a = 0.12 + 0.5 * rnd() ** 3;
      c.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      const s = rnd() < 0.08 ? 1.4 : 0.9;
      c.fillRect(rnd() * W, rnd() * H, s, s);
    }
  }

  // ------------------------------------------------------------------ drawing
  function project(p, h, cx, cy) {
    const s = proj(p);
    return [cx + (s[0] - cx) * (1 + h), cy + (s[1] - cy) * (1 + h)];
  }

  // Polyline of an arc raised above the surface; hidden where the globe occludes it.
  function arcPath(g, f0, f1, hs, center, cx, cy) {
    const n = Math.max(4, Math.ceil(g.n * (f1 - f0)));
    let pen = false;
    for (let j = 0; j <= n; j++) {
      const f = f0 + (f1 - f0) * j / n;
      const p = g.interp(f);
      const h = g.H * hs * Math.sin(Math.PI * f);
      const gam = d3.geoDistance(p, center);
      if (gam > Math.PI / 2 && (1 + h) * Math.sin(gam) < 1) { pen = false; continue; }
      const [x, y] = project(p, h, cx, cy);
      if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
    }
  }

  function render(tau, clock) {
    const st = stateAt(tau);
    const view = manual || st;
    proj.scale(R0 * view.k).rotate([-view.center[0], -view.center[1]]);
    const R = R0 * view.k;
    const [cx, cy] = proj.translate();
    const center = view.center;
    const cvec = vec(center[0], center[1]);
    const t = st.t;
    ctx.clearRect(0, 0, W, H);

    // atmosphere, ocean, graticule
    const atm = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.13);
    atm.addColorStop(0, 'rgba(90,150,255,0.24)');
    atm.addColorStop(1, 'rgba(90,150,255,0)');
    ctx.fillStyle = atm;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.13, 0, 2 * Math.PI); ctx.fill();
    const oc = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    oc.addColorStop(0, '#18243a');
    oc.addColorStop(1, '#0a111c');
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = oc; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 0.6; ctx.stroke();

    // land, visited countries, borders
    const world = view.k >= 2 ? W50 : W110;
    ctx.beginPath(); path(world.land); ctx.fillStyle = '#272b33'; ctx.fill();
    for (const c of ccInfo.values()) {
      if (c.tauFirst > tau) continue;
      const f = world.byNum.get(c.num);
      if (!f) continue;
      ctx.globalAlpha = 0.75 * clamp((tau - c.tauFirst) / 0.8, 0.15, 1);
      ctx.beginPath(); path(f); ctx.fillStyle = countryRamp(daysIn(c, t)); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); path(world.borders); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.6; ctx.stroke();

    // past arcs: recent ones still raised, older ones settled on the surface
    ctx.globalCompositeOperation = 'lighter';
    const nDone = d3.bisectRight(moveEnd, tau);
    const nFlat = d3.bisectRight(moveEnd, tau - 9);
    if (nFlat > 0) {
      ctx.beginPath();
      path({ type: 'MultiLineString', coordinates: moves.slice(0, nFlat).map(g => [g.a, g.b]) });
      ctx.strokeStyle = 'rgba(255,236,205,0.09)'; ctx.lineWidth = 1; ctx.stroke();
    }
    for (let j = nFlat; j < nDone; j++) {
      const g = moves[j], age = tau - moveEnd[j], hs = Math.exp(-age / 2.5);
      ctx.beginPath(); arcPath(g, 0, 1, hs, center, cx, cy);
      ctx.strokeStyle = `rgba(255,236,205,${(0.09 + 0.45 * hs).toFixed(3)})`; ctx.lineWidth = 1 + hs; ctx.stroke();
    }

    // footprints
    ctx.fillStyle = 'rgba(255,238,205,0.55)';
    const nDots = d3.bisectRight(dotDays, t);
    for (let j = 0; j < nDots; j++) {
      if (dot3(dotVec[j], cvec) < 0.02) continue;
      const d = dots[j], s = proj([d[1], d[0]]);
      ctx.fillRect(s[0] - 0.75, s[1] - 0.75, 1.5, 1.5);
    }
    ctx.globalCompositeOperation = 'source-over';

    // places
    screenPlaces = [];
    const zoomR = 0.85 + 0.15 * Math.min(view.k, 4);
    const currentPlace = st.g.type === 'stay' ? st.g.place : null;
    for (const p of drawOrder) {
      if (placeTau[p.id] > tau || dot3(placeVec[p.id], cvec) < 0.03) continue;
      const [x, y] = proj([p.lon, p.lat]);
      let r = clamp(1.6 + Math.log2(1 + p.days) * 0.7, 1.6, 6.5) * zoomR;
      const age = tau - placeTau[p.id];
      if (age >= 0 && age < 1.4) {
        const u = age / 1.4;
        ctx.beginPath(); ctx.arc(x, y, r + 22 * u, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - u)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke();
        r *= 1 + 0.8 * (1 - u);
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = '#f3f1ea'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(11,13,16,0.9)'; ctx.stroke();   // surface ring
      if (resColor.has(p.id)) {
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = resColor.get(p.id); ctx.lineWidth = 2; ctx.stroke();
      }
      screenPlaces.push({ p, x, y, r: r + 3, age });
    }

    // the flight in progress
    if (st.g.type === 'move' && st.g.arc) {
      const g = st.g, e = st.e;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); arcPath(g, 0, e, 1, center, cx, cy);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); arcPath(g, Math.max(0, e - 0.12), e, 1, center, cx, cy);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();
      const [hx, hy] = project(g.interp(e), g.H * Math.sin(Math.PI * e), cx, cy);
      const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      glow.addColorStop(0, 'rgba(255,255,255,0.9)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy, 14, 0, 2 * Math.PI); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // pulse on the current place
    if (currentPlace != null && dot3(placeVec[currentPlace], cvec) > 0.03) {
      const [x, y] = proj(ll(currentPlace));
      const ph = (clock / 1600) % 1;
      ctx.beginPath(); ctx.arc(x, y, 7 + 16 * ph, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(255,255,255,${(0.8 * (1 - ph)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke();
    }

    drawLabels(st, view, currentPlace);
    return st;
  }

  function drawLabels(st, view, currentPlace) {
    const cand = [];
    for (const s of screenPlaces) {
      const p = s.p;
      let pri = null;
      if (p.id === currentPlace) pri = 0;
      else if (st.g.type === 'move' && st.g.to === p.id) pri = 0;
      else if (s.age >= 0 && s.age < 2) pri = 1;
      else if (resColor.has(p.id)) pri = 2;
      else if (view.k >= 3 && p.days >= 12) pri = 3;
      else if (view.k >= 1.6 && p.days >= 60) pri = 3;
      if (pri !== null) cand.push({ ...s, pri });
    }
    cand.sort((a, b) => a.pri - b.pri || b.p.days - a.p.days);
    const boxes = [];
    for (const c of cand) {
      const bold = c.pri <= 1;
      ctx.font = `${bold ? 600 : 400} ${bold ? 14 : 12}px system-ui, -apple-system, sans-serif`;
      const text = placeName(c.p);
      const w = ctx.measureText(text).width, h = bold ? 16 : 14;
      const x = c.x + c.r + 5, y = c.y + 4;
      const box = [x - 2, y - h + 2, x + w + 2, y + 4];
      if (box[2] > W - 4 || boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
        if (c.pri > 0) continue;
      }
      boxes.push(box);
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,10,14,0.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = c.pri <= 1 ? '#ffffff' : '#c3c2b7';
      ctx.fillText(text, x, y);
    }
  }

  // ------------------------------------------------------------------ UI text
  function setText(id, text) {
    if (lastUI[id] !== text) { $(id).textContent = text; lastUI[id] = text; }
  }

  function updateUI(st) {
    const t = st.t, g = st.g;
    const res = residenceAt(t);
    setText('info-res', g.type === 'outro' ? 'All places' : `Living in ${placeName(P[res.p])}`);
    setText('info-month', g.type === 'outro'
      ? `${yearOf(D0)}–${yearOf(D1 - 1)}` : cap(fmtMonth.format(date(t))));
    setText('info-day', g.type === 'outro' ? '' : cap(fmtDay.format(date(t))));
    let place = '', context = '', trip = -1;
    if (g.type === 'stay') {
      place = fullName(P[g.place]);
      trip = g.stay.trip;
      if (trip >= 0) {
        const tr = T.trips[trip];
        context = `${tr.name} · day ${clamp(Math.floor(t) - tr.s + 1, 1, tr.e - tr.s + 1)} of ${tr.e - tr.s + 1}`;
      } else context = 'At home';
    } else if (g.type === 'move' && g.arc) {
      const to = stays[g.toStay], from = stays[g.toStay - 1];
      place = `${placeName(P[g.from])} → ${placeName(P[g.to])}`;
      trip = to.trip >= 0 ? to.trip : from.trip;
      context = !to.home ? T.trips[to.trip].name
        : from.home ? `Moving to ${placeName(P[g.to])}` : 'Back home';
    } else if (g.type === 'outro') {
      place = `${ccInfo.size} countries · ${placeFirst.length} places`;
      context = `${tripFirst.length} trips · ${fmtNum.format(Math.round(KM_TOTAL / 1000) * 1000)} km`;
    }
    setText('info-place', place);
    setText('info-context', context);
    setText('st-countries', fmtNum.format(countLE(ccFirst, t)));
    setText('st-places', fmtNum.format(countLE(placeFirst, t)));
    setText('st-trips', fmtNum.format(countLE(tripFirst, t)));
    setText('st-km', fmtNum.format(Math.round(st.km)));
    if (lastUI.trip !== trip) {
      lastUI.trip = trip;
      highlightTrip(trip);
    }
    moveHead(t);
  }

  // ------------------------------------------------------------------ trip list
  const list = $('trip-list');
  function buildTripList() {
    list.textContent = '';
    let year = null;
    for (const tr of T.trips) {
      if (tr.minor && !showMinor) continue;
      const y = yearOf(tr.s);
      if (y !== year) {
        year = y;
        const h = document.createElement('li');
        h.className = 'year';
        h.textContent = y;
        list.append(h);
      }
      const li = document.createElement('li');
      li.className = 'trip' + (tr.minor ? ' minor' : '');
      li.dataset.id = tr.id;
      const days = tr.e - tr.s + 1;
      li.innerHTML = `<span class="flags">${tr.cc.map(flag).join('')}</span>` +
        `<span class="name">${escapeHtml(tr.name)}</span>` +
        `<span class="when">${fmtRange(tr.s, tr.e)} · ${days} ${days === 1 ? 'day' : 'days'}</span>`;
      li.title = tr.places.map(id => placeName(P[id])).join(' · ');
      li.addEventListener('click', () => seekTrip(tr.id));
      list.append(li);
    }
    lastUI.trip = undefined;
  }

  function highlightTrip(id) {
    for (const el of list.querySelectorAll('.trip.current')) el.classList.remove('current');
    for (const el of scrubTicks || []) el.classList.toggle('current', +el.dataset.id === id);
    if (id < 0) return;
    const el = list.querySelector(`.trip[data-id="${id}"]`);
    if (!el) return;
    el.classList.add('current');
    list.scrollTo({ top: el.offsetTop - list.clientHeight / 2, behavior: playing ? 'smooth' : 'instant' });
  }

  // ------------------------------------------------------------------ scrubber
  const scrub = d3.select('#scrub');
  let xDay = d3.scaleLinear(), scrubTicks = null, head = null;
  const BASE = 38;

  function buildScrub() {
    const node = scrub.node();
    const w = node.clientWidth || 600;
    xDay = d3.scaleLinear().domain([D0, D1]).range([6, w - 6]);
    scrub.selectAll('*').remove();
    const y0 = yearOf(D0), y1 = yearOf(D1);
    const pxYear = (w - 12) / (y1 - y0 + 1);
    const step = pxYear >= 34 ? 1 : pxYear >= 16 ? 2 : 5;
    const yr = scrub.append('g').attr('class', 'yr');
    for (let y = y0 + 1; y <= y1; y++) {
      const x = xDay(Date.UTC(y, 0, 1) / DAY_MS);
      yr.append('line').attr('x1', x).attr('x2', x).attr('y1', 2).attr('y2', BASE + 10);
      if (y % step === 0) yr.append('text').attr('x', x + 3).attr('y', 60).text(step === 1 ? `'${String(y).slice(2)}` : y);
    }
    scrub.append('line').attr('class', 'base').attr('x1', 6).attr('x2', w - 6).attr('y1', BASE + 0.5).attr('y2', BASE + 0.5);
    scrub.append('g').selectAll('rect').data(T.residences).join('rect')
      .attr('x', r => xDay(r.s)).attr('width', r => Math.max(1, xDay(r.e + 1) - xDay(r.s) - 2))
      .attr('y', BASE + 4).attr('height', 5).attr('rx', 2.5)
      .attr('fill', r => resColor.get(r.p) || '#898781');
    const maxH = BASE - 4;
    const tickH = tr => {
      const h = 5 + (maxH - 5) * Math.log1p(tr.e - tr.s + 1) / Math.log1p(45);
      return Math.min(maxH, tr.minor ? h * 0.45 : h);
    };
    scrubTicks = scrub.append('g').selectAll('rect')
      .data(T.trips.filter(tr => showMinor || !tr.minor)).join('rect')
      .attr('class', tr => 'tick' + (tr.minor ? ' minor' : ''))
      .attr('data-id', tr => tr.id)
      .attr('x', tr => xDay(tr.s)).attr('width', tr => Math.max(2, xDay(tr.e + 1) - xDay(tr.s)))
      .attr('y', tr => BASE - tickH(tr)).attr('height', tickH).attr('rx', 1)
      .nodes();
    head = scrub.append('g').attr('class', 'head');
    head.append('line').attr('y1', 0).attr('y2', BASE + 12);
    head.append('circle').attr('cy', 3).attr('r', 4.5);
    lastUI.trip = undefined;
  }

  function moveHead(t) {
    if (head) head.attr('transform', `translate(${xDay(t).toFixed(1)},0)`);
  }

  function tripAtX(px) {
    let best = null, bd = 6;
    for (const tr of T.trips) {
      if (tr.minor && !showMinor) continue;
      const a = xDay(tr.s), b = Math.max(a + 2, xDay(tr.e + 1));
      const d = px < a ? a - px : px > b ? px - b : 0;
      if (d < bd) { bd = d; best = tr; }
    }
    return best;
  }

  let scrubbing = false;
  function scrubTo(ev) {
    const [px] = d3.pointer(ev, scrub.node());
    seekTau(tauOfDay(clamp(xDay.invert(px), D0, D1 - 0.01)));
  }
  scrub.on('pointerdown', ev => {
    scrubbing = true;
    scrub.node().setPointerCapture(ev.pointerId);
    scrubTo(ev);
  });
  scrub.on('pointermove', ev => {
    if (scrubbing) { scrubTo(ev); hideTip(); return; }
    const [px] = d3.pointer(ev, scrub.node());
    const tr = tripAtX(px);
    if (!tr) { hideTip(); return; }
    const days = tr.e - tr.s + 1;
    showTip(ev, `<b>${tr.cc.map(flag).join('')} ${escapeHtml(tr.name)}</b><br>` +
      `${fmtRange(tr.s, tr.e)} ${yearOf(tr.e)} · ${days} ${days === 1 ? 'day' : 'days'}<br>` +
      `${escapeHtml(tr.places.map(id => placeName(P[id])).join(' · '))}`);
  });
  scrub.on('pointerup pointercancel', () => { scrubbing = false; });
  scrub.on('pointerleave', hideTip);
  scrub.on('keydown', ev => {
    if (ev.key === 'ArrowRight') { stepTrip(1); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft') { stepTrip(-1); ev.preventDefault(); }
  });

  // ------------------------------------------------------------------ legend
  function buildLegend() {
    const res = resPlaces.map(p => `<span class="key"><i class="sw" style="background:${resColor.get(p)}"></i>${escapeHtml(placeName(P[p]))}</span>`).join('');
    const ramp = [1, 10, 100, 1000].map(d => `<i style="background:${countryRamp(d)}"></i>`).join('');
    $('legend').innerHTML =
      `<span class="group"><span class="title">Where I lived</span>${res}</span>` +
      `<span class="group"><span class="title">Days in the country</span><span class="ramp"><span>1</span>${ramp}<span>1000+</span></span></span>` +
      `<span class="group"><span class="title">Bars</span><span>one per trip, taller = longer</span></span>`;
  }

  // ------------------------------------------------------------------ tooltip
  function showTip(ev, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const r = app.getBoundingClientRect(), tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let x = ev.clientX - r.left + 14, y = ev.clientY - r.top - th - 10;
    if (x + tw > W - 8) x = ev.clientX - r.left - tw - 14;
    if (y < 8) y = ev.clientY - r.top + 18;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
  function hideTip() { tooltip.hidden = true; }

  // ------------------------------------------------------------------ globe interaction
  let drag = null;
  canvas.addEventListener('pointerdown', ev => {
    const st = stateAt(tau);
    const v = manual || st;
    manual = { center: [...v.center], k: v.k };
    drag = { x: ev.clientX, y: ev.clientY, c: [...manual.center] };
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('dragging');
    $('follow').hidden = false;
    hideTip();
  });
  canvas.addEventListener('pointermove', ev => {
    if (drag) {
      const R = R0 * manual.k, deg = 180 / Math.PI;
      manual.center = [drag.c[0] - (ev.clientX - drag.x) / R * deg,
                       clamp(drag.c[1] + (ev.clientY - drag.y) / R * deg, -85, 85)];
      return;
    }
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = 12;
    for (const s of screenPlaces) {
      const d = Math.hypot(s.x - mx, s.y - my) - s.r;
      if (d < bd) { bd = d; best = s.p; }
    }
    if (!best) { hideTip(); return; }
    const isRes = resColor.has(best.id) ? '<br>I lived here' : '';
    showTip(ev, `<b>${escapeHtml(fullName(best))}</b><br>${best.days} ${best.days === 1 ? 'day' : 'days'} with photos · ` +
      `${fmtNum.format(best.photos)} photos<br>First visit: ${fmtShortY.format(date(best.first))}${isRes}`);
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', hideTip);
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const v = manual || stateAt(tau);
    manual = { center: [...v.center], k: clamp(v.k * Math.exp(-ev.deltaY * 0.0015), 0.8, 14) };
    $('follow').hidden = false;
  }, { passive: false });
  $('follow').addEventListener('click', () => { manual = null; $('follow').hidden = true; });

  // ------------------------------------------------------------------ playback
  const playBtn = $('play');
  function setPlaying(on) {
    if (on && tau >= TOTAL - 0.01) tau = 0;
    playing = on;
    if (on) { manual = null; $('follow').hidden = true; }
    playBtn.classList.toggle('playing', on);
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));
  for (const b of document.querySelectorAll('.speeds button')) {
    b.addEventListener('click', () => {
      speed = +b.dataset.speed;
      for (const o of document.querySelectorAll('.speeds button')) o.classList.toggle('on', o === b);
    });
  }
  function seekTau(x) { tau = clamp(x, 0, TOTAL); }
  function seekTrip(id) {
    seekTau(tripTau.get(id) ?? tauOfDay(T.trips[id].s));   // minor trips are not in the script
    manual = null;
    $('follow').hidden = true;
  }
  function stepTrip(dir) {
    const st = stateAt(tau);
    const visible = T.trips.filter(tr => showMinor || !tr.minor);
    const cur = st.t;
    const next = dir > 0 ? visible.find(tr => tr.s > cur + 0.5) : [...visible].reverse().find(tr => tr.e + 1 < cur - 0.5);
    if (next) seekTrip(next.id);
  }
  $('show-minor').addEventListener('change', ev => {
    showMinor = ev.target.checked;
    buildTripList();
    buildScrub();
  });
  $('toggle-trips').addEventListener('click', ev => {
    const wide = W > 900;
    if (wide) app.classList.toggle('no-trips'); else app.classList.toggle('show-trips-mobile');
    const on = wide ? !app.classList.contains('no-trips') : app.classList.contains('show-trips-mobile');
    ev.currentTarget.setAttribute('aria-pressed', String(on));
    layout();
  });
  window.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT') return;
    if (ev.code === 'Space') { setPlaying(!playing); ev.preventDefault(); }
    else if (ev.key === 'ArrowRight' && ev.target === document.body) stepTrip(1);
    else if (ev.key === 'ArrowLeft' && ev.target === document.body) stepTrip(-1);
  });
  window.addEventListener('resize', layout);

  function frame(now) {
    if (playing && lastNow != null) {
      tau = Math.min(TOTAL, tau + (now - lastNow) / 1000 * speed);
      if (tau >= TOTAL) setPlaying(false);
    }
    lastNow = now;
    const st = render(tau, now);
    updateUI(st);
    requestAnimationFrame(frame);
  }

  // Hook for frame-by-frame video capture: __timeline.renderAt(tau) draws exactly that instant.
  window.__timeline = {
    total: TOTAL,
    renderAt(x) { tau = clamp(x, 0, TOTAL); const st = render(tau, tau * 1000); updateUI(st); return st.t; },
    tauOf(iso) { return tauOfDay(Date.parse(iso) / DAY_MS); },
    tripTau(id) { return tripTau.get(id); },
    pause() { setPlaying(false); },
  };

  buildLegend();
  buildTripList();
  layout();
  console.log(`[timeline] ${segs.length} segments, ${moves.length} flights, ${TOTAL.toFixed(0)} s at 1x, ` +
              `${Math.round(KM_TOTAL)} km`);
  if (params.has('t')) seekTau(tauOfDay(Date.parse(params.get('t')) / DAY_MS));
  if (!exportMode) requestAnimationFrame(frame);
})();
