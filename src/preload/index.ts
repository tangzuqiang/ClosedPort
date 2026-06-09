import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
import type {
  ApiSurface,
  ListPortsOptions,
  ListProcessesOptions,
  ScanFolderOptions
} from '../shared/types';

const api: ApiSurface = {
  listPorts: (_options?: ListPortsOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_PORTS),
  listProcesses: (options?: ListProcessesOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_PROCESSES, options),
  scanFolder: (options: ScanFolderOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, options),
  scanFolderEx: (options: ScanFolderOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER_EX, options),
  killProcess: (pid: number, force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.KILL_PROCESS, pid, force),
  killProcesses: (pids: number[], force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.KILL_PROCESSES, pids, force),
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_INFO),
  getSystemMemory: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_MEMORY),
  toggleFloating: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FLOATING),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.PICK_FOLDER),
  revealInFolder: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.REVEAL_IN_FOLDER, filePath),
  spawnTestPorts: (count: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPAWN_TEST_PORTS, count),
  // webUtils.getPathForFile is the supported replacement for the
  // deprecated `File.path` property removed in Electron 32. We expose
  // it via the contextBridge so the renderer can resolve a dropped
  // file/folder to its absolute path without enabling nodeIntegration.
  resolveDroppedPath: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  }
};

contextBridge.exposeInMainWorld('closedport', api);
