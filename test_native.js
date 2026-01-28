// ============================================
// AURIVO AUDIO ENGINE - Native Module Test
// ============================================

const path = require('path');

console.log('🔍 Aurivo Audio Engine Test\n');

// Native modülü yükle
let audio;
try {
    const modulePath = path.join(__dirname, 'native-dist', 'aurivo_audio.node');
    audio = require(modulePath);
    console.log('✅ Native module loaded from:', modulePath);
} catch (e) {
    console.error('❌ Module load failed:', e.message);
    process.exit(1);
}

// Mevcut fonksiyonları listele
console.log('\n📋 Available functions:');
const functions = Object.keys(audio);
functions.forEach((fn, i) => {
    console.log(`   ${i + 1}. ${fn}`);
});
console.log(`\n   Total: ${functions.length} functions\n`);

// Audio engine'i başlat
console.log('🎵 Initializing audio engine...');
try {
    const initResult = audio.initialize();
    console.log('✅ Audio initialized:', initResult);
} catch (e) {
    console.error('❌ Initialize failed:', e.message);
}

// EQ frekanslarını al
console.log('\n🎚️  EQ Frequencies:');
try {
    const freqs = audio.getEQFrequencies();
    console.log('   Bands:', freqs.length);
    console.log('   Range:', freqs[0], 'Hz -', freqs[freqs.length - 1], 'Hz');
} catch (e) {
    console.error('❌ getEQFrequencies failed:', e.message);
}

// AGC durumunu kontrol et
console.log('\n🔊 AGC Status:');
try {
    const agc = audio.getAGCStatus();
    console.log('   Enabled:', agc.enabled);
    console.log('   Peak Level:', agc.peakLevel.toFixed(3));
    console.log('   RMS Level:', agc.rmsLevel.toFixed(3));
    console.log('   Gain Reduction:', agc.gainReduction.toFixed(3), 'dB');
    console.log('   Clipping:', agc.isClipping);
} catch (e) {
    console.error('❌ getAGCStatus failed:', e.message);
}

// Cleanup
console.log('\n🧹 Cleanup...');
try {
    audio.cleanup();
    console.log('✅ Audio engine cleaned up');
} catch (e) {
    console.error('❌ Cleanup failed:', e.message);
}

console.log('\n✨ Test completed!\n');
