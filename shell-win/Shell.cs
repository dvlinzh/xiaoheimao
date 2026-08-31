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
        public const int Port = 13134;

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
            ClosePanel(key);
            var pf = new PanelForm(key, url, w, h);
            PositionNearPet(pf, key == "dashboard");
            _panels[key] = pf;
            pf.Show();
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
            int x = Pet.Location.X - f.Width - 8;
            if (x < wa.Left) x = Pet.Right + 8;   // 猫太靠左就弹右侧
            int y = Math.Max(wa.Top + 8, Math.Min(Pet.Location.Y - 60, wa.Bottom - f.Height - 8));
            f.Location = new Point(x, y);
        }

        /// <summary>页面桥消息分发</summary>
        public static void OnBridgeMessage(PanelForm from, BridgeMsg m)
        {
            switch (m.t)
            {
                case "openBubble":
                    TogglePanel("bubble", $"http://127.0.0.1:{Port}/bubble.html?harness={Uri.EscapeDataString(m.h ?? "claude-code")}&side=taskbar", 380, 660);
                    break;
                case "openDashboard":
                    TogglePanel("dashboard", $"http://127.0.0.1:{Port}/dashboard.html", 860, 580);
                    break;
                case "toggleSettings":
                    TogglePanel("settings", $"http://127.0.0.1:{Port}/settings.html", 340, 480);
                    break;
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
    resizeStart: () => {}, resizeEnd: () => {},
    // C# 壳的穿透由分层窗口天然承担，形状上报全部 no-op
    sendChipRects: () => {}, sendDockShape: () => {}, sendPetShape: () => {},
    onDrag: () => {}, onDragPhys: () => {}, onCursorPos: () => {},
  };
  window.petBridge = bridge;
  window.bubbleBridge = bridge;
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
                    _wv.DefaultBackgroundColor = Color.FromArgb(0x2b, 0x27, 0x23);   // 与面板底色一致，避免白闪
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
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Shell.EnsureServer();
            Shell.Pet = new PetWindow();
            Application.Run(Shell.Pet);
        }
    }
}
