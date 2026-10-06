#!/usr/bin/env python3
"""Preview the site locally with caching off, so edits show up on reload.

    python3 scripts/serve.py          # http://localhost:8765/
    python3 scripts/serve.py 9000     # another port
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = Path(__file__).resolve().parent.parent
    print(f"Serving {root} at http://localhost:{port}/")
    ThreadingHTTPServer(("", port), partial(NoCache, directory=str(root))).serve_forever()
