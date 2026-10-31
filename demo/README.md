# CatchSound 통합 웹 체험

프로젝트 루트에서 `npm run preview`를 실행하고 http://127.0.0.1:8788/ 을 엽니다.

- UI 원본: `extension/popup/index.html`, `styles.css`, `app.js`
- Chrome 연결: `extension/lib/transport.js` → `extension/background.js`
- 웹 체험 연결: `demo/transport.js` → 실제 `AudioEngine` + 샘플 WAV 음원
- `demo/index.html`은 같은 UI를 로드하는 웹 진입점입니다.

웹 체험은 실제 브라우저 탭을 캡처하지 않습니다. A/B 샘플 소리 선택·연결·음량·좌우·음소거·집중·복귀를 확인할 수 있습니다.
프로필을 선택하면 음성 인식을 사용할 수 있으며, AI 판단·요약에는 서버 설정이 필요합니다.
이전 최소 엔진 체험 코드인 trial.js/trial.css는 새 UI에서 사용하지 않습니다.
