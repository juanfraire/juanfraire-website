// The course matrix (courses/): each domain is a <details> that opens without JavaScript.
// This adds the "Open all" button next to the heading, and opens the domain named in the
// address (/courses/#navigation), so a link can point straight at one.

const domains = [...document.querySelectorAll('.cm-domain')];
const toggle = document.querySelector('.cm-toggle');

function sync() {
  const all = domains.every((d) => d.open);
  toggle.textContent = all ? 'Close all' : 'Open all';
  toggle.setAttribute('aria-expanded', String(all));
}

if (toggle && domains.length) {
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const open = !domains.every((d) => d.open);
    for (const d of domains) d.open = open;
  });
  for (const d of domains) d.addEventListener('toggle', sync);
  sync();
}

function openTarget() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target && target.classList.contains('cm-domain')) {
    target.open = true;
    target.scrollIntoView();
  }
}
addEventListener('hashchange', openTarget);
openTarget();
