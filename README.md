# Catch Sound

보고 있는 일에 맞춰 탭 소리를 메인과 대기로 나누고, 대기 중인 소리를 대신 들어 중요한 순간을 알려 주는 크롬 확장입니다.

기능별 구현 범위와 확인 수준은 [read.md](read.md)에 정리했습니다.

## 실행

1. 프로젝트 루트 `.env`에 `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`을 설정합니다.
2. `python server/server.py`로 AI 서버를 켭니다. 기본 주소는 `http://127.0.0.1:8787`입니다.
3. `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 `extension/`을 고릅니다.
4. 소리가 나는 탭에서 아이콘을 눌러 연결하고, 맡기기 탭에서 프로필을 고릅니다.

연습용 중계는 `http://127.0.0.1:8787/demo/broadcast.html`, `?f=lecture`로 열 수 있습니다.
설치 없는 웹 체험은 `http://127.0.0.1:8787/`입니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `extension/background.js` | 탭 연결, 상태, 메인·대기 판단, 알림 |
| `extension/engine.js` | 소리 조절, 음성 인식, 순간 감지. 웹 체험과 공유 |
| `extension/lib/logic.js` | 크롬 API 없는 판단 로직 |
| `extension/popup/` | 툴바 팝업 화면 |
| `extension/content.js` | 페이지 위 호출 알림 카드 |
| `server/server.py` | 래블업 호출, API 키 보관, 웹 체험 페이지 제공 |
| `demo/` | 웹 체험과 모의 중계 |

배포할 때는 환경 변수 `AUDIO_FOCUS_TOKEN`을 설정하고, 맡기기 탭의 서버 주소와 데모 토큰을 바꿉니다.
크롬 음성 인식은 클라우드 방식이라 대기 탭의 음성이 인식 서비스로 전송됩니다.
화면 감지를 켜면 대기 탭의 화면 이미지가 판단 서버와 모델로 전송됩니다.

단축키는 `Alt+Shift+K`(연결), `Alt+Shift+→`(다른 소리에 집중), `Alt+Shift+←`(복귀)입니다.

## 시험과 빌드

```
npm test
npm run build
```

`npm run build`는 `dist/catch-sound-extension.zip`을 만듭니다.
