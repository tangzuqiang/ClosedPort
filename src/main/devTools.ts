import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';

// Spawned children we keep track of so we can clean up on app exit.
const spawned = new Set<ChildProcess>();

export interface SpawnedChild {
  pid: number;
  port: number;
}

/**
 * Spawn N child processes that each bind a random TCP listening port and
 * sit idle until killed. We re-execute the current Electron binary
 * (`process.execPath`) with `ELECTRON_RUN_AS_NODE=1 +
 * CLOSEDPORT_FAKE_PORT_HOLDER=1`; the entry point at `entry.ts` detects
 * those env vars and routes the child into a tiny "bind a TCP port and
 * idle" loop. This means a packaged build does not need any external
 * Node interpreter — the user's installed ClosedPort.exe is itself the
 * host for the fake holders. The children's PPID points back at the
 * main ClosedPort process, which is exactly what we want for end-to-end
 * verification of the "Started by" / Kill flows.
 */
export async function spawnFakePortHolders(count: number): Promise<SpawnedChild[]> {
  if (process.platform !== 'win32') {
    throw new Error('spawnFakePortHolders is Windows-only for now');
  }
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  const exe = process.execPath;
  const results: SpawnedChild[] = [];

  for (let i = 0; i < n; i++) {
    const child = spawn(exe, [], {
      env: {
        ...process.env,
        CLOSEDPORT_FAKE_PORT_HOLDER: '1',
        ELECTRON_RUN_AS_NODE: '1'
      },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    if (!child.pid) {
      continue;
    }

    // The child writes a single line "PORT=<n>" to stdout once it is
    // listening. We resolve when we see it (or after a 3s timeout).
    const port = await new Promise<number>((resolve) => {
      let settled = false;
      const settle = (v: number) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      };
      const timer = setTimeout(() => settle(0), 3000);
      child.stdout?.on('data', (buf: Buffer) => {
        const line = buf.toString('utf8');
        const m = /PORT=(\d+)/.exec(line);
        if (m) {
          settle(Number(m[1]));
        }
      });
      // Drain stderr so a chatty child cannot block on a full pipe.
      child.stderr?.on('data', () => {
        /* ignore */
      });
      child.on('error', () => settle(0));
      child.on('exit', () => settle(0));
    });

    spawned.add(child);
    child.on('exit', () => spawned.delete(child));
    if (port > 0) {
      results.push({ pid: child.pid, port });
    } else {
      // Child failed to bind in time; tear it down so we don't leak it.
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }

  return results;
}

export function killAllFakePortHolders(): void {
  for (const child of spawned) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  spawned.clear();
}

// Make sure we don't leak child holders if the main process exits.
app.on('before-quit', killAllFakePortHolders);
app.on('window-all-closed', killAllFakePortHolders);

