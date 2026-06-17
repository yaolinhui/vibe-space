#!/usr/bin/env node

/**
 * Vibe Space 进程看门狗
 *
 * 职责：
 * - 启动并持续监控 server.js 子进程
 * - 通过 /health 轮询检测服务健康
 * - 服务不可用时自动重启，带指数退避
 * - 管理 daemon.pid 文件
 * - 转发 SIGINT/SIGTERM 给子进程，优雅退出
 *
 * 用法：
 *   node daemon.js [--port=<n>] [--config=<path>]
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const SERVER_PATH = path.join(__dirname, 'server.js');
const PID_FILE = path.join(__dirname, 'daemon.pid');

const HEALTH_INTERVAL_MS = 5000;
const HEALTH_TIMEOUT_MS = 3000;
const HEALTH_FAILURE_THRESHOLD = 3;
const MAX_BACKOFF_MS = 30000;

function parseArgs(argv) {
  const args = {
    port: process.env.PORT || '9988',
    config: process.env.VIBE_SPACE_CONFIG || '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--port=')) args.port = arg.slice(7);
    else if (arg.startsWith('--config=')) args.config = arg.slice(9);
    else if (arg === '--port' && argv[i + 1]) args.port = argv[++i];
    else if (arg === '--config' && argv[i + 1]) args.config = argv[++i];
  }
  return args;
}

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (e) {
    console.error('[daemon] 写入 PID 文件失败:', e.message);
  }
}

function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch (_) {}
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.status === 'ok' && json.service === 'vibe-space');
        } catch (_) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const port = parseInt(args.port, 10);

  writePidFile();

  let child = null;
  let consecutiveFailures = 0;
  let backoffMs = 1000;
  let healthTimer = null;
  let shuttingDown = false;

  function startServer() {
    if (shuttingDown) return;
    if (child) {
      try { child.kill(); } catch (_) {}
    }

    const serverArgs = [SERVER_PATH, `--port=${port}`];
    if (args.config) serverArgs.push(`--config=${args.config}`);

    console.log(`[daemon] 启动 server.js (port=${port})`);
    child = spawn(process.execPath, serverArgs, {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(port) },
    });

    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      console.log(`[daemon] server.js 退出 (code=${code}, signal=${signal})，将自动重启`);
      consecutiveFailures++;
      child = null;
      const delay = Math.min(backoffMs * Math.pow(2, Math.max(0, consecutiveFailures - HEALTH_FAILURE_THRESHOLD)), MAX_BACKOFF_MS);
      setTimeout(startServer, delay);
    });

    child.on('error', (err) => {
      console.error('[daemon] 启动 server.js 失败:', err.message);
    });
  }

  async function healthCheck() {
    if (shuttingDown || !child) return;

    const healthy = await checkHealth(port);
    if (healthy) {
      if (consecutiveFailures > 0) {
        console.log('[daemon] 服务恢复健康');
      }
      consecutiveFailures = 0;
      backoffMs = 1000;
      return;
    }

    consecutiveFailures++;
    console.log(`[daemon] 健康检查失败 (${consecutiveFailures}/${HEALTH_FAILURE_THRESHOLD})`);

    if (consecutiveFailures >= HEALTH_FAILURE_THRESHOLD) {
      console.log('[daemon] 健康检查连续失败，重启 server.js');
      if (child) {
        try { child.kill(); } catch (_) {}
        child = null;
      }
      const delay = Math.min(backoffMs, MAX_BACKOFF_MS);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      setTimeout(startServer, delay);
    }
  }

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[daemon] 收到 ${signal}，正在关闭 server.js...`);
    removePidFile();
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (child) {
      child.kill(signal);
      // 强制兜底
      setTimeout(() => {
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
        process.exit(0);
      }, 5000).unref();
    } else {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', removePidFile);

  startServer();
  healthTimer = setInterval(healthCheck, HEALTH_INTERVAL_MS);
}

run().catch((err) => {
  console.error('[daemon] 异常:', err.message);
  removePidFile();
  process.exit(1);
});
