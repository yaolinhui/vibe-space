let projects = [];
let selectedColor = '#ff7b72';
let selectedLayout = { rows: 2, cols: 3 };
let selectedAI = 'kimi';
let dragSrcIndex = null;
let loadedConfig = {}; // 缓存从服务器加载的完整配置，用于 Launch 时保留 theme 等设置

const els = {
  projectList: document.getElementById('projectList'),
  emptyTip: document.getElementById('emptyTip'),
  count: document.getElementById('count'),
  nameInput: document.getElementById('projectName'),
  pathInput: document.getElementById('projectPath'),
  btnBrowse: document.getElementById('btnBrowse'),
  btnAdd: document.getElementById('btnAdd'),
  btnLaunch: document.getElementById('btnLaunch'),
  btnBack: document.getElementById('btnBack'),
  colorPicker: document.getElementById('colorPicker'),
  aiOptions: document.getElementById('aiOptions'),
  apiKeyRow: document.getElementById('apiKeyRow'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  layoutPreviewPanel: document.getElementById('layoutPreviewPanel'),
  layoutPreviewGrid: document.getElementById('layoutPreviewGrid'),
  startupCommand: document.getElementById('startupCommand'),
  scrollback: document.getElementById('scrollback'),
  silenceThreshold: document.getElementById('silenceThreshold'),
  silenceThresholdVal: document.getElementById('silenceThresholdVal'),
  autoPassDelay: document.getElementById('autoPassDelay'),
  autoPassDelayVal: document.getElementById('autoPassDelayVal'),
  btnExport: document.getElementById('btnExport'),
  btnImport: document.getElementById('btnImport'),
  importFileInput: document.getElementById('importFileInput'),
  btnExportFooter: document.getElementById('btnExportFooter'),
  btnImportFooter: document.getElementById('btnImportFooter'),
  importFileInputFooter: document.getElementById('importFileInputFooter'),
};

/** 在配置页应用用户保存的主题 */
function applySetupTheme(theme) {
  if (!theme) return;
  if (typeof ThemeEngine !== 'undefined') {
    ThemeEngine.applyTheme(theme);
  }
  // 兼容旧配置：若用户手动指定了颜色，覆盖变量
  const root = document.documentElement;
  if (theme.bgColor) root.style.setProperty('--vs-bg', theme.bgColor);
  if (theme.paneColor) {
    root.style.setProperty('--vs-pane', theme.paneColor);
    root.style.setProperty('--vs-task-panel', theme.paneColor);
    root.style.setProperty('--vs-settings-panel', theme.paneColor);
    root.style.setProperty('--vs-stats-panel', theme.paneColor);
  }
  if (theme.borderColor) root.style.setProperty('--vs-border', theme.borderColor);
}

// 若 theme-engine.js 因缓存未加载，动态补加载
function ensureThemeEngine() {
  if (typeof ThemeEngine !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/theme-engine.js?v=30';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load theme-engine.js'));
    document.head.appendChild(script);
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    loadedConfig = config || {};

    // 先应用主题，再应用语言，避免文字颜色不匹配
    if (config.theme) {
      applySetupTheme(config.theme);
    }

    // 加载并应用保存的语言
    if (config.locale) {
      await window.i18n.setLocale(config.locale);
      const langSelector = document.getElementById('langSelector');
      if (langSelector) langSelector.value = config.locale;
    }
    window.i18n.translatePage();

    if (config.projects && config.projects.length > 0) {
      projects = config.projects.map(p => ({
        ...p,
        tasks: p.tasks || []
      }));
      renderList();
    }
    if (config.layout) selectedLayout = config.layout;
    if (config.ai) {
      selectedAI = config.ai.provider || 'kimi';
      updateAISelection();
      if (config.ai.apiKey) els.apiKeyInput.value = config.ai.apiKey;
    }
    // 加载高级设置
    if (config.startupCommand !== undefined) {
      els.startupCommand.value = config.startupCommand;
    }
    if (config.theme) {
      if (config.theme.scrollback !== undefined) els.scrollback.value = config.theme.scrollback;
    }
    if (config.loop) {
      if (config.loop.silenceThreshold !== undefined) {
        els.silenceThreshold.value = config.loop.silenceThreshold;
        els.silenceThresholdVal.textContent = config.loop.silenceThreshold + 's';
      } else {
        els.silenceThreshold.value = 60;
        els.silenceThresholdVal.textContent = '60s';
      }
      if (config.loop.autoPassDelay !== undefined) {
        els.autoPassDelay.value = config.loop.autoPassDelay;
        els.autoPassDelayVal.textContent = config.loop.autoPassDelay + 's';
      }
    } else {
      els.silenceThreshold.value = 30;
      els.silenceThresholdVal.textContent = '30s';
    }
    updateLayoutButtons();
    renderLayoutPreview();
  } catch (e) {
    console.log('No existing config');
  }
}

// AI 选择
els.aiOptions.addEventListener('click', (e) => {
  const option = e.target.closest('.ai-option');
  if (!option) return;
  els.aiOptions.querySelectorAll('.ai-option').forEach(o => o.classList.remove('active'));
  option.classList.add('active');
  selectedAI = option.dataset.provider;
  els.apiKeyRow.style.display = selectedAI === 'claude' ? 'block' : 'none';
});

function updateAISelection() {
  els.aiOptions.querySelectorAll('.ai-option').forEach(o => {
    o.classList.toggle('active', o.dataset.provider === selectedAI);
  });
  els.apiKeyRow.style.display = selectedAI === 'claude' ? 'block' : 'none';
}

// 颜色选择
els.colorPicker.addEventListener('click', (e) => {
  const option = e.target.closest('.color-option');
  if (!option) return;
  els.colorPicker.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
  option.classList.add('active');
  selectedColor = option.dataset.color;
});

// 浏览文件夹
els.btnBrowse.addEventListener('click', async () => {
  els.btnBrowse.disabled = true;
  const originalText = els.btnBrowse.textContent;
  els.btnBrowse.textContent = window.i18n.t('setup.browseDialog');
  try {
    const res = await fetch('/api/select-folder', { method: 'POST' });
    const data = await res.json();
    if (data.path) {
      els.pathInput.value = data.path;
      els.btnBrowse.textContent = window.i18n.t('setup.selected');
      if (!els.nameInput.value) {
        const parts = data.path.replace(/\\/g, '/').split('/').filter(Boolean);
        els.nameInput.value = parts[parts.length - 1] || '';
      }
    } else if (data.cancelled) {
      els.btnBrowse.textContent = window.i18n.t('setup.cancelled');
    } else if (data.error) {
      alert(window.i18n.t('setup.error') + ': ' + data.error);
    }
  } catch (e) {
    alert(window.i18n.t('setup.folderSelectFailed') + '\n' + e.message);
  }
  setTimeout(() => {
    els.btnBrowse.textContent = originalText;
    els.btnBrowse.disabled = false;
  }, 1200);
});

// 添加项目
els.btnAdd.addEventListener('click', () => {
  const name = els.nameInput.value.trim();
  const cwd = els.pathInput.value.trim();
  if (!name) { alert(window.i18n.t('setup.nameRequired')); return; }
  if (!cwd) { alert(window.i18n.t('setup.pathRequired')); return; }
  projects.push({ name, cwd, color: selectedColor, tasks: [] });
  renderList();
  renderLayoutPreview();
  els.nameInput.value = '';
  els.pathInput.value = '';
  els.nameInput.focus();
});

els.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.btnAdd.click();
});

// Range 滑块实时显示数值
els.silenceThreshold.addEventListener('input', () => {
  els.silenceThresholdVal.textContent = els.silenceThreshold.value + 's';
});
els.autoPassDelay.addEventListener('input', () => {
  els.autoPassDelayVal.textContent = els.autoPassDelay.value + 's';
});

function removeProject(index) {
  if (!confirm(window.i18n.t('setup.deleteProjectConfirm', { name: projects[index].name }))) return;
  projects.splice(index, 1);
  renderList();
  renderLayoutPreview();
}

function renderList() {
  els.projectList.innerHTML = '';
  els.count.textContent = projects.length;
  if (projects.length === 0) {
    els.emptyTip.style.display = 'block';
    els.btnLaunch.disabled = true;
    els.layoutPreviewPanel.style.display = 'none';
    return;
  }
  els.emptyTip.style.display = 'none';
  els.btnLaunch.disabled = false;
  els.layoutPreviewPanel.style.display = 'block';

  projects.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.dataset.index = i;
    item.draggable = true;
    item.innerHTML = `
      <span class="drag-handle" title="${window.i18n.t('setup.layoutPreviewHint')}">⋮⋮</span>
      <div class="dot" style="background:${p.color}"></div>
      <div class="info">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="path">${escapeHtml(p.cwd)}</div>
      </div>
      <button class="btn-remove" title="${window.i18n.t('common.delete')}">✕</button>
    `;
    item.querySelector('.btn-remove').addEventListener('click', () => removeProject(i));

    // 项目列表拖拽事件
    item.addEventListener('dragstart', (e) => {
      dragSrcIndex = i;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (i !== dragSrcIndex) item.style.borderColor = '#58a6ff';
    });
    item.addEventListener('dragleave', (e) => {
      item.style.borderColor = '';
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', (e) => {
      e.stopPropagation();
      item.style.borderColor = '';
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      // 移动项目：从源位置移除并插入到目标位置
      const [moved] = projects.splice(dragSrcIndex, 1);
      projects.splice(i, 0, moved);
      renderList();
      renderLayoutPreview();
      return false;
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.project-item').forEach(el => el.style.borderColor = '');
    });

    els.projectList.appendChild(item);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ========== 布局预览 + 拖拽排序 ========== */

function renderLayoutPreview() {
  const grid = els.layoutPreviewGrid;
  grid.innerHTML = '';
  grid.style.gridTemplateRows = `repeat(${selectedLayout.rows}, 1fr)`;
  grid.style.gridTemplateColumns = `repeat(${selectedLayout.cols}, 1fr)`;

  // 更新标题显示当前布局
  const titleEl = document.getElementById('layoutPreviewTitle');
  if (titleEl) {
    titleEl.textContent = '🎛️ ' + window.i18n.t('setup.layoutPreview', { rows: selectedLayout.rows, cols: selectedLayout.cols });
  }

  const total = selectedLayout.rows * selectedLayout.cols;
  for (let i = 0; i < total; i++) {
    const slot = document.createElement('div');
    slot.className = 'layout-slot';
    slot.dataset.index = i;
    slot.draggable = true;

    if (projects[i]) {
      slot.innerHTML = `<span class="slot-dot" style="background:${projects[i].color}"></span>${escapeHtml(projects[i].name)}`;
    } else {
      slot.classList.add('empty');
      slot.textContent = window.i18n.t('setup.empty');
      slot.draggable = false;
    }

    slot.addEventListener('dragstart', handleDragStart);
    slot.addEventListener('dragenter', handleDragEnter);
    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('dragleave', handleDragLeave);
    slot.addEventListener('drop', handleDrop);
    slot.addEventListener('dragend', handleDragEnd);

    grid.appendChild(slot);
  }
}

function handleDragStart(e) {
  dragSrcIndex = parseInt(this.dataset.index);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.classList.add('drag-over');
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  e.stopPropagation();
  const targetIndex = parseInt(this.dataset.index);
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
  if (!projects[dragSrcIndex]) return;

  // 移动 projects 数组：从源位置移除并插入到目标位置
  const [moved] = projects.splice(dragSrcIndex, 1);
  // splice 移除后，若目标索引在源之后，需减 1 补偿
  const insertIndex = dragSrcIndex < targetIndex ? targetIndex - 1 : targetIndex;
  projects.splice(insertIndex, 0, moved);

  renderList();
  renderLayoutPreview();
  return false;
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  document.querySelectorAll('.layout-slot').forEach(s => s.classList.remove('drag-over'));
}

// 布局选择
document.querySelectorAll('.layout-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLayout = { rows: parseInt(btn.dataset.rows), cols: parseInt(btn.dataset.cols) };
    renderLayoutPreview();
  });
});

function updateLayoutButtons() {
  document.querySelectorAll('.layout-btn').forEach(btn => {
    const r = parseInt(btn.dataset.rows), c = parseInt(btn.dataset.cols);
    btn.classList.toggle('active', r === selectedLayout.rows && c === selectedLayout.cols);
  });
}

// 启动
els.btnLaunch.addEventListener('click', async () => {
  if (projects.length === 0) return;
  if (selectedAI === 'claude' && !els.apiKeyInput.value.trim()) {
    alert(window.i18n.t('setup.apiKeyRequired'));
    els.apiKeyInput.focus();
    return;
  }

  els.btnLaunch.disabled = true;
  els.btnLaunch.textContent = window.i18n.t('setup.saving');

  const aiConfig = { provider: selectedAI };
  if (selectedAI === 'claude') {
    aiConfig.apiKey = els.apiKeyInput.value.trim();
  }

  // 确保 projects 有稳定 id
  const projectsWithIds = projects.map((p, i) => ({
    ...p,
    id: p.id ?? loadedConfig?.projects?.[i]?.id ?? i,
  }));

  // 保留已有 panes，为新增项目创建 pane
  let panes = loadedConfig?.panes ? JSON.parse(JSON.stringify(loadedConfig.panes)) : [];
  const projectIdSet = new Set(projectsWithIds.map(p => p.id));
  panes = panes.filter(pane => projectIdSet.has(pane.projectId));
  const usedPaneProjectIds = new Set(panes.map(p => p.projectId));
  let nextPaneId = loadedConfig?.nextPaneId ?? panes.length;
  projectsWithIds.forEach(p => {
    if (!usedPaneProjectIds.has(p.id)) {
      panes.push({
        id: nextPaneId++,
        projectId: p.id,
        tasks: [],
        loopAutoReset: true,
      });
    }
  });

  const payload = {
    layout: selectedLayout,
    projects: projectsWithIds,
    panes,
    nextPaneId,
    ai: aiConfig,
    startupCommand: els.startupCommand.value.trim() || '',
    theme: {
      ...(loadedConfig?.theme || {}),
      fontSize: loadedConfig?.theme?.fontSize || 11,
      scrollback: parseInt(els.scrollback.value) || (loadedConfig?.theme?.scrollback) || 1000,
      showScrollbar: loadedConfig?.theme?.showScrollbar ?? false
    },
    loop: {
      silenceThreshold: parseInt(els.silenceThreshold.value) || (loadedConfig?.loop?.silenceThreshold) || 60,
      autoPassDelay: parseInt(els.autoPassDelay.value) || (loadedConfig?.loop?.autoPassDelay) || 15,
      silenceConfirmCount: loadedConfig?.loop?.silenceConfirmCount || 2,
      busyExtraSilenceMs: loadedConfig?.loop?.busyExtraSilenceMs || 15000,
      stuckTaskTimeoutMs: loadedConfig?.loop?.stuckTaskTimeoutMs || 120000,
      maxAutoFixAttempts: loadedConfig?.loop?.maxAutoFixAttempts || 3,
    }
  };

  try {
    const res = await fetch('/api/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      window.location.href = '/workspace';
    } else {
      const err = await res.text();
      alert(window.i18n.t('setup.saveError') + err);
      els.btnLaunch.disabled = false;
      els.btnLaunch.textContent = '🚀 ' + window.i18n.t('setup.saveAndLaunch');
    }
  } catch (e) {
    alert(window.i18n.t('setup.networkError') + e.message);
    els.btnLaunch.disabled = false;
    els.btnLaunch.textContent = '🚀 ' + window.i18n.t('setup.saveAndLaunch');
  }
});

/* ========== 导入/导出配置 ========== */

async function exportConfig() {
  try {
    const res = await fetch('/api/config');
    const configData = await res.json();
    const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vibe-space-config-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(window.i18n.t('setup.exportFailed') + e.message);
  }
}

els.btnExport.addEventListener('click', exportConfig);
if (els.btnExportFooter) els.btnExportFooter.addEventListener('click', exportConfig);

els.btnImport.addEventListener('click', () => {
  els.importFileInput.click();
});
if (els.btnImportFooter) els.btnImportFooter.addEventListener('click', () => {
  els.importFileInputFooter.click();
});

async function importConfigFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!imported.projects || !Array.isArray(imported.projects)) {
      alert(window.i18n.t('setup.importError'));
      return;
    }
    if (!confirm(window.i18n.t('setup.importConfirm', { count: imported.projects.length }))) {
      return;
    }
    const res = await fetch('/api/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(imported)
    });
    if (res.ok) {
      // 重新加载服务端迁移后的配置，确保本地状态与 V2 形状一致
      try {
        const fresh = await (await fetch('/api/config')).json();
        loadedConfig = fresh;
        projects = (fresh.projects || []).map(p => ({ ...p }));
      } catch (_) {
        projects = imported.projects.map(p => ({
          ...p,
          tasks: p.tasks || []
        }));
      }
      renderList();
      renderLayoutPreview();
      if (loadedConfig?.layout) selectedLayout = loadedConfig.layout;
      if (imported.layout) selectedLayout = imported.layout;
      if (imported.ai) {
        selectedAI = imported.ai.provider || 'kimi';
        updateAISelection();
        if (imported.ai.apiKey) els.apiKeyInput.value = imported.ai.apiKey;
      }
      if (imported.startupCommand !== undefined) els.startupCommand.value = imported.startupCommand;
      if (imported.theme?.scrollback !== undefined) els.scrollback.value = imported.theme.scrollback;
      if (imported.loop?.silenceThreshold !== undefined) {
        els.silenceThreshold.value = imported.loop.silenceThreshold;
        els.silenceThresholdVal.textContent = imported.loop.silenceThreshold + 's';
      }
      if (imported.loop?.autoPassDelay !== undefined) {
        els.autoPassDelay.value = imported.loop.autoPassDelay;
        els.autoPassDelayVal.textContent = imported.loop.autoPassDelay + 's';
      }
      alert(window.i18n.t('setup.importSuccess'));
    } else {
      alert(window.i18n.t('setup.importSaveFailed'));
    }
  } catch (e) {
    alert(window.i18n.t('setup.importFailed') + e.message);
  }
}

els.importFileInput.addEventListener('change', async () => {
  await importConfigFromFile(els.importFileInput.files[0]);
  els.importFileInput.value = '';
});

if (els.importFileInputFooter) {
  els.importFileInputFooter.addEventListener('change', async () => {
    await importConfigFromFile(els.importFileInputFooter.files[0]);
    els.importFileInputFooter.value = '';
  });
}

// 返回工作区
if (els.btnBack) {
  els.btnBack.addEventListener('click', () => {
    if (loadedConfig.projects && loadedConfig.projects.length > 0) {
      window.location.href = '/workspace';
    } else {
      window.history.back();
    }
  });
}

// 语言选择器
const langSelector = document.getElementById('langSelector');
if (langSelector) {
  langSelector.addEventListener('change', async () => {
    const newLocale = langSelector.value;
    await window.i18n.setLocale(newLocale);
    window.i18n.translatePage();
    // 持久化到 config
    const cfg = { ...(loadedConfig || {}), locale: newLocale };
    try {
      await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      loadedConfig.locale = newLocale;
    } catch (e) {
      console.error('保存语言偏好失败:', e.message);
    }
  });
}

ensureThemeEngine().then(() => loadConfig()).catch((e) => {
  console.warn('Theme engine failed to load, continuing with fallback:', e.message);
  loadConfig();
});
