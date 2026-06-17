/**
 * Vibe Space - Theme Effects Engine
 * Canvas-based ambient effects for immersive themes.
 */

(function (global) {
  'use strict';

  let canvas = null;
  let ctx = null;
  let rafId = null;
  let currentEffect = null;
  let currentIntensity = 0;
  let currentColors = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let lastTime = 0;
  let isVisible = true;

  const containerId = 'vs-effects-layer';

  function getContainer() {
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden;';
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function ensureCanvas() {
    const container = getContainer();
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      container.appendChild(canvas);
      ctx = canvas.getContext('2d', { alpha: true });
      resize();
      window.addEventListener('resize', resize, { passive: true });
      document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
        if (isVisible && currentEffect) scheduleFrame();
      });
    }
    return canvas;
  }

  function removeCanvas() {
    if (canvas) {
      window.removeEventListener('resize', resize);
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      canvas.remove();
      canvas = null;
      ctx = null;
    }
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clear() {
    if (ctx) ctx.clearRect(0, 0, width, height);
  }

  function scheduleFrame() {
    if (rafId) return;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Particle utilities
  // ---------------------------------------------------------------------------
  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const bigint = parseInt(full, 16);
    return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
  }

  // ---------------------------------------------------------------------------
  // Effect implementations
  // ---------------------------------------------------------------------------

  // --- sakura-fall ---
  function initSakura(count) {
    particles = [];
    const color = currentColors.accent || '#ff9eb5';
    for (let i = 0; i < count; i++) {
      particles.push({
        x: random(0, width),
        y: random(-height, 0),
        size: random(4, 10),
        speedY: random(0.8, 2.2),
        speedX: random(-0.7, 0.7),
        rotation: random(0, Math.PI * 2),
        rotationSpeed: random(-0.03, 0.03),
        sway: random(0, Math.PI * 2),
        swaySpeed: random(0.01, 0.04),
        opacity: random(0.4, 0.85),
        color,
      });
    }
  }

  function drawSakura(dt) {
    ctx.clearRect(0, 0, width, height);
    const petal = (p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = hexToRgba(p.color, 0.85);
      ctx.beginPath();
      // simple cherry blossom petal shape
      ctx.moveTo(0, -p.size);
      ctx.bezierCurveTo(p.size * 0.6, -p.size * 0.6, p.size * 0.6, p.size * 0.4, 0, p.size);
      ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.4, -p.size * 0.6, -p.size * 0.6, 0, -p.size);
      ctx.fill();
      ctx.restore();
    };

    particles.forEach(p => {
      p.y += p.speedY * (dt / 16);
      p.sway += p.swaySpeed;
      p.x += p.speedX + Math.sin(p.sway) * 0.5;
      p.rotation += p.rotationSpeed;
      if (p.y > height + 20) {
        p.y = -20;
        p.x = random(0, width);
      }
      if (p.x > width + 20) p.x = -20;
      if (p.x < -20) p.x = width + 20;
      petal(p);
    });
  }

  // --- matrix-rain ---
  const matrixChars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
  function initMatrix() {
    const fontSize = 14;
    const columns = Math.ceil(width / fontSize);
    particles = [];
    for (let i = 0; i < columns; i++) {
      particles.push({
        x: i * fontSize,
        y: random(-height, 0),
        speed: random(1.5, 4),
        chars: Array.from({ length: 20 }, () => matrixChars[Math.floor(Math.random() * matrixChars.length)]),
        headBright: true,
      });
    }
  }

  function drawMatrix(dt) {
    ctx.fillStyle = hexToRgba(currentColors.bg || '#0a0f0a', 0.18);
    ctx.fillRect(0, 0, width, height);
    const fontSize = 14;
    ctx.font = `${fontSize}px Consolas, monospace`;
    const green = currentColors.accent || '#00ff41';

    particles.forEach(col => {
      col.y += col.speed * (dt / 16);
      if (col.y > height + 200) {
        col.y = random(-200, -50);
        col.speed = random(1.5, 4);
      }
      for (let i = 0; i < col.chars.length; i++) {
        const cy = col.y - i * fontSize;
        if (cy < -fontSize || cy > height + fontSize) continue;
        if (i === 0) {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.9;
        } else {
          ctx.fillStyle = hexToRgba(green, 1 - i / col.chars.length);
          ctx.globalAlpha = 0.6;
        }
        ctx.fillText(col.chars[i], col.x, cy);
        // mutate char occasionally
        if (Math.random() < 0.02) col.chars[i] = matrixChars[Math.floor(Math.random() * matrixChars.length)];
      }
    });
    ctx.globalAlpha = 1;
  }

  // --- cyber-grid ---
  function initCyberGrid() {
    particles = [];
  }

  function drawCyberGrid(dt) {
    ctx.clearRect(0, 0, width, height);
    const accent = currentColors.accent || '#00f0ff';
    const secondary = currentColors.purple || '#ff00ff';

    // deep vignette
    const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.9);
    grad.addColorStop(0, hexToRgba(accent, 0.03));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // perspective grid
    const horizonY = height * 0.45;
    ctx.strokeStyle = hexToRgba(accent, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const x = (width / 20) * i;
      ctx.moveTo(x, horizonY);
      ctx.lineTo((x - width / 2) * 6 + width / 2, height);
    }
    // horizontal lines moving down
    const t = (Date.now() / 2000) % 1;
    for (let i = 0; i < 12; i++) {
      let y = horizonY + Math.pow((i + t) / 12, 2) * (height - horizonY);
      if (y > height) y -= height - horizonY;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // sun/moon glow
    const glow = ctx.createRadialGradient(width / 2, horizonY, 10, width / 2, horizonY, 120);
    glow.addColorStop(0, hexToRgba(secondary, 0.25));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  // --- float-dots ---
  function initFloatDots(count) {
    particles = [];
    const color = currentColors.accent || '#c4b5ff';
    for (let i = 0; i < count; i++) {
      particles.push({
        x: random(0, width),
        y: random(0, height),
        r: random(2, 6),
        dx: random(-0.3, 0.3),
        dy: random(-0.3, 0.3),
        opacity: random(0.2, 0.6),
        color,
      });
    }
  }

  function drawFloatDots(dt) {
    ctx.clearRect(0, 0, width, height);
    particles.forEach(p => {
      p.x += p.dx * (dt / 16);
      p.y += p.dy * (dt / 16);
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = hexToRgba(p.color, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // --- rain-lines ---
  function initRain(count) {
    particles = [];
    const color = currentColors.accent || '#7aa2f7';
    for (let i = 0; i < count; i++) {
      particles.push({
        x: random(0, width),
        y: random(-height, 0),
        len: random(10, 40),
        speed: random(4, 10),
        opacity: random(0.1, 0.35),
        color,
      });
    }
  }

  function drawRain(dt) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    particles.forEach(p => {
      p.y += p.speed * (dt / 16);
      if (p.y > height) {
        p.y = -p.len;
        p.x = random(0, width);
      }
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = hexToRgba(p.color, 0.6);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + p.len);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  // --- fireflies ---
  function initFireflies(count) {
    particles = [];
    const color = currentColors.warning || '#dbbc7f';
    for (let i = 0; i < count; i++) {
      particles.push({
        x: random(0, width),
        y: random(0, height),
        r: random(1.5, 3.5),
        dx: random(-0.4, 0.4),
        dy: random(-0.3, 0.3),
        phase: random(0, Math.PI * 2),
        speed: random(0.02, 0.06),
        color,
      });
    }
  }

  function drawFireflies(dt) {
    ctx.clearRect(0, 0, width, height);
    particles.forEach(p => {
      p.x += p.dx * (dt / 16);
      p.y += p.dy * (dt / 16);
      p.phase += p.speed;
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;
      const alpha = 0.3 + Math.sin(p.phase) * 0.25;
      ctx.globalAlpha = Math.max(0.1, alpha);
      ctx.fillStyle = hexToRgba(p.color, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      // glow
      ctx.globalAlpha = Math.max(0.02, alpha * 0.3);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
      g.addColorStop(0, hexToRgba(p.color, 0.8));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // --- snow ---
  function initSnow(count) {
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: random(0, width),
        y: random(-height, 0),
        r: random(1, 3.5),
        speedY: random(0.5, 2),
        speedX: random(-0.4, 0.4),
        opacity: random(0.4, 0.9),
      });
    }
  }

  function drawSnow(dt) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    particles.forEach(p => {
      p.y += p.speedY * (dt / 16);
      p.x += p.speedX + Math.sin(p.y / 60) * 0.3;
      if (p.y > height + 10) {
        p.y = -10;
        p.x = random(0, width);
      }
      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Effect registry
  // ---------------------------------------------------------------------------
  const effects = {
    'sakura-fall': { init: () => initSakura(Math.floor(40 * currentIntensity) + 20), draw: drawSakura },
    'matrix-rain': { init: initMatrix, draw: drawMatrix },
    'cyber-grid': { init: initCyberGrid, draw: drawCyberGrid },
    'float-dots': { init: () => initFloatDots(Math.floor(35 * currentIntensity) + 15), draw: drawFloatDots },
    'rain-lines': { init: () => initRain(Math.floor(60 * currentIntensity) + 30), draw: drawRain },
    'fireflies': { init: () => initFireflies(Math.floor(30 * currentIntensity) + 15), draw: drawFireflies },
    'snow': { init: () => initSnow(Math.floor(60 * currentIntensity) + 30), draw: drawSnow },
    'none': { init: () => {}, draw: () => clear() },
  };

  // CSS-only overlays managed separately
  const cssOverlays = ['vignette-soft', 'scanlines', 'aurora', 'neon-magenta', 'subtle-pink', 'subtle-blue', 'subtle-green', 'subtle-cyan', 'subtle-purple', 'none'];

  // ---------------------------------------------------------------------------
  // CSS overlay management
  // ---------------------------------------------------------------------------
  function applyCSSOverlay(overlayType, paneGlowType, colors) {
    const container = getContainer();
    let overlay = document.getElementById('vs-css-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'vs-css-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;transition:background 0.4s;';
      container.appendChild(overlay);
    }

    let bg = 'none';
    let mix = 'normal';

    if (overlayType === 'vignette-soft') {
      bg = `radial-gradient(circle at center, transparent 40%, ${hexToRgba(colors.bg, 0.55)} 100%)`;
    } else if (overlayType === 'scanlines') {
      bg = `repeating-linear-gradient(0deg, transparent, transparent 2px, ${hexToRgba('#000000', 0.12)} 2px, ${hexToRgba('#000000', 0.12)} 4px)`;
      mix = 'overlay';
    } else if (overlayType === 'aurora') {
      bg = `linear-gradient(125deg, ${hexToRgba(colors.accent, 0.08)} 0%, transparent 40%), linear-gradient(235deg, ${hexToRgba(colors.purple || colors.accent, 0.08)} 0%, transparent 40%)`;
    }

    overlay.style.background = bg;
    overlay.style.mixBlendMode = mix;

    // Pane glow handled via body class + CSS variables, not overlay
    document.body.dataset.paneGlow = paneGlowType || 'none';
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  function loop(timestamp) {
    rafId = null;
    if (!isVisible || !currentEffect) return;
    const dt = Math.min(64, timestamp - lastTime || 16);
    lastTime = timestamp;
    const effect = effects[currentEffect];
    if (effect) effect.draw(dt);
    scheduleFrame();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function apply(effectsConfig, colors) {
    const fx = effectsConfig || {};
    const effectId = fx.background || 'none';
    currentIntensity = Math.max(0, Math.min(1, fx.intensity == null ? 0.5 : fx.intensity));
    currentColors = colors || {};

    applyCSSOverlay(fx.overlay || 'none', fx.paneGlow || 'none', currentColors);

    if (effectId === 'none' || currentIntensity <= 0) {
      removeCanvas();
      return;
    }

    ensureCanvas();
    if (currentEffect !== effectId) {
      currentEffect = effectId;
      particles = [];
      const effect = effects[effectId];
      if (effect) effect.init();
    }
    resize();
    lastTime = performance.now();
    scheduleFrame();
  }

  function stop() {
    stopLoop();
    removeCanvas();
    currentEffect = null;
  }

  global.ThemeEffects = { apply, stop, getContainer };
})(window);
