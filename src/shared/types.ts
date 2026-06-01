export type Protocol = 'TCP' | 'UDP' | 'TCP6' | 'UDP6';

export interface PortEntry {
  protocol: Protocol;
  localAddress: string;
  localPort: number;
  remoteAddress?: string;
  remotePort?: number;
  state?: string;
  pid: number;
  processName?: string;
  processPath?: string;
  user?: string;
  commandLine?: string;
  parentPid?: number;
  parentName?: string;
}

export interface FolderHandleEntry {
  pid: number;
  processName: string;
  processPath?: string;
  handleType: string;
  resourcePath: string;
}

export interface KillResult {
  pid: number;
  success: boolean;
  message?: string;
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  isAdmin: boolean;
  handleAvailable: boolean;
}

export interface ListPortsOptions {
  refresh?: boolean;
}

export interface ScanFolderOptions {
  folderPath: string;
  recursive?: boolean;
}

export interface ApiSurface {
  listPorts(options?: ListPortsOptions): Promise<PortEntry[]>;
  scanFolder(options: ScanFolderOptions): Promise<FolderHandleEntry[]>;
  killProcess(pid: number, force?: boolean): Promise<KillResult>;
  killProcesses(pids: number[], force?: boolean): Promise<KillResult[]>;
  getSystemInfo(): Promise<SystemInfo>;
  toggleFloating(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  revealInFolder(filePath: string): Promise<void>;
}
