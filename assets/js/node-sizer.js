// "Size a computing node" on the orbital-computing page.
// Reads published results only: carbon per GPU-hour from Fig. 1 of Dark Clouds Rising in
// Low-Earth Orbit (Ohs et al., LEO-NET 2026, doi:10.1145/3789240.3827598), masses from its §4.
// Without JavaScript the same numbers are in the table under "The numbers behind this".

// CARBON[launcher][years - 1][copies - 1], g CO2e per GPU-hour
const CARBON = {
  starship: [
    [441, 616, 791, 966, 1141], [221, 308, 396, 484, 571], [147, 206, 264, 323, 381],
    [111, 155, 198, 242, 286], [89, 124, 159, 194, 229], [74, 103, 132, 162, 191],
    [64, 89, 114, 139, 164], [56, 78, 100, 121, 143], [50, 69, 89, 108, 127],
  ],
  falcon9: [
    [529, 710, 892, 1073, 1255], [265, 355, 446, 537, 628], [177, 237, 298, 358, 419],
    [133, 178, 223, 269, 314], [106, 143, 179, 215, 252], [89, 119, 149, 180, 210],
    [76, 102, 128, 154, 180], [67, 89, 112, 135, 158], [59, 80, 100, 120, 140],
  ],
};
const GREEN = 107, AVERAGE = 477;                    // terrestrial baselines, g per GPU-hour
const RADIATOR_KG = 30.5, COMPUTER_KG = 3.2, BASE_KG = 44.3;   // 1 kW node, one copy (§4)
const GPU_LIFE_YEARS = 3;                            // expected GPU lifetime in LEO (§4)

const box = document.getElementById('sizer');
if (box) {
  box.hidden = false;
  const $ = (id) => document.getElementById(id);
  const years = $('years'), copies = $('copies-in');
  const LOG_MIN = Math.log(30), LOG_MAX = Math.log(1500);
  const at = (v) => `${(100 * (Math.log(v) - LOG_MIN)) / (LOG_MAX - LOG_MIN)}%`;
  $('mark-green').style.left = at(GREEN);
  $('mark-avg').style.left = at(AVERAGE);
  $('lab-green').style.left = at(GREEN);
  $('lab-avg').style.left = at(AVERAGE);

  const drawCopies = (n) => {
    const g = $('copies');
    g.replaceChildren();
    for (let i = 0; i < n; i++) {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const col = i % 3, row = Math.floor(i / 3);
      r.setAttribute('x', 190 + col * 14);
      r.setAttribute('y', 147 + row * 20);
      r.setAttribute('width', 11);
      r.setAttribute('height', 16);
      r.setAttribute('rx', 1.5);
      r.setAttribute('class', i === 0 ? 'chip on' : 'chip');
      g.append(r);
    }
    $('copies-label').textContent = n === 1 ? 'Computer × 1' : `Computer × ${n} (${n - 1} cold)`;
  };

  const update = () => {
    const T = Number(years.value), r = Number(copies.value);
    const rocket = document.querySelector('input[name="rocket"]:checked').value;
    const g = CARBON[rocket][T - 1][r - 1];
    const mass = BASE_KG + COMPUTER_KG * (r - 1);
    $('years-out').textContent = T === 1 ? '1 year' : `${T} years`;
    $('copies-out').textContent = r === 1 ? '1 (no spare)' : `${r} (${r - 1} spare${r > 2 ? 's' : ''})`;
    $('carbon').innerHTML = `${g} <small>g CO₂e</small>`;
    $('meter-fill').style.width = at(g);
    $('mass').innerHTML = `${mass.toFixed(1)} <small>kg</small>`;
    $('share').innerHTML = `${Math.round((100 * RADIATOR_KG) / mass)} <small>%</small>`;
    drawCopies(r);

    const need = Math.ceil(T / GPU_LIFE_YEARS);
    let text;
    if (g <= GREEN) text = 'Below a data centre on a clean grid, and below the global average.';
    else if (g <= AVERAGE) text = 'Below the global-average data centre, above one on a clean grid.';
    else text = 'Above the global-average data centre on Earth.';
    if (r < need) {
      text += ` But one GPU is expected to last about ${GPU_LIFE_YEARS} years, so ${T} years in orbit need at least ${need} copies; this node would likely stop computing early.`;
    }
    $('verdict').textContent = text;
  };

  box.addEventListener('input', update);
  update();
}
