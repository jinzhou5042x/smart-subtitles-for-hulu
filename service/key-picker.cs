using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Globalization;
using System.Windows.Forms;

public static class SubtitleKeyPicker {
  [STAThread] public static void Main(string[] args) {
    // GUI executables have redirected pipe handles, but no console code page.
    // Encoding setters call console-only APIs and fail with INVALID_HANDLE.
    Console.SetIn(new System.IO.StreamReader(Console.OpenStandardInput(), Encoding.UTF8));
    Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
    try { Run(args[0], int.Parse(args[1]), args[2]); }
    catch { Emit("{\"event\":\"error\"}"); }
  }
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr types);
    void SetFileTypeIndex(uint index); void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie); void Unadvise(uint cookie);
    void SetOptions(uint options); void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item); void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item); void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint type, out IntPtr name);
  }
  static string Choose(string mode, IntPtr browser) {
    var dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
    try {
      uint options; dialog.GetOptions(out options);
      // Modern Explorer picker, filesystem only; do not add key paths to Recent Items.
      dialog.SetOptions(options | 0x40u | 0x02000000u | 0x1000u);
      dialog.SetTitle("Choose Google API key file");
      int result = dialog.Show(browser);
      if (result == unchecked((int)0x800704C7)) return "";
      Marshal.ThrowExceptionForHR(result);
      IShellItem item; dialog.GetResult(out item);
      try { IntPtr value; item.GetDisplayName(0x80058000, out value); try { return Marshal.PtrToStringUni(value); } finally { Marshal.FreeCoTaskMem(value); } }
      finally { Marshal.ReleaseComObject(item); }
    } finally { Marshal.ReleaseComObject(dialog); }
  }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int count);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] static extern int SetWindowLong(IntPtr window, int index, int value);
  static IntPtr BrowserWindow(double[] anchor) {
    IntPtr best = IntPtr.Zero, foreground = GetForegroundWindow();
    double score = double.MaxValue;
    EnumWindows(delegate(IntPtr w, IntPtr unused) {
      var name = new StringBuilder(256); GetClassName(w, name, name.Capacity);
      Rect r;
      if (!IsWindowVisible(w) || !name.ToString().StartsWith("Chrome_WidgetWin_") || !GetWindowRect(w, out r) || r.Right-r.Left < 400 || r.Bottom-r.Top < 300) return true;
      double distance = Math.Abs(r.Left-anchor[0]) + Math.Abs(r.Top-anchor[1]) + Math.Abs(r.Right-r.Left-anchor[2]) + Math.Abs(r.Bottom-r.Top-anchor[3]);
      if (anchor[2] <= 0 && w == foreground) distance = -1;
      if (distance < score) { score = distance; best = w; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
  public static int[] Center(int left, int top, int width, int height, double topRatio, double heightRatio, int dialogWidth, int dialogHeight) {
    topRatio = Math.Max(0, Math.Min(1, topRatio));
    heightRatio = Math.Max(0, Math.Min(1-topRatio, heightRatio));
    return new int[] { left + (width-dialogWidth)/2, top + (int)Math.Round(height*(topRatio+heightRatio/2)) - dialogHeight/2 };
  }
  static void Present(IntPtr dialog, IntPtr browser, double[] anchor) {
    if (IsIconic(browser)) ShowWindow(browser, 9);
    ShowWindow(dialog, 9);
    Rect page, box;
    if (!GetWindowRect(browser, out page)) {
      page = new Rect { Left=(int)anchor[0], Top=(int)anchor[1], Right=(int)(anchor[0]+anchor[2]), Bottom=(int)(anchor[1]+anchor[3]) };
    }
    if (page.Right > page.Left && page.Bottom > page.Top && GetWindowRect(dialog, out box)) {
      int width=box.Right-box.Left, height=box.Bottom-box.Top;
      int[] point=Center(page.Left,page.Top,page.Right-page.Left,page.Bottom-page.Top,anchor[4],anchor[5],width,height);
      var work=Screen.FromRectangle(new System.Drawing.Rectangle(page.Left,page.Top,page.Right-page.Left,page.Bottom-page.Top)).WorkingArea;
      int x=Math.Max(work.Left,Math.Min(point[0],work.Right-width));
      int y=Math.Max(work.Top,Math.Min(point[1],work.Bottom-height));
      SetWindowPos(dialog,IntPtr.Zero,x,y,0,0,0x0015);
    }
    SetForegroundWindow(dialog);
  }
  static IntPtr DialogWindow(IntPtr owner) {
    IntPtr found = IntPtr.Zero;
    uint current = (uint)Process.GetCurrentProcess().Id;
    EnumWindows(delegate(IntPtr w, IntPtr d) {
      uint pid; GetWindowThreadProcessId(w, out pid);
      var name = new StringBuilder(256); GetClassName(w, name, name.Capacity);
      Rect bounds;
      if (pid == current && w != owner && name.ToString() == "#32770" && IsWindowVisible(w) && GetWindowRect(w, out bounds) && bounds.Right-bounds.Left > 100 && bounds.Bottom-bounds.Top > 100) { found = w; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  static void Emit(string json) { Console.WriteLine(json); Console.Out.Flush(); }
  static string Quote(string value) {
    return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t") + "\"";
  }
  public static void Run(string mode, int parentPid, string anchorText) {
    double[] anchor = new double[] {0,0,0,0,0,1};
    string[] parts = (anchorText ?? "").Split(',');
    for (int i=0; i<Math.Min(parts.Length,6); i++) { double value; if (double.TryParse(parts[i],NumberStyles.Float,CultureInfo.InvariantCulture,out value) && !double.IsNaN(value) && !double.IsInfinity(value)) anchor[i]=value; }
    IntPtr browser = BrowserWindow(anchor);
    Application.EnableVisualStyles();
    var commands = new ConcurrentQueue<string>();
    var reader = new Thread(delegate() {
      try { string line; while ((line = Console.ReadLine()) != null) commands.Enqueue(line); } catch {}
      commands.Enqueue("cancel");
    });
    reader.IsBackground = true; reader.Start();
    using (var owner = new Form()) {
      // Hidden message-pump host only: never show a second owner window.
      owner.ShowInTaskbar = false;
      IntPtr hostHandle = owner.Handle;
      IntPtr lastDialog = IntPtr.Zero;
      bool cancelling = false;
      using (var timer = new System.Windows.Forms.Timer()) {
        timer.Interval = 400;
        timer.Tick += delegate {
          IntPtr dialog = DialogWindow(owner.Handle);
          if (dialog != IntPtr.Zero && dialog != lastDialog) {
            // The dialog is owned by Chrome, but must remain discoverable in Alt+Tab
            // when Chrome's transient extension popup closes.
            SetWindowLong(dialog, -20, GetWindowLong(dialog, -20) | 0x00040000);
            ShowWindow(dialog, 0);
            Present(dialog, browser, anchor);
          }
          lastDialog = dialog;
          Emit("{\"event\":\"window\",\"pid\":" + Process.GetCurrentProcess().Id + ",\"handle\":" + Quote(dialog.ToInt64().ToString()) + "}");
          try { if (Process.GetProcessById(parentPid).HasExited) cancelling = true; } catch { cancelling = true; }
          string command;
          while (commands.TryDequeue(out command)) {
            if (command == "cancel") cancelling = true;
            if (command == "focus" && dialog != IntPtr.Zero) Present(dialog, browser, anchor);
          }
          if (cancelling) { if (dialog != IntPtr.Zero) PostMessage(dialog, 0x0010, IntPtr.Zero, IntPtr.Zero); else Application.ExitThread(); }
        };
        timer.Start();
          owner.BeginInvoke(new Action(delegate {
            string selected = "";
            try {
              selected = Choose(mode, browser);
              if (cancelling) selected = "";
              Emit("{\"event\":\"result\",\"path\":" + Quote(selected) + "}");
            } catch { Emit("{\"event\":\"error\"}"); }
            finally { timer.Stop(); Application.ExitThread(); }
          }));
        Application.Run();
      }
    }
  }
}
