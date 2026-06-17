#!/usr/bin/env node

const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const pkg = require('../package.json');

function parseArgs(argv) {
  const args = {
    port: process.env.PORT || 9988,
    open: true,
    config: process.env.VIBE_SPACE_CONFIG || '',
    daemon: true,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--version' || arg === '-v') args.version = true;
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--no-daemon') args.daemon = false;
    else if (arg.startsWith('--port=')) args.port = arg.slice(7);
    else if (arg.startsWith('--config=')) args.config = arg.slice(9);
    else if (arg === '--port' && argv[i + 1]) args.port = argv[++i];
    else if (arg === '--config' && argv[i + 1]) args.config = argv[++i];
  }

  return args;
}

function printHelp() {
  console.log(`
Vibe Space — Multi-Agent Task Queue for Claude Code

Usage:
  vibe-space [options]

Options:
  --port=<n>      Port to run the server on (default: 9988)
  --config=<path> Path to a custom config file
  --no-open       Do not open the browser automatically
  --no-daemon     Run server.js directly without the watchdog daemon (development)
  --help, -h      Show this help message
  --version, -v   Show version

Examples:
  vibe-space
  vibe-space --port=9999
  vibe-space --config=./my-config.json --no-open
  vibe-space --no-daemon --port=9999
`);
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        findAvailablePort(startPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.listen(startPort, '127.0.0.1');
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.status === 'ok') return resolve();
          } catch (_) {}
          retry();
        });
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });

      function retry() {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('Server did not become healthy in time'));
        }
        setTimeout(tryConnect, 500);
      }
    }
    tryConnect();
  });
}

function findChrome() {
  if (process.platform !== 'win32') return null;
  const fs = require('fs');
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openBrowser(url) {
  const chrome = findChrome();
  if (chrome) {
    const cmd = `start "" "${chrome}" --app=${url} --disable-background-timer-throttling --start-maximized`;
    spawn(cmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const platform = process.platform;
  let command;
  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  spawn(command, { shell: true, detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(pkg.version);
    process.exit(0);
  }

  const requestedPort = parseInt(args.port, 10);
  const port = await findAvailablePort(requestedPort);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} is in use, using port ${port}`);
  }

  const useDaemon = args.daemon;
  const scriptPath = useDaemon
    ? path.join(__dirname, '..', 'daemon.js')
    : path.join(__dirname, '..', 'server.js');
  const serverArgs = [scriptPath, `--port=${port}`];
  if (args.config) serverArgs.push(`--config=${args.config}`);

  console.log(`[Vibe Space] Starting ${useDaemon ? 'daemon' : 'server'} on port ${port}...`);

  const child = spawn(process.execPath, serverArgs, {
    stdio: 'inherit',
    env: { ...process.env, PORT: port.toString() },
  });

  child.on('error', (err) => {
    console.error(`[Vibe Space] Failed to start ${useDaemon ? 'daemon' : 'server'}:`, err.message);
    process.exit(1);
  });

  try {
    await waitForServer(port);
    console.log('[Vibe Space] Server is ready');

    if (args.open) {
      const url = `http://127.0.0.1:${port}/workspace`;
      console.log(`[Vibe Space] Opening ${url}`);
      openBrowser(url);
    } else {
      console.log(`[Vibe Space] Workspace: http://127.0.0.1:${port}/workspace`);
    }
  } catch (err) {
    console.error('[Vibe Space] Server health check failed:', err.message);
    child.kill();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Vibe Space] Error:', err.message);
  process.exit(1);
});
