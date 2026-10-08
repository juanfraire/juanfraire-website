// Landing page. Works in two layouts (see site.css): the plain slide, and the 3D tour
// when <html> has class "scene". The tour's code and textures load only in that case,
// after first paint; if they fail or run too slowly, the page falls back to the slide.

import { marsLightMinutes } from './astro.js';

const root = document.documentElement;
const live = (key) => document.querySelector(`[data-live="${key}"]`);

const mars = live('mars');
if (mars) {
  const minutes = marsLightMinutes(new Date()).toFixed(1);
  mars.innerHTML = `Today a signal needs <b>${minutes} minutes</b> to reach Mars, and every message waits at least that long.`;
}

if (root.classList.contains('scene')) tour();

function tour() {
  const stops = [...document.querySelectorAll('.stop')];
  const rail = [...document.querySelectorAll('.rail a')];
  const hint = document.querySelector('.scroll-hint');
  let active = -1;
  let scene = null;

  const setActive = (i) => {
    if (i === active) return;
    active = i;
    stops.forEach((s, j) => s.classList.toggle('is-active', j === i));
    rail.forEach((a, j) => (j === i ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current')));
    if (scene) scene.goTo(i);
  };

  // A stop is active while it crosses the middle of the viewport.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) setActive(Number(e.target.dataset.stop));
  }, { rootMargin: '-45% 0px -45% 0px' });
  stops.forEach((s) => io.observe(s));
  setActive(0);

  const journey = document.querySelector('.journey');
  const seen = new IntersectionObserver(([e]) => journey.classList.toggle('in-view', e.isIntersecting), { rootMargin: '-30% 0px -30% 0px' });
  seen.observe(journey);

  // The last stop is taller than the screen; scrolling through it pulls the camera back.
  const tall = document.querySelector('.stop.tall');
  const progress = () => {
    if (!scene || !tall) return;
    const r = tall.getBoundingClientRect(), span = r.height - innerHeight;
    scene.setProgress(span > 0 ? -r.top / span : 0);
  };

  // The header shows at the top of the page and keeps out of the way during the tour. Past the
  // tour it comes back as a slim bar whenever the visitor scrolls up or reaches the end of the page.
  const head = document.querySelector('.site-head');
  let lastY = scrollY;
  const dock = () => {
    const y = scrollY, past = journey.getBoundingClientRect().bottom < innerHeight / 2;
    const end = y + innerHeight >= document.documentElement.scrollHeight - 4;
    head.classList.toggle('is-docked', past);
    if (y < 8) head.classList.remove('is-hidden');
    else if (!past) head.classList.add('is-hidden');
    else if (y < lastY - 2 || end) head.classList.remove('is-hidden');
    else if (y > lastY + 2) head.classList.add('is-hidden');
    lastY = y;
  };
  const onScroll = () => { if (hint) hint.classList.toggle('is-gone', scrollY > 40); progress(); dock(); };
  addEventListener('scroll', onScroll, { passive: true });
  dock();

  const fallback = (reason) => {
    if (reason) console.info('3D tour off:', reason);
    if (scene) scene.dispose();
    scene = null;
    io.disconnect();
    seen.disconnect();
    journey.classList.remove('in-view');
    removeEventListener('scroll', onScroll);
    head.classList.remove('is-hidden', 'is-docked');
    stops.forEach((s) => s.classList.remove('is-active'));
    for (const key of ['iot', 'mega']) { const el = live(key); if (el) el.hidden = true; }
    root.classList.remove('scene', 'scene-ready');
  };

  const start = async () => {
    try {
      const { createScene } = await import('./scene/scene.js');
      scene = await createScene(document.querySelector('.stage canvas'), {
        onLive: (key, html) => { const el = live(key); if (el) { el.innerHTML = html; el.hidden = false; } },
        onSlow: () => fallback('too slow on this device'),
      });
      progress();
      scene.goTo(active, true);
      root.classList.add('scene-ready');
    } catch (err) {
      fallback(err);
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1200 });
  else setTimeout(start, 200);
}
