import { exec, execFile, execFileSync } from 'child_process';
import os from 'os';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Windows console tools (tasklist / wmic / default PowerShell) emit text in
 * the active OEM/ANSI code page (e.g. CP936 on Chinese Windows). Node's
 * child_process defaults to UTF-8, which turns Chinese process names and
 * paths into mojibake. We capture Buffer and decode with the right charset.
 */
let windowsAnsiEncoding: string | null = null;

const CODE_PAGE_TO_ENCODING: Record<number, string> = {
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  65001: 'utf-8'
};

function resolveWindowsAnsiEncoding(): string {
  if (windowsAnsiEncoding) return windowsAnsiEncoding;
  try {
    // Digits in "Active code page: 936" / "活动代码页: 936" are ASCII-safe
    // even when the label itself is mis-decoded.
    const out = execFileSync('cmd.exe', ['/c', 'chcp'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 3000
    }) as Buffer;
    const m = out.toString('latin1').match(/:\s*(\d+)/);
    const cp = m ? parseInt(m[1], 10) : 0;
    windowsAnsiEncoding = CODE_PAGE_TO_ENCODING[cp] || 'utf-8';
  } catch {
    windowsAnsiEncoding = 'utf-8';
  }
  return windowsAnsiEncoding;
}

function isValidUtf8(buf: Buffer): boolean {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b <= 0x7f) {
      i++;
      continue;
    }
    let need = 0;
    if ((b & 0xe0) === 0xc0) need = 1;
    else if ((b & 0xf0) === 0xe0) need = 2;
    else if ((b & 0xf8) === 0xf0) need = 3;
    else return false;
    if (i + need >= buf.length) return false;
    for (let j = 1; j <= need; j++) {
      if ((buf[i + j] & 0xc0) !== 0x80) return false;
    }
    // Reject overlong / out-of-range sequences lightly.
    if (need === 1 && b < 0xc2) return false;
    if (need === 3 && b === 0xf0 && buf[i + 1] < 0x90) return false;
    if (need === 3 && b === 0xf4 && buf[i + 1] > 0x8f) return false;
    i += 1 + need;
  }
  return true;
}

export function decodeChildOutput(buf: Buffer | string): string {
  if (typeof buf === 'string') return buf;
  if (!buf || buf.length === 0) return '';

  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  // UTF-16LE BOM (PowerShell occasionally emits this when redirected)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le').slice(1);
  }

  if (os.platform() !== 'win32') {
    return buf.toString('utf8');
  }

  if (isValidUtf8(buf)) {
    return buf.toString('utf8');
  }

  const enc = resolveWindowsAnsiEncoding();
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/**
 * Prefix for PowerShell scripts so ConvertTo-Json / Write-Output emit UTF-8
 * instead of the console OEM code page. Safe to prepend to any -Command body.
 */
export const POWERSHELL_UTF8_PREAMBLE =
  `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` +
  `$OutputEncoding=[System.Text.Encoding]::UTF8;`;

export function execCommand(
  command: string,
  options: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<ExecResult> {
  const { timeoutMs = 15000, maxBuffer = 1024 * 1024 * 32 } = options;
  return new Promise((resolve) => {
    exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer,
        windowsHide: true,
        encoding: 'buffer'
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: decodeChildOutput(stdout as Buffer),
          stderr: decodeChildOutput(stderr as Buffer),
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0
        });
      }
    );
  });
}

export function tryExec(command: string): Promise<ExecResult | null> {
  return execCommand(command).catch(() => null);
}

export function execFileCommand(
  file: string,
  args: string[],
  options: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<ExecResult> {
  const { timeoutMs = 15000, maxBuffer = 1024 * 1024 * 32 } = options;
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        maxBuffer,
        windowsHide: true,
        encoding: 'buffer'
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: decodeChildOutput(stdout as Buffer),
          stderr: decodeChildOutput(stderr as Buffer),
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0
        });
      }
    );
  });
}
