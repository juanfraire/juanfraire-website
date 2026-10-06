#!/usr/bin/env python3
"""Rewrite the generated blocks in the site's HTML.

Sources of truth:
- publications: ../cv-juan-fraire.bib (the CV bibliography, one folder up)
- news:         data/news.json

A generated block is everything between a start marker and its end marker:

    <!-- gen:pubs topic=orbital limit=5 -->  ...  <!-- /gen -->   featured papers of one topic
    <!-- gen:pubs all -->                   ...  <!-- /gen -->   the full list, grouped by year
    <!-- gen:news limit=3 -->               ...  <!-- /gen -->   latest news items

Run after editing the bib or the news file, then commit the changed HTML:

    python3 scripts/generate.py

Standard library only. Bib conventions (see ../CLAUDE.md): `keywords` holds the
type (book, journal, conference, preprint; arxiv and thesis are not printed), the
topics (dtn, iot, mega, orbital), and the flags `selected` (CV flagship list) and
`featured` (extra papers shown on a topic page). A topic page shows the papers of
that topic flagged selected or featured, newest first. An optional `weburl` field
overrides the link on the website only (biber ignores it, so the CV keeps the DOI).
"""
from html import escape
from pathlib import Path
import json
import re
import sys
import unicodedata

SITE = Path(__file__).resolve().parent.parent
BIB = SITE.parent / "cv-juan-fraire.bib"
NEWS = SITE / "data/news.json"
PAGES = sorted(p for p in SITE.rglob("*.html") if "vendor" not in p.parts)

PRINTED = ("book", "journal", "conference", "preprint")
TOPICS = ("dtn", "iot", "mega", "orbital")
TYPE_LABEL = {"book": "Book or chapter", "journal": "Journal", "conference": "Conference", "preprint": "Preprint"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]

# ---------------------------------------------------------------- bib parsing

def parse_bib(text):
    """Return a list of {type, key, fields} from a BibTeX string (brace-balanced values)."""
    entries = []
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", text):
        kind, key = m.group(1).lower(), m.group(2)
        if kind in ("comment", "string", "preamble"):
            continue
        i, depth = m.end(), 1
        start = i
        while i < len(text) and depth:  # find the entry's closing brace
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        entries.append({"type": kind, "key": key, "fields": parse_fields(text[start:i - 1])})
    return entries


def parse_fields(body):
    fields, i = {}, 0
    while True:
        m = re.compile(r"\s*,?\s*([A-Za-z_-]+)\s*=\s*").match(body, i)
        if not m:
            break
        name, i = m.group(1).lower(), m.end()
        if i < len(body) and body[i] == "{":
            depth, j = 1, i + 1
            while j < len(body) and depth:
                depth += {"{": 1, "}": -1}.get(body[j], 0)
                j += 1
            value, i = body[i + 1:j - 1], j
        elif i < len(body) and body[i] == '"':
            j = body.index('"', i + 1)
            value, i = body[i + 1:j], j + 1
        else:
            m2 = re.compile(r"[^,\s}]+").match(body, i)
            value, i = m2.group(0), m2.end()
        fields[name] = re.sub(r"\s+", " ", value).strip()
    return fields


ACCENTS = {"'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303",
           "=": "\u0304", ".": "\u0307", "c": "\u0327", "v": "\u030c", "u": "\u0306", "H": "\u030b"}


def detex(s):
    """LaTeX accents and a few macros to Unicode; drop grouping braces."""
    s = s.replace(r"$\mu$", "µ").replace(r"\&", "&").replace(r"\_", "_").replace(r"\%", "%")
    s = re.sub(r"\\([`'^\"~=.cvuH])\s*\{?\s*(?:\\([ij])\b|([A-Za-z]))\s*\}?",
               lambda m: (m.group(2) or m.group(3)) + ACCENTS[m.group(1)], s)
    s = re.sub(r"\\(o|O|l|L|ss|ae|AE)\b\s*", lambda m: {"o": "ø", "O": "Ø", "l": "ł", "L": "Ł",
               "ss": "ß", "ae": "æ", "AE": "Æ"}[m.group(1)], s)
    s = s.replace("---", "\u2014").replace("--", "\u2013")
    s = s.replace("{", "").replace("}", "").replace("\\", "")
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", s).strip())


def authors(field):
    names = []
    for raw in re.split(r"\s+and\s+", field):
        raw = detex(raw)
        if "," in raw:
            last, first = [p.strip() for p in raw.split(",", 1)]
            raw = f"{first} {last}"
        names.append(raw)
    return names


def to_pub(entry):
    f = entry["fields"]
    kws = [k.strip() for k in f.get("keywords", "").split(",") if k.strip()]
    kind = next((k for k in PRINTED if k in kws), None)
    if not kind:
        return None
    venue = f.get("journal") or f.get("booktitle") or f.get("publisher") or f.get("school") or ""
    if not venue and f.get("eprinttype", "").lower() == "arxiv":
        venue = "arXiv"
    link = ""
    if f.get("weburl"):                       # website-only override, e.g. a corrected version
        link = f["weburl"]
    elif f.get("doi"):
        link = "https://doi.org/" + f["doi"].replace(r"\_", "_")
    elif f.get("url"):
        link = f["url"].replace(r"\_", "_")
    elif f.get("eprint") and f.get("eprinttype", "").lower() == "arxiv":
        link = "https://arxiv.org/abs/" + f["eprint"]
    return {
        "key": entry["key"],
        "kind": kind,
        "title": detex(f.get("title", "")),
        "authors": authors(f.get("author", f.get("editor", ""))),
        "venue": detex(venue),
        "year": int(re.sub(r"\D", "", f.get("year", "0")) or 0),
        "link": link,
        "topics": [t for t in TOPICS if t in kws],
        "flagged": "selected" in kws or "featured" in kws,
    }


def load_pubs():
    pubs = [p for p in (to_pub(e) for e in parse_bib(BIB.read_text(encoding="utf-8"))) if p]
    pubs.sort(key=lambda p: (-p["year"], p["title"].lower()))
    return pubs

# ---------------------------------------------------------------- rendering

def render_pub(p, indent):
    names = [f"<strong>{escape(n)}</strong>" if n.endswith("Fraire") else escape(n) for n in p["authors"]]
    who = ", ".join(names[:-1]) + (", and " if len(names) > 2 else " and ") + names[-1] if len(names) > 1 else "".join(names)
    title = escape(p["title"])
    if p["link"]:
        title = f'<a href="{escape(p["link"])}">{title}</a>'
    venue = escape(p["venue"]) + (", " if p["venue"] else "") + str(p["year"])
    attrs = f'data-type="{p["kind"]}" data-topics="{" ".join(p["topics"])}"'
    pad = " " * indent
    return (f'{pad}<li class="pub" {attrs}>\n'
            f'{pad}  <span class="pub-title">{title}</span>\n'
            f'{pad}  <span class="pub-authors">{who}</span>\n'
            f'{pad}  <span class="pub-venue">{venue}</span>\n'
            f'{pad}</li>')


def block_pubs(args, pubs, indent):
    if "all" in args:
        out, year = [], None
        for p in pubs:
            if p["year"] != year:
                if year is not None:
                    out.append(" " * indent + "</ol>")
                year = p["year"]
                out.append(" " * indent + f'<h3 class="pub-year" id="y{year}">{year}</h3>')
                out.append(" " * indent + '<ol class="pubs">')
            out.append(render_pub(p, indent + 2))
        out.append(" " * indent + "</ol>")
        return "\n".join(out)
    topic, limit = args.get("topic"), int(args.get("limit", 5))
    chosen = [p for p in pubs if topic in p["topics"] and p["flagged"]][:limit]
    if not chosen:
        sys.exit(f"no selected/featured papers for topic {topic!r}")
    lines = [" " * indent + '<ol class="pubs">'] + [render_pub(p, indent + 2) for p in chosen]
    return "\n".join(lines + [" " * indent + "</ol>"])


def nice_date(iso):
    parts = iso.split("-")
    return f"{MONTHS[int(parts[1]) - 1]} {parts[0]}" if len(parts) >= 2 else parts[0]


def block_news(args, news, indent):
    pad = " " * indent
    items = sorted(news, key=lambda n: n["date"], reverse=True)[: int(args.get("limit", 3))]
    out = [pad + '<ol class="news-list">']
    for n in items:
        body = n["html"]
        if n.get("link"):
            body += f' <a href="{escape(n["link"])}">{escape(n.get("link_text", "More"))}</a>'
        out += [f"{pad}  <li>",
                f'{pad}    <time datetime="{escape(n["date"])}">{nice_date(n["date"])}</time>',
                f"{pad}    <p>{body}</p>",
                f"{pad}  </li>"]
    return "\n".join(out + [pad + "</ol>"])


MARK = re.compile(r"(?P<indent>[ \t]*)<!-- gen:(?P<name>\w+)(?P<args>[^>]*?)-->\n(?P<body>.*?)(?P=indent)<!-- /gen -->",
                  re.S)


def parse_args(s):
    args = {}
    for tok in s.split():
        k, _, v = tok.partition("=")
        args[k] = v or True
    return args


def main():
    pubs = load_pubs()
    news = json.loads(NEWS.read_text(encoding="utf-8")) if NEWS.exists() else []
    for page in PAGES:
        html = page.read_text(encoding="utf-8")

        def fill(m):
            indent, args = len(m.group("indent").expandtabs()), parse_args(m.group("args"))
            if m.group("name") == "pubs":
                body = block_pubs(args, pubs, indent)
            elif m.group("name") == "news":
                body = block_news(args, news, indent)
            else:
                sys.exit(f"{page}: unknown block gen:{m.group('name')}")
            return f'{m.group("indent")}<!-- gen:{m.group("name")}{m.group("args")}-->\n{body}\n{m.group("indent")}<!-- /gen -->'

        new = MARK.sub(fill, html)
        if new != html:
            page.write_text(new, encoding="utf-8")
            print("updated", page.relative_to(SITE))
    counts = {t: sum(t in p["topics"] for p in pubs) for t in TOPICS}
    print(f"{len(pubs)} printed publications;", ", ".join(f"{t} {n}" for t, n in counts.items()))


if __name__ == "__main__":
    main()
