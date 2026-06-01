# Screenshots

The PNGs in this folder are real captures of ClosedPort running on Windows.
They are produced automatically by `BrowserWindow.capturePage()` against the
real React UI fed with real `listPorts()` data (no mocks).

Files:

- main-flat.png      — Main window, flat view with the `Started by` column
- main-grouped.png   — Main window, "Group by EXE" view, three groups expanded
- folder-locks.png   — Folder lock scanner tab (Windows)
- floating.png       — Always-on-top mini panel

To regenerate them locally:

```powershell
# Windows / PowerShell
$env:CLOSEDPORT_SMOKE = $null
$env:CLOSEDPORT_SCREENSHOT_DIR = "$PWD\docs\screenshots"
npm run build
npx electron .
```

```bash
# macOS / Linux
unset CLOSEDPORT_SMOKE
export CLOSEDPORT_SCREENSHOT_DIR="$PWD/docs/screenshots"
npm run build
npx electron .
```

The app will boot, drive its own UI through the four states above, write
PNGs into `CLOSEDPORT_SCREENSHOT_DIR`, and then quit.
