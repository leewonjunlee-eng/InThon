# 다른 PC에서 레블업 AI 사용하기

공용 중계 서버: **https://catch-sound-ai.vercel.app**

흐름은 `크롬 확장 → Vercel 중계 서버 → 기존 레블업 API/모델`이다.
사용자 PC에서 Python 서버를 실행하지 않아도 된다. 레블업 API 키는 Vercel의 비밀 환경변수에만 보관한다.

## 다른 PC에 설치

1. `feature/shared-ai-server` 브랜치를 내려받거나 최신 코드를 받습니다.
2. Chrome `chrome://extensions`에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**에서 저장소의 `extension/` 폴더를 선택합니다. 기존 설치를 업데이트했다면 확장 관리 화면에서 새로고침합니다.
4. 탭을 연결해 AI 조건을 생성합니다. 서버 주소·접속 토큰 입력과 Python 서버 실행은 필요 없습니다.

`extension/server-config.js`에 공용 서버 주소와 공개 배포용 접속 토큰이 포함됩니다. 레블업 API 키는 포함하지 않습니다. 이 토큰은 저장소를 내려받는 사람에게 공개되는 공유 접속 정보입니다.
새 연결 정보는 기존 로컬 주소·오래된 토큰을 한 번 갱신하고 음량·프로필 등 다른 설정은 유지합니다. 이후 직접 바꾼 설정은 유지됩니다. 수동 설정을 되돌리려면 「세부설정 → AI 서버 연결 → 공용 서버 기본 연결 복원」을 누릅니다.
공용 서버가 운영 중이고 토큰이 유효해야 합니다. 서버 토큰 변경 시 `extension/server-config.js`도 갱신해야 합니다.

## 서버 운영

- `app.py`와 `api/index.py`가 Vercel 요청을 받아 기존 `server/server.py`의 생성·분류·판단·요약·화면 판단 함수를 재사용한다.
- Vercel의 Production 비밀 환경변수: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AUDIO_FOCUS_TOKEN`.
- `OPENAI_*`는 이 프로젝트의 기존 변수명이며, 실제 호출 대상은 레블업이다. OpenAI 모델로 바꾸지 않았다.
- 공개 서버는 접속 토큰이 설정되지 않으면 AI 요청을 거부한다. `/health`에는 키나 토큰을 반환하지 않는다.
- 로컬 서버는 계속 `python server/server.py`로 실행할 수 있다. 이 경우 확장 서버 주소를 `http://127.0.0.1:8787`로 설정한다.
- `.env`, `.env.shared`, `.env.local`, `.vercel/`는 Git에서 제외하고, `.vercelignore`에서도 환경 파일을 배포 업로드에서 제외한다.
- 개발 PC의 `extension/private-connection.json`은 해당 PC 전용 연결 정보로, Git과 모든 ZIP에서 제외한다. 일반 ZIP에는 소스의 공용 연결 정보를 넣고, 별도 배포 빌드에는 빌드 시 지정한 연결 정보를 넣는다.
- 호출 제한은 사용자 IP·프로세스별 분당 180회다. 여러 인스턴스에 걸친 전역 사용량 제한은 제공하지 않는다.
- 기능 브랜치 push는 Preview로만 배포된다. Preview는 Vercel 인증으로 보호되고 환경변수가 없어(`aiReady:false`) 공용 서버로 쓸 수 없으며, 공용 주소는 Production 배포만 반영한다.

## 패키지와 검증

일반 빌드: `npm run build`. 생성된 `dist/catch-sound-extension.zip`에도 공용 연결 정보가 포함됩니다.

접속 토큰을 포함한 배포용 빌드:

```powershell
python scripts/build_extension.py --server-url https://catch-sound-ai.vercel.app --token-file .env.shared
```

이 명령은 `.env.shared`의 `AUDIO_FOCUS_TOKEN`만 ZIP의 `server-config.js`에 반영한다. 소스 파일을 변경하거나 레블업 키를 복사하지 않는다.

검증: `npm test`, Flask 3.1.3 설치 후 `python -m unittest discover -s tests -p "test_*.py"`, `npm run build`.
공개 URL에서 토큰 없는 요청 거부, 인증된 연결 확인, 실제 레블업 조건 생성을 검증했다.
Chrome 웹 체험에서도 공용 서버로의 실제 교차 출처 연결 확인을 검증했다.
