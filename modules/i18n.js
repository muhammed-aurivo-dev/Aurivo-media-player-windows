/* global window, document, navigator, localStorage */

(() => {
    'use strict';

    const STORAGE_KEY = 'aurivo:lang';
    const LEGACY_STORAGE_KEY = 'locale';
    const USER_SELECTED_KEY = 'localeUserSelected';
    const SUPPORTED = [
        'ar-SA',
        'bn-BD',
        'de-DE',
        'el-GR',
        'en-US',
        'es-ES',
        'fa-IR',
        'fi-FI',
        'fr-FR',
        'hi-IN',
        'hu-HU',
        'it-IT',
        'ja-JP',
        'ne-NP',
        'pl-PL',
        'pt-BR',
        'ru-RU',
        'tr-TR',
        'uk-UA',
        'vi-VN',
        'zh-CN',
        'zh-TW'
    ];
    const DEFAULT_BY_BASE = {
        ar: 'ar-SA',
        bn: 'bn-BD',
        de: 'de-DE',
        el: 'el-GR',
        en: 'en-US',
        es: 'es-ES',
        fa: 'fa-IR',
        fi: 'fi-FI',
        fr: 'fr-FR',
        hi: 'hi-IN',
        hu: 'hu-HU',
        it: 'it-IT',
        ja: 'ja-JP',
        ne: 'ne-NP',
        pl: 'pl-PL',
        pt: 'pt-BR',
        ru: 'ru-RU',
        tr: 'tr-TR',
        uk: 'uk-UA',
        vi: 'vi-VN',
        zh: 'zh-CN'
    };
    const RTL_LANGS = new Set(['ar', 'fa']);
    const cache = new Map();

    let currentLang = null;
    const listeners = new Set();

    function normalizeLang(lang) {
        if (!lang) return null;
        const raw = String(lang).trim().replace('_', '-');
        const [basePart, regionPart] = raw.split('-');
        const base = String(basePart || '').toLowerCase();
        const region = regionPart ? String(regionPart).toUpperCase() : '';

        if (base && region) {
            const full = `${base}-${region}`;
            if (SUPPORTED.includes(full)) return full;
        }

        return DEFAULT_BY_BASE[base] || null;
    }

    function deepGet(obj, path) {
        if (!obj || typeof obj !== 'object') return undefined;
        const parts = String(path).split('.').filter(Boolean);
        let cur = obj;
        for (const p of parts) {
            if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    function deepSet(obj, path, value) {
        if (!obj || typeof obj !== 'object') return;
        const parts = String(path).split('.').filter(Boolean);
        if (!parts.length) return;
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = value;
    }

    const ABOUT_COMMON_FALLBACK = {
        'about.featuresTitle': 'Features & Transparency',
        'about.sections.app.title': 'App Features',
        'about.sections.app.item1': 'Combines music, video and web experience in a single interface.',
        'about.sections.app.item2': 'Provides dual-player structure, playlist support and media controls.',
        'about.sections.app.item3': 'Works with multi-language support and system language detection.',
        'about.sections.web.title': 'Web Features',
        'about.sections.web.item1': 'Supports YouTube, Spotify, SoundCloud, Mixcloud and social platforms.',
        'about.sections.web.item2': 'Sessions are kept in a secure web partition (persist partition).',
        'about.sections.web.item3': 'Navigation works only with allowed and validated URL rules.',
        'about.sections.security.title': 'Security & Privacy',
        'about.sections.security.item1': 'Sensitive data like email/password/token is not stored in app settings.',
        'about.sections.security.item2': 'Web view is protected with sandbox, permission controls and domain restrictions.',
        'about.sections.security.item3': 'Open in external browser is enabled only for valid http/https URLs.',
        'about.sections.sfx.title': 'Sound Effects Features',
        'about.sections.sfx.item1': 'Includes 32-band EQ, compressor, limiter, reverb, crossfeed and other DSP modules.',
        'about.sections.sfx.item2': 'Provides preset system and real-time parameter control.',
        'about.sections.sfx.item3': 'Limits inactive effect animations for better resource usage.',
        'about.sections.visual.title': 'Visualization Features',
        'about.sections.visual.item1': 'Offers multiple analyzer modes and performance settings.',
        'about.sections.visual.item2': 'FPS and visual effect options are fully user-controlled.',
        'about.sections.visual.item3': 'Produces low-latency live visual feedback synced with audio.'
    };

    const LOCALE_OVERRIDES = {
        'ar-SA': {
            'app.title': 'Aurivo Media Player',
            'sidebar.files': 'الملفات',
            'sidebar.videos': 'الفيديو',
            'sidebar.music': 'الموسيقى',
            'sidebar.web': 'الويب',
            'sidebar.security': 'الأمان',
            'sidebar.settings': 'الإعدادات',
            'sidebar.about': 'حول',
            'about.featuresTitle': 'الميزات والشفافية',
            'about.sections.app.title': 'ميزات التطبيق',
            'about.sections.app.item1': 'يجمع الموسيقى والفيديو والويب في واجهة واحدة.',
            'about.sections.app.item2': 'يوفر بنية تشغيل مزدوجة وقوائم تشغيل وتحكمًا كاملاً بالوسائط.',
            'about.sections.app.item3': 'يدعم تعدد اللغات مع اكتشاف لغة النظام.',
            'about.sections.web.title': 'ميزات الويب',
            'about.sections.web.item1': 'يدعم YouTube وSpotify وSoundCloud وMixcloud ومنصات اجتماعية.',
            'about.sections.web.item2': 'تُحفظ الجلسات داخل قسم ويب آمن (persist partition).',
            'about.sections.web.item3': 'التصفح يعمل فقط ضمن قواعد URL المسموح بها والمتحقق منها.',
            'about.sections.security.title': 'الأمان والخصوصية',
            'about.sections.security.item1': 'لا يتم حفظ البريد الإلكتروني أو كلمة المرور أو الرموز الحساسة في الإعدادات.',
            'about.sections.security.item2': 'عرض الويب محمي بالعزل (sandbox) والتحكم في الأذونات وتقييد النطاقات.',
            'about.sections.security.item3': 'الفتح في المتصفح الخارجي يُفعّل فقط لعناوين http/https الصالحة.',
            'about.sections.sfx.title': 'ميزات المؤثرات الصوتية',
            'about.sections.sfx.item1': 'يتضمن EQ بـ 32 نطاقًا، وضاغطًا، ومحددًا، وريڤيرب، وCrossfeed ووحدات DSP أخرى.',
            'about.sections.sfx.item2': 'يوفر نظام Preset وتحكمًا فوريًا في المعلمات.',
            'about.sections.sfx.item3': 'يتم تقليل الرسوم غير النشطة لتحسين استهلاك الموارد.',
            'about.sections.visual.title': 'ميزات التصور البصري',
            'about.sections.visual.item1': 'يوفر عدة أوضاع analyzer وإعدادات أداء.',
            'about.sections.visual.item2': 'خيارات FPS والتأثيرات البصرية تحت تحكم المستخدم.',
            'about.sections.visual.item3': 'يقدم تغذية بصرية حية منخفضة التأخير متزامنة مع الصوت.',
            'panel.library': 'المكتبة',
            'panel.internet': 'الإنترنت',
            'panel.loading': 'جارٍ التحميل...',
            'libraryActions.addFolder': 'إضافة مجلد',
            'libraryActions.addFiles': 'إضافة ملفات',
            'libraryActions.openVideo': 'فتح فيديو',
            'nowPlaying.prefix': 'يتم التشغيل الآن',
            'nowPlaying.ready': 'يتم التشغيل الآن: Aurivo Player - جاهز',
            'nowPlaying.none': 'لا يوجد مقطع',
            'nowPlaying.unknownTrack': 'مقطع غير معروف',
            'nowPlaying.unknownArtist': 'فنان غير معروف',
            'web.media': 'وسائط الويب',
            'settings.title': 'التفضيلات',
            'settings.tabs.playback': 'التشغيل',
            'settings.tabs.behavior': 'السلوك',
            'settings.tabs.library': 'مكتبة الموسيقى',
            'settings.tabs.audio': 'مخرج الصوت',
            'settings.buttons.ok': 'موافق',
            'settings.buttons.apply': 'تطبيق',
            'settings.buttons.cancel': 'إلغاء',
                        'controls.prev': 'السابق',
            'controls.next': 'التالي',
            'controls.rewind10': 'رجوع 10 ثوانٍ',
            'controls.forward10': 'تقديم 10 ثوانٍ',
            'controls.playPause': 'تشغيل/إيقاف مؤقت',
            'controls.shuffle': 'خلط',
            'controls.repeat': 'تكرار',
            'controls.volume': 'الصوت',
            'controls.visual': 'المُصوِّر',
            'controls.eq': 'مؤثرات الصوت (EQ)',
                        'controls.clearPlaylist': 'مسح قائمة التشغيل',
            'nav.back': 'رجوع',
            'nav.forward': 'تقدم',
            'nav.reload': 'إعادة تحميل',
            'visualizerMenu.framerate': 'معدل الإطارات',
            'visualizerMenu.framerateLow': 'منخفض (20 fps)',
            'visualizerMenu.framerateMedium': 'متوسط (25 fps)',
            'visualizerMenu.framerateHigh': 'عالٍ (30 fps)',
            'visualizerMenu.framerateUltra': 'عالٍ جدًا (60 fps)',
            'visualizerMenu.analyzers.bar': 'محلل الأعمدة',
            'visualizerMenu.analyzers.block': 'محلل الكتل',
            'visualizerMenu.analyzers.boom': 'محلل بوم',
            'visualizerMenu.analyzers.sonogram': 'سونوجرام',
            'visualizerMenu.analyzers.turbine': 'توربين',
            'visualizerMenu.analyzers.nyanalyzer': 'نياناليزر كات',
            'visualizerMenu.analyzers.rainbow': 'رينبو داش',
            'visualizerMenu.analyzers.none': 'بدون محلل',
            'visualizerMenu.psychedelic': 'استخدم الألوان السيكيديليّة',
            'visualizerMenu.visuals': 'المؤثرات البصرية',
            'visualizerMenu.effects.glow': 'تأثير التوهج',
            'visualizerMenu.effects.reflection': 'انعكاس',
            'sfx.windowTitle': 'مؤثرات الصوت — Aurivo Media Player',
            'sfx.tabs.effects': 'المؤثرات',
            'sfx.tabs.presets': 'الإعدادات المسبقة',
            'sfx.masterToggle': 'تفعيل مؤثرات الصوت',
            'sfx.dspStatusInitial': 'DSP: قيد التشغيل • PY: قيد التشغيل • النشط: 0',
            'sfx.dspStatus': 'DSP: {dsp} • PY: {py} • النشط: {active}',
            'sfx.on': 'تشغيل',
            'sfx.off': 'إيقاف',
            'sfx.window.minimize': 'تصغير',
            'sfx.window.maximize': 'تكبير/استعادة',
            'sfx.window.maximizeOnly': 'تكبير',
            'sfx.window.restore': 'استعادة',
            'sfx.window.close': 'إغلاق',
            'sfx.ui.enable': 'تفعيل',
            'sfx.ui.reset': 'إعادة ضبط',
            'sfx.ui.resetModule': 'إعادة ضبط الوحدة',
            'sfx.ui.presets': 'الإعدادات المسبقة',
            'sfx.ui.presetFallback': 'إعداد مسبق',
            'sfx.ui.notImplemented': 'هذا التأثير غير مُنفَّذ بعد.',
            'sfx.effects.eq32': 'المعادل (32 نطاقًا)',
            'sfx.effects.reverb': 'ريفيرب (BASS FX)',
            'sfx.effects.compressor': 'ضاغط ديناميكي',
            'sfx.effects.limiter': 'محدِّد',
            'sfx.effects.bassboost': 'معزّز الجهير',
            'sfx.effects.noisegate': 'بوابة ضوضاء ذكية',
            'sfx.effects.deesser': 'دي-إسر',
            'sfx.effects.exciter': 'إكسايتر',
            'sfx.effects.stereowidener': 'توسيع ستيريو v2',
            'sfx.effects.echo': 'إيكو',
            'sfx.effects.convreverb': 'ريفيرب الالتفاف (IR)',
            'sfx.effects.peq': 'معادل بارامتري (PEQ)',
            'sfx.effects.autogain': 'كسب تلقائي / تطبيع',
            'sfx.effects.truepeak': 'محدد True Peak + مقياس',
            'sfx.effects.crossfeed': 'كروسفيد (سماعات)',
            'sfx.effects.bassmono': 'الجهير الأحادي',
            'sfx.effects.dynamiceq': 'المعادل الديناميكي',
            'sfx.effects.tapesat': 'تشبّع شريطي',
            'sfx.effects.bitdither': 'عمق بت / Dither',
            'sfx.peq.title': 'المعادل البارامتري (6 نطاقات)',
            'sfx.peq.description': 'معادل بارامتري كامل من 6 نطاقات مع اختيار نوع المرشح',
            'sfx.peq.bands.subBass': 'ساب-باس',
            'sfx.peq.bands.bass': 'باس',
            'sfx.peq.bands.lowMid': 'منخفض-متوسط',
            'sfx.peq.bands.mid': 'متوسط',
            'sfx.peq.bands.highMid': 'مرتفع-متوسط',
            'sfx.peq.bands.high': 'مرتفع',
            'sfx.eq32.title': 'معادل احترافي 32 نطاقًا',
            'sfx.eq32.description': 'شكّل صوتك بتحكم دقيق في الترددات.',
            'sfx.eq32.moduleTitle': 'وحدة Aurivo',
            'sfx.eq32.acousticSpace.label': 'المساحة الصوتية:',
            'sfx.eq32.acousticSpace.off': 'إيقاف',
            'sfx.eq32.acousticSpace.small': 'غرفة صغيرة',
            'sfx.eq32.acousticSpace.medium': 'غرفة متوسطة',
            'sfx.eq32.acousticSpace.large': 'غرفة كبيرة',
            'sfx.eq32.acousticSpace.hall': 'قاعة حفلات',
            'sfx.balance.title': 'التوازن (يسار ↔ يمين)',
            'sfx.balance.center': 'الوسط ({pct}%)',
            'sfx.balance.left': 'يسار ({pct}%)',
            'sfx.balance.right': 'يمين ({pct}%)',
            'sfx.reverb.description': 'محاكاة غرفة احترافية باستخدام BASS_FX_DX8_REVERB.',
            'sfx.reverb.presets.smallRoom': 'غرفة صغيرة',
            'sfx.reverb.presets.largeRoom': 'غرفة كبيرة',
            'sfx.reverb.presets.concertHall': 'قاعة حفلات',
            'sfx.reverb.presets.cathedral': 'كاتدرائية',
            'sfx.compressor.title': 'ضاغط ديناميكي',
            'sfx.compressor.description': 'يتحكم في المدى الديناميكي بخفض الأجزاء العالية.',
            'sfx.bassboost.title': 'معزّز الجهير',
            'sfx.bassboost.description': 'يعزّز الترددات المنخفضة بالتوافقيات.',
            'sfx.descriptions.limiter': 'يحد المستوى الأقصى لمنع التشويه.',
            'sfx.descriptions.noisegate': 'يقطع الصوت تحت عتبة محددة.',
            'sfx.descriptions.deesser': 'يخفف أصوات "س" الحادة.',
            'sfx.descriptions.exciter': 'يضيف توافقيات لإضاءة الصوت.',
            'sfx.descriptions.stereowidener': 'يوسّع عرض وعمق الاستريو.',
            'sfx.descriptions.echo': 'تأثير صدى قائم على التأخير.',
            'sfx.descriptions.convreverb': 'ريفيرب باستجابات نبضية حقيقية.',
            'sfx.descriptions.autogain': 'تطبيع تلقائي لمستوى الصوت.',
            'sfx.descriptions.truepeak': 'تحديد True Peak احترافي ومقياس ستيريو.',
            'sfx.descriptions.crossfeed': 'يحاكي تجربة مكبرات الصوت على السماعات بمزج القنوات.',
            'sfx.descriptions.bassmono': 'يجعل الترددات المنخفضة أحادية لتحسين التوافق.',
            'sfx.descriptions.dynamiceq': 'يضبط الـ EQ تلقائيًا وفق ديناميكيات النطاق.',
            'sfx.crossfeed.info.title': 'ℹ️ ما هو كروسفيد؟',
            'sfx.crossfeed.info.body1': 'عند الاستماع بالسماعات، تسمع الأذن اليسرى القناة اليسرى فقط، وتسمع الأذن اليمنى القناة اليمنى فقط. هذا غير طبيعي؛ مع السماعات الخارجية تسمع كل أذن جزءًا من القناتين (بشكل خفيف).',
            'sfx.crossfeed.info.body2': 'يحاكي هذا المزج الطبيعي:',
            'sfx.crossfeed.info.benefit1': 'يقلل إجهاد الاستماع الستيريو',
            'sfx.crossfeed.info.benefit2': 'مجال صوتي أكثر طبيعية',
            'sfx.crossfeed.info.benefit3': 'راحة أكبر في الجلسات الطويلة',
            'sfx.crossfeed.info.benefit4': 'إحساس أقرب للسماعات الخارجية',
            'sfx.crossfeed.info.noteLabel': 'ملاحظة:',
            'sfx.crossfeed.info.noteBody': 'استخدمه عند الاستماع بالسماعات فقط! لا حاجة له غالبًا مع السماعات الخارجية.',
            'sfx.bassmono.info.title': 'ℹ️ ما هو الجهير الأحادي؟',
            'sfx.bassmono.info.body': 'يقوم بتحويل ما تحت تردد القطع (Cutoff) إلى أحادي (L+R)/2. هذا يعطي جهيرًا أقوى في أنظمة النوادي، ويساعد على منع قفز الإبرة في الفينيل، ويحسن وضوح الميكس العام.',
            'sfx.dynamiceq.info.title': 'ℹ️ ما هو المعادل الديناميكي؟',
            'sfx.dynamiceq.info.body': 'عند تجاوز مستوى نطاق التردد المحدد للعتبة، يطبق EQ تلقائيًا. مع Gain سلبي يمكنك تقليل الحدة (de-harsh)، ومع Gain إيجابي يمكنك تعزيزًا ديناميكيًا.',
            'sfx.descriptions.tapesat': 'يضيف دفء الشريط التناظري والتشبع.',
            'sfx.descriptions.bitdither': 'تقليل عمق البت والدثر لطابع lo-fi أو تحويل احترافي.',
            'sfx.noisegate.gateStatusLabel': 'حالة البوابة:',
            'sfx.crossfeed.statusChecking': 'حالة DSP: جارٍ الفحص…',
            'sfx.crossfeed.presetDescriptions.0': '🎧 طبيعي: تجربة شبيهة بمكبرات الصوت (موصى به)',
            'sfx.crossfeed.presetDescriptions.1': '🎵 خفيف: Crossfeed خفيف',
            'sfx.crossfeed.presetDescriptions.2': '💪 قوي: Crossfeed واضح',
            'sfx.crossfeed.presetDescriptions.3': '🌌 واسع: مساحة أوسع',
            'sfx.crossfeed.presetDescriptions.4': '⚙️ مخصص: إعداداتك اليدوية',
            'sfx.footer.engineInfo': 'محرك Aurivo DSP v3.0 • 48kHz / معالجة 32-bit Float',
            'sfx.nativeUnavailable': '⚠️ مؤثرات الصوت غير متاحة: لم يتم تحميل محرك الصوت الأصلي. يعمل التشغيل الأساسي فقط.',
            'sfx.tapesat.statusLabel': 'حالة DSP:',
            'sfx.tapesat.statusAttached': 'متصل (أولوية Mastering 12)',
            'sfx.crossfeed.attached': 'متصل',
            'sfx.crossfeed.detached': 'غير متصل',
            'sfx.crossfeed.errorLabel': 'خطأ',
            'sfx.crossfeed.statusLine': 'حالة DSP: {attached} | Callback: {count}{errText}',
            'sfx.crossfeed.statusUnreadable': 'حالة DSP: غير قابلة للقراءة',
            'sfx.truepeak.clipping': 'القصّ:',
            'sfx.truepeak.gainReduction': 'خفض الكسب:',
            'sfx.truepeak.oversampling': 'زيادة العيّنة:',
            'sfx.convreverb.irPresets': 'الإعدادات المسبقة لـ IR',
            'sfx.convreverb.presets.hall': 'قاعة حفلات',
            'sfx.convreverb.presets.church': 'كنيسة',
            'sfx.convreverb.presets.room': 'غرفة',
            'sfx.convreverb.presets.plate': 'صفيحة',
            'sfx.bassmono.presets.vinyl': 'آمن للفينيل',
            'sfx.bassmono.presets.club': 'نظام النادي',
            'sfx.bassmono.presets.mastering': 'ماسترينغ',
            'sfx.bassmono.presets.dj': 'مكس DJ',
            'sfx.bassmono.presets.sub': 'ساب فقط',
            'sfx.bassmono.slopeLabel': 'الانحدار',
            'sfx.dynamiceq.presets.deharsh': 'تخفيف الحدّة (3-5kHz)',
            'sfx.dynamiceq.presets.demud': 'إزالة العكارة (200-400Hz)',
            'sfx.dynamiceq.presets.vocal': 'حضور الفوكال',
            'sfx.dynamiceq.presets.deesser': 'دي-إسر ديناميكي',
            'sfx.dynamiceq.presets.basstighten': 'شدّ الجهير',
            'sfx.dynamiceq.presets.air': 'لمعة الهواء',
            'sfx.dynamiceq.presets.drumsnap': 'طرقة الدرامز',
            'sfx.dynamiceq.presets.warmth': 'دفء تناظري',
            'sfx.tapesat.presets.subtle': 'دفء خفيف',
            'sfx.tapesat.presets.glue': 'تماسك الماستر',
            'sfx.tapesat.presets.crisp': 'شريط واضح',
            'sfx.tapesat.presets.lofi': 'شريط Lo-fi',
            'sfx.bitdither.presets.cd16': 'ماسترينغ CD (16-bit)',
            'sfx.bitdither.presets.retro12': 'ريترو 12-bit',
            'sfx.bitdither.presets.game8': 'ألعاب 8-bit',
            'sfx.bitdither.presets.vinyl': 'فينيل Lo-fi',
            'sfx.bitdither.presets.crunch': 'Crunch خفيف',
            'sfx.knob.eq32.bass': 'جهير (100 Hz)',
            'sfx.knob.eq32.mid': 'متوسط (500Hz-2kHz)',
            'sfx.knob.eq32.treble': 'حادّ (10 kHz)',
            'sfx.knob.eq32.stereoExpander': 'موسّع الستيريو',
            'sfx.knob.param.roomSize': 'حجم الغرفة',
            'sfx.knob.param.damping': 'التخميد',
            'sfx.knob.param.wetDry': 'مزج رطب/جاف',
            'sfx.knob.param.hfRatio': 'نسبة الترددات العالية',
            'sfx.knob.param.inputGain': 'كسب الإدخال',
            'sfx.knob.param.threshold': 'العتبة',
            'sfx.knob.param.ratio': 'النسبة',
            'sfx.knob.param.attack': 'الهجوم',
            'sfx.knob.param.release': 'التحرر',
            'sfx.knob.param.makeupGain': 'كسب التعويض',
            'sfx.knob.param.knee': 'الركبة',
            'sfx.knob.param.ceiling': 'السقف',
            'sfx.knob.param.lookahead': 'الاستباق',
            'sfx.knob.param.gain': 'الكسب',
            'sfx.knob.param.frequency': 'التردد',
            'sfx.knob.param.harmonics': 'التوافقيات',
            'sfx.knob.param.width': 'العرض',
            'sfx.knob.param.mix': 'المزج',
            'sfx.knob.param.hold': 'التثبيت',
            'sfx.knob.param.range': 'النطاق',
            'sfx.knob.param.amount': 'الكمية',
            'sfx.knob.param.centerLevel': 'مستوى المركز',
            'sfx.knob.param.sideLevel': 'مستوى الجوانب',
            'sfx.knob.param.bassToMono': 'تحويل الجهير إلى أحادي',
            'sfx.knob.param.delay': 'التأخير',
            'sfx.knob.param.feedback': 'الارتداد',
            'sfx.knob.param.highCut': 'قطع عالي',
            'sfx.knob.param.lowCut': 'قطع منخفض',
            'sfx.knob.param.predelay': 'تأخير مسبق',
            'sfx.knob.param.freq': 'التردد',
            'sfx.knob.param.q': 'عامل Q',
            'sfx.knob.param.targetLevel': 'المستوى المستهدف',
            'sfx.knob.param.maxGain': 'أقصى كسب',
            'sfx.knob.param.level': 'المستوى',
            'sfx.knob.param.cutoff': 'تردد القطع',
            'sfx.knob.param.stereoWidth': 'عرض الستيريو',
            'sfx.knob.param.driveDb': 'الدفع',
            'sfx.knob.param.tone': 'النبرة',
            'sfx.knob.param.outputDb': 'خرج',
            'sfx.knob.param.hiss': 'هس الشريط',
            'playback.title': 'التشغيل',
            'playback.crossfade.title': 'انتقال سلس',
            'playback.crossfade.stop': 'تلاشي عند إيقاف المقطع',
            'playback.crossfade.manual': 'تداخل يدوي عند تبديل المقاطع',
            'playback.crossfade.auto': 'تداخل تلقائي عند تبديل المقاطع',
            'playback.crossfade.sameAlbumExcept': 'باستثناء مقاطع الألبوم نفسه / ملف CUE',
            'playback.crossfade.duration': 'مدة التداخل',
            'playback.crossfade.fadeOnPause': 'تلاشي عند الإيقاف المؤقت / ظهور تدريجي عند الاستئناف',
            'playback.crossfade.pauseFadeDuration': 'مدة التلاشي',
            'ui.languageSelection.title': 'اختيار اللغة',
            'ui.languageSelection.label': 'اللغة',
            'ui.languageSelection.hint': 'يتطلب إعادة التشغيل لتطبيق التغييرات.',
            'ui.languageSelection.restartHint': 'سيتم تطبيق اللغة المختارة عند التشغيل القادم.',
            'restart.title': 'إعادة التشغيل مطلوبة',
            'restart.message': 'لتطبيق تغيير اللغة يجب إعادة تشغيل التطبيق. هل تريد إعادة التشغيل الآن؟',
            'restart.yes': 'نعم',
            'restart.no': 'لا',
            'appMenu.file': 'ملف',
            'appMenu.edit': 'تحرير',
            'appMenu.view': 'عرض',
            'appMenu.window': 'نافذة',
            'appMenu.help': 'مساعدة',
            'appMenu.quit': 'خروج',
            'appMenu.close': 'إغلاق',
            'appMenu.minimize': 'تصغير',
            'appMenu.reload': 'إعادة تحميل',
            'appMenu.toggleDevTools': 'أدوات المطور',
            'appMenu.resetZoom': 'إعادة تعيين التكبير',
            'appMenu.zoomIn': 'تكبير',
            'appMenu.zoomOut': 'تصغير التكبير',
            'appMenu.toggleFullscreen': 'ملء الشاشة',
            'appMenu.undo': 'تراجع',
            'appMenu.redo': 'إعادة',
            'appMenu.cut': 'قص',
            'appMenu.copy': 'نسخ',
            'appMenu.paste': 'لصق',
            'appMenu.selectAll': 'تحديد الكل',
            'securityPage.title': 'الأمان',
            'securityPage.heroTitle': 'إنترنت Aurivo الآمن',
            'securityPage.heroSub': 'استخدم تبويب الويب بشكل أكثر أمانًا وتحكمًا.',
            'securityPage.sections.currentSite': 'الموقع الحالي',
            'securityPage.sections.controls': 'عناصر التحكم',
            'securityPage.sections.cleanup': 'التنظيف',
            'securityPage.sections.allowedPlatforms': 'المنصات المسموح بها',
            'securityPage.buttons.copy': 'نسخ',
            'securityPage.buttons.openInBrowser': 'فتح في المتصفح',
            'securityPage.buttons.clearCookies': 'مسح ملفات تعريف الارتباط',
            'securityPage.buttons.clearCache': 'مسح ذاكرة التخزين المؤقت',
            'securityPage.buttons.clearAll': 'مسح الكل',
            'securityPage.buttons.resetWeb': 'إعادة ضبط الويب',
            'securityPage.allowPopups': 'السماح بالنوافذ المنبثقة (قد يلزم لبعض تسجيلات الدخول)',
            'securityPage.vpnPolicyLabel': 'حظر الويب عند اكتشاف VPN',
            'securityPage.vpnPolicyHint': 'مستحسن: اتركه مغلقًا. عند وجود VPN سيظهر تحذير فقط، والمواقع خارج المنصات المسموحة محجوبة أصلًا.',
            'securityPage.allowPopupsHint': 'ملاحظة: عند تعطيل النوافذ المنبثقة، قد لا تعمل بعض روابط تسجيل الدخول/الحساب.',
            'securityPage.cleanupHint': 'مسح الكوكيز/الكاش قد يؤدي إلى تسجيل خروجك من بعض المواقع.',
            'securityPage.allowedPlatformsHint': 'يستهدف Aurivo المنصات التالية في تبويب الويب (CSP/frame-src):',
            'securityPage.dynamic.urlLine': 'الرابط: {url}',
            'securityPage.dynamic.connSecure': 'الاتصال: آمن (HTTPS)',
            'securityPage.dynamic.connInsecure': 'الاتصال: غير آمن (HTTP)',
            'securityPage.dynamic.connUnknown': 'الاتصال: -',
            'securityPage.dynamic.vpnUnknown': 'VPN: -',
            'securityPage.dynamic.vpnDetected': 'VPN: تم الكشف ({interfaces})',
            'securityPage.dynamic.vpnNotDetected': 'VPN: غير مكتشف',
            'securityPage.notify.urlCopied': 'تم نسخ الرابط.',
            'securityPage.notify.urlCopyFailed': 'تعذر نسخ الرابط: {error}',
            'securityPage.notify.openInBrowserFailed': 'تعذر الفتح في المتصفح.',
            'securityPage.notify.openInBrowserError': 'تعذر الفتح في المتصفح: {error}',
            'securityPage.notify.clearFailed': 'فشل التنظيف.',
            'securityPage.notify.clearError': 'خطأ أثناء التنظيف: {error}',
            'securityPage.notify.cookiesCleared': 'تم مسح الكوكيز.',
            'securityPage.notify.cacheCleared': 'تم مسح الكاش.',
            'securityPage.notify.allCleared': 'تم مسح بيانات الويب.',
            'securityPage.notify.webResetOk': 'تمت إعادة ضبط الويب.',
            'securityPage.notify.webResetFailed': 'تعذرت إعادة ضبط الويب: {error}',
            'securityPage.notify.invalidExternalUrl': 'افتح أولًا صفحة ويب صالحة (http/https).',
            'securityPage.notify.vpnBlocked': 'تم اكتشاف VPN. تم تعطيل تبويب الويب مؤقتًا لأسباب أمنية.',
            'securityPage.notify.vpnWarning': 'تم اكتشاف VPN. لأسباب أمنية سيتم السماح بالمنصات المعتمدة فقط.',
            'securityPage.notify.urlBlocked': 'تم حظر هذا العنوان بسبب سياسة الأمان.'
        },
        'en-US': {
            'sfx.peq.title': 'Parametric EQ (6-Band)',
            'sfx.peq.description': '6-band full parametric EQ with filter type selection',
            'sfx.peq.bands.subBass': 'Sub-Bass',
            'sfx.peq.bands.bass': 'Bass',
            'sfx.peq.bands.lowMid': 'Low-Mid',
            'sfx.peq.bands.mid': 'Mid',
            'sfx.peq.bands.highMid': 'High-Mid',
            'sfx.peq.bands.high': 'High',
            'sfx.crossfeed.info.title': 'ℹ️ What is Crossfeed?',
            'sfx.crossfeed.info.body1': 'When listening on headphones, the left ear hears only the left channel and the right ear hears only the right channel. This is unnatural; on speakers each ear hears a little of both channels.',
            'sfx.crossfeed.info.body2': 'simulates this natural blend:',
            'sfx.crossfeed.info.benefit1': 'Reduces stereo listening fatigue',
            'sfx.crossfeed.info.benefit2': 'More natural soundstage',
            'sfx.crossfeed.info.benefit3': 'Better comfort in long sessions',
            'sfx.crossfeed.info.benefit4': 'More speaker-like experience',
            'sfx.crossfeed.info.noteLabel': 'Note:',
            'sfx.crossfeed.info.noteBody': 'Use it mainly with headphones. It is usually unnecessary on speakers.',
            'securityPage.notify.invalidExternalUrl': 'Open a valid web page first (http/https).',
            'securityPage.notify.vpnBlocked': 'VPN detected. Web tab is temporarily blocked for security.',
            'securityPage.notify.vpnWarning': 'VPN detected. For security, only approved platforms will be allowed.',
            'securityPage.notify.urlBlocked': 'This address is blocked by security policy.',
            'securityPage.vpnPolicyLabel': 'Block Web access when VPN is detected',
            'securityPage.vpnPolicyHint': 'Recommended: keep this off. With VPN, app will warn only; non-approved websites are already blocked.',
            'securityPage.dynamic.vpnUnknown': 'VPN: -',
            'securityPage.dynamic.vpnDetected': 'VPN: Detected ({interfaces})',
            'securityPage.dynamic.vpnNotDetected': 'VPN: Not detected',
            'sfx.crossfeed.presetDescriptions.0': '🎧 Natural: Speaker-like stereo experience (Recommended)',
            'sfx.crossfeed.presetDescriptions.1': '🎵 Mild: Gentle crossfeed, minimal fatigue reduction',
            'sfx.crossfeed.presetDescriptions.2': '💪 Strong: Strong crossfeed, clearly speaker-like feel',
            'sfx.crossfeed.presetDescriptions.3': '🌌 Wide: Wider stage, spatial feel',
            'sfx.crossfeed.presetDescriptions.4': '⚙️ Custom: Your manual settings',
            'sfx.bassmono.slopeLabel': 'Slope',
            'sfx.bassmono.info.title': 'ℹ️ What is Bass Mono?',
            'sfx.bassmono.info.body': 'Converts frequencies below the cutoff to Mono as (L+R)/2. This provides stronger bass on club systems, helps prevent needle skipping on vinyl, and improves overall mix clarity.',
            'sfx.dynamiceq.info.title': 'ℹ️ What is Dynamic EQ?',
            'sfx.dynamiceq.info.body': 'When the selected frequency band exceeds the threshold, EQ is applied automatically. Use negative gain for de-harshing and positive gain for dynamic boost.'
        },
        'tr-TR': {
            'app.title': 'Aurivo Medya Player',
            'settings.title': 'Tercihler',
            'settings.tabs.playback': 'Oynat',
            'settings.tabs.behavior': 'Davranış',
            'settings.tabs.library': 'Müzik Kütüphanesi',
            'settings.tabs.audio': 'Ses Çıkışı',
            'libraryActions.addFolder': 'Klasör Ekle',
            'libraryActions.addFiles': 'Dosya Ekle',
            'libraryActions.openVideo': 'Video Aç',
            'nowPlaying.prefix': 'Şu An Çalınan',
            'nowPlaying.ready': 'Şu An Çalınan: Aurivo Player - Hazır',
            'nowPlaying.none': 'Parça Yok',
            'nowPlaying.unknownTrack': 'Bilinmeyen Parça',
            'nowPlaying.unknownArtist': 'Bilinmeyen Sanatçı',
            'settings.buttons.ok': 'Tamam',
            'settings.buttons.apply': 'Uygula',
            'settings.buttons.cancel': 'İptal',
                        'controls.prev': 'Önceki',
            'controls.next': 'Sonraki',
            'controls.rewind10': '10 sn geri',
            'controls.forward10': '10 sn ileri',
            'controls.playPause': 'Oynat/Duraklat',
            'controls.shuffle': 'Karıştır',
            'controls.repeat': 'Tekrarla',
            'controls.volume': 'Ses',
            'controls.visual': 'Görselleştirici',
            'controls.eq': 'Ses Efektleri (EQ)',
                        'controls.clearPlaylist': 'Listeyi temizle',
            'nav.back': 'Geri',
            'nav.forward': 'İleri',
            'nav.reload': 'Yenile',
            'visualizerMenu.framerate': 'Kare oranı',
            'visualizerMenu.framerateLow': 'Düşük (20 fps)',
            'visualizerMenu.framerateMedium': 'Orta (25 fps)',
            'visualizerMenu.framerateHigh': 'Yüksek (30 fps)',
            'visualizerMenu.framerateUltra': 'Çok yüksek (60 fps)',
            'visualizerMenu.analyzers.bar': 'Bar çözümleyici',
            'visualizerMenu.analyzers.block': 'Blok çözümleyici',
            'visualizerMenu.analyzers.boom': 'Boom çözümleyici',
            'visualizerMenu.analyzers.sonogram': 'Sonogram',
            'visualizerMenu.analyzers.turbine': 'Türbin',
            'visualizerMenu.analyzers.nyanalyzer': 'Nyanalyzer Cat',
            'visualizerMenu.analyzers.rainbow': 'Rainbow Dash',
            'visualizerMenu.analyzers.none': 'Çözümleyici yok',
            'visualizerMenu.psychedelic': 'Psikedelik renkleri kullan',
            'visualizerMenu.visuals': 'Görseller',
            'visualizerMenu.effects.glow': 'Parıltı efekti',
            'visualizerMenu.effects.reflection': 'Yansıma',
            'sfx.nativeUnavailable': '⚠️ Ses efektleri kullanılamıyor: Native Audio Engine yüklenmedi. Temel oynatma çalışıyor.',
            'sfx.tapesat.statusLabel': 'DSP Durumu:',
            'sfx.tapesat.statusAttached': 'Bağlı (Mastering Priority 12)',
            'sfx.crossfeed.attached': 'Bağlı',
            'sfx.crossfeed.detached': 'Bağlı değil',
            'sfx.crossfeed.errorLabel': 'Hata',
            'sfx.crossfeed.statusLine': 'DSP Durumu: {attached} | Callback: {count}{errText}',
            'sfx.crossfeed.statusUnreadable': 'DSP Durumu: okunamadı',
            'sfx.crossfeed.info.title': 'ℹ️ Crossfeed Nedir?',
            'sfx.crossfeed.info.body1': 'Kulaklıkta dinlerken sol kulak sadece sol kanalı, sağ kulak sadece sağ kanalı duyar. Bu doğal değildir; hoparlörde her kulak iki kanaldan da bir miktar duyar.',
            'sfx.crossfeed.info.body2': 'bu doğal karışımı simüle eder:',
            'sfx.crossfeed.info.benefit1': 'Stereo yorgunluğunu azaltır',
            'sfx.crossfeed.info.benefit2': 'Daha doğal soundstage',
            'sfx.crossfeed.info.benefit3': 'Uzun dinlemelerde daha konforlu',
            'sfx.crossfeed.info.benefit4': 'Hoparlör benzeri deneyim',
            'sfx.crossfeed.info.noteLabel': 'Not:',
            'sfx.crossfeed.info.noteBody': 'Sadece kulaklıkla dinlerken kullanın. Hoparlörde çoğu durumda gerekmez.',
            'sfx.truepeak.clipping': 'Clipping:',
            'sfx.truepeak.gainReduction': 'GR:',
            'sfx.truepeak.oversampling': 'Oversampling:',
            'sfx.convreverb.irPresets': 'IR Presetleri',
            'sfx.convreverb.presets.hall': 'Concert Hall',
            'sfx.convreverb.presets.church': 'Church',
            'sfx.convreverb.presets.room': 'Room',
            'sfx.convreverb.presets.plate': 'Plate',
            'sfx.bassmono.presets.vinyl': 'Vinyl Safe',
            'sfx.bassmono.presets.club': 'Club System',
            'sfx.bassmono.presets.mastering': 'Mastering',
            'sfx.bassmono.presets.dj': 'DJ Mix',
            'sfx.bassmono.presets.sub': 'Sub Only',
            'sfx.bassmono.slopeLabel': 'Eğim',
            'sfx.dynamiceq.presets.deharsh': 'De-Harsh (3-5kHz)',
            'sfx.dynamiceq.presets.demud': 'De-Mud (200-400Hz)',
            'sfx.dynamiceq.presets.vocal': 'Vocal Presence',
            'sfx.dynamiceq.presets.deesser': 'Dynamic De-esser',
            'sfx.dynamiceq.presets.basstighten': 'Bass Tighten',
            'sfx.dynamiceq.presets.air': 'Air Sparkle',
            'sfx.dynamiceq.presets.drumsnap': 'Drum Snap',
            'sfx.dynamiceq.presets.warmth': 'Analog Warmth',
            'sfx.tapesat.presets.subtle': 'Subtle Warmth',
            'sfx.tapesat.presets.glue': 'Mastering Glue',
            'sfx.tapesat.presets.crisp': 'Crisp Tape',
            'sfx.tapesat.presets.lofi': 'Lo-fi Tape',
            'sfx.bitdither.presets.cd16': 'CD Mastering (16-bit)',
            'sfx.bitdither.presets.retro12': 'Retro 12-bit',
            'sfx.bitdither.presets.game8': '8-bit Gaming',
            'sfx.bitdither.presets.vinyl': 'Lo-fi Vinyl',
            'sfx.bitdither.presets.crunch': 'Subtle Crunch',
            'sfx.knob.eq32.bass': 'Bas (100 Hz)',
            'sfx.knob.eq32.mid': 'Mid (500Hz-2kHz)',
            'sfx.knob.eq32.treble': 'Tiz (10 kHz)',
            'sfx.knob.eq32.stereoExpander': 'Stereo Expander',
            'sfx.knob.param.roomSize': 'Room Size',
            'sfx.knob.param.damping': 'Damping',
            'sfx.knob.param.wetDry': 'Wet/Dry Mix',
            'sfx.knob.param.hfRatio': 'HF Ratio',
            'sfx.knob.param.inputGain': 'Input Gain',
            'sfx.knob.param.threshold': 'Threshold',
            'sfx.knob.param.ratio': 'Ratio',
            'sfx.knob.param.attack': 'Attack',
            'sfx.knob.param.release': 'Release',
            'sfx.knob.param.makeupGain': 'Makeup Gain',
            'sfx.knob.param.knee': 'Knee',
            'sfx.knob.param.ceiling': 'Ceiling',
            'sfx.knob.param.lookahead': 'Lookahead',
            'sfx.knob.param.gain': 'Gain',
            'sfx.knob.param.frequency': 'Frequency',
            'sfx.knob.param.harmonics': 'Harmonics',
            'sfx.knob.param.width': 'Width',
            'sfx.knob.param.mix': 'Mix',
            'sfx.knob.param.hold': 'Hold',
            'sfx.knob.param.range': 'Range',
            'sfx.knob.param.amount': 'Amount',
            'sfx.knob.param.centerLevel': 'Center Level',
            'sfx.knob.param.sideLevel': 'Side Level',
            'sfx.knob.param.bassToMono': 'Bass to Mono',
            'sfx.knob.param.delay': 'Delay',
            'sfx.knob.param.feedback': 'Feedback',
            'sfx.knob.param.highCut': 'High Cut',
            'sfx.knob.param.lowCut': 'Low Cut',
            'sfx.knob.param.predelay': 'Pre-delay',
            'sfx.knob.param.freq': 'Freq',
            'sfx.knob.param.q': 'Q',
            'sfx.knob.param.targetLevel': 'Target Level',
            'sfx.knob.param.maxGain': 'Max Gain',
            'sfx.knob.param.level': 'Level',
            'sfx.knob.param.cutoff': 'Cutoff',
            'sfx.knob.param.stereoWidth': 'Stereo Width',
            'sfx.knob.param.driveDb': 'Drive',
            'sfx.knob.param.tone': 'Tone',
            'sfx.knob.param.outputDb': 'Output',
            'sfx.knob.param.hiss': 'Tape Hiss',
            'ui.languageSelection.title': 'Dil Seçimi',
            'ui.languageSelection.label': 'Dil',
            'ui.languageSelection.hint': 'Değişiklikler için yeniden başlatma gerekir.',
            'ui.languageSelection.restartHint': 'Seçtiğiniz dil bir sonraki açılışta uygulanacak.',
            'restart.title': 'Yeniden başlatma gerekli',
            'restart.message': 'Dil değişikliğinin uygulanması için uygulamanın yeniden başlatılması gerekiyor. Şimdi yeniden başlatılsın mı?',
            'restart.yes': 'Evet',
            'restart.no': 'Hayır',
            'securityPage.title': 'Güvenlik',
            'securityPage.heroTitle': 'Aurivo Güvenli İnternet',
            'securityPage.heroSub': 'Web sekmesini daha güvenli ve kontrollü kullan.',
            'securityPage.sections.currentSite': 'Mevcut Site',
            'securityPage.sections.controls': 'Kontroller',
            'securityPage.sections.cleanup': 'Temizlik',
            'securityPage.sections.allowedPlatforms': 'İzinli Platformlar',
            'securityPage.buttons.copy': 'URL\'yi Kopyala',
            'securityPage.buttons.openInBrowser': 'Tarayıcıda Aç',
            'securityPage.buttons.clearCookies': 'Çerezleri temizle',
            'securityPage.buttons.clearCache': 'Önbelleği temizle',
            'securityPage.buttons.clearAll': 'Tüm Geçmişi Temizle',
            'securityPage.buttons.resetWeb': 'Web\'i Sıfırla',
            'securityPage.allowPopups': 'Pop-up pencerelerine izin ver (bazı girişler için gerekli olabilir)',
            'securityPage.vpnPolicyLabel': 'VPN tespit edildiğinde Web erişimini engelle',
            'securityPage.vpnPolicyHint': 'Öneri: Kapalı bırakın. VPN’de sadece uyarı verilir; izinli platformlar dışı siteler zaten engellenir.',
            'securityPage.allowPopupsHint': 'Not: Pop-up kapalıyken bazı sitelerde giriş/hesap bağlantıları açılmayabilir.',
            'securityPage.cleanupHint': 'Çerez/önbellek temizlemek bazı sitelerden çıkış yapabilir.',
            'securityPage.allowedPlatformsHint': 'Aurivo, Web sekmesinde aşağıdaki platformları hedefler (CSP/frame-src):',
            'securityPage.dynamic.urlLine': 'URL: {url}',
            'securityPage.dynamic.connSecure': 'Bağlantı: Güvenli (HTTPS)',
            'securityPage.dynamic.connInsecure': 'Bağlantı: Güvenli Değil (HTTP)',
            'securityPage.dynamic.connUnknown': 'Bağlantı: -',
            'securityPage.dynamic.vpnUnknown': 'VPN: -',
            'securityPage.dynamic.vpnDetected': 'VPN: Algılandı ({interfaces})',
            'securityPage.dynamic.vpnNotDetected': 'VPN: Algılanmadı',
            'securityPage.notify.urlCopied': 'URL panoya kopyalandı.',
            'securityPage.notify.urlCopyFailed': 'URL kopyalanamadı: {error}',
            'securityPage.notify.openInBrowserFailed': 'Tarayıcıda açılamadı.',
            'securityPage.notify.openInBrowserError': 'Tarayıcıda açılırken hata: {error}',
            'securityPage.notify.clearFailed': 'Temizleme başarısız.',
            'securityPage.notify.clearError': 'Temizleme hatası: {error}',
            'securityPage.notify.cookiesCleared': 'Çerezler temizlendi.',
            'securityPage.notify.cacheCleared': 'Önbellek temizlendi.',
            'securityPage.notify.allCleared': 'Web verileri temizlendi.',
            'securityPage.notify.webResetOk': 'Web sıfırlandı.',
            'securityPage.notify.webResetFailed': 'Web sıfırlanamadı: {error}',
            'securityPage.notify.invalidExternalUrl': 'Önce geçerli bir web sayfası açın (http/https).',
            'securityPage.notify.vpnBlocked': 'VPN algılandı. Güvenlik nedeniyle Web sekmesi geçici olarak engellendi.',
            'securityPage.notify.vpnWarning': 'VPN algılandı. Güvenlik için yalnızca izinli platformlar açılacaktır.',
            'securityPage.notify.urlBlocked': 'Bu adres güvenlik politikası nedeniyle engellendi.',
            'appMenu.file': 'Dosya',
            'appMenu.edit': 'Düzen',
            'appMenu.view': 'Görünüm',
            'appMenu.window': 'Pencere',
            'appMenu.help': 'Yardım',
            'appMenu.quit': 'Çıkış',
            'appMenu.close': 'Kapat',
            'appMenu.minimize': 'Küçült',
            'appMenu.reload': 'Yenile',
            'appMenu.toggleDevTools': 'Geliştirici araçları',
            'appMenu.resetZoom': 'Yakınlaştırmayı sıfırla',
            'appMenu.zoomIn': 'Yakınlaştır',
            'appMenu.zoomOut': 'Uzaklaştır',
            'appMenu.toggleFullscreen': 'Tam ekran',
            'appMenu.undo': 'Geri al',
            'appMenu.redo': 'Yinele',
            'appMenu.cut': 'Kes',
            'appMenu.copy': 'Kopyala',
            'appMenu.paste': 'Yapıştır',
            'appMenu.selectAll': 'Tümünü seç',
            'playback.title': 'Oynat',
            'playback.crossfade.title': 'Yumuşak geçiş',
            'playback.crossfade.stop': 'Bir parça durdurulurken yumuşak geç',
            'playback.crossfade.manual': 'Parça değiştirirken elle çapraz geçiş yap',
            'playback.crossfade.auto': 'Parça değiştirirken otomatik çapraz geçiş yap',
            'playback.crossfade.sameAlbumExcept': 'Aynı albümdeki/CUE dosyasındaki parçalar hariç',
            'playback.crossfade.duration': 'Yumuşak geçiş süresi',
            'playback.crossfade.fadeOnPause': 'Duraklatınca fade out / devam edince fade in',
            'playback.crossfade.pauseFadeDuration': 'Fade süresi',
            'panel.library': 'KÜTÜPHANE',
            'panel.internet': 'İNTERNET',
            'panel.loading': 'Yükleniyor...',
            'sidebar.files': 'Dosyalar',
            'sidebar.videos': 'Videolar',
            'sidebar.music': 'Müzik',
            'sidebar.web': 'Web',
            'sidebar.security': 'Güvenlik',
            'sidebar.settings': 'Ayarlar',
            'sidebar.about': 'Hakkında',
            'about.featuresTitle': 'Özellikler ve Şeffaflık',
            'about.sections.app.title': 'Uygulama Özellikleri',
            'about.sections.app.item1': 'Müzik, video ve web deneyimini tek arayüzde birleştirir.',
            'about.sections.app.item2': 'Çift oynatıcı yapısı, çalma listesi ve medya kontrolleri sunar.',
            'about.sections.app.item3': 'Çoklu dil desteği ve sistem dili algılama ile çalışır.',
            'about.sections.web.title': 'Web Özellikleri',
            'about.sections.web.item1': 'YouTube, Spotify, SoundCloud, Mixcloud ve sosyal platform erişimi sağlar.',
            'about.sections.web.item2': 'Oturumlar güvenli web bölmesinde (persist partition) korunur.',
            'about.sections.web.item3': 'Gezinme yalnızca izinli ve doğrulanan URL kurallarıyla çalışır.',
            'about.sections.security.title': 'Güvenlik ve Gizlilik',
            'about.sections.security.item1': 'Uygulama ayarlarına e-posta/şifre/token gibi hassas bilgiler kaydedilmez.',
            'about.sections.security.item2': 'Web görünümü sandbox, izin kontrolü ve alan adı kısıtlarıyla korunur.',
            'about.sections.security.item3': 'Harici tarayıcı açma yalnızca geçerli http/https adreslerinde etkinleşir.',
            'about.sections.sfx.title': 'Ses Efektleri Özellikleri',
            'about.sections.sfx.item1': '32-band EQ, kompresör, limiter, reverb, crossfeed ve diğer DSP modülleri içerir.',
            'about.sections.sfx.item2': 'Preset sistemi ve gerçek zamanlı parametre kontrolü sunar.',
            'about.sections.sfx.item3': 'Yük yönetimi için aktif olmayan efekt animasyonları sınırlandırılır.',
            'about.sections.visual.title': 'Görselleştirme Özellikleri',
            'about.sections.visual.item1': 'Birden fazla analyzer modu ve performans ayarları sağlar.',
            'about.sections.visual.item2': 'FPS ve görsel efekt seçenekleri kullanıcı kontrolündedir.',
            'about.sections.visual.item3': 'Ses akışına bağlı, düşük gecikmeli canlı görsel geri bildirim üretir.'
        }
    };

    const LEGACY_KEY_MAP = {
        'settings.title': ['preferences'],
        'settings.tabs.playback': ['video'],
        'settings.tabs.behavior': ['moreOptions'],
        'settings.tabs.library': ['audio'],
        'settings.tabs.audio': ['audio'],
        'settings.buttons.ok': ['ok'],
        'settings.buttons.apply': ['update'],
        'settings.buttons.cancel': ['cancel'],
        'ui.languageSelection.title': ['selectLanguageRelaunch'],
        'ui.languageSelection.label': ['selectLanguageRelaunch'],
        'ui.languageSelection.hint': ['selectLanguageRelaunch'],
        'ui.languageSelection.restartHint': ['selectLanguageRelaunch'],
        'about.title': ['about'],
        'sidebar.about': ['about'],
        'sidebar.settings': ['preferences'],
        'sidebar.web': ['homepage'],
        'sidebar.download': ['download'],
        'panel.library': ['audio'],
        'panel.loading': ['processing'],
        'securityPage.buttons.copy': ['copyUrl'],
        'securityPage.buttons.openInBrowser': ['open'],
        'securityPage.buttons.clearAll': ['clearAllHistory']
    };

    function applyOverrides(messages, lang) {
        const out = (messages && typeof messages === 'object') ? { ...messages } : {};

        // Ensure new About sections exist for every supported language.
        for (const [key, value] of Object.entries(ABOUT_COMMON_FALLBACK)) {
            const current = deepGet(out, key);
            if (typeof current !== 'string' || !current.trim()) {
                deepSet(out, key, value);
            }
        }

        const overrides = LOCALE_OVERRIDES[lang];
        if (overrides) {
            for (const [key, value] of Object.entries(overrides)) {
                // Force locale-specific UI strings where available.
                deepSet(out, key, value);
            }
        }

        return out;
    }

    function format(str, vars) {
        if (!vars || typeof vars !== 'object') return String(str);
        return String(str).replace(/\{(\w+)\}/g, (_m, k) => {
            if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k]);
            return `{${k}}`;
        });
    }

    async function loadMessages(lang) {
        const normalized = normalizeLang(lang) || 'en-US';
        if (cache.has(normalized)) return cache.get(normalized);

        try {
            if (window.aurivo?.i18n?.loadLocale) {
                const json = await window.aurivo.i18n.loadLocale(normalized);
                const patched = applyOverrides(json || {}, normalized);
                cache.set(normalized, patched);
                return patched;
            }
        } catch {
            // ignore
        }

        try {
            const res = await fetch(`locales/${normalized}.json`, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const patched = applyOverrides(json || {}, normalized);
            cache.set(normalized, patched);
            return patched;
        } catch {
            if (normalized !== 'en-US') return loadMessages('en-US');
            cache.set('en-US', {});
            return {};
        }
    }

    function applyDirAndLang(lang) {
        const docEl = document.documentElement;
        if (!docEl) return;
        docEl.lang = lang;
        docEl.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
        document.body?.classList.toggle('rtl', RTL_LANGS.has(lang));
    }

    function valueFor(messages, key) {
        const resolve = (source, wantedKey) => {
            let v = deepGet(source, wantedKey);
            if (typeof v === 'string') return v;
            const legacyKeys = LEGACY_KEY_MAP[wantedKey];
            if (Array.isArray(legacyKeys)) {
                for (const lk of legacyKeys) {
                    v = deepGet(source, lk);
                    if (typeof v === 'string') return v;
                }
            }
            return null;
        };

        const own = resolve(messages, key);
        if (own !== null) return own;

        return resolve(cache.get('en-US') || {}, key);
    }

    function applyTranslations(messages) {
        const nodes = document.querySelectorAll(
            '[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label],[data-translate],[data-translate-title],[data-translate-placeholder]'
        );

        nodes.forEach((el) => {
            const textKey = el.getAttribute('data-i18n') || el.getAttribute('data-translate');
            if (textKey) {
                const val = valueFor(messages, textKey);
                if (val !== null) el.textContent = val;
            }

            const htmlKey = el.getAttribute('data-i18n-html');
            if (htmlKey) {
                const val = valueFor(messages, htmlKey);
                if (val !== null) el.innerHTML = val;
            }

            const titleKey = el.getAttribute('data-i18n-title') || el.getAttribute('data-translate-title');
            if (titleKey) {
                const val = valueFor(messages, titleKey);
                if (val !== null) el.setAttribute('title', val);
            }

            const placeholderKey = el.getAttribute('data-i18n-placeholder') || el.getAttribute('data-translate-placeholder');
            if (placeholderKey) {
                const val = valueFor(messages, placeholderKey);
                if (val !== null) el.setAttribute('placeholder', val);
            }

            const ariaLabelKey = el.getAttribute('data-i18n-aria-label');
            if (ariaLabelKey) {
                const val = valueFor(messages, ariaLabelKey);
                if (val !== null) el.setAttribute('aria-label', val);
            }
        });
    }

    async function persistLanguagePreference(lang) {
        const normalized = normalizeLang(lang) || 'en-US';

        try {
            localStorage.setItem(STORAGE_KEY, normalized);
            localStorage.setItem(LEGACY_STORAGE_KEY, normalized);
            localStorage.setItem(USER_SELECTED_KEY, 'true');
        } catch {
            // ignore
        }

        try {
            const p = window.aurivo?.saveSettings?.({ ui: { language: normalized } });
            if (p && typeof p.then === 'function') await p;
        } catch {
            // ignore
        }

        return normalized;
    }

    async function detectSystemLang() {
        try {
            const fromMain = await window.aurivo?.i18n?.getSystemLocale?.();
            const normalized = normalizeLang(fromMain);
            if (normalized) return normalized;
        } catch {
            // ignore
        }

        const navLocale = navigator.language || (navigator.languages && navigator.languages[0]);
        return normalizeLang(navLocale) || 'en-US';
    }

    async function getInitialLanguage() {
        try {
            const settings = await window.aurivo?.loadSettings?.();
            const fromSettings = normalizeLang(settings?.ui?.language);
            if (fromSettings) return fromSettings;
        } catch {
            // ignore
        }

        try {
            const fromStorage = normalizeLang(localStorage.getItem(STORAGE_KEY));
            if (fromStorage) return fromStorage;

            const fromLegacy = normalizeLang(localStorage.getItem(LEGACY_STORAGE_KEY));
            if (fromLegacy) return fromLegacy;
        } catch {
            // ignore
        }

        return detectSystemLang();
    }

    async function setLanguage(lang, opts = {}) {
        const normalized = normalizeLang(lang) || 'en-US';
        const previous = currentLang;
        currentLang = normalized;

        if (!opts?.skipPersist) {
            await persistLanguagePreference(normalized);
        }

        const messages = await loadMessages(normalized);
        if (normalized !== 'en-US' && !cache.has('en-US')) {
            await loadMessages('en-US').catch(() => {});
        }

        applyDirAndLang(normalized);
        applyTranslations(messages);

        if (previous !== normalized) {
            listeners.forEach((fn) => {
                try {
                    fn(normalized);
                } catch {
                    // ignore
                }
            });
            window.dispatchEvent(new CustomEvent('aurivo:languageChanged', { detail: { lang: normalized } }));
        }

        return normalized;
    }

    async function setLanguagePreference(lang) {
        return persistLanguagePreference(lang);
    }

    async function init() {
        const selected = await getInitialLanguage();
        return setLanguage(selected, { skipPersist: false });
    }

    function translatePage() {
        const lang = currentLang || normalizeLang(localStorage.getItem(STORAGE_KEY)) || 'en-US';
        const messages = cache.get(lang) || cache.get('en-US') || {};
        applyTranslations(messages);
    }

    async function t(key, vars) {
        const lang = currentLang || normalizeLang(localStorage.getItem(STORAGE_KEY)) || (await detectSystemLang());
        const messages = await loadMessages(lang);
        let raw = valueFor(messages, key);
        if (typeof raw !== 'string' && lang !== 'en-US') {
            const en = await loadMessages('en-US');
            raw = valueFor(en, key);
        }
        if (typeof raw !== 'string') return String(key);
        return format(raw, vars);
    }

    function tSync(key, vars) {
        const lang = currentLang || normalizeLang(localStorage.getItem(STORAGE_KEY)) || 'en-US';
        const messages = cache.get(lang) || cache.get('en-US') || {};
        let raw = valueFor(messages, key);
        if (typeof raw !== 'string' && lang !== 'en-US') {
            raw = valueFor(cache.get('en-US') || {}, key);
        }
        if (typeof raw !== 'string') return String(key);
        return format(raw, vars);
    }

    function __(key) {
        return tSync(key);
    }

    function getLanguage() {
        return currentLang;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    window.i18n = {
        SUPPORTED,
        init,
        t,
        tSync,
        __,
        setLanguage,
        setLocale: setLanguage,
        setLanguagePreference,
        translatePage,
        getLanguage,
        onChange
    };
})();







