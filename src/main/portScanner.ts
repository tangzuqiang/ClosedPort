import os from 'os';
import { execCommand } from './utils/exec';
import {
  getProcessDetail,
  preloadProcessDetails
} from './utils/processInfo';
import type { PortEntry, Protocol } from '../shared/types';

export async function listPorts(): Promise<PortEntry[]> {
  // Note: we intentionally do NOT clearProcessCache() here. processInfo's
  // 5s TTL is exactly the right window for our refresh cadence (Floating
  // panel ticks every 5s, main window is on-demand). Clearing on every
  // entry made the TTL effectively zero and forced a fresh batch
  // PowerShell / Get-CimInstance for every refresh.
  const platform = os.platform();
  let raw: PortEntry[];
  if (platform === 'win32') {
    raw = await listPortsWindows();
  } else if (platform === 'darwin') {
    raw = await listPortsDarwin();
  } else {
    raw = await listPortsLinux();
  }

  const uniquePids = Array.from(new Set(raw.map((r) => r.pid))).filter(
    (p) => p > 0
  );
  // Single batch query instead of N parallel PowerShell processes.
  await preloadProcessDetails(uniquePids);
  const details = await Promise.all(uniquePids.map((p) => getProcessDetail(p)));
  const detailMap = new Map(details.map((d) => [d.pid, d]));

  return raw.map((entry) => {
    const d = detailMap.get(entry.pid);
    let processName = entry.processName || d?.name;
    let processPath = entry.processPath || d?.path;
    // On Windows, netstat surfaces a fair number of sockets owned by
    // the kernel (PID 4 — "System") or by the System Idle Process
    // (PID 0 — used by netstat as a placeholder for sockets that have
    // no owning process anymore, e.g. lingering TIME_WAIT entries).
    // Without this, the "Group by EXE" view shows a confusing
    // "Unknown · 0 pids · N ports" bucket. Label them explicitly.
    if (platform === 'win32' && !processName) {
      if (entry.pid === 0) {
        processName = 'System Idle / TIME_WAIT';
      } else if (entry.pid === 4) {
        processName = 'System (Windows kernel)';
        processPath = processPath || 'C:\\Windows\\System32\\ntoskrnl.exe';
      }
    }
    return {
      ...entry,
      processName,
      processPath,
      user: entry.user || d?.user,
      commandLine: entry.commandLine || d?.commandLine,
      parentPid: d?.parentPid,
      parentName: d?.parentName
    };
  });
}

// ----- Windows: netstat -ano -----
async function listPortsWindows(): Promise<PortEntry[]> {
  const { stdout } = await execCommand('netstat -ano -p TCP', {
    timeoutMs: 15000
  });
  const { stdout: udpOut } = await execCommand('netstat -ano -p UDP', {
    timeoutMs: 15000
  });
  const tcp6 = await execCommand('netstat -ano -p TCPv6', { timeoutMs: 15000 });
  const udp6 = await execCommand('netstat -ano -p UDPv6', { timeoutMs: 15000 });

  const entries: PortEntry[] = [];
  parseNetstat(stdout, entries);
  parseNetstat(udpOut, entries);
  parseNetstat(tcp6.stdout, entries);
  parseNetstat(udp6.stdout, entries);
  return entries;
}

function parseNetstat(text: string, out: PortEntry[]): void {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Active|Proto\s+/i.test(trimmed)) continue;
    const cols = trimmed.split(/\s+/);
    if (cols.length < 4) continue;
    const proto = cols[0].toUpperCase();
    if (!/^(TCP|UDP|TCPV6|UDPV6)$/.test(proto)) continue;
    const local = cols[1];
    let remote = '';
    let state = '';
    let pid = 0;
    if (/^TCP/i.test(proto)) {
      remote = cols[2] ?? '';
      state = cols[3] ?? '';
      pid = parseInt(cols[4] ?? '0', 10);
    } else {
      remote = cols[2] ?? '';
      pid = parseInt(cols[3] ?? '0', 10);
    }
    const localParsed = splitAddrPort(local);
    const remoteParsed = remote ? splitAddrPort(remote) : null;
    if (!localParsed) continue;
    // Drop wildcard-port rows like "[::]:*" that netstat occasionally
    // emits. Real LISTENING entries always have a concrete port; a
    // localPort of 0 here is just visual noise.
    if (localParsed.port === 0) continue;
    out.push({
      protocol: normalizeProto(proto),
      localAddress: localParsed.address,
      localPort: localParsed.port,
      remoteAddress: remoteParsed?.address,
      remotePort: remoteParsed?.port,
      state: state || undefined,
      pid: Number.isFinite(pid) ? pid : 0
    });
  }
}

function splitAddrPort(s: string): { address: string; port: number } | null {
  if (!s) return null;
  // IPv6 form: [::1]:8080 or [::]:80
  const v6 = s.match(/^\[(.*)\]:(\d+|\*)$/);
  if (v6) {
    return { address: v6[1], port: v6[2] === '*' ? 0 : parseInt(v6[2], 10) };
  }
  const idx = s.lastIndexOf(':');
  if (idx === -1) return null;
  const addr = s.slice(0, idx);
  const portStr = s.slice(idx + 1);
  const port = portStr === '*' ? 0 : parseInt(portStr, 10);
  if (!Number.isFinite(port)) return null;
  return { address: addr, port };
}

function normalizeProto(p: string): Protocol {
  const u = p.toUpperCase();
  if (u === 'TCPV6') return 'TCP6';
  if (u === 'UDPV6') return 'UDP6';
  return u as Protocol;
}

// ----- Darwin / Linux: lsof -----
async function listPortsDarwin(): Promise<PortEntry[]> {
  return parseLsof(
    await runLsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-iUDP', '-FpcLnPT'])
  );
}

async function listPortsLinux(): Promise<PortEntry[]> {
  // Prefer lsof when available; fall back to ss.
  const which = await execCommand('command -v lsof', { timeoutMs: 3000 });
  if (which.stdout.trim()) {
    return parseLsof(await runLsof(['-nP', '-i', '-FpcLnPT']));
  }
  return parseSs();
}

async function runLsof(args: string[]): Promise<string> {
  const { stdout } = await execCommand(`lsof ${args.join(' ')}`, {
    timeoutMs: 15000
  });
  return stdout;
}

/**
 * Parse lsof's -F (field) output. Records start with 'p' lines.
 * `pendingProto` / `pendingState` are intentionally function-local: if
 * we ever call this concurrently (e.g. darwin + linux fallback in the
 * same process) module-level state would cross-talk between calls.
 */
function parseLsof(text: string): PortEntry[] {
  const entries: PortEntry[] = [];
  const lines = text.split(/\r?\n/);
  let pid = 0;
  let cmd = '';
  let user = '';
  let pendingProto: Protocol | '' = '';
  let pendingState = '';
  for (const line of lines) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      pid = parseInt(value, 10) || 0;
      cmd = '';
      user = '';
    } else if (tag === 'c') {
      cmd = value;
    } else if (tag === 'L') {
      user = value;
    } else if (tag === 'n') {
      // address field, parse only when also have a 'P' (protocol) - we accumulate
      const proto = pendingProto;
      const state = pendingState;
      pendingProto = '';
      pendingState = '';
      const parsed = parseLsofAddress(value);
      if (parsed && pid > 0 && proto) {
        entries.push({
          protocol: proto,
          localAddress: parsed.localAddress,
          localPort: parsed.localPort,
          remoteAddress: parsed.remoteAddress,
          remotePort: parsed.remotePort,
          state: state || undefined,
          pid,
          processName: cmd || undefined,
          user: user || undefined
        });
      }
    } else if (tag === 'P') {
      pendingProto = (value.toUpperCase() as Protocol) ?? '';
    } else if (tag === 'T') {
      // T-tags: ST=LISTEN ... we only care about ST=
      const m = value.match(/^ST=(.+)$/);
      if (m) pendingState = m[1];
    }
  }
  return entries;
}

function parseLsofAddress(addr: string): {
  localAddress: string;
  localPort: number;
  remoteAddress?: string;
  remotePort?: number;
} | null {
  // Forms:
  //   *:8080
  //   127.0.0.1:5432
  //   [::1]:8080
  //   127.0.0.1:5432->10.0.0.1:443
  const [localPart, remotePart] = addr.split('->');
  const local = parseHostPort(localPart);
  if (!local) return null;
  const remote = remotePart ? parseHostPort(remotePart) : null;
  return {
    localAddress: local.host,
    localPort: local.port,
    remoteAddress: remote?.host,
    remotePort: remote?.port
  };
}

function parseHostPort(s: string): { host: string; port: number } | null {
  s = s.trim();
  const v6 = s.match(/^\[(.*)\]:(\d+|\*)$/);
  if (v6) {
    return { host: v6[1] || '*', port: v6[2] === '*' ? 0 : parseInt(v6[2], 10) };
  }
  const idx = s.lastIndexOf(':');
  if (idx === -1) return null;
  const host = s.slice(0, idx) || '*';
  const portStr = s.slice(idx + 1);
  const port = portStr === '*' ? 0 : parseInt(portStr, 10);
  if (!Number.isFinite(port)) return null;
  return { host, port };
}

// ----- Linux fallback: ss -tunlp -----
async function parseSs(): Promise<PortEntry[]> {
  const { stdout } = await execCommand('ss -tunlpH', { timeoutMs: 10000 });
  const entries: PortEntry[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 5) continue;
    const proto = cols[0].toUpperCase();
    const state = cols[1];
    const local = cols[4];
    const users = cols.slice(6).join(' ');
    const localParsed = splitAddrPort(local);
    if (!localParsed) continue;
    const pidMatch = users.match(/pid=(\d+)/);
    const nameMatch = users.match(/users:\(\("([^"]+)"/);
    entries.push({
      protocol: (proto.startsWith('TCP') ? 'TCP' : 'UDP') as Protocol,
      localAddress: localParsed.address,
      localPort: localParsed.port,
      state: state || undefined,
      pid: pidMatch ? parseInt(pidMatch[1], 10) : 0,
      processName: nameMatch?.[1]
    });
  }
  return entries;
}
