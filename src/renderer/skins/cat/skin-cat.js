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
  const BREATH = { period: 2600, bodyAmp: 0.012 };   // 用户校准 ×1.5

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
      // 画布需容纳最高素材（拎起 512px），否则拖拽姿态耳朵会被画布裁掉
      cvs.width = 440; cvs.height = 516;
      const SCALE = 0.42;
      cvs.style.cssText = `position:absolute;left:50%;bottom:2px;width:${Math.round(cvs.width * SCALE)}px;height:${Math.round(cvs.height * SCALE)}px;transform:translateX(-50%);transform-origin:50% 100%;`;
      host.appendChild(cvs);
      const ctx = cvs.getContext("2d", { willReadFrequently: true });

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
        // 光效按 mood 名查表（alert 红光 / celebrate 紫光 / ask 青光）——
        // 旧代码误用 pose 名查（crouch/run），红紫两色从未生效
        const filter = dragging ? "none" : (MOOD_FILTER[mood] || "none");
        const breath = Math.sin((t / BREATH.period) * Math.PI * 2);
        // 单层渲染：整只猫（含尾巴）围绕底部中心一体呼吸——不再分层，无接缝
        const cx = cvs.width / 2, cy = cvs.height;
        ctx.save();
        if (dragging) {
          // 拎起晃动：脑袋为圆心（素材坐标 46%,22%），身体像钟摆一样小幅摆动
          const px = ox + img.width * 0.46, py = oy + img.height * 0.22;
          const ang = Math.sin((t / 1100) * Math.PI * 2) * 0.055;
          ctx.translate(px, py); ctx.rotate(ang); ctx.translate(-px, -py);
        }
        ctx.filter = filter;
        ctx.translate(cx, cy);
        ctx.scale(1 + BREATH.bodyAmp * breath, 1 + BREATH.bodyAmp * 0.6 * breath);
        ctx.translate(-cx, -cy);
        ctx.drawImage(img, ox, oy);
        ctx.restore();
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
