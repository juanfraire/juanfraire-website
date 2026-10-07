// News cards on the landing page, as on LinkedIn. The cards sit in one row that scrolls
// sideways (swipe, trackpad or shift + wheel work without this script); here we add the
// previous/next arrows for mouse users, and cut long posts to a few lines with "Show more".
// Without JavaScript the row still scrolls and the whole text shows.

const row = document.getElementById('latest-posts');
const head = row?.closest('section')?.querySelector('.group-head');
if (row && head) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const arrow = (dir, label, path) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-controls', row.id);
    button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      // one screenful of whole cards at a time; snapping lines the first one up
      const card = row.firstElementChild.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const step = Math.max(1, Math.floor((row.clientWidth + gap) / (card + gap))) * (card + gap);
      row.scrollBy({ left: dir * step, behavior: reduce.matches ? 'auto' : 'smooth' });
    });
    return button;
  };
  const prev = arrow(-1, 'Previous posts', 'M15 5l-7 7 7 7');
  const next = arrow(1, 'Next posts', 'M9 5l7 7-7 7');
  const nav = document.createElement('div');
  nav.className = 'row-nav';
  nav.append(prev, next);
  head.append(nav);
  // aria-disabled rather than disabled, so a focused arrow keeps focus at the end of the row
  const update = () => {
    const end = row.scrollWidth - row.clientWidth;
    prev.setAttribute('aria-disabled', String(row.scrollLeft <= 2));
    next.setAttribute('aria-disabled', String(row.scrollLeft >= end - 2));
    nav.hidden = end <= 2;
  };
  row.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(row);
  update();
}

await document.fonts.ready;   // line heights depend on the web font

for (const text of document.querySelectorAll('.post-text[data-clamp]')) {
  text.classList.add('clamped');
  if (text.scrollHeight <= text.clientHeight + 4) {   // short enough already
    text.classList.remove('clamped');
    continue;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'post-toggle';
  button.textContent = 'Show more';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', text.id);
  button.addEventListener('click', () => {
    const open = !text.classList.toggle('clamped');
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? 'Show less' : 'Show more';
  });
  text.after(button);
}
