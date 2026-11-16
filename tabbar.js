/* ===== tabbar.js ===== iOS 风格底部导航：滑动胶囊指示器 + 点击过渡 + 手势切页 */
(function () {
  var bar = document.querySelector(".tabbar");
  if (!bar) return;
  var tabs = Array.prototype.slice.call(bar.querySelectorAll(".tab"));
  if (!tabs.length) return;

  // 页面顺序（与 tab 顺序一致）
  var order = tabs.map(function (t) { return t.getAttribute("href"); });
  var activeIdx = Math.max(0, tabs.findIndex(function (t) { return t.classList.contains("active"); }));

  // 胶囊元素
  var indicator = document.createElement("span");
  indicator.className = "tab-indicator";
  bar.insertBefore(indicator, bar.firstChild);

  // 把胶囊移到指定 tab（用 left+width 计算，transform 触发平滑过渡）
  function moveTo(idx, animate) {
    var tab = tabs[idx];
    if (!tab) return;
    var barRect = bar.getBoundingClientRect();
    var r = tab.getBoundingClientRect();
    var pad = parseFloat(getComputedStyle(bar).paddingLeft) || 8;
    var w = Math.max(52, r.width - 6);
    var x = r.left - barRect.left + (r.width - w) / 2;
    if (!animate) indicator.style.transition = "none";
    indicator.style.width = w + "px";
    indicator.style.transform = "translateX(" + x + "px)";
    if (!animate) {
      // 强制回流后恢复过渡
      void indicator.offsetWidth;
      indicator.style.transition = "";
    }
    indicator.classList.add("ready");
  }

  // 初始定位：等布局稳定
  function init() { moveTo(activeIdx, false); }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    requestAnimationFrame(init);
  } else {
    window.addEventListener("DOMContentLoaded", init);
  }
  window.addEventListener("load", function () { moveTo(activeIdx, false); });
  window.addEventListener("resize", function () { moveTo(activeIdx, false); });

  var navigating = false;
  function go(idx) {
    if (idx < 0 || idx >= tabs.length || idx === activeIdx || navigating) return;
    navigating = true;
    moveTo(idx, true);
    tabs.forEach(function (t, i) { t.classList.toggle("active", i === idx); });
    var href = order[idx];
    setTimeout(function () { window.location.href = href; }, 260);
  }

  // 点击：先滑动再跳转
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function (e) {
      if (i === activeIdx) return;           // 当前页不拦截
      if (e.metaKey || e.ctrlKey || e.shiftKey) return; // 允许新标签打开
      e.preventDefault();
      go(i);
    });
  });

  // 手势：左右滑动切页（含鼠标拖拽，方便桌面测试）
  var startX = 0, startY = 0, tracking = false;
  function down(x, y) { startX = x; startY = y; tracking = true; }
  function up(x, y) {
    if (!tracking) return;
    tracking = false;
    var dx = x - startX, dy = y - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(activeIdx + (dx < 0 ? 1 : -1));
    }
  }
  bar.addEventListener("touchstart", function (e) {
    var t = e.touches[0]; down(t.clientX, t.clientY);
  }, { passive: true });
  bar.addEventListener("touchend", function (e) {
    var t = e.changedTouches[0]; up(t.clientX, t.clientY);
  }, { passive: true });
  bar.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  window.addEventListener("mouseup", function (e) { up(e.clientX, e.clientY); });
})();
