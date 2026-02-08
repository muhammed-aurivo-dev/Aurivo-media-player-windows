# Aurivo Media Player (Windows)

Windows odakli depo. Linux surumu ayri repoda tutulur.

## Hizli Baslangic (Windows)
1. Gerekenler
   - Node.js (LTS)
   - Visual Studio Build Tools (C++ ile)
   - CMake, Ninja
   - MSYS2 (mingw64)

2. Kurulum
   - npm ci
   - cd native; npm ci; cd ..

3. Visualizer derleme
   - cmake -S visualizer -B build-visualizer
   - cmake --build build-visualizer --config Release
   - Copy-Item build-visualizer\aurivo-projectm-visualizer.exe native-dist\aurivo-projectm-visualizer.exe -Force

4. Windows build
   - npm run prepare:win:resources
   - npm run build:win

## Notlar
- Windows build icin BASS ve BASS_FX dll/lib dosyalari gereklidir.
- ffmpeg.exe gercek dosya ile degistirilmeli (placeholder degil).

## Dizinler
- native-dist: Windows icin kopyalanan DLL/EXE'ler
- dist: electron-builder ciktilari
