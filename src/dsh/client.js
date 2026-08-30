// mind-board-pet — DSH web UI 端最小挂载（入口 D · client 部分）
// 契约按原版 dsh-mind-board 的 dsh.client.platform:"web" 提供（未在本机验证宿主加载细节），
// 全部功能做 feature-detect：宿主环境不支持时静默降级——agent 注入与工具由 index.js 承担，
// 这里只是「猫爪可见性」：一个缺口角标，点击唤起桌面猫。
//
// 宿主如果提供挂载点（history 遍历 find element[id^=plugin-mount-]）就注入；
// 没有挂载点就在 document.body 上放一个可拖小浮标；再不行什么都不做。

const PET_API = "http://127.0.0.1:13134";
const LABEL = "🐾 思维板";

function badgeHtml(gaps) {
  const n = gaps > 0 ? ` <b style="color:#f0716c">${gaps}缺口</b>` : "";
  return `<span style="margin:0 6px;padding:2px 10px;border-radius:999px;background:#141416;border:1px solid #34343c;color:#ececec;font-size:12px;cursor:pointer;user-select:none;">${LABEL}${n}</span>`;
}

async function gapsCount() {
  try {
    const r = await fetch(PET_API + "/api/overview");
    const ov = await r.json();
    return (ov.projects || []).reduce((n, p) => n + (p.counts?.gaps || 0), 0);
  } catch { return null; }
}

async function mount() {
  try {
    const gaps = await gapsCount();
    const el = document.createElement("div");
    el.innerHTML = badgeHtml(gaps ?? 0);
    el.firstChild.addEventListener("click", () => {
      window.open(PET_API + "/pet.html", "_blank");   // 猫页（Electron 未跑时浏览器模式仍可用）
    });
    // 宿主挂载点（尽力）→ 换样式并挂上去；失败则 body 浮标兜底
    let host = null;
    for (const el2 of document.querySelectorAll("[id^='plugin-mount-']")) {
      if (/composer|input|toolbar|footer/i.test(el2.id)) { host = el2; break; }
    }
    if (host) host.appendChild(el);
    else {
      el.firstChild.style.position = "fixed";
      el.firstChild.style.right = "16px";
      el.firstChild.style.bottom = "56px";
      el.firstChild.style.zIndex = "9999";
      document.body.appendChild(el);
    }
  } catch { /* 宿主无 DOM/权限：静默降级 */ }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
}

export default { name: "mind-board-pet", mount };
