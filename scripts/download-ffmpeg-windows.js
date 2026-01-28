#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const TARGET_DIR = path.join(__dirname, '..', 'third_party', 'ffmpeg');

console.log('🔄 Windows ffmpeg binary indiriliyor...');
console.log('📁 Target:', TARGET_DIR);

// third_party/ffmpeg klasörünü oluştur
if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
}

const zipPath = path.join(TARGET_DIR, 'ffmpeg-win64.zip');
const outputPath = path.join(TARGET_DIR, 'ffmpeg.exe');

// Eğer ffmpeg.exe varsa skip et
if (fs.existsSync(outputPath)) {
    console.log('✅ ffmpeg.exe zaten mevcut');
    process.exit(0);
}

console.log('⬇️ İndiriliyor:', FFMPEG_URL);

// Basit download - production'da daha robust olmalı
const file = fs.createWriteStream(zipPath);
https.get(FFMPEG_URL, (response) => {
    response.pipe(file);
    
    file.on('finish', () => {
        file.close();
        console.log('✅ Zip indirildi');
        
        // Bu basit script - manual olarak extract edilmesi gerekiyor
        console.log('⚠️  Manuel extract gerekiyor:');
        console.log(`   1. ${zipPath} dosyasını aç`);
        console.log(`   2. ffmpeg.exe'yi ${TARGET_DIR} klasörüne çıkar`);
        console.log(`   3. ffmpeg.exe olarak rename et`);
    });
}).on('error', (err) => {
    fs.unlink(zipPath);
    console.error('❌ Download failed:', err.message);
});