// ============================================
// AURIVO MEDIA PLAYER - Preload Script
// Secure IPC Bridge for Native Audio Engine
// Version 2.1 - IPC-based Audio (Main Process)
// ============================================

console.log('[PRELOAD] Script başlıyor...');

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

console.log('[PRELOAD] Electron modülleri yüklendi');

// ============================================
// Native Audio Artık Main Process'te Çalışıyor
// Renderer process'te native modül yüklemiyoruz
// ============================================
let isNativeAvailable = true; // Main process'teki durumu kullanacağız

// ============================================
// EQ Frekansları (32 bant)
// ============================================
const EQ_FREQUENCIES = [
    20, 25, 31.5, 40, 50, 63, 80, 100,
    125, 160, 200, 250, 315, 400, 500, 630,
    800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
    5000, 6300, 8000, 10000, 12500, 16000, 20000, 20000
];

// ============================================
// IPC-based Audio Control API (Sound Effects Window için)
// Bu API, main process'teki audio engine'e IPC üzerinden komut gönderir
// ============================================
const createIPCAudioAPI = () => {
    return {
        eq: {
            setBand: (band, gain) => ipcRenderer.invoke('audio:setEQBand', band, gain),
            resetBands: () => ipcRenderer.invoke('audio:resetEQ'),
            getFrequencies: () => EQ_FREQUENCIES
        },
        balance: {
            set: (value) => ipcRenderer.invoke('audio:setBalance', value)
        },
        module: {
            setBass: (dB) => ipcRenderer.invoke('audio:setBass', dB),
            setMid: (dB) => ipcRenderer.invoke('audio:setMid', dB),
            setTreble: (dB) => ipcRenderer.invoke('audio:setTreble', dB),
            setStereoExpander: (percent) => ipcRenderer.invoke('audio:setStereoExpander', percent),
            reset: async () => {
                await ipcRenderer.invoke('audio:setBass', 0);
                await ipcRenderer.invoke('audio:setMid', 0);
                await ipcRenderer.invoke('audio:setTreble', 0);
                await ipcRenderer.invoke('audio:setStereoExpander', 100);
                return true;
            }
        },
        reverb: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setReverbEnabled', enabled),
            setRoomSize: (ms) => ipcRenderer.invoke('audio:setReverbRoomSize', ms),
            setDamping: (value) => ipcRenderer.invoke('audio:setReverbDamping', value),
            setWetDry: (dB) => ipcRenderer.invoke('audio:setReverbWetDry', dB),
            setHFRatio: (ratio) => ipcRenderer.invoke('audio:setReverbHFRatio', ratio),
            setInputGain: (dB) => ipcRenderer.invoke('audio:setReverbInputGain', dB),
            reset: async () => {
                await ipcRenderer.invoke('audio:setReverbEnabled', false);
                return true;
            }
        }
    };
};

// ============================================
// Safe Wrapper Functions
// ============================================
const safeCall = (fn, defaultValue = null) => {
    try {
        return fn();
    } catch (error) {
        console.error('Audio Engine Error:', error.message);
        return defaultValue;
    }
};

const safeCallAsync = async (fn, defaultValue = null) => {
    try {
        return await fn();
    } catch (error) {
        console.error('Audio Engine Error:', error.message);
        return defaultValue;
    }
};

// ============================================
// Audio API Object (IPC-Based - Main Process'e Yönlendirir)
// Artık renderer process'te native modül yüklemiyoruz
// Tüm audio işlemleri main process'teki audioEngine üzerinden
// ============================================
const createAudioAPI = () => {
    // IPC tabanlı API - main process'teki audioEngine'e çağrı yapar
    return {
        // ============================================
        // Temel Kontroller
        // ============================================
        isNativeAvailable: () => isNativeAvailable,
        
        init: async (deviceIndex = -1) => {
            // Main process zaten initialize edilmiş, sadece durumu döndür
            const available = await ipcRenderer.invoke('audio:isNativeAvailable');
            return { success: available };
        },
        
        loadFile: async (filepath) => {
            console.log('[IPC-Audio] loadFile:', filepath);
            const result = await ipcRenderer.invoke('audio:loadFile', filepath);
            return result;
        },
        
        play: () => ipcRenderer.invoke('audio:play'),
        pause: () => ipcRenderer.invoke('audio:pause'),
        stop: () => ipcRenderer.invoke('audio:stop'),
        seek: (positionMs) => ipcRenderer.invoke('audio:seek', positionMs),
        
        setVolume: (value) => ipcRenderer.invoke('audio:setVolume', value),
        getVolume: async () => {
            const vol = await ipcRenderer.invoke('audio:getVolume');
            return vol || 0;
        },
        
        getCurrentTime: async () => {
            const ms = await ipcRenderer.invoke('audio:getPosition');
            return (ms || 0) / 1000;
        },
        
        getPosition: () => ipcRenderer.invoke('audio:getPosition'),
        
        getDuration: async () => {
            const ms = await ipcRenderer.invoke('audio:getDuration');
            return (ms || 0) / 1000;
        },
        
        isPlaying: () => ipcRenderer.invoke('audio:isPlaying'),
        
        // ============================================
        // 32-Band Equalizer
        // ============================================
        eq: {
            setBand: (index, gain) => ipcRenderer.invoke('audio:setEQBand', index, gain),
            getBand: (index) => ipcRenderer.invoke('audio:getEQBand', index),
            getAllBands: () => ipcRenderer.invoke('audio:getAllEQBands'),
            setAllBands: (gains) => ipcRenderer.invoke('audio:setEQBands', gains),
            resetBands: () => ipcRenderer.invoke('audio:resetEQ'),
            getFrequencies: () => EQ_FREQUENCIES
        },
        
        // ============================================
        // Bass Boost
        // ============================================
        bass: {
            setBoost: (value) => ipcRenderer.invoke('audio:setBassBoost', value),
            getBoost: () => ipcRenderer.invoke('audio:getBassBoost')
        },
        
        // ============================================
        // Preamp
        // ============================================
        preamp: {
            set: (value) => ipcRenderer.invoke('audio:setPreamp', value),
            get: () => ipcRenderer.invoke('audio:getPreamp')
        },
        
        // ============================================
        // Auto Gain
        // ============================================
        autoGain: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setAutoGainEnabled', enabled),
            getPeakLevel: () => ipcRenderer.invoke('audio:getPeakLevel'),
            getReduction: () => ipcRenderer.invoke('audio:getGainReduction')
        },
        
        // ============================================
        // Spectrum / FFT
        // ============================================
        spectrum: {
            getFFT: () => ipcRenderer.invoke('audio:getFFTData'),
            getBands: (numBands) => ipcRenderer.invoke('audio:getSpectrumBands', numBands),
            getLevels: () => ipcRenderer.invoke('audio:getChannelLevels')
        },
        
        // ============================================
        // Balance
        // ============================================
        balance: {
            set: (value) => ipcRenderer.invoke('audio:setBalance', value),
            get: () => ipcRenderer.invoke('audio:getBalance')
        },
        
        // ============================================
        // Aurivo Module (Bass/Mid/Treble/Stereo)
        // ============================================
        module: {
            setBass: (dB) => ipcRenderer.invoke('audio:setBass', dB),
            getBass: () => ipcRenderer.invoke('audio:getBass'),
            setMid: (dB) => ipcRenderer.invoke('audio:setMid', dB),
            getMid: () => ipcRenderer.invoke('audio:getMid'),
            setTreble: (dB) => ipcRenderer.invoke('audio:setTreble', dB),
            getTreble: () => ipcRenderer.invoke('audio:getTreble'),
            setStereoExpander: (percent) => ipcRenderer.invoke('audio:setStereoExpander', percent),
            getStereoExpander: () => ipcRenderer.invoke('audio:getStereoExpander'),
            reset: async () => {
                await ipcRenderer.invoke('audio:setBass', 0);
                await ipcRenderer.invoke('audio:setMid', 0);
                await ipcRenderer.invoke('audio:setTreble', 0);
                await ipcRenderer.invoke('audio:setStereoExpander', 100);
                return true;
            }
        },
        
        // ============================================
        // Reverb
        // ============================================
        reverb: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setReverbEnabled', enabled),
            isEnabled: () => ipcRenderer.invoke('audio:isReverbEnabled'),
            setRoomSize: (ms) => ipcRenderer.invoke('audio:setReverbRoomSize', ms),
            setDamping: (value) => ipcRenderer.invoke('audio:setReverbDamping', value),
            setWetDry: (dB) => ipcRenderer.invoke('audio:setReverbWetDry', dB),
            setHFRatio: (ratio) => ipcRenderer.invoke('audio:setReverbHFRatio', ratio),
            setInputGain: (dB) => ipcRenderer.invoke('audio:setReverbInputGain', dB),
            reset: () => ipcRenderer.invoke('audio:setReverbEnabled', false)
        }
    };
};
            init: async () => ({ success: false, error: 'Native module not available' }),
            loadFile: async () => ({ success: false, error: 'Native module not available' }),
            play: () => false,
            pause: () => false,
            stop: () => false,
            seek: () => false,
            setVolume: () => false,
            getVolume: () => 0,
            getCurrentTime: () => 0,
            getPosition: () => 0,
            getDuration: () => 0,
            isPlaying: () => false,
            eq: {
                setBand: () => ({ success: false }),
                getBand: () => 0,
                getAllBands: () => new Array(32).fill(0),
                setAllBands: () => ({ success: false }),
                resetBands: () => false,
                getFrequencies: () => EQ_FREQUENCIES
            },
            bass: {
                setBoost: () => ({ success: false }),
                getBoost: () => 0
            },
            preamp: {
                set: () => ({ success: false }),
                get: () => 0
            },
            autoGain: {
                setEnabled: () => false,
                getPeakLevel: () => 0,
                getReduction: () => 1.0
            },
            spectrum: {
                getFFT: () => [],
                getBands: () => [],
                getLevels: () => ({ left: 0, right: 0 })
            },
            balance: {
                set: () => false,
                get: () => 0
            },
            module: {
                setBass: () => false,
                getBass: () => 0,
                setMid: () => false,
                getMid: () => 0,
                setTreble: () => false,
                getTreble: () => 0,
                setStereoExpander: () => false,
                getStereoExpander: () => 100,
                reset: () => false
            },
            reverb: {
                setEnabled: () => false,
                isEnabled: () => false,
                setRoomSize: () => false,
                setDamping: () => false,
                setWetDry: () => false,
                setHFRatio: () => false,
                setInputGain: () => false,
                reset: () => false
            }
        };
    }

    return {
        // ============================================
        // Temel Kontroller
        // ============================================
        
        /**
         * Native modül mevcut mu?
         */
        isNativeAvailable: () => isNativeAvailable,

        /**
         * Audio engine'i başlat
         * @param {number} deviceIndex - Cihaz indeksi (-1 = varsayılan)
         * @returns {Promise<{success: boolean, error?: string}>}
         */
        init: async (deviceIndex = -1) => {
            return safeCall(() => {
                const result = nativeAudio.initAudio(deviceIndex);
                return result;
            }, { success: false, error: 'Init failed' });
        },

        /**
         * Ses dosyası yükle
         * @param {string} filepath - Dosya yolu
         * @returns {Promise<{success: boolean, duration?: number, error?: string}>}
         */
        loadFile: async (filepath) => {
            return safeCall(() => {
                const result = nativeAudio.loadFile(filepath);
                return result;
            }, { success: false, error: 'Load failed' });
        },

        /**
         * Oynatmayı başlat
         */
        play: () => safeCall(() => nativeAudio.play(), false),

        /**
         * Duraklat
         */
        pause: () => safeCall(() => nativeAudio.pause(), false),

        /**
         * Durdur
         */
        stop: () => safeCall(() => nativeAudio.stop(), false),

        /**
         * Pozisyon atla
         * @param {number} positionMs - Milisaniye
         */
        seek: (positionMs) => safeCall(() => nativeAudio.seek(positionMs), false),

        /**
         * Master volume ayarla (0-100)
         * @param {number} value - 0-100 arası
         */
        setVolume: (value) => {
            return safeCall(() => {
                const result = nativeAudio.setMasterVolume(value);
                return result;
            }, { success: false });
        },

        /**
         * Master volume al
         * @returns {number} 0-100 arası
         */
        getVolume: () => safeCall(() => nativeAudio.getMasterVolume(), 0),

        /**
         * Mevcut pozisyon (saniye)
         * @returns {number}
         */
        getCurrentTime: () => {
            const ms = safeCall(() => nativeAudio.getCurrentPosition(), 0);
            return ms / 1000;
        },

        /**
         * Mevcut pozisyon (milisaniye) - alias
         * @returns {number}
         */
        getPosition: () => {
            return safeCall(() => nativeAudio.getCurrentPosition(), 0);
        },

        /**
         * Toplam süre (saniye)
         * @returns {number}
         */
        getDuration: () => {
            const ms = safeCall(() => nativeAudio.getDuration(), 0);
            return ms / 1000;
        },

        /**
         * Oynatılıyor mu?
         * @returns {boolean}
         */
        isPlaying: () => safeCall(() => nativeAudio.isPlaying(), false),

        // ============================================
        // 32-Band Equalizer
        // ============================================
        eq: {
            /**
             * Tek bant ayarla
             * @param {number} index - 0-31 arası bant indeksi
             * @param {number} gain - -15 ile +15 dB arası
             * @returns {{success: boolean, band?: number, gain?: number, frequency?: number}}
             */
            setBand: (index, gain) => {
                if (index < 0 || index > 31) {
                    return { success: false, error: 'Band index must be 0-31' };
                }
                if (gain < -15 || gain > 15) {
                    return { success: false, error: 'Gain must be -15 to +15 dB' };
                }
                return safeCall(() => nativeAudio.setEQBand(index, gain), { success: false });
            },

            /**
             * Tek bant değerini al
             * @param {number} index - 0-31 arası
             * @returns {number} dB cinsinden gain
             */
            getBand: (index) => {
                if (index < 0 || index > 31) return 0;
                return safeCall(() => nativeAudio.getEQBand(index), 0);
            },

            /**
             * Tüm bantların değerlerini al
             * @returns {number[]} 32 elemanlı array
             */
            getAllBands: () => {
                const bands = [];
                for (let i = 0; i < 32; i++) {
                    bands.push(safeCall(() => nativeAudio.getEQBand(i), 0));
                }
                return bands;
            },

            /**
             * Tüm bantları tek seferde ayarla
             * @param {number[]} gains - 32 elemanlı gain array
             * @returns {{success: boolean, bandsSet?: number}}
             */
            setAllBands: (gains) => {
                if (!Array.isArray(gains) || gains.length !== 32) {
                    return { success: false, error: '32 element array required' };
                }
                return safeCall(() => nativeAudio.setEQBands(gains), { success: false });
            },

            /**
             * Tüm bantları sıfırla (0 dB)
             * @returns {boolean}
             */
            resetBands: () => safeCall(() => nativeAudio.resetEQ(), false),

            /**
             * Bant frekanslarını al
             * @returns {number[]} Hz cinsinden 32 frekans
             */
            getFrequencies: () => EQ_FREQUENCIES
        },

        // ============================================
        // Bass Boost
        // ============================================
        bass: {
            /**
             * Bass boost ayarla
             * @param {number} value - 0-100 arası
             * @returns {{success: boolean, bassBoost?: number}}
             */
            setBoost: (value) => {
                if (value < 0 || value > 100) {
                    return { success: false, error: 'Bass boost must be 0-100' };
                }
                return safeCall(() => nativeAudio.setBassBoost(value), { success: false });
            },

            /**
             * Bass boost değerini al
             * @returns {number} 0-100 arası
             */
            getBoost: () => safeCall(() => nativeAudio.getBassBoost(), 0)
        },

        // ============================================
        // Pre-Amplifier
        // ============================================
        preamp: {
            /**
             * Pre-amp ayarla
             * @param {number} gain - -12 ile +12 dB arası
             * @returns {{success: boolean, preamp?: number}}
             */
            set: (gain) => {
                if (gain < -12 || gain > 12) {
                    return { success: false, error: 'Preamp must be -12 to +12 dB' };
                }
                return safeCall(() => nativeAudio.setPreAmp(gain), { success: false });
            },

            /**
             * Pre-amp değerini al
             * @returns {number} dB cinsinden
             */
            get: () => safeCall(() => nativeAudio.getPreAmp(), 0)
        },

        // ============================================
        // Auto-Gain / AGC (Automatic Gain Control)
        // ============================================
        autoGain: {
            /**
             * Auto-gain'i aç/kapa
             * @param {boolean} enabled
             */
            setEnabled: (enabled) => safeCall(() => nativeAudio.setAutoGainEnabled(enabled), false),

            /**
             * Peak seviyesi al (0.0 - 1.0+)
             * @returns {number}
             */
            getPeakLevel: () => safeCall(() => nativeAudio.getPeakLevel(), 0),

            /**
             * RMS seviyesi al (0.0 - 1.0)
             * @returns {number}
             */
            getRmsLevel: () => safeCall(() => nativeAudio.getRmsLevel(), 0),

            /**
             * Auto-gain reduction miktarı (0.0 - 1.0)
             * @returns {number}
             */
            getReduction: () => safeCall(() => nativeAudio.getAutoGainReduction(), 1.0)
        },
        
        // ============================================
        // Advanced AGC System
        // ============================================
        agc: {
            /**
             * AGC'yi aç/kapa
             * @param {boolean} enabled
             * @returns {boolean}
             */
            setEnabled: (enabled) => safeCall(() => nativeAudio.setAutoGainEnabled(enabled), false),
            
            /**
             * Clipping durumunu kontrol et
             * @returns {boolean}
             */
            isClipping: () => safeCall(() => nativeAudio.isClipping(), false),
            
            /**
             * Clipping sayısını al
             * @returns {number}
             */
            getClippingCount: () => safeCall(() => nativeAudio.getClippingCount(), 0),
            
            /**
             * Clipping sayacını sıfırla
             */
            resetClippingCount: () => safeCall(() => nativeAudio.resetClippingCount(), undefined),
            
            /**
             * Kapsamlı AGC durumu al
             * @returns {{enabled: boolean, peakLevel: number, rmsLevel: number, gainReduction: number, makeupGain: number, isClipping: boolean, clippingCount: number, peakLevelDB: number, rmsLevelDB: number, gainReductionDB: number}}
             */
            getStatus: () => safeCall(() => nativeAudio.getAGCStatus(), {
                enabled: false,
                peakLevel: 0,
                rmsLevel: 0,
                gainReduction: 1.0,
                makeupGain: 1.0,
                isClipping: false,
                clippingCount: 0,
                peakLevelDB: -96,
                rmsLevelDB: -96,
                gainReductionDB: 0
            }),
            
            /**
             * Acil gain azaltma uygula
             * @returns {boolean}
             */
            applyEmergencyReduction: () => safeCall(() => nativeAudio.applyEmergencyReduction(), false),
            
            /**
             * Preamp artırma önerisini al
             * @returns {number} dB cinsinden önerilen artış
             */
            getPreampSuggestion: () => safeCall(() => nativeAudio.getPreampSuggestion(), 0),
            
            /**
             * AGC parametrelerini ayarla
             * @param {{attackMs?: number, releaseMs?: number, threshold?: number}} params
             * @returns {boolean}
             */
            setParameters: (params) => safeCall(() => nativeAudio.setAGCParameters(params), false)
        },

        // ============================================
        // Spectrum / Visualizer
        // ============================================
        spectrum: {
            /**
             * Ham FFT verisi al
             * @returns {number[]} FFT verileri
             */
            getFFT: () => safeCall(() => nativeAudio.getFFTData(), []),

            /**
             * Spectrum bantları al
             * @param {number} numBands - İstenen bant sayısı
             * @returns {number[]}
             */
            getBands: (numBands = 64) => safeCall(() => nativeAudio.getSpectrumBands(numBands), []),

            /**
             * Sol/sağ kanal seviyeleri (VU meter için)
             * @returns {{left: number, right: number}}
             */
            getLevels: () => safeCall(() => nativeAudio.getChannelLevels(), { left: 0, right: 0 })
        },
        
        // ============================================
        // Balance Control (Sol ↔ Sağ)
        // ============================================
        balance: {
            /**
             * Balance ayarla
             * @param {number} value - -100 (sol) ile +100 (sağ) arası, 0 = orta
             * @returns {boolean}
             */
            set: (value) => {
                if (value < -100 || value > 100) {
                    return false;
                }
                return safeCall(() => {
                    nativeAudio.setBalance(value);
                    return true;
                }, false);
            },
            
            /**
             * Balance değerini al
             * @returns {number} -100 ile +100 arası
             */
            get: () => safeCall(() => nativeAudio.getBalance(), 0)
        },
        
        // ============================================
        // Aurivo Module (Bass, Mid, Treble, Stereo)
        // ============================================
        module: {
            /**
             * Bass ayarla (düşük frekanslar)
             * @param {number} dB - -15 ile +15 dB arası
             */
            setBass: (dB) => safeCall(() => {
                nativeAudio.setBass(Math.max(-15, Math.min(15, dB)));
                return true;
            }, false),
            
            getBass: () => safeCall(() => nativeAudio.getBass(), 0),
            
            /**
             * Mid ayarla (orta frekanslar)
             * @param {number} dB - -15 ile +15 dB arası
             */
            setMid: (dB) => safeCall(() => {
                nativeAudio.setMid(Math.max(-15, Math.min(15, dB)));
                return true;
            }, false),
            
            getMid: () => safeCall(() => nativeAudio.getMid(), 0),
            
            /**
             * Treble ayarla (yüksek frekanslar)
             * @param {number} dB - -15 ile +15 dB arası
             */
            setTreble: (dB) => safeCall(() => {
                nativeAudio.setTreble(Math.max(-15, Math.min(15, dB)));
                return true;
            }, false),
            
            getTreble: () => safeCall(() => nativeAudio.getTreble(), 0),
            
            /**
             * Stereo Expander ayarla
             * @param {number} percent - 0 ile 200 arası (100 = normal)
             */
            setStereoExpander: (percent) => safeCall(() => {
                nativeAudio.setStereoExpander(Math.max(0, Math.min(200, percent)));
                return true;
            }, false),
            
            getStereoExpander: () => safeCall(() => nativeAudio.getStereoExpander(), 100),
            
            /**
             * Tüm modül değerlerini sıfırla
             */
            reset: () => safeCall(() => {
                nativeAudio.setBass(0);
                nativeAudio.setMid(0);
                nativeAudio.setTreble(0);
                nativeAudio.setStereoExpander(100);
                return true;
            }, false)
        },
        
        // ============================================
        // Reverb Control (BASS FX)
        // ============================================
        reverb: {
            /**
             * Reverb'ü aç/kapa
             * @param {boolean} enabled
             */
            setEnabled: (enabled) => safeCall(() => {
                nativeAudio.setReverbEnabled(enabled);
                return true;
            }, false),
            
            isEnabled: () => safeCall(() => nativeAudio.getReverbEnabled(), false),
            
            /**
             * Room Size ayarla (reverb süresi)
             * @param {number} ms - 0.001 ile 3000 ms arası
             */
            setRoomSize: (ms) => safeCall(() => {
                nativeAudio.setReverbRoomSize(Math.max(0.001, Math.min(3000, ms)));
                return true;
            }, false),
            
            /**
             * Damping ayarla (HF sönümleme)
             * @param {number} value - 0 ile 1 arası
             */
            setDamping: (value) => safeCall(() => {
                nativeAudio.setReverbDamping(Math.max(0, Math.min(1, value)));
                return true;
            }, false),
            
            /**
             * Wet/Dry Mix ayarla
             * @param {number} dB - -96 ile 0 dB arası
             */
            setWetDry: (dB) => safeCall(() => {
                nativeAudio.setReverbWetDry(Math.max(-96, Math.min(0, dB)));
                return true;
            }, false),
            
            /**
             * High Frequency Ratio ayarla
             * @param {number} ratio - 0.001 ile 0.999 arası
             */
            setHFRatio: (ratio) => safeCall(() => {
                nativeAudio.setReverbHFRatio(Math.max(0.001, Math.min(0.999, ratio)));
                return true;
            }, false),
            
            /**
             * Input Gain ayarla
             * @param {number} dB - -96 ile 0 dB arası
             */
            setInputGain: (dB) => safeCall(() => {
                nativeAudio.setReverbInputGain(Math.max(-96, Math.min(0, dB)));
                return true;
            }, false),
            
            /**
             * Tüm reverb ayarlarını varsayılana sıfırla
             */
            reset: () => safeCall(() => {
                nativeAudio.setReverbEnabled(false);
                nativeAudio.setReverbRoomSize(1000);
                nativeAudio.setReverbDamping(0.5);
                nativeAudio.setReverbWetDry(-6);
                nativeAudio.setReverbHFRatio(0.5);
                nativeAudio.setReverbInputGain(0);
                return true;
            }, false)
        }
    };
};

// ============================================
// Context Bridge - Expose to Renderer
// ============================================
const aurivoAPI = {
    // ============================================
    // Dosya Sistemi
    // ============================================
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
    getSpecialPaths: () => ipcRenderer.invoke('fs:getSpecialPaths'),
    fileExists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    getFileInfo: (filePath) => ipcRenderer.invoke('fs:getFileInfo', filePath),

    // ============================================
    // Medya Metadata
    // ============================================
    getAlbumArt: (filePath) => ipcRenderer.invoke('media:getAlbumArt', filePath),

    // ============================================
    // Ayarlar
    // ============================================
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    loadSettings: () => ipcRenderer.invoke('settings:load'),

    // ============================================
    // Playlist
    // ============================================
    savePlaylist: (playlist) => ipcRenderer.invoke('playlist:save', playlist),
    loadPlaylist: () => ipcRenderer.invoke('playlist:load'),

    // ============================================
    // Dialog API - Klasör/Dosya Seçme
    // ============================================
    dialog: {
        openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
        openFiles: (filters) => ipcRenderer.invoke('dialog:openFiles', filters)
    },

    // ============================================
    // C++ AUDIO ENGINE API (Direct Native Access)
    // ============================================
    audio: createAudioAPI(),
    
    // ============================================
    // IPC AUDIO API (Sound Effects Window için)
    // Main process'teki audio engine'e IPC üzerinden erişim
    // ============================================
    ipcAudio: createIPCAudioAPI(),

    // ============================================
    // AUTOEQ PRESETS API
    // ============================================
    presets: {
        loadPresetList: () => ipcRenderer.invoke('presets:loadList'),
        loadPreset: (filename) => ipcRenderer.invoke('presets:load', filename),
        searchPresets: (query) => ipcRenderer.invoke('presets:search', query)
    },

    // ============================================
    // SES EFEKTLERİ PENCERESİ API
    // ============================================
    soundEffects: {
        openWindow: () => ipcRenderer.invoke('soundEffects:openWindow'),
        closeWindow: () => ipcRenderer.invoke('soundEffects:closeWindow')
    },

    // ============================================
    // ELECTRON PENCERE KONTROL API
    // ============================================
    electronAPI: {
        minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
        maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
        closeWindow: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized')
    },

    // ============================================
    // Platform & Version Info
    // ============================================
    platform: process.platform,
    version: '2.0.0',
    isNativeAudioAvailable: isNativeAvailable
};

console.log('[PRELOAD] aurivoAPI objesi oluşturuldu');
console.log('[PRELOAD] API anahtarları:', Object.keys(aurivoAPI));

// Global fallback (contextIsolation veya preload sorunlarında bile erişilebilir olsun)
try {
    globalThis.aurivo = aurivoAPI;
    console.log('[PRELOAD] globalThis.aurivo atandı');
} catch (e) {
    console.error('[PRELOAD] globalThis hata:', e.message);
}

// contextBridge ile güvenli expose
try {
    contextBridge.exposeInMainWorld('aurivo', aurivoAPI);
    console.log('[PRELOAD] ✓ contextBridge.exposeInMainWorld başarılı');
} catch (e) {
    console.error('[PRELOAD] contextBridge hata:', e.message);
}

// ============================================
// Startup Log
// ============================================
console.log('═══════════════════════════════════════');
console.log('  AURIVO MEDIA PLAYER - Preload v2.0');
console.log('═══════════════════════════════════════');
console.log(`  Platform: ${process.platform}`);
console.log(`  Native Audio: ${isNativeAvailable ? '✓ Aktif' : '✗ Pasif'}`);
console.log('═══════════════════════════════════════');
