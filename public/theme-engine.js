/**
 * Vibe Space - Theme Engine
 * Defines deep, immersive presets and applies them via CSS custom properties.
 */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Default CSS variable fallback values (Dark / GitHub-style)
  // ---------------------------------------------------------------------------
  const defaultVars = {
    '--vs-bg': '#0d1117',
    '--vs-bg-gradient': 'none',
    '--vs-bg-overlay': 'none',

    '--vs-pane': '#161b22',
    '--vs-pane-gradient': 'none',
    '--vs-pane-header': '#0d1117',
    '--vs-pane-header-border': '#30363d',

    '--vs-surface': '#21262d',
    '--vs-surface-hover': '#30363d',
    '--vs-surface-elevated': '#161b22',

    '--vs-border': '#30363d',
    '--vs-border-hover': '#484f58',
    '--vs-border-active': '#58a6ff',
    '--vs-divider': '#30363d',

    '--vs-text': '#c9d1d9',
    '--vs-text-strong': '#f0f6fc',
    '--vs-text-muted': '#8b949e',
    '--vs-text-disabled': '#6e7681',

    '--vs-accent': '#58a6ff',
    '--vs-accent-hover': '#79c0ff',
    '--vs-accent-soft': 'rgba(88, 166, 255, 0.12)',

    '--vs-success': '#238636',
    '--vs-success-hover': '#2ea043',
    '--vs-success-bright': '#3fb950',
    '--vs-success-soft': 'rgba(63, 185, 80, 0.12)',

    '--vs-warning': '#e3b341',
    '--vs-warning-hover': '#f0d76a',
    '--vs-warning-soft': 'rgba(227, 179, 65, 0.12)',

    '--vs-danger': '#ff7b72',
    '--vs-danger-hover': '#f85149',
    '--vs-danger-soft': 'rgba(255, 123, 114, 0.12)',

    '--vs-purple': '#8957e5',
    '--vs-purple-hover': '#a371f7',

    '--vs-radius': '6px',
    '--vs-border-width': '1px',
    '--vs-shadow': 'none',
    '--vs-glass': '0',
    '--vs-body-font': "'Segoe UI', system-ui, -apple-system, sans-serif",
    '--vs-mono-font': "'Consolas', 'Courier New', monospace",

    '--vs-task-panel': '#161b22',
    '--vs-settings-panel': '#161b22',
    '--vs-stats-panel': '#161b22',
  };

  // ---------------------------------------------------------------------------
  // Terminal ANSI palettes
  // ---------------------------------------------------------------------------
  const palettes = {
    dark: {
      foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#264f78',
      black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#e3b341',
      blue: '#58a6ff', magenta: '#f778ba', cyan: '#39c5cf', white: '#f0f6fc',
      brightBlack: '#484f58', brightRed: '#ff9a8b', brightGreen: '#7ee787',
      brightYellow: '#f0d76a', brightBlue: '#79c0ff', brightMagenta: '#ff9eb5',
      brightCyan: '#a5f3fc', brightWhite: '#ffffff'
    },
    obsidian: {
      foreground: '#e6edf3', cursor: '#ffffff', selectionBackground: '#31363b',
      black: '#000000', red: '#ff5f56', green: '#27c93f', yellow: '#ffbd2e',
      blue: '#58a6ff', magenta: '#ff8ff2', cyan: '#56d4dd', white: '#ffffff',
      brightBlack: '#333333', brightRed: '#ff8884', brightGreen: '#5be47b',
      brightYellow: '#ffd76d', brightBlue: '#85c2ff', brightMagenta: '#ffb8f0',
      brightCyan: '#7ee9f0', brightWhite: '#ffffff'
    },
    blue: {
      foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#1e3a5f',
      black: '#0c162d', red: '#ff7b72', green: '#3fb950', yellow: '#e3b341',
      blue: '#58a6ff', magenta: '#f778ba', cyan: '#39c5cf', white: '#f0f6fc',
      brightBlack: '#1e3a5f', brightRed: '#ff9a8b', brightGreen: '#7ee787',
      brightYellow: '#f0d76a', brightBlue: '#79c0ff', brightMagenta: '#ff9eb5',
      brightCyan: '#a5f3fc', brightWhite: '#ffffff'
    },
    sakura: {
      foreground: '#f0d5dd', cursor: '#ff9eb5', selectionBackground: '#5a444d',
      black: '#2a1f24', red: '#ff7b72', green: '#9be9a8', yellow: '#f2d5a3',
      blue: '#79c0ff', magenta: '#ff9eb5', cyan: '#a5d6ff', white: '#fff0f3',
      brightBlack: '#5a444d', brightRed: '#ff9a8b', brightGreen: '#b4f0be',
      brightYellow: '#f9e4b7', brightBlue: '#a5d6ff', brightMagenta: '#ffb8c9',
      brightCyan: '#c3e6ff', brightWhite: '#ffffff'
    },
    cottonCandy: {
      foreground: '#e8e5ff', cursor: '#c4b5ff', selectionBackground: '#5a5687',
      black: '#2d2a4a', red: '#ff9eb5', green: '#a5f0c4', yellow: '#ffe4a1',
      blue: '#a5b4ff', magenta: '#ff9eb5', cyan: '#a5f3fc', white: '#f0f0ff',
      brightBlack: '#5a5687', brightRed: '#ffb8c9', brightGreen: '#c9f9dc',
      brightYellow: '#fff0c2', brightBlue: '#c9d2ff', brightMagenta: '#ffb8c9',
      brightCyan: '#c3f6ff', brightWhite: '#ffffff'
    },
    catppuccin: {
      foreground: '#cdd6f4', cursor: '#f5c2e7', selectionBackground: '#45475a',
      black: '#1e1e2e', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
      blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
      brightBlack: '#45475a', brightRed: '#f5a0bf', brightGreen: '#b9f4b6',
      brightYellow: '#fae7b9', brightBlue: '#a0c3ff', brightMagenta: '#f8d2ed',
      brightCyan: '#a8f0e1', brightWhite: '#ffffff'
    },
    tokyoNight: {
      foreground: '#a9b1d6', cursor: '#7aa2f7', selectionBackground: '#414868',
      black: '#1a1b26', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
      brightBlack: '#414868', brightRed: '#f98fa5', brightGreen: '#b5d68d',
      brightYellow: '#f0c585', brightBlue: '#95b5ff', brightMagenta: '#d0b5ff',
      brightCyan: '#9edbff', brightWhite: '#ffffff'
    },
    cyberpunk: {
      foreground: '#f0e9ff', cursor: '#ff00ff', selectionBackground: '#4a1c5c',
      black: '#0d0221', red: '#ff2a6d', green: '#05ffa1', yellow: '#ffee00',
      blue: '#00f0ff', magenta: '#ff00ff', cyan: '#00f0ff', white: '#d1d5ff',
      brightBlack: '#4a1c5c', brightRed: '#ff5c8a', brightGreen: '#5cffc4',
      brightYellow: '#fff56d', brightBlue: '#5cf6ff', brightMagenta: '#ff5cff',
      brightCyan: '#5cf6ff', brightWhite: '#ffffff'
    },
    matrix: {
      foreground: '#00ff41', cursor: '#00ff41', selectionBackground: '#1f2f1f',
      black: '#0a0f0a', red: '#ff5555', green: '#00ff41', yellow: '#ffff55',
      blue: '#55ffff', magenta: '#ff55ff', cyan: '#55ffff', white: '#ccffcc',
      brightBlack: '#1f2f1f', brightRed: '#ff8888', brightGreen: '#55ff77',
      brightYellow: '#ffff88', brightBlue: '#88ffff', brightMagenta: '#ff88ff',
      brightCyan: '#88ffff', brightWhite: '#ffffff'
    },
    dracula: {
      foreground: '#f8f8f2', cursor: '#ff79c6', selectionBackground: '#6272a4',
      black: '#282a36', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#8be9fd', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#a4ffff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff'
    },
    everforest: {
      foreground: '#d3c6aa', cursor: '#a7c080', selectionBackground: '#4a555b',
      black: '#2b3339', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f',
      blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#d3c6aa',
      brightBlack: '#4a555b', brightRed: '#f28e90', brightGreen: '#b9cf9a',
      brightYellow: '#ead29c', brightBlue: '#9ac8c1', brightMagenta: '#e6b3cd',
      brightCyan: '#9fd2a8', brightWhite: '#fdf6e3'
    },
    nord: {
      foreground: '#d8dee9', cursor: '#88c0d0', selectionBackground: '#4c566a',
      black: '#2e3440', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#d08770', brightGreen: '#b5cea8',
      brightYellow: '#f0d399', brightBlue: '#9ec3e8', brightMagenta: '#c7a9c3',
      brightCyan: '#a3d6e3', brightWhite: '#ffffff'
    },
    light: {
      foreground: '#3d3a36', cursor: '#7a6f5b', selectionBackground: '#d6d0c7',
      black: '#f7f3ed', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
      blue: '#0969da', magenta: '#bf3989', cyan: '#0a7a7a', white: '#24292f',
      brightBlack: '#8c959f', brightRed: '#fa4549', brightGreen: '#2da44e',
      brightYellow: '#bf8700', brightBlue: '#218bff', brightMagenta: '#db61a2',
      brightCyan: '#319795', brightWhite: '#1f2328'
    },
    paper: {
      foreground: '#24292f', cursor: '#0969da', selectionBackground: '#b6e3ff',
      black: '#ffffff', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
      blue: '#0969da', magenta: '#bf3989', cyan: '#0a7a7a', white: '#1f2328',
      brightBlack: '#6e7781', brightRed: '#fa4549', brightGreen: '#2da44e',
      brightYellow: '#bf8700', brightBlue: '#218bff', brightMagenta: '#db61a2',
      brightCyan: '#319795', brightWhite: '#000000'
    },
    sepia: {
      foreground: '#433422', cursor: '#8b5e3c', selectionBackground: '#d7c9a8',
      black: '#f4ecd8', red: '#b35959', green: '#4a7c59', yellow: '#8c6b2f',
      blue: '#4a6fa5', magenta: '#9a5a8f', cyan: '#3d7a7a', white: '#2d2418',
      brightBlack: '#9e8b6f', brightRed: '#c96a6a', brightGreen: '#5c9a6e',
      brightYellow: '#a6803c', brightBlue: '#5a86c5', brightMagenta: '#b06aa0',
      brightCyan: '#4a9090', brightWhite: '#1a140d'
    },
  };

  // ---------------------------------------------------------------------------
  // Preset themes
  // ---------------------------------------------------------------------------
  const presetThemes = {
    dark: {
      name: '深色',
      category: 'base',
      colors: {
        bg: '#0d1117', pane: '#161b22', paneHeader: '#0d1117',
        taskPanel: '#161b22', settingsPanel: '#161b22', statsPanel: '#161b22',
        surface: '#21262d', surfaceHover: '#30363d', surfaceElevated: '#161b22',
        border: '#30363d', borderHover: '#484f58', borderActive: '#58a6ff',
        text: '#c9d1d9', textStrong: '#f0f6fc', textMuted: '#8b949e', textDisabled: '#6e7681',
        accent: '#58a6ff', accentHover: '#79c0ff',
        success: '#238636', successHover: '#2ea043', successBright: '#3fb950',
        warning: '#e3b341', warningHover: '#f0d76a',
        danger: '#ff7b72', dangerHover: '#f85149',
        purple: '#8957e5', purpleHover: '#a371f7',
        terminal: palettes.dark,
      },
      ui: { borderRadius: 6, borderWidth: 1, glass: 0, shadow: 'none' },
      effects: { background: 'none', intensity: 0, paneGlow: 'none', overlay: 'none' }
    },

    obsidian: {
      name: '黑曜石',
      category: 'base',
      colors: {
        bg: '#000000', pane: '#0a0a0a', paneHeader: '#000000',
        taskPanel: '#0a0a0a', settingsPanel: '#0a0a0a', statsPanel: '#0a0a0a',
        surface: '#141414', surfaceHover: '#1f1f1f', surfaceElevated: '#0a0a0a',
        border: '#1a1a1a', borderHover: '#333333', borderActive: '#ffffff',
        text: '#e6edf3', textStrong: '#ffffff', textMuted: '#8c959f', textDisabled: '#555555',
        accent: '#ffffff', accentHover: '#e6edf3',
        success: '#27c93f', successHover: '#4cd964', successBright: '#4cd964',
        warning: '#ffbd2e', warningHover: '#ffd76d',
        danger: '#ff5f56', dangerHover: '#ff8884',
        purple: '#bd93f9', purpleHover: '#d4b5ff',
        terminal: palettes.obsidian,
      },
      ui: { borderRadius: 4, borderWidth: 1, glass: 0, shadow: 'none' },
      effects: { background: 'none', intensity: 0, paneGlow: 'none', overlay: 'none' }
    },

    blue: {
      name: '深蓝',
      category: 'base',
      colors: {
        bg: '#0c162d', pane: '#111d3b', paneHeader: '#0c162d',
        taskPanel: '#111d3b', settingsPanel: '#111d3b', statsPanel: '#111d3b',
        surface: '#162044', surfaceHover: '#1e3a5f', surfaceElevated: '#111d3b',
        border: '#1e3a5f', borderHover: '#2f5491', borderActive: '#58a6ff',
        text: '#c9d1d9', textStrong: '#f0f6fc', textMuted: '#8b949e', textDisabled: '#5a6f8f',
        accent: '#58a6ff', accentHover: '#79c0ff',
        success: '#238636', successHover: '#2ea043', successBright: '#3fb950',
        warning: '#e3b341', warningHover: '#f0d76a',
        danger: '#ff7b72', dangerHover: '#f85149',
        purple: '#8957e5', purpleHover: '#a371f7',
        terminal: palettes.blue,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0, shadow: '0 4px 20px rgba(0,0,0,0.4)' },
      effects: { background: 'none', intensity: 0, paneGlow: 'subtle-blue', overlay: 'vignette-soft' }
    },

    sakura: {
      name: '樱花',
      category: 'cute',
      colors: {
        bg: '#2a1f24', pane: '#3d2e35', paneHeader: '#2a1f24',
        taskPanel: '#32252b', settingsPanel: '#32252b', statsPanel: '#32252b',
        surface: '#4a3a40', surfaceHover: '#5a464d', surfaceElevated: '#3d2e35',
        border: '#5a444d', borderHover: '#7a5a65', borderActive: '#ff9eb5',
        text: '#f0d5dd', textStrong: '#fff0f3', textMuted: '#b895a0', textDisabled: '#7a5a65',
        accent: '#ff9eb5', accentHover: '#ffb8c9',
        success: '#9be9a8', successHover: '#b4f0be', successBright: '#b4f0be',
        warning: '#f2d5a3', warningHover: '#f9e4b7',
        danger: '#ff7b72', dangerHover: '#ff9a8b',
        purple: '#d699b6', purpleHover: '#e6b3cd',
        terminal: palettes.sakura,
      },
      ui: { borderRadius: 12, borderWidth: 1, glass: 0.08, shadow: '0 4px 24px rgba(0,0,0,0.35)' },
      effects: { background: 'sakura-fall', intensity: 0.7, paneGlow: 'subtle-pink', overlay: 'vignette-soft' }
    },

    cottonCandy: {
      name: '棉花糖',
      category: 'cute',
      colors: {
        bg: '#2d2a4a', pane: '#3e3b66', paneHeader: '#2d2a4a',
        taskPanel: '#3e3b66', settingsPanel: '#3e3b66', statsPanel: '#3e3b66',
        surface: '#4e4b7a', surfaceHover: '#5a5687', surfaceElevated: '#3e3b66',
        border: '#5a5687', borderHover: '#7a75a8', borderActive: '#c4b5ff',
        text: '#e8e5ff', textStrong: '#f0f0ff', textMuted: '#b8b5e0', textDisabled: '#7a75a8',
        accent: '#c4b5ff', accentHover: '#d9d0ff',
        success: '#a5f0c4', successHover: '#c9f9dc', successBright: '#c9f9dc',
        warning: '#ffe4a1', warningHover: '#fff0c2',
        danger: '#ff9eb5', dangerHover: '#ffb8c9',
        purple: '#d0b5ff', purpleHover: '#e2d4ff',
        terminal: palettes.cottonCandy,
      },
      ui: { borderRadius: 14, borderWidth: 1, glass: 0.1, shadow: '0 4px 24px rgba(0,0,0,0.35)' },
      effects: { background: 'float-dots', intensity: 0.5, paneGlow: 'subtle-purple', overlay: 'vignette-soft' }
    },

    catppuccin: {
      name: '猫布奇诺',
      category: 'modern',
      colors: {
        bg: '#1e1e2e', pane: '#313244', paneHeader: '#181825',
        taskPanel: '#313244', settingsPanel: '#313244', statsPanel: '#313244',
        surface: '#45475a', surfaceHover: '#585b70', surfaceElevated: '#313244',
        border: '#45475a', borderHover: '#585b70', borderActive: '#89b4fa',
        text: '#cdd6f4', textStrong: '#ffffff', textMuted: '#a6adc8', textDisabled: '#6c7086',
        accent: '#89b4fa', accentHover: '#b4befe',
        success: '#a6e3a1', successHover: '#b9f4b6', successBright: '#a6e3a1',
        warning: '#f9e2af', warningHover: '#fae7b9',
        danger: '#f38ba8', dangerHover: '#f5a0bf',
        purple: '#cba6f7', purpleHover: '#d0b5ff',
        terminal: palettes.catppuccin,
      },
      ui: { borderRadius: 10, borderWidth: 1, glass: 0, shadow: '0 4px 20px rgba(0,0,0,0.35)' },
      effects: { background: 'none', intensity: 0, paneGlow: 'subtle-blue', overlay: 'none' }
    },

    tokyoNight: {
      name: '东京夜',
      category: 'geek',
      colors: {
        bg: '#1a1b26', pane: '#24283b', paneHeader: '#16161e',
        taskPanel: '#24283b', settingsPanel: '#24283b', statsPanel: '#24283b',
        surface: '#2f344d', surfaceHover: '#414868', surfaceElevated: '#24283b',
        border: '#414868', borderHover: '#565f89', borderActive: '#7aa2f7',
        text: '#a9b1d6', textStrong: '#c0caf5', textMuted: '#565f89', textDisabled: '#414868',
        accent: '#7aa2f7', accentHover: '#95b5ff',
        success: '#9ece6a', successHover: '#b5d68d', successBright: '#9ece6a',
        warning: '#e0af68', warningHover: '#f0c585',
        danger: '#f7768e', dangerHover: '#f98fa5',
        purple: '#bb9af7', purpleHover: '#d0b5ff',
        terminal: palettes.tokyoNight,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0, shadow: '0 4px 20px rgba(0,0,0,0.4)' },
      effects: { background: 'rain-lines', intensity: 0.5, paneGlow: 'subtle-cyan', overlay: 'vignette-soft' }
    },

    cyberpunk: {
      name: '霓虹',
      category: 'geek',
      colors: {
        bg: '#0d0221', pane: '#1a0b2e', paneHeader: '#0d0221',
        taskPanel: '#1a0b2e', settingsPanel: '#1a0b2e', statsPanel: '#1a0b2e',
        surface: '#2a1245', surfaceHover: '#4a1c5c', surfaceElevated: '#1a0b2e',
        border: '#4a1c5c', borderHover: '#7c3aed', borderActive: '#ff00ff',
        text: '#f0e9ff', textStrong: '#ffffff', textMuted: '#a78bfa', textDisabled: '#6b21a8',
        accent: '#00f0ff', accentHover: '#5cf6ff',
        success: '#05ffa1', successHover: '#5cffc4', successBright: '#05ffa1',
        warning: '#ffee00', warningHover: '#fff56d',
        danger: '#ff2a6d', dangerHover: '#ff5c8a',
        purple: '#ff00ff', purpleHover: '#ff5cff',
        terminal: palettes.cyberpunk,
      },
      ui: { borderRadius: 4, borderWidth: 1, glass: 0.12, shadow: '0 0 24px rgba(255,0,255,0.15)' },
      effects: { background: 'cyber-grid', intensity: 0.8, paneGlow: 'neon-magenta', overlay: 'scanlines' }
    },

    matrix: {
      name: '矩阵',
      category: 'geek',
      colors: {
        bg: '#0a0f0a', pane: '#121b12', paneHeader: '#0a0f0a',
        taskPanel: '#121b12', settingsPanel: '#121b12', statsPanel: '#121b12',
        surface: '#1a261a', surfaceHover: '#1f2f1f', surfaceElevated: '#121b12',
        border: '#1f2f1f', borderHover: '#2f4f2f', borderActive: '#00ff41',
        text: '#00ff41', textStrong: '#ccffcc', textMuted: '#2f4f2f', textDisabled: '#1f2f1f',
        accent: '#00ff41', accentHover: '#55ff77',
        success: '#00ff41', successHover: '#55ff77', successBright: '#00ff41',
        warning: '#ffff55', warningHover: '#ffff88',
        danger: '#ff5555', dangerHover: '#ff8888',
        purple: '#ff55ff', purpleHover: '#ff88ff',
        terminal: palettes.matrix,
      },
      ui: { borderRadius: 2, borderWidth: 1, glass: 0, shadow: '0 0 20px rgba(0,255,65,0.1)' },
      effects: { background: 'matrix-rain', intensity: 0.8, paneGlow: 'subtle-green', overlay: 'scanlines' }
    },

    dracula: {
      name: '德古拉',
      category: 'modern',
      colors: {
        bg: '#282a36', pane: '#44475a', paneHeader: '#21222c',
        taskPanel: '#44475a', settingsPanel: '#44475a', statsPanel: '#44475a',
        surface: '#4d5171', surfaceHover: '#6272a4', surfaceElevated: '#44475a',
        border: '#6272a4', borderHover: '#7b88c8', borderActive: '#ff79c6',
        text: '#f8f8f2', textStrong: '#ffffff', textMuted: '#6272a4', textDisabled: '#4d5171',
        accent: '#ff79c6', accentHover: '#ff92df',
        success: '#50fa7b', successHover: '#69ff94', successBright: '#50fa7b',
        warning: '#f1fa8c', warningHover: '#ffffa5',
        danger: '#ff5555', dangerHover: '#ff6e6e',
        purple: '#bd93f9', purpleHover: '#d4b5ff',
        terminal: palettes.dracula,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0, shadow: '0 4px 20px rgba(0,0,0,0.4)' },
      effects: { background: 'none', intensity: 0, paneGlow: 'subtle-pink', overlay: 'vignette-soft' }
    },

    everforest: {
      name: '森林',
      category: 'nature',
      colors: {
        bg: '#2b3339', pane: '#323d43', paneHeader: '#232a2e',
        taskPanel: '#323d43', settingsPanel: '#323d43', statsPanel: '#323d43',
        surface: '#3a454a', surfaceHover: '#4a555b', surfaceElevated: '#323d43',
        border: '#4a555b', borderHover: '#5c6b73', borderActive: '#a7c080',
        text: '#d3c6aa', textStrong: '#fdf6e3', textMuted: '#859289', textDisabled: '#4a555b',
        accent: '#a7c080', accentHover: '#b9cf9a',
        success: '#a7c080', successHover: '#b9cf9a', successBright: '#a7c080',
        warning: '#dbbc7f', warningHover: '#ead29c',
        danger: '#e67e80', dangerHover: '#f28e90',
        purple: '#d699b6', purpleHover: '#e6b3cd',
        terminal: palettes.everforest,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0, shadow: '0 4px 20px rgba(0,0,0,0.35)' },
      effects: { background: 'fireflies', intensity: 0.5, paneGlow: 'subtle-green', overlay: 'vignette-soft' }
    },

    nord: {
      name: '北极',
      category: 'nature',
      colors: {
        bg: '#2e3440', pane: '#3b4252', paneHeader: '#272c36',
        taskPanel: '#3b4252', settingsPanel: '#3b4252', statsPanel: '#3b4252',
        surface: '#434c5e', surfaceHover: '#4c566a', surfaceElevated: '#3b4252',
        border: '#4c566a', borderHover: '#5e81ac', borderActive: '#88c0d0',
        text: '#d8dee9', textStrong: '#eceff4', textMuted: '#7b88a3', textDisabled: '#4c566a',
        accent: '#88c0d0', accentHover: '#a3d6e3',
        success: '#a3be8c', successHover: '#b5cea8', successBright: '#a3be8c',
        warning: '#ebcb8b', warningHover: '#f0d399',
        danger: '#bf616a', dangerHover: '#d08770',
        purple: '#b48ead', purpleHover: '#c7a9c3',
        terminal: palettes.nord,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0.08, shadow: '0 4px 20px rgba(0,0,0,0.35)' },
      effects: { background: 'snow', intensity: 0.4, paneGlow: 'subtle-cyan', overlay: 'aurora' }
    },

    light: {
      name: '浅色',
      category: 'light',
      colors: {
        bg: '#f7f3ed', pane: '#f0ede8', paneHeader: '#ebe7e1',
        taskPanel: '#f0ede8', settingsPanel: '#f0ede8', statsPanel: '#f0ede8',
        surface: '#e6e1d8', surfaceHover: '#d9d4cb', surfaceElevated: '#f0ede8',
        border: '#c8c3bb', borderHover: '#a9a49b', borderActive: '#0969da',
        text: '#3d3a36', textStrong: '#1f1c18', textMuted: '#6e6a63', textDisabled: '#9e9a91',
        accent: '#0969da', accentHover: '#0550ae',
        success: '#1a7f37', successHover: '#2da44e', successBright: '#1a7f37',
        warning: '#9a6700', warningHover: '#bf8700',
        danger: '#cf222e', dangerHover: '#a40e26',
        purple: '#8250df', purpleHover: '#6639ba',
        terminal: palettes.light,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0, shadow: '0 2px 12px rgba(60,60,60,0.08)' },
      effects: { background: 'none', intensity: 0, paneGlow: 'none', overlay: 'none' }
    },

    paper: {
      name: '白纸',
      category: 'light',
      colors: {
        bg: '#ffffff', pane: '#f6f8fa', paneHeader: '#f3f4f6',
        taskPanel: '#f6f8fa', settingsPanel: '#f6f8fa', statsPanel: '#f6f8fa',
        surface: '#eaeef2', surfaceHover: '#dee3e9', surfaceElevated: '#f6f8fa',
        border: '#d0d7de', borderHover: '#afb8c1', borderActive: '#0969da',
        text: '#24292f', textStrong: '#1f2328', textMuted: '#656d76', textDisabled: '#8c959f',
        accent: '#0969da', accentHover: '#0860ca',
        success: '#1a7f37', successHover: '#2da44e', successBright: '#1a7f37',
        warning: '#9a6700', warningHover: '#bf8700',
        danger: '#cf222e', dangerHover: '#a40e26',
        purple: '#8250df', purpleHover: '#6639ba',
        terminal: palettes.paper,
      },
      ui: { borderRadius: 6, borderWidth: 1, glass: 0, shadow: '0 1px 8px rgba(31,35,40,0.06)' },
      effects: { background: 'none', intensity: 0, paneGlow: 'none', overlay: 'none' }
    },

    sepia: {
      name: '羊皮纸',
      category: 'light',
      colors: {
        bg: '#f4ecd8', pane: '#efe6d0', paneHeader: '#e9dec4',
        taskPanel: '#efe6d0', settingsPanel: '#efe6d0', statsPanel: '#efe6d0',
        surface: '#e5d8bb', surfaceHover: '#d7c9a8', surfaceElevated: '#efe6d0',
        border: '#d7c9a8', borderHover: '#bdae8b', borderActive: '#5c3d26',
        text: '#433422', textStrong: '#2d2418', textMuted: '#7a6b54', textDisabled: '#a89b82',
        accent: '#5c3d26', accentHover: '#3d2819',
        success: '#3d6b4a', successHover: '#4f8a5f', successBright: '#3d6b4a',
        warning: '#8c6b2f', warningHover: '#a6803c',
        danger: '#a04545', dangerHover: '#833636',
        purple: '#5e4775', purpleHover: '#7a5a99',
        terminal: palettes.sepia,
      },
      ui: { borderRadius: 8, borderWidth: 1, glass: 0, shadow: '0 2px 12px rgba(70,55,30,0.08)' },
      effects: { background: 'none', intensity: 0, paneGlow: 'none', overlay: 'none' }
    },
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function setCSSVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getPresetByStyle(style) {
    if (presetThemes[style]) return style;
    const map = {
      'darker': 'obsidian',
      'purple': 'cyberpunk', // legacy purple -> cyberpunk-ish
      'high': 'obsidian',
      'rosePine': 'sakura', // fallback
    };
    return map[style] || 'dark';
  }

  function resolvePreset(input) {
    if (!input) return 'dark';
    if (typeof input === 'string') return presetThemes[input] ? input : getPresetByStyle(input);
    if (input.preset) return presetThemes[input.preset] ? input.preset : getPresetByStyle(input.preset);
    if (input.style) return presetThemes[input.style] ? input.style : getPresetByStyle(input.style);
    return 'dark';
  }

  // ---------------------------------------------------------------------------
  // Theme application
  // ---------------------------------------------------------------------------
  let currentPresetKey = 'dark';

  function applyTheme(input) {
    const key = resolvePreset(input);
    currentPresetKey = key;
    const theme = presetThemes[key];
    const c = theme.colors;

    // Base
    setCSSVar('--vs-bg', c.bg);
    setCSSVar('--vs-bg-gradient', theme.ui.bgGradient || 'none');
    setCSSVar('--vs-bg-overlay', 'none');

    // Pane & header
    setCSSVar('--vs-pane', c.pane);
    setCSSVar('--vs-pane-gradient', theme.ui.paneGradient || 'none');
    setCSSVar('--vs-pane-header', c.paneHeader);
    setCSSVar('--vs-pane-header-border', c.border);

    // Surfaces
    setCSSVar('--vs-surface', c.surface);
    setCSSVar('--vs-surface-hover', c.surfaceHover);
    setCSSVar('--vs-surface-elevated', c.surfaceElevated);

    // Borders & dividers
    setCSSVar('--vs-border', c.border);
    setCSSVar('--vs-border-hover', c.borderHover);
    setCSSVar('--vs-border-active', c.borderActive);
    setCSSVar('--vs-divider', c.border);

    // Text
    setCSSVar('--vs-text', c.text);
    setCSSVar('--vs-text-strong', c.textStrong);
    setCSSVar('--vs-text-muted', c.textMuted);
    setCSSVar('--vs-text-disabled', c.textDisabled);

    // Accents & states
    setCSSVar('--vs-accent', c.accent);
    setCSSVar('--vs-accent-hover', c.accentHover);
    setCSSVar('--vs-accent-soft', hexToRgba(c.accent, 0.12));

    setCSSVar('--vs-success', c.success);
    setCSSVar('--vs-success-hover', c.successHover);
    setCSSVar('--vs-success-bright', c.successBright);
    setCSSVar('--vs-success-soft', hexToRgba(c.successBright, 0.12));

    setCSSVar('--vs-warning', c.warning);
    setCSSVar('--vs-warning-hover', c.warningHover);
    setCSSVar('--vs-warning-soft', hexToRgba(c.warning, 0.12));

    setCSSVar('--vs-danger', c.danger);
    setCSSVar('--vs-danger-hover', c.dangerHover);
    setCSSVar('--vs-danger-soft', hexToRgba(c.danger, 0.12));

    setCSSVar('--vs-purple', c.purple);
    setCSSVar('--vs-purple-hover', c.purpleHover);

    // Panels
    setCSSVar('--vs-task-panel', c.taskPanel);
    setCSSVar('--vs-settings-panel', c.settingsPanel);
    setCSSVar('--vs-stats-panel', c.statsPanel);

    // UI params
    setCSSVar('--vs-radius', theme.ui.borderRadius + 'px');
    setCSSVar('--vs-border-width', theme.ui.borderWidth + 'px');
    setCSSVar('--vs-shadow', theme.ui.shadow || 'none');
    setCSSVar('--vs-glass', theme.ui.glass || 0);

    // Fonts
    setCSSVar('--vs-body-font', theme.ui.bodyFont || defaultVars['--vs-body-font']);
    setCSSVar('--vs-mono-font', theme.ui.monoFont || defaultVars['--vs-mono-font']);

    // Body class for theme-specific overrides
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
    document.body.classList.add('theme-' + key);

    // Meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c.paneHeader || c.bg);

    // Effects layer
    if (global.ThemeEffects) {
      global.ThemeEffects.apply(theme.effects, c);
    }

    // Dispatch event so client.js can re-theme terminals
    window.dispatchEvent(new CustomEvent('vs-theme-applied', { detail: { key, theme } }));

    return { key, theme };
  }

  function getCurrentPreset() {
    return currentPresetKey;
  }

  function getPresetList() {
    return Object.entries(presetThemes).map(([key, t]) => ({ key, ...t }));
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  global.ThemeEngine = {
    presetThemes,
    applyTheme,
    getCurrentPreset,
    getPresetList,
    resolvePreset,
    getPresetByStyle,
    hexToRgba,
  };
})(window);
