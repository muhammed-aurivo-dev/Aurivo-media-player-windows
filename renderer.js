// ============================================
// AURIVO MEDIA PLAYER - Renderer Process
// Qt MainWindow.cpp portlu JavaScript
// C++ BASS Audio Engine Entegrasyonu
// ============================================

// Debug: window.aurivo kontrolü
console.log('[RENDERER] Script başlıyor...');
console.log('[RENDERER] window.aurivo:', typeof window.aurivo);
if (window.aurivo) {
    console.log('[RENDERER] aurivo anahtarları:', Object.keys(window.aurivo));
} else {
    console.error('[RENDERER] ⚠ window.aurivo undefined!');
}

// C++ Native Audio Engine kullanılabilir mi?
let useNativeAudio = false;

// State
const state = {
    currentPage: 'files',
    currentPanel: 'library',
    playlist: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    isRepeat: false,
    volume: 40,
    isMuted: false,
    savedVolume: 40,
    currentPath: '',
    pathHistory: [],
    pathForward: [],
    settings: null,
    mediaFilter: 'audio', // 'audio' - sadece ses dosyaları
    activeMedia: 'none', // 'audio', 'video', 'web', 'none'
    currentCover: null,
    // Crossfade state
    crossfadeInProgress: false,
    autoCrossfadeTriggered: false,
    trackAboutToEnd: false,
    trackAboutToEndTriggered: false,
    activePlayer: 'A', // 'A' veya 'B'
    // Native audio state
    nativePositionTimer: null,
    nativePositionGeneration: 0
};

// Desteklenen ses formatları - BASS Audio Library destekli tüm formatlar
const AUDIO_EXTENSIONS = [
    // Yaygın formatlar
    'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'opus',
    // Yüksek kalite / Lossless
    'aiff', 'aif', 'alac', 'ape', 'wv', 'tta', 'tak',
    // Diğer formatlar
    'mka', 'mpc', 'shn', 'ac3', 'dts', 'dsf', 'dff',
    // Eski/Nadir formatlar
    'mid', 'midi', 'mod', 'xm', 'it', 's3m', 'mtm', 'umx',
    // Web formatları
    'webm', 'spx', 'caf'
];

// Video formatları (ileride kullanılabilir)
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg'];

// DOM Elements
const elements = {};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    
    // C++ Audio Engine kontrolü
    await checkNativeAudio();
    
    await loadSettings();
    await loadPlaylist();
    setupEventListeners();
    setupVisualizer();
    await initializeFileTree();
    initializeRainbowSliders();
    
    console.log('Aurivo Player başlatıldı');
    if (useNativeAudio) {
        console.log('🎵 C++ BASS Audio Engine aktif');
    } else {
        console.log('🎵 HTML5 Audio kullanılıyor');
    }
});

// C++ Audio Engine mevcut mu kontrol et ve başlat
async function checkNativeAudio() {
    try {
        if (window.aurivo && window.aurivo.audio) {
            const isAvailable = window.aurivo.audio.isNativeAvailable();
            console.log('Native Audio mevcut:', isAvailable);
            
            if (isAvailable) {
                // Audio Engine'i başlat
                const initResult = await window.aurivo.audio.init();
                console.log('Audio Engine init sonucu:', initResult);
                
                if (initResult && initResult.success) {
                    useNativeAudio = true;
                    console.log('✓ C++ Audio Engine başarıyla başlatıldı');
                    
                    // AGC'yi kapat - ses bozukluğunu önlemek için
                    if (window.aurivo.audio.autoGain) {
                        window.aurivo.audio.autoGain.setEnabled(false);
                        console.log('AGC devre dışı bırakıldı');
                    }
                } else {
                    useNativeAudio = false;
                    console.warn('C++ Audio Engine başlatılamadı:', initResult?.error);
                }
            } else {
                useNativeAudio = false;
            }
        }
    } catch (e) {
        console.error('Native audio kontrol hatası:', e);
        useNativeAudio = false;
    }
}

function cacheElements() {
    // Sidebar
    elements.sidebarBtns = document.querySelectorAll('.sidebar-btn[data-page]');
    elements.settingsBtn = document.getElementById('settingsBtn');
    elements.infoBtn = document.getElementById('infoBtn');
    
    // Panels
    elements.leftPanel = document.getElementById('leftPanel');
    elements.libraryPanel = document.getElementById('libraryPanel');
    elements.webPanel = document.getElementById('webPanel');
    
    // File Tree
    elements.fileTree = document.getElementById('fileTree');
    
    // Cover
    elements.coverArt = document.getElementById('coverArt');
    
    // Web Platforms
    elements.platformBtns = document.querySelectorAll('.platform-btn');
    
    // Navigation
    elements.backBtn = document.getElementById('backBtn');
    elements.forwardBtn = document.getElementById('forwardBtn');
    elements.refreshBtn = document.getElementById('refreshBtn');
    
    // Now Playing
    elements.nowPlayingLabel = document.getElementById('nowPlayingLabel');
    
    // Pages
    elements.musicPage = document.getElementById('musicPage');
    elements.videoPage = document.getElementById('videoPage');
    elements.webPage = document.getElementById('webPage');
    elements.pages = document.querySelectorAll('.page');
    
    // Playlist
    elements.playlist = document.getElementById('playlist');
    
    // Video & Web
    elements.videoPlayer = document.getElementById('videoPlayer');
    elements.webView = document.getElementById('webView');
    
    // Player Controls
    elements.seekSlider = document.getElementById('seekSlider');
    elements.currentTime = document.getElementById('currentTime');
    elements.durationTime = document.getElementById('durationTime');
    elements.playPauseBtn = document.getElementById('playPauseBtn');
    elements.playIcon = document.getElementById('playIcon');
    elements.pauseIcon = document.getElementById('pauseIcon');
    elements.prevBtn = document.getElementById('prevBtn');
    elements.nextBtn = document.getElementById('nextBtn');
    elements.shuffleBtn = document.getElementById('shuffleBtn');
    elements.repeatBtn = document.getElementById('repeatBtn');
    elements.rewindBtn = document.getElementById('rewindBtn');
    elements.forwardSeekBtn = document.getElementById('forwardSeekBtn');
    elements.volumeBtn = document.getElementById('volumeBtn');
    elements.volumeSlider = document.getElementById('volumeSlider');
    elements.volumeLabel = document.getElementById('volumeLabel');
    
    // Visualizer
    elements.visualizerCanvas = document.getElementById('visualizerCanvas');
    
    // Settings Modal
    elements.settingsModal = document.getElementById('settingsModal');
    elements.closeSettings = document.getElementById('closeSettings');
    elements.settingsTabs = document.querySelectorAll('.settings-tab');
    elements.settingsPages = document.querySelectorAll('.settings-page');
    elements.settingsOk = document.getElementById('settingsOk');
    elements.settingsApply = document.getElementById('settingsApply');
    elements.settingsCancel = document.getElementById('settingsCancel');
    elements.resetPlayback = document.getElementById('resetPlayback');
    
    // Audio Elements (İki adet - crossfade için)
    elements.audioA = new Audio();
    elements.audioA.preload = 'metadata';
    elements.audioB = new Audio();
    elements.audioB.preload = 'metadata';
    // Aktif player referansı
    elements.audio = elements.audioA;
}

// ============================================
// SETTINGS
// ============================================
async function loadSettings() {
    if (window.aurivo) {
        state.settings = await window.aurivo.loadSettings();
        state.volume = state.settings.volume || 40;
        state.isShuffle = state.settings.shuffle || false;
        state.isRepeat = state.settings.repeat || false;
        
        // UI'ı güncelle
        elements.volumeSlider.value = state.volume;
        elements.volumeLabel.textContent = state.volume + '%';
        elements.audio.volume = state.volume / 100;
        
        if (state.isShuffle) elements.shuffleBtn.classList.add('active');
        if (state.isRepeat) elements.repeatBtn.classList.add('active');
    }
}

async function saveSettings() {
    if (window.aurivo && state.settings) {
        state.settings.volume = state.volume;
        state.settings.shuffle = state.isShuffle;
        state.settings.repeat = state.isRepeat;
        await window.aurivo.saveSettings(state.settings);
    }
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    // Sidebar Navigation
    elements.sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => handleSidebarClick(btn));
    });
    
    elements.settingsBtn.addEventListener('click', openSettings);
    elements.infoBtn.addEventListener('click', showAbout);
    
    // Web Platforms
    elements.platformBtns.forEach(btn => {
        btn.addEventListener('click', () => handlePlatformClick(btn));
    });
    
    // FILE TREE - Event Delegation (ÖNEMLİ!)
    if (elements.fileTree) {
        elements.fileTree.addEventListener('click', handleFileTreeClick);
        elements.fileTree.addEventListener('dblclick', handleFileTreeDblClick);
        elements.fileTree.addEventListener('contextmenu', handleFileTreeContextMenu);
    }

    // Global fallback: click'leri yakala (DOM değişiminde kaybolmasın)
    document.addEventListener('click', handleFileTreeClickGlobal, true);
    document.addEventListener('dblclick', handleFileTreeDblClickGlobal, true);
    
    // Folder context menu dışına tıklanınca kapat
    document.addEventListener('click', () => {
        const menu = document.getElementById('folderContextMenu');
        if (menu) menu.classList.add('hidden');
    });
    
    // Navigation
    elements.backBtn.addEventListener('click', navigateBack);
    elements.forwardBtn.addEventListener('click', navigateForward);
    elements.refreshBtn.addEventListener('click', refreshCurrentView);
    
    // Player Controls
    elements.playPauseBtn.addEventListener('click', togglePlayPause);
    elements.prevBtn.addEventListener('click', () => playPreviousWithCrossfade());
    elements.nextBtn.addEventListener('click', () => playNextWithCrossfade());
    elements.shuffleBtn.addEventListener('click', toggleShuffle);
    elements.repeatBtn.addEventListener('click', toggleRepeat);
    elements.rewindBtn.addEventListener('click', () => seekBy(-10));
    elements.forwardSeekBtn.addEventListener('click', () => seekBy(10));

    // Visualizer (projectM)
    const visualizerBtn = document.getElementById('visualizer-btn');
    if (visualizerBtn) {
        visualizerBtn.addEventListener('click', () => {
            if (window.app && window.app.visualizer && typeof window.app.visualizer.toggle === 'function') {
                window.app.visualizer.toggle();
            } else {
                console.warn('Visualizer API yok (window.app.visualizer.toggle)');
            }
        });
    }
    
    // Volume
    elements.volumeBtn.addEventListener('click', toggleMute);
    elements.volumeSlider.addEventListener('input', handleVolumeChange);
    
    // Seek - tek tıkla pozisyon ayarlama
    elements.seekSlider.addEventListener('input', handleSeek);
    elements.seekSlider.addEventListener('click', handleSeekClick);
    
    // Volume slider - tek tıkla ayarlama
    elements.volumeSlider.addEventListener('click', handleVolumeClick);
    
    // Volume slider - tekerlek ile ayarlama (5 kademeli)
    elements.volumeSlider.addEventListener('wheel', handleVolumeWheel);
    
    // Audio Events - Her iki player için de event listener ekle
    setupAudioPlayerEvents(elements.audioA, 'A');
    setupAudioPlayerEvents(elements.audioB, 'B');
    
    // Settings Modal
    elements.closeSettings.addEventListener('click', closeSettings);
    elements.settingsCancel.addEventListener('click', closeSettings);
    elements.settingsOk.addEventListener('click', () => { applySettings(); closeSettings(); });
    elements.settingsApply.addEventListener('click', applySettings);
    
    elements.settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => switchSettingsTab(tab));
    });
    
    elements.resetPlayback.addEventListener('click', resetPlaybackDefaults);
    
    // Crossfade Auto checkbox dependency
    const crossfadeAuto = document.getElementById('crossfadeAuto');
    const sameAlbumNo = document.getElementById('sameAlbumNoCrossfade');
    crossfadeAuto.addEventListener('change', () => {
        sameAlbumNo.disabled = !crossfadeAuto.checked;
    });
    
    // Keyboard Shortcuts
    document.addEventListener('keydown', handleKeyboard);
    
    // Drag & Drop - geliştirilmiş
    setupDragAndDrop();
}

function setupDragAndDrop() {
    const dropZone = elements.playlist;
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // Highlight drop zone when item is dragged over
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        }, false);
    });
    
    // Handle dropped files - hem harici dosyalardan hem de file tree'den
    dropZone.addEventListener('drop', handleFileDrop, false);
}

// Tree item sürükleme başlangıcı
function handleTreeItemDragStart(e) {
    // Seçili tüm dosyaları al
    const selectedItems = document.querySelectorAll('.tree-item.file.selected');
    
    // Eğer sürüklenen öğe seçili değilse, sadece onu seç
    if (!e.target.closest('.tree-item').classList.contains('selected')) {
        document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
        e.target.closest('.tree-item').classList.add('selected');
    }
    
    // Seçili dosya yollarını JSON olarak aktar
    const filePaths = [];
    document.querySelectorAll('.tree-item.file.selected').forEach(item => {
        filePaths.push({
            path: item.dataset.path,
            name: item.dataset.name
        });
    });
    
    e.dataTransfer.setData('text/aurivo-files', JSON.stringify(filePaths));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Sürükleme görselini ayarla
    e.target.closest('.tree-item').classList.add('dragging');
}

// Tree item sürükleme bitişi
function handleTreeItemDragEnd(e) {
    e.target.closest('.tree-item').classList.remove('dragging');
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// ============================================
// AUDIO PLAYER EVENTS SETUP
// ============================================
function setupAudioPlayerEvents(player, playerId) {
    // Zaman güncelleme
    player.addEventListener('timeupdate', () => {
        // Native audio kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;
        
        // Sadece aktif player için güncelle
        if (getActiveAudioPlayer() === player) {
            updateTimeDisplay();
            // Otomatik crossfade kontrolü
            maybeStartAutoCrossfade();
        }
    });
    
    // Metadata yüklendiğinde
    player.addEventListener('loadedmetadata', () => {
        // Native audio kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;
        
        if (getActiveAudioPlayer() === player) {
            handleMetadataLoaded();
        }
    });
    
    // Parça bittiğinde
    player.addEventListener('ended', () => {
        // Native audio kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;
        
        if (getActiveAudioPlayer() === player) {
            handleTrackEnded();
        }
    });
    
    // Play/Pause durumu
    player.addEventListener('play', () => {
        // Native audio kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;
        
        if (getActiveAudioPlayer() === player) {
            updatePlayPauseIcon(true);
        }
    });
    
    player.addEventListener('pause', () => {
        // Native audio kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;
        
        if (getActiveAudioPlayer() === player) {
            updatePlayPauseIcon(false);
        }
    });
}

// Aktif audio player'ı getir
function getActiveAudioPlayer() {
    return state.activePlayer === 'A' ? elements.audioA : elements.audioB;
}

// Diğer audio player'ı getir
function getInactiveAudioPlayer() {
    return state.activePlayer === 'A' ? elements.audioB : elements.audioA;
}

// Player'ları değiştir
function switchActivePlayer() {
    state.activePlayer = state.activePlayer === 'A' ? 'B' : 'A';
    elements.audio = getActiveAudioPlayer();
}

// ============================================
// SIDEBAR & NAVIGATION
// ============================================
function handleSidebarClick(btn) {
    const page = btn.dataset.page;
    const panel = btn.dataset.panel;
    
    // Sidebar butonlarını güncelle
    elements.sidebarBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Media filtresini ayarla
    if (page === 'music' || page === 'files') {
        state.mediaFilter = 'audio';
    } else if (page === 'video') {
        state.mediaFilter = 'video';
    } else {
        state.mediaFilter = 'all';
    }
    
    // *** SEKMELERİ İZOLE ET - DİĞER MEDYALARI KAPAT ***
    isolateMediaSection(page);
    
    // Panel değiştir
    if (panel === 'library') {
        elements.libraryPanel.classList.remove('hidden');
        elements.webPanel.classList.add('hidden');
    } else if (panel === 'web') {
        elements.libraryPanel.classList.add('hidden');
        elements.webPanel.classList.remove('hidden');
    }
    
    // Sayfa değiştir
    switchPage(page);
    state.currentPage = page;
    state.currentPanel = panel;
    
    // Klasör içeriğini yeniden yükle (filtre uygulanacak)
    if (state.currentPath) {
        loadDirectory(state.currentPath, false);
    }
}

// Sekme izolasyonu - RAM tasarrufu için diğer medyaları tamamen kapat
function isolateMediaSection(targetPage) {
    // Müzik sekmesine geçiliyorsa
    if (targetPage === 'music' || targetPage === 'files') {
        // Video'yu tamamen kapat
        stopVideo();
        // Web'i tamamen kapat
        stopWeb();
        state.activeMedia = 'audio';
    }
    // Video sekmesine geçiliyorsa
    else if (targetPage === 'video') {
        // Müziği tamamen kapat
        stopAudio();
        // Web'i tamamen kapat
        stopWeb();
        state.activeMedia = 'video';
    }
    // Web sekmesine geçiliyorsa
    else if (targetPage === 'web') {
        // Müziği tamamen kapat
        stopAudio();
        // Video'yu tamamen kapat
        stopVideo();
        state.activeMedia = 'web';
    }
}

function stopAudio() {
    console.log('stopAudio çağrıldı, useNativeAudio:', useNativeAudio);
    
    // C++ Audio Engine durdur - HER ZAMAN dene (useNativeAudio değerine bakılmaksızın)
    if (window.aurivo && window.aurivo.audio) {
        console.log('C++ Audio Engine durduruluyor...');
        try {
            window.aurivo.audio.stop();
            console.log('C++ Audio Engine durduruldu');
        } catch (e) {
            console.error('C++ stop hatası:', e);
        }
    }
    stopNativePositionUpdates();
    
    // Her iki HTML5 player'ı da durdur
    if (elements.audioA) {
        elements.audioA.pause();
        elements.audioA.src = '';
        elements.audioA.load(); // Tamamen sıfırla
    }
    if (elements.audioB) {
        elements.audioB.pause();
        elements.audioB.src = '';
        elements.audioB.load(); // Tamamen sıfırla
    }
    
    // Crossfade state'lerini sıfırla
    state.crossfadeInProgress = false;
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;
    
    // Müzik için state'i sıfırla
    if (state.activeMedia === 'audio') {
        state.isPlaying = false;
        updatePlayPauseIcon(false);
    }
}

function stopVideo() {
    if (elements.videoPlayer) {
        elements.videoPlayer.pause();
        elements.videoPlayer.src = '';
        elements.videoPlayer.load();
    }
}

function stopWeb() {
    if (elements.webView) {
        // WebView'ı durdur (RAM temizliği)
        try {
            elements.webView.stop();
            // Sessiz sayfa - data URL kullan
            elements.webView.src = 'data:text/html,<html><body style="background:#121212"></body></html>';
        } catch (e) {
            // WebView henüz yüklenmemiş olabilir
        }
    }
    // Platform butonlarından active kaldır
    elements.platformBtns.forEach(b => b.classList.remove('active'));
}

function switchPage(pageName) {
    elements.pages.forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });
    
    let targetPage;
    switch(pageName) {
        case 'files':
        case 'music':
            targetPage = elements.musicPage;
            break;
        case 'video':
            targetPage = elements.videoPage;
            break;
        case 'web':
            targetPage = elements.webPage;
            break;
        default:
            targetPage = elements.musicPage;
    }
    
    targetPage.classList.remove('hidden');
    targetPage.classList.add('active');
}

function handlePlatformClick(btn) {
    const url = btn.dataset.url;
    const platform = btn.dataset.platform || 'web';
    
    // Önce diğer medyaları kapat (RAM tasarrufu)
    stopAudio();
    stopVideo();
    state.activeMedia = 'web';
    
    // Tüm platform butonlarından active kaldır
    elements.platformBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // WebView'a URL yükle
    if (elements.webView) {
        elements.webView.src = url;
    }
    
    // Web sayfasına geç
    switchPage('web');
    
    // Now playing güncelle
    const platformName = btn.querySelector('span').textContent;
    elements.nowPlayingLabel.textContent = 'Şu An Çalınan: ' + platformName;
    
    // Platform logosunu kapak olarak göster
    updatePlatformCover(platform);
}

// Platform logosunu kapak olarak ayarla
function updatePlatformCover(platform) {
    const platformCovers = {
        'youtube': 'icons/youtube_modern.svg',
        'spotify': 'icons/spotify.svg',
        'soundcloud': 'icons/soundcloud.svg',
        'deezer': 'icons/deezer.svg',
        'tidal': 'icons/nav_internet.svg',
        'mixcloud': 'icons/nav_internet.svg',
        'web': 'icons/nav_internet.svg'
    };
    
    const coverUrl = platformCovers[platform] || platformCovers['web'];
    
    if (elements.coverArt) {
        elements.coverArt.src = coverUrl;
        elements.coverArt.classList.add('default-cover');
    }
}

function navigateBack() {
    console.log('navigateBack çağrıldı, history:', state.pathHistory.length, 'current:', state.currentPath);
    if (state.pathHistory.length > 0) {
        state.pathForward.push(state.currentPath);
        const previousPath = state.pathHistory.pop();
        console.log('Geri gidiliyor:', previousPath);
        loadDirectory(previousPath, false);
    } else {
        console.log('History boş, geri gidilemiyor');
    }
}

function navigateForward() {
    console.log('navigateForward çağrıldı, forward:', state.pathForward.length);
    if (state.pathForward.length > 0) {
        state.pathHistory.push(state.currentPath);
        const nextPath = state.pathForward.pop();
        console.log('İleri gidiliyor:', nextPath);
        loadDirectory(nextPath, false);
    } else {
        console.log('Forward boş, ileri gidilemiyor');
    }
}

function refreshCurrentView() {
    if (state.currentPath) {
        loadDirectory(state.currentPath, false);
    }
}

// ============================================
// FILE TREE
// ============================================
async function initializeFileTree() {
    console.log('initializeFileTree başlatılıyor...');
    
    // fileTree elementini kontrol et
    if (!elements.fileTree) {
        elements.fileTree = document.getElementById('fileTree');
    }
    
    if (!elements.fileTree) {
        console.error('fileTree elementi bulunamadı!');
        return;
    }
    
    // Home dizinini belirle
    const home = '/home/muhammed-dali';
    
    // Başlangıç path'ini ayarla (history için önemli!)
    state.currentPath = home;
    state.pathHistory = [];
    state.pathForward = [];
    
    // Kullanıcının eklediği klasörleri yükle
    const savedFolders = loadSavedFolders();
    
    // Varsayılan klasörler (Videolar kaldırıldı)
    const defaultFolders = [
        { name: 'Müzik', path: home + '/Müzik', icon: '🎵' },
        { name: 'İndirilenler', path: home + '/İndirilenler', icon: '📥' }
    ];
    
    elements.fileTree.innerHTML = '';
    
    // "Dosya/Klasör Ekle" butonu
    const addFolderBtn = document.createElement('div');
    addFolderBtn.className = 'tree-item add-folder-btn';
    addFolderBtn.innerHTML = `
        <span class="tree-icon">➕</span>
        <span class="tree-name">Klasör Ekle</span>
    `;
    addFolderBtn.addEventListener('click', openFolderDialog);
    elements.fileTree.appendChild(addFolderBtn);
    
    // Ayırıcı çizgi
    const separator = document.createElement('div');
    separator.className = 'tree-separator';
    elements.fileTree.appendChild(separator);
    
    // Kullanıcının eklediği klasörler (varsa)
    savedFolders.forEach(folder => {
        const item = createTreeItem(folder.name, folder.path, true, '📌');
        // Sağ tık menüsü için işaretle
        item.classList.add('user-folder');
        item.dataset.userFolder = 'true';
        elements.fileTree.appendChild(item);
    });
    
    // Varsayılan klasörler
    defaultFolders.forEach(folder => {
        const item = createTreeItem(folder.name, folder.path, true, folder.icon);
        elements.fileTree.appendChild(item);
    });
    
    console.log('File Tree yüklendi -', defaultFolders.length + savedFolders.length, 'klasör');
}

// Kaydedilmiş klasörleri yükle
function loadSavedFolders() {
    try {
        const saved = localStorage.getItem('aurivo_user_folders');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('Klasörler yüklenemedi:', e);
        return [];
    }
}

// Klasörleri kaydet
function saveFolders(folders) {
    try {
        localStorage.setItem('aurivo_user_folders', JSON.stringify(folders));
    } catch (e) {
        console.error('Klasörler kaydedilemedi:', e);
    }
}

// Klasör ekleme dialog'u
async function openFolderDialog() {
    try {
        const result = await window.aurivo.dialog.openFolder();
        if (result && result.path) {
            addUserFolder(result.path, result.name);
        }
    } catch (e) {
        console.error('Klasör seçme hatası:', e);
    }
}

// Kullanıcı klasörü ekle
function addUserFolder(path, name) {
    const folders = loadSavedFolders();
    
    // Zaten ekli mi kontrol et
    if (folders.some(f => f.path === path)) {
        console.log('Bu klasör zaten ekli:', path);
        return;
    }
    
    folders.push({ name, path });
    saveFolders(folders);
    
    // File tree'yi yeniden yükle
    initializeFileTree();
    
    console.log('Klasör eklendi:', name, path);
}

// Kullanıcı klasörünü kaldır
function removeUserFolder(path) {
    let folders = loadSavedFolders();
    folders = folders.filter(f => f.path !== path);
    saveFolders(folders);
    
    // File tree'yi yeniden yükle
    initializeFileTree();
    
    console.log('Klasör kaldırıldı:', path);
}

// EVENT DELEGATION - File Tree Click Handler
function handleFileTreeClick(e) {
    const item = e.target.closest('.tree-item');
    if (!item) return;
    
    const path = item.dataset.path;
    const isDirectory = item.dataset.isDirectory === 'true' || item.classList.contains('folder');
    
    console.log('Tıklanan:', path, 'Klasör:', isDirectory);
    
    if (isDirectory) {
        loadDirectory(path);
    } else {
        // Dosya seçimi
        document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
    }
}

// EVENT DELEGATION - File Tree Double Click Handler
function handleFileTreeDblClick(e) {
    const item = e.target.closest('.tree-item');
    if (!item) return;
    
    const path = item.dataset.path;
    const isDirectory = item.dataset.isDirectory === 'true' || item.classList.contains('folder');
    const name = item.dataset.name || path.split('/').pop();
    
    if (isDirectory) {
        loadDirectory(path);
    } else {
        // Dosyayı çal
        const { index } = addToPlaylist(path, name);
        if (typeof index === 'number' && index >= 0) {
            playIndex(index);
        }
    }
}

// Global fallback handlers (capture phase)
function handleFileTreeClickGlobal(e) {
    if (!elements.fileTree || !elements.fileTree.contains(e.target)) return;
    handleFileTreeClick(e);
}

function handleFileTreeDblClickGlobal(e) {
    if (!elements.fileTree || !elements.fileTree.contains(e.target)) return;
    handleFileTreeDblClick(e);
}

// Kullanıcı klasörü sağ tık menüsü
function handleFileTreeContextMenu(e) {
    const item = e.target.closest('.tree-item.user-folder');
    if (!item) return;
    
    e.preventDefault();
    
    const path = item.dataset.path;
    const name = item.dataset.name;
    
    showFolderContextMenu(e.clientX, e.clientY, path, name);
}

function showFolderContextMenu(x, y, path, name) {
    // Varolan menüyü kaldır
    let menu = document.getElementById('folderContextMenu');
    if (menu) menu.remove();
    
    // Yeni menü oluştur
    menu = document.createElement('div');
    menu.id = 'folderContextMenu';
    menu.className = 'context-menu folder-context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="remove">
            <span class="context-menu-icon">🗑️</span>
            <span>Kütüphaneden Kaldır</span>
        </div>
        <div class="context-menu-item" data-action="open">
            <span class="context-menu-icon">📂</span>
            <span>Klasörü Aç</span>
        </div>
    `;
    
    document.body.appendChild(menu);
    
    // Pozisyon ayarla
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    // Menü öğelerine tıklama
    menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
        removeUserFolder(path);
        menu.remove();
    });
    
    menu.querySelector('[data-action="open"]').addEventListener('click', () => {
        loadDirectory(path);
        menu.remove();
    });
}

function createTreeItem(name, path, isDirectory, icon = null) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (isDirectory ? ' folder' : ' file');
    item.dataset.path = path;
    item.dataset.isDirectory = isDirectory;
    item.dataset.name = name;
    item.tabIndex = 0; // Klavye fokus için
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-icon';
    
    if (!icon) {
        if (isDirectory) {
            icon = '📁';
        } else {
            const ext = name.split('.').pop().toLowerCase();
            icon = VIDEO_EXTENSIONS.includes(ext) ? '🎬' : '🎵';
        }
    }
    iconSpan.textContent = icon;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-name';
    nameSpan.textContent = name;
    
    item.appendChild(iconSpan);
    item.appendChild(nameSpan);
    
    // Tek tıklama - seçim (CTRL ile çoklu seçim)
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        handleTreeItemClick(item, path, isDirectory, e);
    });
    
    // Çift tıklama - aç/çal
    item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        handleTreeItemDoubleClick(path, isDirectory, name);
    });
    
    // Klavye işlemleri - tree item üzerinde
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSelectedFilesToPlaylist();
        }
    });
    
    // Draggable yap (dosyalar için)
    if (!isDirectory) {
        item.draggable = true;
        item.addEventListener('dragstart', handleTreeItemDragStart);
        item.addEventListener('dragend', handleTreeItemDragEnd);
    }
    
    return item;
}

// Son tıklanan dosya öğesi (SHIFT seçimi için)
let lastClickedFileItem = null;

// Çoklu seçim ile tree item tıklama
function handleTreeItemClick(item, path, isDirectory, e) {
    console.log('Tree item tıklandı:', path, 'Klasör:', isDirectory);
    
    // Klasörse sadece aç
    if (isDirectory) {
        console.log('Klasör açılıyor:', path);
        loadDirectory(path);
        return;
    }
    
    // SHIFT tuşu - aralık seçimi
    if (e && e.shiftKey && lastClickedFileItem && !isDirectory) {
        e.preventDefault();
        selectFileRange(lastClickedFileItem, item);
        return;
    }
    
    // CTRL tuşu basılıysa çoklu seçim (toggle)
    if (e && e.ctrlKey && !isDirectory) {
        item.classList.toggle('selected');
        if (item.classList.contains('selected')) {
            lastClickedFileItem = item;
        }
        return;
    }
    
    // Normal tıklama - sadece bu öğeyi seç
    document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    lastClickedFileItem = item;
}

// SHIFT+Click için aralık seçimi
function selectFileRange(startItem, endItem) {
    const allFiles = Array.from(document.querySelectorAll('.tree-item.file'));
    const startIndex = allFiles.indexOf(startItem);
    const endIndex = allFiles.indexOf(endItem);
    
    if (startIndex === -1 || endIndex === -1) return;
    
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);
    
    // Aralıktaki tüm dosyaları seç
    for (let i = minIndex; i <= maxIndex; i++) {
        allFiles[i].classList.add('selected');
    }
    
    console.log('SHIFT+Click: ' + (maxIndex - minIndex + 1) + ' dosya seçildi');
}

function handleTreeItemDoubleClick(path, isDirectory, name = null) {
    if (isDirectory) {
        loadDirectory(path);
    } else {
        // Dosyayı playlist'e ekle ve çal
        const fileName = name || path.split('/').pop();
        const { index } = addToPlaylist(path, fileName);
        if (typeof index === 'number' && index >= 0) {
            playIndex(index);
        }
    }
}

async function loadDirectory(dirPath, pushHistory = true) {
    if (!window.aurivo) {
        console.error('Aurivo API bulunamadı');
        return;
    }
    
    try {
        console.log('Klasör yükleniyor:', dirPath, 'pushHistory:', pushHistory);
        console.log('Önceki currentPath:', state.currentPath, 'History:', state.pathHistory.length);
        
        if (pushHistory && state.currentPath && state.currentPath !== dirPath) {
            state.pathHistory.push(state.currentPath);
            state.pathForward = [];
            console.log('History\'ye eklendi:', state.currentPath, 'Yeni history uzunluğu:', state.pathHistory.length);
        }
        state.currentPath = dirPath;
        console.log('Yeni currentPath:', state.currentPath);
        
        const items = await window.aurivo.readDirectory(dirPath);
        console.log('Okunan öğeler:', items.length);
        
        elements.fileTree.innerHTML = '';
        
        // Klasörler önce
        const folders = items
            .filter(i => i.isDirectory)
            .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        
        // Dosyaları filtrele - SADECE SES DOSYALARI
        let files = items.filter(i => i.isFile);
        
        // Sadece desteklenen ses dosyalarını göster
        files = files.filter(i => {
            const ext = i.name.split('.').pop().toLowerCase();
            return AUDIO_EXTENSIONS.includes(ext);
        });
        
        files.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        
        // Klasörleri ekle (gizli klasörleri atla)
        folders.forEach(item => {
            if (!item.name.startsWith('.')) {
                const treeItem = createTreeItem(item.name, item.path, true);
                elements.fileTree.appendChild(treeItem);
            }
        });
        
        // Dosyaları ekle (gizli dosyaları atla)
        files.forEach(item => {
            if (!item.name.startsWith('.')) {
                const treeItem = createTreeItem(item.name, item.path, false);
                elements.fileTree.appendChild(treeItem);
            }
        });
        
        console.log('Yüklendi:', folders.length, 'klasör,', files.length, 'dosya');
        
    } catch (error) {
        console.error('Klasör yükleme hatası:', error);
    }
}

function isMediaFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

function isVideoFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
}

function isAudioFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
}

// ============================================
// PLAYLIST
// ============================================
async function loadPlaylist() {
    if (window.aurivo) {
        state.playlist = await window.aurivo.loadPlaylist();
        renderPlaylist();
    }
}

async function savePlaylistToDisk() {
    if (window.aurivo) {
        await window.aurivo.savePlaylist(state.playlist);
    }
}

function renderPlaylist() {
    elements.playlist.innerHTML = '';
    
    if (state.playlist.length === 0) {
        elements.playlist.innerHTML = `
            <div class="playlist-empty">
                <div class="empty-icon">🎵</div>
                <div class="empty-text">Müzik veya video dosyalarını buraya sürükleyin</div>
                <div class="empty-hint">veya sol taraftaki klasörlerden seçin</div>
            </div>
        `;
        return;
    }
    
    state.playlist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        if (index === state.currentIndex) {
            div.classList.add('playing');
        }
        div.dataset.index = index;
        
        const icon = isVideoFile(item.name) ? '🎬' : '🎵';
        div.innerHTML = `
            <span class="item-index">${index + 1}</span>
            <span class="item-icon">${icon}</span>
            <span class="item-name">${item.name}</span>
            <button class="item-remove" data-index="${index}">✕</button>
        `;
        
        div.addEventListener('click', () => selectPlaylistItem(index));
        div.addEventListener('dblclick', () => {
            console.log('[PLAYLIST] Double-click on item', index, ':', item.name);
            playIndex(index);
        });
        
        // Kaldır butonu
        const removeBtn = div.querySelector('.item-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromPlaylist(index);
        });
        
        elements.playlist.appendChild(div);
    });
}

function selectPlaylistItem(index) {
    document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('selected'));
    const item = elements.playlist.children[index];
    if (item) item.classList.add('selected');
}

function addToPlaylist(filePath, fileName = null) {
    const name = fileName || filePath.split('/').pop();
    
    // Zaten listede var mı kontrol et
    const existingIndex = state.playlist.findIndex(item => item.path === filePath);
    if (existingIndex !== -1) {
        return { index: existingIndex, added: false };
    }

    state.playlist.push({ path: filePath, name: name });
    renderPlaylist();
    savePlaylistToDisk();
    return { index: state.playlist.length - 1, added: true };
}

function removeFromPlaylist(index) {
    state.playlist.splice(index, 1);
    
    // Çalan parça kaldırıldıysa
    if (index === state.currentIndex) {
        elements.audio.pause();
        state.currentIndex = -1;
        state.isPlaying = false;
        updatePlayPauseIcon(false);
    } else if (index < state.currentIndex) {
        state.currentIndex--;
    }
    
    renderPlaylist();
    savePlaylistToDisk();
}

function handleFileDrop(e) {
    e.preventDefault();
    let addedCount = 0;
    let firstPlayableIndex = null;
    
    // Önce Aurivo internal sürüklemesini kontrol et (file tree'den)
    const aurivoData = e.dataTransfer.getData('text/aurivo-files');
    if (aurivoData) {
        try {
            const files = JSON.parse(aurivoData);
            files.forEach(file => {
                if (isMediaFile(file.name)) {
                    const { index, added } = addToPlaylist(file.path, file.name);
                    if (typeof index === 'number') {
                        if (firstPlayableIndex === null) firstPlayableIndex = index;
                        if (added) addedCount++;
                    }
                }
            });
        } catch (err) {
            console.error('Aurivo dosya verisi işlenemedi:', err);
        }
    } else {
        // Harici dosya sürüklemesi (dosya yöneticisinden)
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (isMediaFile(file.name)) {
                const { index, added } = addToPlaylist(file.path, file.name);
                if (typeof index === 'number') {
                    if (firstPlayableIndex === null) firstPlayableIndex = index;
                    if (added) addedCount++;
                }
            }
        }
    }
    
    // İlk dosyayı çal (eğer hiçbir şey çalmıyorsa)
    if (state.currentIndex === -1 && typeof firstPlayableIndex === 'number' && firstPlayableIndex >= 0) {
        playIndex(firstPlayableIndex);
    }
    
    // Seçimleri temizle
    document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
    
    console.log(`${addedCount} dosya eklendi`);
}

// Seçili dosyaları playlist'e ekle (ENTER tuşu için)
function addSelectedFilesToPlaylist() {
    const selectedItems = document.querySelectorAll('.tree-item.file.selected');
    let addedCount = 0;
    let firstPlayableIndex = null;
    
    selectedItems.forEach(item => {
        const path = item.dataset.path;
        const name = item.dataset.name;
        if (path && name && isMediaFile(name)) {
            const { index, added } = addToPlaylist(path, name);
            if (typeof index === 'number') {
                if (firstPlayableIndex === null) firstPlayableIndex = index;
                if (added) addedCount++;
            }
        }
    });
    
    // İlk dosyayı çal (eğer hiçbir şey çalmıyorsa)
    if (state.currentIndex === -1 && typeof firstPlayableIndex === 'number' && firstPlayableIndex >= 0) {
        playIndex(firstPlayableIndex);
    }
    
    console.log(`ENTER: ${addedCount} dosya eklendi`);
}

// ============================================
// PLAYBACK
// ============================================
function playFile(filePath) {
    const index = state.playlist.findIndex(item => item.path === filePath);
    if (index !== -1) {
        playIndex(index);
    }
}

async function playIndex(index) {
    console.log('[PLAYINDEX] çağrıldı, index:', index, 'playlist length:', state.playlist.length);
    
    if (index < 0 || index >= state.playlist.length) {
        console.log('[PLAYINDEX] Geçersiz index, iptal ediliyor');
        return;
    }
    
    const item = state.playlist[index];
    console.log('[PLAYINDEX] Çalınacak dosya:', item.path);
    console.log('[PLAYINDEX] Current index before:', state.currentIndex, '-> after:', index);
    
    state.currentIndex = index;
    
    if (isVideoFile(item.name)) {
        // Önce diğer medyaları kapat
        stopAudio();
        stopWeb();
        
        // Video oynat
        state.activeMedia = 'video';
        switchPage('video');
        elements.videoPlayer.src = 'file://' + item.path;
        elements.videoPlayer.play();
        
        // Video thumbnail'i göster (varsayılan video ikonu)
        updateCoverArt(null, 'video');
    } else {
        // Önce TÜM medyaları kapat (önceki şarkı dahil)
        console.log('Audio: Önce tüm medyalar durduruluyor...');
        stopAudio();
        stopVideo();
        stopWeb();
        console.log('Audio: Medyalar durduruldu, yeni şarkı yükleniyor...');
        
        // Audio oynat
        state.activeMedia = 'audio';
        if (state.currentPage === 'video' || state.currentPage === 'web') {
            switchPage('music');
        }
        
        // C++ Audio Engine veya HTML5 Audio kullan
        if (useNativeAudio) {
            console.log('C++ BASS Engine ile oynatılıyor...');
            // C++ BASS Engine ile oynat
            const result = await window.aurivo.audio.loadFile(item.path);
            console.log('loadFile sonucu:', result);
            console.log('loadFile sonucu type:', typeof result, 'success check:', result === true, 'object success:', result && result.success);
            if (result && result.error) {
                console.log('🔥 BASS Audio Engine hatası:', result.error);
            }
            if (result === true || (result && result.success)) {
                window.aurivo.audio.setVolume((state.volume || 0) / 100);
                console.log('🎵 window.aurivo.audio.play() çağrılıyor...');
                window.aurivo.audio.play();
                console.log('🎵 play() çağrıldı, ses çıkması gerekiyor');
                startNativePositionUpdates();
            } else {
                console.error('C++ Audio Engine dosya yükleyemedi', result);
                showNotification('Native audio ile dosya yüklenemedi. Efektler için native audio gerekli.', 'error');
                return;
            }
        } else {
            console.log('HTML5 Audio ile oynatılıyor...');
            // HTML5 Audio ile oynat
            playWithHTML5Audio(item);
        }
        
        // Albüm kapağını çıkar
        console.log('playIndex: extractAlbumArt çağrılıyor, path:', item.path);
        extractAlbumArt(item.path);
    }
    
    // Crossfade state'lerini sıfırla
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;
    state.trackAboutToEndTriggered = false;
    
    state.isPlaying = true;
    updatePlayPauseIcon(true);
    elements.nowPlayingLabel.textContent = 'Şu An Çalınan: ' + item.name;
    renderPlaylist();
}

// HTML5 Audio ile oynat (fallback)
function playWithHTML5Audio(item) {
    const activePlayer = getActiveAudioPlayer();
    const encodedPath = encodeURI('file://' + item.path).replace(/#/g, '%23');
    activePlayer.src = encodedPath;
    activePlayer.volume = state.volume / 100;
    activePlayer.play();
}

// Native engine ile "yumuşak/çapraz" geçiş (overlap yok: fade-out -> track switch -> fade-in)
async function startNativeTransitionToIndex(index, ms) {
    if (state.crossfadeInProgress) return;
    
    if (state.crossfadeInProgress) return;
    if (index < 0 || index >= state.playlist.length) return;
    if (!window.aurivo?.audio) {
        playIndex(index);
        return;
    }

    const fromIndex = state.currentIndex;
    const fromItem = fromIndex >= 0 ? state.playlist[fromIndex] : null;
    const toItem = state.playlist[index];

    state.crossfadeInProgress = true;
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;

    const totalMs = Math.max(0, Number(ms) || 0);
    const outMs = Math.max(80, Math.floor(totalMs * 0.5));
    const inMs = Math.max(80, totalMs - outMs);
    const targetVol = Math.max(0, Math.min(1, (state.volume || 0) / 100));

    // Native true overlap crossfade (iki parça üst üste)
    if (totalMs > 0 && typeof window.aurivo.audio.crossfadeTo === 'function') {
        state.crossfadeInProgress = true;
        state.autoCrossfadeTriggered = false;
        state.trackAboutToEnd = false;

        try {
            console.log('[CROSSFADE] Native overlap crossfade ->', toItem?.name, 'ms:', totalMs);

            // UI/medya state
            state.activeMedia = 'audio';
            if (state.currentPage === 'video' || state.currentPage === 'web') {
                switchPage('music');
            }

            // Crossfade'i başlat (native tarafında: prev fade-out, new fade-in)
            const result = await window.aurivo.audio.crossfadeTo(toItem.path, totalMs);
            const ok = (result === true) || (result && result.success);
            if (!ok) {
                console.warn('[CROSSFADE] Native overlap crossfade failed, fallback to non-overlap', result);
                throw new Error('native overlap crossfade failed');
            }

            // UI update: yeni parça ana parça gibi görünsün
            state.currentIndex = index;
            state.isPlaying = true;
            updatePlayPauseIcon(true);
            elements.nowPlayingLabel.textContent = 'Şu An Çalınan: ' + toItem.name;
            renderPlaylist();
            extractAlbumArt(toItem.path);

            if (state._nativeOverlapCrossfadeTimer) {
                clearTimeout(state._nativeOverlapCrossfadeTimer);
            }
            state._nativeOverlapCrossfadeTimer = setTimeout(() => {
                state.crossfadeInProgress = false;
            }, totalMs + 120);

            console.log('[CROSSFADE] Native overlap crossfade started');
            return;
        } catch (e) {
            console.error('[CROSSFADE] Native overlap crossfade error:', e);
            // fallback aşağıdaki non-overlap path'e devam etsin
            state.crossfadeInProgress = false;
        }
    }

    const recoverOldTrack = async () => {
        try {
            if (!fromItem?.path) {
                await window.aurivo.audio.setVolume?.(targetVol);
                await window.aurivo.audio.play?.();
                startNativePositionUpdates();
                state.isPlaying = true;
                updatePlayPauseIcon(true);
                return;
            }
            const res = await window.aurivo.audio.loadFile(fromItem.path);
            if (res === true || (res && res.success)) {
                await window.aurivo.audio.setVolume?.(0);
                await window.aurivo.audio.play?.();
                startNativePositionUpdates();
                state.isPlaying = true;
                updatePlayPauseIcon(true);
                if (typeof window.aurivo.audio.fadeVolumeTo === 'function' && totalMs > 0) {
                    await window.aurivo.audio.fadeVolumeTo(targetVol, Math.min(inMs, 300));
                } else {
                    await window.aurivo.audio.setVolume?.(targetVol);
                }
            }
        } catch (e) {
            console.error('[CROSSFADE] recoverOldTrack error:', e);
        }
    };

    try {
        console.log('[CROSSFADE] Native transition ->', toItem?.name, 'ms:', totalMs);

        // Fade out
        if (totalMs > 0 && typeof window.aurivo.audio.fadeVolumeTo === 'function') {
            await window.aurivo.audio.fadeVolumeTo(0, outMs);
        } else {
            await window.aurivo.audio.setVolume?.(0);
        }

        stopNativePositionUpdates();

        // Stop + kısa bekle (bazı sürücülerde/codec'lerde hemen load sorun çıkarabiliyor)
        try { await window.aurivo.audio.stop?.(); } catch (e) { console.warn('[CROSSFADE] native stop warn:', e); }
        await new Promise(r => setTimeout(r, 60));

        // Sayfayı/medyayı ayarla
        state.activeMedia = 'audio';
        if (state.currentPage === 'video' || state.currentPage === 'web') {
            switchPage('music');
        }

        // Yeni dosyayı yükle
        const result = await window.aurivo.audio.loadFile(toItem.path);
        console.log('[CROSSFADE] native loadFile result:', result);
        if (!(result === true || (result && result.success))) {
            console.error('[CROSSFADE] Native transition: loadFile failed', result);
            await recoverOldTrack();
            return;
        }

        // Başlat
        state.currentIndex = index;
        await window.aurivo.audio.setVolume?.(0);
        await window.aurivo.audio.play?.();
        // Bazı durumlarda play çağrısı ilk seferde başlamayabiliyor -> kısa kontrol + retry
        try {
            await new Promise(r => setTimeout(r, 80));
            if (typeof window.aurivo.audio.isPlaying === 'function') {
                const playing = await window.aurivo.audio.isPlaying();
                if (!playing) {
                    console.warn('[CROSSFADE] play did not start, retrying...');
                    await window.aurivo.audio.play?.();
                }
            }
        } catch (e) {
            console.warn('[CROSSFADE] isPlaying check warn:', e);
        }
        startNativePositionUpdates();

        // UI update
        state.isPlaying = true;
        updatePlayPauseIcon(true);
        elements.nowPlayingLabel.textContent = 'Şu An Çalınan: ' + toItem.name;
        renderPlaylist();
        extractAlbumArt(toItem.path);

        // Fade in
        if (totalMs > 0 && typeof window.aurivo.audio.fadeVolumeTo === 'function') {
            await window.aurivo.audio.fadeVolumeTo(targetVol, inMs);
        } else {
            await window.aurivo.audio.setVolume?.(targetVol);
        }

        console.log('[CROSSFADE] Native transition completed');
    } catch (e) {
        console.error('[CROSSFADE] Native transition error:', e);
        await recoverOldTrack();
    } finally {
        state.crossfadeInProgress = false;
    }
}

// C++ Engine pozisyon güncelleme
function startNativePositionUpdates() {
    stopNativePositionUpdates();
    
    console.log('Position update başlatıldı');

    const myGen = ++state.nativePositionGeneration;
    
    state.nativePositionTimer = setInterval(async () => {
        if (myGen !== state.nativePositionGeneration) return;
        if (!useNativeAudio) {
            console.log('Native audio kullanılmıyor');
            return;
        }
        if (!state.isPlaying) {
            return;
        }
        
        try {
            // IPC çağrıları async
            const positionMs = await window.aurivo.audio.getPosition(); // milisaniye
            const durationSec = await window.aurivo.audio.getDuration(); // saniye
            const isPlaying = await window.aurivo.audio.isPlaying();

            // Bu tick sırasında stop/restart olduysa hiçbir şey yapma
            if (myGen !== state.nativePositionGeneration) return;
            
            const positionSec = positionMs / 1000;
            
            // UI güncelle
            if (elements.currentTime) {
                elements.currentTime.textContent = formatTime(positionSec);
            }
            if (elements.durationTime) {
                elements.durationTime.textContent = formatTime(durationSec);
            }
            
            if (durationSec > 0 && elements.seekSlider) {
                const progress = (positionSec / durationSec) * 1000;
                elements.seekSlider.value = progress;
                updateRainbowSlider(elements.seekSlider, progress / 10);
            }
            
            // Şarkı bitti mi kontrol et
            const durationMs = durationSec * 1000;

            // Native crossfade için cache
            state.nativePositionMs = positionMs;
            state.nativeDurationSec = durationSec;

            // Native TrackAboutToEnd logic (Clementine-inspired)
            const crossfadeMs = state.settings?.playback?.crossfadeMs || 2000;
            const fudgeMs = 100; // timing tolerance
            const gap = crossfadeMs + (state.settings?.playback?.crossfadeAutoEnabled ? 0 : 1000);
            const remaining = durationMs - positionMs;
            const minimumPlayTimeMs = 3000; // 3 saniye minimum oynatma
            
            // TrackAboutToEnd early warning
            if (durationMs > 0 && !state.trackAboutToEndTriggered && remaining > 0) {
                if (remaining < gap + fudgeMs && positionMs >= minimumPlayTimeMs) {
                    state.trackAboutToEndTriggered = true;
                    console.log('[NATIVE] Track about to end, remaining:', remaining + 'ms');
                }
            }
            
            // Auto crossfade trigger
            if (state.settings?.playback?.crossfadeAutoEnabled && !state.autoCrossfadeTriggered && !state.crossfadeInProgress) {
                if (state.trackAboutToEndTriggered && remaining > 0 && remaining <= crossfadeMs) {
                    const nextIdx = computeNextIndex();
                    if (nextIdx >= 0) {
                        state.autoCrossfadeTriggered = true;
                        console.log('[NATIVE] Auto crossfade triggered, remaining:', remaining + 'ms');
                        startNativeTransitionToIndex(nextIdx, crossfadeMs).catch((e) => {
                            console.error('[CROSSFADE] Native auto transition error:', e);
                            playIndex(nextIdx);
                        });
                        return;
                    }
                }
            }

            // Bazı formatlarda (özellikle yüklemenin hemen ardından) duration geçici olarak 0 dönebiliyor.
            // Bu durumda "parça bitti" algısı yanlış tetiklenip anında next/crossfade zinciri başlatabiliyor.
            if (durationMs > 0 && !isPlaying && positionMs >= durationMs - 100) {
                handleNativePlaybackEnd();
            }
        } catch (e) {
            console.error('Native position update error:', e);
        }
    }, 100);
}

function stopNativePositionUpdates() {
    if (state.nativePositionTimer) {
        clearInterval(state.nativePositionTimer);
        state.nativePositionTimer = null;
    }

    // Interval callback'leri async olduğu için, clearInterval sonrası da bir tick
    // çalışmaya devam edebilir. Generation artırarak bu tick'leri etkisizleştiriyoruz.
    state.nativePositionGeneration = (state.nativePositionGeneration || 0) + 1;
}

function handleNativePlaybackEnd() {
    stopNativePositionUpdates();

    if (state.autoCrossfadeTriggered || state.crossfadeInProgress) return;
    
    if (state.isRepeat) {
        playIndex(state.currentIndex);
    } else {
        const nextIdx = computeNextIndex();
        if (nextIdx >= 0 && state.settings?.playback?.crossfadeAutoEnabled) {
            startNativeTransitionToIndex(nextIdx, state.settings.playback.crossfadeMs || 2000).catch((e) => {
                console.error('[CROSSFADE] Native end transition error:', e);
                playIndex(nextIdx);
            });
        } else if (nextIdx >= 0) {
            playIndex(nextIdx);
        } else {
            state.isPlaying = false;
            updatePlayPauseIcon(false);
        }
    }
}

// Albüm kapağı çıkarma
async function extractAlbumArt(filePath) {
    console.log('=== ALBUM KAPAK CIKARMA BASLADI ===');
    console.log('Dosya yolu:', filePath);
    
    try {
        if (window.aurivo && window.aurivo.getAlbumArt) {
            console.log('getAlbumArt API mevcut, çağırılıyor...');
            const coverData = await window.aurivo.getAlbumArt(filePath);
            
            if (coverData) {
                console.log('KAPAK VERISI ALINDI!');
                console.log('Veri uzunluğu:', coverData.length);
                console.log('İlk 80 karakter:', coverData.substring(0, 80));
                updateCoverArt(coverData, 'audio');
                return;
            } else {
                console.log('Kapak verisi NULL döndü');
            }
        } else {
            console.log('HATA: getAlbumArt fonksiyonu yok!');
            console.log('window.aurivo:', window.aurivo);
        }
    } catch (e) {
        console.error('HATA oluştu:', e);
    }
    
    console.log('Varsayılan kapak kullanılacak');
    updateCoverArt(null, 'audio');
}

// Kapak resmini güncelle
function updateCoverArt(imageData, mediaType) {
    const coverImg = elements.coverArt;
    if (!coverImg) {
        console.log('coverArt element bulunamadı');
        return;
    }
    
    console.log('Cover güncelleniyor:', mediaType, imageData ? 'data var' : 'varsayılan');
    
    if (imageData) {
        // Base64 resim verisi
        coverImg.src = imageData;
        coverImg.classList.remove('default-cover');
    } else {
        // Varsayılan ikonları göster (mevcut dosyaları kullan)
        if (mediaType === 'video') {
            coverImg.src = '../icons/nav_video.svg';
        } else if (mediaType === 'web') {
            coverImg.src = '../icons/nav_internet.svg';
        } else {
            coverImg.src = '../icons/aurivo_256.png';
        }
        coverImg.classList.add('default-cover');
    }
    
    state.currentCover = imageData;
}

function togglePlayPause() {
    const activePlayer = getActiveAudioPlayer();
    
    if (state.isPlaying) {
        // Duraklatma
        if (state.activeMedia === 'audio') {
            if (useNativeAudio) {
                // C++ Engine ile duraklat (opsiyonel fade)
                if (state.settings?.playback?.fadeOnPauseResume && window.aurivo?.audio?.fadeVolumeTo) {
                    const ms = state.settings.playback.pauseFadeMs || 250;
                    window.aurivo.audio.fadeVolumeTo(0, ms).finally(() => {
                        window.aurivo.audio.pause();
                        stopNativePositionUpdates();
                    });
                } else {
                    window.aurivo.audio.pause();
                    stopNativePositionUpdates();
                }
            } else {
                // Fade on pause özelliği aktif mi?
                if (state.settings?.playback?.fadeOnPauseResume) {
                    fadeOutAndPause(activePlayer, state.settings.playback.pauseFadeMs || 250);
                } else {
                    activePlayer.pause();
                }
            }
        } else if (state.activeMedia === 'video') {
            elements.videoPlayer.pause();
        }
        state.isPlaying = false;
        updatePlayPauseIcon(false);
    } else {
        // Oynatma - önce mevcut şarkı var mı kontrol et
        if (state.currentIndex >= 0 && state.activeMedia === 'audio') {
            // Mevcut şarkıyı devam ettir
            if (useNativeAudio) {
                if (state.settings?.playback?.fadeOnPauseResume && window.aurivo?.audio?.fadeVolumeTo) {
                    const ms = state.settings.playback.pauseFadeMs || 250;
                    window.aurivo.audio.setVolume(0);
                    window.aurivo.audio.play();
                    startNativePositionUpdates();
                    window.aurivo.audio.fadeVolumeTo(Math.max(0, Math.min(1, (state.volume || 0) / 100)), ms);
                } else {
                    window.aurivo.audio.play();
                    startNativePositionUpdates();
                }
            } else {
                if (state.settings?.playback?.fadeOnPauseResume) {
                    fadeInAndPlay(activePlayer, state.settings.playback.pauseFadeMs || 250);
                } else {
                    activePlayer.play();
                }
            }
            state.isPlaying = true;
            updatePlayPauseIcon(true);
        } else if (state.currentIndex === -1 && state.playlist.length > 0) {
            // Hiç şarkı çalmıyorsa ilk şarkıyı başlat
            playIndex(0);
        } else if (state.activeMedia === 'video') {
            elements.videoPlayer.play();
            state.isPlaying = true;
            updatePlayPauseIcon(true);
        }
    }
}

// Fade out ve duraklatma
function fadeOutAndPause(player, duration) {
    const startVolume = player.volume;
    const startTime = performance.now();
    
    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        player.volume = startVolume * (1 - progress);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            player.pause();
            player.volume = startVolume; // Orijinal ses seviyesini geri yükle
        }
    }
    
    requestAnimationFrame(animate);
}

// Fade in ve oynatma
function fadeInAndPlay(player, duration) {
    const targetVolume = state.volume / 100;
    player.volume = 0;
    player.play();
    
    const startTime = performance.now();
    
    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        player.volume = targetVolume * progress;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    
    requestAnimationFrame(animate);
}

function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
        elements.playIcon.classList.add('hidden');
        elements.pauseIcon.classList.remove('hidden');
    } else {
        elements.playIcon.classList.remove('hidden');
        elements.pauseIcon.classList.add('hidden');
    }
}

// ============================================
// CROSSFADE FUNCTIONS
// ============================================

// Crossfade yapılabilir mi kontrolü
function canCrossfadeNow() {
    if (state.crossfadeInProgress) return false;
    if (!state.settings?.playback) return false;
    if (state.settings.playback.crossfadeMs <= 0) return false;
    if (state.playlist.length <= 0) return false;
    if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) return false;

    // Native engine: HTML5 duration yok, yine de geçiş yapabiliriz
    if (useNativeAudio && state.activeMedia === 'audio') {
        return true;
    }
    
    const activePlayer = getActiveAudioPlayer();
    const duration = activePlayer.duration * 1000;
    
    // Parça çok kısa ise crossfade yapma
    if (duration > 0 && duration < state.settings.playback.crossfadeMs + 300) return false;
    
    return true;
}

// Sonraki index'i hesapla
function computeNextIndex() {
    if (state.playlist.length <= 0) return -1;
    
    if (state.isShuffle) {
        if (state.playlist.length <= 1) return state.currentIndex;
        let idx = Math.floor(Math.random() * state.playlist.length);
        if (idx === state.currentIndex) {
            idx = (idx + 1) % state.playlist.length;
        }
        return idx;
    }
    
    let nextIdx = state.currentIndex + 1;
    if (nextIdx >= state.playlist.length) {
        return state.isRepeat ? 0 : -1;
    }
    return nextIdx;
}

// Önceki index'i hesapla
function computePrevIndex() {
    if (state.playlist.length <= 0) return -1;
    
    if (state.isShuffle) {
        if (state.playlist.length <= 1) return state.currentIndex;
        let idx = Math.floor(Math.random() * state.playlist.length);
        if (idx === state.currentIndex) {
            idx = (idx + 1) % state.playlist.length;
        }
        return idx;
    }
    
    let prevIdx = state.currentIndex - 1;
    if (prevIdx < 0) {
        return state.isRepeat ? state.playlist.length - 1 : -1;
    }
    return prevIdx;
}

// Crossfade ile parça değiştir
function startCrossfadeToIndex(index, ms) {
    if (!canCrossfadeNow() || index < 0 || index >= state.playlist.length) {
        // Crossfade yapılamıyorsa normal geçiş
        playIndex(index);
        return;
    }

    // Native engine aktifse: fade-out -> track switch -> fade-in
    if (useNativeAudio && state.activeMedia === 'audio') {
        startNativeTransitionToIndex(index, ms || (state.settings?.playback?.crossfadeMs || 2000))
            .catch((e) => {
                console.error('[CROSSFADE] Native transition promise rejected:', e);
                playIndex(index);
            });
        return;
    }
    
    state.crossfadeInProgress = true;
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;
    
    const oldPlayer = getActiveAudioPlayer();
    const oldVolume = oldPlayer.volume;
    
    // Yeni player'a geç
    switchActivePlayer();
    const newPlayer = getActiveAudioPlayer();
    
    // Yeni parçayı hazırla
    const item = state.playlist[index];
    const encodedPath = encodeURI('file://' + item.path).replace(/#/g, '%23');
    
    newPlayer.src = encodedPath;
    newPlayer.volume = 0;
    newPlayer.play();
    
    // UI'ı güncelle
    state.currentIndex = index;
    state.isPlaying = true;
    elements.nowPlayingLabel.textContent = 'Şu An Çalınan: ' + item.name;
    renderPlaylist();
    extractAlbumArt(item.path);
    
    // Crossfade animasyonu
    const startTime = performance.now();
    const targetVolume = state.volume / 100;
    
    function animateCrossfade() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / ms, 1);
        
        // Eski player fade out
        oldPlayer.volume = oldVolume * (1 - progress);
        
        // Yeni player fade in
        newPlayer.volume = targetVolume * progress;
        
        if (progress < 1) {
            requestAnimationFrame(animateCrossfade);
        } else {
            // Crossfade bitti
            oldPlayer.pause();
            oldPlayer.src = '';
            oldPlayer.volume = 0;
            state.crossfadeInProgress = false;
            console.log('Crossfade tamamlandı');
        }
    }
    
    requestAnimationFrame(animateCrossfade);
    console.log('Crossfade başlatıldı:', item.name);
}

// Otomatik crossfade kontrolü (parça bitişi)
function maybeStartAutoCrossfade() {
    // Native audio kullanıyorken HTML5 audio crossfade'i devre dışı
    if (useNativeAudio) return;
    
    if (!state.settings?.playback?.crossfadeAutoEnabled) return;
    if (state.autoCrossfadeTriggered) return;
    if (!canCrossfadeNow()) return;
    
    const activePlayer = getActiveAudioPlayer();
    const positionMs = activePlayer.currentTime * 1000;
    const durationMs = activePlayer.duration * 1000;
    
    if (durationMs <= 0) return;
    
    const remaining = durationMs - positionMs;
    if (remaining <= 0) return;
    
    const crossfadeMs = state.settings.playback.crossfadeMs || 2000;
    
    // Crossfade süresi kadar kala tetikle
    if (remaining > crossfadeMs) {
        state.trackAboutToEnd = false;
        return;
    }
    
    if (!state.trackAboutToEnd) {
        state.trackAboutToEnd = true;
    }
    
    const nextIdx = computeNextIndex();
    if (nextIdx < 0) return;
    
    state.autoCrossfadeTriggered = true;
    startCrossfadeToIndex(nextIdx, crossfadeMs);
}

// Manuel crossfade ile sonraki parça
function playNextWithCrossfade() {
    if (state.playlist.length === 0) return;
    
    const nextIndex = computeNextIndex();
    if (nextIndex < 0) return;
    
    // Elle çapraz geçiş aktif mi?
    if (state.settings?.playback?.crossfadeManualEnabled && canCrossfadeNow()) {
        const crossfadeMs = state.settings.playback.crossfadeMs || 2000;
        startCrossfadeToIndex(nextIndex, crossfadeMs);
    } else {
        playIndex(nextIndex);
    }
}

// Manuel crossfade ile önceki parça
function playPreviousWithCrossfade() {
    if (state.playlist.length === 0) return;
    
    const prevIndex = computePrevIndex();
    if (prevIndex < 0) return;
    
    // Elle çapraz geçiş aktif mi?
    if (state.settings?.playback?.crossfadeManualEnabled && canCrossfadeNow()) {
        const crossfadeMs = state.settings.playback.crossfadeMs || 2000;
        startCrossfadeToIndex(prevIndex, crossfadeMs);
    } else {
        playIndex(prevIndex);
    }
}

// Eski playNext fonksiyonu (dahili kullanım için)
function playNext() {
    if (state.playlist.length === 0) return;
    
    let nextIndex;
    if (state.isShuffle) {
        nextIndex = Math.floor(Math.random() * state.playlist.length);
    } else {
        nextIndex = (state.currentIndex + 1) % state.playlist.length;
    }
    playIndex(nextIndex);
}

function playPrevious() {
    if (state.playlist.length === 0) return;
    
    let prevIndex;
    if (state.isShuffle) {
        prevIndex = Math.floor(Math.random() * state.playlist.length);
    } else {
        prevIndex = state.currentIndex - 1;
        if (prevIndex < 0) prevIndex = state.playlist.length - 1;
    }
    playIndex(prevIndex);
}

function handleTrackEnded() {
    // Eğer otomatik crossfade zaten tetiklendiyse, bir şey yapma
    if (state.autoCrossfadeTriggered || state.crossfadeInProgress) {
        return;
    }
    
    if (state.isRepeat) {
        playIndex(state.currentIndex);
    } else {
        // Otomatik crossfade aktifse ve sonraki parça varsa
        const nextIdx = computeNextIndex();
        if (nextIdx >= 0 && state.settings?.playback?.crossfadeAutoEnabled) {
            startCrossfadeToIndex(nextIdx, state.settings.playback.crossfadeMs || 2000);
        } else if (nextIdx >= 0) {
            playIndex(nextIdx);
        } else {
            // Liste bitti
            state.isPlaying = false;
            updatePlayPauseIcon(false);
        }
    }
}

function seekBy(seconds) {
    if (useNativeAudio && state.activeMedia === 'audio') {
        // C++ Engine ile seek
        window.aurivo.audio.getPosition().then(pos => {
            window.aurivo.audio.seek(pos + seconds * 1000);
        });
    } else {
        const activePlayer = getActiveAudioPlayer();
        activePlayer.currentTime += seconds;
    }
}

async function handleSeek() {
    const value = elements.seekSlider.value;
    
    if (useNativeAudio && state.activeMedia === 'audio') {
        // C++ Engine ile seek
        const duration = await window.aurivo.audio.getDuration();
        const newPos = (value / 1000) * duration;
        await window.aurivo.audio.seek(newPos);
    } else {
        const activePlayer = getActiveAudioPlayer();
        const duration = activePlayer.duration || 0;
        activePlayer.currentTime = (value / 1000) * duration;
    }
}

// Seek slider'a tek tıklamayla pozisyon ayarlama
async function handleSeekClick(e) {
    const rect = elements.seekSlider.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    
    if (useNativeAudio && state.activeMedia === 'audio') {
        // C++ Engine ile seek - getDuration saniye dönüdürüyor, seek milisaniye bekliyor
        const durationSec = await window.aurivo.audio.getDuration();
        if (durationSec > 0) {
            const newPosMs = percent * durationSec * 1000; // Milisaniyeye çevir
            await window.aurivo.audio.seek(newPosMs);
            elements.seekSlider.value = percent * 1000;
            updateRainbowSlider(elements.seekSlider, percent * 100);
        }
    } else {
        const activePlayer = getActiveAudioPlayer();
        const duration = activePlayer.duration || 0;
        
        if (duration > 0) {
            const newTime = percent * duration;
            activePlayer.currentTime = newTime;
            elements.seekSlider.value = percent * 1000;
            updateRainbowSlider(elements.seekSlider, percent * 100);
        }
    }
}

function updateTimeDisplay() {
    // HTML5 Audio için (native modda startNativePositionUpdates kullanılır)
    if (useNativeAudio && state.activeMedia === 'audio') return;
    
    const activePlayer = getActiveAudioPlayer();
    const current = activePlayer.currentTime;
    const duration = activePlayer.duration || 0;
    
    elements.currentTime.textContent = formatTime(current);
    
    if (duration > 0) {
        const progress = (current / duration) * 1000;
        elements.seekSlider.value = progress;
        // Rainbow slider efektini güncelle
        updateRainbowSlider(elements.seekSlider, progress / 10);
    }
}

function handleMetadataLoaded() {
    const activePlayer = getActiveAudioPlayer();
    const duration = activePlayer.duration;
    elements.durationTime.textContent = formatTime(duration);
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// VOLUME
// ============================================
function handleVolumeChange() {
    const value = parseInt(elements.volumeSlider.value);
    state.volume = value;
    state.isMuted = false;
    
    // C++ Audio Engine kullanılıyorsa (0-100 arası değer bekliyor)
    if (useNativeAudio && state.activeMedia === 'audio') {
        window.aurivo.audio.setVolume(value / 100); // 0-1 arası
    }
    
    // HTML5 Audio/Video için de güncelle (0-1 arası bekliyor)
    const activePlayer = getActiveAudioPlayer();
    if (!state.crossfadeInProgress) {
        activePlayer.volume = value / 100;
    }
    elements.videoPlayer.volume = value / 100;
    elements.volumeLabel.textContent = value + '%';
    updateVolumeIcon();
    // Rainbow slider efektini güncelle
    updateRainbowSlider(elements.volumeSlider, value);
    saveSettings();
}

function toggleMute() {
    if (state.isMuted) {
        state.isMuted = false;
        elements.volumeSlider.value = state.savedVolume;
        state.volume = state.savedVolume;
        
        if (useNativeAudio) {
            window.aurivo.audio.setVolume(state.savedVolume / 100); // 0-1
        }
        elements.audio.volume = state.savedVolume / 100;
        elements.volumeLabel.textContent = state.savedVolume + '%';
    } else {
        state.isMuted = true;
        state.savedVolume = state.volume;
        elements.volumeSlider.value = 0;
        state.volume = 0;
        
        if (useNativeAudio) {
            window.aurivo.audio.setVolume(0);
        }
        elements.audio.volume = 0;
        elements.volumeLabel.textContent = '0%';
    }
    updateVolumeIcon();
}

function updateVolumeIcon() {
    // İkon güncelleme (CSS ile yapılabilir)
}

// Ses slider tek tıkla ayarlama
function handleVolumeClick(e) {
    const rect = elements.volumeSlider.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.round((clickX / rect.width) * 100);
    const newValue = Math.max(0, Math.min(100, percent));
    
    elements.volumeSlider.value = newValue;
    handleVolumeChange();
}

// Ses slider tekerlek ile 5 kademeli ayarlama
function handleVolumeWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 5 : -5; // Yukarı = artır, aşağı = azalt
    const newValue = Math.max(0, Math.min(100, parseInt(state.volume) + delta));
    
    elements.volumeSlider.value = newValue;
    handleVolumeChange();
}

// ============================================
// SHUFFLE & REPEAT
// ============================================
function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    elements.shuffleBtn.classList.toggle('active', state.isShuffle);
    saveSettings();
}

function toggleRepeat() {
    state.isRepeat = !state.isRepeat;
    elements.repeatBtn.classList.toggle('active', state.isRepeat);
    saveSettings();
}

// ============================================
// SETTINGS MODAL
// ============================================
function openSettings() {
    elements.settingsModal.classList.remove('hidden');
    loadSettingsToUI();
}

function closeSettings() {
    elements.settingsModal.classList.add('hidden');
}

function switchSettingsTab(tab) {
    const tabName = tab.dataset.tab;
    
    elements.settingsTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    elements.settingsPages.forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });
    
    const targetPage = document.getElementById(tabName + 'Settings');
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
    }
}

function loadSettingsToUI() {
    if (!state.settings) return;
    const pb = state.settings.playback;
    
    document.getElementById('crossfadeStop').checked = pb.crossfadeStopEnabled;
    document.getElementById('crossfadeManual').checked = pb.crossfadeManualEnabled;
    document.getElementById('crossfadeAuto').checked = pb.crossfadeAutoEnabled;
    document.getElementById('sameAlbumNoCrossfade').checked = pb.sameAlbumNoCrossfade;
    document.getElementById('sameAlbumNoCrossfade').disabled = !pb.crossfadeAutoEnabled;
    document.getElementById('crossfadeMs').value = pb.crossfadeMs;
    document.getElementById('fadeOnPause').checked = pb.fadeOnPauseResume;
    document.getElementById('pauseFadeMs').value = pb.pauseFadeMs;
}

function applySettings() {
    if (!state.settings) return;
    
    state.settings.playback = {
        crossfadeStopEnabled: document.getElementById('crossfadeStop').checked,
        crossfadeManualEnabled: document.getElementById('crossfadeManual').checked,
        crossfadeAutoEnabled: document.getElementById('crossfadeAuto').checked,
        sameAlbumNoCrossfade: document.getElementById('sameAlbumNoCrossfade').checked,
        crossfadeMs: parseInt(document.getElementById('crossfadeMs').value),
        fadeOnPauseResume: document.getElementById('fadeOnPause').checked,
        pauseFadeMs: parseInt(document.getElementById('pauseFadeMs').value)
    };
    
    saveSettings();
}

function resetPlaybackDefaults() {
    document.getElementById('crossfadeStop').checked = true;
    document.getElementById('crossfadeManual').checked = true;
    document.getElementById('crossfadeAuto').checked = false;
    document.getElementById('sameAlbumNoCrossfade').checked = true;
    document.getElementById('sameAlbumNoCrossfade').disabled = true;
    document.getElementById('crossfadeMs').value = 2000;
    document.getElementById('fadeOnPause').checked = false;
    document.getElementById('pauseFadeMs').value = 250;
}

function showAbout() {
    alert('Aurivo Media Player\nVersion 1.0.0\n\nModern medya oynatıcı');
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
function handleKeyboard(e) {
    // Modal açıkken klavye kısayollarını devre dışı bırak
    if (!elements.settingsModal.classList.contains('hidden')) return;
    
    // CTRL+A - file tree'de tüm dosyaları seç
    if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        e.stopPropagation();
        
        // Tüm dosya öğelerini seç (klasörleri hariç tut)
        const fileItems = document.querySelectorAll('.tree-item.file');
        if (fileItems.length > 0) {
            fileItems.forEach(item => {
                item.classList.add('selected');
            });
            console.log('CTRL+A: ' + fileItems.length + ' dosya seçildi');
        }
        return;
    }
    
    // ENTER - seçili dosyaları playlist'e ekle
    if (e.key === 'Enter') {
        const selectedItems = document.querySelectorAll('.tree-item.file.selected');
        if (selectedItems.length > 0) {
            e.preventDefault();
            addSelectedFilesToPlaylist();
            return;
        }
    }
    
    switch(e.code) {
        case 'Space':
            e.preventDefault();
            togglePlayPause();
            break;
        case 'ArrowLeft':
            seekBy(-5);
            break;
        case 'ArrowRight':
            seekBy(5);
            break;
        case 'ArrowUp':
            elements.volumeSlider.value = Math.min(100, state.volume + 5);
            handleVolumeChange();
            break;
        case 'ArrowDown':
            elements.volumeSlider.value = Math.max(0, state.volume - 5);
            handleVolumeChange();
            break;
        case 'KeyM':
            toggleMute();
            break;
        case 'KeyS':
            toggleShuffle();
            break;
        case 'KeyR':
            toggleRepeat();
            break;
    }
}

// ============================================
// VISUALIZER - Qt/C++ AnalyzerContainer Port
// Based on dli/analyzers/analyzercontainer.cpp
// ============================================
let audioContext, analyser, dataArray;

// Visualizer Settings
const VisualizerSettings = {
    currentAnalyzer: 'bar',
    currentFramerate: 30,
    psychedelicEnabled: true,
    glowEnabled: true,
    reflectionEnabled: false,
    hueOffset: 0,
    
    // Available analyzers
    analyzers: {
        'bar': 'Bar çözümleyici',
        'block': 'Blok çözümleyici',
        'boom': 'Boom çözümleyici',
        'sonogram': 'Sonogram',
        'turbine': 'Türbin',
        'nyanalyzer': 'Nyanalyzer Cat',
        'rainbow': 'Rainbow Dash',
        'none': 'Çözümleyici yok'
    },
    
    framerates: [20, 25, 30, 60],
    
    load() {
        try {
            const saved = localStorage.getItem('aurivo_visualizer');
            if (saved) {
                const data = JSON.parse(saved);
                this.currentAnalyzer = data.analyzer || 'bar';
                this.currentFramerate = data.framerate || 30;
                this.psychedelicEnabled = data.psychedelic !== false;
                this.glowEnabled = data.glow !== false;
                this.reflectionEnabled = data.reflection || false;
            }
        } catch (e) {
            console.log('Visualizer settings load error:', e);
        }
    },
    
    save() {
        try {
            localStorage.setItem('aurivo_visualizer', JSON.stringify({
                analyzer: this.currentAnalyzer,
                framerate: this.currentFramerate,
                psychedelic: this.psychedelicEnabled,
                glow: this.glowEnabled,
                reflection: this.reflectionEnabled
            }));
        } catch (e) {
            console.log('Visualizer settings save error:', e);
        }
    }
};

// ============================================
// AURIVO BAR ANALYZER - Qt/C++ Port to JavaScript
// Based on dli/analyzers/baranalyzer.cpp
// ============================================
const BarAnalyzer = {
    // Constants from baranalyzer.h
    ROOF_HOLD_TIME: 48,
    ROOF_VELOCITY_REDUCTION_FACTOR: 32,
    NUM_ROOFS: 16,
    COLUMN_WIDTH: 4,
    GAP: 1,
    
    // State
    bandCount: 64,
    barVector: [],
    roofVector: [],
    roofVelocityVector: [],
    roofMem: [],
    lvlMapper: [],
    maxDown: -2,
    maxUp: 4,
    psychedelicEnabled: true,
    hueOffset: 0,
    
    // Initialize analyzer
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
        
        // Create level mapper (logarithmic scale)
        const MAX_AMPLITUDE = 1.0;
        const F = (canvas.height - 2) / (Math.log10(255) * MAX_AMPLITUDE);
        
        for (let x = 0; x < 256; x++) {
            this.lvlMapper[x] = Math.floor(F * Math.log10(x + 1));
        }
    },
    
    resize() {
        if (!this.canvas) return;
        
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        if (width <= 0 || height <= 0) return;
        
        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        
        this.maxDown = -Math.max(1, Math.floor(height / 50));
        this.maxUp = Math.max(1, Math.floor(height / 25));
        
        // Reset arrays
        this.barVector = new Array(this.bandCount).fill(0);
        this.roofVector = new Array(this.bandCount).fill(height - 5);
        this.roofVelocityVector = new Array(this.bandCount).fill(this.ROOF_VELOCITY_REDUCTION_FACTOR);
        this.roofMem = Array.from({ length: this.bandCount }, () => []);
    },
    
    // Get psychedelic color based on position
    getColor(index, total, brightness = 100) {
        const hue = (this.hueOffset + (index / total) * 360) % 360;
        return `hsl(${hue}, 100%, ${brightness}%)`;
    },
    
    // Get gradient for bar
    getBarGradient(x, height, barHeight) {
        const gradient = this.ctx.createLinearGradient(x, this.canvas.height, x, this.canvas.height - barHeight);
        
        if (this.psychedelicEnabled) {
            const hue = (this.hueOffset + (x / this.canvas.width) * 360) % 360;
            gradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
            gradient.addColorStop(0.5, `hsl(${(hue + 30) % 360}, 100%, 50%)`);
            gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 80%, 40%)`);
        } else {
            gradient.addColorStop(0, '#00d9ff');
            gradient.addColorStop(0.5, '#00a8cc');
            gradient.addColorStop(1, '#006688');
        }
        
        return gradient;
    },
    
    // Main analyze function - processes spectrum data
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);
        
        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            // Draw idle bars
            this.drawIdleBars();
            return;
        }
        
        // Update hue for psychedelic mode
        if (this.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }
        
        // Interpolate spectrum data to match band count
        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);
        
        // Process each band
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            
            // Map spectrum value to height
            let y2 = Math.floor(scope[i] * 256);
            y2 = this.lvlMapper[Math.min(y2, 255)];
            
            // Smooth falling
            const change = y2 - this.barVector[i];
            if (change < this.maxDown) {
                y2 = this.barVector[i] + this.maxDown;
            }
            
            // Update roof (peak indicator)
            if (y2 > this.roofVector[i]) {
                this.roofVector[i] = y2;
                this.roofVelocityVector[i] = 1;
            }
            
            this.barVector[i] = y2;
            
            // Draw bar with gradient
            if (y2 > 0) {
                ctx.fillStyle = this.getBarGradient(x, height, y2);
                ctx.fillRect(x, height - y2, this.COLUMN_WIDTH, y2);
            }
            
            // Draw roof (peak indicators)
            if (this.roofMem[i].length > this.NUM_ROOFS) {
                this.roofMem[i].shift();
            }
            
            // Draw fading roof trail
            for (let c = 0; c < this.roofMem[i].length; c++) {
                const roofY = this.roofMem[i][c];
                const alpha = 1 - (c / this.NUM_ROOFS);
                const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${alpha * 0.5})`;
                ctx.fillRect(x, roofY, this.COLUMN_WIDTH, 2);
            }
            
            // Current roof
            const roofY = height - this.roofVector[i] - 2;
            this.roofMem[i].push(roofY);
            
            // Draw current roof (peak)
            const roofHue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
            ctx.fillStyle = `hsl(${roofHue}, 100%, 80%)`;
            ctx.fillRect(x, roofY, this.COLUMN_WIDTH, 2);
            
            // Update roof physics
            if (this.roofVelocityVector[i] !== 0) {
                if (this.roofVelocityVector[i] > 32) {
                    this.roofVector[i] -= Math.floor((this.roofVelocityVector[i] - 32) / 20);
                }
                
                if (this.roofVector[i] < 0) {
                    this.roofVector[i] = 0;
                    this.roofVelocityVector[i] = 0;
                } else {
                    this.roofVelocityVector[i]++;
                }
            }
        }
    },
    
    // Draw idle bars when not playing
    drawIdleBars() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, canvas.height - 3, this.COLUMN_WIDTH, 3);
        }
        
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },
    
    // Interpolate spectrum data
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            
            // Linear interpolation with slight boost for lower frequencies
            const boost = 1 + (1 - i / targetSize) * 0.5;
            result[i] = ((1 - frac) * data[low] + frac * data[high]) * boost;
        }
        
        return result;
    }
};

// ============================================
// BLOCK ANALYZER - Qt/C++ Port to JavaScript
// Based on dli/analyzers/blockanalyzer.cpp
// ============================================
const BlockAnalyzer = {
    BLOCK_HEIGHT: 3,
    BLOCK_WIDTH: 4,
    GAP: 1,
    FADE_SIZE: 90,
    
    bandCount: 64,
    rows: 20,
    scope: [],
    bandInfo: [],
    step: 0.5,
    hueOffset: 0,
    canvas: null,
    ctx: null,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },
    
    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;
        
        this.bandCount = Math.floor(width / (this.BLOCK_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.rows = Math.floor(height / (this.BLOCK_HEIGHT + this.GAP));
        if (this.rows === 0) this.rows = 1;
        
        this.scope = new Array(this.bandCount).fill(0);
        this.bandInfo = Array.from({ length: this.bandCount }, () => ({ height: 0, row: 0 }));
        this.step = 0.5;
    },
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);
        
        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }
        
        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }
        
        // Interpolate spectrum
        const interpolated = this.interpolateSpectrum(spectrumData, this.bandCount);
        
        for (let x = 0; x < this.bandCount; x++) {
            const value = interpolated[x];
            let targetRow = Math.floor(value * this.rows);
            
            // Smooth animation
            if (targetRow < this.bandInfo[x].row) {
                this.bandInfo[x].height += this.step;
                this.bandInfo[x].row = Math.floor(this.bandInfo[x].height);
            } else {
                this.bandInfo[x].height = targetRow;
                this.bandInfo[x].row = targetRow;
            }
            
            const row = Math.min(this.bandInfo[x].row, this.rows);
            const xPos = x * (this.BLOCK_WIDTH + this.GAP);
            
            // Draw blocks
            for (let y = 0; y < row; y++) {
                const yPos = height - (y + 1) * (this.BLOCK_HEIGHT + this.GAP);
                const intensity = 1 - (y / this.rows);
                
                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (x / this.bandCount) * 360 + y * 5) % 360;
                    ctx.fillStyle = `hsl(${hue}, 100%, ${50 + intensity * 30}%)`;
                } else {
                    const g = Math.floor(100 + intensity * 155);
                    ctx.fillStyle = `rgb(0, ${g}, ${Math.floor(g * 0.8)})`;
                }
                
                ctx.fillRect(xPos, yPos, this.BLOCK_WIDTH, this.BLOCK_HEIGHT);
            }
        }
    },
    
    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        for (let x = 0; x < this.bandCount; x++) {
            const xPos = x * (this.BLOCK_WIDTH + this.GAP);
            const hue = (this.hueOffset + (x / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(xPos, canvas.height - this.BLOCK_HEIGHT, this.BLOCK_WIDTH, this.BLOCK_HEIGHT);
        }
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },
    
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// BOOM ANALYZER - Qt/C++ Port to JavaScript
// Based on dli/analyzers/boomanalyzer.cpp
// ============================================
const BoomAnalyzer = {
    COLUMN_WIDTH: 4,
    GAP: 1,
    K_BAR_HEIGHT: 1.271,
    F_PEAK_SPEED: 1.103,
    
    bandCount: 64,
    barHeight: [],
    peakHeight: [],
    peakSpeed: [],
    F: 1.0,
    hueOffset: 0,
    canvas: null,
    ctx: null,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },
    
    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;
        
        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        
        this.F = height / (Math.log10(256) * 1.1);
        this.barHeight = new Array(this.bandCount).fill(0);
        this.peakHeight = new Array(this.bandCount).fill(0);
        this.peakSpeed = new Array(this.bandCount).fill(0.01);
    },
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);
        
        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }
        
        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }
        
        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);
        const maxHeight = height - 1;
        
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            let h = Math.log10(scope[i] * 256 + 1) * this.F;
            if (h > maxHeight) h = maxHeight;
            
            if (h > this.barHeight[i]) {
                this.barHeight[i] = h;
                if (h > this.peakHeight[i]) {
                    this.peakHeight[i] = h;
                    this.peakSpeed[i] = 0.01;
                }
            } else {
                if (this.barHeight[i] > 0) {
                    this.barHeight[i] -= this.K_BAR_HEIGHT;
                    if (this.barHeight[i] < 0) this.barHeight[i] = 0;
                }
            }
            
            // Peak handling
            if (this.peakHeight[i] > 0) {
                this.peakHeight[i] -= this.peakSpeed[i];
                this.peakSpeed[i] *= this.F_PEAK_SPEED;
                if (this.peakHeight[i] < this.barHeight[i]) {
                    this.peakHeight[i] = this.barHeight[i];
                }
                if (this.peakHeight[i] < 0) this.peakHeight[i] = 0;
            }
            
            const y = height - this.barHeight[i];
            
            // Draw bar with gradient
            if (this.barHeight[i] > 0) {
                const gradient = ctx.createLinearGradient(x, height, x, y);
                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                    gradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
                    gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                } else {
                    gradient.addColorStop(0, '#00ff88');
                    gradient.addColorStop(1, '#004422');
                }
                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, this.COLUMN_WIDTH, this.barHeight[i]);
            }
            
            // Draw peak
            const peakY = height - this.peakHeight[i];
            if (VisualizerSettings.psychedelicEnabled) {
                const hue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            } else {
                ctx.fillStyle = '#ffffff';
            }
            ctx.fillRect(x, peakY - 2, this.COLUMN_WIDTH, 2);
        }
    },
    
    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, canvas.height - 3, this.COLUMN_WIDTH, 3);
        }
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },
    
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// TURBINE ANALYZER - Qt/C++ Port to JavaScript
// Based on dli/analyzers/turbine.cpp
// ============================================
const TurbineAnalyzer = {
    COLUMN_WIDTH: 4,
    GAP: 1,
    K_BAR_HEIGHT: 1.271,
    F_PEAK_SPEED: 1.103,
    
    bandCount: 64,
    barHeight: [],
    peakHeight: [],
    peakSpeed: [],
    F: 1.0,
    hueOffset: 0,
    canvas: null,
    ctx: null,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },
    
    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;
        
        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        
        this.F = (height / 2) / (Math.log10(256) * 1.1);
        this.barHeight = new Array(this.bandCount).fill(0);
        this.peakHeight = new Array(this.bandCount).fill(0);
        this.peakSpeed = new Array(this.bandCount).fill(0.01);
    },
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        const hd2 = height / 2;
        
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);
        
        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }
        
        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }
        
        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);
        const maxHeight = hd2 - 1;
        
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            let h = Math.min(Math.log10(scope[i] * 256 + 1) * this.F * 0.5, maxHeight);
            
            if (h > this.barHeight[i]) {
                this.barHeight[i] = h;
                if (h > this.peakHeight[i]) {
                    this.peakHeight[i] = h;
                    this.peakSpeed[i] = 0.01;
                }
            } else {
                if (this.barHeight[i] > 0) {
                    this.barHeight[i] -= this.K_BAR_HEIGHT;
                    if (this.barHeight[i] < 0) this.barHeight[i] = 0;
                }
            }
            
            if (this.peakHeight[i] > 0) {
                this.peakHeight[i] -= this.peakSpeed[i];
                this.peakSpeed[i] *= this.F_PEAK_SPEED;
                this.peakHeight[i] = Math.max(0, Math.max(this.barHeight[i], this.peakHeight[i]));
            }
            
            const barH = this.barHeight[i];
            
            // Draw mirrored bars (turbine effect)
            if (barH > 0) {
                const gradient = ctx.createLinearGradient(x, hd2 - barH, x, hd2 + barH);
                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                    gradient.addColorStop(0, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                    gradient.addColorStop(0.5, `hsl(${hue}, 100%, 60%)`);
                    gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                } else {
                    gradient.addColorStop(0, '#004466');
                    gradient.addColorStop(0.5, '#00aaff');
                    gradient.addColorStop(1, '#004466');
                }
                ctx.fillStyle = gradient;
                
                // Top bar
                ctx.fillRect(x, hd2 - barH, this.COLUMN_WIDTH, barH);
                // Bottom bar (mirrored)
                ctx.fillRect(x, hd2, this.COLUMN_WIDTH, barH);
            }
            
            // Draw peaks
            const peakH = this.peakHeight[i];
            if (VisualizerSettings.psychedelicEnabled) {
                const hue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            } else {
                ctx.fillStyle = '#88ccff';
            }
            ctx.fillRect(x, hd2 - peakH - 1, this.COLUMN_WIDTH, 2);
            ctx.fillRect(x, hd2 + peakH - 1, this.COLUMN_WIDTH, 2);
        }
        
        // Center line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(0, hd2, width, 1);
    },
    
    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const hd2 = canvas.height / 2;
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, hd2 - 2, this.COLUMN_WIDTH, 4);
        }
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },
    
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// SONOGRAM ANALYZER - Qt/C++ Port to JavaScript
// Based on dli/analyzers/sonogram.cpp
// ============================================
const SonogramAnalyzer = {
    canvas: null,
    ctx: null,
    scopeSize: 128,
    imageData: null,
    hueOffset: 0,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },
    
    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;
        
        this.imageData = this.ctx.createImageData(width, height);
        // Fill with background color
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            this.imageData.data[i] = 18;
            this.imageData.data[i + 1] = 18;
            this.imageData.data[i + 2] = 18;
            this.imageData.data[i + 3] = 255;
        }
    },
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        
        if (!this.imageData || this.imageData.width !== width) {
            this.resize();
        }
        
        // Shift image left by 1 pixel
        const data = this.imageData.data;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width - 1; x++) {
                const srcIdx = (y * width + x + 1) * 4;
                const dstIdx = (y * width + x) * 4;
                data[dstIdx] = data[srcIdx];
                data[dstIdx + 1] = data[srcIdx + 1];
                data[dstIdx + 2] = data[srcIdx + 2];
                data[dstIdx + 3] = data[srcIdx + 3];
            }
        }
        
        // Draw new column on the right
        const x = width - 1;
        
        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            // Draw idle column
            for (let y = 0; y < height; y++) {
                const idx = (y * width + x) * 4;
                data[idx] = 18;
                data[idx + 1] = 18;
                data[idx + 2] = 18;
                data[idx + 3] = 255;
            }
        } else {
            if (VisualizerSettings.psychedelicEnabled) {
                this.hueOffset = (this.hueOffset + 0.5) % 360;
            }
            
            const scope = this.interpolateSpectrum(spectrumData, height);
            
            for (let y = 0; y < height; y++) {
                const idx = ((height - 1 - y) * width + x) * 4;
                const value = scope[y];
                
                if (value < 0.005) {
                    data[idx] = 18;
                    data[idx + 1] = 18;
                    data[idx + 2] = 18;
                } else {
                    let h, s, l;
                    if (VisualizerSettings.psychedelicEnabled) {
                        h = (this.hueOffset + value * 90) % 360;
                        s = 100;
                        l = Math.min(50 + value * 50, 100);
                    } else {
                        h = 95 - value * 90;
                        s = 100;
                        l = Math.min(50 + value * 50, 100);
                    }
                    const rgb = this.hslToRgb(h / 360, s / 100, l / 100);
                    data[idx] = rgb[0];
                    data[idx + 1] = rgb[1];
                    data[idx + 2] = rgb[2];
                }
                data[idx + 3] = 255;
            }
        }
        
        ctx.putImageData(this.imageData, 0, 0);
    },
    
    hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    },
    
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// RAINBOW DASH ANALYZER - Fun animated analyzer
// ============================================
const RainbowDashAnalyzer = {
    COLUMN_WIDTH: 6,
    GAP: 2,
    
    bandCount: 32,
    barHeight: [],
    hueOffset: 0,
    waveOffset: 0,
    canvas: null,
    ctx: null,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },
    
    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        if (width <= 0) return;
        
        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.barHeight = new Array(this.bandCount).fill(0);
    },
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);
        
        this.hueOffset = (this.hueOffset + 2) % 360;
        this.waveOffset += 0.1;
        
        const scope = isPlaying && spectrumData 
            ? this.interpolateSpectrum(spectrumData, this.bandCount)
            : new Array(this.bandCount).fill(0);
        
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            
            // Add wave effect
            const wave = Math.sin(this.waveOffset + i * 0.3) * 10;
            let targetHeight = scope[i] * height * 0.8 + (isPlaying ? wave : 0);
            if (targetHeight < 5) targetHeight = 5;
            
            // Smooth animation
            this.barHeight[i] += (targetHeight - this.barHeight[i]) * 0.3;
            
            const barH = this.barHeight[i];
            const y = height - barH;
            
            // Rainbow gradient
            const gradient = ctx.createLinearGradient(x, height, x, y);
            const hue1 = (this.hueOffset + i * 15) % 360;
            const hue2 = (hue1 + 60) % 360;
            const hue3 = (hue1 + 120) % 360;
            
            gradient.addColorStop(0, `hsl(${hue1}, 100%, 50%)`);
            gradient.addColorStop(0.5, `hsl(${hue2}, 100%, 60%)`);
            gradient.addColorStop(1, `hsl(${hue3}, 100%, 40%)`);
            
            ctx.fillStyle = gradient;
            
            // Rounded bars
            const radius = Math.min(this.COLUMN_WIDTH / 2, 3);
            ctx.beginPath();
            ctx.roundRect(x, y, this.COLUMN_WIDTH, barH, [radius, radius, 0, 0]);
            ctx.fill();
            
            // Glow effect
            if (VisualizerSettings.glowEnabled && barH > 10) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = `hsl(${hue1}, 100%, 50%)`;
                ctx.fillRect(x, y, this.COLUMN_WIDTH, 2);
                ctx.shadowBlur = 0;
            }
        }
    },
    
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// NYANALYZER CAT - Fun cat-themed analyzer
// ============================================
const NyanalyzerCatAnalyzer = {
    COLUMN_WIDTH: 5,
    GAP: 1,
    
    bandCount: 48,
    barHeight: [],
    starPositions: [],
    hueOffset: 0,
    canvas: null,
    ctx: null,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
        this.generateStars();
    },
    
    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        if (width <= 0) return;
        
        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.barHeight = new Array(this.bandCount).fill(0);
        this.generateStars();
    },
    
    generateStars() {
        this.starPositions = [];
        for (let i = 0; i < 30; i++) {
            this.starPositions.push({
                x: Math.random() * (this.canvas?.width || 300),
                y: Math.random() * (this.canvas?.height || 150),
                size: Math.random() * 2 + 1,
                speed: Math.random() * 2 + 1
            });
        }
    },
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        
        // Dark space background
        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, '#0a0a1a');
        bgGradient.addColorStop(1, '#1a0a2a');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);
        
        // Draw moving stars
        this.hueOffset = (this.hueOffset + 1) % 360;
        for (const star of this.starPositions) {
            star.x -= star.speed;
            if (star.x < 0) star.x = width;
            
            ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + Math.sin(Date.now() / 200 + star.x) * 0.3})`;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const scope = isPlaying && spectrumData 
            ? this.interpolateSpectrum(spectrumData, this.bandCount)
            : new Array(this.bandCount).fill(0);
        
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            
            let targetHeight = scope[i] * height * 0.7;
            if (targetHeight < 3) targetHeight = 3;
            
            this.barHeight[i] += (targetHeight - this.barHeight[i]) * 0.25;
            
            const barH = this.barHeight[i];
            const y = height - barH;
            
            // Nyan cat rainbow colors
            const rainbowColors = ['#ff0000', '#ff9900', '#ffff00', '#33ff00', '#0099ff', '#6633ff'];
            const colorIndex = i % rainbowColors.length;
            
            // Draw rainbow trail segments
            const segmentHeight = barH / rainbowColors.length;
            for (let c = 0; c < rainbowColors.length; c++) {
                const segY = height - (c + 1) * segmentHeight;
                ctx.fillStyle = rainbowColors[c];
                ctx.globalAlpha = 0.8;
                ctx.fillRect(x, segY, this.COLUMN_WIDTH, segmentHeight + 1);
            }
            ctx.globalAlpha = 1;
        }
    },
    
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// NO ANALYZER - Empty display
// ============================================
const NoAnalyzer = {
    canvas: null,
    ctx: null,
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    },
    
    resize() {},
    
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
};

// ============================================
// ANALYZER CONTAINER - Manages all analyzers
// ============================================
const AnalyzerContainer = {
    currentAnalyzer: null,
    canvas: null,
    ctx: null,
    
    analyzers: {
        'bar': BarAnalyzer,
        'block': BlockAnalyzer,
        'boom': BoomAnalyzer,
        'turbine': TurbineAnalyzer,
        'sonogram': SonogramAnalyzer,
        'rainbow': RainbowDashAnalyzer,
        'nyanalyzer': NyanalyzerCatAnalyzer,
        'none': NoAnalyzer
    },
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // Initialize all analyzers
        for (const key in this.analyzers) {
            this.analyzers[key].init(canvas);
        }
        
        // Set current analyzer
        this.setAnalyzer(VisualizerSettings.currentAnalyzer);
    },
    
    resize() {
        for (const key in this.analyzers) {
            if (this.analyzers[key].resize) {
                this.analyzers[key].resize();
            }
        }
    },
    
    setAnalyzer(type) {
        if (this.analyzers[type]) {
            this.currentAnalyzer = this.analyzers[type];
            VisualizerSettings.currentAnalyzer = type;
            VisualizerSettings.save();
            updateContextMenuState();
        }
    },
    
    analyze(spectrumData, isPlaying) {
        if (this.currentAnalyzer) {
            this.currentAnalyzer.analyze(spectrumData, isPlaying);
        }
    }
};

// ============================================
// VISUALIZER CONTEXT MENU
// ============================================
function setupVisualizerContextMenu() {
    const canvas = elements.visualizerCanvas;
    const contextMenu = document.getElementById('visualizerContextMenu');
    
    if (!canvas || !contextMenu) return;
    
    // Right-click handler
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY);
    });
    
    // Left-click also opens menu (like Qt version)
    canvas.addEventListener('click', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY);
    });
    
    // Hide menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target) && e.target !== canvas) {
            hideContextMenu();
        }
    });
    
    // Analyzer type selection
    contextMenu.querySelectorAll('[data-analyzer]').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.analyzer;
            AnalyzerContainer.setAnalyzer(type);
            hideContextMenu();
        });
    });
    
    // Framerate selection
    contextMenu.querySelectorAll('[data-framerate]').forEach(item => {
        item.addEventListener('click', () => {
            const fps = parseInt(item.dataset.framerate);
            VisualizerSettings.currentFramerate = fps;
            VisualizerSettings.save();
            updateContextMenuState();
            hideContextMenu();
        });
    });
    
    // Psychedelic toggle
    const psychedelicToggle = document.getElementById('psychedelicToggle');
    if (psychedelicToggle) {
        psychedelicToggle.addEventListener('click', () => {
            VisualizerSettings.psychedelicEnabled = !VisualizerSettings.psychedelicEnabled;
            VisualizerSettings.save();
            updateContextMenuState();
        });
    }
    
    // Visual effects
    contextMenu.querySelectorAll('[data-visual]').forEach(item => {
        item.addEventListener('click', () => {
            const effect = item.dataset.visual;
            if (effect === 'glow') {
                VisualizerSettings.glowEnabled = !VisualizerSettings.glowEnabled;
            } else if (effect === 'reflection') {
                VisualizerSettings.reflectionEnabled = !VisualizerSettings.reflectionEnabled;
            }
            VisualizerSettings.save();
            updateContextMenuState();
        });
    });
    
    // Initial state
    updateContextMenuState();
}

function showContextMenu(x, y) {
    const contextMenu = document.getElementById('visualizerContextMenu');
    if (!contextMenu) return;
    
    contextMenu.classList.remove('hidden');
    
    // Position menu
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Adjust position if menu would go off screen
    if (x + menuWidth > windowWidth) {
        x = windowWidth - menuWidth - 10;
    }
    if (y + menuHeight > windowHeight) {
        y = windowHeight - menuHeight - 10;
    }
    
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
    const contextMenu = document.getElementById('visualizerContextMenu');
    if (contextMenu) {
        contextMenu.classList.add('hidden');
    }
}

function updateContextMenuState() {
    const contextMenu = document.getElementById('visualizerContextMenu');
    if (!contextMenu) return;
    
    // Update analyzer selection
    contextMenu.querySelectorAll('[data-analyzer]').forEach(item => {
        if (item.dataset.analyzer === VisualizerSettings.currentAnalyzer) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // Update framerate selection
    contextMenu.querySelectorAll('[data-framerate]').forEach(item => {
        if (parseInt(item.dataset.framerate) === VisualizerSettings.currentFramerate) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // Update psychedelic toggle
    const psychedelicToggle = document.getElementById('psychedelicToggle');
    if (psychedelicToggle) {
        if (VisualizerSettings.psychedelicEnabled) {
            psychedelicToggle.classList.add('checked');
        } else {
            psychedelicToggle.classList.remove('checked');
        }
    }
    
    // Update visual effects
    contextMenu.querySelectorAll('[data-visual]').forEach(item => {
        const effect = item.dataset.visual;
        let isEnabled = false;
        if (effect === 'glow') isEnabled = VisualizerSettings.glowEnabled;
        if (effect === 'reflection') isEnabled = VisualizerSettings.reflectionEnabled;
        
        if (isEnabled) {
            item.classList.add('checked');
        } else {
            item.classList.remove('checked');
        }
    });
}

function setupVisualizer() {
    const canvas = elements.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    
    // Load settings
    VisualizerSettings.load();
    
    // Canvas boyutunu ayarla
    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        AnalyzerContainer.resize();
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Initialize Analyzer Container
    AnalyzerContainer.init(canvas);
    
    // Setup context menu
    setupVisualizerContextMenu();
    
    // C++ Audio Engine varsa ona bağlan, yoksa Web Audio API kullan
    if (useNativeAudio && window.aurivo && window.aurivo.audio) {
        console.log('🎵 C++ FFT verisi ile Analyzer Container başlatılıyor...');
        drawNativeVisualizer(ctx, canvas);
    } else {
        // Web Audio API setup (fallback)
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            
            const source = audioContext.createMediaElementSource(elements.audio);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            drawVisualizer(ctx, canvas);
        } catch (e) {
            console.log('Visualizer başlatılamadı:', e);
            drawFallbackVisualizer(ctx, canvas);
        }
    }
}

// C++ Audio Engine FFT verisi ile visualizer
async function drawNativeVisualizer(ctx, canvas) {
    setTimeout(() => drawNativeVisualizer(ctx, canvas), 1000 / VisualizerSettings.currentFramerate);
    
    const isPlaying = state.isPlaying && state.activeMedia === 'audio';
    
    try {
        // C++ engine'den spectrum verisini al - doğru API yolu
        let spectrumData = null;
        if (isPlaying && window.aurivo && window.aurivo.audio && window.aurivo.audio.spectrum) {
            spectrumData = await window.aurivo.audio.spectrum.getBands(128);
        }
        
        // Analyzer Container ile çiz
        AnalyzerContainer.analyze(spectrumData, isPlaying);
    } catch (e) {
        // Hata durumunda idle bars çiz
        AnalyzerContainer.analyze(null, false);
    }
}

function drawVisualizer(ctx, canvas) {
    setTimeout(() => drawVisualizer(ctx, canvas), 1000 / VisualizerSettings.currentFramerate);
    
    if (!analyser) return;
    
    analyser.getByteFrequencyData(dataArray);
    
    // Convert Uint8Array to normalized array
    const normalizedData = Array.from(dataArray).map(v => v / 255);
    
    // Analyzer Container ile çiz
    AnalyzerContainer.analyze(normalizedData, state.isPlaying);
}

function drawFallbackVisualizer(ctx, canvas) {
    // Basit animasyon (audio context yoksa)
    function animate() {
        setTimeout(animate, 1000 / VisualizerSettings.currentFramerate);
        
        // Fake spectrum data for animation
        const fakeData = state.isPlaying
            ? Array.from({ length: 64 }, (_, i) => 
                (Math.sin(Date.now() / 200 + i * 0.3) * 0.5 + 0.5) * 0.6)
            : null;
        
        AnalyzerContainer.analyze(fakeData, state.isPlaying);
    }
    
    animate();
}

// ============================================
// RAINBOW SLIDER - IŞIK DÖNGÜSÜ EFEKTİ
// ============================================
let rainbowHue = 0;
let rainbowAnimationId = null;

function initializeRainbowSliders() {
    // Başlangıç değerleriyle slider'ları güncelle
    updateRainbowSlider(elements.seekSlider, 0);
    updateRainbowSlider(elements.volumeSlider, state.volume);
    
    // Rainbow animasyonu başlat
    startRainbowAnimation();
}

function startRainbowAnimation() {
    function animateRainbow() {
        rainbowHue = (rainbowHue + 1) % 360;
        
        // Seek slider - mevcut değeriyle güncelle
        const seekPercent = (elements.seekSlider.value / elements.seekSlider.max) * 100;
        updateRainbowSliderColors(elements.seekSlider, seekPercent);
        
        // Volume slider - mevcut değeriyle güncelle
        const volumePercent = elements.volumeSlider.value;
        updateRainbowSliderColors(elements.volumeSlider, volumePercent);
        
        rainbowAnimationId = requestAnimationFrame(animateRainbow);
    }
    animateRainbow();
}

function updateRainbowSlider(slider, percent) {
    updateRainbowSliderColors(slider, percent);
}

function updateRainbowSliderColors(slider, percent) {
    // Gökkuşağı renkleri - hue değerine göre dönen
    const colors = [
        `hsl(${(rainbowHue + 0) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 40) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 80) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 120) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 160) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 200) % 360}, 100%, 50%)`
    ];
    
    // SOL TARAF (0'dan percent'e kadar) = Işiklı rainbow
    // SAĞ TARAF (percent'den 100'e kadar) = Yarı saydam koyu
    const emptyColor = 'rgba(40, 40, 40, 0.25)';
    
    // Background: Sol kısım renkli gradient, sağ kısım saydam
    const trackBackground = `linear-gradient(to right, 
        ${colors[0]} 0%, 
        ${colors[1]} ${percent * 0.2}%, 
        ${colors[2]} ${percent * 0.4}%, 
        ${colors[3]} ${percent * 0.6}%, 
        ${colors[4]} ${percent * 0.8}%, 
        ${colors[5]} ${percent}%, 
        ${emptyColor} ${percent}%, 
        ${emptyColor} 100%)`;
    
    slider.style.background = trackBackground;
    
    // Thumb için parlak renk
    const thumbColor = `hsl(${(rainbowHue + 60) % 360}, 100%, 60%)`;
    const thumbGlow = `hsl(${(rainbowHue + 60) % 360}, 100%, 50%)`;
    slider.style.setProperty('--thumb-color', thumbColor);
    slider.style.setProperty('--thumb-glow', thumbGlow);
}

// ============================================
// 32-BAND EQUALIZER CONTROLLER
// Professional Audio EQ System
// ============================================

const EQController = {
    // 32 band frequencies (20Hz - 20kHz logarithmic)
    frequencies: [
        20, 25, 31, 40, 50, 63, 80, 100,
        125, 160, 200, 250, 315, 400, 500, 630,
        800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
        5000, 6300, 8000, 10000, 12500, 16000, 18000, 20000
    ],
    
    // Current band values (dB)
    bands: new Array(32).fill(0),
    
    // Settings
    enabled: true,
    autoGain: true,
    preamp: 0,
    masterVolume: 100,
    bassBoost: 0,
    
    // UI Elements
    elements: {
        modal: null,
        bandsContainer: null,
        sliders: [],
        preampSlider: null,
        volumeSlider: null,
        bassKnob: null,
        presetSelect: null,
        enableToggle: null,
        autoGainToggle: null,
        clippingLed: null,
        levelBars: []
    },
    
    // Factory Presets - Doğru frekans aralıklarına göre ayarlanmış
    // Frequencies: [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1k, 1.25k, 1.6k, 2k, 2.5k, 3.15k, 4k, 5k, 6.3k, 8k, 10k, 12.5k, 16k, 18k, 20k]
    factoryPresets: {
        flat: { 
            name: 'Flat (Düz)', 
            description: 'Tüm bantlar nötr',
            bands: new Array(32).fill(0), 
            bassBoost: 0,
            preamp: 0
        },
        bass_boost: {
            name: 'Bass Boost',
            description: '20-100Hz +6dB, 125-250Hz +3dB',
            // 20Hz-100Hz: +6dB (index 0-7), 125Hz-250Hz: +3dB (index 8-11), rest: 0
            bands: [6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            bassBoost: 50,
            preamp: -2
        },
        treble_boost: {
            name: 'Treble Boost',
            description: '4kHz-20kHz +5dB',
            // 4kHz-20kHz: +5dB (index 23-31)
            bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5],
            bassBoost: 0,
            preamp: -1
        },
        rock: {
            name: 'Rock',
            description: 'Bass +4dB, mid-low -2dB, mid-high +3dB, treble +4dB',
            // Bass (20-100Hz): +4, mid-low (125-500Hz): -2, mid-high (630Hz-2kHz): +3, treble (2.5k+): +4
            bands: [4, 4, 4, 4, 4, 4, 4, 4, -2, -2, -2, -2, -2, -2, -2, -2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3],
            bassBoost: 25,
            preamp: -1
        },
        pop: {
            name: 'Pop',
            description: 'Bass +3dB, mid +2dB, treble +2dB',
            // Bass (20-100Hz): +3, mid (125Hz-4kHz): +2, treble (5k+): +2
            bands: [3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1],
            bassBoost: 20,
            preamp: -1
        },
        classical: {
            name: 'Klasik',
            description: 'Doğal akustik: Bass 0dB, mid +2dB, treble +3dB',
            // Bass (20-100Hz): 0, mid (125Hz-2kHz): +2, treble (2.5k+): +3
            bands: [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2],
            bassBoost: 0,
            preamp: 0
        },
        jazz: {
            name: 'Jazz',
            description: 'Bass +2dB, mid-low +3dB, mid-high -1dB, treble +2dB',
            // Bass (20-100Hz): +2, mid-low (125-500Hz): +3, mid-high (630Hz-2kHz): -1, treble (2.5k+): +2
            bands: [2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, -1, -1, -1, -1, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
            bassBoost: 15,
            preamp: 0
        },
        vocal: {
            name: 'Vokal',
            description: '200Hz-2kHz +3dB (insan sesi frekansları)',
            // 200Hz-2kHz: +3dB (index 10-20)
            bands: [-2, -2, -2, -2, -1, -1, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0, -1, -1, -1, -2, -2, -2, -2, -2],
            bassBoost: 5,
            preamp: 0
        },
        electronic: {
            name: 'Elektronik',
            description: 'Güçlü bass, parlak treble',
            bands: [6, 6, 5, 5, 4, 4, 3, 2, 0, 0, 0, 1, 1, 2, 2, 1, 0, 0, 0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 4, 4],
            bassBoost: 60,
            preamp: -2
        },
        hiphop: {
            name: 'Hip-Hop',
            description: 'Derin bass, net vokal',
            bands: [7, 6, 6, 5, 5, 4, 3, 2, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2],
            bassBoost: 65,
            preamp: -2
        },
        loudness: {
            name: 'Loudness',
            description: 'Düşük seslerde bass ve treble artışı',
            bands: [5, 5, 4, 4, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 5, 5, 5, 5, 4, 4],
            bassBoost: 40,
            preamp: -1
        },
        acoustic: {
            name: 'Akustik',
            description: 'Doğal enstrüman sesleri',
            bands: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 2, 2, 2, 1, 1],
            bassBoost: 10,
            preamp: 0
        },
        spoken_word: {
            name: 'Konuşma/Podcast',
            description: 'Net konuşma, azaltılmış bass',
            bands: [-4, -4, -3, -3, -2, -2, -1, 0, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 3, 2, 1, 0, 0, -1, -1, -2, -2, -3, -3, -3, -3, -3],
            bassBoost: 0,
            preamp: 2
        }
    },
    
    // Custom presets (localStorage'dan yüklenir)
    customPresets: {},
    
    // Current preset tracking
    currentPreset: 'flat',
    
    // Legacy alias for backward compatibility
    get presets() {
        return { ...this.factoryPresets, ...this.customPresets };
    },
    
    // Initialize EQ controller
    init() {
        this.cacheElements();
        this.loadCustomPresets(); // Load custom presets first
        this.createBandSliders();
        this.populatePresetSelect(); // Populate dropdown
        this.setupEventListeners();
        this.setupPresetManagerListeners();
        this.loadSettings();
        this.initKnobs();
        console.log('🎚️ EQ Controller initialized');
    },
    
    // Cache DOM elements
    cacheElements() {
        this.elements.modal = document.getElementById('eqModal');
        this.elements.bandsContainer = document.getElementById('eqBands');
        this.elements.preampSlider = document.getElementById('preampSlider');
        this.elements.volumeSlider = document.getElementById('masterVolumeSlider');
        this.elements.presetSelect = document.getElementById('eqPresetSelect');
        this.elements.enableToggle = document.getElementById('eqEnableToggle');
        this.elements.autoGainToggle = document.getElementById('autoGainToggle');
        this.elements.clippingLed = document.querySelector('.clip-led');
        this.elements.levelBars = document.querySelectorAll('.level-bar');
        this.elements.bassKnobContainer = document.getElementById('bassBoostKnob');
        this.elements.bassKnobCanvas = document.getElementById('bassBoostCanvas');
        this.elements.bassKnobValue = document.getElementById('bassBoostValue');
        this.elements.eqButton = document.querySelector('.eq-btn-player');
        
        // Preset manager elements
        this.elements.savePresetModal = document.getElementById('savePresetModal');
        this.elements.presetManagerModal = document.getElementById('presetManagerModal');
        this.elements.presetNameInput = document.getElementById('presetName');
        this.elements.presetDescInput = document.getElementById('presetDescription');
        this.elements.factoryPresetList = document.getElementById('factoryPresetList');
        this.elements.customPresetList = document.getElementById('customPresetList');
    },
    
    // Load custom presets from localStorage
    loadCustomPresets() {
        try {
            const saved = localStorage.getItem('aurivo_custom_presets');
            if (saved) {
                this.customPresets = JSON.parse(saved);
                console.log(`📂 ${Object.keys(this.customPresets).length} özel preset yüklendi`);
            }
        } catch (e) {
            console.error('Custom presets yüklenemedi:', e);
            this.customPresets = {};
        }
    },
    
    // Save custom presets to localStorage
    saveCustomPresets() {
        try {
            localStorage.setItem('aurivo_custom_presets', JSON.stringify(this.customPresets));
        } catch (e) {
            console.error('Custom presets kaydedilemedi:', e);
        }
    },
    
    // Populate preset select dropdown
    populatePresetSelect() {
        if (!this.elements.presetSelect) return;
        
        this.elements.presetSelect.innerHTML = '';
        
        // Factory presets group
        const factoryGroup = document.createElement('optgroup');
        factoryGroup.label = '🏭 Fabrika Presetleri';
        
        Object.entries(this.factoryPresets).forEach(([key, preset]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = preset.name;
            option.title = preset.description || '';
            factoryGroup.appendChild(option);
        });
        
        this.elements.presetSelect.appendChild(factoryGroup);
        
        // Custom presets group (if any)
        const customKeys = Object.keys(this.customPresets);
        if (customKeys.length > 0) {
            const customGroup = document.createElement('optgroup');
            customGroup.label = '⭐ Özel Presetler';
            
            customKeys.forEach(key => {
                const preset = this.customPresets[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = preset.name;
                option.title = preset.description || '';
                option.dataset.custom = 'true';
                customGroup.appendChild(option);
            });
            
            this.elements.presetSelect.appendChild(customGroup);
        }
        
        // Set current selection
        if (this.currentPreset) {
            this.elements.presetSelect.value = this.currentPreset;
        }
    },
    
    // Create 32 band sliders
    createBandSliders() {
        if (!this.elements.bandsContainer) return;
        
        this.elements.bandsContainer.innerHTML = '';
        this.elements.sliders = [];
        
        this.frequencies.forEach((freq, index) => {
            const band = document.createElement('div');
            band.className = 'eq-band';
            band.dataset.index = index;
            
            // Value display
            const valueDiv = document.createElement('div');
            valueDiv.className = 'eq-band-value';
            valueDiv.textContent = '0';
            
            // Slider
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'eq-band-slider';
            slider.min = -12;
            slider.max = 12;
            slider.step = 0.5;
            slider.value = this.bands[index];
            slider.dataset.index = index;
            
            // Frequency label
            const freqLabel = document.createElement('div');
            freqLabel.className = 'eq-band-freq';
            freqLabel.textContent = this.formatFrequency(freq);
            
            band.appendChild(valueDiv);
            band.appendChild(slider);
            band.appendChild(freqLabel);
            this.elements.bandsContainer.appendChild(band);
            
            this.elements.sliders.push({ slider, valueDiv, band });
        });
    },
    
    // Format frequency for display
    formatFrequency(freq) {
        if (freq >= 1000) {
            return (freq / 1000).toFixed(freq >= 10000 ? 0 : 1) + 'k';
        }
        return freq.toString();
    },
    
    // Setup event listeners
    setupEventListeners() {
        // EQ button to open Sound Effects window
        if (this.elements.eqButton) {
            this.elements.eqButton.addEventListener('click', () => {
                // Yeni Ses Efektleri penceresini aç
                if (window.aurivo && window.aurivo.soundEffects) {
                    window.aurivo.soundEffects.openWindow();
                    console.log('🎛️ Ses Efektleri penceresi açılıyor...');
                } else {
                    // Fallback: Eski modal'ı aç
                    this.toggleModal();
                }
            });
        }
        
        // Band sliders
        this.elements.sliders.forEach(({ slider, valueDiv, band }, index) => {
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setBand(index, value);
                valueDiv.textContent = value > 0 ? `+${value}` : value;
                
                // Update band class
                band.classList.remove('positive', 'negative');
                if (value > 0) band.classList.add('positive');
                if (value < 0) band.classList.add('negative');
            });
            
            slider.addEventListener('mouseenter', () => band.classList.add('active'));
            slider.addEventListener('mouseleave', () => band.classList.remove('active'));
            
            // Double click to reset
            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                this.setBand(index, 0);
                valueDiv.textContent = '0';
                band.classList.remove('positive', 'negative');
            });
        });
        
        // Preamp slider
        if (this.elements.preampSlider) {
            this.elements.preampSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setPreamp(value);
                const valueDisplay = document.getElementById('preampValue');
                if (valueDisplay) {
                    valueDisplay.textContent = (value > 0 ? '+' : '') + value + ' dB';
                }
            });
        }
        
        // Master volume slider
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setMasterVolume(value);
                const valueDisplay = document.getElementById('masterVolumeValue');
                if (valueDisplay) {
                    valueDisplay.textContent = value + '%';
                }
            });
        }
        
        // Preset select
        if (this.elements.presetSelect) {
            this.elements.presetSelect.addEventListener('change', (e) => {
                this.applyPreset(e.target.value);
            });
        }
        
        // Enable toggle
        if (this.elements.enableToggle) {
            this.elements.enableToggle.addEventListener('change', (e) => {
                this.enabled = e.target.checked;
                this.updateEQState();
            });
        }
        
        // Auto-gain toggle
        if (this.elements.autoGainToggle) {
            this.elements.autoGainToggle.addEventListener('change', (e) => {
                this.autoGain = e.target.checked;
                this.updateAutoGain();
            });
        }
        
        // Reset button
        const resetBtn = document.getElementById('resetEQBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetAll());
        }
        
        // Save preset button (footer)
        const savePresetBtn = document.getElementById('eqSavePreset');
        if (savePresetBtn) {
            savePresetBtn.addEventListener('click', () => this.openSavePresetModal());
        }
        
        // Manage presets button
        const managePresetsBtn = document.getElementById('eqManagePresets');
        if (managePresetsBtn) {
            managePresetsBtn.addEventListener('click', () => this.openPresetManager());
        }
        
        // Close button
        const closeBtn = document.getElementById('closeEQ');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }
        
        // Close button (footer)
        const closeFooterBtn = document.getElementById('eqClose');
        if (closeFooterBtn) {
            closeFooterBtn.addEventListener('click', () => this.closeModal());
        }
        
        // Close on backdrop click
        if (this.elements.modal) {
            this.elements.modal.addEventListener('click', (e) => {
                if (e.target === this.elements.modal) {
                    this.closeModal();
                }
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.elements.savePresetModal?.classList.contains('active')) {
                    this.closeSavePresetModal();
                } else if (this.elements.presetManagerModal?.classList.contains('active')) {
                    this.closePresetManager();
                } else if (this.elements.modal?.classList.contains('active')) {
                    this.closeModal();
                }
            }
            if (e.key === 'e' && e.ctrlKey) {
                e.preventDefault();
                this.toggleModal();
            }
        });
    },
    
    // Setup preset manager event listeners
    setupPresetManagerListeners() {
        // Save preset modal
        const closeSavePreset = document.getElementById('closeSavePreset');
        if (closeSavePreset) {
            closeSavePreset.addEventListener('click', () => this.closeSavePresetModal());
        }
        
        const cancelSavePreset = document.getElementById('cancelSavePreset');
        if (cancelSavePreset) {
            cancelSavePreset.addEventListener('click', () => this.closeSavePresetModal());
        }
        
        const confirmSavePreset = document.getElementById('confirmSavePreset');
        if (confirmSavePreset) {
            confirmSavePreset.addEventListener('click', () => this.saveCustomPreset());
        }
        
        // Preset manager modal
        const closePresetManager = document.getElementById('closePresetManager');
        if (closePresetManager) {
            closePresetManager.addEventListener('click', () => this.closePresetManager());
        }
        
        const closePresetManagerBtn = document.getElementById('closePresetManagerBtn');
        if (closePresetManagerBtn) {
            closePresetManagerBtn.addEventListener('click', () => this.closePresetManager());
        }
        
        // Tab switching
        document.querySelectorAll('.preset-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.tab;
                this.switchPresetTab(targetTab);
            });
        });
        
        // Export/Import buttons
        const exportBtn = document.getElementById('exportPresets');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportPresets());
        }
        
        const importBtn = document.getElementById('importPresets');
        if (importBtn) {
            importBtn.addEventListener('click', () => document.getElementById('importFile')?.click());
        }
        
        const importFile = document.getElementById('importFile');
        if (importFile) {
            importFile.addEventListener('change', (e) => this.importPresets(e));
        }
        
        // Modal backdrop clicks
        if (this.elements.savePresetModal) {
            this.elements.savePresetModal.addEventListener('click', (e) => {
                if (e.target === this.elements.savePresetModal) {
                    this.closeSavePresetModal();
                }
            });
        }
        
        if (this.elements.presetManagerModal) {
            this.elements.presetManagerModal.addEventListener('click', (e) => {
                if (e.target === this.elements.presetManagerModal) {
                    this.closePresetManager();
                }
            });
        }
    },
    
    // Initialize knobs (bass boost, etc.)
    initKnobs() {
        if (!this.elements.bassKnobCanvas) {
            console.log('Bass knob canvas bulunamadı');
            return;
        }
        
        const canvas = this.elements.bassKnobCanvas;
        if (typeof canvas.getContext !== 'function') {
            console.error('bassKnobCanvas geçerli bir canvas değil:', canvas);
            return;
        }
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('Canvas context alınamadı');
            return;
        }
        
        // Draw initial state
        this.drawKnob(ctx, canvas, this.bassBoost / 100);
        
        // Knob interaction
        let isDragging = false;
        let startY = 0;
        let startValue = 0;
        
        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startValue = this.bassBoost;
            canvas.style.cursor = 'grabbing';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const delta = (startY - e.clientY) * 0.5;
            let newValue = Math.max(0, Math.min(100, startValue + delta));
            this.setBassBoost(newValue);
            this.drawKnob(ctx, canvas, newValue / 100);
            
            if (this.elements.bassKnobValue) {
                this.elements.bassKnobValue.textContent = Math.round(newValue) + '%';
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                canvas.style.cursor = 'pointer';
            }
        });
        
        // Scroll to adjust
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -2 : 2;
            let newValue = Math.max(0, Math.min(100, this.bassBoost + delta));
            this.setBassBoost(newValue);
            this.drawKnob(ctx, canvas, newValue / 100);
            
            if (this.elements.bassKnobValue) {
                this.elements.bassKnobValue.textContent = Math.round(newValue) + '%';
            }
        });
    },
    
    // Draw rotary knob
    drawKnob(ctx, canvas, value) {
        const size = canvas.width;
        const center = size / 2;
        const radius = size * 0.35;
        
        // Clear
        ctx.clearRect(0, 0, size, size);
        
        // Background ring
        ctx.beginPath();
        ctx.arc(center, center, radius + 8, 0.75 * Math.PI, 2.25 * Math.PI);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        // Value arc
        const startAngle = 0.75 * Math.PI;
        const endAngle = startAngle + (1.5 * Math.PI * value);
        
        const gradient = ctx.createLinearGradient(0, size, size, 0);
        gradient.addColorStop(0, '#00d9ff');
        gradient.addColorStop(0.5, '#00aaff');
        gradient.addColorStop(1, '#0066ff');
        
        ctx.beginPath();
        ctx.arc(center, center, radius + 8, startAngle, endAngle);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        // Knob body
        const knobGradient = ctx.createRadialGradient(
            center - 5, center - 5, 0,
            center, center, radius
        );
        knobGradient.addColorStop(0, '#3a3a4a');
        knobGradient.addColorStop(0.5, '#2a2a3a');
        knobGradient.addColorStop(1, '#1a1a2a');
        
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = knobGradient;
        ctx.fill();
        
        // Knob border
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Indicator line
        const angle = startAngle + (1.5 * Math.PI * value);
        const lineStart = radius * 0.4;
        const lineEnd = radius * 0.8;
        
        ctx.beginPath();
        ctx.moveTo(
            center + Math.cos(angle) * lineStart,
            center + Math.sin(angle) * lineStart
        );
        ctx.lineTo(
            center + Math.cos(angle) * lineEnd,
            center + Math.sin(angle) * lineEnd
        );
        ctx.strokeStyle = '#00d9ff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        // Glow effect
        ctx.shadowColor = '#00d9ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(
            center + Math.cos(angle) * lineEnd,
            center + Math.sin(angle) * lineEnd,
            3, 0, Math.PI * 2
        );
        ctx.fillStyle = '#00d9ff';
        ctx.fill();
        ctx.shadowBlur = 0;
    },
    
    // Set individual band
    setBand(index, value) {
        this.bands[index] = value;
        
        // Call native audio if available
        if (window.audioAPI?.eq?.setBand) {
            try {
                window.audioAPI.eq.setBand(index, value);
            } catch (e) {
                console.warn('Native EQ not available:', e);
            }
        }
    },
    
    // Set preamp
    setPreamp(value) {
        this.preamp = value;
        if (window.audioAPI?.preamp?.set) {
            try {
                window.audioAPI.preamp.set(value);
            } catch (e) {
                console.warn('Native preamp not available:', e);
            }
        }
    },
    
    // Set master volume
    setMasterVolume(value) {
        this.masterVolume = value;
        if (window.audioAPI?.setMasterVolume) {
            try {
                window.audioAPI.setMasterVolume(value);
            } catch (e) {
                console.warn('Native volume not available:', e);
            }
        }
    },
    
    // Set bass boost
    setBassBoost(value) {
        this.bassBoost = value;
        if (window.audioAPI?.bass?.setBoost) {
            try {
                window.audioAPI.bass.setBoost(value);
            } catch (e) {
                console.warn('Native bass boost not available:', e);
            }
        }
    },
    
    // Apply preset
    applyPreset(presetKey) {
        const preset = this.presets[presetKey];
        if (!preset) return;
        
        // Apply band values
        preset.bands.forEach((value, index) => {
            this.bands[index] = value;
            
            const sliderData = this.elements.sliders[index];
            if (sliderData) {
                sliderData.slider.value = value;
                sliderData.valueDiv.textContent = value > 0 ? `+${value}` : value;
                
                sliderData.band.classList.remove('positive', 'negative');
                if (value > 0) sliderData.band.classList.add('positive');
                if (value < 0) sliderData.band.classList.add('negative');
            }
            
            this.setBand(index, value);
        });
        
        // Apply bass boost
        this.setBassBoost(preset.bassBoost);
        if (this.elements.bassKnobCanvas) {
            const ctx = this.elements.bassKnobCanvas.getContext('2d');
            this.drawKnob(ctx, this.elements.bassKnobCanvas, preset.bassBoost / 100);
        }
        const bassValue = document.getElementById('bassBoostValue');
        if (bassValue) bassValue.textContent = preset.bassBoost + '%';
        
        console.log(`🎵 Applied preset: ${preset.name}`);
    },
    
    // Reset all to flat
    resetAll() {
        // Reset bands
        this.bands = new Array(32).fill(0);
        this.elements.sliders.forEach(({ slider, valueDiv, band }) => {
            slider.value = 0;
            valueDiv.textContent = '0';
            band.classList.remove('positive', 'negative');
        });
        
        // Reset sliders
        if (this.elements.preampSlider) {
            this.elements.preampSlider.value = 0;
            document.getElementById('preampValue').textContent = '0 dB';
        }
        
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.value = 100;
            document.getElementById('masterVolumeValue').textContent = '100%';
        }
        
        // Reset bass
        this.bassBoost = 0;
        if (this.elements.bassKnobCanvas) {
            const ctx = this.elements.bassKnobCanvas.getContext('2d');
            this.drawKnob(ctx, this.elements.bassKnobCanvas, 0);
        }
        document.getElementById('bassBoostValue').textContent = '0%';
        
        // Reset preset select
        if (this.elements.presetSelect) {
            this.elements.presetSelect.value = 'flat';
        }
        
        // Apply to native
        this.bands.forEach((v, i) => this.setBand(i, 0));
        this.setPreamp(0);
        this.setMasterVolume(100);
        this.setBassBoost(0);
        
        console.log('🎚️ EQ reset to flat');
    },
    
    // Update EQ enabled state
    updateEQState() {
        if (window.audioAPI?.eq?.setEnabled) {
            try {
                window.audioAPI.eq.setEnabled(this.enabled);
            } catch (e) {
                console.warn('Could not set EQ state:', e);
            }
        }
        
        if (this.elements.eqButton) {
            this.elements.eqButton.classList.toggle('active', this.enabled);
        }
    },
    
    // Update auto-gain state
    updateAutoGain() {
        if (window.audioAPI?.setAutoGain) {
            try {
                window.audioAPI.setAutoGain(this.autoGain);
            } catch (e) {
                console.warn('Could not set auto-gain:', e);
            }
        }
    },
    
    // Toggle modal
    toggleModal() {
        if (this.elements.modal?.classList.contains('active')) {
            this.closeModal();
        } else {
            this.openModal();
        }
    },
    
    // Open modal
    openModal() {
        if (this.elements.modal) {
            this.elements.modal.classList.remove('hidden');
            this.elements.modal.classList.add('active');
            // Initialize knob with current value
            if (this.elements.bassKnobCanvas) {
                const ctx = this.elements.bassKnobCanvas.getContext('2d');
                this.drawKnob(ctx, this.elements.bassKnobCanvas, this.bassBoost / 100);
            }
        }
    },
    
    // Close modal
    closeModal() {
        if (this.elements.modal) {
            this.elements.modal.classList.remove('active');
            this.elements.modal.classList.add('hidden');
        }
    },
    
    // Save settings to localStorage
    saveSettings() {
        const settings = {
            bands: this.bands,
            preamp: this.preamp,
            masterVolume: this.masterVolume,
            bassBoost: this.bassBoost,
            enabled: this.enabled,
            autoGain: this.autoGain
        };
        
        try {
            localStorage.setItem('aurivo_eq_settings', JSON.stringify(settings));
            console.log('💾 EQ settings saved');
            
            // Show notification
            showNotification('EQ ayarları kaydedildi', 'success');
        } catch (e) {
            console.error('Failed to save EQ settings:', e);
        }
    },
    
    // Load settings from localStorage
    loadSettings() {
        try {
            const saved = localStorage.getItem('aurivo_eq_settings');
            if (!saved) return;
            
            const settings = JSON.parse(saved);
            
            // Apply bands
            if (settings.bands) {
                settings.bands.forEach((value, index) => {
                    this.bands[index] = value;
                    this.setBand(index, value);
                    
                    const sliderData = this.elements.sliders[index];
                    if (sliderData) {
                        sliderData.slider.value = value;
                        sliderData.valueDiv.textContent = value > 0 ? `+${value}` : value;
                        
                        sliderData.band.classList.remove('positive', 'negative');
                        if (value > 0) sliderData.band.classList.add('positive');
                        if (value < 0) sliderData.band.classList.add('negative');
                    }
                });
            }
            
            // Apply other settings
            if (settings.preamp !== undefined) {
                this.preamp = settings.preamp;
                this.setPreamp(settings.preamp);
                if (this.elements.preampSlider) {
                    this.elements.preampSlider.value = settings.preamp;
                    document.getElementById('preampValue').textContent = 
                        (settings.preamp > 0 ? '+' : '') + settings.preamp + ' dB';
                }
            }
            
            if (settings.masterVolume !== undefined) {
                this.masterVolume = settings.masterVolume;
                this.setMasterVolume(settings.masterVolume);
                if (this.elements.volumeSlider) {
                    this.elements.volumeSlider.value = settings.masterVolume;
                    document.getElementById('masterVolumeValue').textContent = settings.masterVolume + '%';
                }
            }
            
            if (settings.bassBoost !== undefined) {
                this.bassBoost = settings.bassBoost;
                this.setBassBoost(settings.bassBoost);
                document.getElementById('bassBoostValue').textContent = settings.bassBoost + '%';
            }
            
            if (settings.enabled !== undefined) {
                this.enabled = settings.enabled;
                if (this.elements.enableToggle) {
                    this.elements.enableToggle.checked = settings.enabled;
                }
                this.updateEQState();
            }
            
            if (settings.autoGain !== undefined) {
                this.autoGain = settings.autoGain;
                if (this.elements.autoGainToggle) {
                    this.elements.autoGainToggle.checked = settings.autoGain;
                }
            }
            
            console.log('📂 EQ settings loaded');
        } catch (e) {
            console.error('Failed to load EQ settings:', e);
        }
    },
    
    // Update level meters (call from audio loop)
    updateLevels(leftLevel, rightLevel) {
        const bars = this.elements.levelBars;
        if (bars.length >= 2) {
            bars[0].style.setProperty('--level', `${leftLevel * 100}%`);
            bars[1].style.setProperty('--level', `${rightLevel * 100}%`);
        }
        
        // Check clipping
        if (this.elements.clippingLed) {
            const isClipping = leftLevel > 0.95 || rightLevel > 0.95;
            this.elements.clippingLed.classList.toggle('active', isClipping);
        }
    },
    
    // ============================================
    // PRESET MANAGER FUNCTIONS
    // ============================================
    
    // Open save preset modal
    openSavePresetModal() {
        if (!this.elements.savePresetModal) return;
        
        // Update preview
        this.updatePresetPreview();
        
        // Clear input fields
        if (this.elements.presetNameInput) {
            this.elements.presetNameInput.value = '';
            this.elements.presetNameInput.focus();
        }
        if (this.elements.presetDescInput) {
            this.elements.presetDescInput.value = '';
        }
        
        this.elements.savePresetModal.classList.add('active');
    },
    
    // Close save preset modal
    closeSavePresetModal() {
        if (this.elements.savePresetModal) {
            this.elements.savePresetModal.classList.remove('active');
        }
    },
    
    // Update preset preview
    updatePresetPreview() {
        // Bass boost value
        const bassPreview = document.getElementById('previewBassBoost');
        if (bassPreview) {
            bassPreview.textContent = Math.round(this.bassBoost) + '%';
        }
        
        // Preamp value
        const preampPreview = document.getElementById('previewPreamp');
        if (preampPreview) {
            const val = this.preamp;
            preampPreview.textContent = (val > 0 ? '+' : '') + val + ' dB';
        }
        
        // Active bands count
        const activeBandsPreview = document.getElementById('previewActiveBands');
        if (activeBandsPreview) {
            const activeBands = this.bands.filter(b => b !== 0).length;
            activeBandsPreview.textContent = `${activeBands}/32`;
        }
        
        // Mini EQ preview
        this.drawMiniEqPreview();
    },
    
    // Draw mini EQ preview
    drawMiniEqPreview() {
        const container = document.getElementById('miniEqPreview');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.bands.forEach((value, index) => {
            const bar = document.createElement('div');
            bar.className = 'mini-eq-bar';
            
            const height = Math.abs(value) * 4; // Max 48px for ±12dB
            const isPositive = value >= 0;
            
            bar.style.cssText = `
                width: 6px;
                height: ${height}px;
                background: ${isPositive ? 'var(--accent-primary)' : '#ff6b6b'};
                border-radius: 2px;
                position: absolute;
                left: ${index * 8}px;
                ${isPositive ? 'bottom: 50%' : 'top: 50%'};
                opacity: ${value === 0 ? 0.2 : 0.8};
            `;
            
            container.appendChild(bar);
        });
    },
    
    // Save custom preset
    saveCustomPreset() {
        const name = this.elements.presetNameInput?.value.trim();
        if (!name) {
            showNotification('Lütfen preset adı girin', 'error');
            this.elements.presetNameInput?.focus();
            return;
        }
        
        // Generate unique key
        const key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
        
        // Create preset object
        const preset = {
            name: name,
            description: this.elements.presetDescInput?.value.trim() || '',
            bands: [...this.bands],
            bassBoost: this.bassBoost,
            preamp: this.preamp,
            createdAt: new Date().toISOString(),
            isCustom: true
        };
        
        // Save to custom presets
        this.customPresets[key] = preset;
        this.saveCustomPresets();
        
        // Update dropdown
        this.populatePresetSelect();
        
        // Select the new preset
        if (this.elements.presetSelect) {
            this.elements.presetSelect.value = key;
        }
        this.currentPreset = key;
        
        // Close modal
        this.closeSavePresetModal();
        
        showNotification(`"${name}" preset kaydedildi`, 'success');
        console.log(`💾 Custom preset saved: ${name}`);
    },
    
    // Open preset manager
    openPresetManager() {
        if (!this.elements.presetManagerModal) return;
        
        // Populate lists
        this.populateFactoryPresetList();
        this.populateCustomPresetList();
        
        // Switch to factory tab by default
        this.switchPresetTab('factory');
        
        this.elements.presetManagerModal.classList.add('active');
    },
    
    // Close preset manager
    closePresetManager() {
        if (this.elements.presetManagerModal) {
            this.elements.presetManagerModal.classList.remove('active');
        }
    },
    
    // Switch preset tab
    switchPresetTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.preset-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        
        // Update lists
        const factoryList = document.getElementById('factoryPresetList');
        const customList = document.getElementById('customPresetList');
        
        if (factoryList) factoryList.classList.toggle('hidden', tab !== 'factory');
        if (customList) customList.classList.toggle('hidden', tab !== 'custom');
    },
    
    // Populate factory preset list
    populateFactoryPresetList() {
        const container = this.elements.factoryPresetList;
        if (!container) return;
        
        container.innerHTML = '';
        
        Object.entries(this.factoryPresets).forEach(([key, preset]) => {
            const item = this.createPresetListItem(key, preset, false);
            container.appendChild(item);
        });
    },
    
    // Populate custom preset list
    populateCustomPresetList() {
        const container = this.elements.customPresetList;
        if (!container) return;
        
        const customKeys = Object.keys(this.customPresets);
        const emptyState = document.getElementById('noCustomPresets');
        
        // Clear existing items (except empty state)
        container.querySelectorAll('.preset-list-item').forEach(el => el.remove());
        
        if (customKeys.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }
        
        if (emptyState) emptyState.classList.add('hidden');
        
        customKeys.forEach(key => {
            const preset = this.customPresets[key];
            const item = this.createPresetListItem(key, preset, true);
            container.appendChild(item);
        });
    },
    
    // Create preset list item
    createPresetListItem(key, preset, isCustom) {
        const item = document.createElement('div');
        item.className = 'preset-list-item';
        item.dataset.key = key;
        
        // Calculate stats
        const activeBands = preset.bands.filter(b => b !== 0).length;
        const avgGain = preset.bands.reduce((a, b) => a + b, 0) / preset.bands.length;
        
        item.innerHTML = `
            <div class="preset-item-info">
                <div class="preset-item-name">${preset.name}</div>
                <div class="preset-item-desc">${preset.description || 'Açıklama yok'}</div>
                <div class="preset-item-stats">
                    <span>Bass: ${preset.bassBoost}%</span>
                    <span>Aktif: ${activeBands}/32</span>
                    ${preset.createdAt ? `<span>${new Date(preset.createdAt).toLocaleDateString('tr-TR')}</span>` : ''}
                </div>
            </div>
            <div class="preset-item-actions">
                <button class="preset-action-btn apply-btn" title="Uygula">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                </button>
                ${isCustom ? `
                    <button class="preset-action-btn edit-btn" title="Düzenle">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="preset-action-btn delete-btn" title="Sil">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        `;
        
        // Event listeners
        const applyBtn = item.querySelector('.apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applyPreset(key);
                this.currentPreset = key;
                if (this.elements.presetSelect) {
                    this.elements.presetSelect.value = key;
                }
                showNotification(`"${preset.name}" uygulandı`, 'success');
            });
        }
        
        if (isCustom) {
            const editBtn = item.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => this.editCustomPreset(key));
            }
            
            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.deleteCustomPreset(key));
            }
        }
        
        return item;
    },
    
    // Edit custom preset
    editCustomPreset(key) {
        const preset = this.customPresets[key];
        if (!preset) return;
        
        // Apply preset values to EQ
        this.applyPreset(key);
        
        // Open save modal with current values
        this.openSavePresetModal();
        
        // Pre-fill name and description
        if (this.elements.presetNameInput) {
            this.elements.presetNameInput.value = preset.name;
        }
        if (this.elements.presetDescInput) {
            this.elements.presetDescInput.value = preset.description || '';
        }
        
        // Delete old preset when saving
        const oldConfirmHandler = document.getElementById('confirmSavePreset');
        if (oldConfirmHandler) {
            const newHandler = oldConfirmHandler.cloneNode(true);
            oldConfirmHandler.parentNode.replaceChild(newHandler, oldConfirmHandler);
            
            newHandler.addEventListener('click', () => {
                // Delete old preset first
                delete this.customPresets[key];
                // Then save as new
                this.saveCustomPreset();
                // Re-populate list
                this.populateCustomPresetList();
            });
        }
    },
    
    // Delete custom preset
    deleteCustomPreset(key) {
        const preset = this.customPresets[key];
        if (!preset) return;
        
        if (confirm(`"${preset.name}" presetini silmek istediğinize emin misiniz?`)) {
            delete this.customPresets[key];
            this.saveCustomPresets();
            this.populatePresetSelect();
            this.populateCustomPresetList();
            
            // If this was the current preset, switch to flat
            if (this.currentPreset === key) {
                this.currentPreset = 'flat';
                if (this.elements.presetSelect) {
                    this.elements.presetSelect.value = 'flat';
                }
            }
            
            showNotification(`"${preset.name}" silindi`, 'info');
        }
    },
    
    // Export presets to JSON file
    exportPresets() {
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            customPresets: this.customPresets
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `aurivo_eq_presets_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('Presetler dışa aktarıldı', 'success');
    },
    
    // Import presets from JSON file
    importPresets(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (!data.customPresets || typeof data.customPresets !== 'object') {
                    throw new Error('Geçersiz preset dosyası');
                }
                
                // Merge with existing presets
                let importedCount = 0;
                Object.entries(data.customPresets).forEach(([key, preset]) => {
                    // Validate preset structure
                    if (preset.name && Array.isArray(preset.bands) && preset.bands.length === 32) {
                        // Generate new key to avoid conflicts
                        const newKey = 'custom_' + preset.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
                        this.customPresets[newKey] = {
                            ...preset,
                            importedAt: new Date().toISOString()
                        };
                        importedCount++;
                    }
                });
                
                if (importedCount > 0) {
                    this.saveCustomPresets();
                    this.populatePresetSelect();
                    this.populateCustomPresetList();
                    showNotification(`${importedCount} preset içe aktarıldı`, 'success');
                } else {
                    showNotification('İçe aktarılacak geçerli preset bulunamadı', 'warning');
                }
                
            } catch (err) {
                console.error('Import error:', err);
                showNotification('Dosya okunamadı: ' + err.message, 'error');
            }
        };
        
        reader.readAsText(file);
        
        // Reset file input
        event.target.value = '';
    }
};

// ============================================
// AGC CONTROLLER - Automatic Gain Control
// Advanced Level Management & Limiter
// ============================================

const AGCController = {
    // Configuration
    config: {
        enabled: true,
        checkInterval: 100,          // 100ms interval for level checking
        peakThreshold: 0.95,         // 95% of max (31129 / 32768)
        lowLevelThreshold: 0.50,     // 50% for low level detection
        lowLevelDuration: 5000,      // 5 seconds before suggesting increase
        attackTime: 5,               // 5ms attack
        releaseTime: 50,             // 50ms release
        limiterThreshold: 0.98,      // Hard limiter at 98%
    },
    
    // State
    state: {
        isRunning: false,
        intervalId: null,
        lowLevelStartTime: null,
        lastClippingWarning: 0,
        totalGainReductions: 0,
        sessionClippingEvents: 0,
    },
    
    // UI Elements
    elements: {
        toggle: null,
        statusIndicator: null,
        gainReductionMeter: null,
        peakMeter: null,
        clippingLed: null,
    },
    
    // Initialize AGC Controller
    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.loadSettings();
        
        if (this.config.enabled) {
            this.start();
        }
        
        console.log('🎚️ AGC Controller initialized');
    },
    
    // Cache DOM elements
    cacheElements() {
        this.elements.toggle = document.getElementById('autoGainToggle');
        this.elements.statusIndicator = document.getElementById('agcStatusIndicator');
        this.elements.gainReductionMeter = document.getElementById('gainReductionMeter');
        this.elements.peakMeter = document.getElementById('peakMeter');
        this.elements.clippingLed = document.getElementById('clipLed');
    },
    
    // Setup event listeners
    setupEventListeners() {
        // Toggle listener is handled in EQController
        // We just need to listen for changes
        if (this.elements.toggle) {
            this.elements.toggle.addEventListener('change', (e) => {
                this.setEnabled(e.target.checked);
            });
        }
    },
    
    // Start AGC monitoring
    start() {
        if (this.state.isRunning) return;
        
        this.state.isRunning = true;
        this.state.intervalId = setInterval(() => this.checkLevels(), this.config.checkInterval);
        
        // Send AGC parameters to native
        this.updateNativeParameters();
        
        console.log('🔊 AGC monitoring started');
    },
    
    // Stop AGC monitoring
    stop() {
        if (!this.state.isRunning) return;
        
        this.state.isRunning = false;
        if (this.state.intervalId) {
            clearInterval(this.state.intervalId);
            this.state.intervalId = null;
        }
        
        console.log('🔇 AGC monitoring stopped');
    },
    
    // Enable/disable AGC
    setEnabled(enabled) {
        this.config.enabled = enabled;
        
        // Update native AGC
        if (window.audioAPI?.agc?.setEnabled) {
            try {
                window.audioAPI.agc.setEnabled(enabled);
            } catch (e) {
                console.warn('Native AGC not available:', e);
            }
        }
        
        if (enabled) {
            this.start();
        } else {
            this.stop();
        }
        
        // Save setting
        this.saveSettings();
        
        // Update UI
        if (this.elements.toggle) {
            this.elements.toggle.checked = enabled;
        }
    },
    
    // Update native AGC parameters
    updateNativeParameters() {
        if (!window.audioAPI?.agc?.setParameters) return;
        
        try {
            window.audioAPI.agc.setParameters({
                attackMs: this.config.attackTime,
                releaseMs: this.config.releaseTime,
                threshold: this.config.limiterThreshold
            });
        } catch (e) {
            console.warn('Could not set AGC parameters:', e);
        }
    },
    
    // Main level checking function - called every 100ms
    checkLevels() {
        if (!this.config.enabled) return;
        if (!state.isPlaying) return; // Only check when playing
        
        // Get AGC status from native
        let agcStatus = null;
        if (window.audioAPI?.agc?.getStatus) {
            try {
                agcStatus = window.audioAPI.agc.getStatus();
            } catch (e) {
                // Native not available, try channel levels
            }
        }
        
        // Fallback to basic level checking
        if (!agcStatus && window.audioAPI?.spectrum?.getChannelLevels) {
            try {
                const levels = window.audioAPI.spectrum.getChannelLevels();
                agcStatus = {
                    peakLevel: Math.max(levels.left || 0, levels.right || 0),
                    rmsLevel: (levels.left + levels.right) / 2,
                    gainReduction: 1.0,
                    isClipping: false,
                    clippingCount: 0
                };
            } catch (e) {
                return; // Can't check levels
            }
        }
        
        if (!agcStatus) return;
        
        // Update UI meters
        this.updateMeters(agcStatus);
        
        // Check for clipping
        if (agcStatus.isClipping || agcStatus.peakLevel > this.config.peakThreshold) {
            this.handleClipping(agcStatus);
        }
        
        // Check for sustained low levels
        this.checkLowLevels(agcStatus);
    },
    
    // Update visual meters
    updateMeters(status) {
        // Update level bars in EQ modal
        if (EQController?.elements?.levelBars?.length >= 2) {
            EQController.updateLevels(status.peakLevel, status.peakLevel);
        }
        
        // Update clipping LED
        if (this.elements.clippingLed) {
            this.elements.clippingLed.classList.toggle('active', status.isClipping);
        }
        
        // Update peak label
        const peakLabel = document.getElementById('peakLabel');
        if (peakLabel) {
            const peakDB = status.peakLevel > 0 ? (20 * Math.log10(status.peakLevel)).toFixed(1) : '-∞';
            peakLabel.textContent = `${peakDB} dB`;
            peakLabel.style.color = status.peakLevel > 0.9 ? '#ff4444' : 
                                    status.peakLevel > 0.7 ? '#ffaa00' : '#00ff88';
        }
    },
    
    // Handle clipping events
    handleClipping(status) {
        const now = Date.now();
        
        // Prevent spam - only warn every 2 seconds
        if (now - this.state.lastClippingWarning < 2000) return;
        
        this.state.lastClippingWarning = now;
        this.state.sessionClippingEvents++;
        
        console.warn(`⚠️ Clipping detected! Peak: ${(status.peakLevel * 100).toFixed(1)}%`);
        
        // Apply emergency reduction
        this.applyEmergencyReduction();
        
        // Show warning notification
        showNotification(
            'Ses seviyesi çok yüksek, otomatik azaltma uygulandı',
            'warning',
            3000
        );
    },
    
    // Apply emergency gain reduction
    applyEmergencyReduction() {
        this.state.totalGainReductions++;
        
        // Try native emergency reduction first
        if (window.audioAPI?.agc?.applyEmergencyReduction) {
            try {
                window.audioAPI.agc.applyEmergencyReduction();
                return;
            } catch (e) {
                // Fall through to JS implementation
            }
        }
        
        // JS fallback: reduce all EQ bands by 1dB
        if (EQController) {
            EQController.bands.forEach((value, index) => {
                const newValue = Math.max(-15, value - 1);
                EQController.bands[index] = newValue;
                EQController.setBand(index, newValue);
                
                // Update slider
                const sliderData = EQController.elements.sliders[index];
                if (sliderData) {
                    sliderData.slider.value = newValue;
                    sliderData.valueDiv.textContent = newValue > 0 ? `+${newValue}` : newValue;
                }
            });
            
            // Reduce preamp by 0.5dB
            const newPreamp = Math.max(-12, EQController.preamp - 0.5);
            EQController.preamp = newPreamp;
            EQController.setPreamp(newPreamp);
            
            if (EQController.elements.preampSlider) {
                EQController.elements.preampSlider.value = newPreamp;
                const preampDisplay = document.getElementById('preampValue');
                if (preampDisplay) {
                    preampDisplay.textContent = (newPreamp > 0 ? '+' : '') + newPreamp.toFixed(1) + ' dB';
                }
            }
        }
    },
    
    // Check for sustained low levels and suggest preamp increase
    checkLowLevels(status) {
        if (status.peakLevel < this.config.lowLevelThreshold) {
            // Level is low
            if (!this.state.lowLevelStartTime) {
                this.state.lowLevelStartTime = Date.now();
            } else {
                const lowDuration = Date.now() - this.state.lowLevelStartTime;
                
                // If low for configured duration, suggest increase
                if (lowDuration >= this.config.lowLevelDuration) {
                    this.suggestPreampIncrease();
                    this.state.lowLevelStartTime = null; // Reset timer
                }
            }
        } else {
            // Level is okay, reset timer
            this.state.lowLevelStartTime = null;
        }
    },
    
    // Suggest preamp increase to user
    suggestPreampIncrease() {
        // Only suggest if preamp is below max
        if (EQController && EQController.preamp < 12) {
            // Check native suggestion
            let suggestion = 0.5; // Default
            if (window.audioAPI?.agc?.getPreampSuggestion) {
                try {
                    suggestion = window.audioAPI.agc.getPreampSuggestion();
                } catch (e) {
                    // Use default
                }
            }
            
            if (suggestion > 0) {
                // Auto-apply small increase
                const newPreamp = Math.min(12, EQController.preamp + suggestion);
                EQController.preamp = newPreamp;
                EQController.setPreamp(newPreamp);
                
                // Update UI
                if (EQController.elements.preampSlider) {
                    EQController.elements.preampSlider.value = newPreamp;
                    const preampDisplay = document.getElementById('preampValue');
                    if (preampDisplay) {
                        preampDisplay.textContent = (newPreamp > 0 ? '+' : '') + newPreamp.toFixed(1) + ' dB';
                    }
                }
                
                console.log(`📈 Auto-increased preamp by +${suggestion.toFixed(1)}dB`);
            }
        }
    },
    
    // Get AGC statistics
    getStats() {
        return {
            enabled: this.config.enabled,
            isRunning: this.state.isRunning,
            totalGainReductions: this.state.totalGainReductions,
            sessionClippingEvents: this.state.sessionClippingEvents,
            config: { ...this.config }
        };
    },
    
    // Reset statistics
    resetStats() {
        this.state.totalGainReductions = 0;
        this.state.sessionClippingEvents = 0;
        
        // Reset native clipping count
        if (window.audioAPI?.agc?.resetClippingCount) {
            try {
                window.audioAPI.agc.resetClippingCount();
            } catch (e) {
                // Ignore
            }
        }
    },
    
    // Save settings
    saveSettings() {
        try {
            localStorage.setItem('aurivo_agc_settings', JSON.stringify({
                enabled: this.config.enabled,
                attackTime: this.config.attackTime,
                releaseTime: this.config.releaseTime,
                limiterThreshold: this.config.limiterThreshold
            }));
        } catch (e) {
            console.error('Could not save AGC settings:', e);
        }
    },
    
    // Load settings
    loadSettings() {
        try {
            const saved = localStorage.getItem('aurivo_agc_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.config.enabled = settings.enabled ?? true;
                this.config.attackTime = settings.attackTime ?? 5;
                this.config.releaseTime = settings.releaseTime ?? 50;
                this.config.limiterThreshold = settings.limiterThreshold ?? 0.98;
            }
        } catch (e) {
            console.error('Could not load AGC settings:', e);
        }
    }
};

// Initialize EQ and AGC on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Slight delay to ensure all elements are ready
    setTimeout(() => {
        EQController.init();
        AGCController.init();
    }, 100);
});

