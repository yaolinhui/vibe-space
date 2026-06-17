/**
 * Minimal i18n helper for Vibe Space.
 * Loads locale JSON and provides a t() lookup with interpolation.
 */
(function () {
  const defaultLocale = 'en';
  let currentLocale = defaultLocale;
  let translations = {};

  async function loadLocale(locale) {
    try {
      const res = await fetch(`/locales/${locale}.json`);
      if (!res.ok) throw new Error(`Failed to load ${locale}`);
      translations = await res.json();
      currentLocale = locale;
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
      try {
        localStorage.setItem('vsLocale', locale);
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('vs-locale-changed', { detail: { locale } }));
    } catch (e) {
      console.warn('[i18n] Locale load failed:', e.message);
      translations = {};
    }
  }

  function t(key, vars = {}) {
    const keys = key.split('.');
    let value = translations;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        value = undefined;
        break;
      }
    }
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
  }

  async function setLocale(locale) {
    await loadLocale(locale);
  }

  function getLocale() {
    return currentLocale;
  }

  function translatePage(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      // 跳过运行时动态更新的元素（如连接状态），避免覆盖当前状态
      if (el.hasAttribute('data-i18n-dynamic')) return;
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const translated = t(key);
      if (translated === key) return; // 未找到翻译，保留原内容
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        el.setAttribute(attr, translated);
      } else if (el.tagName.toLowerCase() === 'option') {
        el.text = translated;
      } else {
        el.textContent = translated;
      }
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
  }

  function getSavedLocale() {
    try {
      const fromStorage = localStorage.getItem('vsLocale');
      if (fromStorage) return fromStorage;
    } catch (_) {}
    const fromHtml = document.documentElement.getAttribute('data-locale');
    if (fromHtml) return fromHtml;
    return defaultLocale;
  }

  // Auto-load saved locale on init, but don't block page load
  (async function init() {
    const locale = getSavedLocale();
    if (locale && locale !== currentLocale) {
      await loadLocale(locale);
    }
  })();

  window.i18n = { t, setLocale, getLocale, loadLocale, translatePage };
})();
