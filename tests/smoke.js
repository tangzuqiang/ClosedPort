// Spawns the real Electron binary with CLOSEDPORT_SMOKE=1, which makes the
// main process call listPorts() once and exit. Validates that the backend
// works end-to-end inside an actual Electron runtime.
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const cwd = path.resolve(__dirname, '..');

const child = spawn(electron, ['.'], {
  cwd,
  env: { ...process.env, CLOSEDPORT_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
let err = '';
child.stdout.on('data', (b) => { out += b.toString(); process.stdout.write(b); });
child.stderr.on('data', (b) => { err += b.toString(); process.stderr.write(b); });

const timer = setTimeout(() => {
  console.error('[smoke] timeout, killing electron');
  child.kill();
  process.exit(1);
}, 30000);

child.on('exit', (code) => {
  clearTimeout(timer);
  if (code !== 0) {
    console.error(`[smoke] electron exited with code ${code}`);
    process.exit(code || 1);
  }
  if (!/\[smoke\] OK/.test(out)) {
    console.error('[smoke] missing OK marker in stdout');
    process.exit(1);
  }
  console.log('[smoke] PASS');
});
