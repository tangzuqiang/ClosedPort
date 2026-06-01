/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Standalone E2E for ClosedPort backend modules.
 * Runs without Electron/Jest. Exits with non-zero on first failure.
 *
 * Usage: node tests/e2e.js
 */
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Stub the 'electron' module so backend modules load outside Electron.
const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => ROOT,
    getPath: (key) => {
      if (key === 'temp') return os.tmpdir();
      return os.tmpdir();
    }
  },
  BrowserWindow: class {},
  ipcMain: { handle: () => {} },
  Tray: class {},
  Menu: { buildFromTemplate: () => ({}) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { showItemInFolder: () => {} },
  nativeImage: { createEmpty: () => ({ isEmpty: () => true }), createFromDataURL: () => ({}) },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null }
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return 'electron-stub';
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache['electron-stub'] = {
  id: 'electron-stub',
  filename: 'electron-stub',
  loaded: true,
  exports: electronStub
};
const portScanner = require(path.join(ROOT, 'dist-electron/main/portScanner'));
const killer = require(path.join(ROOT, 'dist-electron/main/killer'));
const folderScanner = require(path.join(ROOT, 'dist-electron/main/folderScanner'));
const processInfo = require(path.join(ROOT, 'dist-electron/main/utils/processInfo'));

let passed = 0;
let failed = 0;
const failures = [];

function log(...a) {
  process.stdout.write(a.join(' ') + '\n');
}

async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    passed++;
    log(`  PASS  ${name}  (${Date.now() - start}ms)`);
  } catch (e) {
    failed++;
    const msg = e && e.stack ? e.stack : String(e);
    failures.push({ name, msg });
    log(`  FAIL  ${name}  (${Date.now() - start}ms)`);
    log(msg.split('\n').map((l) => '         ' + l).join('\n'));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function startListenServer() {
  return new Promise((resolve) => {
    const server = net.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

function startChildListenServer() {
  // Spawn a node child that opens a TCP listener, so we can kill it.
  return new Promise((resolve, reject) => {
    const code = `
      const net = require('net');
      const s = net.createServer(() => {});
      s.listen(0, '127.0.0.1', () => {
        process.stdout.write('PORT=' + s.address().port + '\\n');
      });
      setInterval(() => {}, 60_000);
    `;
    const child = spawn(process.execPath, ['-e', code], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buf = '';
    let resolved = false;
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/PORT=(\d+)/);
      if (m && !resolved) {
        resolved = true;
        resolve({ child, port: parseInt(m[1], 10) });
      }
    });
    child.on('error', reject);
    setTimeout(() => {
      if (!resolved) reject(new Error('child server did not emit port within 5s'));
    }, 5000);
  });
}

(async () => {
  log('ClosedPort E2E');
  log('  platform:', os.platform(), '  node:', process.version);
  log('');

  // 1) processInfo for current process
  await test('processInfo: details for current process (self)', async () => {
    const d = await processInfo.getProcessDetail(process.pid);
    assert(d, 'no detail');
    assert(d.pid === process.pid, 'pid roundtrip');
    if (d.name) assert(/node/i.test(d.name), `name should look like node, got ${d.name}`);
    log('         name=', d.name, ' path=', d.path, ' user=', d.user);
  });

  // 2) listPorts contains a freshly-bound listener and our PID
  await test('portScanner: bound port appears with our pid + name', async () => {
    const { server, port } = await startListenServer();
    try {
      // Give the OS a moment to register the socket
      await new Promise((r) => setTimeout(r, 200));
      const all = await portScanner.listPorts();
      assert(Array.isArray(all), 'listPorts should return array');
      assert(all.length > 0, 'expected non-empty port list');
      const found = all.find(
        (e) => e.localPort === port && e.pid === process.pid
      );
      assert(found, `expected entry with port ${port} pid ${process.pid}`);
      assert(/^TCP/.test(found.protocol), `protocol should start with TCP, got ${found.protocol}`);
      // processName should resolve through processInfo enrichment
      assert(found.processName, 'processName should be enriched');
      // parentPid should resolve too (we have a parent: usually the shell)
      assert(typeof found.parentPid === 'number' && found.parentPid > 0,
        `parentPid should be a positive number, got ${found.parentPid}`);
      log('         got entry:', JSON.stringify({
        proto: found.protocol,
        local: `${found.localAddress}:${found.localPort}`,
        state: found.state,
        pid: found.pid,
        name: found.processName,
        path: found.processPath,
        ppid: found.parentPid,
        parentName: found.parentName
      }));
    } finally {
      server.close();
    }
  });

  // 3) Kill: spawn a child with a listening port, then kill it via our killer.
  await test('killer: kill a child process that holds a listening port', async () => {
    const { child, port } = await startChildListenServer();
    try {
      // verify child is reachable in port list
      await new Promise((r) => setTimeout(r, 300));
      const before = await portScanner.listPorts();
      const target = before.find((e) => e.localPort === port && e.pid === child.pid);
      assert(target, `child port ${port} (pid ${child.pid}) should appear before kill`);

      const res = await killer.killProcess(child.pid, true);
      assert(res.success, `killProcess should succeed: ${res.message}`);

      // wait for OS cleanup
      await new Promise((r) => setTimeout(r, 1000));
      const after = await portScanner.listPorts();
      const stillThere = after.find((e) => e.localPort === port && e.pid === child.pid);
      assert(!stillThere, `child port should be released after kill`);
      log('         killed pid=', child.pid, ' port=', port, ' freed.');
    } finally {
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }
  });

  // 4) Killer: invalid pid returns success=false
  await test('killer: invalid pid returns failure result (no throw)', async () => {
    const r = await killer.killProcess(0, true);
    assert(r.success === false, 'killProcess(0) should fail');
    const r2 = await killer.killProcess(-1, true);
    assert(r2.success === false, 'killProcess(-1) should fail');
  });

  // 5) folderScanner: graceful behavior on a temp folder
  if (os.platform() === 'win32') {
    await test('folderScanner: scan temp dir runs without throwing', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'closedport-e2e-'));
      try {
        // Create one file with an open file handle (this process)
        const filePath = path.join(tmp, 'locked.txt');
        const fd = fs.openSync(filePath, 'w');
        try {
          const res = await folderScanner.scanFolder(tmp);
          assert(Array.isArray(res), 'scanFolder should return array');
          // we don't strictly require it to find this process (depends on handle.exe presence),
          // but the call must not throw.
          log('         scanFolder returned', res.length, 'entries');
        } finally {
          fs.closeSync(fd);
        }
      } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      }
    });
  } else {
    log('  SKIP  folderScanner test (non-Windows platform)');
  }

  // 6) folderScanner: scanning on non-Windows returns []
  if (os.platform() !== 'win32') {
    await test('folderScanner: returns empty on non-Windows', async () => {
      const res = await folderScanner.scanFolder(os.tmpdir());
      assert(Array.isArray(res) && res.length === 0, 'should be empty array');
    });
  }

  log('');
  log(`Done. ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    log('');
    log('Failures:');
    for (const f of failures) {
      log('- ' + f.name);
    }
    process.exit(1);
  }
})();
