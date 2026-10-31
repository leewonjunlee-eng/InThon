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

## frontend 통합 브랜치 확인

`codex/frontend-catch-sound`는 main의 Catch Sound 엔진에 frontend의 A/B 화면과 탭 선택 흐름을 연결합니다.
`extension/popup/`이 공통 UI 원본이며 웹 체험도 같은 HTML 구조, CSS, UI 로직을 사용합니다.
웹은 샘플 음원을, 확장은 실제 Chrome 탭을 제어합니다. 서로 다른 UI를 따로 수정할 필요가 없습니다.

### 웹에서 먼저 확인

```
npm run preview
```

http://127.0.0.1:8788/ 에서 A/B 소리 선택 → 연결을 누릅니다.
샘플 음원의 음량, 좌우 방향, 음소거, 집중, 잠깐 확인, 복귀를 시험할 수 있습니다.
AI 설정이 없으면 AI 요청은 명확한 안내와 함께 503으로 응답합니다. 음성 인식은 프로필 선택 후 사용합니다.
실제 탭 캡처, 탭 이동, 소형 플레이어와 화면 감지는 Chrome 확장에서 확인해야 합니다.

### Chrome 확장에서 확인

1. chrome://extensions → 개발자 모드 → Load unpacked에서 **이 통합 브랜치의 extension 폴더**를 선택합니다.
2. 이전 Catch Sound 확장은 꺼 두어 중복 실행을 피합니다.
3. 소리가 나는 웹 탭에서 확장 아이콘을 누릅니다.
4. A 슬롯의 탭 선택 → 연결을 누릅니다. 다른 탭을 골랐다면 그 탭으로 이동한 뒤 아이콘을 다시 누릅니다.
5. 다른 소리 탭에서 B 슬롯도 연결하고 음량·방향·집중·복귀를 확인합니다.
6. AI 기능은 .env에 서버 주소·키·모델명을 설정하고 `npm run server`로 서버를 실행한 뒤 확인합니다.

선택 목록은 Chrome 세션 저장소에 보관되어 팝업을 닫아도 유지됩니다.
코드를 수정하면 확장 관리 화면에서 새로고침하고 기존 연결을 다시 연결하세요.

검증: `npm test`(순수 로직 및 실제 백그라운드 메시지 처리의 Chrome 모의 API 테스트), `npm run build`.
main 병합 전 실제 Chrome 탭 캡처와 AI 연결은 별도 확인이 필요합니다.

팝업은 소리 화면을 기본으로 표시합니다. 현재 화면 박스 오른쪽의 **세부 설정 (맡기기)**에서 감지 설정과 프로필 내용을 확인합니다. 탭 목록은 클릭 즉시 선택되며, 순간 목록은 팝업에서 숨기고 기존 알림 처리는 유지합니다.
