#!/usr/bin/env python3
from __future__ import annotations

import json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8000


class MerchantGlobeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "service": "merchant-globe-mvp", "version": "0.4.0"})
            return
        if path == "/api/config":
            self.send_json({
                "game": "Merchant Globe",
                "maxDay": 30,
                "startingCash": 10000,
                "startingCargo": 20,
                "cities": 5,
                "products": 12,
            })
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Merchant Globe dev server: http://{HOST}:{PORT}")
    print(f"Health check:              http://{HOST}:{PORT}/api/health")
    ThreadingHTTPServer((HOST, PORT), MerchantGlobeHandler).serve_forever()
