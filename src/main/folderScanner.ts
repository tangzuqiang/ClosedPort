import os from 'os';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { execCommand, tryExec } from './utils/exec';
import { getProcessDetail } from './utils/processInfo';
import type { FolderHandleEntry } from '../shared/types';

/**
 * Resolve the bundled handle.exe path. We look for it in:
 *   1. process.resourcesPath/resources/handle*.exe (packaged)
 *   2. <appRoot>/resources/handle*.exe (dev)
 *   3. handle / handle64 in PATH
 */
export async function resolveHandleExe(): Promise<string | null> {
  if (os.platform() !== 'win32') return null;
  const candidates: string[] = [];
  const isPackaged = app.isPackaged;
  const baseDirs = isPackaged
    ? [path.join(process.resourcesPath, 'resources')]
    : [path.join(app.getAppPath(), 'resources')];
  for (const dir of baseDirs) {
    candidates.push(path.join(dir, 'handle64.exe'));
    candidates.push(path.join(dir, 'handle.exe'));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // PATH lookup
  const where = await tryExec('where handle64.exe');
  if (where && where.stdout.trim()) return where.stdout.split(/\r?\n/)[0].trim();
  const where2 = await tryExec('where handle.exe');
  if (where2 && where2.stdout.trim()) return where2.stdout.split(/\r?\n/)[0].trim();
  return null;
}

export async function isHandleExeAvailable(): Promise<boolean> {
  return (await resolveHandleExe()) !== null;
}

/**
 * Scan a folder for processes that hold handles to files inside it.
 * Windows-only; on other platforms returns empty.
 */
export async function scanFolder(folderPath: string): Promise<FolderHandleEntry[]> {
  if (os.platform() !== 'win32') return [];
  const exe = await resolveHandleExe();
  if (exe) {
    return scanWithHandleExe(exe, folderPath);
  }
  return scanWithRestartManager(folderPath);
}

async function scanWithHandleExe(
  exe: string,
  folderPath: string
): Promise<FolderHandleEntry[]> {
  // -accepteula: skip EULA dialog; -nobanner: cleaner output; -u: show owner
  const cmd = `"${exe}" -accepteula -nobanner -u "${folderPath}"`;
  const { stdout } = await execCommand(cmd, { timeoutMs: 30000 });

  const entries: FolderHandleEntry[] = [];
  const lines = stdout.split(/\r?\n/);

  // handle.exe output sample (per process block):
  // chrome.exe pid: 12345 DOMAIN\user
  //   1A8: File  C:\path\to\file
  //   2BC: File  C:\path\to\other
  let curPid = 0;
  let curName = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    const header = line.match(/^(\S+)\s+pid:\s*(\d+)/i);
    if (header) {
      curName = header[1];
      curPid = parseInt(header[2], 10);
      continue;
    }
    const handle = line.match(/^\s+[0-9A-F]+:\s+(\S+)\s+(.+)$/i);
    if (handle && curPid > 0) {
      const type = handle[1];
      const resourcePath = handle[2].trim();
      // Filter to entries inside folderPath (case-insensitive on Windows)
      if (
        resourcePath.toLowerCase().startsWith(folderPath.toLowerCase().replace(/\\$/, ''))
      ) {
        entries.push({
          pid: curPid,
          processName: curName,
          handleType: type,
          resourcePath
        });
      }
    }
  }

  // Enrich with process path
  const uniquePids = Array.from(new Set(entries.map((e) => e.pid)));
  const details = await Promise.all(uniquePids.map((p) => getProcessDetail(p)));
  const map = new Map(details.map((d) => [d.pid, d]));
  return entries.map((e) => ({
    ...e,
    processPath: map.get(e.pid)?.path
  }));
}

/**
 * Fallback: walk the folder (non-recursive on root, plus the folder itself)
 * and call RmStartSession via PowerShell to detect locking processes.
 * This catches files locked by user-mode apps like Word/Excel/IDEs.
 */
async function scanWithRestartManager(
  folderPath: string
): Promise<FolderHandleEntry[]> {
  // Build list of files to query (limited to avoid huge sets)
  const files: string[] = [];
  collectFiles(folderPath, files, 500);
  if (files.length === 0) return [];

  const psFiles = files
    .map((f) => `'${f.replace(/'/g, "''")}'`)
    .join(',');

  const script = `
$ErrorActionPreference = 'SilentlyContinue';
$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Rm {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  const int RmRebootReasonNone = 0;
  const int CCH_RM_MAX_APP_NAME = 255;
  const int CCH_RM_MAX_SVC_NAME = 63;
  public enum RM_APP_TYPE { RmUnknownApp = 0, RmMainWindow = 1, RmOtherWindow = 2, RmService = 3, RmExplorer = 4, RmConsole = 5, RmCritical = 1000 }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;
    public RM_APP_TYPE ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
  public static List<object> Who(string[] files) {
    var result = new List<object>();
    uint handle; string key = Guid.NewGuid().ToString();
    if (RmStartSession(out handle, 0, key) != 0) return result;
    try {
      if (RmRegisterResources(handle, (uint)files.Length, files, 0, null, 0, null) != 0) return result;
      uint needed = 0; uint count = 0; uint reason = 0;
      RmGetList(handle, out needed, ref count, null, ref reason);
      if (needed == 0) return result;
      var infos = new RM_PROCESS_INFO[needed]; count = needed;
      if (RmGetList(handle, out needed, ref count, infos, ref reason) == 0) {
        for (int i = 0; i < count; i++) {
          result.Add(new { Pid = infos[i].Process.dwProcessId, Name = infos[i].strAppName });
        }
      }
    } finally { RmEndSession(handle); }
    return result;
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp | Out-Null
$files = @(${psFiles});
$res = [Rm]::Who($files);
$res | ConvertTo-Json -Compress
`;

  const tmpDir = app.getPath('temp');
  const tmpFile = path.join(tmpDir, `closedport-rm-${Date.now()}.ps1`);
  fs.writeFileSync(tmpFile, script, 'utf8');
  try {
    const { stdout } = await execCommand(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { timeoutMs: 30000 }
    );
    const text = stdout.trim();
    if (!text) return [];
    let arr: Array<{ Pid: number; Name: string }>;
    try {
      const parsed = JSON.parse(text);
      arr = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
    const uniquePids = Array.from(new Set(arr.map((a) => a.Pid))).filter(
      (p) => p > 0
    );
    const details = await Promise.all(
      uniquePids.map((p) => getProcessDetail(p))
    );
    const map = new Map(details.map((d) => [d.pid, d]));
    return arr.map((a) => ({
      pid: a.Pid,
      processName: a.Name || map.get(a.Pid)?.name || '',
      processPath: map.get(a.Pid)?.path,
      handleType: 'File',
      resourcePath: folderPath
    }));
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

function collectFiles(dir: string, out: string[], limit: number): void {
  try {
    if (!fs.existsSync(dir)) return;
    out.push(dir);
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return;
    const items = fs.readdirSync(dir);
    for (const name of items) {
      if (out.length >= limit) return;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          out.push(full);
        } else if (st.isDirectory()) {
          out.push(full);
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
