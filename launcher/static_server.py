#!/usr/bin/env python3
"""Serve the frontend's static export (frontend/out) on loopback.

``python -m http.server`` is not enough: on Windows it takes MIME types from
the registry, which often maps ``.js`` to ``text/plain`` and stops the page's
module scripts from loading, and it does not map ``/iso`` to ``iso.html``.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import os
from pathlib import Path

MIME = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".txt": "text/plain",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".map": "application/json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if not path.exists() and path.with_suffix(".html").is_file():
            # Next's export writes /iso as iso.html.
            self.path = self.path.split("?", 1)[0].rstrip("/") + ".html"
        elif not path.exists():
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        # A new build must show up without a hard refresh.
        if not self.path.startswith("/_next/static/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        # Errors only; every asset request would flood the log.
        if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4747)
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=os.fspath(args.dir))
    http.server.ThreadingHTTPServer.allow_reuse_address = os.name != "nt"
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"serving {args.dir} on http://{args.host}:{args.port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
