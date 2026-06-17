const fs = require('fs');
const path = require('path');

const RUNTIME_STATE_VERSION = 1;

/**
 * 运行时状态持久化模块
 *
 * 保存/恢复那些不属于用户配置的运行时状态：
 * - 每个 pane 的待派发任务队列
 * - 每个 pane 的输出缓冲（最近 100KB）
 * - 每个 pane 的 Claude Code 就绪状态
 * - 每个 pane 的任务循环状态
 * - 当前正在执行的任务索引
 * - 全局 loopProjectIndex
 *
 * 注意：node-pty 子进程无法在 Windows 上脱离父进程存活，
 * 所以这里保存的是“恢复所需的最小状态”，而不是真正的 PTY 句柄。
 */

function getRuntimeStatePath(configPath) {
  if (configPath) {
    const dir = path.dirname(configPath);
    const base = path.basename(configPath, '.json');
    return path.join(dir, `${base}.runtime-state.json`);
  }
  return path.join(__dirname, '..', 'runtime-state.json');
}

function writeAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, data, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw e;
  }
}

function saveRuntimeState(state, configPath) {
  const filePath = getRuntimeStatePath(configPath);
  const payload = {
    version: RUNTIME_STATE_VERSION,
    savedAt: Date.now(),
    ...state,
  };
  writeAtomic(filePath, JSON.stringify(payload, null, 2));
}

function loadRuntimeState(configPath) {
  const filePath = getRuntimeStatePath(configPath);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data.version !== RUNTIME_STATE_VERSION) {
      console.warn(`[state-persistence] runtime-state.json 版本不匹配 (${data.version} != ${RUNTIME_STATE_VERSION})，忽略`);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[state-persistence] 加载 runtime-state.json 失败:', e.message);
    return null;
  }
}

function deleteRuntimeState(configPath) {
  const filePath = getRuntimeStatePath(configPath);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn('[state-persistence] 删除 runtime-state.json 失败:', e.message);
  }
}

/**
 * 从运行时的变量构建可序列化的状态对象
 */
function buildRuntimeState({
  config,
  ptyRegistry,
  pendingTaskQueues,
  claudeReadyStates,
  paneLoopStates,
  loopProjectIndex,
}) {
  const panes = {};

  if (config.panes) {
    config.panes.forEach((pane) => {
      const paneId = pane.id;
      const entry = ptyRegistry ? ptyRegistry.get(paneId) : null;
      const pending = pendingTaskQueues ? pendingTaskQueues.get(paneId) : [];

      // 找到当前 dispatched 的任务索引
      const tasks = pane.tasks || [];
      const lastDispatchedTaskIndex = tasks.findIndex(t =>
        t.status === 'dispatched' || t.status === 'running' || t.status === 'executing'
      );

      panes[paneId] = {
        claudeReady: claudeReadyStates ? !!claudeReadyStates.get(paneId) : false,
        pendingTasks: (pending || [])
          .filter(t => t.command || t.label)
          .map(t => ({ command: t.command || '', label: t.label || '' })),
        outputBuffer: entry && entry.buffer ? entry.buffer.snapshot() : '',
        lastDispatchedTaskIndex: lastDispatchedTaskIndex >= 0 ? lastDispatchedTaskIndex : null,
        loopRunning: paneLoopStates ? !!paneLoopStates.get(paneId) : false,
      };
    });
  }

  return {
    panes,
    global: {
      loopProjectIndex: loopProjectIndex ?? null,
    },
  };
}

/**
 * 把加载的运行时状态合并回 config 和运行时变量
 * 返回需要恢复动作的信息列表
 */
function restoreRuntimeState(config, state) {
  if (!state || !state.panes) return { restored: [], global: { loopProjectIndex: null } };

  const restored = [];

  config.panes.forEach((pane) => {
    const paneState = state.panes[pane.id];
    if (!paneState) return;

    const tasks = pane.tasks || [];
    const idx = paneState.lastDispatchedTaskIndex;

    // 注意：我们不把任务状态恢复为 dispatched，因为新的 PTY/Claude 尚未收到该任务。
    // 状态保持 idle，由前端收到 resume-loop 后重新派发。
    if (idx != null && tasks[idx] && tasks[idx].status === 'dispatched') {
      tasks[idx].status = 'idle';
      tasks[idx].done = false;
    }

    restored.push({
      paneId: pane.id,
      projectId: pane.projectId,
      lastDispatchedTaskIndex: idx,
      pendingTasks: paneState.pendingTasks || [],
      outputBuffer: paneState.outputBuffer || '',
      loopRunning: paneState.loopRunning || false,
    });
  });

  return {
    restored,
    global: state.global || { loopProjectIndex: null },
  };
}

module.exports = {
  RUNTIME_STATE_VERSION,
  getRuntimeStatePath,
  saveRuntimeState,
  loadRuntimeState,
  deleteRuntimeState,
  buildRuntimeState,
  restoreRuntimeState,
};
