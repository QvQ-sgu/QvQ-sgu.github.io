
/* ===== admin.js ===== */
/* ============================================================
   LEAFALL · 配置后台（密码门 + 配置表 + 导出）
   纯前端：配置写入 localStorage，可导出 JSON 回写 config.js
   ============================================================ */
(function () {
  const U = NA.util;
  const $ = (id) => document.getElementById(id) || window.__safeEl();
  let cfg = NA.settings.load();
  const SESSION_KEY = "admin:session";

  const SITE_FIELDS = [
    { path: ["site", "name"], label: "站点名（英文）", type: "text" },
    { path: ["site", "nameCn"], label: "站点名（中文）", type: "text" },
    { path: ["site", "tagline"], label: "首页一句话简介", type: "textarea" },
    { path: ["site", "announcement"], label: "公告条文案", type: "textarea" },
    { path: ["site", "accent"], label: "主色（朱红）", type: "color" },
    { path: ["site", "accent2"], label: "辅色（天蓝）", type: "color" },
    { path: ["site", "maintenance"], label: "维护模式（禁止开局）", type: "bool" },
    { path: ["site", "showLeaderboard"], label: "显示排行榜入口", type: "bool" },
    { path: ["site", "footer"], label: "页脚文字", type: "text" },
    { path: ["site", "heroImage"], label: "首屏主视觉图路径", type: "text" },
    { path: ["site", "heroImageSm"], label: "窄屏主视觉图路径", type: "text" },
    { path: ["site", "iconImage"], label: "APP 图标路径", type: "text" }
  ];

  const GAME_FIELDS = [
    { path: ["game", "defaultDifficulty"], label: "默认难度", type: "select", options: [["easy", "简单"], ["normal", "普通"], ["hard", "困难"], ["nightmare", "噩梦"]] },
    { path: ["game", "sound"], label: "默认开音效", type: "bool" },
    { path: ["game", "autoFire"], label: "自动开火", type: "bool" }
  ];

  const DEPLOY_FIELDS = [
    { path: ["deploy", "provider"], label: "托管平台", type: "text", readonly: true },
    { path: ["deploy", "project"], label: "项目名 / Worker 名", type: "text" },
    { path: ["deploy", "account"], label: "Cloudflare 账号", type: "text" },
    { path: ["deploy", "url"], label: "公网地址", type: "text" }
  ];

  function get(path) {
    let v = cfg;
    path.forEach((k) => { v = v == null ? undefined : v[k]; });
    return v;
  }

  function rowHTML(field, idx) {
    const val = get(field.path);
    let control = "";
    if (field.type === "bool") {
      control =
        '<label class="switch"><input type="checkbox" data-path="' + field.path.join(".") + '"' +
        (val ? " checked" : "") + (field.readonly ? " disabled" : "") +
        ' /><span></span></label>';
    } else if (field.type === "select") {
      control =
        '<select data-path="' + field.path.join(".") + '">' +
        field.options.map((o) => '<option value="' + o[0] + '"' + (String(val) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") +
        "</select>";
    } else if (field.type === "textarea") {
      control = '<textarea rows="2" data-path="' + field.path.join(".") + '">' + escapeHtml(val || "") + "</textarea>";
    } else if (field.type === "color") {
      control =
        '<div class="color-wrap"><input type="color" data-path="' + field.path.join(".") + '" value="' + (val || "#7fd4f2") + '" />' +
        '<code>' + (val || "") + "</code></div>";
    } else {
      control =
        '<input type="text" data-path="' + field.path.join(".") + '" value="' +
        escapeHtml(val == null ? "" : val) + '"' + (field.readonly ? " readonly" : "") + " />";
    }
    return (
      "<tr><td class='key'><code>" + field.path.join(".") + "</code></td>" +
      "<td class='label'>" + field.label + "</td>" +
      "<td class='value'>" + control + "</td></tr>"
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function renderTables() {
    $("siteRows").innerHTML = SITE_FIELDS.map(rowHTML).join("");
    $("gameRows").innerHTML = GAME_FIELDS.map(rowHTML).join("");
    $("deployRows").innerHTML = DEPLOY_FIELDS.map(rowHTML).join("");

    $("levelRows").innerHTML = (cfg.levels || [])
      .map((l) =>
        "<tr><td class='key'><code>L" + l.id + "</code></td>" +
        "<td>" + escapeHtml(l.name) + "</td>" +
        "<td class='num'>" + l.spawn + " s</td>" +
        "<td class='num'>×" + l.hpMul + "</td>" +
        "<td>" + (l.boss ? "有" : "—") + "</td></tr>"
      )
      .join("");
  }

  /* ---------------- 密码门 ---------------- */
  function sessionValid() {
    const s = NA.store.get(SESSION_KEY, null);
    return s && typeof s.until === "number" && s.until > Date.now();
  }

  function unlock() {
    $("gate").style.display = "none";
    $("panel").style.display = "block";
    renderTables();
  }

  async function checkPassword(pwd) {
    const hash = await U.sha256(pwd);
    if (!hash) throw new Error("no-crypto");
    if (!cfg.admin.passwordHash) throw new Error("no-hash");
    return hash === cfg.admin.passwordHash;
  }

  $("gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pwd = $("pwd").value;
    const err = $("gateErr");
    err.textContent = "";
    if (!pwd) { err.textContent = "先输密码"; return; }
    try {
      const ok = await checkPassword(pwd);
      if (!ok) {
        err.textContent = "密码不对，再试一次";
        $("pwd").value = "";
        return;
      }
      NA.store.set(SESSION_KEY, { until: Date.now() + (cfg.admin.sessionMinutes || 60) * 60000 });
      unlock();
    } catch (e2) {
      err.textContent = e2.message === "no-crypto"
        ? "当前环境不支持加密校验，请用 HTTPS 或本地服务器访问"
        : "配置里没有设置密码哈希";
    }
  });

  if ($("lockBtn")) $("lockBtn").addEventListener("click", () => {
    NA.store.del(SESSION_KEY);
    location.reload();
  });

  /* ---------------- 保存 ---------------- */
  function collect() {
    const patch = {};
    document.querySelectorAll("[data-path]").forEach((el) => {
      const path = el.dataset.path.split(".");
      if (path[0] === "deploy") return; // 部署信息不改站点
      let v;
      if (el.type === "checkbox") v = el.checked;
      else v = el.value;
      const group = path[0];
      const key = path[1];
      patch[group] = patch[group] || {};
      patch[group][key] = v;
    });
    (cfg.levels || []).forEach((l) => {}); // 关卡只读
    return patch;
  }

  $("cfgForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const patch = collect();
    NA.settings.savePatch(patch);
    cfg = NA.settings.load();
    window.dispatchEvent(new Event("starline:configchange"));
    $("saveMsg").textContent = "已保存 · 刷新首页生效";
    setTimeout(() => ($("saveMsg").textContent = ""), 2600);
  });

  $("resetCfg").addEventListener("click", () => {
    if (!confirm("恢复成 config.js 里的默认配置？本机改动会清掉。")) return;
    NA.settings.resetAll();
    NA.store.del(SESSION_KEY);
    location.reload();
  });

  $("adminClearBoard").addEventListener("click", () => {
    if (!confirm("清空本机排行榜和统计数据？")) return;
    NA.leaderboard.clear();
    NA.store.set("stats", { runs: 0, kills: 0, best: 0, maxLevel: 0 });
    $("saveMsg").textContent = "排行榜已清空";
    setTimeout(() => ($("saveMsg").textContent = ""), 2200);
  });

  $("exportBtn").addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: "把 override 的内容合并进页面 config 配置块后重新发布，即可对所有人生效",
      override: NA.store.get("settings:override", {}),
      effective: NA.settings.load()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "starline-config-" + Date.now() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });

  /* ---------------- 改密码 ---------------- */
  $("pwdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = $("newPwd").value.trim();
    const b = $("newPwd2").value.trim();
    const msg = $("pwdMsg");
    msg.textContent = "";
    if (a.length < 8) { msg.textContent = "至少 8 位"; return; }
    if (a !== b) { msg.textContent = "两次输入不一致"; return; }
    const hash = await U.sha256(a);
    if (!hash) { msg.textContent = "当前环境不支持加密"; return; }
    NA.settings.savePatch({ admin: { passwordHash: hash } });
    cfg = NA.settings.load();
    $("newPwd").value = $("newPwd2").value = "";
    msg.textContent = "已改 · 本机生效";
  });

  /* ---------------- 一键换肤 ---------------- */
  const THEMES = [
    { id: "ochre",  name: "暖赭",   sub: "默认 · 低饱和", c: ["#9a6a4a", "#6d7a3f", "#b5614a", "#c09246"] },
    { id: "mist",   name: "雾蓝",   sub: "清冷柔和",     c: ["#5f8092", "#7c8d86", "#a86a5e", "#b6975c"] },
    { id: "sage",   name: "豆绿",   sub: "温润护眼",     c: ["#6f8565", "#879467", "#b06f58", "#b99a55"] },
    { id: "lotus",  name: "藕粉",   sub: "温柔暖调",     c: ["#a9726f", "#8d7f6b", "#b5645f", "#c09a5a"] },
    { id: "ink",    name: "墨灰",   sub: "沉稳克制",     c: ["#6f6a60", "#7c7a6e", "#a8665a", "#b59963"] }
  ];
  function renderThemes() {
    const box = $("themeSwatches");
    if (!box) return;
    const cur = (cfg.site && cfg.site.accent) || "";
    box.innerHTML = THEMES.map((t) =>
      '<button type="button" class="theme-swatch' +
      (cur.toLowerCase() === t.c[0].toLowerCase() ? " on" : "") +
      '" data-theme="' + t.id + '">' +
      '<span class="sw-dot" style="background:' + t.c[0] + '"></span>' +
      '<span class="sw-txt"><b>' + t.name + '</b><small>' + t.sub + '</small></span>' +
      "</button>"
    ).join("");
  }
  function bindThemes() {
    const box = $("themeSwatches");
    if (!box) return;
    box.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest(".theme-swatch") : null;
      if (!btn) return;
      const t = THEMES.find((x) => x.id === btn.dataset.theme);
      if (!t) return;
      NA.settings.savePatch({ site: { accent: t.c[0], accent2: t.c[1], danger: t.c[2], amber: t.c[3] } });
      cfg = NA.settings.load();
      window.dispatchEvent(new Event("starline:configchange"));
      // applySite 重新写入 CSS 变量（--amber 由 applySite 设置）
      if (window.NA && window.NA.settings) {
        const s = cfg.site;
        const root = document.documentElement.style;
        root.setProperty("--accent", s.accent);
        root.setProperty("--accent2", s.accent2);
        root.setProperty("--danger", s.danger);
        root.setProperty("--accent-d", s.accent);
      }
      renderThemes();
      $("saveMsg").textContent = "已换成「" + t.name + "」· 记得点保存配置";
      setTimeout(() => ($("saveMsg").textContent = ""), 3000);
    });
    renderThemes();
  }

  /* ---------------- 启动 ---------------- */
  bindThemes();
  if (sessionValid()) unlock();
  else {
    $("gate").style.display = "block";
    /* 只有主动访问 #admin 时才自动聚焦，避免整页被拉到底部 */
    if (location.hash.toLowerCase().indexOf("admin") > -1) {
      setTimeout(() => {
        const anchor = document.getElementById("admin");
        if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        $("pwd").focus({ preventScroll: true });
      }, 420);
    }
  }
})();

