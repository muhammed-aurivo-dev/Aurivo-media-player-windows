const { app, BrowserWindow, ipcMain, dialog, nativeImage, Tray, Menu, shell, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// MPRIS (Linux Medya Oynatıcı Uzaktan Arayüz Spesifikasyonu)
let Player = null;
try {
    Player = require('mpris-service');
} catch (e) {
    console.log('mpris-service yüklenemedi (sadece Linux):', e.message);
}

// stdout/stderr pipe kapandığında (örn. `| head`) Node `EPIPE` fırlatabilir.
// Uygulamanın bu yüzden çökmesini engelle.
for (const stream of [process.stdout, process.stderr]) {
    if (!stream || typeof stream.on !== 'function') continue;
    stream.on('error', (err) => {
        if (err && err.code === 'EPIPE') return;
    });
}

// Global yakalanmamış istisna işleyicisi - MPRIS/dbus hataları için
process.on('uncaughtException', (error) => {
    // EPIPE hataları - dbus bağlantısı koptuğunda oluşur
    if (error.code === 'EPIPE' ||
        (error.message && error.message.includes('EPIPE')) ||
        (error.message && error.message.includes('stream is closed')) ||
        (error.message && error.message.includes('Cannot send message'))) {
        // Sessizce yoksay - bu normal bir durum
        return;
    }

    // Diğer hatalar için log yaz ama dialog gösterme
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

function safeStdoutLine(line) {
    try {
        process.stdout.write(String(line) + '\n');
    } catch (err) {
        if (err && err.code === 'EPIPE') return;
    }
}

// GNOME/Wayland üst bar & dock ikon eşleştirmesi için (desktop entry ile eşleşme)
const LINUX_WM_CLASS = 'aurivo-media-player';
if (app && app.commandLine) {
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('class', LINUX_WM_CLASS);
    }

    // DÜZELTME: WebView'larda çift medya oynatıcıyı önlemek için Chromium MediaSessionService devre dışı
    app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
} else {
    console.warn('[Startup] app.commandLine not available');
}

// Windows 10/11: taskbar/dock ikon eşleştirmesi ve gruplama
if (process.platform === 'win32') {
    app.setAppUserModelId('com.aurivo.mediaplayer');
}

function prependToProcessPath(dir) {
    if (!dir) return;
    const delimiter = path.delimiter || (process.platform === 'win32' ? ';' : ':');
    const cur = process.env.PATH || '';
    const parts = cur.split(delimiter).filter(Boolean);
    if (parts.includes(dir)) return;
    process.env.PATH = `${dir}${delimiter}${cur}`;
}

function ensureWindowsRuntimePaths() {
    if (process.platform !== 'win32') return;

    // PATH: paketlenmiş native bağımlılıkların / ffmpeg'in alt süreç ve DLL yükleyici tarafından bulunabildiğinden emin ol.
    try {
        if (process.resourcesPath) {
            prependToProcessPath(path.join(process.resourcesPath, 'bin'));
            prependToProcessPath(path.join(process.resourcesPath, 'native', 'build', 'Release'));
            prependToProcessPath(path.join(process.resourcesPath, 'native-dist'));
        }

        // Geliştirici yedekleri
        prependToProcessPath(path.join(__dirname, 'third_party', 'ffmpeg'));
        prependToProcessPath(path.join(__dirname, 'native', 'build', 'Release'));
        prependToProcessPath(path.join(__dirname, 'native-dist'));
    } catch (e) {
        console.warn('[WIN] PATH prep failed:', e?.message || e);
    }
}

ensureWindowsRuntimePaths();

let winRuntimeDepsLogged = false;
function logWindowsRuntimeDepsOnce(context = '') {
    if (process.platform !== 'win32') return;
    if (winRuntimeDepsLogged) return;
    winRuntimeDepsLogged = true;

    try {
        const base = process.resourcesPath || '(no resourcesPath)';
        const releaseDir = process.resourcesPath ? path.join(process.resourcesPath, 'native', 'build', 'Release') : '';
        const nativeDistDir = process.resourcesPath ? path.join(process.resourcesPath, 'native-dist') : '';
        const binDir = process.resourcesPath ? path.join(process.resourcesPath, 'bin') : '';
        const visualizerExe = process.resourcesPath ? path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe') : '';
        const ffmpegExe = process.resourcesPath ? path.join(binDir, 'ffmpeg.exe') : '';

        const requiredBassDlls = [
            'bass.dll',
            'bass_fx.dll',
            'bass_aac.dll',
            'bassape.dll',
            'bassflac.dll',
            'basswv.dll'
        ];

        const checkDir = (dir) => {
            if (!dir) return { dir, present: [], missing: requiredBassDlls.slice() };
            const present = [];
            const missing = [];
            for (const f of requiredBassDlls) {
                const p = path.join(dir, f);
                if (fs.existsSync(p)) present.push(f);
                else missing.push(f);
            }
            return { dir, present, missing };
        };

        console.log('[WIN][DEPS]' + (context ? ` (${context})` : ''), 'resourcesPath:', base);
        console.log('[WIN][DEPS] PATH head:', String(process.env.PATH || '').split(';').slice(0, 6).join(';'));
        if (visualizerExe) console.log('[WIN][DEPS] visualizer exe:', visualizerExe, 'exists:', fs.existsSync(visualizerExe));
        if (ffmpegExe) console.log('[WIN][DEPS] ffmpeg exe:', ffmpegExe, 'exists:', fs.existsSync(ffmpegExe));

        const a = checkDir(releaseDir);
        const b = checkDir(nativeDistDir);
        console.log('[WIN][DEPS] bass dll check:', a);
        console.log('[WIN][DEPS] bass dll check:', b);
    } catch (e) {
        console.warn('[WIN][DEPS] log failed:', e?.message || e);
    }
}
// ============================================
// WAYLAND / X11 OTOMATİK ALGILAMA
// ============================================
function detectDisplayServer() {
    // Linux dışı sistemlerde atlama
    if (process.platform !== 'linux') return;

    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    const xdgSessionType = process.env.XDG_SESSION_TYPE;
    const display = process.env.DISPLAY;
    const ozoneHint = process.env.ELECTRON_OZONE_PLATFORM_HINT;

    const appendCsvSwitch = (name, csv) => {
        if (!app?.commandLine || !csv) return;
        try {
            const cur = app.commandLine.getSwitchValue(name) || '';
            const set = new Set(
                cur
                    .split(',')
                    .concat(String(csv).split(','))
                    .map(s => String(s || '').trim())
                    .filter(Boolean)
            );
            app.commandLine.appendSwitch(name, [...set].join(','));
        } catch {
            // en iyi çaba
        }
    };

    // Kullanıcı manuel olarak ayarladıysa kullan
    const forceSoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
    const forceGpu = process.env.AURIVO_FORCE_GPU === '1' || process.env.AURIVO_FORCE_GPU === 'true';

    const wantWayland =
        ozoneHint === 'wayland' ||
        (xdgSessionType && String(xdgSessionType).toLowerCase() === 'wayland') ||
        !!waylandDisplay;
    const wantX11 =
        ozoneHint === 'x11' ||
        (xdgSessionType && String(xdgSessionType).toLowerCase() === 'x11') ||
        (!!display && !wantWayland);

    if (wantWayland) {
        console.log('💻 Display Server: Wayland');
        app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
        appendCsvSwitch('enable-features', 'UseOzonePlatform,WaylandWindowDecorations,VaapiVideoDecoder');
    } else if (wantX11) {
        console.log('💻 Display Server: X11');
        app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
        appendCsvSwitch('enable-features', 'VaapiVideoDecoder');
    } else {
        console.log('💻 Display Server: auto');
        app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
        appendCsvSwitch('enable-features', 'VaapiVideoDecoder');
    }

    if (!forceSoftware) {
        // GPU kara listesine takılan makinelerde siyah pencere olabiliyor
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }

    if (forceSoftware) {
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
        app.commandLine.appendSwitch('use-gl', 'swiftshader');
        appendCsvSwitch('disable-features', 'UseSkiaRenderer');
    } else if (forceGpu) {
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }

    // Genel GPU ayarları (performans için) - uygulama hazır olduğunda uygula
    if (app && app.commandLine) {
        app.commandLine.appendSwitch('enable-gpu-rasterization');
        app.commandLine.appendSwitch('enable-zero-copy');

        // Yazı tipi oluşturma iyileştirmeleri - Wayland/X11 uyumluluğu
        app.commandLine.appendSwitch('disable-font-subpixel-positioning');
        app.commandLine.appendSwitch('enable-font-antialiasing');
        app.commandLine.appendSwitch('force-device-scale-factor', '1');

        // Bağlam menüsü düzeltmeleri
        app.commandLine.appendSwitch('disable-gpu-sandbox');
    }
}

// ============================================================
// GPU GÜVENLİ MOD (TÜM PLATFORMLAR)
// ============================================================
function installGpuFailsafe() {
    const alreadySoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';

    const triggerFallback = (reason) => {
        if (alreadySoftware) return;
        console.warn(`[GPU] Crash detected (${reason}) -> switching to software rendering`);
        app.relaunch({
            env: {
                ...process.env,
                AURIVO_SOFTWARE_RENDER: '1'
            }
        });
        app.exit(0);
    };

    app.on('gpu-process-crashed', () => triggerFallback('gpu-process-crashed'));
    app.on('child-process-gone', (_event, details) => {
        if (details?.type === 'GPU' || details?.reason === 'crashed') {
            triggerFallback(`child-process-gone:${details?.reason || 'unknown'}`);
        }
    });
}

// Uygulama başlamadan önce görüntü sunucusunu algıla
detectDisplayServer();
installGpuFailsafe();
// node-id3'yı yükle (ID3 etiketi okumak için)
let NodeID3 = null;
try {
    NodeID3 = require('node-id3');
    console.log('node-id3 başarıyla yüklendi');
} catch (e) {
    console.error('node-id3 yüklenemedi:', e.message);
}

// C++ Ses Motoru (tembel başlatma - Windows'ta eksik DLL durumunda UI'nin donmaması için)
let audioEngine = null;
let isNativeAudioAvailable = false;
let audioEngineModule = null;
let nativeAudioInitAttempted = false;

function initNativeAudioEngineSafe({ force = false } = {}) {
    if (nativeAudioInitAttempted && !force) return isNativeAudioAvailable;
    nativeAudioInitAttempted = true;

    try {
        logWindowsRuntimeDepsOnce('native-audio-init');
        audioEngineModule = require('./audioEngine');
        audioEngine = audioEngineModule?.audioEngine || null;

        if (!audioEngine || typeof audioEngine.initialize !== 'function') {
            isNativeAudioAvailable = false;
            return false;
        }

        const ok = !!audioEngine.initialize();
        isNativeAudioAvailable = !!ok && !!audioEngineModule?.isNativeAvailable;

        if (isNativeAudioAvailable) {
            console.log('✓ C++ Aurivo Audio Engine aktif');
            if (process.platform === 'win32') {
                console.log('[NativeAudio] addon:', audioEngineModule?.loadedAddonPath || '(unknown)');
            }
        } else {
            console.warn('⚠ Native audio başlatılamadı, HTML5 Audio kullanılacak');
            const err = audioEngineModule?.lastNativeLoadError;
            if (process.platform === 'win32' && err) {
                console.warn('[NativeAudio] Detay:', err.message || err);
            }
        }

        return isNativeAudioAvailable;
    } catch (e) {
        isNativeAudioAvailable = false;
        audioEngine = null;
        console.warn('C++ Audio Engine yüklenemedi:', e?.message || e);
        return false;
    }
}

let mainWindow;
let tray = null;
let mprisPlayer = null;

// İndirme durumu (Aurivo-Dawlod / yt-dlp)
let downloadSeq = 0;
const activeDownloads = new Map(); // id -> { proc, killTimer }

function getResourcePath(relPath) {
    // Dev: doğrudan repo içinden
    // Prod: app.asar/index -> resources/
    if (app.isPackaged) {
        return path.join(process.resourcesPath, relPath);
    }
    return path.join(__dirname, relPath);
}

function getAppFilePath(relPath) {
    // app.asar içindeki paketlenmiş dosyalar için çalışır (örn. locales/*.json)
    // Dev: app.getAppPath() proje kökünü gösterir; Prod: .../resources/app.asar konumunu gösterir
    return path.join(app.getAppPath(), relPath);
}

function getLocaleCandidatePaths(lang) {
    const normalized = normalizeUiLang(lang) || 'en';
    const filename = `${normalized}.json`;

    // Tercih: app.asar (paket) / proje kökü (dev)
    const candidates = [
        getAppFilePath(path.join('locales', filename)),
        path.join(__dirname, 'locales', filename),
        // Bazı paketleme düzenlerinde app.asar açıkça resourcesPath altında olabilir
        path.join(process.resourcesPath || '', 'app.asar', 'locales', filename),
        path.join(process.resourcesPath || '', 'locales', filename)
    ];

    // Tekilleştir
    return [...new Set(candidates.filter(Boolean))];
}

function readFirstJsonSync(paths) {
    for (const p of paths || []) {
        try {
            const json = JSON.parse(fs.readFileSync(p, 'utf8'));
            return json || {};
        } catch {
            // sonrakini dene
        }
    }
    return null;
}

async function readFirstJson(paths) {
    for (const p of paths || []) {
        try {
            const data = await fs.promises.readFile(p, 'utf8');
            const json = JSON.parse(data);
            return json || {};
        } catch {
            // sonrakini dene
        }
    }
    return null;
}

function getDownloaderCliPath() {
    return getResourcePath(path.join('Aurivo-Dawlod', 'aurivo_download_cli.py'));
}

function getPythonCandidates() {
    const out = [];

    const envPython = process.env.AURIVO_PYTHON;
    if (envPython) out.push(envPython);

    // Dev: önce repo-yerel venv
    if (!app.isPackaged) {
        if (process.platform === 'win32') {
            out.push(path.join(__dirname, '.venv', 'Scripts', 'python.exe'));
        } else {
            out.push(path.join(__dirname, '.venv', 'bin', 'python'));
        }
    }

    if (process.platform !== 'win32') out.push('python3');
    out.push('python');

    return [...new Set(out)].filter(Boolean);
}

function spawnPythonWithFallback(args, spawnOpts) {
    const candidates = getPythonCandidates();
    let idx = 0;

    return new Promise((resolve, reject) => {
        const tryNext = (lastErr) => {
            if (idx >= candidates.length) {
                reject(lastErr || new Error('Python bulunamadı (AURIVO_PYTHON ayarlayabilir veya python3/python kurabilirsiniz).'));
                return;
            }

            const py = candidates[idx++];
            let child = null;
            try {
                child = spawn(py, args, {
                    ...spawnOpts,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } catch (e) {
                tryNext(e);
                return;
            }

            child.once('error', (err) => {
                if (err && err.code === 'ENOENT') {
                    tryNext(err);
                    return;
                }
                reject(err);
            });

            resolve(child);
        };

        tryNext(null);
    });
}

function getAppIconPath() {
    if (process.platform === 'win32') {
        return getResourcePath(path.join('icons', 'aurivo.ico'));
    }
    return getResourcePath(path.join('icons', 'aurivo_256.png'));
}

function getAppIconImage() {
    const iconPath = getAppIconPath();
    const img = nativeImage.createFromPath(iconPath);
    if (!img || img.isEmpty()) {
        return nativeImage.createFromPath(path.join(__dirname, 'icons', 'aurivo_256.png'));
    }
    return img;
}

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

// ============================================================
// UI I18N (Ana İşlem)
// - Renderer seçilen dili settings.json'a yazar: ui.language
// - Yedek: app.getLocale(), sonra İngilizce
// ============================================================
const UI_SUPPORTED_LANGS = new Set(['tr', 'en', 'ar', 'fr', 'de', 'es', 'hi']);
const uiMessagesCache = new Map(); // lang -> messages

function normalizeUiLang(lang) {
    if (!lang) return null;
    const base = String(lang).trim().toLowerCase().split(/[-_]/)[0];
    return UI_SUPPORTED_LANGS.has(base) ? base : null;
}

function deepGet(obj, pathStr) {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = String(pathStr).split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined;
        cur = cur[p];
    }
    return cur;
}

function formatTemplate(str, vars) {
    if (!vars || typeof vars !== 'object') return String(str);
    return String(str).replace(/\{(\w+)\}/g, (_m, k) => {
        if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k]);
        return `{${k}}`;
    });
}

function getUiLanguageSync() {
    try {
        const data = fs.readFileSync(getSettingsPath(), 'utf8');
        const parsed = JSON.parse(data);
        const saved = normalizeUiLang(parsed?.ui?.language);
        if (saved) return saved;
    } catch {
        // yoksay
    }

    return normalizeUiLang(app.getLocale()) || 'en';
}

function loadUiMessagesSync(lang) {
    const normalized = normalizeUiLang(lang) || 'en';
    if (uiMessagesCache.has(normalized)) return uiMessagesCache.get(normalized);
    try {
        const json = readFirstJsonSync(getLocaleCandidatePaths(normalized));
        if (json) {
            uiMessagesCache.set(normalized, json || {});
            return json || {};
        }
    } catch {
        if (normalized !== 'en') return loadUiMessagesSync('en');
        uiMessagesCache.set('en', {});
        return {};
    }
}

function tMainSync(key, vars) {
    const lang = getUiLanguageSync();
    const messages = loadUiMessagesSync(lang);
    let raw = deepGet(messages, key);
    if (typeof raw !== 'string' && lang !== 'en') {
        raw = deepGet(loadUiMessagesSync('en'), key);
    }
    if (typeof raw !== 'string') return String(key);
    return formatTemplate(raw, vars);
}

function installAppMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        ...(isMac ? [{
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit', label: tMainSync('appMenu.quit') }
            ]
        }] : []),
        {
            label: tMainSync('appMenu.file'),
            submenu: [
                ...(isMac ? [] : [{ role: 'quit', label: tMainSync('appMenu.quit') }])
            ]
        },
        {
            label: tMainSync('appMenu.edit'),
            submenu: [
                { role: 'undo', label: tMainSync('appMenu.undo') },
                { role: 'redo', label: tMainSync('appMenu.redo') },
                { type: 'separator' },
                { role: 'cut', label: tMainSync('appMenu.cut') },
                { role: 'copy', label: tMainSync('appMenu.copy') },
                { role: 'paste', label: tMainSync('appMenu.paste') },
                { role: 'selectAll', label: tMainSync('appMenu.selectAll') }
            ]
        },
        {
            label: tMainSync('appMenu.view'),
            submenu: [
                { role: 'reload', label: tMainSync('appMenu.reload') },
                { role: 'toggleDevTools', label: tMainSync('appMenu.toggleDevTools') },
                { type: 'separator' },
                { role: 'resetZoom', label: tMainSync('appMenu.resetZoom') },
                { role: 'zoomIn', label: tMainSync('appMenu.zoomIn') },
                { role: 'zoomOut', label: tMainSync('appMenu.zoomOut') },
                { type: 'separator' },
                { role: 'togglefullscreen', label: tMainSync('appMenu.toggleFullscreen') }
            ]
        },
        {
            label: tMainSync('appMenu.window'),
            submenu: [
                { role: 'minimize', label: tMainSync('appMenu.minimize') },
                { role: 'close', label: tMainSync('appMenu.close') }
            ]
        },
        {
            label: tMainSync('appMenu.help'),
            submenu: [
                {
                    label: 'aurivo.app',
                    click: () => shell.openExternal('https://aurivo.app').catch(() => { /* yoksay */ })
                }
            ]
        }
    ];

    try {
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } catch (e) {
        console.warn('[MENU] Failed to set application menu:', e?.message || e);
    }
}

async function writeJsonFileAtomic(filePath, obj) {
    const dir = path.dirname(filePath);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
    } catch {
        // yoksay
    }

    const tmpPath = `${filePath}.tmp`;
    const json = JSON.stringify(obj ?? {}, null, 2);
    await fs.promises.writeFile(tmpPath, json, 'utf8');

    try {
        await fs.promises.rename(tmpPath, filePath);
    } catch (e) {
        // Windows'ta hedef dosya varsa yeniden adlandırma bazen hata verebilir.
        if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
            await fs.promises.unlink(filePath).catch(() => { /* yoksay */ });
            await fs.promises.rename(tmpPath, filePath);
            return;
        }
        throw e;
    }
}

function normalizeEq32BandsForEngine(bands) {
    const out = new Array(32).fill(0);
    if (!Array.isArray(bands)) return out;
    for (let i = 0; i < 32; i++) {
        const n = Number(bands[i]);
        out[i] = Number.isFinite(n) ? Math.max(-12, Math.min(12, n)) : 0;
    }
    return out;
}

async function applyPersistedEq32SfxFromSettings() {
    if (!audioEngine || !isNativeAudioAvailable) return;

    try {
        const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
        const settings = JSON.parse(data);
        const eq32 = settings?.sfx?.eq32;
        if (!eq32) return;

        const bands = normalizeEq32BandsForEngine(eq32.bands);
        if (typeof audioEngine.setEQBands === 'function') {
            audioEngine.setEQBands(bands);
        } else if (typeof audioEngine.setEQBand === 'function') {
            bands.forEach((v, i) => audioEngine.setEQBand(i, v));
        }

        if (Number.isFinite(eq32.balance) && typeof audioEngine.setBalance === 'function') {
            audioEngine.setBalance(eq32.balance);
        }
        if (Number.isFinite(eq32.bass) && typeof audioEngine.setBass === 'function') {
            audioEngine.setBass(eq32.bass);
        }
        if (Number.isFinite(eq32.mid) && typeof audioEngine.setMid === 'function') {
            audioEngine.setMid(eq32.mid);
        }
        if (Number.isFinite(eq32.treble) && typeof audioEngine.setTreble === 'function') {
            audioEngine.setTreble(eq32.treble);
        }
        if (Number.isFinite(eq32.stereoExpander) && typeof audioEngine.setStereoExpander === 'function') {
            audioEngine.setStereoExpander(eq32.stereoExpander);
        }

        const name = eq32?.lastPreset?.name;
        console.log(`[SFX] EQ32 ayarları yüklendi${name ? `: ${name}` : ''}`);
    } catch {
        // Ayar dosyası yoksa sorun değil
    }
}

async function updateEq32SettingsInFile(patch) {
    try {
        let current = null;
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            current = JSON.parse(data);
        } catch {
            current = {};
        }

        const next = { ...(current || {}) };
        next.sfx = { ...(next.sfx || {}) };
        next.sfx.eq32 = { ...(next.sfx.eq32 || {}) };

        Object.assign(next.sfx.eq32, patch || {});

        await writeJsonFileAtomic(getSettingsPath(), next);
        return next;
    } catch (e) {
        console.error('[SFX] EQ32 settings update error:', e);
        return null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        minWidth: 1200,
        minHeight: 720,
        backgroundColor: '#121212',
        icon: getAppIconImage(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,  // Preload'da Node.js modülleri için gerekli
            webviewTag: true,  // WebView desteği
            spellcheck: false
        },
        frame: true,
        titleBarStyle: 'default',
        show: false
    });

    let hasEverBeenShown = false;

    if (process.platform === 'linux' && typeof mainWindow.setIcon === 'function') {
        mainWindow.setIcon(getAppIconImage());
    }

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('[WEB] did-fail-load:', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[WEB] render-process-gone:', details);
    });

    mainWindow.webContents.on('unresponsive', () => {
        console.warn('[WEB] renderer unresponsive');
    });

    mainWindow.webContents.on('responsive', () => {
        console.log('[WEB] renderer responsive');
    });

    // İlk açılışta pencereyi zorla görünür yap
    mainWindow.show();
    mainWindow.center();
    mainWindow.focus();

    // Renderer loglarını terminale düşür (çapraz geçiş gibi UI tarafı hata ayıklama için)
    mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
        // sourceId boş olabiliyor
        const src = sourceId ? String(sourceId).split('/').slice(-1)[0] : 'renderer';
        safeStdoutLine(`[RENDERER] ${message} (${src}:${line})`);
    });

    // Pencere hazır olduğunda göster (flash önleme)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
        hasEverBeenShown = true;
    });

    // Wayland/GPU sorunlarında ready-to-show tetiklenmezse yedek
    mainWindow.webContents.once('did-finish-load', () => {
        if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
            hasEverBeenShown = true;
        }
        // Pencereyi öne getir
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(false);
            }
        }, 1500);

        // Native ses başlatmayı UI yüklendikten sonra dene (başarısız olursa uygulama akışı bozulmasın)
        setTimeout(() => {
            try {
                const success = initNativeAudioEngineSafe();
                if (!success && process.platform === 'win32') {
                    logWindowsRuntimeDepsOnce('after-native-init-failed');
                    console.error('[WINDOWS] Native audio başarısız oldu - Sistem gereksinimleri kontrol et:');
                    console.error('[WINDOWS] 1. Visual C++ Runtime gerekli');
                    console.error('[WINDOWS] 2. libs/windows/*.dll dosyaları derleme klasöründe olmalı');
                    console.error('[WINDOWS] 3. native/build/Release/*.dll dosyaları derleme klasöründe olmalı');
                }
            } catch (e) {
                console.warn('[NativeAudio] init error:', e?.message || e);
            }
        }, 0);
    });
    setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
            hasEverBeenShown = true;
        }
    }, 2000);

    // Eğer pencere hiç görünmezse yazılım render'a otomatik düş
    setTimeout(() => {
        const alreadySoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
        if (mainWindow && !hasEverBeenShown && !mainWindow.isVisible() && !alreadySoftware) {
            console.warn('[GPU] Window not visible -> fallback to software rendering');
            app.relaunch({
                env: {
                    ...process.env,
                    AURIVO_SOFTWARE_RENDER: '1'
                }
            });
            app.exit(0);
        }
    }, 6000);

    // DevTools (sadece geliştirme modunda açılır)
    // Geliştirme için: npm run dev veya AURIVO_DEV=1 npm start
    if (process.env.AURIVO_DEV === '1' || process.argv.includes('--dev')) {
        // mainWindow.webContents.openDevTools();
    }

    // Pencere kapatma davranışı: tray'e minimize et
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        // Ana pencere kapandığında ses efektleri penceresini de kapat
        if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
            soundEffectsWindow.close();
        }
    });
}

function createTray() {
    const iconPath = process.platform === 'win32'
        ? getResourcePath(path.join('icons', 'aurivo_256.png'))
        : getResourcePath(path.join('icons', 'aurivo_256.png'));

    tray = new Tray(nativeImage.createFromPath(iconPath));

    updateTrayMenu({ isPlaying: false, currentTrack: 'Aurivo Media Player' });

    tray.setToolTip('Aurivo Media Player');

    // Tray ikonuna sol tık: pencereyi göster/gizle
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
}

// ============================================
// MPRIS (Linux Media Player Entegrasyonu)
// ============================================
function createMPRIS() {
    if (!Player || process.platform !== 'linux') {
        console.log('MPRIS sadece Linux için destekleniyor');
        return;
    }

    try {
        mprisPlayer = Player({
            name: 'aurivo',
            identity: 'Aurivo Media Player',
            desktopEntry: 'aurivo-media-player', // KDE/GNOME eşleşmesi için gerekli
            supportedUriSchemes: ['file'],
            supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/x-wav', 'audio/ogg'],
            supportedInterfaces: ['player']
        });

        // Oynatma yeteneklerini ayarla
        mprisPlayer.canSeek = true;
        mprisPlayer.canControl = true;
        mprisPlayer.canPlay = true;
        mprisPlayer.canPause = true;
        mprisPlayer.canGoNext = true;
        mprisPlayer.canGoPrevious = true;

        // Oynatma kontrollerini bağla
        mprisPlayer.on('play', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'play-pause');
            }
        });

        mprisPlayer.on('pause', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'play-pause');
            }
        });

        mprisPlayer.on('playpause', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'play-pause');
            }
        });

        mprisPlayer.on('stop', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'stop');
            }
        });

        mprisPlayer.on('next', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'next');
            }
        });

        mprisPlayer.on('previous', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'previous');
            }
        });

        mprisPlayer.on('seek', (offset) => {
            console.log('MPRIS seek event, offset:', offset);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mpris-seek', offset);
            }
        });

        mprisPlayer.on('position', (event) => {
            console.log('MPRIS position event:', event.position);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mpris-position', event.position);
            }
        });

        // getPosition desteği (MPRIS tarafından çağrılır)
        mprisPlayer.getPosition = () => {
            // Çalıyorsa, son güncellemeden bu yana geçen süreyi ekle (Ekstrapolasyon)
            if (mprisPlayer.playbackStatus === Player.PLAYBACK_STATUS_PLAYING && mprisPlayer._lastUpdateHRTime) {
                const elapsed = process.hrtime(mprisPlayer._lastUpdateHRTime);
                const elapsedMicros = (elapsed[0] * 1000000) + Math.floor(elapsed[1] / 1000);
                return (mprisPlayer.position || 0) + elapsedMicros;
            }
            return mprisPlayer.position || 0;
        };

        console.log('✓ MPRIS player başlatıldı');
    } catch (e) {
        // MPRIS başlatma hatalarını sessizce yoksay
        console.log('MPRIS başlatma atlandı:', e.message);
    }
}

// MPRIS metadata güncelleme
function updateMPRISMetadata(metadata) {
    if (!mprisPlayer) return;

    try {
        const mprisMetadata = {
            'mpris:trackid': mprisPlayer.objectPath('track/' + (metadata.trackId || '0')),
            'mpris:length': Math.floor((metadata.duration || 0) * 1000000), // saniye -> mikrosaniye
            'mpris:artUrl': metadata.albumArt || '',
            'xesam:title': metadata.title || 'Bilinmeyen Parça',
            'xesam:artist': metadata.artist ? [metadata.artist] : ['Bilinmeyen Sanatçı'],
            'xesam:album': metadata.album || ''
        };

        mprisPlayer.metadata = mprisMetadata;
        mprisPlayer.playbackStatus = metadata.isPlaying ? Player.PLAYBACK_STATUS_PLAYING : Player.PLAYBACK_STATUS_PAUSED;

        // Pozisyon bilgisini güncelle (saniye -> mikrosaniye)
        if (typeof metadata.position === 'number') {
            mprisPlayer.position = Math.floor(metadata.position * 1000000);
            mprisPlayer._lastUpdateHRTime = process.hrtime();
        }

        // Seek yeteneklerini güncelle
        mprisPlayer.canSeek = (typeof metadata.canSeek === 'boolean') ? metadata.canSeek : true;
        mprisPlayer.canControl = true;
        if (typeof metadata.canGoNext === 'boolean') mprisPlayer.canGoNext = metadata.canGoNext;
        if (typeof metadata.canGoPrevious === 'boolean') mprisPlayer.canGoPrevious = metadata.canGoPrevious;

        console.log('MPRIS metadata güncellendi:', metadata.title, 'duration:', metadata.duration.toFixed(1), 's, position:', metadata.position.toFixed(1), 's');
    } catch (e) {
        // D-Bus bağlantı hataları - sessizce yoksay (normal durum)
        // EPIPE, akış kapalı gibi hatalar dbus bağlantısı hazır olmadığında oluşur
        const ignoredErrors = ['EPIPE', 'stream is closed', 'Cannot send message'];
        const shouldIgnore = ignoredErrors.some(err =>
            e.code === err || (e.message && e.message.includes(err))
        );

        if (!shouldIgnore) {
            console.error('MPRIS metadata güncelleme hatası:', e.message);
        }
        // Hata gösterme - bu normal bir durum
    }
}

function updateTrayMenu(state) {
    if (!tray) return;

    const { isPlaying = false, currentTrack = 'Aurivo Media Player', isMuted = false, stopAfterCurrent = false } = state;

    // İkonları yükle
    const iconPath = (name) => {
        const p = getResourcePath(path.join('icons', name));
        return nativeImage.createFromPath(p);
    };

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Önceki parça',
            icon: iconPath('tray-previous.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'previous');
                }
            }
        },
        {
            label: isPlaying ? 'Duraklat' : 'Oynat',
            icon: iconPath(isPlaying ? 'tray-pause.png' : 'tray-play.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'play-pause');
                }
            }
        },
        {
            label: 'Durdur',
            icon: iconPath('tray-stop.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'stop');
                }
            }
        },
        {
            label: 'Bu parçadan sonra durdur',
            type: 'checkbox',
            checked: stopAfterCurrent,
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'stop-after-current');
                }
            }
        },
        {
            label: 'Sonraki parça',
            icon: iconPath('tray-next.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'next');
                }
            }
        },
        { type: 'separator' },
        {
            label: isMuted ? 'Sesi aç' : 'Sessiz',
            icon: iconPath(isMuted ? 'tray-volume.png' : 'tray-mute.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'mute-toggle');
                }
            }
        },
        {
            label: 'Beğen',
            icon: iconPath('tray-like.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'like');
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Göster',
            icon: iconPath('tray-show.png'),
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: 'Çık',
            icon: iconPath('tray-exit.png'),
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

// ============================================
// SES EFEKTLERİ PENCERESİ
// ============================================
let soundEffectsWindow = null;

// ============================================
// EQ HAZIR AYARLAR (AUTOEQ) PENCERESİ
// ============================================
let eqPresetsWindow = null;

function createSoundEffectsWindow() {
    // Pencere zaten açıksa, önne getir
    if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
        soundEffectsWindow.focus();
        return;
    }

    soundEffectsWindow = new BrowserWindow({
        width: 1300,
        height: 800,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#0a0a0f',
        icon: getAppIconImage(),
        parent: null, // Bağımsız pencere (ana pencereden ayrı)
        modal: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        frame: false, // Özel başlık çubuğu için çerçevesiz
        title: 'Ses Efektleri — Aurivo Medya Player',
        show: false
    });

    if (process.platform === 'linux' && typeof soundEffectsWindow.setIcon === 'function') {
        soundEffectsWindow.setIcon(getAppIconImage());
    }

    soundEffectsWindow.loadFile(path.join(__dirname, 'soundEffects.html'));

    // Pencere hazır olduğunda göster
    soundEffectsWindow.once('ready-to-show', () => {
        soundEffectsWindow.show();
    });

    soundEffectsWindow.on('closed', () => {
        soundEffectsWindow = null;
    });
}

function createEQPresetsWindow() {
    console.log('[createEQPresetsWindow] Fonksiyon çağrıldı');

    // Pencere zaten açıksa, önne getir
    if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
        console.log('[createEQPresetsWindow] Pencere zaten açık, focus yapılıyor');
        eqPresetsWindow.focus();
        return;
    }

    // Üst pencere: ses efektleri penceresini bul; yoksa ana pencereyi kullan
    let parentWindow = null;
    if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
        parentWindow = soundEffectsWindow;
        console.log('[createEQPresetsWindow] Parent: soundEffectsWindow');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
        parentWindow = mainWindow;
        console.log('[createEQPresetsWindow] Parent: mainWindow');
    } else {
        console.log('[createEQPresetsWindow] UYARI: Parent pencere bulunamadı!');
    }

    console.log('[createEQPresetsWindow] BrowserWindow oluşturuluyor...');
    eqPresetsWindow = new BrowserWindow({
        width: 560,
        height: 720,
        minWidth: 520,
        minHeight: 640,
        backgroundColor: '#111115',
        icon: getAppIconImage(),
        parent: parentWindow,
        modal: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        frame: true,
        title: 'Aurivo Hazır Ayarlar — Aurivo Medya Player',
        show: false
    });

    let hasEverBeenShown = false;

    if (process.platform === 'linux' && typeof eqPresetsWindow.setIcon === 'function') {
        eqPresetsWindow.setIcon(getAppIconImage());
    }

    const htmlPath = path.join(__dirname, 'eqPresets.html');
    console.log('[createEQPresetsWindow] HTML dosyası yükleniyor:', htmlPath);

    eqPresetsWindow.loadFile(htmlPath)
        .then(() => {
            console.log('[createEQPresetsWindow] HTML yükleme başarılı, pencere gösteriliyor');
            if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
                eqPresetsWindow.show();
            }
        })
        .catch(err => {
            console.error('[createEQPresetsWindow] loadFile HATA:', err);
        });

    eqPresetsWindow.once('ready-to-show', () => {
        console.log('[createEQPresetsWindow] ready-to-show event tetiklendi');
    });

    eqPresetsWindow.on('closed', () => {
        eqPresetsWindow = null;
    });
}

// Ses Efektleri Penceresini Aç
ipcMain.handle('soundEffects:openWindow', () => {
    createSoundEffectsWindow();
    return true;
});

// Ses Efektleri Penceresini Kapat
ipcMain.handle('soundEffects:closeWindow', () => {
    if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
        soundEffectsWindow.close();
    }
    return true;
});

// EQ Hazır Ayarlar Penceresini Aç
ipcMain.handle('eqPresets:openWindow', async () => {
    try {
        console.log('[EQ Presets] IPC handler çağrıldı, pencere açılıyor...');
        createEQPresetsWindow();
        console.log('[EQ Presets] Pencere oluşturuldu');
        return true;
    } catch (err) {
        console.error('[EQ Presets] Hata:', err);
        return false;
    }
});

ipcMain.handle('eqPresets:closeWindow', () => {
    if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
        eqPresetsWindow.close();
    }
    return true;
});

ipcMain.handle('eqPresets:getFeaturedList', () => {
    return AURIVO_EQ_FEATURED_LIST;
});

// ============================================
// PROJECTM GÖRSELLEŞTİRİCİ (NATIVE ÇALIŞTIRILABİLİR)
// ============================================
let visualizerProc = null;
let visualizerFeedTimer = null;
let visualizerFeedStats = null;

function stopVisualizerFeed() {
    if (visualizerFeedTimer) {
        clearInterval(visualizerFeedTimer);
        visualizerFeedTimer = null;
    }
    visualizerFeedStats = null;
}

function startVisualizerFeed() {
    stopVisualizerFeed();
    if (!visualizerProc || !visualizerProc.stdin) return;
    if (!audioEngine || typeof audioEngine.getPCMData !== 'function') {
        console.warn('[Visualizer] PCM feed yok: audioEngine.getPCMData bulunamadı');
        return;
    }

    const requestedFramesPerChannel = 1024;
    visualizerFeedStats = {
        startedAt: Date.now(),
        lastLogAt: 0,
        packets: 0,
        bytes: 0,
        drops: 0,
        noData: 0,
        backpressure: 0,
        firstWriteOk: false
    };

    visualizerFeedTimer = setInterval(() => {
        try {
            if (!visualizerProc || visualizerProc.killed || !visualizerProc.stdin || visualizerProc.stdin.destroyed) {
                stopVisualizerFeed();
                return;
            }
            if (!visualizerProc.stdin.writable) {
                stopVisualizerFeed();
                return;
            }

            // Native ses motorundan kanallar arası (interleaved) float PCM al
            const pcmRes = audioEngine.getPCMData(requestedFramesPerChannel);
            if (!pcmRes || !pcmRes.data || pcmRes.data.length === 0) {
                if (visualizerFeedStats) visualizerFeedStats.noData++;
                return;
            }

            let channels = Number(pcmRes.channels) || 0;
            if (channels <= 0) return;
            if (channels > 2) channels = 2;

            let floatArray = (pcmRes.data instanceof Float32Array) ? pcmRes.data : Float32Array.from(pcmRes.data);
            const countPerChannel = Math.floor(floatArray.length / channels);
            if (countPerChannel <= 0) {
                if (visualizerFeedStats) visualizerFeedStats.noData++;
                return;
            }
            const floatCount = countPerChannel * channels;
            if (floatCount !== floatArray.length) {
                floatArray = floatArray.subarray(0, floatCount);
            }

            // Protokol v2: [u32 channels][u32 countPerChannel][float32 * (channels*countPerChannel)]
            const header = Buffer.allocUnsafe(8);
            header.writeUInt32LE(channels, 0);
            header.writeUInt32LE(countPerChannel, 4);

            const payload = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatCount * 4);

            // Geri basınç olursa kare atla.
            const ok1 = visualizerProc.stdin.write(header);
            const ok2 = visualizerProc.stdin.write(payload);
            if (!ok1 || !ok2) {
                // Drain beklemeyelim; bir sonraki tick'te tekrar deneriz.
                if (visualizerFeedStats) visualizerFeedStats.backpressure++;
            }
            if (visualizerFeedStats) {
                visualizerFeedStats.packets++;
                visualizerFeedStats.bytes += header.length + payload.length;
                if (!visualizerFeedStats.firstWriteOk) {
                    visualizerFeedStats.firstWriteOk = true;
                    console.log('[Visualizer] PCM pipe active (first write ok)');
                }
            }
        } catch (e) {
            // en iyi çaba
            if (visualizerFeedStats) visualizerFeedStats.drops++;
        }

        if (visualizerFeedStats) {
            const now = Date.now();
            if (now - visualizerFeedStats.lastLogAt > 5000) {
                visualizerFeedStats.lastLogAt = now;
                const up = Math.max(1, Math.round((now - visualizerFeedStats.startedAt) / 1000));
                console.log('[Visualizer] PCM stats', {
                    up_s: up,
                    packets: visualizerFeedStats.packets,
                    bytes: visualizerFeedStats.bytes,
                    backpressure: visualizerFeedStats.backpressure,
                    noData: visualizerFeedStats.noData,
                    drops: visualizerFeedStats.drops
                });
            }
        }
    }, 33);
}

function isDevMode() {
    // Dev modda (electron . / npm start), build-visualizer içindeki yeni derlenmiş native binary'leri tercih ederiz.
    // Paketli sürümlerde native-dist kullanılır.
    return !app.isPackaged || process.env.AURIVO_DEV === '1' || process.argv.includes('--dev');
}

function pickFirstExistingPath(paths) {
    for (const p of paths || []) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch {
            // yoksay
        }
    }
    return '';
}

function getProjectMPresetsPath() {
    const candidates = [];

    if (app.isPackaged) {
        // Tercih edilen paket yolu (extraResources ile açıkça eşlenmiş)
        candidates.push(path.join(process.resourcesPath, 'visualizer-presets'));
        // Yedek: third_party tamamen taşınmışsa
        candidates.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'presets'));
    } else {
        candidates.push(getResourcePath(path.join('third_party', 'projectm', 'presets')));
    }

    return pickFirstExistingPath(candidates);
}

function getVisualizerExecutableCandidates() {
    const out = [];

    // Paketlenmiş (Windows): native-dist tercih edilir; gerekirse taşınmış third_party'ye düş (binary içeriyorsa)
    if (app.isPackaged && process.platform === 'win32') {
        out.push(path.join(process.resourcesPath, 'native-dist', 'aurivo-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'aurivo-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'bin', 'aurivo-projectm-visualizer.exe'));
        return out;
    }

    const exeName = process.platform === 'win32'
        ? 'aurivo-projectm-visualizer.exe'
        : 'aurivo-projectm-visualizer';

    // Paketlenmiş (Linux/Mac): resources/native-dist (extraResources)
    if (app.isPackaged) {
        out.push(path.join(process.resourcesPath, 'native-dist', exeName));
        // third_party taşınmış ve binary içeriyorsa isteğe bağlı yedek
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', exeName));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'bin', exeName));
        return out;
    }

    // Dev: mevcut davranışı koru (distPath + build-visualizer adayları aşağıda)
    out.push(getResourcePath(path.join('native-dist', exeName)));
    return out;
}

function getVisualizerExecutablePath() {
    const exeName = process.platform === 'win32'
        ? 'aurivo-projectm-visualizer.exe'
        : 'aurivo-projectm-visualizer';

    // Temel aday(lar)
    const baseCandidates = getVisualizerExecutableCandidates();
    const basePick = pickFirstExistingPath(baseCandidates);

    // Geliştirici kolaylığı: varsa yeni CMake çıktısını tercih et.
    const devCandidates = process.platform === 'win32'
        ? [
            path.join(__dirname, 'build-visualizer', 'Release', exeName),
            path.join(__dirname, 'build-visualizer', exeName)
        ]
        : [
            path.join(__dirname, 'build-visualizer', exeName)
        ];

    // Geliştirici kolaylığı: varsa yeni CMake çıktısını tercih et.
    // Bu, native-dist'e kopyalamayı unutunca oluşan "derlemede çalışıyor ama uygulamada çalışmıyor" sorunlarını önler.
    if (isDevMode()) {
        for (const p of devCandidates) {
            if (fs.existsSync(p)) return p;
        }
        return basePick || ((baseCandidates && baseCandidates[0]) ? baseCandidates[0] : '');
    }

    // Dev dışı: paketli adayları tercih et; yoksa yedeğe izin ver.
    if (basePick && fs.existsSync(basePick)) return basePick;
    for (const p of devCandidates) {
        if (fs.existsSync(p)) {
            console.warn('[Visualizer] native-dist bulunamadı; build-visualizer çıktısına fallback:', p);
            return p;
        }
    }
    return basePick || ((baseCandidates && baseCandidates[0]) ? baseCandidates[0] : '');
}

function startVisualizer() {
    if (visualizerProc && !visualizerProc.killed) return true;

    const exeCandidates = getVisualizerExecutableCandidates();
    const exePath = getVisualizerExecutablePath();

    const presetsCandidates = [
        path.join(process.resourcesPath || '', 'visualizer-presets'),
        path.join(process.resourcesPath || '', 'third_party', 'projectm', 'presets'),
        getProjectMPresetsPath()
    ].filter(Boolean);
    const presetsPath = pickFirstExistingPath(presetsCandidates);

    const exeOk = fs.existsSync(exePath);
    const presetsOk = fs.existsSync(presetsPath);
    if (!exeOk || !presetsOk) {
        if (!exeOk) console.error('[Visualizer] executable bulunamadı:', exePath);
        if (!presetsOk) console.error('[Visualizer] presets bulunamadı:', presetsPath);

        const title = tMainSync('visualizer.notFoundTitle') || (process.platform === 'win32'
            ? 'Görselleştirici Windows uyumlu değil'
            : 'Görselleştirici bileşenleri eksik');
        let body = tMainSync('visualizer.notFoundBody', { path: exePath }) || '';

        const lines = [];
        lines.push('Aranan yollar:');
        lines.push(`- Visualizer: ${exePath}`);
        if (exeCandidates?.length) {
            lines.push('  Adaylar:');
            for (const p of exeCandidates) lines.push(`  - ${p}`);
        }
        lines.push(`- Presets: ${presetsPath}`);
        lines.push('  Adaylar:');
        for (const p of presetsCandidates) lines.push(`  - ${p}`);
        lines.push('');
        lines.push('Çözüm:');
        if (process.platform === 'win32') {
            lines.push('- Görselleştirici, Windows üzerinde çalışmak için `aurivo-projectm-visualizer.exe` gerektirir.');
        }
        lines.push('- Uygulamayı yeniden kurmayı deneyin.');
        lines.push('- Paketleme sırasında `native-dist` (exe) ve presets klasörünün `extraResources` içine dahil olduğundan emin olun.');
        lines.push('- Bu eksiklik müzik kütüphanesini/oynatıcıyı etkilemez; sadece görselleştirici devre dışı kalır.');

        body = [body, lines.join('\n')].filter(Boolean).join('\n\n');
        // Uygulamayı kilitlemeyelim: uyarı göster ve çık.
        dialog.showMessageBox({
            type: 'warning',
            title,
            message: title,
            detail: body,
            buttons: ['Tamam']
        }).catch(() => { /* yoksay */ });
        return false;
    }

    const visualizerIconPath = getResourcePath(path.join('icons', 'aurivo_logo.bmp'));

    const env = {
        ...process.env,
        PROJECTM_PRESETS_PATH: presetsPath,
        AURIVO_VISUALIZER_ICON: visualizerIconPath,
        // Native görselleştirici için UI dili (SDL2/ImGui)
        AURIVO_LANG: getUiLanguageSync(),
        // Varsayılan ana pencere boyutu (kullanıcı yeniden boyutlandırabilir; bir sonraki açılışta bu varsayılan kullanılır).
        AURIVO_VIS_MAIN_W: process.env.AURIVO_VIS_MAIN_W || '900',
        AURIVO_VIS_MAIN_H: process.env.AURIVO_VIS_MAIN_H || '650'
    };

    // Linux: SDL2 için görüntü değişkenleri (Wayland/X11)
    if (process.platform === 'linux') {
        env.DISPLAY = process.env.DISPLAY || '';
        env.WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY || '';
        env.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11');
        env.SDL_VIDEODRIVER = process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11';
    }

    try {
        console.log('[Visualizer] starting:', exePath);
        console.log('[Visualizer] presets:', presetsPath);
        console.log('[Visualizer] ✓ Input source: Aurivo PCM only (NO mic/capture)');
        console.log('[Visualizer] DISPLAY:', env.DISPLAY);
        console.log('[Visualizer] SDL_VIDEODRIVER:', env.SDL_VIDEODRIVER);

        // Hata ayıklama: strace ile çalıştır
        const useStrace = false; // hata ayıklama için true yap
        const actualExe = useStrace ? 'strace' : exePath;
        const actualArgs = useStrace ? ['-o', '/tmp/visualizer-strace.log', '-ff', exePath, '--presets', presetsPath] : ['--presets', presetsPath];

        visualizerProc = spawn(actualExe, actualArgs, {
            env,
            stdio: ['pipe', 'inherit', 'inherit'], // Hata ayıklama için stdout/stderr her zaman inherit
            detached: true // Electron GL context çakışmalarını önlemek için ayrı process grubunda çalıştır
        });

        // Electron'ın görselleştiriciyi beklememesi için unref
        visualizerProc.unref();

        startVisualizerFeed();

        visualizerProc.on('exit', (code, signal) => {
            console.log(`[Visualizer] kapandı (code=${code}, signal=${signal})`);
            stopVisualizerFeed();
            visualizerProc = null;
        });

        visualizerProc.on('error', (err) => {
            console.error('[Visualizer] spawn error:', err);
            stopVisualizerFeed();
            visualizerProc = null;
        });

        // stdin hata yönetimi (EPIPE önleme)
        if (visualizerProc.stdin) {
            visualizerProc.stdin.on('error', (err) => {
                if (err.code === 'EPIPE') {
                    console.warn('[Visualizer] stdin EPIPE (visualizer closed)');
                } else {
                    console.error('[Visualizer] stdin error:', err);
                }
                stopVisualizerFeed();
            });
        }

        return true;
    } catch (e) {
        console.error('[Visualizer] startVisualizer exception:', e);
        visualizerProc = null;
        return false;
    }
}

function stopVisualizer() {
    if (!visualizerProc) return true;
    try {
        console.log('[Visualizer] stopping...');
        stopVisualizerFeed();
        visualizerProc.kill('SIGTERM');
    } catch (e) {
        // en iyi çaba
    }
    visualizerProc = null;
    return true;
}

ipcMain.handle('visualizer:toggle', () => {
    if (visualizerProc && !visualizerProc.killed) {
        console.log('[Visualizer] toggle -> stop');
        stopVisualizer();
        return { running: false };
    }

    console.log('[Visualizer] toggle -> start');
    const started = startVisualizer();
    return { running: started };
});

// ============================================
// I18N (LOCALE'LER)
// ============================================
ipcMain.handle('i18n:loadLocale', async (_event, lang) => {
    const normalized = normalizeUiLang(lang) || 'en';
    try {
        const json = await readFirstJson(getLocaleCandidatePaths(normalized));
        if (json) return json;
    } catch (e) {
        if (normalized !== 'en') {
            try {
                const json = await readFirstJson(getLocaleCandidatePaths('en'));
                if (json) return json;
            } catch {
                return {};
            }
        }
        return {};
    }
    // Yedek
    if (normalized !== 'en') {
        const json = await readFirstJson(getLocaleCandidatePaths('en'));
        if (json) return json;
    }
    return {};
});

// ============================================
// APP KONTROL (YENİDEN BAŞLAT)
// ============================================
ipcMain.handle('app:relaunch', async () => {
    try {
        // Ayrık native süreçlerin (örn. görselleştirici) yeniden başlatmadan sonra yaşamamasını sağla.
        stopVisualizer();

        app.relaunch();
        // before-quit handler'larının çalışması için nazik çıkışı tercih et.
        app.quit();
        // Güvenlik ağı: çıkışı engelleyen bir şey varsa zorla çık.
        setTimeout(() => {
            try { app.exit(0); } catch { }
        }, 900);
        return true;
    } catch (e) {
        console.error('[APP] relaunch failed:', e);
        return false;
    }
});

// ============================================
// PENCERE KONTROL IPC HANDLERS
// ============================================
ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.minimize();
    }
    return true;
});

ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    }
    return win ? win.isMaximized() : false;
});

ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.close();
    }
    return true;
});

ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
});

app.whenReady().then(async () => {
    // GPU ayarları burada uygula
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');

    try { installAppMenu(); } catch (e) { console.error('[APP] installAppMenu error:', e); }
    try { createWindow(); } catch (e) { console.error('[APP] createWindow error:', e); }
    try { createTray(); } catch (e) { console.error('[APP] createTray error:', e); }
    try { createMPRIS(); } catch (e) { console.error('[APP] createMPRIS error:', e); }

    // Kayıtlı EQ32 presetini açılışta uygula
    try { await applyPersistedEq32SfxFromSettings(); } catch (e) { console.error('[SFX] applyPersistedEq32SfxFromSettings error:', e); }

    app.on('activate', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createWindow();
        }
    });
}).catch((e) => {
    console.error('[APP] whenReady error:', e);
});

app.on('window-all-closed', () => {
    // Tray varsa uygulamayı kapatma (arka planda çalışmaya devam et)
    if (process.platform !== 'darwin' && !tray) {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopVisualizer();
});

// ============================================
// IPC HANDLERS
// ============================================

// Dosya/Klasör Seçimi
ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: tMainSync('dialog.filters.audioFiles'), extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'wma', 'opus', 'aiff'] },
            { name: tMainSync('dialog.filters.videoFiles'), extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v'] },
            { name: tMainSync('dialog.filters.allFiles'), extensions: ['*'] }
        ]
    });
    return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async (_event, opts) => {
    const title = (opts && typeof opts === 'object' && opts.title) ? String(opts.title) : tMainSync('dialog.selectMusicFolder');
    const defaultPath = (opts && typeof opts === 'object' && opts.defaultPath) ? String(opts.defaultPath) : undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title,
        defaultPath
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const folderPath = result.filePaths[0];
    const folderName = path.basename(folderPath);

    return {
        path: folderPath,
        name: folderName
    };
});

// Dosyaları seçme dialog'u (müzik/video gibi farklı filtreler için kullanılabilir)
// Geriye uyumluluk:
// - openFiles(filtersArray)
// - openFiles({ title, filters })
ipcMain.handle('dialog:openFiles', async (event, filtersOrOpts) => {
    const opts = (filtersOrOpts && typeof filtersOrOpts === 'object' && !Array.isArray(filtersOrOpts))
        ? filtersOrOpts
        : { filters: filtersOrOpts };

    const title = (opts && typeof opts.title === 'string' && opts.title.trim())
        ? opts.title.trim()
        : tMainSync('dialog.selectMusicFiles');

    const filters = opts?.filters;

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        title,
        filters: filters || [
            { name: tMainSync('dialog.filters.musicFiles'), extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'opus', 'ape', 'wv'] },
            { name: tMainSync('dialog.filters.allFiles'), extensions: ['*'] }
        ]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths.map(filePath => ({
        path: filePath,
        name: path.basename(filePath)
    }));
});

// ============================================================
// WEB GÜVENLİĞİ / GİZLİLİK
// ============================================================
ipcMain.handle('web:openExternal', async (_event, url) => {
    const u = String(url || '').trim();
    if (!u) return false;
    try {
        await shell.openExternal(u);
        return true;
    } catch (e) {
        console.error('[WEB] openExternal error:', e);
        return false;
    }
});

ipcMain.handle('web:clearData', async (_event, options) => {
    const opts = (options && typeof options === 'object') ? options : {};
    const ses = session.defaultSession;
    if (!ses) return false;

    const wantsAll = opts.all === true;
    const wantsCookies = wantsAll || opts.cookies === true;
    const wantsCache = wantsAll || opts.cache === true;
    const wantsStorage = wantsAll || opts.storage === true;

    try {
        if (wantsCache) {
            await ses.clearCache();
        }

        const storages = [];
        if (wantsCookies) storages.push('cookies');
        if (wantsStorage) {
            storages.push('localstorage', 'indexdb', 'cachestorage', 'serviceworkers');
        }

        if (storages.length) {
            await ses.clearStorageData({ storages });
        }

        return true;
    } catch (e) {
        console.error('[WEB] clearData error:', e);
        return false;
    }
});

// ============================================================
// İNDİRME (Python CLI ile Aurivo-Dawlod / yt-dlp)
// ============================================================
ipcMain.handle('download:start', async (_event, options) => {
    const url = String(options?.url || '').trim();
    if (!url) throw new Error('URL boş');

    const mode = options?.mode === 'audio' ? 'audio' : 'video';
    const outputDirRaw = String(options?.outputDir || '').trim();
    const outputDir = outputDirRaw || app.getPath('downloads');

    const scriptPath = getDownloaderCliPath();
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`Downloader script bulunamadı: ${scriptPath}`);
    }

    const args = [
        scriptPath,
        '--url', url,
        '--mode', mode,
        '--output', outputDir
    ];

    if (mode === 'video') {
        const hRaw = String(options?.videoHeight || 'auto').trim();
        if (hRaw && hRaw !== 'auto' && /^\d+$/.test(hRaw)) {
            args.push('--video-height', hRaw);
        }
        const vcodec = String(options?.videoCodec || '').trim();
        if (vcodec) args.push('--video-codec', vcodec);
    } else {
        const audioFormat = String(options?.audioFormat || 'mp3');
        const audioQuality = String(options?.audioQuality || '192');
        args.push('--audio-format', audioFormat, '--audio-quality', audioQuality);
        if (options?.normalizeAudio === true) {
            args.push('--normalize-audio');
        }
    }

    // Gelişmiş seçenekler (tüm modlar)
    const cookiesFromBrowser = String(options?.cookiesFromBrowser || '').trim();
    if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);

    const cookiesFile = String(options?.cookiesFile || '').trim();
    if (cookiesFile) args.push('--cookies', cookiesFile);

    const proxy = String(options?.proxy || '').trim();
    if (proxy) args.push('--proxy', proxy);

    if (options?.useConfig === true) {
        const configFile = String(options?.configFile || '').trim();
        if (configFile) args.push('--config', configFile);
    }

    if (options?.showMoreFormats === true) {
        const formatOverride = String(options?.formatOverride || '').trim();
        if (formatOverride) args.push('--format-override', formatOverride);
    }

    if (options?.playlist === true) {
        args.push('--playlist');
        const pf = String(options?.playlistFilenameFormat || '').trim();
        const pd = String(options?.playlistFoldernameFormat || '').trim();
        if (pf) args.push('--playlist-filename-format', pf);
        if (pd) args.push('--playlist-foldername-format', pd);
    }

    const customArgs = String(options?.customArgs || '').trim();
    if (customArgs) args.push('--custom-args', customArgs);

    const id = ++downloadSeq;
    const send = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(channel, payload);
    };

    const proc = await spawnPythonWithFallback(args, { cwd: app.isPackaged ? process.resourcesPath : __dirname });
    const tail = [];
    const tailMax = 40;
    activeDownloads.set(id, { proc, killTimer: null, tail });

    let lastPercent = -1;
    const percentRegex = /\[download\]\s+(\d+(?:\.\d+)?)%/i;

    const handleLine = (line) => {
        const s = String(line || '').trimEnd();
        if (!s) return;

        try {
            tail.push(s);
            if (tail.length > tailMax) tail.splice(0, tail.length - tailMax);
        } catch { }

        send('download:log', { id, line: s });

        const m = percentRegex.exec(s);
        if (m) {
            const val = Math.max(0, Math.min(100, Math.floor(Number(m[1]))));
            if (Number.isFinite(val) && val !== lastPercent) {
                lastPercent = val;
                send('download:progress', { id, percent: val });
            }
        }
    };

    const attachStream = (stream) => {
        if (!stream) return;
        let buf = '';
        stream.on('data', (chunk) => {
            buf += chunk.toString();
            const parts = buf.split(/\r?\n/);
            buf = parts.pop() || '';
            for (const p of parts) handleLine(p);
        });
        stream.on('end', () => {
            if (buf) handleLine(buf);
            buf = '';
        });
    };

    attachStream(proc.stdout);
    attachStream(proc.stderr);

    proc.on('close', (code) => {
        const entry = activeDownloads.get(id);
        if (entry?.killTimer) clearTimeout(entry.killTimer);
        activeDownloads.delete(id);
        const success = code === 0;
        const lastLine = Array.isArray(entry?.tail) && entry.tail.length ? entry.tail[entry.tail.length - 1] : '';
        send('download:done', { id, success, code, message: lastLine || '', tail: entry?.tail || [] });
    });

    return { id };
});

ipcMain.handle('download:cancel', async (_event, id) => {
    const entry = activeDownloads.get(Number(id));
    if (!entry?.proc) return false;

    try {
        if (entry.proc.killed) return true;
        entry.proc.kill('SIGTERM');
        entry.killTimer = setTimeout(() => {
            try {
                if (!entry.proc.killed) entry.proc.kill('SIGKILL');
            } catch { }
        }, 2000);
        return true;
    } catch (e) {
        console.error('[DOWNLOAD] cancel error:', e);
        return false;
    }
});

// Dizin Okuma
ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    try {
        if (!dirPath || typeof dirPath !== 'string') return [];

        // Windows testleri için: kütüphane/kırpma filtreleri bu uzantılara göre çalışıyor.
        // Not: Bu liste "noktasız" (mp3) tutulur, kontrol `toLowerCase()` ile yapılır.
        const SUPPORTED_MEDIA_EXTENSIONS = new Set([
            'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'aiff', 'opus', 'ape', 'wv',
            'mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg'
        ]);

        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const results = await Promise.all(items.map(async (item) => {
            const fullPath = path.join(dirPath, item.name);
            const ext = path.extname(item.name || '').slice(1).toLowerCase();
            const isSupportedMedia = !!ext && SUPPORTED_MEDIA_EXTENSIONS.has(ext);

            let isDirectory = item.isDirectory();
            let isFile = item.isFile();

            // Bazı dosya sistemlerinde d_type "unknown" gelebilir (FUSE/NFS vb.).
            // Bu durumda stat() ile gerçek türü belirle.
            if (item.isSymbolicLink?.() || (!isDirectory && !isFile)) {
                try {
                    const st = await fs.promises.stat(fullPath);
                    isDirectory = st.isDirectory();
                    isFile = st.isFile();
                } catch {
                    // yoksay
                }
            }

            // Ek yedek: tür belirlenemediyse ama desteklenen uzantıysa dosya kabul et
            if (!isDirectory && !isFile && isSupportedMedia) {
                isFile = true;
            }

            return {
                name: item.name,
                path: fullPath,
                isDirectory,
                isFile,
                ext,
                isSupportedMedia
            };
        }));

        return results;
    } catch (error) {
        console.error('Directory read error:', error);
        return [];
    }
});

// Özel Klasörler (Linux için Türkçe klasör isimleri de desteklenir)
ipcMain.handle('fs:getSpecialPaths', async () => {
    const home = os.homedir();

    // Olası klasör isimleri
    const musicFolders = ['Music', 'Müzik', 'music'];
    const videoFolders = ['Videos', 'Videolar', 'Video', 'videos'];
    const downloadFolders = ['Downloads', 'İndirilenler', 'downloads'];

    // Var olan klasörü bul
    const findExisting = async (folders) => {
        for (const folder of folders) {
            const fullPath = path.join(home, folder);
            try {
                await fs.promises.access(fullPath);
                return fullPath;
            } catch { }
        }
        return path.join(home, folders[0]); // Bulunamazsa ilkini döndür
    };

    return {
        home: home,
        music: await findExisting(musicFolders),
        videos: await findExisting(videoFolders),
        downloads: await findExisting(downloadFolders),
        documents: path.join(home, 'Documents')
    };
});

// Dosya Varlık Kontrolü
ipcMain.handle('fs:exists', async (event, filePath) => {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
});

// Dosya Bilgisi
ipcMain.handle('fs:getFileInfo', async (event, filePath) => {
    try {
        const stats = await fs.promises.stat(filePath);
        return {
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
        };
    } catch (error) {
        return null;
    }
});

ipcMain.handle('settings:save', async (event, settings) => {
    try {
        const incoming = (settings && typeof settings === 'object') ? settings : {};

        const deepMerge = (base, patch) => {
            const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
            for (const [k, v] of Object.entries(patch)) {
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    out[k] = deepMerge(out[k], v);
                } else {
                    out[k] = v;
                }
            }
            return out;
        };

        let existing = {};
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            existing = JSON.parse(data);
        } catch {
            existing = {};
        }

        // Merge to preserve keys written by other windows (e.g. sfx.eq32.lastPreset)
        const merged = deepMerge(existing, incoming);
        await writeJsonFileAtomic(getSettingsPath(), merged);
        return true;
    } catch (error) {
        console.error('Settings save error:', error);
        return false;
    }
});

ipcMain.handle('settings:load', async () => {
    const defaultSettings = {
        playback: {
            crossfadeStopEnabled: true,
            crossfadeManualEnabled: true,
            crossfadeAutoEnabled: false,
            sameAlbumNoCrossfade: true,
            crossfadeMs: 2000,
            fadeOnPauseResume: false,
            pauseFadeMs: 250
        },
        volume: 40,
        shuffle: false,
        repeat: false
    };

    // Eşzamanlı yazma anında (truncate/partial) parse hatası oluşursa kısa retry.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (attempt < 2) {
                await new Promise(r => setTimeout(r, 40));
                continue;
            }
            return defaultSettings;
        }
    }

    return defaultSettings;
});

// Playlist Kaydet/Yükle
const playlistPath = path.join(app.getPath('userData'), 'playlist.json');

ipcMain.handle('playlist:save', async (event, playlist) => {
    try {
        await fs.promises.writeFile(playlistPath, JSON.stringify(playlist, null, 2));
        return true;
    } catch (error) {
        console.error('Playlist save error:', error);
        return false;
    }
});

ipcMain.handle('playlist:load', async () => {
    try {
        const data = await fs.promises.readFile(playlistPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
});

// Sistem Tepsisi Durum Güncelleme (renderer'dan güncel oynatma durumu)
ipcMain.on('update-tray-state', (event, state) => {
    updateTrayMenu(state);
    if (tray && state.currentTrack) {
        tray.setToolTip(state.currentTrack);
    }
});

// MPRIS Metadata Güncelle (renderer'dan media bilgileri)
ipcMain.on('update-mpris-metadata', (event, metadata) => {
    updateMPRISMetadata(metadata);
});

// Albüm Kapağı Çıkarma (ID3 etiketi'lerinden)
ipcMain.handle('media:getAlbumArt', async (event, filePath) => {
    try {
        console.log('Albüm kapağı istendi:', filePath);

        // node-id3 kullan
        if (NodeID3) {
            const tags = NodeID3.read(filePath);

            if (tags && tags.image) {
                const img = tags.image;
                let imageBuffer;
                let mimeType = 'image/jpeg';

                if (img.imageBuffer) {
                    imageBuffer = img.imageBuffer;
                    mimeType = img.mime || 'image/jpeg';
                } else if (Buffer.isBuffer(img)) {
                    imageBuffer = img;
                }

                if (imageBuffer) {
                    const base64 = imageBuffer.toString('base64');
                    console.log('Kapak bulundu! Boyut:', base64.length, 'format:', mimeType);
                    return `data:${mimeType};base64,${base64}`;
                }
            }
            console.log('Bu dosyada kapak yok (node-id3)');
        } else {
            console.log('node-id3 yüklü değil, fallback kullanılıyor');
        }

        // Yedek - Manuel okuma veya ffmpeg
        return await extractEmbeddedCover(filePath);

    } catch (error) {
        console.log('Albüm kapağı çıkarılamadı:', error.message);
        return null;
    }
});

// Video küçük resmi çıkarma (ffmpeg ile 1 kare al)
ipcMain.handle('media:getVideoThumbnail', async (_event, filePath) => {
    try {
        const fp = String(filePath || '').trim();
        if (!fp) return null;
        try {
            await fs.promises.access(fp);
        } catch {
            return null;
        }
        return await extractVideoThumbnailWithFFmpeg(fp);
    } catch (e) {
        console.log('Video thumbnail çıkarılamadı:', e?.message || e);
        return null;
    }
});

function getFfmpegPathForEnv() {
    // Prod sürümde paketlenmiş ffmpeg'i kullan, geliştirmede sistem ffmpeg
    let ffmpegPath = 'ffmpeg';
    if (app.isPackaged) {
        if (process.platform === 'win32') {
            ffmpegPath = path.join(process.resourcesPath, 'bin', 'ffmpeg.exe');
        } else {
            ffmpegPath = path.join(process.resourcesPath, 'bin', 'ffmpeg');
        }
    }
    return ffmpegPath;
}

// Albüm kapağı çıkarma - ID3v2 veya ffmpeg kullan
async function extractEmbeddedCover(filePath) {
    try {
        const ext = path.extname(filePath).toLowerCase();

        // M4A/MP4 dosyaları için ffmpeg kullan
        if (ext === '.m4a' || ext === '.mp4' || ext === '.aac') {
            return await extractCoverWithFFmpeg(filePath);
        }

        // Diğer formatlar için manuel ID3 okuma
        return await extractID3Cover(filePath);

    } catch (error) {
        console.log('Cover extraction failed:', error.message);
        return null;
    }
}

// ffmpeg ile M4A/MP4 dosyalarından album art çıkar
async function extractCoverWithFFmpeg(filePath) {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');

        const ffmpegPath = getFfmpegPathForEnv();

        // Windows'ta ffmpeg yoksa yedek
        if (process.platform === 'win32' && app.isPackaged) {
            if (!fs.existsSync(ffmpegPath)) {
                console.log('ffmpeg.exe bundled değil, M4A album art çıkarılamayabilir');
                resolve(null);
                return;
            }
        }

        // Windows: ffmpeg klasörünü PATH'e ekle (dll/loader & codec uyumluluğu için)
        if (process.platform === 'win32') {
            try {
                prependToProcessPath(path.dirname(ffmpegPath));
            } catch {
                // yoksay
            }
        }

        // ffmpeg ile embedded image'ı pipe'la al
        const ffmpeg = spawn(ffmpegPath, [
            '-i', filePath,
            '-an',           // Ses akış yok say
            '-vcodec', 'copy', // Video codec'i copy et (attached_pic için)
            '-f', 'image2pipe', // Pipe formatı
            '-vframes', '1',   // Sadece 1 kare
            'pipe:1'          // stdout'a yaz
        ]);

        const chunks = [];

        ffmpeg.stdout.on('data', (chunk) => {
            chunks.push(chunk);
        });

        ffmpeg.stderr.on('data', (data) => {
            // ffmpeg stderr'ı ignore et (verbose olabilir)
        });

        ffmpeg.on('close', (code) => {
            if (code === 0 && chunks.length > 0) {
                const imageBuffer = Buffer.concat(chunks);
                if (imageBuffer.length > 100) { // En az 100 byte olmalı
                    const base64 = imageBuffer.toString('base64');
                    console.log('ffmpeg ile kapak bulundu! Boyut:', base64.length);
                    resolve(`data:image/jpeg;base64,${base64}`);
                    return;
                }
            }
            console.log('ffmpeg ile kapak bulunamadı');
            resolve(null);
        });

        ffmpeg.on('error', (err) => {
            console.log('ffmpeg error:', err.message);
            resolve(null);
        });
    });
}

// ffmpeg ile videodan küçük resim al (JPEG)
async function extractVideoThumbnailWithFFmpeg(filePath) {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');

        const ffmpegPath = getFfmpegPathForEnv();

        if (app.isPackaged && process.platform === 'win32' && !fs.existsSync(ffmpegPath)) {
            resolve(null);
            return;
        }

        if (process.platform === 'win32') {
            try {
                prependToProcessPath(path.dirname(ffmpegPath));
            } catch {
                // yoksay
            }
        }

        // 1. saniyeden 1 kare al (çok kısa videolarda yine de çalışır)
        const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-ss', '00:00:01',
            '-i', filePath,
            '-frames:v', '1',
            '-vf', 'scale=512:-1',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            'pipe:1'
        ]);

        const chunks = [];
        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => { /* yoksay */ });

        ffmpeg.on('close', (code) => {
            if (code === 0 && chunks.length) {
                const imageBuffer = Buffer.concat(chunks);
                if (imageBuffer.length > 1000) {
                    const base64 = imageBuffer.toString('base64');
                    resolve(`data:image/jpeg;base64,${base64}`);
                    return;
                }
            }
            resolve(null);
        });

        ffmpeg.on('error', () => resolve(null));
    });
}

// ID3v2 için manuel cover çıkarma
async function extractID3Cover(filePath) {
    try {
        const buffer = await fs.promises.readFile(filePath);

        // ID3v2 header kontrolü
        if (buffer.slice(0, 3).toString() !== 'ID3') {
            return null;
        }

        // APIC kare ara (albüm kapağı)
        const apicIndex = buffer.indexOf('APIC');
        if (apicIndex === -1) return null;

        // Frame boyutunu oku
        const frameSize = buffer.readUInt32BE(apicIndex + 4);
        if (frameSize <= 0 || frameSize > 5000000) return null; // Max 5MB

        // MIME type'ı atla ve resim verisini bul
        let dataStart = apicIndex + 10;

        // MIME type'ı oku (null-terminated)
        let mimeEnd = buffer.indexOf(0, dataStart);
        if (mimeEnd === -1 || mimeEnd > dataStart + 50) return null;

        const mimeType = buffer.slice(dataStart, mimeEnd).toString('ascii') || 'image/jpeg';
        dataStart = mimeEnd + 1;

        // Picture type (1 byte) atla
        dataStart += 1;

        // Description (null-terminated) atla
        const descEnd = buffer.indexOf(0, dataStart);
        if (descEnd === -1) return null;
        dataStart = descEnd + 1;

        // Resim verisini çıkar
        const imageData = buffer.slice(dataStart, apicIndex + 10 + frameSize);

        if (imageData.length > 0) {
            const base64 = imageData.toString('base64');
            return `data:${mimeType};base64,${base64}`;
        }

        return null;
    } catch (error) {
        return null;
    }
}

// ============================================
// C++ SES MOTORU IPC İŞLEYİCİLERİ
// ============================================

// Native ses motoru mevcut mu?
ipcMain.handle('audio:isNativeAvailable', () => {
    // Renderer preload genelde ilk açılışta bunu çağırır; burada lazy-init dene.
    try {
        if (!isNativeAudioAvailable) {
            initNativeAudioEngineSafe();
        }
    } catch (e) {
        // en iyi çaba
    }
    return isNativeAudioAvailable;
});

// Dosya yükle
ipcMain.handle('audio:loadFile', async (event, filePath) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        try { initNativeAudioEngineSafe(); } catch { }
    }
    if (!audioEngine || !isNativeAudioAvailable) {
        console.warn('[MAIN] Native audio yok, loadFile atlandı');
        return { success: false, error: 'Native audio yok' };
    }
    const ok = audioEngine.loadFile(filePath);
    console.log('[MAIN] loadFile:', ok ? 'ok' : 'fail', filePath);
    if (ok) {
        applyPersistedEq32SfxFromSettings().catch(() => { /* yoksay */ });
    }
    return ok ? { success: true } : { success: false, error: 'Dosya yüklenemedi' };
});

// Gerçek örtüşmeli crossfade
ipcMain.handle('audio:crossfadeTo', async (event, filePath, durationMs) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        return { success: false, error: 'Native audio yok' };
    }
    if (typeof audioEngine.crossfadeTo !== 'function') {
        return { success: false, error: 'Crossfade API yok' };
    }
    const ms = Math.max(0, Number(durationMs) || 0);
    const res = audioEngine.crossfadeTo(filePath, ms);
    const ok = (res === true) || (res && res.success);
    console.log('[MAIN] crossfadeTo:', ok ? 'ok' : 'fail', 'ms=', ms, filePath);
    if (ok) {
        applyPersistedEq32SfxFromSettings().catch(() => { /* yoksay */ });
    }
    return ok ? { success: true } : { success: false, error: (res && res.error) || 'Crossfade başarısız' };
});

// Oynat
ipcMain.handle('audio:play', () => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] play: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.play();
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] play error:', e);
        return { success: false, error: e.message };
    }
});

// Duraklat
ipcMain.handle('audio:pause', () => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] pause: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.pause();
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] pause error:', e);
        return { success: false, error: e.message };
    }
});

// Durdur
ipcMain.handle('audio:stop', () => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] stop: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.stop();
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] stop error:', e);
        return { success: false, error: e.message };
    }
});

// Pozisyon atla
ipcMain.handle('audio:seek', (event, positionMs) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] seek: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.seek(positionMs);
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] seek error:', e);
        return { success: false, error: e.message };
    }
});

// Pozisyon al
ipcMain.handle('audio:getPosition', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    try {
        return audioEngine.getPosition();
    } catch (e) {
        console.error('[AUDIO] getPosition error:', e);
        return 0;
    }
});

// Süre al
ipcMain.handle('audio:getDuration', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    try {
        return audioEngine.getDuration();
    } catch (e) {
        console.error('[AUDIO] getDuration error:', e);
        return 0;
    }
});

// Çalıyor mu?
ipcMain.handle('audio:isPlaying', () => {
    if (!audioEngine || !isNativeAudioAvailable) return false;
    try {
        return audioEngine.isPlaying();
    } catch (e) {
        console.error('[AUDIO] isPlaying error:', e);
        return false;
    }
});

// Ses seviyesi ayarla
ipcMain.handle('audio:setVolume', (event, volume) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] setVolume: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.setVolume(volume);
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] setVolume error:', e);
        return { success: false, error: e.message };
    }
});

// Ses fade (native motor): yoğun IPC spam yerine main'de ramp
let volumeFadeTimer = null;
let volumeFadeResolve = null;

ipcMain.handle('audio:fadeVolumeTo', async (event, targetVolume, durationMs) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return false;
        if (typeof audioEngine.getVolume !== 'function' || typeof audioEngine.setVolume !== 'function') return false;

        const target = Math.max(0, Math.min(1, Number(targetVolume)));
        const ms = Math.max(0, Number(durationMs) || 0);

        // Devam eden fade varsa iptal et
        if (volumeFadeTimer) {
            clearInterval(volumeFadeTimer);
            volumeFadeTimer = null;
        }
        if (typeof volumeFadeResolve === 'function') {
            try { volumeFadeResolve(false); } catch { }
            volumeFadeResolve = null;
        }

        const start = Math.max(0, Math.min(1, Number(audioEngine.getVolume()) || 0));
        if (ms === 0 || Math.abs(target - start) < 0.0005) {
            audioEngine.setVolume(target);
            return true;
        }

        const tickMs = 30;
        const steps = Math.max(1, Math.round(ms / tickMs));
        const delta = (target - start) / steps;
        let step = 0;

        return await new Promise((resolve) => {
            volumeFadeResolve = resolve;
            volumeFadeTimer = setInterval(() => {
                step++;
                const v = step >= steps ? target : (start + delta * step);
                audioEngine.setVolume(v);

                if (step >= steps) {
                    clearInterval(volumeFadeTimer);
                    volumeFadeTimer = null;
                    volumeFadeResolve = null;
                    resolve(true);
                }
            }, tickMs);
        });
    } catch (e) {
        console.error('[MAIN] audio:fadeVolumeTo error:', e);
        return false;
    }
});

// Ses seviyesini al
ipcMain.handle('audio:getVolume', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    try {
        return audioEngine.getVolume ? audioEngine.getVolume() : 1;
    } catch (e) {
        console.error('[AUDIO] getVolume error:', e);
        return 0;
    }
});

// EQ band ayarla
ipcMain.handle('audio:setEQBand', (event, band, gainDB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) {
            return { success: false, error: 'Native audio yok' };
        }
        audioEngine.setEQBand(band, gainDB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tüm EQ bantlarını ayarla
ipcMain.handle('audio:setEQBands', (event, gains) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setEQBands(gains);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Stereo genişliği
ipcMain.handle('audio:setStereoWidth', (event, width) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setStereoWidth(width);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Balance
ipcMain.handle('audio:setBalance', (event, balance) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) {
            return { success: false, error: 'Native audio yok' };
        }
        audioEngine.setBalance(balance);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// DSP aç/kapat
ipcMain.handle('audio:setDSPEnabled', (event, enabled) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setDSPEnabled(enabled);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// FFT verisi (visualizer için)
ipcMain.handle('audio:getFFTData', () => {
    if (!audioEngine || !isNativeAudioAvailable) return [];
    return audioEngine.getFFTData();
});

// Spektrum bantları (visualizer için)
ipcMain.handle('audio:getSpectrumBands', (event, numBands) => {
    if (!audioEngine || !isNativeAudioAvailable) return [];
    return audioEngine.getSpectrumBands(numBands || 64);
});

// Reverb parametreleri (destekleniyorsa)
ipcMain.handle('audio:setReverbParams', (event, roomSize, damping, wetDry) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setReverbParams === 'function') {
            audioEngine.setReverbParams(roomSize, damping, wetDry);
            return { success: true };
        }
        return { success: false, error: 'Reverb desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb aç/kapat
ipcMain.handle('audio:setReverbEnabled', (event, enabled) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setReverbEnabled === 'function') {
            audioEngine.setReverbEnabled(enabled);
            return { success: true };
        }
        return { success: false, error: 'Reverb desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('audio:enableReverb', (event, enabled) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setReverbEnabled === 'function') {
            audioEngine.setReverbEnabled(enabled);
            return { success: true };
        }
        return { success: false, error: 'Reverb desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tone (Bass/Mid/Treble)
ipcMain.handle('audio:setToneParams', (event, bass, mid, treble) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setToneParams === 'function') {
            audioEngine.setToneParams(bass, mid, treble);
            return { success: true };
        }
        return { success: false, error: 'Tone desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Bass ayarla (Aurivo Module)
ipcMain.handle('audio:setBass', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setBass(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Mid ayarla (Aurivo Module)
ipcMain.handle('audio:setMid', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setMid(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Treble ayarla (Aurivo Module)
ipcMain.handle('audio:setTreble', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setTreble(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Stereo Expander ayarla
ipcMain.handle('audio:setStereoExpander', (event, percent) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setStereoExpander(percent);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// AUTO GAIN / NORMALIZE IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:setAutoGainEnabled', (event, enabled) => {
    console.log('[MAIN] audio:setAutoGainEnabled called with:', enabled);
    try {
        if (!audioEngine || !isNativeAudioAvailable) {
            console.log('[MAIN] Native audio not available');
            return { success: false, error: 'Native audio yok' };
        }
        if (typeof audioEngine.setAutoGainEnabled === 'function') {
            audioEngine.setAutoGainEnabled(enabled);
            console.log('[MAIN] setAutoGainEnabled success');
            return { success: true };
        }
        console.log('[MAIN] setAutoGainEnabled function not found');
        return { success: true };
    } catch (error) {
        console.error('[MAIN] setAutoGainEnabled error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('audio:setAutoGainTarget', (event, target) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainTarget === 'function') {
        audioEngine.setAutoGainTarget(target);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainMaxGain', (event, maxGain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainMaxGain === 'function') {
        audioEngine.setAutoGainMaxGain(maxGain);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainAttack', (event, attack) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainAttack === 'function') {
        audioEngine.setAutoGainAttack(attack);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainRelease === 'function') {
        audioEngine.setAutoGainRelease(release);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainMode', (event, mode) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainMode === 'function') {
        audioEngine.setAutoGainMode(mode);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:updateAutoGain', () => {
    console.log('[MAIN] audio:updateAutoGain called');
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.updateAutoGain === 'function') {
        audioEngine.updateAutoGain();
        return { success: true };
    }
    console.log('[MAIN] updateAutoGain not available');
    return { success: false };
});

ipcMain.handle('audio:normalizeAudio', (event, targetDB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.normalizeAudio === 'function') {
        const gain = audioEngine.normalizeAudio(targetDB);
        return { success: true, gain };
    }
    return { success: false };
});

ipcMain.handle('audio:resetAutoGain', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetAutoGain === 'function') {
        audioEngine.resetAutoGain();
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:getAutoGainStats', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getAutoGainStats === 'function') {
        return audioEngine.getAutoGainStats();
    }
    return { enabled: false, peakLevel: -96, rmsLevel: -96, currentGain: 0 };
});

ipcMain.handle('audio:getPeakLevel', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getPeakLevel === 'function') {
        return audioEngine.getPeakLevel();
    }
    return -96;
});

ipcMain.handle('audio:getGainReduction', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getAutoGainReduction === 'function') {
        return audioEngine.getAutoGainReduction();
    }
    return 0;
});

// ============================================
// TRUE PEAK LIMITER + METER IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:setTruePeakEnabled', (event, enabled) => {
    console.log('[MAIN] audio:setTruePeakEnabled called with:', enabled);
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakEnabled === 'function') {
        audioEngine.setTruePeakEnabled(enabled);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakCeiling', (event, ceiling) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakCeiling === 'function') {
        audioEngine.setTruePeakCeiling(ceiling);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakRelease === 'function') {
        audioEngine.setTruePeakRelease(release);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakLookahead', (event, lookahead) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakLookahead === 'function') {
        audioEngine.setTruePeakLookahead(lookahead);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakOversampling', (event, rate) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakOversampling === 'function') {
        audioEngine.setTruePeakOversampling(rate);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakLinkChannels', (event, link) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakLinkChannels === 'function') {
        audioEngine.setTruePeakLinkChannels(link);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:getTruePeakMeter', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getTruePeakMeter === 'function') {
        return audioEngine.getTruePeakMeter();
    }
    return { peakL: -96, peakR: -96, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0 };
});

ipcMain.handle('audio:resetTruePeakClipping', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetTruePeakClipping === 'function') {
        audioEngine.resetTruePeakClipping();
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:resetTruePeakLimiter', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetTruePeakLimiter === 'function') {
        audioEngine.resetTruePeakLimiter();
        return { success: true };
    }
    return { success: false };
});

// EQ sıfırla
ipcMain.handle('audio:resetEQ', () => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return false;
        audioEngine.resetEQ();

        // Reset'i kalıcı olarak da kaydet
        updateEq32SettingsInFile({
            bands: new Array(32).fill(0),
            lastPreset: {
                filename: '__flat__',
                name: 'Düz (Flat)'
            }
        }).catch(() => { /* yoksay */ });

        return true;
    } catch (error) {
        return false;
    }
});

// Reverb Room Size
ipcMain.handle('audio:setReverbRoomSize', (event, ms) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbRoomSize(ms);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb Damping
ipcMain.handle('audio:setReverbDamping', (event, value) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbDamping(value);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb WetDry
ipcMain.handle('audio:setReverbWetDry', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbWetDry(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb HF Ratio
ipcMain.handle('audio:setReverbHFRatio', (event, ratio) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbHFRatio(ratio);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb Input Gain
ipcMain.handle('audio:setReverbInputGain', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbInputGain(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Preamp
ipcMain.handle('audio:setPreamp', (event, gainDB) => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    if (typeof audioEngine.setPreamp === 'function') {
        audioEngine.setPreamp(gainDB);
    }
});

// New Effects Handlers
ipcMain.handle('audio:setCompressor', (event, enabled, thresh, ratio, att, rel, makeup) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressor === 'function') {
        audioEngine.setCompressor(enabled, thresh, ratio, att, rel, makeup);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:enableCompressor', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableCompressor === 'function') {
        audioEngine.enableCompressor(enabled);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorThreshold', (event, threshold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorThreshold === 'function') {
        audioEngine.setCompressorThreshold(threshold);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorRatio', (event, ratio) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorRatio === 'function') {
        audioEngine.setCompressorRatio(ratio);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorAttack', (event, attack) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorAttack === 'function') {
        audioEngine.setCompressorAttack(attack);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorRelease === 'function') {
        audioEngine.setCompressorRelease(release);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorMakeupGain', (event, makeupGain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorMakeupGain === 'function') {
        audioEngine.setCompressorMakeupGain(makeupGain);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorKnee', (event, knee) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorKnee === 'function') {
        audioEngine.setCompressorKnee(knee);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:getCompressorGainReduction', () => {
    if (!audioEngine || !isNativeAudioAvailable || typeof audioEngine.getCompressorGainReduction !== 'function') {
        return 0;
    }
    return audioEngine.getCompressorGainReduction();
});

ipcMain.handle('audio:resetCompressor', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetCompressor === 'function') {
        audioEngine.resetCompressor();
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setGate', (event, enabled, thresh, att, rel) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setGate === 'function') {
        audioEngine.setGate(enabled, thresh, att, rel);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setLimiter', (event, enabled, ceiling, rel) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setLimiter === 'function') {
        audioEngine.setLimiter(enabled, ceiling, rel);
        return { success: true };
    }
    return { success: false };
});

// Limiter tekil kontrolleri
ipcMain.handle('audio:enableLimiter', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableLimiter === 'function') {
        return audioEngine.EnableLimiter(enabled);
    }
    return false;
});

ipcMain.handle('audio:setLimiterCeiling', (event, ceiling) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterCeiling === 'function') {
        audioEngine.SetLimiterCeiling(ceiling);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setLimiterRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterRelease === 'function') {
        audioEngine.SetLimiterRelease(release);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setLimiterLookahead', (event, lookahead) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterLookahead === 'function') {
        audioEngine.SetLimiterLookahead(lookahead);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setLimiterGain', (event, gain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterGain === 'function') {
        audioEngine.SetLimiterGain(gain);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getLimiterReduction', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetLimiterReduction === 'function') {
        return audioEngine.GetLimiterReduction();
    }
    return 0;
});

ipcMain.handle('audio:resetLimiter', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetLimiter === 'function') {
        audioEngine.ResetLimiter();
        return true;
    }
    return false;
});

// Bass Enhancer tekil kontrolleri
ipcMain.handle('audio:enableBassEnhancer', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableBassEnhancer === 'function') {
        return audioEngine.EnableBassEnhancer(enabled);
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerFrequency', (event, frequency) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerFrequency === 'function') {
        audioEngine.SetBassEnhancerFrequency(frequency);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerGain', (event, gain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerGain === 'function') {
        audioEngine.SetBassEnhancerGain(gain);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerHarmonics', (event, harmonics) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerHarmonics === 'function') {
        audioEngine.SetBassEnhancerHarmonics(harmonics);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerWidth', (event, width) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerWidth === 'function') {
        audioEngine.SetBassEnhancerWidth(width);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerMix', (event, mix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerMix === 'function') {
        audioEngine.SetBassEnhancerMix(mix);
        return true;
    }
    return false;
});

ipcMain.handle('audio:resetBassEnhancer', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetBassEnhancer === 'function') {
        audioEngine.ResetBassEnhancer();
        return true;
    }
    return false;
});

// Noise Gate tekil kontrolleri
ipcMain.handle('audio:enableNoiseGate', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableNoiseGate === 'function') {
        return audioEngine.EnableNoiseGate(enabled);
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateThreshold', (event, threshold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateThreshold === 'function') {
        audioEngine.SetNoiseGateThreshold(threshold);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateAttack', (event, attack) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateAttack === 'function') {
        audioEngine.SetNoiseGateAttack(attack);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateHold', (event, hold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateHold === 'function') {
        audioEngine.SetNoiseGateHold(hold);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateRelease === 'function') {
        audioEngine.SetNoiseGateRelease(release);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateRange', (event, range) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateRange === 'function') {
        audioEngine.SetNoiseGateRange(range);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getNoiseGateStatus', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetNoiseGateStatus === 'function') {
        return audioEngine.GetNoiseGateStatus();
    }
    return false;
});

ipcMain.handle('audio:resetNoiseGate', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetNoiseGate === 'function') {
        audioEngine.ResetNoiseGate();
        return true;
    }
    return false;
});

// ============== DE-ESSER IPC HANDLERS ==============
ipcMain.handle('audio:enableDeEsser', (event, enable) => {
    console.log('[MAIN] audio:enableDeEsser called with:', enable);
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableDeEsser === 'function') {
        console.log('[MAIN] Calling audioEngine.EnableDeEsser');
        audioEngine.EnableDeEsser(enable);
        return true;
    }
    console.log('[MAIN] audioEngine.EnableDeEsser not available');
    return false;
});

ipcMain.handle('audio:setDeEsserFrequency', (event, frequency) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserFrequency === 'function') {
        audioEngine.SetDeEsserFrequency(frequency);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserThreshold', (event, threshold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserThreshold === 'function') {
        audioEngine.SetDeEsserThreshold(threshold);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserRatio', (event, ratio) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserRatio === 'function') {
        audioEngine.SetDeEsserRatio(ratio);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserRange', (event, range) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserRange === 'function') {
        audioEngine.SetDeEsserRange(range);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserListenMode', (event, listen) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserListenMode === 'function') {
        audioEngine.SetDeEsserListenMode(listen);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getDeEsserActivity', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetDeEsserActivity === 'function') {
        return audioEngine.GetDeEsserActivity();
    }
    return 0;
});

ipcMain.handle('audio:resetDeEsser', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetDeEsser === 'function') {
        audioEngine.ResetDeEsser();
        return true;
    }
    return false;
});

// ============== EXCITER IPC HANDLERS ==============
ipcMain.handle('audio:enableExciter', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableExciter === 'function') {
        audioEngine.EnableExciter(enable);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterAmount', (event, amount) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterAmount === 'function') {
        audioEngine.SetExciterAmount(amount);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterFrequency', (event, frequency) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterFrequency === 'function') {
        audioEngine.SetExciterFrequency(frequency);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterHarmonics', (event, harmonics) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterHarmonics === 'function') {
        audioEngine.SetExciterHarmonics(harmonics);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterMix', (event, mix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterMix === 'function') {
        audioEngine.SetExciterMix(mix);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterType', (event, type) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterType === 'function') {
        audioEngine.SetExciterType(type);
        return true;
    }
    return false;
});

ipcMain.handle('audio:resetExciter', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetExciter === 'function') {
        audioEngine.ResetExciter();
        return true;
    }
    return false;
});

// ============================================
// STEREO WIDENER IPC İŞLEYİCİLERİ
// ============================================

ipcMain.handle('audio:enableStereoWidener', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableStereoWidener === 'function') {
        audioEngine.EnableStereoWidener(enabled);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoWidenerWidth', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoWidth === 'function') {
        audioEngine.SetStereoWidth(percent);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoBassCutoff', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoBassCutoff === 'function') {
        audioEngine.SetStereoBassCutoff(hz);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoDelay', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoDelay === 'function') {
        audioEngine.SetStereoDelay(ms);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoWidenerBalance', (event, value) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoBalance === 'function') {
        audioEngine.SetStereoBalance(value);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoMonoLow', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoMonoLow === 'function') {
        audioEngine.SetStereoMonoLow(enabled);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getStereoPhase', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetStereoPhase === 'function') {
        return audioEngine.GetStereoPhase();
    }
    return 0.0;
});

ipcMain.handle('audio:resetStereoWidener', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetStereoWidener === 'function') {
        audioEngine.ResetStereoWidener();
        return true;
    }
    return false;
});

// ============== ECHO EFFECT IPC HANDLERS ==============

ipcMain.handle('audio:enableEchoEffect', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableEchoEffect === 'function') {
        return audioEngine.EnableEchoEffect(enabled);
    }
    return false;
});

ipcMain.handle('audio:setEchoDelay', (event, delayMs) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoDelayTime === 'function') {
        return audioEngine.SetEchoDelayTime(delayMs);
    }
    return false;
});

ipcMain.handle('audio:setEchoFeedback', (event, feedback) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoFeedback === 'function') {
        return audioEngine.SetEchoFeedback(feedback);
    }
    return false;
});

ipcMain.handle('audio:setEchoWetMix', (event, wetMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoWetMix === 'function') {
        return audioEngine.SetEchoWetMix(wetMix);
    }
    return false;
});

ipcMain.handle('audio:setEchoDryMix', (event, dryMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoDryMix === 'function') {
        return audioEngine.SetEchoDryMix(dryMix);
    }
    return false;
});

ipcMain.handle('audio:setEchoStereoMode', (event, stereo) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoStereoMode === 'function') {
        return audioEngine.SetEchoStereoMode(stereo);
    }
    return false;
});

ipcMain.handle('audio:setEchoLowCut', (event, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoLowCut === 'function') {
        return audioEngine.SetEchoLowCut(freq);
    }
    return false;
});

ipcMain.handle('audio:setEchoHighCut', (event, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoHighCut === 'function') {
        return audioEngine.SetEchoHighCut(freq);
    }
    return false;
});

ipcMain.handle('audio:setEchoTempo', (event, bpm, division) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoTempo === 'function') {
        return audioEngine.SetEchoTempo(bpm, division);
    }
    return false;
});

ipcMain.handle('audio:resetEchoEffect', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetEchoEffect === 'function') {
        return audioEngine.ResetEchoEffect();
    }
    return false;
});

// ============== CONVOLUTION REVERB IPC İŞLEYİCİLERİ ==============

ipcMain.handle('audio:enableConvolutionReverb', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableConvolutionReverb === 'function') {
        return audioEngine.EnableConvolutionReverb(enabled);
    }
    return false;
});

ipcMain.handle('audio:loadIRFile', (event, filepath) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.LoadIRFile === 'function') {
        return audioEngine.LoadIRFile(filepath);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbRoomSize', (event, roomSize) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbRoomSize === 'function') {
        return audioEngine.SetConvReverbRoomSize(roomSize);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbDecay', (event, decay) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbDecay === 'function') {
        return audioEngine.SetConvReverbDecay(decay);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbDamping', (event, damping) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbDamping === 'function') {
        return audioEngine.SetConvReverbDamping(damping);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbWetMix', (event, wetMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbWetMix === 'function') {
        return audioEngine.SetConvReverbWetMix(wetMix);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbDryMix', (event, dryMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbDryMix === 'function') {
        return audioEngine.SetConvReverbDryMix(dryMix);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbPreDelay', (event, preDelay) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbPreDelay === 'function') {
        return audioEngine.SetConvReverbPreDelay(preDelay);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbRoomType', (event, roomType) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbRoomType === 'function') {
        return audioEngine.SetConvReverbRoomType(roomType);
    }
    return false;
});

ipcMain.handle('audio:getIRPresets', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetIRPresets === 'function') {
        return audioEngine.GetIRPresets();
    }
    return [];
});

ipcMain.handle('audio:resetConvolutionReverb', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetConvolutionReverb === 'function') {
        return audioEngine.ResetConvolutionReverb();
    }
    return false;
});

// ============================================
// CROSSFEED (Kulaklık İyileştirme)
// ============================================
ipcMain.handle('audio:enableCrossfeed', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.enableCrossfeed(enabled);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedLevel', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedLevel(percent);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedDelay', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedDelay(ms);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedLowCut', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedLowCut(hz);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedHighCut', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedHighCut(hz);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedPreset', (event, preset) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedPreset(preset);
    }
    return false;
});

ipcMain.handle('audio:getCrossfeedParams', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getCrossfeedParams === 'function') {
        return audioEngine.getCrossfeedParams();
    }
    return { enabled: false, level: 30, delay: 0.3, lowCut: 700, highCut: 4000, preset: 0 };
});

ipcMain.handle('audio:resetCrossfeed', (event) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.resetCrossfeed();
    }
    return false;
});

// ============================================
// BASS MONO (Düşük Frekansları Mono Birleştirme)
// ============================================
ipcMain.handle('audio:enableBassMono', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.EnableBassMono ? audioEngine.EnableBassMono(enabled) : false;
    }
    return false;
});

ipcMain.handle('audio:setBassMonoCutoff', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.SetBassMonoCutoff ? audioEngine.SetBassMonoCutoff(hz) : false;
    }
    return false;
});

ipcMain.handle('audio:setBassMonoSlope', (event, slope) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.SetBassMonoSlope ? audioEngine.SetBassMonoSlope(slope) : false;
    }
    return false;
});

ipcMain.handle('audio:setBassMonoStereoWidth', (event, width) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.SetBassMonoStereoWidth ? audioEngine.SetBassMonoStereoWidth(width) : false;
    }
    return false;
});

ipcMain.handle('audio:resetBassMono', (event) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.ResetBassMono ? audioEngine.ResetBassMono() : false;
    }
    return false;
});

// ============================================
// DYNAMIC EQ IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:enableDynamicEQ', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableDynamicEQ === 'function') {
        return audioEngine.enableDynamicEQ(enable);
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQFrequency', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQFrequency === 'function') {
        audioEngine.setDynamicEQFrequency(hz);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQGain', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQGain === 'function') {
        audioEngine.setDynamicEQGain(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQQ', (event, q) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQQ === 'function') {
        audioEngine.setDynamicEQQ(q);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQThreshold', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQThreshold === 'function') {
        audioEngine.setDynamicEQThreshold(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQAttack', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQAttack === 'function') {
        audioEngine.setDynamicEQAttack(ms);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQRelease', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQRelease === 'function') {
        audioEngine.setDynamicEQRelease(ms);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQRange', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQRange === 'function') {
        audioEngine.setDynamicEQRange(dB);
        return true;
    }
    return false;
});

// TAPE SATURATION IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:enableTapeSaturation', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableTapeSaturation === 'function') {
        return audioEngine.enableTapeSaturation(enable);
    }
    return false;
});

ipcMain.handle('audio:setTapeDrive', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeDrive === 'function') {
        audioEngine.setTapeDrive(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeMix', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeMix === 'function') {
        audioEngine.setTapeMix(percent);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeTone', (event, value) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeTone === 'function') {
        audioEngine.setTapeTone(value);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeOutput', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeOutput === 'function') {
        audioEngine.setTapeOutput(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeMode', (event, mode) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeMode === 'function') {
        audioEngine.setTapeMode(mode);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeHiss', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeHiss === 'function') {
        audioEngine.setTapeHiss(percent);
        return true;
    }
    return false;
});

// BIT-DEPTH / DITHER IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:enableBitDepthDither', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableBitDepthDither === 'function') {
        return audioEngine.enableBitDepthDither(enable);
    }
    return false;
});

ipcMain.handle('audio:setBitDepth', (event, bits) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBitDepth === 'function') {
        audioEngine.setBitDepth(bits);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDitherType', (event, type) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDitherType === 'function') {
        audioEngine.setDitherType(type);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseShaping', (event, shape) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setNoiseShaping === 'function') {
        audioEngine.setNoiseShaping(shape);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDownsampleFactor', (event, factor) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDownsampleFactor === 'function') {
        audioEngine.setDownsampleFactor(factor);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBitDitherMix', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBitDitherMix === 'function') {
        audioEngine.setBitDitherMix(percent);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBitDitherOutput', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBitDitherOutput === 'function') {
        audioEngine.setBitDitherOutput(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:resetBitDepthDither', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetBitDepthDither === 'function') {
        return audioEngine.resetBitDepthDither();
    }
    return false;
});

ipcMain.handle('audio:setEcho', (event, enabled, delay, feedback, mix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setEcho === 'function') {
        audioEngine.setEcho(enabled, delay, feedback, mix);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setBassBoostDsp', (event, enabled, gain, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBassBoostDsp === 'function') {
        audioEngine.setBassBoostDsp(enabled, gain, freq);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setPEQ', (event, band, enabled, freq, gain, q) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setPEQ === 'function') {
        audioEngine.setPEQ(band, enabled, freq, gain, q);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setPEQFilterType', (event, band, filterType) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setPEQFilterType === 'function') {
        const result = audioEngine.setPEQFilterType(band, filterType);
        return { success: result };
    }
    return { success: false };
});

ipcMain.handle('audio:getPEQBand', (event, band) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getPEQBand === 'function') {
        const bandData = audioEngine.getPEQBand(band);
        return { success: true, data: bandData };
    }
    return { success: false, data: null };
});

ipcMain.handle('audio:setBassBoost', (event, value) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBassBoost === 'function') { // Legacy 0-100
        audioEngine.setBassBoost(value);
        return { success: true };
    }
    return { success: false };
});

// ============================================
// AUTOEQ PRESET IPC İŞLEYİCİLERİ
// ============================================

// Preset klasörü yolu (packaged/app.asar içinden okunur)
const presetsPath = getAppFilePath(path.join('resources', 'autoeq'));

function clampNumber(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(n, min), max);
}

function normalize32Bands(bands, minDb = -12, maxDb = 12) {
    const out = new Array(32).fill(0);
    if (!Array.isArray(bands)) return out;
    for (let i = 0; i < 32; i++) {
        out[i] = clampNumber(bands[i], minDb, maxDb);
    }
    return out;
}

function makeBandsFromPoints(points, minDb = -12, maxDb = 12) {
    const out = new Array(32).fill(0);
    if (!Array.isArray(points) || points.length === 0) return out;

    const sorted = points
        .filter(p => p && Number.isFinite(p.i) && Number.isFinite(p.v))
        .map(p => ({ i: clampNumber(Math.round(p.i), 0, 31), v: clampNumber(p.v, minDb, maxDb) }))
        .sort((a, b) => a.i - b.i);

    if (sorted.length === 0) return out;

    for (let i = 0; i <= sorted[0].i; i++) out[i] = sorted[0].v;

    for (let p = 0; p < sorted.length - 1; p++) {
        const a = sorted[p];
        const b = sorted[p + 1];
        const span = Math.max(1, b.i - a.i);
        for (let i = a.i; i <= b.i; i++) {
            const t = (i - a.i) / span;
            out[i] = a.v + (b.v - a.v) * t;
        }
    }

    for (let i = sorted[sorted.length - 1].i; i < 32; i++) out[i] = sorted[sorted.length - 1].v;
    return normalize32Bands(out, minDb, maxDb);
}

function loadAurivoEQBuiltins() {
    // JSON ile ayarlanabilir (ince ayar için)
    const filePath = getAppFilePath(path.join('resources', 'aurivo', 'eq_presets.json'));
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const minDb = Number.isFinite(parsed?.minDb) ? parsed.minDb : -12;
        const maxDb = Number.isFinite(parsed?.maxDb) ? parsed.maxDb : 12;
        const presets = Array.isArray(parsed?.presets) ? parsed.presets : [];

        const map = {};
        const list = [];
        for (const p of presets) {
            if (!p?.id || !p?.name) continue;
            const bands = Array.isArray(p.bands)
                ? normalize32Bands(p.bands, minDb, maxDb)
                : makeBandsFromPoints(p.points || [], minDb, maxDb);

            const entry = {
                name: String(p.name),
                description: p.description ? String(p.description) : '',
                category: 'Aurivo',
                preamp: Number.isFinite(p.preamp) ? p.preamp : 0,
                bands
            };

            map[String(p.id)] = entry;
            list.push({ filename: String(p.id), name: entry.name, description: entry.description, bands: entry.bands });
        }

        return { map, list };
    } catch (e) {
        console.warn('[Aurivo EQ] resources/aurivo/eq_presets.json okunamadı:', e?.message || e);
        return { map: {}, list: [] };
    }
}

const AURIVO_EQ_BUILTINS_LOADED = loadAurivoEQBuiltins();
const AURIVO_EQ_BUILTINS = AURIVO_EQ_BUILTINS_LOADED.map;
const AURIVO_EQ_FEATURED_LIST = [
    { filename: '__flat__', name: 'Düz (Flat)', description: 'Tüm bantlar 0.0 dB', bands: new Array(32).fill(0) },
    ...AURIVO_EQ_BUILTINS_LOADED.list
];

// Preset listesi önbelleği
let presetListCache = null;

function computeEq32GroupsFromData({ filename, name, description, preset }) {
    const hay = `${name || ''} ${filename || ''} ${description || ''}`.toLowerCase();
    const groups = new Set();

    // Keyword tabanlı (varsa direkt yakala)
    if (/(^|\s)(jazz)(\s|$)/.test(hay) || hay.includes('caz')) groups.add('jazz');
    if (/(^|\s)(classical|orchestra|orchestral)(\s|$)/.test(hay) || hay.includes('klasik')) groups.add('classical');
    if (/(^|\s)(electronic|edm|dance|club|techno|house|trance)(\s|$)/.test(hay) || hay.includes('elektronik')) groups.add('electronic');
    if (/(^|\s)(pop)(\s|$)/.test(hay)) groups.add('pop');
    if (/(^|\s)(rock|metal|guitar)(\s|$)/.test(hay)) groups.add('rock');
    if (/(v\s*-?\s*shape|vshape)/.test(hay)) groups.add('vshape');
    if (/(^|\s)(vocal|voice|speech)(\s|$)/.test(hay) || hay.includes('vokal')) groups.add('vocal');
    if (/(^|\s)(bass|sub\s*-?bass|low\s*end|xbass|bass[_\s-]?boost)(\s|$)/.test(hay)) groups.add('bass');
    if (/(^|\s)(treble|bright|sparkle|air|high\s*boost|treble[_\s-]?boost)(\s|$)/.test(hay) || hay.includes('tiz')) groups.add('treble');
    if (/(^|\s)(flat|neutral|reference|default|eq[_\s-]?off|off)(\s|$)/.test(hay) || /d\s*ü\s*z/.test(hay)) groups.add('flat');

    // Bant analizine dayalı otomatik gruplama (isimde ipucu yoksa bile çalışır)
    const bands = normalize32Bands(preset?.bands, -12, 12);
    const absMax = Math.max(...bands.map(v => Math.abs(v)));

    const avg = (start, end) => {
        let s = 0;
        let c = 0;
        for (let i = start; i <= end; i++) {
            s += bands[i] || 0;
            c++;
        }
        return c ? s / c : 0;
    };

    const lowAvg = avg(0, 9);   // ~20-160 Hz
    const midAvg = avg(10, 21); // ~200-4 kHz
    const highAvg = avg(22, 31); // ~5 kHz+

    if (absMax <= 0.6) {
        groups.add('flat');
    }

    // Bas / Tiz vurgusu
    if (lowAvg - midAvg >= 1.2 || lowAvg >= 1.0) groups.add('bass');
    if (highAvg - midAvg >= 1.2 || highAvg >= 1.0) groups.add('treble');

    // Vokal (mid/presence öne çıkıyorsa)
    if (midAvg - ((lowAvg + highAvg) / 2) >= 1.0 && midAvg >= 0.8) groups.add('vocal');

    // V-shape (bas+tiz, mid düşük)
    if (lowAvg >= 0.9 && highAvg >= 0.9 && midAvg <= -0.4) groups.add('vshape');

    if (groups.size === 0) groups.add('other');
    return Array.from(groups);
}

async function buildPresetListCacheIfNeeded() {
    if (presetListCache) return presetListCache;

    try {
        const files = await fs.promises.readdir(presetsPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const presetList = [];
        const batchSize = 40;
        for (let i = 0; i < jsonFiles.length; i += batchSize) {
            const batch = jsonFiles.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async (f) => {
                const filePath = path.join(presetsPath, f);
                const raw = await fs.promises.readFile(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                const name = (parsed?.name && String(parsed.name).trim())
                    ? String(parsed.name).trim()
                    : f.replace(/\.json$/i, '').replace(/_/g, ' ');
                const description = parsed?.description ? String(parsed.description) : '';
                const groups = computeEq32GroupsFromData({
                    filename: f,
                    name,
                    description,
                    preset: parsed
                });
                return { filename: f, name, groups };
            }));

            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) presetList.push(r.value);
            }
        }

        presetList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        presetListCache = presetList;
        const groupCounts = presetList.reduce((acc, p) => {
            const gs = Array.isArray(p.groups) ? p.groups : [];
            for (const g of gs) acc[g] = (acc[g] || 0) + 1;
            return acc;
        }, {});
        console.log(`AutoEQ: ${presetList.length} preset yüklendi (gruplu)`);
        console.log('[AutoEQ] Grup dağılımı:', groupCounts);
        return presetListCache;
    } catch (error) {
        console.error('Preset listesi okunamadı:', error);
        presetListCache = [];
        return presetListCache;
    }
}

// Tüm presetleri listele
ipcMain.handle('presets:loadList', async () => {
    return await buildPresetListCacheIfNeeded();
});

// Belirli bir preset'i yükle
ipcMain.handle('presets:load', async (event, filename) => {
    try {
        const filePath = path.join(presetsPath, filename);
        const data = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Preset yüklenemedi:', filename, error);
        return null;
    }
});

// Presetlerde ara
ipcMain.handle('presets:search', async (event, query) => {
    try {
        const list = await buildPresetListCacheIfNeeded();

        const q = String(query || '').toLowerCase();
        if (!q) return list;

        return list.filter(p => (p?.name || '').toLowerCase().includes(q));
    } catch (error) {
        console.error('Preset araması başarısız:', error);
        return [];
    }
});

// EQ preset seçimi (Hazır Ayarlar penceresinden)
ipcMain.handle('eqPresets:select', async (event, filename) => {
    try {
        let preset = null;

        if (filename === '__flat__') {
            preset = {
                name: 'Düz (Flat)',
                description: 'Tüm bantlar 0.0 dB',
                category: 'Aurivo',
                preamp: 0,
                bands: new Array(32).fill(0)
            };
        } else if (AURIVO_EQ_BUILTINS[filename]) {
            preset = AURIVO_EQ_BUILTINS[filename];
        } else {
            const filePath = path.join(presetsPath, filename);
            const data = await fs.promises.readFile(filePath, 'utf8');
            preset = JSON.parse(data);
        }

        const payload = {
            filename,
            preset
        };

        // Kalıcı olarak kaydet (tek kaynak: settings.json)
        const bands = normalizeEq32BandsForEngine(preset?.bands);
        const presetName = preset?.name || (filename === '__flat__' ? 'Düz (Flat)' : String(filename || ''));

        await updateEq32SettingsInFile({
            bands,
            lastPreset: {
                filename,
                name: presetName
            }
        });

        // Engine'e uygula (Ses Efektleri penceresi kapalı olsa bile geçerli olsun)
        if (audioEngine && isNativeAudioAvailable) {
            try {
                if (typeof audioEngine.setEQBands === 'function') {
                    audioEngine.setEQBands(bands);
                } else if (typeof audioEngine.setEQBand === 'function') {
                    bands.forEach((v, i) => audioEngine.setEQBand(i, v));
                }
            } catch {
                // en iyi çaba
            }
        }

        // Sound Effects penceresine gönder
        if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
            soundEffectsWindow.webContents.send('audio:eqPresetSelected', payload);
            soundEffectsWindow.focus();
        }

        // Ana pencereye de gönder (ileride gerekebilir)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('audio:eqPresetSelected', payload);
        }

        // Preset penceresini kapat
        if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
            eqPresetsWindow.close();
        }

        return { success: true };
    } catch (error) {
        console.error('EQ preset uygulanamadı:', filename, error);
        return { success: false, error: String(error?.message || error) };
    }
});

// Uygulama kapanırken temizlik
app.on('before-quit', () => {
    if (audioEngine) {
        audioEngine.cleanup();
    }
});
