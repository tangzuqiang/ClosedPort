import { exec } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function execCommand(
  command: string,
  options: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<ExecResult> {
  const { timeoutMs = 15000, maxBuffer = 1024 * 1024 * 32 } = options;
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, maxBuffer, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0
        });
      }
    );
  });
}

export function tryExec(command: string): Promise<ExecResult | null> {
  return execCommand(command).catch(() => null);
}
