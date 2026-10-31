import { connectTutorialShortcuts } from "../lib/tutorial-shortcuts.js";
// Onboarding uses sample tabs and controls without changing real browser audio.
const KEY = 'catchsound-tutorial-v2';
const force = new URLSearchParams(location.search).get('tutorial') === '1';
let seen = false;
try { seen = localStorage.getItem(KEY) === 'done'; } catch {}
document.getElementById('tutorial-launcher')?.addEventListener('click', () => startTutorial(true));
if (!seen || force) startTutorial();
function startTutorial(manual=false) {
  if (document.querySelector('#ab-mock .onboarding')) return;
  document.documentElement.classList.add('tutorial-active');
  let firstVisible=true;
  let welcome=true, added=false, secondSelected=null, pickerTarget=0;
  let switched=false;
  const practiceVolumes=[80,20];
  let step=0, picker=false, connected=false, selected=0, volume=80, pan=0, preset='auto', dnd=false, inbox=false, detail=false;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const presets={
    auto:{name:'AI 자동 설정 (예시)',condition:'1. 과제 제출 기한이 안내되는 순간\n2. 수업 일정이 변경되는 순간',keywords:'과제, 제출 기한, 일정 변경'},
    custom:{name:'회의 액션 아이템',condition:'1. 내가 맡을 업무나 요청 사항이 정해지는 순간\n2. 업무 마감일이나 다음 회의 일정이 확정되는 순간',keywords:'담당, 요청 사항, 마감일, 다음 회의'},
  };
  let presetDraft=null;
  let exampleAlerts=[
    {id:1,source:'온라인 강의',title:'과제 제출 기한 안내',summary:'보고서는 다음 주 금요일 오후 6시까지 제출해주세요.'},
    {id:2,source:'팀 회의',title:'담당 업무가 정해졌어요',summary:'다음 회의 전까지 디자인 시안을 준비해달라는 요청이 있었어요.'},
    {id:3,source:'스포츠 중계',title:'역전 득점이 나왔어요',summary:'경기 종료를 앞두고 역전 득점으로 점수가 바뀌었어요.'},
  ];
  const samples=[
    {title:'작업할 때 듣는 음악 · 집중을 위한 플레이리스트 - YouTube',host:'youtube.com'},
    {title:'오늘의 온라인 강의 · 놓치면 안 되는 과제 안내 - YouTube',host:'youtube.com'},
    {title:'LCK · 오늘의 경기 하이라이트',host:'chzzk.naver.com'},
    {title:'팀 회의 · 이번 주 일정과 진행 상황',host:'meet.google.com'},
  ];
  const dialog=document.createElement('dialog'); dialog.className='onboarding'; dialog.setAttribute('aria-labelledby','onboarding-title');
  document.getElementById('ab-mock').append(dialog);
  const shell = document.querySelector('#ab-mock .app');
  const alignShell = () => {
    const rect = shell.getBoundingClientRect();
    Object.assign(dialog.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
  };
  const shellObserver = new ResizeObserver(alignShell);
  shellObserver.observe(shell);
  window.addEventListener('resize', alignShell);
  alignShell();
  const iconBase = new URL('../icons/', import.meta.url).href;
  const header=`<header class="tour-brand-header"><div><h2 class="brand-lockup"><img src="${iconBase}brand.png" width="36" height="36" alt="">CatchSound</h2><p class="sub">듣고 싶은 순간을 놓치지 않는 방법</p></div></header>`;
  const key='<span class="tour-key">Ctrl + Shift + K</span>';
  const button=(text,action,cls='')=>`<button type="button" class="${cls}" data-tour="${action}">${text}</button>`;
  const source=()=>`<div class="source"><strong>${samples[selected].title}</strong><span class="sub">${samples[selected].host} · 연습용 탭</span></div>`;
  const status=()=>step===1&&switched ? `<div class="slot-heading"><h3 class="tab-status standby"><span class="status-icon" aria-hidden="true"><img src="${iconBase}pause.svg" width="18" height="18" alt=""></span>대기 탭</h3></div>` : '<div class="slot-heading"><h3 class="tab-status focused"><span class="status-icon"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill="currentColor"/></svg></span>집중 탭</h3></div>';
  const soundControls=()=>`<label class="stack"><span class="row"><span>${switched ? "대기" : "집중"} 음량</span><output id="tour-volume">${volume}%</output></span><input aria-label="연습용 ${switched ? "대기" : "집중"} 음량" data-tour-volume type="range" min="0" max="100" value="${volume}"></label><div class="segments" role="group" aria-label="연습용 출력 방향">${[-1,0,1].map((n,i)=>`<button data-tour="pan:${n}" aria-pressed="${pan===n}">${['왼쪽','양쪽','오른쪽'][i]}</button>`).join('')}</div>${switched ? button("여기에 집중","focus-current","full") : '<button class="solid full" disabled>집중 중</button>'}`;
  const presetControl=()=>`<label class="stack slot-preset"><span class="sub">알림 프리셋</span><select aria-label="연습용 알림 프리셋" data-tour-preset><option value="" ${preset===''?'selected':''}>알림 사용 안 함</option><option value="auto" ${preset==='auto'?'selected':''}>AI 자동 설정 (예시)</option><option value="custom" ${preset==='custom'?'selected':''}>내 프리셋 · ${escape(presets.custom.name)}</option></select></label>`;
  const conditions=()=>preset ? `<div class="tour-condition sub"><strong>이럴 때 알려줘요</strong><p class="tour-condition-preview">${escape(presets[preset].condition)}</p>${button('알림 조건 확인·수정','conditions','quiet full tour-link')}</div>`:'';
  const alertExample=()=>preset ? `<div class="tour-example-arrow">↓ 이런 알림을 받아요 · 예시</div><article class="tour-example-notification"><div class="tour-example-brand"><img src="${iconBase}brand.png" width="20" height="20" alt=""><strong>CatchSound</strong><span class="sub">${preset==='custom'?'팀 회의':'온라인 강의'}</span></div><h3>${preset==='custom'?'담당 업무가 정해졌어요':'과제 제출 기한 안내'}</h3><p>${preset==='custom'?'다음 회의 전까지 디자인 시안을 준비해달라는 요청이 있었어요.':'보고서 제출은 다음 주 금요일 오후 6시까지예요.'}</p></article>` : '<div class="tour-condition sub">알림을 사용하지 않으면 중요한 순간을 따로 알려드리지 않아요. 프리셋을 골라 예시를 확인해보세요.</div>';

  function render(focus=false) {
    if(welcome) {
      dialog.innerHTML=`<div class="tour-welcome"><div class="tour-welcome-brand"><img src="${iconBase}brand.png" width="104" height="104" alt=""><h2 id="onboarding-title">CatchSound</h2></div><p class="sub">듣고 싶은 순간을 놓치지 않는 방법</p><div class="tour-welcome-actions">${button('튜토리얼 시작하기','start','solid full')}${button('넘어가기','skip','quiet full')}</div></div>`;
      if(focus) dialog.querySelector('[data-tour="start"]').focus();
      return;
    }
    const titles=['듣고 싶은 탭을 연결해보세요','지금 듣는 소리와 기다리는 소리를 나눠보세요','어떤 순간에 알려드릴까요?','집중하는 동안 알림을 모아두세요'];
    const descriptions=[`${key}로 현재 탭을 연결해보세요. 직접 골라도 돼요.`, '<strong>집중 탭</strong>은 주로 듣고, <strong>대기 탭</strong>은 음량을 낮춰 중요한 순간을 기다려요.', '알림은 놓치고 싶지 않은 순간을 알려줘요.<br>프리셋은 알림을 받을 조건을 모아둔 설정이에요.', '방해 금지를 켜면 알림이 바로 뜨지 않고 종 버튼에 모여요.<br>필요할 때 열어보고, 확인한 알림은 지워보세요.'];
    let content='';
    if(step===0 && picker) content=`${button('← 슬롯으로 돌아가기','picker-back','quiet')}<h3>연결할 탭 선택</h3><p class="sub">탭을 누르면 바로 슬롯에 선택됩니다.</p><div class="picker">${samples.map((s,i)=>button(`<span>${s.title}<span class="sub">${s.host}</span></span>`,`select:${i}`,'choice')).join('')}</div>`;
    else if(step===0) {
      const emptyCard = target => `<article class="slot empty tour-add-card tour-empty-card"><div class="slot-heading"><h3 class="tab-status vacant"><span class="status-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span>비어 있음</h3><button type="button" class="quiet remove-slot" data-tour="${target===1?'remove-added':'remove-first'}" aria-label="비어 있는 탭 삭제" title="탭 삭제"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><p class="sub">이 자리에 들을 소리를 넣어주세요.</p>${button('＋ 연결할 탭 고르기',`pick:${target}`,'full')}</article>`;
      content = connected ? `<article class="slot focus-card">${status()}${source()}</article>${!added ? button('다른 탭 직접 선택하기','pick:0','quiet full') : ''}` : firstVisible ? emptyCard(0) : '';
      if(added) content += secondSelected === null ? emptyCard(1) : `<article class="slot tour-add-card tour-standby-card"><div class="slot-heading"><h3 class="tab-status standby"><span class="status-icon" aria-hidden="true"><img src="${iconBase}pause.svg" width="18" height="18" alt=""></span>대기 탭</h3><button type="button" class="quiet remove-slot" data-tour="remove-added" aria-label="대기 탭 삭제"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><div class="source"><strong>${samples[secondSelected].title}</strong><span class="sub">${samples[secondSelected].host}</span></div></article>${button('다른 탭 직접 선택하기','pick:1','quiet full')}`;
      if(!added) content += button('＋ 탭 추가','add-tab','add-slot full tour-add-button');
    }
    if(step===1) content=`<article class="slot tour-audio-card ${switched ? "tour-standby-card" : "focus-card"}">${status()}${source()}${soundControls()}</article><p class="sub">${switched ? '이 탭이 대기 상태예요. Ctrl + Shift + ← 또는 ‘여기에 집중’으로 다시 집중해보세요.' : 'Ctrl + Shift + →를 누르면 이 탭이 대기 상태가 돼요. ←를 누르면 다시 집중 상태로 돌아와요.'}</p>`;
    if(step===2) content=detail ? `<form id="tour-preset-editor" class="tour-preset-editor"><h3>알림 조건을 다듬어주세요</h3><label class="stack">프리셋 이름<input type="text" name="name" required maxlength="60" value="${escape(presetDraft.name)}"></label><label class="stack">알림 조건<textarea name="condition" rows="4" required maxlength="2000">${escape(presetDraft.condition)}</textarea></label><label class="stack">감지 키워드<input type="text" name="keywords" maxlength="500" value="${escape(presetDraft.keywords)}"><span class="sub">쉼표로 구분해 입력하세요.</span></label></form>` : `<div class="tour-preset-demo">${presetControl()}${conditions()}${alertExample()}</div>`;
    if(step===3) content=`<div class="tour-dnd"><div class="tour-inbox-area">${dnd?`${inbox?`<section class="tour-inbox" aria-label="모아둔 알림"><div class="tour-inbox-heading"><div><strong>모아둔 알림 ${exampleAlerts.length}</strong><p class="sub">방해 금지 중 받은 알림이에요.</p></div><button type="button" class="quiet tour-inbox-close" data-tour="inbox" aria-label="모아둔 알림 닫기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>${exampleAlerts.length ? `<div class="tour-alert-list">${exampleAlerts.map(alert=>`<article class="tour-alert-card"><div class="tour-alert-heading"><span class="sub">${alert.source} · 예시</span><button type="button" class="quiet" data-tour="delete-alert:${alert.id}" aria-label="${alert.title} 삭제"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><strong>${alert.title}</strong><p>${alert.summary}</p></article>`).join('')}</div>` : '<div class="tour-inbox-empty">아직 쌓인 알림이 없어요.</div>'}<div class="tour-inbox-footer"><button type="button" class="full" data-tour="clear-alerts" ${exampleAlerts.length ? '' : 'disabled'}>전부 지우기</button></div></section>`:''}<button type="button" class="tour-bell" data-tour="inbox" aria-label="모아둔 알림 ${exampleAlerts.length}개 보기" aria-expanded="${inbox}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>${exampleAlerts.length}</span></button>`:'<div class="tour-dnd-placeholder">방해 금지를 켜고<br>모아둔 알림을 확인해보세요.</div>'}</div></div>`;
    dialog.innerHTML=`${header}<div class="tour-stage"><div class="tour-progress" role="progressbar" aria-label="튜토리얼 진행 단계" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${step+1}">${[0,1,2,3].map(i=>`<span class="${i<=step?'filled':''}"></span>`).join('')}</div><div class="tour-heading"><span class="sub">시작하기 · ${step+1}/4</span>${button('건너뛰기','skip','quiet')}</div><div class="tour-title-row"><h3 id="onboarding-title">${step===2&&detail?'프리셋을 직접 수정해보세요':titles[step]}</h3>${step===3 ? `<input type="checkbox" class="setting-switch" data-tour-dnd aria-label="연습용 방해 금지" ${dnd?'checked':''}>` : ''}</div><p class="sub tour-description">${step===2&&detail?'원하는 조건으로 바꾸고 저장하면 이 탭에 적용돼요.':descriptions[step]}</p><div class="tour-content">${content}</div><div class="tour-footer">${step===2&&detail ? button('취소','cancel-preset')+button('저장하고 적용','save-preset','solid') : (step?button('이전','back'):'')+button(step===3?'시작하기':'다음','next','solid')}</div></div>`;
    if(focus) dialog.querySelector('[data-tour="next"]').focus({preventScroll:true});
  }
  function close(){shellObserver.disconnect();window.removeEventListener('resize',alignShell);document.documentElement.classList.remove('tutorial-active');try{localStorage.setItem(KEY,'done');}catch{} document.removeEventListener('keydown',onKey,true);releaseShortcuts();dialog.close();dialog.remove();if(force){const url=new URL(location.href);url.searchParams.delete('tutorial');history.replaceState(null,'',url);}document.getElementById(manual ? 'tutorial-launcher' : 'settings-toggle')?.focus();}
  function practiceCommand(command){
    if(welcome) return;
    if(step===0 && command==='connect-tab') {
      firstVisible=true;connected=true;selected=0;picker=false;render(true);
    } else if(step===1 && ['switch-focus','restore'].includes(command)) {
      practiceVolumes[switched ? 1 : 0]=volume;
      switched=command==='switch-focus';
      volume=practiceVolumes[switched ? 1 : 0];
      render(true);
    }
  }
  function onKey(event){
    if(!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat) return;
    const command={KeyK:'connect-tab',ArrowRight:'switch-focus',ArrowLeft:'restore'}[event.code];
    if(!command) return;
    event.preventDefault();event.stopImmediatePropagation();
    practiceCommand(command);
  }
  dialog.addEventListener('click',event=>{const action=event.target.closest('[data-tour]')?.dataset.tour;if(!action)return;event.stopPropagation();if(action==='skip'||action==='next'&&step===3)return close();if(action==='start'){welcome=false;render(true);return;}if(action==='next'){step++;picker=false;}else if(action==='back'){step--;picker=false;}else if(action==='add-tab'){if(!firstVisible)firstVisible=true;else added=true;}else if(action==='remove-first'){if(added){connected=secondSelected!==null;if(connected)selected=secondSelected;added=false;secondSelected=null;}else{firstVisible=false;connected=false;}}else if(action==='remove-added'){added=false;secondSelected=null;}else if(action.startsWith('pick:')){pickerTarget=Number(action.split(':')[1]);picker=true;}else if(action==='picker-back')picker=false;else if(action.startsWith('select:')){const chosen=Number(action.split(':')[1]);if(pickerTarget===1)secondSelected=chosen;else{selected=chosen;connected=true;}picker=false;}else if(action==='focus-current'){practiceVolumes[1]=volume;switched=false;volume=practiceVolumes[0];}else if(action.startsWith('pan:'))pan=Number(action.split(':')[1]);else if(action==='conditions'){presetDraft={...presets[preset]};detail=true;}
    else if(action==='cancel-preset'){detail=false;presetDraft=null;}
    else if(action==='save-preset'){
      const form=dialog.querySelector('#tour-preset-editor');
      const name=form.elements.name, condition=form.elements.condition;
      name.setCustomValidity(name.value.trim()?'':'프리셋 이름을 입력해주세요.');
      condition.setCustomValidity(condition.value.trim()?'':'알림 조건을 입력해주세요.');
      if(!form.reportValidity())return;
      presets[preset]={name:name.value.trim(),condition:condition.value.trim(),keywords:form.elements.keywords.value.split(',').map(word=>word.trim()).filter(Boolean).join(', ')};
      detail=false;presetDraft=null;
    }else if(action==='clear-alerts')exampleAlerts=[];else if(action.startsWith('delete-alert:'))exampleAlerts=exampleAlerts.filter(alert=>alert.id!==Number(action.split(':')[1]));else if(action==='inbox')inbox=!inbox;render(action==='next'||action==='back');});
  dialog.addEventListener('submit',event=>event.preventDefault());
  dialog.addEventListener('input',event=>{if(event.target.closest('#tour-preset-editor')){event.target.setCustomValidity('');presetDraft[event.target.name]=event.target.value;event.stopPropagation();}if(event.target.matches('[data-tour-volume]')){volume=Number(event.target.value);dialog.querySelector('#tour-volume').textContent=volume+'%';event.stopPropagation();}});
  dialog.addEventListener('change',event=>{if(event.target.matches('[data-tour-preset]'))preset=event.target.value;else if(event.target.matches('[data-tour-dnd]')){dnd=event.target.checked;inbox=dnd;}else return;event.stopPropagation();render();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});document.addEventListener('keydown',onKey,true);render();dialog.showModal();
  const releaseShortcuts = connectTutorialShortcuts(globalThis.chrome?.runtime, practiceCommand);
  window.addEventListener("pagehide", releaseShortcuts, { once: true });
}
