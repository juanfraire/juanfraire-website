// Filters for the full publication list: topic, type and free text.
// The whole list is in the HTML, so without JavaScript everything shows; this only hides
// what does not match. A topic in the hash (/publications/#orbital) opens with it selected.

const form = document.getElementById('pub-filters');
const section = document.querySelector('.all-pubs');

if (form && section) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const items = [...section.querySelectorAll('.pub')];
  const years = [...section.querySelectorAll('.pub-year')];
  const chips = [...form.querySelectorAll('.chip')];
  const type = form.querySelector('#pub-type');
  const query = form.querySelector('#pub-q');
  const count = form.querySelector('#pub-count');
  const topicsOf = new Map(items.map((li) => [li, li.dataset.topics.split(' ')]));
  const textOf = new Map(items.map((li) => [li, norm(li.textContent)]));
  const known = chips.map((c) => c.dataset.topic).filter(Boolean);
  let topic = '';

  for (const chip of chips) {
    const t = chip.dataset.topic;
    chip.querySelector('.n').textContent = t ? items.filter((li) => topicsOf.get(li).includes(t)).length : items.length;
  }

  const apply = () => {
    const words = norm(query.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of items) {
      const ok = (!topic || topicsOf.get(li).includes(topic))
        && (!type.value || li.dataset.type === type.value)
        && words.every((w) => textOf.get(li).includes(w));
      li.hidden = !ok;
      if (ok) shown++;
    }
    for (const h of years) {
      const list = h.nextElementSibling;
      const empty = ![...list.children].some((li) => !li.hidden);
      h.hidden = empty;
      list.hidden = empty;
    }
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.topic === topic));
    count.textContent = shown === items.length ? `${shown} publications` : `${shown} of ${items.length} publications`;
  };

  const fromHash = () => {
    const t = decodeURIComponent(location.hash.slice(1));
    if (!known.includes(t)) return;
    topic = t;
    apply();
    section.scrollIntoView();
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      topic = chip.dataset.topic;
      history.replaceState(null, '', topic ? `#${topic}` : location.pathname);
      apply();
    });
  }
  type.addEventListener('change', apply);
  query.addEventListener('input', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
  window.addEventListener('hashchange', fromHash);

  form.hidden = false;
  apply();
  fromHash();
}
