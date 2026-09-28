from __future__ import annotations

import json
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen

BASE_URL = "http://127.0.0.1:8000"


def read_url(path: str) -> str:
    with urlopen(f"{BASE_URL}{path}", timeout=2) as response:
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return response.read().decode("utf-8")


def main() -> None:
    process = subprocess.Popen(
        [sys.executable, "server.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        health_text = None
        for _ in range(15):
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise RuntimeError(f"development server exited early\n{output}")

            try:
                health_text = read_url("/api/health")
                break
            except (URLError, OSError):
                time.sleep(0.5)

        if health_text is None:
            raise RuntimeError("development server did not become ready")

        health = json.loads(health_text)
        assert health["ok"] is True
        assert health["service"] == "merchant-globe-mvp"
        assert health["version"] == "0.3.0"

        index = read_url("/")
        assert "Merchant Globe" in index

        print("Smoke test passed.")
        print(json.dumps(health, ensure_ascii=False))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
