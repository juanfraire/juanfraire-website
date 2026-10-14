// "Share" for papers. Every paper has a page of its own, /publications/<slug>/, and that is the
// address shared, so a link posted anywhere opens on the paper with its abstract and links.
// - In the lists (publications, topic pages) each entry has a Share button, hidden until this runs.
//   It opens one small panel, reused by every button: the address with Copy, then LinkedIn, X,
//   Bluesky and email as plain links (nothing is loaded from those services), and the device's own
//   share sheet where there is one.
// - A paper's page has its share links in the HTML already; here they gain "Copy link", and its
//   BibTeX gains "Copy BibTeX".

const SITE = 'https://juanfraire.space';   // the address to hand out, also from a local preview

const targets = (url, title) => ({
  LinkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  X: `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
  Bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title} ${url}`)}`,
  Email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n${url}`)}`,
});

async function copy(text, button) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Press Ctrl+C or ⌘C';   // no clipboard access: the text is selected instead
  }
  setTimeout(() => { button.textContent = label; }, 1800);
}

// ---------------------------------------------------------------- the panel in lists

let panel, opener;

function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'share-pop';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Share this paper');
  panel.hidden = true;
  panel.innerHTML = `
    <p class="share-title"></p>
    <div class="share-url"><input type="text" readonly aria-label="Address of this paper"><button type="button" class="copy">Copy</button></div>
    <p class="share-to"></p>`;
  document.body.append(panel);
  const input = panel.querySelector('input');
  input.addEventListener('focus', () => input.select());
  panel.querySelector('.copy').addEventListener('click', (e) => { input.select(); copy(input.value, e.currentTarget); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(true); });
  panel.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !panel.contains(e.relatedTarget) && e.relatedTarget !== opener) close(false);
  });
}

function open(button) {
  if (!panel) buildPanel();
  const item = button.closest('.pub');
  const title = item.querySelector('.pub-title').textContent.trim();
  const url = SITE + button.dataset.share;
  panel.querySelector('.share-title').textContent = title;
  panel.querySelector('input').value = url;
  const to = panel.querySelector('.share-to');
  to.replaceChildren(...Object.entries(targets(url, title)).map(([name, href]) => {
    const a = document.createElement('a');
    Object.assign(a, { href, textContent: name, target: '_blank', rel: 'noopener' });
    return a;
  }));
  if (navigator.share) {
    const more = document.createElement('button');
    Object.assign(more, { type: 'button', textContent: 'More…' });
    more.addEventListener('click', () => navigator.share({ title, url }).catch(() => {}));
    to.append(more);
  }
  if (opener) opener.setAttribute('aria-expanded', 'false');
  opener = button;
  button.setAttribute('aria-expanded', 'true');
  panel.hidden = false;
  place();
  panel.querySelector('.copy').focus();
}

function place() {
  const r = opener.getBoundingClientRect();
  const width = panel.offsetWidth;
  const left = Math.min(Math.max(8, r.left), document.documentElement.clientWidth - width - 8);
  panel.style.left = `${left + window.scrollX}px`;
  panel.style.top = `${r.bottom + window.scrollY + 8}px`;
}

function close(refocus) {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  opener.setAttribute('aria-expanded', 'false');
  if (refocus) opener.focus();
}

const buttons = document.querySelectorAll('button.share[data-share]');
for (const b of buttons) {
  b.hidden = false;
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', () => (opener === b && !panel.hidden ? close(true) : open(b)));
}
if (buttons.length) {
  document.addEventListener('click', (e) => {
    if (panel && !panel.hidden && !panel.contains(e.target) && !e.target.closest('button.share')) close(false);
  });
  window.addEventListener('resize', () => close(false));
}

// ---------------------------------------------------------------- a paper's own page

for (const b of document.querySelectorAll('button.copy[data-copy]')) {
  b.hidden = false;
  b.addEventListener('click', () => copy(b.dataset.copy, b));
}
for (const b of document.querySelectorAll('button.copy[data-copy-from]')) {
  b.hidden = false;
  b.addEventListener('click', () => copy(b.parentElement.querySelector(b.dataset.copyFrom).textContent, b));
}
const shareRow = document.querySelector('.paper-share');
if (shareRow && navigator.share) {
  const page = document.querySelector('.paper-page');
  const more = document.createElement('button');
  Object.assign(more, { type: 'button', className: 'native', textContent: 'More…' });
  more.addEventListener('click', () => navigator.share({ title: document.querySelector('h1').textContent, url: page.dataset.url }).catch(() => {}));
  shareRow.append(more);
}
