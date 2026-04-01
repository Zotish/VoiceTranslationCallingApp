const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

/**
 * Clone a voice using ElevenLabs Instant Voice Cloning
 * @param {string} name - Name for the voice
 * @param {string} filePath - Path to the audio file
 * @returns {string} voiceId
 */
async function cloneVoice(name, filePath) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const form = new FormData();
  form.append('name', `VoiceTranslate_${name}`);
  form.append('description', `Cloned voice for ${name} on VoiceTranslate app`);
  form.append('files', fs.createReadStream(filePath));

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('ElevenLabs clone error:', errText);
    throw new Error(`Voice cloning failed: ${response.status}`);
  }

  const data = await response.json();
  return data.voice_id;
}

/**
 * Generate speech using a cloned voice
 * @param {string} text - Text to speak
 * @param {string} voiceId - ElevenLabs voice ID
 * @returns {Buffer} audio buffer (mp3)
 */
async function generateSpeech(text, voiceId) {
  if (!ELEVENLABS_API_KEY) {
    return null; // Will fallback to browser TTS
  }

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2', // Supports all languages
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('ElevenLabs TTS error:', errText);
    return null; // Fallback to browser TTS
  }

  const buffer = await response.buffer();
  return buffer;
}

/**
 * Delete a cloned voice from ElevenLabs
 */
async function deleteVoice(voiceId) {
  if (!ELEVENLABS_API_KEY || !voiceId) return;

  try {
    await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
  } catch (err) {
    console.error('Failed to delete voice:', err.message);
  }
}

/**
 * Check remaining character quota
 */
async function getUsageInfo() {
  if (!ELEVENLABS_API_KEY) return null;

  try {
    const response = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      characterCount: data.character_count,
      characterLimit: data.character_limit,
      remaining: data.character_limit - data.character_count
    };
  } catch {
    return null;
  }
}

module.exports = { cloneVoice, generateSpeech, deleteVoice, getUsageInfo };
