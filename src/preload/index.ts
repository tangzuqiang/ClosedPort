import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
import type {
  ApiSurface,
  ListPortsOptions,
  ScanFolderOptions
} from '../shared/types';

const api: ApiSurface = {
  listPorts: (_options?: ListPortsOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_PORTS),
  scanFolder: (options: ScanFolderOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, options),
  killProcess: (pid: number, force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.KILL_PROCESS, pid, force),
  killProcesses: (pids: number[], force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.KILL_PROCESSES, pids, force),
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_INFO),
  toggleFloating: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FLOATING),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.PICK_FOLDER),
  revealInFolder: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.REVEAL_IN_FOLDER, filePath)
};

contextBridge.exposeInMainWorld('closedport', api);
