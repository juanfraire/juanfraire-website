# juanfraire.space

Personal research site of Juan A. Fraire. Plain HTML, CSS and ES modules: no build
step, no dependencies to install, nothing to compile. GitHub Pages serves the files
as they are.

## Preview

```bash
python3 scripts/serve.py        # http://localhost:8765/ (caching off)
```

Add `?static` to the landing URL to see the plain layout that reduced-motion
visitors, low-power phones and browsers without WebGL get.

## Updating content

| What | Where | Then |
|---|---|---|
| Publications | `../cv-juan-fraire.bib` (the CV bibliography) | `python3 scripts/generate.py` |
| News | `data/news.json` (newest first is not required) | `python3 scripts/generate.py` |
| Images, textures, data from other projects | sources listed in `scripts/make_assets.py` | `python3 scripts/make_assets.py` |
| Everything else | the HTML pages directly | nothing |

`generate.py` rewrites only the blocks between `<!-- gen:… -->` and `<!-- /gen -->`
markers; everything else in the pages is hand-written.

Bibliography keywords that the site reads (the CV ignores the extra ones):

- type: `book`, `journal`, `conference`, `preprint` (`arxiv` and `thesis` are not shown);
- topic: `dtn`, `iot`, `mega`, `orbital` (zero, one or two per entry);
- `selected` (the CV's flagship list) or `featured` (website only): shown on the topic page;
- optional field `weburl`: the link the website uses instead of the DOI (the CV ignores it).

A news item is `{"date": "2026-10", "html": "…", "link": "…", "link_text": "Paper"}`;
`link` is optional and can point to the LinkedIn post.

## Layout of the landing page

One HTML page, two layouts. An inline script in `<head>` adds `class="scene"` to
`<html>` when the device can run the 3D tour (WebGL2, at least 4 cores and 4 GB, no
data saver, no reduced-motion preference). Otherwise, and until the tour has
loaded, the page is the intro slide: four topic panels and the institution bars.
`assets/js/home.js` loads `assets/js/scene/scene.js` and three.js after first
paint, and falls back to the slide if they fail or run below about 22 fps.

## Files

```
index.html                  landing page
orbital-computing/          topic page 04
404.html                    shown by GitHub Pages for missing pages
assets/css/site.css         all styles; palette from the intro slide
assets/js/home.js           landing behaviour (live Mars light-time, tour, fallback)
assets/js/astro.js          low-precision ephemerides (Sun, Earth, Mars, sidereal time)
assets/js/scene/            the three.js tour and its orbit helpers
assets/js/node-sizer.js     the node sizer on the orbital-computing page
data/                       IPN-V Mars network, ODC shells, sensor sites, news
vendor/three/               three.js r170 (MIT)
assets/fonts/               Inria Sans (SIL Open Font Licence)
scripts/                    serve.py, generate.py, make_assets.py
CNAME                       juanfraire.space
```

## Credits

Planet textures: Solar System Scope, CC BY 4.0. Mars network: IPN-V scenario
`dsn-network`. Orbital data-centre shells and hero render: Blender scenes with NASA
Blue Marble and Black Marble imagery. Numbers on the
orbital-computing page: *Dark Clouds Rising in Low-Earth Orbit* (LEO-NET 2026) and
*Dirty Bits in Low-Earth Orbit*.
