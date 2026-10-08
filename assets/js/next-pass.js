// "Wait for the next pass" on the satellite-IoT page.
// The constellations are the published designs of G. Maiolini Capez, S. Henn, J. A. Fraire and
// R. Garello, "Sparse Satellite Constellation Design for Global and Regional Direct-to-Satellite IoT
// Services", IEEE Transactions on Aerospace and Electronic Systems 58(5), 2022, doi:10.1109/taes.2022.3185970.
//   ALT_KM, MIN_ELEV   §V-A: circular orbits at 700 km; a 5° elevation threshold is the 127.1° swath
//                      used for Fig. 7 and Fig. 12
//   world-5            §V-A, Fig. 7 and Table III (candidate A): 5 satellites, 5 planes, 62.9°, global
//                      NB-IoT coverage up to 80° latitude with gaps of at most 186 min
//   africa-*, europe-* §V-B, Fig. 12: smallest fleets (satellites, planes, inclination printed on the
//                      bars) for gaps of at most 60, 120 and 186 min
//   africa-3           also Table V, Brazil (min sats.): the same 3/3/25° design, longest gap 97 min
//   greenland-2        Table V, Greenland (min sats.): 2 satellites, 2 planes, 70°, longest gap 93 min
// Layout as in §III-C(a) and §V-A: planes evenly spread in right ascension, satellites evenly spaced in
// each plane. The authors' code (github.com/dev-pol/CPGD-dev, populateConstellation) puts no phase offset
// between planes, so neither does this. With that choice, the longest wait this model finds over a
// grid of points in each region is close to the paper's: about 95 min for Brazil (Table V: 97) and
// 92 min for Greenland (Table V: 93). Everything else is plain physics computed here: two-body circular
// orbits around a spherical, rotating Earth (mean radius 6371 km), and no link budget.

import { latLon, spinY, circular, place, walker, coverageAngle } from './scene/orbits.js';

const ALT_KM = 700;
const MIN_ELEV = 5;                  // degrees above the horizon
const SPIN = 7.2921159e-5;           // Earth's sidereal rotation rate [rad/s]
const DAY = 86400;
const PAD = 12 * 3600;               // propagate this much before and after, so edge waits are whole
const STEP = 20;                     // coarse time step [s]; window edges are refined by bisection
const DEG = Math.PI / 180;
const REACH = coverageAngle(ALT_KM, MIN_ELEV);   // Earth central angle of the view circle [rad]

const DESIGNS = {
  'world-5': { S: 5, P: 5, inc: 62.9, wait: 186, serves: 'anywhere up to 80° north or south', src: 'Fig. 7, Table III' },
  'africa-12': { S: 12, P: 4, inc: 25, wait: 60, serves: 'Africa', src: 'Fig. 12' },
  'africa-4': { S: 4, P: 4, inc: 25, wait: 120, serves: 'Africa', src: 'Fig. 12' },
  'africa-3': { S: 3, P: 3, inc: 25, wait: 186, serves: 'Africa', src: 'Fig. 12',
    also: 'The same three satellites serve Brazil with waits of at most 97 min (Table V).' },
  'europe-12': { S: 12, P: 4, inc: 65, wait: 60, serves: 'Europe', src: 'Fig. 12' },
  'europe-4': { S: 4, P: 4, inc: 65, wait: 120, serves: 'Europe', src: 'Fig. 12' },
  'europe-3': { S: 3, P: 3, inc: 85, wait: 186, serves: 'Europe', src: 'Fig. 12' },
  'greenland-2': { S: 2, P: 2, inc: 70, wait: 120, serves: 'Greenland', src: 'Table V',
    also: 'The longest wait the paper found there, over a simulated week, is 93 min.' },
};

const PLACES = {
  lyon: ['Lyon, France', 45.76, 4.84],
  svalbard: ['Longyearbyen, Svalbard', 78.22, 15.65],
  nuuk: ['Nuuk, Greenland', 64.18, -51.72],
  agadez: ['Agadez, Niger', 16.97, 7.99],
  nairobi: ['Nairobi, Kenya', -1.29, 36.82],
  capetown: ['Cape Town, South Africa', -33.92, 18.42],
  manaus: ['Manaus, Brazil', -3.12, -60.02],
  cordoba: ['Córdoba, Argentina', -31.42, -64.18],
  alice: ['Alice Springs, Australia', -23.7, 133.88],
  pacific: ['A buoy in the Pacific, 0° 140° W', 0, -140],
};

const box = document.getElementById('next-pass');
if (box) {
  const $ = (id) => document.getElementById(id);
  const placeSel = $('np-place'), designSel = $('np-design'), map = $('np-map');
  box.hidden = false;
  const numbers = $('np-numbers');
  if (numbers) numbers.open = false;          // the table stays open for visitors without JavaScript
  $('np-earth').setAttribute('href', '/assets/img/tex/earth-day.jpg');

  let point = null;                            // [name, lat, lon] of the current place
  let liveTimer = 0;

  const dms = (lat, lon) => `${Math.abs(lat)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon)}° ${lon >= 0 ? 'E' : 'W'}`;
  const minutes = (s) => {
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  };
  const clock = (s) => { const m = Math.round(Math.max(0, s) / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const pct = (s) => `${(100 * Math.min(DAY, Math.max(0, s))) / DAY}%`;

  // One day of passes for one place and one design.
  function simulate(d, lat, lon) {
    const sats = circular(walker({ planes: d.P, perPlane: d.S / d.P, f: 0, altKm: ALT_KM, inc: d.inc }));
    const n = sats.n, pos = new Float64Array(n * 3), g = [0, 0, 0], ground = latLon(lat, lon);
    const cosReach = Math.cos(REACH);
    const sees = (j) => {                      // satellite j within the view circle of the sensor
      const x = pos[3 * j], y = pos[3 * j + 1], z = pos[3 * j + 2];
      return (g[0] * x + g[1] * y + g[2] * z) / Math.hypot(x, y, z) > cosReach;
    };
    const anySees = (t) => {
      spinY(ground, SPIN * t, g);
      place(sats, t, pos);
      for (let j = 0; j < n; j++) if (sees(j)) return true;
      return false;
    };
    const edge = (a, b, before) => {           // bisection to about half a second
      for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (anySees(m) === before) a = m; else b = m; }
      return (a + b) / 2;
    };

    // Ground tracks of each satellite while it is in view during the day, for the map.
    const tracks = [], open = Array.from({ length: n }, () => null), sub = [0, 0, 0];
    const track = (t) => {                     // positions already placed at time t
      let any = false;
      for (let j = 0; j < n; j++) {
        if (sees(j)) {                         // sub-satellite point, back in Earth-fixed axes
          any = true;
          spinY([pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]], -SPIN * t, sub);
          const r = Math.hypot(sub[0], sub[1], sub[2]);
          (open[j] ||= []).push([Math.atan2(-sub[2], sub[0]) / DEG, Math.asin(sub[1] / r) / DEG]);
        } else if (open[j]) { tracks.push(open[j]); open[j] = null; }
      }
      return any;
    };

    const wins = [];                           // [start, end] in seconds; ±Infinity when cut by the pads
    let prev = anySees(-PAD), start = prev ? -Infinity : null;
    for (let t = -PAD + STEP; t <= DAY + PAD; t += STEP) {
      let now;
      if (t >= 0 && t <= DAY) { spinY(ground, SPIN * t, g); place(sats, t, pos); now = track(t); } else now = anySees(t);
      if (now !== prev) {
        const e = edge(t - STEP, t, prev);
        if (now) start = e; else { wins.push([start, e]); start = null; }
        prev = now;
      }
    }
    if (start !== null) wins.push([start, Infinity]);

    // Waits between passes, counted whole even when they run past either end of the day.
    const gaps = [];
    for (let i = 0; i + 1 < wins.length; i++) gaps.push({ a: wins[i][1], b: wins[i + 1][0], open: false });
    if (wins.length && wins[0][0] > -PAD) gaps.unshift({ a: -PAD, b: wins[0][0], open: true });
    if (wins.length && wins[wins.length - 1][1] < DAY + PAD) gaps.push({ a: wins[wins.length - 1][1], b: DAY + PAD, open: true });
    let longest = null;
    for (const gp of gaps) {
      if (gp.b > 0 && gp.a < DAY && (!longest || gp.b - gp.a > longest.b - longest.a)) longest = gp;
    }

    const day = wins.filter(([a, b]) => b > 0 && a < DAY);
    const contact = day.reduce((s, [a, b]) => s + Math.min(b, DAY) - Math.max(a, 0), 0);
    open.forEach((o) => o && tracks.push(o));
    return { day, contact, longest, tracks };
  }

  // Equirectangular map, 360 x 180 units. Paths are unwrapped in longitude and drawn three times
  // (shifted by -360, 0, +360) so that anything crossing the date line shows on both edges.
  const pathOf = (pts) => {
    let d = '', last = null;
    for (const [lon0, lat] of pts) {
      let lon = lon0;
      if (last !== null) lon += 360 * Math.round((last - lon) / 360);
      d += `${d ? 'L' : 'M'}${(lon + 180).toFixed(2)} ${(90 - lat).toFixed(2)}`;
      last = lon;
    }
    return d;
  };
  function viewCircle(lat, lon) {
    const p = lat * DEG, s = Math.sin(REACH), c = Math.cos(REACH), pts = [];
    for (let k = 0; k <= 96; k++) {
      const b = (2 * Math.PI * k) / 96;
      const la = Math.asin(Math.sin(p) * c + Math.cos(p) * s * Math.cos(b));
      const lo = lon * DEG + Math.atan2(Math.sin(b) * s * Math.cos(p), c - Math.sin(p) * Math.sin(la));
      pts.push([lo / DEG, la / DEG]);
    }
    return pathOf(pts);
  }

  function drawMap(d, lat, lon, tracks) {
    const reach = d.inc + REACH / DEG;         // highest latitude a satellite of this design can serve
    const band = Math.max(0, 90 - reach);
    $('np-north').setAttribute('height', band.toFixed(2));
    $('np-south').setAttribute('y', (180 - band).toFixed(2));
    $('np-south').setAttribute('height', band.toFixed(2));
    $('np-circle').setAttribute('d', viewCircle(lat, lon));
    $('np-tracks').setAttribute('d', tracks.map(pathOf).join(''));
    $('np-pin').setAttribute('transform', `translate(${(lon + 180).toFixed(2)} ${(90 - lat).toFixed(2)})`);
  }

  function drawDay(r, name) {
    $('np-day-title').textContent = `24 hours at ${name}`;
    const track = $('np-track');
    track.replaceChildren(...r.day.map(([a, b]) => {
      const i = document.createElement('i');
      i.style.left = pct(a);
      i.style.width = `${(100 * (Math.min(b, DAY) - Math.max(a, 0))) / DAY}%`;
      return i;
    }));
    track.setAttribute('aria-label', r.day.length
      ? `Passes during the day, by start time and length: ${r.day.map(([a, b]) =>
        `${a < 0 ? '0:00, already in view' : clock(a)}, ${minutes(Math.min(b, DAY) - Math.max(a, 0))}`).join('; ')}.`
      : 'No pass during the day.');
    const wait = $('np-wait');
    wait.hidden = !r.longest;
    if (r.longest) {
      wait.style.left = pct(r.longest.a);
      wait.style.width = `${(100 * (Math.min(r.longest.b, DAY) - Math.max(r.longest.a, 0))) / DAY}%`;
      wait.classList.toggle('cut-start', r.longest.a < 0);       // the wait began before hour 0
      wait.classList.toggle('cut-end', r.longest.b > DAY);       // or ends after hour 24
      $('np-wait-label').textContent = `longest wait ${r.longest.open ? 'over ' : ''}${minutes(r.longest.b - r.longest.a)}${
        r.longest.a < 0 ? ', from before 0 h' : r.longest.b > DAY ? ', past 24 h' : ''}`;
    }
    $('np-wait-label').hidden = !r.longest;
    placeLabel();
  }

  function placeLabel() {                      // centre the label over the bracket, kept inside the row
    const wait = $('np-wait'), label = $('np-wait-label');
    if (wait.hidden) return;
    const W = wait.parentElement.clientWidth, w = label.offsetWidth;
    const mid = wait.offsetLeft + wait.offsetWidth / 2;
    label.style.left = `${Math.max(0, Math.min(W - w, mid - w / 2))}px`;
  }

  function summary(r, d, name, lat) {
    if (!r.day.length) {
      return `<b>${name}</b>: no pass in 24 hours.${Math.abs(lat) > d.inc + REACH / DEG
        ? ` Orbits inclined at ${d.inc}° never bring a satellite into view this far ${lat > 0 ? 'north' : 'south'}.` : ''}`;
    }
    const n = r.day.length;
    const head = `<b>${name}</b>: <b>${n}</b> pass${n > 1 ? 'es' : ''} in 24 hours, <b>${minutes(r.contact)}</b> in contact in all`;
    if (!r.longest) return `${head}, and never out of reach.`;
    const w = Math.round((r.longest.b - r.longest.a) / 60);
    const where = d.serves.startsWith('anywhere') ? d.serves : `in ${d.serves}`;
    return `${head}, longest wait <b>${r.longest.open ? 'over ' : ''}${minutes(w * 60)}</b>. ${w <= d.wait ? 'Inside' : 'Longer than'} the ${d.wait}-min limit this constellation was designed to meet ${where}.`;
  }

  function about(d) {
    const per = d.S === d.P ? `one in each of ${d.P} planes` : `${d.S / d.P} in each of ${d.P} planes`;
    const where = d.serves.startsWith('anywhere') ? 'the whole planet' : d.serves;
    $('np-about').innerHTML = `${d.S} satellites, ${per} inclined at ${d.inc}°, 700&nbsp;km up: the smallest fleet the study found for ${where} when devices can wait up to ${d.wait}&nbsp;min. ${d.also || ''} <span class="cite"><a href="https://doi.org/10.1109/taes.2022.3185970">Sparse Constellations, IEEE TAES 2022, ${d.src}</a></span>`;
  }

  function update(fromMap = false) {
    const d = DESIGNS[designSel.value];
    const [name, lat, lon] = point;
    const r = simulate(d, lat, lon);
    drawMap(d, lat, lon, r.tracks);
    drawDay(r, name);
    about(d);
    const text = summary(r, d, name, lat);
    clearTimeout(liveTimer);
    if (fromMap) liveTimer = setTimeout(() => { $('np-summary').innerHTML = text; }, 350);   // one announcement per pause
    else $('np-summary').innerHTML = text;
  }

  function pickPlace() {
    const k = placeSel.value;
    if (k !== 'custom') point = PLACES[k];
    update();
  }

  // A point on the map becomes the first option of the place list.
  function setPoint(lat, lon) {
    lat = Math.max(-89, Math.min(89, Math.round(lat)));
    lon = Math.round(((lon + 540) % 360) - 180);
    if (lon === -180) lon = 180;
    const name = dms(lat, lon);
    let opt = placeSel.querySelector('option[value="custom"]');
    if (!opt) { opt = new Option('', 'custom'); placeSel.prepend(opt); }
    opt.textContent = `Point on the map: ${name}`;
    placeSel.value = 'custom';
    point = [name, lat, lon];
    update(true);
  }

  map.addEventListener('click', (ev) => {
    const r = map.getBoundingClientRect();
    setPoint(90 - (180 * (ev.clientY - r.top)) / r.height, (360 * (ev.clientX - r.left)) / r.width - 180);
  });
  map.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 1 : 5;
    const move = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[ev.key];
    if (!move) return;
    ev.preventDefault();
    setPoint(point[1] + move[0], point[2] + move[1]);
  });
  placeSel.addEventListener('change', pickPlace);
  designSel.addEventListener('change', () => update());
  window.addEventListener('resize', placeLabel);

  point = PLACES[placeSel.value] || PLACES.lyon;
  update();
}
