// settings.js — 设置窗逻辑（独立窗口版）
const $ = (s) => document.querySelector(s);
const bridge = window.petBridge || null;

// 字号三档 → 实际磅值（面板正文 13px = 9.75pt 为基准，zoom 缩放后换算）
const FONT_PT = { s: "9pt", m: "10pt", l: "12pt" };
const FONT_CYCLE = ["s", "m", "l"];
const INTERVAL_CYCLE = [1, 2, 3];
// 面板字体：默认 georgia = 原版衬线
const FONT_FAMILY = [
  { id: "georgia", label: "font.georgia" },
  { id: "song", label: "font.song" },
  { id: "kai", label: "font.kai" },
  { id: "sans", label: "font.sans" },
  { id: "hei", label: "font.hei" },
];
const LANG_LABEL = { zh: "中文", en: "English" };

let mode = "off";
let fontSize = "m";
let pin = true;
let autostart = false;
let organizeInterval = 2;
let fontFamily = "georgia";
let language = "zh";

async function api(path, body) {
  return fetch(path, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined).then((r) => r.json());
}

function labels() {
  $("#st-mode-v").textContent = mode === "on" ? I18N.t("on") : I18N.t("off");
  $("#st-interval-v").textContent = organizeInterval + I18N.t("interval.unit");
  $("#st-pin-v").textContent = pin ? I18N.t("on") : I18N.t("off");
  $("#st-fontfam-v").textContent = I18N.t((FONT_FAMILY.find((f) => f.id === fontFamily) || FONT_FAMILY[0]).label);
  $("#st-font-v").textContent = FONT_PT[fontSize] || "10pt";
  $("#st-language-v").textContent = LANG_LABEL[language] || "中文";
  $("#st-autostart-v").textContent = autostart ? I18N.t("on") : I18N.t("off");
}

async function pull() {
  try {
    const ov = await api("/api/overview");
    mode = ov.settings?.mode || "off";
    fontSize = FONT_CYCLE.includes(ov.settings?.fontSize) ? ov.settings.fontSize : "m";
    organizeInterval = INTERVAL_CYCLE.includes(Number(ov.settings?.organizeInterval))
      ? Number(ov.settings.organizeInterval) : 2;
    fontFamily = FONT_FAMILY.some((f) => f.id === ov.settings?.fontFamily)
      ? ov.settings.fontFamily : "georgia";
    language = ov.settings?.language === "en" ? "en" : "zh";
    I18N.setLang(language);
    I18N.apply(document);
    labels();
    fitHeight();   // 文本切换可能改变行高，重算窗口高度
  } catch {}
}

$("#st-mode").addEventListener("click", async () => {
  const r = await api("/api/mode", { mode: mode === "on" ? "off" : "on" });
  mode = r?.settings?.mode || (mode === "on" ? "off" : "on");
  labels();
});
/* 子菜单行通用绑定：点击展开选项，选中写回并收起 */
function bindSub(rowId, subId, getCur, fmtOpt, apply) {
  const row = $(rowId), sub = $(subId);
  const opts = [...sub.querySelectorAll(".st-opt")];
  const render = () => {
    const cur = String(getCur());
    for (const el of opts) {
      el.textContent = fmtOpt(el.dataset.v);
      el.classList.toggle("on", el.dataset.v === cur);
    }
  };
  render();
  row.addEventListener("click", () => {
    const open = sub.hidden;
    sub.hidden = !open;
    row.classList.toggle("exp", open);
    if (open) render();
    fitHeight();
  });
  for (const el of opts) {
    el.addEventListener("click", async () => {
      await apply(el.dataset.v);
      render(); labels();
      sub.hidden = true; row.classList.remove("exp");
      fitHeight();
    });
  }
}
bindSub("#st-interval", "#st-interval-sub",
  () => organizeInterval,
  (v) => v + I18N.t("interval.unit"),
  async (v) => { organizeInterval = Number(v); await api("/api/prefs", { organizeInterval }); });
bindSub("#st-font", "#st-font-sub",
  () => fontSize,
  (v) => FONT_PT[v] || v,
  async (v) => { fontSize = v; await api("/api/prefs", { fontSize }); });
/* 面板字体：点击循环切换 */
$("#st-fontfam").addEventListener("click", async () => {
  const i = FONT_FAMILY.findIndex((f) => f.id === fontFamily);
  fontFamily = FONT_FAMILY[(i + 1) % FONT_FAMILY.length].id;
  labels();
  await api("/api/prefs", { fontFamily });
});
/* 语言：点击循环 中文/English */
$("#st-language").addEventListener("click", async () => {
  language = language === "zh" ? "en" : "zh";
  labels();
  I18N.setLang(language);
  I18N.apply(document);
  await api("/api/prefs", { language });
});
$("#st-pin").addEventListener("click", () => { pin = !pin; labels(); bridge?.setPin(pin); });
$("#st-autostart").addEventListener("click", () => {
  autostart = !autostart; labels();
  bridge?.setAutostart(autostart);
});
$("#st-data").addEventListener("click", () => bridge?.openDataDir());
$("#st-cal").addEventListener("click", () => bridge?.toggleCalibrator());
$("#st-tutorial").addEventListener("click", () => {
  const t = $("#tutorial");
  t.hidden = !t.hidden;
  fitHeight();
});
$("#st-export").addEventListener("click", () => { location.href = "/api/export"; });
$("#st-hide").addEventListener("click", () => { bridge?.hidePet(); bridge?.hideDock(); bridge?.hideSettings(); });
$("#st-quit").addEventListener("click", () => bridge?.quit());
$("#tt-ok").addEventListener("click", async () => {
  $("#tutorial").hidden = true;
  fitHeight();
  await api("/api/prefs", { tutorialDone: true });
});

/* 窗口高度自适应内容 —— 用 getBoundingClientRect().bottom（含上 margin）+ 下 margin 8px，
   保证窗口 ≥ 内容，底部圆角不被裁 */
function fitHeight() {
  const el = document.getElementById("settings");
  const tut = document.getElementById("tutorial");
  const bottom = (tut && !tut.hidden)
    ? Math.ceil(tut.getBoundingClientRect().bottom)
    : Math.ceil(el.getBoundingClientRect().bottom);
  bridge?.setWinHeight?.(Math.min(Math.max(bottom + 8, 120), 660));
}

bridge?.getState?.().then((s) => {
  pin = s.pin; autostart = s.autostart;
  labels();
  if (s.isDev) {
    $("#st-autostart").disabled = true;
    $("#st-autostart").title = "打包安装后可用（当前为开发模式）";
  }
  fitHeight();
}).catch(() => {});

// 点击面板外 → 关自己
document.addEventListener("mousedown", (e) => {
  if (!e.target.closest("#settings, #tutorial")) bridge?.hideSettings();
});

pull();
fitHeight();
setTimeout(fitHeight, 200);
setInterval(pull, 4000);
