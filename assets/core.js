
/* ===== config.js ===== */
/* ============================================================
   LEAFALL 站点总配置
   改这里 = 改全站；页面底部「配置后台」可在线覆盖（存浏览器本地）
   ============================================================ */
window.SITE_CONFIG = {
  site: {
    name: "LEAFALL",
    nameCn: "落叶秋游",
    tagline: "捡落叶、躲弹幕、打南瓜车。五关，一条命，看你能走多远。",
    announcement: "v1.4：新增松鼠、会炸的刺栗，还有秋收铃和热可可。小心刺栗碎裂时的弹幕！",
    accent: "#9a6a4a",
    accent2: "#6d7a3f",
    danger: "#b5614a",
    maintenance: false,
    showLeaderboard: true,
    footer: "LEAFALL · 用 Canvas 写的小游戏 · 打开就能玩",
    // 主视觉与 APP 图标：想换图，改这两个路径即可（相对站点根目录）
    heroImage: "assets/hero-wallpaper.jpg",
    heroImageSm: "assets/hero-wallpaper-sm.jpg",
    iconImage: "assets/leafall-icon.png"
  },

  game: {
    defaultDifficulty: "normal",   // easy | normal | hard
    sound: true,                   // 默认开音效
    autoFire: true,                // 手机端自动开火
    invincibleDebug: false         // 调试用，正式上线保持 false
  },

  admin: {
    // SHA-256("18859794790a") —— 上线前换成你自己的密码哈希
    passwordHash: "83ff012d30581c4cf0d22ff09b7776aa5661f26b2087592422aa4fd4cf66da96",
    sessionMinutes: 60,
    hint: "密码由站主在配置里设定"
  },

  deploy: {
    provider: "Cloudflare Pages",
    project: "starline",
    account: "",
    url: ""
  },

  levels: [
    { id: 1, name: "落叶石阶",        spawn: 1.15, hpMul: 1.0,  boss: false, alloy: 0 },
    { id: 2, name: "果园小径",          spawn: 0.90, hpMul: 1.25, boss: false, alloy: 1 },
    { id: 3, name: "河畔芦苇",        spawn: 0.78, hpMul: 1.5,  boss: false, alloy: 1 },
    { id: 4, name: "枫林深处",      spawn: 0.66, hpMul: 1.85, boss: false, alloy: 2 },
    { id: 5, name: "南瓜车「秋收」",  spawn: 0.60, hpMul: 2.2,  boss: true,  alloy: 3 }
  ],

  upgrades: [
    { id: "power",  name: "书页扩散", max: 5, base: 120, step: 90,  desc: "多一张书页，打得更散" },
    { id: "shield", name: "护罩", max: 4, base: 100, step: 80,  desc: "多一层盾，一会儿没挨打就自己长回来" },
    { id: "engine", name: "草鞋", max: 4, base: 90,  step: 70,  desc: "跑得更快，掉的东西也吸得更远" },
    { id: "drone",  name: "布偶",     max: 2, base: 260, step: 200, desc: "布偶跟着你一起打" }
  ]
};



/* ===== core.js ===== */
/* 公共内核：存储 / 音效 / 输入 / 画布 / 工具 */
(function () {
  const NA = (window.NA = window.NA || {});
  const PREFIX = "starline:";

  /* ---------- 工具 ---------- */
  NA.util = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    dist2: (x1, y1, x2, y2) => {
      const dx = x1 - x2, dy = y1 - y2;
      return dx * dx + dy * dy;
    },
    hitRect: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
    pad2: (n) => String(n).padStart(2, "0"),
    fmtTime: (ms) => {
      const s = Math.floor(ms / 1000);
      return NA.util.pad2(Math.floor(s / 60)) + ":" + NA.util.pad2(s % 60);
    },
    fmtScore: (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    sha256: async (text) => {
      if (!window.crypto || !window.crypto.subtle) return null;
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  };

  /* ---------- 本地存储 ---------- */
  NA.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) {}
    },
    del(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
    },
    allKeys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
        }
      } catch (e) {}
      return out;
    }
  };

  /* ---------- 设置合并：config.js 默认值 + 本地覆盖 ---------- */
  NA.settings = {
    load() {
      const base = JSON.parse(JSON.stringify(window.SITE_CONFIG || {}));
      const override = NA.store.get("settings:override", {});
      const merged = base;
      Object.keys(override || {}).forEach((k) => {
        if (override[k] && typeof override[k] === "object" && !Array.isArray(override[k])) {
          merged[k] = Object.assign({}, merged[k], override[k]);
        } else {
          merged[k] = override[k];
        }
      });
      return merged;
    },
    savePatch(patch) {
      const cur = NA.store.get("settings:override", {});
      Object.keys(patch).forEach((k) => {
        cur[k] = Object.assign({}, cur[k] || {}, patch[k]);
      });
      NA.store.set("settings:override", cur);
    },
    resetAll() {
      NA.store.del("settings:override");
    }
  };

  /* 一次性迁移：把本机存过的刺眼荧光绿主色换成柔和暖赭（只执行一次） */
  (function migrateHarshColor() {
    if (NA.store.get("colorMigrated:v18", false)) return;
    const ov = NA.store.get("settings:override", {}) || {};
    const acc = ov.site && ov.site.accent;
    const m = /^#([0-9a-f]{6})$/i.exec(acc || "");
    let harsh = false;
    if (m) {
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      // 亮绿/荧光绿：绿色通道远高于红蓝且整体很亮
      if (g > 180 && g > r * 1.35 && g > b * 1.35) harsh = true;
    }
    if (harsh) {
      NA.settings.savePatch({ site: { accent: "#9a6a4a", accent2: "#6d7a3f", danger: "#b5614a", amber: "#c09246" } });
    }
    NA.store.set("colorMigrated:v18", true);
  })();

  /* ---------- 音效：纯 WebAudio 合成，不加载任何音频文件 ---------- */
  NA.sound = (function () {
    let ctx = null;
    let master = null;
    let enabled = true;
    let lastShot = 0;

    function ensure() {
      if (ctx) return ctx;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      return ctx;
    }

    function env(node, dur, peak) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(peak, ctx.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      node.connect(g);
      g.connect(master);
      node.start(ctx.currentTime);
      node.stop(ctx.currentTime + dur + 0.02);
      return g;
    }

    // 通用音符：type 波形，f0->f1 滑音，delay 延迟，dur 时长，vol 音量
    function tone(type, f0, f1, delay, dur, vol) {
      const t0 = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }

    // 噪声爆破：dur 时长，vol 音量，filterFreq 低通截止（越大越亮）
    function noise(dur, vol, filterFreq, delay) {
      const t0 = ctx.currentTime + (delay || 0);
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const flt = ctx.createBiquadFilter();
      flt.type = "lowpass";
      flt.frequency.setValueAtTime(filterFreq || 2400, t0);
      flt.frequency.exponentialRampToValueAtTime(Math.max(120, (filterFreq || 2400) * 0.25), t0 + dur);
      const g = ctx.createGain();
      g.gain.value = vol || 0.3;
      src.connect(flt); flt.connect(g); g.connect(master);
      src.start(t0);
    }

    return {
      setEnabled(v) { enabled = !!v; },
      resume() {
        if (!enabled) return;
        const c = ensure();
        if (c && c.state === "suspended") c.resume();
      },
      shot() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        if (c.currentTime - lastShot < 0.045) return;
        lastShot = c.currentTime;
        const o = c.createOscillator();
        o.type = "square";
        o.frequency.setValueAtTime(760, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(240, c.currentTime + 0.09);
        env(o, 0.10, 0.16);
      },
      hit() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        const o = c.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(320, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.08);
        env(o, 0.09, 0.12);
      },
      boom() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        const dur = 0.34;
        const len = Math.floor(c.sampleRate * dur);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
        }
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = 0.55;
        src.connect(g); g.connect(master);
        src.start();
      },
      pickup() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        [660, 990].forEach((f, i) => {
          const o = c.createOscillator();
          o.type = "sine";
          o.frequency.setValueAtTime(f, c.currentTime + i * 0.06);
          env(o, 0.16, 0.2);
        });
      },
      levelUp() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        [523, 659, 784, 1046].forEach((f, i) => {
          const o = c.createOscillator();
          o.type = "square";
          o.frequency.setValueAtTime(f, c.currentTime + i * 0.09);
          env(o, 0.22, 0.18);
        });
      },
      alarm() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        [180, 180, 180].forEach((f, i) => {
          const o = c.createOscillator();
          o.type = "sawtooth";
          o.frequency.setValueAtTime(f, c.currentTime + i * 0.28);
          env(o, 0.2, 0.22);
        });
      },
      ui() {
        if (!enabled) return;
        const c = ensure(); if (!c) return;
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(520, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(880, c.currentTime + 0.07);
        env(o, 0.08, 0.1);
      },

      /* ---- 技能专属 ---- */
      skillBomb() {           // 落叶爆弹：破空上扬 + 落地闷响
        if (!enabled || !ensure()) return;
        tone("triangle", 300, 780, 0, 0.12, 0.14);
        noise(0.26, 0.32, 900, 0.1);
        tone("sine", 150, 60, 0.1, 0.28, 0.22);
      },
      skillStorm() {          // 纸页风暴：呼啸扫过
        if (!enabled || !ensure()) return;
        noise(0.55, 0.3, 3600, 0);
        [0, 0.09, 0.18].forEach((d, i) => tone("sawtooth", 900 - i * 180, 300, d, 0.22, 0.07));
      },
      skillSlow() {           // 布偶定格：空灵降调，慢动作感
        if (!enabled || !ensure()) return;
        tone("sine", 880, 220, 0, 0.6, 0.14);
        tone("triangle", 1320, 330, 0.04, 0.55, 0.07);
      },
      skillBell() {           // 秋收铃：清脆铃声（多谐波叠加）
        if (!enabled || !ensure()) return;
        [1046, 1568, 2093].forEach((f, i) => tone("sine", f, f * 0.99, i * 0.02, 0.7 - i * 0.14, 0.1 - i * 0.025));
      },
      dash() {                // 闪避：短促的"嗖"
        if (!enabled || !ensure()) return;
        noise(0.14, 0.16, 5200, 0);
        tone("sine", 220, 620, 0, 0.13, 0.1);
      },
      enemyShot() {           // 敌人开火：低沉的"噗"，区别于玩家
        if (!enabled || !ensure()) return;
        tone("triangle", 200, 90, 0, 0.1, 0.06);
      },

      /* ---- 事件专属 ---- */
      burst() {               // 刺栗爆裂：碎裂噪声 + 低频冲击
        if (!enabled || !ensure()) return;
        noise(0.32, 0.3, 2200, 0);
        tone("square", 240, 70, 0, 0.22, 0.12);
      },
      cocoa() {               // 热可可：上扬的"咕嘟"激励
        if (!enabled || !ensure()) return;
        tone("sine", 300, 900, 0, 0.18, 0.16);
        [0.12, 0.2, 0.28].forEach((d, i) => tone("triangle", 500 + i * 180, 700 + i * 220, d, 0.14, 0.09));
      },
      hurt() {                // 玩家受伤：刺耳下滑
        if (!enabled || !ensure()) return;
        tone("sawtooth", 420, 90, 0, 0.3, 0.18);
        noise(0.18, 0.18, 1400, 0);
      },
      shieldBreak() {         // 护盾破裂：玻璃质感
        if (!enabled || !ensure()) return;
        [1800, 2400, 3100].forEach((f, i) => tone("sine", f, f * 0.7, i * 0.015, 0.24, 0.08));
        noise(0.18, 0.14, 5000, 0);
      },
      upgrade() {             // 改装台升级：叮咚
        if (!enabled || !ensure()) return;
        tone("sine", 784, 784, 0, 0.16, 0.13);
        tone("sine", 1046, 1046, 0.1, 0.26, 0.13);
      },
      lose() {                // 失败：下行音阶
        if (!enabled || !ensure()) return;
        [440, 349, 294, 220].forEach((f, i) => tone("triangle", f, f * 0.96, i * 0.16, 0.34, 0.14));
      },
      win() {                 // 通关：欢快上行琶音
        if (!enabled || !ensure()) return;
        [523, 659, 784, 1046, 1318].forEach((f, i) => tone("square", f, f, i * 0.11, 0.3, 0.11));
      },
      bossWarn() {            // BOSS 警报：紧张的三连低音
        if (!enabled || !ensure()) return;
        [0, 0.26, 0.52].forEach((d) => {
          tone("sawtooth", 220, 160, d, 0.2, 0.16);
          tone("square", 110, 90, d, 0.22, 0.08);
        });
      }
    };
  })();

  /* ---------- 按键映射（可自定义） ---------- */
  NA.keysDefault = { up: "w", down: "s", left: "a", right: "d", bomb: "j", storm: "k", slow: "l", bell: "i", dash: "Shift" };
  NA.keys = {
    get() {
      const saved = NA.store.get("keys", {}) || {};
      return Object.assign({}, NA.keysDefault, saved);
    },
    set(id, key) {
      const m = this.get();
      m[id] = key;
      NA.store.set("keys", m);
      return m;
    },
    reset() {
      NA.store.del("keys");
      return Object.assign({}, NA.keysDefault);
    },
    label(key) {
      if (!key) return "";
      if (key === "ArrowUp") return "↑";
      if (key === "ArrowDown") return "↓";
      if (key === "ArrowLeft") return "←";
      if (key === "ArrowRight") return "→";
      if (key === " ") return "空格";
      if (key === "Shift") return "Shift";
      return key.length === 1 ? key.toUpperCase() : key;
    }
  };

  /* ---------- 局外金币与武器 ---------- */
  NA.weapons = {
    list: [
      { id: "page",  name: "书页",    price: 0,    kind: "page",  dmgMul: 1,    countAdd: 0,  arcMul: 1,    aoeMul: 1,   speedMul: 1,    cdMul: 1,    pierce: false,
        desc: "撒出去一片纸，打中了还会溅开一圈，等级越高撒得越开。" },
      { id: "quill", name: "钢笔尖",  price: 800,  kind: "quill", dmgMul: 0.9,  countAdd: -1, arcMul: 0.42, aoeMul: 0,   speedMul: 1.35, cdMul: 0.9,  pierce: true,
        desc: "一条直线的高速三连，能穿透一整排，但不炸。" },
      { id: "ink",   name: "墨水瓶",  price: 1600, kind: "ink",   dmgMul: 1.55, countAdd: -2, arcMul: 1.18, aoeMul: 1.95, speedMul: 0.76, cdMul: 1.35, pierce: false,
        desc: "飞得慢，砸得狠，炸得比书页大，专治扎堆的。" },
      { id: "maple", name: "枫叶镖",  price: 2600, kind: "maple", dmgMul: 0.82, countAdd: 3,  arcMul: 1.35, aoeMul: 0.6,  speedMul: 1.12, cdMul: 1.05, pierce: false,
        desc: "弹最多、撒得最开，铺满上半屏，走位更从容。" }
    ],
    get(id) {
      for (var i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return this.list[0];
    }
  };

  NA.wallet = {
    load() {
      const w = NA.store.get("wallet", null) || {};
      return {
        coins: typeof w.coins === "number" ? w.coins : 0,
        owned: Array.isArray(w.owned) && w.owned.length ? w.owned : ["page"],
        weapon: typeof w.weapon === "string" ? w.weapon : "page"
      };
    },
    save(w) { NA.store.set("wallet", w); },
    add(n) {
      const w = this.load();
      w.coins = Math.max(0, Math.round(w.coins + n));
      this.save(w);
      return w.coins;
    },
    buy(id) {
      const it = NA.weapons.get(id);
      const w = this.load();
      if (w.owned.indexOf(id) >= 0) return { ok: false, msg: "已经买过了" };
      if (w.coins < it.price) return { ok: false, msg: "金币还差 " + (it.price - w.coins) };
      w.coins -= it.price;
      w.owned.push(id);
      this.save(w);
      return { ok: true, coins: w.coins };
    },
    equip(id) {
      const w = this.load();
      if (w.owned.indexOf(id) < 0) return false;
      w.weapon = id;
      this.save(w);
      return true;
    }
  };

  /* ---------- 键盘 / 指针 ---------- */
  NA.input = (function () {
    const keys = Object.create(null);
    const pointer = { x: 0, y: 0, active: false, down: false };

    window.addEventListener("keydown", (e) => {
      keys[e.key] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(e.key) >= 0) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => { keys[e.key] = false; });
    window.addEventListener("blur", () => { Object.keys(keys).forEach((k) => (keys[k] = false)); });

    return {
      keys,
      pointer,
      isDown(...names) { return names.some((n) => !!keys[n]); },
      bindPointer(el, mapper) {
        const map = mapper || ((cx, cy) => ({ x: cx, y: cy }));
        const rectOf = () => el.getBoundingClientRect();
        el.addEventListener("pointerdown", (e) => {
          const r = rectOf();
          const p = map(e.clientX - r.left, e.clientY - r.top, r);
          pointer.x = p.x; pointer.y = p.y; pointer.down = true; pointer.active = true;
          el.setPointerCapture && el.setPointerCapture(e.pointerId);
        });
        el.addEventListener("pointermove", (e) => {
          const r = rectOf();
          const p = map(e.clientX - r.left, e.clientY - r.top, r);
          pointer.x = p.x; pointer.y = p.y;
          if (pointer.down) pointer.active = true;
        });
        const up = () => { pointer.down = false; };
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener("pointerleave", () => { pointer.down = false; });
      }
    };
  })();

  /* ---------- 画布适配 ---------- */
  NA.fitCanvas = function (canvas, logicalW, logicalH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    canvas.style.aspectRatio = logicalW + " / " + logicalH;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    NA.layoutCanvas(canvas, logicalW, logicalH);
    return ctx;
  };

  /* 按可用空间给画布定显示尺寸，保持 480:720 */
  NA.layoutCanvas = function (canvas, W, H) {
    const screen = canvas.parentElement;
    if (!screen) return 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isFullscreen = !!document.fullscreenElement;
    const isPhone = vw <= 720;
    const landscape = vh < vw;
    let heightRatio = 0.9;
    if (isFullscreen) heightRatio = 0.8;
    else if (vw <= 360) heightRatio = 100;          /* 手表/极窄屏：宽度决定，铺满 */
    else if (isPhone) heightRatio = landscape ? 0.78 : 0.68;
    else if (vw <= 900) heightRatio = 0.82;
    let maxW = Math.max(120, screen.clientWidth - 2);
    let maxH = Math.max(120, Math.round(vh * heightRatio));
    if (isFullscreen) {
      maxH = Math.max(200, (screen.clientHeight || vh) - 8);
      maxW = Math.max(200, vw - 12);
    } else if (vw > 340) {
      // 除手表外，留出 HUD/技能条/底栏的位置，尽量一屏放下不用滚
      const chrome = isPhone ? 216 : 212;
      const fitH = vh - chrome - 26;
      if (fitH > 240) maxH = Math.min(maxH, fitH);
    }
    const scale = Math.min(maxW / W, maxH / H);
    canvas.style.width = Math.round(W * scale) + "px";
    canvas.style.height = Math.round(H * scale) + "px";
    return scale;
  };

  (function bindRelayout() {
    let ticking = false;
    const run = () => {
      ticking = false;
      const c = document.getElementById("game");
      if (c) NA.layoutCanvas(c, 480, 720);
    };
    const schedule = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(run);
    };
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", () => setTimeout(run, 260));
    document.addEventListener("fullscreenchange", () => setTimeout(run, 120));
    window.addEventListener("load", schedule);
  })();

  /* 窄屏开局后把机台滚进视野 */
  NA.focusCabinet = function () {
    if (window.innerWidth > 940) return;
    const cab = document.querySelector(".cabinet");
    if (!cab) return;
    const top = cab.getBoundingClientRect().top + window.pageYOffset - 56;
    try { window.scrollTo({ top: top, behavior: "smooth" }); }
    catch (e) { window.scrollTo(0, top); }
  };

  /* 全屏游戏 */
  (function bindFullscreen() {
    const btn = document.getElementById("fullBtn");
    const cab = document.querySelector(".cabinet");
    if (!btn || !cab) return;
    const toggle = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl) {
        const req = cab.requestFullscreen || cab.webkitRequestFullscreen;
        if (req) { const p = req.call(cab); if (p && p.catch) p.catch(() => {}); }
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
      }
    };
    btn.addEventListener("click", toggle);
    window.addEventListener("keydown", (e) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;
      if (document.querySelector(".keys-modal.show")) return;
      toggle();
    });
    document.addEventListener("fullscreenchange", () => {
      btn.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
      setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
    });
  })();

  /* ---------- 排行榜 ---------- */
  NA.leaderboard = {
    load() {
      const list = NA.store.get("leaderboard", null);
      return Array.isArray(list) ? list : [];
    },
    add(entry) {
      const list = this.load();
      list.push(entry);
      list.sort((a, b) => (b.score - a.score) || (a.time - b.time));
      const trimmed = list.slice(0, 10);
      NA.store.set("leaderboard", trimmed);
      return { list: trimmed, rank: trimmed.indexOf(entry) + 1 };
    },
    clear() { NA.store.del("leaderboard"); }
  };
})();



  /* ===== 应用图片配置：改 SITE_CONFIG.site 的 heroImage/iconImage 即可换图 ===== */
  (function () {
    function applyImages() {
      var site = (window.NA && window.NA.settings && window.NA.settings.load().site) || {};
      var hero = site.heroImage || "assets/hero-wallpaper.jpg";
      var herosm = site.heroImageSm || "assets/hero-wallpaper-sm.jpg";
      var icon = site.iconImage || "assets/leafall-icon.png";
      function setSrc(sel, url) {
        var el = document.querySelector(sel);
        if (el && el.getAttribute("src") !== url) el.setAttribute("src", url);
      }
      // 窄屏用主视觉小图，减少加载
      if (window.innerWidth <= 720 && herosm) setSrc(".hero-photo img", herosm);
      else setSrc(".hero-photo img", hero);
      setSrc(".brand-mark img", icon);
      var link = document.querySelector('link[rel~="icon"]');
      if (link && link.getAttribute("href") !== icon) link.setAttribute("href", icon);
    }
    applyImages();
    window.addEventListener("resize", applyImages, { passive: true });
    // 后台改配置保存后会触发这个事件，即时换图
    window.addEventListener("starline:configchange", applyImages);
  })();

  (function () {
    var bar = document.querySelector(".topbar");
    if (!bar) return;
    function syncHeight() {
      document.documentElement.style.setProperty("--bar-h", bar.offsetHeight + "px");
    }
    function onScroll() {
      bar.classList.toggle("is-scrolled", window.scrollY > 24);
    }
    syncHeight();
    onScroll();
    window.addEventListener("resize", syncHeight, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("load", syncHeight);
  })();
