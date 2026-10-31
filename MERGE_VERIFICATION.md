# main / 자동 알림 조건 통합 검증

기준: `origin/main`의 `78f35ec`와 `feature/auto-alert-profiles`의 `32e4aac`.
한쪽 파일을 통째로 선택하지 않고 양쪽 변경을 병합했다.

| 보존한 기능 | 확인 근거 |
| --- | --- |
| 집중·대기 상태 표시, 0.2.0, Control / MacCtrl 단축키, 아이콘 | popup / package 테스트, 실제 headless Chrome 웹 체험 |
| 집중 시 대상 탭·창 활성화, 음소거·고정 해제 | Chrome 모의 API integration 테스트 |
| 복귀 시 기존 음량·좌우·음소거·고정 상태 복원 | integration / preview 테스트 |
| 지속 알림, 새 알림 교체, 닫힌 알림의 늦은 응답 무시 | alerts / integration 테스트 |
| 최근 자막 즉시 표시 → 같은 알림을 AI 요약으로 갱신 | summary 테스트 |
| 탭 스캔 후 자동 조건 생성, 조건별 편집·활성화 | page-context / auto-profiles / popup 테스트 |
| 사용자 요청 우선 재생성, 요청 유지, 사용자 수정 보호 | auto-profiles / popup / preview 테스트, 실제 레블업 호출 |
| 메인 탭 문맥 수집, 대기 탭 감지, 오래된 판단 차단 | engine / integration 테스트 |
| 웹 체험과 확장의 공통 UI·오디오 엔진 | preview 테스트, 실제 headless Chrome 샘플 음원 연결 |
| 방해 금지, 시스템 알림 교체·집중 버튼 | integration 테스트 |

통합 시 중요한 구분: 아직 알림이 표시되기 전 조건·포커스·연결이 바뀌면 오래된 판단을 버린다.
이미 표시된 알림의 요약은 과거 사건의 보완이므로 끝까지 처리하되, `moment-update`만 보내 새 알림을 열지 않는다.

검증 결과:

- `npm test`: JavaScript 테스트 36개 통과. `tests/*.test.js` 전체를 실행해 두 브랜치의 테스트가 빠지지 않게 했다.
- `python -m unittest discover -s tests -p test_server.py`: 서버 테스트 4개 통과.
- `npm run build`: 성공. Git에 올라갈 파일만 추출한 사본에서도 테스트와 빌드 성공.
- 실제 headless Chrome: 샘플 소리 2개 연결, 집중·대기 표시, 요청 기반 조건 재생성, 직접 수정·저장·포커스 전환 확인. 이 UI 검증의 AI 응답은 모의 응답이다.
- 실제 레블업 API: 가상의 방송 정보로 생성 API 및 한화 갱킹·한타 요청 반영 확인. 아이콘 PNG와 SVG의 서버 제공도 확인.
- Claude에 양쪽 변경과 통합 코드를 제공해 읽기 전용 검토를 진행하고, 판단 결과 차단과 기존 알림 요약 완료를 구분하라는 검토 의견을 반영했다.
- 추가 Claude 검토에서 확인한 자동 모드의 이전 탭 복귀, 알림 삭제 시 화면·시스템 알림 제거, 탭 간 새 알림 교체, 자막 없는 주기 판단의 급등 알림 방해도 수정하고 회귀 테스트에 포함했다.
- 재검토에서 지적한 반복 집중 시 복귀 지점 보존, 대기 중인 AI 판단과 키워드 알림 사이의 경합도 수정했다. 같은 밀리초에 발생하는 경우까지 테스트한다.

한계: 이번 검증에서 실제 YouTube 탭의 장시간 캡처·음성 인식 정확도, 실제 운영체제 알림 표시 시간은 재측정하지 않았다.
