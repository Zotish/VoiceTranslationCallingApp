const fs = require('fs');
const path = require('path');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

function getApiKey() {
  return process.env.ELEVENLABS_API_KEY;
}

/**
 * Clone a voice using ElevenLabs Instant Voice Cloning
 */
async function cloneVoice(name, filePath) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in Railway environment variables.');
  }

  console.log(`🎤 Cloning voice for "${name}" from file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`📁 File size: ${(fileSize / 1024).toFixed(1)} KB`);

  // Read file as buffer and create Blob (Node 18+ native FormData + Blob)
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.webm': 'audio/webm', '.mp4': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
  const mimeType = mimeMap[ext] || 'audio/webm';

  const blob = new Blob([fileBuffer], { type: mimeType });
  const form = new FormData();
  form.append('name', `VT_${name}_${Date.now()}`);
  form.append('description', `Cloned voice for ${name}`);
  form.append('files', blob, `voice_sample${ext || '.webm'}`);

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: form,
  });

  const responseText = await response.text();
  console.log(`📡 ElevenLabs response (${response.status}):`, responseText);

  if (!response.ok) {
    throw new Error(`Voice cloning failed (${response.status}): ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log(`✅ Voice cloned! ID: ${data.voice_id}`);
  return data.voice_id;
}

/**
 * Generate speech using a cloned voice
 */
async function generateSpeech(text, voiceId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
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
    console.error('ElevenLabs TTS error:', response.status, errText);
    return null;
  }

  // Get audio as buffer
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Delete a cloned voice from ElevenLabs
 */
async function deleteVoice(voiceId) {
  const apiKey = getApiKey();
  if (!apiKey || !voiceId) return;

  try {
    await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey }
    });
  } catch (err) {
    console.error('Failed to delete voice:', err.message);
  }
}

/**
 * Check remaining character quota
 */
async function getUsageInfo() {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
      headers: { 'xi-api-key': apiKey }
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
