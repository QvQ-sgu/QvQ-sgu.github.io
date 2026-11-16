
/* ===== ui.js ===== */
/* ============================================================
   LEAFALL · 页面交互层（首页 / HUD / 覆盖层 / 排行榜）
   ============================================================ */
(function () {
  const cfg = NA.settings.load();
  const U = NA.util;
  const $ = (id) => document.getElementById(id) || window.__safeEl();

  const DIFF_HINT = {
    easy: "简单：怪少一点慢一点，先练练手",
    normal: "普通：正常难度，一条命五格血，留意会炸的刺栗",
    hard: "困难：弹更快、怪更肉，分数也给得多",
    nightmare: "噩梦：弹幕很凶，分数也很香"
  };
  const DIFF_LABEL = { easy: "简单", normal: "普通", hard: "困难", nightmare: "噩梦" };

  let difficulty = NA.store.get("difficulty", cfg.game.defaultDifficulty || "normal");
  let soundOn = NA.store.get("sound", cfg.game.sound !== false);
  let game = null;
  let overlayMode = "start";
  let upgradeData = null;
  let endResult = null;

  /* ---------------- 站点文案 ---------------- */
  function applySite() {
    const s = cfg.site;
    document.title = s.name + " · " + s.nameCn + " — 纵版弹幕射击";
    $("brandName").textContent = s.name;
    $("brandCn").textContent = s.nameCn;
    $("heroTitle").innerHTML = s.name + '<span class="h1-cn">' + s.nameCn + "</span>";
    $("tagline").textContent = s.tagline;
    $("announce").innerHTML = "<em>公告</em><span>" + s.announcement + "</span>";
    $("footerText").textContent = s.footer;
    // 强调色：由配置驱动，自动算加深色供 hover 用
    function shade(hex, k) {
      const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const r = Math.round(((n >> 16) & 255) * k);
      const g = Math.round(((n >> 8) & 255) * k);
      const b = Math.round((n & 255) * k);
      return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
    }
    if (s.accent) {
      document.documentElement.style.setProperty("--accent", s.accent);
      document.documentElement.style.setProperty("--accent-d", shade(s.accent, 0.82));
    }
    if (s.accent2) document.documentElement.style.setProperty("--accent2", s.accent2);
    if (s.danger) document.documentElement.style.setProperty("--danger", s.danger);
    if (s.amber) document.documentElement.style.setProperty("--amber", s.amber);
    if (s.maintenance) {
      const b = $("startBtn");
      b.disabled = true;
      b.style.opacity = 0.45;
      b.style.cursor = "not-allowed";
      b.textContent = "维护中";
    }
  }

  /* ---------------- 音效 ---------------- */
  function syncSoundBtn() {
    $("soundBtn").classList.toggle("off", !soundOn);
    $("soundBtn").title = soundOn ? "音效：开" : "音效：关";
    NA.sound.setEnabled(soundOn);
  }

  /* ---------------- 难度 ---------------- */
  function syncDiff() {
    Array.from($("diffSeg").children).forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.diff === difficulty));
    });
    $("diffHint").textContent = DIFF_HINT[difficulty] || "";
  }

  /* ---------------- 本机统计 ---------------- */
  function loadStats() {
    return NA.store.get("stats", { runs: 0, kills: 0, best: 0, maxLevel: 0 });
  }
  function saveStats(patch) {
    const next = Object.assign({}, loadStats(), patch);
    NA.store.set("stats", next);
    renderStats();
    return next;
  }
  function renderMission() {
    const s = loadStats();
    const maxLevel = s.maxLevel || 0;
    const list = cfg.levels || [];
    const listEl = document.getElementById("missionList");
    if (!listEl) return;
    listEl.innerHTML = list
      .map((l) => {
        const cleared = maxLevel > l.id;
        const tag = cleared ? "CLEAR" : l.boss ? "BOSS" : "40s";
        const tagCls = cleared ? "clear" : l.boss ? "boss" : "";
        return (
          "<li" + (l.boss ? ' class="boss-row"' : "") + ">" +
          '<span class="code">L' + U.pad2(l.id) + "</span>" +
          '<span class="nm">' + escapeHtml(l.name) + "</span>" +
          '<span class="tag ' + tagCls + '">' + tag + "</span>" +
          "</li>"
        );
      })
      .join("");
    const cleared = Math.min(5, Math.max(0, (s.maxLevel || 0) - 1));
    (document.getElementById("missionProgress") || window.__safeEl()).textContent = cleared + " / " + list.length + " 已通关";
  }

  function renderStats() {
    const s = loadStats();
    $("metaBest").textContent = s.best ? U.fmtScore(s.best) : "—";
    $("statBest").textContent = U.fmtScore(s.best || 0);
    $("statLevel").textContent = s.maxLevel ? s.maxLevel + " / 5" : "—";
    $("statRuns").textContent = s.runs || 0;
    $("statKills").textContent = U.fmtScore(s.kills || 0);
    renderMission();
  }

  /* ---------------- 排行榜 ---------------- */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function renderBoard() {
    const list = NA.leaderboard.load();
    const tbody = $("boardBody");
    if (!list.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">还没人上榜，打完一局来留个名。</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((r, i) => {
        return (
          "<tr>" +
          '<td class="rank' + (i === 0 ? " top1" : "") + '">' + U.pad2(i + 1) + "</td>" +
          "<td>" + escapeHtml(r.name || "无名游客") + "</td>" +
          '<td class="score">' + U.fmtScore(r.score) + "</td>" +
          '<td class="num">' + (r.level || 1) + "</td>" +
          '<td class="num">' + U.fmtTime(r.time || 0) + "</td>" +
          "<td>" + (DIFF_LABEL[r.diffKey] || r.difficulty || "普通") + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  /* ---------------- HUD ---------------- */
  function renderHud(snap) {
    if (!snap) return;
    $("hudScore").textContent = U.fmtScore(snap.score);
    $("hudLevel").textContent = snap.level + " / " + cfg.levels.length;
    $("hudAlloy").textContent = snap.alloy;

    let hearts = "";
    for (let i = 0; i < snap.maxHp; i++) {
      hearts += '<span class="heart' + (i < snap.hp ? "" : " empty") + '"></span>';
    }
    $("hudHp").innerHTML = hearts;

    let pips = "";
    if (snap.shieldMax > 0) {
      for (let i = 0; i < snap.shieldMax; i++) {
        pips += '<span class="pip' + (i < Math.round(snap.shield) ? " on" : "") + '"></span>';
      }
    }
    $("hudShield").innerHTML = pips || '<span class="hud-none">NONE</span>';

    $("stageLabel").textContent = "LEVEL " + U.pad2(snap.level) + " · " + snap.levelName;
    $("stageTime").textContent = U.fmtTime((snap.runTime || 0) * 1000);

    const pct = snap.levelDur
      ? Math.min(100, (snap.levelTime / snap.levelDur) * 100)
      : snap.boss
      ? 100
      : Math.min(100, (snap.levelTime / 40) * 100);
    $("stageFill").style.width = pct + "%";

    const bossRow = $("bossRow");
    if (snap.boss && snap.state === "playing") {
      bossRow.style.display = "flex";
      const p = Math.max(0, snap.boss.hp / snap.boss.maxHp) * 100;
      $("bossFill").style.width = p + "%";
      $("bossPct").textContent = Math.ceil(p) + "%";
    } else {
      bossRow.style.display = "none";
    }
  }

  /* ---------------- 覆盖层基础 ---------------- */
  function showOverlay(html, cls) {
    const ov = $("overlay");
    ov.className = "overlay show" + (cls ? " " + cls : "");
    ov.innerHTML = html;
  }
  function hideOverlay() {
    const ov = $("overlay");
    ov.className = "overlay";
    ov.innerHTML = "";
  }

  function screenStart() {
    overlayMode = "start";
    endResult = null;
    showOverlay(
      '<div class="ov-kicker">落叶秋游</div>' +
        "<h2>来玩吧</h2>" +
        '<p class="sub">八种小怪、一辆南瓜车，还有护盾和布偶。点开始，看你能撑到第几关。</p>' +
        '<div class="keys-hint">' +
        "<div><kbd>WASD</kbd> / <kbd>方向键</kbd></div><div>移动</div>" +
        "<div>拖动屏幕</div><div>手机操控</div>" +
        "<div><kbd>ESC</kbd> / <kbd>P</kbd></div><div>暂停</div>" +
        "<div>自动投页</div><div>不用按</div>" +
        "<div><kbd>" + NA.keys.label(NA.keys.get().bomb) + "</kbd> / <kbd>" + NA.keys.label(NA.keys.get().storm) + "</kbd> / <kbd>" + NA.keys.label(NA.keys.get().slow) + "</kbd> / <kbd>" + NA.keys.label(NA.keys.get().bell) + "</kbd></div><div>四个技能</div>" +
        "<div>机台下方按钮</div><div>手机也能放技能</div>" +
        "<div><kbd>" + NA.keys.label(NA.keys.get().dash) + "</kbd></div><div>侧身闪避</div>" +
        "</div>" +
        '<p class="sub" style="margin-top:-6px;font-size:12px">当前武器：' + NA.weapons.get(NA.wallet.load().weapon).name + '（首页「小卖部」能换）。按键不对劲？机台下面「改键」里改。</p>' +
        '<div class="ov-actions"><button class="btn primary" id="ovStart">开始秋游</button></div>'
    );
    $("ovStart").addEventListener("click", startRun);
  }

  function screenPause(snap) {
    overlayMode = "pause";
    showOverlay(
      '<div class="ov-kicker">暂停了</div>' +
        "<h2>已暂停</h2>" +
        '<p class="sub">当前 ' + U.fmtScore(snap ? snap.score : 0) + " 分 · 第 " + (snap ? snap.level : 1) + " 关</p>" +
        '<div class="ov-actions">' +
        '<button class="btn primary" id="ovResume">继续</button>' +
        '<button class="btn ghost" id="ovQuit">放弃本局</button>' +
        "</div>"
    );
    $("ovResume").addEventListener("click", () => game && game.resume());
    $("ovQuit").addEventListener("click", () => game && game.surrender());
  }

  /* ---------------- 改装台 ---------------- */
  function upgradeHTML() {
    const d = upgradeData;
    if (!d) return "";
    const p = d.player;
    const curMap = { power: p.power, shield: p.shieldMax, engine: p.engine, drone: p.drones };

    const cards = d.upgrades
      .map((u) => {
        const cur = curMap[u.id] || 0;
        const maxed = cur >= u.max;
        const cost = u.base + u.step * cur;
        const afford = d.alloy >= cost;
        let pips = "";
        for (let i = 0; i < u.max; i++) pips += "<i class='" + (i < cur ? "on" : "") + "'></i>";
        return (
          '<button class="upg-card" data-id="' + u.id + '"' + (maxed || !afford ? " disabled" : "") + ">" +
          '<span class="upg-name"><span>' + u.name + '</span><span class="lv">' + cur + "/" + u.max + "</span></span>" +
          '<span class="upg-desc">' + u.desc + "</span>" +
          '<span class="upg-cost ' + (maxed ? "maxed" : afford ? "" : "insufficient") + '">' +
          (maxed ? "已满级" : "◆ " + cost + (afford ? "" : " · 秋果不够")) +
          "</span>" +
          '<span class="upg-pips">' + pips + "</span>" +
          "</button>"
        );
      })
      .join("");

    const next = d.next ? "第 " + (d.level + 1) + " 关 · " + d.next.name : "最后那辆南瓜车";

    return (
      '<div class="upg-head"><h2>改装台</h2><span class="alloy">秋果 ' + d.alloy + "</span></div>" +
      '<p class="sub upg-sub">第 ' + d.level + " 关过了 · 接下来 " + next + "</p>" +
      '<div class="upg-grid">' + cards + "</div>" +
      '<div class="ov-actions"><button class="btn primary" id="ovNext">下一关</button></div>' +
      '<p class="upg-tip">秋果只在这一局有用，过关就清零</p>'
    );
  }

  function screenUpgrade() {
    overlayMode = "upgrade";
    showOverlay(upgradeHTML(), "upgrade");
    Array.from(document.querySelectorAll(".upg-card")).forEach((card) => {
      card.addEventListener("click", () => {
        if (!upgradeData) return;
        const r = upgradeData.buy(card.dataset.id);
        if (r && r.ok) screenUpgrade();
      });
    });
    const nextBtn = $("ovNext");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (!upgradeData) return;
        const proceed = upgradeData.proceed;
        upgradeData = null;
        hideOverlay();
        proceed();
      });
    }
  }

  /* ---------------- 结算 ---------------- */
  function screenEnd(result) {
    overlayMode = "end";
    endResult = result;
    const isWin = !!result.win;
    const savedBest = loadStats().best || 0;

    const html =
      '<div class="ov-kicker">' + (isWin ? "全通关了" : "这趟就到这了") + "</div>" +
      '<h2 class="' + (isWin ? "win" : "danger") + '">' + (isWin ? "南瓜车打爆了" : "被弹幕带走了") + "</h2>" +
      '<p class="sub">' +
      (isWin ? "五关全通，南瓜车也打爆了。" : "倒在第 " + result.level + " 关，再来一把？") +
      "</p>" +
      '<div class="result-grid">' +
      '<div class="result-cell"><span>分数</span><b>' + U.fmtScore(result.score) + "</b></div>" +
      '<div class="result-cell"><span>关卡</span><b>' + result.level + "/5</b></div>" +
      '<div class="result-cell"><span>击落</span><b>' + result.kills + "</b></div>" +
      '<div class="result-cell"><span>用时</span><b>' + U.fmtTime(result.time) + "</b></div>" +
      '<div class="result-cell accent-cell"><span>金币 +' + (result.coins || 0) + "</span><b>" + (result.coinsTotal != null ? result.coinsTotal : NA.wallet.load().coins) + "</b></div>" +
      "</div>" +
      (result.score > savedBest ? '<p class="sub new-best">新纪录！</p>' : "") +
      '<div class="name-row">' +
      '<input id="nameInput" maxlength="12" placeholder="留个名，最多 12 个字" value="' + escapeHtml(NA.store.get("nickname", "")) + '" />' +
      '<button class="btn primary small" id="saveBtn">记上去</button>' +
      "</div>" +
      '<div class="ov-actions">' +
      '<button class="btn primary" id="ovRetry">再来一把</button>' +
      '<button class="btn ghost" id="ovHome">回首页</button>' +
      "</div>";

    showOverlay(html);

    $("ovRetry").addEventListener("click", startRun);
    $("ovHome").addEventListener("click", () => {
      if (game) { game.resetRun(); game.state = "ready"; }
      screenStart();
      renderHud(game ? game.snapshot() : null);
    });
    $("saveBtn").addEventListener("click", () => {
      const input = $("nameInput");
      const name = (input.value || "无名游客").trim().slice(0, 12) || "无名游客";
      NA.store.set("nickname", name);
      NA.leaderboard.add({
        name,
        score: result.score,
        level: result.level,
        time: result.time,
        kills: result.kills,
        diffKey: result.diffKey,
        difficulty: result.difficulty,
        date: result.date
      });
      renderBoard();
      const btn = $("saveBtn");
      btn.textContent = "已记录";
      btn.disabled = true;
      input.disabled = true;
      NA.sound.ui();
      $("board").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  /* ---------------- 开局 / 状态 ---------------- */
  function startRun() {
    if (cfg.site.maintenance) return;
    if (!document.getElementById("game")) return;
    if (NA.focusCabinet) NA.focusCabinet();
    upgradeData = null;
    endResult = null;
    hideOverlay();
    NA.sound.resume();
    if (!game) createGame();
    game.setDifficulty(difficulty);
    game.start();
    renderHud(game.snapshot());
  }

  function handleState(state, snap) {
    renderHud(snap);
    if (state === "paused") screenPause(snap);
    else if (state === "playing" && overlayMode !== "start") {
      if (overlayMode === "pause" || overlayMode === "end") hideOverlay();
    }
  }

  function handleFinish(result) {
    const earn = Math.floor(result.score / 10) + result.kills * 2;
    result.coins = earn;
    result.coinsTotal = NA.wallet.add(earn);
    renderCoins();
    saveStats({
      runs: (loadStats().runs || 0) + 1,
      kills: (loadStats().kills || 0) + result.kills,
      best: Math.max(loadStats().best || 0, result.score),
      maxLevel: Math.max(loadStats().maxLevel || 0, result.level)
    });
    screenEnd(result);
  }

  function createGame() {
    game = new window.Starline($("game"), {
      config: cfg,
      difficulty,
      onHud: renderHud,
      onState: handleState,
      onUpgrade: (d) => { upgradeData = d; screenUpgrade(); },
      onFinish: handleFinish
    });
    window.starlineGame = game;
    return game;
  }

  /* ---------------- 事件 ---------------- */
  function syncSkills() {
    const bar = $("skillBar");
    if (!bar || !game || !game.skills) return;
    Array.from(bar.children).forEach((btn) => {
      const s = game.skills[btn.dataset.skill];
      if (!s) return;
      const cdEl = btn.querySelector(".scd");
      const ready = s.cd <= 0;
      btn.classList.toggle("cooling", !ready);
      btn.disabled = !ready || game.state !== "playing";
      const km = NA.keys ? NA.keys.get() : {};
      const kLabel = NA.keys ? NA.keys.label(km[btn.dataset.skill]) : btn.dataset.key;
      cdEl.textContent = ready ? (kLabel + " · 就绪") : Math.ceil(s.cd) + " s";
    });
  }

  /* ---------------- 按键设置 ---------------- */
  const KEY_ROWS = [
    ["up", "向上"], ["down", "向下"], ["left", "向左"], ["right", "向右"],
    ["bomb", "落叶爆弹"], ["storm", "纸页风暴"], ["slow", "布偶定格"], ["bell", "秋收铃"], ["dash", "侧身闪避"]
  ];
  let listeningKey = null;

  function renderKeys() {
    const m = NA.keys.get();
    $("keysGrid").innerHTML = KEY_ROWS.map(([id, label]) =>
      '<button class="key-row' + (listeningKey === id ? " listening" : "") + '" data-id="' + id + '">' +
        "<span>" + label + "</span>" +
        '<span class="kval">' + (listeningKey === id ? "按下…" : NA.keys.label(m[id])) + "</span>" +
      "</button>"
    ).join("");
  }

  function applyKeyLabels() {
    const m = NA.keys.get();
    const hint = $("footHint");
    if (hint) {
      hint.textContent = "拖动小女孩 / " +
        [NA.keys.label(m.up), NA.keys.label(m.left), NA.keys.label(m.down), NA.keys.label(m.right)].join(" ") +
        " 移动 · 自动投页";
    }
  }

  function openKeys() {
    listeningKey = null;
    $("keysMsg").textContent = "";
    renderKeys();
    $("keysModal").classList.add("show");
  }

  function closeKeys() {
    listeningKey = null;
    $("keysModal").classList.remove("show");
  }

  function bindKeysPanel() {
    $("keysBtn").addEventListener("click", openKeys);
    $("keysClose").addEventListener("click", closeKeys);
    $("keysModal").addEventListener("click", (e) => {
      if (e.target === $("keysModal")) closeKeys();
    });
    $("keysGrid").addEventListener("click", (e) => {
      const row = e.target.closest ? e.target.closest(".key-row") : null;
      if (!row) return;
      listeningKey = row.dataset.id;
      $("keysMsg").textContent = "按下你要用的键…";
      renderKeys();
    });
    $("keysReset").addEventListener("click", () => {
      NA.keys.reset();
      $("keysMsg").textContent = "已恢复默认：W A S D + J K L";
      renderKeys();
      applyKeyLabels();
      syncSkills();
    });

    window.addEventListener("keydown", (e) => {
      if (!listeningKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        listeningKey = null;
        $("keysMsg").textContent = "";
        renderKeys();
        return;
      }
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].indexOf(e.key) >= 0) return;
      if (e.key.length > 1 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(e.key) < 0) return;

      const m = NA.keys.get();
      const norm = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const conflict = Object.keys(m).find((id) => id !== listeningKey && String(m[id]).toLowerCase() === norm);
      if (conflict) {
        const nm = (KEY_ROWS.find(([id]) => id === conflict) || [])[1] || "别的功能";
        $("keysMsg").textContent = "这个键已经给了「" + nm + "」，换一个吧";
        return;
      }
      NA.keys.set(listeningKey, e.key);
      $("keysMsg").textContent = "改成 " + NA.keys.label(e.key) + " 了";
      listeningKey = null;
      renderKeys();
      applyKeyLabels();
      syncSkills();
    }, true);
  }

  /* ---------------- 小卖部 ---------------- */
  function renderCoins() {
    const w = NA.wallet.load();
    if ($("coinPill")) $("coinPill").textContent = w.coins;
    if ($("shopCoins")) $("shopCoins").textContent = w.coins;
  }

  function renderShop() {
    const w = NA.wallet.load();
    $("shopGrid").innerHTML = NA.weapons.list.map((it) => {
      const owned = w.owned.indexOf(it.id) >= 0;
      const on = w.weapon === it.id;
      const price = owned ? (on ? "装备中" : "已拥有") : it.price + " 金币";
      const disabled = on || (!owned && w.coins < it.price);
      return '<div class="shop-item' + (on ? " on" : "") + '">' +
        '<div class="si-head"><b>' + it.name + '</b><span class="si-price">' + price + "</span></div>" +
        '<p class="si-desc">' + it.desc + "</p>" +
        '<button class="si-btn" data-id="' + it.id + '" data-act="' + (owned ? "equip" : "buy") + '"' +
        (disabled ? " disabled" : "") + ">" + (owned ? (on ? "使用中" : "装备") : "购买") + "</button>" +
        "</div>";
    }).join("");
    renderCoins();
  }

  function openShop() {
    $("shopMsg").textContent = "";
    renderShop();
    $("shopModal").classList.add("show");
  }

  function bindShop() {
    const btn = $("shopBtn");
    if (btn) btn.addEventListener("click", openShop);
    $("shopClose").addEventListener("click", () => $("shopModal").classList.remove("show"));
    $("shopModal").addEventListener("click", (e) => {
      if (e.target === $("shopModal")) $("shopModal").classList.remove("show");
    });
    $("shopGrid").addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest(".si-btn") : null;
      if (!b || b.disabled) return;
      const id = b.dataset.id;
      const it = NA.weapons.get(id);
      if (b.dataset.act === "buy") {
        const r = NA.wallet.buy(id);
        if (!r.ok) { $("shopMsg").textContent = r.msg; return; }
        NA.wallet.equip(id);
        $("shopMsg").textContent = "买了「" + it.name + "」，这就换上";
      } else {
        NA.wallet.equip(id);
        $("shopMsg").textContent = "换成「" + it.name + "」了";
      }
      if (game && game.state === "playing") game.weapon = NA.weapons.get(NA.wallet.load().weapon);
      NA.sound.ui();
      renderShop();
    });
    renderCoins();
  }

  function bindEvents() {
    $("startBtn").addEventListener("click", startRun);

    $("restartBtn").addEventListener("click", () => {
      hideOverlay();
      startRun();
    });

    $("pauseBtn").addEventListener("click", () => {
      if (!game) return;
      if (game.state === "ready" || game.state === "gameover" || game.state === "win") return;
      game.togglePause();
    });

    $("skillBar").addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest(".skill") : null;
      if (!btn || !game) return;
      if (game.useSkill(btn.dataset.skill)) {
        syncSkills();
        NA.sound.ui();
      }
    });

    $("soundBtn").addEventListener("click", () => {
      soundOn = !soundOn;
      NA.store.set("sound", soundOn);
      syncSoundBtn();
      if (soundOn) NA.sound.ui();
    });

    Array.from($("diffSeg").children).forEach((btn) => {
      btn.addEventListener("click", () => {
        difficulty = btn.dataset.diff;
        NA.store.set("difficulty", difficulty);
        syncDiff();
      });
    });

    $("clearBoard").addEventListener("click", () => {
      NA.leaderboard.clear();
      NA.store.set("stats", { runs: 0, kills: 0, best: 0, maxLevel: 0 });
      renderBoard();
      renderStats();
    });

    window.addEventListener("keydown", (e) => {
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;
      const m = NA.keys.get();
      const norm = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const sk = ["bomb", "storm", "slow", "bell", "dash"].find((id) => String(m[id]).toLowerCase() === norm);
      if (sk && game && game.state === "playing") {
        e.preventDefault();
        if (game.useSkill(sk)) syncSkills();
        return;
      }
      if (e.key === "Enter" && (overlayMode === "start" || overlayMode === "end")) {
        if (document.activeElement && document.activeElement.tagName === "INPUT") return;
        e.preventDefault();
        startRun();
      }
      if ((e.key === "Escape" || e.key === "p" || e.key === "P") && game) {
        if (game.state === "playing" || game.state === "paused") game.togglePause();
      }
    });
  }

  setInterval(syncSkills, 130);

  /* ---------------- 启动 ---------------- */
  applySite();
  syncSoundBtn();
  syncDiff();
  renderStats();
  renderBoard();
  // 只有存在游戏画布时才初始化游戏（拆页后玩法/排行/后台页没有画布）
  if (document.getElementById("game")) {
    bindKeysPanel();
    bindShop();
    bindEvents();
    createGame();
    applyKeyLabels();
    renderHud(game.snapshot());
    screenStart();
  }
})();

