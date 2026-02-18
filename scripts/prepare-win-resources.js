const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function safeExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  return true;
}

function resolveVisualizerDllDir() {
  const fromEnv = String(process.env.AURIVO_VISUALIZER_DLL_DIR || '').trim();
  if (fromEnv) return fromEnv;

  // Local Windows dev convenience: if the env var isn't set, try the common MSYS2 install paths.
  if (process.platform === 'win32') {
    const candidates = ['C:\\\\msys64\\\\mingw64\\\\bin', 'C:\\\\msys2\\\\mingw64\\\\bin'];
    for (const c of candidates) {
      if (safeExists(c)) return c;
    }
  }

  return '';
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
      path.join(dllDir, 'objdump'),
      path.join(dllDir, 'x86_64-w64-mingw32-objdump.exe'),
      path.join(dllDir, 'x86_64-w64-mingw32-objdump'),
      path.join(path.dirname(dllDir), 'usr', 'bin', 'objdump.exe'),
      path.join(path.dirname(dllDir), 'usr', 'bin', 'objdump'),
      // Fallback: resolve from PATH (useful on Linux cross-compile setups).
      'x86_64-w64-mingw32-objdump',
      'objdump'
    ];

    const canRun = (exe) => {
      try {
        if (!exe) return false;
        cp.execFileSync(exe, ['--version'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    };

    for (const p of candidates) {
      try {
        if (!p) continue;
        if ((p.includes('\\') || p.includes('/')) && !fs.existsSync(p)) continue;
      } catch {
        continue;
      }
      if (canRun(p)) return p;
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
    // projectM runtime (common)
    'libprojectM-4-4.dll',
    'libprojectM-4-playlist-4.dll',
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
    const dllDir = resolveVisualizerDllDir();

    // If the visualizer exists but we can't find MSYS2's DLL dir, this almost always means
    // the packaged app will fail to start the visualizer on a clean Windows machine.
    const requireDlls = String(process.env.AURIVO_REQUIRE_VISUALIZER_DLLS || '').trim() === '1';
    const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe');
    const hasVisualizerExe = safeExists(visualizerExe);

    if (dllDir) {
      copyVisualizerDllsFromDir(dllDir, nativeDistDir);
    } else if (hasVisualizerExe) {
      const msg =
        '[prepare-win-resources] ⚠ Visualizer exe var ama AURIVO_VISUALIZER_DLL_DIR bulunamadı; DLL paketleme atlandı. ' +
        'Windows üzerinde MSYS2 kuruluysa env ayarlayın (ör: C:\\msys64\\mingw64\\bin).';
      if (requireDlls) throw new Error(msg);
      console.warn(msg);
    }
  } catch (e) {
    console.warn('[prepare-win-resources] Visualizer DLL kopyalama hatası:', e?.message || e);
  }
}

main();
