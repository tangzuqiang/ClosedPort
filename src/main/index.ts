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
    return {
      platform: os.platform(),
      isAdmin,
      handleAvailable
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

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
