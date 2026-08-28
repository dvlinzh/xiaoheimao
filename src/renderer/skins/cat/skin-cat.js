// skin-cat.js — 小黑猫皮肤：官方渲染原素 + 分层呼吸（身体微起伏，尾巴幅度更大）
// 尾巴摆动功能已按需求移除；原图备份 assets/cat.bak-20260828/
(function () {
  const POSE_FILES = {
    idle: "cat-idle.png", walk: "cat-walk.png", run: "cat-run.png",
    ask: "cat-ask.png", crouch: "cat-crouch.png", sleep: "cat-sleep.png",
  };
  const MOOD_POSE = {
    idle: "idle", walk: "walk", ask: "ask", alert: "crouch",
    celebrate: "run", sleep: "sleep",   // 趴着仅是姿态：暗化/Zzz 不恢复
  };
  const MOOD_FILTER = {
    alert: "drop-shadow(0 0 14px rgba(244,63,94,.45))",
    celebrate: "drop-shadow(0 0 16px rgba(168,85,247,.5))",
    ask: "drop-shadow(0 0 12px rgba(94,234,212,.4))",
  };
  /* 呼吸参数：身体 0.8%，尾巴 3% + 微转——尾巴幅度明显大于身体 */
  const BREATH = { period: 2600, bodyAmp: 0.008, tailAmp: 0.04, tailRot: 0.018 };

  window.PetSkinCat = {
    name: "cat",
    label: "小黑猫",
    async mount(host) {
      const imgs = {};
      await Promise.all(Object.entries(POSE_FILES).map(([k, f]) => new Promise((res) => {
        const i = new Image();
        i.onload = () => { imgs[k] = i; res(); };
        i.onerror = () => res();
        i.src = "/assets/cat/" + f;
      })));
      // 尾巴蒙版：颜色区域生长（不用手调多边形——手工顶点会有残端/裂片）。
      // 种子=蓝紫渐变特征像素（B-R>28 且 B>100 且不透明），BFS 向周边扩展，
      // 局部色差≤46 才长入（尾巴渐变暗部的浅渐变），到身体黑交界自动停 → 精确尾巴像素。
      // hard=精确蒙版（身体层挖洞用，身体层即原图剩余=干净无尾）；
      // soft=blur(3px)+四方平移外扩≈9px（尾巴层裁出用，盖住洞口+呼吸摆动余量）；
      // root=蒙版最左像素行（贴身体根部）→ 呼吸轴心，根部零位移。
      function buildTailData(img) {
        const w = img.width, h = img.height;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(img, 0, 0);
        const dd = cx.getImageData(0, 0, w, h).data;
        const seen = new Uint8Array(w * h);
        const q = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (dd[i + 3] > 220 && dd[i + 2] - dd[i] > 40 && dd[i + 2] > 110) {
            const p = y * w + x;
            if (!seen[p]) { seen[p] = 1; q.push(p); }
          }
        }
        if (q.length < 50) return null;   // 姿态无尾巴（如 ask/sleep 兜底）
        const THR = 46;
        let head = 0;
        while (head < q.length) {
          const p = q[head++];
          const x = p % w, y = (p / w) | 0;
          const i = p * 4;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const np = ny * w + nx;
            if (seen[np]) continue;
            const ni = np * 4;
            if (dd[ni + 3] < 160) continue;
            if (dd[ni + 2] - dd[ni] <= 20) continue;   // 蓝紫性保持：身体黑像素永远进不来
            const dr = Math.abs(dd[i] - dd[ni]) + Math.abs(dd[i + 1] - dd[ni + 1]) + Math.abs(dd[i + 2] - dd[ni + 2]);
            if (dr <= THR) { seen[np] = 1; q.push(np); }
          }
        }
        // 连通域过滤：只保留最大域（尾巴主体），丢弃图边缘渐晕等碎域污染
        const lab = new Int32Array(w * h).fill(-1);
        const comps = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (!seen[p] || lab[p] >= 0) continue;
          const ci = comps.length;
          let size = 0;
          const stack = [p];
          lab[p] = ci;
          while (stack.length) {
            const cp = stack.pop();
            size++;
            const cx2 = cp % w, cy2 = (cp / w) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
              const nx = cx2 + dx, ny = cy2 + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const np = ny * w + nx;
              if (seen[np] && lab[np] < 0) { lab[np] = ci; stack.push(np); }
            }
          }
          comps.push(size);
        }
        let bestCi = 0;
        for (let i = 1; i < comps.length; i++) if (comps[i] > comps[bestCi]) bestCi = i;
        if (comps[bestCi] < 800) return null;
        for (let p = 0; p < seen.length; p++) if (seen[p] && lab[p] !== bestCi) seen[p] = 0;
        let minX = Infinity, minY = 0, count = 0, sy = 0, syN = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (seen[y * w + x]) { count++; if (x < minX) { minX = x; minY = y; } }
        }
        if (count < 300) return null;
        for (let y = 0; y < h; y++) {
          const x0 = minX;
          for (let x = x0; x <= x0 + 12 && x < w; x++) {
            if (seen[y * w + x]) { sy += y; syN++; }
          }
        }
        const hard = document.createElement("canvas");
        hard.width = w; hard.height = h;
        const hc = hard.getContext("2d");
        const id = hc.createImageData(w, h);
        const px = id.data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (seen[y * w + x]) px[(y * w + x) * 4 + 3] = 255;
        }
        hc.putImageData(id, 0, 0);
        const soft = document.createElement("canvas");
        soft.width = w; soft.height = h;
        const sc = soft.getContext("2d");
        sc.filter = "blur(3px)";
        sc.drawImage(hard, 0, 0);
        sc.filter = "none";
        for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) sc.drawImage(hard, dx, dy);
        return { hard, soft, root: [minX, Math.round(sy / Math.max(1, syN))] };
      }

      const tailData = {};
      for (const k of Object.keys(imgs)) {
        const d = buildTailData(imgs[k]);
        if (d) tailData[k] = d;
      }

      /* 底部空白扫描：每张素材最低的不透明行（脚底）。各姿态裁剪留白不同
       * （idle 14px / ask 89px / sleep 89px…），按图片底边对齐会让角色悬空
       * （趴睡会飘在任务栏上方）。渲染统一按脚底对齐画布底——窗口底即脚底，
       * 任务栏偏移即微埋量。 */
      const bottomRow = {};
      for (const [k, img] of Object.entries(imgs)) {
        const oc = document.createElement("canvas");
        oc.width = img.width; oc.height = img.height;
        const octx = oc.getContext("2d", { willReadFrequently: true });
        octx.drawImage(img, 0, 0);
        const d = octx.getImageData(0, 0, oc.width, oc.height).data;
        let b = oc.height - 1;
        outer: for (; b >= 0; b--) {
          for (let x = 0; x < oc.width; x++) {
            if (d[(b * oc.width + x) * 4 + 3] > 8) break outer;
          }
        }
        bottomRow[k] = b;
      }

      const cvs = document.createElement("canvas");
      cvs.id = "pet-canvas";
      // 画布需容纳最宽的素材（cat-sleep 434px），否则尾巴/边缘会被画布裁掉
      cvs.width = 440; cvs.height = 404;
      const SCALE = 0.42;
      cvs.style.cssText = `position:absolute;left:50%;bottom:2px;width:${Math.round(cvs.width * SCALE)}px;height:${Math.round(cvs.height * SCALE)}px;transform:translateX(-50%);transform-origin:50% 100%;`;
      host.appendChild(cvs);
      const ctx = cvs.getContext("2d", { willReadFrequently: true });

      const workBody = document.createElement("canvas");
      workBody.width = cvs.width; workBody.height = cvs.height;
      const workTail = document.createElement("canvas");
      workTail.width = cvs.width; workTail.height = cvs.height;

      let mood = "idle";
      let dragging = false;

      function moodFilterFor(pose) {
        if (pose === "crouch" && mood === "alert") return "drop-shadow(0 0 14px rgba(244,63,94,.45))";
        if (pose === "run") return "drop-shadow(0 0 16px rgba(168,85,247,.5))";
        if (pose === "ask") return "drop-shadow(0 0 12px rgba(94,234,212,.4))";
        return "none";
      }

      function render(t) {
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        const pose = dragging ? "walk" : (MOOD_POSE[mood] || "idle");
        const img = imgs[pose] || imgs.idle;
        if (!img) return;
        const ox = Math.floor((cvs.width - img.width) / 2);
        // 脚底对齐画布底：各姿态底部留白不同（idle 14px / sleep 89px…），
        // 按图片底边会悬空。bottomRow 无数据（异常）时回退图片底边。
        const oy = cvs.height - 1 - (bottomRow[pose] ?? img.height - 1);
        const td = tailData[pose];
        const filter = dragging ? "none" : (MOOD_FILTER[pose] || "none");
        const breath = Math.sin((t / BREATH.period) * Math.PI * 2);

        if (td) {
          // 每帧重建图层：身体层=完整图-尾巴蒙版（挖洞）；尾巴层=完整图∩软蒙版(外扩+羽化)
          const bc = workBody.getContext("2d");
          bc.clearRect(0, 0, cvs.width, cvs.height);
          bc.drawImage(img, ox, oy);
          bc.globalCompositeOperation = "destination-out";
          bc.drawImage(td.hard, ox, oy);
          bc.globalCompositeOperation = "source-over";
          const tc = workTail.getContext("2d");
          tc.clearRect(0, 0, cvs.width, cvs.height);
          tc.drawImage(img, ox, oy);
          tc.globalCompositeOperation = "destination-in";
          tc.drawImage(td.soft, ox, oy);
          tc.globalCompositeOperation = "source-over";
          /* 两层共用同一套身体呼吸矩阵（bodyT）：
             身体层画完后在同一矩阵内再叠尾巴摆动（tailExtra 绕尾根）。
             洞的边缘与尾巴层的 bodyT 分量严格同步 → 任何相位两者零相对位移，
             断开只可能来自 tailExtra 本身（由软蒙版外扩覆盖）。
             旧实现两层各自 save/restore，洞绕底部中心、尾巴绕尾根各转各的，
             相位拉开后洞缘露出背景——就是「尾巴断开一截」的来源。 */
          const cx = cvs.width / 2, cy = cvs.height;
          const bodySx = 1 + BREATH.bodyAmp * breath;
          const bodySy = 1 + BREATH.bodyAmp * 0.6 * breath;
          ctx.save();
          ctx.filter = filter;
          ctx.translate(cx, cy); ctx.scale(bodySx, bodySy); ctx.translate(-cx, -cy);
          ctx.drawImage(workBody, 0, 0);
          // 尾巴摆动：轴心=尾根接合点（bodyT 空间内，随身体一起动）
          const ax = (td.root ? td.root[0] : td.px) + ox;
          const ay = (td.root ? td.root[1] : td.py) + oy;
          const s = 1 + BREATH.tailAmp * breath;
          ctx.translate(ax, ay); ctx.scale(s, s);
          ctx.rotate(BREATH.tailRot * breath);
          ctx.translate(-ax, -ay);
          ctx.drawImage(workTail, 0, 0);
          ctx.filter = "none";
          ctx.restore();
        } else {
          ctx.filter = filter;
          ctx.drawImage(img, ox, oy);
          ctx.filter = "none";
        }
      }

      function loop(t) { render(t); requestAnimationFrame(loop); }
      requestAnimationFrame(loop);

      /* 调试可视化（CDP 取用）：导出各图层组件供断缝诊断 */
      window.__mbLayers = { cvs, imgs, workBody, workTail, tailData };

      function applyDragClass() {
        cvs.classList.toggle("dragged", dragging);
      }

      return {
        el: cvs,
        setMood(m) { if (m !== mood) { mood = m; } },
        setDrag(v) {
          dragging = !!v;
          applyDragClass();
        },
        hop() {
          cvs.classList.remove("hop");
          void cvs.getBoundingClientRect();
          cvs.classList.add("hop");
          setTimeout(() => cvs.classList.remove("hop"), 560);
        },
        juggle() {   // 双击：原地连跳两下
          if (cvs.dataset.on) return;
          cvs.dataset.on = "1";
          const prev = mood;
          mood = "celebrate";
          this.hop(); setTimeout(() => this.hop(), 580); setTimeout(() => this.hop(), 1160);
          setTimeout(() => { mood = prev; delete cvs.dataset.on; }, 1800);
        },
        flash(m, ms) { this.setMood(m); setTimeout(() => this.setMood("idle"), ms); },
      };
    },
  };
})();
