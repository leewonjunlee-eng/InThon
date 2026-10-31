# 다른 PC에서 레블업 AI 사용하기

공용 중계 서버: **https://catch-sound-ai.vercel.app**

흐름은 `크롬 확장 → Vercel 중계 서버 → 기존 레블업 API/모델`이다.
사용자 PC에서 Python 서버를 실행하지 않아도 된다. 레블업 API 키는 Vercel의 비밀 환경변수에만 보관한다.

## 다른 PC에 설치

1. 배포용 `dist/catch-sound-shared-extension.zip`을 전달한다.
2. 새 폴더에 압축을 푼다. 이전 Catch Sound 확장이 있다면 꺼둔다.
3. Chrome `chrome://extensions`에서 개발자 모드를 켜고 압축을 푼 폴더를 로드한다.
4. 탭을 연결해 AI 조건을 생성한다. Python 설치나 레블업 API 키 입력은 필요 없다.

이 ZIP에는 중계 서버 접속 토큰이 포함된다. 레블업 API 키는 포함되지 않는다.
기존 설치 설정이 유지되는 경우 새 폴더로 설치하거나 「세부설정 → AI 서버 연결」에서 공용 서버 주소와 접속 토큰을 저장하고 연결을 확인한다.
접속 토큰은 중계 서버용이며 레블업 API 키와 다르다. 일반 소스 빌드에는 접속 토큰을 넣지 않는다.

## 서버 운영

- `app.py`와 `api/index.py`가 Vercel 요청을 받아 기존 `server/server.py`의 생성·분류·판단·요약·화면 판단 함수를 재사용한다.
- Vercel의 Production 비밀 환경변수: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AUDIO_FOCUS_TOKEN`.
- `OPENAI_*`는 이 프로젝트의 기존 변수명이며, 실제 호출 대상은 레블업이다. OpenAI 모델로 바꾸지 않았다.
- 공개 서버는 접속 토큰이 설정되지 않으면 AI 요청을 거부한다. `/health`에는 키나 토큰을 반환하지 않는다.
- 로컬 서버는 계속 `python server/server.py`로 실행할 수 있다. 이 경우 확장 서버 주소를 `http://127.0.0.1:8787`로 설정한다.
- `.env`, `.env.shared`, `.env.local`, `.vercel/`는 Git에서 제외하고, `.vercelignore`에서도 환경 파일을 배포 업로드에서 제외한다.
- 호출 제한은 프로세스별 분당 120회다. 여러 인스턴스에 걸친 전역 사용량 제한은 제공하지 않는다.

## 패키지와 검증

일반 빌드: `npm run build`.

접속 토큰을 포함한 배포용 빌드:

```powershell
python scripts/build_extension.py --server-url https://catch-sound-ai.vercel.app --token-file .env.shared
```

이 명령은 `.env.shared`의 `AUDIO_FOCUS_TOKEN`만 ZIP의 `server-config.js`에 반영한다. 소스 파일을 변경하거나 레블업 키를 복사하지 않는다.

검증: `npm test`, Flask 3.1.3 설치 후 `python -m unittest discover -s tests -p "test_*.py"`, `npm run build`.
공개 URL에서 토큰 없는 요청 거부, 인증된 연결 확인, 실제 레블업 조건 생성을 검증했다.
Chrome 웹 체험에서도 공용 서버로의 실제 교차 출처 연결 확인을 검증했다.
