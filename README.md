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
| Publications | `../cv/cv-juan-fraire.bib` (the CV bibliography) | `python3 scripts/generate.py` |
| News from LinkedIn | the post's URL | `python3 scripts/add_post.py <URL>`, then `generate.py` |
| Other news | a file in `data/news/` (see below) | `python3 scripts/generate.py` |
| Images, textures, data from other projects | sources listed in `scripts/make_assets.py` | `python3 scripts/make_assets.py` |
| Photos next to "About me" | crop boxes in `ABOUT_PHOTOS` (`make_assets.py`), originals in the folder `about-photos` of `sources.local.json` | `make_assets.py`, then the photo list in `index.html` and `about/index.html` (alt text) |
| Figure on a selected paper's card | `PAPER_FIGURES` in `make_assets.py` (bib key, source, crop, alt text, credit line) | `make_assets.py`, then `generate.py` |
| Picture on a tool card (software page) | `SOFTWARE_SHOTS` in `make_assets.py` | `make_assets.py`, then the alt text in `software/index.html` |
| Everything else | the HTML pages directly | nothing |

The selected papers are cards with one figure each, taken from the authors' own source files and
carrying the credit line each publisher's reuse terms ask for ("© 2022 IEEE", "CC BY 4.0"). A selected
paper with no entry in `PAPER_FIGURES` shows its topic number instead, so the bib can change freely.
Rendering PDF and SVG figures needs `pdftoppm` and `rsvg-convert` (`brew install poppler librsvg`).

`generate.py` rewrites only the blocks between `<!-- gen:… -->` and `<!-- /gen -->`
markers; everything else in the pages is hand-written. It also rewrites `sitemap.xml`,
with each page's last commit date as `lastmod`, so run it once more just before committing.

`make_assets.py` also builds the social cards (`assets/img/og.jpg`, `assets/img/og/og-*.jpg`,
1200 × 630) and the touch icons (`apple-touch-icon.png`, `favicon.ico`). A few of its sources
are kept out of this public repo: their paths live in `scripts/sources.local.json`, which git
ignores. Keep it that way; never name those sources in a committed file.

Bibliography keywords that the site reads (the CV ignores the extra ones):

- type: `book`, `journal`, `conference`, `preprint` (`arxiv` and `thesis` are not shown);
- topic: `dtn`, `iot`, `mega`, `orbital` (zero, one or two per entry);
- `selected` (the CV's flagship list) or `featured` (website only): shown on the topic page;
  `selected` alone also fills "Selected papers" on the publications page (`<!-- gen:pubs selected -->`)
  and its JSON-LD in `<head>` (`<!-- gen:ld selected -->`);
- optional field `weburl`: the link the website uses instead of the DOI (the CV ignores it).

### News

Each post is one file, `data/news/YYYY-MM-DD-slug.md`: a few header lines between `---`
lines, then the text exactly as written on LinkedIn (emoji, line breaks, hashtags, and the
Unicode "bold" letters, which the site turns into real bold). The home page shows the ten
newest as a row of cards under "Latest" that scrolls sideways (`limit=10` in its `gen:news`
marker); `/news/` shows them all.

To copy a LinkedIn post, give its URL to `add_post.py` (any form: the share link, the
`feed/update/urn:li:activity:…` link, or the post's address in the browser):

```bash
python3 scripts/add_post.py https://www.linkedin.com/feed/update/urn:li:activity:7478746928034336768/
python3 scripts/generate.py
```

It reads LinkedIn's public embed of the post, so the post must be public. It writes the post
file, downloads its images (and video, with a poster) into `assets/img/news/` and
`assets/video/news/`, so visitors never load anything from LinkedIn. Then:

- fill in the `alt:` line under each image (LinkedIn rarely has alt text; `generate.py` warns);
- a post that shares someone else's post keeps your comment and gets a card linking to the
  original, whose media stay on LinkedIn; a YouTube video becomes a link card with its
  thumbnail (the site embeds nothing); a post already copied is skipped unless `--force`;
- delete the file to drop a post, or edit its text: the site never rereads LinkedIn;
- a post without a `source:` line is a news item written for the site only.

The header lines `generate.py` reads are listed at the top of `scripts/generate.py`
(`date`, `source`, `image` with `alt`, `video` with `poster`, `preview`, `link`).

## Layout of the landing page

One HTML page, two layouts. An inline script in `<head>` adds `class="scene"` to
`<html>` when the device can run the 3D tour (WebGL2, at least 4 cores and 4 GB, no
data saver, no reduced-motion preference). Otherwise, and until the tour has
loaded, the page is the intro slide: the four topic panels.
`assets/js/home.js` loads `assets/js/scene/scene.js` and three.js after first
paint, and falls back to the slide if they fail or run below about 22 fps.
The last stop (`.stop.tall`) is about two screens long: its card stays pinned
while further scrolling pulls the camera back from the node to the dawn-dusk shells.
Each stop has one live callout over the canvas (a Mars rover, an IoT sensor, the
satellite above Lyon, the compute node). They are created by `scene.js` and do not
exist in the slide layout, which `?static` forces (e.g. `http://localhost:8765/?static`).

## Files

```
index.html                  landing page
dtn/, satellite-iot/, mega-constellations/, orbital-computing/   topic pages 01 to 04
publications/               full list from the bib, with topic/type/text filters (assets/js/pubs.js)
software/                   tools and projects, grouped by topic
press/, es/prensa/, fr/presse/   press kit in English, Spanish and French (assets/js/press.js)
about/                      positions, education, students, service, teaching
news/                       every news post, newest first (the home page shows ten)
404.html                    shown by GitHub Pages for missing pages
assets/css/site.css         all styles; palette from the intro slide
assets/js/home.js           landing behaviour (live Mars light-time, tour, fallback)
assets/js/astro.js          low-precision ephemerides (Sun, Earth, Mars, sidereal time)
assets/js/scene/            the three.js tour and its orbit helpers
assets/js/node-sizer.js     the node sizer on the orbital-computing page
assets/js/news.js           "Show more" on long news cards, arrows for the row of cards
assets/js/photos.js         photo carousels: About (random order) and the press photo (colour, black and white)
assets/img/photo/           portrait and press downloads (colour and black and white), about/ for the carousel
assets/img/news/, assets/video/news/   media of the news posts (from add_post.py)
assets/img/pubs/, assets/img/software/   figures on the selected-paper cards, pictures on the tool cards
data/                       IPN-V Mars network, ODC shells, sensor sites; pub-figures.json (from make_assets.py)
data/news/                  one file per news post
vendor/three/               three.js r170 (MIT)
assets/fonts/               Inria Sans (SIL Open Font Licence)
scripts/                    serve.py, generate.py, add_post.py, make_assets.py (+ git-ignored sources.local.json)
sitemap.xml, robots.txt     written by generate.py / by hand
CNAME                       juanfraire.space
```

## Credits

Planet textures: Solar System Scope, CC BY 4.0. Mars network: IPN-V scenario
`dsn-network`. Orbital data-centre shells and hero render: Blender scenes with NASA
Blue Marble and Black Marble imagery. Numbers on the
orbital-computing page: *Dark Clouds Rising in Low-Earth Orbit* (LEO-NET 2026) and
*Dirty Bits in Low-Earth Orbit*.
