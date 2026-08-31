// 小黑猫 C# 壳 —— M1 原型（shell-win/PetCat.cs）
// Win32 分层窗口（UpdateLayeredWindow）：逐像素 alpha，alpha=0 处鼠标天然穿透，
// 无需 Electron 那套 setShape 迂回。呼吸/拖拽/贴边/右键菜单/托盘。
// 编译：build.bat（用 Windows 自带 csc.exe，零安装）

using System;
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

        /* ── 配置 ─────────────────────────────────────────── */
        const int WIN_W = 280, WIN_H = 250;       // 与 Electron 版窗口同尺寸
        const int BURY = 13;                       // 脚底没入任务栏的像素（对齐原版参数）
        const double BREATH_AMP = 0.012;           // 呼吸幅度 1.2%
        const double BREATH_MS = 2600;             // 呼吸周期

        readonly Bitmap _idle, _walk;              // 已做 alpha 阈值+预乘的源图
        readonly Timer _anim = new Timer { Interval = 33 };   // ~30fps 足够，60 是浪费电
        readonly DateTime _t0 = DateTime.UtcNow;
        readonly NotifyIcon _tray;
        bool _dragging;
        Point _dragOffset;
        double _hop;                                // 双击跳起的剩余高度

        public PetWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            Size = new Size(WIN_W, WIN_H);
            Location = SnapPos();

            var dir = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets");
            _idle = Prepare(Image.FromFile(System.IO.Path.Combine(dir, "cat-idle.png")));
            _walk = Prepare(Image.FromFile(System.IO.Path.Combine(dir, "cat-walk.png")));

            // 右键菜单（无窗口边框，菜单就是唯一操作面）
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开思维面板", null, (_, __) => System.Diagnostics.Process.Start("http://127.0.0.1:13134/dashboard.html"));
            menu.Items.Add("设置", null, (_, __) => System.Diagnostics.Process.Start("http://127.0.0.1:13134/settings.html"));
            menu.Items.Add("隐藏（托盘找回）", null, (_, __) => Hide());
            menu.Items.Add("退出", null, (_, __) => Application.Exit());
            ContextMenuStrip = menu;

            _tray = new NotifyIcon
            {
                Text = "思维板·小黑猫",
                Icon = Icon.FromHandle(((Bitmap)_idle.Clone()).GetHicon()),
                Visible = true,
            };
            _tray.DoubleClick += (_, __) => { Show(); forceVisible(); };
            _tray.ContextMenuStrip = menu;

            _anim.Tick += (_, __) => Render();
            _anim.Start();
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW; return cp; }
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Render(); }

        /// <summary>贴边：右缘 + 坐任务栏上沿</summary>
        static Point SnapPos()
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            // 原型期左移 300px：与 Electron 猫并排对照手感/内存；正式替换后去掉这个偏移
            return new Point(wa.Right - WIN_W - 12 - 300, wa.Bottom - WIN_H + BURY);
        }

        /// <summary>源图预处理：alpha<100 的半透明光晕直接归零（让鼠标穿透，
        /// 命中区=猫本体），剩余像素做 alpha 预乘（UpdateLayeredWindow 的要求）。</summary>
        static Bitmap Prepare(Image src)
        {
            var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp)) g.DrawImageUnscaled(src, 0, 0);
            var r = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            unsafe
            {
                byte* p = (byte*)r.Scan0;
                for (int i = 0; i < r.Width * r.Height; i++, p += 4)
                {
                    byte a = p[3];
                    if (a < 100) { p[0] = p[1] = p[2] = p[3] = 0; continue; }
                    p[0] = (byte)(p[0] * a / 255); p[1] = (byte)(p[1] * a / 255); p[2] = (byte)(p[2] * a / 255);
                }
            }
            bmp.UnlockBits(r);
            return bmp;
        }

        /// <summary>每帧：呼吸缩放（绕底部中心）→ 画上画布 → 推给 DWM</summary>
        void Render()
        {
            double t = (DateTime.UtcNow - _t0).TotalMilliseconds / BREATH_MS * 2 * Math.PI;
            double breath = Math.Sin(t);
            var src = _dragging ? _walk : _idle;
            // 各姿态尺寸不一：先等比塞进窗口（fit），再叠加呼吸缩放
            double fit = Math.Min((double)WIN_W / src.Width, (double)WIN_H / src.Height);
            double scaleX = fit * (1 + BREATH_AMP * breath), scaleY = fit * (1 + BREATH_AMP * 0.6 * breath);
            int dw = (int)(src.Width * scaleX), dh = (int)(src.Height * scaleY);
            int dx = (WIN_W - dw) / 2, dy = WIN_H - dh - (int)_hop;   // 脚底对齐画布底

            using (var canvas = new Bitmap(WIN_W, WIN_H, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(canvas))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(src, dx, dy, dw, dh);
                }
                PremultiplyInPlace(canvas);
                PushToScreen(canvas);
            }
            if (_hop > 0) _hop = Math.Max(0, _hop - 2.5);
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
            var dst = new POINT { X = Location.X, Y = Location.Y };
            var src = new POINT { X = 0, Y = 0 };
            var size = new SIZE { CX = WIN_W, CY = WIN_H };
            var blend = new BLENDFUNCTION { Op = 255, Flags = 0, Alpha = 255, Fmt = AC_SRC_ALPHA };
            UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2 /*ULW_ALPHA*/);
            SelectObject(mem, old);
            DeleteObject(hbmp);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }

        /* ── 交互 ─────────────────────────────────────────── */
        // 分层窗口的命中由 alpha 决定：点在猫本体上才会收到这些事件，光晕处直接穿透
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
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
                var cur = PointToScreen(e.Location);
                var next = new Point(cur.X - _dragOffset.X, cur.Y - _dragOffset.Y);
                if (Math.Abs(next.X - Location.X) + Math.Abs(next.Y - Location.Y) > 3) _dragging = true;
                Location = next;   // 位置由窗口移动承担，Render 只管画面
            }
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            Capture = false;
            if (_dragging) { _dragging = false; Location = SnapPos(); }
        }
        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            base.OnMouseDoubleClick(e);
            if (e.Button == MouseButtons.Left) _hop = 22;   // 双击颠一下（简化版颠球）
        }

        void forceVisible() { Location = SnapPos(); Render(); }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { _anim.Dispose(); _tray.Dispose(); _idle.Dispose(); _walk.Dispose(); }
            base.Dispose(disposing);
        }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.Run(new PetWindow());
        }
    }
}
