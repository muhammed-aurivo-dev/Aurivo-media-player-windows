const path = require('path');

console.log('🔍 Aurivo Crossfeed Verification Test\n');

let audio;
try {
    const modulePath = path.join(__dirname, 'native-dist', 'aurivo_audio.node');
    audio = require(modulePath);
    console.log('✅ Native module loaded from:', modulePath);
} catch (e) {
    console.error('❌ Module load failed:', e.message);
    process.exit(1);
}

const requiredFunctions = [
    'EnableCrossfeed',
    'SetCrossfeedLevel',
    'SetCrossfeedDelay',
    'SetCrossfeedLowCut',
    'SetCrossfeedHighCut',
    'SetCrossfeedPreset',
    'GetCrossfeedParams',
    'ResetCrossfeed'
];

console.log('\n📋 Checking for Crossfeed functions:');
let allFound = true;
requiredFunctions.forEach(fn => {
    if (typeof audio[fn] === 'function') {
        console.log(`   ✅ ${fn} found`);
    } else {
        console.log(`   ❌ ${fn} MISSING`);
        allFound = false;
    }
});

if (!allFound) {
    console.error('\n❌ Verification failed: Some Crossfeed functions are missing!');
} else {
    console.log('\n🎵 Testing Crossfeed initialization...');
    try {
        audio.initialize();

        console.log('Setting Crossfeed parameters...');
        audio.EnableCrossfeed(true);
        audio.SetCrossfeedLevel(45.0);
        audio.SetCrossfeedDelay(0.5);
        audio.SetCrossfeedLowCut(800.0);
        audio.SetCrossfeedHighCut(5000.0);

        const params = audio.GetCrossfeedParams();
        console.log('Current Params:', params);

        if (params && params.enabled === true && params.level === 45.0) {
            console.log('\n✨ Crossfeed verification SUCCESSFUL!');
        } else {
            console.warn('\n⚠️ Crossfeed verification partially successful, but parameters might not match exactly.');
        }

        audio.cleanup();
    } catch (e) {
        console.error('❌ Test execution failed:', e.message);
    }
}

console.log('\nDone.');
