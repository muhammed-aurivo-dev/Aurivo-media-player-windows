const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  return true;
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
}

main();

