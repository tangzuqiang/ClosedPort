# resources/

Drop the Sysinternals `handle.exe` and/or `handle64.exe` here for the
Folder Locks feature on Windows. The app will auto-detect and use them.

Download: https://learn.microsoft.com/en-us/sysinternals/downloads/handle

If neither is present, the app falls back to the Windows Restart Manager
API (PowerShell), which still detects most user-mode locks (Word, Excel,
IDEs, etc.) but will not show driver/kernel handles.

This folder is bundled into packaged builds via the `extraResources`
section of `package.json`.
