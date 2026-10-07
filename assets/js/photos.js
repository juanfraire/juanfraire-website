// Photo carousels (.photos): the photos next to "About me" on the home and about pages, and
// the press photo in colour and in black and white. Each one fades to the next photo every
// few seconds while it is on screen, and gets pause/play, previous and next buttons. It holds
// still under the mouse, stops once keyboard focus reaches the buttons, and does not start by
// itself for readers who prefer reduced motion. On the about photos, a script in the page
// shows a random one first and the others follow in random order. Without JavaScript the
// first photo shows alone.

const LABELS = {
  en: { pause: 'Pause the photos', play: 'Play the photos', prev: 'Previous photo', next: 'Next photo' },
  es: { pause: 'Pausar las fotos', play: 'Reanudar las fotos', prev: 'Foto anterior', next: 'Foto siguiente' },
  fr: { pause: 'Mettre les photos en pause', play: 'Reprendre les photos', prev: 'Photo précédente', next: 'Photo suivante' },
};
const say = LABELS[document.documentElement.lang] || LABELS.en;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const DWELL = 6000;   // ms on each photo
const FADE = 900;     // ms, as the transition in site.css

const svg = (inner) => `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const line = (d) => svg(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
const PAUSE = line('M8 5v14M16 5v14');
const PLAY = svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>');

function carousel(box) {
  const list = box.querySelector('ul');
  const slides = [...list.children];
  if (slides.length < 2) return;

  // the photo showing now, then the others shuffled
  const first = Math.max(0, slides.findIndex((li) => !li.hidden));
  const rest = slides.map((_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const order = [first, ...rest];
  let at = 0;
  const slide = (k) => slides[order[(k + order.length) % order.length]];
  const fetchEarly = (li) => { li.querySelector('img').loading = 'eager'; };

  const button = (label, icon, onclick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-controls', list.id);
    b.innerHTML = icon;
    b.addEventListener('click', onclick);
    return b;
  };

  let playing = false, hover = false, inView = false, timer = 0, turn = 0;
  const schedule = () => {
    clearTimeout(timer);
    if (playing && !hover && inView && !document.hidden) timer = setTimeout(() => go(1), DWELL);
  };

  async function go(step) {
    const mine = ++turn;
    at = (at + step + order.length) % order.length;
    const next = slide(at);
    const img = next.querySelector('img');
    fetchEarly(next);
    next.hidden = false;
    await img.decode().catch(() => {});
    if (mine !== turn) return;            // a later click took over
    next.hidden = false;                  // in case a finished fade hid it meanwhile
    void next.offsetWidth;                // so the fade starts from transparent
    for (const li of slides) {
      if (li.classList.contains('on') && li !== next) li.classList.replace('on', 'was');
    }
    next.classList.add('on');             // fades in over the photo it replaces
    setTimeout(() => {
      for (const li of slides) {
        if (li.classList.contains('on')) continue;
        li.classList.remove('was');
        li.hidden = true;
      }
    }, reduce.matches ? 0 : FADE);
    fetchEarly(slide(at + 1));
    schedule();
  }

  const toggle = button(say.pause, PAUSE, () => play(!playing));
  const play = (on) => {
    playing = on;
    toggle.setAttribute('aria-label', on ? say.pause : say.play);
    toggle.innerHTML = on ? PAUSE : PLAY;
    list.setAttribute('aria-live', on ? 'off' : 'polite');   // announce only photos the reader asked for
    schedule();
  };
  const nav = document.createElement('div');
  nav.className = 'photo-nav';
  // the rotation control first, as in the WAI-ARIA carousel pattern
  nav.append(toggle, button(say.prev, line('M15 5l-7 7 7 7'), () => go(-1)), button(say.next, line('M9 5l7 7-7 7'), () => go(1)));
  box.append(nav);

  slides[first].classList.add('on');
  box.classList.add('ready');

  box.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true; schedule(); } });
  box.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = false; schedule(); } });
  box.addEventListener('focusin', (e) => { if (playing && e.target.matches(':focus-visible')) play(false); });
  document.addEventListener('visibilitychange', schedule);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) fetchEarly(slide(at + 1));
    schedule();
  }, { threshold: 0.5 }).observe(box);

  play(!reduce.matches);
}

for (const box of document.querySelectorAll('.photos')) carousel(box);
