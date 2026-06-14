(function() {
  'use strict';
  
  var VW = window.VoiceWidget = window.VoiceWidget || {};
  VW.q = VW.q || [];
  
  // Also check for queue from the loader script (window.vw.q)
  var loaderQ = window.vw && window.vw.q ? window.vw.q : [];
  
  var translations = {
    en: { voiceChat: 'VOICE CHAT', connecting: 'Connecting...', callEnded: 'Call ended', poweredBy: 'Powered by', terms: 'Terms & Conditions', termsAgree: 'I agree to the', cancel: 'Cancel', continue: 'Continue' },
    ar: { voiceChat: 'محادثة صوتية', connecting: 'جاري الاتصال...', callEnded: 'انتهت المكالمة', poweredBy: 'مدعوم من', terms: 'الشروط والأحكام', termsAgree: 'أوافق على', cancel: 'إلغاء', continue: 'متابعة' },
    de: { voiceChat: 'SPRACHANRUF', connecting: 'Verbinden...', callEnded: 'Anruf beendet', poweredBy: 'Unterstützt von', terms: 'Nutzungsbedingungen', termsAgree: 'Ich akzeptiere die', cancel: 'Abbrechen', continue: 'Weiter' },
    es: { voiceChat: 'LLAMADA DE VOZ', connecting: 'Conectando...', callEnded: 'Llamada finalizada', poweredBy: 'Desarrollado por', terms: 'Términos y Condiciones', termsAgree: 'Acepto los', cancel: 'Cancelar', continue: 'Continuar' },
    fr: { voiceChat: 'APPEL VOCAL', connecting: 'Connexion...', callEnded: 'Appel terminé', poweredBy: 'Propulsé par', terms: 'Conditions Générales', termsAgree: "J'accepte les", cancel: 'Annuler', continue: 'Continuer' },
    hi: { voiceChat: 'वॉइस कॉल', connecting: 'कनेक्ट हो रहा है...', callEnded: 'कॉल समाप्त', poweredBy: 'द्वारा संचालित', terms: 'नियम और शर्तें', termsAgree: 'मैं सहमत हूं', cancel: 'रद्द करें', continue: 'जारी रखें' },
    it: { voiceChat: 'CHIAMATA VOCALE', connecting: 'Connessione...', callEnded: 'Chiamata terminata', poweredBy: 'Powered by', terms: 'Termini e Condizioni', termsAgree: 'Accetto i', cancel: 'Annulla', continue: 'Continua' },
    ja: { voiceChat: '音声通話', connecting: '接続中...', callEnded: '通話終了', poweredBy: 'Powered by', terms: '利用規約', termsAgree: '同意します', cancel: 'キャンセル', continue: '続ける' },
    pt: { voiceChat: 'CHAMADA DE VOZ', connecting: 'Conectando...', callEnded: 'Chamada finalizada', poweredBy: 'Desenvolvido por', terms: 'Termos e Condições', termsAgree: 'Eu concordo com os', cancel: 'Cancelar', continue: 'Continuar' },
    zh: { voiceChat: '语音通话', connecting: '连接中...', callEnded: '通话结束', poweredBy: '技术支持', terms: '条款和条件', termsAgree: '我同意', cancel: '取消', continue: '继续' }
  };
  
  var langFlags = {
    en: '🇺🇸', ar: '🇸🇦', af: '🇿🇦', am: '🇪🇹', az: '🇦🇿', be: '🇧🇾', bg: '🇧🇬', bn: '🇧🇩',
    bs: '🇧🇦', ca: '🇪🇸', cs: '🇨🇿', cy: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', da: '🇩🇰', de: '🇩🇪', el: '🇬🇷', es: '🇪🇸',
    et: '🇪🇪', fa: '🇮🇷', fi: '🇫🇮', fr: '🇫🇷', ga: '🇮🇪', gl: '🇪🇸', gu: '🇮🇳', he: '🇮🇱',
    hi: '🇮🇳', hr: '🇭🇷', hu: '🇭🇺', hy: '🇦🇲', id: '🇮🇩', is: '🇮🇸', it: '🇮🇹', ja: '🇯🇵',
    jw: '🇮🇩', ka: '🇬🇪', kk: '🇰🇿', km: '🇰🇭', kn: '🇮🇳', ko: '🇰🇷', lo: '🇱🇦', lt: '🇱🇹',
    lv: '🇱🇻', mi: '🇳🇿', mk: '🇲🇰', ml: '🇮🇳', mn: '🇲🇳', mr: '🇮🇳', ms: '🇲🇾', mt: '🇲🇹',
    my: '🇲🇲', ne: '🇳🇵', nl: '🇳🇱', no: '🇳🇴', pa: '🇮🇳', pl: '🇵🇱', pt: '🇧🇷', ro: '🇷🇴',
    ru: '🇷🇺', si: '🇱🇰', sk: '🇸🇰', sl: '🇸🇮', so: '🇸🇴', sq: '🇦🇱', sr: '🇷🇸', su: '🇮🇩',
    sv: '🇸🇪', sw: '🇰🇪', ta: '🇮🇳', te: '🇮🇳', th: '🇹🇭', tl: '🇵🇭', tr: '🇹🇷', uk: '🇺🇦',
    ur: '🇵🇰', uz: '🇺🇿', vi: '🇻🇳', zh: '🇨🇳', zu: '🇿🇦'
  };
  
  var langNames = {
    en: 'English', ar: 'العربية', af: 'Afrikaans', am: 'አማርኛ', az: 'Azərbaycan', be: 'Беларуская', bg: 'Български', bn: 'বাংলা',
    bs: 'Bosanski', ca: 'Català', cs: 'Čeština', cy: 'Cymraeg', da: 'Dansk', de: 'Deutsch', el: 'Ελληνικά', es: 'Español',
    et: 'Eesti', fa: 'فارسی', fi: 'Suomi', fr: 'Français', ga: 'Gaeilge', gl: 'Galego', gu: 'ગુજરાતી', he: 'עברית',
    hi: 'हिन्दी', hr: 'Hrvatski', hu: 'Magyar', hy: 'Հայdelays', id: 'Indonesia', is: 'Íslenska', it: 'Italiano', ja: '日本語',
    jw: 'Basa Jawa', ka: 'ქართული', kk: 'Қазақша', km: 'ភាសាខ្មែរ', kn: 'ಕನ್ನಡ', ko: '한국어', lo: 'ລາວ', lt: 'Lietuvių',
    lv: 'Latviešu', mi: 'Te Reo Māori', mk: 'Македонски', ml: 'മലയാളം', mn: 'Монгол', mr: 'मराठी', ms: 'Bahasa Melayu', mt: 'Malti',
    my: 'မြန်မာ', ne: 'नेपाली', nl: 'Nederlands', no: 'Norsk', pa: 'ਪੰਜਾਬੀ', pl: 'Polski', pt: 'Português', ro: 'Română',
    ru: 'Русский', si: 'සිංහල', sk: 'Slovenčina', sl: 'Slovenščina', so: 'Soomaali', sq: 'Shqip', sr: 'Српски', su: 'Basa Sunda',
    sv: 'Svenska', sw: 'Kiswahili', ta: 'தமிழ்', te: 'తెలుగు', th: 'ไทย', tl: 'Tagalog', tr: 'Türkçe', uk: 'Українська',
    ur: 'اردو', uz: "O'zbek", vi: 'Tiếng Việt', zh: '中文', zu: 'isiZulu'
  };
  
  var currentLang = 'en';
  var config = null;
  var embedToken = null;
  var state = 'idle';
  var session = null;
  var peerConnection = null;
  var dataChannel = null;
  var mediaStream = null;
  var audioElement = null;
  var audioContext = null;
  var analyser = null;
  var isMuted = false;
  var elapsedTime = 0;
  var timerInterval = null;
  var heartbeatInterval = null;
  var audioLevelInterval = null;
  var audioLevel = 0;
  var brandingData = null;
  var termsAccepted = false;
  var elevenLabsWs = null;
  var currentEngine = 'openai';
  var conversationId = null;
  var openaiTranscript = []; // Accumulated transcript for OpenAI calls
  
  function t(key) {
    return (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || key;
  }
  
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  
  function detectLanguage() {
    var htmlLang = document.documentElement.lang || '';
    var langCode = htmlLang.split('-')[0].toLowerCase();
    if (isLanguageSupported(langCode)) {
      currentLang = langCode;
    } else {
      var navLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0].toLowerCase();
      if (isLanguageSupported(navLang)) {
        currentLang = navLang;
      }
    }
  }
  
  function isLanguageSupported(code) {
    // If config has supportedLanguages, check against that
    if (config && config.supportedLanguages && config.supportedLanguages.length > 0) {
      return config.supportedLanguages.some(function(l) { return l.code === code; });
    }
    // Fallback to checking langNames
    return !!langNames[code];
  }
  
  function getSortedLanguages() {
    // If config has supportedLanguages from the engine, use those
    if (config && config.supportedLanguages && config.supportedLanguages.length > 0) {
      return config.supportedLanguages.map(function(lang) {
        return lang.code;
      }).sort(function(a, b) {
        if (a === 'en') return -1;
        if (b === 'en') return 1;
        var nameA = getLanguageName(a);
        var nameB = getLanguageName(b);
        return nameA.localeCompare(nameB);
      });
    }
    // Fallback to all languages
    return Object.keys(langNames).sort(function(a, b) {
      if (a === 'en') return -1;
      if (b === 'en') return 1;
      return langNames[a].localeCompare(langNames[b]);
    });
  }
  
  function getLanguageName(code) {
    // First check if config has the language info
    if (config && config.supportedLanguages) {
      var lang = config.supportedLanguages.find(function(l) { return l.code === code; });
      if (lang) return lang.name;
    }
    return langNames[code] || code;
  }
  
  function getLanguageFlag(code) {
    // First check if config has the language info
    if (config && config.supportedLanguages) {
      var lang = config.supportedLanguages.find(function(l) { return l.code === code; });
      if (lang && lang.flag) return lang.flag;
    }
    return langFlags[code] || '🌐';
  }
  
  function init(token) {
    embedToken = token;
    detectLanguage();
    loadConfig();
  }
  
  function getBaseUrl() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].id === 'vw' && scripts[i].src) {
        return scripts[i].src.replace(/\/widget\/embed\.js.*$/, '');
      }
    }
    return '';
  }
  
  function loadConfig() {
    fetch(getBaseUrl() + '/api/public/widget/config/' + embedToken)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        config = data;
        // Revalidate language selection now that we have engine-specific languages
        validateSelectedLanguage();
        
        // If widget already exists, rebuild dropdown immediately
        if (document.getElementById('vw-lang-dropdown')) {
          rebuildLanguageDropdown();
        }
        // Note: loadBranding() -> createWidget() always runs after config loads,
        // so getSortedLanguages() in getWidgetHTML() will already have supportedLanguages
        loadBranding();
      })
      .catch(function(err) {
        console.error('VoiceWidget: Failed to load config', err);
      });
  }
  
  function validateSelectedLanguage() {
    // Check if currentLang is supported by the engine
    if (!isLanguageSupported(currentLang)) {
      // Reset to first supported language (English if available, otherwise first in list)
      var supportedLangs = getSortedLanguages();
      if (supportedLangs.length > 0) {
        var newLang = supportedLangs.indexOf('en') >= 0 ? 'en' : supportedLangs[0];
        setLanguageSelection(newLang);
      }
    }
  }
  
  function setLanguageSelection(langCode) {
    // Update internal state
    currentLang = langCode;
    
    // Update UI if widget is already mounted
    var flagEl = document.getElementById('vw-lang-flag');
    if (flagEl) {
      flagEl.textContent = getLanguageFlag(langCode);
    }
    
    var dropdown = document.getElementById('vw-lang-dropdown');
    if (dropdown) {
      dropdown.querySelectorAll('.vw-lang-option').forEach(function(opt) {
        opt.classList.toggle('vw-selected', opt.getAttribute('data-lang') === langCode);
      });
    }
    
    // Update translations if DOM is ready
    if (document.getElementById('vw-widget')) {
      updateUILanguage();
    }
  }
  
  function rebuildLanguageDropdown() {
    var dropdown = document.getElementById('vw-lang-dropdown');
    if (!dropdown) return;
    
    // Rebuild dropdown options with engine-specific languages
    var sortedLanguages = getSortedLanguages();
    var optionsHtml = sortedLanguages.map(function(code) {
      return '<button class="vw-lang-option' + (code === currentLang ? ' vw-selected' : '') + '" data-lang="' + escapeHtml(code) + '">' +
        '<span class="vw-lang-option-flag">' + escapeHtml(getLanguageFlag(code)) + '</span>' +
        '<span class="vw-lang-option-name">' + escapeHtml(getLanguageName(code)) + '</span>' +
      '</button>';
    }).join('');
    
    dropdown.innerHTML = optionsHtml;
    
    // Update the flag button
    var flagEl = document.getElementById('vw-lang-flag');
    if (flagEl) {
      flagEl.textContent = getLanguageFlag(currentLang);
    }
    
    // Note: Event listeners for dropdown options are attached via event delegation
    // on the parent dropdown element in bindEvents(), so no need to re-attach
  }
  
  function loadBranding() {
    fetch(getBaseUrl() + '/api/branding')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        brandingData = data;
        createWidget();
      })
      .catch(function() {
        createWidget();
      });
  }
  
  function getAbsoluteUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
      return url;
    }
    return getBaseUrl() + (url.startsWith('/') ? url : '/' + url);
  }
  
  function createWidget() {
    var container = document.createElement('div');
    container.id = 'vw-container';
    container.innerHTML = getWidgetHTML();
    document.body.appendChild(container);
    injectStyles();
    bindEvents();
  }
  
  function getWidgetHTML() {
    var brandName = config.brandName || config.name || 'Agent';
    var iconUrl = getAbsoluteUrl(config.iconPath || config.iconUrl);
    // User's widget icon takes priority over admin branding
    var faviconUrl = iconUrl || brandingData?.favicon_url || brandingData?.logo_url;
    var appName = config.platformName || brandingData?.app_name || 'AgentLabs';
    var primaryColor = config.primaryColor || '#ec4899';
    
    return '<div id="vw-widget">' +
      '<div id="vw-state-idle" class="vw-state">' +
        '<div class="vw-card">' +
          '<div class="vw-avatar-wrap">' +
            (faviconUrl ? '<img src="' + escapeHtml(faviconUrl) + '" alt="" class="vw-avatar-img">' : 
             '<svg class="vw-avatar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>') +
          '</div>' +
          '<button id="vw-start-btn" class="vw-start-btn" ' + (!config.isAvailable ? 'disabled' : '') + '>' +
            '<svg class="vw-phone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
            '<span>' + escapeHtml(config.buttonLabel || t('voiceChat')) + '</span>' +
          '</button>' +
          '<div id="vw-lang-wrap" class="vw-lang-wrap">' +
            '<button id="vw-lang-btn" class="vw-lang-btn">' +
              '<span id="vw-lang-flag" class="vw-lang-flag">' + escapeHtml(getLanguageFlag(currentLang)) + '</span>' +
              '<svg class="vw-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
            '</button>' +
            '<div id="vw-lang-dropdown" class="vw-lang-dropdown">' +
              getSortedLanguages().map(function(code) {
                return '<button class="vw-lang-option' + (code === currentLang ? ' vw-selected' : '') + '" data-lang="' + escapeHtml(code) + '">' +
                  '<span class="vw-lang-option-flag">' + escapeHtml(getLanguageFlag(code)) + '</span>' +
                  '<span class="vw-lang-option-name">' + escapeHtml(getLanguageName(code)) + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="vw-powered">' + escapeHtml(t('poweredBy')) + ' <a href="' + escapeHtml(getBaseUrl()) + '" target="_blank" class="vw-brand-link">' + escapeHtml(appName) + '</a></div>' +
      '</div>' +
      '<div id="vw-state-terms" class="vw-state" style="display:none">' +
        '<div class="vw-card vw-terms-card">' +
          '<div class="vw-terms-header">' + escapeHtml(t('terms')) + '</div>' +
          '<label class="vw-terms-label">' +
            '<input type="checkbox" id="vw-terms-check" class="vw-terms-checkbox">' +
            '<span>' + escapeHtml(t('termsAgree')) + ' <a href="' + escapeHtml(getBaseUrl()) + '/terms" target="_blank" class="vw-terms-link">' + escapeHtml(t('terms')) + '</a></span>' +
          '</label>' +
          '<div class="vw-terms-actions">' +
            '<button id="vw-terms-cancel" class="vw-terms-btn vw-terms-cancel">' + escapeHtml(t('cancel')) + '</button>' +
            '<button id="vw-terms-accept" class="vw-terms-btn vw-terms-submit" disabled>' + escapeHtml(t('continue')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="vw-powered">' + escapeHtml(t('poweredBy')) + ' <a href="' + escapeHtml(getBaseUrl()) + '" target="_blank" class="vw-brand-link">' + escapeHtml(appName) + '</a></div>' +
      '</div>' +
      '<div id="vw-state-connecting" class="vw-state" style="display:none">' +
        '<div class="vw-card">' +
          '<div class="vw-avatar-wrap vw-spinning">' +
            (faviconUrl ? '<img src="' + escapeHtml(faviconUrl) + '" alt="" class="vw-avatar-img">' : 
             '<svg class="vw-avatar-icon vw-loader" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>') +
          '</div>' +
          '<span class="vw-connecting-text">' + escapeHtml(t('connecting')) + '</span>' +
          '<button id="vw-cancel-btn" class="vw-cancel-btn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="vw-powered">' + escapeHtml(t('poweredBy')) + ' <a href="' + escapeHtml(getBaseUrl()) + '" target="_blank" class="vw-brand-link">' + escapeHtml(appName) + '</a></div>' +
      '</div>' +
      '<div id="vw-state-active" class="vw-state" style="display:none">' +
        '<div class="vw-card">' +
          '<div class="vw-avatar-wrap vw-avatar-active">' +
            (faviconUrl ? '<img src="' + escapeHtml(faviconUrl) + '" alt="" class="vw-avatar-img-lg">' : 
             '<svg class="vw-avatar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg>') +
          '</div>' +
          '<div id="vw-timer-pill" class="vw-timer-pill">' +
            '<svg class="vw-timer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
            '<span id="vw-timer" class="vw-timer-text">0:00</span>' +
          '</div>' +
          '<button id="vw-mute-btn" class="vw-inline-btn vw-mute-btn">' +
            '<svg id="vw-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
            '<svg id="vw-mic-off-icon" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
          '</button>' +
          '<button id="vw-end-btn" class="vw-inline-btn vw-end-btn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="vw-powered">' + escapeHtml(t('poweredBy')) + ' <a href="' + escapeHtml(getBaseUrl()) + '" target="_blank" class="vw-brand-link">' + escapeHtml(appName) + '</a></div>' +
      '</div>' +
    '</div>';
  }
  
  function injectStyles() {
    var primaryColor = config.primaryColor || '#ec4899';
    var style = document.createElement('style');
    style.textContent = 
      '#vw-container{position:fixed;bottom:24px;right:24px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '#vw-widget{display:flex;flex-direction:column;align-items:center}' +
      '.vw-state{display:flex;flex-direction:column;align-items:center;gap:12px}' +
      '.vw-card{display:flex;align-items:center;gap:12px;background:#fff;border-radius:16px;padding:12px 16px;box-shadow:0 8px 32px rgba(0,0,0,.12);border:1px solid rgba(0,0,0,.06)}' +
      '.vw-terms-card{flex-direction:column;padding:20px 24px;min-width:280px}' +
      '.vw-avatar-wrap{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,' + primaryColor + '20,' + primaryColor + '05);border:1px solid ' + primaryColor + '30;flex-shrink:0;overflow:hidden}' +
      '.vw-avatar-img{width:24px;height:24px;object-fit:contain}' +
      '.vw-avatar-icon{width:20px;height:20px;color:' + primaryColor + '}' +
      '.vw-spinning{animation:vw-spin 2s linear infinite}' +
      '@keyframes vw-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
      '.vw-start-btn{display:flex;align-items:center;gap:8px;padding:10px 16px;border:none;border-radius:50px;background:#18181b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;transition:all .2s}' +
      '.vw-start-btn:hover:not(:disabled){background:#27272a;transform:scale(1.02)}' +
      '.vw-start-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.vw-phone-icon{width:16px;height:16px}' +
      '.vw-lang-wrap{position:relative}' +
      '.vw-lang-btn{display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid rgba(0,0,0,.1);border-radius:50px;background:transparent;cursor:pointer;transition:background .2s}' +
      '.vw-lang-btn:hover{background:rgba(0,0,0,.04)}' +
      '.vw-lang-flag{font-size:18px;line-height:1}' +
      '.vw-chevron{width:12px;height:12px;color:#71717a;transition:transform .2s}' +
      '.vw-chevron.vw-open{transform:rotate(180deg)}' +
      '.vw-lang-dropdown{display:none;position:absolute;bottom:100%;right:0;margin-bottom:8px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.16);border:1px solid rgba(0,0,0,.08);max-height:320px;overflow-y:auto;min-width:200px;z-index:1000}' +
      '.vw-lang-dropdown.vw-open{display:block}' +
      '.vw-lang-option{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:none;background:transparent;cursor:pointer;text-align:left;transition:background .15s}' +
      '.vw-lang-option:hover{background:rgba(0,0,0,.04)}' +
      '.vw-lang-option.vw-selected{background:rgba(0,0,0,.06)}' +
      '.vw-lang-option-flag{font-size:18px;line-height:1}' +
      '.vw-lang-option-name{font-size:14px;color:#27272a}' +
      '.vw-connecting-text{font-size:14px;font-weight:500;color:#52525b}' +
      '.vw-cancel-btn{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:50%;background:transparent;cursor:pointer;color:#71717a;transition:background .2s}' +
      '.vw-cancel-btn:hover{background:rgba(0,0,0,.06)}' +
      '.vw-cancel-btn svg{width:16px;height:16px}' +
      '.vw-avatar-active{width:48px;height:48px}' +
      '.vw-avatar-img-lg{width:32px;height:32px;object-fit:contain}' +
      '.vw-timer-pill{display:flex;align-items:center;gap:8px;background:#f4f4f5;border-radius:50px;padding:6px 12px}' +
      '.vw-timer-icon{width:14px;height:14px;color:#71717a}' +
      '.vw-timer-text{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;color:#3f3f46}' +
      '.vw-inline-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:50%;cursor:pointer;transition:all .2s}' +
      '.vw-inline-btn:hover{transform:scale(1.08)}' +
      '.vw-inline-btn svg{width:16px;height:16px}' +
      '.vw-mute-btn{background:#f4f4f5;color:#27272a;border:1px solid rgba(0,0,0,.15)}' +
      '.vw-mute-btn:hover{background:#e4e4e7}' +
      '.vw-mute-btn.vw-muted{background:#ef4444;color:#fff;border-color:#ef4444}' +
      '.vw-end-btn{background:#ef4444;color:#fff}' +
      '.vw-powered{font-size:12px;color:#a1a1aa}' +
      '.vw-brand-link{font-weight:500;color:#71717a;text-decoration:none}' +
      '.vw-brand-link:hover{text-decoration:underline}' +
      '.vw-terms-header{font-size:14px;font-weight:600;text-align:center;margin-bottom:12px;color:#27272a}' +
      '.vw-terms-label{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#52525b;cursor:pointer;margin-bottom:16px}' +
      '.vw-terms-checkbox{margin-top:2px;cursor:pointer}' +
      '.vw-terms-link{color:' + primaryColor + ';text-decoration:underline}' +
      '.vw-terms-actions{display:flex;gap:8px;justify-content:center}' +
      '.vw-terms-btn{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:opacity .2s}' +
      '.vw-terms-cancel{background:transparent;border:1px solid rgba(0,0,0,.2);color:#52525b}' +
      '.vw-terms-submit{background:' + primaryColor + ';color:#fff}' +
      '.vw-terms-submit:disabled{opacity:.5;cursor:not-allowed}';
    document.head.appendChild(style);
  }
  
  function bindEvents() {
    document.getElementById('vw-start-btn').addEventListener('click', handleStartClick);
    document.getElementById('vw-cancel-btn').addEventListener('click', cleanup);
    document.getElementById('vw-mute-btn').addEventListener('click', toggleMute);
    document.getElementById('vw-end-btn').addEventListener('click', endCall);
    
    var termsCheck = document.getElementById('vw-terms-check');
    var termsAcceptBtn = document.getElementById('vw-terms-accept');
    var termsCancelBtn = document.getElementById('vw-terms-cancel');
    
    termsCheck.addEventListener('change', function() {
      termsAccepted = termsCheck.checked;
      termsAcceptBtn.disabled = !termsAccepted;
    });
    
    termsAcceptBtn.addEventListener('click', function() {
      if (termsAccepted) {
        startCall();
      }
    });
    
    termsCancelBtn.addEventListener('click', function() {
      setState('idle');
    });
    
    var langBtn = document.getElementById('vw-lang-btn');
    var langDropdown = document.getElementById('vw-lang-dropdown');
    var chevron = langBtn.querySelector('.vw-chevron');
    
    langBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = langDropdown.classList.contains('vw-open');
      langDropdown.classList.toggle('vw-open', !isOpen);
      chevron.classList.toggle('vw-open', !isOpen);
    });
    
    langDropdown.addEventListener('click', function(e) {
      e.stopPropagation();
      var option = e.target.closest('.vw-lang-option');
      if (option) {
        var newLang = option.getAttribute('data-lang');
        if (newLang && newLang !== currentLang) {
          setLanguageSelection(newLang);
        }
        langDropdown.classList.remove('vw-open');
        chevron.classList.remove('vw-open');
      }
    });
    
    document.addEventListener('click', function() {
      langDropdown.classList.remove('vw-open');
      chevron.classList.remove('vw-open');
    });
  }
  
  function handleStartClick() {
    if (state !== 'idle' || !config || !config.isAvailable) return;
    
    if (config.requireTermsAcceptance && !termsAccepted) {
      setState('terms');
    } else {
      startCall();
    }
  }
  
  function setState(newState) {
    state = newState;
    document.getElementById('vw-state-idle').style.display = newState === 'idle' ? 'flex' : 'none';
    document.getElementById('vw-state-terms').style.display = newState === 'terms' ? 'flex' : 'none';
    document.getElementById('vw-state-connecting').style.display = newState === 'connecting' ? 'flex' : 'none';
    document.getElementById('vw-state-active').style.display = newState === 'active' ? 'flex' : 'none';
  }
  
  function updateUILanguage() {
    var startBtn = document.querySelector('#vw-start-btn span');
    if (startBtn) startBtn.textContent = (config && config.buttonLabel) ? config.buttonLabel : t('voiceChat');
    
    var connectingText = document.querySelector('.vw-connecting-text');
    if (connectingText) connectingText.textContent = t('connecting');
    
    var termsHeader = document.querySelector('.vw-terms-header');
    if (termsHeader) termsHeader.textContent = t('terms');
    
    var termsLabel = document.querySelector('.vw-terms-label span');
    if (termsLabel) {
      termsLabel.innerHTML = escapeHtml(t('termsAgree')) + ' <a href="' + escapeHtml(getBaseUrl()) + '/terms" target="_blank" class="vw-terms-link">' + escapeHtml(t('terms')) + '</a>';
    }
    
    var cancelBtn = document.getElementById('vw-terms-cancel');
    if (cancelBtn) cancelBtn.textContent = t('cancel');
    
    var acceptBtn = document.getElementById('vw-terms-accept');
    if (acceptBtn) acceptBtn.textContent = t('continue');
    
    var poweredBys = document.querySelectorAll('.vw-powered');
    var appName = (config && config.platformName) ? config.platformName : (brandingData?.app_name || 'AgentLabs');
    poweredBys.forEach(function(el) {
      el.innerHTML = escapeHtml(t('poweredBy')) + ' <span class="vw-brand">' + escapeHtml(appName) + '</span>';
    });
  }
  
  async function startCall() {
    setState('connecting');
    
    try {
      // Ensure language is supported before starting session
      var languageToUse = currentLang;
      if (!isLanguageSupported(languageToUse)) {
        var supportedLangs = getSortedLanguages();
        languageToUse = supportedLangs.indexOf('en') >= 0 ? 'en' : (supportedLangs[0] || 'en');
        // Update UI to reflect the language change
        setLanguageSelection(languageToUse);
      }
      
      // Build audio constraints with feature detection
      var audioConstraints = { };
      try {
        var supported = navigator.mediaDevices.getSupportedConstraints();
        if (supported.echoCancellation) audioConstraints.echoCancellation = true;
        if (supported.noiseSuppression) audioConstraints.noiseSuppression = true;
        if (supported.autoGainControl) audioConstraints.autoGainControl = true;
      } catch (e) {
        console.log('VoiceWidget: Could not detect supported constraints, using defaults');
      }
      
      // If no constraints detected, just use basic audio
      var audioConfig = Object.keys(audioConstraints).length > 0 ? audioConstraints : true;
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConfig });
      
      var sessionRes = await fetch(getBaseUrl() + '/api/public/widget/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedToken: embedToken,
          visitorDomain: window.location.hostname,
          language: languageToUse
        })
      });
      
      if (!sessionRes.ok) {
        var err = await sessionRes.json();
        throw new Error(err.message || err.error || 'Failed to start session');
      }
      
      session = await sessionRes.json();
      currentEngine = session.engine || 'openai';
      
      var tokenRes = await fetch(getBaseUrl() + '/api/public/widget/session/' + session.sessionId + '/ephemeral-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: session.sessionToken, language: languageToUse })
      });
      
      if (!tokenRes.ok) {
        var tokenErr = await tokenRes.json();
        throw new Error(tokenErr.error || 'Failed to get AI token');
      }
      
      var tokenData = await tokenRes.json();
      console.log('VoiceWidget: Token response:', JSON.stringify(tokenData, null, 2));
      currentEngine = tokenData.engine || currentEngine;
      console.log('VoiceWidget: Detected engine:', currentEngine);
      
      if (currentEngine === 'elevenlabs' && tokenData.signed_url) {
        console.log('VoiceWidget: Using ElevenLabs engine with signed URL');
        var languageToUse = tokenData.language || 'en';
        await initElevenLabsWebSocket(tokenData.signed_url, languageToUse);
      } else {
        console.log('VoiceWidget: Using OpenAI engine, tokenData:', JSON.stringify(tokenData));
        var ephemeralKey = tokenData.client_secret?.value || tokenData.client_secret;
        
        if (!ephemeralKey || typeof ephemeralKey !== 'string') {
          console.error('VoiceWidget: Invalid ephemeral key. Expected string, got:', typeof ephemeralKey, ephemeralKey);
          throw new Error('Invalid token response');
        }
        
        var realtimeModel = tokenData.model || 'gpt-4o-realtime-preview';
        await initWebRTC(ephemeralKey, realtimeModel);
      }
      
      setState('active');
      elapsedTime = 0;
      startTimer();
      startHeartbeat();
      
    } catch (err) {
      console.error('VoiceWidget: Call failed', err);
      cleanup();
      alert(err.message || 'Connection failed. Please try again.');
    }
  }
  
  async function initElevenLabsWebSocket(signedUrl, languageToUse) {
    return new Promise(function(resolve, reject) {
      elevenLabsWs = new WebSocket(signedUrl);
      
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      var SOURCE_SAMPLE_RATE = 16000;
      var targetSampleRate = audioContext.sampleRate;
      console.log('VoiceWidget: AudioContext sample rate:', targetSampleRate);
      
      var audioQueue = [];
      var isPlaying = false;
      var nextStartTime = 0;
      
      function resamplePCM(pcm16Data, fromRate, toRate) {
        var ratio = fromRate / toRate;
        var newLength = Math.round(pcm16Data.length / ratio);
        var result = new Float32Array(newLength);
        
        for (var i = 0; i < newLength; i++) {
          var srcIndex = i * ratio;
          var srcIndexFloor = Math.floor(srcIndex);
          var srcIndexCeil = Math.min(srcIndexFloor + 1, pcm16Data.length - 1);
          var t = srcIndex - srcIndexFloor;
          
          var sample1 = pcm16Data[srcIndexFloor] / 32768.0;
          var sample2 = pcm16Data[srcIndexCeil] / 32768.0;
          result[i] = sample1 * (1 - t) + sample2 * t;
        }
        
        return result;
      }
      
      function playNextChunk() {
        if (audioQueue.length === 0) {
          isPlaying = false;
          return;
        }
        
        isPlaying = true;
        var floatData = audioQueue.shift();
        
        var audioBuffer = audioContext.createBuffer(1, floatData.length, targetSampleRate);
        audioBuffer.getChannelData(0).set(floatData);
        
        var source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        
        var currentTime = audioContext.currentTime;
        if (nextStartTime < currentTime) {
          nextStartTime = currentTime;
        }
        
        source.start(nextStartTime);
        nextStartTime += audioBuffer.duration;
        
        source.onended = function() {
          playNextChunk();
        };
      }
      
      function queueAudioChunk(pcm16Data) {
        var floatData = resamplePCM(pcm16Data, SOURCE_SAMPLE_RATE, targetSampleRate);
        audioQueue.push(floatData);
        if (!isPlaying) {
          if (audioContext.state === 'suspended') {
            audioContext.resume().then(playNextChunk);
          } else {
            playNextChunk();
          }
        }
      }
      
      var inputProcessor = null;
      var inputSource = null;
      var audioSendCount = 0;
      var audioCaptureMethod = 'none';
      
      function calculateRMS(float32Data) {
        var sum = 0;
        for (var i = 0; i < float32Data.length; i++) {
          sum += float32Data[i] * float32Data[i];
        }
        return Math.sqrt(sum / float32Data.length);
      }
      
      function sendAudioToElevenLabs(float32Data) {
        if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
          return;
        }
        
        var rms = calculateRMS(float32Data);
        
        var inputRate = audioContext.sampleRate;
        var downsampled;
        
        if (inputRate === 16000) {
          downsampled = float32Data;
        } else {
          var ratio = inputRate / 16000;
          var newLen = Math.floor(float32Data.length / ratio);
          downsampled = new Float32Array(newLen);
          for (var j = 0; j < newLen; j++) {
            var srcIdx = j * ratio;
            var srcFloor = Math.floor(srcIdx);
            var srcCeil = Math.min(srcFloor + 1, float32Data.length - 1);
            var t = srcIdx - srcFloor;
            downsampled[j] = float32Data[srcFloor] * (1 - t) + float32Data[srcCeil] * t;
          }
        }
        
        var pcm16 = new Int16Array(downsampled.length);
        for (var i = 0; i < downsampled.length; i++) {
          var s = Math.max(-1, Math.min(1, downsampled[i]));
          pcm16[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
        }
        
        var bytes = new Uint8Array(pcm16.buffer);
        var binary = '';
        for (var k = 0; k < bytes.length; k++) {
          binary += String.fromCharCode(bytes[k]);
        }
        var base64 = btoa(binary);
        
        elevenLabsWs.send(JSON.stringify({
          user_audio_chunk: base64
        }));
        
        audioSendCount++;
        if (audioSendCount === 1 || audioSendCount % 100 === 0) {
          console.log('VoiceWidget: Audio #' + audioSendCount + ' | RMS: ' + rms.toFixed(4) + ' | Method: ' + audioCaptureMethod + ' | SR: ' + inputRate + ' | Samples: ' + downsampled.length);
        }
      }
      
      function setupScriptProcessor() {
        console.log('VoiceWidget: Setting up ScriptProcessor for audio capture');
        audioCaptureMethod = 'ScriptProcessor';
        var bufferSize = 4096;
        inputProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        inputSource.connect(inputProcessor);
        inputProcessor.connect(audioContext.destination);
        
        inputProcessor.onaudioprocess = function(e) {
          var inputData = e.inputBuffer.getChannelData(0);
          sendAudioToElevenLabs(new Float32Array(inputData));
        };
        console.log('VoiceWidget: ScriptProcessor audio capture active, bufferSize:', bufferSize);
      }
      
      if (mediaStream) {
        inputSource = audioContext.createMediaStreamSource(mediaStream);
        console.log('VoiceWidget: MediaStreamSource created');
        console.log('VoiceWidget: AudioContext state:', audioContext.state, '| sampleRate:', audioContext.sampleRate);
        
        if (audioContext.state === 'suspended') {
          console.log('VoiceWidget: AudioContext suspended, resuming...');
          audioContext.resume().then(function() {
            console.log('VoiceWidget: AudioContext resumed, state:', audioContext.state);
          });
        }
        
        if (audioContext.audioWorklet) {
          console.log('VoiceWidget: AudioWorklet supported, attempting to load module...');
          audioContext.audioWorklet.addModule(
            URL.createObjectURL(new Blob([`
              class AudioProcessor extends AudioWorkletProcessor {
                constructor() {
                  super();
                  this.bufferSize = 4096;
                  this.buffer = new Float32Array(this.bufferSize);
                  this.bufferIndex = 0;
                }
                process(inputs) {
                  const input = inputs[0];
                  if (input && input[0]) {
                    const inputData = input[0];
                    for (let i = 0; i < inputData.length; i++) {
                      this.buffer[this.bufferIndex++] = inputData[i];
                      if (this.bufferIndex >= this.bufferSize) {
                        this.port.postMessage({ audioData: this.buffer.slice() });
                        this.bufferIndex = 0;
                      }
                    }
                  }
                  return true;
                }
              }
              registerProcessor('audio-processor', AudioProcessor);
            `], { type: 'application/javascript' }))
          ).then(function() {
            audioCaptureMethod = 'AudioWorklet';
            inputProcessor = new AudioWorkletNode(audioContext, 'audio-processor');
            inputSource.connect(inputProcessor);
            console.log('VoiceWidget: AudioWorklet audio capture active, bufferSize: 4096');
            
            inputProcessor.port.onmessage = function(event) {
              sendAudioToElevenLabs(event.data.audioData);
            };
          }).catch(function(e) {
            console.log('VoiceWidget: AudioWorklet failed (' + e.message + '), using ScriptProcessor fallback');
            setupScriptProcessor();
          });
        } else {
          console.log('VoiceWidget: AudioWorklet not supported, using ScriptProcessor');
          setupScriptProcessor();
        }
      } else {
        console.log('VoiceWidget: No mediaStream available for audio capture');
      }
      
      elevenLabsWs.onopen = function() {
        console.log('VoiceWidget: ElevenLabs WebSocket connected');
        
        var initMessage = {
          type: 'conversation_initiation_client_data',
          conversation_config_override: {
            agent: {
              language: languageToUse
            }
          }
        };
        
        elevenLabsWs.send(JSON.stringify(initMessage));
        console.log('VoiceWidget: Sent conversation_initiation_client_data with language:', languageToUse);
        
        resolve();
      };
      
      elevenLabsWs.onmessage = function(event) {
        try {
          var msg = JSON.parse(event.data);
          
          if (msg.type === 'conversation_initiation_metadata') {
            // Try multiple possible locations for conversation_id
            conversationId = msg.conversation_id || 
              (msg.conversation_initiation_metadata_event && msg.conversation_initiation_metadata_event.conversation_id) ||
              (msg.data && msg.data.conversation_id);
            console.log('VoiceWidget: ElevenLabs conversation started:', conversationId);
            if (!conversationId) {
              console.log('VoiceWidget: Full initiation message:', JSON.stringify(msg));
            }
          }
          
          if (msg.type === 'ping' && msg.ping_event && msg.ping_event.event_id) {
            var pingDelay = msg.ping_event.ping_ms || 0;
            setTimeout(function() {
              if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                elevenLabsWs.send(JSON.stringify({
                  type: 'pong',
                  event_id: msg.ping_event.event_id
                }));
              }
            }, pingDelay);
          }
          
          if (msg.type === 'interruption') {
            console.log('VoiceWidget: Interruption received, clearing audio queue');
            audioQueue.length = 0;
            isPlaying = false;
          }
          
          var audioB64 = null;
          if (msg.audio_event && msg.audio_event.audio_base_64) {
            audioB64 = msg.audio_event.audio_base_64;
          } else if (msg.audio && msg.audio.chunk) {
            audioB64 = msg.audio.chunk;
          } else if (msg.audio_base_64) {
            audioB64 = msg.audio_base_64;
          } else if (msg.type === 'audio' && msg.delta) {
            audioB64 = msg.delta;
          }
          
          if (audioB64) {
            var binaryString = atob(audioB64);
            var bytes = new Uint8Array(binaryString.length);
            for (var i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            if (bytes.length % 2 !== 0) {
              bytes = bytes.slice(0, bytes.length - 1);
            }
            
            var pcm16 = new Int16Array(bytes.buffer);
            queueAudioChunk(pcm16);
          }
          
          if (msg.type === 'user_transcript' && msg.user_transcription_event) {
            console.log('VoiceWidget: [user_transcript]', msg.user_transcription_event.user_transcript);
          }
          
          if (msg.type === 'agent_response' && msg.agent_response_event) {
            console.log('VoiceWidget: [agent_response]', msg.agent_response_event.agent_response);
          }
          
        } catch (e) {
          console.log('VoiceWidget: Could not parse ElevenLabs message', e);
        }
      };
      
      elevenLabsWs.onerror = function(error) {
        console.error('VoiceWidget: ElevenLabs WebSocket error', error);
        reject(new Error('ElevenLabs connection failed'));
      };
      
      elevenLabsWs.onclose = function(event) {
        console.log('VoiceWidget: ElevenLabs WebSocket closed. Code:', event.code, 'Reason:', event.reason || 'No reason specified');
        if (state === 'active') {
          endCall();
        }
      };
    });
  }
  
  async function initWebRTC(ephemeralKey, realtimeModel) {
    peerConnection = new RTCPeerConnection();
    
    audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    document.body.appendChild(audioElement);
    
    peerConnection.ontrack = function(event) {
      audioElement.srcObject = event.streams[0];
      audioElement.play().catch(function(e) { console.log('Autoplay blocked:', e); });
      setupAudioAnalyser(event.streams[0]);
    };
    
    mediaStream.getTracks().forEach(function(track) {
      peerConnection.addTrack(track, mediaStream);
    });
    
    dataChannel = peerConnection.createDataChannel('oai-events');
    
    dataChannel.onopen = function() {
      onDataChannelReady();
    };
    
    dataChannel.onmessage = function(event) {
      try {
        var msg = JSON.parse(event.data);
        handleRealtimeEvent(msg);
      } catch (e) {
        console.log('VoiceWidget: Could not parse message', e);
      }
    };
    
    var offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    await new Promise(function(resolve) {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        peerConnection.onicegatheringstatechange = function() {
          if (peerConnection.iceGatheringState === 'complete') resolve();
        };
        setTimeout(resolve, 3000);
      }
    });
    
    var sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ephemeralKey,
        'Content-Type': 'application/sdp'
      },
      body: peerConnection.localDescription.sdp
    });
    
    if (!sdpResponse.ok) {
      var errText = await sdpResponse.text();
      console.error('VoiceWidget: OpenAI Realtime WebRTC connection failed. Status:', sdpResponse.status, 'Body:', errText);
      throw new Error('Failed to connect to OpenAI Realtime API: ' + errText);
    }
    
    var answerSdp = await sdpResponse.text();
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }
  
  function setupAudioAnalyser(stream) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      var source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (e) {
      console.log('Could not setup audio analyser:', e);
    }
  }
  
  
  function startTimer() {
    var timerEl = document.getElementById('vw-timer');
    
    timerInterval = setInterval(function() {
      elapsedTime++;
      var mins = Math.floor(elapsedTime / 60);
      var secs = elapsedTime % 60;
      timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
      
      if (config.maxCallDuration && elapsedTime >= config.maxCallDuration) {
        endCall();
      }
    }, 1000);
  }
  
  function startHeartbeat() {
    heartbeatInterval = setInterval(async function() {
      if (!session) return;
      
      try {
        var res = await fetch(getBaseUrl() + '/api/public/widget/session/' + session.sessionId + '/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken: session.sessionToken })
        });
        
        if (res.ok) {
          var data = await res.json();
          if (!data.continue) {
            endCall();
          }
        }
      } catch (e) {
        console.error('Heartbeat failed:', e);
      }
    }, 30000);
  }
  
  function toggleMute() {
    if (!mediaStream) return;
    
    var track = mediaStream.getAudioTracks()[0];
    if (track) {
      isMuted = !isMuted;
      track.enabled = !isMuted;
      
      var muteBtn = document.getElementById('vw-mute-btn');
      var micIcon = document.getElementById('vw-mic-icon');
      var micOffIcon = document.getElementById('vw-mic-off-icon');
      
      muteBtn.classList.toggle('vw-muted', isMuted);
      micIcon.style.display = isMuted ? 'none' : 'block';
      micOffIcon.style.display = isMuted ? 'block' : 'none';
    }
  }
  
  async function endCall() {
    if (session) {
      try {
        // Format transcript for OpenAI calls
        var transcriptText = null;
        if (currentEngine === 'openai' && openaiTranscript.length > 0) {
          transcriptText = openaiTranscript.map(function(item) {
            var prefix = item.role === 'user' ? 'User' : 'Assistant';
            return prefix + ': ' + item.content;
          }).join('\n');
          console.log('VoiceWidget: Sending transcript with', openaiTranscript.length, 'messages');
        }
        
        await fetch(getBaseUrl() + '/api/public/widget/session/' + session.sessionId + '/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: session.sessionToken,
            duration: elapsedTime,
            conversationId: conversationId,
            transcript: transcriptText
          })
        });
      } catch (e) {
        console.error('Failed to end session:', e);
      }
    }
    
    cleanup();
  }
  
  var firstMessageSent = false;
  var sessionCreated = false;
  var dataChannelOpen = false;
  
  function tryTriggerFirstMessage() {
    if (firstMessageSent) return;
    console.log('VoiceWidget: tryTriggerFirstMessage - sessionCreated:', sessionCreated, 'dataChannelOpen:', dataChannelOpen);
    
    if (sessionCreated && dataChannelOpen && dataChannel && dataChannel.readyState === 'open') {
      // Send response.create to trigger the agent's first message
      dataChannel.send(JSON.stringify({ type: 'response.create' }));
      firstMessageSent = true;
      console.log('VoiceWidget: Sent response.create for first message');
    }
  }
  
  function onDataChannelReady() {
    dataChannelOpen = true;
    console.log('VoiceWidget: Data channel is now open');
    tryTriggerFirstMessage();
  }
  
  function onSessionCreated() {
    sessionCreated = true;
    console.log('VoiceWidget: Session created event received');
    // Trigger immediately - no delay needed since config is set via ephemeral token
    tryTriggerFirstMessage();
  }
  
  function handleRealtimeEvent(msg) {
    // Handle session created - one of two conditions for first message
    if (msg.type === 'session.created') {
      onSessionCreated();
    }
    
    // Capture user transcription (from input_audio_transcription)
    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      var userText = msg.transcript;
      if (userText && userText.trim()) {
        openaiTranscript.push({ role: 'user', content: userText.trim() });
        console.log('VoiceWidget: User transcript:', userText.trim());
      }
    }
    
    // Capture assistant transcription (final text)
    if (msg.type === 'response.audio_transcript.done') {
      var assistantText = msg.transcript;
      if (assistantText && assistantText.trim()) {
        openaiTranscript.push({ role: 'assistant', content: assistantText.trim() });
        console.log('VoiceWidget: Assistant transcript:', assistantText.trim());
      }
    }
    
    // Handle function calls
    if (msg.type === 'response.function_call_arguments.done') {
      var functionName = msg.name;
      var callId = msg.call_id;
      var args = {};
      
      try {
        args = JSON.parse(msg.arguments || '{}');
      } catch (e) {
        console.error('VoiceWidget: Failed to parse function arguments', e);
      }
      
      if (functionName === 'book_appointment') {
        handleBookAppointment(callId, args);
      } else if (functionName === 'lookup_knowledge_base') {
        handleKnowledgeLookup(callId, args);
      }
    }
  }
  
  async function handleKnowledgeLookup(callId, args) {
    console.log('VoiceWidget: Knowledge lookup with query:', args.query);
    
    try {
      var res = await fetch(getBaseUrl() + '/api/public/widget/session/' + session.sessionId + '/knowledge-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: session.sessionToken,
          query: args.query || ''
        })
      });
      
      var result = await res.json();
      
      var functionResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(functionResponse));
        dataChannel.send(JSON.stringify({ type: 'response.create' }));
      }
      
      console.log('VoiceWidget: Knowledge lookup result:', result.found ? 'found ' + result.resultCount + ' results' : 'no results');
      
    } catch (err) {
      console.error('VoiceWidget: Knowledge lookup failed', err);
      
      var errorResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ found: false, message: 'Failed to search knowledge base. Please try again.' })
        }
      };
      
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(errorResponse));
        dataChannel.send(JSON.stringify({ type: 'response.create' }));
      }
    }
  }
  
  async function handleBookAppointment(callId, args) {
    console.log('VoiceWidget: Booking appointment with args:', args);
    
    try {
      var res = await fetch(getBaseUrl() + '/api/public/widget/session/' + session.sessionId + '/book-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: session.sessionToken,
          customerName: args.customerName,
          customerPhone: args.customerPhone,
          customerEmail: args.customerEmail || '',
          appointmentDate: args.appointmentDate,
          appointmentTime: args.appointmentTime,
          notes: args.notes || ''
        })
      });
      
      var result = await res.json();
      
      var functionResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(functionResponse));
        
        dataChannel.send(JSON.stringify({ type: 'response.create' }));
      }
      
      console.log('VoiceWidget: Appointment booking result:', result);
      
    } catch (err) {
      console.error('VoiceWidget: Appointment booking failed', err);
      
      var errorResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ success: false, message: 'Failed to book appointment. Please try again.' })
        }
      };
      
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(errorResponse));
        dataChannel.send(JSON.stringify({ type: 'response.create' }));
      }
    }
  }
  
  function cleanup() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (audioLevelInterval) { 
      if (audioLevelInterval.stop) audioLevelInterval.stop();
      audioLevelInterval = null;
    }
    
    if (elevenLabsWs) { 
      elevenLabsWs.close(); 
      elevenLabsWs = null; 
    }
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (audioElement) { audioElement.pause(); audioElement.remove(); audioElement = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(function(t) { t.stop(); }); mediaStream = null; }
    if (audioContext) { audioContext.close(); audioContext = null; analyser = null; }
    
    session = null;
    isMuted = false;
    audioLevel = 0;
    elapsedTime = 0;
    termsAccepted = false;
    currentEngine = 'openai';
    conversationId = null;
    openaiTranscript = [];
    firstMessageSent = false;
    sessionCreated = false;
    dataChannelOpen = false;
    
    var termsCheck = document.getElementById('vw-terms-check');
    if (termsCheck) termsCheck.checked = false;
    
    var termsAcceptBtn = document.getElementById('vw-terms-accept');
    if (termsAcceptBtn) termsAcceptBtn.disabled = true;
    
    var muteBtn = document.getElementById('vw-mute-btn');
    if (muteBtn) muteBtn.classList.remove('vw-muted');
    
    var micIcon = document.getElementById('vw-mic-icon');
    var micOffIcon = document.getElementById('vw-mic-off-icon');
    if (micIcon) micIcon.style.display = 'block';
    if (micOffIcon) micOffIcon.style.display = 'none';
    
    var bars = document.querySelectorAll('.vw-bar');
    bars.forEach(function(bar) { bar.style.transform = 'scaleY(1)'; });
    
    setState('idle');
  }
  
  VW.init = init;
  
  // Process commands from VoiceWidget.q
  while (VW.q.length) {
    var cmd = VW.q.shift();
    if (cmd[0] === 'init' && cmd[1]) init(cmd[1]);
  }
  
  // Process commands from loader's vw.q (the embed code stub)
  while (loaderQ.length) {
    var cmd = loaderQ.shift();
    if (cmd[0] === 'init' && cmd[1]) init(cmd[1]);
  }
})();
