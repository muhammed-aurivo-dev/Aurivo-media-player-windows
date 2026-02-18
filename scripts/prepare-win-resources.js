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

function normalizeMsysRootFromDllDir(dllDir) {
  const d = String(dllDir || '').trim();
  if (!d) return '';
  try {
    const norm = d.replace(/\//g, '\\');
    const parts = norm.split('\\').filter(Boolean);
    // ...\msys64\mingw64\bin -> ...\msys64
    if (parts.length >= 3) {
      const last = parts[parts.length - 1].toLowerCase();
      const parent = parts[parts.length - 2].toLowerCase();
      if (last === 'bin' && ['mingw64', 'ucrt64', 'clang64', 'usr'].includes(parent)) {
        return parts.slice(0, -2).join('\\');
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function pickBestDllDir(dllDir) {
  const original = String(dllDir || '').trim();
  if (!original) return '';

  const extraRoots = [];
  try {
    const a = String(process.env.MSYS2_LOCATION || '').trim();
    const b = String(process.env.MSYS2_ROOT || '').trim();
    const c = String(process.env.MSYS2_DIR || '').trim();
    if (a) extraRoots.push(a);
    if (b) extraRoots.push(b);
    if (c) extraRoots.push(c);
  } catch {
    // ignore
  }

  const msysRoot = normalizeMsysRootFromDllDir(original);
  const candidates = [];
  candidates.push(original);
  if (msysRoot) {
    candidates.push(path.join(msysRoot, 'mingw64', 'bin'));
    candidates.push(path.join(msysRoot, 'ucrt64', 'bin'));
    candidates.push(path.join(msysRoot, 'clang64', 'bin'));
    candidates.push(path.join(msysRoot, 'usr', 'bin'));
  }
  for (const r of extraRoots) {
    candidates.push(path.join(r, 'mingw64', 'bin'));
    candidates.push(path.join(r, 'ucrt64', 'bin'));
    candidates.push(path.join(r, 'clang64', 'bin'));
    candidates.push(path.join(r, 'usr', 'bin'));
  }

  const uniq = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = String(c || '').toLowerCase();
    if (!c || seen.has(key)) continue;
    seen.add(key);
    uniq.push(c);
  }

  const probes = [
    'SDL2.dll',
    'SDL2_image.dll',
    'glew32.dll',
    'libstdc++-6.dll',
    'libgcc_s_seh-1.dll',
    'libwinpthread-1.dll',
    'libprojectM-4-4.dll'
  ];

  let best = original;
  let bestScore = -1;

  for (const c of uniq) {
    try {
      if (!fs.existsSync(c)) continue;
    } catch {
      continue;
    }
    let score = 0;
    for (const f of probes) {
      try {
        if (fs.existsSync(path.join(c, f))) score++;
      } catch {
        // ignore
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
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
  const pickedDllDir = pickBestDllDir(dllDir);

  const msysRoot = normalizeMsysRootFromDllDir(pickedDllDir || dllDir);
  const searchDirs = [];
  for (const p of [
    pickedDllDir,
    dllDir,
    msysRoot ? path.join(msysRoot, 'mingw64', 'bin') : '',
    msysRoot ? path.join(msysRoot, 'ucrt64', 'bin') : '',
    msysRoot ? path.join(msysRoot, 'clang64', 'bin') : '',
    msysRoot ? path.join(msysRoot, 'usr', 'bin') : ''
  ]) {
    const s = String(p || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (searchDirs.find((d) => d.toLowerCase() === key)) continue;
    searchDirs.push(s);
  }

  const anyDirExists = searchDirs.some((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });

  if (!pickedDllDir || !anyDirExists) {
    console.warn('[prepare-win-resources] AURIVO_VISUALIZER_DLL_DIR bulunamadı:', dllDir);
    return { copied: 0, skipped: 0 };
  }

  ensureDir(nativeDistDir);

  const findObjdump = () => {
    const candidates = [];

    // Prefer MinGW objdump (doesn't depend on MSYS2 runtime).
    for (const d of searchDirs) {
      candidates.push(path.join(d, 'x86_64-w64-mingw32-objdump.exe'));
      candidates.push(path.join(d, 'x86_64-w64-mingw32-objdump'));
      candidates.push(path.join(d, 'objdump.exe'));
      candidates.push(path.join(d, 'objdump'));
    }

    // Fallback: resolve from PATH (useful on Linux cross-compile setups).
    candidates.push('x86_64-w64-mingw32-objdump');
    candidates.push('objdump');

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

  const findInSearchDirs = (name) => {
    for (const d of searchDirs) {
      const p = path.join(d, name);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
    return '';
  };

  const copyOne = (name) => {
    if (!name) return '';
    const from = findInSearchDirs(name);
    if (!from) return '';
    const to = path.join(nativeDistDir, name);
    try {
      fs.copyFileSync(from, to);
      return from;
    } catch (e) {
      console.warn('[prepare-win-resources] DLL kopyalanamadı:', name, e?.message || e);
      return '';
    }
  };

  // Seed: the visualizer exe + known core runtime DLLs.
  const seedFiles = [];
  const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe');
  if (fs.existsSync(visualizerExe)) seedFiles.push(visualizerExe);

  // Also seed with projectM DLLs if they exist in the MSYS2 dir.
  try {
    const probeDir = searchDirs.find((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
    if (probeDir) {
      for (const entry of fs.readdirSync(probeDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const lower = toLower(entry.name);
        if (lower.includes('projectm') && isDll(entry.name)) {
          seedFiles.push(path.join(probeDir, entry.name));
        }
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
    const fromPath = copyOne(name);
    if (fromPath) {
      copied++;
      enqueueDeps(fromPath);
    } else {
      skipped++;
    }
  }

  console.log('[prepare-win-resources] Visualizer DLL dependency bundle:', {
    from: dllDir,
    using: pickedDllDir,
    searched: searchDirs,
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

      // In CI/release builds: fail fast if core DLLs still aren't present after bundling.
      if (requireDlls && hasVisualizerExe) {
        const mustExist = [
          'SDL2.dll',
          'SDL2_image.dll',
          'glew32.dll',
          'libgcc_s_seh-1.dll',
          'libstdc++-6.dll',
          'libwinpthread-1.dll',
          'libprojectM-4-4.dll'
        ];
        const missing = mustExist.filter((n) => !safeExists(path.join(nativeDistDir, n)));
        if (missing.length) {
          throw new Error(
            'Visualizer runtime DLL bundle eksik (native-dist içinde olmalı):\n- ' + missing.join('\n- ') +
              `\n\nDLL source dir: ${dllDir}\n` +
              'İpucu: MSYS2 MinGW64 paketleri yüklü olmalı (SDL2/glew/projectM/toolchain).'
          );
        }
      }
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
