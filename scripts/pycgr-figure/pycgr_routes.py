"""Run pyCGR (bitbucket.org/juanfraire/pycgr) on its tutorial contact plan; print routes as JSON."""
import sys, json
libdir, plan = sys.argv[1], sys.argv[2]
sys.path.insert(0, libdir)
import io, contextlib
from py_cgr_lib.py_cgr_lib import Contact, cp_load, cgr_dijkstra, cgr_yen
with contextlib.redirect_stdout(io.StringIO()):
    cp = cp_load(plan, 5000)
src, dst = 1, 5
root = Contact(src, src, 0, sys.maxsize, 100, 1.0, 0); root.arrival_time = 0
best = cgr_dijkstra(root, dst, cp)
for c in cp: c.clear_dijkstra_working_area(); c.clear_management_working_area()
with contextlib.redirect_stdout(io.StringIO()):
    routes = cgr_yen(src, dst, 0, cp, 10)
def hops(r): return [dict(frm=c.frm, to=c.to, start=c.start, end=c.end) for c in r.get_hops()]
out = dict(best=dict(hops=hops(best), bdt=best.best_delivery_time if hasattr(best,'best_delivery_time') else None, repr=repr(best)),
           routes=[dict(hops=hops(r), repr=repr(r)) for r in routes],
           plan=[dict(frm=c.frm, to=c.to, start=c.start, end=c.end) for c in cp])
print(json.dumps(out, indent=1))
