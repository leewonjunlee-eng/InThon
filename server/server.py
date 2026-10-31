"""Catch Sound AI server: keeps the Lablup key and exposes judge/summarize/classify/profile."""

import argparse
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIRS = ("demo", "extension")  # .env가 있는 루트 전체를 공개하지 않는다.
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".wav": "audio/wav"}
MAX_BODY = 256 * 1024
MAX_TOKENS = 2000  # 모델이 추론에 토큰을 먼저 써서 800이면 응답이 잘린다.
RATE_LIMIT = 120  # ponytail: 프로세스별 분당 제한, 여러 인스턴스로 배포하면 공유 저장소 필요


def load_settings():
    settings = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                name, value = line.removeprefix("export ").split("=", 1)
                settings[name.strip()] = value.strip().strip("\"'")
    for name in ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "AUDIO_FOCUS_TOKEN"):
        settings[name] = os.environ.get(name) or settings.get(name, "")
    return settings


SETTINGS = load_settings()
hits = defaultdict(deque)


def ask(system, user):
    payload = {
        "model": SETTINGS["OPENAI_MODEL"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": MAX_TOKENS,
        "stream": False,
    }
    request = Request(
        SETTINGS["OPENAI_BASE_URL"].rstrip("/") + "/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + SETTINGS["OPENAI_API_KEY"], "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        content = json.load(response)["choices"][0]["message"].get("content")
    if not content:
        raise ValueError("empty model response")
    return content


def ask_json(system, user):
    prompt = system + " 모든 값은 한국어로 쓰고, 다른 설명 없이 JSON만 출력한다."
    for attempt in (1, 2):  # 모델이 가끔 깨진 JSON을 내서 한 번 더 시도한다.
        try:
            match = re.search(r"[\[{].*[\]}]", ask(prompt, user), re.S)
            if match:
                return json.loads(match.group())
        except ValueError:
            pass
    raise ValueError("no JSON in model response")


def text_field(body, name, limit=20000):
    value = body.get(name, "")
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    return value[:limit]


def judge(body):
    result = ask_json(
        "자막 기록을 보고 사용자가 지금 알아야 할 순간인지 판단한다. 기록에 있는 내용만 근거로 삼는다. "
        f"조건: {text_field(body, 'condition', 300)}. "
        '형식: {"important":true 또는 false,"reason":"짧은 이유"}',
        text_field(body, "text"),
    )
    return {"important": bool(result.get("important")), "reason": str(result.get("reason", ""))}


def summarize(body):
    result = ask_json(
        "사용자가 놓친 내용을 요약한다. 기록에 있는 내용만 쓰고 추측하지 않는다. 불확실하면 불확실하다고 적는다. "
        f"초점: {text_field(body, 'focus', 300)}. 세 줄 이내로 쓴다. "
        '형식: {"summary":"요약","evidence":["근거가 된 기록 줄을 그대로"]}',
        text_field(body, "text"),
    )
    evidence = result.get("evidence")
    return {"summary": str(result.get("summary", "")), "evidence": evidence if isinstance(evidence, list) else []}


def vision(body):
    image = text_field(body, "image", 200000)
    if not image.startswith("data:image/jpeg;base64,"):
        raise ValueError("image must be a JPEG data URL")
    result = ask_json(
        f"중계나 강의 화면을 보고 다음 조건에 해당하는지 판단한다: {text_field(body, 'condition', 300)}. "
        "화면에 보이는 내용만 근거로 삼는다. "
        '형식: {"important":true 또는 false,"summary":"화면에 보이는 내용을 한 문장으로"}',
        [{"type": "text", "text": "이 화면을 판단해 줘."}, {"type": "image_url", "image_url": {"url": image}}],
    )
    return {"important": bool(result.get("important")), "summary": str(result.get("summary", ""))}


def classify(body):
    topics = [str(topic)[:30] for topic in body.get("topics", [])][:20]
    tab = f"{text_field(body, 'host', 200)} | {text_field(body, 'title', 200)}"
    result = ask_json(
        f"브라우저 탭 하나를 다음 주제 중 하나로 분류한다: {', '.join(topics)}. 제목과 도메인만 보고 판단한다. "
        '형식: {"topic":"주제"}',
        tab,
    )
    topic = result.get("topic")
    return {"topic": topic if topic in topics else "기타"}


def profile(body):
    result = ask_json(
        "사용자의 한 줄 요청을 감지 프로필로 바꾼다. name은 짧은 주제 이름이다. relatedSites는 실제 도메인만 넣는다. keywords는 그 사건이 일어났을 때만 나오는 구체적인 표현만 넣고, 팀 이름이나 경기처럼 평소에도 나오는 단어는 넣지 않는다. "
        '형식: {"name":"","relatedSites":[],"relatedWords":[],"keywords":[],"condition":"","summaryFocus":""}',
        text_field(body, "request", 500),
    )
    clean = {key: str(result.get(key, "")) for key in ("name", "condition", "summaryFocus")}
    for key in ("relatedSites", "relatedWords", "keywords"):
        value = result.get(key)
        clean[key] = [str(item) for item in value][:20] if isinstance(value, list) else []
    clean["relatedSites"] = [site for site in clean["relatedSites"] if re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", site)]
    return clean


ROUTES = {"/judge": judge, "/summarize": summarize, "/vision": vision, "/classify": classify, "/profile": profile}


def rate_limited(client):
    now = time.monotonic()
    recent = hits[client]
    while recent and now - recent[0] > 60:
        recent.popleft()
    recent.append(now)
    return len(recent) > RATE_LIMIT


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 자막과 탭 제목을 로그에 남기지 않는다.

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Demo-Token")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.reply(204, {})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self.reply(200, {"ok": True})
        target = (ROOT / unquote(path).lstrip("/")).resolve()
        if path == "/":
            target = ROOT / "demo" / "index.html"
        allowed = any(target.is_relative_to(ROOT / name) for name in PUBLIC_DIRS)
        if not allowed or target.suffix not in CONTENT_TYPES or not target.is_file():
            return self.reply(404, {"error": "not found"})
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES[target.suffix])
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        route = ROUTES.get(self.path)
        if not route:
            return self.reply(404, {"error": "not found"})
        token = SETTINGS["AUDIO_FOCUS_TOKEN"]
        if token and not hmac.compare_digest(self.headers.get("X-Demo-Token", ""), token):
            return self.reply(401, {"error": "invalid token"})
        if rate_limited(self.client_address[0]):
            return self.reply(429, {"error": "too many requests"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {"error": "invalid body size"})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("body must be an object")
            self.reply(200, route(body))
        except (ValueError, KeyError, IndexError, TypeError) as error:
            self.reply(400, {"error": type(error).__name__})
        except HTTPError as error:
            self.reply(502, {"error": f"model HTTP {error.code}"})
        except (URLError, TimeoutError, OSError) as error:
            self.reply(502, {"error": type(error).__name__})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    if not all(SETTINGS[name] for name in ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL")):
        raise SystemExit("Missing OPENAI_* settings in .env or environment")
    print(f"Catch Sound server on http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
