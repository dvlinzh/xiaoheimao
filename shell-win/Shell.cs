// 小黑猫 C# 壳 —— 面板宿主与外壳编排（shell-win/Shell.cs）
// 面板/设置/仪表盘 = WebView2 按需窗，播现有网页（视觉与 Electron 版一致），
// 关掉即 Dispose 释放。桥：向页面注入 petBridge/bubbleBridge 垫片，
// 消息经 chrome.webview.postMessage 到壳（与 Electron preload 同接口语义）。
// 圆角：SetWindowRgn（WebView2 是子 HWND，WPF AllowsTransparency 那套不可靠）。

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace XiaoHeiMao
{
    static class Shell
    {
        public static PetWindow Pet;
        public static bool Pin = true;
        public static bool Autostart = false;
        public static readonly string RepoRoot = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        public static readonly string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".mind-board");
        public static readonly string CrashLog = Path.Combine(DataRoot, "petcat-crash.log");
        public const int Port = 13134;

        public static void LogCrash(object ex)
        {
            try { File.AppendAllText(CrashLog, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + ex + "\n\n"); } catch { }
        }

        static readonly Dictionary<string, PanelForm> _panels = new Dictionary<string, PanelForm>();
        static CoreWebView2Environment _wvEnv;

        /// <summary>数据服务不在就拉起（Node app.mjs，零依赖）。已在跑（如 Electron 版）则直接复用。</summary>
        public static void EnsureServer()
        {
            if (ServerAlive()) return;
            try
            {
                var server = Path.Combine(RepoRoot, "src", "server", "app.mjs");
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "\"" + server + "\"",
                    WorkingDirectory = RepoRoot,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
                // 等服务就绪（最多 5 秒）
                for (int i = 0; i < 25 && !ServerAlive(); i++) System.Threading.Thread.Sleep(200);
            }
            catch { /* 没有 Node 环境时面板打不开，猫本体不受影响 */ }
        }

        static bool ServerAlive()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create($"http://127.0.0.1:{Port}/api/overview");
                req.Timeout = 1200;
                using (req.GetResponse()) { return true; }
            }
            catch { return false; }
        }

        public static async Task<CoreWebView2Environment> WvEnv()
        {
            if (_wvEnv == null)
                _wvEnv = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataRoot, "webview2-udata"));
            return _wvEnv;
        }

        /// <summary>打开/聚焦一个面板；同 key 再调 = 关闭（toggle 语义，对齐原版）</summary>
        public static void TogglePanel(string key, string url, int w, int h)
        {
            if (_panels.TryGetValue(key, out var pf) && !pf.IsDisposed)
            {
                if (pf.Visible) { ClosePanel(key); return; }
                pf.Show(); pf.Activate();
                return;
            }
            OpenPanel(key, url, w, h);
        }

        public static void OpenPanel(string key, string url, int w, int h)
        {
            EnsureServer();   // 13134 若已不在（比如 Electron 版退了）就现场拉起，面板永远点得开
            ClosePanel(key);
            var pf = new PanelForm(key, url, w, h);
            var saved = LoadPanelBounds(key);
            if (saved.HasValue)   // 位置记忆：用户拖过/调过大小就用上次的（钳制在屏幕内）
            {
                var b = saved.Value;
                var wa = Screen.PrimaryScreen.WorkingArea;
                pf.Size = new Size(b.Width, b.Height);
                pf.Location = new Point(
                    Math.Max(wa.Left, Math.Min(b.X, wa.Right - b.Width)),
                    Math.Max(wa.Top, Math.Min(b.Y, wa.Bottom - b.Height)));
            }
            else PositionNearPet(pf, key == "dashboard");
            _panels[key] = pf;
            pf.Show();
        }

        /* ── 整理模式开关（纯 HTTP，不依赖页面桥） ── */
        static readonly System.Net.Http.HttpClient _http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        public static string ModeCache = "off";

        public static async Task<string> RefreshModeAsync()
        {
            try
            {
                var s = await _http.GetStringAsync($"http://127.0.0.1:{Port}/api/overview");
                var j = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s);
                if (j.TryGetValue("settings", out var st) && st is Dictionary<string, object> sd && sd.TryGetValue("mode", out var m))
                    ModeCache = Convert.ToString(m);
            }
            catch { }
            return ModeCache;
        }

        public static async Task ToggleModeAsync()
        {
            var next = (await RefreshModeAsync()) == "on" ? "off" : "on";
            try
            {
                await _http.PostAsync($"http://127.0.0.1:{Port}/api/mode",
                    new System.Net.Http.StringContent("{\"mode\":\"" + next + "\"}", System.Text.Encoding.UTF8, "application/json"));
                ModeCache = next;
            }
            catch { }
        }

        /* ── 面板位置记忆（~/.mind-board/shell-win-ui.json） ── */
        static Dictionary<string, int[]> _ui;
        static string UiFile => Path.Combine(DataRoot, "shell-win-ui.json");

        static void LoadUi()
        {
            if (_ui != null) return;
            _ui = new Dictionary<string, int[]>();
            try { _ui = new JavaScriptSerializer().Deserialize<Dictionary<string, int[]>>(File.ReadAllText(UiFile)) ?? _ui; } catch { }
        }

        static Rectangle? LoadPanelBounds(string key)
        {
            LoadUi();
            if (_ui.TryGetValue(key, out var a) && a != null && a.Length == 4) return new Rectangle(a[0], a[1], a[2], a[3]);
            return null;
        }

        public static void SavePanelBounds(string key, Rectangle b)
        {
            LoadUi();
            _ui[key] = new[] { b.X, b.Y, b.Width, b.Height };
            try { File.WriteAllText(UiFile, new JavaScriptSerializer().Serialize(_ui)); } catch { }
        }

        public static void ClosePanel(string key)
        {
            if (_panels.TryGetValue(key, out var pf))
            {
                _panels.Remove(key);
                try { pf.DisposeForReal(); } catch { }
            }
        }

        static void PositionNearPet(Form f, bool center)
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            if (center || Pet == null)
            {
                f.Location = new Point(wa.Left + (wa.Width - f.Width) / 2, wa.Top + (wa.Height - f.Height) / 2);
                return;
            }
            // 对齐 Electron 版：面板贴猫左侧（space 6/8px），垂直与猫身居中；猫太靠左则弹右侧
            int gap = f is PanelForm pf && pf.PanelKey == "settings" ? 6 : 8;
            int x = Pet.Location.X - f.Width - gap;
            if (x < wa.Left + 8) x = Pet.Location.X + 280 + 8;
            int y = Pet.Location.Y + (250 - f.Height) / 2;
            x = Math.Max(wa.Left + 8, Math.Min(x, wa.Right - f.Width - 8));
            y = Math.Max(wa.Top + 8, Math.Min(y, wa.Bottom - f.Height - 8));
            f.Location = new Point(x, y);
        }

        /// <summary>页面桥消息分发</summary>
        public static void OnBridgeMessage(PanelForm from, BridgeMsg m)
        {
            switch (m.t)
            {
                case "openBubble":
                    TogglePanel("bubble", $"http://127.0.0.1:{Port}/bubble.html?harness={Uri.EscapeDataString(m.h ?? "claude-code")}&side=taskbar", 470, 660);
                    break;
                case "openDashboard":
                    TogglePanel("dashboard", $"http://127.0.0.1:{Port}/dashboard.html", 860, 580);
                    break;
                case "toggleSettings":
                    TogglePanel("settings", $"http://127.0.0.1:{Port}/settings.html", 274, 420);
                    break;
                case "panelDragStart": from?.BeginTrack(null); break;   // 拖头挪窗
                case "resizeStart": from?.BeginTrack(m.u); break;        // .rz 八向手柄（页面只报开始/结束）
                case "panelDragEnd": from?.EndTrack(); break;
                case "panelDrag": break;   // 旧协议残留，忽略（位移由宿主按光标算）
                case "closeBubble": ClosePanel("bubble"); break;
                case "close": if (from != null) ClosePanel(from.PanelKey); break;
                case "hideSettings": ClosePanel("settings"); break;
                case "hideDock": break;   // dock 圆环 M2 原生重画，页面桥暂为 no-op
                case "hidePet": Pet?.Hide(); break;
                case "showPet": Pet?.Show(); break;
                case "quit": Application.Exit(); break;
                case "setPin":
                    Pin = m.v;
                    if (Pet != null) Pet.TopMost = Pin;
                    foreach (var p in _panels.Values) p.TopMost = Pin;
                    break;
                case "setAutostart":
                    Autostart = m.v;
                    try
                    {
                        using (var rk = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                            if (m.v) rk.SetValue("XiaoHeiMao", "\"" + Application.ExecutablePath + "\"");
                            else rk.DeleteValue("XiaoHeiMao", false);
                    }
                    catch { }
                    break;
                case "setEdge": break;   // 只有 taskbar 语义（与当前 Electron 版一致）
                case "setWinHeight":
                    if (from != null && m.hh > 60 && m.hh < 900) { from.Height = m.hh; from.FixRegion(); }
                    break;
                case "openDataDir":
                    try { System.Diagnostics.Process.Start("explorer.exe", DataRoot); } catch { }
                    break;
                case "openExternal":
                    if (m.u != null && (m.u.StartsWith("http://") || m.u.StartsWith("https://")))
                        try { System.Diagnostics.Process.Start(m.u); } catch { }
                    break;
                case "getState":
                    from?.AnswerCallback(m.id, new { edge = "taskbar", pin = Pin, autostart = Autostart, isDev = false });
                    break;
                case "toggleCalibrator":
                    TogglePanel("calibrator", $"http://127.0.0.1:{Port}/docs/ring-calibrator.html", 720, 620);
                    break;
            }
        }
    }

    public class BridgeMsg
    {
        public string t;          // 动作名
        public string h;          // harness（openBubble）
        public string u;          // url（openExternal）
        public int id;            // 回调 id（getState）
        public bool v;            // 布尔参数（setPin/setAutostart）
        public int hh;            // 高度（setWinHeight）
        public int dx, dy;        // 面板拖动位移
    }

    public class PanelForm : Form
    {
        [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
        [DllImport("user32.dll")] static extern bool SetWindowRgn(IntPtr hwnd, IntPtr rgn, bool redraw);

        public readonly string PanelKey;
        WebView2 _wv;
        static readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        /// <summary>注入页面的桥垫片：接口与 Electron preload.cjs 同语义</summary>
        const string SHIM = @"
(() => {
  let cbId = 0; const pending = {};
  const post = (m) => chrome.webview.postMessage(m);
  window.chrome.webview.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.t === 'cb' && pending[d.id]) { pending[d.id](d.v); delete pending[d.id]; }
    if (d && d.t === 'prefs' && window.__onPrefs) window.__onPrefs(d.v);
    if (d && d.t === 'dock-fade' && window.__onDockFade) window.__onDockFade();
  });
  const bridge = {
    openBubble: (h) => post({ t: 'openBubble', h }),
    closeBubble: () => post({ t: 'closeBubble' }),
    closeDashboard: () => post({ t: 'close' }),
    toggleDock: () => post({ t: 'toggleDock' }),
    hideDock: () => post({ t: 'hideDock' }),
    toggleSettings: () => post({ t: 'toggleSettings' }),
    hideSettings: () => post({ t: 'hideSettings' }),
    hidePet: () => post({ t: 'hidePet' }),
    showPet: () => post({ t: 'showPet' }),
    quit: () => post({ t: 'quit' }),
    setPin: (v) => post({ t: 'setPin', v: !!v }),
    setEdge: (v) => post({ t: 'setEdge', v }),
    setAutostart: (v) => post({ t: 'setAutostart', v: !!v }),
    setWinHeight: (h) => post({ t: 'setWinHeight', hh: Number(h) || 0 }),
    openDataDir: () => post({ t: 'openDataDir' }),
    toggleCalibrator: () => post({ t: 'toggleCalibrator' }),
    openExternal: (u) => post({ t: 'openExternal', u }),
    openDashboard: () => post({ t: 'openDashboard' }),
    getState: () => new Promise((res) => { const id = ++cbId; pending[id] = res; post({ t: 'getState', id }); }),
    onPrefs: (cb) => { window.__onPrefs = cb; },
    onDockFade: (cb) => { window.__onDockFade = cb; },
    resizeStart: (dir) => post({ t: 'resizeStart', u: dir }),
    resizeEnd: () => post({ t: 'panelDragEnd' }),
    // C# 壳的穿透由分层窗口天然承担，形状上报全部 no-op
    sendChipRects: () => {}, sendDockShape: () => {}, sendPetShape: () => {},
    onDrag: () => {}, onDragPhys: () => {}, onCursorPos: () => {},
  };
  window.petBridge = bridge;
  window.bubbleBridge = bridge;
  document.addEventListener('DOMContentLoaded', () => {
    // 窗口视觉对齐 Electron 透明窗：设置页卡片去掉外圈留白/边框，
    // 圆角由宿主窗口的区域裁剪提供（WebView2 子 HWND 不支持真透明）
    const st = document.createElement('style');
    st.textContent = '#settings{margin:0!important;border:none!important;border-radius:0!important}';
    document.head.appendChild(st);
    // 面板拖动：对齐 Electron 的「主进程追踪光标」模式——JS 只报开始/结束，
    // 位移由宿主按全局光标计算（比逐条 mousemove 消息稳，不怕消息洪峰）
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('#bd-head') && !e.target.closest('button')) { post({ t: 'panelDragStart' }); e.preventDefault(); }
    }, true);
    document.addEventListener('mouseup', () => post({ t: 'panelDragEnd' }), true);
  });
})();";

        public PanelForm(string key, string url, int w, int h)
        {
            PanelKey = key;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = Shell.Pin;
            Size = new Size(w, h);
            KeyPreview = true;
            _wv = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(_wv);
            Load += async (_, __) =>
            {
                try
                {
                    var opt = new CoreWebView2EnvironmentOptions();
                    // 与 Electron 版同款反幽灵参数：禁止 Chromium 因遮挡停合成
                    opt.AdditionalBrowserArguments = "--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding";
                    var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Shell.DataRoot, "webview2-udata"), opt);
                    await _wv.EnsureCoreWebView2Async(env);
                    _wv.DefaultBackgroundColor = Color.FromArgb(0x14, 0x14, 0x16);   // = 面板 --card，避免异色边框
                    await _wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(SHIM);
                    _wv.CoreWebView2.WebMessageReceived += (_, ev) =>
                    {
                        try { Shell.OnBridgeMessage(this, _json.Deserialize<BridgeMsg>(ev.WebMessageAsJson)); } catch { }
                    };
                    _wv.Source = new Uri(url);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("面板初始化失败: " + ex.Message, "小黑猫");
                }
            };
            // 设置窗失焦自动收起（对齐 Electron 版 blur→hide）；气泡/仪表盘不收
            Deactivate += (_, __) => { if (PanelKey == "settings") Shell.ClosePanel(PanelKey); };
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); FixRegion(); }

        /// <summary>圆角窗口裁剪（WebView2 子窗口随父窗区域裁剪）</summary>
        public void FixRegion()
        {
            try
            {
                var rgn = CreateRoundRectRgn(0, 0, Width + 1, Height + 1, 14, 14);
                SetWindowRgn(Handle, rgn, true);
            }
            catch { }
        }

        /* ── 拖动/缩放：页面只报开始结束，宿主按全局光标追踪（与 Electron 主进程同款） ── */
        Timer _trackTimer;
        Point _cursor0;
        Rectangle _bounds0;
        string _trackDir;   // null=移动；n/s/e/w/ne/...=八向缩放

        public void BeginTrack(string dir)
        {
            _trackDir = dir;
            _cursor0 = Cursor.Position;
            _bounds0 = Bounds;
            if (_trackTimer == null)
            {
                _trackTimer = new Timer { Interval = 10 };
                _trackTimer.Tick += (_, __) => TrackTick();
            }
            _trackTimer.Start();
        }

        void TrackTick()
        {
            var cur = Cursor.Position;
            int dx = cur.X - _cursor0.X, dy = cur.Y - _cursor0.Y;
            if (_trackDir == null)
            {
                Location = new Point(_bounds0.X + dx, _bounds0.Y + dy);
                return;
            }
            int l = _bounds0.Left, t = _bounds0.Top, r = _bounds0.Right, b = _bounds0.Bottom;
            bool W = _trackDir.Contains("w"), E = _trackDir.Contains("e"), N = _trackDir.Contains("n"), S = _trackDir.Contains("s");
            if (W) l = Math.Min(_bounds0.Left + dx, r - 320);
            if (E) r = Math.Max(_bounds0.Right + dx, l + 320);
            if (N) t = Math.Min(_bounds0.Top + dy, b - 300);
            if (S) b = Math.Max(_bounds0.Bottom + dy, t + 300);
            SetBounds(l, t, r - l, b - t);
            FixRegion();   // 缩放后圆角区域跟着长
        }

        public void EndTrack()
        {
            if (_trackTimer == null) return;
            _trackTimer.Stop();
            Shell.SavePanelBounds(PanelKey, Bounds);   // 落定即记忆
        }

        public void AnswerCallback(int id, object value)
        {
            try { _wv?.CoreWebView2?.PostWebMessageAsJson(_json.Serialize(new { t = "cb", id, v = value })); } catch { }
        }

        /// <summary>关闭 = 销毁释放（「关掉就走」的内存语义，与 Electron 常驻相反）</summary>
        public void DisposeForReal()
        {
            try { _wv?.Dispose(); } catch { }
            try { Dispose(); } catch { }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape) { Shell.ClosePanel(PanelKey); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }
    }

    static class Program
    {
        [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
        [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);

        [STAThread]
        static void Main()
        {
            // WinForms 计时器默认粒度 ~15.6ms：60fps 呼吸会抖成 30-50ms 一帧（肉眼可见的卡）
            // timeBeginPeriod(1) 把本进程计时粒度提到 1ms——动画丝滑的关键
            timeBeginPeriod(1);
            // winexe 无控制台：全局异常一律落文件，崩溃有证据
            Directory.CreateDirectory(Shell.DataRoot);
            AppDomain.CurrentDomain.UnhandledException += (_, e) => Shell.LogCrash(e.ExceptionObject);
            Application.ThreadException += (_, e) => Shell.LogCrash("[UI] " + e.Exception);
            Application.EnableVisualStyles();
            Shell.EnsureServer();
            Shell.Pet = new PetWindow();
            Shell.Pet.Show();
            // 不绑主窗（ApplicationContext）：猫窗意外被关时进程不死、托盘还在
            Application.Run(new ApplicationContext());
            timeEndPeriod(1);
        }
    }
}
