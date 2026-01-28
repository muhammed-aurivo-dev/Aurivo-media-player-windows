const path = require('path');
const modulePath = process.argv[2];
if (!modulePath) {
    console.error('Usage: node test_functions.js <path_to_node_file>');
    process.exit(1);
}

try {
    const audio = require(path.resolve(modulePath));
    console.log('📋 Available functions in', modulePath);
    const functions = Object.keys(audio);
    functions.sort().forEach((fn, i) => {
        console.log(`   ${i + 1}. ${fn}`);
    });
    console.log(`\n   Total: ${functions.length} functions`);
} catch (e) {
    console.error('❌ Failed to load module:', e.message);
}
