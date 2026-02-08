# WINDOWS BUILD

## Gerekli Bilesenler
- Node.js (LTS)
- Visual Studio Build Tools (C++ Desktop)
- CMake
- MSYS2 (mingw64)
- Git

## Ortam
- MSYS2 PATH: C:\msys64\mingw64\bin

## Adimlar
1. npm ci
2. cd native; npm ci; cd ..
3. Visualizer:
   - cmake -S visualizer -B build-visualizer
   - cmake --build build-visualizer --config Release
   - Copy-Item build-visualizer\aurivo-projectm-visualizer.exe native-dist\aurivo-projectm-visualizer.exe -Force
4. Kaynak kopyalama:
   - npm run prepare:win:resources
5. Build:
   - npm run build:win

## Sorun Giderme
- app.asar silinemiyor: uygulama veya electron process kapali olmali.
- ffmpeg.exe placeholder: gercek ffmpeg.exe ile degistir.
- Visualizer acilip kapanirsa: gerekli DLL'ler native-dist icinde olmali.
