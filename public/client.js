const grid = document.getElementById('grid');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsPanelClose = document.getElementById('settingsPanelClose');
const statsBtn = document.getElementById('statsBtn');
const statsPanel = document.getElementById('statsPanel');
const statsOverlay = document.getElementById('statsOverlay');
const statsPanelClose = document.getElementById('statsPanelClose');
const statsBody = document.getElementById('statsBody');
const quotaBar = document.getElementById('quotaBar');
const taskOverlay = document.getElementById('taskOverlay');
const taskPanel = document.getElementById('taskPanel');
const taskPanelResizer = document.getElementById('taskPanelResizer');
const taskPanelClose = document.getElementById('taskPanelClose');
const taskPanelTitle = document.getElementById('taskPanelTitle');
const taskListEl = document.getElementById('taskList');
const btnTaskAdd = document.getElementById('btnTaskAdd');
const taskTextInput = document.getElementById('taskText');
const taskLoopToggle = document.getElementById('taskLoopToggle');
const btnAttach = document.getElementById('btnAttach');
const taskFileInput = document.getElementById('taskFileInput');
const taskAttachmentsPreview = document.getElementById('taskAttachmentsPreview');

let config = null;
let ws = null;
let wsFirstConnect = true; // 用于区分首次连接和重连
let currentTheme = {};
let activeTaskProjectIndex = null;
let taskLoopTimer = null;
let loopAdvanceTimer = null;
let silenceCheckerTimer = null; // 静默检测定时器
let loopProjectIndex = null; // 当前循环执行的项目索引
let selectedAttachments = []; // 待添加任务的附件列表

// 终端输出跟踪器：ptyId -> { lastOutputAt: number, silentCycles: number }
const termOutputTracker = new Map();

// 智能任务验证：记录每个 dispatched 任务的终端原始输出
const taskOutputBuffers = new Map(); // taskId -> { lines: string[], startTime: number }

// Claude Code 就绪状态：projectIndex -> boolean
const claudeReadyStates = new Map();
// Claude Code 三层状态：projectIndex -> { status: 'idle'|'busy', since: number, source: 'session'|'hook'|'scrape', hookEvent?: string }
const claudeStatusMap = new Map();
// Hook 事件时间戳：projectIndex -> { lastHookAt: number, lastHookType: string }
const claudeHookTimestamps = new Map();

// Claude Code 自动确认规则：只匹配 AI 明确提出的确认/选择问题，避免误匹配正常对话
const autoConfirmRules = [
  // 方案执行类：必须包含"方案"或"计划"+"执行/做/实施"
  { pattern: /(?:想|要|需要|能否)让我(?:按|用|以|根据).*?(?:方案|计划|建议).*?(?:执行|做|实施|实现)/i, response: '是，按这个方案执行' },
  // 继续/执行确认
  { pattern: /是否需要我继续/i, response: '是，继续' },
  { pattern: /是否需要我执行/i, response: '是，请执行' },
  { pattern: /是否(?:要|需要)继续/i, response: '是，继续' },
  { pattern: /是否(?:要|需要)执行/i, response: '是，执行' },
  { pattern: /确认要(?:继续|执行)/i, response: '确认' },
  { pattern: /(?:需要|是否).*?(?:确认|确认一下)/i, response: '确认' },
  { pattern: /还是你有偏好的/i, response: '按你推荐的方案执行' },
  // 直接执行确认
  { pattern: /你想让我按这个方案直接执行吗/i, response: '是，请按这个方案直接执行' },
  { pattern: /是否需要我先做/i, response: '是，请先做' },
  { pattern: /是否要我现在就做/i, response: '是，现在就做' },
  { pattern: /是否确认(?:这个|该)方案/i, response: '确认，按方案执行' },
  { pattern: /你可以接受吗/i, response: '可以接受，请继续' },
  { pattern: /这样可以吗/i, response: '可以，请继续' },
  { pattern: /(?:这样|这个方案).*?(?:是否|可以).*?(?:可行|合适|可以)/i, response: '可行，请继续' },
  // 英文确认类：必须是明确的选择/确认问句
  { pattern: /would you like me to proceed/i, response: 'yes, proceed' },
  { pattern: /shall i proceed/i, response: 'yes, proceed' },
  { pattern: /please confirm/i, response: 'yes' },
  { pattern: /should i (run|execute|apply|implement)/i, response: 'yes, please do it' },
  { pattern: /do you want me to (run|execute|apply|implement)/i, response: 'yes, please do it' },
  { pattern: /which (one|option|approach|method)/i, response: 'choose the one you think is best' },
  { pattern: /is this (ok|okay|acceptable)/i, response: 'yes, it is acceptable, please continue' },
  { pattern: /can i proceed/i, response: 'yes, please proceed' },
];

// 记录已经自动确认过的输出片段，避免重复确认
const autoConfirmedOutputs = new Set();

// 从 task-analyzer.js 复用分析函数（无 DOM 依赖，浏览器和 Node 共用）
const {
  inferTaskType,
  stripAnsiCodes,
  hasTaskDoneMarkerNearEnd,
  TASK_DONE_SUCCESS_RE,
  TASK_DONE_FAILED_RE,
  TASK_DONE_NEEDS_INPUT_RE,
  analyzeTaskOutput,
} = (typeof TaskAnalyzer !== 'undefined' ? TaskAnalyzer : {
  inferTaskType: () => 'action',
  stripAnsiCodes: s => s,
  hasTaskDoneMarkerNearEnd: () => false,
  TASK_DONE_SUCCESS_RE: /\[\[TASK_DONE:success\]\]\s*$/,
  TASK_DONE_FAILED_RE: /\[\[TASK_DONE:failed:(.+?)\]\]\s*$/s,
  TASK_DONE_NEEDS_INPUT_RE: /\[\[TASK_DONE:needs_input:(.+?)\]\]\s*$/s,
  analyzeTaskOutput: () => ({ isDone: false, hasError: false, needsUser: false, isAmbiguous: true, needsInput: false, text: '', errorContext: '' }),
});

// 检测 AI 是否处于 Plan Mode（深度思考/计划模式）
// Plan Mode 期间 AI 列出的选项是其自己的工作计划，不是向用户提问
function isInPlanMode(text) {
  const clean = stripAnsiCodes(text);
  // 多个特征综合判断，提高准确性
  const indicators = [
    /plan\s*mode\s*on/i,
    /[●◯]\s+(Explore|Explore\s+backend|Perusing|Analyzing|Planning)/i,
    /shift\+tab\s+to\s+cycle/i,
    /Enter\s+to\s+view/i,
    /↑\/↓\s+to\s+select/i,
    /Thinking\s+for\s+\d+s/i,
    /Next:\s+(Analyze|Explore|Search|Read)/i,
    /⎿\s+\w+\s+…\s*\(\d+s/i,  // 子任务计时特征
  ];
  const matchCount = indicators.reduce((count, re) => count + (re.test(clean) ? 1 : 0), 0);
  // 需要至少 2 个特征匹配，避免误报
  return matchCount >= 2;
}

// 检测 AI 是否正在深度思考/执行中（输出中有进度指示）
function isDeepThinking(text) {
  const clean = stripAnsiCodes(text);
  return /thinking|schlepping|perusing|exploring|analyzing|listing|searching|reading|editing/i.test(clean) &&
    /\(\d+s|↓\s*\d+k?\s*tokens?|ctrl\+o/i.test(clean);
}

// 根据 AI 状态获取动态静默阈值
function getDynamicSilenceThreshold(projectIndex, taskType) {
  const base = getSilenceThresholdMs();
  const cs = getClaudeStatusForProject(projectIndex);
  
  // 如果 AI 正在深度思考，大幅延长阈值
  if (runningTaskId) {
    const buf = taskOutputBuffers.get(runningTaskId);
    const text = buf ? buf.lines.join('') : '';
    if (isDeepThinking(text)) {
      return Math.max(base * 4, 240000); // 至少 4 分钟
    }
    if (isInPlanMode(text)) {
      return Math.max(base * 3, 180000); // Plan Mode 至少 3 分钟
    }
  }
  
  // 官方状态 busy 时延长
  if (cs.status === 'busy') {
    return base + getBusyExtraSilenceMs();
  }
  
  // 咨询型任务可以更快
  if (taskType === 'consult') {
    return Math.max(base * 0.5, 20000); // 至少 20 秒
  }
  
  return base;
}

// 检测 AI 输出中是否有"实质性内容"（用于判断咨询型任务是否完成）
function hasSubstantiveOutput(text) {
  const clean = stripAnsiCodes(text).replace(/\s/g, '');
  if (clean.length < 50) return false;
  
  // 有代码、分析、建议等实质内容
  const substanceIndicators = [
    /\b(function|class|const|let|var|import|export|return|if|for|while)\b/,
    /\b(bug|error|fix|issue|problem|优化|修复|建议|分析|方案|计划)\b/i,
    /```[\s\S]*?```/,  // 代码块
    /\[\[TASK_DONE:/,  // 任务完成标记
    /已完成|已修复|已解决|成功|done|completed|fixed/i,
  ];
  return substanceIndicators.some(re => re.test(text));
}

// 检测是否为无意义/问候型任务
function isTrivialTask(text) {
  const t = text.trim().toLowerCase();
  const trivialPatterns = [
    /^你好$/,
    /^hi$/,
    /^hello$/,
    /^在吗$/,
    /^在？$/,
    /^help$/,
    /^\?$/,
    /^当前的状态是什么[？?]?$/,
    /^看看.*$/,
    /^检索.*bug.*$/,
  ];
  return trivialPatterns.some(re => re.test(t));
}

// 记录 Plan Mode 状态：projectIndex -> { inPlanMode: boolean, since: number }
const planModeStates = new Map();

// 记录任务派发确认状态：taskId -> { confirmed: boolean, retryCount: number }
const dispatchConfirmStates = new Map();

// 动态读取配置中的循环参数（支持实时调整）
function getSilenceThresholdMs() {
  return ((config?.loop?.silenceThreshold) || 60) * 1000;
}

function getSilenceConfirmCount() {
  return (config?.loop?.silenceConfirmCount) || 2;
}

function getBusyExtraSilenceMs() {
  return (config?.loop?.busyExtraSilenceMs) || 15000;
}

function getStuckTaskTimeoutMs() {
  return (config?.loop?.stuckTaskTimeoutMs) || 120000;
}

function getMaxAutoFixAttempts() {
  return (config?.loop?.maxAutoFixAttempts) || 3;
}

function getLoopIntervalMs() {
  return (config?.loop?.loopIntervalMs) ?? 1000;
}

function getTokenPrices() {
  return {
    input: config?.cost?.inputTokenPrice ?? 3.0,
    output: config?.cost?.outputTokenPrice ?? 15.0,
    cache: config?.cost?.cacheTokenPrice ?? 0.5,
  };
}

// 终端输出缓存：在 pane 创建前收到的历史缓冲先暂存于此
const pendingOutput = new Map(); // ptyId -> [data, ...]

// 主题预设统一使用 theme-engine.js 中定义的完整配色体系
let presetThemes = (typeof ThemeEngine !== 'undefined' && ThemeEngine.presetThemes) ? ThemeEngine.presetThemes : {};

// 若 theme-engine.js 因缓存未加载，动态补加载
function ensureThemeEngine() {
  if (typeof ThemeEngine !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/theme-engine.js?v=30';
    script.async = true;
    script.onload = () => {
      presetThemes = (typeof ThemeEngine !== 'undefined' && ThemeEngine.presetThemes)
        ? ThemeEngine.presetThemes
        : presetThemes;
      // 主题引擎加载完成后重新渲染预设按钮
      if (typeof renderPresetThemes === 'function') renderPresetThemes();
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load theme-engine.js'));
    document.head.appendChild(script);
  });
}

// 为旧版简化主题配置提供兼容映射（bgColor/paneColor/borderColor/style）
function normalizeThemeInput(input) {
  if (!input) return { style: 'dark' };
  if (input.style && presetThemes[input.style]) {
    const p = presetThemes[input.style];
    return {
      bgColor: p.colors.bg,
      paneColor: p.colors.pane,
      borderColor: p.colors.border,
      fontSize: input.fontSize ?? 11,
      style: input.style,
      scrollback: input.scrollback,
      showScrollbar: input.showScrollbar,
    };
  }
  if (input.preset && presetThemes[input.preset]) {
    const p = presetThemes[input.preset];
    return {
      bgColor: p.colors.bg,
      paneColor: p.colors.pane,
      borderColor: p.colors.border,
      fontSize: input.fontSize ?? 11,
      style: input.preset,
      scrollback: input.scrollback,
      showScrollbar: input.showScrollbar,
    };
  }
  return { ...input, style: input.style || 'dark' };
}

// 根据当前主题键返回 xterm 终端配色
function getTerminalTheme(themeKeyOrInput) {
  const key = ThemeEngine ? ThemeEngine.resolvePreset(themeKeyOrInput) : 'dark';
  const preset = presetThemes[key];
  const termColors = preset?.colors?.terminal;
  if (termColors) {
    return {
      background: termColors.black,
      foreground: termColors.foreground,
      cursor: termColors.cursor,
      cursorAccent: termColors.white,
      selectionBackground: termColors.selectionBackground,
      selectionForeground: termColors.foreground,
      black: termColors.black,
      red: termColors.red,
      green: termColors.green,
      yellow: termColors.yellow,
      blue: termColors.blue,
      magenta: termColors.magenta,
      cyan: termColors.cyan,
      white: termColors.white,
      brightBlack: termColors.brightBlack,
      brightRed: termColors.brightRed,
      brightGreen: termColors.brightGreen,
      brightYellow: termColors.brightYellow,
      brightBlue: termColors.brightBlue,
      brightMagenta: termColors.brightMagenta,
      brightCyan: termColors.brightCyan,
      brightWhite: termColors.brightWhite,
    };
  }
  // fallback
  const isLight = key === 'light' || key === 'paper' || key === 'sepia';
  return {
    background: isLight ? '#f0ede8' : '#161b22',
    foreground: isLight ? '#3d3a36' : '#c9d1d9',
    cursor: isLight ? '#7a6f5b' : '#58a6ff',
    cursorAccent: isLight ? '#ffffff' : '#000000',
    selectionBackground: isLight ? '#d6d0c7' : '#264f78',
    selectionForeground: isLight ? '#1a1a1a' : '#c9d1d9',
  };
}

function log(msg) {
  console.log('[VibeSpace]', msg);
}

function showReconnectToast(message) {
  let toast = document.getElementById('vs-reconnect-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'vs-reconnect-toast';
    toast.className = 'reconnect-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

function markPaneRestoring(projectIndex) {
  const pane = document.getElementById('pane-pty-' + projectIndex);
  if (!pane) return;
  pane.classList.remove('completed', 'completed-steady', 'dispatching', 'testing', 'error');
  pane.classList.add('restoring');
  setTimeout(() => {
    pane.classList.remove('restoring');
  }, 3000);
}

async function loadConfig() {
  log('Loading config...');
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    log('Config loaded: ' + config.projects.length + ' projects');

    // 加载并应用保存的语言
    if (config.locale) {
      await window.i18n.setLocale(config.locale);
      const langSelector = document.getElementById('langSelector');
      if (langSelector) langSelector.value = config.locale;
    }
    window.i18n.translatePage();

    grid.style.gridTemplateRows = `repeat(${config.layout.rows}, 1fr)`;
    grid.style.gridTemplateColumns = `repeat(${config.layout.cols}, 1fr)`;
    if (config.theme) {
      const normalizedTheme = normalizeThemeInput(config.theme);
      applyTheme(normalizedTheme);
      updateSettingsUI(normalizedTheme);
    }
    if (config.loop) {
      updateLoopSettingsUI(config.loop);
    }
    if (config.cost) {
      updateCostSettingsUI(config.cost);
    }
    renderGridPlaceholders();
  } catch (e) {
    log('Config load failed: ' + e.message);
    statusText.textContent = window.i18n.t('header.connectionFailed');
  }
}

function connectWebSocket() {
  log('Connecting WebSocket...');
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

  ws.onopen = () => {
    log('WebSocket connected');
    statusDot.className = 'status-dot connected';
    statusText.textContent = window.i18n.t('header.connected');

    // 重连提示
    if (!wsFirstConnect) {
      showReconnectToast('已重新连接到服务器，正在恢复任务…');
    }
    wsFirstConnect = false;

    // 重连后：向服务端请求恢复任务循环状态
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'resume-state' }));
    }

    // 重连后：如果配置中仍有 dispatched 任务，恢复静默检测
    if (config && config.projects) {
      const hasDispatched = config.projects.some(p =>
        (p.tasks || []).some(t => getTaskStatus(t) === 'dispatched')
      );
      if (hasDispatched) startSilenceChecker();
    }
  };

  ws.onclose = () => {
    log('WebSocket disconnected, reconnecting in 3s');
    statusDot.className = 'status-dot error';
    statusText.textContent = window.i18n.t('header.disconnected');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (e) => {
    log('WebSocket error: ' + (e.message || 'Cannot connect'));
    statusDot.className = 'status-dot error';
    statusText.textContent = window.i18n.t('header.connectionFailed');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      log('收到消息: type=' + msg.type + ' id=' + msg.id);

      if (msg.type === 'ready') {
        createTerminal(msg.id, msg.name, msg.color, msg.cwd, msg.index);
      } else if (msg.type === 'output') {
        const wrap = document.getElementById('term-' + msg.id);
        if (wrap && wrap._xterm) {
          wrap._xterm.write(msg.data);
          const tracker = termOutputTracker.get(msg.id) || {};
          termOutputTracker.set(msg.id, { ...tracker, lastOutputAt: Date.now(), silentCycles: 0 });
          // 智能任务验证：若当前有 runningTaskId，将该输出追加到任务缓冲区
          if (runningTaskId) {
            const buf = taskOutputBuffers.get(runningTaskId);
            if (buf) buf.lines.push(msg.data);
            // 自动确认 Claude Code 的询问
            const projectIndex = parseInt((msg.id || '').replace('pty-', ''));
            if (!Number.isNaN(projectIndex)) {
              handleAutoConfirm(projectIndex, msg.data);
              // 检测精确任务完成标记（成功/失败）
              checkTaskDoneMarker(projectIndex, msg.data);
              // 尝试从终端输出解析当前窗口上下文用量
              const ctx = extractContextFromOutput(msg.data);
              if (ctx) updatePaneContextBadge(projectIndex, ctx);
            }
          }
        } else {
          // 终端尚未创建（历史缓冲可能比 ready 先到），先缓存
          const queue = pendingOutput.get(msg.id) || [];
          queue.push(msg.data);
          pendingOutput.set(msg.id, queue);
          log('缓存输出，等待终端创建: ' + msg.id);
        }
      } else if (msg.type === 'config-changed') {
        handleConfigChanged();
      } else if (msg.type === 'resume-loop') {
        handleResumeLoop(msg);
      } else if (msg.type === 'server-restarted') {
        log('Server restarted, reloading config');
        loadConfig();
      } else if (msg.type === 'claude-ready') {
        handleClaudeReady(msg.index, msg.id);
      } else if (msg.type === 'claude-error') {
        handleClaudeError(msg.index, msg.id, msg.error);
      } else if (msg.type === 'claude-status') {
        handleClaudeStatus(msg);
      } else if (msg.type === 'claude-hook') {
        handleClaudeHook(msg);
      }
    } catch (e) {
      log('Message handling error: ' + e.message);
    }
  };
}

/** Claude Code 就绪通知 */
function handleClaudeReady(index, id) {
  claudeReadyStates.set(index, true);
  log(`Claude Code ready: ${id}`);
  const pane = document.getElementById('pane-' + id);
  if (pane) {
    const pathSpan = pane.querySelector('.pane-path');
    if (pathSpan && !pathSpan.textContent.startsWith('●')) {
      pathSpan.textContent = '● ' + pathSpan.textContent;
      // 防止 title 无限累积前缀
      if (!pathSpan.title.includes(window.i18n.t('pane.claudeReady'))) {
        pathSpan.title = window.i18n.t('pane.claudeReady') + ' | ' + pathSpan.title;
      }
    }
  }
}

/** 服务端通知恢复任务循环 */
async function handleResumeLoop(msg) {
  const projectIndex = msg.paneId;
  if (projectIndex === undefined || projectIndex === null) return;
  const proj = config.projects[projectIndex];
  if (!proj) return;

  log(`Resuming loop for pane ${projectIndex}`);
  proj._loopRunning = true;
  loopProjectIndex = projectIndex;

  markPaneRestoring(projectIndex);
  updateLoopUI();
  startSilenceChecker();

  const idx = msg.lastDispatchedTaskIndex;
  if (idx != null && proj.tasks[idx] && getTaskStatus(proj.tasks[idx]) === 'idle') {
    runningTaskId = `${projectIndex}-${idx}`;
    await dispatchTask(projectIndex, idx);
  } else {
    await triggerLoopNext(projectIndex);
  }
}

/** Claude Code 启动失败通知 */
function handleClaudeError(index, id, error) {
  claudeReadyStates.set(index, false);
  log(`Claude Code start failed: ${id} - ${error}`);
  statusText.textContent = `Claude Code start failed [${id}]`;
}

/** 处理 Claude Code 官方 Session 状态推送 */
function handleClaudeStatus(msg) {
  const index = msg.index;
  if (index === undefined || index === null) return;

  const prev = claudeStatusMap.get(index);
  const next = {
    status: msg.status,           // 'idle' | 'busy'
    since: msg.since || 0,
    source: msg.ready ? 'session' : (prev?.source || 'session'),
    updatedAt: Date.now(),
  };

  // 状态变化日志
  if (!prev || prev.status !== next.status) {
    log(`Claude status [pty-${index}]: ${prev?.status || 'unknown'} -> ${next.status}`);
  }

  claudeStatusMap.set(index, next);

  // 更新 pane header 状态徽章
  updateClaudeStatusBadge(index, next);

  // 如果状态变为 idle，且当前有 dispatched 任务，立即触发智能验证
  if (next.status === 'idle' && prev?.status === 'busy') {
    const proj = config.projects[index];
    if (proj && proj.tasks) {
      const dispatchedIdx = proj.tasks.findIndex(t => getTaskStatus(t) === 'dispatched');
      if (dispatchedIdx !== -1) {
        log(`Claude idle, trigger task ${index}-${dispatchedIdx} verification`);
        markTaskTesting(index, dispatchedIdx, true);
      }
    }
  }
}

/** 处理 Claude Code Hook 事件推送 */
function handleClaudeHook(msg) {
  const event = msg.event || msg;
  const hookName = (event.hook || event.type || 'unknown').toLowerCase();
  const index = msg.index;

  // 更新 hook 时间戳
  if (index !== undefined && index !== null) {
    claudeHookTimestamps.set(index, { lastHookAt: Date.now(), lastHookType: hookName });
  }

  log(`Hook [${hookName}] ${index !== undefined ? `-> project ${index}` : '(broadcast)'}`);

  // 关键事件处理
  switch (hookName) {
    case 'stop':
      // AI reply ended
      if (index !== undefined) {
        claudeStatusMap.set(index, { status: 'idle', since: 0, source: 'hook', hookEvent: 'stop', updatedAt: Date.now() });
        updateClaudeStatusBadge(index, { status: 'idle' });
        const proj = config.projects[index];
        if (proj && proj.tasks) {
          const dispatchedIdx = proj.tasks.findIndex(t => getTaskStatus(t) === 'dispatched');
          if (dispatchedIdx !== -1) {
            markTaskTesting(index, dispatchedIdx, true);
          }
        }
      }
      break;

    case 'notification':
      // User confirmation needed
      if (index !== undefined) {
        const matcher = event.matcher || '';
        if (matcher.includes('permission_prompt') || matcher.includes('idle_prompt') || matcher.includes('elicitation')) {
          claudeStatusMap.set(index, { status: 'waiting', since: 0, source: 'hook', hookEvent: 'notification', updatedAt: Date.now() });
          updateClaudeStatusBadge(index, { status: 'waiting' });
          // Try auto-confirm
          const proj = config.projects[index];
          if (proj && proj.tasks) {
            const dispatchedIdx = proj.tasks.findIndex(t => getTaskStatus(t) === 'dispatched');
            if (dispatchedIdx !== -1) {
              const task = proj.tasks[dispatchedIdx];
              const buf = taskOutputBuffers.get(`${index}-${dispatchedIdx}`);
              const accumulatedText = buf ? stripAnsiCodes(buf.lines.join('')) : '';
              if (tryAutoConfirm(index, accumulatedText)) {
                log(`Hook notification triggered auto-confirm`);
              }
            }
          }
        }
      }
      break;

    case 'permission_request':
      // Explicit permission request
      if (index !== undefined) {
        claudeStatusMap.set(index, { status: 'waiting', since: 0, source: 'hook', hookEvent: 'permission_request', updatedAt: Date.now() });
        updateClaudeStatusBadge(index, { status: 'waiting' });
      }
      break;

    case 'session_start':
    case 'userpromptsubmit':
      // User submitted prompt, Claude busy
      if (index !== undefined) {
        claudeStatusMap.set(index, { status: 'busy', since: 0, source: 'hook', hookEvent: hookName, updatedAt: Date.now() });
        updateClaudeStatusBadge(index, { status: 'busy' });
      }
      break;

    case 'pretooluse':
      // Tool use in progress, treat as busy
      if (index !== undefined) {
        claudeStatusMap.set(index, { status: 'busy', since: 0, source: 'hook', hookEvent: 'pretooluse', updatedAt: Date.now() });
        updateClaudeStatusBadge(index, { status: 'busy' });
      }
      break;
  }
}

/** 更新 pane header 上的 Claude 状态徽章 */
function updateClaudeStatusBadge(index, statusInfo) {
  const pane = document.getElementById('pane-pty-' + index);
  if (!pane) return;

  let badge = pane.querySelector('.claude-status-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'claude-status-badge';
    const header = pane.querySelector('.pane-header');
    if (header) {
      // 插入到 pathSpan 之前
      const pathSpan = header.querySelector('.pane-path');
      if (pathSpan) {
        header.insertBefore(badge, pathSpan);
      } else {
        header.appendChild(badge);
      }
    }
  }

  const status = statusInfo.status || 'unknown';
  badge.dataset.status = status;
  badge.title = `Claude Code status: ${status}${statusInfo.source ? ` (${statusInfo.source})` : ''}`;

  switch (status) {
    case 'busy':
      badge.textContent = '● ' + window.i18n.t('statusBadge.busy');
      badge.className = 'claude-status-badge busy';
      break;
    case 'idle':
      badge.textContent = '○ ' + window.i18n.t('statusBadge.idle');
      badge.className = 'claude-status-badge idle';
      break;
    case 'waiting':
      badge.textContent = '◐ ' + window.i18n.t('statusBadge.waiting');
      badge.className = 'claude-status-badge waiting';
      break;
    default:
      badge.textContent = '';
      badge.className = 'claude-status-badge';
      break;
  }
}

/** 获取指定项目的当前 Claude 状态 */
function getClaudeStatusForProject(index) {
  return claudeStatusMap.get(index) || { status: 'unknown', since: 0, source: 'none' };
}

/** 检测 Claude Code 是否需要确认，并自动回复 */
/** 从 Kimi CLI 状态行文本中解析上下文/窗口用量 */
function extractContextFromOutput(rawData) {
  if (!rawData) return null;
  // 去除 ANSI 转义码
  const text = stripAnsiCodes(rawData);
  // 优先匹配上下文：上下文[░░░░░░░░░░░░]3%(27k) 或 Context[...]3%(27k)
  const ctxMatch = text.match(/(?:上下文|Context)\s*[\[▕]([█░▓▒\s]+)[\]▏]\s*(\d+)%\s*\((\d+)k\)/i);
  if (ctxMatch) {
    return { type: 'context', percent: parseInt(ctxMatch[2], 10), tokens: parseInt(ctxMatch[3], 10) };
  }
  // 兜底：上下文 3% (27k)
  const ctxFallback = text.match(/(?:上下文|Context|Ctx)[\s:]+(\d+)%\s*\((\d+)k\)/i);
  if (ctxFallback) {
    return { type: 'context', percent: parseInt(ctxFallback[1], 10), tokens: parseInt(ctxFallback[2], 10) };
  }
  // 若上下文不存在，解析窗口配额作为 pane 级参考：窗口[...]42%
  const winMatch = text.match(/(?:窗口|Window)\s*[\[▕]([█░▓▒\s]+)[\]▏]\s*(\d+)%/i);
  if (winMatch) {
    return { type: 'window', percent: parseInt(winMatch[2], 10), tokens: null };
  }
  return null;
}

function handleAutoConfirm(projectIndex, rawData) {
  if (!runningTaskId || loopProjectIndex === null) return false;
  if (parseInt(runningTaskId.split('-')[0]) !== projectIndex) return false;

  // 基于累计输出检测确认问题（避免输出分片导致匹配失败）
  const buf = taskOutputBuffers.get(runningTaskId);
  const accumulatedText = buf ? stripAnsiCodes(buf.lines.join('')) : '';
  const currentText = stripAnsiCodes(rawData || '');
  const text = accumulatedText + currentText;

  // Plan Mode 检测：如果 AI 正在做计划，不要自动确认
  if (isInPlanMode(text)) {
    const prev = planModeStates.get(projectIndex);
    if (!prev || !prev.inPlanMode) {
      log(`Plan Mode detected for project ${projectIndex}, suspending auto-confirm`);
      planModeStates.set(projectIndex, { inPlanMode: true, since: Date.now() });
    }
    return false;
  }
  
  // Plan Mode 结束，恢复检测
  const prevPlan = planModeStates.get(projectIndex);
  if (prevPlan && prevPlan.inPlanMode) {
    log(`Plan Mode ended for project ${projectIndex}, resuming auto-confirm`);
    planModeStates.set(projectIndex, { inPlanMode: false, since: Date.now() });
  }

  const fingerprint = text.trim().slice(-120);
  if (autoConfirmedOutputs.has(fingerprint)) return false;

  for (const rule of autoConfirmRules) {
    if (rule.pattern.test(text)) {
      autoConfirmedOutputs.add(fingerprint);
      log(`Confirmation detected, auto-reply in 1s: ${rule.response}`);
      setTimeout(() => {
        const proj = config.projects[projectIndex];
        if (proj && loopProjectIndex === projectIndex && proj._loopRunning) {
          sendTaskToTerminal(projectIndex, rule.response, 'auto-confirm');
        }
      }, 1000);
      return true;
    }
  }
  return false;
}

/** 从输出文本中检测确认请求并自动回复（用于智能验证阶段） */
function tryAutoConfirm(projectIndex, text, taskType = 'action') {
  const fingerprint = text.trim().slice(0, 120);
  if (autoConfirmedOutputs.has(fingerprint)) return false;

  // Plan Mode 检测：如果 AI 正在做计划，不要自动确认
  if (isInPlanMode(text)) {
    const prev = planModeStates.get(projectIndex);
    if (!prev || !prev.inPlanMode) {
      log(`tryAutoConfirm: Plan Mode detected for project ${projectIndex}, skipping`);
      planModeStates.set(projectIndex, { inPlanMode: true, since: Date.now() });
    }
    return false;
  }
  
  // Plan Mode 结束
  const prevPlan = planModeStates.get(projectIndex);
  if (prevPlan && prevPlan.inPlanMode) {
    log(`tryAutoConfirm: Plan Mode ended for project ${projectIndex}`);
    planModeStates.set(projectIndex, { inPlanMode: false, since: Date.now() });
  }

  // consult 类型：若 AI 在末尾询问是否执行/继续，自动替用户肯定
  if (taskType === 'consult') {
    const consultConfirmPatterns = [
      { pattern: /(?:如果|若).*?同意.*?请告诉我|如果你同意|你是否同意|想让我先做|还是你有偏好的|是否继续|是否执行|是否要我做/i, response: '请按你的建议继续执行，不需要再次询问我。' },
      { pattern: /would you like me to proceed|shall i proceed|should i continue|do you want me to continue/i, response: 'Yes, please proceed with your suggestion.' },
    ];
    for (const rule of consultConfirmPatterns) {
      if (rule.pattern.test(text)) {
        autoConfirmedOutputs.add(fingerprint);
        log(`Consult task auto-confirm: ${rule.response}`);
        setTimeout(() => {
          const proj = config.projects[projectIndex];
          if (proj) {
            sendTaskToTerminal(projectIndex, rule.response, 'auto-confirm');
          }
        }, 1500);
        return true;
      }
    }
  }

  for (const rule of autoConfirmRules) {
    if (rule.pattern.test(text)) {
      autoConfirmedOutputs.add(fingerprint);
      log(`Verification detected confirmation, auto-reply: ${rule.response}`);
      setTimeout(() => {
        const proj = config.projects[projectIndex];
        if (proj && loopProjectIndex === projectIndex && proj._loopRunning) {
          sendTaskToTerminal(projectIndex, rule.response, 'auto-confirm');
        }
      }, 1500);
      return true;
    }
  }
  return false;
}

/**
 * 重建 pane header（保留终端内容），用于 header 异常缺失后的恢复
 */
function rebuildPaneHeader(pane, id, name, color, cwd, index) {
  const oldHeader = pane.querySelector('.pane-header');
  if (oldHeader) oldHeader.remove();

  const header = document.createElement('div');
  header.className = 'pane-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'pane-name';
  nameSpan.innerHTML = `<span class="pane-indicator" style="background:${color}"></span><span class="pane-name-text">${escapeHtml(name)}</span>`;
  nameSpan.title = window.i18n.t('pane.renameTooltip');

  nameSpan.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const textEl = nameSpan.querySelector('.pane-name-text');
    if (!textEl) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pane-name-input';
    input.value = textEl.textContent;
    nameSpan.replaceChild(input, textEl);
    input.focus();
    input.select();

    function finishEdit() {
      const newName = input.value.trim() || name;
      const newSpan = document.createElement('span');
      newSpan.className = 'pane-name-text';
      newSpan.textContent = newName;
      nameSpan.replaceChild(newSpan, input);
      if (config && config.projects[index]) {
        config.projects[index].name = newName;
        fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        }).catch(() => {});
      }
    }

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      else if (ev.key === 'Escape') { input.value = name; input.blur(); }
    });
  });

  const pathSpan = document.createElement('span');
  pathSpan.className = 'pane-path';
  pathSpan.textContent = cwd;
  pathSpan.title = cwd;

  const doneBadge = document.createElement('span');
  doneBadge.className = 'pane-done-badge';
  doneBadge.textContent = '✓';
  doneBadge.title = window.i18n.t('pane.taskDone');
  doneBadge.style.display = 'none';

  const taskBtn = document.createElement('button');
  taskBtn.className = 'btn-task';
  taskBtn.title = window.i18n.t('pane.tasks');
  taskBtn.textContent = window.i18n.t('pane.tasks');
  taskBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const currentIndex = parseInt(pane.id.replace('pane-pty-', ''));
    openTaskPanel(Number.isNaN(currentIndex) ? index : currentIndex);
  });

  const progressSpan = document.createElement('span');
  progressSpan.className = 'pane-progress';
  progressSpan.style.display = 'none';

  header.appendChild(nameSpan);
  header.appendChild(pathSpan);
  header.appendChild(progressSpan);
  header.appendChild(doneBadge);
  header.appendChild(taskBtn);

  if (pane.firstChild) {
    pane.insertBefore(header, pane.firstChild);
  } else {
    pane.appendChild(header);
  }
}

/** 更新 pane 的任务进度显示 */
function updatePaneProgress(projectIndex) {
  const pane = document.getElementById('pane-pty-' + projectIndex);
  if (!pane) return;
  const progressSpan = pane.querySelector('.pane-progress');
  if (!progressSpan) return;

  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || proj.tasks.length === 0) {
    progressSpan.style.display = 'none';
    return;
  }

  const tasks = proj.tasks;
  const total = tasks.length;
  const done = tasks.filter(t => getEffectiveTaskStatus(t, tasks) === 'done').length;
  const dispatched = tasks.findIndex(t => getEffectiveTaskStatus(t, tasks) === 'dispatched');
  const waiting = tasks.findIndex(t => getEffectiveTaskStatus(t, tasks) === 'waiting');

  let text = '';
  if (dispatched !== -1) {
    const runningTime = tasks[dispatched].dispatchedAt ? formatDuration(Date.now() - tasks[dispatched].dispatchedAt) : '';
    text = `⏵ ${done}/${total} | #${dispatched + 1} ${runningTime}`;
  } else if (waiting !== -1) {
    text = `⏸ ${done}/${total} | #${waiting + 1} waiting`;
  } else if (done === total) {
    text = `✓ ${done}/${total} done`;
  } else {
    text = `${done}/${total}`;
  }

  progressSpan.textContent = text;
  progressSpan.style.display = 'inline';
}

/** 格式化时间间隔 */
function formatDuration(ms) {
  if (ms < 60000) return Math.floor(ms / 1000) + 's';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
  return Math.floor(ms / 3600000) + 'h' + Math.floor((ms % 3600000) / 60000) + 'm';
}

let configChangeDebounceTimer = null;

/** 配置变更后热更新入口（防抖包装） */
async function handleConfigChanged() {
  if (configChangeDebounceTimer) {
    clearTimeout(configChangeDebounceTimer);
  }
  configChangeDebounceTimer = setTimeout(async () => {
    await doHandleConfigChanged();
    configChangeDebounceTimer = null;
  }, 200);
}

/** 配置变更后热更新：动态调整布局与 pane */
async function doHandleConfigChanged() {
  log('收到配置变更，热更新...');
  const oldProjects = config.projects || [];
  await loadConfig();
  const newProjects = config.projects || [];

  // 同步或移除已有 pane：遍历 DOM 中所有 pane，按 id 解析索引，匹配新配置
  const panes = Array.from(grid.querySelectorAll('.pane'));
  panes.forEach(pane => {
    const idx = parseInt(pane.id.replace('pane-pty-', ''));
    if (Number.isNaN(idx)) return;

    const proj = newProjects[idx];
    // 项目不存在才删除 pane；header 缺失时不删除（保留终端内容）
    if (!proj) {
      pane.remove();
      return;
    }

    // header 缺失时记录日志并跳过同步，等待 ready 消息重建
    if (!pane.querySelector('.pane-header')) {
      log('pane header 缺失，跳过同步等待重建: ' + pane.id);
      return;
    }

    const nameText = pane.querySelector('.pane-name-text');
    const pathSpan = pane.querySelector('.pane-path');
    const indicator = pane.querySelector('.pane-indicator');

    if (nameText && nameText.textContent !== proj.name) {
      nameText.textContent = proj.name;
    }
    if (pathSpan) {
      pathSpan.textContent = proj.cwd;
      pathSpan.title = proj.cwd;
    }
    if (indicator) {
      indicator.style.background = proj.color || '#888';
    }
  });

  // 更新布局样式
  grid.style.gridTemplateRows = `repeat(${config.layout.rows}, 1fr)`;
  grid.style.gridTemplateColumns = `repeat(${config.layout.cols}, 1fr)`;

  // 重新渲染占位
  renderGridPlaceholders();

  // 关闭可能已失效的任务面板
  if (activeTaskProjectIndex !== null && activeTaskProjectIndex >= newProjects.length) {
    closeTaskPanel();
  }
}

function createTerminal(id, name, color, cwd, index) {
  log('创建终端: ' + id + ' 名称=' + name);

  // WebSocket 重连后复用旧 pane，避免 DOM 重复和终端内容丢失
  const existing = document.getElementById('pane-' + id);
  if (existing) {
    if (!existing.querySelector('.pane-header')) {
      log('终端已存在但 header 缺失，重建 header: ' + id);
      rebuildPaneHeader(existing, id, name, color, cwd, index);
    } else {
      log('终端已存在，复用旧 pane: ' + id);
      // 同步 header，防止配置变更后显示旧数据
      const nameText = existing.querySelector('.pane-name-text');
      const pathSpan = existing.querySelector('.pane-path');
      const indicator = existing.querySelector('.pane-indicator');
      if (nameText) nameText.textContent = name;
      if (pathSpan) {
        pathSpan.textContent = cwd;
        pathSpan.title = cwd;
      }
      if (indicator) indicator.style.background = color;
    }

    const wrap = document.getElementById('term-' + id);
    if (wrap && wrap._xterm) {
      wrap._xterm.focus();
      safeFitTerminal(wrap, 6);
    }
    return;
  }

  try {
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.id = 'pane-' + id;

    const header = document.createElement('div');
    header.className = 'pane-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'pane-name';
    nameSpan.innerHTML = `<span class="pane-indicator" style="background:${color}"></span><span class="pane-name-text">${escapeHtml(name)}</span>`;
    nameSpan.title = window.i18n.t('pane.renameTooltip');

    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const textEl = nameSpan.querySelector('.pane-name-text');
      if (!textEl) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pane-name-input';
      input.value = textEl.textContent;
      nameSpan.replaceChild(input, textEl);
      input.focus();
      input.select();

      function finishEdit() {
        const newName = input.value.trim() || name;
        const newSpan = document.createElement('span');
        newSpan.className = 'pane-name-text';
        newSpan.textContent = newName;
        nameSpan.replaceChild(newSpan, input);
        if (config && config.projects[index]) {
          config.projects[index].name = newName;
          fetch('/api/save-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
          }).catch(() => {});
        }
      }

      input.addEventListener('blur', finishEdit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        else if (ev.key === 'Escape') { input.value = name; input.blur(); }
      });
    });

    const pathSpan = document.createElement('span');
    pathSpan.className = 'pane-path';
    pathSpan.textContent = cwd;
    pathSpan.title = cwd;

    // 任务完成绿色对勾标记（默认隐藏）
    const doneBadge = document.createElement('span');
    doneBadge.className = 'pane-done-badge';
    doneBadge.textContent = '✓';
    doneBadge.title = window.i18n.t('pane.taskDone');
    doneBadge.style.display = 'none';

    // 任务按钮
    const taskBtn = document.createElement('button');
    taskBtn.className = 'btn-task';
    taskBtn.title = window.i18n.t('pane.tasks');
    taskBtn.textContent = window.i18n.t('pane.tasks');
    taskBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 从 DOM id 实时解析索引，避免闭包 index 在配置重排后漂移
      const currentIndex = parseInt(pane.id.replace('pane-pty-', ''));
      openTaskPanel(Number.isNaN(currentIndex) ? index : currentIndex);
    });

    header.appendChild(nameSpan);
    header.appendChild(pathSpan);
    header.appendChild(doneBadge);
    header.appendChild(taskBtn);

    const wrap = document.createElement('div');
    wrap.className = 'terminal-wrap';
    wrap.id = 'term-' + id;

    pane.appendChild(header);
    pane.appendChild(wrap);
    grid.appendChild(pane);

    const term = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: config.theme?.fontSize ? parseInt(config.theme.fontSize) : 11,
      theme: getTerminalTheme(currentTheme),
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: config.theme?.scrollback ? parseInt(config.theme.scrollback) : 1000,
    });

    // 选中文本后释放鼠标自动复制
    wrap.addEventListener('mouseup', () => {
      const selection = term.getSelection();
      if (selection && selection.length > 0) {
        copyToClipboard(selection);
      }
    });

    // 自定义键盘事件：选中文本时 Ctrl+C / Cmd+C 复制，否则保持终端默认行为（如 SIGINT）
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        const selection = term.getSelection();
        if (selection && selection.length > 0) {
          copyToClipboard(selection);
          return false; // 阻止 xterm 将 Ctrl+C 发送给 PTY
        }
      }
      return true;
    });

    term.open(wrap);
    wrap._xterm = term;

    // flush 重连前缓存的历史输出
    const queue = pendingOutput.get(id);
    if (queue && queue.length > 0) {
      log('flush 缓存输出: ' + id + ' (' + queue.length + ' 块)');
      queue.forEach(data => term.write(data));
      pendingOutput.delete(id);
    }

    // 使用全局 ws 变量，WebSocket 重连后无需重新绑定
    term.onData((data) => {
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'input', id, data }));
      }
      // 如果该项目有任务处于 waiting 状态，用户输入视为恢复信号
      const projectIndex = parseInt(id.replace('pty-', ''));
      if (!Number.isNaN(projectIndex)) {
        const proj = config.projects[projectIndex];
        if (proj && proj.tasks) {
          const waitingIdx = proj.tasks.findIndex(t => getTaskStatus(t) === 'waiting');
          if (waitingIdx !== -1) {
            resumeWaitingTask(projectIndex, waitingIdx);
          }
        }
      }
    });

    pane.addEventListener('click', () => {
      // 先移除其他 pane 的 active 状态，再 blur 其他 xterm，避免输入串窗口
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      pane.classList.add('active');
      const termTheme = getTerminalTheme(currentTheme);
      document.querySelectorAll('.terminal-wrap').forEach(otherWrap => {
        if (otherWrap !== wrap && otherWrap._xterm) {
          try { otherWrap._xterm.blur(); } catch (e) {}
          otherWrap.classList.remove('focused');
          const bg = termTheme.background || '#000000';
          otherWrap._xterm.options.theme = { ...otherWrap._xterm.options.theme, cursor: bg, cursorAccent: bg };
        }
      });
      wrap.classList.add('focused');
      term.focus();
      term.options.theme = { ...term.options.theme, cursor: termTheme.cursor, cursorAccent: termTheme.cursorAccent };
    });

    // 焦点管理：仅当前聚焦的 xterm 显示焦点边框与光标
    // xterm.js v5 不支持 onFocus/onBlur，使用 DOM 事件替代
    wrap.addEventListener('focusin', () => {
      document.querySelectorAll('.terminal-wrap').forEach(w => w.classList.remove('focused'));
      wrap.classList.add('focused');
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      pane.classList.add('active');
      const termTheme = getTerminalTheme(currentTheme);
      term.options.theme = { ...term.options.theme, cursor: termTheme.cursor, cursorAccent: termTheme.cursorAccent };
    });
    wrap.addEventListener('focusout', () => {
      wrap.classList.remove('focused');
      const termTheme = getTerminalTheme(currentTheme);
      const bg = termTheme.background || '#000000';
      term.options.theme = { ...term.options.theme, cursor: bg, cursorAccent: bg };
    });

    const FitAddonCtor = (typeof FitAddon === 'function' ? FitAddon : (FitAddon && FitAddon.FitAddon));
    const fitAddon = FitAddonCtor ? new FitAddonCtor() : null;
    if (fitAddon) {
      term.loadAddon(fitAddon);
      term.fitAddon = fitAddon;
    }

    requestAnimationFrame(() => {
      safeFitTerminal(wrap, 6);
      term.focus();
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => requestAnimationFrame(() => fitTerminalWrap(wrap, true)));
      ro.observe(wrap);
    }

  } catch (e) {
    log('创建终端失败: ' + e.message);
    console.error(e);
  }

  renderGridPlaceholders();
}

/** 根据布局容量和已有 pane 数量，渲染空位占位按钮 */
function renderGridPlaceholders() {
  if (!config || !config.layout) return;
  grid.querySelectorAll('.pane-placeholder').forEach(el => el.remove());

  const totalSlots = config.layout.rows * config.layout.cols;
  const panes = grid.querySelectorAll('.pane');
  const placeholdersNeeded = Math.max(0, totalSlots - panes.length);

  for (let i = 0; i < placeholdersNeeded; i++) {
    const el = document.createElement('div');
    el.className = 'pane-placeholder';
    el.innerHTML = `
      <div class="placeholder-inner">
        <span class="placeholder-icon">+</span>
        <span class="placeholder-text">添加项目</span>
      </div>
    `;
    el.addEventListener('click', () => {
      window.location.href = '/';
    });
    grid.appendChild(el);
  }
  // 占位元素增删会改变 grid 布局，重新 fit 所有终端以避免列宽计算错误
  fitAllTerminals();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (e) {
    console.warn('Clipboard API failed, fallback to execCommand:', e.message);
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  } catch (e) {
    console.error('Copy failed:', e.message);
  }
}

/** 根据背景色自动返回黑/白文字色，确保可读性 */
function getContrastColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // 计算感知亮度（ITU-R BT.709）
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

function getContrastColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // 计算感知亮度（ITU-R BT.709）
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

/** fit 所有已存在的终端 */
function fitTerminalWrap(wrap, sendResize = true) {
  const term = wrap && wrap._xterm;
  if (!term || !term.fitAddon || typeof term.fitAddon.fit !== 'function') return false;
  const rect = wrap.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return false;
  try {
    const prevCols = term.cols;
    term.fitAddon.fit();
    if (sendResize && ws && ws.readyState === ws.OPEN) {
      const id = wrap.id.replace('term-', '');
      ws.send(JSON.stringify({ type: 'resize', id, cols: term.cols, rows: term.rows }));
    }
    return true;
  } catch (e) {
    log('Fit 错误: ' + e.message);
    return false;
  }
}

/** 在容器尺寸稳定前多次尝试 fit，避免初始化时因布局未就绪导致 cols 计算错误 */
function safeFitTerminal(wrap, maxRetries = 6) {
  let okCount = 0;
  let failCount = 0;
  function attempt() {
    if (fitTerminalWrap(wrap, true)) {
      okCount++;
      if (okCount < maxRetries) setTimeout(attempt, 200);
    } else {
      failCount++;
      if (failCount < maxRetries) setTimeout(attempt, 200);
    }
  }
  attempt();
}

/** fit 所有已存在的终端 */
function fitAllTerminals() {
  document.querySelectorAll('.terminal-wrap').forEach(wrap => safeFitTerminal(wrap, 4));
}

window.addEventListener('resize', () => {
  clearTimeout(window._resizeFitTimer);
  window._resizeFitTimer = setTimeout(fitAllTerminals, 200);
});

/* ========== 配额状态栏 ========== */

function startQuotaUpdates() {
  fetchQuota();
  if (quotaFetchTimer) clearInterval(quotaFetchTimer);
  quotaFetchTimer = setInterval(fetchQuota, 15_000); // 每 15 秒刷新一次（服务端有 10 秒缓存）
}

async function fetchQuota() {
  try {
    const res = await fetch('/api/quota');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quotaData = await res.json();
    renderQuotaBar();
  } catch (e) {
    log('Quota fetch failed: ' + e.message);
    if (!quotaData) {
      quotaData = { ok: false, error: e.message };
      renderQuotaBar();
    }
  }
}

function formatResetTime(timestamp) {
  if (!timestamp) return '--:--';
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return isToday ? `${hh}:${mm}` : `${month}-${day} ${hh}:${mm}`;
}

function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return '--';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}时${String(minutes).padStart(2, '0')}分`;
  if (minutes > 0) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

function buildProgressBar(percent, total = 10) {
  const filled = Math.max(0, Math.min(total, Math.round((percent || 0) / 100 * total)));
  const empty = total - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getProgressLevel(percent) {
  if (percent === null || percent === undefined) return '';
  if (percent >= 80) return 'high';
  if (percent >= 50) return 'mid';
  return 'low';
}

function renderQuotaBar() {
  if (!quotaBar) return;
  if (!quotaData) {
    quotaBar.innerHTML = `<span class="quota-loading" data-i18n="quota.loading">Loading quota…</span>`;
    return;
  }
  if (!quotaData.ok && !quotaData.totalQuota) {
    quotaBar.innerHTML = `<span class="quota-error" title="${escapeHtml(quotaData.error || 'Unknown error')}" data-i18n="quota.unavailable">Quota unavailable</span>`;
    return;
  }

  const total = quotaData.totalQuota || {};
  const win = quotaData.window || {};
  const parallel = quotaData.parallel || { limit: 20, used: 0 };
  const resetAt = quotaData.resetAt;
  const resetIn = quotaData.resetInSeconds;

  const totalPct = total.percent ?? 0;
  const winPct = win.percent ?? 0;
  const totalBars = buildProgressBar(totalPct, 10);
  const winBars = buildProgressBar(winPct, 10);

  const resetTimeStr = formatResetTime(resetAt);
  const resetInStr = formatDuration(resetIn);

  const tTotal = window.i18n.t('quota.total');
  const tWindow = window.i18n.t('quota.window');
  const tParallel = window.i18n.t('quota.parallel');
  const tReset = window.i18n.t('quota.reset');
  const tRemaining = window.i18n.t('quota.remaining');
  const tNotAvailable = window.i18n.t('quota.notAvailable');

  const fmtQuotaLine = (label, used, limit, pct) =>
    (used == null || limit == null)
      ? `${label}: ${tNotAvailable}`
      : `${label}: ${used} / ${limit} (${pct}%)`;

  const tooltipLines = [
    fmtQuotaLine(tTotal, total.used, total.limit, totalPct),
    fmtQuotaLine(tWindow, win.used, win.limit, winPct),
    `${tParallel}: ${parallel.used ?? 0} / ${parallel.limit ?? 20}`,
    `${tReset}: ${resetAt ? new Date(resetAt).toLocaleString() : tNotAvailable}`,
    `${tRemaining}: ${resetInStr}`,
  ];
  const tooltip = tooltipLines.join('\n');

  const windowTooltip = (win.used != null && win.limit != null)
    ? `${tWindow}: ${win.used}/${win.limit} (${winPct}%)\n${escapeHtml(winBars)}`
    : `${tWindow}: ${tNotAvailable}`;

  // 明细面板 HTML
  const detailHtml = `
    <div class="quota-detail-row"><span class="quota-detail-key">${tTotal}</span><span class="quota-detail-value">${total.used ?? '-'}/${total.limit ?? '-'} (${totalPct}%)</span></div>
    <div class="quota-detail-row"><span class="quota-detail-key">${tWindow}</span><span class="quota-detail-value">${win.used ?? '-'}/${win.limit ?? '-'} (${winPct}%)</span></div>
    <div class="quota-detail-row"><span class="quota-detail-key">${tParallel}</span><span class="quota-detail-value">${parallel.used ?? 0}/${parallel.limit ?? 20}</span></div>
    <div class="quota-detail-row"><span class="quota-detail-key">${tReset}</span><span class="quota-detail-value reset">${resetAt ? new Date(resetAt).toLocaleString() : '-'}</span></div>
    <div class="quota-detail-row"><span class="quota-detail-key">${tRemaining}</span><span class="quota-detail-value">${resetInStr}</span></div>
    ${config?.ai?.provider === 'kimi' ? `<div class="quota-detail-row"><span class="quota-detail-key">Provider</span><span class="quota-detail-value">Kimi (Moonshot)</span></div>` : ''}
  `;

  quotaBar.innerHTML = `
    <span class="quota-group quota-tooltip quota-group-required" data-tooltip="${escapeHtml(tooltip)}">
      <span class="quota-label">${tTotal}</span>
      <span class="quota-progress">
        <span class="quota-bars ${getProgressLevel(totalPct)}">${totalBars}</span>
        <span class="quota-value">${totalPct}%</span>
      </span>
    </span>
    <span class="quota-group quota-tooltip" data-tooltip="${escapeHtml(windowTooltip)}">
      <span class="quota-label">${tWindow}</span>
      <span class="quota-progress">
        <span class="quota-bars ${getProgressLevel(winPct)}">${winBars}</span>
        <span class="quota-value">${winPct}%</span>
      </span>
    </span>
    <span class="quota-group quota-reset quota-tooltip quota-group-required" data-tooltip="${tReset}: ${escapeHtml(resetTimeStr)}\n${tRemaining}: ${escapeHtml(resetInStr)}">
      <span class="quota-label">${tReset}</span>
      <span class="quota-reset-time">${escapeHtml(resetTimeStr)}</span>
      <span class="quota-reset-in">(${escapeHtml(resetInStr)})</span>
    </span>
    <span class="quota-group quota-tooltip" data-tooltip="${tParallel}: ${parallel.used ?? 0}/${parallel.limit ?? 20}">
      <span class="quota-label">${tParallel}</span>
      <span class="quota-value">${parallel.used ?? 0}/${parallel.limit ?? 20}</span>
    </span>
    <button class="quota-detail-btn" id="quotaDetailBtn" title="显示明细">⋯</button>
  `;

  // 明细面板
  if (!quotaDetailPanel) {
    quotaDetailPanel = document.createElement('div');
    quotaDetailPanel.className = 'quota-detail-panel';
    document.body.appendChild(quotaDetailPanel);
  }
  quotaDetailPanel.innerHTML = detailHtml;

  const btn = document.getElementById('quotaDetailBtn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      quotaDetailPanel.classList.toggle('show');
    });
  }

  updateQuotaBarMode();
}

function updateQuotaBarMode() {
  if (!quotaBar) return;
  const width = quotaBar.clientWidth;
  let mode = 'full';
  if (width < 320) mode = 'mini';
  else if (width < 540) mode = 'compact';
  quotaBar.dataset.mode = mode;
}

function initQuotaResponsive() {
  if (!quotaBar) return;
  updateQuotaBarMode();
  if (typeof ResizeObserver !== 'undefined') {
    quotaResizeObserver = new ResizeObserver(() => updateQuotaBarMode());
    quotaResizeObserver.observe(quotaBar);
  }
}

/** 更新指定 pane 的上下文/窗口徽章 */
function updatePaneContextBadge(index, ctxInfo) {
  const pane = document.getElementById('pane-pty-' + index);
  if (!pane) return;
  let badge = pane.querySelector('.pane-context-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'pane-context-badge';
    const header = pane.querySelector('.pane-header');
    const pathSpan = header?.querySelector('.pane-path');
    if (header && pathSpan) {
      header.insertBefore(badge, pathSpan);
    } else if (header) {
      header.appendChild(badge);
    }
  }

  const percent = ctxInfo?.percent ?? 0;
  const tokens = ctxInfo?.tokens ?? 0;
  const type = ctxInfo?.type || 'context';
  const label = type === 'context' ? 'Ctx' : 'Win';
  const labelTitle = type === 'context' ? '上下文' : '窗口配额';
  let level = 'low';
  if (percent >= 80) level = 'high';
  else if (percent >= 50) level = 'mid';
  badge.dataset.level = level;
  badge.title = `${labelTitle}: ${percent}%${tokens ? ` (${tokens}k tokens)` : ''}`;
  badge.innerHTML = `<span class="ctx-label">${label}</span><span>${percent}%</span><span style="opacity:.7">${tokens ? ` ${tokens}k` : ''}</span>`;
}

/* ========== 任务面板 ========== */

const btnRunAll = document.getElementById('btnRunAll');
const btnStopLoop = document.getElementById('btnStopLoop');
const loopStatus = document.getElementById('loopStatus');

let runningTaskId = null; // 当前正在执行的任务标识，格式 "projectIndex-taskIndex"
let loopAdvanceLocks = new Map(); // projectIndex -> boolean，防止 triggerLoopNext 并发

// 配额状态
let quotaData = null;              // 最近一次 /api/quota 返回的数据
let quotaFetchTimer = null;        // 定时刷新 timer
let quotaDetailPanel = null;       // 明细面板 DOM
let quotaResizeObserver = null;    // 响应式宽度监听

// pane 级上下文用量（projectIndex -> { percent, tokens }）
const paneContextMap = new Map();

function openTaskPanel(projectIndex) {
  activeTaskProjectIndex = projectIndex;
  const proj = config.projects[projectIndex];

  // 根据任务所在列决定面板从哪侧滑出：
  // 左半部分（不含正中间）从右滑出，右半部分（含正中间）从左滑出
  const cols = config.layout?.cols || 3;
  const col = projectIndex % cols;
  const isLeftHalf = col < Math.floor(cols / 2);
  taskPanel.classList.remove('from-left', 'from-right');
  if (isLeftHalf) {
    taskPanel.classList.add('from-right');
  } else {
    taskPanel.classList.add('from-left');
  }

  if (taskPanelTitle) taskPanelTitle.textContent = (proj?.name || 'Project') + ' ' + window.i18n.t('pane.tasks');
  taskLoopToggle.checked = !!(proj?.loopAutoReset);
  updateLoopUI();
  // 先启动面板动画，避免 renderTaskList() 的繁重 DOM 操作阻塞 transform 过渡首帧
  taskOverlay.classList.add('show');
  taskPanel.classList.add('show');
  // 在下一帧再填充任务列表，保证滑入动画流畅
  requestAnimationFrame(() => requestAnimationFrame(() => renderTaskList()));
}

function closeTaskPanel() {
  taskOverlay.classList.remove('show');
  taskPanel.classList.remove('show');
  activeTaskProjectIndex = null;
}

taskOverlay.addEventListener('click', closeTaskPanel);
taskPanelClose.addEventListener('click', closeTaskPanel);

/* ========== 面板拖拽调整宽度 ========== */

(function initPanelResizer() {
  if (!taskPanelResizer || !taskPanel) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  taskPanelResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = taskPanel.offsetWidth;
    taskPanelResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const isFromRight = taskPanel.classList.contains('from-right');
    const dx = isFromRight ? (startX - e.clientX) : (e.clientX - startX);
    const newWidth = Math.min(Math.max(startWidth + dx, 320), 800);
    taskPanel.style.width = newWidth + 'px';
    taskPanel.style.transition = 'none';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    taskPanelResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    taskPanel.style.transition = '';
  });
})();

const reviewTimers = new Map(); // taskId -> timer

function renderTaskAttachmentsHtml(task) {
  if (!task.attachments || task.attachments.length === 0) return '';
  const list = task.attachments.map((att, i) => {
    if (att.kind === 'image' && att.data) {
      return `<div class="task-att-item" title="${escapeHtml(att.name)}">
        <img src="${att.data}" class="task-att-thumb" alt="">
        <span class="task-att-label">${escapeHtml(truncateName(att.name))}</span>
      </div>`;
    } else {
      const icon = att.kind === 'text' ? '📄' : '📦';
      return `<div class="task-att-item" title="${escapeHtml(att.name)}">
        <span class="task-att-icon">${icon}</span>
        <span class="task-att-label">${escapeHtml(truncateName(att.name))}</span>
      </div>`;
    }
  }).join('');
  return `<div class="task-attachments">${list}</div>`;
}

function truncateName(name, max = 20) {
  if (name.length <= max) return name;
  return name.slice(0, 10) + '…' + name.slice(-7);
}

function getTaskStatus(task) {
  // 兼容旧数据：旧 running/executing/testing/review → dispatched（重新进入自动验证）
  const s = task.status;
  if (s === 'running' || s === 'executing' || s === 'testing' || s === 'review') return 'dispatched';
  if (s === 'todo') return 'idle';
  if (s === 'waiting') return 'waiting';
  if (s === 'blocked') return 'blocked';
  if (s) return s;
  if (task.done) return 'done';
  return 'idle';
}

/** 考虑依赖关系后的实际状态 */
function getEffectiveTaskStatus(task, allTasks) {
  const base = getTaskStatus(task);
  if (base === 'done') return 'done';
  if (!allTasks || !task.blockedBy || !Array.isArray(task.blockedBy) || task.blockedBy.length === 0) return base;
  const blocked = task.blockedBy.some(depIdx => {
    const dep = allTasks[depIdx];
    if (!dep) return true;
    return getEffectiveTaskStatus(dep, allTasks) !== 'done';
  });
  return blocked ? 'blocked' : base;
}

function formatTaskTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${M}-${D} ${h}:${m}`;
}

function formatTaskDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

let taskGroupCollapsed = new Map(); // date -> boolean

function renderTaskItem(task, idx, container = taskListEl) {
  const allTasks = activeTaskProjectIndex !== null ? config.projects[activeTaskProjectIndex].tasks : [];
  const status = getEffectiveTaskStatus(task, allTasks);
  const taskId = `${activeTaskProjectIndex}-${idx}`;
  const projectName = activeTaskProjectIndex !== null ? (config.projects[activeTaskProjectIndex]?.name || '') : '';

  // 识别系统生成的任务（自动修复 / AI 建议的下一步）
  const isAutoFix = !!task.isAutoFix;
  const isAiSuggested = !isAutoFix && task.parentTaskIndex !== undefined;
  const isSystemTask = isAutoFix || isAiSuggested;

  const item = document.createElement('div');
  item.className = `task-item ${status}${isSystemTask ? ' system-task' : ''}`;
  item.dataset.index = idx;
  item.draggable = true;
  item.title = window.i18n.t('taskPanel.dragToReorder');

  const timeStr = formatTaskTime(task.createdAt || task.dispatchedAt);
  
  // 计算任务运行时长
  let durationStr = '';
  if (task.dispatchedAt && (task.doneAt || task.testedAt)) {
    const endTime = task.doneAt || task.testedAt;
    durationStr = formatDuration(endTime - task.dispatchedAt);
  } else if (task.dispatchedAt && status === 'dispatched') {
    durationStr = formatDuration(Date.now() - task.dispatchedAt);
  }
  
  // 构建任务类型标签
  const typeLabels = {
    code: '💻',
    ui: '🎨',
    test: '🧪',
    research: '📚',
    consult: '💬',
    action: '⚡',
  };
  const typeLabel = task.type ? (typeLabels[task.type] || '⚡') : '';
  
  // 构建自动修复次数标签
  const fixBadge = task.autoFixCount ? `<span class="task-fix-badge" title="Auto-fixed ${task.autoFixCount} times">🔧${task.autoFixCount}</span>` : '';

  const statusLabels = {
    idle: '',
    dispatched: window.i18n.t('taskPanel.status.dispatched'),
    waiting: window.i18n.t('taskPanel.status.waiting'),
    blocked: window.i18n.t('taskPanel.status.blocked'),
    done: window.i18n.t('taskPanel.status.done'),
  };
  const statusBadgeHtml = status !== 'idle'
    ? `<span class="task-status-badge ${status}">${statusLabels[status]}</span>`
    : '';

  let actionsHtml = '';
  if (status === 'idle') {
    actionsHtml = `
      <button class="task-exec" title="${window.i18n.t('taskPanel.dispatch')}">📤 ${window.i18n.t('taskPanel.dispatch')}</button>
      <button class="task-del" title="${window.i18n.t('common.delete')}">${window.i18n.t('common.delete')}</button>
    `;
  } else if (status === 'dispatched') {
    actionsHtml = `
      <button class="task-del" title="${window.i18n.t('common.delete')}">${window.i18n.t('common.delete')}</button>
    `;
  } else if (status === 'waiting') {
    actionsHtml = `
      <button class="task-resume" title="${window.i18n.t('taskPanel.resume')}">▶ ${window.i18n.t('taskPanel.resume')}</button>
      <button class="task-del" title="${window.i18n.t('common.delete')}">${window.i18n.t('common.delete')}</button>
    `;
  } else if (status === 'blocked') {
    const deps = (task.blockedBy || []).map(i => `#${i + 1}`).join(', ');
    const dependsOn = window.i18n.t('taskPanel.dependsOn');
    actionsHtml = `
      <span class="task-blocked-hint" title="${dependsOn} ${deps}">🔒 ${dependsOn} ${deps}</span>
      <button class="task-del" title="${window.i18n.t('common.delete')}">${window.i18n.t('common.delete')}</button>
    `;
  } else if (status === 'done') {
    actionsHtml = `
      <button class="task-history" title="${window.i18n.t('taskPanel.history')}">📜 ${window.i18n.t('taskPanel.history')}</button>
      ${task.outputSnapshot ? `<button class="task-view-output" title="${window.i18n.t('taskPanel.output')}">👁 ${window.i18n.t('taskPanel.output')}</button>` : ''}
      <button class="task-del" title="${window.i18n.t('common.delete')}">${window.i18n.t('common.delete')}</button>
    `;
  }

  const costBadgeHtml = (status === 'done' && typeof task.cost === 'number')
    ? `<span class="task-cost-badge" title="Model: ${escapeHtml(task.costModel || 'unknown')}\nInput: ${(task.tokens?.input || 0).toLocaleString()}\nOutput: ${(task.tokens?.output || 0).toLocaleString()}">${formatCost(task.cost)}</span>`
    : '';

  const attHtml = renderTaskAttachmentsHtml(task);
  const noteHtml = task.verificationNote
    ? `<div class="task-note">${escapeHtml(task.verificationNote)}</div>`
    : '';
  const snapshotHtml = task.outputSnapshot
    ? `<div class="task-output-snapshot" style="display:none"><pre>${escapeHtml(task.outputSnapshot)}</pre></div>`
    : '';
  const durationHtml = durationStr ? `<span class="task-duration" title="Running time">⏱ ${durationStr}</span>` : '';
  const typeHtml = typeLabel ? `<span class="task-type-label" title="Task type: ${task.type}">${typeLabel}</span>` : '';

  // 系统生成任务徽章
  let systemBadgeHtml = '';
  if (isSystemTask) {
    const badgeClass = isAutoFix ? 'auto-fix' : 'ai-suggested';
    const badgeText = isAutoFix
      ? window.i18n.t('taskPanel.autoFix')
      : window.i18n.t('taskPanel.aiSuggested');
    const parentIndex = task.parentTaskIndex !== undefined ? task.parentTaskIndex + 1 : '';
    const title = parentIndex
      ? `${badgeText} · ${window.i18n.t('taskPanel.generatedFrom', { index: parentIndex })}`
      : badgeText;
    systemBadgeHtml = `<span class="task-system-badge ${badgeClass}" title="${escapeHtml(title)}">🤖 ${escapeHtml(badgeText)}</span>`;
  }

  item.innerHTML = `
    <div class="task-info">
      <div class="task-meta">
        <span class="task-num">#${idx + 1}</span>
        ${projectName ? `<span class="task-project-name">${escapeHtml(projectName)}</span>` : ''}
        ${systemBadgeHtml}
        <span class="task-time">${timeStr}</span>
        ${typeHtml}
        ${statusBadgeHtml}
        ${costBadgeHtml}
        ${fixBadge}
        ${durationHtml}
      </div>
      <div class="task-text">${escapeHtml(task.text)}</div>
      ${task.command ? `<div class="task-cmd">${escapeHtml(task.command)}</div>` : ''}
      ${noteHtml}
      ${attHtml}
      ${snapshotHtml}
    </div>
    <div class="task-actions">${actionsHtml}</div>
  `;

  const viewOutputBtn = item.querySelector('.task-view-output');
  if (viewOutputBtn) {
    viewOutputBtn.addEventListener('click', () => {
      const snap = item.querySelector('.task-output-snapshot');
      if (snap) {
        const showing = snap.style.display === 'block';
        snap.style.display = showing ? 'none' : 'block';
        viewOutputBtn.textContent = showing ? `👁 ${window.i18n.t('taskPanel.output')}` : `👁 ${window.i18n.t('taskPanel.collapse')}`;
      }
    });
  }

  const execBtn = item.querySelector('.task-exec');
  if (execBtn) {
    execBtn.addEventListener('click', async () => { await dispatchTask(activeTaskProjectIndex, idx); });
  }

  const resumeBtn = item.querySelector('.task-resume');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => { resumeWaitingTask(activeTaskProjectIndex, idx); });
  }

  const delBtn = item.querySelector('.task-del');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      if (runningTaskId === taskId) {
        alert(window.i18n.t('taskPanel.deleteRunning'));
        return;
      }
      clearReviewTimer(taskId);
      const allTasks = config.projects[activeTaskProjectIndex].tasks;
      allTasks.splice(idx, 1);
      renderTaskList();
      saveTasks();
    });
  }

  const historyBtn = item.querySelector('.task-history');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => openTaskHistoryModal(activeTaskProjectIndex, idx));
  }

  // 拖拽排序
  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.task-item').forEach(el => el.classList.remove('drag-over'));
  });
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.classList.remove('drag-over');
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(fromIdx) || fromIdx === idx) return;
    moveTask(activeTaskProjectIndex, fromIdx, idx);
  });

  container.appendChild(item);
}

function renderTaskList() {
  if (activeTaskProjectIndex === null) return;
  const proj = config.projects[activeTaskProjectIndex];
  const tasks = proj.tasks || [];

  taskListEl.innerHTML = '';
  if (tasks.length === 0) {
    taskListEl.innerHTML = `<div style="color:var(--vs-text-muted); font-size:12px; text-align:center; padding:16px;" data-i18n="taskPanel.noTasks">${window.i18n.t('taskPanel.noTasks')}</div>`;
    return;
  }

  let allDone = true;
  const pendingTasks = [];
  const doneTasks = [];

  tasks.forEach((task, idx) => {
    const status = getEffectiveTaskStatus(task, tasks);
    if (status === 'done') {
      doneTasks.push({ task, idx });
    } else {
      pendingTasks.push({ task, idx });
      allDone = false;
    }
  });

  // 渲染未完成任务（直接展开，不折叠）
  pendingTasks.forEach(({ task, idx }) => renderTaskItem(task, idx));

  // 按日期分组渲染已完成任务（默认折叠）
  if (doneTasks.length > 0) {
    const groups = new Map();
    doneTasks.forEach(({ task, idx }) => {
      const date = formatTaskDate(task.createdAt || task.dispatchedAt || Date.now());
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push({ task, idx });
    });

    const sortedDates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach(date => {
      const items = groups.get(date);
      const isExpanded = taskGroupCollapsed.get(date) === true;

      const groupEl = document.createElement('div');
      groupEl.className = `task-group ${isExpanded ? 'expanded' : ''}`;

      const header = document.createElement('div');
      header.className = 'task-group-header';
      header.innerHTML = `
        <span class="task-group-toggle">▶</span>
        <span class="task-group-date">${date}</span>
        <span class="task-group-count">${items.length}</span>
      `;
      header.addEventListener('click', () => {
        const expanded = groupEl.classList.toggle('expanded');
        taskGroupCollapsed.set(date, expanded);
      });

      const body = document.createElement('div');
      body.className = 'task-group-body';
      items.forEach(({ task, idx }) => renderTaskItem(task, idx, body));

      groupEl.appendChild(header);
      groupEl.appendChild(body);
      taskListEl.appendChild(groupEl);
    });
  }
}

function clearReviewTimer(taskId) {
  const timer = reviewTimers.get(taskId);
  if (timer) { clearTimeout(timer); reviewTimers.delete(taskId); }
}

/* ========== 附件处理 ========== */

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_TEXT_LENGTH = 600; // 超过此长度的文本自动转为文件附件

function isImageFile(file) {
  return file.type.startsWith('image/');
}

function isTextFile(file) {
  const textExts = ['.txt','.md','.json','.js','.ts','.html','.css','.py','.java','.c','.cpp','.go','.rs','.xml','.yaml','.yml','.sql','.sh','.ps1','.bat','.cmd','.vue','.jsx','.tsx','.php','.rb'];
  const name = file.name.toLowerCase();
  return textExts.some(ext => name.endsWith(ext));
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** 将超长文本转换为虚拟文件附件，清空输入框 */
function convertTextToAttachment(text) {
  if (!text || text.length <= MAX_TEXT_LENGTH) return;

  const blob = new Blob([text], { type: 'text/plain' });
  const att = {
    name: 'task-description.txt',
    size: blob.size,
    type: 'text/plain',
    kind: 'text',
    content: text,
    isVirtualText: true,
  };

  selectedAttachments.push(att);
  if (taskTextInput) taskTextInput.value = '';
  renderAttachmentPreview();
}

async function addAttachment(file) {
  if (file.size > MAX_FILE_SIZE) {
    alert(`File "${file.name}" is too large (${(file.size/1024/1024).toFixed(1)}MB), please keep it under 2MB`);
    return;
  }
  if (selectedAttachments.length >= 5) {
    alert('Maximum 5 attachments allowed');
    return;
  }

  const att = {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
  };

  if (isImageFile(file)) {
    att.data = await readFileAsDataURL(file);
    att.kind = 'image';
  } else if (isTextFile(file)) {
    att.content = await readFileAsText(file);
    att.kind = 'text';
  } else {
    att.kind = 'binary';
    att.data = await readFileAsDataURL(file);
  }

  selectedAttachments.push(att);
  renderAttachmentPreview();
}

function removeAttachment(idx) {
  const att = selectedAttachments[idx];
  if (att && att.isVirtualText && taskTextInput) {
    taskTextInput.value = att.content;
  }
  selectedAttachments.splice(idx, 1);
  renderAttachmentPreview();
}

function renderAttachmentPreview() {
  taskAttachmentsPreview.innerHTML = '';
  if (selectedAttachments.length === 0) {
    taskAttachmentsPreview.style.display = 'none';
    return;
  }
  taskAttachmentsPreview.style.display = 'flex';

  selectedAttachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';

    if (att.isVirtualText) {
      chip.classList.add('attach-virtual-text');
      chip.innerHTML = `
        <span class="attach-icon" style="color:#58a6ff;">📝</span>
        <span class="attach-name" title="Long text converted to file, click × to restore to input">${escapeHtml(att.name)}</span>
        <button class="attach-del" title="Remove and restore text">×</button>
      `;
    } else if (att.kind === 'image' && att.data) {
      chip.innerHTML = `
        <img src="${att.data}" class="attach-thumb" alt="">
        <span class="attach-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <button class="attach-del" title="Remove">×</button>
      `;
    } else if (att.kind === 'text') {
      chip.innerHTML = `
        <span class="attach-icon">📄</span>
        <span class="attach-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <button class="attach-del" title="Remove">×</button>
      `;
    } else {
      chip.innerHTML = `
        <span class="attach-icon">📦</span>
        <span class="attach-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <button class="attach-del" title="Remove">×</button>
      `;
    }

    chip.querySelector('.attach-del').addEventListener('click', () => removeAttachment(idx));
    taskAttachmentsPreview.appendChild(chip);
  });
}

function clearAttachments() {
  selectedAttachments = [];
  renderAttachmentPreview();
}

if (btnAttach) {
  btnAttach.addEventListener('click', () => {
    if (taskFileInput) taskFileInput.click();
  });
}

if (taskFileInput) {
  taskFileInput.addEventListener('change', async () => {
    const files = Array.from(taskFileInput.files);
    for (const file of files) {
      await addAttachment(file);
    }
    taskFileInput.value = '';
  });
}

// 输入框粘贴支持：图片直接加附件，长文本自动转文件
taskTextInput.addEventListener('paste', async (e) => {
  const clipboardData = e.clipboardData;
  if (!clipboardData) return;

  const items = Array.from(clipboardData.items);

  // 优先处理图片文件粘贴
  const imageItems = items.filter(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (imageItems.length > 0) {
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) await addAttachment(file);
    }
    return;
  }

  // 处理长文本粘贴（超过阈值自动转文件，不在输入框显示）
  const text = clipboardData.getData('text/plain');
  if (text && text.length > MAX_TEXT_LENGTH) {
    e.preventDefault();
    convertTextToAttachment(text);
  }
});

// 任务模板按钮：点击填充输入框并触发添加
const taskTemplatesEl = document.getElementById('taskTemplates');
if (taskTemplatesEl) {
  taskTemplatesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-template-btn');
    if (!btn) return;
    const text = btn.dataset.text;
    if (!text) return;
    taskTextInput.value = text;
    btnTaskAdd.click();
  });
}

btnTaskAdd.addEventListener('click', () => {
  if (activeTaskProjectIndex === null) return;
  let text = taskTextInput.value.trim();

  // 如果输入框中剩余文本过长，自动转文件附件
  if (text && text.length > MAX_TEXT_LENGTH) {
    convertTextToAttachment(text);
    text = '';
  }

  if (!text && selectedAttachments.length === 0) { alert(window.i18n.t('taskPanel.emptyTask')); return; }

  const proj = config.projects[activeTaskProjectIndex];
  if (!proj.tasks) proj.tasks = [];

  // 如果有虚拟文本附件，用其内容前50字作为任务列表中的摘要显示
  const virtualTextAtt = selectedAttachments.find(a => a.isVirtualText);
  const displayText = text || (virtualTextAtt ? virtualTextAtt.content.slice(0, 50).trim() + (virtualTextAtt.content.length > 50 ? '...' : '') : '(附件任务)');

  const task = {
    text: displayText,
    status: 'idle',
    createdAt: Date.now(),
    type: inferTaskType(displayText),
  };
  if (selectedAttachments.length > 0) {
    task.attachments = selectedAttachments.map(a => ({ ...a }));
  }

  proj.tasks.push(task);

  taskTextInput.value = '';
  clearAttachments();
  renderTaskList();
  saveTasks();
});

// 保存状态控制：避免并发重复保存，支持失败重试
let saveTasksPromise = null;
let pendingSave = false;

async function saveTasks() {
  if (!config) return;

  // 如果正在保存，标记为有待保存的最新状态
  if (saveTasksPromise) {
    pendingSave = true;
    return;
  }

  const doSave = async (attempt = 1) => {
    try {
      const res = await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${msg ? ': ' + msg : ''}`);
      }
      if (statusText && statusText.textContent.startsWith(window.i18n.t('taskPanel.saveFailedRetry', { attempt: 1 }).split('{{')[0])) {
        statusText.textContent = window.i18n.t('header.connected');
      }
      pendingSave = false;
      log('Tasks saved');
    } catch (err) {
      log(`Tasks save failed (attempt ${attempt}/3): ${err.message}`);
      if (statusText) statusText.textContent = window.i18n.t('taskPanel.saveFailedRetry', { attempt });
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return doSave(attempt + 1);
      }
      if (statusText) statusText.textContent = window.i18n.t('taskPanel.saveFailed');
      console.error('[VibeSpace] Tasks save failed', err);
    }
  };

  saveTasksPromise = doSave();
  await saveTasksPromise;
  saveTasksPromise = null;

  // 保存期间又有新变更，继续保存最新状态
  if (pendingSave) {
    pendingSave = false;
    saveTasks();
  }
}

/* ========== 任务生命周期（执行 → 测试 → 再执行） ========== */

/**
 * 将任务附件保存到后端，图片/二进制文件会持久化为本地路径
 * 失败时返回原始附件（前端会降级 inline base64）
 */
async function saveAttachmentsToServer(projectIndex, taskIndex, attachments) {
  if (!attachments || attachments.length === 0) return [];

  // 纯文本附件无需后端保存
  const needSave = attachments.some(a => (a.kind === 'image' || a.kind === 'binary') && a.data);
  if (!needSave) return attachments.map(a => ({ ...a, path: null, saved: false }));

  try {
    const res = await fetch('/api/save-attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIndex, taskIndex, attachments }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.saved || attachments.map(a => ({ ...a, path: null, saved: false }));
  } catch (e) {
    log(`附件持久化失败，降级为 inline base64: ${e.message}`);
    return attachments.map(a => ({ ...a, path: null, saved: false }));
  }
}

/**
 * 持久化任务完整输出历史到 .vibe-space/logs/
 * 便于后续排查与审计，不占用 config.json 空间
 */
async function saveTaskLog(projectIndex, taskIndex, content) {
  try {
    const res = await fetch('/api/save-task-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIndex, taskIndex, content: content || '' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    log(`任务输出历史已保存: ${data.fileName}`);
    return data;
  } catch (e) {
    log(`保存任务输出历史失败: ${e.message}`);
    return null;
  }
}

async function fetchTaskLogs(projectIndex, taskIndex) {
  try {
    const res = await fetch(`/api/task-logs?projectIndex=${projectIndex}&taskIndex=${taskIndex}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    log(`读取任务日志列表失败: ${e.message}`);
    return [];
  }
}

async function fetchTaskLogContent(projectIndex, fileName) {
  try {
    const res = await fetch(`/api/task-log-content?projectIndex=${projectIndex}&fileName=${encodeURIComponent(fileName)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).content;
  } catch (e) {
    log(`读取任务日志失败: ${e.message}`);
    return '';
  }
}

/**
 * 构建发送给 Claude Code 的完整 payload
 * 支持：任务文本、命令、文本附件、虚拟文本附件、图片附件、二进制附件
 */
function buildTaskPayload(task, savedAttachments = []) {
  // 1. 任务主体：command 和 text 同时存在时合并，command 优先级高
  let payload = '';
  if (task.command && task.text) {
    payload = `${task.text}\n\n${task.command}`;
  } else {
    payload = task.command || task.text || '';
  }

  const atts = savedAttachments.length > 0 ? savedAttachments : (task.attachments || []);

  if (atts.length > 0) {
    // 2. 文本/虚拟文本附件：直接内联
    const textAtts = atts.filter(a => (a.kind === 'text' || a.isVirtualText) && (a.content || a.data));
    if (textAtts.length > 0) {
      payload += '\n\n[ATTACHMENT CONTENT]\n';
      textAtts.forEach(att => {
        const content = att.content || (att.data ? `\n${att.data}` : '');
        payload += `\n--- ${att.name} ---\n${content}\n`;
      });
    }

    // 3. 图片附件：提供本地文件路径，让 Claude Code 读取
    const imageAtts = atts.filter(a => a.kind === 'image');
    if (imageAtts.length > 0) {
      payload += '\n\n[IMAGE ATTACHMENTS]\n';
      imageAtts.forEach(att => {
        if (att.path) {
          payload += `\n- ${att.name}: ${att.path}\n`;
        } else if (att.data) {
          // 降级：直接 inline base64（可能很大）
          payload += `\n- ${att.name}:\n${att.data}\n`;
        }
      });
    }

    // 4. 二进制附件：提供本地文件路径
    const binaryAtts = atts.filter(a => a.kind === 'binary');
    if (binaryAtts.length > 0) {
      payload += '\n\n[FILE ATTACHMENTS]\n';
      binaryAtts.forEach(att => {
        if (att.path) {
          payload += `\n- ${att.name}: ${att.path}\n`;
        } else if (att.data) {
          payload += `\n- ${att.name} (base64):\n${att.data}\n`;
        }
      });
    }
  }

  // 5. TASK_DONE 协议：仅对 action（执行型）任务追加
  // consult（咨询型）任务不需要精确完成标记，以实质内容输出作为完成标准
  if (task.type !== 'consult' && !payload.includes('[[TASK_DONE:')) {
    payload += '\n\n[SYSTEM INSTRUCTION - MUST FOLLOW]\n';
    payload += '1. When you believe this task is complete, you MUST output one of the following markers at the very end of your reply.\n';
    payload += '2. Do not explain or rewrite these markers; output them exactly as shown.\n';
    payload += '3. If the task is not complete, continue working and do NOT output any completion marker.\n\n';
    payload += 'On success: [[TASK_DONE:success]]\n';
    payload += 'On failure: [[TASK_DONE:failed:one-sentence reason]]\n';
    payload += 'When user decision is needed (e.g. multiple options): give your recommendation, then output: [[TASK_DONE:needs_input:recommended next step]]';
  }
  return payload;
}

/** 执行任务给 AI */
/** 恢复处于 waiting 状态的任务为 dispatched，等待用户后续输入 */
function resumeWaitingTask(projectIndex, taskIndex) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;
  const task = proj.tasks[taskIndex];
  if (getTaskStatus(task) !== 'waiting') return;

  const taskId = `${projectIndex}-${taskIndex}`;
  task.status = 'dispatched';
  task.done = false;
  runningTaskId = taskId;
  if (activeTaskProjectIndex === projectIndex) renderTaskList();
  saveTasks();

  // 重新启动静默检测
  const ptyId = `pty-${projectIndex}`;
  termOutputTracker.set(ptyId, { lastOutputAt: Date.now(), silentCycles: 0 });
  startSilenceChecker();

  // 如果循环在运行，更新状态文本
  if (loopProjectIndex === projectIndex && proj._loopRunning && loopStatus) {
    loopStatus.textContent = `等待用户输入 [${taskIndex + 1}]，输入后自动继续...`;
  }
}

async function dispatchTask(projectIndex, taskIndex) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;

  const task = proj.tasks[taskIndex];
  const taskId = `${projectIndex}-${taskIndex}`;

  // 只有当前任务真的正在 dispatched 中才跳过，避免旧 runningTaskId 锁死
  if (runningTaskId === taskId && getTaskStatus(task) === 'dispatched') return;
  clearReviewTimer(taskId);

  // 兼容旧任务：没有 type 字段的自动推断
  if (!task.type) task.type = inferTaskType(task.text);

  runningTaskId = taskId;
  task.status = 'dispatched';
  task.done = false;
  task.dispatchedAt = Date.now();
  if (activeTaskProjectIndex === projectIndex) renderTaskList();

  // 持久化附件（图片/二进制转为本地文件路径），并更新任务元数据剔除 base64
  const savedAttachments = await saveAttachmentsToServer(projectIndex, taskIndex, task.attachments);
  if (savedAttachments.length > 0) {
    task.attachments = savedAttachments;
    saveTasks();
  }

  const payload = buildTaskPayload(task, savedAttachments);
  sendTaskToTerminal(projectIndex, payload, task.text);

  // 派发新任务时重置视觉状态为执行中
  updatePaneStatusVisuals(projectIndex, 'dispatching');
  updatePaneProgress(projectIndex);

  // 初始化该终端的输出追踪，启动静默检测
  const ptyId = `pty-${projectIndex}`;
  termOutputTracker.set(ptyId, { lastOutputAt: Date.now(), silentCycles: 0 });
  startSilenceChecker();

  // 初始化任务输出缓冲区，用于后续智能验证
  taskOutputBuffers.set(taskId, { lines: [], startTime: Date.now() });
  
  // 初始化派发确认状态
  dispatchConfirmStates.set(taskId, { confirmed: false, retryCount: 0 });
  
  // 5 秒后检查任务是否被 AI 实际接收（有输出响应）
  setTimeout(() => {
    confirmTaskDispatch(projectIndex, taskIndex, taskId);
  }, 5000);

  // 保留 reviewTimers 占位便于兼容清理（dispatch 时先清除旧 timer）
  clearReviewTimer(taskId);
  reviewTimers.set(taskId, null);
}

/** 确认任务是否被 AI 实际接收，无响应则重试 */
function confirmTaskDispatch(projectIndex, taskIndex, taskId) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;
  const task = proj.tasks[taskIndex];
  
  // 任务状态已改变，不需要再确认
  if (getTaskStatus(task) !== 'dispatched') return;
  
  const confirmState = dispatchConfirmStates.get(taskId);
  if (!confirmState) return;
  if (confirmState.confirmed) return;
  
  // 检查是否有输出响应
  const buf = taskOutputBuffers.get(taskId);
  const hasOutput = buf && buf.lines.length > 0;
  
  if (hasOutput) {
    // 有输出，标记已确认
    confirmState.confirmed = true;
    dispatchConfirmStates.set(taskId, confirmState);
    log(`任务 ${taskId} 已确认被 AI 接收，输出 ${buf.lines.length} 行`);
    return;
  }
  
  // 无输出，尝试重发
  confirmState.retryCount++;
  if (confirmState.retryCount <= 2) {
    log(`任务 ${taskId} 无响应，第 ${confirmState.retryCount} 次重试...`);
    // 发送一个空行唤醒终端，然后重新发送任务
    sendTaskToTerminal(projectIndex, '\r\n', 'wake-up');
    setTimeout(() => {
      const payload = buildTaskPayload(task, task.attachments);
      sendTaskToTerminal(projectIndex, payload, task.text);
    }, 500);
    // 再次检查
    setTimeout(() => {
      confirmTaskDispatch(projectIndex, taskIndex, taskId);
    }, 5000);
  } else {
    // 重试 2 次仍无响应，重置任务状态
    log(`任务 ${taskId} 重试 2 次仍无响应，重置为 idle`);
    task.status = 'idle';
    task.done = false;
    task.verificationNote = '任务发送后 AI 无响应，已重置，可重新派发';
    if (runningTaskId === taskId) runningTaskId = null;
    if (activeTaskProjectIndex === projectIndex) renderTaskList();
    saveTasks();
    
    // 循环模式下继续下一个任务
    if (loopProjectIndex === projectIndex && proj._loopRunning) {
      clearTimeout(loopAdvanceTimer);
      loopAdvanceTimer = setTimeout(() => {
        if (proj._loopRunning) triggerLoopNext(projectIndex);
      }, 1000);
    }
  }
}

/** AI 输出完毕，进入智能验证 */
function markTaskTesting(projectIndex, taskIndex, autoConfirmed = false) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;

  const task = proj.tasks[taskIndex];
  const taskId = `${projectIndex}-${taskIndex}`;

  clearReviewTimer(taskId);
  if (runningTaskId === taskId) runningTaskId = null;

  // 清理该终端的输出追踪，避免已结束任务的 tracker 数据污染下一轮
  const ptyId = `pty-${projectIndex}`;
  termOutputTracker.delete(ptyId);

  // 进入智能验证状态，黄色脉冲提示
  updatePaneStatusVisuals(projectIndex, 'testing');
  updatePaneProgress(projectIndex);

  // 始终进入智能验证，由 AI 输出自动决定 done / retry
  smartVerifyTask(projectIndex, taskIndex);
}

function formatCost(cost) {
  if (typeof cost !== 'number') return '';
  if (cost < 0.01) return '$' + cost.toFixed(4);
  return '$' + cost.toFixed(2);
}

async function refreshTaskCost(projectIndex, taskIndex) {
  try {
    const res = await fetch('/api/task-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIndex, taskIndex }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const proj = config.projects[projectIndex];
    if (!proj || !proj.tasks[taskIndex]) return;
    const task = proj.tasks[taskIndex];
    task.cost = data.costUSD;
    task.tokens = {
      input: data.inputTokens || 0,
      output: data.outputTokens || 0,
      cacheRead: data.cacheReadTokens || 0,
      cacheCreation: data.cacheCreationTokens || 0,
    };
    task.costModel = data.model || '';
    if (activeTaskProjectIndex === projectIndex) renderTaskList();
    saveTasks();
  } catch (e) {
    console.error('[VibeSpace] refreshTaskCost failed', e);
  }
}

/** 测试通过 */
function passTask(projectIndex, taskIndex) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;

  const task = proj.tasks[taskIndex];
  task.status = 'done';
  task.done = true;
  task.doneAt = Date.now();
  if (activeTaskProjectIndex === projectIndex) renderTaskList();
  saveTasks();
  refreshTaskCost(projectIndex, taskIndex);

  // 单个任务完成：绿色边框脉冲提醒 + 固定对勾
  updatePaneStatusVisuals(projectIndex, 'done');
  updatePaneProgress(projectIndex);

  if (loopProjectIndex === projectIndex && proj._loopRunning) {
    clearTimeout(loopAdvanceTimer);
    loopAdvanceTimer = setTimeout(() => {
      if (proj._loopRunning) triggerLoopNext(projectIndex);
    }, 1000);
  }

  // 检查是否全部完成
  const allDone = proj.tasks.every(t => getEffectiveTaskStatus(t, proj.tasks) === 'done');
  if (allDone) {
    setTimeout(() => notifyAllTasksDone(projectIndex), 600);
  }
}

/** Test failed, return to idle */
function rejectTask(projectIndex, taskIndex) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;

  const task = proj.tasks[taskIndex];
  task.status = 'idle';
  task.done = false;
  if (activeTaskProjectIndex === projectIndex) renderTaskList();
  saveTasks();

  // 视觉反馈：失败红色脉冲（重试前短暂提示）
  updatePaneStatusVisuals(projectIndex, 'error');
  updatePaneProgress(projectIndex);

  // 循环模式下：用户明确驳回后立刻重试（通常是想让 AI 重新处理）
  if (loopProjectIndex === projectIndex && proj._loopRunning) {
    clearTimeout(loopAdvanceTimer);
    loopAdvanceTimer = setTimeout(() => {
      if (proj._loopRunning) triggerLoopNext(projectIndex);
    }, 1000);
  }
}

/** ========== 智能任务验证引擎 ========== */

// stripAnsiCodes / analyzeTaskOutput / inferTaskType 已从 task-analyzer.js 复用

/** 智能验证任务：根据 AI 输出决定 done / retry / pause */
function smartVerifyTask(projectIndex, taskIndex) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks || !proj.tasks[taskIndex]) return;

  const task = proj.tasks[taskIndex];
  const taskId = `${projectIndex}-${taskIndex}`;
  const buf = taskOutputBuffers.get(taskId);
  const rawOutput = buf ? buf.lines.join('') : '';

  log(`智能验证任务 ${taskId}，输出长度 ${rawOutput.length}`);

  const analysis = analyzeTaskOutput(rawOutput, task.type);

  // 保存输出快照，便于后续查看 AI 具体做了什么（限制 5000 字符，避免配置膨胀）
  const snapshotText = analysis.text || stripAnsiCodes(rawOutput);
  if (snapshotText && snapshotText.trim().length > 0) {
    task.outputSnapshot = snapshotText.trim().slice(-5000);
  }
  if (analysis.errorContext) {
    task.errorSnapshot = analysis.errorContext.slice(-2000);
  }

  // 清理缓冲区
  taskOutputBuffers.delete(taskId);

  // 持久化完整输出历史
  saveTaskLog(projectIndex, taskIndex, rawOutput);

  // 决策逻辑（全自动，不再暂停等人工）
  if (analysis.isDone) {
    // 明确完成
    if (analysis.needsInput && analysis.nextStepSuggestion) {
      // AI 建议了下一步，先插入新任务再完成当前任务
      const nextTask = {
        text: analysis.nextStepSuggestion,
        status: 'idle',
        done: false,
        createdAt: Date.now(),
        type: inferTaskType(analysis.nextStepSuggestion),
        parentTaskIndex: taskIndex,
      };
      proj.tasks.splice(taskIndex + 1, 0, nextTask);
      saveTasks();
      if (activeTaskProjectIndex === projectIndex) renderTaskList();
      log(`任务 ${taskId} 完成，已自动创建下一步任务：${analysis.nextStepSuggestion}`);
    }
    passTask(projectIndex, taskIndex);
    log(`任务 ${taskId} 智能验证通过`);
    return;
  }

  if (analysis.hasError) {
    // 有错误：尝试自动修复（consult 类型不触发 autoFix，直接标记完成）
    if (task.type === 'consult') {
      log(`任务 ${taskId} 为咨询型，虽有异常标记仍视为完成`);
      passTask(projectIndex, taskIndex);
      return;
    }
    
    // 无意义/问候型任务：不要触发 auto-fix，直接完成
    if (isTrivialTask(task.text)) {
      log(`任务 ${taskId} 为无意义任务，跳过 auto-fix 直接完成`);
      passTask(projectIndex, taskIndex);
      return;
    }
    
    // 检测 AI 输出是否有实质内容，如果没有说明任务已完成或不需要修复
    if (!hasSubstantiveOutput(rawOutput)) {
      log(`任务 ${taskId} AI 输出无实质内容，视为完成，不触发 auto-fix`);
      passTask(projectIndex, taskIndex);
      return;
    }
    
    log(`任务 ${taskId} 检测到错误，启动自动修复`);
    autoFixTask(projectIndex, taskIndex, analysis.errorContext || analysis.text);
    return;
  }

  // 模糊状态或需要确认：先尝试自动确认，若无法命中规则则重置为 idle 继续等待
  if (analysis.needsUser || analysis.isAmbiguous) {
    // Plan Mode 期间不要暂停等待用户输入
    if (isInPlanMode(rawOutput)) {
      log(`任务 ${taskId} 处于 Plan Mode，保持 dispatched 继续等待`);
      const ptyId = `pty-${projectIndex}`;
      termOutputTracker.set(ptyId, { lastOutputAt: Date.now(), silentCycles: 0 });
      return;
    }
    
    if (tryAutoConfirm(projectIndex, analysis.text, task.type)) {
      // 自动确认已发送，重置静默检测，保持 dispatched 状态继续等待 AI 回复
      const ptyId = `pty-${projectIndex}`;
      termOutputTracker.set(ptyId, { lastOutputAt: Date.now(), silentCycles: 0 });
      return;
    }

    // 咨询型任务：只要 AI 有实质输出，就直接完成，避免反复重发原任务
    if (task.type === 'consult') {
      const outputLen = analysis.text.replace(/\s/g, '').length;
      if (outputLen > 0) {
        log(`任务 ${taskId} 为咨询型，已有 ${outputLen} 字符输出，直接完成`);
        passTask(projectIndex, taskIndex);
        return;
      }
      // 完全没有输出时才重置等待，且不触发循环重发
      log(`任务 ${taskId} 为咨询型但无输出，重置为 idle 等待`);
      task.status = 'idle';
      task.done = false;
      if (activeTaskProjectIndex === projectIndex) renderTaskList();
      saveTasks();
      return;
    }

    // 执行型任务遇到开放问题且无法自动确认：改为 waiting 状态，等待用户输入
    // 不再重置为 idle，避免重复发送原任务造成终端污染
    log(`任务 ${taskId} 需要用户输入，已暂停等待`);
    task.status = 'waiting';
    task.done = false;
    task.verificationNote = 'AI 提出开放问题，等待你在终端中回复或点击“继续”后输入';
    updatePaneStatusVisuals(projectIndex, 'waiting');
    updatePaneProgress(projectIndex);
    if (activeTaskProjectIndex === projectIndex) renderTaskList();
    saveTasks();

    // 暂停该项目的自动循环，避免继续派发后续任务干扰当前对话
    if (loopProjectIndex === projectIndex && proj._loopRunning) {
      proj._loopRunning = false;
      clearTimeout(loopAdvanceTimer);
      if (loopStatus) loopStatus.textContent = `等待用户输入 [${taskIndex + 1}]`;
      updateLoopUI();
    }
    return;
  }
}

/** 重置 pane 所有状态视觉样式 */
function resetPaneVisualStates(projectIndex) {
  const pane = document.getElementById('pane-pty-' + projectIndex);
  if (!pane) return;
  pane.classList.remove('completed', 'completed-steady', 'dispatching', 'testing', 'error');
  const badge = pane.querySelector('.pane-done-badge');
  if (badge) badge.style.display = 'none';
}

/** 更新 pane 状态视觉样式（dispatching/testing/error/done/idle） */
function updatePaneStatusVisuals(projectIndex, status) {
  const pane = document.getElementById('pane-pty-' + projectIndex);
  if (!pane) return;

  // 清除旧状态
  pane.classList.remove('completed', 'completed-steady', 'dispatching', 'testing', 'error');
  const badge = pane.querySelector('.pane-done-badge');

  switch (status) {
    case 'dispatching':
      pane.classList.add('dispatching');
      if (badge) badge.style.display = 'none';
      break;
    case 'testing':
      pane.classList.add('testing');
      if (badge) badge.style.display = 'none';
      break;
    case 'error':
      pane.classList.add('error');
      if (badge) badge.style.display = 'none';
      break;
    case 'waiting':
      pane.classList.add('testing');
      if (badge) badge.style.display = 'none';
      break;
    case 'done':
      // 由 triggerPaneCompletionGlow 处理完整动画
      triggerPaneCompletionGlow(projectIndex);
      break;
    default:
      if (badge) badge.style.display = 'none';
      break;
  }
}

/** 检测 AI 是否输出了精确任务完成标记，检测到则立即处理 */
function checkTaskDoneMarker(projectIndex, rawData) {
  if (!runningTaskId) return false;
  const [rProj, rIdx] = runningTaskId.split('-').map(Number);
  if (rProj !== projectIndex || Number.isNaN(rIdx)) return false;

  // 使用累积输出判断，避免单个小片段误匹配；只在末尾附近检测
  const buf = taskOutputBuffers.get(runningTaskId);
  const text = stripAnsiCodes((buf ? buf.lines.join('') : '') + (rawData || ''));

  // 成功：立即通过，不再等待静默检测
  if (hasTaskDoneMarkerNearEnd(text, TASK_DONE_SUCCESS_RE)) {
    log(`任务 ${runningTaskId} 检测到完成标记，立即通过`);
    markTaskTesting(projectIndex, rIdx, true);
    return true;
  }

  // 失败：记录原因并交给智能验证处理
  const failedMatch = hasTaskDoneMarkerNearEnd(text, TASK_DONE_FAILED_RE)
    ? text.match(TASK_DONE_FAILED_RE)
    : null;
  if (failedMatch) {
    log(`任务 ${runningTaskId} 检测到失败标记：${failedMatch[1].trim()}`);
    if (buf) buf.failedReason = failedMatch[1].trim();
    markTaskTesting(projectIndex, rIdx, true);
    return true;
  }

  // AI 建议下一步：当前任务完成，并自动创建新任务
  const needsInputMatch = hasTaskDoneMarkerNearEnd(text, TASK_DONE_NEEDS_INPUT_RE)
    ? text.match(TASK_DONE_NEEDS_INPUT_RE)
    : null;
  if (needsInputMatch) {
    const suggestion = needsInputMatch[1].trim();
    log(`任务 ${runningTaskId} 检测到下一步建议：${suggestion}`);
    if (buf) buf.nextStepSuggestion = suggestion;
    markTaskTesting(projectIndex, rIdx, true);
    // 在当前任务后插入建议的新任务
    const proj = config.projects[projectIndex];
    if (proj) {
      const nextTask = {
        text: suggestion,
        status: 'idle',
        done: false,
        createdAt: Date.now(),
        type: inferTaskType(suggestion),
        parentTaskIndex: rIdx,
      };
      proj.tasks.splice(rIdx + 1, 0, nextTask);
      saveTasks();
      if (activeTaskProjectIndex === projectIndex) renderTaskList();
    }
    return true;
  }

  return false;
}

/** 给对应 pane 添加完成绿色闪烁，保持一直闪烁 */
function triggerPaneCompletionGlow(projectIndex) {
  const pane = document.getElementById('pane-pty-' + projectIndex);
  if (!pane) return;
  pane.classList.remove('completed-steady');
  pane.classList.add('completed');
  const badge = pane.querySelector('.pane-done-badge');
  if (badge) badge.style.display = 'flex';
  // 保持无限闪烁，不转为 steady
}

// 单个任务最多自动修复次数：默认 3，可在配置中调整

/** 自动修复：检测到错误时，在当前任务后插入修复子任务 */
function autoFixTask(projectIndex, taskIndex, errorContext) {
  const proj = config.projects[projectIndex];
  const task = proj.tasks[taskIndex];
  if (!task) return;

  // 统计自动修复次数，避免无限循环
  task.autoFixCount = (task.autoFixCount || 0) + 1;
  const maxAttempts = getMaxAutoFixAttempts();
  if (task.autoFixCount >= maxAttempts) {
    log(`任务 ${projectIndex}-${taskIndex} 自动修复达到 ${maxAttempts} 次，停止自动修复`);
    task.status = 'done';
    task.done = true;
    task.doneAt = Date.now();
    task.verificationNote = `Auto-fix ${maxAttempts} attempts failed, skipped. Please check manually`;
    if (activeTaskProjectIndex === projectIndex) renderTaskList();
    saveTasks();
    updatePaneStatusVisuals(projectIndex, 'done');
    refreshTaskCost(projectIndex, taskIndex);
    if (loopProjectIndex === projectIndex && proj._loopRunning) {
      clearTimeout(loopAdvanceTimer);
      loopAdvanceTimer = setTimeout(() => {
        if (proj._loopRunning) triggerLoopNext(projectIndex);
      }, 1200);
    }
    return;
  }

  // 将当前任务重置为 idle，等待重新执行（或作为历史保留）
  task.status = 'idle';
  task.done = false;
  task.autoFailed = true;
  task.failedAt = Date.now();

  // 过滤掉系统提示文本，避免修复任务携带垃圾内容
  const cleanContext = errorContext
    .replace(/On success: \[\[TASK_DONE:success\]\].*$/s, '')
    .replace(/On failure: \[\[TASK_DONE:failed:.*$/s, '')
    .replace(/\[SYSTEM INSTRUCTION.*?\].*$/s, '')
    .slice(0, 800);

  // 创建修复任务
  const fixTask = {
    text: `[AUTO-FIX] The previous task failed. Please fix the following issue:\n${cleanContext}`,
    status: 'idle',
    done: false,
    createdAt: Date.now(),
    isAutoFix: true,
    parentTaskIndex: taskIndex,
  };

  // 插入到当前任务之后
  proj.tasks.splice(taskIndex + 1, 0, fixTask);

  if (activeTaskProjectIndex === projectIndex) renderTaskList();
  saveTasks();

  // 视觉反馈：检测到错误，红色脉冲
  updatePaneStatusVisuals(projectIndex, 'error');

  // 循环模式下自动推进到修复任务
  if (loopProjectIndex === projectIndex && proj._loopRunning) {
    clearTimeout(loopAdvanceTimer);
    loopAdvanceTimer = setTimeout(() => {
      if (proj._loopRunning) triggerLoopNext(projectIndex);
    }, 1200);
  }
}

/** 全部任务完成时的全局提醒 */
function notifyAllTasksDone(projectIndex) {
  const proj = config.projects[projectIndex];
  if (!proj || !proj.tasks) return;

  const allDone = proj.tasks.every(t => getEffectiveTaskStatus(t, proj.tasks) === 'done');
  if (!allDone) return;

  log(`Project ${projectIndex} all tasks completed!`);
  if (loopStatus) loopStatus.textContent = window.i18n.t('taskPanel.allCompleted');

  // 给对应 pane 添加持续较长时间的完成动画，保持一直闪烁
  const pane = document.getElementById('pane-pty-' + projectIndex);
  if (pane) {
    pane.classList.remove('completed-steady');
    pane.classList.add('completed');
    const badge = pane.querySelector('.pane-done-badge');
    if (badge) badge.style.display = 'flex';
  }
}

function sendTaskToTerminal(projectIndex, command, label) {
  const id = `pty-${projectIndex}`;
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'exec-task', id, command, label }));
  }
}

/* 循环执行控制 */
function updateLoopUI() {
  const proj = activeTaskProjectIndex !== null ? config.projects[activeTaskProjectIndex] : null;
  const isRunning = loopProjectIndex === activeTaskProjectIndex && !!proj && !!proj._loopRunning;
  if (btnRunAll) btnRunAll.style.display = isRunning ? 'none' : 'block';
  if (btnStopLoop) btnStopLoop.style.display = isRunning ? 'block' : 'none';
  if (loopStatus && !isRunning) loopStatus.textContent = window.i18n.t('taskPanel.loopStatus');
}

btnRunAll.addEventListener('click', () => {
  if (activeTaskProjectIndex === null) return;
  const proj = config.projects[activeTaskProjectIndex];
  if (!proj.tasks || proj.tasks.length === 0) {
    alert(window.i18n.t('taskPanel.addFirst'));
    return;
  }
  startTaskLoop(activeTaskProjectIndex);
});

btnStopLoop.addEventListener('click', () => {
  stopTaskLoop();
});

function startTaskLoop(projectIndex) {
  stopTaskLoop();
  loopProjectIndex = projectIndex;
  runningTaskId = null; // 重置运行状态，避免旧任务 ID 锁死新循环
  const proj = config.projects[projectIndex];
  proj._loopRunning = true;
  updateLoopUI();

  // 通知服务端循环已启动
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'loop-state', paneId: projectIndex, running: true }));
  }

  triggerLoopNext(projectIndex);

  // 启动静默检测，用于判断 AI 何时回复完成
  startSilenceChecker();
}

async function triggerLoopNext(projectIndex) {
  // 防止并发推进（dispatchTask 现在是异步的，可能触发重入）
  if (loopAdvanceLocks.get(projectIndex)) return;
  loopAdvanceLocks.set(projectIndex, true);

  try {
  const proj = config.projects[projectIndex];
  if (!proj || !proj._loopRunning) return;
  const tasks = proj.tasks || [];

  // 0) 检查当前 runningTaskId 是否已卡住超过 2 分钟（无进展则重置重试）
  if (runningTaskId) {
    const [rProj, rIdx] = runningTaskId.split('-').map(Number);
    if (rProj === projectIndex && rIdx >= 0 && rIdx < tasks.length) {
      const runningTask = tasks[rIdx];
      const dispatchedTime = Date.now() - (runningTask.dispatchedAt || 0);
      // 三层状态卡死检测：官方状态 + 时间阈值
      const cs = getClaudeStatusForProject(projectIndex);
      const stuckMs = getStuckTaskTimeoutMs();
      const isActuallyStuck = cs.status === 'busy' && cs.since > stuckMs;
      const isSoftStuck = getTaskStatus(runningTask) === 'dispatched' && dispatchedTime > stuckMs;
      if (isActuallyStuck || isSoftStuck) {
        log(`Task ${runningTaskId} dispatched ${dispatchedTime}ms no progress (status: ${cs.status}, since: ${cs.since}ms), reset to idle and retry`);
        runningTask.status = 'idle';
        runningTask.done = false;
        runningTaskId = null;
        if (activeTaskProjectIndex === projectIndex) renderTaskList();
        saveTasks();
      }
    }
  }

  // 1) 如果还有 AI 在处理中，等待（由状态检测或静默检测触发下一步）
  const dispatchedIdx = tasks.findIndex(t => getEffectiveTaskStatus(t, tasks) === 'dispatched');
  if (dispatchedIdx !== -1) {
    const cs = getClaudeStatusForProject(projectIndex);
    const statusLabel = cs.status === 'busy' ? 'Claude ' + window.i18n.t('statusBadge.busy') : cs.status === 'waiting' ? window.i18n.t('statusBadge.waiting') : window.i18n.t('taskPanel.status.dispatched');
    if (loopStatus) loopStatus.textContent = `${statusLabel} [${dispatchedIdx + 1}] ${tasks[dispatchedIdx].text.slice(0, 20)}...`;
    return;
  }

  // 1.5) 如果有任务在等待用户输入，暂停循环
  const waitingIdx = tasks.findIndex(t => getEffectiveTaskStatus(t, tasks) === 'waiting');
  if (waitingIdx !== -1) {
    proj._loopRunning = false;
    if (loopStatus) loopStatus.textContent = `Waiting input [${waitingIdx + 1}] ${tasks[waitingIdx].text.slice(0, 20)}...`;
    updateLoopUI();
    return;
  }

  // 2) 找到第一个 idle 且未被阻塞的任务并执行
  const idx = tasks.findIndex(t => getEffectiveTaskStatus(t, tasks) === 'idle');
  if (idx !== -1) {
    await dispatchTask(projectIndex, idx);
    if (loopStatus) loopStatus.textContent = `Running [${idx + 1}] ${tasks[idx].text.slice(0, 20)}...`;
    return;
  }

  // 4) 检查是否全部完成
  const allDone = tasks.every(t => getEffectiveTaskStatus(t, tasks) === 'done');
  if (allDone) {
    if (taskLoopToggle.checked) {
      tasks.forEach(t => { t.status = 'idle'; t.done = false; });
      if (activeTaskProjectIndex === projectIndex) renderTaskList();
      saveTasks();
      setTimeout(() => triggerLoopNext(projectIndex), 2000);
      if (loopStatus) loopStatus.textContent = window.i18n.t('taskPanel.allDoneAutoReset');
    } else {
      stopTaskLoop();
      notifyAllTasksDone(projectIndex);
      if (loopStatus) loopStatus.textContent = window.i18n.t('taskPanel.allCompleted');
    }
    return;
  }

  if (loopStatus) loopStatus.textContent = window.i18n.t('taskPanel.waitingForTasks');
  } finally {
    loopAdvanceLocks.delete(projectIndex);
  }
}

function stopTaskLoop() {
  const previousLoopProjectIndex = loopProjectIndex;
  if (taskLoopTimer) { clearInterval(taskLoopTimer); taskLoopTimer = null; }
  if (loopAdvanceTimer) { clearTimeout(loopAdvanceTimer); loopAdvanceTimer = null; }
  if (silenceCheckerTimer) { clearInterval(silenceCheckerTimer); silenceCheckerTimer = null; }
  if (loopProjectIndex !== null) {
    const proj = config.projects[loopProjectIndex];
    if (proj) {
      proj._loopRunning = false;
    }
    loopProjectIndex = null;
  }
  runningTaskId = null; // 停止循环时重置运行任务 ID
  updateLoopUI();

  // 通知服务端循环已停止
  if (previousLoopProjectIndex !== null && ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'loop-state', paneId: previousLoopProjectIndex, running: false }));
  }
}

/** 启动终端输出静默检测定时器 */
function startSilenceChecker() {
  if (silenceCheckerTimer) return;
  silenceCheckerTimer = setInterval(checkDispatchedTasksSilence, 2000);
}

/** 检查所有 dispatched 任务对应的终端是否已静默，静默则自动标记 testing */
function checkDispatchedTasksSilence() {
  if (!config) return;
  const now = Date.now();
  let hasDispatched = false;

  config.projects.forEach((proj, projectIndex) => {
    const tasks = proj.tasks || [];
    tasks.forEach((task, taskIndex) => {
      if (getTaskStatus(task) !== 'dispatched') return;
      hasDispatched = true;

      // 三层架构：优先使用官方状态
      const cs = getClaudeStatusForProject(projectIndex);
      if (cs.status === 'idle') {
        // 官方状态已 idle，立即触发验证（无需等静默时间）
        log(`Silence check: official idle, verify task ${projectIndex}-${taskIndex}`);
        markTaskTesting(projectIndex, taskIndex, true);
        return;
      }

      if (cs.status === 'waiting') {
        // Claude 在等待用户确认，尝试自动确认
        const buf = taskOutputBuffers.get(`${projectIndex}-${taskIndex}`);
        const accumulatedText = buf ? stripAnsiCodes(buf.lines.join('')) : '';
        if (tryAutoConfirm(projectIndex, accumulatedText, task.type)) {
          log(`Silence check: status waiting, auto-confirm triggered`);
        }
        // 等待确认期间不触发静默超时
        return;
      }

      // 官方状态为 busy 或 unknown：使用终端静默检测作为 fallback
      // 注意：静默检测只负责标记任务为 testing，不直接推进循环
      // 循环推进由 passTask/rejectTask 事件驱动，避免竞争条件
      const ptyId = `pty-${projectIndex}`;
      const tracker = termOutputTracker.get(ptyId) || { lastOutputAt: task.dispatchedAt || now, silentCycles: 0 };
      const lastOutput = tracker.lastOutputAt || task.dispatchedAt || now;
      const elapsed = now - lastOutput;

      // 使用动态阈值：根据任务类型和 AI 状态调整
      const effectiveThreshold = getDynamicSilenceThreshold(projectIndex, task.type);

      if (elapsed >= effectiveThreshold) {
        const cycles = (tracker.silentCycles || 0) + 1;
        termOutputTracker.set(ptyId, { ...tracker, silentCycles: cycles });
        const confirmCount = getSilenceConfirmCount();
        if (cycles >= confirmCount) {
          markTaskTesting(projectIndex, taskIndex, true);
        } else if (loopProjectIndex === projectIndex && loopStatus) {
          loopStatus.textContent = window.i18n.t('taskPanel.silenceConfirm', { index: taskIndex + 1, cycles, confirmCount });
        }
      } else {
        termOutputTracker.set(ptyId, { ...tracker, silentCycles: 0 });
        if (loopProjectIndex === projectIndex && loopStatus) {
          const remaining = Math.max(0, Math.ceil((effectiveThreshold - elapsed) / 1000));
          loopStatus.textContent = window.i18n.t('taskPanel.silenceDetect', { index: taskIndex + 1, remaining });
        }
      }
    });
  });

  // 没有 dispatched 任务时可以停止检测，节省资源
  if (!hasDispatched && silenceCheckerTimer) {
    clearInterval(silenceCheckerTimer);
    silenceCheckerTimer = null;
  }
}

taskLoopToggle.addEventListener('change', (e) => {
  if (activeTaskProjectIndex !== null) {
    const proj = config.projects[activeTaskProjectIndex];
    if (proj) {
      proj.loopAutoReset = e.target.checked;
      saveTasks();
    }
  }
});

/* ========== 设置面板 ========== */

const bgColorInput = document.getElementById('bgColor');
const paneColorInput = document.getElementById('paneColor');
const borderColorInput = document.getElementById('borderColor');
const fontSizeInput = document.getElementById('fontSize');
const themeStyleInput = document.getElementById('themeStyle');
const scrollbackSetting = document.getElementById('scrollbackSetting');
const silenceThresholdSetting = document.getElementById('silenceThresholdSetting');
const silenceThresholdDisplay = document.getElementById('silenceThresholdDisplay');
const autoPassDelaySetting = document.getElementById('autoPassDelaySetting');
const autoPassDelayDisplay = document.getElementById('autoPassDelayDisplay');
const silenceConfirmCountSetting = document.getElementById('silenceConfirmCountSetting');
const busyExtraSilenceMsSetting = document.getElementById('busyExtraSilenceMsSetting');
const stuckTaskTimeoutMsSetting = document.getElementById('stuckTaskTimeoutMsSetting');
const maxAutoFixAttemptsSetting = document.getElementById('maxAutoFixAttemptsSetting');
const loopIntervalMsSetting = document.getElementById('loopIntervalMsSetting');
const inputTokenPriceSetting = document.getElementById('inputTokenPriceSetting');
const outputTokenPriceSetting = document.getElementById('outputTokenPriceSetting');
const cacheTokenPriceSetting = document.getElementById('cacheTokenPriceSetting');
const btnResetTheme = document.getElementById('btnResetTheme');
const btnSaveTheme = document.getElementById('btnSaveTheme');
const presetThemesEl = document.getElementById('presetThemes');

function updateSettingsUI(theme) {
  if (!theme) return;
  // 若传入的是主题键（如 'light'），先展开为完整主题
  const normalized = normalizeThemeInput(theme);
  if (normalized.bgColor) bgColorInput.value = normalized.bgColor;
  if (normalized.paneColor) paneColorInput.value = normalized.paneColor;
  if (normalized.borderColor) borderColorInput.value = normalized.borderColor;
  if (normalized.fontSize) fontSizeInput.value = normalized.fontSize;
  if (normalized.style) themeStyleInput.value = normalized.style;
  if (normalized.scrollback !== undefined && scrollbackSetting) scrollbackSetting.value = normalized.scrollback;
}

function updateLoopSettingsUI(loop) {
  if (!loop) return;
  if (loop.silenceThreshold !== undefined && silenceThresholdSetting) {
    silenceThresholdSetting.value = loop.silenceThreshold;
    if (silenceThresholdDisplay) silenceThresholdDisplay.textContent = loop.silenceThreshold + 's';
  }
  if (loop.autoPassDelay !== undefined && autoPassDelaySetting) {
    autoPassDelaySetting.value = loop.autoPassDelay;
    if (autoPassDelayDisplay) autoPassDelayDisplay.textContent = loop.autoPassDelay + 's';
  }
  if (loop.silenceConfirmCount !== undefined && silenceConfirmCountSetting) silenceConfirmCountSetting.value = loop.silenceConfirmCount;
  if (loop.busyExtraSilenceMs !== undefined && busyExtraSilenceMsSetting) busyExtraSilenceMsSetting.value = loop.busyExtraSilenceMs;
  if (loop.stuckTaskTimeoutMs !== undefined && stuckTaskTimeoutMsSetting) stuckTaskTimeoutMsSetting.value = loop.stuckTaskTimeoutMs;
  if (loop.maxAutoFixAttempts !== undefined && maxAutoFixAttemptsSetting) maxAutoFixAttemptsSetting.value = loop.maxAutoFixAttempts;
  if (loop.loopIntervalMs !== undefined && loopIntervalMsSetting) loopIntervalMsSetting.value = loop.loopIntervalMs;
}

function updateCostSettingsUI(cost) {
  if (!cost) return;
  if (cost.inputTokenPrice !== undefined && inputTokenPriceSetting) inputTokenPriceSetting.value = cost.inputTokenPrice;
  if (cost.outputTokenPrice !== undefined && outputTokenPriceSetting) outputTokenPriceSetting.value = cost.outputTokenPrice;
  if (cost.cacheTokenPrice !== undefined && cacheTokenPriceSetting) cacheTokenPriceSetting.value = cost.cacheTokenPrice;
}

// 根据设置面板当前输入构建主题对象（复用于自动保存与手动保存）
function buildThemeFromInputs(styleOverride) {
  const matchedPreset = Object.entries(presetThemes).find(([key, t]) =>
    t.colors &&
    t.colors.bg.toLowerCase() === bgColorInput.value.toLowerCase() &&
    t.colors.pane.toLowerCase() === paneColorInput.value.toLowerCase() &&
    t.colors.border.toLowerCase() === borderColorInput.value.toLowerCase()
  );
  const style = styleOverride ?? (matchedPreset ? matchedPreset[0] : (themeStyleInput.value || 'dark'));
  return {
    bgColor: bgColorInput.value,
    paneColor: paneColorInput.value,
    borderColor: borderColorInput.value,
    fontSize: parseInt(fontSizeInput.value),
    style,
    scrollback: parseInt(scrollbackSetting?.value) || (config?.theme?.scrollback) || 1000,
    showScrollbar: config?.theme?.showScrollbar ?? false,
  };
}

let themeSaveDebounceTimer = null;
// 主题变更后自动持久化到 config.json，避免切主题后又被服务器配置覆盖
async function persistThemeSettings() {
  if (!config) return;
  if (themeSaveDebounceTimer) clearTimeout(themeSaveDebounceTimer);
  themeSaveDebounceTimer = setTimeout(async () => {
    const theme = buildThemeFromInputs();
    config.theme = theme;
    currentTheme = { ...currentTheme, ...theme };
    try {
      await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      log('Theme auto-saved');
    } catch (e) {
      console.error('自动保存主题失败:', e.message);
    }
  }, 300);
}

function applyTheme(themeInput) {
  if (!themeInput) return;
  // 合并输入到 currentTheme，保留 fontSize/scrollback 等运行时字段
  currentTheme = { ...currentTheme, ...themeInput };

  // 使用 theme-engine.js 的完整变量体系
  if (typeof ThemeEngine !== 'undefined') {
    ThemeEngine.applyTheme(currentTheme);
  }

  // 如果本次输入明确指定了颜色，覆盖 theme-engine 的变量（支持自定义）
  // 注意：这里只覆盖 themeInput 中显式传入的颜色，避免旧颜色残留
  const root = document.documentElement;
  if (themeInput.bgColor) root.style.setProperty('--vs-bg', themeInput.bgColor);
  if (themeInput.paneColor) {
    root.style.setProperty('--vs-pane', themeInput.paneColor);
    root.style.setProperty('--vs-task-panel', themeInput.paneColor);
    root.style.setProperty('--vs-settings-panel', themeInput.paneColor);
    root.style.setProperty('--vs-stats-panel', themeInput.paneColor);
  }
  if (themeInput.borderColor) root.style.setProperty('--vs-border', themeInput.borderColor);

  // 同步更新所有已存在终端的字体大小与配色
  if (currentTheme.fontSize) {
    const size = parseInt(currentTheme.fontSize);
    document.querySelectorAll('.terminal-wrap').forEach(wrap => {
      if (wrap._xterm) {
        wrap._xterm.options.fontSize = size;
        if (wrap._xterm.fitAddon) { try { wrap._xterm.fitAddon.fit(); } catch (e) {} }
      }
    });
  }

  const termTheme = getTerminalTheme(currentTheme);
  document.querySelectorAll('.terminal-wrap').forEach(wrap => {
    if (wrap._xterm) {
      if (wrap.classList.contains('focused')) {
        wrap._xterm.options.theme = termTheme;
      } else {
        // 非活动窗口将光标颜色设为背景色，实现隐藏效果（xterm 5.3 不支持 cursorInactiveStyle）
        const bg = termTheme.background || '#000000';
        wrap._xterm.options.theme = { ...termTheme, cursor: bg, cursorAccent: bg };
      }
    }
  });
}

[bgColorInput, paneColorInput, borderColorInput, fontSizeInput].forEach(input => {
  input.addEventListener('input', () => {
    applyTheme({
      bgColor: bgColorInput.value,
      paneColor: paneColorInput.value,
      borderColor: borderColorInput.value,
      fontSize: fontSizeInput.value,
      style: themeStyleInput.value,
    });
    persistThemeSettings();
  });
});

// themeStyle 改变时，自动同步 color picker 为对应预设颜色
themeStyleInput.addEventListener('input', () => {
  const key = themeStyleInput.value;
  const preset = (typeof ThemeEngine !== 'undefined' && ThemeEngine.presetThemes)
    ? ThemeEngine.presetThemes[key]
    : presetThemes[key];
  if (preset?.colors) {
    bgColorInput.value = preset.colors.bg;
    paneColorInput.value = preset.colors.pane;
    borderColorInput.value = preset.colors.border;
  }
  applyTheme({
    bgColor: bgColorInput.value,
    paneColor: paneColorInput.value,
    borderColor: borderColorInput.value,
    fontSize: fontSizeInput.value,
    style: themeStyleInput.value,
  });
  persistThemeSettings();
});

// 监听 theme-engine 应用完成事件，同步终端配色
window.addEventListener('vs-theme-applied', () => {
  const termTheme = getTerminalTheme(currentTheme);
  document.querySelectorAll('.terminal-wrap').forEach(wrap => {
    if (wrap._xterm) {
      if (wrap.classList.contains('focused')) {
        wrap._xterm.options.theme = termTheme;
      } else {
        const bg = termTheme.background || '#000000';
        wrap._xterm.options.theme = { ...termTheme, cursor: bg, cursorAccent: bg };
      }
    }
  });
});

// 语言选择器
const langSelector = document.getElementById('langSelector');
if (langSelector) {
  langSelector.addEventListener('change', async () => {
    const newLocale = langSelector.value;
    await window.i18n.setLocale(newLocale);
    window.i18n.translatePage();
    // 重新渲染动态文本
    if (activeTaskProjectIndex !== null) renderTaskList(activeTaskProjectIndex);
    renderQuotaBar();
    renderStats();
    // 持久化
    if (config) {
      config.locale = newLocale;
      try {
        await fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
      } catch (e) {
        console.error('保存语言偏好失败:', e.message);
      }
    }
  });
}

// 回滚行数实时应用
if (scrollbackSetting) {
  scrollbackSetting.addEventListener('input', () => {
    const val = parseInt(scrollbackSetting.value) || 1000;
    document.querySelectorAll('.terminal-wrap').forEach(wrap => {
      if (wrap._xterm) {
        wrap._xterm.options.scrollback = val;
      }
    });
  });
}

// 循环参数滑块实时显示数值
if (silenceThresholdSetting && silenceThresholdDisplay) {
  silenceThresholdSetting.addEventListener('input', () => {
    silenceThresholdDisplay.textContent = silenceThresholdSetting.value + 's';
  });
}
if (autoPassDelaySetting && autoPassDelayDisplay) {
  autoPassDelaySetting.addEventListener('input', () => {
    autoPassDelayDisplay.textContent = autoPassDelaySetting.value + 's';
  });
}

// 渲染预设主题按钮
function renderPresetThemes() {
  presetThemesEl.innerHTML = '';
  const list = (typeof ThemeEngine !== 'undefined' && ThemeEngine.getPresetList)
    ? ThemeEngine.getPresetList()
    : Object.entries(presetThemes).map(([key, t]) => ({ key, ...t }));
  list.forEach(({ key, name, colors }) => {
    const btn = document.createElement('button');
    btn.className = 'preset-theme-btn';
    btn.style.background = colors?.bg || '#161b22';
    btn.style.borderColor = colors?.border || '#30363d';
    btn.style.color = getContrastColor(colors?.bg || '#161b22');
    btn.title = name;
    btn.textContent = name;
    btn.addEventListener('click', () => {
      const p = presetThemes[key];
      if (p?.colors) {
        bgColorInput.value = p.colors.bg;
        paneColorInput.value = p.colors.pane;
        borderColorInput.value = p.colors.border;
      }
      const theme = {
        bgColor: bgColorInput.value,
        paneColor: paneColorInput.value,
        borderColor: borderColorInput.value,
        fontSize: fontSizeInput.value,
        style: key,
      };
      updateSettingsUI(theme);
      applyTheme(theme);
      persistThemeSettings();
    });
    presetThemesEl.appendChild(btn);
  });
}
renderPresetThemes();

/** 计算并渲染使用统计面板 */
function renderStats() {
  if (!config || !config.projects) return;

  let total = 0, done = 0, idle = 0, dispatched = 0, waiting = 0, blocked = 0;
  let autoFixTotal = 0, withNote = 0;
  const projectRows = [];

  config.projects.forEach((proj, idx) => {
    const tasks = proj.tasks || [];
    const pTotal = tasks.length;
    const pDone = tasks.filter(t => getEffectiveTaskStatus(t, tasks) === 'done').length;
    const pIdle = tasks.filter(t => getEffectiveTaskStatus(t, tasks) === 'idle').length;
    const pWaiting = tasks.filter(t => getEffectiveTaskStatus(t, tasks) === 'waiting').length;
    const pBlocked = tasks.filter(t => getEffectiveTaskStatus(t, tasks) === 'blocked').length;
    const pFix = tasks.reduce((sum, t) => sum + (t.autoFixCount || 0), 0);

    total += pTotal;
    done += pDone;
    idle += pIdle;
    waiting += pWaiting;
    blocked += pBlocked;
    dispatched += tasks.filter(t => getEffectiveTaskStatus(t, tasks) === 'dispatched').length;
    autoFixTotal += pFix;
    withNote += tasks.filter(t => t.verificationNote).length;

    projectRows.push(`
      <tr>
        <td><span class="stats-dot" style="background:${proj.color || '#888'}"></span>${escapeHtml(proj.name)}</td>
        <td>${pTotal}</td>
        <td>${pDone}</td>
        <td>${pIdle}</td>
        <td>${pWaiting}</td>
        <td>${pBlocked}</td>
        <td>${pFix}</td>
      </tr>
    `);
  });

  statsBody.innerHTML = `
    <div class="stats-summary">
      <div class="stats-card"><div class="stats-num">${total}</div><div class="stats-label">${window.i18n.t('stats.totalTasks')}</div></div>
      <div class="stats-card"><div class="stats-num done">${done}</div><div class="stats-label">${window.i18n.t('stats.completed')}</div></div>
      <div class="stats-card"><div class="stats-num idle">${idle}</div><div class="stats-label">${window.i18n.t('stats.idle')}</div></div>
      <div class="stats-card"><div class="stats-num waiting">${waiting}</div><div class="stats-label">${window.i18n.t('stats.waiting')}</div></div>
      <div class="stats-card"><div class="stats-num blocked">${blocked}</div><div class="stats-label">${window.i18n.t('stats.blocked')}</div></div>
      <div class="stats-card"><div class="stats-num">${autoFixTotal}</div><div class="stats-label">${window.i18n.t('stats.autoFix')}</div></div>
      <div class="stats-card"><div class="stats-num">${withNote}</div><div class="stats-label">${window.i18n.t('stats.manualConfirm')}</div></div>
    </div>
    <table class="stats-table">
      <thead>
        <tr><th>${window.i18n.t('stats.project')}</th><th>${window.i18n.t('stats.total')}</th><th>${window.i18n.t('stats.done')}</th><th>${window.i18n.t('stats.idle')}</th><th>${window.i18n.t('stats.waiting')}</th><th>${window.i18n.t('stats.blocked')}</th><th>${window.i18n.t('stats.autoFix')}</th></tr>
      </thead>
      <tbody>${projectRows.join('')}</tbody>
    </table>
  `;
}

function openStatsPanel() {
  renderStats();
  statsOverlay.classList.add('show');
  statsPanel.classList.add('show');
}

function closeStatsPanel() {
  statsOverlay.classList.remove('show');
  statsPanel.classList.remove('show');
}

if (statsBtn) {
  statsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openStatsPanel();
  });
}
if (statsPanelClose) statsPanelClose.addEventListener('click', closeStatsPanel);
if (statsOverlay) statsOverlay.addEventListener('click', closeStatsPanel);

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle('show');
  closeStatsPanel();
});

if (settingsPanelClose) {
  settingsPanelClose.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.remove('show');
  });
}

document.addEventListener('click', (e) => {
  if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && e.target !== settingsPanelClose) {
    settingsPanel.classList.remove('show');
  }
  if (statsPanel && !statsPanel.contains(e.target) && e.target !== statsBtn) {
    closeStatsPanel();
  }
});

btnResetTheme.addEventListener('click', () => {
  const defaultTheme = { style: 'dark', fontSize: '11', scrollback: 1000 };
  updateSettingsUI(defaultTheme);
  applyTheme(defaultTheme);
});

btnSaveTheme.addEventListener('click', async () => {
  const theme = buildThemeFromInputs();
  const loop = {
    silenceThreshold: parseInt(silenceThresholdSetting?.value) || (config?.loop?.silenceThreshold) || 60,
    autoPassDelay: parseInt(autoPassDelaySetting?.value) || (config?.loop?.autoPassDelay) || 15,
    silenceConfirmCount: parseInt(silenceConfirmCountSetting?.value) || (config?.loop?.silenceConfirmCount) || 2,
    busyExtraSilenceMs: parseInt(busyExtraSilenceMsSetting?.value) || (config?.loop?.busyExtraSilenceMs) || 15000,
    stuckTaskTimeoutMs: parseInt(stuckTaskTimeoutMsSetting?.value) || (config?.loop?.stuckTaskTimeoutMs) || 120000,
    maxAutoFixAttempts: parseInt(maxAutoFixAttemptsSetting?.value) || (config?.loop?.maxAutoFixAttempts) || 3,
    loopIntervalMs: parseInt(loopIntervalMsSetting?.value) ?? (config?.loop?.loopIntervalMs) ?? 1000,
  };
  const cost = {
    inputTokenPrice: parseFloat(inputTokenPriceSetting?.value) ?? (config?.cost?.inputTokenPrice) ?? 3.0,
    outputTokenPrice: parseFloat(outputTokenPriceSetting?.value) ?? (config?.cost?.outputTokenPrice) ?? 15.0,
    cacheTokenPrice: parseFloat(cacheTokenPriceSetting?.value) ?? (config?.cost?.cacheTokenPrice) ?? 0.5,
  };
  if (config) {
    config.theme = theme;
    config.loop = loop;
    config.cost = cost;
    try {
      await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      settingsPanel.classList.remove('show');
    } catch (e) { alert('Save failed: ' + e.message); }
  }
});

// 启动
log('Page loaded, initializing...');
ensureThemeEngine().then(() => {
  loadConfig().then(() => {
    connectWebSocket();
    startQuotaUpdates();
    initQuotaResponsive();
  }).catch((e) => {
    log('Initialization failed: ' + e.message);
  });
}).catch((e) => {
  log('Theme engine failed to load, continuing with fallback: ' + e.message);
  loadConfig().then(() => {
    connectWebSocket();
    startQuotaUpdates();
    initQuotaResponsive();
  }).catch((err) => {
    log('Initialization failed: ' + err.message);
  });
});

// 点击外部关闭配额明细面板
document.addEventListener('click', (e) => {
  if (quotaDetailPanel && quotaDetailPanel.classList.contains('show')) {
    const btn = document.getElementById('quotaDetailBtn');
    if (!quotaDetailPanel.contains(e.target) && e.target !== btn) {
      quotaDetailPanel.classList.remove('show');
    }
  }
});
