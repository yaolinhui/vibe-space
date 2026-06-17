import re
from pathlib import Path

CSS = Path('public/styles.css')
text = CSS.read_text(encoding='utf-8')

# Color -> variable mapping (order: more specific first)
COLOR_MAP = [
    # base
    ('#0d1117', 'var(--vs-bg)'),
    ('#161b22', 'var(--vs-pane)'),
    ('#0a0a0a', 'var(--vs-pane)'),
    ('#21262d', 'var(--vs-surface)'),
    ('#30363d', 'var(--vs-border)'),
    ('#484f58', 'var(--vs-border-hover)'),
    # text
    ('#6e7681', 'var(--vs-text-disabled)'),
    ('#8b949e', 'var(--vs-text-muted)'),
    ('#c9d1d9', 'var(--vs-text)'),
    ('#f0f6fc', 'var(--vs-text-strong)'),
    # accents
    ('#58a6ff', 'var(--vs-accent)'),
    ('#79c0ff', 'var(--vs-accent-hover)'),
    ('#1f6feb', 'var(--vs-accent)'),
    ('#388bfd', 'var(--vs-accent-hover)'),
    # success
    ('#238636', 'var(--vs-success)'),
    ('#2ea043', 'var(--vs-success-hover)'),
    ('#3fb950', 'var(--vs-success-bright)'),
    ('#7ee787', 'var(--vs-success-hover)'),
    # warning
    ('#e3b341', 'var(--vs-warning)'),
    ('#f0d76a', 'var(--vs-warning-hover)'),
    ('#d29922', 'var(--vs-warning)'),
    # danger
    ('#ff7b72', 'var(--vs-danger)'),
    ('#f85149', 'var(--vs-danger-hover)'),
    ('#da3633', 'var(--vs-danger)'),
    # purple
    ('#8957e5', 'var(--vs-purple)'),
    ('#a371f7', 'var(--vs-purple-hover)'),
]

HEX_TO_VAR = {}
for hex_val, var in COLOR_MAP:
    HEX_TO_VAR[hex_val.lower()] = var


def rgba_to_hex(r, g, b):
    return f'#{r:02x}{g:02x}{b:02x}'


def replace_rgba(match):
    r = int(match.group(1))
    g = int(match.group(2))
    b = int(match.group(3))
    a = match.group(4).strip()
    hex_val = rgba_to_hex(r, g, b)
    var = HEX_TO_VAR.get(hex_val)
    if var:
        alpha_pct = float(a) * 100
        alpha_str = f'{alpha_pct:g}'
        return f'color-mix(in srgb, {var} {alpha_str}%, transparent)'
    return match.group(0)


# Replace standalone hex colors
for hex_val, var in COLOR_MAP:
    text = text.replace(hex_val, var)

# Replace rgba(r,g,b,a) where rgb maps to a known variable
rgba_pattern = re.compile(r'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)')
text = rgba_pattern.sub(replace_rgba, text)

# Inject :root block at the very top if not present
root_block = """:root {
  --vs-bg: #0d1117;
  --vs-bg-gradient: none;
  --vs-bg-overlay: none;

  --vs-pane: #161b22;
  --vs-pane-gradient: none;
  --vs-pane-header: #0d1117;
  --vs-pane-header-border: #30363d;

  --vs-surface: #21262d;
  --vs-surface-hover: #30363d;
  --vs-surface-elevated: #161b22;

  --vs-border: #30363d;
  --vs-border-hover: #484f58;
  --vs-border-active: #58a6ff;
  --vs-divider: #30363d;

  --vs-text: #c9d1d9;
  --vs-text-strong: #f0f6fc;
  --vs-text-muted: #8b949e;
  --vs-text-disabled: #6e7681;

  --vs-accent: #58a6ff;
  --vs-accent-hover: #79c0ff;
  --vs-accent-soft: rgba(88, 166, 255, 0.12);

  --vs-success: #238636;
  --vs-success-hover: #2ea043;
  --vs-success-bright: #3fb950;
  --vs-success-soft: rgba(63, 185, 80, 0.12);

  --vs-warning: #e3b341;
  --vs-warning-hover: #f0d76a;
  --vs-warning-soft: rgba(227, 179, 65, 0.12);

  --vs-danger: #ff7b72;
  --vs-danger-hover: #f85149;
  --vs-danger-soft: rgba(255, 123, 114, 0.12);

  --vs-purple: #8957e5;
  --vs-purple-hover: #a371f7;

  --vs-radius: 6px;
  --vs-border-width: 1px;
  --vs-shadow: none;
  --vs-glass: 0;

  --vs-body-font: 'Segoe UI', system-ui, -apple-system, sans-serif;
  --vs-mono-font: 'Consolas', 'Courier New', monospace;

  --vs-task-panel: #161b22;
  --vs-settings-panel: #161b22;
  --vs-stats-panel: #161b22;
}

"""

if not text.strip().startswith(':root'):
    text = root_block + text

CSS.write_text(text, encoding='utf-8')
print('Converted styles.css to CSS variables.')
