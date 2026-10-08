"""Plot pyCGR's tutorial contact plan (bitbucket.org/juanfraire/pycgr) and the route its
contact graph routing picks from A to E. Input: the JSON written by pycgr_routes.py."""
import sys, json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

data = json.load(open(sys.argv[1]))
out = sys.argv[2]
name = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E"}
INK, MUTED, GRID = "#1d2433", "#5d6678", "#e3e7ee"
CONTACT, ROUTE, ALT = "#9ea7b8", "#c47f12", "#f0d29c"

# one row per undirected pair, in the order of the tutorial file
pairs = []
for c in data["plan"]:
    p = tuple(sorted((c["frm"], c["to"])))
    if p not in pairs:
        pairs.append(p)
windows = {p: sorted({(c["start"], c["end"]) for c in data["plan"] if tuple(sorted((c["frm"], c["to"]))) == p}) for p in pairs}
best = data["best"]["hops"]
best_set = {(tuple(sorted((h["frm"], h["to"]))), h["start"], h["end"]): i + 1 for i, h in enumerate(best)}
# delivery: one second of light time per hop (owlt 1 in the plan), starting at t = 0
t_hop = [i + 1 for i in range(len(best))]

import glob, os
from matplotlib import font_manager as fm
for f in glob.glob(os.path.expanduser("~/Library/Fonts/inria-sans-latin-[47]00-normal.ttf")):
    fm.fontManager.addfont(f)
plt.rcParams.update({"font.family": ["Inria Sans", "DejaVu Sans"], "font.size": 16})
fig, ax = plt.subplots(figsize=(8.0, 5.0), dpi=180)
fig.subplots_adjust(left=0.11, right=0.975, top=0.78, bottom=0.15)
rows = {p: len(pairs) - 1 - i for i, p in enumerate(pairs)}
h = 0.46
for p in pairs:
    y = rows[p]
    for (s, e) in windows[p]:
        hop = best_set.get((p, s, e))
        col = ROUTE if hop else CONTACT
        ax.add_patch(FancyBboxPatch((s + 0.25, y - h / 2), e - s - 0.5, h, boxstyle="round,pad=0,rounding_size=0.12",
                                    mutation_aspect=1 / 6, linewidth=0, facecolor=col, zorder=2))
        if hop:
            ax.annotate(str(hop), (s + 2.6, y), ha="center", va="center", fontsize=14, fontweight="bold", color="white", zorder=4)
ax.set_yticks([rows[p] for p in pairs])
ax.set_yticklabels([f"{name[a]} – {name[b]}" for a, b in pairs], color=INK)
ax.set_xlim(0, 60.5)
ax.set_ylim(-0.7, len(pairs) - 0.3)
ax.set_xticks(range(0, 61, 10))
ax.set_xlabel("time (s)", color=MUTED, fontsize=15)
ax.tick_params(axis="x", colors=MUTED, length=0, labelsize=15)
ax.tick_params(axis="y", length=0, labelsize=17)
ax.grid(axis="x", color=GRID, linewidth=1, zorder=0)
for s in ax.spines.values():
    s.set_visible(False)
route = " → ".join([name[best[0]["frm"]]] + [name[h_["to"]] for h_ in best])
fig.text(0.11, 0.925, "Contact plan and the route pyCGR finds", fontsize=19, fontweight="bold", color=INK)
fig.text(0.11, 0.86, f"Route {route}, delivered at t = {t_hop[-1]} s", fontsize=16, color=MUTED)
# legend, drawn by hand on the right of the subtitle
lx = 0.775
fig.patches.extend([
    FancyBboxPatch((lx, 0.932), 0.022, 0.024, boxstyle="round,pad=0,rounding_size=0.004", transform=fig.transFigure, facecolor=ROUTE, linewidth=0),
    FancyBboxPatch((lx, 0.866), 0.022, 0.024, boxstyle="round,pad=0,rounding_size=0.004", transform=fig.transFigure, facecolor=CONTACT, linewidth=0)])
fig.text(lx + 0.03, 0.935, "on the route", fontsize=15, color=INK)
fig.text(lx + 0.03, 0.869, "contact", fontsize=15, color=INK)
fig.savefig(out, facecolor="white")
print("wrote", out)
