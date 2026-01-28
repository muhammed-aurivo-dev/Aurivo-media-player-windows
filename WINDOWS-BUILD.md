# Windows Build Requirements

## M4A Support için Gereksinimler

### 1. Native Audio Engine
✅ **Otomatik dahil**: BASS AAC DLL'leri (`bass_aac.dll`) otomatik kopyalanır
- libs/windows/bass_aac.dll
- libs/windows/bass.dll, bass_fx.dll, bassape.dll, bassflac.dll, basswv.dll

### 2. Album Art Support (Opsiyonel)
⚠️ **Manuel**: ffmpeg.exe binary gerekli

#### ffmpeg.exe İndirme:
1. https://github.com/BtbN/FFmpeg-Builds/releases adresine git
2. `ffmpeg-master-latest-win64-gpl.zip` indir
3. Zip'i aç ve `ffmpeg.exe`'yi çıkar
4. `third_party/ffmpeg/ffmpeg.exe` olarak kopyala

#### Build:
```bash
npm run build:win
```

## Sonuç
- ✅ M4A dosyalar çalışır (BASS AAC DLL dahil)
- ✅ ffmpeg.exe varsa album kapaklar görünür
- ⚠️ ffmpeg.exe yoksa sadece album kapak çıkma çalışmaz (ses çalar)

## Kullanıcı Deneyimi
Windows kullanıcıları için hiçbir ek kurulum gerekmez:
- BASS libraries bundle'a dahil
- M4A playback çalışır
- Album art çoğu durumda çalışır (ffmpeg bundled ise)