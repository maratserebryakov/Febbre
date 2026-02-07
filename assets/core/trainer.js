(function(){
  'use strict';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  function escapeHtml(str){
    return String(str ?? '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'","&#39;");
  }
  function setStatus(t){ const el=$('#appStatus'); if(el) el.textContent=t; }
  function toast(msg,small){
    const box=$('#toast');
    if(!box) return;
    box.innerHTML = small ? `<div>${escapeHtml(msg)}</div><small>${escapeHtml(small)}</small>` : `<div>${escapeHtml(msg)}</div>`;
    box.classList.add('show');
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>box.classList.remove('show'), 4200);
  }
  function sanitizeJsonText(text){
    let t=String(text ?? '').replace(/^\uFEFF/,'').trim();
    if(t.startsWith('```')) t=t.replace(/^```[a-zA-Z0-9_-]*\s*/,'').replace(/```$/,'').trim();
    const fo=t.indexOf('{'), fa=t.indexOf('[');
    let start=-1;
    if(fo===-1) start=fa;
    else if(fa===-1) start=fo;
    else start=Math.min(fo,fa);
    if(start>0) t=t.slice(start).trim();
    const lo=t.lastIndexOf('}'), la=t.lastIndexOf(']');
    const end=Math.max(lo,la);
    if(end!==-1 && end < t.length-1) t=t.slice(0,end+1).trim();
    return t;
  }
  async function readFileText(file){
    return new Promise((resolve,reject)=>{
      const fr=new FileReader();
      fr.onerror=()=>reject(new Error('Не удалось прочитать файл.'));
      fr.onload=()=>resolve(String(fr.result||''));
      fr.readAsText(file,'utf-8');
    });
  }

  const SongTrainer = {
    async init(cfg){
      try{document.documentElement.classList.add('js');}catch{}
      window.__SONG_CFG__ = cfg;

      const titleEl = $('#pageTitle');
      const hintEl  = $('#pageHint');
      const fileLabel = $('#fileLabel');
      const srcLabel = $('#srcLabel');
      const nowEl = $('#now');
      const vid = $('#player');
      const defaultSource = $('#defaultSrc');

      if(titleEl) titleEl.textContent = cfg.pageTitle || 'Тренажёр';
      if(hintEl) hintEl.innerHTML = cfg.pageHintHtml || '';
      if(fileLabel) fileLabel.textContent = cfg.defaultMedia || '';
      if(defaultSource && cfg.defaultMedia) defaultSource.setAttribute('src', cfg.defaultMedia);

      const mediaPick = $('#mediaPick');
      const useDefault = $('#useDefault');
      const stopBtn = $('#stop');
      const copyNowBtn = $('#copyNow');

      function setSourceUi(kind){
        if(srcLabel){
          srcLabel.textContent = (kind==='local') ? 'локальный (выбранный файл)' : 'сервер (интернет)';
        }
      }
      setSourceUi('server');

      let uiTimer = null, segTimer=null;
      function startTicker(){
        if(uiTimer) clearInterval(uiTimer);
        uiTimer=setInterval(()=>{ if(nowEl && vid) nowEl.textContent = ((vid.currentTime||0)).toFixed(2); }, 120);
      }
      startTicker();

      function stopSegmentPlayback(){
        if(segTimer) clearInterval(segTimer);
        segTimer=null;
      }
      function playSegment(start,end){
        const s=Number(start), e=Number(end);
        if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s){
          toast('Проверь таймкоды', 'Start должен быть меньше End (и оба числа).');
          return;
        }
        stopSegmentPlayback();
        vid.currentTime = Math.max(0,s);
        const p=vid.play();
        if(p && typeof p.catch==='function') p.catch(()=>{});
        segTimer=setInterval(()=>{
          if((vid.currentTime||0) >= e-0.03){
            vid.pause();
            stopSegmentPlayback();
          }
        }, 40);
      }

      if(stopBtn) stopBtn.addEventListener('click', ()=>{ vid.pause(); stopSegmentPlayback(); });
      if(copyNowBtn) copyNowBtn.addEventListener('click', async ()=>{
        const t=((vid.currentTime||0)).toFixed(2);
        try{ await navigator.clipboard.writeText(t); toast('Скопировано', t+'s'); }
        catch{ toast('Скопируй вручную', t+'s'); }
      });

      // Storage key depends on selected media filename too (so local mp4/mp3 can be separate if you want)
      let stateKey = makeStorageKey(cfg.songId, cfg.defaultMedia || 'media');

      if(mediaPick){
        mediaPick.addEventListener('change', ()=>{
          const f=mediaPick.files && mediaPick.files[0];
          if(!f) return;
          if(fileLabel) fileLabel.textContent=f.name;
          const url=URL.createObjectURL(f);
          vid.src=url;
          vid.load();
          setSourceUi('local');
          stateKey = makeStorageKey(cfg.songId, f.name);
          loadLocalProgress();
          renderRows();
        });
      }
      if(useDefault){
        useDefault.addEventListener('click', async ()=>{
          if(cfg.defaultMedia){
            if(fileLabel) fileLabel.textContent=cfg.defaultMedia;
            vid.src=cfg.defaultMedia;
            vid.load();
            setSourceUi('server');
            stateKey = makeStorageKey(cfg.songId, cfg.defaultMedia);
            await syncFromRemoteIfAvailable(true);
            loadLocalProgress();
            renderRows();
          }
        });
      }

      // Dock only video on portrait mobile
      const videoDock = $('#videoDock');
      const videoDockSentinel = $('#videoDockSentinel');
      function isPortraitMobile(){ return matchMedia('(max-width: 980px) and (orientation: portrait)').matches; }
      function undock(){ if(!videoDock||!videoDockSentinel) return; videoDock.classList.remove('isDocked'); videoDockSentinel.style.height='0px'; }
      function dock(){
        if(!videoDock||!videoDockSentinel) return;
        if(videoDock.classList.contains('isDocked')) return;
        const h=videoDock.getBoundingClientRect().height;
        videoDockSentinel.style.height = `${Math.ceil(h)}px`;
        videoDock.classList.add('isDocked');
      }
      function updateDock(){
        if(!videoDock||!videoDockSentinel) return;
        if(!isPortraitMobile()){ undock(); return; }
        const r=videoDockSentinel.getBoundingClientRect();
        if(r.top<=0) dock(); else undock();
      }
      addEventListener('scroll', updateDock, {passive:true});
      addEventListener('resize', ()=>{ 
        if(videoDock && videoDock.classList.contains('isDocked')){
          const h=videoDock.getBoundingClientRect().height;
          if(videoDockSentinel) videoDockSentinel.style.height=`${Math.ceil(h)}px`;
        }
        updateDock();
      }, {passive:true});

      // Data/state
      let remote = null;
      let items = [];
      let local = { items: [] };
      const rowsHost = $('#rows');

      function makeStorageKey(songId, mediaName){
        return `trainer_v2::${songId}::${mediaName}`;
      }

      function normalizeItems(){
        for(let i=0;i<items.length;i++){
          const it=items[i];
          it.id = it.id || `${cfg.songId}-${String(i+1).padStart(3,'0')}`;
          if(typeof it.learned!=='boolean') it.learned=false;
          it.start = (Number.isFinite(Number(it.start)) ? Number(it.start) : null);
          it.end   = (Number.isFinite(Number(it.end)) ? Number(it.end) : null);
          if(typeof it.phonetic_user!=='string') it.phonetic_user = it.phonetic_user ?? '';
        }
      }

      function loadLocalProgress(){
        try{
          const raw = localStorage.getItem(stateKey);
          local = raw ? JSON.parse(raw) : { items: [] };
        }catch{ local = { items: [] }; }
        if(!Array.isArray(local.items)) local.items=[];
        const byId = new Map(local.items.map(x=>[x.id,x]));
        items.forEach((it,idx)=>{
          const li = (it.id && byId.has(it.id)) ? byId.get(it.id) : local.items[idx];
          if(!li) return;
          if('start' in li) it.start = li.start;
          if('end' in li) it.end = li.end;
          if('learned' in li) it.learned = !!li.learned;
          if('phonetic_user' in li) it.phonetic_user = li.phonetic_user ?? '';
        });
        normalizeItems();
      }

      function saveLocalProgress(){
        const snapshot = {
          songId: cfg.songId,
          media: fileLabel ? fileLabel.textContent : (cfg.defaultMedia||''),
          items: items.map(it=>({
            id: it.id,
            start: it.start,
            end: it.end,
            learned: !!it.learned,
            phonetic_user: it.phonetic_user ?? ''
          }))
        };
        try{ localStorage.setItem(stateKey, JSON.stringify(snapshot)); }catch{}
      }

      function hasNonZeroTimings(remoteObj){
        if(!remoteObj || !Array.isArray(remoteObj.items)) return false;
        return remoteObj.items.some(it => Number(it.start) > 0 || Number(it.end) > 0);
      }

      async function syncFromRemoteIfAvailable(force=false){
        if(!cfg.dataUrl) return false;
        try{
          setStatus('Статус: загружаю данные…');
          const url = new URL(cfg.dataUrl, location.href);
          url.searchParams.set('cb', String(Date.now()));
          const res = await fetch(url.toString(), {cache:'no-store'});
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const obj = await res.json();
          if(!obj || !Array.isArray(obj.items)) throw new Error('В JSON нет массива items.');
          remote = obj;

          const takeTimings = force || hasNonZeroTimings(obj);

          if(takeTimings || items.length===0){
            items = obj.items.map((it,idx)=>({
              id: it.id || `${cfg.songId}-${String(idx+1).padStart(3,'0')}`,
              text_no_official: it.text_no_official ?? it.text ?? '',
              translation_ru: it.translation_ru ?? it.translation ?? '',
              start: it.start ?? null,
              end: it.end ?? null,
              learned: !!it.learned,
              phonetic_user: it.phonetic_user ?? '',
              why_heard: it.why_heard ?? it.why ?? '',
              confidence: (typeof it.confidence==='number') ? it.confidence : null,
            }));
          }else{
            // update only texts
            obj.items.forEach((b,i)=>{
              if(!items[i]) items[i]={};
              items[i].id = items[i].id || b.id || `${cfg.songId}-${String(i+1).padStart(3,'0')}`;
              items[i].text_no_official = b.text_no_official ?? b.text ?? items[i].text_no_official ?? '';
              items[i].translation_ru = b.translation_ru ?? b.translation ?? items[i].translation_ru ?? '';
            });
          }

          normalizeItems();
          setStatus(`Статус: данные загружены • строк: ${items.length}`);
          return true;
        }catch(e){
          console.warn('[Trainer] remote sync failed', e);
          setStatus('Статус: без JSON');
          toast('Не удалось загрузить данные песни', 'Страница всё равно работает. Можно продолжать и потом импортировать JSON.');
          return false;
        }
      }

      function fmt(v){ if(v===null||v===undefined||v==='') return ''; const n=Number(v); return Number.isFinite(n)?n.toFixed(2):''; }

      let showRuAll = false;
      let showLearned = true;
      const toggleRuAllBtn = $('#toggleRuAll');
      const toggleLearnedBtn = $('#toggleLearned');
      const saveAllBtn = $('#saveAll');
      const resetTimesBtn = $('#resetTimes');

      if(toggleRuAllBtn) toggleRuAllBtn.addEventListener('click', ()=>{
        showRuAll = !showRuAll;
        $$('.ruText').forEach(el => el.style.display = showRuAll ? 'block':'none');
      });
      if(toggleLearnedBtn) toggleLearnedBtn.addEventListener('click', ()=>{
        showLearned = !showLearned;
        toggleLearnedBtn.textContent = showLearned ? 'Показать/скрыть выученные' : 'Показывать выученные: НЕТ';
        renderRows();
      });
      if(saveAllBtn) saveAllBtn.addEventListener('click', ()=>{
        saveLocalProgress();
        toast('Сохранено ✅');
      });
      if(resetTimesBtn) resetTimesBtn.addEventListener('click', ()=>{
        if(!confirm('Сбросить start/end для всех строк?')) return;
        items = items.map(it => ({...it, start:null, end:null}));
        saveLocalProgress();
        renderRows();
      });

      // Export/import
      const exportBox = $('#exportBox');
      const importBox = $('#importBox');
      const exportBtn = $('#exportBtn');
      const copyExport = $('#copyExport');
      const importBtn = $('#importBtn');
      const jsonPick = $('#jsonPick');

      function exportPayload(){
        return {
          version: 2,
          song: {
            id: cfg.songId,
            title: cfg.songTitle || '',
            artist: cfg.artist || '',
            language: cfg.language || '',
            languageName: cfg.languageName || '',
            media: { src: cfg.defaultMedia || '' }
          },
          items: items.map(it=>({
            id: it.id,
            text_no_official: it.text_no_official,
            translation_ru: it.translation_ru,
            start: it.start,
            end: it.end,
            learned: !!it.learned,
            phonetic_user: it.phonetic_user ?? '',
            why_heard: it.why_heard ?? '',
            confidence: it.confidence
          }))
        };
      }

      if(exportBtn) exportBtn.addEventListener('click', ()=>{
        if(!exportBox) return;
        exportBox.value = JSON.stringify(exportPayload(), null, 2);
        toast('Экспортировано', 'JSON появился в поле ниже.');
      });

      if(copyExport) copyExport.addEventListener('click', async ()=>{
        if(!exportBox || !exportBox.value.trim()){ toast('Сначала нажми «Экспорт»'); return; }
        try{ await navigator.clipboard.writeText(exportBox.value); toast('JSON скопирован ✅'); }
        catch{ toast('Не удалось скопировать', 'Скопируй вручную из поля.'); }
      });

      async function handleImportObject(obj){
        if(!obj) throw new Error('Пустой JSON.');
        const incoming = Array.isArray(obj) ? obj : obj.items || obj.segments;
        if(!Array.isArray(incoming)) throw new Error('В JSON нет массива items (или JSON не массив).');
        const byId = new Map(items.map(x=>[x.id,x]));
        incoming.forEach((x,idx)=>{
          const id = x.id || items[idx]?.id;
          const target = (id && byId.has(id)) ? byId.get(id) : items[idx];
          if(!target) return;
          if('start' in x) target.start = x.start;
          if('end' in x) target.end = x.end;
          if('learned' in x) target.learned = !!x.learned;
          if('phonetic_user' in x) target.phonetic_user = x.phonetic_user ?? '';
          if('text_no_official' in x) target.text_no_official = x.text_no_official ?? target.text_no_official;
          if('translation_ru' in x) target.translation_ru = x.translation_ru ?? target.translation_ru;
        });
        normalizeItems();
        saveLocalProgress();
        renderRows();
      }

      if(importBtn) importBtn.addEventListener('click', ()=>{
        const raw = sanitizeJsonText(importBox ? importBox.value : '');
        let obj;
        try{ obj = JSON.parse(raw); }
        catch(e){ toast('Не получилось разобрать JSON', 'Проверь, что вставлен чистый JSON (без лишнего текста).'); return; }
        handleImportObject(obj).then(()=>toast('Импортировано ✅')).catch(err=>toast('Ошибка импорта', String(err.message||err)));
      });

      if(jsonPick){
        jsonPick.addEventListener('change', async ()=>{
          const f=jsonPick.files && jsonPick.files[0];
          if(!f) return;
          try{
            const txt = await readFileText(f);
            if(importBox) importBox.value = txt;
            toast('JSON загружен в поле импорта', 'Теперь нажми «Импорт».');
          }catch(e){
            toast('Не удалось прочитать JSON', String(e.message||e));
          }finally{
            jsonPick.value='';
          }
        });
      }

      function renderRows(){
        if(!rowsHost) return;
        rowsHost.innerHTML='';
        items.forEach((it, idx)=>{
          if(!showLearned && it.learned) return;

          const row = document.createElement('div');
          row.className='row'+(it.learned?' muted':'');
          row.innerHTML = `
            <div class="noText">${escapeHtml(it.text_no_official || '')}</div>
            <div class="ruText">${escapeHtml(it.translation_ru || '')}</div>

            <div class="controls">
              <button class="warn" data-act="play">▶️ Фрагмент</button>
              <button class="ghost" data-act="toggleRu">Перевод</button>

              <span class="mini">start</span>
              <input type="number" step="0.01" inputmode="decimal" data-field="start" value="${fmt(it.start)}">
              <button class="ghost" data-act="setStart">⏱ start=текущее</button>

              <span class="mini">end</span>
              <input type="number" step="0.01" inputmode="decimal" data-field="end" value="${fmt(it.end)}">
              <button class="ghost" data-act="setEnd">⏱ end=текущее</button>

              <button class="good" data-act="learned">${it.learned ? 'Вернуть в повтор' : 'Выучено'}</button>
            </div>

            <div class="controls">
              <span class="mini">👂 Как слышал:</span>
              <input type="text" data-field="heard" placeholder="впиши как слышалось…" value="${escapeHtml(it.phonetic_user || '')}" style="flex:1;min-width:220px;">
            </div>
          `;

          const ruEl = row.querySelector('.ruText');
          const startInput = row.querySelector('input[data-field="start"]');
          const endInput = row.querySelector('input[data-field="end"]');
          const heardInput = row.querySelector('input[data-field="heard"]');

          row.querySelector('[data-act="toggleRu"]').addEventListener('click', ()=>{
            ruEl.style.display = (ruEl.style.display==='block') ? 'none':'block';
          });

          row.querySelector('[data-act="setStart"]').addEventListener('click', ()=>{
            const t=vid.currentTime||0;
            startInput.value = t.toFixed(2);
            it.start = Number(startInput.value);
            saveLocalProgress();
          });

          row.querySelector('[data-act="setEnd"]').addEventListener('click', ()=>{
            const t=vid.currentTime||0;
            endInput.value = t.toFixed(2);
            it.end = Number(endInput.value);
            saveLocalProgress();
          });

          row.querySelector('[data-act="play"]').addEventListener('click', ()=>{
            const s=Number(startInput.value), e=Number(endInput.value);
            it.start = Number.isFinite(s) ? s : null;
            it.end = Number.isFinite(e) ? e : null;
            saveLocalProgress();
            playSegment(it.start, it.end);
          });

          row.querySelector('[data-act="learned"]').addEventListener('click', ()=>{
            it.learned = !it.learned;
            saveLocalProgress();
            renderRows();
          });

          startInput.addEventListener('change', ()=>{
            const v=Number(startInput.value);
            it.start = Number.isFinite(v) ? v : null;
            saveLocalProgress();
          });
          endInput.addEventListener('change', ()=>{
            const v=Number(endInput.value);
            it.end = Number.isFinite(v) ? v : null;
            saveLocalProgress();
          });
          heardInput.addEventListener('input', ()=>{
            it.phonetic_user = heardInput.value;
            saveLocalProgress();
          });

          rowsHost.appendChild(row);
        });

        if(showRuAll){
          $$('.ruText').forEach(el=>el.style.display='block');
        }
      }

      async function boot(){
        setStatus('Статус: запускаюсь…');
        const ok = await syncFromRemoteIfAvailable(false);

        if(!ok){
          items = (cfg.lines || []).map((l,idx)=>({
            id: `${cfg.songId}-${String(idx+1).padStart(3,'0')}`,
            text_no_official: l.text_no_official ?? l.it ?? '',
            translation_ru: l.translation_ru ?? l.ru ?? '',
            start: null, end: null, learned:false, phonetic_user:''
          }));
        }
        loadLocalProgress();
        renderRows();
        updateDock();
        setStatus(`Статус: готово • строк: ${items.length}`);
      }

      await boot();
    }
  };

  window.SongTrainer = SongTrainer;

  window.addEventListener('DOMContentLoaded', ()=>{
    const cfg = window.SONG_CONFIG;
    if(!cfg) return;
    SongTrainer.init(cfg).catch(e=>{
      console.error(e);
      toast('Не удалось запустить страницу', 'Если видишь это постоянно — попробуй отключить фильтрацию/Private DNS для сайта.');
    });
  });
})();