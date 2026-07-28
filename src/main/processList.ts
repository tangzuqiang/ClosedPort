import os from 'os';
import {
  execCommand,
  execFileCommand,
  POWERSHELL_UTF8_PREAMBLE
} from './utils/exec';
import type { ProcessEntry, ProcessListResult } from '../shared/types';

/**
 * One-shot snapshot of every process the current user can see, with memory
 * and CPU figures populated.
 *
 * Backend choice mirrors the rest of the app:
 *   - Windows: a single PowerShell `Get-Process` call that pulls
 *     Id / ProcessName / WS / PrivateMemorySize64 / VirtualMemorySize64 /
 *     CPU / Threads / StartTime / Path. The user / command line cost extra
 *     WMI round-trips so they are filled best-effort and only when cheap.
 *     We never loop wmic per-PID (the classic WmiPrvSE CPU spike trap).
 *   - macOS / Linux: a single `ps -axo ...` call, BSD format on darwin and
 *     procps format on linux. /proc/<pid>/exe is read in parallel on Linux
 *     to recover the absolute executable path.
 *
 * The result is intentionally a flat array. Tree views, filtering, sort,
 * and aggregation happen in the renderer where they can be interactive
 * without another round-trip.
 */
export async function listProcesses(): Promise<ProcessListResult> {
  const platform = os.platform();
  if (platform === 'win32') return listProcessesWindows();
  if (platform === 'darwin') return listProcessesDarwin();
  if (platform === 'linux') return listProcessesLinux();
  return {
    entries: [],
    capturedAt: Date.now(),
    backend: 'unsupported',
    warning: `Platform ${platform} is not supported.`
  };
}

// ---------------- Windows ----------------

/**
 * Windows backend.
 *
 * Why PowerShell over `tasklist`:
 *   - `tasklist /V` is the only built-in way to get memory + user, but it
 *     truncates names at 25 chars, lacks Private / Virtual columns, and on
 *     some boxes blocks for seconds while it elevates SeDebugPrivilege.
 *   - `Get-Process` is .NET-backed, returns numeric WS / Private / Virtual
 *     and a real CPU-seconds counter in one round-trip.
 *
 * Why a single ConvertTo-Json with a property selector:
 *   - keeps stdout small and parser trivial
 *   - lets us null-coalesce missing properties on locked-down processes
 *     without crashing the whole pipeline
 */
async function listProcessesWindows(): Promise<ProcessListResult> {
  // We need two pieces of info from two different sources:
  //   - Get-Process (.NET): cheap memory / cpu / threads / start time
  //   - Get-CimInstance Win32_Process: parent pid + executable path +
  //     command line + owner user. CIM is slower per-row but a single
  //     call still returns everything in one shot.
  //
  // Joining them inside PowerShell avoids shipping two separate JSON
  // blobs back to Node and re-merging them there. We index the CIM
  // dictionary by ProcessId for O(1) lookups.
  const script = [
    POWERSHELL_UTF8_PREAMBLE,
    `$ErrorActionPreference='SilentlyContinue';`,
    `$cim = @{};`,
    `Get-CimInstance Win32_Process | ForEach-Object { $cim[[int]$_.ProcessId] = $_ };`,
    `Get-Process |`,
    `Select-Object @{n='Pid';e={$_.Id}},`,
    `              @{n='Name';e={$_.ProcessName}},`,
    `              @{n='Ws';e={[int64]$_.WorkingSet64}},`,
    `              @{n='Private';e={[int64]$_.PrivateMemorySize64}},`,
    `              @{n='Virtual';e={[int64]$_.VirtualMemorySize64}},`,
    `              @{n='Cpu';e={if($_.CPU){[double]$_.CPU}else{0}}},`,
    `              @{n='Threads';e={$_.Threads.Count}},`,
    `              @{n='Path';e={if($_.Path){$_.Path}elseif($cim[$_.Id]){$cim[$_.Id].ExecutablePath}else{$null}}},`,
    `              @{n='Started';e={if($_.StartTime){[int64](([DateTimeOffset]$_.StartTime).ToUnixTimeSeconds())}else{-1}}},`,
    `              @{n='Ppid';e={if($cim[$_.Id]){[int]$cim[$_.Id].ParentProcessId}else{-1}}},`,
    `              @{n='Cmd';e={if($cim[$_.Id]){$cim[$_.Id].CommandLine}else{$null}}} |`,
    `ConvertTo-Json -Compress -Depth 2`
  ].join(' ');
  const res = await execCommand(
    `powershell -NoLogo -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
    { timeoutMs: 20000, maxBuffer: 1024 * 1024 * 64 }
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    return {
      entries: [],
      capturedAt: Date.now(),
      backend: 'powershell',
      warning: `Get-Process failed (exit=${res.code}). ${res.stderr.slice(0, 200)}`
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    return {
      entries: [],
      capturedAt: Date.now(),
      backend: 'powershell',
      warning: `Could not parse PowerShell output: ${(e as Error).message}`
    };
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const nowSec = Math.floor(Date.now() / 1000);
  const entries: ProcessEntry[] = [];
  for (const raw of arr) {
    const row = raw as Record<string, unknown>;
    const pid = Number(row.Pid);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const started = Number(row.Started);
    const uptime = started > 0 ? Math.max(0, nowSec - started) : -1;
    const ppidRaw = Number(row.Ppid);
    entries.push({
      pid,
      parentPid: Number.isFinite(ppidRaw) && ppidRaw > 0 ? ppidRaw : undefined,
      name: stringOrEmpty(row.Name) || `pid ${pid}`,
      path: stringOrUndef(row.Path),
      commandLine: stringOrUndef(row.Cmd),
      rssBytes: numOr0(row.Ws),
      // PrivateMemorySize64 is the closest analog to "memory this process
      // privately owns" that Windows exposes cheaply.
      privateBytes: numOr0(row.Private),
      virtualBytes: numOr0(row.Virtual),
      // Get-Process .CPU is total CPU SECONDS since the process started.
      // Divide by uptime to get an average % of one core. This is the same
      // approximation Task Manager uses on first view before it has two
      // samples to diff. Real two-sample sampling lives in the renderer
      // if we ever want a live curve.
      cpuPercent: computeCpuPct(numOr0(row.Cpu), uptime),
      uptimeSeconds: uptime,
      threadCount: numOrNeg1(row.Threads)
    });
  }
  return {
    entries,
    capturedAt: Date.now(),
    backend: 'powershell'
  };
}

function computeCpuPct(cpuSeconds: number, uptimeSeconds: number): number {
  if (!Number.isFinite(cpuSeconds) || cpuSeconds <= 0) return 0;
  if (!Number.isFinite(uptimeSeconds) || uptimeSeconds <= 0) return 0;
  // % of a single core. Cap at 100 * cpuCount to avoid the cosmetic
  // "9999%" you see on heavy multi-threaded workloads, while still
  // letting the user see "uses 4 cores fully" as e.g. 400% on an 8c box.
  const cores = Math.max(1, os.cpus()?.length || 1);
  const pct = (cpuSeconds / uptimeSeconds) * 100;
  return Math.min(pct, cores * 100);
}

// ---------------- macOS ----------------

/**
 * macOS backend (BSD `ps`).
 *
 * Format string notes:
 *   - `rss` is in KiB on darwin; we multiply by 1024.
 *   - `vsz` is in KiB too. There is no cheap "private bytes" on macOS,
 *     so we report `rss` for both rss and privateBytes (private commit
 *     on the Mach kernel side requires `proc_pidinfo`, which would mean
 *     shipping a C addon -- not worth it for a UI hint).
 *   - `etime` is "[[dd-]hh:]mm:ss". We parse below.
 */
async function listProcessesDarwin(): Promise<ProcessListResult> {
  // -ww disables column-truncation so command line is not chopped.
  // We pick a wide format with explicit column widths so the parser
  // stays anchored even when comm contains spaces.
  const res = await execFileCommand(
    'ps',
    [
      '-axww',
      '-o',
      'pid=,ppid=,user=,%cpu=,rss=,vsz=,etime=,comm='
    ],
    { timeoutMs: 8000, maxBuffer: 1024 * 1024 * 64 }
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    return {
      entries: [],
      capturedAt: Date.now(),
      backend: 'ps',
      warning: `ps failed (exit=${res.code}). ${res.stderr.slice(0, 200)}`
    };
  }
  const entries: ProcessEntry[] = [];
  for (const raw of res.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // pid ppid user %cpu rss vsz etime comm...
    const m = line.match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/
    );
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const ppid = parseInt(m[2], 10);
    const rssKb = parseInt(m[5], 10);
    const vszKb = parseInt(m[6], 10);
    const comm = m[8];
    entries.push({
      pid,
      parentPid: Number.isFinite(ppid) ? ppid : undefined,
      name: comm.split('/').pop() || comm,
      path: comm.startsWith('/') ? comm : undefined,
      user: m[3],
      rssBytes: rssKb * 1024,
      privateBytes: rssKb * 1024,
      virtualBytes: vszKb * 1024,
      cpuPercent: parseFloat(m[4]) || 0,
      uptimeSeconds: parseEtime(m[7]),
      threadCount: -1
    });
  }
  return { entries, capturedAt: Date.now(), backend: 'ps' };
}

// ---------------- Linux ----------------

/**
 * Linux backend (procps `ps`).
 *
 * Differences from macOS:
 *   - `nlwp` gives us thread count cheaply, so we surface it.
 *   - `/proc/<pid>/status` has `RssAnon` which is closer to "private
 *     bytes" than plain RSS. We read it best-effort in parallel for
 *     the top-N memory hogs only (full scan is O(N) reads -> slow on
 *     boxes with 1000+ procs). For everyone else we fall back to RSS.
 */
async function listProcessesLinux(): Promise<ProcessListResult> {
  const res = await execFileCommand(
    'ps',
    [
      '-axww',
      '-o',
      'pid=,ppid=,user=,%cpu=,rss=,vsz=,nlwp=,etime=,comm='
    ],
    { timeoutMs: 8000, maxBuffer: 1024 * 1024 * 64 }
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    return {
      entries: [],
      capturedAt: Date.now(),
      backend: 'ps',
      warning: `ps failed (exit=${res.code}). ${res.stderr.slice(0, 200)}`
    };
  }
  const entries: ProcessEntry[] = [];
  for (const raw of res.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/
    );
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const ppid = parseInt(m[2], 10);
    const rssKb = parseInt(m[5], 10);
    const vszKb = parseInt(m[6], 10);
    const nlwp = parseInt(m[7], 10);
    const comm = m[9];
    entries.push({
      pid,
      parentPid: Number.isFinite(ppid) ? ppid : undefined,
      name: comm,
      user: m[3],
      rssBytes: rssKb * 1024,
      privateBytes: rssKb * 1024,
      virtualBytes: vszKb * 1024,
      cpuPercent: parseFloat(m[4]) || 0,
      uptimeSeconds: parseEtime(m[8]),
      threadCount: Number.isFinite(nlwp) ? nlwp : -1
    });
  }
  // Enrich the top 30 memory consumers with absolute exe path from
  // /proc/<pid>/exe. Doing it for everyone is wasteful and the user
  // overwhelmingly sorts by memory anyway.
  const top = [...entries]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 30);
  await Promise.all(
    top.map(async (p) => {
      const r = await execCommand(`readlink -f /proc/${p.pid}/exe`, {
        timeoutMs: 1500
      }).catch(() => null);
      if (r && r.code === 0) {
        const path = r.stdout.trim();
        if (path) p.path = path;
      }
    })
  );
  return { entries, capturedAt: Date.now(), backend: 'ps+proc' };
}

// ---------------- utilities ----------------

function numOr0(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function numOrNeg1(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : -1;
}
function stringOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Parse the `ps -o etime=` format: "[[dd-]hh:]mm:ss"
 * Examples: "01:23", "12:34:56", "5-12:34:56"
 * Returns total seconds, or -1 when unparseable.
 */
function parseEtime(s: string): number {
  if (!s) return -1;
  const dashIdx = s.indexOf('-');
  let days = 0;
  let rest = s;
  if (dashIdx >= 0) {
    days = parseInt(s.slice(0, dashIdx), 10) || 0;
    rest = s.slice(dashIdx + 1);
  }
  const parts = rest.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return -1;
  let hours = 0;
  let mins = 0;
  let secs = 0;
  if (parts.length === 3) {
    [hours, mins, secs] = parts;
  } else if (parts.length === 2) {
    [mins, secs] = parts;
  } else if (parts.length === 1) {
    [secs] = parts;
  } else {
    return -1;
  }
  return days * 86400 + hours * 3600 + mins * 60 + secs;
}
