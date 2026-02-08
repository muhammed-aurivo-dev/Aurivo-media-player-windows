const fs = require('fs');
const path = require('path');
const os = require('os');

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readMagic(p, n = 4) {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(n);
      const bytes = fs.readSync(fd, buf, 0, n, 0);
      return buf.subarray(0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

function hex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function assertFileLooksLikeWindowsBinary(p, label) {
  if (!exists(p)) {
    const extra = [];
    try {
      const root = path.resolve(__dirname, '..');
      const wantsAddon = /aurivo_audio\.node/i.test(p);
      const wantsVisualizer = /aurivo-projectm-visualizer(\.exe)?/i.test(p);

      if (wantsAddon) {
        const nativeBuildDir = path.join(root, 'native', 'build');
        if (exists(nativeBuildDir)) {
          const hits = findFiles(nativeBuildDir, (name) => /aurivo_audio\.node$/i.test(name), 40);
          if (hits.length) extra.push(`Bulunan adaylar:\n- ${hits.join('\n- ')}`);
        }
      }

      if (wantsVisualizer) {
        const nativeDistDir = path.join(root, 'native-dist');
        if (exists(nativeDistDir)) {
          const hits = findFiles(nativeDistDir, (name) => /aurivo-projectm-visualizer/i.test(name), 40);
          if (hits.length) extra.push(`Bulunan adaylar:\n- ${hits.join('\n- ')}`);
        }
      }
    } catch {
      // ignore
    }

    const extraMsg = extra.length ? `\n\n${extra.join('\n\n')}` : '';
    throw new Error(`${label} bulunamadı: ${p}${extraMsg}`);
  }

  const m = readMagic(p, 4);
  const isMZ = m.length >= 2 && m[0] === 0x4d && m[1] === 0x5a; // 'MZ'
  if (!isMZ) {
    throw new Error(
      `${label} Windows binary gibi görünmüyor (MZ yok). ` +
        `Muhtemelen Linux (ELF) dosyası paketleniyor. path=${p} magic=${hex(m)}`
    );
  }
}

function findFiles(rootDir, predicate, limit = 50) {
  const results = [];
  const queue = [rootDir];

  while (queue.length && results.length < limit) {
    const dir = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Avoid deep recursion into node_modules-like trees (shouldn't exist here, but safe).
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        queue.push(p);
        continue;
      }
      if (entry.isFile() && predicate(entry.name)) {
        results.push(p);
      }
    }
  }

  return results;
}

function main() {
  const root = path.resolve(__dirname, '..');

  console.log('\n[verify-win-artifacts] Windows build artifact kontrolü...');
  console.log('[verify-win-artifacts] host platform:', os.platform());
  const skipVisualizer = String(process.env.AURIVO_SKIP_VISUALIZER || '').trim() === '1';

  // Native audio addon (must be built for Electron/Windows before packaging)
  const nativeAddon = path.join(root, 'native', 'build', 'Release', 'aurivo_audio.node');
  assertFileLooksLikeWindowsBinary(nativeAddon, 'Native audio addon (aurivo_audio.node)');

  // Visualizer executable (must exist for Windows packaged builds)
  if (skipVisualizer) {
    console.warn('[verify-win-artifacts] ⚠ Visualizer kontrolü atlandı (AURIVO_SKIP_VISUALIZER=1).');
  } else {
    const visualizerExe = path.join(root, 'native-dist', 'aurivo-projectm-visualizer.exe');
    assertFileLooksLikeWindowsBinary(visualizerExe, 'Visualizer exe (aurivo-projectm-visualizer.exe)');
  }

  // BASS runtime DLLs copied into native build dir (DLL loader searches here)
  const bassDllDir = path.join(root, 'native', 'build', 'Release');
  const requiredBassDlls = [
    'bass.dll',
    'bass_fx.dll',
    'bass_aac.dll',
    'bassape.dll',
    'bassflac.dll',
    'basswv.dll'
  ];

  for (const dll of requiredBassDlls) {
    const p = path.join(bassDllDir, dll);
    assertFileLooksLikeWindowsBinary(p, `BASS DLL (${dll})`);
  }

  // ffmpeg.exe (optional, but recommended for album art extraction / download tools)
  const ffmpegExe = path.join(root, 'bin', 'ffmpeg.exe');
  if (!exists(ffmpegExe)) {
    console.warn('[verify-win-artifacts] ⚠ ffmpeg.exe yok (opsiyonel):', ffmpegExe);
  } else {
    const m = readMagic(ffmpegExe, 2);
    const isMZ = m.length >= 2 && m[0] === 0x4d && m[1] === 0x5a;
    if (!isMZ) {
      console.warn('[verify-win-artifacts] ⚠ ffmpeg.exe MZ değil (placeholder olabilir):', ffmpegExe);
    }
  }

  console.log('[verify-win-artifacts] ✓ OK');
}

try {
  main();
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.error('\n[verify-win-artifacts] ❌', msg);
  console.error('\nİpucu: Windows installer üretmek için Windows ortamında derleyin:');
  console.error('- `native/build/Release/aurivo_audio.node` Windows için derlenmeli (MZ)');
  console.error('- `native-dist/aurivo-projectm-visualizer.exe` Windows için derlenmeli (MZ)');
  console.error('- Sonra `npm run build:win`');
  process.exit(1);
}
