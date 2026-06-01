// Entry point selected via package.json "main".
//
// Under ELECTRON_RUN_AS_NODE=1 + CLOSEDPORT_FAKE_PORT_HOLDER=1 we are a
// child process spawned by the dev "Spawn test ports" tool: bind a random
// TCP port on 127.0.0.1, print "PORT=<n>", and idle until the parent
// kills us. We MUST NOT touch the `electron` module here, because under
// ELECTRON_RUN_AS_NODE most of it is stubbed out.
//
// Otherwise we delegate to the real Electron main, which is safe to
// require because `electron` is the full module in normal mode.
if (process.env.CLOSEDPORT_FAKE_PORT_HOLDER === '1') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const net = require('net') as typeof import('net');
  const server = net.createServer();
  server.on('error', (err: Error) => {
    process.stderr.write(`[fake-holder] error: ${String(err)}\n`);
    process.exit(1);
  });
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.stdout.write(`PORT=${port}\n`);
  });
  // Keep alive until the parent kills us.
  setInterval(() => {
    /* heartbeat */
  }, 60_000);
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./index');
}
