const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const {
  saveRuntimeState,
  loadRuntimeState,
  deleteRuntimeState,
  buildRuntimeState,
  restoreRuntimeState,
} = require('./lib/state-persistence');

function parseCliArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? true : arg.slice(eq + 1);
      args[key] = value;
    }
  });
  return args;
}

const cliArgs = parseCliArgs();
const CONFIG_PATH = cliArgs.config ? path.resolve(cliArgs.config) : path.join(__dirname, 'config.json');
const PORT = parseInt(process.env.PORT || cliArgs.port || 9988, 10);
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 10; // 保留最近 10 个时间戳备份
const PID_FILE = path.join(__dirname, 'server.pid');

// 单实例检查：避免重复启动导致 EADDRINUSE
function checkSingleInstance() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (pid && !Number.isNaN(pid)) {
        try {
          process.kill(pid, 0); // 测试进程是否存活
          // 进程存活，进一步确认是否是 Vibe Space
          try {
            const http = require('http');
            const req = http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 1500 }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                if (data.includes('vibe-space')) {
                  console.error(`\nVibe Space is already running (PID: ${pid})`);
                  console.error(`Visit http://localhost:${PORT} or terminate the process before restarting.\n`);
                  process.exit(1);
                } else {
                  console.warn('PID 文件存在，但端口被其他服务占用，尝试清理并继续...');
                  fs.unlinkSync(PID_FILE);
                }
              });
            });
            req.on('error', () => {
              console.warn('PID 文件存在，但健康检查失败，可能是残留文件，尝试清理...');
              try { fs.unlinkSync(PID_FILE); } catch (_) {}
            });
            req.on('timeout', () => {
              req.destroy();
              console.warn('PID 文件存在，健康检查超时，尝试清理...');
              try { fs.unlinkSync(PID_FILE); } catch (_) {}
            });
            return; // 异步检查，剩余逻辑在回调中执行
          } catch (e) {
            // 同步异常，继续清理
          }
        } catch (e) {
          // 进程已不存在，清理残留 PID 文件
          try { fs.unlinkSync(PID_FILE); } catch (_) {}
        }
      }
    } catch (e) {
      try { fs.unlinkSync(PID_FILE); } catch (_) {}
    }
  }
}
checkSingleInstance();

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (e) {
    console.error('写入 PID 文件失败:', e.message);
  }
}

function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch (e) {}
}

// 保存队列与锁，防止并发覆盖
let saveQueue = [];
let isSaving = false;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('config-') && f.endsWith('.json'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    files.slice(MAX_BACKUPS).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (_) {}
    });
  } catch (e) { /* 忽略清理错误 */ }
}

function createBackup() {
  try {
    ensureBackupDir();
    if (fs.existsSync(CONFIG_PATH)) {
      // 创建 .bak 快速恢复备份
      fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
      // 创建带时间戳的历史备份
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(BACKUP_DIR, `config-${stamp}.json`);
      fs.copyFileSync(CONFIG_PATH, backupPath);
      cleanupOldBackups();
    }
  } catch (e) {
    console.error('创建备份失败:', e.message);
  }
}

function loadConfigFrom(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function loadConfig() {
  // 1. 尝试读取主配置
  let cfg = loadConfigFrom(CONFIG_PATH);
  if (cfg) {
    migrateConfigV2(cfg);
    return cfg;
  }

  console.error('主配置文件损坏或不存在，尝试从备份恢复...');

  // 2. 尝试 .bak 备份
  cfg = loadConfigFrom(CONFIG_PATH + '.bak');
  if (cfg) {
    console.log('已从 config.json.bak 恢复配置');
    migrateConfigV2(cfg);
    try {
      fs.copyFileSync(CONFIG_PATH + '.bak', CONFIG_PATH);
    } catch (e) {}
    return cfg;
  }

  // 3. 尝试时间戳备份（最新的有效备份）
  try {
    ensureBackupDir();
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('config-') && f.endsWith('.json'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const b of backups) {
      cfg = loadConfigFrom(path.join(BACKUP_DIR, b.name));
      if (cfg) {
        console.log(`已从备份 ${b.name} 恢复配置`);
        migrateConfigV2(cfg);
        try {
          fs.copyFileSync(path.join(BACKUP_DIR, b.name), CONFIG_PATH);
        } catch (e) {}
        return cfg;
      }
    }
  } catch (e) {}

  // 4. 全部失败，返回默认配置
  console.error('无法从任何备份恢复，使用默认配置');
  return {
    locale: 'en',
    layout: { rows: 2, cols: 3 },
    projects: [],
    panes: [],
    nextPaneId: 0,
    ai: { provider: 'kimi' },
    startupCommand: 'claude',
    theme: { fontSize: 11, scrollback: 1000, showScrollbar: false },
    loop: {
      silenceThreshold: 60,
      autoPassDelay: 15,
      silenceConfirmCount: 2,
      busyExtraSilenceMs: 15000,
      stuckTaskTimeoutMs: 120000,
      maxAutoFixAttempts: 3,
    }
  };
}

/**
 * V2 配置迁移：把项目定义和 pane 实例分开
 * - projects 保留 name/cwd/command/color 等共享配置
 * - panes 保留 tasks/loopAutoReset 等 per-pane 状态
 */
function migrateConfigV2(config) {
  if (!config) return false;

  // 确保 projects 有稳定 id
  if (!config.projects) config.projects = [];
  config.projects.forEach((proj, i) => {
    if (proj.id === undefined) proj.id = i;
  });

  // 已经迁移过：保持 projects.tasks 与 panes.tasks 引用同步，
  // 避免前端仍按 V1 读取 projects.tasks 时看不到任务。
  if (config.panes) {
    let changed = false;
    config.projects.forEach(proj => {
      const pane = config.panes.find(p => p.projectId === proj.id);
      if (!pane) return;
      // 让 projects.tasks 与 panes.tasks 共享同一个数组引用，
      // 这样前端修改 projects.tasks 时，服务器看到的 panes.tasks 也会同步更新。
      if (proj.tasks !== pane.tasks) {
        proj.tasks = pane.tasks || [];
        changed = true;
      }
      if (proj.loopAutoReset !== pane.loopAutoReset) {
        proj.loopAutoReset = pane.loopAutoReset ?? true;
        changed = true;
      }
    });
    if (changed) console.log('已同步 panes.tasks 回 projects.tasks 以保持前端兼容');
    return false;
  }

  // 首次迁移：从旧 projects 提取 panes
  config.panes = config.projects.map((proj, i) => ({
    id: i,
    projectId: proj.id,
    tasks: proj.tasks || [],
    loopAutoReset: proj.loopAutoReset ?? true,
  }));

  // 让 projects.tasks 与 panes.tasks 共享引用，前端 V1 代码仍可正常工作
  config.projects.forEach((proj, i) => {
    proj.tasks = config.panes[i].tasks;
    proj.loopAutoReset = config.panes[i].loopAutoReset;
  });

  config.nextPaneId = config.projects.length;

  console.log('配置已自动迁移到 V2（projects + panes，tasks 引用保持共享）');
  return true;
}

function getProjectById(config, projectId) {
  if (!config.projects) return null;
  return config.projects.find(p => p.id === projectId) || null;
}

function getPaneById(config, paneId) {
  if (!config.panes) return null;
  return config.panes.find(p => p.id === paneId) || null;
}

function getProjectByPaneId(config, paneId) {
  const pane = getPaneById(config, paneId);
  if (!pane) return null;
  return getProjectById(config, pane.projectId);
}

/**
 * 迁移旧配置中内联的 base64 图片/二进制附件到本地文件
 * 返回 true 表示有迁移发生
 */
function migrateInlineAttachments(config) {
  let migrated = false;
  if (!config.panes) return migrated;

  config.panes.forEach((pane, paneIndex) => {
    if (!pane.tasks) return;
    const proj = getProjectByPaneId(config, pane.id);
    if (!proj || !proj.cwd) return;

    pane.tasks.forEach((task, taskIndex) => {
      if (!task.attachments || task.attachments.length === 0) return;

      const baseDir = path.join(proj.cwd, '.vibe-space', 'attachments', `${pane.id}-${taskIndex}`);
      fs.mkdirSync(baseDir, { recursive: true });

      task.attachments = task.attachments.map((att, idx) => {
        // 文本附件和已有 path 的附件不处理
        if (att.kind === 'text' || att.isVirtualText || att.path) return att;

        const raw = att.data || att.content || '';
        const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
        if (!base64) return att;

        // 已经有文件路径则直接剔除 data
        if (att.saved && att.path) {
          const { data, content, ...meta } = att;
          migrated = true;
          return { ...meta };
        }

        try {
          const ext = path.extname(att.name) || (att.kind === 'image' ? '.png' : '.bin');
          const baseName = path.basename(att.name || `attachment_${idx}`, ext);
          const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileName = `${Date.now()}_${safeName}${ext}`;
          const filePath = path.join(baseDir, fileName);
          fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

          const { data, content, ...meta } = att;
          migrated = true;
          return { ...meta, path: filePath, saved: true };
        } catch (e) {
          console.error(`迁移附件失败 ${pane.id}-${taskIndex}/${att.name}:`, e.message);
          return att;
        }
      });
    });
  });

  return migrated;
}

function serializeConfig(config) {
  // 保存前清理运行时状态并迁移内联附件
  const clean = JSON.parse(JSON.stringify(config));
  migrateInlineAttachments(clean);
  if (clean.projects) {
    clean.projects.forEach(p => {
      // 删除以下划线开头的运行时字段
      Object.keys(p).forEach(k => {
        if (k.startsWith('_')) delete p[k];
      });
    });
  }
  if (clean.panes) {
    clean.panes.forEach(pane => {
      // 删除以下划线开头的运行时字段
      Object.keys(pane).forEach(k => {
        if (k.startsWith('_')) delete pane[k];
      });
      // 清理任务中的运行时大字段，保留关键状态
      if (pane.tasks) {
        pane.tasks.forEach(t => {
          // 保留的状态字段（用户关心的）
          const keepFields = ['text', 'status', 'done', 'createdAt', 'dispatchedAt', 'doneAt', 'testedAt', 'failedAt', 'type', 'blockedBy', 'attachments', 'command', 'cost', 'tokens', 'costModel', 'verificationNote', 'autoFixCount', 'autoFailed', 'isAutoFix', 'parentTaskIndex', 'loopAutoReset'];
          // 删除大字段快照（单独存日志文件）
          delete t.outputSnapshot;
          delete t.errorSnapshot;
        });
      }
    });
  }
  return JSON.stringify(clean, null, 2);
}

function writeConfigAtomic(jsonStr) {
  const tmpPath = CONFIG_PATH + '.tmp';
  try {
    // 原子写入：先写临时文件，再重命名
    fs.writeFileSync(tmpPath, jsonStr, 'utf8');
    fs.renameSync(tmpPath, CONFIG_PATH);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw e;
  }
}

function processSaveQueue() {
  if (isSaving || saveQueue.length === 0) return;
  isSaving = true;
  const { jsonStr, resolve, reject } = saveQueue.shift();
  try {
    createBackup();
    writeConfigAtomic(jsonStr);
    resolve();
  } catch (e) {
    console.error('保存配置失败:', e.message);
    reject(e);
  } finally {
    isSaving = false;
    // 使用 setImmediate 让其他请求有机会插入，但仍保持串行
    setImmediate(processSaveQueue);
  }
}

function saveConfig(config) {
  return new Promise((resolve, reject) => {
    try {
      const jsonStr = serializeConfig(config);
      saveQueue.push({ jsonStr, resolve, reject });
      processSaveQueue();
    } catch (e) {
      reject(e);
    }
  });
}

let config = loadConfig();
// 启动时从 runtime-state.json 恢复的状态，供首次创建 PTY 时使用
const restoredRuntimeState = new Map();

// Server 启动时：尝试从 runtime-state.json 恢复运行中任务；
// 若不存在有效快照，则把 dispatched/running/executing 重置为 idle，避免状态不一致。
(async () => {
  if (!config.panes) return;

  const runtimeState = loadRuntimeState(CONFIG_PATH);
  let restored = [];
  if (runtimeState) {
    const result = restoreRuntimeState(config, runtimeState);
    restored = result.restored || [];
    if (result.global && result.global.loopProjectIndex != null) {
      loopProjectIndex = result.global.loopProjectIndex;
    }
    restored.forEach(r => {
      if (r.loopRunning) paneLoopStates.set(r.paneId, true);
      restoredRuntimeState.set(r.paneId, r);
    });
    console.log(`已从 runtime-state.json 恢复 ${restored.length} 个 pane 的运行时状态`);
  }

  const restoredPaneIds = new Set(restored.map(r => r.paneId));
  let changed = false;
  config.panes.forEach(pane => {
    if (!pane.tasks) return;
    pane.tasks.forEach(t => {
      if (t.status === 'dispatched' || t.status === 'running' || t.status === 'executing') {
        // 启动时 PTY 已不存在，所有运行中任务重置为 idle，由前端恢复后重新派发
        t.status = 'idle';
        t.done = false;
        changed = true;
      }
    });
  });

  if (changed || restored.length > 0) {
    await saveConfig(config);
  }
})();

function persistRuntimeState() {
  try {
    const state = buildRuntimeState({
      config,
      ptyRegistry,
      pendingTaskQueues,
      claudeReadyStates,
      paneLoopStates,
      loopProjectIndex,
    });
    saveRuntimeState(state, CONFIG_PATH);
  } catch (e) {
    console.error('保存运行时状态失败:', e.message);
  }
}

// 每 5 秒保存一次运行时状态
const runtimeStateSaveTimer = setInterval(persistRuntimeState, 5000);

function buildEnv() {
  const base = { ...process.env };
  const ai = config.ai || { provider: 'kimi' };

  if (ai.provider === 'kimi' && ai.apiKey) {
    base.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic';
    base.ANTHROPIC_AUTH_TOKEN = ai.apiKey;
    base.ANTHROPIC_MODEL = 'kimi-k2.7-code';
    base.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-k2.7-code';
    base.ANTHROPIC_DEFAULT_SONNET_MODEL = 'kimi-k2.7-code';
    base.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'kimi-k2.7-code';
    base.CLAUDE_CODE_SUBAGENT_MODEL = 'kimi-k2.7-code';
    base.ANTHROPIC_SMALL_FAST_MODEL = 'kimi-k2.7-code';
  } else if (ai.provider === 'claude' && ai.apiKey) {
    base.ANTHROPIC_API_KEY = ai.apiKey;
    delete base.ANTHROPIC_BASE_URL;
    delete base.ANTHROPIC_AUTH_TOKEN;
  }

  // 抑制 Claude Code CLI 启动时的非必要警告和提示，避免污染每个终端窗口
  // 注意：不设置 CLAUDE_CODE_SIMPLE，因为 Vibe Space 需要 ~/.claude/hooks/vibe-space-bridge.js 正常工作
  base.DISABLE_COST_WARNINGS = '1';
  base.DISABLE_INSTALLATION_CHECKS = '1';
  base.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

  return base;
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// ========== Kimi Code 配额查询 ==========
const QUOTA_API_URL = 'https://api.kimi.com/coding/v1/usages';
const QUOTA_CACHE_TTL_MS = 10_000; // 10 秒缓存，避免高频请求
let quotaCache = { data: null, fetchedAt: 0, error: null };

/** 判断当前是否配置了 Kimi API Key */
function hasKimiApiKey() {
  const ai = config.ai || {};
  if (!ai.apiKey) return false;
  // Kimi Code API Key 通常以 sk-kimi- 开头，也兼容显式 provider=kimi 的配置
  return ai.provider === 'kimi' || ai.apiKey.startsWith('sk-kimi-');
}

/** 标准化配额数据，确保前端始终拿到一致的字段 */
function normalizeQuota(raw) {
  const usage = raw?.usage || {};
  const limits = Array.isArray(raw?.limits) ? raw.limits : [];
  const parallel = raw?.parallel || {};
  const totalQuota = raw?.totalQuota || {};

  // 解析 resetTime 为绝对时间戳（毫秒）
  let resetAt = null;
  if (usage.resetTime) {
    const t = new Date(usage.resetTime).getTime();
    if (!Number.isNaN(t)) resetAt = t;
  }
  // 如果接口没有 resetTime，尝试用 limits 里的第一个窗口 resetTime 兜底
  if (!resetAt && limits.length > 0 && limits[0].detail?.resetTime) {
    const t = new Date(limits[0].detail.resetTime).getTime();
    if (!Number.isNaN(t)) resetAt = t;
  }

  // 计算剩余秒数
  let resetInSeconds = null;
  if (resetAt) {
    resetInSeconds = Math.max(0, Math.floor((resetAt - Date.now()) / 1000));
  }

  // 计算总配额百分比（以 usage 为主，因为它包含 resetTime，对应用户看到的“总配额”）
  const totalLimit = parseNumeric(usage.limit ?? totalQuota.limit);
  const totalRemaining = parseNumeric(usage.remaining ?? totalQuota.remaining);
  const totalUsed = parseNumeric(usage.used ?? totalQuota.used);
  let totalPercent = null;
  if (totalLimit > 0) {
    const used = Number.isFinite(totalUsed) ? totalUsed : (totalLimit - totalRemaining);
    totalPercent = Math.round((used / totalLimit) * 100);
  }

  // 窗口配额百分比（取第一个窗口）
  const firstWindow = limits[0]?.detail || {};
  const windowLimit = parseNumeric(firstWindow.limit);
  const windowUsed = parseNumeric(firstWindow.used);
  const windowRemaining = parseNumeric(firstWindow.remaining);
  let windowPercent = null;
  if (windowLimit > 0) {
    const used = Number.isFinite(windowUsed) ? windowUsed : (windowLimit - windowRemaining);
    windowPercent = Math.round((used / windowLimit) * 100);
  }

  return {
    ok: true,
    provider: 'kimi',
    totalQuota: {
      limit: totalLimit,
      used: Number.isFinite(totalUsed) ? totalUsed : null,
      remaining: Number.isFinite(totalRemaining) ? totalRemaining : null,
      percent: totalPercent,
    },
    window: {
      limit: windowLimit,
      used: Number.isFinite(windowUsed) ? windowUsed : null,
      remaining: Number.isFinite(windowRemaining) ? windowRemaining : null,
      percent: windowPercent,
      duration: limits[0]?.window?.duration || null,
      timeUnit: limits[0]?.window?.timeUnit || null,
    },
    parallel: {
      limit: parseNumeric(parallel.limit) ?? 20,
      used: parseNumeric(parallel.used) ?? 0,
      remaining: parseNumeric(parallel.remaining) ?? null,
    },
    resetAt,
    resetInSeconds,
    raw,
  };
}

function parseNumeric(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 降级到 config.quota 或生成一个带错误信息的占位数据 */
function fallbackQuota(errorMessage) {
  const fallback = config.quota || {};
  const resetAt = fallback.resetAt ? new Date(fallback.resetAt).getTime() : null;
  const resetInSeconds = resetAt ? Math.max(0, Math.floor((resetAt - Date.now()) / 1000)) : null;
  return {
    ok: false,
    provider: 'kimi',
    error: errorMessage,
    totalQuota: {
      limit: parseNumeric(fallback.totalLimit) ?? null,
      used: parseNumeric(fallback.totalUsed) ?? null,
      remaining: parseNumeric(fallback.totalRemaining) ?? null,
      percent: parseNumeric(fallback.totalPercent) ?? null,
    },
    window: {
      limit: parseNumeric(fallback.windowLimit) ?? null,
      used: parseNumeric(fallback.windowUsed) ?? null,
      remaining: parseNumeric(fallback.windowRemaining) ?? null,
      percent: parseNumeric(fallback.windowPercent) ?? null,
      duration: fallback.windowDuration ?? null,
      timeUnit: fallback.windowTimeUnit ?? null,
    },
    parallel: {
      limit: parseNumeric(fallback.parallelLimit) ?? 20,
      used: parseNumeric(fallback.parallelUsed) ?? 0,
      remaining: parseNumeric(fallback.parallelRemaining) ?? null,
    },
    resetAt,
    resetInSeconds,
    raw: fallback,
  };
}

async function fetchKimiQuota() {
  if (!hasKimiApiKey()) {
    throw new Error('未配置 Kimi API Key');
  }
  const apiKey = config.ai.apiKey;
  const res = await fetch(QUOTA_API_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'User-Agent': 'vibe-space-quota/1.0',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kimi quota API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return normalizeQuota(data);
}


// 禁止浏览器缓存 HTML，确保开发时总是最新内容
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '/workspace') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// 根路由指向配置页（setup.html），必须在 static 之前注册
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// 工作区路由
app.get('/workspace', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'vibe-space' });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'lib')));
app.use('/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-fit', 'lib')));
app.use('/xterm-css', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'css')));

app.get('/api/config', (req, res) => {
  res.json(config);
});

// 查询 Kimi Code 账号配额
app.get('/api/quota', async (req, res) => {
  try {
    const now = Date.now();
    if (quotaCache.data && now - quotaCache.fetchedAt < QUOTA_CACHE_TTL_MS) {
      return res.json(quotaCache.data);
    }
    const data = await fetchKimiQuota();
    quotaCache = { data, fetchedAt: now, error: null };
    res.json(data);
  } catch (e) {
    console.error('获取 Kimi 配额失败:', e.message);
    const data = fallbackQuota(e.message);
    quotaCache = { data, fetchedAt: Date.now(), error: e.message };
    res.json(data);
  }
});

app.post('/api/select-folder', (req, res) => {
  const tmpPs1 = path.join(__dirname, 'temp_select_folder.ps1');
  const ps1Code = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.WindowState = 'Minimized'
$form.Add_Shown({ $form.Hide() })
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select project folder"
$dialog.RootFolder = "MyComputer"
[void]$dialog.ShowDialog($form)
$form.Close()
if ($dialog.SelectedPath) { $dialog.SelectedPath } else { "__CANCELLED__" }`;
  // Write UTF-8 BOM so PowerShell handles non-ASCII paths correctly
  fs.writeFileSync(tmpPs1, '\ufeff' + ps1Code, 'utf8');

  // Switch console to UTF-8 to avoid garbled non-ASCII paths
  exec(`chcp 65001 >nul && powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`, { encoding: 'utf8', timeout: 0 }, (err, stdout) => {
    try { fs.unlinkSync(tmpPs1); } catch (_) {}
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const result = (stdout || '').trim();
    if (result && result !== '__CANCELLED__') {
      res.json({ path: result });
    } else {
      res.json({ path: null, cancelled: true });
    }
  });
});

/**
 * 保存任务附件到项目目录
 * 图片/二进制文件保存为本地文件，返回文件路径给 Claude Code 读取
 * 文本附件直接返回原数据，由前端 inline
 */
app.post('/api/save-attachments', (req, res) => {
  try {
    const { paneId, projectIndex, taskIndex, attachments } = req.body;
    const targetPaneId = paneId !== undefined ? paneId : projectIndex;
    const pane = getPaneById(config, targetPaneId);
    if (!pane) return res.status(400).json({ error: 'Pane not found' });
    const proj = getProjectByPaneId(config, targetPaneId);
    if (!proj) return res.status(400).json({ error: 'Project not found' });

    const baseDir = path.join(proj.cwd, '.vibe-space', 'attachments', `${targetPaneId}-${taskIndex}`);
    fs.mkdirSync(baseDir, { recursive: true });

    const saved = (attachments || []).map((att, idx) => {
      // 文本/虚拟文本附件不保存，直接返回原数据
      if (att.kind === 'text' || att.isVirtualText) {
        return { ...att, path: null, saved: false };
      }

      // 图片/二进制附件保存为文件
      const raw = att.data || att.content || '';
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
      if (!base64) return { ...att, path: null, saved: false };

      const ext = path.extname(att.name) || (att.kind === 'image' ? '.png' : '.bin');
      const baseName = path.basename(att.name || `attachment_${idx}`, ext);
      const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${Date.now()}_${safeName}${ext}`;
      const filePath = path.join(baseDir, fileName);

      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

      // 返回时剔除 base64 data，避免再次存入 config.json
      const { data, content, ...meta } = att;
      return { ...meta, path: filePath, saved: true };
    });

    res.json({ saved });
  } catch (e) {
    console.error('保存附件失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Claude Code Hook 事件接收端点
 * Hook 脚本（~/.claude/hooks/vibe-space-bridge.js）会将事件 POST 到这里
 */
app.post('/api/claude-event', express.json(), (req, res) => {
  try {
    const event = req.body;
    if (!event || !event.hook) {
      return res.status(400).json({ error: 'Missing hook field' });
    }

    const eventCwd = event._env?.cwd || event.cwd || '';
    const eventSessionId = event._env?.sessionId || event.sessionId || '';
    let matchedAny = false;

    for (const [paneId, entry] of ptyRegistry) {
      const proj = getProjectByPaneId(config, paneId);
      if (!proj) continue;

      let matched = false;

      // 尝试按 cwd 匹配
      if (eventCwd && proj.cwd && eventCwd.toLowerCase() === proj.cwd.toLowerCase()) {
        matched = true;
      }

      // 尝试按 session 文件中的 sessionId 匹配
      if (!matched && eventSessionId) {
        const status = readClaudeSessionStatus(entry.proc.pid);
        if (status && status.sessionId === eventSessionId) {
          matched = true;
        }
      }

      if (matched) {
        broadcastClaudeHook(paneId, event);
        console.log(`Hook [${event.hook}] -> pane ${paneId}`);
        matchedAny = true;
      }
    }

    if (!matchedAny) {
      // 未匹配到具体 pane，广播给所有客户端（由前端自行过滤）
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: 'claude-hook', event }));
        }
      });
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Hook 事件处理失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/task-templates', (req, res) => {
  res.json(config.taskTemplates || []);
});

app.post('/api/import-tasks', async (req, res) => {
  try {
    const { paneId, projectIndex, tasks } = req.body;
    const targetPaneId = paneId !== undefined ? paneId : projectIndex;
    const pane = getPaneById(config, targetPaneId);
    if (!pane) return res.status(400).json({ error: 'Pane not found' });
    if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks must be an array' });

    const now = Date.now();
    const newTasks = tasks.map((t) => {
      const text = typeof t === 'string' ? t : (t.text || t.command || '');
      return {
        text,
        status: 'idle',
        done: false,
        createdAt: now,
        attachments: t.attachments || [],
      };
    }).filter((t) => t.text && t.text.trim());

    pane.tasks = pane.tasks || [];
    pane.tasks.push(...newTasks);
    await saveConfig(config);
    res.json({ added: newTasks.length });
  } catch (e) {
    console.error('Import tasks failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function sanitizeClaudeProjectDir(cwd) {
  // Claude Code stores project logs under ~/.claude/projects/{sanitized-cwd}
  // where drive colons and path separators become dashes.
  return cwd.replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseProjectJsonlUsage(cwd, startTime, endTime) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', sanitizeClaudeProjectDir(cwd));
  if (!fs.existsSync(projectDir)) return null;

  const total = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    model: '',
  };

  try {
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(projectDir, file), 'utf8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'assistant') continue;
          const usage = entry.usage || (entry.message && entry.message.usage);
          if (!usage) continue;
          const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
          if (!ts || ts < startTime || ts > endTime) continue;
          total.inputTokens += usage.input_tokens || 0;
          total.outputTokens += usage.output_tokens || 0;
          total.cacheReadTokens += usage.cache_read_input_tokens || 0;
          total.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
          const model = entry.model || (entry.message && entry.message.model);
          if (model && !total.model) total.model = model;
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('Parse project usage failed:', e.message);
    return null;
  }

  return total;
}

const MODEL_PRICING = {
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-haiku': { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
  'default': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
};

function getModelPricing(model = '') {
  const lower = model.toLowerCase();
  const key = Object.keys(MODEL_PRICING).find(k => k !== 'default' && lower.includes(k.toLowerCase()));
  return MODEL_PRICING[key] || MODEL_PRICING.default;
}

function estimateCost(usage, model) {
  const p = getModelPricing(model);
  const cost = ((usage.inputTokens || 0) * p.input +
                (usage.outputTokens || 0) * p.output +
                (usage.cacheReadTokens || 0) * p.cacheRead +
                (usage.cacheCreationTokens || 0) * p.cacheWrite) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}

app.get('/api/project-cost', (req, res) => {
  const paneId = parseInt(req.query.paneId, 10);
  const projectId = parseInt(req.query.projectId, 10);
  const start = parseInt(req.query.start, 10) || 0;
  const end = parseInt(req.query.end, 10) || Date.now();

  let proj = null;
  if (!Number.isNaN(paneId)) {
    proj = getProjectByPaneId(config, paneId);
  } else if (!Number.isNaN(projectId)) {
    proj = getProjectById(config, projectId);
  }

  if (!proj) {
    return res.status(400).json({ error: 'Project not found' });
  }
  const usage = parseProjectJsonlUsage(proj.cwd, start, end);
  const cost = estimateCost(usage || {}, usage?.model);
  res.json({
    ...(usage || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: '' }),
    costUSD: cost,
  });
});

app.post('/api/task-cost', (req, res) => {
  const paneId = parseInt(req.body.paneId, 10);
  const projectIndex = parseInt(req.body.projectIndex, 10);
  const taskIndex = parseInt(req.body.taskIndex, 10);
  const targetPaneId = !Number.isNaN(paneId) ? paneId : projectIndex;
  if (Number.isNaN(targetPaneId) || Number.isNaN(taskIndex)) {
    return res.status(400).json({ error: 'Invalid pane or task index' });
  }
  const pane = getPaneById(config, targetPaneId);
  if (!pane) return res.status(400).json({ error: 'Pane not found' });
  const proj = getProjectByPaneId(config, targetPaneId);
  if (!proj) return res.status(400).json({ error: 'Project not found' });
  const task = (pane.tasks || [])[taskIndex];
  if (!task) return res.status(400).json({ error: 'Task not found' });

  const startTime = task.dispatchedAt || task.createdAt || 0;
  const endTime = task.doneAt || task.completedAt || Date.now();
  const usage = parseProjectJsonlUsage(proj.cwd, startTime, endTime);
  const cost = estimateCost(usage || {}, usage?.model);
  res.json({
    paneId: targetPaneId,
    taskIndex,
    ...(usage || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: '' }),
    costUSD: cost,
  });
});

// 任务输出历史持久化
app.post('/api/save-task-log', express.json({ limit: '50mb' }), (req, res) => {
  const paneId = parseInt(req.body.paneId, 10);
  const projectIndex = parseInt(req.body.projectIndex, 10);
  const taskIndex = parseInt(req.body.taskIndex, 10);
  const content = req.body.content || '';
  const targetPaneId = !Number.isNaN(paneId) ? paneId : projectIndex;
  const proj = !Number.isNaN(targetPaneId) ? getProjectByPaneId(config, targetPaneId) : null;
  if (!proj || Number.isNaN(targetPaneId) || Number.isNaN(taskIndex)) {
    return res.status(400).json({ error: 'Project or task not found' });
  }
  try {
    const logsDir = path.join(proj.cwd || process.cwd(), '.vibe-space', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `task-${targetPaneId}-${taskIndex}-${stamp}.log`;
    const filePath = path.join(logsDir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ path: filePath, fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/task-logs', (req, res) => {
  const paneId = parseInt(req.query.paneId, 10);
  const projectIndex = parseInt(req.query.projectIndex, 10);
  const taskIndex = req.query.taskIndex !== undefined ? parseInt(req.query.taskIndex, 10) : undefined;
  const targetPaneId = !Number.isNaN(paneId) ? paneId : projectIndex;
  const proj = !Number.isNaN(targetPaneId) ? getProjectByPaneId(config, targetPaneId) : null;
  if (!proj || Number.isNaN(targetPaneId)) {
    return res.status(400).json({ error: 'Project not found' });
  }
  const logsDir = path.join(proj.cwd || process.cwd(), '.vibe-space', 'logs');
  if (!fs.existsSync(logsDir)) return res.json([]);
  try {
    const prefix = Number.isNaN(taskIndex) ? `task-${targetPaneId}-` : `task-${targetPaneId}-${taskIndex}-`;
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
      .map(f => {
        const stat = fs.statSync(path.join(logsDir, f));
        return { fileName: f, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/task-log-content', (req, res) => {
  const paneId = parseInt(req.query.paneId, 10);
  const projectIndex = parseInt(req.query.projectIndex, 10);
  const fileName = req.query.fileName;
  const targetPaneId = !Number.isNaN(paneId) ? paneId : projectIndex;
  const proj = !Number.isNaN(targetPaneId) ? getProjectByPaneId(config, targetPaneId) : null;
  if (!proj || Number.isNaN(targetPaneId) || !fileName || /[\/\\]/.test(fileName)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  const logsDir = path.join(proj.cwd || process.cwd(), '.vibe-space', 'logs');
  const filePath = path.join(logsDir, fileName);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save-config', async (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig.projects || !Array.isArray(newConfig.projects)) {
      return res.status(400).send('projects 必须是数组');
    }
    if (!newConfig.layout || typeof newConfig.layout.rows !== 'number') {
      return res.status(400).send('layout 是必须的');
    }
    const oldPanes = config.panes || [];
    const oldProjects = config.projects || [];
    config = newConfig;
    await saveConfig(config);
    const newPanes = config.panes || [];

    const oldPaneMap = new Map((oldPanes).map(p => [p.id, p]));
    const newPaneMap = new Map((newPanes).map(p => [p.id, p]));
    const oldProjectMap = new Map((oldProjects).map(p => [p.id, p]));

    // 1. 关闭已删除的 pane
    for (const oldPane of oldPanes) {
      if (!newPaneMap.has(oldPane.id)) {
        const entry = ptyRegistry.get(oldPane.id);
        if (entry) {
          try { entry.proc.kill(); } catch (_) {}
          ptyRegistry.delete(oldPane.id);
        }
        const timers = globalTaskTimers.get(oldPane.id);
        if (timers) {
          timers.forEach(t => clearInterval(t));
          globalTaskTimers.delete(oldPane.id);
        }
        stopSessionPoller(oldPane.id);
      }
    }

    // 2. 项目配置变化时重启对应 pane
    for (const newPane of newPanes) {
      const oldPane = oldPaneMap.get(newPane.id);
      const oldProj = oldPane ? oldProjectMap.get(oldPane.projectId) : null;
      const newProj = getProjectByPaneId(config, newPane.projectId);
      const changed = !oldPane ||
        (oldProj && newProj && oldProj.cwd !== newProj.cwd) ||
        (oldProj && newProj && oldProj.name !== newProj.name) ||
        (oldProj && newProj && oldProj.color !== newProj.color);

      if (changed) {
        const entry = ptyRegistry.get(newPane.id);
        if (entry) {
          try { entry.proc.kill(); } catch (_) {}
          ptyRegistry.delete(newPane.id);
        }
        const timers = globalTaskTimers.get(newPane.id);
        if (timers) {
          timers.forEach(t => clearInterval(t));
          globalTaskTimers.delete(newPane.id);
        }
      }
    }

    // 为所有 pane 创建/复用 PTY，并通知所有已连接的客户端
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        for (const pane of newPanes) {
          getOrCreatePTY(pane.id, client);
          startTasksForPane(pane.id);
        }
      }
    });

    // 广播配置变更给所有 WebSocket 客户端
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'config-changed' }));
      }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ========== 全局 PTY 与会话管理 ==========
const PTY_MAX_BUFFER = 100 * 1024; // 100KB 输出缓冲（约 2000 行，恢复更快）
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const SESSION_POLL_INTERVAL_MS = 1000; // Session 状态轮询间隔

class OutputBuffer {
  constructor(maxBytes = PTY_MAX_BUFFER) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.totalBytes = 0;
  }
  write(data) {
    this.chunks.push(data);
    this.totalBytes += Buffer.byteLength(data, 'utf8');
    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      const removed = this.chunks.shift();
      this.totalBytes -= Buffer.byteLength(removed, 'utf8');
    }
  }
  snapshot() {
    return this.chunks.join('');
  }
}

// 全局 PTY 注册表：paneId -> { proc, clients: Set<ws>, buffer: OutputBuffer }
const ptyRegistry = new Map();
// 全局任务定时器：paneId -> timer[]
const globalTaskTimers = new Map();
// Claude Code 就绪状态：paneId -> boolean
const claudeReadyStates = new Map();
// 待发送任务队列：paneId -> [{ command, label, client }]
const pendingTaskQueues = new Map();
// Claude Code Session 状态轮询器：paneId -> intervalTimer
const sessionPollers = new Map();
// 各 pane 的任务循环状态：paneId -> boolean（由前端上报）
const paneLoopStates = new Map();
// 当前循环的项目索引（由前端上报）
let loopProjectIndex = null;

/** 读取 Claude Code Session 文件，返回 { status, since, sessionId } 或 null */
function readClaudeSessionStatus(pid) {
  try {
    const file = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    return {
      status: data.status,           // "idle" | "busy"
      sessionId: data.sessionId,
      since: Date.now() - (data.statusUpdatedAt || data.updatedAt || Date.now()),
    };
  } catch (e) {
    return null;
  }
}

/** 广播 Claude Code 状态给某个 PTY 的所有客户端 */
function broadcastClaudeStatus(paneId, statusInfo) {
  const entry = ptyRegistry.get(paneId);
  if (!entry) return;
  const id = `pty-${paneId}`;
  const msg = JSON.stringify({
    type: 'claude-status',
    id,
    paneId,
    ...statusInfo,
  });
  entry.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

/** 广播 Hook 事件给某个 PTY 的所有客户端（按 cwd 匹配） */
function broadcastClaudeHook(paneId, event) {
  const entry = ptyRegistry.get(paneId);
  if (!entry) return;
  const id = `pty-${paneId}`;
  const msg = JSON.stringify({
    type: 'claude-hook',
    id,
    paneId,
    event,
  });
  entry.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

/** 启动 Session 状态轮询 */
function startSessionPoller(entry, paneId, id, pid) {
  if (sessionPollers.has(paneId)) return;

  const timer = setInterval(() => {
    const status = readClaudeSessionStatus(pid);
    if (!status) return;

    broadcastClaudeStatus(paneId, status);

    // 如果 session 文件出现且状态为 idle，也视为就绪（备用检测）
    if (!claudeReadyStates.get(paneId) && status.status === 'idle' && status.sessionId) {
      setTimeout(() => {
        if (claudeReadyStates.get(paneId)) return;
        claudeReadyStates.set(paneId, true);
        console.log(`PTY ${id} Claude Code 已就绪（Session 文件确认）`);
        broadcastClaudeStatus(paneId, { status: 'idle', since: 0, ready: true });
        flushPendingTasks(paneId);
      }, 500);
    }
  }, SESSION_POLL_INTERVAL_MS);

  sessionPollers.set(paneId, timer);
}

/** 停止 Session 状态轮询 */
function stopSessionPoller(paneId) {
  const timer = sessionPollers.get(paneId);
  if (timer) {
    clearInterval(timer);
    sessionPollers.delete(paneId);
  }
}

// 去除 ANSI 转义码，用于检测 Claude Code 输出特征
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function buildWelcomeMessage(proj, ai) {
  const aiName = ai.provider === 'kimi' ? 'Kimi K2.7 (Moonshot)' : 'Claude (官方)';
  return [
    '\r\n',
    '  ==========================================\r\n',
    `   Vibe Space - ${proj.name}\r\n`,
    '  ==========================================\r\n',
    `   目录: ${proj.cwd}\r\n`,
    `   AI: ${aiName}\r\n`,
    '  ------------------------------------------\r\n',
    '   可用命令:\r\n',
    '     dir        - 列出文件\r\n',
    '     claude     - 启动 Claude Code\r\n',
    '  ==========================================\r\n',
    '\r\n',
  ].join('');
}

function getOrCreatePTY(paneId, ws) {
  let entry = ptyRegistry.get(paneId);
  if (entry) {
    entry.clients.add(ws);
    // 发送历史缓冲，让新客户端追上终端当前状态
    const history = entry.buffer.snapshot();
    if (history && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', id: `pty-${paneId}`, data: history }));
    }
    // 发送 ready，让前端创建/复用 pane
    const proj = getProjectByPaneId(config, paneId);
    const ai = config.ai || { provider: 'kimi' };
    const welcome = proj ? buildWelcomeMessage(proj, ai) : '';
    setTimeout(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'ready',
          id: `pty-${paneId}`,
          paneId,
          name: proj ? proj.name : '',
          color: proj ? proj.color : '',
          cwd: proj ? proj.cwd : '',
          ai: ai.provider,
          welcome,
        }));
        // 如果已检测到 Claude Code 就绪，通知新连接的客户端
        if (claudeReadyStates.get(paneId)) {
          ws.send(JSON.stringify({ type: 'claude-ready', id: `pty-${paneId}`, paneId }));
        }
      }
    }, 100);
    return entry;
  }

  const proj = getProjectByPaneId(config, paneId);
  if (!proj) return null;
  const id = `pty-${paneId}`;

  // 初始化 Claude Code 就绪状态和任务队列
  claudeReadyStates.set(paneId, false);
  pendingTaskQueues.set(paneId, []);

  const proc = pty.spawn('cmd.exe', ['/k'], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: proj.cwd,
    env: buildEnv(),
    useConpty: false,
  });

  const buffer = new OutputBuffer();

  // 如果是从崩溃/重启中恢复，还原之前的输出缓冲和待派发队列
  const restored = restoredRuntimeState.get(paneId);
  let restoredBuffer = '';
  if (restored) {
    if (restored.outputBuffer) {
      buffer.write(restored.outputBuffer);
      restoredBuffer = restored.outputBuffer;
    }
    if (restored.pendingTasks && restored.pendingTasks.length > 0) {
      pendingTaskQueues.set(paneId, restored.pendingTasks.map(t => ({ ...t, client: ws })));
    }
    restoredRuntimeState.delete(paneId);
  }

  proc.onData((data) => {
    buffer.write(data);
    entry.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'output', id, data }));
      }
    });

    // 检测 Claude Code 是否已就绪
    if (!claudeReadyStates.get(paneId)) {
      const text = stripAnsi(data);

      // 启动失败检测
      const isFailed =
        /'claude'\s+不是内部或外部命令/i.test(text) ||
        /'claude'\s+is\s+not\s+recognized/i.test(text) ||
        /command\s+not\s+found/i.test(text) ||
        /无法将\s+"claude"\s+项识别为/i.test(text);

      if (isFailed) {
        console.error(`PTY ${id} Claude Code 启动失败：命令未找到`);
        entry.clients.forEach(client => {
          if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({
              type: 'claude-error',
              id,
              paneId,
              error: 'claude command not found. Please install Claude Code CLI or set correct startupCommand.'
            }));
          }
        });
        return;
      }

      // 自动跳过 Claude Code 启动时的配置警告确认菜单
      if (/Enter to confirm\s*[·\-]\s*Esc to cancel/i.test(text) || /❯\s*1\.\s*Continue/i.test(text)) {
        setTimeout(() => {
          try {
            proc.write('\r\n');
            console.log(`PTY ${id} 自动跳过启动确认菜单`);
          } catch (e) {}
        }, 600);
      }

      // 真实的 Claude Code 就绪特征（放宽检测，但必须排除上面的失败情况）
      const isReady =
        /Claude\s*Code/i.test(text) ||
        /What would you like me to do/i.test(text) ||
        /How can I help/i.test(text) ||
        /I\'m ready/i.test(text) ||
        /Waiting for your input/i.test(text) ||
        /(^|[\r\n])\s*>\s*$/.test(text);

      if (isReady) {
        // 看到 Claude Code 界面后，再给它 1.5 秒完成初始化，避免过早发送任务
        setTimeout(() => {
          if (claudeReadyStates.get(paneId)) return; // 已被其他逻辑标记
          claudeReadyStates.set(paneId, true);
          console.log(`PTY ${id} Claude Code 已就绪（延迟确认）`);
          entry.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
              client.send(JSON.stringify({ type: 'claude-ready', id, paneId }));
            }
          });
          flushPendingTasks(paneId);
        }, 1500);
      }
    }
  });

  proc.onExit(() => {
    console.log(`PTY ${id} 已退出`);
    persistRuntimeState();
    stopSessionPoller(paneId);
    ptyRegistry.delete(paneId);
    claudeReadyStates.delete(paneId);
    pendingTaskQueues.delete(paneId);
    paneLoopStates.delete(paneId);
    const timers = globalTaskTimers.get(paneId);
    if (timers) {
      timers.forEach(t => clearInterval(t));
      globalTaskTimers.delete(paneId);
    }
  });

  entry = { proc, clients: new Set([ws]), buffer };
  ptyRegistry.set(paneId, entry);

  const ai = config.ai || { provider: 'kimi' };
  let welcome = buildWelcomeMessage(proj, ai);
  if (restoredBuffer) {
    welcome = '\r\n\x1b[33m[Server restarted — resuming session]\x1b[0m\r\n' + welcome;
  }
  setTimeout(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'ready',
        id,
        paneId,
        name: proj.name,
        color: proj.color,
        cwd: proj.cwd,
        ai: ai.provider,
        welcome,
      }));
    }
  }, 100);

  // 启动 Session 文件轮询（Claude Code 状态监控）
  if (proc.pid) {
    startSessionPoller(entry, paneId, id, proc.pid);
  }

  // 自动启动命令（延迟等待 cmd 初始化完成）
  setTimeout(() => {
    try {
      const cmd = (config.startupCommand || 'claude').trim();
      if (cmd) {
        proc.write(cmd + '\r\n');
        console.log(`PTY ${id} 启动命令已发送: ${cmd}`);
      }
    } catch (e) {
      console.error('自动启动命令失败:', e.message);
    }
  }, 1500);

  return entry;
}

/** 刷新指定 PTY 的待发送任务队列 */
function flushPendingTasks(paneId) {
  const queue = pendingTaskQueues.get(paneId);
  if (!queue || queue.length === 0) return;
  const entry = ptyRegistry.get(paneId);
  if (!entry) return;

  while (queue.length > 0) {
    const { command, label } = queue.shift();
    try {
      if (command) {
        // 分开发送：先发送文字，再单独发送回车，确保 Enter 被触发
        entry.proc.write(command);
        setTimeout(() => entry.proc.write('\r\n'), 200);
        console.log(`PTY pty-${paneId} 执行队列任务: ${label || 'task'}`);
      }
    } catch (e) {
      console.error('队列任务发送失败:', e.message);
    }
  }
}

function startTasksForPane(paneId) {
  if (globalTaskTimers.has(paneId)) return;
  const pane = getPaneById(config, paneId);
  if (!pane || !pane.tasks || pane.tasks.length === 0) return;
  const proj = getProjectByPaneId(config, paneId);
  if (!proj) return;
  const id = `pty-${paneId}`;

  const timers = [];
  pane.tasks.forEach((task) => {
    if (!task.enabled) return;
    const intervalMs = (task.interval || 60) * 1000;

    if (task.type === 'fetch') {
      const timer = setInterval(async () => {
        const entry = ptyRegistry.get(paneId);
        if (!entry || entry.clients.size === 0) return;
        try {
          const controller = new AbortController();
          const fetchTimeout = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(task.target, { signal: controller.signal });
          clearTimeout(fetchTimeout);
          const text = await res.text();
          const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : '无标题';
          const output = `\r\n\x1b[36m[任务·抓取]\x1b[0m ${task.target}\r\n状态: ${res.status} ${res.statusText}\r\n标题: ${title}\r\n大小: ${text.length} 字节\r\n`;
          entry.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
              client.send(JSON.stringify({ type: 'output', id, data: output }));
            }
          });
        } catch (e) {
          const output = `\r\n\x1b[36m[任务·抓取]\x1b[0m ${task.target}\r\n\x1b[31m失败: ${e.message}\x1b[0m\r\n`;
          entry.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
              client.send(JSON.stringify({ type: 'output', id, data: output }));
            }
          });
        }
      }, intervalMs);
      timers.push(timer);
    } else if (task.type === 'command') {
      const timer = setInterval(() => {
        const entry = ptyRegistry.get(paneId);
        if (!entry || entry.clients.size === 0) return;
        const proc = entry.proc;
        if (proc) {
          try {
            proc.write(`\r\n\x1b[36m[任务·执行]\x1b[0m ${task.target}\r\n${task.target}\r\n`);
          } catch (e) {
            console.error('任务写入 PTY 失败:', e.message);
          }
        }
      }, intervalMs);
      timers.push(timer);
    }
  });

  globalTaskTimers.set(paneId, timers);
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // 全局恢复请求：客户端重连后询问是否需要恢复任务循环
      if (msg.type === 'resume-state') {
        if (config.panes) {
          config.panes.forEach((pane) => {
            const paneId = pane.id;
            const loopRunning = paneLoopStates.get(paneId);
            if (!loopRunning) return;
            const tasks = pane.tasks || [];
            const idx = tasks.findIndex(t => t.status === 'dispatched');
            const data = JSON.stringify({
              type: 'resume-loop',
              paneId,
              projectId: pane.projectId,
              lastDispatchedTaskIndex: idx >= 0 ? idx : null,
              loopRunning: true,
            });
            if (ws.readyState === ws.OPEN) ws.send(data);
          });
        }
        return;
      }

      // 前端上报任务循环状态变化
      if (msg.type === 'loop-state') {
        const paneId = msg.paneId !== undefined ? msg.paneId : msg.projectIndex;
        if (Number.isNaN(paneId)) return;
        if (msg.running) {
          paneLoopStates.set(paneId, true);
          loopProjectIndex = paneId;
        } else {
          paneLoopStates.delete(paneId);
          if (loopProjectIndex === paneId) loopProjectIndex = null;
        }
        persistRuntimeState();
        return;
      }

      const paneId = msg.paneId !== undefined ? msg.paneId : parseInt((msg.id || '').replace('pty-', ''), 10);
      if (Number.isNaN(paneId)) return;
      const entry = ptyRegistry.get(paneId);
      if (!entry) return;
      const proc = entry.proc;

      if (msg.type === 'input') {
        proc.write(msg.data);
      } else if (msg.type === 'resize') {
        proc.resize(msg.cols, msg.rows);
      } else if (msg.type === 'exec-task') {
        try {
          const cmd = (msg.command || '').trim();
          if (!cmd) {
            const warn = `\r\n\x1b[33m[警告] 任务内容为空，无法执行\x1b[0m\r\n`;
            entry.clients.forEach(client => {
              if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({ type: 'output', id: msg.id, data: warn }));
              }
            });
            return;
          }

          if (claudeReadyStates.get(paneId)) {
            // Claude Code 已就绪，分两步发送：先文字，再单独回车
            proc.write(cmd);
            setTimeout(() => proc.write('\r\n'), 200);
            console.log(`PTY ${msg.id} 执行任务: ${msg.label || 'task'}`);
          } else {
            // Claude Code 未就绪，任务入队等待
            const queue = pendingTaskQueues.get(paneId) || [];
            queue.push({ command: cmd, label: msg.label, client: ws });
            pendingTaskQueues.set(paneId, queue);
            const waitMsg = `\r\n\x1b[36m[VibeSpace]\x1b[0m Claude Code 尚未就绪，任务已加入队列等待执行...\r\n`;
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'output', id: msg.id, data: waitMsg }));
            }
            console.log(`PTY ${msg.id} 任务入队等待 Claude Code 就绪`);
          }
        } catch (e) {
          console.error('任务执行失败:', e.message);
        }
      }
    } catch (e) {
      console.error('WS 解析错误:', e.message);
    }
  });

  ws.on('close', () => {
    for (const [, entry] of ptyRegistry) {
      entry.clients.delete(ws);
    }
  });

  // 逐个延迟创建/复用 PTY，避免 Windows winpty 并发冲突
  if (config.panes) {
    for (let i = 0; i < config.panes.length; i++) {
      const paneId = config.panes[i].id;
      setTimeout(() => {
        getOrCreatePTY(paneId, ws);
        startTasksForPane(paneId);
      }, i * 300);
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用，Vibe Space 可能已在运行。`);
    console.error(`请访问 http://localhost:${PORT} 或在任务管理器中结束旧进程后再启动。\n`);
  } else {
    console.error('服务器启动失败:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  writePidFile();
  console.log(`Vibe Space running at http://localhost:${PORT}`);
  const ai = config.ai || { provider: 'kimi' };
  console.log(`AI: ${ai.provider}, Projects: ${config.projects.length}, Panes: ${config.panes ? config.panes.length : 0}, Layout: ${config.layout.rows}x${config.layout.cols}`);
});

// 优雅关闭：保存运行时状态、清理 PTY 子进程、WebSocket 连接并移除 PID 文件
function gracefulShutdown(signal) {
  console.log(`\n收到 ${signal}，正在保存运行时状态并关闭 PTY 子进程...`);
  persistRuntimeState();
  removePidFile();

  if (runtimeStateSaveTimer) {
    clearInterval(runtimeStateSaveTimer);
  }

  // 关闭所有 WebSocket 连接
  try {
    wss.clients.forEach(client => {
      try { client.close(); } catch (_) {}
    });
    wss.close();
  } catch (e) {}

  // 关闭所有 PTY 进程
  for (const [paneId, entry] of ptyRegistry) {
    try {
      entry.proc.kill();
    } catch (e) {
      console.error(`关闭 PTY ${paneId} 失败:`, e.message);
    }
  }
  ptyRegistry.clear();

  // 停止所有轮询器
  for (const [paneId, timer] of sessionPollers) {
    try { clearInterval(timer); } catch (_) {}
  }
  sessionPollers.clear();

  server.close(() => {
    deleteRuntimeState(CONFIG_PATH);
    console.log('Vibe Space 已退出');
    process.exit(0);
  });
  // 强制退出兜底
  setTimeout(() => {
    console.error('关闭超时，强制退出');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('exit', removePidFile);
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message);
  persistRuntimeState();
  removePidFile();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason);
});
