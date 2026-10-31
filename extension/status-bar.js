// Isolated page UI. No page content or audio is collected here.
if (!globalThis.catchSoundStatusLoaded) {
  globalThis.catchSoundStatusLoaded = true;
  const KEY = 'catchsound-status-position';
  document.getElementById('catchsound-status')?.remove();
  const host = document.createElement('div'); host.id = 'catchsound-status';
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none';
  const shadow = host.attachShadow({ mode:'open' });
  shadow.innerHTML = `<style>
  :host{color:#292836;font:12px/1.5 system-ui,sans-serif}*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #8f81ef;outline-offset:2px}[hidden]{display:none!important}
  .shell{width:min(294px,calc(100vw - 24px));background:#fff;border:1px solid #e2dfec;border-radius:12px;box-shadow:0 4px 18px #29213914;overflow:hidden}
  .bar{height:38px;display:flex;align-items:center;gap:6px;padding:0 8px 0 3px}.handle{height:30px;width:27px;border:0;border-radius:6px;background:none;color:#aaa5b8;font-size:21px;cursor:grab;touch-action:none;user-select:none}.handle:active{cursor:grabbing;background:#f1eff8}
  .toggle{flex:1;display:flex;align-items:center;gap:7px;border:0;background:none;text-align:left;color:#393445;padding:4px 0;white-space:nowrap}.dot{width:6px;height:6px;border-radius:50%;background:#6254d8;flex-shrink:0}.error .dot{background:#c64b51}.delay .dot,.preparing .dot{background:#bc8224}.off .dot{background:#9d98a8}.close{border:0;background:none;color:#88818f;font-size:18px;padding:2px 5px;border-radius:5px}.close:hover{background:#f1eff8}
  .panel{border-top:1px solid #efedf4;padding:12px;max-height:min(360px,calc(100vh - 80px));overflow:auto}.item{border-top:1px solid #f0eef5;padding:10px 0}.item:last-child{padding-bottom:0}.item:first-child{border-top:0;padding-top:0}.status{font-size:11px;font-weight:650;margin-top:5px}.error .status{color:#b04750}.delay .status,.preparing .status{color:#936419}.ready .status{color:#6254d8}.off .status{color:#777080}.title{font-size:12px;font-weight:600;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.detail{display:flex;gap:6px;align-items:center;margin-top:5px;color:#777080;font-size:11px}.meta{margin-top:3px;font-size:10px;color:#918a9c}.actions{display:flex;gap:7px;margin-top:8px}.actions button{border:1px solid #e6e1f1;border-radius:6px;background:#f6f4fc;color:#6254d8;padding:4px 9px;font-size:11px}.message{color:#b04750;font-size:11px;margin:6px 0 0}.message:empty{display:none}
  </style><section class="shell" aria-label="CatchSound 감지 상태"><div class="bar"><button class="handle" aria-label="상태바 이동" title="드래그 또는 방향키로 이동">⠿</button><button class="toggle" aria-expanded="false" aria-controls="monitor-panel"><span class="dot"></span><span class="label">상태 확인 중</span></button><button class="close" aria-label="상태바 닫기" title="상태바 닫기">×</button></div><div class="panel" id="monitor-panel" hidden><div class="list"></div><p class="message" role="status"></p></div></section>`;
  document.documentElement.append(host);
  const $ = s => shadow.querySelector(s);
  let position = null, expanded = false, drag = null, signature = '', stopped = false, dismissed = false;
  const clamp = (n, max) => Math.max(12, Math.min(n, Math.max(12,max)));
  function place() {
    const width = $('.shell').getBoundingClientRect().width || 294;
    const height = host.getBoundingClientRect().height || 38;
    const x = clamp(position ? position.x * innerWidth : innerWidth - width - 16, innerWidth - width - 12);
    const y = clamp(position ? position.y * innerHeight : 12, innerHeight - height - 12);
    host.style.left = x+'px'; host.style.top = y+'px';
    const overlap = host.style.display !== 'none' && x+width > innerWidth-380 && y < 90;
    document.documentElement.style.setProperty('--catchsound-status-bottom', overlap ? `${y+height+10}px` : '12px');
  }
  async function savePosition() {
    try { await chrome.storage.local.set({[KEY]:position}); } catch {}
  }
  $('.toggle').onclick = () => {
    expanded=!expanded; $('.panel').hidden=!expanded;
    $('.toggle').setAttribute('aria-expanded', String(expanded)); place();
  };
  $('.close').onclick = () => { dismissed=true; host.style.display='none'; place(); };
  const handle=$('.handle');
  handle.onpointerdown=e=>{
    if(e.button!==0) return;
    const r=host.getBoundingClientRect(); drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};
    handle.setPointerCapture(e.pointerId); e.preventDefault();
  };
  handle.onpointermove=e=>{
    if(!drag || drag.id!==e.pointerId)return;
    position={x:(drag.left+e.clientX-drag.x)/innerWidth,y:(drag.top+e.clientY-drag.y)/innerHeight}; place();
  };
  function endDrag(e) {
    if(!drag || drag.id!==e.pointerId)return;
    drag=null;
    const r=host.getBoundingClientRect();position={x:r.left/innerWidth,y:r.top/innerHeight};
    if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
    void savePosition();
  }
  handle.onpointerup=endDrag;handle.onpointercancel=endDrag;handle.onlostpointercapture=endDrag;
  handle.onkeydown=e=>{
    const d={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];
    if(!d)return;e.preventDefault();const r=host.getBoundingClientRect();
    position={x:(r.left+d[0])/innerWidth,y:(r.top+d[1])/innerHeight};place();void savePosition();
  };
  function node(tag,text,cls) {const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
  function update(snapshot) {
    if(!snapshot || stopped)return;
    if(!snapshot.connected) dismissed=false;
    host.style.display=snapshot.connected && !dismissed?'block':'none';
    const state=snapshot.errors?'error':snapshot.delayed?'delay':snapshot.preparing?'preparing':snapshot.ready?'ready':'off';
    const suffix=snapshot.errors?`실패 ${snapshot.errors}`:snapshot.delayed?`지연 ${snapshot.delayed}`:snapshot.preparing?`준비 중 ${snapshot.preparing}`:snapshot.ready ? `감지 중 ${snapshot.ready}` : '알림 사용 안 함';
    $('.bar').className='bar '+state;
    $('.label').textContent=`${state==='error'?'⚠ ':''}연결 ${snapshot.connected} · ${suffix}`;
    const key=JSON.stringify(snapshot.items);
    if(key!==signature){
      signature=key;$('.list').replaceChildren();
      for(const item of snapshot.items){
        const row=node('div','','item '+item.status);const title=node('div',item.title,'title');title.title=item.title;
        const detail=node('div','','detail');detail.append(node('span','','dot'),node('span',item.detail));
        const statusLabel={ready:'정상 · 감지 중',preparing:'준비 중',delay:'지연',error:'실패',off:'알림 사용 안 함'}[item.status];
        row.append(title,node('div',statusLabel,'status'));
        if(item.detail!==statusLabel) row.append(detail);
        if(item.lastSpeechAt) row.append(node('div',`마지막 음성 인식 ${new Date(item.lastSpeechAt).toLocaleTimeString('ko-KR')}`,'meta'));
        const actions=node('div','','actions');
        for(const [label,cmd] of [[item.status==='error'||item.status==='delay'?'다시 시도':null,'retry-monitor'],['탭으로 이동','goto']]){
          if(!label)continue;const b=node('button',label);b.onclick=async()=>{
            b.disabled=true;$('.message').textContent='';
            try{const r=await chrome.runtime.sendMessage({to:'bg',cmd,tabId:item.tabId});if(!r?.ok)throw new Error(r?.error||'요청을 처리하지 못했어요.');}
            catch(e){$('.message').textContent=e.message;}finally{b.disabled=false;}
          };actions.append(b);
        }
        row.append(actions);$('.list').append(row);
      }
    }
    place();
  }
  async function refresh(){
    if(stopped)return;
    try{const r=await chrome.runtime.sendMessage({to:'bg',cmd:'get-monitor'});if(r?.ok)update(r.result);}
    catch {stopped=true; clearInterval(poll); host.style.display='none'; place(); host.remove(); window.removeEventListener('resize',place); globalThis.catchSoundStatusLoaded=false;}
  }
  chrome.runtime.onMessage.addListener((m,_sender,respond)=>{if(m.to==='monitor'){update(m.snapshot);respond({monitorReady:true});}});
  chrome.storage.local.get(KEY).then(v=>{position=v[KEY]??null;place();}).catch(()=>{});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[KEY]&&!drag){position=changes[KEY].newValue??null;place();}});
  window.addEventListener('resize',place);
  const poll=setInterval(refresh,5000);void refresh();
}
