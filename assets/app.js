(function(){
  const $=(s,r=document)=>r.querySelector(s);
  function escapeHtml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");}
  function toast(msg,small){const el=$('#toast'); if(!el) return; el.innerHTML=small?`<div>${escapeHtml(msg)}</div><small>${escapeHtml(small)}</small>`:`<div>${escapeHtml(msg)}</div>`; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),3200);}
  function clamp01(x){x=Number(x);return Number.isFinite(x)?Math.max(0,Math.min(1,x)):0;}
  function extractJson(text){if(typeof text!=='string')return'';let t=text.replace(/^\uFEFF/,'').trim();t=t.replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/i,'').trim();const fo=t.indexOf('{'),fa=t.indexOf('[');let start=-1;if(fo!==-1&&fa!==-1)start=Math.min(fo,fa);else start=(fo!==-1?fo:fa);if(start>0)t=t.slice(start);const lo=t.lastIndexOf('}'),la=t.lastIndexOf(']');const end=Math.max(lo+1,la+1);if(end>0)t=t.slice(0,end).trim();return t;}
  function safeParseJson(raw){const cleaned=extractJson(raw);try{return{ok:true,value:JSON.parse(cleaned),cleaned};}catch(e){return{ok:false,error:String(e&&e.message?e.message:e),cleaned};}}
  async function fetchJson(url){const res=await fetch(url,{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);return await res.json();}

  function normalizeState(s){
    s.ui=s.ui||{showTranslationByDefault:true,showPhoneticByDefault:false,showWhyHeardByDefault:false};
    s.song=s.song||{}; s.song.media=s.song.media||{};
    if(!Array.isArray(s.items)) s.items=[];
    s.items.forEach((it,i)=>{if(!it.id) it.id=`${s.song.id||'line'}-${String(i+1).padStart(3,'0')}`; if(!('start'in it))it.start=null; if(!('end'in it))it.end=null; if(typeof it.learned!=='boolean')it.learned=false; if(typeof it.confidence!=='number')it.confidence=null;});
  }
  function mergeProgress(remote,local){
    const out=structuredClone(remote);
    if(local&&local.ui) out.ui=Object.assign({},out.ui||{},local.ui||{});
    const m=new Map((local.items||[]).map(x=>[x.id,x]));
    (out.items||[]).forEach(it=>{const l=m.get(it.id); if(!l) return; it.start=(l.start??it.start??null); it.end=(l.end??it.end??null); it.learned=(typeof l.learned==='boolean')?l.learned:(it.learned||false);});
    return out;
  }
  function applyHeader(state){
    const t=$('#songTitle'); if(t) t.textContent=state.song?.title||'—';
    const a=$('#songArtist'); if(a) a.textContent=state.song?.artist||'—';
    const l=$('#songLang'); if(l) l.textContent=state.song?.languageName||state.song?.language||'—';
    const h=$('#songHint'); if(h) h.textContent=state.song?.hint||'';
    const b=$('#btnLoadMedia'); if(b) b.textContent=`Загрузить медиа (${state.song?.media?.src||'файл'})`;
  }

  async function bootSongPage(){
    const root=document.documentElement;
    if(!root.dataset.songJson) return;
    const SONG_JSON_URL=root.dataset.songJson;
    const PREFIX='multisong_trainer_v1::';

    let state;
    try{
      const remote=await fetchJson(SONG_JSON_URL);
      const key=PREFIX+(remote.song?.id||SONG_JSON_URL);
      const localRaw=localStorage.getItem(key);
      const local=localRaw?JSON.parse(localRaw):null;
      state=local?mergeProgress(remote,local):remote;
      state._storageKey=key;
    }catch(e){toast('Не удалось загрузить данные песни',String(e));return;}
    normalizeState(state);
    applyHeader(state);

    const player=$('#player');
    const btnLoad=$('#btnLoadMedia');
    const mediaPick=$('#mediaPick');
    const elNow=$('#tNow');

    const btnPlaySeg=$('#btnPlaySeg');
    const btnStart=$('#btnStart');
    const btnEnd=$('#btnEnd');
    const btnClear=$('#btnClear');

    const loopToggle=$('#loopToggle');
    const autoNextToggle=$('#autoNextToggle');

    const jsonBox=$('#jsonBox');
    const btnExport=$('#btnExport');
    const btnImport=$('#btnImport');
    const btnReset=$('#btnReset');
    const filePick=$('#filePick');

    const globalShowTrans=$('#globalShowTrans');
    const globalShowPhon=$('#globalShowPhon');
    const globalShowWhy=$('#globalShowWhy');

    let activeIndex=0;
    let loopTimer=null;

    function save(){try{localStorage.setItem(state._storageKey,JSON.stringify(state));}catch{}}
    function setSrc(src){player.src=src; player.load();}

    btnLoad.addEventListener('click',()=>{
      const src=state.song?.media?.src;
      if(!src){toast('В JSON нет song.media.src');return;}
      setSrc(src);
      toast('Пробую загрузить медиа',src);
    });

    mediaPick.addEventListener('change',()=>{
      const f=mediaPick.files&&mediaPick.files[0]; if(!f) return;
      if(player._objUrl){try{URL.revokeObjectURL(player._objUrl);}catch{}}
      const url=URL.createObjectURL(f); player._objUrl=url;
      setSrc(url); toast('Открыт локальный файл',f.name);
    });

    player.addEventListener('timeupdate',()=>{elNow.textContent=(player.currentTime||0).toFixed(2);});
    player.addEventListener('loadedmetadata',()=>{btnStart.disabled=false; btnEnd.disabled=false; renderSegStatus();});
    player.addEventListener('error',()=>{const err=player.error?('код '+player.error.code):'неизвестно'; toast('Ошибка загрузки медиа',err+'. Проверь путь/имя.');});

    function renderSegStatus(){
      const it=state.items[activeIndex]; const s=it?.start, e=it?.end;
      $('#segStatus').innerHTML=
        `<span class="pill">Строка: <span class="mono">${activeIndex+1}/${state.items.length}</span></span>
         <span class="pill">Start: <span class="mono">${s==null?'—':Number(s).toFixed(2)}</span></span>
         <span class="pill">End: <span class="mono">${e==null?'—':Number(e).toFixed(2)}</span></span>
         <span class="pill">${it?.learned?'✓ выучено':'… в работе'}</span>`;
      const ready=(s!=null&&e!=null&&Number(e)>Number(s));
      btnPlaySeg.disabled=!ready;
      btnClear.disabled=!(s!=null||e!=null);
      btnStart.disabled=!(player&&player.readyState>=1);
      btnEnd.disabled=!(player&&player.readyState>=1);
    }

    function stopLoop(){if(loopTimer){clearInterval(loopTimer); loopTimer=null;}}
    function playSegment(){
      const it=state.items[activeIndex]; const s=it?.start, e=it?.end;
      if(!(s!=null&&e!=null&&Number(e)>Number(s))){toast('Нужны Start и End');return;}
      stopLoop(); player.currentTime=Number(s); player.play().catch(()=>{});
      loopTimer=setInterval(()=>{
        if(!player||player.paused) return;
        if(player.currentTime>=Number(e)-0.03){
          if(loopToggle.checked) player.currentTime=Number(s);
          else{
            stopLoop(); player.pause();
            if(autoNextToggle.checked){
              const next=Math.min(activeIndex+1,state.items.length-1);
              if(next!==activeIndex){
                setActive(next,true);
                const ni=state.items[next];
                if(ni?.start!=null&&ni?.end!=null&&Number(ni.end)>Number(ni.start)) setTimeout(()=>playSegment(),120);
              }
            }
          }
        }
      },30);
    }

    btnPlaySeg.addEventListener('click',playSegment);
    btnStart.addEventListener('click',()=>{const it=state.items[activeIndex]; it.start=Number(player.currentTime.toFixed(2)); if(it.end!=null&&Number(it.end)<=Number(it.start)) it.end=null; save(); renderLines();});
    btnEnd.addEventListener('click',()=>{const it=state.items[activeIndex]; it.end=Number(player.currentTime.toFixed(2)); if(it.start!=null&&Number(it.end)<=Number(it.start)){toast('End должен быть больше Start'); it.end=null;} save(); renderLines();});
    btnClear.addEventListener('click',()=>{const it=state.items[activeIndex]; it.start=null; it.end=null; save(); renderLines();});

    function mkBtn(text,cls,onClick){const b=document.createElement('button'); b.className=cls; b.textContent=text; b.addEventListener('click',(e)=>{e.stopPropagation(); onClick();}); return b;}

    function setActive(idx,seek){
      activeIndex=Math.max(0,Math.min(idx,state.items.length-1));
      renderLines();
      const it=state.items[activeIndex];
      if(seek&&it&&it.start!=null&&Number.isFinite(it.start)) player.currentTime=Math.max(0,Number(it.start));
    }

    function renderLines(){
      const showTrans=globalShowTrans.checked;
      const showPhon=globalShowPhon.checked;
      const showWhy=globalShowWhy.checked;
      state.ui.showTranslationByDefault=showTrans;
      state.ui.showPhoneticByDefault=showPhon;
      state.ui.showWhyHeardByDefault=showWhy;

      const host=$('#lines'); host.innerHTML='';
      state.items.forEach((it,idx)=>{
        const line=document.createElement('div');
        line.className='line'+(idx===activeIndex?' active':'');
        const top=document.createElement('div'); top.className='lineTop';

        const texts=document.createElement('div'); texts.className='lineTexts';
        const no=document.createElement('div'); no.className='noText'; no.textContent=it.text||it.text_no_official||'—';
        const ru=document.createElement('div'); ru.className='ruText'; ru.textContent=it.translation||it.translation_ru||'';
        ru.style.display=(showTrans&&ru.textContent)?'block':'none';
        texts.appendChild(no); texts.appendChild(ru);

        const actions=document.createElement('div'); actions.className='lineActions';
        actions.appendChild(mkBtn('Выбрать','tiny btn-primary',()=>setActive(idx,true)));
        actions.appendChild(mkBtn('▶','tiny',()=>{setActive(idx,false); playSegment();}));
        actions.appendChild(mkBtn('👂','tiny',()=>{line.querySelector('.sub-phon').classList.toggle('visible'); if(!showWhy) line.querySelector('.sub-why').classList.remove('visible');}));
        actions.appendChild(mkBtn('🧠','tiny',()=>{line.querySelector('.sub-why').classList.toggle('visible'); if(!showPhon) line.querySelector('.sub-phon').classList.remove('visible');}));
        actions.appendChild(mkBtn(it.learned?'✓ Выучено':'Выучено','tiny '+(it.learned?'btn-good':''),()=>{it.learned=!it.learned; save(); renderLines();}));

        top.appendChild(texts); top.appendChild(actions);

        const subPh=document.createElement('div'); subPh.className='sub sub-phon'+(showPhon?' visible':'');
        const ph=document.createElement('div'); ph.className='subCard';
        ph.innerHTML=`<b>👂 Как слышалось:</b> <span class="mono">${escapeHtml(it.phonetic||it.phonetic_user||'—')}</span>`;
        subPh.appendChild(ph);

        const subW=document.createElement('div'); subW.className='sub sub-why'+(showWhy?' visible':'');
        const wc=document.createElement('div'); wc.className='subCard';
        const conf=(typeof it.confidence==='number')?` <span class="pill">уверенность: ${(clamp01(it.confidence)*100).toFixed(0)}%</span>`:'';
        wc.innerHTML=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b>🧠 Почему так слышится:</b>${conf}</div><div style="margin-top:6px;">${escapeHtml(it.why||it.why_heard||'—')}</div>`;
        subW.appendChild(wc);

        line.appendChild(top); line.appendChild(subPh); line.appendChild(subW);
        line.addEventListener('click',()=>setActive(idx,true));
        host.appendChild(line);
      });
      renderSegStatus();
    }

    // JSON tools
    jsonBox.value=JSON.stringify(state,null,2);
    btnExport.addEventListener('click',async()=>{
      const out=JSON.stringify(state,null,2); jsonBox.value=out;
      try{await navigator.clipboard.writeText(out); toast('Экспортировано','JSON в буфере.');}
      catch{toast('Экспортировано','Скопируй из поля.');}
    });
    btnImport.addEventListener('click',()=>{
      const p=safeParseJson(jsonBox.value); if(!p.ok){toast('Не получилось разобрать JSON',p.error);return;}
      const key=state._storageKey; state=p.value; state._storageKey=key; normalizeState(state); save(); applyHeader(state); setActive(0,false); jsonBox.value=JSON.stringify(state,null,2); toast('Импорт применён');
    });
    filePick.addEventListener('change',async()=>{
      const f=filePick.files&&filePick.files[0]; if(!f) return;
      const txt=await f.text(); jsonBox.value=txt;
      const p=safeParseJson(txt); if(!p.ok){toast('JSON не распознан',p.error);return;}
      const key=state._storageKey; state=p.value; state._storageKey=key; normalizeState(state); save(); applyHeader(state); setActive(0,false); toast('JSON загружен',f.name);
    });
    btnReset.addEventListener('click',async()=>{
      try{const remote=await fetchJson(SONG_JSON_URL); const key=state._storageKey; state=remote; state._storageKey=key; normalizeState(state); save(); applyHeader(state); setActive(0,false); toast('Сброшено к шаблону');}
      catch(e){toast('Не удалось сбросить',String(e));}
    });

    globalShowTrans.checked=!!state.ui.showTranslationByDefault;
    globalShowPhon.checked=!!state.ui.showPhoneticByDefault;
    globalShowWhy.checked=!!state.ui.showWhyHeardByDefault;
    globalShowTrans.addEventListener('change',renderLines);
    globalShowPhon.addEventListener('change',renderLines);
    globalShowWhy.addEventListener('change',renderLines);

    renderLines(); setActive(0,false);
  }

  async function bootHome(){
    const root=document.documentElement;
    if(!root.dataset.catalog) return;
    const list=$('#songsList');
    const langSel=$('#langFilter');
    const search=$('#q');
    let catalog;
    try{catalog=await fetchJson(root.dataset.catalog);}catch(e){toast('Не удалось загрузить каталог',String(e));return;}
    const songs=catalog.songs||[];
    const langs=catalog.languages||[];
    langSel.innerHTML=`<option value="">Все языки</option>`+langs.map(l=>`<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)}</option>`).join('');
    function render(){
      const q=(search.value||'').trim().toLowerCase();
      const lang=langSel.value||'';
      const filtered=songs.filter(s=>{
        const okLang=!lang||s.language===lang;
        const hay=`${s.title} ${s.artist} ${s.languageName||''}`.toLowerCase();
        const okQ=!q||hay.includes(q);
        return okLang&&okQ;
      });
      $('#count').textContent=String(filtered.length);
      list.innerHTML='';
      filtered.forEach(s=>{
        const a=document.createElement('a');
        a.className='songCard'; a.href=s.url;
        a.innerHTML=`<div class="songTitle">${escapeHtml(s.title)}</div>
          <div class="songMeta"><span class="pill">👤 ${escapeHtml(s.artist||'—')}</span><span class="pill">🌍 ${escapeHtml(s.languageName||s.language||'—')}</span></div>
          <div class="songSmall">${escapeHtml(s.short||'')}</div>`;
        list.appendChild(a);
      });
    }
    langSel.addEventListener('change',render);
    search.addEventListener('input',render);
    render();
  }

  window.addEventListener('DOMContentLoaded',()=>{bootSongPage();bootHome();});
})();