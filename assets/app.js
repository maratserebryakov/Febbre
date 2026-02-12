;(function () {
  /* ── helpers ── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function esc(s) {
    return String(s)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function toast(msg, small) {
    const el = $("#toast");
    if (!el) return;
    el.innerHTML = small
      ? `<div>${esc(msg)}</div><small>${esc(small)}</small>`
      : `<div>${esc(msg)}</div>`;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function clamp01(x) {
    x = Number(x);
    return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
  }

  function safeParseJson(raw) {
    let t = String(raw).replace(/^\uFEFF/, "").trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const fo = t.indexOf("{"), fa = t.indexOf("[");
    let start = -1;
    if (fo !== -1 && fa !== -1) start = Math.min(fo, fa);
    else start = fo !== -1 ? fo : fa;
    if (start > 0) t = t.slice(start);
    const lo = t.lastIndexOf("}"), la = t.lastIndexOf("]");
    const end = Math.max(lo + 1, la + 1);
    if (end > 0) t = t.slice(0, end).trim();
    try { return { ok: true, value: JSON.parse(t) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  /* ── storage consent ── */
  function showStorageConsent() {
    const KEY = "lyricear_storage_ok";
    if (localStorage.getItem(KEY)) return;
    const bar = document.createElement("div");
    bar.id = "storageBanner";
    bar.innerHTML =
      `<span>Этот сайт сохраняет ваш прогресс в браузере (localStorage). Никакие данные не передаются на сервер.</span>
       <button id="storageOk">Понятно</button>`;
    document.body.appendChild(bar);
    $("#storageOk").addEventListener("click", () => {
      localStorage.setItem(KEY, "1");
      bar.remove();
    });
  }

  /* ── state helpers ── */
  function normalizeState(s) {
    s.ui = Object.assign(
      { showTranslationByDefault: false, showPhoneticByDefault: false,
        showWhyHeardByDefault: false, showOriginalByDefault: false },
      s.ui || {}
    );
    s.song = s.song || {};
    s.song.media = s.song.media || {};
    if (!Array.isArray(s.items)) s.items = [];
    s.items.forEach((it, i) => {
      if (!it.id) it.id = `${s.song.id || "line"}-${String(i + 1).padStart(3, "0")}`;
      if (!("start" in it)) it.start = null;
      if (!("end" in it)) it.end = null;
      if (typeof it.learned !== "boolean") it.learned = false;
      if (typeof it.confidence !== "number") it.confidence = null;
      if (typeof it.phonetic_user !== "string") it.phonetic_user = "";
    });
  }

  function mergeProgress(remote, local) {
    const out = structuredClone(remote);
    if (local?.ui) out.ui = Object.assign({}, out.ui || {}, local.ui);
    const m = new Map((local.items || []).map(x => [x.id, x]));
    (out.items || []).forEach(it => {
      const l = m.get(it.id);
      if (!l) return;
      it.start = l.start ?? it.start ?? null;
      it.end = l.end ?? it.end ?? null;
      it.learned = typeof l.learned === "boolean" ? l.learned : it.learned;
      if (l.phonetic_user) it.phonetic_user = l.phonetic_user;
    });
    return out;
  }

  /* ══════════════════════════════════════
     SONG PAGE
     ══════════════════════════════════════ */
  async function bootSongPage() {
    const root = document.documentElement;
    if (!root.dataset.songJson) return;

    const SONG_JSON_URL = root.dataset.songJson;
    const PREFIX = "lyricear_v1::";

    let state;
    try {
      const remote = await fetchJson(SONG_JSON_URL);
      const key = PREFIX + (remote.song?.id || SONG_JSON_URL);
      const localRaw = localStorage.getItem(key);
      const local = localRaw ? JSON.parse(localRaw) : null;
      state = local ? mergeProgress(remote, local) : remote;
      state._storageKey = key;
    } catch (e) {
      toast("Не удалось загрузить данные песни", String(e));
      return;
    }
    normalizeState(state);

    /* ── DOM refs ── */
    const player         = $("#player");
    const mediaPick      = $("#mediaPick");
    const btnLoadLocal   = $("#btnLoadLocal");
    const btnLoadYaDisk  = $("#btnLoadYaDisk");
    const lamp           = $("#mediaLamp");
    const elNow          = $("#tNow");
    const btnPlaySeg     = $("#btnPlaySeg");
    const btnStart       = $("#btnStart");
    const btnEnd         = $("#btnEnd");
    const btnClear       = $("#btnClear");
    const loopToggle     = $("#loopToggle");
    const autoNextToggle = $("#autoNextToggle");
    const jsonBox        = $("#jsonBox");
    const btnExport      = $("#btnExport");
    const btnImport      = $("#btnImport");
    const btnReset       = $("#btnReset");
    const filePick       = $("#filePick");
    const globalShowOrig  = $("#globalShowOrig");
    const globalShowTrans = $("#globalShowTrans");
    const globalShowPhon  = $("#globalShowPhon");
    const globalShowWhy   = $("#globalShowWhy");
    const linesHost      = $("#lines");

    let activeIndex = 0;
    let loopTimer = null;

    /* ── header ── */
    function applyHeader() {
      const t = $("#songTitle");  if (t) t.textContent = state.song?.title || "—";
      const a = $("#songArtist"); if (a) a.textContent = state.song?.artist || "—";
      const l = $("#songLang");   if (l) l.textContent = state.song?.languageName || state.song?.language || "—";
      const h = $("#songHint");   if (h) h.textContent = state.song?.hint || "";
    }
    applyHeader();

    /* ── lamp ── */
    function setLamp(source) {
      if (!lamp) return;
      lamp.className = "lamp";
      if (source === "local")       { lamp.classList.add("lamp-green"); lamp.title = "Локальный файл"; }
      else if (source === "remote") { lamp.classList.add("lamp-red");   lamp.title = "Файл из интернета"; }
      else                          { lamp.classList.add("lamp-off");   lamp.title = "Медиа не загружено"; }
    }
    setLamp("none");

    function setSrc(src, source) {
      player.src = src;
      player.load();
      setLamp(source);
    }

    /* ── save ── */
    let saveTimer = null;
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem(state._storageKey, JSON.stringify(state)); } catch {}
      }, 300);
    }

    /* ── media type detection ── */
    const AUDIO_EXT = /\.(mp3|m4a|ogg|wav|flac|aac|wma|opus|webm)$/i;
    const VIDEO_EXT = /\.(mp4|mkv|webm|avi|mov|m4v|ogv)$/i;

    function detectMediaType(filename, mimeType) {
      if (mimeType) {
        if (mimeType.startsWith("video/")) return "video";
        if (mimeType.startsWith("audio/")) return "audio";
      }
      if (VIDEO_EXT.test(filename)) return "video";
      if (AUDIO_EXT.test(filename)) return "audio";
      return "video";
    }

    function applyPlayerMode(mode) {
      if (mode === "video") {
        player.classList.remove("is-audio");
        player.classList.add("is-video");
        player.removeAttribute("poster");
      } else {
        player.classList.remove("is-video");
        player.classList.add("is-audio");
      }
    }

    applyPlayerMode("audio");

    /* ── FIX pulse: убирать пульс только при реальной загрузке медиа ── */
    function stopPulse() {
      if (btnLoadLocal) btnLoadLocal.classList.remove("pulse");
    }
    function startPulse() {
      if (btnLoadLocal) btnLoadLocal.classList.add("pulse");
    }

    /* ── local file ── */
    if (btnLoadLocal) btnLoadLocal.addEventListener("click", () => mediaPick.click());
    mediaPick.addEventListener("change", () => {
      const f = mediaPick.files?.[0];
      if (!f) return;
      if (player._objUrl) { try { URL.revokeObjectURL(player._objUrl); } catch {} }
      const url = URL.createObjectURL(f);
      player._objUrl = url;
      const mode = detectMediaType(f.name, f.type);
      applyPlayerMode(mode);
      setSrc(url, "local");
      toast(mode === "video" ? "🎬 Открыто видео" : "🎵 Открыто аудио", f.name);
      /* FIX pulse: НЕ снимаем тут — ждём loadeddata */
    });

    /* FIX pulse: снимаем пульс только когда медиа реально загрузилось */
    player.addEventListener("loadeddata", () => {
      stopPulse();
      if (player.videoHeight > 0) applyPlayerMode("video");
    });

    /* ── Yandex.Disk ── */
    if (btnLoadYaDisk) {
      const yadiskUrl = state.song?.media?.yadisk;
      if (!yadiskUrl) {
        btnLoadYaDisk.style.display = "none";
      } else {
        btnLoadYaDisk.addEventListener("click", () => {
          window.open(yadiskUrl, "yadisk", "width=700,height=500,left=100,top=100");
          /* FIX pulse: начинаем мигать */
          startPulse();
          toast("📥 Скачайте файл с Яндекс.Диска", "Затем нажмите мигающую кнопку «📁 Выбрать файл»");
        });
      }
    }

    /* ── player events ── */
    player.addEventListener("timeupdate", () => {
      elNow.textContent = (player.currentTime || 0).toFixed(2);
    });
    player.addEventListener("loadedmetadata", () => {
      btnStart.disabled = false;
      btnEnd.disabled = false;
      renderSegStatus();
    });
    player.addEventListener("error", () => {
      const err = player.error ? "код " + player.error.code : "неизвестно";
      toast("Ошибка загрузки медиа", err);
      setLamp("none");
    });

    /* ── segment controls ── */
    function renderSegStatus() {
      const it = state.items[activeIndex];
      const s = it?.start, e = it?.end;
      $("#segStatus").innerHTML =
        `<span class="pill">Строка: <span class="mono">${activeIndex + 1}/${state.items.length}</span></span>
         <span class="pill">Start: <span class="mono">${s == null ? "—" : Number(s).toFixed(2)}</span></span>
         <span class="pill">End: <span class="mono">${e == null ? "—" : Number(e).toFixed(2)}</span></span>
         <span class="pill">${it?.learned ? "✓ выучено" : "… в работе"}</span>`;
      const ready = s != null && e != null && Number(e) > Number(s);
      btnPlaySeg.disabled = !ready;
      btnClear.disabled = !(s != null || e != null);
      btnStart.disabled = !(player?.readyState >= 1);
      btnEnd.disabled = !(player?.readyState >= 1);
    }

    function stopLoop() {
      if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    }

    function playSegment() {
      const it = state.items[activeIndex];
      const s = it?.start, e = it?.end;
      if (!(s != null && e != null && Number(e) > Number(s))) {
        toast("Нужны Start и End"); return;
      }
      stopLoop();
      player.currentTime = Number(s);
      player.play().catch(() => {});
      loopTimer = setInterval(() => {
        if (!player || player.paused) return;
        if (player.currentTime >= Number(e) - 0.03) {
          if (loopToggle.checked) {
            player.currentTime = Number(s);
          } else {
            stopLoop();
            player.pause();
            if (autoNextToggle.checked) {
              const next = Math.min(activeIndex + 1, state.items.length - 1);
              if (next !== activeIndex) {
                setActive(next, true);
                const ni = state.items[next];
                if (ni?.start != null && ni?.end != null && Number(ni.end) > Number(ni.start))
                  setTimeout(() => playSegment(), 120);
              }
            }
          }
        }
      }, 30);
    }

    btnPlaySeg.addEventListener("click", playSegment);

    btnStart.addEventListener("click", () => {
      const it = state.items[activeIndex];
      it.start = Number(player.currentTime.toFixed(2));
      if (it.end != null && Number(it.end) <= Number(it.start)) it.end = null;
      save(); renderLines();
    });

    btnEnd.addEventListener("click", () => {
      const it = state.items[activeIndex];
      it.end = Number(player.currentTime.toFixed(2));
      if (it.start != null && Number(it.end) <= Number(it.start)) {
        toast("End должен быть больше Start"); it.end = null;
      }
      save(); renderLines();
    });

    btnClear.addEventListener("click", () => {
      const it = state.items[activeIndex];
      it.start = null; it.end = null;
      save(); renderLines();
    });

    /* ── active line ── */
    function setActive(idx, seek) {
      activeIndex = Math.max(0, Math.min(idx, state.items.length - 1));
      renderLines();
      const it = state.items[activeIndex];
      if (seek && it?.start != null && Number.isFinite(it.start))
        player.currentTime = Math.max(0, Number(it.start));
    }

    /* ── render lines ── */
    function renderLines() {
      const showOrig  = globalShowOrig?.checked  || false;
      const showTrans = globalShowTrans?.checked || false;
      const showPhon  = globalShowPhon?.checked  || false;
      const showWhy   = globalShowWhy?.checked   || false;

      state.ui.showOriginalByDefault    = showOrig;
      state.ui.showTranslationByDefault = showTrans;
      state.ui.showPhoneticByDefault    = showPhon;
      state.ui.showWhyHeardByDefault    = showWhy;

      linesHost.innerHTML = "";

      state.items.forEach((it, idx) => {
        const isActive = idx === activeIndex;
        const hasTime = it.start != null && it.end != null && Number(it.end) > Number(it.start);

        const line = document.createElement("div");
        line.className = "line" + (isActive ? " active" : "") + (it.learned ? " learned" : "");
        line.dataset.idx = idx;

        const header = document.createElement("div");
        header.className = "line-header";

        const num = document.createElement("span");
        num.className = "line-num";
        num.textContent = String(idx + 1);

        const userInput = document.createElement("input");
        userInput.type = "text";
        userInput.className = "user-heard";
        userInput.placeholder = "Как услышал(а)…";
        userInput.value = it.phonetic_user || "";
        userInput.addEventListener("input", () => { it.phonetic_user = userInput.value; save(); });
        userInput.addEventListener("click", e => e.stopPropagation());
        userInput.addEventListener("focus", e => e.stopPropagation());

        header.appendChild(num);
        header.appendChild(userInput);

        const origRow = document.createElement("div");
        origRow.className = "orig-row";
        let origRevealed = showOrig;

        const origText = document.createElement("span");
        origText.className = "orig-text";
        origText.textContent = it.text || "—";
        origText.style.display = origRevealed ? "inline" : "none";

        const btnReveal = document.createElement("button");
        btnReveal.className = "tiny btn-reveal";
        btnReveal.textContent = origRevealed ? "👁 Скрыть" : "👁 Показать";
        btnReveal.addEventListener("click", e => {
          e.stopPropagation();
          origRevealed = !origRevealed;
          origText.style.display = origRevealed ? "inline" : "none";
          btnReveal.textContent = origRevealed ? "👁 Скрыть" : "👁 Показать";
        });

        origRow.appendChild(btnReveal);
        origRow.appendChild(origText);

        const phonRow = document.createElement("div");
        phonRow.className = "sub sub-phon" + (showPhon ? " visible" : "");
        if (it.phonetic) {
          phonRow.innerHTML =
            `<div class="subCard"><b>👂 Автор слышит:</b> <span class="mono phon-author">${esc(it.phonetic)}</span></div>`;
        }

        const transRow = document.createElement("div");
        transRow.className = "sub sub-trans" + (showTrans ? " visible" : "");
        if (it.translation) {
          transRow.innerHTML =
            `<div class="subCard"><span class="muted">Перевод:</span> ${esc(it.translation)}</div>`;
        }

        const whyRow = document.createElement("div");
        whyRow.className = "sub sub-why" + (showWhy ? " visible" : "");
        if (it.why) {
          const conf = typeof it.confidence === "number"
            ? ` <span class="pill">≈${(clamp01(it.confidence) * 100).toFixed(0)}%</span>` : "";
          whyRow.innerHTML =
            `<div class="subCard">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <b>🧠 Почему так слышится:</b>${conf}
              </div>
              <div style="margin-top:4px;">${esc(it.why)}</div>
            </div>`;
        }

        const actions = document.createElement("div");
        actions.className = "line-actions";

        function mkBtn(text, cls, fn) {
          const b = document.createElement("button");
          b.className = cls; b.textContent = text;
          b.addEventListener("click", e => { e.stopPropagation(); fn(); });
          return b;
        }

        actions.appendChild(mkBtn("Выбрать", "tiny btn-primary", () => setActive(idx, true)));
        if (hasTime) actions.appendChild(mkBtn("▶", "tiny", () => { setActive(idx, false); playSegment(); }));
        if (it.phonetic) actions.appendChild(mkBtn("👂", "tiny", () => phonRow.classList.toggle("visible")));
        actions.appendChild(mkBtn("💬", "tiny", () => transRow.classList.toggle("visible")));
        if (it.why) actions.appendChild(mkBtn("🧠", "tiny", () => whyRow.classList.toggle("visible")));
        actions.appendChild(mkBtn(
          it.learned ? "✓ Выучено" : "Выучено",
          "tiny " + (it.learned ? "btn-good" : ""),
          () => { it.learned = !it.learned; save(); renderLines(); }
        ));

        line.appendChild(header);
        line.appendChild(origRow);
        line.appendChild(phonRow);
        line.appendChild(transRow);
        line.appendChild(whyRow);
        line.appendChild(actions);
        line.addEventListener("click", () => setActive(idx, true));
        linesHost.appendChild(line);
      });

      renderSegStatus();
      save();
    }

    /* ── JSON tools ── */
    jsonBox.value = JSON.stringify(state, null, 2);

    btnExport.addEventListener("click", async () => {
      const out = structuredClone(state);
      delete out._storageKey;
      const txt = JSON.stringify(out, null, 2);
      jsonBox.value = txt;
      try { await navigator.clipboard.writeText(txt); toast("Экспортировано", "JSON в буфере обмена"); }
      catch { toast("Экспортировано", "Скопируйте из поля вручную"); }
    });

    btnImport.addEventListener("click", () => {
      const p = safeParseJson(jsonBox.value);
      if (!p.ok) { toast("Не получилось разобрать JSON", p.error); return; }
      const key = state._storageKey;
      state = p.value; state._storageKey = key;
      normalizeState(state); save(); applyHeader();
      setActive(0, false);
      jsonBox.value = JSON.stringify(state, null, 2);
      toast("Импорт применён");
    });

    filePick.addEventListener("change", async () => {
      const f = filePick.files?.[0]; if (!f) return;
      const txt = await f.text(); jsonBox.value = txt;
      const p = safeParseJson(txt);
      if (!p.ok) { toast("JSON не распознан", p.error); return; }
      const key = state._storageKey;
      state = p.value; state._storageKey = key;
      normalizeState(state); save(); applyHeader();
      setActive(0, false);
      toast("JSON загружен", f.name);
    });

    btnReset.addEventListener("click", async () => {
      if (!confirm("Сбросить все изменения к исходным данным?")) return;
      try {
        const remote = await fetchJson(SONG_JSON_URL);
        const key = state._storageKey;
        state = remote; state._storageKey = key;
        normalizeState(state); save(); applyHeader();
        setActive(0, false);
        toast("Сброшено к шаблону");
      } catch (e) { toast("Не удалось сбросить", String(e)); }
    });

    /* ── global toggles ── */
    if (globalShowOrig)  globalShowOrig.checked  = !!state.ui.showOriginalByDefault;
    if (globalShowTrans) globalShowTrans.checked = !!state.ui.showTranslationByDefault;
    if (globalShowPhon)  globalShowPhon.checked  = !!state.ui.showPhoneticByDefault;
    if (globalShowWhy)   globalShowWhy.checked   = !!state.ui.showWhyHeardByDefault;

    [globalShowOrig, globalShowTrans, globalShowPhon, globalShowWhy].forEach(el => {
      if (el) el.addEventListener("change", renderLines);
    });

    /* ── start ── */
    renderLines();
    setActive(0, false);

    /* ── keyboard shortcuts ── */
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const key = e.key.toLowerCase();

      if (key === " " || key === "spacebar") {
        e.preventDefault();
        if (player.paused) player.play().catch(() => {}); else player.pause();
      }
      if (key === "s") {
        e.preventDefault(); btnStart.click();
        toast("⏱ Start = " + player.currentTime.toFixed(2));
      }
      if (key === "e") {
        e.preventDefault(); btnEnd.click();
        const next = Math.min(activeIndex + 1, state.items.length - 1);
        if (next !== activeIndex) setTimeout(() => setActive(next, false), 100);
        toast("⏱ End = " + player.currentTime.toFixed(2) + " → строка " + (next + 1));
      }
      if (key === "arrowdown" || key === "n") {
        e.preventDefault(); setActive(Math.min(activeIndex + 1, state.items.length - 1), false);
      }
      if (key === "arrowup" || key === "p") {
        e.preventDefault(); setActive(Math.max(activeIndex - 1, 0), false);
      }
      if (key === "r") { e.preventDefault(); playSegment(); }
    });

    toast("⌨ Горячие клавиши: S=Start, E=End, Space=Play, ↑↓=строки, R=фрагмент");
  }

  /* ══════════════════════════════════════
     HOME PAGE
     ══════════════════════════════════════ */
  async function bootHome() {
    const root = document.documentElement;
    if (!root.dataset.catalog) return;

    const list = $("#songsList");
    const langSel = $("#langFilter");
    const search = $("#q");

    let catalog;
    try { catalog = await fetchJson(root.dataset.catalog); }
    catch (e) { toast("Не удалось загрузить каталог", String(e)); return; }

    const songs = catalog.songs || [];
    const langs = catalog.languages || [];

    langSel.innerHTML = `<option value="">Все языки</option>` +
      langs.map(l => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join("");

    function render() {
      const q = (search.value || "").trim().toLowerCase();
      const lang = langSel.value || "";
      const filtered = songs.filter(s => {
        const okLang = !lang || s.language === lang;
        const hay = `${s.title} ${s.artist} ${s.languageName || ""}`.toLowerCase();
        return okLang && (!q || hay.includes(q));
      });
      $("#count").textContent = String(filtered.length);
      list.innerHTML = "";
      filtered.forEach(s => {
        const a = document.createElement("a");
        a.className = "songCard"; a.href = s.url;
        a.innerHTML =
          `<div class="songTitle">${esc(s.title)}</div>
           <div class="songMeta">
             <span class="pill">👤 ${esc(s.artist || "—")}</span>
             <span class="pill">🌍 ${esc(s.languageName || s.language || "—")}</span>
           </div>
           <div class="songSmall">${esc(s.short || "")}</div>`;
        list.appendChild(a);
      });
    }

    langSel.addEventListener("change", render);
    search.addEventListener("input", render);
    render();
  }

  /* ── boot ── */
  window.addEventListener("DOMContentLoaded", () => {
    showStorageConsent();
    bootSongPage();
    bootHome();
  });
})();
