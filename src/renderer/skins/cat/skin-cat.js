// skin-cat.js — 小黑猫皮肤：官方渲染原素 + 分层呼吸（身体微起伏，尾巴幅度更大）
// 尾巴摆动功能已按需求移除；原图备份 assets/cat.bak-20260828/
(function () {
  const POSE_FILES = {
    idle: "cat-idle.png", walk: "cat-walk.png", run: "cat-run.png",
    ask: "cat-ask.png", crouch: "cat-crouch.png", sleep: "cat-sleep.png",
  };
  const MOOD_POSE = {
    idle: "idle", walk: "walk", ask: "ask", alert: "crouch",
    celebrate: "run", sleep: "sleep",
  };
  const MOOD_FILTER = {
    sleep: "brightness(.55) saturate(.75)",
    alert: "drop-shadow(0 0 14px rgba(244,63,94,.45))",
    celebrate: "drop-shadow(0 0 16px rgba(168,85,247,.5))",
    ask: "drop-shadow(0 0 12px rgba(94,234,212,.4))",
  };
  /* 呼吸参数：身体 0.8%，尾巴 3% + 微转——尾巴幅度明显大于身体 */
  const BREATH = { period: 2600, bodyAmp: 0.008, tailAmp: 0.02, tailRot: 0.009 };

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
      // 尾区多边形（cat-hull.ps1 生成）：poly=尾层软蒙版包络，bodyPoly=身体挖洞轮廓
      let TAILDEF = {};
      try {
        TAILDEF = await fetch("/assets/cat/cat-tails.json").then((r) => r.json());
        for (const k of Object.keys(TAILDEF)) TAILDEF[k.replace(/^cat-/, "")] = TAILDEF[k];
      } catch {}

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
      const maskCache = {};
      function mask(pose, soft, ox, oy) {
        const sig = pose + (soft ? ":s" : ":h");
        if (maskCache[sig]) return maskCache[sig];
        const td = TAILDEF[pose];
        const m = document.createElement("canvas");
        m.width = cvs.width; m.height = cvs.height;
        const mc = m.getContext("2d");
        // 尾层与洞都用「静止轮廓」：摆动已移除，不需要扫掠包络，
        // 包络会把身体像素圈进尾层、跟着呼吸缩放而与身体错位成重影。
        const src = td.bodyPoly || td.poly;
        if (soft) mc.filter = "blur(3px)";
        mc.beginPath();
        mc.moveTo(src[0][0] + ox, src[0][1] + oy);
        for (let i = 1; i < src.length; i++) mc.lineTo(src[i][0] + ox, src[i][1] + oy);
        mc.closePath();
        mc.fillStyle = "#fff";
        mc.fill();
        // 尾层外扩 8px（呼吸缩放尖端最大位移 ~4.5px，余量充足）、洞贴轮廓无外扩：
        // 尾层在任何呼吸相位都完整盖住洞口，不露缝
        if (soft) {
          mc.lineWidth = 16;
          mc.strokeStyle = "#fff";
          mc.stroke();
        }
        mc.filter = "none";
        maskCache[sig] = m;
        return m;
      }

      let mood = "idle";
      let dragging = false;

      function moodFilterFor(pose) {
        if (pose === "sleep") return "brightness(.55) saturate(.75)";
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
        const oy = cvs.height - img.height;
        const td = TAILDEF[pose];
        const filter = dragging ? "none" : (MOOD_FILTER[pose] || "none");
        const breath = Math.sin((t / BREATH.period) * Math.PI * 2);

        if (td) {
          // 身体层：挖洞 + 微呼吸（围绕底部中心）
          const bc = workBody.getContext("2d");
          bc.clearRect(0, 0, cvs.width, cvs.height);
          bc.drawImage(img, ox, oy);
          bc.globalCompositeOperation = "destination-out";
          bc.drawImage(mask(pose, false, ox, oy), 0, 0);
          bc.globalCompositeOperation = "source-over";
          const cx = cvs.width / 2, cy = cvs.height;
          ctx.save();
          ctx.filter = filter;
          ctx.translate(cx, cy);
          ctx.scale(1 + BREATH.bodyAmp * breath, 1 + BREATH.bodyAmp * 0.6 * breath);
          ctx.translate(-cx, -cy);
          ctx.drawImage(workBody, 0, 0);
          ctx.restore();
          // 尾巴层：羽化蒙版 + 大幅度呼吸（绕身体内轴心缩放 + 微转）
          const tc = workTail.getContext("2d");
          tc.clearRect(0, 0, cvs.width, cvs.height);
          tc.drawImage(img, ox, oy);
          tc.globalCompositeOperation = "destination-in";
          tc.drawImage(mask(pose, true, ox, oy), 0, 0);
          tc.globalCompositeOperation = "source-over";
          ctx.save();
          ctx.filter = filter;
          ctx.translate(td.px + ox, td.py + oy);
          const s = 1 + BREATH.tailAmp * breath;
          ctx.scale(s, s);
          ctx.rotate(BREATH.tailRot * breath);
          ctx.translate(-(td.px + ox), -(td.py + oy));
          ctx.drawImage(workTail, 0, 0);
          ctx.filter = "none";
          ctx.restore();
        } else {
          ctx.filter = filter;
          ctx.drawImage(img, ox, oy);
          ctx.filter = "none";
        }

        if (mood === "sleep" && !dragging) {
          ctx.fillStyle = "rgba(139,92,246,.85)";
          ctx.font = "700 30px 'Segoe UI', sans-serif";
          ctx.fillText("Z", 330, 96);
          ctx.font = "700 22px 'Segoe UI', sans-serif";
          ctx.fillText("z", 356, 74);
          ctx.font = "700 16px 'Segoe UI', sans-serif";
          ctx.fillText("z", 376, 58);
        }
      }

      function loop(t) { render(t); requestAnimationFrame(loop); }
      requestAnimationFrame(loop);

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
