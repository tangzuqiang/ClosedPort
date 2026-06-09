import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  dialog,
  shell,
  nativeImage
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { listPorts } from './portScanner';
import { listProcesses } from './processList';
import { listSystemMemory } from './systemMemory';
import { scanFolder, scanFolderEx, isHandleExeAvailable } from './folderScanner';
import { killProcess, killProcesses } from './killer';
import { spawnFakePortHolders, killAllFakePortHolders } from './devTools';
import { IPC_CHANNELS } from '../shared/ipc';
import type { SystemInfo } from '../shared/types';

const useDevServer = !!process.env.CLOSEDPORT_DEV_SERVER || process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = process.env.CLOSEDPORT_DEV_URL || 'http://localhost:5173';
const RENDERER_DIST = path.join(__dirname, '..', '..', 'dist');

// Resolve a brand asset that lives under build/ at dev time and under
// resources/ inside a packaged app. We try both so the same code works
// in `npm start`, `electron .`, and the installed exe / dmg / AppImage.
function resolveBrandAsset(name: string): string | null {
  const fs = require('fs') as typeof import('fs');
  const candidates = [
    path.join(__dirname, '..', '..', 'build', name),
    path.join(process.resourcesPath || '', 'build', name),
    path.join(process.resourcesPath || '', name)
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function getAppIcon(): Electron.NativeImage | undefined {
  const file =
    resolveBrandAsset(process.platform === 'win32' ? 'icon.ico' : 'icon.png') ||
    resolveBrandAsset('icon.png');
  if (!file) return undefined;
  try {
    const img = nativeImage.createFromPath(file);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Disable the default Electron application menu (File / Edit / View / Window
// / Help). ClosedPort is a single-purpose tool and doesn't need them.
//
// On macOS we keep a minimal menu — without it the system loses Cmd+Q,
// Cmd+W, and clipboard shortcuts (Cmd+C / V / X / A / Z) inside text inputs.
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ])
  );
} else {
  Menu.setApplicationMenu(null);
}

function getRendererPath(htmlFile: string): string {
  if (useDevServer) {
    return `${RENDERER_DEV_URL}/${htmlFile}`;
  }
  return path.join(RENDERER_DIST, htmlFile);
}

function loadRenderer(win: BrowserWindow, htmlFile: string): void {
  if (useDevServer) {
    win.loadURL(`${RENDERER_DEV_URL}/${htmlFile}`);
  } else {
    win.loadFile(path.join(RENDERER_DIST, htmlFile));
  }
}

function createMainWindow(): void {
  const icon = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 520,
    title: 'ClosedPort',
    backgroundColor: '#0f1115',
    show: false,
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  loadRenderer(mainWindow, 'index.html');
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Fallback: if ready-to-show never fires (e.g. renderer failed to load),
  // still show the window after 3s so the user is not staring at nothing.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);
  mainWindow.webContents.on(
    'did-fail-load',
    (_e, code, desc, url) => {
      console.error(
        `[main] did-fail-load code=${code} desc=${desc} url=${url}`
      );
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }
  );
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[main] render-process-gone reason=${details.reason}`);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createFloatingWindow(): void {
  if (floatingWindow) {
    floatingWindow.show();
    floatingWindow.focus();
    return;
  }
  const icon = getAppIcon();
  floatingWindow = new BrowserWindow({
    width: 340,
    height: 460,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1115',
    title: 'ClosedPort Floating',
    icon,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRenderer(floatingWindow, 'floating.html');
  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });
}

function createTray(): void {
  // Prefer the bundled brand icon. Fall back to a 1x1 transparent PNG only
  // when the asset is missing (e.g. during a dev run without `build/`).
  let trayImage: Electron.NativeImage | null = null;
  const trayFile =
    resolveBrandAsset('tray.png') || resolveBrandAsset('icon.png');
  if (trayFile) {
    try {
      const img = nativeImage.createFromPath(trayFile);
      if (!img.isEmpty()) {
        trayImage =
          process.platform === 'darwin'
            ? img.resize({ width: 18, height: 18 })
            : img.resize({ width: 16, height: 16 });
      }
    } catch {
      trayImage = null;
    }
  }
  if (!trayImage) {
    trayImage = nativeImage.createFromDataURL(EMPTY_PNG);
  }
  try {
    tray = new Tray(trayImage);
  } catch {
    return;
  }
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Main',
      click: () => {
        if (!mainWindow) createMainWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Toggle Floating',
      click: () => toggleFloating()
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('ClosedPort');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleFloating());
}

function toggleFloating(): boolean {
  if (floatingWindow && floatingWindow.isVisible()) {
    floatingWindow.hide();
    return false;
  }
  if (!floatingWindow) {
    createFloatingWindow();
  } else {
    floatingWindow.show();
    floatingWindow.focus();
  }
  return true;
}

// 1x1 transparent PNG, base64
const EMPTY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.LIST_PORTS, async () => {
    return listPorts();
  });
  ipcMain.handle(IPC_CHANNELS.LIST_PROCESSES, async () => {
    return listProcesses();
  });
  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDER, async (_e, options) => {
    if (!options || typeof options.folderPath !== 'string') return [];
    const folderPath = options.folderPath.trim();
    if (!folderPath || folderPath.length > 1024) return [];
    return scanFolder(folderPath);
  });
  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDER_EX, async (_e, options) => {
    const empty = {
      entries: [],
      meta: { backend: 'unsupported' as const, folderExists: false }
    };
    if (!options || typeof options.folderPath !== 'string') return empty;
    const folderPath = options.folderPath.trim();
    if (!folderPath || folderPath.length > 1024) return empty;
    return scanFolderEx(folderPath);
  });
  ipcMain.handle(IPC_CHANNELS.KILL_PROCESS, async (_e, pid: number, force?: boolean) => {
    if (!Number.isFinite(pid) || pid <= 0) {
      return { pid: Number(pid) || 0, success: false, message: 'Invalid PID' };
    }
    return killProcess(pid, force ?? true);
  });
  ipcMain.handle(IPC_CHANNELS.KILL_PROCESSES, async (_e, pids: number[], force?: boolean) => {
    if (!Array.isArray(pids)) return [];
    return killProcesses(pids, force ?? true);
  });
  ipcMain.handle(IPC_CHANNELS.SYSTEM_INFO, async (): Promise<SystemInfo> => {
    let isAdmin = false;
    if (os.platform() === 'win32') {
      try {
        // best-effort; rely on net session
        const { execCommand } = await import('./utils/exec');
        const { code } = await execCommand('net session', { timeoutMs: 3000 });
        isAdmin = code === 0;
      } catch {
        isAdmin = false;
      }
    } else {
      isAdmin = process.getuid?.() === 0;
    }
    const handleAvailable = await isHandleExeAvailable();
    // The "Spawn test ports" action is a Windows-only diagnostic helper.
    // It is exposed in dev and in packaged builds (per product
    // requirement: users want to validate the kill flow on their
    // installed binary), but always hidden on macOS / Linux.
    const devToolsEnabled = os.platform() === 'win32';
    return {
      platform: os.platform(),
      isAdmin,
      handleAvailable,
      devToolsEnabled
    };
  });
  ipcMain.handle(IPC_CHANNELS.SYSTEM_MEMORY, async () => listSystemMemory());
  ipcMain.handle(IPC_CHANNELS.TOGGLE_FLOATING, async () => toggleFloating());
  ipcMain.handle(IPC_CHANNELS.PICK_FOLDER, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
  ipcMain.handle(IPC_CHANNELS.REVEAL_IN_FOLDER, async (_e, p: string) => {
    if (typeof p !== 'string' || !p || p.length > 1024) return;
    // Only reveal real, existing absolute paths. shell.showItemInFolder
    // itself doesn't execute code, but rejecting non-absolute / missing /
    // UNC-style inputs makes the IPC contract explicit and avoids
    // surprising Explorer windows on a malformed renderer payload.
    let resolved: string;
    try {
      resolved = path.resolve(p);
    } catch {
      return;
    }
    if (!path.isAbsolute(resolved)) return;
    if (!fs.existsSync(resolved)) return;
    shell.showItemInFolder(resolved);
  });
  ipcMain.handle(IPC_CHANNELS.SPAWN_TEST_PORTS, async (_e, count: number) => {
    if (process.platform !== 'win32') {
      return [];
    }
    const n = Math.max(1, Math.min(20, Math.floor(count) || 5));
    return spawnFakePortHolders(n);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  createMainWindow();
  createTray();

  // Smoke-test hook: when CLOSEDPORT_SMOKE=1, run the core backend path once
  // through IPC handlers and exit. Lets us validate the Electron-loaded
  // backend without needing a UI to drive it.
  if (process.env.CLOSEDPORT_SMOKE === '1') {
    try {
      const ports = await listPorts();
      console.log(`[smoke] listPorts ok, ${ports.length} entries`);
      const sample = ports.slice(0, 3).map((p) => ({
        proto: p.protocol,
        port: p.localPort,
        pid: p.pid,
        name: p.processName
      }));
      console.log('[smoke] sample:', JSON.stringify(sample));
      const sysHandle = await isHandleExeAvailable();
      console.log(`[smoke] handle.exe available: ${sysHandle}`);
      console.log('[smoke] OK');
    } catch (e) {
      console.error('[smoke] FAIL', e);
      // app.exit() bypasses 'before-quit', so reap any spawned holders
      // here before we hard-exit.
      killAllFakePortHolders();
      app.exit(2);
      return;
    }
    killAllFakePortHolders();
    app.exit(0);
    return;
  }

  // Screenshot hook: when CLOSEDPORT_SCREENSHOT_DIR is set, drive the real UI
  // through its 4 visible states and write PNGs of each. Real React render,
  // real listPorts() data, real Electron BrowserWindow.capturePage(). No mocks.
  if (process.env.CLOSEDPORT_SCREENSHOT_DIR) {
    try {
      await captureScreenshots(process.env.CLOSEDPORT_SCREENSHOT_DIR);
      console.log('[shot] OK');
    } catch (e) {
      console.error('[shot] FAIL', e);
      killAllFakePortHolders();
      app.exit(2);
      return;
    }
    killAllFakePortHolders();
    app.exit(0);
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

async function captureScreenshots(outDir: string): Promise<void> {
  const fs = await import('fs');
  const pathMod = await import('path');
  fs.mkdirSync(outDir, { recursive: true });

  // Wait until the main window's renderer has finished its first
  // listPorts() round-trip and rendered rows. We poll the DOM with
  // executeJavaScript instead of relying on a fixed sleep.
  if (!mainWindow) throw new Error('main window not created');
  const win = mainWindow;
  await waitFor(async () => win.webContents.isLoading() === false, 10000);
  // Give React a moment to mount + first IPC roundtrip
  await sleep(500);
  await waitFor(
    async () => {
      const has = await win.webContents.executeJavaScript(
        `document.querySelectorAll('table.table tbody tr').length > 0`
      );
      return !!has;
    },
    20000
  ).catch(() => {
    // It's OK if listPorts is slow on this machine; fallback to fixed wait
  });
  await sleep(800);

  await capturePNG(win, pathMod.join(outDir, 'main-flat.png'));
  console.log('[shot] main-flat.png saved');

  // Switch to "Group by EXE"
  await win.webContents.executeJavaScript(
    `(() => {
       const buttons = Array.from(document.querySelectorAll('.view-switch button'));
       const target = buttons.find(b => b.textContent && b.textContent.trim() === 'Group by EXE');
       if (target) target.click();
       return !!target;
     })()`
  );
  await sleep(500);
  // Expand groups that have real pids (skip the "Unknown" TIME_WAIT bucket)
  await win.webContents.executeJavaScript(
    `(() => {
       const groups = Array.from(document.querySelectorAll('.group'));
       const real = groups.filter(g => {
         const name = g.querySelector('.group-name');
         return name && (name.textContent || '').trim() !== 'Unknown';
       }).slice(0, 3);
       real.forEach(g => {
         const h = g.querySelector('.group-header');
         if (h) h.click();
       });
       // Scroll the first real group to the top of the viewport
       if (real[0]) real[0].scrollIntoView({ block: 'start' });
       return real.length;
     })()`
  );
  await sleep(500);
  await capturePNG(win, pathMod.join(outDir, 'main-grouped.png'));
  console.log('[shot] main-grouped.png saved');

  // Switch to Folder tab
  await win.webContents.executeJavaScript(
    `(() => {
       const tabs = Array.from(document.querySelectorAll('.tab'));
       const target = tabs.find(t => /Folder/i.test(t.textContent || ''));
       if (target) target.click();
       return !!target;
     })()`
  );
  await sleep(400);
  // Try to populate the folder view with a real scan against this project's
  // own working directory so the screenshot is not just an empty state.
  const cwd = process.cwd();
  await win.webContents.executeJavaScript(
    `(async () => {
       const input = document.querySelector('input[placeholder*="folder"]');
       if (input) {
         const setter = Object.getOwnPropertyDescriptor(
           window.HTMLInputElement.prototype, 'value'
         ).set;
         setter.call(input, ${JSON.stringify(cwd)});
         input.dispatchEvent(new Event('input', { bubbles: true }));
       }
       const btn = Array.from(document.querySelectorAll('button'))
         .find(b => (b.textContent || '').trim() === 'Scan');
       if (btn) btn.click();
       return true;
     })()`
  );
  // Wait up to 8s for the scan to finish (RestartManager can take a few seconds)
  await waitFor(
    async () => {
      const done = await win.webContents.executeJavaScript(
        `(() => {
           const btn = Array.from(document.querySelectorAll('button'))
             .find(b => (b.textContent || '').trim() === 'Scan');
           if (!btn) return false;
           // Scan button text becomes "Scanning..." while in flight
           return !btn.disabled;
         })()`
      );
      return !!done;
    },
    8000
  ).catch(() => {});
  await sleep(500);
  await capturePNG(win, pathMod.join(outDir, 'folder-locks.png'));
  console.log('[shot] folder-locks.png saved');

  // Open the floating window and screenshot it
  if (!floatingWindow) createFloatingWindow();
  if (!floatingWindow) throw new Error('floating window not created');
  const fw = floatingWindow;
  await waitFor(async () => fw.webContents.isLoading() === false, 10000);
  await sleep(500);
  await waitFor(
    async () => {
      const has = await fw.webContents.executeJavaScript(
        `document.querySelectorAll('.floating-item').length > 0`
      );
      return !!has;
    },
    15000
  ).catch(() => {});
  await sleep(600);
  await capturePNG(fw, pathMod.join(outDir, 'floating.png'));
  console.log('[shot] floating.png saved');
}

async function capturePNG(win: BrowserWindow, file: string): Promise<void> {
  const img = await win.webContents.capturePage();
  const fs = await import('fs');
  fs.writeFileSync(file, img.toPNG());
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  pred: () => Promise<boolean>,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await pred()) return;
    } catch {
      /* keep polling */
    }
    await sleep(150);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep tray alive: don't quit unless user explicitly chooses to.
    // For convenience here, we quit so dev cycles end cleanly.
    app.quit();
  }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Suppress unused warning for getRendererPath in some build setups
void getRendererPath;
