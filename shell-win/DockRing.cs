// 小黑猫 C# 壳 —— harness 图标圆环（shell-win/DockRing.cs）
// 原生重画 dock 圆环：猫头顶上方的弧形芯片列。数据来自 /api/overview（3s 轮询，仅显示时）。
// 状态语义对齐 dock.js：整理模式关 → 全暗 0.38；10 分钟内有写盘 = 运行中 → 主题色光圈。
// 点击芯片 → 打开对应 harness 的思维面板。点猫 = 本环开关（PetWindow 单击触发）。

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace XiaoHeiMao
{
    public class DockRing : Form
    {
        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] struct SIZE { public int CX, CY; }
        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        struct BLENDFUNCTION { public byte Op, Flags, Alpha, Fmt; }
        [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT dst, ref SIZE size, IntPtr hdcSrc, ref POINT src, int crKey, ref BLENDFUNCTION blend, uint flags);
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);

        const int WS_EX_LAYERED = 0x80000, WS_EX_TOOLWINDOW = 0x80;

        const int RING_W = 280, RING_H = 150;      // 环窗尺寸（与猫窗同宽，悬在猫身侧）
        const int CHIP_D = 29;                      // 芯片直径（用户校准：缩小 20%）
        const double ARC_R = 96;                    // 弧线半径
        const double ARC_A0 = -210, ARC_A1 = -90;   // 扇形 120° 朝左：一条边垂直，容纳多 harness（用户校准）
        const double LIVE_MS = 10 * 60 * 1000;      // 10 分钟内有写盘 = 运行中

        // 配色/图标对齐 dock.js
        static readonly Dictionary<string, Color> ICON_COLOR = new Dictionary<string, Color>
        {
            ["claude-code"] = Color.FromArgb(0xfb, 0xbf, 0x24),
            ["dsh"] = Color.FromArgb(0x5e, 0xa3, 0xf7),
            ["codex"] = Color.FromArgb(0x5e, 0xea, 0xd4),
            ["gemini"] = Color.FromArgb(0x60, 0xa5, 0xfa),
            ["opencode"] = Color.FromArgb(0xc8, 0xc8, 0xcc),
            ["other"] = Color.FromArgb(0x6a, 0x6a, 0x72),
        };
        static readonly Dictionary<string, string> ICON_IMG = new Dictionary<string, string>
        {
            ["claude-code"] = "claude.png", ["opencode"] = "opencode.png", ["dsh"] = "dsh.png",
        };

        class Chip { public string H; public PointF Center; }
        List<Chip> _chips = new List<Chip>();
        Dictionary<string, long> _liveAt = new Dictionary<string, long>();
        Dictionary<string, Bitmap> _icons = new Dictionary<string, Bitmap>();
        bool _modeOn;
        public bool Guides = false;                 // 标定辅助线（圆心/扇形），默认关；菜单「圆环标定线」可再开
        readonly Timer _poll = new Timer { Interval = 3000 };
        bool _dirty = true;
        double _lastK = 1.0;

        /// <summary>辅助线开关切换后强制重画</summary>
        public void Redraw() { _dirty = true; if (IsHandleCreated) Render(); }

        public DockRing()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = Shell.Pin;
            Size = new Size(RING_W, RING_H);
            _poll.Tick += async (_, __) => { await RefreshData(); Follow(); };
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW; return cp; }
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            _poll.Enabled = Visible;
            if (Visible) { Follow(); var ignored = RefreshData(); }
        }

        /// <summary>弧几何全部随猫体型等比缩放：圆心偏移与半径 × ScaleK（基准=大档校准值）</summary>
        double EffArcR => ARC_R * (Shell.Pet?.ScaleK ?? 1.0);

        /// <summary>环贴猫身侧：圆心锚点（大档校准 = 猫左上角 +(135,160)）随体型等比移动。</summary>
        public void Follow()
        {
            if (Shell.Pet == null) return;
            double k = Shell.Pet.ScaleK;
            Location = new Point(
                Shell.Pet.Location.X + (int)Math.Round(135 * k) - RING_W / 2,
                Shell.Pet.Location.Y + (int)Math.Round(160 * k) - (RING_H - 10));
        }

        /// <summary>拉总览：harness 去重并集 + 各 harness 最近写盘时间 + 整理模式</summary>
        async Task RefreshData()
        {
            try
            {
                var json = await Shell.Http.GetStringAsync($"http://127.0.0.1:{Shell.Port}/api/overview");
                var ov = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                _modeOn = ov.TryGetValue("settings", out var st) && st is Dictionary<string, object> sd
                    && sd.TryGetValue("mode", out var m) && Convert.ToString(m) == "on";
                var live = new Dictionary<string, long>();
                // 注意：JavaScriptSerializer 把 JSON 数组解成 ArrayList 而非 object[]（实测），
                // 此前用 is object[] 判定恒 false → 芯片恒空 → 环隐形。集合一律走 IEnumerable。
                if (ov.TryGetValue("projects", out var ps) && ps is System.Collections.IEnumerable en)
                    foreach (var pobj in en)
                    {
                        if (!(pobj is Dictionary<string, object> p)) continue;
                        long liveAt = (long)Math.Round(Convert.ToDouble(p.TryGetValue("liveAtMs", out var l) ? l : 0));
                        if (p.TryGetValue("harnesses", out var hs) && hs is System.Collections.IEnumerable hen)
                            foreach (var h0 in hen)
                            {
                                var h = Convert.ToString(h0);
                                if (h != null && (!live.TryGetValue(h, out var cur) || liveAt > cur)) live[h] = liveAt;
                            }
                    }
                _liveAt = live;
                var keys = live.Keys.OrderBy(k => k).ToList();
                // 键集或猫体型变化都重排（体型换档 → 半径/圆心等比跟动）
                if (!keys.SequenceEqual(_chips.Select(c => c.H)) || Math.Abs((Shell.Pet?.ScaleK ?? 1.0) - _lastK) > 0.001)
                {
                    _lastK = Shell.Pet?.ScaleK ?? 1.0;
                    LayoutChips(keys);
                }
                _dirty = true;
                Render();
            }
            catch { }
        }

        void LayoutChips(List<string> keys)
        {
            _chips = new List<Chip>();
            int n = keys.Count;
            double aR = EffArcR;
            for (int i = 0; i < n; i++)
            {
                // 扇形 120° 朝左：-210°..-90°（一条边垂直）；单枚定在 -120°（用户校准位）
                double ang = n == 1 ? -120 : ARC_A0 + ((ARC_A1 - ARC_A0) / (n - 1)) * i;
                double rad = ang * Math.PI / 180;
                _chips.Add(new Chip
                {
                    H = keys[i],
                    Center = new PointF((float)(RING_W / 2 + aR * Math.Cos(rad)), (float)(RING_H - 10 + aR * Math.Sin(rad))),
                });
            }
        }

        Bitmap LoadIcon(string h)
        {
            if (_icons.TryGetValue(h, out var b)) return b;
            Bitmap img = null;
            try
            {
                if (ICON_IMG.TryGetValue(h, out var f))
                {
                    var p = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "icons", f);
                    if (File.Exists(p)) img = new Bitmap(p);
                }
            }
            catch { }
            _icons[h] = img;
            return img;
        }

        /// <summary>不透明化调暗：向面板底色混合。分层窗口里「半透明」=透视桌面，
        /// 透过圆盘看到桌面内容，观感糊——所以调暗一律用实心混合色，不降 alpha。</summary>
        static Color DimColor(Color c, double k)
        {
            Color bg = Color.FromArgb(0x14, 0x14, 0x16);
            return Color.FromArgb(255,
                (int)(bg.R + (c.R - bg.R) * k),
                (int)(bg.G + (c.G - bg.G) * k),
                (int)(bg.B + (c.B - bg.B) * k));
        }

        void Render()
        {
            if (!_dirty || !Visible || !IsHandleCreated) return;
            _dirty = false;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            using (var bmp = new Bitmap(RING_W, RING_H, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                foreach (var c in _chips)
                {
                    bool live = _modeOn && _liveAt.TryGetValue(c.H, out var la) && now - la < LIVE_MS;
                    var col = ICON_COLOR.TryGetValue(c.H, out var cc) ? cc : ICON_COLOR["other"];
                    double k = !_modeOn ? 0.38 : live ? 1.0 : 0.62;   // 关=暗 / 活=亮 / 待命=半亮（实心混合，非透明）
                    var rect = new RectangleF(c.Center.X - CHIP_D / 2f, c.Center.Y - CHIP_D / 2f, CHIP_D, CHIP_D);
                    using (var bg = new SolidBrush(Color.FromArgb(0x14, 0x14, 0x16)))   // 圆盘恒不透明
                    using (var ringPen = new Pen(live ? col : DimColor(col, k * 0.5), live ? 2.4f : 1f))
                    {
                        g.FillEllipse(bg, rect);
                        g.DrawEllipse(ringPen, rect);
                    }
                    var icon = LoadIcon(c.H);
                    if (icon != null)
                    {
                        // 图标 alpha 调暗没关系：它是叠在不透明圆盘上的，合成结果仍不透明
                        var cm = new ColorMatrix { Matrix33 = (float)k };
                        using (var ia = new ImageAttributes())
                        {
                            ia.SetColorMatrix(cm);
                            int s = 16;   // 用户校准：缩小 20%
                            g.DrawImage(icon, new Rectangle((int)(c.Center.X - s / 2), (int)(c.Center.Y - s / 2), s, s),
                                0, 0, icon.Width, icon.Height, GraphicsUnit.Pixel, ia);
                        }
                    }
                    else
                    {
                        using (var fg = new SolidBrush(DimColor(Color.FromArgb(0xec, 0xec, 0xec), k)))
                        using (var font = new Font("Segoe UI", 8f, FontStyle.Bold))
                        {
                            var sz = g.MeasureString(c.H.Substring(0, 1).ToUpper(), font);
                            g.DrawString(c.H.Substring(0, 1).ToUpper(), font, fg, c.Center.X - sz.Width / 2, c.Center.Y - sz.Height / 2);
                        }
                    }
                }

                // 标定辅助线：圆心十字 + 扇形弧线 + 边界射线（用户对着屏幕指挥微调用）
                if (Guides)
                {
                    var center = new PointF(RING_W / 2f, RING_H - 10);
                    float gR = (float)EffArcR;
                    using (var pen = new Pen(Color.FromArgb(0xf0, 0x71, 0x6c)) { DashStyle = DashStyle.Dash })
                    {
                        g.DrawArc(pen, center.X - gR, center.Y - gR, gR * 2, gR * 2, (float)ARC_A0, (float)(ARC_A1 - ARC_A0));
                        g.DrawLine(pen, center.X - 10, center.Y, center.X + 10, center.Y);
                        g.DrawLine(pen, center.X, center.Y - 10, center.X, center.Y + 10);
                        g.DrawLine(pen, center.X, center.Y,
                            center.X + (float)(gR * Math.Cos(ARC_A0 * Math.PI / 180)), center.Y + (float)(gR * Math.Sin(ARC_A0 * Math.PI / 180)));
                        g.DrawLine(pen, center.X, center.Y,
                            center.X + (float)(gR * Math.Cos(ARC_A1 * Math.PI / 180)), center.Y + (float)(gR * Math.Sin(ARC_A1 * Math.PI / 180)));
                    }
                    using (var fg = new SolidBrush(Color.FromArgb(0xf0, 0x71, 0x6c)))
                    using (var font = new Font("Microsoft YaHei", 7.5f))
                    {
                        var sc = Location;
                        g.DrawString($"圆心(屏 {sc.X + 140},{sc.Y + 140})  半径{gR:F0}  弧 {ARC_A0}°..{ARC_A1}°", font, fg, 4, 2);
                    }
                }
                Premultiply(bmp);
                Push(bmp);
            }
        }

        static void Premultiply(Bitmap bmp)
        {
            var r = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            unsafe
            {
                byte* p = (byte*)r.Scan0;
                for (int i = 0; i < r.Width * r.Height; i++, p += 4)
                {
                    byte a = p[3];
                    p[0] = (byte)(p[0] * a / 255); p[1] = (byte)(p[1] * a / 255); p[2] = (byte)(p[2] * a / 255);
                }
            }
            bmp.UnlockBits(r);
        }

        void Push(Bitmap bmp)
        {
            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr mem = CreateCompatibleDC(screen);
            IntPtr hbmp = bmp.GetHbitmap(Color.FromArgb(0));
            IntPtr old = SelectObject(mem, hbmp);
            var dst = new POINT { X = Location.X, Y = Location.Y };
            var src = new POINT { X = 0, Y = 0 };
            var size = new SIZE { CX = RING_W, CY = RING_H };
            var blend = new BLENDFUNCTION { Op = 255, Flags = 0, Alpha = 255, Fmt = 1 };
            UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2);
            SelectObject(mem, old);
            DeleteObject(hbmp);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }

        /// <summary>点击 = 命中检测（芯片圆盘内才算，其余区域本来就穿透）</summary>
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            foreach (var c in _chips)
            {
                if (Math.Pow(e.X - c.Center.X, 2) + Math.Pow(e.Y - c.Center.Y, 2) <= (CHIP_D / 2 + 6) * (CHIP_D / 2 + 6))
                {
                    Shell.TogglePanel("bubble", $"http://127.0.0.1:{Shell.Port}/bubble.html?harness={Uri.EscapeDataString(c.H)}&side=taskbar", 470, 660);
                    return;
                }
            }
        }
    }
}
