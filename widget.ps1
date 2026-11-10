$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MeterWindow {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    public delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint threadId, uint time);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    private static IntPtr moveHook, widgetHandle;
    private static WinEventProc moveCallback;
    private static bool hiddenForDrag;
    public static void WatchExternalDrag(IntPtr widget) {
        widgetHandle = widget;
        moveCallback = OnMoveEvent;
        // Passive accessibility events only: no mouse hook and no input interception.
        moveHook = SetWinEventHook(0x000A, 0x000B, IntPtr.Zero, moveCallback, 0, 0, 0);
        if(moveHook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    }
    private static void OnMoveEvent(IntPtr hook, uint type, IntPtr window, int objectId, int childId, uint threadId, uint time) {
        if(window == IntPtr.Zero || window == widgetHandle || !IsWindow(widgetHandle)) return;
        if(type == 0x000A && !hiddenForDrag && IsWindowVisible(widgetHandle)) {
            hiddenForDrag = true;
            ShowWindow(widgetHandle, 0);
        } else if(type == 0x000B && hiddenForDrag) {
            hiddenForDrag = false;
            // SW_SHOWNOACTIVATE preserves the dragged window's focus and position.
            ShowWindow(widgetHandle, 4);
        }
    }
    public static void StopWatching() {
        if(moveHook != IntPtr.Zero) { UnhookWinEvent(moveHook); moveHook = IntPtr.Zero; }
        if(hiddenForDrag && IsWindow(widgetHandle)) ShowWindow(widgetHandle, 4);
        hiddenForDrag = false;
        GC.KeepAlive(moveCallback);
    }
    public static IntPtr Find() {
        IntPtr result = IntPtr.Zero;
        EnumWindows((h,l) => {
            var text = new StringBuilder(512); GetWindowText(h,text,512);
            if(IsWindowVisible(h) && text.ToString().StartsWith("Plus Meter 桌面小组件")) { result=h; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
'@
try {
    $existingWindow = [MeterWindow]::Find()
    if ($existingWindow -ne [IntPtr]::Zero) {
        [void][MeterWindow]::ShowWindow($existingWindow, 9)
        [void][MeterWindow]::SetForegroundWindow($existingWindow)
        exit
    }
    $nodeCommand = Get-Command node -ErrorAction Stop
    $edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path -LiteralPath $edgePath)) { $edgePath = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
    if (-not (Test-Path -LiteralPath $edgePath)) { throw '需要安装 Microsoft Edge。' }
    $dataPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.plus-meter'
    [void](New-Item -ItemType Directory -Path $dataPath -Force)
    $readyPath = Join-Path $dataPath ('ready-' + [guid]::NewGuid().ToString('N') + '.json')
    $serverPath = Join-Path $PSScriptRoot 'desktop-server.mjs'
    $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @(('"' + $serverPath + '"'), ('"' + $readyPath + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    $ready = $null
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if (Test-Path -LiteralPath $readyPath) {
            try { $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json; break } catch {}
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw '组件服务启动超时。' }
    Remove-Item -LiteralPath $readyPath
    if ($ready.error) { throw $ready.error }
    $profilePath = Join-Path $dataPath 'edge-profile'
    $widgetUrl = $ready.url + '/?widget=1'
    $workArea = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $windowWidth = 370; $windowHeight = [Math]::Min(650, $workArea.Height - 40)
    $windowLeft = $workArea.Right - $windowWidth - 24; $windowTop = $workArea.Top + 30
    [void](Start-Process -FilePath $edgePath -ArgumentList @('--app=' + $widgetUrl, ('--user-data-dir="' + $profilePath + '"'), '--no-first-run', '--no-default-browser-check', ('--window-size=' + $windowWidth + ',' + $windowHeight), ('--window-position=' + $windowLeft + ',' + $windowTop)))
    $widgetWindow = [IntPtr]::Zero
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        $widgetWindow = [MeterWindow]::Find()
        if ($widgetWindow -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 300
    }
    if ($widgetWindow -eq [IntPtr]::Zero) { throw '窗口打开失败，请检查 Microsoft Edge。' }
    # SWP_SHOWWINDOW | SWP_NOACTIVATE: establish placement once without stealing focus.
    [void][MeterWindow]::SetWindowPos($widgetWindow, [IntPtr](-1), $windowLeft, $windowTop, $windowWidth, $windowHeight, 0x0050)
    [MeterWindow]::WatchExternalDrag($widgetWindow)
    # Keep the launching process alive so closing the widget also stops its own backend.
    # Out-of-context WinEvent notifications require the registering thread to pump messages.
    while ([MeterWindow]::IsWindow($widgetWindow)) {
        [Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
} catch {
    [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Plus Meter', 'OK', 'Error')
} finally {
    [MeterWindow]::StopWatching()
    if ($ready -and $ready.ownsServer -and $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    }
}
