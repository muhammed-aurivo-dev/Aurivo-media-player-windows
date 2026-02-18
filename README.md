<p align="center">
  <img src="icons/aurivo_256.png" width="120" height="120" alt="Aurivo Media Player"/>
</p>

<h1 align="center">Aurivo Media Player</h1>

<p align="center">
  Electron tabanlı gelişmiş medya oynatıcı (Windows + Linux).
</p>

<p align="center">
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux?display_name=tag&sort=semver"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/total"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/actions/workflows/release.yml">
    <img alt="Release" src="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/actions/workflows/release.yml/badge.svg"/>
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue"/>
  </a>
</p>

<p align="center">
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download AppImage" src="https://img.shields.io/badge/Download-AppImage-000000?style=for-the-badge&logo=linux&logoColor=white"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download .deb" src="https://img.shields.io/badge/Download-.deb-A81D33?style=for-the-badge&logo=debian&logoColor=white"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download .rpm" src="https://img.shields.io/badge/Download-.rpm-294172?style=for-the-badge&logo=fedora&logoColor=white"/>
  </a>
</p>

> Not: macOS paketi bu depoda hedeflenmiyor.

## Özellikler
- Müzik + video oynatma
- Gelişmiş ses efektleri / ekolayzır (BASS tabanlı)
- **projectM görselleştirici** (uygulama içinden açılır; mikrofon/sistem yakalama kullanmaz)
- Aurivo-Dawlod (indirici modülü) entegrasyonu
- Çoklu dil (TR/EN/AR) ve sistem diline uyum

## Screenshots

<details>
<summary>Goster / Gizle</summary>

![Aurivo Screenshot 1](screenshots/shot-2026-02-15-003111.png)
![Aurivo Screenshot 2](screenshots/shot-2026-02-15-003343.png)
![Aurivo Screenshot 3](screenshots/shot-2026-02-15-004004.png)
![Aurivo Screenshot 4](screenshots/shot-2026-02-15-004840.png)

</details>

## İndirme / Kurulum
En güncel sürümü **Releases** sayfasından indir:
- Windows: `Aurivo-<version>-win-x64.exe` (NSIS installer)
- Linux:
  - `Aurivo-<version>-linux-x86_64.AppImage` (en geniş uyumluluk)
  - `Aurivo-<version>-linux-amd64.deb` (Debian/Ubuntu tabanlılar)
  - `Aurivo-<version>-linux-x86_64.rpm` (Fedora/openSUSE tabanlılar)

### Dağıtım uyumluluğu (özet)
- Arch tabanlılar: Arch, CachyOS, EndeavourOS, Manjaro, Garuda
- Debian/Ubuntu tabanlılar: Debian, MX Linux, Mint, Ubuntu, Pop!_OS, Zorin, AnduinOS
- Fedora tabanlılar: Fedora, Nobara, Bazzite
- openSUSE tabanlılar: openSUSE

## Güncellemeler
- **Windows:** uygulama içinden otomatik güncelleme (GitHub Releases).
- **Linux:** AppImage için güncelleme akışı desteklenir; `deb/rpm` kurulumlarında güncelleme paket yöneticisi üzerinden yapılır.

## projectM Görselleştirici
Visualizer ayrı bir native binary’dir:
- Windows: `resources/native-dist/aurivo-projectm-visualizer.exe`
- Linux: `resources/native-dist/aurivo-projectm-visualizer`

Teknik detaylar için: `visualizer/README.md`

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

## Hızlı Başlangıç (Linux)
> Uygulama paketleri CI ile üretilir. Lokal derleme istersen:
- `npm ci`
- `npm --prefix native ci`
- `cmake -S visualizer -B build-visualizer -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build-visualizer`
- `npm run build:linux`

## Dizinler
- `native-dist`: görselleştirici binary + runtime dosyaları
- `dist`: electron-builder çıktıları

## Katkı
- Hata bildirimi / öneri: Issues
- PR: `CONTRIBUTING.md`
