const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
// ============================================
// WAYLAND / X11 OTOMATIK ALGILAMA
// ============================================
function detectDisplayServer() {
    // Linux dışı sistemlerde atlama
    if (process.platform !== 'linux') return;

    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    const xdgSessionType = process.env.XDG_SESSION_TYPE;
    const useNativeWayland = process.env.ELECTRON_OZONE_PLATFORM_HINT;

    // Kullanıcı manuel olarak ayarladıysa kullan
    const forceSoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
    const forceGpu = process.env.AURIVO_FORCE_GPU === '1' || process.env.AURIVO_FORCE_GPU === 'true';

    if (useNativeWayland === 'wayland') {
        console.log('💻 Display Server: Wayland (manuel)');
        app.commandLine.appendSwitch('ozone-platform', 'wayland');
        app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
        app.commandLine.appendSwitch('use-gl', 'egl-angle');
        if (!forceSoftware) {
            app.commandLine.appendSwitch('use-angle', 'opengl');
            app.commandLine.appendSwitch('ignore-gpu-blocklist');
        }
        app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WaylandWindowDecorations,VaapiVideoDecoder');
        if (forceSoftware) {
            app.commandLine.appendSwitch('disable-gpu');
            app.commandLine.appendSwitch('disable-gpu-compositing');
            app.commandLine.appendSwitch('use-gl', 'swiftshader');
            app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer');
        } else if (forceGpu) {
            app.commandLine.appendSwitch('use-angle', 'gl');
            app.commandLine.appendSwitch('ignore-gpu-blocklist');
        }
        process.env.ELECTRON_ENABLE_WAYLAND = '1';
        process.env.OZONE_PLATFORM = 'wayland';
        return;
    }

    if (useNativeWayland === 'x11') {
        console.log('💻 Display Server: X11 (manuel)');
        process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
        app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
        return;
    }

    let enableFeatures = 'VaapiVideoDecoder';

    // Wayland zorunlu (X11 tamamen devre dışı)
    console.log('💻 Display Server: Wayland (forced)');
    app.commandLine.appendSwitch('ozone-platform', 'wayland');
    app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
    app.commandLine.appendSwitch('use-gl', 'egl-angle');
    if (!forceSoftware) {
        app.commandLine.appendSwitch('use-angle', 'opengl');
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }
    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WaylandWindowDecorations,VaapiVideoDecoder');
    if (forceSoftware) {
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
        app.commandLine.appendSwitch('use-gl', 'swiftshader');
        app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer');
    } else if (forceGpu) {
        app.commandLine.appendSwitch('use-angle', 'gl');
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }
    process.env.ELECTRON_OZONE_PLATFORM_HINT = 'wayland';
    process.env.ELECTRON_ENABLE_WAYLAND = '1';
    process.env.OZONE_PLATFORM = 'wayland';
    if (!process.env.XDG_SESSION_TYPE) {
        process.env.XDG_SESSION_TYPE = 'wayland';
    }
    enableFeatures = 'UseOzonePlatform,WaylandWindowDecorations,VaapiVideoDecoder';

    // Genel GPU ayarları (performans için) - app hazır olduğunda uygula
    if (app && app.commandLine) {
        app.commandLine.appendSwitch('enable-gpu-rasterization');
        app.commandLine.appendSwitch('enable-zero-copy');
        
        // Font rendering iyileştirmeleri - Wayland/X11 uyumluluğu
        app.commandLine.appendSwitch('disable-font-subpixel-positioning');
        app.commandLine.appendSwitch('enable-font-antialiasing');
        app.commandLine.appendSwitch('force-device-scale-factor', '1');
        
        // Context menu düzeltmeleri
        app.commandLine.appendSwitch('disable-gpu-sandbox');
    }
}

// ============================================================
// GPU FAILSAFE (ALL PLATFORMS)
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

// Uygulama başlamadan önce display server'ı algıla
detectDisplayServer();
installGpuFailsafe();
// node-id3'yı yükle (ID3 tag okumak için)
let NodeID3 = null;
try {
    NodeID3 = require('node-id3');
    console.log('node-id3 başarıyla yüklendi');
} catch (e) {
    console.error('node-id3 yüklenemedi:', e.message);
}

// C++ Audio Engine yükle
let audioEngine = null;
let isNativeAudioAvailable = false;
try {
    const { audioEngine: engine, isNativeAvailable } = require('./audioEngine');
    audioEngine = engine;
    isNativeAudioAvailable = isNativeAvailable;

    if (isNativeAudioAvailable) {
        audioEngine.initialize();
        console.log('✓ C++ Aurivo Audio Engine aktif');
    }
} catch (e) {
    console.warn('C++ Audio Engine yüklenemedi:', e.message);
}

let mainWindow;

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        minWidth: 1200,
        minHeight: 720,
        backgroundColor: '#121212',
        icon: path.join(__dirname, '../icons/aurivo_256.png'),
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

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // İlk açılışta pencereyi zorla görünür yap
    mainWindow.show();
    mainWindow.center();
    mainWindow.focus();

    // Renderer loglarını terminale düşür (çapraz geçiş gibi UI-side debug için)
    mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
        // sourceId boş olabiliyor
        const src = sourceId ? String(sourceId).split('/').slice(-1)[0] : 'renderer';
        console.log(`[RENDERER] ${message} (${src}:${line})`);
    });

    // Pencere hazır olduğunda göster (flash önleme)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Wayland/GPU sorunlarında ready-to-show tetiklenmezse fallback
    mainWindow.webContents.once('did-finish-load', () => {
        if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
        }
        // Pencereyi öne getir
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(false);
            }
        }, 1500);
    });
    setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
        }
    }, 2000);

    // Eğer pencere hiç görünmezse yazılım render'a otomatik düş
    setTimeout(() => {
        const alreadySoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
        if (mainWindow && !mainWindow.isVisible() && !alreadySoftware) {
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

    mainWindow.on('closed', () => {
        mainWindow = null;
        // Ana pencere kapandığında ses efektleri penceresini de kapat
        if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
            soundEffectsWindow.close();
        }
    });
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
        icon: path.join(__dirname, 'icons/aurivo_256.png'),
        parent: null, // Bağımsız pencere (ana pencereden ayrı)
        modal: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        frame: false, // Özel başlık çubuğu için frameless
        title: 'Ses Efektleri — Aurivo Medya Player',
        show: false
    });

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
    // Pencere zaten açıksa, önne getir
    if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
        eqPresetsWindow.focus();
        return;
    }

    eqPresetsWindow = new BrowserWindow({
        width: 560,
        height: 720,
        minWidth: 520,
        minHeight: 640,
        backgroundColor: '#111115',
        icon: path.join(__dirname, 'icons/aurivo_256.png'),
        parent: soundEffectsWindow && !soundEffectsWindow.isDestroyed() ? soundEffectsWindow : (mainWindow || null),
        modal: true,
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

    eqPresetsWindow.loadFile(path.join(__dirname, 'eqPresets.html'));

    eqPresetsWindow.once('ready-to-show', () => {
        eqPresetsWindow.show();
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
ipcMain.handle('eqPresets:openWindow', () => {
    createEQPresetsWindow();
    return true;
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
// PROJECTM VISUALIZER (NATIVE EXECUTABLE)
// ============================================
let visualizerProc = null;
let visualizerFeedTimer = null;

function stopVisualizerFeed() {
    if (visualizerFeedTimer) {
        clearInterval(visualizerFeedTimer);
        visualizerFeedTimer = null;
    }
}

function startVisualizerFeed() {
    stopVisualizerFeed();
    if (!visualizerProc || !visualizerProc.stdin) return;
    if (!audioEngine || typeof audioEngine.getPCMData !== 'function') {
        console.warn('[Visualizer] PCM feed yok: audioEngine.getPCMData bulunamadı');
        return;
    }

    const requestedFramesPerChannel = 1024;

    visualizerFeedTimer = setInterval(() => {
        try {
            if (!visualizerProc || visualizerProc.killed || !visualizerProc.stdin || visualizerProc.stdin.destroyed) {
                stopVisualizerFeed();
                return;
            }

            // Native audio engine'den interleaved float PCM al
            const pcmRes = audioEngine.getPCMData(requestedFramesPerChannel);
            if (!pcmRes || !pcmRes.data || pcmRes.data.length === 0) return;

            let channels = Number(pcmRes.channels) || 0;
            if (channels <= 0) return;
            if (channels > 2) channels = 2;

            let floatArray = (pcmRes.data instanceof Float32Array) ? pcmRes.data : Float32Array.from(pcmRes.data);
            const countPerChannel = Math.floor(floatArray.length / channels);
            if (countPerChannel <= 0) return;
            const floatCount = countPerChannel * channels;
            if (floatCount !== floatArray.length) {
                floatArray = floatArray.subarray(0, floatCount);
            }

            // Protokol v2: [u32 channels][u32 countPerChannel][float32 * (channels*countPerChannel)]
            const header = Buffer.allocUnsafe(8);
            header.writeUInt32LE(channels, 0);
            header.writeUInt32LE(countPerChannel, 4);

            const payload = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatCount * 4);

            // Backpressure olursa frame atla.
            const ok1 = visualizerProc.stdin.write(header);
            const ok2 = visualizerProc.stdin.write(payload);
            if (!ok1 || !ok2) {
                // Drain beklemeyelim; bir sonraki tick'te tekrar deneriz.
            }
        } catch (e) {
            // best-effort
        }
    }, 33);
}

function isDevMode() {
    return process.env.AURIVO_DEV === '1' || process.argv.includes('--dev');
}

function getProjectMPresetsPath() {
    return path.join(__dirname, 'third_party', 'projectm', 'presets');
}

function getVisualizerExecutablePath() {
    const exeName = process.platform === 'win32'
        ? 'aurivo-projectm-visualizer.exe'
        : 'aurivo-projectm-visualizer';

    // Packaged/runtime default: native-dist (repo içine kopyalanmış binary)
    const distPath = path.join(__dirname, 'native-dist', exeName);

    // Dev convenience: prefer the freshly built CMake output if available.
    // This avoids "derlemede çalışıyor ama uygulamada çalışmıyor" issues caused by forgetting to copy to native-dist.
    const devCandidates = process.platform === 'win32'
        ? [
            path.join(__dirname, 'build-visualizer', 'Release', exeName),
            path.join(__dirname, 'build-visualizer', exeName)
          ]
        : [
            path.join(__dirname, 'build-visualizer', exeName)
          ];

    if (isDevMode()) {
        for (const p of devCandidates) {
            if (fs.existsSync(p)) return p;
        }
        return distPath;
    }

    // Non-dev: prefer native-dist, but allow fallback if it's missing.
    if (fs.existsSync(distPath)) return distPath;
    for (const p of devCandidates) {
        if (fs.existsSync(p)) {
            console.warn('[Visualizer] native-dist bulunamadı; build-visualizer çıktısına fallback:', p);
            return p;
        }
    }
    return distPath;
}

function startVisualizer() {
    if (visualizerProc && !visualizerProc.killed) return true;

    const exePath = getVisualizerExecutablePath();
    const presetsPath = getProjectMPresetsPath();

    if (!fs.existsSync(exePath)) {
        console.error('[Visualizer] executable bulunamadı:', exePath);
        dialog.showErrorBox(
            'Visualizer bulunamadı',
            `Çalıştırılabilir dosya bulunamadı:\n${exePath}\n\nLinux için:\n- cmake --build build-visualizer\n- cp build-visualizer/aurivo-projectm-visualizer native-dist/aurivo-projectm-visualizer\n\nGeliştirme modunda (npm run dev) build-visualizer çıktısı otomatik tercih edilir.`
        );
        return false;
    }

    const env = {
        ...process.env,
        PROJECTM_PRESETS_PATH: presetsPath,
        // SDL2 için gerekli display variables (Wayland öncelikli)
        DISPLAY: process.env.DISPLAY || '',
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || '',
        XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE || 'wayland',
        // Wayland native için
        SDL_VIDEODRIVER: process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11',
        // Mesa software rendering (debugging - remove for production)
        // LIBGL_ALWAYS_SOFTWARE: '1'
    };

    try {
        console.log('[Visualizer] starting:', exePath);
        console.log('[Visualizer] presets:', presetsPath);
        console.log('[Visualizer] DISPLAY:', env.DISPLAY);
        console.log('[Visualizer] SDL_VIDEODRIVER:', env.SDL_VIDEODRIVER);
        
        // Debug: strace ile çalıştır
        const useStrace = false; // Set to true for debugging
        const actualExe = useStrace ? 'strace' : exePath;
        const actualArgs = useStrace ? ['-o', '/tmp/visualizer-strace.log', '-ff', exePath, '--presets', presetsPath] : ['--presets', presetsPath];
        
        visualizerProc = spawn(actualExe, actualArgs, {
            env,
            stdio: ['pipe', 'inherit', 'inherit'], // Always inherit stdout/stderr for debugging
            detached: true // Run in separate process group to avoid Electron's GL context conflicts
        });
        
        // Unref so Electron doesn't wait for visualizer
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

        // stdin error handling (EPIPE prevention)
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
        // best-effort
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

    createWindow();

    // Kayıtlı EQ32 presetini açılışta uygula
    await applyPersistedEq32SfxFromSettings();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
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
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'wma', 'opus', 'aiff'] },
            { name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Müzik Klasörü Seç'
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

// Müzik dosyaları seçme dialog'u
ipcMain.handle('dialog:openFiles', async (event, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        title: 'Müzik Dosyaları Seç',
        filters: filters || [
            { name: 'Müzik Dosyaları', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'opus', 'ape', 'wv'] },
            { name: 'Tüm Dosyalar', extensions: ['*'] }
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

// Dizin Okuma
ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    try {
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return items.map(item => ({
            name: item.name,
            path: path.join(dirPath, item.name),
            isDirectory: item.isDirectory(),
            isFile: item.isFile()
        }));
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
        await fs.promises.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2));
        return true;
    } catch (error) {
        console.error('Settings save error:', error);
        return false;
    }
});

ipcMain.handle('settings:load', async () => {
    try {
        const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Varsayılan ayarlar
        return {
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
    }
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

// Albüm Kapağı Çıkarma (ID3 tag'lerinden)
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

        // Fallback - Manuel okuma veya ffmpeg
        return await extractEmbeddedCover(filePath);

    } catch (error) {
        console.log('Albüm kapağı çıkarılamadı:', error.message);
        return null;
    }
});

// Album art çıkarma - ID3v2 veya ffmpeg kullan
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
        
        // Production'da bundled ffmpeg'i kullan, development'da system ffmpeg
        let ffmpegPath = 'ffmpeg';
        if (app.isPackaged) {
            // Platform-specific ffmpeg binary path
            if (process.platform === 'win32') {
                ffmpegPath = path.join(process.resourcesPath, 'bin', 'ffmpeg.exe');
            } else {
                // Linux/Mac
                ffmpegPath = path.join(process.resourcesPath, 'bin', 'ffmpeg');
            }
        }
        
        // Windows'ta ffmpeg yoksa fallback
        if (process.platform === 'win32' && app.isPackaged) {
            if (!fs.existsSync(ffmpegPath)) {
                console.log('ffmpeg.exe bundled değil, M4A album art çıkarılamayabilir');
                resolve(null);
                return;
            }
        }
        
        // ffmpeg ile embedded image'ı pipe'la al
        const ffmpeg = spawn(ffmpegPath, [
            '-i', filePath,
            '-an',           // Audio stream yok say
            '-vcodec', 'copy', // Video codec'i copy et (attached_pic için)
            '-f', 'image2pipe', // Pipe formatı
            '-vframes', '1',   // Sadece 1 frame
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

// ID3v2 için manuel cover çıkarma
async function extractID3Cover(filePath) {
    try {
        const buffer = await fs.promises.readFile(filePath);

        // ID3v2 header kontrolü
        if (buffer.slice(0, 3).toString() !== 'ID3') {
            return null;
        }

        // APIC frame ara (albüm kapağı)
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
// C++ AUDIO ENGINE IPC HANDLERS
// ============================================

// Native audio engine mevcut mu?
ipcMain.handle('audio:isNativeAvailable', () => {
    return isNativeAudioAvailable;
});

// Dosya yükle
ipcMain.handle('audio:loadFile', async (event, filePath) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.warn('[MAIN] Native audio yok, loadFile atlandı');
        return { success: false, error: 'Native audio yok' };
    }
    const ok = audioEngine.loadFile(filePath);
    console.log('[MAIN] loadFile:', ok ? 'ok' : 'fail', filePath);
    if (ok) {
        applyPersistedEq32SfxFromSettings().catch(() => { /* ignore */ });
    }
    return ok ? { success: true } : { success: false, error: 'Dosya yüklenemedi' };
});

// True overlap crossfade
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
        applyPersistedEq32SfxFromSettings().catch(() => { /* ignore */ });
    }
    return ok ? { success: true } : { success: false, error: (res && res.error) || 'Crossfade başarısız' };
});

// Oynat
ipcMain.handle('audio:play', () => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    audioEngine.play();
});

// Duraklat
ipcMain.handle('audio:pause', () => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    audioEngine.pause();
});

// Durdur
ipcMain.handle('audio:stop', () => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    audioEngine.stop();
});

// Pozisyon atla
ipcMain.handle('audio:seek', (event, positionMs) => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    audioEngine.seek(positionMs);
});

// Pozisyon al
ipcMain.handle('audio:getPosition', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    return audioEngine.getPosition();
});

// Süre al
ipcMain.handle('audio:getDuration', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    return audioEngine.getDuration();
});

// Çalıyor mu?
ipcMain.handle('audio:isPlaying', () => {
    if (!audioEngine || !isNativeAudioAvailable) return false;
    return audioEngine.isPlaying();
});

// Ses seviyesi ayarla
ipcMain.handle('audio:setVolume', (event, volume) => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    audioEngine.setVolume(volume);
});

// Volume fade (native engine): yoğun IPC spam yerine main'de ramp
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
    return audioEngine.getVolume ? audioEngine.getVolume() : 1;
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
// AUTO GAIN / NORMALIZE IPC HANDLERS
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
// TRUE PEAK LIMITER + METER IPC HANDLERS
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

// Limiter individual controls
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

// Bass Enhancer individual controls
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

// Noise Gate individual controls
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
// STEREO WIDENER IPC HANDLERS
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

// ============== CONVOLUTION REVERB IPC HANDLERS ==============

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
// CROSSFEED (Headphone Enhancement)
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
// BASS MONO (Low Frequency Mono Summing)
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
// DYNAMIC EQ IPC HANDLERS
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

// TAPE SATURATION IPC HANDLERS
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

// BIT-DEPTH / DITHER IPC HANDLERS
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
// AUTOEQ PRESETS IPC HANDLERS
// ============================================

// Preset klasörü yolu
const presetsPath = path.join(__dirname, 'resources', 'autoeq');

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
    const filePath = path.join(__dirname, 'resources', 'aurivo', 'eq_presets.json');
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

// Preset listesi cache
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

// Uygulama kapanırken cleanup
app.on('before-quit', () => {
    if (audioEngine) {
        audioEngine.cleanup();
    }
});

