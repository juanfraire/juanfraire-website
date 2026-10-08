// "Route a bundle" on the delay-tolerant networks page.
//
// The network is the worked example of J. A. Fraire, O. De Jonckère and S. C. Burleigh,
// "Routing in the Space Internet: A contact graph routing tutorial", Journal of Network and
// Computer Applications 174 (2021) 102884, doi:10.1016/j.jnca.2020.102884.
//   PLAN    the contact plan table of Fig. 3a: contacts #1 to #16 as eight two-way pairs, with
//           start and end times in seconds. Fig. 3a gives every contact rate 1 and range 1; the
//           rate only matters for volume, which this tool leaves out.
//   OWLT    that range: 1 light-second of one-way light time on every contact (Fig. 3a, §3.4).
//   END     the plan runs from t = 0 to t = 60 s (Fig. 3a and the time-line view of Fig. 3c).
//   ROLES   A and C ground stations, B mission control, D and E satellites (Fig. 3b, §3.1).
//   ROWS    one row per pair of nodes, in the order of the time-line view of Fig. 3c.
//   PAPER   the tutorial's routes 1 to 4 from A to E (Fig. 3c and 6), by contact number.
//   route() the contact graph Dijkstra search of §4.1 (Alg. 1, 2 and 3), which returns the
//           earliest arrival of the first byte. The OWLT safety margin of Alg. 2 (line 16) is
//           left out, as in the worked example, whose Route 1 arrives at t = 3 (Fig. 7 and 8).
//           Ties in arrival time go to fewer hops, the tutorial's first tie-breaker when it
//           selects among routes (§6.2).
// No bundle size, no volume, no queues. Without JavaScript the same plan is in the table under
// "The contact plan behind this".

const PLAN = [   // [contact #, node, node, start s, end s]: #n goes one way, #n+1 back
  [1, 'A', 'B', 0, 60], [3, 'B', 'C', 0, 60], [5, 'A', 'C', 0, 60], [7, 'C', 'D', 0, 30],
  [9, 'A', 'E', 10, 20], [11, 'D', 'E', 0, 10], [13, 'D', 'E', 30, 40], [15, 'D', 'E', 50, 60],
];
const OWLT = 1;
const END = 60;
const ROLES = { A: 'ground station', B: 'mission control', C: 'ground station', D: 'satellite', E: 'satellite' };
const PAPER = { '5 7 11': 1, 9: 2, '5 7 13': 3, '5 7 15': 4 };

const pair = (a, b) => [a, b].sort().join('–');
const ROWS = [...new Set(PLAN.map(([, a, b]) => pair(a, b)))];
const CONTACTS = PLAN.flatMap(([id, a, b, start, end]) => {
  const row = ROWS.indexOf(pair(a, b));
  return [
    { id, snd: a, rcv: b, start, end, owlt: OWLT, row },
    { id: id + 1, snd: b, rcv: a, start, end, owlt: OWLT, row },
  ];
});

// Earliest-arrival route from src to dst for a bundle created at t0, or null if there is none.
// Each hop: the contact, when the bundle is ready at its sender, when it is sent, when it arrives.
export function route(src, dst, t0) {
  const n = CONTACTS.length;
  const arr = Array(n).fill(Infinity), hops = Array(n).fill(0), pred = Array(n).fill(-1);
  const visited = Array(n).fill(false), seen = Array(n).fill(null);
  const better = (t, h, i) => t < arr[i] || (t === arr[i] && h < hops[i]);
  let curr = { i: -1, node: src, arr: t0, hops: 0, seen: [src] };   // root contact, from src to itself
  let fin = -1, bdt = Infinity;
  for (;;) {
    for (let i = 0; i < n; i++) {                                     // contact review (Alg. 2)
      const c = CONTACTS[i];
      if (c.snd !== curr.node) continue;
      if (c.end <= curr.arr || visited[i] || curr.seen.includes(c.rcv)) continue;
      const t = Math.max(c.start, curr.arr) + c.owlt;
      if (!better(t, curr.hops + 1, i)) continue;
      arr[i] = t; hops[i] = curr.hops + 1; pred[i] = curr.i; seen[i] = [...curr.seen, c.rcv];
      if (c.rcv === dst && (fin < 0 || better(t, hops[i], fin) || i === fin)) { fin = i; bdt = arr[fin]; }
    }
    if (curr.i >= 0) visited[curr.i] = true;
    let next = -1;                                                     // contact selection (Alg. 3)
    for (let i = 0; i < n; i++) {
      if (visited[i] || arr[i] === Infinity || arr[i] > bdt) continue;
      if (next < 0 || better(arr[i], hops[i], next)) next = i;
    }
    if (next < 0 || CONTACTS[next].rcv === dst) break;
    curr = { i: next, node: CONTACTS[next].rcv, arr: arr[next], hops: hops[next], seen: seen[next] };
  }
  if (fin < 0) return null;
  const path = [];                                                     // reconstruction (Alg. 1)
  for (let i = fin; i >= 0; i = pred[i]) path.unshift(CONTACTS[i]);
  let ready = t0;
  return path.map((c) => {
    const tx = Math.max(c.start, ready);
    const hop = { ...c, ready, tx, arr: tx + c.owlt, wait: tx - ready };
    ready = hop.arr;
    return hop;
  });
}

const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function describe(src, dst, t0, hops) {
  if (src === dst) return 'The bundle would already be at its destination. Pick two different nodes.';
  if (!hops) {
    return `Created at t = ${t0} s at ${src}: no chain of contacts reaches ${dst} before the plan ends at t = ${END} s, so the bundle stays stored at ${src} until the contact plan is updated.`;
  }
  const last = hops[hops.length - 1];
  const via = hops.length === 1 ? 'on the direct contact' : `via ${list(hops.slice(0, -1).map((h) => h.rcv))}`;
  const waits = hops.filter((h) => h.wait > 0).map((h, k) => `${h.wait} s${k === 0 ? ' stored' : ''} at ${h.snd}`);
  let text = `Created at t = ${t0} s at ${src}, delivered to ${dst} at t = ${last.arr} s ${via}; `;
  text += waits.length ? `it waits ${list(waits)}.` : `it never waits: the trip is ${hops.length} s of light time${hops.length > 1 ? ', 1 s per hop' : ''}.`;
  const n = src === 'A' && dst === 'E' && PAPER[hops.map((h) => h.id).join(' ')];
  if (n) text += ` This is Route ${n} in the tutorial.`;
  return text;
}

const box = globalThis.document?.getElementById('router');
if (box) {
  const $ = (id) => document.getElementById(id);
  const slider = $('route-t'), from = $('route-from'), to = $('route-to');
  const fig = box.querySelector('.route-figure'), svg = $('route-svg'), layer = $('route-draw');
  const summary = $('route-summary');
  box.hidden = false;
  const plan = $('route-plan');
  if (plan) plan.open = false;          // open for visitors without JavaScript, folded under the tool

  const NS = 'http://www.w3.org/2000/svg';
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    layer.append(e);
    return e;
  };
  const textW = (s, size) => s.length * size * 0.56;   // close enough for Inria Sans
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // The contact plan as a time line (Fig. 3c), drawn at the figure's own width so the
  // labels keep their size on a phone. The bundle's route is drawn over it.
  const draw = (hops, t0) => {
    const W = Math.max(300, Math.round(fig.clientWidth));
    const L = 44, R = 16, TOP = 30, ROW = 40, BAR = 18;
    const bottom = TOP + ROWS.length * ROW, H = bottom + 26;
    const x = (t) => L + ((W - L - R) * t) / END;
    const y = (r) => TOP + r * ROW + ROW / 2;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    layer.replaceChildren();

    for (let t = 0; t <= END; t += 10) {
      add('line', { class: 'grid', x1: x(t), x2: x(t), y1: TOP - 4, y2: bottom });
      add('text', { class: 'tick', x: x(t), y: H - 7, 'text-anchor': 'middle' }, `${t} s`);
    }
    ROWS.forEach((name, r) => add('text', { class: 'row-name', x: 0, y: y(r) + 5 }, name));

    const onRow = new Map((hops || []).map((h) => [h.row, h]));
    const bars = PLAN.map(([id, a, b, start, end]) => {
      const r = ROWS.indexOf(pair(a, b)), h = onRow.get(r);
      const used = !!h && h.start === start;
      add('rect', { class: used ? 'bar used' : 'bar', x: x(start), y: y(r) - BAR / 2, width: x(end) - x(start), height: BAR, rx: 4 });
      return { id, r, start, end, used };
    });
    if (t0 > 0) add('rect', { class: 'past', x: x(0) - 2, y: TOP - 4, width: x(t0) - x(0) + 2, height: bottom - TOP + 4 });

    const made = `created at ${t0} s`, mw = textW(made, 12);
    add('line', { class: 'now', x1: x(t0), x2: x(t0), y1: TOP - 10, y2: bottom });
    add('text', { class: 'now-lbl', x: clamp(x(t0), mw / 2 + 1, W - mw / 2 - 1), y: TOP - 15, 'text-anchor': 'middle' }, made);

    if (hops) {
      hops.forEach((h, k) => {
        const yy = y(h.row);
        if (k > 0) add('line', { class: 'hand', x1: x(h.ready), x2: x(h.ready), y1: y(hops[k - 1].row), y2: yy });
        if (h.wait > 0) add('line', { class: 'wait', x1: x(h.ready), x2: x(h.tx), y1: yy, y2: yy });
        add('line', { class: 'fly', x1: x(h.tx), x2: x(h.arr), y1: yy, y2: yy });
      });
      const last = hops[hops.length - 1];
      add('circle', { class: 'start', cx: x(t0), cy: y(hops[0].row), r: 5 });
      add('circle', { class: 'done', cx: x(last.arr), cy: y(last.row), r: 6 });
    }

    bars.forEach((b) => {
      const label = `#${b.id}/${b.id + 1}`;
      if (b.used || x(b.end) - x(b.start) < textW(label, 11) + 10) return;
      add('text', { class: b.end <= t0 ? 'bar-id gone' : 'bar-id', x: (x(b.start) + x(b.end)) / 2, y: y(b.r) + 4, 'text-anchor': 'middle' }, label);
    });

    (hops || []).forEach((h, k) => {
      const label = `${h.snd}→${h.rcv}`;
      let lx = x(h.arr) + (k === hops.length - 1 ? 11 : 6), anchor = 'start';
      if (lx + textW(label, 12) > W - 1) { lx = x(h.ready) - 9; anchor = 'end'; }
      add('text', { class: 'hop', x: lx, y: y(h.row) + 4, 'text-anchor': anchor }, label);
      if (h.wait > 0) {
        const span = x(h.tx) - x(h.ready);
        const s = [`waits ${h.wait} s at ${h.snd}`, `waits ${h.wait} s`, `${h.wait} s`].find((c) => textW(c, 11) + 6 <= span);
        if (s) add('text', { class: 'wait-lbl', x: (x(h.ready) + x(h.tx)) / 2, y: y(h.row) - BAR / 2 - 4, 'text-anchor': 'middle' }, s);
      }
    });
  };

  const unit = (v) => `${v} <small>s</small>`;
  let state = { hops: null, t0: 0 }, timer = 0, lastW = 0;

  const update = (announce) => {
    const t0 = Number(slider.value), src = from.value, dst = to.value;
    $('route-t-out').textContent = `t = ${t0} s`;
    slider.setAttribute('aria-valuetext', `t = ${t0} seconds`);
    const hops = src === dst ? null : route(src, dst, t0);
    state = { hops, t0 };
    draw(hops, t0);
    $('route-arr').innerHTML = hops ? unit(hops[hops.length - 1].arr) : 'none';
    $('route-wait').innerHTML = hops ? unit(hops.reduce((s, h) => s + h.wait, 0)) : '–';
    // no line break inside "t = 31 s"
    const text = describe(src, dst, t0, hops).replace(/t = (\d+)/g, 't = $1').replace(/(\d) s\b/g, '$1 s');
    clearTimeout(timer);
    // the line is a polite live region: announce it once the slider settles, not at every step
    if (announce) timer = setTimeout(() => { summary.textContent = text; }, 300);
    else summary.textContent = text;
  };

  box.addEventListener('input', () => update(true));
  new ResizeObserver(() => {
    const w = Math.round(fig.clientWidth);
    if (w !== lastW) { lastW = w; draw(state.hops, state.t0); }
  }).observe(fig);
  update(false);
}
