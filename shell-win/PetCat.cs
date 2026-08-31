// 小黑猫 C# 壳 —— 猫窗（shell-win/PetCat.cs）
// Win32 分层窗口（UpdateLayeredWindow）：逐像素 alpha，alpha=0 处鼠标天然穿透。
// 渲染：独立线程稳帧 30fps（Stopwatch 配速，避开消息队列的 WM_TIMER 合并抖动）；
//       画布复用不逐帧分配；尺寸/脚底对齐/呼吸参数对齐 Electron 版（原图 × 0.42）。
// 交互：拖拽（走姿+摆动弹簧）/ 单击=圆环开关（280ms 消歧）/ 双击=颠 / 右键菜单 / 托盘。
// 生命感：闲置 5 分钟趴下（睡眠姿态）；AI 写入思维板 → 头顶冒对话框（journal 联动）。

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace XiaoHeiMao
{
    public class PetWindow : Form
    {
        /* ── Win32 ─────────────────────────────────────────── */
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
        const byte AC_SRC_ALPHA = 1;

        /* ── 配置（与 Electron 版 skin-cat.js 对齐） ────────── */
        const int WIN_W = 280, WIN_H = 250;
        const int BURY = 13;
        const double BREATH_AMP = 0.012, BREATH_MS = 2600, SCALE = 0.42;
        const int FOOT_MARGIN = 2;
        const int FRAME_MS = 33;                    // 30fps：呼吸是慢波，30/60 肉眼无差（用户实测确认）
        const int IDLE_SLEEP_MS = 5 * 60 * 1000;    // 闲置 5 分钟趴下

        class Pose { public Bitmap Bmp; public int FootRow; }
        readonly Pose _idle, _walk, _sleep;

        /* 渲染线程专用状态（UI 线程只写位置缓存/标志位） */
        volatile bool _running = true;
        System.Threading.Thread _renderThread;
        int _locX, _locY;                            // 位置缓存：int 读写原子
        Bitmap _frame;                               // 复用画布，不逐帧分配
        readonly DateTime _t0 = DateTime.UtcNow;

        /* UI 线程状态 */
        bool _dragging; Point _dragOffset;
        double _hop, _swingAng, _swingTarget; Point _lastCursor;
        DateTime _lastActive = DateTime.UtcNow;
        volatile string _speech; volatile int _speechUntilSec = -1;   // AI 写入时头顶冒泡（秒数相对 _t0）
        readonly Timer _clickTimer = new Timer { Interval = 280 };   // 单击/双击消歧
        readonly NotifyIcon _tray;

        public PetWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = Shell.Pin;
            Size = new Size(WIN_W, WIN_H);

            var dir = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets");
            _idle = Prepare(Image.FromFile(System.IO.Path.Combine(dir, "cat-idle.png")));
            _walk = Prepare(Image.FromFile(System.IO.Path.Combine(dir, "cat-walk.png")));
            _sleep = Prepare(Image.FromFile(System.IO.Path.Combine(dir, "cat-sleep.png")));

            var wa0 = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa0.Right - WIN_W - 312, wa0.Bottom - WIN_H + BURY);   // 原型期与 Electron 猫并排对照
            _locX = Location.X; _locY = Location.Y;

            // 右键菜单（无窗口边框，菜单就是唯一操作面）——面板/设置走内嵌 WebView2 窗，不开浏览器
            var menu = new ContextMenuStrip();
            menu.Renderer = new DarkMenuRenderer();   // 深色主题，跟面板同色系
            menu.ForeColor = Color.FromArgb(0xec, 0xec, 0xec);
            menu.BackColor = Color.FromArgb(0x14, 0x14, 0x16);
            var miMode = new ToolStripMenuItem("整理模式");
            miMode.Click += async (_, __) => { await Shell.ToggleModeAsync(); };
            menu.Items.Add(miMode);
            menu.Opening += (_, __) =>
            {
                miMode.Text = Shell.ModeCache == "on" ? "整理模式：开（点击关闭）" : "整理模式：关（点击开启）";
                var ignored = Shell.RefreshModeAsync();   // 后台刷新，下次打开菜单就是新状态
            };
            menu.Items.Add("思维面板", null, (_, __) => Shell.TogglePanel("bubble", $"http://127.0.0.1:{Shell.Port}/bubble.html?harness=claude-code&side=taskbar", 470, 660));
            menu.Items.Add("项目仪表盘", null, (_, __) => Shell.TogglePanel("dashboard", $"http://127.0.0.1:{Shell.Port}/dashboard.html", 860, 580));
            menu.Items.Add("设置", null, (_, __) => Shell.TogglePanel("settings", $"http://127.0.0.1:{Shell.Port}/settings.html", 274, 420));
            menu.Items.Add("圆环标定线", null, (_, __) => Shell.ToggleRingGuides());
            menu.Items.Add("隐藏（托盘找回）", null, (_, __) => { Hide(); Shell.HideRing(); });
            menu.Items.Add("退出", null, (_, __) => Application.Exit());
            ContextMenuStrip = menu;

            _tray = new NotifyIcon
            {
                Text = "思维板·小黑猫",
                Icon = Icon.FromHandle(((Bitmap)_idle.Bmp.Clone()).GetHicon()),
                Visible = true,
            };
            _tray.DoubleClick += (_, __) => { Show(); Location = SnapPos(Location.X); };
            _tray.ContextMenuStrip = menu;

            _clickTimer.Tick += (_, __) => { _clickTimer.Stop(); Shell.ToggleRing(); };
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW; return cp; }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            _renderThread = new System.Threading.Thread(RenderLoop) { IsBackground = true, Name = "pet-render" };
            _renderThread.Start();
        }

        protected override void OnLocationChanged(EventArgs e)
        {
            base.OnLocationChanged(e);
            _locX = Location.X; _locY = Location.Y;
        }

        /// <summary>贴边：x 跟松手位置（夹在屏幕内），y 坐到任务栏上沿</summary>
        static Point SnapPos(int dropX)
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            int x = Math.Max(wa.Left, Math.Min(dropX, wa.Right - WIN_W));
            return new Point(x, wa.Bottom - WIN_H + BURY);
        }

        /// <summary>源图预处理：①扫描脚底行（最低不透明行，alpha>8——各姿态底部留白不同，
        /// 按脚底对齐窗口底，否则趴睡会悬空）②alpha<100 的光晕归零（鼠标穿透，命中区=猫本体）
        /// ③剩余像素 alpha 预乘（UpdateLayeredWindow 的要求）。</summary>
        static Pose Prepare(Image src)
        {
            var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp)) g.DrawImageUnscaled(src, 0, 0);
            var r = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int foot = bmp.Height - 1;
            unsafe
            {
                byte* base0 = (byte*)r.Scan0;
                int stride = r.Stride;
                for (int y = bmp.Height - 1; y >= 0; y--)
                {
                    byte* row = base0 + y * stride;
                    bool any = false;
                    for (int x = 0; x < bmp.Width; x++) if (row[x * 4 + 3] > 8) { any = true; break; }
                    if (any) { foot = y; break; }
                }
                for (int i = 0; i < bmp.Height * bmp.Width; i++)
                {
                    byte* p = base0 + (i / bmp.Width) * stride + (i % bmp.Width) * 4;
                    byte a = p[3];
                    if (a < 100) { p[0] = p[1] = p[2] = p[3] = 0; continue; }
                    p[0] = (byte)(p[0] * a / 255); p[1] = (byte)(p[1] * a / 255); p[2] = (byte)(p[2] * a / 255);
                }
            }
            bmp.UnlockBits(r);
            return new Pose { Bmp = bmp, FootRow = foot };
        }

        /* ── 渲染循环（独立线程，稳帧） ─────────────────────── */
        void RenderLoop()
        {
            _frame = new Bitmap(WIN_W, WIN_H, PixelFormat.Format32bppArgb);
            var sw = Stopwatch.StartNew();
            while (_running)
            {
                long frameStart = sw.ElapsedMilliseconds;
                try { RenderFrame(); } catch (Exception ex) { Shell.LogCrash(ex); }
                long cost = sw.ElapsedMilliseconds - frameStart;
                int sleep = (int)(FRAME_MS - cost);
                System.Threading.Thread.Sleep(sleep > 2 ? sleep : 2);
            }
        }

        void RenderFrame()
        {
            double t = (Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency * 1000.0) / BREATH_MS * 2 * Math.PI;
            double breath = Math.Sin(t);

            // 闲置趴下：超时且不在拖拽 → 睡眠姿态
            bool asleep = !_dragging && (DateTime.UtcNow - _lastActive).TotalMilliseconds > IDLE_SLEEP_MS;
            var pose = _dragging ? _walk : (asleep ? _sleep : _idle);
            var src = pose.Bmp;

            // 拖拽摆动弹簧：手速驱动目标摆角，角度向目标收敛（对齐 skin-cat.js）
            var cur = Cursor.Position;
            if (_dragging)
            {
                int vx = cur.X - _lastCursor.X;
                _swingTarget = Math.Max(-0.26, Math.Min(0.26, -vx * 0.012 * 2));   // 帧×2 补偿到原 16ms 语义
            }
            else _swingTarget = 0;
            _swingAng += (_swingTarget - _swingAng) * 0.10;
            _lastCursor = cur;

            double scaleX = SCALE * (1 + BREATH_AMP * breath);
            double scaleY = SCALE * (1 + BREATH_AMP * 0.6 * breath);
            int dw = (int)(src.Width * scaleX), dh = (int)(src.Height * scaleY);
            int dx = (WIN_W - dw) / 2;
            int dy = WIN_H - FOOT_MARGIN - (int)((pose.FootRow + 1) * scaleY) - (int)_hop;

            using (var g = Graphics.FromImage(_frame))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBilinear;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                if (_dragging || Math.Abs(_swingAng) > 0.004)
                {
                    // 拎起摆动：固定点 = 头中心（头不动，身体随手速甩）
                    float px = dx + dw * 0.5f, py = dy + dh * 0.20f;
                    g.TranslateTransform(px, py);
                    g.RotateTransform((float)(_swingAng * 180 / Math.PI));
                    g.TranslateTransform(-px, -py);
                }
                g.DrawImage(src, dx, dy, dw, dh);

                // 对话框（journal 联动：AI 写入时冒泡）
                if (_speech != null && (int)(DateTime.UtcNow - _t0).TotalSeconds < _speechUntilSec) DrawSpeech(g, _speech);
            }
            PremultiplyInPlace(_frame);
            PushToScreen(_frame);
            if (_hop > 0) _hop = Math.Max(0, _hop - 5);
        }

        /// <summary>头顶对话框：深色圆角小卡 + 小尾巴指向猫，与面板同色系</summary>
        static void DrawSpeech(Graphics g, string text)
        {
            using (var font = new Font("Microsoft YaHei", 9f, FontStyle.Regular))
            {
                var size = g.MeasureString(text, font);
                int bw = Math.Min((int)size.Width + 20, 210), bh = (int)size.Height + 12;
                int bx = (WIN_W - bw) / 2, by = 6;
                using (var path = RoundedRect(bx, by, bw, bh, 9))
                using (var bg = new SolidBrush(Color.FromArgb(0x14, 0x14, 0x16)))
                using (var pen = new Pen(Color.FromArgb(0x28, 0x28, 0x2e)))
                {
                    g.FillPath(bg, path);
                    g.DrawPath(pen, path);
                    // 小尾巴（朝下，指猫头）
                    g.FillPolygon(bg, new[] { new Point(bx + bw / 2 - 5, by + bh - 1), new Point(bx + bw / 2 + 5, by + bh - 1), new Point(bx + bw / 2, by + bh + 6) });
                }
                using (var fg = new SolidBrush(Color.FromArgb(0xec, 0xec, 0xec)))
                    g.DrawString(text, font, fg, bx + 10, by + 6);
            }
        }

        static GraphicsPath RoundedRect(int x, int y, int w, int h, int r)
        {
            var p = new GraphicsPath();
            p.AddArc(x, y, r * 2, r * 2, 180, 90); p.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
            p.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90); p.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
            p.CloseFigure();
            return p;
        }

        /// <summary>AI 写入时冒泡（journal 联动）。同时把猫叫醒。</summary>
        public void ShowSpeech(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            _speech = text.Length > 24 ? text.Substring(0, 24) : text;
            _speechUntilSec = (int)(DateTime.UtcNow - _t0).TotalSeconds + 4;
            _lastActive = DateTime.UtcNow;
        }

        static void PremultiplyInPlace(Bitmap bmp)
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

        void PushToScreen(Bitmap bmp)
        {
            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr mem = CreateCompatibleDC(screen);
            IntPtr hbmp = bmp.GetHbitmap(Color.FromArgb(0));
            IntPtr old = SelectObject(mem, hbmp);
            var dst = new POINT { X = _locX, Y = _locY };
            var src = new POINT { X = 0, Y = 0 };
            var size = new SIZE { CX = WIN_W, CY = WIN_H };
            var blend = new BLENDFUNCTION { Op = 255, Flags = 0, Alpha = 255, Fmt = AC_SRC_ALPHA };
            UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2 /*ULW_ALPHA*/);
            SelectObject(mem, old);
            DeleteObject(hbmp);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }

        /* ── 交互（UI 线程） ────────────────────────────────── */
        // 分层窗口的命中由 alpha 决定：点在猫本体上才会收到这些事件，光晕处直接穿透
        protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); _lastActive = DateTime.UtcNow; }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            _lastActive = DateTime.UtcNow;
            if (e.Button == MouseButtons.Left)
            {
                _dragging = false;
                _dragOffset = new Point(e.X, e.Y);
                Capture = true;
            }
        }
        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (Capture && e.Button == MouseButtons.Left)
            {
                _lastActive = DateTime.UtcNow;
                var cur = PointToScreen(e.Location);
                var next = new Point(cur.X - _dragOffset.X, cur.Y - _dragOffset.Y);
                if (Math.Abs(next.X - Location.X) + Math.Abs(next.Y - Location.Y) > 3) _dragging = true;
                if (_dragging) { _locX = next.X; _locY = next.Y; Location = next; }
            }
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            Capture = false;
            if (_dragging)
            {
                _dragging = false;
                var snapped = SnapPos(Location.X);
                _locX = snapped.X; _locY = snapped.Y; Location = snapped;
            }
            else _clickTimer.Start();   // 280ms 内无第二击 → 单击 = 圆环开关
        }
        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            base.OnMouseDoubleClick(e);
            _lastActive = DateTime.UtcNow;
            if (e.Button == MouseButtons.Left) { _clickTimer.Stop(); _hop = 22; }   // 双击 = 颠（取消单击）
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _running = false;
                try { if (_renderThread != null && !_renderThread.Join(500)) _renderThread.Abort(); } catch { }
                _frame?.Dispose(); _tray.Dispose();
                _idle.Bmp.Dispose(); _walk.Bmp.Dispose(); _sleep.Bmp.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    /// <summary>右键菜单深色渲染（对齐面板 --card/--line/--text 配色）</summary>
    class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColors()) { }
        class DarkColors : ProfessionalColorTable
        {
            static readonly Color Bg = Color.FromArgb(0x14, 0x14, 0x16);
            static readonly Color Hover = Color.FromArgb(0x20, 0x20, 0x24);
            static readonly Color Line = Color.FromArgb(0x28, 0x28, 0x2e);
            public override Color MenuStripGradientBegin => Bg;
            public override Color MenuStripGradientEnd => Bg;
            public override Color ToolStripDropDownBackground => Bg;
            public override Color ImageMarginGradientBegin => Bg;
            public override Color ImageMarginGradientMiddle => Bg;
            public override Color ImageMarginGradientEnd => Bg;
            public override Color MenuItemSelected => Hover;
            public override Color MenuItemBorder => Line;
            public override Color MenuBorder => Line;
            public override Color ToolStripBorder => Line;
            public override Color SeparatorDark => Line;
            public override Color SeparatorLight => Line;
            public override Color MenuItemPressedGradientBegin => Hover;
            public override Color MenuItemPressedGradientMiddle => Hover;
            public override Color MenuItemPressedGradientEnd => Hover;
            public override Color MenuItemSelectedGradientBegin => Hover;
            public override Color MenuItemSelectedGradientEnd => Hover;
        }
    }

    // 入口在 Shell.cs（Program.Main：先 EnsureServer 再起猫窗）
}
