export function monitorSnapshot(slots, now = Date.now()) {
  const items = slots.filter(s => s.tabId !== null).map(s => {
    const h = s.monitor, enabled = Boolean(s.profileId) && s.role === 'standby';
    let status = 'off', detail = s.profileId ? '집중 탭은 알림을 감지하지 않아요' : '알림 사용 안 함';
    if (!h || now - h.at > 16000) { status = 'delay'; detail = '소리 엔진 상태 확인 중'; }
    else if (h.audio === 'error') { status = 'error'; detail = '소리 연결 종료 · 다시 연결해주세요'; }
    else if (enabled && h.alertEnabled === false && s.alertSetup?.status !== 'generating' && s.alertSetup?.status !== 'error') { status = 'off'; detail = '활성 알림 조건 없음'; }
    else if (enabled) {
      if (s.alertSetup?.status === 'error' && s.profileId === 'auto') { status = 'error'; detail = '알림 조건 생성 실패'; }
      else if (h.speech === 'error' || h.judge === 'error' || h.screen === 'error') { status = 'error'; detail = (h.speech === 'error' ? h.speechError : h.judge === 'error' ? h.judgeError : h.screenError) || h.error || '감지 오류 · 소리 조절 가능'; }
      else if (h.judge === 'delay' || h.screen === 'delay') { status = 'delay'; detail = 'AI 판단 응답이 늦어지고 있어요'; }
      else if (h.speech !== 'ready' || s.alertSetup?.status === 'generating') { status = 'preparing'; detail = '음성 인식·알림 조건 준비 중'; }
      else { status = 'ready'; detail = '감지 중 · 확인된 오류 없음'; }
    }
    return { tabId:s.tabId, title:s.title, status, detail, audio:h?.audio ?? 'unknown', lastSpeechAt:h?.lastSpeechAt ?? null };
  });
  const count = key => items.filter(i => i.status === key).length;
  return { items, connected:items.length, ready:count('ready'), errors:count('error'), delayed:count('delay'), preparing:count('preparing') };
}
