
/* ===== starline.js ===== */
/* ============================================================
   LEAFALL —— 纵版弹幕射击引擎
   纯 Canvas 2D，无外部依赖，逻辑尺寸 480 x 720
   ============================================================ */
(function () {
  const W = 480;
  const H = 720;
  const U = window.NA.util;

  const PLAYER_BASE_SPEED = 330;
  const PLAYER_R = 9;          // 判定半径（比外观小，手感更宽容）
  const BULLET_SPEED = 760;
  const EBULLET_SPEED = 262;

  const DIFF = {
    easy:   { spawnMul: 1.35, hpMul: 0.8,  dmgMul: 0.7, scoreMul: 0.85, label: "简单" },
    normal: { spawnMul: 1.0,  hpMul: 1.0,  dmgMul: 1.0, scoreMul: 1.0,  label: "普通" },
    hard:   { spawnMul: 0.78, hpMul: 1.3,  dmgMul: 1.35, scoreMul: 1.25, label: "困难" },
    nightmare: { spawnMul: 0.52, hpMul: 1.8, dmgMul: 1.7, scoreMul: 1.7, label: "噩梦", eSpeed: 1.34 }
  };

  const LEVEL_DURATION = 40;   // 每关 40 秒（Boss 关打到 Boss 死为止）
  const BOSS_AT = 34;

  function circleRect(cx, cy, r, rect) {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    return U.dist2(cx, cy, nx, ny) <= r * r;
  }

  class Starline {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.ctx = NA.fitCanvas(canvas, W, H);
      this.opt = options || {};
      this.cfg = this.opt.config || NA.settings.load();
      this.diffKey = this.opt.difficulty || this.cfg.game.defaultDifficulty || "normal";
      this.diff = DIFF[this.diffKey] || DIFF.normal;

      this.state = "ready";
      this.time = 0;
      this.last = 0;
      this.raf = 0;
      this.finished = false;

      this.resetRun();

      this.loop = this.loop.bind(this);
      this.boundResize = () => NA.fitCanvas(this.canvas, W, H);
      window.addEventListener("resize", this.boundResize);
      NA.input.bindPointer(canvas, (cx, cy, rect) => ({
        x: (cx / rect.width) * W,
        y: (cy / rect.height) * H
      }));

      this.girlImg = new Image();
      this.girlImg.src = "assets/player-girl.png";

      this.startLoop();
      this.state = "ready";
      this.emitState();
    }

    /* ---------------- 生命周期 ---------------- */
    resetRun() {
      this.score = 0;
      this.kills = 0;
      this.alloy = 0;
      this.runTime = 0;
      this.finished = false;
      this.levelIndex = 0;
      this.levelTime = 0;
      this.levelKills = 0;
      this.bossSpawned = false;
      this.boss = null;
      this.speedLines = [];
      this.pausedByUser = false;

      this.player = {
        x: W / 2,
        y: H - 90,
        vx: 0,
        vy: 0,
        hp: 5,
        maxHp: 5,
        shield: 0,
        shieldMax: 0,
        power: 0,
        engine: 0,
        drones: 0,
        invuln: 1.2,
        fireCd: 0,
        droneCd: 0,
        lastHitAt: -99,
        tilt: 0,
        dashT: 0,
        dashCd: 0,
        dashDx: 0,
        dashDy: -1,
        hop: 0
      };

      this.bullets = [];
      this.bombs = [];
      this.slowT = 0;
      this.weapon = NA.weapons.get(NA.wallet.load().weapon);
      this.skills = {
        bomb:  { cd: 0, max: 8,  key: "J" },
        storm: { cd: 0, max: 15, key: "K" },
        slow:  { cd: 0, max: 17, key: "L" },
        bell:  { cd: 0, max: 16, key: "I" },
        dash:  { cd: 0, max: 2.4, key: "Shift" }
      };
      this.magnetT = 0;   // 秋收铃：吸秋果的剩余时间
      this.fireBoostT = 0; // 热可可：火力爆发剩余时间
      this.ebullets = [];
      this.enemies = [];
      this.pickups = [];
      this.particles = [];
      this.floats = [];
      this.spawnTimer = 1.4;
      this.shake = 0;
      this.hitFlash = 0;
      this.banner = null;
      this.stars = this.makeStars();
    }

    makeStars() {
      const layers = [
        { n: 45, speed: 22, size: 1.1, alpha: 0.5 },
        { n: 30, speed: 46, size: 1.6, alpha: 0.72 },
        { n: 16, speed: 86, size: 2.3, alpha: 1 }
      ];
      const out = [];
      layers.forEach((L, li) => {
        for (let i = 0; i < L.n; i++) {
          out.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: L.size * (0.7 + Math.random() * 0.7),
            v: L.speed * (0.85 + Math.random() * 0.4),
            a: L.alpha * (0.6 + Math.random() * 0.4),
            len: li === 2 ? 10 + Math.random() * 14 : 0
          });
        }
      });
      return out;
    }

    start() {
      this.resetRun();
      this.state = "playing";
      this.time = 0;
      this.weapon = NA.weapons.get(NA.wallet.load().weapon);
      this.player.dashT = 0;
      this.player.dashCd = 0;
      this.emitState();
      this.beginLevel(0);
      NA.sound.resume();
    }

    beginLevel(index) {
      const cfg = this.cfg.levels[Math.min(index, this.cfg.levels.length - 1)];
      this.levelIndex = index;
      this.levelTime = 0;
      this.levelKills = 0;
      this.bossSpawned = false;
      this.spawnTimer = 1.1;
      this.banner = { text: "LEVEL " + (index + 1) + " · " + cfg.name, sub: cfg.boss ? "打掉那辆南瓜车" : "撑过这一关", t: 2.6 };
      this.emitHud();
      if (cfg.boss) NA.sound.bossWarn();
    }

    pause() {
      if (this.state !== "playing") return;
      this.pausedByUser = true;
      this.state = "paused";
      this.emitState();
    }

    resume() {
      if (this.state !== "paused") return;
      this.pausedByUser = false;
      this.state = "playing";
      this.last = performance.now();
      this.emitState();
    }

    setDifficulty(key) {
      this.diffKey = key in DIFF ? key : "normal";
      this.diff = DIFF[this.diffKey];
    }

    surrender() {
      if (this.state !== "playing" && this.state !== "paused") return;
      this.player.shield = 0;
      this.player.invuln = 0;
      this.player.hp = 0;
      this.gameOver();
    }

    togglePause() {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    }

    restart() {
      this.start();
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      window.removeEventListener("resize", this.boundResize);
    }

    /* ---------------- 状态回调 ---------------- */
    emitState() {
      if (this.opt.onState) this.opt.onState(this.state, this.snapshot());
    }
    emitHud() {
      if (this.opt.onHud) this.opt.onHud(this.snapshot());
    }
    snapshot() {
      const cfg = this.cfg.levels[Math.min(this.levelIndex, this.cfg.levels.length - 1)];
      const p = this.player;
      return {
        state: this.state,
        score: Math.floor(this.score),
        kills: this.kills,
        alloy: this.alloy,
        hp: Math.max(0, Math.ceil(p.hp)),
        maxHp: p.maxHp,
        shield: Math.ceil(p.shield),
        shieldMax: p.shieldMax,
        power: p.power,
        engine: p.engine,
        drones: p.drones,
        level: this.levelIndex + 1,
        levelName: cfg.name,
        levelTime: this.levelTime,
        levelDur: cfg.boss ? null : LEVEL_DURATION,
        runTime: this.runTime,
        boss: this.boss ? { hp: Math.max(0, this.boss.hp), maxHp: this.boss.maxHp } : null,
        difficulty: this.diff.label
      };
    }

    /* ---------------- 主循环 ---------------- */
    startLoop() {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }

    loop(t) {
      const dt = Math.min((t - this.last) / 1000, 0.05);
      this.last = t;
      this.time += dt;

      if (this.state === "playing") this.update(dt);
      this.render(dt);
      this.raf = requestAnimationFrame(this.loop);
    }

    /* ---------------- 更新 ---------------- */
    update(dt) {
      const cfg = this.cfg.levels[Math.min(this.levelIndex, this.cfg.levels.length - 1)];
      const p = this.player;
      const diff = this.diff;

      this.runTime += dt;
      this.levelTime += dt;

      // 关卡推进
      if (cfg.boss) {
        if (!this.bossSpawned && this.levelTime >= BOSS_AT) this.spawnBoss();
      } else if (this.levelTime >= LEVEL_DURATION && !this.finished) {
        this.clearStage();
        return;
      }

      // 技能冷却 / 减速
      Object.keys(this.skills).forEach((k) => {
        const s = this.skills[k];
        s.cd = Math.max(0, s.cd - dt);
      });
      this.slowT = Math.max(0, this.slowT - dt);
      this.magnetT = Math.max(0, this.magnetT - dt);
      this.fireBoostT = Math.max(0, this.fireBoostT - dt);
      this.updateBombs(dt);

      // 计时器
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.shake = Math.max(0, this.shake - dt * 22);
      p.invuln = Math.max(0, p.invuln - dt);

      // 玩家移动
      const speed = PLAYER_BASE_SPEED * (1 + 0.18 * p.engine);
      let ax = 0, ay = 0;
      const K = NA.keys ? NA.keys.get() : { up: "w", down: "s", left: "a", right: "d" };
      const hold = (v) => !!v && NA.input.isDown(v, v.toUpperCase ? v.toUpperCase() : v);
      if (NA.input.isDown("ArrowLeft") || hold(K.left)) ax -= 1;
      if (NA.input.isDown("ArrowRight") || hold(K.right)) ax += 1;
      if (NA.input.isDown("ArrowUp") || hold(K.up)) ay -= 1;
      if (NA.input.isDown("ArrowDown") || hold(K.down)) ay += 1;
      if (ax || ay) { this.dashDir = { x: ax, y: ay }; }

      const ptr = NA.input.pointer;
      p.dashCd = Math.max(0, p.dashCd - dt);
      if (this.skills && this.skills.dash) this.skills.dash.cd = p.dashCd;
      if (p.dashT > 0) {
        p.dashT -= dt;
        p.x += p.dashDx * 560 * dt;
        p.y += p.dashDy * 560 * dt;
        p.tilt = (p.dashDx || 0) * 1.1;
        this.particles.push({
          x: p.x + U.rand(-6, 6), y: p.y + U.rand(-4, 10),
          vx: -p.dashDx * 40, vy: -p.dashDy * 40 + 30,
          life: 0.3, maxLife: 0.3, color: "#e8c98a", size: 3.2
        });
      } else if (ptr.active && ptr.down) {
        const tx = U.clamp(ptr.x, 24, W - 24);
        const ty = U.clamp(ptr.y, 40, H - 30);
        p.x += (tx - p.x) * Math.min(1, dt * 18);
        p.y += (ty - p.y) * Math.min(1, dt * 18);
        p.tilt = U.clamp((tx - p.x) * 0.06, -1, 1);
      } else if (ax || ay) {
        const len = Math.hypot(ax, ay) || 1;
        p.x += (ax / len) * speed * dt;
        p.y += (ay / len) * speed * dt;
        p.tilt = (ax / len) * 0.9;
      } else {
        p.tilt *= 0.86;
      }
      p.x = U.clamp(p.x, 22, W - 22);
      p.y = U.clamp(p.y, 60, H - 28);

      // 护盾再生
      if (p.shieldMax > 0 && p.shield < p.shieldMax && this.runTime - p.lastHitAt > 8) {
        p.shield = Math.min(p.shieldMax, p.shield + dt * 0.22);
      }

      // 起跳回弹
      p.hop = Math.max(0, p.hop - dt * 3.4);

      // 开火
      p.fireCd -= dt;
      if (p.fireCd <= 0) {
        this.playerFire();
        const wcd = this.weapon ? this.weapon.cdMul : 1;
        const boostCd = this.fireBoostT > 0 ? 0.68 : 1;
        p.fireCd = Math.max(0.045, (0.155 - p.power * 0.012) * wcd * boostCd);
      }

      // 布偶
      if (p.drones > 0) {
        p.droneCd -= dt;
        if (p.droneCd <= 0) {
          this.droneFire();
          p.droneCd = 0.34;
        }
      }

      // 敌机生成
      if (!this.finished) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnWave(cfg);
          const base = cfg.spawn * diff.spawnMul;
          this.spawnTimer = base * U.rand(0.78, 1.22);
        }
      }

      this.updateBullets(dt);
      this.updateEnemies(dt, cfg);
      this.updatePickups(dt);
      this.updateParticles(dt);
      this.updateStars(dt);

      if (this.banner) {
        this.banner.t -= dt;
        if (this.banner.t <= 0) this.banner = null;
      }

      // 状态轮询（给 UI 用）
      this.hudThrottle = (this.hudThrottle || 0) + dt;
      if (this.hudThrottle > 0.1) {
        this.hudThrottle = 0;
        this.emitHud();
      }
    }

    updateStars(dt) {
      this.stars.forEach((s) => {
        s.y += s.v * dt * (0.3 + this.player.engine * 0.06);
        if (s.y > H + 6) {
          s.y = -10;
          s.x = Math.random() * W;
        }
      });

      if (!this.cloudsArr) {
        this.cloudsArr = [];
        for (let i = 0; i < 7; i++) {
          this.cloudsArr.push({
            x: Math.random() * (W + 80) - 40,
            y: Math.random() * H,
            s: 0.55 + Math.random() * 0.8,
            v: 15 + Math.random() * 15,
            a: 0.34 + Math.random() * 0.3
          });
        }
      }
      this.cloudsArr.forEach((c) => {
        c.y += c.v * dt * (0.7 + this.player.engine * 0.05);
        if (c.y - 70 * c.s > H) {
          c.y = -70 * c.s;
          c.x = Math.random() * (W + 80) - 40;
        }
      });
    }

    updateBombs(dt) {
      for (let i = this.bombs.length - 1; i >= 0; i--) {
        const b = this.bombs[i];
        b.t += dt;
        b.x += (b.vx || 0) * dt;
        b.y += b.vy * dt;
        b.spin = (b.spin || 0) + dt * 7;

        let boom = b.t >= b.fuse;
        if (!boom) {
          for (const e of this.enemies) {
            if (circleRect(b.x, b.y, 13, e)) { boom = true; break; }
          }
          if (this.boss && circleRect(b.x, b.y, 13, {
            x: this.boss.x - this.boss.w / 2, y: this.boss.y - this.boss.h / 2,
            w: this.boss.w, h: this.boss.h
          })) boom = true;
        }
        if (b.y < -40) { this.bombs.splice(i, 1); continue; }
        if (boom) {
          this.pageSplash(b.x, b.y, b.r, b.dmg, null);
          this.sparks(b.x, b.y, 10, "#f6c96a");
          this.shake = Math.max(this.shake, 7);
          NA.sound.boom();
          this.bombs.splice(i, 1);
        }
      }
    }

    tryDash() {
      const p = this.player;
      if (this.state !== "playing" || this.finished) return false;
      if (p.dashCd > 0 || p.dashT > 0) return false;
      const d = this.dashDir || { x: 0, y: -1 };
      let dx = d.x, dy = d.y;
      const len = Math.hypot(dx, dy);
      if (!len) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      p.dashT = 0.26;
      p.dashCd = 2.4;
      p.dashDx = dx;
      p.dashDy = dy;
      p.invuln = Math.max(p.invuln, 0.5);
      this.shake = Math.max(this.shake, 2);
      NA.sound.dash();
      return true;
    }

    useSkill(key) {
      if (this.state !== "playing" || this.finished) return false;
      const s = this.skills && this.skills[key];
      if (!s || s.cd > 0) return false;
      const p = this.player;
      if (key === "bomb") {
        this.bombs.push({ x: p.x, y: p.y - 16, vx: 0, vy: -320, t: 0, fuse: 0.55, r: 84, dmg: 7, spin: 0 });
        s.cd = s.max;
        NA.sound.skillBomb();
      } else if (key === "storm") {
        this.ebullets.length = 0;
        this.enemies.slice().forEach((e) => this.damageEnemy(e, 2.6, e.x, e.y));
        if (this.boss) this.damageEnemy(this.boss, 3.2, this.boss.x, this.boss.y);
        for (let i = 0; i < 24; i++) {
          this.particles.push({
            x: U.rand(6, W - 6), y: U.rand(-40, H * 0.5),
            vx: U.rand(-40, 40), vy: U.rand(160, 300),
            life: 1.1, maxLife: 1.1, color: "#fffaf0", size: 3.4
          });
        }
        this.shake = Math.max(this.shake, 6);
        NA.sound.skillStorm();
        s.cd = s.max;
      } else if (key === "slow") {
        this.slowT = 4.2;
        NA.sound.skillSlow();
        s.cd = s.max;
      } else if (key === "bell") {
        // 秋收铃：满屏秋果飞向自己 + 短时间大范围拾取 + 回一格血
        this.magnetT = 5;
        p.hp = Math.min(p.maxHp, p.hp + 1);
        this.float(p.x, p.y - 34, "丰收 + 回血", "#e8b45f");
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          this.particles.push({
            x: p.x + Math.cos(a) * 34, y: p.y + Math.sin(a) * 34,
            vx: Math.cos(a) * 210, vy: Math.sin(a) * 210,
            life: 0.7, maxLife: 0.7, color: "#e8b45f", size: 3.2
          });
        }
        this.shake = Math.max(this.shake, 4);
        NA.sound.skillBell();
        s.cd = s.max;
      } else if (key === "dash") {
        if (!this.tryDash()) return false;
        s.cd = s.max;
      }
      return true;
    }

    pageSplash(x, y, radius, dmg, except) {
      this.particles.push({ x, y, size: radius / 2.2, ring: true, color: "#e8b45f", life: 0.3, maxLife: 0.3 });
      this.sparks(x, y, 5, "#fffaf0");
      this.enemies.forEach((e) => {
        if (e === except) return;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d > radius) return;
        const k = 1 - d / (radius + 26);
        this.damageEnemy(e, Math.max(0.4, dmg * 0.62 * k), e.x, e.y);
      });
      const bb = this.boss;
      if (bb && bb !== except) {
        const d = Math.hypot(bb.x - x, bb.y - y);
        if (d < radius + bb.w * 0.35) this.damageEnemy(bb, dmg * 0.5, x, y);
      }
    }

    updateBullets(dt) {
      const pb = this.bullets;
      for (let i = pb.length - 1; i >= 0; i--) {
        const b = pb[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y < -20 || b.x < -20 || b.x > W + 20) { pb.splice(i, 1); continue; }

        let consumed = false;
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          if (!circleRect(b.x, b.y, b.r, e)) continue;
          if (b.hits && b.hits.indexOf(e) >= 0) continue;
          this.damageEnemy(e, b.dmg, b.x, b.y);
          if (b.aoe) this.pageSplash(b.x, b.y, b.aoe, b.dmg, e);
          if (b.pierce) { if (!b.hits) b.hits = []; b.hits.push(e); continue; }
          pb.splice(i, 1);
          consumed = true;
          break;
        }
        if (!consumed && this.boss) {
          const bb = this.boss;
          if (circleRect(b.x, b.y, b.r, { x: bb.x - bb.w / 2, y: bb.y - bb.h / 2, w: bb.w, h: bb.h })) {
            this.damageEnemy(bb, b.dmg, b.x, b.y);
            if (b.aoe) this.pageSplash(b.x, b.y, b.aoe, b.dmg, bb);
            pb.splice(i, 1);
          }
        }
      }

      const eb = this.ebullets;
      const p = this.player;
      const edt = this.slowT > 0 ? dt * 0.5 : dt;
      for (let i = eb.length - 1; i >= 0; i--) {
        const b = eb[i];
        b.x += b.vx * edt;
        b.y += b.vy * edt;
        if (b.y > H + 24 || b.y < -40 || b.x < -30 || b.x > W + 30) { eb.splice(i, 1); continue; }
        if (p.invuln <= 0 && U.dist2(b.x, b.y, p.x, p.y) < (PLAYER_R + b.r) * (PLAYER_R + b.r)) {
          eb.splice(i, 1);
          this.hurtPlayer(b.dmg);
        }
      }
    }

    updateEnemies(dt, cfg) {
      const p = this.player;
      const sdt = this.slowT > 0 ? dt * 0.4 : dt;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.t += sdt;
        e.hurt = Math.max(0, e.hurt - dt);

        if (e.type === "zigzag") {
          e.y += e.vy * sdt;
          e.x = e.x0 + Math.sin(e.t * 2.2 + e.phase) * 78;
        } else if (e.type === "gunner") {
          if (e.y < e.stopY) e.y += e.vy * sdt;
          else e.x += e.vx * sdt;
          if (e.x < 40 || e.x > W - 40) e.vx *= -1;
          e.fireCd -= dt;
          if (e.fireCd <= 0 && e.y >= e.stopY) {
            e.fireCd = U.rand(1.0, 1.5);
            e.shots = 3; e.spread = 0.16;
            this.enemyFireAt(e, p);
          }
        } else if (e.type === "crow") {
          e.y += e.vy * sdt * (1 + Math.min(e.t, 1.2) * 0.7);
          e.x += (p.x - e.x) * Math.min(1, sdt * 2.2);
          e.tilt = Math.sin(e.t * 8) * 0.2;
        } else if (e.type === "scarecrow") {
          if (e.y < e.stopY) e.y += e.vy * sdt;
          else e.x += e.vx * 0.7 * sdt;
          if (e.x < 50 || e.x > W - 50) e.vx *= -1;
          e.fireCd -= dt;
          if (e.fireCd <= 0 && e.y >= e.stopY) {
            e.shots = 5; e.spread = 0.17;
            this.enemyFireAt(e, p);
            e.shots = 3; e.spread = 0.14;
            e.fireCd = U.rand(1.5, 2.0);
            NA.sound.enemyShot();
          }
        } else if (e.type === "tank") {
          e.y += e.vy * sdt;
          e.tilt = Math.sin(e.t * 1.4) * 0.15;
          e.fireCd -= dt;
          if (e.fireCd <= 0) {
            e.fireCd = U.rand(1.9, 2.6);
            e.shots = 3; e.spread = 0.1;
            this.enemyFireAt(e, p);
          }
        } else if (e.type === "squirrel") {
          // 松鼠：抱着松果快速左右窜，走位难抓
          e.y += e.vy * sdt;
          e.x = e.x0 + Math.sin(e.t * 3.1 + e.phase) * 92;
          e.tilt = Math.cos(e.t * 3.1 + e.phase) * 0.22;
        } else if (e.type === "chestnut") {
          // 刺栗：慢悠悠下落，被击碎时炸一圈弹
          e.y += e.vy * sdt;
          e.tilt = Math.sin(e.t * 1.6 + e.phase) * 0.16;
        } else {
          e.y += e.vy * sdt;
        }

        if (e.y > H + 60) { this.enemies.splice(i, 1); continue; }

        // 撞机
        if (p.invuln <= 0 && circleRect(p.x, p.y, PLAYER_R, e)) {
          this.damageEnemy(e, 6, e.x, e.y + e.h / 2);
          this.hurtPlayer(1);
        }
      }

      // Boss
      if (this.boss) {
        const b = this.boss;
        b.t += dt;
        b.y = 120 + Math.sin(b.t * 0.7) * 26;
        b.x = W / 2 + Math.sin(b.t * 0.45) * (W / 2 - 120);
        b.hurt = Math.max(0, b.hurt - dt * 2.2);

        b.fireCd -= dt;
        if (b.fireCd <= 0) {
          b.fireCd = U.rand(1.5, 2.2);
          this.bossAimedVolley(b);
        }
        b.ringCd -= dt;
        if (b.ringCd <= 0) {
          b.ringCd = U.rand(4.5, 6);
          this.bossRing(b);
        }
        if (b.hp <= 0) this.killBoss();
      }
    }

    updatePickups(dt) {
      const p = this.player;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const k = this.pickups[i];
        k.y += k.vy * dt;
        k.t += dt;
        const grab = (this.magnetT > 0 ? 260 : 60) + p.engine * 12;
        if (U.dist2(k.x, k.y, p.x, p.y) < grab * grab) {
          const ang = Math.atan2(p.y - k.y, p.x - k.x);
          k.x += Math.cos(ang) * 320 * dt;
          k.y += Math.sin(ang) * 320 * dt;
        }
        if (U.dist2(k.x, k.y, p.x, p.y) < 26 * 26) {
          this.applyPickup(k.type);
          this.pickups.splice(i, 1);
          continue;
        }
        if (k.y > H + 30) this.pickups.splice(i, 1);
      }
    }

    updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const q = this.particles[i];
        q.life -= dt;
        if (q.life <= 0) { this.particles.splice(i, 1); continue; }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= q.drag || 0.94;
        q.vy *= q.drag || 0.94;
      }
      for (let i = this.floats.length - 1; i >= 0; i--) {
        const f = this.floats[i];
        f.life -= dt;
        f.y -= 34 * dt;
        if (f.life <= 0) this.floats.splice(i, 1);
      }
    }

    /* ---------------- 生成 ---------------- */
    spawnWave(cfg) {
      const lv = this.levelIndex;
      const choices = [];
      choices.push({ type: "grunt", w: 5 });
      choices.push({ type: "grunt", w: 5 - lv * 0.4 });
      if (lv >= 1) choices.push({ type: "zigzag", w: 2.2 + lv * 0.5 });
      if (lv >= 2) choices.push({ type: "gunner", w: 1.9 + lv * 0.45 });
      if (lv >= 2) choices.push({ type: "crow", w: 1.5 + lv * 0.4 });
      if (lv >= 3) choices.push({ type: "tank", w: 0.95 + lv * 0.2 });
      if (lv >= 3) choices.push({ type: "scarecrow", w: 0.8 + lv * 0.25 });
      if (lv >= 2) choices.push({ type: "squirrel", w: 1.1 + lv * 0.3 });
      if (lv >= 3) choices.push({ type: "chestnut", w: 0.7 + lv * 0.22 });

      const total = choices.reduce((s, c) => s + Math.max(0.2, c.w), 0);
      let r = Math.random() * total;
      let picked = choices[0].type;
      for (const c of choices) {
        r -= Math.max(0.2, c.w);
        if (r <= 0) { picked = c.type; break; }
      }

      const count = picked === "tank" ? 1 : U.randInt(1, this.diffKey === "hard" ? 3 : 2);
      for (let i = 0; i < count; i++) {
        const x = U.rand(38, W - 38);
        this.spawnEnemy(picked, x, -40 - i * 46, cfg);
      }
    }

    spawnEnemy(type, x, y, cfg) {
      const hpMul = (cfg ? cfg.hpMul : 1) * this.diff.hpMul;
      const base = {
        grunt: { hp: 2.6, w: 30, h: 26, vy: 118, score: 24, alloy: 7 },
        zigzag: { hp: 2.2, w: 26, h: 26, vy: 96, score: 32, alloy: 9 },
        gunner: { hp: 7, w: 34, h: 30, vy: 62, score: 72, alloy: 18 },
        tank: { hp: 18, w: 46, h: 40, vy: 52, score: 160, alloy: 36 },
        crow: { hp: 3.4, w: 34, h: 26, vy: 148, score: 46, alloy: 11 },
        scarecrow: { hp: 13, w: 42, h: 42, vy: 56, score: 108, alloy: 26 },
        squirrel: { hp: 4.6, w: 34, h: 28, vy: 132, score: 58, alloy: 20 },
        chestnut: { hp: 10, w: 36, h: 34, vy: 74, score: 92, alloy: 24 }
      }[type];

      const e = {
        type,
        x, y,
        x0: x,
        phase: Math.random() * Math.PI * 2,
        vx: Math.random() < 0.5 ? -58 : 58,
        vy: base.vy * U.rand(0.92, 1.1),
        stopY: U.rand(150, 240),
        w: base.w,
        h: base.h,
        maxHp: base.hp * hpMul,
        hp: base.hp * hpMul,
        score: base.score,
        alloy: base.alloy,
        fireCd: U.rand(0.9, 1.8),
        t: 0,
        hurt: 0,
        tilt: 0
      };
      this.enemies.push(e);
    }

    spawnBoss() {
      this.bossSpawned = true;
      const hp = 520 * (this.cfg.levels[4].hpMul || 1) * this.diff.hpMul;
      this.boss = {
        type: "boss",
        x: W / 2, y: 130, w: 210, h: 96,
        hp, maxHp: hp,
        t: 0, hurt: 0,
        score: 1200, alloy: 260,
        fireCd: 1.4, ringCd: 5
      };
      this.banner = { text: "南瓜车来了", sub: "盯着瓜芯打，别让弹幕把你堵死", t: 3.2 };
      NA.sound.bossWarn();
      this.shake = 12;
      this.emitHud();
    }

    /* ---------------- 开火 ---------------- */
    playerFire() {
      const p = this.player;
      const w = this.weapon || NA.weapons.get("page");
      const dmg = 1 * (1 + 0.12 * p.power) * w.dmgMul;
      const boost = this.fireBoostT > 0 ? 2 : 0;
      const count = Math.max(1, Math.min(3 + Math.floor(p.power * 1.1), 7) + w.countAdd + boost);
      const halfArc = (0.12 + 0.075 * p.power) * w.arcMul;   // 升级越宽
      const aoe = w.aoeMul > 0 ? (20 + p.power * 11) * w.aoeMul : 0;
      const baseSpeed = BULLET_SPEED * w.speedMul;
      for (let i = 0; i < count; i++) {
        const k = count === 1 ? 0 : i / (count - 1) - 0.5;
        const ang = k * halfArc * 2;
        const sp = baseSpeed * (0.94 + Math.abs(k) * 0.1);
        this.pushBullet(
          p.x + Math.sin(ang) * 18,
          p.y - 10 - Math.cos(ang) * 6,
          Math.sin(ang) * sp,
          -Math.cos(ang) * sp,
          dmg,
          w.kind === "ink" ? 7.4 : 5.0,
          aoe,
          w.kind,
          w.pierce
        );
      }
      p.hop = 0.34;
      NA.sound.shot();
    }

    droneFire() {
      const p = this.player;
      const n = p.drones;
      for (let i = 0; i < n; i++) {
        const side = i === 0 ? -1 : 1;
        this.pushBullet(p.x + side * (26 + i * 6), p.y + 6, side * 30, -BULLET_SPEED * 0.82, 0.8, 2);
      }
      NA.sound.shot();
    }

    pushBullet(x, y, vx, vy, dmg, r, aoe, kind, pierce) {
      this.bullets.push({
        x, y, vx, vy, dmg,
        r: r || 2.6,
        aoe: aoe || 0,
        kind: kind || "page",
        pierce: !!pierce,
        hits: [],
        spin: Math.random() * Math.PI * 2
      });
    }

    chestnutBurst(e) {
      // 刺栗碎裂：向四周撒一圈短命弹幕，逼玩家别贴太近扫射
      const n = 10;
      const base = (e.t || 0) * 0.8;
      for (let i = 0; i < n; i++) {
        const a = base + (i / n) * Math.PI * 2;
        const sp = 148 * (this.diff.eSpeed || 1);
        this.ebullets.push({
          x: e.x, y: e.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          r: 4, dmg: 1
        });
      }
      this.sparks(e.x, e.y, 9, "#b98244");
      this.shake = Math.max(this.shake, 3);
      NA.sound.burst();
    }

    enemyFireAt(e, p) {
      if (e.y > 0) NA.sound.enemyShot();
      const n = e.shots || 3;
      const spread = e.spread || 0.14;
      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      const mid = (n - 1) / 2;
      for (let i = 0; i < n; i++) {
        const a = ang + (i - mid) * spread;
        this.ebullets.push({
          x: e.x, y: e.y + e.h / 2,
          vx: Math.cos(a) * EBULLET_SPEED * (this.diff.eSpeed || 1),
          vy: Math.sin(a) * EBULLET_SPEED * (this.diff.eSpeed || 1),
          r: 4.2, dmg: 1
        });
      }
    }

    bossAimedVolley(b) {
      const p = this.player;
      const ang = Math.atan2(p.y - b.y, p.x - b.x);
      for (let i = -2; i <= 2; i++) {
        const a = ang + i * 0.11;
        this.ebullets.push({
          x: b.x, y: b.y + b.h / 2 - 10,
          vx: Math.cos(a) * (EBULLET_SPEED + 40) * (this.diff.eSpeed || 1),
          vy: Math.sin(a) * (EBULLET_SPEED + 40) * (this.diff.eSpeed || 1),
          r: 4.6, dmg: 1
        });
      }
      this.shake = Math.max(this.shake, 3);
    }

    bossRing(b) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.t * 0.6;
        this.ebullets.push({
          x: b.x, y: b.y + 6,
          vx: Math.cos(a) * 160,
          vy: Math.sin(a) * 160,
          r: 4.4, dmg: 1
        });
      }
      this.ebullets.push({ x: b.x - 60, y: b.y + 10, vx: 0, vy: EBULLET_SPEED, r: 6, dmg: 2 });
      this.ebullets.push({ x: b.x + 60, y: b.y + 10, vx: 0, vy: EBULLET_SPEED, r: 6, dmg: 2 });
      this.shake = 6;
      NA.sound.boom();
    }

    /* ---------------- 伤害与结算 ---------------- */
    damageEnemy(e, dmg, hx, hy) {
      e.hp -= dmg;
      e.hurt = 0.12;
      this.sparks(hx, hy, 4, "#e9b95c");
      if (e.hp <= 0) {
        const isBoss = !!e.maxHp && e.maxHp > 300;
        this.explode(e.x, e.y, isBoss ? 46 : e.type === "tank" ? 26 : 16);
        NA.sound.boom();
        if (e.type === "chestnut" && !isBoss && this.state === "playing") this.chestnutBurst(e);
        this.score += e.score * this.diff.scoreMul;
        this.alloy += e.alloy;
        this.kills++;
        this.levelKills++;
        this.floats.push({ x: e.x, y: e.y, text: "+" + e.score, life: 0.7, color: "#4a3018" });
        if (!isBoss) this.maybeDrop(e);
        const idx = this.enemies.indexOf(e);
        if (idx >= 0) this.enemies.splice(idx, 1);
        this.shake = Math.max(this.shake, isBoss ? 20 : 4);
      }
    }

    hurtPlayer(dmg) {
      const p = this.player;
      if (p.invuln > 0) return;
      p.lastHitAt = this.runTime;
      if (p.shield >= 1) {
        p.shield -= 1;
        p.invuln = 0.5;
        this.shieldBurst(p.x, p.y);
        NA.sound.shieldBreak();
        this.shake = Math.max(this.shake, 4);
        this.emitHud();
        return;
      }
      p.hp -= dmg * this.diff.dmgMul;
      p.invuln = 1.05;
      this.hitFlash = 0.4;
      this.shake = 8;
      this.explode(p.x, p.y, 14);
      NA.sound.hurt();
      this.emitHud();
      if (p.hp <= 0) this.gameOver();
    }

    shieldBurst(x, y) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.particles.push({
          x, y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
          life: 0.35, maxLife: 0.35, color: "#8fc9e4", size: 3, drag: 0.9
        });
      }
    }

    maybeDrop(e) {
      let chance = e.type === "tank" ? 0.75 : e.type === "chestnut" ? 0.8 : e.type === "squirrel" ? 0.55 : e.type === "gunner" ? 0.45 : 0.12;
      if (Math.random() > chance) return;
      const p = this.player;
      const table = [];
      table.push({ t: "alloy", w: 3 });
      table.push({ t: "cocoa", w: 1.1 });
      if (p.power < 5) table.push({ t: "power", w: 2.4 });
      if (p.shieldMax > 0 && p.shield < p.shieldMax) table.push({ t: "shield", w: 1.6 });
      if (p.hp < p.maxHp) table.push({ t: "heal", w: 1.4 });
      const sum = table.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * sum, type = "alloy";
      for (const c of table) { r -= c.w; if (r <= 0) { type = c.t; break; } }
      this.pickups.push({ x: e.x, y: e.y, vy: 58, type, t: 0 });
    }

    applyPickup(type) {
      const p = this.player;
      if (type === "power") {
        p.power = Math.min(5, p.power + 1);
        this.float(p.x, p.y - 30, "POWER " + p.power, "#7fd4f2");
      } else if (type === "shield") {
        p.shield = Math.min(p.shieldMax || 3, p.shield + 1);
        this.float(p.x, p.y - 30, "盾 +1", "#e6b45c");
      } else if (type === "heal") {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        this.float(p.x, p.y - 30, "血 +1", "#f08a3c");
      } else if (type === "cocoa") {
        this.fireBoostT = 8;
        NA.sound.cocoa();
        this.float(p.x, p.y - 30, "火力爆发！", "#c0701f");
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.particles.push({
            x: p.x, y: p.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130,
            life: 0.5, maxLife: 0.5, color: "#c0701f", size: 2.6
          });
        }
      } else {
        this.alloy += 12;
        this.float(p.x, p.y - 30, "秋果 +12", "#e9b95c");
      }
      NA.sound.pickup();
      this.emitHud();
    }

    float(x, y, text, color) {
      this.floats.push({ x, y, text, life: 0.9, color: color || "#fff" });
    }

    sparks(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = U.rand(40, 180);
        this.particles.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: U.rand(0.14, 0.3), maxLife: 0.3, color, size: U.rand(1, 2.6), drag: 0.92
        });
      }
    }

    explode(x, y, size) {
      for (let i = 0; i < Math.floor(size * 0.9); i++) {
        const a = Math.random() * Math.PI * 2;
        const s = U.rand(size, size * 4.2);
        this.particles.push({
          x, y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: U.rand(0.2, 0.6), maxLife: 0.6,
          color: U.pick(["#fdf4df", "#fbf1da", "#e3ad66", "#c0623a"]),
          size: U.rand(1.6, 4.4), drag: 0.9
        });
      }
      this.particles.push({
        x, y, vx: 0, vy: 0, life: 0.28, maxLife: 0.28,
        color: "#ffffff", size: size * 1.3, ring: true, drag: 1
      });
    }

    clearStage() {
      const cfg = this.cfg.levels[this.levelIndex];
      this.enemies.length = 0;
      this.ebullets.length = 0;
      this.pickups.length = 0;
      this.bullets.length = 0;
      this.state = "upgrade";
      this.emitHud();
      NA.sound.levelUp();
      if (this.opt.onUpgrade) {
        this.opt.onUpgrade({
          level: this.levelIndex + 1,
          next: this.cfg.levels[this.levelIndex + 1] || null,
          alloy: this.alloy,
          player: this.player,
          upgrades: this.cfg.upgrades,
          levels: this.cfg.levels,
          buy: (id) => this.buyUpgrade(id),
          proceed: () => this.nextLevel()
        });
      }
      this.emitState();
    }

    buyUpgrade(id) {
      const def = this.cfg.upgrades.find((u) => u.id === id);
      if (!def) return { ok: false, msg: "未知升级" };
      const p = this.player;
      const curMap = { power: p.power, shield: p.shieldMax, engine: p.engine, drone: p.drones };
      const cur = curMap[id] || 0;
      if (cur >= def.max) return { ok: false, msg: "已满级" };
      const cost = def.base + def.step * cur;
      if (this.alloy < cost) return { ok: false, msg: "秋果不足" };

      this.alloy -= cost;
      if (id === "power") p.power = Math.min(5, p.power + 1);
      if (id === "shield") { p.shieldMax = Math.min(4, p.shieldMax + 1); p.shield = p.shieldMax; }
      if (id === "engine") p.engine = Math.min(4, p.engine + 1);
      if (id === "drone") p.drones = Math.min(2, p.drones + 1);
      NA.sound.upgrade();
      this.emitHud();
      return { ok: true, alloy: this.alloy };
    }

    nextLevel() {
      const next = this.levelIndex + 1;
      if (next >= this.cfg.levels.length) { this.win(); return; }
      this.state = "playing";
      this.last = performance.now();
      this.beginLevel(next);
      this.emitState();
    }

    gameOver() {
      if (this.state === "gameover" || this.finished) return;
      this.finished = true;
      this.state = "gameover";
      const p = this.player;
      this.explode(p.x, p.y, 34);
      this.floats.length = 0;
      NA.sound.lose();
      const result = {
        win: false,
        score: Math.floor(this.score),
        kills: this.kills,
        level: this.levelIndex + 1,
        time: Math.floor(this.runTime * 1000),
        difficulty: this.diff.label,
        diffKey: this.diffKey,
        date: Date.now()
      };
      if (this.opt.onFinish) this.opt.onFinish(result);
      this.emitState();
    }

    win() {
      if (this.finished) return;
      this.finished = true;
      this.state = "win";
      this.score += 500;
      NA.sound.win();
      const result = {
        win: true,
        score: Math.floor(this.score),
        kills: this.kills,
        level: this.levelIndex + 1,
        time: Math.floor(this.runTime * 1000),
        difficulty: this.diff.label,
        diffKey: this.diffKey,
        date: Date.now()
      };
      if (this.opt.onFinish) this.opt.onFinish(result);
      this.emitState();
    }

    killBoss() {
      if (this.finished) return;
      this.explode(this.boss.x, this.boss.y, 60);
      this.boss = null;
      this.shake = 26;
      this.floats.push({ x: W / 2, y: 180, text: "南瓜车打掉了", life: 2, color: "#c0623a" });
      this.win();
    }

    /* ---------------- 渲染 ---------------- */
    render(dt) {
      const ctx = this.ctx;
      ctx.save();
      const sh = this.shake;
      if (sh > 0.2) ctx.translate(U.rand(-sh, sh) * 0.5, U.rand(-sh, sh) * 0.5);

      this.drawBackdrop(ctx);
      this.drawStars(ctx);
      this.drawPickups(ctx);
      this.drawEnemies(ctx);
      if (this.boss) this.drawBoss(ctx);
      this.drawBullets(ctx);
      this.drawBombs(ctx);
      this.drawPlayer(ctx);
      this.drawParticles(ctx);
      this.drawFloats(ctx);

      if (this.slowT > 0) {
        ctx.save();
        ctx.fillStyle = "rgba(96,66,34," + Math.min(0.16, this.slowT * 0.05) + ")";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      if (this.hitFlash > 0) {
        ctx.fillStyle = "rgba(229,84,60," + this.hitFlash * 0.55 + ")";
        ctx.fillRect(0, 0, W, H);
      }

      if (this.banner) this.drawBanner(ctx);
      if (this.state === "ready") this.drawIdle(ctx);

      ctx.restore();
    }

    drawBackdrop(ctx) {
      // 夏日晴空：天蓝到暖雾
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#a26636");
      g.addColorStop(0.28, "#cf9450");
      g.addColorStop(0.56, "#edc88e");
      g.addColorStop(0.82, "#f9e4bb");
      g.addColorStop(1, "#fdf2d8");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 右上角的日光
      const sun = ctx.createRadialGradient(W * 0.9, -30, 8, W * 0.9, -30, 430);
      sun.addColorStop(0, "rgba(255,246,214,0.96)");
      sun.addColorStop(0.4, "rgba(255,226,175,0.34)");
      sun.addColorStop(1, "rgba(255,226,175,0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, W, H);

      this.drawSkyline(ctx);
      this.drawClouds(ctx);
    }

    drawSkyline(ctx) {
      if (!this.skylineArr) {
        const arr = [];
        let x = -30;
        while (x < W + 60) {
          const w = 16 + Math.random() * 44;
          const h = 22 + Math.random() * 64;
          arr.push({ x, w, h, s: Math.random() });
          x += w + 3 + Math.random() * 8;
        }
        this.skylineArr = arr;
      }
      const base = H - 26;
      ctx.save();
      ctx.fillStyle = "rgba(86,58,35,0.3)";
      this.skylineArr.forEach((b) => {
        ctx.fillRect(b.x, base - b.h, b.w, b.h);
        if (b.s > 0.62) ctx.fillRect(b.x + b.w * 0.3, base - b.h - 9, b.w * 0.34, 9);
      });
      ctx.fillStyle = "rgba(251,238,212,0.44)";
      this.skylineArr.forEach((b) => {
        for (let k = 0; k < 4; k++) {
          if (b.s > k * 0.22) {
            ctx.fillRect(b.x + 4 + (k % 2) * 9, base - b.h + 7 + (k >> 1) * 10, 3, 3);
          }
        }
      });
      const haze = ctx.createLinearGradient(0, H - 84, 0, H);
      haze.addColorStop(0, "rgba(246,238,224,0)");
      haze.addColorStop(1, "rgba(246,238,224,0.92)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, H - 84, W, 84);
      ctx.restore();
    }

    drawClouds(ctx) {
      if (!this.cloudsArr) return;
      this.cloudsArr.forEach((c) => {
        const s = c.s;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(s, s);
        ctx.shadowColor = "rgba(150,110,66,0.3)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 5;
        ctx.beginPath();
        ctx.moveTo(-34, 7);
        ctx.quadraticCurveTo(-42, -4, -26, -8);
        ctx.quadraticCurveTo(-22, -22, -4, -17);
        ctx.quadraticCurveTo(8, -29, 22, -14);
        ctx.quadraticCurveTo(40, -9, 34, 7);
        ctx.quadraticCurveTo(2, 15, -34, 7);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,249,234," + c.a + ")";
        ctx.fill();
        ctx.restore();
      });
    }

    drawStars(ctx) {
      // 飘落的黄叶与光尘
      this.stars.forEach((s) => {
        if (s.len) {
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(this.time * 0.9 + s.x * 0.05);
          ctx.fillStyle = "rgba(228,168,80," + (s.a * 0.55) + ")";
          ctx.beginPath();
          ctx.ellipse(0, 0, s.r * 2.6, s.r * 1.1, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = "rgba(255,240,204," + (s.a * 0.3) + ")";
          ctx.fillRect(s.x, s.y, s.r * 0.8, s.r * 0.8);
        }
      });
    }

    drawBullets(ctx) {
      ctx.save();
      this.bullets.forEach((b) => {
        const ph = (b.spin || 0) + this.time * 7.2;
        const kind = b.kind || "page";
        ctx.save();
        ctx.translate(b.x, b.y);
        if (kind !== "page") {
          ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
          if (kind === "quill") {
            ctx.shadowColor = "rgba(120,80,40,0.5)";
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(0, -9);
            ctx.lineTo(2.6, -2.4);
            ctx.lineTo(0, 6.4);
            ctx.lineTo(-2.6, -2.4);
            ctx.closePath();
            ctx.fillStyle = "#f4ead4";
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(90,58,30,0.75)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.strokeStyle = "#6b4a28";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(0, 6.4); ctx.lineTo(0, 10.4);
            ctx.stroke();
          } else if (kind === "ink") {
            ctx.shadowColor = "rgba(70,48,26,0.55)";
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.roundRect(-6.4, -7.4, 12.8, 14.2, 4.2);
            ctx.fillStyle = "#4d3626";
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#7b5a3c";
            ctx.beginPath();
            ctx.roundRect(-4.6, -9.6, 9.2, 3.6, 1.6);
            ctx.fill();
            ctx.strokeStyle = "rgba(253,244,223,0.5)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(-6.4, -7.4, 12.8, 14.2, 4.2);
            ctx.stroke();
            ctx.fillStyle = "rgba(253,244,223,0.55)";
            ctx.beginPath();
            ctx.ellipse(-2.6, -1.2, 1.6, 2.6, -0.3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.rotate(Math.sin(ph) * 0.5);
            ctx.shadowColor = "rgba(191,90,44,0.5)";
            ctx.shadowBlur = 9;
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
              const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
              const a2 = a + Math.PI / 5;
              ctx.lineTo(Math.cos(a) * 8.4, Math.sin(a) * 8.4);
              ctx.lineTo(Math.cos(a2) * 3.6, Math.sin(a2) * 3.6);
            }
            ctx.closePath();
            ctx.fillStyle = "#cf7a35";
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(90,50,24,0.6)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.restore();
          return;
        }
        const flip = 0.42 + Math.abs(Math.cos(ph)) * 0.58;
        ctx.rotate(Math.sin(ph * 0.6) * 0.34);
        ctx.scale(flip * 1.3, (1 + Math.sin(ph * 1.4) * 0.05) * 1.3);
        ctx.shadowColor = "rgba(232,180,95,0.62)";
        ctx.shadowBlur = 11;
        // 纸页
        ctx.beginPath();
        ctx.moveTo(-5.8, -7.4);
        ctx.lineTo(5.8, -7.4);
        ctx.lineTo(5.8, 5.6);
        ctx.quadraticCurveTo(0, 9.6, -5.8, 6.4);
        ctx.closePath();
        ctx.fillStyle = "#fffaf0";
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(122,74,40,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        // 行字
        ctx.strokeStyle = "rgba(122,74,40,0.4)";
        ctx.lineWidth = 0.9;
        [-4.4, -1.8, 0.8].forEach((yy, k) => {
          ctx.beginPath();
          ctx.moveTo(-3.8, yy);
          ctx.lineTo(k === 2 ? 1.4 : 3.6, yy);
          ctx.stroke();
        });
        // 页角一点朱红
        ctx.fillStyle = "#bf5a2c";
        ctx.beginPath();
        ctx.moveTo(5.8, 5.6);
        ctx.lineTo(2.2, 6.2);
        ctx.lineTo(5.8, 1.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      ctx.restore();

      ctx.save();
      ctx.shadowColor = "rgba(191,90,44,0.5)";
      ctx.shadowBlur = 9;
      this.ebullets.forEach((b) => {
        ctx.fillStyle = "#c0623a";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(253,244,223,0.85)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      });
      ctx.restore();
    }

    drawBombs(ctx) {
      this.bombs.forEach((b) => {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = "#c0762f";
        ctx.setLineDash([5, 7]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin || 0);
        ctx.shadowColor = "rgba(200,110,40,0.55)";
        ctx.shadowBlur = 18;
        // 枫叶：五个叶齿，尖朝上
        const MAPLE = [
          [0, -18], [3.2, -9.5], [8.6, -13.4], [7.6, -4.6], [15, -4.2],
          [9, 1.2], [13.2, 8.2], [5, 6.2], [3.2, 13.4], [0, 9.4],
          [-3.2, 13.4], [-5, 6.2], [-13.2, 8.2], [-9, 1.2], [-15, -4.2],
          [-7.6, -4.6], [-8.6, -13.4], [-3.2, -9.5]
        ];
        ctx.beginPath();
        MAPLE.forEach(([mx, my], k) => { if (k === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my); });
        ctx.closePath();
        ctx.fillStyle = "#e8a63c";
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#a35c1e";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // 叶脉
        ctx.strokeStyle = "rgba(150,82,26,0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(0, 12);
        ctx.stroke();
        [[-7, -2], [7, -1], [-6, 5], [6, 5]].forEach(([vx, vy]) => {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(vx, vy);
          ctx.stroke();
        });
        // 叶柄
        ctx.strokeStyle = "#8a4a1b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 16);
        ctx.lineTo(2, 21);
        ctx.stroke();
        ctx.restore();
      });
    }

    drawPlayer(ctx) {
      const p = this.player;
      if (p.hp <= 0) return;
      const t = this.time;
      const hop = p.hop || 0;
      const bob = Math.sin(t * 3.1) * 2.2;

      ctx.save();
      ctx.translate(p.x, p.y + bob - hop * 7);
      ctx.rotate(p.tilt * 0.16 + Math.sin(t * 1.6) * 0.05);
      const sq = 1 + hop * 0.13;
      ctx.scale(sq, 2 - sq);

      const blink = p.invuln > 0 && Math.floor(t * 14) % 2 === 0;
      ctx.globalAlpha = blink ? 0.5 : 1;

      // 脚下松软的影子
      ctx.save();
      ctx.globalAlpha = (blink ? 0.16 : 0.24);
      ctx.fillStyle = "#5f402a";
      ctx.beginPath();
      ctx.ellipse(0, 26 + hop * 4, 19, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const img = this.girlImg;
      if (img && img.complete && img.naturalWidth) {
        const w0 = 56;
        const h0 = w0 * img.naturalHeight / img.naturalWidth;
        ctx.drawImage(img, -w0 / 2, -h0 * 0.6, w0, h0);
      } else {
        ctx.fillStyle = "#f7ddbd";
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // 开火时的一圈金粉
      if (hop > 0.12) {
        ctx.save();
        ctx.globalAlpha = hop * 1.6;
        ctx.strokeStyle = "rgba(232,180,95,0.55)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 6, 16 + (1 - hop) * 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 护罩：暖金虚线
      if (p.shield >= 0.5) {
        ctx.save();
        const a = 0.26 + Math.min(0.34, p.shield * 0.1);
        ctx.strokeStyle = "rgba(196,130,48," + a + ")";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        const r = 34 + Math.sin(this.time * 6) * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(240,190,110,0.1)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 布偶僚机
      for (let i = 0; i < p.drones; i++) {
        const side = i === 0 ? -1 : 1;
        const sway = Math.sin(this.time * 3 + i * 1.2) * 2.4;
        ctx.save();
        ctx.translate(p.x + side * (36 + i * 8), p.y + 14 + sway);
        ctx.fillStyle = "#d8b382";
        ctx.strokeStyle = "#6b4a2c";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(0, 0, 5.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-4.6, -3.4, 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(4.6, -3.4, 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#6b4a2c";
        ctx.beginPath(); ctx.arc(-1.9, -0.6, 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(1.9, -0.6, 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 1.4, 1.5, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.strokeStyle = "#6b4a2c";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
      }
    }

    drawEnemies(ctx) {
      this.enemies.forEach((e) => {
        ctx.save();
        ctx.translate(e.x, e.y);
        const hurt = e.hurt > 0;
        const INK = "#6b5647";
        ctx.shadowColor = "rgba(107,86,71,0.22)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;

        const face = (cx, cy, sc) => {
          // 眼睛
          ctx.fillStyle = INK;
          ctx.beginPath();
          ctx.arc(cx - 3.4 * sc, cy, 1.7 * sc, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + 3.4 * sc, cy, 1.7 * sc, 0, Math.PI * 2);
          ctx.fill();
          // 腮红
          ctx.fillStyle = "rgba(226,122,102,0.42)";
          ctx.beginPath();
          ctx.arc(cx - 6.4 * sc, cy + 2.6 * sc, 2.1 * sc, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + 6.4 * sc, cy + 2.6 * sc, 2.1 * sc, 0, Math.PI * 2);
          ctx.fill();
          // 笑
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.1 * sc;
          ctx.beginPath();
          ctx.arc(cx, cy + 1.6 * sc, 2.6 * sc, 0.25 * Math.PI, 0.75 * Math.PI);
          ctx.stroke();
        };

        if (e.type === "grunt") {
          // 枫叶
          ctx.save();
          ctx.rotate(Math.sin(this.time * 1.8 + e.x * 0.1) * 0.14);
          ctx.beginPath();
          ctx.moveTo(0, -17);
          ctx.quadraticCurveTo(5.6, -13.6, 6.6, -8);
          ctx.lineTo(15, -12.4);
          ctx.quadraticCurveTo(11, -5, 13.6, -1.6);
          ctx.lineTo(19, 4);
          ctx.quadraticCurveTo(11, 6.6, 7.4, 9.4);
          ctx.lineTo(9, 17);
          ctx.quadraticCurveTo(0, 12, -9, 17);
          ctx.lineTo(-7.4, 9.4);
          ctx.quadraticCurveTo(-11, 6.6, -19, 4);
          ctx.lineTo(-13.6, -1.6);
          ctx.quadraticCurveTo(-11, -5, -15, -12.4);
          ctx.lineTo(-6.6, -8);
          ctx.quadraticCurveTo(-5.6, -13.6, 0, -17);
          ctx.closePath();
          ctx.fillStyle = hurt ? "#eab387" : "#d07a34";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.strokeStyle = "rgba(107,64,38,0.4)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 13); ctx.lineTo(0, -10);
          ctx.moveTo(0, 2); ctx.lineTo(11, -1);
          ctx.moveTo(0, 2); ctx.lineTo(-11, -1);
          ctx.stroke();
          ctx.restore();
          face(0, 1, 0.9);
        } else if (e.type === "zigzag") {
          // 橡果
          ctx.beginPath();
          ctx.ellipse(0, 5.6, 11.4, 10.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = hurt ? "#f0cfa6" : "#e2a95c";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // 果身高光
          ctx.fillStyle = "rgba(255,246,224,0.5)";
          ctx.beginPath();
          ctx.ellipse(-3.6, 2.6, 2.8, 4, -0.3, 0, Math.PI * 2);
          ctx.fill();
          // 帽
          ctx.beginPath();
          ctx.ellipse(0, -5.4, 13.4, 7.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#8a6238";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.strokeStyle = "rgba(58,36,20,0.35)";
          ctx.lineWidth = 1;
          [-7, -2.4, 2.4, 7].forEach((x) => {
            ctx.beginPath();
            ctx.moveTo(x, -11); ctx.lineTo(x + 1.4, -0.4);
            ctx.stroke();
          });
          // 小蒂
          ctx.strokeStyle = "#5f402a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, -12); ctx.lineTo(0, -16.6);
          ctx.stroke();
          face(0, 4.6, 0.9);
        } else if (e.type === "gunner") {
          // 蘑菇
          ctx.beginPath();
          ctx.roundRect(-6.6, -1, 13.2, 16, 4.6);
          ctx.fillStyle = hurt ? "#f2dbc4" : "#fbf1da";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // 伞盖
          ctx.beginPath();
          ctx.ellipse(0, -3.4, 17.6, 12, 0, Math.PI, Math.PI * 2, true);
          ctx.quadraticCurveTo(0, 4.4, -17.6, -3.4);
          ctx.closePath();
          ctx.fillStyle = hurt ? "#eaa98f" : "#c9693c";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          // 斑点
          ctx.fillStyle = "rgba(255,247,225,0.85)";
          [[-8, -6, 2.6], [0, -9, 3.1], [7.4, -5.6, 2.3]].forEach((d) => {
            ctx.beginPath();
            ctx.arc(d[0], d[1], d[2], 0, Math.PI * 2);
            ctx.fill();
          });
          // 螺旋桨似的伞柄小点
          face(0, 7.4, 0.85);
        } else if (e.type === "crow") {
          // 乌鸦：俯冲下来抢果子
          const flap = Math.sin(this.time * 14 + e.phase) * 0.5;
          ctx.rotate(e.tilt || 0);
          // 翅膀
          ctx.fillStyle = hurt ? "#6d5545" : "#4a3830";
          [-1, 1].forEach((s) => {
            ctx.beginPath();
            ctx.moveTo(s * 6, -2);
            ctx.quadraticCurveTo(s * 26, -10 + flap * 8, s * 30, 4 + flap * 5);
            ctx.quadraticCurveTo(s * 16, 2, s * 6, 6);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(40,26,18,0.55)";
            ctx.lineWidth = 1;
            ctx.stroke();
          });
          // 身体
          ctx.beginPath();
          ctx.ellipse(0, 0, 12.4, 10.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = hurt ? "#7d6252" : "#54402f";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // 喙
          ctx.fillStyle = "#e2a53c";
          ctx.beginPath();
          ctx.moveTo(-6.4, 1.6); ctx.lineTo(0, 4.2); ctx.lineTo(-6.4, 6); ctx.closePath();
          ctx.fill();
          // 眼
          ctx.fillStyle = "#fff6e0";
          ctx.beginPath(); ctx.arc(-1.6, -2.4, 3.1, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(-1, -2.2, 1.5, 0, Math.PI * 2); ctx.fill();
          // 腮红
          ctx.fillStyle = "rgba(226,122,102,0.4)";
          ctx.beginPath(); ctx.arc(-7.4, 1.6, 2, 0, Math.PI * 2); ctx.fill();
        } else if (e.type === "scarecrow") {
          // 稻草人：站在上方不停地撒弹
          ctx.beginPath();
          ctx.roundRect(-3, -4, 6, 22, 2);
          ctx.fillStyle = "#8d7145";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          // 手臂
          ctx.beginPath();
          ctx.moveTo(-17, 2); ctx.lineTo(17, 2);
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = "#a78a55";
          ctx.stroke();
          // 头
          ctx.beginPath();
          ctx.ellipse(0, -4, 12.6, 11.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = hurt ? "#f0dcae" : "#e8cf92";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // 草帽
          ctx.beginPath();
          ctx.ellipse(0, -12.6, 15.4, 5.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#c79a4f";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(0, -16.4, 8.4, 4.6, 0, Math.PI, Math.PI * 2);
          ctx.fillStyle = "#b98b41";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.stroke();
          face(0, -1, 1);
          // 打补丁的布片
          ctx.fillStyle = "rgba(191,90,44,0.5)";
          ctx.beginPath();
          ctx.rect(6, 6, 5, 4.6);
          ctx.fill();
        } else if (e.type === "squirrel") {
          // 松鼠：抱着松果，大尾巴
          const bob = Math.sin(this.time * 12 + e.phase) * 2;
          ctx.rotate(e.tilt || 0);
          // 尾巴
          ctx.beginPath();
          ctx.moveTo(7, 8);
          ctx.quadraticCurveTo(27, 4 + bob, 23, -13 + bob);
          ctx.quadraticCurveTo(20, -24 + bob, 12, -18 + bob);
          ctx.quadraticCurveTo(21, -8 + bob, 7, 1);
          ctx.closePath();
          ctx.fillStyle = hurt ? "#e9b78d" : "#c87838";
          ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
          // 耳朵
          [-6.4, 6.4].forEach((ex) => {
            ctx.beginPath();
            ctx.moveTo(ex - 3, -7); ctx.lineTo(ex, -15); ctx.lineTo(ex + 3, -7);
            ctx.closePath();
            ctx.fillStyle = hurt ? "#f0c9a6" : "#d98f4a"; ctx.fill();
            ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.stroke();
          });
          // 身体
          ctx.beginPath();
          ctx.ellipse(0, 3, 11, 11.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = hurt ? "#f0c9a6" : "#d98f4a";
          ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
          // 松果
          ctx.beginPath();
          ctx.ellipse(0, 9.5, 4.4, 5.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#8a6238"; ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
          face(0, -1, 0.82);
        } else if (e.type === "chestnut") {
          // 刺栗：一圈尖刺 + 栗壳笑脸，碎了会炸
          ctx.rotate(e.tilt || 0);
          ctx.beginPath();
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
            ctx.lineTo(Math.cos(a + 0.1) * 19, Math.sin(a + 0.1) * 19);
            ctx.lineTo(Math.cos(a + 0.2) * 12, Math.sin(a + 0.2) * 12);
          }
          ctx.fillStyle = hurt ? "#c9a882" : "#7a5236";
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(0, 0, 13, 12.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = hurt ? "#e3c19b" : "#a56a3c";
          ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
          ctx.fillStyle = "rgba(255,240,215,0.32)";
          ctx.beginPath(); ctx.ellipse(-4.2, -4.4, 4, 3, -0.4, 0, Math.PI * 2); ctx.fill();
          face(0, 1.4, 0.9);
        } else {
          // 南瓜
          ctx.rotate(e.tilt || 0);
          ctx.beginPath();
          ctx.ellipse(0, 1.4, 20.4, 16.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = hurt ? "#f0c08d" : "#d4842c";
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.strokeStyle = "rgba(107,64,26,0.36)";
          ctx.lineWidth = 1.4;
          [-10, 0, 10].forEach((x) => {
            ctx.beginPath();
            ctx.ellipse(x, 1.4, Math.abs(x) === 0 ? 0.6 : 9.4, 15.6, 0, 0, Math.PI * 2);
            ctx.stroke();
          });
          // 蒂与叶
          ctx.fillStyle = "#6f5233";
          ctx.beginPath();
          ctx.roundRect(-2.2, -19, 4.4, 7, 1.6);
          ctx.fill();
          ctx.fillStyle = "#8d9a52";
          ctx.beginPath();
          ctx.ellipse(7, -18, 5.4, 2.6, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1;
          ctx.stroke();
          face(0, 1.4, 1.05);
        }

        // 血条：暖色调
        if (e.maxHp > 3 && e.hp < e.maxHp) {
          const w = e.w * 0.9;
          const ratio = Math.max(0, e.hp / e.maxHp);
          ctx.fillStyle = "rgba(107,86,71,0.13)";
          ctx.fillRect(-w / 2, -e.h / 2 - 9, w, 2.4);
          ctx.fillStyle = ratio > 0.5 ? "#d8a85e" : ratio > 0.2 ? "#cf8a3a" : "#bf5a2c";
          ctx.fillRect(-w / 2, -e.h / 2 - 9, w * ratio, 2.4);
        }
        ctx.restore();
      });
    }

    drawBoss(ctx) {
      const b = this.boss;
      const hurt = b.hurt > 0;
      const hw = b.w / 2;
      const hh = b.h / 2;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.shadowColor = "rgba(120,70,30,0.34)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 7;
      ctx.lineJoin = "round";

      // 车轮
      [-hw * 0.62, hw * 0.62].forEach((x) => {
        ctx.beginPath();
        ctx.arc(x, hh + 2, 17, 0, Math.PI * 2);
        ctx.fillStyle = "#8a6238";
        ctx.fill();
        ctx.strokeStyle = "#5f402a";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = "rgba(253,244,223,0.6)";
        ctx.lineWidth = 1.2;
        for (let k = 0; k < 6; k++) {
          const a2 = (k / 6) * Math.PI * 2 + b.t * 0.6;
          ctx.beginPath();
          ctx.moveTo(x, hh + 2);
          ctx.lineTo(x + Math.cos(a2) * 14, hh + 2 + Math.sin(a2) * 14);
          ctx.stroke();
        }
      });
      ctx.shadowOffsetY = 0;

      // 瓜身
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      ctx.fillStyle = hurt ? "#efc093" : "#d8862e";
      ctx.fill();
      ctx.strokeStyle = "#6b4020";
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // 瓜棱（裁到瓜身内）
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 1.2, hh - 1.2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(107,64,26,0.15)";
      ctx.lineWidth = 2;
      [-hw * 0.6, -hw * 0.3, 0, hw * 0.3, hw * 0.6].forEach((x) => {
        ctx.beginPath();
        ctx.ellipse(x, 0, Math.abs(x) < 1 ? 1.2 : hw * 0.22, hh * 0.98, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();

      // 瓜脸：两只斜眼 + 一张笑口
      const glow = 0.55 + Math.sin(b.t * 3) * 0.16;
      const eyeFill = "rgba(250,196,104," + (glow + 0.28) + ")";
      [-1, 1].forEach((sd) => {
        ctx.save();
        ctx.translate(sd * hw * 0.38, -hh * 0.12);
        ctx.rotate(sd * 0.22);
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 8.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = eyeFill;
        ctx.fill();
        ctx.strokeStyle = "rgba(107,64,26,0.72)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      });
      // 笑口
      ctx.beginPath();
      ctx.moveTo(-hw * 0.46, hh * 0.1);
      ctx.quadraticCurveTo(0, hh * 0.62, hw * 0.46, hh * 0.1);
      ctx.quadraticCurveTo(0, hh * 0.34, -hw * 0.46, hh * 0.1);
      ctx.closePath();
      ctx.fillStyle = eyeFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(107,64,26,0.72)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // 小牙
      ctx.fillStyle = "rgba(255,249,234,0.92)";
      [-hw * 0.18, hw * 0.02].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, hh * 0.26);
        ctx.lineTo(x + 9, hh * 0.26);
        ctx.lineTo(x + 5, hh * 0.4);
        ctx.closePath();
        ctx.fill();
      });

      // 瓜蒂与藤叶
      ctx.fillStyle = "#6f5233";
      ctx.beginPath();
      ctx.roundRect(-5, -hh - 12, 10, 16, 4);
      ctx.fill();
      ctx.strokeStyle = "#5f402a";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = "#8d9a52";
      [[-30, -hh - 14, -0.5], [32, -hh - 10, 0.5]].forEach((d) => {
        ctx.beginPath();
        ctx.ellipse(d[0], d[1], 15, 7, d[2], 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#5c512e";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });

      ctx.restore();
    }

    drawPickups(ctx) {
      this.pickups.forEach((k) => {
        const color = { power: "#2c76a0", shield: "#77b7e0", heal: "#bf5a2c", alloy: "#c98a2e", cocoa: "#7a4a24" }[k.type];
        const label = { power: "P", shield: "S", heal: "H", alloy: "¤", cocoa: "C" }[k.type];
        ctx.save();
        ctx.translate(k.x, k.y);
        ctx.rotate(k.t * 2.4);
        ctx.fillStyle = "#fdf4df";
        ctx.fillRect(-9, -9, 18, 18);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.strokeRect(-9, -9, 18, 18);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = color;
        ctx.font = "bold 12px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, k.x, k.y + 0.5);
        ctx.restore();
      });
    }

    drawParticles(ctx) {
      this.particles.forEach((q) => {
        const alpha = Math.max(0, q.life / q.maxLife);
        if (q.ring) {
          ctx.save();
          ctx.strokeStyle = q.color ? q.color : "rgba(232,180,95," + alpha + ")";
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(q.x, q.y, (1 - alpha) * q.size * 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          return;
        }
        ctx.fillStyle = q.color;
        ctx.globalAlpha = alpha;
        ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
        ctx.globalAlpha = 1;
      });
    }

    drawFloats(ctx) {
      this.floats.forEach((f) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, f.life / 0.8);
        ctx.fillStyle = f.color;
        ctx.font = "bold 15px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      });
    }

    drawBanner(ctx) {
      const b = this.banner;
      const a = Math.min(1, b.t * 1.4) * Math.min(1, (2.6 - b.t) * 2);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.textAlign = "center";
      ctx.fillStyle = "#4a3018";
      ctx.font = "bold 26px ui-monospace, monospace";
      ctx.fillText(b.text, W / 2, H / 2 - 24);
      ctx.fillStyle = "#6d5634";
      ctx.font = "13px ui-monospace, monospace";
      ctx.fillText(b.sub, W / 2, H / 2 + 6);
      ctx.strokeStyle = "rgba(23,48,63,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 130, H / 2 + 24);
      ctx.lineTo(W / 2 + 130, H / 2 + 24);
      ctx.stroke();
      ctx.restore();
    }

    drawIdle(ctx) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "#6d5634";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("拖动小人 / WASD 移动 · 自动开火", W / 2, H - 60);
      ctx.restore();
    }
  }

  window.Starline = Starline;
})();

