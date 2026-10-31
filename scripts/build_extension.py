"""Build local or shared-server extension ZIPs without embedding the Lablup key."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]


def build(server_url=None, token_file=None):
    shared = server_url is not None
    config = None
    if shared:
        url = urlsplit(server_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Shared builds require an HTTPS relay URL")
        values = dict(line.split("=", 1) for line in Path(token_file).read_text(encoding="utf-8-sig").splitlines() if "=" in line and not line.startswith("#"))
        token = values.get("AUDIO_FOCUS_TOKEN", "").strip()
        if not token:
            raise ValueError("Missing AUDIO_FOCUS_TOKEN in token file")
        config = "export const SERVER_CONFIG = " + json.dumps({"serverUrl": server_url.rstrip("/"), "token": token}) + ";\n"
    output = ROOT / "dist" / ("catch-sound-shared-extension.zip" if shared else "catch-sound-extension.zip")
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in sorted((ROOT / "extension").rglob("*")):
            if path.is_file():
                name = path.relative_to(ROOT / "extension").as_posix()
                if name == "private-connection.json":
                    continue
                if name == "server-config.js" and config:
                    archive.writestr(name, config)
                else:
                    archive.write(path, name)
    print(f"Built {output.name}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-url")
    parser.add_argument("--token-file", default=str(ROOT / ".env.shared"))
    args = parser.parse_args()
    build(args.server_url, args.token_file)
