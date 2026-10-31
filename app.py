"""Public HTTPS relay for Vercel. The Lablup credential never leaves the server."""
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException
import hmac
from urllib.error import HTTPError, URLError
from server import server as backend

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = backend.MAX_BODY


@app.after_request
def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Demo-Token"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS, GET"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def relay(path):
    if request.method == "OPTIONS":
        return "", 204
    if request.method == "GET" and path in ("", "health"):
        return jsonify(service="Catch Sound AI", ok=True, aiReady=backend.AI_READY,
                       authRequired=True, capabilities=["suggest-profile", "prompt-alerts", "connection-check"])
    route = backend.ROUTES.get("/" + path)
    if request.method != "POST" or not route:
        return jsonify(error="not found"), 404
    token = backend.SETTINGS["AUDIO_FOCUS_TOKEN"]
    if not token:
        return jsonify(error="공용 서버 접속 토큰이 설정되지 않았습니다."), 503
    if not hmac.compare_digest(request.headers.get("X-Demo-Token", "").encode(), token.encode()):
        return jsonify(error="서버 접속 토큰이 올바르지 않습니다."), 401
    if not backend.AI_READY:
        return jsonify(error="서버의 레블업 연결 설정이 필요합니다."), 503
    if backend.rate_limited(request.remote_addr or "unknown"):
        return jsonify(error="요청이 많습니다. 잠시 후 다시 시도해 주세요."), 429
    try:
        body = request.get_json(force=True)
        if not isinstance(body, dict):
            return jsonify(error="요청은 JSON 객체여야 합니다."), 400
        return jsonify(route(body))
    except HTTPError as error:
        return jsonify(error=f"model HTTP {error.code}"), 502
    except (URLError, TimeoutError, OSError):
        return jsonify(error="레블업 서버에 연결하지 못했습니다."), 502
    except (ValueError, KeyError, IndexError, TypeError):
        return jsonify(error="AI 응답을 처리하지 못했습니다. 다시 시도해 주세요."), 502
    except HTTPException as error:
        return jsonify(error="요청 크기 또는 JSON 형식을 확인해 주세요."), error.code
