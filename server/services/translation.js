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

// Map short codes to Google Translate codes
const GOOGLE_LANG_MAP = {
  'zh': 'zh-CN',
};

function getGoogleLang(lang) {
  return GOOGLE_LANG_MAP[lang] || lang;
}

/**
 * Primary: Google Translate (free unofficial endpoint)
 * Fallback: MyMemory API
 */
async function translateText(text, fromLang, toLang) {
  if (!text || !fromLang || !toLang) {
    throw new Error('text, fromLang, and toLang are required');
  }

  if (fromLang === toLang) {
    return text;
  }

  // Try Google Translate first (better quality)
  try {
    const result = await googleTranslate(text, fromLang, toLang);
    if (result) return result;
  } catch (err) {
    console.warn('Google Translate failed, trying MyMemory:', err.message);
  }

  // Fallback to MyMemory
  try {
    const result = await myMemoryTranslate(text, fromLang, toLang);
    if (result) return result;
  } catch (err) {
    console.error('MyMemory also failed:', err.message);
  }

  return text; // Return original if all fail
}

async function googleTranslate(text, fromLang, toLang) {
  const sl = getGoogleLang(fromLang);
  const tl = getGoogleLang(toLang);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (!response.ok) throw new Error(`Google API status ${response.status}`);

  const data = await response.json();
  if (data && data[0]) {
    return data[0].map(item => item[0]).filter(Boolean).join('');
  }
  throw new Error('Invalid Google response');
}

async function myMemoryTranslate(text, fromLang, toLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.responseStatus === 200 && data.responseData) {
    return data.responseData.translatedText;
  }
  throw new Error('MyMemory returned non-200');
}

function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES;
}

module.exports = { translateText, getSupportedLanguages, SUPPORTED_LANGUAGES };
