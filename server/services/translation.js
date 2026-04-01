const fetch = require('node-fetch');

const SUPPORTED_LANGUAGES = {
  bn: { name: 'Bangla (Bengali)', nativeName: 'বাংলা' },
  zh: { name: 'Chinese', nativeName: '中文' },
  en: { name: 'English', nativeName: 'English' },
  es: { name: 'Spanish', nativeName: 'Español' },
  fr: { name: 'French', nativeName: 'Français' },
  de: { name: 'German', nativeName: 'Deutsch' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी' },
  ja: { name: 'Japanese', nativeName: '日本語' },
  ko: { name: 'Korean', nativeName: '한국어' },
  ar: { name: 'Arabic', nativeName: 'العربية' },
  pt: { name: 'Portuguese', nativeName: 'Português' },
  ru: { name: 'Russian', nativeName: 'Русский' },
  tr: { name: 'Turkish', nativeName: 'Türkçe' },
  th: { name: 'Thai', nativeName: 'ไทย' },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  it: { name: 'Italian', nativeName: 'Italiano' },
  ms: { name: 'Malay', nativeName: 'Bahasa Melayu' },
  id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  ur: { name: 'Urdu', nativeName: 'اردو' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்' }
};

/**
 * Translate text using MyMemory free translation API
 */
async function translateText(text, fromLang, toLang) {
  if (!text || !fromLang || !toLang) {
    throw new Error('text, fromLang, and toLang are required');
  }

  if (fromLang === toLang) {
    return text;
  }

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.responseStatus === 200 && data.responseData) {
      return data.responseData.translatedText;
    }

    // Fallback: return original text with note
    console.warn('Translation API returned non-200:', data.responseStatus);
    return text;
  } catch (err) {
    console.error('Translation API error:', err.message);
    throw err;
  }
}

function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES;
}

module.exports = { translateText, getSupportedLanguages, SUPPORTED_LANGUAGES };
