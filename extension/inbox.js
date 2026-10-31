// A page-local view of the session's shared do-not-disturb inbox.
if (!globalThis.catchSoundInboxLoaded) {
  globalThis.catchSoundInboxLoaded = true;
  let host, shadow, panel, list, badge, trigger, clearButton, error, heading;
  let items = [], expanded = false;
  let position = null, drag = null, suppressClick = false;
  const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));
  function place() {
    if (!host) return;
    const width = window.innerWidth, height = window.innerHeight;
    const point = position ?? { x: 20, y: height - 76 };
    const x = clamp(point.x, 8, width - 64), y = clamp(point.y, 8, height - 64);
    if (position) position = { x, y };
    Object.assign(host.style, { left: `${x}px`, top: `${y}px`, bottom: 'auto' });
    const panelWidth = Math.min(390, width - 40);
    const above = y - 22, below = height - y - 78;
    const openUp = above >= below;
    Object.assign(panel.style, {
      left: `${clamp(x, 8, width - panelWidth - 8) - x}px`,
      bottom: openUp ? '70px' : 'auto', top: openUp ? 'auto' : '70px',
      maxHeight: `${Math.max(0, Math.min(650, openUp ? above : below))}px`,
    });
  }
  window.addEventListener('resize', place);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function removeStaleHosts() {
    // Extension reloads create a fresh isolated world, but leave its old DOM behind.
    document.querySelectorAll('[id="catchsound-dnd-inbox"]').forEach(node => {
      if (node !== host) node.remove();
    });
  }
  removeStaleHosts();
  function mount() {
    removeStaleHosts();
    host = element('div');
    host.id = 'catchsound-dnd-inbox';
    host.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147483647';
    shadow = host.attachShadow({ mode: 'open' });
    const style = element('style');
    style.textContent = `
      :host{font:14px/1.5 system-ui,sans-serif;color:#242432}*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #b6aaff;outline-offset:3px}[hidden]{display:none!important}
      .bell{position:relative;display:grid;place-items:center;width:56px;height:56px;padding:0;border:0;border-radius:50%;background:#6254d8;color:white;box-shadow:0 6px 20px #30236a33}.bell{touch-action:none;user-select:none;cursor:grab}.bell.dragging{cursor:grabbing}.bell svg{display:block;width:26px;height:26px}.badge{position:absolute;right:-3px;top:-5px;display:grid;place-items:center;min-width:23px;height:23px;padding:0 5px;border:2px solid white;border-radius:20px;background:#4435ab;color:white;font-size:11px;font-weight:700}
      .panel{position:absolute;bottom:70px;left:0;width:min(390px,calc(100vw - 40px));max-height:min(650px,calc(100dvh - 110px));display:flex;flex-direction:column;border:1px solid #dedee8;border-radius:16px;background:#f5f4fa;box-shadow:0 14px 44px #24243226;overflow:hidden}.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;background:white;border-bottom:1px solid #eeedf4}.head strong{font-size:15px}.close{border:0;background:none;color:#737385;font-size:23px;line-height:1;padding:4px 8px}.sub{margin:4px 0 0;color:#737385;font-size:12px}
      .item-actions{display:flex;align-items:center;gap:6px}.delete-item{border:0;background:transparent;color:inherit;min-width:28px;min-height:28px;padding:2px;font-size:20px;line-height:1;border-radius:6px}.delete-item:hover{background:#80808018}.delete-item:disabled{opacity:.45;cursor:default}
      .list{overflow-y:auto;overscroll-behavior:contain;min-height:0;padding:12px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}.item{flex-shrink:0;padding:12px 14px;border:1px solid #dedee8;border-radius:12px;background:white;box-shadow:0 3px 10px #24243208}.meta{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#737385;font-size:11px;margin-bottom:5px}.brand{display:inline-flex;align-items:center;gap:5px;color:#242432;font-size:13px;font-weight:650;letter-spacing:-.3px}.brand img{width:24px;height:24px;object-fit:contain}.source{color:#6254d8;font-size:11px;overflow-wrap:anywhere}.item h3{font-size:15px;line-height:1.35;margin:4px 0}.item p{font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.preview{color:#737385;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.item details{margin-top:7px}.item summary{font-size:11px;color:#737385;cursor:pointer;padding:2px 0}.detail-body{margin-top:6px;padding:9px 10px;border-radius:8px;background:#f5f4fa;color:#555566}.detail-body blockquote{margin:8px 0 0;padding-top:8px;border-top:1px solid #dedee8;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.empty{padding:32px 8px;text-align:center;color:#737385;font-size:13px}.foot{padding:12px 16px;border-top:1px solid #eeedf4;background:white}.clear{width:100%;min-height:36px;border:1px solid #dedee8;background:#f8f7fc;color:#6254d8;border-radius:8px}.clear:disabled{opacity:.45;cursor:default}.error{margin:6px 0 0;font-size:12px;color:#b73743}
      @media(prefers-color-scheme:dark){
        :host{color-scheme:dark;color:#e8e7ed}
        .panel{background:#1f1f23;border-color:#414047;box-shadow:0 14px 44px #00000055}
        .head,.foot,.item{background:#242426;border-color:#414047}
        .item{box-shadow:0 3px 10px #00000020}
        .brand{color:#e8e7ed}
        .close,.sub,.meta,.preview,.item summary,.empty{color:#aaa7b5}
        .source{color:#b6aaff}
        .detail-body{background:#2d2c32;color:#c6c3d0}
        .detail-body blockquote{border-color:#414047}
        .clear{background:#393247;border-color:#48434f;color:#c2b6f2}
        .badge{border-color:#242426}
        .error{color:#f098a1}
      }
      @media(prefers-reduced-motion:no-preference){.bell:hover{background:#5344c7}}`;
    trigger = element('button', '', 'bell'); trigger.type = 'button';
    trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
    badge = element('span', '0', 'badge'); trigger.append(badge);
    panel = element('section', '', 'panel'); panel.id = 'inbox-panel'; panel.setAttribute('aria-label','방해 금지 중 모은 알림');
    trigger.setAttribute('aria-controls','inbox-panel');
    const head = element('div', '', 'head'), copy = element('div');
    heading = element('strong', '모아둔 알림');
    copy.append(heading, element('p', '방해 금지 중 받은 알림이에요.', 'sub'));
    const close = element('button', '×', 'close'); close.setAttribute('aria-label','알림 목록 닫기'); close.onclick = () => { expanded = false; showPanel(); trigger.focus(); };
    head.append(copy, close);
    list = element('div', '', 'list'); list.tabIndex = 0; list.setAttribute('aria-label', '쌓인 알림 목록');
    const foot = element('div', '', 'foot');
    clearButton = element('button','전부 지우기','clear');
    error = element('p','','error'); error.setAttribute('role','alert');
    clearButton.onclick = async () => {
      clearButton.disabled = true; error.textContent = '';
      try {
        const reply = await chrome.runtime.sendMessage({ to:'bg', cmd:'clear-dnd-inbox' });
        if (!reply?.ok) throw new Error(reply?.error || '알림을 지우지 못했어요. 다시 시도해 주세요.');
        update(reply.result ?? { enabled:true, items:[] });
      } catch (e) { error.textContent = e.message; clearButton.disabled = !items.length; }
    };
    foot.append(clearButton,error); panel.append(head,list,foot);
    trigger.title = '클릭하면 알림 보기 · 드래그하면 위치 이동';
    trigger.onpointerdown = event => {
      if (event.button !== 0 || !event.isPrimary) return;
      suppressClick = false;
      const rect = host.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      trigger.setPointerCapture(event.pointerId);
    };
    trigger.onpointermove = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; suppressClick = true;
      trigger.classList.add('dragging');
      position = { x: drag.left + dx, y: drag.top + dy };
      place();
    };
    const endDrag = event => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null; trigger.classList.remove('dragging');
      setTimeout(() => { suppressClick = false; }, 0);
      if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId);
    };
    trigger.onpointerup = endDrag;
    trigger.onpointercancel = endDrag;
    trigger.onlostpointercapture = endDrag;
    trigger.onclick = event => {
      if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
      expanded = !expanded; showPanel();
    };
    shadow.addEventListener('keydown',event => { if(event.key === 'Escape' && expanded){expanded=false;showPanel();trigger.focus();event.stopPropagation();} });
    shadow.append(style,panel,trigger);document.documentElement.append(host);
  }
  function showPanel(){place();panel.hidden=!expanded;trigger.setAttribute('aria-expanded',String(expanded));}
  function update(data) {
    removeStaleHosts();
    if (!data?.enabled) { host?.remove(); host=null; expanded=false; return; }
    if (!host) mount();
    const countReady = data.countReady !== false && Array.isArray(data.items);
    items = data.items ?? [];
    const scrollTop=list.scrollTop;
    badge.hidden = !countReady;
    badge.textContent = items.length > 99 ? '99+' : String(items.length);
    heading.textContent = countReady ? `모아둔 알림 ${items.length}` : '모아둔 알림';
    trigger.setAttribute('aria-label',countReady ? `방해 금지 알림 ${items.length}개 보기` : '방해 금지 알림 보기');
    list.replaceChildren();
    if (!items.length) list.append(element('p',countReady ? '아직 쌓인 알림이 없어요.' : '알림을 확인하고 있어요.','empty'));
    for(const item of items){
      const article=element('article','','item'), meta=element('div','','meta');
      const brand=element('span','','brand'), logo=element('img');
      logo.src=chrome.runtime.getURL('icons/brand.png'); logo.alt='';
      brand.append(logo,element('span','CatchSound'));
      const actions=element('div','','item-actions'), remove=element('button','×','delete-item');
      remove.type='button';remove.title='이 알림 삭제';remove.setAttribute('aria-label',`${item.topic || '알림'} 알림 삭제`);
      remove.onclick=async()=>{
        remove.disabled=true;error.textContent='';
        try {
          const reply=await chrome.runtime.sendMessage({to:'bg',cmd:'delete-dnd-item',id:item.id});
          if(!reply?.ok)throw new Error(reply?.error || '알림을 삭제하지 못했어요. 다시 시도해 주세요.');
          if(reply.result)update(reply.result);
        } catch(e){error.textContent=e.message;remove.disabled=false;}
      };
      actions.append(element('span',item.time || ''),remove);meta.append(brand,actions);
      const summary=item.summary || '내용을 정리하고 있어요.';
      const details=element('details'), body=element('div','','detail-body');
      body.append(element('p',summary));
      if(Array.isArray(item.evidence) && item.evidence.length) body.append(element('blockquote',item.evidence.join('\n')));
      details.append(element('summary','감지한 내용 보기'),body);
      article.append(meta,element('div',item.topic || '알림','source'),element('h3',item.keyword ? `“${item.keyword}” 감지` : '중요한 순간'),element('p',summary,'preview'),details);
      list.append(article);
    }
    list.scrollTop=scrollTop;clearButton.disabled=!items.length;showPanel();
  }
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.to!=='content'||message.cmd!=='dnd-inbox')return false;
    update(message.inbox);respond({ok:true});return false;
  });
  chrome.runtime.sendMessage({to:'bg',cmd:'get-dnd-inbox'}).then(reply=>{if(reply?.ok)update(reply.result);}).catch(()=>{});
}
