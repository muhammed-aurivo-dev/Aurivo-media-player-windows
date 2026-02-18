const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  return true;
}

function copyVisualizerDllsFromDir(dllDir, nativeDistDir) {
  if (!dllDir) return { copied: 0, skipped: 0 };
  if (!fs.existsSync(dllDir)) {
    console.warn('[prepare-win-resources] AURIVO_VISUALIZER_DLL_DIR bulunamadı:', dllDir);
    return { copied: 0, skipped: 0 };
  }

  ensureDir(nativeDistDir);

  const findObjdump = () => {
    const candidates = [
      path.join(dllDir, 'objdump.exe'),
      path.join(dllDir, 'x86_64-w64-mingw32-objdump.exe'),
      path.join(path.dirname(dllDir), 'usr', 'bin', 'objdump.exe')
    ];
    for (const p of candidates) {
      try {
        if (p && fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
    return '';
  };

  const objdumpPath = findObjdump();

  const listDllDeps = (filePath) => {
    if (!objdumpPath || !filePath || !fs.existsSync(filePath)) return [];
    try {
      const out = cp.execFileSync(objdumpPath, ['-p', filePath], { encoding: 'utf8' });
      const deps = [];
      for (const line of String(out || '').split(/\r?\n/)) {
        const m = line.match(/DLL Name:\s*(.+)$/i);
        if (m) {
          const name = String(m[1] || '').trim();
          if (name) deps.push(name);
        }
      }
      return deps;
    } catch (e) {
      console.warn('[prepare-win-resources] objdump failed:', e?.message || e);
      return [];
    }
  };

  const toLower = (s) => String(s || '').toLowerCase();
  const isDll = (name) => toLower(name).endsWith('.dll');

  const fileInDllDir = (name) => path.join(dllDir, name);

  const copyOne = (name) => {
    if (!name) return false;
    const from = fileInDllDir(name);
    if (!fs.existsSync(from)) return false;
    const to = path.join(nativeDistDir, name);
    try {
      fs.copyFileSync(from, to);
      return true;
    } catch (e) {
      console.warn('[prepare-win-resources] DLL kopyalanamadı:', name, e?.message || e);
      return false;
    }
  };

  // Seed: the visualizer exe + known core runtime DLLs.
  const seedFiles = [];
  const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe');
  if (fs.existsSync(visualizerExe)) seedFiles.push(visualizerExe);

  // Also seed with projectM DLLs if they exist in the MSYS2 dir.
  try {
    for (const entry of fs.readdirSync(dllDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const lower = toLower(entry.name);
      if (lower.includes('projectm') && isDll(entry.name)) {
        seedFiles.push(fileInDllDir(entry.name));
      }
    }
  } catch {
    // ignore
  }

  // Always include MinGW runtime basics (common missing DLLs).
  const mustHave = [
    'libwinpthread-1.dll',
    'libgcc_s_seh-1.dll',
    'libstdc++-6.dll',
    'zlib1.dll',
    'SDL2.dll',
    'SDL2_image.dll',
    'glew32.dll'
  ];
  for (const n of mustHave) copyOne(n);

  const queue = [];
  const seen = new Set();

  const enqueueDeps = (fromFile) => {
    const deps = listDllDeps(fromFile);
    for (const d of deps) {
      const name = path.basename(d);
      if (!isDll(name)) continue;
      const key = toLower(name);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(name);
    }
  };

  for (const f of seedFiles) enqueueDeps(f);

  let copied = 0;
  let skipped = 0;

  // BFS: copy deps and then scan their deps too (transitive).
  // Limit to prevent runaway in case objdump output is unexpected.
  let steps = 0;
  while (queue.length && steps < 250) {
    steps++;
    const name = queue.shift();
    if (!name) continue;
    if (copyOne(name)) {
      copied++;
      enqueueDeps(fileInDllDir(name));
    } else {
      skipped++;
    }
  }

  console.log('[prepare-win-resources] Visualizer DLL dependency bundle:', {
    from: dllDir,
    to: nativeDistDir,
    objdump: objdumpPath || '(none)',
    copied,
    skipped
  });

  return { copied, skipped };
}

function main() {
  const root = path.resolve(__dirname, '..');

  const binDir = path.join(root, 'bin');
  ensureDir(binDir);

  const ffmpegSrc = path.join(root, 'third_party', 'ffmpeg', 'ffmpeg.exe');
  const ffmpegDst = path.join(binDir, 'ffmpeg.exe');
  const copiedFfmpeg = copyIfExists(ffmpegSrc, ffmpegDst);

  if (!copiedFfmpeg) {
    console.warn('[prepare-win-resources] ffmpeg.exe bulunamadı:', ffmpegSrc);
  } else {
    const size = fs.statSync(ffmpegDst).size;
    if (size === 0) {
      console.warn('[prepare-win-resources] ffmpeg.exe 0 bayt (placeholder). Gerçek ffmpeg.exe ile değiştirin:', ffmpegDst);
    } else {
      console.log('[prepare-win-resources] ffmpeg.exe kopyalandı:', ffmpegDst);
    }
  }

  const nativeDistDir = path.join(root, 'native-dist');
  if (!fs.existsSync(nativeDistDir)) {
    console.warn('[prepare-win-resources] native-dist dizini yok:', nativeDistDir);
  } else {
    const hasExe = fs.existsSync(path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe'));
    if (!hasExe) {
      console.warn('[prepare-win-resources] Visualizer exe yok (Windows build için gerekli):', path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe'));
    }
  }

  // Optional: copy visualizer runtime DLLs (MSYS2/MinGW etc.)
  // Example: set AURIVO_VISUALIZER_DLL_DIR="C:\\msys64\\mingw64\\bin"
  try {
    const dllDir = process.env.AURIVO_VISUALIZER_DLL_DIR || '';
    if (dllDir) {
      copyVisualizerDllsFromDir(dllDir, nativeDistDir);
    }
  } catch (e) {
    console.warn('[prepare-win-resources] Visualizer DLL kopyalama hatası:', e?.message || e);
  }
}

main();
