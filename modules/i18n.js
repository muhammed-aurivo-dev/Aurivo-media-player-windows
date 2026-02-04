/* global window, document, navigator, localStorage */

(() => {
    'use strict';

    const STORAGE_KEY = 'aurivo:lang';
    const SUPPORTED = ['tr', 'en', 'ar', 'fr', 'de', 'es', 'hi'];
    const RTL_LANGS = new Set(['ar']);
    const cache = new Map(); // lang -> messages

    let currentLang = null;
    const listeners = new Set();

    function normalizeLang(lang) {
        if (!lang) return null;
        const base = String(lang).trim().toLowerCase().split(/[-_]/)[0];
        return SUPPORTED.includes(base) ? base : null;
    }

    function detectSystemLang() {
        return normalizeLang(navigator.language) || 'en';
    }

    function deepGet(obj, path) {
        if (!obj || typeof obj !== 'object') return undefined;
        const parts = String(path).split('.').filter(Boolean);
        let cur = obj;
        for (const p of parts) {
            if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    function format(str, vars) {
        if (!vars || typeof vars !== 'object') return String(str);
        return String(str).replace(/\{(\w+)\}/g, (_m, k) => {
            if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k]);
            return `{${k}}`;
        });
    }

    async function loadMessages(lang) {
        const normalized = normalizeLang(lang) || 'en';
        if (cache.has(normalized)) return cache.get(normalized);

        // Prefer IPC (works under file:// where fetch can't load local files reliably)
        try {
            if (window.aurivo?.i18n?.loadLocale) {
                const json = await window.aurivo.i18n.loadLocale(normalized);
                cache.set(normalized, json || {});
                return json || {};
            }
        } catch {
            // ignore
        }

        // Fallback: fetch (works when served over http/https)
        try {
            const res = await fetch(`locales/${normalized}.json`, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            cache.set(normalized, json || {});
            return json || {};
        } catch {
            if (normalized !== 'en') return loadMessages('en');
            cache.set('en', {});
            return {};
        }
    }

    function applyDirAndLang(lang) {
        const docEl = document.documentElement;
        if (!docEl) return;
        docEl.lang = lang;
        docEl.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
        document.body?.classList.toggle('rtl', RTL_LANGS.has(lang));
    }

    function applyTranslations(messages) {
        const enMessages = cache.get('en') || {};
        const nodes = document.querySelectorAll(
            '[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]'
        );

        nodes.forEach((el) => {
            const textKey = el.getAttribute('data-i18n');
            if (textKey) {
                const val = deepGet(messages, textKey);
                if (typeof val === 'string') el.textContent = val;
                else {
                    const fallback = deepGet(enMessages, textKey);
                    if (typeof fallback === 'string') el.textContent = fallback;
                }
            }

            const htmlKey = el.getAttribute('data-i18n-html');
            if (htmlKey) {
                const val = deepGet(messages, htmlKey);
                if (typeof val === 'string') el.innerHTML = val;
                else {
                    const fallback = deepGet(enMessages, htmlKey);
                    if (typeof fallback === 'string') el.innerHTML = fallback;
                }
            }

            const titleKey = el.getAttribute('data-i18n-title');
            if (titleKey) {
                const val = deepGet(messages, titleKey);
                if (typeof val === 'string') el.setAttribute('title', val);
                else {
                    const fallback = deepGet(enMessages, titleKey);
                    if (typeof fallback === 'string') el.setAttribute('title', fallback);
                }
            }

            const placeholderKey = el.getAttribute('data-i18n-placeholder');
            if (placeholderKey) {
                const val = deepGet(messages, placeholderKey);
                if (typeof val === 'string') el.setAttribute('placeholder', val);
                else {
                    const fallback = deepGet(enMessages, placeholderKey);
                    if (typeof fallback === 'string') el.setAttribute('placeholder', fallback);
                }
            }

            const ariaLabelKey = el.getAttribute('data-i18n-aria-label');
            if (ariaLabelKey) {
                const val = deepGet(messages, ariaLabelKey);
                if (typeof val === 'string') el.setAttribute('aria-label', val);
                else {
                    const fallback = deepGet(enMessages, ariaLabelKey);
                    if (typeof fallback === 'string') el.setAttribute('aria-label', fallback);
                }
            }
        });
    }

    async function setLanguage(lang, opts = {}) {
        const normalized = normalizeLang(lang) || 'en';
        const previous = currentLang;
        currentLang = normalized;

        if (!opts?.skipPersist) await persistLanguagePreference(normalized);

        const messages = await loadMessages(normalized);
        if (normalized !== 'en' && !cache.has('en')) {
            try {
                await loadMessages('en');
            } catch {
                // ignore
            }
        }
        applyDirAndLang(normalized);
        applyTranslations(messages);

        if (previous !== normalized) {
            listeners.forEach((fn) => {
                try {
                    fn(normalized);
                } catch {
                    // ignore
                }
            });
            window.dispatchEvent(new CustomEvent('aurivo:languageChanged', { detail: { lang: normalized } }));
        }

        return normalized;
    }

    async function persistLanguagePreference(lang) {
        const normalized = normalizeLang(lang) || 'en';
        try {
            localStorage.setItem(STORAGE_KEY, normalized);
        } catch {
            // ignore
        }

        // Best-effort: also persist to app settings so main process dialogs can localize.
        try {
            const p = window.aurivo?.saveSettings?.({ ui: { language: normalized } });
            if (p && typeof p.then === 'function') await p;
        } catch {
            // ignore
        }

        return normalized;
    }

    async function setLanguagePreference(lang) {
        return persistLanguagePreference(lang);
    }

    async function init() {
        let selected = null;

        // Prefer persisted app settings (stable across origins/packaging)
        try {
            const s = await window.aurivo?.loadSettings?.();
            selected = normalizeLang(s?.ui?.language);
        } catch {
            // ignore
        }

        try {
            if (!selected) selected = normalizeLang(localStorage.getItem(STORAGE_KEY));
        } catch {
            // ignore
        }

        if (!selected) selected = detectSystemLang();
        return setLanguage(selected, { skipPersist: false });
    }

    async function t(key, vars) {
        const lang = currentLang || normalizeLang(localStorage.getItem(STORAGE_KEY)) || detectSystemLang();
        const messages = await loadMessages(lang);
        const raw = deepGet(messages, key);
        if (typeof raw === 'string') return format(raw, vars);
        if (lang !== 'en') {
            const en = await loadMessages('en');
            const rawEn = deepGet(en, key);
            if (typeof rawEn === 'string') return format(rawEn, vars);
        }
        return String(key);
    }

    function tSync(key, vars) {
        const lang = currentLang || normalizeLang(localStorage.getItem(STORAGE_KEY)) || detectSystemLang();
        const messages = cache.get(lang) || cache.get('en') || {};
        let raw = deepGet(messages, key);
        if (typeof raw !== 'string' && lang !== 'en') {
            raw = deepGet(cache.get('en') || {}, key);
        }
        if (typeof raw === 'string') return format(raw, vars);
        return String(key);
    }

    function getLanguage() {
        return currentLang;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    window.i18n = {
        SUPPORTED,
        init,
        t,
        tSync,
        setLanguage,
        setLanguagePreference,
        getLanguage,
        onChange
    };
})();
