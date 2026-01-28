const fs = require('fs');
const path = require('path');
const os = require('os');

// Platform tespiti (arg ile override edilebilir)
const argPlatform = process.argv[2];
const platform = argPlatform || os.platform();
let libsSourceDir, libExtension, libsToAdd;

console.log(`\n🖥️  Platform: ${platform}\n`);

if (platform === 'linux') {
    libsSourceDir = path.join(__dirname, '../libs/linux');
    libExtension = '.so';
    libsToAdd = [
        'libbass.so',
        'libbass_fx.so',
        'libbass_aac.so',
        'libbassape.so',
        'libbassflac.so',
        'libbasswv.so'
    ];
} else if (platform === 'win32') {
    libsSourceDir = path.join(__dirname, '../libs/windows');
    libExtension = '.dll';
    libsToAdd = [
        'bass.dll',
        'bass_fx.dll',
        'bass_aac.dll',
        'bassape.dll',
        'bassflac.dll',
        'basswv.dll'
    ];
} else if (platform === 'darwin') {
    libsSourceDir = path.join(__dirname, '../libs/macos');
    libExtension = '.dylib';
    libsToAdd = [
        'libbass.dylib',
        'libbass_fx.dylib'
    ];
} else {
    console.error(`❌ Unsupported platform: ${platform}`);
    process.exit(1);
}

const BUILD_TARGET = path.join(__dirname, 'build/Release');
const ELECTRON_DIR = path.join(__dirname, '..');

console.log('📦 Copying BASS libraries to build directory...');
console.log(`   Source: ${libsSourceDir}`);
console.log(`   Target: ${BUILD_TARGET}\n`);

// Build klasörü yoksa oluştur
if (!fs.existsSync(BUILD_TARGET)) {
    fs.mkdirSync(BUILD_TARGET, { recursive: true });
}

// Libs source kontrolü
if (!fs.existsSync(libsSourceDir)) {
    console.error(`❌ Libraries not found: ${libsSourceDir}`);
    process.exit(1);
}

let successCount = 0;
let failCount = 0;

// Her kütüphaneyi kopyala
libsToAdd.forEach(lib => {
    const source = path.join(libsSourceDir, lib);
    const target = path.join(BUILD_TARGET, lib);
    
    try {
        if (fs.existsSync(source)) {
            fs.copyFileSync(source, target);
            
            // Linux'ta çalıştırılabilir izni ver
            if (platform === 'linux') {
                fs.chmodSync(target, 0o755);
            }
            
            const stats = fs.statSync(target);
            const sizeKB = (stats.size / 1024).toFixed(1);
            console.log(`✅ Copied: ${lib.padEnd(20)} (${sizeKB} KB)`);
            successCount++;
        } else {
            console.warn(`⚠️  Not found (optional): ${lib}`);
        }
    } catch (error) {
        console.error(`❌ Failed to copy ${lib}:`, error.message);
        failCount++;
    }
});

console.log('');
console.log(`📊 Results: ${successCount} copied, ${failCount} failed`);

// RPATH kontrolü (Linux)
if (platform === 'linux') {
    console.log('');
    console.log('🔍 Checking RPATH...');
    const { execSync } = require('child_process');
    const nodePath = path.join(BUILD_TARGET, 'aurivo_audio.node');
    
    try {
        if (fs.existsSync(nodePath)) {
            const rpath = execSync(`readelf -d "${nodePath}" | grep -E "RPATH|RUNPATH" || echo "No RPATH found"`, {
                encoding: 'utf8'
            });
            console.log(rpath.trim());
        }
    } catch (error) {
        console.warn('⚠️  readelf not available');
    }
}

console.log('');
console.log('✨ All done!');
console.log(`📁 Kütüphaneler libs/${platform} klasöründen kullanılıyor${platform === 'linux' ? ' (RPATH ile)' : ''}`);

if (failCount > 0) {
    process.exit(1);
}
