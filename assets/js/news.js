// News cards on the landing page: a long post is cut to a few lines with a "Show more"
// button, as on LinkedIn. Without JavaScript the whole text shows.

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
