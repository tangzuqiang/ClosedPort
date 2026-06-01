import os from 'os';
import { execCommand } from './exec';

export interface ProcessDetail {
  pid: number;
  name?: string;
  path?: string;
  user?: string;
  commandLine?: string;
  parentPid?: number;
  parentName?: string;
}

const cache = new Map<number, ProcessDetail>();
let cacheStamp = 0;
const CACHE_TTL_MS = 5000;

export function clearProcessCache(): void {
  cache.clear();
  cacheStamp = 0;
}

function ensureCacheFresh(): void {
  const now = Date.now();
  if (now - cacheStamp > CACHE_TTL_MS) {
    cache.clear();
    cacheStamp = now;
  }
}

function linkParents(): void {
  for (const detail of cache.values()) {
    if (detail.parentPid && !detail.parentName) {
      const parent = cache.get(detail.parentPid);
      if (parent && parent.name) detail.parentName = parent.name;
    }
  }
}

/**
 * Pre-load process details for many PIDs at once.
 *
 * Strategy:
 *   - Windows: a single `tasklist /FO CSV /NH` call to get PID + name for ALL
 *     processes. For the requested PIDs we then issue ONE PowerShell
 *     Get-CimInstance call to enrich path / commandLine / parent. We never
 *     loop wmic / Get-CimInstance per-PID, since that triggers WmiPrvSE high
 *     CPU and is what most "system inspector" tools get wrong.
 *   - macOS:   one `ps` call.
 *   - Linux:   one `ps` call + parallel /proc reads.
 */
export async function preloadProcessDetails(pids: number[]): Promise<void> {
  ensureCacheFresh();
  const need = Array.from(new Set(pids)).filter(
    (p) => p > 0 && !cache.has(p)
  );
  if (need.length === 0 && cache.size > 0) return;
  if (os.platform() === 'win32') {
    await preloadWindows(need);
  } else if (os.platform() === 'darwin') {
    await preloadDarwin(need);
  } else {
    await preloadLinux(need);
  }
  linkParents();
}

export async function getProcessDetail(pid: number): Promise<ProcessDetail> {
  ensureCacheFresh();
  const cached = cache.get(pid);
  if (cached) return cached;
  await preloadProcessDetails([pid]);
  return cache.get(pid) ?? { pid };
}

// ---------------- Windows ----------------

async function preloadWindows(pids: number[]): Promise<void> {
  // Step 1: tasklist (no /V to avoid SeDebugPrivilege hangs) — fast & always works.
  try {
    const { stdout } = await execCommand('tasklist /FO CSV /NH', {
      timeoutMs: 8000
    });
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line);
      if (cols.length < 2) continue;
      const name = cols[0];
      const pid = parseInt(cols[1], 10);
      if (!Number.isFinite(pid)) continue;
      if (!cache.has(pid)) cache.set(pid, { pid, name });
    }
  } catch {
    /* fallback below */
  }

  const needEnrich = pids.filter((p) => {
    const c = cache.get(p);
    return c && (!c.path || !c.parentPid);
  });
  if (needEnrich.length === 0) return;

  // Step 2: ONE PowerShell call enriches path / commandLine / parentPid for
  // the requested PIDs. We pipe Get-CimInstance with a -Filter that ORs all
  // PIDs together so WmiPrvSE only handles a single query (vs N queries with
  // wmic). This is the key fix for the WMI Provider Host CPU spike.
  if (needEnrich.length > 0) {
    const ok = await enrichWithPowerShell(needEnrich);
    if (!ok) {
      // Fallback: a single bounded wmic call. Still one process, still one
      // WMI query — but kept as a backup for systems where PowerShell is
      // missing or policy-blocked.
      await enrichWithWmicOnce(needEnrich);
    }
  }
}

async function enrichWithPowerShell(pids: number[]): Promise<boolean> {
  // Build "ProcessId=1 OR ProcessId=2" filter; Win32_Process supports OR.
  const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
  // ConvertTo-Json with -Compress keeps stdout small and easy to parse.
  // -Depth 2 is enough for our flat object.
  const script =
    `$ErrorActionPreference='SilentlyContinue';` +
    `Get-CimInstance Win32_Process -Filter "${filter}" |` +
    ` Select-Object ProcessId,Name,ExecutablePath,CommandLine,ParentProcessId |` +
    ` ConvertTo-Json -Compress -Depth 2`;
  const res = await execCommand(
    `powershell -NoLogo -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
    { timeoutMs: 8000 }
  ).catch(() => null);
  if (!res || !res.stdout) return false;
  const text = res.stdout.trim();
  if (!text) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const arr: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? (parsed as Array<Record<string, unknown>>)
    : [parsed as Record<string, unknown>];
  let updated = 0;
  for (const row of arr) {
    const pid = Number(row.ProcessId);
    if (!Number.isFinite(pid)) continue;
    const existing: ProcessDetail = cache.get(pid) ?? { pid };
    const path = typeof row.ExecutablePath === 'string' ? row.ExecutablePath : undefined;
    const cmd = typeof row.CommandLine === 'string' ? row.CommandLine : undefined;
    const ppid = Number(row.ParentProcessId);
    cache.set(pid, {
      ...existing,
      name: existing.name ?? (typeof row.Name === 'string' ? row.Name : undefined),
      path: path || existing.path,
      commandLine: cmd || existing.commandLine,
      parentPid: Number.isFinite(ppid) ? ppid : existing.parentPid
    });
    updated++;
  }
  return updated > 0;
}

async function enrichWithWmicOnce(pids: number[]): Promise<void> {
  const filter = pids.map((p) => `ProcessId=${p}`).join(' or ');
  const wmic = await execCommand(
    `wmic process where "${filter}" get ProcessId,ParentProcessId,ExecutablePath,CommandLine /FORMAT:LIST`,
    { timeoutMs: 4000 }
  ).catch(() => null);
  if (wmic && wmic.stdout) parseWmicList(wmic.stdout);
}

function parseWmicList(text: string): void {
  const groups = text.split(/\r?\n\r?\n/);
  for (const group of groups) {
    const obj: Record<string, string> = {};
    for (const raw of group.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      obj[line.slice(0, eq)] = line.slice(eq + 1);
    }
    const pid = parseInt(obj.ProcessId || '', 10);
    if (!Number.isFinite(pid)) continue;
    const ppid = parseInt(obj.ParentProcessId || '', 10);
    const existing: ProcessDetail = cache.get(pid) ?? { pid };
    cache.set(pid, {
      ...existing,
      path: obj.ExecutablePath || existing.path,
      commandLine: obj.CommandLine || existing.commandLine,
      parentPid: Number.isFinite(ppid) ? ppid : existing.parentPid
    });
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ---------------- macOS ----------------

async function preloadDarwin(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  const list = pids.join(',');
  const { stdout } = await execCommand(
    `ps -p ${list} -o pid=,ppid=,user=,comm=,command=`,
    { timeoutMs: 6000 }
  ).catch(
    () =>
      ({ stdout: '', stderr: '', code: 1 } as {
        stdout: string;
        stderr: string;
        code: number;
      })
  );
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const ppid = parseInt(m[2], 10);
    const exe = m[4];
    cache.set(pid, {
      pid,
      name: exe.split('/').pop(),
      path: exe,
      user: m[3],
      commandLine: m[5],
      parentPid: Number.isFinite(ppid) ? ppid : undefined
    });
  }
}

// ---------------- Linux ----------------

async function preloadLinux(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  const list = pids.join(',');
  const ps = await execCommand(`ps -p ${list} -o pid=,ppid=,user=,comm=`, {
    timeoutMs: 6000
  }).catch(
    () =>
      ({ stdout: '', stderr: '', code: 1 } as {
        stdout: string;
        stderr: string;
        code: number;
      })
  );
  for (const raw of ps.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const ppid = parseInt(m[2], 10);
    cache.set(pid, {
      pid,
      name: m[4],
      user: m[3],
      parentPid: Number.isFinite(ppid) ? ppid : undefined
    });
  }
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const [exe, cmdline] = await Promise.all([
          execCommand(`readlink -f /proc/${pid}/exe`, { timeoutMs: 2000 }).catch(
            () => null
          ),
          execCommand(`tr '\\0' ' ' < /proc/${pid}/cmdline`, {
            timeoutMs: 2000
          }).catch(() => null)
        ]);
        const existing: ProcessDetail = cache.get(pid) ?? { pid };
        cache.set(pid, {
          ...existing,
          path: exe?.stdout.trim() || existing.path,
          commandLine: cmdline?.stdout.trim() || existing.commandLine
        });
      } catch {
        /* ignore */
      }
    })
  );
}
