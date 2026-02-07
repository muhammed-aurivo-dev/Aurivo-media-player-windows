# Windows Build Requirements

Bu proje Windows'ta **native** bileşenler içerir:
- `native/build/Release/aurivo_audio.node` (BASS tabanlı audio engine + ses efektleri)
- `native-dist/aurivo-projectm-visualizer.exe` (projectM görselleştirme)

Bu iki dosya **Windows için derlenmiş** olmalıdır (dosya başlığı `MZ`).
Linux’ta `electron-builder --win` ile installer üretmek mümkündür ama bu native dosyalar Windows’a uygun değilse (ELF) Windows 10/11’de:
- ses efektleri / native engine çalışmaz
- projectM visualizer açılmaz
- bazı video yolları/URL dönüşümleri problemli olabilir

Bu yüzden stabil bir Windows dağıtımı için en doğru yol: **Windows ortamında build** (veya CI ile Windows runner).

## CI ile Windows build (GitHub Actions)

Windows terminali / yerel Windows kurulumuyla uğraşmadan Windows çıktısı almak için en pratik yol:

- Repo’da `.github/workflows/build-windows.yml` workflow’u çalışır.
- GitHub → **Actions** sekmesi → **Build (Windows)** → **Run workflow**.
- Çıktılar **Artifacts** bölümüne `dist/*` olarak yüklenir (NSIS installer + portable zip).

> Not: Native bileşenler (`aurivo_audio.node` ve `aurivo-projectm-visualizer.exe`) Windows runner üzerinde derlenir; bu yüzden Linux’ta `electron-builder --win` ile “cross build” alıp dağıtmak yerine CI çıktısını kullanın.

## Gereksinimler (Windows 10/11)

- Node.js LTS
- Git
- Visual Studio Build Tools (C++ Desktop workload) (node-gyp için)
- (Visualizer için önerilen) MSYS2 MinGW64 veya vcpkg tabanlı toolchain

## 1) Native Audio Engine (ses efektleri) derleme

Repo kökünde:
```bash
npm ci
npm run rebuild-native
```

> Not: Bu adım `native/build/Release/aurivo_audio.node` üretir.

## 2) projectM Visualizer (aurivo-projectm-visualizer.exe) derleme

Windows’ta en pratik yol MSYS2 MinGW64 kullanmaktır (pkg-config + projectM paketleri kolay kurulur).

MSYS2 MinGW64 shell’de (örnek paketler):
```bash
pacman -S --needed mingw-w64-x86_64-toolchain mingw-w64-x86_64-cmake mingw-w64-x86_64-pkgconf \
  mingw-w64-x86_64-SDL2 mingw-w64-x86_64-SDL2_image mingw-w64-x86_64-projectm
```

Sonra proje klasöründe:
```bash
cmake -S visualizer -B build-visualizer
cmake --build build-visualizer --config Release
copy build-visualizer\\aurivo-projectm-visualizer.exe native-dist\\aurivo-projectm-visualizer.exe
```

Visualizer’ın runtime DLL’leri (SDL2, projectM, MinGW runtime) exe’nin yanında olmalıdır.
Kolay yol:
- `AURIVO_VISUALIZER_DLL_DIR` değişkenini MSYS2 `mingw64\\bin` dizinine ayarlayın (örn. `C:\\msys64\\mingw64\\bin`).
- `npm run prepare:win:resources` bunu `native-dist` içine kopyalamayı dener.

## 3) M4A/MP4 kapak (album art) için ffmpeg.exe (opsiyonel ama önerilir)

✅ **Otomatik dahil**: BASS DLL'leri build sırasında kopyalanır (`npm run build:win` içinden).

⚠️ **Manuel**: `ffmpeg.exe` binary gerekli (kapak çıkarma / bazı download akışları için).

`third_party/ffmpeg/ffmpeg.exe` konumuna gerçek `ffmpeg.exe` koyun. Build sırasında `bin/ffmpeg.exe` içine kopyalanır.

### BASS DLL'leri
BASS DLL'leri `libs/windows` altındadır ve `native/build/Release` içine kopyalanır:
- libs/windows/bass_aac.dll
- libs/windows/bass.dll, bass_fx.dll, bassape.dll, bassflac.dll, basswv.dll

#### ffmpeg.exe İndirme (örnek):
1. https://github.com/BtbN/FFmpeg-Builds/releases adresine git
2. `ffmpeg-master-latest-win64-gpl.zip` indir
3. Zip'i aç ve `ffmpeg.exe`'yi çıkar
4. `third_party/ffmpeg/ffmpeg.exe` olarak kopyala

## 4) Windows Build (NSIS Installer)

```bash
npm run build:win
```

Bu komut artık build öncesi şu kontrolleri yapar:
- `scripts/verify-win-artifacts.js`: Windows için `.node`/`.exe` gerçekten Windows binary mi?
- `native-dist/aurivo-projectm-visualizer.exe` var mı?
- BASS DLL'leri kopyalanmış mı?

## Sonuç (Windows 10/11)
- ✅ Ses efektleri / EQ / DSP: native addon çalışır
- ✅ projectM visualizer: `.exe` + gerekli DLL'ler birlikte paketlenirse çalışır
- ✅ Video: `<video>` elementinin desteklediği codec/container ile stabil (MP4/H.264/AAC en uyumlu)
