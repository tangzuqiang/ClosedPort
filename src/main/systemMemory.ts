import os from 'os';
import fs from 'fs';
import {
  execCommand,
  execFileCommand,
  POWERSHELL_UTF8_PREAMBLE
} from './utils/exec';
import type { SystemMemoryInfo } from '../shared/types';

export async function listSystemMemory(): Promise<SystemMemoryInfo> {
  const platform = os.platform();
  if (platform === 'win32') return memWindows();
  if (platform === 'darwin') return memDarwin();
  if (platform === 'linux') return memLinux();
  return emptyResult('unsupported', `Platform ${platform} is not supported.`);
}

function emptyResult(
  backend: SystemMemoryInfo['backend'],
  warning?: string
): SystemMemoryInfo {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalBytes: total,
    usedBytes: Math.max(0, total - free),
    freeBytes: free,
    availableBytes: free,
    cachedBytes: 0,
    compressedBytes: 0,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
    capturedAt: Date.now(),
    backend,
    warning
  };
}

// ---------------- Windows ----------------

async function memWindows(): Promise<SystemMemoryInfo> {
  const script = [
    POWERSHELL_UTF8_PREAMBLE,
    `$ErrorActionPreference='SilentlyContinue';`,
    `$os = Get-CimInstance Win32_OperatingSystem;`,
    `$standby = 0; $cache = 0; $modified = 0;`,
    `try {`,
    `  $sc = (Get-Counter '\\Memory\\Standby Cache Normal Priority Bytes' -ErrorAction Stop).CounterSamples[0].CookedValue;`,
    `  if ($sc) { $standby = [int64]$sc }`,
    `} catch {}`,
    `try {`,
    `  $cb = (Get-Counter '\\Memory\\Cache Bytes' -ErrorAction Stop).CounterSamples[0].CookedValue;`,
    `  if ($cb) { $cache = [int64]$cb }`,
    `} catch {}`,
    `try {`,
    `  $mb = (Get-Counter '\\Memory\\Modified Page List Bytes' -ErrorAction Stop).CounterSamples[0].CookedValue;`,
    `  if ($mb) { $modified = [int64]$mb }`,
    `} catch {}`,
    `$out = [pscustomobject]@{`,
    `  TotalKB = [int64]$os.TotalVisibleMemorySize;`,
    `  FreeKB = [int64]$os.FreePhysicalMemory;`,
    `  TotalVirtKB = [int64]$os.TotalVirtualMemorySize;`,
    `  FreeVirtKB = [int64]$os.FreeVirtualMemory;`,
    `  PageTotalKB = [int64]$os.SizeStoredInPagingFiles;`,
    `  PageFreeKB = [int64]$os.FreeSpaceInPagingFiles;`,
    `  StandbyBytes = [int64]$standby;`,
    `  CacheBytes = [int64]$cache;`,
    `  ModifiedBytes = [int64]$modified;`,
    `};`,
    `$out | ConvertTo-Json -Compress`
  ].join(' ');

  const res = await execFileCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeoutMs: 8000 }
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    return emptyResult('win32', res.stderr.trim() || 'powershell failed');
  }
  let data: Record<string, number>;
  try {
    data = JSON.parse(res.stdout);
  } catch (e) {
    return emptyResult('win32', `parse error: ${(e as Error).message}`);
  }
  const totalBytes = (data.TotalKB || 0) * 1024;
  const freeBytes = (data.FreeKB || 0) * 1024;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const cachedBytes = data.CacheBytes || data.StandbyBytes || 0;
  const compressedBytes = data.ModifiedBytes || 0;
  const availableBytes = freeBytes + (data.StandbyBytes || 0);
  // Page file total / free are commit-charge backings; treat as swap.
  const pageTotalKB = data.PageTotalKB || 0;
  const pageFreeKB = data.PageFreeKB || 0;
  const swapTotalBytes = pageTotalKB * 1024;
  const swapUsedBytes = Math.max(0, (pageTotalKB - pageFreeKB) * 1024);
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    cachedBytes,
    compressedBytes,
    swapTotalBytes,
    swapUsedBytes,
    capturedAt: Date.now(),
    backend: 'win32'
  };
}

// ---------------- macOS ----------------

async function memDarwin(): Promise<SystemMemoryInfo> {
  const [vmRes, sizeRes, swapRes] = await Promise.all([
    execCommand('vm_stat', { timeoutMs: 5000 }),
    execCommand('sysctl -n hw.memsize', { timeoutMs: 5000 }),
    execCommand('sysctl vm.swapusage', { timeoutMs: 5000 })
  ]);
  if (vmRes.code !== 0 || !vmRes.stdout) {
    return emptyResult('darwin', 'vm_stat failed');
  }
  const totalBytes = parseInt(sizeRes.stdout.trim(), 10) || 0;
  let pageSize = 4096;
  const headerMatch = /page size of (\d+) bytes/i.exec(vmRes.stdout);
  if (headerMatch) pageSize = parseInt(headerMatch[1], 10) || 4096;
  const pagesOf = (key: string): number => {
    const re = new RegExp(`${key}[^:]*:\\s*(\\d+)`, 'i');
    const m = re.exec(vmRes.stdout);
    return m ? parseInt(m[1], 10) : 0;
  };
  const free = pagesOf('Pages free') * pageSize;
  const active = pagesOf('Pages active') * pageSize;
  const inactive = pagesOf('Pages inactive') * pageSize;
  const wired = pagesOf('Pages wired down') * pageSize;
  const speculative = pagesOf('Pages speculative') * pageSize;
  const compressed = pagesOf('Pages occupied by compressor') * pageSize;
  const cached =
    pagesOf('File-backed pages') * pageSize ||
    inactive + speculative;
  const purgeable = pagesOf('Pages purgeable') * pageSize;
  const usedBytes = Math.max(0, active + wired + compressed);
  const freeBytes = free;
  const availableBytes = free + inactive + purgeable + speculative;

  let swapTotalBytes = 0;
  let swapUsedBytes = 0;
  if (swapRes.code === 0 && swapRes.stdout) {
    const sm = /total\s*=\s*([\d.]+)([KMG])\s+used\s*=\s*([\d.]+)([KMG])/i.exec(
      swapRes.stdout
    );
    if (sm) {
      const unitToBytes = (v: string, u: string): number => {
        const n = parseFloat(v);
        const mult =
          u.toUpperCase() === 'G'
            ? 1024 ** 3
            : u.toUpperCase() === 'M'
              ? 1024 ** 2
              : 1024;
        return Math.round(n * mult);
      };
      swapTotalBytes = unitToBytes(sm[1], sm[2]);
      swapUsedBytes = unitToBytes(sm[3], sm[4]);
    }
  }

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    cachedBytes: cached,
    compressedBytes: compressed,
    swapTotalBytes,
    swapUsedBytes,
    capturedAt: Date.now(),
    backend: 'darwin'
  };
}

// ---------------- Linux ----------------

async function memLinux(): Promise<SystemMemoryInfo> {
  let raw = '';
  try {
    raw = fs.readFileSync('/proc/meminfo', 'utf8');
  } catch (e) {
    return emptyResult('linux', `meminfo read failed: ${(e as Error).message}`);
  }
  const kv: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const m = /^([^:]+):\s*(\d+)\s*kB/.exec(line);
    if (m) kv[m[1]] = parseInt(m[2], 10) * 1024;
  }
  const totalBytes = kv['MemTotal'] || 0;
  const freeBytes = kv['MemFree'] || 0;
  const availableBytes = kv['MemAvailable'] || freeBytes;
  const cachedBytes = (kv['Cached'] || 0) + (kv['Buffers'] || 0);
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapTotalBytes = kv['SwapTotal'] || 0;
  const swapFreeBytes = kv['SwapFree'] || 0;
  const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
  const compressedBytes = kv['Zswap'] || 0;
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    cachedBytes,
    compressedBytes,
    swapTotalBytes,
    swapUsedBytes,
    capturedAt: Date.now(),
    backend: 'linux'
  };
}
