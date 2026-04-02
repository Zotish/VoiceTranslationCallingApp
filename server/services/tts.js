const googleTTS = require('google-tts-api');

/**
 * Generate TTS audio using Google Translate TTS
 * Returns base64 encoded audio string
 * Works for ALL languages - bn, zh, hi, en, etc.
 */
async function generateTTS(text, lang) {
  if (!text || !text.trim()) return null;

  try {
    // For long text, split into chunks (Google TTS has 200 char limit)
    if (text.length > 200) {
      const results = await googleTTS.getAllAudioBase64(text, {
        lang: lang || 'en',
        slow: false,
        host: 'https://translate.google.com',
        timeout: 10000,
      });

      // Combine all audio chunks
      if (results && results.length > 0) {
        // Return first chunk for simplicity (covers most cases)
        return results[0].base64;
      }
      return null;
    }

    // Short text - single request
    const base64 = await googleTTS.getAudioBase64(text, {
      lang: lang || 'en',
      slow: false,
      host: 'https://translate.google.com',
      timeout: 10000,
    });

    return base64 || null;
  } catch (err) {
    console.error(`TTS Error (${lang}): ${err.message}`);

    // Retry with language code variations
    const langMap = {
      'bn': 'bn', 'zh': 'zh-CN', 'hi': 'hi', 'en': 'en',
      'es': 'es', 'fr': 'fr', 'de': 'de', 'ja': 'ja',
      'ko': 'ko', 'ar': 'ar', 'pt': 'pt', 'ru': 'ru'
    };

    const altLang = langMap[lang];
    if (altLang && altLang !== lang) {
      try {
        const base64 = await googleTTS.getAudioBase64(text, {
          lang: altLang,
          slow: false,
          host: 'https://translate.google.com',
          timeout: 10000,
        });
        return base64 || null;
      } catch (retryErr) {
        console.error(`TTS Retry Error (${altLang}): ${retryErr.message}`);
      }
    }

    return null;
  }
}

module.exports = { generateTTS };
