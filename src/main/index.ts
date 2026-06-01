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
import os from 'os';
import { listPorts } from './portScanner';
import { scanFolder, isHandleExeAvailable } from './folderScanner';
import { killProcess, killProcesses } from './killer';
import { spawnFakePortHolders } from './devTools';
import { IPC_CHANNELS } from '../shared/ipc';
import type { SystemInfo } from '../shared/types';

const useDevServer = !!process.env.CLOSEDPORT_DEV_SERVER || process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = process.env.CLOSEDPORT_DEV_URL || 'http://localhost:5173';
const RENDERER_DIST = path.join(__dirname, '..', '..', 'dist');

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 520,
    title: 'ClosedPort',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  loadRenderer(mainWindow, 'index.html');
  mainWindow.once('ready-to-show', () => mainWindow?.show());
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
  // Use a simple in-memory icon to avoid asset coupling.
  const icon = nativeImage.createEmpty();
  try {
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(EMPTY_PNG) : icon);
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
  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDER, async (_e, options) => {
    if (!options || typeof options.folderPath !== 'string') return [];
    return scanFolder(options.folderPath);
  });
  ipcMain.handle(IPC_CHANNELS.KILL_PROCESS, async (_e, pid: number, force?: boolean) => {
    return killProcess(pid, force ?? true);
  });
  ipcMain.handle(IPC_CHANNELS.KILL_PROCESSES, async (_e, pids: number[], force?: boolean) => {
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
  ipcMain.handle(IPC_CHANNELS.TOGGLE_FLOATING, async () => toggleFloating());
  ipcMain.handle(IPC_CHANNELS.PICK_FOLDER, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
  ipcMain.handle(IPC_CHANNELS.REVEAL_IN_FOLDER, async (_e, p: string) => {
    if (typeof p !== 'string' || !p) return;
    shell.showItemInFolder(p);
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
      app.exit(2);
      return;
    }
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
      app.exit(2);
      return;
    }
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
