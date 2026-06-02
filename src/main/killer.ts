import os from 'os';
import { execCommand } from './utils/exec';
import type { KillResult } from '../shared/types';

export async function killProcess(
  pid: number,
  force = true
): Promise<KillResult> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return { pid, success: false, message: 'Invalid PID' };
  }
  try {
    if (os.platform() === 'win32') {
      const cmd = `taskkill ${force ? '/F' : ''} /PID ${pid} /T`;
      const { stdout, stderr, code } = await execCommand(cmd, {
        timeoutMs: 8000
      });
      const out = `${stdout}\n${stderr}`;
      // taskkill /T may exit with non-zero code while still terminating the
      // target (e.g. when a child has already exited). Trust the textual
      // "SUCCESS" marker as the authoritative signal.
      if (code === 0 || /SUCCESS:/i.test(out)) {
        return { pid, success: true, message: stdout.trim() || stderr.trim() };
      }
      return {
        pid,
        success: false,
        message: (stderr || stdout || `taskkill exited with code ${code}`).trim()
      };
    }
    // POSIX
    try {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      return { pid, success: true };
    } catch (e) {
      // EPERM may happen for system processes; try via shell with sudo? We don't escalate silently.
      const msg = e instanceof Error ? e.message : String(e);
      return { pid, success: false, message: msg };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { pid, success: false, message: msg };
  }
}

export async function killProcesses(
  pids: number[],
  force = true
): Promise<KillResult[]> {
  if (!Array.isArray(pids)) return [];
  const unique = Array.from(new Set(pids))
    .filter((p) => Number.isFinite(p) && p > 0)
    .slice(0, 256);
  return Promise.all(unique.map((p) => killProcess(p, force)));
}
