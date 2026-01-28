const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const targets = [
  {
    name: 'linux',
    dir: path.join(root, 'libs', 'linux'),
    required: [
      'libbass.so',
      'libbass_fx.so',
      'libbass_aac.so',
      'libbassape.so',
      'libbassflac.so',
      'libbasswv.so'
    ]
  },
  {
    name: 'windows',
    dir: path.join(root, 'libs', 'windows'),
    required: [
      'bass.dll',
      'bass_fx.dll',
      'bass_aac.dll',
      'bassape.dll',
      'bassflac.dll',
      'basswv.dll'
    ]
  }
];

let ok = true;

for (const target of targets) {
  console.log(`\n🔍 ${target.name} kütüphaneleri kontrol ediliyor...`);
  if (!fs.existsSync(target.dir)) {
    console.error(`❌ Dizin bulunamadı: ${target.dir}`);
    ok = false;
    continue;
  }

  for (const lib of target.required) {
    const libPath = path.join(target.dir, lib);
    if (fs.existsSync(libPath)) {
      const sizeKB = (fs.statSync(libPath).size / 1024).toFixed(1);
      console.log(`✅ ${lib} (${sizeKB} KB)`);
    } else {
      console.error(`❌ Eksik: ${lib}`);
      ok = false;
    }
  }
}

if (!ok) {
  console.error('\n❗ Eksik kütüphaneler var. Lütfen libs klasörünü tamamlayın.');
  process.exit(1);
}

console.log('\n✨ Tüm Linux ve Windows BASS kütüphaneleri hazır.');
