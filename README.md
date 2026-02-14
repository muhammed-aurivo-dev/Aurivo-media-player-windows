# Aurivo Media Player (Windows)

Windows odakli depo. Linux surumu ayri repoda tutulur.

## Screenshots

<details>
<summary>Goster / Gizle</summary>

![Aurivo Screenshot 1](screenshots/shot-2026-02-15-003111.png)
![Aurivo Screenshot 2](screenshots/shot-2026-02-15-003343.png)
![Aurivo Screenshot 3](screenshots/shot-2026-02-15-004004.png)
![Aurivo Screenshot 4](screenshots/shot-2026-02-15-004840.png)

</details>

## Yeni Ozellikler (2026-02-14)
- Aurivo-Dawlod indirici modulu uygulamaya entegre edildi (yan sekmeden acilir).
- Surukle-birak davranisi duzeltildi: klasor taramasi tetiklemez, sadece birakilan dosyalari ekler.
- Playlist otomatik A-Z sirali calisir (A-Z / Z-A butonu ile yon degistirilebilir).
- Ayni parca tekrar eklenmez (konum farkli olsa bile ayni isimli parcalar tekillestirilir).
- Calinan dosya silinirse: calma devam eder, listede "silindi" olarak isaretlenir; geri gelirse isaret kalkar.
- WebView kararliligi iyilestirildi ve YouTube izinli domain listesi genisletildi.

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
